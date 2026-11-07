// The editor of "Announcement story" (page served by the `studio` route, in the administration panel). Everything that is displayed is written with `textContent` (never HTML);
// the video is drawn with `fillText` on a canvas. The sentences come from locales/ (`ui_…` keys, passed by the server in #story-config).
import * as P from "./pure.mjs";
import { createScene } from "./scenes.mjs";
import { detectCapabilities, renderVideo } from "./encode.mjs";

const C = JSON.parse(document.getElementById("story-config").textContent);
const L = (k, vars) => String(C.labels[k] ?? k).replace(/\{(\w+)\}/g, (m, n) => (vars && vars[n] !== undefined ? vars[n] : m));
const $ = (id) => document.getElementById(id);
const frag = new URLSearchParams(location.hash.slice(1));
const TOKEN = frag.get("t") || "", PREP = frag.get("p") || "";
try { history.replaceState(null, "", location.pathname + location.search); } catch { /* not important */ }
const BROWSER_TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "UTC"; } })();
const TZ = P.validZone(C.timezone) ? C.timezone : P.validZone(BROWSER_TZ) ? BROWSER_TZ : "UTC";
const REDUCED = (() => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } })();

/* ───────────── Small tools ───────────── */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k === "class") el.className = v; else if (k === "text") el.textContent = v; else if (k.startsWith("on")) el.addEventListener(k.slice(2), v); else if (v === true) el.setAttribute(k, ""); else el.setAttribute(k, String(v));
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
let announceTimer = null;
function say(text, kind) {
  const box = $("status"); box.textContent = text || ""; box.className = `status ${kind || ""}`; box.hidden = !text;
  clearTimeout(announceTimer); if (text && kind !== "error") announceTimer = setTimeout(() => { box.hidden = true; }, 9000);
}
async function api(path, { method = "GET", body, ms = 15000 } = {}) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(`${C.base}/${path}`, { method, headers: { "X-Story-Token": TOKEN, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal, cache: "no-store" });
    if (res.status === 401) return { ok: false, error: "auth" };
    return await res.json();
  } catch { return { ok: false, error: "network" }; } finally { clearTimeout(timer); }
}
const errText = (e) => L(`err_${["auth", "network", "empty", "invalid", "full", "missing", "name", "exists", "image"].includes(e) ? e : "generic"}`);

/* ───────────── The state ───────────── */
const S = {
  cfg: P.cleanConfig({ ...P.DEFAULT_CONFIG, lang: C.lang === "en" ? "en" : "fr" }),
  ev: { partners: [], items: [], next: null, total: 0, totalAll: 0, sources: [], state: "loading", q: "", source: "", seq: 0, selected: null, busy: false },
  // The editable information (step 2): copied from the event that is picked, or empty for "no event". `cov`: the cover of the game written in `info.game`.
  info: { title: "", date: "", time: "", game: "" }, noEvent: false, cov: { game: "", url: "", state: "", ambiguous: false, title: "", found: "" },
  known: new Map(), adhoc: [], contacts: "loading", search: { items: [], shown: 10 }, searchSeq: 0, cat: { id: "", items: [], next: null }, catList: { items: [], next: null, loaded: false }, catSeq: 0, models: [], brand: { name: "", logo: "" },
  images: new Map(), autoTicked: "", thumbAssets: null, step: 1, visited: new Set([1]), pickerOpen: false, defaultId: "", styleChosen: false, scene: null, nowMs: Date.now(), t: 0, playing: !REDUCED, last: 0, showSafe: false, building: 0, job: null, confirm: null, editing: null,
};
const mctx = document.createElement("canvas").getContext("2d");
const colors = C.colors;

/** The stream the video is made from: the picked event (or nothing) with the information of step 2 on top of it. `error`: "date" or "time" when the day written is not valid. */
const streamNow = () => {
  const r = P.streamFromInfo(S.info, { base: S.noEvent ? null : S.ev.selected, tz: TZ });
  if (r.stream && r.stream.games[0] && S.cov.game === r.stream.games[0]) r.stream.cover = S.cov.url;
  return r;
};
const selectedStream = () => streamNow().stream;
/** The style drawn in the preview: the default editing style until a style is chosen (steps 1 and 2); on the last step, the style of the cards. */
const previewStyle = () => (S.step === 3 || S.styleChosen ? S.cfg.style : P.EDIT_STYLE);
/* The guest streamers of the video: each entry is { id } (a Contacts card, read when needed) or a "for this video only" entry. `key`: what tells them apart. */
const keyOf = P.memberKey;
const viewOf = (entry) => (entry.id
  ? S.known.get(`id:${entry.id}`) ?? { key: `id:${entry.id}`, state: "loading", name: "", login: "", image: "", accounts: [] }
  : { key: keyOf(entry), state: "ok", name: entry.name || entry.login, login: entry.login, image: entry.image, accounts: [], inline: true });
// The guest streamers of the video: the ones the person chose, then the ones the schedule lists for this stream (no duplicates, same handle = same person).
const chosenMembers = () => {
  const mine = S.cfg.costreamers.map(viewOf).filter((m) => m.state === "ok").map((m) => ({ login: m.key, name: m.name, image: m.image }));
  if (S.cfg.schedulePeople === false || S.noEvent) return mine;
  const seen = new Set(S.cfg.costreamers.map(viewOf).flatMap((m) => [m.login, m.name].filter(Boolean).map((x) => String(x).toLowerCase())));
  return [...mine, ...S.ev.partners.filter((p) => !seen.has(p.login))];
};
const zoneOf = (stream) => (stream && P.validZone(stream.timezone) ? stream.timezone : TZ);

/* ───────────── Images ───────────── */
function loadImage(url) {
  if (!url) return Promise.resolve(null);
  if (S.images.has(url)) return S.images.get(url);
  const job = new Promise((resolve) => {
    const done = (v) => resolve(v);
    const timer = setTimeout(() => done(null), 9000);
    const finish = (v) => { clearTimeout(timer); done(v); };
    const img = new Image();
    img.onload = () => finish(img); img.onerror = () => finish(null);
    if (url.startsWith("/")) { img.src = url; return; }
    // an image from elsewhere goes through the site's relay (same address as the page: the canvas stays "clean")
    fetch(`${C.base}/img?u=${encodeURIComponent(url)}`, { headers: { "X-Story-Token": TOKEN } })
      .then((r) => (r.ok ? r.blob() : null)).then((b) => { if (!b) return finish(null); img.src = URL.createObjectURL(b); }).catch(() => finish(null));
  });
  S.images.set(url, job);
  if (S.images.size > 80) S.images.delete(S.images.keys().next().value); // bounded: not every photo seen is kept
  return job;
}

/* ───────────── The "Curiosa" wordmark font ───────────── */
// The site logo sets "Curiosa" in Fraunces italic 600: the file comes from the module (`wordmark` route), is loaded by FontFace and must be READY before the first drawing (otherwise the canvas
// silently takes a fallback font). Short delay (3 s): if it fails or is slow, Georgia italic takes over and the video is made anyway.
let fontJob = null;
function loadWordmarkFont() {
  fontJob ??= (async () => {
    try {
      if (typeof FontFace !== "function" || !document.fonts) return false;
      const work = (async () => {
        const res = await fetch(`${C.base}/wordmark`); if (!res.ok) return false;
        const face = new FontFace(P.WORDMARK.family, await res.arrayBuffer(), { style: "italic", weight: String(P.WORDMARK.weight) });
        await face.load(); document.fonts.add(face); return true;
      })();
      return await Promise.race([work, new Promise((r) => setTimeout(() => r(false), 3000))]);
    } catch { return false; }
  })();
  return fontJob;
}

