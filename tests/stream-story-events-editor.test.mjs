// « Pour quoi veux-tu une story ? » dans l'éditeur de Story d'annonce, exécuté pour de vrai (app.mjs) dans un faux navigateur minimal et branché sur les vraies routes du module :
// la liste de toutes les sources, la pastille de chacune, les dates dans le fuseau du site, la recherche, le filtre, « voir plus », un clic qui choisit l'événement, une source en panne
// (message poli sous la liste), le repli quand rien ne répond, la préparation d'un assistant qui retrouve son événement. Aucun réseau ; le rendu réel reste à voir dans un navigateur.
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { fakeCanvasContext } from "./helpers/fakeCanvas.mjs";

const DIR = new URL("../modules/stream-story", import.meta.url).pathname;
const manifest = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8")), fr = JSON.parse(fs.readFileSync(`${DIR}/locales/fr.json`, "utf8")), en = JSON.parse(fs.readFileSync(`${DIR}/locales/en.json`, "utf8"));
const def = (await import("../modules/stream-story/index.mjs")).default;
const data = await import("../modules/stream-story/data.mjs");
const src = await import("../modules/stream-story/sources.mjs");
const P = await import("../modules/stream-story/pure.mjs");

const SITE = "https://site.example.test", H = 3_600_000;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (h) => new Date(Date.now() + h * H).toISOString();
const YT = { kind: "youtube", label: "YouTube" }, TW = { kind: "twitch", label: "Twitch" };

class Text { constructor(t) { this.nodeType = 3; this.textContent = String(t); } }
class El {
  constructor(tag) { this.nodeType = 1; this.tagName = tag; this.children = []; this.attrs = {}; this.listeners = {}; this._text = ""; this.hidden = false; this.value = ""; this.checked = false; this.disabled = false; this.className = ""; this.dataset = {}; this.style = {}; this.open = false; this.ctx = null; }
  get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join("") : this._text; }
  set textContent(v) { this.children = []; this._text = String(v); }
  append(...kids) { for (const k of kids) this.children.push(k); }
  replaceChildren(...kids) { this.children = []; this._text = ""; this.append(...kids); }
  setAttribute(k, v) { this.attrs[k] = v; if (k === "id") this.id = v; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  fire(type, ev = {}) { for (const fn of this.listeners[type] ?? []) fn({ key: "", preventDefault() {}, target: this, ...ev }); }
  click() { if (!this.isDisabled) this.fire("click"); }
  get isDisabled() { return this.disabled || "disabled" in this.attrs; }
  focus() {}
  getContext() { return (this.ctx ??= fakeCanvasContext()); }
  querySelectorAll() { return []; }
}
const walk = (el, out = []) => { out.push(el); for (const c of el.children ?? []) if (c.nodeType === 1) walk(c, out); return out; };
const buttons = (root) => walk(root).filter((e) => e.tagName === "button");
const rowsOf = (list) => list.children.filter((c) => c.tagName === "li").map((li) => buttons(li)[0]);

function installDom(html, hash) {
  const els = new Map();
  for (const m of html.matchAll(/<(\w+)([^>]*?)>/g)) {
    const id = /\sid="([^"]+)"/.exec(m[2])?.[1];
    if (!id || els.has(id)) continue;
    const el = new El(m[1]); el.id = id; el.hidden = /(^|\s)hidden(\s|=|$)/.test(m[2]);
    els.set(id, el);
  }
  els.get("story-config").textContent = /<script type="application\/json" id="story-config">(.*?)<\/script>/s.exec(html)[1];
  const body = new El("body"); body.classList = { toggle() {} };
  const document = { getElementById: (id) => els.get(id) ?? null, createElement: (t) => new El(t), createTextNode: (t) => new Text(t), querySelectorAll: () => [], body };
  Object.assign(globalThis, {
    document, Image: class { set src(v) { this._src = v; setTimeout(() => this.onload?.(), 0); } get src() { return this._src; } width = 100; height = 100; naturalWidth = 100; naturalHeight = 100; },
    location: { hash, pathname: "/m/story/studio", search: "" }, history: { replaceState() {} }, matchMedia: () => ({ matches: true }), requestAnimationFrame: () => 0,
  });
  return els;
}
function installServer(ctx) {
  const log = [], realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input), SITE);
    if (url.origin !== SITE) return new Response(null, { status: 404 });
    const route = url.pathname.replace(/^\/m\/story\//, "");
    log.push([init.method ?? "GET", route + url.search]);
    return def.routes[route](new Request(url, { method: init.method ?? "GET", headers: init.headers, body: init.body }), ctx);
  };
  return { log, restore: () => { globalThis.fetch = realFetch; } };
}
let n = 0;
async function boot(ctx, { prep } = {}) {
  const token = await data.mintToken(ctx);
  const html = await (await def.routes.studio(new Request(`${SITE}/m/story/studio`), ctx)).text();
  const server = installServer(ctx), els = installDom(html, `#t=${token}${prep ? `&p=${prep}` : ""}`);
  await import(`../modules/stream-story/app.mjs?events-${++n}`);
  await wait(700);
  return { els, server, html };
}

