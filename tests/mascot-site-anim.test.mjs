// Mascot 1.3.0: the animation (idle and talking) of the mascot in the CORNER OF THE SITE. The visitor script is tried in the fake browser of the other mascot tests, plus a small MutationObserver.
// Silent (no sound on the pages of a site), lazy (nothing is fetched before the mascot shows), no layout shift (the picture lies over the avatar), less motion, hidden tab, and nothing changes when no animation is set.
import test from "node:test";
import assert from "node:assert/strict";
import { def, model as M, store as S, assets as A, publishedCtx, manifest, get } from "./helpers/mascotKit.mjs";
import { makeBrowser } from "./helpers/mascotDom.mjs";
import { assertAdminPageErgonomics } from "./helpers/ergonomics.mjs";

const UUID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PIC = (n, ext = "png") => `/uploads/${UUID(n)}.${ext}`;
const frames = (n, from) => Array.from({ length: n }, (_, i) => ({ src: PIC(from + i), bytes: 1000 }));
const IDLE = { mode: "frames", frames: frames(3, 1), fps: 4 };
const TALK = { mode: "frames", frames: frames(2, 10), fps: 10 };
const LINES = [{ id: "p1", kind: "hello", text: "Hi" }, { id: "p2", kind: "tip", text: "A much longer tip, to be read for a few seconds before the mascot leaves." }];
const S1 = 1000;

/** The fake browser of the other tests + a MutationObserver that is told when a child is added, removed or when `innerHTML` is written. */
function browser(opts = {}) {
  const env = makeBrowser({ lines: LINES, ...opts });
  const proto = Object.getPrototypeOf(env.body), observers = new Set(), preloaded = [];
  const notify = (node) => { for (const o of [...observers]) if (o.target === node) Promise.resolve().then(() => observers.has(o) && o.cb([])); };
  for (const m of ["appendChild", "insertBefore", "removeChild"]) { const orig = proto[m]; proto[m] = function (...a) { const r = orig.apply(this, a); notify(this); return r; }; }
  Object.defineProperty(proto, "innerHTML", { configurable: true, get() { return this._ih ?? ""; }, set(v) { this._ih = v; for (const c of this.children) c.parentNode = null; this.children = []; notify(this); } });
  const setAttr = proto.setAttribute; proto.setAttribute = function (k, v) { setAttr.call(this, k, v); if (k === "src") (this.log ??= []).push(String(v)); };
  class MO { constructor(cb) { this.cb = cb; } observe(t) { this.target = t; observers.add(this); } disconnect() { observers.delete(this); } }
  class Img { set src(v) { preloaded.push(v); } }
  if (opts.observer !== false) { env.sandbox.MutationObserver = MO; env.window.MutationObserver = MO; }
  env.sandbox.Image = Img;
  env.preloaded = preloaded; env.observers = observers;
  return env;
}
async function world(anim, extra = {}) {
  const ctx = await publishedCtx({}, { locale: "en", permissions: [...manifest.permissions] });
  await S.saveConfig(ctx, { anim: { idle: anim.idle ?? {}, talk: anim.talk ?? {} }, ...extra });
  return ctx;
}
const boot = async (anim, browserOpts = {}, extra = {}) => {
  const ctx = await world(anim, extra);
  const built = await A.buildClient(ctx);
  const env = browser(browserOpts).load(built.code);
  return { ctx, built, env };
};
const picture = (env) => env.body.querySelector(".mc-an");

test("nothing set: the script, its configuration and the address of the style sheet are those of before; the plain style sheet has no animation rule", async () => {
  const ctx = await publishedCtx({}, { locale: "en" });
  const built = await A.buildClient(ctx);
  assert.ok(!built.code.includes("mascotSiteAnim") && !built.code.includes("MutationObserver"));
  assert.match(built.cfg.c, /\/mascot\.css\?v=[0-9a-f]{8}$/);
  const css = await (await def.routes["mascot.css"](get(built.cfg.c), ctx)).text();
  assert.equal(css, A.CSS); assert.ok(!css.includes(".mc-an"));
  const animOnly = await world({ talk: { mode: "frames", frames: [] } });   // a mode with no picture plays nothing: still the plain script
  assert.ok(!(await A.buildClient(animOnly)).code.includes("mascotSiteAnim"));
});

