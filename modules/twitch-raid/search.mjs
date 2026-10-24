// La recherche « au hasard » : pour une très grande communauté (plus de 500 chaînes), on ne montre pas qui est en ligne (trop de demandes à Twitch) :
// un clic choisit un membre en direct au hasard. Le site n'interroge Twitch que quand quelqu'un clique, et le moins possible :
//   1. d'abord parmi les membres en direct DÉJÀ CONNUS (trouvés par une recherche des 60 dernières secondes, pour tous les visiteurs) : aucune demande à Twitch ;
//   2. sinon, on tire 100 noms au hasard, jamais vus pendant les 60 dernières secondes, et on demande à Twitch lesquels sont en direct ; personne ? 100 AUTRES noms, 6 fois au plus ;
//   3. si une recherche est déjà en cours, on la rejoint au lieu d'en lancer une seconde.
// Le nombre de demandes à Twitch ne dépend donc pas du nombre de visiteurs. Rien n'est écrit sur le disque : la mémoire est celle du processus, un redémarrage la vide sans conséquence.
// Règles de ce fichier :
//   - chaque demande est bornée, et toute la recherche aussi (`timing.searchMs`) ; aucune attente sans expiration, même pour celui qui rejoint une recherche ;
//   - un plafond par instance (12 recherches qui interrogent Twitch par minute, partagé entre tous les visiteurs) ;
//   - jamais de membre dont le souvenir a expiré ; la chaîne de la personne n'est jamais tirée ; le générateur aléatoire est injectable (tests).
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { dedupe, withoutChannel, drawer, pickRandom, SEARCH_TRIES, PACKET_SIZES } = await import(`./pure.mjs${v}`);
const streams = await import(`./streams.mjs${v}`);
const { timing, pickChannel, within, lookup, failure } = streams;

/** Le plafond : `max` recherches qui interrogent Twitch par fenêtre de `windowMs`, pour toute l'instance. Un objet pour que les tests puissent le changer. */
export const limits = { max: 12, windowMs: 60_000 };
const asks = new Map();      // clé d'instance → heures des recherches récentes
const memory = new Map();    // clé d'instance → Map(pseudo → { until, entry }) : ce que les paquets déjà interrogés ont répondu (entry : le direct, ou null = hors ligne)
const running = new Map();   // clé d'instance → { job, since } : la recherche en cours, que les autres rejoignent
export const resetSearch = () => { asks.clear(); memory.clear(); running.clear(); };

function takeSlot(key) {
  const now = Date.now(), recent = (asks.get(key) ?? []).filter((t) => now - t < limits.windowMs);
  if (recent.length >= limits.max) { asks.set(key, recent); return false; }
  recent.push(now); asks.set(key, recent);
  return true;
}
/** Le souvenir de l'instance, sans ce qui a expiré. */
function remembered(key) {
  const now = Date.now(), m = memory.get(key) ?? new Map();
  for (const [login, e] of m) if (e.until <= now) m.delete(login);
  memory.set(key, m);
  return m;
}

/**
 * Trouve un partenaire en direct au hasard. Rend toujours un objet, sans jamais lever ni attendre plus de `timing.searchMs` :
 *   { state: "found", pick: { login, name, game, title, viewers, startedAt }, listed } · { state: "none", listed } (personne trouvé en ligne)
 *   · { state: "limited" } (trop de recherches) · { state: "no_partners" } · { state: "not_ready", reason } · { state: "error", reason }
 * `avoid` : le pseudo tiré juste avant (écarté, « un autre »). `rng` : comme Math.random.
 */
