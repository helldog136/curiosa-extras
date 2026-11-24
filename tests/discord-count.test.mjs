// Discord 1.5.0: the member count comes from the Discord connector (optional service `discord.api`, method `guildStats`) when the bot is ready AND the account is the bot's own server;
// otherwise from the public invitation, as before. A connector that is absent, not set up, slow or failing is never seen by visitors: the figure comes from the next source.
// No network: fetch is replaced by the fake Discord (the REAL connector service runs behind it) and by a fake public invitation.
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { problemsOf, problemsOfList } from "./helpers/socialStatContract.mjs";
import { fakeDiscord, BOT_CODE, IDS } from "./helpers/fakeDiscord.mjs";
import { connector, connectorModule } from "./helpers/discordConnector.mjs";
import { parseManifest } from "@/core/modules/manifest";

const DIR = new URL("../modules/discord", import.meta.url).pathname;
const manifest = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8"));
const en = JSON.parse(fs.readFileSync(`${DIR}/locales/en.json`, "utf8")), fr = JSON.parse(fs.readFileSync(`${DIR}/locales/fr.json`, "utf8"));
const source = fs.readFileSync(`${DIR}/index.mjs`, "utf8");
const mod = await import("../modules/discord/index.mjs");
const def = mod.default;

const realFetch = globalThis.fetch, realNow = Date.now;
const INVITE_MEMBERS = 321;   // what the public invitation says (the bot says 1234: the two are told apart)
const OTHER_GUILD = "210000000000000009";
let d, inviteCalls, inviteGuild, inviteStatus;
beforeEach(() => {
  mod.resetCache(); connectorModule.resetCache();
  d = fakeDiscord(); inviteCalls = []; inviteGuild = IDS.guild; inviteStatus = 200;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/invites/")) {
      inviteCalls.push(String(url));
      if (inviteStatus !== 200) return new Response(JSON.stringify({ message: "x" }), { status: inviteStatus, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ approximate_member_count: INVITE_MEMBERS, approximate_presence_count: 10, guild: { id: inviteGuild, name: "Camille's corner" } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return d.fetch(url, init);
  };
});
let keepAlive;
beforeEach(() => { keepAlive = setInterval(() => {}, 1000); });   // the module's timers are unref'd (they never hold a site process): the test run must stay alive meanwhile
afterEach(() => { clearInterval(keepAlive); globalThis.fetch = realFetch; Date.now = realNow; mod.timing.botMs = 3000; });

const SETTINGS = { profile: "https://discord.gg/abcDEF" };
const ctxOf = (services, { locale = "en", key = "inst", settings = {}, ...rest } = {}) =>
  fakeCtx({ moduleId: "discord", key, locale, messages: locale === "fr" ? fr : en, name: "Discord", settings: { ...SETTINGS, ...settings }, siteUrl: "https://site.example", ...(services ? { services } : {}), ...rest });
const real = (o) => connector({ messages: en, ...o });
const withBot = (o) => ({ "discord.api": real(o).methods });
const stat = (ctx) => def.exports["social.stat"](ctx, { limit: 50 });
const panel = (ctx) => def.adminPanel(ctx);
const text = (blocks) => blocks.filter((b) => b.type === "markdown").map((b) => b.text).join("\n\n");
const links = (blocks) => [...text(blocks).matchAll(/\]\((\/[^)]*)\)/g)].map((m) => m[1]);
const stub = (status, guildStats) => ({ "discord.api": { status: async () => status, guildStats: async () => guildStats } });
const READY = { ok: true, bot: true, oauth: false, guildId: IDS.guild };
const guildStatsCalls = () => d.log.filter((c) => c.path === `/guilds/${IDS.guild}`).length;

// ── Manifest and texts ───────────────────────────────────────────────────────

test("manifest: the connector is an OPTIONAL need (never installed for the person), no new permission, no new setting, valid for the core", () => {
  const r = parseManifest(manifest); assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(manifest.version, "1.5.0");
  assert.deepEqual(manifest.requires.map((x) => [x.service, x.min, x.optional]), [["discord.api", 1, true]]);
  assert.ok(manifest.requires[0].label.en && manifest.requires[0].label.fr);
  assert.deepEqual(manifest.permissions, ["admin"], "no new permission: a service call needs none");
  assert.equal(manifest.minCore, "0.6.0", "optional needs exist since 0.2.0, the stat panel since 0.6.0: a core without the connector (older than 0.46.0) just has no provider");
  assert.deepEqual(manifest.settings.map((s) => s.key), ["profile", "trackStats", "createShortLink", "invite", "shortLinkName"], "nothing to configure");
});

