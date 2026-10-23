// Le cœur du module : la file d'actions, le coupe-circuit, l'appairage, la modération avant mise en file. Tout ce que `enqueue`, les routes et l'administration partagent.
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const S = await import(`./store.mjs${v}`);
const { liveNow, isOpen, shouldNoteLive } = await import(`./live.mjs${v}`);
const { settingsOf } = await import(`./settings.mjs${v}`);
const { moderate, clean } = await import(`./moderation.mjs${v}`);

export const KEY_RE = /^[a-z0-9][a-z0-9:_-]{0,39}$/;
export const REF_RE = /^[A-Za-z0-9._:-]{1,80}$/;
export const ID_RE = /^[A-Za-z0-9_-]{6,40}$/;
export const OFFLINE_MS = 60_000;
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";   // sans 0/O ni 1/I/L
export const CODE_LENGTH = 8, CODE_TTL_MS = 10 * 60_000, CODE_TRIES = 5;
export const ACK_STATUSES = ["done", "failed", "ignored"];
export const ACK_CODES = ["ok", "unmapped", "disabled", "expired", "error"];
export const REASONS = ["off", "offline", "not_live", "blocked", "busy", "unknown_key", "not_paired"];
export const TEST_LIMITS = { gapMs: 3000, perHour: 30 };

const iso = (ms) => new Date(ms).toISOString();
export const sha256hex = (s) => createHash("sha256").update(String(s)).digest("hex");
const safeEqualHex = (a, b) => a.length === b.length && a.length > 0 && timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
const label = (s, n = 40) => clean(s, { maxRaw: 200 }).text.slice(0, n);

/* ───────────── En mémoire : débit, délais, dernier signe de vie ───────────── */

const mems = new Map();
const mem = (ctx) => {
  const k = ctx.instance.key;
  if (!mems.has(k)) mems.set(k, { seen: 0, pull: 0, ttsGlobal: 0, ttsViewer: new Map(), pairFp: new Map(), pairAll: [], fails: new Map(), acks: [], tests: [] });
  return mems.get(k);
};
export const resetMemory = () => mems.clear();

/** Fenêtre glissante : rend 0 si l'appel passe (et le compte), sinon les secondes à attendre. */
function slide(list, now, windowMs, max) {
  while (list.length && now - list[0] >= windowMs) list.shift();
  if (list.length >= max) return Math.max(1, Math.ceil((windowMs - (now - list[0])) / 1000));
  list.push(now);
  return 0;
}
function slideKey(map, key, now, windowMs, max, cap = 2000) {
  let list = map.get(key);
  if (!list) { list = []; map.set(key, list); if (map.size > cap) for (const [k, l] of map) { if (!l.length || now - l[l.length - 1] >= windowMs) map.delete(k); if (map.size <= cap) break; } }
  return slide(list, now, windowMs, max);
}

export const noteSeen = (ctx, now) => { mem(ctx).seen = now; };
export const lastSeenOf = (ctx, core) => Math.max(core.lastSeenAt || 0, mem(ctx).seen || 0);
/** Une interrogation de plus d'un appareil : 0 si elle passe, sinon les secondes à attendre (au moins 1 s entre deux). */
export function takePull(ctx, now) {
  const m = mem(ctx);
  if (now - m.pull < 1000 && now >= m.pull) return Math.max(1, Math.ceil((1000 - (now - m.pull)) / 1000));
  m.pull = now;
  return 0;
}
export const takeAck = (ctx, now) => slide(mem(ctx).acks, now, 10_000, 30);
/** Débit de l'appairage : 10 essais par heure et par visiteur, 60 en tout. */
export function takePair(ctx, who, now) {
  const m = mem(ctx);
  return Math.max(slideKey(m.pairFp, who, now, 3600_000, 10), slide(m.pairAll, now, 3600_000, 60));
}
/** Les jetons refusés : 20 par 5 minutes et par visiteur, ensuite on ne répond plus qu'« attendez ». */
export function failedAuth(ctx, who, now) { return slideKey(mem(ctx).fails, who, now, 300_000, 20); }
export function authBlocked(ctx, who, now) { const l = mem(ctx).fails.get(who); return !!l && l.filter((t) => now - t < 300_000).length >= 20; }

