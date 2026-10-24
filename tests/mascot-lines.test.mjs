// Mascotte — ce qu'elle peut dire : événement, direct, nouveautés. Chaque source est facultative : absente, en panne, lente ou illisible, la phrase n'existe pas, sans erreur.
import test from "node:test";
import assert from "node:assert/strict";
import { ctxFor, model as M, store as S, lines as L, eventSource, inDays } from "./helpers/mascotKit.mjs";

async function setup(phrases, settings = {}, opts = {}) {
  const ctx = ctxFor(settings, opts);
  for (const p of phrases) {
    const checked = M.checkPhrase({ lang: "", ...p }, { locales: ["fr", "en"] });
    assert.ok(checked.value, JSON.stringify(checked.errors));
    await S.addPhrase(ctx, checked.value);
  }
  return ctx;
}
const run = async (ctx, extra = {}) => L.buildLines(ctx, { config: await S.loadConfig(ctx), phrases: await S.loadPhrases(ctx), path: "/", announce: true, name: "Pixel", ...extra });
const texts = (items) => items.map((i) => i.text);
const NEXT = { kind: "news", text: "Prochain : {prochain_evenement}, {date_evenement}." };

test("phrases simples : le nom du site et de la mascotte sont remplis ; les brouillons ne sont pas dits", async () => {
  const ctx = await setup([{ kind: "hello", text: "Salut, ici {nom} sur {nom_du_site}." }, { kind: "tip", text: "Un brouillon.", state: "draft" }]);
  assert.deepEqual(texts(await run(ctx)), ["Salut, ici Pixel sur Demo."]);
});

test("prochain événement : le plus proche, valide ; passé, annulé, sans identifiant sûr, trop lointain, sans fuseau : écartés", async () => {
  const ctx = await setup([NEXT], {}, { services: eventSource([
    { id: "a:1", title: "Passé", start: inDays(-2) },
    { id: "a:2", title: "Annulé", start: inDays(1), status: "cancelled" },
    { id: "bad id!", title: "Sans identifiant sûr", start: inDays(1) },
    { id: "a:3", title: "Trop loin", start: inDays(400) },
    { id: "a:4", title: "Plus tard {nom}", start: inDays(9), url: "https://example.org/b" },
    { id: "a:6", title: "Sans fuseau", start: "2026-12-01T10:00:00" },
  ]) });
  const items = await run(ctx);
  assert.equal(items.length, 1);
  assert.match(items[0].text, /^Prochain : Plus tard nom, \{\{t:\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z\}\}\.$/);
  assert.equal(items[0].href, "https://example.org/b");
  assert.equal(items[0].kind, "news");
});

test("journée entière : valable toute la journée, datée sans heure", async () => {
  const day = new Date().toISOString().slice(0, 10);
  const ctx = await setup([NEXT], {}, { services: eventSource([{ id: "a:1", title: "Journée", allDay: true, day, start: `${day}T00:00:00Z` }]) });
  assert.match((await run(ctx))[0].text, new RegExp(`\\{\\{d:${day}\\}\\}`));
});

test("le lien écrit par la personne passe avant celui de l'événement", async () => {
  const ctx = await setup([{ ...NEXT, link: "/agenda" }], {}, { services: eventSource([{ id: "a:1", title: "X", start: inDays(2), url: "https://example.org/e" }]) });
  assert.equal((await run(ctx))[0].href, "/agenda");
});

test("aucune source d'événements : la phrase n'existe pas, les autres restent", async () => {
  const ctx = await setup([NEXT, { kind: "hello", text: "Bonjour." }]);
  assert.deepEqual(texts(await run(ctx)), ["Bonjour."]);
});

test("source en panne, illisible ou vide : pas de phrase, pas d'exception", async () => {
  for (const upcoming of [async () => { throw new Error("boom"); }, async () => "n'importe quoi", async () => ({ ok: true, state: "down", events: [] }), async () => ({ ok: true, events: "pas une liste" }), async () => null, async () => ({ ok: true, events: [null, 3, "x", { id: 5 }] })]) {
    const ctx = await setup([NEXT, { kind: "hello", text: "Bonjour." }], {}, { services: { "event.source": { upcoming } } });
    assert.deepEqual(texts(await run(ctx)), ["Bonjour."]);
  }
});

