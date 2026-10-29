// Les réglages, lus avec prudence : la valeur d'un réglage n'est pas garantie (un nombre peut arriver en texte). Chacun est converti, borné, et retombe sur son défaut.
const int = (v, min, max, def) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) && n >= min && n <= max ? n : def; };

/** Les caractères permis pour le préfixe : de la ponctuation, pas de lettre ni de chiffre, jamais « / », « . » ou « \ » (réservés par Twitch). 1 à 3 caractères. */
export function prefixOf(ctx) {
  const v = String(ctx.setting("prefix") ?? "").trim();
  return /^[^\p{L}\p{N}\s/.\\]{1,3}$/u.test(v) ? v : "!";
}
export const validPrefix = (v) => /^[^\p{L}\p{N}\s/.\\]{1,3}$/u.test(String(v ?? "").trim());

/** Les noms de bots connus (en plus de ceux que l'on ajoute) : leurs messages ne déclenchent jamais de commande. */
export const KNOWN_BOTS = ["nightbot", "streamelements", "streamlabs", "moobot", "fossabot", "wizebot", "soundalerts", "commanderroot", "sery_bot", "streamlootsbot", "pretzelrocks", "lurxx", "tangiabot"];

export function settingsOf(ctx) {
  const extra = String(ctx.setting("ignoredBots") ?? "").toLowerCase().split(/[\s,;]+/).map((s) => s.replace(/^@/, "")).filter((s) => /^[a-z0-9_]{2,25}$/.test(s));
  const tz = String(ctx.setting("timezone") ?? "").trim();
  let timeZone = "UTC";
  try { if (tz) { new Intl.DateTimeFormat("en", { timeZone: tz }); timeZone = tz; } } catch { /* fuseau inconnu : UTC */ }
  return {
    prefix: prefixOf(ctx),
    onlyWhenLive: ctx.setting("onlyWhenLive") !== false,
    replyAs: ctx.setting("replyAs") === "bot" ? "bot" : "own",
    channel: String(ctx.setting("channel") ?? "").trim().slice(0, 200),   // l'id d'une instance de Ma Chaîne Twitch (ou un pseudo tapé avant le choix) : voir channel.mjs
    cdGlobal: int(ctx.setting("cooldownGlobal"), 0, 3600, 20),
    cdUser: int(ctx.setting("cooldownUser"), 0, 3600, 60),
    maxPerWindow: int(ctx.setting("maxPer30s"), 1, 18, 12),
    toleranceMin: int(ctx.setting("toleranceMinutes"), 1, 10, 10),
    // Récompenses (points de chaîne) : message de remboursement dans le chat, modérateurs désignés pour !stop, attente maximale d'un résultat, clés d'action ajoutées à la main
    rewardsNotice: ctx.setting("rewardsNotice") === true,
    stopMods: new Set(String(ctx.setting("stopMods") ?? "").toLowerCase().split(/[\s,;]+/).map((x) => x.replace(/^@/, "")).filter((x) => /^[a-z0-9_]{2,25}$/.test(x)).slice(0, 20)),
    rewardWaitSec: int(ctx.setting("rewardWaitSeconds"), 30, 600, 120),
    extraActions: String(ctx.setting("extraActions") ?? "").toLowerCase().split(/[\s,;]+/).filter(Boolean).slice(0, 20),   // ancien réglage : toujours lu (voir actions.mjs)
    showKeys: ctx.setting("showKeys") === true,   // mode avancé : montrer et pouvoir écrire la clé technique des actions
    bots: new Set([...KNOWN_BOTS, ...extra]),
    timeZone,
  };
}