test("an animation set: the same animations as the overlay are appended to the script, with their own style sheet address", async () => {
  const ctx = await world({ idle: IDLE, talk: TALK }, { reading: { speed: "slow", min: 3, max: 9 } });
  const built = await A.buildClient(ctx);
  assert.ok(built.code.includes("mascotSiteAnim") && built.code.includes("talkSeconds") && built.code.includes("mascotPlayer"));
  assert.match(built.cfg.c, /\/mascot\.css\?v=[0-9a-f]{8}&a=1$/);
  const spec = JSON.parse(/\)\((\{"idle":[\s\S]*?\}),function talkSeconds/.exec(built.code)[1]);
  assert.deepEqual([spec.idle.kind, spec.idle.fps, spec.talk.fps, spec.cps, spec.min, spec.max], ["frames", 4, 10, 10, 3, 9]);
  const r = await def.routes["mascot.css"](get(built.cfg.c), ctx);
  const css = await r.text();
  assert.ok(css.startsWith(A.CSS) && css.includes(".mc-an{position:absolute;inset:0"), "the plain rules and the animation rules");
  assert.equal(r.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal((await def.routes["mascot.css"](get(`/m/x/mascot.css?v=old&a=1`), ctx)).headers.get("cache-control"), "no-cache");
  assert.equal(await (await def.routes["mascot.css"](get(`/m/x/mascot.css?v=${A.cssHash}`), ctx)).text(), A.CSS, "the plain address still gives the plain sheet");
  assert.ok(A.animCssHash !== A.cssHash);
});

test("lazy and without layout shift: nothing is fetched before the mascot shows; then the picture lies over the avatar, the drawing stays underneath", async () => {
  const { env } = await boot({ idle: IDLE, talk: TALK });
  await env.advance(7 * S1);
  assert.deepEqual(env.preloaded, [], "no picture before the mascot appears");
  assert.equal(env.root(), null);
  await env.advance(1.2 * S1);
  const root = env.root(), av = root.querySelector(".mc-av"), img = picture(env);
  assert.ok(root.has("mc-anim") && img && img.parentNode === av, "the animated picture is in the avatar");
  assert.ok(env.preloaded.includes(PIC(1)) && env.preloaded.includes(PIC(10)), "idle and talking pictures are fetched when it shows");
  assert.ok(av.children.includes(img) && av._ih !== undefined, "the drawing of the avatar is still there under it (only hidden by the style)");
  assert.equal(img.getAttribute("alt"), ""); assert.equal(img.getAttribute("aria-hidden"), "true");
});

test("idle then talking then idle: the talking pictures play for the reading time of the bubble, then the idle ones come back", async () => {
  const { env, built } = await boot({ idle: IDLE, talk: TALK });
  await env.advance(8.3 * S1);
  const bubble = env.bubbleText(), img = picture(env);
  assert.equal(bubble, "Hi");
  const talkFor = M.talkDuration(bubble, { speed: "normal", min: 2, max: 12 });
  assert.equal(talkFor, 2);
  assert.ok([PIC(10), PIC(11)].includes(img.getAttribute("src")), "the talking animation starts with the bubble");
  assert.ok(img.log.includes(PIC(10)) || img.log.includes(PIC(11)));
  await env.advance(300);
  assert.ok(new Set(img.log).has(PIC(10)) && new Set(img.log).has(PIC(11)), "10 pictures a second: both talking pictures were shown");
  await env.advance(talkFor * S1);
  assert.ok([PIC(1), PIC(2), PIC(3)].includes(img.getAttribute("src")), "idle again when the sentence has been read");
  assert.ok(env.bubble(), "the bubble stays for its own duration: the animation does not close it");
  await env.advance(4.5 * S1);
  assert.ok(new Set(img.log).has(PIC(2)) || new Set(img.log).has(PIC(3)), "the idle loop goes on");
  void built;
});

test("the avatar is rewritten when the mood changes: the picture is put back, never lost", async () => {
  const { env } = await boot({ idle: IDLE });
  await env.advance(8.3 * S1);
  const av = env.root().querySelector(".mc-av"), img = picture(env);
  av.innerHTML = "<svg/>"; await env.advance(10);
  assert.equal(picture(env), img, "same picture, put back");
  assert.ok(av.children.includes(img));
});

test("silent: no sound API is used on the pages of the site, whatever voice is chosen for the overlay", async () => {
  const { built } = await boot({ idle: IDLE, talk: TALK }, {}, { voice: { mode: "blips", volume: 80 } });
  for (const word of ["AudioContext", "speechSynthesis", "SpeechSynthesisUtterance", "new Audio", "mascotVoice"]) assert.ok(!built.code.includes(word), word);
});

test("less motion: the first picture only; a GIF cannot be frozen, so the drawing stays", async () => {
  const frames_ = await boot({ idle: IDLE, talk: TALK }, { reduced: true });
  await frames_.env.advance(8.3 * S1);
  const img = picture(frames_.env);
  await frames_.env.advance(3 * S1);
  assert.deepEqual([...new Set(img.log)], [PIC(1)], "never another picture, not even the talking ones");
  const gif = await boot({ idle: { mode: "gif", gif: PIC(7, "gif") } }, { reduced: true });
  await gif.env.advance(8.3 * S1);
  assert.ok(!gif.env.root().has("mc-anim") && picture(gif.env).hidden === true, "the drawing is shown");
  const moving = await boot({ idle: { mode: "gif", gif: PIC(7, "gif") } });
  await moving.env.advance(8.3 * S1);
  assert.equal(picture(moving.env).getAttribute("src"), PIC(7, "gif"), "an idle GIF is used as it is");
});

test("a talking GIF is restarted under a new address with each bubble; without a talking animation the idle one just goes on", async () => {
  const { env } = await boot({ idle: { mode: "gif", gif: PIC(7, "gif") }, talk: { mode: "gif", gif: PIC(8, "gif") } });
  await env.advance(8.3 * S1);
  assert.match(picture(env).getAttribute("src"), new RegExp(`${PIC(8, "gif")}\\?mc=1$`));
  await env.advance(3 * S1);
  assert.equal(picture(env).getAttribute("src"), PIC(7, "gif"));
  const idleOnly = await boot({ idle: IDLE });
  await idleOnly.env.advance(8.3 * S1);
  const img = picture(idleOnly.env), seen = new Set(img.log);
  assert.ok([...seen].every((s) => [PIC(1), PIC(2), PIC(3)].includes(s)), "idle pictures only, the bubble does not restart them");
});

test("a hidden tab stops the pictures and the visible tab starts them again", async () => {
  const { env } = await boot({ idle: IDLE });
  await env.advance(8.3 * S1);
  const img = picture(env);
  await env.advance(S1);
  env.visibility(true);
  const n = img.log.length;
  await env.advance(3 * S1);
  assert.equal(img.log.length, n, "nothing changes while the tab is hidden");
  env.visibility(false);
  await env.advance(S1);
  assert.ok(img.log.length > n, "moving again");
});

test("when the mascot leaves, the observers stop and the script waits for the next appearance; with no MutationObserver nothing breaks", async () => {
  const { env } = await boot({ idle: IDLE, talk: TALK });
  await env.advance(8.3 * S1);
  assert.ok(env.observers.size >= 3);
  await env.advance(40 * S1);
  assert.equal(env.root(), null);
  assert.equal(env.observers.size, 1, "only the watch of the page remains");
  const none = await boot({ idle: IDLE }, { observer: false });
  await none.env.advance(9 * S1);
  assert.ok(none.env.root() && none.env.bubble(), "the mascot works as before, only without the animation");
  assert.equal(picture(none.env), null);
});

test("administration: the preview of the corner shows the first picture, the Animation tab links to the site; nothing added without an animation", async () => {
  const none = await publishedCtx({}, { locale: "en", permissions: [...manifest.permissions] });
  const plain = await def.adminPanel(none, { query: {} });
  assert.ok(!JSON.stringify(plain).includes("previewAnim") && !plain.some((b) => b.type === "links" && b.tab === "animation"));
  const ctx = await world({ idle: IDLE });
  const blocks = await def.adminPanel(ctx, { query: {} });
  const html = blocks.find((b) => b.type === "html" && b.html.includes("mcp-stage"));
  assert.ok(html.html.includes(PIC(1)) && html.html.includes("Animation (first picture)"));
  const link = blocks.find((b) => b.type === "links" && b.tab === "animation");
  assert.deepEqual(link.items.map((i) => i.href), ["/?mascot=voir"]);
  assertAdminPageErgonomics(blocks.filter((b) => !["saveLook", "savePhrase"].includes(b.action)));
  const fr = await def.adminPanel(Object.assign(await world({ idle: IDLE }, {}), {}), { query: {} });
  assert.ok(fr.length > 0);
});