/* ───────────── Appareil associé ───────────── */

/** Vérifie « Authorization: Bearer … » : rend le document d'état si le jeton est celui de l'appareil associé, sinon null. Comparaison en temps constant, sur les empreintes. */
export async function authenticate(ctx, request) {
  const m = /^Bearer ([A-Za-z0-9_-]{20,128})$/.exec((request.headers.get("authorization") ?? "").trim());
  const core = await S.peek(ctx, "core");
  const stored = core.paired?.tokenHash;
  const given = sha256hex(m ? m[1] : "no-token");
  const same = safeEqualHex(given, typeof stored === "string" ? stored : sha256hex("no-device"));
  return m && stored && same ? core : null;
}

function randomCode() {
  let out = "";
  while (out.length < CODE_LENGTH) for (const b of randomBytes(16)) { if (b < 248 && out.length < CODE_LENGTH) out += CODE_ALPHABET[b % CODE_ALPHABET.length]; }
  return out;   // 248 = 31 × 8 : aucun biais
}
const normalizeCode = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Un nouveau code d'association (l'ancien, s'il y en avait un, ne sert plus). Rend { code, expiresAt }. */
export function createPairing(ctx, { now = Date.now(), by = "admin" } = {}) {
  return S.transact(ctx, async (db) => {
    const core = await db.core();
    const code = randomCode();
    core.pending = { code, createdAt: now, expiresAt: now + CODE_TTL_MS, tries: 0 };
    await S.addLog(db, { kind: "system", event: "pair_code", by: label(by) });
    return { code, expiresAt: now + CODE_TTL_MS };
  }, { now });
}
export function cancelPairing(ctx, { now = Date.now() } = {}) {
  return S.transact(ctx, async (db) => { (await db.core()).pending = null; }, { now });
}

/**
 * Home Assistant présente le code. Rend { ok: true, token, instance } ou { ok: false, problem: "invalid_code" }.
 * Le jeton n'est rendu qu'ici, une fois ; seule son empreinte SHA-256 est gardée. Un code sert une fois ; 5 mauvais essais l'annulent ; il vit 10 minutes.
 */
export function redeemCode(ctx, { code, name }, { now = Date.now() } = {}) {
  return S.transact(ctx, async (db) => {
    const core = await db.core();
    const p = core.pending;
    if (p && p.expiresAt <= now) core.pending = null;
    if (!core.pending) return { ok: false, problem: "invalid_code" };
    const given = normalizeCode(code);
    if (!(given.length === CODE_LENGTH && safeEqualHex(sha256hex(given), sha256hex(core.pending.code)))) {
      core.pending.tries = (core.pending.tries || 0) + 1;
      if (core.pending.tries >= CODE_TRIES) { core.pending = null; await S.addLog(db, { kind: "system", event: "pair_locked" }); }
      return { ok: false, problem: "invalid_code" };
    }
    const token = randomBytes(32).toString("base64url");
    const tokenHash = sha256hex(token);
    const replaced = !!core.paired;
    core.paired = { tokenHash, fp: tokenHash.slice(0, 8), name: label(name, 40) || "Home Assistant", at: now };
    core.pending = null;
    core.lastSeenAt = 0;
    mem(ctx).seen = 0;
    await S.addLog(db, { kind: "system", event: replaced ? "repaired" : "paired", detail: core.paired.name });
    return { ok: true, token, instance: ctx.instance.key };
  }, { now });
}

/** Dissocie l'appareil : son jeton ne marche plus, ce qui attendait dans la file est refusé (les points sont rendus). */
export function unpair(ctx, { by = "admin", now = Date.now() } = {}) {
  return S.transact(ctx, async (db) => {
    const core = await db.core();
    if (!core.paired) return { ok: true, changed: false };
    core.paired = null;
    core.pending = null;
    core.lastSeenAt = 0;
    mem(ctx).seen = 0;
    await cancelQueue(db, "not_paired");
    await S.addLog(db, { kind: "system", event: "unpaired", by: label(by) });
    return { ok: true, changed: true };
  }, { now });
}

/* ───────────── Coupe-circuit ───────────── */

