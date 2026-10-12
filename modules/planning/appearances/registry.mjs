// Planning : le REGISTRE des apparences. Chaque apparence est un fichier de layouts/ qui exporte render(model, options, ctx) → { html, css }
// (pure : ni réseau, ni stockage). Ici on les charge, on en choisit une, on en fait un bloc HTML autonome (style compris).
// Ajouter une apparence = un fichier dans layouts/ + son identifiant dans options.mjs + son nom dans module.json et locales/.
const V = new URL(import.meta.url).search;
const { APPEARANCE_IDS, DEFAULT_APPEARANCE } = await import(`./options.mjs${V}`);
const { BASE_CSS, minify, emptyHtml, esc } = await import(`./kit.mjs${V}`);

/** id → { id, render }, pour toutes les apparences sauf `original` (le rendu historique, qui reste dans index.mjs). */
const layouts = new Map();
for (const id of APPEARANCE_IDS.filter((x) => x !== DEFAULT_APPEARANCE)) {
  try { const mod = (await import(`./layouts/${id}.mjs${V}`)).default; if (mod && typeof mod.render === "function") layouts.set(id, mod); } catch { /* une apparence cassée ne doit pas empêcher les autres */ }
}

export const FALLBACK_APPEARANCE = "classic";
export const registered = () => [...layouts.keys()];
export const hasAppearance = (id) => layouts.has(id);

/** Fragment { html, css } d'une apparence ; une exception d'une apparence retombe sur la liste classique, puis sur un simple message. */
export function renderFragment(id, model, ctx) {
  for (const tryId of [id, FALLBACK_APPEARANCE]) {
    const ap = layouts.get(tryId);
    if (!ap) continue;
    try {
      const out = ap.render(model, model.opts.own, ctx);
      if (out && typeof out.html === "string") return { id: tryId, html: out.html, css: typeof out.css === "string" ? out.css : "" };
    } catch { /* essayer la suivante */ }
  }
  return { id: FALLBACK_APPEARANCE, html: `<p class="pa-none">${esc(model.t("none"))}</p>`, css: "" };
}

/** Le bloc complet : conteneur thémé + style + contenu. */
export function renderAppearance(id, model, ctx) {
  const frag = renderFragment(id, model, ctx);
  return `<div class="pa pa-${esc(frag.id)}" data-density="${esc(model.opts.density)}"><style>${BASE_CSS}${minify(frag.css)}</style>${frag.html}</div>`;
}
