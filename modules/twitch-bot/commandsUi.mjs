// La page « Commandes » : UN tableau du cœur de toutes les commandes (recherche en direct, filtres en pastilles, interrupteur dans la ligne, « Modifier » qui ouvre une FENÊTRE),
// le choix « ajouter une commande pour un partenaire ou un réseau », le formulaire d'une commande (3 champs visibles, le reste sous « Plus d'options ») et le journal.
// Les règles : docs/ERGONOMIE-ADMIN.md (R14 à R17, R30). Seuls le choix « ajouter… » et le journal sont encore du HTML du module (adminkit.mjs) : le cœur n'a pas de bloc « liste
// à choisir » ni de bloc « journal à vider ».
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const K = await import(`./adminkit.mjs${v}`);
const F = await import(`./formsUi.mjs${v}`);
const { roleOptions } = F;
const { reopenLabel, periodField, isoText } = await import(`./period.mjs${v}`);
const MD = await import(`./media.mjs${v}`);
const { shownFor } = await import(`./variables.mjs${v}`);
const W = await import(`./words.mjs${v}`);

const { esc, norm } = K;
const BADGES = { custom: "accent", builtin: "neutral", partner: "ok", network: "warn", timer: "info", word: "info" };   // la couleur ne porte jamais seule l'information : le mot est écrit dans la pastille
const originOf = (c) => (c.kind === "word" ? "word" : c.timerOnly ? "timer" : c.kind === "group" ? "builtin" : c.kind);
/** Où revient la fenêtre quand elle se ferme (et où mènent ses liens) : l'onglet qui l'a ouverte. */
export const tabHref = (tab, query = "") => `?tab=${tab}${query}`;

/** « 1er novembre » (jour et mois seulement) pour la note d'une ligne. */
function shortDate(ctx, n) {
  const text = new Intl.DateTimeFormat(ctx.locale, { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(n.y ?? 2024, n.m - 1, n.d)));
  return String(ctx.locale).startsWith("fr") && n.d === 1 ? text.replace(/^1 /, "1er ") : text;
}
/**
 * La phrase longue de l'état (info-bulle, recherche), la note courte (seulement quand l'état sort de l'ordinaire), le mot de l'état (la pastille de filtre) et `text`, ce que
 * l'interrupteur écrit à côté de lui.
 */
export function stateTexts(ctx, state, why, reopen) {
  const t = ctx.t;
  if (state === "on") return { full: t("state_on"), note: "", word: t("state_on"), text: t("state_on") };
  if (state === "off") return { full: t("state_off"), note: "", word: t("state_off"), text: t("state_off") };
  if (state === "outside") {
    const note = reopen ? t("note_outside", { date: shortDate(ctx, reopen) }) : t("note_ended");
    return { full: reopenLabel(ctx, reopen), note, word: t("state_outside"), text: `${t("state_outside")} · ${note}` };
  }
  return { full: t(`why_${why}`), note: t(`note_${why}`), word: t(state === "missing" ? "state_missing" : "state_hidden"), text: t(`note_${why}`) };
}

const words = (prefix, c) => (c.kind === "word" ? c.words.map((w) => `“${w}”`) : [c.name, ...c.aliases].map((w) => `${prefix}${w}`));
const byName = (ctx) => (a, b) => (a.enabled === b.enabled ? 0 : a.enabled ? -1 : 1) || String(a.name).localeCompare(String(b.name), ctx.locale) || (a.key < b.key ? -1 : 1);

/* ───────────── Le tableau ───────────── */

