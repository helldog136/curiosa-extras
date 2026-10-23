// L'onglet « Récompenses » de la page du bot : les récompenses en points de chaîne créées par Curiosa, leur état, la création et la modification (de vraies opérations chez Twitch),
// l'état de la maison (module Home Assistant, facultatif) et le journal des 50 derniers échanges. Les mots sont ceux d'Emma : jamais « jeton », « webhook » ou « EventSub ».
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const es = await import(`./eventsub.mjs${v}`);
const st = await import(`./state.mjs${v}`);
const R = await import(`./rewards.mjs${v}`);
const J = await import(`./redeem.mjs${v}`);
const { settingsOf } = await import(`./settings.mjs${v}`);
const { accounts, declareScopes, ensureRedeemListening, isPublicSite } = await import(`./listen.mjs${v}`);

const SERVICE = "twitch.api";
const esc = (x) => String(x).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const cut = (x, n) => { const s = String(x ?? ""); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
/** Tous les blocs de cet écran vont dans l'onglet « Récompenses » (cœur 0.2.5). */
const tab = (blocks) => blocks.map((b) => ({ ...b, tab: "rewards" }));
const can = (ctx) => typeof ctx.can === "function" && ctx.can("rewards.manage") === true;

/** Une erreur de création / modification en phrases : { errors: { champ: texte } } ou { error: texte }. */
export function failure(ctx, r) {
  const t = ctx.t;
  switch (r.code) {
    case "na": return { error: t("rw_err_na") };
    case "duplicate": return { errors: { title: t("rw_err_dup") } };
    case "too_many": case "limit": return { error: t("rw_err_too_many", { max: R.MAX_REWARDS }) };
    case "rate": return { error: t("rw_err_rate") };
    case "gone": return { error: t("rw_err_gone") };
    case "unknown": return { error: t("err_unknown") };
    case "refused": return { error: t("rw_err_refused", { detail: cut(r.detail ?? "", 120) }) };
    case "denied": case "need_scope": case "need_connect": case "need_reconnect": return { error: t("rw_err_denied") };
    case "no_channel": case "creds_missing": return { error: t("rw_err_setup") };
    default: return { error: t("rw_err_twitch") };
  }
}

/** Les codes de `R.check` en phrases sous le champ, avec un exemple. */
export function fieldErrors(ctx, codes) {
  const t = ctx.t, out = {};
  for (const [field, code] of Object.entries(codes)) {
    if (field === "vars") continue;
    out[field] = t(`rw_e_${code}`, { max: es.LIMITS.title, prompt: es.LIMITS.prompt, vars: codes.vars ?? "" });
  }
  return out;
}

/* ───────────── Les blocs ───────────── */

const actionLabel = (t, key) => (R.KNOWN.some((k) => k.key === key) ? t(R.labelKey(key)) : key);
function actionOptions(ctx, s, homeInstalled) {
  const t = ctx.t;
  return R.allowedKeys(s).map((key) => ({ value: key, label: `${actionLabel(t, key)}${R.isHome(key) && !homeInstalled ? ` (${t("rw_needs_home")})` : ""}` }));
}
const statusText = (t, r) => {
  const s = R.statusOf(r);
  if (s === "paused") return r.pause === "auto" ? t("rw_state_paused_auto") : t("rw_state_paused");
  if (s === "refused") return t("rw_state_refused", { why: t(`rw_refused_${r.refused?.code === "duplicate" ? "duplicate" : "other"}`) });
  return t(`rw_state_${s}`);
};

function rewardForm(ctx, s, homeInstalled, doc) {
  const t = ctx.t;
  const v = doc ?? { title: "", cost: "", cooldown: 0, prompt: "", needsInput: false, action: "lumieres:rouge", reply: "" };
  return {
    type: "adminForm", action: doc ? "rewardSave" : "rewardCreate", submitLabel: t(doc ? "rw_save_btn" : "rw_new_btn"), ...(doc ? { cancelHref: "?tab=rewards" } : {}),
    fields: [
      ...(doc ? [{ name: "id", kind: "hidden", value: doc.id }] : []),
      { name: "title", label: t("rw_f_title"), value: v.title, required: true, help: t("rw_f_title_help", { max: es.LIMITS.title }) },
      { name: "cost", label: t("rw_f_cost"), kind: "number", value: v.cost, required: true, help: t("rw_f_cost_help") },
      { name: "cooldownMin", label: t("rw_f_cooldown"), kind: "number", value: v.cooldown ? Math.round(v.cooldown / 6) / 10 : "", help: t("rw_f_cooldown_help") },
      { name: "prompt", label: t("rw_f_prompt"), value: v.prompt, help: t("rw_f_prompt_help", { max: es.LIMITS.prompt }) },
      { name: "needsInput", label: t("rw_f_input"), kind: "checkbox", value: v.needsInput ? "on" : "", help: t("rw_f_input_help") },
      { name: "action", label: t("rw_f_action"), kind: "select", value: v.action, options: actionOptions(ctx, s, homeInstalled), help: t("rw_f_action_help", { example: "lumieres:rouge" }) },
      { name: "reply", label: t("rw_f_reply"), kind: "textarea", value: v.reply ?? "", help: t("rw_f_reply_help") },
    ],
  };
}

async function connectButton(ctx, channel) {
  const r = (await ctx.api.services.callAll(SERVICE, "connectLink", { channel, slot: "main" })).find((x) => x.ok && x.value?.ok);
  const url = r?.value?.url;
  return url ? [{ type: "html", html: `<p><a data-twitch-connect href="${esc(url)}" style="display:inline-block;padding:.65rem 1.25rem;border-radius:.75rem;background:var(--v-accent);color:var(--v-accent-fg);font-weight:600;text-decoration:none">${esc(ctx.t("rw_connect_btn"))}</a></p>` }] : [];
}

function houseBlocks(ctx, house) {
  const t = ctx.t;
  if (!house.installed) return [{ type: "heading", text: t("rw_house_title") }, { type: "markdown", text: t("rw_house_absent") }, { type: "suggestInstall", service: J.SERVICE, reason: t("rw_suggest_reason") }];
  const s = house.status ?? {};
  const line = !s.paired ? t("rw_house_unpaired") : s.enabled === false ? t("rw_house_off") : s.live === false ? t("rw_house_notlive") : t("rw_house_ok");
  return [{ type: "heading", text: t("rw_house_title") }, { type: "banner", tone: s.paired && s.enabled !== false && s.live !== false ? "success" : "warning", text: line }];
}

function journalBlocks(ctx, s, entries) {
  const t = ctx.t, time = (at) => new Date(at).toLocaleTimeString(ctx.locale, { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: s.timeZone });
  const out = [{ type: "heading", text: t("rw_log_title") }, { type: "markdown", text: t("rw_log_help", { n: J.KEEP_RESOLVED }) }];
  if (!entries.length) return [...out, { type: "markdown", text: t("rw_log_empty") }];
  const label = (e) => {
    const base = t(`rw_log_${e.status}`);
    return e.reason && !["ok"].includes(e.reason) ? `${base} : ${t(`rw_reason_${e.reason}`)}` : base;
  };
  out.push({ type: "table", columns: [t("rw_log_who"), t("rw_log_reward"), t("rw_log_result")], rows: entries.map((e) => [`${time(e.at)} · ${e.test ? `${t("rw_log_test_pill")} ` : ""}${e.user}`, cut(e.title, 40), label(e)]) });
  if (can(ctx)) out.push({ type: "adminForm", action: "rewardLogClear", submitLabel: t("rw_log_clear"), fields: [] });
  return out;
}

/** Tous les blocs de l'onglet (déjà marqués pour l'onglet). `info` : le décor de admin.mjs ({ s, d }). */
export async function blocks(ctx, info, query = {}) {
  const t = ctx.t, s = info.s, state = await st.readState(ctx);
  const out = [{ type: "heading", text: t("rw_title") }];
  if (state.rewardsOn !== true) {
    out.push({ type: "markdown", text: t("rw_intro") });
    if (can(ctx)) out.push({ type: "adminForm", action: "rewardsEnable", submitLabel: t("rw_enable_btn"), fields: [] });
    return tab(out);
  }
  const acc = await R.access(ctx, s);
  if (!acc.ok) {
    out.push({ type: "banner", tone: "warning", text: t(`rw_access_${acc.code}`) });
    if (["need_connect", "need_reconnect", "need_scope"].includes(acc.code)) {
      out.push({ type: "markdown", text: t("rw_connect_steps" ) });
      if (info.d.channel) out.push(...(await connectButton(ctx, info.d.channel)));
    } else if (acc.code === "creds_missing" && acc.adminPath) out.push({ type: "markdown", text: t("creds_steps", { href: acc.adminPath }) });
    out.push(...houseBlocks(ctx, await houseInfo(ctx)));
    out.push(...journalBlocks(ctx, s, await J.journal(ctx)));
    return tab(out);
  }
  // À l'ouverture : le retard éventuel est rattrapé (résultats de la maison, échanges trop longs), l'écoute des échanges vérifiée, la liste remise d'accord avec Twitch.
  await J.reconcile(ctx, { force: true }).catch(() => {});
  const sub = state.redeemSub ?? {};
  if (!sub.at || (sub.code !== "listening" && Date.now() - sub.at > 5000))   // tout est prêt mais l'écoute n'est pas (ou plus) vérifiée : une demande à Twitch, au plus toutes les 5 s
    await ensureRedeemListening(ctx, s, { settle: true }).catch(() => {});
  await R.sync(ctx, s).catch(() => {});
  const fresh = await st.readState(ctx);
  const rows = await R.list(ctx);
  const house = await houseInfo(ctx);

  if (fresh.rewardsNA) out.push({ type: "banner", tone: "warning", text: t("rw_na") });
  const rs = fresh.redeemSub?.code;
  if (!fresh.rewardsNA && rs && !["listening", "pending", "off"].includes(rs)) out.push({ type: "banner", tone: "warning", text: t(`rw_listen_${rs}`) });
  else if (rs === "pending") out.push({ type: "markdown", text: t("rw_listen_pending") });
  if (!isPublicSite(ctx.api.siteUrl) && rs === "site_private") out.push({ type: "markdown", text: t("rw_listen_site_private") });
  const bad = s.extraActions.filter((k) => !R.ACTION_RE.test(k));
  if (bad.length) out.push({ type: "banner", tone: "warning", text: t("rw_extra_bad", { list: bad.map((x) => cut(x, 30)).join(", ") }) });
  out.push(...houseBlocks(ctx, house));

  out.push({ type: "heading", text: t("rw_list_title") });
  if (!rows.length) out.push({ type: "markdown", text: t("rw_list_empty") });
  else {
    out.push({ type: "table", columns: [t("rw_col_reward"), t("rw_col_action"), t("rw_col_state")],
      rows: rows.map((r) => [`${r.title} · ${t("rw_points", { n: r.cost })}`, actionLabel(t, r.action), statusText(t, r)]), rowIds: rows.map((r) => r.id),
      rowActions: can(ctx) ? [{ label: t("act_edit"), href: "?tab=rewards&rewardEdit={id}#edit" }, { label: t("rw_sim_row"), href: "?tab=rewards&rewardTest={id}#test" }, { label: t("rw_toggle"), action: "rewardToggle" }, { label: t("delete_btn"), action: "rewardRemove", confirm: t("rw_delete_confirm"), danger: true }] : [] });
  }
  if (can(ctx)) {
    const editing = typeof query.rewardEdit === "string" ? rows.find((r) => r.id === query.rewardEdit) : null;
    out.push({ type: "html", html: '<div id="edit" style="scroll-margin-top:5rem"></div>' });
    if (editing) out.push({ type: "heading", text: t("rw_edit_title", { title: editing.title }) }, rewardForm(ctx, s, house.installed, editing));
    else if (rows.length < R.MAX_REWARDS) out.push({ type: "heading", text: t("rw_new_title") }, { type: "markdown", text: t("rw_new_help") }, rewardForm(ctx, s, house.installed, null));
    else out.push({ type: "markdown", text: t("rw_err_too_many", { max: R.MAX_REWARDS }) });
  }
  if (can(ctx) && rows.length) {
    const pre = typeof query.rewardTest === "string" ? rows.find((r) => r.id === query.rewardTest) : null;
    out.push({ type: "html", html: '<div id="test" style="scroll-margin-top:5rem"></div>' }, { type: "heading", text: t("rw_sim_title") }, { type: "markdown", text: t("rw_sim_help") });
    out.push({ type: "adminForm", action: "rewardSimulate", submitLabel: t("rw_sim_btn"), fields: [
      { name: "id", label: t("rw_sim_f_reward"), kind: "select", value: pre?.id ?? rows[0].id, options: rows.map((r) => ({ value: r.id, label: r.title })) },
      { name: "text", label: t("rw_sim_f_text"), help: t("rw_sim_f_text_help") },
    ] });
  }
  out.push(...journalBlocks(ctx, s, await J.journal(ctx)));
  return tab(out);
}

/** La maison : installée ? et son état (service facultatif). */
export async function houseInfo(ctx) {
  const installed = await J.bridgeInstalled(ctx);
  if (!installed) return { installed: false };
  const r = await J.bridge(ctx, "status", {});
  return { installed: true, status: r.ok && r.value && typeof r.value === "object" ? r.value : null };
}

/* ───────────── Les actions ───────────── */

const form = (x) => ({ title: x.title, cost: x.cost, cooldownMin: x.cooldownMin, prompt: x.prompt, action: x.action, reply: x.reply, needsInput: x.needsInput === "on" });
async function validate(ctx, s, x, exceptId) {
  const others = (await R.list(ctx)).filter((r) => r.id !== exceptId);
  const c = R.check(form(x), { s, others, prefix: s.prefix });
  if (!c.ok) return { fail: { errors: fieldErrors(ctx, c.errors) } };
  if (R.isHome(c.value.action) && !(await J.bridgeInstalled(ctx))) return { fail: { errors: { action: ctx.t("rw_err_action_home") } } };
  return { value: c.value };
}
/** Le résultat d'une simulation en mots simples. */
export function simResult(ctx, r) {
  const t = ctx.t;
  if (!r.ok) {
    if (r.code === "refused") return { error: r.reason === "off" ? t("rw_sim_off") : t("rw_sim_refused", { why: t(`rw_reason_${r.reason}`) }) };
    if (r.code === "no_text") return { errors: { text: t("rw_sim_no_text") } };
    if (r.code === "not_installed") return { error: t("rw_err_action_home") };
    if (r.code === "too_fast") return { error: t("rw_sim_too_fast") };
    if (r.code === "too_many") return { error: t("rw_sim_too_many") };
    return { error: t("err_unknown") };
  }
  if (r.mode === "preview") return { ok: t("rw_sim_preview", { text: r.text }) };
  if (r.mode === "pending") return { ok: t("rw_sim_pending") };
  return r.status === "done" ? { ok: t("rw_sim_done") } : { error: t("rw_sim_failed", { why: t(`rw_reason_${r.reason}`) }) };
}
const run = (fn) => ({ right: "rewards.manage", run: fn });

export const actions = {
  rewardsEnable: run(async (ctx) => {
    const s = settingsOf(ctx);
    await st.updateState(ctx, (d) => { d.rewardsOn = true; });
    const info = await accounts(ctx, s);
    if (info.main?.channel) await declareScopes(ctx, s, info.main.channel).catch(() => {});
    await ensureRedeemListening(ctx, s, { settle: false }).catch(() => {});
    return { ok: ctx.t("rw_enabled") };
  }),
  rewardCreate: run(async (ctx, x) => {
    const s = settingsOf(ctx), c = await validate(ctx, s, x, null);
    if (c.fail) return c.fail;
    const r = await R.create(ctx, s, c.value);
    if (!r.ok) return failure(ctx, r);
    await ensureRedeemListening(ctx, s, { settle: false }).catch(() => {});
    return { ok: ctx.t("rw_created", { title: c.value.title }) };
  }),
  rewardSave: run(async (ctx, x) => {
    const s = settingsOf(ctx), c = await validate(ctx, s, x, x.id);
    if (c.fail) return c.fail;
    const r = await R.update(ctx, s, x.id, c.value);
    return r.ok ? { ok: ctx.t("rw_saved"), redirect: "?tab=rewards" } : failure(ctx, r);
  }),
  rewardToggle: run(async (ctx, x) => {
    const s = settingsOf(ctx), doc = (await R.list(ctx)).find((r) => r.id === x.id);
    if (!doc) return { error: ctx.t("err_unknown") };
    const r = await R.setPaused(ctx, s, x.id, !doc.pause);
    return r.ok ? { ok: ctx.t(doc.pause ? "rw_resumed" : "rw_paused", { title: doc.title }) } : failure(ctx, r);
  }),
  rewardRemove: run(async (ctx, x) => {
    const r = await R.remove(ctx, settingsOf(ctx), x.id);
    return r.ok ? { ok: ctx.t("rw_deleted"), redirect: "?tab=rewards" } : failure(ctx, r);
  }),
  rewardSimulate: run(async (ctx, x) => {
    const s = settingsOf(ctx), r = await J.simulate(ctx, s, x.id, { text: x.text ?? "" });
    return simResult(ctx, r);
  }),
  rewardLogClear: run(async (ctx) => { await J.clearJournal(ctx); return { ok: ctx.t("log_cleared") }; }),
};
