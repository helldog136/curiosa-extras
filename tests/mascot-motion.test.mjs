// Mascot 1.2.0: animation (idle and talking), reading time, visibility, voice. The pure rules, the admin forms, and the REAL page of the overlay element run in a fake browser.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import * as K from "./helpers/mascotKit.mjs";
import { runStage } from "./helpers/mascotStageDom.mjs";
import { assertAdminPageErgonomics } from "./helpers/ergonomics.mjs";

const { model: M, store: S, def, get } = K;
const UUID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PIC = (n, ext = "png") => `/uploads/${UUID(n)}.${ext}`;
const SOUND = `/uploads/${UUID(900)}.mp4`;
const T0 = 1_000_000_000_000;   // a multiple of 10 s: the page opens at the very start of a slot

const page = async (ctx, query = "") => {
  const r = await def.routes["element/:slug"](get(`/m/${ctx.instance.key}/element/mascot?lang=${ctx.locale}&ov-demo=1&opt-seconds=10${query ? `&${query}` : ""}`), Object.assign(ctx, { params: { slug: "mascot" } }));
  assert.equal(r.status, 200);
  return { html: await r.text(), headers: r.headers };
};
const linesOf = (html) => JSON.parse(/<script type="application\/json" id="d">([\s\S]*?)<\/script>/.exec(html)[1]);
const frames = (n, from = 1) => Array.from({ length: n }, (_, i) => ({ src: PIC(from + i), bytes: 1000 }));
async function world({ idle, talk, voice, reading, settings = {}, locale = "en" } = {}) {
  const ctx = await K.publishedCtx(settings, { locale, permissions: [...K.manifest.permissions] });
  await S.saveConfig(ctx, { anim: { idle: idle ?? {}, talk: talk ?? {} }, ...(voice ? { voice } : {}), ...(reading ? { reading } : {}) });
  return ctx;
}
const IDLE = { mode: "frames", frames: frames(3, 1), fps: 4 };
const TALK = { mode: "frames", frames: frames(2, 10), fps: 10 };

/* ───────────── pure rules ───────────── */

test("reading time: characters over a speed, plus a start, between a minimum and a maximum, to a tenth of a second", () => {
  assert.equal(M.talkSeconds("", 15, 2, 12), 2, "an empty sentence takes the minimum");
  assert.equal(M.talkSeconds("x".repeat(60), 15, 2, 12), 4.5);
  assert.equal(M.talkSeconds("x".repeat(600), 15, 2, 12), 12, "never above the maximum");
  assert.equal(M.talkSeconds("  a   b  ", 15, 1, 12), 1, "spaces are squeezed");
  assert.equal(M.talkSeconds("😀".repeat(30), 15, 2, 12), 2.5, "an emoji is one character");
  let last = 0;
  for (let n = 0; n <= 200; n += 10) { const s = M.talkSeconds("x".repeat(n), 15, 2, 12); assert.ok(s >= last, "never shorter for a longer sentence"); last = s; }
  assert.ok(M.talkSeconds("x".repeat(100), M.SPEEDS.slow, 2, 30) > M.talkSeconds("x".repeat(100), M.SPEEDS.fast, 2, 30), "slow reads longer than fast");
  assert.equal(M.talkDuration("x".repeat(60), { speed: "normal", min: 2, max: 12 }), 4.5);
  assert.equal(M.talkDuration("x".repeat(60), { speed: "nonsense", min: "x", max: null }).toFixed(1), "4.5", "anything absurd falls back to the defaults");
  assert.deepEqual(M.readingOf({ speed: "fast", min: 9, max: 3 }), { speed: "fast", min: 9, max: 9 }, "the minimum never goes above the maximum");
});

test("blips: one per letter, silence for spaces and marks, the same letter always the same note, inside the time", () => {
  const p = { base: 400, pitch: 0, vary: 0.35, rate: 12, len: 0.07 };
  const plan = M.blipPlan("Hello, you!", 5, p);
  assert.equal(plan.length, 8, "letters only");
  assert.deepEqual(plan, M.blipPlan("Hello, you!", 5, p), "deterministic");
  assert.ok(plan.every((b, i) => i === 0 || b.t > plan[i - 1].t));
  assert.ok(plan[plan.length - 1].t + p.len <= 5 + 1e-9);
  const gap = (a, b) => plan[b].t - plan[a].t;
  assert.ok(gap(4, 5) > gap(0, 1) * 1.5, "the comma is a pause");
  assert.ok(M.blipPlan("a".repeat(500), 2, p).every((b) => b.t + p.len <= 2), "stops with the time it is given");
  const ls = (pitch) => M.blipPlan("abc", 3, { ...p, pitch }).map((b) => b.f);
  assert.ok(ls(5).every((f, i) => f > ls(0)[i]) && ls(-5).every((f, i) => f < ls(0)[i]), "high voice above normal above low voice");
  assert.deepEqual(M.blipPlan("abc", 3, { ...p, vary: 0 }).map((b) => b.s), [0, 0, 0], "no variety: always the natural pitch");
  const wide = M.blipPlan("the quick brown fox", 9, { ...p, pitch: 5, vary: 0.8 }).map((b) => b.s);
  assert.ok(Math.max(...wide) < 12 && Math.min(...wide) > -12, "the range stays inside what a sample can bear");
});

