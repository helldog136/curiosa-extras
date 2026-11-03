// Planning 2.7.0 : la PHOTO des partenaires de stream. Vie privée d'abord : le navigateur de la personne qui visite ne contacte jamais Twitch ; le site télécharge la photo publique du compte
// (une fois, serveur à serveur), la garde dans son stockage et la sert lui-même. Aucun réseau réel : Contacts et le téléchargement sont des doubles en mémoire.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { fakeContactBook } from "./helpers/fakeContactBook.mjs";

const rd = (m, l) => JSON.parse(fs.readFileSync(new URL(`../modules/${m}/locales/${l}.json`, import.meta.url), "utf8"));
const planning = await import("../modules/planning/index.mjs");
const P = await import("../modules/planning/partners.mjs");
const Ph = await import("../modules/planning/photos.mjs");
const Av = await import("../modules/planning/avatar.mjs");
const story = await import("../modules/stream-story/images.mjs");
const def = planning.default;
const frP = rd("planning", "fr");

const TWITCH = "https://static-cdn.jtvnw.net/jtv_user_pictures/aaaa-bbbb-profile_image-300x300.png";
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
const hours = (n) => new Date(Date.now() + n * 3_600_000);
const slot = (id, h, extra = {}) => ({ id, title: `Soirée ${id}`, start: hours(h).toISOString(), end: hours(h + 2).toISOString(), allDay: false, status: "confirmed", timezone: "UTC", games: [], ...extra });
const text = (x) => JSON.stringify(x);

let book, fetched, answer;
beforeEach(() => {
  P.resetPartners(); Ph.resetPhotos(); book = fakeContactBook(); fetched = [];
  answer = () => new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
  Ph.hooks.fetch = async (url, init) => { fetched.push({ url, init }); return answer(url); };
});
const seed = (name, handle, extra = {}) => book.seedContact({ name, accounts: [{ network: "twitch", handle, avatar: TWITCH }], ...extra });
// `ctx.st` : les réglages vivants du faux contexte (on peut les changer entre deux appels sans perdre le stockage).
const ctxOf = (items, { settings = {}, ...over } = {}) => { const st = { days: 7, timezone: "UTC", ...settings }; const ctx = fakeCtx({ key: "pl", settings: st, topics: { "planning.slot": () => items }, messages: frP, locale: "fr", services: book.services, ...over }); ctx.st = st; return ctx; };
const plant = (ctx, login) => ctx.api.store.add(Ph.COLLECTION, { id: Ph.idOf(login), login, type: "image/png", b64: PNG.toString("base64"), at: Date.now(), src: TWITCH }, { key: Ph.idOf(login) });
const docs = (ctx) => ctx.api.store.list(Ph.COLLECTION, { limit: 100 });
const peopleOf = async (ctx, partners) => { const s = planning.toSlots([slot("a", 3, { partners })], "UTC"); await P.attachPartners(ctx, s); return s[0].people; };

test("les hôtes d'avatars permis sont EXACTEMENT ceux de Story (même liste, mêmes formes de chemin), et rien d'autre", () => {
  for (const [host, re] of Object.entries(Ph.HOSTS)) { assert.ok(story.HOSTS[host], host); assert.equal(re.source, story.HOSTS[host].source.replace("|ttv-boxart", ""), host); }   // Story accepte en plus les jaquettes de Twitch (ttv-boxart) : pas le Planning
  assert.deepEqual(Object.keys(story.HOSTS).filter((h) => !Ph.HOSTS[h]).sort(), ["media.rawg.io"], "Story ajoute RAWG (jaquettes), pas le Planning");
  for (const bad of ["http://static-cdn.jtvnw.net/jtv_user_pictures/a.png", "https://evil.example/jtv_user_pictures/a.png", "https://static-cdn.jtvnw.net/jtv_user_pictures/a.png?x=1", "https://static-cdn.jtvnw.net:444/jtv_user_pictures/a.png",
    "https://u:p@static-cdn.jtvnw.net/jtv_user_pictures/a.png", "https://static-cdn.jtvnw.net/jtv_user_pictures/../a.png", "https://static-cdn.jtvnw.net/ttv-boxart/a.png", "https://static-cdn.jtvnw.net/jtv_user_pictures/a.svg", "javascript:alert(1)", 12, null]) assert.equal(Ph.allowedUrl(bad), null, String(bad));
  assert.ok(Ph.allowedUrl(TWITCH));
});