const slot = (i, h, extra = {}) => ({ id: `s${i}`, title: `Stream ${i}`, start: iso(h), end: iso(h + 1), allDay: false, games: [], status: "confirmed", timezone: "Europe/Paris", ...extra });
const ytOk = (events, note = "Seuls les directs et premières publics sont visibles.") => () => ({ ok: true, source: YT, state: "ok", note, events });
const twOk = (events) => () => ({ ok: true, source: TW, state: "ok", events });
const mk = ({ calendar = [], yt, tw, locale = "fr", settings = {} } = {}) => (src.resetEvents(), fakeCtx({
  key: "story", moduleId: "stream-story", locale, messages: { ...(locale === "en" ? en : fr) }, permissions: manifest.permissions, siteUrl: SITE, settings: { timezone: "Europe/Paris", ...settings },
  topics: { "planning.slot": () => calendar },
  serviceInstances: { "event.source": [...(yt ? [{ instance: "yt", name: "Ma chaîne", methods: { upcoming: yt } }] : []), ...(tw ? [{ instance: "tw", name: "Mon Twitch", methods: { upcoming: tw } }] : [])] },
  instances: [{ id: "id-story", key: "story", module: "stream-story", basePath: "", name: "Story", adminPath: "/admin/instances/id-story" }],
}));
const drawn = (els) => els.get("preview").getContext().log.filter((l) => l[0] === "fillText").map((l) => l[1]);
const type = async (el, value, ms = 600) => { el.value = value; el.fire("input"); await wait(ms); };
let current;
const timing0 = { ...src.timing };
beforeEach(() => { Object.assign(src.timing, timing0, { collectMs: 300, providersMs: 300, sourceMs: 400, eventsMs: 900 }); });
afterEach(() => { current?.server.restore(); current = null; Object.assign(src.timing, timing0); });

