// Événements : les gabarits de départ (un choix en un clic, jamais obligatoire) et la palette des types.
// Ce sont des DONNÉES : le code ne connaît aucun nom de type. Tout se modifie ensuite (renommer, recolorer, supprimer, ajouter).
// Une couleur est soit un jeton du thème du site (elle suit le thème, clair et sombre), soit une teinte de la palette sobre.

/** Les couleurs possibles d'un type. `theme` : suit le thème du site ; sinon une teinte fixe (sert de pastille, jamais de couleur de texte). */
export const PALETTE = [
  { key: "accent", theme: "--v-accent" },
  { key: "accent2", theme: "--v-accent2" },
  { key: "success", theme: "--v-success" },
  { key: "warning", theme: "--v-warning" },
  { key: "danger", theme: "--v-danger" },
  { key: "slate", hex: "#64748b" },
  { key: "sky", hex: "#0284c7" },
  { key: "teal", hex: "#0d9488" },
  { key: "green", hex: "#16a34a" },
  { key: "amber", hex: "#d97706" },
  { key: "rose", hex: "#e11d48" },
  { key: "violet", hex: "#7c3aed" },
  { key: "stone", hex: "#78716c" },
];
export const COLOR_KEYS = PALETTE.map((c) => c.key);
export const DEFAULT_COLOR = "accent";

/** La valeur CSS d'une couleur de type (jamais le texte venu de la base : seulement une clé connue). */
export function colorCss(key) {
  const c = PALETTE.find((x) => x.key === key) ?? PALETTE[0];
  return c.theme ? `var(${c.theme}, var(--v-accent))` : c.hex;
}

/** Les gabarits. `types` : [{ names: { fr, en }, color, icon }]. L'identifiant (key) d'un type est tiré de son nom anglais à la création. */
export const STARTERS = {
  association: {
    types: [
      { names: { fr: "Événement", en: "Event" }, color: "accent", icon: "📅" },
      { names: { fr: "Atelier", en: "Workshop" }, color: "teal", icon: "🛠️" },
      { names: { fr: "Formation", en: "Training" }, color: "violet", icon: "🎓" },
      { names: { fr: "Masterclass", en: "Masterclass" }, color: "rose", icon: "⭐" },
      { names: { fr: "Rencontre", en: "Meetup" }, color: "amber", icon: "🤝" },
    ],
  },
  solo: {
    types: [
      { names: { fr: "Live spécial", en: "Special live" }, color: "rose", icon: "🔴" },
      { names: { fr: "Sortie", en: "Release" }, color: "accent", icon: "🚀" },
      { names: { fr: "Rencontre", en: "Meetup" }, color: "amber", icon: "🤝" },
    ],
  },
  empty: { types: [] },
};
export const STARTER_KEYS = Object.keys(STARTERS);
