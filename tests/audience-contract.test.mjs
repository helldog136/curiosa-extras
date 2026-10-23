// Le contrat « audience.session » v1 (tests/contract-ext/audience.md) : la même suite contre le double ET contre le vrai module.
import test from "node:test";
import assert from "node:assert/strict";
import { runAudienceContract, SESSION_METHODS } from "./contract-ext/audience.contract.mjs";
import { fakeAudience, AUDIENCE_METHODS, AUDIENCE_READ_ONLY } from "./helpers/fakeAudience.mjs";
import { audienceCtx, bind, def, manifest, req } from "./helpers/audienceHarness.mjs";

runAudienceContract(() => {
  const a = fakeAudience();
  return { session: a.methods, moderator: a.asModerator, direct: (q) => a.direct(q), dump: () => a.dump() };
}, { test, prefix: "double fakeAudience" });

runAudienceContract(() => {
  const ctx = audienceCtx();
  const session = bind(ctx, { rights: false });
  const moderator = bind(ctx, { rights: true });
  const route = async (q) => {
    const url = new URL("https://example.test/m/x/direct");
    for (const [k, v] of Object.entries(q)) if (v !== undefined) url.searchParams.set(k, v === undefined ? "" : v);
    return (await def.routes.direct(req(url.toString()), ctx)).json();
  };
  return { session, moderator, direct: (q) => route({ room: q.room, channel: q.channel, rev: q.rev, k: q.key }), dump: () => JSON.stringify(ctx.api.store.all()) };
}, { test, prefix: "module audience" });

test("le double offre exactement les méthodes du contrat, et le module aussi", () => {
  assert.deepEqual([...AUDIENCE_METHODS].sort(), [...SESSION_METHODS].sort());
  assert.deepEqual(Object.keys(def.services["audience.session"]).sort(), [...SESSION_METHODS].sort());
  assert.deepEqual([...manifest.offers[0].readOnly].sort(), [...AUDIENCE_READ_ONLY].sort());
  assert.deepEqual(manifest.offers[0].callerRights.sort(), ["clearRoom", "mute"]);
  assert.equal(manifest.offers[0].version, 1);
});
