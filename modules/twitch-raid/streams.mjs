// Poser la question « lesquelles de ces chaînes sont en direct ? » à Twitch, par le Connecteur Twitch (service `twitch.api`, qui garde les jetons) : ce fichier ne parle jamais à Twitch directement.
// C'est le seul endroit qui connaît la forme de l'appel `GET streams` ; la vue complète (live.mjs) et la recherche au hasard (search.mjs) s'en servent toutes les deux.
// Règles de ce fichier (leçon d'un incident : une promesse partagée jamais résolue avait bloqué un site) :
//   - chaque appel à Twitch a une borne dure (`timing.packetMs`), l'ensemble d'un balayage ou d'une recherche une autre (`timing.callMs`, `timing.searchMs`) ;
//   - un paquet qui ne répond pas ne retient pas les autres ; ce qui arrive après la borne n'écrit plus rien ;
//   - si Twitch refuse la taille d'un paquet (erreur 400 : trop de pseudos), on essaie des paquets plus petits (100, 50, 20) et on retient la taille qui marche.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { PACKET_SIZES, chunk, nextPacketSize } = await import(`./pure.mjs${v}`);
const { resolveChannel, firstAccount } = await import(`./channel.mjs${v}`);

export const SERVICE = "twitch.api";
/** Les délais (en millisecondes). Un objet pour que les tests puissent les raccourcir. */
export const timing = {
  packetMs: 6000,        // un appel à Twitch
  callMs: 9000,          // tous les paquets de la vue complète, ensemble
  searchMs: 12_000,      // toute une recherche « au hasard » (jusqu'à 6 appels)
  concurrency: 3,        // paquets en même temps
  okMs: 30_000, failMs: 15_000, staleMs: 10 * 60_000,
  knownMs: 60_000,       // mode « au hasard » : combien de temps on se souvient de ce qu'un paquet de 100 a répondu
  sizeMs: 10 * 60_000,   // combien de temps on retient la taille de paquet qui marche
};
const sizes = new Map();   // clé d'instance → { size, until }
export const resetStreams = () => sizes.clear();

/** Attend `p` au plus `ms` (le minuteur ne retient pas le processus) ; passé ce délai : `fallback`. */
export function within(p, ms, fallback) {
  let t;
  return Promise.race([Promise.resolve(p), new Promise((r) => { t = setTimeout(() => r(fallback), ms); t.unref?.(); })]).finally(() => clearTimeout(t));
}

const usable = (r) => r.ok && r.value && r.value.ok !== false && r.value.error !== "other_channel";
export const str = (x, max) => (typeof x === "string" ? x.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max) : "");

/**
 * La chaîne Twitch du site à interroger : celle du réglage « Chaîne Twitch à utiliser » (un choix parmi vos instances de Ma Chaîne Twitch, voir channel.mjs),
 * sinon la première prête. Le Connecteur Twitch dit ensuite si elle est utilisable : `account({ channel })` répond pour CETTE chaîne (sans `channel`, il
 * répondrait pour la première qu'il connaît). { problem, adminPath? } ou { channel }.
 */
export async function pickChannel(ctx, wanted) {
  const picked = await resolveChannel(ctx, wanted);
  if (picked.problem) return { problem: picked.problem, ...(picked.problem === "setup" && typeof picked.account?.adminPath === "string" ? { adminPath: picked.account.adminPath } : {}) };
  const mine = await firstAccount(ctx, { channel: picked.channel }, timing.packetMs);
  if (!mine) return { problem: "no_channel" };
  if (!mine.channel || !mine.ready) return { problem: "setup", adminPath: typeof mine.adminPath === "string" ? mine.adminPath : null };
  return { channel: mine.channel };
}

/** Ce que Twitch répond (GET streams) → les partenaires en direct, ou rien d'exploitable (null). Aucune confiance : tout est vérifié, coupé et ne contient aucun HTML. `pos` : la place dans la liste de la personne. */
export function readStreams(json, partners) {
  if (!json || !Array.isArray(json.data)) return null;
  const byLogin = new Map(partners.map((p, i) => [p.login, { p, pos: Number.isInteger(p.pos) ? p.pos : i }]));
  const seen = new Set(), live = [];
  for (const s of json.data) {
    const login = str(s?.user_login, 40).toLowerCase();
    const mine = byLogin.get(login);
    if (!mine || seen.has(login) || s.type !== "live") continue;
    const startedAt = Date.parse(s.started_at);
    if (!Number.isInteger(s.viewer_count) || s.viewer_count < 0 || !Number.isFinite(startedAt)) continue;
    seen.add(login);
    const entry = { login, name: mine.p.name || str(s.user_name, 40) || login, game: str(s.game_name, 100), title: str(s.title, 140), viewers: s.viewer_count, startedAt, pos: mine.pos };
    live.push(entry);
    const thumb = thumbUrl(s.thumbnail_url);
    if (thumb) thumbs.set(entry, thumb);
  }
  return live;
}

