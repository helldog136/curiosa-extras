// Contacts (lot K2) — la photo : la règle (manuelle > plus grosse communauté > Twitch > YouTube > Bluesky), le rafraîchissement SEULEMENT quand une personne ouvre
// la fiche ou clique « Actualiser la photo » (jamais de balayage, de minuteur ni d'appel depuis les services), les connecteurs facultatifs avec attente bornée,
// et la suggestion d'installation par service.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { makeCtx, def, B, D, I, PH, N, svc, htmlOf, plain, exportText, DIR } from "./helpers/contactsK2.mjs";
import { makeConnector, yt } from "./helpers/fakeYoutube.mjs";

const kit = await import(pathToFileURL(path.join(process.env.CURIOSA_DIR ?? process.cwd(), "testsupport/index.mjs")).href);
const { withFakeFetch, netReplies } = kit;

const bsky = (handle, extra = {}) => ({ did: "did:plc:abcdefghijklmnopqrstuvwx", handle, displayName: "Sky Person", avatar: "https://cdn.bsky.example.test/avatar.jpg", followersCount: 900, ...extra });
const BSKY = "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfiles";
const twitchStub = (log = []) => ({ request: (args) => { log.push(args); return { ok: true, status: 200, json: { data: (args.query.login ?? []).map((l) => ({ login: l, display_name: `${l} (Twitch)`, profile_image_url: `https://static.twitch.example.test/${l}.png` })) } }; } });
const youtubeStub = (log = [], subscribers = 12400) => ({ channels: (args) => { log.push(args); return { ok: true, items: [...args.ids.map((id) => ({ id, handle: null })), ...args.handles.map((h) => ({ id: "UCaaaaaaaaaaaaaaaaaaaaaa", handle: h }))].map((c) => ({ ...c, title: "Chaîne YT", avatar: "https://yt3.example.test/a.jpg", subscribers, hidden: false, at: new Date().toISOString() })), missing: [], failed: [] }; } });

async function ada(ctx) {
  const r = await svc.create(ctx, { name: "Ada Photo" });
  for (const [network, handle] of [["twitch", "ada_live"], ["youtube", "@ada-chan"], ["bluesky", "ada.example.test"]]) assert.equal((await B.addAccount(ctx, { id: r.id, network, handle })).ok, true);
  return r.id;
}
const photoOf = async (ctx, id) => (await svc.get(ctx, { id })).contact.photo;

test("la règle : photo manuelle d'abord, puis le compte qui a le plus d'abonnés (cache daté), sinon Twitch, YouTube, Bluesky — sans réseau", async () => {
  const acc = (id, network, avatar, followers) => ({ id, network, avatar, ...(followers === undefined ? {} : { followers }) });
  assert.deepEqual(N.pickPhoto({ photo: "https://m.example.test/me.jpg", accounts: [acc("a", "youtube", "https://y", 99999)] }), { url: "https://m.example.test/me.jpg", source: "manual" });
  assert.deepEqual(N.pickPhoto({ accounts: [acc("t", "twitch", "https://t", 500), acc("y", "youtube", "https://y", 12000), acc("b", "bluesky", "https://b", 900)] }), { url: "https://y", source: "youtube", accountId: "y" });
  assert.equal(N.pickPhoto({ accounts: [acc("b", "bluesky", "https://b"), acc("y", "youtube", "https://y"), acc("t", "twitch", "https://t")] }).source, "twitch", "aucun nombre connu : Twitch d'abord");
  assert.equal(N.pickPhoto({ accounts: [acc("b", "bluesky", "https://b"), acc("y", "youtube", "https://y")] }).source, "youtube");
  assert.equal(N.pickPhoto({ accounts: [acc("b", "bluesky", "https://b")] }).source, "bluesky");
  assert.equal(N.pickPhoto({ accounts: [acc("y", "youtube", undefined, 5)] }), null, "pas d'image, pas de photo");
});

