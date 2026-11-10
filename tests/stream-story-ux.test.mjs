// The editor of "Announcement story" (app.mjs) in three steps (event, information, style), run for real in a minimal fake browser and wired to the module's real routes:
// the NEXT event (all sources) picked on opening, "Generate now" from the first steps, a short folded list, work never lost when changing step or event, the information step with
// one removable item per thing the video can show, the plain preview of steps 1 and 2, the style as the last step, errors under their field, the opening on the last step for a model
// or an assistant preparation.
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
// L'instant de référence est lu UNE seule fois : « maintenant + h » donne toujours la même chaîne pour le même h. Avec Date.now() à chaque appel, deux événements prévus « au même moment » pouvaient
// différer d'une milliseconde (la seconde lecture tombait sur la milliseconde suivante) et ne plus être reconnus comme simultanés.
const T0 = Date.now();
const iso = (h) => new Date(T0 + h * H).toISOString();
const YT = { kind: "youtube", label: "YouTube" }, TW = { kind: "twitch", label: "Twitch" };

class Text { constructor(t) { this.nodeType = 3; this.textContent = String(t); } }
class El {
  constructor(tag) { this.nodeType = 1; this.tagName = tag; this.children = []; this.attrs = {}; this.listeners = {}; this._text = ""; this.hidden = false; this.value = ""; this.checked = false; this.disabled = false; this.className = ""; this.dataset = {}; this.style = {}; this.open = false; this.ctx = null; }
  get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join("") : this._text; }
  set textContent(v) { this.children = []; this._text = String(v); }
  append(...kids) { for (const k of kids) this.children.push(k); }
  replaceChildren(...kids) { this.children = []; this._text = ""; this.append(...kids); }
  setAttribute(k, v) { this.attrs[k] = v; if (k === "id") { this.id = v; this.onId?.(v); } }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  fire(type, ev = {}) { for (const fn of this.listeners[type] ?? []) fn({ key: "", preventDefault() {}, target: this, ...ev }); }
  click() { if (!this.isDisabled) this.fire("click"); }
  get isDisabled() { return this.disabled || "disabled" in this.attrs; }
  focus() { El.focused = this.id; }
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
  const document = { getElementById: (id) => els.get(id) ?? null, createElement: (t) => { const e = new El(t); e.onId = (id) => els.set(id, e); return e; }, createTextNode: (t) => new Text(t), querySelectorAll: () => [], body };
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
  const same = slot(1, 10);   // un seul créneau : l'événement YouTube commence exactement au même instant que celui de l'agenda
  const b = mk({ calendar: [same], yt: ytOk([{ id: "youtube:v2", title: "Direct en même temps", start: same.start, type: "live" }]) });
  const two = current = await boot(b);
  assert.equal(two.els.get("event-same").hidden, false); assert.match(two.els.get("event-same").textContent, /Au même moment : Direct en même temps/);
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

test("a preparation that sets a rare option (language, length) opens it; the plain tick boxes of the old advanced block are gone", async () => {
  const ctx = mk({ calendar: [slot(1, 5)] });
  const plain = current = await boot(ctx);
  assert.equal(plain.els.get("more-3").open, false, "\"More options\" starts folded"); assert.equal(plain.els.get("more-2").open, false);
  assert.ok(!plain.els.has("adv") && !plain.els.has("advanced"), "no separate advanced block any more");
  plain.server.restore();
  const out = await def.mcp.story_prepare(ctx, { durationSeconds: 8, language: "en" });
  const b = current = await boot(ctx, { prep: new URL(out.link).searchParams.get("prep") });
  assert.equal(b.els.get("more-3").open, true, "a rare setting that was already changed is never left hidden"); assert.equal(b.els.get("duration").value, 8);
  assert.equal(b.els.get("more-2").open, true); assert.equal(b.els.get("lang").value, "en");
});

test("errors sit under their field, with an example: missing model name, a time without a day, a day that does not exist; busy states on the buttons", async () => {
  const ctx = mk({ calendar: [slot(1, 5)] });
  const { els } = current = await boot(ctx);
  els.get("model-save").click(); await wait(300);
  assert.equal(els.get("model-error").textContent, fr.ui_err_name); assert.match(fr.ui_err_name, /par exemple/); assert.equal(els.get("model-name").attrs["aria-invalid"], "true");
  assert.equal(els.get("model-save").attrs["aria-busy"], "false", "the button is no longer busy"); assert.equal(els.get("model-save").isDisabled, false);
  els.get("a-login").value = ""; els.get("a-name").value = ""; els.get("adhoc-add").click(); await wait(300);
  assert.equal(els.get("a-error").textContent, fr.ui_err_empty); assert.match(fr.ui_err_empty, /par exemple/);
  els.get("event-none").click();
  els.get("info-time").value = "19:30"; els.get("info-time").fire("input");
  assert.equal(els.get("info-error").textContent, fr.ui_info_need_date); assert.match(fr.ui_info_need_date, /par exemple/); assert.equal(els.get("info-date").attrs["aria-invalid"], "true");
  els.get("info-date").value = "2031-02-31"; els.get("info-date").fire("input");
  assert.equal(els.get("info-error").textContent, fr.ui_manual_date); assert.match(fr.ui_manual_date, /par exemple/);
  els.get("info-date").value = "2031-03-04"; els.get("info-date").fire("input");
  assert.equal(els.get("info-error").textContent, ""); assert.equal(els.get("info-date").attrs["aria-invalid"], "false");
});

