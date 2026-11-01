// Les trois modules qui affichent des jaquettes (Suggestions de jeux, Planning, Story d'annonce) demandent maintenant la jaquette au module « Jaquettes de jeux »
// (service `game.cover`, besoin facultatif). Sans lui ils retombent sur l'ancienne interface du cœur (`ctx.api.rawg`) : aucune jaquette ne disparaît entre deux mises à jour.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { parseManifest } from "@/core/modules/manifest";

const readJson = (m, p) => JSON.parse(fs.readFileSync(new URL(`../modules/${m}/${p}`, import.meta.url), "utf8"));
const gs = await import("../modules/game-suggestions/index.mjs");
const pl = await import("../modules/planning/index.mjs");
const story = (await import("../modules/stream-story/index.mjs")).default;
const sources = await import("../modules/stream-story/sources.mjs");
const data = await import("../modules/stream-story/data.mjs");

const IMG = "https://media.rawg.io/media/games/mod/x.jpg";
const OLD = "https://media.rawg.io/media/games/old/y.jpg";
const MODULE_ID = { id: "id-covers", key: "game-covers", module: "game-covers", basePath: "", name: "Jaquettes", adminPath: "/admin/instances/id-covers" };
/** Un faux module « Jaquettes de jeux » : answers.cover / answers.status sont des objets ou des fonctions ; `calls` garde les titres demandés. */
const covers = (answers = {}) => {
  const calls = [];
  return {
    calls,
    "game.cover": {
      status: async () => (typeof answers.status === "function" ? answers.status() : answers.status ?? { ready: true, configured: true }),
      cover: async (args) => { calls.push(args.title); const a = typeof answers.cover === "function" ? answers.cover(args) : answers.cover ?? { status: "found", url: IMG, name: "Jeu", id: 1, ambiguous: false }; if (a instanceof Error) throw a; return a; },
    },
  };
};
const oldService = (cover = { status: "found", url: OLD }, configured = true) => ({ calls: [], configured: async () => configured, cover: async function (t) { this.calls.push(t); return cover; } });
const oldCalls = (c) => c.api.rawg.calls;

const mk = (id, extra = {}) => {
  const manifest = readJson(id, "module.json");
  const mod = id === "stream-story" ? story : id === "planning" ? pl.default : gs.default;
  return { manifest, mod, ctx: (opts = {}) => fakeCtx({ key: id, moduleId: id, locale: "fr", messages: readJson(id, "locales/fr.json"), permissions: manifest.permissions, ...extra, ...opts }) };
};
const GS = mk("game-suggestions", { basePath: "suggestions" });
const PL = mk("planning", { basePath: "planning" });
const ST = mk("stream-story", { siteUrl: "https://site.example.test", topics: { "planning.slot": () => [] } });
const withOld = (ctx, svc = oldService()) => { ctx.api.rawg = svc; return ctx; };

test("manifestes : besoin FACULTATIF du service game.cover, permission rawg conservée (repli), minCore inchangé, versions augmentées, FR/EN alignés", () => {
  for (const [m, v, core] of [["game-suggestions", "1.7.0", "0.6.0"], ["planning", "2.5.0", "0.5.0"], ["stream-story", "2.5.1", "0.2.10"]]) {
    const man = readJson(m, "module.json");
    assert.ok(parseManifest(man).ok, m);
    assert.equal(man.version, v, m);
    assert.equal(man.minCore, core, `${m} : fonctionne aussi sur un cœur qui garde encore le service (le Planning et les Suggestions de jeux demandent 0.5.0 depuis leurs éléments d'overlay)`);
    const need = man.requires.find((r) => r.service === "game.cover");
    assert.deepEqual([need.optional, need.min ?? 1], [true, 1], `${m} : jamais installé d'office, jamais bloquant`);
    assert.ok(man.permissions.includes("rawg"), `${m} : repli sur l'ancienne interface tant que la cale existe`);
    assert.deepEqual(Object.keys(readJson(m, "locales/fr.json")).sort(), Object.keys(readJson(m, "locales/en.json")).sort(), m);
  }
});

