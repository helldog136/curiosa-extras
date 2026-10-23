// Le moteur : lire le chat du direct (quand une page du module est ouverte), reconnaître les dons, jouer les règles, obéir à « !stop » / « !start ».
//
// AUCUN minuteur, AUCUN processus de fond. Tout part de `tick`, appelé chaque fois qu'une page du module s'affiche (la page se recharge d'elle-même tant qu'elle est ouverte :
// c'est son « battement de cœur »). Page fermée : plus rien ne tourne, plus aucun appel à YouTube. Plusieurs onglets ouverts : un seul curseur (dans le stockage), une seule opération à la fois,
// et un rendez-vous (`nextPollAt`) que personne ne devance : ils ne font jamais plus d'appels qu'un seul onglet.
//
// Ce que YouTube impose est respecté : on ne relit pas le chat plus tôt que `pollingIntervalMillis`, ni plus souvent que le réglage ; une erreur ne se boucle jamais (pause qui double jusqu'à
// 10 minutes, ou jusqu'à la remise à zéro de la limite du jour) ; au budget du jour atteint, la lecture s'arrête doucement.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const S = await import(`./store.mjs${v}`);
const R = await import(`./rules.mjs${v}`);
const C = await import(`./chat.mjs${v}`);
const EV = await import(`./events.mjs${v}`);
const B = await import(`./bridge.mjs${v}`);
const { settingsOf, budgetUnits } = await import(`./settings.mjs${v}`);

/** Millisecondes et bornes, dans un objet pour que les tests puissent les raccourcir. */
export const timing = {
  idleMs: 60_000,            // pas de direct : on revérifie chaque minute (2 unités de limite chaque fois, environ 1 % par heure)
  heartbeatMs: 90_000,       // une page est « ouverte » si elle s'est montrée depuis moins de 90 s
  reloadMaxMs: 60_000,       // la page se recharge au moins chaque minute
  reloadMinMs: 4_000,
  renderBudgetMs: 4_500,     // la page n'attend jamais plus longtemps un tour de lecture (il se termine ensuite tout seul)
  endedGapMs: 30_000,        // direct fini : on regarde s'il y en a un autre dans 30 s
  errorBaseMs: 15_000, errorMaxMs: 600_000,
  restartAfterMs: 300_000,   // page rouverte après une absence plus longue : on repart du chat actuel (curseur oublié)
  maxEvents: 100,            // dons et ordres traités par lecture
  commandMaxAgeMs: 60_000,   // « !stop » / « !start » plus vieux que cela : ignorés (jamais rejoués par un chat relu)
  waitLostMs: 330_000,       // une action confiée à la maison sans nouvelle depuis ce temps : « pas de nouvelle »
  simGapMs: 3_000, simPerHour: 30,
  pageMax: 500,
  requestMs: 8000,           // un appel au chat, d'un bout à l'autre
};
const COST_CHAT = 5;

/** Le jour de la limite de YouTube (Californie) : « 2026-10-20 ». */
export const pacificDay = (now) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
const rollover = (d, now) => { const day = pacificDay(now); if (d.usage.day !== day) d.usage = { day, units: 0 }; };

/* ───────────── Ce qu'on a reçu de la maison ───────────── */

const collect = async (ctx, topic, limit) => { try { const a = await B.within(ctx.api.topics.collect(topic, { limit }), 3000, []); return Array.isArray(a) ? a : []; } catch { return []; } };

/** Les résultats de la maison (`ha.result`) mettent à jour les lignes « confié à la maison » du journal. Ne lève jamais. */
export async function reconcile(ctx, { now = Date.now() } = {}) {
  try {
    const waiting = (await S.readJournal(ctx)).filter((e) => e.status === "sent" && e.ref);
    if (!waiting.length) return;
    const byRef = new Map((await collect(ctx, "ha.result", 100)).filter((x) => x && typeof x.ref === "string").map((x) => [x.ref, x]));
    await S.updateJournal(ctx, (cur) => cur.map((e) => {
      if (e.status !== "sent" || !e.ref) return e;
      const r = byRef.get(e.ref);
      if (r) return { ...e, status: ["done", "failed", "ignored", "expired", "refused"].includes(r.status) ? r.status : "failed", code: String(r.code ?? "").slice(0, 20), doneAt: now };
      return now - e.at > timing.waitLostMs ? { ...e, status: "lost" } : e;
    }));
  } catch { /* le suivi est un plus : le journal reste tel quel */ }
}

