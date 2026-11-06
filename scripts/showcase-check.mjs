#!/usr/bin/env node
// Checks the showcase (showcase/): one entry per module, with its texts in English and French, its screenshots and its sources. Fails when:
//   - a module of modules/ has no entry (unless listed in showcase/pending.json), or an entry has no module;
//   - an entry points to a missing file, screenshot or module, or lists no `sources`;
//   - EN and FR do not match (same headings, images, links, {placeholders});
//   - a summary is longer than 160 characters or an alt text longer than 125;
//   - a text contains a word of the ergonomics kit's R9 list (tests/helpers/ergonomics.mjs), an exclamation mark,
//     a sentence of more than 20 words, or (in French) a "tu" form;
//   - a screenshot is not a WebP, is over 80 KB, or is not 1280 px wide (390 px for a mobile shot), or a file of shots/ is not listed;
//   - the `since` version is newer than the module's version, or `requires` does not match the module's own requirements;
//   - showcase/index.json is not what the entries produce.
// `screenshots` may be an empty list (an entry can wait for its pictures); every listed picture is checked.
//   node scripts/showcase-check.mjs            check (exit 1 on any problem)
//   node scripts/showcase-check.mjs --write    rewrite showcase/index.json from the entries, then check
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { FORBIDDEN_WORDS, SENTENCE_MAX_WORDS } from "../tests/helpers/ergonomics.mjs";

export const LIMITS = { summary: 160, alt: 125, shotBytes: 80 * 1024, desktopWidth: 1280, mobileWidth: 390, sentenceWords: SENTENCE_MAX_WORDS };
export const LANGS = ["en", "fr"];
export const STATUSES = ["stable", "beta", "deprecated"];
export const KINDS = ["admin", "public", "mobile", "overlay"];
const HEADINGS = { en: ["What it does", "Why you will like it", "How it looks", "Works well with", "Good to know"], fr: ["Ce que ça fait", "Pourquoi vous allez l'aimer", "À quoi ça ressemble", "Ça marche bien avec", "Bon à savoir"] };

const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const FORBIDDEN = new Set(FORBIDDEN_WORDS.map(norm));
const cmpVersion = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0); return 0; };
const isVersion = (v) => typeof v === "string" && /^\d+\.\d+\.\d+$/.test(v);
const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));

/** Size of a WebP file (lossy, lossless or extended), or null when the bytes are not a WebP. */
export function webpSize(b) {
  if (b.length < 30 || b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WEBP") return null;
  const t = b.toString("ascii", 12, 16);
  if (t === "VP8 ") return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  if (t === "VP8L") { const v = b.readUInt32LE(21); return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 }; }
  if (t === "VP8X") return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
  return null;
}