test("animation settings: only uploads of the site, bounded, a mode without content plays nothing", () => {
  const n = M.normalizeAnim({ mode: "frames", gif: "https://elsewhere.example.org/a.gif", frames: [{ src: PIC(1) }, PIC(2), "javascript:x", { src: `/uploads/${UUID(3)}.svg` }, ...Array.from({ length: 40 }, (_, i) => ({ src: PIC(100 + i) }))], fps: 99 });
  assert.equal(n.gif, ""); assert.equal(n.frames.length, M.ANIM.frames); assert.equal(n.fps, 24);
  assert.equal(M.animForPage(M.normalizeAnim({ mode: "gif" })), null, "no picture, nothing to play");
  assert.equal(M.animForPage(M.normalizeAnim({ mode: "frames", frames: [] })), null);
  assert.deepEqual(M.animForPage(M.normalizeAnim({ mode: "gif", gif: PIC(5, "gif") })), { kind: "gif", src: PIC(5, "gif"), fps: 0, once: false });
  assert.equal(M.animForPage(M.normalizeAnim({ mode: "frames", frames: frames(2) })).fps, 8, "default speed");
  assert.equal(M.uploadSound(SOUND), SOUND, "a short video sent with 1.2.x is still read"); assert.equal(M.uploadSound(`/uploads/${UUID(1)}.mp3`), `/uploads/${UUID(1)}.mp3`, "audio files since core 0.10.0"); assert.equal(M.uploadAudio(SOUND), "", "the Voice form stores audio files only"); assert.equal(M.uploadSound(`/uploads/${UUID(1)}.png`), "");
  assert.deepEqual(M.voiceForPage({ mode: "custom" }, "", "en"), { mode: "none" }, "your own sound without a file is silent");
  assert.equal(M.voiceForPage({ mode: "blips", blips: { preset: "custom" } }, SOUND, "en").blips.sample, SOUND);
  assert.equal(M.voiceForPage({ mode: "blips", blips: { preset: "custom" } }, "", "en").blips.sample, undefined, "no file: the soft preset instead");
});

/* ───────────── the page of before stays the page of before ───────────── */

test("non-regression: with no animation, no voice and 'always visible', the page is byte for byte the page of 1.1.1", async () => {
  const ctx = await K.publishedCtx();
  const { html, headers } = await page(ctx);
  assert.ok(!html.includes('id="w"') && !html.includes("mascotPlayer") && !html.includes("talkSeconds"), "no moving code at all");
  assert.ok(!headers.get("content-security-policy").includes("media-src"));
  const sum = crypto.createHash("sha256").update(html.replace(/mc\d+/g, "")).digest("hex").slice(0, 16);
  assert.equal(sum, GOLDEN_PLAIN, "the plain page changed");
});
// Hash of the page produced by the code of 1.1.1 (checked once against origin/master at 1.1.1: identical).
const GOLDEN_PLAIN = "7099e0abc60c859f";

/* ───────────── the real page ───────────── */

test("always visible: idle pictures loop; the talking pictures play for the reading time of the sentence; then idle again; the bubble stays", async () => {
  const ctx = await world({ idle: IDLE, talk: TALK });
  const { html } = await page(ctx);
  const d = linesOf(html), line = d.lines[Math.floor(T0 / 10000) % d.lines.length];
  const expected = M.talkSeconds(line.text, 15, 2, 12);
  const b = runStage(html, { start: T0 });
  await b.flush();
  assert.ok(b.world.preloaded.includes(PIC(1)) && b.world.preloaded.includes(PIC(10)), "every picture is fetched before the loop starts");
  const ai = b.els.ai;
  assert.equal(ai.hidden, false);
  assert.ok(b.els.a.classList.contains("anim") && b.els.a.classList.contains("talk"), "starts talking with the sentence");
  assert.equal(ai.getAttribute("src"), PIC(10), "the talking pictures");
  await b.advance(100);
  assert.equal(ai.getAttribute("src"), PIC(11), "10 pictures per second");
  await b.advance(100);
  assert.equal(ai.getAttribute("src"), PIC(10), "and round again");
  await b.advance(expected * 1000 - 300 - 460);
  assert.ok(b.els.a.classList.contains("talk"), "still talking just before the end");
  await b.advance(900);
  assert.ok(!b.els.a.classList.contains("talk"), "the end of the reading time");
  assert.ok([PIC(1), PIC(2), PIC(3)].includes(ai.getAttribute("src")), "back to the idle pictures");
  assert.ok(b.els.b.on, "in the 'always' mode the sentence stays on screen");
  assert.equal(b.els.w.hidden, false);
  const seen = new Set(); for (let i = 0; i < 12; i++) { await b.advance(250); seen.add(ai.getAttribute("src")); }
  assert.deepEqual([...seen].filter((s) => s !== PIC(10) && s !== PIC(11)).sort(), [PIC(1), PIC(2), PIC(3)], "the idle loop goes through its three pictures, in order");
});

