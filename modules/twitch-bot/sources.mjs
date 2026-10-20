// Ce que le bot lit chez les autres modules — jamais de copie : le direct et les followers (Chaîne Twitch), le prochain stream (les agendas de streams, ou le Planning), les fiches des partenaires (Sponsors),
// les liens des réseaux (modules de réseaux sociaux). Chaque lecture est facultative : un module absent donne « indisponible », jamais une erreur.
// Les lectures sont gardées quelques secondes (un chat animé ne doit pas faire travailler les autres modules à chaque message).
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { stripScheme } = await import(`./commands.mjs${v}`);

const TTL = 15_000;
/** Millisecondes, dans un objet pour que les tests puissent les raccourcir. collectMs : la lecture des streams chez les agendas (un agenda qui ne répond pas ne doit jamais retenir une commande du chat). */
export const timing = { collectMs: 5000 };
const within = (p, ms, fallback) => { let timer; const late = new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), ms); timer.unref?.(); }); return Promise.race([p, late]).finally(() => clearTimeout(timer)); };
const cache = new Map();
export const resetSources = () => cache.clear();
async function cached(ctx, name, load, ttl = TTL) {
  const k = `${ctx.instance.key}|${name}`;
  const hit = cache.get(k);
  if (hit && hit.until > Date.now()) return hit.value;
  let value;
  try { value = await load(); } catch { value = null; }
  // Une lecture qui n'a rien donné (module qui démarre, chiffre pas encore relevé) n'est gardée que quelques secondes : on ne reste pas « indisponible » un quart de minute pour rien.
  cache.set(k, { value, until: Date.now() + (value === null || value === undefined ? 3_000 : ttl) });
  return value;
}

/* ───────────── Twitch : le direct et les followers ───────────── */

/** L'état du direct de la chaîne : { known, live, title, game, startedAt } ou null (Chaîne Twitch absente ou muette). Une chaîne = une instance de Chaîne Twitch qui répond pour elle-même. */
export const liveState = (ctx, channel) => cached(ctx, `live|${channel}`, async () => {
  const all = await ctx.api.services.callAll("twitch.live", "status", {});
  const mine = all.find((r) => r.ok && r.value?.channel === channel);
  if (!mine) return null;
  const v = mine.value;
  return { known: v.known === true, live: v.live === true, title: v.title ?? null, game: v.game ?? null, startedAt: v.startedAt ?? null };
});

/** Le nombre de followers publié par Chaîne Twitch (chiffre `followers` de la chaîne), ou null s'il n'est pas disponible (suivi des statistiques éteint, chaîne non connectée…). */
export const followersCount = (ctx, channel) => cached(ctx, `followers|${channel}`, async () => {
  const items = await ctx.api.topics.collect("social.stat", { limit: 200 });
  const row = items.find((s) => s.platform === "twitch" && s.metric === "followers" && String(s.account ?? "").toLowerCase() === channel && Number.isInteger(s.value) && !s.error);
  return row ? row.value : null;
});

/* ───────────── Planning ───────────── */

const hasInstance = async (ctx, ...modules) => {
  for (const module of modules) if ((await ctx.api.instances.list({ module })).length > 0) return true;
  return false;
};

/**
 * { installed, next } : `next` = { start (Date), title, allDay } du prochain stream annoncé, ou null. Les streams viennent du sujet `planning.slot`, que fournissent les agendas de
 * streams (Agenda en ligne, Streams saisis à la main) : un agenda suffit, le Planning n'est pas nécessaire. Un stream annulé n'est jamais annoncé.
 */
export const planning = (ctx) => cached(ctx, "planning", async () => {
  if (!(await hasInstance(ctx, "calendar-ical", "calendar-manual", "planning"))) return { installed: false, next: null };
  const slots = await within(Promise.resolve().then(() => ctx.api.topics.collect("planning.slot", { limit: 50 })).catch(() => []), timing.collectMs, []);
  const now = Date.now();
  const future = slots.filter((s) => s.status !== "cancelled").map((s) => ({ start: new Date(s.start), title: s.title ?? "", allDay: s.allDay === true })).filter((s) => Number.isFinite(s.start.getTime()) && s.start.getTime() > now).sort((a, b) => a.start - b.start);
  return { installed: true, next: future[0] ?? null };
});

/* ───────────── Partenaires (Sponsors) ───────────── */

/** { installed, items: [{ id, title, slug, path, address, instance }] } — les fiches PUBLIÉES de toutes les instances de Sponsors. `ok: false` si la lecture a échoué (on ne retire alors rien). */
export const partners = (ctx) => cached(ctx, "partners", async () => {
  const instances = await ctx.api.instances.list({ module: "sponsors" });
  const site = String(ctx.api.siteUrl ?? "").replace(/\/+$/, "");
  const items = [];
  for (const inst of instances) {
    for (const e of await ctx.api.entries.list({ instance: inst.key, limit: 200 })) {
      if (!e?.id || !e.path) continue;
      items.push({ id: String(e.id), title: String(e.title ?? "").slice(0, 120) || String(e.slug ?? ""), slug: String(e.slug ?? ""), path: String(e.path), address: stripScheme(`${site}${e.path}`), instance: inst.key, instanceName: inst.name });
    }
  }
  return { installed: instances.length > 0, ok: true, items };
}).then((v) => v ?? { installed: false, ok: false, items: [] });

/* ───────────── Réseaux sociaux ───────────── */

const NAME_FROM_LABEL = (label) => String(label ?? "").split("·")[0].trim().slice(0, 40);
/** { items: [{ key (instance du module de réseau), module, name, label, url, adminPath }], ok } — un lien par module de réseau actif ET réglé (un module sans adresse ne fournit rien). */
export const networks = (ctx) => cached(ctx, "networks", async () => {
  const links = await ctx.api.topics.collect("social.link", { limit: 100 });
  // Où régler l'adresse de chaque réseau : la page de réglages de son instance (le cœur la donne, `adminPath`) ; absente = simplement pas de lien.
  const adminPaths = new Map((await ctx.api.instances.list().catch(() => [])).map((i) => [i.key, typeof i.adminPath === "string" && i.adminPath.startsWith("/admin/") ? i.adminPath : null]));
  const items = [];
  for (const l of links) {
    const instance = l.source?.instance;
    if (!instance || !/^https:\/\//i.test(l.url ?? "")) continue;
    const name = NAME_FROM_LABEL(l.label) || String(l.source?.name ?? instance);
    items.push({ key: String(instance), module: String(l.source?.module ?? ""), name, label: String(l.label ?? name), url: String(l.url), adminPath: adminPaths.get(String(instance)) ?? null });
  }
  return { ok: true, items };
}).then((v) => v ?? { ok: false, items: [] });

/** Tout ce qu'il faut pour construire le catalogue des commandes (voir commands.mjs). `channel` : la chaîne du bot, pour les followers. */
export async function gather(ctx, channel) {
  const [p, n, pl, f] = await Promise.all([partners(ctx), networks(ctx), planning(ctx), channel ? followersCount(ctx, channel) : null]);
  return { partners: p, networks: n, planning: pl ?? { installed: false, next: null }, followers: { available: Number.isInteger(f), value: f } };
}
