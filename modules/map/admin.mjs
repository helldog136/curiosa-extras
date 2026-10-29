// Carte : l'administration (onglet « Mes lieux », onglet « Types et import »). Tout se fait par boutons et formulaires, rien à glisser-déposer,
// les erreurs s'affichent SOUS le champ avec un exemple. Un lieu ajouté est un brouillon tant que quelqu'un qui a le droit de publier ne l'a pas publié.
// Les fichiers voisins sont importés avec la même « version » que celui-ci.

const q = new URL(import.meta.url).search;
const { clean, num, fold, slugify, LIMITS } = await import(new URL(`./text.mjs${q}`, import.meta.url).href);
const { positionFromForm } = await import(new URL(`./geo.mjs${q}`, import.meta.url).href);
const { TEMPLATES, TEMPLATE_IDS, DEFAULT_TEMPLATE } = await import(new URL(`./templates.mjs${q}`, import.meta.url).href);
const { C, world, ensureSeed, external, invalidate, locked, getRow, typeInfo, typeName, applyTemplate, nextPos, isPast } = await import(new URL(`./data.mjs${q}`, import.meta.url).href);
const { checkPlace, addPlace, updatePlace, removePlace, movePlace, moveType } = await import(new URL(`./ops.mjs${q}`, import.meta.url).href);
const { importCsv, lastReport, exportLines } = await import(new URL(`./csvio.mjs${q}`, import.meta.url).href);
const { pageHref, placeHref } = await import(new URL(`./view.mjs${q}`, import.meta.url).href);

const PER = 50;
const tools = (b) => ({ ...b, tab: "tools" });
const enc = encodeURIComponent;

const osmView = (lat, lng) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;

function typeOptions(ctx, w) {
  return w.types.map((t) => ({ value: t.id, label: `${t.sym ? `${t.sym} ` : ""}${typeName(ctx, t) || t.id}` }));
}

/** Liens « page précédente / suivante » d'une liste de l'administration (les paramètres du filtre sont gardés). */
function pagerLinks(ctx, params, key, page, pages) {
  if (pages <= 1) return null;
  const href = (p) => `?${Object.entries({ ...params, [key]: p > 1 ? p : undefined }).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `${k}=${enc(v)}`).join("&")}` || "?";
  const items = [];
  if (page > 1) items.push({ label: ctx.t("prev"), href: href(page - 1) });
  items.push({ label: ctx.t("pageOf", { page, pages }), href: href(page) });
  if (page < pages) items.push({ label: ctx.t("next"), href: href(page + 1) });
  return { type: "links", items };
}

// ── Onglet « Mes lieux » ─────────────────────────────────────────────────────────────────────────────────────────────

