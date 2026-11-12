// Basic moderation of the texts written by viewers (the message of a resub, of bits, of a reward), applied BEFORE they are shown or read aloud.
// It is BASIC and cannot replace the AutoMod of Twitch itself (switch AutoMod on in your Twitch settings; the fields Twitch sends may already be filtered by it, which we cannot tell).
// Rules: a list of blocked words written by the owner (the default list is EMPTY on purpose: no word is shipped here), links, shouting (capitals) and repeated characters. A text that
// breaks a rule is "flagged": by default the alert still shows WITHOUT the text (and nothing of it is read aloud); the owner may choose to hold the whole alert instead.
// Pure functions, no storage.

export const REASONS = ["word", "link", "caps", "repeat"];
export const LIMITS = { words: 200, word: 40, capsMinLetters: 8, capsRatio: 0.7, repeatChars: 6, repeatWords: 4 };

/** Lower case, no accents, simple "leetspeak" undone (0 1 3 4 5 7 @ $ !), the rest left as it is. */
export function normalise(text) {
  const map = { 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t", "@": "a", $: "s", "!": "i", "|": "i", "€": "e" };
  return String(text ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[013457@$!|€]/g, (c) => map[c]);
}
const letters = (s) => s.replace(/[^a-z]/g, "");

/** The blocked words of a setting: separated by commas, new lines or semicolons, normalised, 200 at most, 2 to 40 characters. */
export function wordsOf(text) {
  const out = [];
  for (const w of String(text ?? "").split(/[\n,;]+/)) {
    const n = letters(normalise(w.trim()));
    if (n.length >= 2 && n.length <= LIMITS.word && !out.includes(n)) out.push(n);
    if (out.length >= LIMITS.words) break;
  }
  return out;
}

/** A link: an address with a scheme, `www.`, or something.tld with a common ending (written out, with letters, so "1.5" and "a.m." are not links). */
export const hasLink = (text) => /(?:https?:\/\/|ftp:\/\/|www\.)\S+/i.test(text) || /\b[a-z0-9-]{2,}(?:\.[a-z0-9-]{2,})*\.(?:com|net|org|io|tv|gg|ly|me|co|fr|be|de|uk|ru|xyz|app|dev|info|live|stream|link|ch|nl|es|it|us|ca)\b/i.test(text);

/**
 * Looks at one text. Returns null (fine) or the reason: "word" | "link" | "caps" | "repeat".
 * `rules`: { words: [normalised words], links, caps, repeats } (each rule can be switched off).
 * Words: a whole word after normalisation, or (for words of 5 letters and more) the same letters even when spread out with dots, spaces or symbols ("b.a.d.w.o.r.d").
 */
export function flag(text, rules = {}) {
  const raw = String(text ?? "");
  if (!raw.trim()) return null;
  if (rules.links !== false && hasLink(raw)) return "link";
  const n = normalise(raw);
  const words = (rules.words ?? []).filter(Boolean);
  if (words.length) {
    const tokens = new Set(n.split(/[^a-z]+/).filter(Boolean));
    const squashed = letters(n);
    for (const w of words) if (tokens.has(w) || (w.length >= 5 && squashed.includes(w))) return "word";
  }
  if (rules.caps !== false) {
    const l = raw.replace(/[^\p{L}]/gu, "");
    if (l.length >= LIMITS.capsMinLetters && (l.match(/\p{Lu}/gu) ?? []).length / l.length >= LIMITS.capsRatio) return "caps";
  }
  if (rules.repeats !== false) {
    if (new RegExp(`(.)\\1{${LIMITS.repeatChars - 1},}`, "u").test(raw)) return "repeat";
    const ws = n.split(/\s+/).filter(Boolean);
    let run = 1;
    for (let i = 1; i < ws.length; i++) { run = ws[i] === ws[i - 1] ? run + 1 : 1; if (run >= LIMITS.repeatWords) return "repeat"; }
  }
  return null;
}

/** A text cut at `max` characters, on a word when possible, with an ellipsis. */
export function cut(text, max) {
  const t = String(text ?? "");
  if (t.length <= max) return t;
  const head = t.slice(0, Math.max(1, max - 1)), sp = head.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? head.slice(0, sp) : head).trimEnd()}…`;
}