/* ───────────── The scene and the preview ───────────── */
function contentNow() {
  const stream = selectedStream();
  return { stream, content: P.buildContent(S.cfg, { stream, coStreamers: chosenMembers(), site: { name: S.brand.name }, nowMs: S.nowMs, tz: TZ }) };
}
async function buildScene(nowMs = Date.now(), style = previewStyle()) {
  const mine = ++S.building;
  S.nowMs = nowMs;
  const wordmarkOk = S.cfg.watermark === true && (await loadWordmarkFont());
  const { stream, content } = contentNow();
  const members = chosenMembers();
  const [logo, cover, ...av] = await Promise.all([
    S.cfg.elements.includes("brand") ? loadImage(S.brand.logo) : null, S.cfg.elements.includes("game") && stream?.games?.[0] && stream.cover ? loadImage(stream.cover) : null,
    ...members.map((m) => (S.cfg.elements.includes("costreamers") ? loadImage(m.image) : null)),
  ]);
  if (mine !== S.building) return null;
  const avatars = Object.fromEntries(members.map((m, i) => [m.login, av[i]]));
  const scene = createScene({ style, format: S.cfg.format, duration: S.cfg.duration, content, assets: { logo, cover, avatars }, colors, font: C.font, measureContext: mctx, watermark: S.cfg.watermark === true, wordmarkFont: wordmarkOk ? P.WORDMARK.family : "" });
  S.thumbAssets = { logo, cover, avatars };   // the same images serve the thumbnails of the style picker
  return { scene, style, empty: !(content.title || content.dayLine || content.timeLine || content.countdown || content.game || content.brand || content.text || content.costreamers.length) };
}
let rebuildTimer = null;
function rebuild() { clearTimeout(rebuildTimer); rebuildTimer = setTimeout(async () => { const r = await buildScene(); if (!r) return; S.scene = r.scene; S.empty = r.empty; $("preview").dataset.style = r.style; sizePreview(); S.t = Math.min(S.t, r.scene.duration); if (!S.playing) S.t = Math.min(r.scene.restTime, r.scene.duration); updateInfo(); drawPreview(); scheduleThumbs(); }, 140); }
/* ───────────── The style picker: one live thumbnail per style ───────────── */
/** Each card shows the real scene of the style, at the instant when everything is in place (`restTime`), with the current content and images: it is cheap (one small image per style). */
let thumbTimer = null, thumbDirty = true;
function scheduleThumbs() { thumbDirty = true; clearTimeout(thumbTimer); if (S.step !== 3) return; thumbTimer = setTimeout(renderThumbs, 160); }
function renderThumbs() {
  if (!thumbDirty || !S.thumbAssets) return;
  thumbDirty = false;
  const stream = selectedStream(), fmt = P.formatOf(S.cfg.format);
  for (const cv of document.querySelectorAll("canvas.thumb")) {
    const st = cv.dataset.style; if (!P.STYLES.includes(st)) continue;
    try {
      const content = P.buildContent({ ...S.cfg, style: st, elements: P.elementsForStyle(st, S.cfg.elements) }, { stream, coStreamers: chosenMembers(), site: { name: S.brand.name }, nowMs: S.nowMs, tz: TZ });
      const sc = createScene({ style: st, format: S.cfg.format, duration: S.cfg.duration, content, assets: S.thumbAssets, colors, font: C.font, measureContext: mctx });
      cv.width = 108; cv.height = Math.round(108 * fmt.height / fmt.width); cv.style.aspectRatio = `${fmt.width} / ${fmt.height}`;
      const ctx = cv.getContext("2d"); ctx.setTransform(cv.width / sc.width, 0, 0, cv.height / sc.height, 0, 0); sc.draw(ctx, sc.restTime);
    } catch { /* a thumbnail that fails stays empty: the name and the sentence are enough */ }
  }
}
/** Choosing a style (the cards of the last step, or "Generate now" which keeps the style of the preview). The "countdown" style needs the countdown element: it is ticked for the person, with a visible sentence, and unticked if they change style without having touched it. */
function chooseStyle(st) {
  const prev = S.cfg.style, need = P.STYLE_NEEDS[st];
  S.cfg.style = st; S.styleChosen = true;
  for (const s of P.STYLES) $(`style-${s}`).checked = s === st;
  if (need && !S.cfg.elements.includes(need)) { S.cfg.elements = P.elementsForStyle(st, S.cfg.elements); S.autoTicked = need; $(`el-${need}`).checked = true; }
  else if (S.autoTicked && !need && P.STYLE_NEEDS[prev] === S.autoTicked) { S.cfg.elements = S.cfg.elements.filter((e) => e !== S.autoTicked); $(`el-${S.autoTicked}`).checked = false; S.autoTicked = ""; }
  renderItems(); renderStyleNote(); renderCoverWarn(); renderSteps(); rebuild();
}
function renderStyleNote() { const n = $("style-note"); n.textContent = S.autoTicked && S.cfg.style === "countdown" ? L("style_countdown_on") : ""; n.hidden = !n.textContent; }
function sizePreview() {
  const cv = $("preview"), s = S.scene; if (!s) return;
  const k = 0.5; cv.width = Math.round(s.width * k); cv.height = Math.round(s.height * k); cv.style.aspectRatio = `${s.width} / ${s.height}`;
  cv.setAttribute("aria-label", L("preview_label"));
}
function drawSafe(ctx, fmt) {
  ctx.save();
  for (const z of fmt.zones) {
    ctx.fillStyle = "rgba(230,40,60,0.26)"; ctx.fillRect(z.x, z.y, z.w, z.h);
    ctx.save(); ctx.beginPath(); ctx.rect(z.x, z.y, z.w, z.h); ctx.clip(); ctx.strokeStyle = "rgba(255,255,255,0.55)"; ctx.lineWidth = 4; ctx.beginPath();
    for (let k = -z.h; k < z.w + z.h; k += 36) { ctx.moveTo(z.x + k, z.y); ctx.lineTo(z.x + k - z.h, z.y + z.h); }
    ctx.stroke(); ctx.restore();
    ctx.fillStyle = "#ffffff"; ctx.strokeStyle = "rgba(0,0,0,0.85)"; ctx.lineWidth = 8; ctx.font = "800 34px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const label = L(z.id === "ui" ? "zone_ui" : "zone_grid");
    if (z.w > z.h) { ctx.strokeText(label, z.x + z.w / 2, z.y + z.h / 2); ctx.fillText(label, z.x + z.w / 2, z.y + z.h / 2); }
    else { ctx.save(); ctx.translate(z.x + z.w / 2, fmt.height / 2); ctx.rotate(-Math.PI / 2); ctx.font = "800 24px system-ui, sans-serif"; ctx.strokeText(label, 0, 0); ctx.fillText(label, 0, 0); ctx.restore(); }
  }
  ctx.restore();
}
function drawPreview() {
  const s = S.scene; if (!s) return;
  const cv = $("preview"), ctx = cv.getContext("2d"), k = cv.width / s.width;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  s.draw(ctx, S.t);
  if (S.showSafe) drawSafe(ctx, P.formatOf(S.cfg.format));
  $("time").textContent = `${S.t.toFixed(1)} / ${s.duration} s`;
}
function loop(now) {
  if (S.playing && S.scene) { const dt = S.last ? (now - S.last) / 1000 : 0; S.t += dt; if (S.t >= S.scene.duration) S.t = 0; drawPreview(); }
  S.last = now; requestAnimationFrame(loop);
}
function setPlaying(on) {
  S.playing = on; S.last = 0;
  $("play").textContent = L(on ? "pause" : "play"); $("play").setAttribute("aria-pressed", on ? "true" : "false");
  if (!on) drawPreview();
}