export async function findRandom(ctx, partners, settings = {}, { rng = Math.random, avoid = "" } = {}) {
  if (!partners.length) return { state: "no_partners" };
  const key = ctx.instance.key, run = { closed: false, fatal: false }, seen = { ok: 0, errors: [] };
  const search = async () => {
    const c = await pickChannel(ctx, settings?.channel).catch(() => ({ problem: "slow" }));
    if (c.problem === "slow") return { state: "error", reason: "network" };
    if (c.problem) return { state: "not_ready", reason: c.problem, ...(c.adminPath ? { adminPath: c.adminPath } : {}) };
    const everyone = withoutChannel(dedupe(partners.map((p, pos) => ({ ...p, pos }))), c.channel);
    if (!everyone.length) return { state: "no_partners" };
    const listed = everyone.length, inList = new Set(everyone.map((p) => p.login));
    const found = (x) => ({ state: "found", listed, pick: { login: x.login, name: x.name, game: x.game, title: x.title, viewers: x.viewers, startedAt: x.startedAt } });
    // les membres en direct déjà connus (souvenir non expiré, encore dans la liste) ; « un autre » évite le précédent
    const known = () => [...remembered(key).values()].filter((e) => e.entry && inList.has(e.entry.login)).map((e) => e.entry);
    const chooseKnown = () => { const all = known(), others = all.filter((x) => x.login !== avoid); return others.length ? pickRandom(others, rng) : null; };
    const onlyPrevious = () => known().find((x) => x.login === avoid) ?? null;   // le précédent est le seul connu : on le redonne plutôt que rien

    let hit = chooseKnown();
    if (hit) return found(hit);
    const other = running.get(key);
    if (other && performance.now() - other.since < timing.searchMs) {   // une recherche est déjà en cours : on la rejoint
      await within(other.job, timing.searchMs, null);
      hit = chooseKnown() ?? onlyPrevious();
      return hit ? found(hit) : { state: "none", listed };
    }
    const job = (async () => {
      const mem = remembered(key);
      const pool = everyone.filter((p) => !mem.has(p.login) && !(avoid && everyone.length > 1 && p.login === avoid));
      const deck = drawer(pool, rng);
      if (!deck.left()) return;   // tout a déjà été vu dans la dernière minute : rien de nouveau à demander
      if (!takeSlot(key)) { seen.limited = true; return; }
      for (let attempt = 0; attempt < SEARCH_TRIES && deck.left() > 0 && !run.closed; attempt++) {
        const batch = deck.take(PACKET_SIZES[0]);
        const r = await lookup(ctx, c.channel, key, batch, run);
        if (run.closed) return;   // la borne est passée : ce retardataire n'écrit plus rien
        if (r.checked) seen.ok++;
        if (r.error) seen.errors.push(r.error);
        const until = Date.now() + timing.knownMs;
        for (const x of r.live) mem.set(x.login, { until, entry: x });
        if (r.checked === batch.length) for (const p of batch) if (!mem.has(p.login)) mem.set(p.login, { until, entry: null });   // paquet entièrement vérifié : ces noms ne sont pas redemandés pendant une minute
        if (r.live.length || r.fatal) return;
      }
    })().catch(() => {});
    running.set(key, { job, since: performance.now() });
    try { await job; } finally { if (running.get(key)?.job === job) running.delete(key); }
    if (seen.limited) return { state: "limited" };
    hit = chooseKnown() ?? onlyPrevious();
    if (hit) return found(hit);
    return seen.ok || !seen.errors.length ? { state: "none", listed } : failure(seen.errors);
  };
  const result = await within(search().catch(() => ({ state: "error", reason: "network" })), timing.searchMs, null);
  run.closed = true;   // la borne est passée (ou la recherche est finie) : ce qui arrive encore n'écrit plus rien
  if (result) return result;
  return seen.ok ? { state: "none", listed: partners.length } : failure(seen.errors.length ? seen.errors : ["network"]);
}

