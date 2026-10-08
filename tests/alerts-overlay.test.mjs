import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { parseManifest } from "@/core/modules/manifest";

const DIR = new URL("../modules/alerts-overlay", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
const manifestJson = readJson("module.json");
const source = fs.readFileSync(`${DIR}/index.mjs`, "utf8");
const mod = await import("../modules/alerts-overlay/index.mjs");
const def = mod.default;
const ctx = (settings = {}, key = "alerts") => fakeCtx({ key, messages: readJson("locales/en.json"), settings });
const post = (body, token = "secret", method = "POST") => new Request("https://x.test/m/alerts/push", { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined });

test("manifeste valide, réglages déclarés, parité en/fr, clés ctx.t existantes", () => {
  const r = parseManifest(manifestJson); assert.ok(r.ok, r.ok ? "" : r.error);
  const declared = new Set(manifestJson.settings.map((s) => s.key));
  for (const m of source.matchAll(/ctx\.setting\("([A-Za-z0-9_]+)"\)/g)) assert.ok(declared.has(m[1]), m[1]);
  const en = readJson("locales/en.json");
  assert.deepEqual(Object.keys(readJson("locales/fr.json")).sort(), Object.keys(en).sort());
  for (const m of source.matchAll(/\bt\("([A-Za-z0-9_]+)"/g)) assert.ok(m[1] in en, m[1]);
});

test("push : refusé sans jeton, avec un mauvais jeton, ou si aucun jeton n'est défini", async () => {
  assert.equal((await def.routes.push(post({ message: "x" }, null), ctx({ pushToken: "secret" }))).status, 401);
  assert.equal((await def.routes.push(post({ message: "x" }, "faux!!"), ctx({ pushToken: "secret" }))).status, 401);
  assert.equal((await def.routes.push(post({ message: "x" }, "secret"), ctx({}))).status, 401, "sans jeton configuré, personne ne pousse");
  assert.equal((await def.routes.push(post({ message: "x" }, ""), ctx({ pushToken: "" }))).status, 401);
  assert.equal((await def.routes.push(post(null, "secret", "GET"), ctx({ pushToken: "secret" }))).status, 405);
});

test("push : corps invalide, message vide ou trop gros refusés ; type inconnu → alerte ; texte nettoyé et borné", async () => {
  const c = ctx({ pushToken: "secret" }, "k1");
  const got = []; const on = (e) => got.push(e); (globalThis.__curiosaAlertsBus).on("k1", on);
  assert.equal((await def.routes.push(post("pas du json"), c)).status, 400);
  assert.equal((await def.routes.push(post({ message: "   " }), c)).status, 400);
  assert.equal((await def.routes.push(post("x".repeat(5000)), c)).status, 413);
  const ok = await def.routes.push(post({ kind: "inconnu", message: `<img src=x onerror=1>\n${"a".repeat(500)}`, username: "bob\u0007" }), c);
  assert.equal(ok.status, 200);
  assert.equal(got.length, 1);
  assert.equal(got[0].kind, "alert");
  assert.ok(got[0].message.length <= 200 && !got[0].message.includes("\n"));
  assert.equal(got[0].username, "bob");
  (globalThis.__curiosaAlertsBus).off("k1", on);
});

test("flux SSE : reçoit les alertes de SA clé uniquement, se désabonne à la fermeture", async () => {
  const ac = new AbortController();
  const res = def.routes.events(new Request("https://x.test/m/k2/events", { signal: ac.signal }), ctx({}, "k2"));
  assert.equal(res.headers.get("content-type"), "text/event-stream");
  const reader = res.body.getReader(); const dec = new TextDecoder();
  assert.match(dec.decode((await reader.read()).value), /^:ok/);
  assert.equal(mod.listeners("k2"), 1);
  mod.emit("autre", { kind: "follow", message: "pas pour moi" });
  mod.emit("k2", { kind: "follow", message: "Alice" });
  assert.deepEqual(JSON.parse(dec.decode((await reader.read()).value).replace(/^data: /, "")), { kind: "follow", message: "Alice" });
  ac.abort(); await new Promise((r) => setTimeout(r, 10));
  assert.equal(mod.listeners("k2"), 0);
});

test("overlay : configuration échappée, texte inséré via textContent (jamais innerHTML), durée bornée", () => {
  const out = def.overlay(ctx({ durationSeconds: 9999, visual: "plain" }));
  assert.match(out.script, /"duration":60/);
  assert.match(out.script, /"neon":false/);
  assert.ok(!/innerHTML/.test(out.script));
  assert.match(out.script, /textContent=e\.message/);
  assert.match(out.html, /--al-accent:#e8a23b/);
});

test("test d'admin : émet une alerte « test » ; panneau avec la commande d'envoi", async () => {
  const c = ctx({ pushToken: "s" }, "k3");
  const got = []; const on = (e) => got.push(e); (globalThis.__curiosaAlertsBus).on("k3", on);
  assert.equal((await def.adminActions.test(c)).ok, "Test alert sent.");
  assert.deepEqual(got, [{ kind: "test", message: "This is a test alert" }]);
  (globalThis.__curiosaAlertsBus).off("k3", on);
  const blocks = await def.adminPanel(c);
  assert.ok(blocks.some((b) => b.type === "copy" && b.text.includes("/m/k3/push")));
});
