// Planning : le MODÈLE que reçoivent les apparences. Regroupe les créneaux (par jour, par semaine), repère « aujourd'hui », « en cours »,
// « annulé », met en forme heures et dates dans le fuseau, ajoute les indications relatives. Fonction PURE : ni réseau, ni stockage, ni horloge
// cachée (`now` est donné), aucune exception sur des données absurdes.
const V = new URL(import.meta.url).search;
const { zonedTimeToUtc, wallDateNow, weekdayOf, addDaysToWall } = await import(`../dates.mjs${V}`);
const { relativeLabel } = await import(`../relative.mjs${V}`);
const { gamesOf } = await import(`../slots.mjs${V}`);

const pad = (n) => String(n).padStart(2, "0");
export const wallKey = (w) => `${w.y}-${pad(w.m)}-${pad(w.d)}`;
const validLocale = (l) => { try { return Intl.DateTimeFormat.supportedLocalesOf([String(l)]).length ? String(l) : "en"; } catch { return "en"; } };

/** Formateurs d'un fuseau et d'une langue (construits une fois par modèle). */
function formatters(locale, tz, h12) {
  const f = (o) => new Intl.DateTimeFormat(locale, { timeZone: tz, ...o });
  const time = f(h12 ? { hour: "numeric", minute: "2-digit", hour12: true } : { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return {
    time: (d) => time.format(d),
    weekdayLong: f({ weekday: "long" }), weekdayShort: f({ weekday: "short" }), monthLong: f({ month: "long" }), monthShort: f({ month: "short" }),
    dayNum: f({ day: "numeric" }), monthYear: f({ month: "long", year: "numeric" }), tzShort: f({ timeZoneName: "short" }),
  };
}

function dayLabel(fm, wall, tz) {
  const noon = zonedTimeToUtc(wall.y, wall.m, wall.d, 12, 0, 0, tz);
  const weekdayLong = fm.weekdayLong.format(noon), weekdayShort = fm.weekdayShort.format(noon).replace(/\.$/, "");
  const monthLong = fm.monthLong.format(noon), monthShort = fm.monthShort.format(noon).replace(/\.$/, ""), dayNum = fm.dayNum.format(noon);
  return { weekdayLong, weekdayShort, monthLong, monthShort, dayNum, full: `${weekdayLong} ${dayNum} ${monthLong}`, monthYear: fm.monthYear.format(noon) };
}

const dayBounds = (w, tz) => [zonedTimeToUtc(w.y, w.m, w.d, 0, 0, 0, tz).getTime(), zonedTimeToUtc(w.y, w.m, w.d, 23, 59, 59, tz).getTime()];

/**
 * @param input.slots      créneaux triés { uid, title, games, start, end, allDay, cancelled? } (Dates)
 * @param input.covers     Map(nom du jeu → adresse https de la jaquette)
 * @param input.mode       "days" : `days` jours à partir d'aujourd'hui, jours vides compris · "list" : les `count` prochains créneaux, jours vides omis
 */
export function buildModel(input) {
  const { slots: rawSlots = [], covers = new Map(), now = new Date(), tz = "UTC", t = (k) => k, opts, mode = "days", days: dayCount = 7, count = 5, surface = "page", allowData = false, vis = null, planningHref = null, channelUrl = null } = input;
  const locale = validLocale(input.locale);
  const fm = formatters(locale, tz, !!opts.h12);
  const nowMs = now.getTime();
  const slots = (Array.isArray(rawSlots) ? rawSlots : []).filter((s) => s && s.start instanceof Date && !Number.isNaN(s.start.getTime())).map((s) => {
    const end = s.end instanceof Date && !Number.isNaN(s.end.getTime()) ? s.end : new Date(s.start.getTime() + 3_600_000);
    const w = wallDateNow(tz, s.start);
    const games = s.allDay ? [] : gamesOf(s);
    const cancelled = !!s.cancelled;
    const live = !cancelled && !s.allDay && s.start.getTime() <= nowMs && end.getTime() >= nowMs;
    const rel = cancelled || !opts.relative ? null : (() => { const r = relativeLabel({ ...s, end }, now, tz, t); return live ? null : r; })();
    return {
      key: `${s.uid ?? ""}|${s.start.toISOString()}`, title: String(s.title ?? ""), allDay: !!s.allDay, live, cancelled, rel,
      iso: s.allDay ? wallKey(w) : s.start.toISOString(), isoEnd: s.allDay ? wallKey(wallDateNow(tz, new Date(end.getTime() - 1))) : end.toISOString(),
      timeText: s.allDay ? t("allDay") : fm.time(s.start), endText: s.allDay ? "" : fm.time(end),
      startMs: s.start.getTime(), endMs: end.getTime(), dayKey: wallKey(w),
      games, covers: games.map((name) => ({ name, url: covers.get(name) })).filter((c) => typeof c.url === "string" && (/^https:\/\//.test(c.url) || (allowData && /^data:image\/svg\+xml/.test(c.url)))),
    };
  }).sort((a, b) => a.startMs - b.startMs);

  const todayWall = wallDateNow(tz, now);
  const todayKey = wallKey(todayWall);
  const mkDay = (wall, extra = {}) => {
    const key = wallKey(wall), [from, to] = dayBounds(wall, tz);
    return { key, wall, weekday: weekdayOf(wall.y, wall.m, wall.d), isToday: key === todayKey, isPast: key < todayKey, outside: false, label: dayLabel(fm, wall, tz), slots: slots.filter((s) => s.startMs >= from && s.startMs <= to), ...extra };
  };

  let list;
  if (mode === "list") {
    const shown = slots.filter((s) => !s.cancelled || opts.cancelled).slice(0, Math.max(1, count));
    const keys = [...new Set(shown.map((s) => s.dayKey))];
    list = keys.map((k) => { const [y, m, d] = k.split("-").map(Number); const day = mkDay({ y, m, d }); day.slots = shown.filter((s) => s.dayKey === k); return day; });
  } else {
    const n = Math.min(60, Math.max(1, Math.trunc(Number(dayCount)) || 7));
    list = Array.from({ length: n }, (_, i) => mkDay(addDaysToWall(todayWall.y, todayWall.m, todayWall.d, i)));
    // Un stream commencé la veille et encore en cours (nuit blanche) reste visible : il rejoint « aujourd'hui ».
    const [firstFrom] = dayBounds(todayWall, tz);
    const carried = slots.filter((s) => s.startMs < firstFrom && s.endMs >= nowMs);
    if (carried.length) { list[0].slots = [...carried, ...list[0].slots]; }
  }
  if (!opts.cancelled) for (const d of list) d.slots = d.slots.filter((s) => !s.cancelled);

  // Semaines complètes (7 jours alignés sur le premier jour de la semaine choisi, ou 7 jours glissants) : grille et mois.
  const weeks = [];
  if (mode !== "list" && list.length) {
    const rolling = opts.own?.weekMode === "rolling";
    const first = list[0].wall;
    const lead = rolling ? 0 : (weekdayOf(first.y, first.m, first.d) - opts.weekStart + 7) % 7;
    const start = addDaysToWall(first.y, first.m, first.d, -lead);
    const total = Math.ceil((lead + list.length) / 7) * 7;
    const byKey = new Map(list.map((d) => [d.key, d]));
    for (let i = 0; i < total; i += 7) {
      const wk = [];
      for (let j = 0; j < 7; j++) {
        const w = addDaysToWall(start.y, start.m, start.d, i + j), k = wallKey(w);
        wk.push(byKey.get(k) ?? { ...mkDay(w), slots: [], outside: true });
      }
      weeks.push({ days: wk, startKey: wk[0].key, endKey: wk[6].key, label: { from: wk[0].label, to: wk[6].label } });
    }
  }

  const all = list.flatMap((d) => d.slots);
  const upcoming = all.filter((s) => !s.cancelled && s.endMs >= nowMs);
  const offset = (() => { try { return fm.tzShort.formatToParts(now).find((p) => p.type === "timeZoneName")?.value ?? ""; } catch { return ""; } })();
  return {
    surface, headingLevel: surface === "page" ? 2 : surface === "preview" ? 4 : 3, t, locale, tz, tzName: offset ? `${tz} (${offset})` : tz, now, opts, vis, planningHref, channelUrl,
    days: list, weeks, slots: all, upcoming, next: upcoming[0] ?? null,
    empty: all.length === 0, quiet: upcoming.length === 0,
  };
}