test("la liste : toutes les sources, triées, avec la pastille de chacune, la date dans le fuseau du site, la note honnête de YouTube ; le premier événement est déjà choisi", async () => {
  const premiereAt = iso(9); // calculée une seule fois : sinon un changement de minute entre deux appels fausse la comparaison de l'heure
  const ctx = mk({
    calendar: Array.from({ length: 30 }, (_, i) => slot(i, 4 + i * 6, i === 0 ? { games: ["Hades"] } : {})),
    yt: ytOk([{ id: "youtube:v1", title: "Première du clip", start: premiereAt, type: "premiere", url: "https://www.youtube.com/watch?v=v1" }]),
    tw: twOk([{ id: "twitch:me:1", title: "Surprise du vendredi", start: iso(13), type: "stream", games: ["Zelda"] }]),
  });
  const { els, server, html } = current = await boot(ctx);
  assert.match(html, new RegExp(fr.ui_h_event.replace("?", "\\?")), "le titre demandé : « Pour quel événement ? »");
  const rows = rowsOf(els.get("event-list"));
  assert.equal(rows.length, 5, "liste courte : 5 événements d'abord"); assert.equal(els.get("event-picker").hidden, true, "la liste est repliée : le prochain événement est déjà choisi"); assert.equal(els.get("event-search-box").hidden, false, "beaucoup d'événements : la recherche est proposée");
  assert.match(rows[0].textContent, /Planning/); assert.match(rows[0].textContent, /Stream 0/); assert.match(rows[0].textContent, /Choisi/);
  assert.equal(rows[0].attrs["aria-pressed"], "true"); assert.equal(rows[1].attrs["aria-pressed"], "false");
  const titles = rows.slice(0, 4).map((r) => /Stream \d+|Première du clip|Surprise du vendredi/.exec(r.textContent)[0]);
  assert.deepEqual(titles, ["Stream 0", "Première du clip", "Stream 1", "Surprise du vendredi"], "triés par date et heure, toutes sources mêlées");
  const yt = rows[1].textContent, start = Date.parse(premiereAt);
  assert.match(yt, /YouTube/); assert.match(yt, /Première/); assert.ok(yt.includes(P.formatTime(start, "Europe/Paris", "fr")), "l'heure est celle du fuseau du site");
  assert.ok(yt.includes(P.formatDay(start, "Europe/Paris", "fr")), "le jour s'écrit en toutes lettres");
  assert.match(els.get("event-chosen").textContent, /Story pour :.*Prochain événement.*Stream 0/);
  assert.match(els.get("event-count").textContent, /5 sur 32 événements/); assert.equal(els.get("event-more").hidden, false);
  const chips = buttons(els.get("event-filter")).map((b) => b.textContent);
  assert.deepEqual(chips, ["Tout", "Planning (30)", "Twitch (1)", "YouTube (1)"]); assert.equal(els.get("event-filter").hidden, false);
  assert.match(els.get("event-sources").textContent, /YouTube : Seuls les directs et premières publics sont visibles/, "ce que YouTube ne montre pas est dit");
  assert.match(els.get("event-sources").textContent, /Les heures sont affichées pour : Europe\/Paris/);
  assert.equal(els.get("manual").hidden, true);
  assert.ok(server.log.some(([, r]) => r === "events?limit=5"));
  assert.ok(!server.log.some(([, r]) => r.startsWith("streams")), "l'ancienne liste de streams n'est plus demandée");
  await wait(300);
  assert.ok(drawn(els).some((t) => /Stream 0/.test(t)), "la vidéo est déjà remplie avec le premier événement");
});

test("un clic sur un événement le choisit : la vidéo se remplit, la jaquette du jeu est demandée pour ce seul événement ; « voir plus » ajoute la page suivante", async () => {
  const ctx = mk({
    calendar: Array.from({ length: 45 }, (_, i) => slot(i, 4 + i * 6)),
    yt: ytOk([{ id: "youtube:v1", title: "Première du clip", start: iso(9), type: "premiere" }]),
    tw: twOk([{ id: "twitch:me:1", title: "Surprise du vendredi", start: iso(13), games: ["Zelda"] }]),
  });
  const { els, server } = current = await boot(ctx);
  rowsOf(els.get("event-list"))[3].click();   // « Surprise du vendredi »
  await wait(700);
  assert.match(els.get("event-chosen").textContent, /Story pour :.*Surprise du vendredi/);
  assert.equal(rowsOf(els.get("event-list"))[3].attrs["aria-pressed"], "true"); assert.equal(rowsOf(els.get("event-list"))[0].attrs["aria-pressed"], "false");
  assert.ok(drawn(els).some((t) => /Surprise/.test(t)), "l'aperçu montre l'événement choisi");
  assert.ok(drawn(els).some((t) => /Zelda/.test(t)), "son jeu aussi");
  assert.equal(server.log.filter(([, r]) => r.startsWith("cover?")).length, 1, "une seule jaquette demandée"); assert.ok(server.log.some(([, r]) => r === "cover?game=Zelda"));
  assert.match(els.get("status").textContent, /Événement choisi : Surprise du vendredi/);
  els.get("event-more").click(); await wait(500);
  assert.equal(rowsOf(els.get("event-list")).length, 15, "« voir plus » ajoute 10 événements");
  assert.ok(server.log.some(([, r]) => /^events\?limit=10&cursor=/.test(r)));
  assert.match(els.get("event-count").textContent, /15 sur 47 événements/);
  for (let i = 0; i < 5 && !els.get("event-more").hidden; i++) { els.get("event-more").click(); await wait(500); }
  assert.equal(rowsOf(els.get("event-list")).length, 47); assert.equal(els.get("event-more").hidden, true, "plus rien à charger");
  assert.equal(new Set(rowsOf(els.get("event-list")).map((r) => r.textContent)).size, 47, "aucun doublon");
  assert.equal(rowsOf(els.get("event-list"))[3].attrs["aria-pressed"], "true", "le choix est gardé quand la liste s'allonge");
});

