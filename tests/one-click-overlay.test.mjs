// Twitch activity 1.6.0 and Twitch bot 1.20.0: the alerts overlay is set up in one click from the page that needs it (core 0.15.0, permission instances.setup).
// The fake core refuses what the real one refuses (permission, person, role, declared service, installed module), so a click that cannot work here cannot work there.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { world as evWorld, A as evAdmin, mod as evMod, manifest as evMan, en as evEn, fr as evFr } from "./helpers/eventsWorld.mjs";
import { world as botWorld } from "./helpers/botWorld.mjs";
import { dialogsOf } from "./helpers/ui.mjs";
import { assertAdminPageErgonomics } from "./helpers/ergonomics.mjs";

const rx = await import("../modules/twitch-events/reaction.mjs");
const botAdmin = await import("../modules/twitch-bot/admin.mjs");
const BM = await import("../modules/twitch-bot/media.mjs");
const json = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), "utf8"));
const botMan = json("../modules/twitch-bot/module.json"), botEn = json("../modules/twitch-bot/locales/en.json"), botFr = json("../modules/twitch-bot/locales/fr.json");

const overlay = (instances = 0, offers = ["alerts.queue", "alerts.reaction", "alerts.show"]) => ({ "alerts-overlay": { name: "Alerts overlay", offers: offers.map((service) => ({ service, version: 2 })), instances } });
/** A Twitch activity page on a site where the overlay is installed (`installed`) with `instances` copies; once a copy exists, the service answers (as on a real site). */
function events({ installed = overlay(0), person, permissions } = {}) {
  const w = evWorld({ locale: "en", installedModules: installed, ...(permissions ? { permissions } : {}), ...(person !== undefined ? { person } : {}) });
  const ctx = w.ctx, base = ctx.api.services;
  const live = () => installed["alerts-overlay"]?.instances > 0 && installed["alerts-overlay"].offers.some((o) => o.service === "alerts.reaction");
  ctx.api.services = { ...base, providers: async (name) => (name === "alerts.reaction" ? (live() ? [{ id: "id-al", key: "al", name: "Alerts", module: "alerts-overlay", version: 2, each: true, master: true }] : []) : base.providers(name)),
    call: async (name, ...rest) => (name === "alerts.reaction" ? { ok: true, value: { ok: true, types: [] } } : base.call(name, ...rest)) };
  ctx.api.instances = { ...ctx.api.instances, list: async () => (installed["alerts-overlay"]?.instances > 0 ? [{ id: "al", key: "al", module: "alerts-overlay", adminPath: "/admin/instances/al" }] : []) };
  return { ctx, installed };
}
const steps = (ctx) => rx.checklist(ctx, { authorized: false, listening: false, authorizeHref: null });
const forms = (blocks, action) => blocks.filter((b) => b.type === "adminForm" && b.action === action);

test("installed without a copy: a button under the steps (and one in the Types tab), no link to the catalogue, the step is to do", async () => {
  const { ctx } = events();
  assert.equal((await rx.alertsState(ctx)).state, "setup");
  const t = await steps(ctx);
  assert.deepEqual([t.rows[2][1].text, t.rows[2][1].badge, t.rows[2][2]], ["To do", "warn", ""], "no catalogue link: the button is right below");
  const page = await evMod.adminPanel(ctx, { query: {} });
  const [main, types] = [forms(page, "setUpAlerts").find((b) => !b.tab), forms(page, "setUpAlerts").find((b) => b.tab === "types")];
  assert.equal(main.submitLabel, "Set up Alerts overlay"); assert.equal(types.submitLabel, "Set up Alerts overlay");
  assert.ok(!page.some((b) => b.type === "suggestInstall") && !page.some((b) => b.type === "links" && b.items.some((i) => i.href === "/admin/catalogue")));
  assert.ok(!page.some((b) => b.type === "markdown" && /install the module/.test(b.text)));
  assertAdminPageErgonomics(page);
});

test("the click creates the copy; the page then says so, and the steps update by themselves", async () => {
  const { ctx, installed } = events();
  const r = await evMod.adminActions.setUpAlerts(ctx, { from: "" });
  assert.deepEqual(r, { redirect: "?setup=done" });
  assert.equal(installed["alerts-overlay"].instances, 1);
  assert.equal((await rx.alertsState(ctx)).state, "ready");
  const page = await evMod.adminPanel(ctx, { query: { setup: "done" } });
  const banner = page.find((b) => b.type === "banner" && b.tone === "success");
  assert.deepEqual([banner.text, banner.href], ["Alerts overlay is set up.", "/admin/overlay-pages"]);
  assert.equal(forms(page, "setUpAlerts").length, 0, "no button left");
  const t = await steps(ctx);
  assert.equal(t.rows[2][1].badge, "ok");
  assert.deepEqual((await evMod.adminActions.setUpAlerts(ctx, { from: "types" })), { redirect: "?tab=types&setup=done" }, "a second click creates nothing");
  assert.equal(installed["alerts-overlay"].instances, 1);
});

