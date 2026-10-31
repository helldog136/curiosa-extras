// L'import depuis Nightbot : lire une liste collée (commandes ET timers), traduire les anciennes écritures `$(…)`, et dire pour chaque ligne si elle est reprise telle quelle,
// adaptée (avec ce qui a changé) ou impossible (avec la raison). Rien n'est écrit ici : ce fichier ne fait que lire et traduire (voir importAdmin.mjs pour l'enregistrement).
// Le format exact du copier-coller du tableau de bord de Nightbot n'est PAS connu : l'analyseur accepte plusieurs formes plausibles (JSON, tableau à tabulations ou à colonnes,
// cellules sur des lignes séparées, une commande par ligne « !nom message ») et une forme de secours : « timer nom | minutes | lignes | message ».
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { checkTemplate, parseRandom } = await import(`./variables.mjs${v}`);
const { evaluate } = await import(`./calc.mjs${v}`);
const { NAME_RE, MAX_DELAY, RESERVED } = await import(`./commands.mjs${v}`);

export const IMPORT_LIMITS = { rows: 200, inputLines: 2000, inputChars: 60_000, lineChars: 600 };
const MAX_MINUTES = 1440;

/* ───────────── Traduire un texte ───────────── */

function closing(src, from) {
  let depth = 1;
  for (let j = from; j < src.length; j++) { if (src[j] === "(") depth++; else if (src[j] === ")" && --depth === 0) return j; }
  return -1;
}
const TWITCH_FIELDS = { game: "jeu", status: "titre", title: "titre", uptimelength: "uptime", uptime: "uptime", viewers: "viewers", followers: "followers" };

function convert(inner, st) {
  const m = /^(\S+)(?:\s+([\s\S]*))?$/.exec(inner.trim());
  if (!m) { st.bad.push("$()"); return ""; }
  const head = m[1].toLowerCase(), raw = m[2] ?? "", arg = () => translate(raw, st).trim();
  const swap = (to) => { st.swaps.push(`$(${head}${raw ? ` ${raw}` : ""}) → ${to}`.slice(0, 80)); return to; };
  if (head === "user" || head === "user.name") return swap("{utilisateur}");
  if (head === "touser") return swap("{cible}");
  if (head === "count") return swap("{compteur}");
  if (head === "query") return swap("{requete}");
  if (head === "querystring") { st.bad.push("$(querystring)"); return ""; }
  if (/^[1-9]$/.test(head)) return swap(`{${head}}`);
  if (/^[1-9]:$/.test(head)) return swap(`{${head}}`);
  if (/^\d+:?$/.test(head)) { st.bad.push(`$(${head})`); return ""; }
  if (head === "channel") return swap("{chaine}");
  if (head === "time") { const a = arg(); return swap(a ? `{heure ${a}}` : "{heure}"); }
  if (head === "twitch") {
    const field = TWITCH_FIELDS[arg().split(/\s+/).pop().toLowerCase()];
    if (!field) { st.bad.push(`$(twitch ${raw.slice(0, 30)})`); return ""; }
    return swap(`{${field}}`);
  }
  if (head === "urlfetch" || head === "customapi") { st.urlfetch = true; return swap(`{urlfetch ${arg()}}`); }
  if (head === "eval") {
    const a = arg();
    try { evaluate(a.replace(/\{[^{}]*\}/g, "1")); } catch { st.bad.push("$(eval) (JavaScript)"); return ""; }
    return swap(`{calcul ${a}}`);
  }
  if (head === "random") { const a = arg(); if (!parseRandom(a.replace(/\{[^{}]*\}/g, "1"))) { st.bad.push("$(random)"); return ""; } return swap(`{aleatoire ${a}}`); }
  st.bad.push(`$(${head})`.slice(0, 40));
  return "";
}
function translate(src, st) {
  let out = "";
  for (let i = 0; i < src.length;) {
    if (src[i] === "$" && src[i + 1] === "(") {
      const j = closing(src, i + 2);
      if (j < 0) { st.bad.push("$("); out += src.slice(i + 2); break; }
      out += convert(src.slice(i + 2, j), st);
      i = j + 1;
    } else if (src[i] === "{" || src[i] === "}") { st.braces = true; out += src[i] === "{" ? "(" : ")"; i++; }
    else out += src[i++];
  }
  return out;
}