/* ───────────── The elements of the editor ───────────── */
const FIRST_PAGE = 5, NEXT_PAGE = 10, SEARCH_FROM = 8;   // a short list; the search only appears when there are many
const ELEMENT_KEYS = P.ELEMENTS;
const kindOf = (k) => (P.SOURCE_KIND.test(String(k)) ? String(k) : "other");
const typeLabel = (t) => L(`type_${["stream", "live", "premiere", "video", "event"].includes(t) ? t : "other"}`);
/** The date of an event, readable, in the site's time zone (or the setting's); in brackets the local time when it is different. */
function whenText(e) {
  const day = P.formatDay(e.startMs, TZ, C.lang);
  if (e.allDay) return day;
  let text = `${day} · ${P.formatTime(e.startMs, TZ, C.lang)}`;
  if (P.validZone(e.timezone) && e.timezone !== TZ) { const there = P.formatTime(e.startMs, e.timezone, C.lang); if (there !== P.formatTime(e.startMs, TZ, C.lang)) text += ` (${L("event_local", { time: there })})`; }
  return text;
}
function pill(kind, label) { return h("span", { class: `src src-${kindOf(kind)}`, text: label }); }

function renderEventChosen() {
  const box = $("event-chosen"), e = S.noEvent ? null : S.ev.selected, same = $("event-same");
  same.hidden = true;
  if (!e) { box.replaceChildren(h("span", { class: S.noEvent ? "ttl2" : "", text: L(S.noEvent ? "event_none_chosen" : "event_loading") })); return; }
  const isNext = e.id === S.defaultId && P.isUpcoming(e, Date.now(), TZ), started = !P.isUpcoming(e, Date.now(), TZ);
  box.replaceChildren(h("span", { class: "lead" }, L("event_chosen"), " ", isNext ? h("span", { class: "badge", text: L("event_next") }) : null, started ? h("span", { class: "tag", text: L("event_started") }) : null),
    h("span", { class: "ttl2", text: e.title || L("untitled") }),
    h("span", { class: "when" }, pill(e.source, e.sourceLabel), " ", typeLabel(e.type), " · ", whenText(e)));
  const twins = S.ev.items.filter((x) => x.id !== e.id && x.startMs === e.startMs && x.allDay === e.allDay).slice(0, 3);
  same.hidden = !twins.length; same.textContent = twins.length ? L("event_same", { titles: twins.map((x) => x.title || L("untitled")).join(", ") }) : "";
}

function renderFilter() {
  const box = $("event-filter"), shown = S.ev.sources.filter((x) => x.count > 0 || x.kind === S.ev.source);
  box.hidden = shown.length < 2 && !S.ev.source;
  box.replaceChildren(...(box.hidden ? [] : [
    h("button", { type: "button", "aria-pressed": S.ev.source ? "false" : "true", text: L("event_all"), onclick: () => { S.ev.source = ""; loadEvents(false); } }),
    ...shown.map((x) => h("button", { type: "button", "aria-pressed": S.ev.source === x.kind ? "true" : "false", text: `${x.label} (${x.count})`, onclick: () => { S.ev.source = S.ev.source === x.kind ? "" : x.kind; loadEvents(false); } })),
  ]));
}

function renderEventList() {
  const list = $("event-list"), E = S.ev, picked = !S.noEvent && E.selected ? E.selected.id : "";
  list.replaceChildren(...E.items.map((e) => {
    const also = e.alsoIn.length ? h("span", { class: "more", text: L("event_also", { sources: e.alsoIn.map((x) => x.label).join(", ") }) }) : null;
    const on = e.id === picked || (picked && e.ids?.includes?.(picked));
    const row = h("button", { type: "button", class: "event", "aria-pressed": on ? "true" : "false", "aria-label": L("event_row", { title: e.title || L("untitled"), when: whenText(e) }), onclick: () => pickEvent(e) },
      h("span", { class: "top" }, pill(e.source, e.sourceLabel), h("span", { text: typeLabel(e.type) }), h("span", { text: whenText(e) }), on ? h("strong", { text: L("event_picked") }) : null, P.isUpcoming(e, Date.now(), TZ) ? null : h("em", { class: "tag", text: L("event_started") })),
      h("span", { class: "ttl", text: e.title || L("untitled") }), also);
    return h("li", {}, row);
  }));
  $("event-count").textContent = E.items.length ? L("event_count", { shown: E.items.length, total: E.total }) + (E.totalAll >= 200 && !E.q && !E.source ? ` · ${L("event_capped")}` : "") : "";
  $("event-more").hidden = !E.next; $("event-more").disabled = E.busy; $("event-more").textContent = L(E.busy && E.more ? "busy_reading" : "event_more"); $("event-more").setAttribute("aria-busy", E.busy && E.more ? "true" : "false");
  $("event-search-box").hidden = !(E.totalAll > SEARCH_FROM || E.q || E.source);
}

function renderNotes() {
  const E = S.ev, box = $("event-sources"), alert = $("event-alert"), note = $("event-note");
  note.textContent = ""; $("event-match").textContent = "";
  box.replaceChildren(); alert.replaceChildren();
  const retry = $("event-retry");
  if (E.state === "loading") { note.textContent = L("event_loading"); retry.hidden = true; return; }
  const down = E.sources.filter((x) => x.state === "down");
  retry.hidden = !down.length;
  if (E.state === "slow") alert.append(h("p", { class: "warn", text: L("event_all_down") }));
  else if (!E.total && !E.q && !E.source) note.textContent = L("event_none");
  else if (!E.total) $("event-match").textContent = L("event_no_match");
  for (const x of E.sources) {
    if (x.state === "down" && E.state !== "slow") alert.append(h("p", { class: "warn", text: L(x.stale ? "ev_down_stale" : "ev_down", { source: x.label }) }));
    else if (x.state === "setup" && x.message) box.append(h("p", { class: "warn", text: L("ev_setup", { source: x.label, message: x.message }) }));
    else if (x.state === "ok" && x.note) box.append(h("p", { class: "muted", text: L("ev_note", { source: x.label, note: x.note }) }));
  }
  box.append(h("p", { class: "muted", text: L("event_zone", { zone: TZ }) }));
}

function renderEvents() {
  renderCoverWarn();
  renderEventChosen(); renderFilter(); renderEventList(); renderNotes();
  const bare = S.ev.state !== "loading" && !S.ev.totalAll && !S.ev.q && !S.ev.source;   // nothing to choose from: no list, no "pick another event"
  const open = S.pickerOpen && !bare;
  $("event-picker").hidden = !open;
  $("event-change").textContent = L(open ? "event_change_close" : S.noEvent ? "event_pick" : "event_change");
  $("event-change").setAttribute("aria-expanded", open ? "true" : "false");
  $("event-change").hidden = bare;
  $("event-none").setAttribute("aria-pressed", S.noEvent ? "true" : "false");
}
function togglePicker(on) {
  S.pickerOpen = on ?? !S.pickerOpen;
  renderEvents();
  try { if (S.pickerOpen) $("h-pick").focus?.(); else $("event-change").focus?.(); } catch { /* not important */ }
}
const renderStreamPicker = renderEvents;