async function cancelQueue(db, code) {
  const queue = await db.queue();
  const gone = queue.items;
  queue.items = [];
  for (const a of gone) {
    await S.addResult(db, { id: a.id, ref: a.ref ?? null, status: "refused", code });
    await S.updateLog(db, a.id, { status: "refused", code });
  }
  return gone.length;
}

const byOf = (by) => label(typeof by === "string" ? by : "", 40);

/** « Tout couper » : plus rien n'est envoyé, ce qui attendait est refusé. `by` : qui le demande (« owner », « mod:pseudo », « admin »…). */
export function stop(ctx, { by } = {}, now = Date.now()) {
  const who = byOf(by);
  if (!who) return Promise.resolve({ ok: false, reason: "invalid_by" });
  return S.transact(ctx, async (db) => {
    const core = await db.core();
    const was = core.enabled;
    core.enabled = false;
    if (was) { core.stoppedAt = now; core.stoppedBy = who; }
    const cancelled = await cancelQueue(db, "off");
    if (was || cancelled) await S.addLog(db, { kind: "system", event: "stop", by: who });
    return { ok: true, enabled: false };
  }, { now });
}

/** « Reprendre ». Réservé à la propriétaire et aux personnes qui gèrent le module : un modérateur (« mod:… ») peut couper, pas reprendre. */
export function start(ctx, { by } = {}, now = Date.now()) {
  const who = byOf(by);
  if (!who) return Promise.resolve({ ok: false, reason: "invalid_by" });
  if (/^mod:/i.test(who)) return Promise.resolve({ ok: false, reason: "forbidden" });
  return S.transact(ctx, async (db) => {
    const core = await db.core();
    if (!core.enabled) await S.addLog(db, { kind: "system", event: "start", by: who });
    core.enabled = true;
    core.stoppedAt = null;
    core.stoppedBy = null;
    return { ok: true, enabled: true };
  }, { now });
}

/* ───────────── Un instantané de l'état (pour le service, les routes et l'administration) ───────────── */

/** Note le direct vu (au plus une écriture par minute) et rend s'il est ouvert. À appeler dans une transaction. */
export async function openNow(db, live) {
  const core = await db.core();
  if (shouldNoteLive(live, core.lastLiveAt || 0, db.now)) core.lastLiveAt = db.now;
  return isOpen(live, core.lastLiveAt || 0, db.now);
}

/** { enabled, paired, lastSeenAt, live, queued } — aucun secret. */
export async function status(ctx, now = Date.now()) {
  const live = await liveNow(ctx, now);
  return S.transact(ctx, async (db) => {
    const core = await db.core();
    const open = await openNow(db, live);
    const seen = lastSeenOf(ctx, core);
    return { enabled: core.enabled !== false, paired: !!core.paired, lastSeenAt: seen ? iso(seen) : null, live: open, queued: (await db.queue()).items.length };
  }, { now });
}

/* ───────────── Mettre une action en file ───────────── */

const isTts = (key) => key.startsWith("tts:");

/**
 * Le contrat de service : enqueue({ key, text?, viewer?, ref }) → { ok: true, id } | { ok: false, reason }.
 * `options.test` : un essai de la propriétaire (voir testSend) — même chemin, mais il peut partir hors direct, ne touche jamais à Twitch et porte `test: true`.
 * Rend en plus `why` ({ code, detail? }) quand c'est la modération qui refuse : réservé à l'administration, jamais renvoyé par le service.
 */
