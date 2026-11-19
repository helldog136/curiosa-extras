// The admin page: one status line, the journal of events (live search, filters, replay), and the list of types with a switch and a test button each.
// For a person who is not technical: sentences, no jargon, and every problem says what to do.
const v = new URL(import.meta.url).search; // the version of the module spreads to the neighbour files (otherwise the old code would stay cached after an update)
const es = await import(`./eventsub.mjs${v}`);
const st = await import(`./state.mjs${v}`);
const pub = await import(`./publish.mjs${v}`);
const { settingsOf } = await import(`./settings.mjs${v}`);
const { diagnose, declareScopes, retryType } = await import(`./listen.mjs${v}`);
const cycle = await import(`./cycle.mjs${v}`);
const { API } = await import(`./channel.mjs${v}`);
const dockapi = await import(`./dockapi.mjs${v}`);
const rx = await import(`./reaction.mjs${v}`);
const rwAdmin = await import(`./rewardsAdmin.mjs${v}`);
const { TONE, detail, who } = await import(`./describe.mjs${v}`);
export { TONE, detail, who };

export const SCOPE_KEY = { "moderator:read:followers": "scope_follow", "channel:read:subscriptions": "scope_subs", "bits:read": "scope_bits", "channel:read:hype_train": "scope_hype", "channel:read:redemptions": "scope_redeem" };

const fmtDate = (ctx, at) => new Date(at).toLocaleString(ctx.locale, { dateStyle: "short", timeStyle: "short", timeZone: ctx.timezone });
const num = (ctx, n) => new Intl.NumberFormat(ctx.locale).format(n);

/* ───────────── Status line ───────────── */

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
/** The main button of the page: an accent link, the same as the one of the Twitch bot. */
const primary = (label, href) => ({ type: "html", html: `<p><a data-twitch-connect href="${esc(href)}" style="display:inline-block;padding:.65rem 1.25rem;border-radius:.75rem;background:var(--v-accent);color:var(--v-accent-fg);font-weight:600;text-decoration:none">${esc(label)}</a></p>` });
/**
 * The address that sends the person to Twitch. `force`: the connector offers the link even when it believes the connection is fine (it only knows the permissions
 * a page has declared), and `scopes` carries exactly what is missing. When the connector gives no link, the way to its page stays. { url, label } or null.
 */
async function connectTarget(ctx, d, missing = d.missing ?? [], { first = false } = {}) {
  if (!d.channel) return null;
  const args = { channel: d.channel, slot: "main", force: true, scopes: missing, returnTo: `/admin/instances/${ctx.instance.id}` };
  let r = null;
  try { r = (await ctx.api.services.callAll(API, "connectLink", args)).find((x) => x.ok && x.value?.ok); } catch { r = null; }
  if (r?.value?.url) return { url: r.value.url, label: ctx.t(first ? "connect_first_btn" : "connect_btn") };
  return d.main?.adminPath ? { url: d.main.adminPath, label: ctx.t("connect_fallback") } : null;
}
/** The same, as a button block (used where there is no state card: the permissions of the optional types). */
async function connectLinks(ctx, d, missing = d.missing ?? [], opts) {
  const target = await connectTarget(ctx, d, missing, opts);
  return target ? [primary(target.label, target.url)] : [];
}
async function alertsLink(ctx) {
  let list = [];
  try { list = await ctx.api.instances.list({ module: "alerts-overlay" }); } catch { list = []; }
  const a = Array.isArray(list) ? list[0] : null;
  return a ? { type: "links", items: [{ label: ctx.t("alerts_link"), href: a.adminPath }] } : (await rx.alertsState(ctx)).state === "setup" ? null : { type: "markdown", text: ctx.t("alerts_absent") };
}

/** Why it does not listen yet, in a sentence, and what to do. */
export function problemText(ctx, code, d = {}, state = {}) {
  const t = ctx.t;
  if (code === "need_more") {
    const names = (d.missingCore ?? state.listen?.missing ?? []).map((s) => (SCOPE_KEY[s] ? t(SCOPE_KEY[s]) : s));
    return t("listen_need_more", { list: names.join(", ") || "…" });
  }
  if (code === "pending" || code === "taken") {
    // Name the types that hold the verdict (the optional ones never do): "Waiting for Twitch to confirm: Raid."
    const names = es.TYPES.filter((ty) => !ty.optional && (state.types?.[ty.id]?.code ?? "") === code).map((ty) => t(`type_${ty.id}`));
    if (names.length) return t(code === "pending" ? "listen_pending_types" : "listen_taken", { list: names.join(", ") });
  }
  return t(`listen_${code}`, { detail: state.rejected?.reason ?? "" });
}

