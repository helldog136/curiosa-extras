// Autres plateformes : liens OnlyFans, Mym, Fansly… en icônes (sujet « social.link », comme les autres réseaux) et page d'avertissement 18+ facultative.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { parseManifest } from "@/core/modules/manifest";
import { validateArgs } from "@/core/services/mcp/validate";
import { resolveIcon } from "@/core/icons";
import { isSafeExternalUrl } from "@/core/url";

const DIR = new URL("../modules/platform-links/", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}${p}`, "utf8"));
const manifest = readJson("module.json");
const FR = readJson("locales/fr.json");
const EN = readJson("locales/en.json");
const def = (await import("../modules/platform-links/index.mjs")).default;
const lib = await import("../modules/platform-links/links.mjs");
const mod = await import("../modules/platform-links/index.mjs");

const SITE = "https://monsite.example";
let seq = 0;
const ctxFor = (settings = {}, opts = {}) => {
  const ctx = fakeCtx({ key: "platform-links", moduleId: "platform-links", basePath: null, locale: "fr", locales: ["fr", "en"], defaultLocale: "fr", messages: FR, siteUrl: SITE, site: { name: "Mon site", tagline: "", logo: null }, settings, ...opts });
  ctx.can = () => opts.can !== false;
  return ctx;
};
const en = (ctx) => Object.assign(ctx, { locale: "en", t: (k, vars) => { let s = EN[k] ?? k; for (const [n, v] of Object.entries(vars ?? {})) s = s.replaceAll(`{${n}}`, String(v)); return s; } });
const save = async (ctx, values, id) => def.adminActions.save.run(ctx, { ...(id ? { id } : {}), platform: "onlyfans", visible: "on", ...values });
const add = async (ctx, platform, url, extra = {}) => { const r = await mod.saveLink(ctx, { platform, url, ...extra }); assert.ok(r.ok, JSON.stringify(r)); return r.link; };
const go = (ctx, key, extra = "") => def.routes.go(new Request(`${SITE}/m/platform-links/go?l=${key}${extra}`), ctx);
const links = (ctx, q = { locale: "fr" }) => def.exports["social.link"](ctx, q);

// ── Manifeste, langues, droits ──────────────────────────────────────────

test("manifeste : valide, un seul exemplaire, fournit « social.link » comme les autres réseaux, minCore 0.2.13", () => {
  const r = parseManifest(manifest);
  assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(manifest.minCore, "0.2.13");
  assert.equal(manifest.instances, "single");
  assert.deepEqual(manifest.provides.map((p) => p.topic), ["social.link"]);
  assert.deepEqual(Object.keys(def.exports), ["social.link"]);
  assert.deepEqual(manifest.mcp.map((a) => a.name).sort(), Object.keys(def.mcp).sort());
  assert.deepEqual(Object.keys(def.routes), ["go"]);
  for (const a of manifest.mcp) assert.ok(a.name.length <= 31, a.name);
});

test("manifeste : permissions fidèles ; aucune action MCP ne supprime ni n'est accordée d'office sauf la lecture", () => {
  assert.deepEqual([...manifest.permissions].sort(), ["admin", "mcp", "routes", "storage", "topics"]);
  for (const a of manifest.mcp) { assert.ok(!a.destructive); assert.equal(!!a.readOnly, a.name === "platform_links_list"); assert.notEqual(a.default, true); }
});

test("langues : fr.json et en.json ont les mêmes clés et les mêmes variables, aucune vide", () => {
  assert.deepEqual(Object.keys(FR).sort(), Object.keys(EN).sort());
  const vars = (s) => (s.match(/\{[a-zA-Z]+\}/g) ?? []).sort().join();
  for (const k of Object.keys(FR)) { assert.ok(FR[k].trim() && EN[k].trim(), k); assert.equal(vars(FR[k]), vars(EN[k]), k); }
  for (const s of manifest.settings) { assert.ok(s.label.fr && s.label.en && s.help.fr && s.help.en, s.key); }
  assert.equal(FR.p_message, "Ce lien mène vers un site réservé aux adultes (18 ans et plus).");
  assert.equal(FR.p_continue_adult, "J'ai 18 ans ou plus, continuer");
});

test("réglages : par défaut avertissement actif pour les plateformes « souvent pour adultes » ; origine, campagne et choix par lien réservés au mode avancé", () => {
  const by = Object.fromEntries(manifest.settings.map((s) => [s.key, s]));
  assert.equal(by.warnAdult.default, true); assert.ok(!by.warnAdult.advanced);
  assert.ok(by.warnTitle.translatable && by.warnMessage.translatable);
  for (const k of ["originEnabled", "originCampaign", "perLinkOrigin"]) assert.equal(by[k].advanced, true, k);
  assert.equal(by.originEnabled.default, true);
  assert.deepEqual(lib.PLATFORMS.filter((p) => p.adult).map((p) => p.id), ["onlyfans", "mym", "fansly"]);
});

test("droits : chaque écriture de l'administration exige le droit « links.edit » ; sans lui, ni formulaire ni boutons de ligne", async () => {
  assert.deepEqual(manifest.rights.map((r) => r.id), ["links.edit"]);
  for (const [name, a] of Object.entries(def.adminActions)) assert.equal(a.right, "links.edit", name);
  const ctx = ctxFor();
  await add(ctx, "onlyfans", "onlyfans.com/moi");
  const blocks = await def.adminPanel(Object.assign(ctx, { can: () => false }), { query: {} });
  assert.ok(!blocks.some((b) => b.type === "adminForm"));
  assert.ok(!blocks.some((b) => b.rowActions));
  const full = await def.adminPanel(Object.assign(ctx, { can: () => true }), { query: {} });
  assert.ok(full.some((b) => b.type === "adminForm") && full.some((b) => b.rowActions));
});

// ── Adresses ────────────────────────────────────────────────────────────

test("adresse : on colle « onlyfans.com/monnom » et c'est complété ; un simple nom suffit pour une plateforme connue", () => {
  assert.equal(lib.normalizeUrl("onlyfans.com/monnom", "onlyfans").url, "https://onlyfans.com/monnom");
  assert.equal(lib.normalizeUrl("  https://www.onlyfans.com/monnom  ", "onlyfans").url, "https://www.onlyfans.com/monnom");
  assert.equal(lib.normalizeUrl("monnom", "mym").url, "https://mym.fans/monnom");
  assert.equal(lib.normalizeUrl("@monnom", "kofi").url, "https://ko-fi.com/monnom");
  assert.equal(lib.normalizeUrl("//fansly.com/moi", "fansly").url, "https://fansly.com/moi");
  assert.equal(lib.normalizeUrl("example.org/ma-page?x=1#haut", "other").url, "https://example.org/ma-page?x=1#haut");
  assert.equal(lib.normalizeUrl("bmc.link/moi", "buymeacoffee").ok, true);
  assert.equal(lib.normalizeUrl("monnom", "other").ok, false, "« Autre » demande une adresse complète");
});

test("adresse : http, javascript:, data:, identifiants, adresses internes ou numériques, ports, espaces et mauvais site sont refusés avec une raison", () => {
  const bad = {
    "http://onlyfans.com/x": "http", "javascript:alert(1)": "scheme", "JAVASCRIPT:alert(1)": "scheme", "data:text/html,<b>": "scheme", "ftp://onlyfans.com/x": "scheme", "mailto:a@b.co": "scheme",
    "https://user:pw@onlyfans.com/x": "credentials", "https://onlyfans.com@evil.example/": "credentials",
    "https://localhost/x": "internal", "https://127.0.0.1/x": "internal", "https://2130706433/": "internal", "https://0x7f.1/": "internal", "https://[::1]/": "internal", "https://192.168.1.2/": "internal",
    "https://intranet/": "internal", "https://nas.local/": "internal", "https://serveur.lan/x": "internal", "https://example.org:8080/": "internal",
    "": "empty", "   ": "empty", "https://exa mple.org/": "invalid", "https://evil.example\\@onlyfans.com/": "invalid", "https://-x-.example/": "invalid", "https://example.o": "invalid",
    ["https://example.org/" + "a".repeat(400)]: "long",
  };
  for (const [input, reason] of Object.entries(bad)) { const r = lib.normalizeUrl(input, "other"); assert.equal(r.ok, false, input); assert.equal(r.reason, reason, input); }
  assert.equal(lib.normalizeUrl("https://evil.example/onlyfans.com", "onlyfans").reason, "platform");
  assert.equal(lib.normalizeUrl("https://onlyfans.com.evil.example/x", "onlyfans").reason, "platform");
  assert.equal(lib.normalizeUrl("https://notonlyfans.com/x", "onlyfans").reason, "platform");
  assert.equal(lib.normalizeUrl("https://evil.example#@onlyfans.com", "onlyfans").reason, "platform");
});

test("adresse : l'erreur s'affiche SOUS le champ, avec un exemple, en français et en anglais", async () => {
  for (const [input, platform, expect] of [["http://onlyfans.com/x", "onlyfans", /https/], ["", "mym", /mym\.fans\/monnom/], ["javascript:alert(1)", "other", /example\.org/], ["https://patreon.com/x", "onlyfans", /OnlyFans/]]) {
    for (const make of [ctxFor, (s) => en(ctxFor(s))]) {
      const r = await save(make(), { platform, url: input });
      assert.ok(!r.ok && r.errors?.url && !r.error, JSON.stringify(r));
      assert.match(r.errors.url, expect);
      assert.ok(!r.errors.url.includes("{"), r.errors.url);
    }
  }
  const r = await save(ctxFor(), { platform: "other", url: "example.org/x" });
  assert.match(r.errors.label, /nom/i, "« Autre » demande un nom");
  assert.deepEqual(Object.keys(r.errors), ["label"]);
  const dup = ctxFor(); await add(dup, "onlyfans", "onlyfans.com/moi");
  assert.match((await save(dup, { url: "https://onlyfans.com/moi/" })).errors.url, /déjà/);
});

// ── Origine des visites (utm) ───────────────────────────────────────────

test("origine : utm_source (site) et utm_medium=link ajoutés ; la campagne seulement si elle est renseignée", () => {
  assert.equal(lib.withOrigin("https://onlyfans.com/moi", { source: "monsite.example" }), "https://onlyfans.com/moi?utm_source=monsite.example&utm_medium=link");
  assert.equal(lib.withOrigin("https://onlyfans.com/moi", { source: "monsite.example", campaign: "Été 2026" }), "https://onlyfans.com/moi?utm_source=monsite.example&utm_medium=link&utm_campaign=%C3%89t%C3%A9%202026");
});

test("origine : fusion propre — paramètres existants gardés tels quels et jamais remplacés ni doublés, ancre conservée", () => {
  const o = { source: "monsite.example", campaign: "x" };
  assert.equal(lib.withOrigin("https://a.example/p?ref=moi&q=a%20b#haut", o), "https://a.example/p?ref=moi&q=a%20b&utm_source=monsite.example&utm_medium=link&utm_campaign=x#haut");
  assert.equal(lib.withOrigin("https://a.example/p?utm_source=ma-source", o), "https://a.example/p?utm_source=ma-source&utm_medium=link&utm_campaign=x");
  assert.equal(lib.withOrigin("https://a.example/p?utm_source=a&utm_medium=b&UTM_CAMPAIGN=c", o), "https://a.example/p?utm_source=a&utm_medium=b&UTM_CAMPAIGN=c");
  assert.equal(lib.withOrigin("https://a.example/p?", { source: "s" }), "https://a.example/p?utm_source=s&utm_medium=link");
  const twice = lib.withOrigin(lib.withOrigin("https://a.example/p#a", o), o);
  assert.equal((twice.match(/utm_source/g) ?? []).length, 1);
  assert.ok(twice.endsWith("#a"));
});

test("origine : aucune injection — les valeurs avec & = # espaces accents sont encodées et ne créent ni ne coupent un paramètre", () => {
  const url = lib.withOrigin("https://a.example/p?x=1#top", { source: "monsite.example", campaign: "a&b=c#d é\"'<>" });
  const u = new URL(url);
  assert.equal(u.hash, "#top");
  assert.deepEqual([...u.searchParams.keys()], ["x", "utm_source", "utm_medium", "utm_campaign"]);
  assert.equal(u.searchParams.get("utm_campaign"), "a&b=c#d é\"'<>");
  assert.ok(!url.includes("<") && !url.includes('"'));
  assert.equal(lib.withOrigin("javascript:alert(1)", { source: "x" }), "javascript:alert(1)", "jamais une autre adresse que https");
});

test("origine : réglage général (oui par défaut), nom de campagne, surcharge par lien ; l'icône directe et le bouton « continuer » ouvrent la MÊME adresse", async () => {
  const ctx = ctxFor({ warnAdult: true });
  const l = await add(ctx, "onlyfans", "onlyfans.com/moi?ref=a#x");
  const expected = "https://onlyfans.com/moi?ref=a&utm_source=monsite.example&utm_medium=link#x";
  assert.equal(lib.destinationOf(l, mod.configOf(ctx)), expected);
  // avertissement actif : le bouton « continuer »
  const page = await (await go(ctx, l.key)).text();
  assert.ok(page.includes(`href="${expected.replace(/&/g, "&amp;")}"`), page);
  // avertissement coupé pour ce lien : l'icône mène directement à la même adresse
  await mod.saveLink(ctx, { warn: "off" }, l.id);
  assert.deepEqual((await links(ctx)).map((x) => x.url), [expected]);
  // campagne
  const c2 = ctxFor({ originCampaign: "site" }); await add(c2, "kofi", "ko-fi.com/moi", { warn: "off" });
  assert.equal((await links(c2))[0].url, "https://ko-fi.com/moi?utm_source=monsite.example&utm_medium=link&utm_campaign=site");
  // réglage général coupé, puis surcharge d'un lien
  const c3 = ctxFor({ originEnabled: false }); const a = await add(c3, "kofi", "ko-fi.com/a"); const b = await add(c3, "patreon", "patreon.com/b", { origin: "on" });
  await mod.saveLink(c3, { origin: "off" }, b.id);
  assert.deepEqual((await links(c3)).map((x) => x.url), ["https://ko-fi.com/a", "https://www.patreon.com/b".replace("www.", "") ]);
  assert.ok(a && b);
  await mod.saveLink(c3, { origin: "on" }, a.id);
  assert.match((await links(c3))[0].url, /utm_source=monsite\.example/);
  for (const v of ["false", "0", false]) assert.equal(mod.configOf(ctxFor({ originEnabled: v })).originEnabled, false, String(v));
  assert.equal(mod.configOf(ctxFor({})).originEnabled, true);
  assert.equal(mod.configOf(ctxFor({}, { siteUrl: "https://www.exemple.example/" })).siteHost, "www.exemple.example");
});

// ── Icônes : même mécanisme que les autres réseaux ──────────────────────

test("icônes : le module fournit « social.link » (label, url https, icône du cœur), seulement les liens visibles, dans l'ordre choisi", async () => {
  const ctx = ctxFor();
  const a = await add(ctx, "onlyfans", "onlyfans.com/moi");
  const b = await add(ctx, "patreon", "patreon.com/moi");
  const c = await add(ctx, "other", "example.org/boutique", { label: "Ma boutique" });
  const out = await links(ctx);
  assert.deepEqual(out.map((x) => x.label), ["OnlyFans", "Patreon", "Ma boutique"]);
  assert.deepEqual(out.map((x) => Object.keys(x).sort().join()), ["icon,label,rel,target,url" /* OnlyFans : page 18+ */, "icon,label,referrerPolicy,rel,target,url", "icon,label,referrerPolicy,rel,target,url"]);
  for (const x of out) assert.ok(isSafeExternalUrl(x.url) && x.url.startsWith("http"), x.url);
  await mod.saveLink(ctx, { visible: false }, b.id);
  assert.deepEqual((await links(ctx)).map((x) => x.label), ["OnlyFans", "Ma boutique"]);
  assert.ok(a && c);
});

test("icônes : chaque plateforme a une icône connue du cœur (logo simple-icons) ou une pastille de lettre / un signe générique sobre", () => {
  for (const p of lib.PLATFORMS) {
    const r = resolveIcon(p.icon);
    assert.ok(r, p.id);
    if (/^[a-z]+$/.test(p.icon)) assert.ok("svg" in r, `${p.id} : logo attendu`); else assert.ok("text" in r && r.text.length <= 8, p.id);
  }
  assert.deepEqual(lib.PLATFORMS.filter((p) => !/^[a-z]+$/.test(p.icon)).map((p) => p.id), ["mym", "fansly", "tipeee", "other"]);
});

test("icônes : avec avertissement, le bouton du site mène à la page de ce module (sur le site lui-même, avec la langue) ; sans, directement à la destination", async () => {
  const ctx = ctxFor();
  const l = await add(ctx, "onlyfans", "onlyfans.com/moi");
  const [warn] = await links(ctx, { locale: "en" });
  assert.equal(warn.url, `${SITE}/m/platform-links/go?l=${l.key}&lang=en`);
  assert.ok(isSafeExternalUrl(warn.url));
  await mod.saveLink(ctx, { warn: "off" }, l.id);
  assert.ok((await links(ctx))[0].url.startsWith("https://onlyfans.com/moi?utm_source="));
  const other = ctxFor({}); await add(other, "patreon", "patreon.com/moi");
  assert.ok((await links(other))[0].url.startsWith("https://patreon.com/moi"), "pas d'avertissement pour une plateforme non réservée aux adultes");
  const other2 = ctxFor({}); await add(other2, "patreon", "patreon.com/moi", { warn: "on" });
  assert.match((await links(other2))[0].url, /\/m\/platform-links\/go\?l=/, "avertissement choisi pour ce lien");
});

test("icônes : le réglage général coupe l'avertissement pour toutes les plateformes ; le choix d'un lien l'emporte", async () => {
  const ctx = ctxFor({ warnAdult: false });
  const a = await add(ctx, "onlyfans", "onlyfans.com/a");
  const b = await add(ctx, "mym", "mym.fans/b", { warn: "on" });
  const out = await links(ctx);
  assert.match(out[0].url, /^https:\/\/onlyfans\.com\/a/);
  assert.match(out[1].url, /\/go\?l=/);
  assert.ok(a && b);
  assert.equal(lib.shouldWarn({ platform: "onlyfans", warn: "auto" }, { warnAdult: true }), true);
  assert.equal(lib.shouldWarn({ platform: "onlyfans", warn: "off" }, { warnAdult: true }), false);
  assert.equal(lib.shouldWarn({ platform: "patreon", warn: "auto" }, { warnAdult: true }), false);
  assert.equal(lib.shouldWarn({ platform: "fansly", warn: "auto" }, { warnAdult: false }), false);
});

// ── Ordre, bornes ───────────────────────────────────────────────────────

test("ordre : Monter / Descendre échangent deux voisins, les icônes suivent, les bords ne bougent pas", async () => {
  const ctx = ctxFor();
  const ids = [];
  for (const [p, u] of [["onlyfans", "onlyfans.com/a"], ["patreon", "patreon.com/b"], ["kofi", "ko-fi.com/c"]]) ids.push((await add(ctx, p, u)).id);
  const names = async () => (await links(ctx)).map((x) => x.label).join();
  assert.equal(await names(), "OnlyFans,Patreon,Ko-fi");
  assert.match((await def.adminActions.up.run(ctx, { id: ids[2] })).ok, /Ordre/);
  assert.equal(await names(), "OnlyFans,Ko-fi,Patreon");
  await def.adminActions.down.run(ctx, { id: ids[0] });
  assert.equal(await names(), "Ko-fi,OnlyFans,Patreon");
  assert.match((await def.adminActions.up.run(ctx, { id: ids[2] === ids[2] ? (await mod.readLinks(ctx))[0].id : "" })).ok, /premier/);
  assert.match((await def.adminActions.down.run(ctx, { id: (await mod.readLinks(ctx))[2].id })).ok, /dernier/);
  assert.equal(await names(), "Ko-fi,OnlyFans,Patreon");
  assert.ok((await def.adminActions.up.run(ctx, { id: "inconnu" })).error);
  assert.deepEqual((await mod.readLinks(ctx)).map((l) => l.order), [0, 1, 2]);
  assert.deepEqual(lib.move([{ id: "a", order: 0, at: 1 }, { id: "b", order: 5, at: 2 }], "b", -1).changes.map((c) => c.id + c.order).sort(), ["a1", "b0"]);
});

test("bornes : 20 liens au plus (message clair, rien d'écrit au-delà) ; un lien masqué compte, un lien retiré libère une place", async () => {
  const ctx = ctxFor();
  for (let i = 0; i < 20; i++) await add(ctx, "other", `example.org/p${i}`, { label: `Lien ${i}` });
  const r = await save(ctx, { platform: "other", url: "example.org/de-trop", label: "Trop" });
  assert.match(r.error, /20/);
  assert.equal(await ctx.api.store.count("links"), 20);
  assert.equal(((await mod.saveLink(ctx, { platform: "other", url: "example.org/x", label: "x" }))).general, "limit");
  assert.ok(!(await def.adminPanel(ctx, { query: {} })).some((b) => b.type === "adminForm"), "plus de formulaire d'ajout au plafond");
  await def.adminActions.remove.run(ctx, { id: (await mod.readLinks(ctx))[0].id, confirm: "on" });
  assert.equal((await save(ctx, { platform: "other", url: "example.org/de-trop", label: "Trop" })).ok, "Lien ajouté.");
  assert.equal(lib.cleanLabel("x".repeat(90)).length, 40);
  assert.equal((await mod.saveLink(ctx, { platform: "other", url: "example.org/long", label: "y".repeat(90) }, (await mod.readLinks(ctx))[0].id)).link.label.length, 40);
});

test("administration : ajouter, modifier (le lien garde son rang et sa clé), masquer, afficher, retirer", async () => {
  const ctx = ctxFor();
  assert.equal((await save(ctx, { url: "onlyfans.com/moi" })).ok, "Lien ajouté.");
  const l = (await mod.readLinks(ctx))[0];
  assert.equal((await save(ctx, { url: "onlyfans.com/autre", label: "Mon espace", warn: "off" }, l.id)).ok, "Lien enregistré.");
  const after = (await mod.readLinks(ctx))[0];
  assert.equal(after.key, l.key); assert.equal(after.order, l.order); assert.equal(after.label, "Mon espace"); assert.equal(after.warn, "off");
  assert.equal((await save(ctx, { url: "onlyfans.com/autre", visible: undefined }, l.id)).ok, "Lien enregistré.");
  assert.equal((await mod.readLinks(ctx))[0].visible, false, "case décochée = masqué");
  assert.equal((await save(ctx, { url: "onlyfans.com/autre", visible: "on" }, l.id)).ok, "Lien enregistré.");
  assert.equal((await mod.readLinks(ctx))[0].visible, true);
  await save(ctx, { url: "onlyfans.com/autre", visible: undefined }, l.id);
  assert.equal((await links(ctx)).length, 0);
  assert.ok((await def.adminActions.remove.run(ctx, { id: l.id })).errors.confirm, "le retrait demande une confirmation");
  assert.equal((await def.adminActions.remove.run(ctx, { id: l.id, confirm: "on" })).ok, "Lien retiré.");
  assert.ok((await def.adminActions.remove.run(ctx, { id: l.id, confirm: "on" })).error);
  assert.ok((await save(ctx, { url: "onlyfans.com/x" }, "inconnu")).error);
  const panel = await def.adminPanel(ctx, { query: {} });
  assert.ok(panel.some((b) => b.type === "markdown" && /Aucun lien/.test(b.text)), "état vide expliqué");
});

test("administration : le formulaire propose l'origine par lien seulement si le réglage avancé est activé ; texte de l'avertissement expliqué", async () => {
  const names = async (ctx) => (await def.adminPanel(ctx, { query: {} })).find((b) => b.type === "adminForm").fields.map((f) => f.name);
  assert.ok(!(await names(ctxFor())).includes("origin"));
  assert.ok((await names(ctxFor({ perLinkOrigin: true }))).includes("origin"));
  const text = (await def.adminPanel(ctxFor(), { query: {} })).filter((b) => b.type === "markdown").map((b) => b.text).join(" ");
  assert.match(text, /pas forcément du contenu pour adultes/);
  assert.match(text, /ne vérifie pas l'âge/);
  const e = (await def.adminPanel(en(ctxFor()), { query: {} })).filter((b) => b.type === "markdown").map((b) => b.text).join(" ");
  assert.match(e, /not necessarily adult content/);
});

// ── Page d'avertissement ────────────────────────────────────────────────

test("page 18+ (avertissement actif) : titre, message par défaut, vrai lien « continuer » vers la destination, « Retour au site », sans script, jamais indexée", async () => {
  const ctx = ctxFor();
  const l = await add(ctx, "onlyfans", "onlyfans.com/moi", { label: "Mon <b>OnlyFans</b>" });
  const res = await go(ctx, l.key);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/html/);
  assert.match(res.headers.get("x-robots-tag"), /noindex/);
  assert.match(res.headers.get("content-security-policy"), /default-src 'none'/);
  const html = (await res.text()).replace(/&#39;/g, "'");
  assert.match(html, /<meta name="robots" content="noindex,nofollow">/);
  assert.match(html, /<h1>Avant de continuer<\/h1>/);
  assert.ok(html.includes("Ce lien mène vers un site réservé aux adultes (18 ans et plus)."));
  const a = html.match(/<a class="btn primary"[^>]*>/)[0];
  assert.match(a, /href="https:\/\/onlyfans\.com\/moi\?utm_source=monsite\.example&amp;utm_medium=link"/);
  assert.match(a, /rel="noopener nofollow"/);
  assert.match(a, /referrerpolicy="strict-origin-when-cross-origin"/);
  assert.match(a, /target="_self"/, "même onglet");
  assert.ok(html.includes("J'ai 18 ans ou plus, continuer"));
  assert.match(html, /<a class="btn secondary" href="\/">Retour au site<\/a>/);
  assert.ok(!/<script|javascript:|onclick|<img|<iframe|https?:\/\/[^"' ]*\.(js|css)/i.test(html), "aucun script, aucune ressource extérieure");
  assert.ok(!html.includes("<b>OnlyFans</b>"), "le nom est échappé");
  assert.ok(html.includes("Mon &lt;b&gt;OnlyFans&lt;/b&gt;"));
  assert.ok(!res.headers.get("set-cookie"), "aucun cookie");
  assert.equal(ctx.calls.writes.filter((w) => w.op === "add").length, 1, "rien n'est compté ni enregistré par la visite");
  const head = await def.routes.go(new Request(`${SITE}/m/x/go?l=${l.key}`, { method: "HEAD" }), ctx);
  assert.equal(head.status, 200); assert.equal(await head.text(), "");
});

test("page 18+ : titre et message configurables, par langue ; version anglaise complète ; « Retour au site » garde la langue", async () => {
  const ctx = ctxFor({ warnTitle: "Un instant", warnMessage: "Premier paragraphe.\n\nDeuxième <i>paragraphe</i>." });
  const l = await add(ctx, "mym", "mym.fans/moi");
  const html = await (await go(ctx, l.key)).text();
  assert.match(html, /<h1>Un instant<\/h1>/);
  assert.ok(html.includes("<p>Premier paragraphe.</p><p>Deuxième &lt;i&gt;paragraphe&lt;/i&gt;.</p>"));
  const e = en(ctxFor({}));
  const l2 = await add(e, "fansly", "fansly.com/me");
  const eh = await (await go(e, l2.key, "&lang=en")).text();
  assert.match(eh, /<html lang="en">/);
  assert.ok(eh.includes("This link leads to a site for adults only (18 and over).") && eh.includes("I am 18 or older, continue") && eh.includes("Back to the site"));
  assert.match(eh, /href="\/en"/);
  assert.ok(!/Ce lien|Retour/.test(eh));
});

test("page sans avertissement (choix du lien) : page neutre « Vous quittez le site », sans texte 18+, même destination", async () => {
  const ctx = ctxFor();
  const l = await add(ctx, "onlyfans", "onlyfans.com/moi", { warn: "off" });
  const html = (await (await go(ctx, l.key)).text()).replace(/&#39;/g, "'");
  assert.ok(!/18|adultes/.test(html), html);
  assert.ok(html.includes("Vous quittez le site") && html.includes(">Continuer<"));
  assert.ok(html.includes(`href="${(await links(ctx))[0].url.replace(/&/g, "&amp;")}"`));
});

test("page : clé inconnue, lien masqué, clé mal formée → page aimable (404), noindex, jamais d'erreur technique", async () => {
  const ctx = ctxFor();
  const l = await add(ctx, "onlyfans", "onlyfans.com/moi");
  await mod.saveLink(ctx, { visible: false }, l.id);
  for (const key of [l.key, "inconnu1", "", "../../etc", "a".repeat(200), "<script>", "https://evil.example"]) {
    const res = await go(ctx, key);
    assert.equal(res.status, 404, key);
    assert.match(res.headers.get("x-robots-tag"), /noindex/);
    const html = (await res.text()).replace(/&#39;/g, "'");
    assert.ok(html.includes("Ce lien n'existe plus") && html.includes("Retour au site"), key);
    assert.ok(!/evil\.example|onlyfans\.com\/moi|Error|at \//.test(html), key);
  }
  assert.equal((await def.routes.go(new Request(`${SITE}/m/x/go`), ctx)).status, 404);
});

test("pas de redirection ouverte : la destination ne vient que de la configuration, jamais de l'adresse visitée", async () => {
  const ctx = ctxFor();
  const l = await add(ctx, "onlyfans", "onlyfans.com/moi");
  const evil = "https://evil.example/phish";
  for (const q of [`&url=${evil}`, `&to=${evil}`, `&next=${evil}`, `&redirect=${encodeURIComponent(evil)}`, `&u=${evil}`, `&utm_source=${evil}`, `&utm_campaign=x%26y`, `&dest=//evil.example`]) {
    const res = await go(ctx, l.key, q);
    assert.equal(res.status, 200); assert.equal(res.headers.get("location"), null);
    const html = await res.text();
    assert.ok(!html.includes("evil.example") && !html.includes("phish"), q);
    assert.ok(html.includes("https://onlyfans.com/moi?utm_source=monsite.example&amp;utm_medium=link"), q);
  }
  const unknown = await go(ctx, "inconnu1", `&url=${evil}`);
  assert.equal(unknown.status, 404); assert.ok(!(await unknown.text()).includes("evil.example"));
  assert.ok(!/redirect|Location/i.test(fs.readFileSync(`${DIR}index.mjs`, "utf8").replace(/redirect: (?:"\?"|`\?edit=\$\{id\}`)/g, "")), "aucune redirection dans le code");
  assert.ok(!/[`"']\/m\/[^`"']*\$\{[^}]*(url|dest|next)/i.test(fs.readFileSync(`${DIR}index.mjs`, "utf8")));
});

