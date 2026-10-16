// Planning des streams — module communautaire de Curiosa, porté d'un planning existant.
//
// CONSOMME des calendriers : les évènements viennent du sujet `calendar.event`, que fournissent les modules de calendrier (Calendrier iCal,
// évènements saisis à la main, planning Twitch de la Chaîne Twitch…) ; l'administrateur choisit ses sources dans « Sources de données ».
// Ce module ne parle ni iCal ni réseau : il INTERPRÈTE les évènements bruts (ligne « Jeu : » de la description, sinon catégorie ; annulations)
// et les montre : page publique jour par jour, sections d'accueil, sujet `planning.slot`, action MCP, image PNG de la semaine.
//
// Jaquettes : pour chaque jeu, la jaquette est demandée au service RAWG du cœur (`ctx.api.rawg`, permission `rawg` ; la clé se règle dans
// Admin → Réglages, le module ne la voit jamais). Au mieux : sans clé, clé refusée ou RAWG injoignable, on affiche simplement le nom du jeu.

/* ───────────────────────────── Fuseaux et dates de calendrier ───────────────────────────── */

import { createHash } from "node:crypto";

const V = new URL(import.meta.url).search; // le cœur recharge index.mjs avec ?v=<version> : les fichiers voisins suivent, sinon une mise à jour à chaud mélangerait anciens et nouveaux fichiers
const { zonedTimeToUtc, wallDateNow, weekdayOf, addDaysToWall } = await import(`./dates.mjs${V}`);
export { zonedTimeToUtc, wallDateNow, weekdayOf, addDaysToWall };

/* ───────────────────────────── Planning : noms de jeux, grille de jours ───────────────────────────── */

const { MAX_GAMES_PER_STREAM, extractGameNames } = await import(`./games.mjs${V}`);
export { MAX_GAMES_PER_STREAM, extractGameNames };

/** `count` jours consécutifs à partir de `startWall`, chacun avec ses créneaux (début dans la journée, dans le fuseau). */
export function buildDays(startWall, count, events, timeZone) {
  const days = [];
  for (let i = 0; i < count; i++) {
    const wall = addDaysToWall(startWall.y, startWall.m, startWall.d, i);
    const dayStart = zonedTimeToUtc(wall.y, wall.m, wall.d, 0, 0, 0, timeZone);
    const dayEnd = zonedTimeToUtc(wall.y, wall.m, wall.d, 23, 59, 59, timeZone);
    days.push({ wall, streams: events.filter((s) => s.start >= dayStart && s.start <= dayEnd).sort((a, b) => a.start - b.start) });
  }
  return days;
}

/** Semaine lundi → dimanche contenant « aujourd'hui » (+ décalage en semaines, jamais négatif). */
export function getWeekRange(weekOffset, timeZone, now = new Date()) {
  const offset = Math.max(0, Math.floor(weekOffset));
  const today = wallDateNow(timeZone, now);
  const wd = weekdayOf(today.y, today.m, today.d);
  const monday = addDaysToWall(today.y, today.m, today.d, (wd === 0 ? -6 : 1 - wd) + offset * 7);
  const sunday = addDaysToWall(monday.y, monday.m, monday.d, 6);
  return { start: zonedTimeToUtc(monday.y, monday.m, monday.d, 0, 0, 0, timeZone), end: zonedTimeToUtc(sunday.y, sunday.m, sunday.d, 23, 59, 59, timeZone), startWall: monday, endWall: sunday };
}

/* ───────────────────────────── Garde-fous ───────────────────────────── */

/** Fuseau IANA valide ? (un nom inconnu ferait lever Intl) */
export function isValidTimeZone(tz) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return typeof tz === "string" && tz.length > 0;
  } catch {
    return false;
  }
}

/* ───────────────────────────── Jaquettes (service RAWG du cœur) ───────────────────────────── */

const STATUS = { found: "found", none: "none", "no-key": "no_key", refused: "denied", unreachable: "down" };

/** Une jaquette via le cœur. Jamais d'exception ; https seulement. `status` : found · none · no_key · denied (clé refusée) · down (injoignable). */
export async function coverFor(ctx, title) {
  const svc = ctx.api?.rawg;
  if (!svc || typeof svc.cover !== "function") return { status: "no_key", url: null };   // cœur sans service RAWG : comme « pas de clé »
  try {
    const r = await svc.cover(title);
    const url = typeof r?.url === "string" && /^https:\/\//.test(r.url) ? r.url : null;
    const status = STATUS[r?.status] ?? "down";
    return status === "found" && !url ? { status: "none", url: null } : { status, url: status === "found" ? url : null };
  } catch { return { status: "down", url: null }; }
}

const MAX_LOOKUPS = 30;

/**
 * Jaquettes des jeux de ces créneaux. Renvoie { covers: Map(nom -> url), states: Map(nom -> status) }.
 * Les événements « toute la journée » n'ont pas de jeu. Cache et cadence : ceux du cœur (au plus 30 jeux différents par appel).
 */
export async function coversForSlots(ctx, slots) {
  const names = [...new Set(slots.filter((s) => !s.allDay).flatMap((s) => gamesOf(s)))].slice(0, MAX_LOOKUPS);
  const covers = new Map(), states = new Map();
  if (!names.length) return { covers, states };
  let configured = false;
  try { configured = !!(await ctx.api?.rawg?.configured?.()); } catch { configured = false; }
  if (!configured) { for (const n of names) states.set(n, "no_key"); return { covers, states }; }
  await Promise.all(names.map(async (n) => { const r = await coverFor(ctx, n); states.set(n, r.status); if (r.url) covers.set(n, r.url); }));
  return { covers, states };
}

/** Les jaquettes d'un créneau, dans l'ordre des jeux (ceux sans jaquette sont simplement omis). */
const coversOf = (slot, covers) => (slot.allDay ? [] : gamesOf(slot).map((n) => covers.get(n)).filter(Boolean));

/* ───────────────────────────── Lecture des sources (sujet calendar.event) ───────────────────────────── */

