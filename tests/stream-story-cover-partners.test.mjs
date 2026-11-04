// Story d'annonce 2.6.0 : (1) la jaquette gardée par le site (copie du module « Jaquettes de jeux », adresse du site) est enfin dessinée dans la story, comme sur la page du Planning ;
// (2) les personnes que le planning indique pour un stream (« Avec … ») sont dans la vidéo, avec la même règle de vie privée que le Planning. Aucun réseau : tout est factice, noms inventés.
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { fakeContactBook } from "./helpers/fakeContactBook.mjs";
import { fakeCanvasContext, fakeImage } from "./helpers/fakeCanvas.mjs";

const DIR = new URL("../modules/stream-story", import.meta.url).pathname;
const manifest = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8")), fr = JSON.parse(fs.readFileSync(`${DIR}/locales/fr.json`, "utf8")), en = JSON.parse(fs.readFileSync(`${DIR}/locales/en.json`, "utf8"));
const def = (await import("../modules/stream-story/index.mjs")).default;
const P = await import("../modules/stream-story/pure.mjs");
const E = await import("../modules/stream-story/events.mjs");
const S = await import("../modules/stream-story/scenes.mjs");
const data = await import("../modules/stream-story/data.mjs");
const src = await import("../modules/stream-story/sources.mjs");
const images = await import("../modules/stream-story/images.mjs");
const book = await import("../modules/stream-story/contacts.mjs");

const SITE = "https://site.example.test";
const LOCAL = `${SITE}/m/game-covers/cover/0123456789abcdef`;
const RAWG = "https://media.rawg.io/media/games/aaa/aaa111.jpg";
const TW = "https://static-cdn.jtvnw.net/jtv_user_pictures/lune-profile_image-300x300.png";
const GAME = "Etoile: Inconnue";   // un titre avec deux-points, comme un jeu peu connu
const NOW = Date.parse("2026-11-04T10:00:00Z");

const covers = (cover) => ({ "game.cover": { status: async () => ({ configured: true }), cover: async () => cover } });
const mk = (services = {}, extra = {}) => fakeCtx({
  key: "story", moduleId: "stream-story", locale: "fr", messages: { ...fr }, permissions: manifest.permissions, siteUrl: SITE,
  topics: { "planning.slot": () => [] }, instances: [{ id: "id-story", key: "story", module: "stream-story", basePath: "", name: "Story", adminPath: "/admin/instances/id-story" }], services, ...extra,
});
const timing0 = { ...src.timing };
beforeEach(() => { Object.assign(src.timing, timing0, { bookMs: 150, providersMs: 150, coverMs: 400 }); images.resetImages(); });
afterEach(() => { Object.assign(src.timing, timing0); });

/* ───────────── Jaquette ───────────── */

test("jaquette : la copie gardée par le site (adresse absolue du site) est rendue en chemin du site, à dessiner sans relais ; c'était le trou de la story", async () => {
  assert.equal(images.allowedUrl(LOCAL), null, "le relais ne sert que des hôtes externes : c'est pour cela que l'adresse locale était écartée");
  const r = await src.coverOf(mk(covers({ status: "found", url: LOCAL, name: GAME })), GAME);
  assert.deepEqual([r.cover, r.coverState, r.title], ["/m/game-covers/cover/0123456789abcdef", "", GAME]);
  const ambiguous = await src.coverOf(mk(covers({ status: "found", url: LOCAL, name: "Etoile", ambiguous: true })), GAME);
  assert.deepEqual([ambiguous.cover, ambiguous.ambiguous, ambiguous.found], ["/m/game-covers/cover/0123456789abcdef", true, "Etoile"]);
});

test("jaquette : une adresse externe permise (repli) est toujours relayée ; tout le reste est refusé avec un état « down » (jamais un trou silencieux)", async () => {
  assert.equal((await src.coverOf(mk(covers({ status: "found", url: RAWG })), "Hades")).cover, RAWG);
  for (const bad of ["https://evil.example/m/game-covers/cover/0123456789abcdef", `${SITE}/m/game-covers/cover/0123456789abcdef?x=1`, `${SITE}/m/game-covers/cover/../../admin`, `${SITE}/m/a/b/cover/0123456789abcdef`, `http://site.example.test/m/game-covers/cover/0123456789abcdef`, "//evil.example/m/game-covers/cover/0123456789abcdef", "https://evil.example/x.png"]) {
    const r = await src.coverOf(mk(covers({ status: "found", url: bad })), GAME);
    assert.deepEqual([r.cover, r.coverState], ["", "down"], bad);
  }
  assert.deepEqual([images.ownImage("/m/game-covers/cover/0123456789abcdef"), images.ownImage("/uploads/photo-1.png"), images.ownImage("/admin"), images.ownImage("//evil.example/x")], ["/m/game-covers/cover/0123456789abcdef", "/uploads/photo-1.png", "", ""]);
  const none = await src.coverOf(mk(covers({ status: "none", url: null })), GAME);
  assert.deepEqual([none.cover, none.coverState], ["", ""], "pas de jaquette connue : pas d'avertissement");
});

