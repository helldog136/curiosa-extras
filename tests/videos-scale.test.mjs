// Vidéothèque : le passage à l'échelle. 5 000 vidéos : lecture par pages, catalogue à 50 par page, curseur sans trou, recherche, administration à 25 par page, bornes dures, mémoire qui expire.
import test from "node:test";
import assert from "node:assert/strict";
import { ctxFor, def, D, P, S, pageHtml } from "./helpers/videosKit.mjs";

const N = 5000;
const rows = Array.from({ length: N }, (_, i) => ({ n: i + 1, provider: "youtube", ext: `x${String(i + 1).padStart(10, "0")}`, title: `Titre ${i + 1} ${i % 100 === 0 ? "spécial" : ""}`.trim(), status: i % 10 === 9 ? "draft" : "published", date: `20${String(20 + (i % 7))}-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`, cat: 0, thumb: false }));
const big = (settings = {}) => ctxFor(settings, { rows: { vid_items: rows } });

test("5 000 vidéos : lecture rapide et parcours à 50 par page, chaque vidéo une seule fois dans l'ordre", async () => {
  const ctx = big({ perPage: 50 });
  const t0 = Date.now();
  const snap = await D.snapshot(ctx);
  assert.equal(snap.items.length, N); assert.ok(Date.now() - t0 < 3000);
  const published = rows.filter((r) => r.status === "published").length;
  const seen = [];
  let segs = [], pages = 0;
  for (; pages < 200; pages++) {
    const html = (await def.page(ctx, { segments: segs })).blocks[0].html;
    const found = [...html.matchAll(/href="\/videos\/v\/(\d+)-/g)].map((m) => Number(m[1]));
    assert.ok(found.length <= 50);
    seen.push(...found);
    const next = /rel="next" href="([^"]+)"/.exec(html);
    if (!next) break;
    segs = next[1].split("/").slice(2);
  }
  assert.equal(seen.length, published); assert.equal(new Set(seen).size, published); assert.equal(pages + 1, Math.ceil(published / 50));
  assert.deepEqual(seen, snap.items.filter(D.isPublic).map((x) => x.n));
});

test("5 000 vidéos : recherche, service et administration restent bornés et rapides", async () => {
  const ctx = big();
  const t0 = Date.now();
  const html = await pageHtml(ctx, ["s", "special"]);
  assert.ok(Date.now() - t0 < 1500);
  assert.equal([...html.matchAll(/class="vl-ct"/g)].length, 12);
  const page = await S.list(ctx, { limit: 50 });
  assert.equal(page.items.length, 50); assert.ok(page.next);
  const panel = await def.adminPanel(ctx, { query: {} });
  assert.equal(panel.find((b) => b.type === "table" && b.columns.includes("Titre")).rows.length, 25);
  assert.ok(JSON.stringify(panel).length < 120_000);
  assert.equal((await def.adminPanel(ctx, { query: { page: "200" } })).find((b) => b.type === "table" && b.columns.includes("Titre")).rows.length, 25);
});

test("la mémoire est partagée entre visiteurs (une seule lecture), expire, et se vide à chaque écriture", async () => {
  const ctx = big();
  let reads = 0;
  const page = ctx.api.store.page.bind(ctx.api.store);
  ctx.api.store.page = async (...a) => { reads++; return page(...a); };
  await Promise.all(Array.from({ length: 20 }, () => def.page(ctx, { segments: [] })));
  const first = reads;
  assert.ok(first <= 8, `lectures simultanées partagées : ${first}`);
  await def.page(ctx, { segments: [] });
  assert.equal(reads, first);
  D.timing.ttlMs = 0;
  try { await def.page(ctx, { segments: [] }); assert.ok(reads > first); } finally { D.timing.ttlMs = 20_000; }
  const before = reads;
  await D.updateVideo(ctx, 1, { title: "Changé" });
  await def.page(ctx, { segments: [] });
  assert.ok(reads > before);
});

test("la 5001e vidéo est refusée ; les bornes de texte tiennent", async () => {
  const r = await D.addVideos(big(), [{ provider: "youtube", ext: "zzzzzzzzzz1", title: "De trop" }]);
  assert.deepEqual([r.added.length, r.full], [0, 1]);
  assert.equal(P.clean("é".repeat(500), 150).length, 150);
  assert.equal([...P.clean("😀".repeat(500), 150)].length, 150);
});
