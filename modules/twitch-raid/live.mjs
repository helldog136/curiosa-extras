// La vue complète : qui est en direct parmi les partenaires, maintenant (jusqu'à 500 chaînes ; au-delà, le dock passe en mode « au hasard », voir search.mjs).
// Les données viennent de Chaîne Twitch (service `twitch.api`, qui garde les jetons) par streams.mjs : ce fichier ne parle jamais à Twitch directement.
// Règles de ce fichier :
//   - la liste est découpée en paquets de 100 chaînes (jusqu'à 5), interrogés 3 à la fois, puis rassemblés ; gardés 30 s : dix docks ouverts, ou dix onglets, refont un seul jeu d'appels ;
//   - AUCUNE attente sans borne : l'ensemble est abandonné après `timing.callMs`, et un paquet qui échoue ne fait pas perdre les autres (résultat partiel, dit clairement) ;
//   - quand Twitch est en panne, on garde sous la main la dernière liste connue (10 minutes au plus) pour que le dock ne se vide pas pour une coupure de quelques secondes ;
//   - la chaîne de la personne n'apparaît jamais dans sa propre liste (on ne se raide pas soi-même).
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { modeFor, dedupe, withoutChannel, chunk } = await import(`./pure.mjs${v}`);
const streams = await import(`./streams.mjs${v}`);
const { timing, pickChannel, readStreams, within, lookup, pool, packetSize, failure } = streams;
export { timing, pickChannel, readStreams };

const state = { cache: new Map(), inflight: new Map(), good: new Map() };
export const resetLive = () => { for (const m of Object.values(state)) m.clear(); streams.resetStreams(); };

/**
 * Un travail partagé entre demandes simultanées, JAMAIS éternel : passé `ms`, tout le monde reçoit `fallback()` et l'entrée est retirée.
 * Un travail resté en arrière-plan qui finirait plus tard n'écrit rien. Le minuteur ne retient pas le processus.
 */
function share(k, make, fallback, record, ms) {
  const pending = state.inflight.get(k);
  if (pending) return pending;
  let timer;
  const expiry = new Promise((resolve) => { timer = setTimeout(() => resolve(fallback()), ms); timer.unref?.(); });
  const work = Promise.resolve().then(make).catch(() => fallback());
  const run = Promise.race([work, expiry]).then(record).finally(() => { clearTimeout(timer); if (state.inflight.get(k) === run) state.inflight.delete(k); });
  state.inflight.set(k, run);
  return run;
}

async function fetchLive(ctx, partners, settings) {
  const t0 = performance.now();
  const c = await within(pickChannel(ctx, settings?.channel).catch(() => ({ problem: "slow" })), timing.callMs, { problem: "slow" });
  if (c.problem === "slow") return { state: "error", reason: "network" };
  if (c.problem) return { state: "not_ready", reason: c.problem, ...(c.adminPath ? { adminPath: c.adminPath } : {}) };
  const list = withoutChannel(dedupe(partners.map((p, pos) => ({ ...p, pos }))), c.channel);
  if (!list.length) return { state: "ok", mode: "full", live: [], listed: 0 };
  const key = ctx.instance.key, run = { closed: false, fatal: false }, results = [];
  await pool(chunk(list, packetSize(key)), async (group) => {
    const r = await lookup(ctx, c.channel, key, group, run);
    if (!run.closed) results.push(r);
  }, timing.concurrency, Math.max(0, timing.callMs - (performance.now() - t0)), run);
  const done = results.slice(), checked = done.reduce((n, r) => n + r.checked, 0);   // une copie : ce qui arrive après la borne n'entre pas
  if (!checked) return failure(done.map((r) => r.error).filter(Boolean));
  const byLogin = new Map();
  for (const r of done) for (const x of r.live) if (!byLogin.has(x.login)) byLogin.set(x.login, x);
  const unchecked = list.length - checked;
  return { state: "ok", mode: "full", live: [...byLogin.values()], listed: list.length, ...(unchecked > 0 ? { partial: unchecked } : {}) };
}

/**
 * Les partenaires en direct. Rend toujours un objet, sans jamais lever ni attendre plus de `timing.callMs` :
 *   { state: "no_partners" } · { state: "not_ready", reason } · { state: "ok", mode: "full", live: [...], listed, asOf, partial? }
 *   · { state: "ok", mode: "random", listed, live: [] }   (plus de 500 chaînes : aucune demande à Twitch, c'est la recherche au hasard qui sert)
 *   · { state: "error", reason, stale?: { live, listed, asOf, partial? } }   (`stale` : la dernière liste connue, si elle date de moins de 10 minutes)
 * `partial` : combien de chaînes n'ont pas pu être vérifiées (un paquet en erreur).
 */
export async function liveNow(ctx, partners, settings = {}) {
  if (!partners.length) return { state: "no_partners" };
  if (modeFor(partners.length) === "random") return { state: "ok", mode: "random", listed: partners.length, live: [] };
  const k = `${ctx.instance.key}|${String(settings.channel ?? "").toLowerCase()}|${partners.map((p) => p.login).join(",")}`;
  const hit = state.cache.get(k);
  if (hit && hit.until > Date.now()) return hit.value;
  const decorate = (value) => {
    const now = Date.now();
    for (const m of [state.cache, state.good]) for (const other of m.keys()) if (other !== k && other.startsWith(`${ctx.instance.key}|`)) m.delete(other);   // une liste modifiée : l'ancienne n'a plus lieu d'être
    if (value.state === "ok") { value = { ...value, asOf: now }; state.good.set(k, value); }
    else if (value.state === "error") {
      const g = state.good.get(k);
      if (g && now - g.asOf <= timing.staleMs) value = { ...value, stale: { live: g.live, listed: g.listed, asOf: g.asOf, ...(g.partial ? { partial: g.partial } : {}) } };
    }
    // un résultat partiel est refait plus vite (15 s) : les chaînes manquantes reviennent dès que Twitch répond
    state.cache.set(k, { value, until: now + (value.state === "ok" && !value.partial ? timing.okMs : timing.failMs) });
    return value;
  };
  return share(k, () => fetchLive(ctx, partners, settings), () => ({ state: "error", reason: "network" }), decorate, timing.callMs + 1000);
}
