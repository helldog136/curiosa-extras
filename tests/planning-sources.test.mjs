// Le Planning 2.0 consomme `calendar.event` : plusieurs sources fusionnées et triées, jeu depuis la description puis la catégorie, annulés, pastille de source, plage demandée, messages sans source.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";

const mod = await import("../modules/planning/index.mjs");
const def = mod.default;
const fr = JSON.parse(fs.readFileSync(new URL("../modules/planning/locales/fr.json", import.meta.url), "utf8"));
const en = JSON.parse(fs.readFileSync(new URL("../modules/planning/locales/en.json", import.meta.url), "utf8"));
const H = 3_600_000;
const at = (h) => new Date(Date.now() + h * H).toISOString();
const item = (id, h, over = {}) => ({ id, title: `T-${id}`, start: at(h), end: at(h + 1), ...over });
const provider = (label, color, kind = "ical", over = {}) => ({ instance: label, name: label, methods: { describe: () => ({ kind, label, color, active: true, state: "ok", ...over }) } });

/** Un Planning branché sur des sources : `byProvider` = { étiquette: [évènements] }. Le faux cœur appelle la fonction avec { limit, from, to } comme le vrai. */
function planning({ byProvider = {}, settings = {}, locale = "fr", over = {} } = {}) {
  const seen = [];
  const ctx = fakeCtx({
    settings: { days: 7, timezone: "UTC", ...settings }, messages: fr, locale, rawgConfigured: false,
    serviceInstances: { "calendar.provider": Object.keys(byProvider).map((l) => provider(l, byProvider[l].color ?? null)) },
    topics: { "calendar.event": (o) => { seen.push(o); return Object.values(byProvider).flatMap((v) => v.items ?? v); } },
    ...over,
  });
  return { ctx, seen };
}

