import test from "node:test";
import assert from "node:assert/strict";
import { audienceCtx, bind, def, fr, en, L, K, C, R, req, tok } from "./helpers/audienceHarness.mjs";

const BASE = "https://x.test/m/audience";
const route = (name, ctx, request) => def.routes[name](request, ctx);
const meta = async (c) => (await c.api.store.list("meta")).find((r) => r.data.k === "cfg").data;
const providers = (methods, name = "polls") => ({ "audience.remote": [{ instance: name, name: "Sondages", methods }] });

/* ───────────── Scripts ───────────── */

test("scripts : servis en GET seulement, mis en cache, contenu sûr", async () => {
  const c = audienceCtx();
  for (const [name, js] of [["client", C.CLIENT_JS], ["direct.js", C.DIRECT_JS]]) {
    const r = await route(name, c, req(`${BASE}/${name}`));
    assert.equal(r.headers.get("content-type"), "text/javascript; charset=utf-8"); assert.match(r.headers.get("cache-control"), /max-age/); assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.equal(await r.text(), js);
    assert.equal((await route(name, c, req(`${BASE}/${name}`, "x"))).status, 405);
  }
  const head = await def.slots["layout.head"](c);
  assert.ok(head[0].tags[0].src.startsWith(`/m/${c.instance.key}/client`) && head[0].tags[0].defer);
  assert.ok(/aud-id/.test(C.CLIENT_JS) && /vp-id/.test(C.CLIENT_JS), "reprend le code des sondages d'avant : on ne revote pas");
});

/* ───────────── Pseudo, « qui suis-je », oubli ───────────── */

test("pseudo : choisir, retrouver, changer ; erreurs claires avec le bon code ; pris, interdit, trop court ; salle générale créée à la demande", async () => {
  const c = audienceCtx();
  const pseudo = (body, ip) => route("pseudo", c, req(`${BASE}/pseudo`, body, { ip }));
  let r = await pseudo({ room: "general", t: tok(1), name: "  Lune   Rousse " });
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true, participant: { pseudo: "Lune Rousse", muted: false } });
  r = await route("me", c, req(`${BASE}/me`, { room: "general", t: tok(1) }));
  assert.deepEqual(await r.json(), { ok: true, participant: { pseudo: "Lune Rousse", muted: false } });
  r = await route("me", c, req(`${BASE}/me`, { room: "general", t: tok(2) }));
  assert.deepEqual(await r.json(), { ok: true, participant: null }, "inconnu : null, jamais une erreur");
  for (const [name, code, status] of [["lune rousse", "pseudo_taken", 409], ["ab", "pseudo_short", 400], ["x".repeat(40), "pseudo_long", 400], ["a<b>c", "pseudo_chars", 400], ["fuck-off", "pseudo_banned", 400], ["Admin", "pseudo_banned", 400]]) {
    r = await pseudo({ room: "general", t: tok(2), name }, "1.1.1.1");
    assert.deepEqual([r.status, (await r.json()).error], [status, code], name);
  }
  r = await pseudo({ room: "inconnue", t: tok(2), name: "Bon Nom" }, "1.1.1.1");
  assert.deepEqual([r.status, (await r.json()).error], [404, "unknown_room"], "on ne crée pas de salle à la demande d'un visiteur");
  assert.equal((await pseudo({ room: "general", t: "court", name: "Bon Nom" })).status, 400);
  assert.equal((await pseudo({ room: "General!", t: tok(2), name: "Bon Nom" })).status, 400);
  assert.equal((await pseudo({ room: "general", t: tok(2), name: 42 })).status, 400);
  r = await pseudo({ room: "general", t: tok(1), name: "Nouveau Nom" });
  assert.equal(r.status, 200, "la même personne change de pseudo");
  r = await pseudo({ room: "general", t: tok(2), name: "Lune Rousse" }, "1.1.1.1");
  assert.equal(r.status, 200, "l'ancien est libre");
});

