// (1.20.0) Two animated overlay elements fed by the Twitch events this module owns: the HYPE TRAIN (genre `levels`) and the SESSION COUNTER (genre `counter`).
// The module is only the PRINCIPLE: it builds a state (values, times, highlights) and the core's engine (`ctx.overlay.animateScript()`, core 0.30.0,
// docs/OVERLAY-ANIMATIONS.md) draws it in the style of the page's skin, with a plain fallback for any skin. Nothing here draws.
//
// Rules shared by both elements:
//   - Times are the SERVER's: the state route answers `now`, the page sets its clock to it; two overlay pages open at once show the same instant.
//   - A highlight starts SHOW_DELAY_MS after the server received the event (`receivedAt`): every page polls every 1.5 s, so each one has the highlight before
//     it starts and shows the same reaction (about 1.6 to 3 s after Twitch). A reloaded page sees old highlights as already over: nothing is replayed.
//   - Tests and replays move nothing: they only play a highlight (a test shows what a reaction looks like, it never changes a total).
//   - Readers never write: the elements only read the journal and the listening state.
const v = new URL(import.meta.url).search; // the version of the module spreads to the neighbour files
const st = await import(new URL(`./twitch/state.mjs${v}`, import.meta.url).href);
const home = await import(new URL(`./twitch/home.mjs${v}`, import.meta.url).href);
const hype = await import(new URL(`./twitch/hype.mjs${v}`, import.meta.url).href);

export const SHOW_DELAY_MS = 1600;
export const POLL_MS = 1500;
/** An "online" that comes back within this long after an "offline" continues the same session (a stream that dropped and restarted). */
export const REJOIN_MS = 10 * 60_000;
/** Without any "online" line, the session is the last 12 hours. */
export const ROLLING_MS = 12 * 3_600_000;
/** An ended train stays on screen this long (its celebration), then the element hides. */
export const ENDED_SHOW_MS = 20_000;
/** A test of the hype train is shown this long. */
export const TEST_SHOW_MS = 20_000;
/** A test of the counter lifts it this long, then it glides back. */
export const TEST_HOLD_MS = 8000;
export const METRICS = ["subs", "bits", "follows"];
export const LIMITS = { sessionLines: 3000, highlights: 30 };

const real = (l) => l && l.source !== "test" && l.source !== "replay";
const atOf = (l) => (Number.isFinite(l?.receivedAt) ? l.receivedAt : Number.isFinite(l?.at) ? l.at : 0);

/**
 * The session: from the newest real "online" (joining the previous ones when the stream dropped and came back within REJOIN_MS) to its "offline", or to now.
 * `lines`: journal docs, any order. Returns { from, to (null while live), live }. Without any "online": the last 12 hours, not live.
 */
export function sessionWindow(lines, now) {
  const marks = (Array.isArray(lines) ? lines : []).filter((l) => real(l) && (l.kind === "online" || l.kind === "offline")).sort((a, b) => a.at - b.at);
  let i = marks.map((m) => m.kind).lastIndexOf("online");
  if (i === -1) return { from: now - ROLLING_MS, to: null, live: false };
  let from = marks[i].at;
  // walk back: offline, then an online before it, the offline within REJOIN_MS of the newer online → same session
  while (i >= 2 && marks[i - 1].kind === "offline" && from - marks[i - 1].at <= REJOIN_MS && marks[i - 2].kind === "online") { i -= 2; from = marks[i].at; }
  const last = marks.map((x) => x.kind).lastIndexOf("online");
  const end = marks.find((m, k) => k > last && m.kind === "offline");
  return { from, to: end ? end.at : null, live: !end };
}

/** How much one line adds to a metric (0 for a line that does not count). Subs: a new sub, a resub, a gift of N (the N gifted subs are not counted twice). */
export function unitsOf(l, metric) {
  if (!l) return 0;
  if (metric === "subs") return l.kind === "sub" ? (l.gifted === true ? 0 : 1) : l.kind === "resub" ? 1 : l.kind === "gift" ? Math.max(0, Math.round(Number(l.count) || 0)) : 0;
  if (metric === "bits") return l.kind === "cheer" ? Math.max(0, Math.round(Number(l.amount) || 0)) : 0;
  if (metric === "follows") return l.kind === "follow" ? 1 : 0;
  return 0;
}

/**
 * The counter's state at `now`: the total of the session (real lines only, follows counted once per login) and one highlight per line (tests included,
 * which add nothing to the total). Pure.
 */