/** Une ligne : [nom, réponse, origine (pastille écrite), état (interrupteur)]. Une source disparue n'a pas d'interrupteur : seulement son état écrit. */
function commandRow(ctx, info, c) {
  const t = ctx.t, p = info.s.prefix, origin = originOf(c);
  const onState = c.kind === "partner" || c.kind === "network" ? (c.missing ? c.state : c.onState ?? "on") : c.onState ?? "on";
  const cur = stateTexts(ctx, c.state, c.why, c.reopen);
  const would = c.missing ? cur : stateTexts(ctx, onState, c.onWhy, c.onReopen);
  const [first0, ...others0] = words(p, c);
  const first = c.timerOnly ? (c.title || first0) : first0, others = c.timerOnly ? [] : others0;   // une commande réservée au timer n'a pas de mot à taper : on montre son titre
  const role = c.role === "everyone" || c.timerOnly ? "" : t(`role_${c.role}`);
  const inside = c.kind === "word" && c.mode === "contains" ? t("word_inside") : "";   // the usual mode (a whole word) is never repeated (R14)
  const name = `${[first, ...others].join(" · ")}${[role, inside].filter(Boolean).length ? ` (${[role, inside].filter(Boolean).join(", ")})` : ""}`;   // le rôle par défaut n'est jamais répété (R14) ; la recherche trouve aussi les autres noms
  const state = c.missing
    ? { text: cur.word, title: cur.full }
    : { text: cur.word, title: cur.full, switch: { on: c.enabled, action: "toggle", label: c.kind === "word" ? t("sw_label_word", { word: first }) : t("sw_label", { command: first }), onText: (c.enabled ? cur : would).text, offText: t("state_off") } };
  const shows = c.media ? t("row_media", { name: MD.nameOf(c.media, info.lib ?? { items: [] }) }) : "";   // what it also puts on screen: only when it does (R14)
  const answer = [c.text, shows].filter(Boolean).join(" · ");
  return [{ text: name, title: `${words(p, c).join("  ")}${role ? `  (${role})` : ""}` }, { text: answer, title: answer }, { text: t(`origin_${origin}`), badge: BADGES[origin] }, state];
}

/**
 * UN tableau pour toutes les commandes (R30) : la colonne d'origine, la recherche, les pastilles d'origine et d'état, l'interrupteur dans la ligne. « Modifier » ouvre la fenêtre
 * (`presentation: "dialog"`) ; « Supprimer » est dans le menu « ⋯ », avec ce qui sera perdu (la fenêtre n'a pas de bouton destructif).
 */
export function commandsTable(ctx, info) {
  const t = ctx.t, list = [...info.list, ...(info.words ?? [])].sort(byName(ctx));
  return {
    type: "table", columns: [t("col_command"), t("col_answer"), t("col_origin"), t("col_active")], rowIds: list.map((c) => c.key),
    searchable: true, searchPlaceholder: t("search_commands"), filters: [{ column: 2, allLabel: t("filter_all") }, { column: 3, allLabel: t("filter_any") }], truncate: [0, 1],
    rows: list.map((c) => commandRow(ctx, info, c)),
    rowActions: [{ label: t("act_edit"), href: `${tabHref("use")}&edit={id}`, presentation: "dialog" }, { label: t("delete_btn"), action: "remove", confirm: t("delete_row_confirm"), danger: true }],
  };
}

/* ───────────── « Ajouter une commande pour un partenaire ou un réseau » ───────────── */

