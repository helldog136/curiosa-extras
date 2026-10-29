// L'onglet « Récompenses » de la page du bot : les récompenses en points de chaîne créées par Curiosa, leur état, la création et la modification (de vraies opérations chez Twitch),
// l'état de la maison (Connecteur Home Assistant, facultatif) et le journal des 50 derniers échanges. Les mots sont ceux d'Emma : jamais « jeton », « webhook », « EventSub » ni « clé »
// (la clé technique d'une action n'est montrée qu'en mode avancé : réglage « Montrer les identifiants techniques des actions »).
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const es = await import(`./eventsub.mjs${v}`);
const st = await import(`./state.mjs${v}`);
const R = await import(`./rewards.mjs${v}`);
const J = await import(`./redeem.mjs${v}`);
const A = await import(`./actions.mjs${v}`);
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
    out[field] = t(`rw_e_${code}`, { max: code.startsWith("an_") ? A.MAX_LABEL : es.LIMITS.title, prompt: es.LIMITS.prompt, vars: codes.vars ?? "", limit: A.MAX_ACTIONS });
  }
  return out;
}

/* ───────────── Les blocs ───────────── */

const adv = (info) => info?.s?.showKeys === true;
/** Le nom d'une action pour la personne : jamais sa clé (sauf, entre parenthèses, en mode avancé). `snap` : le nom gardé dans le journal si l'action a disparu depuis. */
const actionName = (ctx, names, key, { snap, advanced = false } = {}) => {
  const t = ctx.t, name = names.get(key) ?? snap;
  return advanced ? `${name ?? t("rw_action_unknown")} (${key})` : (name ?? t("rw_action_unknown"));
};
/** Ce que la maison dit d'une action : 'unmapped' (pas encore de script relié), 'ok', ou null. */
const linkOf = (state, key) => (R.isHome(key) ? A.linkOf(state, key) : null);
const statusText = (t, r, unmapped) => {
  const s = R.statusOf(r);
  const base = s === "paused" ? (r.pause === "auto" ? t("rw_state_paused_auto") : t("rw_state_paused")) : s === "refused" ? t("rw_state_refused", { why: t(`rw_refused_${r.refused?.code === "duplicate" ? "duplicate" : "other"}`) }) : t(`rw_state_${s}`);
  return unmapped && s !== "gone" ? `${base} · ${t("rw_reason_unmapped")}` : base;
};

/** « Que se passe-t-il ? » pour une action déjà choisie : la valeur du choix (et la couleur, pour les lumières). */
export function whatOf(action) {
  if (action === A.BOT_ACTION) return { what: "chat" };
  if (action === A.VOICE_ACTION) return { what: "voice" };
  const m = /^lumieres:([a-z]+)$/.exec(String(action));
  if (m && A.COLORS.includes(m[1])) return { what: "lights", color: m[1] };
  return { what: `named:${action}` };
}
function whatOptions(ctx, namedList, homeInstalled, current) {
  const t = ctx.t, need = homeInstalled ? "" : ` (${t("rw_needs_home")})`;
  const out = [
    { value: "chat", label: t("rw_w_chat") },
    { value: "lights", label: `${t("rw_w_lights")}${need}` },
    { value: "voice", label: `${t("rw_w_voice")}${need}` },
    { value: "custom", label: `${t("rw_w_custom")}${need}` },
    ...namedList.map((a) => ({ value: `named:${a.key}`, label: `${t("rw_w_mine", { name: a.label })}${need}` })),
  ];
  if (current?.startsWith("named:") && !out.some((o) => o.value === current)) out.push({ value: current, label: t("rw_action_unknown") });   // une action qui n'est plus dans la liste : on la garde visible plutôt que d'en choisir une autre sans le dire
  return out;
}

