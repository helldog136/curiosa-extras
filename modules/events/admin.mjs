// Événements : l'administration. Deux onglets : « Mes événements » (ajouter en 5 champs, la liste, la fiche d'un événement avec ses « plus d'options »)
// et « Types et fichiers » (les types, les modèles de départ, l'export et l'import). Tout se fait avec des boutons, jamais de glisser-déposer.
// Les erreurs s'affichent sous leur champ, avec un exemple. Les droits : `events.edit` pour écrire ; sans lui, la personne ne fait que lire.
const q = new URL(import.meta.url).search;
const X = await import(`./text.mjs${q}`);
const T = await import(`./time.mjs${q}`);
const M = await import(`./model.mjs${q}`);
const D = await import(`./data.mjs${q}`);
const O = await import(`./ops.mjs${q}`);
const Q = await import(`./query.mjs${q}`);
const U = await import(`./urls.mjs${q}`);
const L = await import(`./links.mjs${q}`);
const V = await import(`./view.mjs${q}`);
const CSV = await import(`./csv.mjs${q}`);
const TPL = await import(`./templates.mjs${q}`);
const Z = await import(`./zones.mjs${q}`);

const RIGHT = "events.edit";
const PAGE = 25;
const can = (ctx) => typeof ctx.can === "function" && ctx.can(RIGHT) === true;
const here = (ctx) => `/admin/instances/${ctx.instance.id}`;
const localesOf = (ctx) => [ctx.defaultLocale, ...ctx.locales.filter((l) => l !== ctx.defaultLocale)].filter((l, i, a) => l && a.indexOf(l) === i);
const langName = (code, inLocale) => { try { return new Intl.DisplayNames([inLocale], { type: "language" }).of(code) || code; } catch { return code; } };

/** Un code d'erreur → la phrase (avec un exemple) que la personne lit sous le champ. */
export const message = (ctx, e) => ctx.t(`err_${e.code}`, e.vars);
function fieldErrors(ctx, errors, known) {
  const out = {};
  let other = "";
  for (const [field, e] of Object.entries(errors)) {
    if (known.includes(field)) out[field] = message(ctx, e); else other ||= message(ctx, e);
  }
  return other ? { errors: out, error: other } : { errors: out };
}

const SECTION_FIELDS = {
  essential: ["title", "type", "date", "time", "place", "text", "status", "state"],
  where: ["endDate", "endTime", "tz", "lat", "lng"],
  program: ["program", "speakers"],
  media: ["image", "imageAlt", "signupUrl", "seatsLeft", "seatsTotal", "videoUrl"],
  after: ["albumId", "albumLink", "videoId"],
};

const dateLine = (ctx, ev) => {
  const l = ctx.locale;
  const day = ev.broken ? "—" : ev.lastDay !== ev.date ? `${T.dayText(ev.date, l, { day: "numeric", month: "short", year: "numeric" })} → ${T.dayText(ev.lastDay, l, { day: "numeric", month: "short" })}` : T.dayText(ev.date, l, { day: "numeric", month: "short", year: "numeric" });
  return ev.time ? `${day} · ${T.timeText(ev.time, l)}` : day;
};
const stateLine = (ctx, ev) => [ev.status === "published" ? ctx.t("statusPublished") : ctx.t("statusDraft"), ev.state !== "ok" ? ctx.t(`state_${ev.state}`) : "", ev.by === "assistant" && ev.status === "draft" ? ctx.t("byAssistant") : "", ev.broken ? ctx.t("brokenDate") : ""].filter(Boolean).join(" · ");

// ── Les formulaires ─────────────────────────────────────────────────────────────────────────────────────────────────

const typeOptions = (ctx, data) => [{ value: "", label: ctx.t("noType") }, ...data.types.map((t) => ({ value: t.key, label: `${t.icon ? `${t.icon} ` : ""}${M.typeName(t, ctx.locale, ctx.defaultLocale) || t.key}` }))];

function quickForm(ctx, v) {
  return {
    type: "adminForm", action: "quickAdd", title: ctx.t("quickTitle", { one: v.oneLower }), submitLabel: ctx.t("quickSubmit"),
    fields: [
      { name: "title", label: ctx.t("fTitle"), help: ctx.t("fTitleHelp") },
      { name: "date", kind: "date", label: ctx.t("fDate") },
      { name: "time", label: ctx.t("fTime"), help: ctx.t("fTimeHelp") },
      { name: "place", label: ctx.t("fPlace"), help: ctx.t("fPlaceHelp") },
      { name: "text", kind: "textarea", label: ctx.t("fText"), help: ctx.t("fTextHelp") },
      { name: "publish", kind: "checkbox", label: ctx.t("fPublishNow"), value: "on", help: ctx.t("fPublishNowHelp") },
    ],
  };
}