test("ouvrir une fiche rafraîchit les profils de plus de 24 h (Twitch, YouTube par leurs connecteurs, Bluesky par le réseau du cœur) puis la photo vient de la plus grosse communauté", async () => {
  const tlog = [], ylog = [];
  const ctx = makeCtx({ locale: "fr", services: { "twitch.api": twitchStub(tlog), "youtube.api": youtubeStub(ylog) } });
  const id = await ada(ctx);
  PH.forgetTries();
  await withFakeFetch({ [BSKY]: { json: { profiles: [bsky("ada.example.test")] } } }, async (f) => {
    const page = await def.adminPanel(ctx, { query: { contact: id } });
    assert.equal(f.calls.length, 1, "Bluesky : un seul appel pour tous ses comptes");
    assert.match(f.calls[0].url, /actors=ada\.example\.test/);
    assert.equal(tlog.length, 1);
    assert.deepEqual(tlog[0], { as: "app", method: "GET", path: "users", query: { login: ["ada_live"] }, priority: "interactive" });
    assert.deepEqual([ylog.length, ylog[0].handles, ylog[0].priority], [1, ["@ada-chan"], "interactive"]);
    assert.match(plain(page), /Photo YouTube \(12.400 abonnés\)/, "YouTube a la plus grosse communauté");
    const c = (await svc.get(ctx, { id })).contact;
    assert.deepEqual(c.photo, { url: "https://yt3.example.test/a.jpg", source: "youtube", accountId: c.accounts.find((a) => a.network === "youtube").id });
    assert.deepEqual(c.accounts.map((a) => [a.network, a.followers, a.displayName]), [["twitch", undefined, "ada_live (Twitch)"], ["youtube", 12400, "Chaîne YT"], ["bluesky", 900, "Sky Person"]]);
    assert.ok(c.accounts.every((a) => a.profileAt && a.avatar));
    // Rouvrir tout de suite : plus personne n'est appelé (profils de moins de 24 h).
    await def.adminPanel(ctx, { query: { contact: id } });
    assert.equal(f.calls.length, 1);
    assert.equal(tlog.length + ylog.length, 2);
  });
});

test("un profil de plus de 24 h est relu à l'ouverture, mais pas deux fois en 10 minutes ; « Actualiser la photo » force la lecture", async () => {
  const ylog = [];
  const ctx = makeCtx({ services: { "youtube.api": youtubeStub(ylog, 100) } });
  const r = await svc.create(ctx, { name: "Yann" });
  const acc = await B.addAccount(ctx, { id: r.id, network: "youtube", handle: "@yann" });
  PH.forgetTries();
  await svc.setAccountProfile(ctx, { id: r.id, accountId: acc.accountId, followers: 1, source: "test-suite", at: new Date(Date.now() - 30 * 3_600_000).toISOString() });
  await def.adminPanel(ctx, { query: { contact: r.id } });
  assert.equal(ylog.length, 1, "profil trop vieux : relu");
  await svc.setAccountProfile(ctx, { id: r.id, accountId: acc.accountId, followers: 2, source: "test-suite", at: new Date(Date.now() - 3_600_000).toISOString() });
  await def.adminPanel(ctx, { query: { contact: r.id } });
  assert.equal(ylog.length, 1, "frais : rien à relire");
  const res = await def.adminActions.refreshPhoto(ctx, { id: r.id });
  assert.equal(ylog.length, 2, "le bouton force");
  assert.equal(res.ok, "Photo and followers updated.");
  assert.equal(res.redirect, `?contact=${encodeURIComponent(r.id)}`);
  assert.equal(PH.TTL_MS, 24 * 3_600_000);
  assert.equal(PH.TRY_MS, 10 * 60_000);
});