test("page : une adresse enregistrée devenue dangereuse (sauvegarde restaurée à la main) n'est jamais proposée", async () => {
  const ctx = ctxFor({}, { rows: { links: [{ key: "labcdefg", platform: "other", url: "javascript:alert(1)", label: "x", visible: true, order: 0 }, { key: "lbbcdefg", platform: "other", url: "http://example.org/x", label: "y", visible: true, order: 1 }] } });
  assert.deepEqual(await links(ctx), []);
  assert.equal((await go(ctx, "labcdefg")).status, 404);
  assert.equal((await go(ctx, "lbbcdefg")).status, 404);
  assert.equal((await def.routes.go(new Request(`${SITE}/m/x/go?l=labcdefg`, { method: "POST" }), ctx)).status, 405);
});

// ── Assistant IA ────────────────────────────────────────────────────────

test("assistant IA : liste, création et modification (écritures explicites) ; erreurs lisibles ; jamais de suppression", async () => {
  const ctx = ctxFor();
  const create = manifest.mcp.find((a) => a.name === "platform_link_create");
  assert.deepEqual(validateArgs(create.input, { platform: "onlyfans", url: "onlyfans.com/moi" }).ok ?? true, true);
  const made = await def.mcp.platform_link_create(ctx, { platform: "onlyfans", url: "onlyfans.com/moi" });
  assert.deepEqual([made.platform, made.url, made.visible, made.warn, made.noticeShownNow, made.position], ["onlyfans", "https://onlyfans.com/moi", true, "auto", true, 1]);
  const upd = await def.mcp.platform_link_update(ctx, { id: made.id, warn: "off", label: "Mon espace" });
  assert.deepEqual([upd.warn, upd.noticeShownNow, upd.label, upd.url], ["off", false, "Mon espace", "https://onlyfans.com/moi"]);
  assert.equal((await def.mcp.platform_link_update(ctx, { id: made.id, visible: false })).visible, false);
  const list = await def.mcp.platform_links_list(ctx);
  assert.equal(list.length, 1);
  assert.ok(!JSON.stringify(list).includes("key"), "la clé publique n'est pas exposée");
  const refusal = async (p) => { try { await p; } catch (e) { return e; } return null; };
  for (const [call, re] of [
    [def.mcp.platform_link_create(ctx, { platform: "onlyfans", url: "http://onlyfans.com/x" }), /https/],
    [def.mcp.platform_link_create(ctx, { platform: "onlyfans", url: "https://evil.example/x" }), /platform/],
    [def.mcp.platform_link_create(ctx, { platform: "other", url: "example.org/x" }), /label/],
    [def.mcp.platform_link_update(ctx, { id: "inconnu" }), /not found/],
  ]) { const e = await refusal(call); assert.ok(e?.expose, String(re)); assert.match(e.message, re); }
  assert.ok(!Object.keys(def.mcp).some((n) => /delete|remove/.test(n)));
});

