// Agenda en ligne : les pseudos Twitch des personnes avec qui vous streamez, lus dans la DESCRIPTION d'un événement. Fonctions PURES, sans réseau.
// Convention (même principe que « Jeu : ») : une ligne « Avec : etoile_nord, lune_douce » (ou « With : … » en anglais). Aucun autre texte de la description n'est lu ni gardé :
// seuls les pseudos qui ressemblent à un pseudo Twitch sont retenus, le reste est ignoré sans erreur (un agenda n'est pas un formulaire).
const NOT_TWITCH = new Set(["videos", "directory", "downloads", "settings", "subscriptions", "friends", "wallet", "inventory", "drops", "prime", "turbo", "jobs", "store", "team", "popout", "embed", "moderator", "dashboard", "broadcast", "login", "signup", "search"]);
export const MAX_PARTNERS = 5;
const LOGIN_RE = /^[a-z0-9_]{4,25}$/;

/** « @Pseudo », « twitch.tv/pseudo », « https://www.twitch.tv/Pseudo/ » ou « pseudo » -> « pseudo » (minuscules, 4 à 25 lettres, chiffres ou _), sinon null. Même règle que Contacts. */
export function normalizeLogin(raw) {
  let s = String(raw ?? "").normalize("NFC").replace(/[​-‍﻿]/g, "").trim().replace(/^[<"'«“‘\s]+|[>"'»”’\s]+$/g, "").trim();
  if (!s || s.length > 300) return null;
  const m = /^(?:https?:\/\/)?(?:www\.|m\.)?twitch\.tv\/([^?#\s/]*)/i.exec(s);
  s = (m ? m[1] : s.replace(/^@/, "")).toLowerCase();
  return LOGIN_RE.test(s) && !NOT_TWITCH.has(s) ? s : null;
}

/** Sépare une liste écrite à la main : virgule, point-virgule, retour à la ligne, « + », « & », « et » / « and ». */
export const splitList = (text) => String(text ?? "").slice(0, 1000).split(/[,;\n\r]+|\s+(?:\+|&|et|and)\s+/i).map((x) => x.trim()).filter(Boolean);

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => {
  if (e[0] === "#") { const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1)); return Number.isInteger(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : " "; }
  return ENTITIES[e.toLowerCase()] ?? all;
});
/** Texte brut d'une description : HTML (même échappé), entités et retours à la ligne ramenés à des lignes de texte. */
const plainLines = (description) => decode(decode(String(description ?? "").slice(0, 20_000)))
  .replace(/<\s*(?:br\s*\/?|\/p|\/div|\/li|p|div|li)\b[^>]*>/gi, "\n").replace(/<[^>]*>/g, " ").split(/\r\n|\r|\n|\\n/);
const fold = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Les pseudos Twitch de la description : toutes les lignes « Avec : … » / « With : … » (accents, casse et espace avant les deux-points tolérés), 5 au plus, sans doublon. */
export function extractPartners(description) {
  if (!description) return [];
  const out = [];
  for (const line of plainLines(description)) {
    const m = /^\s*([^:：]{1,12}?)\s*[:：]\s*(.*)$/u.exec(line);
    if (!m || !["avec", "with"].includes(fold(m[1]).trim())) continue;
    for (const part of splitList(m[2])) {
      const login = normalizeLogin(part);
      if (login && !out.includes(login)) out.push(login);
    }
  }
  return out.slice(0, MAX_PARTNERS);
}
