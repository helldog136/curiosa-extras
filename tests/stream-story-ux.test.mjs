// Refonte ergonomique de l'éditeur (Story d'annonce 2.4.0), exécutée pour de vrai (app.mjs) dans un faux navigateur : le PROCHAIN événement (toutes sources) est choisi à l'ouverture,
// la liste est repliée et courte, changer d'événement ne perd rien, les options avancées sont cachées tant qu'on ne les demande pas, les erreurs sont sous leur champ.
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
const page = await import("../modules/stream-story/page.mjs");

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
  await import(`../modules/stream-story/app.mjs?ux-${++n}`);
  await wait(700);
  return { els, server, html };
}

const slot = (i, h, extra = {}) => ({ id: `s${i}`, title: `Stream ${i}`, start: iso(h), end: iso(h + 1), allDay: false, games: [], status: "confirmed", timezone: "Europe/Paris", ...extra });
const ytOk = (events) => () => ({ ok: true, source: YT, state: "ok", note: "", events });
const twOk = (events) => () => ({ ok: true, source: TW, state: "ok", events });
const mk = ({ calendar = [], yt, tw, locale = "fr", settings = {} } = {}) => (src.resetEvents(), fakeCtx({
  key: "story", moduleId: "stream-story", locale, messages: { ...(locale === "en" ? en : fr) }, permissions: manifest.permissions, siteUrl: SITE, settings: { timezone: "Europe/Paris", ...settings },
  topics: { "planning.slot": () => calendar },
  serviceInstances: { "event.source": [...(yt ? [{ instance: "yt", name: "Ma chaîne", methods: { upcoming: yt } }] : []), ...(tw ? [{ instance: "tw", name: "Mon Twitch", methods: { upcoming: tw } }] : [])] },
  instances: [{ id: "id-story", key: "story", module: "stream-story", basePath: "", name: "Story", adminPath: "/admin/instances/id-story" }],
}));
const drawn = (els) => els.get("preview").getContext().log.filter((l) => l[0] === "fillText").map((l) => l[1]);
let current;
const timing0 = { ...src.timing };
beforeEach(() => { Object.assign(src.timing, timing0, { collectMs: 300, providersMs: 300, sourceMs: 400, eventsMs: 900 }); });
afterEach(() => { current?.server.restore(); current = null; Object.assign(src.timing, timing0); });

test("le prochain événement : le premier qui n'a pas commencé ; une journée entière compte jusqu'à ce soir ; si tout est en cours, le premier ; liste vide : rien", () => {
  const now = Date.UTC(2026, 9, 24, 12, 0), day = (d) => ({ startMs: Date.UTC(2026, 9, d), allDay: true, day: `2026-10-${d}` });
  const started = { startMs: now - H }, soon = { startMs: now + H }, later = { startMs: now + 5 * H };
  assert.equal(P.isUpcoming(started, now), false); assert.equal(P.isUpcoming(soon, now), true); assert.equal(P.isUpcoming(null, now), false);
  assert.equal(P.isUpcoming(day(24), now, "UTC"), true, "une journée entière d'aujourd'hui est encore à venir"); assert.equal(P.isUpcoming(day(23), now, "UTC"), false);
  assert.equal(P.nextEvent([started, soon, later], now), soon);
  assert.equal(P.nextEvent([started], now), started, "tout est commencé : le premier");
  assert.equal(P.nextEvent([], now), null); assert.equal(P.nextEvent(undefined, now), null);
});

