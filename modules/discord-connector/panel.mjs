// The administration of the Discord connector: ONE card of the core (state, one line, "Edit"), the channels the bot may write in (a searchable list with one switch per
// channel, shown only once chosen or when asked for), the messages kept up to date for other modules, and the "Edit" window (application number, server number, bot secret code).
// The guide exists only while no bot is registered. Never a secret, never a stored value of the code.
const version = new URL(import.meta.url).search;
const store = await import(new URL(`./store.mjs${version}`, import.meta.url).href);
const dc = await import(new URL(`./discord.mjs${version}`, import.meta.url).href);
const hl = await import(new URL(`./health.mjs${version}`, import.meta.url).href);
const service = await import(new URL(`./service.mjs${version}`, import.meta.url).href);
const { COL } = store;

/** The one right that changes or reads the bot: held by the owner only by default (module.json `rights`). The core checks it before an action runs; the code checks it again. */
export const RIGHT = "bot.manage";
export const owns = (ctx) => { try { return typeof ctx.can === "function" && ctx.can(RIGHT) === true; } catch { return false; } };

const EDIT = "?edit=app";
const time = (ctx, ms) => { try { return new Date(ms).toLocaleTimeString(ctx.locale || "en", { hour: "2-digit", minute: "2-digit", timeZone: ctx.timezone || "UTC" }); } catch { return ""; } };
const limitedText = (ctx, n) => ctx.t(n === 1 ? "limited_one" : "limited_many", { n });
const words = (ctx, missing) => [...new Set(missing.map((m) => ctx.t(`perm_${m.permission}`)))].join(", ");

/** What is missing on the whole server, by feature, in words: "Posting messages: embed links". */
export function missingText(ctx, missing) {
  const by = new Map();
  for (const m of missing) by.set(m.feature, [...(by.get(m.feature) ?? []), m]);
  return [...by].map(([f, list]) => `${ctx.t(`feature_${f}`)} (${words(ctx, list)})`).join(" · ");
}

/** The chosen channels where the bot cannot write, in words: "#news (send messages) · …1234 (no longer on the server)". */
export function blockedText(ctx, blocked) {
  return blocked.map((b) => (b.gone ? `…${String(b.id).slice(-4)} (${ctx.t("gone_short")})` : `#${b.name || String(b.id).slice(-4)} (${[...new Set(b.permissions.map((k) => ctx.t(`perm_${k}`)))].join(", ")})`)).join(" · ");
}

async function card(ctx, creds, p, can, chosen = 0) {
  const head = { type: "connection", id: "bot", title: ctx.t("app_title") };
  if (!can) {   // somebody who may open the page but not change the bot: the state, and who can change it
    const state = !store.complete(creds) ? "notConfigured" : p.state === "ok" ? "configured" : "degraded";
    return { ...head, state, reason: state === "configured" ? undefined : ctx.t("reason_owner_only") };
  }
  if (!store.complete(creds)) {
    return {
      ...head, state: "notConfigured", reason: ctx.t("reason_none"), primary: { label: ctx.t("register"), href: EDIT },
      setup: [{ type: "markdown", text: [ctx.t("guide_1"), ctx.t("guide_2"), ctx.t("guide_3"), ctx.t("guide_4")].join("\n\n") }],
    };
  }
  const invite = dc.inviteLink(creds.applicationId, creds.guildId);
  const base = {
    ...head, summary: [ctx.t("summary", { tail: creds.applicationId.slice(-4) }), ...(chosen ? [limitedText(ctx, chosen)] : [])].join(" · "), edit: { href: EDIT },
    menu: [
      { label: ctx.t("test"), action: "test" },
      ...(chosen ? [{ label: ctx.t("allow_all"), action: "allowAll", confirm: ctx.t("allow_all_confirm") }] : []),
      { label: ctx.t("remove"), action: "removeBot", confirm: ctx.t("remove_confirm"), danger: true },
    ],
    net: [{ host: dc.HOST, label: ctx.t("net_label"), ...(dc.lastGood() ? { lastGoodAt: dc.lastGood() } : {}) }],
  };
  const since = p.since ? { since: new Date(p.since).toISOString() } : {};
  if (p.state === "token") return { ...base, state: "degraded", reason: ctx.t("health_token"), ...since, primary: { label: ctx.t("fix_token"), href: EDIT } };
  if (p.state === "guild") return { ...base, state: "degraded", reason: ctx.t("health_guild"), ...since, ...(invite ? { primary: { label: ctx.t("fix_guild"), href: invite } } : {}) };
  if (p.state === "perms") return { ...base, state: "degraded", reason: ctx.t("health_perms", { feature: ctx.t(`feature_${p.feature}`), list: words(ctx, p.missing?.length ? p.missing : []) || ctx.t("perm_unknown") }), ...since, ...(invite ? { primary: { label: ctx.t("fix_perms"), href: invite } } : {}) };
  if (p.state === "rate") return { ...base, state: "degraded", reason: ctx.t("health_rate", { time: p.until ? time(ctx, p.until) : "…" }) };
  if (p.state === "net") return { ...base, state: "degraded", reason: ctx.t("health_net"), ...since, primary: { label: ctx.t("test"), action: "test" } };
  return { ...base, state: "configured" };
}

