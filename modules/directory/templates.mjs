// Annuaire — les gabarits de départ : un choix en un clic qui préremplit les mots, l'équipe (à remplir) et des catégories (à relier ou à créer dans Contacts). Aucun n'est obligatoire,
// tout reste modifiable ensuite. Les mots sont donnés pour le français et l'anglais ; une autre langue du site retombe sur la langue par défaut puis sur les mots neutres du module.
// Un gabarit ne contient ni nom de personne, ni couleur, ni région : seulement des mots courants.
export const TEMPLATES = {
  association: {
    vocab: { fr: { title: "Annuaire", noun: "membre", nouns: "membres", team: "Équipe" }, en: { title: "Directory", noun: "member", nouns: "members", team: "Team" } },
    cats: [{ fr: "Membres", en: "Members" }, { fr: "Bénévoles", en: "Volunteers" }, { fr: "Anciens membres", en: "Former members" }],
  },
  collective: {
    vocab: { fr: { title: "Artistes", noun: "artiste", nouns: "artistes", team: "Équipe" }, en: { title: "Creators", noun: "creator", nouns: "creators", team: "Team" } },
    cats: [{ fr: "Artistes", en: "Creators" }, { fr: "Personnes invitées", en: "Guests" }],
  },
  empty: { vocab: {}, cats: [] },
};
export const TEMPLATE_IDS = Object.keys(TEMPLATES);
