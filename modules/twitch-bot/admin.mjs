// La page d'administration du bot : arrêt d'urgence, « le bot écoute ? », résumé de toutes les commandes, édition, partenaires, réseaux, journal.
// Pensée pour une personne qui n'est pas technicienne : des phrases, pas de jargon, et chaque problème dit quoi faire.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { ROLES, catalog, loadConfig, proposeNetwork, saveCommand, saveSourced, removeCustom } = await import(`./commands.mjs${v}`);
const { settingsOf } = await import(`./settings.mjs${v}`);
const src = await import(`./sources.mjs${v}`);
const st = await import(`./state.mjs${v}`);
const { diagnose, ensureListening, ensureRedeemListening } = await import(`./listen.mjs${v}`);
const { allowedFor } = await import(`./variables.mjs${v}`);
const { preview } = await import(`./engine.mjs${v}`);
const RA = await import(`./rewardsAdmin.mjs${v}`);

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const cut = (v, n) => { const s = String(v ?? ""); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const SERVICE = "twitch.api";

/** La section que ce module ajoute à la fiche d'un partenaire (déclarée dans `entryPanels` de module.json) : son identifiant et son adresse dans la fiche. */
export const PANEL_ID = "chat-command";
const panelAnchor = (ctx) => `panel-${ctx.instance.key}-${PANEL_ID}`.replace(/[^a-zA-Z0-9_-]/g, "-");
/** Le lien « Modifier » d'un partenaire : sa fiche, ouverte sur la section de la commande (la fiche ajoute elle-même l'étiquette du contenu dans l'adresse). */
const partnerHref = (ctx) => `/admin/entries/{id}#${panelAnchor(ctx)}`;
/** Pour que « Modifier » d'une ligne amène sur le formulaire (en dessous des états) et non en haut de la page. */
const EDIT_ANCHOR = { type: "html", html: '<div id="edit" style="scroll-margin-top:5rem"></div>' };

/** Le bouton « Autoriser chez Twitch » : un lien (adresse construite par Chaîne Twitch) habillé aux couleurs de l'administration. */
const button = (label, href) => ({ type: "html", html: `<p><a data-twitch-connect href="${esc(href)}" style="display:inline-block;padding:.65rem 1.25rem;border-radius:.75rem;background:var(--v-accent);color:var(--v-accent-fg);font-weight:600;text-decoration:none">${esc(label)}</a></p>` });

/* ───────────── Messages d'erreur d'enregistrement ───────────── */

/** Une erreur de `saveCommand` en phrase, avec quoi faire. */
export function saveError(ctx, r) {
  const t = ctx.t;
  switch (r.code) {
    case "name": return t("err_name", { value: r.value ?? "" });
    case "alias": return t("err_alias", { value: r.value ?? "" });
    case "aliases_many": return t("err_aliases_many");
    case "collision": return t("err_collision", { word: r.word, with: r.with });
    case "text_unknown": return t("err_text_unknown", { vars: (r.vars ?? []).map((v) => `{${v}}`).join(", "), allowed: (r.allowed ?? []).map((v) => `{${v}}`).join(" ") });
    case "text_empty": return t("err_text_empty");
    case "text_long": return t("err_text_long");
    case "text_start": return t("err_text_start");
    case "delay": return t("err_delay");
    case "role": return t("err_role");
    case "too_many": return t("err_too_many");
    case "source_missing": return t("err_source_missing");
    default: return t("err_unknown");
  }
}

/* ───────────── Le décor commun ───────────── */

/** Tout ce que la page et les actions ont besoin de savoir, lu une fois. */
export async function context(ctx, { declare = true } = {}) {
  const s = settingsOf(ctx);
  const d = await diagnose(ctx, s, { declare });
  const sources = await src.gather(ctx, d.channel ?? null);
  const cfg = (await loadConfig(ctx)).data;
  const list = catalog(cfg, sources, ctx.t);
  return { s, d, sources, cfg, list, env: { src: sources, t: ctx.t, prefix: s.prefix } };
}

/* ───────────── Arrêt d'urgence ───────────── */

function emergency(ctx, muted, since, timeZone) {
  const t = ctx.t;
  if (muted) {
    const when = since ? ` ${t("mute_since", { date: new Date(since).toLocaleString(ctx.locale, { dateStyle: "short", timeStyle: "short", timeZone }) })}` : "";
    return [
      { type: "banner", tone: "warning", text: t("mute_on", { when }) },
      { type: "adminForm", action: "unmute", submitLabel: t("mute_off_btn"), fields: [] },
    ];
  }
  return [
    { type: "adminForm", action: "mute", title: t("mute_title"), submitLabel: t("mute_btn"), fields: [] },
    { type: "markdown", text: t("mute_help") },
  ];
}

/* ───────────── « Le bot écoute ? » ───────────── */

async function connectBlocks(ctx, d, slot) {
  if (!d.channel) return [];
  const r = (await ctx.api.services.callAll(SERVICE, "connectLink", { channel: d.channel, slot })).find((x) => x.ok && x.value?.ok);
  const url = r?.value?.url;
  return url ? [button(ctx.t(slot === "bot" ? "connect_bot_btn" : "connect_btn"), url)] : [];
}

const PROBLEM_TONE = "warning";
async function listenBlocks(ctx, ctxInfo, state) {
  const t = ctx.t, { s, d } = ctxInfo;
  const sub = state.sub ?? {};
  const code = d.code !== "ready" ? d.code : sub.code ?? "unknown";
  const out = [];
  const res = d.main?.result;
  const botRes = d.bot?.result;
  if (res && res.code) out.push({ type: "banner", tone: "warning", text: t(`res_${res.code}`, { login: res.login ?? "" }) });
  if (botRes && botRes.code && s.replyAs === "bot") out.push({ type: "banner", tone: "warning", text: t(`res_${botRes.code}`, { login: botRes.login ?? "" }) });
  if (code === "listening") {
    const last = state.lastMessageAt ? new Date(state.lastMessageAt).toLocaleString(ctx.locale, { dateStyle: "short", timeStyle: "short", timeZone: s.timeZone }) : null;
    out.push({ type: "banner", tone: "success", text: t("listen_yes") });
    out.push({ type: "markdown", text: [last ? t("listen_last", { when: last }) : t("listen_nomsg"), s.onlyWhenLive ? t("listen_live_only") : t("listen_always")].join(" ") });
    return out;
  }
  const failure = sub.failure ? ` ${t(`listen_failure_${sub.failure}`)}` : "";
  out.push({ type: "banner", tone: PROBLEM_TONE, text: `${t("listen_no")} ${t(`listen_${code}`, { detail: sub.detail ?? "" })}${failure}` });
  if (["need_connect", "need_reconnect", "need_more"].includes(code)) out.push({ type: "markdown", text: t("connect_steps") }, ...(await connectBlocks(ctx, d, "main")));
  else if (["bot_need_connect", "bot_reconnect", "bot_more"].includes(code)) out.push({ type: "markdown", text: t("connect_bot_steps") }, ...(await connectBlocks(ctx, d, "bot")));
  else if (code === "creds_missing" && d.main?.adminPath) out.push({ type: "markdown", text: t("creds_steps", { href: d.main.adminPath }) });
  else if (code === "no_channel") out.push({ type: "markdown", text: t("no_channel_steps") });
  return out;
}

function listenActions(ctx, code) {
  const t = ctx.t;
  const out = [{ type: "adminForm", action: "check", submitLabel: t("check_btn"), fields: [] }];
  if (["revoked", "refused", "pending", "twitch_down", "twitch_busy"].includes(code)) out.push({ type: "adminForm", action: "relisten", submitLabel: t("relisten_btn"), fields: [] });
  return out;
}

/* ───────────── Résumé des commandes ───────────── */

const kindLabel = (t, c) => (c.kind === "network" ? `${t("kind_network")} (${c.label})` : t(`kind_${c.kind}`));
const roleLabel = (t, r) => t(`role_${r}`);
export function stateLabel(t, c) {
  if (c.state === "on") return t("state_on");
  if (c.state === "off") return t("state_off");
  return t(`why_${c.why}`);
}
export const words = (prefix, c) => [c.name, ...c.aliases].map((w) => `${prefix}${w}`).join("  ");

function summary(ctx, info) {
  const t = ctx.t, { s, list } = info;
  // Les commandes des partenaires ont leur propre rubrique plus bas (leur réglage est dans la fiche du partenaire, pas ici).
  const rows = list.filter((c) => c.kind !== "partner");
  return [
    { type: "heading", text: t("summary_title") },
    { type: "markdown", text: t("summary_help", { prefix: s.prefix }) },
    // Trois colonnes seulement : sur un téléphone, un tableau plus large cache l'état et les boutons. Le type et « qui peut l'utiliser » (quand ce n'est pas tout le monde) suivent le nom.
    { type: "table", columns: [t("col_command"), t("col_answer"), t("col_state")],
      rows: rows.map((c) => [`${words(s.prefix, c)} · ${kindLabel(t, c)}${c.role === "everyone" ? "" : ` · ${roleLabel(t, c.role)}`}`, cut(c.text, 90), stateLabel(t, c)]),
      rowIds: rows.map((c) => c.key),
      rowActions: [{ label: t("act_edit"), href: "?edit={id}#edit" }, { label: t("act_toggle"), action: "toggle" }] },
  ];
}

/* ───────────── Partenaires et réseaux ───────────── */

function partnersSection(ctx, info) {
  const t = ctx.t, { sources, list, s } = info;
  const out = [{ type: "heading", text: t("partners_title") }];
  if (!sources.partners.installed) return [...out, { type: "markdown", text: t("partners_absent") }];
  const paused = list.filter((c) => c.kind === "partner" && c.missing);
  if (!sources.partners.items.length && !paused.length) return [...out, { type: "markdown", text: t("partners_none") }];
  out.push({ type: "markdown", text: t("partners_help") });
  const rows = sources.partners.items;
  // « Modifier » mène à la fiche du partenaire, sur la section de sa commande : c'est là que se règle la commande (une seule place, pas de doublon).
  if (rows.length) out.push({ type: "table", columns: [t("col_partner"), t("col_state")],   // deux colonnes : le bouton « Modifier » reste visible sur un téléphone
    rows: rows.map((p) => { const c = list.find((x) => x.key === `partner:${p.id}`); return [p.title, c ? `${words(s.prefix, c)} · ${stateLabel(t, c)}` : t("state_not_set")]; }),
    rowIds: rows.map((p) => p.id), rowActions: [{ label: t("act_edit"), href: partnerHref(ctx) }] });
  // Une commande dont la fiche n'est plus publiée (ou a disparu) : en pause, puis retirée toute seule.
  if (paused.length) out.push({ type: "markdown", text: t("partners_paused", { list: paused.map((c) => `${s.prefix}${c.name} (${c.label})`).join(", ") }) });
  return out;
}

function networksSection(ctx, info) {
  const t = ctx.t, { sources, list, s } = info;
  const out = [{ type: "heading", text: t("networks_title") }];
  if (!sources.networks.items.length) return [...out, { type: "markdown", text: t("networks_none") }];
  out.push({ type: "markdown", text: t("networks_help") });
  const rows = sources.networks.items;
  out.push({ type: "table", columns: [t("col_network"), t("col_state")],
    rows: rows.map((n) => { const c = list.find((x) => x.key === `network:${n.key}`); return [n.label, c ? `${words(s.prefix, c)} · ${stateLabel(t, c)}` : t("state_not_set")]; }),
    rowIds: rows.map((n) => `network:${n.key}`), rowActions: [{ label: t("act_configure"), href: "?edit={id}#edit" }] });
  return out;
}

/* ───────────── Formulaires ───────────── */

export const roleOptions = (t) => ROLES.map((r) => ({ value: r, label: roleLabel(t, r) }));
export const delayFields = (t, c) => [
  { name: "cdGlobal", label: t("f_cd_global"), kind: "number", value: c?.cdGlobal ?? "", help: t("f_cd_help") },
  { name: "cdUser", label: t("f_cd_user"), kind: "number", value: c?.cdUser ?? "" },
];
export const varsHelp = (t, kind) => t("f_text_help", { vars: allowedFor(kind).map((v) => `{${v}}`).join(" ") });

function createForm(ctx, s) {
  const t = ctx.t;
  return [
    { type: "heading", text: t("new_title") },
    { type: "adminForm", action: "create", submitLabel: t("new_btn"), fields: [
      { name: "name", label: t("f_name", { prefix: s.prefix }), required: true, help: t("f_name_help", { prefix: s.prefix }) },
      { name: "text", label: t("f_text"), kind: "textarea", required: true, help: varsHelp(t, "custom") },
      { name: "role", label: t("f_role"), kind: "select", value: "everyone", options: roleOptions(t) },
      { name: "aliases", label: t("f_aliases"), help: t("f_aliases_help") },
      ...delayFields(t, null),
    ] },
  ];
}

async function editBlocks(ctx, info, key, query) {
  const t = ctx.t, { s, sources, list } = info;
  const [kind, ...rest] = String(key).split(":");
  const id = rest.join(":");
  // Un ancien lien vers la configuration d'un partenaire : elle se fait maintenant dans la fiche du partenaire.
  if (kind === "partner") return [{ type: "markdown", text: t("edit_partner_moved", { href: partnerHref(ctx).replace("{id}", encodeURIComponent(id)) }) }];
  let c = list.find((x) => x.key === key);
  const out = [EDIT_ANCHOR];
  let proposal = null, item = null;
  if (!c && kind === "network") { item = sources.networks.items.find((n) => n.key === id); if (item) proposal = proposeNetwork(item, list, t); }
  if (!c && !proposal) return [{ type: "banner", tone: "warning", text: t("edit_unknown") }];
  const view = c ?? { kind, id, name: proposal.name, aliases: proposal.aliases, text: proposal.text, role: "everyone", cdGlobal: null, cdUser: null, enabled: false, vars: {}, label: item?.name ?? id };
  if (c?.missing) return [{ type: "banner", tone: "warning", text: t("network_gone") }];
  const source = c?.source ?? item;
  out.push({ type: "heading", text: t("edit_title", { command: `${s.prefix}${view.name}` }) });
  if (kind === "network" && source) out.push({ type: "markdown", text: t("edit_network_info", { name: source.name, address: source.url }) + (source.adminPath ? ` ${t("edit_network_module", { href: source.adminPath })}` : "") });
  if (kind === "builtin" && view.state && view.state !== "on" && view.state !== "off") out.push({ type: "banner", tone: "warning", text: t(`why_${view.why}`) });
  if (kind === "group") out.push({ type: "markdown", text: t("edit_group_info") });
  // Aperçu : ce que répondrait la commande avec les données du moment (rien n'est envoyé).
  try {
    const sample = { ...view, vars: view.vars && Object.keys(view.vars).length ? view.vars : kind === "network" && source ? { reseau: source.name, lien: String(source.url).replace(/^https?:\/\//i, "") } : {} };
    out.push({ type: "markdown", text: t("edit_preview", { text: (await preview(ctx, sample, { channel: info.d.channel ?? null, sources, list })).replace(/([\\`*_[\]<>])/g, "\\$1") }) });
  } catch { /* l'aperçu est un plus */ }
  out.push({ type: "adminForm", action: "save", submitLabel: t("save_btn"), cancelHref: "?", fields: [
    { name: "key", kind: "hidden", value: key },
    { name: "enabled", label: t(kind === "network" ? "f_enabled_chat" : "f_enabled"), kind: "checkbox", value: view.enabled ? "on" : "" },
    { name: "name", label: t("f_name", { prefix: s.prefix }), value: view.name, required: true, help: t("f_name_help", { prefix: s.prefix }) },
    { name: "aliases", label: t("f_aliases"), value: view.aliases.join(", "), help: t("f_aliases_help") },
    { name: "text", label: t("f_text"), kind: "textarea", value: view.text, required: true, help: varsHelp(t, kind) },
    { name: "role", label: t("f_role"), kind: "select", value: view.role, options: roleOptions(t) },
    ...delayFields(t, view),
  ] });
  if (kind === "builtin") out.push({ type: "adminForm", action: "resetText", submitLabel: t("reset_btn"), fields: [{ name: "key", kind: "hidden", value: key }] });
  if (kind === "custom") out.push({ type: "table", columns: [t("delete_title")], rows: [[`${s.prefix}${view.name}`]], rowIds: [view.id], rowActions: [{ label: t("delete_btn"), action: "remove", confirm: t("delete_confirm", { command: `${s.prefix}${view.name}` }), danger: true }] });
  return out;
}

/* ───────────── Journal ───────────── */

async function logBlocks(ctx, s) {
  const t = ctx.t, entries = await st.readLog(ctx);
  const out = [{ type: "heading", text: t("log_title") }, { type: "markdown", text: t("log_help") }];
  if (!entries.length) return [...out, { type: "markdown", text: t("log_empty") }];
  const when = (at) => new Date(at).toLocaleTimeString(ctx.locale, { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: s.timeZone });
  // Trois colonnes (l'heure et la personne ensemble, le résultat devant la réponse ou la raison) : tout reste lisible sur un téléphone.
  out.push({ type: "table", columns: [t("log_time_user"), t("col_command"), t("log_why")],
    rows: entries.map((e) => [`${when(e.at)} · ${e.user}`, `${s.prefix}${e.command}`, `${t(`log_${e.result}`)} : ${e.result === "sent" ? cut(e.text ?? "", 70) : `${t(`reason_${e.reason}`, { seconds: e.seconds ?? "" })}${e.detail && e.result === "error" ? ` (${cut(e.detail, 40)})` : ""}`}`]) });
  out.push({ type: "adminForm", action: "clearLog", submitLabel: t("log_clear"), fields: [] });
  return out;
}

/* ───────────── Compte qui répond (mode avancé) ───────────── */

function botAccountBlocks(ctx, info) {
  const t = ctx.t, { s, d } = info;
  if (s.replyAs !== "bot") return [];
  const out = [{ type: "heading", text: t("bot_title") }];
  if (d.bot?.status === "ok" || d.bot?.status === "more") out.push({ type: "banner", tone: "success", text: t("bot_connected", { login: d.bot.login ?? "" }) }, { type: "adminForm", action: "disconnectBot", submitLabel: t("bot_disconnect"), fields: [] });
  else out.push({ type: "markdown", text: t("bot_help") });
  return out;
}

/* ───────────── La page ───────────── */

export async function panel(ctx, { query }) {
  const t = ctx.t;
  const info = await context(ctx);
  let state = await st.readState(ctx);
  // Tout est prêt mais l'écoute n'est pas (ou plus) vérifiée : on la vérifie à l'ouverture de la page (au plus une fois toutes les 2 minutes, et 5 secondes après un « en attente »), pour ne pas faire cliquer pour rien.
  const sub = state.sub ?? {};
  const age = Date.now() - (sub.at ?? 0);
  if (info.d.code === "ready" && (sub.code === "pending" ? age > 5_000 : sub.code !== "listening" ? age > 120_000 : !!sub.who && sub.who !== info.d.senderId)) {   // « en attente » : Twitch a eu le temps de vérifier, on regarde où on en est
    await ensureListening(ctx, info.s, { settle: true }).catch(() => {});
    state = await st.readState(ctx);
  }
  const blocks = [];
  blocks.push(...emergency(ctx, state.muted === true, state.mutedAt, info.s.timeZone));
  blocks.push({ type: "heading", text: t("listen_title") });
  blocks.push(...(await listenBlocks(ctx, info, state)));
  blocks.push(...listenActions(ctx, info.d.code !== "ready" ? info.d.code : state.sub?.code ?? "unknown"));
  blocks.push(...botAccountBlocks(ctx, info));
  const edit = typeof query?.edit === "string" ? query.edit : "";
  if (edit) blocks.push(...(await editBlocks(ctx, info, edit, query)));
  blocks.push(...summary(ctx, info));
  if (!edit) blocks.push(...createForm(ctx, info.s));
  blocks.push(...partnersSection(ctx, info), ...networksSection(ctx, info));
  blocks.push(...(await logBlocks(ctx, info.s)));
  blocks.push(...(await RA.blocks(ctx, info, query ?? {})));
  return blocks;
}

/* ───────────── Actions ───────────── */

const parseKey = (k) => { const [kind, ...r] = String(k ?? "").split(":"); return { kind, id: r.join(":") }; };
const fieldsFrom = (v) => ({ enabled: v.enabled === "on", name: v.name, aliases: v.aliases ?? "", text: v.text, role: v.role || "everyone", cdGlobal: v.cdGlobal ?? "", cdUser: v.cdUser ?? "" });

/**
 * Les actions NE redirigent PAS (sauf deux cas ci-dessous) : une redirection recharge la page et ramène tout en haut. Le cœur rafraîchit la page à la place, et le message
 * de réussite ou d'erreur s'affiche sous le bouton cliqué : la personne reste où elle est.
 * Exceptions : supprimer une commande et rétablir un texte d'origine reviennent à la page de cette commande (sa configuration change ou disparaît sous les yeux).
 */
export const actions = {
  async mute(ctx) { await st.setMuted(ctx, true); return { ok: ctx.t("muted_done") }; },
  async unmute(ctx) { await st.setMuted(ctx, false); return { ok: ctx.t("unmuted_done") }; },
  async check(ctx) {
    const r = await ensureListening(ctx, settingsOf(ctx), { settle: true });
    await ensureRedeemListening(ctx, settingsOf(ctx), { settle: true }).catch(() => {});
    return r.code === "listening" ? { ok: ctx.t("check_ok") } : { ok: ctx.t("check_done") };
  },
  async relisten(ctx) {
    const r = await ensureListening(ctx, settingsOf(ctx), { renew: true, settle: true });
    return { ok: ctx.t(r.code === "pending" || r.code === "listening" ? "relisten_ok" : "check_done") };
  },
  async save(ctx, v) {
    const info = await context(ctx, { declare: false });
    const { kind, id } = parseKey(v.key);
    const fields = fieldsFrom(v);
    const r = kind === "partner" || kind === "network" ? await saveSourced(ctx, kind, id, fields, info.env) : await saveCommand(ctx, { kind, id }, fields, info.env);
    return r.ok === false ? { error: saveError(ctx, r) } : { ok: ctx.t("saved") };
  },
  async create(ctx, v) {
    const info = await context(ctx, { declare: false });
    const r = await saveCommand(ctx, { kind: "custom" }, { ...fieldsFrom(v), enabled: true }, info.env);
    return r.ok === false ? { error: saveError(ctx, r) } : { ok: ctx.t("created") };
  },
  async toggle(ctx, v) {
    const info = await context(ctx, { declare: false });
    const { kind, id } = parseKey(v.id);
    const c = info.list.find((x) => x.key === v.id);
    if (!c) return { error: ctx.t("err_unknown") };
    const r = kind === "partner" || kind === "network" ? await saveSourced(ctx, kind, id, { enabled: !c.enabled }, info.env) : await saveCommand(ctx, { kind, id }, { enabled: !c.enabled }, info.env);
    return r.ok === false ? { error: saveError(ctx, r) } : { ok: ctx.t(c.enabled ? "toggled_off" : "toggled_on", { command: `${info.s.prefix}${c.name}` }) };
  },
  async remove(ctx, v) {
    const r = await removeCustom(ctx, v.id);
    return r.ok === false ? { error: ctx.t("err_unknown") } : { ok: ctx.t("deleted"), redirect: "?" };
  },
  async resetText(ctx, v) {
    const info = await context(ctx, { declare: false });
    const { kind, id } = parseKey(v.key);
    const c = info.list.find((x) => x.key === v.key);
    if (!c || (kind !== "builtin" && kind !== "group")) return { error: ctx.t("err_unknown") };
    const r = await saveCommand(ctx, { kind, id }, { text: c.defaultText }, info.env);
    return r.ok === false ? { error: saveError(ctx, r) } : { ok: ctx.t("reset_done"), redirect: `?edit=${v.key}#edit` };
  },
  ...RA.actions,
  async clearLog(ctx) { await st.clearLog(ctx); return { ok: ctx.t("log_cleared") }; },
  async disconnectBot(ctx) {
    const info = await context(ctx, { declare: false });
    if (info.d.channel) await ctx.api.services.callAll(SERVICE, "disconnect", { channel: info.d.channel, slot: "bot" });
    return { ok: ctx.t("bot_disconnected") };
  },
};