/* ───────────── Jouer les règles ───────────── */

function lineOf(ev, extra) {
  return {
    kind: ev.kind, who: ev.test ? "Test" : ev.who,
    ...(ev.micros !== undefined ? { micros: ev.micros, currency: ev.currency } : {}), ...(ev.count !== undefined ? { count: ev.count } : {}),
    ...(ev.test ? { test: true } : {}), ...extra,
  };
}

/** Confie l'action d'une règle à la maison. Rend la ligne de journal. */
async function dispatch(ctx, s, rule, ev, { idx = 0, now }) {
  const tts = R.isTts(rule.action);
  const wantsMessage = tts && rule.readMessage === true && ev.text;
  const text = tts ? (wantsMessage ? ev.text : s.thanks) : undefined;
  const ref = ev.test ? `yt-test-${now.toString(36)}-${idx}-${Math.random().toString(36).slice(2, 7)}` : S.refOf(`${ev.id}:${rule.id}`);
  const base = { key: rule.action, viewer: ev.test ? "Test" : ev.who, ref, ...(ev.test ? { test: true } : {}) };
  let r = await B.enqueue(ctx, { ...base, ...(tts ? { text } : {}) });
  let thanks = false, usedRef = ref;
  if (!r.ok && r.reason === "blocked" && wantsMessage && s.ifRefused === "thanks") {   // le message est refusé : on dit seulement merci
    usedRef = `${ref}-t`;
    r = await B.enqueue(ctx, { ...base, ref: usedRef, text: s.thanks });
    thanks = r.ok;
  }
  if (r.ok && !ev.test) { rule.lastAt = now; await S.touchRule(ctx, rule.id, now).catch(() => {}); }
  return lineOf(ev, { rule: rule.name, key: rule.action, status: r.ok ? "sent" : "refused", ...(r.ok ? { ref: usedRef, haId: r.id } : { reason: r.reason }), ...(thanks ? { thanks: true } : {}), ...(wantsMessage && !r.ok && r.reason === "blocked" ? { voiceRefused: true } : {}) });
}

/** Un don arrive (vrai ou simulé) : les règles qui s'appliquent, le délai de recharge, l'envoi. Rend les lignes de journal. */
export async function handleDonation(ctx, s, rules, ev, { now = Date.now() } = {}) {
  const matches = R.matching(rules, ev);
  if (!matches.length) return [lineOf(ev, { status: "skipped", reason: "no_rule" })];
  const lines = [];
  let i = 0;
  for (const rule of matches) {
    const left = ev.test ? 0 : R.cooldownLeft(rule, now);
    if (left > 0) { lines.push(lineOf(ev, { rule: rule.name, key: rule.action, status: "skipped", reason: "cooldown", seconds: left })); continue; }
    lines.push(await dispatch(ctx, s, rule, ev, { idx: i++, now }));
  }
  return lines;
}

/** Répond dans le chat SI c'est possible (le connecteur dit qu'il sait écrire) ; sinon rien, sans erreur. Aujourd'hui le connecteur ne sait pas écrire : voir README. */
async function reply(ctx, chatId, text) {
  try {
    const st = await B.youtube(ctx, "status", {});
    if (st?.chat?.write !== true || !chatId) return false;
    const r = await B.youtube(ctx, "chatPost", { liveChatId: chatId, text: String(text).slice(0, 190) });
    return r?.ok === true;
  } catch { return false; }
}