test("assistant IA : le plafond de 20 liens s'applique aussi", async () => {
  const ctx = ctxFor();
  for (let i = 0; i < 20; i++) await def.mcp.platform_link_create(ctx, { platform: "other", url: `example.org/${i}`, label: `L${i}` });
  await assert.rejects(def.mcp.platform_link_create(ctx, { platform: "other", url: "example.org/21", label: "L21" }), (e) => e.expose && /20/.test(e.message));
});

// ── Divers ──────────────────────────────────────────────────────────────

test("sauvegarde lisible : un CSV des liens, cellules neutralisées pour un tableur", async () => {
  const ctx = ctxFor();
  await add(ctx, "other", "example.org/x", { label: "=SOMME(A1)" });
  const [file] = await def.backup.readable(ctx);
  assert.equal(file.path, "links.csv");
  assert.ok(file.content.includes('"\'=SOMME(A1)"'));
  assert.ok(file.content.includes('"https://example.org/x"'));
});

test("volume : 20 liens, la collecte des icônes et le panneau restent instantanés", async () => {
  const ctx = ctxFor();
  for (let i = 0; i < 20; i++) await add(ctx, "other", `example.org/${i}`, { label: `L${i}` });
  const t0 = Date.now();
  for (let i = 0; i < 50; i++) { await links(ctx); await def.adminPanel(ctx, { query: {} }); }
  assert.ok(Date.now() - t0 < 2000);
});

