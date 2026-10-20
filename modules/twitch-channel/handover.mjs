// Passage au Connecteur Twitch (« Ma Chaîne Twitch » 2.0, données en version 2). Avant, cette instance gardait elle-même l'application Twitch
// (identifiant, secret : devenus des réglages masqués, `legacySettings`), une copie des identifiants d'une autre chaîne (« borrowed »), une reprise
// venue de « Statut live » (« adopted ») et les autorisations de la chaîne et du compte bot (twitchConnection, twitchBotConnection).
// Tout cela est confié au Connecteur par son service (`adopt`), SANS ressaisie : les valeurs ne passent qu'en mémoire, ne sont jamais affichées, journalisées
// ni renvoyées. On n'efface ici (ctx.legacy.clear, documents) qu'APRÈS la confirmation du Connecteur (`ready`). Sinon rien n'est effacé et on réessaie
// à l'ouverture de l'administration et pendant la tâche planifiée. Rejouable sans risque (idempotent).
const version = new URL(import.meta.url).search;
const connect = await import(new URL(`./connect.mjs${version}`, import.meta.url).href);

export const OLD = { main: "twitchConnection", bot: "twitchBotConnection", pending: "twitchPending", result: "twitchResult", wants: "twitchWants", borrowed: "borrowed" };
export const ADOPTED = "adopted";
export const MARK = "handover";
export const LEGACY_KEYS = ["clientId", "clientSecret", "useCredentialsOf"];
const LOGIN = /^[a-zA-Z0-9_]{3,25}$/;
const text = (v) => (typeof v === "string" ? v.trim() : "");
const all = async (ctx, col) => { try { return await ctx.api.store.list(col, { limit: 20 }); } catch { return []; } };
const first = async (ctx, col) => (await all(ctx, col))[0] ?? null;
async function legacy(ctx, key) {
  try { const v = await ctx.legacy?.get(key); return typeof v === "string" ? v.trim() : ""; } catch { return ""; }
}

/** Ce que l'instance avait avant la 2.0 (en mémoire seulement). Priorité, champ par champ : le réglage de l'instance, la copie d'une autre chaîne, la reprise de « Statut live ». */
async function gather(ctx) {
  const a = (await first(ctx, ADOPTED))?.data ?? {};
  const b = (await first(ctx, OLD.borrowed))?.data ?? {};
  const clientId = (await legacy(ctx, "clientId")) || text(b.clientId) || text(a.clientId);
  const secret = (await legacy(ctx, "clientSecret")) || text(b.clientSecret) || text(a.clientSecret);
  const channel = (text(ctx.setting("channel")) || text(a.channel)).toLowerCase();
  const conns = [];
  for (const slot of ["main", "bot"]) {
    const d = (await first(ctx, OLD[slot]))?.data;
    if (d?.access && d?.refresh) conns.push({ slot, login: d.login, userId: d.userId, accessToken: d.access, refreshToken: d.refresh, scopes: d.scopes ?? [], expiresAt: d.expiresAt, clientId: d.clientId, status: d.status, connectedAt: d.connectedAt });
  }
  const wants = (await all(ctx, OLD.wants)).map((d) => ({ consumer: d.data.consumer, slot: d.data.slot, scopes: d.data.scopes, returnTo: d.data.returnTo }));
  // l'adresse de retour de cette instance n'est connue de Twitch que si la connexion a déjà servi (un compte connecté, ou une tentative)
  const usedOAuth = conns.length > 0 || (await all(ctx, OLD.pending)).length > 0 || (await all(ctx, OLD.result)).length > 0 || !!(await first(ctx, OLD.main)) || !!(await first(ctx, OLD.bot));
  return { channel: LOGIN.test(channel) ? channel : "", clientId, secret, conns, wants, usedOAuth };
}

