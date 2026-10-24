// Mascotte — les phrases de DÉPART et les gabarits. Neutres (aucun nom de site, aucune région, aucun sujet précis) et modifiables à volonté.
// Un gabarit est un choix en un clic ; aucun n'est obligatoire. Les phrases qui emploient une variable ({prochain_evenement}…) ne sont dites que si l'information existe.

/** Les gabarits proposés (« empty » = aucune phrase). */
export const TEMPLATES = ["welcome", "empty"];

const SETS = {
  fr: [
    { kind: "hello", text: "Bienvenue ! Je suis {nom}, je me promène par ici." },
    { kind: "hello", text: "Coucou ! Content de vous voir sur {nom_du_site}." },
    { kind: "hello", text: "Bonjour, prenez votre temps et regardez autour de vous." },
    { kind: "tip", text: "Astuce : le menu en haut de la page vous mène partout sur le site." },
    { kind: "tip", text: "Astuce : vous pouvez me renvoyer d'un clic, je ne serai pas vexé." },
    // Brouillon : il n'est dit que si cette page existe vraiment sur le site.
    { kind: "tip", text: "Une question ? La page Questions fréquentes est à deux pas.", state: "draft" },
    { kind: "news", text: "Prochain rendez-vous : {prochain_evenement}, {date_evenement}." },
    { kind: "news", text: "{en_direct} est en direct en ce moment, venez voir !" },
    { kind: "news", text: "Nouveau sur le site : {derniere_nouveaute}" },
  ],
  en: [
    { kind: "hello", text: "Welcome! I'm {name}, I like to wander around here." },
    { kind: "hello", text: "Hi there! Nice to see you on {site_name}." },
    { kind: "hello", text: "Hello, take your time and have a look around." },
    { kind: "tip", text: "Tip: the menu at the top of the page takes you anywhere on the site." },
    { kind: "tip", text: "Tip: you can send me away with one click, I won't mind." },
    // Draft: only said once you have checked that this page really exists on the site.
    { kind: "tip", text: "A question? The Frequently asked questions page is just around the corner.", state: "draft" },
    { kind: "news", text: "Next up: {next_event}, {event_date}." },
    { kind: "news", text: "{live_now} is live right now, come and see!" },
    { kind: "news", text: "New on the site: {latest_news}" },
  ],
};

/**
 * Les phrases d'un gabarit pour un site : une série par langue du site que nous savons écrire (français, anglais) ; si le site n'a aucune de ces deux langues,
 * la série anglaise est posée sur sa langue par défaut (à réécrire). `welcome` seulement ; `empty` ne donne rien.
 */
export function templatePhrases(id, locales = [], defaultLocale = "en") {
  if (id !== "welcome") return [];
  const known = locales.filter((l) => SETS[l]);
  const plan = known.length ? known.map((l) => [l, SETS[l]]) : [[locales.includes(defaultLocale) ? defaultLocale : (locales[0] ?? "en"), SETS.en]];
  return plan.flatMap(([lang, list]) => list.map((p) => ({ kind: p.kind, lang, text: p.text, pages: [], link: "", state: p.state ?? "published" })));
}
