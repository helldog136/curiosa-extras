// Raid Twitch 2.2.2 — la page publique facultative : ÉTEINTE = ABSENTE, et des mots par défaut neutres (FR/EN) qui ne remplacent jamais ceux de la propriétaire.
// Ce que le module peut garantir seul : la page répond 404 sans titre ni script, la route `members` répond comme une route inconnue, le plan du site du module (aucun) ne cite rien,
// et l'administration dit clairement ce que voient les visiteurs. Le cœur 0.2.12 retire lui-même la page éteinte du plan du site, de llms.txt et du menu grâce à `pageSetting` : voir le README (« Page éteinte »).
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { world, logins, T0, fr, en, manifest, DIR } from "./helpers/twitch-raid-world.mjs";

const def = (await import("../modules/twitch-raid/index.mjs")).default;
const M = await import("../modules/twitch-raid/moment.mjs");
const pub = await import("../modules/twitch-raid/public.mjs");
const live = await import("../modules/twitch-raid/live.mjs");
const search = await import("../modules/twitch-raid/search.mjs");
const source = await import("../modules/twitch-raid/source.mjs");
const admin = await import("../modules/twitch-raid/admin.mjs");

const BASE = "https://site.example.test";
beforeEach(() => { live.resetLive(); search.resetSearch(); source.resetSource(); M.resetMoment(); pub.resetPublic(); M.hooks.now = () => T0; M.hooks.rng = null; });
const keep = async (fn) => { const t = setInterval(() => {}, 25); try { return await fn(); } finally { clearInterval(t); } };
const lives = (n) => Object.fromEntries(logins(n).map((l, i) => [l, { viewers: 5 + i, minutes: 20 + i }]));
const site = (settings = {}, extra = {}) => world({ partners: logins(8), live: lives(8), settings, ...extra });
const page = (w, segments = []) => keep(() => def.page(w.ctx, { segments }));
const route = (w, name, init) => keep(() => def.routes[name](new Request(`${BASE}/m/${w.ctx.instance.key}/${name}`, init), w.ctx));
const NEUTRAL_BAD = /membre|communaut|association|collectif|member|communit|\bngo\b/i;

test("page éteinte (réglage décoché, adresse définie) : 404, ni titre, ni description, ni script, ni bloc ; sous-pages aussi", async () => {
  for (const settings of [{}, { publicPage: false }, { publicPage: "" }, { publicPage: "false" }, { publicPage: 0 }]) {
    const w = site(settings);
    assert.equal(w.ctx.instance.basePath, "en-direct", "l'adresse existe bien");
    const p = await page(w);
    assert.deepEqual(p, { notFound: true }, JSON.stringify(settings));
    assert.deepEqual(await page(w, ["x"]), { notFound: true });
  }
  const w = site({ publicPage: true });
  const p = await page(w); assert.ok(!p.notFound && p.scripts[0] === "live-members.js");
});

test("page éteinte : la route publique `members` répond EXACTEMENT comme une route inconnue du cœur (404 « Not found »), sans cache ni corps JSON, même en rafale", async () => {
  const w = site({ publicPage: false });
  for (let i = 0; i < 80; i++) {   // plus que la limite par minute : jamais un 429 qui trahirait la route
    const r = await route(w, "members", { method: "GET" });
    assert.equal(r.status, 404); assert.equal(await r.text(), "Not found");
    assert.equal(r.headers.get("content-type"), "text/plain;charset=UTF-8", "type texte brut, comme la réponse du cœur");
    assert.equal(r.headers.get("cache-control"), null);
  }
  assert.equal((await route(w, "members", { method: "HEAD" })).status, 404);
  assert.equal((await route(w, "members", { method: "POST" })).status, 405, "méthode refusée comme avant");
  assert.equal((await route(site({ publicPage: true }), "members", { method: "GET" })).status, 200, "allumée : elle répond");
  // La sélection n'a même pas été demandée à Twitch ni à Contacts.
  const cold = site({ publicPage: false }); await route(cold, "members", { method: "GET" });
  assert.equal(cold.api.calls?.length ?? 0, 0, "aucune demande à Twitch");
});

