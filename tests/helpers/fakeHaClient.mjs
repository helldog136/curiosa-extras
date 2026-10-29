// Un faux Home Assistant : il parle le contrat HTTP public du module `home-assistant` (pair, pull, ack) comme le fera l'intégration réelle.
// Sert aux tests du module ET au lot qui écrit l'intégration (custom_components/curiosa) : même scénarios, même vocabulaire.
//
//   const ha = new FakeHaClient({ send: (path, init) => Response });          // `send` : n'importe quel transport (ici : les routes du module, en direct)
//   const ha = FakeHaClient.overHttp("https://site.example.org/m/ha");        // ou un vrai site (fetch)
//   await ha.pair("ABCD2345", "Maison");     // -> { ok, status, token, instance, pollSeconds }
//   await ha.step();                         // une interrogation + exécution + accusés, comme le coordinateur de l'intégration
//
// Comportement imité de l'intégration : curseur avancé après traitement, dédoublonnage par `id`, action expirée ignorée (horloge locale contre `serverTime`, tolérance 5 s),
// champ additif `catalog` de `pull` (les NOMS des actions : [{ key, label }], 50 au plus, libellé de 60 caractères au plus ; un ancien client l'ignore) : gardé dans `catalog`, et `proposals()` dit ce que l'intégration proposerait de relier
// (« Lancer l'aspirateur → [choisir un script] ») ; champ facultatif `test: true` d'une action (essai de la propriétaire ou simulation d'un module : exécutée comme les autres, `executed` la garde avec son `test`), interrupteur local (`switchOn`), liaison locale des clés (`bindings` : clé → fonction qui exécute), repli exponentiel (3 s → 60 s) sur erreur, arrêt sur 401.

export class FakeHaClient {
  constructor({ send, now = () => Date.now(), bindings = {}, switchOn = true, tolerance = 5000 } = {}) {
    this.send = send;
    this.now = now;
    this.bindings = bindings;   // { "lumieres:rouge": async (action) => {...} } ; une clé absente => accusé « ignored / unmapped »
    this.switchOn = switchOn;
    this.tolerance = tolerance;
    this.token = null;
    this.instance = null;
    this.cursor = 0;
    this.seen = new Set();
    this.executed = [];   // les actions réellement exécutées (pour les assertions) ; `action.test === true` pour un essai (champ facultatif de `pull`)
    this.calls = [];      // tout ce qui est parti : { path, method, status }
    this.interval = 3;
    this.backoff = 3;
    this.needsPairing = false;
    this.lastPull = null;
    this.catalog = [];    // les noms d'actions donnés par Curiosa : [{ key, label }] (champ `catalog` de `pull`, tel que lu)
  }

  static overHttp(base, options = {}) {
    const root = String(base).replace(/\/+$/, "");
    return new FakeHaClient({ ...options, send: (path, init) => fetch(`${root}/${path}`, init) });
  }