test("the module itself adds no network host and never logs or touches a secret", () => {
  const hosts = new Set([...source.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1]));
  assert.deepEqual([...hosts].filter((h) => !/^discord\.(gg|com)$|^discordapp\.com$/.test(h)), []);
  assert.ok(!/console\./.test(source));
  assert.ok(!/botToken|BOT_CODE|credsOf|Authorization/.test(source), "the module never sees the bot code");
});

test("texts: both languages, same keys, short plain words, no colon, no jargon, no reassurance, no conditional wording", () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(fr).sort());
  for (const k of ["source_bot", "source_invite", "link_setup", "link_check", "suggest_reason"]) {
    for (const [lang, t] of [["en", en], ["fr", fr]]) {
      const v = t[k];
      assert.ok(v && v.length <= 60, `${lang}.${k}`);
      assert.ok(!/:|!|\{/.test(v), `${lang}.${k}: no colon, no exclamation mark`);
      assert.ok(!/\b(token|jeton|api|service|webhook|identifiant|json|cache|oauth|cl[ée]|key)\b/i.test(v), `${lang}.${k}: jargon`);
      assert.ok(!/normally|usually|for now|if not already|normalement|en principe|pour l'instant|si ce n'est pas d[ée]j[aà]|rien [àa] faire|nothing to do|don't worry|ne vous inqui/i.test(v), `${lang}.${k}`);
    }
  }
  assert.equal(en.source_bot, "Counted by your Discord bot"); assert.equal(en.source_invite, "Counted from the public invite");
  assert.equal(fr.source_bot, "Compté par votre bot Discord"); assert.equal(fr.source_invite, "Compté depuis l'invitation publique");
  assert.match(fr.link_setup, /^Configurer/); assert.match(fr.link_check, /^Vérifier/);
});

// ── No connector: the module behaves as before ───────────────────────────────

test("no connector: the figure comes from the public invitation, the panel says so and offers the core's own suggestion (nothing installed by itself)", async () => {
  const ctx = ctxOf();
  const items = await stat(ctx);
  assert.deepEqual(problemsOfList(items, { module: "discord", platform: "discord" }), []);
  assert.deepEqual(items.map((i) => [i.value, i.account, i.url]), [[INVITE_MEMBERS, "Camille's corner", "https://discord.gg/abcDEF"]]);
  assert.equal(inviteCalls.length, 1);
  assert.equal(d.log.length, 0, "no Discord call for the bot");
  const blocks = await panel(ctx);
  assert.equal(text(blocks), `**Discord members**: ${INVITE_MEMBERS}\n\nCounted from the public invite`);
  assert.deepEqual(links(blocks), [], "no link: nothing to open yet");
  assert.deepEqual(blocks.filter((b) => b.type === "suggestInstall"), [{ type: "suggestInstall", service: "discord.api", min: 1, reason: "counts your members with a Discord bot" }]);
});

test("no connector, French panel", async () => {
  const blocks = await panel(ctxOf(undefined, { locale: "fr" }));
  assert.equal(text(blocks), `**Membres Discord** : ${INVITE_MEMBERS}\n\nCompté depuis l'invitation publique`);
  assert.equal(blocks.find((b) => b.type === "suggestInstall").reason, "compte vos membres avec un bot Discord");
});

test("an old core with no services at all, or a service that throws at once, behaves as without a connector", async () => {
  const ctx = ctxOf();
  const noServices = { ...ctx, api: new Proxy(ctx.api, { get: (t, p) => (p === "services" ? undefined : t[p]) }) };
  assert.equal((await stat(noServices))[0].value, INVITE_MEMBERS);
  mod.resetCache();
  const throwing = ctxOf({ "discord.api": { status: () => { throw new Error("boom"); } } });
  assert.equal((await stat(throwing))[0].value, INVITE_MEMBERS);
});

// ── Connector set up ─────────────────────────────────────────────────────────

