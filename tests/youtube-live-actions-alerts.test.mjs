// Actions du live YouTube 1.1 : le sujet `live.event` (dons et adhésions vus dans le chat, pour l'overlay d'alertes) et la lecture « alertes seulement » sans Home Assistant.
import test from "node:test";
import assert from "node:assert/strict";
import { world, def, E, B, manifest } from "./helpers/ytLiveWorld.mjs";

const EV = await import("../modules/youtube-live-actions/events.mjs");
const sc = (w, o = {}) => w.yt.superChat({ who: "Léa", micros: 5_000_000, currency: "EUR", at: Date.now(), ...o });
const events = (w, args = {}) => def.exports["live.event"](w.ctx, args);
const fresh = () => EV.resetEvents();

test("manifeste : fournit live.event (rien de plus à consommer), deux réglages simples, version mineure", () => {
  assert.equal(manifest.version, "1.1.1");
  assert.deepEqual(manifest.provides.map((p) => p.topic), ["live.event"]);
  assert.ok(manifest.provides[0].label.fr && manifest.provides[0].label.en);
  const set = Object.fromEntries(manifest.settings.map((s) => [s.key, s]));
  assert.equal(set.shareAlerts.default, true); assert.equal(set.readWithoutHouse.default, false);
  assert.ok(!set.shareAlerts.advanced);
  assert.match(manifest.privacy.fr, /15 minutes/); assert.match(manifest.privacy.en, /15 minutes/);
  assert.ok(manifest.permissions.includes("topics"));
  assert.equal(typeof def.exports["live.event"], "function");
});

test("un Super Chat, un Super Sticker, une adhésion et un cadeau sont publiés : forme exacte, montant AVEC devise, id = empreinte (jamais l'identifiant YouTube)", async () => {
  fresh();
  const w = await world();
  w.yt.goLive();
  const msgs = [sc(w, { comment: "Bravo pour le live", id: "RAWID-superchat-1" }), w.yt.superSticker({ who: "Max", micros: 2_000_000, currency: "USD", at: Date.now() }), w.yt.member({ who: "Nina", at: Date.now() }), w.yt.gift({ who: "Zoé", count: 5, at: Date.now() })];
  w.yt.say(...msgs);
  await w.read();
  const list = await events(w);
  assert.equal(list.length, 4);
  const byKind = Object.fromEntries(list.map((e) => [e.kind, e]));
  assert.deepEqual(Object.keys(byKind).sort(), ["gift", "member", "superchat", "supersticker"]);
  assert.equal(byKind.superchat.who, "Léa"); assert.equal(byKind.superchat.amount, 5); assert.equal(byKind.superchat.currency, "EUR"); assert.equal(byKind.superchat.text, "Bravo pour le live");
  assert.equal(byKind.supersticker.amount, 2); assert.equal(byKind.supersticker.currency, "USD"); assert.ok(!("text" in byKind.supersticker));
  assert.equal(byKind.member.who, "Nina"); assert.ok(!("amount" in byKind.member) && !("currency" in byKind.member));
  assert.equal(byKind.gift.count, 5);
  for (const e of list) {
    assert.equal(e.platform, "youtube"); assert.match(e.id, /^yt-[0-9a-f]{12}$/); assert.ok(!Number.isNaN(Date.parse(e.at)));
    assert.equal("amount" in e, "currency" in e, "jamais de montant sans devise");
    assert.ok(!JSON.stringify(e).includes("RAWID"));
  }
  assert.ok(!w.dump().includes("Bravo pour le live"), "le texte n'est écrit nulle part dans les données du module (disque)");
  assert.ok(!JSON.stringify(await w.journal()).includes("Bravo pour le live"));
  w.done();
});

test("les dons sont publiés même si aucune règle ne les attend, et pas deux fois quand le chat est relu", async () => {
  fresh();
  const w = await world();                               // aucune règle
  w.yt.goLive(); w.yt.say(sc(w, { id: "same-1" }));
  await w.read();
  assert.equal((await events(w)).length, 1);
  assert.equal((await w.journal())[0].status, "skipped");
  w.yt.say({ ...sc(w, { id: "same-1" }) });             // le même message revient
  await w.read(20_000);
  assert.equal((await events(w)).length, 1);
  w.done();
});

test("rien ne vient du test : la simulation n'envoie aucune alerte", async () => {
  fresh();
  const w = await world();
  const r = await E.simulate(w.ctx, { type: "superchat", amount: "5", currency: "EUR" });
  assert.equal(r.ok, true);
  assert.deepEqual(await events(w), []);
  w.done();
});

test("bornes : 50 au plus (les plus récents d'abord), 15 minutes de vie, purgé à la lecture, limit respectée, aucun minuteur", async () => {
  fresh();
  const w = await world();
  const ctx = w.ctx;
  for (let i = 0; i < 120; i++) EV.remember(ctx, { kind: "member", who: `V${i}`, at: Date.now() }, `fp${String(i).padStart(10, "0")}`, Date.now() + i);
  const all = EV.recent(ctx, { now: Date.now() + 200 });
  assert.equal(all.length, 50);
  assert.equal(all[0].who, "V119"); assert.equal(all[49].who, "V70");
  assert.equal(EV.recent(ctx, { limit: 3, now: Date.now() + 200 }).length, 3);
  assert.equal(EV.recent(ctx, { limit: 9999, now: Date.now() + 200 }).length, 50);
  assert.equal(EV.recent(ctx, { limit: -4, now: Date.now() + 200 }).length, 50);
  assert.equal(EV.recent(ctx, { now: Date.now() + EV.LIMITS.ttlMs + 1000 }).length, 0, "tout a expiré");
  assert.equal(EV.recent(ctx, { now: Date.now() }).length, 0, "et la file a été vidée à la lecture");
  w.done();
});

