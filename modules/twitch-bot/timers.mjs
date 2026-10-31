// Les timers : des messages que le bot écrit de lui-même dans le chat, à intervalle régulier, comme chez Nightbot.
// AUCUN minuteur de fond : un timer n'est regardé qu'à l'arrivée d'un message du chat (Twitch appelle le site à chaque message). Un chat silencieux n'envoie donc rien,
// et c'est voulu. À chaque message : on compte la ligne, on cherche le premier timer dû (intervalle écoulé ET assez de lignes depuis son dernier envoi), et on en envoie UN SEUL
// (les autres attendent le message suivant, dans l'ordre de la liste). Jamais pendant l'arrêt d'urgence, jamais si le bot n'est pas prêt, jamais au-delà de la limite de réponses.
// Où vit quoi : les réglages d'un timer (nom, texte, intervalle…) sont dans le document `botConfig` avec les commandes ; l'état (dernier envoi, lignes comptées) dans le document `botTimers`,
// borné à 20 timers. Les lignes sont comptées en mémoire et écrites au plus toutes les 10 secondes (un chat animé n'écrit pas à chaque message).
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { settingsOf } = await import(`./settings.mjs${v}`);
const { loadConfig, mutate, configVersion, catalog } = await import(`./commands.mjs${v}`);
const { checkTemplate } = await import(`./variables.mjs${v}`);
const { parsePeriod, readPeriod, isOpen } = await import(`./period.mjs${v}`);
const st = await import(`./state.mjs${v}`);
const src = await import(`./sources.mjs${v}`);
const { diagnose, sendChat } = await import(`./listen.mjs${v}`);
const { compose } = await import(`./engine.mjs${v}`);

export const MAX_TIMERS = 20;
export const LIMITS = { name: 40, minutes: 1440, lines: 200 };
export const WHEN = ["live", "always"];
const FLUSH_MS = 10_000, READY_MS = 60_000, FAIL_MS = 30_000, CACHE_MS = 10_000;
const err = (code, extra = {}) => ({ ok: false, code, ...extra });
const cleanName = (x) => String(x ?? "").normalize("NFKC").replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();

/** Vérifie les champs d'un timer. `others` : les autres timers (pour le nom unique). Rend { ok: true, value } ou { ok: false, code }. */
export function checkTimer(f, { prefix = "!", others = [], current = null } = {}) {
  const name = cleanName(f.name ?? current?.name);
  if (!name || name.length > LIMITS.name) return err("timer_name");
  if (others.some((o) => o.name.toLowerCase() === name.toLowerCase())) return err("timer_dup");
  const minutes = Number(f.minutes ?? current?.minutes);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > LIMITS.minutes) return err("timer_minutes");
  const lines = f.lines === undefined || f.lines === "" ? (current?.lines ?? 5) : Number(f.lines);
  if (!Number.isInteger(lines) || lines < 0 || lines > LIMITS.lines) return err("timer_lines");
  const when = f.when ?? current?.when ?? "live";
  if (!WHEN.includes(when)) return err("timer_when");
  let period = readPeriod(current?.period);
  if (f.period !== undefined) { const p = parsePeriod(f.period); if (!p.ok) return err("period", { field: p.field, reason: p.reason, month: p.month, day: p.day, year: p.year }); period = p.value; }
  const ok = checkTemplate(f.text ?? current?.text, "timer", prefix);
  if (!ok.ok) return err(`text_${ok.code}`, { vars: ok.vars, allowed: ok.allowed, name: ok.name });
  return { ok: true, value: { name, text: ok.text, minutes, lines, when, enabled: f.enabled === undefined ? current?.enabled !== false : f.enabled === true, ...(period ? { period } : {}) } };
}

