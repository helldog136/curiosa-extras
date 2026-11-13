// Twitch bot 1.17.0: the words in the commands table, their window, the examples, the "On stream" fields, the assistants' tools, FR/EN parity and the ergonomics kit.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { world, fr, en, C, NOW } from "./helpers/botWorld.mjs";
import { tableOf, dialogsOf, shownFields, foldedFields } from "./helpers/ui.mjs";
import { assertAdminPageErgonomics } from "./helpers/ergonomics.mjs";

const A = await import("../modules/twitch-bot/admin.mjs");
const tools = (await import("../modules/twitch-bot/tools.mjs")).default;
const manifest = JSON.parse(fs.readFileSync(new URL("../modules/twitch-bot/module.json", import.meta.url), "utf8"));
const svc = (extra = {}) => ({ "alerts.show": { list: () => ({ items: [{ id: "m1", name: "Applause", kind: "picture" }, { id: "m2", name: "Ding", kind: "sound" }, { id: "tone:bell", name: "Bell", kind: "sound", builtin: true }] }), show: () => ({ ok: true, state: "shown" }), ...extra } });
const act = (w, name, v) => A.actions[name](w.ctx, v);
const withWord = async (o = {}) => { const w = world({ locale: "en", services: svc(), ...o }); const r = await act(w, "createWord", { words: "quoi, koi", text: "Feur", role: "everyone" }); assert.ok(r.ok, JSON.stringify(r)); return w; };

test("manifest: 1.17.0, optional alerts.show, advanced valve setting, FR/EN parity", () => {
  assert.equal(manifest.version, "1.19.0");
  assert.deepEqual(manifest.requires.find((r) => r.service === "alerts.show"), { service: "alerts.show", min: 1, optional: true });
  const s = manifest.settings.find((x) => x.key === "wordsPerMinute"); assert.deepEqual([s.default, s.advanced, s.min, s.max], [6, true, 1, 30]);
  assert.deepEqual(Object.keys(en).sort(), Object.keys(fr).sort());
  for (const k of Object.keys(en)) assert.deepEqual([...String(en[k]).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), [...String(fr[k]).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), k);
});

test("one table: a word is a row with the written badge Word, a switch, at most two visible actions; first time: one click adds two examples", async () => {
  const w = world({ locale: "en", services: svc() });
  let page = await A.panel(w.ctx, { query: {} });
  const links = page.find((b) => b.type === "links" && !b.tab).items;
  assert.deepEqual(links.map((l) => l.label), ["New command", "New word", "Add an example"], "empty state: one click opens the window with an example written");
  const ex = dialogsOf(await A.panel(w.ctx, { query: { new: "word", example: "1" } }))[0];
  assert.deepEqual([ex.fields.find((x) => x.name === "words").value, ex.fields.find((x) => x.name === "text").value], ["quoi", "Feur"]);
  assert.ok((await act(w, "createWord", { words: "quoi", text: "Feur", role: "everyone" })).ok);
  assert.ok((await act(w, "createWord", { words: "bonjour, salut", text: "Hello", role: "everyone" })).ok);
  page = await A.panel(w.ctx, { query: {} });
  assert.deepEqual(page.find((b) => b.type === "links" && !b.tab).items.map((l) => l.label), ["New command", "New word"], "the example link goes away once there are words");
  const t = page.find((b) => b.type === "table" && b.rowIds?.some((i) => i.startsWith("word:")));
  const rows = t.rows.map((r, i) => ({ id: t.rowIds[i], r })).filter((x) => x.id.startsWith("word:"));
  assert.equal(rows.length, 2);
  const quoi = rows.find((x) => x.r[0].text.includes("quoi")).r;
  assert.deepEqual([quoi[0].text, quoi[1].text, quoi[2].text, !!quoi[2].badge, !!quoi[3].switch], ["“quoi”", "Feur", "Word", true, true]);
  assert.ok(t.filters.some((f) => f.column === 2) && t.searchable);
  assert.ok(t.rowActions.filter((a) => !a.inMenu).length <= 2 && t.rowActions.find((a) => a.danger).confirm);
  assert.equal(t.rowActions[0].href, "?tab=use&edit={id}");
});

