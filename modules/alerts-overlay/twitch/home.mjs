// (1.18.0) Where the Twitch part of the alerts overlay runs, and whether it runs. Since this version the overlay holds what the module "Twitch activity" did (listening,
// journal, OBS dock, per-type and per-reward reactions): ONE copy listens to Twitch, the "home" (the first copy of the overlay, as the reaction editor of Twitch activity
// already chose). The other copies keep showing the Twitch alerts: they read the topic `twitch.event` that the home offers, exactly as they read Twitch activity before.
//
// Modes of a copy:
//   - "guest": not the home (another copy of the overlay): no listening, no journal, no Twitch tab of its own but its own look of the alerts;
//   - "off": the home, but the site has no Twitch connection (alerts sent by another tool, YouTube): nothing Twitch is shown in its page, nothing runs;
//   - "waiting": Twitch activity is still installed and has not handed over yet: this copy shows its alerts as before (it reads its topic) and listens to nothing;
//   - "on": the home listens to Twitch.
//
// The hand-over (once): Twitch activity 1.13.0 offers the service `twitch.events.handover`. `release` stops its listening at Twitch (its subscriptions are deleted, its
// tasks stop), then `export` gives its journal, its state and its options, page by page; they are copied here (idempotent: the journal is keyed by the Twitch message id)
// and a document `handover` says it is done. The next pass creates the subscriptions on this copy's own address. Nothing of Twitch activity is ever deleted: the owner
// removes the module afterwards (its data is then set aside by the core, as for any removal).
const v = new URL(import.meta.url).search; // the version of the module spreads to the neighbour files
const st = await import(`./state.mjs${v}`);
const opt = await import(`./settings.mjs${v}`);

export const MODULE = "alerts-overlay", OLD = "twitch-events", HANDOVER = "twitch.events.handover", API = "twitch.api";
export const DOC = "handover";
export const LIMITS = { exportPages: 40, exportPage: 250 };

/* ───────────── The pieces given by the overlay (index.mjs): how to show an alert, and how a test alert is built ───────────── */
const wired = (globalThis.__curiosaAlertsTwitchWire ??= { emit: null, sample: null });
/** index.mjs gives its `emit(key, alert)` and `sampleAlert(ctx, type, now, config, extra)`; no import back (no cycle). */
export function wire({ emit, sample }) { if (emit) wired.emit = emit; if (sample) wired.sample = sample; }
export const emitter = (ctx) => (a) => (typeof wired.emit === "function" ? wired.emit(ctx.instance.key, a) : false);
export const sampler = () => wired.sample;

/* ───────────── Which copy ───────────── */
async function copies(ctx) {
  try { const l = await ctx.api.instances.list({ module: MODULE }); return (Array.isArray(l) ? l : []).filter((i) => i?.module === MODULE); } catch { return []; }
}
/** Is this copy the home of the Twitch part? The first copy of the overlay; a list that does not know this copy (a test, a copy being created) counts it as the home. */
export async function isHome(ctx) {
  const list = await copies(ctx);
  if (!list.length || !list.some((i) => i.key === ctx.instance.key)) return true;
  return list[0].key === ctx.instance.key;
}
/** The address of the home's page (for a link from another copy), or null. */
export async function homePath(ctx) { const l = await copies(ctx); return l[0]?.adminPath ?? null; }
/** Twitch activity, still installed: { key, adminPath } or null. */
export async function oldOne(ctx) {
  try { const l = await ctx.api.instances.list({ module: OLD }); const i = (Array.isArray(l) ? l : []).find((x) => x?.module === OLD); return i ? { key: String(i.key), id: String(i.id ?? ""), adminPath: i.adminPath ?? null } : null; } catch { return null; }
}
/** Does the site have a Twitch connection (the Twitch connector)? */
export async function twitchHere(ctx) {
  try { const p = await ctx.api.services.providers(API); return Array.isArray(p) && p.length > 0; } catch { return false; }
}
/** The hand-over document: { state: "done", from, at, lines, releasedAt } or null. */
export async function handoverOf(ctx) {
  const s = await st.readState(ctx);
  return s[DOC] && typeof s[DOC] === "object" ? s[DOC] : null;
}
/** The mode of this copy (see the header). Never throws. */
export async function mode(ctx) {
  try {
    if (!(await isHome(ctx))) return "guest";
    const [old, ho] = await Promise.all([oldOne(ctx), handoverOf(ctx)]);
    if (old && ho?.state !== "done") return "waiting";
    return (await twitchHere(ctx)) ? "on" : "off";
  } catch { return "off"; }
}
/** The Twitch part shows in the page of this copy: the home with Twitch (or still waiting for the hand-over), or another copy on a site that has Twitch. */
export async function twitchShown(ctx, m) {
  const mm = m ?? (await mode(ctx));
  if (mm === "on" || mm === "waiting") return true;
  if (mm === "guest") return (await twitchHere(ctx)) || !!(await oldOne(ctx));
  return false;
}

