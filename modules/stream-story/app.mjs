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
const errText = (e) => L(`err_${["auth", "network", "empty", "invalid", "not_channel", "dup", "full", "missing", "name", "exists", "image", "none"].includes(e) ? e : "generic"}`);

/* ───────────── L'état ───────────── */
const S = {
  cfg: P.cleanConfig({ ...P.DEFAULT_CONFIG, lang: C.lang === "en" ? "en" : "fr" }),
  streams: [], streamsState: "loading", coverState: "", manual: { title: "", date: "", time: "" }, useManual: false,
  costreamers: [], adhoc: [], models: [], partners: 0, brand: { name: "", logo: "" },
  images: new Map(), scene: null, nowMs: Date.now(), t: 0, playing: !REDUCED, last: 0, showSafe: false, building: 0, job: null, confirm: null, editing: null,
};
const mctx = document.createElement("canvas").getContext("2d");
const colors = C.colors;

const selectedStream = () => {
  if (S.useManual) { const m = P.manualStream(S.manual, TZ); return m.error ? null : m; }
  return S.streams.find((s) => s.key === S.cfg.streamKey) ?? S.streams[0] ?? null;
};
const allMembers = () => [...S.costreamers, ...S.adhoc.filter((a) => !S.costreamers.some((c) => c.login === a.login))];
const chosenMembers = () => S.cfg.costreamers.map((l) => allMembers().find((m) => m.login === l)).filter(Boolean);
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
function streamLabel(s) { const z = zoneOf(s); return `${P.formatDay(s.startMs, z, S.cfg.lang)}${s.allDay ? "" : ` · ${P.formatTime(s.startMs, z, S.cfg.lang)}`} — ${s.title || L("untitled")}`; }

function renderStreamPicker() {
  const sel = $("stream"), note = $("stream-note");
  sel.replaceChildren(...S.streams.map((s) => h("option", { value: s.key, text: streamLabel(s) })), h("option", { value: "manual", text: L("stream_manual") }));
  sel.value = S.useManual ? "manual" : (selectedStream()?.key ?? "manual");
  $("manual").hidden = !S.useManual;
  note.replaceChildren();
  if (S.streamsState === "loading") note.append(L("streams_loading"));
  else if (S.streamsState === "slow") note.append(h("span", { class: "warn", text: L("streams_slow") }));
  else if (!S.streams.length) note.append(h("span", { class: "warn", text: L("no_agenda") }));
  else if (S.coverState === "no_key" && S.streams.some((s) => s.games.length)) note.append(L("cover_no_key"));
  const { error } = S.useManual ? P.manualStream(S.manual, TZ) : {};
  $("manual-error").textContent = S.useManual && error && (S.manual.title || S.manual.date) ? L(`manual_${error}`) : "";
}

function renderMembers() {
  const box = $("members"), picked = new Set(S.cfg.costreamers), full = picked.size >= P.LIMITS.costreamers;
  const list = allMembers();
  box.replaceChildren(...(list.length ? list.map((m) => {
    const id = `m-${m.login}`, on = picked.has(m.login);
    return h("label", { class: "check", for: id }, h("input", { type: "checkbox", id, checked: on, disabled: !on && full, onchange: (e) => { setMember(m.login, e.target.checked); } }), h("span", { text: m.name ? `${m.name} (${m.login})` : m.login }), S.costreamers.some((c) => c.login === m.login) ? null : h("em", { class: "tag", text: L("only_this_video") }));
  }) : [h("p", { class: "muted", text: L("members_none") })]));
  $("members-note").textContent = full ? L("members_max", { n: P.LIMITS.costreamers }) : "";
  renderCostreamerManager();
}
function setMember(login, on) {
  const set = new Set(S.cfg.costreamers);
  if (on) { if (set.size < P.LIMITS.costreamers) set.add(login); } else set.delete(login);
  S.cfg.costreamers = [...set]; renderMembers(); rebuild();
}