test("connector ready and the account is the bot's server: the figure is the bot's, kept 5 minutes, the panel says so with no link", async () => {
  const ctx = ctxOf(withBot());
  const items = await stat(ctx);
  assert.deepEqual(problemsOfList(items, { module: "discord", platform: "discord" }), []);
  assert.deepEqual(items.map((i) => [i.value, i.account]), [[1234, "Camille's corner"]]);
  assert.equal(guildStatsCalls(), 1);
  for (let i = 0; i < 10; i++) await stat(ctx);
  assert.equal(guildStatsCalls(), 1, "kept: a public page may ask as often as it likes");
  assert.equal(inviteCalls.length, 1, "the invitation is read once, to know which server it is");
  const blocks = await panel(ctx);
  assert.equal(text(blocks), "**Discord members**: 1,234\n\nCounted by your Discord bot");
  assert.deepEqual(links(blocks), []);
  assert.deepEqual(blocks.filter((b) => b.type !== "markdown"), []);
  const fr1 = await panel(ctxOf(withBot(), { locale: "fr" }));
  assert.equal(text(fr1), `**Membres Discord** : ${(1234).toLocaleString("fr")}\n\nCompté par votre bot Discord`);
});

test("after 5 minutes the bot is asked again (a new figure), not before", async () => {
  const ctx = ctxOf(withBot());
  let now = realNow(); Date.now = () => now;
  assert.equal((await stat(ctx))[0].value, 1234);
  d.state.counts = { members: 2000, online: 5 };
  now += 4 * 60_000; assert.equal((await stat(ctx))[0].value, 1234);
  now += 2 * 60_000;
  connectorModule.resetCache();
  assert.equal((await stat(ctx))[0].value, 2000);
});

test("connector ready but the account is ANOTHER Discord server: its own invitation is counted, the bot's number is never shown for it", async () => {
  inviteGuild = OTHER_GUILD;
  const ctx = ctxOf(withBot(), { key: "friend", settings: { profile: "https://discord.gg/friend1" } });
  const items = await stat(ctx);
  assert.equal(items[0].value, INVITE_MEMBERS);
  assert.equal(guildStatsCalls(), 0);
  const blocks = await panel(ctx);
  assert.equal(text(blocks), `**Discord members**: ${INVITE_MEMBERS}\n\nCounted from the public invite`);
  assert.deepEqual(links(blocks), [], "the bot is not meant for this account: no nagging");
  assert.deepEqual(blocks.filter((b) => b.type !== "markdown"), []);
});

test("two accounts: the bot's server gets the bot's figure, the other one its invitation", async () => {
  const services = withBot();
  const mine = ctxOf(services, { key: "mine", settings: { profile: "https://discord.gg/mine1" } });
  const friend = ctxOf(services, { key: "friend", settings: { profile: "https://discord.gg/friend1" } });
  const answer = globalThis.fetch;
  globalThis.fetch = async (url, init) => { inviteGuild = String(url).includes("friend1") ? OTHER_GUILD : IDS.guild; return answer(url, init); };
  const [a, b] = [await stat(mine), await stat(friend)];
  assert.deepEqual([a[0].value, b[0].value], [1234, INVITE_MEMBERS]);
});

test("a profile that is not an invitation: the server is unknown, so the bot is not used (the usual message stays)", async () => {
  const ctx = ctxOf(withBot(), { settings: { profile: "https://discord.com/channels/1/2" } });
  const items = await stat(ctx);
  assert.deepEqual(items.map((i) => [i.error, "value" in i]), [["config", false]]);
  assert.equal(guildStatsCalls(), 0);
  assert.equal(text(await panel(ctx)), en.err_config_invite, "an error is shown alone: no source line, no link");
});

test("the invitation expired after it was seen once: the same server is still counted by the bot", async () => {
  const ctx = ctxOf(withBot());
  let now = realNow(); Date.now = () => now;
  assert.equal((await stat(ctx))[0].value, 1234);
  inviteStatus = 404; now += 31 * 60_000; connectorModule.resetCache();
  assert.equal((await stat(ctx))[0].value, 1234);
});

// ── Every way the connector can fail: silent fallback ────────────────────────

const REASONS = ["not_configured", "invalid_input", "forbidden", "not_found", "not_member", "rate_limited", "unavailable", "failed"];
for (const reason of REASONS) {
  test(`guildStats answers ${reason}: the invitation figure is used, nothing visible to visitors, ONE link for the owner`, async () => {
    const ctx = ctxOf(stub(READY, { ok: false, reason }));
    const items = await stat(ctx);
    assert.deepEqual(problemsOfList(items, { module: "discord", platform: "discord" }), []);
    assert.deepEqual(items.map((i) => [i.value, i.error]), [[INVITE_MEMBERS, undefined]]);
    const blocks = await panel(ctx);
    const want = reason === "not_configured" ? en.link_setup : en.link_check;
    assert.equal(text(blocks), `**Discord members**: ${INVITE_MEMBERS}\n\n${en.source_invite} [${want}](/admin/modules/discord-connector)`);
    assert.deepEqual(links(blocks), ["/admin/modules/discord-connector"]);
    assert.deepEqual(blocks.filter((b) => b.type !== "markdown"), []);
  });
}

