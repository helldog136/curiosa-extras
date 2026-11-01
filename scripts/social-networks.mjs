// TABLE UNIQUE DES RÉSEAUX SOCIAUX. Le gabarit « adresse de votre profil » des 20 modules de réseau est ÉCRIT ICI, une seule fois :
//   node scripts/gen-social.mjs          écrit, pour chaque réseau, le bloc d'adresse de `index.mjs` et le réglage `profile` de `module.json` (+ description, README) ;
//   node scripts/gen-social.mjs --check  vérifie que rien n'a été modifié à la main (tests/social-generated.test.mjs le fait à chaque lancement des tests).
// Un module d'extras ne peut pas importer le code d'un autre : le bloc généré est donc recopié dans chaque `index.mjs`, mais il n'est plus ÉCRIT que dans ce fichier.
// Les données de cette table (hôtes, modèle d'adresse, exemple, icône) sont aussi celles du futur bloc `social` des manifestes (lot suivant).

/** Mots de l'adresse qui ne désignent jamais un compte (une page du site, pas un profil). */
const single = (reserved = [], chars = "A-Za-z0-9._-", { at = false, max = 60 } = {}) => {
  const guard = reserved.length ? `(?!(?:${reserved.join("|")})(?:/|$))` : "";
  return { re: `^/${at ? "@" : "@?"}${guard}([${chars}]{1,${max}})/?$`, handle: true };
};

/**
 * id            dossier du module
 * name          texte du bouton (« Instagram · monpseudo »)
 * template      adresse d'un compte : {h} = son nom ; null = l'adresse complète est obligatoire
 * hosts         sites acceptés (sous-domaines compris) ; null = n'importe quel serveur, mais une forme de profil est exigée (réseaux fédérés)
 * handle        forme d'un nom de compte saisi seul (expression régulière en texte) ; défaut : lettres, chiffres, point, tiret, souligné
 * tag           texte devant le nom du compte dans le bouton (« u/ » pour Reddit)
 * aliases       [adresse courte, vrai site] : « fb.me » devient « www.facebook.com »
 * forms         [forme, adresse complète] : « r/communaute » devient « https://www.reddit.com/r/communaute »
 * shapes        façons dont une adresse désigne un compte : { re (chemin), host, fromHost, handle, prefix, withHost, template }
 * fediverse     accepte @nom@serveur
 * example       exemple d'adresse (fr, en)
 * help          aide courte (fr, en) ; défaut : « Collez le lien de votre page. »
 * stats         ce que le module partage en plus de son bouton (fr, en), ou absent
 */
