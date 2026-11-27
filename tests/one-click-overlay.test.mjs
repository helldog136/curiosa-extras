// Twitch bot 1.20.0: the alerts overlay is set up in one click from the window that needs it (core 0.15.0, permission instances.setup).
// (1.18.0) Twitch activity had the same button for its overlay; it now lives IN the alerts overlay (no copy to set up): its steps are Twitch authorized, listening,
// placed in an overlay page. The fake core refuses what the real one refuses (permission, person, role, declared service, installed module).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { world as evWorld, en as evEn, fr as evFr } from "./helpers/eventsWorld.mjs";
import { world as botWorld } from "./helpers/botWorld.mjs";
import { dialogsOf } from "./helpers/ui.mjs";

const rx = await import("../modules/alerts-overlay/twitch/reaction.mjs");
const botAdmin = await import("../modules/twitch-bot/admin.mjs");
const BM = await import("../modules/twitch-bot/media.mjs");
const json = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), "utf8"));
const botMan = json("../modules/twitch-bot/module.json"), botEn = json("../modules/twitch-bot/locales/en.json"), botFr = json("../modules/twitch-bot/locales/fr.json");
const overlay = (instances = 0, offers = ["alerts.queue", "alerts.show"]) => ({ "alerts-overlay": { name: "Alerts overlay", offers: offers.map((service) => ({ service, version: 2 })), instances } });

test("FR and EN: same keys for the texts, no colon at the end, short", () => {
  for (const [en, fr, keys] of [[botEn, botFr, ["media_setup_btn", "media_setup_ok", "media_setup_denied", "media_setup_err"]]]) {
    for (const k of keys) { assert.ok(en[k] && fr[k], k); assert.ok(!/:\s*$/.test(en[k]) && !/:\s*$/.test(fr[k])); }
  }
  assert.ok(botEn.media_setup_btn.length <= 60);
});

test("manifests: the bot keeps the permission, core 0.15.0", () => {
  assert.deepEqual([botMan.version, botMan.minCore, botMan.permissions.includes("instances.setup")], ["1.24.5", "0.36.0", true]);
});

/* ───────────── Twitch bot ───────────── */

const bot = (o = {}) => botWorld({ locale: "en", installedModules: overlay(0, ["alerts.show"]), permissions: botMan.permissions, ...o });
const windowsOf = async (ctx) => dialogsOf(await botAdmin.panel(ctx, { query: { new: "1" } }));

test("bot: installed overlay without a copy: the window has the button beside its main button; the answer says what to do next", async () => {
  const w = bot();
  const lib = await BM.library(w.ctx);
  assert.equal(lib.available, false); assert.equal(lib.setUp.module, "alerts-overlay");
  const [form] = await windowsOf(w.ctx);
  assert.deepEqual(form.extraActions, [{ label: "Set up Alerts overlay", action: "setUpAlerts" }]);
  const r = await botAdmin.actions.setUpAlerts(w.ctx, {});
  assert.match(r.ok, /Close this window and open it again/);
  assert.equal(w.ctx.calls.setUps.length, 1);
  assert.equal((await BM.pendingSetUp(w.ctx)), null, "nothing left to set up");
});

test("bot: not installed or without permission: no button; the field of the window says where to install it; an editor is refused with a sentence", async () => {
  const absent = bot({ installedModules: {} });
  const [form] = await windowsOf(absent.ctx);
  assert.equal(form.extraActions, undefined);
  assert.ok(!(await botAdmin.panel(absent.ctx, { query: {} })).some((b) => b.type === "suggestInstall"), "R33f: no install suggestion on a configured page; the field of the window says where to install it");
  const editor = bot({ person: { id: "u2", email: "e@example.test", role: "editor" } });
  assert.match((await botAdmin.actions.setUpAlerts(editor.ctx, {})).error, /Only the administration team/);
  assert.equal((await BM.pendingSetUp(editor.ctx)).module, "alerts-overlay", "still to set up");
  const setupPage = await botAdmin.panel(bot().ctx, { query: {} });
  assert.ok(!setupPage.some((b) => b.type === "suggestInstall"), "the suggestion does not compete with the button");
});