test("every odd answer of the service falls back the same way (garbage, wrong types, negative or fractional numbers, a throwing method)", async () => {
  const odd = [null, "x", 12, [], {}, { ok: true }, { ok: true, memberCount: "many" }, { ok: true, memberCount: -3 }, { ok: true, memberCount: 1.5 }, { ok: true, memberCount: null }, { ok: false }, { ok: false, reason: 5 }];
  for (const answer of odd) {
    mod.resetCache();
    const items = await stat(ctxOf(stub(READY, answer)));
    assert.deepEqual(items.map((i) => i.value), [INVITE_MEMBERS], JSON.stringify(answer));
  }
  mod.resetCache();
  const throwing = { "discord.api": { status: async () => READY, guildStats: async () => { throw new Error("secret-in-error TESTBOTCODE"); } } };
  assert.deepEqual((await stat(ctxOf(throwing))).map((i) => i.value), [INVITE_MEMBERS]);
});

test("the bot is not ready: no guildStats call, the owner gets the link to set it up; a status that fails or has no server is the same", async () => {
  for (const status of [{ ok: true, bot: false, oauth: false }, { ok: true, bot: true, oauth: false }, { ok: false, reason: "not_configured" }]) {
    mod.resetCache();
    let asked = 0;
    const ctx = ctxOf({ "discord.api": { status: async () => status, guildStats: async () => { asked++; return { ok: true, memberCount: 9 }; } } });
    assert.equal((await stat(ctx))[0].value, INVITE_MEMBERS);
    assert.equal(asked, 0, JSON.stringify(status));
    assert.equal(text(await panel(ctx)).split("\n\n")[1], `${en.source_invite} [${en.link_setup}](/admin/modules/discord-connector)`);
  }
  mod.resetCache();
  const failing = ctxOf({ "discord.api": { status: async () => ({ ok: false, reason: "failed" }) } });
  assert.equal(text(await panel(failing)).split("\n\n")[1], `${en.source_invite} [${en.link_check}](/admin/modules/discord-connector)`);
});

test("a connector that never answers: the figure still comes within the short delay, from the invitation", async () => {
  mod.timing.botMs = 40;
  const hang = new Promise(() => {});
  const ctx = ctxOf({ "discord.api": { status: async () => READY, guildStats: () => hang } });
  const t0 = realNow();
  const items = await stat(ctx);
  assert.ok(realNow() - t0 < 1000, `took ${realNow() - t0} ms`);
  assert.equal(items[0].value, INVITE_MEMBERS);
  mod.resetCache();
  const hangStatus = ctxOf({ "discord.api": { status: () => hang } });
  assert.equal((await stat(hangStatus))[0].value, INVITE_MEMBERS);
});

test("in a public page the wait for the connector never exceeds the time left (300 ms are kept)", async () => {
  const hang = new Promise(() => {});
  const ctx = ctxOf({ "discord.api": { status: () => hang } }, { netBudgetMs: 450 });
  const t0 = realNow();
  const items = await stat(ctx);
  assert.ok(realNow() - t0 < 600, `took ${realNow() - t0} ms`);
  assert.equal(items[0].value, INVITE_MEMBERS);
});

test("the real connector failing: not set up, bot removed from the server, Discord down, a pause: always the invitation figure", async () => {
  const cases = [
    [() => withBot({ app: null }), en.link_setup],
    [() => { d.state.inGuild = false; return withBot(); }, en.link_check],
    [() => { d.state.down = true; return withBot(); }, en.link_check],
    [() => { d.state.rateUntil = Date.now() + 30_000; return withBot(); }, en.link_check],
  ];
  for (const [make, label] of cases) {
    mod.resetCache(); connectorModule.resetCache(); d = fakeDiscord();
    const services = make();
    const ctx = ctxOf(services);
    const items = await stat(ctx);
    assert.deepEqual(items.map((i) => [i.value, i.error]), [[INVITE_MEMBERS, undefined]], label);
    const blocks = await panel(ctx);
    assert.deepEqual(links(blocks), ["/admin/modules/discord-connector"], label);
    assert.match(text(blocks), new RegExp(`\\[${label.replace(/[→]/g, "\\u2192")}\\]`));
  }
});

