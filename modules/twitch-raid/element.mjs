// Raid Twitch 2.4 — ÉLÉMENTS des pages d'overlay (cœur 0.5.0, docs/OVERLAY-ELEMENTS.md). Deux éléments, en lecture seule, qui montrent aux spectateurs ce que le dock montre à la personne
// qui streame : « featured » (la sélection du moment, les MÊMES chaînes que le dock de sélection et la page publique) et « live » (les partenaires en direct maintenant).
// Ce fichier fabrique les données et la page de l'élément ; il ne parle ni à Twitch ni à Contacts directement (moment.mjs, live.mjs, source.mjs et consent.mjs le font, avec leurs caches
// partagés : dix pages d'overlay ou dix lecteurs font la même demande, rien n'est retenu par lecteur).
// Vie privée, règles de ce fichier :
//   - jamais plus que ce que montre déjà la page publique : nom, jeu, audience. Ni pseudo, ni commande de raid, ni titre du direct, ni vignette, ni identifiant de fiche ;
//   - jamais une personne rangée dans « Ne pas montrer », ni une fiche « à relire », ni un nom de la liste « Ne jamais tirer » ; si Contacts ne peut pas le dire, rien n'est montré ;
//   - un état inconnu (Twitch ou Contacts muets, trop de chaînes) donne un cadre VIDE, jamais un « personne n'est en direct » inventé ; au repos (personne en direct) : RIEN n'est dessiné ;
//   - l'adresse de l'élément porte la clé secrète du dock (ajoutée côté serveur par le cœur) : « Nouvelle adresse » la remplace, les pages d'overlay prennent la nouvelle au rechargement.
// Règles des éléments : la page remplit toute la fenêtre reçue, suit le style commun par les jetons --ov-* (avec repli), se décrit par des attributs data-ov-part, ne charge JAMAIS
// le skin du site et rien de tiers ; tout texte venu d'ailleurs est écrit par textContent.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { modeFor, sortPartners, oneLine } = await import(`./pure.mjs${v}`);
const source = await import(`./source.mjs${v}`);
const live = await import(`./live.mjs${v}`);
const consent = await import(`./consent.mjs${v}`);
const moment = await import(`./moment.mjs${v}`);
const { settingsOf } = await import(`./settings.mjs${v}`);

export const ELEMENTS = ["featured", "live"];
export const MAX_ROWS = 10, DEFAULT_ROWS = 5;

const flag = (params, id, dflt) => { const x = params.get(`opt-${id}`); return x === "1" ? true : x === "0" ? false : dflt; };
/** Les options reçues dans l'adresse (`opt-<id>`), CONTRÔLÉES ici : une valeur inconnue prend le défaut, une option inconnue est ignorée. */
export function readOptions(params) {
  const n = Number.parseInt(params.get("opt-max") ?? "", 10);
  return { title: flag(params, "title", true), game: flag(params, "game", true), max: Number.isInteger(n) && n >= 1 && n <= MAX_ROWS ? n : DEFAULT_ROWS };
}

/** Les jetons --ov-* déduits des paramètres `ov-text`, `ov-surface`, `ov-corners` (valeurs de docs/OVERLAY-ELEMENTS.md). Absents : l'élément ne suit pas le style (repli dans la feuille). */
export function tokens(params) {
  if (!params.has("ov-text")) return "";
  const light = params.get("ov-text") !== "dark", soft = params.get("ov-surface") === "soft", square = params.get("ov-corners") === "square";
  return `:root{--ov-fg:${light ? "#ffffff" : "#111111"};--ov-surface:${soft ? (light ? "rgba(0,0,0,.55)" : "rgba(255,255,255,.7)") : "transparent"};--ov-radius:${square ? "0px" : "12px"};--ov-border:${soft ? (light ? "rgba(255,255,255,.25)" : "rgba(0,0,0,.2)") : "transparent"}}`;
}

/** The TV factor `ov-tv` of the core (px of the 1080 canvas -> px of this window): a number above 0 and below 20, else 1. */
export const tvOf = (params) => { const t = Number(params.get("ov-tv")); return t > 0 && t < 20 ? t : 1; };
/** The TV type scale (core 0.11.0): the px are px of the 1080 canvas, `--ov-tv` brings them to this window. Nothing on screen goes under `xs`. */
export const tvTokens = (tv) => `:root{--ov-tv:${tv};--ov-text-xs:calc(24px*var(--ov-tv));--ov-text-sm:calc(28px*var(--ov-tv));--ov-text-md:calc(32px*var(--ov-tv));--ov-text-lg:calc(40px*var(--ov-tv));--ov-text-xl:calc(56px*var(--ov-tv));--ov-text-2xl:calc(72px*var(--ov-tv))}`;

