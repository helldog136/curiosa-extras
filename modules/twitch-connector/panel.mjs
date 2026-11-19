// L'administration du Connecteur : UN bloc « connexion » du cœur (état, résumé d'une ligne, « Modifier »), les comptes connectés avec « Déconnecter », et la fenêtre « Modifier »
// (Client ID et secret ; « Oublier l'application reprise » y vit). Le guide de mise en place n'existe que tant que l'application n'est pas réglée. Jamais un jeton ni une valeur.
const version = new URL(import.meta.url).search;
const store = await import(new URL(`./store.mjs${version}`, import.meta.url).href);
const helix = await import(new URL(`./helix.mjs${version}`, import.meta.url).href);
const oauth = await import(new URL(`./oauth.mjs${version}`, import.meta.url).href);
const conn = await import(new URL(`./connections.mjs${version}`, import.meta.url).href);
const service = await import(new URL(`./service.mjs${version}`, import.meta.url).href);
const hl = await import(new URL(`./health.mjs${version}`, import.meta.url).href);
const { COL } = store;

const twitchLink = (u) => typeof u === "string" && /^https:\/\/id\.twitch\.tv\/oauth2\/authorize\?/.test(u);
const EDIT = "?edit=app";
/** What is wrong with an account, in plain words (one line; the date comes from the block itself). */
export const problemText = (ctx, c) => ctx.t(`health_${c.health.state}`, { account: c.login, list: hl.scopeWords(ctx, c.health.missing) });
const accountName = (ctx, c) => (c.slot === "bot" ? ctx.t("slot_bot", { login: c.login, channel: c.channel }) : c.login);

/** Asks Twitch now (a check younger than a minute is reused): the page never shows "Configured" for an authorization nobody verified. */
async function refresh(ctx) {
  const creds = await store.credsOf(ctx);
  if (!store.hasCreds(creds)) return;
  const entries = await store.conns(ctx);
  await helix.bounded(Promise.all(entries.map((e) => hl.verify(ctx, creds, e, { userToken: helix.userToken }).catch(() => null))).then(() => ({})));
}

/** The authorization link of one account (always https://id.twitch.tv), or null. */
async function authorizeLink(ctx, c) {
  const link = await service.methods.connectLink(ctx, { channel: c.channel, slot: c.slot, force: true, returnTo: conn.adminPage(ctx) });
  return twitchLink(link?.url) ? link.url : null;
}

/** The state of the application and of the accounts that use it. */
async function appBlock(ctx, creds, list, own) {
  const net = [
    { host: helix.API_HOST, label: ctx.t("health_net"), ...(helix.lastGood(helix.API_HOST) ? { lastGoodAt: helix.lastGood(helix.API_HOST) } : {}) },
    { host: oauth.ID_HOST, label: ctx.t("health_net"), ...(helix.lastGood(oauth.ID_HOST) ? { lastGoodAt: helix.lastGood(oauth.ID_HOST) } : {}) },
  ];
  const head = { type: "connection", id: "app", title: ctx.t("app_title") };
  if (!store.hasCreds(creds)) {
    const missing = !creds.clientId && !creds.secret ? "app_none" : !creds.clientId ? "app_no_id" : "app_no_secret";
    return {
      ...head, state: "notConfigured", reason: ctx.t(missing), primary: { label: ctx.t("app_register"), href: EDIT },
      setup: [
        { type: "markdown", text: [ctx.t("guide_1"), ctx.t("guide_2")].join("\n\n") },
        { type: "copy", label: ctx.t("copy_label"), text: own },
        { type: "markdown", text: [ctx.t("guide_3"), ctx.t("guide_4")].join("\n\n") },
      ],
    };
  }
  const n = list.length;
  const tail = creds.clientId.slice(-4);
  const summary = ctx.t(n === 0 ? "app_summary_none" : "app_summary", { tail });
  const bad = list.filter((c) => hl.isProblem(c.health.state));
  const base = { ...head, summary, edit: { href: EDIT }, net };
  if (!bad.length) return { ...base, state: "configured" };
  if (bad.some((c) => c.health.state === "app")) {
    const c = bad.find((x) => x.health.state === "app");
    return { ...base, state: "degraded", reason: ctx.t("health_app"), ...(c.health.since ? { since: new Date(c.health.since).toISOString() } : {}), primary: { label: ctx.t("app_fix"), href: EDIT } };
  }
  if (bad.length === 1) {
    const c = bad[0];
    const url = await authorizeLink(ctx, c);
    return { ...base, state: "degraded", reason: problemText(ctx, c), ...(c.health.since ? { since: new Date(c.health.since).toISOString() } : {}), ...(url ? { primary: { label: ctx.t("authorize_again"), href: url } } : {}) };
  }
  const rows = [];
  for (const c of bad) {
    const url = await authorizeLink(ctx, c);
    rows.push({ text: accountName(ctx, c), state: "degraded", reason: c.health.state === "scopes" ? ctx.t("conn_state_scopes", { list: hl.scopeWords(ctx, c.health.missing) }) : ctx.t("conn_state_renew"), ...(url ? { primary: { label: ctx.t("authorize_again"), href: url } } : {}) });
  }
  return { ...base, state: "degraded", reason: ctx.t("health_many", { n: bad.length }), rows };
}