export async function enqueue(ctx, args, { test = false, now = Date.now() } = {}) {
  const a = args && typeof args === "object" ? args : {};
  const key = typeof a.key === "string" ? a.key : "";
  const ref = typeof a.ref === "string" && REF_RE.test(a.ref) ? a.ref : null;
  const s = settingsOf(ctx);
  // Un test ne dépend pas du direct : on ne demande même pas à Twitch.
  const live = !test && key && KEY_RE.test(key) ? await liveNow(ctx, now) : { source: "none", live: false, known: false };
  return S.transact(ctx, async (db) => {
    const core = await db.core();
    const refuse = async (reason, extra = {}) => {
      await S.addLog(db, { id: null, kind: "action", key: label(key), viewer: label(a.viewer, 25), status: "refused", code: reason, ...(test ? { test: true } : {}), ...(extra.detail ? { detail: extra.detail } : {}), ...(extra.why ? { why: extra.why.code } : {}) });
      return { ok: false, reason, ...(extra.why ? { why: extra.why } : {}) };
    };
    if (!KEY_RE.test(key)) return refuse("unknown_key");
    if (!core.paired) return refuse("not_paired");
    if (core.enabled === false) return refuse("off");
    const open = await openNow(db, live);
    if (!test && !open) return refuse("not_live");
    if (now - lastSeenOf(ctx, core) > OFFLINE_MS) return refuse("offline");
    if (ref) {
      const queue0 = await db.queue();
      const known = queue0.items.find((x) => x.ref === ref) ?? (await db.results()).items.find((x) => x.ref === ref);
      if (known) return { ok: true, id: known.id };
    }
    const m = mem(ctx);
    let text = "";
    let viewer = test ? "Test" : cleanViewer(a.viewer);
    if (isTts(key)) {
      const r = moderate(a.text, {
        maxChars: s.maxChars, blockNumbers: s.blockNumbers, matcher: s.matcher, viewer, prefixViewer: s.prefixViewer && !test,
        prefixOf: (name) => ctx.t("tts_says", { viewer: name }), anonymous: ctx.t("tts_someone"),
      });
      if (!r.ok) return refuse("blocked", { detail: r.code === "word" ? r.detail : undefined, why: { code: r.code, ...(r.detail ? { detail: r.detail } : {}) }, });
      text = r.text.slice(0, 400);
      viewer = test ? "Test" : r.viewer;
    }
    // Les attentes ne comptent que pour la voix, et ne se réservent qu'une fois tout le reste accepté (un refus ne fait attendre personne).
    const queue = await db.queue();
    const who = viewer.toLowerCase();
    if (!test && isTts(key)) {
      const sinceGlobal = now - m.ttsGlobal, sinceViewer = now - (m.ttsViewer.get(who) ?? 0);
      if ((s.globalDelaySeconds > 0 && m.ttsGlobal && sinceGlobal >= 0 && sinceGlobal < s.globalDelaySeconds * 1000) || (s.viewerDelaySeconds > 0 && m.ttsViewer.has(who) && sinceViewer >= 0 && sinceViewer < s.viewerDelaySeconds * 1000)) return refuse("busy");
    }
    if (queue.items.length >= S.LIMITS.queue) return refuse("busy");
    if (!test && isTts(key)) {
      m.ttsGlobal = now; m.ttsViewer.set(who, now);
      if (m.ttsViewer.size > 2000) for (const [k, t] of m.ttsViewer) { if (now - t > 3600_000) m.ttsViewer.delete(k); if (m.ttsViewer.size <= 1500) break; }
    }
    core.seq += 1;
    const id = S.newId();
    const item = { id, seq: core.seq, key, text, viewer, ref, issuedAt: now, expiresAt: now + s.expirySeconds * 1000, deliveries: 0, ...(test ? { test: true } : {}) };
    queue.items.push(item);
    S.rememberKey(core, key);
    await S.addLog(db, { id, kind: "action", key, viewer, status: "queued", code: null, ...(text ? { text } : {}), ...(test ? { test: true } : {}) });
    return { ok: true, id };
  }, { now });
}

/** Le pseudo du viewer pour le journal et la file : nettoyé, 25 caractères. */
function cleanViewer(v) { return label(v, 25); }

/* ───────────── Un test de la propriétaire ───────────── */

/**
 * Simule un échange de points de chaîne : même chemin que `enqueue` (modération réelle, file, expiration, accusé), sans jamais toucher à Twitch.
 * Limite : 1 test toutes les 3 secondes, 30 par heure. Rend { ok: true, id } ou { ok: false, reason, why? } ou { ok: false, reason: "rate", retryAfter }.
 */