function essentialForm(ctx, data, ev, seriesLater) {
  const fields = [
    { name: "id", kind: "hidden", label: "id", value: ev.id },
    { name: "section", kind: "hidden", label: "section", value: "essential" },
    { name: "title", label: ctx.t("fTitle"), value: ev.title === "—" ? "" : ev.title },
    { name: "type", kind: "select", label: ctx.t("fType"), value: ev.type, options: typeOptions(ctx, data), help: data.types.length ? undefined : ctx.t("fTypeNone") },
    { name: "date", kind: "date", label: ctx.t("fDate"), value: ev.date },
    { name: "time", label: ctx.t("fTime"), value: ev.time, help: ctx.t("fTimeHelp") },
    { name: "place", label: ctx.t("fPlace"), value: ev.place, help: ctx.t("fPlaceHelp") },
    { name: "text", kind: "textarea", label: ctx.t("fText"), value: ev.text, help: ctx.t("fTextHelp") },
    { name: "status", kind: "select", label: ctx.t("fStatus"), value: ev.status, options: [{ value: "published", label: ctx.t("statusPublished") }, { value: "draft", label: ctx.t("statusDraft") }], help: ctx.t("fStatusHelp") },
    { name: "state", kind: "select", label: ctx.t("fState"), value: ev.state, options: M.STATES.map((s) => ({ value: s, label: ctx.t(`stateOpt_${s}`) })), help: ctx.t("fStateHelp") },
  ];
  if (seriesLater) fields.push({ name: "toSeries", kind: "checkbox", label: ctx.t("fToSeries", { n: seriesLater }), help: ctx.t("fToSeriesHelp") });
  return { type: "adminForm", action: "saveEvent", title: ctx.t("editTitle"), submitLabel: ctx.t("save"), cancelHref: here(ctx), fields };
}

const zoneOptions = (ctx) => [{ value: "", label: ctx.t("fTzSite") }, ...Z.zoneOptions(ctx.locale)];

function whereForm(ctx, ev) {
  const fields = [
    { name: "id", kind: "hidden", label: "id", value: ev.id },
    { name: "section", kind: "hidden", label: "section", value: "where" },
    { name: "endDate", kind: "date", label: ctx.t("fEndDate"), value: ev.endDate, help: ctx.t("fEndDateHelp") },
    { name: "endTime", label: ctx.t("fEndTime"), value: ev.endTime, help: ctx.t("fEndTimeHelp") },
    { name: "tz", kind: "select", label: ctx.t("fTz"), value: ev.tz, options: ev.tz && !Z.ZONES.some((z) => z[0] === ev.tz) ? [...zoneOptions(ctx), { value: ev.tz, label: ev.tz }] : zoneOptions(ctx), help: ctx.t("fTzHelp") },
    { name: "lat", label: ctx.t("fLat"), value: ev.lat ?? "", help: ctx.t("fLatHelp") },
    { name: "lng", label: ctx.t("fLng"), value: ev.lng ?? "", help: ctx.t("fLngHelp") },
  ];
  return { type: "adminForm", action: "saveEvent", title: ctx.t("whereTitle"), submitLabel: ctx.t("save"), fields };
}

function programForm(ctx, ev, seriesLater) {
  const fields = [
    { name: "id", kind: "hidden", label: "id", value: ev.id },
    { name: "section", kind: "hidden", label: "section", value: "program" },
    { name: "program", kind: "textarea", label: ctx.t("fProgram"), value: M.programText(ev.program), help: ctx.t("fProgramHelp") },
    { name: "speakers", kind: "textarea", label: ctx.t("fSpeakers"), value: M.speakersText(ev.speakers), help: ctx.t("fSpeakersHelp") },
  ];
  if (seriesLater) fields.push({ name: "toSeries", kind: "checkbox", label: ctx.t("fToSeries", { n: seriesLater }), help: ctx.t("fToSeriesHelp") });
  return { type: "adminForm", action: "saveEvent", title: ctx.t("programTitle2"), submitLabel: ctx.t("save"), fields };
}

