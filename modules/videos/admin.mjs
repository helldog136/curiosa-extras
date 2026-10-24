// Vidéothèque — l'administration (mobile d'abord, FR + EN, mots simples). Deux onglets :
//   « Mes vidéos »            coller une adresse (ou plusieurs), voir la liste, modifier, publier, masquer, supprimer ;
//   « Catégories et séries »  le gabarit de départ, les catégories (ordre par boutons), les séries (listes de lecture, ordre par boutons).
// Aucun glisser-déposer. Les erreurs s'affichent SOUS le champ, avec un exemple. Les titres viennent de la plateforme quand elle répond, sinon on les écrit.
// Tableaux à UNE colonne et boutons empilés : rien ne défile de côté sur un téléphone.
const v = new URL(import.meta.url).search;
const P = await import(`./pure.mjs${v}`);
const R = await import(`./providers.mjs${v}`);
const D = await import(`./data.mjs${v}`);
const O = await import(`./ops.mjs${v}`);
const A = await import(`./albums.mjs${v}`);
const { LIMITS, clean } = P;

export const RIGHT_EDIT = "edit", RIGHT_PUBLISH = "publish";
const can = (ctx, right) => typeof ctx.can === "function" && ctx.can(right) === true;
const here = (ctx) => `/admin/instances/${ctx.instance.id}`;
const str = (x) => (typeof x === "string" ? x : Array.isArray(x) && typeof x[0] === "string" ? x[0] : "");
const enc = encodeURIComponent;
const EXAMPLE = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

const fullUrl = (ctx) => { const b = P.base(ctx); return b === null ? "" : `${ctx.api.siteUrl}${b}`; };
const untitled = (ctx, x) => x.title || ctx.t("untitled", { id: x.ext });
const statusLabel = (ctx, s) => ctx.t(`st_${s}`);
const catOptions = (ctx, snap, none = true) => [...(none ? [{ value: "", label: ctx.t("noCategory") }] : []), ...snap.cats.map((c) => ({ value: String(c.k), label: D.catName(ctx, c) }))];

/** Un champ « un texte par langue du site ». */
const langFields = (ctx, prefix, values, { label, help, kind = "text", max }) => P.localesOf(ctx).map((l, i) => ({
  name: `${prefix}_${l}`, kind, label: P.localesOf(ctx).length > 1 ? `${ctx.t(label)} (${l.toUpperCase()})` : ctx.t(label), value: values?.[l] ?? "", help: i === 0 && help ? ctx.t(help, { max }) : undefined,
}));
const readLang = (ctx, prefix, values, max) => Object.fromEntries(P.localesOf(ctx).map((l) => [l, clean(values[`${prefix}_${l}`], max)]).filter(([, t]) => t));

const errorFor = (ctx, code, item) => ctx.t(`err_${code}`, { example: EXAMPLE, title: item?.title ?? "", max: LIMITS.videos });

// ── Le panneau ─────────────────────────────────────────────────────────────────────────────────────────────────────

export async function panel(ctx, { query } = {}) {
  const q = query ?? {};
  const snap = await D.snapshot(ctx, { fresh: true });
  const editor = can(ctx, RIGHT_EDIT);
  if (typeof q.edit === "string" && /^\d{1,7}$/.test(q.edit)) {
    const x = snap.byN.get(Number(q.edit));
    return x ? editScreen(ctx, snap, x) : [{ type: "banner", tone: "warning", text: ctx.t("goneVideo") }, backLink(ctx)];
  }
  if (editor && typeof q.bulk === "string") return bulkScreen(ctx, snap, q.bulk === "new");
  if (typeof q.cat === "string" && /^\d{1,7}$/.test(q.cat) && editor) return categoryScreen(ctx, snap, Number(q.cat));
  if (typeof q.series === "string" && /^\d{1,7}$/.test(q.series) && editor) return seriesScreen(ctx, snap, Number(q.series), str(q.vq));
  return [...(await mainBlocks(ctx, snap, q, editor)), ...shelfBlocks(ctx, snap, editor)];
}

const backLink = (ctx, tab = "") => ({ type: "links", items: [{ label: ctx.t("back"), href: `${here(ctx)}${tab ? `?tab=${tab}` : ""}` }] });

// ── Onglet 1 : mes vidéos ──────────────────────────────────────────────────────────────────────────────────────────

