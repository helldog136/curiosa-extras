import test from "node:test";
import assert from "node:assert/strict";
import { audienceCtx, bind, def, fr, en, L, K, tok } from "./helpers/audienceHarness.mjs";

const flat = (blocks) => JSON.stringify(blocks);
const meta = async (c) => (await c.api.store.list("meta")).find((r) => r.data.k === "cfg").data;
const providers = () => ({ "audience.remote": [{ instance: "polls", name: "Sondages", methods: { describe: async () => ({ ok: true, panel: { title: "Sondages **gras** [x](y)", buttons: [{ id: "go", label: "Go" }] } }) } }] });

test("administration, onglet « En direct » : l'adresse secrète, un code à flasher, la liste de ce qui se pilote ; sans module branché, une invitation à en installer un", async () => {
  const c = audienceCtx();
  const blocks = await def.adminPanel(c, { query: {} });
  const key = (await meta(c)).remoteKey;
  assert.ok(flat(blocks).includes(`/m/${c.instance.key}/remote?k=${key}`), "l'adresse complète est là");
  assert.ok(blocks.some((b) => b.type === "copy" && b.text.includes(key)));
  const qr = blocks.find((b) => b.type === "html");
  assert.match(qr.html, /^<img src="data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+" width="200"/); assert.ok(qr.html.includes('alt="'), "texte alternatif");
  assert.ok(blocks.some((b) => b.type === "suggestInstall" && b.service === "audience.remote"), "aucun module branché : proposition d'installer");
  assert.ok(flat(blocks).includes(fr.pluggedNone));
  assert.ok(blocks.some((b) => b.type === "adminForm" && b.action === "regenerate"));
  assert.ok(blocks.every((b) => b.type !== "html" || b === qr), "un seul bloc brut : l'image");
  const c2 = audienceCtx({ serviceInstances: providers() });
  const b2 = await def.adminPanel(c2, { query: {} });
  assert.ok(!b2.some((b) => b.type === "suggestInstall") && flat(b2).includes("Sondages"), "les modules branchés sont listés");
  assert.ok(!flat(b2).includes("**gras**") && !flat(b2).includes("[x](y)"), "le titre d'un autre module ne peut pas injecter de mise en forme");
});

test("administration : droits — sans « télécommande » jamais d'adresse ; sans « modérer » ni salles ni pseudos ni journal ; chaque action refuse sans son droit", async () => {
  const c = audienceCtx({ can: (r) => r === "moderate" });
  await K.ensureMeta(c); const key = (await meta(c)).remoteKey;
  const none = flat(await def.adminPanel(c, { query: {} }));
  assert.ok(!none.includes(key) && none.includes(fr.remoteNoRight.slice(0, 30)), "l'adresse n'est jamais montrée sans son droit");
  const c2 = audienceCtx({ can: (r) => r === "remote.use" });
  const k2 = (await (async () => { await K.ensureMeta(c2); return meta(c2); })()).remoteKey;
  const only = flat(await def.adminPanel(c2, { query: {} }));
  assert.ok(only.includes(k2) && only.includes(fr.moderateNoRight.slice(0, 30)) && !only.includes('"columns"'), "sans « modérer » : pas de salles");
  const s = bind(c2); await s.join({ room: "polls", token: tok(1), pseudo: "Secret Nom" });
  assert.ok(!flat(await def.adminPanel(c2, { query: {} })).includes("Secret Nom"));
  const room = await K.getRoom(c2, "polls");
  c2.can = () => false;
  const before = c2.api.store.writes.length;
  for (const [name, args] of [["regenerate", { confirm: "on" }], ["toggleMute", { id: `${room.id}~${"a".repeat(40)}` }], ["removePerson", { id: `${room.id}~${"a".repeat(40)}` }], ["clearRoomAdmin", { id: room.id }]]) assert.equal((await def.adminActions[name](c2, args)).error, fr.errRight, name);
  assert.equal(c2.api.store.writes.length, before, "aucune écriture sans le droit");
});

