// The admin page: one status line, the journal of events (live search, filters, replay), and the list of types with a switch and a test button each.
// For a person who is not technical: sentences, no jargon, and every problem says what to do.
const v = new URL(import.meta.url).search; // the version of the module spreads to the neighbour files (otherwise the old code would stay cached after an update)
const es = await import(`./eventsub.mjs${v}`);
const st = await import(`./state.mjs${v}`);
const pub = await import(`./publish.mjs${v}`);
const { settingsOf } = await import(`./settings.mjs${v}`);
const { diagnose, declareScopes } = await import(`./listen.mjs${v}`);
const cycle = await import(`./cycle.mjs${v}`);
const { API } = await import(`./channel.mjs${v}`);
const dockapi = await import(`./dockapi.mjs${v}`);
const rx = await import(`./reaction.mjs${v}`);
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
 * The button that sends the person to Twitch. `force`: the connector offers the link even when it believes the connection is fine (it only knows the permissions
 * a page has declared), and `scopes` carries exactly what is missing. When the connector gives no link, the way to its page stays: there is always a button.
 */
async function connectLinks(ctx, d, missing = d.missing ?? []) {
  if (!d.channel) return [];
  const args = { channel: d.channel, slot: "main", force: true, scopes: missing, returnTo: `/admin/instances/${ctx.instance.id}` };
  let r = null;
  try { r = (await ctx.api.services.callAll(API, "connectLink", args)).find((x) => x.ok && x.value?.ok); } catch { r = null; }
  if (r?.value?.url) return [primary(ctx.t("connect_btn"), r.value.url)];
  return d.main?.adminPath ? [primary(ctx.t("connect_fallback"), d.main.adminPath)] : [];
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
  return t(`listen_${code}`, { detail: state.rejected?.reason ?? "" });
}

async function statusBlocks(ctx, d, state) {
  const t = ctx.t, listen = state.listen ?? {};
  let code = d.code !== "ready" ? d.code : listen.code ?? "unknown";
  if (code === "need_more" && d.code === "ready" && !d.blockedCore?.length) code = "unknown";   // granted since the last check: no alarm while the page re-checks
  const out = [];
  const typesOn = Object.values(st.enabledOf(state)).filter(Boolean).length;
  if (code === "listening") {
    const last = state.lastEventAt ? t("status_last", { when: fmtDate(ctx, state.lastEventAt) }) : t("status_none_yet");
    out.push({ type: "banner", tone: "success", text: `${t("status_listening", { n: typesOn })} ${last}` });
  } else {
    out.push({ type: "banner", tone: "warning", text: problemText(ctx, code, d, state) });
    if (["need_connect", "need_reconnect", "need_more"].includes(code)) out.push(...(await connectLinks(ctx, d, d.missingCore)));
    else if (code === "creds_missing" && d.main?.adminPath) out.push({ type: "markdown", text: t("creds_steps", { href: d.main.adminPath }) });
    else if (code === "no_channel") out.push({ type: "markdown", text: t("no_channel_steps") });
  }
  if (state.health?.code === "silent") out.push({ type: "banner", tone: "warning", text: t("health_silent", { n: settingsOf(ctx).silentHours }) });
  const c = state.catchup;
  if (c && Date.now() - c.at < 86_400_000 && c.follows + c.subs > 0) out.push({ type: "markdown", text: t("catchup_note", { n: c.follows + c.subs, when: fmtDate(ctx, c.at) }) });
  if (state.health?.mail === "off") out.push({ type: "markdown", text: t("health_mail_off") });
  if (state.revoked && Date.now() - state.revoked.at < 86_400_000) out.push({ type: "banner", tone: "warning", text: t("revoked_note", { when: fmtDate(ctx, state.revoked.at) }) });
  // The "Check now" button is only worth its space when something is wrong (the Types tab has one too).
  if (code !== "listening") out.push({ type: "adminForm", action: "check", submitLabel: t("check_btn"), fields: [] });
  return out;
}

/* ───────────── The pages ───────────── */