/** Crée (sans `ref.id`) ou modifie un timer. Rend { ok: true, id } ou { ok: false, code }. */
export function saveTimer(ctx, ref, fields, { prefix = "!" } = {}) {
  return mutate(ctx, (cfg) => {
    const creating = !ref?.id;
    const current = creating ? null : cfg.timers.find((x) => x.id === ref.id);
    if (!creating && !current) return err("unknown");
    if (creating && cfg.timers.length >= MAX_TIMERS) return err("timer_many");
    const c = checkTimer(fields, { prefix, others: cfg.timers.filter((x) => x.id !== current?.id), current });
    if (!c.ok) return c;
    const id = current?.id ?? `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const entry = { id, ...c.value };
    if (creating) cfg.timers.push(entry); else cfg.timers = cfg.timers.map((x) => (x.id === id ? entry : x));
    return { ok: true, id };
  });
}
export function removeTimer(ctx, id) {
  return mutate(ctx, (cfg) => { const n = cfg.timers.length; cfg.timers = cfg.timers.filter((x) => x.id !== id); return n === cfg.timers.length ? err("unknown") : { ok: true }; });
}

/* ───────────── L'état : en mémoire, écrit de temps en temps ───────────── */

const mem = new Map();
export const resetTimersMemory = () => mem.clear();
const of = (ctx) => { const k = ctx.instance.key; if (!mem.has(k)) mem.set(k, { loaded: null, items: new Map(), flushedAt: 0, dirty: false, ready: null, live: null, wasLive: null, fail: new Map(), cache: null }); return mem.get(k); };

async function load(ctx, m) {
  if (m.loaded) return m.loaded;
  m.loaded = (async () => {
    const r = (await ctx.api.store.list("botTimers", { limit: 1 }))[0];
    const items = r?.data?.items && typeof r.data.items === "object" ? r.data.items : {};
    for (const [id, x] of Object.entries(items)) if (Number.isFinite(x?.lastAt) && Number.isInteger(x?.lines)) m.items.set(id, { lastAt: x.lastAt, lines: Math.max(0, x.lines), ...(x.closed === true ? { closed: true } : {}) });
  })().catch(() => {});
  return m.loaded;
}
async function flush(ctx, m, ids, now) {
  m.flushedAt = now; m.dirty = false;
  const items = {};
  for (const id of ids) { const x = m.items.get(id); if (x) items[id] = { lastAt: x.lastAt, lines: x.lines, ...(x.closed ? { closed: true } : {}) }; }
  for (const id of [...m.items.keys()]) if (!ids.includes(id)) m.items.delete(id);   // un timer supprimé ne laisse rien derrière lui
  await st.serial(ctx, "timers", async () => {
    const r = (await ctx.api.store.list("botTimers", { limit: 1 }))[0];
    if (r) await ctx.api.store.update(r.id, { items }); else await ctx.api.store.add("botTimers", { items });
  }).catch(() => {});
}
/** L'état d'un timer (pour l'administration) : { lastAt, lines } ou null. */
export async function stateOf(ctx, id) { const m = of(ctx); await load(ctx, m); return m.items.get(id) ?? null; }

async function timersNow(ctx, m, now) {
  const ver = configVersion(ctx);
  if (m.cache && m.cache.ver === ver && m.cache.until > now) return m.cache.list;
  const list = (await loadConfig(ctx)).data.timers.filter((x) => x.enabled !== false).slice(0, MAX_TIMERS);
  m.cache = { ver, until: now + CACHE_MS, list };
  return list;
}
async function readyNow(ctx, s, m, now) {
  if (m.ready && m.ready.until > now) return m.ready.d;
  const d = await diagnose(ctx, s, { declare: false });
  m.ready = { d, until: now + READY_MS };
  return d;
}

/**
 * Un message du chat est arrivé. Compte la ligne et envoie au plus UN timer dû. `commandSent` : une commande vient de répondre à ce message (alors les timers attendent le suivant).
 * Rend { sent: boolean, why?, timer? }. Ne lève jamais.
 */
export async function processTimers(ctx, chat, { now = Date.now(), commandSent = false } = {}) {
  try {
    const s = settingsOf(ctx), m = of(ctx);
    if (chat.foreign || st.isOwnMessage(ctx, chat.messageId) || s.bots.has(chat.login)) return { sent: false, why: "ignored" };
    const timers = await timersNow(ctx, m, now);
    if (!timers.length) return { sent: false, why: "none" };
    await load(ctx, m);
    const ids = timers.map((x) => x.id);
    let d = null, muted = false, liveNow = null;
    const needsLive = timers.some((x) => x.when === "live");
    if (needsLive) {
      d = await readyNow(ctx, s, m, now);
      if (d.code === "ready" && chat.broadcasterId === d.broadcasterId) { const l = await src.liveState(ctx, d.channel); liveNow = l?.known === true && l.live === true; }
    }
    const started = needsLive && liveNow === true && m.wasLive === false;
    if (needsLive && liveNow !== null) m.wasLive = liveNow;
    const open = new Map(timers.map((x) => [x.id, isOpen(readPeriod(x.period), now, s.timeZone)]));   // hors période : le timer ne compte rien et n'écrit rien (aucune rafale à la réouverture)
    for (const x of timers) {
      let it = m.items.get(x.id);
      if (!it) { it = { lastAt: now, lines: 0 }; m.items.set(x.id, it); m.dirty = true; }
      if (!open.get(x.id)) { it.lastAt = now; it.lines = 0; if (!it.closed) { it.closed = true; m.dirty = true; } continue; }   // hors période : on note qu'il est fermé
      if (it.closed) { it.closed = false; it.lastAt = now; it.lines = 0; m.dirty = true; continue; }   // il vient de rouvrir : on repart de zéro, pas de rafale
      if (x.when === "live" && (liveNow !== true || started)) { it.lastAt = now; it.lines = 0; m.dirty = true; continue; }   // hors direct, ou le direct vient de commencer : on repart de zéro
      it.lines = Math.min(it.lines + 1, 1_000_000); m.dirty = true;
    }
    const due = timers.filter((x) => { const it = m.items.get(x.id); return open.get(x.id) && it && now - it.lastAt >= x.minutes * 60_000 && it.lines >= x.lines && (m.fail.get(x.id) ?? 0) <= now; });
    let result = { sent: false, why: due.length ? "wait" : "none" };
    if (due.length && !commandSent) {
      d = d ?? (await readyNow(ctx, s, m, now));
      if (d.code !== "ready" || chat.broadcasterId !== d.broadcasterId) result = { sent: false, why: "not_ready" };
      else {
        muted = await st.isMuted(ctx);
        if (muted) { for (const x of timers) { const it = m.items.get(x.id); if (it) { it.lastAt = now; it.lines = 0; } } m.dirty = true; result = { sent: false, why: "muted" }; }   // pas de rafale au retour de l'arrêt d'urgence
        else {
          const pick = due.find((x) => x.when !== "live" || liveNow === true);
          if (pick) result = await deliver(ctx, s, d, pick, { now, ids });
        }
      }
    }
    if (m.dirty && (now - m.flushedAt >= FLUSH_MS || result.sent)) await flush(ctx, m, ids, now);
    return result;
  } catch { return { sent: false, why: "error" }; }
}

/** Écrit le message d'un timer dans le chat. Met à jour l'état et le journal. */
async function deliver(ctx, s, d, timer, { now, ids, force = false }) {
  const m = of(ctx);
  if (!st.takeSendSlot(ctx, { max: s.maxPerWindow, windowMs: 30_000, now })) return { sent: false, why: "rate" };
  const sources = await src.gather(ctx, d.channel ?? null);
  const list = catalog((await loadConfig(ctx)).data, sources, ctx.t);
  const text = await compose(ctx, s, { text: timer.text, kind: "timer", vars: {} }, "", { channel: d.channel ?? null, sources, list, now });
  const log = (result, reason, extra = {}) => st.addLog(ctx, { user: "timer", command: `⏱ ${timer.name}`, result, reason, ...extra }).catch(() => {});
  if (!text) { st.giveBackSendSlot(ctx); await log("refused", "empty"); m.fail.set(timer.id, now + FAIL_MS); return { sent: false, why: "empty", timer: timer.id }; }
  const sent = await sendChat(ctx, d, text);
  if (!sent.sent) { st.giveBackSendSlot(ctx); m.fail.set(timer.id, now + FAIL_MS); await log("error", `send_${sent.code}`, { detail: sent.detail ?? null }); return { sent: false, why: `send_${sent.code}`, timer: timer.id }; }
  st.rememberSent(ctx, sent.messageId);
  m.items.set(timer.id, { lastAt: now, lines: 0 }); m.dirty = true;
  m.fail.delete(timer.id);
  await log("sent", force ? "manual" : "ok", { text: text.slice(0, 160) });
  return { sent: true, timer: timer.id, text };
}

/** « Envoyer maintenant » : sans attendre l'intervalle, les lignes ni le direct ; mais jamais pendant l'arrêt d'urgence, ni si le bot n'est pas prêt, ni au-delà de la limite de réponses. */
export async function sendNow(ctx, id, { now = Date.now() } = {}) {
  const s = settingsOf(ctx), m = of(ctx);
  const timer = (await loadConfig(ctx)).data.timers.find((x) => x.id === id);
  if (!timer) return { ok: false, code: "unknown" };
  const d = await diagnose(ctx, s, { declare: false });
  if (d.code !== "ready") return { ok: false, code: "not_ready" };
  if (await st.isMuted(ctx)) return { ok: false, code: "muted" };
  await load(ctx, m);
  const r = await deliver(ctx, s, d, timer, { now, force: true });
  if (r.sent) { await flush(ctx, m, (await loadConfig(ctx)).data.timers.map((x) => x.id), now); return { ok: true, text: r.text }; }
  return { ok: false, code: r.why === "rate" ? "rate" : "send" };
}
