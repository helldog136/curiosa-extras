// L'administration du Connecteur : un guide pas à pas pour créer l'application chez Twitch (avec l'adresse à coller et un bouton « Copier »),
// l'état de l'application (jamais ses valeurs), les comptes connectés (sans jeton), la santé de Twitch, et les actions « Déconnecter » / « Oublier ».
const version = new URL(import.meta.url).search;
const store = await import(new URL(`./store.mjs${version}`, import.meta.url).href);
const helix = await import(new URL(`./helix.mjs${version}`, import.meta.url).href);
const oauth = await import(new URL(`./oauth.mjs${version}`, import.meta.url).href);
const conn = await import(new URL(`./connections.mjs${version}`, import.meta.url).href);
const service = await import(new URL(`./service.mjs${version}`, import.meta.url).href);
const hl = await import(new URL(`./health.mjs${version}`, import.meta.url).href);
const { COL } = store;

const stateLabel = (ctx, s) => ctx.t(`conn_state_${s}`);
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
/** The one primary button: a link to Twitch's authorization page (address given by the connector, always https://id.twitch.tv). */
const button = (label, href) => ({ type: "html", html: `<p><a data-twitch-connect href="${esc(href)}" style="display:inline-block;padding:.65rem 1.25rem;border-radius:.75rem;background:var(--v-accent);color:var(--v-accent-fg);font-weight:600;text-decoration:none">${esc(label)}</a></p>` });
const twitchLink = (u) => typeof u === "string" && /^https:\/\/id\.twitch\.tv\/oauth2\/authorize\?/.test(u);
const since = (ctx, at) => { try { return new Date(at).toLocaleString(ctx.locale, { dateStyle: "long", timeStyle: "short", timeZone: ctx.timezone }); } catch { return ""; } };
/** What is wrong with an account, in plain words. */
export const problemText = (ctx, c) => ctx.t(`health_${c.health.state}`, { account: c.login, list: hl.scopeWords(ctx, c.health.missing) });

/** Asks Twitch now (a check younger than a minute is reused): the page never shows "Connected" for an authorization nobody verified. */
async function refresh(ctx) {
  const creds = await store.credsOf(ctx);
  if (!store.hasCreds(creds)) return;
  const entries = await store.conns(ctx);
  await helix.bounded(Promise.all(entries.map((e) => hl.verify(ctx, creds, e, { userToken: helix.userToken }).catch(() => null))).then(() => ({})));
}

/** The attention block: one banner and one button per account that needs the owner. Empty when all works. */
async function attention(ctx, list) {
  const out = [];
  for (const c of list.filter((x) => hl.isProblem(x.health.state))) {
    out.push({ type: "banner", tone: "warning", text: `${problemText(ctx, c)}${c.health.since ? ` ${ctx.t("health_since", { date: since(ctx, c.health.since) })}` : ""}` });
    if (c.health.state === "app") continue;   // the application settings below are the fix, not a new authorization
    const link = await service.methods.connectLink(ctx, { channel: c.channel, slot: c.slot, force: true, returnTo: conn.adminPage(ctx) });
    if (twitchLink(link?.url)) out.push(button(ctx.t("authorize_again"), link.url));
  }
  return out;
}

export async function render(ctx) {
  const creds = await store.credsOf(ctx);
  const ready = store.hasCreds(creds);
  const own = conn.ownRedirect(ctx);
  await refresh(ctx);
  const list = await service.methods.connections(ctx);
  const out = await attention(ctx, list);
  out.push({ type: "heading", text: ctx.t("app_title") });
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
  if (!list.length) out.push({ type: "markdown", text: ctx.t("accounts_none") });
  else {
    out.push({
      type: "table", columns: [ctx.t("col_channel"), ctx.t("col_account"), ctx.t("col_state")],
      rows: list.map((c) => [c.channel, `${c.login} · ${ctx.t(c.slot === "bot" ? "slot_bot" : "slot_main")}`, stateLabel(ctx, c.health.state === "ok" ? "ok" : c.health.state) + (c.health.state === "scopes" ? `\n${hl.scopeWords(ctx, c.health.missing)}` : "")]),
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
