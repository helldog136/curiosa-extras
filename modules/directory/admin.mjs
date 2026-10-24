// Annuaire — la page d'administration (mobile d'abord, FR + EN, mots simples). Six choses :
//   1. où en est l'annuaire (combien de personnes, qui est caché et pourquoi) et un lien pour le voir ;
//   2. un gabarit de départ (seulement tant que rien n'est réglé) ;
//   3. les catégories PUBLIQUES (cases à cocher avec recherche, libellé public, ordre) ;
//   4. l'équipe (qui, quel titre, dans quel ordre) ;
//   5. les personnes visibles (chercher, modifier la fiche publique : présentation et ville, masquer ici) ;
//   6. remettre en ordre (suivre les fiches fusionnées, retirer ce qui visait une fiche supprimée).
// Les noms et les photos ne sont PAS à nous : ils sont lus dans Contacts. Ici, on garde « fiche → présentation, ville, masquée, titre » et « les catégories publiques ».
const v = new URL(import.meta.url).search;
const P = await import(`./pure.mjs${v}`);
const C = await import(`./contacts.mjs${v}`);
const D = await import(`./data.mjs${v}`);
const Dir = await import(`./directory.mjs${v}`);
const View = await import(`./view.mjs${v}`);
const T = await import(`./templates.mjs${v}`);
const G = await import(`./geocode.mjs${v}`);
const { LIMITS, clean, fold, idOk } = P;

export const RIGHT_EDIT = "edit";
export const RIGHT_HIDE = "hide";
const can = (ctx, right) => typeof ctx.can === "function" && ctx.can(right) === true;
const str = (x) => (typeof x === "string" ? x : Array.isArray(x) && typeof x[0] === "string" ? x[0] : "");
const enc = encodeURIComponent;
const back = (ok, extra = {}) => ({ ok, redirect: "?", ...extra });
const backLinks = (ctx) => ({ type: "links", items: [{ label: ctx.t("back"), href: "?" }] });

/** Les champs « un texte par langue du site » d'un formulaire. */
const textFields = (ctx, prefix, values, { label, help, max, kind = "text" }) => ctx.locales.map((loc) => ({
  name: `${prefix}_${loc}`, kind, label: ctx.locales.length > 1 ? `${ctx.t(label)} (${loc.toUpperCase()})` : ctx.t(label), value: values?.[loc] ?? "", help: ctx.t(help, { max }),
}));
const readTexts = (ctx, prefix, values, max, multiline = false) => Object.fromEntries(ctx.locales.map((loc) => [loc, P.clean(values[`${prefix}_${loc}`], max + 50, multiline)]).filter(([, t]) => t));
const tooLong = (ctx, prefix, texts, max) => { for (const [loc, text] of Object.entries(texts)) if ([...text].length > max) return { [`${prefix}_${loc}`]: ctx.t("errTooLong", { max }) }; return null; };

/* ───────────── Le panneau ───────────── */

export async function panel(ctx, { query = {} } = {}) {
  const t = ctx.t;
  const book = await C.providers(ctx);
  if (!book.length) {
    return [
      { type: "banner", tone: "warning", text: t("adminNoBook") },
      { type: "suggestInstall", service: C.SERVICE, min: 2, reason: t("suggestReason") },
    ];
  }
  const contactsPath = `/admin/instances/${book[0].id}`;
  // Un écran à part pour une tâche précise : on revient d'un clic.
  if (str(query.cats)) return categoriesScreen(ctx, query);
  if (P.slugOk(str(query.label))) return labelScreen(ctx, str(query.label));
  if (P.slugOk(str(query.bind))) return bindScreen(ctx, str(query.bind), query);
  if (str(query.team)) return teamSearchScreen(ctx, query);
  if (idOk(str(query.role))) return roleScreen(ctx, str(query.role));
  if (idOk(str(query.person))) return personScreen(ctx, str(query.person));

  const model = await C.getModel(ctx, { maxAgeMs: C.timing.adminFreshMs, waitMs: 7000 });
  const data = await D.readData(ctx, { fresh: true });
  const view = model.state === "ok" ? Dir.getView(ctx, model, data) : null;
  const blocks = [];
  blocks.push(...statusBlocks(ctx, model, view, data, contactsPath));
  blocks.push(...templateBlocks(ctx, data));
  blocks.push(...categoryBlocks(ctx, model, view, data));
  blocks.push(...teamBlocks(ctx, model, view, data));
  if (view) blocks.push(...peopleBlocks(ctx, view, query));
  blocks.push(...tidyBlocks(ctx, data));
  return blocks;
}

/* ───────────── 1. Où en est l'annuaire ───────────── */