test("source lente : personne n'attend plus que le délai", async () => {
  const keep = { ...L.timing };
  L.timing.waitMs = 60;
  try {
    const ctx = await setup([NEXT, { kind: "hello", text: "Bonjour." }], {}, { services: { "event.source": { upcoming: () => new Promise(() => {}) } } });
    const t0 = Date.now();
    assert.deepEqual(texts(await run(ctx)), ["Bonjour."]);
    assert.ok(Date.now() - t0 < 1000);
  } finally { Object.assign(L.timing, keep); }
});

test("plusieurs sources d'événements : la plus proche de toutes gagne", async () => {
  const ctx = await setup([NEXT], {}, { serviceInstances: { "event.source": [
    { instance: "a", methods: { upcoming: async () => ({ ok: true, events: [{ id: "a:1", title: "Lointain", start: inDays(20) }] }) } },
    { instance: "b", methods: { upcoming: async () => ({ ok: true, events: [{ id: "b:1", title: "Proche", start: inDays(2) }] }) } },
    { instance: "c", methods: { upcoming: async () => { throw new Error("panne"); } } },
  ] } });
  assert.match((await run(ctx))[0].text, /Proche/);
});

test("une source n'est interrogée que si une phrase de CETTE page l'emploie, et une seule fois dans le délai de garde", async () => {
  const ctx = await setup([{ kind: "hello", text: "Bonjour." }, { ...NEXT, pages: "/agenda" }], {}, { services: eventSource([{ id: "a:1", title: "X", start: inDays(3) }]) });
  await run(ctx, { path: "/" });
  assert.equal(ctx.calls.services.length, 0);
  await run(ctx, { path: "/agenda" });
  await run(ctx, { path: "/agenda" });
  assert.equal(ctx.calls.services.filter(([n]) => n === "event.source").length, 1);
});

test("après un échec, la dernière bonne réponse est gardée ; la source n'est pas martelée", async () => {
  const keep = { ...L.timing };
  let calls = 0, fail = false;
  const ctx = await setup([NEXT], {}, { services: { "event.source": { upcoming: async () => { calls++; if (fail) throw new Error("panne"); return { ok: true, events: [{ id: "a:1", title: "Garde", start: inDays(3) }] }; } } } });
  try {
    L.timing.keepMs = 1;
    assert.match((await run(ctx))[0].text, /Garde/);
    await new Promise((r) => setTimeout(r, 10));
    fail = true;
    assert.match((await run(ctx))[0].text, /Garde/);
    const before = calls;
    await run(ctx); await run(ctx);
    assert.equal(calls, before);
  } finally { Object.assign(L.timing, keep); }
});

const LIVE = { kind: "news", text: "{en_direct} est en direct : {titre_direct}" };
test("direct en cours : Twitch et YouTube ; hors ligne, en panne ou absents : pas de phrase", async () => {
  const twitch = { "twitch.live": { status: async () => ({ configured: true, known: true, live: true, channel: "ma_chaine", displayName: "Ma Chaîne", title: "Soirée {jeu}" }) } };
  const youtube = { "youtube.live": { current: async () => ({ ok: true, live: true, videoId: "abcdefghijk", title: "Direct YT" }) } };
  let ctx = await setup([LIVE], {}, { services: { ...twitch } });
  let items = await run(ctx);
  assert.equal(items[0].text, "Ma Chaîne est en direct : Soirée jeu");
  assert.equal(items[0].href, "https://www.twitch.tv/ma_chaine");
  ctx = await setup([LIVE], {}, { services: { ...youtube } });
  items = await run(ctx);
  assert.equal(items[0].text, "YouTube est en direct : Direct YT");
  assert.equal(items[0].href, "https://www.youtube.com/watch?v=abcdefghijk");
  ctx = await setup([LIVE], {}, { services: { ...twitch, ...youtube } });
  assert.match((await run(ctx))[0].text, /^Ma Chaîne et YouTube est en direct/);
  for (const services of [{}, { "twitch.live": { status: async () => ({ live: false, known: true, channel: "ma_chaine" }) } }, { "twitch.live": { status: async () => { throw new Error("x"); } } }, { "twitch.live": { status: async () => ({ live: true, channel: "../évasion" }) } }, { "youtube.live": { current: async () => ({ ok: true, live: true, videoId: "pas valide!" }) } }, { "youtube.live": { current: async () => ({ ok: false, error: "quota" }) } }]) {
    ctx = await setup([LIVE, { kind: "hello", text: "Bonjour." }], {}, { services });
    assert.deepEqual(texts(await run(ctx)), ["Bonjour."]);
  }
});

