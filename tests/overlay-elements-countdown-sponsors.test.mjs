// Éléments de page d'overlay (cœur 0.5.0, docs/OVERLAY-ELEMENTS.md) de Compte à rebours (« countdown ») et d'Overlay sponsors (« sponsors ») :
// déclaration, adresse, page de l'élément (cadre, style commun, option « Événement »), plusieurs lecteurs, parité FR/EN.
// La non-régression de l'overlay existant est dans overlay-elements-regression.test.mjs ; la conformité du kit (« overlay.elements ») dans conformance.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { parseManifest } from "@/core/modules/manifest";
import { parseAddress } from "@/core/overlays/address";

const core = path.resolve(process.env.CURIOSA_DIR ?? process.cwd());
const { assertMultiReaders } = await import(pathToFileURL(path.join(core, "testsupport/index.mjs")).href);
const read = (m, p) => JSON.parse(fs.readFileSync(new URL(`../modules/${m}/${p}`, import.meta.url), "utf8"));
const cdManifest = read("countdown", "module.json");
const tkManifest = read("sponsor-ticker", "module.json");
const cd = (await import("../modules/countdown/index.mjs")).default;
const tk = (await import("../modules/sponsor-ticker/index.mjs")).default;

// ── Aides ───────────────────────────────────────────────────────────────────────────────────────────────────────────
let seq = 0;
const day = 86_400_000;
const doc = (o = {}) => { const n = ++seq; return { uid: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, slug: `evt-${n}`, rev: 1, title: `Événement ${n}`, allDay: false, date: "2099-06-01", time: "21:00", tz: "UTC", endDate: "", endTime: "", description: "", where: "", endMessage: "", endLinkLabel: "", endLink: "", keep: "", featured: false, image: "", createdAt: "2026-10-01T08:00:00.000Z", updatedAt: "2026-10-01T08:00:00.000Z", ...o }; };
const inMs = (ms, o = {}) => { const d = new Date(Date.now() + ms); return doc({ date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16), ...o }); };
const cdCtx = (rows = [], o = {}) => fakeCtx({ key: `cd${++seq}`, basePath: "countdown", moduleId: "countdown", name: "Compte à rebours", locale: "fr", defaultLocale: "fr", locales: ["fr", "en"], messages: read("countdown", "locales/fr.json"), siteUrl: "https://example.test", settings: { keep: "1d", timezone: "Europe/Paris", showSeconds: true, overlayEndMinutes: 5 }, rows: { events: rows }, ...o });
const CARDS = [{ id: "a", name: "Alpha", text: "Un texte", url: "https://alpha.example/promo", code: "HELLDOG" }, { id: "b", name: "Beta", url: "https://beta.example" }];
const tkCtx = (o = {}) => fakeCtx({ key: "ticker", name: "Mon ticker", locale: "fr", messages: read("sponsor-ticker", "locales/fr.json"), topics: { "sponsor.card": CARDS, "core.entry": [] }, ...o });
/** Ce que le cœur ajoute à l'adresse de l'élément : taille du cadre, style commun, options. */
const frame = (extra = "", w = 600, h = 200) => new URLSearchParams(`ov-w=${w}&ov-h=${h}&ov-fit=scale&ov-lang=fr&ov-text=light&ov-surface=transparent&ov-corners=round${extra ? `&${extra}` : ""}`);
const initialOf = (out) => JSON.parse(out.script.match(/bootOverlay\(window,document,(\{.*\})\);/s)[1]);
const get = (url) => new Request(`https://example.test${url}`);

