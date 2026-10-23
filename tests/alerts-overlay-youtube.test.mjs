// Overlay alertes 1.1 : la source YouTube (sujet facultatif live.event publié par Actions du live YouTube). Sans ce module, l'overlay se comporte comme avant.
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { parseManifest } from "@/core/modules/manifest";
import { world, def as ytDef, E as ytE } from "./helpers/ytLiveWorld.mjs";

const DIR = new URL("../modules/alerts-overlay", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
const manifest = readJson("module.json");
const mod = await import("../modules/alerts-overlay/index.mjs");
const def = mod.default;
const EV = await import("../modules/youtube-live-actions/events.mjs");
const bus = globalThis.__curiosaAlertsBus;
const T0 = Date.parse("2026-10-14T20:00:00Z");

let n = 0;
/** Un overlay (clé neuve à chaque appel : la mémoire des alertes déjà vues est par clé). `items` : ce que le sujet live.event rend ; `provider` : « Actions du live YouTube » est installé. */
function overlay({ items = [], provider = true, settings = {}, locale = "fr", collect } = {}) {
  const key = `al${++n}`;
  const got = []; const on = (e) => got.push(e); bus.on(key, on);
  const ctx = fakeCtx({ key, locale, messages: readJson(`locales/${locale}.json`), settings, instances: provider ? [{ id: "i1", key: "yt", module: "youtube-live-actions", basePath: "", name: "Actions", adminPath: "/admin/instances/i1" }] : [], topics: { "live.event": collect ?? (() => items) } });
  return { ctx, key, got, off: () => bus.off(key, on) };
}
const item = (o = {}) => ({ id: `yt-${Math.random().toString(16).slice(2, 14)}`, platform: "youtube", kind: "superchat", who: "Léa", amount: 5, currency: "EUR", at: new Date(Date.now()).toISOString(), ...o });
const pull = (o, now) => mod.pullLive(o.ctx, now);

beforeEach(() => {});
afterEach(() => {});

test("manifeste : version mineure, consomme live.event (schéma), permission topics, réglage « texte des messages » éteint par défaut, parité fr/en", () => {
  const r = parseManifest(manifest); assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(manifest.version, "1.1.0");
  assert.deepEqual(manifest.consumes.map((c) => c.topic), ["live.event"]);
  assert.ok(manifest.permissions.includes("topics"));
  assert.ok(!manifest.requires, "aucune dépendance forte");
  const s = manifest.settings.find((x) => x.key === "youtubeText");
  assert.equal(s.type, "boolean"); assert.equal(s.default, false); assert.ok(!s.advanced);
  assert.deepEqual(manifest.settings.map((x) => x.key), ["pushToken", "youtubeText", "visual", "accentColor", "durationSeconds"]);
  const fr = readJson("locales/fr.json"), en = readJson("locales/en.json");
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  const src = fs.readFileSync(`${DIR}/index.mjs`, "utf8");
  for (const m of src.matchAll(/\bt\("([A-Za-z0-9_]+)"/g)) assert.ok(m[1] in en && m[1] in fr, m[1]);
  for (const k of ["kind_superchat", "kind_supersticker", "kind_member", "kind_gift", "ytTitle", "ytHelp", "ytTestTitle", "ytAbsent"]) assert.ok(fr[k] && en[k], k);
  for (const m of src.matchAll(/ctx\.setting\("([A-Za-z0-9_]+)"\)/g)) assert.ok(manifest.settings.some((x) => x.key === m[1]), m[1]);
});

test("sans « Actions du live YouTube » : la page de l'overlay est celle d'avant (aucune lecture du sujet, aucun appel, mêmes libellés) et l'administration le dit en une phrase", async () => {
  const o = overlay({ provider: false });
  const out = await def.overlay(o.ctx);
  assert.ok(!/pullUrl|queued|fetch\(/.test(out.script));
  const cfg = JSON.parse(/var c=(\{.*?\}),stage/s.exec(out.script)[1]);
  assert.deepEqual(Object.keys(cfg.labels), ["follow", "sub", "raid", "test", "alert"]);
  assert.deepEqual(Object.keys(cfg).sort(), ["duration", "eventsUrl", "labels", "neon"]);
  const blocks = await def.adminPanel(o.ctx);
  assert.ok(blocks.some((b) => b.type === "markdown" && /installez le module « Actions du live YouTube »/.test(b.text)));
  assert.ok(!blocks.some((b) => b.type === "adminForm" && b.action === "testYoutube"));
  o.off();
});

test("avec « Actions du live YouTube » : la page vient chercher les alertes toutes les 5 s (jamais en arrière-plan côté serveur), file de 50, textContent partout", async () => {
  const o = overlay();
  const out = await def.overlay(o.ctx);
  const cfg = JSON.parse(/var c=(\{.*?\}),stage/s.exec(out.script)[1]);
  assert.equal(cfg.pullUrl, `/m/${o.key}/pull`); assert.equal(cfg.pullMs, 5000); assert.equal(cfg.queueMax, 50);
  assert.deepEqual(Object.keys(cfg.labels).slice(5), ["superchat", "supersticker", "member", "gift"]);
  assert.ok(!/innerHTML|insertAdjacentHTML|document\.write|eval\(/.test(out.script));
  assert.match(out.script, /m\.textContent=e\.message/); assert.match(out.script, /d\.textContent=e\.detail/);
  assert.ok(!/setInterval/.test(out.script), "pas de minuteur qui tourne sans fin : chaque lecture programme la suivante après sa réponse");
  const blocks = await def.adminPanel(o.ctx);
  assert.ok(blocks.some((b) => b.type === "adminForm" && b.action === "testYoutube"));
  assert.ok(blocks.some((b) => b.type === "markdown" && /pendant que sa page « En direct » est ouverte/.test(b.text)));
  o.off();
});

test("un Super Chat : titre « Super Chat », « pseudo · montant » dans la monnaie du site, aucun texte par défaut", async () => {
  const o = overlay({ items: [item({ text: "Bravo <b>super</b>" })] });
  assert.deepEqual(await pull(o), { sent: 1 });
  assert.equal(o.got.length, 1);
  assert.deepEqual(o.got[0], { kind: "superchat", message: "Léa · 5,00 €".replace(" €", " €"), queued: true });
  assert.ok(!JSON.stringify(o.got).includes("Bravo"), "texte masqué par défaut");
  o.off();
});

test("réglage « afficher le texte » : le texte s'affiche, borné à 140, en texte brut (aucune balise interprétée : l'overlay utilise textContent)", async () => {
  const o = overlay({ settings: { youtubeText: true }, items: [item({ text: `<img src=x onerror=alert(1)> ${"é".repeat(300)}` })] });
  await pull(o);
  assert.equal(o.got.length, 1);
  assert.ok(o.got[0].detail.length <= 140);
  assert.ok(o.got[0].detail.startsWith("<img src=x"), "livré tel quel, affiché en texte");
  assert.ok(o.got[0].message.length <= 200);
  const off = overlay({ settings: { youtubeText: false }, items: [item({ text: "secret" })] });
  await pull(off);
  assert.ok(!("detail" in off.got[0]));
  o.off(); off.off();
});

test("Super Sticker, adhésion et cadeau : libellés et formes ; pseudo borné à 40, caractères de contrôle et de sens d'écriture retirés", async () => {
  const o = overlay({ items: [
    item({ id: "a", kind: "supersticker", amount: 2, currency: "USD", who: "Max" }),
    item({ id: "b", kind: "member", who: `Nina‮\u0007${"x".repeat(100)}`, amount: undefined, currency: undefined }),
    item({ id: "c", kind: "gift", count: 5, who: "Zoé", amount: undefined, currency: undefined }),
  ] });
  await pull(o);
  assert.equal(o.got.length, 3);
  const by = Object.fromEntries(o.got.map((e) => [e.kind, e]));
  assert.match(by.supersticker.message, /^Max · .*2/);
  assert.ok(by.member.message.length <= 40 && !/[‮\u0007]/.test(by.member.message) && by.member.message.startsWith("Nina"));
  assert.equal(by.gift.message, "Zoé · ×5");
  o.off();
});

test("jamais de montant sans devise : un don sans devise, avec une devise fausse ou un montant faux est écarté ; types inconnus et formes bizarres aussi", async () => {
  const bad = [item({ id: "1", currency: undefined }), item({ id: "2", currency: "eur" }), item({ id: "3", currency: "EURO" }), item({ id: "4", amount: "5" }), item({ id: "5", amount: NaN }),
    item({ id: "6", kind: "command" }), item({ id: "7", kind: "gift", count: 0 }), item({ id: "8", kind: "gift", count: 99999 }), item({ id: "9", kind: "gift", count: 2.5 }), null, "x", 42, { id: "10" }, item({ id: "11", at: "pas une date" }), item({ id: "" }), item({ id: "z".repeat(200) })];
  const o = overlay({ items: bad });
  assert.deepEqual(await pull(o), { sent: 0 });
  assert.equal(o.got.length, 0);
  o.off();
});

test("idempotence : la même alerte n'est affichée qu'une fois, même relue ; des alertes en retard ou trop vieilles (OBS rouvert, serveur redémarré) ne sont pas rejouées", async () => {
  const live = item({ id: "same" });
  const old = item({ id: "old", at: new Date(Date.now() - 10 * 60_000).toISOString() });
  const future = item({ id: "fut", at: new Date(Date.now() + 3_600_000).toISOString() });
  const o = overlay({ items: [live, old, future] });
  await pull(o);
  assert.equal(o.got.length, 1);
  await pull(o, Date.now() + 5000); await pull(o, Date.now() + 10_000);
  assert.equal(o.got.length, 1, "jamais deux fois");
  const o2 = overlay({ collect: () => [live, old] });
  await pull(o2);
  assert.equal(o2.got.length, 1, "un autre overlay a sa propre mémoire");
  o.off(); o2.off();
});

test("rythme : au plus une lecture toutes les 2 secondes par overlay (le sujet n'est pas relu en boucle), les plus anciennes d'abord, 20 par lecture au plus", async () => {
  let reads = 0;
  const now = Date.now();
  const many = Array.from({ length: 50 }, (_, i) => item({ id: `m${i}`, who: `V${i}`, at: new Date(now - (50 - i) * 1000).toISOString() }));
  const o = overlay({ collect: () => { reads++; return many; } });
  const r = await pull(o, now);
  assert.equal(r.sent, 20); assert.equal(reads, 1);
  assert.equal(o.got[0].message.slice(0, 3), "V30"); assert.equal(o.got[19].message.slice(0, 3), "V49", "ordre chronologique, les 20 dernières");
  for (let i = 0; i < 19; i++) assert.deepEqual(await pull(o, now + 100 * i), { sent: 0, throttled: true });
  assert.equal(reads, 1);
  await pull(o, now + 2100);
  assert.equal(reads, 2);
  o.off();
});

test("source en panne ou qui répond n'importe quoi : aucune exception, rien d'affiché ; la route répond toujours", async () => {
  for (const collect of [() => { throw new Error("boom"); }, async () => { throw new Error("boom"); }, () => null, () => "x", () => ({}), () => [[], [[]]]]) {
    const o = overlay({ collect });
    assert.deepEqual(await pull(o), { sent: 0 });
    const r = await def.routes.pull(new Request("https://x.test/m/k/pull"), overlay({ collect }).ctx);
    assert.equal(r.status, 200);
    o.off();
  }
});

test("route pull : GET seulement, réponse minimale, jamais mise en cache", async () => {
  const o = overlay({ items: [item()] });
  assert.equal((await def.routes.pull(new Request("https://x.test/p", { method: "POST" }), o.ctx)).status, 405);
  const r = await def.routes.pull(new Request("https://x.test/p"), o.ctx);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.deepEqual(await r.json(), { ok: true, sent: 1 });
  o.off();
});

test("test d'administration « faux Super Chat » : même mise en forme qu'un vrai, texte seulement si le réglage est coché", async () => {
  const a = overlay({ locale: "en" });
  assert.equal((await def.adminActions.testYoutube(a.ctx)).ok, "Test alert sent.");
  assert.equal(a.got[0].kind, "superchat"); assert.match(a.got[0].message, /Lea · \$5\.00/); assert.ok(!("detail" in a.got[0]));
  const b = overlay({ settings: { youtubeText: true }, locale: "fr" });
  await def.adminActions.testYoutube(b.ctx);
  assert.equal(b.got[0].detail, "Bravo pour le live !");
  a.off(); b.off();
});

test("push d'avant : inchangé (même types, même nettoyage, même réponse) et ne peut pas fabriquer une alerte YouTube", async () => {
  const o = overlay({ settings: { pushToken: "secret" } });
  const req = (b) => new Request("https://x.test/push", { method: "POST", headers: { Authorization: "Bearer secret", "Content-Type": "application/json" }, body: JSON.stringify(b) });
  const r = await def.routes.push(req({ kind: "superchat", message: "faux gros don", username: "bob" }), o.ctx);
  assert.equal(r.status, 200);
  assert.deepEqual(o.got, [{ kind: "alert", message: "faux gros don", username: "bob" }], "un type YouTube poussé devient une alerte ordinaire");
  o.off();
});

test("de bout en bout : un vrai Super Chat lu par Actions du live YouTube arrive sur l'overlay, une seule fois, texte masqué puis affiché selon le réglage", async () => {
  EV.resetEvents();
  const w = await world();
  w.yt.goLive();
  w.yt.say(w.yt.superChat({ who: "Léa", micros: 5_000_000, currency: "EUR", at: Date.now(), comment: "Bravo", id: "e2e-1" }), w.yt.member({ who: "Nina", at: Date.now() }), w.yt.gift({ who: "Zoé", count: 3, at: Date.now() }));
  await w.read();
  const topics = { "live.event": (a) => ytDef.exports["live.event"](w.ctx, a).map((e) => ({ ...e, source: { instance: "yt", module: "youtube-live-actions", name: "Actions" } })) };
  const key = `e2e${++n}`;
  const got = []; const on = (e) => got.push(e); bus.on(key, on);
  const ctx = fakeCtx({ key, locale: "fr", messages: readJson("locales/fr.json"), settings: {}, instances: [{ id: "i", key: "yt", module: "youtube-live-actions", basePath: "", name: "A", adminPath: "/a" }], topics });
  assert.equal((await mod.pullLive(ctx)).sent, 3);
  assert.deepEqual(got.map((e) => e.kind).sort(), ["gift", "member", "superchat"]);
  assert.ok(!JSON.stringify(got).includes("Bravo"));
  assert.equal((await mod.pullLive(ctx, Date.now() + 5000)).sent, 0, "relu : rien de nouveau");
  w.yt.say(w.yt.superChat({ who: "Max", micros: 10_000_000, currency: "USD", at: Date.now(), comment: "Encore", id: "e2e-2" }));
  await w.read(20_000);
  assert.equal((await mod.pullLive(ctx, Date.now() + 5000)).sent, 1);
  assert.match(got.at(-1).message, /^Max · /);
  bus.off(key, on); w.done();
});
