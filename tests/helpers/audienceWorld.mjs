// Deux modules côte à côte, câblés l'un à l'autre comme le fait le cœur : Sondages (qui demande « audience.session » en facultatif et offre « audience.remote »)
// et Participation (qui offre « audience.session » et appelle « audience.remote »). Chacun a son stockage et son contexte.
import fs from "node:fs";
import { fakeCtx } from "./fakeCtx.mjs";
import { pollsStore } from "./pollsStore.mjs";
import { audienceCtx, def as audienceDef } from "./audienceHarness.mjs";

const read = (rel) => JSON.parse(fs.readFileSync(new URL(`../../modules/${rel}`, import.meta.url), "utf8"));
export const pollsFr = read("polls/locales/fr.json");
export const pollsEn = read("polls/locales/en.json");
export const pollsDef = (await import("../../modules/polls/index.mjs")).default;
export const pollsMod = await import("../../modules/polls/index.mjs");

let n = 0;
/**
 * world({ audience: true|false }) → { polls, aud, pollsDef, audienceDef }
 *  - polls : contexte de Sondages ; aud : contexte de Participation (null si absent)
 *  - world.down(true) simule une panne de Participation (les appels lèvent) ; world.hang(true) : ne répond jamais
 */
export function world({ audience = true, pollsSettings = {}, audSettings = {}, locale = "fr" } = {}) {
  const state = { down: false, hang: false, calls: [] };
  const pollsServices = {};
  const audServices = {};
  const polls = fakeCtx({ moduleId: "polls", key: `polls${++n}`, name: "Sondages", basePath: "polls", locale, messages: locale === "fr" ? pollsFr : pollsEn, settings: pollsSettings, services: pollsServices });
  polls.api.store = pollsStore();
  polls.can = () => true;
  let aud = null;
  if (audience) {
    aud = audienceCtx({ settings: audSettings, locale, services: audServices });
    // Sondages appelle Participation
    const wrap = (method) => async (args) => {
      state.calls.push([method, args]);
      if (state.hang) return new Promise(() => {});
      if (state.down) throw new Error("down");
      return audienceDef.services["audience.session"][method](aud, args);
    };
    pollsServices["audience.session"] = Object.fromEntries(Object.keys(audienceDef.services["audience.session"]).map((m) => [m, wrap(m)]));
    // Participation appelle Sondages (télécommande, tick)
    audServices["audience.remote"] = Object.fromEntries(Object.keys(pollsDef.services["audience.remote"]).map((m) => [m, async (args) => pollsDef.services["audience.remote"][m](polls, args)]));
  }
  return { polls, aud, state, down: (v = true) => { state.down = v; }, hang: (v = true) => { state.hang = v; } };
}

export const post = (url, body, ip = "9.9.9.9") => new Request(url, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "x-forwarded-for": ip, "content-type": "application/json" } });
export const get = (url, ip = "9.9.9.9") => new Request(url, { headers: { "x-forwarded-for": ip } });
export const tok = (i = 0) => `tok${String(i).padStart(5, "0")}${"x".repeat(20)}`;
