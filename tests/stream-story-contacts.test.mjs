// Story d'annonce 2.0.0 contre le double de « contact.book » v2 (tests/helpers/fakeContactBook.mjs) : les co-streamers sont des RÉFÉRENCES de fiche (jamais des copies), la
// recherche à la saisie, Contacts absent (repli) ou muet (trou noir), une catégorie de Contacts, la photo par le relais d'images, la migration de l'ancienne liste, privacy.subject.
// Aucun réseau : tout est factice.
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { fakeContactBook } from "./helpers/fakeContactBook.mjs";
import { runPrivacySubjectContract } from "./contract/privacySubject.contract.mjs";

const DIR = new URL("../modules/stream-story", import.meta.url).pathname;
const manifest = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8")), fr = JSON.parse(fs.readFileSync(`${DIR}/locales/fr.json`, "utf8"));
const def = (await import("../modules/stream-story/index.mjs")).default;
const P = await import("../modules/stream-story/pure.mjs");
const data = await import("../modules/stream-story/data.mjs");
const src = await import("../modules/stream-story/sources.mjs");
const images = await import("../modules/stream-story/images.mjs");
const book = await import("../modules/stream-story/contacts.mjs");
const migrate = await import("../modules/stream-story/migrate.mjs");

const SITE = "https://site.example.test";
const TW = "https://static-cdn.jtvnw.net/jtv_user_pictures/abc-profile_image-300x300.png";
const YT = "https://yt3.ggpht.com/ytc/AIdro_kAbCdEfGhIjKlMnOpQrStUvWxYz0123456789=s240-c-k-c0x00ffffff-no-rj";
const YT2 = "https://yt3.googleusercontent.com/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdef=s176-c-k-c0x00ffffff-no-rj";
const BSKY = "https://cdn.bsky.app/img/avatar/plain/did:plc:abcdefghijklmnopqrstuvwx/bafkreiabcdefghijklmnopqrstuvwxyz@jpeg";
const EVIL = "https://evil.example/photo.png";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");

