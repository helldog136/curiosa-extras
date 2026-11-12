// Raid Twitch 2.4.0 : deux ÉLÉMENTS des pages d'overlay (cœur 0.5.0, docs/OVERLAY-ELEMENTS.md) : « Partenaires à la une » (featured) et « Partenaires en direct » (live).
// Au repos : rien n'est dessiné. Avec des données : nom, jeu, audience. Vie privée : jamais une personne « Ne pas montrer », une fiche « à relire », un nom de la liste « Ne jamais tirer »,
// ni pseudo, titre de direct, vignette ou commande de raid ; un état inconnu donne un cadre vide.
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { parseManifest } from "@/core/modules/manifest";
import { parseAddress, finalAddress } from "@/core/overlays/address";
import { world, logins, login, manifest, fr, en, T0 } from "./helpers/twitch-raid-world.mjs";

const mod = await import("../modules/twitch-raid/index.mjs");
const def = mod.default;
const live = await import("../modules/twitch-raid/live.mjs");
const search = await import("../modules/twitch-raid/search.mjs");
const source = await import("../modules/twitch-raid/source.mjs");
const M = await import("../modules/twitch-raid/moment.mjs");
const EL = await import("../modules/twitch-raid/element.mjs");

const MIN = 60_000;
beforeEach(() => { live.resetLive(); search.resetSearch(); source.resetSource(); M.resetMoment(); M.hooks.now = () => T0; M.hooks.rng = null; });
afterEach(() => { M.hooks.now = () => Date.now(); });

const STYLE = { text: "light", background: "transparent", corners: "round" };
const q = (o = {}) => new URLSearchParams(Object.entries({ "ov-fit": "fluid", "ov-w": "900", "ov-h": "300", "ov-text": "light", "ov-surface": "transparent", "ov-corners": "round", ...o }));
const lives = (n, from = 0) => Object.fromEntries(logins(n, from).map((l, i) => [l, { viewers: 5 + i * 3, minutes: 20 + i, game: `Jeu ${i}`, title: `Titre secret ${i}` }]));
const keyOf = async (w, id = "live") => new URL(`https://x.test${(await def.overlayElements[id](w.ctx, { lang: "fr" })).url}`).searchParams.get("k");
const call = async (w, slug, { data = true, k, extra = {}, method = "GET" } = {}) => {
  const key = k ?? await keyOf(w, slug);
  w.ctx.params = { slug };
  return def.routes[data ? "element-data/:slug" : "element/:slug"](new Request(`https://example.test/m/x/element${data ? "-data" : ""}/${slug}?${q({ k: key, ...extra })}`, { method }), w.ctx);
};
const dataOf = async (w, slug, extra) => (await call(w, slug, { extra })).json();
const names = (d) => d.rows.map((r) => r.name.toLowerCase());
const site = (o = {}) => world({ partners: logins(o.partners ?? 12), live: o.live ?? lives(o.liveCount ?? 12), settings: o.settings ?? {}, ...(o.extra ?? {}) });

test("manifeste : valide, 2.4.0, minCore 0.5.0 ; deux éléments fluides qui suivent le style, avec exemple ; options minimales ; une fonction par élément", () => {
  const r = parseManifest(manifest); assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(manifest.version, "2.5.0"); assert.equal(manifest.minCore, "0.11.0");
  assert.deepEqual(manifest.overlayElements.map((e) => [e.id, e.fit, e.followsStyle, e.demo]), [["featured", "fluid", true, true], ["live", "fluid", true, true]]);
  assert.deepEqual(Object.keys(def.overlayElements), manifest.overlayElements.map((e) => e.id));
  for (const e of manifest.overlayElements) {
    assert.ok(e.label.fr && e.label.en && e.description.fr && e.description.en, e.id);
    assert.ok(e.ratios.min <= 400 / 600 && e.ratios.max >= 1600 / 400 && e.minSize.width <= 400 && e.minSize.height <= 300);
    assert.ok(e.options.length <= 5);
    for (const o of e.options) assert.ok(o.label.fr.length <= 60 && o.label.en.length <= 60 && !/:$/.test(o.label.fr), o.id);
  }
  const max = manifest.overlayElements[1].options.find((o) => o.id === "max");
  assert.deepEqual([max.type, max.min, max.max, max.default, max.integer, max.example], ["number", 1, 10, 5, true, "5"]);
  assert.ok(!/\b(token|jeton|webhook|API|slug|instance|identifiant)\b/i.test(JSON.stringify(manifest.overlayElements)));
  assert.ok(manifest.privacy.fr.includes("éléments d'overlay") && manifest.privacy.en.includes("overlay elements"));
  assert.ok(manifest.privacy.fr.length <= 500 && manifest.privacy.en.length <= 500);
});