/** Chooses an event from the list: the information of step 2 fills itself in from it, and the choice (identifier + source) is kept in the settings of the request. */
function pickEvent(e, { quiet = false, auto = false } = {}) {
  S.noEvent = false;
  S.ev.selected = { ...e };
  S.info = P.infoFromStream(e, TZ);
  if (auto) S.defaultId = e.id;
  S.cfg.eventId = e.id; S.cfg.eventSource = kindOf(e.source); S.cfg.streamKey = e.legacyKey || "";
  S.ev.partners = [];
  const wasOpen = S.pickerOpen; S.pickerOpen = false;
  renderEvents(); renderInfo(); syncCover({ now: true }); rebuild();
  if (!quiet) {
    say(L("event_ready", { title: e.title || L("untitled") }), "ok");
    try { if (wasOpen) $("event-change").focus?.(); } catch { /* not important */ }   // the work in progress (style, sentence, guest streamers…) is not touched: only the event, and what comes from it, changes
  }
  if (e.partners?.length) loadPartners(e);
}
/** "No event": the information of step 2 starts empty (the sentence, the channel name and the guest streamers you chose are yours, they stay). */
function chooseNoEvent({ quiet = false } = {}) {
  S.noEvent = true; S.ev.selected = null; S.ev.partners = [];
  S.info = P.infoFromStream(null);
  S.cfg.eventId = ""; S.cfg.eventSource = ""; S.cfg.streamKey = "";
  S.pickerOpen = false;
  renderEvents(); renderInfo(); syncCover({ now: true }); renderMembers(); rebuild();
  if (!quiet) say(L("event_none_set"), "ok");
}
/** The people of the schedule for this event (name + photo of a displayable Contacts card); with no answer, the video is made without them. */
async function loadPartners(e) {
  const r = await api(`partners?logins=${encodeURIComponent(e.partners.join(","))}`, { ms: 15000 });
  if (!r.ok || S.ev.selected?.id !== e.id) return;
  S.ev.partners = (Array.isArray(r.items) ? r.items : []).map((p) => ({ login: String(p.login), name: String(p.name || p.login), image: String(p.image || "") }));
  if (S.ev.partners.length) { renderMembers(); rebuild(); }
}
/** The cover of the game written in step 2 (found by the site; the game of the event, or whatever the person types). A short delay while typing; a single new try if the site's copy is not ready yet. */
let coverTimer = null;
const blankCover = () => ({ game: "", url: "", state: "", ambiguous: false, title: "", found: "" });
function syncCover({ now = false } = {}) {
  const game = P.oneLine(S.info.game, 80);
  if (game === S.cov.game) return;   // the cover of this game is already asked for (or known)
  clearTimeout(coverTimer);
  S.cov = { ...blankCover(), game };
  renderCoverWarn(); renderInfo();
  if (game) coverTimer = setTimeout(() => loadCover(game), now ? 0 : 600);
}
async function loadCover(game, retry = true) {
  const r = await api(`cover?game=${encodeURIComponent(game)}`, { ms: 12000 });
  if (!r.ok || S.cov.game !== game) return;
  // the site's copy of the cover may not be ready at the very first request: a single new try, a little later
  if (!r.cover && r.coverState === "down" && retry) { await new Promise((ok) => setTimeout(ok, 2500)); if (S.cov.game === game) return loadCover(game, false); return; }
  S.cov = { game, url: r.cover || "", state: r.coverState || "", ambiguous: r.ambiguous === true && !!r.cover, title: String(r.title || ""), found: String(r.found || "") };
  if (r.cover) rebuild();
  renderInfo(); renderCoverWarn();
}
/** The core's stable link to the screen that lets you choose the right game (the title is encoded). */
const wrongCoverHref = (title) => `/admin/settings/rawg-covers?titre=${encodeURIComponent(title)}`;
/** Before making the video: if the cover may be the one of another game, say so, with the link. Never blocks the video. */
function renderCoverWarn() {
  const c = S.cov, boxes = [$("cover-warn"), $("cover-warn-3")];
  const show = c.ambiguous && c.title && c.game && S.cfg.elements.includes("game");
  for (const box of boxes) {
    box.replaceChildren(); box.hidden = !show;
    if (!show) continue;
    box.append(h("span", { text: `${L(c.found ? "cover_ambiguous_named" : "cover_ambiguous", { game: c.title, found: c.found })} ` }),
      h("a", { href: wrongCoverHref(c.title), target: "_blank", rel: "noopener", text: L("cover_wrong") }));
  }
}

/** Reads the list (`more`: the next page). Answers that arrive late from a previous search are ignored. */
async function loadEvents(more, { fresh = false, id = "", key = "" } = {}) {
  const E = S.ev, mine = ++E.seq;
  E.busy = true; E.more = !!more; if (!more) { E.state = E.items.length ? E.state : "loading"; } renderEventList(); renderNotes();
  const qs = new URLSearchParams({ limit: String(more ? NEXT_PAGE : FIRST_PAGE) });
  if (E.q) qs.set("q", E.q);
  if (E.source) qs.set("source", E.source);
  if (more && E.next) qs.set("cursor", E.next);
  if (fresh) qs.set("fresh", "1");
  if (id) qs.set("id", id);
  if (key) qs.set("key", key);
  const r = await api(`events?${qs}`, { ms: 20000 });
  if (mine !== E.seq) return r;
  E.busy = false;
  if (r.error === "auth") { $("app").hidden = true; $("noaccess").hidden = false; return r; }
  if (!r.ok) { E.state = "slow"; E.sources = E.sources.length ? E.sources : []; renderEvents(); return r; }
  E.items = more ? [...E.items, ...r.items].filter((e, i, all) => all.findIndex((x) => x.id === e.id) === i).slice(0, 200) : r.items;
  E.next = r.next; E.total = r.total; E.totalAll = r.totalAll; E.sources = r.sources;
  E.state = r.totalAll || r.sources.some((x) => x.state !== "down") ? "ok" : "slow";
  renderEvents();
  return r;
}
let eventTimer = null;
function onEventSearch() { clearTimeout(eventTimer); eventTimer = setTimeout(() => { S.ev.q = $("event-q").value.trim().slice(0, 80); loadEvents(false); }, 280); }

/* ───────────── The guest streamers ───────────── */
const NET = { twitch: "Twitch", youtube: "YouTube", tiktok: "TikTok", instagram: "Instagram", discord: "Discord", x: "X", bluesky: "Bluesky", mastodon: "Mastodon" };
const netName = (n) => NET[n] ?? L(n === "web" ? "net_web" : "net_other");
const isFull = () => S.cfg.costreamers.length >= P.LIMITS.costreamers;
const inVideo = (key) => S.cfg.costreamers.some((e) => keyOf(e) === key);

/** A round badge: the photo (read through the site's relay) or, failing that, the initials. */
function thumb(image, name) {
  const box = h("span", { class: "avatar", "aria-hidden": "true", text: P.initials(name) });
  if (image) loadImage(image).then((img) => { if (img) { const i = new Image(); i.alt = ""; i.src = img.src; box.replaceChildren(i); } });
  return box;
}
/** A row for a person: photo, name, account pills (or handle), then the given buttons. */
function personRow(m, ...actions) {
  const pills = m.accounts?.length ? h("span", { class: "pills" }, m.accounts.slice(0, 6).map((a) => h("span", { class: "pill", text: `${netName(a.network)} · ${a.label || a.handle}` }))) : (m.login && m.login !== m.name ? h("span", { class: "muted", text: m.login }) : null);
  return h("li", { class: "row" }, h("span", { class: "person" }, thumb(m.image, m.name || m.login), h("span", { class: "who" }, h("strong", { text: m.name || m.login }), m.inline ? h("em", { class: "tag", text: L("only_this_video") }) : null, m.tag ? h("em", { class: "tag", text: m.tag }) : null, pills)), ...actions);
}
function remember(items) { for (const m of items) S.known.set(`id:${m.id}`, { key: `id:${m.id}`, state: "ok", name: m.name, login: m.login, image: m.image, accounts: m.accounts ?? [] }); }
function addEntry(entry) {
  if (isFull() || inVideo(keyOf(entry))) return false;
  S.cfg.costreamers.push(entry);
  return true;
}
function addButton(entry, label) {
  const has = inVideo(keyOf(entry));
  return h("button", { type: "button", text: L(has ? "already" : "add"), disabled: has || isFull(), "aria-label": `${L(has ? "already" : "add")} ${label}`, onclick: () => { if (addEntry(entry)) { renderMembers(); rebuild(); } } });
}

