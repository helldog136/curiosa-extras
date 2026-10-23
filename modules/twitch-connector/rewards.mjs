// Les appels aux points de chaîne (récompenses personnalisées) permis aux autres modules, avec le jeton DE LA CHAÎNE (jamais celui d'un compte bot).
// Chaque appel a une forme de requête et de corps fermée et bornée. Les détails de Twitch non vérifiés sont listés en tête de modules/twitch-bot/eventsub.mjs.
export const SCOPE = "channel:manage:redemptions";
const digits = (x) => /^[0-9]{1,20}$/.test(x);
const rid = (x) => /^[A-Za-z0-9-]{8,64}$/.test(x);
const single = (test) => (v) => v.length === 1 && test(v[0]);
/** Clés exactes : broadcaster_id obligatoire, le reste au choix. */
const query = (opt = {}) => (q) => {
  const keys = Object.keys(q);
  if (!keys.includes("broadcaster_id") || !single(digits)(q.broadcaster_id)) return false;
  return keys.every((k) => k === "broadcaster_id" || (k in opt && opt[k](q[k])));
};
const only = (obj, allowed) => Object.keys(obj).every((k) => k in allowed && allowed[k](obj[k]));
const int = (min, max) => (x) => Number.isInteger(x) && x >= min && x <= max;
const text = (max) => (x) => typeof x === "string" && x.length <= max;
const bool = (x) => typeof x === "boolean";
const FIELDS = {
  title: (x) => typeof x === "string" && x.length >= 1 && x.length <= 45, cost: int(1, 1_000_000_000), prompt: text(200), is_enabled: bool, is_paused: bool, is_user_input_required: bool,
  is_global_cooldown_enabled: bool, global_cooldown_seconds: int(1, 604_800), should_redemptions_skip_request_queue: bool,
};

const BASE = "channel_points/custom_rewards";
/** route → [autorisations, forme de la requête, validation du corps (absente = pas de corps permis)] */
export const REWARD_ROUTES = new Map([
  [`GET ${BASE}`, [[SCOPE], query({ only_manageable_rewards: single((x) => x === "true"), id: single(rid) })]],
  [`POST ${BASE}`, [[SCOPE], query(), (b) => typeof b.title === "string" && int(1, 1e9)(b.cost) && only(b, FIELDS)]],
  [`PATCH ${BASE}`, [[SCOPE], (q) => query({ id: single(rid) })(q) && !!q.id, (b) => Object.keys(b).length > 0 && only(b, FIELDS)]],
  [`DELETE ${BASE}`, [[SCOPE], (q) => query({ id: single(rid) })(q) && !!q.id]],
  [`PATCH ${BASE}/redemptions`, [[SCOPE], (q) => {
    const ok = Object.keys(q).every((k) => ["id", "broadcaster_id", "reward_id"].includes(k)) && q.id && q.broadcaster_id && q.reward_id;
    return !!ok && single(rid)(q.id) && single(digits)(q.broadcaster_id) && single(rid)(q.reward_id);
  }, (b) => Object.keys(b).length === 1 && (b.status === "FULFILLED" || b.status === "CANCELED")]],
]);
