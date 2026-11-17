// The look of the OBS docks: the tokens of the administration (--cur-*), the page headers and the "wrong address" page.
// COPY of the same pieces of twitch-raid/dock.mjs (a module cannot import the code of another one). tests/twitch-events-dock.test.mjs fails if FALLBACK_TOKENS drifts from the original.
import { randomBytes } from "node:crypto";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const FALLBACK_TOKENS = ":root{--cur-bg:#15141a;--cur-fg:#ecebf2;--cur-muted:#9d9bad;--cur-surface:#1e1d26;--cur-line:#2d2b38;--cur-accent:#9b8cff;--cur-accent-fg:#15141a;--cur-ok:#6ee7b7;--cur-ok-fg:#052e1c;--cur-warn:#fcd34d;--cur-warn-fg:#2a2000;--cur-danger:#fca5a5;--cur-danger-fg:#3a0a0a;--cur-focus:#9b8cff;--cur-radius:.5rem;--cur-radius-lg:1rem;--cur-shadow:0 1px 2px #0000000d;--cur-space:.25rem;--cur-font:ui-sans-serif,system-ui,sans-serif;color-scheme:dark}";

/** `?scheme=light` or `?scheme=dark` forces the look; anything else: null (the dock is dark, as OBS expects). */
export const wantsScheme = (url) => { try { const s = new URL(url).searchParams.get("scheme"); return s === "light" || s === "dark" ? s : null; } catch { return null; } };

/** The tokens of the page (fallback first, then the core's theme). A failing or missing theme never blocks the dock. */
export function themeCss(ctx, scheme) {
  let theme = null;
  try { theme = typeof ctx.api?.adminTheme === "function" ? ctx.api.adminTheme({ scheme: scheme ?? "dark" }) : null; } catch { theme = null; }
  const tokens = typeof theme?.css === "string" ? theme.css.replace(/[<>]/g, "") : "";   // the theme text can never close the <style>
  return FALLBACK_TOKENS + tokens;
}
const baseHeaders = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
export const pageHeaders = (nonce) => ({
  ...baseHeaders, "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`,
});
export const jsonHeaders = { ...baseHeaders, "Content-Type": "application/json; charset=utf-8" };

/** The page shown when the address is incomplete or no longer the right one: one plain sentence, in the same look, nothing else. */
export function deniedPage(ctx, text, scheme = null) {
  const nonce = randomBytes(16).toString("base64");
  const html = `<!doctype html><html lang="${esc(ctx.locale || "en")}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="color-scheme" content="light dark"><title>${esc(text)}</title>
<style nonce="${nonce}">${themeCss(ctx, scheme)}\nbody{margin:0;padding:24px 16px;background:var(--cur-bg);color:var(--cur-fg);font:15px/1.4 var(--cur-font)}p{max-width:34em;margin:0 auto}</style></head><body><p>${esc(text)}</p></body></html>`;
  return new Response(html, { status: 403, headers: { ...baseHeaders, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": `default-src 'none'; style-src 'nonce-${nonce}'` } });
}
export { esc };
