// Compte à rebours — l'administration : la liste des événements, le formulaire (court pour commencer, complet pour modifier) et ses actions.
const V = new URL(import.meta.url).search;
const T = await import(`./time.mjs${V}`);
const M = await import(`./model.mjs${V}`);
const R = await import(`./render.mjs${V}`);
const { ZONES, zoneOptions, PREVIEW } = await import(`./zones.mjs${V}`);

/** Le droit est vérifié par le cœur avant chaque action ; ici on ne fait que cacher les boutons qu'on n'a pas le droit d'utiliser. */
const may = (ctx, right) => typeof ctx.can !== "function" || ctx.can(right);

/** Fuseau proposé par défaut : « autre fuseau » du réglage s'il est valide, sinon le choix du réglage, sinon Paris (mêmes règles d’heure d’été que la Belgique). */
export function defaultZone(ctx) {
  const other = String(ctx.setting("timezoneOther") ?? "").trim();
  if (other && T.isValidZone(other)) return other;
  const chosen = String(ctx.setting("timezone") ?? "").trim();
  return T.isValidZone(chosen) ? chosen : M.DEFAULT_ZONE;
}

const keepOptions = (ctx, withDefault) => [
  ...(withDefault ? [{ value: "", label: ctx.t("keepSame") }] : []),
  ...M.KEEP_KEYS.map((k) => ({ value: k, label: ctx.t(`keep_${k}`) })),
];

/** « dans 3 jours et 4 heures » · « dans 25 minutes ». */
function inText(ctx, ms) {
  const L = R.labels(ctx);
  const b = T.breakdown(ms);
  const bits = [];
  if (b.d) bits.push(`${b.d} ${T.plural(b.d, L.d, ctx.locale)}`);
  if (b.h && b.d < 7) bits.push(`${b.h} ${T.plural(b.h, L.h, ctx.locale)}`);
  if (!b.d && b.m) bits.push(`${b.m} ${T.plural(b.m, L.m, ctx.locale)}`);
  return bits.length ? ctx.t("relIn", { text: bits.slice(0, 2).join(` ${L.and} `) }) : ctx.t("relSoon");
}

const dateTime = (ctx, ms, tz) => T.fmtIn(ms, tz, ctx.locale, { dateStyle: "medium", timeStyle: "short" });

function statusText(ctx, v, featuredId, now) {
  const star = v.id === featuredId ? `${ctx.t("statusFeatured")} · ` : "";
  if (v.phase === "upcoming") return `${star}${ctx.t("statusUpcoming")} · ${inText(ctx, v.startMs - now)}`;
  if (v.phase === "started") return `${star}${Number.isFinite(v.hideMs) ? ctx.t("statusStarted", { when: dateTime(ctx, v.hideMs, v.tz) }) : ctx.t("statusKept")}`;
  return ctx.t("statusHidden", { when: dateTime(ctx, v.hideMs, v.tz) });
}

function whenCell(ctx, v, now) {
  return T.linesFor(v.startMs, now, v.tz, "", ctx.locale, R.labels(ctx), v.allDay).event;
}

/** « Chez vos visiteurs : Londres : samedi 20 h · New York : samedi 15 h · Tokyo : dimanche 5 h ». */
function preview(ctx, v) {
  if (v.allDay) return "";
  const i = String(ctx.locale).slice(0, 2) === "fr" ? 1 : 2;
  const bits = PREVIEW.map((p) => {
    const parts = T.zoneParts(v.startMs, p[0]);
    const here = T.zoneParts(v.startMs, v.tz);
    const dayDiff = Math.round((Date.UTC(parts.y, parts.mo - 1, parts.d) - Date.UTC(here.y, here.mo - 1, here.d)) / 86_400_000);
    const day = dayDiff === 0 ? "" : ` (${ctx.t(dayDiff > 0 ? "dayAfter" : "dayBefore")})`;
    return `${p[i]} : ${T.clockText(parts.h, parts.mi, ctx.locale)}${day}`;
  });
  return ctx.t("previewZones", { list: bits.join(" · ") });
}