const mk = (cb, extra = {}) => fakeCtx({
  key: "story", moduleId: "stream-story", locale: "fr", messages: { ...fr }, permissions: manifest.permissions, siteUrl: SITE,
  topics: { "planning.slot": () => [] }, instances: [{ id: "id-story", key: "story", module: "stream-story", basePath: "", name: "Story", adminPath: "/admin/instances/id-story" }],
  ...(cb ? { services: cb.services } : {}), ...extra,
});
const call = (ctx, route, { method = "GET", token, body, search = "" } = {}) => def.routes[route](new Request(`${SITE}/m/story/${route}${search}`, { method, headers: { ...(token ? { "x-story-token": token } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), ctx);
const json = async (r) => ({ status: r.status, ...(await r.json()) });
const get = async (ctx, token, route, search = "") => json(await call(ctx, route, { token, search }));
const act = async (ctx, token, body) => json(await call(ctx, "act", { method: "POST", token, body }));
const q = (o) => `?${new URLSearchParams(o)}`;
const timing0 = { ...src.timing }, img0 = { ...images.timing };
const realFetch = globalThis.fetch;
beforeEach(() => { Object.assign(src.timing, timing0, { bookMs: 120, providersMs: 120, migrateMs: 400, routeMs: 800 }); Object.assign(images.timing, img0); images.resetImages(); });
afterEach(() => { globalThis.fetch = realFetch; Object.assign(src.timing, timing0); Object.assign(images.timing, img0); });
const storeDump = async (ctx) => JSON.stringify(await Promise.all(["story_models", "story_adhoc", "story_preps", "story_costreamers", "story_key"].map((c) => ctx.api.store.list(c, { limit: 200 }))));

/* ───────────── Référencement ───────────── */

test("référencer : on cherche une personne dans Contacts (sans réseau imposé) et le modèle ne garde que l'identifiant de sa fiche : jamais son nom, ses pseudos ni sa photo", async () => {
  const cb = fakeContactBook();
  const alice = cb.seedContact({ name: "Alice Martin", accounts: [{ network: "twitch", handle: "alice_tv", displayName: "Alice TV", followers: 10, avatar: TW }, { network: "youtube", handle: "@alicechan" }] });
  cb.seedContact({ name: "Alice Corp", kind: "org", accounts: [{ network: "twitch", handle: "alice_corp" }] });
  const ctx = mk(cb), token = await data.mintToken(ctx);
  const r = await get(ctx, token, "people", q({ q: "alice" }));
  assert.deepEqual([r.ok, r.state, r.items.length], [true, "ok", 1], "seulement des personnes");
  assert.deepEqual(r.items[0], { id: alice.id, name: "Alice Martin", login: "alice_tv", image: TW, accounts: [{ network: "twitch", handle: "alice_tv", label: "Alice TV" }, { network: "youtube", handle: "@alicechan", label: "@alicechan" }] }, "pastilles de comptes et photo");
  const search = cb.calls.find((c) => c[1] === "search");
  assert.deepEqual(search, ["contact.book", "search", { q: "alice", kind: "person", limit: 30 }], "agnostique du réseau : pas de réseau demandé");
  const saved = await act(ctx, token, { op: "model.save", name: "Avec Alice", config: { style: "poster", costreamers: [{ id: alice.id, name: "Copie", login: "copie", image: TW }, { login: "invite_x", name: "Invité" }] } });
  assert.deepEqual(saved.items[0].config.costreamers, [{ id: alice.id }, { login: "invite_x", name: "Invité", image: "" }], "une référence ne garde RIEN d'autre que son identifiant");
  const dump = await storeDump(ctx);
  for (const copy of ["Alice Martin", "alice_tv", "Alice TV", "alicechan", "jtv_user_pictures", "Copie"]) assert.ok(!dump.includes(copy), `« ${copy} » ne doit pas être copié dans le stockage de Story`);
  assert.ok(dump.includes(alice.id));
});

test("recherche : 2 lettres au moins (sinon aucun appel), @ ignoré, réseau facultatif vérifié, 30 résultats au plus, photos lues en UN appel groupé, rien ne lève", async () => {
  const cb = fakeContactBook();
  for (let i = 0; i < 40; i++) cb.seedContact({ name: `Bruno ${String(i).padStart(2, "0")}`, accounts: [{ network: "twitch", handle: `bruno_tv_${i}`, avatar: TW, followers: i }] });
  cb.seedContact({ name: "Chloé", accounts: [{ network: "youtube", handle: "@chloe_yt" }] });
  const ctx = mk(cb), token = await data.mintToken(ctx);
  assert.deepEqual((await get(ctx, token, "people", q({ q: "b" }))).items, []); assert.deepEqual((await get(ctx, token, "people", q({ q: "  " }))).items, []);
  assert.equal(cb.calls.length, 0, "moins de 2 lettres : Contacts n'est pas dérangé");
  const r = await get(ctx, token, "people", q({ q: "@bruno" }));
  assert.equal(r.items.length, 30, "le contrat plafonne la recherche à 30");
  assert.deepEqual(cb.calls.map((c) => c[1]), ["search", "resolve"]); assert.equal(cb.calls[1][2].ids.length, 30, "les photos viennent d'un seul resolve");
  assert.ok(r.items.every((x) => x.image === TW && x.accounts[0].network === "twitch"));
  const yt = await get(ctx, token, "people", q({ q: "chlo", network: "youtube" }));
  assert.deepEqual(yt.items.map((x) => [x.name, x.login, x.image]), [["Chloé", "@chloe_yt", ""]], "sans photo connue : pas de photo");
  assert.deepEqual(cb.calls.filter((c) => c[1] === "search").at(-1)[2], { q: "chlo", network: "youtube", kind: "person", limit: 30 });
  const before = cb.calls.length;
  assert.deepEqual((await get(ctx, token, "people", q({ q: "chlo", network: "myspace" }))).error, "invalid_network"); assert.equal(cb.calls.length, before);
  assert.deepEqual((await get(ctx, token, "people", q({ q: "x".repeat(500) }))).items, [], "texte coupé à 100 caractères, sans erreur");
  assert.ok(cb.calls.at(-1)[2].q.length <= 100);
  const r405 = await call(ctx, "people", { method: "POST", token, body: {} }); assert.equal(r405.status, 405);
  assert.equal((await call(ctx, "people", { search: q({ q: "bruno" }) })).status, 401, "la route est protégée par le jeton");
});

test("Contacts en panne (exception) : la recherche répond « failed », sans casser la page", async () => {
  const cb = fakeContactBook(); cb.seedContact({ name: "Alice", accounts: [{ network: "twitch", handle: "alice_tv" }] });
  const ctx = mk(cb), token = await data.mintToken(ctx);
  cb.faults.throw.add("search");
  const r = await get(ctx, token, "people", q({ q: "alice" })); assert.deepEqual([r.ok, r.state, r.items], [true, "failed", []]);
  cb.faults.throw.delete("search"); cb.faults.throw.add("resolve");
  const ok = await get(ctx, token, "people", q({ q: "alice" })); assert.deepEqual([ok.state, ok.items.map((x) => [x.name, x.image])], ["ok", [["Alice", ""]]], "sans resolve : le résultat est montré sans photo");
});

/* ───────────── Contacts absent : le repli ───────────── */

test("Contacts absent : Story marche (saisie « pour cette vidéo seulement », modèles, IA), l'éditeur le dit, et le panneau propose d'installer un module qui offre le SERVICE contact.book (jamais un module nommé)", async () => {
  const ctx = mk(), token = await data.mintToken(ctx);
  const d = await get(ctx, token, "data"); assert.deepEqual([d.ok, d.contacts, d.adhoc, d.migrated], [true, "absent", [], null]);
  for (const [route, search] of [["people", q({ q: "alice" })], ["members", "?id=c1"], ["categories", ""], ["category", "?id=k1"]]) {
    const r = await get(ctx, token, route, search); assert.deepEqual([r.ok, r.state], [true, "absent"], route);
  }
  const added = await act(ctx, token, { op: "adhoc.check", login: "@Zoe_Live", name: "  Zoé \n Live ", image: TW });
  assert.deepEqual([added.ok, added.entry], [true, { login: "Zoe_Live", name: "Zoé Live", image: TW }], "rien n'est enregistré : l'entrée est renvoyée à la page");
  assert.equal(await ctx.api.store.count("story_adhoc"), 0, "jamais enregistrée (ni comme fiche, ni dans les ponctuels)");
  const m = await act(ctx, token, { op: "model.save", name: "Sans Contacts", config: { costreamers: [added.entry] } });
  assert.deepEqual(m.items[0].config.costreamers, [added.entry]);
  const names = await def.mcp.story_models(ctx); assert.deepEqual(names.models[0].costreamers, ["Zoe_Live"]);
  const prepared = await def.mcp.story_prepare(ctx, { costreamers: ["bob_x"] }); assert.deepEqual(prepared.prepared.costreamers, ["bob_x"]);
  const blocks = await def.adminPanel(ctx, { query: {} });
  const sug = blocks.filter((b) => b.type === "suggestInstall");
  assert.deepEqual(sug, [{ type: "suggestInstall", service: "contact.book", min: 2, reason: fr.admin_suggest_reason }], "UN encadré, pour le service");
  assert.ok(!/contacts|module/i.test(sug[0].service.replace("contact.book", "")), "aucun nom de module");
  const withBook = mk(fakeContactBook());
  assert.equal((await def.adminPanel(withBook, { query: {} })).filter((b) => b.type === "suggestInstall").length, 0, "avec Contacts : rien à proposer");
  const alone = mk(); alone.api.services.providers = () => new Promise(() => {});
  assert.ok((await Promise.race([def.adminPanel(alone, { query: {} }), new Promise((r) => setTimeout(() => r("HUNG"), 2000))])) !== "HUNG", "un cœur muet ne bloque pas le panneau");
});

test("saisie ponctuelle : pseudo, nom et photo facultatifs (au moins un pseudo ou un nom) ; une photo ne passe que si le relais sait la servir ; ponctuels : 20 au plus, sans doublon", async () => {
  const ctx = mk(), token = await data.mintToken(ctx);
  assert.deepEqual((await act(ctx, token, { op: "adhoc.check", login: "", name: "" })).error, "empty");
  assert.deepEqual((await act(ctx, token, { op: "adhoc.check", login: "   " })).error, "empty");
  assert.equal((await act(ctx, token, { op: "adhoc.check", login: "zoe_live", image: EVIL })).error, "image");
  assert.equal((await act(ctx, token, { op: "adhoc.check", login: "zoe_live", image: "javascript:alert(1)" })).error, "image");
  assert.equal((await act(ctx, token, { op: "adhoc.check", login: "zoe_live", image: "http://static-cdn.jtvnw.net/jtv_user_pictures/a.png" })).error, "image");
  assert.deepEqual((await act(ctx, token, { op: "adhoc.check", name: "Juste un nom" })).entry, { login: "", name: "Juste un nom", image: "" });
  for (const photo of [TW, YT, YT2, BSKY]) assert.equal((await act(ctx, token, { op: "adhoc.check", login: "p", image: photo })).entry.image, photo, photo.slice(0, 40));
  assert.deepEqual((await act(ctx, token, { op: "adhoc.check", login: "<b>x</b>" })).entry.login, "<b>x</b>", "du texte, jamais du HTML interprété");
  const many = Array.from({ length: 30 }, (_, i) => ({ login: `ponctuel_${i}`, name: "", image: "" }));
  const r = await data.addAdhoc(ctx, [...many, { login: "Ponctuel_1" }]);
  assert.deepEqual([r.added, r.skipped], [20, 11], "20 au plus, doublon (même pseudo) écarté");
  assert.equal((await data.readAdhoc(ctx)).length, 20); assert.equal(await ctx.api.store.count("story_adhoc"), 1, "un seul document");
  const first = (await data.readAdhoc(ctx))[0];
  assert.deepEqual((await act(ctx, token, { op: "adhoc.remove", id: first.id })).ok, true); assert.equal((await act(ctx, token, { op: "adhoc.remove", id: first.id })).error, "missing");
  assert.equal((await data.readAdhoc(ctx)).length, 19);
});

/* ───────────── Fiches des modèles : relire, suivre une fusion, signaler une fiche effacée ───────────── */

test("relire les fiches d'un modèle : nom, pseudo, photo ; une fiche fusionnée est suivie, une fiche effacée est signalée, une panne laisse la référence intacte ; 24 identifiants au plus par demande", async () => {
  const cb = fakeContactBook();
  const a = cb.seedContact({ name: "Alice", accounts: [{ network: "twitch", handle: "alice_tv", avatar: TW }] });
  const b = cb.seedContact({ name: "Bob", accounts: [{ network: "youtube", handle: "@bobyt" }] });
  const c = cb.seedContact({ name: "Carl", accounts: [{ network: "twitch", handle: "carl_tv" }] });
  const ctx = mk(cb), token = await data.mintToken(ctx);
  let r = await get(ctx, token, "members", `?id=${a.id}&id=${b.id}&id=nope`);
  assert.deepEqual(r.members.map((m) => [m.ref, m.name, m.login, m.image]), [[a.id, "Alice", "alice_tv", TW], [b.id, "Bob", "@bobyt", ""]]);
  assert.deepEqual(r.missing, ["nope"]);
  await cb.methods.merge({ keep: a.id, drop: c.id });
  r = await get(ctx, token, "members", `?id=${c.id}`);
  assert.deepEqual(r.members.map((m) => [m.ref, m.id, m.movedFrom, m.name]), [[c.id, a.id, c.id, "Alice"]], "la fiche gardée remplace la fiche fusionnée");
  cb.admin.deleteContact(b.id);
  r = await get(ctx, token, "members", `?id=${b.id}`); assert.deepEqual([r.members, r.missing], [[], [b.id]]);
  const ids = Array.from({ length: 60 }, (_, i) => `id${i}`);
  cb.calls.length = 0; await get(ctx, token, "members", "?" + ids.map((i) => `id=${i}`).join("&"));
  assert.equal(cb.calls[0][2].ids.length, 24, "plafond de la demande");
  const direct = await book.resolveMembers(ctx, Array.from({ length: 250 }, (_, i) => `x${i}`));
  assert.equal(cb.calls.at(-1)[2].ids.length, 100); assert.equal(direct.state, "ok");
  cb.faults.throw.add("resolve");
  r = await get(ctx, token, "members", `?id=${a.id}`); assert.deepEqual([r.ok, r.state, r.members], [true, "failed", []]);
});

test("photo : elle vient de la fiche (manuelle d'abord) ; seuls les hôtes réels de photos de Twitch, YouTube et Bluesky sont relayés ; sinon pas de photo (les initiales)", async () => {
  const cb = fakeContactBook();
  const mkp = (name, handle, photo, network = "twitch", avatar) => { const x = cb.seedContact({ name, accounts: [{ network, handle, ...(avatar ? { avatar, followers: 5 } : {}) }] }); if (photo) cb.admin.setManualPhoto(x.id, photo); return x.id; };
  const ids = {
    manual: mkp("Manuel", "manuel_tv", YT, "twitch", TW), yt: mkp("Yt", "yt_tv", YT2), bsky: mkp("Bsky", "bsky_tv", BSKY), evil: mkp("Evil", "evil_tv", EVIL), none: mkp("None", "none_tv"),
    insta: mkp("Insta", "insta", null, "instagram", "https://scontent.cdninstagram.com/v/t51/123_n.jpg?_nc_sid=1&oh=2&oe=3"), mast: mkp("Mast", "mast@mastodon.example", null, "mastodon", "https://files.mastodon.example/avatars/1/original/a.png"),
  };
  const ctx = mk(cb), token = await data.mintToken(ctx);
  const r = await get(ctx, token, "members", "?" + Object.values(ids).map((i) => `id=${i}`).join("&"));
  const by = Object.fromEntries(r.members.map((m) => [m.name, m.image]));
  assert.deepEqual(by, { Manuel: YT, Yt: YT2, Bsky: BSKY, Evil: "", None: "", Insta: "", Mast: "" }, "la photo manuelle l'emporte ; hôte inconnu ou adresse signée : pas de photo");
  for (const url of [TW, YT, YT2, BSKY]) assert.ok(images.allowedUrl(url), url);
});

/* ───────────── Relais d'images : hôtes ajoutés, mêmes bornes ───────────── */

const stream = (bytes, extra = {}) => ({ status: 200, headers: new Headers({ "content-type": "image/png", ...extra }), body: new Response(bytes).body });
test("relais d'images : les hôtes de photos de Contacts (YouTube, Bluesky) sont ajoutés avec un chemin exact ; imitations, ports, paramètres, http, mauvais chemins refusés sans aucune requête", async () => {
  const ctx = mk(), token = await data.mintToken(ctx);
  let calls = 0; globalThis.fetch = async () => { calls++; return stream(PNG); };
  const bad = [
    "http://yt3.ggpht.com/ytc/AIdro_kAbCdEfGhIjKlMnOpQrStUvWxYz0123456789=s240", "https://yt3.ggpht.com:444/ytc/AIdro_kAbCdEfGhIjKlMnOpQrStUvWxYz0123456789=s240", "https://yt3.ggpht.com/ytc/AIdro_kAbCdEfGhIjKlMnOpQrStUvWxYz0123456789=s240?x=1",
    "https://yt3.ggpht.com/short", "https://yt3.ggpht.com/ytc/../x", "https://yt3.ggpht.com.evil.example/ytc/AIdro_kAbCdEfGhIjKlMnOpQrStUvWxYz0123456789=s240", "https://evil.yt3.ggpht.com/ytc/AIdro_kAbCdEfGhIjKlMnOpQrStUvWxYz0123456789=s240",
    "https://yt3.ggpht.com@evil.example/ytc/AIdro_kAbCdEfGhIjKlMnOpQrStUvWxYz0123456789=s240", "https://lh3.googleusercontent.com/ytc/AIdro_kAbCdEfGhIjKlMnOpQrStUvWxYz0123456789=s240", "https://www.youtube.com/watch?v=1",
    "https://cdn.bsky.app/img/avatar/plain/did:plc:abcdefghijklmnopqrstuvwx/bafkreiabcdefghijklmnopqrstuvwxyz", "https://cdn.bsky.app/img/avatar/plain/did:web:evil.example/bafkreiabcdefghijklmnopqrstuvwxyz@jpeg", "https://cdn.bsky.app/img/avatar/plain/did:plc:abcdefghijklmnopqrstuvwx/bafkrei@gif",
    "https://cdn.bsky.app/xrpc/com.atproto.sync.getBlob?did=x", "https://cdn.bsky.app.evil.example/img/avatar/plain/did:plc:abcdefghijklmnopqrstuvwx/bafkreiabcdefghijklmnopqrstuvwxyz@jpeg", "https://bsky.social/img/avatar/plain/did:plc:abcdefghijklmnopqrstuvwx/bafkreiabcdefghijklmnopqrstuvwxyz@jpeg",
    "https://cdn.bsky.app/img/avatar/plain/did:plc:abcdefghijklmnopqrstuvwx/../../x@jpeg", "https://scontent.cdninstagram.com/v/t51/123_n.jpg", "https://pbs.twimg.com/profile_images/1/a.jpg", "https://files.mastodon.example/avatars/1/a.png",
  ];
  for (const u of bad) { const r = await call(ctx, "img", { token, search: q({ u }) }); assert.ok([400, 401].includes(r.status), `« ${u.slice(0, 70)} » → ${r.status}`); }
  assert.equal(calls, 0, "aucune requête sortante pour une adresse refusée");
  for (const u of [YT, YT2, BSKY, TW, "https://yt3.ggpht.com/a/AATXAJzAbCdEfGhIjKlMnOpQrStUvWxYz01234=s88-c-k-c0x00ffffff-no-rj-mo", "https://cdn.bsky.app/img/avatar_thumbnail/plain/did:plc:abcdefghijklmnopqrstuvwx/bafkreiabcdefghijklmnopqrstuvwxyz@png"]) {
    const r = await call(ctx, "img", { token, search: q({ u }) });
    assert.equal(r.status, 200, u); assert.equal(r.headers.get("content-type"), "image/png"); assert.match(r.headers.get("content-security-policy"), /default-src 'none'/);
  }
});

test("relais d'images : mêmes bornes pour les nouveaux hôtes : aucune redirection suivie, type lu dans les premiers octets (SVG et HTML refusés), 3 Mo au plus", async () => {
  const ctx = mk(), token = await data.mintToken(ctx), seen = [];
  let mode = "ok";
  globalThis.fetch = async (u, init) => {
    seen.push([String(u), init.redirect]);
    if (mode === "redirect") return { status: 302, headers: new Headers({ location: "https://169.254.169.254/x.png" }), body: null };
    if (mode === "svg") return stream("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>", { "content-type": "image/svg+xml" });
    if (mode === "lie") return stream("<html><script>alert(1)</script></html>", { "content-type": "image/png" });
    if (mode === "big") { let sent = 0; return { status: 200, headers: new Headers({ "content-type": "image/png" }), body: new ReadableStream({ pull(c) { if (sent >= 5_000_000) return c.close(); sent += 1_000_000; c.enqueue(new Uint8Array(1_000_000).fill(0x89)); } }) }; }
    return stream(PNG);
  };
  const status = async (u) => (await call(ctx, "img", { token, search: q({ u }) })).status;
  for (const [mode_, want] of [["redirect", 502], ["svg", 502], ["lie", 502], ["big", 502], ["ok", 200]]) {
    mode = mode_; images.resetImages();
    assert.equal(await status(BSKY), want, `bsky ${mode_}`); images.resetImages();
    assert.equal(await status(YT), want, `yt ${mode_}`);
  }
  assert.ok(seen.every(([, redirect]) => redirect === "manual"), "aucune redirection n'est suivie");
  assert.deepEqual(images.LIMITS.bytes, 3 * 1024 * 1024);
});

/* ───────────── Une catégorie de Contacts ───────────── */

test("catégories : la liste des catégories se lit par pages (curseur de Contacts) et se parcourt entièrement sans doublon ni trou", async () => {
  const cb = fakeContactBook();
  const ids = Array.from({ length: 120 }, (_, i) => cb.seedCategory(`Catégorie ${String(i).padStart(3, "0")}`));
  const ctx = mk(cb), token = await data.mintToken(ctx);
  const seen = []; let cursor = "", pages = 0;
  do {
    const r = await get(ctx, token, "categories", cursor ? q({ cursor }) : "");
    assert.equal(r.state, "ok"); assert.ok(r.items.length <= 50); seen.push(...r.items.map((k) => k.id)); cursor = r.next ?? ""; pages++;
  } while (cursor && pages < 10);
  assert.deepEqual([pages, new Set(seen).size, seen.length], [3, 120, 120]); assert.deepEqual([...seen].sort(), [...ids].sort());
  const f = await get(ctx, token, "categories", q({ q: "Catégorie 07" })); assert.equal(f.items.length, 10);
  assert.deepEqual((await get(ctx, token, "categories", q({ cursor: "n'importe quoi" }))).items, [], "curseur illisible : page vide, jamais d'erreur");
});

test("ajouter depuis une catégorie : comptes Twitch par pages de 20, une personne montrée une seule fois, photo de la fiche ; catégorie supprimée ou fusionnée gérée ; identifiant absurde sans appel", async () => {
  const cb = fakeContactBook();
  const cat = cb.seedCategory("Cible de raid"), other = cb.seedCategory("Autre");
  const people = [];
  for (let i = 0; i < 45; i++) people.push(cb.seedContact({ name: `Équipier ${String(i).padStart(2, "0")}`, accounts: [{ network: "twitch", handle: `equipier_${i}`, avatar: i % 2 ? TW : EVIL }], categoryIds: [cat] }).id);
  const dup = cb.seedContact({ name: "Deux comptes", accounts: [{ network: "twitch", handle: "double_a" }, { network: "twitch", handle: "double_b" }], categoryIds: [cat] }).id;
  cb.seedContact({ name: "YouTubeur", accounts: [{ network: "youtube", handle: "@seul_yt" }], categoryIds: [cat] });
  cb.seedContact({ name: "Hors catégorie", accounts: [{ network: "twitch", handle: "hors_cat" }], categoryIds: [other] });
  const ctx = mk(cb), token = await data.mintToken(ctx);
  const seen = []; let cursor = "", pages = 0;
  do {
    const r = await get(ctx, token, "category", q({ id: cat, ...(cursor ? { cursor } : {}) }));
    assert.equal(r.state, "ok"); assert.ok(r.items.length <= 20, "pages de 20 au plus");
    assert.equal(new Set(r.items.map((x) => x.id)).size, r.items.length, "une personne une fois par page");
    seen.push(...r.items); cursor = r.next ?? ""; pages++;
  } while (cursor && pages < 10);
  const uniq = new Map(seen.map((x) => [x.id, x]));
  assert.deepEqual([...uniq.keys()].sort(), [...people, dup].sort(), "les 46 personnes avec un compte Twitch, ni la YouTubeuse ni l'autre catégorie");
  assert.equal(uniq.get(people[1]).image, TW, "photo de la fiche"); assert.equal(uniq.get(people[0]).image, "", "hôte inconnu : pas de photo");
  assert.ok(cb.calls.filter((c) => c[1] === "accounts").every((c) => c[2].network === "twitch" && c[2].categoryId === cat && c[2].limit === 20));
  cb.admin.deleteCategory(other);
  assert.equal((await get(ctx, token, "category", q({ id: other }))).error, "not_found");
  const keep = cb.seedCategory("Gardée"), drop = cb.seedCategory("Doublon"); cb.admin.mergeCategories(keep, drop);
  assert.equal((await get(ctx, token, "category", q({ id: drop }))).state, "ok", "l'ancien identifiant d'une catégorie fusionnée est suivi par Contacts");
  const n = cb.calls.length;
  assert.equal((await get(ctx, token, "category", q({ id: "x".repeat(200) }))).error, "invalid"); assert.equal((await get(ctx, token, "category")).error, "invalid"); assert.equal(cb.calls.length, n);
});

/* ───────────── Migration ───────────── */

const legacyList = (ctx, items) => ctx.api.store.add("story_costreamers", { items });
const accountsOf = (cb) => cb.dump().contacts.flatMap((c) => c.accounts.map((a) => [c.name, a.network, a.handle]));
async function seedV1(ctx) {
  await legacyList(ctx, [{ login: "alice_tv", name: "Alice", image: TW }, { login: "bob_x", name: "", image: "" }, { login: "carl_99", name: "Carl", image: EVIL }]);
  await ctx.api.store.add("story_models", { items: [
    { id: "aaaaaa11", name: "Soirée", config: { style: "poster", costreamers: ["alice_tv", "zoe_live", "bob_x"] } },
    { id: "bbbbbb22", name: "Vide", config: { style: "minimal", costreamers: [] } },
  ] });
  await ctx.api.store.add("story_preps", { pid: "p".repeat(22), config: { style: "neon", costreamers: ["carl_99"] }, createdAt: Date.now(), expiresAt: Date.now() + 86_400_000 });
}

test("migration : chaque ancien co-streamer devient une fiche (upsertByAccount twitch, source stream-story), les modèles et préparations gardent l'identifiant, les saisies hors liste restent ponctuelles, l'ancienne liste est effacée à la fin", async () => {
  assert.equal(manifest.dataVersion, 2); assert.equal(typeof def.migrations[2], "function");
  const cb = fakeContactBook(), ctx = mk(cb, { migration: true });
  const existing = cb.seedContact({ name: "Alice Martin (déjà là)", accounts: [{ network: "twitch", handle: "Alice_TV" }] });
  await seedV1(ctx);
  await def.migrations[2](ctx);
  const ups = cb.calls.filter((c) => c[1] === "upsertByAccount").map((c) => c[2]);
  assert.deepEqual(ups, [
    { network: "twitch", handle: "alice_tv", kind: "person", name: "Alice", source: "stream-story" }, { network: "twitch", handle: "bob_x", kind: "person", source: "stream-story" }, { network: "twitch", handle: "carl_99", kind: "person", name: "Carl", source: "stream-story" },
  ]);
  const d = cb.dump().contacts;
  assert.equal(d.length, 3, "Alice existait déjà : elle n'est pas dupliquée");
  assert.equal(d.find((c) => c.id === existing.id).name, "Alice Martin (déjà là)", "le nom d'une fiche existante n'est jamais écrasé");
  const idOf = (handle) => d.find((c) => c.accounts.some((a) => a.handle === handle)).id;
  const models = await data.readModels(ctx);
  assert.deepEqual(models[0].config.costreamers, [{ id: existing.id }, { login: "zoe_live", name: "", image: "" }, { id: idOf("bob_x") }], "références par identifiant ; une saisie sans équivalent reste pour cette vidéo seulement");
  const prep = (await ctx.api.store.list("story_preps"))[0].data.config.costreamers;
  assert.deepEqual(prep, [{ id: idOf("carl_99") }]);
  assert.equal(await ctx.api.store.count("story_costreamers"), 0, "l'ancienne liste est remplacée");
  assert.deepEqual(accountsOf(cb).map((a) => a[1]), ["twitch", "twitch", "twitch"]);
  const dump = await storeDump(ctx);
  for (const copy of ["Alice", "Carl", "bob_x", "alice_tv", "carl_99", "jtv_user_pictures"]) assert.ok(!dump.includes(copy), `« ${copy} » ne reste dans Story qu'en référence`);
});

test("migration : rejouable deux fois (et plus), aucun doublon ni de fiche, ni de ponctuel, ni de référence ; la photo saisie est confiée à Contacts (jamais gardée par Story)", async () => {
  const cb = fakeContactBook(), ctx = mk(cb, { migration: true });
  await seedV1(ctx);
  const first = await migrate.migrateCostreamers(ctx);
  assert.deepEqual([first.state, first.created, first.existing, first.kept, first.models], ["done", 3, 0, 0, 2]);
  const snapshot = JSON.stringify([cb.dump().contacts.map((c) => [c.id, c.name, c.accounts.length]), await ctx.api.store.list("story_models"), await ctx.api.store.list("story_adhoc")]);
  for (let i = 0; i < 3; i++) { await def.migrations[2](ctx); assert.equal((await migrate.migrateCostreamers(ctx)).state, "none"); assert.equal((await migrate.ensureMigrated(ctx)).state, "none"); }
  assert.equal(JSON.stringify([cb.dump().contacts.map((c) => [c.id, c.name, c.accounts.length]), await ctx.api.store.list("story_models"), await ctx.api.store.list("story_adhoc")]), snapshot);
  const profile = cb.calls.filter((c) => c[1] === "setAccountProfile");
  assert.equal(profile.length, 1, "une seule photo sur un hôte relayable (Alice) ; celle d'un hôte inconnu n'est pas confiée");
  assert.deepEqual([profile[0][2].avatar, profile[0][2].source], [TW, "stream-story"]);
  const alice = cb.dump().contacts.find((c) => c.accounts.some((a) => a.handle === "alice_tv"));
  assert.equal(alice.accounts[0].avatar, TW);
  // rejeu APRÈS une interruption : la liste n'est pas effacée tant que tout n'est pas confié, le rejeu ne duplique rien
  const cb2 = fakeContactBook(), ctx2 = mk(cb2);
  await seedV1(ctx2);
  const real = cb2.services["contact.book"].upsertByAccount; let n = 0;
  cb2.services["contact.book"].upsertByAccount = async (a) => { if (++n === 2) return new Promise(() => {}); return real(a); };
  const cut = await migrate.migrateCostreamers(ctx2);
  assert.equal(cut.state, "waiting"); assert.equal(cb2.dump().contacts.length, 1, "une fiche est créée avant l'interruption");
  assert.equal(await ctx2.api.store.count("story_costreamers"), 1, "rien n'est effacé");
  assert.deepEqual((await data.readModels(ctx2))[0].config.costreamers.map((m) => m.login), ["alice_tv", "zoe_live", "bob_x"], "les modèles ne sont pas encore changés");
  cb2.services["contact.book"].upsertByAccount = real;
  const done = await migrate.migrateCostreamers(ctx2);
  assert.deepEqual([done.state, done.created, done.existing], ["done", 2, 1]);
  assert.equal(cb2.dump().contacts.length, 3);
});

test("migration sans Contacts (ou Contacts v2 muet) : rien n'est perdu, l'ancienne liste est gardée telle quelle et lue en repli, et la migration se rejoue quand Contacts est installé", async () => {
  const ctx = mk(null, { migration: true });
  await seedV1(ctx);
  await def.migrations[2](ctx);
  assert.equal(await ctx.api.store.count("story_costreamers"), 1, "ancienne liste intacte");
  assert.deepEqual((await data.readModels(ctx))[0].config.costreamers.map((m) => m.login), ["alice_tv", "zoe_live", "bob_x"], "les modèles se lisent encore (pseudos pour cette vidéo seulement)");
  const token = await data.mintToken(ctx);
  const d = await get(ctx, token, "data");
  assert.deepEqual(d.adhoc.map((m) => [m.login, m.name, m.legacy]), [["alice_tv", "Alice", true], ["bob_x", "", true], ["carl_99", "Carl", true]], "repli : l'ancienne liste est proposée comme ponctuels");
  assert.equal(d.contacts, "absent"); assert.equal(d.migrated, null);
  // Contacts arrive plus tard : l'éditeur rejoue la migration
  const cb = fakeContactBook(); ctx.api.services.providers = async () => [{ id: "p" }]; ctx.api.services.call = (s, m, a) => cb.services[s][m](a).then((value) => ({ ok: true, value }));
  const later = await get(ctx, token, "data");
  assert.deepEqual(later.migrated, { created: 3, existing: 0, kept: 0 }, "la personne en est informée");
  assert.equal(later.contacts, "ok"); assert.deepEqual(later.adhoc, []);
  assert.equal(await ctx.api.store.count("story_costreamers"), 0);
  assert.equal(cb.dump().contacts.length, 3);
  assert.equal((await get(ctx, token, "data")).migrated, null, "ne s'annonce qu'une fois");
});

test("migration : une personne que Contacts refuse (carnet plein) reste dans les ponctuels de Story, avec son nom et sa photo ; une erreur passagère n'en fait pas un ponctuel", async () => {
  const cb = fakeContactBook({ maxContacts: 2 }), ctx = mk(cb);
  await seedV1(ctx);
  const r = await migrate.migrateCostreamers(ctx);
  assert.deepEqual([r.state, r.created, r.kept], ["done", 2, 1]);
  assert.deepEqual((await data.readAdhoc(ctx)).map(({ login, name, image }) => ({ login, name, image })), [{ login: "carl_99", name: "Carl", image: EVIL }]);
  assert.equal(await ctx.api.store.count("story_costreamers"), 0);
  assert.deepEqual((await data.readModels(ctx))[0].config.costreamers.map((m) => m.id ? "ref" : m.login), ["ref", "zoe_live", "ref"]);
  const flaky = fakeContactBook(), ctx2 = mk(flaky); await seedV1(ctx2); flaky.faults.throw.add("upsertByAccount");
  const w = await migrate.migrateCostreamers(ctx2);
  assert.equal(w.state, "waiting"); assert.equal((await data.readAdhoc(ctx2)).length, 0); assert.equal(await ctx2.api.store.count("story_costreamers"), 1);
});

test("migration à grande échelle : 60 anciens co-streamers (le plafond de la version 1) et 30 modèles de 6 co-streamers ; un seul passage borné, puis plus rien à faire", async () => {
  const cb = fakeContactBook(), ctx = mk(cb);
  const old = Array.from({ length: 60 }, (_, i) => ({ login: `chaine_${String(i).padStart(3, "0")}`, name: `Nom ${i}`, image: "" }));
  await legacyList(ctx, old);
  await ctx.api.store.add("story_models", { items: Array.from({ length: 30 }, (_, k) => ({ id: `m${String(k).padStart(7, "0")}`, name: `Modèle ${k}`, config: { costreamers: old.slice(k, k + 6).map((x) => x.login) } })) });
  const t0 = Date.now(), r = await migrate.migrateCostreamers(ctx);
  assert.deepEqual([r.state, r.created, r.models], ["done", 60, 30]); assert.ok(Date.now() - t0 < 5000);
  assert.ok((await data.readModels(ctx)).every((m) => m.config.costreamers.length === 6 && m.config.costreamers.every((e) => e.id && Object.keys(e).length === 1)));
  assert.equal(cb.dump().contacts.length, 60);
});

/* ───────────── Les outils pour l'IA avec Contacts ───────────── */

test("MCP avec Contacts : un pseudo connu devient une référence de fiche (nom et photo de Contacts), un inconnu reste pour cette vidéo seulement ; story_models rend des noms, jamais des identifiants internes", async () => {
  const cb = fakeContactBook();
  const alice = cb.seedContact({ name: "Alice Martin", accounts: [{ network: "twitch", handle: "alice_tv" }] });
  cb.seedContact({ name: "Alice Autre", accounts: [{ network: "twitch", handle: "alice_tv_2" }] });
  const ctx = mk(cb), token = await data.mintToken(ctx);
  const r = await def.mcp.story_prepare(ctx, { costreamers: ["Alice_TV", "@zoe_live", "alice_tv"] });
  assert.deepEqual(r.prepared.costreamers, ["alice_tv", "zoe_live"]);
  const prep = (await ctx.api.store.list("story_preps"))[0].data.config.costreamers;
  assert.deepEqual(prep, [{ id: alice.id }, { login: "zoe_live", name: "", image: "" }], "seul le pseudo EXACT d'une fiche est relié (pas « alice_tv_2 »)");
  assert.ok(!JSON.stringify(await ctx.api.store.list("story_preps")).includes("Alice Martin"));
  await act(ctx, token, { op: "model.save", name: "Soirée", config: { costreamers: [{ id: alice.id }, { id: "fiche_effacee" }, { login: "", name: "Invité", image: "" }] } });
  const m = await def.mcp.story_models(ctx);
  assert.deepEqual(m.models[0].costreamers, ["alice_tv", "Invité"], "pseudo Twitch de la fiche (reprenable par story_prepare), fiche effacée omise");
  await assert.rejects(def.mcp.story_prepare(ctx, { costreamers: ["ab"] }), /not a valid Twitch name/);
  await assert.rejects(def.mcp.story_prepare(ctx, { costreamers: [{ id: alice.id }] }), /not a valid/);
});

/* ───────────── privacy.subject ───────────── */

const svc = def.services["privacy.subject"];
runPrivacySubjectContract(async () => {
  const ctx = mk();
  return {
    methods: Object.fromEntries(Object.keys(svc).map((m) => [m, (args) => svc[m](ctx, args)])),
    addReference: async (contactId) => { await data.saveModel(ctx, { name: `M ${Math.random().toString(36).slice(2, 8)}`, config: { costreamers: [{ id: contactId }] } }); },
    countReferences: async (contactId) => (await data.referencesOf(ctx, contactId)).models.length,
  };
}, { test, prefix: "stream-story privacy.subject" });

test("privacy.subject : Contacts demande l'export, l'effacement et le suivi d'une fusion ; Story compte les modèles ET les préparations, sans toucher aux autres références", async () => {
  assert.deepEqual(manifest.offers.map((o) => o.service), ["privacy.subject"]);
  const cb = fakeContactBook(), ctx = mk(cb);
  const a = cb.seedContact({ name: "Alice", accounts: [{ network: "twitch", handle: "alice_tv" }] }), b = cb.seedContact({ name: "Alice bis", accounts: [{ network: "twitch", handle: "alice_bis" }] }), c = cb.seedContact({ name: "Carl", accounts: [{ network: "twitch", handle: "carl_tv" }] });
  await data.saveModel(ctx, { name: "Un", config: { costreamers: [{ id: a.id }, { id: c.id }] } });
  await data.saveModel(ctx, { name: "Deux", config: { costreamers: [{ id: b.id }, { id: a.id }] } });
  await data.savePrep(ctx, { config: { costreamers: [{ id: a.id }] } });
  const exp = await svc.export(ctx, { contactId: a.id });
  assert.deepEqual([exp.label, exp.data], ["Story d'annonce", { models: ["Un", "Deux"], preparations: 1 }]);
  cb.addPrivacySubject({ instance: "story", name: "Story d'annonce", methods: Object.fromEntries(Object.keys(svc).map((m) => [m, (args) => svc[m](ctx, args)])) });
  const merged = await cb.methods.merge({ keep: a.id, drop: b.id });
  assert.deepEqual(merged.remapped, [{ module: "story", ok: true }]);
  const models = await data.readModels(ctx);
  assert.deepEqual(models.map((m) => m.config.costreamers.map((e) => e.id)), [[a.id, c.id], [a.id]], "fusion suivie, sans doublon");
  const erased = await cb.methods.erase({ id: a.id, confirm: true });
  assert.deepEqual(erased.modules, [{ module: "story", ok: true, removed: 3 }]);
  assert.deepEqual((await data.readModels(ctx)).map((m) => m.config.costreamers.map((e) => e.id)), [[c.id], []]);
  assert.deepEqual((await ctx.api.store.list("story_preps"))[0].data.config.costreamers, []);
  assert.deepEqual((await svc.erase(ctx, { contactId: a.id })), { removed: 0 }, "rejouer ne change rien");
});

/* ───────────── Bornes ───────────── */

test("bornes : 6 co-streamers au plus par vidéo (références et saisies ensemble), dédoublonnés ; images de saisies refusées gardées vides dans un modèle ; modèles et préparations restent lisibles", async () => {
  const ctx = mk(), token = await data.mintToken(ctx);
  const cfg = P.cleanConfig({ costreamers: [...Array.from({ length: 4 }, (_, i) => ({ id: `c${i}` })), { id: "c0" }, { login: "a_b", name: "", image: "" }, { login: "A_B" }, { name: "x" }, { name: "y" }] });
  assert.equal(cfg.costreamers.length, 6); assert.deepEqual(cfg.costreamers.map(P.memberKey), ["id:c0", "id:c1", "id:c2", "id:c3", "x:a_b", "x:x"]);
  const saved = await act(ctx, token, { op: "model.save", name: "Photo", config: { costreamers: [{ login: "zoe", image: TW }, { login: "mallory", image: EVIL }, { login: "sans_https", image: "http://static-cdn.jtvnw.net/jtv_user_pictures/a.png" }] } });
  assert.deepEqual(saved.items[0].config.costreamers.map((m) => m.image), [TW, "", ""], "une photo que le relais ne servirait pas n'est pas gardée");
  assert.equal((await act(ctx, token, { op: "costreamer.save", login: "alice_tv" })).status, 400, "l'ancienne opération n'existe plus");
  assert.equal((await act(ctx, token, { op: "costreamers.import" })).status, 400, "ni la reprise des partenaires du Raid");
  const { pid } = await data.savePrep(ctx, { config: { costreamers: [{ id: "c1" }, { login: "zoe", image: EVIL }] } });
  assert.deepEqual((await data.readPrep(ctx, pid)).config.costreamers, [{ id: "c1" }, { login: "zoe", name: "", image: "" }]);
});

test("Story ne lit plus le sujet « stream.partner » : aucun appel à topics.collect pour les partenaires, nulle part dans le code", async () => {
  const ctx = mk(fakeContactBook()), token = await data.mintToken(ctx);
  await get(ctx, token, "data"); await get(ctx, token, "streams"); await def.adminPanel(ctx, { query: {} });
  assert.ok(ctx.calls.topics.every(([topic]) => topic === "planning.slot"), JSON.stringify(ctx.calls.topics.map((t) => t[0])));
  for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith(".mjs"))) assert.ok(!/topics\.collect\(\s*["`']stream\.partner/.test(fs.readFileSync(`${DIR}/${f}`, "utf8")), f);
  assert.ok(!JSON.stringify(manifest).includes("stream.partner"));
});