/** Un niveau Nightbot en niveau du bot : { role, note? }. « Habitué » n'existe pas ici : abonnés, et la personne en est prévenue. */
export function mapLevel(raw) {
  const x = String(raw ?? "").trim().toLowerCase().replace(/[_\s-]+/g, " ");
  if (!x || x === "everyone" || x === "all" || x === "tout le monde" || x === "tous") return { role: "everyone" };
  if (x === "regular" || x === "regulars" || x === "habitue" || x === "habitué" || x === "habitués") return { role: "subscribers", note: "level_regular" };
  if (/^(twitch )?(subscriber|subscribers|sub|abonne|abonné|abonnes|abonnés)$/.test(x)) return { role: "subscribers" };
  if (/^(moderator|moderators|mod|mods|moderation|modération)$/.test(x)) return { role: "mods" };
  if (/^(owner|broadcaster|streamer|proprietaire|propriétaire)$/.test(x)) return { role: "owner" };
  return { role: "mods", note: "level_unknown", detail: x.slice(0, 20) };
}

/* ───────────── Lire la liste collée ───────────── */

const LEVEL_CELL = /^(everyone|all|regulars?|subscribers?|sub|moderators?|mods?|owner|editor|broadcaster|twitch [a-z ]+|tout le monde|tous|abonn[ée]s?|propri[ée]taire)$/i;
const HEADER = /\b(command|commande|name|nom)\b.*\b(message|response|reponse|réponse)\b/i;
const num = (c) => { const m = /^(\d+)\s*(?:s|sec|secs|seconds?|secondes?|m|min|mins|minutes?)?$/i.exec(String(c ?? "").trim()); return m ? Number(m[1]) : null; };
const minutesOf = (c) => {
  const m = /^(\d+(?:[.,]\d+)?)\s*(h|hr|hrs|hours?|heures?|m|min|mins|minutes?|s|sec|secs|seconds?)?$/i.exec(String(c ?? "").trim());
  if (!m) return null;
  const n = Number(m[1].replace(",", ".")), u = (m[2] ?? "m").toLowerCase();
  return u.startsWith("h") ? Math.round(n * 60) : u.startsWith("s") ? Math.max(1, Math.round(n / 60)) : Math.round(n);
};
const boolOf = (c) => { const x = String(c ?? "").trim().toLowerCase(); return ["enabled", "on", "true", "yes", "oui", "actif", "active"].includes(x) ? true : ["disabled", "off", "false", "no", "non", "inactif"].includes(x) ? false : null; };

function fromJson(raw) {
  let data;
  try { data = JSON.parse(raw); } catch { return null; }
  const rows = [];
  const pick = (o, keys) => { for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k]; return undefined; };
  const eat = (items, timer) => {
    for (const o of Array.isArray(items) ? items : []) {
      if (!o || typeof o !== "object") continue;
      const message = pick(o, ["message", "text", "response", "reply"]);
      const isTimer = timer || pick(o, ["interval", "minutes"]) !== undefined;
      if (isTimer) rows.push({ kind: "timer", name: String(pick(o, ["name", "title"]) ?? ""), message: String(message ?? ""), minutes: minutesOf(pick(o, ["interval", "minutes"])), lines: num(pick(o, ["lines", "chatLines", "chat_lines"])), enabled: pick(o, ["enabled", "active"]) !== false });
      else rows.push({ kind: "command", name: String(pick(o, ["name", "command", "trigger"]) ?? ""), message: String(message ?? ""), level: pick(o, ["userLevel", "userlevel", "level"]), cd: num(pick(o, ["coolDown", "cooldown", "cd"])), count: num(pick(o, ["count", "uses"])) });
    }
  };
  if (Array.isArray(data)) eat(data, false);
  else if (data && typeof data === "object") { eat(data.commands, false); eat(data.timers, true); if (!rows.length) for (const k of Object.keys(data)) if (Array.isArray(data[k])) eat(data[k], /timer/i.test(k)); }
  return rows.length ? rows : null;
}