export function sessionState(lines, { metric = "subs", now, label = "" } = {}) {
  const m = METRICS.includes(metric) ? metric : "subs";
  const win = sessionWindow(lines, now);
  const inside = (Array.isArray(lines) ? lines : []).filter((l) => l.at >= win.from && (win.to === null || l.at <= win.to)).sort((a, b) => atOf(a) - atOf(b) || String(a.id).localeCompare(String(b.id)));
  let value = 0;
  const logins = new Set(), hl = [];
  for (const l of inside) {
    let u = unitsOf(l, m);
    if (u <= 0) continue;
    if (m === "follows" && l.login) { if (logins.has(l.login)) continue; if (real(l)) logins.add(l.login); }
    if (real(l)) value += u;
    const id = String(l.id).slice(0, 90), at = atOf(l) + SHOW_DELAY_MS;
    hl.push({ id, at, kind: "step", amount: u });
    // a test adds nothing: its amount comes back out TEST_HOLD_MS later ("drop", never celebrated), so the counter rises for the rehearsal and returns
    if (!real(l)) hl.push({ id: `${id}-back`, at: at + TEST_HOLD_MS, kind: "drop", amount: -u });
  }
  return { genre: "counter", format: "count", value, highlights: hl.filter((h) => now - h.at < 60_000).sort((a, b) => a.at - b.at).slice(-LIMITS.highlights), ...(label ? { label: label.slice(0, 60) } : {}) };
}

/**
 * The hype train's state at `now`, or null when nothing is to be shown (no train, or an ended one older than ENDED_SHOW_MS).
 * `train`: the live state (twitch/hype.mjs), `tests`: recent test lines of the train (journal docs). Pure.
 */
export function hypeState(train, { tests = [], now, label = "" } = {}) {
  let h = train && typeof train === "object" ? train : null;
  // a train whose countdown is long over without an "end" is over
  if (h && !h.ended && !hype.isActive(h, now)) h = { ...h, ended: true, endedAt: h.expiresAt ?? h.updatedAt, events: h.events ?? [] };
  const showReal = h && (!h.ended || now - (h.endedAt ?? 0) < ENDED_SHOW_MS);
  if (!showReal) {
    // a test of the train (Test button of the hype type): a short demonstration, only when no real train is on
    const t = (Array.isArray(tests) ? tests : []).filter((l) => !real(l) && String(l.kind).startsWith("hype_") && now - atOf(l) < TEST_SHOW_MS).sort((a, b) => atOf(a) - atOf(b));
    if (!t.length) return null;
    let x = null;
    for (const l of t) x = hype.noteHype(x, l, { id: l.id, receivedAt: atOf(l) });
    h = x;
  }
  const events = (h.events ?? []).slice(-LIMITS.highlights);
  const highlights = events.map((e) => ({ id: e.id, at: e.at + SHOW_DELAY_MS, kind: e.kind === "end" ? "complete" : e.kind === "level" ? "milestone" : "step", ...(e.amount > 0 ? { amount: e.amount } : {}) }));
  const goal = Math.max(1, Number(h.goal) || 1);
  return {
    genre: "levels", level: h.level ?? 1, value: Math.max(0, Math.min(goal, Number(h.progress) || 0)), target: goal,
    ...(!h.ended && Number.isFinite(h.expiresAt) ? { timer: { endsAt: h.expiresAt, total: 300_000 } } : {}),
    highlights, ...(h.ended ? { ended: true } : {}), ...(label ? { label: label.slice(0, 60) } : {}),
  };
}

/* ───────────── Demo (test mode of the overlay editor, `ov-demo=1`): a scripted loop, the same for every page at the same instant ───────────── */
export function demoState(el, now, label = "") {
  const c = Math.floor(now / 15000) * 15000, k = now - c;
  const steps = (n, from, amount = 1) => Array.from({ length: n }, (_, i) => ({ id: `d${c}-${from}-${i}`, at: c + from + i * 200, kind: "step", amount }));
  if (el === "hype") {
    return { genre: "levels", level: k < 6000 ? 2 : 3, value: k < 1000 ? 300 : k < 6000 ? 700 : 150, target: 1000, timer: { endsAt: c + 240_000 - k, total: 300_000 }, highlights: [...steps(3, 1000, 100), { id: `l${c}`, at: c + 6000, kind: "milestone" }], ...(label ? { label } : {}) };
  }
  return { genre: "counter", format: "count", value: k < 1000 ? 12 : k < 6000 ? 17 : 22, highlights: [...steps(5, 1000), ...steps(5, 6000)], ...(label ? { label } : {}) };
}

