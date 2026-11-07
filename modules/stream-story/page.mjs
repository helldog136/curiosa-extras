// The editor page (served by the `studio` route, in a frame of the administration panel) and the code files it loads (`lib/…` route).
// The page contains NO data of the person: only sentences, colours and settings. The data arrives by the routes protected by a token.
import { readFile } from "node:fs/promises";
const v = new URL(import.meta.url).search; // the module version spreads to the neighbouring files (otherwise the old code would stay in cache after an update)
const P = await import(`./pure.mjs${v}`);

const LINE_SEPARATORS = new RegExp(`[${String.fromCharCode(0x2028, 0x2029)}]`, "g");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
/** The sentences of the page (`ui_…` keys of the locales, without the prefix). */
export const KEYS = [
  "title", "no_access", "no_access_hint", "prep_note", "prep_expired", "prep_stream_gone", "help_intro", "cover_no_key", "cover_ambiguous", "cover_ambiguous_named", "cover_wrong", "untitled", "m_time_hint", "manual_date",
  "manual_time", "countdown_is", "text_label", "text_help", "channel_help", "lang_label", "lang_fr", "lang_en", "style_label", "style_neon", "style_neon_hint", "style_poster", "style_poster_hint", "style_countdown",
  "style_countdown_hint", "style_minimal", "style_minimal_hint", "style_broadcast", "style_broadcast_hint", "style_kinetic", "style_kinetic_hint", "style_cinema", "style_cinema_hint", "style_arcade", "style_arcade_hint", "style_collage", "style_collage_hint", "style_geometric",
  "style_geometric_hint", "style_countdown_on", "format_label", "format_vertical", "format_passeport", "format_help_vertical", "format_help_passeport", "duration_label", "duration_help", "seconds", "h_members", "members_help", "members_none", "members_max",
  "only_this_video", "adhoc_help", "saved_title", "remove", "h_models", "models_help", "model_name", "model_save", "models_none", "load", "replace", "cancel", "model_exists", "model_saved",
  "model_loaded", "model_replaced", "model_removed", "confirm_replace_model", "confirm_remove_model", "h_preview", "preview_label", "play", "pause", "replay", "safe_label", "safe_help", "zone_ui", "zone_grid",
  "reduced", "empty", "silent_note", "generate", "progress_start", "progress", "progress_finish", "cancelled", "cancel_video", "done", "download_again", "webm_notice", "recorder_notice", "err_unsupported",
  "err_encoder", "err_auth", "err_network", "err_empty", "err_invalid", "err_full", "err_missing", "err_name", "err_exists", "err_image", "err_generic", "members_chosen", "member_missing", "member_unreadable",
  "member_loading", "search_label", "search_placeholder", "search_hint", "search_busy", "search_none", "search_slow", "search_refine", "show_more", "add", "already", "cat_title", "cat_label", "cat_choose",
  "cat_none", "cat_empty", "cat_gone", "cat_more", "cat_add_first", "cat_added", "cat_full", "book_absent", "adhoc_title", "a_login", "a_name", "a_image", "a_image_help", "saved_help",
  "net_web", "net_other", "h_event", "event_chosen", "event_none_chosen", "event_search", "event_search_ph", "event_sources", "event_all", "event_loading", "event_none", "event_no_match",
  "event_count", "event_more", "event_capped", "event_zone", "event_local", "event_also", "event_picked", "event_row", "event_retry", "event_all_down", "event_busy", "event_ready", "ev_down", "ev_down_stale",
  "ev_setup", "ev_note", "type_stream", "type_live", "type_premiere", "type_video", "type_event", "type_other", "watermark_label", "watermark_help", "event_next", "event_started", "event_change", "event_pick_title",
  "event_same", "progress_label", "busy_generate", "busy_saving", "busy_reading", "busy_adding", "event_change_close", "steps_label", "step_1", "step_2", "step_3", "prev", "gen_now", "step_now",
  "cover_down", "schedule_people_label", "schedule_people_help", "next_info", "next_style", "event_none_btn", "event_none_set", "event_pick", "h_info", "info_intro", "g_event", "g_own", "in_video", "f_title",
  "ph_title", "f_when", "f_date", "f_time", "f_game", "ph_game", "game_help", "f_countdown", "countdown_off", "countdown_need", "ph_text", "members_pick", "f_brand", "more_options",
  "info_need_date", "h_style", "style_intro", "pv_plain",
];
export const labelsOf = (ctx) => Object.fromEntries(KEYS.map((k) => [k, ctx.t(`ui_${k}`)]));

