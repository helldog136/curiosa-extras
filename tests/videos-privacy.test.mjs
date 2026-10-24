// Vidéothèque : vie privée, habillage et neutralité. Aucun cookie, aucune requête vers la plateforme avant un clic, pas d'intervalle, pas de couleur codée en dur, rien de propre à un site.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { withFakeFetch } from "/dev/shm/core-assoc/testsupport/index.mjs";
import { ctxFor, manifest, DIR, platform, def, id, O, D } from "./helpers/videosKit.mjs";

const files = (dir, ext) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name), ext) : ext.some((x) => e.name.endsWith(x)) ? [path.join(dir, e.name)] : []));
const source = (f) => fs.readFileSync(f, "utf8");

test("la déclaration de vie privée dit la vérité, en français et en anglais", () => {
  for (const lang of ["fr", "en"]) {
    const text = manifest.privacy[lang];
    assert.ok(text.length > 100 && text.length <= 500); assert.match(text, /youtube-nocookie\.com/); assert.match(text, lang === "fr" ? /après un clic/ : /after a click/);
  }
  assert.ok(manifest.permissions.every((p) => ["pages", "routes", "storage", "sections", "admin", "mcp"].includes(p)));
});

test("aucun cookie, aucun minuteur de fond, aucun appel direct hors des deux endroits prévus", () => {
  for (const f of files(DIR, [".mjs", ".js"])) {
    const code = source(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const name = path.basename(f);
    assert.ok(!/document\.cookie|set-cookie|localStorage|sessionStorage/i.test(code), `${name} : pas de cookie ni de stockage du navigateur`);
    assert.ok(!/setInterval|setImmediate/.test(code), `${name} : pas de minuteur répétitif`);
    assert.ok(!/child_process|eval\(|new Function|node:fs|node:http|XMLHttpRequest/.test(code), `${name} : rien de dangereux`);
    if (name !== "providers.mjs") assert.ok(!/\bfetch\(/.test(code), `${name} : pas de fetch direct`);
  }
  const prov = source(path.join(DIR, "providers.mjs"));
  assert.equal((prov.match(/\bfetch\(/g) ?? []).length, 1);
  assert.match(prov, /redirect: "manual"/); assert.match(prov, /signal: ctl\.signal/);
});

test("aucune couleur codée en dur : seulement des repli dans var(--v-…, repli) ; mouvement réduit respecté", () => {
  const css = /const CSS = `([\s\S]*?)`\.replace/.exec(source(path.join(DIR, "view.mjs")))[1];
  const colors = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)];
  assert.ok(colors.length > 0);
  for (const m of colors) assert.match(css.slice(Math.max(0, m.index - 80), m.index), /var\(--v-[a-z0-9-]+,\s*(?:[^()]|\([^()]*\))*$/, `couleur hors repli près de ${m[0]}`);
  assert.ok(!/\brgb\(|\brgba\(|\bhsl\(/.test(css));
  assert.match(css, /prefers-reduced-motion:no-preference/); assert.ok(!/animation:|@keyframes/.test(css)); assert.match(css, /min-height:2\.75rem/);
});

test("neutralité : rien de propre à une association, un site, une région ou une marque dans le code, les textes et les tests", () => {
  const banned = /\basbl\b|association|belgi|wallon|bruxell|helldog|rosalia|@gmail|curiosa\.(?:be|com)/i;
  const here = path.dirname(new URL(import.meta.url).pathname);
  const mine = [...files(DIR, [".mjs", ".js", ".json", ".md"]), ...fs.readdirSync(here).filter((f) => f.startsWith("videos-")).map((f) => path.join(here, f)), ...fs.readdirSync(path.join(here, "helpers")).filter((f) => /^videos|^fakeVideos/.test(f)).map((f) => path.join(here, "helpers", f))];
  for (const f of mine) {
    if (path.basename(f) === "videos-privacy.test.mjs") continue;
    const hit = banned.exec(source(f).replace(/"author": "[^"]*",/, ""));
    assert.ok(!hit, `${path.basename(f)} contient « ${hit?.[0]} »`);
  }
});

test("le disjoncteur du cœur protège YouTube et la page : après quelques échecs, plus d'appel, et le message dit quoi faire", async () => {
  const ctx = ctxFor();
  const fake = platform({}, { down: true });
  await withFakeFetch(fake.routes, async () => {
    await D.addVideos(ctx, Array.from({ length: 12 }, (_, i) => ({ provider: "youtube", ext: id(i), title: "" })));
    const r = await O.complete(ctx, { limit: 12 });
    assert.equal(r.down, true);
    assert.ok(fake.calls.filter((u) => u.includes("oembed")).length <= 8);
    assert.match((await def.adminActions.complete.run(ctx, {})).error, /YouTube ne répond pas pour le moment/);
  });
});