test("recherche et filtre par source : la liste est redemandée avec les mots tapés, une source choisie ; aucun résultat est dit", async () => {
  const ctx = mk({
    calendar: Array.from({ length: 10 }, (_, i) => slot(i, 4 + i * 6)),
    yt: ytOk([{ id: "youtube:v1", title: "Première du clip", start: iso(9), type: "premiere" }]),
    tw: twOk([{ id: "twitch:me:1", title: "Surprise du vendredi", start: iso(13) }]),
  });
  const { els, server } = current = await boot(ctx);
  await type(els.get("event-q"), "PREMIERE");
  assert.ok(server.log.some(([, r]) => r.includes("q=PREMIERE")));
  assert.deepEqual(rowsOf(els.get("event-list")).map((r) => /Première du clip/.exec(r.textContent)?.[0]), ["Première du clip"]);
  assert.match(els.get("event-count").textContent, /1 sur 1 événements/);
  await type(els.get("event-q"), "zzzzzz");
  assert.equal(rowsOf(els.get("event-list")).length, 0); assert.equal(els.get("event-note").textContent, fr.ui_event_no_match);
  await type(els.get("event-q"), "");
  buttons(els.get("event-filter")).find((b) => b.textContent.startsWith("Twitch")).click(); await wait(500);
  assert.ok(server.log.some(([, r]) => r.includes("source=twitch")));
  assert.deepEqual(rowsOf(els.get("event-list")).map((r) => /Surprise du vendredi/.exec(r.textContent)?.[0]), ["Surprise du vendredi"]);
  assert.equal(buttons(els.get("event-filter")).find((b) => b.textContent.startsWith("Twitch")).attrs["aria-pressed"], "true");
  buttons(els.get("event-filter")).find((b) => b.textContent === "Tout").click(); await wait(500);
  assert.equal(rowsOf(els.get("event-list")).length, 5);
});

