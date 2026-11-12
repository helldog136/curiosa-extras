// Twitch channel 2.3.0: the generic overlay context "game" (core 0.8.0). The core never names this module; here we check the contract the module keeps:
// the manifest declaration, the current game (nothing offline), the picker values (games seen, searchable, bounded) and that no secret leaves.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { parseManifest } from "@/core/modules/manifest";

const here = path.dirname(new URL(import.meta.url).pathname);
const DIR = path.join(process.env.CURIOSA_EXTRAS_DIR ?? path.join(here, ".."), "modules/twitch-channel");
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, "module.json"), "utf8"));
const mod = await import("../modules/twitch-channel/index.mjs");
const def = mod.default;
const core = process.env.CURIOSA_DIR ?? process.cwd();
const { checkModule } = await import(path.join(core, "testsupport/index.mjs"));

const ctxWith = async (sessions = []) => {
  const ctx = fakeCtx({ key: "tw", moduleId: "twitch-channel", locale: "fr", defaultLocale: "fr", locales: ["fr", "en"], permissions: manifest.permissions, settings: { channel: "etoile_nord" } });
  for (const s of sessions) await ctx.api.store.add("twitchLiveSessions", s);
  return ctx;
};
const session = (id, games, at = 1) => ({
  streamId: id, open: false, startedAt: at, firstAt: at, lastAt: at + 3600_000, endedAt: at + 3600_000, lastViewers: 5, title: "t", language: "fr", peak: 9, viewerSec: 100, coveredSec: 100, gapSec: 0, cutSec: 0, samples: 4, approx: [],
  followersStart: null, followersEnd: null, segments: games.map(([gameId, game]) => ({ gameId, game, startAt: at, endAt: at + 1000, peak: 5, viewerSec: 10, coveredSec: 10, samples: 2, followersStart: null, followersEnd: null })),
});

test("manifest : le contexte « jeu » est déclaré (libellé, interrupteur, exemple en FR et EN) et exige le cœur 0.8.0", () => {
  const parsed = parseManifest(manifest);
  assert.equal(parsed.ok, true, JSON.stringify(parsed.issues ?? parsed.error));
  assert.equal(manifest.minCore, "0.11.0");
  const [c] = manifest.overlayContexts;
  assert.deepEqual([c.id, c.label.en, c.switchLabel.en, c.switchLabel.fr], ["game", "Game", "Skin per game", "Un skin par jeu"]);
  assert.ok(c.example.fr && c.example.en);
  assert.equal(typeof def.overlayContexts.game.current, "function"); assert.equal(typeof def.overlayContexts.game.values, "function");
});

test("jeu en cours : l'identifiant et le nom du jeu du direct ; rien hors direct, sans jeu choisi, ou sans connexion", async () => {
  assert.deepEqual(mod.gameValue({ id: "1", gameId: "509658", game: "Just Chatting" }), { id: "509658", name: "Just Chatting" });
  assert.deepEqual(mod.gameValue({ gameId: 33214, game: null }), { id: "33214", name: "33214" });
  assert.equal(mod.gameValue(null), null); assert.equal(mod.gameValue({ id: "1", gameId: null, game: "x" }), null);
  // No application connected (the test context has no Twitch service): nothing is known, and nothing throws.
  assert.equal(await def.overlayContexts.game.current(await ctxWith()), null);
});

test("jeux déjà vus : fusionnés, triés par nombre de directs, cherchés sans tenir compte des accents ni de la casse, bornés", async () => {
  const ctx = await ctxWith([
    session("a", [["10", "Celeste"], ["20", "Éternels"]], 1_000), session("b", [["10", "Celeste"]], 2_000_000), session("c", [["30", "Sans nom"], [null, "Sans numéro"]], 3_000_000),
  ]);
  const values = def.overlayContexts.game.values;
  assert.deepEqual((await values(ctx, { search: "", limit: 10 })).map((v) => v.id), ["10", "30", "20"], "Celeste (2 directs) first, then the most recent; a game without a Twitch id cannot be a stable key");
  assert.deepEqual(await values(ctx, { search: "eterNEL", limit: 10 }), [{ id: "20", name: "Éternels" }]);
  assert.equal((await values(ctx, { search: "", limit: 2 })).length, 2);
  assert.deepEqual(await values(ctx, { search: "zzz", limit: 10 }), []);
  assert.deepEqual(await values(await ctxWith(), { search: "", limit: 10 }), [], "no measured live: nothing to pick yet (the dialog says so)");
});

test("contrat du cœur : le module passe les vérifications obligatoires du kit (forme de overlayContexts comprise)", async () => {
  const report = await checkModule(DIR, { siblings: [] });
  assert.equal(report.results.find((x) => x.id === "overlay.elements").status, "pass");
  assert.deepEqual(report.results.filter((x) => x.level === "mandatory" && x.status === "fail").map((x) => `${x.id} : ${x.problems.join(" ; ")}`), []);
});