function mediaForm(ctx, ev, seriesLater) {
  const fields = [
    { name: "id", kind: "hidden", label: "id", value: ev.id },
    { name: "section", kind: "hidden", label: "section", value: "media" },
    { name: "image", kind: "image", label: ctx.t("fImage"), value: ev.image, help: ctx.t("fImageHelp") },
    { name: "imageAlt", label: ctx.t("fImageAlt"), value: ev.imageAlt, help: ctx.t("fImageAltHelp") },
    { name: "signupUrl", kind: "url", label: ctx.t("fSignup"), value: ev.signupUrl, help: ctx.t("fSignupHelp") },
    { name: "seatsLeft", kind: "number", label: ctx.t("fSeatsLeft"), value: ev.seatsLeft ?? "", help: ctx.t("fSeatsLeftHelp") },
    { name: "seatsTotal", kind: "number", label: ctx.t("fSeatsTotal"), value: ev.seatsTotal ?? "", help: ctx.t("fSeatsTotalHelp") },
    { name: "videoUrl", label: ctx.t("fVideo"), value: ev.videoUrl, help: ctx.t("fVideoHelp") },
  ];
  if (seriesLater) fields.push({ name: "toSeries", kind: "checkbox", label: ctx.t("fToSeries", { n: seriesLater }), help: ctx.t("fToSeriesHelp") });
  return { type: "adminForm", action: "saveEvent", title: ctx.t("mediaTitle"), submitLabel: ctx.t("save"), fields };
}

/** « Après l'événement » : l'album photo et la vidéo, choisis chez leurs propriétaires s'ils sont installés, sinon un simple lien. */
async function afterBlocks(ctx, ev) {
  const blocks = [];
  const fields = [
    { name: "id", kind: "hidden", label: "id", value: ev.id },
    { name: "section", kind: "hidden", label: "section", value: "after" },
  ];
  const [alb, vid] = await Promise.all([L.albums(ctx, { limit: 50 }), L.videos(ctx, { limit: 50 })]);
  if (alb.state === "ok") {
    const options = [{ value: "", label: ctx.t("pickNone") }, ...alb.albums.map((a) => ({ value: a.id, label: `${a.title}${a.count ? ` (${a.count})` : ""}` }))];
    if (ev.albumId && !options.some((o) => o.value === ev.albumId)) options.push({ value: ev.albumId, label: ctx.t("pickKept") });
    fields.push({ name: "albumId", kind: "select", label: ctx.t("fAlbum"), value: ev.albumId, options, help: alb.more ? ctx.t("pickMore") : ctx.t("fAlbumHelp") });
  } else {
    if (ev.albumId) fields.push({ name: "albumId", kind: "hidden", label: "album", value: ev.albumId });
    blocks.push({ type: "banner", tone: alb.state === "absent" ? "info" : "warning", text: ctx.t(alb.state === "absent" ? "albumsAbsent" : "albumsDown") });
    if (alb.state === "absent") blocks.push({ type: "suggestInstall", service: L.GALLERY, reason: ctx.t("albumsSuggest") });
  }
  fields.push({ name: "albumLink", kind: "url", label: ctx.t("fAlbumLink"), value: ev.albumLink, help: ctx.t("fAlbumLinkHelp") });
  if (vid.state === "ok") {
    const options = [{ value: "", label: ctx.t("pickNone") }, ...vid.items.map((a) => ({ value: a.id, label: a.title }))];
    if (ev.videoId && !options.some((o) => o.value === ev.videoId)) options.push({ value: ev.videoId, label: ctx.t("pickKept") });
    fields.push({ name: "videoId", kind: "select", label: ctx.t("fLibVideo"), value: ev.videoId, options, help: vid.more ? ctx.t("pickMore") : ctx.t("fLibVideoHelp") });
  } else {
    if (ev.videoId) fields.push({ name: "videoId", kind: "hidden", label: "video", value: ev.videoId });
    blocks.push({ type: "banner", tone: vid.state === "absent" ? "info" : "warning", text: ctx.t(vid.state === "absent" ? "videosAbsent" : "videosDown") });
    if (vid.state === "absent") blocks.push({ type: "suggestInstall", service: L.VIDEOS, reason: ctx.t("videosSuggest") });
  }
  blocks.push({ type: "adminForm", action: "saveEvent", title: ctx.t("afterTitle"), submitLabel: ctx.t("save"), fields });
  return blocks;
}

