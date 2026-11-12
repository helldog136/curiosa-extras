// Mascot — what goes to the visitors: the script (code + configuration of THIS site, in the language of the page) and the style sheet.
// The script is served at an address that carries the fingerprint of its content (`?v=`): changing a setting changes the address, so the browser can keep it "forever" without ever showing
// an old version. It is announced in the pages (slot `layout.head`) only when the mascot is published AND has something to say.
const v = new URL(import.meta.url).search;
const M = await import(new URL(`./model.mjs${v}`, import.meta.url).href);
const S = await import(new URL(`./store.mjs${v}`, import.meta.url).href);
const F = await import(new URL(`./face.mjs${v}`, import.meta.url).href);
const K = await import(new URL(`./client.mjs${v}`, import.meta.url).href);
const Y = await import(new URL(`./style.mjs${v}`, import.meta.url).href);

/** Must stay equal to `version` of module.json (a test checks it): it is part of the address of the style sheet. */
export const VERSION = "1.2.0";
export const CSS = Y.CSS;
export const cssHash = M.hash(`${VERSION}|${Y.CSS}`);

/** The settings of the core, read and bounded. */
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
 * Everything the pages need, or null when the mascot must not show (draft, no published sentence, "some pages" with no page).
 * → { cfg, hash, code, src }; `src` is the address of the script (relative to the site).
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