test("a long sentence talks longer than a short one, never longer than its slot", async () => {
  const ctx = await world({ idle: IDLE, talk: TALK, reading: { speed: "slow", min: 1, max: 30 } });
  const { html } = await page(ctx);
  const d = linesOf(html);
  assert.equal(d.x.cps, 10); assert.equal(d.x.max, 30);
  const b = runStage(html, { start: T0 });
  await b.flush();
  await b.advance(9500);
  assert.ok(!b.els.a.classList.contains("talk"), "the slot is 10 s: talking stops before the next sentence");
});

test("only while speaking: hidden when idle, in with the sentence, out when it has been read, hidden until the next one", async () => {
  const ctx = await world({ idle: IDLE, talk: TALK });
  const { html } = await page(ctx, "opt-visibility=speaking");
  assert.match(html, /<div id="w" hidden>/, "nothing to see before it speaks");
  const d = linesOf(html), line = d.lines[0];
  const b = runStage(html, { start: T0 });
  await b.flush();
  assert.equal(b.els.w.hidden, false, "appears with the sentence");
  assert.ok(b.els.w.on);
  const secs = M.talkSeconds(d.lines[Math.floor(T0 / 10000) % d.lines.length].text, 15, 2, 12);
  await b.advance(secs * 1000 - 200);
  assert.equal(b.els.w.hidden, false, "still there while it speaks");
  await b.advance(600);
  assert.equal(b.els.w.hidden, true, "leaves when the sentence has been read");
  assert.ok(!b.els.w.on);
  await b.advance(10_000 - secs * 1000 - 900);
  assert.equal(b.els.w.hidden, true, "stays away until the next slot");
  await b.advance(1000);
  assert.equal(b.els.w.hidden, false, "back with the next sentence");
  void line;
});

test("only while speaking: a page opened late in the slot, after the sentence has been read, stays hidden; two pages agree", async () => {
  const ctx = await world({ idle: IDLE });
  const { html } = await page(ctx, "opt-visibility=speaking");
  const late = runStage(html, { start: T0 + 9500 }); await late.flush();
  assert.equal(late.els.w.hidden, true);
  const mid = runStage(html, { start: T0 + 500 }), start = runStage(html, { start: T0 }); await mid.flush(); await start.flush();
  assert.equal(mid.els.t.textContent, start.els.t.textContent, "the same sentence at the same time");
});

test("no animation given: the talking picture falls back to the plain drawing, and a talking animation alone works without an idle one", async () => {
  const ctx = await world({ talk: TALK });
  const { html } = await page(ctx);
  const b = runStage(html, { start: T0 }); await b.flush();
  assert.equal(b.els.ai.getAttribute("src"), PIC(10));
  await b.advance(9000);
  assert.equal(b.els.ai.hidden, true, "idle: no picture, the drawing is shown again");
  assert.ok(!b.els.a.classList.contains("anim"));
});

test("less motion: the first picture only; an animated GIF cannot be frozen, so the plain drawing is shown", async () => {
  const frames3 = await world({ idle: IDLE });
  const f = runStage((await page(frames3)).html, { start: T0, reducedMotion: true }); await f.flush();
  await f.advance(2000);
  assert.equal(f.els.ai.getAttribute("src"), PIC(1)); assert.deepEqual([...new Set(f.els.ai.log)], [PIC(1)], "never another picture");
  const gif = await world({ idle: { mode: "gif", gif: PIC(7, "gif") } });
  const g = runStage((await page(gif)).html, { start: T0, reducedMotion: true }); await g.flush();
  assert.equal(g.els.ai.hidden, true); assert.ok(!g.els.a.classList.contains("anim"), "the drawing instead");
  const gif2 = runStage((await page(gif)).html, { start: T0 }); await gif2.flush();
  assert.equal(gif2.els.ai.getAttribute("src"), PIC(7, "gif"), "an idle GIF is used as it is, in a loop of its own");
});

test("a talking GIF is restarted by loading it under a new address each time", async () => {
  const ctx = await world({ idle: { mode: "gif", gif: PIC(7, "gif") }, talk: { mode: "gif", gif: PIC(8, "gif") } });
  const b = runStage((await page(ctx)).html, { start: T0 }); await b.flush();
  assert.match(b.els.ai.getAttribute("src"), new RegExp(`${PIC(8, "gif")}\\?mc=1$`));
  await b.advance(10_030 + 700);
  assert.match(b.els.ai.getAttribute("src"), new RegExp(`${PIC(8, "gif")}\\?mc=2$`), "the next sentence restarts it");
});

/* ───────────── the voice ───────────── */

test("blips: one sound per letter while it talks, silenced when the sentence ends", async () => {
  const ctx = await world({ voice: { mode: "blips", volume: 50, blips: { preset: "squeaky", pitch: "high", vary: "none", rate: "fast" } } });
  const { html } = await page(ctx);
  const d = linesOf(html), line = d.lines[Math.floor(T0 / 10000) % d.lines.length];
  const b = runStage(html, { start: T0 }); await b.flush();
  const secs = Math.min(M.talkSeconds(line.text, 15, 2, 12), 9.4);
  const plan = M.blipPlan(line.text, secs, d.x.voice.blips);
  assert.equal(b.world.oscillators.length, plan.length);
  assert.deepEqual(b.world.oscillators.map((o) => o.freq), plan.map((p) => p.f));
  assert.ok(b.world.oscillators.every((o) => o.type === "triangle"));
  assert.ok(b.world.oscillators[0].freq > 880 * 1.2, "a high voice");
  await b.advance(secs * 1000 + 200);
  assert.ok(b.world.oscillators.every((o) => o.stopped), "everything is stopped when the bubble ends");
});