test("textes : parité FR/EN, clés présentes, variables identiques", () => {
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  for (const k of ["ov_featured_title", "ov_live_title", "ov_more", "ov_demoGame"]) assert.ok(fr[k] && en[k], k);
  assert.deepEqual(fr.ov_more.match(/\{\w+\}/g), en.ov_more.match(/\{\w+\}/g));
});

test("adresse : un chemin du site accepté par le cœur, avec la clé du dock ajoutée côté serveur ; « Nouvelle adresse » la change pour les éléments aussi", async () => {
  const w = site();
  const a = await def.overlayElements.featured(w.ctx, { lang: "fr" }), b = await def.overlayElements.live(w.ctx, { lang: "en" });
  for (const r of [a, b]) assert.ok(parseAddress(r), r.url);
  assert.match(a.url, /^\/m\/raid\d+\/element\/featured\?k=[\w-]{20,}&lang=fr$/); assert.match(b.url, /\/element\/live\?k=.*&lang=en$/);
  const dock = await (await import("../modules/twitch-raid/data.mjs")).dockSecret(w.ctx);
  assert.equal(await keyOf(w, "featured"), dock, "la même clé que le dock");
  const f = new URL(`https://x.test${finalAddress(parseAddress(b), { decl: manifest.overlayElements[1], layout: { iframeW: 900, iframeH: 300 }, style: STYLE, options: { max: 3, title: false, game: true }, lang: "en" })}`).searchParams;
  assert.deepEqual([f.get("opt-max"), f.get("opt-title"), f.get("opt-game"), f.get("ov-fit")], ["3", "0", "1", "fluid"]);
  const old = await keyOf(w, "live");
  const fresh = await (await import("../modules/twitch-raid/data.mjs")).renewSecret(w.ctx);
  assert.notEqual(fresh, old);
  assert.equal((await call(w, "live", { k: old })).status, 404, "l'ancienne adresse ne marche plus");
  assert.equal((await call(w, "live", { k: fresh })).status, 200);
  assert.equal(await keyOf(w, "live"), fresh, "le cœur obtient la nouvelle adresse au prochain chargement");
});

test("accès : sans clé, mauvaise clé, élément inconnu, autre méthode = comme si la route n'existait pas ; rien n'est lu chez Twitch ni Contacts", async () => {
  const w = site(); await keyOf(w);
  const before = w.api.calls.length;
  for (const slug of ["featured", "live"]) for (const data of [false, true]) {
    assert.equal((await call(w, slug, { data, k: "" })).status, 404);
    assert.equal((await call(w, slug, { data, k: "mauvaise-cle-aaaaaaaaaaaaaaaa" })).status, 404);
  }
  assert.equal((await call(w, "autre", { k: await keyOf(w, "live") })).status, 404);
  assert.equal((await call(w, "live", { method: "POST" })).status, 405);
  assert.equal(w.api.calls.length, before, "aucune demande à Twitch pour une requête refusée");
  const fresh = site(); fresh.ctx.params = { slug: "live" };
  assert.equal((await def.routes["element/:slug"](new Request(`https://example.test/m/x/element/live?k=zzz`), fresh.ctx)).status, 404, "aucune clé n'existe : tout est refusé");
});

