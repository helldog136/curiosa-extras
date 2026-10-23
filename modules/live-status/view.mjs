// Présentation de plusieurs chaînes en direct : HTML simple, sans script ni dépendance. TOUT ce qui vient de Twitch ou d'un réglage est échappé ici.
// Les couleurs viennent du thème du site (variables CSS) ; les pastilles sont des boutons radio (clavier : flèches), le lecteur affiché suit le bouton coché.
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const slug = (v) => String(v ?? "").replace(/[^a-zA-Z0-9_-]/g, "");

const BANNER_CSS = `.lsb{background:var(--v-success);color:var(--v-success-fg);font-size:.875rem;padding:.5rem 1rem}.lsb ul{list-style:none;margin:0 auto;padding:0;max-width:64rem;display:flex;flex-direction:column;gap:.375rem}.lsb li{display:flex;flex-wrap:wrap;align-items:center;gap:.25rem .75rem}.lsb .n{font-weight:700}.lsb .t{flex:1 1 12rem;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.lsb .m{opacity:.85}.lsb a{color:inherit;border:1px solid currentColor;border-radius:999px;padding:.125rem .75rem;font-weight:600;text-decoration:none}.lsb a:hover,.lsb a:focus-visible{background:var(--v-success-fg);color:var(--v-success)}`;

const BANNER_KIND_CSS = `.lsb .k{font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;border:1px solid currentColor;border-radius:.25rem;padding:0 .375rem}`;

/**
 * Bannière « plusieurs chaînes en direct » : une ligne par chaîne. `rows` : [{ name, channel, title, game, viewers }] ; `labels` : { live, watch, viewers(n) }.
 * Quand plusieurs plateformes sont en direct, chaque ligne porte en plus `platform` (nom de la plateforme, en pastille) et `href` (adresse de lecture, déjà construite) ;
 * sans cela, la ligne est celle d'avant (Twitch, adresse faite avec `channel`).
 */
export function bannerHtml(rows, labels) {
  const li = rows.map((r) => {
    const meta = [r.game, r.viewers != null ? labels.viewers(r.viewers) : ""].filter(Boolean).map(esc).join(" · ");
    const href = r.href ?? `https://twitch.tv/${slug(r.channel)}`;
    return `<li>${r.platform ? `<span class="k">${esc(r.platform)}</span>` : ""}<span class="n">${esc(r.name)}</span>${r.title ? `<span class="t">${esc(r.title)}</span>` : ""}${meta ? `<span class="m">${meta}</span>` : ""}<a href="${esc(href)}" rel="noopener" aria-label="${esc(`${labels.watch} — ${r.name}`)}">${esc(labels.watch)}</a></li>`;
  }).join("");
  return `<style>${BANNER_CSS}${rows.some((r) => r.platform) ? BANNER_KIND_CSS : ""}</style><div class="lsb" role="status"><ul aria-label="${esc(labels.live)}">${li}</ul></div>`;
}

const PLAYER_CSS = (id, n) => `#${id} .r{position:absolute;opacity:0;width:1px;height:1px}#${id} .p{display:inline-block;margin:0 .5rem .5rem 0;padding:.25rem .875rem;border:1px solid var(--v-line);border-radius:999px;font-size:.875rem;cursor:pointer}#${id} .r:checked+.p{background:var(--v-accent);color:var(--v-accent-fg);border-color:var(--v-accent)}#${id} .r:focus-visible+.p{outline:2px solid var(--v-accent);outline-offset:2px}#${id} .w{display:none;overflow:hidden;border:1px solid var(--v-line);border-radius:.75rem;aspect-ratio:16/9}#${id} iframe{width:100%;height:100%;border:0}` + Array.from({ length: n }, (_, i) => `#${id} .r${i}:checked~.w${i}{display:block}`).join("");

/** Lecteurs de plusieurs chaînes en direct, avec une pastille par chaîne pour passer de l'un à l'autre. `players` : [{ name, channel, src, title }] (src : adresse https du lecteur, déjà construite). */
export function playersHtml(players, key, label) {
  const id = `lsp-${slug(key) || "x"}`;
  const pills = players.map((p, i) => `<input type="radio" class="r r${i}" name="${id}" id="${id}-${i}"${i === 0 ? " checked" : ""}><label class="p" for="${id}-${i}">${esc(p.name)}</label>`).join("");
  const panes = players.map((p, i) => `<div class="w w${i}"><iframe src="${esc(p.src)}" title="${esc(p.title)}" allowfullscreen loading="lazy"></iframe></div>`).join("");
  return `<style>${PLAYER_CSS(id, players.length)}</style><div id="${id}" role="radiogroup" aria-label="${esc(label)}">${pills}${panes}</div>`;
}

const YT_CSS = (id) => `#${id} summary{display:inline-flex;align-items:center;gap:.5rem;min-height:2.75rem;padding:.5rem 1.25rem;border-radius:999px;background:var(--v-accent);color:var(--v-accent-fg);font-weight:600;cursor:pointer;list-style:none}#${id} summary::-webkit-details-marker{display:none}#${id} summary:focus-visible{outline:2px solid var(--v-accent);outline-offset:2px}#${id} details[open] summary{display:none}#${id} .w{overflow:hidden;border:1px solid var(--v-line);border-radius:.75rem;aspect-ratio:16/9}#${id} iframe{width:100%;height:100%;border:0}#${id} .note{margin:.5rem 0 0;font-size:.8125rem;color:var(--v-muted)}`;

/**
 * Lecteur YouTube « au clic » : rien n'est chargé depuis YouTube tant que le visiteur n'a pas ouvert le bloc (le lecteur est un cadre `loading="lazy"` rangé dans un bloc fermé : un cadre
 * caché ne se charge pas). Pas de script, accessible au clavier. `p` : { src (adresse https du lecteur, déjà construite), title } ; `labels` : { start, note }.
 */
export function youtubeClickHtml(p, key, labels) {
  const id = `lsy-${slug(key) || "x"}`;
  return `<style>${YT_CSS(id)}</style><div id="${id}"><details><summary>▶ ${esc(labels.start)}</summary><div class="w"><iframe src="${esc(p.src)}" title="${esc(p.title)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen loading="lazy"></iframe></div></details><p class="note">${esc(labels.note)}</p></div>`;
}