const row = (name, game, viewers) => ({ name: oneLine(name, 60), game: oneLine(game, 100), viewers: Number.isFinite(viewers) && viewers >= 0 ? Math.floor(viewers) : 0 });
const unknown = () => ({ state: "unknown", rows: [], more: 0 });
const idle = () => ({ state: "ok", rows: [], more: 0 });

/** Contenu d'exemple (mode test) : des noms inventés, rien n'est lu. */
export function demoData(ctx, kind, opts) {
  const game = ctx.t("ov_demoGame");
  const all = [row("etoile_nord", game, 12), row("lune_douce", game, 48), row("Camille", game, 130), row("nuage_clair", game, 210), row("brume_vive", game, 330), row("sentier_bleu", game, 540)];
  return { state: "ok", rows: all.slice(0, kind === "featured" ? 3 : Math.min(opts.max, 5)), more: 0 };
}

/** « featured » : la sélection du moment (lecture seule : elle ne tire jamais de nouveau). Les chaînes tirées ont déjà passé le consentement (moment.mjs). */
export async function featuredData(ctx) {
  const r = await moment.momentNow(ctx);
  if (r.state !== "ok") return r.state === "no_partners" ? idle() : unknown();
  return { state: "ok", rows: r.picks.map((p) => row(p.name, p.game, p.viewers)), more: 0 };
}

/**
 * « live » : tous les partenaires en direct maintenant (jusqu'à 500 chaînes ; au-delà, la liste complète n'existe pas : cadre vide, la sélection du moment convient mieux),
 * les moins regardés d'abord comme dans le dock. Seuls ceux que Contacts autorise à montrer ; `more` : combien d'autres sont en direct sans tenir dans `max`.
 */
export async function liveData(ctx, max) {
  const src = await source.targets(ctx);
  if (src.state !== "ok") return unknown();
  const partners = src.partners;
  if (!partners.length) return idle();
  if (modeFor(partners.length) === "random") return unknown();
  const r = await live.liveNow(ctx, partners, settingsOf(ctx));
  if (r.state !== "ok" || r.mode !== "full") return unknown();
  const never = moment.momentSettings(ctx).exclude;
  const candidates = r.live.filter((x) => !never.has(x.login));
  if (!candidates.length) return idle();
  const contactOf = new Map(partners.map((p) => [p.login, p.contactId]));
  const verdict = await consent.allowedContacts(ctx, candidates.map((x) => contactOf.get(x.login)).filter(Boolean));
  if (verdict.state !== "ok") return unknown();   // Contacts ne peut pas dire qui refuse d'être montré : on ne devine pas
  const shown = candidates.filter((x) => { const id = contactOf.get(x.login); return !!id && verdict.allowed.has(id); });
  const sorted = sortPartners(shown, "viewers_asc");
  return { state: "ok", rows: sorted.slice(0, max).map((x) => row(x.name, x.game, x.viewers)), more: Math.max(0, sorted.length - max) };
}

/** Ce que la page doit dessiner : les lignes (déjà bornées), et pour « live » le nombre d'autres chaînes. */
export async function dataFor(ctx, kind, params) {
  const opts = readOptions(params);
  if (params.get("ov-demo") === "1") return demoData(ctx, kind, opts);
  const d = kind === "featured" ? await featuredData(ctx) : await liveData(ctx, opts.max);
  return { ...d, rows: d.rows.slice(0, MAX_ROWS) };
}