test("direct et nouveautés lents : la phrase manque simplement", async () => {
  const keep = { ...L.timing };
  L.timing.waitMs = 60;
  try {
    const never = () => new Promise(() => {});
    const ctx = await setup([LIVE, { kind: "hello", text: "Bonjour." }], {}, { services: { "twitch.live": { status: never }, "youtube.live": { current: never } }, topics: { "mascot.hint": never } });
    assert.deepEqual(texts(await run(ctx)), ["Bonjour."]);
  } finally { Object.assign(L.timing, keep); }
});

test("direct : réponses piégées (titres énormes, accolades) ne laissent rien passer", async () => {
  const services = { "twitch.live": { status: async () => ({ live: true, channel: "ok_chaine", displayName: `{nom}${"x".repeat(500)}`, title: `{{t:2026-01-01T00:00:00Z}}${"y".repeat(500)}` }) }, "youtube.live": { current: async () => [1, 2, 3] } };
  const ctx = await setup([LIVE], {}, { services });
  const [item] = await run(ctx);
  assert.ok(item.text.length <= M.LIMITS.line);
  assert.ok(!item.text.includes("{{t:"));
  assert.ok(!/\{nom\}/.test(item.text));
});

test("nouveautés confiées par d'autres modules : nettoyées, bornées, liens vérifiés ; coupées par le réglage ; sujet en panne sans effet", async () => {
  const topics = { "mascot.hint": [
    { id: "daily", text: "Le jeu du jour est prêt !", url: "/jeu" },
    { id: "evil", text: "Lien piégé", url: "javascript:alert(1)" },
    { id: "bad id", text: "Mauvais identifiant" }, { id: "empty", text: "   " }, { id: "long", text: "x".repeat(500) }, null, "texte", 3,
  ] };
  const ctx = await setup([{ kind: "hello", text: "Bonjour." }], {}, { topics });
  const hints = (await run(ctx)).filter((i) => i.id.startsWith("h"));
  assert.equal(hints.length, 3);
  assert.equal(hints[0].href, "/jeu");
  assert.equal(hints[1].href, undefined);
  assert.ok(hints[2].text.length <= M.LIMITS.text);
  assert.deepEqual(texts(await run(ctx, { announce: false })), ["Bonjour."]);
  const broken = await setup([{ kind: "hello", text: "Bonjour." }], {}, { topics: { "mascot.hint": async () => { throw new Error("boom"); } } });
  assert.deepEqual(texts(await run(broken)), ["Bonjour."]);
});