export function addChooser(ctx, info, { partnerHref }) {
  const t = ctx.t, { sources, list, s } = info;
  const known = new Set(list.map((c) => c.key));
  const partners = (sources.partners?.items ?? []).filter((p) => !known.has(`partner:${p.id}`));
  const networks = (sources.networks?.items ?? []).filter((n) => !known.has(`network:${n.key}`));
  if (!partners.length && !networks.length) return null;
  const rows = [
    ...partners.map((p) => ({ origin: "partner", name: p.title, href: partnerHref.replace("{id}", encodeURIComponent(p.id)) })),
    ...networks.map((n) => ({ origin: "network", name: n.label || n.name, href: `${tabHref("use")}&edit=${encodeURIComponent(`network:${n.key}`)}` })),
  ];
  const part = (n, one, many) => (n === 1 ? t(one) : t(many, { n }));
  const bits = [partners.length ? part(partners.length, "add_partners_1", "add_partners_n") : "", networks.length ? part(networks.length, "add_networks_1", "add_networks_n") : ""].filter(Boolean);
  const total = partners.length + networks.length;
  const status = t(total === 1 ? "add_status_one" : "add_status", { list: bits.length === 2 ? t("add_join", { a: bits[0], b: bits[1] }) : bits[0] });
  const body = K.listShell({
    ctx, id: "add", columns: [{ label: t("col_name") }, { label: t("col_origin"), width: "16%" }, { label: t("col_action"), width: "20%", sr: true }],
    rows: rows.map((r) => `<tr ${K.rowAttrs({ origin: r.origin }, `${r.name} ${t(`origin_${r.origin}`)}`)}><td class="c-name"><span class="ck-ell" title="${esc(r.name)}"><span class="ck-name">${esc(r.name)}</span></span></td><td class="c-org">${K.originPill(r.origin, t(`origin_${r.origin}`))}</td><td class="c-act"><div class="ck-acts"><a class="ck-btn small" href="${esc(r.href)}">${esc(t("add_go"))}</a></div></td></tr>`).join(""),
    text: { search: t("search_label"), placeholder: t("search_sources"), empty: t("search_none"), clear: t("search_clear"), count: t("search_count") },
  });
  return { type: "html", html: `<div class="ck"><details class="ck-add"><summary><span class="ck-add-b">${esc(t("add_btn"))}</span><span class="ck-add-s">${esc(status)}</span></summary><div class="ck-add-body">${body}</div></details></div>` };
}

/* ───────────── Le formulaire d'une commande (dans une fenêtre) ───────────── */

/** Le bouton « Nouvelle commande » : un lien qui ouvre la fenêtre (cœur 0.6.7). */
export const newLink = (ctx, { example = false } = {}) => ({ type: "links", items: [{ label: ctx.t("new_open"), href: `${tabHref("use")}&new=1`, presentation: "dialog" }, { label: ctx.t("word_new_open"), href: `${tabHref("use")}&new=word`, presentation: "dialog" }, ...(example ? [{ label: ctx.t("word_ex_btn"), href: `${tabHref("use")}&new=word&example=1`, presentation: "dialog" }] : [])] });   // first time: the window opens with an example already written (R26)

/* ───────────── "On stream": the media of a command or a word (folded fields) ───────────── */

/**
 * Three folded fields: the picture or video, the sound, the seconds. `lib`: the library of the alerts overlay ({ available, items }). Without the overlay one line says so (and nothing is saved from
 * these fields). `m`: the saved choice.
 */
export function mediaFields(ctx, lib, m) {
  const t = ctx.t;
  if (!lib?.available) return [{ name: "mediaVisual", label: t("f_media_visual"), kind: "select", value: "", options: [{ value: "", label: t("media_absent") }], folded: true }];
  const pick = (kinds, id) => {
    const own = lib.items.filter((x) => kinds.includes(x.kind));
    return [{ value: "", label: t("media_nothing") }, ...own.map((x) => ({ value: x.id, label: x.name })), ...(id && !own.some((x) => x.id === id) ? [{ value: id, label: t("media_gone") }] : [])];
  };
  // overlay version 2: one gallery (pictures, GIFs, videos; several at once; up to 12) and the order; the same widget as the reaction window of Twitch activity
  const files = lib.gallery ? [
    { name: "mediaFiles", label: t("f_media_visual"), kind: "gallery", accept: ["image", "video"], max: MD.VISUALS_MAX, help: t("f_media_help"), folded: true,
      value: JSON.stringify((m?.visuals ?? (m?.visual ? [m.visual] : [])).map((id) => lib.items.find((x) => x.id === id)?.url).filter(Boolean).map((src) => ({ src }))),
      library: lib.items.filter((x) => x.url && ["picture", "video"].includes(x.kind)).slice(0, 500).map((x) => ({ label: x.name, value: x.url, kind: x.kind === "video" ? "video" : "image" })) },
    { name: "mediaPick", label: t("f_media_pick"), kind: "segmented", value: m?.pick === "rotate" ? "rotate" : "random", help: t("f_media_pick_help"), options: [{ value: "random", label: t("media_pick_random") }, { value: "rotate", label: t("media_pick_rotate") }], folded: true },
  ] : [{ name: "mediaVisual", label: t("f_media_visual"), kind: "select", value: m?.visual ?? "", options: pick(["picture", "video"], m?.visual), help: t("f_media_help"), folded: true }];
  return [
    ...files,
    { name: "mediaSound", label: t("f_media_sound"), kind: "select", value: m?.sound ?? "", options: pick(["sound"], m?.sound), folded: true },
    { name: "mediaSeconds", label: t("f_media_seconds"), kind: "number", value: m?.seconds ?? "", placeholder: "6", min: MD.SECONDS.min, max: MD.SECONDS.max, step: 1, unit: t("unit_seconds"), help: t("f_media_seconds_help"), folded: true },
  ];
}