function renderChosen() {
  const rows = S.cfg.costreamers.map((e) => {
    const m = viewOf(e), name = m.name || m.login || "";
    const remove = h("button", { type: "button", text: L("remove"), "aria-label": `${L("remove")} ${name}`, onclick: () => { S.cfg.costreamers = S.cfg.costreamers.filter((x) => keyOf(x) !== keyOf(e)); renderMembers(); rebuild(); } });
    if (m.state !== "ok") return h("li", { class: "row" }, h("span", { class: `grow ${m.state === "missing" ? "warn" : "muted"}`, text: L(m.state === "missing" ? "member_missing" : m.state === "unreadable" ? "member_unreadable" : "member_loading") }), remove);
    return personRow(m, remove);
  });
  $("chosen").replaceChildren(...(rows.length ? rows : [h("li", { class: "muted", text: L("members_none") })]));
  $("members-count").textContent = S.cfg.costreamers.length ? `(${S.cfg.costreamers.length})` : "";
  $("members-note").textContent = isFull() ? L("members_max", { n: P.LIMITS.costreamers }) : "";
}
function renderResults() {
  const shown = S.search.items.slice(0, S.search.shown);
  $("results").replaceChildren(...shown.map((m) => personRow(m, addButton({ id: m.id }, m.name))));
  $("results-more").hidden = S.search.items.length <= S.search.shown;
}
function renderCategory() {
  $("cat-results").replaceChildren(...S.cat.items.map((m) => personRow(m, addButton({ id: m.id }, m.name))));
  $("cat-more").hidden = !S.cat.next;
  const free = P.LIMITS.costreamers - S.cfg.costreamers.length, first = $("cat-add-first");
  first.hidden = !S.cat.items.length || free <= 0; first.textContent = L("cat_add_first", { n: free });
}
function renderSaved() {
  $("saved-box").hidden = !S.adhoc.length;
  $("saved-list").replaceChildren(...S.adhoc.map((m) => {
    const entry = { login: m.login, name: m.name, image: m.image }, label = m.name || m.login;
    return personRow({ name: label, login: m.login, image: m.image, accounts: [] }, addButton(entry, label),
      h("button", { type: "button", text: L("remove"), "aria-label": `${L("remove")} ${label}`, onclick: () => removeSaved(m) }));
  }));
}
function renderMembers() {
  $("book-box").hidden = S.contacts !== "ok"; $("book-absent").hidden = S.contacts !== "absent";
  renderChosen(); renderResults(); renderCategory(); renderSaved(); renderInfo();
}

/** Re-reads the Contacts cards named by the video (loaded model, AI preparation): name, handle, photo. A merged card is followed, a deleted card is reported. */
async function resolveRefs() {
  const todo = [...new Set(S.cfg.costreamers.filter((e) => e.id && S.known.get(`id:${e.id}`)?.state !== "ok" && S.known.get(`id:${e.id}`)?.state !== "missing").map((e) => e.id))];
  for (let i = 0; i < todo.length; i += 24) {
    const part = todo.slice(i, i + 24);
    const r = S.contacts === "ok" ? await api(`members?${part.map((id) => `id=${encodeURIComponent(id)}`).join("&")}`) : { ok: false };
    if (!r.ok || r.state !== "ok") { for (const id of part) S.known.set(`id:${id}`, { key: `id:${id}`, state: "unreadable", name: "", login: "", image: "", accounts: [] }); continue; }
    remember(r.members);
    for (const m of r.members) if (m.movedFrom) {
      S.cfg.costreamers = S.cfg.costreamers.map((e) => (e.id === m.movedFrom ? { id: m.id } : e)).filter((e, k, all) => all.findIndex((x) => keyOf(x) === keyOf(e)) === k);
    }
    for (const id of r.missing) S.known.set(`id:${id}`, { key: `id:${id}`, state: "missing", name: "", login: "", image: "", accounts: [] });
  }
}
async function refreshMembers() { renderMembers(); await resolveRefs(); renderMembers(); rebuild(); }

/* Search as you type: a list of 30 at most (Contacts' limit), shown 10 by 10. */
let searchTimer = null;
function onSearchInput() {
  clearTimeout(searchTimer);
  const q = $("q").value.trim(), seq = ++S.searchSeq;
  if ([...q].length < 2) { S.search = { items: [], shown: 10 }; $("q-note").textContent = L("search_hint"); renderResults(); return; }
  $("q-note").textContent = L("search_busy");
  searchTimer = setTimeout(() => runSearch(q, seq), 300);
}
async function runSearch(q, seq) {
  const r = await api(`people?q=${encodeURIComponent(q)}`);
  if (seq !== S.searchSeq) return;
  S.search = { items: [], shown: 10 };
  if (!r.ok) { $("q-note").textContent = errText(r.error); return renderResults(); }
  if (r.state === "absent") { S.contacts = "absent"; return renderMembers(); }
  if (r.state !== "ok") { $("q-note").textContent = L("search_slow"); return renderResults(); }
  remember(r.items);
  S.search = { items: r.items, shown: 10 };
  $("q-note").textContent = !r.items.length ? L("search_none") : r.items.length >= 30 ? L("search_refine") : "";
  renderResults();
}

/* Adding from a Contacts category: the categories (by pages), then the accounts of the chosen one (by pages). */
const catNote = (text) => { $("cat-note").textContent = text || ""; };
function renderCategoryPicker() {
  const sel = $("cat");
  sel.replaceChildren(h("option", { value: "", text: L("cat_choose") }), ...S.catList.items.map((k) => h("option", { value: k.id, text: k.label })));
  sel.value = S.cat.id; $("cat-more-cats").hidden = !S.catList.next;
  if (S.catList.loaded && !S.catList.items.length) catNote(L("cat_none"));
}
async function loadCategories(more) {
  const r = await api(`categories${more && S.catList.next ? `?cursor=${encodeURIComponent(S.catList.next)}` : ""}`);
  if (!r.ok) return catNote(errText(r.error));
  if (r.state !== "ok") return catNote(L("search_slow"));
  S.catList = { items: more ? [...S.catList.items, ...r.items] : r.items, next: r.next, loaded: true };
  renderCategoryPicker();
}
async function loadCategory(more) {
  const id = S.cat.id, seq = ++S.catSeq;
  if (!id) { S.cat = { id: "", items: [], next: null }; catNote(""); return renderCategory(); }
  const r = await api(`category?id=${encodeURIComponent(id)}${more && S.cat.next ? `&cursor=${encodeURIComponent(S.cat.next)}` : ""}`);
  if (seq !== S.catSeq) return;
  if (!r.ok) return catNote(errText(r.error));
  if (r.error === "not_found") { S.cat = { id, items: [], next: null }; catNote(L("cat_gone")); return renderCategory(); }
  if (r.state !== "ok") return catNote(L("search_slow"));
  remember(r.items);
  const have = new Set(more ? S.cat.items.map((m) => m.id) : []);
  S.cat = { id, items: [...(more ? S.cat.items : []), ...r.items.filter((m) => !have.has(m.id))], next: r.next };
  catNote(!S.cat.items.length && !S.cat.next ? L("cat_empty") : "");
  renderCategory();
}
async function addFirstOfCategory() {
  let added = 0, pages = 0;
  $("cat-add-first").disabled = true;
  for (;;) {
    for (const m of S.cat.items) if (addEntry({ id: m.id })) added++;
    if (isFull() || !S.cat.next || ++pages > 4) break;
    const before = S.cat.next; await loadCategory(true);
    if (S.cat.next === before) break;
  }
  $("cat-add-first").disabled = false;
  say(added ? L("cat_added", { n: added }) : L("cat_full", { n: P.LIMITS.costreamers }), added ? "ok" : "");
  renderMembers(); rebuild();
}

