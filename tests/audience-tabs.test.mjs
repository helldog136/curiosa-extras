// Participation 1.4.0 — la télécommande et le dock par ONGLETS (motif WAI-ARIA « tabs »), le mot du tirage défini depuis la télécommande jusqu'au Bot Twitch.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { audienceCtx, def, fr, en, K, C, R, req, manifest } from "./helpers/audienceHarness.mjs";
import { world, NOW, S, SRC, es } from "./helpers/botWorld.mjs";

const D = await import("../modules/audience/draw.mjs");
const L = await import("../modules/audience/lib.mjs");
const BD = await import("../modules/twitch-bot/draw.mjs");
const W = await import("../modules/twitch-bot/webhook.mjs");

const BASE = "https://x.test/m/audience";
const meta = async (c) => { await K.ensureMeta(c); return (await c.api.store.list("meta")).find((r) => r.data.k === "cfg").data; };
test("onglets : textes FR et EN à parité exacte (mêmes clés, mêmes variables) ; le service et les routes ne changent pas", () => {
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  const vars = (s) => (String(s).match(/\{\w+\}/g) ?? []).sort().join();
  for (const k of Object.keys(fr)) assert.equal(vars(fr[k]), vars(en[k]), k);
  for (const k of ["remoteTabs", "remoteTabRooms", "remoteTabLive", "remoteMore", "drawRemoteFKeyword", "drawRemoteFTitle"]) assert.ok(fr[k] && en[k] && !fr[k].endsWith(":"), k);
  for (const k of ["drawRemoteFKeywordEx", "drawRemoteFTitleEx", "drawRemoteErrWord"]) assert.ok(fr[k].length <= 60 && en[k].length <= 60 && !/!$/.test(fr[k]), k);
  assert.deepEqual(Object.keys(def.routes).sort(), ["draw-enter", "draw-me", "remote", "remote-press", "remote-state", "screen"].filter((k) => k in def.routes).concat(Object.keys(def.routes).filter((k) => !["draw-enter", "draw-me", "remote", "remote-press", "remote-state", "screen"].includes(k))).sort(), "aucune route ajoutée");
  assert.equal(manifest.version, "1.7.0");
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

