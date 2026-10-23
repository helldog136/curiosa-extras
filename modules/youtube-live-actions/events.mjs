// Les dons et adhésions vus dans le chat, mis à la disposition des autres modules (sujet `live.event`) : l'overlay d'alertes (OBS) les affiche.
//
// Ce module reste le seul propriétaire de ces données : il les PUBLIE, il ne sait pas qui les lit. Rien n'est écrit sur le disque : une petite file en MÉMOIRE (50 évènements au plus par
// instance, 15 minutes de vie, purgée à chaque lecture), donc rien à effacer, rien à sauvegarder, et le texte d'un message de spectateur n'est jamais gardé durablement
// (le journal, lui, n'a jamais le texte). Pas de minuteur : la file ne bouge que lorsqu'un tour de lecture du chat voit un don, et ne se vide qu'en étant lue.
//
// Forme publiée (identique pour tous les lecteurs) :
//   { id, platform: "youtube", kind: "superchat" | "supersticker" | "member" | "gift", who, at (ISO), amount?, currency?, count?, text? }
//   - `id` : empreinte du message YouTube (jamais l'identifiant lui-même), stable : un lecteur s'en sert pour ne montrer chaque alerte qu'une fois ;
//   - `amount` (nombre, unité principale : 5 = 5 €) n'existe QUE avec `currency` (code à 3 lettres) : jamais de montant sans devise, jamais de conversion ;
//   - `count` : nombre d'adhésions offertes ; `text` : le message d'un Super Chat (nettoyé, 300 caractères au plus), à afficher en texte brut, jamais en HTML.
export const LIMITS = { keep: 50, ttlMs: 15 * 60_000, instances: 20 };
const KINDS = new Set(["superchat", "supersticker", "member", "gift"]);

const files = (globalThis.__curiosaYtLiveEvents ??= new Map());   // clé d'instance → [évènement, du plus ancien au plus récent]
export const resetEvents = () => files.clear();

/** Un évènement lu dans le chat (voir chat.mjs) → la forme publiée, ou null. `fp` : son empreinte. */
export function publicForm(ev, fp) {
  if (!ev || !KINDS.has(ev.kind) || typeof fp !== "string" || !fp) return null;
  const out = { id: `yt-${fp}`, platform: "youtube", kind: ev.kind, who: String(ev.who ?? "?").slice(0, 40), at: new Date(Number.isFinite(ev.at) ? ev.at : Date.now()).toISOString() };
  if (ev.kind === "superchat" || ev.kind === "supersticker") {
    const currency = String(ev.currency ?? "");
    if (!/^[A-Z]{3}$/.test(currency) || !Number.isFinite(ev.micros) || ev.micros < 0) return null;   // pas de montant sans devise
    out.amount = Number((ev.micros / 1e6).toFixed(6)); out.currency = currency;
    if (ev.kind === "superchat" && ev.text) out.text = String(ev.text).slice(0, 300);
  } else if (ev.kind === "gift") {
    if (!Number.isInteger(ev.count) || ev.count < 1) return null;
    out.count = ev.count;
  }
  return out;
}

/** Garde un évènement pour les lecteurs. Les anciens partent ; une même alerte n'est gardée qu'une fois. */
export function remember(ctx, ev, fp, now = Date.now()) {
  const item = publicForm(ev, fp);
  if (!item) return false;
  const k = ctx.instance.key;
  const list = (files.get(k) ?? []).filter((x) => now - (x.rememberedAt ?? 0) < LIMITS.ttlMs);
  if (list.some((x) => x.id === item.id)) { files.set(k, list); return false; }
  list.push({ ...item, rememberedAt: now });
  files.delete(k); files.set(k, list.slice(-LIMITS.keep));
  while (files.size > LIMITS.instances) files.delete(files.keys().next().value);
  return true;
}

/** Les évènements encore valables, du plus récent au plus ancien, `limit` au plus (50). Purge ce qui a expiré. */
export function recent(ctx, { limit = LIMITS.keep, now = Date.now() } = {}) {
  const k = ctx.instance.key;
  const list = (files.get(k) ?? []).filter((x) => now - (x.rememberedAt ?? 0) < LIMITS.ttlMs);
  if (list.length) files.set(k, list); else files.delete(k);
  const asked = Math.trunc(Number(limit));
  const n = asked >= 1 ? Math.min(LIMITS.keep, asked) : LIMITS.keep;
  return list.slice(-n).reverse().map(({ rememberedAt, ...item }) => item);
}
