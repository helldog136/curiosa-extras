// L'alimentation d'un tirage au sort de Participation (service facultatif `audience.draw`). Le bot ne tient aucun tirage : il lit son état (`status()`) et transmet
// le pseudo d'une personne qui a tapé EXACTEMENT le mot-clé du tirage (`enter({ pseudo, platform, login })`). Participation possède les pseudos, le tirage et le résultat.
// Règles : réponse de `status()` gardée 10 s, appel borné à 1,5 s, jamais bloquant, jamais d'erreur visible ; le bot ne répond JAMAIS dans le chat pour une participation ;
// une participation n'est envoyée qu'une fois par personne et par tirage (mémoire de 5 000 pseudos au plus, effacée quand le tirage se ferme) ; rien n'est envoyé pendant
// l'arrêt d'urgence, ni hors direct si le réglage « seulement en direct » est actif ; rien de ce que les gens écrivent n'est gardé.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { settingsOf } = await import(`./settings.mjs${v}`);
const { levelOf } = await import(`./eventsub.mjs${v}`);
const { pseudo } = await import(`./variables.mjs${v}`);
const st = await import(`./state.mjs${v}`);
const src = await import(`./sources.mjs${v}`);
const { diagnose } = await import(`./listen.mjs${v}`);

export const SERVICE = "audience.draw";
export const DRAW_LIMITS = { statusTtlMs: 10_000, callMs: 1500, maxEntered: 5000 };
const NEED = { everyone: 0, subscriber: 1, moderator: 2 };

const mem = new Map();
const of = (ctx) => { const k = ctx.instance.key; if (!mem.has(k)) mem.set(k, { status: null, until: 0, drawId: null, entered: new Set() }); return mem.get(k); };
export const resetDrawMemory = () => mem.clear();

const bounded = (p, ms, fallback) => { let timer; const late = new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), ms); timer.unref?.(); }); return Promise.race([p, late]).finally(() => clearTimeout(timer)); };

async function status(ctx, m, now) {
  if (m.until > now) return m.status;
  m.until = now + DRAW_LIMITS.statusTtlMs;   // même un échec est gardé 10 s : un service muet ne ralentit jamais le chat
  let value = null;
  try {
    const r = await bounded(Promise.resolve(ctx.api.services.call(SERVICE, "status", {})), DRAW_LIMITS.callMs, null);
    const x = r?.ok ? r.value : null;
    if (x && typeof x === "object" && x.open === true && typeof x.keyword === "string" && x.keyword.trim()) {
      value = { open: true, keyword: x.keyword.trim().toLowerCase().slice(0, 60), level: Object.hasOwn(NEED, x.level) ? x.level : "everyone", expiresAt: typeof x.expiresAt === "string" ? x.expiresAt.slice(0, 40) : "" };
    }
  } catch { value = null; }
  m.status = value;
  return value;
}

/** Un message du chat : si un tirage est ouvert et que le message est son mot-clé, la personne est inscrite (une seule fois). Rend { entered: boolean, why? }. Ne lève jamais, n'écrit jamais dans le chat. */
export async function feedDraw(ctx, chat, { now = Date.now() } = {}) {
  try {
    const m = of(ctx), s = settingsOf(ctx);
    if (chat.foreign || st.isOwnMessage(ctx, chat.messageId) || s.bots.has(chat.login)) return { entered: false, why: "ignored" };
    const open = await status(ctx, m, now);
    if (!open) { if (m.drawId !== null) { m.drawId = null; m.entered.clear(); } return { entered: false, why: "closed" }; }
    const id = `${open.keyword}|${open.expiresAt}`;
    if (m.drawId !== id) { m.drawId = id; m.entered.clear(); }   // un autre tirage a pris la place : on repart de zéro
    const word = String(chat.text ?? "").trim().toLowerCase();
    const bare = s.prefix && word.startsWith(s.prefix) ? word.slice(s.prefix.length).trim() : word;
    const key = s.prefix && open.keyword.startsWith(s.prefix) ? open.keyword.slice(s.prefix.length).trim() : open.keyword;
    if (!bare || bare !== key) return { entered: false, why: "no_match" };
    if (levelOf(chat) < NEED[open.level]) return { entered: false, why: "level" };
    if (m.entered.has(chat.chatterId)) return { entered: false, why: "already" };
    if (m.entered.size >= DRAW_LIMITS.maxEntered) return { entered: false, why: "full" };
    const d = await diagnose(ctx, s, { declare: false });
    if (d.code !== "ready" || chat.broadcasterId !== d.broadcasterId) return { entered: false, why: "not_ready" };
    if (await st.isMuted(ctx)) return { entered: false, why: "muted" };
    if (s.onlyWhenLive) { const live = await src.liveState(ctx, d.channel); if (!live?.known || !live.live) return { entered: false, why: "offline" }; }
    m.entered.add(chat.chatterId);
    await bounded(Promise.resolve(ctx.api.services.call(SERVICE, "enter", { pseudo: pseudo(chat.name || chat.login), platform: "twitch", login: chat.login })), DRAW_LIMITS.callMs, null).catch(() => null);   // la réponse est ignorée
    return { entered: true };
  } catch { return { entered: false, why: "error" }; }
}
