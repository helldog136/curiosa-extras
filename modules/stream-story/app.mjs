// L'éditeur de « Story d'annonce » (page servie par la route `studio`, dans le panneau d'administration). Tout ce qui s'affiche est écrit avec `textContent` (jamais de HTML) ;
// la vidéo est dessinée avec `fillText` sur un canvas. Les phrases viennent de locales/ (clés `ui_…`, passées par le serveur dans #story-config).
import * as P from "./pure.mjs";
import { createScene } from "./scenes.mjs";
import { detectCapabilities, renderVideo } from "./encode.mjs";

const C = JSON.parse(document.getElementById("story-config").textContent);
const L = (k, vars) => String(C.labels[k] ?? k).replace(/\{(\w+)\}/g, (m, n) => (vars && vars[n] !== undefined ? vars[n] : m));
const $ = (id) => document.getElementById(id);
const frag = new URLSearchParams(location.hash.slice(1));
const TOKEN = frag.get("t") || "", PREP = frag.get("p") || "";
try { history.replaceState(null, "", location.pathname + location.search); } catch { /* sans importance */ }
const BROWSER_TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "UTC"; } })();
const TZ = P.validZone(C.timezone) ? C.timezone : P.validZone(BROWSER_TZ) ? BROWSER_TZ : "UTC";
const REDUCED = (() => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } })();

/* ───────────── Petits outils ───────────── */
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

/* ───────────── L'état ───────────── */
const S = {
  cfg: P.cleanConfig({ ...P.DEFAULT_CONFIG, lang: C.lang === "en" ? "en" : "fr" }),
  ev: { items: [], next: null, total: 0, totalAll: 0, sources: [], state: "loading", q: "", source: "", seq: 0, selected: null, busy: false, coverState: "" }, manual: { title: "", date: "", time: "" }, useManual: false,
  known: new Map(), adhoc: [], contacts: "loading", search: { items: [], shown: 10 }, searchSeq: 0, cat: { id: "", items: [], next: null }, catList: { items: [], next: null, loaded: false }, catSeq: 0, models: [], brand: { name: "", logo: "" },
  images: new Map(), scene: null, nowMs: Date.now(), t: 0, playing: !REDUCED, last: 0, showSafe: false, building: 0, job: null, confirm: null, editing: null,
};
const mctx = document.createElement("canvas").getContext("2d");
const colors = C.colors;

const selectedStream = () => {
  if (S.useManual) { const m = P.manualStream(S.manual, TZ); return m.error ? null : m; }
  return S.ev.selected;
};
/* Les co-streamers de la vidéo : chaque entrée est { id } (une fiche de Contacts, lue au besoin) ou une saisie « pour cette vidéo seulement ». `key` : ce qui les distingue. */
const keyOf = P.memberKey;
const viewOf = (entry) => (entry.id
  ? S.known.get(`id:${entry.id}`) ?? { key: `id:${entry.id}`, state: "loading", name: "", login: "", image: "", accounts: [] }
  : { key: keyOf(entry), state: "ok", name: entry.name || entry.login, login: entry.login, image: entry.image, accounts: [], inline: true });
const chosenMembers = () => S.cfg.costreamers.map(viewOf).filter((m) => m.state === "ok").map((m) => ({ login: m.key, name: m.name, image: m.image }));
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
    // une image venue d'ailleurs passe par le relais du site (même adresse que la page : le canvas reste « propre »)
    fetch(`${C.base}/img?u=${encodeURIComponent(url)}`, { headers: { "X-Story-Token": TOKEN } })
      .then((r) => (r.ok ? r.blob() : null)).then((b) => { if (!b) return finish(null); img.src = URL.createObjectURL(b); }).catch(() => finish(null));
  });
  S.images.set(url, job);
  if (S.images.size > 80) S.images.delete(S.images.keys().next().value); // borné : on ne garde pas toutes les photos vues
  return job;
}