function statusBlocks(ctx, model, view, data, contactsPath) {
  const t = ctx.t, out = [];
  if (model.state === "slow") out.push({ type: "banner", tone: "warning", text: t("adminSlow") });
  else if (model.state === "absent") out.push({ type: "banner", tone: "warning", text: t("adminNoBook") }, { type: "suggestInstall", service: C.SERVICE, min: 2, reason: t("suggestReason") });
  else if (model.state === "unready") out.push({ type: "banner", tone: "info", text: t(`adminUnready_${model.reason}`) });
  else {
    if (model.stale) out.push({ type: "banner", tone: "warning", text: t("adminStale") });
    if (model.partial) out.push({ type: "banner", tone: "warning", text: t("adminPartial") });
    if (model.truncated) out.push({ type: "banner", tone: "info", text: t("adminTruncated", { max: LIMITS.perCategory, all: LIMITS.indexMax }) });
    if (model.hideHow === "gone") out.push({ type: "banner", tone: "warning", text: t("adminHideGone"), href: "?tab=settings" });
    if (model.consentState === "gone") out.push({ type: "banner", tone: "warning", text: t("adminConsentGone"), href: "?tab=settings" });
    if (model.mapState === "gone") out.push({ type: "banner", tone: "warning", text: t("adminMapGone"), href: "?tab=settings" });
    for (const p of model.problems) if (p.type === "gone") out.push({ type: "banner", tone: "warning", text: t("adminCatGone", { label: labelOfSlug(ctx, data.config, p.slug) }) });
    if (model.teamMissing.length) out.push({ type: "banner", tone: "warning", text: t("adminTeamMissing", { n: model.teamMissing.length }) });
  }
  if (view) {
    out.push({ type: "heading", text: t("adminTitle") });
    out.push({ type: "markdown", text: view.entries.length || view.team.length ? t("adminSummary", { people: view.entries.length, team: view.team.length, cats: view.cats.length }) : t("adminEmpty") });
    out.push({ type: "markdown", text: model.hideHow === "none" || model.hideHow === "gone" ? t("adminHideNone") : t("adminHideHow", { category: model.hideLabel || "—", hidden: model.hiddenN }) });
    if (model.consentState === "ok") out.push({ type: "markdown", text: t("adminConsentOn", { category: model.consentLabel || "—", n: view.noConsent.length }) });
    if (model.mapState === "ok") out.push({ type: "markdown", text: t("adminMapOn", { category: model.mapLabel || "—", n: view.mapPlaces.length }) });
    out.push({ type: "links", items: [{ label: t("adminSeeDirectory"), href: View.baseOf(ctx) || "/" }, { label: t("adminOpenContacts"), href: contactsPath }] });
  }
  return out;
}

const labelOfSlug = (ctx, config, slug) => { const c = config.cats.find((x) => x.slug === slug); return c ? clean(P.pickText(c.label, ctx.locale, ctx.defaultLocale), 60) || slug : slug; };

/* ───────────── 2. Un gabarit de départ ───────────── */

function templateBlocks(ctx, data) {
  const t = ctx.t;
  if (data.config.cats.length || data.config.team.length || !can(ctx, RIGHT_EDIT)) return [];
  return [
    { type: "heading", text: t("tplTitle") },
    { type: "markdown", text: t("tplIntro") },
    { type: "adminForm", action: "template", submitLabel: t("tplApply"), fields: [
      { name: "template", kind: "select", label: t("tplField"), value: "association", required: true, help: t("tplHelp"), options: T.TEMPLATE_IDS.map((id) => ({ value: id, label: t(`tpl_${id}`) })) },
    ] },
  ];
}

/* ───────────── 3. Les catégories publiques ───────────── */

function categoryBlocks(ctx, model, view, data) {
  const t = ctx.t, out = [];
  const writable = can(ctx, RIGHT_EDIT);
  out.push({ type: "heading", text: t("catTitle") });
  out.push({ type: "markdown", text: t("catIntro") });
  const cats = data.config.cats;
  if (!cats.length) {
    out.push({ type: "markdown", text: t("catNone") });
  } else {
    const live = (slug) => view?.cats.find((c) => c.slug === slug);
    const rows = cats.map((c, i) => {
      const l = live(c.slug);
      const status = !c.catId ? t("catUnbound") : view && !l?.live ? t("catGone") : l ? (l.name || "—") : "…";
      return [`${i + 1}. ${clean(P.pickText(c.label, ctx.locale, ctx.defaultLocale), 60) || l?.name || c.slug} · ${t("catRowInfo", { contacts: status, n: l ? l.count : 0 })}`];
    });
    out.push({
      type: "table", columns: [t("colCategory")], rows, rowIds: cats.map((c) => c.slug),
      rowActions: writable ? [{ label: t("rowEdit"), href: "?label={id}" }] : [],
    });
  }
  if (writable) out.push({ type: "links", items: [{ label: cats.length ? t("catAddMore") : t("catAdd"), href: "?cats=1" }] });
  return out;
}

