// Carte : manifeste, textes FR/EN, page publique (liste, filtres, recherche, pagination, fiche), routes publiques, lieux venant d'autres modules, volume.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseManifest } from "@/core/modules/manifest";
import { validateArgs } from "@/core/services/mcp/validate";
import { DIR, manifest, messages, def, index, data, ctxFor, addPlace, addType, page, html, get, rows, fakeMapPlaces, templates, has } from "./helpers/mapKit.mjs";

const src = fs.readdirSync(DIR).filter((f) => f.endsWith(".mjs")).map((f) => fs.readFileSync(`${DIR}/${f}`, "utf8")).join("\n");
const body = async (res) => JSON.parse(await res.text());
const inDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const valid = (schema, args) => { try { validateArgs(schema, args); return true; } catch { return false; } };

test("manifeste : valide, FR+EN, instances multiples, page, cœur 0.2.12, ce que le code fait est ce que module.json annonce", () => {
  const r = parseManifest(manifest);
  assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(r.manifest.id, "map");
  assert.equal(r.manifest.apiVersion, 2);
  assert.equal(manifest.version, "1.0.1");
  assert.equal(index.VERSION, manifest.version, "VERSION suit le manifeste");
  assert.equal(manifest.minCore, "0.2.12");
  assert.equal(manifest.instances, "multiple");
  assert.equal(manifest.page, true);
  assert.equal(manifest.name.fr, "Carte"); assert.equal(manifest.name.en, "Map");
  assert.deepEqual(Object.keys(def.routes).sort(), ["go", "list", "place", "points"]);
  assert.deepEqual(manifest.mcp.map((a) => a.name).sort(), Object.keys(def.mcp).sort());
  assert.equal(def.sections, undefined);
  const rights = new Set(manifest.rights.map((x) => x.id));
  for (const [name, a] of Object.entries(def.adminActions)) assert.ok(rights.has(a.right), `${name} : droit « ${a.right} » non déclaré`);
  assert.ok(def.adminDownloads.places && rights.has(def.adminDownloads.places.right));
});

test("manifeste : permissions = capacités utilisées ; réglages utiles, par défaut sensés, techniques en mode avancé, tous lus par le code", () => {
  const used = { slots: !!def.slots, routes: !!def.routes, storage: src.includes("ctx.api.store"), sections: !!def.sections, pages: !!def.page, topics: src.includes("ctx.api.topics"), mcp: !!def.mcp, admin: !!def.adminPanel, mail: src.includes("ctx.api.mail"), "visitor.geolocation": /navigator\.geolocation/.test(fs.readFileSync(`${DIR}/scripts/map-page.js`, "utf8")) };
  assert.deepEqual([...manifest.permissions].sort(), Object.keys(used).filter((k) => used[k]).sort());
  const byKey = Object.fromEntries(manifest.settings.map((s) => [s.key, s]));
  for (const k of ["showMap", "showNear", "showExternal", "hidePast"]) assert.equal(byKey[k].default, true, k);
  assert.equal(byKey.footerLink.default, false);
  assert.equal(byKey.sort.default, "order"); assert.equal(byKey.directions.default, "osm");
  assert.equal(byKey.perPage.advanced, true); assert.ok(byKey.perPage.default <= 50);
  for (const k of ["intro", "wordOne", "wordMany", "showMapLabel", "nearLabel"]) { assert.equal(byKey[k].translatable, true, k); assert.equal(byKey[k].optional, true, k); }
  for (const s of manifest.settings) assert.ok(src.includes(`"${s.key}"`), `le code lit « ${s.key} »`);
  assert.ok(!manifest.settings.some((s) => s.type === "secret"), "aucun secret");
});

test("manifeste : le sujet consommé a le bon format, les onglets sont ceux annoncés, l'assistant ne reçoit aucune écriture d'office", () => {
  const c = manifest.consumes.find((x) => x.topic === "map.place");
  assert.ok(c);
  assert.deepEqual(c.schema.filter((f) => f.required).map((f) => f.key).sort(), ["id", "lat", "lng", "title"]);
  assert.deepEqual(Object.fromEntries(c.schema.map((f) => [f.key, f.type])), { id: "string", title: "string", lat: "number", lng: "number", kind: "string", url: "url", at: "datetime", note: "string" });
  assert.deepEqual(manifest.tabs.map((t) => t.id), ["use", "tools"]);
  assert.deepEqual(manifest.tabs[0].label, { fr: "Mes lieux", en: "My places" });
  for (const a of manifest.mcp) {
    assert.ok(a.name.length <= 40 && `une-instance-assez-longue__${a.name}`.length <= 64, a.name);
    assert.ok(a.description.length > 60, `${a.name} : description utile`);
    if (!a.readOnly) assert.ok(a.default !== true, `${a.name} : écriture non accordée d'office`);
    assert.ok(!a.destructive, "rien de destructif");
  }
  assert.deepEqual(manifest.mcp.filter((a) => a.readOnly).map((a) => a.name).sort(), ["map_places_list", "map_types_list"]);
});