const byOf = (ev, cmd) => `${ev.isOwner || cmd === "start" ? "yt" : "mod:yt"}:${ev.who}`.slice(0, 40);
/** « !stop » / « !start » écrits dans le chat. Rend la ligne de journal. */
async function handleCommand(ctx, s, ev, chatId) {
  const line = (extra) => ({ kind: "command", command: ev.command, who: ev.who, ...extra });
  if (!C.mayCommand(ev, s)) return line({ status: "refused", reason: "role" });
  const r = await B.bridge(ctx, ev.command, { by: byOf(ev, ev.command) });
  const ok = r.ok && r.value?.ok !== false;
  if (!ok) return line({ status: "failed", reason: r.ok ? "refused" : "not_installed" });
  await reply(ctx, chatId, ctx.t(ev.command === "stop" ? "chat_stopped" : "chat_started"));
  return line({ status: "done" });
}

/** Traite les messages d'une lecture. Rend { lines, old } : les lignes de journal, et le nombre de dons trop anciens ignorés. */
export async function processItems(ctx, s, st, items, now) {
  const rules = await S.listRules(ctx);
  const seen = new Set(st.seen);
  const lines = [];
  let old = 0, done = 0;
  for (const item of items) {
    const ev = C.parseItem(item, now);
    if (!ev || ev.kind === "invalid") continue;
    const fp = S.fingerprint(ev.id);
    if (seen.has(fp)) continue;
    if (done >= timing.maxEvents) break;   // borne dure (invraisemblable sur 500 messages) : le reste de cette page est laissé
    seen.add(fp); st.seen.push(fp); done++;
    if (ev.kind === "command") {
      if (now - ev.at > timing.commandMaxAgeMs) { old++; continue; }
      lines.push(await handleCommand(ctx, s, ev, st.chatId));
    } else if (now - ev.at > s.maxAgeMs) old++;
    else {
      // Les autres modules (l'overlay d'alertes) peuvent afficher le don, qu'une règle l'attende ou non (sujet `live.event`, en mémoire, voir events.mjs).
      if (s.shareAlerts) EV.remember(ctx, ev, fp, now);
      // Sans la maison (lecture « alertes seulement ») : rien à jouer, on le note dans le journal.
      if (s.houseless) lines.push(lineOf(ev, { status: "skipped", reason: "alert_only" }));
      else lines.push(...(await handleDonation(ctx, s, rules, ev, { now })));
    }
  }
  return { lines, old };
}

/* ───────────── Un tour de lecture ───────────── */

const ERR_FATAL = new Set(["config", "unavailable", "auth", "chat_denied", "channel", "invalid"]);
function failure(d, code, now, retryAt) {
  d.errors = (d.errors || 0) + 1;
  const wait = ERR_FATAL.has(code) ? timing.errorMaxMs : Math.min(timing.errorMaxMs, timing.errorBaseMs * 2 ** Math.min(d.errors - 1, 6));
  d.backoffUntil = Math.max(now + wait, Number(retryAt) > now ? Number(retryAt) : 0);
  d.error = { code, at: now, retryAt: d.backoffUntil };
  d.status = "backoff";
}

/**
 * Un tour : battement de cœur, puis (si c'est l'heure) chercher le direct ou lire le chat. Une seule fois à la fois ; ne lève jamais.
 * Rend l'état après le tour.
 */
