// The admin page: one status line, the journal of events (live search, filters, replay), and the list of types with a switch and a test button each.
// For a person who is not technical: sentences, no jargon, and every problem says what to do.
const v = new URL(import.meta.url).search; // the version of the module spreads to the neighbour files (otherwise the old code would stay cached after an update)
const es = await import(`./eventsub.mjs${v}`);
const st = await import(`./state.mjs${v}`);
const pub = await import(`./publish.mjs${v}`);
const { settingsOf } = await import(`./settings.mjs${v}`);
const { diagnose, ensureListening, declareScopes } = await import(`./listen.mjs${v}`);
const { API } = await import(`./channel.mjs${v}`);

/** Colour of the badge of each kind (always written next to it: the colour alone never carries the meaning). */
export const TONE = { follow: "ok", sub: "accent", resub: "accent", gift: "accent", cheer: "warn", raid: "info", online: "ok", offline: "neutral", hype_begin: "warn", hype_progress: "warn", hype_end: "neutral", redeem: "neutral" };
export const SCOPE_KEY = { "moderator:read:followers": "scope_follow", "channel:read:subscriptions": "scope_subs", "bits:read": "scope_bits", "channel:read:hype_train": "scope_hype", "channel:read:redemptions": "scope_redeem" };

const fmtDate = (ctx, at) => new Date(at).toLocaleString(ctx.locale, { dateStyle: "short", timeStyle: "short", timeZone: ctx.timezone });
const num = (ctx, n) => new Intl.NumberFormat(ctx.locale).format(n);

/** The details of a line, in words: "12 months · tier 2", "500 bits", "42 viewers"… */
export function detail(ctx, d) {
  const t = ctx.t, p = [];
  const tier = d.tier ? t("d_tier", { n: d.tier }) : "";
  switch (d.kind) {
    case "sub": p.push(d.gifted ? t("d_gifted") : tier); break;
    case "resub": p.push(t("d_months", { n: d.months ?? 0 }), tier); break;
    case "gift": p.push(t("d_gift", { n: d.count ?? 0 }), tier); break;
    case "cheer": p.push(t("d_bits", { n: num(ctx, d.amount ?? 0) })); break;
    case "raid": p.push(t("d_viewers", { n: num(ctx, d.viewers ?? 0) })); break;
    case "hype_begin": case "hype_progress": case "hype_end": p.push(t("d_level", { n: d.level ?? 1 }), t("d_points", { n: num(ctx, d.total ?? 0) })); break;
    case "redeem": p.push(d.title ?? "", d.amount ? t("d_cost", { n: num(ctx, d.amount) }) : ""); break;
    default: break;
  }
  if (d.source === "test") p.push(t("d_test"));
  if (d.source === "replay") p.push(t("d_replay"));
  if (d.missed) p.push(t("d_missed"));
  return p.filter(Boolean).join(" · ");
}
const who = (ctx, d) => (d.anonymous ? ctx.t("anonymous") : d.name || "");

/* ───────────── Status line ───────────── */

async function connectLinks(ctx, d) {
  if (!d.channel) return [];
  const r = (await ctx.api.services.callAll(API, "connectLink", { channel: d.channel, slot: "main" })).find((x) => x.ok && x.value?.ok);
  return r?.value?.url ? [{ type: "links", items: [{ label: ctx.t("connect_btn"), href: r.value.url }] }] : [];
}
async function alertsLink(ctx) {
  let list = [];
  try { list = await ctx.api.instances.list({ module: "alerts-overlay" }); } catch { list = []; }
  const a = Array.isArray(list) ? list[0] : null;
  return a ? { type: "links", items: [{ label: ctx.t("alerts_link"), href: a.adminPath }] } : { type: "markdown", text: ctx.t("alerts_absent") };
}

/** Why it does not listen yet, in a sentence, and what to do. */
export function problemText(ctx, code, d = {}, state = {}) {
  const t = ctx.t;
  if (code === "need_more") {
    const names = (d.missing ?? state.listen?.missing ?? []).map((s) => (SCOPE_KEY[s] ? t(SCOPE_KEY[s]) : s));
    return t("listen_need_more", { list: names.join(", ") || "…" });
  }
  return t(`listen_${code}`, { detail: state.rejected?.reason ?? "" });
}

async function statusBlocks(ctx, d, state) {
  const t = ctx.t, listen = state.listen ?? {};
  const code = d.code !== "ready" ? d.code : listen.code ?? "unknown";
  const out = [];
  const typesOn = Object.values(st.enabledOf(state)).filter(Boolean).length;
  if (code === "listening") {
    const last = state.lastEventAt ? t("status_last", { when: fmtDate(ctx, state.lastEventAt) }) : t("status_none_yet");
    out.push({ type: "banner", tone: "success", text: `${t("status_listening", { n: typesOn })} ${last}` });
  } else {
    out.push({ type: "banner", tone: "warning", text: problemText(ctx, code, d, state) });
    if (["need_connect", "need_reconnect", "need_more"].includes(code)) out.push({ type: "markdown", text: t("connect_steps") }, ...(await connectLinks(ctx, d)));
    else if (code === "creds_missing" && d.main?.adminPath) out.push({ type: "markdown", text: t("creds_steps", { href: d.main.adminPath }) });
    else if (code === "no_channel") out.push({ type: "markdown", text: t("no_channel_steps") });
  }
  if (state.revoked && Date.now() - state.revoked.at < 86_400_000) out.push({ type: "banner", tone: "warning", text: t("revoked_note", { when: fmtDate(ctx, state.revoked.at) }) });
  // The "Check now" button is only worth its space when something is wrong (the Types tab has one too).
  if (code !== "listening") out.push({ type: "adminForm", action: "check", submitLabel: t("check_btn"), fields: [] });
  return out;
}