/* ───────────── The hand-over ───────────── */
const call = async (ctx, method, args) => { try { const r = await ctx.api.services.call(HANDOVER, method, args); return r?.ok ? r.value : null; } catch { return null; } };
/** Can Twitch activity hand over (version 1.13.0 or later)? */
export async function canHandOver(ctx) {
  try { const p = await ctx.api.services.providers(HANDOVER); return Array.isArray(p) && p.length > 0; } catch { return false; }
}
const STATE_KEYS = ["enabled", "dockSecret", "liveSince", "lastEventAt", "okAt", "subLogins", "catchup", "last"];
const LINE = /^[A-Za-z0-9._:-]{1,100}$/;
/** A line of the old journal, made safe: the fields of a journal line only, the id checked, the address of its first journal kept (`from`). */
export function importLine(d, from) {
  if (!d || typeof d !== "object" || !LINE.test(String(d.id ?? ""))) return null;
  const out = st.toDoc(String(d.id), d, { source: ["twitch", "test", "replay", "catchup"].includes(d.source) ? d.source : "twitch", of: d.of ?? null, now: Number.isFinite(d.receivedAt) ? d.receivedAt : Date.now(), missed: d.missed === true });
  if (Number.isFinite(d.at)) out.at = d.at;
  if (d.flag && typeof d.flag === "object") out.flag = { reason: String(d.flag.reason ?? "").slice(0, 20), state: String(d.flag.state ?? "").slice(0, 20), at: Number(d.flag.at) || 0 };
  out.from = String(from).slice(0, 60);
  return out;
}
/**
 * Takes over Twitch activity once (the home only, mode "waiting"). { done: true, lines } or { done: false, code: "not_home" | "nothing" | "old" (no hand-over service yet) | "failed" }.
 * Safe to call at every pass: once done, it returns at once; a failure half way is taken up again at the next pass (nothing is lost, nothing is copied twice).
 */
export async function takeOver(ctx, { now = Date.now() } = {}) {
  if (!(await isHome(ctx))) return { done: false, code: "not_home" };
  const ho = await handoverOf(ctx);
  if (ho?.state === "done") return { done: true, lines: ho.lines ?? 0, already: true };
  const old = await oldOne(ctx);
  if (!old) return { done: false, code: "nothing" };
  if (!(await canHandOver(ctx))) return { done: false, code: "old" };
  const rel = await call(ctx, "release", { by: ctx.instance.key });
  if (!rel?.ok) return { done: false, code: "failed" };
  let after = null, lines = 0, first = null;
  for (let page = 0; page < LIMITS.exportPages; page++) {
    const r = await call(ctx, "export", { after, limit: LIMITS.exportPage });
    if (!r?.ok) return { done: false, code: "failed" };
    if (!first) first = r;
    for (const d of Array.isArray(r.lines) ? r.lines : []) {
      const doc = importLine(d, r.key ?? old.key);
      if (!doc) continue;
      if (await ctx.api.store.getByKey(st.COL, doc.id)) continue;
      await ctx.api.store.add(st.COL, doc, { key: doc.id });
      lines++;
    }
    if (!r.next) break;
    after = r.next;
  }
  const from = String(first?.key ?? old.key);
  const released = Number(rel.at) || now;
  await st.updateState(ctx, (x) => {
    const s = first?.state && typeof first.state === "object" ? first.state : {};
    for (const k of STATE_KEYS) if (s[k] !== undefined && x[k] === undefined) x[k] = s[k];
    const o = first?.options && typeof first.options === "object" ? first.options : {};
    const keep = {};
    if (o.retentionDays !== undefined) keep.retentionDays = o.retentionDays;
    if (o.healthMail !== undefined) keep.healthMail = o.healthMail;
    if (o.silentHours !== undefined) keep.silentHours = o.silentHours;
    if (typeof o.channel === "string" && o.channel) keep.channel = o.channel;
    x.options = { ...keep, ...(x.options ?? {}) };
    // the listening stopped there at `released`: the next pass catches up what Twitch lets us read since then
    if (s.okAt || x.okAt) x.gapSince = Math.min(released, x.gapSince ?? released);
    x[DOC] = { state: "done", from, at: now, lines, releasedAt: released, callback: typeof rel.callback === "string" ? rel.callback.slice(0, 300) : null };
  });
  st.memoryOf(ctx).rev = (st.memoryOf(ctx).rev ?? 0) + 1;
  await opt.loadOptions(ctx);
  try { await ctx.api.log?.write?.({ action: "twitch.handover", target: from, data: { from, lines } }); } catch { /* the log never breaks the hand-over */ }
  return { done: true, lines };
}
