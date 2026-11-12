// Les timers : une COMMANDE qui se répète toute seule. Dans l'administration, un timer est un réglage d'une commande (« Répéter automatiquement » : toutes les N minutes, après au moins N lignes
// de chat, en direct seulement ou toujours). À chaque échéance, le bot exécute la commande comme si on l'avait tapée : sa réponse, sa période d'activité, son état (désactivée, en pause…).
// AUCUNE boucle de fond : une répétition est regardée à l'arrivée d'un message du chat, et chaque minute par la tâche `tick` (qui n'envoie que celles dont les lignes de chat sont déjà comptées) (Twitch appelle le site à chaque message). Un chat silencieux n'envoie donc rien,
// et c'est voulu. À chaque message : on compte la ligne, on cherche la première répétition due (intervalle écoulé ET assez de lignes depuis son dernier envoi), et on en envoie UNE SEULE
// (les autres attendent le message suivant). Jamais pendant l'arrêt d'urgence, jamais si le bot n'est pas prêt, jamais au-delà de la limite de réponses.
// Où vit quoi : le réglage (`repeat`) est dans le document `botConfig`, sur la commande ; l'état (dernier envoi, lignes comptées) dans le document `botTimers`, par commande, borné à 20.
// Les lignes sont comptées en mémoire et écrites au plus toutes les 10 secondes. L'ancienne liste `timers` du document est inerte depuis la migration (voir timersMigrate.mjs) : jamais lue ici.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { settingsOf } = await import(`./settings.mjs${v}`);
const C = await import(`./commands.mjs${v}`);
const { loadConfig, mutate, configVersion, catalog, saveCommand, BUILTINS, readRepeat, MAX_REPEATS, REPEAT_LIMITS, REPEAT_WHEN } = C;
const { used } = await import(`./variables.mjs${v}`);
const { readPeriod, isOpen } = await import(`./period.mjs${v}`);
const st = await import(`./state.mjs${v}`);
const src = await import(`./sources.mjs${v}`);
const { diagnose, sendChat } = await import(`./listen.mjs${v}`);
const { compose } = await import(`./engine.mjs${v}`);
const collab = await import(`./collab.mjs${v}`);
const { migrateTimers, needsMigration } = await import(`./timersMigrate.mjs${v}`);

export const MAX_TIMERS = MAX_REPEATS;
export const LIMITS = { minutes: REPEAT_LIMITS.minutes, lines: REPEAT_LIMITS.lines };
export const WHEN = REPEAT_WHEN;
const FLUSH_MS = 10_000, READY_MS = 60_000, FAIL_MS = 30_000, CACHE_MS = 10_000;
const rec = (x) => (x && typeof x === "object" && !Array.isArray(x) ? x : {});
/** What is written down for one timer (the thinning counter only while it counts something). */
const pack = (x) => ({ lastAt: x.lastAt, lines: x.lines, ...(x.closed ? { closed: true } : {}), ...(x.thin > 0 ? { thin: x.thin, thinSince: x.thinSince } : {}) });

/** Les commandes qui ont une répétition ACTIVE, d'après la configuration seule (sans interroger les autres modules) : [{ key, repeat, period }]. Une commande désactivée n'y est pas. */
export function repeatEntries(cfg) {
  const out = [], push = (key, o, on) => { const repeat = readRepeat(o.repeat); if (repeat && repeat.enabled && on) out.push({ key, repeat, period: o.period }); };
  for (const c of cfg.custom) push(`custom:${c.id}`, c, c.enabled !== false);
  for (const b of BUILTINS) { const o = rec(cfg.builtin[b.id]); push(`builtin:${b.id}`, o, o.enabled !== false); }
  for (const [id, o] of Object.entries(cfg.partners)) push(`partner:${id}`, rec(o), rec(o).enabled === true);
  for (const [id, o] of Object.entries(cfg.networks)) push(`network:${id}`, rec(o), rec(o).enabled === true);
  push(`group:${C.GROUP_ID}`, rec(cfg.group), rec(cfg.group).enabled !== false);
  return out.slice(0, MAX_TIMERS);
}

