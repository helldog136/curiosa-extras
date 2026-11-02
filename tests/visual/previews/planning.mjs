// Planning : la page publique de la semaine (grille), l'apparence « affiches » et celle « chronologie ». Streams et jeux inventés, jaquettes dessinées.
export default async function scenes({ siteFrame, messages, art, NOW }) {
  const { buildModel } = await import("../../../modules/planning/appearances/model.mjs");
  const { renderAppearance } = await import("../../../modules/planning/appearances/registry.mjs");
  const { normalizeOptions } = await import("../../../modules/planning/appearances/options.mjs");
  const mk = (lang) => { const m = messages("planning", lang); return (k, v) => { let s = m[k] ?? k; for (const [n, x] of Object.entries(v ?? {})) s = s.replaceAll(`{${n}}`, String(x)); return s; }; };
  const GAMES = { fr: ["Les Îles de Brume", "Chasseurs d'étoiles", "Le Jardin d'Hélène", "Course de nuit"], en: ["Mist Isles", "Star Hunters", "Helen's Garden", "Night Race"] };
  const hue = [[210, 270], [330, 20], [120, 180], [30, 350]];
  const make = (lang) => {
    const g = GAMES[lang];
    const at = (day, hour, min = 0) => new Date(Date.UTC(2026, 9, 12 + day, hour - 2, min));   // heure de Paris (UTC+2 en octobre)
    const T = lang === "fr"
      ? ["Exploration et détente", "Soirée spéciale abonnés", "On termine l'histoire", "Course entre amis", "Découverte du nouveau jeu", "Dimanche tranquille", "Atelier créatif", "Revanche de la course"]
      : ["Exploring and relaxing", "Subscribers' special night", "Finishing the story", "Racing with friends", "Trying the new game", "Quiet Sunday", "Creative workshop", "Rematch race"];
    const slots = [
      { uid: "a", title: T[0], games: [g[0]], start: at(0, 20, 30), end: at(0, 23) },
      { uid: "b", title: T[6], games: [g[2]], start: at(1, 21), end: at(1, 23) },
      { uid: "c", title: T[1], games: [g[1]], start: at(2, 20, 30), end: at(2, 23, 30) },
      { uid: "d", title: T[2], games: [g[0]], start: at(3, 21), end: at(3, 23, 30) },
      { uid: "e", title: T[3], games: [g[3]], start: at(4, 20, 30), end: at(4, 22, 30) },
      { uid: "f", title: T[4], games: [g[2]], start: at(5, 15), end: at(5, 18) },
      { uid: "g", title: T[7], games: [g[3]], start: at(5, 21), end: at(5, 23, 30) },
      { uid: "h", title: T[5], games: [g[1], g[2]], start: at(6, 17), end: at(6, 19, 30) },
    ];
    const covers = new Map(g.map((n, i) => [n, art(hue[i][0], hue[i][1], { w: 300, hgt: 400, shape: ["circles", "blocks", "waves", "circles"][i] })]));
    return { slots, covers };
  };
  const vis = (lang) => ({ src: null, light: false, initial: "A" });
  const html = (lang, id, extra = {}) => {
    const { slots, covers } = make(lang);
    const opts = { ...normalizeOptions(() => undefined), appearance: id, ...extra };
    const model = buildModel({ slots, covers, now: NOW, tz: "Europe/Paris", locale: lang, t: mk(lang), opts, mode: "days", days: 7, vis: vis(lang), planningHref: "/planning", allowData: true });
    return renderAppearance(id, model, {});
  };
  const page = (id, h, extra) => ({ html: siteFrame({ title: "Planning", lead: "Les prochains directs de la semaine.", nav: ["Accueil", "Planning", "Vidéos", "Contact"], current: "Planning", body: html("fr", id, extra) }), h });
  return {
    "semaine.webp": page("week", 900),
    "affiches.webp": page("posters", 900),
    "chronologie.webp": page("timeline", 900),
  };
}