export const NETWORKS = [
  { id: "bandcamp", name: "Bandcamp", template: "https://{h}.bandcamp.com", hosts: ["bandcamp.com"], handle: "^@?[A-Za-z0-9-]{1,60}$",
    shapes: [{ host: "^([a-z0-9-]+)\\.bandcamp\\.com$", fromHost: true, re: "^/?$", handle: true }],
    example: ["https://monnom.bandcamp.com", "https://myname.bandcamp.com"] },
  { id: "bluesky", name: "Bluesky", template: "https://bsky.app/profile/{h}", hosts: ["bsky.app"],
    shapes: [{ re: "^/profile/([A-Za-z0-9._:-]{1,100})/?$", handle: true }],
    example: ["https://bsky.app/profile/nom.bsky.social", "https://bsky.app/profile/name.bsky.social"],
    stats: ["et partage vos followers et vos publications", "and shares your follower and post counts"] },
  { id: "discord", name: "Discord", template: "https://discord.gg/{h}", hosts: ["discord.gg", "discord.com", "discordapp.com"],
    shapes: [{ host: "^discord\\.gg$", re: "^/([A-Za-z0-9-]{2,32})/?$", handle: true }, { host: "^discord(?:app)?\\.com$", re: "^/invite/([A-Za-z0-9-]{2,32})/?$", handle: true }],
    example: ["https://discord.gg/abcDEF", "https://discord.gg/abcDEF"],
    help: ["Collez votre lien d'invitation.", "Paste your invitation link."],
    stats: ["et partage le nombre de vos membres", "and shares your member count"] },
  { id: "facebook", name: "Facebook", template: "https://www.facebook.com/{h}", hosts: ["facebook.com"], aliases: [["fb.me", "www.facebook.com"], ["fb.com", "www.facebook.com"]],
    shapes: [single(["profile\\.php", "people", "pages", "groups", "watch", "share", "p", "events", "marketplace", "gaming", "stories", "reel", "photo", "photos", "public", "login", "help", "policies"], "A-Za-z0-9.-")],
    example: ["https://www.facebook.com/monpseudo", "https://www.facebook.com/myname"] },
  { id: "github", name: "GitHub", template: "https://github.com/{h}", hosts: ["github.com"],
    shapes: [single(["orgs", "settings", "marketplace", "sponsors", "topics", "features", "login", "about", "pricing", "explore", "notifications"], "A-Za-z0-9-", { max: 39 })],
    example: ["https://github.com/monpseudo", "https://github.com/myname"],
    stats: ["et partage vos followers", "and shares your follower count"] },
  { id: "instagram", name: "Instagram", template: "https://www.instagram.com/{h}/", hosts: ["instagram.com"],
    shapes: [single(["p", "reel", "reels", "stories", "explore", "accounts", "direct", "tv"], "A-Za-z0-9._", { max: 30 })],
    example: ["https://www.instagram.com/monpseudo", "https://www.instagram.com/myname"] },
  { id: "kick", name: "Kick", template: "https://kick.com/{h}", hosts: ["kick.com"],
    shapes: [single(["categories", "video", "browse", "search"])],
    example: ["https://kick.com/monpseudo", "https://kick.com/myname"] },
  { id: "kofi", name: "Ko-fi", template: "https://ko-fi.com/{h}", hosts: ["ko-fi.com"],
    shapes: [single(["s", "home", "explore", "account", "gold"])],
    example: ["https://ko-fi.com/monpseudo", "https://ko-fi.com/myname"] },
  { id: "mastodon", name: "Mastodon", template: null, hosts: null, fediverse: true,
    shapes: [{ re: "^/@([A-Za-z0-9_.-]{1,60})/?$", withHost: true }, { re: "^/users/([A-Za-z0-9_.-]{1,60})/?$", withHost: true }, { re: "^/@([A-Za-z0-9_.-]{1,60}@[A-Za-z0-9.-]{1,200})/?$" }],
    example: ["https://mastodon.social/@nom", "https://mastodon.social/@name"],
    help: ["Collez le lien de votre profil, ou @nom@serveur.", "Paste your profile link, or @name@server."],
    stats: ["et partage vos followers et vos publications", "and shares your follower and post counts"] },
  { id: "patreon", name: "Patreon", template: "https://www.patreon.com/{h}", hosts: ["patreon.com"],
    shapes: [single(["c", "user", "join", "posts", "home", "login", "explore", "settings"])],
    example: ["https://www.patreon.com/monpseudo", "https://www.patreon.com/myname"] },
  { id: "pinterest", name: "Pinterest", template: "https://www.pinterest.com/{h}/", hosts: ["pinterest.com"],
    shapes: [single(["pin", "ideas", "search", "today", "business", "login"])],
    example: ["https://www.pinterest.com/monpseudo", "https://www.pinterest.com/myname"] },
  { id: "reddit", name: "Reddit", template: "https://www.reddit.com/user/{h}", hosts: ["reddit.com"], tag: "u/",
    forms: [["^/?r/([A-Za-z0-9_]{2,21})/?$", "https://www.reddit.com/r/{1}"], ["^/?(?:u|user)/([A-Za-z0-9_-]{2,21})/?$", "https://www.reddit.com/user/{1}"]],
    shapes: [{ re: "^/(?:u|user)/([A-Za-z0-9_-]{2,21})/?$", handle: true }, { re: "^/r/([A-Za-z0-9_]{2,21})/?$", prefix: "r/", template: "https://www.reddit.com/r/{h}" }],
    example: ["https://www.reddit.com/user/monpseudo", "https://www.reddit.com/user/myname"],
    help: ["Collez le lien de votre profil ou de votre communauté.", "Paste the link to your profile or community."],
    stats: ["et partage vos followers", "and shares your follower count"] },
  { id: "snapchat", name: "Snapchat", template: "https://www.snapchat.com/add/{h}", hosts: ["snapchat.com"],
    shapes: [{ re: "^/add/([A-Za-z0-9._-]{1,60})/?$", handle: true }, { re: "^/@([A-Za-z0-9._-]{1,60})/?$", handle: true }],
    example: ["https://www.snapchat.com/add/monpseudo", "https://www.snapchat.com/add/myname"] },
  { id: "soundcloud", name: "SoundCloud", template: "https://soundcloud.com/{h}", hosts: ["soundcloud.com"],
    shapes: [single(["discover", "stream", "search", "you", "upload", "pages", "charts", "popular"])],
    example: ["https://soundcloud.com/monpseudo", "https://soundcloud.com/myname"] },
  { id: "spotify", name: "Spotify", template: null, hosts: ["spotify.com"], shapes: [],
    example: ["https://open.spotify.com/artist/1a2B3c4D5e6F7g8H9i0J1k", "https://open.spotify.com/artist/1a2B3c4D5e6F7g8H9i0J1k"],
    help: ["Dans Spotify : Partager, puis Copier le lien.", "In Spotify: Share, then Copy link."] },
  { id: "steam", name: "Steam", template: "https://steamcommunity.com/id/{h}", hosts: ["steamcommunity.com", "steampowered.com"],
    forms: [["^(7656119\\d{10})$", "https://steamcommunity.com/profiles/{1}"]],
    shapes: [{ re: "^/id/([A-Za-z0-9._-]{2,32})/?$", handle: true }],
    example: ["https://steamcommunity.com/id/monpseudo", "https://steamcommunity.com/id/myname"] },
  { id: "telegram", name: "Telegram", template: "https://t.me/{h}", hosts: ["t.me", "telegram.me"],
    shapes: [single(["s", "joinchat", "share", "addstickers", "proxy", "login"], "A-Za-z0-9_", { max: 32 })],
    example: ["https://t.me/monpseudo", "https://t.me/myname"] },
  { id: "threads", name: "Threads", template: "https://www.threads.net/@{h}", hosts: ["threads.net", "threads.com"],
    shapes: [single([], "A-Za-z0-9._", { at: true, max: 30 })],
    example: ["https://www.threads.net/@monpseudo", "https://www.threads.net/@myname"] },
  { id: "tiktok", name: "TikTok", template: "https://www.tiktok.com/@{h}", hosts: ["tiktok.com"],
    shapes: [single([], "A-Za-z0-9._", { at: true, max: 24 })],
    example: ["https://www.tiktok.com/@monpseudo", "https://www.tiktok.com/@myname"] },
  { id: "x-twitter", name: "X", icon: "x", template: "https://x.com/{h}", hosts: ["x.com"], aliases: [["twitter.com", "x.com"]],
    shapes: [single(["home", "explore", "i", "search", "intent", "share", "hashtag", "messages", "notifications", "settings", "compose"], "A-Za-z0-9_", { max: 15 })],
    example: ["https://x.com/monpseudo", "https://x.com/myname"] },
];