test("README : métier, l'avertissement n'est pas une vérification d'âge", () => {
  const readme = fs.readFileSync(`${DIR}README.md`, "utf8");
  assert.match(readme, /pas forcément du contenu pour adultes/);
  assert.match(readme, /Ce n'est pas une vérification d'âge/);
  for (const f of ["docs/ideas/platform-links.md", "docs/ideas/platform-links.changelog.md"]) assert.ok(fs.existsSync(new URL(`../${f}`, import.meta.url)), f);
});

// ── Contrat des liens du cœur 0.2.13 : rel / referrerPolicy / target ─────

const RELS = ["noopener", "noreferrer", "nofollow", "sponsored", "ugc"];
const POLICIES = ["no-referrer", "no-referrer-when-downgrade", "origin", "origin-when-cross-origin", "same-origin", "strict-origin", "strict-origin-when-cross-origin"];
const valid = (x) => (x.rel === undefined || x.rel.split(" ").every((r) => RELS.includes(r))) && (x.referrerPolicy === undefined || POLICIES.includes(x.referrerPolicy)) && ["_blank", "_self"].includes(x.target);

test("liens du cœur : lien direct = rel prudent + politique de référent + nouvel onglet, mêmes constantes que la page /go", async () => {
  const ctx = ctxFor();
  const l = await add(ctx, "onlyfans", "onlyfans.com/moi", { warn: "off" });
  await add(ctx, "patreon", "patreon.com/moi");
  const out = await links(ctx);
  assert.equal(out.length, 2);
  for (const x of out) {
    assert.ok(valid(x), JSON.stringify(x));
    assert.equal(x.rel, mod.OUTBOUND_REL);
    assert.equal(x.referrerPolicy, mod.OUTBOUND_REFERRER);
    assert.equal(x.target, "_blank");
    assert.ok(!x.rel.includes("noreferrer"), "la plateforme doit voir d'où vient la visite");
  }
  // la page /go (avertissement) utilise les MÊMES constantes pour son bouton
  const w = await add(ctxFor(), "mym", "mym.fans/moi");
  assert.ok(l && w);
});