test("partenaires en direct : tous ceux en direct, les moins regardés d'abord, limités par l'option, avec « et N autres » ; seulement nom, jeu, audience", async () => {
  const w = site({ partners: 12, liveCount: 12 });
  const d = await dataOf(w, "live");
  assert.equal(d.state, "ok"); assert.equal(d.rows.length, 5); assert.equal(d.more, 7);
  assert.deepEqual(names(d), logins(5), "audience croissante");
  assert.deepEqual(Object.keys(d.rows[0]).sort(), ["game", "name", "viewers"]);
  assert.deepEqual(d.rows[0], { name: login(0).toUpperCase(), game: "Jeu 0", viewers: 5 });
  const more = await dataOf(w, "live", { "opt-max": "10" }); assert.equal(more.rows.length, 10); assert.equal(more.more, 2);
  const all = await dataOf(w, "live", { "opt-max": "10" }); assert.equal(all.more, 2);
  assert.equal((await dataOf(w, "live", { "opt-max": "99" })).rows.length, 5, "hors bornes : le défaut");
  assert.equal((await dataOf(w, "live", { "opt-max": "x" })).rows.length, 5);
  const small = await dataOf(site({ partners: 3, liveCount: 3 }), "live"); assert.equal(small.more, 0); assert.equal(small.rows.length, 3);
});

test("au repos : personne en direct, pas de partenaires, tout le monde caché → aucune ligne (la page ne dessine rien, pas même le cadre)", async () => {
  assert.deepEqual(await dataOf(site({ liveCount: 0, live: {} }), "live"), { state: "ok", rows: [], more: 0 });
  assert.deepEqual(await dataOf(site({ partners: 0, live: {} }), "live"), { state: "ok", rows: [], more: 0 });
  assert.deepEqual(await dataOf(site({ liveCount: 0, live: {} }), "featured"), { state: "ok", rows: [], more: 0 });
  const hidden = world({ partners: logins(3).map((l) => ({ login: l, hidden: true })), live: lives(3) });
  assert.equal((await dataOf(hidden, "live")).rows.length, 0);
  assert.equal((await dataOf(hidden, "featured")).rows.length, 0);
  const h = await (await call(site(), "live", { data: false })).text();
  assert.match(h, /id="rd"[^>]*\shidden>/);
  assert.match(h, /if \(!d \|\| d\.state !== "ok" \|\| !d\.rows \|\| !d\.rows\.length\) return;/);
});

test("vie privée : « Ne pas montrer », fiche « à relire » et « Ne jamais tirer » ne sortent jamais ; ni pseudo, ni titre de direct, ni vignette, ni commande de raid", async () => {
  const ps = logins(10).map((l, i) => ({ login: l, hidden: i === 0 || i === 1, status: i === 2 ? "to_review" : "active", name: i === 4 ? "Camille" : undefined }));
  const w = world({ partners: ps, live: lives(10), settings: { exclude: login(3) } });
  for (const slug of ["live", "featured"]) {
    const d = await dataOf(w, slug, { "opt-max": "10" });
    const shown = names(d);
    for (const bad of [0, 1, 2, 3]) assert.ok(!shown.includes(login(bad)), `${slug} : ${login(bad)}`);
    const json = JSON.stringify(d);
    assert.ok(!/Titre secret|thumb|\/raid|previews-ttv|startedAt|membre_0000/.test(json), slug);
  }
  assert.ok(names(await dataOf(w, "live", { "opt-max": "10" })).includes("camille"), "le nom de la fiche sert");
  const page = await (await call(w, "live", { data: false })).text();
  assert.ok(!page.includes("Titre secret") && !page.includes("previews-ttv"));
});

test("états inconnus : Twitch muet, Contacts muet, catégorie « Ne pas montrer » invérifiable, trop de chaînes → cadre vide, jamais « personne en direct » inventé", async () => {
  const tw = site(); tw.api.fail = "network";
  const a = await dataOf(tw, "live"); assert.deepEqual([a.state, a.rows.length], ["unknown", 0]);
  const unverified = site(); const real = unverified.ctx.api.services.call;
  unverified.ctx.api.services.call = (service, method, ...rest) => (method === "resolve" ? Promise.resolve({ ok: false, reason: "failed" }) : real.call(unverified.ctx.api.services, service, method, ...rest));
  const b = await dataOf(unverified, "live"); assert.equal(b.rows.length, 0, "sans verdict de Contacts sur les fiches, rien n'est montré");
  const hide = site(); const real2 = hide.ctx.api.services.call;
  hide.ctx.api.services.call = (service, method, ...rest) => (method === "categories" ? Promise.resolve({ ok: false, reason: "failed" }) : real2.call(hide.ctx.api.services, service, method, ...rest));
  const h = await dataOf(hide, "live"); assert.deepEqual([h.state, h.rows.length], ["unknown", 0], "la catégorie « Ne pas montrer » est invérifiable : on ne devine pas");
  const big = world({ partners: logins(620), live: lives(30) });
  const c = await dataOf(big, "live"); assert.deepEqual([c.state, c.rows.length], ["unknown", 0], "au-delà de 500 chaînes : pas de liste complète");
});