function repeatBlocks(ctx, data, ev) {
  if (ev.series) {
    const n = data.events.filter((e) => e.series === ev.series).length;
    return [{ type: "heading", text: ctx.t("repeatTitle") }, { type: "markdown", text: ctx.t("repeatInSeries", { n }) }];
  }
  return [{
    type: "adminForm", action: "repeat", title: ctx.t("repeatTitle"), submitLabel: ctx.t("repeatSubmit"),
    fields: [
      { name: "id", kind: "hidden", label: "id", value: ev.id },
      { name: "every", kind: "select", label: ctx.t("fEvery"), value: "week", options: M.REPEAT_KEYS.map((k) => ({ value: k, label: ctx.t(`every_${k}`) })), help: ctx.t("fEveryHelp") },
      { name: "count", kind: "number", label: ctx.t("fCount"), value: "", help: ctx.t("fCountHelp", { max: X.LIMITS.occurrences }) },
      { name: "until", kind: "date", label: ctx.t("fUntil"), help: ctx.t("fUntilHelp") },
    ],
  }];
}

// ── La fiche d'un événement ─────────────────────────────────────────────────────────────────────────────────────────

async function editPanel(ctx, data, ev, more) {
  const blocks = [];
  const later = ev.series ? data.events.filter((e) => e.series === ev.series && e.startMs > ev.startMs).length : 0;
  blocks.push({ type: "heading", text: ev.title });
  if (ev.broken) blocks.push({ type: "banner", tone: "warning", text: ctx.t("brokenHelp") });
  if (ev.note) blocks.push({ type: "banner", tone: "info", text: ctx.t(`note_${ev.note}`) });
  blocks.push(essentialForm(ctx, data, ev, later));
  const links = [{ label: ctx.t(more ? "lessOptions" : "moreOptions"), href: `${here(ctx)}?edit=${ev.id}${more ? "" : "&more=1"}` }];
  const href = ev.status === "published" ? U.eventHref(ctx, ev, false) : null;
  if (href) links.push({ label: ctx.t("seePage"), href });
  links.push({ label: ctx.t("backToAdmin"), href: here(ctx) });
  blocks.push({ type: "links", items: links });
  if (more) {
    blocks.push(whereForm(ctx, ev), programForm(ctx, ev, later), mediaForm(ctx, ev, later));
    blocks.push(...(await afterBlocks(ctx, ev)));
    blocks.push(...repeatBlocks(ctx, data, ev));
    blocks.push({ type: "heading", text: ctx.t("actionsTitle") });
    blocks.push({
      type: "table", columns: [ctx.t("colTitle")], rows: [[ev.title]], rowIds: [ev.id],
      rowActions: [
        { label: ctx.t("actToggle"), action: "toggle" },
        { label: ctx.t("actDuplicate"), action: "duplicate" },
        { label: ctx.t("actDelete"), action: "remove", confirm: ctx.t("confirmDelete"), danger: true },
      ],
    });
  }
  return blocks;
}

// ── La liste ────────────────────────────────────────────────────────────────────────────────────────────────────────

const SHOWS = ["upcoming", "past", "draft", "all"];

function listBlocks(ctx, data, query, editor) {
  const now = Date.now();
  const show = SHOWS.includes(query.show) ? query.show : "upcoming";
  const term = X.clean(query.q, X.LIMITS.query);
  const names = V.typeNames(ctx, data);
  const counts = { upcoming: 0, past: 0, draft: 0, all: data.events.length };
  for (const e of data.events) { if (e.status === "draft") counts.draft++; if (!e.broken && e.endMs <= now) counts.past++; else counts.upcoming++; }
  const filter = { type: "", words: X.fold(term).split(/[^a-z0-9]+/).filter(Boolean) };
  const f = (e) => (show === "all" ? true : show === "draft" ? e.status === "draft" : show === "past" ? !e.broken && e.endMs <= now : e.broken || e.endMs > now);
  const list = data.events.filter((e) => f(e) && Q.matches(e, filter, names));
  if (show === "past") list.reverse();
  const pageNo = Math.max(1, Math.min(Math.ceil(list.length / PAGE) || 1, X.num(query.page, 1, 1, 1000)));
  const slice = list.slice((pageNo - 1) * PAGE, pageNo * PAGE);
  const blocks = [];
  const tabs = SHOWS.map((s) => ({ label: `${ctx.t(`show_${s}`)} (${counts[s]})${s === show ? " ✓" : ""}`, href: `${here(ctx)}?show=${s}${term ? `&q=${encodeURIComponent(term)}` : ""}` }));
  blocks.push({ type: "heading", text: ctx.t("listTitle") });
  blocks.push({ type: "links", items: tabs });
  if (data.events.length > 8 || term) blocks.push({ type: "adminForm", action: "search", submitLabel: ctx.t("searchGo"), fields: [{ name: "show", kind: "hidden", label: "show", value: show }, { name: "q", label: ctx.t("adminSearchLabel"), value: term, help: ctx.t("searchHelp") }] });
  if (!slice.length) {
    blocks.push({ type: "markdown", text: ctx.t(term ? "listNoMatch" : data.events.length ? "listNothingHere" : "listEmpty") });
  } else {
    blocks.push({
      type: "table", columns: [ctx.t("colTitle"), ctx.t("colDate"), ctx.t("colType"), ctx.t("colState")],
      rows: slice.map((e) => [e.title, dateLine(ctx, e), names.get(e.type) ?? "—", stateLine(ctx, e)]),
      rowIds: slice.map((e) => e.id),
      rowActions: editor
        ? [{ label: ctx.t("actEdit"), href: "?edit={id}" }, { label: ctx.t("actToggle"), action: "toggle" }, { label: ctx.t("actDuplicate"), action: "duplicate" }, { label: ctx.t("actDelete"), action: "remove", confirm: ctx.t("confirmDelete"), danger: true }]
        : [],
    });
    const pages = Math.ceil(list.length / PAGE);
    if (pages > 1) {
      const nav = [];
      const base = `${here(ctx)}?show=${show}${term ? `&q=${encodeURIComponent(term)}` : ""}`;
      if (pageNo > 1) nav.push({ label: ctx.t("pagePrev"), href: `${base}&page=${pageNo - 1}` });
      nav.push({ label: ctx.t("pageOf", { page: pageNo, pages }), href: `${base}&page=${pageNo}` });
      if (pageNo < pages) nav.push({ label: ctx.t("pageNext"), href: `${base}&page=${pageNo + 1}` });
      blocks.push({ type: "links", items: nav });
    }
  }
  return blocks;
}

