// Sondages 1.3.0 : l'ÉLÉMENT « Sondage en direct » des pages d'overlay (cœur 0.5.0, docs/OVERLAY-ELEMENTS.md).
// Il réutilise l'overlay actuel (aucune copie) : ce fichier vérifie le manifeste, l'adresse (avec le code secret ajouté côté serveur), la page de l'élément (remplit le cadre,
// jetons --ov-*, attributs data-ov-part, jamais de skin du site), l'option « Quel sondage » (repli sans rien casser), le multi-lecteurs (assertMultiReaders), la mise à jour douce
// avec Participation, et que l'overlay actuel ne change pas (non-régression).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { world, pollsMod, pollsDef, pollsFr, pollsEn, post, get, tok } from "./helpers/audienceWorld.mjs";
import { def as audDef, K as AK, req as areq } from "./helpers/audienceHarness.mjs";
import { parseManifest } from "@/core/modules/manifest";
import { parseAddress, finalAddress } from "@/core/overlays/address";

const core = path.resolve(process.env.CURIOSA_DIR ?? process.cwd());
const { assertMultiReaders } = await import(pathToFileURL(path.join(core, "testsupport/index.mjs")).href);
const L = await import("../modules/polls/lib.mjs");
const manifestJson = JSON.parse(fs.readFileSync(new URL("../modules/polls/module.json", import.meta.url), "utf8"));
const decl = manifestJson.overlayElements[0];

