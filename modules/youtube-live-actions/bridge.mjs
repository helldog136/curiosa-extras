// Les services dont le module a besoin, appelés avec prudence : tous facultatifs, tous bornés, aucun ne lève jamais.
//   home-assistant.bridge  les ordres pour la maison (enqueue), le coupe-circuit (stop/start), l'état (status)
//   youtube.api            la lecture du chat et de la limite du jour (connecteur YouTube)
//   youtube.live           « la chaîne est-elle en direct, quel chat ? » (Chaîne YouTube)
// Ce module ne connaît ni entité, ni script, ni média de la maison : seulement des noms d'action (« lumieres:rouge », « tts:lire »).
export const BRIDGE = "home-assistant.bridge", API = "youtube.api", LIVE = "youtube.live";
/** Les refus du pont (liste fermée de son contrat), plus nos deux cas : service absent, panne. */
export const REASONS = ["off", "offline", "not_live", "blocked", "busy", "unknown_key", "not_paired", "not_installed", "error"];
export const timing = { callMs: 3000, apiMs: 12_000 };

export const within = (p, ms, fallback) => {
  let t;
  return Promise.race([Promise.resolve(p).catch(() => fallback), new Promise((r) => { t = setTimeout(() => r(fallback), ms); t.unref?.(); })]).finally(() => clearTimeout(t));
};
const NONE = { ok: false, reason: "unavailable" };
const fail = (error) => ({ ok: false, error });
async function call(ctx, service, method, args, ms, opts) {
  try {
    const r = await within(ctx.api.services.call(service, method, args, opts), ms, NONE);
    return r && typeof r === "object" ? r : NONE;
  } catch { return NONE; }
}
export async function installed(ctx, service) {
  try { return (await within(ctx.api.services.providers(service), timing.callMs, [])).length > 0; } catch { return false; }
}

/** Appelle `home-assistant.bridge.<méthode>` : { ok: true, value } ou { ok: false, reason: "unavailable" }. */
export const bridge = (ctx, method, args) => call(ctx, BRIDGE, method, args, timing.callMs);
/** Un ordre pour la maison : { ok: true, id } ou { ok: false, reason } avec reason ∈ REASONS. */
export async function enqueue(ctx, args) {
  const r = await bridge(ctx, "enqueue", args);
  if (!r.ok) return { ok: false, reason: "not_installed" };
  const v = r.value;
  if (v && v.ok === true) return { ok: true, id: String(v.id ?? "").slice(0, 80) };
  return { ok: false, reason: v && REASONS.includes(v.reason) ? v.reason : "error" };
}
/** L'état de la maison : { installed: false } ou { installed: true, enabled, paired, live, lastSeenAt, queued } (aucun secret). */
export async function houseStatus(ctx) {
  if (!(await installed(ctx, BRIDGE))) return { installed: false };
  const r = await bridge(ctx, "status", {});
  const v = r.ok && r.value && typeof r.value === "object" ? r.value : null;
  if (!v) return { installed: true, known: false };
  return { installed: true, known: true, enabled: v.enabled !== false, paired: v.paired === true, live: v.live === true, lastSeenAt: typeof v.lastSeenAt === "string" ? v.lastSeenAt : null, queued: Math.max(0, Math.trunc(Number(v.queued)) || 0) };
}

/** Un appel du connecteur YouTube : sa réponse ({ ok, … }), ou { ok: false, error: "unavailable" | "timeout" }. */
export async function youtube(ctx, method, args) {
  const r = await call(ctx, API, method, args, timing.apiMs);
  if (!r.ok) return fail("unavailable");
  return r.value && typeof r.value === "object" ? r.value : fail("network");
}

/** À quelle chaîne parle-t-on ? { id } (le fournisseur de `youtube.live` à interroger) ou { code: "none" | "ambiguous" | "unverified" }. */
export async function channelOf(ctx) {
  let r;
  try { r = await within(ctx.resolveChoice("channel"), 3500, { status: "unverified" }); } catch { r = { status: "unverified" }; }
  const st = r?.status;
  if ((st === "chosen" || st === "only" || st === "missing") && typeof r.id === "string" && r.id) return { id: r.id };
  return { code: st === "none" ? "none" : st === "ambiguous" || st === "missing" ? "ambiguous" : "unverified" };
}
/** Le direct en cours de la chaîne choisie : la réponse de `youtube.live.current`, ou { ok: false, error }. */
export async function currentLive(ctx, provider, args = {}) {
  const r = await call(ctx, LIVE, "current", args, timing.apiMs, { provider });
  if (!r.ok) return fail("unavailable");
  return r.value && typeof r.value === "object" ? r.value : fail("network");
}
