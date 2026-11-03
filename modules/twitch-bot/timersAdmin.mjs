// L'onglet « Timers » : les commandes que le bot répète tout seul dans le chat. Un timer n'est plus un objet à part : c'est le réglage « Répéter automatiquement » d'une commande
// (voir timers.mjs). La page : UN tableau des commandes qui se répètent (recherche en direct, filtres, interrupteur dans la ligne), et « Ajouter un timer », qui propose deux voies :
// choisir une commande qui existe, ou en créer une nouvelle (deux champs). Le bot n'a aucun minuteur : il ne regarde ses répétitions qu'à l'arrivée d'un message du chat.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const T = await import(`./timers.mjs${v}`);
const { saveCommand, MAX_REPEATS, REPEAT_LIMITS } = await import(`./commands.mjs${v}`);
const { saveError } = await import(`./errors.mjs${v}`);
const { used } = await import(`./variables.mjs${v}`);
const { settingsOf } = await import(`./settings.mjs${v}`);
const K = await import(`./adminkit.mjs${v}`);
const CU = await import(`./commandsUi.mjs${v}`);

const { esc } = K;
const tab = (blocks) => blocks.map((b) => ({ ...b, tab: "timers" }));
const can = (ctx) => typeof ctx.can === "function" && ctx.can("timers.manage") === true;
const run = (fn) => ({ right: "timers.manage", run: fn });
const ADD = { type: "html", html: '<div id="add" style="scroll-margin-top:5rem"></div>' };
const DEFAULT_LINES = 5;
/** Le lien « Modifier » : la page de la commande, ouverte sur son bloc « Répéter automatiquement ». */
export const editHref = (key) => `?tab=use&edit=${encodeURIComponent(key)}&repeat=1#edit`;

/** Le rythme en mots (« toutes les 15 min ») et ce qui sort de l'ordinaire (R14) : hors direct aussi, ou un minimum de messages autre que 5. */
function rhythm(t, r) {
  const every = r.minutes % 60 === 0 && r.minutes >= 60 ? t("rep_every_h", { h: r.minutes / 60 }) : t("rep_every_m", { min: r.minutes });
  const notes = [];
  if (r.when === "always") notes.push(t("rep_note_always"));
  if (r.lines !== DEFAULT_LINES) notes.push(r.lines === 0 ? t("rep_note_nolines") : t("rep_note_lines", { n: r.lines }));
  return { every, note: notes.join(" · ") };
}

/** L'état d'une répétition : { state: "on" | "off" | "outside", full (info-bulle), note (sous l'interrupteur, seulement si ça sort de l'ordinaire), word }. */
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

async function listBlock(ctx, info, rows, writable) {
  const t = ctx.t;
  const states = await Promise.all(rows.map((c) => stateOf(ctx, c)));
  const html = rows.map((c, i) => {
    const st = states[i], r = rhythm(t, c.repeat), name = nameOf(info, c);
    const pill = c.timerOnly ? ` ${K.originPill("timer", t("pill_timer_only"))}` : "";
    const action = writable ? `<a class="ck-btn small" href="${esc(editHref(c.key))}">${esc(t("act_edit"))}</a><button type="button" class="ck-btn small ck-js" data-ck-act="timerSend" data-ck-id="${esc(c.key)}" data-ck-confirm="${esc(t("tm_send_confirm"))}" data-ck-yes="${esc(t("tm_send_btn"))}" data-ck-no="${esc(t("cancel_btn"))}" data-ck-fail="${esc(t("err_toggle"))}">${esc(t("tm_send_btn"))}</button>` : "";
    return `<tr ${K.rowAttrs({ state: st.state, origin: c.timerOnly ? "timer" : "cmd" }, `${name} ${c.name} ${c.text} ${r.every} ${r.note} ${st.word} ${st.full} ${c.timerOnly ? t("pill_timer_only") : ""}`)}>
<td class="c-name"><span class="ck-ell" title="${esc(name)}"><span class="ck-name">${esc(name)}</span>${pill}</span></td>
<td class="c-ans"><span class="ck-ell" title="${esc(c.text)}">${esc(c.text)}</span></td>
<td class="c-org"><span class="ck-ell" title="${esc(`${r.every}${r.note ? ` · ${r.note}` : ""}`)}">${esc(r.every)}${r.note ? ` <span class="ck-alias">${esc(r.note)}</span>` : ""}</span></td>
<td class="c-sw">${K.switchHtml({ id: c.key, on: c.repeat.enabled !== false, label: t("sw_label_timer", { name }), act: "timerToggle", disabled: !writable, fail: t("err_toggle") }).replace("data-ck-switch", "data-ck-switch data-ck-reload")}<span class="ck-note" data-ck-note title="${esc(st.full)}"${st.note ? "" : " hidden"}>${esc(st.note)}</span></td>
<td class="c-act"><div class="ck-acts">${action}</div></td></tr>`;
  }).join("");
  const count = (s) => states.filter((x) => x.state === s).length;
  const items = [["on", "tm_filter_on"], ["off", "tm_filter_off"], ["outside", "tm_filter_outside"]].map(([val, key]) => ({ val, label: t(key), count: count(val) })).filter((x) => x.count > 0);
  return { type: "html", html: K.listShell({
    ctx, id: "timers", head: head(ctx, writable, rows.length),
    columns: [{ label: t("col_command"), width: "21%" }, { label: t("col_answer") }, { label: t("tm_col_rhythm"), width: "19%" }, { label: t("col_active"), width: "20%" }, { label: t("col_action"), width: "22%", sr: true }],
    rows: html,
    pills: [{ key: "state", label: t("filter_state"), items: [{ val: "all", label: t("filter_any"), count: rows.length }, ...items] }],
    text: { search: t("search_label"), placeholder: t("search_timers"), empty: t("search_none"), clear: t("search_clear"), count: t("search_count") },
  }) };
}

