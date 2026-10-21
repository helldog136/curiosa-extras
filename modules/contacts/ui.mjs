// Contacts — rendu HTML de l'administration (cartes, pastilles de réseaux, barre de recherche, filtres, en-tête de fiche). Fonctions PURES :
// elles reçoivent des données déjà lues et rendent du texte HTML échappé. Mobile d'abord (une colonne, grandes zones à toucher), couleurs du
// thème de l'admin (variables --v-*), accessibles (listes, libellés, texte pour les lecteurs d'écran, focus visible).
import { NETWORK_LOOK } from "./networks.mjs";

export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
/** Adresse d'admin relative avec ces paramètres (vides retirés). */
export const href = (params) => { const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")); const s = q.toString(); return s ? `?${s}` : "?"; };
const safeImg = (u) => (typeof u === "string" && (/^https:\/\/[^\s"'<>]+$/i.test(u) || /^\/[A-Za-z0-9._~/%-]+(#[\w=.,:-]*)?$/.test(u)) ? u : null);
const hue = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
const initials = (name) => String(name ?? "?").trim().split(/\s+/).slice(0, 2).map((w) => [...w][0] ?? "").join("").toUpperCase() || "?";

export const STYLE = `<style>
.ct{--ct-gap:.75rem;color:var(--v-fg)}
.ct a:not(.ct-btn){color:inherit}
.ct-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.ct-tabs{display:flex;gap:.5rem;flex-wrap:wrap;margin:0 0 1rem;padding:0;list-style:none}
.ct-tabs a{display:inline-block;padding:.5rem .9rem;border-radius:999px;border:1px solid var(--v-line);text-decoration:none;font-weight:600;font-size:.9rem}
.ct-tabs a[aria-current="page"]{background:var(--v-accent);color:var(--v-accent-fg);border-color:var(--v-accent)}
.ct-search{display:flex;gap:.5rem;margin:0 0 .75rem}
.ct-search input{flex:1;min-width:0;padding:.7rem .9rem;border-radius:.75rem;border:1px solid var(--v-line);background:var(--v-surface);color:var(--v-fg);font-size:1rem}
.ct-search button,.ct a.ct-btn{padding:.7rem 1rem;border-radius:.75rem;border:0;background:var(--v-accent);color:var(--v-accent-fg);font-weight:600;font-size:.95rem;cursor:pointer;text-decoration:none;display:inline-block}
.ct a.ct-btn.ct-ghost{background:transparent;color:var(--v-fg);border:1px solid var(--v-line)}
.ct a:focus-visible,.ct button:focus-visible,.ct input:focus-visible{outline:2px solid var(--v-accent);outline-offset:2px}
.ct-chips{display:flex;gap:.4rem;flex-wrap:wrap;margin:0 0 .75rem;padding:0;list-style:none}
.ct-chips a{display:inline-flex;align-items:center;gap:.35rem;padding:.35rem .7rem;border-radius:999px;border:1px solid var(--v-line);text-decoration:none;font-size:.85rem;min-height:2rem}
.ct-chips a[aria-current="true"]{border-color:var(--v-accent);background:color-mix(in srgb,var(--v-accent) 18%,transparent);font-weight:600}
.ct-dot{width:.7rem;height:.7rem;border-radius:999px;background:var(--c);flex:none}
.ct-actions{display:flex;gap:.5rem;flex-wrap:wrap;margin:0 0 1rem}
.ct-count{color:var(--v-muted);font-size:.9rem;margin:0 0 .5rem}
.ct-cards{display:grid;gap:var(--ct-gap);grid-template-columns:1fr;margin:0;padding:0;list-style:none}
@media (min-width:700px){.ct-cards{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (min-width:1100px){.ct-cards{grid-template-columns:repeat(3,minmax(0,1fr))}}
.ct-card{display:flex;gap:.8rem;align-items:center;padding:.8rem;border-radius:1rem;border:1px solid var(--v-line);background:var(--v-surface);text-decoration:none;min-height:4.5rem}
.ct-card:hover{border-color:var(--v-accent)}
.ct-photo{width:3rem;height:3rem;border-radius:999px;flex:none;object-fit:cover;display:grid;place-items:center;font-weight:700;color:#fff;background:hsl(var(--h,200) 50% 30%);overflow:hidden}
.ct-photo.ct-org{border-radius:.8rem}
.ct-photo.ct-big{width:5.5rem;height:5.5rem;font-size:1.6rem}
.ct-main{min-width:0;flex:1;display:flex;flex-direction:column;gap:.2rem}
.ct-name{font-weight:700;overflow-wrap:anywhere}
.ct-sub{color:var(--v-muted);font-size:.85rem;overflow-wrap:anywhere}
.ct-nets{display:flex;gap:.25rem;flex-wrap:wrap}
.ct-net{display:inline-grid;place-items:center;width:1.5rem;height:1.5rem;border-radius:999px;background:var(--c);flex:none}
.ct-net svg{width:.9rem;height:.9rem;fill:#fff}
a.ct-net{text-decoration:none}
.ct-badge{display:inline-block;padding:.1rem .5rem;border-radius:999px;font-size:.75rem;font-weight:700;background:var(--v-warning);color:var(--v-warning-fg);white-space:nowrap}
.ct-cat{display:inline-flex;align-items:center;gap:.3rem;padding:.15rem .55rem;border-radius:999px;border:1px solid var(--v-line);font-size:.8rem}
.ct-more{margin:1rem 0;display:flex;gap:.5rem;flex-wrap:wrap}
.ct-head{display:flex;gap:1rem;align-items:center;flex-wrap:wrap;padding:1rem;border-radius:1rem;border:1px solid var(--v-line);background:var(--v-surface);margin:0 0 1rem}
.ct-head h2{margin:0;font-size:1.4rem;line-height:1.2;overflow-wrap:anywhere}
.ct-head .ct-main{gap:.35rem}
.ct-empty{padding:1.2rem;border-radius:1rem;border:1px dashed var(--v-line);color:var(--v-muted)}
.ct-back{display:inline-block;margin:0 0 .75rem;text-decoration:none;font-weight:600}
.ct-help{color:var(--v-muted);font-size:.9rem;margin:.25rem 0 .75rem}
.ct-bar{height:.8rem;border-radius:999px;background:var(--v-line);overflow:hidden;margin:.4rem 0}
.ct-bar>span{display:block;height:100%;background:var(--v-accent);border-radius:999px}
.ct-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.5rem;margin:.5rem 0 1rem;padding:0;list-style:none}
@media (min-width:700px){.ct-stats{grid-template-columns:repeat(4,minmax(0,1fr))}}
.ct-stat{border:1px solid var(--v-line);border-radius:1rem;padding:.7rem .8rem;background:var(--v-surface)}
.ct-stat b{display:block;font-size:1.5rem;line-height:1.2}
.ct-stat span{color:var(--v-muted);font-size:.85rem}
.ct-lines{list-style:none;margin:0 0 1rem;padding:0;display:grid;gap:.4rem}
.ct-lines li{font-size:.92rem;border:1px solid var(--v-line);border-radius:.75rem;padding:.6rem .8rem;background:var(--v-surface);overflow-wrap:anywhere}
.ct-cmp{display:grid;gap:var(--ct-gap);grid-template-columns:1fr;margin:0 0 1rem}
@media (min-width:700px){.ct-cmp{grid-template-columns:repeat(2,minmax(0,1fr))}}
.ct-box{border:1px solid var(--v-line);border-radius:1rem;padding:1rem;background:var(--v-surface);min-width:0}
.ct-box h3{margin:0 0 .6rem;font-size:1.05rem;overflow-wrap:anywhere}
.ct-kv{display:grid;gap:.1rem;margin:0}
.ct-kv dt{color:var(--v-muted);font-size:.8rem}
.ct-kv dd{margin:0 0 .45rem;overflow-wrap:anywhere}
.ct-list{margin:.25rem 0 .75rem;padding-left:1.2rem;list-style:disc}
.ct-list li{margin:.15rem 0;overflow-wrap:anywhere}
.ct-pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:.8rem;border-radius:.75rem;border:1px solid var(--v-line);background:var(--v-surface);margin:.25rem 0 .5rem}
</style>`;

/** Pastille d'un réseau (icône + nom pour les lecteurs d'écran ; lien vers le profil si `url`). */
export function netPill(network, label, url) {
  const look = NETWORK_LOOK[network] ?? NETWORK_LOOK.other;
  const inner = `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="${look.path}"/></svg><span class="ct-sr">${esc(label)}</span>`;
  return url && /^https:\/\//.test(url) ? `<a class="ct-net" style="--c:${look.color}" href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="${esc(label)}">${inner}</a>` : `<span class="ct-net" style="--c:${look.color}" title="${esc(label)}">${inner}</span>`;
}
/** Photo ronde (organisation : carrée arrondie) ou initiales. Décorative : le nom est écrit à côté. */
export function photo(cardData, big = false) {
  const url = safeImg(cardData.photo?.url);
  const cls = `ct-photo${cardData.kind === "org" ? " ct-org" : ""}${big ? " ct-big" : ""}`;
  return url ? `<img class="${cls}" src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="${cls}" style="--h:${hue(cardData.name)}" aria-hidden="true">${esc(initials(cardData.name))}</span>`;
}
/** Une carte de la liste. `t` : traducteur ; `netName(n)` : nom lisible d'un réseau. */
export function cardItem(c, { t, netName, link }) {
  const sub = c.kind === "org" ? t("kindOrg") : [c.role, c.orgName].filter(Boolean).join(" · ");
  const nets = [...new Map(c.accounts.map((a) => [a.network, a])).values()].map((a) => netPill(a.network, netName(a.network)));
  return `<li><a class="ct-card" href="${esc(link)}">${photo(c)}<span class="ct-main"><span class="ct-name">${esc(c.name)}</span>${sub ? `<span class="ct-sub">${esc(sub)}</span>` : ""}${nets.length ? `<span class="ct-nets">${nets.join("")}</span>` : ""}</span>${c.status === "to_review" ? `<span class="ct-badge">${esc(t("statusBadge"))}</span>` : ""}</a></li>`;
}
export const cardList = (items, opts) => `<ul class="ct-cards">${items.map((c) => cardItem(c, { ...opts, link: opts.linkOf(c) })).join("")}</ul>`;

/** Onglets (Contacts, Organisations, Catégories). */
export const tabs = (items, label) => `<nav aria-label="${esc(label)}"><ul class="ct-tabs">${items.map((i) => `<li><a href="${esc(i.href)}"${i.current ? ' aria-current="page"' : ""}>${esc(i.label)}</a></li>`).join("")}</ul></nav>`;
/** Barre de recherche : formulaire GET (les filtres en cours sont gardés en champs cachés). */
export function searchBar({ q, hidden, label, placeholder, button }) {
  const keep = Object.entries(hidden).filter(([, v]) => v).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join("");
  return `<form class="ct-search" method="get" role="search"><label class="ct-sr" for="ct-q">${esc(label)}</label><input id="ct-q" type="search" name="q" value="${esc(q)}" placeholder="${esc(placeholder)}" maxlength="100" autocomplete="off">${keep}<button type="submit">${esc(button)}</button></form>`;
}
/** Pastilles de filtre : [{ label, href, current, color?, network?, netLabel? }]. */
export const chips = (items, label) => (items.length ? `<ul class="ct-chips" aria-label="${esc(label)}">${items.map((i) => `<li><a href="${esc(i.href)}" aria-current="${i.current ? "true" : "false"}">${i.network ? netPill(i.network, "") : i.color ? `<span class="ct-dot" style="--c:${esc(i.color)}" aria-hidden="true"></span>` : ""}<span>${esc(i.label)}</span></a></li>`).join("")}</ul>` : "");

/** Barre de progression : `done` sur `total` (texte pour les lecteurs d'écran : `label`). */
export function bar(done, total, label) {
  const pct = total > 0 ? Math.max(0, Math.min(100, Math.floor((done * 100) / total))) : 0;
  return `<div class="ct-bar" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="${Number(total) || 0}" aria-valuenow="${Number(done) || 0}"><span style="width:${pct}%"></span></div>`;
}
/** Quatre chiffres côte à côte (deux par ligne sur téléphone) : [{ n, label, hint? }]. */
export const stats = (items, label) => `<ul class="ct-stats" aria-label="${esc(label)}">${items.map((i) => `<li class="ct-stat"><b>${esc(i.n)}</b><span>${esc(i.label)}</span></li>`).join("")}</ul>`;
/** Blocs « html » du panneau : le premier porte la feuille de style. */
export const htmlBlock = (inner) => ({ type: "html", html: `<div class="ct">${inner}</div>` });
export const firstBlock = (inner) => ({ type: "html", html: `${STYLE}<div class="ct">${inner}</div>` });