test("vie privée : la déclaration dit ce que charge la page (OpenStreetMap après le clic), la position qui ne part pas, pas de cookie ; 500 caractères au plus", () => {
  for (const l of ["fr", "en"]) {
    const t = manifest.privacy[l];
    assert.ok(t.length <= 500, `${l} : ${t.length}`);
    has(t, /OpenStreetMap/); has(t, /IP/); has(t, /cookie/);
    has(t, l === "fr" ? /Afficher la carte/ : /Show the map/);
    has(t, l === "fr" ? /Près de moi/ : /Near me/);
    has(t, l === "fr" ? /ni envoyée au site ni gardée/ : /neither sent to the site nor kept/);
  }
});

test("arguments de l'assistant : la validation du cœur accepte un lieu correct et refuse le reste", () => {
  const add = manifest.mcp.find((a) => a.name === "map_place_add").input;
  assert.equal(valid(add, { name: "Studio", lat: 12.3, lng: 34.5, type: "studio" }), true);
  assert.equal(valid(add, { name: "Studio", mapLink: "https://www.openstreetmap.org/#map=17/12.3/34.5" }), true);
  assert.equal(valid(add, {}), false, "le nom est obligatoire");
  assert.equal(valid(add, { name: "x", lat: 95 }), false);
  assert.equal(valid(add, { name: "x", status: "published" }), false, "aucun argument pour publier");
  assert.equal(valid(add, { name: "x".repeat(121) }), false);
  const list = manifest.mcp.find((a) => a.name === "map_places_list").input;
  assert.equal(valid(list, { status: "draft", limit: 100 }), true);
  assert.equal(valid(list, { limit: 101 }), false);
});

test("textes : FR et EN ont exactement les mêmes clés et les mêmes variables ; chaque clé utilisée existe ; aucune clé inutile ; pas de jargon", () => {
  const fr = messages("fr"), en = messages("en");
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort(), "parité exacte");
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  for (const k of Object.keys(fr)) { assert.equal(vars(fr[k]), vars(en[k]), `variables de « ${k} »`); assert.ok(fr[k].trim() && en[k].trim(), k); }
  for (const k of new Set([...src.matchAll(/\bt\("([A-Za-z_0-9]+)"/g)].map((m) => m[1]))) assert.ok(k in fr, `clé « ${k} » absente`);
  assert.deepEqual(Object.keys(fr).filter((k) => k.startsWith("errPos_")).sort(), ["empty", "missing", "none", "number", "range", "short", "zero"].map((x) => `errPos_${x}`).sort());
  assert.deepEqual(Object.keys(fr).filter((k) => k.startsWith("tpl_") && !["tpl_Help", "tpl_Label"].includes(k)).sort(), Object.keys(templates.TEMPLATES).map((id) => `tpl_${id}`).sort());
  const unused = Object.keys(fr).filter((k) => !src.includes(`"${k}"`) && !/^(errPos_|kind_|tpl_)/.test(k));
  assert.deepEqual(unused, [], "clés jamais utilisées");
  const everything = JSON.stringify([Object.values(fr), Object.values(en), manifest.settings, manifest.description, manifest.name, manifest.privacy]).toLowerCase();
  for (const jargon of ["json", "endpoint", "payload", "slug", "webhook", "token", "oauth", "jeton", "geocod", "mcp"]) assert.ok(!everything.includes(jargon), `jargon : « ${jargon} »`);
  assert.ok(!/\bAPI\b/.test(JSON.stringify([Object.values(fr), Object.values(en), manifest.settings])), "pas de « API » dans les textes montrés");
  assert.ok(!/\bmodules?\b/i.test(JSON.stringify(manifest.description)), "la description ne parle pas d'un autre module");
});

test("neutralité : aucun nom propre à un site, une association ou une région dans le code, les textes et la documentation du module", () => {
  const files = [...fs.readdirSync(DIR).filter((f) => /\.(mjs|json|md)$/.test(f)).map((f) => `${DIR}/${f}`), ...fs.readdirSync(`${DIR}/locales`).map((f) => `${DIR}/locales/${f}`), ...fs.readdirSync(`${DIR}/scripts`).map((f) => `${DIR}/scripts/${f}`)];
  const banned = /helldog|rosalia|emma|asbl|belgi|bruxelles|brussels|namur|li[eè]ge|wallon|flandre/i;
  for (const f of files) {
    const t = fs.readFileSync(f, "utf8").replace(/"author": "Helldog136"/, "");
    assert.ok(!banned.test(t), `${f} : ${banned.exec(t)?.[0]}`);
  }
});

test("page vide : un message simple, aucun script chargé, pas de carte à demander", async () => {
  const ctx = ctxFor();
  const p = await page(ctx);
  assert.equal(p.title, "Carte");
  assert.deepEqual(p.scripts, []);
  has(p.blocks[0].html, /pas encore de lieux/);
  assert.ok(!/data-cm-show/.test(p.blocks[0].html));
});

