// Twitch raid 2.3: both docks (the ordinary one and the featured picks) wear the look of the administration, without a browser:
// the --cur-* tokens given by ctx.api.adminTheme (dark by default, ?scheme= forces one), a fallback of the same names for an older core,
// NO colour and NO font written in the stylesheet, the same secret addresses, the same security policy. The layout and the gestures run in Chromium: twitch-raid-dock-layout.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { world, logins, en, fr } from "./helpers/twitch-raid-world.mjs";

const def = (await import("../modules/twitch-raid/index.mjs")).default;
const data = await import("../modules/twitch-raid/data.mjs");
const live = await import("../modules/twitch-raid/live.mjs");
const dock = await import("../modules/twitch-raid/dock.mjs");
const moment = await import("../modules/twitch-raid/moment.mjs");

const DIR = new URL("../modules/twitch-raid/", import.meta.url);
const cssOf = (html) => /<style nonce="[^"]+">([\s\S]*?)<\/style>/.exec(html)[1];
const base = (ctx) => `https://site.example.test/m/${ctx.instance.key}`;
const fresh = () => { live.resetLive(); moment.resetMoment?.(); };

async function pages(over = {}, settings = {}) {
  fresh();
  const w = world({ partners: logins(3), live: { [logins(3)[0]]: { viewers: 5 } }, settings, ...over });
  const k = await data.dockSecret(w.ctx), b = base(w.ctx);
  const get = async (route, extra = "") => def.routes[route](new Request(`${b}/${route}?k=${k}${extra}`), w.ctx);
  return { w, k, get };
}

test("look: both docks take the administration's tokens; dark unless ?scheme= says otherwise; the site's own accent is no longer used", async () => {
  const { w, get } = await pages();
  w.ctx.theme = { accent: "#ff0000" };
  for (const route of ["dock", "featured"]) {
    const html = await (await get(route)).text(), light = await (await get(route, "&scheme=light")).text(), odd = await (await get(route, "&scheme=pink")).text();
    assert.ok(cssOf(html).includes("--cur-bg:"), `${route}: the tokens are in the page`);
    assert.ok(!html.toLowerCase().includes("#ff0000") && !html.includes("#9147ff"), `${route}: no private accent`);
    assert.ok(light.includes('<meta name="color-scheme" content="light dark">'));
    assert.match(odd, /<style/);
  }
  assert.deepEqual(w.ctx.calls.adminTheme.map((x) => x.scheme), ["dark", "light", "dark", "dark", "light", "dark"], "dock: dark by default, ?scheme=light forces light, an unknown value gives dark (same for the featured dock)");
  assert.equal(dock.wantsScheme("https://x.test/a?scheme=light"), "light"); assert.equal(dock.wantsScheme("https://x.test/a?scheme=dark"), "dark");
  assert.equal(dock.wantsScheme("https://x.test/a?scheme=pink"), null); assert.equal(dock.wantsScheme("https://x.test/a"), null); assert.equal(dock.wantsScheme("not a url"), null);
});

test("look: the ordinary address shows the featured picks when the owner chose it, in the same look", async () => {
  const { w, get } = await pages({}, { dockMode: "selection" });
  const html = await (await get("dock", "&scheme=light")).text();
  assert.ok(html.includes('id="undo"') && cssOf(html).includes("--cur-bg:"), "the featured page, themed");
  assert.equal(w.ctx.calls.adminTheme.at(-1).scheme, "light");
});

test("look: an older core (no adminTheme) gets the administration's dark palette with the same names; a bad or failing theme never blocks the dock or the style", async () => {
  const { w, get } = await pages();
  delete w.ctx.api.adminTheme;
  for (const route of ["dock", "featured"]) { const res = await get(route); assert.equal(res.status, 200); assert.ok(cssOf(await res.text()).includes("--cur-bg:#15141a"), `${route}: fallback palette`); }
  const bad = await pages(); bad.w.ctx.api.adminTheme = () => ({ css: ":root{--cur-bg:red}</style><script>alert(1)</script>" });
  for (const route of ["dock", "featured"]) { const html = await (await bad.get(route)).text(); assert.ok(!html.includes("<script>alert(1)"), `${route}: the theme text cannot close the style`); }
  const thr = await pages(); thr.w.ctx.api.adminTheme = () => { throw new Error("boom"); };
  for (const route of ["dock", "featured"]) assert.equal((await thr.get(route)).status, 200);
});

