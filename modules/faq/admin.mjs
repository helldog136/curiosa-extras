// Questions fréquentes : l'administration. Deux onglets : « Ma FAQ » (questions, brouillons, thèmes) et « Questions reçues » (la boîte des visiteurs).
// Tout se fait avec des boutons : ordre des thèmes et des questions par « Monter / Descendre », jamais de glisser-déposer obligatoire.

import { C, locked, getRow, loadThemes, loadItems, loadAsked, purgeAsked, siblings, nextPos, renumber, flag, retentionDays } from "./data.mjs";
import { LIMITS, clean, day, languageName, plainText } from "./text.mjs";
import { complete, createRow, deleteRow, linkAsked, publishRow } from "./ops.mjs";
import { buildView, markupHtml, pageHref, themeName } from "./view.mjs";

const can = (ctx, right) => typeof ctx.can === "function" && ctx.can(right) === true;

/** Cette page d'administration : un lien du panneau doit être une adresse du site (« ?x=1 » seul serait refusé par le bloc de liens). */
const here = (ctx) => `/admin/instances/${ctx.instance.id}`;

/** Adresse complète de la page publique (langue du site), sans « / » final. */
function fullUrl(ctx) {
  const path = pageHref(ctx, false);
  return path === null ? "" : `${ctx.api.siteUrl}${path === "/" ? "" : path}`;
}

/** Les langues du site, la langue par défaut d'abord. */
const localesOf = (ctx) => [ctx.defaultLocale, ...ctx.locales.filter((l) => l !== ctx.defaultLocale)].filter((l, i, a) => l && a.indexOf(l) === i);

function langsCell(ctx, item) {
  const all = localesOf(ctx);
  const present = all.filter((l) => item.tr[l]?.q && item.tr[l]?.a);
  const missing = all.filter((l) => !present.includes(l));
  const up = (list) => list.map((l) => l.toUpperCase()).join(" · ");
  if (!present.length) return ctx.t("langsNone");
  return missing.length ? ctx.t("langsMissing", { present: up(present), missing: up(missing) }) : up(present);
}

/** Le titre d'une question pour l'équipe : sa langue d'abord (langue de l'écran, puis du site, puis n'importe laquelle). */
function titleOf(ctx, item) {
  const order = [ctx.locale, ctx.defaultLocale, ...Object.keys(item.tr)];
  for (const l of order) if (item.tr[l]?.q) return plainText(item.tr[l].q, 90);
  for (const l of order) if (item.tr[l]?.a) return `${plainText(item.tr[l].a, 70)}…`;
  return ctx.t("untitled");
}

// ── Le formulaire d'une question ─────────────────────────────────────────────────────────────────────────────────────

function itemForm(ctx, themes, { item, askedId = "", prefill = {}, theme = "" }) {
  const fields = [
    { name: "id", kind: "hidden", label: "id", value: item?.id ?? "" },
    { name: "askedId", kind: "hidden", label: "asked", value: askedId },
  ];
  const link = item && fullUrl(ctx) ? `${fullUrl(ctx)}#q-${item.slug}` : "";
  localesOf(ctx).forEach((l, i) => {
    const lang = languageName(l, ctx.locale);
    fields.push({
      name: `q_${l}`, label: ctx.t("fieldQuestion", { lang }),
      value: item?.tr[l]?.q ?? prefill[l] ?? "",
      help: i === 0 ? ctx.t(link ? "questionHelpLink" : "questionHelp", { link }) : undefined,
    });
    fields.push({ name: `a_${l}`, kind: "textarea", label: ctx.t("fieldAnswer", { lang }), value: item?.tr[l]?.a ?? "", help: i === 0 ? ctx.t("answerHelp") : undefined });
  });
  fields.push({
    name: "theme", kind: "select", label: ctx.t("fieldTheme"), value: item ? item.theme : theme,
    options: [{ value: "", label: ctx.t("noTheme") }, ...themes.map((t) => ({ value: t.id, label: themeName(ctx, t) || ctx.t("untitled") }))],
    help: themes.length ? undefined : ctx.t("themeHelpNone"),
  });
  fields.push({
    name: "state", kind: "select", label: ctx.t("fieldState"), value: item ? item.status : askedId ? "published" : "draft",
    options: [{ value: "published", label: ctx.t("statePublished") }, { value: "draft", label: ctx.t("stateDraft") }],
    help: ctx.t("stateHelp"),
  });
  if (item && (item.y || item.n)) fields.push({ name: "resetVotes", kind: "checkbox", label: ctx.t("fieldReset"), help: ctx.t("resetHelp", { yes: item.y, no: item.n }) });
  return { type: "adminForm", action: "saveItem", title: ctx.t(item ? "editTitle" : askedId ? "answerTitle" : "newTitle"), submitLabel: ctx.t("save"), cancelHref: "?", fields };
}

