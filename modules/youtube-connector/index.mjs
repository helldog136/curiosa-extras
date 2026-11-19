// Connecteur YouTube — porte la clé YouTube du site, la connexion facultative au compte YouTube (lire/écrire dans le chat) et offre le service `youtube.api` (liste fermée d'appels, quota compté, cache daté).
// La logique est dans api.mjs (appels) et oauth.mjs (connexion) ; ici : le service, et le panneau d'administration (sans aucun appel réseau à l'ouverture).
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const creds = await import(`./credentials.mjs${v}`);
const { ID_RE, SECRET_RE } = await import(`./oauth.mjs${v}`);
const { HOST, LIMITS, accountCancel, accountCheck, accountConnection, accountDisconnect, accountStart, adopt, channels, chatPost, request, status, within } = await import(`./api.mjs${v}`);

const bounded = (fn) => (ctx, args) => within(fn(ctx, args ?? {}), LIMITS.callMs, () => ({ ok: false, error: "timeout" }));

/** « 9 h » / « 9 h 30 » en français, « 9:00 AM » en anglais ; « demain » si ce n'est pas aujourd'hui (heure du serveur, comme le reste de l'admin). */
export function resumeText(ctx, at, now = Date.now()) {
  const d = new Date(at);
  const fr = String(ctx.locale ?? "").startsWith("fr");
  const hour = fr ? `${d.getHours()} h${d.getMinutes() ? ` ${String(d.getMinutes()).padStart(2, "0")}` : ""}` : new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(d);
  const today = new Date(now).toDateString() === d.toDateString();
  const tomorrow = new Date(now + 86_400_000).toDateString() === d.toDateString();
  return ctx.t(today ? "when_today" : tomorrow ? "when_tomorrow" : "when_later", { hour, date: d.toLocaleDateString(ctx.locale) });
}