function formFields(ctx, { mode, ev, zone }) {
  const zones = zoneOptions(ctx.locale);
  const known = ev ? ZONES.some((z) => z[0] === ev.tz) : true;
  const tzValue = ev ? (known ? ev.tz : zone) : zone;
  const tzSelect = zones.some((z) => z.value === tzValue) ? zones : [{ value: tzValue, label: tzValue }, ...zones];
  const f = [
    { name: "title", label: ctx.t("fTitle"), kind: "text", required: true, value: ev?.title ?? "", help: ctx.t("fTitleHelp") },
    { name: "date", label: ctx.t("fDate"), kind: "date", required: true, value: ev?.date ?? "", help: ctx.t("fDateHelp") },
    { name: "time", label: ctx.t("fTime"), kind: "text", value: ev?.time ?? "", help: ctx.t("fTimeHelp") },
    { name: "allDay", label: ctx.t("fAllDay"), kind: "checkbox", value: ev?.allDay ? "on" : "", help: ctx.t("fAllDayHelp") },
    { name: "tz", label: ctx.t("fZone"), kind: "select", options: tzSelect, value: tzValue, help: ctx.t("fZoneHelp") },
  ];
  if (mode === "full") {
    f.push(
      { name: "tzOther", label: ctx.t("fZoneOther"), kind: "text", value: ev && !known ? ev.tz : "", help: ctx.t("fZoneOtherHelp") },
      { name: "endDate", label: ctx.t("fEndDate"), kind: "date", value: ev?.endDate ?? "", help: ctx.t("fEndHelp") },
      { name: "endTime", label: ctx.t("fEndTime"), kind: "text", value: ev?.endTime ?? "" },
      { name: "description", label: ctx.t("fDescription"), kind: "textarea", value: ev?.description ?? "", help: ctx.t("fDescriptionHelp") },
      { name: "where", label: ctx.t("fWhere"), kind: "text", value: ev?.where ?? "", help: ctx.t("fWhereHelp") },
      { name: "image", label: ctx.t("fImage"), kind: "image", value: ev?.image ?? "", help: ctx.t("fImageHelp") },
      { name: "endMessage", label: ctx.t("fEndMessage"), kind: "text", value: ev?.endMessage ?? "", help: ctx.t("fEndMessageHelp") },
      { name: "endLinkLabel", label: ctx.t("fEndLinkLabel"), kind: "text", value: ev?.endLinkLabel ?? "", help: ctx.t("fEndLinkLabelHelp") },
      { name: "endLink", label: ctx.t("fEndLink"), kind: "url", value: ev?.endLink ?? "", help: ctx.t("fEndLinkHelp") },
      { name: "keep", label: ctx.t("fKeep"), kind: "select", options: keepOptions(ctx, true), value: ev?.keep ?? "", help: ctx.t("fKeepHelp") },
    );
  }
  f.push({ name: "featured", label: ctx.t("fFeatured"), kind: "checkbox", value: ev?.featured ? "on" : "", help: ctx.t("fFeaturedHelp") });
  return f;
}