test("origine de la photo : copie pour un avatar de réseau permis, telle quelle pour une image du site, initiales pour tout le reste", () => {
  assert.deepEqual(Ph.photoSource({ url: TWITCH, source: "twitch" }), { kind: "remote", url: TWITCH });
  assert.deepEqual(Ph.photoSource({ url: "/uploads/ab-12.png", source: "manual" }), { kind: "own", path: "/uploads/ab-12.png" });
  for (const bad of [{ url: "https://evil.example/p.png", source: "manual" }, { url: "/uploads/../x.png", source: "manual" }, { url: "/other/x.png", source: "manual" }, { url: "/uploads/x.png", source: "twitch" }, { url: "https://instagram.example/p.jpg?sig=1", source: "instagram" }, null, {}]) assert.equal(Ph.photoSource(bad), null, text(bad));
});

test("le repère est une empreinte de 16 caractères : jamais le pseudo, jamais une adresse", () => {
  const id = Ph.idOf("etoile_nord");
  assert.match(id, /^[0-9a-f]{16}$/); assert.ok(!id.includes("etoile")); assert.equal(Ph.idOf("etoile_nord"), id); assert.notEqual(Ph.idOf("lune_douce"), id);
});

test("première visite : initiales et copie lancée (serveur à serveur, sans redirection) ; visite suivante : la photo, servie par le site", async () => {
  seed("Étoile du Nord", "etoile_nord");
  const ctx = ctxOf([]);
  const first = await peopleOf(ctx, ["etoile_nord"]);
  assert.equal(first[0].photo, undefined, "pas de photo avant la copie : jamais d'attente, jamais d'erreur");
  await Ph.settled();
  assert.deepEqual(fetched.map((f) => f.url), [TWITCH]);
  assert.equal(fetched[0].init.redirect, "manual"); assert.equal(fetched[0].init.method, undefined);
  const [doc] = await docs(ctx);
  assert.equal(doc.data.type, "image/png"); assert.equal(doc.key, Ph.idOf("etoile_nord"));
  P.resetPartners();
  const second = await peopleOf(ctx, ["etoile_nord"]);
  assert.equal(second[0].photo, `/m/pl/photo/${Ph.idOf("etoile_nord")}`);
  assert.ok(!text(second).includes("jtvnw"), "l'adresse de Twitch ne sort jamais de partners.mjs");
  assert.equal(fetched.length, 1, "une seule copie");
});