test("jaquette : le prochain stream du planning (partenaire, jeu au titre à deux-points) reçoit sa jaquette locale", async () => {
  const slot = { id: "s1", title: "Soirée découverte", start: "2026-11-05T18:00:00Z", end: "2026-11-05T21:00:00Z", games: [GAME], partners: ["lune_douce"] };
  const ctx = mk(covers({ status: "found", url: LOCAL }), { topics: { "planning.slot": () => [slot] } });
  const r = await src.loadStreams(ctx, { now: NOW, zone: "Europe/Paris" });
  assert.deepEqual([r.state, r.streams[0].cover, r.streams[0].partners], ["ok", "/m/game-covers/cover/0123456789abcdef", ["lune_douce"]]);
  const ev = await src.loadEvents(ctx, { now: NOW, zone: "Europe/Paris" });
  assert.deepEqual(E.publicEvent(ev.events[0]).partners, ["lune_douce"]);
});

/* ───────────── Les personnes du planning ───────────── */

test("événements : les pseudos du planning sont nettoyés (5 au plus, sans doublon), réunis quand deux agendas annoncent le même stream, absents d'une journée entière", () => {
  const base = { title: "Soirée", start: "2026-11-05T18:00:00Z", games: [GAME] };
  const items = [
    { ...base, id: "a", partners: ["@Lune_Douce", "twitch.tv/etoile_nord", "lune_douce", "x", 12, "https://www.twitch.tv/camille_tv/", "ami_un", "ami_deux"] },
    { ...base, id: "b", partners: ["ami_trois"] },
    { id: "c", title: "Congé", allDay: true, day: "2026-11-06", start: "2026-11-06T00:00:00Z", partners: ["lune_douce"] },
  ];
  const s = P.upcomingStreams(items, NOW, "Europe/Paris");
  assert.deepEqual(s[0].partners, ["lune_douce", "etoile_nord", "camille_tv", "ami_un", "ami_deux"], "5 au plus, ordre de l'agenda");
  assert.deepEqual(s[1].partners, []);
  const e = E.calendarEvents(items.slice(0, 1), NOW, "Europe/Paris", { kind: "calendar", label: "Planning" });
  assert.deepEqual(e[0].partners, ["lune_douce", "etoile_nord", "camille_tv", "ami_un", "ami_deux"]);
  assert.deepEqual(E.cleanEvent({ id: "yt:1", title: "Direct", start: "2026-11-05T18:00:00Z" }, { kind: "youtube", label: "YT" }).partners, []);
});

const seed = () => {
  const cb = fakeContactBook();
  const hide = cb.seedCategory("Ne pas montrer");
  const lune = cb.seedContact({ name: "Lune Douce", accounts: [{ network: "twitch", handle: "lune_douce", avatar: TW }] });
  const etoile = cb.seedContact({ name: "Etoile Nord", accounts: [{ network: "twitch", handle: "etoile_nord" }] });
  const cachee = cb.seedContact({ name: "Fiche Cachee", accounts: [{ network: "twitch", handle: "fiche_cachee" }], categoryIds: [hide] });
  const relire = cb.seedContact({ name: "A Relire", status: "to_review", accounts: [{ network: "twitch", handle: "a_relire" }] });
  return { cb, lune, etoile, cachee, relire };
};

test("personnes du planning : seules les fiches actives, non cachées et connues sont montrées (même règle que le « Avec … » du Planning), dans l'ordre de l'agenda, avec nom et photo", async () => {
  const { cb } = seed();
  const ctx = mk(cb.services);
  const r = await book.schedulePeople(ctx, ["etoile_nord", "fiche_cachee", "a_relire", "inconnu_total", "lune_douce"]);
  assert.deepEqual(r.items.map((x) => x.login), ["etoile_nord", "lune_douce"]);
  assert.deepEqual(r.items[1], { login: "lune_douce", name: "Lune Douce", image: TW });
  assert.equal(r.items[0].image, "", "pas de photo : les initiales");
  assert.equal(r.state, "ok");
  assert.ok(!JSON.stringify(r).includes("@"), "aucun e-mail");
});