/* ───────────── Suggestions de jeux ───────────── */
test("Suggestions de jeux : la jaquette vient du module ; l'ancienne interface n'est même pas interrogée", async () => {
  const svc = covers({ cover: { status: "found", url: IMG, ambiguous: true } });
  const c = withOld(GS.ctx({ services: svc }));
  assert.deepEqual(await gs.coverFor(c, "Hades"), { status: "found", url: IMG, ambiguous: true });
  assert.deepEqual(svc.calls, ["Hades"]);
  assert.deepEqual(oldCalls(c), []);
  assert.equal(await gs.hasKey(c), true);
});

test("Suggestions de jeux : sans module → ancienne interface (aucune jaquette perdue) ; module sans clé → idem ; module en panne → « down », sans repli ; ni l'un ni l'autre → no_key", async () => {
  const a = withOld(GS.ctx());
  assert.deepEqual(await gs.coverFor(a, "Hades"), { status: "found", url: OLD });
  assert.equal(await gs.hasKey(a), true);
  const b = withOld(GS.ctx({ services: covers({ cover: { status: "no-key", url: null }, status: { ready: false, configured: false } }) }));
  assert.deepEqual(await gs.coverFor(b, "Hades"), { status: "found", url: OLD });
  const c = withOld(GS.ctx({ services: covers({ cover: new Error("boum") }) }));
  assert.deepEqual(await gs.coverFor(c, "Hades"), { status: "down", url: null });
  assert.deepEqual(oldCalls(c), [], "le module garde la clé : on ne retombe pas sur l'ancienne interface");
  const d = GS.ctx(); delete d.api.rawg;
  assert.deepEqual(await gs.coverFor(d, "Hades"), { status: "no_key", url: null });
  assert.equal(await gs.hasKey(d), false);
  const e = withOld(GS.ctx({ services: covers({ cover: { status: "refused", url: null } }) }));
  assert.equal((await gs.coverFor(e, "Hades")).status, "denied");
  const f = withOld(GS.ctx({ services: covers({ cover: { status: "found", url: "http://pas-https.example/x.jpg" } }) }));
  assert.equal((await gs.coverFor(f, "Hades")).status, "none");
});

test("Suggestions de jeux, administration : sans clé, un lien vers le module s'il est installé, sinon la proposition de l'installer ; avec clé, rien", async () => {
  const noKey = () => withOld(GS.ctx({ rawgConfigured: false }), oldService({ status: "no-key", url: null }, false));
  const textOf = (blocks) => JSON.stringify(blocks);
  const without = await gs.default.adminPanel(noKey());
  assert.ok(without.some((b) => b.type === "suggestInstall" && b.service === "game.cover"), "proposition d'installation");
  assert.ok(!textOf(without).includes("/admin/settings\""), "plus de renvoi vers les réglages du cœur");
  const wm = withOld(GS.ctx({ rawgConfigured: false, instances: [MODULE_ID] }), oldService({ status: "no-key", url: null }, false));
  const withModule = await gs.default.adminPanel(wm);
  assert.ok(textOf(withModule).includes("/admin/instances/id-covers"), "lien vers l'écran du module");
  assert.ok(!withModule.some((b) => b.type === "suggestInstall"));
  const keyed = await gs.default.adminPanel(GS.ctx({ services: covers() }));
  assert.ok(!keyed.some((b) => b.type === "suggestInstall") && !keyed.some((b) => b.type === "banner" && b.tone === "warning"));
});

/* ───────────── Planning ───────────── */
test("Planning : la jaquette vient du module ; repli sur l'ancienne interface ; ambiguë → name gardé ; module en panne → down", async () => {
  const svc = covers({ cover: { status: "found", url: IMG, name: "Autre", ambiguous: true } });
  const c = withOld(PL.ctx({ services: svc }));
  assert.deepEqual(await pl.coverFor(c, "Hades"), { status: "found", url: IMG, ambiguous: true, name: "Autre" });
  assert.deepEqual(oldCalls(c), []);
  assert.deepEqual(await pl.coverFor(withOld(PL.ctx()), "Hades"), { status: "found", url: OLD });
  assert.deepEqual(await pl.coverFor(withOld(PL.ctx({ services: covers({ cover: new Error("x") }) })), "Hades"), { status: "down", url: null });
  const bare = PL.ctx(); delete bare.api.rawg;
  assert.deepEqual(await pl.coverFor(bare, "Hades"), { status: "no_key", url: null });
  assert.equal(await pl.hasKey(withOld(PL.ctx({ services: covers() }))), true);
  assert.equal(await pl.hasKey(withOld(PL.ctx({ services: covers({ status: { configured: false } }) }), oldService({ status: "no-key", url: null }, false))), false);
});