test("voice of the computer: the voice of the language is chosen, with its rate and pitch; none found: blips instead, and it says so", async () => {
  const voice = { mode: "speech", volume: 60, speech: { lang: "fr", name: "", rate: "fast", pitch: "high" } };
  const ctx = await world({ voice });
  const { html } = await page(ctx);
  const voices = [{ name: "Alpha", lang: "en-US", default: true }, { name: "Beta", lang: "fr-FR" }];
  const b = runStage(html, { start: T0, voices }); await b.flush();
  const u = b.world.utterances[0];
  assert.equal(u.voice.name, "Beta"); assert.equal(u.rate, 1.25); assert.equal(u.pitch, 1.3); assert.equal(u.volume, 0.6);
  assert.equal(b.world.oscillators.length, 0, "the computer speaks, no blips");
  await b.advance(12_000); assert.ok(b.world.cancelled > 0, "cancelled when the bubble ends");
  for (const none of [[], null]) {
    const n = runStage(html, { start: T0, voices: none }); await n.flush();
    assert.ok(n.world.oscillators.length > 0, "blips instead");
    assert.equal(n.world.spoken, 0);
  }
  const named = await world({ voice: { mode: "speech", volume: 60, speech: { lang: "", name: "alp", rate: "normal", pitch: "normal" } } });
  const c = runStage((await page(named)).html, { start: T0, voices }); await c.flush();
  assert.equal(c.world.utterances[0].voice.name, "Alpha", "by (part of) the name");
});

test("your own sound: played whole once per sentence, stopped at the end; without a file it stays silent", async () => {
  const ctx = await world({ voice: { mode: "custom", volume: 30 }, settings: { voiceFile: SOUND } });
  const b = runStage((await page(ctx)).html, { start: T0 }); await b.flush();
  assert.equal(b.world.audios.length, 1); assert.equal(b.world.audios[0].src, SOUND); assert.equal(b.world.audios[0].plays, 1); assert.equal(b.world.audios[0].volume, 0.3);
  await b.advance(9_800); assert.equal(b.world.audios[0].paused, true);
  const none = await world({ voice: { mode: "custom", volume: 30 } });
  const { html } = await page(none);
  assert.ok(!html.includes("mascotVoice"), "no file: no voice code");
});

test("your own sound as the blip: decoded once, played once per letter, pitched by the letter, rate kept between 0.5 and 2.5", async () => {
  const ctx = await world({ voice: { mode: "blips", volume: 50, blips: { preset: "custom", pitch: "high", vary: "lots", rate: "normal" } }, settings: { voiceFile: SOUND } });
  const { html } = await page(ctx);
  const d = linesOf(html);
  assert.equal(d.x.voice.blips.sample, SOUND);
  const b = runStage(html, { start: T0, sampleSeconds: 0.5 });
  await b.flush();
  assert.equal(b.world.decoded, 1, "the file is decoded once");
  assert.deepEqual(b.world.fetched, [SOUND]);
  await b.advance(10_030 + 700);       // the second sentence: now the buffer is ready
  assert.equal(b.world.decoded, 1, "and never again");
  const rates = b.world.sources.map((s) => s.playbackRate.value);
  assert.ok(rates.length > 5);
  assert.ok(rates.every((r) => r >= 0.5 && r <= 2.5));
  assert.ok(new Set(rates.map((r) => r.toFixed(3))).size > 3, "the pitch follows the letters");
  assert.ok(rates.reduce((a, r) => a + r, 0) / rates.length > 1, "a high voice");
  assert.ok(b.world.sources.every((s) => s.args[1] === 0 && s.args[2] <= 0.2 + 1e-9), "only the first 0.2 s of the file is used");
  const pitched = (st) => Math.pow(2, st / 12);
  const plan = M.blipPlan(d.lines[1 % d.lines.length].text, 9.4, d.x.voice.blips);
  assert.ok(Math.abs(rates[0] - Math.min(2.5, Math.max(0.5, pitched(plan[0].s)))) < 1e-9, "playbackRate = 2^(semitones/12)");
});

test("autoplay: a browser that waits for a click is woken by the first click", async () => {
  const ctx = await world({ voice: { mode: "blips", volume: 50, blips: { preset: "soft", pitch: "normal", vary: "none", rate: "normal" } } });
  const b = runStage((await page(ctx)).html, { start: T0, audioState: "suspended" }); await b.flush();
  assert.equal(b.world.contexts[0].state, "running", "resumed (OBS and a clicked page start at once)");
});

/* ───────────── the preview of the administration ───────────── */