/** Choisir les catégories publiques : les catégories de Contacts avec une case à cocher, une recherche et des pages. */
async function categoriesScreen(ctx, query) {
  const t = ctx.t;
  if (!can(ctx, RIGHT_EDIT)) return [{ type: "banner", tone: "warning", text: t("adminNoRight") }, backLinks(ctx)];
  const cq = clean(str(query.cq), 100), cursor = str(query.ccur) || null;
  const list = await C.listCategories(ctx, { q: cq, cursor: cursor && cursor.length <= 500 ? cursor : null, limit: LIMITS.adminPage });
  const data = await D.readData(ctx, { fresh: true });
  const out = [{ type: "heading", text: t("pickTitle") }, { type: "markdown", text: t("pickIntro") }];
  if (list.state !== "ok") return [...out, { type: "banner", tone: "warning", text: t("adminSlow") }, backLinks(ctx)];
  out.push({ type: "adminForm", action: "catSearch", submitLabel: t("pickSearchButton"), fields: [{ name: "q", kind: "text", label: t("pickSearchLabel"), value: cq, help: t("pickSearchHelp") }] });
  const have = new Set(data.config.cats.map((c) => c.catId).filter(Boolean));
  if (!list.items.length) out.push({ type: "markdown", text: cq ? t("pickNone") : t("pickNoCategory") });
  else {
    out.push({
      type: "adminForm", action: "catPick", submitLabel: t("pickSave"), cancelHref: "?",
      fields: list.items.flatMap((k, i) => [
        { name: `id_${i}`, kind: "hidden", value: k.id },
        { name: `name_${i}`, kind: "hidden", value: k.name },
        { name: `pick_${i}`, kind: "checkbox", label: k.name, value: have.has(k.id) ? "on" : "" },
      ]),
    });
    if (list.next) out.push({ type: "links", items: [{ label: t("pickMore"), href: `?cats=1${cq ? `&cq=${enc(cq)}` : ""}&ccur=${enc(list.next)}` }] });
  }
  // Pas encore de catégorie qui convienne : en créer une dans Contacts, d'ici.
  out.push({ type: "heading", text: t("pickCreateTitle") });
  out.push({ type: "adminForm", action: "catCreate", submitLabel: t("pickCreateButton"), fields: [{ name: "name", kind: "text", label: t("pickCreateLabel"), required: true, help: t("pickCreateHelp") }] });
  out.push(backLinks(ctx));
  return out;
}

async function labelScreen(ctx, slug) {
  const t = ctx.t;
  const data = await D.readData(ctx, { fresh: true });
  const cat = data.config.cats.find((c) => c.slug === slug);
  if (!can(ctx, RIGHT_EDIT)) return [{ type: "banner", tone: "warning", text: t("adminNoRight") }, backLinks(ctx)];
  if (!cat) return [{ type: "banner", tone: "warning", text: t("catGoneBanner") }, backLinks(ctx)];
  return [
    { type: "heading", text: t("labelTitle", { label: clean(P.pickText(cat.label, ctx.locale, ctx.defaultLocale), 60) || slug }) },
    { type: "adminForm", action: "catLabel", submitLabel: t("labelSave"), cancelHref: "?", fields: [
      { name: "slug", kind: "hidden", value: slug },
      ...textFields(ctx, "label", cat.label, { label: "labelField", help: "labelHelp", max: LIMITS.label }),
    ] },
    { type: "heading", text: t("catMoreTitle") },
    { type: "adminForm", action: "catUp", submitLabel: t("catUp"), fields: [{ name: "id", kind: "hidden", value: slug }] },
    { type: "adminForm", action: "catDown", submitLabel: t("catDown"), fields: [{ name: "id", kind: "hidden", value: slug }] },
    { type: "links", items: [{ label: t("catBind"), href: `?bind=${slug}` }] },
    { type: "adminForm", action: "catRemove", submitLabel: t("catRemove"), fields: [{ name: "id", kind: "hidden", value: slug }] },
  ];
}