/** What the page needs to know about the messages kept for other modules: the documents, the names of the channels, the names of the modules. Never throws. */
async function keptInfo(ctx, channels) {
  let docs = [];
  try { docs = await store.managedList(ctx); } catch { return { docs: [], owners: new Map() }; }
  const owners = new Map();
  for (const d of docs) {
    const o = d.data.owner;
    if (!o || owners.has(o)) continue;
    try { owners.set(o, (await ctx.api.instances.list({ module: o, locale: ctx.locale }))?.[0]?.name || o); } catch { owners.set(o, o); }
  }
  return { docs, owners };
}

function keptTable(ctx, can, { docs, owners }, names) {
  if (!docs.length) return [];
  const date = (iso) => { try { return new Date(iso).toLocaleString(ctx.locale || "en", { dateStyle: "medium", timeStyle: "short", timeZone: ctx.timezone || "UTC" }); } catch { return ""; } };
  return [{
    type: "table", title: ctx.t("kept_title"), searchable: true, pageSize: 50, truncate: true,
    columns: [ctx.t("col_module"), ctx.t("col_message"), ctx.t("col_channel"), ctx.t("col_updated")],
    rows: docs.map((d) => [owners.get(d.data.owner) ?? d.data.owner ?? "", d.data.label || d.data.key || "", names.get(d.data.channelId) ?? `…${String(d.data.channelId).slice(-4)}`, date(d.data.at)]),
    rowIds: docs.map((d) => d.id),
    ...(can ? { rowActions: [{ label: ctx.t("forget_row"), action: "forgetKept", confirm: ctx.t("forget_confirm"), danger: true, inMenu: true }] } : {}),
  }];
}

/**
 * The channels the bot may write in. Nothing chosen = no limit, and nothing is shown but one link (R33: no field that waits for nothing). Once chosen, a list of the chosen
 * channels, with a switch each (the state, never a verb: R17) and a link to add some. "Add or remove channels" (or the first link) opens the whole list of the server:
 * live search (R15, no wall of buttons however long the list), the chosen channels first, then the ones modules already write in (the suggestion), then the server's own order.
 */