export async function panel(ctx, { query } = {}) {
  const now = Date.now();
  const all = await M.readAll(ctx, now);
  const featuredId = M.pickFeatured(all)?.id ?? null;
  const zone = defaultZone(ctx);
  const canEdit = may(ctx, "events.edit");
  const canDelete = may(ctx, "events.delete");
  const blocks = [];
  const editId = String(query?.edit ?? "");
  const copyId = String(query?.copy ?? "");
  const editing = editId ? all.find((e) => e.id === editId) : null;
  const copying = copyId ? all.find((e) => e.id === copyId) : null;

  blocks.push({ type: "markdown", text: ctx.t("intro") });
  if (editId && !editing) blocks.push({ type: "banner", text: ctx.t("notFound"), tone: "warning" });

  const live = M.order(M.visible(all));
  const rowActions = (extra = []) => [
    ...(canEdit ? [{ label: ctx.t("btnEdit"), href: "?edit={id}" }] : []),
    ...extra,
    ...(canDelete ? [{ label: ctx.t("btnDelete"), action: "remove", confirm: ctx.t("confirmDelete"), danger: true }] : []),
  ];

  if (!all.length) blocks.push({ type: "markdown", text: ctx.t("emptyAdmin") });
  if (live.length) {
    blocks.push({ type: "heading", text: ctx.t("listTitle") });
    blocks.push({
      type: "table",
      columns: [ctx.t("colName"), ctx.t("colWhen"), ctx.t("colStatus")],
      rows: live.map((v) => [v.title, whenCell(ctx, v, now), statusText(ctx, v, featuredId, now)]),
      rowIds: live.map((v) => v.id),
      rowActions: rowActions(canEdit ? [{ label: ctx.t("btnFeature"), action: "feature" }] : []),
    });
  }

  if (canEdit) {
    if (editing || copying) {
      const base = editing ?? copying;
      const ev = editing ? editing : { ...copying, date: "", endDate: "", featured: false };
      blocks.push({ type: "heading", text: editing ? ctx.t("editTitle", { name: base.title }) : ctx.t("copyTitle", { name: base.title }) });
      if (editing) {
        const pv = preview(ctx, editing);
        if (pv) blocks.push({ type: "markdown", text: pv });
        const href = R.eventHref(ctx, editing);
        if (href) blocks.push({ type: "copy", label: ctx.t("linkPage"), text: `${ctx.api.siteUrl}${href}` });
        blocks.push({ type: "copy", label: ctx.t("linkCalendar"), text: `${ctx.api.siteUrl}${R.icsHref(ctx, editing)}` });
        blocks.push({ type: "copy", label: ctx.t("linkObs"), text: `${ctx.api.siteUrl}/overlays/${ctx.instance.key}?e=${editing.slug}` });
      }
      blocks.push({
        type: "adminForm",
        action: editing ? "save" : "create",
        title: ctx.t("formFull"),
        submitLabel: editing ? ctx.t("btnSave") : ctx.t("btnCreate"),
        cancelHref: "?",
        fields: [...(editing ? [{ name: "id", kind: "hidden", label: "id", value: editing.id }] : []), ...formFields(ctx, { mode: "full", ev, zone })],
      });
    } else {
      blocks.push({
        type: "adminForm",
        action: "create",
        title: ctx.t("formNew"),
        submitLabel: ctx.t("btnCreate"),
        fields: formFields(ctx, { mode: "quick", ev: null, zone }),
      });
      if (all.length) blocks.push({ type: "markdown", text: ctx.t("moreOptionsHint") });
    }
  }

  const gone = all.filter((v) => v.phase === "hidden").sort((a, b) => b.hideMs - a.hideMs);
  if (gone.length) {
    blocks.push({ type: "heading", text: ctx.t("pastTitle") });
    blocks.push({ type: "markdown", text: ctx.t("pastHelp") });
    blocks.push({
      type: "table",
      columns: [ctx.t("colName"), ctx.t("colWhen"), ctx.t("colStatus")],
      rows: gone.map((v) => [v.title, whenCell(ctx, v, now), statusText(ctx, v, featuredId, now)]),
      rowIds: gone.map((v) => v.id),
      rowActions: [...(canEdit ? [{ label: ctx.t("btnReuse"), href: "?copy={id}" }] : []), ...(canDelete ? [{ label: ctx.t("btnDelete"), action: "remove", confirm: ctx.t("confirmDelete"), danger: true }] : [])],
    });
    if (canDelete) blocks.push({ type: "adminForm", action: "cleanup", title: ctx.t("cleanupTitle"), submitLabel: ctx.t("btnCleanup", { n: gone.length }), fields: [] });
  }
  if (all.length) blocks.push({ type: "download", name: "calendar", label: ctx.t("downloadAll") });
  blocks.push({ type: "markdown", text: ctx.t("whereToShow"), tab: "settings" });
  return blocks;
}

// ── Actions ─────────────────────────────────────────────────────────────────────────────────────────────────────