test("la page, l'accueil : un rond avec la photo DU SITE, texte alternatif vide, cible d'au moins 44 px, aucune adresse de Twitch ; sans photo, les initiales", async () => {
  seed("Étoile du Nord", "etoile_nord"); seed("Lune Douce", "lune_douce", { photo: "https://evil.example/p.png" });
  const items = [slot("a", 3, { partners: ["etoile_nord", "lune_douce"] })];
  const ctx = ctxOf(items);
  await def.page(ctx); await Ph.settled(); P.resetPartners();
  for (const appearance of ["original", "classic", "week", "timeline", "posters", "hero", "alternating"]) {
    ctx.st.appearance = appearance;
    const out = text(await def.page(ctx)).replace(/\\"/g, '"');
    assert.ok(out.includes(`<img src="/m/pl/photo/${Ph.idOf("etoile_nord")}" alt=""`), appearance);
    assert.ok(!/jtvnw|evil\.example/.test(out), appearance);
    assert.ok(/min-height:44px/.test(out), appearance);
    assert.ok(/aria-hidden="true"[^>]*>EN</.test(out) || />ÉN</.test(out) || />É[^<]*</.test(out), `initiales : ${appearance}`);
    assert.ok(/>LD</.test(out), `Lune Douce, sans photo permise : initiales (${appearance})`);
    assert.ok(!/<img[^>]+Lune|<img[^>]+lune_douce/.test(out));
  }
  const home = text(await def.sections.next(ctx)).replace(/\\"/g, '"');
  assert.ok(home.includes(`/m/pl/photo/${Ph.idOf("etoile_nord")}`) && !/jtvnw/.test(home), "morceau d'accueil");
  const list = text(await def.sections.upcoming(ctx, { count: 5 })).replace(/\\"/g, '"');
  assert.ok(list.includes(`/m/pl/photo/${Ph.idOf("etoile_nord")}`) && !/jtvnw/.test(list), "liste d'accueil");
});

test("overlay, aperçu et image de la semaine : le nom seul, jamais de photo", async () => {
  seed("Étoile du Nord", "etoile_nord");
  const items = [slot("a", 3, { partners: ["etoile_nord"] })];
  const base = ctxOf(items);
  await def.page(base); await Ph.settled(); P.resetPartners();
  assert.equal((await docs(base)).length, 1);
  const el = await (await def.routes["element/:slug"](new Request("https://site.test/m/pl/element/week?ov-w=1000&ov-h=600"), { ...base, params: { slug: "week" } })).text();
  assert.ok(/Étoile du Nord/.test(el) && !/\/photo\//.test(el));
  const img = base;
  await def.routes.image(new Request("https://site.test/m/pl/image"), img).catch(() => null);
  assert.ok(!/photo/.test(text(img.calls.png)) && text(img.calls.png).includes("Étoile du Nord"));
});

test("la route de la photo : l'image, rien d'autre ; pas de cookie, pas d'écho, type vérifié, cache de 5 minutes", async () => {
  seed("Étoile du Nord", "etoile_nord");
  const ctx0 = ctxOf([]); await peopleOf(ctx0, ["etoile_nord"]); await Ph.settled(); P.resetPartners();
  const id = Ph.idOf("etoile_nord");
  const get = (over = {}, m = "GET") => def.routes["photo/:slug"](new Request(`https://site.test/m/pl/photo/${id}`, { method: m }), { ...ctx0, params: { slug: id }, ...over });
  const res = await get();
  assert.equal(res.status, 200); assert.equal(res.headers.get("content-type"), "image/png"); assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("set-cookie"), null); assert.match(res.headers.get("cache-control"), /max-age=300/); assert.match(res.headers.get("content-security-policy"), /default-src 'none'/);
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG);
  assert.equal((await get({}, "POST")).status, 405);
  for (const bad of ["x", "../etc/passwd", "0123456789abcdeg", "0123456789abcdef", "ETOILE_NORD"]) assert.equal((await get({ params: { slug: bad } })).status, 404, bad);
});

test("la photo disparaît dès que la fiche n'est plus affichable : « Ne pas montrer », fiche à relire, fiche effacée — la route répond 404 et la copie est effacée", async () => {
  const hide = book.seedCategory("Ne pas montrer");
  const ok = seed("Visible", "visible_tv");
  seed("Étoile du Nord", "etoile_nord", { categoryIds: [hide] }); seed("Lune Douce", "lune_douce", { status: "to_review" });
  const gone = seed("Noé", "noe_stream"); await book.methods.erase({ id: gone.id, confirm: true });
  const ctx = ctxOf([]);
  for (const l of ["visible_tv", "etoile_nord", "lune_douce", "noe_stream"]) await plant(ctx, l);   // des copies faites AVANT que la fiche soit masquée, relue ou effacée
  const route = (login) => def.routes["photo/:slug"](new Request("https://site.test/x"), { ...ctx, params: { slug: Ph.idOf(login) } });
  P.resetPartners(); assert.equal((await route("visible_tv")).status, 200, "la fiche affichable est servie");
  for (const l of ["etoile_nord", "lune_douce", "noe_stream"]) assert.equal((await route(l)).status, 404, l);
  assert.deepEqual((await docs(ctx)).map((d) => d.data.login), ["visible_tv"], "les trois autres copies sont effacées par la route");
  void ok;
  await plant(ctx, "etoile_nord"); await plant(ctx, "noe_stream"); P.resetPartners();
  await peopleOf(ctx, ["etoile_nord", "noe_stream", "visible_tv"]);   // la page aussi efface les copies d'une fiche qui n'est plus affichable
  assert.deepEqual((await docs(ctx)).map((d) => d.data.login), ["visible_tv"]);
});

test("une fiche non affichable ne déclenche JAMAIS de téléchargement ; un pseudo inconnu non plus", async () => {
  const hide = book.seedCategory("Ne pas montrer");
  seed("Cachée", "cachee_tv", { categoryIds: [hide] }); seed("À relire", "arelire_tv", { status: "to_review" });
  const ctx = ctxOf([]);
  assert.deepEqual(await peopleOf(ctx, ["cachee_tv", "arelire_tv", "inconnu_ici"]), []);
  await Ph.settled(); assert.deepEqual(fetched, []); assert.equal((await docs(ctx)).length, 0);
});

test("le téléchargement qui échoue (erreur, trop gros, pas une image, redirection, SVG) : initiales, aucune copie, aucune erreur visible, pas d'insistance avant 6 heures", async () => {
  seed("Étoile du Nord", "etoile_nord");
  const cases = { "404": () => new Response("x", { status: 404 }), "302": () => new Response(null, { status: 302, headers: { location: "https://evil.example/a.png" } }),
    big: () => new Response(Buffer.alloc(Ph.LIMITS.bytes + 10, 1), { status: 200, headers: { "content-type": "image/png" } }),
    html: () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }),
    svg: () => new Response("<svg xmlns='http://www.w3.org/2000/svg'/>", { status: 200, headers: { "content-type": "image/svg+xml" } }),
    fake: () => new Response(Buffer.alloc(64, 9), { status: 200, headers: { "content-type": "image/png" } }),
    boom: () => { throw new Error("réseau"); } };
  for (const [name, make] of Object.entries(cases)) {
    P.resetPartners(); Ph.resetPhotos(); fetched.length = 0; answer = make;
    const ctx = ctxOf([]);
    const people = await peopleOf(ctx, ["etoile_nord"]); await Ph.settled();
    assert.equal(people.length, 1, name); assert.equal(people[0].photo, undefined, name); assert.equal((await docs(ctx)).length, 0, name);
    P.resetPartners(); await peopleOf(ctx, ["etoile_nord"]); await Ph.settled();
    assert.equal(fetched.length, 1, `${name} : pas de nouvel essai avant 6 heures`);
  }
});

