// L'onglet « Timers » : les commandes que le bot répète tout seul. Un timer n'est plus un objet à part : c'est le réglage « Répéter automatiquement » d'une commande
// (voir timers.mjs). L'onglet : UN tableau du cœur des commandes qui se répètent (recherche en direct, filtre d'état, interrupteur dans la ligne) ; « Modifier » et « Ajouter un timer »
// ouvrent une FENÊTRE au-dessus de la page (`presentation: "dialog"`, cœur 0.6.7) ; « Supprimer le timer » est dans le menu « ⋯ ». « Choisir une commande qui existe » reste une
// liste du module, repliée : le cœur ne sait pas encore choisir dans une liste depuis une fenêtre. Le bot n'a aucun minuteur : il ne regarde ses répétitions qu'à l'arrivée d'un message du chat.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const T = await import(`./timers.mjs${v}`);
const { saveCommand, removeCustom, MAX_REPEATS, REPEAT_LIMITS } = await import(`./commands.mjs${v}`);
const { saveError } = await import(`./errors.mjs${v}`);
const { used } = await import(`./variables.mjs${v}`);
const { settingsOf } = await import(`./settings.mjs${v}`);
const K = await import(`./adminkit.mjs${v}`);
const CU = await import(`./commandsUi.mjs${v}`);
const F = await import(`./formsUi.mjs${v}`);


const { esc } = K;
const tab = (blocks) => blocks.map((b) => ({ ...b, tab: "timers" }));
const can = (ctx) => typeof ctx.can === "function" && ctx.can("timers.manage") === true;
const run = (fn) => ({ right: "timers.manage", run: fn });
const DEFAULT_LINES = 5;
const TAB = "?tab=timers";
/** Le lien « Modifier » : la commande, ouverte dans une fenêtre sur ses réglages « Répéter automatiquement ». */
export const editHref = (key) => `${TAB}&edit=${encodeURIComponent(key)}&repeat=1`;

/** Le rythme en mots (« toutes les 15 min ») et ce qui sort de l'ordinaire (R14) : hors direct aussi, ou un minimum de messages autre que 5. */
function rhythm(t, r) {
  const every = r.minutes % 60 === 0 && r.minutes >= 60 ? t("rep_every_h", { h: r.minutes / 60 }) : t("rep_every_m", { min: r.minutes });
  const notes = [];
  if (r.when === "always") notes.push(t("rep_note_always"));
  if (r.lines !== DEFAULT_LINES) notes.push(r.lines === 0 ? t("rep_note_nolines") : t("rep_note_lines", { n: r.lines }));
  return { every, note: notes.join(" · ") };
}

/** L'état d'une répétition : { state: "on" | "off" | "outside", full (info-bulle), note (à côté de l'interrupteur, seulement si ça sort de l'ordinaire), word }. */
async function stateOf(ctx, c) {
  const t = ctx.t;
  if (c.repeat.enabled === false) return { state: "off", full: t("rep_state_paused"), note: "", word: t("rep_state_paused") };
  if (c.state === "off") return { state: "off", full: t("rep_state_cmd_off"), note: t("rep_note_cmd_off"), word: t("rep_state_paused") };
  if (c.state === "outside") { const st = CU.stateTexts(ctx, "outside", "outside_period", c.reopen); return { state: "outside", full: st.full, note: st.note, word: st.word }; }
  if (c.state !== "on") { const st = CU.stateTexts(ctx, c.state, c.why, null); return { state: "off", full: st.full, note: st.note, word: st.word }; }
  const it = await T.stateOf(ctx, c.key);
  if (!it) return { state: "on", full: t("tm_state_new"), note: "", word: t("state_on") };
  const left = Math.max(0, Math.ceil((c.repeat.minutes * 60_000 - (Date.now() - it.lastAt)) / 60_000)), more = Math.max(0, c.repeat.lines - it.lines);
  return left || more ? { state: "on", full: t("tm_state_wait", { min: left, lines: more }), note: t("tm_note_wait", { min: left, lines: more }), word: t("state_on") } : { state: "on", full: t("tm_state_due"), note: t("tm_note_due"), word: t("state_on") };
}

const nameOf = (info, c) => c.title || `${info.s.prefix}${c.name}`;
const FILTER = { on: "tm_filter_on", off: "tm_filter_off", outside: "tm_filter_outside" };