// ── Types et fichiers ───────────────────────────────────────────────────────────────────────────────────────────────

function typeForm(ctx, type) {
  const fields = [{ name: "id", kind: "hidden", label: "id", value: type?.id ?? "" }];
  localesOf(ctx).forEach((l, i) => fields.push({ name: `name_${l}`, label: ctx.t("fTypeName", { lang: langName(l, ctx.locale) }), value: type?.names[l] ?? "", help: i === 0 ? ctx.t("fTypeNameHelp") : undefined }));
  fields.push({ name: "color", kind: "select", label: ctx.t("fColor"), value: type?.color ?? TPL.DEFAULT_COLOR, options: TPL.PALETTE.map((c) => ({ value: c.key, label: ctx.t(`color_${c.key}`) })), help: ctx.t("fColorHelp") });
  fields.push({ name: "icon", label: ctx.t("fIcon"), value: type?.icon ?? "", help: ctx.t("fIconHelp") });
  return { type: "adminForm", action: "saveType", title: ctx.t(type ? "typeEdit" : "typeNew"), submitLabel: ctx.t(type ? "save" : "typeAdd"), cancelHref: type ? `${here(ctx)}?tab=more` : undefined, fields };
}

const starterOptions = (ctx) => TPL.STARTER_KEYS.map((k) => ({ value: k, label: ctx.t(`starter_${k}`) }));
/** Ce que crée chaque gabarit, lu dans les données des gabarits (jamais écrit ici) : « Nom : type, type, type. » */
function starterSummary(ctx) {
  const lang = ctx.locale;
  return TPL.STARTER_KEYS.filter((k) => TPL.STARTERS[k].types.length).map((k) => `${ctx.t(`starter_${k}`)} : ${TPL.STARTERS[k].types.map((t) => (t.names[lang] ?? t.names.en).toLowerCase()).join(", ")}.`).join(" ");
}

function starterBlock(ctx, first) {
  return {
    type: "adminForm", action: "chooseStarter", title: ctx.t(first ? "starterTitle" : "starterMore"), submitLabel: ctx.t(first ? "starterGo" : "starterAdd"),
    fields: [{ name: "starter", kind: "select", label: ctx.t("starterField"), value: TPL.STARTER_KEYS[0], options: starterOptions(ctx), help: ctx.t("starterHelp", { summary: starterSummary(ctx) }) }],
  };
}