function themeForm(ctx, theme) {
  const fields = [{ name: "id", kind: "hidden", label: "id", value: theme?.id ?? "" }];
  localesOf(ctx).forEach((l, i) => fields.push({ name: `name_${l}`, label: ctx.t("fieldThemeName", { lang: languageName(l, ctx.locale) }), value: theme?.names[l] ?? "", help: i === 0 ? ctx.t("themeNameHelp") : undefined }));
  return { type: "adminForm", action: "saveTheme", title: ctx.t(theme ? "themeEditTitle" : "themeNewTitle"), submitLabel: ctx.t(theme ? "save" : "themeAdd"), cancelHref: theme ? "?" : undefined, fields };
}

// ── Le panneau ───────────────────────────────────────────────────────────────────────────────────────────────────────

export async function adminPanel(ctx, { query } = {}) {
  const q = query ?? {};
  try { await purgeAsked(ctx); } catch { /* le ménage se refera à la prochaine visite */ }
  const [themes, items, asked] = await Promise.all([loadThemes(ctx), loadItems(ctx), loadAsked(ctx)]);
  const editor = can(ctx, "edit");
  const publisher = can(ctx, "publish");
  const blocks = [];
  const fresh = asked.filter((a) => a.status === "new");

  // Vue « changer l'ordre » : une courte liste avec « ↑ Haut / ↓ Bas » (jamais de glisser-déposer), pour rester lisible sur un téléphone.
  if (editor && typeof q.order === "string") {
    const asThemes = q.order === "themes";
    const list = asThemes ? themes : siblings(items, q.order === "none" ? "" : q.order).filter((i) => q.order !== "none" || !themes.some((t) => t.id === i.theme));
    const unknown = !asThemes && q.order !== "none" && !themes.some((t) => t.id === q.order);
    if (list.length > 1 && !unknown) {
      const name = asThemes ? ctx.t("themesTitle", { count: themes.length }) : q.order === "none" ? ctx.t("noTheme") : themeName(ctx, themes.find((t) => t.id === q.order)) || ctx.t("untitled");
      blocks.push({ type: "heading", text: ctx.t("orderTitle", { name }) });
      blocks.push({ type: "markdown", text: ctx.t("orderHelp") });
      blocks.push({
        type: "table", columns: [ctx.t(asThemes ? "colTheme" : "colQuestion")],
        rows: list.map((x, n) => [`${n + 1}. ${asThemes ? themeName(ctx, x) || ctx.t("untitled") : titleOf(ctx, x)}`]),
        rowIds: list.map((x) => x.id), rowActions: [{ label: ctx.t("actUp"), action: asThemes ? "themeUp" : "moveUp" }, { label: ctx.t("actDown"), action: asThemes ? "themeDown" : "moveDown" }],
      });
      blocks.push({ type: "links", items: [{ label: ctx.t("orderDone"), href: here(ctx) }] });
      return blocks;
    }
  }

  if (fresh.length) blocks.push({ type: "banner", tone: "info", text: ctx.t("bannerNew", { count: fresh.length }), href: `${here(ctx)}?tab=inbox` });

  // Le formulaire demandé par l'adresse : ?edit=<question> · ?new=1 · ?answer=<question reçue>
  if (editor) {
    const wantedAsked = typeof q.answer === "string" ? asked.find((a) => a.id === q.answer) : undefined;
    const wantedItem = typeof q.edit === "string" ? items.find((i) => i.id === q.edit) : wantedAsked?.draft ? items.find((i) => i.id === wantedAsked.draft) : undefined;
    if (wantedItem) {
      blocks.push(itemForm(ctx, themes, { item: wantedItem, askedId: wantedAsked?.id ?? "" }));
      const more = [];
      if (publisher) more.push(wantedItem.status === "published" ? { label: ctx.t("actUnpublish"), action: "unpublish", confirm: ctx.t("confirmUnpublish") } : { label: ctx.t("actPublish"), action: "publish" });
      more.push({ label: ctx.t("actDelete"), action: "removeItem", confirm: ctx.t("confirmDeleteItem"), danger: true });
      blocks.push(extraActions(ctx, titleOf(ctx, wantedItem), wantedItem.id, more));
      if (wantedAsked) blocks.push(extraActions(ctx, wantedAsked.text, wantedAsked.id, [{ label: ctx.t("actDismiss"), action: "dismissAsked", confirm: ctx.t("confirmDismiss"), danger: true }]));
    } else if (wantedAsked) {
      blocks.push(itemForm(ctx, themes, { askedId: wantedAsked.id, prefill: { [wantedAsked.lang || ctx.defaultLocale]: wantedAsked.text } }));
      blocks.push(extraActions(ctx, wantedAsked.text, wantedAsked.id, [{ label: ctx.t("actDismiss"), action: "dismissAsked", confirm: ctx.t("confirmDismiss"), danger: true }]));
    }
    else if (q.new) blocks.push(itemForm(ctx, themes, { theme: typeof q.theme === "string" && themes.some((t) => t.id === q.theme) ? q.theme : "" }));
  }

  const href = pageHref(ctx);
  const links = [];
  if (editor) links.push({ label: ctx.t("linkNew"), href: `${here(ctx)}?new=1` });
  if (href) links.push({ label: ctx.t("linkSee"), href });
  if (links.length) blocks.push({ type: "links", items: links });
  if (href) blocks.push({ type: "copy", label: ctx.t("copyLabel"), text: fullUrl(ctx) || ctx.api.siteUrl });

  // Brouillons (dont ceux de l'assistant) : à relire, puis publier
  const drafts = items.filter((i) => i.status === "draft");
  if (drafts.length) {
    const actions = [];
    if (editor) actions.push({ label: ctx.t("actEdit"), href: "?edit={id}" });
    if (publisher) actions.push({ label: ctx.t("actPublish"), action: "publish" });
    blocks.push({ type: "heading", text: ctx.t("draftsTitle", { count: drafts.length }) });
    blocks.push({ type: "markdown", text: ctx.t("draftsHelp") });
    blocks.push({
      type: "table", columns: [ctx.t("colQuestion")],
      rows: drafts.map((i) => [`${titleOf(ctx, i)}\n${[themeLabel(ctx, themes, i.theme), langsCell(ctx, i), ctx.t(i.by === "assistant" ? "originAssistant" : "originTeam")].join(" · ")}`]),
      rowIds: drafts.map((i) => i.id), rowActions: actions,
    });
  }

  // Publiées, thème par thème
  const published = items.filter((i) => i.status === "published");
  blocks.push({ type: "heading", text: ctx.t("publishedTitle", { count: published.length }) });
  if (!published.length) blocks.push({ type: "markdown", text: ctx.t(items.length ? "publishedNoneDrafts" : "publishedNone") });
  const groups = [...themes.map((t) => ({ theme: t, name: themeName(ctx, t) || ctx.t("untitled"), items: siblings(items, t.id) })), { theme: null, name: ctx.t("noTheme"), items: published.filter((i) => !themes.some((t) => t.id === i.theme)) }];
  for (const g of groups) {
    if (!g.items.length) continue;
    const actions = [];
    if (editor) actions.push({ label: ctx.t("actEdit"), href: "?edit={id}" });
    if (themes.length) blocks.push({ type: "heading", text: g.name });
    blocks.push({
      type: "table", columns: [ctx.t("colQuestion")],
      rows: g.items.map((i) => [`${titleOf(ctx, i)}\n${langsCell(ctx, i)} · ${ctx.t("votesCell", { yes: i.y, no: i.n })}`]),
      rowIds: g.items.map((i) => i.id), rowActions: actions,
    });
    if (editor && g.items.length > 1) blocks.push({ type: "links", items: [{ label: ctx.t("linkOrder"), href: `${here(ctx)}?order=${g.theme ? g.theme.id : "none"}` }] });
  }
  if (published.some((i) => i.n >= 3 && i.n > i.y)) blocks.push({ type: "markdown", text: ctx.t("votesHint") });

  // Thèmes
  blocks.push({ type: "heading", text: ctx.t("themesTitle", { count: themes.length }) });
  blocks.push({ type: "markdown", text: ctx.t(themes.length ? "themesHelp" : "themesNone") });
  if (themes.length) {
    const actions = [];
    if (editor) actions.push({ label: ctx.t("actEdit"), href: "?theme={id}" });
    blocks.push({
      type: "table", columns: [ctx.t("colTheme")],
      rows: themes.map((t) => [`${themeName(ctx, t) || ctx.t("untitled")}\n${ctx.t("themeCount", { count: items.filter((i) => i.theme === t.id).length })}`]),
      rowIds: themes.map((t) => t.id), rowActions: actions,
    });
    if (editor && themes.length > 1) blocks.push({ type: "links", items: [{ label: ctx.t("linkOrderThemes"), href: `${here(ctx)}?order=themes` }] });
  }
  const editedTheme = typeof q.theme === "string" ? themes.find((t) => t.id === q.theme) : undefined;
  if (editor) blocks.push(themeForm(ctx, editedTheme));
  if (editor && editedTheme) blocks.push(extraActions(ctx, themeName(ctx, editedTheme) || ctx.t("untitled"), editedTheme.id, [{ label: ctx.t("actDelete"), action: "removeTheme", confirm: ctx.t("confirmDeleteTheme"), danger: true }]));

  // Ce que voient les moteurs de recherche
  if (flag(ctx, "markup", true) && published.length) {
    try {
      const { count, omitted } = markupHtml(ctx, await buildView(ctx));
      blocks.push({ type: "markdown", text: ctx.t(omitted ? "markupPartial" : "markupInfo", { count, omitted }) });
    } catch { /* information facultative */ }
  }

  // ── Onglet « Questions reçues » ────────────────────────────────────────────────
  const tab = "inbox";
  blocks.push({ type: "heading", text: ctx.t("inboxTitle", { count: asked.length }), tab });
  blocks.push({ type: "markdown", text: ctx.t(asked.length ? "inboxHelp" : "inboxNone", { days: retentionDays(ctx) }), tab });
  const rowsOf = (list) => list.map((a) => [`${a.text}\n${[a.lang ? a.lang.toUpperCase() : "", a.count > 1 ? ctx.t("askedTimes", { count: a.count }) : ctx.t("askedOnce"), day(a.last, ctx.locale)].filter(Boolean).join(" · ")}`]);
  const cols = [ctx.t("colQuestion")];
  if (fresh.length) {
    blocks.push({ type: "heading", text: ctx.t("inboxNewTitle", { count: fresh.length }), tab });
    const actions = [];
    if (editor) actions.push({ label: ctx.t("actAnswer"), href: "?answer={id}" }, { label: ctx.t("actDismiss"), action: "dismissAsked", confirm: ctx.t("confirmDismiss"), danger: true });
    blocks.push({ type: "table", columns: cols, rows: rowsOf(fresh), rowIds: fresh.map((a) => a.id), rowActions: actions, tab });
  }
  const ready = asked.filter((a) => a.status === "drafted");
  if (ready.length) {
    blocks.push({ type: "heading", text: ctx.t("inboxDraftTitle", { count: ready.length }), tab });
    blocks.push({ type: "markdown", text: ctx.t("inboxDraftHelp"), tab });
    const actions = [];
    if (editor) actions.push({ label: ctx.t("actReread"), href: "?answer={id}" });
    if (publisher) actions.push({ label: ctx.t("actPublish"), action: "publishAsked", confirm: ctx.t("confirmPublish") });
    blocks.push({ type: "table", columns: cols, rows: rowsOf(ready), rowIds: ready.map((a) => a.id), rowActions: actions, tab });
  }
  return blocks;
}