const rowsOf = async (ctx) => (await ctx.api.store.list("events", { limit: M.MAX_EVENTS + 20 })).filter((r) => r?.data && typeof r.data === "object");

/** Retire « à la une » à tous les autres (il n'y en a qu'un). */
async function clearFeatured(ctx, rows, exceptId) {
  for (const r of rows) if (r.id !== exceptId && r.data.featured === true) await ctx.api.store.update(r.id, { ...r.data, featured: false });
}

/** Les erreurs de champ, avec leurs phrases. */
const withText = (ctx, errors) => Object.fromEntries(Object.entries(errors).map(([field, code]) => [field, ctx.t(code)]));

/** Enregistre un événement (nouveau, ou celui de `id`). Renvoie { ok: true, id, view, notes } ou { error } / { errors } prêts à afficher. */
export async function persist(ctx, values, id) {
  const rows = await rowsOf(ctx);
  const row = id ? rows.find((r) => r.id === String(id)) : null;
  if (id && !row) return { error: ctx.t("notFound") };
  if (!id && rows.length >= M.MAX_EVENTS) return { error: ctx.t("tooMany", { max: M.MAX_EVENTS }) };
  const existing = row ? (M.read(row) ?? { uid: row.data.uid, slug: row.data.slug, rev: row.data.rev, createdAt: row.data.createdAt }) : null;
  const taken = new Set(rows.filter((r) => r.id !== String(id)).map((r) => M.read(r)?.slug).filter(Boolean));
  const built = M.buildEvent(values, { zone: defaultZone(ctx), existing, takenSlugs: taken, now: Date.now() });
  if (!built.ok) return { errors: withText(ctx, built.errors) };
  const savedId = row ? row.id : await ctx.api.store.add("events", built.data);
  if (row) await ctx.api.store.update(row.id, built.data);
  if (built.data.featured) await clearFeatured(ctx, rows, savedId);
  const notes = [];
  if (built.note === "gap") notes.push(ctx.t("noteGap", { time: T.clockText(built.shifted.h, built.shifted.mi, ctx.locale) }));
  if (built.note === "fold") notes.push(ctx.t("noteFold"));
  if (built.view.phase !== "upcoming") notes.push(ctx.t("notePassed"));
  return { ok: true, id: savedId, created: !row, notes };
}

/** Le même enregistrement, sous la forme attendue d'une action d'administration. */
export async function saveEvent(ctx, values, id) {
  const r = await persist(ctx, values, id);
  if (!r.ok) return r;
  return { ok: [ctx.t(r.created ? "created" : "saved"), ...r.notes].join(" "), redirect: "?" };
}

async function featureEvent(ctx, values) {
  const rows = await rowsOf(ctx);
  const row = rows.find((r) => r.id === String(values?.id ?? ""));
  if (!row) return { error: ctx.t("notFound") };
  await ctx.api.store.update(row.id, { ...row.data, featured: true });
  await clearFeatured(ctx, rows, row.id);
  return { ok: ctx.t("featuredDone", { name: M.clean(row.data.title, 80) }) };
}

async function removeEvent(ctx, values) {
  const row = await ctx.api.store.get(String(values?.id ?? ""));
  if (!row) return { error: ctx.t("notFound") };
  await ctx.api.store.remove(row.id);
  return { ok: ctx.t("removed") };
}

async function cleanupEvents(ctx) {
  const gone = (await M.readAll(ctx)).filter((v) => v.phase === "hidden");
  for (const v of gone) await ctx.api.store.remove(v.id);
  return { ok: ctx.t("cleaned", { n: gone.length }) };
}

/** Chaque action porte son droit : le cœur le vérifie avant de l'appeler (créer et modifier ≠ supprimer). */
export const actions = {
  create: { right: "events.edit", run: (ctx, values) => saveEvent(ctx, values, null) },
  save: { right: "events.edit", run: (ctx, values) => saveEvent(ctx, values, String(values?.id ?? "")) },
  feature: { right: "events.edit", run: featureEvent },
  remove: { right: "events.delete", run: removeEvent },
  cleanup: { right: "events.delete", run: cleanupEvents },
};