/** Plain text of a Markdown body: link addresses and image placeholders removed, so only the words a reader sees remain. */
export function visibleText(md) {
  return md.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`#>]/g, "").replace(/^\s*-\s+/gm, "");
}
export function forbiddenIn(text) {
  const hit = new Set();
  for (const w of norm(text).split(/[^a-z0-9']+/)) if (w && FORBIDDEN.has(w)) hit.add(w);
  return [...hit];
}
export function longSentences(text, max = LIMITS.sentenceWords) {
  const out = [];
  for (const line of text.split("\n")) for (const s of line.split(/(?<=[.?!;])\s+/)) { const words = s.trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)); if (words.length > max) out.push(`${words.length} words: “${s.trim().slice(0, 70)}…”`); }
  return out;
}
const FR_TU = /(?<![\p{L}])(?:tu|ton|ta|tes|toi)(?![\p{L}'])|(?<![\p{L}])t'(?=\p{L})/iu;

/** Structure of a body, compared between languages: headings, image placeholders (in order), entry links (in order), {placeholders}. */
export function shape(md) {
  return {
    headings: [...md.matchAll(/^## (.+)$/gm)].length,
    images: [...md.matchAll(/!\[[^\]]*\]\(shot:([^)]+)\)/g)].map((m) => m[1]),
    links: [...md.matchAll(/(?<!!)\[[^\]]*\]\(entry:([^)]+)\)/g)].map((m) => m[1]),
    vars: [...md.matchAll(/\{[A-Za-z0-9_]+\}/g)].map((m) => m[0]).sort(),
  };
}

/** @returns {{ problems: string[], warnings: string[], entries: string[], index: object }} */
export function checkShowcase(root, { write = false } = {}) {
  const problems = [], warnings = [];
  const bad = (id, msg) => problems.push(`${id}: ${msg}`);
  const dir = path.join(root, "showcase");
  const modDir = path.join(root, "modules");
  const modules = fs.readdirSync(modDir).filter((d) => fs.existsSync(path.join(modDir, d, "module.json"))).sort();
  const manifests = Object.fromEntries(modules.map((id) => [id, readJson(path.join(modDir, id, "module.json"))]));
  const offers = {}; for (const id of modules) for (const o of manifests[id].offers ?? []) offers[o.service] = id;
  const pendingFile = path.join(dir, "pending.json");
  const pending = fs.existsSync(pendingFile) ? readJson(pendingFile).modules ?? [] : [];
  const entriesDir = path.join(dir, "modules");
  const present = fs.existsSync(entriesDir) ? fs.readdirSync(entriesDir).filter((d) => fs.statSync(path.join(entriesDir, d)).isDirectory()).sort() : [];

  for (const id of present) if (!modules.includes(id)) bad(id, "an entry exists but there is no module of that id in modules/");
  for (const id of modules) {
    if (present.includes(id)) { if (pending.includes(id)) bad(id, "listed in showcase/pending.json but it has an entry: remove it from the list"); continue; }
    if (!pending.includes(id)) bad(id, "no showcase entry: create showcase/modules/" + id + "/ (see showcase/README.md)");
  }
  for (const id of pending) if (!modules.includes(id)) bad(id, "listed in showcase/pending.json but there is no such module");

  let categories = [];
  const indexFile = path.join(dir, "index.json");
  const catFile = path.join(dir, "categories.json");
  if (!fs.existsSync(catFile)) bad("showcase", "categories.json is missing");
  else {
    categories = readJson(catFile);
    for (const c of categories) for (const l of LANGS) if (!c.name?.[l] || !c.blurb?.[l]) bad("categories.json", `category ${c.id}: name and blurb are needed in ${l}`);
  }
  const catIds = categories.map((c) => c.id);
  const entries = [];

  for (const id of present.filter((x) => modules.includes(x))) {
    const base = path.join(entriesDir, id);
    const m = manifests[id];
    const jf = path.join(base, "entry.json");
    if (!fs.existsSync(jf)) { bad(id, "entry.json is missing"); continue; }
    let e; try { e = readJson(jf); } catch (err) { bad(id, `entry.json is not valid JSON (${err.message})`); continue; }
    entries.push(e);
    if (e.id !== id) bad(id, `entry.json says id "${e.id}"`);
    if (!catIds.includes(e.category)) bad(id, `category "${e.category}" is not in categories.json (${catIds.join(", ")})`);
    if (!Array.isArray(e.tags) || !e.tags.length || e.tags.some((t) => typeof t !== "string" || !t)) bad(id, "tags must be a non-empty list of words");
    if (!Number.isInteger(e.order)) bad(id, "order must be an integer");
    if (!STATUSES.includes(e.status)) bad(id, `status must be one of ${STATUSES.join(", ")}`);
    for (const f of ["title", "summary", "pitch"]) for (const l of LANGS) if (typeof e[f]?.[l] !== "string" || !e[f][l].trim()) bad(id, `${f}.${l} is missing`);
    for (const l of LANGS) {
      if ((e.summary?.[l] ?? "").length > LIMITS.summary) bad(id, `summary.${l} is ${e.summary[l].length} characters (160 at most)`);
      if ((e.pitch?.[l] ?? "").length > LIMITS.summary) bad(id, `pitch.${l} is ${e.pitch[l].length} characters (160 at most)`);
    }
    if (!isVersion(e.since)) bad(id, "since must be a version such as 1.0.0");
    else if (isVersion(m.version) && cmpVersion(e.since, m.version) > 0) bad(id, `since ${e.since} is newer than the module's version ${m.version}`);
    if (e.moduleVersion !== undefined && e.moduleVersion !== m.version) warnings.push(`${id}: entry written for version ${e.moduleVersion}, the module is now ${m.version}: re-read the entry`);
    const wantReq = [...new Set((m.requires ?? []).filter((r) => !r.optional).map((r) => r.module ?? offers[r.service]).filter(Boolean))].sort();
    if (JSON.stringify([...(e.requires ?? [])].sort()) !== JSON.stringify(wantReq)) bad(id, `requires is ${JSON.stringify(e.requires)} but the module needs ${JSON.stringify(wantReq)}`);
    for (const r of [...(e.requires ?? []), ...(e.worksWith ?? [])]) if (!modules.includes(r)) bad(id, `"${r}" (requires/worksWith) is not a module`);
    if (!Array.isArray(e.sources) || !e.sources.length) bad(id, "sources is missing: list the files the entry is based on");
    else { if (!e.sources.includes(`modules/${id}/module.json`)) bad(id, "sources must include the module's module.json"); for (const s of e.sources) if (!fs.existsSync(path.join(root, s))) bad(id, `source "${s}" does not exist`); }

    // screenshots (an empty list is allowed: the entry waits for its pictures)
    const shotsDir = path.join(base, "shots");
    const listed = new Set();
    if (!Array.isArray(e.screenshots)) bad(id, "screenshots must be a list (empty until the pictures exist)");
    for (const s of e.screenshots ?? []) {
      listed.add(s.file);
      if (!KINDS.includes(s.kind)) bad(id, `screenshot ${s.file}: kind must be one of ${KINDS.join(", ")}`);
      for (const l of LANGS) {
        if (!s.alt?.[l]) bad(id, `screenshot ${s.file}: alt.${l} is missing`); else if (s.alt[l].length > LIMITS.alt) bad(id, `screenshot ${s.file}: alt.${l} is ${s.alt[l].length} characters (125 at most)`);
        if (!s.caption?.[l]) bad(id, `screenshot ${s.file}: caption.${l} is missing`);
      }
      const f = path.join(shotsDir, s.file ?? "");
      if (!s.file || !fs.existsSync(f)) { bad(id, `screenshot ${s.file}: file not found in shots/`); continue; }
      const b = fs.readFileSync(f);
      const size = webpSize(b);
      if (!size) { bad(id, `screenshot ${s.file}: not a WebP file`); continue; }
      if (b.length > LIMITS.shotBytes) bad(id, `screenshot ${s.file}: ${b.length} bytes (80 KB = ${LIMITS.shotBytes} at most)`);
      const want = s.kind === "mobile" ? LIMITS.mobileWidth : LIMITS.desktopWidth;
      if (size.width !== want) bad(id, `screenshot ${s.file}: ${size.width} px wide, ${want} expected for a ${s.kind} shot`);
    }
    if (fs.existsSync(shotsDir)) for (const f of fs.readdirSync(shotsDir)) if (!listed.has(f)) bad(id, `shots/${f} is not listed in entry.json`);
    if (!(e.screenshots ?? []).length) warnings.push(`${id}: no screenshot yet`);

    // texts
    const bodies = {};
    for (const l of LANGS) {
      const f = path.join(base, `entry.${l}.md`);
      if (!fs.existsSync(f)) { bad(id, `entry.${l}.md is missing`); continue; }
      bodies[l] = fs.readFileSync(f, "utf8");
    }
    for (const l of LANGS) {
      const texts = [["title", e.title?.[l]], ["summary", e.summary?.[l]], ["pitch", e.pitch?.[l]], ...(e.screenshots ?? []).flatMap((s) => [[`alt of ${s.file}`, s.alt?.[l]], [`caption of ${s.file}`, s.caption?.[l]]]), ...(bodies[l] ? [["body", visibleText(bodies[l])]] : [])];
      for (const [what, t] of texts) {
        if (!t) continue;
        if (t.includes("!")) bad(id, `${l} ${what}: no exclamation mark`);
        const w = forbiddenIn(t); if (w.length) bad(id, `${l} ${what}: word(s) of the jargon list: ${w.join(", ")}`);
        for (const s of longSentences(t)) bad(id, `${l} ${what}: sentence of ${s}`);
        if (l === "fr" && FR_TU.test(t)) bad(id, `fr ${what}: use "vous", not "tu"`);
        if (/\bVeuillez\b/i.test(t)) bad(id, `${l} ${what}: no "Veuillez"`);
      }
    }
    if (bodies.en && bodies.fr) {
      const a = shape(bodies.en), b = shape(bodies.fr);
      for (const k of ["headings", "images", "links", "vars"]) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) bad(id, `EN and FR differ in ${k}: ${JSON.stringify(a[k])} / ${JSON.stringify(b[k])}`);
      for (const l of LANGS) {
        const sh = shape(bodies[l]);
        for (const f of sh.images) if (!listed.has(f)) bad(id, `${l} body uses ![](shot:${f}) which is not in entry.json`);
        for (const f of listed) if (!sh.images.includes(f)) bad(id, `${l} body does not show the screenshot ${f}`);
        for (const t of sh.links) if (!modules.includes(t)) bad(id, `${l} body links to (entry:${t}) which is not a module`);
        const heads = [...bodies[l].matchAll(/^## (.+)$/gm)].map((x) => x[1]);
        for (const h of HEADINGS[l].filter((x, i) => i !== 2 || sh.images.length)) if (!heads.includes(h) && !(h === HEADINGS[l][3] && !sh.links.length)) bad(id, `${l} body has no "## ${h}" section`);
        if (!heads.some((h) => /^(Since version|Depuis la version) \d/.test(h))) bad(id, `${l} body has no "Since version" section`);
      }
    }
  }

  const index = {
    categories: categories.map((c) => ({ id: c.id, name: c.name, blurb: c.blurb })),
    modules: entries.slice().sort((x, y) => catIds.indexOf(x.category) - catIds.indexOf(y.category) || x.order - y.order || x.id.localeCompare(y.id)).map((e) => ({ id: e.id, category: e.category, order: e.order, title: e.title, pitch: e.pitch, tags: e.tags, shots: (e.screenshots ?? []).length })),
  };
  const json = JSON.stringify(index, null, 2) + "\n";
  if (write) fs.writeFileSync(indexFile, json);
  else if (!fs.existsSync(indexFile) || fs.readFileSync(indexFile, "utf8") !== json) bad("showcase", "index.json is not up to date: run node scripts/showcase-check.mjs --write");
  return { problems, warnings, entries: entries.map((e) => e.id), index };
}

export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const r = checkShowcase(root, { write: process.argv.includes("--write") });
  for (const w of r.warnings) console.warn(`warning: ${w}`);
  if (r.problems.length) { for (const p of r.problems) console.error(`✖ ${p}`); console.error(`\n${r.problems.length} problem(s) in the showcase.`); process.exit(1); }
  console.log(`Showcase: ${r.entries.length} entries, all good${r.warnings.length ? ` (${r.warnings.length} warning(s))` : ""}.`);
}
