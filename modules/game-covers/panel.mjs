// L'administration du module, en deux onglets :
//   « Jaquettes à vérifier » (onglet `use`)   l'état des sources en une phrase (« RAWG : pas de code — Twitch : connecté ✓ — Steam : actif ✓ », jamais une clé), puis les titres dont le jeu trouvé est douteux ;
//   « Jaquettes gardées » (onglet `saved`)    UN tableau de tout ce que le site retient (corrigées, trouvées toutes seules, sans jaquette), avec la source et une vignette de la copie gardée sur le site,
//                                             « Chercher une jaquette » (toutes les sources), « Voir », « Changer », « Oublier ».
// Écrans : `?titre=<titre demandé>` « Quel est le bon jeu ? » (adresse stable : les modules qui affichent « Ce n'est pas le bon jeu ? » y renvoient), `&q=<autre recherche>`,
// `?voir=<titre>` (la jaquette retenue) et `?oublier=<titre>` (confirmation). `&tab=saved` garde la personne dans l'onglet d'où elle vient.
// Mobile d'abord : des blocs simples (titres, tableaux, formulaires) que le cœur met en page ; les jaquettes sont des images fixes, sans défilement.
const q = new URL(import.meta.url).search;
const { titleKey } = await import(new URL("./match.mjs" + q, import.meta.url).href);
const fx = await import(new URL("./fixes.mjs" + q, import.meta.url).href);
const rawg = await import(new URL("./rawg.mjs" + q, import.meta.url).href);
const ops = await import(new URL("./ops.mjs" + q, import.meta.url).href);
const hosts = await import(new URL("./hosts.mjs" + q, import.meta.url).href);
const chain = await import(new URL("./chain.mjs" + q, import.meta.url).href);
const srcs = await import(new URL("./sources.mjs" + q, import.meta.url).href);
const copies = await import(new URL("./copies.mjs" + q, import.meta.url).href);
const { COL } = fx;