// ── Last known value, then nothing ───────────────────────────────────────────

test("bot and invitation both fail: the last figure is kept with its real date for 30 minutes, then no number (never an invented or old one)", async () => {
  const services = withBot();
  const ctx = ctxOf(services);
  let now = realNow(); Date.now = () => now;
  assert.equal((await stat(ctx))[0].value, 1234);
  now += 6 * 60_000; d.state.counts = { members: 2000, online: 1 }; connectorModule.resetCache();
  const first = (await stat(ctx))[0];
  assert.equal(first.value, 2000);
  d.state.down = true; inviteStatus = 500; connectorModule.resetCache();
  now += 25 * 60_000;   // the invitation figure (kept 30 minutes) is now too old, the bot's last figure is 25 minutes old
  const again = (await stat(ctx))[0];
  assert.deepEqual([again.value, again.asOf, again.error], [2000, first.asOf, undefined], "same figure, honest date");
  assert.deepEqual(problemsOf(again, { module: "discord", platform: "discord" }), []);
  now += 40 * 60_000;
  const gone = (await stat(ctx))[0];
  assert.deepEqual([gone.error, "value" in gone], ["network", false]);
  assert.equal(text(await panel(ctx)), en.err_network, "no source line, no link: just what happens");
});

// ── No secret, no extra detail ───────────────────────────────────────────────

test("nothing of the bot reaches visitors or the panel: no code, no server number, only the figure", async () => {
  const ctx = ctxOf(withBot());
  const out = JSON.stringify([await stat(ctx), await panel(ctx), ctx.calls.services]);
  assert.ok(!out.includes(BOT_CODE) && !out.includes("TESTBOTCODE"));
  assert.ok(!out.includes(IDS.guild), "the server number is not published");
  assert.ok(!out.includes(IDS.app));
  assert.deepEqual(ctx.calls.services.map((c) => [c[0], c[1], c[2]]), [["discord.api", "status", {}], ["discord.api", "guildStats", {}]], "two read-only methods, no argument");
  mod.resetCache();
  const failing = ctxOf(withBot({ app: { applicationId: IDS.app, guildId: IDS.guild, botToken: "WRONG.abcdefghijklmnop.0123456789_ABCDEFGH" } }));
  const bad = JSON.stringify([await stat(failing), await panel(failing)]);
  assert.ok(!bad.includes("WRONG") && !bad.includes(BOT_CODE));
});

test("only the two read-only methods are ever called, and the collector can ask many times at once for ONE call each", async () => {
  const ctx = ctxOf(withBot());
  await Promise.all(Array.from({ length: 12 }, () => stat(ctx)));
  assert.equal(guildStatsCalls(), 1);
  assert.equal(inviteCalls.length, 1);
  assert.ok(ctx.calls.services.every((c) => ["status", "guildStats"].includes(c[1])));
});

test("the panel and the collector stay silent when the statistics are unticked, and the button is untouched", async () => {
  const ctx = ctxOf(withBot(), { settings: { trackStats: false } });
  assert.deepEqual(await stat(ctx), []);
  assert.deepEqual(await panel(ctx), []);
  assert.equal(ctx.calls.services.length, 0);
  assert.deepEqual(def.exports["social.link"](ctx), [{ label: "Discord · abcDEF", url: "https://discord.gg/abcDEF", icon: "discord" }]);
});

// ── Admin page kit (admin.ergonomics) ────────────────────────────────────────

test("admin.ergonomics: every state of the panel (bot, invitation, no connector, not set up, degraded, other server, error) in both languages", async () => {
  const { assertAdminPageErgonomics } = await import("./helpers/ergonomics.mjs");
  for (const locale of ["en", "fr"]) {
    const states = [
      () => withBot(), () => undefined, () => stub({ ok: true, bot: false }, null), () => stub(READY, { ok: false, reason: "forbidden" }),
      () => { inviteStatus = 404; return undefined; },
    ];
    for (const make of states) {
      mod.resetCache(); connectorModule.resetCache(); d = fakeDiscord(); inviteStatus = 200;
      const services = make();
      assertAdminPageErgonomics(await panel(ctxOf(services, { locale })));
    }
    mod.resetCache(); inviteGuild = OTHER_GUILD;
    assertAdminPageErgonomics(await panel(ctxOf(withBot(), { locale })));
    inviteGuild = IDS.guild;
  }
});
