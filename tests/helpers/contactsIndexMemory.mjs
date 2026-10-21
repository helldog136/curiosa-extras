// Mesure (processus séparé, `node --expose-gc`) : mémoire de l'index de Contacts par fiche, et durée de sa reconstruction.
//   node --expose-gc tests/helpers/contactsIndexMemory.mjs 50000  →  JSON { n, bytesPerCard, buildMs, searchMs }
import { memStore } from "./contactsStore.mjs";

const n = Number(process.argv[2] ?? 50_000);
const data = await import("../../modules/contacts/data.mjs");
const book = await import("../../modules/contacts/book.mjs");
const store = memStore();
const rows = [];
for (let i = 0; i < n; i++) {
  rows.push({ collection: "contacts", key: i % 2 ? `e:p${i}@example.test` : null, data: {
    kind: "person", name: `Personne Numéro ${i}`, status: i % 50 ? "active" : "to_review", source: "manual", role: "", email: i % 2 ? `p${i}@example.test` : "", phone: "", others: "", relation: "",
    orgId: null, categoryIds: i % 3 ? [] : ["k1"], photo: null,
    accounts: [{ id: `a${i}`, network: "twitch", handle: `chaine_${i}`, url: `https://www.twitch.tv/chaine_${i}`, displayName: `Chaîne ${i}` }, ...(i % 4 ? [] : [{ id: `b${i}`, network: "youtube", handle: `@chaine${i}`, url: null }])],
  } });
}
store.seed(rows);
const ctx = { instance: { id: "mem" }, api: { store } };
global.gc(); global.gc();
const before = process.memoryUsage().heapUsed;
const t0 = Date.now();
const idx = await data.getIndex(ctx, { waitMs: 120_000 });
const buildMs = Date.now() - t0;
global.gc(); global.gc();
const after = process.memoryUsage().heapUsed;
const t1 = Date.now();
const r = book.searchIds(idx, { q: "chaine_4242", limit: 30 });
const searchMs = Date.now() - t1;
console.log(JSON.stringify({ n: idx.list.length, bytesPerCard: Math.round((after - before) / n), buildMs, searchMs, first: r.ids[0] === rows[4242] ? true : r.total > 0 }));
