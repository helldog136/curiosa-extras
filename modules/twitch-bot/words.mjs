// Word triggers: the bot answers (and/or shows a media on stream) when a chat message CONTAINS a word, without any "!" (the classic: "quoi" gets "Feur").
// Matching is deliberately simple: the message and the words are folded (no accents, no capitals, punctuation and links ignored); by default a word must be a WHOLE word of the message.
//   "quoi", "QUOI", "Quoi ?!", "quoi," and "tu dis quoi ?" match "quoi"; "quoicoubeh", "quoiii" and "pourquoi" do NOT (only the optional "inside words" mode would match the first and the last).
// This file is pure (matching, the saved shape, checks, saving); the decision to answer (guards, delays, valve, chance) is in engine.mjs.
const v = new URL(import.meta.url).search; // the version of the module spreads to the neighbour files
const C = await import(`./commands.mjs${v}`);
const { checkTemplate } = await import(`./variables.mjs${v}`);
const M = await import(`./media.mjs${v}`);

export const MAX_WORDS = 50, MAX_PER_TRIGGER = 5, MAX_TOKENS = 4, MAX_LENGTH = 40, MAX_CHANCE = 20;
export const DEFAULTS = { cdGlobal: 30, cdUser: 60 };
export const MODES = ["whole", "contains"];
const WORD_RE = /^[\p{L}\p{N}][\p{L}\p{N} '’-]*$/u;

/** Folds a text: no accents, no capitals, apostrophes and dashes as spaces. */
export const fold = (x) => String(x ?? "").normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase();
/** The words of a text, folded, links removed (a link never triggers a word). */
export function tokens(text) {
  return fold(String(text ?? "").slice(0, 600).replace(/\b(?:https?:\/\/|www\.)\S+/gi, " ")).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}
/** The message prepared once for every trigger. */
export const prepare = (text) => { const t = tokens(text); return { t, joined: ` ${t.join(" ")} ` }; };

/** Does the message match this trigger? `w`: { words: [...], mode }. */
export function matches(w, msg) {
  for (const word of w.words) {
    const wt = tokens(word);
    if (!wt.length) continue;
    if (w.mode === "contains") { if (msg.joined.includes(wt.join(" "))) return true; continue; }
    for (let i = 0; i + wt.length <= msg.t.length; i++) if (wt.every((x, j) => msg.t[i + j] === x)) return true;
  }
  return false;
}

/** The words typed in a form ("quoi, koi") → { words } or { error: { code, value } }. */
export function parseWords(input) {
  const raw = Array.isArray(input) ? input : String(input ?? "").split(/[,;\n]+/);
  const out = [], seen = new Set();
  for (const r of raw) {
    const w = String(r ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
    if (!w) continue;
    const k = tokens(w).join(" ");
    if (w.length > MAX_LENGTH || !WORD_RE.test(w) || !k || tokens(w).length > MAX_TOKENS) return { error: { code: "word_bad", value: w.slice(0, 40) } };
    if (!seen.has(k)) { seen.add(k); out.push(w); }
  }
  if (!out.length) return { error: { code: "words_empty" } };
  return out.length > MAX_PER_TRIGGER ? { error: { code: "words_many" } } : { words: out };
}

const rec = (x) => (x && typeof x === "object" && !Array.isArray(x) ? x : {});
const small = (x) => (Number.isInteger(x) && x >= 0 && x <= C.MAX_DELAY ? x : null);

/** The triggers as the bot and the pages use them. Each: { key, kind: "word", id, name (first word), words, mode, text, role, cdGlobal, cdUser, chance, collab, media, enabled, state }. */
export function wordCatalog(cfg) {
  return (Array.isArray(cfg.words) ? cfg.words : []).filter((w) => w && typeof w.id === "string" && Array.isArray(w.words) && w.words.length).map((w) => ({
    key: `word:${w.id}`, kind: "word", id: w.id, label: w.words[0], name: w.words[0], aliases: [], words: w.words.map(String).slice(0, MAX_PER_TRIGGER), mode: w.mode === "contains" ? "contains" : "whole",
    text: String(w.text ?? ""), role: C.ROLES.includes(w.role) ? w.role : "everyone", cdGlobal: small(w.cdGlobal), cdUser: small(w.cdUser),
    chance: Number.isInteger(w.chance) && w.chance >= 2 && w.chance <= MAX_CHANCE ? w.chance : 1, collab: w.collab === true, media: M.readMedia(w.media), enabled: w.enabled !== false,
    state: w.enabled !== false ? "on" : "off", why: null, vars: {},
  }));
}

const errorOf = (code, extra = {}) => ({ ok: false, code, ...extra });

/**
 * Creates (no `ref.id`) or changes a trigger. `f`: { enabled?, words?, mode?, text?, role?, cdGlobal?, cdUser?, chance?, collab?, media? } (only the given fields change).
 * `env`: { prefix, t, library?: async () => lib } (the library is only asked when a media is given). Rends { ok: true, key } or { ok: false, code, … }.
 */
export async function saveWord(ctx, ref, f, env) {
  const prefix = env.prefix ?? "!";
  return C.mutate(ctx, async (cfg) => {
    const all = wordCatalog(cfg), creating = !ref.id;
    const cur = creating ? null : all.find((w) => w.id === ref.id);
    if (!creating && !cur) return errorOf("unknown");
    if (creating && all.length >= MAX_WORDS) return errorOf("too_many_words");
    const d = { enabled: cur?.enabled ?? true, words: cur?.words ?? [], mode: cur?.mode ?? "whole", text: cur?.text ?? "", role: cur?.role ?? "everyone", cdGlobal: cur?.cdGlobal ?? null, cdUser: cur?.cdUser ?? null, chance: cur?.chance ?? 1, collab: cur?.collab ?? false, media: cur?.media ?? null };
    if (f.enabled !== undefined) d.enabled = f.enabled === true;
    if (f.words !== undefined) { const p = parseWords(f.words); if (p.error) return errorOf(p.error.code, p.error); d.words = p.words; }
    if (!d.words.length) return errorOf("words_empty");
    if (f.mode !== undefined) { if (!MODES.includes(f.mode)) return errorOf("mode"); d.mode = f.mode; }
    if (f.role !== undefined) { if (!C.ROLES.includes(f.role)) return errorOf("role"); d.role = f.role; }
    for (const k of ["cdGlobal", "cdUser"]) if (f[k] !== undefined) { const p = C.parseDelay(f[k]); if (p.error) return errorOf("delay", { field: k }); d[k] = p.value; }
    if (f.chance !== undefined) {
      const raw = f.chance === null || String(f.chance).trim() === "" ? 1 : Number(f.chance);
      if (!Number.isInteger(raw) || raw < 1 || raw > MAX_CHANCE) return errorOf("chance");
      d.chance = raw;
    }
    if (f.collab !== undefined) d.collab = f.collab === true;
    if (f.text !== undefined) d.text = String(f.text ?? "").trim();
    if (d.text) { const ok = checkTemplate(d.text, "word", prefix); if (!ok.ok) return errorOf(`text_${ok.code}`, { vars: ok.vars, allowed: ok.allowed, name: ok.name }); d.text = ok.text; }
    if (f.media !== undefined) {
      const m = M.checkMedia(f.media, f.media === null ? { available: true, items: [] } : await (env.library?.() ?? M.library(ctx)));
      if (!m.ok) return errorOf(m.code, { field: m.field });
      d.media = m.value;
    }
    if (!d.text && !d.media) return errorOf("reply_or_media");
    // The same word in two triggers would make the answer depend on the order: refused.
    const mine = new Set(d.words.map((w) => tokens(w).join(" ")));
    for (const o of all) if (o.id !== cur?.id) for (const w of o.words) if (mine.has(tokens(w).join(" "))) return errorOf("word_taken", { word: w, with: o.words[0] });
    const id = cur?.id ?? `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const entry = { id, enabled: d.enabled, words: d.words, mode: d.mode, text: d.text, role: d.role, cdGlobal: d.cdGlobal, cdUser: d.cdUser, ...(d.chance > 1 ? { chance: d.chance } : {}), ...(d.collab ? { collab: true } : {}), ...(d.media ? { media: d.media } : {}) };
    const words = Array.isArray(cfg.words) ? cfg.words : [];
    cfg.words = creating ? [...words, entry] : words.map((w) => (w.id === id ? entry : w));
    return { ok: true, key: `word:${id}` };
  });
}

export async function removeWord(ctx, id) {
  return C.mutate(ctx, (cfg) => { const before = (cfg.words ?? []).length; cfg.words = (cfg.words ?? []).filter((w) => w.id !== id); return before === cfg.words.length ? errorOf("unknown") : { ok: true }; });
}

/** The two examples of "Add an example": the classic, and a greeting (both can be changed or deleted). */
export const examples = (t) => [
  { words: ["quoi"], text: t("word_ex1_text"), enabled: true },
  { words: ["bonjour", "salut", "coucou"], text: t("word_ex2_text"), enabled: true, role: "everyone", cdUser: 600 },
];
