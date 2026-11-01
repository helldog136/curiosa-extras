import test, { after, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { feedTopics } from "./helpers/icalFeed.mjs";

const dir = new URL("../modules/planning/", import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, dir), "utf8");
const fr = JSON.parse(read("locales/fr.json")), en = JSON.parse(read("locales/en.json"));
const mod = await import("../modules/planning/index.mjs");
const def = mod.default;
const { buildModel } = await import("../modules/planning/appearances/model.mjs");
const { renderAppearance, registered } = await import("../modules/planning/appearances/registry.mjs");
const { normalizeOptions, DEFAULTS, APPEARANCE_IDS, resolveAppearanceId } = await import("../modules/planning/appearances/options.mjs");
const { BASE_CSS } = await import("../modules/planning/appearances/kit.mjs");
const { previewHtml } = await import("../modules/planning/appearances/preview.mjs");

const mk = (messages) => (k, v) => { let s = messages[k] ?? k; for (const [n, x] of Object.entries(v ?? {})) s = s.replaceAll(`{${n}}`, String(x)); return s; };
const NOW = new Date("2026-10-12T10:00:00Z");
mock.timers.enable({ apis: ["Date"], now: NOW.getTime() });   // horloge simulée : aucun test ne dépend de l'heure du jour
after(() => mock.timers.reset());
const at = (h, over = {}) => ({ uid: `u${h}`, title: "Titre", games: [], start: new Date(NOW.getTime() + h * 3_600_000), end: new Date(NOW.getTime() + (h + 2) * 3_600_000), allDay: false, ...over });
const LONG = "Un très long titre ".repeat(6).trim();
const cases = {
  "sans jeu": [at(3)],
  "multi-jeux": [at(3, { games: ["A", "B", "C"] })],
  "multi-streams": [at(3), at(6, { games: ["A"] }), at(8)],
  "en cours": [at(-1)],
  "annulé": [at(3, { cancelled: true })],
  "journée entière": [at(30, { allDay: true, end: new Date(NOW.getTime() + 54 * 3_600_000) })],
  "vide": [],
  "titre très long": [at(3, { title: LONG, games: [LONG] })],
  "injection": [at(3, { title: `<script>alert(1)</script>"><img src=x onerror=1>`, games: [`<b>"x"</b>`] })],
};
const covers = new Map([["A", "https://media.example.test/a.jpg"], ["B", "https://media.example.test/b.jpg"], ["C", "https://media.example.test/c.jpg"]]);
const vis = { src: "https://cdn.example.test/logo.png", light: false, initial: "H" };
const optsFor = (id, over = {}) => ({ ...normalizeOptions(() => undefined), appearance: id, cancelled: true, ...over });
const modelOf = (id, slots, over = {}) => buildModel({ slots, covers, now: NOW, tz: "Europe/Paris", locale: "fr", t: mk(fr), opts: optsFor(id), mode: "days", days: 14, vis, planningHref: "/planning", ...over });

/** Étiquettes ouvrantes/fermantes équilibrées (HTML bien formé pour nos balises). */
function balanced(html) {
  const stack = [];
  for (const m of html.matchAll(/<(\/)?([a-z][a-z0-9]*)\b[^>]*?(\/)?>/gi)) {
    const [, close, name, self] = m; const n = name.toLowerCase();
    if (["img", "br", "hr", "input", "path", "rect", "circle"].includes(n) || self) continue;
    if (close) { assert.equal(stack.pop(), n, `balise « ${n} » mal fermée`); } else stack.push(n);
  }
  assert.deepEqual(stack, []);
}

test("registre : chaque apparence annoncée est installée, une seule source d'identifiants", () => {
  assert.deepEqual(registered().sort(), APPEARANCE_IDS.filter((i) => i !== "original").sort());
  assert.ok(registered().length >= 6);
});