test("page : la LISTE contient tout (nom, type, adresse, description, horaires, lien, itinéraire) sans JavaScript ; les boutons de la carte sont cachés jusqu'au script", async () => {
  const ctx = ctxFor();
  await def.hooks.onInstanceCreate(ctx);
  await addPlace(ctx, { name: "Studio du Centre", type: "event", address: "12 rue des Fleurs", desc: "Un lieu calme.\n\nDeuxième paragraphe.", hours: "Lun–ven 9 h–18 h", url: "https://www.exemple.org/studio", code: "pstudio01" });
  const p = await page(ctx);
  assert.deepEqual(p.scripts, ["map-engine.js", "map-page.js"]);
  const h = p.blocks[0].html;
  for (const t of ["Studio du Centre", "Événement", "12 rue des Fleurs", "Un lieu calme.", "Deuxième paragraphe.", "Lun–ven 9 h–18 h", "exemple.org", "Itinéraire"]) assert.ok(h.includes(t), t);
  has(h, /<a href="\/map\/p\/pstudio01">Studio du Centre<\/a>/);
  has(h, /href="https:\/\/www\.exemple\.org\/studio" rel="noopener noreferrer nofollow" target="_blank"/);
  has(h, /openstreetmap\.org\/directions\?route=%3B12\.\d+%2C34\.\d+" target="_blank" rel="noopener noreferrer"/);
  has(h, /class="cm-actions cm-js" hidden/);
  has(h, /<noscript><style>\.cm-js\{display:none!important\}<\/style><\/noscript>/);
  has(h, /1 lieu</);
  has(h, /action="\/m\/map\d+\/go"/);
});

test("vie privée : la page ne charge RIEN d'extérieur ; les tuiles ne sont qu'une adresse modèle dans la configuration", async () => {
  const ctx = ctxFor();
  await def.hooks.onInstanceCreate(ctx);
  await addPlace(ctx, { name: "A", url: "https://www.exemple.org" });
  const h = await html(ctx);
  assert.ok(!/<img|<iframe|<script|<link|<video|<audio|<object|<embed|@import|url\(/i.test(h), "aucune ressource chargée");
  assert.ok(!/tile\.openstreetmap|openstreetmap\.org\/\{/.test(h.replace(/data-cfg="[^"]*"/, "")), "l'adresse des tuiles n'est que dans la configuration");
  assert.ok(!/src=/i.test(h));
  const cfg = JSON.parse(h.match(/data-cfg="([^"]*)"/)[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&"));
  assert.equal(cfg.tiles, "https://tile.openstreetmap.org/{z}/{x}/{y}.png");
  assert.ok(cfg.maxZoom <= 19, "zoom borné");
  assert.deepEqual(cfg.radii, [5, 20, 50, 100]);
});

test("page : filtres par type (liens), recherche dans le chemin, pagination, chemins refusés", async () => {
  const ctx = ctxFor({ perPage: 5 });
  await addType(ctx, "studio", "Studio", "Studio", "🎙️"); await addType(ctx, "address", "Bonne adresse", "Good address", "⭐"); await addType(ctx, "empty", "Vide", "Empty", "x");
  for (let i = 1; i <= 7; i++) await addPlace(ctx, { name: `Studio numéro ${i}`, type: "studio" });
  await addPlace(ctx, { name: "Café Éphémère", type: "address", desc: "Des gâteaux" });
  await addPlace(ctx, { name: "Brouillon secret", type: "studio", status: "draft" });
  const h = await html(ctx);
  has(h, /8 lieux/);
  assert.ok(!h.includes("Brouillon secret"), "un brouillon est invisible");
  has(h, /<a href="\/map"[^>]*>Tous <span class="cm-dist">\(8\)<\/span><\/a>/);
  has(h, /href="\/map\/t\/studio"[^>]*>🎙️ Studio <span class="cm-dist">\(7\)<\/span>/);
  has(h, /href="\/map\/t\/address"/);
  assert.ok(!h.includes("/t/empty"), "un type sans lieu n'est pas proposé");
  assert.equal((h.match(/class="cm-item"/g) ?? []).length, 5);
  has(h, /rel="next" href="\/map\/page\/2"/);
  assert.equal((await html(ctx, ["page", "2"])).match(/class="cm-item"/g).length, 3);
  has(await html(ctx, ["page", "2"]), /rel="prev"/);
  const t = await html(ctx, ["t", "address"]);
  has(t, /1 lieu/); assert.ok(t.includes("Café Éphémère") && !t.includes("Studio numéro"));
  has(t, /aria-current="true"/);
  assert.ok((await html(ctx, ["q", "ephemere"])).includes("Café Éphémère"));
  assert.ok((await html(ctx, ["q", "gateaux"])).includes("Café Éphémère"));
  has(await html(ctx, ["q", "zzz"]), /Aucun résultat/);
  has(await html(ctx, ["t", "studio", "q", "numero", "page", "2"]), /rel="prev" href="\/map\/t\/studio\/q\/numero"/);
  for (const bad of [["x"], ["t"], ["t", "A B"], ["page", "0"], ["page", "abc"], ["page", "99"], ["p", "xx"], ["p", "ZZZZZZZZ"], ["p", "pzzzzzzzz9"], ["t", "a", "t", "b"], ["q", ""], ["t", "studio", "q", "a", "page", "2", "extra", "1"]]) {
    assert.equal((await page(ctx, bad)).notFound, true, `refusé : ${bad.join("/")}`);
  }
});

test("page : tri « mon ordre » ou « alphabétique » ; mots du site réglables (un lieu / plusieurs lieux, boutons)", async () => {
  const ctx = ctxFor({ sort: "name", wordOne: "studio", wordMany: "studios", showMapLabel: "Voir les studios", nearLabel: "Les plus proches" });
  await addPlace(ctx, { name: "Zèbre" }); await addPlace(ctx, { name: "alpha" }); await addPlace(ctx, { name: "Éléphant" });
  const h = await html(ctx);
  assert.ok(h.indexOf("alpha") < h.indexOf("Éléphant") && h.indexOf("Éléphant") < h.indexOf("Zèbre"));
  has(h, /3 studios/); has(h, />Voir les studios</); has(h, />Les plus proches</);
  const order = ctxFor({ sort: "order" });
  await addPlace(order, { name: "Zèbre" }); await addPlace(order, { name: "alpha" });
  const o = await html(order);
  assert.ok(o.indexOf("Zèbre") < o.indexOf("alpha"), "l'ordre choisi par l'équipe");
  const one = ctxFor({ wordOne: "studio", wordMany: "studios" }); await addPlace(one, { name: "Seul" });
  has(await html(one), /1 studio</);
  const en = ctxFor({}, { locale: "en" }); await addPlace(en, { name: "Only" }); await addPlace(en, { name: "Two" });
  const e = await html(en);
  has(e, /2 places/); has(e, />Show the map</); has(e, />Near me</); has(e, /Directions/);
});

test("réglages : sans la carte ni « près de moi », la page est une simple liste sans script ; sans chemin de page, aucun lien vers la fiche", async () => {
  const ctx = ctxFor({ showMap: false, showNear: false });
  await addPlace(ctx, { name: "A" });
  const p = await page(ctx);
  assert.deepEqual(p.scripts, []);
  assert.ok(!/data-cm-show|data-cm-near/.test(p.blocks[0].html));
  const noNear = ctxFor({ showNear: false }); await addPlace(noNear, { name: "A" });
  const hn = await html(noNear);
  assert.ok(!/data-cm-near/.test(hn) && /data-cm-show/.test(hn));
  const noPath = ctxFor({}, { basePath: null }); await addPlace(noPath, { name: "A" });
  assert.ok(!/href="\/map\/p\//.test(await html(noPath)));
});

test("fiche d'un lieu : adresse partageable, titre, retour à la liste ; brouillon et lieu inconnu = introuvable", async () => {
  const ctx = ctxFor();
  const code = await addPlace(ctx, { name: "Atelier", desc: "Texte complet.\n\nSuite.", address: "1 rue A", code: "patelier1" });
  const draft = await addPlace(ctx, { name: "Caché", status: "draft", code: "pcache001" });
  const p = await page(ctx, ["p", code]);
  assert.equal(p.title, "Atelier");
  has(p.description, /Texte complet/);
  has(p.blocks[0].html, /<h2 class="cm-name" tabindex="-1" data-cm-focus>Atelier<\/h2>/);
  has(p.blocks[0].html, /Retour aux lieux/); has(p.blocks[0].html, /Suite\./);
  assert.deepEqual(p.scripts, ["map-engine.js", "map-page.js"]);
  assert.equal((await page(ctx, ["p", draft])).notFound, true);
  assert.equal((await page(ctx, ["p", "pnexistepas"])).notFound, true);
});

test("données hostiles : tout est échappé (nom, adresse, description, horaires, types, vocabulaire, introduction), aucun lien dangereux", async () => {
  const evil = `<img src=x onerror=alert(1)> "quoted" 'single' & <script>alert(2)</script>`;
  const ctx = ctxFor({ intro: evil, wordOne: evil, wordMany: evil });
  await addType(ctx, "evil", evil, evil, evil);
  await addPlace(ctx, { name: evil, type: "evil", address: evil, desc: evil, hours: evil, url: "javascript:alert(3)", code: "pevil0001" });
  await addPlace(ctx, { name: "Lien", url: "data:text/html,<b>", code: "pevil0002" });
  const h = await html(ctx);
  const noCfg = h.replace(/data-cfg="[^"]*"/, "");
  assert.ok(!/<img|<script/i.test(noCfg), "aucune balise venue d'un texte");
  assert.ok(!/href="javascript:|href="data:/i.test(h));
  has(h, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.ok(!/[<>"]/.test(h.match(/data-cfg="([^"]*)"/)[1].replace(/&quot;/g, "")), "la configuration est un attribut sûr");
  const fiche = await html(ctx, ["p", "pevil0001"]);
  assert.ok(!/<img|<script/i.test(fiche.replace(/data-cfg="[^"]*"/, "")));
  assert.ok(!/href="javascript:/.test(fiche));
});

test("route « points » : version compacte pour la carte et « près de moi », filtres, cache court, lecture seule", async () => {
  const ctx = ctxFor();
  await addType(ctx, "studio", "Studio", "Studio", "🎙️"); await addType(ctx, "address", "Adresse", "Address", "⭐");
  await addPlace(ctx, { name: "Un", type: "studio", lat: 12.5, lng: 34.5, code: "pun000001" });
  await addPlace(ctx, { name: "Deux", type: "address", lat: -12.5, lng: -34.5, code: "pdeux0001" });
  await addPlace(ctx, { name: "Brouillon", type: "studio", status: "draft" });
  const r = await def.routes.points(get("points", { lang: "fr" }), ctx);
  assert.equal(r.status, 200);
  has(r.headers.get("cache-control"), /public, max-age=60/);
  assert.deepEqual(await body(r), { ok: true, v: 1, n: 2, types: [["studio", "Studio", "🎙️"], ["address", "Adresse", "⭐"]], pts: [["pun000001", 12.5, 34.5, 0, "Un", 0], ["pdeux0001", -12.5, -34.5, 1, "Deux", 0]] });
  assert.deepEqual((await body(await def.routes.points(get("points", { t: "address" }), ctx))).pts.map((p) => p[0]), ["pdeux0001"]);
  assert.deepEqual((await body(await def.routes.points(get("points", { q: "un" }), ctx))).pts.map((p) => p[0]), ["pun000001"]);
  assert.equal((await def.routes.points(get("points", {}, { method: "POST" }), ctx)).status, 405);
  assert.equal((await def.routes.points(get("points", { t: "../../etc", q: "<script>" }), ctx)).status, 200);
});

test("vie privée : aucune route ne lit une position ; envoyer latitude/longitude à une route ne change rien", async () => {
  const routesSrc = fs.readFileSync(`${DIR}/routes.mjs`, "utf8");
  assert.ok(!/searchParams\.get\("(lat|lng|lon|latitude|longitude|pos|position|ll)"\)/.test(routesSrc));
  assert.ok(!/geolocation|navigator/.test(src.replace(/\/\/.*$/gm, "")), "le serveur ne sait rien de la géolocalisation");
  const ctx = ctxFor();
  await addPlace(ctx, { name: "A" }); await addPlace(ctx, { name: "B" });
  const plain = await (await def.routes.points(get("points", {}), ctx)).text();
  const spied = await (await def.routes.points(get("points", { lat: "12.1", lng: "34.1", ll: "12,34" }), ctx)).text();
  assert.equal(plain, spied);
  assert.equal(rows(ctx, "map_meta").length, 0, "rien n'est gardé par visiteur");
  for (const k of ctx.api.store.rows.values()) assert.ok(!/visitor|203\.0\.113/.test(JSON.stringify(k.data)));
});

test("position : navigator.geolocation n'est appelée qu'après le clic sur « Près de moi », et la permission visitor.geolocation est déclarée (cœur 0.2.12)", () => {
  const js = fs.readFileSync(`${DIR}/scripts/map-page.js`, "utf8").replace(/\/\/.*$/gm, "");
  const click = js.indexOf('nearBtn.addEventListener("click"'), uses = [...js.matchAll(/navigator\s*\.\s*geolocation/g)].map((m) => m.index);
  assert.ok(click > 0 && uses.length >= 1, "le bouton et l'appel existent");
  assert.ok(uses.every((i) => i > click), "aucun appel avant le gestionnaire de clic");
  assert.ok(!/getCurrentPosition|watchPosition/.test(js.slice(0, click)), "aucune demande de position au chargement");
  assert.ok(manifest.permissions.includes("visitor.geolocation"));
  for (const l of ["README.md", "../../docs/ideas/map.md"]) assert.match(fs.readFileSync(`${DIR}/${l}`, "utf8"), /sans cette permission le navigateur refuse la position/i);
});

test("route « place » : la fiche en HTML échappé ; code invalide, brouillon ou inconnu = 404", async () => {
  const ctx = ctxFor();
  await addPlace(ctx, { name: "<b>Gras</b>", desc: "a <i>b</i>", code: "pfiche001" });
  await addPlace(ctx, { name: "Brouillon", status: "draft", code: "pdraft001" });
  const j = await body(await def.routes.place(get("place", { c: "pfiche001" }), ctx));
  assert.equal(j.ok, true); assert.equal(j.code, "pfiche001");
  has(j.html, /&lt;b&gt;Gras&lt;\/b&gt;/); assert.ok(!/<b>|<i>/.test(j.html));
  has(j.html, /href="\/map\/p\/pfiche001"/);
  for (const c of ["pdraft001", "pnexiste01", "../x", "", "<script>"]) assert.equal((await def.routes.place(get("place", { c }), ctx)).status, 404, c);
  assert.equal((await def.routes.place(get("place", { c: "pfiche001" }, { method: "POST" }), ctx)).status, 405);
});

test("route « list » : la liste filtrée en morceaux de HTML pour la recherche sans rechargement", async () => {
  const ctx = ctxFor({ perPage: 5 });
  for (let i = 0; i < 12; i++) await addPlace(ctx, { name: i % 2 ? `Pair ${i}` : `Impair ${i}` });
  const j = await body(await def.routes.list(get("list", { q: "impair" }), ctx));
  assert.equal(j.total, 6); assert.equal(j.pages, 2); assert.equal(j.count, "6 lieux");
  assert.equal((j.items.match(/class="cm-item"/g) ?? []).length, 5);
  has(j.pager, /page\/2/);
  assert.equal(((await body(await def.routes.list(get("list", { q: "impair", p: "2" }), ctx))).items.match(/class="cm-item"/g) ?? []).length, 1);
  assert.equal((await body(await def.routes.list(get("list", { q: "zzz" }), ctx))).total, 0);
  assert.equal((await body(await def.routes.list(get("list", { p: "-5" }), ctx))).page, 1);
  assert.equal((await body(await def.routes.list(get("list", { p: "99999" }), ctx))).page, 3);
});

test("route « go » (recherche sans JavaScript) : redirige vers une adresse construite ici, jamais vers une adresse donnée par la requête", async () => {
  const ctx = ctxFor();
  const r = await def.routes.go(get("go", { q: "café  gâteau", t: "studio" }), ctx);
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("location"), "/map/t/studio/q/caf%C3%A9%20g%C3%A2teau");
  assert.equal((await def.routes.go(get("go", { q: "", t: "" }), ctx)).headers.get("location"), "/map");
  for (const evil of ["https://evil.example/", "//evil.example", "/\\evil.example", "../../x", "\r\nSet-Cookie: a=b", "javascript:alert(1)"]) {
    const loc = (await def.routes.go(get("go", { q: evil, t: evil }), ctx)).headers.get("location");
    assert.ok(loc.startsWith("/map"), `${evil} → ${loc}`);
    assert.ok(!/^\/\/|:\/\/|\r|\n/.test(loc), loc);
    assert.ok(loc.split("/").slice(2).every((s) => !s.includes("/")));
  }
  assert.equal((await def.routes.go(get("go", { q: "a" }, { method: "POST" }), ctx)).status, 405);
  assert.equal((await def.routes.go(get("go", { q: "a" }), ctxFor({}, { basePath: null }))).status, 404);
});

test("limite de débit : au-delà de 30 demandes de points par minute, un visiteur reçoit 429 ; un autre visiteur n'est pas gêné", async () => {
  const ctx = ctxFor();
  await addPlace(ctx, { name: "A" });
  let last;
  for (let i = 0; i < 31; i++) last = (await def.routes.points(get("points", {}, { ip: "198.51.100.1" }), ctx)).status;
  assert.equal(last, 429);
  assert.equal((await def.routes.points(get("points", {}, { ip: "198.51.100.2" }), ctx)).status, 200);
});

const events = (extra = {}) => fakeMapPlaces([
  { id: "ev-1", title: "Rencontre d'automne", lat: 12.5, lng: 34.5, kind: "event", at: inDays(10), url: "https://events.example/ev-1", note: "Venez nombreux" },
  { id: "ev-2", title: "Soirée passée", lat: 12.6, lng: 34.6, kind: "event", at: inDays(-30) },
  { id: "st-1", title: "Studio partenaire", lat: 13.1, lng: 35.1, kind: "studio" },
  { id: "bad-1", title: "Sans position", lat: 999, lng: 1, kind: "event" },
  { id: "bad-2", title: "Zéro", lat: 0, lng: 0 },
  { id: "bad-3", lat: 1, lng: 2 },
], { source: { instance: "agenda", module: "events", name: "Agenda des événements" }, ...extra });

test("lieux d'ailleurs : lus en lecture seule, avec pastille de la source, genre traduit, date, passés cachés, invalides écartés", async () => {
  const provider = events();
  const ctx = ctxFor({}, { topics: { "map.place": provider.topic } });
  await addType(ctx, "event", "Événement", "Event", "📅");
  await addPlace(ctx, { name: "Mon lieu", type: "event" });
  const h = await html(ctx);
  assert.ok(h.includes("Rencontre d&#39;automne") && h.includes("Studio partenaire") && h.includes("Mon lieu"));
  assert.ok(!h.includes("Soirée passée"), "événement passé caché");
  assert.ok(!h.includes("Sans position") && !h.includes("Zéro"));
  has(h, /<span class="cm-pill">Via Agenda des événements<\/span>/);
  has(h, /Venez nombreux/); has(h, /<strong>Date :<\/strong>/); has(h, /href="https:\/\/events\.example\/ev-1"/); has(h, /3 lieux/);
  has(h, /href="\/map\/t\/event"/); has(h, /href="\/map\/t\/studio"/);
  assert.equal(provider.calls.at(-1).limit, 200, "borne du cœur : 200 lieux d'ailleurs");
  assert.equal(provider.items.length, 6);
  assert.equal(rows(ctx, "map_places").length, 1, "rien n'est recopié dans les lieux de l'équipe");
  const pts = (await body(await def.routes.points(get("points"), ctx))).pts;
  assert.equal(pts.filter((p) => p[5] === 1).length, 2);
  const code = pts.find((p) => p[4] === "Studio partenaire")[0];
  assert.match(code, /^x[0-9a-f]{12}$/);
  assert.equal((await page(ctx, ["p", code])).title, "Studio partenaire");
});

test("lieux d'ailleurs : « membre » n'est jamais montré mieux que reçu (position reprise telle quelle à 5 décimales, aucune adresse ajoutée)", async () => {
  const provider = fakeMapPlaces([{ id: "m-1", title: "Une créatrice", lat: 12.34567891, lng: 34.56789123, kind: "member" }], { source: { instance: "annuaire", module: "directory", name: "Annuaire" } });
  const ctx = ctxFor({}, { topics: { "map.place": provider.topic } });
  const j = await body(await def.routes.points(get("points"), ctx));
  assert.equal(j.pts.length, 1);
  assert.equal(j.pts[0][1], 12.34568); assert.equal(j.pts[0][2], 34.56789);
  const h = await html(ctx);
  assert.ok(!/Adresse :/.test(h), "aucune adresse inventée");
  has(h, /Membre/); has(h, /Via Annuaire/);
});

test("lieux d'ailleurs : l'équipe peut en masquer un à un (sans rien modifier chez la source), et réafficher", async () => {
  const provider = events();
  const ctx = ctxFor({}, { topics: { "map.place": provider.topic } });
  const before = JSON.stringify(provider.items);
  const code = (await body(await def.routes.points(get("points"), ctx))).pts.find((p) => p[4] === "Studio partenaire")[0];
  assert.ok((await def.adminActions.hideExternal.run(ctx, { id: code })).ok);
  const after = await html(ctx);
  assert.ok(!after.includes("Studio partenaire")); assert.ok(after.includes("Rencontre"));
  assert.equal((await page(ctx, ["p", code])).notFound, true, "même la fiche directe est cachée");
  assert.equal(rows(ctx, "map_hidden").length, 1);
  assert.equal(JSON.stringify(provider.items), before, "la donnée d'origine n'a pas bougé");
  await def.adminActions.showExternal.run(ctx, { id: code });
  assert.ok((await html(ctx)).includes("Studio partenaire"));
  assert.equal(rows(ctx, "map_hidden").length, 0);
});

test("lieux d'ailleurs : couper l'affichage ou garder les événements passés se règle ; plusieurs sources sont distinguées", async () => {
  const provider = events();
  const off = ctxFor({ showExternal: false }, { topics: { "map.place": provider.topic } });
  await addPlace(off, { name: "Seul" });
  assert.ok(!(await html(off)).includes("Rencontre"));
  assert.equal(provider.calls.length, 0, "aucune lecture quand c'est coupé");
  assert.ok((await html(ctxFor({ hidePast: false }, { topics: { "map.place": provider.topic } }))).includes("Soirée passée"));
  const two = fakeMapPlaces([{ id: "ev-1", title: "Autre source", lat: 1, lng: 2 }], { source: { instance: "autre", module: "x", name: "Autre agenda" } });
  const both = ctxFor({}, { topics: { "map.place": async (o) => [...(await provider.topic(o)), ...(await two.topic(o))] } });
  const h = await html(both);
  has(h, /Via Agenda des événements/); has(h, /Via Autre agenda/);
  const ids = (await body(await def.routes.points(get("points"), both))).pts.map((p) => p[0]);
  assert.equal(new Set(ids).size, ids.length);
});

test("lieux d'ailleurs : source absente, en panne, illisible ou lente → la page marche avec ses propres lieux, rien ne reste suspendu", async () => {
  for (const mode of ["absent", "down", "garbage", "slow"]) {
    const provider = events(); provider.mode = mode;
    const ctx = ctxFor({}, { topics: { "map.place": provider.topic } });
    await addPlace(ctx, { name: "Mon lieu" });
    data.TIMING.externalMs = 40;
    const t0 = Date.now();
    const h = await html(ctx);
    data.TIMING.externalMs = 2500;
    assert.ok(Date.now() - t0 < 1500, `${mode} : pas d'attente`);
    assert.ok(h.includes("Mon lieu"), mode); assert.ok(!h.includes("Rencontre"), mode);
    if (mode === "absent") assert.ok(!/n&#39;ont pas pu être chargés/.test(h)); else has(h, /n&#39;ont pas pu être chargés/, `${mode} : la panne est dite`);
  }
  const broken = ctxFor({}, { topics: { "map.place": () => { throw new Error("boom"); } } });
  await addPlace(broken, { name: "Seul" });
  assert.ok((await html(broken)).includes("Seul"));
});

test("lieux d'ailleurs : une panne après un succès garde les dernières données connues ; la mémoire dure 20 secondes", async (t) => {
  const provider = events();
  const ctx = ctxFor({}, { topics: { "map.place": provider.topic } });
  await addPlace(ctx, { name: "Mon lieu" });
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const first = await data.external(ctx);
  assert.equal(first.ok, true);
  const calls = provider.calls.length;
  await data.external(ctx);
  assert.equal(provider.calls.length, calls, "mémoire encore valable");
  t.mock.timers.tick(21_000);
  provider.mode = "down";
  const stale = await data.external(ctx);
  assert.equal(provider.calls.length, calls + 1, "mémoire expirée : relue");
  assert.equal(stale.ok, false);
  assert.equal(stale.places.length, first.places.length, "les dernières données connues restent");
  assert.ok((await html(ctx)).includes("Rencontre"));
  provider.mode = "ok";
  t.mock.timers.tick(21_000);
  assert.equal((await data.external(ctx)).ok, true);
});

test("volume : 5000 lieux — page, points, recherche restent rapides, 50 lieux au plus à l'écran, et la mémoire évite de relire le stockage", async () => {
  const ctx = ctxFor({ perPage: 50 });
  await addType(ctx, "studio", "Studio", "Studio", "🎙️"); await addType(ctx, "address", "Adresse", "Address", "⭐");
  const batch = [];
  for (let i = 0; i < 5000; i++) batch.push({ data: { code: `p${String(i).padStart(7, "0")}z`, name: `Lieu ${i} ${i % 7 === 0 ? "café" : "bar"}`, type: i % 2 ? "studio" : "address", lat: -80 + (i % 160) + (i % 97) / 100, lng: -170 + (i % 340) + (i % 89) / 100, address: `${i} rue de la Paix`, desc: "Une description assez longue ".repeat(10), hours: "9 h–18 h", url: "", status: "published", pos: i + 1, by: "admin" } });
  await ctx.api.store.addMany("map_places", batch);
  data.invalidate(ctx);
  let t0 = Date.now();
  const p = await page(ctx);
  assert.ok(Date.now() - t0 < 3000, `première page : ${Date.now() - t0} ms`);
  assert.equal((p.blocks[0].html.match(/class="cm-item"/g) ?? []).length, 50);
  has(p.blocks[0].html, /5000 lieux/); has(p.blocks[0].html, /Page 1 sur 100/);
  t0 = Date.now();
  const txt = await (await def.routes.points(get("points"), ctx)).text();
  assert.ok(Date.now() - t0 < 1500, `points : ${Date.now() - t0} ms`);
  assert.equal(JSON.parse(txt).n, 5000);
  assert.ok(txt.length < 600_000, `points : ${txt.length} octets pour 5000 lieux`);
  t0 = Date.now();
  assert.ok((await body(await def.routes.list(get("list", { q: "café 700" }), ctx))).total >= 1);
  assert.ok(Date.now() - t0 < 1500);
  const reads = ctx.api.store.page;
  let count = 0;
  ctx.api.store.page = async (...a) => { count++; return reads(...a); };
  await page(ctx); await def.routes.points(get("points", {}, { ip: "198.51.100.9" }), ctx);
  assert.equal(count, 0, "la mémoire (20 s) évite de relire 5000 lieux à chaque visite");
  await def.adminActions.removePlace.run(ctx, { id: [...ctx.api.store.rows.values()].find((r) => r.collection === "map_places").id });
  await page(ctx);
  assert.ok(count > 0, "une écriture vide la mémoire");
});

test("instances multiples : deux cartes (studios, événements) ont chacune leurs lieux, leurs types, leurs mots et leur mémoire", async () => {
  const a = ctxFor({ wordOne: "studio", wordMany: "studios" }), b = ctxFor({ wordOne: "événement", wordMany: "événements" });
  assert.notEqual(a.instance.key, b.instance.key);
  await def.hooks.onInstanceCreate(a); await def.hooks.onInstanceCreate(b);
  await def.adminActions.applyTemplate.run(a, { template: "community" });
  await addPlace(a, { name: "Studio A" }); await addPlace(b, { name: "Fête B" });
  const ha = await html(a), hb = await html(b);
  assert.ok(ha.includes("Studio A") && !ha.includes("Fête B"));
  assert.ok(hb.includes("Fête B") && !hb.includes("Studio A"));
  has(ha, /1 studio</); has(hb, /1 événement</);
  assert.notDeepEqual((await data.world(a)).types.map((t) => t.id), (await data.world(b)).types.map((t) => t.id));
  assert.notEqual(ha.match(/\/m\/(map\d+)\//)[1], hb.match(/\/m\/(map\d+)\//)[1]);
});

test("pied de page : lien facultatif vers la page (désactivé par défaut)", () => {
  assert.equal(def.slots["layout.footer"](ctxFor({ footerLink: false })), null);
  assert.deepEqual(def.slots["layout.footer"](ctxFor({ footerLink: true }))[0].items, [{ label: "Carte", href: "/map" }]);
  assert.equal(def.slots["layout.footer"](ctxFor({ footerLink: true }, { basePath: null })), null);
  assert.equal(def.slots["layout.footer"](ctxFor({ footerLink: true }, { locale: "en" }))[0].items[0].href, "/en/map");
});
