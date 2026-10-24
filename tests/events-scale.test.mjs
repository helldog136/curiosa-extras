// Événements : petits sites (3 rendez-vous) comme grands (2 000) — bornes, pages de 50 au plus, liste gardée 20 secondes, rien en arrière-plan.
import test from "node:test";
import assert from "node:assert/strict";
import { def, ctxFor, addEvent, M, D, O, CSV, X, rows, html, page } from "./helpers/eventsKit.mjs";

async function big(n = 2000) {
  const ctx = ctxFor();
  for (let i = 0; i < n; i++) {
    const year = i % 2 ? 2031 : 2020;
    const doc = M.blank({ title: `Rendez-vous numéro ${i} avec un titre assez long pour ressembler à la vraie vie`, slug: `rdv-${i}`, status: i % 11 === 0 ? "draft" : "published", date: `${year}-${String(1 + (i % 12)).padStart(2, "0")}-${String(1 + (i % 27)).padStart(2, "0")}`, time: "18:00", place: "Quelque part", text: "Du texte. ".repeat(40), type: i % 3 ? "atelier" : "", program: [{ time: "18:00", end: "", title: "Accueil", text: "" }], speakers: [{ name: "Camille", role: "", link: "" }] });
    await ctx.api.store.add("ev_events", M.toDoc(doc));
  }
  return ctx;
}

test("2 000 événements : la page se construit vite, la liste lue est gardée 20 secondes, 50 par page au plus", async () => {
  const ctx = await big();
  let reads = 0;
  const page0 = ctx.api.store.page;
  ctx.api.store.page = (...a) => { reads++; return page0(...a); };
  const t0 = Date.now();
  const h = await html(ctx);
  assert.ok(Date.now() - t0 < 3000, `première page : ${Date.now() - t0} ms`);
  const readsAfterFirst = reads;
  assert.ok(readsAfterFirst >= 2 && readsAfterFirst <= 4, `lectures du stockage : ${readsAfterFirst}`);
  assert.equal((h.match(/class="ev-card /g) ?? []).length, 12);
  const t1 = Date.now();
  for (let i = 0; i < 20; i++) await html(ctx, ["p", String(1 + (i % 5))]);
  assert.ok((Date.now() - t1) / 20 < 150, `pages suivantes : ${(Date.now() - t1) / 20} ms en moyenne`);
  assert.equal(reads, readsAfterFirst, "aucune relecture du stockage pendant 20 secondes");
  await O.createEvent(ctx, { title: "Un de plus ?", date: "2031-01-01" });
  assert.equal(rows(ctx, "ev_events").length, 2000);
  const pageMax = ctxFor({ perPage: 50 });
  for (let i = 0; i < 120; i++) await addEvent(pageMax, { title: `E${i}`, date: "2032-01-01" });
  assert.equal(((await html(pageMax)).match(/class="ev-card /g) ?? []).length, 50);
});

test("2 000 événements : calendrier, rétrospective, recherche, fiche, source et lieux restent rapides et bornés", async () => {
  const ctx = await big();
  await ctx.api.store.add("ev_types", { key: "atelier", names: { fr: "Atelier" }, color: "teal", icon: "", pos: 1 });
  D.drop(ctx);
  const time = async (label, fn, max = 3000) => { const t = Date.now(); const r = await fn(); const ms = Date.now() - t; assert.ok(ms < max, `${label} : ${ms} ms`); return r; };
  await time("chargement", () => D.load(ctx, { fresh: true }));
  assert.match(await time("calendrier", () => html(ctx, ["cal", "2031-01"]), 1000), /<table class="ev-cal">/);
  assert.equal(((await time("rétrospective", () => html(ctx, ["past"]), 1000)).match(/class="ev-card /g) ?? []).length, 12);
  assert.match(await time("recherche", () => html(ctx, ["q", "numero-1999"]), 1000), /numéro 1999|numero 1999/);
  await time("fiche", () => page(ctx, ["e", "rdv-1999"]), 1000);
  assert.equal((await time("event.source", () => def.services["event.source"].upcoming(ctx, { limit: 1e9 }), 1000)).events.length, 100);
  assert.ok(await time("export", async () => { let n = 0; for await (const chunk of CSV.exportLines(ctx)) n += chunk.length; return n; }, 5000) > 100_000);
  const list = await time("assistant", () => def.mcp.agenda_list_events(ctx, { when: "all", limit: 100 }), 1000);
  assert.equal(list.items.length, 100); assert.ok(list.next); assert.equal(list.total, 2000);
});

test("petit site : trois rendez-vous, aucune pagination, aucune configuration", async () => {
  const ctx = ctxFor();
  for (const [i, d] of ["2031-03-01", "2031-03-02", "2031-03-03"].entries()) await addEvent(ctx, { title: `R${i}`, date: d });
  const h = await html(ctx);
  assert.equal((h.match(/class="ev-card /g) ?? []).length, 3);
  assert.ok(!h.includes(`<nav class="ev-pager"`));
  assert.ok(!h.includes('class="ev-chips"'));
});

test("rien en arrière-plan : le module n'a ni tâche planifiée ni minuteur qui tourne", async () => {
  assert.equal(def.tasks, undefined);
  const before = process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;
  const ctx = ctxFor();
  await addEvent(ctx, { slug: "x", title: "X", date: "2031-03-01" });
  await html(ctx); await html(ctx, ["e", "x"]); await def.services["event.source"].upcoming(ctx, {});
  assert.ok(process.getActiveResourcesInfo().filter((r) => r === "Timeout").length <= before + 1);
  assert.equal(X.LIMITS.events, 2000);
});

test("limites dures : titre, texte, programme, intervenants — jamais de valeur sans borne", async () => {
  const ctx = ctxFor();
  const r = await O.createEvent(ctx, { title: "T".repeat(500), date: "2031-03-01", program: Array.from({ length: 41 }, (_, i) => `10:${String(i).padStart(2, "0")} Créneau`).join("\n") });
  assert.equal(r.errors.program.code, "programMany");
  const ok = await O.createEvent(ctx, { title: "T".repeat(500), date: "2031-03-01", text: "x".repeat(50_000), place: "p".repeat(900) });
  const e = rows(ctx, "ev_events").find((x) => x.id === ok.id);
  assert.deepEqual([e.title.length, e.text.length, e.place.length], [120, 8000, 160]);
  assert.equal((await O.createEvent(ctx, { title: "S", date: "2031-03-01", speakers: Array.from({ length: 21 }, (_, i) => `Personne ${i}`).join("\n") })).errors.speakers.code, "speakersMany");
});
