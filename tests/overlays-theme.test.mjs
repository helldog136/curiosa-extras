import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { loadModule } from "./helpers/moduleLoader.mjs";

const C = await import("@/core/color");
const { parseManifest } = await import("@/core/modules/manifest");
const ticker = { default: (await loadModule("modules/sponsor-ticker")).definition };
const maze = { default: (await loadModule("modules/maze-overlay")).definition };
const here = new URL("..", import.meta.url).pathname;

test("modules livrés : toutes les couleurs par défaut du dépôt qui doivent suivre le thème le font", async () => {
  const ticker = (await loadModule("modules/ticker-overlay")).manifest;
  for (const k of ["textColor", "cardColor"]) {
    const f = ticker.settings.find((s) => s.key === k);
    assert.ok(C.themeRef(f.default), k);
    assert.equal(f.group, "appearance");
  }
});

test("overlays : le thème du site traverse jusqu'au rendu (fond, texte, accent), et les réglages propres l'emportent", () => {
  const theme = C.buildTheme("#fafafa", "#00aa55", "sans");
  const query = new URLSearchParams();
  const out = ticker.default.overlay(fakeCtx({ theme, settings: {} }), { query });
  assert.match(out.html, /--ticker-accent:#00aa55/);
  assert.match(out.html, new RegExp(`--tk-bg:${theme.surface}`));
  assert.match(out.html, new RegExp(`--tk-fg:${theme.fg}`));
  assert.match(out.html, new RegExp(`--tk-on-accent:${theme.accentFg}`));
  const custom = ticker.default.overlay(fakeCtx({ theme, settings: { accentColor: "#ff00ff" } }), { query });
  assert.match(custom.html, /--ticker-accent:#ff00ff/);
  const m = maze.default.overlay(fakeCtx({ theme, settings: {} }), { query });
  assert.match(m.css, new RegExp(`border:2px solid ${theme.accent}`));
  assert.match(m.css, new RegExp(`background:${theme.surface}ee;color:${theme.fg}`));
});

test("labyrinthe : couleurs de mur et de sol propres au module, valeurs invalides → défauts", () => {
  const cfg = (settings) => JSON.parse(maze.default.overlay(fakeCtx({ settings }), { query: new URLSearchParams() }).script.match(/__MAZE__=(\{.*?\});import/s)[1]);
  assert.deepEqual([cfg({}).wallColor, cfg({}).floorColor], ["#2a2118", "#181310"]);
  assert.deepEqual([cfg({ wallColor: "#112233", floorColor: "#445566" }).wallColor, cfg({ wallColor: "#112233", floorColor: "#445566" }).floorColor], ["#112233", "#445566"]);
  assert.equal(cfg({ wallColor: "red" }).wallColor, "#2a2118");
  assert.equal(cfg({ wallColor: "#fff;}</style>" }).wallColor, "#2a2118");
});

test("labyrinthe : les réglages d'apparence sont groupés à part dans le manifeste", async () => {
  const m = JSON.parse(fs.readFileSync(here + "modules/maze-overlay/module.json", "utf8"));
  assert.ok(parseManifest(m).ok);
  const appearance = m.settings.filter((s) => s.group === "appearance").map((s) => s.key);
  for (const k of ["accent", "wallTexture", "floorTexture", "wallColor", "floorColor", "portalTexture", "handsSprite"]) assert.ok(appearance.includes(k), k);
  assert.ok(!appearance.includes("moveSpeed"), "les réglages de comportement restent séparés");
  assert.equal(m.settings.find((s) => s.key === "accent").default, "theme:accent");
});