/** UN tableau : nom, message, rythme (et ce qui sort de l'ordinaire : « Timer seulement », hors direct…), état avec son interrupteur. */
async function listBlock(ctx, info, rows, writable) {
  const t = ctx.t;
  const states = await Promise.all(rows.map((c) => stateOf(ctx, c)));
  return {
    type: "table", columns: [t("col_command"), t("col_answer"), t("tm_col_rhythm"), t("col_active")], rowIds: rows.map((c) => c.key),
    searchable: true, searchPlaceholder: t("search_timers"), filters: [{ column: 3, allLabel: t("filter_any") }], truncate: [0, 1, 2], empty: t("tm_empty"),
    rows: rows.map((c, i) => {
      const st = states[i], r = rhythm(t, c.repeat), name = nameOf(info, c);
      const notes = [r.note, c.timerOnly ? t("pill_timer_only") : ""].filter(Boolean).join(" · ");
      const rhythmText = `${r.every}${notes ? ` · ${notes}` : ""}`;
      const state = { text: t(FILTER[st.state]), title: st.full };
      return [{ text: name, title: name }, { text: c.text, title: c.text }, { text: rhythmText, title: rhythmText },
        writable ? { ...state, switch: { on: c.repeat.enabled !== false, action: "timerToggle", label: t("sw_label_timer", { name }), onText: st.note ? `${t(FILTER[st.state])} · ${st.note}` : t(FILTER[st.state]), offText: t("tm_filter_off") } } : state];
    }),
    rowActions: writable ? [{ label: t("act_edit"), href: `${TAB}&edit={id}&repeat=1`, presentation: "dialog" }, { label: t("tm_send_btn"), action: "timerSend", confirm: t("tm_send_confirm") }, { label: t("tm_delete_btn"), action: "timerDelete", confirm: t("tm_delete_confirm"), danger: true }] : [],
  };
}

/** Le haut de l'onglet : le titre, UNE phrase qui dit à quoi il sert (R1) et « Ajouter un timer » (le seul bouton principal, il ouvre une fenêtre). */
function headBlocks(ctx, writable, n) {
  const t = ctx.t;
  return [{ type: "heading", text: t("tm_title") }, { type: "markdown", text: t("tm_intro") },
    ...(writable && n < MAX_REPEATS ? [{ type: "links", items: [{ label: t("tm_new_open"), href: `${TAB}&timerAdd=1`, presentation: "dialog" }] }] : []),
    ...(writable && n >= MAX_REPEATS ? [{ type: "markdown", text: t("tm_full", { max: MAX_REPEATS }) }] : [])];
}

/** La fenêtre « Ajouter un timer » : une commande nouvelle (un nom, un texte ; « Lancée par » et la durée sont repliés). */
function newTimerForm(ctx, info) {
  const t = ctx.t;
  return { type: "adminForm", presentation: "dialog", action: "timerNew", title: t("tm_add_title"), submitLabel: t("tm_new_btn"), cancelHref: TAB, fields: [
    { name: "name", label: t("tm_n_name"), required: true, example: t("tm_n_name_example"), help: t("tm_n_name_help", { prefix: info.s.prefix }) },
    { name: "text", label: t("tm_n_text"), kind: "textarea", required: true, example: t("tm_n_text_example") },
    F.timerOnlyField(ctx, false, { folded: true }),
    { name: "repeatEvery", label: t("rep_every"), kind: "duration", min: 60, max: REPEAT_LIMITS.minutes * 60, value: 900, help: t("rep_every_help"), example: t("rep_every_example"), folded: true },
  ] };
}

/**
 * « Choisir une commande qui existe » : une liste du module, repliée sous le tableau (recherche, un lien « Ajouter ce timer » par ligne). Le lien ouvre la fenêtre de la commande,
 * déjà sur sa répétition. À remplacer par un choix dans la fenêtre quand le cœur en offrira un.
 */
function pickBlock(ctx, info) {
  const t = ctx.t;
  const cands = info.list.filter((c) => !c.repeat && !c.missing && c.kind !== "partner");
  if (!cands.length) return null;
  const rows = cands.map((c) => {
    const first = `${info.s.prefix}${c.name}`, origin = c.kind === "group" ? "builtin" : c.kind;
    return `<tr ${K.rowAttrs({ origin }, `${first} ${c.aliases.join(" ")} ${c.text} ${t(`origin_${origin}`)}`)}><td class="c-name"><span class="ck-ell" title="${esc(first)}"><span class="ck-name">${esc(first)}</span></span></td><td class="c-ans"><span class="ck-ell" title="${esc(c.text)}">${esc(c.text)}</span></td><td class="c-org">${K.originPill(origin, t(`origin_${origin}`))}</td><td class="c-act"><div class="ck-acts"><a class="ck-btn small" href="${esc(editHref(c.key))}">${esc(t("tm_pick_btn"))}</a></div></td></tr>`;
  }).join("");
  const body = K.listShell({
    ctx, id: "timer-pick", columns: [{ label: t("col_command"), width: "22%" }, { label: t("col_answer") }, { label: t("col_origin"), width: "13%" }, { label: t("col_action"), width: "22%", sr: true }],
    rows, text: { search: t("search_label"), placeholder: t("search_commands"), empty: t("search_none"), clear: t("search_clear"), count: t("search_count") },
  });
  return { type: "html", html: `<div class="ck"><details class="ck-add"><summary><span class="ck-add-b">${esc(t("tm_route_pick"))}</span><span class="ck-add-s">${esc(t("tm_pick_status", { n: cands.length }))}</span></summary><div class="ck-add-body">${body}</div></details></div>` };
}

