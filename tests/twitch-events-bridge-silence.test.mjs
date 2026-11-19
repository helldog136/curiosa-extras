// Twitch events 1.15.0 (the bridge that keeps working until it hands over): the same rules as the Alerts overlay copy. A type with its alert off is still listened to,
// the stream start and end are always listened to, and a silence is only reported while the module knows the stream is live.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const HE = await import("../modules/twitch-events/health.mjs");
const ES = await import("../modules/twitch-events/eventsub.mjs");
const ST = await import("../modules/twitch-events/state.mjs");
const read = (p) => JSON.parse(fs.readFileSync(new URL(`../modules/twitch-events/${p}`, import.meta.url), "utf8"));
const HOUR = 3_600_000, NOW = Date.parse("2026-11-19T01:00:00Z");

test("bridge: the stream start and end are always listened to; a muted line is stored with its flag", () => {
  assert.deepEqual(ES.ALWAYS_LISTENED, ["online", "offline"]);
  assert.equal(ES.typeOf("online").scopes.length, 0); assert.equal(ES.typeOf("offline").scopes.length, 0);
  const doc = ST.toDoc("a1", { kind: "cheer", amount: 500, at: NOW }, { muted: true, now: NOW });
  assert.equal(doc.muted, true);
  assert.equal(ST.toDoc("a2", { kind: "cheer", amount: 500, at: NOW }, { now: NOW }).muted, undefined);
});

test("bridge: no silence for a start that is stale, or when the stream state is not listened to; real silence still warns", () => {
  const live = { liveSince: NOW, lastEventAt: NOW };
  assert.equal(HE.silent({ ...live, types: { online: { code: "off" }, offline: { code: "off" } } }, { silentHours: 3 }, NOW + 9 * HOUR), false);
  assert.equal(HE.silent({ ...live, types: { online: { code: "listening" }, offline: { code: "listening" } } }, { silentHours: 3 }, NOW + 9 * HOUR), true);
  assert.equal(HE.silent(live, { silentHours: 3 }, NOW + 49 * HOUR), false);
  assert.equal(HE.silent({ liveSince: null, lastEventAt: 0 }, { silentHours: 3 }, NOW + 99 * HOUR), false);
});

test("bridge: the mail and the banner are exact, without reassurance, in both languages", () => {
  for (const lang of ["en", "fr"]) {
    const m = read(`locales/${lang}.json`);
    assert.ok(!/rien n'est perdu|nothing is lost|Ce qui se passe|What happens|Que faire|What to do|Follows and subs|follows et abonnements/i.test(`${m.mail_body_problem}${m.mail_body_back}`), lang);
    for (const k of ["{what}", "{since}", "{link}"]) assert.ok(m.mail_body_problem.includes(k), `${lang} ${k}`);
  }
  assert.deepEqual(Object.keys(read("locales/en.json")).sort(), Object.keys(read("locales/fr.json")).sort());
});