async function mainBlocks(ctx, snap, q, editor) {
  const t = ctx.t, out = [];
  const b = P.base(ctx);
  if (b === null) out.push({ type: "banner", tone: "warning", text: t("noPage") });
  const miss = O.missing(ctx, snap);
  if (editor && miss.any) {
    out.push({ type: "banner", tone: "info", text: t("bannerMissing", { titles: miss.noTitle, thumbs: miss.noThumb }) });
    out.push({ type: "adminForm", action: "complete", submitLabel: t("completeButton", { n: Math.min(LIMITS.fillBatch, miss.videos) }), fields: [{ name: "go", kind: "hidden", value: "1" }] });
  }
  if (editor) {
    out.push({ type: "heading", text: snap.items.length ? t("addTitle") : t("welcomeTitle") });
    if (!snap.items.length) out.push({ type: "markdown", text: t("welcomeText", { example: EXAMPLE }) });
    out.push({
      type: "adminForm", action: "add", submitLabel: t("addButton"),
      fields: [
        { name: "url", kind: "text", required: true, label: t("fieldUrl"), help: t("fieldUrlHelp", { example: EXAMPLE }) },
        { name: "title", kind: "text", label: t("fieldTitleOptional"), help: t("fieldTitleOptionalHelp") },
        ...(snap.cats.length ? [{ name: "cat", kind: "select", label: t("fieldCategory"), value: "", options: catOptions(ctx, snap) }] : []),
        ...(can(ctx, RIGHT_PUBLISH) ? [{ name: "state", kind: "select", label: t("fieldState"), value: "draft", options: ["draft", "published"].map((s) => ({ value: s, label: statusLabel(ctx, s) })), help: t("fieldStateAddHelp") }] : []),
      ],
    });
    out.push({ type: "links", items: [{ label: t("linkBulk"), href: `${here(ctx)}?bulk=new` }] });
  }
  if (b !== null) {
    out.push({ type: "links", items: [{ label: t("linkSee"), href: P.homeHref(ctx) }] });
    out.push({ type: "copy", label: t("copyLabel"), text: fullUrl(ctx) || ctx.api.siteUrl });
  }
  // La liste
  const st = ["published", "draft", "hidden"].includes(q.st) ? q.st : "";
  const search = clean(str(q.q), LIMITS.searchMax);
  const counts = { all: snap.items.length, published: 0, draft: 0, hidden: 0 };
  for (const x of snap.items) counts[x.status]++;
  if (!snap.items.length) return out; // le message de bienvenue, plus haut, dit déjà quoi faire
  out.push({ type: "heading", text: t("listTitle", { n: snap.items.length }) });
  out.push({ type: "links", items: [["", "filterAll", counts.all], ["published", "st_published", counts.published], ["draft", "st_draft", counts.draft], ["hidden", "st_hidden", counts.hidden]].map(([s, key, n]) => ({ label: `${st === s ? "▸ " : ""}${t(key)} (${n})`, href: `${here(ctx)}${s ? `?st=${s}` : ""}` })) });
  if (snap.items.length > LIMITS.adminPage || search) out.push({ type: "adminForm", action: "search", submitLabel: t("searchButton"), fields: [{ name: "q", kind: "text", label: t("findLabel"), value: search, help: t("searchHelp") }, { name: "st", kind: "hidden", value: st }] });
  const words = P.searchWords(search);
  const rows = snap.items.filter((x) => (!st || x.status === st) && (!words.length || words.every((w) => `${x.hay} ${P.fold(x.ext)}`.includes(w))));
  const pages = Math.max(1, Math.ceil(rows.length / LIMITS.adminPage));
  const page = Math.min(pages, P.int(str(q.page), 1, 1, 100000));
  const slice = rows.slice((page - 1) * LIMITS.adminPage, page * LIMITS.adminPage);
  if (!rows.length) { out.push({ type: "markdown", text: t("listNone") }); return out; }
  const actions = [];
  if (editor) actions.push({ label: t("actEdit"), href: "?edit={id}" });
  if (can(ctx, RIGHT_PUBLISH)) {
    if (st === "published") actions.push({ label: t("actHide"), action: "hide", confirm: t("confirmHide") });
    else if (st === "draft" || st === "hidden") actions.push({ label: t("actPublish"), action: "publish" });
  }
  out.push({
    // Une seule colonne : sur un téléphone, un tableau large défilerait de côté et cacherait les boutons.
    type: "table", columns: [t("colTitle")],
    rows: slice.map((x) => [[untitled(ctx, x), `${statusLabel(ctx, x.status)}${x.cat ? ` · ${D.catName(ctx, snap.cats.find((c) => c.k === x.cat))}` : ""} · ${x.date}`].join(" — ")]),
    rowIds: slice.map((x) => String(x.n)), rowActions: actions,
  });
  if (pages > 1) {
    const link = (n, label) => ({ label, href: `${here(ctx)}?page=${n}${st ? `&st=${st}` : ""}${search ? `&q=${enc(search)}` : ""}` });
    out.push({ type: "links", items: [...(page > 1 ? [link(page - 1, t("pagePrev"))] : []), ...(page < pages ? [link(page + 1, t("pageNext"))] : [])] });
    out.push({ type: "markdown", text: t("pageOf", { page, pages }) });
  }
  return out;
}

// ── Modifier une vidéo ─────────────────────────────────────────────────────────────────────────────────────────────

