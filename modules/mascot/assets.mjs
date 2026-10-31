// Mascotte — ce qui part vers les visiteurs : le script (code + configuration de CE site, dans la langue de la page) et la feuille de style.
// Le script est servi à une adresse qui porte l'empreinte de son contenu (`?v=`) : changer un réglage change l'adresse, donc le navigateur peut le garder « pour toujours » sans jamais montrer
// une ancienne version. Il n'est annoncé dans les pages (emplacement `layout.head`) que si la mascotte est publiée ET a de quoi parler.
const v = new URL(import.meta.url).search;
const M = await import(new URL(`./model.mjs${v}`, import.meta.url).href);
const S = await import(new URL(`./store.mjs${v}`, import.meta.url).href);
const F = await import(new URL(`./face.mjs${v}`, import.meta.url).href);
const K = await import(new URL(`./client.mjs${v}`, import.meta.url).href);
const Y = await import(new URL(`./style.mjs${v}`, import.meta.url).href);

/** Doit rester égale à `version` de module.json (un test le vérifie) : elle fait partie de l'adresse de la feuille de style. */
export const VERSION = "1.1.0";
export const CSS = Y.CSS;
export const cssHash = M.hash(`${VERSION}|${Y.CSS}`);

/** Les réglages du cœur, lus et bornés. */
export function readSettings(ctx) {
  const where = ["all", "home", "some"].includes(ctx.setting("where")) ? ctx.setting("where") : "all";
  return {
    where,
    pages: M.parsePages(ctx.setting("pages")).list,
    corner: ctx.setting("corner") === "left" ? "l" : "r",
    delay: M.num(ctx.setting("delay"), M.RANGES.delay),
    show: M.num(ctx.setting("show"), M.RANGES.show),
    max: M.num(ctx.setting("max"), M.RANGES.max),
    announce: ctx.setting("announce") !== false,
    footerLink: ctx.setting("footerLink") === true,
  };
}

/**
 * Tout ce dont les pages ont besoin, ou null quand la mascotte ne doit pas se montrer (brouillon, aucune phrase publiée, « certaines pages » sans page).
 * → { cfg, hash, code, src } ; `src` est l'adresse du script (relative au site).
 */
export async function buildClient(ctx) {
  const [config, phrases] = [await S.loadConfig(ctx), await S.loadPhrases(ctx)];
  const set = readSettings(ctx);
  if (!config.published || !phrases.some((p) => p.state === "published") || (set.where === "some" && !set.pages.length)) return null;
  const name = S.nameFor(ctx, config);
  const alt = S.altFor(ctx, config);
  const image = config.look === "image" && config.image && alt ? config.image : "";
  const key = ctx.instance.key;
  const cfg = {
    k: key, l: ctx.locale, b: `/m/${key}`, c: `/m/${key}/mascot.css?v=${cssHash}`,
    p: set.corner, w: set.where, g: set.pages, d: set.delay, s: set.show, m: set.max, n: name,
    i: image ? { s: image, a: alt, r: config.crop !== "square" } : null,
    u: { x: ctx.t("uiClose"), p: ctx.t("uiReduce"), u: ctx.t("uiNormal"), m: ctx.t("uiMute"), g: ctx.t("uiGo"), o: ctx.t("uiOpen", { name }) },
  };
  const code = `(${K.mascotClient.toString()})(${JSON.stringify(cfg)},${F.drawFace.toString()},${M.pathMatches.toString()});\n`;
  const hash = M.hash(`${VERSION}|${code}`);
  return { cfg, hash, code, src: `/m/${key}/mascot.js?lang=${encodeURIComponent(ctx.locale)}&v=${hash}` };
}