/** Le haut de la page : le titre, UNE phrase qui dit à quoi elle sert (R1) et « Ajouter un timer » (le seul bouton principal). */
function head(ctx, writable, n) {
  const t = ctx.t;
  const add = writable && n < MAX_REPEATS ? `<a class="ck-btn primary" href="?tab=timers&timerAdd=1#add">${esc(t("tm_new_open"))}</a>` : "";
  return `<div class="ck-head"><h2 class="ck-title">${esc(t("tm_title"))}</h2>${add}</div><p class="ck-intro">${esc(t("tm_intro"))}</p>${writable && n >= MAX_REPEATS ? `<p class="ck-intro">${esc(t("tm_full", { max: MAX_REPEATS }))}</p>` : ""}`;
}

/* ───────────── « Ajouter un timer » : choisir une commande OU en créer une ───────────── */

function chooser(ctx, info) {
  const t = ctx.t;
  const cands = info.list.filter((c) => !c.repeat && !c.missing && c.kind !== "partner");
  const rows = cands.map((c) => {
    const first = `${info.s.prefix}${c.name}`, origin = c.kind === "group" ? "builtin" : c.kind;
    return `<tr ${K.rowAttrs({ origin }, `${first} ${c.aliases.join(" ")} ${c.text} ${t(`origin_${origin}`)}`)}><td class="c-name"><span class="ck-ell" title="${esc(first)}"><span class="ck-name">${esc(first)}</span></span></td><td class="c-ans"><span class="ck-ell" title="${esc(c.text)}">${esc(c.text)}</span></td><td class="c-org">${K.originPill(origin, t(`origin_${origin}`))}</td><td class="c-act"><div class="ck-acts"><a class="ck-btn small" href="${esc(editHref(c.key))}">${esc(t("tm_pick_btn"))}</a></div></td></tr>`;
  }).join("");
  return [
    ADD,
    { type: "heading", text: t("tm_add_title") },
    { type: "markdown", text: t("tm_add_intro") },
    { type: "html", html: `<div class="ck"><p class="ck-intro"><b>${esc(t("tm_route_pick"))}</b></p></div>` },
    { type: "html", html: K.listShell({
      ctx, id: "timer-pick", columns: [{ label: t("col_command"), width: "22%" }, { label: t("col_answer") }, { label: t("col_origin"), width: "13%" }, { label: t("col_action"), width: "22%", sr: true }],
      rows, text: { search: t("search_label"), placeholder: t("search_commands"), empty: t("search_none"), clear: t("search_clear"), count: t("search_count") },
    }) },
    { type: "html", html: `<div class="ck"><p class="ck-intro"><b>${esc(t("tm_route_new"))}</b></p></div>` },
    { type: "adminForm", action: "timerNew", submitLabel: t("tm_new_btn"), cancelHref: "?tab=timers", fields: [
      { name: "name", label: t("tm_n_name"), required: true, example: t("tm_n_name_example"), help: t("tm_n_name_help", { prefix: info.s.prefix }) },
      { name: "text", label: t("tm_n_text"), kind: "textarea", required: true, example: t("tm_n_text_example") },
      { name: "timerOnly", label: t("f_timer_only"), kind: "switch", value: "", folded: true, help: t("f_timer_only_help") },
      { name: "repeatEvery", label: t("rep_every"), kind: "duration", min: 60, max: REPEAT_LIMITS.minutes * 60, value: 900, folded: true, example: t("rep_every_example") },
    ] },
  ];
}