export function tick(ctx, { now = Date.now() } = {}) {
  return S.serial(ctx, "tick", () => tickNow(ctx, now)).catch((e) => {
    console.error(`[youtube-live-actions] ${ctx.instance.key}: tour de lecture en échec (${e?.message ?? e})`);
    return S.readState(ctx);
  });
}
async function tickNow(ctx, now) {
  const s = settingsOf(ctx);
  const set = (status, extra = {}) => S.updateState(ctx, (d) => { d.status = status; Object.assign(d, extra); });
  const st = await S.updateState(ctx, (d) => { d.lastBeatAt = now; rollover(d, now); });
  if (!s.readChat) return set("off");
  // Sans Home Assistant, rien ne peut se déclencher chez vous : le chat n'est alors lu que si la propriétaire l'a demandé (pour les alertes de l'overlay).
  if (!(await B.installed(ctx, B.BRIDGE))) { if (!s.readWithoutHouse) return set("no_bridge"); s.houseless = true; }
  if (!(await B.installed(ctx, B.API))) return set("no_api");
  if (st.backoffUntil > now) return st.status === "backoff" ? st : set("backoff");
  if (st.usage.units + COST_CHAT > budgetUnits(s)) return set("budget");
  if (st.lastPollAt && now - st.lastPollAt > timing.restartAfterMs && st.chatId) await S.updateState(ctx, (d) => { d.cursor = null; d.nextPollAt = 0; });   // page rouverte après une longue absence
  let cur = await S.readState(ctx);
  // 1. Trouver le direct.
  if (!cur.chatId) {
    if (cur.nextDetectAt > now) return set(cur.noChat ? "no_chat" : "idle");
    const ch = await B.channelOf(ctx);
    if (!ch.id) return set(ch.code === "none" ? "no_channel" : ch.code === "ambiguous" ? "ambiguous" : "unverified");
    const r = await B.currentLive(ctx, ch.id);
    const cost = r.ok ? Number(r.cost) || 0 : 0;
    if (!r.ok) return S.updateState(ctx, (d) => { d.usage.units += cost; failure(d, String(r.error ?? "network"), now, r.retryAt); });
    if (!r.live) return S.updateState(ctx, (d) => { d.usage.units += cost; d.errors = 0; d.error = null; d.chatId = null; d.cursor = null; d.noChat = false; d.videoId = null; d.title = ""; d.nextDetectAt = now + timing.idleMs; d.status = "idle"; });
    if (!r.chatId) return S.updateState(ctx, (d) => { d.usage.units += cost; d.errors = 0; d.error = null; d.chatId = null; d.noChat = true; d.videoId = r.videoId ?? null; d.title = String(r.title ?? "").slice(0, 100); d.nextDetectAt = now + timing.idleMs; d.status = "no_chat"; });
    cur = await S.updateState(ctx, (d) => {
      d.usage.units += cost; d.errors = 0; d.error = null; d.noChat = false; d.chatId = r.chatId; d.videoId = r.videoId ?? null; d.title = String(r.title ?? "").slice(0, 100);
      d.startedAt = r.startedAt ?? null; d.cursor = null; d.seen = []; d.nextPollAt = 0; d.status = "reading";
    });
  }
  // 2. Lire le chat, pas avant l'heure.
  if (cur.nextPollAt > now) return set("reading");
  if (cur.usage.units + COST_CHAT > budgetUnits(s)) return set("budget");
  const p = await B.youtube(ctx, "request", { endpoint: "liveChatMessages.list", params: { liveChatId: cur.chatId, maxResults: timing.pageMax, ...(cur.cursor ? { pageToken: cur.cursor } : {}) }, priority: "background", timeoutMs: timing.requestMs });
  const cost = p.ok ? Number(p.cost) || 0 : 0;
  if (!p.ok || p.stale || p.status !== 200) {
    const code = String(p.error ?? "network");
    if (code === "chat_ended") return S.updateState(ctx, (d) => { d.chatId = null; d.cursor = null; d.nextDetectAt = now + timing.endedGapMs; d.errors = 0; d.error = null; d.status = "idle"; });
    if (code === "chat_disabled") return S.updateState(ctx, (d) => { d.chatId = null; d.cursor = null; d.noChat = true; d.nextDetectAt = now + timing.idleMs; d.errors = 0; d.error = null; d.status = "no_chat"; });
    return S.updateState(ctx, (d) => { d.usage.units += cost; failure(d, p.ok ? "network" : code, now, p.retryAt); });
  }
  const json = p.json && typeof p.json === "object" ? p.json : {};
  const items = (Array.isArray(json.items) ? json.items : []).slice(0, timing.pageMax);
  const pollMs = Math.min(120_000, Math.max(0, Math.trunc(Number(json.pollingIntervalMillis)) || 0));
  const work = { ...cur, seen: cur.seen.slice() };
  const { lines, old } = await processItems(ctx, s, work, items, now);
  const out = [...lines];
  if (old) out.push({ kind: "system", event: "old", count: old });
  if (out.length) await S.addJournal(ctx, out);
  const ended = typeof json.offlineAt === "string" && json.offlineAt;
  const token = typeof json.nextPageToken === "string" && /^[\w.=-]{1,400}$/.test(json.nextPageToken) ? json.nextPageToken : cur.cursor;
  return S.updateState(ctx, (d) => {
    d.usage.units += cost; d.polls = (d.polls || 0) + 1; d.lastPollAt = now; d.pollingMs = pollMs; d.errors = 0; d.error = null; d.backoffUntil = 0;
    d.cursor = token; d.seen = Array.from(new Set([...d.seen, ...work.seen])).slice(-S.LIMITS.seen);
    d.nextPollAt = now + Math.max(s.intervalMs, pollMs);
    if (ended) { d.chatId = null; d.cursor = null; d.nextDetectAt = now + timing.endedGapMs; d.status = "idle"; } else d.status = "reading";
  });
}

