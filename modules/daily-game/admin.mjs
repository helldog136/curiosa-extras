// Jeu du jour — l'administration. Deux onglets : « Mes questions » (aujourd'hui, prochains jours, liste, formulaire, classement) et « Packs et fichiers »
// (packs de départ, import et export CSV). Tout se fait avec des boutons : jamais de glisser-déposer, jamais de fichier à ouvrir, erreurs sous le champ.
const q = new URL(import.meta.url).search;
const L = await import(`./lib.mjs${q}`);
const G = await import(`./games.mjs${q}`);
const D = await import(`./data.mjs${q}`);
const B = await import(`./bridge.mjs${q}`);
const K = await import(`./csv.mjs${q}`);
const PK = await import(`./packs.mjs${q}`);
const V = await import(`./view.mjs${q}`);
const { clean, LIMITS, LEVELS, esc, fold, longDay, shortDay, weekKey, languageName } = L;

const can = (ctx, right) => typeof ctx.can === "function" && ctx.can(right) === true;
const here = (ctx) => `/admin/instances/${ctx.instance.id}`;
const TOOLS = "tools";

const titleOf = (ctx, item) => {
  const t = D.typeOf(ctx).title(item.d, [ctx.locale, ctx.defaultLocale]);
  return t ? clean(t, 110) : ctx.t("untitled");
};
const levelLabel = (ctx, lvl) => (lvl ? ctx.t(`lvl_${lvl}`) : "");
/** Ce qui reste à écrire : rien (chaîne vide) quand la question est complète dans toutes les langues du site, pour ne pas répéter la même étiquette sur chaque ligne. */
const langsTodo = (ctx, item) => {
  const have = D.typeOf(ctx).langs(item.d);
  if (!have.length) return ctx.t("langsNone");
  const miss = D.localesOf(ctx).filter((l) => !have.includes(l));
  return miss.length ? ctx.t("langsTodo", { missing: miss.map((l) => l.toUpperCase()).join(" · ") }) : "";
};
/** Un contexte qui parle une autre langue (aperçu d'une question dans la langue d'un visiteur). */
const asLocale = (ctx, lang) => { const c = Object.create(ctx); c.locale = lang; return c; };

function pageUrl(ctx) {
  const path = V.pageHref(ctx, false);
  return path === null ? "" : `${ctx.api.siteUrl}${path === "/" ? "" : path}`;
}

// ── Le panneau ───────────────────────────────────────────────────────────────────────────────────────────────────────