/** Les boutons rares (retirer, supprimer, écarter) : sous le formulaire, pour garder les listes étroites sur un téléphone. */
const extraActions = (ctx, label, id, rowActions) => ({ type: "table", columns: [ctx.t("colOther")], rows: [[label]], rowIds: [id], rowActions });

const themeLabel = (ctx, themes, id) => { const t = themes.find((x) => x.id === id); return t ? themeName(ctx, t) || ctx.t("untitled") : ctx.t("noTheme"); };

/** Menu de l'admin : le nombre de questions reçues qui attendent une réponse. */
export async function adminBadge(ctx) {
  return ctx.api.store.count(C.asked);
}

// ── Les actions ──────────────────────────────────────────────────────────────────────────────────────────────────────

async function saveItem(ctx, values) {
  const errors = {};
  const tr = {};
  const state = values.state === "published" ? "published" : "draft";
  const locales = localesOf(ctx);
  let touched = false;
  for (const l of locales) {
    const question = clean(values[`q_${l}`], LIMITS.question);
    const answer = clean(values[`a_${l}`], LIMITS.answer, true);
    if (question || answer) touched = true;
    if (question && answer) tr[l] = { q: question, a: answer };
    else if (state === "published" && question) errors[`a_${l}`] = ctx.t("errAnswerMissing", { lang: languageName(l, ctx.locale) });
    else if (state === "published" && answer) errors[`q_${l}`] = ctx.t("errQuestionMissing", { lang: languageName(l, ctx.locale) });
    else if (question || answer) tr[l] = { q: question, a: answer };
  }
  if (!touched) errors[`q_${locales[0]}`] = ctx.t("errEmptyItem");
  else if (state === "published" && !Object.keys(errors).length && !complete(tr)) errors[`q_${locales[0]}`] = ctx.t("errEmptyItem");
  const themes = await loadThemes(ctx);
  const theme = typeof values.theme === "string" && themes.some((t) => t.id === values.theme) ? values.theme : "";
  if (Object.keys(errors).length) return { errors };

  return locked(ctx, async () => {
    const askedId = typeof values.askedId === "string" ? values.askedId : "";
    let id = typeof values.id === "string" ? values.id : "";
    let wasPublishedBefore = false;
    if (id) {
      const row = await getRow(ctx, id, "item");
      if (!row) return { error: ctx.t("errNotFound") };
      const wasPublished = row.data.status === "published";
      wasPublishedBefore = wasPublished;
      if ((state === "published") !== wasPublished && !can(ctx, "publish")) return { errors: { state: ctx.t("errNoPublishRight") } }; // publier ou retirer demande le droit de publier
      const items = await loadItems(ctx);
      const keep = { ...row.data, tr, theme, status: wasPublished && state === "published" ? "published" : "draft" };
      if (wasPublished && row.data.theme !== theme) keep.pos = nextPos(siblings(items, theme)); // changer de thème : à la fin du nouveau
      if (values.resetVotes === "on") { keep.y = 0; keep.n = 0; }
      await ctx.api.store.update(id, keep);
      if (state === "published" && !wasPublished && !(await publishRow(ctx, id))) return { error: ctx.t("errNotComplete") };
    } else {
      if (state === "published" && !can(ctx, "publish")) return { errors: { state: ctx.t("errNoPublishRight") } };
      id = await createRow(ctx, { tr, theme, status: "draft", from: askedId });
      if (!id) return { error: ctx.t("errFull", { max: LIMITS.items }) };
      if (state === "published" && !(await publishRow(ctx, id))) return { error: ctx.t("errNotComplete") };
    }
    if (askedId) {
      if (state === "published") { const a = await getRow(ctx, askedId, "asked"); if (a) await ctx.api.store.remove(askedId); }
      else await linkAsked(ctx, askedId, id);
    }
    return { ok: ctx.t(state === "published" && !wasPublishedBefore ? "okPublished" : "okSaved"), redirect: "?" };
  });
}