function renderCostreamerManager() {
  const box = $("saved-list");
  const rows = S.costreamers.map((m) => {
    const confirming = S.confirm?.kind === "member" && S.confirm.id === m.login;
    return h("li", { class: "row" },
      h("span", { class: "grow", text: `${m.name ? `${m.name} — ` : ""}${m.login}${m.image ? ` · ${L("has_photo")}` : ""}` }),
      confirming ? h("span", { class: "confirm", role: "group" }, h("button", { type: "button", class: "danger", text: L("confirm_remove_member", { name: m.name || m.login }), onclick: () => removeMember(m.login) }), h("button", { type: "button", text: L("cancel"), onclick: () => { S.confirm = null; renderCostreamerManager(); } }))
        : [h("button", { type: "button", text: L("edit"), "aria-label": `${L("edit")} ${m.login}`, onclick: () => editMember(m) }), h("button", { type: "button", text: L("remove"), "aria-label": `${L("remove")} ${m.login}`, onclick: () => { S.confirm = { kind: "member", id: m.login }; renderCostreamerManager(); } })]);
  });
  box.replaceChildren(...(rows.length ? rows : [h("li", { class: "muted", text: L("members_none") })]));
  $("raid-import").hidden = !(S.partners > 0);
}
function editMember(m) { S.editing = m.login; $("c-login").value = m.login; $("c-name").value = m.name; $("c-image").value = m.image; $("c-save").textContent = L("save_changes"); $("c-cancel").hidden = false; $("c-login").focus(); }
function resetMemberForm() { S.editing = null; for (const id of ["c-login", "c-name", "c-image"]) $(id).value = ""; $("c-save").textContent = L("add_to_list"); $("c-cancel").hidden = true; }
async function saveMember() {
  const r = await api("act", { method: "POST", body: { op: "costreamer.save", login: $("c-login").value, name: $("c-name").value, image: $("c-image").value.trim(), original: S.editing || undefined } });
  if (!r.ok) return say(errText(r.error), "error");
  S.costreamers = r.items; resetMemberForm(); say(L("member_saved"), "ok"); renderMembers(); rebuild();
}
async function removeMember(login) {
  const r = await api("act", { method: "POST", body: { op: "costreamer.remove", login } });
  S.confirm = null;
  if (!r.ok) return say(errText(r.error), "error");
  S.costreamers = r.items; S.cfg.costreamers = S.cfg.costreamers.filter((l) => l !== login); say(L("member_removed"), "ok"); renderMembers(); rebuild();
}
async function importPartners() {
  $("raid-import").disabled = true; say(L("importing"), "");
  const r = await api("act", { method: "POST", body: { op: "costreamers.import" }, ms: 20000 });
  $("raid-import").disabled = false;
  if (!r.ok) return say(r.error === "none" ? L("import_none") : errText(r.error), "error");
  S.costreamers = r.items; say(L("import_done", { added: r.added, updated: r.updated }), "ok"); renderMembers(); rebuild();
}
function addAdhoc() {
  const input = $("adhoc"), n = P.normalizeLogin(input.value);
  if (n.error) return say(errText(n.error), "error");
  if (!allMembers().some((m) => m.login === n.login)) S.adhoc.push({ login: n.login, name: "", image: "" });
  if (S.cfg.costreamers.length < P.LIMITS.costreamers && !S.cfg.costreamers.includes(n.login)) S.cfg.costreamers.push(n.login);
  input.value = ""; say("", ""); renderMembers(); rebuild();
}

/* ───────────── Les modèles ───────────── */
function configForModel() { return { ...S.cfg, streamKey: "" }; }
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
  const keep = S.cfg.streamKey;
  S.cfg = P.cleanConfig({ ...m.config, streamKey: keep });
  for (const login of S.cfg.costreamers) if (!allMembers().some((x) => x.login === login)) S.adhoc.push({ login, name: "", image: "" });
  syncControls(); renderMembers(); rebuild(); say(L("model_loaded", { name: m.name }), "ok");
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
  on("stream", "change", () => { const v = $("stream").value; S.useManual = v === "manual"; if (!S.useManual) S.cfg.streamKey = v; renderStreamPicker(); rebuild(); });
  for (const f of ["title", "date", "time"]) on(`m-${f}`, "input", () => { S.manual[f] = $(`m-${f}`).value; renderStreamPicker(); rebuild(); });
  on("play", "click", () => setPlaying(!S.playing));
  on("replay", "click", () => { S.t = 0; setPlaying(true); });
  on("safe", "change", () => { S.showSafe = $("safe").checked; drawPreview(); });
  on("adhoc-add", "click", addAdhoc);
  on("adhoc", "keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addAdhoc(); } });
  on("c-save", "click", saveMember); on("c-cancel", "click", resetMemberForm);
  on("raid-import", "click", importPartners);
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
  for (const login of S.cfg.costreamers) if (!allMembers().some((x) => x.login === login)) S.adhoc.push({ login, name: "", image: "" });
  if (prep.manual && prep.manual.title) { S.manual = { title: prep.manual.title, date: prep.manual.date, time: prep.manual.time }; S.useManual = true; for (const f of ["title", "date", "time"]) $(`m-${f}`).value = S.manual[f]; }
  $("prep-note").hidden = false;
}
async function start() {
  if (!TOKEN) { $("app").hidden = true; $("noaccess").hidden = false; return; }
  bind(); syncControls(); renderMembers(); renderModels();
  const [data, streams, prep] = await Promise.all([api("data"), api("streams", { ms: 20000 }), PREP ? api(`prep?id=${encodeURIComponent(PREP)}`) : null]);
  if (data.error === "auth" || streams.error === "auth") { $("app").hidden = true; $("noaccess").hidden = false; return; }
  if (data.ok) { S.costreamers = data.costreamers; S.models = data.models; S.partners = data.partners; S.brand = data.brand; }
  else say(errText(data.error), "error");
  S.streams = streams.ok ? streams.streams : []; S.streamsState = streams.ok ? streams.state : "slow"; S.coverState = streams.coverState ?? "";
  if (!S.cfg.streamKey && S.streams[0]) S.cfg.streamKey = S.streams[0].key;
  if (!S.streams.length) S.useManual = true;
  if (PREP) { if (prep?.ok && prep.prep) applyPrep(prep.prep); else { $("prep-expired").hidden = false; } }
  if (prep?.ok && prep.prep?.config?.streamKey && S.streams.some((s) => s.key === prep.prep.config.streamKey)) S.cfg.streamKey = prep.prep.config.streamKey;
  else if (prep?.ok && S.cfg.streamKey && !S.streams.some((s) => s.key === S.cfg.streamKey)) { S.cfg.streamKey = S.streams[0]?.key ?? ""; if (S.streams[0]) $("prep-stream-gone").hidden = false; }
  syncControls(); renderMembers(); renderModels();
  const r = await buildScene();
  if (r) { S.scene = r.scene; S.empty = r.empty; sizePreview(); if (!S.playing) S.t = r.scene.restTime; updateInfo(); drawPreview(); }
  setPlaying(S.playing);
  $("reduced").hidden = !REDUCED;
  requestAnimationFrame(loop);
}
start();
