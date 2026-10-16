// Évènements saisis à la main — module communautaire de Curiosa. Pour qui n'a pas de calendrier en ligne : on écrit ses évènements ici
// (titre, début, fin ou « toute la journée », lieu, lien, annulé, catégorie, répétition hebdomadaire) et ils sont mis à disposition des autres
// modules comme ceux de n'importe quel calendrier (sujet `calendar.event`, service `calendar.provider`). Il ne connaît aucun consommateur.
// Les évènements sont gardés dans le stockage du module. La logique pure (validation, répétition) est dans schedule.mjs.
const V = new URL(import.meta.url).search;   // même « version » pour les fichiers voisins : jamais d'ancien code en mémoire après une mise à jour
const { cleanEvent, occurrencesOf, parseDate } = await import(`./schedule.mjs${V}`);
const { isValidTimeZone } = await import(`./zone.mjs${V}`);
export { cleanEvent, occurrencesOf };

const COLLECTION = "events";
const MAX_EVENTS = 500;
const MAX_ITEMS = 200;
const DAY = 86_400_000;
const text = (v) => String(v ?? "").trim();
const hexColor = (v) => (/^#[0-9a-fA-F]{6}$|^#[0-9a-fA-F]{3}$/.test(text(v)) ? text(v) : null);
const tagsOf = (v) => [...new Set(text(v).split(/[,;\n]/).map((s) => s.trim().toLowerCase()).filter(Boolean))].slice(0, 20);

function settingsOf(ctx) {
  const tz = text(ctx.setting("timezone"));
  return { label: text(ctx.setting("label")).slice(0, 60), color: hexColor(ctx.setting("color")), tags: tagsOf(ctx.setting("tags")), timeZone: isValidTimeZone(tz) ? tz : "UTC" };
}
const rowsOf = async (ctx) => (await ctx.api.store.list(COLLECTION, { limit: MAX_EVENTS })).filter((r) => r?.data && typeof r.data === "object");
const yesNo = (ctx) => [{ value: "no", label: ctx.t("no") }, { value: "yes", label: ctx.t("yes") }];

/** Plage demandée (Date) -> [from, to] bornés ; sans plage : maintenant → +60 jours, 400 jours au plus. */
function windowOf({ from, to } = {}, now = Date.now()) {
  const a = from instanceof Date && !Number.isNaN(from.getTime()) ? from : null, b = to instanceof Date && !Number.isNaN(to.getTime()) ? to : null;
  const lo = a ?? new Date(now);
  let hi = b ?? new Date(lo.getTime() + 60 * DAY);
  if (hi.getTime() < lo.getTime()) hi = lo;
  if (hi.getTime() - lo.getTime() > 400 * DAY) hi = new Date(lo.getTime() + 400 * DAY);
  return [lo, hi];
}

function describeRepeat(ctx, ev) {
  if (ev.repeat !== "weekly") return ctx.t("repeatNone");
  const names = ctx.t("weekdays").split(",");
  const days = (ev.repeatDays ?? []).map((d) => names[d]).filter(Boolean).join(", ");
  const end = ev.repeatUntil ? ctx.t("repeatUntilTxt", { date: ev.repeatUntil }) : Number(ev.repeatCount) > 0 ? ctx.t("repeatCountTxt", { n: ev.repeatCount }) : "";
  return `${ctx.t("repeatWeekly")} (${days})${end ? ` · ${end}` : ""}`;
}

export default {
  exports: {
    /** Les évènements de la plage demandée, avec l'étiquette et la couleur de CETTE source. */
    async "calendar.event"(ctx, { limit, tags, from, to } = {}) {
      const s = settingsOf(ctx);
      if (Array.isArray(tags) && tags.length && !tags.some((t) => s.tags.includes(String(t).toLowerCase()))) return [];
      const [lo, hi] = windowOf({ from, to });
      const untitled = ctx.t("untitled");
      const items = (await rowsOf(ctx)).flatMap((r) => occurrencesOf(r.id, r.data, { from: lo, to: hi, timeZone: s.timeZone, untitled }));
      items.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
      return items.slice(0, Math.min(MAX_ITEMS, Math.max(1, Math.trunc(Number(limit)) || 50))).map((i) => ({ ...i, ...(s.label ? { sourceLabel: s.label } : {}), ...(s.color ? { color: s.color } : {}) }));
    },
  },

  services: {
    "calendar.provider": {
      /** { kind, label, color?, active, state } — décrit cette source ; une saisie à la main est toujours disponible. */
      async describe(ctx) {
        const s = settingsOf(ctx);
        return { kind: "manual", label: s.label || null, color: s.color, active: true, state: "ok" };
      },
    },
  },

  async adminPanel(ctx, { query } = {}) {
    const t = ctx.t, s = settingsOf(ctx);
    const rows = await rowsOf(ctx);
    const form = (r) => {
      const d = r?.data ?? {};
      return {
        type: "adminForm", action: "save", title: r ? `${t("edit")} — ${d.title}` : t("add"), submitLabel: t("save"), cancelHref: r ? "?" : undefined,
        fields: [
          { name: "id", kind: "hidden", value: r?.id ?? "" },
          { name: "title", label: t("fTitle"), required: true, value: d.title ?? "" },
          { name: "startDate", label: t("fStartDate"), kind: "date", required: true, value: d.startDate ?? "" },
          { name: "startTime", label: t("fStartTime"), help: t("hTime"), value: d.startTime ?? "" },
          { name: "endDate", label: t("fEndDate"), kind: "date", help: t("hEndDate"), value: d.endDate ?? "" },
          { name: "endTime", label: t("fEndTime"), value: d.endTime ?? "" },
          { name: "allDay", label: t("fAllDay"), kind: "select", options: yesNo(ctx), value: d.allDay ? "yes" : "no" },
          { name: "category", label: t("fCategory"), help: t("hCategory"), value: d.category ?? "" },
          { name: "description", label: t("fDescription"), kind: "textarea", value: d.description ?? "" },
          { name: "location", label: t("fLocation"), value: d.location ?? "" },
          { name: "url", label: t("fUrl"), kind: "url", value: d.url ?? "" },
          { name: "cancelled", label: t("fCancelled"), help: t("hCancelled"), kind: "select", options: yesNo(ctx), value: d.cancelled ? "yes" : "no" },
          { name: "repeat", label: t("fRepeat"), kind: "select", options: [{ value: "none", label: t("repeatNone") }, { value: "weekly", label: t("repeatWeekly") }], value: d.repeat === "weekly" ? "weekly" : "none" },
          { name: "repeatDays", label: t("fRepeatDays"), help: t("hRepeatDays"), value: (d.repeatDays ?? []).map((n) => t("weekdays").split(",")[n]).filter(Boolean).join(", ") },
          { name: "repeatUntil", label: t("fRepeatUntil"), kind: "date", value: d.repeatUntil ?? "" },
          { name: "repeatCount", label: t("fRepeatCount"), help: t("hRepeatCount"), kind: "number", value: d.repeatCount ? String(d.repeatCount) : "" },
        ],
      };
    };
    const editing = query?.edit && rows.find((r) => r.id === query.edit);
    if (editing) return [form(editing)];

    const dayFmt = new Intl.DateTimeFormat(ctx.locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
    const when = (d) => {
      const day = parseDate(d.startDate);
      const label = day ? dayFmt.format(new Date(Date.UTC(day.y, day.m - 1, day.d))) : d.startDate;
      return d.allDay ? `${label} · ${t("allDay")}` : `${label} · ${d.startTime}${d.endTime ? `–${d.endTime}` : ""}`;
    };
    const sorted = [...rows].sort((a, b) => String(a.data.startDate).localeCompare(String(b.data.startDate)) || String(a.data.startTime).localeCompare(String(b.data.startTime)));
    return [
      { type: "markdown", text: t("intro", { tz: s.timeZone }) },
      { type: "heading", text: t("listTitle", { n: rows.length }) },
      sorted.length
        ? { type: "table", columns: [t("colWhen"), t("colTitle"), t("colRepeat"), t("colState")], rows: sorted.map((r) => [when(r.data), r.data.title, describeRepeat(ctx, r.data), r.data.cancelled ? t("stateCancelled") : t("stateOk")]), rowIds: sorted.map((r) => r.id), rowActions: [{ label: t("actEdit"), href: "?edit={id}" }, { label: t("actDelete"), action: "remove", confirm: t("confirmDelete"), danger: true }] }
        : { type: "markdown", text: t("none") },
      form(null),
    ];
  },

  adminActions: {
    async save(ctx, v) {
      const t = ctx.t;
      const r = cleanEvent(v);
      if (r.error) return { error: t(r.error) };
      if (v.id) {
        if (!(await ctx.api.store.get(v.id))) return { error: t("notFound") };
        await ctx.api.store.update(v.id, r.event);
      } else {
        if ((await ctx.api.store.count(COLLECTION)) >= MAX_EVENTS) return { error: t("errMax", { n: MAX_EVENTS }) };
        await ctx.api.store.add(COLLECTION, r.event);
      }
      return { ok: t("saved"), redirect: "?" };
    },
    async remove(ctx, v) {
      const row = v.id ? await ctx.api.store.get(v.id) : null;
      if (!row) return { error: ctx.t("notFound") };
      await ctx.api.store.remove(row.id);
      return { ok: ctx.t("removed") };
    },
  },
};
