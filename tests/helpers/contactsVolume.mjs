// Mesure (processus séparé, `node --expose-gc --max-old-space-size=4096`) : import par pas, export en flux, aller-retour, doublons, sur N fiches.
//   node tests/helpers/contactsVolume.mjs 100000  →  JSON { n, … }
import fs from "node:fs";
import { memStore } from "./contactsStore.mjs";

const n = Number(process.argv[2] ?? 10_000);
const DIR = new URL("../../modules/contacts/", import.meta.url);
const messages = JSON.parse(fs.readFileSync(new URL("locales/en.json", DIR), "utf8"));
const def = (await import("../../modules/contacts/index.mjs")).default;
const I = await import("../../modules/contacts/import.mjs");
const DD = await import("../../modules/contacts/dedupe.mjs");
const D = await import("../../modules/contacts/data.mjs");
const C = await import("../../modules/contacts/csv.mjs");

let k = 0;
const mkCtx = (store) => ({
  instance: { id: `vol-${++k}` }, locale: "en", api: { store, services: { providers: async () => [], call: async () => ({ ok: false, reason: "unavailable" }) } },
  can: () => true, t: (key, vars = {}) => String(messages[key] ?? key).replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? `{${v}}`), __contactsTest: {},
});
const spy = (store) => {
  const seen = { maxPage: 0, maxAddMany: 0, maxListByKey: 0, calls: 0 };
  const { page, addMany, listByKey } = store;
  store.page = async (c, o) => { seen.calls++; seen.maxPage = Math.max(seen.maxPage, o?.limit ?? 100); return page(c, o); };
  store.addMany = async (c, l) => { seen.maxAddMany = Math.max(seen.maxAddMany, l.length); return addMany(c, l); };
  store.listByKey = async (c, key, o) => { seen.maxListByKey = Math.max(seen.maxListByKey, o?.limit ?? 100); return listByKey(c, key, o); };
  return seen;
};
const heapMB = () => { global.gc(); global.gc(); return Math.round(process.memoryUsage().heapUsed / 1e6); };

const orgs = Math.min(400, Math.max(5, Math.floor(n / 25)));
const persons = n - orgs; // le carnet est exactement plein à la fin (100 000 pour n = 100 000)
let csv = "name,type,organisation,email,accounts,categories,notes\n";
for (let o = 0; o < orgs; o++) csv += `Organisation ${o},organisation,,,web:org${o}.example.test,Partners,\n`;
for (let i = 0; i < persons; i++) csv += `Person ${i.toString(36)}x${i},,Organisation ${i % orgs},p${i}@example.test,twitch:user_${String(i).padStart(6, "0")} | youtube:@chan-${i},Cat ${i % 7},${i % 50 ? "" : '"2026-01-02 · admin\nA note."'}\n`;
const full = n >= D.LIMITS.maxContacts; // 100 000 lignes = le plafond du fichier ET du carnet : il se remplit exactement
const out = { n, rows: orgs + persons, full };

const store = memStore();
const seen = spy(store);
const ctx = mkCtx(store);
const t = {};
const lap = (name, since) => { t[name] = Date.now() - since; };

let t0 = Date.now();
const st = await I.stage(ctx, csv, { locale: "en" });
lap("stageMs", t0);
out.staged = st.ok ? st.job.data.total : st.error;
out.heapAfterStageMB = heapMB();
t0 = Date.now(); let steps = 0, job;
for (;;) { const r = await I.step(ctx, "preview", { budgetMs: 8000 }); steps++; job = r.job; if (job.data.state === "previewed") break; }
lap("previewMs", t0); out.previewSteps = steps; out.previewCounts = job.data.counts;
t0 = Date.now(); steps = 0;
for (;;) { const r = await I.step(ctx, "run", { budgetMs: 8000 }); steps++; job = r.job; if (job.data.state === "done") break; }
lap("runMs", t0); out.runSteps = steps; out.runCounts = job.data.counts;
out.jobBytes = JSON.stringify(job.data).length;
out.stagingLeft = await store.count("importRows");
out.cards = (await store.count("contacts")) + (await store.count("orgs"));
out.logDocs = await store.count("importLog");
out.heapAfterImportMB = heapMB();

// Export en flux.
t0 = Date.now();
let chunks = 0, maxLines = 0, lines = 0, bytes = 0, first = null;
const exported = [];
for await (const c of def.adminDownloads.contacts.generate(ctx)) {
  chunks++; bytes += c.length;
  const l = c.split("\r\n").length - 1; maxLines = Math.max(maxLines, l); lines += l;
  if (first === null) first = c.slice(0, 80);
  exported.push(c);
}
lap("exportMs", t0);
out.export = { chunks, maxLinesPerChunk: maxLines, lines, bytes };
const exportText = exported.join("");
exported.length = 0;

// Aller-retour dans un carnet neuf.
const store2 = memStore();
const ctx2 = mkCtx(store2);
for (let i = 0; i < 50; i++) await store2.add("padding", { i });
t0 = Date.now();
const st2 = await I.stage(ctx2, exportText.replace(/^﻿/, ""), { locale: "en" });
out.roundTripStaged = st2.ok ? st2.job.data.total : st2.error;
for (const mode of ["preview", "run"]) for (;;) { const r = await I.step(ctx2, mode, { budgetMs: 8000 }); if (!r.ok) throw new Error(`aller-retour : ${r.error}`); if (r.job.data.state === (mode === "run" ? "done" : "previewed")) { if (mode === "run") out.roundTripCounts = r.job.data.counts; break; } }
lap("roundTripMs", t0);
out.roundTripCards = (await store2.count("contacts")) + (await store2.count("orgs"));

// Réimporter le fichier d'origine dans le premier carnet : rien ne doit être créé.
await I.cancel(ctx);
t0 = Date.now();
await I.stage(ctx, csv, { locale: "en" });
for (;;) { const r = await I.step(ctx, "preview", { budgetMs: 8000 }); if (r.job.data.state === "previewed") { out.reimportCounts = r.job.data.counts; break; } }
lap("reimportPreviewMs", t0);
await I.cancel(ctx);

// Doublons.
t0 = Date.now();
const g = await DD.groups(ctx, { fresh: true });
lap("dedupeMs", t0); out.dupGroups = g.groups.length;
out.spy = seen;
out.limits = { maxContacts: D.LIMITS.maxContacts, maxRows: C.MAX_ROWS };
out.ms = t;
out.heapEndMB = heapMB();
console.log(JSON.stringify(out));
