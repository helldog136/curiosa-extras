// Événements 1.3 — ÉLÉMENT « Prochain événement » des pages d'overlay (cœur 0.5.0, docs/OVERLAY-ELEMENTS.md). Il montre aux spectateurs le prochain rendez-vous de l'agenda :
// son titre, son jour et son heure (écrits dans la langue de la page), le délai (« Dans 3 jours ») et, si la personne le veut, le lieu.
// Les événements sont publics par nature (publiés sur la page de l'agenda) : cet élément ne montre RIEN d'autre que ce que la page publique montre déjà (jamais un brouillon,
// un événement annulé ou reporté, un lien d'inscription, un intervenant, une adresse exacte). Il n'a donc pas de clé secrète. Au repos (rien à venir) : RIEN n'est dessiné.
// Ce fichier lit l'agenda par data.mjs (liste gardée 20 s, partagée) ; plusieurs pages d'overlay lisent le même élément sans rien retenir par lecteur.
// Règles des éléments : la page remplit toute la fenêtre reçue, suit le style commun par les jetons --ov-* (avec repli), se décrit par des attributs data-ov-part, ne charge JAMAIS
// le skin du site et rien de tiers ; tout texte venu d'ailleurs est écrit par textContent.
const q = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en mémoire après une mise à jour)
const X = await import(`./text.mjs${q}`);
const T = await import(`./time.mjs${q}`);
const D = await import(`./data.mjs${q}`);
const M = await import(`./model.mjs${q}`);
const V = await import(`./view.mjs${q}`);

const flag = (params, id, dflt) => { const x = params.get(`opt-${id}`); return x === "1" ? true : x === "0" ? false : dflt; };
/** Les options reçues dans l'adresse (`opt-<id>`), CONTRÔLÉES ici : une valeur inconnue prend le défaut, une option inconnue est ignorée. */
export const readOptions = (params) => ({ title: flag(params, "title", true), place: flag(params, "place", true), delay: flag(params, "delay", true) });

/** Les jetons --ov-* déduits des paramètres `ov-text`, `ov-surface`, `ov-corners` (valeurs de docs/OVERLAY-ELEMENTS.md). Absents : l'élément ne suit pas le style (repli dans la feuille). */
export function tokens(params) {
  if (!params.has("ov-text")) return "";
  const light = params.get("ov-text") !== "dark", soft = params.get("ov-surface") === "soft", square = params.get("ov-corners") === "square";
  return `:root{--ov-fg:${light ? "#ffffff" : "#111111"};--ov-surface:${soft ? (light ? "rgba(0,0,0,.55)" : "rgba(255,255,255,.7)") : "transparent"};--ov-radius:${square ? "0px" : "12px"};--ov-border:${soft ? (light ? "rgba(255,255,255,.25)" : "rgba(0,0,0,.2)") : "transparent"}}`;
}

/** Le délai écrit pour la page : « En cours », « Aujourd'hui », « Demain », « Dans 3 jours » (jours comptés dans le fuseau de l'événement). */
function delayText(ctx, ev, now) {
  if (ev.startMs <= now) return ctx.t("ovNow");
  const days = T.daysBetween(T.dayIn(now, ev.zone), ev.date);
  return days <= 0 ? ctx.t("ovToday") : days === 1 ? ctx.t("ovTomorrow") : ctx.t("ovInDays", { n: days });
}

const view = (ctx, ev, now, opts) => ({
  title: X.clean(ev.title, 120),
  when: V.whenText(ctx, ev, { short: true }),
  ...(opts.delay ? { delay: delayText(ctx, ev, now) } : {}),
  ...(opts.place && ev.place ? { place: ev.place } : {}),
});

/** Un événement d'exemple (mode test), avec un jour et une heure à venir ; rien n'est lu. */
function demoEvent(ctx, now) {
  const zone = D.siteZone(ctx);
  const date = T.addDays(T.dayIn(now, zone), 3);
  return M.read({ id: "demo", createdAt: new Date(now).toISOString(), data: { title: ctx.t("ovDemoTitle"), status: "published", date, time: "20:00", place: ctx.t("ovDemoPlace") } }, zone);
}

/** Ce que la page doit dessiner : { state: "ok", event: { title, when, delay?, place? } | null }. `null` : rien à venir, la page ne dessine rien. */
export async function dataFor(ctx, params, now = Date.now()) {
  const opts = readOptions(params);
  if (params.get("ov-demo") === "1") return { state: "ok", event: view(ctx, demoEvent(ctx, now), now, opts) };
  const data = await D.load(ctx);
  const next = D.visible(data).find((e) => e.endMs > now && e.state !== "cancelled" && e.state !== "postponed");
  return { state: "ok", event: next ? view(ctx, next, now, opts) : null };
}