export const DEFAULT_HELP = ["Collez le lien de votre page.", "Paste the link to your page."];
export const LABEL = ["Adresse de votre profil", "Your profile address"];
export const MIN_CORE = "0.6.0";
const DEFAULT_HANDLE = "^@?[A-Za-z0-9._-]{1,60}$";
const DEFAULT_ICON = (n) => n.id;

export const BEGIN = "// ═══ DÉBUT du bloc « adresse du profil » — GÉNÉRÉ par scripts/social-networks.mjs (node scripts/gen-social.mjs) : ne le modifiez pas à la main ═══";
export const END = "// ═══ FIN du bloc « adresse du profil » ═══";

const j = (v) => JSON.stringify(v);

/** Le bloc d'adresse d'un réseau : même code pour les 20, seules les constantes changent. */
export function renderBlock(n) {
  const shapes = (n.shapes ?? []).map((s) => ({ ...s, re: s.re }));
  return `${BEGIN}
const NAME = ${j(n.name)};
const ICON = ${j(n.icon ?? DEFAULT_ICON(n))};
const TEMPLATE = ${j(n.template)}; // {h} = le nom du compte ; null : l'adresse complète est obligatoire
const HOSTS = ${j(n.hosts)}; // null : n'importe quel serveur, mais une forme de profil est exigée (réseaux fédérés)
const HANDLE = new RegExp(${j(n.handle ?? DEFAULT_HANDLE)}); // un nom de compte saisi seul
const TAG = ${j(n.tag ?? "")}; // texte devant le nom du compte dans le bouton
const ALIASES = ${j(n.aliases ?? [])}; // [adresse courte, vrai site]
const FORMS = ${j(n.forms ?? [])}; // [forme courte, adresse complète]
const SHAPES = ${j(shapes)}; // façons dont une adresse désigne un compte
const FEDIVERSE = ${j(Boolean(n.fediverse))}; // accepte @nom@serveur
const TRACKING = /^(?:utm_.*|igsh|igshid|si|s|t|fbclid|gclid|ref|ref_src|ref_url|mibextid|share_id|feature|_t|_r|sender_device|is_from_webapp|app)$/i; // suivi publicitaire, retiré de l'adresse
const SHAPE_RE = SHAPES.map((s) => ({ ...s, re: new RegExp(s.re), host: s.host ? new RegExp(s.host, "i") : null }));
const hostIs = (host, list) => list.some((h) => host === h || host.endsWith(\`.\${h}\`));

/**
 * { url, handle, tag } pour ce que la personne a collé, ou null si c'est vide, mal formé ou d'un autre site.
 * Accepté : le nom seul (avec ou sans @), l'adresse avec ou sans https:// et avec ou sans www., les adresses courtes (fb.me, t.me…), @nom@serveur (réseaux fédérés).
 * Retiré : les paramètres de suivi (igsh, utm_*, fbclid…) et l'ancre. Jamais d'http, d'identifiants dans l'adresse ni de javascript:.
 * \`url\` est toujours la MÊME pour un même compte (celle du modèle), \`tag\` le texte du bouton (« monpseudo »), \`handle\` le nom du compte quand on le connaît.
 */
export function profile(value) {
  let v = String(value ?? "").trim().replace(/^<(.*)>$/s, "$1").replace(/^["'“«‘]+|["'”»’]+$/g, "").trim();
  if (!v || /\\s/.test(v) || v.length > 300) return null;
  if (FEDIVERSE) { const m = /^@?([A-Za-z0-9_.-]{1,60})@([A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)+)$/.exec(v); if (m) v = \`https://\${m[2]}/@\${m[1]}\`; }
  for (const [form, url] of FORMS) { const m = new RegExp(form).exec(v); if (m) { v = url.replace("{1}", m[1]); break; } }
  if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) {   // « instagram.com/nom » sans https:// : seulement si le début est bien l'adresse de ce réseau
    const first = v.split(/[/?#]/)[0].toLowerCase().replace(/^www\\./, "");
    const known = HOSTS ? [...HOSTS, ...ALIASES.map((a) => a[0])] : null;
    if (first.includes(".") && (known ? hostIs(first, known) : /^[^/]+\\/(?:@|users\\/)/.test(v))) v = \`https://\${v}\`;
  }
  if (/^https:\\/\\//i.test(v)) {
    let u;
    try { u = new URL(v); } catch { return null; }
    if (u.protocol !== "https:" || u.username || u.password) return null;
    let host = u.hostname.toLowerCase().replace(/^www\\./, "");
    for (const [short, real] of ALIASES) if (hostIs(host, [short])) { host = real.replace(/^www\\./, ""); u.hostname = real; break; }
    if (HOSTS && !hostIs(host, HOSTS)) return null;
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    u.hash = "";
    for (const s of SHAPE_RE) {
      const hm = s.host ? s.host.exec(host) : null;
      if (s.host && !hm) continue;
      if (s.handle && !s.fromHost && HOSTS && !HOSTS.includes(host)) continue;   // un sous-domaine (gist.github.com) garde son adresse
      const pm = s.re.exec(u.pathname);
      const name = pm && (s.fromHost ? hm?.[1] : pm[1]);
      if (!name) continue;
      const handle = s.handle ? name : null;
      const model = s.template ?? (handle ? TEMPLATE : null);   // l'adresse du modèle : toujours la même pour un même compte
      return { url: model ? model.replace("{h}", encodeURIComponent(name)) : u.href, handle, tag: \`\${s.handle ? TAG : s.prefix ?? ""}\${name}\${s.withHost ? \`@\${host}\` : ""}\` };
    }
    return HOSTS ? { url: u.href, handle: null, tag: null } : null;
  }
  if (!TEMPLATE || !HANDLE.test(v)) return null;
  const handle = v.replace(/^@/, "");
  return { url: TEMPLATE.replace("{h}", encodeURIComponent(handle)), handle, tag: TAG + handle };
}

/** Le bouton du réseau : le même texte quelle que soit la façon dont l'adresse a été collée. */
export const buttonLabel = (p) => (p.tag ? \`\${NAME} · \${p.tag}\` : NAME);
${END}`;
}

