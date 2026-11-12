// La page d'administration du bot : arrêt d'urgence, « le bot écoute ? », résumé de toutes les commandes, partenaires, réseaux, journal. Modifier ou créer une commande ouvre une FENÊTRE
// au-dessus de la page (`presentation: "dialog"`, cœur 0.6.7) : la liste garde sa recherche, son filtre et sa place.
// Pensée pour une personne qui n'est pas technicienne : des phrases, pas de jargon, et chaque problème dit quoi faire.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { catalog, loadConfig, proposeNetwork, saveCommand, saveSourced, removeCustom } = await import(`./commands.mjs${v}`);
const { settingsOf } = await import(`./settings.mjs${v}`);
const src = await import(`./sources.mjs${v}`);
const st = await import(`./state.mjs${v}`);
const { diagnose, ensureListening, ensureRedeemListening } = await import(`./listen.mjs${v}`);
const { shownFor, used } = await import(`./variables.mjs${v}`);
const { reopenLabel, parsePeriodValue, periodError } = await import(`./period.mjs${v}`);
const { saveError } = await import(`./errors.mjs${v}`);
const { preview } = await import(`./engine.mjs${v}`);
const K = await import(`./adminkit.mjs${v}`);
const CU = await import(`./commandsUi.mjs${v}`);
const FU = await import(`./formsUi.mjs${v}`);
const RA = await import(`./rewardsAdmin.mjs${v}`);
const TA = await import(`./timersAdmin.mjs${v}`);
const CO = await import(`./collab.mjs${v}`);
const COU = await import(`./collabUi.mjs${v}`);

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const cut = (v, n) => { const s = String(v ?? ""); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const SERVICE = "twitch.api";

/** La section que ce module ajoute à la fiche d'un partenaire (déclarée dans `entryPanels` de module.json) : son identifiant et son adresse dans la fiche. */
export const PANEL_ID = "chat-command";
const panelAnchor = (ctx) => `panel-${ctx.instance.key}-${PANEL_ID}`.replace(/[^a-zA-Z0-9_-]/g, "-");
/** Le lien « Modifier » d'un partenaire : sa fiche, ouverte sur la section de la commande (la fiche ajoute elle-même l'étiquette du contenu dans l'adresse). */
const partnerHref = (ctx) => `/admin/entries/{id}#${panelAnchor(ctx)}`;

/** Le bouton « Autoriser chez Twitch » : un lien (adresse construite par Chaîne Twitch) habillé aux couleurs de l'administration. */
const button = (label, href) => ({ type: "html", html: `<p><a data-twitch-connect href="${esc(href)}" style="display:inline-block;padding:.65rem 1.25rem;border-radius:.75rem;background:var(--v-accent);color:var(--v-accent-fg);font-weight:600;text-decoration:none">${esc(label)}</a></p>` });

/* ───────────── Messages d'erreur d'enregistrement ───────────── */

export { saveError };

/* ───────────── Le décor commun ───────────── */

/** Tout ce que la page et les actions ont besoin de savoir, lu une fois. */
export async function context(ctx, { declare = true } = {}) {
  const s = settingsOf(ctx);
  const d = await diagnose(ctx, s, { declare });
  const sources = await src.gather(ctx, d.channel ?? null);
  const cfg = (await loadConfig(ctx)).data;
  const list = catalog(cfg, sources, ctx.t, { timeZone: s.timeZone });
  return { s, d, sources, cfg, list, env: { src: sources, t: ctx.t, prefix: s.prefix } };
}

/* ───────────── Le haut de page : UNE ligne d'état et l'arrêt d'urgence ───────────── */

async function connectBlocks(ctx, d, slot) {
  if (!d.channel) return [];
  const r = (await ctx.api.services.callAll(SERVICE, "connectLink", { channel: d.channel, slot })).find((x) => x.ok && x.value?.ok);
  const url = r?.value?.url;
  return url ? [button(ctx.t(slot === "bot" ? "connect_bot_btn" : "connect_btn"), url)] : [];
}

const PROBLEM_TONE = "warning";
/** Le code qui dit où en est l'écoute. */
const listenCode = (d, state) => (d.code !== "ready" ? d.code : (state.sub ?? {}).code ?? "unknown");
/**
 * La ligne d'état : « Le bot écoute votre chat · dernier message … · répond pendant vos directs » + « Vérifier » (ou « Réparer l'écoute » s'il y a un problème) + l'arrêt d'urgence,
 * un petit bouton distinct, toujours visible sans défiler. Coupé, la ligne le dit et le bouton devient « Réactiver les réponses ». Aucune carte à un seul bouton (R3, R14, R24).
 */
function topBar(ctx, info, state) {
  const t = ctx.t, { s, d } = info, code = listenCode(d, state), ok = code === "listening", muted = state.muted === true;
  const fmt = (at) => new Date(at).toLocaleString(ctx.locale, { dateStyle: "short", timeStyle: "short", timeZone: s.timeZone });
  const fail = t("err_toggle");
  const repair = !ok && ["revoked", "refused", "pending", "twitch_down", "twitch_busy"].includes(code);
  const check = repair ? K.actionButton({ label: t("relisten_btn"), act: "relisten", cls: "small", fail }) : K.actionButton({ label: t("check_short"), act: "check", cls: "small", fail });
  const stop = muted ? K.actionButton({ label: t("mute_off_btn"), act: "unmute", cls: "small primary", fail }) : K.actionButton({ label: t("mute_short"), act: "mute", cls: "small ck-danger", fail, title: t("mute_tip") });
  const texts = muted ? [state.mutedAt ? t(state.mutedBy === "remote" ? "mute_since_remote" : "mute_since", { date: fmt(state.mutedAt) }) : ""] : ok ? [state.lastMessageAt ? t("top_last", { when: fmt(state.lastMessageAt) }) : t("top_nomsg")] : [];
  return K.statusBar(ctx, { kind: muted ? "danger" : ok ? "ok" : "warn", pill: muted ? t("top_muted") : ok ? t("top_listening") : t("top_problem"), texts: texts.filter(Boolean), grey: ok && !muted ? t(s.onlyWhenLive ? "top_live_only" : "top_always") : "", buttons: `${check}${stop}` });
}

/** Ce qui reste sous la ligne quand il y a un problème : la phrase qui dit pourquoi et quoi faire, le bouton d'autorisation. */
async function listenBlocks(ctx, ctxInfo, state) {
  const t = ctx.t, { s, d } = ctxInfo;
  const sub = state.sub ?? {};
  const code = listenCode(d, state);
  const out = [];
  const res = d.main?.result;
  const botRes = d.bot?.result;
  if (res && res.code) out.push({ type: "banner", tone: "warning", text: t(`res_${res.code}`, { login: res.login ?? "" }) });
  if (botRes && botRes.code && s.replyAs === "bot") out.push({ type: "banner", tone: "warning", text: t(`res_${botRes.code}`, { login: botRes.login ?? "" }) });
  if (code === "listening") return out;
  const failure = sub.failure ? ` ${t(`listen_failure_${sub.failure}`)}` : "";
  out.push({ type: "banner", tone: PROBLEM_TONE, text: `${t(`listen_${code}`, { detail: sub.detail ?? "" })}${failure}` });
  if (["need_connect", "need_reconnect", "need_more"].includes(code)) out.push({ type: "markdown", text: t("connect_steps") }, ...(await connectBlocks(ctx, d, "main")));
  else if (["bot_need_connect", "bot_reconnect", "bot_more"].includes(code)) out.push({ type: "markdown", text: t("connect_bot_steps") }, ...(await connectBlocks(ctx, d, "bot")));
  else if (code === "creds_missing" && d.main?.adminPath) out.push({ type: "markdown", text: t("creds_steps", { href: d.main.adminPath }) });
  else if (code === "no_channel") out.push({ type: "markdown", text: t("no_channel_steps") });
  return out;
}

/* ───────────── L'état d'une commande, en mots ───────────── */

export function stateLabel(t, c, ctx = null) {
  if (c.state === "on") return t("state_on");
  if (c.state === "off") return t("state_off");
  if (c.state === "outside") return ctx ? reopenLabel(ctx, c.reopen) : t("state_outside");
  return t(`why_${c.why}`);
}
export const words = (prefix, c) => [c.name, ...c.aliases].map((w) => `${prefix}${w}`).join("  ");
export const roleOptions = FU.roleOptions;
/** Les attentes d'une commande (aussi utilisées par la fiche du partenaire). */
export const delayFields = (t, c, s = { cdGlobal: 20, cdUser: 60 }) => [
  { name: "cdGlobal", label: t("f_cd_global"), kind: "number", value: c?.cdGlobal ?? "", help: t("f_cd_help", { n: s.cdGlobal }) },
  { name: "cdUser", label: t("f_cd_user"), kind: "number", value: c?.cdUser ?? "", help: t("f_cd_help", { n: s.cdUser }) },
];
export const varsHelp = (t, kind) => t("f_text_help_vars", { vars: shownFor(kind).map((v) => `{${v}}`).join(" ") });

/* ───────────── Création et modification d'une commande (une fenêtre) ───────────── */

/** L'onglet où la fenêtre s'ouvre : « Timers » quand le lien vient de là (la liste des timers reste derrière), sinon « Commandes ». */
const tabOf = (query) => (query?.tab === "timers" ? "timers" : "use");

/**
 * Le bloc de la fenêtre « Modifier » (un seul formulaire), ou une phrase quand la commande n'existe pas ou a disparu. Ce que l'ancien écran posait AUTOUR du formulaire se range ailleurs :
 * le compteur et le texte d'origine sont deux interrupteurs sous « Plus d'options », « Supprimer » est dans le menu « ⋯ » de la ligne (avec ce qui sera perdu), et l'état (hors période,
 * masquée) est écrit dans la ligne. Le cœur n'a pas encore de texte d'introduction dans une fenêtre : l'information « réseau » devient l'aide du champ « Ce que le bot répond ».
 */
async function editBlocks(ctx, info, key, query) {
  const t = ctx.t, { s, sources, list } = info;
  const [kind, ...rest] = String(key).split(":");
  const id = rest.join(":");
  const tab = tabOf(query);
  const c = list.find((x) => x.key === key);
  let proposal = null, item = null;
  if (!c && kind === "network") { item = sources.networks.items.find((n) => n.key === id); if (item) proposal = proposeNetwork(item, list, t); }
  if (!c && !proposal) return [{ type: "banner", tone: "warning", text: t("edit_unknown") }];
  if (c?.missing) return [{ type: "banner", tone: "warning", text: t("network_gone") }];
  const view = c ?? { kind, id, name: proposal.name, aliases: proposal.aliases, text: proposal.text, role: "everyone", cdGlobal: null, cdUser: null, enabled: false, vars: { reseau: item.name, lien: String(item.url).replace(/^https?:\/\//i, "") }, label: item?.name ?? id };
  // La commande d'un partenaire se règle dans sa fiche : la fenêtre le dit et son bouton y mène (R30).
  if (kind === "partner") return [CU.partnerStub(ctx, info, { view, key, tab })];
  const source = c?.source ?? item;
  const counter = kind === "custom" && used(view.text).includes("compteur") ? ((await st.readCounters(ctx))[view.key] ?? 0) : null;
  const vars = varsHelp(t, kind);
  const form = CU.commandForm(ctx, info, { mode: "edit", view, key, kind, unsaved: !c, repeatIntent: !!query?.repeat, tab, counter, canReset: kind === "builtin" || kind === "group", varsHelp: kind === "network" && source ? `${t("edit_network_help", { name: source.name })} ${vars}` : vars });
  return [form];
}

function newBlocks(ctx, info, query) {
  return [CU.commandForm(ctx, info, { mode: "new", kind: "custom", tab: tabOf(query), varsHelp: varsHelp(ctx.t, "custom"), view: { name: "", text: "", role: "everyone", aliases: [], vars: {} } })];
}

/* ───────────── Compte qui répond (mode avancé) ───────────── */

function botAccountBlocks(ctx, info) {
  const t = ctx.t, { s, d } = info;
  if (s.replyAs !== "bot") return [];
  const out = [{ type: "heading", text: t("bot_title") }];
  if (d.bot?.status === "ok" || d.bot?.status === "more") out.push({ type: "banner", tone: "success", text: t("bot_connected", { login: d.bot.login ?? "" }) }, K.inlineActions(ctx, K.actionButton({ label: t("bot_disconnect"), act: "disconnectBot", cls: "small", fail: t("err_toggle") })));
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
  const blocks = [K.bootstrap(ctx), topBar(ctx, info, state), ...COU.blocks(ctx, info.s, await CO.current(ctx)), ...(await listenBlocks(ctx, info, state)), ...botAccountBlocks(ctx, info)];
  // La fenêtre « Modifier » ou « Nouvelle commande » : le formulaire n'est renvoyé que quand l'adresse le demande (`?edit=…`, `?new=1`) ; la liste est toujours là, dessous.
  const edit = typeof query?.edit === "string" ? query.edit : "";
  if (edit) blocks.push(...(await editBlocks(ctx, info, edit, query)));
  else if (query?.new) blocks.push(...newBlocks(ctx, info, query));
  blocks.push({ type: "heading", text: t("summary_title") }, { type: "markdown", text: t("summary_help") }, CU.newLink(ctx), CU.commandsTable(ctx, info));
  const add = CU.addChooser(ctx, info, { partnerHref: partnerHref(ctx) });
  if (add) blocks.push(add);
  blocks.push(CU.logBlock(ctx, info.s, await st.readLog(ctx)));
  blocks.push(...(await TA.blocks(ctx, info, query ?? {})));
  blocks.push(...(await RA.blocks(ctx, info, query ?? {})));
  return blocks;
}

/* ───────────── Actions ───────────── */

/** Une erreur d'enregistrement : sous le champ quand on sait lequel (la période), sinon en haut. */
const FIELD_OF = { period: "period", timer_minutes: "repeatEvery", timer_lines: "repeatLines", timer_many: "repeatOn", repeat_kind: "repeatOn", timer_only: "timerOnly" };
const failed = (ctx, r) => (FIELD_OF[r.code] ? { errors: { [FIELD_OF[r.code]]: saveError(ctx, r) } } : { error: saveError(ctx, r) });
const can = (ctx) => typeof ctx.can === "function" && ctx.can("timers.manage") === true;
/**
 * Les champs « Répéter automatiquement » du formulaire (interrupteur, durée en secondes, minimum de lignes, quand) → { repeat } ou { bad }. Rien n'est envoyé quand le formulaire n'a pas ces champs
 * (la fiche d'un partenaire) ; une commande sans répétition et un interrupteur éteint : rien ne change. Éteint sur une commande qui se répète : elle est mise en pause (ses réglages restent).
 * Sans le droit « timers.manage », la répétition n'est pas modifiable depuis ce formulaire.
 */
function repeatOf(ctx, v, cur) {
  if (v.repeatEvery === undefined && v.repeatOn === undefined) return {};
  if (!can(ctx)) return {};
  const on = v.repeatOn === "on";
  if (!cur && !on) return {};
  const raw = v.repeatEvery === undefined || v.repeatEvery === "" ? undefined : Number(v.repeatEvery);
  if (raw !== undefined && (!Number.isInteger(raw / 60) || raw < 60)) return { bad: failed(ctx, { code: "timer_minutes" }) };
  return { repeat: { ...(raw !== undefined ? { minutes: raw / 60 } : {}), ...(v.repeatLines !== undefined ? { lines: v.repeatLines } : {}), ...(v.repeatWhen ? { when: v.repeatWhen } : {}), enabled: on } };
}
/** Le champ « période » du formulaire (celui du cœur : 11-01/11-30 ou 2026-11-01/2026-11-30 ; l'ancienne écriture 01/11 - 30/11 est encore lue) → { period } ou { bad } (la phrase d'erreur va sous le champ). Absent : rien ne change. */
function periodOf(ctx, v) {
  if (v.period === undefined) return {};
  const p = parsePeriodValue(v.period);
  return p.ok ? { period: p.value } : { bad: { errors: { period: periodError(ctx, p) } } };
}
/** Une commande « réservée au timer » sans répétition active ne répondrait jamais : l'erreur est sous l'interrupteur « Seulement pour le timer ». */
function timerOnlyCheck(ctx, fields, cur) {
  if (fields.timerOnly !== true) return null;
  const rep = fields.repeat ?? cur;
  return rep ? null : { errors: { timerOnly: ctx.t("err_timer_only") } };
}
const parseKey = (k) => { const [kind, ...r] = String(k ?? "").split(":"); return { kind, id: r.join(":") }; };
const fieldsFrom = (v) => ({ ...(v.enabled !== undefined ? { enabled: v.enabled === "on" } : {}), name: v.name, aliases: v.aliases ?? "", text: v.text, role: v.role || "everyone", cdGlobal: v.cdGlobal ?? "", cdUser: v.cdUser ?? "" });

/**
 * Les actions NE redirigent PAS (sauf « Ouvrir la fiche du partenaire ») : une redirection recharge la page et ramène tout en haut. Le cœur rafraîchit la page à la place, et le message
 * de réussite ou d'erreur s'affiche sous le bouton cliqué ; une réussite dans une fenêtre la ferme et marque la ligne enregistrée : la personne reste où elle est.
 */
export const actions = {
  async mute(ctx) { await st.setMuted(ctx, true); return { ok: ctx.t("muted_done") }; },
  async unmute(ctx) { await st.setMuted(ctx, false); return { ok: ctx.t("unmuted_done") }; },
  /** Collaboration mode: one press switches it on or off with the saved choices (a repeated press changes nothing). */
  async collabOn(ctx) { await CO.setOn(ctx, true, "admin"); return { ok: ctx.t("co_on_done") }; },
  async collabOff(ctx) { await CO.setOn(ctx, false, "admin"); return { ok: ctx.t("co_off_done") }; },
  async collabSave(ctx, v) {
    const r = CO.check({ mode: v.collabMode, ratio: v.collabRatio, factor: v.collabFactor, hours: v.collabHours, quiet: v.collabQuiet === "on" ? "on" : "off" }, CO.DEFAULTS);
    if (!r.ok) return { errors: COU.errors(ctx, r.errors) };
    await CO.saveChoices(ctx, r.value);
    return { ok: ctx.t("co_saved") };
  },
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
    const key = v.key ?? v.id;   // la fenêtre envoie les deux (`id` sert à repérer la ligne enregistrée)
    const { kind, id } = parseKey(key);
    const per = periodOf(ctx, v);
    if (per.bad) return per.bad;
    const cur = info.list.find((x) => x.key === key);
    const rep = repeatOf(ctx, v, cur?.repeat ?? null);
    if (rep.bad) return rep.bad;
    const fields = { ...fieldsFrom(v), ...(per.period !== undefined ? { period: per.period } : {}), ...(rep.repeat ? { repeat: rep.repeat } : {}), ...(kind === "custom" && v.repeatEvery !== undefined ? { timerOnly: v.timerOnly === "on" } : {}) };
    if (v.resetText === "on" && (kind === "builtin" || kind === "group") && cur?.defaultText !== undefined) fields.text = cur.defaultText;   // « Rétablir le texte d'origine »
    const bad = timerOnlyCheck(ctx, fields, cur?.repeat ?? null);
    if (bad) return bad;
    const r = kind === "partner" || kind === "network" ? await saveSourced(ctx, kind, id, fields, info.env) : await saveCommand(ctx, { kind, id }, fields, info.env);
    if (r.ok === false) return failed(ctx, r);
    if (v.counterReset === "on" && kind === "custom" && cur) await st.setCounter(ctx, cur.key, 0);   // « Remettre le compteur à zéro »
    return { ok: ctx.t("saved") };
  },
  async create(ctx, v) {
    const info = await context(ctx, { declare: false });
    const per = periodOf(ctx, v);
    if (per.bad) return per.bad;
    const rep = repeatOf(ctx, v, null);
    if (rep.bad) return rep.bad;
    const fields = { ...fieldsFrom(v), enabled: true, ...(per.period !== undefined ? { period: per.period } : {}), ...(rep.repeat ? { repeat: rep.repeat } : {}), ...(v.repeatEvery !== undefined ? { timerOnly: v.timerOnly === "on" } : {}) };
    const bad = timerOnlyCheck(ctx, fields, null);
    if (bad) return bad;
    const r = await saveCommand(ctx, { kind: "custom" }, fields, info.env);
    return r.ok === false ? failed(ctx, r) : { ok: ctx.t("created") };
  },
  /** L'interrupteur de la liste DIT l'état voulu (`enabled` : « 1 » ou « 0 ») : un double clic ne défait rien. Sans `enabled` (ancien appel), l'état est inversé. */
  async toggle(ctx, v) {
    const info = await context(ctx, { declare: false });
    const { kind, id } = parseKey(v.id);
    const c = info.list.find((x) => x.key === v.id);
    if (!c) return { error: ctx.t("err_unknown") };
    const want = v.enabled === undefined ? !c.enabled : String(v.enabled) === "1";
    const r = kind === "partner" || kind === "network" ? await saveSourced(ctx, kind, id, { enabled: want }, info.env) : await saveCommand(ctx, { kind, id }, { enabled: want }, info.env);
    return r.ok === false ? { error: saveError(ctx, r) } : { ok: ctx.t(want ? "toggled_on" : "toggled_off", { command: `${info.s.prefix}${c.name}` }) };
  },
  /** « Supprimer » du menu de la ligne : seules les commandes à vous se suppriment (les autres se coupent avec l'interrupteur). La ligne envoie sa clé (`custom:…`). */
  async remove(ctx, v) {
    const raw = String(v.id ?? "");
    const { kind, id } = raw.includes(":") ? parseKey(raw) : { kind: "custom", id: raw };
    if (kind !== "custom") return { error: ctx.t("delete_own_only") };
    const r = await removeCustom(ctx, id);
    return r.ok === false ? { error: ctx.t("err_unknown") } : { ok: ctx.t("deleted") };
  },
  /** « Ouvrir la fiche du partenaire » : la commande d'un partenaire se règle dans sa fiche (R30). */
  async openPartner(ctx, v) {
    const { kind, id } = parseKey(v.id ?? v.key);
    if (kind !== "partner" || !id) return { error: ctx.t("err_unknown") };
    return { ok: ctx.t("act_open_partner"), redirect: partnerHref(ctx).replace("{id}", encodeURIComponent(id)) };
  },
  ...RA.actions,
  ...TA.actions,
  async clearLog(ctx) { await st.clearLog(ctx); return { ok: ctx.t("log_cleared") }; },
  async disconnectBot(ctx) {
    const info = await context(ctx, { declare: false });
    if (info.d.channel) await ctx.api.services.callAll(SERVICE, "disconnect", { channel: info.d.channel, slot: "bot" });
    return { ok: ctx.t("bot_disconnected") };
  },
};