/** The sentence for the stored reason of a type; Twitch's own answer (code and message) goes in when it refused. */
export const reasonOf = (ctx, entry) => ctx.t(`reason_${entry.reason}`, { detail: entry.detail ?? "" });

/** One sentence per type that is on and does not listen: the real reason, visible without hovering (R9 words). */
export function reasonLines(ctx, state, enabled) {
  const t = ctx.t;
  return es.TYPES.filter((ty) => enabled[ty.id] === true && state.types?.[ty.id]?.code !== "listening" && state.types?.[ty.id]?.reason)
    .map((ty) => `- ${t("types_why", { type: t(`type_${ty.id}`), reason: reasonOf(ctx, state.types[ty.id]) })}`);
}

const SETUP_CODES = new Set(["need_connect", "creds_missing", "no_channel"]);
/**
 * The state of the listening in the three words of the core (R33). Configured: how many types and when the last event came (one line). Degraded: what is wrong, and the fix.
 * Not configured: the step to do. Nothing says that all is fine, and the state is checked when the page opens, never "not checked yet".
 */
async function connectionBlock(ctx, d, state) {
  const t = ctx.t, s = settingsOf(ctx), listen = state.listen ?? {};
  let code = d.code !== "ready" ? d.code : listen.code ?? "unknown";
  if (code === "need_more" && d.code === "ready" && !d.blockedCore?.length) code = "unknown";   // granted since the last check: no alarm while the page re-checks
  const typesOn = Object.values(st.enabledOf(state)).filter(Boolean).length;
  const base = { type: "connection", id: "twitch", title: t("conn_title"), edit: { href: "?tab=types", label: t("conn_edit") } };
  const check = { label: t("check_btn"), action: "check" };
  const when = state.lastEventAt ? fmtDate(ctx, state.lastEventAt) : "";
  const summary = `${t("conn_summary", { n: typesOn })}${when ? ` · ${t("status_last", { when })}` : ""}`;
  if (code === "listening" && state.health?.code === "silent") return { ...base, state: "degraded", summary, reason: t("health_silent", { n: s.silentHours }), primary: check };
  if (code === "listening") return { ...base, state: "configured", summary };
  const reason = problemText(ctx, code, d, state);
  if (SETUP_CODES.has(code)) {
    const setup = code === "need_connect" ? await connectLinks(ctx, d, d.missingCore, { first: true })
      : code === "creds_missing" ? (d.main?.adminPath ? [{ type: "markdown", text: t("creds_steps", { href: d.main.adminPath }) }] : [])
      : [{ type: "markdown", text: t("no_channel_steps") }];
    return { ...base, state: "notConfigured", reason, setup, edit: undefined };
  }
  if (code === "nothing_on") return { ...base, state: "degraded", summary: "", reason, primary: { label: t("conn_turn_on"), href: "?tab=types" } };
  let primary = check;
  if (["need_reconnect", "need_more"].includes(code)) {
    const target = await connectTarget(ctx, d, d.missingCore);
    if (target) primary = { label: target.label, href: target.url };
  }
  return { ...base, state: "degraded", summary, reason, primary };
}

async function statusBlocks(ctx, d, state) {
  const t = ctx.t;
  const out = [await connectionBlock(ctx, d, state)];
  const c = state.catchup;
  if (c && Date.now() - c.at < 86_400_000 && c.follows + c.subs > 0) out.push({ type: "markdown", text: t("catchup_note", { n: c.follows + c.subs, when: fmtDate(ctx, c.at) }) });
  if (state.health?.mail === "off") out.push({ type: "markdown", text: t("health_mail_off") });
  return out;
}

/**
 * The window of the OBS dock (`?dock=1`): its address, to copy once into OBS (the label says where it goes). The address is secret: the main button makes a new one, and
 * the old one stops at once. Nothing about the dock stays on the page: it is a setup done once.
 */
async function dockDialog(ctx) {
  const t = ctx.t;
  return { type: "adminForm", action: "renewDock", presentation: "dialog", cancelHref: "?tab=dock", title: t("dock_title_win"), submitLabel: t("dock_renew_btn"), danger: true,
    fields: [{ name: "address", kind: "text", label: t("dock_copy_label"), value: dockapi.dockUrl(ctx, await dockapi.dockSecret(ctx)) }] };
}

/* ───────────── The pages ───────────── */