/** The files the page loads: the list is closed (never a name given by the request). */
export const LIB = ["pure.mjs", "scenes.mjs", "scenes-extra.mjs", "mp4.mjs", "encode.mjs", "app.mjs"];
const sourceCache = new Map();
/** The font of the name "Curiosa" (exact copy of the core's file, SIL OFL licence next to it): served by the module itself, no outside call. */
let fontBytes = null;
export async function wordmarkFont() { return (fontBytes ??= await readFile(new URL("./curiosa-wordmark.woff2", import.meta.url))); }
export async function libSource(name) {
  if (!LIB.includes(name)) return null;
  if (!sourceCache.has(name)) sourceCache.set(name, await readFile(new URL(`./${name}`, import.meta.url), "utf8"));
  return sourceCache.get(name);
}

const CSS = `
:root{color-scheme:light dark;--bg:#ffffff;--fg:#1b1b22;--muted:#5a5a66;--line:#d6d6df;--card:#f5f5f9;--field:#ffffff;--accent:#4f46e5;--accent-fg:#ffffff;--danger:#b3261e;--ok:#0b6b34;--warn:#8a5300}
@media (prefers-color-scheme:dark){:root{--bg:#14141a;--fg:#f1f1f6;--muted:#b4b4c2;--line:#3a3a47;--card:#1d1d26;--field:#101016;--danger:#ff8a80;--ok:#7be0a1;--warn:#ffd27a}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1180px;margin:0 auto;padding:16px}
h1{font-size:1.25rem;margin:0 0 4px}h2{font-size:1.05rem;margin:0 0 8px}
p{margin:.3rem 0}.muted{color:var(--muted)}.warn{color:var(--warn)}.ok{color:var(--ok)}
.wiz{display:grid;gap:14px}.wiz>*{margin:0}.top{display:contents}
.stepper ol{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.stepbtn{width:100%;display:flex;gap:6px;justify-content:center;align-items:center;padding:6px 8px;border-radius:10px}.stepbtn b{display:inline-flex;width:24px;height:24px;border-radius:50%;align-items:center;justify-content:center;border:1px solid var(--line);font-size:.85rem}
.stepbtn[aria-current=step]{background:var(--accent);color:var(--accent-fg);border-color:var(--accent);font-weight:700}.stepbtn[aria-current=step] b{border-color:var(--accent-fg)}
.stepbtn.done b{background:var(--ok);color:var(--bg);border-color:var(--ok)}
@media (min-width:720px){.wiz{grid-template-columns:minmax(0,1fr) 340px;grid-template-areas:"steps side" "panels side";grid-template-rows:auto 1fr;align-items:start}.stepper{grid-area:steps}.panels{grid-area:panels}.navbar{position:sticky;bottom:0;background:var(--bg);padding:10px 0;border-top:1px solid var(--line);margin-top:14px}.previewcol{grid-area:side;position:sticky;top:12px;grid-row:1/3}}
@media (max-width:719px){.top{display:block;position:sticky;top:0;z-index:4;background:var(--bg);padding:6px 0 8px;margin:0 -16px;padding-left:16px;padding-right:16px;border-bottom:1px solid var(--line)}.stepper{margin-bottom:6px}.stepbtn span{font-size:.9rem}main#app{padding-bottom:calc(132px + env(safe-area-inset-bottom))}
#pv{display:flex;gap:12px;align-items:center;padding:6px 10px;margin:0}#pv .pvh,#pv>p:not([role=alert]),#pv #time{display:none}#pv canvas#preview{margin:0;width:auto;height:24vh;max-height:24vh;flex:none}#pv .bar{flex-direction:column;align-items:stretch;margin:0;flex:1}#pv .bar button{min-height:44px}
.navbar{position:fixed;left:0;right:0;bottom:0;z-index:5;margin:0;padding:8px 16px calc(8px + env(safe-area-inset-bottom));background:var(--bg);border-top:1px solid var(--line);box-shadow:0 -4px 12px rgba(0,0,0,.12)}}
.navrow{display:flex;gap:8px}.navrow .primary{flex:1;width:auto}.navbar .nowbtn{width:100%;margin-top:6px}
.group{margin:0 0 14px;padding:0}.group>legend{font-weight:700;font-size:1.02rem;margin-bottom:4px}
.item{border:1px solid var(--line);border-radius:10px;background:var(--field);padding:10px 12px;margin:0 0 8px}
.ihead{display:flex;gap:8px;align-items:center;justify-content:space-between;min-height:44px}.ihead>label,.ihead>.lbl{font-weight:600;min-width:0;overflow-wrap:anywhere}
.item input[type=text],.item input[type=date],.item input[type=time],.item textarea,.item select{margin-top:2px}
.item.off>:not(.ihead){opacity:.5}.item p{margin:.35rem 0 0;font-size:.9rem}
.sw{display:inline-flex;gap:8px;align-items:center;min-height:44px;cursor:pointer;white-space:nowrap;flex:none;font-size:.9rem;color:var(--muted)}
.sw input[type=checkbox]{appearance:none;-webkit-appearance:none;width:46px;height:26px;border-radius:999px;background:var(--line);position:relative;margin:0;flex:none;border:1px solid var(--muted);cursor:pointer;transition:background .15s}
.sw input[type=checkbox]::after{content:"";position:absolute;top:2px;left:2px;width:20px;height:20px;border-radius:50%;background:var(--bg);box-shadow:0 0 0 1px var(--muted);transition:transform .15s}
.sw input[type=checkbox]:checked{background:var(--accent);border-color:var(--accent)}.sw input[type=checkbox]:checked::after{transform:translateX(20px);background:var(--accent-fg);box-shadow:none}
#info-error,.item p.err{color:var(--danger)}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:10px}.pair label{font-size:.9rem;color:var(--muted)}
.brandrow{display:flex;gap:10px;align-items:center}.brandrow input{flex:1;min-width:0}
section,.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin:0 0 14px}
fieldset{border:0;margin:0;padding:0;min-width:0}legend{font-weight:600;padding:0;margin-bottom:6px}
label{display:block}label.check{display:flex;gap:8px;align-items:flex-start;padding:6px 0;min-height:44px;align-items:center}label.check.tap{min-height:44px;align-items:center;margin-top:8px}label.check.tap input{width:24px;height:24px;margin:0}
input[type=text],input[type=search],input[type=date],input[type=time],input[type=url],textarea,select{width:100%;padding:10px;font:inherit;color:var(--fg);background:var(--field);border:1px solid var(--line);border-radius:8px}
textarea{min-height:76px;resize:vertical}input[type=range]{width:100%;height:44px}
input[type=checkbox],input[type=radio]{width:20px;height:20px;margin:2px 0 0;flex:none;accent-color:var(--accent)}
button,a.button{font:inherit;padding:9px 14px;min-height:40px;border-radius:8px;border:1px solid var(--line);background:var(--field);color:var(--fg);cursor:pointer;text-decoration:none;display:inline-block}
button.primary{background:var(--accent);color:var(--accent-fg);border-color:var(--accent);font-weight:700;width:100%;min-height:48px}
button.danger{color:var(--danger);border-color:var(--danger)}button:disabled{opacity:.5;cursor:not-allowed}
:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.grid2{display:grid;gap:10px}@media (min-width:560px){.grid2{grid-template-columns:1fr 1fr}}
.cards{display:grid;gap:8px}@media (min-width:560px){.cards{grid-template-columns:1fr 1fr}}
.cards label{border:1px solid var(--line);border-radius:10px;padding:10px;display:flex;gap:8px;background:var(--field)}
.cards label:has(input:checked){border-color:var(--accent);box-shadow:0 0 0 2px var(--accent)}
.cards small{display:block;color:var(--muted)}
.styles{gap:10px}.styles label{align-items:center;gap:12px;min-height:112px}.styles label>span{min-width:0;overflow-wrap:anywhere}.styles input[type=radio]{margin:0;align-self:flex-start}
canvas.thumb{flex:none;width:56px;height:auto;aspect-ratio:9/16;border-radius:6px;background:#000;border:1px solid var(--line)}
.styles label:has(input:focus-visible){outline:3px solid var(--accent);outline-offset:2px}#style-note{margin:8px 0 0}
ul.list{list-style:none;margin:6px 0;padding:0}.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:6px 0;border-top:1px solid var(--line)}.grow{flex:1 1 140px;min-width:0;overflow-wrap:anywhere}
.confirm{display:flex;gap:8px;flex-wrap:wrap}.tag{font-size:.8rem;color:var(--muted);margin-left:6px}
.sub{font-weight:600;margin:12px 0 2px}.person{display:flex;gap:10px;align-items:center;flex:1 1 200px;min-width:0}.who{min-width:0;overflow-wrap:anywhere}
.avatar{flex:none;width:44px;height:44px;border-radius:50%;background:var(--field);border:1px solid var(--line);display:inline-flex;align-items:center;justify-content:center;font-size:.8rem;font-weight:700;color:var(--muted);overflow:hidden}.avatar img{width:100%;height:100%;object-fit:cover}
.pills{display:flex;gap:4px;flex-wrap:wrap;margin-top:2px}.pill{font-size:.75rem;border:1px solid var(--line);border-radius:999px;padding:1px 8px;color:var(--muted);background:var(--field)}
.status{padding:10px 12px;border-radius:8px;margin:0 0 12px;border:1px solid var(--line);background:var(--card)}.status.error{border-color:var(--danger);color:var(--danger)}.status.ok{border-color:var(--ok)}
.banner{padding:10px 12px;border-radius:8px;background:var(--card);border:1px solid var(--accent);margin:0 0 12px}
canvas#preview{display:block;width:100%;max-width:340px;max-height:70vh;margin:0 auto;border-radius:10px;background:#000;object-fit:contain}
.bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:10px 0}.bar .grow{flex:1}
progress{width:100%;height:14px}
details>summary{cursor:pointer;font-weight:600;padding:6px 0;min-height:44px;display:list-item}
.sr{position:absolute;left:-9999px}
[hidden]{display:none!important}
.chosen{padding:10px 12px;border:1px solid var(--accent);border-radius:10px;background:var(--field);margin:0 0 12px;overflow-wrap:anywhere}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}.chips button{min-height:44px;border-radius:999px;padding:6px 14px}
.chips button[aria-pressed=true]{background:var(--accent);color:var(--accent-fg);border-color:var(--accent);font-weight:600}
ul.events{list-style:none;margin:10px 0;padding:0;display:grid;gap:8px}
button.event{display:block;width:100%;text-align:left;padding:10px 12px;min-height:60px;border:1px solid var(--line);border-radius:10px;background:var(--field);color:var(--fg)}
button.event[aria-pressed=true]{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent)}
.event .top{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center;font-size:.85rem;color:var(--muted)}
.event .ttl{display:block;font-weight:600;margin-top:4px;overflow-wrap:anywhere}
.event .more{display:block;font-size:.85rem;color:var(--muted);margin-top:2px}
.src{display:inline-flex;align-items:center;gap:6px;font-size:.78rem;border:1px solid var(--line);border-radius:999px;padding:1px 9px;color:var(--fg);background:var(--card)}
.src::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--dot,var(--muted));flex:none}
.src-calendar{--dot:#4f46e5}.src-youtube{--dot:#d92d20}.src-twitch{--dot:#8b5cf6}
.srcnotes p{margin:.35rem 0}button.wide{min-height:48px}
header{margin:0 0 12px}h3{font-size:1rem;margin:12px 0 6px}
.chosen{display:grid;gap:4px}.chosen .lead{font-size:.85rem;color:var(--muted)}.chosen .ttl2{font-size:1.15rem;font-weight:700}.chosen .when{font-size:1rem}
.badge{display:inline-block;font-size:.78rem;font-weight:700;border-radius:999px;padding:1px 9px;background:var(--accent);color:var(--accent-fg)}
.picker{margin-top:12px;padding-top:4px;border-top:1px solid var(--line)}
button,a.button{min-height:44px}
details.sub-d{border:1px solid var(--line);border-radius:10px;background:var(--field);margin:10px 0}details.sub-d>summary{padding:10px 12px;min-height:48px}details.sub-d>.inner{padding:0 12px 12px}
.field{margin-top:12px}.advtoggle{margin-top:12px;border-top:1px solid var(--line);padding-top:6px}.advanced{margin-top:8px;padding:12px;border:1px dashed var(--line);border-radius:10px}
#result p,#progress-box p{margin:.25rem 0;font-size:.9rem}#result a.button{width:100%;text-align:center;margin-top:4px}#models-box .bar{flex-wrap:wrap}#models-box .bar input{flex:1 1 200px;width:auto;min-width:0}
@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
button.busy{position:relative}button[aria-busy=true]{cursor:progress}
`;