test("deux instances (clés) ne se mélangent pas ; au plus 20 files en mémoire", async () => {
  fresh();
  const a = { instance: { key: "a" } }, b = { instance: { key: "b" } };
  EV.remember(a, { kind: "member", who: "A", at: Date.now() }, "aaaaaaaaaaaa");
  EV.remember(b, { kind: "member", who: "B", at: Date.now() }, "bbbbbbbbbbbb");
  assert.deepEqual(EV.recent(a).map((e) => e.who), ["A"]); assert.deepEqual(EV.recent(b).map((e) => e.who), ["B"]);
  for (let i = 0; i < 40; i++) EV.remember({ instance: { key: `k${i}` } }, { kind: "member", who: "x", at: Date.now() }, `fp${String(i).padStart(10, "0")}`);
  assert.ok([...Array(40).keys()].filter((i) => EV.recent({ instance: { key: `k${i}` } }).length).length <= EV.LIMITS.instances);
});

test("jamais de montant sans devise, ni de devise bizarre, ni de nombre invalide : l'évènement est écarté", () => {
  const ctx = { instance: { key: "x" } };
  fresh();
  for (const ev of [{ kind: "superchat", micros: 5e6, currency: "", who: "a", at: 1 }, { kind: "superchat", micros: 5e6, currency: "eur", who: "a", at: 1 }, { kind: "superchat", micros: 5e6, currency: "EURO", who: "a", at: 1 }, { kind: "superchat", micros: NaN, currency: "EUR", who: "a", at: 1 }, { kind: "supersticker", micros: -1, currency: "EUR", who: "a", at: 1 }, { kind: "gift", count: 0, who: "a", at: 1 }, { kind: "gift", count: 1.5, who: "a", at: 1 }, { kind: "command", who: "a" }, { kind: "invalid", who: "a" }, null, undefined, "x"]) {
    assert.equal(EV.remember(ctx, ev, "abcdefabcdef"), false, JSON.stringify(ev));
  }
  assert.deepEqual(EV.recent(ctx), []);
});

test("réglage « laisser l'overlay afficher les dons » décoché : rien n'est gardé ni publié", async () => {
  fresh();
  const w = await world({ settings: { shareAlerts: false } });
  w.yt.goLive(); w.yt.say(sc(w));
  await w.read();
  assert.deepEqual(await events(w), []);
  const w2 = await world();
  w2.yt.goLive(); w2.yt.say(sc(w2, { id: "x-2" }));
  await w2.read();
  assert.equal((await events(w2)).length, 1);
  w2.ctx.setting = ((orig) => (k) => (k === "shareAlerts" ? false : orig(k)))(w2.ctx.setting);
  assert.deepEqual(await events(w2), [], "décoché après coup : plus rien n'est donné");
  w.done(); w2.done();
});

test("un don trop ancien (page rouverte) n'est pas publié, comme il n'est pas rejoué", async () => {
  fresh();
  const w = await world();
  w.yt.goLive(); w.yt.say(sc(w, { at: Date.now() - 10 * 60_000 }));
  await w.read();
  assert.deepEqual(await events(w), []);
  w.done();
});

test("sans Home Assistant : par défaut le chat n'est PAS lu (comme avant) ; avec « alertes seulement » il est lu, les dons sont publiés et notés « rien à jouer »", async () => {
  fresh();
  const w = await world({ noBridge: true });
  w.yt.goLive(); w.yt.say(sc(w));
  let st = await w.read();
  assert.equal(st.status, "no_bridge");
  assert.equal(w.yt.calls.chat.length, 0, "aucune lecture, aucune dépense de limite");
  assert.deepEqual(await events(w), []);
  w.done();
  const o = await world({ noBridge: true, settings: { readWithoutHouse: true } });
  o.yt.goLive(); o.yt.say(sc(o, { comment: "salut" }));
  st = await o.read();
  assert.equal(st.status, "reading");
  const list = await events(o);
  assert.equal(list.length, 1); assert.equal(list[0].text, "salut");
  const [line] = await o.journal();
  assert.equal(line.status, "skipped"); assert.equal(line.reason, "alert_only");
  assert.ok(!JSON.stringify(line).includes("salut"));
  const html = JSON.stringify(await o.panel());
  assert.match(html, /Affiché en alerte seulement/);
  o.done();
});

test("avec Home Assistant, le comportement d'avant est inchangé : la règle joue ET le don est publié", async () => {
  fresh();
  const w = await world();
  const { default: R } = { default: await import("./helpers/ytLiveWorld.mjs") };
  const rule = R.R.validateRule({ name: "Rouge", type: "superchat", currency: "EUR", min: "5", cooldownSec: "30", action: "lumieres:rouge" });
  await R.S.saveRule(w.ctx, null, { ...rule.rule, lastAt: 0 });
  w.yt.goLive(); w.yt.say(sc(w));
  await w.read(); await w.ha.step();
  assert.equal(w.ha.executed.length, 1);
  assert.equal((await events(w)).length, 1);
  w.done();
});

test("la lecture du chat dans le sujet : le texte est nettoyé (contrôles, balises gardées telles quelles comme TEXTE, 300 caractères)", async () => {
  fresh();
  const w = await world();
  w.yt.goLive();
  w.yt.say(sc(w, { id: "t-1", comment: `<img src=x onerror=alert(1)>\u0007 ${"é".repeat(400)}` }));
  await w.read();
  const [e] = await events(w);
  assert.ok(e.text.length <= 300);
  assert.ok(!/[\u0000-\u001f]/.test(e.text));
  assert.ok(e.text.startsWith("<img"), "le texte brut est livré tel quel : c'est à l'affichage de l'échapper (l'overlay utilise textContent)");
  w.done();
});
