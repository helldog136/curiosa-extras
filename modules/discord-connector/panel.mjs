// The administration of the Discord connector: ONE card of the core (state, one line, "Edit"), the messages kept up to date for other modules, and the "Edit" window
// (application number, server number, bot secret code). The guide exists only while no bot is registered. Never a secret, never a stored value of the code.
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
const words = (ctx, missing) => [...new Set(missing.map((m) => ctx.t(`perm_${m.permission}`)))].join(", ");

/** What is missing on the whole server, by feature, in words: "Posting messages: embed links". */
export function missingText(ctx, missing) {
  const by = new Map();
  for (const m of missing) by.set(m.feature, [...(by.get(m.feature) ?? []), m]);
  return [...by].map(([f, list]) => `${ctx.t(`feature_${f}`)} (${words(ctx, list)})`).join(" · ");
}

async function card(ctx, creds, p, can) {
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
    ...head, summary: ctx.t("summary", { tail: creds.applicationId.slice(-4) }), edit: { href: EDIT },
    menu: [{ label: ctx.t("test"), action: "test" }, { label: ctx.t("remove"), action: "removeBot", confirm: ctx.t("remove_confirm"), danger: true }],
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

async function keptTable(ctx, can) {
  const docs = await store.managedList(ctx);
  if (!docs.length) return [];
  const names = new Map();
  const chans = await service.methods.listChannels(ctx, {});
  for (const c of chans.ok ? chans.channels : []) names.set(c.id, `#${c.name}`);
  const owners = new Map();
  for (const d of docs) {
    const o = d.data.owner;
    if (!o || owners.has(o)) continue;
    try { owners.set(o, (await ctx.api.instances.list({ module: o, locale: ctx.locale }))?.[0]?.name || o); } catch { owners.set(o, o); }
  }
  const date = (iso) => { try { return new Date(iso).toLocaleString(ctx.locale || "en", { dateStyle: "medium", timeStyle: "short", timeZone: ctx.timezone || "UTC" }); } catch { return ""; } };
  return [{
    type: "table", title: ctx.t("kept_title"), searchable: true, pageSize: 50, truncate: true,
    columns: [ctx.t("col_module"), ctx.t("col_message"), ctx.t("col_channel"), ctx.t("col_updated")],
    rows: docs.map((d) => [owners.get(d.data.owner) ?? d.data.owner ?? "", d.data.label || d.data.key || "", names.get(d.data.channelId) ?? `…${String(d.data.channelId).slice(-4)}`, date(d.data.at)]),
    rowIds: docs.map((d) => d.id),
    ...(can ? { rowActions: [{ label: ctx.t("forget_row"), action: "forgetKept", confirm: ctx.t("forget_confirm"), danger: true, inMenu: true }] } : {}),
  }];
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
  const out = [await card(ctx, creds, p, can)];
  if (store.hasBot(creds)) out.push(...(await keptTable(ctx, can)));
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
    if (v.missing?.length) return { error: ctx.t("test_missing", { list: missingText(ctx, v.missing) }) };
    return { ok: ctx.t("test_ok") };
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