async function publish(ctx, values) {
  return locked(ctx, async () => {
    const row = await getRow(ctx, values.id, "item");
    if (!row) return { error: ctx.t("errNotFound") };
    if (row.data.status === "published") return { ok: ctx.t("okAlreadyPublished") };
    return (await publishRow(ctx, values.id)) ? { ok: ctx.t("okPublished") } : { error: ctx.t("errNotComplete") };
  });
}

async function unpublish(ctx, values) {
  return locked(ctx, async () => {
    const row = await getRow(ctx, values.id, "item");
    if (!row) return { error: ctx.t("errNotFound") };
    await ctx.api.store.update(row.id, { ...row.data, status: "draft" });
    return { ok: ctx.t("okUnpublished") };
  });
}

async function publishAsked(ctx, values) {
  return locked(ctx, async () => {
    const asked = await getRow(ctx, values.id, "asked");
    const draft = asked && typeof asked.data.draft === "string" ? asked.data.draft : "";
    if (!draft) return { error: ctx.t("errNoDraft") };
    return (await publishRow(ctx, draft)) ? { ok: ctx.t("okPublished") } : { error: ctx.t("errNotComplete") };
  });
}

async function dismissAsked(ctx, values) {
  return locked(ctx, async () => {
    const asked = await getRow(ctx, values.id, "asked");
    if (!asked) return { error: ctx.t("errNotFound") };
    await ctx.api.store.remove(asked.id);
    return { ok: ctx.t("okDismissed") };
  });
}