async function editScreen(ctx, snap, x) {
  const t = ctx.t;
  const editor = can(ctx, RIGHT_EDIT), publisher = can(ctx, RIGHT_PUBLISH);
  const p = R.providerOf(x);
  const out = [{ type: "heading", text: t("editTitle", { title: untitled(ctx, x) }) }];
  if (!editor) {
    out.push({ type: "banner", tone: "warning", text: t("noRight") }, backLink(ctx));
    return out;
  }
  if (!x.title) out.push({ type: "banner", tone: "warning", text: t("editNoTitle") });
  if (x.noEmbed) out.push({ type: "banner", tone: "info", text: t("editNoEmbed", { service: p?.label ?? "" }) });
  if (D.settings(ctx).thumbs === "copy" && !x.thumb && !x.cover) out.push({ type: "banner", tone: "info", text: t("editNoThumb") });
  const albums = await A.list(ctx);
  const transcript = await D.getText(ctx, x.n).catch(() => "");
  const fields = [
    { name: "id", kind: "hidden", value: String(x.n) },
    { name: "title", kind: "text", label: t("fieldTitle"), value: x.title, help: t("fieldTitleHelp") },
    { name: "desc", kind: "textarea", label: t("fieldDesc"), value: x.desc, help: t("fieldDescHelp", { max: LIMITS.desc }) },
    ...(snap.cats.length ? [{ name: "cat", kind: "select", label: t("fieldCategory"), value: x.cat ? String(x.cat) : "", options: catOptions(ctx, snap) }] : []),
    { name: "date", kind: "date", label: t("fieldDate"), value: x.date, help: t("fieldDateHelp") },
    { name: "dur", kind: "text", label: t("fieldDuration"), value: P.formatDuration(x.dur), help: t("fieldDurationHelp") },
    { name: "free", kind: "checkbox", label: t("fieldFree"), value: x.free ? "on" : "", help: t("fieldFreeHelp") },
    { name: "cover", kind: "image", label: t("fieldCover"), value: x.cover, help: t("fieldCoverHelp") },
  ];
  if (albums.state === "ok") {
    const opts = [{ value: "", label: t("albumNone") }, ...albums.albums.map((a) => ({ value: a.id, label: `${a.title} (${a.count})` }))];
    if (x.album && !opts.some((o) => o.value === x.album)) opts.push({ value: x.album, label: t("albumCurrent") });
    fields.push({ name: "album", kind: "select", label: t("fieldAlbum"), value: x.album, options: opts, help: t("fieldAlbumHelp") });
  } else if (x.album) fields.push({ name: "album", kind: "hidden", value: x.album });
  fields.push({ name: "transcript", kind: "textarea", label: t("fieldTranscript"), value: transcript, help: t("fieldTranscriptHelp", { max: LIMITS.transcript }) });
  if (publisher) fields.push({ name: "state", kind: "select", label: t("fieldState"), value: x.status, options: ["published", "draft", "hidden"].map((s) => ({ value: s, label: statusLabel(ctx, s) })), help: t("fieldStateHelp") });
  out.push({ type: "adminForm", action: "save", submitLabel: t("save"), cancelHref: `${here(ctx)}`, fields });
  if (albums.state === "absent") out.push({ type: "markdown", text: t("albumAbsent") }, { type: "suggestInstall", service: A.SERVICE, reason: t("suggestReason") });
  else if (albums.state === "down") out.push({ type: "banner", tone: "warning", text: t("albumDown") });
  // Un bouton par formulaire, l'un sous l'autre : un tableau d'actions déborderait sur un téléphone.
  const one = (action, label) => ({ type: "adminForm", action, submitLabel: label, fields: [{ name: "id", kind: "hidden", value: String(x.n) }] });
  if (publisher) out.push(x.status === "published" ? one("hide", t("actHide")) : one("publish", t("actPublish")));
  out.push(one("refresh", t("actRefresh")));
  out.push({ type: "table", columns: [t("moreActions")], rows: [[t("deleteHint")]], rowIds: [String(x.n)], rowActions: [{ label: t("actDelete"), action: "remove", confirm: t("confirmDelete"), danger: true }] });
  const links = [];
  const watch = p?.watchUrl(x.ext);
  if (watch) links.push({ label: t("linkWatch", { service: p.label }), href: watch });
  if (x.status === "published" && P.videoPath(ctx, x)) links.push({ label: t("linkSeeVideo"), href: P.videoPath(ctx, x) });
  links.push({ label: t("back"), href: here(ctx) });
  out.push({ type: "links", items: links });
  return out;
}

// ── Ajouter plusieurs adresses ─────────────────────────────────────────────────────────────────────────────────────

