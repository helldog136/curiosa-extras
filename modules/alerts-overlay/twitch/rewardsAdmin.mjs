// (1.12.0; 1.18.0 in the alerts overlay) The "Rewards" tab: one line per channel point reward with its reaction and its switch, "All the other rewards" first, a live search, the reaction
// window of a reward (the same window as a type, with the preview of the core), and "Add a reward" (created on Twitch by the Twitch bot, when it can).
// Words of the person only: never "id", "scope", "service"; what is missing is said in one line with a link (R25).
const v = new URL(import.meta.url).search; // the version of the module spreads to the neighbour files
const es = await import(`./eventsub.mjs${v}`);
const rx = await import(`./reaction.mjs${v}`);
const rw = await import(`./rewards.mjs${v}`);
const pub = await import(`./publish.mjs${v}`);

const TAB = "rewards";
const at = (b) => ({ ...b, tab: TAB });
export const CATALOGUE = "/admin/catalogue";
const num = (ctx, n) => new Intl.NumberFormat(ctx.locale).format(n);

/** What the "Reaction" cell of a reward says: its own reaction in a few words, or nothing special (the reaction of all the others: a dash, explained in its tooltip). */
function reactionCell(ctx, it) {
  const t = ctx.t;
  if (it.gone) return { text: t("rw_gone"), badge: "warn", title: t("rw_gone_title") };
  if (it.row?.own) return { text: rx.summaryText(ctx, it.row), title: t("rx_cell_title") };
  return { text: "—", title: t("rw_same_title") };
}

/** The line that says why the list may be incomplete, with what to do (or nothing). */
function twitchLine(ctx, list, enabled) {
  const t = ctx.t;
  if (!enabled) return { type: "links", items: [{ label: t("rw_type_off"), href: "?tab=twitch" }] };
  if (list.twitch.ok) return null;
  if (list.twitch.code === "na") return { type: "markdown", text: t("rw_na") };
  if (list.twitch.code === "scope") return { type: "links", items: [{ label: t("rw_scope"), href: "?tab=twitch" }] };
  return { type: "markdown", text: t("rw_twitch_down") };
}

/** "Add a reward": the button when the Twitch bot can create one; otherwise one line that says what is missing, with a link. */
function addBlock(ctx, c) {
  const t = ctx.t;
  if (c.can) return { type: "links", items: [{ label: t("rw_add_btn"), href: `?tab=${TAB}&new=1`, presentation: "dialog" }] };
  if (c.code === "absent") return { type: "links", items: [{ label: t("rw_add_need_bot"), href: CATALOGUE }] };
  if (c.code === "too_many") return { type: "markdown", text: t("rw_add_too_many") };
  if (c.code === "na") return null;
  return c.path ? { type: "links", items: [{ label: t("rw_add_need_scope"), href: c.path }] } : { type: "markdown", text: t("rw_twitch_down") };
}

/** The window "Add a reward": a name and a cost (two fields), created on Twitch by the bot; the reaction window opens right after. */
function newForm(ctx, values = {}) {
  const t = ctx.t;
  return at({
    type: "adminForm", presentation: "dialog", action: "createReward", cancelHref: `?tab=${TAB}`, title: t("rw_new_title"), submitLabel: t("rw_new_btn"),
    fields: [
      { name: "title", label: t("rw_f_title"), value: values.title ?? "", required: true, example: t("rw_ex_title") },
      { name: "cost", kind: "number", label: t("rw_f_cost"), value: values.cost ?? "500", required: true, min: 1, max: 1_000_000_000, step: 1, unit: t("rw_unit_points") },
    ],
  });
}

/** The blocks of the tab. `query.reaction`: a reward id (its window) or "*" (all the other rewards); `query.new`: the creation window. */
export async function blocks(ctx, { query = {}, ready, enabled }) {
  const t = ctx.t;
  if (!ready) return [];
  const list = await rw.list(ctx);
  if (!list.overlay) return [];
  const c = await rw.creator(ctx);
  const out = [at({ type: "markdown", text: t("rw_intro") })];
  const line = twitchLine(ctx, list, enabled);
  if (line) out.push(at(line));
  const add = addBlock(ctx, list.twitch.code === "na" ? { can: false, code: "na" } : c);
  if (add) out.push(at(add));
  // the windows (the address is the open state)
  const want = typeof query.reaction === "string" ? query.reaction : "";
  if (want === rw.OTHERS) { const d = await rx.dialog(ctx, "redeem", { reward: { id: "" } }); if (d) out.push({ ...d, tab: TAB, cancelHref: `?tab=${TAB}` }); }
  else if (want) {
    const it = list.items.find((x) => x.id === want);
    const d = it ? await rx.dialog(ctx, "redeem", { reward: { id: it.id, title: it.title, cost: it.cost } }) : null;
    if (d) out.push(d);
  }
  if (query.new === "1" && c.can) out.push(newForm(ctx));
  const rows = list.items.map((it) => [
    { text: it.title, ...(it.enabled === false || it.paused ? { title: t(it.paused ? "rw_paused_title" : "rw_disabled_title") } : {}) },
    it.cost ? num(ctx, it.cost) : "—",
    reactionCell(ctx, it),
    { text: (it.row?.on ?? true) ? t("on") : t("off"), switch: { on: it.row?.on ?? true, action: "setRewardOn", label: t("rw_switch_label", { reward: it.title }), onText: t("on"), offText: t("off") } },
  ]);
  const others = list.others ?? {};
  const all = list.items.length ? [[{ text: t("rw_others"), title: t("rw_others_title") }, "—", { text: rx.summaryText(ctx, others), title: t("rx_cell_title") },
    { text: others.on !== false ? t("on") : t("off"), switch: { on: others.on !== false, action: "setRewardOn", label: t("rw_switch_label", { reward: t("rw_others") }), onText: t("on"), offText: t("off") } }], ...rows] : [];
  out.push(at({
    type: "table", columns: [t("rw_col_reward"), t("rw_col_cost"), t("col_reaction"), t("rw_col_alert")], rows: all, rowIds: list.items.length ? [rw.OTHERS, ...list.items.map((x) => x.id)] : [],
    searchable: true, searchPlaceholder: t("rw_search"), truncate: [0, 2], pageSize: 50, empty: t("rw_empty"),
    rowActions: [
      { label: t("rx_edit_btn"), href: `?tab=${TAB}&reaction={id}`, presentation: "dialog" },
      { label: t("test_btn"), action: "testReward", inMenu: true },
      { label: t("rw_forget_btn"), action: "forgetReward", inMenu: true, danger: true, confirm: t("rw_forget_confirm") },
    ],
  }));
  return out;
}

