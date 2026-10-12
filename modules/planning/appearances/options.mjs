// Planning : réglages d'apparence. Une seule source de vérité pour les valeurs par défaut ; les valeurs lues dans les réglages n'ont AUCUNE
// garantie de type (un booléen peut arriver en texte, un choix peut être inconnu) : tout est converti, borné, ramené à un défaut sûr.

/** Apparences proposées, dans l'ordre du choix. `original` = le rendu historique du module (liste simple), valeur par défaut. */
export const APPEARANCE_IDS = ["original", "classic", "alternating", "week", "timeline", "posters", "hero"];
export const DEFAULT_APPEARANCE = "original";

export const DEFAULTS = Object.freeze({
  appearance: DEFAULT_APPEARANCE,
  density: "comfortable",
  showCovers: true,
  showRelative: true,
  hourFormat: "24",
  weekStart: "1",
  showTimezone: false,
  dayStyle: "text",
  showEnd: false,
  showCancelled: false,
  // Options propres à une apparence
  classicHideEmpty: false,
  altFirstSide: "left",
  weekMode: "calendar",
  timelineEmpty: false,
  heroUpNext: 5,
});

const CHOICES = Object.freeze({
  density: ["comfortable", "compact"],
  hourFormat: ["24", "12"],
  weekStart: ["1", "0", "6"],
  dayStyle: ["text", "tile", "short"],
  altFirstSide: ["left", "right"],
  weekMode: ["calendar", "rolling"],
});

const bool = (v, def) => {
  if (v === true || v === "true" || v === 1 || v === "1" || v === "on") return true;
  if (v === false || v === "false" || v === 0 || v === "0" || v === "off") return false;
  return def;
};
const choice = (v, list, def) => (list.includes(String(v)) ? String(v) : def);
const int = (v, min, max, def) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) && String(v ?? "").trim() !== "" ? Math.min(max, Math.max(min, n)) : def; };

/** Identifiant d'apparence sûr : inconnu, vide ou absurde → `original` (le rendu d'avant). `inherit` n'est pas une apparence. */
export const resolveAppearanceId = (raw) => (APPEARANCE_IDS.includes(String(raw)) ? String(raw) : DEFAULT_APPEARANCE);

/**
 * Réglages normalisés. `read(clé)` lit un réglage brut (ctx.setting). `override` : apparence choisie pour UN morceau d'accueil
 * (« inherit » ou absente = celle du module).
 */
export function normalizeOptions(read, override) {
  const get = (k) => { try { return read(k); } catch { return undefined; } };
  const ov = override === undefined || override === null || override === "inherit" || override === "" ? null : String(override);
  return {
    appearance: resolveAppearanceId(ov ?? get("appearance")),
    density: choice(get("density"), CHOICES.density, DEFAULTS.density),
    covers: bool(get("showCovers"), DEFAULTS.showCovers),
    relative: bool(get("showRelative"), DEFAULTS.showRelative),
    h12: choice(get("hourFormat"), CHOICES.hourFormat, DEFAULTS.hourFormat) === "12",
    weekStart: Number(choice(get("weekStart"), CHOICES.weekStart, DEFAULTS.weekStart)),
    timezone: bool(get("showTimezone"), DEFAULTS.showTimezone),
    dayStyle: choice(get("dayStyle"), CHOICES.dayStyle, DEFAULTS.dayStyle),
    showEnd: bool(get("showEnd"), DEFAULTS.showEnd),
    cancelled: bool(get("showCancelled"), DEFAULTS.showCancelled),
    own: {
      classicHideEmpty: bool(get("classicHideEmpty"), DEFAULTS.classicHideEmpty),
      altFirstSide: choice(get("altFirstSide"), CHOICES.altFirstSide, DEFAULTS.altFirstSide),
      weekMode: choice(get("weekMode"), CHOICES.weekMode, DEFAULTS.weekMode),
      timelineEmpty: bool(get("timelineEmpty"), DEFAULTS.timelineEmpty),
      heroUpNext: int(get("heroUpNext"), 1, 12, DEFAULTS.heroUpNext),
    },
  };
}