/** Relier une catégorie de départ à une catégorie de Contacts. */
async function bindScreen(ctx, slug, query) {
  const t = ctx.t;
  if (!can(ctx, RIGHT_EDIT)) return [{ type: "banner", tone: "warning", text: t("adminNoRight") }, backLinks(ctx)];
  const data = await D.readData(ctx, { fresh: true });
  const cat = data.config.cats.find((c) => c.slug === slug);
  if (!cat) return [{ type: "banner", tone: "warning", text: t("catGoneBanner") }, backLinks(ctx)];
  const bq = clean(str(query.bq), 100);
  const list = await C.listCategories(ctx, { q: bq, limit: LIMITS.adminPage });
  const out = [{ type: "heading", text: t("bindTitle", { label: clean(P.pickText(cat.label, ctx.locale, ctx.defaultLocale), 60) || slug }) }, { type: "markdown", text: t("bindIntro") }];
  if (list.state !== "ok") return [...out, { type: "banner", tone: "warning", text: t("adminSlow") }, backLinks(ctx)];
  out.push({ type: "adminForm", action: "bindSearch", submitLabel: t("pickSearchButton"), fields: [{ name: "slug", kind: "hidden", value: slug }, { name: "q", kind: "text", label: t("pickSearchLabel"), value: bq, help: t("pickSearchHelp") }] });
  if (!list.items.length) out.push({ type: "markdown", text: bq ? t("pickNone") : t("pickNoCategory") });
  else out.push({ type: "table", columns: [t("colCategory")], rows: list.items.map((k) => [k.name]), rowIds: list.items.map((k) => `${slug}:${k.id}`), rowActions: [{ label: t("bindChoose"), action: "bindPick" }] });
  out.push(backLinks(ctx));
  return out;
}

/* ───────────── 4. L'équipe ───────────── */

function teamBlocks(ctx, model, view, data) {
  const t = ctx.t, out = [];
  const writable = can(ctx, RIGHT_EDIT);
  out.push({ type: "heading", text: t("teamTitleAdmin") });
  out.push({ type: "markdown", text: t("teamIntro") });
  const team = data.config.team;
  if (!team.length) out.push({ type: "markdown", text: t("teamNone") });
  else {
    const rows = team.map((m, i) => {
      const p = model.people?.get?.(m.contactId);
      const state = !p ? (model.teamMissing?.includes(m.contactId) ? t("teamStateMissing") : model.teamBlocked?.includes(m.contactId) ? t("teamStateHidden") : "…")
        : data.profiles.get(m.contactId)?.hidden ? t("teamStateMasked") : view && !view.team.some((e) => e.id === m.contactId) ? t("teamStateConsent") : "";
      const name = p ? P.shownName(p, view?.style ?? "card") : "—";
      return [[`${i + 1}. ${name}`, clean(P.pickText(m.role, ctx.locale, ctx.defaultLocale), LIMITS.role) || "—", state].filter(Boolean).join(" · ")];
    });
    out.push({
      type: "table", columns: [t("colPerson")], rows, rowIds: team.map((m) => m.contactId),
      rowActions: writable ? [{ label: t("rowEdit"), href: "?role={id}" }] : [],
    });
  }
  if (writable) out.push({ type: "links", items: [{ label: t("teamAdd"), href: "?team=1" }] });
  return out;
}

async function teamSearchScreen(ctx, query) {
  const t = ctx.t;
  if (!can(ctx, RIGHT_EDIT)) return [{ type: "banner", tone: "warning", text: t("adminNoRight") }, backLinks(ctx)];
  const tq = clean(str(query.tq), 100);
  const out = [{ type: "heading", text: t("teamAdd") }, { type: "adminForm", action: "teamSearch", submitLabel: t("honorSearchButton"), fields: [{ name: "q", kind: "text", label: t("honorSearchLabel"), value: tq, help: t("honorSearchHelp") }] }];
  if (tq) {
    const found = await C.searchPeople(ctx, tq);
    if (found.state !== "ok") out.push({ type: "banner", tone: "warning", text: t("adminSlow") });
    else if (!found.items.length) out.push({ type: "markdown", text: t("honorSearchNone") });
    else out.push({ type: "table", columns: [t("colPerson")], rows: found.items.map((x) => [x.name]), rowIds: found.items.map((x) => x.id), rowActions: [{ label: t("teamChoose"), href: "?role={id}" }] });
  }
  out.push(backLinks(ctx));
  return out;
}

