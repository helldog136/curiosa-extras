// Qui est en direct parmi les partenaires, maintenant. Les données viennent de Chaîne Twitch (service `twitch.api`, qui garde les jetons) : ce fichier ne parle jamais à Twitch directement.
// Règles de ce fichier :
//   - UN seul appel groupé par actualisation (jusqu'à 100 chaînes), gardé 30 s : dix docks ouverts, ou dix onglets, ne font qu'un appel à Twitch ;
//   - AUCUNE attente sans borne : une demande qui ne répond pas est abandonnée après `timing.callMs`, tout le monde reçoit alors « Twitch ne répond pas » et la demande suivante repart de zéro ;
//   - quand Twitch est en panne, on garde sous la main la dernière liste connue (10 minutes au plus) pour que le dock ne se vide pas pour une coupure de quelques secondes.
const SERVICE = "twitch.api";
/** Les délais (en millisecondes). Un objet pour que les tests puissent les raccourcir. */
export const timing = { callMs: 8000, okMs: 30_000, failMs: 15_000, staleMs: 10 * 60_000 };
const state = { cache: new Map(), inflight: new Map(), good: new Map() };
export const resetLive = () => { for (const m of Object.values(state)) m.clear(); };

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

const usable = (r) => r.ok && r.value && r.value.ok !== false && r.value.error !== "other_channel";
const str = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max) : "");

/** La chaîne Twitch du site à interroger : celle des réglages avancés, sinon la première prête. { problem } ou { channel }. */
export async function pickChannel(ctx, wanted) {
  const all = (await ctx.api.services.callAll(SERVICE, "account", {})).filter(usable).map((r) => r.value);
  if (!all.length) return { problem: "no_channel" };
  const w = str(wanted, 40).toLowerCase();
  const mine = w ? all.find((a) => a.channel === w) : all.find((a) => a.ready && a.channel) ?? all[0];
  if (!mine) return { problem: "channel_unknown" };
  if (!mine.channel || !mine.ready) return { problem: "setup", adminPath: typeof mine.adminPath === "string" ? mine.adminPath : null };
  return { channel: mine.channel };
}

/** Ce que Twitch répond (GET streams) → les partenaires en direct, ou rien d'exploitable (null). Aucune confiance : tout est vérifié, coupé et ne contient aucun HTML. */
export function readStreams(json, partners) {
  if (!json || !Array.isArray(json.data)) return null;
  const byLogin = new Map(partners.map((p, pos) => [p.login, { p, pos }]));
  const seen = new Set(), live = [];
  for (const s of json.data) {
    const login = str(s?.user_login, 40).toLowerCase();
    const mine = byLogin.get(login);
    if (!mine || seen.has(login) || s.type !== "live") continue;
    const startedAt = Date.parse(s.started_at);
    if (!Number.isInteger(s.viewer_count) || s.viewer_count < 0 || !Number.isFinite(startedAt)) continue;
    seen.add(login);
    live.push({ login, name: mine.p.name || str(s.user_name, 40) || login, game: str(s.game_name, 100), title: str(s.title, 140), viewers: s.viewer_count, startedAt, pos: mine.pos });
  }
  return live;
}

async function fetchLive(ctx, partners, settings) {
  const c = await pickChannel(ctx, settings?.channel);
  if (c.problem) return { state: "not_ready", reason: c.problem, ...(c.adminPath ? { adminPath: c.adminPath } : {}) };
  const logins = partners.map((p) => p.login);
  const answers = await ctx.api.services.callAll(SERVICE, "request", { as: "app", method: "GET", path: "streams", query: { user_login: logins, first: 100 }, channel: c.channel });
  const r = answers.find(usable) ?? answers.find((x) => x.ok && x.value);
  if (!r?.value) return { state: "error", reason: "network" };
  const v = r.value;
  if (v.ok === false) {
    if (v.error === "config" || v.error === "auth") return { state: "not_ready", reason: "refused" };
    if (v.error === "forbidden" || v.error === "invalid") return { state: "not_ready", reason: "outdated" };
    return { state: "error", reason: v.error === "rate" ? "rate" : "network" };
  }
  if (v.status !== 200) return { state: "error", reason: "twitch" };
  const live = readStreams(v.json, partners);
  return live ? { state: "ok", live, listed: partners.length } : { state: "error", reason: "twitch" };
}

/**
 * Les partenaires en direct. Rend toujours un objet, sans jamais lever ni attendre plus de `timing.callMs` :
 *   { state: "no_partners" } · { state: "not_ready", reason } · { state: "ok", live: [...], listed, asOf }
 *   · { state: "error", reason, stale?: { live, listed, asOf } }   (`stale` : la dernière liste connue, si elle date de moins de 10 minutes)
 */
export async function liveNow(ctx, partners, settings = {}) {
  if (!partners.length) return { state: "no_partners" };
  const k = `${ctx.instance.key}|${String(settings.channel ?? "").toLowerCase()}|${partners.map((p) => p.login).join(",")}`;
  const hit = state.cache.get(k);
  if (hit && hit.until > Date.now()) return hit.value;
  const decorate = (value) => {
    const now = Date.now();
    for (const m of [state.cache, state.good]) for (const other of m.keys()) if (other !== k && other.startsWith(`${ctx.instance.key}|`)) m.delete(other);   // une liste modifiée : l'ancienne n'a plus lieu d'être
    if (value.state === "ok") { value = { ...value, asOf: now }; state.good.set(k, value); }
    else if (value.state === "error") {
      const g = state.good.get(k);
      if (g && now - g.asOf <= timing.staleMs) value = { ...value, stale: { live: g.live, listed: g.listed, asOf: g.asOf } };
    }
    state.cache.set(k, { value, until: now + (value.state === "ok" ? timing.okMs : timing.failMs) });
    return value;
  };
  return share(k, () => fetchLive(ctx, partners, settings), () => ({ state: "error", reason: "network" }), decorate, timing.callMs);
}