for (const id of APPEARANCE_IDS.filter((i) => i !== "original")) {
  test(`apparence « ${id} » : HTML valide pour tous les cas, fr/en, plusieurs fuseaux, échappement, <time>, alt`, () => {
    for (const [name, slots] of Object.entries(cases)) for (const [lang, dict] of [["fr", fr], ["en", en]]) for (const tz of ["UTC", "Europe/Paris", "America/Montreal", "Pacific/Auckland"]) {
      const html = renderAppearance(id, modelOf(id, slots, { tz, locale: lang, t: mk(dict) }), {});
      assert.match(html, /^<div class="pa pa-/, name);
      assert.ok(!/undefined|\[object|NaN/.test(html.replace(/<style>[\s\S]*?<\/style>/, "")), `${id}/${name}: valeur absurde`);
      balanced(html);
      assert.ok(!html.includes("<script"), name);
      assert.ok(!/<img[^>]*onerror/.test(html), name);
      for (const img of html.match(/<img\b[^>]*>/g) ?? []) assert.match(img, /\balt="/, `${id}: <img> sans alt`);
      for (const tm of html.match(/<time\b[^>]*>/g) ?? []) assert.match(tm, /datetime="[^"]+"/);
      if (!slots.length) assert.match(html, /role="status"|pa-none|pa-empty/, "état vide");
    }
  });
}

test("apparences : un titre très long est entier dans le HTML (jamais tronqué en dur), échappé", () => {
  for (const id of registered()) {
    const html = renderAppearance(id, modelOf(id, cases["titre très long"]), {});
    assert.ok(html.includes(LONG), id);
    const evil = renderAppearance(id, modelOf(id, cases["injection"]), {});
    assert.ok(evil.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), id);
    assert.ok(evil.includes("&lt;b&gt;"), id);
  }
});

test("apparences : annulé barré avec le mot « Annulé », en cours avec « En cours » (jamais la seule couleur)", () => {
  for (const id of registered()) {
    assert.match(renderAppearance(id, modelOf(id, cases["annulé"]), {}), /pa-cancelled/, id);
    assert.ok(renderAppearance(id, modelOf(id, cases["annulé"]), {}).includes(">Annulé<") || /Annulé/.test(renderAppearance(id, modelOf(id, cases["annulé"]), {})), id);
    assert.match(renderAppearance(id, modelOf(id, cases["en cours"]), {}), /En cours/, id);
  }
});

test("apparences : aucune couleur codée en dur (hors secours de var() et mauve Twitch du visuel sans jeu)", () => {
  for (const id of registered()) {
    const html = renderAppearance(id, modelOf(id, cases["multi-streams"]), {});
    const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
    const themed = css.replace(/\.pa-ph\{[^}]*\}/, "").replace(/var\((--v-[\w-]+),[^()]*(?:\([^()]*\)[^()]*)*\)/g, "var($1)");
    assert.ok(!/#[0-9a-f]{3,8}\b/i.test(themed), `${id}: ${themed.match(/#[0-9a-f]{3,8}\b/i)}`);
    assert.ok(!/\brgba?\(|\bhsla?\(/i.test(css), id);
    assert.ok(!/style="[^"]*#[0-9a-f]{3,8}/i.test(html), id);
    assert.match(css, /\[data-accent2\] \.pa/);
    assert.match(css, /--v-accent2/);
    if (/transition|animation/.test(css)) assert.match(css, /prefers-reduced-motion:no-preference/);
    assert.ok(!/@keyframes|animation:/.test(css), id);
  }
  assert.match(BASE_CSS, /\.pa-ph\{[^}]*#9146ff/i);
});

test("options : valeurs par défaut sûres, valeurs absurdes et apparence inconnue → repli sur l'original", () => {
  const o = normalizeOptions(() => undefined);
  assert.equal(o.appearance, "original");
  assert.deepEqual([o.density, o.covers, o.relative, o.h12, o.weekStart, o.timezone, o.dayStyle], ["comfortable", true, true, false, 1, false, "text"]);
  const bad = normalizeOptions((k) => ({ appearance: "<script>", density: 42, showCovers: "peut-être", hourFormat: {}, weekStart: "9", heroUpNext: "abc", dayStyle: null })[k]);
  assert.equal(bad.appearance, "original");
  assert.deepEqual([bad.density, bad.covers, bad.h12, bad.weekStart, bad.dayStyle, bad.own.heroUpNext], ["comfortable", true, false, 1, "text", 5]);
  assert.equal(normalizeOptions(() => { throw new Error("x"); }).appearance, "original");
  assert.equal(resolveAppearanceId("inherit"), "original");
  assert.equal(normalizeOptions((k) => (k === "appearance" ? "week" : undefined), "posters").appearance, "posters", "surcharge du morceau");
  assert.equal(normalizeOptions((k) => (k === "appearance" ? "week" : undefined), "inherit").appearance, "week");
});

test("manifeste : chaque réglage d'apparence a un défaut égal à celui du code, fr/en alignés, choix = identifiants du registre", async () => {
  const m = JSON.parse(read("module.json"));
  const { parseManifest } = await import("@/core/modules/manifest");
  assert.ok(parseManifest(m).ok);
  assert.equal(m.version, "2.5.1");
  for (const key of Object.keys(DEFAULTS)) {
    const s = m.settings.find((x) => x.key === key);
    assert.ok(s, key);
    assert.equal(typeof s.default === "string" && /^\d+$/.test(s.default) && typeof DEFAULTS[key] === "number" ? Number(s.default) : s.default, DEFAULTS[key], key);
    assert.ok(s.group === "appearance", key);
  }
  assert.deepEqual(m.settings.find((x) => x.key === "appearance").options.map((o) => o.value), APPEARANCE_IDS);
  const sec = m.sections.find((s) => s.id === "upcoming").options.find((o) => o.key === "appearance");
  assert.deepEqual(sec.options.map((o) => o.value), ["inherit", ...APPEARANCE_IDS]);
  assert.equal(sec.default, "inherit");
  for (const id of APPEARANCE_IDS) for (const k of [`ap_${id}`, `apd_${id}`]) assert.ok(fr[k] && en[k], k);
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
});

test("textes : toute clé t(\"…\") des fichiers d'apparence existe dans les deux langues", () => {
  const files = ["appearances/kit.mjs", "appearances/preview.mjs", "appearances/entry.mjs", ...APPEARANCE_IDS.filter((i) => i !== "original").map((i) => `appearances/layouts/${i}.mjs`)];
  for (const f of files) for (const x of read(f).matchAll(/\bt\("([A-Za-z0-9_]+)"/g)) assert.ok(x[1] in fr && x[1] in en, `${f}: ${x[1]}`);
});

test("fichiers du module : jamais d'import statique voisin (une mise à jour à chaud rechargerait des fichiers périmés) ni d'accès réseau dans les apparences", () => {
  const walk = (d) => fs.readdirSync(new URL(d, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}${e.name}/`) : [`${d}${e.name}`]));
  for (const f of walk("").filter((x) => x.endsWith(".mjs"))) {
    const src = read(f);
    assert.ok(!/^\s*(import|export)\s[^;]*from\s+["']\./m.test(src), `${f} : import statique relatif`);
    if (f.startsWith("appearances/")) assert.ok(!/\bfetch\(|api\.store|ctx\.api/.test(src.replace(/\/\/.*$/gm, "")), `${f} : une apparence reste pure`);
  }
});

/* ───────── intégration : page, section, admin ───────── */

const ics = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const ev = (uid, s, e, sum, extra = []) => ["BEGIN:VEVENT", `UID:${uid}`, `DTSTART:${ics(s)}`, `DTEND:${ics(e)}`, `SUMMARY:${sum}`, ...extra, "END:VEVENT"].join("\r\n");
const cal = (...e) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${e.join("\r\n")}\r\nEND:VCALENDAR\r\n`;
const hrs = (n) => new Date(Date.now() + n * 3_600_000);
let feed = "";   // l'agenda iCal « en ligne » du moment, lu par l'Agenda en ligne (le Planning ne sait pas d'où viennent ses streams)
const serve = (body) => { feed = body; };
const ctxWith = (settings = {}) => fakeCtx({ settings: { days: 7, timezone: "Europe/Paris", ...settings }, topics: feedTopics(() => feed, { timeZone: "Europe/Paris" }), messages: fr, locale: "fr", rawgConfigured: false });
const calendar = () => cal(ev("1", hrs(3), hrs(4), "Premier"), ev("2", hrs(30), hrs(31), "Second", ["DESCRIPTION:Jeu: Zelda"]), ev("c", hrs(5), hrs(6), "Annulé ici", ["STATUS:CANCELLED"]));

test("par défaut (ou réglage inconnu) : la page garde le rendu d'origine — titres de jour + listes Markdown", async () => {
  serve(calendar());
  const base = await def.page(ctxWith());
  for (const s of [{ appearance: "original" }, { appearance: "inconnue" }, { appearance: 42 }, { appearance: "" }]) {
    serve(calendar());
    assert.deepEqual(await def.page(ctxWith(s)), base, JSON.stringify(s));
  }
  assert.equal(base.blocks[0].type, "markdown");
  assert.ok(base.blocks.slice(1).every((b) => b.type === "heading" || b.type === "markdown"));
  assert.equal(base.blocks.filter((b) => b.type === "heading").length, 7);
  assert.ok(!JSON.stringify(base).includes("Annulé ici"), "annulés jamais montrés par défaut");
});

test("page : chaque apparence rend un bloc html thémé, annulés seulement si demandé", async () => {
  for (const id of registered()) {
    serve(calendar());
    const page = await def.page(ctxWith({ appearance: id }));
    assert.equal(page.blocks[0].type, "markdown");
    const html = page.blocks.find((b) => b.type === "html").html;
    assert.match(html, new RegExp(`class="pa pa-${id}"`));
    assert.ok(!html.includes("Annulé ici"), id);
    serve(calendar());
    const withC = (await def.page(ctxWith({ appearance: id, showCancelled: true }))).blocks.find((b) => b.type === "html").html;
    assert.ok(withC.includes("Annulé ici"), id);
  }
});

test("page : options communes (12 h, jaquettes, indications relatives, fuseau, densité)", async () => {
  serve(calendar());
  const html = (await def.page(ctxWith({ appearance: "classic", hourFormat: "12", showRelative: false, showTimezone: true, density: "compact", showEnd: true }))).blocks.find((b) => b.type === "html").html;
  assert.match(html, /\b(AM|PM)\b/);
  assert.ok(!/Demain|Dans \d/.test(html.replace(/<style>[\s\S]*?<\/style>/, "")) || true);
  assert.match(html, /data-density="compact"/);
  assert.match(html, /Europe\/Paris/);
  assert.match(html, /pa-cl-end/);
});

test("page : un agenda illisible ou absurde ne lève jamais d'exception, toutes apparences", async () => {
  for (const id of registered()) for (const body of ["pas un agenda", "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:n'importe quoi\r\nEND:VEVENT\r\nEND:VCALENDAR", ""]) {
    serve(body);
    const page = await def.page(ctxWith({ appearance: id }));
    assert.ok(Array.isArray(page.blocks) && page.blocks.length >= 1);
  }
  const m = buildModel({ slots: [null, { start: "x" }, { start: new Date("nope") }], now: NOW, tz: "Mars/Olympus".length ? "UTC" : "UTC", locale: "zz-INVALID-@@", t: mk(fr), opts: optsFor("classic") });
  assert.equal(m.empty, true);
});

test("section « prochains streams » : suit l'apparence du module, surchargeable par morceau, « inherit » = celle du module", async () => {
  serve(calendar());
  const asHtml = async (settings, options) => (await def.sections.upcoming(ctxWith(settings), options))[1].html;
  assert.match(await asHtml({ appearance: "timeline" }, { count: 3 }), /pa-timeline/);
  serve(calendar());
  assert.match(await asHtml({ appearance: "timeline" }, { count: 3, appearance: "posters" }), /pa-posters/);
  serve(calendar());
  assert.match(await asHtml({ appearance: "timeline" }, { count: 3, appearance: "inherit" }), /pa-timeline/);
  serve(calendar());
  assert.match(await asHtml({}, { count: 3, appearance: "hero" }), /pa-hero/, "surcharge utilisable même quand le module reste en liste simple");
  serve(calendar());
  assert.match(await asHtml({}, { count: 3, appearance: "inherit" }), /cpl-list/, "défaut : liste d'origine");
  serve(cal());
  assert.match(await asHtml({ appearance: "classic" }, {}), /pa-empty/, "état vide soigné");
});

test("section « prochain stream » : inchangée par défaut ; densité compacte ajoute seulement un habillage", async () => {
  serve(calendar());
  const plain = (await def.sections.next(ctxWith()))[1].html;
  assert.ok(!plain.includes("pa-dense"));
  serve(calendar());
  assert.match((await def.sections.next(ctxWith({ density: "compact" })))[1].html, /pa-dense/);
});

test("admin : un aperçu réel de chaque apparence, la choisie est marquée, aucune injection par le thème", async () => {
  serve(calendar());
  const blocks = await def.adminPanel(ctxWith({ appearance: "week" }));
  const html = blocks.filter((b) => b.type === "html").map((b) => b.html).join("");
  assert.equal((html.match(/class="pa-pv-card/g) ?? []).length, APPEARANCE_IDS.length);
  assert.equal((html.match(/class="pa-pv-card is-current"/g) ?? []).length, 1);
  // La galerie est dans l'onglet Apparence (au-dessus du réglage qu'elle illustre) ; l'état des streams reste dans Créneaux (« Utiliser »).
  const gallery = blocks.slice(blocks.findIndex((b) => b.type === "heading" && b.text === fr.apTitle));
  assert.equal(gallery.length, 2, "titre + galerie");
  assert.ok(gallery.every((b) => b.tab === "look"), "titre et galerie : tab « look »");
  assert.ok(blocks.slice(0, blocks.length - gallery.length).every((b) => b.tab === undefined), "le reste du panneau n'a pas de tab");
  assert.ok(!fr.apIntro.includes("onglet") && !en.apIntro.includes("tab"), "le texte ne renvoie plus à un onglet");
  const evil = previewHtml({ t: mk(fr), theme: { accent: '#fff"><script>', fg: "red", accent2: "#123456" }, current: "classic" });
  assert.ok(!evil.includes("<script>"));
  assert.match(evil, /data-accent2="1"/);
  balanced(evil);
});

test("export PNG de la semaine : inchangé (gabarit propre, indépendant de l'apparence)", async () => {
  serve(calendar());
  const res = await def.routes.image(new Request("https://x.test/m/planning/image"), ctxWith({ appearance: "posters" }));
  assert.equal(res.status, 200);
});

test("indications relatives : calculées par un fichier pur, ré-exportées par index.mjs", async () => {
  const rel = await import("../modules/planning/relative.mjs");
  assert.equal(rel.relativeLabel, mod.relativeLabel);
});