const CSS = `html,body{margin:0;height:100%;overflow:hidden;background:transparent;font-family:system-ui,sans-serif}
[data-ov-part="panel"]{box-sizing:border-box;position:fixed;inset:0;display:flex;padding:.5em .7em;overflow:hidden;font-size:var(--ov-text-md,32px);line-height:1.2;color:var(--ov-fg,#fff);background:var(--ov-surface,transparent);border:1px solid var(--ov-border,transparent);border-radius:var(--ov-radius,12px)}
[data-ov-part="panel"][hidden]{display:none}
.rd-body{margin:auto 0;width:100%;min-width:0;display:flex;flex-direction:column;gap:.45em}
[data-ov-part="title"]{margin:0;font-size:var(--ov-text-lg,40px);font-weight:800;letter-spacing:.02em;overflow-wrap:anywhere}
.rd-list{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,12em),1fr));gap:.4em .9em}
[data-ov-part="card"]{display:grid;grid-template-columns:auto minmax(0,1fr) auto;column-gap:.5em;align-items:center;min-width:0}
[data-ov-part="dot"]{width:.6em;height:.6em;border-radius:50%;background:currentColor;grid-row:1 / span 2;animation:rd-pulse 1.8s ease-in-out infinite}
[data-ov-part="name"]{grid-column:2 / span 2;font-weight:700;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[data-ov-part="text"]{grid-column:2;grid-row:2;font-size:var(--ov-text-xs,24px);opacity:.85;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[data-ov-part="value"]{grid-column:3;grid-row:2;justify-self:end;font-size:var(--ov-text-sm,28px);font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap;opacity:.95}
[data-ov-part="foot"]{font-size:var(--ov-text-xs,24px);opacity:.8}
@keyframes rd-pulse{50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){[data-ov-part="dot"]{animation:none!important}}`;

/** Le script de l'élément : dessine ce que le serveur a donné, le remet à jour doucement (l'intervalle s'allonge si rien ne change ou en cas d'erreur), laisse de côté ce qui ne tient pas (le texte garde sa taille). */
const JS = String.raw`(function () {
  "use strict";
  var c = window.__RD, p = document.getElementById("rd"), body = null, rev = "", delay = c.base, last = null;
  function el(tag, part, text) { var n = document.createElement(tag); if (part) n.setAttribute("data-ov-part", part); if (text !== undefined) n.textContent = text; return n; }
  function plural(n) { return (n === 1 ? c.t.viewers_one : c.t.viewers_other).replace("{n}", String(n)); }
  function fits() {
    var cs = getComputedStyle(p), w = p.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), h = p.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    return w > 0 && h > 0 && body.offsetHeight <= h + 1 && body.scrollWidth <= w + 1;
  }
  function build(rows, more) {
    body = el("div"); body.className = "rd-body";
    if (c.opts.title) body.appendChild(el("h2", "title", c.t.title));
    var ul = el("ul"); ul.className = "rd-list";
    rows.forEach(function (r) {
      var li = el("li", "card"), dot = el("span", "dot"); dot.setAttribute("aria-hidden", "true"); li.appendChild(dot);
      var nm = el("span", "name", r.name); nm.title = r.name; li.appendChild(nm);
      li.appendChild(el("span", "value", plural(r.viewers)));
      if (c.opts.game && r.game) li.appendChild(el("span", "text", r.game));
      ul.appendChild(li);
    });
    body.appendChild(ul);
    if (more > 0) body.appendChild(el("div", "foot", c.t.more.replace("{n}", String(more))));
    p.textContent = ""; p.appendChild(body);
  }
  function render(d) {
    last = d; body = null; p.textContent = "";
    p.hidden = true;
    if (!d || d.state !== "ok" || !d.rows || !d.rows.length) return;   // au repos (personne en direct, ou état inconnu) : RIEN n'est dessiné, pas même le cadre
    p.hidden = false;
    var rows = d.rows.slice(), more = d.more || 0;
    // TV type scale: the text keeps its size, so what does not fit is left out (counted in the "and n more" line) instead of shrinking the text.
    build(rows, more);
    while (rows.length > 1 && !fits()) { rows.pop(); more++; build(rows, more); }
    if (c.opts.title && !fits()) { var h = p.querySelector('[data-ov-part="title"]'); if (h) h.remove(); }
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

/**
 * La page d'un élément. `first` : ce que le serveur a lu à l'instant ; ensuite le script redemande à `data` (mêmes paramètres que la page).
 * `labels` : title, viewers_one, viewers_other, more.
 */
export function page(kind, params, { lang, first, data, labels, demo = false }) {
  const config = JSON.stringify({ kind, lang, first, data, t: labels, demo, opts: readOptions(params), base: kind === "live" ? 45_000 : 60_000, max: 300_000 }).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="${/^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(lang) ? lang : "en"}" data-ov-region="element"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Twitch</title><style>${tvTokens(tvOf(params))}${tokens(params)}\n${CSS}</style></head><body><div id="rd" data-ov-part="panel" role="status" aria-live="polite" hidden></div><script>window.__RD=${config};${JS}</script></body></html>`;
}

/** En-têtes de la page : sa propre politique de sécurité (aucun chargement tiers, seulement le site pour redemander les chaînes), jamais de cache, l'adresse secrète ne fuit pas par « Referer ». */
export const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow", "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
};
