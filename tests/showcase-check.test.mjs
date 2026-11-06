// The showcase check (scripts/showcase-check.mjs): every rule fails on a bad entry, and the real showcase of this repository passes.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTempDir } from "./helpers/tmp.mjs";
import { checkShowcase, webpSize, forbiddenIn, longSentences, shape, visibleText, LIMITS } from "../scripts/showcase-check.mjs";
import { buildBundle, rawBase } from "../scripts/showcase-bundle.mjs";

const repo = new URL("..", import.meta.url).pathname;
/** A file that looks like a WebP of the given size (only the header is read by the check). */
function fakeWebp(width, height = 800, bytes = 4000) {
  const b = Buffer.alloc(bytes);
  b.write("RIFF", 0, "ascii"); b.writeUInt32LE(bytes - 8, 4); b.write("WEBPVP8X", 8, "ascii"); b.writeUInt32LE(10, 16);
  const w = width - 1, h = height - 1;
  b[24] = w & 255; b[25] = (w >> 8) & 255; b[26] = (w >> 16) & 255; b[27] = h & 255; b[28] = (h >> 8) & 255; b[29] = (h >> 16) & 255;
  return b;
}
const SHOT = { file: "admin.webp", kind: "admin", alt: { en: "Admin page of Demo", fr: "Page d'administration de Démo" }, caption: { en: "In the admin.", fr: "Dans l'administration." } };
const BODY = {
  en: (o, img) => `## What it does\n\nShows a poll.\n\n- Vote in one click.\n\n## Why you will like it\n\n- It is quick.\n\n${img ? "## How it looks\n\n![Admin page](shot:admin.webp)\n*In the admin.*\n\n" : ""}## Works well with\n\n- [Other](entry:${o})\n\n## Good to know\n\n- Nothing to set up.\n\n## Since version 1.0.0\n\nAvailable since version 1.0.0. Current version: 1.2.0.\n`,
  fr: (o, img) => `## Ce que ça fait\n\nMontre un sondage.\n\n- Votez en un clic.\n\n## Pourquoi vous allez l'aimer\n\n- C'est rapide.\n\n${img ? "## À quoi ça ressemble\n\n![Page d'administration](shot:admin.webp)\n*Dans l'administration.*\n\n" : ""}## Ça marche bien avec\n\n- [Autre](entry:${o})\n\n## Bon à savoir\n\n- Rien à régler.\n\n## Depuis la version 1.0.0\n\nDisponible depuis la version 1.0.0. Version actuelle : 1.2.0.\n`,
};
const entryFor = (id, withShot) => ({ id, category: "content", tags: ["demo"], order: 10, title: { en: "Demo", fr: "Démo" }, summary: { en: "A demo module.", fr: "Un module de démonstration." }, pitch: { en: "A demo module.", fr: "Un module de démonstration." },
  since: "1.0.0", moduleVersion: "1.2.0", requires: [], worksWith: [], status: "stable", sources: [`modules/${id}/module.json`], screenshots: withShot ? [SHOT] : [] });