test("window of a word: 3 visible fields, the rest folded, 'On stream' fields; errors under their field with an example; chance and mode folded", async () => {
  const w = await withWord();
  const page = await A.panel(w.ctx, { query: { new: "word" } });
  const f = dialogsOf(page)[0];
  assert.deepEqual(shownFields(f).map((x) => x.name), ["words", "text", "role"]);
  assert.deepEqual(foldedFields(f).map((x) => x.name), ["mediaVisual", "mediaSound", "mediaSeconds", "mode", "cdGlobal", "cdUser", "chance", "collab"]);
  assert.deepEqual(f.fields.find((x) => x.name === "mediaVisual").options.map((o) => o.label), ["Nothing", "Applause"]);
  assert.deepEqual(f.fields.find((x) => x.name === "mediaSound").options.map((o) => o.label), ["Nothing", "Ding", "Bell"]);
  assert.equal(f.cancelHref, "?tab=use"); assert.ok(f.submitLabel.length < 30);
  assertAdminPageErgonomics(page);
  const bad = async (v, field) => { const r = await act(w, "createWord", { role: "everyone", ...v }); assert.ok(r.errors?.[field], JSON.stringify(v)); assert.match(r.errors[field], /[.?]$/); };
  await bad({ words: "", text: "x" }, "words"); await bad({ words: "a|b", text: "x" }, "words"); await bad({ words: "quoi" }, "text");
  await bad({ words: "quoi", text: "{zzz}" }, "text"); await bad({ words: "quoi", text: "x", chance: "50" }, "chance"); await bad({ words: "quoi", text: "x", cdUser: "-5" }, "cdUser");
  await bad({ words: "quoi", text: "x", mediaVisual: "m2" }, "mediaVisual"); await bad({ words: "quoi", text: "x", mediaSeconds: "1", mediaSound: "m2" }, "mediaSeconds");
  await bad({ words: "Quoi", text: "x" }, "words");
});

test("edit, toggle with the switch, delete; media saved from the window and shown in the row", async () => {
  const w = await withWord();
  const key = (await A.panel(w.ctx, { query: {} })).find((b) => b.type === "table").rowIds.find((i) => i.startsWith("word:"));
  const edit = dialogsOf(await A.panel(w.ctx, { query: { edit: key } }))[0];
  assert.equal(edit.action, "saveWord"); assert.equal(edit.fields.find((x) => x.name === "words").value, "quoi, koi");
  assert.ok((await act(w, "saveWord", { id: key, words: "quoi, koi", text: "Feur", role: "everyone", mediaVisual: "m1", mediaSound: "m2", mediaSeconds: "8", mode: "contains" })).ok);
  const t = (await A.panel(w.ctx, { query: {} })).find((b) => b.type === "table");
  const row = t.rows[t.rowIds.indexOf(key)];
  assert.match(row[1].text, /On stream: Applause \+ Ding/); assert.match(row[0].text, /inside words/);
  const e2 = dialogsOf(await A.panel(w.ctx, { query: { edit: key } }))[0];
  assert.deepEqual(["mediaVisual", "mediaSound", "mediaSeconds", "mode"].map((n) => e2.fields.find((x) => x.name === n).value), ["m1", "m2", 8, "contains"]);
  assert.match((await act(w, "toggle", { id: key, enabled: "0" })).ok, /switched off/);
  assert.ok(!(await C.loadConfig(w.ctx)).data.words[0].enabled);
  assert.ok((await act(w, "remove", { id: key })).ok); assert.equal((await C.loadConfig(w.ctx)).data.words.length, 0);
});

test("no alerts overlay: the choice says so in one line, nothing is saved from it and the saved choice is kept", async () => {
  const w = await withWord();
  const key = (await C.loadConfig(w.ctx)).data.words[0].id;
  await act(w, "saveWord", { id: `word:${key}`, words: "quoi", text: "Feur", mediaVisual: "m1" });
  const down = world({ locale: "en" }); down.ctx.api.store = w.ctx.api.store;
  const f = dialogsOf(await A.panel(down.ctx, { query: { edit: `word:${key}` } }))[0];
  const m = f.fields.find((x) => x.name === "mediaVisual");
  assert.deepEqual(m.options.map((o) => o.label), ["Alerts overlay not installed"]); assert.equal(m.folded, true);
  assert.ok((await A.actions.saveWord(down.ctx, { id: `word:${key}`, words: "quoi", text: "Feur 2", mediaVisual: "" })).ok);
  assert.equal((await C.loadConfig(down.ctx)).data.words[0].media.visual, "m1", "kept");
  const cmd = dialogsOf(await A.panel(down.ctx, { query: { edit: "builtin:jeu" } }))[0];
  assert.equal(cmd.fields.find((x) => x.name === "mediaVisual").options[0].label, "Alerts overlay not installed");
  assertAdminPageErgonomics(await A.panel(down.ctx, { query: { new: "word" } }));
});