/** Un module entièrement généré (aucune statistique) : en-tête, bloc, bouton. */
export function renderWhole(n) {
  return `// ${n.name} — réseau social de Curiosa. Il ne fait QU'UNE chose : fournir son bouton au cœur (sujet \`social.link\`) pour l'en-tête du site.
// Réglage : l'adresse du profil. Rien n'est affiché tant qu'elle n'est pas réglée ; seule une adresse https du bon site est acceptée. Fichier GÉNÉRÉ : voir le bloc ci-dessous.
${renderBlock(n)}

export default {
  exports: {
    "social.link"(ctx) {
      const p = profile(ctx.setting("profile"));
      return p ? [{ label: buttonLabel(p), url: p.url, icon: ICON }] : [];
    },
  },
};
`;
}

export const hasStats = (n) => Boolean(n.stats);

/** Le réglage « profile » de module.json. */
export function profileSetting(n) {
  const help = n.help ?? DEFAULT_HELP;
  return {
    key: "profile", type: "text",
    label: { en: LABEL[1], fr: LABEL[0] },
    help: { en: help[1], fr: help[0] },
    example: { en: n.example[1], fr: n.example[0] },
  };
}

/**
 * Le bloc `social` de module.json (cœur 0.6.2) : tout ce qu'il faut pour reconnaître l'adresse d'un profil SANS installer le module (le catalogue le recopie).
 * Mêmes données que le bloc généré de `index.mjs` ; `src/core/socialRecognize.ts` du cœur en fait la même lecture (un test le prouve quand le cœur la contient).
 */
