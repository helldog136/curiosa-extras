// LA PAGE PUBLIQUE FACULTATIVE (2.2) : « En direct en ce moment » (titre par défaut, réglable). Elle montre les N membres de la sélection du moment (moment.mjs), les MÊMES que ceux du dock de sélection :
// nom (celui de la fiche de Contacts), jeu, titre, spectateurs, durée du direct, un bouton « Regarder sur Twitch » (lien sortant) et, si la propriétaire l'a permis, un bouton
// « Afficher les aperçus ». La liste complète des membres n'est JAMAIS publique : seulement les N tirés, et jamais une personne « Ne pas montrer » (voir consent.mjs).
//   - Aucune donnée de visiteur, aucun cookie. La page est écrite côté serveur (elle marche sans script), puis `scripts/live-members.js` la rafraîchit doucement (environ chaque
//     minute) en lisant `/m/<clé>/members`, sans clignoter : seules les valeurs qui changent sont réécrites. Si Twitch ne répond pas, la dernière sélection connue reste affichée.
//   - Tout ce qui vient de Twitch ou de Contacts est échappé ; les liens sont construits ici à partir d'un pseudo validé (jamais une adresse reçue) ; les images de Twitch ne se
//     chargent qu'après le clic du visiteur.
//   - La route publique `members` répond avec un cache court, borne le débit par visiteur et ne révèle rien d'autre que ce que montre la page.
//   - 2.2.1 — ÉTEINTE = AUCUNE TRACE : la page répond 404 (`notFound`, sans titre ni script annoncé) et `members` répond EXACTEMENT comme une route qui n'existe pas (404 « Not found »,
//     même corps que le cœur : pas même un « off » pour dire qu'il y a quelque chose). 2.2.2 : le manifeste déclare `pageSetting: "publicPage"`, donc le cœur (0.2.12) retire
//     lui-même l'entrée du plan du site, le lien de menu et la ligne de llms.txt tant que le réglage est faux (voir README, « Page éteinte »).
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const D = await import(`./draw.mjs${v}`);
const { durationText, oneLine } = await import(`./pure.mjs${v}`);
const M = await import(`./moment.mjs${v}`);

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (s, vars) => String(s).replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] !== undefined ? vars[k] : m));
/** Délais (en millisecondes) : un objet pour que les tests puissent les raccourcir. */
export const timing = { pageWaitMs: 4500, routeWaitMs: 13_000, refreshMs: 60_000 };
/** Débit : par visiteur et par minute, sur la route publique. */
export const limits = { perMinute: 60, tableMax: 2000 };

export const enabled = (ctx) => D.flag(ctx.setting("publicPage"));
const text = (ctx, key, fallbackKey, max) => oneLine(ctx.setting(key), max) || ctx.t(fallbackKey);
/** Les mots de la page : ceux de la propriétaire (réglages), sinon les mots simples des locales. */
export function texts(ctx) {
  return {
    title: text(ctx, "pageTitle", "pub_title", 120), intro: text(ctx, "pageIntro", "pub_intro", 400),
    empty: text(ctx, "emptyText", "pub_empty", 200), watch: text(ctx, "watchLabel", "pub_watch", 60),
  };
}
/** L'adresse de la chaîne sur Twitch, construite à partir d'un pseudo validé. */
export const channelUrl = (login) => (/^[a-z0-9_]{3,25}$/.test(String(login)) ? `https://www.twitch.tv/${login}` : "");

/** Un membre tel que la page le montre : seulement ce qui s'affiche. */
const member = (p, withThumbs) => ({ login: p.login, name: p.name, game: p.game, title: p.title, viewers: p.viewers, startedAt: p.startedAt, url: channelUrl(p.login), ...(withThumbs && p.thumb ? { thumb: p.thumb } : {}) });

