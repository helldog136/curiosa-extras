// Mastodon: the server of the account is typed by the person, and the site's server calls it. Before each call (and each redirect hop), the name is
// resolved and every address it leads to must be public. Never a real network: `fetch` and the name resolution are fakes (tests/helpers/fakeResolver.mjs).
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { fakeResolver, PUBLIC_V4, PUBLIC_V6 } from "./helpers/fakeResolver.mjs";

const root = new URL("../modules/mastodon/", import.meta.url).pathname;
const mod = await import("../modules/mastodon/index.mjs");
const messages = { fr: JSON.parse(fs.readFileSync(`${root}locales/fr.json`, "utf8")), en: JSON.parse(fs.readFileSync(`${root}locales/en.json`, "utf8")) };
const OK = { followers_count: 77, statuses_count: 1500, acct: "etoile_nord" };
const realFetch = globalThis.fetch;
const calls = [];
let answer;
const json = (status, body = {}, headers = {}) => new Response(status >= 300 && status < 400 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const ctxOf = (profile, locale = "fr") => fakeCtx({ key: "inst", locale, messages: messages[locale], name: "Mon compte", settings: { profile }, siteUrl: "https://site.example" });
const stat = (ctx) => mod.default.exports["social.stat"](ctx, { locale: ctx.locale, limit: 50, tags: [] });

beforeEach(() => {
  mod.resetCache(); calls.length = 0; answer = () => json(200, OK);
  globalThis.fetch = async (url, init = {}) => { calls.push(String(url)); return answer(String(url), init); };
});
afterEach(() => { globalThis.fetch = realFetch; mod.hooks.resolve = null; });

const PRIVATE = {
  "IPv4 loopback": "127.0.0.1", "IPv4 loopback, other": "127.8.9.10", "cloud metadata (link-local)": "169.254.169.254", "private 10/8": "10.20.30.40",
  "private 172.16/12 (low)": "172.16.0.1", "private 172.16/12 (high)": "172.31.255.254", "private 192.168/16": "192.168.1.20", "shared CGNAT 100.64/10": "100.100.0.1",
  "this network 0/8": "0.0.0.0", "multicast": "224.0.0.251", "reserved 240/4": "250.1.2.3", "broadcast": "255.255.255.255", "benchmarking 198.18/15": "198.18.0.5",
  "IPv6 loopback": "::1", "IPv6 unspecified": "::", "IPv6 unique local fc00::/7 (fc)": "fc00::1", "IPv6 unique local fc00::/7 (fd)": "fd12:3456:789a::1",
  "IPv6 link-local": "fe80::1", "IPv6 multicast": "ff02::1", "IPv4-mapped loopback (dotted)": "::ffff:127.0.0.1", "IPv4-mapped loopback (hex)": "::ffff:7f00:1",
  "IPv4-mapped metadata": "::ffff:169.254.169.254", "IPv4-mapped 10/8 (hex)": "::ffff:a00:1", "IPv4-mapped 192.168 (expanded)": "0:0:0:0:0:ffff:c0a8:0101",
  "NAT64 to metadata": "64:ff9b::a9fe:a9fe", "IPv6 documentation": "2001:db8::1", "6to4": "2002:7f00:1::1",
};
const PUBLIC = ["93.184.215.14", "8.8.4.4", "172.32.0.1", "100.128.0.1", "2a01:4f8:c0c:1::1", "2606:4700::1111", "::ffff:93.184.215.14"];

test("isPrivateAddress: every private, loopback, link-local, CGNAT, multicast and IPv6 local form is refused; ordinary public addresses pass", () => {
  for (const [what, ip] of Object.entries(PRIVATE)) assert.equal(mod.isPrivateAddress(ip), true, `${what}: ${ip}`);
  for (const ip of PUBLIC) assert.equal(mod.isPrivateAddress(ip), false, ip);
  for (const junk of ["", "x", "1.2.3", "1.2.3.4.5", ":::1", "fe80::1::2", null, undefined]) assert.equal(mod.isPrivateAddress(junk), true, String(junk));
});

test("an address written with numbers is judged by its value, whatever its spelling", () => {
  for (const url of ["https://127.0.0.1/@a", "https://2130706433/@a", "https://0x7f.1/@a", "https://[::ffff:7f00:1]/@a", "https://[::ffff:127.0.0.1]/@a", "https://[fc00::1]/@a", "https://169.254.169.254/@a"]) {
    assert.equal(mod.isPublicHttpsUrl(url), false, url);
  }
  assert.equal(mod.isPublicHttpsUrl("https://mastodon.example/@a"), true);
});

for (const [what, ip] of Object.entries(PRIVATE)) {
  test(`a server name that resolves to ${what} (${ip}) is never called, and the person reads why`, async () => {
    mod.hooks.resolve = fakeResolver({ "mastodon.example": ip });
    const items = await stat(ctxOf("https://mastodon.example/@etoile_nord"));
    assert.equal(calls.length, 0, "no request at all");
    assert.ok(items.length && items.every((i) => i.error === "config" && !("value" in i)), JSON.stringify(items));
  });
}

test("one private address among public ones is enough to refuse (a name with several addresses)", async () => {
  mod.hooks.resolve = fakeResolver({ "mastodon.example": [PUBLIC_V4, PUBLIC_V6, "10.0.0.7"] });
  const items = await stat(ctxOf("https://mastodon.example/@etoile_nord"));
  assert.equal(calls.length, 0);
  assert.ok(items.every((i) => i.error === "config"));
});

test("a server name that resolves to public addresses is called normally", async () => {
  const resolve = fakeResolver({ "mastodon.example": [PUBLIC_V4, PUBLIC_V6] });
  mod.hooks.resolve = resolve;
  const items = await stat(ctxOf("https://mastodon.example/@etoile_nord"));
  assert.deepEqual(resolve.calls, ["mastodon.example"]);
  assert.deepEqual(calls, ["https://mastodon.example/api/v1/accounts/lookup?acct=etoile_nord"]);
  assert.deepEqual(items.map((i) => i.value), [77, 1500]);
});

test("a name that does not resolve is a network problem (tried again later), not a setting to fix", async () => {
  mod.hooks.resolve = fakeResolver({});
  const items = await stat(ctxOf("https://mastodon.example/@etoile_nord"));
  assert.equal(calls.length, 0);
  assert.ok(items.every((i) => i.error === "network"));
});

test("each redirect hop is checked again: a public server that redirects to a name leading to the internal network is not followed", async () => {
  const resolve = fakeResolver({ "mastodon.example": PUBLIC_V4, "relais.example": "169.254.169.254", "interne.example": "::ffff:10.0.0.1" });
  mod.hooks.resolve = resolve;
  for (const target of ["relais.example", "interne.example"]) {
    mod.resetCache(); calls.length = 0;
    answer = (url) => (url.startsWith("https://mastodon.example/") ? json(302, {}, { location: `https://${target}/api/v1/accounts/lookup?acct=etoile_nord` }) : json(200, OK));
    const items = await stat(ctxOf("https://mastodon.example/@etoile_nord"));
    assert.deepEqual(calls, ["https://mastodon.example/api/v1/accounts/lookup?acct=etoile_nord"], "the second hop is never requested");
    assert.ok(items.every((i) => i.error === "network"), JSON.stringify(items));
  }
  assert.ok(resolve.calls.includes("relais.example") && resolve.calls.includes("interne.example"));
});

test("a redirect to another public server is followed, after checking its name too", async () => {
  const resolve = fakeResolver({ "mastodon.example": PUBLIC_V4, "autre.example": PUBLIC_V6 });
  mod.hooks.resolve = resolve;
  answer = (url) => (url.startsWith("https://mastodon.example/") ? json(301, {}, { location: "https://autre.example/api/v1/accounts/lookup?acct=etoile_nord" }) : json(200, OK));
  const items = await stat(ctxOf("https://mastodon.example/@etoile_nord"));
  assert.deepEqual(resolve.calls, ["mastodon.example", "autre.example"]);
  assert.equal(calls.length, 2);
  assert.equal(items[0].value, 77);
});

test("the message is in plain words, in English and in French, and the panel shows it", async () => {
  assert.deepEqual(Object.keys(messages.en).sort(), Object.keys(messages.fr).sort());
  for (const m of [messages.en.err_config_private, messages.fr.err_config_private]) {
    assert.ok(m && m.length <= 160, m);
    assert.doesNotMatch(m, /\b(?:IP|DNS|SSRF|loopback|RFC)\b|!/i, m);
  }
  mod.hooks.resolve = fakeResolver({ "mastodon.example": "192.168.0.10" });
  for (const locale of ["fr", "en"]) {
    mod.resetCache();
    const blocks = await mod.default.adminPanel(ctxOf("https://mastodon.example/@etoile_nord", locale));
    const text = JSON.stringify(blocks);
    assert.ok(text.includes(JSON.stringify(messages[locale].err_config_private).slice(1, -1)), text);
  }
});