/** The button of the window when the alerts overlay is installed but has no copy: one click sets it up (the answer shows beside the buttons, what was typed stays). */
const setUpButton = (ctx, lib) => (lib?.setUp ? { extraActions: [{ label: ctx.t("media_setup_btn"), action: "setUpAlerts" }] } : {});

/**
 * The form of a word, in a window: Words, Reply, Who can trigger it (3 visible). Folded: what it shows on stream, how it matches, the waits, "1 time out of N", collaboration mode.
 * `view`: the trigger (or an empty one); `mode`: "new" | "edit".
 */
export function wordForm(ctx, info, { mode, view, key, tab = "use" }) {
  const t = ctx.t, edit = mode === "edit", s = info.s;
  return {
    type: "adminForm", presentation: "dialog", action: edit ? "saveWord" : "createWord", title: edit ? t("word_edit_title", { word: view.words[0] }) : t("word_new_title"), submitLabel: t(edit ? "word_save_btn" : "word_new_btn"), cancelHref: tabHref(tab),
    ...setUpButton(ctx, info.lib),
    fields: [
      ...(edit ? [{ name: "id", kind: "hidden", label: "id", value: key }] : []),
      { name: "words", label: t("f_words"), value: (view.words ?? []).join(", "), required: true, help: t("f_words_help"), example: t("f_words_example") },
      { name: "text", label: t("f_reply"), kind: "textarea", value: view.text ?? "", help: t("f_reply_help", { vars: shownVars() }), example: t("f_reply_example") },
      { name: "role", label: t("f_role"), kind: "segmented", value: view.role ?? "everyone", options: roleOptions(t).filter((o) => o.value !== "owner") },
      ...mediaFields(ctx, info.lib, view.media),
      { name: "mode", label: t("f_match"), kind: "segmented", value: view.mode === "contains" ? "contains" : "", options: [{ value: "", label: t("f_match_whole") }, { value: "contains", label: t("f_match_inside") }], help: t("f_match_help"), folded: true },
      { name: "cdGlobal", label: t("f_wait_all"), kind: "number", value: view.cdGlobal ?? "", placeholder: String(W.DEFAULTS.cdGlobal), min: 0, max: 3600, step: 1, unit: t("unit_seconds"), help: t("f_cd_help", { n: W.DEFAULTS.cdGlobal }), folded: true },
      { name: "cdUser", label: t("f_wait_user"), kind: "number", value: view.cdUser ?? "", placeholder: String(W.DEFAULTS.cdUser), min: 0, max: 3600, step: 1, unit: t("unit_seconds"), help: t("f_cd_help", { n: W.DEFAULTS.cdUser }), folded: true },
      { name: "chance", label: t("f_chance"), kind: "number", value: view.chance > 1 ? view.chance : "", placeholder: "1", min: 1, max: W.MAX_CHANCE, step: 1, help: t("f_chance_help"), folded: true },
      { name: "collab", label: t("f_collab"), kind: "switch", value: view.collab ? "on" : "", help: t("f_collab_help"), folded: true },
    ],
  };
}
const shownVars = () => shownFor("word").map((x) => `{${x}}`).join(" ");