test("preview panel: the two buttons, the click note, the plain-language state and the reading time", async () => {
  const ctx = await world({ idle: IDLE, talk: TALK, voice: { mode: "speech", volume: 40, speech: { lang: "", name: "", rate: "normal", pitch: "normal" } } });
  const { html, headers } = await page(ctx, "ov-test=1");
  assert.match(html, /id="tp"[^>]*>Play talking animation/); assert.match(html, /id="tv"[^>]*>Test the voice/);
  assert.match(headers.get("content-security-policy"), /media-src 'self'/);
  const b = runStage(html, { start: T0, voices: [] }); await b.flush();
  assert.equal(b.els.tn.textContent, "Click a button to enable sound.");
  b.els.tv.onclick(); await b.flush();
  assert.match(b.els.tn.textContent, /^No voice found on this computer: short sounds are used instead\. \d+ characters, read in [\d.]+ seconds\.$/);
  b.els.tp.onclick(); await b.flush();
  assert.ok(b.els.a.classList.contains("talk"), "the button plays the talking animation");
  const named = runStage(html, { start: T0, voices: [{ name: "Beta", lang: "en-GB", default: true }] }); await named.flush();
  named.els.tv.onclick(); await named.flush();
  assert.match(named.els.tn.textContent, /^Voice of your computer: Beta\./);
  const quiet = await page(await world({ idle: IDLE }), "ov-test=1");
  const q = runStage(quiet.html, { start: T0 }); await q.flush();
  assert.match(q.els.tn.textContent, /^No voice chosen/);
  assert.ok(!(await page(ctx)).html.includes('id="tp"'), "the panel never shows on stream");
});

test("skins: the moving page keeps the shared part names", async () => {
  const { html } = await page(await world({ idle: IDLE }));
  for (const part of ["bubble", "bubble-tail", "name", "text", "avatar"]) assert.ok(html.includes(`data-ov-part="${part}"`), part);
  assert.match(html, /data-ov-region="element"/);
});

test("nothing to say: even with an animation, the frame is empty (draft or no sentence)", async () => {
  const ctx = await K.publishedCtx();
  await S.saveConfig(ctx, { published: false, anim: { idle: IDLE, talk: TALK } });
  const q = new URLSearchParams({ lang: "en", "opt-visibility": "speaking" });
  const r = await def.routes["element/:slug"](get(`/m/${ctx.instance.key}/element/mascot?${q}`), Object.assign(ctx, { params: { slug: "mascot" } }));
  const html = await r.text();
  assert.ok(!html.includes('id="w"') && /id="a"[^>]*\shidden/.test(html), "the plain empty frame");
  assert.equal(html.replace(/<head[\s\S]*?<\/head>|<script[\s\S]*?<\/script>|<[^>]*>/g, "").trim(), "");
});

/* ───────────── the administration ───────────── */

const form = (blocks, action) => blocks.find((b) => b.type === "adminForm" && b.action === action);
const visible = (f) => f.fields.filter((x) => x.kind !== "hidden" && !x.folded).length;
const owned = (n, by = "u1") => ({ url: PIC(n, "gif"), by });
function adminWorld(extra = {}) { return K.publishedCtx({}, { uploads: [], person: { id: "u1" }, permissions: [...K.manifest.permissions], ...extra }); }

test("admin: the Animation and Voice tabs stay inside the field budgets, in both languages, errors included", async () => {
  for (const locale of ["en", "fr"]) {
    const ctx = await K.publishedCtx({}, { locale, permissions: [...K.manifest.permissions] });
    await S.saveConfig(ctx, { anim: { idle: { mode: "frames", frames: frames(4), fps: 0 }, talk: { mode: "gif", gif: PIC(5, "gif") } } });
    for (const mode of ["none", "blips", "speech", "custom"]) {
      await S.saveConfig(ctx, { voice: { mode } });
      const blocks = await def.adminPanel(ctx, { query: {} });
      // The "Look" and "Add a sentence" forms were already over the budget before 1.2.0 (known gap, not touched here).
      assertAdminPageErgonomics(blocks.filter((b) => !["saveLook", "savePhrase"].includes(b.action)), { errors: [ctx.t("errAnFps", { min: 1, max: 24 }), ctx.t("errVolume", { min: 1, max: 100, example: 40 }), ctx.t("errAnHeavy", { size: "4 MB", max: "3 MB" })] });
      for (const b of blocks.filter((x) => x.type === "adminForm" && !["saveLook", "savePhrase"].includes(x.action))) assert.ok(visible(b) <= 5, `${b.action}: ${visible(b)} visible fields`);
      const v = form(blocks, "saveVoice");
      if (mode === "none") assert.equal(v, undefined, "nothing to set for no voice"); else assert.ok(v && visible(v) <= 5);
    }
  }
});

test("admin: each voice mode shows only its own settings", async () => {
  const ctx = await adminWorld();
  const names = async (mode) => { await S.saveConfig(ctx, { voice: { mode } }); return form(await def.adminPanel(ctx, { query: {} }), "saveVoice")?.fields.filter((f) => f.kind !== "hidden").map((f) => f.name); };
  assert.deepEqual(await names("blips"), ["preset", "pitch", "rate", "volume", "vary"]);
  assert.deepEqual(await names("speech"), ["lang", "srate", "spitch", "volume", "vname"]);
  assert.deepEqual(await names("custom"), ["sound", "volume"]);
  assert.equal(await names("none"), undefined);
  const blocks = await def.adminPanel(ctx, { query: {} });
  assert.equal(form(blocks, "saveVoiceMode").fields[0].options.length, 4, "four big choices");
  assert.equal(form(blocks, "saveVoiceMode").fields[0].kind, "segmented");
  const html = blocks.filter((b) => b.type === "html" && b.html.includes("<iframe"));
  assert.equal(html.length, 2, "the live preview on both tabs");
  assert.match(html[0].html, /ov-demo=1&amp;ov-test=1/);
});