test("administration, onglet « Salles et pseudos » : salles, personnes par pages de 50, sourdine, retrait, salle à vider (avec confirmation), journal", async () => {
  const c = audienceCtx(); const s = bind(c);
  for (let i = 1; i <= 60; i++) await s.join({ room: "polls", token: tok(i), pseudo: i <= 5 ? `Perso ${i}${i}` : undefined, conn: { forwarded: `10.4.${i}.1` } });
  await s.join({ room: "autre", token: tok(1) });
  const home = await def.adminPanel(c, { query: {} });
  const table = home.find((b) => b.type === "table" && b.columns[0] === fr.colRoom);
  assert.equal(table.tab, "people"); assert.equal(table.rows.length, 2, "polls et autre (la salle générale n'existe qu'une fois la page ouverte)");
  assert.deepEqual(table.rowActions.map((a) => a.label), [fr.actSee, fr.actClear]);
  assert.ok(table.rowActions[1].danger && table.rowActions[1].confirm, "vider une salle demande confirmation");
  assert.ok(table.rowActions[0].href.includes("room={id}"));
  const polls = (await K.listRooms(c)).find((r) => r.k === "polls");
  const p1 = await def.adminPanel(c, { query: { room: polls.id } });
  const people = p1.find((b) => b.type === "table" && b.columns[0] === fr.colPseudo);
  assert.equal(people.rows.length, 50); assert.ok(people.rowIds.every((id) => id.startsWith(`${polls.id}~`)));
  const nextLink = p1.find((b) => b.type === "markdown" && b.text.includes("&c="));
  assert.ok(nextLink, "page suivante");
  const cursor = decodeURIComponent(/&c=([^)]+)\)/.exec(nextLink.text)[1]);
  const p2 = await def.adminPanel(c, { query: { room: polls.id, c: cursor } });
  assert.equal(p2.find((b) => b.type === "table" && b.columns[0] === fr.colPseudo).rows.length, 10);
  // sourdine / rétablir / retirer
  const target = `${polls.id}~${(await s.who({ room: "polls", token: tok(1) })).participant.id}`;
  assert.ok(p2.find((b) => b.type === "table").rowIds.includes(target), "les plus anciens sont en page 2");
  assert.ok((await def.adminActions.toggleMute(c, { id: target })).ok);
  assert.equal((await s.who({ room: "polls", token: tok(1) })).participant.muted, true);
  const after = (await def.adminPanel(c, { query: { room: polls.id, c: cursor } })).find((b) => b.type === "table" && b.columns[0] === fr.colPseudo);
  assert.ok(after.rows.some((r) => r[0] === "Perso 11" && r[1] === fr.stateMuted));
  assert.ok((await def.adminActions.toggleMute(c, { id: target })).ok);
  assert.equal((await s.who({ room: "polls", token: tok(1) })).participant.muted, false);
  assert.ok((await def.adminActions.removePerson(c, { id: target })).ok);
  assert.equal((await s.who({ room: "polls", token: tok(1) })).participant, null);
  assert.equal((await K.getRoom(c, "polls")).count, 59, "le compteur suit");
  for (const bad of ["", "zz", `${polls.id}~zz`, `${polls.id}~${"a".repeat(40)}`, "x~" + "a".repeat(40)]) assert.ok((await def.adminActions.toggleMute(c, { id: bad })).error, bad);
  assert.ok((await def.adminActions.clearRoomAdmin(c, { id: polls.id })).ok);
  assert.equal((await K.getRoom(c, "polls")).count, 0);
  assert.ok((await def.adminActions.clearRoomAdmin(c, { id: "nope" })).error);
  const log = (await def.adminPanel(c, { query: {} })).find((b) => b.type === "table" && b.columns[0] === fr.colWhen);
  const whats = log.rows.map((r) => r[2]);
  assert.ok([fr.what_mute, fr.what_unmute, fr.what_removePerson, fr.what_clearRoom].every((w) => whats.includes(w)), "chaque geste est au journal");
  const gone = await def.adminPanel(c, { query: { room: "inexistante" } });
  assert.ok(gone.some((b) => b.type === "banner") && flat(gone).includes(fr.errGone));
});

test("administration : régénérer demande confirmation (erreur sous la case) et journalise ; textes anglais", async () => {
  const c = audienceCtx({ locale: "en", messages: en });
  await K.ensureMeta(c);
  assert.deepEqual(Object.keys((await def.adminActions.regenerate(c, {})).errors), ["confirm"]);
  assert.equal((await def.adminActions.regenerate(c, { confirm: "on" })).ok, en.okRegen);
  assert.ok((await c.api.store.list("audit")).some((r) => r.data.what === "remote.regenerate"));
  const home = flat(await def.adminPanel(c, { query: {} }));
  for (const word of [en.liveTitle, en.remoteAddress, en.pluggedTitle, en.limitsTitle, en.roomsTitle, en.journalTitle]) assert.ok(home.includes(word), word);
  assert.ok(!/[ÀÉèéêôç]/.test(en.pluggedNone), "anglais sans accents français");
});

test("administration : aucune donnée de visiteur ou d'un autre module n'est injectable (étiquettes de salle, pseudos, détails du journal)", async () => {
  const c = audienceCtx(); const s = bind(c);
  const evil = "<img src=x onerror=alert(1)>\"'";
  await s.join({ room: "polls", token: tok(1), label: evil });
  await s.journal({ what: evil, room: "polls", detail: evil, who: evil });
  const blocks = [...(await def.adminPanel(c, { query: {} })), ...(await def.adminPanel(c, { query: { room: (await K.getRoom(c, "polls")).id } }))];
  for (const b of blocks) if (b.type === "html") assert.ok(!b.html.includes("onerror"));
  assert.ok(blocks.filter((b) => b.type === "html").every((b) => b.html.startsWith("<img src=\"data:image/svg+xml;base64,")), "le seul bloc brut est l'image du code à flasher");
  assert.ok(!blocks.some((b) => b.type === "markdown" && b.text.includes("onerror")), "rien de piégé dans un texte mis en forme");
});

