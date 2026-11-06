// The Twitch bot and Audience wired the way the core wires them: the bot OFFERS "audience.remote" (one provider per bot), Audience CALLS it.
// Used by the tests of the bot panel of the remote control (phone and OBS dock). Invented names only.
import { world as botWorld, S, C, NOW } from "./botWorld.mjs";
import { audienceCtx, def as audDef, K as AK, R as AR, fr as audFr, en as audEn } from "./audienceHarness.mjs";
import { moduleAdminTheme } from "@/core/adminTheme";

export const botDef = (await import("../../modules/twitch-bot/index.mjs")).default;
export { audDef, AK, AR, S, C, NOW };

/**
 * remoteWorld({ audience, locale, bots }) → { bot, aud, tw, key, press, state, url }
 *   audience: false → the bot alone (no remote control at all)
 *   bots: more than one bot (each its own panel)
 */
export async function remoteWorld({ audience = true, locale = "en", bots = 1, botOptions = {} } = {}) {
  const first = botWorld({ locale, ...botOptions });
  const extra = Array.from({ length: Math.max(0, bots - 1) }, () => botWorld({ locale, ...botOptions }));
  const all = [first, ...extra];
  const methods = (b) => ({ describe: (a) => botDef.services["audience.remote"].describe(b.ctx, a), press: (a) => botDef.services["audience.remote"].press(b.ctx, a) });
  let aud = null, key = null;
  if (audience) {
    const instances = all.map((b, i) => ({ instance: i === 0 ? "bot" : `bot${i + 1}`, name: i === 0 ? "Twitch bot" : `Twitch bot ${i + 1}`, module: "twitch-bot", methods: methods(b) }));
    aud = audienceCtx({ locale, messages: locale === "fr" ? audFr : audEn, serviceInstances: { "audience.remote": instances } });
    aud.api.adminTheme = (o) => moduleAdminTheme(o);
    await AK.ensureMeta(aud);
    key = (await aud.api.store.list("meta")).find((r) => r.data.k === "cfg").data.remoteKey;
  }
  const url = (route, q = "") => `https://x.test/m/${aud?.instance.key}/${route}?k=${key}${q}`;
  return {
    bot: first.ctx, tw: first.tw, bots: all, aud, key, url, methods,
    /** The panels as the remote page receives them. */
    panels: async () => (await AR.remoteState(aud)).panels,
    /** A press through Audience's own function (the one the route calls once the address is checked). */
    press: (action, values = {}, panel = "id-bot") => AR.pressPanel(aud, { panel, action, values }),
    /** A press through the REAL route, with the secret address. */
    route: async (body, { k = key, ip = "9.9.9.9" } = {}) => audDef.routes["remote-press"](new Request(url("remote-press"), { method: "POST", body: JSON.stringify({ k, ...body }), headers: { "x-forwarded-for": ip, "content-type": "application/json" } }), aud),
    muted: () => S.isMuted(first.ctx),
    commands: async () => (await C.loadConfig(first.ctx)).data.custom,
  };
}
