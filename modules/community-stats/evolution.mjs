// Statistiques de la communauté — évolution d'un chiffre (7 et 30 jours) et phrase lisible.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins
const { DAY, METRICS, platformName } = await import(`./model.mjs${v}`);
const { readPoints } = await import(`./stats.mjs${v}`);

const TOLERANCE_SEC = 12 * 3600; // un relevé « d'il y a 7 jours » peut dater de 6 jours et demi
const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Évolution sur `days` jours, mesurée à partir du DERNIER chiffre connu : le dernier point comparé au point le plus proche d'il y a `days` jours
 * (au plus 12 h après, au plus 2 × `days` jours avant ; au-delà, on ne sait pas : null). `percent` vaut null si le chiffre de départ était 0 (pas de division par zéro).
 * `points` : [[secondes, valeur], …] du plus ancien au plus récent.
 */
export function changeOf(points, days) {
  const last = points.at(-1);
  if (!last) return null;
  const anchor = last[0] - days * 86400;
  let ref = null;
  for (const p of points) if (p !== last && p[0] <= anchor + TOLERANCE_SEC) ref = p;
  if (!ref || ref[0] < last[0] - 2 * days * 86400) return null;
  const delta = last[1] - ref[1];
  return { days, from: ref[1], to: last[1], delta, percent: ref[1] > 0 ? round1((delta / ref[1]) * 100) : null, sinceAt: ref[0] * 1000 };
}

const num = (ctx, n) => new Intl.NumberFormat(ctx.locale || "en").format(n);
export const unitOf = (ctx, metric, n) => ctx.t(`unit_${METRICS.includes(metric) ? metric : "followers"}_${Math.abs(n) === 1 ? "one" : "other"}`);
export const formatValue = (ctx, n) => num(ctx, n);

/** « +120 abonnés cette semaine (+4,2 %) », « −3 publications ce mois-ci », « Pas de changement cette semaine » ; sans recul suffisant : une phrase qui le dit. */
export function evolutionPhrase(ctx, change, metric) {
  if (!change) return ctx.t("evoNone");
  const when = change.days === 7 ? "7" : "30";
  if (change.delta === 0) return ctx.t(`evoFlat${when}`);
  const up = change.delta > 0;
  const base = ctx.t(`evo${up ? "Up" : "Down"}${when}`, { n: num(ctx, Math.abs(change.delta)), unit: unitOf(ctx, metric, change.delta) });
  if (change.percent === null) return base;
  const pct = `${change.percent > 0 ? "+" : change.percent < 0 ? "−" : ""}${new Intl.NumberFormat(ctx.locale || "en", { maximumFractionDigits: 1 }).format(Math.abs(change.percent))}${ctx.t("percentSuffix")}`;
  return `${base} (${pct})`;
}

/** Les deux évolutions d'une statistique (lit au plus deux mois d'historique). */
export async function changesOf(ctx, stat) {
  if (stat.lastAt == null) return { week: null, month: null };
  const points = await readPoints(ctx, stat, Math.floor(stat.lastAt / 1000) - 60 * 86400);
  return { week: changeOf(points, 7), month: changeOf(points, 30) };
}

/** « il y a 3 heures » / « 3 hours ago », dans la langue du site. */
export function ago(ctx, atMs, now) {
  const rtf = new Intl.RelativeTimeFormat(ctx.locale || "en", { numeric: "auto" });
  const s = Math.max(0, Math.round((now - atMs) / 1000));
  if (s < 90) return rtf.format(0, "second");
  if (s < 5400) return rtf.format(-Math.round(s / 60), "minute");
  if (s < 36 * 3600) return rtf.format(-Math.round(s / 3600), "hour");
  return rtf.format(-Math.round(s / (DAY / 1000)), "day");
}
export const dateText = (ctx, atMs) => new Intl.DateTimeFormat(ctx.locale || "en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(atMs));

/** L'explication humaine (et l'action à faire) quand le chiffre manque. Un texte propre à la plateforme (reason_<cause>_<plateforme>) passe avant le texte général. */
export function reasonText(ctx, stat) {
  const cause = stat.state === "missing" ? "missing" : stat.error;
  const name = platformName(stat);
  const specific = ctx.t(`reason_${cause}_${stat.platform}`, { platform: name });
  return specific !== `reason_${cause}_${stat.platform}` ? specific : ctx.t(`reason_${cause}`, { platform: name });
}
