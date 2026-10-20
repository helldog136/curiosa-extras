// Streams saisis à la main — module communautaire de Curiosa. Pour qui n'a pas d'agenda en ligne : on écrit ses streams ici (titre, jour, heure, jeux,
// « chaque semaine ») et ils sont mis à la disposition des autres modules comme ceux de n'importe quel agenda (sujet `planning.slot`). Il ne connaît aucun consommateur : le Planning les affiche, le bot du chat les lit, sans savoir d'où ils viennent.
// Les streams sont gardés dans le stockage du module. La logique pure (validation, répétition) est dans schedule.mjs.
const V = new URL(import.meta.url).search;   // même « version » pour les fichiers voisins : jamais d'ancien code en mémoire après une mise à jour
const { cleanStream, slotsOf, parseDate } = await import(`./schedule.mjs${V}`);
const { isValidTimeZone } = await import(`./zone.mjs${V}`);
export { cleanStream, slotsOf };

const COLLECTION = "streams";
const MAX_STREAMS = 500;
const MAX_ITEMS = 200;
const DAY = 86_400_000;
const DEFAULT_ZONE = "Europe/Paris";
const text = (v) => String(v ?? "").trim();

/** Fuseau des heures saisies : celui du réglage, sinon celui par défaut. */
function zoneOf(ctx) {
  const tz = text(ctx.setting("timezone"));
  return isValidTimeZone(tz) ? tz : DEFAULT_ZONE;
}
const rowsOf = async (ctx) => (await ctx.api.store.list(COLLECTION, { limit: MAX_STREAMS })).filter((r) => r?.data && typeof r.data === "object");
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

export default {
  exports: {
    /** Les créneaux de la plage demandée, annulés compris (avec leur état : c'est au lecteur de décider). */
    async "planning.slot"(ctx, { limit, from, to } = {}) {
      const [lo, hi] = windowOf({ from, to });
      const timeZone = zoneOf(ctx), untitled = ctx.t("untitled");
      const items = (await rowsOf(ctx)).flatMap((r) => slotsOf(r.id, r.data, { from: lo, to: hi, timeZone, untitled }));
      items.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.id < b.id ? -1 : 1));
      return items.slice(0, Math.min(MAX_ITEMS, Math.max(1, Math.trunc(Number(limit)) || 50)));
    },
  },

  async adminPanel(ctx, { query } = {}) {
    const t = ctx.t, tz = zoneOf(ctx);
    const rows = await rowsOf(ctx);
    const form = (r) => {
      const d = r?.data ?? {};
      return {
        type: "adminForm", action: "save", title: r ? `${t("edit")} — ${d.title}` : t("add"), submitLabel: t("save"), cancelHref: r ? "?" : undefined,
        fields: [
          { name: "id", kind: "hidden", value: r?.id ?? "" },
          { name: "title", label: t("fTitle"), required: true, value: d.title ?? "" },
          { name: "startDate", label: t("fDate"), kind: "date", required: true, value: d.startDate ?? "" },
          { name: "startTime", label: t("fStartTime"), help: t("hStartTime"), value: d.startTime ?? "" },
          { name: "endTime", label: t("fEndTime"), help: t("hEndTime"), value: d.endTime ?? "" },
          { name: "games", label: t("fGames"), help: t("hGames"), value: (d.games ?? []).join(", ") },
          { name: "allDay", label: t("fAllDay"), help: t("hAllDay"), kind: "select", options: yesNo(ctx), value: d.allDay ? "yes" : "no" },
          { name: "repeat", label: t("fRepeat"), kind: "select", options: [{ value: "none", label: t("repeatNone") }, { value: "weekly", label: t("repeatWeekly") }], value: d.repeat === "weekly" ? "weekly" : "none" },
          { name: "repeatUntil", label: t("fRepeatUntil"), help: t("hRepeatUntil"), kind: "date", value: d.repeatUntil ?? "" },
          { name: "skip", label: t("fSkip"), help: t("hSkip"), value: (d.skip ?? []).join(", ") },
          { name: "cancelled", label: t("fCancelled"), help: t("hCancelled"), kind: "select", options: yesNo(ctx), value: d.cancelled ? "yes" : "no" },
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
    const repeat = (d) => (d.repeat === "weekly" ? (d.repeatUntil ? t("repeatWeeklyUntil", { date: d.repeatUntil }) : t("repeatWeekly")) : t("repeatNone"));
    const sorted = [...rows].sort((a, b) => String(a.data.startDate).localeCompare(String(b.data.startDate)) || String(a.data.startTime).localeCompare(String(b.data.startTime)));
    return [
      { type: "markdown", text: t("intro", { tz }) },
      { type: "heading", text: t("listTitle", { n: rows.length }) },
      sorted.length
        ? { type: "table", columns: [t("colWhen"), t("colTitle"), t("colGames"), t("colRepeat"), t("colState")], rows: sorted.map((r) => [when(r.data), r.data.title, (Array.isArray(r.data.games) ? r.data.games : []).join(", "), repeat(r.data), r.data.cancelled ? t("stateCancelled") : t("stateOk")]), rowIds: sorted.map((r) => r.id), rowActions: [{ label: t("actEdit"), href: "?edit={id}" }, { label: t("actDelete"), action: "remove", confirm: t("confirmDelete"), danger: true }] }
        : { type: "markdown", text: t("none") },
      form(null),
    ];
  },

  adminActions: {
    async save(ctx, v) {
      const t = ctx.t;
      const r = cleanStream(v);
      if (r.error) return { error: t(r.error) };
      if (v.id) {
        if (!(await ctx.api.store.get(v.id))) return { error: t("notFound") };
        await ctx.api.store.update(v.id, r.stream);
      } else {
        if ((await ctx.api.store.count(COLLECTION)) >= MAX_STREAMS) return { error: t("errMax", { n: MAX_STREAMS }) };
        await ctx.api.store.add(COLLECTION, r.stream);
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
