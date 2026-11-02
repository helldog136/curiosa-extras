// Visuels des fiches (`previews` de module.json) : validation, recopie dans l'index du catalogue, captures reproductibles, données inventées.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PREVIEW_LIMITS, previewIndex, previewProblems, readManifests, sniffImage } from "../scripts/rules.mjs";
import { makeTempDir } from "./helpers/tmp.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const manifests = readManifests(root);
const withPreviews = Object.entries(manifests).filter(([, m]) => m.previews !== undefined);

/** Un PNG minimal (en-tête seulement : le contrôle lit le type et les dimensions dans les octets). */
function png(w, h, pad = 0) {
  const b = Buffer.alloc(40 + pad);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
  b.writeUInt32BE(13, 8); b.write("IHDR", 12, "latin1"); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}
/** Un WebP « étendu » (VP8X) minimal. */
function webp(w, h) {
  const b = Buffer.alloc(40);
  b.write("RIFF", 0, "latin1"); b.writeUInt32LE(32, 4); b.write("WEBP", 8, "latin1"); b.write("VP8X", 12, "latin1"); b.writeUInt32LE(10, 16);
  b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3);
  return b;
}
const decl = (file = "previews/a.webp", over = {}) => ({ file, type: "public", caption: { fr: "Votre page.", en: "Your page." }, alt: { fr: "Une page.", en: "A page." }, ...over });
const tmpModule = (files) => {
  const dir = makeTempDir("previews-");
  fs.mkdirSync(path.join(dir, "previews"), { recursive: true });
  for (const [name, bytes] of Object.entries(files)) fs.writeFileSync(path.join(dir, "previews", name), bytes);
  return dir;
};

test("sniffImage : le type et les dimensions viennent des octets (PNG, WebP étendu) ; le reste est refusé", () => {
  assert.deepEqual(sniffImage(png(1280, 800)), { type: "png", width: 1280, height: 800 });
  assert.deepEqual(sniffImage(webp(1280, 800)), { type: "webp", width: 1280, height: 800 });
  assert.equal(sniffImage(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>".padEnd(64))), null);
  assert.equal(sniffImage(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60)])), null, "un JPEG n'est pas permis");
  assert.equal(sniffImage(Buffer.alloc(10)), null);
});

test("previewProblems : une déclaration juste est valide ; sans previews, rien à dire", () => {
  assert.deepEqual(previewProblems(undefined), []);
  assert.deepEqual(previewProblems([]), []);
  assert.deepEqual(previewProblems([decl(), decl("previews/b.png", { type: "admin" }), decl("previews/c.webp", { type: "overlay" })]), []);
});

test("previewProblems : au plus 6, fichier bien nommé, type connu, doublons refusés", () => {
  assert.match(previewProblems(Array.from({ length: 7 }, (_, i) => decl(`previews/v${i}.webp`))).join("\n"), /7 visuels, 6 au plus/);
  for (const bad of ["a.webp", "previews/a.jpg", "previews/A.webp", "previews/sub/a.webp", "previews/../a.webp", "/previews/a.webp", `previews/${"x".repeat(70)}.webp`]) assert.match(previewProblems([decl(bad)]).join("\n"), /\.file/, bad);
  assert.match(previewProblems([decl("previews/a.webp", { type: "page" })]).join("\n"), /type/);
  assert.match(previewProblems([decl(), decl()]).join("\n"), /deux fois/);
  assert.match(previewProblems("x").join("\n"), /liste/);
});

test("previewProblems : légende et texte alternatif en français ET en anglais, obligatoires et bornés", () => {
  assert.match(previewProblems([decl("previews/a.webp", { alt: undefined })]).join("\n"), /alt/);
  assert.match(previewProblems([decl("previews/a.webp", { alt: { fr: "Une page." } })]).join("\n"), /alt\.en/);
  assert.match(previewProblems([decl("previews/a.webp", { caption: { en: "Your page." } })]).join("\n"), /caption\.fr/);
  assert.match(previewProblems([decl("previews/a.webp", { caption: { fr: " ", en: "Your page." } })]).join("\n"), /caption\.fr/);
  assert.deepEqual(previewProblems([decl("previews/a.webp", { caption: { fr: "x".repeat(140), en: "y".repeat(140) }, alt: { fr: "x".repeat(250), en: "y".repeat(250) } })]), []);
  assert.match(previewProblems([decl("previews/a.webp", { caption: { fr: "x".repeat(141), en: "ok" } })]).join("\n"), /caption\.fr : 141 caractères/);
  assert.match(previewProblems([decl("previews/a.webp", { alt: { fr: "x".repeat(251), en: "ok" } })]).join("\n"), /alt\.fr : 251 caractères/);
});

