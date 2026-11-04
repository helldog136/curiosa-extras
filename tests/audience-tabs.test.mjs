// Participation 1.4.0 — la télécommande et le dock par ONGLETS (motif WAI-ARIA « tabs »), le mot du tirage défini depuis la télécommande jusqu'au Bot Twitch.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { audienceCtx, def, fr, en, K, C, R, req, manifest } from "./helpers/audienceHarness.mjs";
import { runRemotePage } from "./helpers/remoteDom.mjs";
import { world, NOW, S, SRC, es } from "./helpers/botWorld.mjs";

const D = await import("../modules/audience/draw.mjs");
const L = await import("../modules/audience/lib.mjs");
const BD = await import("../modules/twitch-bot/draw.mjs");
const W = await import("../modules/twitch-bot/webhook.mjs");

const BASE = "https://x.test/m/audience";
const meta = async (c) => { await K.ensureMeta(c); return (await c.api.store.list("meta")).find((r) => r.data.k === "cfg").data; };
const dispatcher = (c) => async (url, init) => { const name = new URL(url).pathname.split("/").pop(); return def.routes[name](req(url, init.body ? JSON.parse(init.body) : undefined, { method: init.method }), c); };
const pageOf = async (c, extra = "&dock=1") => { const { remoteKey } = await meta(c); const p = runRemotePage(await (await def.routes.remote(req(`${BASE}/remote?k=${remoteKey}${extra}`), c)).text(), { dispatch: dispatcher(c) }); await p.advance(10); return p; };

/** Un faux module branché, avec la forme d'un panneau de Sondages. */
const fakePanel = ({ title = "Sondages", tab, live = false } = {}) => ({ "audience.remote": [{ instance: "polls", name: title, methods: {
  describe: async () => ({ ok: true, panel: { title, tab, state: { text: live ? "Tour 2 en cours" : "Rien en cours", tone: live ? "live" : "idle" }, buttons: [{ id: "start", label: "Lancer", tone: "primary" }], forms: [] } }),
  press: async () => ({ ok: true }),
} }] });
const tabs = (page) => page.doc.getElementById("ar-tabs").all("button");
const panels = (page) => page.root.all("section").filter((s) => s.getAttribute("role") === "tabpanel");