test("admin: the animated picture is kept (size known), refused when too heavy, from another site or not sent by this person", async () => {
  const ctx = await adminWorld({ uploads: [{ url: PIC(1, "gif"), by: "u1", bytes: 400_000 }, { url: PIC(2, "gif"), by: "u1", bytes: 5_000_000 }, { url: PIC(3, "gif"), by: "someone-else", bytes: 1000 }] });
  const run = (v) => def.adminActions.saveAnim.run(ctx, v);
  assert.deepEqual((await run({ which: "idle", mode: "gif", gif: "https://elsewhere.example.org/a.gif" })).errors, { gif: ctx.t("errAnGifBad") });
  assert.deepEqual((await run({ which: "idle", mode: "gif", gif: "" })).errors, { gif: ctx.t("errAnGifEmpty") });
  assert.match((await run({ which: "idle", mode: "gif", gif: PIC(2, "gif") })).errors.gif, /4\.8 MB.*3\.0 MB/);
  assert.equal((await run({ which: "idle", mode: "gif", gif: PIC(3, "gif") })).errors.gif, ctx.t("anClaim_not-uploader"));
  assert.equal((await run({ which: "idle", mode: "gif", gif: PIC(9, "gif") })).errors.gif, ctx.t("anClaim_unknown"));
  assert.match((await run({ which: "idle", mode: "frames", fps: "99" })).errors.fps, /1.*24/);
  assert.equal((await S.loadConfig(ctx)).anim.idle.mode, "none", "nothing saved on an error");
  assert.ok((await run({ which: "idle", mode: "gif", gif: PIC(1, "gif"), fps: "12" })).ok);
  const a = (await S.loadConfig(ctx)).anim.idle;
  assert.deepEqual([a.mode, a.gif, a.gifBytes, a.fps], ["gif", PIC(1, "gif"), 400_000, 12]);
});

test("admin: pictures are added one at a time, in order, moved up and down, removed (the file is let go), within the budgets", async () => {
  const ups = Array.from({ length: 27 }, (_, i) => ({ url: PIC(i + 1), by: "u1", bytes: 100_000 }));
  const ctx = await adminWorld({ uploads: ups });
  await def.adminActions.saveAnim.run(ctx, { which: "idle", mode: "frames" });
  const add = (n) => def.adminActions.addFrame.run(ctx, { which: "idle", image: PIC(n) });
  for (let n = 1; n <= 3; n++) assert.ok((await add(n)).ok);
  assert.equal((await add(2)).errors.image, ctx.t("errAnDuplicate"));
  assert.equal((await def.adminActions.addFrame.run(ctx, { which: "idle", image: "https://x.example.org/a.png" })).errors.image, ctx.t("errAnGifBad"));
  const order = async () => (await S.loadConfig(ctx)).anim.idle.frames.map((f) => f.src);
  assert.deepEqual(await order(), [PIC(1), PIC(2), PIC(3)]);
  await def.adminActions.frameUp.run(ctx, { id: `idle|${PIC(3)}` });
  await def.adminActions.frameDown.run(ctx, { id: `idle|${PIC(1)}` });
  assert.deepEqual(await order(), [PIC(3), PIC(1), PIC(2)]);
  assert.equal((await def.adminActions.frameUp.run(ctx, { id: `idle|${PIC(3)}` })).ok, ctx.t("anAlreadyFirst"));
  assert.equal((await def.adminActions.frameUp.run(ctx, { id: `idle|${PIC(26)}` })).error, ctx.t("errGone"), "an old page never moves another picture");
  const table = (await def.adminPanel(ctx, { query: {} })).find((b) => b.type === "table" && b.rowActions?.some((x) => x.action === "frameUp"));
  assert.equal(table.searchable, true); assert.equal(table.rowActions.filter((x) => !x.danger).length, 2, "two visible actions: up and down, the removal in the menu");
  assert.ok(table.rows[0][0].image.alt, "every thumbnail has a text");
  assert.ok((await def.adminActions.frameRemove.run(ctx, { id: `idle|${PIC(2)}` })).ok);
  assert.deepEqual(await order(), [PIC(3), PIC(1)]);
  assert.ok(ctx.calls.files.some((c) => c.op === "remove" && c.url === PIC(2)), "the file is deleted from the site");
  for (let n = 4; n <= 25; n++) assert.ok((await add(n)).ok, `picture ${n}`);
  assert.equal((await add(26)).errors.image, ctx.t("anFull", { max: 24 }), "24 at most");
  assert.ok((await def.adminPanel(ctx, { query: {} })).some((b) => b.type === "banner" && b.text === ctx.t("anFull", { max: 24 })));
});