/* A person "for this video only": the server puts the input in order (and refuses a photo it could not relay); nothing is saved in Contacts. */
async function addAdhoc() {
  $("a-error").textContent = "";
  const r = await withBusy("adhoc-add", "busy_adding", () => api("act", { method: "POST", body: { op: "adhoc.check", login: $("a-login").value, name: $("a-name").value, image: $("a-image").value.trim() } }));
  for (const id of ["a-login", "a-name", "a-image"]) $(id).setAttribute("aria-invalid", !r.ok ? "true" : "false");
  if (!r.ok) { $("a-error").textContent = errText(r.error); return; }
  if (!addEntry(r.entry)) { say(L("members_max", { n: P.LIMITS.costreamers }), "error"); return; }
  for (const id of ["a-login", "a-name", "a-image"]) $(id).value = "";
  say("", ""); renderMembers(); rebuild();
}
async function removeSaved(m) {
  const r = await api("act", { method: "POST", body: { op: "adhoc.remove", id: m.id } });
  if (!r.ok) return say(errText(r.error), "error");
  S.adhoc = S.adhoc.filter((x) => x.id !== m.id); renderSaved();
}

/* ───────────── The three steps: event, information, style ───────────── */
const STEPS = [1, 2, 3];
const stepName = (n) => L(`step_${n}`);
/** The information of step 2 refuses to go on while the day written is not valid: the field is told, it takes the focus, and what was typed stays. */
function infoBlocked() {
  const { error } = streamNow();
  if (!error || !(S.info.date || S.info.time)) return false;
  renderInfo();
  try { $(error === "time" ? "info-time" : "info-date").focus?.(); } catch { /* not important */ }
  return true;
}
function renderSteps() {
  for (const n of STEPS) {
    const sec = $(`step-${n}`), btn = $(`step-btn-${n}`);
    sec.hidden = S.step !== n;
    btn.setAttribute("aria-current", S.step === n ? "step" : "false");
    btn.className = `stepbtn${S.visited.has(n) && S.step !== n ? " done" : ""}`;
  }
  const last = S.step === 3;
  $("step-prev").hidden = S.step === 1; $("step-next").hidden = last; $("generate").hidden = !last; $("generate-now").hidden = last;
  $("step-next").textContent = L(S.step === 1 ? "next_info" : "next_style");
  // The quick way out keeps the style of the preview: the person has seen it. Its name is on the button.
  $("generate-now").textContent = L("gen_now", { style: L(`style_${previewStyle()}`) });
  $("pv-note").hidden = last || S.styleChosen;
}
function setStep(n, { focus = true } = {}) {
  if (S.job) return;
  const to = Math.min(3, Math.max(1, n));
  if (S.step === 2 && to > 2 && infoBlocked()) return;
  S.step = to; S.visited.add(S.step);
  renderSteps(); rebuild(); if (S.step === 3) scheduleThumbs();   // the preview follows: the editing style on steps 1 and 2, the chosen style on step 3
  setPlaying(!REDUCED && (S.step === 3 || S.styleChosen));   // while editing, the preview rests on its finished image (readable); the style step brings the animation back
  $("step-live").textContent = L("step_now", { n: S.step, name: stepName(S.step) });
  try { globalThis.scrollTo?.({ top: 0, behavior: REDUCED ? "auto" : "smooth" }); } catch { /* not important */ }
  if (focus) { try { $(["h-event", "h-info", "h-style"][S.step - 1]).focus?.(); } catch { /* not important */ } }
}
/** "Generate now": the video is made in the style of the preview, which becomes the chosen style (the last step shows it selected, with the download). */
function generateNow() {
  if (S.job || (S.step === 2 && infoBlocked())) return;
  chooseStyle(previewStyle());
  setStep(3, { focus: false }); generate();
}

/* ───────────── The models ───────────── */
function configForModel() { return { ...S.cfg, streamKey: "", eventId: "", eventSource: "", watermark: false }; }   // the mention is never in a model: it follows the box
function renderModels() {
  const box = $("model-list");
  box.replaceChildren(...(S.models.length ? S.models.map((m) => {
    const c = S.confirm?.id === m.id ? S.confirm.kind : null;
    return h("li", { class: "row" }, h("span", { class: "grow", text: m.name }),
      c ? h("span", { class: "confirm", role: "group" }, h("button", { type: "button", class: "danger", text: L(c === "model-replace" ? "confirm_replace_model" : "confirm_remove_model", { name: m.name }), onclick: () => (c === "model-replace" ? replaceModel(m) : removeModel(m)) }), h("button", { type: "button", text: L("cancel"), onclick: () => { S.confirm = null; renderModels(); } }))
        : [h("button", { type: "button", text: L("load"), "aria-label": `${L("load")} ${m.name}`, onclick: () => loadModel(m) }),
          h("button", { type: "button", text: L("replace"), "aria-label": `${L("replace")} ${m.name}`, onclick: () => { S.confirm = { kind: "model-replace", id: m.id }; renderModels(); } }),
          h("button", { type: "button", text: L("remove"), "aria-label": `${L("remove")} ${m.name}`, onclick: () => { S.confirm = { kind: "model-remove", id: m.id }; renderModels(); } })]);
  }) : [h("li", { class: "muted", text: L("models_none") })]));
}
function loadModel(m) {
  const keep = { streamKey: S.cfg.streamKey, eventId: S.cfg.eventId, eventSource: S.cfg.eventSource, watermark: S.cfg.watermark };
  S.cfg = P.cleanConfig({ ...m.config, ...keep });
  S.styleChosen = true; S.autoTicked = "";   // a model carries its style: it is shown at once, on the style step
  syncControls(); refreshMembers(); say(L("model_loaded", { name: m.name }), "ok"); setStep(3);
}
const modelError = (text) => { $("model-error").textContent = text || ""; $("model-name").setAttribute("aria-invalid", text ? "true" : "false"); };
async function withBusy(id, key, work) {
  const b = $(id), label = b.textContent; b.disabled = true; b.textContent = L(key); b.setAttribute("aria-busy", "true");
  try { return await work(); } finally { b.disabled = false; b.textContent = label; b.setAttribute("aria-busy", "false"); }
}
async function saveModel() {
  modelError("");
  const name = $("model-name").value, clash = S.models.find((m) => m.name.toLowerCase() === P.oneLine(name, 60).toLowerCase());
  if (clash) { S.confirm = { kind: "model-replace", id: clash.id }; renderModels(); return say(L("model_exists", { name: clash.name }), "error"); }
  const r = await withBusy("model-save", "busy_saving", () => api("act", { method: "POST", body: { op: "model.save", name, config: configForModel() } }));
  if (!r.ok) return r.error === "name" || r.error === "exists" ? modelError(errText(r.error)) : say(errText(r.error), "error");
  S.models = r.items; $("model-name").value = ""; say(L("model_saved"), "ok"); renderModels();
}
async function replaceModel(m) {
  const r = await api("act", { method: "POST", body: { op: "model.save", name: m.name, config: configForModel(), replaceId: m.id } });
  S.confirm = null;
  if (!r.ok) return say(errText(r.error), "error");
  S.models = r.items; say(L("model_replaced", { name: m.name }), "ok"); renderModels();
}
async function removeModel(m) {
  const r = await api("act", { method: "POST", body: { op: "model.remove", id: m.id } });
  S.confirm = null;
  if (!r.ok) return say(errText(r.error), "error");
  S.models = r.items; say(L("model_removed", { name: m.name }), "ok"); renderModels();
}