async function filesBlocks(ctx) {
  const t = (x) => ({ ...x, tab: "more" });
  const blocks = [];
  blocks.push(t({ type: "heading", text: ctx.t("filesTitle") }));
  blocks.push(t({ type: "markdown", text: ctx.t("filesHelp", { max: X.LIMITS.importRows, columns: CSV.COLUMNS.slice(0, 7).join(", ") }) }));
  blocks.push(t({ type: "download", name: "events", label: ctx.t("exportButton") }));
  const meta = await D.readMeta(ctx);
  const rep = meta.report;
  if (rep && Date.now() - Date.parse(rep.at) < 2 * D.DAY) {
    blocks.push(t({ type: "heading", text: ctx.t(rep.dry ? "reportTitleDry" : "reportTitleDone") }));
    blocks.push(t({ type: "banner", tone: rep.errors.length || rep.noTitleColumn ? "warning" : "info", text: reportSummary(ctx, rep) }));
    if (rep.errors.length) blocks.push(t({ type: "table", columns: [ctx.t("repLine"), ctx.t("repColumn"), ctx.t("repProblem")], rows: rep.errors.slice(0, 20).map((e) => [String(e.line), String(e.column ?? ""), message(ctx, e)]) }));
  }
  blocks.push(t({
    type: "adminForm", action: "importCsv", title: ctx.t("importTitle"), submitLabel: ctx.t("importGo"),
    fields: [
      { name: "file", kind: "file", accept: ".csv,.tsv,.txt", maxBytes: X.LIMITS.importBytes, label: ctx.t("fFile"), help: ctx.t("fFileHelp") },
      { name: "dry", kind: "checkbox", label: ctx.t("fDry"), value: "on", help: ctx.t("fDryHelp") },
      { name: "publish", kind: "checkbox", label: ctx.t("fImportPublish"), help: ctx.t("fImportPublishHelp") },
    ],
  }));
  return blocks;
}

export function reportSummary(ctx, rep) {
  if (rep.empty) return ctx.t("repEmpty");
  if (rep.noTitleColumn) return ctx.t("repNoColumns");
  const parts = [ctx.t(rep.dry ? "repDry" : "repDone", { valid: rep.valid, created: rep.created, total: rep.total })];
  if (rep.duplicates) parts.push(ctx.t("repDuplicates", { n: rep.duplicates }));
  if (rep.errors.length) parts.push(ctx.t("repErrors", { n: rep.errors.length }));
  if (rep.newTypes.length) parts.push(ctx.t("repNewTypes", { names: rep.newTypes.slice(0, 5).join(", ") }));
  if (rep.unknownColumns.length) parts.push(ctx.t("repUnknown", { names: rep.unknownColumns.slice(0, 5).join(", ") }));
  if (rep.truncated || rep.full) parts.push(ctx.t("repTooMany", { max: X.LIMITS.importRows }));
  return parts.join(" ");
}

async function typesBlocks(ctx, data, query, editor) {
  const t = (x) => ({ ...x, tab: "more" });
  const blocks = [t({ type: "heading", text: ctx.t("typesTitle", { n: data.types.length }) }), t({ type: "markdown", text: ctx.t("typesHelp") })];
  if (data.types.length) {
    const used = new Map();
    for (const e of data.events) used.set(e.type, (used.get(e.type) ?? 0) + 1);
    blocks.push(t({
      type: "table", columns: [ctx.t("colTypeName"), ctx.t("colColor"), ctx.t("colUsed")],
      rows: data.types.map((ty) => [`${ty.icon ? `${ty.icon} ` : ""}${M.typeName(ty, ctx.locale, ctx.defaultLocale)}`, ctx.t(`color_${ty.color}`), String(used.get(ty.key) ?? 0)]),
      rowIds: data.types.map((ty) => ty.id),
      rowActions: editor ? [{ label: ctx.t("actEdit"), href: "?tab=more&type={id}" }, { label: ctx.t("actUp"), action: "typeUp" }, { label: ctx.t("actDown"), action: "typeDown" }, { label: ctx.t("actDelete"), action: "removeType", confirm: ctx.t("confirmDeleteType"), danger: true }] : [],
    }));
  } else blocks.push(t({ type: "markdown", text: ctx.t("typesNone") }));
  if (editor) {
    const editing = typeof query.type === "string" ? data.types.find((x) => x.id === query.type) : null;
    blocks.push(t(typeForm(ctx, editing ?? null)));
    blocks.push(t(starterBlock(ctx, false)));
  }
  return blocks;
}

// ── Le panneau ───────────────────────────────────────────────────────────────────────────────────────────────────────

