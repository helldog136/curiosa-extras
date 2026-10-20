// Un vrai Connecteur Twitch pour les tests des modules qui s'en servent : son contexte (fakeCtx, ctx.api.net = le vrai client réseau du cœur branché sur
// globalThis.fetch, donc sur le faux Twitch de fakeTwitch.mjs) et ses méthodes de service liées à ce contexte, prêtes à passer à un consommateur :
//   const C = connector({ settings: { appClientId: "cid", appSecret: "SEC-RET" } });
//   const ctx = fakeCtx({ services: { "twitch.api": C.methods } });            // ou serviceInstances: { "twitch.api": [C.instance] }
import { fakeCtx } from "./fakeCtx.mjs";

const mod = await import("../../modules/twitch-connector/index.mjs");
export const connectorModule = mod;
export const connectorDef = mod.default;
export const CONNECTOR_KEY = "twitch-connector";
export const connectorCallback = (siteUrl = "https://example.test") => `${siteUrl}/m/${CONNECTOR_KEY}/oauth/callback`;

/** Le Connecteur, réglé par défaut avec l'application « cid » / « SEC-RET » du faux Twitch. `settings: {}` : sans application. */
export function connector({ settings = { appClientId: "cid", appSecret: "SEC-RET" }, siteUrl = "https://example.test", messages = {}, ...rest } = {}) {
  const ctx = fakeCtx({ moduleId: "twitch-connector", key: CONNECTOR_KEY, settings, siteUrl, messages, ...rest });
  const svc = connectorDef.services["twitch.api"];
  const methods = Object.fromEntries(Object.keys(svc).map((m) => [m, (args) => svc[m](ctx, args)]));
  return { ctx, methods, instance: { instance: CONNECTOR_KEY, name: "Connecteur Twitch", module: "twitch-connector", version: 3, methods }, callback: (req) => connectorDef.routes["oauth/callback"](req, ctx) };
}