test("pseudo : piège à robots, méthodes, tailles, JSON illisible ; rien n'est écrit dans ces cas", async () => {
  const c = audienceCtx(); await route("pseudo", c, req(`${BASE}/pseudo`, { room: "general", t: tok(9), name: "Premier" }));
  const w = c.api.store.writes.length;
  const trap = await route("pseudo", c, req(`${BASE}/pseudo`, { room: "general", t: tok(1), name: "Robot Un", website: "http://spam" }));
  assert.equal(trap.status, 200); assert.equal(c.api.store.writes.length, w, "le piège fait semblant, rien n'est enregistré");
  for (const name of ["pseudo", "me", "forget"]) {
    assert.equal((await route(name, c, req(`${BASE}/${name}`, undefined))).status, 405, name);
    assert.equal((await route(name, c, req(`${BASE}/${name}`, "x".repeat(5000)))).status, 413, name);
    assert.equal((await route(name, c, req(`${BASE}/${name}`, "{pas du json"))).status, 400, name);
    assert.equal((await route(name, c, req(`${BASE}/${name}`, "[1,2]"))).status, 400, name);
  }
  assert.equal(c.api.store.writes.length, w);
});

test("pseudo : limité par connexion (30 par heure) et pour tout le site ; l'adresse n'est jamais gardée", async () => {
  const c = audienceCtx();
  const codes = [];
  for (let i = 1; i <= 34; i++) codes.push((await route("pseudo", c, req(`${BASE}/pseudo`, { room: "general", t: tok(i), name: `Perso ${String(i).padStart(3, "0")}` }, { ip: "198.51.100.9" }))).status);
  assert.equal(codes.filter((x) => x === 200).length, 30); assert.equal(codes.filter((x) => x === 429).length, 4);
  const r = await route("pseudo", c, req(`${BASE}/pseudo`, { room: "general", t: tok(99), name: "Autre Ip" }, { ip: "198.51.100.10" }));
  assert.equal(r.status, 200, "une autre connexion n'est pas touchée");
  assert.ok(!JSON.stringify(c.api.store.all()).includes("198.51.100"), "aucune adresse dans les données");
  assert.equal((await route("pseudo", c, req(`${BASE}/pseudo`, { room: "general", t: tok(98), name: "Trop Vite" }, { ip: "198.51.100.9" }))).headers.get("retry-after"), "60");
});

test("oubli : la personne efface tout, partout ; limité ; le pseudo est libéré", async () => {
  const c = audienceCtx(); const s = bind(c);
  await route("pseudo", c, req(`${BASE}/pseudo`, { room: "general", t: tok(1), name: "A Oublier" }));
  await s.join({ room: "autre-salle", token: tok(1) });
  const r = await route("forget", c, req(`${BASE}/forget`, { t: tok(1) }));
  assert.deepEqual(await r.json(), { ok: true, removed: 2 });
  assert.equal((await s.who({ room: "autre-salle", token: tok(1) })).participant, null);
  assert.equal((await route("pseudo", c, req(`${BASE}/pseudo`, { room: "general", t: tok(2), name: "A Oublier" }))).status, 200);
  assert.equal((await route("forget", c, req(`${BASE}/forget`, { t: "court" }))).status, 400);
  const codes = []; for (let i = 0; i < 12; i++) codes.push((await route("forget", c, req(`${BASE}/forget`, { t: tok(5) }, { ip: "7.7.7.7" }))).status);
  assert.equal(codes.filter((x) => x === 429).length, 2);
});

test("page publique : formulaire avec erreurs sous le champ, aide avec des exemples, textes en français et en anglais, rien d'injectable", async () => {
  for (const [locale, msgs] of [["fr", fr], ["en", en]]) {
    const c = audienceCtx({ locale, messages: msgs });
    const p = await def.page(c, { segments: [] });
    const html = p.blocks[0].html;
    assert.equal(p.title, msgs.pageTitle);
    assert.ok(html.includes("data-aud-err") && html.includes('role="alert"') && html.includes("aria-describedby"));
    assert.ok(html.includes(msgs.pseudoHelp.replace("{min}", "3").replace("{max}", "20")));
    for (const code of ["pseudo_taken", "pseudo_banned", "net"]) assert.ok(html.includes(`data-m-${code}="`), code);
    assert.ok(html.includes("data-aud-forget") && html.includes('name="website"') && html.includes("<noscript>"));
    assert.ok(html.includes(`data-room="general"`) && html.includes(`data-api="/m/${c.instance.key}"`));
  }
  const c = audienceCtx({ locale: "fr" });
  assert.deepEqual(await def.page(c, { segments: ["x"] }), { notFound: true, blocks: [] });
  await def.page(c, { segments: [] });
  assert.ok(await K.getRoom(c, K.GENERAL), "la salle générale existe après avoir ouvert la page");
});

/* ───────────── Direct ───────────── */

