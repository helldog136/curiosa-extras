// L'administration du Connecteur : un guide pas à pas pour créer l'application chez Twitch (avec l'adresse à coller et un bouton « Copier »),
// l'état de l'application (jamais ses valeurs), les comptes connectés (sans jeton), la santé de Twitch, et les actions « Déconnecter » / « Oublier ».
const version = new URL(import.meta.url).search;
const store = await import(new URL(`./store.mjs${version}`, import.meta.url).href);
const helix = await import(new URL(`./helix.mjs${version}`, import.meta.url).href);
const oauth = await import(new URL(`./oauth.mjs${version}`, import.meta.url).href);
const conn = await import(new URL(`./connections.mjs${version}`, import.meta.url).href);
const service = await import(new URL(`./service.mjs${version}`, import.meta.url).href);
const { COL } = store;

const stateLabel = (ctx, s) => ctx.t(`conn_state_${s}`);

export async function render(ctx) {
  const creds = await store.credsOf(ctx);
  const ready = store.hasCreds(creds);
  const own = conn.ownRedirect(ctx);
  const out = [{ type: "heading", text: ctx.t("app_title") }];
  if (!conn.secure(own)) out.push({ type: "banner", tone: "warning", text: ctx.t("needHttps") });
  if (ready) out.push({ type: "banner", tone: "success", text: ctx.t("app_ready") });
  else out.push({ type: "markdown", text: [ctx.t("guide_intro"), ctx.t("guide_1"), ctx.t("guide_2")].join("\n\n") });
  out.push({ type: "copy", label: ctx.t("copy_label"), text: own });
  if (!ready) out.push({ type: "markdown", text: [ctx.t("guide_3"), ctx.t("guide_4")].join("\n\n") });
  else out.push({ type: "markdown", text: ctx.t("redirect_keep") });
  const kept = (await store.channels(ctx)).filter((d) => d.data.redirectUri && d.data.redirectUri !== own);
  if (kept.length) {
    out.push({ type: "markdown", text: ctx.t("redirect_adopted") });
    out.push({ type: "table", columns: [ctx.t("col_channel"), ctx.t("col_address")], rows: kept.map((d) => [d.data.channel, d.data.redirectUri]) });
  }
  if ((await store.first(ctx, COL.app)) && (!store.text(ctx.setting("appClientId")) || !store.text(ctx.setting("appSecret")))) {
    out.push({ type: "banner", tone: "info", text: ctx.t("adopted_note") });
    out.push({ type: "adminForm", action: "forgetApp", submitLabel: ctx.t("forget"), fields: [] });
  }

  out.push({ type: "heading", text: ctx.t("accounts_title") });
  const list = await service.methods.connections(ctx);
  if (!list.length) out.push({ type: "markdown", text: ctx.t("accounts_none") });
  else {
    out.push({
      type: "table", columns: [ctx.t("col_channel"), ctx.t("col_account"), ctx.t("col_state")],
      rows: list.map((c) => [c.channel, `${c.login} · ${ctx.t(c.slot === "bot" ? "slot_bot" : "slot_main")}`, stateLabel(ctx, c.status)]),
      rowIds: list.map((c) => c.id),
      rowActions: [{ label: ctx.t("disconnect"), action: "disconnect", confirm: ctx.t("disconnect_confirm"), danger: true }],
    });
  }
  out.push({ type: "netHealth", items: [
    { host: helix.API_HOST, label: ctx.t("health_api"), ...(helix.lastGood(helix.API_HOST) ? { lastGoodAt: helix.lastGood(helix.API_HOST) } : {}) },
    { host: oauth.ID_HOST, label: ctx.t("health_id"), ...(helix.lastGood(oauth.ID_HOST) ? { lastGoodAt: helix.lastGood(oauth.ID_HOST) } : {}) },
  ] });
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
  /** Oublie l'application reprise d'un autre module : seuls les réglages de cette page comptent ensuite. */
  async forgetApp(ctx) {
    await store.serial(ctx, async () => { for (const d of await store.all(ctx, COL.app, 5)) await ctx.api.store.remove(d.id); });
    return { ok: ctx.t("forgotten"), redirect: "?" };
  },
};
