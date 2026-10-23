// La page de l'éditeur (servie par la route `studio`, dans un cadre du panneau d'administration) et les fichiers de code qu'elle charge (route `lib/…`).
// La page ne contient AUCUNE donnée de la personne : seulement des phrases, des couleurs et des réglages. Les données arrivent par les routes protégées par un jeton.
import { readFile } from "node:fs/promises";
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const P = await import(`./pure.mjs${v}`);

const LINE_SEPARATORS = new RegExp(`[${String.fromCharCode(0x2028, 0x2029)}]`, "g");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
/** Les phrases de la page (clés `ui_…` des locales, sans le préfixe). */
export const KEYS = [
  "title", "no_access", "no_access_hint", "prep_note", "prep_expired", "prep_stream_gone", "help_intro",
  "h_event", "event_help", "event_chosen", "event_none_chosen", "event_manual_chosen", "event_search", "event_search_ph", "event_sources", "event_all", "event_loading", "event_none", "event_no_match", "event_count", "event_more", "event_capped",
  "event_zone", "event_local", "event_also", "event_picked", "event_row", "event_retry", "event_manual", "event_manual_close", "event_all_down", "event_busy", "event_ready", "ev_down", "ev_down_stale", "ev_setup", "ev_note",
  "type_stream", "type_live", "type_premiere", "type_video", "type_event", "type_other",
  "cover_no_key", "untitled", "m_title", "m_date", "m_time", "m_time_hint", "manual_title", "manual_date", "manual_time",
  "h_elements", "el_title", "el_when", "el_countdown", "el_game", "el_brand", "el_text", "el_costreamers", "countdown_is", "no_stream_info",
  "h_texts", "text_label", "text_help", "channel_label", "channel_help", "lang_label", "lang_fr", "lang_en",
  "h_look", "style_label", "style_neon", "style_neon_hint", "style_poster", "style_poster_hint", "style_countdown", "style_countdown_hint", "style_minimal", "style_minimal_hint",
  "watermark_label", "watermark_help", "format_label", "format_vertical", "format_passeport", "format_help_vertical", "format_help_passeport", "duration_label", "duration_help", "seconds",
  "h_members", "members_help", "members_chosen", "members_none", "members_max", "member_missing", "member_unreadable", "member_loading", "only_this_video", "legacy_tag",
  "search_label", "search_placeholder", "search_hint", "search_busy", "search_none", "search_slow", "search_refine", "show_more", "add", "already", "remove",
  "cat_title", "cat_label", "cat_choose", "cat_none", "cat_empty", "cat_gone", "cat_more", "cat_add_first", "cat_added", "cat_full", "book_absent",
  "adhoc_title", "adhoc_help", "a_login", "a_name", "a_image", "a_image_help", "saved_title", "saved_help", "migrated_note", "net_web", "net_other",
  "h_models", "models_help", "model_name", "model_save", "models_none", "load", "replace", "cancel", "model_exists", "model_saved", "model_loaded", "model_replaced", "model_removed", "confirm_replace_model", "confirm_remove_model",
  "h_preview", "preview_label", "play", "pause", "replay", "safe_label", "safe_help", "zone_ui", "zone_grid", "reduced", "empty", "generate", "progress_start", "progress", "progress_finish", "cancelled", "cancel_video",
  "done", "download_again", "webm_notice", "recorder_notice", "err_unsupported", "err_encoder", "err_auth", "err_network", "err_empty", "err_invalid", "err_full", "err_missing", "err_name", "err_exists", "err_image", "err_generic",
  "silent_note",
];
export const labelsOf = (ctx) => Object.fromEntries(KEYS.map((k) => [k, ctx.t(`ui_${k}`)]));

