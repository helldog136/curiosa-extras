// Compter les clics sans rien savoir des visiteurs, et sans jamais faire attendre la redirection.
//
// Ce qui est gardé : un nombre par lien et par jour. Ni cookie, ni adresse IP, ni navigateur, ni provenance.
// Comment : le clic est noté en mémoire et la redirection part tout de suite ; une écriture en arrière-plan (jamais plus d'une à la fois
// par lien, pas de verrou, pas de minuteur) ajoute au total les clics arrivés pendant la précédente. Mille clics d'un coup font donc
// quelques écritures, pas mille, et aucun n'est perdu tant que le site tourne.
//
// Ce qui est aussi en mémoire (et seulement là, jamais écrit) : un compteur par visiteur, sous forme d'empreinte salée qui change à chaque
// démarrage, pour ne pas laisser un script gonfler les chiffres (30 clics comptés par minute et par visiteur) ; et une petite réserve des
// liens lus récemment, pour qu'une vague de visiteurs ne relise pas le stockage à chaque clic.
import { createHash, randomBytes } from "node:crypto";
import { addClicks, linkBySlug } from "./data.mjs";
import { today } from "./url.mjs";

const SALT = randomBytes(16);
const CACHE_MS = 5_000;
const COUNT_PER_MINUTE = 30;
const MAX_PENDING = 500;

/** @type {Map<string, { cache: Map<string, { at: number, link: object | null }>, pending: Map<string, { days: Map<string, number>, running: Promise<void> | null }>, visitors: Map<string, { since: number, n: number }> }>} */
const states = new Map();

function state(ctx) {
  const id = String(ctx.instance.id ?? ctx.instance.key);
  let st = states.get(id);
  if (!st) {
    st = { cache: new Map(), pending: new Map(), visitors: new Map() };
    states.set(id, st);
  }
  return st;
}

/** Oublie tout ce qui est en mémoire pour une instance (suppression de l'instance, tests). */
export function forgetInstance(ctx) {
  states.delete(String(ctx.instance.id ?? ctx.instance.key));
}

/** Empreinte salée d'un visiteur : sert uniquement à limiter le nombre de clics comptés, elle n'est jamais écrite nulle part. */
export const visitorKey = (ip) => createHash("sha256").update(SALT).update(String(ip ?? "")).digest("base64url").slice(0, 16);

/** Ce clic doit-il être compté ? (30 par minute et par visiteur au plus.) La redirection, elle, n'est jamais refusée. */
export function mayCount(ctx, visitor, now = Date.now()) {
  const st = state(ctx);
  const cur = st.visitors.get(visitor);
  if (!cur || now - cur.since >= 60_000) {
    st.visitors.set(visitor, { since: now, n: 1 });
    if (st.visitors.size > 5000) for (const [k, v] of st.visitors) if (now - v.since >= 60_000) st.visitors.delete(k);
    return true;
  }
  cur.n++;
  return cur.n <= COUNT_PER_MINUTE;
}

/** Robots, aperçus de messagerie, outils de contrôle : ils ne sont pas des personnes qui cliquent. */
const ROBOTS = /bot|crawl|spider|slurp|preview|fetch|monitor|headless|check|probe|scan|validator|lighthouse|pingdom|uptime|curl|wget|python|httpclient|axios|java\/|libwww|go-http|okhttp|facebookexternalhit|whatsapp|telegram|discord|slack|skype|twitter|linkedin|pinterest|embedly|quora|vkshare|outbrain/i;
export function looksLikeRobot(request) {
  const ua = request.headers.get("user-agent") ?? "";
  if (!ua || ua.length < 12 || ROBOTS.test(ua)) return true;
  const purpose = `${request.headers.get("sec-purpose") ?? ""} ${request.headers.get("purpose") ?? ""} ${request.headers.get("x-moz") ?? ""}`;
  return /prefetch|prerender|preview/i.test(purpose);
}

// ── Lecture d'un lien, avec une petite réserve ───────────────────────────────────────────────────────────────────────────────
export async function cachedLink(ctx, slug, now = Date.now()) {
  const st = state(ctx);
  const hit = st.cache.get(slug);
  if (hit && now - hit.at < CACHE_MS) return hit.link;
  const link = await linkBySlug(ctx, slug);
  st.cache.set(slug, { at: now, link });
  if (st.cache.size > 600) for (const k of [...st.cache.keys()].slice(0, 150)) st.cache.delete(k);
  return link;
}

/** À appeler quand un lien change ou disparaît : la réserve ne doit pas servir l'ancienne destination. */
export const forgetLink = (ctx, slug) => state(ctx).cache.delete(slug);

// ── Les clics ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Note un clic. Ne rend rien et n'attend rien : l'écriture se fait derrière. */
export function recordClick(ctx, linkId, now = Date.now()) {
  const st = state(ctx);
  let entry = st.pending.get(linkId);
  if (!entry) {
    if (st.pending.size >= MAX_PENDING) return; // des centaines de liens en attente d'écriture en même temps : on préfère perdre un clic que la mémoire
    entry = { days: new Map(), running: null };
    st.pending.set(linkId, entry);
  }
  const day = today(now);
  entry.days.set(day, (entry.days.get(day) ?? 0) + 1);
  if (!entry.running) entry.running = flush(ctx, st, linkId, entry);
}

async function flush(ctx, st, linkId, entry) {
  try {
    while (entry.days.size) {
      const batch = new Map(entry.days);
      entry.days.clear();
      try {
        await addClicks(ctx, linkId, batch);
      } catch {
        for (const [day, n] of batch) entry.days.set(day, (entry.days.get(day) ?? 0) + n); // on les garde pour le prochain clic
        console.error("[short-links] les clics n'ont pas pu être enregistrés (ils le seront au prochain passage)");
        break;
      }
    }
  } finally {
    entry.running = null;
    if (!entry.days.size) st.pending.delete(linkId);
  }
}

/** Attend que les clics notés pour ce lien (ou tous) soient écrits. Sert à l'administration (chiffres à jour) et aux tests. */
export async function settle(ctx, linkId) {
  const st = state(ctx);
  const entries = linkId ? [st.pending.get(linkId)] : [...st.pending.values()];
  await Promise.all(entries.filter(Boolean).map((e) => e.running));
}

/** Retire les clics en attente d'un lien supprimé, après avoir laissé finir l'écriture en cours. */
export async function dropPending(ctx, linkId) {
  const st = state(ctx);
  const entry = st.pending.get(linkId);
  if (entry) {
    entry.days.clear();
    await entry.running;
  }
  st.pending.delete(linkId);
}