test("direct : canal public lisible par tous, canal privé seulement avec la clé ; réponses minuscules quand rien ne change ; jamais d'écriture ; méthodes et paramètres contrôlés", async () => {
  const c = audienceCtx(); const s = bind(c);
  await s.livePublish({ room: "r", channel: "now", data: { q: "Quoi ?" }, public: true });
  await s.livePublish({ room: "r", channel: "screen", data: { secret: 1 }, readKey: "cle-secrete-ecran" });
  const get = (qs, ip) => route("direct", c, req(`${BASE}/direct?${qs}`, undefined, { ip }));
  let r = await get("room=r&channel=now");
  assert.equal(r.headers.get("cache-control"), "no-store");
  const first = await r.json();
  assert.deepEqual([first.ok, first.data, typeof first.next], [true, { q: "Quoi ?" }, "number"]); assert.ok(first.next >= 3000);
  const same = await (await get(`room=r&channel=now&rev=${first.rev}`)).json();
  assert.deepEqual([same.unchanged, same.data], [true, undefined], "inchangé : pas de données");
  assert.equal((await (await get("room=r&channel=screen")).json()).empty, true);
  assert.equal((await (await get("room=r&channel=screen&k=mauvaise-cle-xx")).json()).empty, true);
  assert.deepEqual((await (await get("room=r&channel=screen&k=cle-secrete-ecran")).json()).data, { secret: 1 });
  assert.equal((await (await get("room=r&channel=jamais")).json()).empty, true);
  assert.equal((await get("room=Bad%20Room&channel=now")).status, 400); assert.equal((await get("room=r&channel=BAD")).status, 400); assert.equal((await get("")).status, 400);
  assert.equal((await route("direct", c, req(`${BASE}/direct`, "x"))).status, 405);
  assert.ok(!JSON.stringify(await (await get("room=r&channel=screen")).json()).includes("cle-secrete"), "jamais de clé dans une réponse");
  const w = c.api.store.writes.length; for (let i = 0; i < 5; i++) await get("room=r&channel=now");
  assert.equal(c.api.store.writes.length, w, "lire n'écrit jamais");
});

test("direct : limité par connexion (90 par minute), le conseil d'espacement grandit avec l'affluence", async () => {
  const c = audienceCtx(); const s = bind(c);
  await s.livePublish({ room: "r", channel: "now", data: 1, public: true });
  const codes = []; for (let i = 0; i < 95; i++) codes.push((await route("direct", c, req(`${BASE}/direct?room=r&channel=now`, undefined, { ip: "5.5.5.5" }))).status);
  assert.equal(codes.filter((x) => x === 200).length, 90); assert.equal(codes.filter((x) => x === 429).length, 5);
  const hints = [];
  for (let i = 0; i < 260; i++) { const r = await route("direct", c, req(`${BASE}/direct?room=r&channel=now`, undefined, { ip: `10.9.${i}.1` })); hints.push((await r.json()).next); }
  assert.ok(hints.at(-1) > hints[0], "plus de monde : on demande d'espacer"); assert.ok(Math.max(...hints) <= 30_000);
  assert.equal(K.cfgOf(audienceCtx({ settings: { directSeconds: 99 } })).directMin, 30_000); assert.equal(K.cfgOf(audienceCtx({ settings: { directSeconds: 0 } })).directMin, 2_000);
});

test("direct : un état périmé fait avancer le module qui l'alimente (une seule fois, même avec 30 lecteurs), puis la lecture suivante est à jour", async () => {
  const ticks = [];
  let owner = null;
  const c = audienceCtx({ serviceInstances: providers({ tick: async (a) => { ticks.push(a); await owner.livePublish({ room: "r", channel: "screen", data: { fresh: true }, public: true, refreshAt: new Date(Date.now() + 60_000).toISOString() }); return { ok: true, handled: true }; } }) });
  owner = bind(c);
  await owner.livePublish({ room: "r", channel: "screen", data: { fresh: false }, public: true, refreshAt: new Date(Date.now() - 1000).toISOString() });
  const reads = await Promise.all(Array.from({ length: 30 }, (_, i) => route("direct", c, req(`${BASE}/direct?room=r&channel=screen`, undefined, { ip: `10.8.${i}.1` })).then((r) => r.json())));
  assert.equal(ticks.length, 1, "un seul rafraîchissement, partagé");
  assert.deepEqual(ticks[0], { room: "r", channel: "screen" });
  assert.ok(reads.every((x) => x.data.fresh === true), "tous lisent l'état rafraîchi");
  const again = await (await route("direct", c, req(`${BASE}/direct?room=r&channel=screen&rev=${reads[0].rev}`, undefined, { ip: "10.8.200.1" }))).json();
  assert.equal(again.unchanged, true); assert.equal(ticks.length, 1);
});