async function move(ctx, values, step) {
  return locked(ctx, async () => {
    const items = await loadItems(ctx);
    const item = items.find((i) => i.id === values.id);
    if (!item || item.status !== "published") return { error: ctx.t("errNotFound") };
    const list = siblings(items, item.theme);
    const at = list.findIndex((i) => i.id === item.id);
    const to = at + step;
    if (to < 0 || to >= list.length) return { ok: ctx.t(step < 0 ? "okFirst" : "okLast") };
    [list[at], list[to]] = [list[to], list[at]];
    await renumber(ctx, list);
    return { ok: ctx.t("okMoved") };
  });
}

async function removeItem(ctx, values) {
  return locked(ctx, async () => {
    const row = await getRow(ctx, values.id, "item");
    if (!row) return { error: ctx.t("errNotFound") };
    await deleteRow(ctx, row.id);
    return { ok: ctx.t("okDeleted") };
  });
}

async function saveTheme(ctx, values) {
  const locales = localesOf(ctx);
  const names = {};
  for (const l of locales) { const n = clean(values[`name_${l}`], LIMITS.themeName); if (n) names[l] = n; }
  if (!Object.keys(names).length) return { errors: { [`name_${locales[0]}`]: ctx.t("errThemeName") } };
  return locked(ctx, async () => {
    const themes = await loadThemes(ctx);
    const id = typeof values.id === "string" ? values.id : "";
    if (id) {
      const row = await getRow(ctx, id, "theme");
      if (!row) return { error: ctx.t("errNotFound") };
      await ctx.api.store.update(id, { ...row.data, names });
      return { ok: ctx.t("okSaved"), redirect: "?" };
    }
    if (themes.length >= LIMITS.themes) return { error: ctx.t("errThemesFull", { max: LIMITS.themes }) };
    await ctx.api.store.add(C.themes, { names, pos: themes.reduce((m, t) => Math.max(m, t.pos), 0) + 1 });
    return { ok: ctx.t("okThemeAdded"), redirect: "?" };
  });
}

