// Ma Chaîne Twitch — éléments des pages d'overlay (cœur 0.5.0). Ce module n'a pas d'overlay à lui : ces éléments n'existent que dans les pages d'overlay.
// Deux éléments : « stats » (followers et abonnements payants) et « live » (pastille « en direct »). Ce fichier ne parle ni à Twitch ni au cœur : il fabrique la page de
// l'élément (HTML, feuille de style, petit script) et lit les paramètres reçus dans l'adresse. Les chiffres viennent d'index.mjs, qui ne rend QUE ce que la personne propriétaire
// a autorisé dans les réglages (« Suivre mes statistiques », « Compter mes followers », « Compter mes abonnements payants »).
// Règles des éléments : la page remplit toute la fenêtre reçue, suit le style commun par les jetons --ov-* (avec repli), se décrit par des attributs data-ov-part, ne charge JAMAIS
// le skin du site et rien de tiers ; tout texte venu d'ailleurs est écrit par textContent.
import { randomBytes, timingSafeEqual } from "node:crypto";

export const KEY_COLLECTION = "twitchElementKey";
export const ELEMENTS = ["stats", "live"];

export const sameSecret = (a, b) => { const x = Buffer.from(String(a ?? "")), y = Buffer.from(String(b ?? "")); return x.length > 0 && x.length === y.length && timingSafeEqual(x, y); };

/**
 * Le code secret propre au module pour ses éléments (jamais montré dans l'administration : seul le cœur l'ajoute à l'adresse, côté serveur). Créé à la première demande ;
 * si deux demandes se croisent, le plus ancien document gagne et l'autre est retiré.
 */
export async function findKey(ctx) {
  const rows = await ctx.api.store.list(KEY_COLLECTION, { limit: 5 });
  return rows.length ? rows.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)))[0].data.k : "";
}

export async function elementKey(ctx) {
  const oldest = (rows) => rows.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)))[0];
  let rows = await ctx.api.store.list(KEY_COLLECTION, { limit: 5 });
  if (!rows.length) {
    const id = await ctx.api.store.add(KEY_COLLECTION, { k: randomBytes(18).toString("base64url") });
    rows = await ctx.api.store.list(KEY_COLLECTION, { limit: 5 });
    const first = oldest(rows);
    if (first && first.id !== id) await ctx.api.store.remove(id);
    return first?.data?.k ?? "";
  }
  return oldest(rows).data.k;
}

/** Les options reçues dans l'adresse (`opt-<id>`), CONTRÔLÉES ici (le module reste propriétaire du sens) : une valeur inconnue prend le défaut, une option inconnue est ignorée. */
export function readFlags(params) {
  const on = (id, dflt) => { const v = params.get(`opt-${id}`); return v === "1" ? true : v === "0" ? false : dflt; };
  return { followers: on("followers", true), paying: on("paying", true), game: on("game", false), offline: on("offline", false) };
}

/** Les jetons --ov-* déduits des paramètres `ov-text`, `ov-surface`, `ov-corners` (valeurs de docs/OVERLAY-ELEMENTS.md). Absents : l'élément ne suit pas le style (repli dans la feuille). */
export function tokens(params) {
  if (!params.has("ov-text")) return "";
  const light = params.get("ov-text") !== "dark", soft = params.get("ov-surface") === "soft", square = params.get("ov-corners") === "square";
  return `:root{--ov-fg:${light ? "#ffffff" : "#111111"};--ov-surface:${soft ? (light ? "rgba(0,0,0,.55)" : "rgba(255,255,255,.7)") : "transparent"};--ov-radius:${square ? "0px" : "12px"};--ov-border:${soft ? (light ? "rgba(255,255,255,.25)" : "rgba(0,0,0,.2)") : "transparent"}}`;
}

const CSS = `html,body{margin:0;height:100%;overflow:hidden;background:transparent;font-family:system-ui,sans-serif}
[data-ov-part="panel"]{box-sizing:border-box;position:fixed;inset:0;display:flex;padding:.5em .7em;overflow:hidden;font-size:var(--tw-fs,20px);line-height:1.15;color:var(--ov-fg,#fff);background:var(--ov-surface,transparent);border:1px solid var(--ov-border,transparent);border-radius:var(--ov-radius,12px)}
[data-ov-part="body"]{margin:auto;display:flex;flex-direction:column;align-items:center;gap:.6em;max-width:100%;text-align:center}
[data-ov-part="stat"]{display:flex;flex-direction:column;align-items:center;min-width:0}
[data-ov-part="value"]{font-size:2.2em;font-weight:800;line-height:1.05;font-variant-numeric:tabular-nums;white-space:nowrap}
[data-ov-part="label"]{font-size:.8em;font-weight:600;opacity:.9;overflow-wrap:anywhere}
[data-ov-part="badge"]{display:inline-flex;align-items:center;gap:.45em;padding:.3em .8em;border-radius:999px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap}
[data-ov-part="badge"][data-state="live"]{background:#c62828;color:#fff}
[data-ov-part="badge"][data-state="offline"]{border:.12em solid currentColor;opacity:.85}
[data-ov-part="dot"]{width:.6em;height:.6em;border-radius:50%;background:currentColor}
[data-ov-part="badge"][data-state="live"] [data-ov-part="dot"]{animation:tw-pulse 1.6s ease-in-out infinite}
[data-ov-part="game"]{font-size:.85em;font-weight:600;max-width:100%;overflow-wrap:anywhere}
@keyframes tw-pulse{50%{opacity:.35}}
@media (min-aspect-ratio:9/5){[data-ov-part="body"]{flex-direction:row;flex-wrap:wrap;justify-content:center;column-gap:1.6em}}
@media (prefers-reduced-motion:reduce){[data-ov-part="dot"]{animation:none!important}}`;