test("réglage « Afficher la photo des partenaires » coupé : aucun rond, aucun téléchargement, copies effacées, route fermée", async () => {
  seed("Étoile du Nord", "etoile_nord");
  const items = [slot("a", 3, { partners: ["etoile_nord"] })];
  const ctx = ctxOf(items); await def.page(ctx); await Ph.settled();
  assert.equal((await docs(ctx)).length, 1);
  ctx.st.showPartnerPhotos = false; P.resetPartners(); Ph.resetPhotos(); fetched.length = 0;
  const route = () => def.routes["photo/:slug"](new Request("https://site.test/x"), { ...ctx, params: { slug: Ph.idOf("etoile_nord") } });
  assert.equal((await route()).status, 404, "route fermée tout de suite");
  for (const appearance of ["original", "classic", "timeline"]) {
    ctx.st.appearance = appearance;
    const out = text(await def.page(ctx)).replace(/\\"/g, '"');
    assert.ok(/Étoile du Nord/.test(out) && !/photo\/|aria-hidden="true" style|<img/.test(out), appearance);
  }
  await Ph.settled(); assert.deepEqual(fetched, []); assert.equal((await docs(ctx)).length, 0, "copies effacées");
});

test("Contacts retiré : toutes les copies sont effacées et rien n'est montré", async () => {
  seed("Étoile du Nord", "etoile_nord");
  const items = [slot("a", 3, { partners: ["etoile_nord"] })];
  const ctx = ctxOf(items); await def.page(ctx); await Ph.settled(); assert.equal((await docs(ctx)).length, 1);
  P.resetPartners();
  const noBook = fakeCtx({ key: "pl", settings: { days: 7, timezone: "UTC" }, topics: { "planning.slot": () => items }, messages: frP, locale: "fr" });
  await noBook.api.store.add(Ph.COLLECTION, (await docs(ctx))[0].data, { key: Ph.idOf("etoile_nord") });
  const out = text(await def.page(noBook));
  assert.ok(!/Étoile du Nord|photo\//.test(out)); assert.equal((await docs(noBook)).length, 0);
});

test("photo envoyée à la main dans Contacts (/uploads/…) : montrée telle quelle, aucune copie, aucun téléchargement", async () => {
  book.seedContact({ name: "Étoile du Nord", accounts: [{ network: "twitch", handle: "etoile_nord" }], photo: "/uploads/etoile-1.png" });
  const ctx = ctxOf([]);
  const people = await peopleOf(ctx, ["etoile_nord"]); await Ph.settled();
  assert.equal(people[0].photo, "/uploads/etoile-1.png"); assert.deepEqual(fetched, []); assert.equal((await docs(ctx)).length, 0);
});

test("bornes : 30 copies au plus (la plus ancienne fait place), 256 Ko, deux téléchargements à la fois, oubli après 30 jours, une copie par pseudo", async () => {
  const ctx = ctxOf([]);
  for (let i = 0; i < 33; i++) { await Ph.photoFor(ctx, `partner_${String(i).padStart(2, "0")}`, { kind: "remote", url: TWITCH }); await Ph.settled(); Ph.resetPhotos(); }
  const all = await docs(ctx);
  assert.equal(all.length, 30); assert.ok(!all.some((d) => d.data.login === "partner_00"), "la plus ancienne est partie");
  Ph.resetPhotos(); fetched.length = 0;
  const gate = []; answer = () => new Promise((r) => gate.push(r));
  const ctx2 = ctxOf([]);
  for (const l of ["aaaa_1", "bbbb_2", "cccc_3", "aaaa_1"]) await Ph.photoFor(ctx2, l, { kind: "remote", url: TWITCH });
  assert.equal(fetched.length, 2, "deux à la fois au plus, jamais deux fois le même pseudo");
  gate.forEach((r) => r(new Response(PNG, { status: 200, headers: { "content-type": "image/png" } }))); await Ph.settled();
  await Ph.sweep(ctx, Date.now() + 31 * 86_400_000);
  assert.equal((await docs(ctx)).length, 0, "plus de 30 jours : oubliées");
  assert.equal((await docs(ctx2)).length, 2);
  assert.equal(Ph.LIMITS.bytes, 256 * 1024);
});

test("rafraîchie au plus une fois par semaine ; une photo changée est recopiée en gardant l'ancienne en attendant", async () => {
  const ctx = ctxOf([]);
  const src = { kind: "remote", url: TWITCH };
  await Ph.photoFor(ctx, "etoile_nord", src); await Ph.settled(); assert.equal(fetched.length, 1);
  Ph.resetPhotos();
  assert.ok(await Ph.photoFor(ctx, "etoile_nord", src, Date.now() + 6 * 86_400_000)); await Ph.settled(); assert.equal(fetched.length, 1, "6 jours : rien");
  Ph.resetPhotos();
  assert.ok(await Ph.photoFor(ctx, "etoile_nord", src, Date.now() + 8 * 86_400_000), "l'ancienne copie sert en attendant"); await Ph.settled(); assert.equal(fetched.length, 2, "8 jours : recopiée");
  assert.equal((await docs(ctx)).length, 1);
  Ph.resetPhotos();
  const other = { kind: "remote", url: "https://static-cdn.jtvnw.net/jtv_user_pictures/new-profile_image-300x300.png" };
  assert.ok(await Ph.photoFor(ctx, "etoile_nord", other)); await Ph.settled(); assert.equal(fetched.at(-1).url, other.url);
  assert.equal((await docs(ctx)).length, 1, "toujours une seule copie par pseudo");
});

test("le rond : initiales, adresse du site seulement, texte caché des lecteurs d'écran", () => {
  assert.equal(Av.initialsOf("Étoile du Nord"), "ÉN"); assert.equal(Av.initialsOf("camille"), "C"); assert.equal(Av.initialsOf(""), "?"); assert.equal(Av.initialsOf("  😀 Zoé  "), "Z");
  assert.equal(Av.safePhoto("https://static-cdn.jtvnw.net/jtv_user_pictures/a.png"), null); assert.equal(Av.safePhoto("//evil.example/a.png"), null); assert.equal(Av.safePhoto('/uploads/a".png'), null);
  assert.equal(Av.safePhoto("/m/pl/photo/0123456789abcdef"), "/m/pl/photo/0123456789abcdef");
  const html = Av.personHtml({ name: "<b>X</b>", url: "https://www.twitch.tv/abcd", photo: "/m/pl/photo/0123456789abcdef" });
  assert.ok(html.includes('aria-hidden="true"') && html.includes('alt=""') && html.includes("min-height:44px") && html.includes("&lt;b&gt;") && !html.includes("<b>"));
  assert.ok(!/<img/.test(Av.avatarHtml({ name: "Zoé", photo: "https://evil.example/a.png" })));
});

test("manifeste : réglage avancé, activé par défaut, replié ; rien d'obligatoire ; permission storage ; textes FR/EN à parité", () => {
  const m = JSON.parse(fs.readFileSync(new URL("../modules/planning/module.json", import.meta.url), "utf8"));
  const s = m.settings.find((x) => x.key === "showPartnerPhotos");
  assert.deepEqual([s.type, s.default, s.advanced, s.tab], ["boolean", true, true, "look"]);
  assert.ok(m.permissions.includes("storage"));
  assert.ok(s.help.fr.length <= 60 && s.help.en.length <= 60 && s.label.fr.length <= 60);
  assert.match(m.privacy.fr, /copie de la photo publique du compte Twitch/); assert.match(m.privacy.en, /keeps a copy of the public photo/);
  assert.deepEqual(Object.keys(frP).sort(), Object.keys(rd("planning", "en")).sort());
});

// NON-RÉGRESSION (Planning 2.7.2). En 2.7.0/2.7.1 la route s'appelait « photo/:slug » et lisait `ctx.params.id` : le cœur ne connaît qu'UN segment libre, toujours nommé `slug`
// (cœur 0.2.14, `matchModuleRoute` de src/core/modules/pageMeta.ts) ; l'adresse /m/<clé>/photo/<repère> répondait donc « Not found » sur le vrai site, le <img> se retirait seul (onerror)
// et la page ne montrait que les initiales. Les essais appelaient la route à la main avec `params: { id }`, une forme que le cœur ne produit jamais. Ici, la route est trouvée EXACTEMENT
// comme le fait le cœur (recopie de matchModuleRoute), à partir de l'adresse écrite dans la page.
const SLUG_RE = /^[A-Za-z0-9_-]{1,80}$/;
function coreMatch(routes, segments) {   // recopie fidèle de matchModuleRoute (cœur) : la route de ce nom exact, sinon « …/:slug » avec `params: { slug }` et rien d'autre
  const last = segments[segments.length - 1];
  if (last === ":slug") return null;
  if (routes[segments.join("/")]) return { handler: routes[segments.join("/")], params: {} };
  if (last === undefined || !SLUG_RE.test(last)) return null;
  const key = [...segments.slice(0, -1), ":slug"].join("/");
  return Object.prototype.hasOwnProperty.call(routes, key) ? { handler: routes[key], params: { slug: last } } : null;
}

test("l'adresse de photo écrite dans la page est SERVIE par la route telle que le cœur la trouve (forme réelle : params.slug)", async () => {
  seed("Lune Douce", "lune_douce");
  const ctx = ctxOf([slot("a", 30, { partners: ["lune_douce"] })]);
  await peopleOf(ctx, ["lune_douce"]); await Ph.settled(); P.resetPartners();
  const people = await peopleOf(ctx, ["lune_douce"]);
  const href = people[0].photo;
  assert.match(href, /^\/m\/pl\/photo\/[0-9a-f]{16}$/, "la page écrit bien une adresse du site");
  const [, m, ...path] = href.split("/").slice(1);   // ["m","pl","photo","<repère>"] -> clé, puis segments de la route
  assert.equal(m, "pl");
  const hit = coreMatch(def.routes, path);
  assert.ok(hit, "le cœur trouve une route pour cette adresse (sinon : « Not found » et initiales seules)");
  assert.deepEqual(Object.keys(hit.params), ["slug"], "le cœur ne donne que `slug`");
  const res = await hit.handler(new Request(`https://site.test${href}`), { ...ctx, params: Object.freeze({ ...hit.params }) });
  assert.equal(res.status, 200); assert.equal(res.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG);
  assert.equal(coreMatch(def.routes, ["photo", "0123456789abcdef/x"]), null, "un seul segment libre");
});

test("aucune route du Planning ne lit un paramètre autre que `slug` (le cœur n'en donne pas d'autre)", () => {
  for (const key of Object.keys(def.routes)) assert.ok(!key.includes(":") || key.endsWith("/:slug") || key === ":slug", `route « ${key} » : seul « :slug » existe`);
  const src = fs.readFileSync(new URL("../modules/planning/index.mjs", import.meta.url), "utf8");
  assert.ok(!/ctx\.params\??\.id\b/.test(src), "`ctx.params.id` n'existe pas");
});