async function moveTheme(ctx, values, step) {
  return locked(ctx, async () => {
    const themes = await loadThemes(ctx);
    const at = themes.findIndex((t) => t.id === values.id);
    if (at < 0) return { error: ctx.t("errNotFound") };
    const to = at + step;
    if (to < 0 || to >= themes.length) return { ok: ctx.t(step < 0 ? "okFirst" : "okLast") };
    [themes[at], themes[to]] = [themes[to], themes[at]];
    await renumber(ctx, themes);
    return { ok: ctx.t("okMoved") };
  });
}

async function removeTheme(ctx, values) {
  return locked(ctx, async () => {
    const row = await getRow(ctx, values.id, "theme");
    if (!row) return { error: ctx.t("errNotFound") };
    // Ses questions ne sont pas supprimées : elles passent « sans thème », à la suite des autres.
    const items = await loadItems(ctx);
    let pos = nextPos(siblings(items, ""));
    for (const i of items.filter((x) => x.theme === row.id)) {
      const r = await getRow(ctx, i.id, "item");
      if (r) await ctx.api.store.update(i.id, { ...r.data, theme: "", pos: pos++ });
    }
    await ctx.api.store.remove(row.id);
    await renumber(ctx, await loadThemes(ctx));
    return { ok: ctx.t("okThemeDeleted") };
  });
}

export const adminActions = {
  saveItem: { right: "edit", run: saveItem },
  publish: { right: "publish", run: publish },
  unpublish: { right: "publish", run: unpublish },
  moveUp: { right: "edit", run: (ctx, v) => move(ctx, v, -1) },
  moveDown: { right: "edit", run: (ctx, v) => move(ctx, v, 1) },
  removeItem: { right: "edit", run: removeItem },
  saveTheme: { right: "edit", run: saveTheme },
  themeUp: { right: "edit", run: (ctx, v) => moveTheme(ctx, v, -1) },
  themeDown: { right: "edit", run: (ctx, v) => moveTheme(ctx, v, 1) },
  removeTheme: { right: "edit", run: removeTheme },
  publishAsked: { right: "publish", run: publishAsked },
  dismissAsked: { right: "edit", run: dismissAsked },
};