test("trou noir : un module branché qui ne répond jamais ne bloque ni le direct ni la télécommande (délai borné)", async () => {
  const never = () => new Promise(() => {});
  const c = audienceCtx({ serviceInstances: providers({ describe: never, press: never, tick: never }) });
  const t0 = Date.now();
  const out = await R.withTimeout(never(), 50, "late");
  assert.equal(out, "late"); assert.ok(Date.now() - t0 < 1000);
  assert.equal(await R.withTimeout(Promise.resolve(5), 1000, 0), 5); assert.equal(await R.withTimeout(Promise.reject(new Error("x")), 1000, "fallback"), "fallback");
  // le vrai délai est de 3 secondes pour décrire : on le vérifie avec une horloge simulée
  const { mock } = await import("node:test");
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
    const panels = R.collectPanels(c);
    await flush(); mock.timers.tick(3000);
    assert.deepEqual(await panels, [], "le module muet est simplement absent");
    const press = R.pressPanel(c, { panel: "id-polls", action: "start", values: {} });
    await flush(); mock.timers.tick(6000);
    assert.deepEqual(await press, { ok: false, error: "failed" });
  } finally { mock.timers.reset(); }
});

/* ───────────── Télécommande ───────────── */

test("télécommande : sans l'adresse secrète, rien n'existe (404) ; trop d'essais ratés = pause ; la bonne adresse n'est jamais freinée", async () => {
  const c = audienceCtx(); const key = (await (async () => { await K.ensureMeta(c); return meta(c); })()).remoteKey;
  assert.ok(key.length >= 20);
  for (const name of ["remote", "remote-state"]) {
    assert.equal((await route(name, c, req(`${BASE}/${name}`))).status, 404, name);
    assert.equal((await route(name, c, req(`${BASE}/${name}?k=pas-la-bonne-cle`))).status, 404, name);
  }
  assert.equal((await route("remote-press", c, req(`${BASE}/remote-press`, { k: "mauvaise", panel: "audience", action: "clear", values: { room: "general" } }))).status, 404);
  const statuses = []; for (let i = 0; i < 45; i++) statuses.push((await route("remote", c, req(`${BASE}/remote?k=essai${i}`, undefined, { ip: "6.6.6.6" }))).status);
  assert.equal(statuses.filter((x) => x === 429).length, 5, "40 essais ratés par heure, ensuite une pause");
  for (let i = 0; i < 60; i++) assert.equal((await route("remote", c, req(`${BASE}/remote?k=${key}`, undefined, { ip: "6.6.6.7" }))).status, 200, "la bonne adresse passe toujours");
  assert.equal((await route("remote", c, req(`${BASE}/remote?k=${key}`, "x"))).status, 405);
  assert.equal((await route("remote-state", c, req(`${BASE}/remote-state?k=${key}`, "x"))).status, 405);
  assert.equal((await route("remote-press", c, req(`${BASE}/remote-press?k=${key}`))).status, 405);
});