/**
 * Le résultat de la sélection → ce que la page publique (et sa route) montre :
 *   { state: "ok", picks: [...] } (vide : « personne n'est en direct »), éventuellement `stale` (heure de la dernière sélection connue) · { state: "unavailable" }.
 * Rien d'autre ne sort : ni le nombre de membres en direct, ni la liste, ni la raison d'une panne.
 */
export function payload(ctx, r, now = M.hooks.now()) {
  const withThumbs = D.flag(ctx.setting("thumbs"));
  if (r?.state === "ok") return { state: "ok", picks: r.picks.map((p) => member(p, withThumbs)), now, asOf: r.asOf, ...(r.stale ? { stale: r.stale } : {}) };
  if (r?.state === "no_partners") return { state: "ok", picks: [], now, asOf: now };
  return { state: "unavailable", now };
}

const CSS = `
.tr{font-family:var(--v-font,inherit);color:var(--v-fg,inherit);max-width:72rem;margin:0 auto}
.tr *{box-sizing:border-box}
.tr h3,.tr p,.tr ul{margin:0;padding:0}
.tr ul{list-style:none}
.tr .tr-intro{color:var(--v-muted,#aaa);font-size:1.05rem;max-width:42rem;margin:0 0 1.25rem;overflow-wrap:anywhere}
.tr .tr-note{margin:0 0 1rem;padding:.6rem .85rem;border-radius:.7rem;border:1px solid var(--v-line,#333);background:var(--v-surface,#1c1c1f);color:var(--v-fg,inherit);overflow-wrap:anywhere}
.tr .tr-grid{display:grid;gap:.85rem;grid-template-columns:minmax(0,1fr)}
.tr .tr-card{display:flex;flex-direction:column;gap:.7rem;padding:1rem;background:var(--v-surface,#1c1c1f);border:1px solid var(--v-line,#333);border-radius:1rem;min-width:0}
.tr .tr-thumb{aspect-ratio:16/9;border-radius:.7rem;overflow:hidden;background:color-mix(in srgb,var(--v-accent,#9147ff) 18%,var(--v-surface,#1c1c1f))}
.tr .tr-thumb img{display:block;width:100%;height:100%;object-fit:cover}
.tr .tr-name{font-size:1.2rem;font-weight:800;line-height:1.25;overflow-wrap:anywhere}
.tr .tr-meta{display:flex;flex-wrap:wrap;gap:.15rem .85rem;margin-top:.25rem;color:var(--v-muted,#aaa);font-size:.92rem}
.tr .tr-meta span:empty{display:none}
.tr .tr-viewers{font-weight:700;color:var(--v-fg,inherit)}
.tr .tr-title{margin-top:.4rem;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.tr .tr-title:empty{display:none}
.tr .tr-body{flex:1 1 auto;min-width:0}
.tr .tr-btn{display:inline-flex;align-items:center;justify-content:center;min-height:2.75rem;padding:.55rem 1.1rem;border-radius:.7rem;font-weight:700;text-align:center;text-decoration:none;background:var(--v-accent,#9147ff);color:var(--v-accent-fg,#fff)}
.tr .tr-btn:focus-visible,.tr .tr-toggle:focus-visible{outline:2px solid var(--v-fg,currentColor);outline-offset:3px}
.tr .tr-tools{margin:0 0 1rem;display:flex;flex-wrap:wrap;align-items:center;gap:.5rem .85rem}
.tr .tr-toggle{min-height:2.75rem;padding:.5rem 1rem;border-radius:.7rem;border:1px solid var(--v-line,#333);background:var(--v-surface,#1c1c1f);color:var(--v-fg,inherit);font:inherit;font-weight:600;cursor:pointer}
.tr .tr-hint{color:var(--v-muted,#aaa);font-size:.9rem}
.tr .tr-empty{padding:2.25rem 1.25rem;text-align:center;border:1px dashed var(--v-line,#333);border-radius:1rem;background:var(--v-surface,#1c1c1f)}
.tr .tr-empty-t{font-size:1.15rem;font-weight:700;overflow-wrap:anywhere}
.tr .tr-empty-s{color:var(--v-muted,#aaa);margin-top:.35rem}
.tr .tr-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.tr [hidden]{display:none!important}
@media (min-width:36rem){.tr .tr-grid{grid-template-columns:repeat(auto-fill,minmax(17rem,1fr));gap:1rem}}
@media (prefers-reduced-motion:no-preference){.tr .tr-card{transition:border-color .15s ease}.tr .tr-card:hover{border-color:var(--v-accent,#9147ff)}}
`.replace(/\n/g, "");