export async function testSend(ctx, { key, text, by = "admin" }, now = Date.now()) {
  const m = mem(ctx);
  const gap = m.tests.length ? Math.ceil((TEST_LIMITS.gapMs - (now - m.tests[m.tests.length - 1])) / 1000) : 0;
  if (gap > 0) return { ok: false, reason: "rate", retryAfter: gap };
  const wait = slide(m.tests, now - 0, 3600_000, TEST_LIMITS.perHour);
  if (wait) return { ok: false, reason: "rate", retryAfter: wait };
  const r = await enqueue(ctx, { key, text, viewer: "Test", ref: null }, { test: true, now });
  await S.transact(ctx, async (db) => { await S.addLog(db, { kind: "system", event: "test", by: label(by), detail: label(key) }); }, { now, sweep: false });
  return r;
}

/* ───────────── Interrogation et accusé (routes) ───────────── */

/** Livre les actions à Home Assistant : celles qui suivent `cursor`, jamais plus de 3 fois chacune, seulement si c'est ouvert (pas coupé, en direct). */
export async function pull(ctx, { cursor, limit }, now = Date.now()) {
  const live = await liveNow(ctx, now);
  const s = settingsOf(ctx);
  noteSeen(ctx, now);
  return S.transact(ctx, async (db) => {
    const core = await db.core();
    if (now - (core.lastSeenAt || 0) >= 20_000) core.lastSeenAt = now;
    const open = await openNow(db, live);
    const queue = await db.queue();
    const actions = [];
    let maxSeq = 0;
    // Test : une action marquée test part aussi hors direct (le reste — coupe-circuit, appairage — est déjà vérifié à la mise en file, et ici).
    if (core.enabled !== false) {
      for (const a of queue.items) {
        if (actions.length >= limit) break;
        if (a.seq <= cursor || a.deliveries >= S.LIMITS.deliveries) continue;
        if (!open && !a.test) continue;
        a.deliveries += 1;
        maxSeq = Math.max(maxSeq, a.seq);
        actions.push({ id: a.id, key: a.key, text: a.text ?? "", viewer: a.viewer ?? "", issuedAt: iso(a.issuedAt), expiresAt: iso(a.expiresAt), ...(a.test ? { test: true } : {}) });
        if (a.deliveries === 1) await S.updateLog(db, a.id, { status: "delivered", deliveredAt: now });
      }
    }
    const delivered = actions.length ? maxSeq : Math.min(cursor, core.seq);
    return { enabled: core.enabled !== false, live: open, serverTime: iso(now), cursor: delivered, pollSeconds: s.pollSeconds, actions };
  }, { now });
}

/** L'accusé de réception de Home Assistant. Rend { ok: true, result: "recorded" | "already" | "unknown" } ; "bad" si la combinaison statut/code n'a pas de sens. */
export function ack(ctx, { id, status, code }, now = Date.now()) {
  if (!ACK_STATUSES.includes(status) || !ACK_CODES.includes(code) || (status === "done") !== (code === "ok")) return Promise.resolve({ ok: false, error: "bad_request" });
  return S.transact(ctx, async (db) => {
    const queue = await db.queue();
    const i = queue.items.findIndex((a) => a.id === id);
    if (i < 0) return { ok: true, result: (await db.results()).items.some((r) => r.id === id) ? "already" : "unknown" };
    const [a] = queue.items.splice(i, 1);
    await S.addResult(db, { id: a.id, ref: a.ref ?? null, status, code });
    await S.updateLog(db, a.id, { status, code, doneAt: now });
    return { ok: true, result: "recorded" };
  }, { now });
}

/* ───────────── Sujets publiés ───────────── */

/** `ha.result` : ce qui est arrivé aux actions qui ont une référence d'échange (les tests n'en ont pas). Les plus récents d'abord. */
export async function resultItems(ctx, limit = 50, now = Date.now()) {
  return S.transact(ctx, async (db) => (await db.results()).items.filter((r) => r.ref).slice(0, Math.min(50, Math.max(1, limit))).map((r) => ({ ref: r.ref, id: r.id, status: r.status, code: r.code, at: iso(r.at) })), { now });
}
/** `ha.state` : un seul élément. */
export async function stateItem(ctx, now = Date.now()) {
  const st = await status(ctx, now);
  return { enabled: st.enabled, live: st.live, paired: st.paired, ...(st.lastSeenAt ? { lastSeenAt: st.lastSeenAt } : {}) };
}
