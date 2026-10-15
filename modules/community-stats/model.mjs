// Statistiques de la communauté — vocabulaire fixe, réglages, validation d'un chiffre reçu d'un module de réseau.
export const TOPIC = "social.stat";
export const METRICS = ["followers", "paying", "content", "views"]; // abonnés, abonnés payants, publications, vues
// Chiffres de PÉRIODE (30 jours glissants), publiés par un module qui mesure lui-même (Chaîne Twitch : ses directs). Entiers >= 0 ; les durées sont en MINUTES entières
// (hours_streamed, hours_watched : le nom est celui du contrat, l'unité est la minute). Jamais saisis à la main.
export const PERIOD_METRICS = ["avg_viewers", "peak_viewers", "hours_streamed", "hours_watched", "followers_gained"];
export const MINUTE_METRICS = ["hours_streamed", "hours_watched"];
export const AUTO_METRICS = [...METRICS, ...PERIOD_METRICS]; // tout ce qu'un module de réseau peut publier (liste fermée)
export const ERRORS = ["auth", "rate", "network", "hidden", "config"];
export const DAY = 86_400_000;
export const MAX_VALUE = 1_000_000_000_000; // un chiffre de réseau social ne dépasse jamais mille milliards
export const MAX_STATS = 300; // statistiques suivies au plus (automatiques + manuelles)
export const MAX_ITEMS = 200; // le cœur ne transmet jamais plus de 200 éléments par collecte
export const STALE_MANUAL_DAYS = 30; // rappel doux : un chiffre saisi à la main date de plus de 30 jours
export const PERIODS = { "1h": 3_600_000, "6h": 6 * 3_600_000, "12h": 12 * 3_600_000, "1d": DAY, "1w": 7 * DAY };
export const RETENTIONS = { "3m": 92 * DAY, "1y": 366 * DAY, "2y": 731 * DAY, "5y": 1827 * DAY, forever: Infinity };
export const DEFAULT_PERIOD = "1d";
export const DEFAULT_RETENTION = "2y";

export const periodKey = (ctx) => (ctx.setting("period") in PERIODS ? ctx.setting("period") : DEFAULT_PERIOD);
export const periodMs = (ctx) => PERIODS[periodKey(ctx)];
export const retentionMs = (ctx) => RETENTIONS[ctx.setting("retention")] ?? RETENTIONS[DEFAULT_RETENTION];

/** Erreur dont le message est lisible par l'assistant ; `code` permet à l'admin d'afficher un texte traduit. */
export const fail = (message, code) => Object.assign(new Error(message), { expose: true, code });

/** Texte propre : une chaîne, sans caractères de contrôle, espaces réduits, 1 à `max` caractères. Sinon null (jamais tronqué en silence). */
export function clean(value, max) {
  if (typeof value !== "string") return null;
  const s = value.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim();
  return s.length >= 1 && s.length <= max ? s : null;
}

const ID_RE = /^([a-z][a-z0-9-]{1,39}):([A-Za-z0-9][A-Za-z0-9_.-]{0,63}):(followers|paying|content|views|avg_viewers|peak_viewers|hours_streamed|hours_watched|followers_gained)$/;
const PLATFORM_RE = /^[a-z][a-z0-9-]{0,30}$/;
const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

function cleanUrl(value) {
  if (value === undefined || value === null) return { ok: true, url: undefined };
  if (typeof value !== "string" || value.length > 500) return { ok: false };
  try {
    const u = new URL(value);
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) return { ok: false };
    return { ok: true, url: u.toString() };
  } catch { return { ok: false }; }
}

/**
 * Valide un élément reçu d'un module de réseau. Renvoie { ok: true, stat } ou { ok: false, reason }.
 * Une valeur n'est jamais acceptée avec une erreur (« jamais une valeur périmée »), ni sans erreur si elle est absente ou n'est pas un entier borné.
 */
export function validateItem(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "shape" };
  const m = typeof raw.id === "string" ? ID_RE.exec(raw.id) : null;
  if (!m || m[1] === "manual") return { ok: false, reason: "id" };
  if (!AUTO_METRICS.includes(raw.metric) || raw.metric !== m[3]) return { ok: false, reason: "metric" };
  if (typeof raw.platform !== "string" || !PLATFORM_RE.test(raw.platform)) return { ok: false, reason: "platform" };
  const account = clean(raw.account, 120), label = clean(raw.label, 120);
  if (!account || !label) return { ok: false, reason: "text" };
  if (typeof raw.accountKey !== "string" || !KEY_RE.test(raw.accountKey)) return { ok: false, reason: "accountKey" };
  const asOfMs = typeof raw.asOf === "string" && raw.asOf.length <= 40 ? Date.parse(raw.asOf) : NaN;
  if (!Number.isFinite(asOfMs)) return { ok: false, reason: "asOf" };
  const url = cleanUrl(raw.url);
  if (!url.ok) return { ok: false, reason: "url" };
  const stat = { id: raw.id, platform: raw.platform, account, accountKey: raw.accountKey, metric: raw.metric, label, url: url.url, asOfMs };
  if (raw.error !== undefined && raw.error !== null) {
    if (!ERRORS.includes(raw.error)) return { ok: false, reason: "error" };
    return { ok: true, stat: { ...stat, error: raw.error } };
  }
  if (typeof raw.value !== "number" || !Number.isInteger(raw.value) || raw.value < 0 || raw.value > MAX_VALUE) return { ok: false, reason: "value" };
  return { ok: true, stat: { ...stat, value: raw.value } };
}

const strip = (s) => String(s).normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
/** Nom de compte comparable : sans @, sans accents, sans ponctuation. */
export const normalizeName = (s) => strip(s).replace(/^@/, "").replace(/[^a-z0-9]+/g, "");
const ALIASES = { twitter: "x", "x-twitter": "x", xtwitter: "x", insta: "instagram", fb: "facebook", yt: "youtube" };
export function slug(s, max = 30) {
  const base = strip(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/, "");
  if (base) return base;
  let h = 0; for (const ch of String(s)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return `n${h.toString(36)}`;
}
export const platformSlug = (label) => { const s = slug(label, 30); return ALIASES[s] ?? s; };

export const PLATFORM_LABELS = { twitch: "Twitch", youtube: "YouTube", bluesky: "Bluesky", mastodon: "Mastodon", github: "GitHub", discord: "Discord", reddit: "Reddit", tiktok: "TikTok", x: "X", instagram: "Instagram", facebook: "Facebook", threads: "Threads", snapchat: "Snapchat", pinterest: "Pinterest", linkedin: "LinkedIn", telegram: "Telegram", kick: "Kick", kofi: "Ko-fi", patreon: "Patreon", spotify: "Spotify", steam: "Steam", soundcloud: "SoundCloud", bandcamp: "Bandcamp" };
export const platformLabel = (id) => PLATFORM_LABELS[id] ?? (id ? id[0].toUpperCase() + id.slice(1) : "");
/** Nom affiché d'un réseau : celui que la personne a écrit pour un compte manuel, sinon la table. */
export const platformName = (stat) => stat.platformName ?? platformLabel(stat.platform);

export const manualId = (platform, account, metric) => `manual:${platform}:${slug(account, 40)}:${metric}`;