test("admin: the size budget of one animation is checked when a picture is added", async () => {
  const ctx = await adminWorld({ uploads: [{ url: PIC(1), by: "u1", bytes: 2_000_000 }, { url: PIC(2), by: "u1", bytes: 1_500_000 }] });
  await def.adminActions.saveAnim.run(ctx, { which: "talk", mode: "frames" });
  assert.ok((await def.adminActions.addFrame.run(ctx, { which: "talk", image: PIC(1) })).ok);
  assert.match((await def.adminActions.addFrame.run(ctx, { which: "talk", image: PIC(2) })).errors.image, /3\.3 MB.*3\.0 MB/);
});

test("admin: reading speed and voice are checked, with the example under the field; nothing is saved on an error", async () => {
  const ctx = await adminWorld();
  assert.equal((await def.adminActions.saveReading.run(ctx, { speed: "fast", min: "0", max: "" })).errors.min, ctx.t("errRdNumber", { min: 1, max: 10, example: 2 }));
  assert.ok((await def.adminActions.saveReading.run(ctx, { speed: "fast", min: "", max: "" })).ok);
  assert.deepEqual((await S.loadConfig(ctx)).reading, { speed: "fast", min: 2, max: 12 });
  assert.ok((await def.adminActions.saveReading.run(ctx, { speed: "slow", min: "5", max: "3" })).errors.max);
  await def.adminActions.saveVoiceMode.run(ctx, { mode: "blips" });
  assert.equal((await def.adminActions.saveVoice.run(ctx, { volume: "500" })).errors.volume, ctx.t("errVolume", { min: 1, max: 100, example: 40 }));
  assert.ok((await def.adminActions.saveVoice.run(ctx, { preset: "robotic", pitch: "low", rate: "slow", vary: "lots", volume: "" })).ok);
  assert.deepEqual((await S.loadConfig(ctx)).voice.blips, { preset: "robotic", pitch: "low", rate: "slow", vary: "lots" });
  assert.equal((await S.loadConfig(ctx)).voice.volume, 40, "empty = the default");
  assert.equal((await def.adminActions.saveVoice.run(ctx, { preset: "nonsense" })).errors.preset, ctx.t("errChoice"));
  await def.adminActions.saveVoiceMode.run(ctx, { mode: "speech" });
  assert.ok((await def.adminActions.saveVoice.run(ctx, { lang: "fr", srate: "fast", spitch: "high", vname: "Google français", volume: "70" })).ok);
  assert.deepEqual((await S.loadConfig(ctx)).voice.speech, { lang: "fr", name: "Google français", rate: "fast", pitch: "high" });
  assert.ok((await def.adminActions.saveVoice.run(ctx, { lang: "xx" })).errors.lang);
  const example = (await def.adminPanel(ctx, { query: {} })).find((b) => b.type === "markdown" && /2 s ·/.test(b.text));
  assert.match(example.text, /20 caractères : 2 s · 60 caractères : 3\.2 s/);
});

test("admin: people without the right to edit see the previews and no form", async () => {
  const ctx = await K.publishedCtx({}, { rights: [] });
  const blocks = await def.adminPanel(ctx, { query: {} });
  assert.ok(!blocks.some((b) => b.type === "adminForm"));
  for (const action of Object.keys(def.adminActions).filter((a) => /Anim|Frame|Reading|Voice/.test(a))) assert.equal(def.adminActions[action].right, "edit", action);
});

/* ───────────── assistants ───────────── */

test("assistants: read the animation settings; change speed and voice (never pictures); wrong values are refused in plain words", async () => {
  const ctx = await K.publishedCtx();
  const got = await def.mcp.mascot_animation_get(ctx);
  assert.deepEqual([got.idle.mode, got.talking.mode, got.voice.mode, got.reading.speed], ["none", "none", "none", "normal"]);
  assert.equal(got.reading.examples.length, 3);
  assert.deepEqual(await def.mcp.mascot_animation_update(ctx, { readingSpeed: "slow", talkMaxSeconds: 20, voiceMode: "blips", blipsPreset: "deep", volume: 25 }), { ok: true });
  const c = await S.loadConfig(ctx);
  assert.deepEqual([c.reading.speed, c.reading.max, c.voice.mode, c.voice.blips.preset, c.voice.volume], ["slow", 20, "blips", "deep", 25]);
  for (const bad of [{ readingSpeed: "warp" }, { volume: 0 }, { talkMinSeconds: 11 }, { voiceMode: "custom" }, { blipsPreset: "custom" }, { speechLanguage: "xx" }, { talkMinSeconds: 9, talkMaxSeconds: 4 }]) {
    await assert.rejects(def.mcp.mascot_animation_update(ctx, bad), (e) => e.expose === true && /:/.test(e.message), JSON.stringify(bad));
  }
  assert.equal((await S.loadConfig(ctx)).voice.volume, 25, "a refusal changes nothing");
  const m = K.manifest.mcp;
  assert.equal(m.find((t) => t.name === "mascot_animation_get").readOnly, true);
  assert.ok(!m.find((t) => t.name === "mascot_animation_update").readOnly, "the write tool is not read-only, so the core keeps it off until granted");
  assert.ok(K.manifest.i18n.fr["mcp.mascot_animation_update"] && K.manifest.i18n.fr["mcp.mascot_animation_get"]);
});

/* ───────────── core 0.10.0: audio files ───────────── */

const SND = (n, ext = "mp3") => `/uploads/${UUID(800 + n)}.${ext}`;