test("refusals say what to do and create nothing: not an administrator, no person, permission removed", async () => {
  for (const [label, opts, expected] of [
    ["editor", { person: { id: "u2", email: "e@example.test", role: "editor" } }, /Only the administration team/],
    ["no person", { person: null }, /Only the administration team/],
  ]) {
    const { ctx, installed } = events(opts);
    const r = await evMod.adminActions.setUpAlerts(ctx, {});
    assert.match(r.error, expected, label); assert.equal(installed["alerts-overlay"].instances, 0, label);
  }
  const { ctx, installed } = events();
  const strict = new Proxy(ctx.api.instances, { get: (t, k) => (k === "setUp" ? async () => ({ ok: false, reason: "failed" }) : t[k]) });
  ctx.api.instances = strict;
  assert.match((await evMod.adminActions.setUpAlerts(ctx, {})).error, /Open the Extensions page/);
  assert.equal(installed["alerts-overlay"].instances, 0);
});

test("without the permission the fake core lists nothing and refuses: the page falls back to the catalogue link, never a button that cannot work", async () => {
  const none = events({ permissions: ["storage"] }).ctx;
  assert.deepEqual(await none.api.instances.pending(), []);
  assert.deepEqual(await none.api.instances.setUp("alerts-overlay"), { ok: false, reason: "no-permission" });
  assert.equal((await rx.alertsState(none)).state, "absent");
});

test("not installed: the core's install suggestion and the catalogue link; installed but too old: the update link; nothing is installed by this module", async () => {
  const absent = events({ installed: {} });
  assert.equal((await rx.alertsState(absent.ctx)).state, "absent");
  const page = await evMod.adminPanel(absent.ctx, { query: {} });
  const s = page.find((b) => b.type === "suggestInstall");
  assert.deepEqual([s.service, s.min, s.reason], ["alerts.reaction", 1, "shows your Twitch events as alerts on screen"]);
  assert.equal((await steps(absent.ctx)).rows[2][2].href, "/admin/catalogue");
  assert.equal(forms(page, "setUpAlerts").length, 0);
  const old = events({ installed: overlay(1, ["alerts.queue"]) });
  assert.equal((await rx.alertsState(old.ctx)).state, "old");
  assert.equal((await evMod.adminPanel(old.ctx, { query: { tab: "types" } })).find((b) => b.type === "links" && b.tab === "types").items[0].href, "/admin/instances/al");
  assert.ok(!(await evMod.adminPanel(old.ctx, { query: {} })).some((b) => b.type === "suggestInstall"));
});

test("the placement step is a link without a state: no checkmark, no badge, only with the overlay in place; the banner after a click never claims it", async () => {
  const ready = events({ installed: overlay(1) });
  const t = await rx.checklist(ready.ctx, { authorized: true, listening: false });
  const row = t.rows[3];
  assert.equal(row[0], "Alerts placed in an overlay page"); assert.equal(row[1].badge, undefined); assert.equal(row[1].text, "—"); assert.match(row[1].title, /cannot tell/);
  assert.deepEqual([row[2].text, row[2].href], ["Open the overlay pages →", "/admin/overlay-pages"]);
  assert.equal(await rx.checklist(ready.ctx, { authorized: true, listening: true }), null, "an undetectable step never keeps the list on screen");
  for (const state of [overlay(0), {}]) assert.equal((await steps(events({ installed: state }).ctx)).rows.length, 3, "no placement row before the overlay is there");
  const absent = events({ installed: {} });
  assert.ok(!(await evMod.adminPanel(absent.ctx, { query: { setup: "done" } })).some((b) => b.type === "banner" && b.tone === "success"), "no success banner on a page that did not set anything up");
});

test("FR and EN: same keys for the new texts, no colon at the end, short", () => {
  for (const [en, fr, keys] of [[evEn, evFr, ["cl_setup_btn", "cl_setup_done", "cl_setup_err", "cl_setup_denied", "cl_placed", "cl_placed_link", "cl_placed_title", "cl_suggest_reason"]], [botEn, botFr, ["media_setup_btn", "media_setup_ok", "media_setup_denied", "media_setup_err", "media_suggest_reason"]]]) {
    for (const k of keys) { assert.ok(en[k] && fr[k], k); assert.ok(!/:\s*$/.test(en[k]) && !/:\s*$/.test(fr[k])); }
  }
  assert.ok(evEn.cl_setup_btn.length <= 60 && botEn.media_setup_btn.length <= 60);
});

test("manifests: the permission, core 0.15.0, the versions", () => {
  assert.deepEqual([evMan.version, evMan.minCore, evMan.permissions.includes("instances.setup")], ["1.6.0", "0.15.0", true]);
  assert.deepEqual([botMan.version, botMan.minCore, botMan.permissions.includes("instances.setup")], ["1.20.0", "0.15.0", true]);
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

test("bot: not installed or without permission: no button; the core suggestion takes over; an editor is refused with a sentence", async () => {
  const absent = bot({ installedModules: {} });
  const [form] = await windowsOf(absent.ctx);
  assert.equal(form.extraActions, undefined);
  assert.ok((await botAdmin.panel(absent.ctx, { query: {} })).some((b) => b.type === "suggestInstall" && b.service === "alerts.show"));
  const editor = bot({ person: { id: "u2", email: "e@example.test", role: "editor" } });
  assert.match((await botAdmin.actions.setUpAlerts(editor.ctx, {})).error, /Only the administration team/);
  assert.equal((await BM.pendingSetUp(editor.ctx)).module, "alerts-overlay", "still to set up");
  const setupPage = await botAdmin.panel(bot().ctx, { query: {} });
  assert.ok(!setupPage.some((b) => b.type === "suggestInstall"), "the suggestion does not compete with the button");
});