/** Efface ce qui a été confié au Connecteur : réglages masqués, documents de connexion, copies. La chaîne reprise de « Statut live » reste (elle n'est pas un secret). */
async function cleanup(ctx) {
  for (const k of LEGACY_KEYS) { try { if (ctx.legacy && (await ctx.legacy.get(k)) !== null) await ctx.legacy.clear(k); } catch { /* clé absente d'un cœur plus ancien */ } }
  for (const col of Object.values(OLD)) for (const d of await all(ctx, col)) await ctx.api.store.remove(d.id);
  const a = await first(ctx, ADOPTED);
  if (a) {
    const channel = text(a.data.channel);
    if (channel) { if (a.data.clientId !== undefined || a.data.clientSecret !== undefined) await ctx.api.store.update(a.id, { channel }); }
    else await ctx.api.store.remove(a.id);
  }
}
async function mark(ctx, data) {
  const doc = await first(ctx, MARK);
  const next = { ...data, at: new Date().toISOString() };
  if (doc) { if (doc.data.state !== next.state || doc.data.relay !== next.relay) await ctx.api.store.update(doc.id, next); }
  else await ctx.api.store.add(MARK, next);
  return next;
}
export const stateOf = async (ctx) => (await first(ctx, MARK))?.data ?? null;

/**
 * Le passage, rejouable : { state: "done" | "pending" | "conflict", reason? }. Ne lève jamais pour « pas encore prêt » (Connecteur absent, application incomplète) :
 * rien n'est effacé tant que le Connecteur n'a pas confirmé. `conflict` : le Connecteur a déjà une AUTRE application Twitch ; la chaîne se reconnecte avec
 * celle du Connecteur (bouton habituel), puis les anciennes autorisations sont révoquées par le Connecteur et effacées ici.
 */
export async function handover(ctx) {
  const was = await stateOf(ctx);
  if (was?.state === "done") return was;
  const g = await gather(ctx);
  if (!g.clientId && !g.secret && !g.conns.length) {
    // rien à confier (jamais réglée, ou déjà fait) : on range seulement
    await cleanup(ctx);
    return mark(ctx, { state: "done", relay: !!was?.relay });
  }
  const relay = g.usedOAuth && !!g.channel;
  const r = await connect.call(ctx, "adopt", {
    clientId: g.clientId, clientSecret: g.secret, channel: g.channel || undefined, ...(relay ? { redirectUri: connect.redirectOf(ctx) } : {}),
    connections: g.channel ? g.conns : g.conns.filter((c) => c.slot === "main"), wants: g.wants,
  });
  if (!r.ok) return mark(ctx, { state: "pending", reason: connect.missingConnector(r) ? "connector" : "busy", relay: false });
  const v = r.value && typeof r.value === "object" ? r.value : {};
  if (v.error === "conflict") {
    if (g.channel) await connect.call(ctx, "register", { channel: g.channel });   // sans adresse : elle appartient à l'autre application
    const acc = g.channel ? await connect.call(ctx, "account", { channel: g.channel, slot: "main" }) : { ok: false };
    if (acc.ok && acc.value?.status === "ok") {
      // la chaîne a été reconnectée avec l'application du Connecteur : les anciennes autorisations ne servent plus, elles sont révoquées puis effacées
      const tokens = g.conns.flatMap((c) => [c.accessToken, c.refreshToken]).filter(Boolean);
      const oldApp = g.conns[0]?.clientId || g.clientId;
      if (tokens.length && oldApp) await connect.call(ctx, "retire", { clientId: oldApp, tokens });
      await cleanup(ctx);
      return mark(ctx, { state: "done", relay: false });
    }
    return mark(ctx, { state: "conflict", relay: false });
  }
  if (v.ready === true) { await cleanup(ctx); return mark(ctx, { state: "done", relay }); }
  return mark(ctx, { state: "pending", reason: "incomplete", relay: false });
}

/** Nouvel essai, au plus toutes les 10 minutes par instance (panneau d'administration, tâche planifiée). */
const lastTry = new Map();
export async function retry(ctx, { force = false } = {}) {
  const was = await stateOf(ctx);
  if (was?.state === "done") return was;
  const k = ctx.instance.id;
  if (!force && (lastTry.get(k) ?? 0) > Date.now() - 10 * 60_000) return was;
  lastTry.set(k, Date.now());
  if (lastTry.size > 200) lastTry.delete(lastTry.keys().next().value);
  return handover(ctx);
}
export const resetHandover = () => lastTry.clear();