function channelsSection(ctx, { can, chosen, query, channels, channelsOk, kept }) {
  const limited = chosen.length > 0;
  const editing = can && query?.edit === "channels";
  if (!limited && !editing) return can ? [{ type: "links", items: [{ label: ctx.t("limit_open"), href: "?edit=channels" }] }] : [];
  const used = new Map();   // channel → names of the modules that keep a message there
  for (const d of kept.docs) used.set(d.data.channelId, [...new Set([...(used.get(d.data.channelId) ?? []), kept.owners.get(d.data.owner) ?? d.data.owner ?? ""].filter(Boolean))]);
  const known = new Map(channels.map((c) => [c.id, c]));
  const tail = (id) => `…${String(id).slice(-4)}`;
  const row = (id) => ({ id, name: known.get(id)?.name, category: known.get(id)?.category ?? "", gone: channelsOk && !known.has(id) });
  const ids = editing ? [...new Set([...chosen, ...channels.map((c) => c.id)])] : chosen;
  const rank = (id) => (chosen.includes(id) ? 0 : used.has(id) ? 1 : 2);
  const sorted = ids.map((id, i) => [id, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([id]) => id);
  const rows = sorted.map(row);
  const cell = (r) => {
    const on = chosen.includes(r.id);
    const label = ctx.t("switch_label", { name: r.name ?? tail(r.id) });
    return { text: "", switch: { on, action: "setChannel", label } };
  };
  return [
    ...(editing ? [{ type: "links", items: [{ label: ctx.t("limit_done"), href: "?" }] }] : []),
    {
      type: "table", title: ctx.t(editing ? "pick_title" : "chosen_title"), searchable: true, pageSize: 50, truncate: [0, 1, 2],
      // Somebody who cannot change the list sees the chosen channels only: no column that would say "Chosen" on every row (R14).
      columns: [ctx.t("col_channel"), ctx.t("col_category"), ctx.t("col_used"), ...(can ? [ctx.t("col_chosen")] : [])],
      rowIds: rows.map((r) => r.id),
      rows: rows.map((r) => [
        r.name ? `#${r.name}` : r.gone ? { text: `${ctx.t("gone_name")} ${tail(r.id)}`, title: ctx.t("gone_help") } : tail(r.id),
        r.category, (used.get(r.id) ?? []).join(", "), ...(can ? [cell(r)] : []),
      ]),
      empty: ctx.t("pick_empty"),
    },
    ...(editing && can && !limited && [...used.keys()].some((id) => known.has(id))
      ? [{ type: "adminForm", action: "chooseUsed", submitLabel: ctx.t("choose_used"), submitStyle: "secondary", fields: [] }] : []),
    ...(limited && !editing && can ? [{ type: "links", items: [{ label: ctx.t("limit_more"), href: "?edit=channels" }] }] : []),
  ];
}

function dialog(ctx, creds) {
  const kept = (has, tail) => (has ? { value: "", valueHint: "kept", ...(tail ? { valueTail: tail } : {}) } : {});
  return {
    type: "adminForm", presentation: "dialog", action: "saveApp", cancelHref: "?", title: ctx.t("app_title"), submitLabel: ctx.t("save"),
    fields: [
      { name: "applicationId", label: ctx.t("f_app"), kind: "text", example: ctx.t("f_app_example"), ...kept(!!creds.applicationId, creds.applicationId.slice(-4)) },
      { name: "guildId", label: ctx.t("f_guild"), kind: "text", example: ctx.t("f_guild_example"), ...kept(!!creds.guildId, creds.guildId.slice(-4)) },
      { name: "botToken", label: ctx.t("f_secret"), kind: "secret", ...kept(!!creds.botToken) },
    ],
  };
}

export async function render(ctx, { query } = {}) {
  const creds = await store.credsOf(ctx);
  const p = await hl.problem(ctx);
  const can = owns(ctx);
  const chosen = await store.allowedIds(ctx).catch(() => []);
  const out = [await card(ctx, creds, p, can, chosen.length)];
  if (store.hasBot(creds)) {
    const list = await service.detailedChannels(ctx);
    const channels = list.ok ? list.channels : [];
    const names = new Map(channels.map((c) => [c.id, `#${c.name}`]));
    const kept = await keptInfo(ctx);
    out.push(...channelsSection(ctx, { can, chosen, query, channels, channelsOk: list.ok, kept }));
    out.push(...keptTable(ctx, can, kept, names));
  }
  if (can && query?.edit === "app") out.push(dialog(ctx, creds));
  return out;
}

const forget = () => { hl.resetHealth(); service.resetLists(); };

const raw = {
  /** Saves what was typed; an empty field keeps the current value. Errors go under the field, with an example. */
  async saveApp(ctx, values) {
    const cur = await store.credsOf(ctx);
    const appIn = store.text(values?.applicationId), guildIn = store.text(values?.guildId), secretIn = store.text(values?.botToken);
    const errors = {};
    if ((appIn && !store.snowflake(appIn)) || (!appIn && !cur.applicationId)) errors.applicationId = ctx.t("err_app");
    if ((guildIn && !store.snowflake(guildIn)) || (!guildIn && !cur.guildId)) errors.guildId = ctx.t("err_guild");
    if ((secretIn && !store.botCode(secretIn)) || (!secretIn && !cur.botToken)) errors.botToken = ctx.t("err_secret");
    if (Object.keys(errors).length) return { errors };
    return store.serial(ctx, async () => {
      const doc = await store.first(ctx, COL.app);
      await store.put(ctx, COL.app, doc, { applicationId: appIn || cur.applicationId, guildId: guildIn || cur.guildId, botToken: secretIn || cur.botToken });
      await store.setHealth(ctx, null);
      forget();
      return { ok: ctx.t("saved"), redirect: "?" };
    });
  },
  /** One fresh round of questions to Discord, answered in plain words. */
  async test(ctx) {
    const v = await hl.verify(ctx, { force: true });
    if (v.state === "none") return { error: ctx.t("test_none") };
    if (v.state === "token") return { error: ctx.t("test_token") };
    if (v.state === "guild") return { error: ctx.t("test_guild") };
    if (v.state === "rate") return { error: ctx.t("test_rate", { time: v.until ? time(ctx, v.until) : "…" }) };
    if (v.state === "net") return { error: ctx.t("test_net") };
    // Server-wide permissions first, then the chosen channels where the bot cannot write: both in one answer.
    const said = [
      ...(v.missing?.length ? [ctx.t("test_missing", { list: missingText(ctx, v.missing) })] : []),
      ...(v.blocked?.length ? [ctx.t("test_channels", { list: blockedText(ctx, v.blocked) })] : []),
    ];
    return said.length ? { error: said.join(" ") } : { ok: ctx.t("test_ok") };
  },
  /** Forgets the bot here (the messages already on Discord stay). */
  async removeBot(ctx) {
    await store.serial(ctx, async () => {
      for (const d of await store.all(ctx, COL.app, 5)) await ctx.api.store.remove(d.id);
      await store.setHealth(ctx, null);
    });
    forget();
    return { ok: ctx.t("removed"), redirect: "?" };
  },
  /** One switch of the list: `enabled` says the state wanted ("1" or "0"), nothing is inverted (a double click never undoes the first). The owner only (right `bot.manage`). */
  async setChannel(ctx, values) {
    const id = store.snowflake(values?.id), want = values?.enabled === "1";
    if (!id || (values?.enabled !== "1" && values?.enabled !== "0")) return { error: ctx.t("err_channel") };
    return store.serialAllow(ctx, async () => {
      const cur = await store.allowedIds(ctx);
      if (want === cur.includes(id)) return { ok: cur.length ? `${limitedText(ctx, cur.length)}.` : ctx.t("limit_off") };
      if (want) {
        const list = await service.detailedChannels(ctx);
        if (!list.ok) return { error: ctx.t(`why_${list.reason}`) };
        if (!list.channels.some((c) => c.id === id)) return { error: ctx.t("err_channel_gone") };
        if (cur.length >= store.LIMITS.allow) return { error: ctx.t("err_too_many", { n: store.LIMITS.allow }) };
      }
      const next = want ? [...cur, id] : cur.filter((x) => x !== id);
      await store.setAllowed(ctx, next);
      return { ok: next.length ? `${limitedText(ctx, next.length)}.` : ctx.t("limit_off") };
    });
  },
  /** The suggestion: the channels where modules already keep a message (a limit that leaves them out would stop them). */
  async chooseUsed(ctx) {
    return store.serialAllow(ctx, async () => {
      if ((await store.allowedIds(ctx)).length) return { error: ctx.t("err_already_limited") };   // a suggestion never widens or replaces a list
      const list = await service.detailedChannels(ctx);
      if (!list.ok) return { error: ctx.t(`why_${list.reason}`) };
      const there = new Set(list.channels.map((c) => c.id));
      const used = [...new Set((await store.managedList(ctx)).map((d) => d.data.channelId))].filter((id) => there.has(id)).slice(0, store.LIMITS.allow);
      if (!used.length) return { error: ctx.t("err_no_used") };
      await store.setAllowed(ctx, used);
      return { ok: `${limitedText(ctx, used.length)}.`, redirect: "?" };
    });
  },
  /** Lifts the limit: the bot may write in every channel of the server again. */
  async allowAll(ctx) {
    await store.serialAllow(ctx, () => store.setAllowed(ctx, []));
    return { ok: ctx.t("limit_off"), redirect: "?" };
  },
  /** Deletes a kept message on Discord and forgets it. */
  async forgetKept(ctx, values) {
    const id = typeof values?.id === "string" ? values.id : "";
    const doc = (await store.managedList(ctx)).find((d) => d.id === id);
    if (!doc) return { error: ctx.t("not_found") };
    const r = await service.methods.forgetManagedMessage(ctx, { owner: doc.data.owner, key: doc.data.key });
    return r.ok ? { ok: ctx.t("forgotten"), redirect: "?" } : { error: ctx.t(`why_${r.reason}`) };
  },
};

/** Every action refuses anybody but the holder of the right (the core refuses first; this is the second lock, which also holds in a test or an older core). */
export const actions = Object.fromEntries(Object.entries(raw).map(([name, run]) => [name, async (ctx, values) => (owns(ctx) ? run(ctx, values) : { error: ctx.t("err_owner_only") })]));