/** A tiny repository with two modules and a complete showcase; `tweak(root)` breaks something. `withShot`: entries have a screenshot. */
function repoWith(t, tweak, withShot = true) {
  const root = makeTempDir("showcase-", { t });
  for (const id of ["demo", "other"]) {
    fs.mkdirSync(path.join(root, "modules", id), { recursive: true });
    fs.writeFileSync(path.join(root, "modules", id, "module.json"), JSON.stringify({ id, version: "1.2.0", name: { en: id, fr: id } }));
    const dir = path.join(root, "showcase/modules", id);
    fs.mkdirSync(path.join(dir, "shots"), { recursive: true });
    const o = id === "demo" ? "other" : "demo";
    fs.writeFileSync(path.join(dir, "entry.json"), JSON.stringify(entryFor(id, withShot)));
    fs.writeFileSync(path.join(dir, "entry.en.md"), BODY.en(o, withShot)); fs.writeFileSync(path.join(dir, "entry.fr.md"), BODY.fr(o, withShot));
    if (withShot) fs.writeFileSync(path.join(dir, "shots/admin.webp"), fakeWebp(1280));
  }
  fs.writeFileSync(path.join(root, "showcase/categories.json"), JSON.stringify([{ id: "content", name: { en: "Content", fr: "Contenu" }, blurb: { en: "Pages.", fr: "Pages." } }]));
  checkShowcase(root, { write: true });
  tweak?.(root);
  return root;
}
const edit = (root, id, f, fn) => { const p = path.join(root, "showcase/modules", id, f); fs.writeFileSync(p, fn(fs.readFileSync(p, "utf8"))); };
const editJson = (root, id, fn) => { const p = path.join(root, "showcase/modules", id, "entry.json"); const e = JSON.parse(fs.readFileSync(p, "utf8")); fn(e); fs.writeFileSync(p, JSON.stringify(e)); };
const problems = (root) => checkShowcase(root).problems;
const has = (list, text) => assert.ok(list.some((p) => p.includes(text)), `expected a problem mentioning "${text}", got:\n${list.join("\n")}`);

test("a complete showcase passes, with or without screenshots", (t) => { assert.deepEqual(problems(repoWith(t)), []); assert.deepEqual(problems(repoWith(t, null, false)), []); });

test("a module without an entry fails, unless it is listed as pending", (t) => {
  const root = repoWith(t, (r) => fs.rmSync(path.join(r, "showcase/modules/other"), { recursive: true }));
  has(problems(root), "other: no showcase entry");
  fs.writeFileSync(path.join(root, "showcase/pending.json"), JSON.stringify({ modules: ["other"] }));
  checkShowcase(root, { write: true });
  assert.deepEqual(problems(root), []);
  fs.writeFileSync(path.join(root, "showcase/pending.json"), JSON.stringify({ modules: ["other", "ghost"] }));
  has(problems(root), "ghost: listed in showcase/pending.json but there is no such module");
});

test("an entry without a module, and a pending module that has an entry, fail", (t) => {
  const root = repoWith(t, (r) => fs.cpSync(path.join(r, "showcase/modules/demo"), path.join(r, "showcase/modules/ghost"), { recursive: true }));
  has(problems(root), "ghost: an entry exists but there is no module");
  fs.writeFileSync(path.join(root, "showcase/pending.json"), JSON.stringify({ modules: ["demo"] }));
  has(problems(root), "demo: listed in showcase/pending.json but it has an entry");
});

test("a missing screenshot file, an unlisted one and a missing alt fail", (t) => {
  const root = repoWith(t, (r) => { fs.rmSync(path.join(r, "showcase/modules/demo/shots/admin.webp")); fs.writeFileSync(path.join(r, "showcase/modules/other/shots/extra.webp"), fakeWebp(1280)); editJson(r, "other", (e) => { delete e.screenshots[0].alt.fr; }); });
  const p = problems(root);
  has(p, "demo: screenshot admin.webp: file not found"); has(p, "other: shots/extra.webp is not listed"); has(p, "other: screenshot admin.webp: alt.fr is missing");
});

test("screenshots: over 80 KB, not a WebP, wrong width", (t) => {
  const root = repoWith(t, (r) => {
    fs.writeFileSync(path.join(r, "showcase/modules/demo/shots/admin.webp"), fakeWebp(1280, 800, LIMITS.shotBytes + 1));
    fs.writeFileSync(path.join(r, "showcase/modules/other/shots/admin.webp"), Buffer.from("not an image at all, just text, long enough to be read as a header ......."));
  });
  has(problems(root), "demo: screenshot admin.webp: 81921 bytes"); has(problems(root), "other: screenshot admin.webp: not a WebP");
  fs.writeFileSync(path.join(root, "showcase/modules/other/shots/admin.webp"), fakeWebp(1000));
  has(problems(root), "1000 px wide, 1280 expected");
  editJson(root, "other", (e) => { e.screenshots[0].kind = "mobile"; });
  has(problems(root), "1000 px wide, 390 expected for a mobile shot");
});