/** Les fichiers que la page charge : la liste est fermée (jamais un nom donné par la requête). */
export const LIB = ["pure.mjs", "scenes.mjs", "mp4.mjs", "encode.mjs", "app.mjs"];
const sourceCache = new Map();
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
.layout{display:grid;gap:16px}
@media (min-width:720px){.layout{grid-template-columns:minmax(0,1fr) 340px;align-items:start}.previewcol{position:sticky;top:12px}}
@media (max-width:719px){.layout{display:flex;flex-direction:column;gap:0}#controls{display:contents}section.pick{order:-2}.previewcol{order:-1}}
section,.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin:0 0 14px}
fieldset{border:0;margin:0;padding:0;min-width:0}legend{font-weight:600;padding:0;margin-bottom:6px}
label{display:block}label.check{display:flex;gap:8px;align-items:flex-start;padding:6px 0;min-height:32px}label.check.tap{min-height:44px;align-items:center;margin-top:8px}label.check.tap input{width:24px;height:24px;margin:0}
input[type=text],input[type=search],input[type=date],input[type=time],input[type=url],textarea,select{width:100%;padding:10px;font:inherit;color:var(--fg);background:var(--field);border:1px solid var(--line);border-radius:8px}
textarea{min-height:76px;resize:vertical}input[type=range]{width:100%}
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
details>summary{cursor:pointer;font-weight:600;padding:6px 0;min-height:32px}
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
`;

/** La page. `cfg` : ce que l'éditeur sait déjà (couleurs, fuseau, adresse des routes). */
export function studioPage(ctx, { base, colors, timezone, font, accent, accentFg }) {
  const T = (k) => esc(ctx.t(`ui_${k}`));
  const lang = ctx.locale === "en" ? "en" : "fr";
  const config = { base, lang, colors, timezone: timezone || "", font, labels: labelsOf(ctx), formats: P.FORMATS };
  const json = JSON.stringify(config).replace(/</g, "\\u003c").replace(LINE_SEPARATORS, (c) => `\\u${c.charCodeAt(0).toString(16)}`);
  const check = (id, key) => `<label class="check" for="el-${id}"><input type="checkbox" id="el-${id}"><span>${T(key)}</span></label>`;
  const style = (id) => `<label for="style-${id}"><input type="radio" name="style" id="style-${id}"><span>${T(`style_${id}`)}<small>${T(`style_${id}_hint`)}</small></span></label>`;
  const body = `<main id="app">