export function socialBlock(n) {
  return {
    name: n.name, icon: n.icon ?? DEFAULT_ICON(n), hosts: n.hosts, template: n.template,
    example: { en: n.example[1], fr: n.example[0] },
    ...(n.handle && n.handle !== DEFAULT_HANDLE ? { handle: n.handle } : {}),
    ...(n.tag ? { tag: n.tag } : {}),
    ...(n.aliases?.length ? { aliases: n.aliases } : {}),
    ...(n.forms?.length ? { forms: n.forms } : {}),
    ...(n.shapes?.length ? { shapes: n.shapes } : {}),
    ...(n.fediverse ? { fediverse: true } : {}),
  };
}

/** La description de module.json : une phrase, sans mode d'emploi. */
export function description(n) {
  return {
    en: `Shows your ${n.name} button in the site header${n.stats ? ` ${n.stats[1]}` : ""}.`,
    fr: `Affiche le bouton de votre ${n.name} dans l'en-tête${n.stats ? ` ${n.stats[0]}` : " du site"}.`,
  };
}

/** La ligne « Réglage » du README. */
export function readmeSetting(n) {
  const help = n.help ?? DEFAULT_HELP;
  return `- **Réglage** : l'adresse de votre profil. ${help[0]} Par exemple : ${n.example[0]}. Le nom seul, l'adresse sans https:// ou sans www. et les adresses courtes sont reconnus ; les paramètres de suivi sont retirés.`;
}