/* ───────────── La scène et l'aperçu ───────────── */
function contentNow() {
  const stream = selectedStream();
  return { stream, content: P.buildContent(S.cfg, { stream, coStreamers: chosenMembers(), site: { name: S.brand.name }, nowMs: S.nowMs, tz: TZ }) };
}
async function buildScene(nowMs = Date.now()) {
  const mine = ++S.building;
  S.nowMs = nowMs;
  const { stream, content } = contentNow();
  const members = chosenMembers();
  const [logo, cover, ...av] = await Promise.all([
    S.cfg.elements.includes("brand") ? loadImage(S.brand.logo) : null, S.cfg.elements.includes("game") && stream?.games?.[0] ? loadImage(stream.cover) : null,
    ...members.map((m) => (S.cfg.elements.includes("costreamers") ? loadImage(m.image) : null)),
  ]);
  if (mine !== S.building) return null;
  const avatars = Object.fromEntries(members.map((m, i) => [m.login, av[i]]));
  const scene = createScene({ style: S.cfg.style, format: S.cfg.format, duration: S.cfg.duration, content, assets: { logo, cover, avatars }, colors, font: C.font, measureContext: mctx });
  return { scene, empty: !(content.title || content.dayLine || content.timeLine || content.countdown || content.game || content.brand || content.text || content.costreamers.length) };
}
let rebuildTimer = null;
function rebuild() { clearTimeout(rebuildTimer); rebuildTimer = setTimeout(async () => { const r = await buildScene(); if (!r) return; S.scene = r.scene; S.empty = r.empty; sizePreview(); S.t = Math.min(S.t, r.scene.duration); if (!S.playing) S.t = Math.min(r.scene.restTime, r.scene.duration); updateInfo(); drawPreview(); }, 140); }
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

/* ───────────── Les éléments de l'éditeur ───────────── */
const ELEMENT_KEYS = P.ELEMENTS;
const kindOf = (k) => (P.SOURCE_KIND.test(String(k)) ? String(k) : "other");
const typeLabel = (t) => L(`type_${["stream", "live", "premiere", "video", "event"].includes(t) ? t : "other"}`);
/** La date d'un événement, lisible, dans le fuseau du site (ou celui du réglage) ; entre parenthèses l'heure sur place quand elle est différente. */
function whenText(e) {
  const day = P.formatDay(e.startMs, TZ, C.lang);
  if (e.allDay) return day;
  let text = `${day} · ${P.formatTime(e.startMs, TZ, C.lang)}`;
  if (P.validZone(e.timezone) && e.timezone !== TZ) { const there = P.formatTime(e.startMs, e.timezone, C.lang); if (there !== P.formatTime(e.startMs, TZ, C.lang)) text += ` (${L("event_local", { time: there })})`; }
  return text;
}
function pill(kind, label) { return h("span", { class: `src src-${kindOf(kind)}`, text: label }); }

function renderChosen() {
  const box = $("event-chosen"), e = selectedStream();
  box.replaceChildren();
  if (S.useManual) { const m = P.manualStream(S.manual, TZ); box.append(m.error ? L("event_none_chosen") : L("event_manual_chosen", { title: m.title, when: whenText(m) })); return; }
  if (!e) { box.append(L("event_none_chosen")); return; }
  box.append(h("strong", { text: L("event_chosen") }), " ", `${e.title || L("untitled")} — ${whenText(e)}`);
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
  const list = $("event-list"), E = S.ev, picked = !S.useManual && E.selected ? E.selected.id : "";
  list.replaceChildren(...E.items.map((e) => {
    const also = e.alsoIn.length ? h("span", { class: "more", text: L("event_also", { sources: e.alsoIn.map((x) => x.label).join(", ") }) }) : null;
    const on = e.id === picked || (picked && e.ids?.includes?.(picked));
    const row = h("button", { type: "button", class: "event", "aria-pressed": on ? "true" : "false", "aria-label": L("event_row", { title: e.title || L("untitled"), when: whenText(e) }), onclick: () => pickEvent(e) },
      h("span", { class: "top" }, pill(e.source, e.sourceLabel), h("span", { text: typeLabel(e.type) }), h("span", { text: whenText(e) }), on ? h("strong", { text: L("event_picked") }) : null),
      h("span", { class: "ttl", text: e.title || L("untitled") }), also);
    return h("li", {}, row);
  }));
  $("event-count").textContent = E.items.length ? L("event_count", { shown: E.items.length, total: E.total }) + (E.totalAll >= 200 && !E.q && !E.source ? ` · ${L("event_capped")}` : "") : "";
  $("event-more").hidden = !E.next; $("event-more").disabled = E.busy;
}