export async function panel(ctx, { query } = {}) {
  const t = ctx.t, s = settingsOf(ctx);
  let [d, state, lines] = await Promise.all([diagnose(ctx, s, { declare: false }), st.readState(ctx), st.recent(ctx, 300)]);
  // Back from Twitch with the permission granted, or never checked: check at once, so the state is known and a warning goes away without a click.
  if (d.code === "ready" && ((["need_more", "need_reconnect", "need_connect"].includes(state.listen?.code) && !d.blockedCore.length) || !state.listen?.code || state.listen.code === "unknown")) {
    await cycle.check(ctx, s, { settle: true }).catch(() => null);
    [d, state] = await Promise.all([diagnose(ctx, s, { declare: false }), st.readState(ctx)]);
  }
  const enabled = st.enabledOf(state);
  const al = await rx.alertsState(ctx), sums = al.state === "ready" ? await rx.summaries(ctx) : null, ready = al.state === "ready" && !!sums;
  const editing = ready && typeof query?.reaction === "string" ? await rx.dialog(ctx, query.reaction) : null;
  const waiting = es.TYPES.some((ty) => enabled[ty.id] === true && (state.types?.[ty.id]?.code ?? "unknown") === "pending");
  const rows = lines.map((l) => [
    fmtDate(ctx, l.at),
    { text: t(`kind_${l.kind}`), badge: TONE[l.kind] ?? "neutral" },
    who(ctx, l),
    { text: detail(ctx, l), title: l.text ? `${detail(ctx, l)} — ${l.text}` : undefined },
  ]);
  const typeRows = es.TYPES.map((ty) => {
    const entry = state.types?.[ty.id] ?? {}, code = entry.code ?? "unknown";
    const on = enabled[ty.id] === true;
    const waited = code === "pending" && entry.since ? Math.max(1, Math.round((Date.now() - entry.since) / 60_000)) : 0;
    const label = !on ? t("state_off") : waited ? t("state_pending_since", { n: waited }) : t(`state_${code}`);
    const tone = !on ? "neutral" : code === "listening" ? "ok" : ["pending", "unknown"].includes(code) ? "info" : "warn";
    const mark = !on ? "" : code === "listening" ? "✓ " : tone === "warn" ? "! " : "… ";   // colour, text AND a sign
    const why = on && code !== "listening" && entry.reason ? reasonOf(ctx, entry) : undefined;
    const perms = ty.scopes.length ? ty.scopes.map((x) => t(SCOPE_KEY[x])).join(", ") : t("scope_none");
    return [{ text: t(`type_${ty.id}`), title: t(`type_${ty.id}_help`) }, perms, { text: `${mark}${label}`, badge: tone, ...(why ? { title: why } : {}) },
      // (1.12.0) channel points: the cell leads to the Rewards tab, where each reward has its own reaction (R25)
      ...(ready ? [ty.id === "redeem" ? { text: `${rx.summaryText(ctx, sums[ty.id])}${sums[ty.id]?.rewards ? ` · ${t("rw_count", { n: sums[ty.id].rewards })}` : ""}`, href: "?tab=rewards", title: t("rw_count_title") } : { text: rx.summaryText(ctx, sums[ty.id]), title: t("rx_cell_title") }] : []),   // no column of identical dashes when the overlay is missing (R14)
      { text: on ? t("on") : t("off"), switch: { on, action: "setEnabled", label: t("switch_label", { type: t(`type_${ty.id}`) }), onText: t("on"), offText: t("off") } }];
  });
  return [
    { type: "markdown", text: t("page_intro") },
    ...(await statusBlocks(ctx, d, state)),
    ...(await rx.setUpBlocks(ctx, al.state, query)),
    ...(await rx.setUpBlocks(ctx, al.state, query, "types")),
    ...[await alertsLink(ctx)].filter(Boolean),
    { type: "table", columns: [t("col_when"), t("col_type"), t("col_who"), t("col_detail")], rows, rowIds: lines.map((l) => l.id), searchable: true, searchPlaceholder: t("search"), filters: [{ column: 1, allLabel: t("filter_all") }], truncate: [3], pageSize: 50, empty: t("empty"),
      rowActions: [{ label: t("replay_btn"), action: "replay" }, { label: t("remove_btn"), action: "remove", danger: true, confirm: t("remove_confirm") }] },
    ...(await rwAdmin.blocks(ctx, { query: query ?? {}, ready, enabled: enabled.redeem === true })),
    { type: "links", tab: "dock", items: [{ label: t("dock_open"), href: "?tab=dock&dock=1", presentation: "dialog" }] },
    ...(query?.dock === "1" ? [{ ...(await dockDialog(ctx)), tab: "dock" }] : []),
    { type: "markdown", tab: "types", text: t("types_intro") },
    ...(d.code === "ready" && d.missing.length && !d.missingCore.length ? (await connectLinks(ctx, d, d.missing)).map((b) => ({ ...b, tab: "types" })) : []),
    ...(reasonLines(ctx, state, enabled).length ? [{ type: "markdown", tab: "types", text: reasonLines(ctx, state, enabled).join("\n") }] : []),
    ...(waiting ? [{ type: "refreshWhile", tab: "types", pending: true, everySeconds: 3 }] : []),
    ...(al.state !== "ready" && al.state !== "setup" ? [{ type: "links", tab: "types", items: [{ label: t(al.state === "old" ? "rx_state_old" : "rx_state_absent"), href: al.adminPath }] }] : []),
    ...(editing ? [editing] : []),
    { type: "table", tab: "types", columns: [t("col_type"), t("col_permission"), t("col_state"), ...(ready ? [t("col_reaction")] : []), t("col_on")], rows: typeRows, rowIds: es.TYPES.map((x) => x.id), pageSize: 0, truncate: ready ? [1, 3] : [1], searchable: true, searchPlaceholder: t("search_types"),
      rowActions: ready ? [{ label: t("rx_edit_btn"), href: "?tab=types&reaction={id}", presentation: "dialog" }, { label: t("test_btn"), action: "test", inMenu: true }, { label: t("retry_btn"), action: "retry", inMenu: true }] : [{ label: t("test_btn"), action: "test" }, { label: t("retry_btn"), action: "retry", inMenu: true }] },
  ];
}