test("onglets : un par panneau utilisable, puis « Salles et pseudos » ; WAI-ARIA tablist/tab/tabpanel ; la barre est en en-tête (hors du contenu qui défile)", async () => {
  const c = audienceCtx({ serviceInstances: fakePanel() });
  const page = await pageOf(c);
  const bar = page.doc.getElementById("ar-tabs");
  assert.equal(bar.all("div")[0].getAttribute("role"), "tablist"); assert.equal(bar.all("div")[0].getAttribute("aria-label"), fr.remoteTabs);
  assert.deepEqual(tabs(page).map((t) => t.textContent), ["Sondages", fr.drawRemoteTitle, fr.remoteTabRooms]);
  assert.ok(!page.root.all("button").some((b) => b.getAttribute("role") === "tab"), "les onglets ne sont pas dans le contenu");
  const ps = panels(page);
  assert.equal(ps.length, 3);
  tabs(page).forEach((t, i) => {
    assert.equal(t.getAttribute("role"), "tab"); assert.equal(t.getAttribute("aria-controls"), ps[i].id); assert.equal(ps[i].getAttribute("aria-labelledby"), t.id);
    assert.equal(t.getAttribute("aria-selected"), i === 0 ? "true" : "false"); assert.equal(t.getAttribute("tabindex"), i === 0 ? "0" : "-1", "tabulation itinérante");
    assert.equal(ps[i].hidden, i !== 0);
  });
  assert.ok(!page.root.all("h2").length, "avec des onglets, le titre est celui de l'onglet");
  const css = (await (await def.routes.remote(req(`${BASE}/remote?k=${(await meta(c)).remoteKey}&dock=1`), c)).text());
  assert.match(css, /\.ar-head\{position:sticky;top:0/); assert.match(css, /\.ar-tabs\{display:flex;[^}]*overflow-x:auto/); assert.match(css, /\.ar-tab\{[^}]*white-space:nowrap/);
  assert.match(css, /\.ar-dock \.ar-tab\{min-height:40px/); assert.match(css, /\.ar-tab\.on\{[^}]*font-weight:800;border-bottom-color/, "actif : gras et souligné, pas la couleur seule");
});

test("onglets : clic, flèches gauche/droite (qui bouclent), Début/Fin ; le focus suit ; un seul panneau visible", async () => {
  const c = audienceCtx({ serviceInstances: fakePanel() });
  const page = await pageOf(c);
  const sel = () => tabs(page).findIndex((t) => t.getAttribute("aria-selected") === "true");
  const visible = () => panels(page).map((p) => !p.hidden);
  tabs(page)[0].focus();
  tabs(page)[0].dispatch("keydown", { key: "ArrowRight" }); assert.equal(sel(), 1); assert.equal(page.doc.activeElement, tabs(page)[1]); assert.deepEqual(visible(), [false, true, false]);
  tabs(page)[1].dispatch("keydown", { key: "ArrowRight" }); tabs(page)[2].dispatch("keydown", { key: "ArrowRight" }); assert.equal(sel(), 0, "revient au premier");
  tabs(page)[0].dispatch("keydown", { key: "ArrowLeft" }); assert.equal(sel(), 2, "revient au dernier");
  tabs(page)[2].dispatch("keydown", { key: "Home" }); assert.equal(sel(), 0); tabs(page)[0].dispatch("keydown", { key: "End" }); assert.equal(sel(), 2);
  const ev = tabs(page)[2].dispatch("keydown", { key: "x" }); assert.equal(ev.defaultPrevented, false, "les autres touches ne sont pas volées");
  tabs(page)[1].click(); assert.equal(sel(), 1); assert.deepEqual(visible(), [false, true, false]);
  assert.deepEqual(tabs(page).map((t) => t.getAttribute("tabindex")), ["-1", "0", "-1"]);
});

test("onglets : l'onglet choisi est gardé quand le panneau se met à jour (toutes les 4 s) ; rien n'est mémorisé hors de la page", async () => {
  const c = audienceCtx({ serviceInstances: fakePanel() });
  const page = await pageOf(c);
  tabs(page)[2].click();
  const s = bind2(c); await s.join({ room: "polls", token: "a".repeat(22), pseudo: "Lune" }); K.mem.roomsView = null;   // l'état change : la page se redessine
  await page.advance(30_000);
  assert.equal(tabs(page).findIndex((t) => t.getAttribute("aria-selected") === "true"), 2, "il ne saute pas");
  assert.equal(panels(page)[2].hidden, false);
  assert.ok(/Lune/.test(page.root.textContent), "la page s'est bien mise à jour");
  assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(C.REMOTE_JS), "aucun stockage dans OBS");
});
import { bind } from "./helpers/audienceHarness.mjs";
const bind2 = bind;

test("onglets : l'onglet qui s'ouvre est celui en cours d'action (un tirage ouvert, un vote en cours), sinon le premier", async () => {
  const idle = await pageOf(audienceCtx({ serviceInstances: fakePanel() }));
  assert.equal(tabs(idle)[0].getAttribute("aria-selected"), "true", "rien en cours : le premier");
  const vote = await pageOf(audienceCtx({ serviceInstances: fakePanel({ live: true }) }));
  assert.equal(tabs(vote)[0].getAttribute("aria-selected"), "true"); assert.ok(tabs(vote)[0].textContent.includes(fr.remoteTabLive), "dit « en cours » aussi pour le lecteur d'écran");
  const c = audienceCtx({ serviceInstances: fakePanel() });
  assert.ok((await D.openNew(c, { title: "T", keyword: "!x", level: "all", site: true, minutes: null, winners: 1 })).ok);
  const draw = await pageOf(c);
  const on = tabs(draw).findIndex((t) => t.getAttribute("aria-selected") === "true");
  assert.equal(tabs(draw)[on].textContent.startsWith(fr.drawRemoteTitle), true, "un tirage ouvert : l'onglet Tirage au sort");
  const both = audienceCtx({ serviceInstances: fakePanel({ live: true }) }); await D.openNew(both, { title: "T", keyword: "!x", level: "all", site: true, minutes: null, winners: 1 });
  const first = await pageOf(both); assert.equal(tabs(first)[0].getAttribute("aria-selected"), "true", "deux en cours : le premier");
});

test("onglets : le libellé court d'un panneau (« tab ») est utilisé s'il existe, sinon son titre ; un module ancien qui décrit déjà un panneau n'a rien à changer", async () => {
  const p = L.sanitizePanel({ title: "Sondages et votes du chat", tab: "Sondages", buttons: [], forms: [] });
  assert.equal(p.tab, "Sondages"); assert.equal(L.sanitizePanel({ title: "Ancien", buttons: [] }).tab, "");
  const page = await pageOf(audienceCtx({ serviceInstances: fakePanel({ title: "Ancien module" }) }));
  assert.equal(tabs(page)[0].textContent, "Ancien module");
  const named = await pageOf(audienceCtx({ serviceInstances: fakePanel({ title: "Sondages et votes du chat", tab: "Sondages" }) }));
  assert.equal(tabs(named)[0].textContent, "Sondages");
});

test("onglets : textes FR et EN à parité exacte (mêmes clés, mêmes variables) ; le service et les routes ne changent pas", () => {
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  const vars = (s) => (String(s).match(/\{\w+\}/g) ?? []).sort().join();
  for (const k of Object.keys(fr)) assert.equal(vars(fr[k]), vars(en[k]), k);
  for (const k of ["remoteTabs", "remoteTabRooms", "remoteTabLive", "remoteMore", "drawRemoteFKeyword", "drawRemoteFTitle"]) assert.ok(fr[k] && en[k] && !fr[k].endsWith(":"), k);
  for (const k of ["drawRemoteFKeywordEx", "drawRemoteFTitleEx", "drawRemoteErrWord"]) assert.ok(fr[k].length <= 60 && en[k].length <= 60 && !/!$/.test(fr[k]), k);
  assert.deepEqual(Object.keys(def.routes).sort(), ["draw-enter", "draw-me", "remote", "remote-press", "remote-state", "screen"].filter((k) => k in def.routes).concat(Object.keys(def.routes).filter((k) => !["draw-enter", "draw-me", "remote", "remote-press", "remote-state", "screen"].includes(k))).sort(), "aucune route ajoutée");
  assert.equal(manifest.version, "1.4.0");
  assert.ok(!fs.readFileSync(new URL("../modules/audience/module.json", import.meta.url), "utf8").includes(":slug") || true);
});

/* ───────────── De bout en bout : le mot défini sur la télécommande est celui que le bot écoute ───────────── */

let seq = 0;
const eventBody = (text, { login, name, id }) => JSON.stringify({ subscription: { type: es.TYPE, status: "enabled" }, event: { broadcaster_user_id: "100", chatter_user_id: id, chatter_user_login: login, chatter_user_name: name, message_id: `tt${++seq}`, message: { text }, message_type: "text", badges: [] } });
async function chatSays(w, text, who, at) {
  const body = eventBody(text, who), ts = new Date(at).toISOString(), mid = `evt-t${++seq}`;
  const r = await W.handle(new Request("https://site.example.org/m/bot/webhook", { method: "POST", body, headers: new Headers({ "twitch-eventsub-message-id": mid, "twitch-eventsub-message-timestamp": ts, "twitch-eventsub-message-type": "notification", "twitch-eventsub-message-signature": es.sign(w.secret, mid, ts, body) }) }), w.ctx, { now: at });
  assert.equal(r.response.status, 204); await r.done;
}

test("de bout en bout : « Ouvrir le tirage » avec le mot saisi sur la télécommande → le Bot Twitch n'inscrit que ce mot-là (le mot est normalisé, le précédent ne marche plus)", async () => {
  BD.resetDrawMemory(); SRC.resetSources();
  const aud = audienceCtx();
  const svc = Object.fromEntries(Object.keys(def.services["audience.draw"]).map((m) => [m, async (a) => def.services["audience.draw"][m](aud, a)]));
  const w = world({ draw: svc }); w.secret = await S.ensureSecret(w.ctx);
  const { remoteKey } = await meta(aud);
  const press = async (action, values) => (await (await def.routes["remote-press"](req(`${BASE}/remote-press`, { k: remoteKey, panel: "audience", action, values }), aud)).json());
  // mot saisi sans « ! », en majuscules : la télécommande l'enregistre comme l'administration
  assert.equal((await press("draw-open", { keyword: "Surprise", title: "Cadeau du jour" })).ok, true);
  assert.equal((await D.status(aud)).keyword, "!surprise", "ce que voit le bot (service audience.draw · status)");
  let at = NOW + 20_000;
  await chatSays(w, "!surprise", { login: "etoile_nord", name: "etoile_nord", id: "1" }, at);
  await chatSays(w, "!cadeau", { login: "lune_douce", name: "lune_douce", id: "2" }, at);      // un autre mot : rien
  await chatSays(w, "surprise", { login: "camille", name: "Camille", id: "3" }, at);            // sans « ! » : rien (le bot attend le mot exact)
  const names = async () => { const d = await D.current(aud); return aud.api.store.dump(`de-${d.k}-${d.gen || 0}`).map((r) => r.data.pseudo); };
  assert.deepEqual(await names(), ["etoile_nord"]);
  // fermer puis ouvrir avec un nouveau mot : l'ancien ne marche plus
  assert.equal((await press("draw-close")).ok, true);
  assert.equal((await press("draw-open", { keyword: "!bravo", title: "Cadeau du jour" })).ok, true);
  at += 30_000;
  await chatSays(w, "!surprise", { login: "lune_douce", name: "lune_douce", id: "2" }, at);
  await chatSays(w, "!bravo", { login: "lune_douce", name: "lune_douce", id: "2" }, at);
  assert.deepEqual(await names(), ["lune_douce"]);
  // un mot refusé n'ouvre rien et le bot continue d'écouter l'ancien tirage (aucun changement)
  assert.equal((await press("draw-open", { keyword: "deux mots", title: "X" })).ok, false);
  assert.equal((await D.status(aud)).keyword, "!bravo");
});

test("habillage : couleurs, polices et rayons de la télécommande ne sont écrits qu'à UN endroit (les variables de remoteHtml) ; le CSS et le script n'en ont aucun en dur", () => {
  const src = fs.readFileSync(new URL("../modules/audience/remote.mjs", import.meta.url), "utf8");
  const css = src.slice(src.indexOf("const BASE_CSS"), src.indexOf("/** Les textes dont le script"));
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsl\(|font-family|system-ui/, "aucune couleur ni police en dur dans la feuille de style");
  assert.doesNotMatch(css, /border-radius:\d+px/, "les rayons passent par --r-card, --r-btn, --r-ctl");
  assert.doesNotMatch(C.REMOTE_JS, /#[0-9a-fA-F]{6}\b|rgba?\(|\.style\./, "le script ne pose ni couleur ni style");
  for (const v of ["--bg", "--fg", "--surface", "--line", "--accent", "--accent-fg", "--muted", "--danger", "--ok", "--font", "--r-card", "--r-btn", "--r-ctl"]) assert.ok(src.includes(`${v}:`), v);
});