async function bulkScreen(ctx, snap, isNew) {
  const t = ctx.t;
  const cancel = here(ctx);
  const catField = snap.cats.length ? [{ name: "cat", kind: "select", label: t("fieldCategory"), value: "", options: catOptions(ctx, snap), help: t("bulkCatHelp") }] : [];
  const stateField = can(ctx, RIGHT_PUBLISH) ? [{ name: "state", kind: "select", label: t("fieldState"), value: "draft", options: ["draft", "published"].map((s) => ({ value: s, label: statusLabel(ctx, s) })), help: t("bulkStateHelp") }] : [];
  const form = { type: "adminForm", action: "bulkPreview", submitLabel: t("bulkPreviewButton"), cancelHref: cancel, fields: [{ name: "urls", kind: "textarea", required: true, label: t("bulkField", { max: LIMITS.bulk }), help: t("bulkFieldHelp", { max: LIMITS.bulk, example: EXAMPLE }) }, ...catField, ...stateField] };
  const bulk = isNew ? null : await D.readBulk(ctx);
  if (!bulk) {
    return [{ type: "heading", text: t("bulkTitle") }, ...(isNew ? [] : [{ type: "banner", tone: "info", text: t("bulkExpired") }]), { type: "markdown", text: t("bulkIntro", { max: LIMITS.bulk }) }, form];
  }
  const good = bulk.rows.filter((r) => r.ok && !snap.byExt.has(`${r.provider}:${r.ext}`));
  const rows = bulk.rows.map((r) => {
    const dup = r.ok ? snap.byExt.get(`${r.provider}:${r.ext}`) : null;
    return [`${r.text} — ${r.ok ? (dup ? t("bulkDup", { title: dup.title || dup.ext }) : t("bulkNew")) : t(`bulkErr_${["format", "host", "id", "playlist", "channel", "dup"].includes(r.error) ? r.error : "format"}`)}`];
  });
  const out = [{ type: "heading", text: t("bulkPreviewTitle") }, { type: "markdown", text: t("bulkSummary", { good: good.length, total: bulk.rows.length, example: EXAMPLE }) }, { type: "table", columns: [t("bulkColAddress")], rows }];
  if (good.length) {
    const room = LIMITS.videos - snap.items.length;
    if (good.length > room) out.push({ type: "banner", tone: "warning", text: t("bulkRoom", { room: Math.max(0, room), max: LIMITS.videos }) });
    out.push({ type: "adminForm", action: "bulkConfirm", title: t("bulkConfirmTitle"), submitLabel: t("bulkConfirmButton", { n: good.length }), cancelHref: cancel, fields: [{ name: "go", kind: "hidden", value: "1" }] });
  } else out.push({ type: "markdown", text: t("bulkNothing") });
  out.push({ type: "links", items: [{ label: t("bulkAgain"), href: `${here(ctx)}?bulk=new` }] });
  return out;
}

// ── Onglet 2 : catégories et séries ────────────────────────────────────────────────────────────────────────────────

function shelfBlocks(ctx, snap, editor) {
  const t = ctx.t, out = [];
  const tab = (b) => ({ ...b, tab: "shelves" });
  if (!snap.cats.length && editor && !snap.series.length) {
    out.push(tab({ type: "heading", text: t("tplTitle") }), tab({ type: "markdown", text: t("tplIntro") }));
    out.push(tab({ type: "adminForm", action: "applyTemplate", submitLabel: t("tplButton"), fields: [{ name: "template", kind: "select", label: t("tplField"), value: "talks", options: [{ value: "talks", label: t("tplTalks") }, { value: "empty", label: t("tplEmpty") }], help: t("tplFieldHelp") }] }));
  }
  // Catégories
  out.push(tab({ type: "heading", text: t("catsTitle", { n: snap.cats.length }) }), tab({ type: "markdown", text: t("catsIntro") }));
  if (snap.cats.length) {
    out.push(tab({
      type: "table", columns: [t("colName")],
      rows: snap.cats.map((c, i) => [`${i + 1}. ${D.catName(ctx, c)} — ${t("count", { n: snap.items.filter((x) => x.cat === c.k).length, word: t("vocOne").toLowerCase() })}`]),
      rowIds: snap.cats.map((c) => String(c.k)),
      rowActions: editor ? [{ label: t("actUp"), action: "catUp" }, { label: t("actDown"), action: "catDown" }, { label: t("actRename"), href: "?cat={id}" }, { label: t("actDelete"), action: "catRemove", confirm: t("confirmCatDelete"), danger: true }] : [],
    }));
  } else out.push(tab({ type: "markdown", text: t("catsNone") }));
  if (editor) out.push(tab({ type: "adminForm", action: "catAdd", title: t("catAddTitle"), submitLabel: t("catAddButton"), fields: langFields(ctx, "name", null, { label: "fieldName", help: "fieldNameHelp", max: LIMITS.name }) }));
  // Séries
  out.push(tab({ type: "heading", text: t("seriesTitle", { n: snap.series.length }) }), tab({ type: "markdown", text: t("seriesIntro") }));
  if (snap.series.length) {
    out.push(tab({
      type: "table", columns: [t("colName")],
      rows: snap.series.map((s, i) => [`${i + 1}. ${D.seriesName(ctx, s)} — ${t("count", { n: s.items.length, word: t("vocOne").toLowerCase() })} — ${t(s.status === "published" ? "st_published" : "st_draft")}`]),
      rowIds: snap.series.map((s) => String(s.p)),
      rowActions: editor ? [{ label: t("actEdit"), href: "?series={id}" }, { label: t("actUp"), action: "seriesUp" }, { label: t("actDown"), action: "seriesDown" }, { label: t("actDelete"), action: "seriesRemove", confirm: t("confirmSeriesDelete"), danger: true }] : [],
    }));
  } else out.push(tab({ type: "markdown", text: t("seriesNone") }));
  if (editor) out.push(tab({ type: "adminForm", action: "seriesAdd", title: t("seriesAddTitle"), submitLabel: t("seriesAddButton"), fields: langFields(ctx, "name", null, { label: "fieldName", help: "fieldNameHelp", max: LIMITS.name }) }));
  return out;
}

