// The "Authorize again with Twitch" button: always there when a permission is missing, never when nothing is missing, never for a type that is off;
// the link carries the missing permissions (forced); a pending subscription is created again once; the Twitch bot behaves the same.
import test from "node:test";
import assert from "node:assert/strict";
import { world, EV, TYPES, NOW, es, S, L, A, C, mod, fr, en } from "./helpers/eventsWorld.mjs";
import { world as botWorld, fr as botFr, en as botEn } from "./helpers/botWorld.mjs";

const ALL = ["moderator:read:followers", "channel:read:subscriptions", "bits:read", "channel:read:hype_train", "channel:read:redemptions"];
const without = (...x) => ALL.filter((s) => !x.includes(s));
const authorize = (blocks) => blocks.filter((b) => b.type === "html" && /data-twitch-connect/.test(b.html)).map((b) => ({ tab: b.tab, href: /href="([^"]+)"/.exec(b.html)[1].replace(/&amp;/g, "&"), label: />([^<]+)<\/a>/.exec(b.html)[1] }));
const warnings = (blocks) => blocks.filter((b) => b.type === "banner" && b.tone === "warning");
// The state the page found when the owner opened it: the check ran, then the connector forgot what was declared (it only knows what a page declared).
async function opened(o) {
  const w = world(o);
  await S.ensureSecret(w.ctx);
  await C.check(w.ctx, { retentionDays: 30 }, { now: NOW });
  w.tw.wants.length = 0; w.tw.links.length = 0;
  return w;
}

test("a missing permission of a type that is on: the red box names it and the button is there, forced, with exactly what is missing", async () => {
  const w = await opened({ tw: { scopes: without("bits:read", "channel:read:hype_train") } });
  const page = await mod.adminPanel(w.ctx, { query: {} });
  const box = warnings(page)[0];
  assert.match(box.text, /L'accord de Twitch manque pour : les bits, les trains de la hype\./);
  assert.ok(!/Cliquez/.test(box.text), "no filler sentence");
  const b = authorize(page).filter((x) => !x.tab);
  assert.equal(b.length, 1); assert.equal(b[0].label, "Autoriser de nouveau avec Twitch");
  const call = w.tw.links.at(-1);
  assert.equal(call.force, true); assert.deepEqual(call.scopes.slice().sort(), ["bits:read", "channel:read:hype_train"]);
  assert.match(decodeURIComponent(b[0].href), /bits:read channel:read:hype_train|bits:read.*channel:read:hype_train/, "the link carries the union of the missing permissions");
  assert.ok(page.some((x) => x.type === "adminForm" && x.action === "check" && !x.tab), "the check button stays, as the secondary one");
  assert.ok(!page.some((x) => x.type === "markdown" && /Rien n'est perdu/.test(x.text)));
});

test("same in English; and without a link from the connector there is still a way to its page", async () => {
  const w = await opened({ locale: "en", tw: { scopes: without("bits:read") } });
  const page = await mod.adminPanel(w.ctx, { query: {} });
  assert.equal(authorize(page)[0].label, "Authorize again with Twitch");
  const w2 = await opened({ tw: { scopes: without("bits:read") } });
  const svc = w2.ctx.api.services;
  const orig = svc.callAll.bind(svc);
  svc.callAll = async (name, method, args) => (method === "connectLink" ? [{ ok: true, value: { ok: true, url: null, reason: "https" } }] : orig(name, method, args));
  const p2 = await mod.adminPanel(w2.ctx, { query: {} });
  const link = authorize(p2).find((i) => i.href === "/admin/instances/connector");
  assert.equal(link.label, "Ouvrir le Connecteur Twitch");
});

test("nothing missing: no authorize button and no warning", async () => {
  const w = await opened({ tw: { autoEnable: true } });
  await C.check(w.ctx, { retentionDays: 30 }, { now: NOW });
  const page = await mod.adminPanel(w.ctx, { query: {} });
  assert.equal(authorize(page).length, 0);
  assert.equal(warnings(page).length, 0);
});

test("a type that is off never raises the box nor asks for a permission", async () => {
  const w = await opened({ tw: { scopes: without("channel:read:redemptions"), autoEnable: true } });
  await C.check(w.ctx, { retentionDays: 30 }, { now: NOW });
  const page = await mod.adminPanel(w.ctx, { query: {} });
  assert.equal(S.enabledOf(await S.readState(w.ctx)).redeem, false, "off by default");
  assert.equal(warnings(page).length, 0); assert.equal(authorize(page).length, 0);
});

test("channel point rewards on without their permission: the row says it and the Types tab has the button, but the page is not red", async () => {
  const w = world({ tw: { scopes: without("channel:read:redemptions"), autoEnable: true } });
  await S.ensureSecret(w.ctx);
  await S.updateState(w.ctx, (d) => { d.enabled = { redeem: true }; });
  await C.check(w.ctx, { retentionDays: 30 }, { now: NOW });
  const r = await C.check(w.ctx, { retentionDays: 30 }, { now: NOW });
  assert.equal(r.code, "listening", "the type the bot already covers never blocks the verdict");
  const page = await mod.adminPanel(w.ctx, { query: {} });
  assert.equal(warnings(page).length, 0);
  const b = authorize(page);
  assert.equal(b.length, 1); assert.equal(b[0].tab, "types");
  const row = page.find((x) => x.tab === "types" && x.type === "table").rows.find((x) => x[0].text === fr.type_redeem);
  assert.match(row[2].text, /Accord à donner/); assert.equal(row[2].badge, "warn");
});

test("after the permission is granted, the page checks again by itself and the warning goes", async () => {
  const w = await opened({ tw: { scopes: without("bits:read"), autoEnable: true } });
  await C.check(w.ctx, { retentionDays: 30 }, { now: NOW });
  assert.equal((await S.readState(w.ctx)).listen.code, "need_more");
  w.tw.scopes = [...ALL];
  const page = await mod.adminPanel(w.ctx, { query: {} });
  assert.equal(warnings(page).length, 0); assert.equal(authorize(page).length, 0);
  assert.equal((await S.readState(w.ctx)).listen.code, "listening");
});

test("a subscription pending for 3 minutes is deleted and created again ONCE, then reported with its reason; each change of a type is logged once", async () => {
  const w = world({ tw: { at: NOW } });
  await S.ensureSecret(w.ctx);
  await C.check(w.ctx, { retentionDays: 30 }, { now: NOW });
  const first = w.tw.subs.map((x) => x.id);
  assert.ok(first.length > 0);
  for (const x of w.tw.subs) x.created_at = new Date(NOW - 5 * 60_000).toISOString();
  const dels = () => w.tw.calls.filter((c) => c.method === "DELETE").length;
  const d0 = dels();
  await C.check(w.ctx, { retentionDays: 30 }, { now: NOW });
  assert.equal(dels() - d0, first.length, "all pending ones deleted");
  assert.ok(w.tw.subs.every((x) => !first.includes(x.id)), "and created again");
  for (const x of w.tw.subs) x.created_at = new Date(NOW - 4 * 60_000).toISOString();
  await C.check(w.ctx, { retentionDays: 30 }, { now: NOW + 60_000 });
  assert.equal(dels() - d0, first.length, "not again");
  const page = await mod.adminPanel(w.ctx, { query: {} });
  const row = page.find((x) => x.tab === "types" && x.type === "table").rows.find((x) => x[0].text === fr.type_raid);
  assert.match(row[2].text, /En attente de Twitch depuis \d+ min/); assert.ok(row[2].title, "the reason is in the tooltip");
  const log = w.ctx.calls.log ?? [];
  const raidLines = log.filter((l) => l.action === "type.state" && l.target === "raid");
  assert.equal(raidLines.length, 1, "one line for the change, not one per minute");
  assert.ok(log.some((l) => l.action === "type.recreated"));
});

test("a rejected pending age comes from Twitch (created_at), also for a subscription made before a restart", () => {
  const rows = [{ id: "a", status: "webhook_callback_verification_pending", type: "channel.raid", version: "1", condition: { to_broadcaster_user_id: "100" }, created_at: "2026-11-12T19:50:00Z", transport: { method: "webhook", callback: "https://x/cb" } }];
  const c = es.classify(rows, [{ typeId: "raid", type: "channel.raid", version: "1", condition: { to_broadcaster_user_id: "100" } }], "https://x/cb");
  assert.equal(c.wanted[0].createdAt, Date.parse("2026-11-12T19:50:00Z"));
});

test("FR/EN parity of the touched messages", () => {
  const keys = ["connect_btn", "connect_fallback", "listen_need_more", "state_pending_since", "reason_waiting", "reason_unconfirmed", "reason_unreachable", "reason_elsewhere", "listen_unknown"];
  for (const k of keys) { assert.ok(fr[k] && en[k], k); assert.deepEqual(fr[k].match(/\{\w+\}/g) ?? [], en[k].match(/\{\w+\}/g) ?? [], k); }
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  assert.deepEqual(Object.keys(botFr).sort(), Object.keys(botEn).sort());
  assert.ok(!/enthousiasme/i.test(JSON.stringify(fr)), "French says « train de la hype »");
});

/* ───────────── Twitch bot ───────────── */

const A_BOT = await import("../modules/twitch-bot/admin.mjs");
const html = (blocks) => blocks.filter((b) => b.type === "html").map((b) => b.html).join("\n");

test("bot: a missing chat permission shows the forced button with the missing permissions, no filler", async () => {
  const w = botWorld({ tw: { mainScopes: ["user:read:chat"] } });
  const page = await A_BOT.panel(w.ctx, { query: {} });
  const h = html(page);
  assert.match(h, /data-twitch-connect/); assert.match(h, /Autoriser de nouveau avec Twitch/);
  assert.match(h, /title="Chez Twitch/, "the steps are in the tooltip");
  const call = w.tw.links.at(-1);
  assert.equal(call.force, true); assert.ok(call.scopes.length > 0 && call.scopes.every((s) => typeof s === "string"));
  assert.ok(!JSON.stringify(page).includes("Pour que le bot lise"));
});

test("bot: no link from the connector: the way to the connector stays", async () => {
  const w = botWorld({ tw: { mainScopes: ["user:read:chat"], noLink: true } });
  const h = html(await A_BOT.panel(w.ctx, { query: {} }));
  assert.match(h, /Ouvrir le Connecteur Twitch/); assert.match(h, /href="\/admin\/instances\/tw1"/);
});

test("bot: nothing missing, no button", async () => {
  const w = botWorld({});
  assert.doesNotMatch(html(await A_BOT.panel(w.ctx, { query: {} })), /data-twitch-connect/);
});
