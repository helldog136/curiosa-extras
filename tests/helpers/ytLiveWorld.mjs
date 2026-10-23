// Un site complet pour essayer « Actions du live YouTube » : les VRAIS modules (Connecteur YouTube, Chaîne YouTube, Home Assistant, Actions du live YouTube), un faux YouTube
// (tests/helpers/fakeYoutubeLive.mjs) branché sur fetch, un faux Home Assistant qui parle le contrat réel (tests/helpers/fakeHaClient.mjs) et une horloge simulée.
//   const w = await world();             // direct absent, Home Assistant associé et ouvert, une page « ouverte » à volonté
//   w.yt.goLive(); w.yt.say(w.yt.superChat({ micros: 5_000_000, currency: "EUR" }));  await w.read();   // un tour de lecture (la page se recharge)
//   await w.ha.step();                   // Home Assistant vient chercher ce qui l'attend
//   w.done();
import fs from "node:fs";
import { mock } from "node:test";
import { fakeCtx } from "./fakeCtx.mjs";
import { FakeHaClient, directTransport } from "./fakeHaClient.mjs";
import { fakeYoutubeLive, CHANNEL } from "./fakeYoutubeLive.mjs";
import { makeConnector, connectorApi } from "./fakeYoutube.mjs";

const dir = (m) => new URL(`../../modules/${m}/`, import.meta.url).pathname;
const json = (m, f) => JSON.parse(fs.readFileSync(`${dir(m)}${f}`, "utf8"));
export const manifest = json("youtube-live-actions", "module.json");
export const messages = { fr: json("youtube-live-actions", "locales/fr.json"), en: json("youtube-live-actions", "locales/en.json") };
const haManifest = json("home-assistant", "module.json");
const channelMessages = json("youtube-channel", "locales/fr.json");
const haMessages = json("home-assistant", "locales/fr.json");

export const def = (await import("../../modules/youtube-live-actions/index.mjs")).default;
export const E = await import("../../modules/youtube-live-actions/engine.mjs");
export const S = await import("../../modules/youtube-live-actions/store.mjs");
export const R = await import("../../modules/youtube-live-actions/rules.mjs");
export const C = await import("../../modules/youtube-live-actions/chat.mjs");
export const B = await import("../../modules/youtube-live-actions/bridge.mjs");
export const A = await import("../../modules/youtube-live-actions/admin.mjs");
export const T = (await import("../../modules/youtube-live-actions/tools.mjs")).default;
export const SET = await import("../../modules/youtube-live-actions/settings.mjs");
const channelDef = (await import("../../modules/youtube-channel/index.mjs")).default;
const channelLive = await import("../../modules/youtube-channel/live.mjs");
const haDef = (await import("../../modules/home-assistant/index.mjs")).default;
const HAB = await import("../../modules/home-assistant/bridge.mjs");
const HAL = await import("../../modules/home-assistant/live.mjs");

export const T0 = Date.parse("2026-10-14T20:00:00Z");
export const defaults = Object.fromEntries(manifest.settings.filter((s) => s.default !== undefined).map((s) => [s.key, s.default]));
export const ALL_RIGHTS = manifest.rights.map((r) => r.id);
export { CHANNEL };

/**
 * Options : settings, locale, rights, noBridge (Home Assistant absent), noConnector, apiKey (null = pas de clé), twitchLive ({ known, live } ou null), paired (défaut oui),
 * yt (options du faux YouTube), key (clé d'instance), choice (résolution du réglage « chaîne »).
 */
