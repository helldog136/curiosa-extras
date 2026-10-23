// Connecteur YouTube — porte la clé YouTube du site, la connexion facultative au compte YouTube (lire/écrire dans le chat) et offre le service `youtube.api` (liste fermée d'appels, quota compté, cache daté).
// La logique est dans api.mjs (appels) et oauth.mjs (connexion) ; ici : le service, et le panneau d'administration (sans aucun appel réseau à l'ouverture).
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
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
const form = (action, label, title) => ({ type: "adminForm", action, submitLabel: label, ...(title ? { title } : {}), fields: [{ name: "go", kind: "hidden", value: "1" }] });
/** Le cœur ABANDONNE le message d'une action qui redirige : on ne redirige (pour redessiner l'écran) que si l'écran lui-même dit déjà la chose (code affiché, bandeau « dernière issue »). Un refus qui ne change rien reste sous le bouton. */
function connectResult(ctx, r, okKey) {
  if (r.ok) return { ok: ctx.t(okKey), redirect: "?" };
  return { error: ctx.t(`err_${r.error}`) };
}
const SHOWN_BY_SCREEN = new Set(["denied", "expired", "policy", "client", "google", "scope", "no_pending"]);   // l'écran garde la trace (bandeau) et le code en attente a disparu

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
  },

  async adminPanel(ctx) {
    const s = await status(ctx);
    const blocks = [];
    if (s.key === "missing") blocks.push({ type: "banner", tone: "warning", text: ctx.t("key_missing") });
    else if (s.key === "refused") blocks.push({ type: "banner", tone: "warning", text: ctx.t("key_refused") });
    else blocks.push({ type: "banner", tone: "success", text: ctx.t("key_ok") });
    blocks.push({ type: "markdown", text: ctx.t("key_help") });
    if (s.quota.exhausted) blocks.push({ type: "banner", tone: "warning", text: ctx.t("quota_exhausted", { when: resumeText(ctx, Date.parse(s.quota.until)) }) });
    blocks.push({ type: "markdown", text: ctx.t("quota_used", { used: s.quota.used.toLocaleString(ctx.locale), budget: s.quota.budget.toLocaleString(ctx.locale), when: resumeText(ctx, Date.parse(s.quota.resetAt)) }) });
    blocks.push({ type: "netHealth", items: [{ host: HOST, label: "YouTube", ...(s.lastGoodAt ? { lastGoodAt: s.lastGoodAt } : {}) }] });
    blocks.push(...(await accountBlocks(ctx)));
    return blocks;
  },
};

/** Le compte YouTube : mise en route en 4 étapes, puis le bouton qui convient à l'état (aucun appel réseau, jamais un jeton ni un secret). */
async function accountBlocks(ctx) {
  const c = await accountConnection(ctx);
  const wanted = ctx.setting("chatReply") === true;
  const out = [{ type: "heading", text: ctx.t("acc_title") }, { type: "markdown", text: ctx.t("acc_intro") }];
  if (c.state === "connected") {
    out.push({ type: "banner", tone: "success", text: ctx.t(c.write ? "acc_connected_write" : "acc_connected_read", { date: c.since ? new Date(c.since).toLocaleDateString(ctx.locale) : "" }) });
    if (wanted && !c.write) out.push({ type: "banner", tone: "warning", text: ctx.t("acc_need_write") }, form("accountConnect", ctx.t("btn_reconnect_write")));
    else if (!wanted && c.write) out.push({ type: "banner", tone: "info", text: ctx.t("acc_write_idle") });
    out.push(form("accountDisconnect", ctx.t("btn_disconnect")), { type: "markdown", text: ctx.t("acc_disconnect_help") });
    return out;
  }
  if (c.state === "pending" && c.pending) {
    out.push({ type: "banner", tone: "info", text: ctx.t(c.pending.wantWrite ? "acc_pending_write" : "acc_pending") }, { type: "html", html: await pendingHtml(ctx, c.pending) }, form("accountCheck", ctx.t("btn_check")), form("accountCancel", ctx.t("btn_cancel")));
    return out;
  }
  if (c.last) out.push({ type: "banner", tone: c.last.code === "write_missing" ? "info" : "warning", text: ctx.t(`last_${c.last.code}`) });
  if (c.state === "stale") out.push({ type: "banner", tone: "warning", text: ctx.t("acc_stale") });
  if (!c.configured) {
    if (c.idSet && !c.idOk) out.push({ type: "banner", tone: "warning", text: ctx.t("acc_bad_id") });
    if (c.secretSet && !c.secretOk) out.push({ type: "banner", tone: "warning", text: ctx.t("acc_bad_secret") });
    out.push({ type: "banner", tone: "info", text: ctx.t("acc_none") }, { type: "html", html: `<p style="margin:0 0 .25rem"><strong>${esc(ctx.t("acc_steps_title"))}</strong></p>${stepsHtml(ctx)}<p style="margin:.25rem 0 0;opacity:.85">${esc(ctx.t("acc_steps_note"))}</p>` });
    return out;
  }
  out.push({ type: "banner", tone: "info", text: ctx.t(wanted ? "acc_ready_write" : "acc_ready") }, form("accountConnect", ctx.t("btn_connect")));
  out.push({ type: "html", html: `<details><summary>${esc(ctx.t("acc_steps_again"))}</summary><div style="margin-top:.5rem">${stepsHtml(ctx)}<p style="margin:.25rem 0 0;opacity:.85">${esc(ctx.t("acc_steps_note"))}</p></div></details>` });
  return out;
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
