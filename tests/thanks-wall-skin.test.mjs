// Mur des remerciements 1.1.0 : pièces de skin (clé « skin », docs/SKINS.md §8) SANS changer l'apparence par défaut (version mineure, règle de SKINS.md §8.6).
// Le test garde la feuille de la 1.0.1 telle quelle et prouve, sans navigateur : (1) la chaîne var(jeton-du-module, var(jeton-commun, valeur-actuelle)) se réduit EXACTEMENT
// à l'ancienne feuille ; (2) chaque valeur par défaut déclarée vaut, sous le skin basic du cœur, la valeur d'avant ; (3) les pièces posées dans le HTML sont celles déclarées.
// La preuve d'image (0 pixel) est dans le rapport du lot S4 (harnais d'images du cœur).
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fakeContactBook } from "./helpers/fakeContactBook.mjs";
import { makeWorld, reset, restore, P, C, D, def, manifest, people } from "./helpers/thanks-wall-world.mjs";

const { basicTokenValues } = await import("@/core/skins/tokens");
const { analyzeModuleSkin } = await import("@/core/skins/moduleSkin");

beforeEach(() => reset());
afterEach(() => restore());

/** La feuille de style de la version 1.0.1 (avant les pièces de skin), mise en une ligne comme le module le fait. */
const LEGACY_CSS = ".tw{font-family:var(--v-font,inherit);color:var(--v-fg,inherit);max-width:72rem;margin:0 auto}.tw *{box-sizing:border-box}.tw h2,.tw p,.tw ul{margin:0;padding:0}.tw ul{list-style:none}.tw .tw-intro{color:var(--v-muted,#aaa);font-size:1.05rem;max-width:42rem;margin:0 0 1.5rem;overflow-wrap:anywhere}.tw-spot{position:relative;overflow:hidden;display:flex;flex-direction:column;align-items:center;gap:1rem;text-align:center;padding:1.75rem 1.25rem 1.5rem;margin:0 0 2.25rem;background:var(--v-surface,#1c1c1f);border:1px solid var(--v-line,#333);border-radius:1.25rem;box-shadow:0 1px 2px color-mix(in srgb,var(--v-fg,#000) 12%,transparent),0 14px 34px -16px color-mix(in srgb,var(--v-fg,#000) 40%,transparent)}.tw-spot::before{content:\"\";position:absolute;inset:0 0 auto 0;height:5px;background:var(--v-gradient,var(--v-accent,#e8a23b))}.tw-spot .tw-av{width:8rem}.tw .tw-eyebrow{display:inline-block;padding:.2rem .75rem;border-radius:999px;background:var(--v-accent,#e8a23b);color:var(--v-accent-fg,#111);font-size:.8rem;font-weight:700;letter-spacing:.02em;line-height:1.5}[data-accent2] .tw-eyebrow{background:var(--v-accent2,#e8a23b);color:var(--v-accent2-fg,#111)}.tw-spot-name{font-size:1.6rem;font-weight:800;line-height:1.2;overflow-wrap:anywhere}.tw-spot-why{max-width:34rem;font-size:1.05rem;overflow-wrap:anywhere;white-space:pre-line}.tw-group{margin:0 0 2.25rem}.tw-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:.25rem .75rem;margin:0 0 1rem}.tw-head h2{font-size:1.4rem;font-weight:800;line-height:1.25;overflow-wrap:anywhere}.tw-count{color:var(--v-muted,#aaa);font-size:.95rem}.tw-grid{display:grid;gap:.75rem;grid-template-columns:repeat(2,minmax(0,1fr))}.tw-card{display:flex;flex-direction:column;align-items:center;gap:.6rem;padding:1rem .6rem .9rem;text-align:center;background:var(--v-surface,#1c1c1f);border:1px solid var(--v-line,#333);border-radius:1rem;min-width:0}.tw-av{position:relative;flex:0 0 auto;width:5.25rem;aspect-ratio:1;border-radius:50%;overflow:hidden;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--v-accent,#e8a23b) 24%,var(--v-surface,#1c1c1f));border:2px solid var(--v-line,#333);font-weight:800;font-size:1.5rem;color:var(--v-fg,inherit)}.tw-spot .tw-av{font-size:2.25rem}.tw-av img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}.tw-name{font-weight:700;line-height:1.3;overflow-wrap:anywhere;max-width:100%}.tw-msg{color:var(--v-muted,#aaa);font-size:.9rem;line-height:1.4;overflow-wrap:anywhere}.tw .tw-more{margin:1.25rem 0 0}.tw-btn{display:inline-flex;align-items:center;justify-content:center;min-height:2.75rem;padding:.55rem 1.1rem;border-radius:.7rem;font-weight:600;text-decoration:none;background:var(--v-accent,#e8a23b);color:var(--v-accent-fg,#111)}[data-accent2] .tw-btn{background:var(--v-accent2,#e8a23b);color:var(--v-accent2-fg,#111)}.tw-link{display:inline-flex;align-items:center;min-height:2.75rem;color:var(--v-fg,inherit);text-decoration:underline;text-underline-offset:.2em}.tw-btn:focus-visible,.tw-link:focus-visible{outline:2px solid var(--v-fg,currentColor);outline-offset:3px}.tw .tw-nav{display:grid;grid-template-columns:1fr 1fr;gap:.6rem;margin:1.5rem 0 0;max-width:28rem}.tw-pg{grid-column:1/-1;order:-1;color:var(--v-muted,#aaa)}.tw-nav [aria-disabled]{opacity:.45}.tw-empty{padding:2.25rem 1.25rem;text-align:center;border:1px dashed var(--v-line,#333);border-radius:1rem;background:var(--v-surface,#1c1c1f)}.tw-empty-t{font-size:1.15rem;font-weight:700}.tw .tw-empty-s{color:var(--v-muted,#aaa);margin-top:.35rem}@media (min-width:36rem){.tw-grid{grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr));gap:1rem}.tw-card{padding:1.15rem .75rem 1rem}.tw-av{width:5.75rem}.tw-spot{flex-direction:row;text-align:left;gap:1.75rem;padding:2rem}.tw-spot .tw-av{width:9rem}}@media (prefers-reduced-motion:no-preference){.tw-card{transition:transform .15s ease,border-color .15s ease}.tw-card:hover{transform:translateY(-2px);border-color:var(--v-accent,#e8a23b)}}";

