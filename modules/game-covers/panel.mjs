// L'administration du module, en deux onglets :
//   « Jaquettes à vérifier » (onglet `use`)   l'état de RAWG en une phrase (jamais la clé), puis les titres dont le jeu trouvé est douteux ;
//   « Jaquettes enregistrées » (onglet `saved`) UN tableau de tout ce que le site retient (corrigées, trouvées toutes seules, sans jaquette), une recherche de jeu, « Voir », « Changer », « Oublier ».
// Écrans : `?titre=<titre demandé>` « Quel est le bon jeu ? » (adresse stable : les modules qui affichent « Ce n'est pas le bon jeu ? » y renvoient), `&q=<autre recherche>`,
// `?voir=<titre>` (la jaquette retenue) et `?oublier=<titre>` (confirmation). `&tab=saved` garde la personne dans l'onglet d'où elle vient.
// Mobile d'abord : des blocs simples (titres, tableaux, formulaires) que le cœur met en page ; les jaquettes sont des images fixes, sans défilement.
const q = new URL(import.meta.url).search;
const { titleKey } = await import(new URL("./match.mjs" + q, import.meta.url).href);
const fx = await import(new URL("./fixes.mjs" + q, import.meta.url).href);
const rawg = await import(new URL("./rawg.mjs" + q, import.meta.url).href);
const ops = await import(new URL("./ops.mjs" + q, import.meta.url).href);
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
/** L'état de RAWG en mots simples : tout fonctionne, ou ne répond pas (les jaquettes déjà trouvées restent affichées), avec la date de la dernière réponse correcte. */
async function statusBlocks(ctx, { short = false } = {}) {
  const state = await rawg.readState(ctx);
  if (state?.state === "unreachable") {
    return [{ type: "banner", tone: "warning", text: ctx.t("outage") },
      { type: "markdown", text: short ? ctx.t("outage_saved") : ctx.t(state.okAt ? "outage_since" : "outage_never", { date: state.okAt ? when(ctx, state.okAt) : "" }) }];
  }
  if (short) return [];
  if (state?.state === "ok") return [{ type: "banner", tone: "success", text: ctx.t("all_fine") }, { type: "markdown", text: ctx.t("last_ok", { date: when(ctx, state.okAt ?? state.at) }) }];
  if (state?.state === "refused") return [{ type: "banner", tone: "warning", text: ctx.t("err_refused") }];
  return [{ type: "banner", tone: "success", text: ctx.t("key_ok") }, { type: "markdown", text: ctx.t("never_checked") }];
}

async function keyBlocks(ctx) {
  const { key, source } = await rawg.keyOf(ctx);
  const blocks = [{ type: "heading", text: ctx.t("key_title") }];
  if (!key) {
    blocks.push({ type: "banner", tone: "warning", text: ctx.t("key_none") }, { type: "markdown", text: ctx.t("guide") });
    return blocks;
  }
  blocks.push(...(await statusBlocks(ctx)));
  if (source === "adopted") blocks.push({ type: "markdown", text: ctx.t("key_adopted") }, { type: "adminForm", action: "forgetKey", submitLabel: ctx.t("forget_key"), fields: [] });
  blocks.push({ type: "adminForm", action: "testKey", submitLabel: ctx.t("test_key"), fields: [] });
  blocks.push({ type: "netHealth", items: [{ host: "api.rawg.io", label: ctx.t("health_label") }] });
  return blocks;
}

async function listScreen(ctx) {
  const out = [...(await keyBlocks(ctx))];
  const { key } = await rawg.keyOf(ctx);

  const todo = await fx.readToCheck(ctx);
  out.push({ type: "heading", text: ctx.t("todo_title") }, { type: "markdown", text: ctx.t(key ? "todo_intro" : "todo_intro_nokey") });
  if (!todo.length) out.push({ type: "markdown", text: ctx.t("todo_empty") });
  else {
    const shown = todo.slice(0, 25);
    out.push({
      type: "table", columns: [ctx.t("col_asked"), ctx.t("col_found"), ctx.t("col_seen")], searchable: true, searchPlaceholder: ctx.t("search_list"), truncate: [0, 1],
      rows: shown.map((d) => [d.title, d.name, day(ctx, d.at)]), rowIds: shown.map((d) => d.title),
      rowActions: [{ label: ctx.t("act_fix"), href: "?titre={id}" }, { label: ctx.t("act_good"), action: "confirm" }],
    });
    if (todo.length > shown.length) out.push({ type: "markdown", text: ctx.t("todo_more", { count: todo.length - shown.length }) });
  }
  return out;
}

// ── Jaquettes enregistrées : UN tableau (corrigées, automatiques, sans jaquette) ─────────────────────────────────────────────
/** Une date lisible ; « — » quand le module ne la connaît pas (correction reprise d'un ancien réglage). */
const dayOrDash = (ctx, iso) => (Date.parse(iso) > 0 ? day(ctx, iso) : "—");
const ORIGIN_TONE = { corrected: "accent", auto: "info", none: "neutral" };
const originText = (ctx, e) => ctx.t(`origin_${e.origin}`);
/** Le nom de ce qui est retenu, en mots simples. */
const coverText = (ctx, e) => (e.origin === "none" ? "—" : e.kind === "image" ? ctx.t("kept_image") : e.name || ctx.t("kept_game"));