const FRESH = { kind: "news", text: "Nouveau : {derniere_nouveaute}" };
test("dernière nouveauté (flux du site) : la plus récente de moins de 3 semaines ; vieille, future, sans date ou au lien dangereux : écartée", async () => {
  const feed = [
    { title: "Trop vieille", url: "/blog/vieille", publishedAt: inDays(-40) }, { title: "Dans le futur", url: "/blog/futur", publishedAt: inDays(5) },
    { title: "Sans date", url: "/blog/sans-date" }, { title: "Lien piégé", url: "javascript:alert(1)", publishedAt: inDays(-1) },
    { title: "Hier {nom}", url: "/blog/hier", publishedAt: inDays(-1) }, { title: "Il y a une semaine", url: "https://example.org/semaine", publishedAt: inDays(-7) }, null, "x", 4,
  ];
  const ctx = await setup([FRESH], {}, { topics: { "feed.item": feed } });
  const items = await run(ctx);
  assert.equal(items.length, 1);
  assert.equal(items[0].text, "Nouveau : Hier nom");
  assert.equal(items[0].href, "/blog/hier");
  assert.match(items[0].id, /:n[0-9a-f]{8}$/);
  for (const topics of [{}, { "feed.item": [] }, { "feed.item": async () => { throw new Error("x"); } }]) {
    const other = await setup([FRESH, { kind: "hello", text: "Bonjour." }], {}, { topics });
    assert.deepEqual(texts(await run(other)), ["Bonjour."]);
  }
});

test("le flux n'est lu que si une phrase de la page parle de la dernière nouveauté", async () => {
  const ctx = await setup([{ kind: "hello", text: "Bonjour." }], {}, { topics: { "feed.item": [{ title: "X", url: "/x", publishedAt: inDays(-1) }] } });
  await run(ctx, { announce: false });
  assert.equal(ctx.calls.topics.length, 0);
});

test("langues : celle du visiteur, « toutes langues », sinon la langue par défaut du site", async () => {
  const phrases = [{ kind: "hello", lang: "fr", text: "Bonjour." }, { kind: "hello", lang: "en", text: "Hello." }, { kind: "tip", lang: "", text: "Astuce / tip." }];
  assert.deepEqual(texts(await run(await setup(phrases, {}, { locale: "en" }))).sort(), ["Astuce / tip.", "Hello."]);
  assert.deepEqual(texts(await run(await setup(phrases, {}, { locale: "fr" }))).sort(), ["Astuce / tip.", "Bonjour."]);
  assert.deepEqual(texts(await run(await setup([{ kind: "hello", lang: "fr", text: "Bonjour." }], {}, { locale: "en" }))), ["Bonjour."]);
});

test("pages : une phrase réservée à /agenda n'est pas dite ailleurs ; /blog/* couvre le blog et dessous", async () => {
  const ctx = await setup([{ kind: "tip", text: "Agenda seulement.", pages: "/agenda" }, { kind: "tip", text: "Blog.", pages: "/blog/*" }, { kind: "tip", text: "Partout." }]);
  assert.deepEqual(texts(await run(ctx, { path: "/" })), ["Partout."]);
  assert.deepEqual(texts(await run(ctx, { path: "/agenda" })).sort(), ["Agenda seulement.", "Partout."]);
  assert.deepEqual(texts(await run(ctx, { path: "/blog/article" })).sort(), ["Blog.", "Partout."]);
});

test("l'identifiant d'une phrase change avec son sujet", async () => {
  let title = "Premier";
  const ctx = await setup([NEXT], {}, { services: { "event.source": { upcoming: async () => ({ ok: true, events: [{ id: `a:${title}`, title, start: inDays(2) }] }) } } });
  const keep = { ...L.timing };
  try {
    L.timing.keepMs = 1;
    const first = (await run(ctx))[0].id;
    title = "Second";
    await new Promise((r) => setTimeout(r, 10));
    const second = (await run(ctx))[0].id;
    assert.notEqual(first, second);
    assert.ok(first.length < 100 && /^[A-Za-z0-9:_.-]+$/.test(first));
  } finally { Object.assign(L.timing, keep); }
});

test("bornes : jamais plus de 30 lignes, texte de chaque ligne borné", async () => {
  const ctx = await setup(Array.from({ length: 60 }, (_, i) => ({ kind: "tip", text: `Phrase numéro ${i}.` })));
  const items = await run(ctx);
  assert.ok(items.length <= M.LIMITS.items && items.every((i) => i.text.length <= M.LIMITS.line));
});
