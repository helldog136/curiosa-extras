// Chaîne YouTube 1.3 : les vidéos et directs PROGRAMMÉS, donnés aux modules qui annoncent des événements (service `event.source`, méthode `upcoming`).
// Le VRAI Connecteur YouTube branché sur un faux YouTube ; le contrat est vérifié avec le lecteur de Story d'annonce.
// Ce que YouTube permet : avec la clé du site on ne voit QUE les directs et premières publics ; une vidéo privée programmée est invisible, et l'interface le dit.
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { makeConnector, connectorApi, yt } from "./helpers/fakeYoutube.mjs";
import { parseManifest } from "@/core/modules/manifest";

const kit = await import(pathToFileURL(path.join(process.env.CURIOSA_DIR ?? process.cwd(), "testsupport/index.mjs")).href);
const { fakeFetch, netReplies } = kit;
const DIR = new URL("../modules/youtube-channel", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
const manifestJson = readJson("module.json"), fr = readJson("locales/fr.json"), en = readJson("locales/en.json");
const mod = await import("../modules/youtube-channel/index.mjs");
const events = await import("../modules/youtube-channel/events.mjs");
const story = await import("../modules/stream-story/events.mjs");
const def = mod.default;
const upcoming = def.services["event.source"].upcoming;
const CH = "UC" + "a".repeat(22), H = 3_600_000, DAY = 86_400_000;
const realFetch = globalThis.fetch;
let f;
const iso = (h) => new Date(Date.now() + h * H).toISOString();
beforeEach(() => { mod.resetCache(); connectorApi.resetState(); });
afterEach(() => { globalThis.fetch = realFetch; });

const video = (id, { state = "upcoming", at = 5, duration = "PT0S", title = `Vidéo ${id}` } = {}) => ({
  id, snippet: { title, liveBroadcastContent: state }, contentDetails: { duration },
  ...(at === null ? {} : { liveStreamingDetails: { scheduledStartTime: iso(at) } }),
});
const ID = (n) => `vid${String(n).padStart(8, "0")}`;
/** Faux YouTube : la chaîne, ses envois (les vidéos PRIVÉES n'y figurent pas) et le détail des vidéos demandées. */
function serve(videos, { onVideos, fail } = {}) {
  f = fakeFetch({ "*": (url) => {
    const u = new URL(url);
    if (fail) return fail(url);
    if (u.pathname.endsWith("/channels")) return { json: yt.list([yt.channel(CH, { uploads: "UUaaaaaaaaaaaaaaaaaaaaaa" })]) };
    if (u.pathname.endsWith("/playlistItems")) return { json: yt.list(videos.map((v) => ({ snippet: { resourceId: { videoId: v.id }, title: v.snippet.title, publishedAt: iso(-1) } }))) };
    if (u.pathname.endsWith("/videos")) { onVideos?.(u); const wanted = u.searchParams.get("id").split(","); return { json: yt.list(videos.filter((v) => wanted.includes(v.id))) }; }
    return { status: 404, json: {} };
  } });
  globalThis.fetch = f;
  return f;
}
const ctx = (settings = {}, opts = {}) => fakeCtx({ key: "yt", moduleId: "youtube-channel", locale: "fr", messages: fr, settings: { channelId: CH, ...settings }, ...opts });
const withApi = (settings, opts) => ctx(settings, { services: makeConnector().services, ...opts });

test("manifeste : la source d'événements est offerte (une réponse par chaîne), version mineure, rien de nouveau n'est exigé, parité fr/en", () => {
  const r = parseManifest(manifestJson); assert.ok(r.ok, r.ok ? "" : r.error);
  const offer = manifestJson.offers.find((o) => o.service === "event.source");
  assert.deepEqual([offer.version, offer.each, offer.readOnly], [1, true, ["upcoming"]]);
  assert.equal(manifestJson.version, "1.3.0");
  assert.deepEqual(manifestJson.requires.map((x) => [x.service, x.min, x.optional]), [["youtube.api", 1, true]], "le service youtube.api reste un besoin FACULTATIF");
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  const words = Object.entries(fr).filter(([k]) => k.startsWith("events_")).map(([, v]) => v).join(" ") + Object.entries(en).filter(([k]) => k.startsWith("events_")).map(([, v]) => v).join(" ");
  assert.ok(!/\b(api|json|token|payload|endpoint|slug)\b/i.test(words), "pas de jargon dans les phrases pour la personne");
  assert.match(fr.events_note, /privée/); assert.match(en.events_note, /private/i);
});

test("les directs et premières PUBLICS programmés deviennent des événements du contrat commun ; le reste est écarté", () => {
  const now = Date.now();
  const items = [
    video(ID(1), { at: 30, duration: "PT0S", title: "Direct anniversaire" }), video(ID(2), { at: 5, duration: "PT12M3S", title: "Première du clip" }), video(ID(3), { at: 50, duration: "P0D" }),
    video(ID(4), { state: "none", at: null }), video(ID(5), { state: "live", at: -1 }), video(ID(6), { at: null }), video(ID(7), { at: -9 }), video(ID(8), { at: 24 * 400 }), video(ID(9), { at: -1, title: "En retard" }),
    { id: "mauvais", snippet: { liveBroadcastContent: "upcoming" }, liveStreamingDetails: { scheduledStartTime: iso(3) } }, { id: ID(10), snippet: { liveBroadcastContent: "upcoming" }, liveStreamingDetails: { scheduledStartTime: "demain" } }, null, "x",
  ];
  const out = events.scheduledEvents(items, now);
  assert.deepEqual(out.map((e) => e.id), [`youtube:${ID(9)}`, `youtube:${ID(2)}`, `youtube:${ID(1)}`, `youtube:${ID(3)}`], "annoncées seulement, triées ; un direct en retard (moins de 3 h) reste annoncé");
  assert.deepEqual(out.map((e) => e.type), ["live", "premiere", "live", "live"], "sans durée : un direct ; avec une durée : une première");
  const first = out.find((e) => e.id.endsWith(ID(2)));
  assert.equal(first.url, `https://www.youtube.com/watch?v=${ID(2)}`); assert.equal(first.image, `https://i.ytimg.com/vi/${ID(2)}/hqdefault.jpg`); assert.equal(first.timezone, "");
  const source = { kind: "youtube", label: "YouTube" };
  assert.ok(out.every((e) => story.cleanEvent(e, source)), "chaque événement est accepté par le lecteur de Story");
  assert.ok(out.every((e) => e.id.length <= 100 && /^[A-Za-z0-9:_.-]+$/.test(e.id)));
  assert.equal(events.scheduledEvents(Array.from({ length: 300 }, (_, i) => video(ID(i + 100), { at: 1 + i / 10 })), now).length, 50, "50 au plus");
  assert.deepEqual(events.scheduledEvents("rien", now), []);
});

test("de bout en bout : le service rend les événements d'une chaîne ; trois appels (3 unités), l'état « ok » et la note honnête sur les vidéos privées", async () => {
  const seen = [];
  serve([video(ID(1), { at: 20, title: "Direct du soir" }), video(ID(2), { at: 70, duration: "PT8M", title: "Première" }), video(ID(3), { state: "none", at: null, title: "Déjà publiée" })], { onVideos: (u) => seen.push(u.searchParams.get("part")) });
  const c = makeConnector(), me = ctx({}, { services: c.services });
  const r = await upcoming(me, { limit: 50 });
  assert.deepEqual([r.ok, r.state, r.source], [true, "ok", { kind: "youtube", label: "YouTube" }]);
  assert.deepEqual(r.events.map((e) => [e.title, e.type]), [["Direct du soir", "live"], ["Première", "premiere"]]);
  assert.equal(r.note, fr.events_note, "la note dit que seules les vidéos publiques sont visibles");
  assert.deepEqual(seen, ["contentDetails,liveStreamingDetails,snippet"], "le détail demande bien le début programmé");
  assert.equal((await c.methods.status()).quota.used, 3, "trois unités de quota, pas plus");
  assert.equal(f.calls.filter((x) => x.url.includes("/search")).length, 0, "jamais la recherche (100 unités)");
  assert.ok(!JSON.stringify(me.calls).includes("FAKE-YT-KEY"), "le module ne voit jamais la clé");
  await upcoming(me, {}); assert.equal((await c.methods.status()).quota.used, 3, "gardé 10 minutes : aucun nouvel appel");
  assert.equal((await upcoming(withApi({}, { locale: "en", messages: en }), {})).note, en.events_note);
});

test("YouTube sans date programmée : « ok », zéro événement, la note ; jamais d'événement inventé", async () => {
  serve([video(ID(1), { state: "none", at: null }), video(ID(2), { state: "upcoming", at: null }), video(ID(3), { state: "upcoming", at: null })]);
  const r = await upcoming(withApi(), {});
  assert.deepEqual([r.state, r.events, r.note], ["ok", [], fr.events_note]);
  serve([]);
  mod.resetCache(); connectorApi.resetState();
  const none = await upcoming(withApi(), {});
  assert.deepEqual([none.state, none.events], ["ok", []]);
});

test("à régler, en mots simples : pas de chaîne, pas de connecteur, pas de clé, clé refusée, connecteur trop ancien", async () => {
  serve([]);
  assert.deepEqual(await upcoming(ctx({ channelId: "" }, { services: makeConnector().services }), {}), { ok: true, source: { kind: "youtube", label: "YouTube" }, state: "setup", message: fr.events_setup_channel, events: [] });
  assert.equal((await upcoming(ctx({ channelId: "pas-un-id" }), {})).message, fr.events_setup_channel);
  assert.equal((await upcoming(ctx(), {})).message, fr.events_setup_connector, "sans connecteur");
  mod.resetCache(); connectorApi.resetState();
  assert.equal((await upcoming(ctx({}, { services: makeConnector({ key: "nokey", apiKey: null }).services }), {})).message, fr.events_setup_key, "connecteur sans clé");
  mod.resetCache(); connectorApi.resetState();
  serve([], { fail: () => ({ status: 400, json: yt.keyInvalid() }) });
  assert.equal((await upcoming(withApi(), {})).message, fr.events_setup_refused, "clé refusée");
  mod.resetCache(); connectorApi.resetState();
  serve([], { fail: () => ({ status: 400, json: { error: { code: 400, message: "Bad part", errors: [{ reason: "badRequest" }] } } }) });
  assert.equal((await upcoming(withApi(), {})).message, fr.events_setup_update, "connecteur qui refuse la demande : mise à jour");
  const en1 = await upcoming(ctx({ channelId: "" }, { locale: "en", messages: en }), {});
  assert.equal(en1.message, en.events_setup_channel);
});

test("panne de YouTube : « down » sans rien inventer (limite du jour, réseau coupé, réponse tronquée) ; la dernière liste du connecteur est servie mais dite « ne répond pas »", async () => {
  for (const reply of [netReplies.rateLimited(60), netReplies.quotaExceeded(), netReplies.down(), netReplies.truncatedJson(), netReplies.status(503)]) {
    mod.resetCache(); connectorApi.resetState();
    serve([], { fail: () => reply });
    const r = await upcoming(withApi(), {});
    assert.deepEqual([r.ok, r.state, r.events], [true, "down", []]);
  }
  // limite du jour atteinte avant tout appel : le connecteur refuse sans réseau
  mod.resetCache(); connectorApi.resetState();
  serve([video(ID(1), { at: 6 })]);
  const spent = makeConnector({ rows: { quota: [{ day: connectorApi.pacificDay(), used: 9000 }] } });
  const exhausted = await upcoming(ctx({}, { services: spent.services }), {});
  assert.deepEqual([exhausted.state, exhausted.events], ["down", []]); assert.equal(f.calls.length, 0, "aucun appel n'est parti");
});

test("réponse de repli du connecteur (dernière lecture connue) : les événements sont gardés mais la source est dite « en panne » ; un échec à chaque étape est une panne ou un réglage, jamais une exception", async () => {
  const good = { ok: true, status: 200, json: yt.list([video(ID(1), { at: 4, title: "Direct" })]) };
  const call = (stale, failAt, error) => async (method, a) => {
    if (a.endpoint === failAt) return { ok: false, error };
    const body = a.endpoint === "channels.list" ? { ...good, json: yt.list([yt.channel(CH, { uploads: "UUaaaaaaaaaaaaaaaaaaaaaa" })]) } : a.endpoint === "playlistItems.list" ? { ...good, json: yt.list([{ snippet: { resourceId: { videoId: ID(1) } } }]) } : good;
    return stale ? { ...body, stale: true, error: "quota" } : body;
  };
  events.resetEvents();
  const s = await events.upcomingAnswer({ call: call(true), channelId: CH, t: (k) => fr[k] });
  assert.deepEqual([s.state, s.events.length], ["down", 1]);
  for (const stage of ["channels.list", "playlistItems.list", "videos.list"]) {
    for (const [error, state] of [["unavailable", "setup"], ["config", "setup"], ["auth", "setup"], ["invalid", "setup"], ["quota", "down"], ["rate", "down"], ["timeout", "down"], ["network", "down"], [undefined, "down"]]) {
      events.resetEvents();
      const r = await events.upcomingAnswer({ call: call(false, stage, error), channelId: CH, t: (k) => fr[k] });
      assert.deepEqual([r.ok, r.state, r.events.length], [true, state, 0], `${stage} / ${error}`);
      if (state === "setup") assert.ok(r.message && !r.message.startsWith("events_"), "une vraie phrase");
    }
  }
});

test("trou noir : un connecteur qui ne répond jamais ne bloque pas la réponse, qui arrive dans le délai ; la suite repart", async () => {
  const keep = setInterval(() => {}, 100), t0 = { ...mod.timing };
  mod.timing.serviceMs = 150;
  try {
    const never = () => new Promise(() => {});
    const t = Date.now();
    const r = await upcoming(ctx({}, { services: { "youtube.api": { request: never, channels: never, status: never, adopt: never } } }), {});
    assert.ok(Date.now() - t < 2000); assert.deepEqual([r.state, r.events], ["down", []]);
    mod.resetCache(); connectorApi.resetState(); serve([video(ID(1), { at: 4 })]);
    assert.equal((await upcoming(withApi(), {})).events.length, 1);
  } finally { clearInterval(keep); Object.assign(mod.timing, t0); }
});

test("cache de 10 minutes par chaîne, et la limite demandée est respectée", async () => {
  serve(Array.from({ length: 30 }, (_, i) => video(ID(i + 1), { at: 2 + i })));
  const me = withApi();
  assert.equal((await upcoming(me, { limit: 5 })).events.length, 5);
  assert.equal((await upcoming(me, { limit: 99999 })).events.length, 30);
  assert.equal((await upcoming(me, { limit: "x" })).events.length, 30);
  assert.equal(f.calls.filter((x) => x.url.includes("/videos")).length, 1, "une seule lecture pour toutes ces demandes");
  assert.ok(events.TTL === 600_000);
});

test("le Connecteur YouTube laisse passer le début programmé (liveStreamingDetails) et rien d'autre de nouveau", () => {
  const ok = connectorApi.normalize("videos.list", { part: "snippet,contentDetails,liveStreamingDetails", id: [ID(1)] });
  assert.match(ok.url, /part=contentDetails%2CliveStreamingDetails%2Csnippet/);
  assert.equal(connectorApi.normalize("videos.list", { part: "snippet,status", id: [ID(1)] }), null, "« status » (vidéos privées) reste refusé");
  assert.equal(connectorApi.normalize("videos.list", { part: "fileDetails", id: [ID(1)] }), null);
  assert.equal(connectorApi.normalize("search.list", { part: "snippet" }), null, "la recherche (100 unités) reste exclue");
  assert.equal(JSON.parse(fs.readFileSync(new URL("../modules/youtube-connector/module.json", import.meta.url), "utf8")).version, "1.1.0");
});