test("audio: the sound is sent in the Voice form (kind audio), kept with its size, only audio files, 4 MB at most; replacing or removing lets the old file go", async () => {
  const ctx = await adminWorld({ uploads: [{ url: SND(1), by: "u1", bytes: 80_000 }, { url: SND(2, "ogg"), by: "u1", bytes: 60_000 }, { url: SND(3), by: "u1", bytes: 6_000_000 }, { url: SND(4, "mp4"), by: "u1", bytes: 1000 }] });
  await def.adminActions.saveVoiceMode.run(ctx, { mode: "custom" });
  const field = () => def.adminPanel(ctx, { query: {} }).then((b) => b.find((x) => x.action === "saveVoice").fields.find((f) => f.name === "sound"));
  assert.equal((await field()).kind, "audio", "native audio control of the core");
  const run = (v) => def.adminActions.saveVoice.run(ctx, { volume: "", ...v });
  assert.equal((await run({ sound: "https://elsewhere.example.org/a.mp3" })).errors.sound, ctx.t("errVoSound"));
  assert.equal((await run({ sound: SND(4, "mp4") })).errors.sound, ctx.t("errVoSound"), "a video is not what the form stores");
  assert.equal((await run({ sound: `/uploads/${UUID(1)}.png` })).errors.sound, ctx.t("errVoSound"));
  assert.match((await run({ sound: SND(3) })).errors.sound, /5\.7 MB.*4\.0 MB/);
  assert.equal((await run({ sound: SND(9) })).errors.sound, ctx.t("anClaim_unknown"));
  assert.equal((await S.loadConfig(ctx)).voice.file, "", "nothing saved on an error");
  assert.ok((await run({ sound: SND(1) })).ok);
  assert.deepEqual([(await S.loadConfig(ctx)).voice.file, (await S.loadConfig(ctx)).voice.fileBytes], [SND(1), 80_000]);
  assert.ok((await run({ sound: SND(2, "ogg") })).ok);
  assert.ok(ctx.calls.files.some((c) => c.op === "remove" && c.url === SND(1)), "the replaced file is deleted from the site");
  assert.ok((await run({ sound: "" })).ok);
  assert.ok(ctx.calls.files.some((c) => c.op === "remove" && c.url === SND(2, "ogg")));
  assert.equal((await S.loadConfig(ctx)).voice.file, "");
});

test("audio: the page plays the file of the Voice form (whole, or as the pitched blip); the older setting is still read; the form field shows only where it is used", async () => {
  const whole = await world({ voice: { mode: "custom", volume: 30, file: SND(1) } });
  const w = linesOf((await page(whole)).html);
  assert.equal(w.x.voice.custom, SND(1));
  const blip = await world({ voice: { mode: "blips", volume: 30, file: SND(2, "ogg"), blips: { preset: "custom", pitch: "normal", vary: "some", rate: "normal" } } });
  assert.equal(linesOf((await page(blip)).html).x.voice.blips.sample, SND(2, "ogg"));
  const legacy = await world({ voice: { mode: "custom", volume: 30 }, settings: { voiceFile: SOUND } });
  assert.equal(linesOf((await page(legacy)).html).x.voice.custom, SOUND, "a 1.2.x configuration keeps working with no conversion");
  const both = await world({ voice: { mode: "custom", volume: 30, file: SND(1) }, settings: { voiceFile: SOUND } });
  assert.equal(linesOf((await page(both)).html).x.voice.custom, SND(1), "the new one wins");
  const names = async (c) => (await def.adminPanel(c, { query: {} })).find((b) => b.action === "saveVoice").fields.filter((f) => f.kind !== "hidden").map((f) => f.name);
  assert.ok((await names(blip)).includes("sound"), "blips set to your own sound: the file is asked for here");
  const soft = await world({ voice: { mode: "blips", volume: 30, blips: { preset: "soft", pitch: "normal", vary: "some", rate: "normal" } } });
  assert.ok(!(await names(soft)).includes("sound"), "with a built-in blip the file is not asked for");
  const vis = (f) => f.fields.filter((x) => x.kind !== "hidden" && !x.folded).length;
  assert.ok(vis((await def.adminPanel(blip, { query: {} })).find((b) => b.action === "saveVoice")) <= 5);
  assert.ok(vis((await def.adminPanel(whole, { query: {} })).find((b) => b.action === "saveVoice")) <= 5);
});

test("audio: assistants see the file in use and can pick your own sound only when one was sent", async () => {
  const ctx = await K.publishedCtx({}, { permissions: [...K.manifest.permissions] });
  await assert.rejects(def.mcp.mascot_animation_update(ctx, { voiceMode: "custom" }), (e) => /Voice/.test(e.message) && !/More options/.test(e.message));
  await S.saveConfig(ctx, { voice: { mode: "none", file: SND(1), fileBytes: 10 } });
  assert.equal((await def.mcp.mascot_animation_get(ctx)).voice.ownSoundChosen, true);
  assert.deepEqual(await def.mcp.mascot_animation_update(ctx, { voiceMode: "custom", blipsPreset: "custom" }), { ok: true });
  assert.equal(K.manifest.settings.find((s) => s.key === "voiceFile").type, "audio");
  assert.equal(K.manifest.minCore, "0.10.0");
});