test("télécommande : page mobile, ne s'indexe pas, ne garde rien en cache ni dans l'historique des liens, tous les textes dans la langue, rien d'injecté dans le script", async () => {
  for (const [locale, msgs] of [["fr", fr], ["en", en]]) {
    const c = audienceCtx({ locale, messages: msgs, theme: { accent: "#e8a23b", accentFg: "#111111", bg: "#121214", surface: "#1b1b1d", fg: "#f4f4f5", muted: "#a1a1a3", line: "#2e2e30", danger: "#ff6b6b", dangerFg: "#111111", success: "#4ade80", font: "system-ui, sans-serif" } });
    await K.ensureMeta(c); const key = (await meta(c)).remoteKey;
    const r = await route("remote", c, req(`${BASE}/remote?k=${key}`));
    const html = await r.text();
    assert.equal(r.headers.get("content-type"), "text/html; charset=utf-8"); assert.equal(r.headers.get("cache-control"), "no-store"); assert.equal(r.headers.get("referrer-policy"), "no-referrer"); assert.match(r.headers.get("x-robots-tag"), /noindex/);
    assert.ok(html.startsWith("<!doctype html>") && html.includes(`<html lang="${locale}">`) && html.includes('name="viewport"') && html.includes('content="noindex,nofollow"'));
    assert.ok(html.includes(msgs.remoteTitle) && html.includes("min-height:76px"), "gros boutons (76 px)");
    assert.ok(/prefers-reduced-motion|transition/.test(html) === false || true);
    assert.ok(!html.includes("</script><script"), "le script de configuration ne peut pas être fermé de l'intérieur");
    assert.ok(html.includes(msgs.remoteConnecting) && html.includes("<noscript>"));
  }
  const c = audienceCtx({ messages: { ...fr, remoteTitle: "</script><img src=x onerror=alert(1)>" } });
  await K.ensureMeta(c);
  const html = await (await route("remote", c, req(`${BASE}/remote?k=${(await meta(c)).remoteKey}`))).text();
  assert.ok(!html.includes("<img src=x"), "un titre piégé est échappé");
  const cfg = JSON.parse(/window\.__AR=(\{.*?\});\(function/s.exec(html)[1].replace(/\\u003c/g, "<"));
  assert.equal(cfg.t.busy, fr.remoteBusy); assert.ok(!html.includes(cfg.k + "<"), "sanity"); assert.ok(html.includes(`k":"${cfg.k}"`));
});

test("télécommande : l'état montre les modules branchés (panneaux nettoyés) et les salles avec leurs dernières personnes", async () => {
  const describe = async () => ({ ok: true, panel: { title: "Sondages", state: { text: "Manche 1", tone: "live", until: new Date(Date.now() + 60_000).toISOString() }, buttons: [{ id: "start", label: "Lancer", tone: "primary" }, { id: "x y", label: "Piégé" }] } });
  const c = audienceCtx({ serviceInstances: providers({ describe }) }); const s = bind(c);
  await K.ensureMeta(c); const key = (await meta(c)).remoteKey;
  for (let i = 1; i <= 15; i++) await s.join({ room: "polls", token: tok(i), pseudo: i <= 14 ? `Perso ${String(i).padStart(2, "0")}` : undefined, conn: { forwarded: `10.3.${i}.1` } });
  const state = await (await route("remote-state", c, req(`${BASE}/remote-state?k=${key}`))).json();
  assert.equal(state.ok, true); assert.ok(Math.abs(state.now - Date.now()) < 5000);
  assert.equal(state.panels.length, 1); assert.equal(state.panels[0].id, "id-polls"); assert.equal(state.panels[0].buttons.length, 1, "bouton à l'identifiant invalide écarté");
  assert.equal(state.rooms[0].key, "polls"); assert.equal(state.rooms[0].count, 15); assert.equal(state.rooms[0].recent.length, 12, "12 pseudos au plus");
  assert.ok(state.rooms[0].recent.every((p) => p.pseudo), "ceux qui ont un pseudo d'abord");
  assert.ok(!JSON.stringify(state).includes(tok(1)), "aucun code dans l'état");
  // sans module branché : un panneau vide dit quoi faire (côté navigateur) et l'état reste valable
  const c2 = audienceCtx(); await K.ensureMeta(c2);
  assert.deepEqual((await (await route("remote-state", c2, req(`${BASE}/remote-state?k=${(await meta(c2)).remoteKey}`))).json()).panels, []);
});

test("télécommande : un appui est transmis au bon module (valeurs bornées), sa réponse est nettoyée, tout est dans le journal ; module inconnu ou muet = erreur claire", async () => {
  const seen = [];
  const press = async (a) => { seen.push(a); return a.action === "boom" ? { ok: false, error: "invalid", field: "a", message: "Écrivez le premier choix.", secret: "x" } : { ok: true, message: "Fait" + "!".repeat(500), extra: 1 }; };
  const c = audienceCtx({ serviceInstances: providers({ press }) });
  await K.ensureMeta(c); const key = (await meta(c)).remoteKey;
  const go = (body) => route("remote-press", c, req(`${BASE}/remote-press`, { k: key, ...body }));
  let r = await go({ panel: "id-polls", action: "start", values: { a: "x".repeat(500), "Bad Key": "1", n: 5 } });
  const ok = await r.json();
  assert.equal(r.status, 200); assert.equal(ok.ok, true); assert.equal(ok.message.length, 200); assert.equal(ok.extra, undefined);
  assert.equal(seen[0].action, "start"); assert.equal(seen[0].values.a.length, 200); assert.deepEqual(Object.keys(seen[0].values).sort(), ["a", "n"]);
  r = await go({ panel: "id-polls", action: "boom" });
  assert.deepEqual([r.status, await r.json()], [400, { ok: false, error: "invalid", message: "Écrivez le premier choix.", field: "a" }]);
  r = await go({ panel: "id-inconnu", action: "start" }); assert.deepEqual([r.status, (await r.json()).error], [404, "gone"]);
  r = await go({ panel: "id-polls", action: "Bad Action" }); assert.deepEqual([r.status, (await r.json()).error], [400, "invalid"]);
  assert.equal((await go({ panel: 42, action: "start" })).status, 400);
  const log = (await c.api.store.list("audit")).map((x) => x.data);
  assert.ok(log.some((l) => l.who === "remote" && l.what === "polls.start" && l.detail === "ok") && log.some((l) => l.what === "polls.boom" && l.detail === "invalid"));
  assert.ok(!JSON.stringify(log).includes(key), "l'adresse secrète n'est jamais dans le journal");
  const bad = audienceCtx({ serviceInstances: providers({ press: async () => { throw new Error("boom"); } }) });
  await K.ensureMeta(bad);
  const r2 = await route("remote-press", bad, req(`${BASE}/remote-press`, { k: (await meta(bad)).remoteKey, panel: "id-polls", action: "start" }));
  assert.deepEqual([r2.status, (await r2.json()).error], [400, "failed"]);
});

test("télécommande : sourdine et salle à vider depuis le téléphone ; limite d'appuis ; rien qui fuit", async () => {
  const c = audienceCtx(); const s = bind(c);
  await K.ensureMeta(c); const key = (await meta(c)).remoteKey;
  const me = (await s.join({ room: "polls", token: tok(1), pseudo: "Boute Feu" })).participant;
  await s.join({ room: "polls", token: tok(2), pseudo: "Calme Plat" });
  const go = (body, ip) => route("remote-press", c, req(`${BASE}/remote-press`, { k: key, panel: "audience", ...body }, { ip }));
  let r = await (await go({ action: "mute", values: { room: "polls", id: me.id, muted: "1" } })).json();
  assert.equal(r.ok, true); assert.match(r.message, /Boute Feu/);
  assert.equal((await s.who({ room: "polls", token: tok(1) })).participant.muted, true);
  const state = await (await route("remote-state", c, req(`${BASE}/remote-state?k=${key}`))).json();
  assert.equal(state.rooms[0].recent.find((p) => p.id === me.id).muted, true, "l'état reflète la sourdine tout de suite");
  r = await (await go({ action: "mute", values: { room: "polls", id: me.id, muted: "0" } })).json();
  assert.equal((await s.who({ room: "polls", token: tok(1) })).participant.muted, false);
  assert.equal((await go({ action: "mute", values: { room: "polls", id: "0".repeat(40), muted: "1" } })).status, 404);
  assert.equal((await go({ action: "mute", values: { room: "nope", id: me.id, muted: "1" } })).status, 404);
  r = await (await go({ action: "clear", values: { room: "polls" } })).json();
  assert.equal(r.ok, true); assert.match(r.message, /2/);
  assert.equal((await s.who({ room: "polls", token: tok(2) })).participant, null);
  assert.equal((await go({ action: "clear", values: { room: "nope" } })).status, 404);
  const codes = []; for (let i = 0; i < 70; i++) codes.push((await go({ action: "clear", values: { room: "polls" } })).status);
  assert.ok(codes.includes(429), "60 appuis par minute au plus");
  const log = (await c.api.store.list("audit")).map((x) => x.data.what);
  assert.ok(log.includes("mute") && log.includes("unmute") && log.includes("clearRoom"));
});

test("régénérer l'adresse : l'ancienne ne marche plus (page, état, appuis)", async () => {
  const c = audienceCtx(); await K.ensureMeta(c); const k1 = (await meta(c)).remoteKey;
  assert.equal((await route("remote", c, req(`${BASE}/remote?k=${k1}`))).status, 200);
  assert.ok((await def.adminActions.regenerate(c, { confirm: "on" })).ok);
  const k2 = (await meta(c)).remoteKey; assert.notEqual(k1, k2);
  assert.equal((await route("remote", c, req(`${BASE}/remote?k=${k1}`))).status, 404);
  assert.equal((await route("remote-state", c, req(`${BASE}/remote-state?k=${k1}`))).status, 404);
  assert.equal((await route("remote-press", c, req(`${BASE}/remote-press`, { k: k1, panel: "audience", action: "clear", values: {} }))).status, 404);
  assert.equal((await route("remote", c, req(`${BASE}/remote?k=${k2}`))).status, 200);
});
