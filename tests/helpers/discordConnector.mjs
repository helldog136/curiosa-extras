// A real Discord connector for the tests of the modules that use it: its context (fakeCtx, ctx.api.net = the core's real network client plugged on globalThis.fetch,
// hence on the fake Discord of fakeDiscord.mjs) and its service methods bound to that context, ready to hand to a consumer:
//   const C = connector();                                      // bot registered: application, server, secret code of the fake Discord
//   const ctx = fakeCtx({ services: { "discord.api": C.methods } });
import fs from "node:fs";
import { fakeCtx } from "./fakeCtx.mjs";
import { BOT_CODE, IDS } from "./fakeDiscord.mjs";

const manifest = JSON.parse(fs.readFileSync(new URL("../../modules/discord-connector/module.json", import.meta.url), "utf8"));
const mod = await import("../../modules/discord-connector/index.mjs");
export const connectorModule = mod;
export const connectorDef = mod.default;
export const CONNECTOR_KEY = "discord-connector";

export function connector({ owner = true, app = { applicationId: IDS.app, guildId: IDS.guild, botToken: BOT_CODE }, messages = {}, rows = {}, ...rest } = {}) {
  const ctx = fakeCtx({ moduleId: "discord-connector", key: CONNECTOR_KEY, messages, logEvents: manifest.logEvents, permissions: manifest.permissions, rows: { ...(app ? { discordApp: [app] } : {}), ...rows }, ...rest });
  ctx.can = (right) => owner && right === "bot.manage";   // the owner holds the right; `owner: false` is somebody who may open the page and nothing more
  const svc = connectorDef.services["discord.api"];
  const methods = Object.fromEntries(Object.keys(svc).map((m) => [m, (args) => svc[m](ctx, args)]));
  return { ctx, methods, instance: { instance: CONNECTOR_KEY, name: "Discord connector", module: "discord-connector", version: 1, methods } };
}