const CSS = `html,body{margin:0;height:100%;overflow:hidden;background:transparent;font-family:system-ui,sans-serif}
[data-ov-part="panel"]{box-sizing:border-box;position:fixed;inset:0;display:flex;padding:.6em .8em;overflow:hidden;font-size:var(--ev-fs,20px);line-height:1.2;color:var(--ov-fg,#fff);background:var(--ov-surface,transparent);border:1px solid var(--ov-border,transparent);border-radius:var(--ov-radius,12px)}
[data-ov-part="panel"][hidden]{display:none}
.ev-body{margin:auto 0;width:100%;min-width:0;display:flex;flex-direction:column;gap:.3em}
[data-ov-part="title"]{margin:0;font-size:.75em;font-weight:700;letter-spacing:.08em;text-transform:uppercase;opacity:.85}
[data-ov-part="name"]{font-size:1.5em;font-weight:800;line-height:1.1;overflow-wrap:anywhere}
[data-ov-part="text"]{font-size:.95em;font-weight:500;overflow-wrap:anywhere}
[data-ov-part="badge"]{align-self:flex-start;margin-top:.2em;padding:.2em .7em;border-radius:999px;border:.1em solid currentColor;font-size:.8em;font-weight:700;white-space:nowrap}`;

const JS = String.raw`(function () {
  "use strict";
  var c = window.__EV, p = document.getElementById("ev"), body = null, rev = "", delay = c.base, last = null;
  function el(tag, part, text) { var n = document.createElement(tag); if (part) n.setAttribute("data-ov-part", part); if (text !== undefined) n.textContent = text; return n; }
  function fits() {
    var cs = getComputedStyle(p), w = p.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), h = p.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    return w > 0 && h > 0 && body.offsetHeight <= h + 1 && body.scrollWidth <= w + 1;
  }
  function fit() {
    if (!body) return;
    var lo = 8, hi = 64;
    for (var i = 0; i < 9; i++) { var mid = (lo + hi) / 2; p.style.setProperty("--ev-fs", mid + "px"); if (fits()) lo = mid; else hi = mid; }
    p.style.setProperty("--ev-fs", lo + "px");
  }
  function render(d) {
    last = d; body = null; p.textContent = ""; p.hidden = true;
    if (!d || d.state !== "ok" || !d.event) return;   // rien à venir (ou état inconnu) : RIEN n'est dessiné, pas même le cadre
    var e = d.event; body = el("div"); body.className = "ev-body";
    if (c.opts.title) body.appendChild(el("h2", "title", c.t.title));
    body.appendChild(el("div", "name", e.title));
    body.appendChild(el("div", "text", e.when));
    if (e.place) body.appendChild(el("div", "text", e.place));
    if (e.delay) body.appendChild(el("div", "badge", e.delay));
    p.appendChild(body); p.hidden = false; fit();
  }
  function tick() {
    if (c.demo) return;
    window.fetch.call(window, c.data + location.search, { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal: (typeof AbortSignal !== "undefined" && AbortSignal.timeout) ? AbortSignal.timeout(15000) : undefined })
      .then(function (r) { if (!r.ok) throw new Error("http"); return r.json(); })
      .then(function (j) { var next = JSON.stringify(j); if (next !== rev) { rev = next; render(j); delay = c.base; } else delay = Math.min(c.max, Math.round(delay * 1.5)); })
      .catch(function () { delay = Math.min(300000, Math.max(delay, c.base) * 2); })
      .then(function () { setTimeout(tick, document.hidden ? Math.max(delay, c.max) : delay); });
  }
  addEventListener("resize", function () { render(last); });
  rev = JSON.stringify(c.first); render(c.first);
  setTimeout(tick, delay);
})();
`;

/** La page de l'élément. `first` : ce que le serveur a lu à l'instant ; ensuite le script redemande à `data` (mêmes paramètres que la page). */
export function page(params, { lang, first, data, labels, demo = false }) {
  const config = JSON.stringify({ lang, first, data, t: labels, demo, opts: readOptions(params), base: 120_000, max: 300_000 }).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="${X.safeLang(lang) ? lang : "en"}" data-ov-region="element"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Events</title><style>${tokens(params)}\n${CSS}</style></head><body><div id="ev" data-ov-part="panel" role="status" aria-live="polite" hidden></div><script>window.__EV=${config};${JS}</script></body></html>`;
}

/** En-têtes : sa propre politique de sécurité (aucun chargement tiers, seulement le site pour relire l'agenda), jamais de cache. */
export const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow", "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
};