async function roleScreen(ctx, id) {
  const t = ctx.t;
  if (!can(ctx, RIGHT_EDIT)) return [{ type: "banner", tone: "warning", text: t("adminNoRight") }, backLinks(ctx)];
  const r = await C.resolveForAdmin(ctx, [id]);
  if (r.state !== "ok") return [{ type: "banner", tone: "warning", text: t("adminSlow") }, backLinks(ctx)];
  const card = r.cards.get(id);
  if (!card) return [{ type: "banner", tone: "warning", text: t(r.blocked.includes(id) ? "personBlocked" : "personGone") }, backLinks(ctx)];
  const cardId = r.moved[id] ?? id;
  const data = await D.readData(ctx, { fresh: true });
  const cur = data.config.team.find((m) => m.contactId === cardId);
  return [
    { type: "heading", text: t("roleTitle", { name: P.shownName(card, "card") }) },
    { type: "adminForm", action: "teamSave", submitLabel: cur ? t("roleSave") : t("roleAdd"), cancelHref: "?", fields: [
      { name: "contactId", kind: "hidden", value: cardId },
      ...textFields(ctx, "role", cur?.role, { label: "roleField", help: "roleHelp", max: LIMITS.role }),
    ] },
    ...(cur ? [
      { type: "heading", text: t("catMoreTitle") },
      { type: "adminForm", action: "teamUp", submitLabel: t("catUp"), fields: [{ name: "id", kind: "hidden", value: cardId }] },
      { type: "adminForm", action: "teamDown", submitLabel: t("catDown"), fields: [{ name: "id", kind: "hidden", value: cardId }] },
      { type: "adminForm", action: "teamRemove", submitLabel: t("teamRemoveButton"), fields: [{ name: "id", kind: "hidden", value: cardId }] },
    ] : []),
  ];
}

/* ───────────── 5. Les personnes ───────────── */

function peopleBlocks(ctx, view, query) {
  const t = ctx.t, out = [];
  const showHidden = str(query.show) === "hidden";
  out.push({ type: "heading", text: showHidden ? t("hiddenTitle") : t("peopleTitle") });
  const links = [{ label: showHidden ? t("peopleShowVisible") : t("peopleShowHidden", { n: view.hiddenHere.length }), href: showHidden ? "?" : "?show=hidden" }];
  if (showHidden) {
    out.push({ type: "markdown", text: t("hiddenIntro") });
    if (!view.hiddenHere.length) out.push({ type: "markdown", text: t("hiddenNone") });
    else out.push({ type: "table", columns: [t("colPerson")], rows: view.hiddenHere.slice(0, 200).map((h) => [h.name]), rowIds: view.hiddenHere.slice(0, 200).map((h) => h.id), rowActions: can(ctx, RIGHT_HIDE) ? [{ label: t("peopleUnhide"), action: "unhide" }] : [] });
    out.push({ type: "links", items: links });
    return out;
  }
  out.push({ type: "markdown", text: t("peopleIntro") });
  const all = [...view.all].sort((a, b) => (a.fname < b.fname ? -1 : a.fname > b.fname ? 1 : 0));
  const pq = clean(str(query.pq), 100);
  const filtered = pq ? all.filter((e) => e.key.includes(fold(pq))) : all;
  const pages = Math.max(1, Math.ceil(filtered.length / LIMITS.adminPage));
  const page = Math.min(pages, Math.max(1, P.int(str(query.ppage), 1, 1, 100000)));
  const slice = filtered.slice((page - 1) * LIMITS.adminPage, page * LIMITS.adminPage);
  if (all.length > LIMITS.adminPage || pq) out.push({ type: "adminForm", action: "peopleSearch", submitLabel: t("pickSearchButton"), fields: [{ name: "q", kind: "text", label: t("peopleSearchLabel"), value: pq, help: t("peopleSearchHelp") }] });
  if (!filtered.length) out.push({ type: "markdown", text: all.length ? t("peopleNoMatch") : t("peopleNone") });
  else {
    const actions = [];
    if (can(ctx, RIGHT_EDIT)) actions.push({ label: t("peopleEdit"), href: "?person={id}" });
    if (can(ctx, RIGHT_HIDE)) actions.push({ label: t("peopleHide"), action: "hide", confirm: t("peopleHideConfirm"), danger: true });
    out.push({
      type: "table", columns: [t("colPerson")],
      rows: slice.map((e) => [[e.isTeam ? `${e.name} ★` : e.name, e.catSlugs.map((s) => view.cats.find((c) => c.slug === s)).filter(Boolean).map((c) => Dir.catLabel(ctx, c)).join(", "), [Object.keys(e.bio).length ? t("hasBio") : "", e.city].filter(Boolean).join(", ")].filter(Boolean).join(" · ")]),
      rowIds: slice.map((e) => e.id), rowActions: actions,
    });
    if (pages > 1) {
      const link = (n, label) => ({ label, href: `?ppage=${n}${pq ? `&pq=${enc(pq)}` : ""}` });
      out.push({ type: "links", items: [...(page > 1 ? [link(page - 1, t("msgPrev"))] : []), ...(page < pages ? [link(page + 1, t("msgNext"))] : [])] });
      out.push({ type: "markdown", text: t("msgPageOf", { page, pages }) });
    }
  }
  out.push({ type: "links", items: links });
  return out;
}