async function placesBlocks(ctx, query) {
  const w = await world(ctx);
  const blocks = [];
  const published = w.places.filter((p) => p.status === "published").length;
  const drafts = w.places.length - published;
  const href = pageHref(ctx, false);
  blocks.push({ type: "markdown", text: ctx.t("adminSummary", { published, drafts, max: LIMITS.places }) });
  if (href !== null) blocks.push({ type: "links", items: [{ label: ctx.t("openPublic"), href }] });

  const editing = query.edit ? w.places.find((p) => p.rowId === String(query.edit)) : null;
  const options = typeOptions(ctx, w);
  const fields = [
    ...(editing ? [{ name: "id", kind: "hidden", value: editing.rowId }] : []),
    { name: "name", label: ctx.t("fName"), required: true, value: editing?.name ?? "", help: ctx.t("fNameHelp") },
    ...(options.length ? [{ name: "type", label: ctx.t("fType"), kind: "select", options, value: editing?.type ?? options[0].value, help: ctx.t("fTypeHelp") }] : []),
    { name: "address", label: ctx.t("fAddress"), value: editing?.address ?? "", help: ctx.t("fAddressHelp") },
    { name: "mapLink", label: ctx.t("fMapLink"), kind: "text", value: "", help: ctx.t(editing ? "fMapLinkHelpEdit" : "fMapLinkHelp") },
    { name: "lat", label: ctx.t("fLat"), value: editing ? String(editing.lat) : "", help: ctx.t("fLatHelp") },
    { name: "lng", label: ctx.t("fLng"), value: editing ? String(editing.lng) : "", help: ctx.t("fLngHelp") },
    { name: "description", label: ctx.t("fDesc"), kind: "textarea", value: editing?.desc ?? "", help: ctx.t("fDescHelp") },
    { name: "hours", label: ctx.t("fHours"), kind: "textarea", value: editing?.hours ?? "", help: ctx.t("fHoursHelp") },
    { name: "url", label: ctx.t("fUrl"), kind: "url", value: editing?.url ?? "", help: ctx.t("fUrlHelp") },
    { name: "published", label: ctx.t(ctx.can?.("publish") ? "fPublished" : "fPublishedNo"), kind: "checkbox", value: editing ? (editing.status === "published" ? "on" : "") : "on", help: ctx.t("fPublishedHelp") },
  ];
  blocks.push({ type: "adminForm", action: "savePlace", title: ctx.t(editing ? "formEdit" : "formAdd"), submitLabel: ctx.t(editing ? "save" : "add"), cancelHref: editing ? "?" : undefined, fields });

  if (editing) {
    blocks.push({ type: "links", items: [{ label: ctx.t("checkOnOsm"), href: osmView(editing.lat, editing.lng) }, ...(editing.status === "published" && placeHref(ctx, editing.code) ? [{ label: ctx.t("seeFiche"), href: placeHref(ctx, editing.code) }] : [])] });
    blocks.push({ type: "table", columns: [ctx.t("colName")], rows: [[editing.name]], rowIds: [editing.rowId], rowActions: [{ label: ctx.t("remove"), action: "removePlace", confirm: ctx.t("removeConfirm"), danger: true }] });
  }

  // Liste
  const f = { q: clean(query.q, LIMITS.search), state: ["published", "draft"].includes(query.state) ? query.state : "", type: String(query.type ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "") };
  if (w.places.length > 8) {
    blocks.push({
      type: "adminForm", action: "filter", title: ctx.t("filterTitle"), submitLabel: ctx.t("filterGo"), fields: [
        { name: "q", label: ctx.t("filterQ"), value: f.q },
        { name: "state", label: ctx.t("filterState"), kind: "select", value: f.state, options: [{ value: "", label: ctx.t("stateAll") }, { value: "published", label: ctx.t("statePublished") }, { value: "draft", label: ctx.t("stateDraft") }] },
        ...(options.length > 1 ? [{ name: "type", label: ctx.t("fType"), kind: "select", value: f.type, options: [{ value: "", label: ctx.t("allTypes") }, ...options] }] : []),
      ],
    });
  }
  let list = w.places;
  if (f.state) list = list.filter((p) => p.status === f.state);
  if (f.type) list = list.filter((p) => p.type === f.type);
  const terms = fold(f.q).split(/\s+/).filter(Boolean);
  if (terms.length) list = list.filter((p) => terms.every((t) => p.hay.includes(t)));
  const pages = Math.max(1, Math.ceil(list.length / PER));
  const page = Math.min(num(query.page, 1, 1, 200), pages);
  const slice = list.slice((page - 1) * PER, page * PER);
  if (!w.places.length) blocks.push({ type: "banner", tone: "info", text: ctx.t("emptyAdmin") });
  else if (!list.length) blocks.push({ type: "banner", tone: "info", text: ctx.t("noMatch") });
  else {
    blocks.push({
      type: "table", columns: [ctx.t("colName"), ctx.t("colType"), ctx.t("colState")],
      rows: slice.map((p) => [p.name, typeInfo(ctx, w, p.type).name, ctx.t(p.status === "published" ? "statePublished" : "stateDraft")]),
      rowIds: slice.map((p) => p.rowId),
      rowActions: [{ label: ctx.t("edit"), href: "?edit={id}" }, { label: "↑", action: "moveUp" }, { label: "↓", action: "moveDown" }],
    });
    const pager = pagerLinks(ctx, f, "page", page, pages);
    if (pager) blocks.push(pager);
    if (drafts > 0 && ctx.can?.("publish")) {
      blocks.push({ type: "adminForm", action: "publishDrafts", title: ctx.t("publishAllTitle"), submitLabel: ctx.t("publishAll", { n: Math.min(drafts, 500) }), fields: [{ name: "scope", kind: "hidden", value: "all" }] });
    }
  }
  blocks.push(...await externalBlocks(ctx, query, w));
  return blocks;
}