const make = async (c, over = {}) => {
  const v = L.validatePollForm({ question: "Quel jeu ?", choices: "Hollow Knight\nCeleste\nHades", max: 1, ...over }, { tz: "Europe/Paris" });
  assert.deepEqual(v.errors, {}, JSON.stringify(v.errors));
  const r = await pollsMod.createPoll(c, v.value, "Europe/Paris"); assert.ok(r.ok); return r;
};
const cfgOf = async (c) => {
  let r = (await c.api.store.list("meta")).find((x) => x.data.k === "cfg");
  if (!r) { await pollsDef.hooks.onInstanceCreate(c); r = (await c.api.store.list("meta")).find((x) => x.data.k === "cfg"); }
  return r.data;
};
const room = (w) => `polls:${w.polls.instance.key}`;
const castVote = (c, slug, i, ip = `10.1.${i % 250}.${1 + Math.floor(i / 250)}`) => pollsDef.routes.vote(post("https://x.test/m/polls/vote", { poll: slug, t: tok(i), c: ["c1"] }, ip), c);
const liveRoute = async (c, key, qs = "", rev = "") => (await pollsDef.routes.live(get(`https://x.test/m/${c.instance.key}/live?k=${key}${qs}${rev ? `&rev=${rev}` : ""}`, "7.7.7.7"), c)).json();
const STYLE = { text: "light", background: "transparent", corners: "round" };
const request = (over = {}) => ({ element: "poll", fit: "fluid", width: 900, height: 300, style: STYLE, options: { poll: "" }, lang: "fr", ...over });
const elementQuery = (key, extra = {}) => new URLSearchParams({ k: key, "ov-w": "900", "ov-h": "300", "ov-fit": "fluid", "ov-lang": "fr", "ov-text": "light", "ov-surface": "transparent", "ov-corners": "round", "opt-poll": "", ...extra });
const cfgOfScript = (o) => JSON.parse(/window\.__VO=(\{.*?\});\(function/s.exec(o.script)[1].replace(/\\u003c/g, "<"));

/* ───────────── Manifeste ───────────── */

test("manifeste : valide pour le cœur 0.5.0 ; un élément « poll », fluide, plage de ratios et taille minimale, suit le style, contenu d'exemple, une seule option « Quel sondage »", () => {
  const r = parseManifest(manifestJson); assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(manifestJson.version, "1.3.1"); assert.equal(manifestJson.minCore, "0.5.0");
  assert.equal(manifestJson.overlayElements.length, 1);
  assert.equal(decl.id, "poll"); assert.equal(decl.fit, "fluid"); assert.equal(decl.followsStyle, true); assert.equal(decl.demo, true);
  assert.deepEqual(decl.minSize, { width: 320, height: 200 });
  assert.ok(decl.ratios.min <= 400 / 600 && decl.ratios.max >= 1600 / 400, "les cadres 400×600, 900×300 et 1600×400 sont dans la plage");
  assert.deepEqual(decl.options.map((o) => [o.id, o.type]), [["poll", "text"]]);
  assert.ok(decl.options[0].example && decl.options[0].help.fr && decl.options[0].help.en);
  for (const k of ["fr", "en"]) { assert.ok(decl.label[k] && decl.description[k]); assert.ok(decl.options[0].label[k]); }
  assert.equal(typeof pollsDef.overlayElements.poll, "function");
  assert.deepEqual(Object.keys(pollsDef.overlayElements), manifestJson.overlayElements.map((e) => e.id), "chaque élément déclaré a sa fonction, et inversement");
});

test("textes de l'élément : parité FR/EN, mots simples, vouvoiement, pas de supposition de genre", () => {
  assert.deepEqual(Object.keys(pollsFr).sort(), Object.keys(pollsEn).sort());
  for (const k of ["ovDemoQuestion", "ovDemoA", "ovDemoB", "ovDemoC"]) assert.ok(pollsFr[k] && pollsEn[k], k);
  const text = JSON.stringify(decl.options[0].help.fr) + JSON.stringify(decl.description.fr);
  assert.ok(!/\btu\b|\bton\b|\bta\b|\btes\b/i.test(text), "vouvoiement");
  assert.ok(!/\bfluid\b|\bscale\b|iframe|fit\b/i.test(JSON.stringify([decl.label, decl.description, decl.options.map((o) => [o.label, o.help])])), "les mots techniques ne sont pas montrés aux personnes");
});

/* ───────────── Adresse de l'élément ───────────── */

test("overlayElements.poll : l'adresse de l'overlay actuel avec le code secret ajouté côté serveur ; chemin accepté par le cœur ; une adresse propre à chaque instance", async () => {
  const w = world(); const w2 = world();
  const a = await pollsDef.overlayElements.poll(w.polls, request());
  const key = (await cfgOf(w.polls)).obsKey;
  assert.equal(a.url, `/overlays/${w.polls.instance.key}?k=${encodeURIComponent(key)}&lang=fr`);
  const parsed = parseAddress(a); assert.ok(parsed, "le cœur accepte l'adresse");
  assert.equal(parsed.path, `/overlays/${w.polls.instance.key}`); assert.equal(parsed.search.get("k"), key);
  assert.equal((await pollsDef.overlayElements.poll(w.polls, request())).url, a.url, "stable d'un appel à l'autre (un seul code, pas un par lecteur)");
  assert.notEqual((await pollsDef.overlayElements.poll(w2.polls, request())).url, a.url);
  assert.ok(!(await pollsDef.overlayElements.poll(w.polls, request({ lang: "x\"><script>" }))).url.includes("script"), "langue invalide : ignorée");
  // le cœur ajoute ov-* et opt-* (et retire ceux que le module aurait mis)
  const fin = finalAddress(parsed, { decl, layout: { iframeW: 900, iframeH: 300 }, style: STYLE, options: { poll: "quel-jeu" }, lang: "fr" });
  const q = new URL(fin, "https://x.test").searchParams;
  assert.deepEqual([q.get("k"), q.get("ov-fit"), q.get("ov-w"), q.get("ov-h"), q.get("opt-poll"), q.get("ov-text")], [key, "fluid", "900", "300", "quel-jeu", "light"]);
  // « Changer l'adresse secrète » du module coupe l'ancienne adresse de l'élément : la prochaine demande du cœur donne la nouvelle
  const r = await pollsDef.adminActions.regenerate(w.polls, { confirm: "on" }); assert.ok(!r?.error, JSON.stringify(r));
  const fresh = await pollsDef.overlayElements.poll(w.polls, request());
  assert.notEqual(fresh.url, a.url); assert.ok(fresh.url.includes(encodeURIComponent((await cfgOf(w.polls)).obsKey)));
  assert.equal((await pollsDef.routes.live(get(`https://x.test/m/x/live?k=${key}`), w.polls)).status, 404, "l'ancien code ne marche plus");
});

/* ───────────── La page de l'élément ───────────── */

test("page de l'élément : remplit le cadre (aucune place de l'overlay du module), jetons --ov-* avec repli, attributs data-ov-part, aucun skin du site, aucun chargement tiers", async () => {
  const w = world({ pollsSettings: { obsPosition: "right" } }); await make(w.polls);
  const key = (await cfgOf(w.polls)).obsKey;
  const o = await pollsDef.overlay(w.polls, { query: elementQuery(key) });
  assert.match(o.html, /data-ov-region="element"/);
  assert.ok(!/right:32px|bottom:32px|width:min\(640px/.test(o.css), "la place choisie pour l'overlay du module est ignorée");
  assert.match(o.css, /position:fixed;inset:0/);
  for (const t of ["--ov-fg", "--ov-surface", "--ov-radius", "--ov-border"]) assert.ok(o.css.includes(t), t);
  assert.match(o.css, /var\(--ov-fg,#/, "chaque jeton a son repli");
  assert.ok(!/\.vo-[a-z]+\s*\{/.test(o.css), "aucune classe en dur : tout passe par data-ov-part");
  for (const p of ["panel", "body", "status", "question", "choices", "choice", "bar", "bar-fill", "foot"]) assert.ok(o.css.includes(`data-ov-part="${p}"`), p);
  const all = JSON.stringify(o);
  assert.ok(!/--sk-|data-skin|skin/i.test(all), "jamais le skin du site");
  assert.ok(!/https?:\/\//.test(o.css + o.html), "aucun chargement tiers");
  assert.ok(!/@import|url\(/.test(o.css));
  assert.equal(cfgOfScript(o).el, true);
  assert.match(o.css, /min-aspect-ratio:9\/5/, "cadre large : une autre mise en page");
  // le style commun : texte sombre, fond semi-transparent, angles droits
  const dark = await pollsDef.overlay(w.polls, { query: elementQuery(key, { "ov-text": "dark", "ov-surface": "soft", "ov-corners": "square" }) });
  assert.ok(dark.css.includes("--ov-fg:#111111") && dark.css.includes("--ov-surface:rgba(255,255,255,.7)") && dark.css.includes("--ov-radius:0px"));
  const light = await pollsDef.overlay(w.polls, { query: elementQuery(key, { "ov-surface": "soft" }) });
  assert.ok(light.css.includes("--ov-fg:#ffffff") && light.css.includes("--ov-surface:rgba(0,0,0,.55)") && light.css.includes("--ov-radius:12px"));
  // sans style transmis : les couleurs propres du module (repli)
  const q = elementQuery(key); for (const p of ["ov-text", "ov-surface", "ov-corners"]) q.delete(p);
  const own = await pollsDef.overlay(w.polls, { query: q });
  assert.ok(!own.css.includes(":root{--ov-fg"));
});

test("page de l'élément sans le bon code : un cadre vide et silencieux (jamais de message dans le direct)", async () => {
  const w = world(); await make(w.polls);
  const o = await pollsDef.overlay(w.polls, { query: elementQuery("mauvaise-cle-aaaaaaaaaa") });
  assert.equal(o.html, ""); assert.ok(!o.script && !o.css);
});

test("mode test (ov-demo=1) : un sondage d'exemple, rien n'est demandé au site ni à Participation, jamais un vrai sondage", async () => {
  const w = world(); await make(w.polls, { question: "SECRET question" });
  const key = (await cfgOf(w.polls)).obsKey; const before = w.state.calls.length;
  const o = await pollsDef.overlay(w.polls, { query: elementQuery(key, { "ov-demo": "1" }) });
  const cfg = cfgOfScript(o);
  assert.equal(cfg.demo.rows.length, 3); assert.equal(cfg.demo.question, pollsFr.ovDemoQuestion);
  assert.ok(!JSON.stringify(o).includes("SECRET question"));
  assert.equal(cfg.alt, null); assert.ok(!cfg.url.includes("/direct"));
  assert.equal(w.state.calls.length, before, "aucun appel à Participation");
  const en = await pollsDef.overlay(Object.assign(Object.create(w.polls), { t: (k, v) => pollsEn[k]?.replace?.(/\{(\w+)\}/g, (_, n) => v?.[n] ?? "") ?? k, locale: "en" }), { query: elementQuery(key, { "ov-demo": "1" }) });
  assert.equal(cfgOfScript(en).demo.question, pollsEn.ovDemoQuestion);
});

/* ───────────── Option « Quel sondage » ───────────── */

test("« Quel sondage » : vide = le choix automatique de l'écran en direct ; un nom d'adresse (ou un identifiant) = ce sondage ; inconnu ou supprimé = repli, sans rien casser", async () => {
  const w = world({ audience: false });
  const a = await make(w.polls, { question: "Premier ?" }); await new Promise((r) => setTimeout(r, 5));
  const b = await make(w.polls, { question: "Second ?" });
  const key = (await cfgOf(w.polls)).obsKey;
  assert.equal((await liveRoute(w.polls, key)).question, "Second ?", "automatique : le plus récent ouvert");
  assert.equal((await liveRoute(w.polls, key, `&want=${a.slug}`)).question, "Premier ?", "un sondage précis");
  assert.equal((await liveRoute(w.polls, key, `&want=${encodeURIComponent(a.id)}`)).question, "Premier ?", "par identifiant aussi");
  assert.equal((await liveRoute(w.polls, key, "&want=n-existe-pas")).question, "Second ?", "inconnu : repli automatique");
  assert.equal((await liveRoute(w.polls, key, `&want=${encodeURIComponent("<b>x</b>'\"; DROP")}`)).question, "Second ?", "valeur hostile : repli");
  await pollsDef.mcp.poll_delete(w.polls, { id: a.id, allowOpen: true });
  assert.equal((await liveRoute(w.polls, key, `&want=${a.slug}`)).question, "Second ?", "sondage supprimé depuis : repli, pas d'erreur");
  await pollsDef.mcp.poll_close(w.polls, { id: b.id });
  assert.equal((await liveRoute(w.polls, key, `&want=${b.slug}`)).state, "closed", "un sondage terminé reste montrable (résultat final)");
  // le sondage choisi dans « En direct » (À l'écran) reste le choix automatique
  const c = await make(w.polls, { question: "Troisième ?" });
  assert.equal((await liveRoute(w.polls, key)).question, "Troisième ?");
  // la page de l'élément envoie l'option à la route (et seulement en mode élément)
  const el = await pollsDef.overlay(w.polls, { query: elementQuery(key, { "opt-poll": b.slug }) });
  assert.ok(cfgOfScript(el).url.endsWith(`&want=${b.slug}`));
  const none = await pollsDef.overlay(w.polls, { query: elementQuery(key) });
  assert.ok(!cfgOfScript(none).url.includes("want="));
  const legacy = await pollsDef.overlay(w.polls, { query: new URLSearchParams({ k: key, "opt-poll": b.slug }) });
  assert.ok(!cfgOfScript(legacy).url.includes("want="), "l'overlay actuel ne lit pas les options des éléments");
  assert.ok(c.slug);
});

test("l'option vide ou hostile ne fait jamais lever l'élément (kit : valeurs extrêmes)", async () => {
  const w = world();
  for (const poll of ["", " ", "x".repeat(100), "../../etc", "a b", "<script>", "é\u0000"]) {
    const a = await pollsDef.overlayElements.poll(w.polls, request({ options: { poll } }));
    assert.ok(parseAddress(a));
  }
});

/* ───────────── Participation : direct ou route du module ───────────── */

test("avec Participation : l'élément lit le point de direct (repli sur la route du module) ; avec « Quel sondage » précis ou sans Participation : la route du module", async () => {
  const w = world(); const { slug } = await make(w.polls);
  const key = (await cfgOf(w.polls)).obsKey;
  const auto = cfgOfScript(await pollsDef.overlay(w.polls, { query: elementQuery(key) }));
  assert.equal(auto.url, `/m/${w.aud.instance.key}/direct?room=${encodeURIComponent(room(w))}&channel=screen&k=${key}`);
  assert.equal(auto.alt, `/m/${w.polls.instance.key}/live?k=${key}`);
  const picked = cfgOfScript(await pollsDef.overlay(w.polls, { query: elementQuery(key, { "opt-poll": slug }) }));
  assert.equal(picked.url, `/m/${w.polls.instance.key}/live?k=${key}&want=${slug}`); assert.equal(picked.alt, null);
  const alone = world({ audience: false }); await make(alone.polls); const k2 = (await cfgOf(alone.polls)).obsKey;
  const lone = cfgOfScript(await pollsDef.overlay(alone.polls, { query: elementQuery(k2) }));
  assert.equal(lone.url, `/m/${alone.polls.instance.key}/live?k=${k2}`); assert.equal(lone.alt, null);
});

/* ───────────── Plusieurs lecteurs ───────────── */

/** Le « flux » d'un sondage : chaque vote est un événement (« evt-N » = le N-ième bulletin). Le repère d'un lecteur est SON dernier nombre de votants vu ; le module ne retient rien de lui. */
const countFeed = (w, readOnce) => {
  const slugP = make(w.polls, { question: "Flux ?" });
  let votes = 0;
  return {
    publish: async (event) => { const { slug } = await slugP; const n = Number(event.split("-")[1]); votes = Math.max(votes, n); assert.equal((await castVote(w.polls, slug, n)).status, 200); },
    open: async () => {
      await slugP; const me = `reader-${Math.random().toString(36).slice(2)}`;
      let seen = (await readOnce(me, "")).voters ?? 0, rev = "";
      return { read: async () => { const d = await readOnce(me, rev); if (d.unchanged) return []; rev = d.rev; const out = []; for (let i = seen + 1; i <= d.voters; i++) out.push(`evt-${i}`); seen = Math.max(seen, d.voters); return out; } };
    },
  };
};

test("plusieurs pages d'overlay lisent le même sondage (route du module) : chaque lecteur reçoit tout, rien n'est consommé par le premier (assertMultiReaders)", async () => {
  const w = world({ audience: false }); await pollsDef.hooks.onInstanceCreate(w.polls); const key = (await cfgOf(w.polls)).obsKey;
  const feed = countFeed(w, async (_me, rev) => { const d = await liveRoute(w.polls, key, "", rev); return d.unchanged ? { unchanged: true } : d; });
  await assertMultiReaders({ ...feed, readers: 5 });
});

test("plusieurs pages d'overlay lisent le même sondage (point de direct de Participation) : mêmes événements pour tous, chaque lecteur avec son propre repère (assertMultiReaders)", async () => {
  const w = world(); await pollsDef.hooks.onInstanceCreate(w.polls); const key = (await cfgOf(w.polls)).obsKey;
  let ip = 0;
  const feed = countFeed(w, async (me, rev) => {
    const r = await (await audDef.routes.direct(areq(`https://x.test/m/${w.aud.instance.key}/direct?room=${encodeURIComponent(room(w))}&channel=screen&k=${key}${rev ? `&rev=${rev}` : ""}`, undefined, { ip: `9.4.${(me.length * 7) % 200}.${(ip++ % 200) + 1}` }), w.aud)).json();
    return r.unchanged ? { unchanged: true } : { rev: r.rev, voters: r.data?.voters };
  });
  await assertMultiReaders({ ...feed, readers: 6 });
});

test("mise à jour douce et bornée avec plusieurs lecteurs : la lecture ne publie rien, les réponses sans changement sont minuscules, l'écart demandé s'allonge avec le nombre de lecteurs", async () => {
  const w = world(); const { slug } = await make(w.polls); await castVote(w.polls, slug, 1);
  const key = (await cfgOf(w.polls)).obsKey;
  const direct = (rev, ip) => audDef.routes.direct(areq(`https://x.test/m/${w.aud.instance.key}/direct?room=${encodeURIComponent(room(w))}&channel=screen&k=${key}${rev ? `&rev=${rev}` : ""}`, undefined, { ip }), w.aud).then((r) => r.json());
  const first = await direct("", "9.5.0.1"); assert.ok(first.data && first.rev);
  const publishes = () => w.state.calls.filter(([m]) => m === "livePublish").length;
  const before = publishes();
  // 30 lecteurs, 3 lectures chacun, sans aucun changement : zéro publication, réponses « inchangé » sans données
  let nexts = [];
  for (let r = 0; r < 3; r++) for (let i = 0; i < 30; i++) { const d = await direct(first.rev, `9.5.1.${i + 1}`); assert.equal(d.unchanged, true); assert.equal(d.data, undefined); nexts.push(d.next); }
  assert.equal(publishes(), before, "lire ne publie jamais");
  assert.ok(nexts.every((n) => n >= 1000 && n <= 30_000), "l'intervalle conseillé reste borné");
  // beaucoup de lectures dans la minute : l'écart conseillé s'allonge (borné à 30 s)
  for (let i = 0; i < 250; i++) await direct(first.rev, `9.6.${Math.floor(i / 200)}.${(i % 200) + 1}`);
  const crowded = await direct(first.rev, "9.7.0.1");
  assert.ok(crowded.next > nexts[0] && crowded.next <= 30_000, `l'écart s'allonge (${nexts[0]} → ${crowded.next})`);
  // un changement est publié une seule fois, quel que soit le nombre de lecteurs, et chacun le reçoit
  await castVote(w.polls, slug, 2);
  const after = publishes(); assert.ok(after - before <= 4, `au plus la publication de l'écran et du public (${after - before})`);
  const rec = await Promise.all(Array.from({ length: 12 }, (_, i) => direct(first.rev, `9.8.0.${i + 1}`)));
  assert.ok(rec.every((d) => d.data?.voters === 2));
  assert.equal(publishes(), after, "douze lecteurs ne publient rien de plus");
  // ouvrir la page de l'élément (rechargement) plusieurs fois de suite : publications regroupées, pas une par page
  const p0 = publishes();
  await Promise.all(Array.from({ length: 10 }, () => pollsDef.overlay(w.polls, { query: elementQuery(key) })));
  assert.ok(publishes() - p0 <= 4, `dix pages ouvertes ensemble : publications regroupées (${publishes() - p0})`);
  assert.ok(AK.mem.reads.length > 0);
});

/* ───────────── Non-régression : l'overlay actuel ───────────── */

test("non-régression : l'overlay actuel garde son adresse, son rendu et ses réglages (même feuille de style, même page, même configuration, sans clé d'élément)", async () => {
  const w = world({ audience: false, pollsSettings: { obsPosition: "right", obsAccent: "#ff0066" } }); await make(w.polls);
  const key = (await cfgOf(w.polls)).obsKey;
  const o = await pollsDef.overlay(w.polls, { query: new URLSearchParams({ k: key }) });
  assert.equal(o.html, `<div id="vo-box" role="status" aria-live="polite"></div>`);
  assert.match(o.css, /#vo-box\{position:fixed;right:32px;bottom:32px;width:min\(640px,calc\(100vw - 64px\)\)\}/);
  assert.match(o.css, /\.vo-card\{background:/); assert.ok(o.css.includes("#ff0066"));
  const cfg = cfgOfScript(o);
  assert.deepEqual(Object.keys(cfg), ["url", "alt", "base", "max", "lang", "t"], "aucune clé de configuration en plus pour l'overlay actuel");
  assert.equal(cfg.url, `/m/${w.polls.instance.key}/live?k=${key}`);
  assert.ok(!o.css.includes("--ov-") && !o.html.includes("data-ov-") && !o.script.includes('"el":true'));
  // l'adresse d'un sondage épinglé : toujours stricte (un sondage supprimé n'affiche RIEN, jamais un autre)
  const { slug } = await make(w.polls, { question: "Autre ?" });
  assert.equal((await liveRoute(w.polls, key, `&poll=${slug}`)).question, "Autre ?");
  assert.equal((await liveRoute(w.polls, key, "&poll=n-existe-pas")).empty, true);
  assert.equal((await liveRoute(w.polls, key, "&want=n-existe-pas&poll=n-existe-pas")).empty, true, "« poll » (adresse actuelle) reste strict même avec « want »");
  const wrong = await pollsDef.overlay(w.polls, { query: new URLSearchParams({ k: "mauvaise-cle-aaaaaaaaaa" }) });
  assert.match(wrong.html, /Adresse incomplète/, "sans code, l'overlay actuel dit toujours pourquoi");
  // la page de l'overlay actuel dessine les mêmes classes (en plus des attributs) : rien à refaire dans OBS
  assert.ok(o.script.includes('"vo-card"') && o.script.includes('"vo-fill"') && o.script.includes('"vo-decision"'));
  assert.equal(typeof pollsDef.services["audience.remote"].press, "function");
});
