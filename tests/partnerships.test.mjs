import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { parseManifest } from "@/core/modules/manifest";

const DIR = new URL("../modules/partnerships", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
const manifestJson = readJson("module.json");
const localeFiles = () => (fs.existsSync(`${DIR}/locales`) ? fs.readdirSync(`${DIR}/locales`).filter((f) => f.endsWith(".json")) : []);
const loadMessages = (lang) => (fs.existsSync(`${DIR}/locales/${lang}.json`) ? readJson(`locales/${lang}.json`) : {});
const source = fs.readFileSync(`${DIR}/index.mjs`, "utf8");
/** Contexte factice avec les vrais textes du module (langue donnée). */
const ctxFor = (lang = "en", opts = {}) => fakeCtx({ locale: lang, messages: loadMessages(lang), ...opts });

test("manifeste : valide pour parseManifest", () => {
  const r = parseManifest(manifestJson);
  assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(r.manifest.id, "partnerships");
});

test("manifeste : aucune action destructive n'est activée par défaut, aucune lecture seule n'est destructive", () => {
  for (const a of manifestJson.mcp ?? []) {
    if (a.destructive) assert.notEqual(a.default, true, `${a.name} destructive mais activée par défaut`);
    assert.ok(!(a.readOnly && a.destructive), a.name);
  }
});

test("manifeste : les réglages lus par le code (ctx.setting) existent tous dans module.json", () => {
  const declared = new Set([...(manifestJson.settings ?? []), ...(manifestJson.sections ?? []).flatMap((s) => s.options ?? [])].map((s) => s.key));
  const used = [...source.matchAll(/ctx\.setting\("([A-Za-z0-9_]+)"\)/g)].map((m) => m[1]);
  for (const key of used) assert.ok(declared.has(key), `réglage ${key} lu mais non déclaré`);
});

test("langues : les fichiers locales ont exactement les mêmes clés (parité en/fr)", () => {
  const files = localeFiles();
  if (!files.length) return;
  const keys = (f) => Object.keys(readJson(`locales/${f}`)).sort();
  assert.ok(files.includes("en.json") && files.includes("fr.json"));
  assert.deepEqual(keys("fr.json"), keys("en.json"));
  for (const f of files) for (const [k, v] of Object.entries(readJson(`locales/${f}`))) assert.ok(typeof v === "string" && v.trim(), `${f}:${k} vide`);
});

test("langues : chaque clé ctx.t(\"…\") utilisée statiquement par le code existe dans les textes", () => {
  const en = loadMessages("en");
  if (!Object.keys(en).length) return;
  for (const m of source.matchAll(/\bt\("([A-Za-z0-9_]+)"/g)) assert.ok(m[1] in en, `clé ${m[1]} absente de en.json`);
});

const def = (await import("../modules/partnerships/index.mjs")).default;
const actor = { name: "claude" };
const STATUSES = ["a_contacter", "envoye", "discussion", "accepte", "publie", "refuse_marque", "decline", "sans_reponse", "termine"];
const DAY = 86_400_000;
const isoDaysAgo = (n) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);
const find = (blocks, type) => blocks.filter((b) => b.type === type);

test("manifeste : MCP déclarés = MCP implémentés, aucun sujet/section/slot fantôme", () => {
  assert.deepEqual(manifestJson.mcp.map((a) => a.name).sort(), Object.keys(def.mcp).sort());
  assert.deepEqual(manifestJson.provides.map((p) => p.topic).sort(), Object.keys(def.exports).sort());
  assert.equal(manifestJson.page, false, "aucune page publique");
  assert.ok(!def.slots && !def.sections && !def.routes && !def.overlay, "aucun rendu public");
  assert.ok(manifestJson.permissions.includes("admin") && manifestJson.permissions.includes("storage") && manifestJson.permissions.includes("mcp") && manifestJson.permissions.includes("topics"));
  assert.equal(typeof def.adminPanel, "function");
  for (const name of ["savePartner", "deletePartner", "addJournal", "deleteJournal", "saveContact", "deleteContact"]) assert.equal(typeof def.adminActions[name], "function", name);
});

test("manifeste : suppressions MCP destructives et désactivées par défaut, le reste activé", () => {
  for (const name of ["partner_delete", "contact_delete"]) {
    const a = manifestJson.mcp.find((x) => x.name === name);
    assert.equal(a.destructive, true, name);
    assert.equal(a.default, false, `${name} doit être OFF par défaut`);
    assert.ok(!a.readOnly);
  }
  for (const a of manifestJson.mcp.filter((x) => !["partner_delete", "contact_delete"].includes(x.name))) {
    assert.equal(a.default, true, a.name);
    assert.ok(!a.destructive, a.name);
  }
  for (const name of ["partners_list", "partner_get", "contacts_list"]) assert.equal(manifestJson.mcp.find((x) => x.name === name).readOnly, true, name);
});

test("manifeste : statuts MCP = statuts du code et réglage followUpDays", () => {
  const list = manifestJson.mcp.find((x) => x.name === "partners_list").input.properties.status.enum;
  assert.deepEqual(list, STATUSES);
  assert.deepEqual(manifestJson.mcp.find((x) => x.name === "partner_update").input.properties.status.enum, STATUSES);
  assert.equal(manifestJson.settings.find((s) => s.key === "followUpDays").default, 14);
  const en = loadMessages("en"), fr = loadMessages("fr");
  for (const s of STATUSES) assert.ok(en[`s_${s}`] && fr[`s_${s}`], `texte du statut ${s}`);
});

// ── export ────────────────────────────────────────────────────────────────────
test("sujet partnership.partner : forme des éléments, URL dangereuse écartée, vide sans fiche", async () => {
  const ctx = ctxFor();
  assert.deepEqual(await def.exports["partnership.partner"](ctx), []);
  const a = await ctx.api.store.add("partners", { brand: "Acme", status: "discussion", url: "https://acme.test", logo: "/uploads/a.png" });
  const b = await ctx.api.store.add("partners", { brand: "Evil", status: "envoye", url: "javascript:alert(1)" });
  const items = await def.exports["partnership.partner"](ctx);
  const A = items.find((i) => i.id === a), B = items.find((i) => i.id === b);
  assert.deepEqual(A, { id: a, title: "Acme", status: "discussion", url: "https://acme.test", logo: "/uploads/a.png" });
  assert.equal(B.url, undefined);
  assert.equal(B.logo, undefined);
  assert.equal(B.title, "Evil");
});

test("sujet partnership.partner : ne fuit aucune donnée privée (contact, brief, mail…)", async () => {
  const ctx = ctxFor();
  await ctx.api.store.add("partners", { brand: "X", status: "envoye", contact: "secret@x.test", brief: "privé", mail: "brouillon" });
  await ctx.api.store.add("contacts", { name: "Bob", partnerId: "r1" });
  const items = await def.exports["partnership.partner"](ctx);
  assert.equal(items.length, 1, "seuls les partenaires, pas les contacts");
  assert.ok(!JSON.stringify(items).includes("secret@x.test") && !JSON.stringify(items).includes("privé"));
});

// ── actions d'admin ───────────────────────────────────────────────────────────
test("admin savePartner : création, nettoyage des champs et redirection vers la fiche", async () => {
  const ctx = ctxFor("fr");
  const r = await def.adminActions.savePartner(ctx, { id: "", brand: "  Marque  ", url: "https://m.test", sector: "Jeux", chances: "42", evil: "<script>", status: "" });
  assert.equal(r.ok, ctx.t("saved"));
  const [row] = await ctx.api.store.list("partners");
  assert.equal(r.redirect, `?partner=${row.id}`);
  assert.equal(row.data.brand, "Marque");
  assert.equal(row.data.status, "a_contacter");
  assert.equal(row.data.chances, 42);
  assert.equal(row.data.updatedBy, "admin");
  assert.equal("evil" in row.data, false, "champ inattendu ignoré");
});

test("admin savePartner : nom obligatoire (vide ou espaces), rien n'est enregistré", async () => {
  const ctx = ctxFor();
  for (const brand of [undefined, "", "   "]) assert.deepEqual(await def.adminActions.savePartner(ctx, { brand }), { error: "A brand name is required." });
  assert.equal(await ctx.api.store.count("partners"), 0);
});

test("admin savePartner : URL non http(s) vidée, /uploads/ conservé pour le logo, champs tronqués", async () => {
  const ctx = ctxFor();
  await def.adminActions.savePartner(ctx, { brand: "B", url: "javascript:alert(1)", logo: "/uploads/x.png", sector: "s".repeat(500) });
  await def.adminActions.savePartner(ctx, { brand: "C", url: "data:text/html,<b>", logo: "//evil.test/x.png" });
  const rows = await ctx.api.store.list("partners");
  const B = rows.find((r) => r.data.brand === "B").data, C = rows.find((r) => r.data.brand === "C").data;
  assert.equal(B.url, ""); assert.equal(B.logo, "/uploads/x.png"); assert.equal(B.sector.length, 120);
  assert.equal(C.url, ""); assert.equal(C.logo, "");
});

test("admin savePartner : statut inconnu → à contacter ; chances bornées 0-100, non numérique → vide", async () => {
  const ctx = ctxFor();
  const cases = [["150", 100], ["-9", 0], ["12.6", 13], ["abc", null], ["", null]];
  for (const [input, expected] of cases) {
    await def.adminActions.savePartner(ctx, { brand: `P${input}`, status: "hacked", chances: input });
  }
  const rows = await ctx.api.store.list("partners");
  for (const [input, expected] of cases) {
    const d = rows.find((r) => r.data.brand === `P${input}`).data;
    assert.equal(d.status, "a_contacter", input);
    assert.equal(d.chances, expected, `chances ${input}`);
  }
});

test("admin savePartner : modification conserve les champs non fournis, id inconnu → erreur", async () => {
  const ctx = ctxFor();
  const id = await ctx.api.store.add("partners", { brand: "Old", status: "envoye", sector: "Tech", chances: 10 });
  const r = await def.adminActions.savePartner(ctx, { id, brand: "New", status: "bogus" });
  assert.equal(r.redirect, `?partner=${id}`);
  const d = (await ctx.api.store.get(id)).data;
  assert.equal(d.brand, "New"); assert.equal(d.sector, "Tech"); assert.equal(d.chances, 10);
  assert.equal(d.status, "envoye", "statut invalide ignoré, ancien conservé");
  assert.deepEqual(await def.adminActions.savePartner(ctx, { id: "nope", brand: "X" }), { error: "Not found." });
  assert.equal(await ctx.api.store.count("partners"), 1);
});

test("admin deletePartner : supprime la fiche, son journal et ses contacts, pas ceux des autres", async () => {
  const ctx = ctxFor();
  const a = await ctx.api.store.add("partners", { brand: "A" });
  const b = await ctx.api.store.add("partners", { brand: "B" });
  await ctx.api.store.add("journal", { partnerId: a, date: "2026-01-01", text: "x" });
  await ctx.api.store.add("journal", { partnerId: b, date: "2026-01-01", text: "y" });
  await ctx.api.store.add("contacts", { partnerId: a, name: "n" });
  await ctx.api.store.add("contacts", { partnerId: b, name: "m" });
  const r = await def.adminActions.deletePartner(ctx, { id: a });
  assert.deepEqual(r, { ok: "Deleted.", redirect: "?" });
  assert.equal(await ctx.api.store.get(a), null);
  assert.equal(await ctx.api.store.count("journal"), 1);
  assert.equal(await ctx.api.store.count("contacts"), 1);
  assert.ok(await ctx.api.store.get(b));
});

test("admin journal : ajout validé (fiche existante, texte non vide), lien sûr, date par défaut", async () => {
  const ctx = ctxFor();
  const p = await ctx.api.store.add("partners", { brand: "A" });
  assert.deepEqual(await def.adminActions.addJournal(ctx, { partnerId: "nope", text: "x" }), { error: "Not found." });
  assert.deepEqual(await def.adminActions.addJournal(ctx, { partnerId: p, text: "   " }), { error: "Not found." });
  assert.equal(await ctx.api.store.count("journal"), 0);
  await def.adminActions.addJournal(ctx, { partnerId: p, text: "  Appel  ", date: "pas-une-date", link: "javascript:alert(1)" });
  await def.adminActions.addJournal(ctx, { partnerId: p, text: "Mail", date: "2026-02-03", link: "https://x.test/a" });
  const rows = await ctx.api.store.list("journal");
  const call = rows.find((r) => r.data.text === "Appel").data, mail = rows.find((r) => r.data.text === "Mail").data;
  assert.equal(call.link, ""); assert.equal(call.author, "admin");
  assert.match(call.date, /^\d{4}-\d{2}-\d{2}$/, "date invalide remplacée par aujourd'hui");
  assert.equal(mail.date, "2026-02-03"); assert.equal(mail.link, "https://x.test/a");
  assert.deepEqual(await def.adminActions.deleteJournal(ctx, { id: rows[0].id }), { ok: "Deleted." });
  assert.equal(await ctx.api.store.count("journal"), 1);
});

test("admin contacts : nom obligatoire, champs tronqués, statut actif, suppression", async () => {
  const ctx = ctxFor();
  assert.deepEqual(await def.adminActions.saveContact(ctx, { name: "  " }), { error: "A brand name is required." });
  const r = await def.adminActions.saveContact(ctx, { partnerId: "p1", name: "Alice", email: "a@x.test", phone: "1".repeat(200), role: "CEO" });
  assert.equal(r.ok, "Saved.");
  const [c] = await ctx.api.store.list("contacts");
  assert.equal(c.data.status, "active"); assert.equal(c.data.phone.length, 60); assert.equal(c.data.partnerId, "p1");
  await def.adminActions.deleteContact(ctx, { id: c.id });
  assert.equal(await ctx.api.store.count("contacts"), 0);
});

// ── panneau d'admin ───────────────────────────────────────────────────────────
test("adminPanel : vue d'ensemble vide → message, mention privée et formulaire de création", async () => {
  const blocks = await def.adminPanel(ctxFor("en"), { query: {} });
  assert.equal(blocks[0].type, "markdown");
  assert.match(blocks[0].text, /Private/);
  assert.ok(blocks.some((b) => b.type === "markdown" && b.text === "No partnership yet."));
  const form = find(blocks, "adminForm")[0];
  assert.equal(form.action, "savePartner");
  assert.equal(form.fields.find((f) => f.name === "brand").required, true);
  assert.deepEqual(form.fields.find((f) => f.name === "status").options.map((o) => o.value), STATUSES);
  assert.equal(find(blocks, "table").length, 0);
});

test("adminPanel : tri par urgence, compteur des fiches ouvertes, relance due signalée", async () => {
  const ctx = ctxFor("en", { settings: { followUpDays: 7 } });
  const mk = (brand, status) => ctx.api.store.add("partners", { brand, status });
  await mk("Zeta", "termine"); await mk("Beta", "a_contacter"); await mk("Alpha", "discussion"); await mk("Gamma", "accepte");
  const sent = await mk("Delta", "envoye");
  await ctx.api.store.add("journal", { partnerId: sent, date: isoDaysAgo(30), text: "mail" });
  const blocks = await def.adminPanel(ctx, { query: {} });
  const table = find(blocks, "table")[0];
  assert.deepEqual(table.rows.map((r) => r[0]), ["Alpha", "Gamma", "Delta", "Beta", "Zeta"]);
  assert.match(table.rows[2][1], /⏰/);
  assert.ok(!table.rows[0][1].includes("⏰"));
  assert.equal(table.rowIds.length, 5);
  assert.ok(blocks.some((b) => b.type === "heading" && b.text === "Overview (4)"), "4 fiches non closes");
  assert.equal(table.rows[2][3], isoDaysAgo(30));
});

test("adminPanel : fiche détaillée (journal trié, contacts à relire, actions de suppression dangereuses)", async () => {
  const ctx = ctxFor("en");
  const p = await ctx.api.store.add("partners", { brand: "Acme", status: "discussion", chances: 0, url: "https://acme.test", brief: "Note" });
  await ctx.api.store.add("journal", { partnerId: p, date: "2026-01-01", author: "admin", text: "Premier" });
  await ctx.api.store.add("journal", { partnerId: p, date: "2026-03-01", author: "agent:x", text: "Second", link: "https://l.test" });
  await ctx.api.store.add("journal", { partnerId: "autre", date: "2026-02-01", author: "admin", text: "Autre" });
  await ctx.api.store.add("contacts", { partnerId: p, name: "Bob", status: "to_review", email: "b@x.test" });
  const blocks = await def.adminPanel(ctx, { query: { partner: p } });
  assert.ok(blocks.some((b) => b.type === "heading" && b.text === "Acme"));
  const md = blocks.find((b) => b.type === "markdown" && b.text.includes("Status")).text;
  assert.match(md, /In discussion/); assert.match(md, /\*\*Chances \(0-100\)\*\* : 0/, "0 % affiché (pas masqué)");
  const tables = find(blocks, "table");
  const journal = tables.find((t) => t.columns[0] === "Date");
  assert.deepEqual(journal.rows.map((r) => r[2]), ["Second\nhttps://l.test", "Premier"], "plus récent d'abord, sans l'entrée d'un autre partenaire");
  assert.ok(journal.rowActions[0].danger && journal.rowActions[0].confirm);
  const people = tables.find((t) => t.columns[0] === "Name");
  assert.equal(people.rows[0][0], "Bob (to review)");
  const top = tables[0];
  const del = top.rowActions.find((a) => a.action === "deletePartner");
  assert.ok(del.danger && del.confirm, "suppression de fiche confirmée et dangereuse");
  const actions = find(blocks, "adminForm").map((f) => f.action);
  assert.deepEqual(actions, ["addJournal", "saveContact"]);
  for (const f of find(blocks, "adminForm")) assert.equal(f.fields.find((x) => x.name === "partnerId").value, p);
});

test("adminPanel : modification d'une fiche (formulaire prérempli) ; id inconnu → vue d'ensemble", async () => {
  const ctx = ctxFor("en");
  const p = await ctx.api.store.add("partners", { brand: "Acme", status: "envoye", sector: "Tech" });
  const blocks = await def.adminPanel(ctx, { query: { edit: p } });
  assert.equal(blocks.length, 2);
  const form = blocks[1];
  assert.equal(form.fields.find((f) => f.name === "id").value, p);
  assert.equal(form.fields.find((f) => f.name === "brand").value, "Acme");
  assert.equal(form.fields.find((f) => f.name === "status").value, "envoye");
  assert.equal(form.cancelHref, `?partner=${p}`);
  const unknown = await def.adminPanel(ctx, { query: { edit: "nope", partner: "nope" } });
  assert.equal(find(unknown, "table").length, 1, "retombe sur la liste");
});

test("adminPanel : textes en français ; texte absent → clé (pas de plantage)", async () => {
  const blocks = await def.adminPanel(ctxFor("fr"), { query: {} });
  assert.match(blocks[0].text, /Privé/i);
  const bare = await def.adminPanel(fakeCtx(), { query: {} });
  assert.ok(bare.length > 1);
});

// ── MCP ───────────────────────────────────────────────────────────────────────
test("MCP partner_create : fiche créée avec signature de l'agent, URL dangereuse nettoyée", async () => {
  const ctx = ctxFor();
  const { id } = await def.mcp.partner_create(ctx, { brand: "Nova", url: "javascript:x", chances: 55, status: "discussion", logo: "http://evil.test/l.png" }, actor);
  const d = (await ctx.api.store.get(id)).data;
  assert.equal(d.brand, "Nova"); assert.equal(d.status, "discussion"); assert.equal(d.chances, 55);
  assert.equal(d.url, ""); assert.equal(d.updatedBy, "agent:claude");
  const def2 = (await ctx.api.store.get((await def.mcp.partner_create(ctx, { brand: "Y" }, actor)).id)).data;
  assert.equal(def2.status, "a_contacter");
});

test("MCP partner_create : une fiche sans nom est refusée (comme dans l'admin)", async () => {
  const ctx = ctxFor();
  await assert.rejects(() => def.mcp.partner_create(ctx, { brand: "   " }, actor));
  assert.equal(await ctx.api.store.count("partners"), 0);
});

test("MCP partner_update : mise à jour partielle, retourne les champs, introuvable → erreur exposée", async () => {
  const ctx = ctxFor();
  const id = await ctx.api.store.add("partners", { brand: "A", status: "a_contacter", sector: "S" });
  assert.deepEqual(await def.mcp.partner_update(ctx, { id, status: "envoye", chances: 20 }, actor), { id, updated: ["status", "chances"] });
  const d = (await ctx.api.store.get(id)).data;
  assert.equal(d.status, "envoye"); assert.equal(d.sector, "S"); assert.equal(d.updatedBy, "agent:claude");
  await assert.rejects(() => def.mcp.partner_update(ctx, { id: "nope" }, actor), (e) => e.expose === true && /not found/.test(e.message));
});

test("MCP partner_update : ne peut pas vider le nom d'une fiche", async () => {
  const ctx = ctxFor();
  const id = await ctx.api.store.add("partners", { brand: "A", status: "envoye" });
  await def.mcp.partner_update(ctx, { id, brand: "  " }, actor).catch(() => {});
  assert.equal((await ctx.api.store.get(id)).data.brand, "A");
});

test("MCP partner_log : entrée signée, date par défaut, lien filtré ; fiche inconnue → erreur", async () => {
  const ctx = ctxFor();
  const id = await ctx.api.store.add("partners", { brand: "A" });
  const { id: eid } = await def.mcp.partner_log(ctx, { id, text: "  Relancé  ", link: "ftp://x", date: "2026-04-01" }, actor);
  const e = (await ctx.api.store.get(eid)).data;
  assert.deepEqual({ ...e }, { partnerId: id, date: "2026-04-01", author: "agent:claude", text: "Relancé", link: "" });
  const e2 = (await ctx.api.store.get((await def.mcp.partner_log(ctx, { id, text: "x", date: "demain" }, actor)).id)).data;
  assert.equal(e2.date, new Date().toISOString().slice(0, 10), "date invalide → aujourd'hui");
  await assert.rejects(() => def.mcp.partner_log(ctx, { id: "nope", text: "x" }, actor), (e) => e.expose);
});

test("MCP partner_log : une note vide est refusée (comme dans l'admin)", async () => {
  const ctx = ctxFor();
  const id = await ctx.api.store.add("partners", { brand: "A" });
  await def.mcp.partner_log(ctx, { id, text: "   " }, actor).catch(() => {});
  assert.equal(await ctx.api.store.count("journal"), 0);
});

test("MCP partners_list : filtre par statut et par texte, relance due, activité", async () => {
  const ctx = ctxFor("en", { settings: { followUpDays: 10 } });
  const a = await ctx.api.store.add("partners", { brand: "Alpha", status: "envoye", sector: "Jeux" });
  await ctx.api.store.add("partners", { brand: "Beta", status: "discussion", sector: "Mode" });
  await ctx.api.store.add("journal", { partnerId: a, date: isoDaysAgo(40), text: "x" });
  const all = await def.mcp.partners_list(ctx, {});
  assert.equal(all.length, 2);
  const A = all.find((x) => x.brand === "Alpha");
  assert.deepEqual(Object.keys(A).sort(), ["brand", "chances", "followUpDue", "id", "lastActivity", "status"]);
  assert.equal(A.followUpDue, true); assert.equal(A.chances, null); assert.equal(A.lastActivity, isoDaysAgo(40));
  assert.equal(all.find((x) => x.brand === "Beta").followUpDue, false, "relance seulement pour le statut envoyé");
  assert.deepEqual((await def.mcp.partners_list(ctx, { status: "discussion" })).map((x) => x.brand), ["Beta"]);
  assert.deepEqual((await def.mcp.partners_list(ctx, { q: "MODE" })).map((x) => x.brand), ["Beta"]);
  assert.deepEqual(await def.mcp.partners_list(ctx, { q: "zzz" }), []);
});

test("relance : seuil réglable (défaut 14 jours), activité récente du journal l'annule", async () => {
  const ctx = ctxFor();
  const p = await ctx.api.store.add("partners", { brand: "A", status: "envoye" });
  await ctx.api.store.add("journal", { partnerId: p, date: isoDaysAgo(20), text: "x" });
  assert.equal((await def.mcp.partners_list(ctx, {}))[0].followUpDue, true, "20 j > 14 j");
  await ctx.api.store.add("journal", { partnerId: p, date: isoDaysAgo(2), text: "y" });
  assert.equal((await def.mcp.partners_list(ctx, {}))[0].followUpDue, false);
  const strict = ctxFor("en", { settings: { followUpDays: 1 } });
  const q = await strict.api.store.add("partners", { brand: "B", status: "envoye" });
  await strict.api.store.add("journal", { partnerId: q, date: isoDaysAgo(5), text: "x" });
  assert.equal((await def.mcp.partners_list(strict, {}))[0].followUpDue, true);
  const bad = ctxFor("en", { settings: { followUpDays: "n'importe quoi" } });
  const r = await bad.api.store.add("partners", { brand: "C", status: "envoye" });
  await bad.api.store.add("journal", { partnerId: r, date: isoDaysAgo(20), text: "x" });
  assert.equal((await def.mcp.partners_list(bad, {}))[0].followUpDue, true, "réglage invalide → 14 j");
});

test("relance : date de journal illisible ignorée sans plantage", async () => {
  const ctx = ctxFor();
  const p = await ctx.api.store.add("partners", { brand: "A", status: "envoye" });
  await ctx.api.store.add("journal", { partnerId: p, date: "n'importe quoi", text: "x" });
  const [row] = await def.mcp.partners_list(ctx, {});
  assert.equal(row.followUpDue, false);
  assert.match(row.lastActivity, /^\d{4}-\d{2}-\d{2}$/);
});

test("MCP partner_get : fiche + journal + contacts liés uniquement ; inconnu → erreur exposée", async () => {
  const ctx = ctxFor();
  const p = await ctx.api.store.add("partners", { brand: "A", status: "publie" });
  await ctx.api.store.add("journal", { partnerId: p, date: "2026-01-01", text: "oui" });
  await ctx.api.store.add("journal", { partnerId: "x", date: "2026-01-01", text: "non" });
  await ctx.api.store.add("contacts", { partnerId: p, name: "Bob" });
  await ctx.api.store.add("contacts", { partnerId: "x", name: "Eve" });
  const r = await def.mcp.partner_get(ctx, { id: p });
  assert.equal(r.brand, "A"); assert.equal(r.id, p);
  assert.deepEqual(r.journal.map((j) => j.text), ["oui"]);
  assert.deepEqual(r.contacts.map((c) => c.name), ["Bob"]);
  await assert.rejects(() => def.mcp.partner_get(ctx, { id: "nope" }), (e) => e.expose && e.message === "partnership not found");
});

test("MCP contacts : création « à relire », liste filtrée, mise à jour partielle et tronquée", async () => {
  const ctx = ctxFor();
  const r = await def.mcp.contact_create(ctx, { name: " Bob ", email: "b@x.test", partner_id: "p1", notes: "n".repeat(6000), role: "R" }, actor);
  assert.equal(r.status, "to_review");
  await def.mcp.contact_create(ctx, { name: "Eve" }, actor);
  const d = (await ctx.api.store.get(r.id)).data;
  assert.equal(d.name, "Bob"); assert.equal(d.notes.length, 5000); assert.equal(d.updatedBy, "agent:claude"); assert.equal(d.partnerId, "p1");
  assert.deepEqual((await def.mcp.contacts_list(ctx, { partner_id: "p1" })).map((c) => c.name), ["Bob"]);
  assert.equal((await def.mcp.contacts_list(ctx, {})).length, 2);
  assert.deepEqual(await def.mcp.contact_update(ctx, { id: r.id, role: "CEO", partner_id: "p2" }, actor), { id: r.id });
  const u = (await ctx.api.store.get(r.id)).data;
  assert.equal(u.role, "CEO"); assert.equal(u.partnerId, "p2"); assert.equal(u.name, "Bob", "le reste est conservé");
  await assert.rejects(() => def.mcp.contact_update(ctx, { id: "nope" }, actor), (e) => e.expose && /contact not found/.test(e.message));
});

test("MCP contact_create : un contact sans nom est refusé", async () => {
  const ctx = ctxFor();
  await def.mcp.contact_create(ctx, { name: "  " }, actor).catch(() => {});
  assert.equal(await ctx.api.store.count("contacts"), 0);
});

test("MCP partner_delete / contact_delete : suppriment en cascade ; inconnu → erreur, rien n'est supprimé", async () => {
  const ctx = ctxFor();
  const a = await ctx.api.store.add("partners", { brand: "A" });
  const b = await ctx.api.store.add("partners", { brand: "B" });
  await ctx.api.store.add("journal", { partnerId: a, text: "x", date: "2026-01-01" });
  const c = await ctx.api.store.add("contacts", { partnerId: a, name: "n" });
  await ctx.api.store.add("contacts", { partnerId: b, name: "m" });
  await assert.rejects(() => def.mcp.partner_delete(ctx, { id: "nope" }), (e) => e.expose);
  assert.equal(await ctx.api.store.count("partners"), 2);
  assert.deepEqual(await def.mcp.partner_delete(ctx, { id: a }), { deleted: a });
  assert.equal(await ctx.api.store.count("journal"), 0);
  assert.equal(await ctx.api.store.count("contacts"), 1);
  assert.equal(await ctx.api.store.get(c), null);
  const m = (await ctx.api.store.list("contacts"))[0];
  await assert.rejects(() => def.mcp.contact_delete(ctx, { id: "nope" }), (e) => e.expose);
  assert.deepEqual(await def.mcp.contact_delete(ctx, { id: m.id }), { deleted: m.id });
});

test("stockage : les collections utilisées sont partners / journal / contacts uniquement", async () => {
  const ctx = ctxFor();
  const p = await ctx.api.store.add("partners", { brand: "A" });
  await def.mcp.partner_log(ctx, { id: p, text: "x" }, actor);
  await def.mcp.contact_create(ctx, { name: "n" }, actor);
  assert.equal(await ctx.api.store.count("journal"), 1);
  assert.equal(await ctx.api.store.count("contacts"), 1);
  assert.equal(await ctx.api.store.count("partners"), 1);
  assert.ok(!/store\.(add|list)\("(?!partners|journal|contacts)/.test(source) );
});

test("le texte saisi n'est jamais interprété : transmis tel quel (échappement par le rendu du cœur), pas d'appel réseau", async () => {
  const ctx = ctxFor();
  await ctx.api.store.add("partners", { brand: "<img src=x onerror=1>", status: "envoye" });
  const items = await def.exports["partnership.partner"](ctx);
  assert.equal(items[0].title, "<img src=x onerror=1>");
  assert.ok(!/\bfetch\(|node:http|node:net/.test(source));
});

const partnersMod = await import("../modules/partnerships/index.mjs");

test("import CSV : lecture (séparateur détecté, guillemets, retours à la ligne), création, complétion sans écrasement, relance sans doublon", async () => {
  assert.deepEqual(partnersMod.parseCsv('brand;url\r\n"Acme; Inc";"https://a.io"\r\n\r\nB;'), [["brand", "url"], ["Acme; Inc", "https://a.io"], ["B", ""]]);
  assert.deepEqual(partnersMod.parseCsv('brand,brief\n"Une ""marque""","ligne 1\nligne 2"'), [["brand", "brief"], ['Une "marque"', "ligne 1\nligne 2"]]);

  const ctx = ctxFor("en");
  await ctx.api.store.add("partners", { brand: "Acme", status: "discussion", sector: "" });
  const csv = [
    "brand,status,url,sector,country,hack,chances",
    'Acme,envoye,https://acme.io,Gaming,BE,x,40',                // existante : complétée, statut conservé
    'Nova,pas-un-statut,javascript:alert(1),Tech,FR,y,150',       // nouvelle : statut inconnu → a_contacter, url dangereuse vidée, chances bornées
    ",ignoree,,,,,",                                              // sans marque : ignorée
  ].join("\n");
  const r = await partnersMod.importPartners(ctx, csv);
  assert.deepEqual([r.created, r.completed, r.skipped], [1, 1, 1]);
  const rows = (await ctx.api.store.list("partners")).map((x) => x.data);
  const acme = rows.find((p) => p.brand === "Acme"), nova = rows.find((p) => p.brand === "Nova");
  assert.deepEqual([acme.status, acme.sector, acme.url, acme.country], ["discussion", "Gaming", "https://acme.io", "BE"], "complétée, statut jamais écrasé");
  assert.deepEqual([nova.status, nova.url, nova.chances], ["a_contacter", "", 100]);
  assert.ok(!("hack" in nova) && !("hack" in acme), "colonnes inconnues écartées");
  const again = await partnersMod.importPartners(ctx, csv);
  assert.deepEqual([again.created, again.completed], [0, 0], "relancer ne change rien");
  assert.equal(await ctx.api.store.count("partners"), 2);
  assert.equal((await partnersMod.importPartners(ctx, "url\nx")).error, "noBrand");
  assert.equal((await partnersMod.importPartners(ctx, "brand")).error, "empty");
});
