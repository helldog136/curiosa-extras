// Faux YouTube pour les tests : le VRAI Connecteur YouTube (modules/youtube-connector) branché sur un faux contexte, et des réponses de l'interface
// de données YouTube prêtes à l'emploi. Le réseau passe par le vrai client du cœur (ctx.api.net de fakeCtx), donc par `globalThis.fetch` :
// combinez avec fakeFetch / withFakeFetch et netReplies (pannes : quotaExceeded, rateLimited, silence, truncatedJson…).
import fs from "node:fs";
import { fakeCtx } from "./fakeCtx.mjs";

const DIR = new URL("../../modules/youtube-connector/", import.meta.url).pathname;
export const connectorModule = await import("../../modules/youtube-connector/index.mjs");
export const connectorApi = await import("../../modules/youtube-connector/api.mjs");
export const connectorMessages = (locale = "fr") => JSON.parse(fs.readFileSync(`${DIR}locales/${locale}.json`, "utf8"));

/**
 * Un Connecteur YouTube prêt à servir : { ctx, methods, services }.
 *   services : à passer tel quel à fakeCtx({ services }) du module consommateur (`youtube.api` → les vraies méthodes du Connecteur, avec SON contexte).
 * Options : apiKey (réglage « Clé YouTube », null = aucun), settings (autres réglages), locale, et toute option de fakeCtx.
 */
export function makeConnector({ apiKey = "FAKE-YT-KEY-0001", settings = {}, locale = "fr", key = "youtube-connector", ...opts } = {}) {
  const ctx = fakeCtx({ moduleId: "youtube-connector", key, locale, messages: connectorMessages(locale), settings: { ...(apiKey ? { apiKey } : {}), ...settings }, ...opts });
  const methods = Object.fromEntries(Object.entries(connectorModule.default.services["youtube.api"]).map(([m, fn]) => [m, (args) => fn(ctx, args)]));
  return { ctx, methods, services: { "youtube.api": methods } };
}

/** Réponses JSON de YouTube (forme réelle, réduite à ce que les modules lisent). */
export const yt = {
  channel: (id, { title = "Chaîne", subscribers = "1230", hidden = false, videos = "12", views = "3400", uploads = `UU${id.slice(2)}`, handle = "@chaine" } = {}) => ({
    kind: "youtube#channel", id,
    snippet: { title, customUrl: handle, thumbnails: { default: { url: `https://yt3.example.test/${id}-s88` }, medium: { url: `https://yt3.example.test/${id}-s240` } } },
    statistics: { ...(hidden ? {} : { subscriberCount: subscribers }), hiddenSubscriberCount: hidden, videoCount: videos, viewCount: views },
    contentDetails: { relatedPlaylists: { uploads } },
  }),
  list: (items) => ({ kind: "youtube#listResponse", items }),
  keyInvalid: () => ({ error: { code: 400, message: "API key not valid. Please pass a valid API key.", errors: [{ reason: "badRequest" }], details: [{ reason: "API_KEY_INVALID" }] } }),
};
