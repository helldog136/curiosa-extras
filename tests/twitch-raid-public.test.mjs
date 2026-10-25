// Raid Twitch 2.2 — LA PAGE PUBLIQUE « En direct en ce moment », sa route de rafraîchissement, le dock de la sélection (OBS), l'onglet d'administration,
// le vocabulaire réglable, le consentement, Twitch lent ou en panne, la parité FR/EN, la neutralité et la mise à jour à chaud. Contacts et Twitch sont des doubles.
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { world, logins, login, T0, fr, en, manifest, DIR } from "./helpers/twitch-raid-world.mjs";

const def = (await import("../modules/twitch-raid/index.mjs")).default;
const M = await import("../modules/twitch-raid/moment.mjs");
const pub = await import("../modules/twitch-raid/public.mjs");
const data = await import("../modules/twitch-raid/data.mjs");
const live = await import("../modules/twitch-raid/live.mjs");
const search = await import("../modules/twitch-raid/search.mjs");
const source = await import("../modules/twitch-raid/source.mjs");
const streams = await import("../modules/twitch-raid/streams.mjs");
const consent = await import("../modules/twitch-raid/consent.mjs");
const momentAdmin = await import("../modules/twitch-raid/moment-admin.mjs");
const admin = await import("../modules/twitch-raid/admin.mjs");

const MIN = 60_000, BASE = "https://site.example.test";
const REPO = path.resolve(DIR, "../..");   // le dépôt des modules (les tests tournent depuis le dossier du cœur)
let clock;
const t0 = { ...streams.timing }, p0 = { ...pub.timing }, l0 = { ...pub.limits }, c0 = { ...consent.timing }, s0 = { ...source.timing };
beforeEach(() => { live.resetLive(); search.resetSearch(); source.resetSource(); M.resetMoment(); pub.resetPublic(); clock = T0; M.hooks.now = () => clock; M.hooks.rng = null; });
afterEach(() => { Object.assign(streams.timing, t0); Object.assign(pub.timing, p0); Object.assign(pub.limits, l0); Object.assign(consent.timing, c0); Object.assign(source.timing, s0); });