function rewardForm(ctx, info, namedList, homeInstalled, doc) {
  const t = ctx.t, s = info.s;
  const v = doc ?? { title: "", cost: "", cooldown: 0, prompt: "", needsInput: false, action: homeInstalled ? A.lightKey("rouge") : A.BOT_ACTION, reply: "" };
  const w = whatOf(v.action);
  return {
    type: "adminForm", action: doc ? "rewardSave" : "rewardCreate", submitLabel: t(doc ? "rw_save_btn" : "rw_new_btn"), ...(doc ? { cancelHref: "?tab=rewards" } : {}),
    fields: [
      ...(doc ? [{ name: "id", kind: "hidden", value: doc.id }] : []),
      { name: "title", label: t("rw_f_title"), value: v.title, required: true, help: t("rw_f_title_help", { max: es.LIMITS.title }) },
      { name: "cost", label: t("rw_f_cost"), kind: "number", value: v.cost, required: true, help: t("rw_f_cost_help") },
      { name: "cooldownMin", label: t("rw_f_cooldown"), kind: "number", value: v.cooldown ? Math.round(v.cooldown / 6) / 10 : "", help: t("rw_f_cooldown_help") },
      { name: "prompt", label: t("rw_f_prompt"), value: v.prompt, help: t("rw_f_prompt_help", { max: es.LIMITS.prompt }) },
      { name: "needsInput", label: t("rw_f_input"), kind: "checkbox", value: v.needsInput ? "on" : "", help: t("rw_f_input_help") },
      { name: "what", label: t("rw_f_what"), kind: "select", value: w.what, options: whatOptions(ctx, namedList, homeInstalled, w.what), help: t("rw_f_what_help") },
      { name: "color", label: t("rw_f_color"), kind: "select", value: w.color ?? "rouge", options: A.COLORS.map((c) => ({ value: c, label: t(`rw_color_${c}`) })), help: t("rw_f_color_help") },
      { name: "reply", label: t("rw_f_reply"), kind: "textarea", value: v.reply ?? "", help: t("rw_f_reply_help") },
      { name: "actionName", label: t("rw_f_an"), value: "", help: t("rw_f_an_help", { max: A.MAX_LABEL }) },
      ...(s.showKeys ? [{ name: "actionKey", label: t("rw_f_key"), value: "", help: t("rw_f_key_help") }] : []),
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
  return [
    { type: "heading", text: t("rw_house_title") },
    { type: "banner", tone: s.paired && s.enabled !== false && s.live !== false ? "success" : "warning", text: line },
    ...(house.adminPath ? [{ type: "markdown", text: t("rw_house_link_help") }, { type: "links", items: [{ label: t("rw_house_link"), href: house.adminPath }] }] : []),
  ];
}

/** Les actions que Home Assistant a dit ne pas connaître, en une phrase avec leurs noms (5 au plus) : à relier dans Home Assistant. */
function unmappedBlocks(ctx, state, names, used) {
  const keys = A.unmappedKeys(state).filter((k) => R.isHome(k) && (used.has(k) || [...names.keys()].includes(k)));
  if (!keys.length) return [];
  const shown = keys.slice(0, 5).map((k) => names.get(k) ?? ctx.t("rw_action_unknown")), more = keys.length - shown.length;
  return [{ type: "banner", tone: "warning", text: ctx.t("rw_unmapped_banner", { list: `${shown.join(", ")}${more > 0 ? ` (+${more})` : ""}` }) }];
}

function journalBlocks(ctx, s, entries, names, advanced) {
  const t = ctx.t, time = (at) => new Date(at).toLocaleTimeString(ctx.locale, { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: s.timeZone });
  const out = [{ type: "heading", text: t("rw_log_title") }, { type: "markdown", text: t("rw_log_help", { n: J.KEEP_RESOLVED }) }];
  if (!entries.length) return [...out, { type: "markdown", text: t("rw_log_empty") }];
  const label = (e) => {
    const base = t(`rw_log_${e.status}`);
    return e.reason && !["ok"].includes(e.reason) ? `${base} : ${t(`rw_reason_${e.reason}`)}` : base;
  };
  out.push({ type: "table", columns: [t("rw_log_who"), t("rw_log_reward"), t("rw_log_result")], rows: entries.map((e) => [`${time(e.at)} · ${e.test ? `${t("rw_log_test_pill")} ` : ""}${e.user}`, `${cut(e.title, 40)} · ${actionName(ctx, names, e.action, { snap: e.an, advanced })}`, label(e)]) });
  if (can(ctx)) out.push({ type: "adminForm", action: "rewardLogClear", submitLabel: t("rw_log_clear"), fields: [] });
  return out;
}

/** Tous les blocs de l'onglet (déjà marqués pour l'onglet). `info` : le décor de admin.mjs ({ s, d }). */
export async function blocks(ctx, info, query = {}) {
  const t = ctx.t, s = info.s, state = await st.readState(ctx);
  const out = [{ type: "heading", text: t("rw_title") }];
  const namedList = await A.named(ctx, s).catch(() => []), names = A.names(t, namedList), advanced = adv(info);
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
    out.push(...journalBlocks(ctx, s, await J.journal(ctx), names, advanced));
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
  out.push(...unmappedBlocks(ctx, fresh, names, new Set(rows.map((r) => r.action))));

  out.push({ type: "heading", text: t("rw_list_title") });
  if (!rows.length) out.push({ type: "markdown", text: t("rw_list_empty") });
  else {
    // Deux colonnes et UN bouton seulement : sur un téléphone, rien ne déborde. La pause, la simulation et la suppression sont dans la page de modification.
    out.push({ type: "table", columns: [t("rw_col_reward"), t("rw_col_state")],
      rows: rows.map((r) => [`${r.title} · ${t("rw_points", { n: r.cost })} · ${actionName(ctx, names, r.action, { advanced })}`, statusText(t, r, linkOf(fresh, r.action) === "unmapped")]), rowIds: rows.map((r) => r.id),
      rowActions: can(ctx) ? [{ label: t("act_edit"), href: "?tab=rewards&rewardEdit={id}#edit" }] : [] });
  }
  if (can(ctx)) {
    const editing = typeof query.rewardEdit === "string" ? rows.find((r) => r.id === query.rewardEdit) : null;
    out.push({ type: "html", html: '<div id="edit" style="scroll-margin-top:5rem"></div>' });
    if (editing) {
      out.push({ type: "heading", text: t("rw_edit_title", { title: editing.title }) }, rewardForm(ctx, info, namedList, house.installed, editing));
      if (!editing.gone) out.push({ type: "adminForm", action: "rewardToggle", submitLabel: t(editing.pause ? "rw_resume_btn" : "rw_pause_btn"), fields: [{ name: "id", kind: "hidden", value: editing.id }] }, { type: "markdown", text: t("rw_pause_help") });
      out.push({ type: "adminForm", action: "rewardSimulate", submitLabel: t("rw_sim_row_btn"), title: t("rw_sim_title"), fields: [{ name: "id", kind: "hidden", value: editing.id }, ...(editing.needsInput ? [{ name: "text", label: t("rw_sim_f_text"), help: t("rw_sim_f_text_help") }] : [])] });
      out.push({ type: "table", columns: [t("rw_delete_title")], rows: [[editing.title]], rowIds: [editing.id], rowActions: [{ label: t("delete_btn"), action: "rewardRemove", confirm: t("rw_delete_confirm"), danger: true }] });
    }
    else if (rows.length < R.MAX_REWARDS) out.push({ type: "heading", text: t("rw_new_title") }, { type: "markdown", text: t("rw_new_help") }, rewardForm(ctx, info, namedList, house.installed, null));
    else out.push({ type: "markdown", text: t("rw_err_too_many", { max: R.MAX_REWARDS }) });
  }
  out.push(...actionsBlocks(ctx, info, namedList, rows, fresh, query, advanced));
  if (can(ctx) && rows.length) {
    const pre = typeof query.rewardTest === "string" ? rows.find((r) => r.id === query.rewardTest) : null;
    out.push({ type: "html", html: '<div id="test" style="scroll-margin-top:5rem"></div>' }, { type: "heading", text: t("rw_sim_title") }, { type: "markdown", text: t("rw_sim_help") });
    out.push({ type: "adminForm", action: "rewardSimulate", submitLabel: t("rw_sim_btn"), fields: [
      { name: "id", label: t("rw_sim_f_reward"), kind: "select", value: pre?.id ?? rows[0].id, options: rows.map((r) => ({ value: r.id, label: r.title })) },
      { name: "text", label: t("rw_sim_f_text"), help: t("rw_sim_f_text_help") },
    ] });
  }
  out.push(...journalBlocks(ctx, s, await J.journal(ctx), names, advanced));
  return tab(out);
}

/** « Tes actions » : les actions nommées, combien de récompenses les utilisent, ce que la maison en sait ; renommer (la clé ne bouge pas) ou retirer celles qui ne servent plus. */
function actionsBlocks(ctx, info, namedList, rows, state, query, advanced) {
  const t = ctx.t;
  if (!namedList.length) return [];
  const used = (key) => rows.filter((r) => r.action === key);
  const house = (key) => { const l = A.linkOf(state, key); return t(l === "ok" ? "rw_link_ok" : l === "unmapped" ? "rw_link_unmapped" : "rw_link_none"); };
  const out = [{ type: "html", html: '<div id="action" style="scroll-margin-top:5rem"></div>' }, { type: "heading", text: t("rw_acts_title") }, { type: "markdown", text: t("rw_acts_help") }];
  out.push({ type: "table", columns: [t("rw_acts_col_name"), t("rw_acts_col_used"), t("rw_acts_col_house")],
    rows: namedList.map((a) => [advanced ? `${a.label} (${a.key})` : a.label, used(a.key).length ? cut(used(a.key).map((r) => r.title).join(", "), 60) : t("rw_acts_unused"), house(a.key)]), rowIds: namedList.map((a) => a.key),
    rowActions: can(ctx) ? [{ label: t("act_rename"), href: "?tab=rewards&actionEdit={id}#action" }, { label: t("act_remove"), action: "actionRemove", confirm: t("rw_acts_remove_confirm"), danger: true }] : [] });
  const cur = can(ctx) && typeof query.actionEdit === "string" ? namedList.find((a) => a.key === query.actionEdit) : null;
  if (cur) out.push({ type: "heading", text: t("rw_acts_edit_title", { name: cur.label }) }, { type: "adminForm", action: "actionSave", submitLabel: t("rw_save_btn"), cancelHref: "?tab=rewards", fields: [
    { name: "ref", kind: "hidden", value: cur.key },
    { name: "name", label: t("rw_f_an"), value: cur.label, required: true, help: t("rw_acts_name_help") },
    ...(info.s.showKeys ? [{ name: "actionKey", label: t("rw_f_key"), value: cur.key, help: t("rw_acts_key_help") }] : []),
  ] });
  return out;
}

/** La maison : installée ? et son état (service facultatif). */
export async function houseInfo(ctx) {
  const installed = await J.bridgeInstalled(ctx);
  if (!installed) return { installed: false };
  const r = await J.bridge(ctx, "status", {});
  return { installed: true, status: r.ok && r.value && typeof r.value === "object" ? r.value : null, adminPath: await J.adminPathOf(ctx, "home-assistant") };
}

/* ───────────── Les actions ───────────── */

const form = (x) => ({ title: x.title, cost: x.cost, cooldownMin: x.cooldownMin, prompt: x.prompt, reply: x.reply, needsInput: x.needsInput === "on" });
const NAME_ERRORS = { empty: "an_empty", long: "an_long", too_many: "an_too_many" };
/**
 * Lit le formulaire : « Que se passe-t-il ? » (+ couleur, ou nom de l'action) devient la clé de l'action. Une action « Autre chose chez moi » dont le nom existe déjà reprend la même action ;
 * sinon une nouvelle est PRÉVUE (écrite seulement quand la récompense est créée chez Twitch). Sans le champ « Que se passe-t-il ? » (assistant, ancienne façon), `action` est la clé elle-même.
 * Rend { fail: { errors } } ou { value, plan }.
 */
async function validate(ctx, s, x, exceptId) {
  const rewards = await R.list(ctx), others = rewards.filter((r) => r.id !== exceptId), namedList = await A.named(ctx, s);
  const raw = form(x), errors = {};
  let plan = null;
  const what = String(x.what ?? "").trim();
  if (!what) raw.action = String(x.action ?? "").trim();
  else if (what === "chat") raw.action = A.BOT_ACTION;
  else if (what === "voice") raw.action = A.VOICE_ACTION;
  else if (what === "lights") { const c = String(x.color ?? "").trim(); if (A.COLORS.includes(c)) raw.action = A.lightKey(c); else errors.color = "color"; }
  else if (what === "custom") {
    const p = await A.plan(ctx, s, x.actionName, { wantedKey: s.showKeys ? x.actionKey : "", rewardKeys: rewards.map((r) => r.action) });
    if (!p.ok) errors[p.code === "key" || p.code === "key_taken" ? "actionKey" : "actionName"] = NAME_ERRORS[p.code] ?? p.code;
    else { plan = p; raw.action = p.action.key; }
  } else if (what.startsWith("named:")) raw.action = what.slice("named:".length);
  else errors.what = "what";
  const c = R.check(raw, { s, others, prefix: s.prefix, named: [...namedList.map((a) => a.key), ...(plan ? [plan.action.key] : [])] });
  if (!c.ok) {
    const { action, ...rest } = c.errors;
    Object.assign(errors, rest);
    if (action && !errors.what && !errors.color && !errors.actionName && !errors.actionKey) errors[what ? "what" : "action"] = what ? "what" : "action";
  }
  if (Object.keys(errors).length) return { fail: { errors: fieldErrors(ctx, { ...errors, ...(c.ok ? {} : { vars: c.errors.vars }) }) } };
  if (R.isHome(c.value.action) && !(await J.bridgeInstalled(ctx))) return { fail: { errors: { [what ? "what" : "action"]: ctx.t("rw_err_action_home") } } };
  return { value: c.value, plan };
}
/** Le message de réussite d'une création : si l'action est nouvelle et vient de la maison, on dit tout de suite quoi faire ensuite (la relier dans Home Assistant). */
const createdText = (ctx, value, plan) => (plan?.isNew && R.isHome(value.action) ? ctx.t("rw_created_link", { title: value.title, action: plan.action.label }) : ctx.t("rw_created", { title: value.title }));
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
    await A.commit(ctx, c.plan);
    const r = await R.create(ctx, s, c.value);
    if (!r.ok) { await A.discard(ctx, c.plan).catch(() => {}); return failure(ctx, r); }
    await ensureRedeemListening(ctx, s, { settle: false }).catch(() => {});
    return { ok: createdText(ctx, c.value, c.plan) };
  }),
  rewardSave: run(async (ctx, x) => {
    const s = settingsOf(ctx), c = await validate(ctx, s, x, x.id);
    if (c.fail) return c.fail;
    await A.commit(ctx, c.plan);
    const r = await R.update(ctx, s, x.id, c.value);
    if (!r.ok) { await A.discard(ctx, c.plan).catch(() => {}); return failure(ctx, r); }
    return { ok: c.plan?.isNew && R.isHome(c.value.action) ? createdText(ctx, c.value, c.plan) : ctx.t("rw_saved"), redirect: "?tab=rewards" };
  }),
  actionSave: run(async (ctx, x) => {
    const s = settingsOf(ctx), rewards = await R.list(ctx), key = String(x.ref ?? "");
    const r = await A.rename(ctx, s, key, x.name, { newKey: s.showKeys ? x.actionKey : "", rewardKeys: rewards.map((w) => w.action) });
    if (!r.ok) {
      if (r.code === "unknown") return { error: ctx.t("err_unknown") };
      const field = r.code === "key" || r.code === "key_taken" ? "actionKey" : "name";
      return { errors: { [field]: ctx.t(`rw_e_${NAME_ERRORS[r.code] ?? (r.code === "dup" ? "an_dup" : r.code)}`, { max: A.MAX_LABEL, limit: A.MAX_ACTIONS }) } };
    }
    if (r.to !== r.from) await R.retarget(ctx, r.from, r.to);   // la clé n'a changé que par la volonté de la personne (mode avancé) : les récompenses la suivent
    return { ok: ctx.t("rw_action_saved", { name: r.label }), redirect: "?tab=rewards" };
  }),
  actionRemove: run(async (ctx, x) => {
    const s = settingsOf(ctx), key = String(x.id ?? "");
    const r = await A.remove(ctx, s, key, (await R.list(ctx)).map((w) => w.action));
    if (r.ok) return { ok: ctx.t("rw_action_removed"), redirect: "?tab=rewards" };
    return { error: ctx.t(r.code === "used" ? "rw_action_used" : r.code === "legacy" ? "rw_action_legacy" : "err_unknown") };
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