/** Une carte, écrite côté serveur (le script écrit la même, voir scripts/live-members.js). */
function card(ctx, p, T, now, thumbsOn) {
  const viewers = fmt(ctx.t(p.viewers === 1 ? "dock_viewers_one" : "dock_viewers_other"), { n: p.viewers });
  const thumb = thumbsOn && p.thumb ? `<div class="tr-thumb" hidden><img data-src="${esc(p.thumb)}" alt="" width="320" height="180" decoding="async" referrerpolicy="no-referrer"></div>` : "";
  return `<li class="tr-card" data-login="${esc(p.login)}" data-started="${Number(p.startedAt) || 0}">${thumb}<div class="tr-body"><h3 class="tr-name">${esc(p.name)}</h3>`
    + `<p class="tr-meta"><span class="tr-game">${esc(p.game)}</span><span class="tr-dur">${esc(fmt(ctx.t("pub_live_for"), { d: durationText(now - p.startedAt) }))}</span><span class="tr-viewers">${esc(viewers)}</span></p>`
    + `<p class="tr-title">${esc(p.title)}</p></div>`
    + `<a class="tr-btn" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(T.watch)}<span class="tr-sr"> : ${esc(p.name)} ${esc(ctx.t("pub_watch_sr"))}</span></a></li>`;
}

/** Le contenu de la page (HTML d'un seul bloc). `pub` : le résultat de `payload`, ou null si la sélection n'était pas encore prête (le script la demande tout de suite). */
export function renderHtml(ctx, pub, T = texts(ctx)) {
  const thumbsOn = D.flag(ctx.setting("thumbs"));
  const now = pub?.now ?? M.hooks.now(), picks = pub?.state === "ok" ? pub.picks : [];
  const data = {
    "data-src": `/m/${ctx.instance.key}/members`, "data-interval": timing.refreshMs, "data-thumbs": thumbsOn ? "1" : "0",
    "data-viewers-one": ctx.t("dock_viewers_one"), "data-viewers-other": ctx.t("dock_viewers_other"), "data-live-for": ctx.t("pub_live_for"), "data-watch": T.watch, "data-watch-sr": ctx.t("pub_watch_sr"),
    "data-empty": T.empty, "data-empty-hint": ctx.t("pub_empty_hint"), "data-unavailable": ctx.t("pub_unavailable"), "data-unavailable-hint": ctx.t("pub_unavailable_hint"),
    "data-stale": ctx.t("pub_stale"), "data-failed": ctx.t("pub_update_failed"), "data-changed": ctx.t("pub_changed_sr"), "data-thumbs-show": ctx.t("pub_thumbs_show"), "data-thumbs-hide": ctx.t("pub_thumbs_hide"),
  };
  const attrs = Object.entries(data).map(([k, val]) => `${k}="${esc(val)}"`).join(" ");
  const state = pub?.state === "unavailable" ? "unavailable" : pub ? (picks.length ? "list" : "empty") : "loading";
  const stale = pub?.stale ? `<p class="tr-note" role="status">${esc(fmt(ctx.t("pub_stale"), { time: new Date(pub.stale).toLocaleTimeString(ctx.locale || "en", { hour: "2-digit", minute: "2-digit" }) }))}</p>` : `<p class="tr-note" role="status" hidden></p>`;
  return `<div class="tr" ${attrs} data-locale="${esc(ctx.locale || "en")}"><style>${CSS}</style>`
    + `<p class="tr-intro">${esc(T.intro)}</p>${stale}`
    + `<div class="tr-tools" hidden><button type="button" class="tr-toggle" aria-pressed="false">${esc(ctx.t("pub_thumbs_show"))}</button><span class="tr-hint" hidden>${esc(ctx.t("pub_thumbs_note"))}</span></div>`
    + `<ul class="tr-grid" aria-label="${esc(ctx.t("pub_list_label"))}"${state === "list" ? "" : " hidden"}>${picks.map((p) => card(ctx, p, T, now, thumbsOn)).join("")}</ul>`
    + `<div class="tr-empty" role="status"${state === "empty" ? "" : " hidden"}><p class="tr-empty-t">${esc(T.empty)}</p><p class="tr-empty-s">${esc(ctx.t("pub_empty_hint"))}</p></div>`
    + `<div class="tr-empty tr-unavail" role="status"${state === "unavailable" ? "" : " hidden"}><p class="tr-empty-t">${esc(ctx.t("pub_unavailable"))}</p><p class="tr-empty-s">${esc(ctx.t("pub_unavailable_hint"))}</p></div>`
    + `<p class="tr-loading tr-hint"${state === "loading" ? "" : " hidden"}>${esc(ctx.t("pub_loading"))}</p>`
    + `<p class="tr-sr" aria-live="polite" id="tr-changed"></p></div>`;
}