test("outils pour l'assistant : lire les salles et le journal ; sourdine par pseudo ; vider une salle ; erreurs lisibles ; rien d'écrit sans geste explicite", async () => {
  const c = audienceCtx(); const s = bind(c);
  await s.join({ room: "polls", token: tok(1), pseudo: "Cible Un" }); await s.join({ room: "polls", token: tok(2) });
  const rooms = await def.mcp.audience_rooms(c, {});
  assert.deepEqual([rooms[0].room, rooms[0].participants], ["polls", 2]); assert.ok(!JSON.stringify(rooms).includes(tok(1)));
  assert.deepEqual(await def.mcp.audience_mute(c, { room: "polls", pseudo: "cible  un" }), { room: "polls", pseudo: "Cible Un", muted: true });
  assert.equal((await s.who({ room: "polls", token: tok(1) })).participant.muted, true);
  assert.equal((await def.mcp.audience_mute(c, { room: "polls", pseudo: "Cible Un", muted: false })).muted, false);
  await assert.rejects(def.mcp.audience_mute(c, { room: "polls", pseudo: "Personne Ici" }), (e) => e.expose === true && /nickname/.test(e.message));
  await assert.rejects(def.mcp.audience_mute(c, { room: "nope", pseudo: "x" }), (e) => e.expose === true && /room/.test(e.message));
  const journal = await def.mcp.audience_journal(c, { limit: 5 });
  assert.ok(journal.length >= 2 && journal[0].who === "assistant");
  assert.equal((await def.mcp.audience_journal(c, {})).length <= 30, true);
  assert.deepEqual(await def.mcp.audience_clear_room(c, { room: "polls" }), { room: "polls", cleared: true, participantsRemoved: 2 });
  await assert.rejects(def.mcp.audience_clear_room(c, { room: "polls1" }), (e) => e.expose === true);
  const before = c.api.store.writes.length; await def.mcp.audience_rooms(c, {}); await def.mcp.audience_journal(c, {});
  assert.equal(c.api.store.writes.length, before, "les lectures n'écrivent rien");
});

test("téléchargement du journal et sauvegarde lisible : tableur sûr (formules neutralisées), par pages, aucun pseudo ni code", async () => {
  const c = audienceCtx(); const s = bind(c);
  await s.join({ room: "polls", token: tok(1), pseudo: "Secret Pseudo" });
  await s.journal({ what: "=HYPERLINK(\"x\")", detail: "+cmd|' /C calc'!A0", who: "@SUM(1)" });
  for (let i = 0; i < 520; i++) await c.api.store.add("audit", { at: new Date(1_800_000_000_000 + i * 1000).toISOString(), who: "t", what: `ligne ${i}`, room: null, detail: "" });
  const dl = def.adminDownloads.journal;
  assert.equal(dl.right, "moderate"); assert.equal(dl.contentType, "text/csv");
  let csv = ""; for await (const part of dl.generate(c, {})) csv += part;
  assert.ok(csv.startsWith("﻿\"date\"")); assert.ok(csv.includes("'=HYPERLINK") && csv.includes("'+cmd") && csv.includes("'@SUM"), "formules neutralisées");
  assert.equal(csv.trim().split("\r\n").length, 522, "tout le journal, par pages de 500");
  const files = await def.backup.readable(c);
  assert.deepEqual(files.map((f) => f.path).sort(), ["journal.csv", "rooms.csv"]);
  for (const f of files) { assert.ok(!f.content.includes("Secret Pseudo") && !f.content.includes(tok(1))); assert.ok(f.content.startsWith("﻿")); }
  assert.ok(files.find((f) => f.path === "rooms.csv").content.includes("polls"));
});

test("cycle de vie : l'instance prépare son adresse secrète et la salle générale, une seule fois ; la suppression nettoie la mémoire", async () => {
  const c = audienceCtx();
  await def.hooks.onInstanceCreate(c); await def.hooks.onInstanceCreate(c);
  assert.equal((await c.api.store.list("meta")).filter((r) => r.data.k === "cfg").length, 1);
  assert.equal((await c.api.store.list("rooms")).filter((r) => r.data.k === "general").length, 1);
  K.over(c, "x", 1, 1000); assert.ok([...K.mem.hits.keys()].some((k) => k.startsWith(`${c.instance.key}|`)));
  await def.hooks.onInstanceDelete(c);
  assert.ok(![...K.mem.hits.keys()].some((k) => k.startsWith(`${c.instance.key}|`)));
  // deux créations de configuration en même temps : la plus ancienne gagne
  const c2 = audienceCtx(); await Promise.all(Array.from({ length: 6 }, () => K.ensureMeta(c2)));
  assert.equal((await c2.api.store.list("meta")).filter((r) => r.data.k === "cfg").length, 1);
});