const lives = (n, from = 0, f = (i) => ({ viewers: 5 + i, minutes: 20 + i })) => Object.fromEntries(logins(n, from).map((l, i) => [l, f(i)]));
const site = (o = {}) => world({ partners: o.partners ?? logins(20), live: o.live ?? lives(20), settings: { publicPage: true, ...(o.settings ?? {}) }, ...(o.extra ?? {}) });
const keep = async (fn) => { const t = setInterval(() => {}, 25); try { return await fn(); } finally { clearInterval(t); } };
const html = async (w, segments = []) => { const p = await keep(() => def.page(w.ctx, { segments })); return { p, html: p?.blocks?.[0]?.html ?? "" }; };
const members = async (w, { method = "GET", headers = {} } = {}) => keep(() => def.routes.members(new Request(`${BASE}/m/${w.ctx.instance.key}/members`, { method, headers }), w.ctx));
const cards = (h) => [...h.matchAll(/<li class="tr-card" data-login="([^"]+)"/g)].map((m) => m[1]);
const dec = (h) => h.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const text = (h) => dec(h.replace(/<style>.*?<\/style>/s, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
const secretUrl = async (w, route) => `${BASE}/m/${w.ctx.instance.key}/${route}?k=${encodeURIComponent(await data.dockSecret(w.ctx))}`;

/* ───────────── La page ───────────── */

test("éteinte par défaut : la page publique répond comme une page qui n'existe pas (404), la route aussi ; allumée : titre, intro, N membres", async () => {
  const off = world({ partners: logins(5), live: lives(5) });
  assert.equal((await keep(() => def.page(off.ctx, { segments: [] }))).notFound, true);
  const r = await members(off); assert.equal(r.status, 404); assert.equal(await r.text(), "Not found", "éteinte : la réponse du cœur pour une route inconnue, mot pour mot");
  assert.equal(manifest.settings.find((s) => s.key === "publicPage").default, false);
  assert.equal(manifest.page, true, "le cœur peut monter la page (un site existant n'a pas d'adresse : rien n'est publié)");
  const w = site();
  const { p, html: h } = await html(w);
  assert.equal(p.title, "En direct en ce moment"); assert.equal(p.scripts[0], "live-members.js");
  assert.equal(cards(h).length, 5, "5 membres par défaut");
  assert.match(h, /Voici qui est en direct sur Twitch maintenant/);
  assert.equal((await keep(() => def.page(w.ctx, { segments: ["x"] }))).notFound, true, "pas de sous-pages");
  assert.ok(fs.statSync(`${DIR}/scripts/live-members.js`).size < 32 * 1024, "le script tient dans la limite du cœur (32 Ko)");
});

test("chaque carte : nom, jeu, titre, spectateurs (pluriel), durée du direct, bouton « Regarder sur Twitch » = lien sortant sûr ; N réglable", async () => {
  const w = site({ partners: logins(3), live: { [login(0)]: { viewers: 1, minutes: 5, game: "Jeu A", title: "Titre A" }, [login(1)]: { viewers: 42, minutes: 90, game: "", title: "" }, [login(2)]: { viewers: 0, minutes: 0 } }, settings: { count: 3 } });
  const { html: h } = await html(w);
  assert.deepEqual(cards(h).sort(), logins(3));
  const a = h.match(new RegExp(`<li class="tr-card" data-login="${login(0)}".*?</li>`, "s"))[0];
  assert.match(a, /<h3 class="tr-name">MEMBRE_0000<\/h3>/); assert.match(a, /Jeu A/); assert.match(a, /Titre A/);
  assert.match(a, /1 spectateur</); assert.match(a, /En direct depuis 5 min/);
  assert.match(a, new RegExp(`href="https://www\\.twitch\\.tv/${login(0)}" target="_blank" rel="noopener noreferrer"`));
  assert.match(a, /Regarder sur Twitch/); assert.match(a, /s(?:'|&#39;)ouvre dans un nouvel onglet/);
  assert.match(h, /42 spectateurs/); assert.match(h, /En direct depuis 1 h 30/); assert.match(h, /&lt; 1 min|< 1 min/);
  assert.equal(cards((await html(site({ settings: { count: 2 } }))).html).length, 2);
  assert.equal(cards((await html(site({ settings: { count: 99 } }))).html).length, 10);
});

test("tout est échappé : un nom, un jeu ou un titre piégé ne fabrique jamais de HTML ni de lien", async () => {
  const evil = `<img src=x onerror=alert(1)> "quote" 'apos' <script>alert(2)</script> javascript:alert(3)`;
  const w = site({ partners: [{ login: login(0), name: evil }], live: { [login(0)]: { viewers: 3, minutes: 3, game: evil, title: evil } }, settings: { count: 1, pageTitle: evil, emptyText: evil, watchLabel: evil, pageIntro: evil } });
  const { p, html: h } = await html(w);
  assert.ok(!/<script>alert|<img src=x|onerror=alert\(1\)>/i.test(h.replace(/<style>.*?<\/style>/s, "")), "aucune balise reçue n'est reprise telle quelle");
  assert.ok(h.includes("&lt;img src=x onerror=alert(1)&gt;"));
  assert.ok(!/href="javascript:/i.test(h));
  assert.equal(typeof p.title, "string");
  assert.match((await (await members(w)).json()).picks[0].url, /^https:\/\/www\.twitch\.tv\/membre_0000$/);
});

test("vocabulaire réglable : titre, introduction, texte « personne en direct », libellé du bouton ; valeurs simples par défaut (FR et EN), aucun nom de communauté", async () => {
  const set = { pageTitle: "Nos créateurs en live", pageIntro: "Allez les voir !", emptyText: "Calme plat ce soir.", watchLabel: "Aller voir" };
  const w = site({ partners: logins(3), live: lives(2), settings: set });
  const { p, html: h } = await html(w);
  assert.equal(p.title, "Nos créateurs en live"); assert.match(h, /Allez les voir !/); assert.match(h, /Aller voir/); assert.ok(!/Regarder sur Twitch/.test(text(h)));
  assert.match(text((await html(site({ partners: logins(3), live: {}, settings: set }))).html), /Calme plat ce soir\./);
  const e = world({ partners: logins(3), live: lives(3), settings: { publicPage: true }, locale: "en", messages: { ...en } });
  const eh = await html(e); assert.equal(eh.p.title, "Live right now"); assert.match(eh.html, /Watch on Twitch/); assert.match(eh.html, /opens in a new tab/);
  const en0 = world({ partners: logins(3), live: {}, settings: { publicPage: true }, locale: "en", messages: { ...en } });
  assert.match(text((await html(en0)).html), /Nobody is live right now\./);
  assert.match(text((await html(site({ partners: logins(3), live: {} }))).html), /Personne n'est en direct pour le moment\./);
  for (const k of ["pageTitle", "pageIntro", "emptyText", "watchLabel"]) assert.equal(manifest.settings.find((s) => s.key === k).translatable, true, `${k} est traduisible`);
});

test("vide aimable : personne en direct → une phrase douce (pas d'erreur, pas de liste) ; liste de raid vide aussi", async () => {
  for (const w of [site({ live: {} }), site({ partners: [], live: {} })]) {
    const { html: h } = await html(w);
    assert.equal(cards(h).length, 0);
    assert.match(h, /class="tr-grid"[^>]* hidden/); assert.match(h, /<div class="tr-empty" role="status">/);
    assert.match(text(h), /Personne n'est en direct pour le moment\. Revenez dans un instant/);
  }
  const r = await (await members(site({ live: {} }))).json();
  assert.deepEqual([r.state, r.picks], ["ok", []]);
});

test("consentement : la page ne montre que des membres montrables (jamais « Ne pas montrer », jamais une fiche à relire) et jamais les autres de la liste", async () => {
  const ps = logins(20).map((l, i) => ({ login: l, hidden: i % 2 === 0, status: i === 3 ? "to_review" : "active" }));
  const w = world({ partners: ps, live: lives(20), settings: { publicPage: true, count: 10 } });
  const { html: h } = await html(w);
  const shown = cards(h);
  assert.ok(shown.length > 0 && shown.length <= 10);
  for (const l of shown) { const i = Number(l.slice(-4)); assert.ok(i % 2 === 1 && i !== 3, `${l} ne devrait pas apparaître`); }
  const j = JSON.stringify(await (await members(w)).json());
  for (const l of logins(20).filter((x) => !shown.includes(x))) assert.ok(!h.includes(l) && !j.includes(l), `${l} n'est pas dans la sélection : il ne doit nulle part apparaître`);
  assert.ok(!/contactId|categoryIds|"pool"/.test(j));
});

test("Twitch en panne : dernière sélection connue (avec un mot), puis un message aimable ; jamais une page d'erreur", async () => {
  const w = site();
  const first = cards((await html(w)).html);
  w.api.fail = "network"; clock = T0 + MIN; live.resetLive();
  const { html: h } = await html(w);
  assert.deepEqual(cards(h), first);
  assert.match(h, /Twitch tarde à répondre : voici la dernière sélection connue/);
  const j = await (await members(w)).json(); assert.equal(j.state, "ok"); assert.equal(j.stale, T0);
  clock = T0 + 12 * MIN; live.resetLive();
  const down = await html(w);
  assert.equal(cards(down.html).length, 0); assert.match(down.html, /class="tr-empty tr-unavail" role="status">/);
  assert.match(text(down.html), /Les informations en direct ne sont pas disponibles pour le moment/);
  const jr = await members(w); const jb = await jr.json();
  assert.deepEqual([jr.status, jb.state, jr.headers.get("cache-control")], [200, "unavailable", "no-store"]);
  assert.ok(!JSON.stringify(jb).includes("network"), "la raison de la panne n'est pas publique");
});

test("Twitch lent : la page s'ouvre quand même (attente bornée) avec « chargement », et le script la complète", async () => {
  streams.timing.callMs = 200; streams.timing.packetMs = 150; pub.timing.pageWaitMs = 80;
  const w = site(); w.api.hang = true;
  const t = Date.now();
  const { html: h } = await html(w);
  assert.ok(Date.now() - t < 2500);
  assert.match(h, /<p class="tr-loading tr-hint">Chargement…<\/p>/); assert.equal(cards(h).length, 0);
  pub.timing.routeWaitMs = 80;
  assert.equal((await (await members(w)).json()).state, "unavailable");
});

test("route publique « members » : GET seulement, aucune clé, aucun cookie, cache court, ne donne que les N membres ; limite de débit par visiteur", async () => {
  const w = site();
  const r = await members(w);
  assert.equal(r.status, 200); assert.match(r.headers.get("content-type"), /application\/json/); assert.equal(r.headers.get("cache-control"), "public, max-age=20");
  assert.equal(r.headers.get("set-cookie"), null);
  const j = await r.json();
  assert.deepEqual(Object.keys(j).sort(), ["asOf", "now", "picks", "state"]);
  assert.equal(j.picks.length, 5);
  for (const p of j.picks) assert.deepEqual(Object.keys(p).sort(), ["game", "login", "name", "startedAt", "title", "url", "viewers"]);
  assert.equal((await members(w, { method: "POST" })).status, 405);
  assert.equal((await members(w, { method: "PUT" })).status, 405);
  assert.deepEqual(j.picks.map((p) => p.login), cards((await html(w)).html));
  pub.limits.perMinute = 5;
  const h1 = { "x-forwarded-for": "203.0.113.5" }, h2 = { "x-forwarded-for": "203.0.113.9" };
  let last; for (let i = 0; i < 7; i++) last = await members(w, { headers: h1 });
  assert.equal(last.status, 429); assert.equal(last.headers.get("retry-after"), "30");
  assert.equal((await members(w, { headers: h2 })).status, 200);
});

test("aperçus : AUCUNE image de Twitch tant que le visiteur n'a pas cliqué (adresse en data-src, jamais en src) ; sans le réglage, aucune adresse d'image du tout", async () => {
  const w = site({ settings: { thumbs: true, count: 2 } });
  const { html: h } = await html(w);
  assert.ok(!/<img[^>]* src=/.test(h), "pas de src au chargement");
  assert.equal([...h.matchAll(/data-src="https:\/\/static-cdn\.jtvnw\.net\/previews-ttv\/[^"]+-320x180\.jpg"/g)].length, 2);
  assert.match(h, /data-thumbs="1"/); assert.match(h, /referrerpolicy="no-referrer"/);
  assert.match(h, /<div class="tr-tools" hidden><button type="button" class="tr-toggle" aria-pressed="false">Afficher les aperçus<\/button>/, "le bouton est caché tant que le script ne l'a pas mis en place");
  const off = await html(site({ settings: { count: 2 } }));
  assert.ok(!/jtvnw|data-src="https/.test(off.html)); assert.match(off.html, /data-thumbs="0"/);
  assert.ok(!JSON.stringify(await (await members(site({ settings: { count: 2 } }))).json()).includes("jtvnw"));
  assert.ok(JSON.stringify(await (await members(w)).json()).includes("jtvnw.net"));
  const bad = site({ live: Object.fromEntries(logins(3).map((l) => [l, { viewers: 3, thumb: "https://evil.example/x-{width}x{height}.jpg" }])), settings: { thumbs: true, count: 3 } });
  assert.ok(!JSON.stringify(await (await members(bad)).json()).includes("evil"));
  for (const u of ["http://static-cdn.jtvnw.net/a.jpg", "https://evil.test/jtvnw.net/a.jpg", "https://x.jtvnw.net.evil.test/a.jpg", "javascript:alert(1)", "", null]) assert.equal(streams.thumbUrl(u), "", String(u));
  assert.equal(streams.thumbUrl("https://static-cdn.jtvnw.net/previews-ttv/live_user_x-{width}x{height}.jpg"), "https://static-cdn.jtvnw.net/previews-ttv/live_user_x-320x180.jpg");
});

test("le script de la page : un fichier du module, sans HTML injecté, sans adresse extérieure, sans eval ; il lit seulement la route du site", () => {
  const code = fs.readFileSync(`${DIR}/scripts/live-members.js`, "utf8");
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|https?:\/\//.test(code.replace(/\/\*[\s\S]*?\*\//g, "")), "pas de HTML injecté ni d'adresse extérieure");
  assert.match(code, /textContent/); assert.match(code, /credentials: "omit"/); assert.match(code, /visibilitychange/);
  execFileSync(process.execPath, ["--check", `${DIR}/scripts/live-members.js`]);
  assert.match(code, /try \{[^}]*localStorage/);
});

/* ───────────── Le dock de la sélection (OBS) ───────────── */

test("dock de la sélection : même adresse secrète que le dock ordinaire ; sans la clé, une phrase et rien d'autre ; la page ne contient aucune donnée", async () => {
  const w = site({ settings: { publicPage: false } });
  const bad = await def.routes.featured(new Request(`${BASE}/m/${w.ctx.instance.key}/featured?k=nope`), w.ctx);
  assert.equal(bad.status, 403); assert.ok(!/membre_/.test(await bad.text()));
  const ok = await def.routes.featured(new Request(await secretUrl(w, "featured")), w.ctx);
  assert.equal(ok.status, 200);
  const h = await ok.text();
  assert.match(ok.headers.get("content-security-policy"), /script-src 'nonce-[^']+'; style-src 'nonce-[^']+'; connect-src 'self'; img-src data:/);
  assert.equal(ok.headers.get("cache-control"), "no-store");
  assert.match(h, /Sélection du moment/); assert.match(h, /Tirer de nouveau/);
  assert.ok(!/membre_00/.test(h), "aucun pseudo dans la page elle-même");
  for (const route of ["featured-data", "featured-again"]) assert.equal((await def.routes[route](new Request(`${BASE}/m/${w.ctx.instance.key}/${route}?k=nope`, { method: route === "featured-again" ? "POST" : "GET" }), w.ctx)).status, 403);
  assert.equal((await def.routes.featured(new Request(await secretUrl(w, "featured"), { method: "POST" }), w.ctx)).status, 405);
  assert.equal((await def.routes["featured-data"](new Request(await secretUrl(w, "featured-data"), { method: "POST" }), w.ctx)).status, 405);
  assert.equal((await def.routes["featured-again"](new Request(await secretUrl(w, "featured-again")), w.ctx)).status, 405, "tirer de nouveau est une action : POST seulement");
});

test("dock de la sélection : les données sont celles de la page publique ; « Tirer de nouveau » change la sélection pour tout le monde, au plus toutes les 5 secondes", async () => {
  const w = site();
  const get = async () => (await def.routes["featured-data"](new Request(await secretUrl(w, "featured-data")), w.ctx)).json();
  const again = async () => (await def.routes["featured-again"](new Request(await secretUrl(w, "featured-again"), { method: "POST" }), w.ctx)).json();
  const a = await get();
  assert.equal(a.state, "ok"); assert.equal(a.picks.length, 5); assert.equal(a.count, 5); assert.equal(a.minutes, 10); assert.equal(a.endsAt, T0 + 10 * MIN); assert.equal(a.pool, 20);
  assert.deepEqual(a.picks.map((p) => p.login), (await (await members(w)).json()).picks.map((p) => p.login), "dock et page : les MÊMES membres");
  clock = T0 + 30_000;
  const b = await again();
  assert.equal(b.rerolled, true); assert.ok(b.picks.every((p) => !a.picks.some((x) => x.login === p.login)));
  assert.deepEqual((await (await members(w)).json()).picks.map((p) => p.login), b.picks.map((p) => p.login), "la page publique suit");
  clock = T0 + 32_000;
  const c = await again();
  assert.equal(c.wait, true); assert.deepEqual(c.picks.map((p) => p.login), b.picks.map((p) => p.login));
  assert.ok(!JSON.stringify(a).includes("contactId"));
  const down = site(); down.api.fail = "network";
  const e = await (await def.routes["featured-data"](new Request(await secretUrl(down, "featured-data")), down.ctx)).json();
  assert.deepEqual([e.state, e.reason], ["error", "network"]);
});

test("réglage « Que montre le dock ordinaire ? » : par défaut le dock d'avant ; « sélection » : la même adresse montre la sélection", async () => {
  const before = site({ settings: {} });
  const old = await (await def.routes.dock(new Request(await secretUrl(before, "dock")), before.ctx)).text();
  assert.match(old, /Partenaires en direct/); assert.doesNotMatch(old, /Tirer de nouveau/);
  const sel = site({ settings: { dockMode: "selection" } });
  const pg = await (await def.routes.dock(new Request(await secretUrl(sel, "dock")), sel.ctx)).text();
  assert.match(pg, /Tirer de nouveau/); assert.match(pg, /featured-data\?k=/);
  const lv = await (await def.routes.live(new Request(await secretUrl(sel, "live")), sel.ctx)).json();
  assert.equal(lv.mode, "full"); assert.equal(lv.live.length, 20);
  assert.equal((await def.routes.dock(new Request(`${BASE}/m/${sel.ctx.instance.key}/dock?k=zzz`), sel.ctx)).status, 403);
  assert.equal(manifest.settings.find((s) => s.key === "dockMode").default, "list");
});

test("dock de la sélection : chaque phrase que la page lit (L.xxx) existe vraiment dans ses libellés, en FR et en EN (pas de « undefined » à l'écran)", async () => {
  const code = fs.readFileSync(`${DIR}/featured-dock.mjs`, "utf8");
  const fd = await import("../modules/twitch-raid/featured-dock.mjs");
  const used = new Set([...code.matchAll(/\bL\.([a-z_]+)/g)].map((m) => m[1]).filter((k) => !k.endsWith("_")));
  for (const [lang, msgs] of [["fr", fr], ["en", en]]) {
    const w = world({ partners: [], settings: {}, locale: lang, messages: { ...msgs } });
    const L = fd.labelsOf(w.ctx);
    for (const k of used) assert.ok(typeof L[k] === "string" && L[k] && L[k] !== k, `${lang} : libellé « ${k} » absent`);
    for (const r of ["no_channel", "channel_unknown", "setup", "refused", "outdated", "contacts_missing", "contacts_old", "contacts_down", "category_gone", "no_category", "choose"]) assert.ok(L[`nr_${r}`], `${lang} : nr_${r}`);
  }
  const s = site();
  const page = await (await def.routes.featured(new Request(await secretUrl(s, "featured")), s.ctx)).text();
  assert.ok(!/\bundefined\b/.test(page.replace(/<script[\s\S]*<\/script>/, "")));
});

/* ───────────── Administration ───────────── */

test("onglet « Sélection du moment » : explication, adresse du dock (copiable, avec la clé), boutons, état de la page publique ; l'ancien onglet ne change pas", async () => {
  const w = site({ settings: { publicPage: false } });
  const blocks = await admin.panel(w.ctx, { query: {} });
  const mine = blocks.filter((b) => b.tab === "moment"), rest = blocks.filter((b) => b.tab !== "moment");
  assert.ok(mine.length >= 8);
  assert.ok(blocks.every((b) => b.tab === undefined || b.tab === "moment"));
  assert.ok(rest.some((b) => b.type === "copy" && /\/dock\?k=/.test(b.text)), "l'adresse du dock ordinaire est toujours là");
  const copy = mine.find((b) => b.type === "copy");
  assert.match(copy.text, /^https:\/\/site\.example\.test\/m\/[^/]+\/featured\?k=[A-Za-z0-9_%-]+$/);
  assert.equal(copy.text.split("?k=")[1], (await secretUrl(w, "featured")).split("?k=")[1], "la même clé secrète que le dock ordinaire : « Nouvelle adresse » les change toutes les deux");
  assert.deepEqual(mine.filter((b) => b.type === "adminForm").map((b) => b.action), ["momentCheck", "momentReroll"]);
  assert.ok(mine.some((b) => b.type === "markdown" && /éteinte/.test(b.text)));
  assert.ok(mine.some((b) => b.type === "markdown" && /5 chaîne\(s\)/.test(b.text) && /10 minutes/.test(b.text)));
  const on = await admin.panel(site().ctx, { query: {} });
  assert.ok(on.some((b) => b.tab === "moment" && b.type === "links" && b.items[0].href === "/en-direct"));
  const np = await admin.panel(site({ extra: { basePath: null } }).ctx, { query: {} });
  assert.ok(np.some((b) => b.tab === "moment" && b.type === "banner" && /Adresse de la page/.test(b.text)));
  const odd = site({ settings: { count: 50, duration: 999, exclude: "camille_tv\nn'importe quoi ?!" } });
  const warns = (await admin.panel(odd.ctx, { query: {} })).filter((b) => b.tab === "moment" && b.type === "banner").map((b) => b.text).join(" | ");
  assert.match(warns, /1 à 10 : 10 est utilisé/); assert.match(warns, /1 à 240 minutes : 240 minutes/); assert.match(warns, /ignorés.*n'importe quoi/); assert.match(warns, /Exemple : camille_tv/);
});

test("administration : « Voir la sélection » et « Tirer de nouveau » disent ce qui se passe, avec des mots simples", async () => {
  const w = site();
  assert.match((await admin.actions.momentCheck(w.ctx)).ok, /Sélection actuelle : .*MEMBRE_00.*20 chaîne\(s\) peuvent être tirées/);
  clock = T0 + 30_000;
  assert.match((await admin.actions.momentReroll(w.ctx)).ok, /Nouvelle sélection : /);
  clock = T0 + 31_000;
  assert.match((await admin.actions.momentReroll(w.ctx)).error, /Patientez quelques secondes/);
  assert.match((await admin.actions.momentCheck(site({ live: {} }).ctx)).ok, /Aucune chaîne pouvant être montrée n'est en direct/);
  const down = site(); down.api.fail = "network";
  assert.match((await admin.actions.momentCheck(down.ctx)).error, /Twitch ne répond pas/);
  assert.ok((await admin.actions.momentCheck(world({ partners: [], settings: {} }).ctx)).error);
  for (const act of ["momentCheck", "momentReroll"]) assert.equal(typeof momentAdmin.actions[act], "function");
});

/* ───────────── Parité, neutralité, mise à jour à chaud ───────────── */

test("FR et EN : mêmes clés, aucune clé manquante dans le code, aucun texte vide, mêmes {variables}", () => {
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  for (const k of Object.keys(fr)) { assert.ok(fr[k] && en[k], k); assert.equal(vars(fr[k]), vars(en[k]), `variables de « ${k} »`); }
  const used = new Set();
  for (const f of fs.readdirSync(DIR).filter((n) => n.endsWith(".mjs"))) for (const m of fs.readFileSync(`${DIR}/${f}`, "utf8").matchAll(/\b(?:ctx\.t|[^.\w]t)\(\s*["']([a-z][a-z0-9_]*)["']/g)) used.add(m[1]);
  for (const k of used) assert.ok(k in fr, `clé « ${k} » utilisée mais absente des locales`);
  for (const s of manifest.settings) for (const f of ["label", "help"]) if (s[f]) assert.ok(s[f].fr && s[f].en, `${s.key}.${f}`);
  const everything = JSON.stringify([...Object.values(fr), ...Object.values(en), manifest.settings, manifest.description, manifest.tabs]).toLowerCase();
  for (const jargon of ["webhook", "token", "oauth", "payload", "endpoint", "slug"]) assert.ok(!everything.includes(jargon), `jargon : « ${jargon} »`);
});

test("neutralité : aucun nom de communauté, d'association, de ville ou de pays dans le code, les textes par défaut ni la documentation du module", () => {
  const bad = [];
  for (const f of fs.readdirSync(DIR, { recursive: true }).filter((f) => /\.(mjs|js|json|md)$/.test(String(f)))) {
    const t = fs.readFileSync(`${DIR}/${f}`, "utf8");
    for (const term of [/\basbl\b/i, /belgi/i, /bruxelles|brussels/i, /rosali/i, /(?<!author"?: ")helldog/i]) if (term.test(t)) bad.push(`${f} : ${term}`);
  }
  assert.deepEqual(bad, []);
  assert.ok(!/association|ngo|collectif/.test(JSON.stringify([fr, en]).toLowerCase().replace(/associ[ée]/g, "")), "pas de vocabulaire d'association figé dans les textes par défaut");
});

test("mise à jour à chaud : tout fichier du module importe ses voisins AVEC la version, et deux versions chargées dans le même processus répondent", async () => {
  for (const f of fs.readdirSync(DIR).filter((n) => n.endsWith(".mjs"))) {
    const code = fs.readFileSync(`${DIR}/${f}`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/^\s*(import|export)\b[^\n]*\bfrom\s+["']\.\.?\//m.test(code), `${f} : import statique d'un voisin sans version`);
    for (const m of code.matchAll(/await import\(([^)]*)\)/g)) if (/["'`]\.\//.test(m[1])) assert.ok(/\$\{v\}/.test(m[1]), `${f} : ${m[1]} sans version`);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-update-"));
  try {
    fs.cpSync(DIR, dir, { recursive: true });
    const load = (v) => import(`${pathToFileURL(path.join(dir, "index.mjs")).href}?v=${v}`);
    const a = (await load("une")).default, b = (await load("deux")).default;
    assert.deepEqual(Object.keys(a.routes).sort(), Object.keys(b.routes).sort());
    for (const route of ["members", "featured", "featured-data", "featured-again", "dock", "live", "pick"]) assert.equal(typeof b.routes[route], "function");
    assert.equal(typeof b.page, "function"); assert.equal(typeof b.mcp.raid_featured_now, "function");
    const w = site(); const r = await (await b.routes.members(new Request(`${BASE}/m/x/members`), w.ctx)).json();
    assert.equal(r.state, "ok"); assert.equal(r.picks.length, 5);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("mise à jour 2.1.0 → 2.2.0 dans le même processus : l'ancien code tourne d'abord, puis le nouveau se charge sans reprendre un ancien fichier (si l'historique git de la 2.1 est disponible)", async (t) => {
  let ref = null;
  for (const r of ["origin/master", "master", "HEAD~20"]) { try { const v = JSON.parse(execFileSync("git", ["show", `${r}:modules/twitch-raid/module.json`], { encoding: "utf8", cwd: REPO, stdio: ["ignore", "pipe", "ignore"] })).version; if (v.startsWith("2.1")) { ref = r; break; } } catch { /* pas cette référence */ } }
  if (!ref) return t.skip("pas d'historique git avec la 2.1");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-update-old-"));
  try {
    for (const f of execFileSync("git", ["ls-tree", "-r", "--name-only", ref, "modules/twitch-raid/"], { encoding: "utf8", cwd: REPO }).split("\n").filter(Boolean)) {
      const to = path.join(dir, f.replace("modules/twitch-raid/", ""));
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.writeFileSync(to, execFileSync("git", ["show", `${ref}:${f}`], { maxBuffer: 20 * 1024 * 1024, cwd: REPO }));
    }
    const load = (v) => import(`${pathToFileURL(path.join(dir, "index.mjs")).href}?v=${v}`);
    assert.deepEqual(Object.keys((await load("ancien")).default.routes).sort(), ["dock", "live", "pick"]);
    fs.rmSync(dir, { recursive: true, force: true }); fs.cpSync(DIR, dir, { recursive: true });
    const after = (await load("nouveau")).default;
    assert.ok(after.routes.featured && after.routes.members && after.page);
    const w = site(); assert.equal((await (await after.routes.members(new Request(`${BASE}/m/x/members`), w.ctx)).json()).state, "ok");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