/** The page. `cfg`: what the editor already knows (colours, time zone, address of the routes). */
export function studioPage(ctx, { base, colors, timezone, font, accent, accentFg }) {
  const T = (k) => esc(ctx.t(`ui_${k}`));
  const lang = ctx.locale === "en" ? "en" : "fr";
  const config = { base, lang, colors, timezone: timezone || "", font, labels: labelsOf(ctx), formats: P.FORMATS };
  const json = JSON.stringify(config).replace(/</g, "\\u003c").replace(LINE_SEPARATORS, (c) => `\\u${c.charCodeAt(0).toString(16)}`);
  const style = (id) => `<label for="style-${id}" class="stylecard"><input type="radio" name="style" id="style-${id}"><canvas class="thumb" data-style="${id}" width="108" height="192" aria-hidden="true"></canvas><span>${T(`style_${id}`)}<small>${T(`style_${id}_hint`)}</small></span></label>`;
  // One item of the information step: a label, the "In the video" switch (the same tick as the element it controls: removing = unticking) and the field(s).
  const sw = (id) => `<label class="sw" for="el-${id}"><input type="checkbox" role="switch" id="el-${id}" aria-labelledby="lbl-${id} sw-${id}"><span id="sw-${id}">${T("in_video")}</span></label>`;
  const head = (id, field, key) => `<div class="ihead"><label id="lbl-${id}" for="${field}">${T(key)}</label>${sw(id)}</div>`;
  const plain = (id, key) => `<div class="ihead"><span id="lbl-${id}" class="lbl">${T(key)}</span>${sw(id)}</div>`;
  const body = `<main id="app">
<header><h1>${T("title")}</h1><p class="muted">${T("help_intro")}</p></header>
<div id="status" class="status" role="status" aria-live="polite" hidden></div>
<p id="prep-note" class="banner" hidden>${T("prep_note")}</p><p id="prep-expired" class="banner" hidden>${T("prep_expired")}</p><p id="prep-stream-gone" class="banner" hidden>${T("prep_stream_gone")}</p>
<div class="wiz">
<div class="top"><nav class="stepper" aria-label="${T("steps_label")}"><ol>
<li><button type="button" id="step-btn-1" class="stepbtn" data-step="1"><b>1</b> <span>${T("step_1")}</span></button></li>
<li><button type="button" id="step-btn-2" class="stepbtn" data-step="2"><b>2</b> <span>${T("step_2")}</span></button></li>
<li><button type="button" id="step-btn-3" class="stepbtn" data-step="3"><b>3</b> <span>${T("step_3")}</span></button></li></ol></nav>
<aside class="previewcol" aria-label="${T("h_preview")}"><div class="card" id="pv"><h2 class="pvh">${T("h_preview")}</h2>
<canvas id="preview" width="540" height="960" role="img" aria-label="${T("preview_label")}"></canvas>
<div class="bar"><button type="button" id="play" aria-pressed="true">${T("pause")}</button><button type="button" id="replay">${T("replay")}</button><span id="time" class="muted"></span></div>
<p id="pv-note" class="muted">${T("pv_plain")}</p>
<p id="reduced" class="muted" hidden>${T("reduced")}</p><p id="empty" class="warn" role="alert" hidden>${T("empty")}</p><p class="muted">${T("silent_note")}</p></div></aside></div>
<p id="step-live" class="sr" role="status" aria-live="polite"></p>
<div class="panels">
<section id="step-1" class="step pick" aria-labelledby="h-event"><h2 id="h-event" tabindex="-1">${T("h_event")}</h2>
<div id="event-chosen" class="chosen" role="status" aria-live="polite"></div>
<p id="event-same" class="muted" hidden></p>
<p id="event-note" class="muted" role="status" aria-live="polite"></p>
<div id="event-alert" class="srcnotes" role="status" aria-live="polite"></div>
<div class="bar"><button type="button" id="event-change" class="wide" aria-expanded="false" aria-controls="event-picker">${T("event_change")}</button><button type="button" id="event-none" class="wide" aria-pressed="false">${T("event_none_btn")}</button><button type="button" id="event-retry" class="wide" hidden>${T("event_retry")}</button></div>
<div id="event-picker" class="picker" role="group" aria-labelledby="h-pick" hidden><h3 id="h-pick" tabindex="-1">${T("event_pick_title")}</h3>
<div id="event-search-box" hidden><label for="event-q">${T("event_search")}</label><input type="search" id="event-q" maxlength="80" autocomplete="off" placeholder="${T("event_search_ph")}">
<div id="event-filter" class="chips" role="group" aria-label="${T("event_sources")}" hidden></div></div>
<p id="event-match" class="muted" role="status" aria-live="polite"></p>
<ul id="event-list" class="events"></ul>
<p id="event-count" class="muted" role="status" aria-live="polite"></p>
<div class="bar"><button type="button" id="event-more" class="wide" hidden>${T("event_more")}</button></div></div>
<div id="event-sources" class="srcnotes" role="status" aria-live="polite"></div></section>
<section id="step-2" class="step" aria-labelledby="h-info" hidden><h2 id="h-info" tabindex="-1">${T("h_info")}</h2><p class="muted">${T("info_intro")}</p>
<fieldset class="group"><legend>${T("g_event")}</legend>
<div class="item" id="item-title">${head("title", "info-title", "f_title")}<input type="text" id="info-title" maxlength="${P.LIMITS.title}" autocomplete="off" placeholder="${T("ph_title")}"></div>
<div class="item" id="item-when">${plain("when", "f_when")}<div class="pair"><div><label for="info-date">${T("f_date")}</label><input type="date" id="info-date" aria-describedby="info-time-hint info-error"></div><div><label for="info-time">${T("f_time")}</label><input type="time" id="info-time" aria-describedby="info-time-hint info-error"></div></div>
<p id="info-time-hint" class="muted">${T("m_time_hint")}</p><p id="info-error" class="warn" role="alert"></p></div>
<div class="item" id="item-game">${head("game", "info-game", "f_game")}<input type="text" id="info-game" maxlength="80" autocomplete="off" placeholder="${T("ph_game")}" aria-describedby="game-help"><p id="game-help" class="muted">${T("game_help")}</p><p id="cover-warn" class="warn" hidden></p></div>
<div class="item" id="item-countdown">${plain("countdown", "f_countdown")}<p id="countdown-note" class="muted"></p></div></fieldset>
<fieldset class="group"><legend>${T("g_own")}</legend>
<div class="item" id="item-text">${head("text", "text", "text_label")}<textarea id="text" maxlength="400" placeholder="${T("ph_text")}" aria-describedby="text-help"></textarea><p id="text-help" class="muted"><span id="text-count"></span> · ${T("text_help")}</p></div>
<div class="item" id="item-costreamers">${plain("costreamers", "h_members")}<p id="members-sum" class="muted"></p>
<details id="members-box" class="sub-d"><summary>${T("members_pick")} <span id="members-count" class="muted"></span></summary><div class="inner" aria-labelledby="h-members"><p id="h-members" class="muted">${T("members_help")}</p>
<label class="check tap" for="schedule-people"><input type="checkbox" id="schedule-people" aria-describedby="schedule-people-help"><span>${T("schedule_people_label")}</span></label><p id="schedule-people-help" class="muted" style="margin-top:0">${T("schedule_people_help")}</p>
<p class="sub">${T("members_chosen")}</p><ul class="list" id="chosen"></ul><p id="members-note" class="muted" role="status"></p>
<div id="book-box" hidden><label for="q">${T("search_label")}</label><input type="search" id="q" maxlength="100" autocomplete="off" placeholder="${T("search_placeholder")}" aria-describedby="q-note"><p id="q-note" class="muted" role="status" aria-live="polite">${T("search_hint")}</p>
<ul class="list" id="results"></ul><button type="button" id="results-more" hidden>${T("show_more")}</button>
<details id="cat-box"><summary>${T("cat_title")}</summary><label for="cat">${T("cat_label")}</label><select id="cat"></select><div class="bar"><button type="button" id="cat-more-cats" hidden>${T("cat_more")}</button></div>
<p id="cat-note" class="muted" role="status" aria-live="polite"></p><ul class="list" id="cat-results"></ul>
<div class="bar"><button type="button" id="cat-add-first" hidden></button><button type="button" id="cat-more" hidden>${T("show_more")}</button></div></details></div>
<p id="book-absent" class="banner" hidden>${T("book_absent")}</p>
<details id="adhoc-box"><summary>${T("adhoc_title")}</summary><p class="muted">${T("adhoc_help")}</p>
<div class="grid2"><div><label for="a-login">${T("a_login")}</label><input type="text" id="a-login" maxlength="40" autocomplete="off" aria-describedby="a-error"></div><div><label for="a-name">${T("a_name")}</label><input type="text" id="a-name" maxlength="40" autocomplete="off" aria-describedby="a-error"></div>
<div style="grid-column:1/-1"><label for="a-image">${T("a_image")}</label><input type="url" id="a-image" maxlength="400" autocomplete="off" aria-describedby="a-image-help a-error"><p id="a-image-help" class="muted">${T("a_image_help")}</p></div></div>
<p id="a-error" class="warn" role="alert"></p><div class="bar"><button type="button" id="adhoc-add">${T("add")}</button></div></details>
<div id="saved-box" hidden><p class="sub">${T("saved_title")}</p><p class="muted">${T("saved_help")}</p><ul class="list" id="saved-list"></ul></div></div></details></div>
<div class="item" id="item-brand">${head("brand", "channel", "f_brand")}<div class="brandrow"><span id="brand-logo" aria-hidden="true"></span><input type="text" id="channel" maxlength="${P.LIMITS.channelName}" autocomplete="off" aria-describedby="channel-help"></div><p id="channel-help" class="muted">${T("channel_help")}</p></div></fieldset>
<details id="more-2" class="sub-d"><summary>${T("more_options")}</summary><div class="inner"><div class="field"><label for="lang">${T("lang_label")}</label><select id="lang"><option value="fr">${T("lang_fr")}</option><option value="en">${T("lang_en")}</option></select></div></div></details></section>
<section id="step-3" class="step" aria-labelledby="h-style" hidden><h2 id="h-style" tabindex="-1">${T("h_style")}</h2>
<div id="progress-box" hidden><progress id="progress" max="1" value="0" aria-label="${T("progress_label")}"></progress><p id="progress-text" class="muted" aria-live="polite"></p><button type="button" id="cancel">${T("cancel_video")}</button></div>
<div id="result" hidden></div>
<p class="muted">${T("style_intro")}</p>
<fieldset><legend class="sr">${T("style_label")}</legend><div class="cards styles">${P.STYLES.map(style).join("")}</div><p id="style-note" class="muted" role="status" aria-live="polite" hidden></p></fieldset>
<fieldset style="margin-top:12px"><legend>${T("format_label")}</legend><div class="cards">
<label for="format-vertical"><input type="radio" name="format" id="format-vertical"><span>${T("format_vertical")}</span></label>
<label for="format-passeport"><input type="radio" name="format" id="format-passeport"><span>${T("format_passeport")}</span></label></div><p id="fmt-note" class="muted"></p></fieldset>
<label class="check tap" for="watermark"><input type="checkbox" id="watermark" aria-describedby="watermark-help"><span>${T("watermark_label")}</span></label><p id="watermark-help" class="muted" style="margin-top:0">${T("watermark_help")}</p>
<p id="cover-warn-3" class="warn" hidden></p>
<details id="more-3" class="sub-d"><summary>${T("more_options")}</summary><div class="inner">
<div class="field"><label for="duration">${T("duration_label")} <strong id="duration-out"></strong></label><input type="range" id="duration" min="${P.LIMITS.durationMin}" max="${P.LIMITS.durationMax}" step="1" aria-describedby="duration-help"><p id="duration-help" class="muted">${T("duration_help")}</p></div>
<label class="check tap" for="safe"><input type="checkbox" id="safe" aria-describedby="safe-help"><span>${T("safe_label")}</span></label><p id="safe-help" class="muted" style="margin-top:0">${T("safe_help")}</p></div></details>
<details id="models-box" class="sub-d"><summary>${T("h_models")}</summary><div class="inner"><p class="muted">${T("models_help")}</p>
<label for="model-name">${T("model_name")}</label><div class="bar"><input type="text" id="model-name" class="grow" maxlength="60" autocomplete="off" aria-describedby="model-error"><button type="button" id="model-save">${T("model_save")}</button></div><p id="model-error" class="warn" role="alert"></p><ul class="list" id="model-list"></ul></div></details>
</section>
<div class="navbar" role="group" aria-label="${T("steps_label")}"><div class="navrow"><button type="button" id="step-prev" hidden>${T("prev")}</button><button type="button" class="primary" id="step-next">${T("next_info")}</button><button type="button" class="primary" id="generate" hidden>${T("generate")}</button></div>
<button type="button" class="nowbtn" id="generate-now">${T("gen_now")}</button></div></div>
</div></main>
<main id="noaccess" hidden><h1>${T("no_access")}</h1><p>${T("no_access_hint")}</p></main>`;
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${T("title")}</title>
<style>${CSS}:root{--accent:${esc(accent)};--accent-fg:${esc(accentFg)}}</style></head><body>${body}
<script type="application/json" id="story-config">${json}</script><script type="module" src="lib/app.mjs"></script></body></html>`;
  return new Response(html, { headers: {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' blob: data:; media-src blob:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
  } });
}