test("collecte : demande le sujet « calendar.event » sur la fenêtre affichée (jours réglés), avec une limite ; les sources sont fusionnées et triées par début", async () => {
  const { ctx, seen } = planning({ byProvider: { A: [item("a2", 30, { sourceLabel: "A" }), item("a1", 5, { sourceLabel: "A" })], B: [item("b1", 10, { sourceLabel: "B" })] }, settings: { days: 3 } });
  const t0 = Date.now();
  const html = (await def.sections.upcoming(ctx, { count: 10 }))[1].html;
  assert.equal(seen.length, 1);
  assert.ok(seen[0].from instanceof Date && seen[0].to instanceof Date && seen[0].limit >= 100);
  assert.ok(Math.abs(seen[0].from.getTime() - t0) < 5000);
  const page = await def.page(ctx);   // 3 jours → fenêtre de 3 jours
  assert.ok(Math.abs((seen.at(-1).to - seen.at(-1).from) / 86_400_000 - 3) < 0.01);
  assert.ok(page.blocks.length > 0);
  const order = [...html.matchAll(/T-(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(order, ["a1", "b1", "a2"]);
});

test("jeu : la ligne « Jeu : » de la description d'abord, sinon la catégorie ; les annulés suivent le réglage ; journée entière sans jeu", async () => {
  const { ctx } = planning({ byProvider: { A: [
    item("d", 3, { description: "Jeu : Celeste", category: "Autre" }), item("c", 5, { category: "Just Chatting" }), item("n", 7),
    item("x", 9, { status: "cancelled", category: "Zelda" }), item("j", 11, { category: "Truc", start: new Date(Date.now() + 40 * H).toISOString().slice(0, 10), end: new Date(Date.now() + 64 * H).toISOString().slice(0, 10), allDay: true }),
  ] } });
  const html = (await def.sections.upcoming(ctx, { count: 10 }))[1].html;
  assert.match(html, /T-d[\s\S]*?Celeste/); assert.ok(!html.includes("Autre"));
  assert.match(html, /T-c[\s\S]*?Just Chatting/);
  assert.ok(!html.includes("T-x"), "annulé caché par défaut");
  assert.match(html, /T-j/); assert.ok(!/Truc/.test(html), "journée entière : pas de jeu");
  const cancelled = (settings) => planning({ byProvider: { A: [item("x", 9, { status: "cancelled" })] }, settings: { appearance: "classic", days: 3, ...settings } }).ctx;
  const shown = JSON.stringify((await def.page(cancelled({ showCancelled: true }))).blocks);
  assert.match(shown, /T-x/); assert.match(shown, /pa-cancelled/);
  assert.ok(!JSON.stringify((await def.page(cancelled({}))).blocks).includes("T-x"));
});

test("pastille de la source : désactivée par défaut ; activée, couleur et nom dans toutes les apparences (échappés, couleur validée)", async () => {
  const items = [item("a", 3, { sourceLabel: "Mes <streams>", color: "#9146ff" }), item("b", 5, { sourceLabel: "Manuel", color: "javascript:x" }), item("c", 6)];
  const off = (await def.sections.upcoming(planning({ byProvider: { A: items } }).ctx, { count: 5 }))[1].html;
  assert.ok(!off.includes("Manuel") && !off.includes("background:#9146ff") && !off.includes("streams&gt;"));
  const mdOff = JSON.stringify((await def.page(planning({ byProvider: { A: items } }).ctx)).blocks);
  assert.ok(!mdOff.includes("Manuel"));
  for (const appearance of ["original", "classic", "alternating", "week", "timeline", "posters", "hero"]) {
    const { ctx } = planning({ byProvider: { A: items }, settings: { showSource: true, appearance, days: 3 } });
    const page = JSON.stringify((await def.page(ctx)).blocks);
    const html = appearance === "week" ? page : (await def.sections.upcoming(ctx, { count: 5, appearance }))[1].html;   // la grille de semaine n'a pas de rendu « liste » pour l'accueil (comportement d'avant)
    assert.ok(html.includes("Mes &lt;streams&gt;") && html.includes("background:#9146ff"), `${appearance} (accueil)`);
    assert.ok(page.includes("Manuel") || page.includes("Mes"), `${appearance} (page)`);
    assert.ok(!html.includes("javascript:x") && !html.includes("<streams>"), appearance);
  }
  const next = (await def.sections.next(planning({ byProvider: { A: items }, settings: { showSource: true } }).ctx, {}))[1].html;
  assert.match(next, /Mes &lt;streams&gt;/);
});

test("aucune source : sections absentes, page « pas prêt », admin « Ajoutez une source de calendrier », image 404, MCP et export sans exception", async () => {
  const { ctx } = planning({ byProvider: {} });
  assert.equal(await def.sections.upcoming(ctx, {}), null);
  assert.equal(await def.sections.next(ctx, {}), null);
  assert.equal(await def.sections.days(ctx, {}), null);
  assert.deepEqual((await def.page(ctx)).blocks, [{ type: "markdown", text: fr.notConfigured }]);
  assert.match((await def.adminPanel(planning({ byProvider: {}, over: { messages: fr } }).ctx))[1].text, /Ajoutez une source de calendrier/);
  assert.match(fr.adminNoSource, /Ajoutez une source de calendrier/); assert.match(en.adminNoSource, /Add a calendar source/);
  assert.equal((await def.routes.image(new Request("https://x.test/m/planning/image"), ctx)).status, 404);
  await assert.rejects(() => def.mcp.planning_upcoming(ctx, {}), (e) => e.expose === true);
  assert.deepEqual(await def.exports["planning.slot"](ctx, { locale: "fr", limit: 5, tags: [] }), []);
});

test("sources présentes mais vides : états vides soignés, le message n'est PAS « ajoutez une source »", async () => {
  const { ctx } = planning({ byProvider: { A: [] } });
  assert.match((await def.sections.upcoming(ctx, {}))[1].html, /cpl-empty/);
  assert.ok((await def.page(ctx)).blocks.some((b) => b.type === "heading"));
  assert.ok(!(await def.adminPanel(ctx)).some((b) => b.type === "markdown" && /Ajoutez une source/.test(b.text)));
});

test("un évènement illisible ou hors fenêtre est écarté sans casser les autres ; une collecte qui lève ne lève pas", async () => {
  const { ctx } = planning({ byProvider: { A: [{ id: "bad", title: "x", start: "pas une date" }, null, item("far", 24 * 30), item("ok", 3)] } });
  const out = await def.mcp.planning_upcoming(ctx, { days: 7 });
  assert.deepEqual(out.map((s) => s.title), ["T-ok"]);
  const failing = planning({ byProvider: { A: [] } }).ctx; failing.api.topics.collect = async () => { throw new Error("boom"); };
  assert.equal(await def.sections.upcoming(failing, {}), null);
});

test("image PNG : la semaine vient de la plage demandée (lundi → dimanche), même moteur qu'avant", async () => {
  const today = new Date(); today.setUTCHours(10, 0, 0, 0);
  const { ctx, seen } = planning({ byProvider: { A: [{ id: "i", title: "Soirée", start: today.toISOString(), end: new Date(today.getTime() + H).toISOString(), category: "Zelda" }] } });
  ctx.t = (k) => fr[k] ?? k;
  const res = await def.routes.image(new Request("https://x.test/m/planning/image"), ctx);
  assert.equal(res.status, 200);
  assert.equal(Math.round((seen[0].to - seen[0].from) / 3_600_000 / 24), 7);
  assert.ok(JSON.stringify(ctx.calls.png[0].tree).includes("Soirée"));
});

test("textes : fr et en alignés, toutes les clés utilisées par le code existent", () => {
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  const dir = new URL("../modules/planning/", import.meta.url);
  const code = ["index.mjs", ...fs.readdirSync(new URL("appearances/", dir)).filter((f) => f.endsWith(".mjs")).map((f) => `appearances/${f}`), ...fs.readdirSync(new URL("appearances/layouts/", dir)).map((f) => `appearances/layouts/${f}`)].map((f) => fs.readFileSync(new URL(f, dir), "utf8")).join("\n");
  for (const m of code.matchAll(/\bt\(\s*"([A-Za-z_]+)"/g)) assert.ok(m[1] in fr, m[1]);
  for (const k of ["srcName", "srcKind", "srcState", "srcOk", "srcError", "srcStale", "kind_ical", "kind_manual", "kind_twitch", "adminNoSource", "adminChoose", "adminEmpty", "notReadable", "seedNickname"]) assert.ok(k in fr, k);
});
