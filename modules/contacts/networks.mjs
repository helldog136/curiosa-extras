// Contacts — le registre des réseaux : normalisation d'un compte (pseudo ou lien collé), détection du réseau d'un lien, icônes, règle de la photo.
// Fonctions PURES (aucun accès au stockage ni au réseau). Même règle que le contrat de « contact.book » v2 (tests/contract/README.md) :
// un compte = (réseau, pseudo normalisé) ; toutes les façons d'écrire le même compte donnent le même pseudo.

export const NETWORKS = ["twitch", "youtube", "tiktok", "instagram", "discord", "x", "bluesky", "mastodon", "web", "other"];
/** Ordre de repli de la photo automatique (aucun nombre d'abonnés connu), puis les autres réseaux dans l'ordre du registre. */
export const PHOTO_ORDER = ["twitch", "youtube", "bluesky"];

export const clean = (v, max, multiline = false) => {
  let t = String(v ?? "").normalize("NFC").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "");
  t = multiline ? t.replace(/\n{3,}/g, "\n\n") : t.replace(/\s+/g, " ");
  return t.trim().slice(0, max);
};
/** Clé de comparaison : sans casse, sans accents, espaces réduits (« Hélène  MARTIN » = « helene martin »). */
export const fold = (v) => String(v ?? "").normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim().toLowerCase();

// Chemins Twitch qui ne sont pas des chaînes (twitch.tv/directory…).
const NOT_TWITCH = new Set(["videos", "directory", "downloads", "settings", "subscriptions", "friends", "wallet", "inventory", "drops", "prime", "turbo", "jobs", "store", "team", "popout", "embed", "moderator", "dashboard", "broadcast", "login", "signup", "search"]);
const dec = (v) => { try { return decodeURIComponent(v); } catch { return v; } };
const fromUrl = (s, hosts) => {
  const m = new RegExp(`^(?:https?://)?(?:www\\.|m\\.|mobile\\.)?(?:${hosts})/([^?#\\s]*)`, "i").exec(s);
  return m ? dec(m[1]).replace(/\/+$/, "") : null;
};