async function externalBlocks(ctx, query, w) {
  const e = await external(ctx);
  const blocks = [];
  blocks.push({ type: "heading", text: ctx.t("extTitle") });
  blocks.push({ type: "markdown", text: ctx.t(e.places.length ? "extIntro" : "extNone") });
  if (!e.ok) blocks.push({ type: "banner", tone: "warning", text: ctx.t("externalDown") });
  if (!e.places.length) return blocks;
  const hide = ctx.setting("hidePast") !== false && ctx.setting("hidePast") !== "false";
  const shown = e.places.filter((p) => !w.hidden.has(p.code));
  const masked = e.places.filter((p) => w.hidden.has(p.code));
  const row = (p) => [p.name, p.from || "-", typeInfo(ctx, w, p.type).name + (hide && isPast(p.at) ? ` (${ctx.t("past")})` : "")];
  const page = num(query.xpage, 1, 1, 10);
  const pages = Math.max(1, Math.ceil(shown.length / PER));
  const at = Math.min(page, pages);
  const slice = shown.slice((at - 1) * PER, at * PER);
  if (slice.length) {
    blocks.push({ type: "table", columns: [ctx.t("colName"), ctx.t("colSource"), ctx.t("colType")], rows: slice.map(row), rowIds: slice.map((p) => p.code), rowActions: [{ label: ctx.t("hide"), action: "hideExternal" }] });
    const pager = pagerLinks(ctx, {}, "xpage", at, pages);
    if (pager) blocks.push(pager);
  }
  if (masked.length) {
    blocks.push({ type: "heading", text: ctx.t("extHiddenTitle") });
    blocks.push({ type: "table", columns: [ctx.t("colName"), ctx.t("colSource"), ctx.t("colType")], rows: masked.slice(0, PER).map(row), rowIds: masked.slice(0, PER).map((p) => p.code), rowActions: [{ label: ctx.t("show"), action: "showExternal" }] });
  }
  return blocks;
}

// ── Onglet « Types et import » ───────────────────────────────────────────────────────────────────────────────────────

