// La liste de mots refusés fournie avec le module (français et anglais). Elle sert de point de départ : la propriétaire peut la désactiver, l'enrichir
// (« mots à refuser en plus ») et la corriger (« mots à toujours accepter »). Un mot seul est comparé mot entier ; « mot* » = commence par, « *mot » = finit par,
// « *mot* » = contient. La comparaison ignore les majuscules, les accents, les chiffres glissés dans les mots (« m3rde ») et les lettres répétées (« merrrde »).
//
// Choix de prudence : on évite les mots qui sont aussi des mots courants dans l'une des deux langues (« retard » en français, « bite » en anglais) ; ils se
// rajoutent dans « mots à refuser en plus » si la propriétaire les veut.

export const DEFAULT_WORDS_FR = [
  // grossièretés
  "merd*", "putain*", "pute", "putes", "salope*", "salopard*", "connard*", "connasse*", "con", "conne", "cons", "connes",
  "encul*", "nique", "niquer", "niques", "niquez", "ntm", "fdp", "pd", "pede", "pedes", "tapette*", "tarlouze*",
  "couille", "couilles", "couillon*", "branleur*", "branleuse*", "branlette*", "bordel de merde", "foutre", "batard*", "salaud*", "ordure", "enfoire*",
  "ferme ta gueule", "ta gueule", "va te faire foutre", "vtff", "va te faire enculer", "suce moi", "sucer", "chienne",
  // haine
  "negro", "negre", "negresse", "bougnoule*", "youpin*", "bicot*", "raton*", "chinetoque*", "sale arabe", "sale noir", "sale juif", "sale blanc",
  "gouine*", "pedale*", "tarlouse*", "mongol", "mongolien*", "trisomique*", "autiste de merde", "nazi*", "hitler*", "heil",
  // violence et sexe
  "viol", "viols", "violer", "violeur*", "violee", "pedophile*", "pedo", "pedos", "pedocriminel*", "inceste*", "zoophile*", "porno*",
  "sperme", "bander", "baiser ta mere", "nique ta mere", "tue toi", "suicide toi", "suicidez vous",
];

export const DEFAULT_WORDS_EN = [
  // profanity
  "fuck*", "fvck*", "shit*", "bullshit", "bitch*", "asshole*", "ass hole", "bastard*", "cunt*", "dick", "dicks", "dickhead*", "pussy", "pussies",
  "cock", "cocks", "cocksucker*", "whore*", "slut*", "motherfucker*", "wank*", "twat*", "jizz", "cum", "cumshot*", "blowjob*", "handjob*",
  "tits", "titties", "dildo*", "orgasm*", "porn*", "hentai", "milf",
  // hate
  "nigger*", "nigga*", "niggas", "faggot*", "fag", "fags", "dyke", "tranny", "trannies", "retarded", "spastic", "chink*", "gook*", "kike*", "spic", "spics",
  "wetback*", "coon", "paki", "nazi*", "hitler*", "heil", "white power", "kkk", "isis",
  // violence
  "rape", "raped", "rapes", "raping", "rapist*", "pedophile*", "paedophile*", "pedo", "pedos", "molest*", "kys", "kill yourself", "kill your self", "go die", "hang yourself",
  "i will kill you", "i ll kill you", "bomb threat", "school shooting", "suicide",
];

/** Toute la liste fournie, une entrée par ligne (sans doublon). */
export const DEFAULT_WORDS = [...new Set([...DEFAULT_WORDS_FR, ...DEFAULT_WORDS_EN])];