function renderNotes() {
  const E = S.ev, box = $("event-sources"), note = $("event-note");
  note.textContent = "";
  box.replaceChildren();
  if (E.state === "loading") { note.textContent = L("event_loading"); return; }
  const down = E.sources.filter((x) => x.state === "down");
  $("event-retry").hidden = !down.length || E.state === "loading";
  if (E.state === "slow") box.append(h("p", { class: "warn", text: L("event_all_down") }));
  else if (!E.total && !E.q && !E.source) note.textContent = L("event_none");
  else if (!E.total) note.textContent = L("event_no_match");
  for (const x of E.sources) {
    if (x.state === "down" && E.state !== "slow") box.append(h("p", { class: "warn", text: L(x.stale ? "ev_down_stale" : "ev_down", { source: x.label }) }));
    else if (x.state === "setup" && x.message) box.append(h("p", { class: "warn", text: L("ev_setup", { source: x.label, message: x.message }) }));
    else if (x.state === "ok" && x.note) box.append(h("p", { class: "muted", text: L("ev_note", { source: x.label, note: x.note }) }));
  }
  if (E.coverState === "no_key" && E.selected?.games?.length && S.cfg.elements.includes("game")) box.append(h("p", { class: "muted", text: L("cover_no_key") }));
  box.append(h("p", { class: "muted", text: L("event_zone", { zone: TZ }) }));
}

function renderEvents() {
  renderChosen(); renderFilter(); renderEventList(); renderNotes();
  $("manual").hidden = !S.useManual;
  $("event-manual-toggle").textContent = L(S.useManual ? "event_manual_close" : "event_manual");
  $("event-manual-toggle").setAttribute("aria-expanded", S.useManual ? "true" : "false");
  const { error } = S.useManual ? P.manualStream(S.manual, TZ) : {};
  $("manual-error").textContent = S.useManual && error && (S.manual.title || S.manual.date) ? L(`manual_${error}`) : "";
}
const renderStreamPicker = renderEvents;

/** Choisit un événement de la liste : la vidéo se remplit, et le choix (identifiant + source) est gardé dans les réglages de la demande. */
function pickEvent(e, { quiet = false } = {}) {
  S.useManual = false;
  S.ev.selected = { ...e, cover: "" };
  S.cfg.eventId = e.id; S.cfg.eventSource = kindOf(e.source); S.cfg.streamKey = e.legacyKey || "";
  S.ev.coverState = "";
  renderEvents(); rebuild();
  if (!quiet) {
    say(L("event_ready", { title: e.title || L("untitled") }), "ok");
    // Sur téléphone l'aperçu est tout en haut : on y emmène la personne, bouton « Générer la vidéo » en vue. Sur grand écran il reste visible à droite.
    try { if (matchMedia("(max-width: 719px)").matches) document.querySelector?.(".previewcol")?.scrollIntoView?.({ behavior: REDUCED ? "auto" : "smooth", block: "start" }); } catch { /* sans importance */ }
  }
  if (e.games?.[0]) loadCover(e);
}
async function loadCover(e) {
  const r = await api(`cover?game=${encodeURIComponent(e.games[0])}`, { ms: 12000 });
  if (!r.ok || S.ev.selected?.id !== e.id) return;
  S.ev.coverState = r.coverState || "";
  if (r.cover) { S.ev.selected.cover = r.cover; rebuild(); }
  renderNotes();
}