export async function world(o = {}) {
  mock.timers.reset();
  mock.timers.enable({ apis: ["Date"], now: T0 });
  HAB.resetMemory(); HAL.resetLive(); connectorApi.resetState(); channelLive.resetLive(); E.resetSims(); S.resetStore();
  const realFetch = globalThis.fetch;
  const yt = fakeYoutubeLive(o.yt);
  globalThis.fetch = yt.fetch;
  const conn = makeConnector({ apiKey: o.apiKey === undefined ? "FAKE-YT-KEY-0001" : o.apiKey, settings: o.connectorSettings ?? {} });
  const chanCtx = fakeCtx({ moduleId: "youtube-channel", key: "chaine", settings: { channelId: CHANNEL }, services: conn.services, messages: channelMessages, permissions: ["sections", "topics", "admin"] });
  const chanMethods = { current: (a) => channelDef.services["youtube.live"].current(chanCtx, a) };

  const liveState = { known: true, live: true, ...o.twitchLive };
  const haCtx = fakeCtx({
    key: "ha", moduleId: "home-assistant", name: "Home Assistant", basePath: "", locale: "fr", defaultLocale: "fr", locales: ["fr", "en"], messages: haMessages,
    settings: Object.fromEntries(haManifest.settings.filter((s) => s.default !== undefined).map((s) => [s.key, s.default])), permissions: haManifest.permissions, siteUrl: "https://site.example.org",
    serviceInstances: o.twitchLive === null ? {} : { "twitch.live": [{ instance: "chan", methods: { status: () => liveState } }] },
  });
  haCtx.can = () => true;
  const bridgeMethods = Object.fromEntries(Object.keys(haDef.services["home-assistant.bridge"]).map((m) => [m, (a) => haDef.services["home-assistant.bridge"][m](haCtx, a)]));
  const ha = new FakeHaClient({ send: directTransport(haDef, haCtx), bindings: { "lumieres:rouge": async () => {}, "lumieres:vert": async () => {}, "tts:lire": async () => {}, ...o.bindings } });

  const rights = o.rights ?? ALL_RIGHTS;
  const ctx = fakeCtx({
    key: o.key ?? "yt", moduleId: "youtube-live-actions", name: "Actions du live YouTube", basePath: "", locale: o.locale ?? "fr", defaultLocale: "fr", locales: ["fr", "en"],
    messages: messages[o.locale ?? "fr"], settings: { ...defaults, ...o.settings }, permissions: manifest.permissions, siteUrl: "https://site.example.org",
    services: { ...(o.noConnector ? {} : { "youtube.api": conn.methods }), ...(o.noBridge ? {} : { "home-assistant.bridge": bridgeMethods }) },
    serviceInstances: o.noChannel ? {} : { "youtube.live": [{ instance: "chaine", methods: chanMethods }] },
    choices: { channel: o.choice ?? (o.noChannel ? { status: "none" } : { status: "only", id: "id-chaine" }) },
    topics: { "ha.result": () => haDef.exports["ha.result"](haCtx, { limit: 100 }) },
  });
  ctx.can = (r) => rights.includes(r);

  const w = {
    yt, conn, ctx, haCtx, ha, bridge: bridgeMethods, def, liveState, executed: () => ha.executed,
    /** Fait avancer l'horloge. */
    tick: (ms) => mock.timers.tick(ms),
    /** Une page ouverte qui se recharge : un tour de lecture. */
    read: (ms = 0) => { if (ms) mock.timers.tick(ms); return E.tick(ctx); },
    /** Les lignes du journal. */
    journal: () => S.readJournal(ctx),
    state: () => S.readState(ctx),
    /** Le panneau d'administration tel que la page le dessine (avec un tour de lecture). */
    panel: (query) => A.panel(ctx, { query }),
    dump: () => JSON.stringify(ctx.dumpStore()),
    done: () => { globalThis.fetch = realFetch; mock.timers.reset(); },
  };
  if (o.paired !== false && !o.noBridge) {
    const { code } = await HAB.createPairing(haCtx);
    const r = await ha.pair(code, "Maison");
    if (r.status !== 200) throw new Error(`appairage refusé : ${JSON.stringify(r.body)}`);
    await ha.pull();   // Home Assistant se montre : il est « connecté »
    mock.timers.tick(1100);
  }
  return w;
}