function categoryScreen(ctx, snap, k) {
  const t = ctx.t;
  const c = snap.cats.find((x) => x.k === k);
  if (!c) return [{ type: "banner", tone: "warning", text: t("goneCategory") }, backLink(ctx, "shelves")];
  return [
    { type: "heading", text: t("catEditTitle", { name: D.catName(ctx, c) }) },
    { type: "adminForm", action: "catSave", submitLabel: t("save"), cancelHref: `${here(ctx)}?tab=shelves`, fields: [{ name: "id", kind: "hidden", value: String(k) }, ...langFields(ctx, "name", c.names, { label: "fieldName", help: "fieldNameHelp", max: LIMITS.name })] },
  ];
}

function seriesScreen(ctx, snap, p, vq) {
  const t = ctx.t;
  const s = snap.series.find((x) => x.p === p);
  if (!s) return [{ type: "banner", tone: "warning", text: t("goneSeries") }, backLink(ctx, "shelves")];
  const out = [{ type: "heading", text: t("seriesEditTitle", { name: D.seriesName(ctx, s) }) }];
  out.push({
    type: "adminForm", action: "seriesSave", submitLabel: t("save"), cancelHref: `${here(ctx)}?tab=shelves`,
    fields: [
      { name: "id", kind: "hidden", value: String(p) },
      ...langFields(ctx, "name", s.names, { label: "fieldName", help: "fieldNameHelp", max: LIMITS.name }),
      ...langFields(ctx, "desc", s.descs, { label: "fieldSeriesDesc", kind: "textarea", help: "fieldSeriesDescHelp", max: LIMITS.seriesDesc }),
      ...(can(ctx, RIGHT_PUBLISH) ? [{ name: "state", kind: "select", label: t("fieldState"), value: s.status, options: ["published", "draft"].map((x) => ({ value: x, label: statusLabel(ctx, x) })), help: t("fieldSeriesStateHelp") }] : []),
    ],
  });
  // Les vidéos de la série, dans l'ordre
  const vids = s.items.map((n) => snap.byN.get(n)).filter(Boolean);
  out.push({ type: "heading", text: t("seriesItemsTitle", { n: vids.length, max: LIMITS.inSeries }) });
  if (vids.length) {
    out.push({ type: "markdown", text: t("seriesItemsHelp") });
    out.push({
      type: "table", columns: [t("colTitle")],
      rows: vids.map((x, i) => [`${i + 1}. ${untitled(ctx, x)} — ${statusLabel(ctx, x.status)}`]),
      rowIds: vids.map((x) => `${p}:${x.n}`),
      rowActions: [{ label: t("actUp"), action: "seriesItemUp" }, { label: t("actDown"), action: "seriesItemDown" }, { label: t("actRemoveFromSeries"), action: "seriesItemRemove", danger: true }],
    });
  } else out.push({ type: "markdown", text: t("seriesItemsNone") });
  // Chercher une vidéo à ajouter
  const words = P.searchWords(vq);
  out.push({ type: "adminForm", action: "seriesSearch", title: t("seriesFindTitle"), submitLabel: t("searchButton"), fields: [{ name: "id", kind: "hidden", value: String(p) }, { name: "q", kind: "text", label: t("findLabel"), value: clean(vq, LIMITS.searchMax), help: t("seriesFindHelp") }] });
  const inSet = new Set(s.items);
  const found = snap.items.filter((x) => !inSet.has(x.n) && x.status !== "hidden" && (!words.length || words.every((w) => x.hay.includes(w)))).slice(0, 20);
  if (found.length) out.push({ type: "table", columns: [t("colTitle")], rows: found.map((x) => [`${untitled(ctx, x)} — ${statusLabel(ctx, x.status)}`]), rowIds: found.map((x) => `${p}:${x.n}`), rowActions: [{ label: t("actAddToSeries"), action: "seriesItemAdd" }] });
  else if (words.length) out.push({ type: "markdown", text: t("seriesFindNone") });
  out.push({ type: "links", items: [{ label: t("back"), href: `${here(ctx)}?tab=shelves` }] });
  return out;
}

// ── Les actions ────────────────────────────────────────────────────────────────────────────────────────────────────

const done = (ok, extra = {}) => ({ ok, redirect: "?", ...extra });
const num = (x) => (/^\d{1,7}$/.test(str(x)) ? Number(str(x)) : 0);
const pair = (x) => { const m = /^(\d{1,7}):(\d{1,7})$/.exec(str(x)); return m ? { p: Number(m[1]), n: Number(m[2]) } : null; };