test("JAMAIS hors interaction : lister, chercher, importer, exporter, fusionner, les services de `contact.book` n'appellent ni connecteur ni réseau ; aucun minuteur ni tâche de fond", async () => {
  const calls = [];
  const ctx = makeCtx({ services: { "twitch.api": { request: (a) => { calls.push(["twitch", a]); return { ok: true, status: 200, json: { data: [] } }; } }, "youtube.api": { channels: (a) => { calls.push(["youtube", a]); return { ok: true, items: [] }; } } } });
  const net = ctx.api.net.request;
  ctx.api.net.request = async (...a) => { calls.push(["net", a[0].url]); return net(...a); };
  await withFakeFetch({ "*": { status: 500 } }, async () => {
    const id = await ada(ctx);
    const other = await ada2(ctx);
    for (const m of ["list", "search", "accounts", "resolve", "find", "categories", "get"]) await svc[m](ctx, { network: "twitch", q: "ada", ids: [id], id, limit: 5 });
    await svc.upsertByAccount(ctx, { network: "bluesky", handle: "someone.example.test", source: "test-suite" });
    await svc.setAccountProfile(ctx, { id, accountId: (await svc.get(ctx, { id })).contact.accounts[0].id, followers: 3, source: "test-suite", at: new Date().toISOString() });
    await svc.merge(ctx, { keep: id, drop: other });
    await exportText(ctx);
    await def.adminPanel(ctx, { query: {} });
    await def.adminPanel(ctx, { query: { view: "dupes" } });
    await def.adminPanel(ctx, { query: { view: "categories" } });
    await def.adminPanel(ctx, { query: { view: "import" } });
    await def.adminBadge(ctx);
    await I.stage(ctx, "name,accounts\nA,bluesky:aaa.example.test | twitch:aaa_live | youtube:@aaa\n", { locale: "en" });
    await I.step(ctx, "preview");
    await I.step(ctx, "run");
    await svc.erase(ctx, { id: other, confirm: true }).catch(() => {});
  });
  assert.deepEqual(calls, [], "aucun appel hors de l'ouverture d'une fiche ou du bouton");
  // Aucun minuteur, aucune tâche : ni `tasks` ni `hooks` dans le module, ni setInterval nulle part.
  assert.equal(def.tasks, undefined);
  assert.equal(def.hooks, undefined);
  const code = fs.readdirSync(DIR).filter((f) => f.endsWith(".mjs")).map((f) => [f, fs.readFileSync(`${DIR}/${f}`, "utf8")]);
  for (const [f, src] of code) {
    const body = src.replace(/\/\/.*$/gm, "");
    assert.ok(!/setInterval|\bcron\b|node-cron/.test(body), `${f} : aucun minuteur répété`);
    assert.ok(!/\bfetch\(/.test(body), `${f} : pas de fetch direct (ctx.api.net)`);
  }
  // Les seuls appelants des lecteurs de photos : l'ouverture d'une fiche et le bouton.
  const callers = code.filter(([f, src]) => f !== "photos.mjs" && /refreshOnOpen|refreshNow|refreshFiche/.test(src.replace(/\/\/.*$/gm, ""))).map(([f]) => f);
  assert.deepEqual(callers, ["admin.mjs"]);
  const adminSrc = code.find(([f]) => f === "admin.mjs")[1];
  assert.equal([...adminSrc.matchAll(/Ph\.refresh(?:OnOpen|Now)\(/g)].length, 3, "contactPage (ouverture) + l'action du bouton + l'ajout rapide (clic sur Enregistrer, connecteur installé seulement)");
});
const ada2 = async (ctx) => (await svc.create(ctx, { name: "Ada Photo", organisation: "X" })).id;

test("sans connecteur : la fiche propose d'installer PAR SERVICE (Twitch, YouTube), ne nomme aucun module ; Bluesky marche sans rien installer ; le bouton dit quoi faire", async () => {
  const ctx = makeCtx({ locale: "fr" });
  const id = await ada(ctx);
  PH.forgetTries();
  await withFakeFetch({ [BSKY]: { json: { profiles: [bsky("ada.example.test", { followersCount: 4200 })] } } }, async () => {
    const page = await def.adminPanel(ctx, { query: { contact: id } });
    assert.deepEqual(page.filter((b) => b.type === "suggestInstall").map((b) => [b.service, b.min]), [["twitch.api", 3], ["youtube.api", undefined]]);
    assert.ok(!/twitch-connector|youtube-connector|twitch-channel|youtube-channel/.test(JSON.stringify(page)), "un service, jamais un nom de module");
    assert.match(plain(page), /Photo Bluesky \(4.200 abonnés\)/, "Bluesky ne demande aucun connecteur");
    const r = await def.adminActions.refreshPhoto(ctx, { id });
    assert.match(r.ok, /Photo et abonnés mis à jour\. Pour Twitch, YouTube, installez le module qui parle à ce service \(voir la proposition plus haut\)\./);
  });
});

test("bouton « Actualiser la photo » : visible seulement s'il y a un compte Twitch, YouTube ou Bluesky ; message clair quand le service ne répond pas", async () => {
  const ctx = makeCtx({ locale: "fr" });
  const plainOne = await svc.create(ctx, { name: "Sans réseau" });
  await B.addAccount(ctx, { id: plainOne.id, network: "tiktok", handle: "sans.reseau" });
  assert.ok(!(await def.adminPanel(ctx, { query: { contact: plainOne.id } })).some((b) => b.action === "refreshPhoto"));
  assert.equal((await def.adminActions.refreshPhoto(ctx, { id: plainOne.id })).error, "Cette fiche n'a pas de compte Twitch, YouTube ou Bluesky à actualiser.");
  const id = await ada(ctx);
  assert.ok((await def.adminPanel(ctx, { query: { contact: id } })).some((b) => b.action === "refreshPhoto" && b.submitLabel === "Actualiser la photo"));
  await withFakeFetch({ [BSKY]: netReplies.down() }, async () => {
    const r = await def.adminActions.refreshPhoto(ctx, { id });
    assert.match(r.error ?? r.ok, /Impossible de joindre|Pour Twitch/);
  });
  const down = makeCtx({ locale: "fr" });
  const only = await svc.create(down, { name: "Seule Bluesky" });
  await B.addAccount(down, { id: only.id, network: "bluesky", handle: "seule.example.test" });
  await withFakeFetch({ [BSKY]: netReplies.down() }, async () => {
    assert.equal((await def.adminActions.refreshPhoto(down, { id: only.id })).error, "Impossible de joindre Bluesky pour l'instant. La fiche garde ses dernières données ; réessayez dans quelques minutes.");
  });
});

test("trou noir : un connecteur qui ne répond jamais, un Bluesky muet ou qui dit « trop de demandes » ne retardent pas l'ouverture de la fiche au-delà de la borne, ni ne la cassent", async () => {
  const never = new Promise(() => {});
  const ctx = makeCtx({ locale: "fr", services: { "twitch.api": { request: () => never }, "youtube.api": { channels: () => never } }, test: { photoWaitMs: 150, photoCallMs: 100 } });
  const id = await ada(ctx);
  PH.forgetTries();
  await withFakeFetch({ [BSKY]: netReplies.silence() }, async () => {
    const t = Date.now();
    const page = await def.adminPanel(ctx, { query: { contact: id } });
    assert.ok(Date.now() - t < 1500, `ouverture bornée : ${Date.now() - t} ms`);
    assert.match(plain(page), /Ada Photo/, "la fiche s'affiche malgré tout");
    const again = Date.now();
    await def.adminPanel(ctx, { query: { contact: id } });
    assert.ok(Date.now() - again < 300, "deuxième ouverture : pas de nouvel essai avant 10 minutes");
  });
  // Trop de demandes : le cœur met le service en pause, la fiche ne réessaie pas.
  const limited = makeCtx({ locale: "fr", test: { photoCallMs: 300 } });
  const only = await svc.create(limited, { name: "Limitée" });
  await B.addAccount(limited, { id: only.id, network: "bluesky", handle: "limitee.example.test" });
  PH.forgetTries();
  await withFakeFetch({ [BSKY]: netReplies.rateLimited(120) }, async (f) => {
    const r = await def.adminActions.refreshPhoto(limited, { id: only.id });
    assert.match(r.error, /Impossible de joindre Bluesky/);
    assert.equal(f.calls.length, 1);
    await def.adminActions.refreshPhoto(limited, { id: only.id });
    assert.equal(f.calls.length, 1, "pause du cœur : aucun appel réseau pendant la pause");
  });
});

test("avec le VRAI Connecteur YouTube : nom, photo et abonnés viennent de lui, par une attente bornée", async () => {
  const conn = makeConnector({ apiKey: "FAKE-YT-KEY-0001" });
  const ctx = makeCtx({ locale: "fr", services: conn.services });
  const r = await svc.create(ctx, { name: "Chaîne Vraie" });
  await B.addAccount(ctx, { id: r.id, network: "youtube", handle: "UCabcdefghijklmnopqrstuv" });
  PH.forgetTries();
  await withFakeFetch({ "https://www.googleapis.com/youtube/v3/channels": { json: yt.list([yt.channel("UCabcdefghijklmnopqrstuv", { title: "Vraie Chaîne", subscribers: "3456" })]) } }, async (f) => {
    await def.adminPanel(ctx, { query: { contact: r.id } });
    assert.equal(f.calls.length, 1);
    assert.ok(!JSON.stringify(f.calls).includes("FAKE-YT-KEY") || f.calls[0].init.headers, "la clé voyage dans un en-tête, jamais affichée");
  });
  const c = (await svc.get(ctx, { id: r.id })).contact;
  assert.deepEqual([c.accounts[0].followers, c.accounts[0].displayName], [3456, "Vraie Chaîne"]);
  assert.equal(c.photo.source, "youtube");
  assert.ok(!JSON.stringify(await def.adminPanel(ctx, { query: { contact: r.id } })).includes("FAKE-YT-KEY"));
});

test("photo choisie à la main : elle passe devant tout, même après un rafraîchissement ; téléverser, revenir à l'automatique ; adresses non sûres refusées", async () => {
  const ctx = makeCtx({ locale: "fr", services: { "youtube.api": youtubeStub([], 50000) } });
  const r = await svc.create(ctx, { name: "Manuelle" });
  await B.addAccount(ctx, { id: r.id, network: "youtube", handle: "@manuelle" });
  assert.equal((await def.adminActions.photo(ctx, { id: r.id, photo: "/uploads/ma-photo.jpg" })).ok, "Photo enregistrée.");
  PH.forgetTries();
  await def.adminActions.refreshPhoto(ctx, { id: r.id });
  assert.deepEqual((await photoOf(ctx, r.id)), { url: "/uploads/ma-photo.jpg", source: "manual" });
  const page = await def.adminPanel(ctx, { query: { contact: r.id } });
  assert.match(plain(page), /Photo choisie à la main/);
  assert.ok(page.find((b) => b.action === "photo").fields.some((f) => f.name === "photo" && f.kind === "image"), "téléversement depuis l'appareil");
  assert.equal((await def.adminActions.photoAuto(ctx, { id: r.id })).ok, "Photo enregistrée.");
  assert.equal((await photoOf(ctx, r.id)).source, "youtube");
  assert.ok((await def.adminActions.photo(ctx, { id: r.id, photo: "http://insecure.example.test/x.jpg" })).errors.photo);
  assert.ok(D.LIMITS.accountsPerContact >= PH.PER_SERVICE);
});

test("au plus 10 comptes par service et par fois ; aucune donnée tierce n'est écrite si la réponse est absurde (avatar non https, abonnés négatifs)", async () => {
  const log = [];
  const ctx = makeCtx({ services: { "twitch.api": twitchStub(log) } });
  const r = await svc.create(ctx, { name: "Beaucoup" });
  for (let i = 0; i < 14; i++) await B.addAccount(ctx, { id: r.id, network: "twitch", handle: `many_${String(i).padStart(2, "0")}` });
  PH.forgetTries();
  await def.adminPanel(ctx, { query: { contact: r.id } });
  assert.equal(log[0].query.login.length, 10);
  const weird = makeCtx({ services: { "youtube.api": { channels: () => ({ ok: true, items: [{ id: "UCaaaaaaaaaaaaaaaaaaaaaa", handle: null, title: "T", avatar: "http://bad.example.test/x.jpg", subscribers: -5, hidden: false }] }) } } });
  const w = await svc.create(weird, { name: "Absurde" });
  await B.addAccount(weird, { id: w.id, network: "youtube", handle: "UCaaaaaaaaaaaaaaaaaaaaaa" });
  PH.forgetTries();
  await def.adminPanel(weird, { query: { contact: w.id } });
  const c = (await svc.get(weird, { id: w.id })).contact;
  assert.equal(c.accounts[0].avatar, undefined);
  assert.equal(c.accounts[0].followers, undefined);
  void htmlOf;
});
