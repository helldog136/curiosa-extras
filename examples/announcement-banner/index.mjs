// Module d'exemple. Un module est un simple module ES : pas d'installation de
// dépendances, pas de build. Il exporte par défaut un objet qui déclare ce
// qu'il apporte au site (voir docs/MODULES.md).
//
// Un module tourne UNE FOIS PAR INSTANCE : `ctx.setting(...)` renvoie les
// réglages de l'instance courante, et `ctx.instance.key` l'identifie. Avec deux
// instances, le site affiche deux bannières, chacune avec ses textes.
//
// Dates (réglage `period`, facultatif, période ouverte permise) : la décision se prend À L'AFFICHAGE, à partir de l'heure courante dans le fuseau du site.
// Aucune tâche de fond, aucun minuteur : une annonce hors période n'est tout simplement pas rendue.
//
// Valeurs lues (celles que le cœur enregistre ; les trois premières existent depuis la 1.1.0 et gardent EXACTEMENT leur sens) :
//   "2026-12-01/2026-12-24"   une seule fois, du 1er au 24 décembre 2026
//   "12-01/12-24"             chaque année (peut enjamber le 31 décembre : "12-20/01-05")
//   "2026-12-01/"             à partir du 1er décembre 2026, sans fin   (cœur 0.6.4, `openEnded`)
//   "/2026-12-24"             jusqu'au 24 décembre 2026, sans début     (cœur 0.6.4, `openEnded`)

const ONCE = /^(\d{4})-(\d{2})-(\d{2})\/(\d{4})-(\d{2})-(\d{2})$/; // "2026-12-01/2026-12-24" : une seule fois
const YEARLY = /^(\d{2})-(\d{2})\/(\d{2})-(\d{2})$/; // "12-01/12-24" : chaque année (peut enjamber le 31 décembre)
const SINCE = /^(\d{4})-(\d{2})-(\d{2})\/$/; // "2026-12-01/" : à partir de ce jour, sans fin
const UNTIL = /^\/(\d{4})-(\d{2})-(\d{2})$/; // "/2026-12-24" : jusqu'à ce jour, sans début

const validZone = (tz) => {
  if (typeof tz !== "string" || !tz) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
};

/** Fuseau de la machine, « UTC » à défaut : le dernier repli du cœur quand le fuseau du site n'est pas réglé. */
function systemZone() {
  try { const tz = Intl.DateTimeFormat().resolvedOptions().timeZone; return validZone(tz) ? tz : "UTC"; } catch { return "UTC"; }
}

/**
 * Fuseau dans lequel « aujourd'hui » change : celui du site, `ctx.timezone` (cœur 0.6.4, toujours un nom valide). Repli, pour un contexte qui ne le donne pas
 * ou le donne inconnu (un test, un cœur plus ancien) : le fuseau de la machine, comme le cœur lui-même quand le fuseau du site n'est pas réglé.
 */
export function zoneOf(ctx) {
  return validZone(ctx?.timezone) ? ctx.timezone : systemZone();
}

/** Le jour (année, mois, jour) qu'il est à cet instant sur les horloges de ce fuseau. L'heure d'été n'y change rien : on compare des jours, pas des heures. */
export function wallDay(now, tz) {
  const o = {};
  for (const p of new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now)) if (p.type !== "literal") o[p.type] = Number(p.value);
  return { y: o.year, m: o.month, d: o.day };
}

/** Jour réel du calendrier ? Sans année (« chaque année »), le 29 février est permis. */
const realDay = (m, d, y) => m >= 1 && m <= 12 && d >= 1 && d <= (y === undefined && m === 2 ? 29 : new Date(Date.UTC(y ?? 2000, m, 0)).getUTCDate());

/**
 * L'annonce est-elle à montrer à cet instant ? `period` est la valeur du réglage : vide (jamais réglé) = toujours ; sinon le jour courant du site doit tomber
 * dans la période, début et fin INCLUS (la fin dure jusqu'à minuit). Un début seul ne limite pas la fin, une fin seule ne limite pas le début.
 * Une valeur illisible ne cache jamais l'annonce (comme avant que les dates existent).
 */
export function isActive(period, now = new Date(), tz = systemZone()) {
  const raw = String(period ?? "").trim();
  if (!raw) return true;
  const today = wallDay(now, tz);
  const k = today.y * 10000 + today.m * 100 + today.d;
  const once = ONCE.exec(raw);
  if (once) {
    const [fy, fm, fd, ty, tm, td] = once.slice(1).map(Number);
    const a = fy * 10000 + fm * 100 + fd, b = ty * 10000 + tm * 100 + td;
    if (!realDay(fm, fd, fy) || !realDay(tm, td, ty) || a > b) return true; // fin avant début : le cœur le refuse à l'enregistrement ; si cela arrive quand même, on ne cache rien
    return k >= a && k <= b;
  }
  const open = SINCE.exec(raw) ?? UNTIL.exec(raw);
  if (open) {
    const [y, m, d] = open.slice(1).map(Number);
    if (!realDay(m, d, y)) return true;
    const day = y * 10000 + m * 100 + d;
    return raw.endsWith("/") ? k >= day : k <= day; // « à partir du » : le jour même compte ; « jusqu'au » : jusqu'à minuit
  }
  const yearly = YEARLY.exec(raw);
  if (yearly) {
    const [fm, fd, tm, td] = yearly.slice(1).map(Number);
    if (!realDay(fm, fd) || !realDay(tm, td)) return true;
    const a = fm * 100 + fd, b = tm * 100 + td, md = today.m * 100 + today.d;
    return a <= b ? md >= a && md <= b : md >= a || md <= b; // début après fin : la période enjambe le 31 décembre
  }
  return true;
}

const active = (ctx) => isActive(ctx.setting("period"), new Date(), zoneOf(ctx));

export default {
  slots: {
    // Bannière tout en haut de chaque page.
    "layout.banner": (ctx) => {
      if (!ctx.setting("enabled")) return null;
      const text = ctx.setting("text"); // déjà résolu pour la langue du visiteur
      if (!text) return null;
      if (!active(ctx)) return null; // hors période (pas encore commencée, ou terminée)
      return [{ type: "banner", text, href: /^(https?:\/\/|mailto:|\/(?!\/))/i.test(String(ctx.setting("link") ?? "").trim()) ? String(ctx.setting("link")).trim() : undefined, tone: ctx.setting("tone") }];
    },
  },

  // Morceaux que l'admin peut placer sur la page d'accueil (déclarés dans module.json).
  sections: {
    note: (ctx) => {
      const note = ctx.setting("homeText");
      return note && active(ctx) ? [{ type: "markdown", text: note }] : null;
    },
  },

  // Information exposée aux modules consommateurs (ex. un overlay OBS). Le module ne sait pas
  // qui la lit : il publie des éléments au format du sujet « overlay.item » (déclaré dans
  // module.json → provides) ; l'admin décide quelles instances d'overlay s'y abonnent.
  exports: {
    "overlay.item": (ctx) => {
      if (!ctx.setting("enabled") || !ctx.setting("text") || !active(ctx)) return [];
      return [{ title: ctx.setting("text"), url: ctx.setting("link") || undefined }];
    },
  },
};
