// Compte à rebours — ce que voient les visiteurs : les cartes, la page, l'accueil et la source navigateur pour OBS.
//
// Chaque carte est écrite en HTML complet côté serveur : sans JavaScript, le visiteur lit la date et l'heure dans le fuseau
// de l'événement (et les chiffres tels qu'ils étaient à l'ouverture de la page). Avec JavaScript, la page prend le relais :
// l'heure chez le visiteur, les chiffres qui avancent, le message de fin au bon moment.
const V = new URL(import.meta.url).search;
const T = await import(`./time.mjs${V}`);
const M = await import(`./model.mjs${V}`);

/** Échappe le texte avant de le mettre dans du HTML ou dans un attribut : le bloc `html` du cœur est brut. */
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const safeColor = (v) => (/^#[0-9a-fA-F]{6}$/.test(String(v ?? "")) ? String(v) : null);

/** Adresse de la page de l'instance (null si elle n'a pas de page). */
export function pageHref(ctx, localized = true) {
  const base = ctx.instance.basePath;
  if (base === null || base === undefined) return null;
  const prefix = localized && ctx.locale !== ctx.defaultLocale ? `/${ctx.locale}` : "";
  return `${prefix}${base ? `/${base}` : ""}` || "/";
}
export const eventHref = (ctx, v) => {
  const base = pageHref(ctx);
  return base === null ? null : `${base === "/" ? "" : base}/${v.slug}`;
};

export const icsHref = (ctx, v) => `/m/${ctx.instance.key}/ics?e=${encodeURIComponent(v.slug)}`;
/** Adresse complète (pour le fichier d'agenda). */
export function absoluteEventUrl(ctx, v) {
  const href = eventHref(ctx, v);
  return href === null ? "" : `${ctx.api.siteUrl}${href}`;
}

/** Les mots que le navigateur a besoin de connaître (jours, « demain », « chez vous »…) dans la langue de la page. */
export function labels(ctx) {
  const units = (k) => String(ctx.t(k)).split("|");
  return {
    today: ctx.t("today"), tomorrow: ctx.t("tomorrow"), at: ctx.t("at"), local: ctx.t("localTemplate"),
    d: units("unit_d"), h: units("unit_h"), m: units("unit_m"), s: units("unit_s"),
    srIn: ctx.t("srIn"), and: ctx.t("and"), lessMin: ctx.t("lessMin"),
  };
}

/** Le message de fin : celui de l'événement, sinon celui des réglages, sinon « C'est parti ! ». */
export const endMessage = (ctx, v) => v.endMessage || M.clean(ctx.setting("endMessage"), 140) || ctx.t("endDefault");

const CSS = `
.vcd-wrap{display:grid;gap:16px}
.vcd{display:grid;gap:10px;padding:20px;border:1px solid var(--v-line);border-radius:16px;background:var(--v-surface);color:var(--v-fg);overflow-wrap:anywhere}
.vcd[hidden],.vcd [hidden]{display:none!important}
.vcd-kicker{margin:0;font-size:.8rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--v-muted)}
.vcd-title{margin:0;font-size:1.25rem;line-height:1.25;font-weight:700}
.vcd--big .vcd-title{font-size:clamp(1.5rem,5vw,2.25rem)}
.vcd-when{margin:0;font-size:.95rem;color:var(--v-muted)}
.vcd-local{color:var(--v-fg);font-weight:600}
.vcd-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(64px,1fr));gap:8px;max-width:440px}
.vcd-t{display:flex;flex-direction:column;align-items:center;padding:10px 4px;border:1px solid var(--v-line);border-radius:12px;background:var(--v-bg)}
.vcd-n{font-size:clamp(1.6rem,7vw,2.5rem);font-weight:700;line-height:1.1;font-variant-numeric:tabular-nums}
.vcd--compact .vcd-n{font-size:clamp(1.25rem,5vw,1.6rem)}
.vcd-l{font-size:.75rem;color:var(--v-muted)}
.vcd-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.vcd-actions{display:flex;flex-wrap:wrap;gap:8px;margin:0}
.vcd-btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 18px;border-radius:999px;background:var(--v-accent);color:var(--v-accent-fg);font-weight:600;text-decoration:none}
.vcd-btn--ghost{background:transparent;color:var(--v-fg);border:1px solid var(--v-line)}
.vcd-btn:hover{opacity:.9}
.vcd :focus-visible{outline:2px solid var(--v-accent);outline-offset:2px}
.vcd-end{display:grid;gap:10px;padding:14px 16px;border-left:4px solid var(--v-accent);border-radius:8px;background:var(--v-bg)}
.vcd-endmsg{margin:0;font-size:1.4rem;font-weight:700}
.vcd--big .vcd-endmsg{font-size:clamp(1.6rem,6vw,2.4rem)}
.vcd-desc{margin:0;white-space:pre-line}
.vcd-where{margin:0;color:var(--v-muted)}
.vcd-img{width:100%;max-height:240px;object-fit:cover;border-radius:12px}
.vcd-more{color:var(--v-fg);font-weight:600}
.vcd-empty{margin:0;color:var(--v-muted)}
.vcd-nav{display:flex;flex-wrap:wrap;gap:12px}
.vcd-nav a{display:inline-flex;align-items:center;min-height:44px;color:var(--v-fg);font-weight:600}
@media (prefers-reduced-motion:no-preference){.vcd-end{animation:vcd-in .4s ease-out}}
@keyframes vcd-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.vcd *{animation:none!important;transition:none!important}}
`.replace(/\n/g, "");

/** Enveloppe d'un groupe de cartes : le style, et les mots dont le navigateur a besoin. */
export function wrap(ctx, inner, now) {
  const cfg = { lang: ctx.locale, L: labels(ctx), nowUrl: `/m/${ctx.instance.key}/now` };
  return `<div class="vcd-wrap" data-vcd-cfg="${esc(JSON.stringify(cfg))}"><style>${CSS}</style>${inner}</div>`;
}

/**
 * Une carte. variant : "big" (la une, la page d'un événement), "card" (la liste), "compact" (l'accueil).
 * Options : kicker (petit texte au-dessus), noTitle (la page a déjà ce titre), href (lien « voir la page »), details (description, lieu, image), now.
 */
export function card(ctx, v, { variant = "card", kicker = "", noTitle = false, href = null, details = false, now = Date.now() } = {}) {
  const lang = ctx.locale;
  const L = labels(ctx);
  const secs = ctx.setting("showSeconds") !== false;
  const started = v.phase === "started";
  const b = T.breakdown(Math.max(0, v.startMs - now));
  const lines = T.linesFor(v.startMs, now, v.tz, "", lang, L, v.allDay);
  const tile = (k, n, extra = "") => `<div class="vcd-t"${extra}><span class="vcd-n" data-vcd-u-${k}="">${n}</span><span class="vcd-l" data-vcd-l-${k}="">${esc(T.plural(b[k], L[k], lang))}</span></div>`;
  const tiles = tile("d", b.d) + tile("h", T.pad2(b.h)) + tile("m", T.pad2(b.m)) + tile("s", T.pad2(b.s), ` data-vcd-t-s=""${secs ? "" : " hidden"}`);
  const hide = Number.isFinite(v.hideMs) ? Math.round(v.hideMs) : 0;
  const msg = endMessage(ctx, v);
  const link = v.endLink ? `<p class="vcd-actions"><a class="vcd-btn" href="${esc(v.endLink)}"${/^https?:/i.test(v.endLink) ? ' rel="noopener noreferrer"' : ""}>${esc(v.endLinkLabel || ctx.t("endLinkDefault"))}</a></p>` : "";
  const parts = [
    kicker ? `<p class="vcd-kicker" data-vcd-kicker="" data-end-text="${esc(ctx.t("kickerStarted"))}">${esc(kicker)}</p>` : "",
    noTitle ? "" : `<h3 class="vcd-title">${href ? `<a href="${esc(href)}" style="color:inherit;text-decoration:none">${esc(v.title)}</a>` : esc(v.title)}</h3>`,
    v.image && details ? `<img class="vcd-img" src="${esc(v.image)}" alt="" loading="lazy">` : "",
    `<p class="vcd-when" data-vcd-event="">${esc(lines.event)}</p>`,
    `<p class="vcd-when vcd-local" data-vcd-local="" hidden></p>`,
    `<div data-vcd-run=""${started ? " hidden" : ""}><div class="vcd-tiles" aria-hidden="true">${tiles}</div><p class="vcd-sr" role="timer" data-vcd-sr="">${esc(T.srText(b, L, lang))}</p>${started ? "" : `<p class="vcd-actions" style="margin-top:10px"><a class="vcd-btn vcd-btn--ghost" href="${esc(icsHref(ctx, v))}" download>${esc(ctx.t("addToCalendar"))}</a></p>`}</div>`,
    `<div class="vcd-end" data-vcd-end=""${started ? "" : " hidden"}><p class="vcd-endmsg">${esc(msg)}</p>${link}</div>`,
    details && v.description ? `<p class="vcd-desc">${esc(v.description)}</p>` : "",
    details && v.where ? `<p class="vcd-where"><strong>${esc(ctx.t("whereLabel"))}</strong> ${esc(v.where)}</p>` : "",
    !details && href && variant !== "compact" ? `<p class="vcd-actions"><a class="vcd-more" href="${esc(href)}">${esc(ctx.t("seeEvent"))}</a></p>` : "",
  ];
  return (
    `<article class="vcd vcd--${variant}" data-vcd="" data-vcd-state="${started ? "started" : "upcoming"}" data-start="${v.startMs}" data-hide="${hide}" data-allday="${v.allDay ? 1 : 0}" ` +
    `data-tz="${esc(v.tz)}" data-now="${now}" data-seconds="${secs ? 1 : 0}"${noTitle ? ` aria-label="${esc(v.title)}"` : ""}>${parts.join("")}</article>`
  );
}

/** Le script de la page : toutes les fonctions communes, puis le démarrage. */
export function liveScript() {
  return `(function(){"use strict";if(window.__vcdOn)return;window.__vcdOn=1;\n${T.clientSource()}\nbootCountdowns(window,document);\n})();`;
}

// ── Source navigateur pour OBS ──────────────────────────────────────────────────────────────────────────────────

const OVERLAY_SIZES = { s: 16, m: 22, l: 32 };
const OVERLAY_POSITIONS = {
  "top-left": "top:2.5vmin;left:2.5vmin",
  "top-center": "top:2.5vmin;left:50%;transform:translateX(-50%)",
  "top-right": "top:2.5vmin;right:2.5vmin",
  center: "top:50%;left:50%;transform:translate(-50%,-50%)",
  "bottom-left": "bottom:2.5vmin;left:2.5vmin",
  "bottom-center": "bottom:2.5vmin;left:50%;transform:translateX(-50%)",
  "bottom-right": "bottom:2.5vmin;right:2.5vmin",
};
export const OVERLAY_POSITION_KEYS = Object.keys(OVERLAY_POSITIONS);

/** Ce que la source OBS reçoit pour un événement : de quoi compter, le message de fin et le moment où elle s'efface. */
export function overlayEvent(ctx, v, endMs) {
  if (!v) return null;
  return { slug: v.slug, title: v.title, start: v.startMs, hideAt: Math.min(v.hideMs, v.startMs + endMs), message: endMessage(ctx, v) };
}

/** Ce que la source reçoit quand elle sert un ÉLÉMENT de page d'overlay : paramètres réservés `ov-*` (taille, style commun) et `opt-*` (options), tous revalidés ici. Sinon null (overlay habituel). */
export function elementRequest(query) {
  if (!query?.has?.("ov-w")) return null;
  const size = (k, d) => { const n = Number(query.get(k)); return Number.isFinite(n) ? Math.min(7680, Math.max(16, Math.round(n))) : d; };
  const asked = query.get("opt-event") ?? "";
  return {
    width: size("ov-w", 600), height: size("ov-h", 200), text: query.get("ov-text") === "dark" ? "dark" : "light",
    soft: query.get("ov-surface") === "soft", square: query.get("ov-corners") === "square",
    demo: query.get("ov-demo") === "1",
    event: M.isSlug(asked) ? asked : "", // vide ou inconnu : l'événement à la une
    seconds: query.get("opt-seconds") !== "0",
  };
}

/** Événement d'exemple du mode test : toujours « dans quelques jours », jamais d'événement réel. */
export function demoEvent(ctx, now, endMs) {
  const start = now + (3 * 24 + 4) * 3_600_000 + 12 * 60_000 + 56_000;
  return { slug: "demo", title: ctx.t("overlayDemo"), start, hideAt: start + endMs, message: "" };
}

/** Jetons --ov-* du style commun (valeurs de docs/OVERLAY-ELEMENTS.md), avec repli ; jamais le thème ni le skin du site. */
function elementTokens(e) {
  const light = e.text !== "dark";
  return `--ov-fg:${light ? "#ffffff" : "#111111"};--ov-surface:${e.soft ? (light ? "rgba(0,0,0,.55)" : "rgba(255,255,255,.7)") : "transparent"};--ov-radius:${e.square ? "0px" : "12px"};--ov-border:${e.soft ? (light ? "rgba(255,255,255,.18)" : "rgba(0,0,0,.18)") : "transparent"}`;
}

export function overlayParts(ctx, { initial, stateUrl, endMs, element = null }) {
  const look = ["dark", "light", "bare"].includes(String(ctx.setting("overlayLook"))) ? String(ctx.setting("overlayLook")) : "dark";
  const position = OVERLAY_POSITIONS[String(ctx.setting("overlayPosition"))] ?? OVERLAY_POSITIONS["top-center"];
  // Dans une page d'overlay, la place et la taille propres à l'overlay sont ignorées : l'élément remplit son cadre (police calculée d'après le cadre).
  const size = element ? Math.max(8, Math.floor(Math.min(element.width / 17.5, element.height / 7.9))) : (OVERLAY_SIZES[String(ctx.setting("overlaySize"))] ?? OVERLAY_SIZES.m);
  const accent = safeColor(ctx.setting("overlayAccent")) ?? safeColor(ctx.theme.accent) ?? "#e8a23b";
  const L = labels(ctx);
  const secs = ctx.setting("showSeconds") !== false && (!element || element.seconds);
  const part = (name) => (element ? ` data-ov-part="${name}"` : "");
  const tile = (k) => `<div class="vco-t"${k === "s" ? ' data-o="t-s"' : ""}${part("tile")}><span class="vco-n" data-o="${k}"${part("number")}>0</span><span class="vco-l" data-o="l-${k}"${part("unit")}>${esc(L[k][1])}</span></div>`;
  const html = `<div id="vco" class="vco vco--${element ? "element" : look}"${element ? ' data-ov-region="element"' : ""} data-state="" hidden><div class="vco-box"${part("panel")}><p class="vco-title" data-o="title"${part("title")}></p><div class="vco-tiles" data-o="tiles"${part("tiles")}>${tile("d")}${tile("h")}${tile("m")}${tile("s")}</div><p class="vco-msg" data-o="msg"${part("message")} hidden></p></div></div>`;
  const legacyHead = `
html,body{margin:0;background:transparent!important;overflow:hidden}
.vco{position:fixed;${position};max-width:96vw;font-family:var(--v-font,system-ui,sans-serif);font-size:${size}px;--vco-fg:#fff;--vco-bg:rgba(10,10,12,.74);--vco-muted:rgba(255,255,255,.82);--vco-accent:${accent}}
.vco--light{--vco-fg:#111;--vco-bg:rgba(255,255,255,.9);--vco-muted:rgba(0,0,0,.7)}
.vco--bare{--vco-bg:transparent;text-shadow:0 1px 3px rgba(0,0,0,.9),0 0 14px rgba(0,0,0,.7)}
.vco[hidden],.vco [hidden]{display:none!important}`;
  // Élément : couleurs, fond et arrondis viennent des jetons du style commun ; l'accent reste celui du module.
  const elementHead = `
:root{${elementTokens(element ?? {})}}
html,body{margin:0;background:transparent!important;overflow:hidden}
.vco{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;font-family:system-ui,"Segoe UI",sans-serif;font-size:${size}px;--vco-fg:var(--ov-fg,#fff);--vco-bg:var(--ov-surface,transparent);--vco-muted:color-mix(in srgb,var(--ov-fg,#fff) 78%,transparent);--vco-accent:${accent}}
.vco[hidden],.vco [hidden]{display:none!important}`;
  const rules = `
.vco-box{box-sizing:border-box;padding:.7em 1.1em .8em;border-radius:.8em;border-bottom:.2em solid var(--vco-accent);background:var(--vco-bg);color:var(--vco-fg);text-align:center}
.vco--bare .vco-box{border-bottom-color:transparent}
.vco-title{margin:0 0 .3em;font-size:1.05em;font-weight:600;overflow-wrap:anywhere}
.vco-tiles{display:flex;justify-content:center;gap:.9em}
.vco-t{display:flex;flex-direction:column;align-items:center;min-width:3em}
.vco-n{font-size:2.6em;font-weight:700;line-height:1.05;font-variant-numeric:tabular-nums}
.vco-l{font-size:.78em;color:var(--vco-muted)}
.vco-msg{margin:.1em 0;font-size:1.9em;font-weight:700;overflow-wrap:anywhere}
@media (prefers-reduced-motion:no-preference){.vco-box{animation:vco-in .45s ease-out}}
@keyframes vco-in{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion:reduce){.vco *{animation:none!important;transition:none!important}}`;
  const elementRules = `
.vco-box{max-width:100%;max-height:100%;overflow:hidden;border-radius:var(--ov-radius,.8em);border:1px solid var(--ov-border,transparent);border-bottom:.2em solid var(--vco-accent);text-shadow:0 1px 3px rgba(0,0,0,.35)}
.vco-title{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}`;
  const css = ((element ? elementHead : legacyHead) + rules + (element ? elementRules : "")).trim();
  const cfg = { stateUrl, lang: ctx.locale, L, secs, poll: 30_000, initial, endMs };
  const json = JSON.stringify(cfg).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  const script = `(function(){"use strict";\n${T.clientSource()}\nbootOverlay(window,document,${json});\n})();`;
  return { title: ctx.instance.name, html, css, script };
}