/** Saisie indulgente : espaces, guillemets, chevrons « <…> » et ponctuation finale autour d'un lien collé sont retirés. */
function tidy(input) {
  let s = typeof input === "string" ? input.normalize("NFC").replace(/[\u200b-\u200d\ufeff]/g, "").trim() : "";
  s = s.replace(/^[<"'«“‘\s]+|[>"'»”’\s]+$/g, "").trim();
  if (/^(?:https?:\/\/|www\.)/i.test(s)) s = s.replace(/[.,;!)]+$/, "");
  return s;
}

/**
 * Normalise un compte. Rend { network, handle, url } ou { error: "invalid_network" | "invalid_handle" }.
 *   twitch    pseudo, @pseudo, twitch.tv/pseudo → minuscules, [a-z0-9_]{4,25} (règle de Twitch)
 *   youtube   @nom, youtube.com/@nom → « @nom » en minuscules ; youtube.com/channel/UC… → l'identifiant de chaîne tel quel
 *   tiktok    @nom, tiktok.com/@nom → minuscules, [a-z0-9._]{2,24}
 *   instagram nom, @nom, instagram.com/nom → minuscules, [a-z0-9._]{1,30}
 *   x         nom, @nom, x.com/nom, twitter.com/nom → minuscules, [a-z0-9_]{1,15}
 *   bluesky   nom.domaine, @nom.domaine, bsky.app/profile/nom.domaine → minuscules ; un nom sans point devient « nom.bsky.social » ; did:plc:… tel quel
 *   mastodon  @nom@instance, nom@instance, https://instance/@nom → « nom@instance » en minuscules
 *   discord   nom d'utilisateur ([a-z0-9_.]{2,32}) ; une invitation discord.gg/CODE → « invite/CODE »
 *   web       adresse http(s) → hôte/chemin (hôte en minuscules, sans www., sans / final ni #…)
 *   other     texte libre (200 caractères), comparé sans casse
 */
export function normalizeAccount(network, input) {
  if (!NETWORKS.includes(network)) return { error: "invalid_network" };
  let s = tidy(input);
  if (!s || s.length > 300) return { error: "invalid_handle" };
  const ok = (handle, url) => ({ network, handle, url });
  switch (network) {
    case "twitch": {
      const u = fromUrl(s, "twitch\\.tv");
      if (u !== null) s = u.split("/")[0]; else s = s.replace(/^@/, "");
      s = s.toLowerCase();
      return /^[a-z0-9_]{4,25}$/.test(s) && !NOT_TWITCH.has(s) ? ok(s, `https://www.twitch.tv/${s}`) : { error: "invalid_handle" };
    }
    case "youtube": {
      const u = fromUrl(s, "youtube\\.com");
      if (u !== null) {
        const ch = /^channel\/(UC[A-Za-z0-9_-]{22})$/.exec(u.split("/").slice(0, 2).join("/"));
        if (ch) return ok(ch[1], `https://www.youtube.com/channel/${ch[1]}`);
        s = u.split("/")[0];
        if (!s.startsWith("@")) return { error: "invalid_handle" };
      }
      if (/^UC[A-Za-z0-9_-]{22}$/.test(s)) return ok(s, `https://www.youtube.com/channel/${s}`);
      s = `@${s.replace(/^@/, "").toLowerCase()}`;
      return /^@[a-z0-9._-]{3,30}$/.test(s) ? ok(s, `https://www.youtube.com/${s}`) : { error: "invalid_handle" };
    }
    case "tiktok": {
      const u = fromUrl(s, "tiktok\\.com");
      if (u !== null) s = u.split("/")[0];
      s = s.replace(/^@/, "").toLowerCase();
      return /^[a-z0-9._]{2,24}$/.test(s) ? ok(s, `https://www.tiktok.com/@${s}`) : { error: "invalid_handle" };
    }
    case "instagram": {
      const u = fromUrl(s, "instagram\\.com");
      if (u !== null) s = u.split("/")[0];
      s = s.replace(/^@/, "").toLowerCase();
      return /^[a-z0-9._]{1,30}$/.test(s) ? ok(s, `https://www.instagram.com/${s}`) : { error: "invalid_handle" };
    }
    case "x": {
      const u = fromUrl(s, "x\\.com|twitter\\.com");
      if (u !== null) s = u.split("/")[0];
      s = s.replace(/^@/, "").toLowerCase();
      return /^[a-z0-9_]{1,15}$/.test(s) ? ok(s, `https://x.com/${s}`) : { error: "invalid_handle" };
    }
    case "bluesky": {
      const u = fromUrl(s, "bsky\\.app");
      if (u !== null) { const m = /^profile\/([^/]+)/.exec(u); if (!m) return { error: "invalid_handle" }; s = m[1]; }
      s = s.replace(/^@/, "");
      if (/^did:plc:[a-z2-7]{24}$/.test(s)) return ok(s, `https://bsky.app/profile/${s}`);
      s = s.toLowerCase();
      if (!s.includes(".")) s = `${s}.bsky.social`;
      return /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/.test(s) ? ok(s, `https://bsky.app/profile/${s}`) : { error: "invalid_handle" };
    }
    case "mastodon": {
      let m = /^(?:https?:\/\/)?([a-z0-9.-]+\.[a-z]{2,})\/@([a-z0-9_]{1,30})\/?$/i.exec(s);
      let user, host;
      if (m) [user, host] = [m[2], m[1]];
      else { m = /^@?([a-z0-9_]{1,30})@([a-z0-9.-]+\.[a-z]{2,})$/i.exec(s); if (!m) return { error: "invalid_handle" }; [user, host] = [m[1], m[2]]; }
      user = user.toLowerCase(); host = host.toLowerCase();
      return ok(`${user}@${host}`, `https://${host}/@${user}`);
    }
    case "discord": {
      const inv = /^(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord\.com\/invite)\/([A-Za-z0-9-]{2,32})\/?$/.exec(s);
      if (inv) return ok(`invite/${inv[1]}`, `https://discord.gg/${inv[1]}`);
      s = s.replace(/^@/, "").toLowerCase();
      return /^[a-z0-9_.]{2,32}$/.test(s) ? ok(s, null) : { error: "invalid_handle" };
    }
    case "web": {
      if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
      let u;
      try { u = new URL(s); } catch { return { error: "invalid_handle" }; }
      if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".") || u.username || u.password) return { error: "invalid_handle" };
      const host = u.hostname.toLowerCase().replace(/^www\./, "");
      const path = u.pathname.replace(/\/+$/, "");
      const handle = `${host}${path}${u.search}`;
      return handle.length <= 200 ? ok(handle, `https://${handle}`) : { error: "invalid_handle" };
    }
    default: { // other
      const t = clean(s, 200);
      return t ? ok(t, null) : { error: "invalid_handle" };
    }
  }
}

