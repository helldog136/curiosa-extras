// Le faux monde du Bot Twitch pour les tests des timers, de l'import, de la gestion depuis le chat et des variables (copie de celui de twitch-bot.test.mjs).
import fs from "node:fs";
import { fakeCtx } from "./fakeCtx.mjs";

const DIR = new URL("../../modules/twitch-bot", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
export const fr = readJson("locales/fr.json"), en = readJson("locales/en.json");
export const es = await import("../../modules/twitch-bot/eventsub.mjs");
export const S = await import("../../modules/twitch-bot/state.mjs");
export const SRC = await import("../../modules/twitch-bot/sources.mjs");
export const E = await import("../../modules/twitch-bot/engine.mjs");
export const C = await import("../../modules/twitch-bot/commands.mjs");

export const NOW = Date.parse("2026-10-14T20:00:00Z");
export const CHAT = es.SCOPES.own;

/* ───────────── Le faux monde ───────────── */

/** Un site avec Chaîne Twitch (chaîne « emma », connectée), et, selon les options, Planning, Sponsors, des réseaux. */
export function world(o = {}) {
  S.resetMemory(); SRC.resetSources();
  const tw = {
    mainStatus: "ok", mainScopes: [...CHAT], botStatus: "none", botScopes: [], ready: true, subs: [], chat: [], calls: [], wants: [], chatReply: null, listDown: false, createStatus: 202,
    live: { channel: "emma", configured: true, known: true, live: true, title: "Soirée détente", game: "Zelda", startedAt: new Date(NOW - 95 * 60_000).toISOString() },
    ...o.tw,
  };
  const instances = [
    ...(o.sponsors ? [{ key: "sponsors", module: "sponsors", basePath: "sponsors", name: "Sponsors" }] : []),
    ...(o.planning ? [{ key: "planning", module: "planning", basePath: "planning", name: "Planning" }] : []),
    ...(o.instances ?? []),
  ];
  const settings = { onlyWhenLive: true, timezone: "Europe/Paris", ...o.settings };
  const topics = {
    "social.stat": o.followers === undefined ? [{ id: "twitch-channel:emma:followers", platform: "twitch", account: "emma", metric: "followers", value: 1234 }] : o.followers === null ? [] : [{ id: "x", platform: "twitch", account: "emma", metric: "followers", value: o.followers }],
    "planning.slot": o.slots ?? [],
    "social.link": o.links ?? [],
  };
  const ctx = fakeCtx({
    key: "bot", moduleId: "twitch-bot", locale: "fr", defaultLocale: "fr", locales: ["fr", "en"], messages: o.locale === "en" ? en : fr, settings, siteUrl: o.siteUrl ?? "https://site.example.org", topics, instances,
    can: o.can,
    services: o.draw ? { "audience.draw": o.draw } : {},
    serviceInstances: {
      "twitch.api": [{ instance: "emma", name: "emma", methods: {
        account: (a) => {
          if (a?.channel && a.channel !== "emma") return { ok: false, error: "other_channel" };
          const bot = a?.slot === "bot";
          return { ok: true, channel: "emma", ready: tw.ready, https: true, status: bot ? tw.botStatus : tw.mainStatus, login: bot ? "monbot" : "emma", userId: bot ? "555" : "100", scopes: bot ? tw.botScopes : tw.mainScopes, wanted: [], adminPath: "/admin/instances/tw1", ...(o.result && !bot ? { result: o.result } : {}) };
        },
        wantScopes: (a) => { tw.wants.push(a); return { ok: true }; },
        connectLink: (a) => ({ ok: true, url: a.slot === "bot" ? "https://id.twitch.tv/oauth2/authorize?bot=1" : "https://id.twitch.tv/oauth2/authorize?main=1" }),
        disconnect: () => ({ ok: true, reached: true }),
        request: (a) => {
          if (a.channel && a.channel !== "emma") return { ok: false, error: "other_channel" };
          tw.calls.push(a);
          if (a.path === "eventsub/subscriptions") {
            if (a.method === "GET") return tw.listDown ? { ok: false, error: "network" } : { ok: true, status: 200, json: { data: tw.subs } };
            if (a.method === "DELETE") { tw.subs = tw.subs.filter((s) => s.id !== a.query.id[0] && s.id !== a.query.id); return { ok: true, status: 204, json: null }; }
            if (a.method === "POST") {
              if (tw.createStatus !== 202) return { ok: true, status: tw.createStatus, json: { message: "nope" } };
              const sub = { id: `sub${(tw.seq = (tw.seq ?? 0) + 1)}`, status: "webhook_callback_verification_pending", type: a.body.type, condition: a.body.condition, transport: { method: "webhook", callback: a.body.transport.callback } };
              tw.subs.push(sub); tw.lastSecret = a.body.transport.secret; tw.lastCreate = a.body;
              return { ok: true, status: 202, json: { data: [sub] } };
            }
          }
          if (a.path === "chat/messages") {
            if (tw.chatReply) return tw.chatReply;
            tw.chat.push({ ...a.body, slot: a.slot });
            return { ok: true, status: 200, json: { data: [{ message_id: `out${tw.chat.length}`, is_sent: true }] } };
          }
          return { ok: false, error: "forbidden" };
        },
      } }],
      "twitch.live": [{ instance: "emma", name: "emma", methods: { status: () => tw.live } }],
    },
  });
  ctx.can = () => o.can !== false;
  const by = { sponsors: o.sponsors ?? [] };
  ctx.api.instances.list = async (q) => instances.filter((i) => !q?.module || i.module === q.module);
  ctx.api.entries.list = async (q) => by[q?.instance] ?? [];
  return { ctx, tw };
}
export const entry = (id, slug, title) => ({ id, slug, title, path: `/sponsors/${slug}`, summary: "", url: null });
export const link = (instance, module, label, url) => ({ label, url, icon: module, source: { instance, module, name: label } });
export const chat = (text, over = {}) => ({ messageId: `m${Math.random().toString(36).slice(2)}`, broadcasterId: "100", chatterId: "200", login: "viewer", name: "Viewer", text, kind: "text", foreign: false, badges: [], ...over });
export const say = (ctx, text, over = {}, now = NOW) => E.processChat(ctx, chat(text, over), { now });
export const sent = (tw) => tw.chat.map((m) => m.message);
export const logOf = async (ctx) => (await S.readLog(ctx));