/* ───────────── The pages ───────────── */

export async function panel(ctx, { query } = {}) {
  const t = ctx.t, s = settingsOf(ctx);
  const [d, state, lines] = await Promise.all([diagnose(ctx, s, { declare: false }), st.readState(ctx), st.recent(ctx, 300)]);
  const enabled = st.enabledOf(state);
  const rows = lines.map((l) => [
    fmtDate(ctx, l.at),
    { text: t(`kind_${l.kind}`), badge: TONE[l.kind] ?? "neutral" },
    who(ctx, l),
    { text: detail(ctx, l), title: l.text ? `${detail(ctx, l)} — ${l.text}` : undefined },
  ]);
  const typeRows = es.TYPES.map((ty) => {
    const code = state.types?.[ty.id]?.code ?? "unknown";
    const on = enabled[ty.id] === true;
    const label = !on ? t("state_off") : t(`state_${code}`) ;
    const tone = !on ? "neutral" : code === "listening" ? "ok" : ["pending", "unknown"].includes(code) ? "info" : "warn";
    const perms = ty.scopes.length ? ty.scopes.map((x) => t(SCOPE_KEY[x])).join(", ") : t("scope_none");
    return [{ text: t(`type_${ty.id}`), title: t(`type_${ty.id}_help`) }, t(`type_${ty.id}_help`), perms, { text: label, badge: tone },
      { text: on ? t("on") : t("off"), switch: { on, action: "setEnabled", label: t("switch_label", { type: t(`type_${ty.id}`) }), onText: t("on"), offText: t("off") } }];
  });
  return [
    { type: "markdown", text: t("page_intro") },
    ...(await statusBlocks(ctx, d, state)),
    await alertsLink(ctx),
    { type: "table", columns: [t("col_when"), t("col_type"), t("col_who"), t("col_detail")], rows, rowIds: lines.map((l) => l.id), searchable: true, searchPlaceholder: t("search"), filters: [{ column: 1, allLabel: t("filter_all") }], truncate: [3], pageSize: 50, empty: t("empty"),
      rowActions: [{ label: t("replay_btn"), action: "replay" }, { label: t("remove_btn"), action: "remove", danger: true, confirm: t("remove_confirm") }] },
    { type: "markdown", tab: "types", text: t("types_intro") },
    { type: "adminForm", tab: "types", action: "check", submitLabel: t("check_btn"), fields: [] },
    { type: "table", tab: "types", columns: [t("col_type"), t("col_what"), t("col_permission"), t("col_state"), t("col_on")], rows: typeRows, rowIds: es.TYPES.map((x) => x.id), pageSize: 0,
      rowActions: [{ label: t("test_btn"), action: "test" }] },
  ];
}

/* ───────────── Actions ───────────── */

const fail = (ctx, key, vars) => ({ error: ctx.t(key, vars) });
export const actions = {
  async check(ctx) {
    const r = await ensureListening(ctx, settingsOf(ctx), { settle: true });
    return r.code === "listening" ? { ok: ctx.t("check_ok") } : { error: problemText(ctx, r.code, await diagnose(ctx, settingsOf(ctx), { declare: false }), await st.readState(ctx)) };
  },
  /** The switch of a type: SAYS the wanted state (never inverts). Declares the permissions that become needed, then brings the subscriptions in line. */
  async setEnabled(ctx, values) {
    const id = String(values.id ?? "");
    if (!es.typeOf(id)) return fail(ctx, "err_unknown_type");
    const on = values.enabled === "1";
    const state = await st.updateState(ctx, (x) => { x.enabled = { ...st.enabledOf(x), [id]: on }; });
    const s = settingsOf(ctx), d = await diagnose(ctx, s, { declare: true });
    const r = await ensureListening(ctx, s).catch(() => null);
    if (on && d.code === "ready" && r && r.code === "need_more") return { ok: ctx.t("switch_need_more", { type: ctx.t(`type_${id}`) }) };
    return { ok: ctx.t(on ? "switch_on" : "switch_off", { type: ctx.t(`type_${id}`) }) };
  },
  async test(ctx, values) {
    const r = await pub.sendTest(ctx, String(values.id ?? ""));
    if (!r.ok) return fail(ctx, r.code === "rate" ? "err_rate" : "err_unknown_type");
    return { ok: ctx.t("test_ok") };
  },
  async replay(ctx, values) {
    const r = await pub.replay(ctx, String(values.id ?? ""));
    if (!r.ok) return fail(ctx, r.code === "rate" ? "err_rate" : "err_unknown_line");
    return { ok: ctx.t("replay_ok") };
  },
  async remove(ctx, values) {
    const line = await st.byId(ctx, String(values.id ?? ""));
    if (!line) return fail(ctx, "err_unknown_line");
    await st.removeRow(ctx, line.rowId);
    return { ok: ctx.t("remove_ok") };
  },
};
export { declareScopes };
