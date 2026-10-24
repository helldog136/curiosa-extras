// Carte : les jeux de départ (« gabarits »). Un choix en un clic range les types de lieux ; tout reste modifiable, rien n'est obligatoire.
// Ce sont des exemples neutres : aucun nom de lieu, de région ni d'association. Les mots sont ceux du site, modifiables dans l'administration.

export const DEFAULT_TEMPLATE = "basic";

/** id → { types: [{ id, fr, en, sym }] } ; l'ordre est celui d'affichage. `sym` : un emoji (ou 1 à 2 lettres) posé sur le marqueur. */
export const TEMPLATES = {
  basic: {
    types: [
      { id: "place", fr: "Lieu", en: "Place", sym: "📍" },
      { id: "event", fr: "Événement", en: "Event", sym: "📅" },
    ],
  },
  community: {
    types: [
      { id: "studio", fr: "Studio", en: "Studio", sym: "🎙️" },
      { id: "address", fr: "Bonne adresse", en: "Good address", sym: "⭐" },
      { id: "event", fr: "Événement", en: "Event", sym: "📅" },
    ],
  },
  solo: {
    types: [
      { id: "studio", fr: "Studio", en: "Studio", sym: "🎬" },
      { id: "address", fr: "Bonne adresse", en: "Good address", sym: "⭐" },
      { id: "meetup", fr: "Rencontre", en: "Meet-up", sym: "👋" },
    ],
  },
  shop: {
    types: [
      { id: "shop", fr: "Boutique", en: "Shop", sym: "🛍️" },
      { id: "pickup", fr: "Point de retrait", en: "Pick-up point", sym: "📦" },
      { id: "fair", fr: "Salon", en: "Fair", sym: "🎪" },
    ],
  },
};

export const TEMPLATE_IDS = Object.keys(TEMPLATES);