/** Clé d'unicité d'un compte : « réseau:pseudo » (« other » comparé sans casse). */
export const accountKey = (network, handle) => `${network}:${network === "other" ? fold(handle) : handle}`;

/** Le réseau d'un LIEN collé (null si ce n'est pas un lien d'un réseau connu). Sert à l'erreur « Ce lien est un lien YouTube… ». */
export function detectNetwork(input) {
  const s = tidy(input).toLowerCase();
  const host = /^(?:https?:\/\/)?(?:www\.|m\.|mobile\.)?([a-z0-9.-]+\.[a-z]{2,})(?:[/?#]|$)/.exec(s)?.[1];
  if (!host) return null;
  const table = [["twitch", /(^|\.)twitch\.tv$/], ["youtube", /(^|\.)(youtube\.com|youtu\.be)$/], ["tiktok", /(^|\.)tiktok\.com$/], ["instagram", /(^|\.)instagram\.com$/],
    ["x", /(^|\.)(x\.com|twitter\.com)$/], ["bluesky", /(^|\.)bsky\.app$/], ["discord", /(^|\.)(discord\.gg|discord\.com)$/]];
  for (const [n, re] of table) if (re.test(host)) return n;
  if (/^(?:https?:\/\/)?[a-z0-9.-]+\/@[a-z0-9_]{1,30}\/?$/i.test(s)) return "mastodon";
  return "web";
}

// Premier segment de chemin qui n'est PAS un profil (x.com/home, instagram.com/p/…, tiktok.com/discover…).
const NOT_PROFILE = {
  x: new Set(["home", "i", "intent", "share", "search", "explore", "settings", "messages", "notifications", "compose", "hashtag", "login", "signup", "tos", "privacy"]),
  instagram: new Set(["p", "reel", "reels", "explore", "stories", "accounts", "direct", "tv", "about", "legal", "web"]),
};

/**
 * Vérifie ce que la personne a écrit POUR LA PLATEFORME QU'ELLE A CHOISIE (ajout rapide). PURE : aucune requête, aucun accès au stockage.
 * Rend { status: "ok", network, handle, url } · { status: "empty" } · { status: "other_network", detected } (un lien d'une AUTRE plateforme connue) ·
 * { status: "invalid" } (ni un pseudo ni un lien de cette plateforme : adresse d'une vidéo, d'une page qui n'est pas un profil, e-mail, espaces…).
 * Accepte : pseudo, @pseudo, lien avec ou sans https://, avec ou sans www./m., majuscules, espaces autour, sous-pages (twitch.tv/nom/videos).
 */
export function checkAccountInput(network, input) {
  if (!NETWORKS.includes(network)) return { status: "invalid" };
  const s = tidy(input);
  if (!s) return { status: "empty" };
  if (s.length > 300 || (/\s/.test(s) && network !== "other")) return { status: "invalid" };
  const detected = detectNetwork(s);
  const isLink = /^(?:https?:\/\/|www\.)/i.test(s) || /^(?:[a-z0-9-]+\.)+[a-z]{2,}\//i.test(s);
  if (isLink && detected && detected !== network && detected !== "web") return { status: "other_network", detected };
  if (isLink && NOT_PROFILE[network]) {
    const first = (fromUrl(s, network === "x" ? "x\\.com|twitter\\.com" : "instagram\\.com") ?? "").split("/")[0].toLowerCase();
    if (NOT_PROFILE[network].has(first)) return { status: "invalid" };
  }
  if (isLink && network === "tiktok") {
    const first = (fromUrl(s, "tiktok\\.com") ?? "").split("/")[0];
    if (!first.startsWith("@")) return { status: "invalid" };
  }
  if (!isLink && network !== "mastodon" && network !== "other" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) return { status: "invalid" }; // une adresse e-mail n'est pas un pseudo
  const n = normalizeAccount(network, s);
  return n.error ? { status: "invalid" } : { status: "ok", network: n.network, handle: n.handle, url: n.url };
}

/**
 * Comptes repérés dans un texte libre (« Autres canaux » d'une fiche d'avant la 2.0) : liens de réseaux connus, @nom@instance (Mastodon).
 * Rend [{ network, handle, url }] (10 au plus, sans doublon). Rien n'est deviné pour un « @pseudo » seul (réseau inconnu).
 */
export function accountsInText(text) {
  const out = [], seen = new Set();
  const s = String(text ?? "").slice(0, 5000);
  const push = (n) => { if (!n || n.error) return; const k = accountKey(n.network, n.handle); if (!seen.has(k) && out.length < 10) { seen.add(k); out.push(n); } };
  for (const m of s.matchAll(/(?:https?:\/\/)?(?:www\.|m\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}\/[^\s<>"',;)]*/gi)) {
    const network = detectNetwork(m[0]);
    if (network && network !== "web") push(normalizeAccount(network, m[0]));
  }
  for (const m of s.matchAll(/(?<![\w/])@?([a-z0-9_]{1,30}@[a-z0-9.-]+\.[a-z]{2,})(?![\w.-]*\/)/gi)) if (m[0].startsWith("@")) push(normalizeAccount("mastodon", m[0]));
  return out;
}

/**
 * Photo d'une fiche — règle PURE, sans réseau : photo manuelle, sinon le compte qui a le plus d'abonnés CONNUS (cache daté), sinon Twitch, YouTube,
 * Bluesky, puis les autres réseaux. `contact` = { photo?: url manuelle, accounts: [{ id, network, avatar?, followers? }] }. Rend { url, source, accountId? } ou null.
 */
export function pickPhoto(contact) {
  if (contact?.photo) return { url: contact.photo, source: "manual" };
  const withAvatar = (contact?.accounts ?? []).filter((a) => a.avatar);
  if (!withAvatar.length) return null;
  const rank = (a) => { const i = PHOTO_ORDER.indexOf(a.network); return i >= 0 ? i : PHOTO_ORDER.length + NETWORKS.indexOf(a.network); };
  const counted = withAvatar.filter((a) => Number.isInteger(a.followers));
  const pool = counted.length ? counted : withAvatar;
  const best = [...pool].sort((a, b) => (counted.length ? b.followers - a.followers : 0) || rank(a) - rank(b))[0];
  return { url: best.avatar, source: best.network, accountId: best.id };
}

/** Couleur et pictogramme (SVG 16×16, dessin simple) de chaque réseau, pour les pastilles des cartes. Le nom lisible vient des textes (net_<réseau>). */
export const NETWORK_LOOK = {
  twitch: { color: "#9146ff", path: "M3 2 2 5v8h3v2h2l2-2h3l3-3V2Zm11 7-2 2H9l-2 2v-2H4V3.5h10ZM11 5h1.5v3.5H11Zm-3.5 0H9v3.5H7.5Z" },
  youtube: { color: "#e62117", path: "M15.3 4.6c-.2-.7-.7-1.2-1.4-1.4C12.7 3 8 3 8 3s-4.7 0-5.9.2c-.7.2-1.2.7-1.4 1.4C.5 5.8.5 8 .5 8s0 2.2.2 3.4c.2.7.7 1.2 1.4 1.4C3.3 13 8 13 8 13s4.7 0 5.9-.2c.7-.2 1.2-.7 1.4-1.4.2-1.2.2-3.4.2-3.4s0-2.2-.2-3.4ZM6.5 10.2V5.8L10.3 8Z" },
  tiktok: { color: "#111111", path: "M11.4 1h-2.3v9.6a1.9 1.9 0 1 1-1.9-1.9c.2 0 .4 0 .6.1V6.4a4.3 4.3 0 1 0 3.6 4.2V5.8a5.3 5.3 0 0 0 3.1 1V4.5a3.1 3.1 0 0 1-3.1-3.5Z" },
  instagram: { color: "#c13584", path: "M8 1.5c-1.8 0-2 0-2.7.1-2.4.1-3.7 1.4-3.8 3.8C1.5 6 1.5 6.2 1.5 8s0 2 .1 2.7c.1 2.4 1.4 3.7 3.8 3.8.7.1.9.1 2.6.1s2 0 2.7-.1c2.4-.1 3.7-1.4 3.8-3.8.1-.7.1-.9.1-2.7s0-2-.1-2.7c-.1-2.4-1.4-3.7-3.8-3.8C10 1.5 9.8 1.5 8 1.5Zm0 3.3a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4Zm0 1.3a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8Zm3.4-2.3a.8.8 0 1 1 0 1.5.8.8 0 0 1 0-1.5Z" },
  discord: { color: "#5865f2", path: "M13.3 3.3A12.6 12.6 0 0 0 10.2 2.4l-.4.8a11.7 11.7 0 0 0-3.6 0l-.4-.8a12.6 12.6 0 0 0-3.1 1C.7 6.3.2 9.2.4 12a12.7 12.7 0 0 0 3.8 1.9l.8-1.3a8.2 8.2 0 0 1-1.3-.6l.3-.2a9 9 0 0 0 7.8 0l.3.2-1.3.6.8 1.3A12.6 12.6 0 0 0 15.6 12c.3-3.3-.6-6.1-2.3-8.7ZM5.6 10.3c-.8 0-1.4-.7-1.4-1.6s.6-1.6 1.4-1.6 1.4.7 1.4 1.6-.6 1.6-1.4 1.6Zm4.8 0c-.8 0-1.4-.7-1.4-1.6s.6-1.6 1.4-1.6 1.4.7 1.4 1.6-.6 1.6-1.4 1.6Z" },
  x: { color: "#111111", path: "M12.2 1.5h2.2L9.6 7l5.6 7.5h-4.4L7.4 10l-3.9 4.5H1.3l5.1-5.9L1 1.5h4.5l3.1 4.1Zm-.8 11.7h1.2L4.8 2.7H3.5Z" },
  bluesky: { color: "#1185fe", path: "M3.7 2.4C5.5 3.8 7.4 6.5 8 7.9c.6-1.4 2.5-4.1 4.3-5.5 1.3-1 3.4-1.7 3.4.6 0 .5-.3 3.9-.4 4.5-.6 2-2.6 2.5-4.4 2.2 3.2.5 4 2.3 2.2 4.1-3.3 3.4-4.8-.9-5.1-1.9V11.8c-.4 1-1.8 5.3-5.1 1.9-1.8-1.8-1-3.6 2.2-4.1-1.8.3-3.8-.2-4.4-2.2C.6 6.9.3 3.5.3 3c0-2.3 2.1-1.6 3.4-.6Z" },
  mastodon: { color: "#6364ff", path: "M14.7 5.3c0-2.9-1.9-3.7-1.9-3.7C11.8 1.1 10.1 1 8.3 1h-.1C6.4 1 4.7 1.1 3.8 1.6c0 0-1.9.8-1.9 3.7 0 3.3-.2 7.4 3.1 8.3 1.3.3 2.3.4 3.2.4 1.7-.1 2.6-.6 2.6-.6V12.1s-1.2.4-2.6.3c-1.4 0-2.8-.1-3-1.8V10.3s1.3.3 3 .4c1 0 2-.1 3-.2 1.9-.2 3.5-1.4 3.7-2.4.3-1.6.3-2.8.3-2.8ZM12.2 9.2h-1.5V5.5c0-.8-.3-1.2-1-1.2-.7 0-1.1.5-1.1 1.4v2H7.1v-2C7.1 4.8 6.7 4.3 6 4.3c-.7 0-1 .4-1 1.2v3.7H3.5V5.4c0-.8.2-1.4.6-1.9.4-.5 1-.7 1.7-.7.8 0 1.4.3 1.8.9l.4.7.4-.7c.4-.6 1-.9 1.8-.9.7 0 1.3.2 1.7.7.4.5.6 1.1.6 1.9Z" },
  web: { color: "#4f7d8c", path: "M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm4.9 6.3h-2.1a11 11 0 0 0-.8-3.8 5.6 5.6 0 0 1 2.9 3.8ZM8 2.5c.6.8 1.2 2.4 1.4 4.8H6.6C6.8 4.9 7.4 3.3 8 2.5ZM6 3.5a11 11 0 0 0-.8 3.8H3.1A5.6 5.6 0 0 1 6 3.5ZM3.1 8.7h2.1a11 11 0 0 0 .8 3.8 5.6 5.6 0 0 1-2.9-3.8ZM8 13.5c-.6-.8-1.2-2.4-1.4-4.8h2.8c-.2 2.4-.8 4-1.4 4.8Zm2-1a11 11 0 0 0 .8-3.8h2.1a5.6 5.6 0 0 1-2.9 3.8Z" },
  other: { color: "#7a8794", path: "M6.6 9.4a.8.8 0 0 1 0-1.1l3-3a.8.8 0 1 1 1.1 1.1l-3 3a.8.8 0 0 1-1.1 0Zm-1.8 3.3a2.3 2.3 0 0 1-3.3-3.3l1.9-1.9a.8.8 0 0 1 1.1 1.1L2.6 10.5a.8.8 0 0 0 1.1 1.1l1.9-1.9a.8.8 0 0 1 1.1 1.1Zm6.4-3.6a.8.8 0 0 1 0-1.1l1.9-1.9a.8.8 0 0 0-1.1-1.1L10.1 5.9A.8.8 0 0 1 9 4.8l1.9-1.9a2.3 2.3 0 0 1 3.3 3.3l-1.9 1.9a.8.8 0 0 1-1.1 0Z" },
};