export async function panel(ctx, { query } = {}) {
  const t = ctx.t, s = settingsOf(ctx);
  let [d, state, lines] = await Promise.all([diagnose(ctx, s, { declare: false }), st.readState(ctx), st.recent(ctx, 300)]);
  // Back from Twitch with the permission granted: check at once, so the warning goes away without a click.
  if (d.code === "ready" && ["need_more", "need_reconnect", "need_connect"].includes(state.listen?.code) && !d.blockedCore.length) {
    await cycle.check(ctx, s, { settle: true }).catch(() => null);
    [d, state] = await Promise.all([diagnose(ctx, s, { declare: false }), st.readState(ctx)]);
  }
  const enabled = st.enabledOf(state);
  const al = await rx.alertsState(ctx), sums = al.state === "ready" ? await rx.summaries(ctx) : null, ready = al.state === "ready" && !!sums;
  const editing = ready && typeof query?.reaction === "string" ? await rx.dialog(ctx, query.reaction) : null;
  const code0 = d.code !== "ready" ? d.code : state.listen?.code ?? "unknown";
  const authorized = !["need_connect", "need_reconnect", "need_more", "creds_missing", "no_channel"].includes(code0);
  const authLink = authorized ? [] : await connectLinks(ctx, d);
  const steps = await rx.checklist(ctx, { authorized, listening: code0 === "listening", authorizeHref: (/href="([^"]+)"/.exec(authLink[0]?.html ?? "")?.[1] ?? "").replace(/&amp;/g, "&") || null });
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
    const why = on && code === "pending" && entry.reason ? t(`reason_${entry.reason}`) : undefined;
    const perms = ty.scopes.length ? ty.scopes.map((x) => t(SCOPE_KEY[x])).join(", ") : t("scope_none");
    return [{ text: t(`type_${ty.id}`), title: t(`type_${ty.id}_help`) }, perms, { text: `${mark}${label}`, badge: tone, ...(why ? { title: why } : {}) },
      ...(ready ? [{ text: rx.summaryText(ctx, sums[ty.id]), title: t("rx_cell_title") }] : []),   // no column of identical dashes when the overlay is missing (R14)
      { text: on ? t("on") : t("off"), switch: { on, action: "setEnabled", label: t("switch_label", { type: t(`type_${ty.id}`) }), onText: t("on"), offText: t("off") } }];
  });
  const typesCheck = (d.code !== "ready" ? d.code : state.listen?.code ?? "unknown") === "listening";   // otherwise the status area above has the button
  return [
    { type: "markdown", text: t("page_intro") },
    ...(await statusBlocks(ctx, d, state)),
    ...(steps ? [steps] : []),
    ...(await rx.setUpBlocks(ctx, al.state, query)),
    ...(await rx.setUpBlocks(ctx, al.state, query, "types")),
    ...[await alertsLink(ctx)].filter(Boolean),
    { type: "table", columns: [t("col_when"), t("col_type"), t("col_who"), t("col_detail")], rows, rowIds: lines.map((l) => l.id), searchable: true, searchPlaceholder: t("search"), filters: [{ column: 1, allLabel: t("filter_all") }], truncate: [3], pageSize: 50, empty: t("empty"),
      rowActions: [{ label: t("replay_btn"), action: "replay" }, { label: t("remove_btn"), action: "remove", danger: true, confirm: t("remove_confirm") }] },
    { type: "markdown", tab: "dock", text: t("dock_intro") },
    { type: "copy", tab: "dock", label: t("dock_copy_label"), text: dockapi.dockUrl(ctx, await dockapi.dockSecret(ctx)) },
    { type: "table", tab: "dock", columns: [t("dock_renew_title")], rows: [[t("dock_renew_help")]], rowIds: ["dock"], pageSize: 0, rowActions: [{ label: t("dock_renew_btn"), action: "renewDock", confirm: t("dock_renew_confirm"), danger: true }] },
    { type: "markdown", tab: "types", text: t("types_intro") },
    ...(d.code === "ready" && d.missing.length && !d.missingCore.length ? (await connectLinks(ctx, d, d.missing)).map((b) => ({ ...b, tab: "types" })) : []),
    ...(waiting ? [{ type: "refreshWhile", tab: "types", pending: true, everySeconds: 3 }] : []),
    ...(typesCheck ? [{ type: "adminForm", tab: "types", action: "check", submitLabel: t("check_btn"), submitStyle: "secondary", fields: [] }] : []),
    ...(al.state !== "ready" && al.state !== "setup" ? [{ type: "links", tab: "types", items: [{ label: t(al.state === "old" ? "rx_state_old" : "rx_state_absent"), href: al.adminPath }] }] : []),
    ...(editing ? [editing] : []),
    { type: "table", tab: "types", columns: [t("col_type"), t("col_permission"), t("col_state"), ...(ready ? [t("col_reaction")] : []), t("col_on")], rows: typeRows, rowIds: es.TYPES.map((x) => x.id), pageSize: 0, truncate: ready ? [1, 3] : [1], searchable: true, searchPlaceholder: t("search_types"),
      rowActions: ready ? [{ label: t("rx_edit_btn"), href: "?tab=types&reaction={id}", presentation: "dialog" }, { label: t("test_btn"), action: "test", inMenu: true }] : [{ label: t("test_btn"), action: "test" }] },
  ];
}

/* ───────────── Actions ───────────── */

const fail = (ctx, key, vars) => ({ error: ctx.t(key, vars) });
export const actions = {
  ...rx.actions,
  async check(ctx) {
    const r = await cycle.check(ctx, settingsOf(ctx), { settle: true });
    return r.code === "listening" ? { ok: ctx.t("check_ok") } : { error: problemText(ctx, r.code, await diagnose(ctx, settingsOf(ctx), { declare: false }), await st.readState(ctx)) };
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