/** Le script de l'élément : dessine ce que le serveur a donné, le remet à jour doucement (intervalle qui s'allonge si rien ne change ou en cas d'erreur), ajuste la police à la taille du cadre. */
const JS = String.raw`(function () {
  "use strict";
  var c = window.__TW, p = document.getElementById("tw"), body = null, rev = "", delay = c.base, errors = 0;
  function el(tag, part, text) { var n = document.createElement(tag); n.setAttribute("data-ov-part", part); if (text !== undefined) n.textContent = text; return n; }
  function fmt(n) { try { return new Intl.NumberFormat(c.lang).format(n); } catch (e) { return String(n); } }
  function fit() {
    if (!body) return;
    var lo = 9, hi = 120;
    for (var i = 0; i < 8; i++) {
      var mid = (lo + hi) / 2;
      p.style.setProperty("--tw-fs", mid + "px");
      // l'espace disponible est relu à CHAQUE essai : les marges sont en « em », elles changent avec la taille de la police
      var cs = getComputedStyle(p), w = p.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), h = p.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      if (w > 0 && h > 0 && body.offsetHeight <= h + 1 && body.scrollWidth <= w + 1) lo = mid; else hi = mid;
    }
    p.style.setProperty("--tw-fs", lo + "px");
  }
  function render(d) {
    p.textContent = ""; body = null;
    if (!d) return;
    if (c.kind === "stats" && d.rows && d.rows.length) {
      body = el("div", "body");
      for (var i = 0; i < d.rows.length; i++) { var s = el("div", "stat"); s.appendChild(el("span", "value", fmt(d.rows[i].value))); s.appendChild(el("span", "label", d.rows[i].label)); body.appendChild(s); }
    } else if (c.kind === "live" && (d.state === "live" || d.state === "offline")) {
      body = el("div", "body");
      var b = el("div", "badge"); b.setAttribute("data-state", d.state); b.appendChild(el("span", "dot")); b.appendChild(el("span", "badge-text", d.state === "live" ? c.t.live : c.t.offline)); body.appendChild(b);
      if (d.game) body.appendChild(el("div", "game", d.game));
    }
    if (body) { p.appendChild(body); fit(); }
  }
  function tick() {
    if (c.demo) return;
    fetch(c.data + location.search, { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal: (typeof AbortSignal !== "undefined" && AbortSignal.timeout) ? AbortSignal.timeout(15000) : undefined })
      .then(function (r) { if (!r.ok) throw new Error("http"); return r.json(); })
      .then(function (j) { errors = 0; var next = JSON.stringify(j); if (next !== rev) { rev = next; render(j); delay = c.base; } else delay = Math.min(c.max, Math.round(delay * 1.5)); })
      .catch(function () { errors++; delay = Math.min(300000, Math.max(delay, c.base) * 2); })
      .then(function () { setTimeout(tick, document.hidden ? Math.max(delay, c.max) : delay); });
  }
  addEventListener("resize", fit);
  rev = JSON.stringify(c.first); render(c.first);
  setTimeout(tick, delay);
})();
`;

/**
 * La page d'un élément. `first` : ce que le serveur a lu à l'instant (la page n'est jamais vide au premier affichage) ; ensuite le script redemande à `data` (même adresse que la page,
 * mêmes paramètres). Plusieurs pages d'overlay peuvent afficher le même élément : chaque lecteur lit tout seul, le serveur ne retient rien de lui (caches partagés de helix.mjs).
 */
export function page(kind, params, { lang, first, data, labels, demo = false }) {
  const config = JSON.stringify({ kind, lang, first, data, t: labels, demo, base: kind === "live" ? 30_000 : 120_000, max: kind === "live" ? 120_000 : 300_000 }).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="${/^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(lang) ? lang : "en"}" data-ov-region="element"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Twitch</title><style>${tokens(params)}\n${CSS}</style></head><body><div id="tw" data-ov-part="panel" role="status" aria-live="polite"></div><script>window.__TW=${config};${JS}</script></body></html>`;
}

/** En-têtes de la page : sa propre politique de sécurité (aucun chargement tiers, seulement le site pour redemander les chiffres), jamais de cache, l'adresse secrète ne fuit pas par « Referer ». */
export const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow", "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
};