test("une source en panne : message poli sous la liste, jamais d'erreur bloquante ; les autres événements restent choisissables ; « Réessayer » apparaît", async () => {
  const ctx = mk({ calendar: [slot(1, 6), slot(2, 30)], yt: () => { throw new Error("jeton-secret-abc"); }, tw: twOk([{ id: "twitch:me:1", title: "Surprise", start: iso(10) }]) });
  const { els } = current = await boot(ctx);
  assert.equal(rowsOf(els.get("event-list")).length, 3, "l'agenda et Twitch répondent");
  assert.match(els.get("event-alert").textContent, /Ma chaîne ne répond pas pour l'instant/, "le message est visible sans ouvrir la liste");
  assert.equal(els.get("event-retry").hidden, false);
  assert.equal(els.get("status").hidden, true, "pas de bandeau d'erreur");
  assert.ok(!JSON.stringify([...els.values()].map((e) => e.textContent)).includes("jeton-secret-abc"), "jamais le message d'une panne");
  rowsOf(els.get("event-list"))[1].click(); await wait(300);
  assert.match(els.get("event-chosen").textContent, /Story pour :.*Surprise/);
  const setup = mk({ calendar: [slot(1, 6)], yt: () => ({ ok: true, source: YT, state: "setup", message: "Ajoutez votre clé YouTube dans Réglages.", events: [] }) });
  current.server.restore();
  const again = current = await boot(setup);
  assert.match(again.els.get("event-sources").textContent, /YouTube : Ajoutez votre clé YouTube dans Réglages\./);
  assert.equal(again.els.get("event-retry").hidden, true, "rien à réessayer : c'est à régler");
});

test("rien ne répond et rien n'est planifié : la phrase le dit, l'écriture à la main s'ouvre toute seule et marche", async () => {
  const never = () => new Promise(() => {});
  const keep = setInterval(() => {}, 100);
  try {
    const ctx = mk({ yt: never, tw: never }); ctx.api.topics.collect = never;
    const { els } = current = await boot(ctx);
    assert.equal(rowsOf(els.get("event-list")).length, 0);
    assert.match(els.get("event-alert").textContent, new RegExp(fr.ui_event_all_down.slice(0, 30)));
    assert.equal(els.get("manual").hidden, false, "la saisie à la main est ouverte");
    els.get("m-title").value = "Mon événement"; els.get("m-title").fire("input");
    els.get("m-date").value = "2031-03-04"; els.get("m-date").fire("input"); await wait(500);
    assert.match(els.get("event-chosen").textContent, /Story pour :.*Mon événement.*4 mars.*à la main/);
    assert.ok(drawn(els).some((t) => /Mon/.test(t)));
    const empty = mk({});
    current.server.restore();
    const e2 = current = await boot(empty);
    assert.equal(els.get("event-list").children.length, 0); assert.equal(e2.els.get("event-note").textContent, fr.ui_event_none);
    assert.equal(e2.els.get("manual").hidden, false);
  } finally { clearInterval(keep); }
});

test("écrire soi-même : le bouton ouvre et ferme la saisie, la liste reste ; revenir à la liste garde les événements", async () => {
  const ctx = mk({ calendar: [slot(1, 6), slot(2, 30)] });
  const { els } = current = await boot(ctx);
  assert.equal(els.get("event-manual-toggle").textContent, fr.ui_event_manual); assert.equal(els.get("event-manual-toggle").attrs["aria-expanded"], "false");
  els.get("event-manual-toggle").click();
  assert.equal(els.get("manual").hidden, false); assert.equal(els.get("event-manual-toggle").textContent, fr.ui_event_manual_close); assert.equal(els.get("event-manual-toggle").attrs["aria-expanded"], "true");
  assert.match(els.get("event-chosen").textContent, /Aucun événement choisi/);
  els.get("event-manual-toggle").click();
  assert.equal(els.get("manual").hidden, true); assert.equal(rowsOf(els.get("event-list")).length, 2);
  rowsOf(els.get("event-list"))[1].click(); await wait(200);
  assert.match(els.get("event-chosen").textContent, /Story pour :.*Stream 2/);
});

test("la demande d'un assistant : l'événement choisi (identifiant + source) est retrouvé, même loin dans la liste ; un événement disparu est dit et remplacé par le prochain", async () => {
  const ctx = mk({
    calendar: Array.from({ length: 50 }, (_, i) => slot(i, 4 + i * 6)),
    yt: ytOk([{ id: "youtube:v1", title: "Première du clip", start: iso(400), type: "premiere" }]),
  });
  const far = (await def.mcp.story_events(ctx, { source: "youtube" })).events[0];
  const out = await def.mcp.story_prepare(ctx, { event: far.id, text: "Venez !" });
  const pid = new URL(out.link).searchParams.get("prep");
  const { els, server } = current = await boot(ctx, { prep: pid });
  assert.ok(server.log.some(([, r]) => r.includes("id=youtube%3Av1")), "l'identifiant est redemandé à la liste");
  assert.match(els.get("event-chosen").textContent, /Story pour :.*Première du clip/);
  assert.equal(els.get("prep-note").hidden, false); assert.equal(els.get("prep-stream-gone").hidden, true);
  await wait(300);
  assert.ok(drawn(els).some((t) => /Première/.test(t)));
  assert.ok(drawn(els).some((t) => /Venez/.test(t)), "la phrase de l'assistant est là aussi");
  // l'événement a disparu depuis
  server.restore();
  const later = mk({ calendar: Array.from({ length: 5 }, (_, i) => slot(i, 4 + i * 6)) });
  await later.api.store.add("story_key", await (await ctx.api.store.list("story_key"))[0]?.data);
  const prep = await data.savePrep(later, { config: P.cleanConfig({ eventId: "youtube:parti", eventSource: "youtube" }), manual: null });
  const b = current = await boot(later, { prep: prep.pid });
  assert.equal(b.els.get("prep-stream-gone").hidden, false);
  assert.match(b.els.get("event-chosen").textContent, /Story pour :.*Stream 0/);
});

test("en anglais : titre, boutons et messages sont traduits", async () => {
  const ctx = mk({ locale: "en", calendar: [slot(1, 6)], yt: () => { throw new Error("x"); } });
  const { els, html } = current = await boot(ctx);
  assert.match(html, /For which event\?/);
  assert.match(els.get("event-chosen").textContent, /Story for:.*Stream 1/);
  assert.match(els.get("event-alert").textContent, /Ma chaîne is not answering right now/);
  assert.equal(els.get("event-manual-toggle").textContent, en.ui_event_manual);
  assert.match(rowsOf(els.get("event-list"))[0].textContent, /Schedule/, "la pastille de l'agenda est traduite");
});

/* ───────────── « Ce n'est pas le bon jeu ? » (cœur 0.2.10) ───────────── */
const warnLink = (els) => els.get("cover-warn").children.find((c) => c.tagName === "a");
const COVER_OK = "https://media.rawg.io/media/games/abc/abcdef0123456789.jpg";
const pickFirst = async (ctx) => {
  const r = current = await boot(ctx);
  await wait(300);
  return r;
};

test("jaquette ambiguë : une phrase et le lien « Ce n'est pas le bon jeu ? » (titre encodé, nouvel onglet) apparaissent au-dessus de « Générer la vidéo », qui reste utilisable ; masqués ensuite si on décoche le jeu", async () => {
  const ctx = mk({ calendar: [slot(1, 6, { games: ["Hades (II) & l'été"] })] });
  ctx.api.rawg.cover = async () => ({ status: "found", url: COVER_OK, name: "Autre jeu", id: 3, ambiguous: true });
  const { els } = await pickFirst(ctx);
  const box = els.get("cover-warn");
  assert.equal(box.hidden, false);
  assert.match(box.textContent, /La jaquette de « Hades \(II\) & l'été » est peut-être celle d'un autre jeu \(RAWG a pris « Autre jeu »\)\. La vidéo se fait quand même\./);
  const a = warnLink(els);
  assert.equal(a.textContent, "Ce n'est pas le bon jeu ?");
  assert.equal(a.attrs.href, `/admin/settings/rawg-covers?titre=${encodeURIComponent("Hades (II) & l'été")}`);
  assert.deepEqual([a.attrs.target, a.attrs.rel], ["_blank", "noopener"], "nouvel onglet : le travail en cours reste là");
  assert.equal(els.get("generate").isDisabled, false, "la vidéo n'est jamais bloquée");
  els.get("el-game").checked = false; els.get("el-game").fire("change");
  assert.equal(box.hidden, true, "sans le jeu dans la vidéo, plus d'avertissement");
});

test("jaquette sûre (ambiguous faux ou absent), sans jaquette, ou jeu absent : aucun avertissement", async () => {
  for (const cover of [{ status: "found", url: COVER_OK, ambiguous: false }, { status: "found", url: COVER_OK }, { status: "none", url: null }]) {
    const ctx = mk({ calendar: [slot(1, 6, { games: ["Celeste"] })] });
    ctx.api.rawg.cover = async () => cover;
    const { els } = await pickFirst(ctx);
    assert.equal(els.get("cover-warn").hidden, true, JSON.stringify(cover));
    current.server.restore();
  }
  const { els } = await pickFirst(mk({ calendar: [slot(1, 6)] }));
  assert.equal(els.get("cover-warn").hidden, true, "pas de jeu, pas d'avertissement");
});

test("en anglais : l'avertissement et le lien sont traduits (avec ou sans le nom du jeu trouvé)", async () => {
  const ctx = mk({ locale: "en", calendar: [slot(1, 6, { games: ["Celeste"] })] });
  ctx.api.rawg.cover = async () => ({ status: "found", url: COVER_OK, ambiguous: true });
  const { els } = await pickFirst(ctx);
  assert.equal(els.get("cover-warn").textContent, "The cover for “Celeste” may belong to another game. You can still make the video. Not the right game?");
  assert.equal(warnLink(els).textContent, "Not the right game?");
});

test("l'éditeur et la page ne lisent ces phrases que dans les locales (parité FR/EN)", () => {
  for (const k of ["ui_cover_ambiguous", "ui_cover_ambiguous_named", "ui_cover_wrong"]) assert.ok(k in fr && k in en, k);
});