async function savedScreen(ctx) {
  const entries = await fx.savedEntries(ctx);
  const { key } = await rawg.keyOf(ctx);
  const out = [{ type: "markdown", text: ctx.t("saved_intro") }];
  if (!key) out.push({ type: "banner", tone: "warning", text: ctx.t("err_no_key") });
  else out.push(...(await statusBlocks(ctx, { short: true })));
  out.push({
    type: "adminForm", action: "find", submitLabel: ctx.t("find_button"),
    fields: [{ name: "q", label: ctx.t("find_label"), required: true, example: ctx.t("find_example"), help: ctx.t("find_help") }],
  });
  out.push({
    type: "table", columns: [ctx.t("col_game"), ctx.t("col_cover"), ctx.t("col_origin"), ctx.t("col_when")],
    searchable: true, searchPlaceholder: ctx.t("search_list"), filters: [{ column: 2, allLabel: ctx.t("filter_all") }], truncate: [0, 1], pageSize: 50,
    empty: ctx.t("saved_empty"),
    rows: entries.map((e) => [e.title, coverText(ctx, e), { text: originText(ctx, e), badge: ORIGIN_TONE[e.origin] }, dayOrDash(ctx, e.at)]),
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

/** « Voir » et « Oublier » : une jaquette retenue, en grand ; pour l'oubli, la phrase qui dit ce qui sera perdu. */
async function entryScreen(ctx, rawTitle, mode) {
  const title = ops.checkTitle(rawTitle);
  const key = title ? titleKey(title) : "";
  const entry = key ? await fx.entryFor(ctx, title) : null;
  const back = { type: "markdown", text: `[${ctx.t("back_saved")}](?tab=${SAVED_TAB})` };
  if (!entry) return [back, { type: "banner", tone: "warning", text: ctx.t(title ? "forget_gone" : "err_title") }];
  const card = { type: "html", html: `<section class="rounded-2xl border border-line bg-surface p-5" data-testid="entry"><div class="flex items-center gap-4">${coverImg(entry.img ? fx.rawgImageUrl(entry.img) : null)}` +
    `<div class="min-w-0 space-y-1"><p class="text-xl font-semibold break-words" data-testid="asked">${esc(entry.title)}</p><p class="text-sm break-words">${esc(coverText(ctx, entry))}</p>` +
    `<p><span class="inline-flex items-center rounded-full border border-line px-2.5 py-0.5 text-xs font-medium">${esc(originText(ctx, entry))}</span></p>` +
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
  const { key: apiKey } = await rawg.keyOf(ctx);
  const tooLong = search.trim().length > 100;
  const list = apiKey && !tooLong ? await ops.candidatesFor(ctx, "admin", title, search.trim() || undefined) : null;
  const current = saved
    ? { url: saved.img ? fx.rawgImageUrl(saved.img) : null, label: choiceText(ctx, saved), id: saved.rawgId, isSaved: true }
    : doubtful ? { url: fx.rawgImageUrl(doubtful.img), label: doubtful.name, id: doubtful.rawgId, isSaved: false }
      : auto ? { url: fx.rawgImageUrl(auto.img), label: auto.name ?? ctx.t("kept_game"), id: auto.rawgId, isSaved: false } : null;

  const out = [
    { type: "markdown", text: `[${ctx.t(tab === SAVED_TAB ? "back_saved" : "back")}](${href(tab)})` },
    { type: "heading", text: ctx.t("which") },
    { type: "markdown", text: ctx.t("which_intro") },
    { type: "html", html: `<section class="rounded-2xl border border-line bg-surface p-5 space-y-3"><p class="text-sm text-muted break-words">${esc(ctx.t("asked"))}</p><p class="text-xl font-semibold break-words" data-testid="asked">${esc(title)}</p>` +
      (current ? `<div class="flex items-center gap-3" data-testid="current">${coverImg(current.url, "h-16 w-12")}<p class="min-w-0 break-words text-sm"><span class="text-muted">${esc(ctx.t(current.isSaved ? "current_saved" : "current_auto"))}</span><br>${esc(current.label)}</p></div>` : "") + `</section>` },
  ];
  if (!apiKey) out.push({ type: "banner", tone: "warning", text: ctx.t("err_no_key") });
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
        `<li class="flex gap-4 rounded-2xl border border-line bg-surface p-4" data-testid="candidate">${coverImg(c.url)}<div class="min-w-0 space-y-1"><p class="font-semibold break-words">${i + 1}. ${esc(c.name)}</p>` +
        `<p class="text-sm text-muted">${esc(c.year ? ctx.t("year", { year: c.year }) : ctx.t("year_unknown"))}</p>` +
        `<p class="text-sm text-muted break-words">${esc(c.platforms.length ? ctx.t("platforms", { list: c.platforms.join(", ") }) : ctx.t("platforms_unknown"))}</p>` +
        (current?.id === c.id ? `<p><span class="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-700">${esc(ctx.t("is_current"))}</span></p>` : "") +
        `</div></li>`).join("")}</ul>`,
    });
    // Les boutons : l'identifiant de la ligne porte le jeu, le titre et la recherche (le bouton de ligne n'envoie que cet identifiant).
    out.push({
      type: "table", columns: ["#", ctx.t("col_game")], rows: list.candidates.map((c, i) => [String(i + 1), `${c.name}${c.year ? ` (${c.year})` : ""}`]),
      rowIds: list.candidates.map((c) => `${c.id}|${enc(title)}|${enc(search.trim().slice(0, 100))}|${tab}`),
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
    if (!(await rawg.keyOf(ctx)).key) return { errors: { q: ctx.t("err_no_key") } };
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
  /** « Utiliser cette jaquette » : l'identifiant de ligne = `<numéro RAWG>|<titre>|<recherche>|<onglet>`. */
  async choose(ctx, values) {
    const [id, title, search, tab] = String(values?.id ?? "").slice(0, 900).split("|");
    const out = await ops.chooseGame(ctx, who, decodeURIComponentSafe(title), Number(id), decodeURIComponentSafe(search) || undefined);
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