/* ───────────── Actions ───────────── */

const fail = (ctx, key, vars) => ({ error: ctx.t(key, vars) });
export const actions = {
  ...rx.actions,
  ...rwAdmin.actions,
  async check(ctx) {
    const r = await cycle.check(ctx, settingsOf(ctx), { settle: true });
    return r.code === "listening" ? { ok: ctx.t("check_ok", { when: new Date().toLocaleTimeString(ctx.locale, { hour: "2-digit", minute: "2-digit", timeZone: ctx.timezone }) }) } : { error: problemText(ctx, r.code, await diagnose(ctx, settingsOf(ctx), { declare: false }), await st.readState(ctx)) };
  },
  /** The switch of a type: SAYS the wanted state (never inverts). Declares the permissions that become needed, then brings the subscriptions in line. */
  async setEnabled(ctx, values) {
    const id = String(values.id ?? "");
    if (!es.typeOf(id)) return fail(ctx, "err_unknown_type");
    const on = values.enabled === "1";
    const state = await st.updateState(ctx, (x) => { x.enabled = { ...st.enabledOf(x), [id]: on }; });
    const s = settingsOf(ctx), d = await diagnose(ctx, s, { declare: true });
    const r = await cycle.check(ctx, s).catch(() => null);
    if (on && d.code === "ready" && r && r.code === "need_more") return { ok: ctx.t("switch_need_more", { type: ctx.t(`type_${id}`) }) };
    return { ok: ctx.t(on ? "switch_on" : "switch_off", { type: ctx.t(`type_${id}`) }) };
  },
  /** "Try again" for one type: our subscriptions of that type are deleted and created again, and the answer says what became of it. */
  async retry(ctx, values) {
    const id = String(values.id ?? "");
    if (!es.typeOf(id)) return fail(ctx, "err_unknown_type");
    const r = await retryType(ctx, settingsOf(ctx), id);
    const type = ctx.t(`type_${id}`);
    if (!r.ok) return { error: problemText(ctx, r.code, await diagnose(ctx, settingsOf(ctx), { declare: false }), await st.readState(ctx)) };
    if (r.state === "listening") return { ok: ctx.t("retry_listening", { type }) };
    if (r.state === "taken") return { error: ctx.t("retry_taken", { type }) };
    return { ok: ctx.t("retry_waiting", { type }) };
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
  /** A new dock address: the old one stops at once. */
  async renewDock(ctx) {
    await dockapi.renewDockSecret(ctx);
    return { ok: ctx.t("dock_renewed") };
  },
  async remove(ctx, values) {
    const line = await st.byId(ctx, String(values.id ?? ""));
    if (!line) return fail(ctx, "err_unknown_line");
    await st.removeRow(ctx, line.rowId);
    return { ok: ctx.t("remove_ok") };
  },
};
export { declareScopes };