/* ───────────── Reading the data (stateful) ───────────── */
/** The topic item of another copy → a journal-like line (no `receivedAt`: its date stands in). */
export function lineOfItem(i) {
  const at = Date.parse(i?.at ?? "");
  if (!Number.isFinite(at) || typeof i?.type !== "string") return null;
  const o = { id: String(i.id ?? ""), kind: i.type, at, receivedAt: at, source: i.test ? "test" : i.replay ? "replay" : "twitch" };
  for (const k of ["login", "tier"]) if (typeof i[k] === "string") o[k] = i[k];
  for (const k of ["count", "amount", "level", "total", "goal", "progress", "expiresAt"]) if (Number.isFinite(i[k])) o[k] = i[k];
  if (i.gifted === true) o.gifted = true;
  return o;
}
const cache = new Map();   // instance → { rev, at, lines }
/** The journal lines of the last day, newest first (the copy that listens), read again only when a line was added (or after 5 s). */
async function journalLines(ctx, now) {
  const k = ctx.instance.key, rev = st.memoryOf(ctx).rev ?? 0, hit = cache.get(k);
  if (hit && hit.rev === rev && now - hit.at < 5000) return hit.lines;
  const out = [];
  let cursor;
  const floor = now - 36 * 3_600_000;
  while (out.length < LIMITS.sessionLines) {
    const page = await ctx.api.store.page(st.COL, { limit: 500, cursor, order: "desc" });
    out.push(...page.items.map(st.view));
    if (!page.next || (page.items.length && (page.items.at(-1).data?.receivedAt ?? 0) < floor)) break;
    cursor = page.next;
  }
  cache.set(k, { rev, at: now, lines: out });
  if (cache.size > 50) cache.delete(cache.keys().next().value);
  return out;
}
/** Lines for the elements: the journal on the copy that listens; the topic `twitch.event` elsewhere (another copy, or Twitch activity still installed). */
export async function linesFor(ctx, now = Date.now()) {
  const m = await home.mode(ctx);
  if (m === "on") return { lines: await journalLines(ctx, now), own: true };
  if (!(await home.twitchShown(ctx, m))) return { lines: [], own: false };
  let items = [];
  try { items = await ctx.api.topics.collect("twitch.event", { limit: 200 }); } catch { items = []; }
  return { lines: (Array.isArray(items) ? items : []).map(lineOfItem).filter(Boolean), own: false };
}

/** The answer of the state route: { now, visible, state }. `el`: "hype" | "session". */
export async function stateOf(ctx, el, query, now = Date.now()) {
  const label = String(query.get("opt-label") ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 40);
  if (query.get("demo") === "1") return { now, visible: true, state: demoState(el, now, label || ctx.t(el === "hype" ? "gauge_hype_label" : "gauge_session_label_subs")) };
  const { lines, own } = await linesFor(ctx, now);
  if (el === "hype") {
    let train = null;
    if (own) { const s = await st.readState(ctx); train = s.hype ?? hype.fromJournal(lines); }
    else train = hype.fromJournal(lines);
    const s = hypeState(train, { tests: lines.filter((l) => !real(l)), now, label: label || ctx.t("gauge_hype_label") });
    return { now, visible: s !== null, state: s ?? { genre: "levels", level: 1, value: 0, target: 1 } };
  }
  const metric = METRICS.includes(query.get("opt-count")) ? query.get("opt-count") : "subs";
  return { now, visible: true, state: sessionState(lines, { metric, now, label: label || ctx.t(`gauge_session_label_${metric}`) }) };
}

/* ───────────── The element page ───────────── */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const PAGE_SCRIPT = `(function(){var A=window.CuriosaAnimate,root=document.getElementById("st"),cfg=JSON.parse(document.getElementById("cfg").textContent);if(!A){return}
var o=A.optionsFromQuery(location.search),h=A.mount(root,{quality:o.quality,calm:o.calm,lang:o.lang,minText:o.minText,state:{genre:cfg.genre}});window.__anim=h;
function go(){fetch(cfg.url,{credentials:"omit",cache:"no-store"}).then(function(r){return r.json()}).then(function(d){if(typeof d.now==="number")h.setClock(d.now);if(d.state)h.setState(d.state);if(d.visible===false)root.style.visibility="hidden";else if(d.state)root.style.visibility="visible"}).catch(function(){}).then(function(){setTimeout(go,${POLL_MS})})}go()})();`;

/** The HTML of an element. An older core (no animation engine) shows a plain sentence instead of breaking. */
export function elementPage(ctx, el, query) {
  const genre = el === "hype" ? "levels" : "counter";
  const pass = new URLSearchParams();
  for (const k of ["opt-count", "opt-label"]) if (query.get(k)) pass.set(k, query.get(k));
  if (query.get("ov-demo") === "1") pass.set("demo", "1");
  pass.set("lang", ctx.locale);
  const url = `/m/${ctx.instance.key}/gauge-state/${el}?${pass.toString()}`;
  const head = `<!doctype html><html data-ov-region="element" lang="${esc(ctx.locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:transparent;overflow:hidden}#st{position:absolute;inset:0;visibility:hidden}</style></head>`;
  if (typeof ctx.overlay?.animateScript !== "function") return `${head}<body><div data-ov-part="text" style="font:600 24px system-ui,sans-serif;color:#fff">${esc(ctx.t("gauge_update_core"))}</div></body></html>`;
  const cfg = JSON.stringify({ url, genre }).replace(/</g, "\\u003c");
  return `${head}<body><div id="st" data-ov-part="panel"></div><script type="application/json" id="cfg">${cfg}</script><script>${ctx.overlay.animateScript()}</script><script>${PAGE_SCRIPT}</script></body></html>`;
}
export const ELEMENTS = { "hype-train": "hype", "session-counter": "session" };
export const CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'";