const esc = (x) => String(x ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const date = (ctx, at) => (at ? new Date(at).toLocaleDateString(ctx.locale) : "");
/** Le cœur ABANDONNE le message d'une action qui redirige : on ne redirige (pour redessiner l'écran) que si l'écran lui-même dit déjà la chose (code affiché, état de la carte). Un refus qui ne change rien reste sous le bouton. */
function connectResult(ctx, r, okKey) {
  if (r.ok) return { ok: ctx.t(okKey), redirect: "?" };
  return { error: ctx.t(`err_${r.error}`) };
}
const SHOWN_BY_SCREEN = new Set(["denied", "expired", "policy", "client", "google", "scope", "no_pending"]);   // l'écran garde la trace (raison de la carte) et le code en attente a disparu
const plain = (v) => (typeof v === "string" ? v.trim() : "");

export default {
  services: {
    "youtube.api": {
      request: bounded(request),
      channels: bounded(channels),
      adopt: bounded(adopt),
      status: bounded(status),
      chatPost: bounded(chatPost),
    },
  },

  // Données en version 2 : la clé, l'ID client et le secret des réglages passent dans le stockage (voir credentials.mjs).
  migrations: { 2: async (ctx) => { await creds.migrateSettings(ctx); } },

  hooks: {
    // L'instance est supprimée : l'accès au compte YouTube est retiré chez Google aussi (au mieux ; les jetons partent de toute façon avec les données).
    onInstanceDelete: async (ctx) => { try { await accountDisconnect(ctx); } catch { /* rien d'autre à faire */ } },
  },

  adminActions: {
    accountConnect: async (ctx) => connectResult(ctx, await accountStart(ctx, { write: ctx.setting("chatReply") === true }), "connect_started"),
    accountCheck: async (ctx) => {
      const r = await accountCheck(ctx);
      if (r.ok && r.connected) return { ok: ctx.t(r.write ? "check_done_write" : "check_done"), redirect: "?" };
      if (r.ok && r.pending) return { ok: ctx.t("check_pending", { seconds: r.waitSec }) };
      return SHOWN_BY_SCREEN.has(r.error) ? { error: ctx.t(`err_${r.error}`), redirect: "?" } : { error: ctx.t(`err_${r.error}`) };
    },
    accountCancel: async (ctx) => { await accountCancel(ctx); return { ok: ctx.t("cancel_done"), redirect: "?" }; },
    accountDisconnect: async (ctx) => {
      const r = await accountDisconnect(ctx);
      return { ok: ctx.t(r.revoked === false ? "disconnect_local" : "disconnect_done"), redirect: "?" };
    },
    /** The access code typed in the "Modify" window: an empty field keeps the current one. */
    async saveKey(ctx, values) {
      const key = plain(values?.apiKey);
      const cur = await creds.read(ctx);
      if (key && !/^[\x21-\x7e]{10,200}$/.test(key)) return { errors: { apiKey: ctx.t("err_key") } };
      if (!key && !cur.apiKey) return { errors: { apiKey: ctx.t("err_key") } };
      if (key) await creds.save(ctx, { apiKey: key });
      return { ok: ctx.t("key_saved"), redirect: "?" };
    },
    /** The Google client (ID and secret) typed in the "Modify" window of the account: an empty field keeps the current value. */
    async saveAccount(ctx, values) {
      const id = plain(values?.oauthClientId), secret = plain(values?.oauthClientSecret);
      const cur = await creds.read(ctx);
      const errors = {};
      if (id ? !ID_RE.test(id) : !cur.oauthClientId) errors.oauthClientId = ctx.t("err_client_id_field");
      if (secret ? !SECRET_RE.test(secret) : !cur.oauthClientSecret) errors.oauthClientSecret = ctx.t("err_client_secret_field");
      if (Object.keys(errors).length) return { errors };
      await creds.save(ctx, { ...(id ? { oauthClientId: id } : {}), ...(secret ? { oauthClientSecret: secret } : {}) });
      return { ok: ctx.t("account_saved"), redirect: "?" };
    },
    /** Forgets the access code carried over from another extension: only what was typed here stays. */
    async forgetKey(ctx) { await creds.forgetCarried(ctx); return { ok: ctx.t("key_forgotten"), redirect: "?" }; },
  },

  async adminPanel(ctx, { query } = {}) {
    const s = await status(ctx);
    const cur = await creds.read(ctx);
    const c = await accountConnection(ctx);
    const blocks = [keyBlock(ctx, s, cur), ...(await accountBlocks(ctx, c, query?.setup === "account", s.key !== "missing"))];
    if (query?.edit === "key") blocks.push(keyDialog(ctx, cur));
    if (query?.edit === "account") blocks.push(accountDialog(ctx, cur));
    return blocks;
  },
};

/** The access code: one block (state, quota of the day on one line, "Modify"). The daily allowance is shown only when it is nearly used up, as a problem when it is used up. */
function keyBlock(ctx, s, cur) {
  const head = { type: "connection", id: "key", title: ctx.t("key_title"), summary: "" };
  if (s.key === "missing") return { ...head, state: "notConfigured", reason: ctx.t("key_missing"), primary: { label: ctx.t("key_register"), href: "?edit=key" }, setup: [{ type: "markdown", text: ctx.t("key_help") }] };
  // One line: which code is set (its last characters, never more). The daily allowance joins it only when it is nearly used up (once used up, the reason says it).
  const near = s.quota.budget > 0 && !s.quota.exhausted && s.quota.used >= s.quota.budget * 0.8;
  const which = ctx.t("key_summary", { tail: String(cur?.apiKey ?? "").slice(-4) });
  const base = {
    ...head, summary: near ? `${which} · ${ctx.t("quota_summary", { used: s.quota.used.toLocaleString(ctx.locale), budget: s.quota.budget.toLocaleString(ctx.locale) })}` : which, edit: { href: "?edit=key" },
    net: [{ host: HOST, label: "YouTube", ...(s.lastGoodAt ? { lastGoodAt: s.lastGoodAt } : {}) }],
  };
  if (s.key === "refused") return { ...base, state: "degraded", reason: ctx.t("key_refused"), primary: { label: ctx.t("key_fix"), href: "?edit=key" } };
  if (s.quota.exhausted) return { ...base, state: "degraded", reason: ctx.t("quota_exhausted", { when: resumeText(ctx, Date.parse(s.quota.until)) }) };
  return { ...base, state: "configured" };
}

function keyDialog(ctx, cur) {
  const has = !!cur.apiKey, carried = cur.carried.includes("apiKey");
  return {
    type: "adminForm", presentation: "dialog", action: "saveKey", cancelHref: "?", title: ctx.t("key_title"), submitLabel: ctx.t("key_save"),
    fields: [{ name: "apiKey", label: ctx.t("f_key"), kind: "secret", help: ctx.t("f_key_help"), ...(has ? { value: "", valueHint: "kept" } : {}) }],
    ...(carried ? { secondaryAction: { label: ctx.t("key_forget"), action: "forgetKey", confirm: ctx.t("key_forget_confirm") } } : {}),
  };
}

function accountDialog(ctx, cur) {
  return {
    type: "adminForm", presentation: "dialog", action: "saveAccount", cancelHref: "?", title: ctx.t("acc_title"), submitLabel: ctx.t("acc_save"),
    fields: [
      { name: "oauthClientId", label: ctx.t("f_client_id"), kind: "text", example: ctx.t("f_client_id_example"), help: ctx.t("f_client_id_help"), ...(cur.oauthClientId ? { value: "", valueHint: "kept", valueTail: cur.oauthClientId.replace(/\.apps\.googleusercontent\.com$/i, "").slice(-4) } : {}) },
      { name: "oauthClientSecret", label: ctx.t("f_client_secret"), kind: "secret", ...(cur.oauthClientSecret ? { value: "", valueHint: "kept" } : {}) },
    ],
  };
}

const form = (action, label) => ({ type: "adminForm", action, submitLabel: label, submitStyle: "secondary", fields: [{ name: "go", kind: "hidden", value: "1" }] });
/** Failures of the last attempt are the reason of the card; "disconnected" is shown by the card itself (its state changed). */
const lastReason = (ctx, c) => (c.last && c.last.code !== "disconnected" && c.last.code !== "write_missing" ? ctx.t(`last_${c.last.code}`) : "");

/** The YouTube account (optional): one block, in the state that tells what the person can do now. No network call, never a token or a secret. */
async function accountBlocks(ctx, c, asked = false, keySet = true) {
  const wanted = ctx.setting("chatReply") === true;
  const head = { type: "connection", id: "account", title: ctx.t("acc_title"), summary: "" };
  if (c.state === "connected") {
    const summary = ctx.t(c.write ? (wanted ? "acc_summary_write" : "acc_summary_write_idle") : "acc_summary_read", { date: date(ctx, c.since) });
    const base = { ...head, summary, edit: { href: "?edit=account" }, menu: [{ label: ctx.t("btn_disconnect"), action: "accountDisconnect", confirm: ctx.t("disconnect_confirm"), danger: true }] };
    if (wanted && !c.write) return [{ ...base, state: "degraded", reason: ctx.t(c.last?.code === "write_missing" ? "last_write_missing" : "acc_need_write"), primary: { label: ctx.t("btn_reconnect_write"), action: "accountConnect" } }];
    return [{ ...base, state: "configured" }];
  }
  if (c.state === "pending" && c.pending) {
    return [{
      ...head, state: "notConfigured", reason: ctx.t(c.pending.wantWrite ? "acc_pending_write" : "acc_pending"), primary: { label: ctx.t("btn_check"), action: "accountCheck" },
      setup: [{ type: "html", html: await pendingHtml(ctx, c.pending) }, form("accountCancel", ctx.t("btn_cancel"))],
    }];
  }
  if (c.state === "stale") {
    return [{ ...head, state: "degraded", reason: ctx.t("acc_stale"), edit: { href: "?edit=account" }, primary: c.configured ? { label: ctx.t("btn_connect"), action: "accountConnect" } : { label: ctx.t("acc_fix"), href: "?edit=account" } }];
  }
  if (!c.configured) {
    // Optional and not started: one action, not a "not configured" card with a guide. The guide opens when the person asks for it (or once something was typed or failed).
    if (!asked && !c.idSet && !c.secretSet && !lastReason(ctx, c)) return keySet ? [{ type: "links", items: [{ label: ctx.t("acc_start"), href: "?setup=account" }] }] : [];   // the access code comes first
    const reason = c.idSet && !c.idOk ? ctx.t("acc_bad_id") : c.secretSet && !c.secretOk ? ctx.t("acc_bad_secret") : lastReason(ctx, c) || ctx.t("acc_none");
    const primary = c.idSet || c.secretSet ? { label: ctx.t("acc_fix"), href: "?edit=account" } : { label: ctx.t("acc_register"), href: "?edit=account" };
    return [{ ...head, state: "notConfigured", reason, primary, setup: [{ type: "html", html: stepsHtml(ctx) }] }];
  }
  return [
    { ...head, state: "notConfigured", reason: lastReason(ctx, c) || ctx.t("acc_not_connected"), primary: { label: ctx.t("btn_connect"), action: "accountConnect" } },
    { type: "links", items: [{ label: ctx.t("acc_edit_client"), href: "?edit=account" }] },
  ];
}
/** Un texte du panneau avec **gras** et [liens](https://…) → HTML sûr (tout est échappé d'abord ; seuls les liens https sont gardés). */
function inline(text) {
  return esc(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="text-decoration:underline;text-underline-offset:2px">$1</a>');
}
/** Les 4 étapes de la mise en route, en liste numérotée. */
function stepsHtml(ctx) {
  const items = [1, 2, 3, 4].map((n) => `<li style="margin:.4rem 0">${inline(ctx.t(`acc_step${n}`))}</li>`).join("");
  return `<ol style="list-style:decimal;padding-left:1.5rem;line-height:1.55;margin:.25rem 0">${items}</ol>`;
}
async function pendingHtml(ctx, p) {
  let qr = "";
  try { const svg = await ctx.api.qr(p.url); if (typeof svg === "string" && svg.startsWith("<svg")) qr = `<div role="img" aria-label="${esc(ctx.t("pend_qr_alt"))}" style="background:#fff;padding:8px;border-radius:8px;width:160px;height:160px;box-sizing:content-box;flex:none"><div style="width:160px;height:160px">${svg.replace("<svg", '<svg style="width:100%;height:100%;display:block"')}</div></div>`; } catch { /* le code suffit */ }
  const minutes = Math.max(1, Math.ceil((p.expiresAt - Date.now()) / 60_000));
  const li = (k, vars) => `<li style="margin:.4rem 0">${esc(ctx.t(k, vars))}</li>`;
  return `<div style="display:flex;flex-wrap:wrap;gap:1rem;align-items:flex-start;line-height:1.5">${qr}<div style="flex:1 1 16rem;min-width:0">`
    + `<ol style="list-style:decimal;padding-left:1.5rem;margin:0">${li("pend_1", { url: p.url.replace(/^https:\/\//, "") })}${li("pend_2")}`
    + `<li style="margin:.4rem 0">${esc(ctx.t("pend_3"))}<p style="margin:.4rem 0 .4rem -1.5rem;padding:.6rem .8rem;border:2px solid currentColor;border-radius:.6rem;font:800 1.75rem/1.2 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.08em;overflow-wrap:anywhere;user-select:all" aria-label="${esc(ctx.t("pend_code_label"))}">${esc(p.userCode)}</p></li>`
    + `${li("pend_4")}${li("pend_5", { minutes })}</ol>`
    + `<p style="margin:.6rem 0 0"><a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;min-height:44px;line-height:44px;padding:0 .25rem;font-weight:700;text-decoration:underline;text-underline-offset:3px">${esc(ctx.t("pend_open"))}</a></p>`
    + `</div></div>`;
}