export async function panel(ctx, { query } = {}) {
  const qy = query ?? {};
  const editor = can(ctx);
  const data = await D.load(ctx, { fresh: true });
  const v = V.vocab(ctx);
  if (editor && typeof qy.edit === "string") {
    const ev = data.byId.get(qy.edit);
    if (ev) return editPanel(ctx, data, ev, qy.more === "1");
  }
  const blocks = [];
  const meta = await D.readMeta(ctx);
  if (editor && !meta.starter && !data.types.length) blocks.push(starterBlock(ctx, true));
  const page = U.pageHref(ctx, false);
  if (page === null) blocks.push({ type: "banner", tone: "warning", text: ctx.t("noPage") });
  else blocks.push({ type: "links", items: [{ label: ctx.t("seeSite", { many: v.manyLower }), href: page }] });
  blocks.push({ type: "markdown", text: ctx.t("zoneInfo", { zone: data.zone }) });
  if (editor) blocks.push(quickForm(ctx, v));
  else blocks.push({ type: "markdown", text: ctx.t("readOnly") });
  blocks.push(...listBlocks(ctx, data, qy, editor));
  blocks.push(...(await typesBlocks(ctx, data, qy, editor)));
  blocks.push(...(await filesBlocks(ctx)));
  if (!editor) return blocks.filter((b) => b.type !== "adminForm");
  return blocks;
}

/** Les brouillons que l'assistant IA a préparés et qui attendent une relecture (pastille du menu d'administration). */
export async function badge(ctx) {
  const data = await D.load(ctx);
  return Math.min(99, data.events.filter((e) => e.by === "assistant" && e.status === "draft").length);
}

// ── Les actions ──────────────────────────────────────────────────────────────────────────────────────────────────────

const flagOn = (v) => v === "on" || v === "1" || v === "true" || v === true;
const text = (v) => (typeof v === "string" ? v : "");

const failFor = (ctx, r, known) => {
  if (r.full) return { error: ctx.t("errFull", { max: X.LIMITS.events }) };
  if (r.missing) return { error: ctx.t("errMissing") };
  return fieldErrors(ctx, r.errors ?? {}, known);
};
const noteOf = (ctx, notes) => (notes?.length ? ` ${ctx.t(`note_${notes[0]}`)}` : "");