async function toolsBlocks(ctx, query) {
  const w = await world(ctx);
  const blocks = [];
  const used = new Map();
  for (const p of w.places) used.set(p.type, (used.get(p.type) ?? 0) + 1);

  // Types
  blocks.push(tools({ type: "heading", text: ctx.t("typesTitle") }));
  blocks.push(tools({ type: "markdown", text: ctx.t("typesIntro") }));
  if (w.types.length) {
    blocks.push(tools({ type: "table", columns: [ctx.t("colSymbol"), ctx.t("colName"), ctx.t("colCount")], rows: w.types.map((t) => [t.sym || "-", typeName(ctx, t) || t.id, String(used.get(t.id) ?? 0)]), rowIds: w.types.map((t) => t.rowId), rowActions: [{ label: ctx.t("edit"), href: "?tab=tools&editType={id}" }, { label: "↑", action: "typeUp" }, { label: "↓", action: "typeDown" }] }));
  }
  const editingType = query.editType ? w.types.find((t) => t.rowId === String(query.editType)) : null;
  const locales = (ctx.locales?.length ? ctx.locales : [ctx.defaultLocale]).slice(0, 6);
  blocks.push(tools({
    type: "adminForm", action: "saveType", title: ctx.t(editingType ? "typeEdit" : "typeAdd"), submitLabel: ctx.t(editingType ? "save" : "add"), cancelHref: editingType ? "?tab=tools" : undefined, fields: [
      ...(editingType ? [{ name: "id", kind: "hidden", value: editingType.rowId }] : []),
      ...locales.map((l, i) => ({ name: `name_${l.replace(/-/g, "_")}`, label: ctx.t("fTypeName", { lang: l.toUpperCase() }), required: i === 0, value: editingType?.names[l] ?? "", help: i === 0 ? ctx.t("fTypeNameHelp") : undefined })),
      { name: "sym", label: ctx.t("fSymbol"), value: editingType?.sym ?? "", help: ctx.t("fSymbolHelp") },
    ],
  }));
  if (editingType) {
    blocks.push(tools({ type: "table", columns: [ctx.t("colName")], rows: [[typeName(ctx, editingType) || editingType.id]], rowIds: [editingType.rowId], rowActions: [{ label: ctx.t("remove"), action: "removeType", confirm: ctx.t("removeTypeConfirm"), danger: true }] }));
  }
  blocks.push(tools({
    type: "adminForm", action: "applyTemplate", title: ctx.t("tplTitle"), submitLabel: ctx.t("tplApply"), fields: [
      { name: "template", label: ctx.t("tplLabel"), kind: "select", value: DEFAULT_TEMPLATE, options: TEMPLATE_IDS.map((id) => ({ value: id, label: `${ctx.t(`tpl_${id}`)} (${TEMPLATES[id].types.map((t) => (ctx.locale === "fr" ? t.fr : t.en)).join(", ")})` })), help: ctx.t("tplHelp") },
    ],
  }));

  // Villes
  blocks.push(tools({ type: "heading", text: ctx.t("citiesTitle") }));
  blocks.push(tools({ type: "markdown", text: ctx.t("citiesIntro") }));
  if (w.cities.length) {
    blocks.push(tools({ type: "table", columns: [ctx.t("colCity"), ctx.t("colPosition")], rows: w.cities.map((c) => [c.name, `${c.lat}, ${c.lng}`]), rowIds: w.cities.map((c) => c.rowId), rowActions: [{ label: ctx.t("edit"), href: "?tab=tools&editCity={id}" }, { label: ctx.t("remove"), action: "removeCity", confirm: ctx.t("removeCityConfirm"), danger: true }] }));
  }
  const editingCity = query.editCity ? w.cities.find((c) => c.rowId === String(query.editCity)) : null;
  blocks.push(tools({
    type: "adminForm", action: "saveCity", title: ctx.t(editingCity ? "cityEdit" : "cityAdd"), submitLabel: ctx.t(editingCity ? "save" : "add"), cancelHref: editingCity ? "?tab=tools" : undefined, fields: [
      ...(editingCity ? [{ name: "id", kind: "hidden", value: editingCity.rowId }] : []),
      { name: "name", label: ctx.t("fCityName"), required: true, value: editingCity?.name ?? "", help: ctx.t("fCityNameHelp") },
      { name: "mapLink", label: ctx.t("fMapLink"), value: "", help: ctx.t("fCityLinkHelp") },
      { name: "lat", label: ctx.t("fLat"), value: editingCity ? String(editingCity.lat) : "" },
      { name: "lng", label: ctx.t("fLng"), value: editingCity ? String(editingCity.lng) : "" },
    ],
  }));

  // Import et export
  blocks.push(tools({ type: "heading", text: ctx.t("importTitle") }));
  blocks.push(tools({ type: "markdown", text: ctx.t("importIntro", { max: LIMITS.importRows }) }));
  const rep = await lastReport(ctx);
  if (rep) {
    const lines = [ctx.t("reportDone", { added: rep.added, from: rep.from, to: rep.to, total: rep.total })];
    if (rep.duplicates) lines.push(ctx.t("reportDup", { n: rep.duplicates }));
    if (rep.failed) lines.push(ctx.t("reportFailed", { n: rep.failed }));
    if (rep.full) lines.push(ctx.t("reportFull", { max: LIMITS.places }));
    if (rep.remaining) lines.push(ctx.t("reportMore", { n: rep.remaining, next: rep.to + 1 }));
    blocks.push(tools({ type: "banner", tone: rep.failed || rep.remaining ? "warning" : "success", text: lines.join(" ") }));
    if (rep.problems.length) blocks.push(tools({ type: "markdown", text: rep.problems.map((p) => `- ${p.replace(/[*_`\[\]<>]/g, " ")}`).join("\n") }));
  }
  blocks.push(tools({
    type: "adminForm", action: "importCsv", title: ctx.t("importFormTitle"), submitLabel: ctx.t("importGo"), fields: [
      { name: "file", label: ctx.t("fFile"), kind: "file", accept: ".csv,.tsv,.txt", maxBytes: LIMITS.importFile, help: ctx.t("fFileHelp") },
      { name: "text", label: ctx.t("fPaste"), kind: "textarea", value: "", help: ctx.t("fPasteHelp") },
      { name: "from", label: ctx.t("fFrom"), kind: "number", value: String(num(query.importFrom, 1, 1, 100000)), help: ctx.t("fFromHelp", { n: LIMITS.importRows }) },
      { name: "draft", label: ctx.t("fImportDraft"), kind: "checkbox", value: "on", help: ctx.t("fImportDraftHelp") },
    ],
  }));
  blocks.push(tools({ type: "download", name: "places", label: ctx.t("exportLabel") }));
  return blocks;
}

export async function adminPanel(ctx, { query = {} } = {}) {
  await ensureSeed(ctx);
  const a = await placesBlocks(ctx, query);
  const b = await toolsBlocks(ctx, query);
  return [...a, ...b];
}

/** Ce qui attend l'équipe : brouillons laissés par un import ou par l'assistant. */
export async function adminBadge(ctx) {
  const w = await world(ctx);
  return w.places.filter((p) => p.status === "draft" && p.by !== "admin").length;
}

// ── Actions ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const EDIT = "edit";
const PUBLISH = "publish";
const act = (right, run) => ({ right, run });
const back = (extra = "") => `?${extra}`;

export const adminActions = {
  // Recherche dans la liste de l'administration : on revient sur la page avec les paramètres dans l'adresse.
  filter: act(EDIT, async (ctx, values) => {
    const parts = [];
    const text = clean(values.q, LIMITS.search);
    if (text) parts.push(`q=${enc(text)}`);
    if (["published", "draft"].includes(values.state)) parts.push(`state=${values.state}`);
    const type = String(values.type ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (type) parts.push(`type=${enc(type)}`);
    return { redirect: back(parts.join("&")) };
  }),

  savePlace: act(EDIT, async (ctx, values) => {
    await ensureSeed(ctx);
    invalidate(ctx);
    const w = await world(ctx);
    const r = checkPlace(ctx, values, w.types);
    if (!r.ok) return { errors: r.errors, error: undefined };
    const wants = values.published === "on";
    const can = !!ctx.can?.(PUBLISH);
    if (values.id) {
      const target = w.places.find((p) => p.rowId === String(values.id));
      if (!target) return { error: ctx.t("errMissing") };
      const res = await updatePlace(ctx, target.rowId, r.value, can ? (wants ? "published" : "draft") : undefined);
      if (!res.ok) return { error: ctx.t("errMissing") };
      return { ok: ctx.t("savedPlace", { name: r.value.name }) + (r.value.fromLink ? ` ${ctx.t("positionRead", { lat: r.value.lat, lng: r.value.lng })}` : ""), redirect: back() };
    }
    const res = await addPlace(ctx, r.value, { status: can && wants ? "published" : "draft", by: "admin" });
    if (!res.ok) return { error: ctx.t("errFull", { max: LIMITS.places }) };
    const note = !can && wants ? ` ${ctx.t("needsPublishRight")}` : "";
    return { ok: ctx.t(can && wants ? "addedPublished" : "addedDraft", { name: r.value.name }) + (r.value.fromLink ? ` ${ctx.t("positionRead", { lat: r.value.lat, lng: r.value.lng })}` : "") + note, redirect: back() };
  }),

  removePlace: act(EDIT, async (ctx, values) => {
    const ok = await removePlace(ctx, String(values.id ?? ""));
    return ok ? { ok: ctx.t("removedPlace"), redirect: back() } : { error: ctx.t("errMissing") };
  }),

  moveUp: act(EDIT, async (ctx, values) => ((await movePlace(ctx, String(values.id ?? ""), -1)) ? { ok: ctx.t("moved") } : { error: ctx.t("cannotMove") })),
  moveDown: act(EDIT, async (ctx, values) => ((await movePlace(ctx, String(values.id ?? ""), 1)) ? { ok: ctx.t("moved") } : { error: ctx.t("cannotMove") })),

  // Publie jusqu'à 500 brouillons d'un coup (utile après un import).
  publishDrafts: act(PUBLISH, async (ctx) => {
    return locked(ctx, async () => {
      invalidate(ctx);
      const w = await world(ctx);
      const drafts = w.places.filter((p) => p.status === "draft").slice(0, 500);
      for (const p of drafts) {
        const row = await ctx.api.store.get(p.rowId);
        if (row) await ctx.api.store.update(p.rowId, { ...row.data, status: "published" });
      }
      invalidate(ctx);
      const left = w.places.filter((p) => p.status === "draft").length - drafts.length;
      return { ok: ctx.t("publishedMany", { n: drafts.length }) + (left > 0 ? ` ${ctx.t("publishedLeft", { n: left })}` : ""), redirect: back() };
    });
  }),

  // Lieux d'autres modules : on masque ou on réaffiche ici ; la donnée d'origine n'est jamais touchée.
  hideExternal: act(PUBLISH, async (ctx, values) => {
    const code = String(values.id ?? "");
    const e = await external(ctx);
    const p = e.places.find((x) => x.code === code);
    if (!p) return { error: ctx.t("errMissing") };
    return locked(ctx, async () => {
      invalidate(ctx);
      const w = await world(ctx);
      if (w.hidden.has(code)) return { ok: ctx.t("hiddenExt") };
      if (w.hidden.size >= LIMITS.hidden) return { error: ctx.t("errHiddenFull", { max: LIMITS.hidden }) };
      await ctx.api.store.add(C.hidden, { h: code, title: p.name, from: p.from });
      invalidate(ctx);
      return { ok: ctx.t("hiddenExt") };
    });
  }),
  showExternal: act(PUBLISH, async (ctx, values) => {
    const code = String(values.id ?? "");
    return locked(ctx, async () => {
      invalidate(ctx);
      const w = await world(ctx);
      const h = w.hidden.get(code);
      if (!h) return { ok: ctx.t("shownExt") };
      await ctx.api.store.remove(h.rowId);
      invalidate(ctx);
      return { ok: ctx.t("shownExt") };
    });
  }),

  // Types
  saveType: act(EDIT, async (ctx, values) => {
    invalidate(ctx);
    const w = await world(ctx);
    const locales = (ctx.locales?.length ? ctx.locales : [ctx.defaultLocale]).slice(0, 6);
    const names = {};
    for (const l of locales) { const n = clean(values[`name_${l.replace(/-/g, "_")}`], LIMITS.typeName); if (n) names[l] = n; }
    const firstKey = `name_${locales[0].replace(/-/g, "_")}`;
    if (!Object.keys(names).length) return { errors: { [firstKey]: ctx.t("errTypeName") } };
    const sym = clean(values.sym, 8);
    if (values.id) {
      const row = await getRow(ctx, String(values.id), "type");
      if (!row) return { error: ctx.t("errMissing") };
      await ctx.api.store.update(row.id, { ...row.data, names, sym, seed: false });
      invalidate(ctx);
      return { ok: ctx.t("savedType"), redirect: back("tab=tools") };
    }
    if (w.types.length >= LIMITS.types) return { error: ctx.t("errTypesFull", { max: LIMITS.types }) };
    const base = slugify(Object.values(names)[0]);
    const have = new Set(w.types.map((t) => t.id));
    let id = base;
    for (let n = 2; have.has(id) && n < 100; n++) id = `${base.slice(0, 26)}-${n}`;
    await ctx.api.store.add(C.types, { id, names, sym, pos: nextPos(w.types), seed: false });
    invalidate(ctx);
    return { ok: ctx.t("savedType"), redirect: back("tab=tools") };
  }),
  removeType: act(EDIT, async (ctx, values) => {
    invalidate(ctx);
    const w = await world(ctx);
    const t = w.types.find((x) => x.rowId === String(values.id ?? ""));
    if (!t) return { error: ctx.t("errMissing") };
    const n = w.places.filter((p) => p.type === t.id).length;
    if (n > 0) return { error: ctx.t("errTypeUsed", { n, name: typeName(ctx, t) || t.id }) };
    await ctx.api.store.remove(t.rowId);
    invalidate(ctx);
    return { ok: ctx.t("removedType"), redirect: back("tab=tools") };
  }),
  typeUp: act(EDIT, async (ctx, values) => ((await moveType(ctx, String(values.id ?? ""), -1)) ? { ok: ctx.t("moved") } : { error: ctx.t("cannotMove") })),
  typeDown: act(EDIT, async (ctx, values) => ((await moveType(ctx, String(values.id ?? ""), 1)) ? { ok: ctx.t("moved") } : { error: ctx.t("cannotMove") })),
  applyTemplate: act(EDIT, async (ctx, values) => {
    const id = TEMPLATE_IDS.includes(values.template) ? values.template : DEFAULT_TEMPLATE;
    const r = await applyTemplate(ctx, id);
    return { ok: ctx.t("tplDone", { added: r.added, removed: r.removed }), redirect: back("tab=tools") };
  }),

  // Villes (pour « Près de moi » quand la personne qui visite refuse la géolocalisation)
  saveCity: act(EDIT, async (ctx, values) => {
    invalidate(ctx);
    const w = await world(ctx);
    const errors = {};
    const name = clean(values.name, LIMITS.cityName);
    if (!name) errors.name = ctx.t("errCityName");
    const pos = positionFromForm({ link: values.mapLink, lat: values.lat, lng: values.lng });
    if (!pos.ok) errors[pos.field] = ctx.t(`errPos_${pos.reason}`);
    if (Object.keys(errors).length) return { errors };
    if (values.id) {
      const row = await getRow(ctx, String(values.id), "city");
      if (!row) return { error: ctx.t("errMissing") };
      await ctx.api.store.update(row.id, { ...row.data, name, lat: pos.lat, lng: pos.lng });
    } else {
      if (w.cities.length >= LIMITS.cities) return { error: ctx.t("errCitiesFull", { max: LIMITS.cities }) };
      await ctx.api.store.add(C.cities, { name, lat: pos.lat, lng: pos.lng, pos: nextPos(w.cities) });
    }
    invalidate(ctx);
    return { ok: ctx.t("savedCity", { name }), redirect: back("tab=tools") };
  }),
  removeCity: act(EDIT, async (ctx, values) => {
    const row = await getRow(ctx, String(values.id ?? ""), "city");
    if (!row) return { error: ctx.t("errMissing") };
    await ctx.api.store.remove(row.id);
    invalidate(ctx);
    return { ok: ctx.t("removedCity"), redirect: back("tab=tools") };
  }),

  // Import d'un fichier : 500 lignes à la fois, compte rendu, reprise.
  importCsv: act(EDIT, async (ctx, values) => {
    const text = String(values.file || values.text || "");
    if (!text.trim()) return { errors: { file: ctx.t("importNothing") } };
    if (text.length > LIMITS.importFile) return { errors: { file: ctx.t("importTooBig") } };
    await ensureSeed(ctx);
    const r = await importCsv(ctx, text, { from: num(values.from, 1, 1, 100000), asDraft: values.draft === "on", canPublish: !!ctx.can?.(PUBLISH) });
    if (!r.ok) return { errors: { [r.field ?? "file"]: r.message } };
    const next = r.remaining > 0 ? `tab=tools&importFrom=${r.to + 1}` : "tab=tools";
    return { ok: ctx.t("importDone", { n: r.added }), redirect: back(next) };
  }),
};

// ── Téléchargement ───────────────────────────────────────────────────────────────────────────────────────────────────

export const adminDownloads = {
  places: {
    right: EDIT,
    contentType: "text/csv",
    filename: () => "places",
    async *generate(ctx) { yield* exportLines(ctx); },
  },
};
