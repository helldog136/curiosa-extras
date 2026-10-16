// Fuseaux horaires et dates de calendrier (« heure murale »). Fonctions PURES, sans dépendance.
// Copie volontaire de celles du Planning : un module est autonome et ne lit jamais le code d'un autre.

function tzOffsetMillis(utcMillis, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(utcMillis))
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return asUtc - utcMillis;
}

/** Heure murale dans un fuseau -> instant UTC (deux passes : correct autour d'un changement d'heure). */
export function zonedTimeToUtc(year, month, day, hour, minute, second, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const pass1 = guess - tzOffsetMillis(guess, timeZone);
  const pass2 = guess - tzOffsetMillis(pass1, timeZone);
  return new Date(pass2);
}

/** Date de calendrier « aujourd'hui » dans un fuseau. */
export function wallDateNow(timeZone, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).map((p) => [p.type, p.value]));
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day) };
}

/** 0 = dimanche … 6 = samedi. */
export const weekdayOf = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();

export function addDaysToWall(y, m, d, days) {
  const next = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  return { y: next.getUTCFullYear(), m: next.getUTCMonth() + 1, d: next.getUTCDate() };
}