const TOPIC = "calendar.event";
const MAX_EVENTS = 200;
const hexColor = (v) => (/^#[0-9a-fA-F]{6}$|^#[0-9a-fA-F]{3}$/.test(String(v ?? "").trim()) ? String(v).trim() : null);

/** ISO 8601 d'un évènement -> Date. Une date seule (journée entière) vaut minuit dans le fuseau du planning ; sans décalage, l'heure est lue en UTC (convention du cœur). */
function isoToDate(v, tz) {
  if (typeof v !== "string") return null;
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  if (day) return zonedTimeToUtc(Number(day[1]), Number(day[2]), Number(day[3]), 0, 0, 0, tz);
  const t = Date.parse(/(Z|[+-]\d{2}:?\d{2})$/.test(v) ? v : `${v.replace(" ", "T")}Z`);
  return Number.isFinite(t) ? new Date(t) : null;
}

/**
 * Un évènement neutre du sujet `calendar.event` -> créneau du planning. C'est ICI que le texte est interprété :
 * le jeu vient de la ligne « Jeu : … » de la description, sinon de la catégorie ; « annulé » vient du statut.
 */
export function slotFromEvent(item, tz) {
  const start = isoToDate(item?.start, tz);
  if (!start) return null;
  const allDay = item.allDay === true;
  let end = item.end ? isoToDate(item.end, tz) : null;
  if (!end || end.getTime() < start.getTime()) end = new Date(start.getTime() + (allDay ? 86_400_000 : 3_600_000));
  const description = typeof item.description === "string" ? item.description : null;
  const named = extractGameNames(description);
  const category = typeof item.category === "string" ? item.category.trim().slice(0, 100) : "";
  const label = typeof item.sourceLabel === "string" ? item.sourceLabel.trim().slice(0, 60) : "";
  const color = hexColor(item.color);
  return {
    uid: String(item.id ?? ""), title: String(item.title ?? ""), description, start, end, allDay, cancelled: item.status === "cancelled",
    games: named.length ? named : category ? [category] : [], ...(label || color ? { source: { label, color } } : {}),
  };
}
/** Les jeux d'un créneau (déjà calculés ; sinon lus dans la description). */
const gamesOf = (slot) => (Array.isArray(slot.games) ? slot.games : extractGameNames(slot.description));

const timeZoneOf = (ctx) => (isValidTimeZone(ctx.setting("timezone")) ? ctx.setting("timezone") : "UTC");
const flag = (v) => v === true || v === "true" || v === 1 || v === "1";

/** Les sources de calendrier actives (une entrée par instance fournisseuse). Ne lève jamais. */
export async function sourcesOf(ctx) {
  try {
    const all = await ctx.api.services.callAll("calendar.provider", "describe", {});
    return all.filter((e) => e.ok && e.value && typeof e.value === "object" && e.value.active !== false).map((e) => ({ instance: e.instance, name: e.name, ...e.value }));
  } catch { return []; }
}

/**
 * Les créneaux de [from, to] (défaut : de maintenant à `days` jours), de toutes les sources choisies par l'administrateur, fusionnés et triés.
 * { configured (au moins une source), ok (collecte réussie), slots, timeZone, sources }. Ne lève jamais.
 */
async function loadSlots(ctx, days, { cancelled = false, from, to } = {}) {
  const timeZone = timeZoneOf(ctx);
  const sources = await sourcesOf(ctx);
  if (!sources.length) return { configured: false, ok: false, slots: [], timeZone, sources };
  const lo = from ?? new Date(), hi = to ?? new Date(lo.getTime() + days * 86_400_000);
  let items;
  try { items = await ctx.api.topics.collect(TOPIC, { from: lo, to: hi, limit: MAX_EVENTS }); } catch { return { configured: true, ok: false, slots: [], timeZone, sources }; }
  const showSource = flag(ctx.setting("showSource"));
  const slots = (Array.isArray(items) ? items : []).map((i) => slotFromEvent(i, timeZone)).filter(Boolean)
    .filter((e) => (cancelled || !e.cancelled) && e.end.getTime() >= lo.getTime() && e.start.getTime() <= hi.getTime())
    .map((e) => { if (!showSource) delete e.source; return e; })
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  return { configured: true, ok: true, slots, timeZone, sources };
}

/** Clé de graine : un hachage de l'adresse (jamais l'adresse en clair), stable d'une exécution à l'autre. */
export const seedKeyOf = (url) => `ical-${createHash("sha256").update(`planning-ics:${String(url).trim()}`).digest("hex").slice(0, 16)}`;

const clampDays = (v, def = 7) => Math.min(60, Math.max(1, Math.trunc(Number(v)) || def));

/* ───────────────────────────── Le module ───────────────────────────── */

const fmtTime = (d, locale, tz) => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(d);
const fmtDay = (wall, locale, tz) => new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(zonedTimeToUtc(wall.y, wall.m, wall.d, 12, 0, 0, tz));
const escMd = (s) => String(s).replace(/([\\`*_[\]<>])/g, "\\$1");

/** Pastille de source en ligne (rond de SA couleur + nom) pour le rendu d'origine ; vide sans `source` (réglage « Montrer la source » désactivé). */
function sourceDot(src) {
  if (!src || (!src.label && !src.color)) return "";
  return `<span style="display:inline-flex;align-items:center;gap:.35em;margin-left:.5em;font-size:.8em;color:var(--v-muted,#aaa);white-space:nowrap"><i aria-hidden="true" style="display:inline-block;width:.65em;height:.65em;border-radius:50%;background:${src.color ?? "var(--v-muted,#888)"}"></i>${src.label ? esc(src.label) : ""}</span>`;
}

function slotLine(slot, ctx, tz) {
  const when = slot.allDay ? ctx.t("allDay") : fmtTime(slot.start, ctx.locale, tz);
  const games = gamesOf(slot);
  return `**${when}** — ${escMd(slot.title)}${games.length ? ` · _${games.map(escMd).join(", ")}_` : ""}${slot.source?.label ? ` · ● ${escMd(slot.source.label)}` : ""}`;
}

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const coverImg = (url) => `<img src="${esc(url)}" alt="" loading="lazy" width="44" height="58" style="width:44px;height:58px;object-fit:cover;border-radius:6px;flex-shrink:0">`;

/** Un créneau avec ses jaquettes (petites, à gauche) : comme sur la page de l'ancien site. */
function slotHtml(slot, ctx, tz, covers, prefix = "", vis = null) {
  const when = slot.allDay ? ctx.t("allDay") : fmtTime(slot.start, ctx.locale, tz);
  const games = gamesOf(slot);
  const imgs = covers.length ? `<span style="display:flex;gap:4px;flex-shrink:0">${covers.map(coverImg).join("")}</span>` : vis ? placeholderHtml(vis, true) : "";
  return `<div style="display:flex;gap:12px;align-items:center;margin:8px 0">${imgs}<div style="min-width:0;overflow-wrap:anywhere">${prefix ? `<span style="color:var(--v-muted)">${esc(prefix)} · </span>` : ""}<strong>${esc(when)}</strong> — ${esc(slot.title)}${sourceDot(slot.source)}` +
    `${games.length ? `<div style="color:var(--v-muted);font-style:italic;font-size:.9em">${games.map(esc).join(", ")}</div>` : ""}</div></div>`;
}
const anyCover = (slots, covers) => slots.some((s) => coversOf(s, covers).length > 0);

/* ───────────────────────────── Cartes de l'accueil (« prochain stream », « prochains streams ») ─────────────────────────────
 * HTML + classes `cpl-*` du module, uniquement avec les variables de thème du cœur (--v-*) : clair, sombre, avec ou sans couleur
 * secondaire. Les valeurs entre parenthèses de var() ne sont qu'un secours si le thème n'est pas chargé. La mise en page
 * s'adapte à la largeur de la case (container query), pas à celle de l'écran. Aucune animation sans prefers-reduced-motion. */

const CARD_CSS = `
.cpl{container-type:inline-size;width:100%;font-family:var(--v-font,inherit);color:var(--v-fg,inherit)}
.cpl *{box-sizing:border-box}
.cpl p,.cpl h3,.cpl ul{margin:0;padding:0}
.cpl ul{list-style:none}
.cpl-card,.cpl-list{position:relative;overflow:hidden;background:var(--v-surface,#1c1c1f);border:1px solid var(--v-line,#333);border-radius:1rem;box-shadow:0 1px 2px color-mix(in srgb,var(--v-fg,#000) 12%,transparent),0 10px 28px -14px color-mix(in srgb,var(--v-fg,#000) 35%,transparent)}
.cpl-card::before,.cpl-list::before{content:"";position:absolute;inset:0 0 auto 0;height:4px;background:var(--v-gradient,var(--v-accent,#e8a23b))}
.cpl-card{display:flex;gap:1rem;align-items:flex-start;padding:1.25rem 1rem 1rem}
.cpl-covers{display:flex;flex:0 0 auto;padding-left:.75rem}
.cpl-covers img{display:block;width:5.25rem;aspect-ratio:3/4;object-fit:cover;border-radius:.6rem;border:2px solid var(--v-surface,#1c1c1f);box-shadow:0 4px 12px -4px color-mix(in srgb,var(--v-fg,#000) 45%,transparent);background:var(--v-line,#333);margin-left:-.75rem}
.cpl-covers img+img{margin-left:-2.5rem}
.cpl-body{flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:.4rem;overflow-wrap:anywhere}
.cpl-ph{--cpl-twitch:#9146ff;--cpl-on:#fff;position:relative;display:flex;flex:0 0 auto;align-items:center;justify-content:center;width:5.25rem;aspect-ratio:3/4;overflow:hidden;border-radius:.6rem;border:2px solid var(--v-surface,#1c1c1f);color:var(--cpl-on);font-weight:800;font-size:2.25rem;line-height:1;background:repeating-linear-gradient(135deg,color-mix(in srgb,var(--cpl-on) 7%,transparent) 0 .5rem,transparent .5rem 1rem),linear-gradient(160deg,var(--cpl-twitch),color-mix(in srgb,var(--cpl-twitch) 72%,black))}
.cpl-ph img{display:block;width:72%;height:auto;max-height:72%;object-fit:contain}
.cpl-ph-disc{display:flex;align-items:center;justify-content:center;width:70%;aspect-ratio:1;border-radius:50%;background:var(--cpl-on);padding:12%}
.cpl-ph-disc img{width:100%;max-height:100%}
.cpl-ph-s{width:2.5rem;border-radius:.4rem;border-width:0;font-size:1.1rem}
.cpl-badge{display:inline-block;padding:.15rem .6rem;border-radius:999px;background:var(--v-accent,#e8a23b);color:var(--v-accent-fg,#111);font-size:.78rem;font-weight:700;letter-spacing:.02em;line-height:1.4}
[data-accent2] .cpl-badge{background:var(--v-accent2,#e8a23b);color:var(--v-accent2-fg,#111)}
.cpl-title{font-size:1.25rem;font-weight:700;line-height:1.25}
.cpl-when{display:flex;flex-wrap:wrap;align-items:baseline;gap:.1rem .75rem}
.cpl-hour{font-size:1.75rem;font-weight:800;line-height:1.1;font-variant-numeric:tabular-nums}
.cpl-day{color:var(--v-muted,#aaa);font-size:1rem}
.cpl-games,.cpl-also{color:var(--v-muted,#aaa);font-size:.9rem}
.cpl-btn,.cpl-link{display:inline-flex;align-items:center;gap:.4rem;font-weight:600;text-decoration:none}
.cpl-btn{margin-top:.35rem;padding:.55rem 1rem;border-radius:.65rem;background:var(--v-accent,#e8a23b);color:var(--v-accent-fg,#111);min-height:2.75rem}
[data-accent2] .cpl-btn{background:var(--v-accent2,#e8a23b);color:var(--v-accent2-fg,#111)}
.cpl-link{color:var(--v-fg,inherit);text-decoration:underline;text-underline-offset:.2em}
.cpl-btn:focus-visible,.cpl-link:focus-visible{outline:2px solid var(--v-fg,currentColor);outline-offset:3px}
@media (prefers-reduced-motion:no-preference){.cpl-btn{transition:transform .15s ease,filter .15s ease}.cpl-btn:hover{transform:translateY(-1px);filter:brightness(1.08)}}
.cpl-empty{display:block;padding:1.5rem 1rem 1.25rem;border-style:dashed;text-align:center}
.cpl-empty-t{font-size:1.1rem;font-weight:700}
.cpl-empty-s{color:var(--v-muted,#aaa);margin:.25rem 0 1rem}
.cpl-list{padding-top:4px}
.cpl-row{display:flex;gap:.75rem;align-items:center;padding:.75rem 1rem}
.cpl-row+.cpl-row{border-top:1px solid var(--v-line,#333)}
.cpl-tile{flex:0 0 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;width:3.25rem;padding:.3rem 0;border:1px solid var(--v-line,#333);border-radius:.6rem;background:color-mix(in srgb,var(--v-fg,#fff) 6%,var(--v-surface,#1c1c1f));line-height:1.15}
.cpl-tw{font-size:.72rem;text-transform:uppercase;letter-spacing:.04em;color:var(--v-muted,#aaa)}
.cpl-td{font-size:1.25rem;font-weight:800}
.cpl-thumb{flex:0 0 auto;width:2.5rem;aspect-ratio:3/4;object-fit:cover;border-radius:.4rem;background:var(--v-line,#333)}
.cpl-info{flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:.15rem;overflow-wrap:anywhere}
.cpl-row .cpl-title{font-size:1rem}
.cpl-meta{color:var(--v-muted,#aaa);font-size:.9rem}
.cpl-meta time{color:var(--v-fg,inherit);font-weight:700}
.cpl-foot{padding:.75rem 1rem;border-top:1px solid var(--v-line,#333)}
@container (min-width:30rem){.cpl-card{gap:1.5rem;padding:1.5rem 1.5rem 1.25rem}.cpl-covers img,.cpl-ph:not(.cpl-ph-s){width:7.5rem}.cpl-ph:not(.cpl-ph-s){font-size:3rem}.cpl-covers img+img{margin-left:-3.5rem}.cpl-title{font-size:1.5rem}.cpl-hour{font-size:2.25rem}.cpl-row{padding:.85rem 1.25rem}.cpl-foot{padding:.75rem 1.25rem}}
`.replace(/\n/g, "");

const { relativeLabel } = await import(`./relative.mjs${V}`);
const { appearanceBlocks, wantsCancelled, previewBlocks, densify } = await import(`./appearances/entry.mjs${V}`);   // apparences au choix : voir appearances/
export { relativeLabel };

const isoOf = (slot, tz) => { if (!slot.allDay) return slot.start.toISOString(); const w = wallDateNow(tz, slot.start); return `${w.y}-${String(w.m).padStart(2, "0")}-${String(w.d).padStart(2, "0")}`; };
const gameCovers = (slot, covers) => (slot.allDay ? [] : gamesOf(slot).map((name) => ({ name, url: covers.get(name) })).filter((g) => g.url));
const safeHttps = (v) => { const u = String(v ?? "").trim(); return /^https:\/\/[^\s"'<>]+$/i.test(u) ? u : null; };
const planningHref = (ctx) => { const b = ctx.instance?.basePath; return b === null || b === undefined ? null : b ? `/${b}` : "/"; };
const wrapCards = (inner) => `<div class="cpl"><style>${CARD_CSS}</style>${inner}</div>`;

/** Le logo du site à poser sur le mauve Twitch : la variante « fond sombre » (logo clair) si elle existe, sinon le logo principal sur un disque blanc. */
const logoUrl = (v) => (typeof v === "string" && /^(https:\/\/[^\s"'<>]+|\/(?!\/)[^\s"'<>]*)$/.test(v.trim()) ? v.trim() : null);
export async function brandVisual(ctx) {
  let b = null;
  try { b = typeof ctx.api?.brand === "function" ? await ctx.api.brand(ctx.locale) : null; } catch { b = null; }
  const logos = Array.isArray(b?.logos) ? b.logos : [];
  const of = (kind) => logoUrl(logos.find((l) => l?.kind === kind)?.src);
  const light = of("squareDark") ?? of("wideDark");
  const plain = logoUrl(b?.logo) ?? of("square") ?? of("wide");
  const name = String(b?.name ?? "").trim();
  return { src: light ?? plain, light: !!light, initial: (name ? [...name][0].toUpperCase() : "▶") };
}

/** Visuel de repli d'un stream sans jeu : mêmes proportions que la jaquette. Décoratif (le titre dit déjà tout). */
function placeholderHtml(vis, small = false) {
  const inner = vis?.src
    ? (vis.light ? `<img src="${esc(vis.src)}" alt="" loading="lazy" width="120" height="120">` : `<span class="cpl-ph-disc"><img src="${esc(vis.src)}" alt="" loading="lazy" width="120" height="120"></span>`)
    : `<span>${esc(vis?.initial ?? "▶")}</span>`;
  return `<span class="cpl-ph${small ? " cpl-ph-s" : ""}" aria-hidden="true">${inner}</span>`;
}

function badgeHtml(label) { return label ? `<p><span class="cpl-badge">${esc(label)}</span></p>` : ""; }

/**
 * Le lien de la chaîne Twitch : c'est le bouton Twitch que la Chaîne Twitch fournit déjà (sujet `social.link`) — une donnée, un propriétaire.
 * Repli : l'ancien réglage « Lien de votre chaîne », pour les sites sans Chaîne Twitch.
 */
async function channelLink(ctx) {
  try {
    const items = await ctx.api.topics.collect("social.link", { limit: 20 });
    const twitch = safeHttps(items.find((i) => i.icon === "twitch")?.url);
    if (twitch) return twitch;
  } catch { /* sujet indisponible : on retombe sur le réglage */ }
  return safeHttps(ctx.setting("channelUrl"));
}

/** La grande carte du prochain stream. `others` : les autres créneaux du même jour. */
function nextCardHtml(slot, others, ctx, tz, covers, now, vis, channelHref) {
  const t = ctx.t;
  const gc = gameCovers(slot, covers).slice(0, 3);
  const games = gamesOf(slot);
  const day = new Intl.DateTimeFormat(ctx.locale, { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(slot.start);
  const hour = slot.allDay ? t("allDay") : fmtTime(slot.start, ctx.locale, tz);
  const channel = channelHref;
  const imgs = !gc.length ? placeholderHtml(vis) : `<span class="cpl-covers">${gc.map((g) => `<img src="${esc(g.url)}" alt="${esc(t("coverAlt", { game: g.name }))}" loading="lazy" width="120" height="160">`).join("")}</span>`;
  const also = others.length ? `<p class="cpl-also">${esc(t("alsoToday"))} ${others.map((o) => `<time datetime="${esc(isoOf(o, tz))}">${esc(o.allDay ? t("allDay") : fmtTime(o.start, ctx.locale, tz))}</time> ${esc(o.title)}`).join(" · ")}</p>` : "";
  return wrapCards(`<article class="cpl-card">${imgs}<div class="cpl-body">${badgeHtml(relativeLabel(slot, now, tz, t))}` +
    `<h3 class="cpl-title">${esc(slot.title)}</h3>${slot.source ? `<p class="cpl-also">${sourceDot(slot.source).replace("margin-left:.5em;", "")}</p>` : ""}` +
    `<p class="cpl-when"><time class="cpl-hour" datetime="${esc(isoOf(slot, tz))}">${esc(hour)}</time><span class="cpl-day">${esc(day)}</span></p>` +
    `${games.length ? `<p class="cpl-games">${esc(t("gamesLabel"))} ${games.map(esc).join(", ")}</p>` : ""}${also}` +
    `${channel ? `<a class="cpl-btn" href="${esc(channel)}" target="_blank" rel="noopener noreferrer">${esc(t("watch"))}</a>` : ""}` +
    `</div></article>`);
}

/** Une liste de créneaux à venir (une ligne par stream : jour, jaquette, titre, heure). */
function upcomingListHtml(slots, ctx, tz, covers, now, vis) {
  const t = ctx.t;
  const href = planningHref(ctx);
  const rows = slots.map((s) => {
    const wd = new Intl.DateTimeFormat(ctx.locale, { weekday: "short", timeZone: tz }).format(s.start);
    const dn = new Intl.DateTimeFormat(ctx.locale, { day: "numeric", timeZone: tz }).format(s.start);
    const gc = gameCovers(s, covers)[0];
    const games = s.allDay ? [] : gamesOf(s);
    const hour = s.allDay ? t("allDay") : fmtTime(s.start, ctx.locale, tz);
    const rel = relativeLabel(s, now, tz, t);
    return `<li class="cpl-row"><time class="cpl-tile" datetime="${esc(isoOf(s, tz))}"><span class="cpl-tw">${esc(wd)}</span><span class="cpl-td">${esc(dn)}</span></time>` +
      `${gc ? `<img class="cpl-thumb" src="${esc(gc.url)}" alt="${esc(t("coverAlt", { game: gc.name }))}" loading="lazy" width="40" height="54">` : placeholderHtml(vis, true)}` +
      `<div class="cpl-info"><span class="cpl-title">${esc(s.title)}${sourceDot(s.source)}</span><span class="cpl-meta"><time datetime="${esc(isoOf(s, tz))}">${esc(hour)}</time>${games.length ? ` · ${games.map(esc).join(", ")}` : ""}</span></div>` +
      `${rel ? `<span class="cpl-badge">${esc(rel)}</span>` : ""}</li>`;
  }).join("");
  return wrapCards(`<div class="cpl-list"><ul>${rows}</ul>${href ? `<div class="cpl-foot"><a class="cpl-link" href="${esc(href)}">${esc(t("fullPlanning"))}</a></div>` : ""}</div>`);
}

/* ───────────────────────────── Aide à la saisie : tutoriel d'admin et SKILL.md pour une IA ───────────────────────────── */

const TUTO_CSS = `.cpt{margin:1rem 0}.cpt *{box-sizing:border-box}.cpt summary,.cpt .cpt-dl{display:inline-flex;align-items:center;min-height:2.75rem;padding:.55rem 1rem;border:1px solid color-mix(in srgb,currentColor 35%,transparent);border-radius:.65rem;font-weight:600;cursor:pointer;text-decoration:none;color:inherit}.cpt summary:hover,.cpt .cpt-dl:hover{background:color-mix(in srgb,currentColor 8%,transparent)}.cpt summary:focus-visible,.cpt .cpt-dl:focus-visible{outline:2px solid currentColor;outline-offset:3px}.cpt-body{margin-top:1rem;max-width:60rem;line-height:1.5}.cpt-body h4{margin:1.25rem 0 .4rem;font-size:1.05rem}.cpt-body ol,.cpt-body ul{margin:.25rem 0;padding-left:1.4rem}.cpt-body li{margin:.25rem 0}.cpt-row{padding:.75rem 0;border-top:1px solid color-mix(in srgb,currentColor 18%,transparent)}.cpt-row dt{font-weight:700}.cpt-row dd{margin:.15rem 0 0}.cpt-row .cpt-k{display:block;opacity:.75;font-size:.9rem}.cpt-ex{margin:.5rem 0;padding:.75rem 1rem;border:1px solid color-mix(in srgb,currentColor 25%,transparent);border-radius:.75rem}.cpt-ex dt{font-weight:700}.cpt-ex dd{margin:0 0 .4rem}.cpt-help{margin:.5rem 0 0;opacity:.8;font-size:.9rem}`;

const TUTO_FIELDS = ["Title", "When", "End", "Game", "Desc", "Place", "AllDay", "Repeat", "Cancel"];

/** Le tutoriel « Comment remplir mon agenda Google ? » (repliable) et le bouton de téléchargement du SKILL.md. Tout ce qui est dit ici est ce que le module lit. */
export function tutorialHtml(ctx, tz) {
  const t = (k, v) => esc(ctx.t(k, v));
  const rows = TUTO_FIELDS.map((f) => `<dl class="cpt-row"><dt>${t(`tuto${f}What`)}</dt><dd><span class="cpt-k">${t("tutoColWhere")}</span>${t(`tuto${f}Where`)}</dd><dd><span class="cpt-k">${t("tutoColDoes")}</span>${t(`tuto${f}Does`, { tz })}</dd></dl>`).join("");
  const li = (prefix, n) => Array.from({ length: n }, (_, i) => `<li>${t(`${prefix}${i + 1}`)}</li>`).join("");
  const ex = (title, when, place, desc) => `<dl class="cpt-ex"><dt>${t("tutoExFieldTitle")}</dt><dd>${esc(title)}</dd><dt>${t("tutoExFieldWhen")}</dt><dd>${esc(when)}</dd><dt>${t("tutoExFieldPlace")}</dt><dd>${esc(place)}</dd><dt>${t("tutoExFieldDesc")}</dt><dd>${esc(desc)}</dd></dl>`;
  const href = `/m/${encodeURIComponent(ctx.instance.key)}/skill?lang=${encodeURIComponent(ctx.locale)}`;
  return `<div class="cpt"><style>${TUTO_CSS}</style>` +
    `<details><summary>${t("tutoBtn")}</summary><div class="cpt-body"><p>${t("tutoIntro")}</p>${rows}` +
    `<h4>${t("tutoStepsTitle")}</h4><ol>${li("tutoStep", 5)}</ol>` +
    `<h4>${t("tutoExampleTitle")}</h4>${ex(ctx.t("tutoExTitle"), ctx.t("tutoExWhen"), ctx.t("tutoExPlace"), ctx.t("tutoExDesc"))}<p>${t("tutoExNoGameTitle")}</p>${ex(ctx.t("tutoExTitle"), ctx.t("tutoExWhen"), ctx.t("tutoExPlace"), ctx.t("tutoExNoGameDesc"))}` +
    `<h4>${t("tutoErrTitle")}</h4><ul>${li("tutoErr", 5)}</ul></div></details>` +
    `<p style="margin-top:.75rem"><a class="cpt-dl" href="${esc(href)}" download="SKILL.md">${t("skillBtn")}</a></p><p class="cpt-help">${t("skillHelp")}</p></div>`;
}

const oneLine = (v, max = 80) => String(v ?? "").replace(/[\u0000-\u001f\u007f`<>]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** Le SKILL.md : généré à partir des réglages réels (fuseau, nom du site). Aucun secret : ni l'adresse du calendrier, ni aucune clé. */
export async function skillMarkdown(ctx) {
  const tz = isValidTimeZone(ctx.setting("timezone")) ? ctx.setting("timezone") : "UTC";
  let site = "";
  try { site = oneLine((await ctx.api.site(ctx.locale))?.name); } catch { site = ""; }
  const vars = { site: site || "ce site", tz };
  // L'en-tête YAML : chaînes JSON (guillemets doubles, échappées) = YAML valide quel que soit le nom du site.
  return `---\nname: ${ctx.t("skillName")}\ndescription: ${JSON.stringify(oneLine(ctx.t("skillDesc", vars), 400))}\n---\n\n${ctx.t("skillBody", vars)}\n`;
}

function emptyCardHtml(ctx) {
  const t = ctx.t;
  const href = planningHref(ctx);
  return wrapCards(`<div class="cpl-card cpl-empty"><p class="cpl-empty-t">${esc(t("noStream"))}</p><p class="cpl-empty-s">${esc(t("noStreamHint"))}</p>${href ? `<a class="cpl-link" href="${esc(href)}">${esc(t("fullPlanning"))}</a>` : ""}</div>`);
}

/** Une semaine (lundi → dimanche) de créneaux, passés compris : pour l'image à partager. */
async function loadWeek(ctx, weekOffset) {
  const timeZone = timeZoneOf(ctx);
  const range = getWeekRange(weekOffset, timeZone);
  const r = await loadSlots(ctx, 7, { from: range.start, to: range.end });
  if (!r.configured || !r.ok) return null;
  return { timeZone, range, days: buildDays(range.startWall, 7, r.slots, timeZone) };
}

/**
 * L'arborescence de l'image « semaine du X au Y » (voir ctx.api.png) : 900 px de large, mêmes couleurs que le site, une ligne par jour
 * en zigzag, au plus 2 streams par jour, jaquettes (3 au plus par stream) à gauche de l'heure et du titre — comme l'image de l'ancien site.
 * Un stream sans jaquette garde le nom de son jeu en petit sous le titre. `covers` : Map(nom du jeu -> adresse https).
 */
export function weekImage(ctx, week, site, covers = new Map()) {
  const c = ctx.theme, tz = week.timeZone;
  const box = (style, ...children) => ({ type: "div", props: { style: { display: "flex", ...style }, children } });
  const day = (d) => new Intl.DateTimeFormat(ctx.locale, { weekday: "long", timeZone: tz }).format(zonedTimeToUtc(d.wall.y, d.wall.m, d.wall.d, 12, 0, 0, tz));
  const short = (d) => new Intl.DateTimeFormat(ctx.locale, { day: "numeric", month: "short", timeZone: tz }).format(zonedTimeToUtc(d.wall.y, d.wall.m, d.wall.d, 12, 0, 0, tz));
  const label = `${short({ wall: week.range.startWall })} – ${short({ wall: week.range.endWall })}`;
  const empty = week.days.every((d) => d.streams.length === 0);
  const WIDTH = 900, PAD = 32, HEADER = 100, GAP = 16, LABEL = 170, INNER_GAP = 14, ROW_GAP = 10, PAD_X = 20, PAD_Y = 14, STREAM_GAP = 14, COVER_GAP = 6, COVER_ROW_GAP = 14, FOOTER = 50, EMPTY = 220;
  const BOX_WIDTH = WIDTH - PAD * 2 - LABEL - INNER_GAP;
  const ROW = Math.max(1, ...week.days.map((d) => Math.min(2, d.streams.length))) >= 2 ? 270 : 150;
  const height = empty ? PAD * 2 + HEADER + GAP + EMPTY + FOOTER + 24 : PAD * 2 + HEADER + GAP + week.days.length * ROW + (week.days.length - 1) * ROW_GAP + FOOTER + 24;
  const page = typeof ctx.instance.basePath === "string" && ctx.instance.basePath ? `/${ctx.instance.basePath}` : "";
  const footer = `${String(ctx.api.siteUrl ?? "").replace(/^https?:\/\//, "")}${page}`.slice(0, 80);

  const stream = (s, coverH) => {
    const list = coversOf(s, covers).slice(0, MAX_GAMES_PER_STREAM);
    const coverW = Math.round(coverH * (40 / 54));
    const textW = BOX_WIDTH - PAD_X * 2 - (list.length ? list.length * coverW + (list.length - 1) * COVER_GAP + COVER_ROW_GAP : 0);
    const games = list.length || s.allDay ? "" : gamesOf(s).join(", ");
    return box({ alignItems: "center", gap: COVER_ROW_GAP },
      ...(list.length ? [box({ gap: COVER_GAP, flexShrink: 0 }, ...list.map((src) => ({ type: "img", props: { src, width: coverW, height: coverH, style: { borderRadius: 6, objectFit: "cover" } } })))] : []),
      box({ flexDirection: "column", justifyContent: "center", gap: 2, width: textW, ...(list.length ? { height: coverH } : {}) },
        box({ fontSize: 24, color: c.accent, fontWeight: 700 }, s.allDay ? ctx.t("allDay") : fmtTime(s.start, ctx.locale, tz)),
        box({ fontSize: 32, color: c.fg, lineHeight: 1.25, height: 32 * 1.25 * 2, overflow: "hidden" }, String(s.title).slice(0, 90)),
        ...(games ? [box({ fontSize: 22, color: c.muted }, games.slice(0, 60))] : [])));
  };
  const rows = week.days.map((d, i) => {
    const content = ROW - PAD_Y * 2;
    const shown = d.streams.slice(0, 2);
    const coverH = Math.round(shown.length === 2 ? (content - STREAM_GAP) / 2 : content);
    const label_ = box({ flexDirection: "column", justifyContent: "center", width: LABEL, height: ROW, flexShrink: 0 }, box({ fontSize: 34, color: c.fg, fontWeight: 700 }, day(d)), box({ fontSize: 24, color: c.muted }, short(d)));
    const card = box({ width: BOX_WIDTH, height: ROW, overflow: "hidden", alignItems: "center", backgroundColor: c.surface, borderRadius: 20, padding: `${PAD_Y}px ${PAD_X}px` },
      shown.length ? box({ flexDirection: "column", gap: STREAM_GAP, width: "100%" }, ...shown.map((s) => stream(s, coverH))) : box({ fontSize: 28, color: c.muted }, ctx.t("none")));
    return box({ gap: INNER_GAP, alignItems: "center" }, ...(i % 2 === 0 ? [label_, card] : [card, label_]));
  });
  const logo = site.logo ? [{ type: "img", props: { src: site.logo, width: 56, height: 56, style: { borderRadius: 28, objectFit: "cover" } } }] : [];
  const tree = box({ width: "100%", height: "100%", flexDirection: "column", backgroundColor: c.bg, padding: PAD },
    box({ justifyContent: "space-between", alignItems: "flex-start", height: HEADER },
      box({ flexDirection: "column" }, box({ fontSize: 60, fontWeight: 700, color: c.fg }, ctx.t("imageTitle")), box({ fontSize: 28, color: c.accent, marginTop: 4 }, label)),
      box({ alignItems: "center", gap: 14 }, box({ fontSize: 30, fontWeight: 700, color: c.fg }, String(site.name).slice(0, 30)), ...logo)),
    empty
      ? box({ flexDirection: "column", alignItems: "center", justifyContent: "center", height: EMPTY, marginTop: GAP, backgroundColor: c.surface, borderRadius: 20, gap: 10 }, box({ fontSize: 32, color: c.fg, fontWeight: 700 }, ctx.t("imageEmpty")), box({ fontSize: 24, color: c.muted }, ctx.t("imageEmptyHint")))
      : box({ flexDirection: "column", gap: ROW_GAP, marginTop: GAP }, ...rows),
    box({ marginTop: "auto", paddingTop: 24, fontSize: 22, color: c.accent, fontWeight: 700 }, footer));
  return { width: WIDTH, height, tree };
}

/** Les sources de calendrier et les prochains créneaux (haut du panneau d'admin). */
async function adminStatusBlocks(ctx) {
    const t = ctx.t;
    const days = clampDays(ctx.setting("days"));
    const blocks = [{ type: "heading", text: t("adminStatus") }];
    const { configured, ok, slots, timeZone, sources } = await loadSlots(ctx, Math.max(days, 14));
    if (!configured) return [...blocks, { type: "markdown", text: t("adminNoSource") }];
    const tz = timeZone ?? "UTC";
    blocks.push({ type: "table", columns: [t("srcName"), t("srcKind"), t("srcState")], rows: sources.map((x) => [x.label || x.name || x.instance, t(`kind_${x.kind}`), x.state === "error" ? `⚠️ ${t("srcError")}` : x.state === "stale" ? `⚠️ ${t("srcStale")}` : t("srcOk")]) });
    blocks.push({ type: "markdown", text: t("adminChoose") });
    if (!ok) return [...blocks, { type: "markdown", text: `⚠️ ${t("adminError")}` }];
    blocks.push({ type: "markdown", text: t("adminOk", { n: slots.filter((s) => s.start.getTime() <= Date.now() + days * 86_400_000).length, days }) });
    if (!slots.length) return [...blocks, { type: "markdown", text: t("adminEmpty") }];
    blocks.push({ type: "heading", text: t("adminNext") });
    blocks.push({ type: "table", columns: [t("date"), t("time"), t("slot"), t("games")], rows: slots.slice(0, 20).map((s) => [new Intl.DateTimeFormat(ctx.locale, { weekday: "short", day: "numeric", month: "short", timeZone: tz }).format(s.start), s.allDay ? t("allDay") : fmtTime(s.start, ctx.locale, tz), s.title, gamesOf(s).join(", ")]) });
    // Jaquettes : un message clair plutôt qu'un manque silencieux (clé absente, refusée, RAWG injoignable, jeux inconnus de RAWG).
    const next = slots.slice(0, 20);
    const { covers, states } = await coversForSlots(ctx, next);
    if (states.size) {
      const all = [...states.entries()];
      const has = (st) => all.some(([, v]) => v === st);
      const lost = all.filter(([n, v]) => v === "none" && !covers.has(n)).map(([n]) => n);
      blocks.push({ type: "heading", text: t("coversTitle") });
      if (has("no_key")) blocks.push({ type: "markdown", text: t("coversNoKey") });
      else if (has("denied")) blocks.push({ type: "markdown", text: `⚠️ ${t("coversDenied")}` });
      else if (has("down") && !covers.size) blocks.push({ type: "markdown", text: `⚠️ ${t("coversDown")}` });
      else blocks.push({ type: "markdown", text: t("coversOk", { found: covers.size, total: states.size }) });
      if (lost.length) blocks.push({ type: "markdown", text: t("coversNone", { games: lost.map(escMd).join(", ") }) });
      const withCovers = next.filter((s) => coversOf(s, covers).length > 0);
      if (withCovers.length) blocks.push({ type: "html", html: withCovers.map((s) => slotHtml(s, ctx, tz, coversOf(s, covers), new Intl.DateTimeFormat(ctx.locale, { weekday: "short", day: "numeric", month: "short", timeZone: tz }).format(s.start))).join("") });
    }
    return blocks;
}

export default {
  // Image PNG de la semaine (aussi pour une extension de panneau Twitch) : /m/<clé>/image?week=0 (0 = cette semaine, jusqu'à 8).
  routes: {
    // SKILL.md pour une IA (« Télécharger le skill »). Public : le contenu est généré à partir du fuseau et du nom du site, jamais de secret.
    async skill(request, ctx) {
      if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
      return new Response(request.method === "HEAD" ? null : await skillMarkdown(ctx), { headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": 'attachment; filename="SKILL.md"', "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" } });
    },
    async image(request, ctx) {
      const offset = Math.min(8, Math.max(0, Math.trunc(Number(new URL(request.url).searchParams.get("week"))) || 0));
      const week = await loadWeek(ctx, offset);
      if (!week) return new Response("Calendar not available", { status: 404 });
      const site = await ctx.api.site(ctx.locale);
      const shown = week.days.flatMap((d) => d.streams.slice(0, 2));
      const { covers } = await coversForSlots(ctx, shown);
      let res;
      // Une jaquette que le générateur d'images n'arrive pas à charger ne doit pas coûter l'image entière : on la refait sans jaquettes.
      try { res = await ctx.api.png(weekImage(ctx, week, site, covers)); } catch (e) { if (!covers.size) throw e; res = await ctx.api.png(weekImage(ctx, week, site)); }
      res.headers.set("Cache-Control", "public, max-age=300");
      return res;
    },
  },

  async page(ctx) {
    const days = clampDays(ctx.setting("days"));
    const { configured, ok, slots, timeZone } = await loadSlots(ctx, days, { cancelled: wantsCancelled(ctx) });
    const tz = timeZone ?? "UTC";
    const blocks = [];
    if (!configured || !ok) {
      blocks.push({ type: "markdown", text: ctx.t(configured ? "notReadable" : "notConfigured") });
      return { title: ctx.t("title"), blocks };
    }
    blocks.push({ type: "markdown", text: ctx.t("intro", { days, tz }) });
    const custom = await appearanceBlocks(ctx, "page", { slots, tz, days, covers: async () => (await coversForSlots(ctx, slots)).covers, brand: () => brandVisual(ctx) });
    if (custom) return { title: ctx.t("title"), blocks: [...blocks, ...custom] };   // apparence choisie par le propriétaire ; sinon le rendu d'origine ci-dessous
    const { covers } = await coversForSlots(ctx, slots);
    let vis;   // logo du site : chargé seulement si un jour mêle streams avec et sans jaquette
    for (const day of buildDays(wallDateNow(tz), days, slots, tz)) {
      blocks.push({ type: "heading", text: fmtDay(day.wall, ctx.locale, tz) });
      const mixed = anyCover(day.streams, covers) && day.streams.some((s) => !coversOf(s, covers).length);
      if (mixed) vis ??= await brandVisual(ctx);
      blocks.push(anyCover(day.streams, covers)
        ? { type: "html", html: (mixed ? `<style>${CARD_CSS}</style>` : "") + day.streams.map((s) => slotHtml(s, ctx, tz, coversOf(s, covers), "", mixed ? vis : null)).join("") }
        : { type: "markdown", text: day.streams.length ? day.streams.map((s) => `- ${slotLine(s, ctx, tz)}`).join("\n") : `*${ctx.t("none")}*` });
    }
    return { title: ctx.t("title"), blocks };
  },

  sections: {
    // Le prochain stream, seul : une carte (jaquette, heure, indication relative, bouton vers la chaîne). Calendrier lisible mais vide : carte « rien de prévu ».
    async next(ctx) {
      const { ok, slots, timeZone } = await loadSlots(ctx, 30);
      if (!ok) return null;
      const heading = { type: "heading", text: ctx.t("nextUp") };
      if (slots.length === 0) return [heading, { type: "html", html: emptyCardHtml(ctx) }];
      const tz = timeZone ?? "UTC";
      const s = slots[0];
      const sameDay = (o) => { const a = wallDateNow(tz, s.start), b = wallDateNow(tz, o.start); return a.y === b.y && a.m === b.m && a.d === b.d; };
      const others = slots.slice(1).filter(sameDay).slice(0, 4);
      const { covers } = await coversForSlots(ctx, [s]);
      const vis = gameCovers(s, covers).length ? null : await brandVisual(ctx);
      return [heading, { type: "html", html: densify(ctx, nextCardHtml(s, others, ctx, tz, covers, new Date(), vis, await channelLink(ctx))) }];
    },

    // Miniature des X prochains jours : un jour par ligne, les créneaux à la suite.
    async days(ctx, options) {
      const count = Math.min(7, Math.max(1, Math.trunc(Number(options.count)) || 3));
      const { ok, slots, timeZone } = await loadSlots(ctx, count);
      if (!ok) return null;
      const tz = timeZone ?? "UTC";
      const rows = buildDays(wallDateNow(tz), count, slots, tz).map((day) => {
        const label = new Intl.DateTimeFormat(ctx.locale, { weekday: "short", day: "numeric", timeZone: tz }).format(zonedTimeToUtc(day.wall.y, day.wall.m, day.wall.d, 12, 0, 0, tz));
        return `- **${label}** · ${day.streams.length ? day.streams.map((s) => slotLine(s, ctx, tz)).join(" · ") : ctx.t("noneToday")}`;
      });
      return [{ type: "heading", text: ctx.t("daysTitle") }, { type: "markdown", text: rows.join("\n") }];
    },

    async upcoming(ctx, options) {
      const count = Math.min(20, Math.max(1, Math.trunc(Number(options.count)) || 5));
      const { ok, slots, timeZone } = await loadSlots(ctx, 30);
      if (!ok) return null;
      const heading = { type: "heading", text: ctx.t("nextTitle") };
      const custom = await appearanceBlocks(ctx, "upcoming", { slots, tz: timeZone ?? "UTC", count, override: options.appearance, covers: async () => (await coversForSlots(ctx, slots.slice(0, count))).covers, brand: () => brandVisual(ctx) });
      if (custom) return [heading, ...custom];
      if (slots.length === 0) return [heading, { type: "html", html: emptyCardHtml(ctx) }];
      const tz = timeZone ?? "UTC";
      const shown = slots.slice(0, count);
      const { covers } = await coversForSlots(ctx, shown);
      const vis = shown.some((x) => !gameCovers(x, covers).length) ? await brandVisual(ctx) : null;
      return [heading, { type: "html", html: upcomingListHtml(shown, ctx, tz, covers, new Date(), vis) }];
    },
  },

  exports: {
    async "planning.slot"(ctx, { limit }) {
      const { slots } = await loadSlots(ctx, 30);
      return slots.slice(0, limit).map((s) => ({ title: s.title, text: gamesOf(s).join(", ") || undefined, start: s.start.toISOString(), end: s.end.toISOString(), allDay: s.allDay, games: gamesOf(s) }));
    },
  },

  /**
   * Version 2.0.0 : le Planning ne lit plus d'adresse iCal lui-même. Pour chaque ancienne adresse, le cœur sème UNE instance du Calendrier iCal
   * (adresse comprise : elle y reste un secret) ; l'ancien réglage n'est effacé qu'après un semis confirmé (le cœur l'impose), jamais avant.
   * Par défaut un Planning lit TOUTES les sources de calendrier : l'instance semée l'alimente donc sans autre réglage.
   * Idempotent : la graine (dérivée d'un hachage de l'adresse, jamais l'adresse) ne sème qu'une fois.
   */
  migrations: {
    2: async (ctx) => {
      const url = String(ctx.setting("icsUrl") ?? "").trim();
      if (!url) return;
      const tr = (k, fallback) => { const v = ctx.t?.(k); return typeof v === "string" && v && v !== k ? v : fallback; };
      const tz = String(ctx.setting("timezone") ?? "").trim();
      await ctx.seedInstance("calendar-ical", {
        nickname: tr("seedNickname", "Agenda iCal"),
        settings: { url, ...(isValidTimeZone(tz) ? { timezone: tz } : {}) },
        seedKey: seedKeyOf(url),
      });
      await ctx.clearSetting("icsUrl");   // seulement après le semis (créé, ou déjà semé)
    },
  },

  async adminPanel(ctx) {
    const blocks = await adminStatusBlocks(ctx);
    const tz = isValidTimeZone(ctx.setting("timezone")) ? ctx.setting("timezone") : "UTC";
    return [...blocks, ...(await previewBlocks(ctx, tz)), { type: "html", html: tutorialHtml(ctx, tz) }];
  },


  mcp: {
    async planning_upcoming(ctx, args) {
      const days = clampDays(args.days);
      const { ok, slots } = await loadSlots(ctx, days);
      if (!ok) throw Object.assign(new Error("no calendar source is chosen or it cannot be read"), { expose: true });
      return slots.map((s) => ({ title: s.title, start: s.start.toISOString(), end: s.end.toISOString(), allDay: s.allDay, games: gamesOf(s) }));
    },
  },
};