/* ───────────── Simulation : le même chemin qu'un vrai don, sans rien demander à YouTube ───────────── */

const sims = new Map();
export const resetSims = () => sims.clear();
const KINDS = new Set(R.TYPES);
/**
 * Simule un don. `input` : { type, amount?, currency?, count?, text? } (texte du formulaire). Passe par les règles et par le service de la maison comme un vrai don ;
 * AUCUN appel à YouTube, pas de délai de recharge consommé. Rend { ok: true, lines } ou { ok: false, code, field? }.
 */
export async function simulate(ctx, input, { now = Date.now() } = {}) {
  const k = ctx.instance.key, m = sims.get(k) ?? { last: 0, hour: [] };
  m.hour = m.hour.filter((t) => now - t < 3_600_000);
  if (now - m.last < timing.simGapMs) return { ok: false, code: "too_fast" };
  if (m.hour.length >= timing.simPerHour) return { ok: false, code: "too_many" };
  const kind = String(input?.type ?? "superchat");
  if (!KINDS.has(kind)) return { ok: false, code: "bad_type", field: "type" };
  const ev = { id: `test-${now}`, at: now, kind, who: "Test", isOwner: false, isMod: false, test: true, text: "" };
  if (R.MONEY_TYPES.includes(kind)) {
    const micros = R.toMicros(input?.amount ?? "5");
    const currency = String(input?.currency ?? "EUR").trim().toUpperCase();
    if (micros === null || micros > R.MAX_MICROS) return { ok: false, code: "bad_amount", field: "amount" };
    if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, code: "bad_currency", field: "currency" };
    ev.micros = micros; ev.currency = currency;
    if (kind === "superchat") ev.text = String(input?.text ?? "").normalize("NFKC").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
  } else if (kind === "gift") {
    const raw = String(input?.count ?? "5").trim() || "5";
    const n = /^\d{1,4}$/.test(raw) ? Number(raw) : NaN;
    if (!(n >= 1 && n <= 1000)) return { ok: false, code: "bad_count", field: "count" };
    ev.count = n;
  }
  if (!(await B.installed(ctx, B.BRIDGE))) return { ok: false, code: "no_bridge" };
  m.last = now; m.hour.push(now); sims.set(k, m);
  const rules = await S.listRules(ctx);
  const lines = await handleDonation(ctx, settingsOf(ctx), rules, ev, { now });
  const added = await S.addJournal(ctx, lines);
  return { ok: true, lines: added };
}

/* ───────────── Ce que la page et les outils lisent ───────────── */

/** Tout ce qu'il faut pour dessiner la page, lu sans rien écrire. */
export async function overview(ctx, now = Date.now()) {
  const s = settingsOf(ctx);
  const [state, rules, journal, house] = await Promise.all([S.readState(ctx), S.listRules(ctx), S.readJournal(ctx), B.houseStatus(ctx)]);
  const day = pacificDay(now);
  const units = state.usage.day === day ? state.usage.units : 0;
  const open = state.lastBeatAt > 0 && now - state.lastBeatAt <= timing.heartbeatMs;
  return { now, s, state, rules, journal, house, units, budget: budgetUnits(s), open, reading: open && state.status === "reading" };
}