test("look: every token the stylesheet uses has a fallback, and the stylesheet writes no colour and no font (only the administration's tokens)", () => {
  const used = new Set([...dock.CSS.matchAll(/var\((--cur-[a-z-]+)\)/g)].map((m) => m[1]));
  assert.ok(used.size >= 12, "the page really uses the tokens");
  for (const t of used) assert.ok(dock.FALLBACK_TOKENS.includes(`${t}:`), `${t} has a fallback`);
  assert.doesNotMatch(dock.CSS, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(|font-family/, "no colour and no font family in the stylesheet");
  assert.doesNotMatch(dock.CSS, /(?<![\w-])(white|black|red|green|blue|gray|grey|orange|yellow|purple|pink|silver|navy|teal)(?![\w-])/i, "no colour name either");
  for (const m of dock.CSS.matchAll(/(?:^|[;{])font:([^;}]+)/g)) assert.match(m[1], /var\(--cur-font\)|inherit/, `font shorthand uses the token: ${m[1]}`);
  // and nowhere else in the page files either: the only literal colours are the fallback's
  for (const f of ["dock.mjs", "featured-dock.mjs"]) {
    const src = fs.readFileSync(new URL(f, DIR), "utf8").split("\n").filter((l) => !l.startsWith("export const FALLBACK_TOKENS")).join("\n");
    assert.doesNotMatch(src.replace(/&#39;|&#\d+;/g, ""), /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![\w-])/, `${f}: no colour literal`);
  }
});

test("look: the denied page wears the look too, with a refusal status and a policy that allows only its own style", async () => {
  const { w, get } = await pages();
  const res = await def.routes.dock(new Request(`${base(w.ctx)}/dock?k=wrong&scheme=light`), w.ctx), html = await res.text();
  assert.equal(res.status, 403);
  assert.ok(cssOf(html).includes("--cur-bg:") && html.includes("var(--cur-bg)") && !html.includes("#0e0e10") && !html.includes("unsafe-inline"));
  assert.ok(html.includes(fr.dock_denied.slice(0, 12)));
  assert.match(res.headers.get("content-security-policy"), /style-src 'nonce-/);
  assert.equal(w.ctx.calls.adminTheme.at(-1).scheme, "light");
  const no = await def.routes.featured(new Request(`${base(w.ctx)}/featured?k=nope`), w.ctx); assert.equal(no.status, 403);
});

test("look: addresses, secret, policy and data are unchanged (docks already set up in OBS keep working)", async () => {
  const { w, k, get } = await pages();
  for (const route of ["dock", "featured"]) {
    const res = await get(route), html = await res.text(), nonce = /<script nonce="([^"]+)"/.exec(html)[1], csp = res.headers.get("content-security-policy");
    assert.ok(csp.includes(`script-src 'nonce-${nonce}'`) && csp.includes(`style-src 'nonce-${nonce}'`) && csp.includes("default-src 'none'") && csp.includes("connect-src 'self'") && csp.includes("frame-ancestors 'self'"));
    assert.ok(html.includes(`<style nonce="${nonce}">`) && !/\son\w+=/.test(html) && !/\sstyle="/.test(html), "no inline handler, no style attribute");
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.ok(html.includes(`/m/${w.ctx.instance.key}/${route === "dock" ? "live" : "featured-data"}?k=${encodeURIComponent(k)}`), "the page reads the same route with the same secret");
    assert.equal((await def.routes[route](new Request(`${base(w.ctx)}/${route}?k=${k}x`), w.ctx)).status, 403);
  }
});

test("look: texts of the new lines exist in English and French with the same variables, in a neutral tone", () => {
  for (const key of ["dock_offline", "dock_confirm", "dock_undo", "fd_again_loss"]) {
    assert.ok(en[key] && fr[key], key);
    assert.deepEqual(en[key].match(/\{\w+\}/g) ?? [], fr[key].match(/\{\w+\}/g) ?? []);
    assert.doesNotMatch(en[key] + fr[key], /!|veuillez/i);
    assert.ok(en[key].length <= 60 && fr[key].length <= 60, `${key}: short`);
  }
  assert.equal(Object.keys(en).length, Object.keys(fr).length);
});

test("look: the page asks for nothing while hidden (Page Visibility) and says it is offline; the featured redraw takes a 3-second Confirm / Undo on the same button (script text)", async () => {
  const { get } = await pages();
  for (const route of ["dock", "featured"]) {
    const html = await (await get(route)).text(), script = /<script nonce="[^"]+">([\s\S]*)<\/script>/.exec(html)[1];
    assert.match(script, /if \(document\.hidden\) return;/, `${route}: no timer while hidden`);
    assert.match(script, /visibilitychange/);
    assert.match(script, /L\.offline/, `${route}: clear offline state`);
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|eval\(/.test(script), "still text only");
  }
  const fd = await (await get("featured")).text();
  assert.match(fd, /setTimeout\(function \(\) \{ disarm\(false\); \}, 3000\)/);
  assert.ok(fd.includes('id="again"') && fd.includes('id="undo" hidden'));
});