/**
 * PLUSIEURS membres en direct (2.2, « Sélection du moment » d'une communauté de plus de 500 chaînes) : comme `findRandom`, avec les MÊMES bornes (paquets de 100 tirés
 * au hasard, jamais vus depuis une minute, 6 paquets au plus, 12 recherches par minute pour toute l'instance, `timing.searchMs` pour l'ensemble), mais on continue jusqu'à en
 * avoir `want` (ou plus) au lieu de s'arrêter au premier paquet qui en a. Rien n'est écrit sur le disque ; une recherche en cours est rejointe, pas doublée.
 *   `exclude` : pseudos à ne jamais demander ni rendre. `rng` : comme Math.random.
 * Rend { state: "found", entries: [...], listed } (au moins un) · { state: "none", listed } · { state: "limited" } · { state: "no_partners" } · { state: "not_ready", reason } · { state: "error", reason }.
 */
export async function findMany(ctx, partners, settings = {}, { want = 5, rng = Math.random, exclude = new Set() } = {}) {
  if (!partners.length) return { state: "no_partners" };
  const key = `${ctx.instance.key}|many`, run = { closed: false, fatal: false }, seen = { ok: 0, errors: [] };
  const target = Math.max(1, Math.floor(Number(want)) || 1);
  const search = async () => {
    const c = await pickChannel(ctx, settings?.channel).catch(() => ({ problem: "slow" }));
    if (c.problem === "slow") return { state: "error", reason: "network" };
    if (c.problem) return { state: "not_ready", reason: c.problem, ...(c.adminPath ? { adminPath: c.adminPath } : {}) };
    const everyone = withoutChannel(dedupe(partners.map((p, pos) => ({ ...p, pos }))), c.channel).filter((p) => !exclude.has(p.login));
    if (!everyone.length) return { state: "no_partners" };
    const listed = everyone.length, inList = new Set(everyone.map((p) => p.login));
    const known = () => [...remembered(key).values()].filter((e) => e.entry && inList.has(e.entry.login)).map((e) => e.entry);
    if (known().length >= target) return { state: "found", entries: known(), listed };
    const other = running.get(key);
    if (other && performance.now() - other.since < timing.searchMs) {   // une recherche est déjà en cours : on la rejoint
      await within(other.job, timing.searchMs, null);
      const all = known();
      return all.length ? { state: "found", entries: all, listed } : { state: "none", listed };
    }
    const job = (async () => {
      const mem = remembered(key);
      const deck = drawer(everyone.filter((p) => !mem.has(p.login)), rng);
      if (!deck.left()) return;   // tout a déjà été vu dans la dernière minute : rien de nouveau à demander
      if (!takeSlot(ctx.instance.key)) { seen.limited = true; return; }   // le même plafond que « au hasard » : 12 recherches par minute pour toute l'instance
      for (let attempt = 0; attempt < SEARCH_TRIES && deck.left() > 0 && !run.closed; attempt++) {
        const batch = deck.take(PACKET_SIZES[0]);
        const r = await lookup(ctx, c.channel, ctx.instance.key, batch, run);
        if (run.closed) return;
        if (r.checked) seen.ok++;
        if (r.error) seen.errors.push(r.error);
        const until = Date.now() + timing.knownMs;
        for (const x of r.live) mem.set(x.login, { until, entry: x });
        if (r.checked === batch.length) for (const p of batch) if (!mem.has(p.login)) mem.set(p.login, { until, entry: null });
        if (r.fatal || known().length >= target) return;
      }
    })().catch(() => {});
    running.set(key, { job, since: performance.now() });
    try { await job; } finally { if (running.get(key)?.job === job) running.delete(key); }
    const all = known();
    if (all.length) return { state: "found", entries: all, listed };
    if (seen.limited) return { state: "limited" };
    return seen.ok || !seen.errors.length ? { state: "none", listed } : failure(seen.errors);
  };
  const result = await within(search().catch(() => ({ state: "error", reason: "network" })), timing.searchMs, null);
  run.closed = true;
  if (result) return result;
  return seen.ok ? { state: "none", listed: partners.length } : failure(seen.errors.length ? seen.errors : ["network"]);
}