test("à l'ouverture : le prochain événement de TOUTES les sources est déjà choisi (pas celui qui a commencé), la liste est repliée, la recherche absente, la vidéo prête", async () => {
  const ctx = mk({
    calendar: [slot(0, -1), slot(1, 30), slot(2, 40)],
    yt: ytOk([{ id: "youtube:v1", title: "Première du clip", start: iso(5), type: "premiere" }]),
    tw: twOk([{ id: "twitch:me:1", title: "Surprise", start: iso(20) }]),
  });
  const { els, server } = current = await boot(ctx);
  assert.match(els.get("event-chosen").textContent, /Prochain événement/); assert.match(els.get("event-chosen").textContent, /Première du clip/, "YouTube passe avant l'agenda : tout est trié ensemble");
  assert.doesNotMatch(els.get("event-chosen").textContent, /Stream 0/, "un événement déjà commencé n'est pas « le prochain »");
  assert.equal(els.get("event-picker").hidden, true); assert.equal(els.get("event-search-box").hidden, true, "peu d'événements : pas de recherche");
  assert.equal(els.get("event-change").attrs["aria-expanded"], "false");
  assert.ok(!server.log.some(([, r]) => r.startsWith("events?") && /q=/.test(r)), "aucune recherche n'a été nécessaire");
  const rows = rowsOf(els.get("event-list"));
  assert.match(rows[0].textContent, /Déjà commencé/, "l'événement commencé reste dans la liste, étiqueté");
  assert.equal(els.get("generate").isDisabled, false, "un seul clic suffit pour fabriquer la vidéo");
  await wait(300); assert.ok(drawn(els).some((t) => /Première/.test(t)));
  els.get("event-change").click();
  assert.equal(els.get("event-picker").hidden, false); assert.equal(els.get("event-change").attrs["aria-expanded"], "true"); assert.equal(els.get("event-change").textContent, fr.ui_event_change_close);
  els.get("event-change").click(); assert.equal(els.get("event-picker").hidden, true);
});

test("tout est déjà commencé : le premier est choisi, étiqueté « Déjà commencé » ; deux événements au même moment : le second est signalé", async () => {
  const a = mk({ calendar: [slot(0, -1)] });
  const one = current = await boot(a);
  assert.match(one.els.get("event-chosen").textContent, /Stream 0/); assert.match(one.els.get("event-chosen").textContent, /Déjà commencé/); assert.doesNotMatch(one.els.get("event-chosen").textContent, /Prochain événement/);
  one.server.restore();
  const at = iso(10);
  const b = mk({ calendar: [slot(1, 10)], yt: ytOk([{ id: "youtube:v2", title: "Direct en même temps", start: slot(1, 10).start, type: "live" }]) });
  const two = current = await boot(b);
  assert.equal(two.els.get("event-same").hidden, false); assert.match(two.els.get("event-same").textContent, /Au même moment : Direct en même temps/);
  void at;
});

test("changer d'événement ne perd rien : style, phrase, mention et co-streamers restent, l'aperçu suit ; la liste se referme", async () => {
  const ctx = mk({ calendar: [slot(1, 5), slot(2, 30, { games: ["Zelda"] })] });
  const { els } = current = await boot(ctx);
  els.get("text").value = "Rendez-vous ce soir !"; els.get("text").fire("input");
  els.get("style-poster").checked = true; els.get("style-poster").fire("change");
  els.get("adhoc-box").open = true; els.get("a-login").value = "mon_ami_tv"; els.get("a-name").value = "Mon ami"; els.get("adhoc-add").click(); await wait(500);
  els.get("event-change").click();
  rowsOf(els.get("event-list"))[1].click(); await wait(700);
  assert.match(els.get("event-chosen").textContent, /Stream 2/); assert.doesNotMatch(els.get("event-chosen").textContent, /Prochain événement/, "le badge ne suit que le choix par défaut");
  assert.equal(els.get("event-picker").hidden, true, "choisir referme la liste");
  assert.equal(els.get("text").value, "Rendez-vous ce soir !"); assert.equal(els.get("style-poster").checked, true);
  assert.match(els.get("chosen").textContent, /Mon ami/);
  assert.ok(drawn(els).some((t) => /Stream 2/.test(t)) && drawn(els).some((t) => /Rendez-vous/.test(t)) && drawn(els).some((t) => /Mon ami/.test(t)), "l'aperçu montre le nouvel événement ET le travail en cours");
});