/** La fiche publique d'une personne : présentation courte et ville. */
async function personScreen(ctx, id) {
  const t = ctx.t;
  if (!can(ctx, RIGHT_EDIT)) return [{ type: "banner", tone: "warning", text: t("adminNoRight") }, backLinks(ctx)];
  const r = await C.resolveForAdmin(ctx, [id]);
  if (r.state !== "ok") return [{ type: "banner", tone: "warning", text: t("adminSlow") }, backLinks(ctx)];
  const card = r.cards.get(id);
  if (!card) return [{ type: "banner", tone: "warning", text: t(r.blocked.includes(id) ? "personBlocked" : "personGone") }, backLinks(ctx)];
  const cardId = r.moved[id] ?? id;
  const data = await D.readData(ctx, { fresh: true });
  const cur = data.profiles.get(cardId);
  const mapSet = r.mapId ? { state: "ok", id: r.mapId } : { state: "unset" };
  const onMap = mapSet.state === "ok" && card.cats.includes(mapSet.id);
  const mapNote = mapSet.state !== "ok" ? t("personMapOff") : onMap ? t("personMapYes") : t("personMapNo");
  return [
    { type: "heading", text: t("personTitle", { name: P.shownName(card, "card") }) },
    { type: "markdown", text: t("personIntro") },
    ...(cur?.geo ? [{ type: "markdown", text: t("personGeoNow", { lat: cur.geo.lat, lng: cur.geo.lng }) }] : []),
    { type: "adminForm", action: "personSave", submitLabel: t("personSave"), cancelHref: "?", fields: [
      { name: "contactId", kind: "hidden", value: cardId },
      ...textFields(ctx, "bio", cur?.bio, { label: "bioField", help: "bioHelp", max: LIMITS.bio, kind: "textarea" }),
      { name: "city", kind: "text", label: t("cityField"), value: cur?.city ?? "", help: `${t("cityHelp")} ${mapNote}` },
    ] },
    ...(can(ctx, RIGHT_HIDE) ? [{ type: "heading", text: t("catMoreTitle") }, { type: "adminForm", action: "hide", submitLabel: t("peopleHide"), fields: [{ name: "id", kind: "hidden", value: cardId }] }] : []),
  ];
}

/* ───────────── 6. Remettre en ordre ───────────── */

function tidyBlocks(ctx, data) {
  if (!can(ctx, RIGHT_EDIT) || (!data.profiles.size && !data.config.team.length && !data.config.cats.length)) return [];
  const t = ctx.t;
  return [
    { type: "heading", text: t("tidyTitle") },
    { type: "markdown", text: t("tidyIntro") },
    { type: "adminForm", action: "tidy", submitLabel: t("tidyButton"), fields: [{ name: "go", kind: "hidden", value: "1" }] },
  ];
}

/* ───────────── Les actions ───────────── */

const saved = (ctx, r, okText) => (r?.ok ? back(okText) : { error: ctx.t(r?.code === "too_many" ? "errTooMany" : "errSave") });

async function checkPerson(ctx, id) {
  const r = await C.resolveForAdmin(ctx, [id]);
  if (r.state !== "ok") return { error: ctx.t("adminSlow") };
  const card = r.cards.get(id);
  if (!card) return { error: ctx.t(r.blocked.includes(id) ? "personBlocked" : "personGone") };
  return { card, id: r.moved[id] ?? id, mapId: r.mapId };
}