test("personnes du planning : Contacts absent ou muet → personne (jamais un nom montré dans le doute), et la route rend un état clair sans lever", async () => {
  const absent = await book.schedulePeople(mk({}), ["lune_douce"]);
  assert.deepEqual([absent.state, absent.items], ["absent", []]);
  const { cb } = seed(); cb.faults.hang.add("categories");
  const keepAlive = setInterval(() => {}, 50);   // Contacts muet : les minuteurs de Story ne retiennent pas le processus, ce test oui
  const mute = await book.schedulePeople(mk(cb.services), ["lune_douce"]).finally(() => clearInterval(keepAlive));
  assert.deepEqual([mute.state, mute.items], ["slow", []], "catégorie « Ne pas montrer » non vérifiée : rien n'est montré");
  const { cb: cb2 } = seed(); cb2.faults.throw.add("search");
  const down = await book.schedulePeople(mk(cb2.services), ["lune_douce"]);
  assert.deepEqual(down.items, []);
  assert.deepEqual(await book.schedulePeople(mk(cb2.services), []), { state: "ok", items: [] }, "aucun pseudo : aucun appel");
});

test("route partners : protégée par le jeton, pseudos filtrés, rend nom + photo seulement", async () => {
  const { cb } = seed();
  const ctx = mk(cb.services), token = await data.mintToken(ctx);
  const ask = (headers, search) => def.routes.partners(new Request(`${SITE}/m/story/partners${search}`, { headers }), ctx);
  assert.notEqual((await ask({}, "?logins=lune_douce")).status, 200, "sans jeton");
  const res = await ask({ "x-story-token": token }, `?logins=${encodeURIComponent("lune_douce,<script>,etoile_nord")}`);
  const body = await res.json();
  assert.deepEqual([body.ok, body.items.map((x) => x.login)], [true, ["lune_douce", "etoile_nord"]]);
  assert.deepEqual(Object.keys(body.items[0]).sort(), ["image", "login", "name"]);
});

/* ───────────── Ce que dit la vidéo ───────────── */

const person = (i) => ({ login: `ami_${i}`, name: ["Lune Douce", "Etoile Nord", "Camille", "Capitaine Prénom-Très-Long-Vraiment", "Zoé", "Yan", "Max", "Ida"][i] });
const content = (n, config = {}) => P.buildContent({ ...P.DEFAULT_CONFIG, ...config }, { stream: { title: "Soirée", startMs: Date.parse("2026-11-05T18:00:00Z"), allDay: false, games: [GAME], timezone: "Europe/Paris" }, coStreamers: Array.from({ length: n }, (_, i) => person(i)), nowMs: NOW, tz: "Europe/Paris" });

test("vidéo : 0, 1, 2, 3, 6 personnes montrées telles quelles ; au-delà de 6, cinq puis une pastille « +N » (jamais une personne cachée sans le dire)", () => {
  assert.deepEqual([0, 1, 2, 3, 6].map((n) => content(n).costreamers.length), [0, 1, 2, 3, 6]);
  const eight = content(8).costreamers;
  assert.equal(eight.length, 6);
  assert.deepEqual(eight[5], { login: "+more", name: "+3", more: true });
  assert.deepEqual(eight.slice(0, 5).map((x) => x.login), ["ami_0", "ami_1", "ami_2", "ami_3", "ami_4"]);
  assert.equal(content(3, { elements: ["title"] }).costreamers.length, 0, "élément décoché : personne");
});

test("réglage « personnes du planning » : oui par défaut, y compris pour un modèle enregistré avant ; seul un false explicite le retire", () => {
  assert.equal(P.DEFAULT_CONFIG.schedulePeople, true);
  assert.equal(P.cleanConfig({ style: "poster" }).schedulePeople, true, "modèle d'avant la 2.6.0");
  assert.equal(P.cleanConfig({ schedulePeople: false }).schedulePeople, false);
  assert.equal(P.cleanConfig({ schedulePeople: "non" }).schedulePeople, true, "jamais une chaîne");
  assert.equal(P.cleanConfig({}, { ...P.DEFAULT_CONFIG, schedulePeople: false }).schedulePeople, false);
});