/* ───────────── The visible settings ───────────── */
/** Each item of step 2 is dimmed when its switch is off (the same tick as the element: nothing is removed from the field, so switching it on again brings it back). */
function renderItems() {
  for (const e of ELEMENT_KEYS) { const box = $(`item-${e}`); if (box) box.className = `item${S.cfg.elements.includes(e) ? "" : " off"}`; }
}
let brandKey = null;
/** The fields of step 2 follow `S.info`, the list of guests and the site. */
function renderInfo() {
  const { stream, error } = streamNow(), i = S.info;
  for (const [id, key] of [["info-title", "title"], ["info-date", "date"], ["info-time", "time"], ["info-game", "game"]]) if ($(id).value !== i[key]) $(id).value = i[key];
  const bad = error && (i.date || i.time) ? error : "";
  $("info-error").textContent = bad ? L(bad === "date" && !i.date ? "info_need_date" : `manual_${bad}`) : "";
  $("info-date").setAttribute("aria-invalid", bad === "date" ? "true" : "false"); $("info-time").setAttribute("aria-invalid", bad === "time" ? "true" : "false");
  const c = S.cov, gameNote = !c.game ? "" : c.state === "no_key" ? L("cover_no_key") : c.state === "down" && !c.url ? L("cover_down") : "";
  $("game-help").textContent = gameNote || L("game_help");
  const who = chosenMembers().map((m) => m.name || m.login).filter(Boolean);
  $("members-sum").textContent = who.length ? who.join(", ") : L("members_none");
  $("channel").setAttribute("placeholder", S.brand.name || "");
  const bk = `${S.brand.logo}|${S.brand.name}`;
  if (bk !== brandKey) { brandKey = bk; $("brand-logo").replaceChildren(thumb(S.brand.logo, S.brand.name || "")); }
  const dated = Number.isFinite(stream?.startMs);
  $("countdown-note").textContent = !S.cfg.elements.includes("countdown") ? L("countdown_off") : dated ? L("countdown_is", { text: contentNow().content.countdown }) : L("countdown_need");
}
function syncControls() {
  for (const e of ELEMENT_KEYS) $(`el-${e}`).checked = S.cfg.elements.includes(e);
  for (const st of P.STYLES) $(`style-${st}`).checked = S.cfg.style === st;
  for (const f of P.FORMATS) $(`format-${f.id}`).checked = S.cfg.format === f.id;
  $("duration").value = S.cfg.duration; $("duration-out").textContent = L("seconds", { n: S.cfg.duration });
  $("text").value = S.cfg.text; $("text-count").textContent = `${[...S.cfg.text].length}/${P.LIMITS.text}`;
  $("channel").value = S.cfg.channelName; $("lang").value = S.cfg.lang; $("watermark").checked = S.cfg.watermark === true;
  $("schedule-people").checked = S.cfg.schedulePeople !== false;
  if (S.cfg.lang !== (C.lang === "en" ? "en" : "fr")) $("more-2").open = true;   // a setting that was already changed (model, assistant) is never left hidden
  if (S.cfg.duration !== P.DEFAULT_CONFIG.duration) $("more-3").open = true;
  renderItems(); renderInfo(); renderStyleNote(); renderSteps();
  renderStreamPicker();
}
function updateInfo() {
  const s = S.scene;
  $("empty").hidden = !S.empty;
  $("generate").disabled = !!S.job || !s || S.empty; $("generate-now").disabled = $("generate").disabled;
  $("fmt-note").textContent = L(S.cfg.format === "vertical" ? "format_help_vertical" : "format_help_passeport");
  renderInfo();
}

