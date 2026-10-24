// Un « monde » de test pour Raid Twitch 2.2 : un faux Contacts (le double du contrat), un faux service Twitch (`twitch.api`) qui sait qui est en direct,
// et un contexte de module prêt à l'emploi. Aucun réseau. Les pseudos sont neutres (membre_0001…).
import fs from "node:fs";
import { fakeCtx } from "./fakeCtx.mjs";
import { fakeContactBook } from "./fakeContactBook.mjs";

export const DIR = new URL("../../modules/twitch-raid", import.meta.url).pathname;
export const fr = JSON.parse(fs.readFileSync(`${DIR}/locales/fr.json`, "utf8"));
export const en = JSON.parse(fs.readFileSync(`${DIR}/locales/en.json`, "utf8"));
export const manifest = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8"));

export const login = (i) => `membre_${String(i).padStart(4, "0")}`;
export const logins = (n, from = 0) => Array.from({ length: n }, (_, i) => login(from + i));
export const T0 = Date.parse("2026-10-24T12:00:00Z");

/**
 * Un faux `twitch.api` : `api.streams` = Map pseudo → { name?, game?, title?, viewers?, minutes? (depuis combien de minutes), type?, thumb? } des directs ;
 * `api.fail` : null ou le code d'erreur rendu à chaque demande (« network », « rate »…) ; `api.hang` : les demandes ne reviennent jamais ;
 * `api.calls` : les demandes reçues (taille, pseudos) ; `api.accounts` : ce que répond `account`.
 */
export function fakeTwitchApi(over = {}) {
  const api = {
    calls: [], streams: new Map(), fail: null, hang: false, delay: 0, now: () => T0, accounts: [{ ok: true, channel: "ma_chaine", ready: true }], ...over,
    methods: {
      account: async () => api.accounts[0],
      request: async (args) => {
        api.calls.push({ size: args.query.user_login.length, logins: args.query.user_login.slice() });
        if (api.hang) return new Promise(() => {});
        if (api.delay) await new Promise((r) => setTimeout(r, api.delay));
        if (api.fail) return { ok: false, error: api.fail };
        const data = args.query.user_login.filter((l) => api.streams.has(l)).map((l, i) => {
          const s = api.streams.get(l);
          return {
            id: `${i}`, user_id: `${i}`, user_login: l, user_name: s.name ?? l.toUpperCase(), game_id: "1", game_name: s.game ?? "Jeu", type: s.type ?? "live", title: s.title ?? `Live de ${l}`,
            viewer_count: s.viewers ?? 10, started_at: new Date(api.now() - (s.minutes ?? 30) * 60_000).toISOString(), language: "fr",
            thumbnail_url: s.thumb === undefined ? `https://static-cdn.jtvnw.net/previews-ttv/live_user_${l}-{width}x{height}.jpg` : s.thumb,
          };
        });
        return { ok: true, status: 200, json: { data } };
      },
    },
  };
  return api;
}

let sites = 0;
/**
 * Un site : `partners` = [pseudo | { login, name?, status?, hidden? (rangé dans « Ne pas montrer »), displayName? }] ;
 * `live` = { pseudo: { viewers, minutes, game, title, thumb } } (les directs) ; `settings` = les réglages de l'instance.
 * Rend { ctx, book, api, cat (catégorie de raid), hideCat (catégorie « Ne pas montrer »), ids: pseudo → id de fiche }.
 */
export function world({ partners = [], live = {}, settings = {}, withHideCategory = true, hideName = "Ne pas montrer", api: apiOver, ...extra } = {}) {
  const book = fakeContactBook();
  const cat = book.seedCategory("Cible de raid");
  const hideCat = withHideCategory ? book.seedCategory(hideName) : null;
  const api = fakeTwitchApi(apiOver);
  for (const [l, s] of Object.entries(live)) api.streams.set(l, s);
  const ids = {};
  for (const p of partners) {
    const o = typeof p === "string" ? { login: p } : p;
    const { id } = book.seedContact({
      name: o.name ?? o.login, status: o.status ?? "active",
      accounts: [{ network: "twitch", handle: o.login, ...(o.displayName ? { displayName: o.displayName } : {}) }],
      categoryIds: [cat, ...(o.hidden && hideCat ? [hideCat] : [])],
    });
    ids[o.login] = id;
  }
  const ctx = fakeCtx({
    key: `raid${++sites}`, moduleId: "twitch-raid", locale: "fr", defaultLocale: "fr", locales: ["fr", "en"], messages: { ...fr }, settings, siteUrl: "https://site.example.test",
    basePath: "en-direct", permissions: manifest.permissions,
    services: { "contact.book": book.methods },
    serviceInstances: { "twitch.api": [{ instance: "tw", name: "Chaîne Twitch", methods: api.methods }] },
    ...extra,
  });
  return { ctx, book, api, cat, hideCat, ids };
}