export async function adminPanel(ctx, { query } = {}) {
  const qy = query ?? {};
  const editor = can(ctx, "edit");
  const publisher = can(ctx, "publish");
  const moderator = can(ctx, "moderate");
  const type = D.typeOf(ctx);
  const locales = D.localesOf(ctx);
  const snap = await D.snapshot(ctx, { fresh: true });
  const items = snap.items.filter((i) => i.type === type.id);
  const blocks = [];

  // Aperçu d'une question : comme les visiteurs la verront, avec sa bonne réponse marquée.
  if (typeof qy.preview === "string") {
    const item = items.find((i) => i.id === qy.preview);
    if (item) {
      const lang = locales.includes(qy.lang) ? qy.lang : ctx.locale;
      const play = type.play(asLocale(ctx, lang), item, { preview: true });
      blocks.push({ type: "heading", text: ctx.t("previewTitle") });
      blocks.push({ type: "markdown", text: ctx.t("previewHelp") });
      blocks.push({ type: "html", html: play ? `<style>${V.CSS}</style><div class="dg"><div class="dg-card">${play.html}</div></div>` : `<p>${esc(ctx.t("previewEmpty"))}</p>` });
      const links = [];
      for (const l of locales) if (l !== lang && type.langs(item.d).includes(l)) links.push({ label: ctx.t("previewIn", { lang: languageName(l, ctx.locale) }), href: `${here(ctx)}?preview=${encodeURIComponent(item.id)}&lang=${encodeURIComponent(l)}` });
      if (editor) links.push({ label: ctx.t("actEdit"), href: `${here(ctx)}?edit=${encodeURIComponent(item.id)}` });
      links.push({ label: ctx.t("backToList"), href: here(ctx) });
      blocks.push({ type: "links", items: links });
      return blocks;
    }
  }

  // Changer l'ordre de passage (jeu « dans l'ordre »)
  if (editor && qy.order && D.modeOf(ctx) === "sequence") {
    const pool = items.filter((i) => D.playable(ctx, i) && !i.date);
    const page = Math.max(1, L.num(qy.page, 1, 1, 100));
    const slice = pool.slice((page - 1) * LIMITS.page, page * LIMITS.page);
    if (pool.length > 1) {
      const used = new Set(Object.values(snap.plan.hist));
      blocks.push({ type: "heading", text: ctx.t("orderTitle", { count: pool.length }) });
      blocks.push({ type: "markdown", text: ctx.t("orderHelp") });
      blocks.push({
        type: "table", columns: [ctx.t("colQuestion")], rowIds: slice.map((i) => i.id),
        rows: slice.map((x, n) => [`${(page - 1) * LIMITS.page + n + 1}. ${titleOf(ctx, x)}\n${[x.cat, used.has(x.id) ? ctx.t("alreadyPlayed") : ""].filter(Boolean).join(" · ")}`]),
        rowActions: [{ label: ctx.t("actUp"), action: "moveUp" }, { label: ctx.t("actDown"), action: "moveDown" }, { label: ctx.t("actTop"), action: "moveTop" }],
      });
      const nav = [];
      if (page > 1) nav.push({ label: ctx.t("pagePrev"), href: `${here(ctx)}?order=1&page=${page - 1}` });
      if (page * LIMITS.page < pool.length) nav.push({ label: ctx.t("pageNext"), href: `${here(ctx)}?order=1&page=${page + 1}` });
      nav.push({ label: ctx.t("orderDone"), href: here(ctx) });
      blocks.push({ type: "links", items: nav });
      return blocks;
    }
  }

  const empty = items.length === 0;
  blocks.push({ type: "markdown", text: ctx.t("adminIntro") });

  // Le formulaire demandé par l'adresse (?new=1 · ?edit=<question>) vient tout de suite après la phrase d'introduction : on ne défile pas pour l'atteindre
  if (editor) {
    const wanted = typeof qy.edit === "string" ? items.find((i) => i.id === qy.edit) : null;
    if (wanted || qy.new) {
      blocks.push(questionForm(ctx, wanted ?? null, items, type, locales));
      if (wanted) {
        const more = [{ label: ctx.t("actPreview"), href: `${here(ctx)}?preview={id}` }];
        if (publisher) more.push(wanted.status === "published" ? { label: ctx.t("actUnpublish"), action: "unpublish", confirm: ctx.t("confirmUnpublish") } : { label: ctx.t("actPublish"), action: "publish" });
        if (publisher && D.playable(ctx, wanted)) more.push({ label: ctx.t("actUseToday"), action: "useToday", confirm: ctx.t("confirmUseToday"), inMenu: true });
        if (wanted.date) more.push({ label: ctx.t("actClearDate"), action: "clearDate", inMenu: true });
        more.push({ label: ctx.t("actDelete"), action: "removeQuestion", confirm: ctx.t("confirmDelete"), danger: true });
        blocks.push({ type: "table", columns: [ctx.t("colOther")], rows: [[titleOf(ctx, wanted)]], rowIds: [wanted.id], rowActions: more, pageSize: 0 });
      }
    }
  }

  // Premier pas : un gabarit en un clic
  if (empty && !snap.plan.tpl && editor && publisher) {
    blocks.push({ type: "heading", text: ctx.t("startTitle") });
    blocks.push({ type: "markdown", text: ctx.t("startHelp") });
    blocks.push({
      type: "table", columns: [ctx.t("colTemplate"), ctx.t("colAbout")], rowIds: PK.TEMPLATES.map((t) => t.id), pageSize: 0,
      rows: PK.TEMPLATES.map((t) => [PK.pickText(t.name, ctx.locale), PK.pickText(t.about, ctx.locale)]),
      rowActions: [{ label: ctx.t("actChoose"), action: "applyTemplate" }],
    });
  }

  // Où en est le jeu ?
  if (!empty || snap.plan.tpl) {
    const out = await D.outlook(ctx, { count: 7, fresh: true });
    const todayItem = out.days[0]?.id ? items.find((i) => i.id === out.days[0].id) : null;
    if (!out.pool.length && !out.left.days) blocks.push({ type: "banner", tone: "warning", text: ctx.t("bannerNone") });
    else if (out.left.days < 7) blocks.push({ type: "banner", tone: out.left.days < 3 ? "warning" : "info", text: ctx.t("bannerLow", { count: out.left.days }) });
    blocks.push({ type: "heading", text: ctx.t("todayTitle", { date: longDay(out.day, ctx.locale) }) });
    blocks.push({ type: "markdown", text: todayItem ? ctx.t("todayIs", { title: titleOf(ctx, todayItem) }) : ctx.t("todayNone") });
    if (out.pool.length || out.left.days) {
      blocks.push({ type: "markdown", text: ctx.t(out.left.wraps ? "daysLeft" : "daysLeftNoWrap", { count: out.left.days, mode: ctx.t(D.modeOf(ctx) === "random" ? "modeRandomShort" : "modeSequenceShort") }) });
    }
    const href = V.pageHref(ctx);
    const links = [];
    if (editor) links.push({ label: ctx.t("linkNew"), href: `${here(ctx)}?new=1` });
    if (href) links.push({ label: ctx.t("linkSee"), href });
    if (todayItem) links.push({ label: ctx.t("linkPreviewToday"), href: `${here(ctx)}?preview=${encodeURIComponent(todayItem.id)}` });
    if (editor && D.modeOf(ctx) === "sequence" && out.pool.length > 1) links.push({ label: ctx.t("linkOrder"), href: `${here(ctx)}?order=1` });
    if (links.length) blocks.push({ type: "links", items: links });
    if (href) blocks.push({ type: "copy", label: ctx.t("copyLabel"), text: pageUrl(ctx) || ctx.api.siteUrl });

    if (out.days.some((d) => d.id)) {
      blocks.push({ type: "heading", text: ctx.t("nextTitle") });
      blocks.push({
        type: "table", columns: [ctx.t("colDay"), ctx.t("colQuestion")],
        rows: out.days.map((d) => {
          const it = items.find((x) => x.id === d.id);
          const note = d.scheduled ? ctx.t("noteScheduled") : d.repeat ? ctx.t("noteRepeat") : "";
          return [longDay(d.day, ctx.locale), it ? `${titleOf(ctx, it)}${note ? `\n${note}` : ""}` : ctx.t("todayNone")];
        }),
      });
      blocks.push({ type: "markdown", text: ctx.t("nextHelp") });
    }
  }

  // La liste
  if (!empty) listBlocks(ctx, items, qy, { editor, publisher }, blocks);

  // Les dates à venir
  const planned = [...D.plannedDays(items, D.today(ctx)).values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  if (planned.length) {
    blocks.push({ type: "heading", text: ctx.t("plannedTitle", { count: planned.length, max: LIMITS.planned }) });
    blocks.push({ type: "markdown", text: ctx.t("plannedHelp") });
    const shown = planned.slice(0, LIMITS.page);
    blocks.push({
      type: "table", columns: [ctx.t("colDay"), ctx.t("colQuestion")], rowIds: shown.map((i) => i.id),
      rows: shown.map((i) => [longDay(i.date, ctx.locale), titleOf(ctx, i)]),
      rowActions: editor ? [{ label: ctx.t("actEdit"), href: "?edit={id}" }, { label: ctx.t("actClearDate"), action: "clearDate" }] : [],
    });
  }

  // Le classement de la semaine
  if (D.flag(ctx, "leaderboard", false)) {
    if (await B.present(ctx)) {
      const week = weekKey(D.today(ctx));
      const top = await D.boardTop(ctx, week, 20);
      blocks.push({ type: "heading", text: ctx.t("boardAdminTitle", { week }) });
      blocks.push({ type: "markdown", text: ctx.t(top.length ? "boardAdminHelp" : "boardAdminNone") });
      if (top.length) {
        blocks.push({
          type: "table", columns: [ctx.t("colPlayer")], rowIds: top.map((r) => r.id),
          rows: top.map((r) => [`${r.rank}. ${r.name || ctx.t("boardAnon")}\n${ctx.t("boardPts", { n: r.pts })} · ${ctx.t("boardWins", { wins: r.wins, games: r.games })}`]),
          rowActions: moderator ? [{ label: ctx.t("actRemoveRow"), action: "removeBoardRow", confirm: ctx.t("confirmRemoveRow"), danger: true }] : [],
        });
        if (moderator) blocks.push({ type: "table", columns: [ctx.t("colOther")], rows: [[ctx.t("boardClearLabel")]], rowIds: [week], rowActions: [{ label: ctx.t("actClearBoard"), action: "clearBoard", confirm: ctx.t("confirmClearBoard"), danger: true }], pageSize: 0 });
      }
    } else {
      blocks.push({ type: "markdown", text: ctx.t("boardMissing") });
      blocks.push({ type: "suggestInstall", service: B.SERVICE, reason: ctx.t("suggestReason") });
    }
  }

  // ── Onglet « Packs et fichiers » ───────────────────────────────────────────────────────────────
  const tab = TOOLS;
  blocks.push({ type: "heading", text: ctx.t("packsTitle"), tab });
  blocks.push({ type: "markdown", text: ctx.t("packsHelp"), tab });
  const packRows = PK.PACKS.filter((p) => p.type === type.id);
  blocks.push({
    type: "table", columns: [ctx.t("colPack"), ctx.t("colAbout"), ctx.t("colProgress")], tab, rowIds: packRows.map((p) => p.id), searchable: true, truncate: [1], pageSize: 0, empty: ctx.t("packsNone"),
    rows: packRows.map((p) => {
      const have = items.filter((i) => i.pack.startsWith(`${p.id}:`)).length;
      return [PK.pickText(p.name, ctx.locale), PK.pickText(p.about, ctx.locale), have ? { text: ctx.t("packOn", { have, total: p.questions.length }), badge: "ok" } : ""];
    }),
    rowActions: editor && publisher ? [{ label: ctx.t("actActivate"), action: "activatePack" }, { label: ctx.t("actDeactivate"), action: "removePack", confirm: ctx.t("confirmDeactivate"), danger: true }] : [],
  });
  if (editor) {
    blocks.push({ type: "heading", text: ctx.t("importTitle"), tab });
    blocks.push({ type: "markdown", text: ctx.t("importHelp", { max: LIMITS.questions }), tab });
    blocks.push({
      type: "adminForm", action: "importCsv", submitLabel: ctx.t("importSubmit"), tab,
      fields: [
        { name: "file", kind: "file", accept: ".csv,.txt", maxBytes: LIMITS.csvBytes, required: true, label: ctx.t("fFile"), help: ctx.t("hFile") },
        ...(locales.length > 1 ? [{ name: "lang", kind: "select", label: ctx.t("fImportLang"), value: "", folded: true, options: locales.map((l) => ({ value: l, label: languageName(l, ctx.locale) })), help: ctx.t("hImportLang") }] : []),
        { name: "state", kind: "segmented", label: ctx.t("fImportState"), value: "", folded: true, options: [{ value: "draft", label: ctx.t("optImportDraft") }, { value: "published", label: ctx.t("optImportPublished") }], help: ctx.t("hImportState") },
      ],
    });
    blocks.push({ type: "heading", text: ctx.t("exportTitle"), tab });
    blocks.push({ type: "markdown", text: ctx.t("exportHelp"), tab });
    blocks.push({ type: "download", name: "export", label: ctx.t("exportButton"), tab });
    blocks.push({ type: "download", name: "sample", label: ctx.t("sampleButton"), tab });
  }
  if (publisher && !empty) {
    blocks.push({ type: "heading", text: ctx.t("restartTitle"), tab });
    blocks.push({ type: "markdown", text: ctx.t("restartHelp"), tab });
    blocks.push({ type: "table", columns: [ctx.t("colOther")], rows: [[ctx.t("restartLabel")]], rowIds: ["x"], rowActions: [{ label: ctx.t("actRestart"), action: "restartPlan", confirm: ctx.t("confirmRestart"), danger: true }], pageSize: 0, tab });
  }
  return blocks;
}

function questionForm(ctx, item, items, type, locales) {
  const fields = [{ name: "id", kind: "hidden", label: "id", value: item?.id ?? "" }, ...type.fields(ctx, item, locales)];
  const cats = [...new Set(items.map((i) => i.cat).filter(Boolean))].sort().slice(0, 10);
  // Tout ce qui est rare est replié sous « Plus d'options » (le cœur le résume et l'ouvre d'office quand une valeur y est).
  fields.push({ name: "cat", label: ctx.t("fCat"), value: item?.cat ?? "", folded: true, help: ctx.t("hCat"), example: cats[0] ?? ctx.t("exCat") });
  fields.push({
    name: "lvl", kind: "select", label: ctx.t("fLevel"), value: item?.lvl ?? "", folded: true,
    options: [{ value: "", label: ctx.t("lvl_none") }, ...LEVELS.map((l) => ({ value: l, label: ctx.t(`lvl_${l}`) }))],
  });
  fields.push({ name: "date", kind: "date", label: ctx.t("fDate"), value: item?.date ?? "", folded: true, help: ctx.t("hDate") });
  fields.push({
    name: "state", kind: "segmented", label: ctx.t("fState"), value: item?.status === "draft" ? "draft" : "", folded: true,
    options: [{ value: "published", label: ctx.t("statePublished") }, { value: "draft", label: ctx.t("stateDraft") }], help: ctx.t("hState"),
  });
  return { type: "adminForm", action: "saveQuestion", title: ctx.t(item ? "editTitle" : "newTitle"), submitLabel: ctx.t(item ? "save" : "saveNew"), cancelHref: here(ctx), fields };
}

/** La liste : un tableau avec recherche en direct (questions, réponses, catégorie), pastilles d'état avec leur nombre, 50 lignes par page. */
function listBlocks(ctx, items, qy, rights, blocks) {
  const type = D.typeOf(ctx);
  blocks.push({ type: "heading", text: ctx.t("listTitle", { count: items.length, max: LIMITS.questions }) });
  const list = [...items].sort((a, b) => b.createdAt - a.createdAt || b.pos - a.pos);
  const actions = [];
  if (rights.editor) actions.push({ label: ctx.t("actEdit"), href: "?edit={id}" });
  actions.push({ label: ctx.t("actPreview"), href: "?preview={id}" });
  const tone = { draft: "warn", planned: "info", published: "ok" };
  const stateOf = (i) => (i.status !== "published" ? "draft" : i.date ? "planned" : "published");
  blocks.push({
    type: "table", columns: [ctx.t("colQuestion"), ctx.t("colCategory"), ctx.t("colLanguages"), ctx.t("colDay"), ctx.t("colState")], rowIds: list.map((i) => i.id),
    searchable: true, searchPlaceholder: ctx.t("searchLabel"), filters: [{ column: 4, allLabel: ctx.t("filter_all") }], truncate: [0], pageSize: LIMITS.page, empty: ctx.t("listNone"),
    rows: list.map((i) => [
      { text: titleOf(ctx, i), title: type.text(i.d) },
      [i.cat, levelLabel(ctx, i.lvl)].filter(Boolean).join(" · "),
      langsTodo(ctx, i),
      i.date ? shortDay(i.date, ctx.locale) : "",
      { text: ctx.t(`state_${stateOf(i)}`), badge: tone[stateOf(i)] },
    ]),
    rowActions: actions,
  });
}

/** Menu de l'admin : une pastille quand il ne reste presque plus de questions. */
export async function adminBadge(ctx) {
  const out = await D.outlook(ctx, { count: 1 });
  if (!out.snap.items.length) return 0;
  return out.left.days < 3 ? 1 : 0;
}

// ── Les actions ──────────────────────────────────────────────────────────────────────────────────────────────────────

async function saveQuestion(ctx, values) {
  const type = D.typeOf(ctx);
  const locales = D.localesOf(ctx);
  // « Publication » est replié et vide par défaut : sans choix, une question neuve est publiée (si la personne peut publier), une question existante garde son état.
  const given = values.state === "published" ? "published" : values.state === "draft" ? "draft" : null;
  const early = given ?? (can(ctx, "publish") ? "published" : "draft");
  const made = type.fromForm(ctx, values, { locales, state: early });
  const errors = { ...(made.errors ?? {}) };
  const rawDate = clean(values.date, 20);
  let date = "";
  if (rawDate) { const iso = K.dateOf(rawDate); if (!iso) errors.date = ctx.t("errDate"); else date = iso; }
  const lvlRaw = clean(values.lvl, 10);
  if (lvlRaw && !LEVELS.includes(lvlRaw)) errors.lvl = ctx.t("errLevel");
  if (Object.keys(errors).length) return { errors };

  return D.locked(ctx, async () => {
    const snap = await D.snapshot(ctx, { fresh: true });
    const all = snap.items;
    const id = typeof values.id === "string" ? values.id : "";
    const existing = id ? all.find((i) => i.id === id) : null;
    if (id && !existing) return { error: ctx.t("errNotFound") };
    const was = existing?.status ?? "draft";
    const state = given ?? existing?.status ?? early;
    if (state !== was && !can(ctx, "publish")) return { errors: { state: ctx.t("errNoPublishRight") } };
    const today = D.today(ctx);
    if (date) {
      const taken = all.find((i) => i.date === date && i.id !== id);
      if (taken) return { errors: { date: ctx.t("errDateTaken", { title: titleOf(ctx, taken) }) } };
      if (date < today && existing?.date !== date) return { errors: { date: ctx.t("errPast") } };
      const count = all.filter((i) => i.date && i.date >= today && i.id !== id).length;
      if (count >= LIMITS.planned && existing?.date !== date) return { errors: { date: ctx.t("errPlannedFull", { max: LIMITS.planned }) } };
    }
    if (!existing && all.length >= LIMITS.questions) return { error: ctx.t("errFull", { max: LIMITS.questions }) };
    const saved = await D.saveItem(ctx, id, { type: type.id, status: state, cat: values.cat, lvl: lvlRaw, date, pos: existing ? existing.pos : D.nextPos(all), pack: existing?.pack ?? "", by: existing?.by ?? "admin", d: made.d });
    if (!saved) return { error: ctx.t("errNotFound") };
    return { ok: ctx.t(state === "published" && was !== "published" ? "okPublished" : "okSaved"), redirect: "?" };
  });
}

const rowOf = async (ctx, values) => D.getRow(ctx, values.id, "item");

async function setStatus(ctx, values, status) {
  return D.locked(ctx, async () => {
    const row = await rowOf(ctx, values);
    if (!row) return { error: ctx.t("errNotFound") };
    const item = D.toItem(row);
    if (status === "published" && !D.typeOf(ctx).complete(item.d)) return { error: ctx.t("errNotComplete") };
    if (item.status === status) return { ok: ctx.t("okSaved") };
    await D.saveItem(ctx, row.id, { ...item, status });
    return { ok: ctx.t(status === "published" ? "okPublished" : "okUnpublished") };
  });
}

async function removeQuestion(ctx, values) {
  return D.locked(ctx, async () => {
    const row = await rowOf(ctx, values);
    if (!row) return { error: ctx.t("errNotFound") };
    await ctx.api.store.remove(row.id);
    D.invalidate(ctx);
    return { ok: ctx.t("okDeleted"), redirect: "?" };
  });
}

async function clearDate(ctx, values) {
  return D.locked(ctx, async () => {
    const row = await rowOf(ctx, values);
    if (!row) return { error: ctx.t("errNotFound") };
    await D.saveItem(ctx, row.id, { ...D.toItem(row), date: "" });
    return { ok: ctx.t("okDateCleared"), redirect: "?" };
  });
}

async function useToday(ctx, values) {
  const ok = await D.setToday(ctx, String(values.id ?? ""));
  return ok ? { ok: ctx.t("okUseToday"), redirect: "?" } : { error: ctx.t("errNotComplete") };
}

/** Déplace une question publiée dans l'ordre de passage : deux écritures au plus (on échange les places), ou une seule pour « en premier ». */
async function move(ctx, values, how) {
  return D.locked(ctx, async () => {
    const snap = await D.snapshot(ctx, { fresh: true });
    const pool = snap.items.filter((i) => D.playable(ctx, i) && !i.date);
    const at = pool.findIndex((i) => i.id === values.id);
    if (at < 0) return { error: ctx.t("errNotFound") };
    const set = async (item, pos) => { const row = await D.getRow(ctx, item.id); if (row) await ctx.api.store.update(item.id, { ...row.data, pos }); };
    if (how === "top") {
      if (at === 0) return { ok: ctx.t("okFirst") };
      await set(pool[at], pool[0].pos - 1);
    } else {
      const to = at + (how === "up" ? -1 : 1);
      if (to < 0 || to >= pool.length) return { ok: ctx.t(how === "up" ? "okFirst" : "okLast") };
      const a = pool[at], b = pool[to];
      if (a.pos === b.pos) await set(a, b.pos + (how === "up" ? -0.5 : 0.5)); else { await set(a, b.pos); await set(b, a.pos); }
    }
    D.invalidate(ctx);
    return { ok: ctx.t("okMoved") };
  });
}

// Packs et gabarits (les fonctions `activate` supposent d'être appelées DANS le verrou)

function packQuestions(ctx, pack, have, startPos) {
  const type = G.gameType(pack.type);
  return pack.questions.map((qq, n) => ({ qq, n })).filter(({ n }) => !have.has(`${pack.id}:${n + 1}`)).map(({ qq, n }, i) => ({
    data: {
      type: pack.type, status: "published", cat: clean(PK.pickText(qq.cat, ctx.defaultLocale), LIMITS.cat), lvl: qq.lvl, pos: startPos + i, by: "pack", pack: `${pack.id}:${n + 1}`,
      d: type.normalize({ tr: Object.fromEntries(Object.entries(qq.tr).map(([l, v]) => [l, { q: v.q, a: v.a, e: v.e }])), correct: qq.correct - 1 }),
    },
  }));
}

async function addMany(ctx, rows) {
  D.invalidate(ctx);
  if (typeof ctx.api.store.addMany === "function") { await ctx.api.store.addMany(D.C.q, rows); return; }
  for (const r of rows) await ctx.api.store.add(D.C.q, r.data);
}

async function activate(ctx, packId) {
  const pack = PK.packById(packId);
  if (!pack) return { error: ctx.t("errNotFound") };
  if (pack.type !== D.typeOf(ctx).id) return { error: ctx.t("errPackType") };
  const snap = await D.snapshot(ctx, { fresh: true });
  const have = new Set(snap.items.filter((i) => i.pack.startsWith(`${pack.id}:`)).map((i) => i.pack));
  const rows = packQuestions(ctx, pack, have, D.nextPos(snap.items));
  if (!rows.length) return { ok: ctx.t("okPackAlready") };
  if (snap.items.length + rows.length > LIMITS.questions) return { error: ctx.t("errFull", { max: LIMITS.questions }) };
  await addMany(ctx, rows);
  return { ok: ctx.t("okPackOn", { count: rows.length }), count: rows.length };
}

async function applyTemplate(ctx, values) {
  return D.locked(ctx, async () => {
    const tpl = PK.templateById(String(values.id ?? ""));
    if (!tpl) return { error: ctx.t("errNotFound") };
    let count = 0;
    for (const id of tpl.packs) { const r = await activate(ctx, id); if (r.error) return r; count += r.count ?? 0; }
    await D.chooseTemplate(ctx, tpl.id);
    return { ok: ctx.t(count ? "okTemplate" : "okTemplateEmpty", { count }), redirect: "?" };
  });
}

async function activatePack(ctx, values) {
  return D.locked(ctx, async () => {
    const r = await activate(ctx, String(values.id ?? ""));
    if (!r.error) await D.chooseTemplate(ctx, "pack");
    return r;
  });
}

async function removePack(ctx, values) {
  return D.locked(ctx, async () => {
    const pack = PK.packById(String(values.id ?? ""));
    if (!pack) return { error: ctx.t("errNotFound") };
    const snap = await D.snapshot(ctx, { fresh: true });
    const mine = snap.items.filter((i) => i.pack.startsWith(`${pack.id}:`));
    for (const i of mine) await ctx.api.store.remove(i.id);
    D.invalidate(ctx);
    return { ok: ctx.t("okPackOff", { count: mine.length }) };
  });
}

// Import CSV

async function importFile(ctx, values) {
  const text = String(values.file ?? "");
  if (!text.trim()) return { errors: { file: ctx.t("csvEmpty") } };
  if (text.length > LIMITS.csvBytes) return { errors: { file: ctx.t("csvBig") } };
  const type = D.typeOf(ctx);
  const locales = D.localesOf(ctx);
  const lang = locales.includes(values.lang) ? values.lang : locales[0];
  const state = values.state === "published" ? "published" : "draft";
  if (state === "published" && !can(ctx, "publish")) return { errors: { state: ctx.t("errNoPublishRight") } };
  return D.locked(ctx, async () => {
    const snap = await D.snapshot(ctx, { fresh: true });
    const today = D.today(ctx);
    const mine = snap.items.filter((i) => i.type === type.id);
    const key = (i) => fold(type.title(i.d, [lang, ...locales])).replace(/\s+/g, " ").trim();
    const existing = {
      questions: new Set(mine.map(key)),
      dates: new Set(mine.filter((i) => i.date).map((i) => i.date)),
      planned: mine.filter((i) => i.date && i.date >= today).length,
      room: LIMITS.questions - snap.items.length,
    };
    const res = K.importCsv(ctx, text, { type, locales, lang, defaultStatus: state, existing, today });
    if (!res.ok) {
      const lines = res.errors.map((e) => ctx.t("csvLine", { line: e.line, message: e.message }));
      const more = (res.errorCount ?? lines.length) - lines.length;
      return { errors: { file: `${lines.join(" · ")}${more > 0 ? ` ${ctx.t("csvMore", { count: more })}` : ""} ${ctx.t("csvNothing")}` } };
    }
    if (res.rows.some((r) => r.status === "published") && !can(ctx, "publish")) return { errors: { state: ctx.t("errNoPublishRight") } };
    let pos = D.nextPos(snap.items);
    await addMany(ctx, res.rows.map((r) => ({ data: { type: type.id, status: r.status, cat: r.cat, lvl: r.lvl, ...(r.date ? { date: r.date } : {}), pos: pos++, by: "import", d: r.d } })));
    return { ok: ctx.t("okImported", { count: res.rows.length, skipped: res.skipped }), redirect: "?" };
  });
}

async function restartPlan(ctx) {
  await D.resetPlan(ctx);
  return { ok: ctx.t("okRestart") };
}

// Classement

async function removeBoardRow(ctx, values) {
  const week = weekKey(D.today(ctx));
  return (await D.boardRemove(ctx, week, String(values.id ?? ""))) ? { ok: ctx.t("okRowRemoved") } : { error: ctx.t("errNotFound") };
}

async function clearBoard(ctx) {
  await D.boardRemove(ctx, weekKey(D.today(ctx)), "");
  return { ok: ctx.t("okBoardCleared") };
}

export const adminActions = {
  saveQuestion: { right: "edit", run: saveQuestion },
  publish: { right: "publish", run: (ctx, v) => setStatus(ctx, v, "published") },
  unpublish: { right: "publish", run: (ctx, v) => setStatus(ctx, v, "draft") },
  removeQuestion: { right: "edit", run: removeQuestion },
  clearDate: { right: "edit", run: clearDate },
  useToday: { right: "publish", run: useToday },
  moveUp: { right: "edit", run: (ctx, v) => move(ctx, v, "up") },
  moveDown: { right: "edit", run: (ctx, v) => move(ctx, v, "down") },
  moveTop: { right: "edit", run: (ctx, v) => move(ctx, v, "top") },
  applyTemplate: { right: "publish", run: applyTemplate },
  activatePack: { right: "publish", run: activatePack },
  removePack: { right: "publish", run: removePack },
  importCsv: { right: "edit", run: importFile },
  restartPlan: { right: "publish", run: restartPlan },
  removeBoardRow: { right: "moderate", run: removeBoardRow },
  clearBoard: { right: "moderate", run: clearBoard },
};

// ── Téléchargements (réservés à l'équipe, servis par le cœur) ─────────────────────────────────────────────────────────

export const adminDownloads = {
  export: {
    right: "edit",
    contentType: "text/csv",
    filename: () => "questions",
    async *generate(ctx) {
      const snap = await D.snapshot(ctx, { fresh: true });
      yield* K.exportLines(D.typeOf(ctx), D.localesOf(ctx), [...snap.items].sort((a, b) => a.createdAt - b.createdAt || a.pos - b.pos));
    },
  },
  sample: {
    right: "edit",
    contentType: "text/csv",
    filename: () => "questions-exemple",
    async *generate(ctx) { yield K.sampleCsv(ctx, D.typeOf(ctx), D.localesOf(ctx)); },
  },
};