const SAVED_TAB = "saved";
const SAVED = new Set(["game", "none", "confirm", "forgot", "tested"]);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const one = (v) => (Array.isArray(v) ? v[0] : v);
/** Un texte de Markdown : les signes qui casseraient un lien ou une liste sont protégés. */
const escMd = (s) => String(s ?? "").replace(/([\\`*_[\]<>])/g, "\\$1");
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const day = (ctx, iso) => { try { return new Date(iso).toLocaleDateString(ctx.locale, { day: "numeric", month: "long", year: "numeric" }); } catch { return String(iso).slice(0, 10); } };
const when = (ctx, iso) => { try { return new Date(iso).toLocaleString(ctx.locale); } catch { return String(iso).slice(0, 16).replace("T", " "); } };

/** Une jaquette : image fixe, avec un texte vide (le nom du jeu est juste à côté). */
const coverImg = (url, cls = "h-24 w-[4.5rem]") => url
  ? `<img src="${esc(url)}" alt="" width="72" height="96" loading="lazy" decoding="async" referrerpolicy="no-referrer" class="${cls} shrink-0 rounded-lg border border-line bg-bg object-cover">`
  : `<div aria-hidden="true" class="${cls} shrink-0 rounded-lg border border-dashed border-line bg-bg"></div>`;

/** Le texte du choix gardé : « Aucune jaquette », « Image choisie à la main » ou le nom du jeu. */
const choiceText = (ctx, f) => (f.kind === "none" ? ctx.t("kept_none") : f.kind === "image" ? ctx.t("kept_image") : f.name || ctx.t("kept_game"));

/** Les blocs d'un onglet : le cœur range chaque bloc dans l'onglet qui porte son nom (`use` quand rien n'est dit). */
const tagged = (blocks, tab) => blocks.map((b) => ({ ...b, tab }));
/** Le début de l'adresse qui garde l'onglet : « ?tab=saved& » dans l'onglet des jaquettes enregistrées, « ? » ailleurs. */
const href = (tab, rest = "") => (tab === SAVED_TAB ? `?tab=${SAVED_TAB}${rest ? `&${rest}` : ""}` : `?${rest}`);

export async function render(ctx, { query } = {}) {
  const tab = one(query?.tab) === SAVED_TAB ? SAVED_TAB : "use";
  const asked = String(one(query?.titre) ?? "");
  const title = asked ? ops.checkTitle(asked) : null;
  const saved = SAVED.has(String(one(query?.saved) ?? "")) ? String(one(query.saved)) : "";
  const out = [];
  if (saved) out.push({ type: "banner", tone: "success", text: ctx.t(`saved_${saved}`) });
  if (asked && !title) out.push({ type: "banner", tone: "warning", text: ctx.t("err_title") });
  if (title) return tagged([...out, ...(await fixScreen(ctx, title, String(one(query?.q) ?? "").slice(0, 400), tab))], tab);
  const view = String(one(query?.voir) ?? "");
  const forgetAsk = String(one(query?.oublier) ?? "");
  if (view || forgetAsk) return tagged([...out, ...(await entryScreen(ctx, view || forgetAsk, forgetAsk ? "forget" : "view"))], SAVED_TAB);
  return [...tagged(out, tab), ...tagged(await listScreen(ctx), "use"), ...tagged(await savedScreen(ctx), SAVED_TAB)];
}

// ── La liste : clé, jaquettes à vérifier, choix gardés ─────────────────────────────────────────────────────────────────────
const SRC_NAME = { rawg: "RAWG", twitch: "Twitch", steam: "Steam" };
const SRC_TONE = { rawg: "accent", twitch: "info", steam: "neutral" };
const srcName = (src) => SRC_NAME[src] ?? SRC_NAME.rawg;

/** Où en est chaque source, en mots simples : [{ source, on, down, text }] (RAWG sans code ou Twitch non connecté ne sont PAS des erreurs : une source de moins). */
async function sourceStates(ctx) {
  const rawgState = await rawg.readState(ctx);
  const out = [];
  for (let a of await chain.availableSources(ctx)) {
    const name = SRC_NAME[a.source];
    if (a.source === "rawg" && a.on && rawgState?.state === "refused") a = { ...a, on: false, why: "refused" };   // le dernier essai a été refusé : une source de moins, dite en mots simples
    const down = a.on && (srcs.breakerOf(a.source)?.open === true || (a.source === "rawg" && rawgState?.state === "unreachable"));
    let word;
    if (!a.on) word = a.source === "rawg" ? (a.why === "refused" ? ctx.t("src_refused") : ctx.t("src_nokey")) : a.source === "twitch" ? ctx.t("src_twitch_off") : ctx.t("src_off");
    else word = down ? ctx.t("src_down") : a.source === "twitch" ? ctx.t("src_connected") : ctx.t("src_active");
    out.push({ source: a.source, on: a.on, down, text: `${name} : ${word}` });
  }
  return out;
}

/** L'état des sources en une phrase : toutes les sources disponibles répondent, ou aucune ne répond (les jaquettes déjà gardées restent affichées). `short` : seulement un souci. */
async function statusBlocks(ctx, { short = false } = {}) {
  const states = await sourceStates(ctx);
  const on = states.filter((s) => s.on);
  const line = { type: "markdown", text: ctx.t("sources_line", { list: states.map((s) => s.text).join(" — ") }) };
  if (!on.length) return [{ type: "banner", tone: "warning", text: ctx.t("none_available") }, line];
  if (on.every((s) => s.down)) return [{ type: "banner", tone: "warning", text: ctx.t("outage") }, { type: "markdown", text: ctx.t("outage_saved") }, ...(short ? [] : [line])];
  if (short) return [line];
  const last = await fx.latestAuto(ctx);
  return [{ type: "banner", tone: "success", text: ctx.t("all_fine") }, line, ...(last ? [{ type: "markdown", text: ctx.t("last_found", { source: srcName(last.src), date: when(ctx, last.at) }) }] : [])];
}

async function keyBlocks(ctx) {
  const { key, source } = await rawg.keyOf(ctx);
  const blocks = [{ type: "heading", text: ctx.t("sources_title") }, ...(await statusBlocks(ctx))];
  if (!key) blocks.push({ type: "markdown", text: ctx.t("guide") });
  if (key && source === "adopted") blocks.push({ type: "markdown", text: ctx.t("key_adopted") }, { type: "adminForm", action: "forgetKey", submitLabel: ctx.t("forget_key"), fields: [] });
  if (key) blocks.push({ type: "adminForm", action: "testKey", submitLabel: ctx.t("test_key"), fields: [] });
  blocks.push({ type: "netHealth", items: [{ host: "api.rawg.io", label: ctx.t("health_label") }, { host: "store.steampowered.com", label: ctx.t("health_label_steam") }] });
  return blocks;
}

async function listScreen(ctx) {
  const out = [...(await keyBlocks(ctx))];

  const todo = await fx.readToCheck(ctx);
  out.push({ type: "heading", text: ctx.t("todo_title") }, { type: "markdown", text: ctx.t("todo_intro") });
  if (!todo.length) out.push({ type: "markdown", text: ctx.t("todo_empty") });
  else {
    const shown = todo.slice(0, 25);
    out.push({
      type: "table", columns: [ctx.t("col_asked"), ctx.t("col_found"), ctx.t("col_source"), ctx.t("col_seen")], searchable: true, searchPlaceholder: ctx.t("search_list"), truncate: [0, 1],
      rows: shown.map((d) => [d.title, d.name, { text: srcName(d.src), badge: SRC_TONE[d.src ?? "rawg"] }, day(ctx, d.at)]), rowIds: shown.map((d) => d.title),
      rowActions: [{ label: ctx.t("act_fix"), href: "?titre={id}" }, { label: ctx.t("act_good"), action: "confirm" }],
    });
    if (todo.length > shown.length) out.push({ type: "markdown", text: ctx.t("todo_more", { count: todo.length - shown.length }) });
  }
  return out;
}

// ── Jaquettes gardées : UN tableau (corrigées, automatiques, sans jaquette) ─────────────────────────────────────────────
/** Une date lisible ; « — » quand le module ne la connaît pas (correction reprise d'un ancien réglage). */
const dayOrDash = (ctx, iso) => (Date.parse(iso) > 0 ? day(ctx, iso) : "—");
const ORIGIN_TONE = { corrected: "accent", auto: "info", none: "neutral" };
const originText = (ctx, e) => ctx.t(`origin_${e.origin}`);
/** Le nom de ce qui est retenu, en mots simples. */
const coverText = (ctx, e) => (e.origin === "none" ? "—" : e.kind === "image" ? ctx.t("kept_image") : e.name || ctx.t("kept_game"));

async function savedScreen(ctx) {
  const entries = await fx.savedEntries(ctx);
  const kept = await copies.allMeta(ctx);
  const out = [{ type: "markdown", text: ctx.t("saved_intro") }, ...(await statusBlocks(ctx, { short: true }))];
  out.push({
    type: "adminForm", action: "find", submitLabel: ctx.t("find_button"),
    fields: [{ name: "q", label: ctx.t("find_label"), required: true, example: ctx.t("find_example"), help: ctx.t("find_help") }],
  });
  // La vignette est la COPIE gardée sur le site (une page du site, jamais une adresse d'une source) ; sans copie, le texte seul.
  const thumb = (e) => {
    const id = copies.idOf(e.key);
    const m = kept.get(id);
    const text = coverText(ctx, e);
    return m && m.img === e.img && m.src === (e.src ?? "rawg") ? { text, image: { src: `/m/${ctx.instance.key}/cover/${id}`, alt: e.title } } : text;
  };
  out.push({
    type: "table", columns: [ctx.t("col_game"), ctx.t("col_cover"), ctx.t("col_source"), ctx.t("col_origin"), ctx.t("col_when")],
    searchable: true, searchPlaceholder: ctx.t("search_list"), filters: [{ column: 2, allLabel: ctx.t("filter_all") }, { column: 3, allLabel: ctx.t("filter_all") }], truncate: [0, 1], pageSize: 50,
    empty: ctx.t("saved_empty"),
    rows: entries.map((e) => [e.title, thumb(e), e.origin === "none" ? "—" : { text: srcName(e.src), badge: SRC_TONE[e.src ?? "rawg"] }, { text: originText(ctx, e), badge: ORIGIN_TONE[e.origin] }, dayOrDash(ctx, e.at)]),
    rowIds: entries.map((e) => e.title),
    rowActions: [
      { label: ctx.t("act_view"), href: `?tab=${SAVED_TAB}&voir={id}` },
      { label: ctx.t("act_change"), href: `?tab=${SAVED_TAB}&titre={id}` },
      { label: ctx.t("act_forget_cover"), href: `?tab=${SAVED_TAB}&oublier={id}`, danger: true },
    ],
  });
  const corrections = entries.filter((e) => e.origin !== "auto").length;
  if (corrections > 0) {
    out.push({
      type: "adminForm", action: "forgetAll", submitLabel: ctx.t("forget_all"),
      fields: [{ name: "confirm", kind: "checkbox", label: ctx.t("forget_all_confirm", { count: corrections }), required: true }],
    });
  }
  return out;
}

/** L'image à montrer à la personne qui administre : la copie gardée sur le site si elle existe, sinon l'adresse de la source (jamais montrée au public). */
async function shownUrl(ctx, e) {
  if (!e.img) return null;
  const src = e.src ?? "rawg";
  const m = (await copies.allMeta(ctx)).get(copies.idOf(e.key ?? titleKey(e.title)));
  return m && m.img === e.img && m.src === src ? `/m/${ctx.instance.key}/cover/${m.id}` : fx.imgUrl(src, e.img);
}

/** « Voir » et « Oublier » : une jaquette retenue, en grand ; pour l'oubli, la phrase qui dit ce qui sera perdu. */
async function entryScreen(ctx, rawTitle, mode) {
  const title = ops.checkTitle(rawTitle);
  const key = title ? titleKey(title) : "";
  const entry = key ? await fx.entryFor(ctx, title) : null;
  const back = { type: "markdown", text: `[${ctx.t("back_saved")}](?tab=${SAVED_TAB})` };
  if (!entry) return [back, { type: "banner", tone: "warning", text: ctx.t(title ? "forget_gone" : "err_title") }];
  const card = { type: "html", html: `<section class="rounded-2xl border border-line bg-surface p-5" data-testid="entry"><div class="flex items-center gap-4">${coverImg(await shownUrl(ctx, entry))}` +
    `<div class="min-w-0 space-y-1"><p class="text-xl font-semibold break-words" data-testid="asked">${esc(entry.title)}</p><p class="text-sm break-words">${esc(coverText(ctx, entry))}</p>` +
    `<p><span class="inline-flex items-center rounded-full border border-line px-2.5 py-0.5 text-xs font-medium">${esc(originText(ctx, entry))}</span>${entry.img ? ` <span class="inline-flex items-center rounded-full border border-line px-2.5 py-0.5 text-xs font-medium" data-testid="source">${esc(srcName(entry.src))}</span>` : ""}</p>` +
    `<p class="text-sm text-muted">${esc(ctx.t(entry.origin === "auto" ? "view_seen" : "view_saved", { date: dayOrDash(ctx, entry.at) }))}</p></div></div></section>` };
  if (mode === "view") {
    return [back, { type: "heading", text: ctx.t("view_title") }, card, { type: "links", items: [
      { label: ctx.t("act_change"), href: `?tab=${SAVED_TAB}&titre=${enc(entry.title)}` },
      { label: ctx.t("act_forget_cover"), href: `?tab=${SAVED_TAB}&oublier=${enc(entry.title)}` },
    ] }];
  }
  return [back, { type: "heading", text: ctx.t("forget_title") }, card,
    { type: "markdown", text: ctx.t("forget_msg", { title: escMd(entry.title) }) },
    { type: "adminForm", action: "forget", submitLabel: ctx.t("forget_button"), fields: [{ name: "id", kind: "hidden", value: entry.title }] },
    { type: "markdown", text: `[${ctx.t("forget_keep")}](?tab=${SAVED_TAB})` }];
}

// ── « Quel est le bon jeu ? » ─────────────────────────────────────────────────────────────────────────────────────────────
async function fixScreen(ctx, title, search, tab) {
  const key = titleKey(title);
  const tabField = { name: "tab", kind: "hidden", value: tab };
  const saved = await fx.fixFor(ctx, title);
  const doubtful = (await fx.readToCheck(ctx)).find((d) => d.key === key);
  const auto = saved || doubtful ? null : await fx.autoFor(ctx, title);
  const anySource = (await chain.availableSources(ctx)).some((a) => a.on);
  const tooLong = search.trim().length > 100;
  const list = anySource && !tooLong ? await ops.candidatesFor(ctx, "admin", title, search.trim() || undefined) : null;
  const current = saved
    ? { url: saved.img ? fx.imgUrl(saved.src ?? "rawg", saved.img) : null, label: choiceText(ctx, saved), id: saved.srcId ?? saved.rawgId, source: saved.src ?? "rawg", isSaved: true }
    : doubtful ? { url: fx.imgUrl(doubtful.src ?? "rawg", doubtful.img), label: doubtful.name, id: doubtful.srcId ?? doubtful.rawgId, source: doubtful.src ?? "rawg", isSaved: false }
      : auto ? { url: fx.imgUrl(auto.src ?? "rawg", auto.img), label: auto.name ?? ctx.t("kept_game"), id: auto.srcId ?? auto.rawgId, source: auto.src ?? "rawg", isSaved: false } : null;

  const out = [
    { type: "markdown", text: `[${ctx.t(tab === SAVED_TAB ? "back_saved" : "back")}](${href(tab)})` },
    { type: "heading", text: ctx.t("which") },
    { type: "markdown", text: ctx.t("which_intro") },
    { type: "html", html: `<section class="rounded-2xl border border-line bg-surface p-5 space-y-3"><p class="text-sm text-muted break-words">${esc(ctx.t("asked"))}</p><p class="text-xl font-semibold break-words" data-testid="asked">${esc(title)}</p>` +
      (current ? `<div class="flex items-center gap-3" data-testid="current">${coverImg(current.url, "h-16 w-12")}<p class="min-w-0 break-words text-sm"><span class="text-muted">${esc(ctx.t(current.isSaved ? "current_saved" : "current_auto"))}</span><br>${esc(current.label)}</p></div>` : "") + `</section>` },
  ];
  if (!anySource) out.push({ type: "banner", tone: "warning", text: ctx.t("none_available") });
  if (!saved && (doubtful || auto)) out.push({ type: "adminForm", action: "confirm", submitLabel: ctx.t("act_good"), fields: [{ name: "id", kind: "hidden", value: title }, tabField] });
  out.push({
    type: "adminForm", action: "search", submitLabel: ctx.t("search_button"), title: ctx.t("search_label"),
    fields: [{ name: "id", kind: "hidden", value: title }, tabField, { name: "q", label: ctx.t("search_label"), value: search, help: ctx.t("search_help") }],
  });
  if (tooLong) out.push({ type: "banner", tone: "warning", text: ctx.t("err_search") });

  out.push({ type: "heading", text: ctx.t("candidates") });
  if (list && list.status !== "found") out.push({ type: "markdown", text: ctx.t(`status_${list.status === "no-key" ? "no_key" : list.status}`) });
  if (list?.status === "found") {
    out.push({
      type: "html",
      html: `<ul class="grid gap-3 sm:grid-cols-2" data-testid="candidates">${list.candidates.map((c, i) =>
        `<li class="flex gap-4 rounded-2xl border border-line bg-surface p-4" data-testid="candidate">${coverImg(c.url)}<div class="min-w-0 space-y-1"><p class="font-semibold break-words">${i + 1}. ${esc(c.name)}</p><p><span class="inline-flex items-center rounded-full border border-line px-2.5 py-0.5 text-xs font-medium" data-testid="candidate-source">${esc(srcName(c.source))}</span></p>` +
        `<p class="text-sm text-muted">${esc(c.year ? ctx.t("year", { year: c.year }) : ctx.t("year_unknown"))}</p>` +
        `<p class="text-sm text-muted break-words">${esc(c.platforms.length ? ctx.t("platforms", { list: c.platforms.join(", ") }) : ctx.t("platforms_unknown"))}</p>` +
        (current?.id === c.id && current.source === c.source ? `<p><span class="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-700">${esc(ctx.t("is_current"))}</span></p>` : "") +
        `</div></li>`).join("")}</ul>`,
    });
    // Les boutons : l'identifiant de la ligne porte le jeu, le titre et la recherche (le bouton de ligne n'envoie que cet identifiant).
    out.push({
      type: "table", columns: ["#", ctx.t("col_game"), ctx.t("col_source")], rows: list.candidates.map((c, i) => [String(i + 1), `${c.name}${c.year ? ` (${c.year})` : ""}`, { text: srcName(c.source), badge: SRC_TONE[c.source] }]),
      rowIds: list.candidates.map((c) => `${c.source}.${c.id}|${enc(title)}|${enc(search.trim().slice(0, 100))}|${tab}`),
      rowActions: [{ label: ctx.t("choose"), action: "choose" }],
    });
  }
  out.push({ type: "heading", text: ctx.t("none_title") }, { type: "markdown", text: ctx.t("none_help") },
    { type: "adminForm", action: "chooseNone", submitLabel: ctx.t("none_button"), fields: [{ name: "id", kind: "hidden", value: title }, tabField] });
  return out;
}

// ── Actions ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const who = "admin";
/** Retour à la page : dans l'onglet d'où la personne vient (« saved » ou, par défaut, le premier). */
const back = (saved, tab) => ({ redirect: `${href(tab === SAVED_TAB ? SAVED_TAB : "use", `saved=${saved}`)}` });
const fail = (ctx, error) => ({ error: ctx.t(`err_${String(error).replace("-", "_")}`) });
const tabOf = (v) => (v === SAVED_TAB ? SAVED_TAB : "use");

export const actions = {
  /** « Tester la clé » */
  async testKey(ctx) {
    const result = await rawg.checkKey(ctx);
    if (result === "ok") return { ok: ctx.t("test_ok"), redirect: "?saved=tested" };
    return { error: ctx.t(`test_${String(result).replace("-", "_")}`) };
  },
  /** Oublie la clé reprise du site (celle des Réglages de cette page n'est pas touchée). */
  async forgetKey(ctx) {
    await fx.removeOne(ctx, COL.key);
    await rawg.forgetState(ctx);
    rawg.clearCache();
    return { ok: ctx.t("forgot_key"), redirect: "?" };
  },
  /** « Chercher un jeu » (onglet des jaquettes enregistrées) : ne demande rien au service ici, mène à l'écran des propositions (la recherche part à l'affichage, sur demande de la personne). */
  async find(ctx, values) {
    const text = String(values?.q ?? "").trim();
    if (text.length > 100) return { errors: { q: ctx.t("err_search") } };
    const title = ops.checkTitle(text);
    if (!title) return { errors: { q: ctx.t("err_find") } };
    if (!(await chain.availableSources(ctx)).some((a) => a.on)) return { errors: { q: ctx.t("none_available") } };
    return { redirect: `?tab=${SAVED_TAB}&titre=${enc(title)}` };
  },
  /** Un titre à chercher sous un autre nom : on revient sur l'écran de correction avec `&q=`. */
  async search(ctx, values) {
    const title = ops.checkTitle(values?.id);
    if (!title) return { error: ctx.t("err_title") };
    const text = String(values?.q ?? "").trim();
    if (text.length > 100) return { errors: { q: ctx.t("err_search") } };
    return { redirect: `${href(tabOf(values?.tab), `titre=${enc(title)}${text ? `&q=${enc(text)}` : ""}`)}` };
  },
  /** « Utiliser cette jaquette » : l'identifiant de ligne = `<source>.<numéro>|<titre>|<recherche>|<onglet>` (un numéro seul, comme avant 1.3.0, est un numéro RAWG). */
  async choose(ctx, values) {
    const [ref, title, search, tab] = String(values?.id ?? "").slice(0, 900).split("|");
    const [src, id] = ref.includes(".") ? ref.split(".") : ["rawg", ref];
    const out = await ops.chooseGame(ctx, who, decodeURIComponentSafe(title), Number(id), decodeURIComponentSafe(search) || undefined, src);
    return out.ok ? back("game", tab) : fail(ctx, out.error);
  },
  async chooseNone(ctx, values) {
    const out = await ops.chooseNone(ctx, who, String(values?.id ?? ""));
    return out.ok ? back("none", values?.tab) : fail(ctx, out.error);
  },
  /** « Ce choix est bon » : on garde le jeu trouvé tel quel. */
  async confirm(ctx, values) {
    const out = await ops.confirmCurrent(ctx, who, String(values?.id ?? ""));
    return out.ok ? back("confirm", values?.tab) : fail(ctx, out.error);
  },
  /** « Oublier cette jaquette » : le titre retrouve le choix automatique (correction retirée, ou titre « à vérifier » retiré de la liste). */
  async forget(ctx, values) {
    const title = ops.checkTitle(String(values?.id ?? ""));
    const key = title ? titleKey(title) : "";
    const done = key && ((await ops.forget(ctx, who, key, title)) || (await ops.forgetAuto(ctx, who, key, title)));
    if (!done) return { error: ctx.t("err_forget") };
    return back("forgot", SAVED_TAB);
  },
  async forgetAll(ctx, values) {
    if (values?.confirm !== "on") return { errors: { confirm: ctx.t("err_confirm") } };
    const n = await ops.forgetAll(ctx, who);
    return n === null ? { error: ctx.t("err_rate") } : back("forgot", SAVED_TAB);
  },
};

function decodeURIComponentSafe(v) {
  try { return decodeURIComponent(String(v ?? "")); } catch { return ""; }
}