function bind() {
  const on = (id, ev, fn) => $(id).addEventListener(ev, fn);
  for (const e of ELEMENT_KEYS) on(`el-${e}`, "change", () => { S.cfg.elements = ELEMENT_KEYS.filter((k) => $(`el-${k}`).checked); if (e === S.autoTicked) S.autoTicked = ""; renderItems(); renderStyleNote(); renderCoverWarn(); renderInfo(); rebuild(); });
  for (const st of P.STYLES) on(`style-${st}`, "change", () => chooseStyle(st));
  for (const f of P.FORMATS) on(`format-${f.id}`, "change", () => { S.cfg.format = f.id; rebuild(); });
  on("duration", "input", () => { S.cfg.duration = Number($("duration").value) || 15; $("duration-out").textContent = L("seconds", { n: S.cfg.duration }); rebuild(); });
  on("text", "input", () => { S.cfg.text = P.freeText($("text").value, P.LIMITS.text); $("text-count").textContent = `${[...$("text").value].length}/${P.LIMITS.text}`; rebuild(); });
  on("channel", "input", () => { S.cfg.channelName = P.oneLine($("channel").value, P.LIMITS.channelName); rebuild(); });
  on("lang", "change", () => { S.cfg.lang = $("lang").value === "en" ? "en" : "fr"; renderStreamPicker(); rebuild(); });
  // The information of step 2: what is typed replaces what came from the event; the preview follows.
  for (const [id, key] of [["info-title", "title"], ["info-date", "date"], ["info-time", "time"], ["info-game", "game"]]) on(id, "input", () => { S.info[key] = $(id).value; if (key === "game") syncCover(); renderInfo(); rebuild(); });
  // The "Made with Curiosa" mention: the preview follows at once; the choice is remembered for the next videos (a failure does not prevent making this one).
  on("schedule-people", "change", () => { S.cfg.schedulePeople = $("schedule-people").checked; renderInfo(); rebuild(); });
  on("watermark", "change", async () => {
    S.cfg.watermark = $("watermark").checked; rebuild();
    const r = await api("act", { method: "POST", body: { op: "prefs.watermark", watermark: S.cfg.watermark } });
    if (!r.ok) say(errText(r.error), "error");
  });
  for (const n of STEPS) on(`step-btn-${n}`, "click", () => setStep(n));
  on("step-prev", "click", () => setStep(S.step - 1)); on("step-next", "click", () => setStep(S.step + 1));
  on("generate-now", "click", generateNow);
  on("event-q", "input", onEventSearch);
  on("event-more", "click", () => loadEvents(true));
  on("event-retry", "click", async () => { const b = $("event-retry"); b.disabled = true; b.textContent = L("busy_reading"); b.setAttribute("aria-busy", "true"); await loadEvents(false, { fresh: true }); b.disabled = false; b.textContent = L("event_retry"); b.setAttribute("aria-busy", "false"); const r = S.ev; if (!S.ev.selected && !S.noEvent) { const n = P.nextEvent(r.items, Date.now(), TZ); if (n) pickEvent(n, { quiet: true, auto: true }); } });
  on("event-change", "click", () => togglePicker());
  on("event-picker", "keydown", (e) => { if (e.key === "Escape" && S.pickerOpen) { e.preventDefault?.(); togglePicker(false); } });
  on("event-none", "click", () => { if (!S.noEvent) chooseNoEvent(); });
  on("play", "click", () => setPlaying(!S.playing));
  on("replay", "click", () => { S.t = 0; setPlaying(true); });
  on("safe", "change", () => { S.showSafe = $("safe").checked; drawPreview(); });
  on("adhoc-add", "click", addAdhoc);
  for (const id of ["a-login", "a-name", "a-image"]) on(id, "keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addAdhoc(); } });
  on("q", "input", onSearchInput); on("results-more", "click", () => { S.search.shown += 10; renderResults(); });
  on("cat-box", "toggle", () => { if ($("cat-box").open && !S.catList.loaded) loadCategories(false); });
  on("cat", "change", () => { S.cat = { id: $("cat").value, items: [], next: null }; renderCategory(); loadCategory(false); });
  on("cat-more-cats", "click", () => loadCategories(true)); on("cat-more", "click", () => loadCategory(true)); on("cat-add-first", "click", addFirstOfCategory);
  on("model-save", "click", saveModel);
  on("model-name", "keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); saveModel(); } });
  on("generate", "click", generate); on("cancel", "click", () => S.job?.abort());
}

/* ───────────── Making the video ───────────── */
function setBusy(on) {
  $("progress-box").hidden = !on; $("generate").disabled = on || !S.scene || S.empty; $("generate-now").disabled = $("generate").disabled;
  $("generate").setAttribute("aria-busy", on ? "true" : "false"); if (!on) $("generate").textContent = L("generate");
  document.body.classList.toggle("busy", on);
  for (const el of document.querySelectorAll(".panels input, .panels select, .panels textarea, .panels button:not(#cancel), .stepbtn, #step-prev, #step-next")) el.disabled = on ? true : el.dataset.keepDisabled === "1";
  if (!on) { renderMembers(); renderModels(); renderStreamPicker(); updateInfo(); }
}
async function generate() {
  if (S.job) return;
  const resultBox = $("result"); resultBox.hidden = true; resultBox.replaceChildren();
  const built = await buildScene(Date.now());
  if (!built || built.empty) return;
  const scene = built.scene, env = globalThis;
  const caps = await detectCapabilities({ width: scene.width, height: scene.height, fps: scene.fps }, env);
  if (caps.mode === "none") return say(L("err_unsupported"), "error");
  const ctl = new AbortController();
  S.job = ctl; setBusy(true); say("", "");
  const prevPlaying = S.playing; setPlaying(false);
  $("progress").value = 0; $("progress-text").textContent = L("progress_start"); $("generate").textContent = L("busy_generate", { pct: 0 });
  try {
    const out = await renderVideo({ scene, caps, env, signal: ctl.signal, onProgress: (f, phase) => { $("progress").value = f; $("generate").textContent = phase === "finish" ? L("progress_finish") : L("busy_generate", { pct: Math.round(f * 100) }); $("progress-text").textContent = phase === "finish" ? L("progress_finish") : L("progress", { pct: Math.round(f * 100) }); } });
    const blob = out.blob ?? new Blob([out.bytes], { type: out.mime });
    const { stream } = contentNow();
    const name = P.fileName({ startMs: stream?.startMs, tz: zoneOf(stream), format: S.cfg.format, lang: S.cfg.lang, ext: out.ext, nowMs: Date.now() });
    const url = URL.createObjectURL(blob);
    const link = h("a", { href: url, download: name, class: "button", text: L("download_again", { name }) });
    resultBox.replaceChildren(...[h("p", { class: "ok", text: L("done", { name, size: (blob.size / 1048576).toFixed(1) }) }), link,
      out.mime !== "video/mp4" ? h("p", { class: "warn", text: L("webm_notice") }) : null, out.mode === "recorder" ? h("p", { class: "muted", text: L("recorder_notice") }) : null].filter(Boolean));
    resultBox.hidden = false; link.click();
    try { resultBox.scrollIntoView?.({ block: "nearest", behavior: REDUCED ? "auto" : "smooth" }); } catch { /* not important */ }
  } catch (e) {
    say(e?.code === "aborted" ? L("cancelled") : e?.code === "unsupported" ? L("err_unsupported") : L("err_encoder"), e?.code === "aborted" ? "" : "error");
  } finally { S.job = null; setBusy(false); setPlaying(prevPlaying); rebuild(); }
}

/* ───────────── Start-up ───────────── */
function applyPrep(prep) {
  S.cfg = P.cleanConfig(prep.config);
  S.styleChosen = true;   // an assistant preparation carries its style
  if (prep.manual && prep.manual.title) {
    // an event written by the assistant: no event picked, the information is already there
    S.noEvent = true; S.info = { title: prep.manual.title, date: prep.manual.date || "", time: prep.manual.time || "", game: "" };
    S.cfg.eventId = ""; S.cfg.eventSource = ""; S.cfg.streamKey = "";
  }
  $("prep-note").hidden = false;
}
async function start() {
  if (!TOKEN) { $("app").hidden = true; $("noaccess").hidden = false; return; }
  bind(); syncControls(); renderMembers(); renderModels();
  const [data, prep] = await Promise.all([api("data"), PREP ? api(`prep?id=${encodeURIComponent(PREP)}`) : null]);
  if (data.error === "auth") { $("app").hidden = true; $("noaccess").hidden = false; return; }
  if (data.ok) {
    if (!PREP && typeof data.defaults?.watermark === "boolean") S.cfg.watermark = data.defaults.watermark;   // the remembered box; an AI preparation already says its own
    S.models = data.models; S.adhoc = data.adhoc; S.contacts = data.contacts === "ok" ? "ok" : "absent"; S.brand = data.brand;
  }
  else say(errText(data.error), "error");
  if (PREP) { if (prep?.ok && prep.prep) { applyPrep(prep.prep); S.step = 3; S.visited.add(3); } else { $("prep-expired").hidden = false; } }   // an assistant preparation fills everything: we open on the last step, the style
  syncControls();
  // The events of all sources. The event already chosen (by a preparation) is found again even if it is not in the first page.
  const wantId = prep?.ok ? prep.prep?.config?.eventId ?? "" : "", wantKey = prep?.ok ? prep.prep?.config?.streamKey ?? "" : "";
  const handWritten = S.noEvent && PREP;   // an event written by the assistant stays as it is
  const ev = await loadEvents(false, { id: wantId, key: wantKey });
  if (ev?.error === "auth") return;
  const first = P.nextEvent(S.ev.items, Date.now(), TZ);   // the NEXT upcoming one (not an event that has already started), all sources together
  if (handWritten) renderEvents();
  else if (ev?.ok && ev.selected) pickEvent(ev.selected, { quiet: true, auto: ev.selected.id === first?.id });
  else {
    if (wantId || wantKey) { if (first) $("prep-stream-gone").hidden = false; }
    if (first) pickEvent(first, { quiet: true, auto: true }); else chooseNoEvent({ quiet: true });
  }
  syncControls(); renderMembers(); renderModels(); syncCover({ now: true });
  S.playing = !REDUCED && (S.step === 3 || S.styleChosen);   // editing steps: the preview rests on its finished image
  const r = await buildScene();
  if (r) { S.scene = r.scene; S.empty = r.empty; $("preview").dataset.style = r.style; sizePreview(); if (!S.playing) S.t = r.scene.restTime; updateInfo(); drawPreview(); }
  setPlaying(S.playing); renderSteps(); if (S.step === 3) scheduleThumbs();
  refreshMembers(); // the Contacts cards named by a model or a preparation: name, handle and photo arrive afterwards, without delaying the preview
  $("reduced").hidden = !REDUCED;
  requestAnimationFrame(loop);
}
start();