<h1>${T("title")}</h1><p class="muted">${T("help_intro")}</p>
<div id="status" class="status" role="status" aria-live="polite" hidden></div>
<p id="prep-note" class="banner" hidden>${T("prep_note")}</p><p id="prep-expired" class="banner" hidden>${T("prep_expired")}</p><p id="prep-stream-gone" class="banner" hidden>${T("prep_stream_gone")}</p>
<div class="layout"><div id="controls">
<section class="pick" aria-labelledby="h-event"><h2 id="h-event">${T("h_event")}</h2><p class="muted">${T("event_help")}</p>
<div id="event-chosen" class="chosen" role="status" aria-live="polite"></div>
<div id="event-picker"><label for="event-q">${T("event_search")}</label><input type="search" id="event-q" maxlength="80" autocomplete="off" placeholder="${T("event_search_ph")}">
<div id="event-filter" class="chips" role="group" aria-label="${T("event_sources")}" hidden></div>
<p id="event-note" class="muted" role="status" aria-live="polite"></p>
<ul id="event-list" class="events"></ul>
<p id="event-count" class="muted" role="status" aria-live="polite"></p>
<div class="bar"><button type="button" id="event-more" class="wide" hidden>${T("event_more")}</button><button type="button" id="event-retry" class="wide" hidden>${T("event_retry")}</button></div>
<div id="event-sources" class="srcnotes" role="status" aria-live="polite"></div></div>
<button type="button" id="event-manual-toggle" class="wide" aria-expanded="false" aria-controls="manual">${T("event_manual")}</button>
<div id="manual" hidden><div class="grid2"><div style="grid-column:1/-1"><label for="m-title">${T("m_title")}</label><input type="text" id="m-title" maxlength="80" autocomplete="off"></div>
<div><label for="m-date">${T("m_date")}</label><input type="date" id="m-date"></div><div><label for="m-time">${T("m_time")}</label><input type="time" id="m-time"></div></div>
<p class="muted">${T("m_time_hint")}</p><p id="manual-error" class="warn" role="alert"></p></div></section>
<section><fieldset><legend>${T("h_elements")}</legend>${check("title", "el_title")}${check("when", "el_when")}${check("countdown", "el_countdown")}${check("game", "el_game")}${check("brand", "el_brand")}${check("text", "el_text")}${check("costreamers", "el_costreamers")}
<p id="countdown-note" class="muted"></p><p id="nostream" class="warn" hidden>${T("no_stream_info")}</p></fieldset></section>
<section><h2>${T("h_texts")}</h2>
<label for="text">${T("text_label")}</label><textarea id="text" maxlength="400"></textarea><p class="muted"><span id="text-count"></span> · ${T("text_help")}</p>
<label for="channel">${T("channel_label")}</label><input type="text" id="channel" maxlength="40" autocomplete="off"><p class="muted">${T("channel_help")}</p>
<label for="lang">${T("lang_label")}</label><select id="lang"><option value="fr">${T("lang_fr")}</option><option value="en">${T("lang_en")}</option></select></section>
<section><h2>${T("h_look")}</h2>
<fieldset><legend>${T("style_label")}</legend><div class="cards">${style("neon")}${style("poster")}${style("countdown")}${style("minimal")}</div></fieldset>
<fieldset style="margin-top:12px"><legend>${T("format_label")}</legend><div class="cards">
<label for="format-vertical"><input type="radio" name="format" id="format-vertical"><span>${T("format_vertical")}</span></label>
<label for="format-passeport"><input type="radio" name="format" id="format-passeport"><span>${T("format_passeport")}</span></label></div><p id="fmt-note" class="muted"></p></fieldset>
<label for="duration" style="margin-top:12px">${T("duration_label")} : <strong id="duration-out"></strong></label><input type="range" id="duration" min="${P.LIMITS.durationMin}" max="${P.LIMITS.durationMax}" step="1"><p class="muted">${T("duration_help")}</p>
<label class="check tap" for="watermark"><input type="checkbox" id="watermark" aria-describedby="watermark-help"><span>${T("watermark_label")}</span></label><p id="watermark-help" class="muted" style="margin-top:0">${T("watermark_help")}</p></section>
<section aria-labelledby="h-members"><h2 id="h-members">${T("h_members")}</h2><p class="muted">${T("members_help")}</p>
<p id="migrated" class="banner" hidden></p>
<p class="sub">${T("members_chosen")}</p><ul class="list" id="chosen"></ul><p id="members-note" class="muted" role="status"></p>
<div id="book-box" hidden><label for="q">${T("search_label")}</label><input type="search" id="q" maxlength="100" autocomplete="off" placeholder="${T("search_placeholder")}" aria-describedby="q-note"><p id="q-note" class="muted" role="status" aria-live="polite">${T("search_hint")}</p>
<ul class="list" id="results"></ul><button type="button" id="results-more" hidden>${T("show_more")}</button>
<details id="cat-box"><summary>${T("cat_title")}</summary><label for="cat">${T("cat_label")}</label><select id="cat"></select><div class="bar"><button type="button" id="cat-more-cats" hidden>${T("cat_more")}</button></div>
<p id="cat-note" class="muted" role="status" aria-live="polite"></p><ul class="list" id="cat-results"></ul>
<div class="bar"><button type="button" id="cat-add-first" hidden></button><button type="button" id="cat-more" hidden>${T("show_more")}</button></div></details></div>
<p id="book-absent" class="banner" hidden>${T("book_absent")}</p>
<details id="adhoc-box" open><summary>${T("adhoc_title")}</summary><p class="muted">${T("adhoc_help")}</p>
<div class="grid2"><div><label for="a-login">${T("a_login")}</label><input type="text" id="a-login" maxlength="40" autocomplete="off"></div><div><label for="a-name">${T("a_name")}</label><input type="text" id="a-name" maxlength="40" autocomplete="off"></div>
<div style="grid-column:1/-1"><label for="a-image">${T("a_image")}</label><input type="url" id="a-image" maxlength="400" autocomplete="off" aria-describedby="a-image-help"><p id="a-image-help" class="muted">${T("a_image_help")}</p></div></div>
<p id="a-error" class="warn" role="alert"></p><div class="bar"><button type="button" id="adhoc-add">${T("add")}</button></div></details>
<div id="saved-box" hidden><p class="sub">${T("saved_title")}</p><p class="muted">${T("saved_help")}</p><ul class="list" id="saved-list"></ul></div></section>
<section><h2>${T("h_models")}</h2><p class="muted">${T("models_help")}</p>
<label for="model-name">${T("model_name")}</label><div class="bar"><input type="text" id="model-name" class="grow" maxlength="60" autocomplete="off"><button type="button" id="model-save">${T("model_save")}</button></div><ul class="list" id="model-list"></ul></section>
</div>
<aside class="previewcol"><div class="card"><h2>${T("h_preview")}</h2>
<canvas id="preview" width="540" height="960" role="img" aria-label="${T("preview_label")}"></canvas>
<div class="bar"><button type="button" id="play" aria-pressed="true">${T("pause")}</button><button type="button" id="replay">${T("replay")}</button><span id="time" class="muted"></span></div>
<label class="check" for="safe"><input type="checkbox" id="safe"><span>${T("safe_label")}</span></label><p class="muted">${T("safe_help")}</p>
<p id="reduced" class="muted" hidden>${T("reduced")}</p><p id="empty" class="warn" role="alert" hidden>${T("empty")}</p><p class="muted">${T("silent_note")}</p>
<button type="button" class="primary" id="generate">${T("generate")}</button>
<div id="progress-box" hidden><progress id="progress" max="1" value="0"></progress><p id="progress-text" class="muted" aria-live="polite"></p><button type="button" id="cancel">${T("cancel_video")}</button></div>
<div id="result" hidden></div></div></aside></div></main>
<main id="noaccess" hidden><h1>${T("no_access")}</h1><p>${T("no_access_hint")}</p></main>`;
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${T("title")}</title>
<style>${CSS}:root{--accent:${esc(accent)};--accent-fg:${esc(accentFg)}}</style></head><body>${body}
<script type="application/json" id="story-config">${json}</script><script type="module" src="lib/app.mjs"></script></body></html>`;
  return new Response(html, { headers: {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' blob: data:; media-src blob:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
  } });
}