const waitFor = (p, ms) => { let t; return Promise.race([p, new Promise((r) => { t = setTimeout(() => r(null), ms); t.unref?.(); })]).finally(() => clearTimeout(t)); };

/** La page du site : la sélection du moment (attendue 4,5 s au plus ; sinon la page s'ouvre vide et le script la demande tout de suite). */
export async function page(ctx, segments) {
  if (segments.length || !enabled(ctx)) return { notFound: true };
  const T = texts(ctx);
  const res = await waitFor(M.momentNow(ctx), timing.pageWaitMs);
  const pub = res ? payload(ctx, res) : null;
  return { title: T.title, description: ctx.t("pub_description"), blocks: [{ type: "html", html: renderHtml(ctx, pub, T) }], scripts: ["live-members.js"] };
}

const hits = new Map();   // empreinte de la personne qui visite → heures de ses demandes récentes (en mémoire, jamais l'adresse en clair)
function allowed(ctx, request) {
  let who = "";
  try { who = String(ctx.api.visitor?.fingerprint?.(request, "members") ?? ""); } catch { who = ""; }
  if (!who) return true;   // pas d'empreinte (cœur ancien) : le cache de 30 s protège déjà Twitch et Contacts
  const now = Date.now(), recent = (hits.get(who) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= limits.perMinute) { hits.set(who, recent); return false; }
  recent.push(now); hits.delete(who); hits.set(who, recent);
  if (hits.size > limits.tableMax) hits.delete(hits.keys().next().value);
  return true;
}
export const resetPublic = () => hits.clear();

const headers = { "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
/** La route publique `members` : ce que la page lit toutes les minutes. GET seulement ; éteinte, elle répond comme une route qui n'existe pas. */
export async function membersRoute(request, ctx) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  if (!enabled(ctx)) return new Response("Not found", { status: 404 });   // la réponse du cœur pour une route inconnue, mot pour mot
  if (!allowed(ctx, request)) return Response.json({ state: "limited" }, { status: 429, headers: { ...headers, "Cache-Control": "no-store", "Retry-After": "30" } });
  const res = await waitFor(M.momentNow(ctx), timing.routeWaitMs);
  const body = payload(ctx, res);
  return new Response(JSON.stringify(body), { headers: { ...headers, "Cache-Control": body.state === "ok" ? "public, max-age=20" : "no-store" } });
}