test("page éteinte : aucune entrée de plan du site, aucun lien, aucun script annoncé côté module (le module ne déclare ni sitemap, ni slot, ni section, ni export public)", async () => {
  assert.equal(def.slots, undefined); assert.equal(def.sections, undefined); assert.equal(def.exports, undefined); assert.equal(def.filters, undefined);
  assert.ok(!manifest.sections?.length && !manifest.provides?.length, "rien de public déclaré dans le manifeste");
  const routes = Object.keys(def.routes).sort();
  assert.deepEqual(routes, ["dock", "featured", "featured-again", "featured-data", "live", "members", "pick"]);
  // Éteinte : toutes les routes publiques-sans-clé sont closes ; les autres exigent le secret.
  const w = site({ publicPage: false });
  for (const name of routes.filter((n) => n !== "members")) {
    const r = await route(w, name, { method: name === "pick" || name === "featured-again" ? "POST" : "GET" });
    assert.ok([403, 200].includes(r.status), name);
    if (r.status === 200) assert.ok(!/live-members|\/members/.test(await r.text()), `${name} ne parle pas de la page publique`);
  }
  // La page n'annonce de script que lorsqu'elle existe.
  assert.equal((await page(site({ publicPage: false }))).scripts, undefined);
});

test("administration : page éteinte avec adresse → dit ce que voient les visiteurs, le menu, le plan du site ; allumée → lien ; sans adresse → avertissement ; jamais de jargon", async () => {
  const text = (blocks) => blocks.filter((b) => b.tab === "moment").map((b) => b.text ?? "").join("\n");
  const off = text(await admin.panel(site({ publicPage: false }).ctx, { query: {} }));
  assert.match(off, /éteinte/); assert.match(off, /« \/en-direct »/); assert.match(off, /page introuvable/); assert.match(off, /menu du site/); assert.match(off, /plan du site/);
  const offBlocks = await admin.panel(site({ publicPage: false }).ctx, { query: {} });
  assert.ok(!offBlocks.some((b) => b.tab === "moment" && b.type === "links" && String(b.items?.[0]?.href).includes("en-direct")), "pas de lien vers une page éteinte");
  const nopathOff = text(await admin.panel(site({ publicPage: false }, { basePath: null }).ctx, { query: {} }));
  assert.ok(!/« \/ ?»|« \/null/.test(nopathOff) && !/plan du site/.test(nopathOff), "pas d'adresse : rien à dire du plan du site");
  const on = await admin.panel(site({ publicPage: true }).ctx, { query: {} });
  assert.ok(on.some((b) => b.tab === "moment" && b.type === "links" && b.items[0].href === "/en-direct"));
  const np = await admin.panel(site({ publicPage: true }, { basePath: null }).ctx, { query: {} });
  assert.ok(np.some((b) => b.tab === "moment" && b.type === "banner" && /Adresse de la page/.test(b.text)));
  for (const l of [fr, en]) assert.ok(!/peut encore|may still|retirez-la du menu|take it out of the menu/.test(l.mo_page_off_addr), "plus de limite : le cœur 0.2.12 masque la page éteinte partout");
  for (const l of [fr, en]) assert.ok(!/webhook|token|oauth|payload|endpoint|slug|sitemap|basepath/i.test(l.mo_page_off + l.mo_page_off_addr), "mots simples");
  const help = manifest.settings.find((s) => s.key === "publicPage").help;
  assert.match(help.fr, /page introuvable/); assert.match(help.en, /page not found/);
});