const page = (ctx, ...segments) => def.page(ctx, { segments });
const rawHtml = (p) => (p.blocks ?? []).map((b) => b.html ?? "").join("\n");
const cssOf = (html) => /<style>(.*?)<\/style>/s.exec(html)?.[1] ?? "";

/** Remplace chaque var(--sk-…, repli) par son repli (le dernier maillon de la chaîne), du dehors vers le dedans. */
function reduceSkinVars(css) {
  let out = css;
  for (let guard = 0; guard < 200; guard++) {
    const at = out.search(/var\(--sk-/);
    if (at < 0) return out;
    let depth = 0, end = -1, comma = -1;
    for (let i = at + 3; i < out.length; i++) {
      const c = out[i];
      if (c === "(") depth++;
      else if (c === ")") { depth--; if (depth === 0) { end = i; break; } } else if (c === "," && depth === 1 && comma < 0) comma = i;
    }
    assert.ok(end > 0 && comma > 0, `var(--sk-…) sans repli : ${out.slice(at, at + 80)}`);
    out = out.slice(0, at) + out.slice(comma + 1, end) + out.slice(end + 1);
  }
  throw new Error("réduction sans fin");
}

const normalise = (v) => v.replace(/var\((--v-[a-z0-9-]+),\s*#[0-9a-f]{3,8}\)/gi, "var($1)").replace(/\s+/g, "").replace(/,/g, ", ").replace(/\s+/g, "");

async function wallPage(extra = {}) {
  const book = fakeContactBook();
  const cat = book.seedCategory("Soutiens");
  const list = people(book, cat, 8, { prefix: "S" });
  const { ctx } = makeWorld({ book, settings: { category: cat, preview: 4, ...extra } });
  await D.setHonor(ctx, { month: P.monthKey(), contactId: list[0].id, why: { fr: "Merci pour tout" } });
  return { ctx, page: await page(ctx) };
}

test("apparence par défaut inchangée : la chaîne de repli de chaque jeton se réduit exactement à la feuille de la 1.0.1", async () => {
  const { page: p } = await wallPage();
  const css = cssOf(rawHtml(p));
  assert.ok(css.includes("--sk-m-thanks-wall-card-radius"), "la nouvelle feuille lit les jetons du module");
  const reduced = reduceSkinVars(css);
  // seul ajout : la carte déclare « box-shadow:none » (la valeur de --sk-shadow-card sous basic), sans effet visible
  assert.equal((reduced.match(/box-shadow:none;/g) ?? []).length, 1);
  assert.equal(reduced.replace("box-shadow:none;", ""), LEGACY_CSS);
});

test("apparence par défaut inchangée : chaque valeur par défaut déclarée vaut, sous basic, la valeur d'avant", async () => {
  const basic = basicTokenValues();
  const resolve = (v) => { for (let i = 0; i < 8 && /var\(--sk-/.test(v); i++) v = v.replace(/var\((--sk-[a-z0-9-]+)\)/g, (_m, n) => basic[n] ?? `?${n}`); return v; };
  const a = analyzeModuleSkin("thanks-wall", manifest.skin);
  assert.equal(a.ok, true, JSON.stringify(a.issues));
  assert.equal(a.tokens.length, 14);
  const { reads } = collectReads(cssOf(rawHtml((await wallPage()).page)));
  for (const t of a.tokens) {
    const chain = reads.get(t.name);
    assert.ok(chain, `${t.name} : jeton déclaré mais lu nulle part`);
    // la valeur actuelle = la chaîne réduite jusqu'au bout ; la valeur du jeton commun intermédiaire (s'il y en a un) doit être la même sous basic
    assert.equal(normalise(resolve(t.default)), normalise(chain.final), `${t.name} : le défaut déclaré n'est pas la valeur d'avant`);
    for (const mid of chain.common) assert.equal(normalise(resolve(`var(${mid.name})`)), normalise(mid.final), `${t.name} : ${mid.name} vaut autre chose sous basic que le repli écrit`);
  }
});

function collectReads(css) {
  const reads = new Map();
  for (const m of css.matchAll(/var\((--sk-m-thanks-wall-[a-z-]+),/g)) {
    // le contenu de ce var(…) jusqu'à sa parenthèse fermante
    let depth = 0, i = m.index + 3;
    for (; i < css.length; i++) { if (css[i] === "(") depth++; else if (css[i] === ")") { depth--; if (depth === 0) break; } }
    const inner = css.slice(m.index + 4 + m[1].length + 1, i); // après « var(--jeton, »
    const common = [];
    const mid = /^var\((--sk-[a-z0-9-]+),/.exec(inner);
    if (mid) {
      let d = 0, j = 3;
      for (; j < inner.length; j++) { if (inner[j] === "(") d++; else if (inner[j] === ")") { d--; if (d === 0) break; } }
      common.push({ name: mid[1], final: reduceSkinVars(inner.slice(0, j + 1)) });
    }
    reads.set(m[1], { final: reduceSkinVars(inner), common });
  }
  return { reads };
}

test("pièces : toutes les pièces posées dans le HTML sont déclarées, et toutes les déclarées sont posées", async () => {
  const { page: p, ctx } = await wallPage();
  const html = rawHtml(p);
  const placed = new Set([...html.matchAll(/data-skin-part="([^"]+)"/g)].map((m) => m[1]));
  const declared = new Set(manifest.skin.parts.map((x) => x.id));
  assert.deepEqual([...placed].sort(), [...declared].sort());
  // la page d'un groupe pose aussi la pagination : les boutons sont des pièces
  C.resetWall(); // la mémoire du mur est celle du premier monde
  const book = fakeContactBook();
  const cat = book.seedCategory("Soutiens");
  people(book, cat, 120, { prefix: "G" });
  const w = makeWorld({ book, settings: { category: cat } });
  const group = rawHtml(await page(w.ctx, "g", "1"));
  assert.ok((group.match(/data-skin-part="thanks-wall\.button"/g) ?? []).length >= 2, "précédent / suivant");
  void ctx;
});

test("principe fondateur : les pièces ne changent ni le texte ni la structure de la page (les attributs data-skin-part sont les seuls ajouts au HTML)", async () => {
  const { page: p } = await wallPage();
  const html = rawHtml(p).replace(/<style>.*?<\/style>/s, "");
  const stripped = html.replace(/ data-skin-part="[^"]+"/g, "");
  assert.ok(!stripped.includes("data-skin-part"));
  // aucun texte n'est apporté par une pièce : tout le texte visible est inchangé quand on retire les attributs
  const text = (h) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  assert.equal(text(stripped), text(html));
  // et la déclaration n'a pas de clé de contenu
  assert.deepEqual(Object.keys(manifest.skin).sort(), ["demo", "parts", "since"]);
});

test("version : une version mineure qui exige le cœur 0.4.0 (clé « skin ») et dont l'aperçu existe", async () => {
  assert.equal(manifest.version, "1.1.0");
  assert.equal(manifest.minCore, "0.4.0");
  const fs = await import("node:fs");
  const demo = fs.readFileSync(new URL("../modules/thanks-wall/skin-demo.html", import.meta.url), "utf8");
  assert.ok(demo.length < 20 * 1024 && !/<script|<style|style=|on[a-z]+=|https?:/i.test(demo));
});