export const actions = {
  async quickAdd(ctx, values) {
    const r = await O.createEvent(ctx, { title: values.title, date: values.date, time: values.time ?? "", place: values.place ?? "", text: values.text ?? "", status: flagOn(values.publish) ? "published" : "draft" });
    if (!r.ok) return failFor(ctx, r, ["title", "date", "time", "place", "text"]);
    return { ok: `${ctx.t(flagOn(values.publish) ? "addedPublished" : "addedDraft")}${noteOf(ctx, r.notes)}`, redirect: `?edit=${r.id}` };
  },

  async saveEvent(ctx, values) {
    const section = O.SECTIONS.includes(values.section) ? values.section : "essential";
    const known = SECTION_FIELDS[section];
    const sent = {};
    for (const f of known) if (values[f] !== undefined) sent[f] = values[f];
    const r = await O.updateEvent(ctx, text(values.id), sent, { sections: [section], toSeries: flagOn(values.toSeries) });
    if (!r.ok) return failFor(ctx, r, known);
    const extra = r.series ? ` ${ctx.t("savedSeries", { n: r.series })}` : "";
    return { ok: `${ctx.t("saved")}${extra}${noteOf(ctx, r.notes)}`, redirect: `?edit=${r.id}${section === "essential" ? "" : "&more=1"}` };
  },

  async repeat(ctx, values) {
    const count = values.count === "" || values.count === undefined ? undefined : Number(values.count);
    if (count !== undefined && (!Number.isInteger(count) || count < 2)) return { errors: { count: ctx.t("err_countRule", { max: X.LIMITS.occurrences }) } };
    const until = values.until ? T.readDate(values.until) : null;
    if (values.until && !until) return { errors: { until: ctx.t("err_dateBad") } };
    const r = await O.repeatEvent(ctx, text(values.id), { every: values.every, count, until });
    if (r.ok) return { ok: ctx.t("repeated", { n: r.count }) + (r.cut ? ` ${ctx.t("repeatCut", { max: X.LIMITS.occurrences, years: X.LIMITS.repeatYears })}` : ""), redirect: `?edit=${text(values.id)}&more=1` };
    if (r.error === "need") return { errors: { count: ctx.t("err_repeatNeed", { max: X.LIMITS.occurrences }) } };
    if (r.error === "count") return { errors: { count: ctx.t("err_countRule", { max: X.LIMITS.occurrences }) } };
    if (r.error === "until") return { errors: { until: ctx.t("err_untilBefore") } };
    if (r.error === "full") return { error: ctx.t("errFull", { max: X.LIMITS.events }) };
    if (r.error === "already") return { error: ctx.t("errAlready") };
    if (r.error === "none") return { errors: { count: ctx.t("err_repeatNone") } };
    return { error: ctx.t("errMissing") };
  },

  async toggle(ctx, values) {
    const data = await D.load(ctx, { fresh: true });
    const ev = data.byId.get(text(values.id));
    if (!ev) return { error: ctx.t("errMissing") };
    if (ev.broken && ev.status === "draft") return { error: ctx.t("brokenHelp") };
    const next = ev.status === "published" ? "draft" : "published";
    const r = await O.setStatus(ctx, ev.id, next);
    return r.ok ? { ok: ctx.t(next === "published" ? "nowPublished" : "nowDraft", { title: ev.title }) } : { error: ctx.t("errMissing") };
  },

  async duplicate(ctx, values) {
    const r = await O.duplicateEvent(ctx, text(values.id), ctx.t("copySuffix"));
    if (!r.ok) return r.full ? { error: ctx.t("errFull", { max: X.LIMITS.events }) } : { error: ctx.t("errMissing") };
    return { ok: ctx.t("duplicated"), redirect: `?edit=${r.id}` };
  },

  async remove(ctx, values) {
    const r = await O.removeEvent(ctx, text(values.id));
    return r.ok ? { ok: ctx.t("removed"), redirect: "?" } : { error: ctx.t("errMissing") };
  },

  async search(ctx, values) {
    const show = SHOWS.includes(values.show) ? values.show : "upcoming";
    const term = X.clean(values.q, X.LIMITS.query);
    return { redirect: `?show=${show}${term ? `&q=${encodeURIComponent(term)}` : ""}` };
  },

  async saveType(ctx, values) {
    const names = {};
    for (const l of localesOf(ctx)) { const n = values[`name_${l}`]; if (typeof n === "string" && n.trim()) names[l] = n; }
    const r = await O.saveType(ctx, text(values.id) || null, { names, color: values.color, icon: values.icon });
    if (!r.ok) {
      if (r.full) return { error: ctx.t("errTypesFull", { max: X.LIMITS.types }) };
      if (r.missing) return { error: ctx.t("errMissing") };
      const first = `name_${localesOf(ctx)[0]}`;
      const errs = {};
      for (const [k, e] of Object.entries(r.errors)) errs[k === "name" ? first : k] = message(ctx, e);
      return { errors: errs };
    }
    return { ok: ctx.t(values.id ? "saved" : "typeAdded"), redirect: "?tab=more" };
  },

  async removeType(ctx, values) {
    const r = await O.removeType(ctx, text(values.id));
    return r.ok ? { ok: ctx.t("typeRemoved") } : { error: ctx.t("errMissing") };
  },
  async typeUp(ctx, values) { const r = await O.moveType(ctx, text(values.id), -1); return r.ok ? { ok: ctx.t("moved") } : { error: ctx.t("moveEdge") }; },
  async typeDown(ctx, values) { const r = await O.moveType(ctx, text(values.id), 1); return r.ok ? { ok: ctx.t("moved") } : { error: ctx.t("moveEdge") }; },

  async chooseStarter(ctx, values) {
    if (!TPL.STARTER_KEYS.includes(values.starter)) return { errors: { starter: ctx.t("err_starterBad") } };
    const r = await O.applyStarter(ctx, values.starter, localesOf(ctx));
    return r.ok ? { ok: r.added ? ctx.t("starterDone", { n: r.added }) : ctx.t("starterNothing"), redirect: "?" } : { error: ctx.t("errMissing") };
  },

  async importCsv(ctx, values) {
    const content = typeof values.file === "string" ? values.file : "";
    if (!content.trim()) return { errors: { file: ctx.t("err_fileEmpty") } };
    const dry = flagOn(values.dry);
    const rep = await CSV.importCsv(ctx, content, { dry, publish: flagOn(values.publish) });
    await D.saveReport(ctx, { at: new Date().toISOString(), dry, total: rep.total, valid: rep.valid, created: rep.created, duplicates: rep.duplicates, newTypes: rep.newTypes.slice(0, 10), unknownColumns: rep.unknownColumns.slice(0, 10), truncated: rep.truncated, full: rep.full, empty: !!rep.empty, noTitleColumn: rep.noTitleColumn, errors: rep.errors.slice(0, 20) });
    if (rep.empty || rep.noTitleColumn) return { errors: { file: ctx.t(rep.empty ? "err_fileEmpty" : "err_fileColumns") } };
    return { ok: reportSummary(ctx, { ...rep, dry }), redirect: "?tab=more" };
  },
};

export const actionRights = Object.fromEntries(Object.keys(actions).map((k) => [k, { right: RIGHT, run: actions[k] }]));

export const downloads = {
  events: {
    right: RIGHT,
    contentType: "text/csv",
    filename: () => "events",
    async *generate(ctx) { yield* CSV.exportLines(ctx); },
  },
};