/** The fields of an action that point at a reward: a reward of the list, or "*" (all the others). */
async function target(ctx, values) {
  const id = String(values.id ?? "");
  if (id === rw.OTHERS) return { others: true };
  const it = await rw.one(ctx, id);
  return it ? { it } : null;
}
const unavailable = (ctx) => ({ error: ctx.t("rx_err_unavailable") });

export const actions = {
  /** The switch of a reward: SAYS the wanted state. A reward without a row gets one that only holds this switch (its reaction stays that of the others). */
  async setRewardOn(ctx, values) {
    const x = await target(ctx, values);
    if (!x) return { error: ctx.t("rw_err_unknown") };
    const on = values.enabled === "1";
    const args = x.others ? { type: "redeem", patch: { on } } : { type: "redeem", reward: x.it.id, title: x.it.title, cost: x.it.cost, patch: { on } };
    const r = await rx.service(ctx, "set", args);
    if (!r?.ok || !r.value?.ok) return unavailable(ctx);
    return { ok: ctx.t(on ? "rw_switch_on" : "rw_switch_off", { reward: x.others ? ctx.t("rw_others") : x.it.title }) };
  },
  /** "Test": a redemption of that reward with an invented name, through the journal and the overlay, like a real one. */
  async testReward(ctx, values) {
    const x = await target(ctx, values);
    if (!x) return { error: ctx.t("rw_err_unknown") };
    const r = x.others ? await pub.sendTest(ctx, "redeem") : await pub.sendRewardTest(ctx, x.it);
    if (!r.ok) return { error: ctx.t(r.code === "rate" ? "err_rate" : "rw_err_unknown") };
    return { ok: ctx.t("test_ok") };
  },
  /** Removes the own reaction of a reward (files, placed texts, switch): it then shows the reaction of all the others. The reward stays on Twitch. */
  async forgetReward(ctx, values) {
    const x = await target(ctx, values);
    if (!x) return { error: ctx.t("rw_err_unknown") };
    if (x.others) return { error: ctx.t("rw_err_others") };
    const r = await rx.service(ctx, "forget", { reward: x.it.id });
    if (!r?.ok || !r.value?.ok) return unavailable(ctx);
    return { ok: ctx.t("rw_forgotten", { reward: x.it.title }) };
  },
  /** "Add a reward": the Twitch bot creates it on Twitch (its own checks and limits, the person's right carried); the reaction window of the new reward opens. */
  async createReward(ctx, values) {
    const t = ctx.t;
    const r = await ctx.api.services.call(rw.CREATOR, "create", { title: String(values.title ?? ""), cost: Number(String(values.cost ?? "").replace(/\s/g, "")) }, { asCaller: true }).catch(() => null);
    if (!r?.ok) return { error: t("rw_add_need_bot") };
    const v2 = r.value ?? {};
    if (!v2.ok) {
      if (v2.errors && Object.keys(v2.errors).length) return { errors: Object.fromEntries(Object.entries(v2.errors).map(([k, code]) => [k, t(`rw_e_${code}`)])) };
      return { error: t(`rw_e_${["denied", "na", "rate", "too_many", "need_scope", "need_connect", "need_reconnect"].includes(v2.code) ? v2.code : "twitch"}`) };
    }
    rw.forget(ctx);   // the list is read again from Twitch (the bot wrote the audit line)
    return es.REWARD_ID.test(String(v2.reward?.id ?? "")) ? { redirect: `?tab=${TAB}&reaction=${encodeURIComponent(v2.reward.id)}` } : { ok: t("rw_created", { reward: v2.reward?.title ?? "" }) };
  },
};