test("one sentence per setting, in French and in English: same keys, same {variables}, no key of the page without a sentence, none left over", () => {
  const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  const keys = (l) => Object.keys(l).filter((k) => k.startsWith("ui_")).sort();
  assert.deepEqual(keys(fr), keys(en));
  for (const k of keys(fr)) assert.equal(vars(fr[k]), vars(en[k]), k);
  for (const k of page.KEYS) { assert.ok(fr[`ui_${k}`], `fr ${k}`); assert.ok(en[`ui_${k}`], `en ${k}`); }
  for (const k of ["event_next", "event_started", "event_change", "event_pick_title", "event_same", "event_none_btn", "event_none_set", "event_pick", "busy_generate", "busy_saving", "busy_reading", "busy_adding", "step_1", "step_2", "step_3", "prev", "next_info", "next_style", "gen_now", "h_info", "h_style", "in_video", "more_options", "pv_plain", "step_now"]) assert.ok(page.KEYS.includes(k), k);
  for (const k of ["recap_intro", "recap_edit", "adv_label", "h_advanced", "next_look", "next_video", "event_manual", "h_video"]) assert.ok(!page.KEYS.includes(k), `${k} is gone with the old steps`);
});

test("ergonomics of the new texts (rules R9 to R13): labels and hints short, no colon at the end, no forbidden word, polite form, no exclamation mark, button verbs", () => {
  const FORBIDDEN = /\b(cl[ée]s?|slug|instance|topic|token|jeton|webhook|route|service|identifiant|payload|api|json|cache|hash|sse|oauth)\b/i;
  const labels = ["step_1", "step_2", "step_3", "next_info", "next_style", "generate", "gen_now", "event_none_btn", "event_pick", "event_change", "in_video", "f_title", "f_when", "f_date", "f_time", "f_game", "f_countdown", "text_label", "members_pick", "f_brand", "more_options", "g_event", "g_own", "h_info", "h_style"];
  const hints = ["game_help", "countdown_need", "countdown_off", "channel_help", "text_help", "m_time_hint", "ph_title", "ph_game", "ph_text"];
  for (const l of [fr, en]) {
    for (const k of labels) { const t = l[`ui_${k}`]; assert.ok(t.length <= 60, `${k} (${t.length})`); assert.ok(!/:\s*$/.test(t), `${k}: ends with a colon`); assert.ok(!FORBIDDEN.test(t), k); }
    for (const k of hints) { const t = l[`ui_${k}`]; assert.ok(t.length <= 60, `${k} (${t.length}): ${t}`); assert.ok(!FORBIDDEN.test(t), k); }
    for (const k of [...labels, ...hints, "info_intro", "style_intro", "pv_plain", "event_none_chosen", "event_none_set", "info_need_date", "empty"]) {
      const t = l[`ui_${k}`];
      assert.ok(!/!/.test(t) && !/veuillez/i.test(t), `${k}: exclamation mark or "veuillez"`);
      assert.ok(t.split(/[.?:;]\s/).every((sentence) => sentence.split(/\s+/).length <= 20), `${k}: sentence over 20 words`);
    }
  }
  for (const k of ["f_title", "f_game", "text_label"]) assert.match(fr[`ui_ph_${{ f_title: "title", f_game: "game", text_label: "text" }[k]}`], /^Par exemple/, "a free field has a concrete example");
  assert.doesNotMatch(fr.ui_next_info + fr.ui_next_style + fr.ui_generate, /\b(OK|Valider|Soumettre)\b/, "a precise verb on the main buttons");
  assert.deepEqual([fr.ui_next_info, fr.ui_next_style, fr.ui_generate], ["Suivant : modifier les informations", "Suivant : choisir le style", "Générer la vidéo"]);
  assert.deepEqual([en.ui_next_info, en.ui_next_style, en.ui_generate], ["Next: edit the information", "Next: choose the style", "Generate the video"]);
});