test("textes par défaut NEUTRES en FR et EN : aucun « membres », « communauté », « association »… ; parité et {variables}", () => {
  const keys = Object.keys(fr).filter((k) => /^pub_|^fd_list_label$/.test(k));
  assert.ok(keys.length > 15);
  for (const k of keys) { assert.ok(!NEUTRAL_BAD.test(fr[k]), `fr.${k} : ${fr[k]}`); assert.ok(!NEUTRAL_BAD.test(en[k]), `en.${k} : ${en[k]}`); assert.ok(fr[k] && en[k]); }
  assert.deepEqual([fr.pub_title, en.pub_title], ["En direct en ce moment", "Live right now"]);
  assert.match(fr.pub_intro, /^Voici qui est en direct sur Twitch maintenant\./); assert.match(en.pub_intro, /^Here is who is live on Twitch right now\./);
  for (const k of ["pub_list_label", "pub_description"]) assert.ok(!/membres?|members?/i.test(fr[k] + en[k]), k);
  // Les aides des réglages de la page, les exemples compris, restent neutres.
  for (const key of ["publicPage", "pageTitle", "pageIntro", "emptyText", "watchLabel"]) {
    const s = manifest.settings.find((x) => x.key === key);
    for (const l of ["fr", "en"]) { assert.ok(!NEUTRAL_BAD.test(s.help?.[l] ?? ""), `${key}.help.${l}`); assert.ok(!NEUTRAL_BAD.test(s.label?.[l] ?? ""), `${key}.label.${l}`); }
  }
  assert.ok(!/membres? tir|members? drawn/i.test(JSON.stringify(manifest.privacy)), "déclaration de vie privée : « chaînes tirées »");
  // Les mots de la page, par défaut, dans chaque langue.
  for (const [locale, title] of [["fr", "En direct en ce moment"], ["en", "Live right now"]]) {
    const w = site({ publicPage: true }, { locale, messages: locale === "fr" ? { ...fr } : { ...en } });
    const T = pub.texts(w.ctx); assert.equal(T.title, title);
    assert.ok(!NEUTRAL_BAD.test(JSON.stringify(T)), JSON.stringify(T));
  }
});

test("manifeste 2.2.2 : pageSetting désigne le réglage booléen publicPage (défaut faux), page: true, cœur 0.2.12", () => {
  assert.equal(manifest.pageSetting, "publicPage"); assert.equal(manifest.page, true); assert.equal(manifest.minCore, "0.2.12");
  const s = manifest.settings.find((x) => x.key === "publicPage");
  assert.equal(s.type, "boolean"); assert.strictEqual(s.default, false);
  assert.ok(!/le plan du site (?:peut|que lisent)/.test(fs.readFileSync(`${DIR}/README.md`, "utf8")), "README sans l'ancienne limite");
});