export const actions = {
  /* Gabarit */
  template: { right: RIGHT_EDIT, async run(ctx, values) {
    const id = clean(values.template, 30);
    if (!T.TEMPLATE_IDS.includes(id)) return { errors: { template: ctx.t("errTemplate") } };
    const tpl = T.TEMPLATES[id];
    const r = await D.updateConfig(ctx, (config) => {
      if (config.cats.length || config.team.length) return { ok: false, code: "busy" };
      config.template = id;
      config.vocab = structuredClone(tpl.vocab);
      for (const c of tpl.cats) config.cats.push({ slug: D.freeSlug(config, c[ctx.defaultLocale] ?? c.en ?? c.fr), catId: null, label: structuredClone(c) });
      return { ok: true };
    });
    if (!r.ok) return { error: ctx.t("tplBusy") };
    // Les catégories de départ sont créées dans Contacts au nom de la personne qui clique (si elle en a le droit) ; sinon elles restent « à relier ».
    const data = await D.readData(ctx, { fresh: true });
    let created = 0, pending = 0;
    for (const c of data.config.cats.filter((x) => !x.catId)) {
      const made = await C.createCategory(ctx, P.pickText(c.label, ctx.defaultLocale, ctx.defaultLocale));
      if (made.ok) { const b = await D.bindCategory(ctx, c.slug, made.id); if (b.ok) { created++; continue; } }
      pending++;
    }
    D.forgetData(ctx);
    return back(pending ? ctx.t("tplDonePending", { created, pending }) : ctx.t("tplDone", { created }));
  } },

  /* Catégories publiques */
  catSearch: { right: RIGHT_EDIT, async run(ctx, values) { const q = clean(values.q, 100); return { redirect: q ? `?cats=1&cq=${enc(q)}` : "?cats=1" }; } },
  catPick: { right: RIGHT_EDIT, async run(ctx, values) {
    const add = [], drop = [];
    const data = await D.readData(ctx, { fresh: true });
    const byId = new Map(data.config.cats.filter((c) => c.catId).map((c) => [c.catId, c.slug]));
    for (let i = 0; i < LIMITS.adminPage + 5; i++) {
      const id = clean(values[`id_${i}`], LIMITS.id);
      if (!idOk(id)) continue;
      const on = values[`pick_${i}`] === "on";
      if (on && !byId.has(id)) add.push({ catId: id, label: clean(values[`name_${i}`], LIMITS.label) });
      if (!on && byId.has(id)) drop.push(byId.get(id));
    }
    if (!add.length && !drop.length) return { redirect: "?", ok: ctx.t("pickNothing") };
    let full = false, added = 0;
    if (add.length) { const r = await D.addCategories(ctx, add); full = !!r.full; added = r.added ?? 0; }
    for (const slug of drop) await D.removeCategory(ctx, slug);
    if (full) return { error: ctx.t("errCatsFull", { max: LIMITS.cats }) };
    return back(ctx.t("pickDone", { added, removed: drop.length }));
  } },
  catCreate: { right: RIGHT_EDIT, async run(ctx, values) {
    const name = clean(values.name, 100);
    if (!name) return { errors: { name: ctx.t("errName") } };
    const made = await C.createCategory(ctx, name);
    if (!made.ok) return { errors: { name: made.why === "denied" ? ctx.t("errCreateDenied") : ctx.t("errCreate") } };
    const r = await D.addCategories(ctx, [{ catId: made.id, label: name }]);
    return r.full ? { error: ctx.t("errCatsFull", { max: LIMITS.cats }) } : back(ctx.t("pickCreated", { name }));
  } },
  catUp: { right: RIGHT_EDIT, async run(ctx, values) { await D.moveCategory(ctx, clean(values.id, 40), -1); return { redirect: "?" }; } },
  catDown: { right: RIGHT_EDIT, async run(ctx, values) { await D.moveCategory(ctx, clean(values.id, 40), 1); return { redirect: "?" }; } },
  catRemove: { right: RIGHT_EDIT, async run(ctx, values) { const r = await D.removeCategory(ctx, clean(values.id, 40)); return r.ok ? back(ctx.t("catRemoved")) : { error: ctx.t("catGoneBanner") }; } },
  catLabel: { right: RIGHT_EDIT, async run(ctx, values) {
    const texts = readTexts(ctx, "label", values, LIMITS.label);
    const errors = tooLong(ctx, "label", texts, LIMITS.label);
    if (errors) return { errors };
    const r = await D.setCategoryLabel(ctx, clean(values.slug, 40), texts);
    return r.ok ? back(ctx.t("labelSaved")) : { error: ctx.t("catGoneBanner") };
  } },
  bindSearch: { right: RIGHT_EDIT, async run(ctx, values) { const q = clean(values.q, 100); const slug = clean(values.slug, 40); return { redirect: `?bind=${enc(slug)}${q ? `&bq=${enc(q)}` : ""}` }; } },
  bindPick: { right: RIGHT_EDIT, async run(ctx, values) {
    const raw = clean(values.id, 200);
    const i = raw.indexOf(":");
    const slug = raw.slice(0, i), catId = raw.slice(i + 1);
    if (i < 1 || !P.slugOk(slug) || !idOk(catId)) return { error: ctx.t("errSave") };
    const r = await D.bindCategory(ctx, slug, catId);
    if (!r.ok) return { error: ctx.t(r.code === "duplicate" ? "bindDuplicate" : "catGoneBanner") };
    return back(ctx.t("bindDone"));
  } },

  /* Équipe */
  teamSearch: { right: RIGHT_EDIT, async run(ctx, values) {
    const q = clean(values.q, 100);
    if ([...q].length < 2) return { errors: { q: ctx.t("errSearchShort") } };
    return { redirect: `?team=1&tq=${enc(q)}` };
  } },
  teamSave: { right: RIGHT_EDIT, async run(ctx, values) {
    const texts = readTexts(ctx, "role", values, LIMITS.role);
    const errors = tooLong(ctx, "role", texts, LIMITS.role);
    if (errors) return { errors };
    const who = await checkPerson(ctx, clean(values.contactId, LIMITS.id));
    if (who.error) return { error: who.error };
    const r = await D.addTeamMember(ctx, who.id, texts);
    return saved(ctx, r, ctx.t(r.updated ? "roleSaved" : "teamAdded", { name: P.shownName(who.card, "card") }));
  } },
  teamUp: { right: RIGHT_EDIT, async run(ctx, values) { await D.moveTeamMember(ctx, clean(values.id, LIMITS.id), -1); return { redirect: "?" }; } },
  teamDown: { right: RIGHT_EDIT, async run(ctx, values) { await D.moveTeamMember(ctx, clean(values.id, LIMITS.id), 1); return { redirect: "?" }; } },
  teamRemove: { right: RIGHT_EDIT, async run(ctx, values) { const r = await D.removeTeamMember(ctx, clean(values.id, LIMITS.id)); return r.ok ? back(ctx.t("teamRemoved")) : { error: ctx.t("errSave") }; } },

  /* Personnes */
  peopleSearch: { right: RIGHT_EDIT, async run(ctx, values) { const q = clean(values.q, 100); return { redirect: q ? `?pq=${enc(q)}` : "?" }; } },
  personSave: { right: RIGHT_EDIT, async run(ctx, values) {
    const bio = readTexts(ctx, "bio", values, LIMITS.bio, true);
    const errors = tooLong(ctx, "bio", bio, LIMITS.bio);
    if (errors) return { errors };
    const city = clean(values.city, LIMITS.city + 20);
    if ([...city].length > LIMITS.city) return { errors: { city: ctx.t("errTooLong", { max: LIMITS.city }) } };
    const who = await checkPerson(ctx, clean(values.contactId, LIMITS.id));
    if (who.error) return { error: who.error };
    // Coordonnées : seulement si la personne a accepté d'être sur la carte (catégorie réglée) ET qu'une ville est écrite ; arrondies à la ville.
    let geo = null, placed = "";
    if (city && who.mapId && who.card.cats.includes(who.mapId)) {
      const old = (await D.readData(ctx, { fresh: true })).profiles.get(who.id);
      if (old?.city === city && old.geo) geo = old.geo;
      else {
        const found = await G.lookupCity(ctx, city);
        if (!found.ok) return { errors: { city: ctx.t(found.why === "none" ? "errCityNone" : "errCityDown") } };
        geo = { lat: found.lat, lng: found.lng }; placed = found.label;
      }
    }
    const r = await D.patchProfile(ctx, who.id, { bio, city, geo });
    if (!r.ok) return { error: ctx.t(r.code === "too_many" ? "errTooMany" : "errSave", { max: LIMITS.profiles }) };
    return back(placed ? ctx.t("personSavedPlaced", { name: P.shownName(who.card, "card"), place: placed }) : ctx.t("personSaved", { name: P.shownName(who.card, "card") }));
  } },
  hide: { right: RIGHT_HIDE, async run(ctx, values) {
    const r = await D.patchProfile(ctx, clean(values.id, LIMITS.id), { hidden: true });
    return r.ok ? back(ctx.t("peopleHidden")) : { error: ctx.t(r.code === "too_many" ? "errTooMany" : "errSave", { max: LIMITS.profiles }) };
  } },
  unhide: { right: RIGHT_HIDE, async run(ctx, values) {
    const r = await D.patchProfile(ctx, clean(values.id, LIMITS.id), { hidden: false });
    return r.ok ? { ok: ctx.t("peopleUnhidden"), redirect: "?show=hidden" } : { error: ctx.t("errSave") };
  } },

  /* Remettre en ordre : suivre les fiches fusionnées, retirer ce qui visait une fiche supprimée, suivre les catégories fusionnées. Borné : 5 000 fiches = 50 lectures de 100. */
  tidy: { right: RIGHT_EDIT, async run(ctx) {
    const ids = await D.keptIds(ctx);
    const r = await C.resolveCards(ctx, ids);
    if (r.state !== "ok") return { error: ctx.t("adminSlow") };
    let followed = 0, removed = 0;
    for (const [from, to] of Object.entries(r.moved)) followed += (await D.remapReferences(ctx, from, to)) ? 1 : 0;
    for (const id of r.missing) removed += (await D.eraseReferences(ctx, id)) ? 1 : 0;
    const data = await D.readData(ctx, { fresh: true });
    const res = await C.resolveCats(ctx, data.config.cats);
    let cats = 0;
    if (res.state === "ok" && Object.keys(res.moved).length) cats = (await D.followCategories(ctx, res.moved)).followed ?? 0;
    return back(followed || removed || cats ? ctx.t("tidyDone", { followed, removed, cats }) : ctx.t("tidyNothing"));
  } },
};