test("partenaires à la une : les mêmes chaînes que la sélection du moment, stables, sans tirer de nouveau ; le nombre vient du réglage de la sélection", async () => {
  const w = site({ partners: 30, liveCount: 30, settings: { count: 3 } });
  const first = await dataOf(w, "featured");
  assert.equal(first.rows.length, 3);
  const sel = await M.momentNow(w.ctx);
  assert.deepEqual(first.rows.map((r) => r.name), sel.picks.map((p) => p.name));
  for (let i = 0; i < 4; i++) assert.deepEqual(names(await dataOf(w, "featured")), names(first), "stable pendant la tranche");
  assert.deepEqual(Object.keys(first.rows[0]).sort(), ["game", "name", "viewers"]);
  M.hooks.now = () => T0 + 10 * MIN; live.resetLive(); search.resetSearch();
  assert.notDeepEqual(names(await dataOf(w, "featured")), names(first), "une nouvelle tranche, une nouvelle sélection");
});

test("mode test : des noms inventés, rien n'est lu ; les options de la page sont contrôlées", async () => {
  const w = site(); await keyOf(w); const before = w.api.calls.length;
  const f = await dataOf(w, "featured", { "ov-demo": "1" }), l = await dataOf(w, "live", { "ov-demo": "1", "opt-max": "2" });
  assert.deepEqual(names(f), ["etoile_nord", "lune_douce", "camille"]); assert.equal(l.rows.length, 2);
  assert.equal(w.api.calls.length, before);
  assert.deepEqual(EL.readOptions(q({ "opt-title": "0", "opt-game": "peut-etre", "opt-max": "7", "opt-zzz": "1" })), { title: false, game: true, max: 7 });
});

test("page : jetons --ov-* avec repli, attributs data-ov-part, aucun skin du site ni chargement tiers, politique de sécurité propre, texte venu d'ailleurs jamais dans le HTML", async () => {
  const w = world({ partners: [{ login: login(0), name: '<img src=x onerror=alert(1)>' }], live: lives(1) });
  const res = await call(w, "live", { data: false, extra: { "ov-text": "dark", "ov-surface": "soft", "ov-corners": "square" } });
  const h = await res.text();
  assert.match(h, /:root\{--ov-fg:#111111;--ov-surface:rgba\(255,255,255,\.7\);--ov-radius:0px/);
  assert.match(h, /var\(--ov-fg,#fff\)/); assert.match(h, /data-ov-region="element"/);
  for (const part of ["panel", "title", "card", "name", "text", "value", "dot", "foot"]) assert.ok(h.includes(`data-ov-part="${part}"`), part);
  assert.ok(!/--sk-|data-skin-/.test(h) && !/(?:src|href)="https?:/.test(h));
  assert.ok(!h.includes("<img src=x onerror"), "le nom est dans des données JSON échappées");
  assert.match(res.headers.get("content-security-policy"), /default-src 'none'.*connect-src 'self'/);
  assert.equal(res.headers.get("cache-control"), "no-store"); assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  assert.ok(!h.includes(await keyOf(w)), "la clé n'est écrite nulle part dans la page");
});

test("plusieurs lecteurs : la même réponse, une seule lecture chez Twitch (caches partagés), rien retenu par lecteur", async () => {
  const w = site({ partners: 12, liveCount: 12 }); await keyOf(w);
  const before = w.api.calls.length;
  const reads = await Promise.all(Array.from({ length: 6 }, () => dataOf(w, "live")));
  assert.equal(new Set(reads.map((r) => JSON.stringify(r))).size, 1);
  assert.equal(w.api.calls.length - before, 1, "un seul appel groupé pour six lecteurs");
});