test("liens du cœur : lien avec page 18+ = navigation interne (noopener, même onglet, pas de politique) ; le bouton de /go reprend les constantes sortantes", async () => {
  const ctx = ctxFor();
  const l = await add(ctx, "onlyfans", "onlyfans.com/moi");
  const [x] = await links(ctx);
  assert.ok(x.url.startsWith(`${SITE}/m/platform-links/go?l=`));
  assert.deepEqual({ rel: x.rel, target: x.target, referrerPolicy: x.referrerPolicy }, { rel: "noopener", target: "_self", referrerPolicy: undefined });
  assert.ok(valid(x));
  const html = await (await go(ctx, l.key)).text();
  const a = html.match(/<a class="btn primary"[^>]*>/)[0];
  assert.ok(a.includes(`rel="${mod.OUTBOUND_REL}"`) && a.includes(`referrerpolicy="${mod.OUTBOUND_REFERRER}"`) && a.includes('target="_self"'));
});

test("liens du cœur : aucun réglage technique exposé à la propriétaire (rel, target, référent absents des réglages)", () => {
  for (const s of manifest.settings) assert.ok(!/^(rel|target|referrer)/i.test(s.key), s.key);
  assert.ok(!/rel=|referrer|target=/i.test(JSON.stringify(manifest.settings.map((s) => [s.label, s.help]))));
});