test("summary and alt length limits", (t) => {
  const root = repoWith(t, (r) => editJson(r, "demo", (e) => { e.summary.en = "x".repeat(161); e.screenshots[0].alt.en = "y".repeat(126); }));
  has(problems(root), "summary.en is 161 characters"); has(problems(root), "alt.en is 126 characters");
});

test("EN and FR must match: headings, images, links", (t) => {
  const root = repoWith(t, (r) => edit(r, "demo", "entry.fr.md", (s) => s.replace("- [Autre](entry:other)\n", "").replace(/## Ça marche bien avec\n\n/, "")));
  has(problems(root), "EN and FR differ in headings"); has(problems(root), "EN and FR differ in links");
  const root2 = repoWith(t, (r) => edit(r, "demo", "entry.fr.md", (s) => s.replace("![Page d'administration](shot:admin.webp)\n*Dans l'administration.*\n\n", "")));
  has(problems(root2), "EN and FR differ in images"); has(problems(root2), "fr body does not show the screenshot admin.webp");
});

test("a link or an image that points nowhere fails", (t) => {
  const root = repoWith(t, (r) => { for (const l of ["en", "fr"]) edit(r, "demo", `entry.${l}.md`, (s) => s.replace("shot:admin.webp", "shot:nope.webp").replace("entry:other", "entry:ghost")); });
  has(problems(root), "uses ![](shot:nope.webp) which is not in entry.json"); has(problems(root), "links to (entry:ghost) which is not a module");
});

test("jargon words, exclamation marks, long sentences and tu forms fail", (t) => {
  const root = repoWith(t, (r) => {
    edit(r, "demo", "entry.en.md", (s) => s.replace("- It is quick.", "- Paste your API key now! This sentence is deliberately far too long because it keeps going on and on without ever reaching a full stop at all."));
    edit(r, "demo", "entry.fr.md", (s) => s.replace("- C'est rapide.", "- Colle ton identifiant ici."));
    editJson(r, "other", (e) => { e.summary.en = "Works with the service."; });
  });
  const p = problems(root);
  has(p, "demo: en body: word(s) of the jargon list: api, key"); has(p, "demo: en body: no exclamation mark"); has(p, "demo: en body: sentence of 2");
  has(p, 'demo: fr body: use "vous", not "tu"'); has(p, "demo: fr body: word(s) of the jargon list: identifiant"); has(p, "other: en summary: word(s) of the jargon list: service");
});

test("since newer than the module, requires that does not match, missing sources fail", (t) => {
  const root = repoWith(t, (r) => { editJson(r, "demo", (e) => { e.since = "9.0.0"; e.requires = ["other"]; e.sources = []; }); editJson(r, "other", (e) => { e.sources = ["modules/other/module.json", "modules/other/NOPE.md"]; }); });
  const p = problems(root);
  has(p, "demo: since 9.0.0 is newer than the module's version 1.2.0"); has(p, 'demo: requires is ["other"] but the module needs []'); has(p, "demo: sources is missing"); has(p, 'other: source "modules/other/NOPE.md" does not exist');
});

test("requires follows the module: a needed service is resolved to the module that offers it", (t) => {
  const root = repoWith(t, (r) => {
    fs.writeFileSync(path.join(r, "modules/other/module.json"), JSON.stringify({ id: "other", version: "1.2.0", name: { en: "o", fr: "o" }, offers: [{ service: "thing.api", version: 1 }] }));
    fs.writeFileSync(path.join(r, "modules/demo/module.json"), JSON.stringify({ id: "demo", version: "1.2.0", name: { en: "d", fr: "d" }, requires: [{ service: "thing.api" }, { service: "later.api", optional: true }] }));
  });
  has(problems(root), 'demo: requires is [] but the module needs ["other"]');
  editJson(root, "demo", (e) => { e.requires = ["other"]; });
  assert.deepEqual(problems(root), []);
});

test("index.json must be what the entries produce", (t) => {
  const root = repoWith(t, (r) => editJson(r, "demo", (e) => { e.order = 99; }));
  has(problems(root), "index.json is not up to date");
  checkShowcase(root, { write: true });
  assert.deepEqual(problems(root), []);
});

test("helpers: webpSize, visibleText, forbiddenIn, longSentences, shape", () => {
  assert.deepEqual(webpSize(fakeWebp(1280, 800)), { width: 1280, height: 800 });
  assert.equal(webpSize(Buffer.from("hello")), null);
  assert.equal(visibleText("[Polls](entry:polls) and ![Alt text](shot:a.webp)\n- **Bold** item"), "Polls and Alt text\nBold item");
  assert.deepEqual(forbiddenIn("Your key, the Service and a cache"), ["key", "service", "cache"]);
  assert.deepEqual(forbiddenIn("Votre clé et vos identifiants"), ["cle", "identifiants"]);
  assert.deepEqual(forbiddenIn("A keyboard, a servicemen picture"), []);
  assert.equal(longSentences("Short one. Another short one.").length, 0);
  assert.equal(longSentences(Array(25).fill("word").join(" ")).length, 1);
  assert.deepEqual(shape("## A\n![x](shot:a.webp)\n[L](entry:b) {n}"), { headings: 1, images: ["a.webp"], links: ["b"], vars: ["{n}"] });
});

test("the release bundle lists every entry, its two texts and its screenshots with sha256 and download address", (t) => {
  const root = repoWith(t);
  const b = buildBundle(root, "9.9.9");
  assert.equal(b.tag, "v9.9.9");
  assert.deepEqual(b.modules.map((m) => m.id), ["demo", "other"]);
  assert.ok(b.modules[0].texts.en.startsWith("## What it does") && b.modules[0].texts.fr.startsWith("## Ce que ça fait"));
  const s = b.modules[0].shots[0];
  assert.equal(s.bytes, 4000); assert.match(s.sha256, /^[0-9a-f]{64}$/);
  assert.equal(s.url, `${rawBase("9.9.9")}/demo/shots/admin.webp`);
  assert.equal(s.url, "https://raw.githubusercontent.com/helldog136/curiosa-extras/v9.9.9/showcase/modules/demo/shots/admin.webp");
  edit(root, "demo", "entry.en.md", (x) => x.replace("quick", "quick!"));
  assert.throws(() => buildBundle(root, "9.9.9"), /problem/);
});

test("a shared screenshot lives in showcase/shared/ and is checked and bundled there", (t) => {
  const root = repoWith(t, (r) => {
    fs.mkdirSync(path.join(r, "showcase/shared"), { recursive: true });
    fs.writeFileSync(path.join(r, "showcase/shared/head.webp"), fakeWebp(1280, 110));
    editJson(r, "demo", (e) => { e.screenshots = [{ ...SHOT, file: "head.webp", kind: "public", shared: true }]; });
    for (const l of ["en", "fr"]) edit(r, "demo", `entry.${l}.md`, (x) => x.replace("shot:admin.webp", "shot:head.webp"));
    fs.rmSync(path.join(r, "showcase/modules/demo/shots/admin.webp"));
  });
  assert.deepEqual(problems(root), []);
  const b = buildBundle(root, "1.0.0");
  assert.equal(b.modules[0].shots[0].path, "showcase/shared/head.webp");
  assert.equal(b.modules[0].shots[0].url, "https://raw.githubusercontent.com/helldog136/curiosa-extras/v1.0.0/showcase/shared/head.webp");
  fs.rmSync(path.join(root, "showcase/shared/head.webp"));
  has(problems(root), "file not found in showcase/shared/");
});

test("the showcase of this repository passes (every module has an entry)", () => {
  const r = checkShowcase(repo);
  assert.deepEqual(r.problems, [], `\n${r.problems.join("\n")}`);
});