/** Règle la répétition d'une commande (`repeat` : champs à changer, ou null pour la retirer). Rend { ok: true } ou { ok: false, code }. */
export async function setRepeat(ctx, c, repeat, env) {
  if (c.kind === "partner" || c.kind === "network") return C.saveSourced(ctx, c.kind, c.id, { repeat }, env);
  return saveCommand(ctx, { kind: c.kind, id: c.id }, { repeat }, env);
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
    for (const [id, x] of Object.entries(items)) if (Number.isFinite(x?.lastAt) && Number.isInteger(x?.lines)) m.items.set(id, { lastAt: x.lastAt, lines: Math.max(0, x.lines), ...(x.closed === true ? { closed: true } : {}), ...(Number.isInteger(x.thin) && x.thin > 0 && Number.isFinite(x.thinSince) ? { thin: x.thin, thinSince: x.thinSince } : {}) });
  })().catch(() => {});
  return m.loaded;
}
async function flush(ctx, m, ids, now) {
  m.flushedAt = now; m.dirty = false;
  const items = {};
  for (const [id, x] of m.items) if (!id.includes(":")) items[id] = pack(x);
  for (const id of ids) { const x = m.items.get(id); if (x) items[id] = pack(x); }
  for (const id of [...m.items.keys()]) if (!ids.includes(id) && id.includes(":")) m.items.delete(id);   // une répétition retirée ne laisse rien derrière elle (les états des anciens timers, sans « : », sont gardés tant que la migration n'est pas vérifiée)
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
  let cfg = (await loadConfig(ctx)).data;
  if (needsMigration(cfg) && !m.migrating) {   // filet de sécurité : si la migration des données n'a pas tourné, elle tourne ici (une fois, rejouable, sans effet si tout est déjà repris)
    m.migrating = true;
    try { await migrateTimers(ctx); cfg = (await loadConfig(ctx)).data; } catch { /* au pire, au message suivant */ m.migrating = false; }
  }
  const list = repeatEntries(cfg).map((e) => ({ id: e.key, minutes: e.repeat.minutes, lines: e.repeat.lines, when: e.repeat.when, period: e.period }));
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
export async function processTimers(ctx, chat, { now = Date.now(), commandSent = false, tick = false } = {}) {
  // One pass at a time per instance: a message and the one-minute task arriving together cannot send the same repeat twice.
  const m0 = of(ctx);
  const run = (m0.running ?? Promise.resolve()).catch(() => {}).then(() => pass(ctx, chat, { now, commandSent, tick }));
  m0.running = run;
  return run;
}
async function pass(ctx, chat, { now, commandSent, tick }) {
  try {
    const s = settingsOf(ctx), m = of(ctx);
    if (!tick && (chat.foreign || st.isOwnMessage(ctx, chat.messageId) || s.bots.has(chat.login))) return { sent: false, why: "ignored" };
    const timers = await timersNow(ctx, m, now);
    if (!timers.length) return { sent: false, why: "none" };
    await load(ctx, m);
    const ids = timers.map((x) => x.id);
    let d = null, muted = false, liveNow = null;
    const needsLive = timers.some((x) => x.when === "live");
    if (needsLive) {
      d = await readyNow(ctx, s, m, now);
      if (d.code === "ready" && (tick || chat.broadcasterId === d.broadcasterId)) { const l = await src.liveState(ctx, d.channel); liveNow = l?.known === true && l.live === true; }
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
      if (!tick) { it.lines = Math.min(it.lines + 1, 1_000_000); m.dirty = true; }   // the one-minute task counts no line
    }
    // With no message at hand (the one-minute task), only a repeat that asks for chat lines — already counted since its last send — can go out: a chat that stayed silent still sends nothing.
    const due = timers.filter((x) => { const it = m.items.get(x.id); return open.get(x.id) && it && now - it.lastAt >= x.minutes * 60_000 && it.lines >= x.lines && (!tick || x.lines >= 1) && (m.fail.get(x.id) ?? 0) <= now; });
    let result = { sent: false, why: due.length ? "wait" : "none" };
    if (due.length && !commandSent) {
      d = d ?? (await readyNow(ctx, s, m, now));
      if (d.code !== "ready" || (!tick && chat.broadcasterId !== d.broadcasterId)) result = { sent: false, why: "not_ready" };
      else {
        const state = await st.readState(ctx), cs = collab.effective(state, now);
        const restart = () => { for (const x of timers) { const it = m.items.get(x.id); if (it) { it.lastAt = now; it.lines = 0; } } m.dirty = true; };
        muted = state.muted === true;
        if (muted) { restart(); result = { sent: false, why: "muted" }; }   // pas de rafale au retour de l'arrêt d'urgence
        else if (cs.on && cs.mode === "pause") { restart(); result = { sent: false, why: "collab_paused" }; }   // collaboration mode, "pause": same, no burst when it ends
        else {
          // Collaboration mode, "thin out": each timer that is due counts one; only the 2nd (or 3rd) one goes out, the others start their wait again. The counter is per timer and written down.
          // (This module has no priority flag on a timer: every timer is treated the same way.)
          if (!cs.on) for (const it of m.items.values()) if (it.thin !== undefined) { delete it.thin; delete it.thinSince; m.dirty = true; }   // the mode is off: the counters start again next time
          let pick = null, thinned = 0;
          for (const x of due) {
            if (x.when === "live" && liveNow !== true) continue;
            const it = m.items.get(x.id);
            if (cs.on && cs.mode === "thin") {
              if (it.thinSince !== cs.since) { it.thin = 0; it.thinSince = cs.since; }   // a new run of the mode: a new count
              it.thin += 1; m.dirty = true;
              if (it.thin < cs.ratio) { it.lastAt = now; it.lines = 0; thinned += 1; continue; }
            }
            pick = x; break;
          }
          if (pick) result = await deliver(ctx, s, d, pick, { now, ids });
          else if (thinned) result = { sent: false, why: "collab_thinned" };
        }
      }
    }
    if (m.dirty && (now - m.flushedAt >= FLUSH_MS || result.sent)) await flush(ctx, m, ids, now);
    return result;
  } catch { return { sent: false, why: "error" }; }
}

/** Exécute la commande comme si on l'avait tapée (sa réponse, son état), sans personne derrière : `{utilisateur}` devient « tout le monde ». Met à jour l'état et le journal. */
async function deliver(ctx, s, d, timer, { now, ids, force = false }) {
  const m = of(ctx);
  const key = timer.id;
  const cfg = (await loadConfig(ctx)).data;
  const sources = await src.gather(ctx, d.channel ?? null);
  const list = catalog(cfg, sources, ctx.t, { now, timeZone: s.timeZone });
  const cmd = list.find((c) => c.key === key);
  if (!cmd || !cmd.repeat) return { sent: false, why: "unknown", timer: key };
  const label = cmd.title || `${s.prefix}${cmd.name}`;
  const log = (result, reason, extra = {}) => st.addLog(ctx, { user: "timer", command: `⏱ ${label}`, result, reason, ...extra }).catch(() => {});
  if (cmd.state !== "on") { m.fail.set(key, now + FAIL_MS); return { sent: false, why: `command_${cmd.state}`, timer: key }; }   // désactivée, hors période, incomplète : la commande n'aurait pas répondu non plus
  if (!st.takeSendSlot(ctx, { max: s.maxPerWindow, windowMs: 30_000, now })) return { sent: false, why: "rate" };
  const counts = cmd.kind === "custom" && used(cmd.text).includes("compteur");
  const next = counts ? ((await st.readCounters(ctx))[cmd.key] ?? 0) + 1 : 0;
  const text = await compose(ctx, s, cmd, ctx.t("rep_everyone"), { channel: d.channel ?? null, sources, list, now, counter: next });
  if (!text) { st.giveBackSendSlot(ctx); await log("refused", "empty"); m.fail.set(key, now + FAIL_MS); return { sent: false, why: "empty", timer: key }; }
  const sent = await sendChat(ctx, d, text);
  if (!sent.sent) { st.giveBackSendSlot(ctx); m.fail.set(key, now + FAIL_MS); await log("error", `send_${sent.code}`, { detail: sent.detail ?? null }); return { sent: false, why: `send_${sent.code}`, timer: key }; }
  st.rememberSent(ctx, sent.messageId);
  if (counts) await st.setCounter(ctx, cmd.key, next).catch(() => {});
  m.items.set(key, { lastAt: now, lines: 0 }); m.dirty = true;
  m.fail.delete(key);
  await log("sent", force ? "manual" : "ok", { text: text.slice(0, 160) });
  return { sent: true, timer: key, text };
}

/** « Envoyer maintenant » : sans attendre l'intervalle, les lignes ni le direct ; mais jamais pendant l'arrêt d'urgence, ni si le bot n'est pas prêt, ni au-delà de la limite de réponses. */
export async function sendNow(ctx, key, { now = Date.now() } = {}) {
  const s = settingsOf(ctx), m = of(ctx);
  const cfg = (await loadConfig(ctx)).data;
  if (!catalog(cfg, { partners: { installed: false, items: [] }, networks: { items: [] }, planning: {}, followers: {} }, ctx.t).some((c) => c.key === key && c.repeat)) return { ok: false, code: "unknown" };
  const d = await diagnose(ctx, s, { declare: false });
  if (d.code !== "ready") return { ok: false, code: "not_ready" };
  if (await st.isMuted(ctx)) return { ok: false, code: "muted" };
  await load(ctx, m);
  const r = await deliver(ctx, s, d, { id: key }, { now, force: true });
  if (r.sent) { await flush(ctx, m, repeatEntries(cfg).map((e) => e.key), now); return { ok: true, text: r.text }; }
  return { ok: false, code: r.why === "rate" ? "rate" : r.why?.startsWith("command_") ? "command" : "send" };
}