function readVideoFields(ctx, values, cur, snap, canPublish) {
  const errors = {};
  const title = clean(values.title, LIMITS.title);
  const desc = clean(values.desc, LIMITS.desc, true);
  if ([...clean(values.desc, 100000, true)].length > LIMITS.desc) errors.desc = ctx.t("errTooLong", { max: LIMITS.desc });
  const transcript = clean(values.transcript, LIMITS.transcript, true);
  if ([...clean(values.transcript, 1000000, true)].length > LIMITS.transcript) errors.transcript = ctx.t("errTooLong", { max: LIMITS.transcript });
  let date = cur.date;
  if (clean(values.date, 10)) { const d = P.parseDate(values.date); if (!d) errors.date = ctx.t("errDate"); else date = d; }
  let dur = 0;
  if (clean(values.dur, 20)) { const d = P.parseDuration(values.dur); if (d === null) errors.dur = ctx.t("errDuration"); else dur = d; }
  let cover = cur.cover;
  if (values.cover !== undefined) { const raw = clean(values.cover, 300); cover = raw ? P.sitePath(raw) : ""; if (raw && !cover) errors.cover = ctx.t("errCover"); }
  const catRaw = clean(values.cat, 10);
  const cat = catRaw && snap.cats.some((c) => String(c.k) === catRaw) ? Number(catRaw) : 0;
  const status = canPublish ? P.VIDEO_STATUS(clean(values.state, 12)) : cur.status;
  if (status === "published" && !title) errors.title = ctx.t("errPublishTitle");
  return { errors, patch: { title, desc, date, dur, cover, cat, free: values.free === "on", album: values.album === undefined ? cur.album : clean(values.album, 80), status }, transcript };
}