/** L'aperçu d'un direct (2.2), gardé À CÔTÉ de l'entrée et non dedans : la forme des entrées (donc ce que le dock lit) ne change pas. */
const thumbs = new WeakMap();
/** L'adresse de l'aperçu d'une entrée lue par `readStreams`, ou "" s'il n'y en a pas. */
export const thumbOf = (entry) => thumbs.get(entry) ?? "";
/** Une adresse d'aperçu de Twitch (modèle `…{width}x{height}.jpg`) → 320×180 ; seulement https, sur un domaine de Twitch (`jtvnw.net`), sans rien d'autre. */
export function thumbUrl(raw) {
  const s = typeof raw === "string" ? raw.trim().replace("{width}", "320").replace("{height}", "180") : "";
  return s.length <= 300 && /^https:\/\/([a-z0-9-]+\.)*jtvnw\.net\/[A-Za-z0-9_\-./]+\.(jpg|jpeg|png)$/i.test(s) ? s : "";
}

/** Un appel `GET streams` pour ces pseudos. Rend { json } ou { error } (`config`, `auth`, `forbidden`, `invalid`, `rate`, `network`, `twitch`, ou `param` : Twitch refuse les paramètres, erreur 400). Ne lève jamais, n'attend jamais plus de `timing.packetMs`. */
export async function callStreams(ctx, channel, logins) {
  try {
    const answers = await within(ctx.api.services.callAll(SERVICE, "request", { as: "app", method: "GET", path: "streams", query: { user_login: logins, first: 100 }, channel }), timing.packetMs, null);
    if (!answers) return { error: "network" };
    const r = answers.find(usable) ?? answers.find((x) => x.ok && x.value);
    if (!r?.value) return { error: "network" };
    const val = r.value;
    if (val.ok === false) return { error: typeof val.error === "string" ? val.error : "network" };
    if (val.status === 400) return { error: "param" };
    if (val.status !== 200) return { error: "twitch" };
    return { json: val.json };
  } catch { return { error: "network" }; }
}

/** Les erreurs qui reviendraient à l'identique pour chaque paquet : inutile d'insister. */
export const FATAL = new Set(["config", "auth", "forbidden", "invalid"]);

/** La taille de paquet à utiliser pour cette instance : la dernière qui a marché (si récente), sinon 100. */
export function packetSize(key) {
  const s = sizes.get(key);
  if (s && s.until > Date.now()) return s.size;
  sizes.delete(key);
  return PACKET_SIZES[0];
}
const remember = (key, size) => { if (size < packetSize(key)) sizes.set(key, { size, until: Date.now() + timing.sizeMs }); };

/**
 * Interroge Twitch pour ce groupe de chaînes (`group` : [{ login, name, pos }]) ; si Twitch refuse sa taille (400), le groupe est coupé en paquets plus petits, la taille qui marche est retenue.
 * `run` : { closed, fatal } — quand `closed` (délai global dépassé) ou `fatal` (erreur définitive déjà vue), on ne pose plus de question.
 * `stopAtLive` : s'arrêter dès qu'un paquet a des chaînes en direct (la recherche au hasard n'a besoin que de cela).
 * Rend { live: [...], checked: nombre de chaînes vérifiées, error: dernière erreur ou null, fatal: true si inutile d'insister }.
 */
export async function lookup(ctx, channel, key, group, run, { stopAtLive = false } = {}) {
  const out = { live: [], checked: 0, error: null, fatal: false };
  const ask = async (part) => {
    if (run.closed || run.fatal) return;
    const r = await callStreams(ctx, channel, part.map((p) => p.login));
    if (run.closed) return;   // la borne globale est passée : ce retardataire n'écrit plus rien
    if (r.error === "param") {
      const next = nextPacketSize(part.length);
      if (next) {
        remember(key, next);
        for (const piece of chunk(part, next)) { if (stopAtLive && out.live.length) return; await ask(piece); }
        return;
      }
      out.error = "twitch"; return;
    }
    if (r.error) { out.error = r.error; if (FATAL.has(r.error)) out.fatal = run.fatal = true; return; }
    const live = readStreams(r.json, part);
    if (!live) { out.error = "twitch"; return; }
    out.checked += part.length; out.live.push(...live);
  };
  for (const piece of chunk(group, packetSize(key))) {   // la taille retenue (100, ou moins si Twitch a déjà refusé 100)
    if ((stopAtLive && out.live.length) || run.closed || run.fatal) break;
    await ask(piece);
  }
  return out;
}

/** Ce que disent les erreurs des paquets → l'état à rendre quand AUCUN paquet n'a abouti. */
export function failure(errors) {
  if (errors.some((e) => e === "config" || e === "auth")) return { state: "not_ready", reason: "refused" };
  if (errors.some((e) => e === "forbidden" || e === "invalid")) return { state: "not_ready", reason: "outdated" };
  if (errors.includes("rate")) return { state: "error", reason: "rate" };
  return { state: "error", reason: errors.includes("twitch") ? "twitch" : "network" };
}

/** Fait travailler `worker` sur chaque élément, `limit` à la fois, et rend la main au plus tard après `totalMs` (ce qui n'a pas fini est laissé de côté : `run.closed` passe à vrai, les retardataires n'écrivent plus rien). */
export function pool(items, worker, limit, totalMs, run) {
  return new Promise((resolve) => {
    let next = 0, running = 0, timer;
    const finish = () => { if (!run.closed) { run.closed = true; clearTimeout(timer); resolve(); } };
    timer = setTimeout(finish, totalMs); timer.unref?.();
    const launch = () => {
      while (!run.closed && running < limit && next < items.length) {
        const item = items[next++]; running++;
        Promise.resolve().then(() => worker(item)).catch(() => {}).finally(() => { running--; launch(); });
      }
      if (next >= items.length && running === 0) finish();
    };
    launch();
  });
}