export async function blocks(ctx, info, query = {}) {
  const t = ctx.t;
  const rows = info.list.filter((c) => c.repeat).sort((a, b) => nameOf(info, a).localeCompare(nameOf(info, b), ctx.locale));
  const out = [K.bootstrap(ctx)];
  if (info.d.code !== "ready") out.push({ type: "banner", tone: "warning", text: t("tm_not_ready") });
  if (!info.s.fetchHosts.length && rows.some((c) => c.repeat.enabled && used(c.text).includes("urlfetch"))) out.push({ type: "banner", tone: "warning", text: t("tm_urlfetch_off") });
  const writable = can(ctx);
  out.push(...headBlocks(ctx, writable, rows.length), await listBlock(ctx, info, rows, writable));
  if (writable) { const pick = pickBlock(ctx, info); if (pick && rows.length < MAX_REPEATS) out.push(pick); }
  // Les fenêtres : seulement quand l'adresse les demande (`?tab=timers&timerAdd=1`, ou `&edit=…` qui ouvre la commande).
  if (writable && query.timerAdd && rows.length < MAX_REPEATS) out.push(newTimerForm(ctx, info));
  return tab(out);
}

/* ───────────── Actions ───────────── */

const NAME_ERRORS = new Set(["name", "alias", "collision"]);
const fail = (ctx, r) => {
  const field = NAME_ERRORS.has(r.code) ? "name" : String(r.code).startsWith("text_") ? "text" : r.code === "timer_minutes" ? "repeatEvery" : null;
  return field ? { errors: { [field]: saveError(ctx, r) } } : { error: saveError(ctx, r) };
};
const envOf = (ctx, info) => info.env;

export const actions = {
  /** « Créer la commande et son timer » : une commande à vous (ou réservée au timer) qui se répète déjà. Un succès ferme la fenêtre ; le tableau montre la nouvelle ligne. */
  timerNew: run(async (ctx, x) => {
    const A = await import(`./admin.mjs${v}`);
    const info = await A.context(ctx, { declare: false });
    const raw = x.repeatEvery === undefined || x.repeatEvery === "" ? 900 : Number(x.repeatEvery);
    const minutes = raw / 60;
    if (!Number.isInteger(minutes)) return fail(ctx, { code: "timer_minutes" });
    const r = await saveCommand(ctx, { kind: "custom" }, { name: x.name, text: x.text, role: "everyone", enabled: true, timerOnly: x.timerOnly === "on", repeat: { minutes, lines: DEFAULT_LINES, when: "live", enabled: true } }, envOf(ctx, info));
    return r.ok === false ? fail(ctx, r) : { ok: ctx.t("tm_created") };
  }),
  /** L'interrupteur de la liste DIT l'état voulu (`enabled` : « 1 » ou « 0 »). Sans `enabled` (ancien appel), l'état est inversé. */
  timerToggle: run(async (ctx, x) => {
    const A = await import(`./admin.mjs${v}`);
    const info = await A.context(ctx, { declare: false });
    const cur = info.list.find((y) => y.key === x.id && y.repeat);
    if (!cur) return { error: ctx.t("err_unknown") };
    const want = x.enabled === undefined ? cur.repeat.enabled === false : String(x.enabled) === "1";
    const r = await T.setRepeat(ctx, cur, { enabled: want }, info.env);
    return r.ok === false ? fail(ctx, r) : { ok: ctx.t(want ? "tm_on" : "tm_off", { name: nameOf(info, cur) }) };
  }),
  /**
   * « Supprimer le timer » (menu « ⋯ » de la ligne) : la commande reste et la répétition s'en va. Une commande « seulement pour le timer » n'existe que pour lui : elle part avec lui
   * (la confirmation de la ligne le dit). Jamais de passage silencieux dans le chat.
   */
  timerDelete: run(async (ctx, x) => {
    const A = await import(`./admin.mjs${v}`);
    const info = await A.context(ctx, { declare: false });
    const cur = info.list.find((y) => y.key === (x.key ?? x.id) && y.repeat);
    if (!cur) return { error: ctx.t("err_unknown") };
    if (cur.timerOnly && cur.kind === "custom") {
      const gone = await removeCustom(ctx, cur.id);
      return gone.ok === false ? { error: ctx.t("err_unknown") } : { ok: ctx.t("tm_deleted_cmd") };
    }
    const r = await T.setRepeat(ctx, cur, null, info.env);
    return r.ok === false ? fail(ctx, r) : { ok: ctx.t("tm_deleted") };
  }),
  timerSend: run(async (ctx, x) => {
    const r = await T.sendNow(ctx, x.id);
    if (r.ok) return { ok: ctx.t("tm_sent") };
    return { error: ctx.t(`tm_send_${r.code}`) };
  }),
};