export const actions = {
  // ── ajouter
  add: { right: RIGHT_EDIT, async run(ctx, values) {
    const address = clean(values.url, 500);
    if (!address) return { errors: { url: ctx.t("err_format", { example: EXAMPLE }) } };
    const snap = await D.snapshot(ctx, { fresh: true });
    const catRaw = clean(values.cat, 10);
    const r = await O.addOne(ctx, {
      address, title: values.title, cat: snap.cats.some((c) => String(c.k) === catRaw) ? Number(catRaw) : 0,
      status: can(ctx, RIGHT_PUBLISH) ? clean(values.state, 12) : "draft",
    });
    if (!r.ok) {
      const msg = errorFor(ctx, r.code, r.item);
      return r.field ? { errors: { [r.field]: msg } } : { error: msg };
    }
    const base = ctx.t(r.lookup === "ok" ? "addedFilled" : "addedTyped", { title: r.item.title });
    return { ok: [base, r.item.status === "published" ? "" : ctx.t("addedDraftHint"), r.thumbKept || D.settings(ctx).thumbs === "plain" ? "" : ctx.t("addedNoThumb")].filter(Boolean).join(" "), redirect: `?edit=${r.item.n}` };
  } },

  // ── plusieurs d'un coup
  bulkPreview: { right: RIGHT_EDIT, async run(ctx, values) {
    const raw = clean(values.urls, 100000, true);
    if (raw.length > LIMITS.bulkText) return { errors: { urls: ctx.t("errBulkLong", { max: LIMITS.bulk }) } };
    const tokens = raw.split(/[\s,;]+/).filter(Boolean);
    if (!tokens.length) return { errors: { urls: ctx.t("errBulkEmpty", { example: EXAMPLE }) } };
    if (tokens.length > LIMITS.bulk) return { errors: { urls: ctx.t("errBulkMany", { n: tokens.length, max: LIMITS.bulk }) } };
    const seen = new Set();
    const rows = tokens.map((text) => {
      const r = R.parseAddress(text);
      if (!r.ok) return { text: clean(text, 120), ok: false, provider: "", ext: "", error: r.why };
      const key = `${r.provider}:${r.id}`;
      if (seen.has(key)) return { text: clean(text, 120), ok: false, provider: "", ext: "", error: "dup" };
      seen.add(key);
      return { text: clean(text, 120), ok: true, provider: r.provider, ext: r.id, error: "" };
    });
    const snap = await D.snapshot(ctx, { fresh: true });
    const catRaw = clean(values.cat, 10);
    await D.saveBulk(ctx, rows, { cat: snap.cats.some((c) => String(c.k) === catRaw) ? Number(catRaw) : 0, status: can(ctx, RIGHT_PUBLISH) ? clean(values.state, 12) : "draft" });
    return { redirect: "?bulk=1" };
  } },
  bulkConfirm: { right: RIGHT_EDIT, async run(ctx) {
    const bulk = await D.readBulk(ctx);
    if (!bulk) return { error: ctx.t("bulkExpired") };
    const list = bulk.rows.filter((r) => r.ok).map((r) => ({ provider: r.provider, ext: r.ext, cat: bulk.cat, status: "draft" }));
    const r = await D.addVideos(ctx, list);
    // Les titres : tout de suite pour un premier lot ; le reste se complète d'un clic.
    const c = await O.complete(ctx, { limit: LIMITS.fillBatch });
    if (bulk.status === "published") for (const x of r.added) await D.updateVideo(ctx, x.n, { status: "published" });
    await D.clearBulk(ctx);
    const parts = [ctx.t("bulkAdded", { n: r.added.length })];
    if (r.duplicates.length) parts.push(ctx.t("bulkSkipped", { n: r.duplicates.length }));
    if (r.full) parts.push(ctx.t("bulkFull", { n: r.full, max: LIMITS.videos }));
    if (c.left) parts.push(ctx.t(c.down ? "bulkLeftDown" : "bulkLeft", { n: c.left }));
    return done(parts.join(" "));
  } },
  complete: { right: RIGHT_EDIT, async run(ctx) {
    const c = await O.complete(ctx, { limit: LIMITS.fillBatch });
    if (c.down && !c.titles && !c.thumbs) return { error: ctx.t("completeDown") };
    return done(c.left ? ctx.t("completeSome", { titles: c.titles, thumbs: c.thumbs, left: c.left }) : ctx.t("completeAll", { titles: c.titles, thumbs: c.thumbs }));
  } },
  search: { right: RIGHT_EDIT, async run(ctx, values) {
    const q = clean(values.q, LIMITS.searchMax), st = clean(values.st, 12);
    const parts = [q && `q=${enc(q)}`, ["published", "draft", "hidden"].includes(st) && `st=${st}`].filter(Boolean);
    return { redirect: parts.length ? `?${parts.join("&")}` : "?" };
  } },

  // ── une vidéo
  save: { right: RIGHT_EDIT, async run(ctx, values) {
    const n = num(values.id);
    const snap = await D.snapshot(ctx, { fresh: true });
    const cur = snap.byN.get(n);
    if (!cur) return { error: ctx.t("goneVideo") };
    const { errors, patch, transcript } = readVideoFields(ctx, values, cur, snap, can(ctx, RIGHT_PUBLISH));
    if (Object.keys(errors).length) return { errors };
    const saved = await D.updateVideo(ctx, n, patch, { text: transcript });
    if (!saved) return { error: ctx.t("goneVideo") };
    return done(ctx.t("saved", { title: saved.title || saved.ext }));
  } },
  publish: { right: RIGHT_PUBLISH, async run(ctx, values) {
    const x = (await D.snapshot(ctx, { fresh: true })).byN.get(num(values.id));
    if (!x) return { error: ctx.t("goneVideo") };
    if (!x.title) return { error: ctx.t("errPublishTitleRow") };
    await D.updateVideo(ctx, x.n, { status: "published" });
    return done(ctx.t("published", { title: x.title }));
  } },
  hide: { right: RIGHT_PUBLISH, async run(ctx, values) {
    const x = (await D.snapshot(ctx, { fresh: true })).byN.get(num(values.id));
    if (!x) return { error: ctx.t("goneVideo") };
    await D.updateVideo(ctx, x.n, { status: "hidden" });
    return done(ctx.t("hidden", { title: untitled(ctx, x) }));
  } },
  refresh: { right: RIGHT_EDIT, async run(ctx, values) {
    const x = (await D.snapshot(ctx, { fresh: true })).byN.get(num(values.id));
    if (!x) return { error: ctx.t("goneVideo") };
    const info = await O.refreshOne(ctx, x);
    if (info.state === "down") return { error: ctx.t("completeDown") };
    return { ok: ctx.t(info.state === "ok" ? "refreshed" : info.state === "private" ? "refreshedPrivate" : "refreshedMissing"), redirect: `?edit=${x.n}` };
  } },
  remove: { right: RIGHT_EDIT, async run(ctx, values) {
    const n = num(values.id);
    const x = (await D.snapshot(ctx, { fresh: true })).byN.get(n);
    if (!x || !(await D.removeVideo(ctx, n))) return { error: ctx.t("goneVideo") };
    return done(ctx.t("removed", { title: untitled(ctx, x) }));
  } },

  // ── catégories
  applyTemplate: { right: RIGHT_EDIT, async run(ctx, values) {
    const r = await D.applyTemplate(ctx, clean(values.template, 12));
    if (!r.ok) return r.code === "already" ? { error: ctx.t("tplAlready") } : { error: ctx.t("errSave") };
    return done(r.made ? ctx.t("tplDone", { n: r.made }) : ctx.t("tplDoneEmpty"));
  } },
  catAdd: { right: RIGHT_EDIT, async run(ctx, values) {
    const names = readLang(ctx, "name", values, LIMITS.name);
    if (!Object.keys(names).length) return { errors: { [`name_${P.localesOf(ctx)[0]}`]: ctx.t("errName") } };
    const r = await D.addCategory(ctx, names);
    if (!r.ok) return { error: ctx.t(r.code === "full" ? "errCatFull" : "errSave", { max: LIMITS.categories }) };
    return done(ctx.t("catAdded", { name: P.pickName(names, ctx.locale, ctx.defaultLocale) }), { redirect: "?tab=shelves" });
  } },
  catSave: { right: RIGHT_EDIT, async run(ctx, values) {
    const names = readLang(ctx, "name", values, LIMITS.name);
    if (!Object.keys(names).length) return { errors: { [`name_${P.localesOf(ctx)[0]}`]: ctx.t("errName") } };
    if (!(await D.renameCategory(ctx, num(values.id), names))) return { error: ctx.t("goneCategory") };
    return done(ctx.t("catSaved"), { redirect: "?tab=shelves" });
  } },
  catUp: { right: RIGHT_EDIT, async run(ctx, values) { await D.moveCategory(ctx, num(values.id), "up"); return done(ctx.t("moved"), { redirect: "?tab=shelves" }); } },
  catDown: { right: RIGHT_EDIT, async run(ctx, values) { await D.moveCategory(ctx, num(values.id), "down"); return done(ctx.t("moved"), { redirect: "?tab=shelves" }); } },
  catRemove: { right: RIGHT_EDIT, async run(ctx, values) {
    if (!(await D.removeCategory(ctx, num(values.id)))) return { error: ctx.t("goneCategory") };
    return done(ctx.t("catRemoved"), { redirect: "?tab=shelves" });
  } },

  // ── séries
  seriesAdd: { right: RIGHT_EDIT, async run(ctx, values) {
    const names = readLang(ctx, "name", values, LIMITS.name);
    if (!Object.keys(names).length) return { errors: { [`name_${P.localesOf(ctx)[0]}`]: ctx.t("errName") } };
    const r = await D.addSeries(ctx, names);
    if (!r.ok) return { error: ctx.t(r.code === "full" ? "errSeriesFull" : "errSave", { max: LIMITS.series }) };
    return { ok: ctx.t("seriesAdded"), redirect: `?series=${r.p}` };
  } },
  seriesSave: { right: RIGHT_EDIT, async run(ctx, values) {
    const names = readLang(ctx, "name", values, LIMITS.name);
    if (!Object.keys(names).length) return { errors: { [`name_${P.localesOf(ctx)[0]}`]: ctx.t("errName") } };
    const descs = readLang(ctx, "desc", values, LIMITS.seriesDesc);
    for (const l of P.localesOf(ctx)) if ([...clean(values[`desc_${l}`], 100000, true)].length > LIMITS.seriesDesc) return { errors: { [`desc_${l}`]: ctx.t("errTooLong", { max: LIMITS.seriesDesc }) } };
    const patch = { names, descs };
    if (can(ctx, RIGHT_PUBLISH)) patch.status = clean(values.state, 12) === "published" ? "published" : "draft";
    if (!(await D.updateSeries(ctx, num(values.id), patch))) return { error: ctx.t("goneSeries") };
    return done(ctx.t("seriesSaved"), { redirect: "?tab=shelves" });
  } },
  seriesUp: { right: RIGHT_EDIT, async run(ctx, values) { await D.moveSeries(ctx, num(values.id), "up"); return done(ctx.t("moved"), { redirect: "?tab=shelves" }); } },
  seriesDown: { right: RIGHT_EDIT, async run(ctx, values) { await D.moveSeries(ctx, num(values.id), "down"); return done(ctx.t("moved"), { redirect: "?tab=shelves" }); } },
  seriesRemove: { right: RIGHT_EDIT, async run(ctx, values) {
    if (!(await D.removeSeries(ctx, num(values.id)))) return { error: ctx.t("goneSeries") };
    return done(ctx.t("seriesRemoved"), { redirect: "?tab=shelves" });
  } },
  seriesSearch: { right: RIGHT_EDIT, async run(ctx, values) {
    const q = clean(values.q, LIMITS.searchMax);
    return { redirect: `?series=${num(values.id)}${q ? `&vq=${enc(q)}` : ""}` };
  } },
  seriesItemAdd: { right: RIGHT_EDIT, async run(ctx, values) {
    const pr = pair(values.id);
    if (!pr) return { error: ctx.t("goneSeries") };
    const r = await D.editSeriesItems(ctx, pr.p, pr.n, "add");
    if (!r.ok) return { error: ctx.t(r.code === "full" ? "errSeriesItemsFull" : r.code === "duplicate" ? "errSeriesDup" : "goneSeries", { max: LIMITS.inSeries }) };
    return { ok: ctx.t("seriesItemAdded"), redirect: `?series=${pr.p}` };
  } },
  seriesItemRemove: { right: RIGHT_EDIT, async run(ctx, values) {
    const pr = pair(values.id);
    if (!pr) return { error: ctx.t("goneSeries") };
    await D.editSeriesItems(ctx, pr.p, pr.n, "remove");
    return { ok: ctx.t("seriesItemRemoved"), redirect: `?series=${pr.p}` };
  } },
  seriesItemUp: { right: RIGHT_EDIT, async run(ctx, values) {
    const pr = pair(values.id);
    if (!pr) return { error: ctx.t("goneSeries") };
    await D.editSeriesItems(ctx, pr.p, pr.n, "up");
    return { ok: ctx.t("moved"), redirect: `?series=${pr.p}` };
  } },
  seriesItemDown: { right: RIGHT_EDIT, async run(ctx, values) {
    const pr = pair(values.id);
    if (!pr) return { error: ctx.t("goneSeries") };
    await D.editSeriesItems(ctx, pr.p, pr.n, "down");
    return { ok: ctx.t("moved"), redirect: `?series=${pr.p}` };
  } },
};
