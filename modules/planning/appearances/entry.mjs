// Planning : l'UNIQUE point d'entrée des apparences pour index.mjs. Il lit les réglages, choisit l'apparence, prépare le modèle et rend.
// Pour l'apparence `original` (valeur par défaut) il répond `null` : index.mjs garde alors son rendu historique, inchangé.
// Aucun accès réseau ici : les jaquettes et le logo arrivent par des fonctions que l'appelant fournit.
const V = new URL(import.meta.url).search;
const { normalizeOptions, DEFAULT_APPEARANCE } = await import(`./options.mjs${V}`);
const { buildModel } = await import(`./model.mjs${V}`);
const { renderAppearance, hasAppearance } = await import(`./registry.mjs${V}`);
const { safeHttps } = await import(`./kit.mjs${V}`);
export { normalizeOptions, DEFAULT_APPEARANCE };

const settingReader = (ctx) => (k) => ctx.setting(k);

/** L'apparence réellement utilisée par ce morceau ; `original` dès qu'elle est inconnue ou non installée. */
export function chosenAppearance(ctx, override) {
  const o = normalizeOptions(settingReader(ctx), override);
  return hasAppearance(o.appearance) ? o.appearance : DEFAULT_APPEARANCE;
}

/** Faut-il garder les créneaux annulés à la lecture du calendrier ? Seulement avec une apparence qui sait les montrer. */
export const wantsCancelled = (ctx) => chosenAppearance(ctx) !== DEFAULT_APPEARANCE && normalizeOptions(settingReader(ctx)).cancelled;

const hrefOf = (ctx) => { const b = ctx.instance?.basePath; return b === null || b === undefined ? null : b ? `/${b}` : "/"; };

/**
 * @param surface "page" (page publique) · "upcoming" (section d'accueil, liste des prochains créneaux)
 * @param data    { slots, tz, now?, days? (page), count? (section), override? (apparence du morceau), covers: async () => Map, brand: async () => visuel }
 * @returns blocs de contenu, ou null → rendu historique d'index.mjs
 */
export async function appearanceBlocks(ctx, surface, data) {
  const opts = normalizeOptions(settingReader(ctx), surface === "upcoming" ? data.override : undefined);
  const id = hasAppearance(opts.appearance) ? opts.appearance : DEFAULT_APPEARANCE;
  if (id === DEFAULT_APPEARANCE) return null;
  const slots = Array.isArray(data.slots) ? data.slots : [];
  let covers = new Map();
  if (opts.covers) { try { covers = (await data.covers?.()) ?? new Map(); } catch { covers = new Map(); } }
  const model = buildModel({
    slots, covers, now: data.now ?? new Date(), tz: data.tz, locale: ctx.locale, t: ctx.t, opts, vis: null,
    mode: surface === "page" ? "days" : "list", days: data.days, count: data.count, surface: surface === "page" ? "page" : "section",
    planningHref: hrefOf(ctx), channelUrl: safeHttps(ctx.setting("channelUrl")),
  });
  // Le logo du site (visuel des streams sans jeu) n'est demandé que si un créneau en a besoin.
  if (opts.covers && model.slots.some((s) => !s.allDay && !s.covers.length)) { try { model.vis = (await data.brand?.()) ?? null; } catch { model.vis = null; } }
  return [{ type: "html", html: renderAppearance(id, model, ctx) }];
}

/** Carte « prochain stream » en densité compacte : même carte, espacements resserrés. En confortable (défaut), rien ne change. */
export function densify(ctx, html) {
  if (normalizeOptions(settingReader(ctx)).density !== "compact") return html;
  return `<div class="pa-dense"><style>.pa-dense .cpl-card{gap:.75rem;padding:1rem .75rem .75rem}.pa-dense .cpl-covers img,.pa-dense .cpl-ph:not(.cpl-ph-s){width:4.25rem}.pa-dense .cpl-title{font-size:1.1rem}.pa-dense .cpl-hour{font-size:1.4rem}.pa-dense .cpl-body{gap:.25rem}.pa-dense .cpl-btn{min-height:2.5rem;padding:.4rem .85rem}</style>${html}</div>`;
}

/** Admin : « Choisir l'apparence », un aperçu réel de chaque choix avec des créneaux d'exemple. */
export async function previewBlocks(ctx, tz) {
  const { previewHtml } = await import(`./preview.mjs${V}`);
  const current = chosenAppearance(ctx);
  return [{ type: "heading", text: ctx.t("apTitle") }, { type: "html", html: previewHtml({ t: ctx.t, locale: ctx.locale, tz, theme: ctx.theme, current }) }];
}
