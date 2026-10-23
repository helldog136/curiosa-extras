// Les réglages, lus avec prudence : la valeur d'un réglage n'est pas garantie (un nombre peut arriver en texte). Chacun est converti, borné, et retombe sur son défaut.
const int = (v, min, max, def) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) && n >= min && n <= max ? n : def; };

/** Les bornes et défauts (dans un objet : la page et les tests les relisent). */
export const BOUNDS = {
  intervalSec: { min: 5, max: 60, def: 15 },       // au plus une lecture du chat toutes les N secondes (YouTube peut demander plus lent : on obéit)
  budgetPercent: { min: 5, max: 90, def: 50 },     // part de la limite du jour de YouTube que ce module peut utiliser
  maxAgeSec: { min: 30, max: 600, def: 120 },      // un don plus ancien que cela (page ouverte en cours de direct) n'est pas rejoué
};
export const DEFAULT_THANKS = "Merci pour votre soutien !";
/** La limite du jour accordée par YouTube à une clé gratuite (unités). */
export const DAILY_UNITS = 10_000;

export function settingsOf(ctx) {
  const thanks = String(ctx.setting("thanks") ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return {
    readChat: ctx.setting("readChat") !== false,
    modsStop: ctx.setting("modsStop") !== false,
    ifRefused: ctx.setting("ifRefused") === "thanks" ? "thanks" : "silent",
    thanks: thanks || DEFAULT_THANKS,
    extraCurrencies: String(ctx.setting("extraCurrencies") ?? "").slice(0, 200),
    channel: String(ctx.setting("channel") ?? "").trim().slice(0, 200),
    intervalMs: int(ctx.setting("intervalSec"), BOUNDS.intervalSec.min, BOUNDS.intervalSec.max, BOUNDS.intervalSec.def) * 1000,
    budgetPercent: int(ctx.setting("budgetPercent"), BOUNDS.budgetPercent.min, BOUNDS.budgetPercent.max, BOUNDS.budgetPercent.def),
    maxAgeMs: int(ctx.setting("maxAgeSec"), BOUNDS.maxAgeSec.min, BOUNDS.maxAgeSec.max, BOUNDS.maxAgeSec.def) * 1000,
  };
}
/** Unités de limite que le module peut dépenser aujourd'hui. */
export const budgetUnits = (s) => Math.round((DAILY_UNITS * s.budgetPercent) / 100);