const THEME = { accent: "#7c5cff", accent2: "#ff4d8d", bg: "#101018", fg: "#f2f2f2" };
test("quatre styles × deux formats × 0, 1, 3, 8 personnes, avec ou sans jaquette : la scène se dessine, les noms longs sont coupés, « +N » est dessiné, le jeu reste écrit sans jaquette", () => {
  for (const style of P.STYLES) for (const format of ["vertical", "passeport"]) for (const n of [0, 1, 3, 8]) for (const cover of [true, false]) {
    const c = content(n, { style, format });
    const sc = S.createScene({ style, format, duration: 15, content: c, assets: { logo: null, cover: cover ? fakeImage(600, 338) : null, avatars: { ami_0: fakeImage(300, 300) } }, colors: THEME, measureContext: fakeCanvasContext() });
    const ctx = fakeCanvasContext(); sc.draw(ctx, sc.restTime);
    const texts = ctx.log.filter((e) => e[0] === "fillText").map((e) => e[1]);
    const where = `${style}/${format}/${n}/${cover}`;
    assert.equal(sc.blocks.some((b) => b.id === "costreamers"), n > 0, where);
    if (n === 8) assert.ok(texts.includes("+3"), `${where} : pastille +N`);
    if (n > 0) assert.ok(texts.includes("Lune Douce"), `${where} : le nom`);
    assert.ok(texts.some((t) => t.includes("Etoile")), `${where} : le jeu reste écrit`);
  }
});

/* ───────────── Textes ───────────── */

test("textes : la case « personnes du planning » existe en FR et EN, courte (R10, R11), sans mot technique (R9)", () => {
  for (const [lang, d] of [["fr", fr], ["en", en]]) {
    for (const k of ["ui_schedule_people_label", "ui_schedule_people_help", "ui_cover_down"]) assert.ok(d[k], `${lang} ${k}`);
    assert.ok(d.ui_schedule_people_label.length <= 60 && !/:\s*$/.test(d.ui_schedule_people_label), lang);
    assert.ok(d.ui_schedule_people_help.length <= 60, lang);
    assert.ok(!/\b(api|json|token|jeton|cache|webhook|slug|clé|key)\b/i.test(`${d.ui_schedule_people_label} ${d.ui_schedule_people_help} ${d.ui_cover_down}`), lang);
  }
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
});

test("jaquette versionnée (game-covers 1.3.2) : `?v=<hex>` est gardé sur le chemin du site, tout autre paramètre est refusé ; photo du Planning acceptée", async () => {
  const V = `${SITE}/m/game-covers/cover/fedcba9876543210?v=0a1b2c3d4e5f`;
  const r = await src.coverOf(mk(covers({ status: "found", url: V })), GAME);
  assert.deepEqual([r.cover, r.coverState], ["/m/game-covers/cover/fedcba9876543210?v=0a1b2c3d4e5f", ""]);
  assert.equal((await src.loadStreams(mk(covers({ status: "found", url: V }), { topics: { "planning.slot": () => [{ id: "s", title: "T", start: "2026-11-05T18:00:00Z", games: [GAME] }] } }), { now: NOW })).streams[0].cover, "/m/game-covers/cover/fedcba9876543210?v=0a1b2c3d4e5f");
  assert.equal(images.ownImage("/m/planning/photo/Ab12Cd34Ef56Gh78"), "/m/planning/photo/Ab12Cd34Ef56Gh78");
  assert.equal(images.ownImage("/m/game-covers/cover/fedcba9876543210?v=0a1b2c3d4e5f"), "/m/game-covers/cover/fedcba9876543210?v=0a1b2c3d4e5f");
  for (const bad of ["?v=xyz", "?v=0a1b2c3", "?v=0a1b2c3d4e5f&x=1", "?x=0a1b2c3d4e5f", "?v=0a1b2c3d4e5f?v=0a1b2c3d4e5f"]) {
    assert.equal(images.ownImage(`${SITE}/m/game-covers/cover/fedcba9876543210${bad}`), "", bad);
    assert.equal(images.ownImage(`/m/game-covers/cover/fedcba9876543210${bad}`), "", bad);
  }
  assert.equal(images.ownImage("https://evil.example/m/game-covers/cover/fedcba9876543210?v=0a1b2c3d4e5f", SITE), "");
});

/* ───────────── 2.6.1 : jetons de version réels des jaquettes, et `partners` dans le sujet lu ───────────── */