/**
 * Le formulaire d'une commande, dans une fenêtre (`presentation: "dialog"`). `view` : la commande (ou la proposition) ; `mode` : "new" ou "edit" ; `unsaved` : une proposition pas
 * encore enregistrée (la sauvegarde l'active) ; `tab` : l'onglet où la fenêtre revient en se fermant ; `counter` : combien de fois la commande a servi (si son texte compte) ;
 * `canReset` : un texte d'origine peut être rétabli.
 * Champs visibles : Nom, Ce que le bot répond, Qui peut l'utiliser (3). Sous « Plus d'options » : autres noms, attentes, période, répétition, et (si besoin) le compteur et le texte d'origine.
 */
export function commandForm(ctx, info, { mode, view, key, unsaved = false, kind, repeatIntent = false, tab = "use", counter = null, canReset = false, varsHelp = "" }) {
  const t = ctx.t, s = info.s;
  const timerOnly = view.timerOnly === true;
  const edit = mode === "edit";
  const adding = edit && repeatIntent && !view.repeat;   // venu de « Ajouter ce timer » : la commande n'a pas encore de timer
  const label = view.title || `${s.prefix}${view.name}`;
  const submit = !edit ? "new_btn" : adding ? "rep_add_btn" : tab === "timers" ? "tm_save_btn" : "save_btn";
  const title = !edit ? t(tab === "timers" ? "tm_add_title" : "new_title") : adding ? t("tm_adding_title", { name: label }) : tab === "timers" ? t("tm_edit_title", { name: label }) : t("edit_title", { command: `${s.prefix}${view.name}` });
  return {
    type: "adminForm", presentation: "dialog", action: edit ? "save" : "create", title, submitLabel: t(submit), cancelHref: tabHref(tab), ...(tab !== "use" ? { tab } : {}),
    ...(timerOnly ? {} : setUpButton(ctx, info.lib)),
    fields: [
      ...(edit ? [{ name: "id", kind: "hidden", label: "id", value: key }, { name: "key", kind: "hidden", label: "key", value: key }] : []),
      ...(unsaved ? [{ name: "enabled", kind: "hidden", label: "enabled", value: "on" }] : []),
      { name: "name", label: t("f_name"), value: view.name ?? "", required: true, help: t("f_name_help", { prefix: s.prefix }) },
      { name: "text", label: t("f_text"), kind: "textarea", value: view.text ?? "", required: true, help: varsHelp || t("f_text_help"), example: t("f_text_example") },
      ...(timerOnly ? [] : [{ name: "role", label: t("f_role"), kind: "segmented", value: view.role ?? "everyone", options: roleOptions(t) }]),   // une commande réservée au timer n'a personne à qui la permettre
      ...(timerOnly || !info.lib ? [] : mediaFields(ctx, info.lib, view.media)),
      { name: "aliases", label: t("f_aliases"), value: (view.aliases ?? []).join(", "), help: t("f_aliases_help"), folded: true },
      { name: "cdGlobal", label: t("f_wait_all"), kind: "number", value: view.cdGlobal ?? "", placeholder: String(s.cdGlobal), min: 0, max: 3600, step: 1, unit: t("unit_seconds"), help: t("f_cd_help", { n: s.cdGlobal }), folded: true },
      { name: "cdUser", label: t("f_wait_user"), kind: "number", value: view.cdUser ?? "", placeholder: String(s.cdUser), min: 0, max: 3600, step: 1, unit: t("unit_seconds"), help: t("f_cd_help", { n: s.cdUser }), folded: true },
      { ...periodField(ctx, view.period ?? null, s.timeZone), folded: true },
      ...F.repeatFields(ctx, view, kind, repeatIntent),
      ...(counter !== null ? [{ name: "counterReset", label: t("counter_reset_btn"), kind: "switch", value: "", help: t("edit_counter", { n: counter }), folded: true }] : []),
      ...(canReset ? [{ name: "resetText", label: t("reset_btn"), kind: "switch", value: "", help: t("reset_help"), folded: true }] : []),
    ],
  };
}