  async #call(path, init = {}) {
    const headers = { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...init.headers };
    const res = await this.send(path, { method: init.method ?? "GET", headers, body: init.body });
    let body = null;
    try { body = await res.json(); } catch { /* corps vide ou illisible */ }
    this.calls.push({ path, method: init.method ?? "GET", status: res.status });
    return { status: res.status, ok: res.status >= 200 && res.status < 300, body, retryAfter: Number(res.headers?.get?.("retry-after")) || null };
  }

  /** POST pair. En cas de succès, garde le jeton. */
  async pair(code, name = "Maison") {
    const r = await this.#call("pair", { method: "POST", body: JSON.stringify({ code, name }) });
    if (r.ok && r.body?.token) { this.token = r.body.token; this.instance = r.body.instance; this.interval = this.backoff = r.body.pollSeconds ?? 3; this.needsPairing = false; }
    return { ...r, token: r.body?.token ?? null, instance: r.body?.instance ?? null, pollSeconds: r.body?.pollSeconds ?? null };
  }

  /** GET pull?cursor=&limit= (ne change pas le curseur : voir `step`). */
  pull({ cursor = this.cursor, limit = 10 } = {}) { return this.#call(`pull?cursor=${cursor}&limit=${limit}`); }

  /** POST ack. */
  ack(id, status, code) { return this.#call("ack", { method: "POST", body: JSON.stringify({ id, status, code }) }); }

  /** Les entrées du catalogue valides : clé de la forme permise, libellé en texte de 60 caractères au plus ; 50 au plus. Un champ absent ou mal formé donne une liste vide (jamais d'erreur). */
  static readCatalog(body) {
    if (!Array.isArray(body?.catalog)) return [];
    return body.catalog.filter((c) => c && typeof c.key === "string" && /^[a-z0-9][a-z0-9:_-]{0,39}$/.test(c.key) && typeof c.label === "string" && c.label.length > 0 && [...c.label].length <= 60).slice(0, 50).map((c) => ({ key: c.key, label: c.label }));
  }

  /** Ce que l'intégration proposerait de relier : les actions du catalogue qui n'ont pas encore de liaison locale (`bindings`). */
  proposals() { return this.catalog.filter((c) => typeof this.bindings[c.key] !== "function"); }

  /** Exécute une action comme l'intégration : doublon, expirée, interrupteur coupé, clé sans liaison, ou exécution réelle. Rend { status, code }. */
  async handle(action, serverTime) {
    if (this.seen.has(action.id)) return null;   // déjà vue : pas de second accusé, pas de seconde exécution
    this.seen.add(action.id);
    if (this.seen.size > 500) this.seen.delete(this.seen.values().next().value);
    const skew = serverTime ? this.now() - Date.parse(serverTime) : 0;
    if (Date.parse(action.expiresAt) + skew + this.tolerance < this.now()) return { status: "ignored", code: "expired" };
    if (!this.switchOn) return { status: "ignored", code: "disabled" };
    const run = this.bindings[action.key];
    if (typeof run !== "function") return { status: "ignored", code: "unmapped" };
    try { await run(action); this.executed.push(action); return { status: "done", code: "ok" }; } catch { return { status: "failed", code: "error" }; }
  }

  /**
   * Un tour du coordinateur : interroge, exécute chaque action, accuse, avance le curseur. Rend { status, enabled, live, actions, acks, catalog, wait }.
   * `wait` : secondes avant le prochain tour (intervalle conseillé, ou repli exponentiel jusqu'à 60 s en cas d'erreur ; 401 => `needsPairing`, plus d'interrogation).
   */
  async step({ ackAll = true } = {}) {
    const r = await this.pull();
    this.lastPull = r;
    if (r.status === 401) { this.needsPairing = true; return { status: 401, actions: [], acks: [], wait: null }; }
    if (!r.ok) { this.backoff = Math.min(60, Math.max(this.backoff, 3) * 2); return { status: r.status, actions: [], acks: [], wait: r.retryAfter ?? this.backoff }; }
    this.backoff = r.body.pollSeconds ?? this.interval;
    this.catalog = FakeHaClient.readCatalog(r.body);
    const acks = [];
    for (const action of r.body.actions ?? []) {
      const out = await this.handle(action, r.body.serverTime);
      if (out && ackAll) acks.push({ id: action.id, ...out, response: await this.ack(action.id, out.status, out.code) });
    }
    this.cursor = r.body.cursor;
    return { status: 200, enabled: r.body.enabled, live: r.body.live, actions: r.body.actions ?? [], acks, catalog: this.catalog, wait: this.backoff };
  }
}

/** Un transport qui appelle directement les routes du module (`routes.pair|pull|ack`) avec un contexte donné : aucun réseau. */
export function directTransport(def, ctx, { ip = "203.0.113.9", base = "https://site.example.org/m/ha" } = {}) {
  return (path, init) => {
    const name = path.split("?")[0];
    const request = new Request(`${base}/${path}`, { ...init, headers: { "x-forwarded-for": ip, ...init.headers } });
    return def.routes[name](request, ctx);
  };
}