test("2.6.1 jaquette : tous les jetons `?v=` que « Jaquettes de jeux » produit (empreinte hexadécimale ET date en base 36 comme tmw1bbib6) sont acceptés ; le reste est refusé", async () => {
  const gc = await import("../modules/game-covers/copies.mjs");
  const ctxGc = { instance: { key: "game-covers" }, api: { siteUrl: SITE } };
  const metas = [{ id: "0123456789abcdef", sum: "0a1b2c3d4e5f" }, { id: "0123456789abcdef", at: Date.parse("2026-11-04T14:00:00Z") }, { id: "0123456789abcdef" }, { id: "0123456789abcdef", sum: "XYZ", at: 1 }, { id: "0123456789abcdef", at: Date.now() * 40 }];
  for (const meta of metas) {
    const url = gc.urlOf(ctxGc, meta), want = `/m/game-covers/cover/0123456789abcdef?v=${gc.versionOf(meta)}`;
    assert.equal(images.ownImage(url, SITE), want, url);
    assert.equal(images.ownImage(want), want, "chemin relatif");
    assert.equal(images.drawable(url, SITE), want);
  }
  assert.equal(images.ownImage(`${SITE}/m/game-covers/cover/0123456789abcdef?v=tmw1bbib6`, SITE), "/m/game-covers/cover/0123456789abcdef?v=tmw1bbib6");
  const bad = ["?v=", "?v=T123", "?v=tMW1", "?v=t", "?v=tmw1bbib6zzzzzz", "?v=ABCDEF012345", "?v=0a1b2c3d4e5", "?v=tmw1bbib6&x=1", "?x=tmw1bbib6", "?v=tm-1", "?v=tmw1bbib6#a", "?v=../x", "?v=%74mw1"];
  for (const q of bad) assert.equal(images.ownImage(`${SITE}/m/game-covers/cover/0123456789abcdef${q}`, SITE), "", q);
  for (const q of bad.filter((x) => !x.includes("#"))) assert.equal(images.ownImage(`/m/game-covers/cover/0123456789abcdef${q}`), "", q);
  const r = await src.coverOf(mk(covers({ status: "found", url: `${LOCAL}?v=tmw1bbib6`, name: GAME })), GAME);
  assert.deepEqual([r.cover, r.coverState], ["/m/game-covers/cover/0123456789abcdef?v=tmw1bbib6", ""]);
});

test("2.6.1 co-streamers du planning : le manifeste déclare `partners` dans le sujet `planning.slot`, sinon le cœur le retire avant Story (cause réelle de la 2.6.0) ; avec le vrai filtre du cœur, l'invitée est dans l'événement et ajoutée par défaut", async () => {
  const { conform } = await import("@/core/services/topics");
  const schema = manifest.consumes.find((c) => c.topic === "planning.slot").schema;
  assert.ok(schema.some((f) => f.key === "partners" && f.type === "string[]"), "partners déclaré");
  const raw = { id: "s1@2026-11-05", title: "Soirée avec Lune Douce", start: "2026-11-05T18:00:00Z", end: "2026-11-05T21:00:00Z", games: [GAME], partners: ["lune_douce"], timezone: "Europe/Paris", status: "confirmed" };
  assert.deepEqual(conform(raw, schema.filter((f) => f.key !== "partners")).partners, undefined, "sans la déclaration, le cœur retire `partners`");
  const { cb } = seed();
  const ctx = mk(cb.services, { topics: { "planning.slot": () => [conform(raw, schema)] } });
  const ev = await src.loadEvents(ctx, { now: NOW, zone: "Europe/Paris" });
  const pub = E.publicEvent(ev.events[0]);
  assert.deepEqual(pub.partners, ["lune_douce"]);
  assert.equal(P.cleanConfig({}).schedulePeople, true, "ajoutés par défaut");
  assert.equal(P.cleanConfig({ style: "neon" }, P.DEFAULT_CONFIG).schedulePeople, true, "réglage enregistré avant la 2.6 sans la clé");
  const route = await def.routes.partners(new Request("https://site.example.test/m/story/partners?logins=lune_douce", { headers: {} }), ctx).catch((e) => e);
  assert.ok(route instanceof Response || route instanceof Error);
  const people = await book.schedulePeople(ctx, pub.partners);
  assert.deepEqual(people.items.map((x) => [x.login, x.name]), [["lune_douce", "Lune Douce"]]);
});