test("options avancées : cachées tant qu'on ne les demande pas (la mention reste visible) ; une préparation qui en change une les montre ; la case les ouvre", async () => {
  const ctx = mk({ calendar: [slot(1, 5)] });
  const plain = current = await boot(ctx);
  assert.equal(plain.els.get("advanced").hidden, true); assert.equal(plain.els.get("adv").checked, false);
  plain.els.get("adv").checked = true; plain.els.get("adv").fire("change"); assert.equal(plain.els.get("advanced").hidden, false);
  plain.els.get("adv").checked = false; plain.els.get("adv").fire("change"); assert.equal(plain.els.get("advanced").hidden, true);
  plain.server.restore();
  const out = await def.mcp.story_prepare(ctx, { durationSeconds: 8 });
  const b = current = await boot(ctx, { prep: new URL(out.link).searchParams.get("prep") });
  assert.equal(b.els.get("advanced").hidden, false, "un réglage avancé déjà modifié n'est jamais caché"); assert.equal(b.els.get("duration").value, 8);
});

test("erreurs sous le champ, avec un exemple : nom de modèle manquant ; états « en cours » sur les boutons", async () => {
  const ctx = mk({ calendar: [slot(1, 5)] });
  const { els } = current = await boot(ctx);
  els.get("model-save").click(); await wait(300);
  assert.equal(els.get("model-error").textContent, fr.ui_err_name); assert.match(fr.ui_err_name, /par exemple/); assert.equal(els.get("model-name").attrs["aria-invalid"], "true");
  assert.equal(els.get("model-save").attrs["aria-busy"], "false", "le bouton n'est plus « en cours »"); assert.equal(els.get("model-save").isDisabled, false);
  els.get("a-login").value = ""; els.get("a-name").value = ""; els.get("adhoc-add").click(); await wait(300);
  assert.equal(els.get("a-error").textContent, fr.ui_err_empty); assert.match(fr.ui_err_empty, /par exemple/);
  els.get("event-change").click(); els.get("event-manual-toggle").click();
  els.get("m-title").value = ""; els.get("m-date").value = "2031-03-04"; els.get("m-date").fire("input");
  assert.equal(els.get("manual-error").textContent, fr.ui_manual_title); assert.match(fr.ui_manual_title, /par exemple/);
});

test("une phrase par réglage, en français comme en anglais : mêmes clés, mêmes {variables}, aucune clé de la page sans phrase", () => {
  const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  const keys = (l) => Object.keys(l).filter((k) => k.startsWith("ui_")).sort();
  assert.deepEqual(keys(fr), keys(en));
  for (const k of keys(fr)) assert.equal(vars(fr[k]), vars(en[k]), k);
  for (const k of page.KEYS) { assert.ok(fr[`ui_${k}`], `fr ${k}`); assert.ok(en[`ui_${k}`], `en ${k}`); }
  for (const k of ["event_next", "event_started", "event_change", "event_pick_title", "event_same", "h_custom", "adv_label", "busy_generate", "busy_saving", "busy_reading", "busy_adding"]) assert.ok(page.KEYS.includes(k), k);
});

test("la page : un seul bouton principal, 44 px partout, aperçu avant les réglages, « Personnaliser » et « Options avancées » repliés ou cachés", async () => {
  const html = await (await page.studioPage(mk({}), { base: "/m/story", colors: {}, timezone: "", font: "", accent: "#4f46e5", accentFg: "#ffffff" })).text();
  assert.equal((html.match(/class="primary"/g) ?? []).length, 1);
  assert.match(html, /button,a\.button\{min-height:44px\}/);
  assert.ok(html.indexOf('id="event-chosen"') < html.indexOf('id="preview"') && html.indexOf('id="preview"') < html.indexOf('id="custom"'), "l'événement, puis l'aperçu, puis les réglages (dans le code, donc au clavier)");
  assert.doesNotMatch(/<details id="custom"[^>]*>/.exec(html)[0], /open/); assert.match(/<div id="advanced"[^>]*>/.exec(html)[0], /hidden/);
  assert.match(html, /\.genbar\{position:fixed;left:0;right:0;bottom:0/, "le bouton principal reste atteignable sur téléphone");
  assert.match(html, /prefers-reduced-motion:reduce/);
});