test("the page: three steps, the preview before the settings in the code, steps 2 and 3 hidden, one switch per item, the style last with the main button, a fixed bar on a phone, 44 px, reduced motion", async () => {
  const html = await (await page.studioPage(mk({}), { base: "/m/story", colors: {}, timezone: "", font: "", accent: "#4f46e5", accentFg: "#ffffff" })).text();
  assert.equal((html.match(/class="stepbtn"/g) ?? []).length, 3, "one clickable marker per step");
  assert.match(html, /<nav class="stepper" aria-label="Étapes">/);
  assert.ok(html.indexOf('class="stepper"') < html.indexOf('id="preview"') && html.indexOf('id="preview"') < html.indexOf('id="step-1"'), "steps, preview, then settings (in the code, so for the keyboard too)");
  assert.ok(html.indexOf('id="preview"') < html.indexOf('class="panels"') && !/<div class="panels">[\s\S]*id="preview"/.test(html), "the preview is in no step: it stays there at each one");
  for (const id of ["step-2", "step-3"]) assert.match(new RegExp(`<section id="${id}"[^>]*>`).exec(html)[0], /hidden/, id);
  assert.doesNotMatch(/<section id="step-1"[^>]*>/.exec(html)[0], /hidden/);
  assert.match(/<button[^>]*id="generate"[^>]*>/.exec(html)[0], /hidden/, "\"Generate the video\" is on the last step; \"Generate now\" serves before it");
  assert.ok(html.indexOf('id="step-3"') < html.indexOf('id="generate"'), "the main button comes after the style step");
  // the information step: one item and one switch per thing the video can show, the switch being the tick of the element
  for (const e of P.ELEMENTS) {
    assert.match(html, new RegExp(`<div class="item" id="item-${e}">`), e);
    assert.match(html, new RegExp(`<input type="checkbox" role="switch" id="el-${e}" aria-labelledby="lbl-${e} sw-${e}">`), `a switch with a name for ${e}`);
  }
  const groups = [...html.matchAll(/<fieldset class="group">([\s\S]*?)<\/fieldset>/g)].map((m) => (m[1].match(/class="item"/g) ?? []).length);
  assert.ok(groups.length === 2 && groups.every((n) => n <= 5), `at most 5 items per group (${groups})`);
  assert.ok(!html.includes('id="advanced"') && !html.includes('id="recap"') && !html.includes('id="m-title"'), "no advanced block, no recap, no second place to write the event");
  // the style step holds the style, the format, the mark, then the rare options and the models
  const order = ["style-neon", "format-vertical", "watermark", "more-3", "models-box"].map((id) => html.indexOf(`id="${id}"`));
  assert.deepEqual(order, [...order].sort((x, y) => x - y)); assert.ok(order.every((i) => i > html.indexOf('id="step-3"')), "all on step 3");
  assert.ok(html.indexOf('id="step-3"') > html.indexOf('id="more-2"'), "step 3 comes after step 2");
  assert.match(html, /\.navbar\{position:fixed;left:0;right:0;bottom:0/, "the buttons stay reachable on a phone");
  assert.match(html, /\.top\{display:block;position:sticky;top:0/, "steps and a small preview stick to the top on a phone");
  assert.match(html, /button,a\.button\{min-height:44px\}/); assert.match(html, /\.sw\{[^}]*min-height:44px/, "the switches are 44 px high");
  assert.match(html, /prefers-reduced-motion:reduce/);
  assert.match(html, /<h2 id="h-event" tabindex="-1">/); assert.match(html, /<h2 id="h-info" tabindex="-1">/); assert.match(html, /<h2 id="h-style" tabindex="-1">/);
});

const go = async (els, id) => { els.get(id).click(); await wait(80); };
const shown = (els) => [1, 2, 3].filter((n) => !els.get(`step-${n}`).hidden);
const styleOf = (els) => els.get("preview").dataset.style;
const clearLog = (els) => { els.get("preview").getContext().log.length = 0; };
const tick = (els, id, on) => { els.get(id).checked = on; els.get(id).fire("change"); };

test("the flow: event, then information, then style; Next/Back and the step markers; the work is never lost going back; the preview follows each step", async () => {
  const ctx = mk({ calendar: [slot(1, 5, { games: ["Zelda"] }), slot(2, 30)] });
  const { els } = current = await boot(ctx);
  assert.deepEqual(shown(els), [1]); assert.equal(els.get("step-btn-1").attrs["aria-current"], "step"); assert.equal(els.get("step-btn-2").attrs["aria-current"], "false");
  assert.equal(els.get("step-prev").hidden, true); assert.equal(els.get("step-next").hidden, false); assert.equal(els.get("generate").hidden, true);
  assert.equal(els.get("generate-now").hidden, false, "the quick way is there from step 1");
  await go(els, "step-next");
  assert.deepEqual(shown(els), [2]); assert.equal(els.get("step-prev").hidden, false); assert.equal(els.get("generate-now").hidden, false);
  assert.equal(els.get("step-live").textContent, "Étape 2 sur 3 : Informations"); assert.equal(El.focused, "h-info", "the focus moves to the title of the step");
  assert.equal(els.get("step-btn-2").attrs["aria-current"], "step"); assert.equal(els.get("step-btn-1").attrs["aria-current"], "false");
  els.get("text").value = "À ce soir"; els.get("text").fire("input"); await wait(400);
  assert.ok(drawn(els).some((t) => /soir/.test(t)), "the preview follows step 2");
  await go(els, "step-next");
  assert.deepEqual(shown(els), [3]); assert.equal(El.focused, "h-style");
  assert.equal(els.get("generate").hidden, false); assert.equal(els.get("generate-now").hidden, true); assert.equal(els.get("step-next").hidden, true);
  await go(els, "step-btn-1");   // straight back to step 1 with the marker
  els.get("event-change").click(); rowsOf(els.get("event-list"))[1].click(); await wait(700);
  await go(els, "step-btn-2");
  assert.equal(els.get("text").value, "À ce soir", "nothing is lost going back"); assert.equal(els.get("info-title").value, "Stream 2", "the information follows the new event");
  await go(els, "step-prev"); assert.deepEqual(shown(els), [1]); assert.match(els.get("event-chosen").textContent, /Stream 2/); assert.equal(El.focused, "h-event");
  await go(els, "step-btn-3");
  assert.ok(drawn(els).some((t) => /Stream 2/.test(t)), "the preview is still there on step 3");
});

test("steps 1 and 2 preview in the plain default style, the chosen style appears on step 3 and is kept when going back; the default is not a choice", async () => {
  const ctx = mk({ calendar: [slot(1, 5)] });
  const { els } = current = await boot(ctx);
  assert.equal(P.EDIT_STYLE, "minimal");
  assert.equal(styleOf(els), "minimal", "step 1: the plain style"); assert.equal(els.get("pv-note").hidden, false, "the preview says it is a plain one");
  await go(els, "step-next"); await wait(200);
  assert.equal(styleOf(els), "minimal", "step 2: still the plain style");
  assert.equal(els.get("style-neon").checked, true, "the card of the default style is selected, but nothing was chosen");
  await go(els, "step-next"); await wait(300);
  assert.equal(styleOf(els), P.DEFAULT_CONFIG.style, "step 3: the style of the cards"); assert.equal(els.get("pv-note").hidden, true);
  els.get("style-poster").checked = true; els.get("style-poster").fire("change"); await wait(300);
  assert.equal(styleOf(els), "poster", "choosing a card changes the preview at once");
  els.get("style-kinetic").checked = true; els.get("style-kinetic").fire("change"); await wait(300);
  assert.equal(styleOf(els), "kinetic");
  await go(els, "step-prev"); await wait(300);
  assert.equal(styleOf(els), "kinetic", "a style that was chosen is kept in the preview when going back");
  assert.equal(els.get("pv-note").hidden, true);
  const unchosen = current = (current.server.restore(), await boot(ctx));
  await go(unchosen.els, "step-btn-3"); await go(unchosen.els, "step-btn-1"); await wait(300);
  assert.equal(styleOf(unchosen.els), "minimal", "looking at step 3 without choosing does not make the default a choice");
});

test("each item can be corrected, and removed in one gesture (its switch, the old tick of the element): the preview and the scene lose it", async () => {
  const ctx = mk({ calendar: [slot(1, 5, { games: ["Zelda"] })] });
  const { els } = current = await boot(ctx);
  await go(els, "step-next");
  const ev = P.infoFromStream(P.upcomingStreams([slot(1, 5, { games: ["Zelda"] })], Date.now(), "Europe/Paris")[0], "Europe/Paris");
  assert.deepEqual([els.get("info-title").value, els.get("info-date").value, els.get("info-time").value, els.get("info-game").value], [ev.title, ev.date, ev.time, ev.game], "prefilled from the event");
  for (const e of ["title", "when", "game", "brand", "text", "costreamers"]) assert.equal(els.get(`el-${e}`).checked, true, `${e} is shown`);
  assert.equal(els.get("el-countdown").checked, false, "the countdown is off by default");
  assert.equal(els.get("item-title").className, "item"); assert.equal(els.get("item-countdown").className, "item off", "an item that is off is dimmed");
  await wait(300);
  assert.ok(drawn(els).some((t) => /Stream 1/.test(t)) && drawn(els).some((t) => /Zelda/.test(t)));
  // correcting the title changes the preview
  els.get("info-title").value = "Soirée découverte"; els.get("info-title").fire("input"); await wait(300);
  assert.ok(drawn(els).some((t) => /Soirée/.test(t)));
  // removing: the title, the game, the day, in one click each
  clearLog(els); tick(els, "el-title", false); tick(els, "el-game", false); await wait(300);
  const after = drawn(els);
  assert.ok(after.length > 0 && !after.some((t) => /Soirée|Zelda/.test(t)), "title and game are gone from the preview");
  assert.equal(els.get("item-title").className, "item off");
  assert.equal(els.get("info-title").value, "Soirée découverte", "what was typed stays: switching on again brings it back");
  clearLog(els); tick(els, "el-title", true); await wait(300);
  assert.ok(drawn(els).some((t) => /Soirée/.test(t)), "switched on again");
  // the sentence and the channel name
  els.get("text").value = "Rendez-vous ce soir"; els.get("text").fire("input"); els.get("channel").value = "etoile_nord"; els.get("channel").fire("input"); await wait(300);
  assert.ok(drawn(els).some((t) => /Rendez-vous/.test(t)) && drawn(els).some((t) => /etoile_nord/.test(t)));
  clearLog(els); tick(els, "el-text", false); tick(els, "el-brand", false); await wait(300);
  assert.ok(!drawn(els).some((t) => /Rendez-vous|etoile_nord/.test(t)), "sentence and channel name removed");
  // a guest streamer, then the whole guest list removed
  els.get("adhoc-box").open = true; els.get("a-login").value = "lune_douce"; els.get("a-name").value = "Camille"; els.get("adhoc-add").click(); await wait(500);
  assert.match(els.get("members-sum").textContent, /Camille/); assert.ok(drawn(els).some((t) => /Camille/.test(t)));
  clearLog(els); tick(els, "el-costreamers", false); await wait(300);
  assert.ok(!drawn(els).some((t) => /Camille/.test(t)), "guests removed with their switch"); assert.equal(els.get("item-costreamers").className, "item off");
  // the countdown, turned on, says what it will say; it needs a day
  tick(els, "el-countdown", true);
  assert.match(els.get("countdown-note").textContent, /La vidéo dira/);
  els.get("info-date").value = ""; els.get("info-date").fire("input"); els.get("info-time").value = ""; els.get("info-time").fire("input");
  assert.equal(els.get("countdown-note").textContent, fr.ui_countdown_need, "no day, no countdown");
});

test("\"No event\": the fields of step 2 start empty, the preview shows nothing of the event, and writing the information by hand works end to end", async () => {
  const ctx = mk({ calendar: [slot(1, 5, { games: ["Zelda"] })] });
  const { els } = current = await boot(ctx);
  await go(els, "step-next"); els.get("text").value = "Ma phrase"; els.get("text").fire("input"); els.get("channel").value = "etoile_nord"; els.get("channel").fire("input");
  await go(els, "step-prev");
  clearLog(els); els.get("event-none").click(); await wait(300);
  await go(els, "step-next");
  for (const id of ["info-title", "info-date", "info-time", "info-game"]) assert.equal(els.get(id).value, "", `${id} starts empty`);
  assert.equal(els.get("text").value, "Ma phrase", "the person's own sentence stays"); assert.equal(els.get("channel").value, "etoile_nord");
  for (const e of ["title", "when", "game", "brand", "text", "costreamers"]) assert.equal(els.get(`el-${e}`).checked, true, "the switches keep their value");
  const shownNow = drawn(els);
  assert.ok(!shownNow.some((t) => /Stream 1|Zelda/.test(t)), "nothing of the event is drawn"); assert.ok(shownNow.some((t) => /Ma phrase/.test(t)) && shownNow.some((t) => /etoile_nord/.test(t)), "what remains is drawn");
  assert.equal(els.get("empty").hidden, true);
  els.get("info-title").value = "Soirée découverte"; els.get("info-title").fire("input");
  els.get("info-date").value = "2031-03-04"; els.get("info-date").fire("input"); els.get("info-time").value = "19:30"; els.get("info-time").fire("input");
  els.get("info-game").value = "Hades"; els.get("info-game").fire("input"); await wait(900);
  const t = drawn(els);
  assert.ok(t.some((x) => /Soirée/.test(x)) && t.some((x) => /4 mars/.test(x)) && t.some((x) => /19 h 30/.test(x)) && t.some((x) => /Hades/.test(x)), "title, day, time and game written by hand");
  assert.ok(els.get("generate-now").isDisabled === false);
  // with nothing at all, the preview says there is nothing to show
  for (const e of ["title", "when", "game", "brand", "text", "costreamers"]) tick(els, `el-${e}`, false);
  await wait(400); assert.equal(els.get("empty").hidden, false, "everything removed: nothing to show");
  assert.equal(els.get("generate-now").isDisabled, true); assert.equal(els.get("generate").isDisabled, true);
});

test("a day that is not valid stops the way forward from step 2 (field told, focus on it, typing kept); going back is always allowed", async () => {
  const ctx = mk({ calendar: [slot(1, 5)] });
  const { els } = current = await boot(ctx);
  await go(els, "step-next");
  els.get("info-time").value = "19:30"; els.get("info-time").fire("input"); els.get("info-date").value = ""; els.get("info-date").fire("input");
  await go(els, "step-next");
  assert.deepEqual(shown(els), [2], "still on step 2"); assert.equal(El.focused, "info-date", "the first field in error takes the focus"); assert.equal(els.get("info-time").value, "19:30", "the typing is kept");
  await go(els, "step-btn-3"); assert.deepEqual(shown(els), [2], "the step marker does not go around the check");
  await go(els, "generate-now"); assert.deepEqual(shown(els), [2], "neither does \"Generate now\"");
  await go(els, "step-prev"); assert.deepEqual(shown(els), [1], "back is free");
  await go(els, "step-next"); els.get("info-date").value = "2031-03-04"; els.get("info-date").fire("input");
  await go(els, "step-next"); assert.deepEqual(shown(els), [3]);
});

test("\"Generate now\": generates in the style the preview shows (the plain default until a style is chosen), names it on the button, and the last step then shows that style selected", async () => {
  const ctx = mk({ calendar: [slot(1, 5)] });
  const { els } = current = await boot(ctx);
  assert.equal(els.get("generate-now").textContent, "Générer maintenant, style Minimal / texte seul", "the style is named near the button");
  await go(els, "generate-now"); await wait(300);
  assert.deepEqual(shown(els), [3], "progress and result are on the last step");
  assert.equal(els.get("style-minimal").checked, true, "the style that was seen is the one selected"); assert.equal(styleOf(els), "minimal");
  assert.equal(els.get("status").textContent, fr.ui_err_unsupported, "the creation started (this fake browser cannot encode)");
  // after choosing a style, going back and generating now keeps that style
  els.get("style-poster").checked = true; els.get("style-poster").fire("change"); await wait(200);
  await go(els, "step-btn-2");
  assert.equal(styleOf(els), "poster"); assert.match(els.get("generate-now").textContent, /Affiche qui glisse/);
  await go(els, "generate-now"); await wait(300);
  assert.equal(els.get("style-poster").checked, true); assert.equal(styleOf(els), "poster");
  const en2 = current = (current.server.restore(), await boot(mk({ locale: "en", calendar: [slot(1, 5)] })));
  assert.equal(en2.els.get("generate-now").textContent, "Generate now, Minimal / text only style");
});

test("a model or an assistant preparation opens on the last step (the style), with its own style; a hand-written event of the assistant is not replaced by the next event", async () => {
  const ctx = mk({ calendar: [slot(1, 5)] });
  const out = await def.mcp.story_prepare(ctx, { style: "poster", text: "Prêt", durationSeconds: 9 });
  const { els, server } = current = await boot(ctx, { prep: new URL(out.link).searchParams.get("prep") });
  assert.deepEqual(shown(els), [3], "opens on the style step"); assert.equal(els.get("prep-note").hidden, false);
  assert.equal(els.get("style-poster").checked, true); assert.equal(styleOf(els), "poster", "the style of the preparation is applied at once");
  assert.equal(els.get("text").value, "Prêt"); assert.equal(els.get("duration").value, 9);
  await go(els, "step-btn-2"); assert.equal(els.get("info-title").value, "Stream 1", "the information is there to check"); assert.equal(styleOf(els), "poster");
  server.restore();
  // a preparation without a style: the default card is selected, nothing else changes
  const plain = await def.mcp.story_prepare(ctx, { text: "Sans style" });
  const p2 = current = await boot(ctx, { prep: new URL(plain.link).searchParams.get("prep") });
  assert.deepEqual(shown(p2.els), [3]); assert.equal(styleOf(p2.els), P.DEFAULT_CONFIG.style); p2.server.restore();
  // an event written by the assistant stays, even though an event exists
  const hand = await def.mcp.story_prepare(ctx, { streamTitle: "Soirée découverte", streamDate: "2031-03-04", streamTime: "19:30" });
  const p3 = current = await boot(ctx, { prep: new URL(hand.link).searchParams.get("prep") });
  await go(p3.els, "step-btn-2");
  assert.equal(p3.els.get("info-title").value, "Soirée découverte"); assert.equal(p3.els.get("info-date").value, "2031-03-04"); assert.equal(p3.els.get("info-time").value, "19:30");
  assert.equal(p3.els.get("event-none").attrs["aria-pressed"], "true"); p3.server.restore();
  // no preparation: step 1; a model is loaded from the style step and brings its style
  const b = current = await boot(ctx);
  assert.deepEqual(shown(b.els), [1], "without a preparation: step 1");
  await go(b.els, "step-btn-3");
  b.els.get("model-name").value = "Mon modèle"; b.els.get("models-box").open = true; b.els.get("model-save").click(); await wait(500);
  b.els.get("style-poster").checked = true; b.els.get("style-poster").fire("change");
  b.els.get("style-cinema").checked = true; b.els.get("style-cinema").fire("change");
  await go(b.els, "step-btn-1"); await wait(300);
  assert.equal(styleOf(b.els), "cinema", "a chosen style is kept in the preview of the first steps");
  b.server.restore();
  const c = current = await boot(ctx);
  await go(c.els, "step-btn-3");
  const load = buttons(c.els.get("model-list")).find((x) => x.textContent === fr.ui_load); load.click(); await wait(500);
  assert.deepEqual(shown(c.els), [3], "loading a model keeps the style step"); assert.match(c.els.get("status").textContent, /Modèle « Mon modèle » chargé/);
  assert.equal(c.els.get("style-neon").checked, true, "the model saved with the default style brings it back");
  await go(c.els, "step-btn-1"); assert.equal(styleOf(c.els), P.DEFAULT_CONFIG.style, "a loaded model counts as a chosen style");
});

test("older data stays readable: a stored model or preparation with a style of any of the ten, or with no style at all, opens; unknown values fall back", async () => {
  const ctx = mk({ calendar: [slot(1, 5)] });
  for (const style of ["neon", "minimal", "geometric", undefined, "no-such-style"]) {
    const cfg = P.cleanConfig({ style, elements: ["title", "when"], format: "passeport" });
    const prep = await data.savePrep(ctx, { config: cfg, manual: null });
    const { els, server } = current = await boot(ctx, { prep: prep.pid });
    assert.deepEqual(shown(els), [3], String(style)); assert.equal(styleOf(els), P.STYLES.includes(style) ? style : P.DEFAULT_CONFIG.style, String(style));
    assert.equal(els.get("el-costreamers").checked, false, "the stored elements are respected"); assert.equal(els.get("item-costreamers").className, "item off");
    server.restore();
  }
});

test("keyboard and screen reader: every field has a name, the markers carry aria-current, Enter on Next and Back works as a click, Escape closes the list of events", async () => {
  const ctx = mk({ calendar: [slot(1, 5), slot(2, 30)] });
  const { els, html } = current = await boot(ctx);
  for (const id of ["info-title", "info-date", "info-time", "info-game", "text", "channel", "lang", "duration", "watermark", "safe", "model-name", "event-q"]) assert.match(html, new RegExp(`<label[^>]* for="${id}"`), `${id} has a connected label`);
  for (const e of P.ELEMENTS) assert.match(html, new RegExp(`<[a-z]+ id="lbl-${e}"`), `${e}: a name for its switch`);
  assert.match(html, /<input type="radio" name="style" id="style-neon">/); assert.match(html, /<label for="style-neon" class="stylecard">/);
  assert.match(html, /<canvas class="thumb"[^>]*aria-hidden="true">/, "the thumbnails are decorative: the name and the hint carry the meaning");
  assert.match(html, /<span id="brand-logo" aria-hidden="true">/);
  assert.match(html, /id="info-error"[^>]*role="alert"/);
  // tab order = document order: stepper, preview controls, then the step, then the bar
  const order = ["step-btn-1", "play", "event-change", "step-prev", "step-next", "generate"].map((id) => html.indexOf(`id="${id}"`));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "the order of the code is the order of the keyboard");
  els.get("step-next").fire("keydown", { key: "Enter" }); els.get("step-next").click(); await wait(80);   // Enter on a native button fires a click
  assert.deepEqual(shown(els), [2]); assert.equal(els.get("step-btn-2").attrs["aria-current"], "step");
  els.get("step-prev").click(); await wait(80); assert.deepEqual(shown(els), [1]);
  els.get("event-change").click(); assert.equal(els.get("event-picker").hidden, false);
  els.get("event-picker").fire("keydown", { key: "Escape" }); assert.equal(els.get("event-picker").hidden, true); assert.equal(El.focused, "event-change", "the focus goes back to the button");
});

test("default style: kept on step 3 with one button, then the preview of steps 1-2 and a new video start in it; nothing changes before it is chosen", async () => {
  const ctx = mk({ calendar: [slot(1, 5)] });
  const first = current = await boot(ctx);
  let els = first.els;
  assert.equal(await data.styleDefault(ctx), null, "nothing remembered at first");
  await go(els, "step-next"); await go(els, "step-next"); await wait(300);
  assert.equal(els.get("default-style").disabled, true === (P.DEFAULT_CONFIG.style === null), "the button is offered for the shown style");
  assert.equal(els.get("default-style").textContent, fr.ui_default_use);
  els.get("style-cinema").checked = true; els.get("style-cinema").fire("change"); await wait(200);
  await go(els, "default-style"); await wait(200);
  assert.equal(await data.styleDefault(ctx), "cinema", "remembered on the server");
  assert.equal(els.get("default-style").disabled, true); assert.equal(els.get("default-style").textContent, fr.ui_default_is);
  assert.equal(els.get("default-note").hidden, false);
  els.get("style-poster").checked = true; els.get("style-poster").fire("change"); await wait(100);
  assert.equal(els.get("default-style").disabled, false, "another style can become the default");
  first.server.restore(); current = null;
  // a new session: the preview of steps 1 and 2 and the style of a new video are the default style
  current = await boot(ctx); els = current.els;
  assert.equal(styleOf(els), "cinema", "step 1 preview"); assert.equal(els.get("pv-note").hidden, true, "no 'plain preview' note: it is not plain");
  await go(els, "step-next"); await wait(200); assert.equal(styleOf(els), "cinema", "step 2 preview");
  await go(els, "step-next"); await wait(300);
  assert.equal(els.get("style-cinema").checked, true, "step 3 starts on the default style");
  els.get("style-kinetic").checked = true; els.get("style-kinetic").fire("change"); await wait(200);
  assert.equal(styleOf(els), "kinetic", "this video can still use another style");
});

test("default style: the Countdown style as default also ticks the countdown line; a bad value is refused", async () => {
  const ctx = mk({ calendar: [slot(1, 5)] });
  assert.deepEqual(await data.setStylePref(ctx, "nope"), { error: "invalid" });
  assert.equal(await data.styleDefault(ctx), null);
  await data.setStylePref(ctx, "countdown");
  current = await boot(ctx);
  assert.equal(current.els.get("el-countdown").checked, true);
});


test("My styles: the saved variants are more cards after the twelve (none: no group), choosing one previews its base style, it can be the default (with the style), and a deleted one falls back to the base style without any error", async () => {
  const ctx = mk({ calendar: [slot(1, 5)] });
  let first = current = await boot(ctx), els = first.els;
  assert.equal(els.get("variant-box").hidden, true, "no variant: no group");
  first.server.restore(); current = null;
  const a = (await data.saveVariant(ctx, { name: "Night", base: "cinema", accent: "#ffb000" })).item, b = (await data.saveVariant(ctx, { name: "Paper day", base: "geometric", bg: "#f5efe3" })).item;
  first = current = await boot(ctx); els = first.els;
  assert.equal(els.get("variant-box").hidden, false);
  const cards = els.get("variant-cards").children.filter((c) => c.tagName === "label");
  assert.deepEqual(cards.map((c) => c.textContent), [`Night${fr.ui_variant_hint.replace("{style}", fr.ui_style_cinema)}`, `Paper day${fr.ui_variant_hint.replace("{style}", fr.ui_style_geometric)}`], "a name and its base style, like the other cards");
  assert.deepEqual(cards.map((c) => c.attrs.for), [`variant-${a.id}`, `variant-${b.id}`]);
  await go(els, "step-next"); await go(els, "step-next"); await wait(300);
  assert.equal(els.get("default-style").disabled, false);
  els.get(`variant-${a.id}`).checked = true; els.get(`variant-${a.id}`).fire("change"); await wait(300);
  assert.equal(styleOf(els), "cinema", "the preview draws the base style (in the colours of the variant)");
  assert.equal(els.get("style-cinema").checked, false, "the base card is not also checked: one choice"); assert.equal(els.get(`variant-${a.id}`).checked, true);
  await go(els, "default-style"); await wait(300);
  assert.equal(await data.readVariantPref(ctx), a.id); assert.equal(await data.styleDefault(ctx), "cinema");
  assert.equal(els.get("default-style").disabled, true, "this variant is now the default");
  els.get("style-cinema").checked = true; els.get("style-cinema").fire("change"); await wait(200);
  assert.equal(els.get("default-style").disabled, false, "the base style alone is not the default: the variant is");
  first.server.restore(); current = null;
  // a new session: the default variant is the one of a new video and of the preview of steps 1 and 2
  current = await boot(ctx); els = current.els;
  assert.equal(styleOf(els), "cinema", "step 1 preview in the default style");
  await go(els, "step-next"); await go(els, "step-next"); await wait(300);
  assert.equal(els.get(`variant-${a.id}`).checked, true, "a new video starts on the default variant"); assert.equal(els.get("style-cinema").checked, false);
  current.server.restore(); current = null;
  // deleted since: the default is its base style, nothing breaks
  await data.removeVariant(ctx, a.id);
  current = await boot(ctx); els = current.els;
  assert.equal(styleOf(els), "cinema", "the base style is still the default");
  await go(els, "step-next"); await go(els, "step-next"); await wait(300);
  assert.equal(els.get("style-cinema").checked, true, "the base card is checked: a clean fallback");
  assert.equal(els.get("variant-box").hidden, false); assert.equal(els.get("variant-cards").children.filter((c) => c.tagName === "label").length, 1);
});

test("show the day: a tick box on step 2 (ticked = as before), unticking shows the time alone in the preview, the module setting is its starting value, a saved model remembers it", async () => {
  const ctx = mk({ calendar: [slot(1, 5)] });
  current = await boot(ctx); let els = current.els;
  assert.equal(els.get("show-day").checked, true, "default: the day and the time, as before");
  const day = (e) => drawn(e).some((t) => new RegExp(fr.ui_style_neon && "(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)", "i").test(t));
  assert.equal(day(els), true);
  els.get("preview").getContext().log.length = 0;   // the log keeps every drawing since the start: begin a new one
  els.get("show-day").checked = false; els.get("show-day").fire("change"); await wait(400);
  assert.equal(day(els), false, "the day is gone from the preview"); assert.ok(drawn(els).some((t) => /\d[ :h]\d\d|\d{1,2}:\d\d|\d h \d\d/.test(t)), "the time stays");
  await go(els, "step-next"); await go(els, "step-next"); await wait(200);
  els.get("model-name").value = "Same day"; els.get("model-name").fire("input"); await go(els, "model-save"); await wait(300);
  assert.equal((await data.readModels(ctx))[0].config.showDay, false, "the model remembers it");
  current.server.restore(); current = null;
  const off = mk({ calendar: [slot(1, 5)], settings: { showDay: false } });
  current = await boot(off); els = current.els;
  assert.equal(els.get("show-day").checked, false, "the module setting is the starting value");
  els.get("preview").getContext().log.length = 0;
  els.get("show-day").checked = true; els.get("show-day").fire("change"); await wait(400);
  assert.equal(day(els), true, "this video asks for the day: it wins over the setting");
});