function emptyBlock(ctx, writable) {
  const t = ctx.t;
  return { type: "html", html: `<div class="ck"><div class="ck-head"><h2 class="ck-title">${esc(t("tm_title"))}</h2>${writable ? `<a class="ck-btn primary" href="?tab=timers&timerAdd=1#add">${esc(t("tm_new_open"))}</a>` : ""}</div><p class="ck-intro">${esc(t("tm_intro"))}</p><div class="ck-empty"><p>${esc(t("tm_empty"))}</p></div></div>` };
}

export async function blocks(ctx, info, query = {}) {
  const t = ctx.t;
  const rows = info.list.filter((c) => c.repeat).sort((a, b) => nameOf(info, a).localeCompare(nameOf(info, b), ctx.locale));
  const out = [K.bootstrap(ctx)];
  if (info.d.code !== "ready") out.push({ type: "banner", tone: "warning", text: t("tm_not_ready") });
  if (!info.s.fetchHosts.length && rows.some((c) => c.repeat.enabled && used(c.text).includes("urlfetch"))) out.push({ type: "banner", tone: "warning", text: t("tm_urlfetch_off") });
  const writable = can(ctx);
  if (writable && query.timerAdd && rows.length < MAX_REPEATS) out.push(...chooser(ctx, info));
  if (!rows.length) out.push(emptyBlock(ctx, writable && !query.timerAdd));
  else out.push(await listBlock(ctx, info, rows, writable));
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
  /** « Créer la commande et son timer » : une commande à vous (ou réservée au timer) qui se répète déjà, puis sa page ouverte sur le bloc « Répéter automatiquement ». */
  timerNew: run(async (ctx, x) => {
    const A = await import(`./admin.mjs${v}`);
    const info = await A.context(ctx, { declare: false });
    const raw = x.repeatEvery === undefined || x.repeatEvery === "" ? 900 : Number(x.repeatEvery);
    const minutes = raw / 60;
    if (!Number.isInteger(minutes)) return fail(ctx, { code: "timer_minutes" });
    const r = await saveCommand(ctx, { kind: "custom" }, { name: x.name, text: x.text, role: "everyone", enabled: true, timerOnly: x.timerOnly === "on", repeat: { minutes, lines: DEFAULT_LINES, when: "live", enabled: true } }, envOf(ctx, info));
    return r.ok === false ? fail(ctx, r) : { ok: ctx.t("tm_created"), redirect: editHref(r.key) };
  }),
  timerToggle: run(async (ctx, x) => {
    const A = await import(`./admin.mjs${v}`);
    const info = await A.context(ctx, { declare: false });
    const cur = info.list.find((y) => y.key === x.id && y.repeat);
    if (!cur) return { error: ctx.t("err_unknown") };
    const r = await T.setRepeat(ctx, cur, { enabled: cur.repeat.enabled === false }, info.env);
    return r.ok === false ? fail(ctx, r) : { ok: ctx.t(cur.repeat.enabled === false ? "tm_on" : "tm_off", { name: nameOf(info, cur) }) };
  }),
  /** Retire la répétition d'une commande ordinaire ; la commande reste. Une commande « seulement pour le timer » passe par ses deux choix (timerKeep ou la suppression). */
  timerRemove: run(async (ctx, x) => {
    const A = await import(`./admin.mjs${v}`);
    const info = await A.context(ctx, { declare: false });
    const cur = info.list.find((y) => y.key === (x.key ?? x.id) && y.repeat);
    if (!cur) return { error: ctx.t("err_unknown") };
    if (cur.timerOnly) return { error: ctx.t("rep_choose") };   // deux choix explicites sur sa page : la supprimer, ou la garder comme commande du chat
    const r = await T.setRepeat(ctx, cur, null, info.env);
    return r.ok === false ? fail(ctx, r) : { ok: ctx.t("tm_deleted"), redirect: `?tab=use&edit=${encodeURIComponent(cur.key)}#edit` };
  }),
  /** « La garder comme commande du chat » (choix explicite et confirmé) : le timer est retiré et la commande devient utilisable dans le chat, par ceux que son rôle permet. */
  timerKeep: run(async (ctx, x) => {
    const A = await import(`./admin.mjs${v}`);
    const info = await A.context(ctx, { declare: false });
    const cur = info.list.find((y) => y.key === (x.key ?? x.id) && y.repeat && y.timerOnly);
    if (!cur) return { error: ctx.t("err_unknown") };
    const r = await saveCommand(ctx, { kind: "custom", id: cur.id }, { repeat: null, timerOnly: false }, info.env);
    return r.ok === false ? fail(ctx, r) : { ok: ctx.t("rep_kept"), redirect: `?tab=use&edit=${encodeURIComponent(cur.key)}#edit` };
  }),
  timerSend: run(async (ctx, x) => {
    const r = await T.sendNow(ctx, x.id);
    if (r.ok) return { ok: ctx.t("tm_sent") };
    return { error: ctx.t(`tm_send_${r.code}`) };
  }),
};