/** Lit la liste (`more` : la page suivante). Les réponses arrivées en retard d'une recherche précédente sont ignorées. */
async function loadEvents(more, { fresh = false, id = "", key = "" } = {}) {
  const E = S.ev, mine = ++E.seq;
  E.busy = true; if (!more) { E.state = E.items.length ? E.state : "loading"; } renderEventList(); renderNotes();
  const qs = new URLSearchParams({ limit: "20" });
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
let searchTimer = null;
function onEventSearch() { clearTimeout(searchTimer); searchTimer = setTimeout(() => { S.ev.q = $("event-q").value.trim().slice(0, 80); loadEvents(false); }, 280); }

/* ───────────── Les co-streamers ───────────── */
const NET = { twitch: "Twitch", youtube: "YouTube", tiktok: "TikTok", instagram: "Instagram", discord: "Discord", x: "X", bluesky: "Bluesky", mastodon: "Mastodon" };
const netName = (n) => NET[n] ?? L(n === "web" ? "net_web" : "net_other");
const isFull = () => S.cfg.costreamers.length >= P.LIMITS.costreamers;
const inVideo = (key) => S.cfg.costreamers.some((e) => keyOf(e) === key);

/** Une pastille ronde : la photo (lue par le relais du site) ou, à défaut, les initiales. */
function thumb(image, name) {
  const box = h("span", { class: "avatar", "aria-hidden": "true", text: P.initials(name) });
  if (image) loadImage(image).then((img) => { if (img) { const i = new Image(); i.alt = ""; i.src = img.src; box.replaceChildren(i); } });
  return box;
}
/** Une ligne de personne : photo, nom, pastilles de comptes (ou pseudo), puis les boutons donnés. */
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
    return personRow({ name: label, login: m.login, image: m.image, accounts: [], tag: m.legacy ? L("legacy_tag") : "" }, addButton(entry, label),
      m.legacy ? null : h("button", { type: "button", text: L("remove"), "aria-label": `${L("remove")} ${label}`, onclick: () => removeSaved(m) }));
  }));
}
function renderMembers() {
  $("book-box").hidden = S.contacts !== "ok"; $("book-absent").hidden = S.contacts !== "absent";
  renderChosen(); renderResults(); renderCategory(); renderSaved();
}

/** Relit les fiches de Contacts nommées par la vidéo (modèle chargé, préparation de l'IA) : nom, pseudo, photo. Une fiche fusionnée est suivie, une fiche effacée est signalée. */
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

/* La recherche à la saisie : une liste de 30 au plus (limite de Contacts), montrée 10 par 10. */
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

/* Ajouter depuis une catégorie de Contacts : les catégories (par pages), puis les comptes de celle qu'on choisit (par pages). */
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