/** The window "Modify": the two fields, a value that is set is shown as set; forgetting a carried-over application is its secondary action. */
function appDialog(ctx, creds, own) {
  const kept = (field, has, tail) => (has ? { value: "", valueHint: "kept", ...(tail ? { valueTail: tail } : {}) } : {});
  return {
    type: "adminForm", presentation: "dialog", action: "saveApp", cancelHref: "?", title: ctx.t("app_title"), submitLabel: ctx.t("app_save"),
    fields: [
      { name: "clientId", label: ctx.t("f_client_id"), kind: "text", example: ctx.t("f_client_id_example"), help: ctx.t("f_client_id_help", { address: own }), ...kept("clientId", !!creds.clientId, creds.clientId.slice(-4)) },
      { name: "clientSecret", label: ctx.t("f_secret"), kind: "secret", ...kept("clientSecret", !!creds.secret) },
    ],
    ...(creds.carried.length ? { secondaryAction: { label: ctx.t("forget"), action: "forgetApp", confirm: ctx.t("forget_confirm") } } : {}),
  };
}

/** Where to connect the first account: the pages of the other Twitch modules (only the installed ones). */
async function connectLinks(ctx) {
  const items = [];
  for (const [module, key] of [["twitch-channel", "link_channel"], ["twitch-bot", "link_bot"]]) {
    try {
      const found = await ctx.api.instances.list({ module });
      const path = found?.[0]?.adminPath;
      if (typeof path === "string" && store.RETURN_TO.test(path)) items.push({ label: ctx.t(key), href: path });
    } catch { /* module absent: no link */ }
  }
  return items.length ? [{ type: "links", items }] : [];
}

export async function render(ctx, { query } = {}) {
  const creds = await store.credsOf(ctx);
  const own = conn.ownRedirect(ctx);
  await refresh(ctx);
  const list = await service.methods.connections(ctx);
  const out = [];
  if (!conn.secure(own)) out.push({ type: "banner", tone: "warning", text: ctx.t("needHttps") });
  out.push(await appBlock(ctx, creds, list, own));
  if (list.length) {
    out.push({
      type: "table", columns: [ctx.t("col_account")], pageSize: 0, rows: list.map((c) => [accountName(ctx, c)]), rowIds: list.map((c) => c.id),
      rowActions: [{ label: ctx.t("disconnect"), action: "disconnect", confirm: ctx.t("disconnect_confirm"), danger: true }],
    });
  } else if (store.hasCreds(creds)) out.push(...(await connectLinks(ctx)));
  if (query?.edit === "app") out.push(appDialog(ctx, creds, own));
  return out;
}

export const actions = {
  async disconnect(ctx, values) {
    const id = typeof values?.id === "string" ? values.id : "";
    const doc = (await store.conns(ctx)).find((d) => d.id === id) ?? null;
    if (!doc) return { error: ctx.t("not_found") };
    const r = await store.serial(ctx, () => conn.disconnect(ctx, doc));
    return { ok: ctx.t(r.reached ? "disconnected" : "disconnectedOffline"), redirect: "?" };
  },
  /** Saves what was typed in the window; an empty field keeps the current value. A value typed here is "yours" (no longer carried over). */
  async saveApp(ctx, values) {
    const idIn = store.text(values?.clientId), secretIn = store.text(values?.clientSecret);
    const errors = {};
    if (idIn && !store.plain(idIn)) errors.clientId = ctx.t("err_client_id");
    if (secretIn && !store.plain(secretIn)) errors.clientSecret = ctx.t("err_secret");
    return store.serial(ctx, async () => {
      const doc = await store.first(ctx, COL.app);
      const had = doc?.data ?? {};
      const cur = await store.credsOf(ctx);
      if (!idIn && !cur.clientId) errors.clientId = ctx.t("err_client_id");
      if (!secretIn && !cur.secret) errors.clientSecret = ctx.t("err_secret");
      if (Object.keys(errors).length) return { errors };
      const carried = cur.carried.filter((f) => !(f === "clientId" && idIn) && !(f === "clientSecret" && secretIn));
      await store.put(ctx, COL.app, doc, { ...had, clientId: idIn || cur.clientId, clientSecret: secretIn || cur.secret, carried });
      return { ok: ctx.t("saved"), redirect: "?" };
    });
  },
  /** Forgets the application carried over from another module: only what was typed here stays. */
  async forgetApp(ctx) {
    await store.serial(ctx, async () => {
      const doc = await store.first(ctx, COL.app);
      if (!doc) return;
      const cur = await store.credsOf(ctx);
      const next = { ...doc.data, carried: [] };
      for (const f of cur.carried) delete next[f];
      if (store.text(next.clientId) || store.text(next.clientSecret)) await ctx.api.store.update(doc.id, next);
      else await ctx.api.store.remove(doc.id);
      for (const extra of (await store.all(ctx, COL.app, 5)).slice(1)) await ctx.api.store.remove(extra.id);
    });
    return { ok: ctx.t("forgotten"), redirect: "?" };
  },
};