function commandFromCells(cells) {
  const [name, message, ...rest] = cells;
  let level, cd = null, count = null;
  for (const c of rest) {
    if (level === undefined && LEVEL_CELL.test(c.trim())) { level = c.trim(); continue; }
    const n = num(c);
    if (n !== null) { if (cd === null) cd = n; else if (count === null) count = n; }
  }
  return { kind: "command", name, message: message ?? "", level, cd, count };
}
function timerFromCells(cells) {
  const [name, message, ...rest] = cells;
  let minutes = null, lines = null, enabled = true;
  for (const c of rest) {
    const b = boolOf(c);
    if (b !== null) { enabled = b; continue; }
    if (minutes === null) { const m = minutesOf(c); if (m !== null) { minutes = m; continue; } }
    else if (lines === null) { const n = num(c); if (n !== null) lines = n; }
  }
  return { kind: "timer", name, message: message ?? "", minutes, lines, enabled };
}

/** Lit la liste collée. Rend { rows: [{ kind, name, message, … }], truncated, format } (au plus 200 lignes ; `format` : json | text). */
export function parseNightbot(input) {
  const L = IMPORT_LIMITS;
  let raw = String(input ?? "").replace(/^﻿/, "");
  let truncated = false;
  if (raw.length > L.inputChars) { raw = raw.slice(0, L.inputChars); truncated = true; }
  const trimmed = raw.trim();
  if (/^[[{]/.test(trimmed)) {
    const rows = fromJson(trimmed);
    if (rows) return { rows: rows.slice(0, L.rows), truncated: truncated || rows.length > L.rows, format: "json" };
  }
  let lines = raw.split(/\r?\n/);
  if (lines.length > L.inputLines) { lines = lines.slice(0, L.inputLines); truncated = true; }
  const rows = [];
  let section = "commands", pending = null;
  const flush = () => { if (pending) { rows.push(commandFromCells([pending.name, ...pending.cells])); pending = null; } };
  for (const line0 of lines) {
    const line = line0.slice(0, L.lineChars).replace(/\s+$/, "");
    const text = line.trim();
    if (!text) continue;
    const low = text.toLowerCase().replace(/[:：]$/, "");
    if (/^(default commands?|commandes? par d[ée]faut)$/.test(low)) { flush(); section = "default"; continue; }
    if (/^(timers?|minuteurs?)$/.test(low)) { flush(); section = "timers"; continue; }
    if (/^(custom commands?|commands?|commandes?( personnalis[ée]es?)?)$/.test(low)) { flush(); section = "commands"; continue; }
    if (HEADER.test(text) && !text.startsWith("!")) continue;
    if (section === "default" && text.startsWith("!") === false) continue;
    const t = /^(?:timer|minuteur)\s+([^|]+?)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(.+)$/i.exec(text);
    if (t) { flush(); rows.push({ kind: "timer", name: t[1], message: t[4], minutes: Number(t[2]), lines: Number(t[3]), enabled: true }); continue; }
    const cells = line.includes("\t") ? line.split("\t").map((c) => c.trim()).filter((c, i, a) => c !== "" || i < 2 || a.length <= 2) : /\s{2,}/.test(text) ? text.split(/\s{2,}/).map((c) => c.trim()) : [text];
    if (section === "default") { if (text.startsWith("!") && cells.length < 2) continue; continue; }
    if (section === "timers") { flush(); rows.push(cells.length >= 3 ? timerFromCells(cells) : { kind: "timer", name: cells[0], message: cells[1] ?? "", minutes: null, lines: null, enabled: true }); continue; }
    if (cells.length >= 2 && cells[0].startsWith("!")) { flush(); rows.push(commandFromCells(cells)); continue; }
    if (cells.length === 1 && /^!\S+\s+\S/.test(text)) { flush(); const m = /^(!\S+)\s+([\s\S]+)$/.exec(text); rows.push({ kind: "command", name: m[1], message: m[2], level: undefined, cd: null, count: null }); continue; }
    if (cells.length === 1 && /^!\S+$/.test(text)) { flush(); pending = { name: text, cells: [] }; continue; }
    if (pending) { pending.cells.push(...cells); continue; }
    if (cells.length >= 3 && !cells[0].startsWith("!") && cells.slice(2).some((c) => minutesOf(c) !== null)) { rows.push(timerFromCells(cells)); continue; }
    rows.push({ kind: "unknown", name: "", message: text.slice(0, 120) });
  }
  flush();
  if (rows.length > L.rows) truncated = true;
  return { rows: rows.slice(0, L.rows), truncated, format: "text" };
}

/* ───────────── Une ligne : reprise, adaptée ou impossible ───────────── */

/**
 * Évalue une ligne lue. `conflictOf(kind, name)` rend la commande ou le timer déjà présent sous ce nom (ou null). Rend
 * { status: "same" | "adapted" | "impossible", kind, name, text, role, cdGlobal, count, minutes, lines, enabled, notes: [{ c, d? }], reasons: [{ c, d? }], conflict }.
 */
export function evaluateRow(row, { prefix = "!", conflictOf = () => null } = {}) {
  const notes = [], reasons = [];
  const out = { kind: row.kind, name: "", text: "", role: "everyone", cdGlobal: null, count: null, minutes: null, lines: null, enabled: true, notes, reasons, conflict: null, status: "same" };
  if (row.kind === "unknown") { reasons.push({ c: "unreadable", d: row.message }); out.status = "impossible"; return out; }
  let name = String(row.name ?? "").normalize("NFKC").trim();
  if (row.kind === "command") {
    name = (prefix && name.startsWith(prefix) ? name.slice(prefix.length) : name.replace(/^!/, "")).trim().toLowerCase();
    out.name = name;
    if (!name) reasons.push({ c: "name_empty" });
    else if (/^[/.]/.test(name)) reasons.push({ c: "name_start", d: name.slice(0, 20) });
    else if (!NAME_RE.test(name)) reasons.push({ c: "name_bad", d: name.slice(0, 25) });
    else if (RESERVED.includes(name)) reasons.push({ c: "name_reserved", d: name });
  } else {
    name = name.replace(/\s+/g, " ").slice(0, 80);
    out.name = name;
    if (!name) reasons.push({ c: "name_empty" });
    else if (name.length > 40) reasons.push({ c: "timer_name_long" });
  }
  // Le texte : les `$(…)` sont traduits ; ce qui n'a pas d'équivalent rend la ligne impossible.
  const st = { swaps: [], bad: [], braces: false, urlfetch: false };
  let text = translate(String(row.message ?? ""), st).replace(/\s+/g, " ").trim();
  if (/^\/me\s+/i.test(text)) { text = text.replace(/^\/me\s+/i, ""); notes.push({ c: "me_removed" }); }
  if (st.swaps.length) notes.push({ c: "vars", d: st.swaps.slice(0, 6).join(" ; ") });
  if (st.braces) notes.push({ c: "braces" });
  if (st.urlfetch) notes.push({ c: "urlfetch" });
  for (const b of [...new Set(st.bad)].slice(0, 4)) reasons.push({ c: "var_bad", d: b });
  if (!reasons.length) {
    const ck = checkTemplate(text, row.kind === "timer" ? "timer" : "custom", prefix);
    if (!ck.ok) reasons.push({ c: `text_${ck.code}`, d: ck.vars ? ck.vars.map((x) => `{${x}}`).join(" ") : ck.name });
    else text = ck.text;
  }
  out.text = text;
  if (row.kind === "command") {
    const lv = mapLevel(row.level);
    out.role = lv.role;
    if (lv.note) notes.push({ c: lv.note, d: lv.detail });
    if (row.cd !== null && row.cd !== undefined) { out.cdGlobal = Math.min(row.cd, MAX_DELAY); if (row.cd > MAX_DELAY) notes.push({ c: "cd_clamped" }); }
    out.count = Number.isInteger(row.count) && row.count >= 0 && row.count <= 1_000_000_000 ? row.count : null;
    if (out.count !== null && /\{compteur\}/.test(text) === false) out.count = null;
  } else {
    let minutes = row.minutes;
    if (!Number.isInteger(minutes) || minutes < 1) { if (minutes === null || minutes === undefined) { minutes = 5; notes.push({ c: "interval_default" }); } else { minutes = 1; notes.push({ c: "interval_min" }); } }
    if (minutes > MAX_MINUTES) { minutes = MAX_MINUTES; notes.push({ c: "interval_max" }); }
    out.minutes = minutes;
    out.lines = Number.isInteger(row.lines) && row.lines >= 0 ? Math.min(row.lines, 200) : 5;
    out.enabled = row.enabled !== false;
    notes.push({ c: "timer_lines" });
  }
  if (!reasons.length) out.conflict = conflictOf(row.kind, name);
  out.status = reasons.length ? "impossible" : notes.length ? "adapted" : "same";
  return out;
}
