// Ce que le site sait des extensions installées, SANS que le cœur ait à nous le dire.
//
// Le cœur donne la liste des extensions actives (`ctx.api.instances.list()` : identifiant du module + nom de l'instance), mais pas ce que chacune
// recueille chez les visiteurs. Cette table sert UNIQUEMENT à PRÉREMPLIR les réponses de l'assistant ; la personne les relit et peut tout changer :
//   - « collectors » : les extensions du catalogue dont le manifeste déclare `privacy` (vérifié par un test du dépôt) ;
//   - « quiet »      : les extensions du catalogue qui ne recueillent rien chez les visiteurs (aucune déclaration `privacy`, vérifié aussi) ;
//   - toute autre extension (nouvelle, ou d'un tiers) est INCONNUE : l'assistant le demande à la personne au lieu de deviner.
// Quand le cœur exposera ce que chaque extension déclare, cette table disparaîtra.

/** Types d'informations qu'un site peut recueillir (les cases de l'étape « Ce que vous recueillez »). */
export const KINDS = ["messages", "publicPosts", "memory", "chat", "list", "thirdParty"];

export const COLLECTORS = {
  "contact-form": { messages: true },
  guestbook: { publicPosts: true },
  "game-suggestions": { publicPosts: true, memory: true },
  "twitch-bot": { chat: true },
  "live-status": { thirdParty: ["Twitch"] },
};

export const QUIET = [
  "alerts-overlay", "announcement-banner", "bandcamp", "blog", "bluesky", "calendar-ical", "calendar-manual", "codes", "collection", "community-stats",
  "contacts", "discord", "discord-announcer", "facebook", "github", "hero", "instagram", "kick", "kofi", "legal-pages", "links", "mastodon", "maze-overlay",
  "pages", "partnerships", "patreon", "pinterest", "planning", "press-kit", "reddit", "snapchat", "soundcloud", "sponsor-ticker", "sponsors", "spotify",
  "steam", "stream-story", "telegram", "threads", "ticker-overlay", "tiktok", "twitch-channel", "twitch-raid", "x-twitter", "youtube-channel",
];

/**
 * Lit la liste des extensions actives et la range : ce qui est reconnu (et ce que ça recueille), ce qui est inconnu.
 * `instances` : le résultat de `ctx.api.instances.list()` ; ne lève jamais.
 */
export function classify(instances) {
  const list = Array.isArray(instances) ? instances : [];
  const detected = { messages: false, publicPosts: false, memory: false, chat: false, list: false, thirdParty: false };
  const thirdPartyNames = [];
  const collectors = [], unknown = [], moduleIds = [];
  for (const i of list) {
    const id = String(i?.module ?? "");
    if (!id || id === "legal-pages" || moduleIds.includes(id)) continue;
    moduleIds.push(id);
    const name = String(i?.name || id);
    const known = Object.hasOwn(COLLECTORS, id) ? COLLECTORS[id] : null;
    if (known) {
      collectors.push({ module: id, name });
      for (const [kind, value] of Object.entries(known)) {
        if (!value) continue;
        detected[kind] = true;
        if (kind === "thirdParty") for (const n of value) if (!thirdPartyNames.includes(n)) thirdPartyNames.push(n);
      }
    } else if (!QUIET.includes(id)) {
      unknown.push({ module: id, name, adminPath: typeof i?.adminPath === "string" ? i.adminPath : null });
    }
  }
  return { detected, thirdPartyNames, collectors, unknown, moduleIds: moduleIds.sort() };
}

/** Une extension est-elle de celles qui recueillent quelque chose (connue) ? Sert aux rappels après publication. */
export const isCollector = (id) => Object.hasOwn(COLLECTORS, id);
/** Une extension est-elle connue comme sans danger pour la vie privée ? */
export const isQuiet = (id) => QUIET.includes(id);