test("commands: the window has the same folded On stream fields and saves them", async () => {
  const w = await withWord();
  const page = await A.panel(w.ctx, { query: { new: "1" } });
  const f = dialogsOf(page)[0];
  assert.deepEqual(shownFields(f).map((x) => x.name), ["name", "text", "role"]);
  assert.ok(foldedFields(f).some((x) => x.name === "mediaVisual"));
  assert.ok((await act(w, "create", { name: "merci", text: "Merci", mediaVisual: "m1", mediaSeconds: "5" })).ok);
  assert.deepEqual((await C.loadConfig(w.ctx)).data.custom.find((c) => c.name === "merci").media, { visual: "m1", seconds: 5 });
  assertAdminPageErgonomics(page);
});

test("French and English pages pass the kit; the journal names words with a bubble sign", async () => {
  for (const locale of ["en", "fr"]) {
    const w = await withWord({ locale });
    assertAdminPageErgonomics(await A.panel(w.ctx, { query: {} }));
    const key = (await C.loadConfig(w.ctx)).data.words[0].id;
    assertAdminPageErgonomics(await A.panel(w.ctx, { query: { edit: `word:${key}` } }));
  }
});

test("assistants: list shows words and the library by name, create/update words and On stream by name, errors explain", async () => {
  const w = world({ locale: "en", services: svc() });
  assert.ok((await tools.bot_command_create(w.ctx, { kind: "word", words: ["quoi"], text: "Feur", answerOneTimeOutOf: 3, onStreamPicture: "applause", onStreamSound: "Bell", onStreamSeconds: 6 })).created);
  const l = await tools.bot_commands_list(w.ctx, {});
  const word = l.commands.find((c) => c.kind === "word");
  assert.deepEqual([word.words, word.match, word.answersOneTimeOutOf, word.onStream.picture_or_video, word.onStream.sound, word.delayAllSeconds], [["quoi"], "whole word", 3, "Applause", "Bell", 30]);
  assert.deepEqual(l.onStreamLibrary.map((m) => m.name), ["Applause", "Ding", "Bell"]);
  assert.ok(!JSON.stringify(l).includes("/uploads/"));
  assert.equal((await tools.bot_commands_list(w.ctx, { kind: "word" })).commands.length, 1);
  assert.ok((await tools.bot_command_update(w.ctx, { name: "Quoi", kind: "word", match: "inside_words", text: "Feur !", onStreamSound: "Ding" })).updated);
  const u = (await tools.bot_commands_list(w.ctx, { kind: "word" })).commands[0];
  assert.deepEqual([u.match, u.onStream.sound, u.onStream.picture_or_video], ["inside words", "Ding", null]);
  await assert.rejects(tools.bot_command_update(w.ctx, { name: "quoi", onStreamPicture: "Nope" }), /No picture or video named "Nope".*Applause/);
  assert.ok((await tools.bot_command_update(w.ctx, { name: "quoi", clearOnStream: true })).updated);
  await assert.rejects(tools.bot_command_create(w.ctx, { kind: "word", words: ["quoi"], text: "x" }), /already used/);
  assert.ok((await tools.bot_command_create(w.ctx, { name: "merci", text: "Merci", onStreamPicture: "Applause" })).created);
  const down = world({ locale: "en" });
  await assert.rejects(tools.bot_command_create(down.ctx, { name: "x", text: "x", onStreamPicture: "Applause" }), /alerts overlay is not installed/);
  const names = manifest.mcp.map((t) => t.name);
  for (const n of ["bot_commands_list", "bot_command_create", "bot_command_update"]) { assert.ok(names.includes(n)); assert.ok(!manifest.mcp.find((t) => t.name === n).readOnly || n === "bot_commands_list"); assert.equal(manifest.mcp.find((t) => t.name === n).default, false); }
});