test("Planning : coversForSlots passe par le module (30 jeux au plus) et dit « sans clé » quand rien n'est réglé", async () => {
  const svc = covers();
  const c = withOld(PL.ctx({ services: svc }));
  const slot = (games) => ({ start: new Date(), allDay: false, games });
  const out = await pl.coversForSlots(c, [{ ...slot(["Hades", "Doom"]), title: "t", games: ["Hades", "Doom"] }]);
  assert.ok(out.covers.size >= 1 || out.states.size >= 1);
  assert.ok(svc.calls.length <= 2);
  const none = withOld(PL.ctx({ rawgConfigured: false }), oldService({ status: "no-key", url: null }, false));
  const r = await pl.coversForSlots(none, [{ ...slot(["Hades"]), title: "t", games: ["Hades"] }]);
  assert.ok([...r.states.values()].every((s) => s === "no_key") || r.states.size === 0);
});

/* ───────────── Story d'annonce ───────────── */
const storyCover = async (ctx, game) => (await story.routes.cover(new Request(`https://site.example.test/m/story/cover?game=${encodeURIComponent(game)}`, { headers: { "x-story-token": await data.mintToken(ctx) } }), ctx)).json();

test("Story d'annonce : la jaquette vient du module ; repli sur l'ancienne interface ; sans clé nulle part → no_key ; module en panne → down", async () => {
  const a = await sources.coverOf(withOld(ST.ctx({ services: covers({ cover: { status: "found", url: IMG, name: "Autre jeu", ambiguous: true } }) })), "Hades");
  assert.deepEqual([a.cover, a.ambiguous, a.found, a.coverState], [IMG, true, "Autre jeu", ""]);
  const b = await sources.coverOf(withOld(ST.ctx()), "Hades");
  assert.equal(b.cover, OLD);
  const c = withOld(ST.ctx({ services: covers({ status: { configured: false }, cover: { status: "no-key", url: null } }) }), oldService({ status: "no-key", url: null }, false));
  assert.equal((await sources.coverOf(c, "Hades")).coverState, "no_key");
  const d = await sources.coverOf(withOld(ST.ctx({ services: covers({ cover: new Error("x") }) })), "Hades");
  assert.deepEqual([d.cover, d.coverState], ["", "down"]);
  const route = await storyCover(withOld(ST.ctx({ services: covers() })), "Hades");
  assert.deepEqual([route.ok, route.cover], [true, IMG]);
});

test("Story d'annonce : les prochains streams reçoivent leur jaquette du module", async () => {
  const start = new Date(Date.now() + 3_600_000).toISOString();
  const slots = [{ id: "s1", title: "Soirée", start, end: new Date(Date.now() + 7_200_000).toISOString(), allDay: false, games: ["Hades"], status: "confirmed", timezone: "UTC" }];
  const c = withOld(ST.ctx({ services: covers(), topics: { "planning.slot": () => slots } }));
  const r = await sources.loadStreams(c, { zone: "UTC" });
  assert.equal(r.state, "ok");
  assert.equal(r.streams[0].cover, IMG);
  assert.deepEqual(oldCalls(c), []);
});

test("le lien « Ce n'est pas le bon jeu ? » des trois modules reste l'adresse du cœur (publiée dans les versions précédentes) ; le cœur la redirige vers le module", () => {
  assert.equal(gs.wrongCoverHref("Hades"), "/admin/settings/rawg-covers?titre=Hades");
  assert.equal(pl.wrongCoverHref("Hades II"), "/admin/settings/rawg-covers?titre=Hades%20II");
  assert.match(fs.readFileSync(new URL("../modules/stream-story/app.mjs", import.meta.url), "utf8"), /\/admin\/settings\/rawg-covers\?titre=/);
});