test("previewProblems : le fichier existe, pèse 150 Ko au plus, est un vrai PNG/WebP du type de son extension, aux dimensions permises", () => {
  const dir = tmpModule({ "ok.webp": webp(1280, 800), "ok.png": png(1280, 800), "big.webp": Buffer.concat([webp(1280, 800), Buffer.alloc(PREVIEW_LIMITS.bytes)]), "fake.webp": png(1280, 800), "svg.png": Buffer.from("<svg></svg>".padEnd(64)), "tiny.webp": webp(100, 100), "huge.webp": webp(3000, 800), "bomb.webp": webp(2400, 2400) });
  assert.deepEqual(previewProblems([decl("previews/ok.webp"), decl("previews/ok.png")], dir), []);
  const one = (f) => previewProblems([decl(`previews/${f}`)], dir).join("\n");
  assert.match(one("absent.webp"), /n'existe pas/);
  assert.match(one("big.webp"), /Ko, 150 Ko au plus/);
  assert.match(one("fake.webp"), /extension annonce un autre type/);
  assert.match(one("svg.png"), /ni un PNG ni un WebP/);
  assert.match(one("tiny.webp"), /entre 240 et 2400/);
  assert.match(one("huge.webp"), /entre 240 et 2400/);
  assert.match(one("bomb.webp"), /pixels au plus/);
});

test("previewIndex : la déclaration seulement (fichier, type, légende, texte alternatif), dans l'ordre, jamais les octets", () => {
  const list = [decl("previews/b.webp", { type: "admin", extra: "ignoré" }), decl("previews/a.webp")];
  assert.deepEqual(previewIndex(list).map((p) => p.file), ["previews/b.webp", "previews/a.webp"]);
  assert.deepEqual(Object.keys(previewIndex(list)[0]), ["file", "type", "caption", "alt"]);
  assert.deepEqual(previewIndex(undefined), []);
});

test("les visuels déclarés par les modules de ce dépôt sont tous valides (fichier présent, poids, dimensions, type réel, légendes fr + en)", () => {
  assert.ok(withPreviews.length >= 9, "les modules les plus parlants ont leurs visuels");
  for (const [id, m] of withPreviews) assert.deepEqual(previewProblems(m.previews, path.join(root, "modules", id)), [], id);
});

test("aucune image orpheline : chaque fichier de previews/ est déclaré, et chaque module qui en a une scène de capture", () => {
  const scenes = new Set(fs.readdirSync(path.join(root, "tests/visual/previews")).filter((f) => f.endsWith(".mjs") && f !== "kit.mjs").map((f) => f.slice(0, -4)));
  for (const [id, m] of withPreviews) {
    assert.ok(scenes.has(id), `${id} : pas de scène tests/visual/previews/${id}.mjs : ses captures ne seraient pas reproductibles`);
    const files = fs.readdirSync(path.join(root, "modules", id, "previews"));
    assert.deepEqual(files.sort(), m.previews.map((p) => p.file.replace(/^previews\//, "")).sort(), `${id} : images et déclaration diffèrent`);
  }
  for (const id of scenes) assert.ok(manifests[id]?.previews?.length, `scène « ${id} » sans previews dans module.json`);
});

test("légendes : vouvoiement, une phrase courte, aucun point d'exclamation ni tutoiement (R13), en français et en anglais", () => {
  for (const [id, m] of withPreviews) for (const [i, p] of m.previews.entries()) {
    for (const [lang, text] of Object.entries(p.caption)) {
      const at = `${id} previews[${i}] caption.${lang}`;
      assert.ok(!/!/.test(text), `${at} : pas de point d'exclamation`);
      assert.ok(text.split(/\s+/).length <= 20, `${at} : 20 mots au plus`);
      assert.ok(!/\b(tu|ton|ta|tes|toi)\b/i.test(text), `${at} : vouvoiement`);
      assert.ok(!/veuillez/i.test(text), at);
    }
    assert.ok(p.alt.fr !== p.caption.fr && p.alt.en !== p.caption.en, `${id} previews[${i}] : le texte alternatif décrit l'image, il ne répète pas la légende`);
  }
});

test("index du catalogue : previews recopiés tels quels (jamais les images) ; un module sans visuel n'a pas la clé", () => {
  const index = JSON.parse(fs.readFileSync(path.join(root, "catalogue/index.json"), "utf8"));
  for (const e of index.modules) {
    const m = manifests[e.id];
    if (m?.previews?.length) assert.deepEqual(e.previews, previewIndex(m.previews), e.id);
    else assert.ok(!("previews" in e), `${e.id} : visuels dans l'index sans visuel dans le manifeste`);
  }
  assert.ok(!fs.readFileSync(path.join(root, "catalogue/index.json"), "utf8").includes("data:image"), "aucune image dans l'index");
});

test("build-index : recopie les visuels, refuse un fichier absent, et --check échoue si l'index est périmé ou si une image référencée a disparu", () => {
  const tmp = makeTempDir("idx-prev-");
  fs.cpSync(path.join(root, "scripts"), path.join(tmp, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "catalogue")); fs.mkdirSync(path.join(tmp, "examples"));
  fs.copyFileSync(path.join(root, "package.json"), path.join(tmp, "package.json"));
  fs.mkdirSync(path.join(tmp, "modules/zed/previews"), { recursive: true });
  const manifest = { id: "zed", name: "Zed", description: "d", version: "1.0.0", apiVersion: 2, author: "x", icon: "z", previews: [decl("previews/a.webp")] };
  const write = (m) => fs.writeFileSync(path.join(tmp, "modules/zed/module.json"), JSON.stringify(m));
  const run = (...a) => spawnSync(process.execPath, [path.join(tmp, "scripts/build-index.mjs"), ...a], { encoding: "utf8" });
  const index = () => JSON.parse(fs.readFileSync(path.join(tmp, "catalogue/index.json"), "utf8"));
  write(manifest);
  // image absente : l'index n'est pas écrit
  let r = run();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /zed : previews\[0\]\.file : « previews\/a\.webp » n'existe pas/);
  fs.writeFileSync(path.join(tmp, "modules/zed/previews/a.webp"), webp(1280, 800));
  assert.equal(run().status, 0);
  assert.deepEqual(index().modules[0].previews, previewIndex(manifest.previews));
  assert.equal(run("--check").status, 0);
  // une légende change : l'index est périmé
  write({ ...manifest, previews: [decl("previews/a.webp", { caption: { fr: "Autre.", en: "Other." } })] });
  r = run("--check");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /n'est pas à jour/);
  assert.equal(run().status, 0);
  assert.equal(run("--check").status, 0);
  // l'image référencée disparaît : --check échoue même si l'index est à jour
  fs.rmSync(path.join(tmp, "modules/zed/previews/a.webp"));
  r = run("--check");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /n'existe pas/);
  // trop lourde, mauvais type, sans texte alternatif : refusés
  fs.writeFileSync(path.join(tmp, "modules/zed/previews/a.webp"), Buffer.concat([webp(1280, 800), Buffer.alloc(PREVIEW_LIMITS.bytes)]));
  assert.match(run().stderr, /150 Ko au plus/);
  fs.writeFileSync(path.join(tmp, "modules/zed/previews/a.webp"), webp(1280, 800));
  write({ ...manifest, previews: [decl("previews/a.webp", { alt: { fr: "Une page." } })] });
  assert.match(run().stderr, /alt\.en/);
  // sans previews : pas de clé, comme avant
  write({ ...manifest, previews: undefined });
  assert.equal(run().status, 0);
  assert.ok(!("previews" in index().modules[0]));
});

test("captures : un script reproductible, des données inventées, et des garde-fous contre toute donnée réelle", async () => {
  const script = fs.readFileSync(path.join(root, "scripts/shoot-previews.mjs"), "utf8");
  assert.match(script, /DONNÉES INVENTÉES/);
  assert.match(script, /assertInvented/);
  assert.match(script, /--check/);
  // les scènes n'écrivent aucune adresse hors example.org / .test, aucune adresse électronique réelle, aucun nom de la propriétaire ou de sa communauté
  const src = fs.readdirSync(path.join(root, "tests/visual/previews")).map((f) => fs.readFileSync(path.join(root, "tests/visual/previews", f), "utf8")).join("\n");
  for (const m of src.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) assert.match(m[1], /(^|\.)(example\.(org|com|net)|[a-z0-9-]+\.example|[a-z0-9-]+\.test|localhost)$|^(www\.)?(patreon|ko-fi)\.com$|^www\.w3\.org$/i, `adresse de scène « ${m[0]} »`);
  assert.doesNotMatch(src.replace(/FORBIDDEN[^\n]*/g, ""), /helldog|rosalia/i);
  assert.doesNotMatch(src, /[\w.+-]+@(?!example\.|.*\.test)[\w-]+\.\w+/);
});