test("neutralité du dépôt : README, documentation et réglages de la page sans vocabulaire d'association (le titre par défaut n'est plus « chez nos membres »)", () => {
  const readme = fs.readFileSync(`${DIR}/README.md`, "utf8");
  assert.ok(!/association|collectif|chez nos membres/i.test(readme), "README");
  assert.ok(!/chez nos membres/i.test(JSON.stringify([manifest, fr, en])), "plus nulle part");
  const idea = fs.readFileSync(`${DIR}/../../docs/ideas/assoc-raid-random.md`, "utf8");
  assert.ok(!/chez nos membres|association, collectif/.test(idea), "doc de conception");
  assert.ok(fs.existsSync(`${DIR}/../../docs/changelog-parts/raid-page-optin.md`));
  const part = fs.readFileSync(`${DIR}/../../docs/changelog-parts/raid-page-optin.md`, "utf8");
  assert.match(part, /## Améliorations/); assert.match(part, /## Pour les développeurs/);
});

test("un titre, une phrase, un texte vide et un bouton saisis par la propriétaire sont conservés (autre langue comprise) ; vides ou blancs : les mots neutres", async () => {
  const mine = { publicPage: true, pageTitle: "Chez nos membres, en direct", pageIntro: "Venez saluer la bande !", emptyText: "Personne pour l'instant", watchLabel: "Y aller" };
  const w = site(mine);
  const p = await page(w);
  assert.equal(p.title, "Chez nos membres, en direct");
  const h = p.blocks[0].html;
  assert.match(h, /Venez saluer la bande !/); assert.match(h, /Y aller/); assert.match(h, /Personne pour l(?:'|&#39;)instant/);
  assert.ok(!/Voici qui est en direct/.test(h), "le mot par défaut ne remplace pas le sien");
  const blank = pub.texts(site({ publicPage: true, pageTitle: "   ", pageIntro: "", emptyText: undefined }).ctx);
  assert.equal(blank.title, "En direct en ce moment"); assert.match(blank.intro, /Voici qui est/); assert.equal(blank.empty, "Personne n'est en direct pour le moment.");
  // Sans le réglage dans la langue courante, l'anglais a ses propres mots neutres.
  const wEn = site({ publicPage: true }, { locale: "en", messages: { ...en } });
  assert.equal((await page(wEn)).title, "Live right now");
});

test("mise à jour à chaud : version 2.2.3, index.mjs et public.mjs importent leurs voisins avec la version, deux versions se chargent côte à côte", async () => {
  assert.equal(manifest.version, "2.2.3");
  for (const f of ["index.mjs", "public.mjs", "moment-admin.mjs"]) {
    const code = fs.readFileSync(`${DIR}/${f}`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const imports = [...code.matchAll(/await import\(([^)]*)\)/g)].filter((m) => /["'`]\.\//.test(m[1]));
    assert.ok(imports.length >= 3, f);
    for (const m of imports) assert.ok(/\$\{v\}/.test(m[1]), `${f} : ${m[1]}`);
  }
  const url = new URL(`../modules/twitch-raid/index.mjs`, import.meta.url).href;
  const a = (await import(`${url}?v=2.2.0-x`)).default, b = (await import(`${url}?v=2.2.2-x`)).default;
  const w = site({ publicPage: false });
  assert.equal((await keep(() => b.routes.members(new Request(`${BASE}/m/x/members`), w.ctx))).status, 404);
  assert.equal(typeof a.page, "function"); assert.deepEqual(await keep(() => b.page(w.ctx, { segments: [] })), { notFound: true });
});

test("le dock ordinaire et la sélection ne changent pas : la page éteinte n'altère ni leurs réponses ni leurs routes", async () => {
  const on = site({ publicPage: true }), off = site({ publicPage: false });
  const secret = async (w) => (await import("../modules/twitch-raid/data.mjs")).dockSecret(w.ctx);
  for (const w of [on, off]) {
    const k = await secret(w);
    const d = await keep(() => def.routes["featured-data"](new Request(`${BASE}/m/${w.ctx.instance.key}/featured-data?k=${encodeURIComponent(k)}`), w.ctx));
    assert.equal(d.status, 200); assert.equal((await d.json()).picks.length, 5);
    const l = await keep(() => def.routes.live(new Request(`${BASE}/m/${w.ctx.instance.key}/live?k=${encodeURIComponent(k)}`), w.ctx));
    assert.equal((await l.json()).state, "ok");
  }
});

/* ───────────── 2.2.3 : l'administration est neutre aussi ───────────── */

// Les seuls textes que le dock 2.1 montre (verrouillés par les empreintes de twitch-raid-compat) : on ne les touche pas, on ne les contrôle pas ici.
// « remember » contient « member » : on cherche le mot entier.
const ADMIN_BAD = /\bmembres?\b|\bmembers?\b|communaut|communit|association|collectif/i;
const DOCK_LOCKED = /^(?:random_|copy_failed$|none_to_pick$|empty_hint$|no_partners$|nr_|err_|viewers_|list_label$|sort_|manual_label$|rm_|default_category$|not_ready$)/;

test("2.2.3 : AUCUN texte par défaut (hors dock verrouillé) ne dit « membre(s) », « communauté » ou « association », en FR comme en EN, administration et réglages compris", () => {
  const keys = Object.keys(fr).filter((k) => !DOCK_LOCKED.test(k));
  assert.ok(keys.length > 100, "presque tous les textes sont contrôlés");
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort(), "parité FR/EN exacte");
  for (const k of keys) { assert.ok(!ADMIN_BAD.test(fr[k]), `fr.${k} : ${fr[k]}`); assert.ok(!ADMIN_BAD.test(en[k]), `en.${k} : ${en[k]}`); }
  // Le manifeste : description, réglages (libellés, aides, choix), vie privée, descriptions des outils MCP.
  const texts = JSON.stringify({ d: manifest.description, s: manifest.settings, p: manifest.privacy, m: manifest.mcp });
  assert.ok(!ADMIN_BAD.test(texts), (texts.match(new RegExp(".{40}(?:" + ADMIN_BAD.source + ").{40}", "i")) ?? [""])[0]);
  // Le README du module et la documentation de conception.
  assert.ok(!ADMIN_BAD.test(fs.readFileSync(`${DIR}/README.md`, "utf8")), "README");
  // Le texte du dock verrouillé n'a pas bougé : il ne contenait déjà aucun de ces mots (donc rien à renommer).
  for (const k of Object.keys(fr).filter((x) => DOCK_LOCKED.test(x))) assert.ok(fr[k] && en[k], k);
  // Réglage `count` : la clé ne change pas, seuls les mots changent.
  const c = manifest.settings.find((x) => x.key === "count");
  assert.deepEqual([c.label.fr, c.label.en], ["Combien de chaînes montrer", "How many channels to show"]);
});
