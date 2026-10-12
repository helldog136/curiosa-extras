// Planning : indications relatives (« En cours », « Dans 40 min », « Dans 3 h », « Demain »…). Fonction PURE : `t` traduit, `now` est donné.
const { wallDateNow } = await import(`./dates.mjs${new URL(import.meta.url).search}`);

const wallDay = (w) => Date.UTC(w.y, w.m - 1, w.d);

/** « En cours » · « Dans 40 min » · « Dans 3 h » · « Aujourd'hui » · « Demain » · « Dans 4 jours » ; rien au-delà d'une semaine. */
export function relativeLabel(slot, now, tz, t) {
  if (!slot.allDay && slot.start.getTime() <= now.getTime() && slot.end.getTime() >= now.getTime()) return t("relLive");
  if (slot.allDay && slot.start.getTime() <= now.getTime() && slot.end.getTime() > now.getTime()) return t("relToday");
  const diff = Math.round((wallDay(wallDateNow(tz, slot.start)) - wallDay(wallDateNow(tz, now))) / 86_400_000);
  if (diff < 0) return null;
  if (diff === 0) {
    if (slot.allDay) return t("relToday");
    const mins = Math.max(1, Math.ceil((slot.start.getTime() - now.getTime()) / 60_000));
    if (mins < 60) return t("relMinutes", { n: mins });
    const hours = Math.floor(mins / 60);
    return hours < 6 ? t("relHours", { n: hours }) : t("relToday");
  }
  if (diff === 1) return t("relTomorrow");
  return diff <= 6 ? t("relDays", { n: diff }) : null;
}