/* Une personne « pour cette vidéo seulement » : le serveur remet la saisie en ordre (et refuse une photo qu'il ne saurait pas relayer) ; rien n'est enregistré dans Contacts. */
async function addAdhoc() {
  $("a-error").textContent = "";
  const r = await api("act", { method: "POST", body: { op: "adhoc.check", login: $("a-login").value, name: $("a-name").value, image: $("a-image").value.trim() } });
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

/* ───────────── Les modèles ───────────── */
function configForModel() { return { ...S.cfg, streamKey: "", eventId: "", eventSource: "" }; }
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
  const keep = { streamKey: S.cfg.streamKey, eventId: S.cfg.eventId, eventSource: S.cfg.eventSource };
  S.cfg = P.cleanConfig({ ...m.config, ...keep });
  syncControls(); refreshMembers(); say(L("model_loaded", { name: m.name }), "ok");
}
async function saveModel() {
  const name = $("model-name").value, clash = S.models.find((m) => m.name.toLowerCase() === P.oneLine(name, 60).toLowerCase());
  if (clash) { S.confirm = { kind: "model-replace", id: clash.id }; renderModels(); return say(L("model_exists", { name: clash.name }), "error"); }
  const r = await api("act", { method: "POST", body: { op: "model.save", name, config: configForModel() } });
  if (!r.ok) return say(errText(r.error), "error");
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

/* ───────────── Les réglages visibles ───────────── */
function syncControls() {
  for (const e of ELEMENT_KEYS) $(`el-${e}`).checked = S.cfg.elements.includes(e);
  for (const st of P.STYLES) $(`style-${st}`).checked = S.cfg.style === st;
  for (const f of P.FORMATS) $(`format-${f.id}`).checked = S.cfg.format === f.id;
  $("duration").value = S.cfg.duration; $("duration-out").textContent = L("seconds", { n: S.cfg.duration });
  $("text").value = S.cfg.text; $("text-count").textContent = `${[...S.cfg.text].length}/${P.LIMITS.text}`;
  $("channel").value = S.cfg.channelName; $("lang").value = S.cfg.lang;
  renderStreamPicker();
}
function updateInfo() {
  const { stream, content } = contentNow(), s = S.scene;
  $("empty").hidden = !S.empty;
  $("generate").disabled = !!S.job || !s || S.empty;
  $("fmt-note").textContent = L(S.cfg.format === "vertical" ? "format_help_vertical" : "format_help_passeport");
  $("countdown-note").textContent = content.countdown && S.cfg.elements.includes("countdown") ? L("countdown_is", { text: content.countdown }) : "";
  $("nostream").hidden = !!stream || !S.cfg.elements.some((e) => ["title", "when", "countdown", "game"].includes(e));
}

function bind() {
  const on = (id, ev, fn) => $(id).addEventListener(ev, fn);
  for (const e of ELEMENT_KEYS) on(`el-${e}`, "change", () => { S.cfg.elements = ELEMENT_KEYS.filter((k) => $(`el-${k}`).checked); rebuild(); });
  for (const st of P.STYLES) on(`style-${st}`, "change", () => { S.cfg.style = st; rebuild(); });
  for (const f of P.FORMATS) on(`format-${f.id}`, "change", () => { S.cfg.format = f.id; rebuild(); });
  on("duration", "input", () => { S.cfg.duration = Number($("duration").value) || 15; $("duration-out").textContent = L("seconds", { n: S.cfg.duration }); rebuild(); });
  on("text", "input", () => { S.cfg.text = P.freeText($("text").value, P.LIMITS.text); $("text-count").textContent = `${[...$("text").value].length}/${P.LIMITS.text}`; rebuild(); });
  on("channel", "input", () => { S.cfg.channelName = P.oneLine($("channel").value, P.LIMITS.channelName); rebuild(); });
  on("lang", "change", () => { S.cfg.lang = $("lang").value === "en" ? "en" : "fr"; renderStreamPicker(); rebuild(); });
  on("event-q", "input", onEventSearch);
  on("event-more", "click", () => loadEvents(true));
  on("event-retry", "click", () => loadEvents(false, { fresh: true }));
  on("event-manual-toggle", "click", () => { S.useManual = !S.useManual; if (S.useManual) { S.cfg.eventId = ""; S.cfg.eventSource = ""; S.cfg.streamKey = ""; } renderEvents(); rebuild(); });
  for (const f of ["title", "date", "time"]) on(`m-${f}`, "input", () => { S.manual[f] = $(`m-${f}`).value; renderStreamPicker(); rebuild(); });
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

/* ───────────── Fabriquer la vidéo ───────────── */
function setBusy(on) {
  $("progress-box").hidden = !on; $("generate").disabled = on || !S.scene || S.empty;
  document.body.classList.toggle("busy", on);
  for (const el of document.querySelectorAll("#controls input, #controls select, #controls textarea, #controls button")) el.disabled = on ? true : el.dataset.keepDisabled === "1";
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
  $("progress").value = 0; $("progress-text").textContent = L("progress_start");
  try {
    const out = await renderVideo({ scene, caps, env, signal: ctl.signal, onProgress: (f, phase) => { $("progress").value = f; $("progress-text").textContent = phase === "finish" ? L("progress_finish") : L("progress", { pct: Math.round(f * 100) }); } });
    const blob = out.blob ?? new Blob([out.bytes], { type: out.mime });
    const { stream } = contentNow();
    const name = P.fileName({ startMs: stream?.startMs, tz: zoneOf(stream), format: S.cfg.format, lang: S.cfg.lang, ext: out.ext, nowMs: Date.now() });
    const url = URL.createObjectURL(blob);
    const link = h("a", { href: url, download: name, class: "button", text: L("download_again", { name }) });
    resultBox.replaceChildren(...[h("p", { class: "ok", text: L("done", { name, size: (blob.size / 1048576).toFixed(1) }) }), link,
      out.mime !== "video/mp4" ? h("p", { class: "warn", text: L("webm_notice") }) : null, out.mode === "recorder" ? h("p", { class: "muted", text: L("recorder_notice") }) : null].filter(Boolean));
    resultBox.hidden = false; link.click();
  } catch (e) {
    say(e?.code === "aborted" ? L("cancelled") : e?.code === "unsupported" ? L("err_unsupported") : L("err_encoder"), e?.code === "aborted" ? "" : "error");
  } finally { S.job = null; setBusy(false); setPlaying(prevPlaying); rebuild(); }
}

/* ───────────── Démarrage ───────────── */
function applyPrep(prep) {
  S.cfg = P.cleanConfig(prep.config);
  if (prep.manual && prep.manual.title) { S.manual = { title: prep.manual.title, date: prep.manual.date, time: prep.manual.time }; S.useManual = true; for (const f of ["title", "date", "time"]) $(`m-${f}`).value = S.manual[f]; }
  $("prep-note").hidden = false;
}
async function start() {
  if (!TOKEN) { $("app").hidden = true; $("noaccess").hidden = false; return; }
  bind(); syncControls(); renderMembers(); renderModels();
  const [data, prep] = await Promise.all([api("data"), PREP ? api(`prep?id=${encodeURIComponent(PREP)}`) : null]);
  if (data.error === "auth") { $("app").hidden = true; $("noaccess").hidden = false; return; }
  if (data.ok) {
    S.models = data.models; S.adhoc = data.adhoc; S.contacts = data.contacts === "ok" ? "ok" : "absent"; S.brand = data.brand;
    if (data.migrated) { $("migrated").textContent = L("migrated_note", data.migrated); $("migrated").hidden = false; }
  }
  else say(errText(data.error), "error");
  if (PREP) { if (prep?.ok && prep.prep) applyPrep(prep.prep); else { $("prep-expired").hidden = false; } }
  syncControls();
  // Les événements de toutes les sources. L'événement déjà choisi (par une préparation) est retrouvé même s'il n'est pas dans la première page.
  const wantId = prep?.ok ? prep.prep?.config?.eventId ?? "" : "", wantKey = prep?.ok ? prep.prep?.config?.streamKey ?? "" : "";
  const ev = await loadEvents(false, { id: wantId, key: wantKey });
  if (ev?.error === "auth") return;
  const first = S.ev.items[0] ?? null;
  if (ev?.ok && ev.selected) pickEvent(ev.selected, { quiet: true });
  else {
    if (wantId || wantKey) { if (first) $("prep-stream-gone").hidden = false; }
    if (first) pickEvent(first, { quiet: true }); else { S.useManual = true; S.cfg.eventId = ""; S.cfg.eventSource = ""; S.cfg.streamKey = ""; renderEvents(); }
  }
  syncControls(); renderMembers(); renderModels();
  const r = await buildScene();
  if (r) { S.scene = r.scene; S.empty = r.empty; sizePreview(); if (!S.playing) S.t = r.scene.restTime; updateInfo(); drawPreview(); }
  setPlaying(S.playing);
  refreshMembers(); // les fiches de Contacts nommées par un modèle ou une préparation : nom, pseudo et photo arrivent ensuite, sans retarder l'aperçu
  $("reduced").hidden = !REDUCED;
  requestAnimationFrame(loop);
}
start();