// ── Déclaration ─────────────────────────────────────────────────────────────────────────────────────────────────────
for (const [name, manifest, def, id] of [["Compte à rebours", cdManifest, cd, "countdown"], ["Overlay sponsors", tkManifest, tk, "sponsors"]]) {
  test(`${name} : manifeste valide, minCore 0.5.0, un élément « ${id} » qui garde ses proportions`, () => {
    const r = parseManifest(manifest);
    assert.ok(r.ok, r.ok ? "" : r.error);
    assert.equal(r.manifest.minCore, "0.5.0");
    assert.equal(r.manifest.version, "1.1.0");
    assert.deepEqual(r.manifest.overlayElements.map((e) => e.id), [id]);
    const e = r.manifest.overlayElements[0];
    assert.equal(e.fit, "scale");
    assert.equal(e.followsStyle, true);
    assert.equal(e.demo, true);
    assert.deepEqual(Object.keys(def.overlayElements), [id], "une fonction par élément déclaré, et inversement");
  });

  test(`${name} : libellés, descriptions et options en français ET en anglais, sans doublon`, () => {
    const e = manifest.overlayElements[0];
    const both = (v, where) => { assert.ok(v && typeof v === "object", where); for (const l of ["fr", "en"]) assert.ok(typeof v[l] === "string" && v[l].trim(), `${where} (${l})`); assert.notEqual(v.fr, v.en, `${where} : traduction identique`); };
    both(e.label, "label"); both(e.description, "description");
    for (const o of e.options) { both(o.label, `option ${o.id}`); if (o.help) both(o.help, `aide ${o.id}`); if (o.type === "text" || o.type === "number") assert.ok(o.example, `exemple ${o.id}`); }
    assert.ok(e.options.length <= 5, "jeu d'options minimal");
    const ids = e.options.map((o) => o.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test(`${name} : l'adresse de l'élément est un chemin du site accepté par le cœur, sans secret ni adresse externe`, () => {
    const ctx = def === cd ? cdCtx() : tkCtx();
    const answer = def.overlayElements[id](ctx, { element: id, fit: "scale", width: 600, height: 200, style: null, options: {}, lang: "en" });
    assert.ok(parseAddress(answer), JSON.stringify(answer));
    assert.equal(answer.url, `/overlays/${ctx.instance.key}?lang=en`, "même adresse que l'overlay existant");
    assert.ok(!/[?&]k=/.test(answer.url));
  });
}

// ── Compte à rebours : la page de l'élément ─────────────────────────────────────────────────────────────────────────
test("Compte à rebours : l'élément remplit son cadre, suit le style commun (--ov-*), ignore place et taille de l'overlay, ne touche pas au site", async () => {
  const ctx = cdCtx([inMs(3 * day, { title: "Sortie", slug: "sortie", featured: true })], { settings: { keep: "1d", overlayPosition: "bottom-right", overlaySize: "l", overlayLook: "light", showSeconds: true, overlayEndMinutes: 5 } });
  const out = await cd.overlay(ctx, { query: frame() });
  assert.match(out.html, /data-ov-region="element"/);
  for (const p of ["panel", "title", "tiles", "tile", "number", "unit", "message"]) assert.match(out.html, new RegExp(`data-ov-part="${p}"`), p);
  assert.match(out.css, /:root\{--ov-fg:#ffffff;--ov-surface:transparent;--ov-radius:12px;--ov-border:transparent\}/);
  assert.match(out.css, /var\(--ov-fg,#fff\)/);
  assert.match(out.css, /var\(--ov-radius/);
  assert.match(out.css, /\.vco\{position:fixed;inset:0;/, "remplit le cadre");
  assert.ok(!/bottom:2\.5vmin|font-size:32px|vco--light/.test(out.css + out.html), "la place, la taille et le style propres à l'overlay sont ignorés");
  assert.match(out.css, /font-size:25px/, "police d'après le cadre 600×200");
  assert.ok(!/--sk-|data-skin|var\(--v-|<link|@import|https?:\/\//.test(out.css + out.html), "aucun skin ni thème du site, aucun chargement tiers");
  assert.equal(initialOf(out).initial.event.title, "Sortie");
});

test("Compte à rebours : le style commun (texte sombre, fond doux, angles droits) devient les jetons", async () => {
  const out = await cd.overlay(cdCtx(), { query: new URLSearchParams("ov-w=300&ov-h=100&ov-text=dark&ov-surface=soft&ov-corners=square") });
  assert.match(out.css, /--ov-fg:#111111;--ov-surface:rgba\(255,255,255,\.7\);--ov-radius:0px;--ov-border:rgba\(0,0,0,\.18\)/);
  assert.match(out.css, /font-size:12px/, "police d'après le cadre 300×100");
});

test("Compte à rebours : option « Événement » — à la une par défaut, un événement précis, repli sur la une si le nom est inconnu ou supprimé", async () => {
  const rows = [inMs(5 * day, { title: "Gros stream", slug: "stream" }), inMs(2 * day, { title: "La sortie", slug: "sortie", featured: true }), inMs(9 * day, { title: "Autre", slug: "autre" })];
  const titleFor = async (extra, r = rows) => initialOf(await cd.overlay(cdCtx(r), { query: frame(extra) })).initial.event?.title ?? null;
  assert.equal(await titleFor(""), "La sortie", "par défaut : l'événement à la une");
  assert.equal(await titleFor("opt-event="), "La sortie");
  assert.equal(await titleFor("opt-event=stream"), "Gros stream", "un événement précis");
  assert.equal(await titleFor("opt-event=autre"), "Autre");
  assert.equal(await titleFor("opt-event=supprime"), "La sortie", "nom inconnu ou supprimé : repli sur la une");
  assert.equal(await titleFor("opt-event=stream", rows.filter((r) => r.slug !== "stream")), "La sortie", "l'événement choisi vient d'être supprimé");
  for (const hostile of ["<script>alert(1)</script>", "../../x", "A B", "x".repeat(300), "%00", "'; drop"]) assert.equal(await titleFor(`opt-event=${encodeURIComponent(hostile)}`), "La sortie", hostile);
  assert.equal(await titleFor("", []), null, "aucun événement : cadre vide, sans erreur");
  // Deux compteurs, deux événements : deux instances (ou la même) donnent deux adresses d'état différentes.
  const a = initialOf(await cd.overlay(cdCtx(rows), { query: frame("opt-event=stream") }));
  const b = initialOf(await cd.overlay(cdCtx(rows), { query: frame("opt-event=autre") }));
  assert.match(a.stateUrl, /&e=stream&el=1$/);
  assert.match(b.stateUrl, /&e=autre&el=1$/);
});

test("Compte à rebours : un événement choisi mais déjà fini n'affiche rien (pas de repli sur un autre) ; la route d'état suit la même règle", async () => {
  const rows = [inMs(-20 * 60_000, { title: "Fini", slug: "fini" }), inMs(2 * day, { title: "La une", slug: "une", featured: true })];
  const ctx = cdCtx(rows);
  assert.equal(initialOf(await cd.overlay(ctx, { query: frame("opt-event=fini") })).initial.event, null);
  const state = async (q) => (await (await cd.routes.state(get(`/m/${ctx.instance.key}/state?${q}`), ctx)).json()).event?.title ?? null;
  assert.equal(await state("e=fini&el=1"), null);
  assert.equal(await state("e=inconnu&el=1"), "La une", "élément : repli sur la une");
  assert.equal(await state("e=inconnu"), null, "overlay habituel : inchangé, aucun repli");
});

test("Compte à rebours : option « secondes » (jamais plus que le réglage du module)", async () => {
  const cfg = async (settings, extra) => initialOf(await cd.overlay(cdCtx([], { settings: { keep: "1d", ...settings } }), { query: frame(extra) })).secs;
  assert.equal(await cfg({}, ""), true);
  assert.equal(await cfg({}, "opt-seconds=0"), false);
  assert.equal(await cfg({ showSeconds: false }, "opt-seconds=1"), false);
});

test("Compte à rebours : mode test (ov-demo=1) montre un événement d'exemple, jamais un vrai, et le garde à chaque relecture", async () => {
  const ctx = cdCtx([inMs(2 * day, { title: "Secret", slug: "secret", featured: true })]);
  const out = await cd.overlay(ctx, { query: frame("ov-demo=1") });
  const c = initialOf(out);
  assert.equal(c.initial.event.title, "Exemple : le grand lancement");
  assert.match(c.stateUrl, /&demo=1$/);
  const st = await (await cd.routes.state(get(`/m/${ctx.instance.key}/state?demo=1`), ctx)).json();
  assert.equal(st.event.title, "Exemple : le grand lancement");
  assert.ok(!JSON.stringify(st).includes("Secret"));
});

// ── Overlay sponsors : la page de l'élément ─────────────────────────────────────────────────────────────────────────
test("Overlay sponsors : l'élément suit le style commun (--ov-*), marque ses morceaux (data-ov-part), ne touche pas au site", () => {
  const out = tk.overlay(tkCtx({ settings: { visual: "cine", accentColor: "#12abEF" } }), { query: frame() });
  assert.match(out.html, /id="tk-stage" data-ov-region="element"/);
  assert.match(out.html, /--tk-bg:var\(--ov-surface,transparent\);--tk-fg:var\(--ov-fg,#fff\)/);
  assert.match(out.html, /--ticker-accent:#12abEF/);
  assert.match(out.css, /:root\{--ov-fg:#ffffff;--ov-surface:transparent;--ov-radius:12px;--ov-border:transparent\}/);
  assert.match(out.css, /\[data-ov-part="panel"\]/);
  assert.match(out.script, /"ticker-card":"panel".*"ticker-qr":"qr"/s, "chaque morceau reçoit son data-ov-part");
  assert.ok(!/--sk-|data-skin|var\(--v-|<link|@import/.test(out.css + out.html + out.script), "aucun skin ni thème du site");
  const dark = tk.overlay(tkCtx(), { query: new URLSearchParams("ov-w=720&ov-h=180&ov-text=dark&ov-surface=soft&ov-corners=square") });
  assert.match(dark.css, /--ov-fg:#111111;--ov-surface:rgba\(255,255,255,\.7\);--ov-radius:0px/);
});

test("Overlay sponsors : l'élément reprend le rendu et les réglages du module (style, durées), mais pas la place", () => {
  const cfg = (settings, extra = "") => JSON.parse(tk.overlay(tkCtx({ settings }), { query: frame(extra) }).script.match(/^\(function\(\)\{var c=(\{.*?\}),slider=/s)[1]);
  const c = cfg({ visual: "broadcast", periodSeconds: 30, holdSeconds: 8 });
  assert.deepEqual([c.visual, c.period, c.hold, c.startDelay, c.showQr], ["broadcast", 30, 8, 5, true]);
  assert.equal(cfg({}, "opt-qr=0").showQr, false, "option « QR code »");
  assert.equal(cfg({ showQr: false }, "opt-qr=1").showQr, false, "jamais plus que le réglage du module");
  assert.equal(cfg({ devMode: true }, "dev=1").period, 4, "réglage du module inchangé");
});

test("Overlay sponsors : mode test — bandeau tout de suite et gardé à l'écran, carte d'exemple s'il n'y a aucun sponsor", async () => {
  const c = JSON.parse(tk.overlay(tkCtx(), { query: frame("ov-demo=1") }).script.match(/^\(function\(\)\{var c=(\{.*?\}),slider=/s)[1]);
  assert.deepEqual([c.startDelay, c.hold > 600, c.period > c.hold], [0.4, true, true]);
  assert.match(c.itemsUrl, /&demo=1$/);
  const empty = tkCtx({ topics: { "sponsor.card": [], "core.entry": [] } });
  const demo = await (await tk.routes.items(get("/m/ticker/items?demo=1"), empty)).json();
  assert.equal(demo.items.length, 1);
  assert.equal(demo.items[0].name, "Exemple de sponsor");
  assert.deepEqual((await (await tk.routes.items(get("/m/ticker/items"), empty)).json()).items, [], "sans demo : aucun sponsor inventé");
  assert.equal((await (await tk.routes.items(get("/m/ticker/items?demo=1"), tkCtx())).json()).items.length, 2, "de vrais sponsors : ce sont eux qui sont montrés");
});

test("Overlay sponsors : valeurs hostiles dans l'adresse ignorées (taille, options)", () => {
  for (const q of ["ov-w=abc&ov-h=-1&ov-text=%3Cx%3E&ov-surface=%22&ov-corners=zzz&opt-qr=%3Cscript%3E&ov-demo=2", "ov-w=1&opt-qr=x".repeat(3)]) {
    const out = tk.overlay(tkCtx(), { query: new URLSearchParams(q) });
    assert.ok(!/<script>|<x>/.test(out.html + out.css), q);
  }
});

// ── Plusieurs lecteurs ──────────────────────────────────────────────────────────────────────────────────────────────
// Ni l'un ni l'autre ne suit un flux d'événements consommé : chaque lecture est un instantané, rien n'est retiré au premier lecteur.
// Le test du kit ouvre plusieurs lecteurs de l'élément (celui qui lit la route de données de la page) et vérifie que chacun voit tout, dans l'ordre, une seule fois.
test("Compte à rebours : plusieurs pages d'overlay peuvent lire le même compte à rebours (assertMultiReaders)", async () => {
  const ctx = cdCtx();
  const slugs = [];
  await assertMultiReaders({
    readers: 4,
    publish: async (title) => { const row = doc({ title, slug: `m${slugs.length}`, date: "2099-06-01" }); slugs.push(row.slug); await ctx.api.store.add("events", row); },
    open: async () => {
      const seen = new Set(slugs); // le repère est pris TOUT DE SUITE, à la fin du flux
      return { read: async () => {
        const fresh = [];
        for (const slug of slugs) {
          if (seen.has(slug)) continue;
          const ev = (await (await cd.routes.state(get(`/m/${ctx.instance.key}/state?e=${slug}&el=1`), ctx)).json()).event;
          if (ev && ev.slug === slug) { seen.add(slug); fresh.push(ev.title); }
        }
        return fresh;
      } };
    },
  });
  // Et la page elle-même, ouverte deux fois avec des événements différents, ne partage rien.
  const [a, b] = await Promise.all(["m0", "m1"].map((e) => cd.overlay(ctx, { query: frame(`opt-event=${e}`) })));
  assert.equal(initialOf(a).initial.event.title, "evt-1");
  assert.equal(initialOf(b).initial.event.title, "evt-2");
});

test("Overlay sponsors : plusieurs pages d'overlay peuvent lire le même bandeau (assertMultiReaders)", async () => {
  const cards = [];
  const ctx = tkCtx({ topics: { "sponsor.card": () => cards.slice(), "core.entry": [] } });
  await assertMultiReaders({
    readers: 4,
    publish: async (name) => { cards.push({ id: name, name, url: `https://${name}.example` }); },
    open: async () => {
      const list = async () => (await (await tk.routes.items(get("/m/ticker/items?demo=1"), ctx)).json()).items;
      const seen = new Set((await list()).map((i) => i.id)); // le repère est pris TOUT DE SUITE, à la fin du flux
      return { read: async () => {
        const items = await list();
        const fresh = items.filter((i) => !seen.has(i.id));
        fresh.forEach((i) => seen.add(i.id));
        return fresh.map((i) => i.name);
      } };
    },
  });
});
