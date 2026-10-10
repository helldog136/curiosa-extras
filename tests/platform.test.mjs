// Champ facultatif « platform » du manifeste : sert à regrouper dans l'admin les fonctionnalités d'une même plateforme (Twitch, Discord…).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { listModuleDirs } from "./helpers/moduleLoader.mjs";

const root = new URL("..", import.meta.url).pathname;
const manifests = listModuleDirs().map(({ dir }) => ({ dir, ...JSON.parse(fs.readFileSync(path.join(root, dir, "module.json"), "utf8")) }));
const byId = Object.fromEntries(manifests.map((m) => [m.id, m]));
// Regroupements attendus : slug de plateforme -> modules qui le portent. Tout autre module n'a pas de « platform ».
const groups = {
  twitch: ["live-status", "twitch-channel"],
  discord: ["discord", "discord-announcer"],
  youtube: ["youtube-channel"],
  instagram: ["instagram"], tiktok: ["tiktok"], x: ["x-twitter"], facebook: ["facebook"], bluesky: ["bluesky"], mastodon: ["mastodon"], threads: ["threads"],
  kick: ["kick"], spotify: ["spotify"], reddit: ["reddit"], patreon: ["patreon"], "ko-fi": ["kofi"], snapchat: ["snapchat"], pinterest: ["pinterest"],
  telegram: ["telegram"], steam: ["steam"], soundcloud: ["soundcloud"], bandcamp: ["bandcamp"], github: ["github"],
};

test("platform : tout slug présent est valide (^[a-z][a-z0-9-]{0,30}$) et de type chaîne", () => {
  for (const m of manifests) if ("platform" in m) assert.match(String(m.platform), /^[a-z][a-z0-9-]{0,30}$/, m.id);
});

test("platform : seuls les regroupements attendus partagent un slug, et chaque module attendu le porte", () => {
  const actual = {};
  for (const m of manifests) if (m.platform) (actual[m.platform] ??= []).push(m.id);
  for (const k of Object.keys(actual)) actual[k].sort();
  assert.deepEqual(actual, Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, [...v].sort()])));
  for (const ids of Object.values(groups)) for (const id of ids) assert.ok(byId[id], `${id} : module introuvable`);
});

test("platform : les overlays et les modules génériques n'en ont pas", () => {
  for (const id of ["alerts-overlay", "maze-overlay", "ticker-overlay", "sponsor-ticker", "blog", "pages", "contacts", "links", "hero", "planning", "game-suggestions"]) assert.ok(!("platform" in byId[id]), id);
});

test("platform : l'index du Catalogue reprend la valeur du manifeste (et seulement elle)", () => {
  const index = JSON.parse(fs.readFileSync(path.join(root, "catalogue/index.json"), "utf8"));
  let withPlatform = 0;
  for (const e of index.modules) {
    const m = byId[e.id];
    assert.equal(e.platform, m.platform, e.id);
    if (e.platform) withPlatform++;
  }
  assert.ok(withPlatform >= 20);
});