/**
 * La commande d'un partenaire se règle dans SA fiche (R30) : la fenêtre le dit dans son titre et son seul bouton y mène. Un tableau du cœur n'a qu'une série d'actions pour toutes
 * les lignes ; en attendant des actions par ligne, « Modifier » d'une ligne de partenaire ouvre cette fenêtre.
 */
export function partnerStub(ctx, info, { view, key, tab = "use" }) {
  const t = ctx.t;
  return { type: "adminForm", presentation: "dialog", action: "openPartner", title: t("edit_partner_title", { command: `${info.s.prefix}${view.name}` }), submitLabel: t("act_open_partner"), cancelHref: tabHref(tab), ...(tab !== "use" ? { tab } : {}),
    fields: [{ name: "id", kind: "hidden", label: "id", value: key }] };
}

/* ───────────── Le journal ───────────── */

export function logBlock(ctx, s, entries) {
  const t = ctx.t;
  const when = (at) => new Date(at).toLocaleTimeString(ctx.locale, { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: s.timeZone });
  const reason = (e) => (e.result === "sent" ? e.text ?? "" : `${e.reason === "outside" ? (e.reopen ? t("per_outside", { date: isoText(ctx, e.reopen) }) : t("per_ended")) : t(`reason_${e.reason}`, { seconds: e.seconds ?? "" })}${e.detail && e.result === "error" ? ` (${K.cut(e.detail, 40)})` : ""}`);
  const rows = entries.map((e) => {
    const cmd = e.command.startsWith("⏱") || e.command.startsWith("💬") ? e.command : `${s.prefix}${e.command}`, what = `${t(`log_${e.result}`)} : ${reason(e)}`;
    return `<tr ${K.rowAttrs({ result: e.result }, `${e.user} ${cmd} ${what}`)}><td class="c-name"><span class="ck-ell">${esc(when(e.at))} · ${esc(e.user)}</span></td><td class="c-ans"><span class="ck-ell ck-name" title="${esc(cmd)}">${esc(cmd)}</span></td><td class="c-extra"><span class="ck-ell" title="${esc(what)}">${esc(what)}</span></td></tr>`;
  }).join("");
  const clear = entries.length ? `<button type="button" class="ck-btn small ck-js" data-ck-act="clearLog" data-ck-confirm="${esc(t("log_clear_confirm", { n: entries.length }))}" data-ck-yes="${esc(t("log_clear"))}" data-ck-no="${esc(t("cancel_btn"))}" data-ck-reload data-ck-fail="${esc(t("err_toggle"))}">${esc(t("log_clear"))}</button>` : "";
  const head = `<div class="ck-head"><h2 class="ck-title">${esc(t("log_title"))}</h2>${clear}</div><p class="ck-intro">${esc(t("log_help"))}</p>`;
  if (!entries.length) return { type: "html", html: `<div class="ck ck-log">${head}<p class="ck-intro">${esc(t("log_empty"))}</p></div>` };
  const sent = entries.filter((e) => e.result === "sent").length;
  return {
    type: "html",
    html: K.listShell({
      ctx, id: "log", className: "ck-log", head,
      columns: [{ label: t("log_time_user"), width: "24%" }, { label: t("col_command"), width: "20%" }, { label: t("log_why") }],
      rows,
      pills: [{ key: "result", label: t("log_filter"), items: [{ val: "all", label: t("filter_all"), count: entries.length }, { val: "sent", label: t("log_sent"), count: sent }, { val: "not", label: t("log_not_sent"), count: entries.length - sent }] }],
      groups: { result: { not: ["refused", "error"] } },
      text: { search: t("search_label"), placeholder: t("search_log"), empty: t("search_none"), clear: t("search_clear"), count: t("search_count") },
    }),
  };
}

export { norm };
