// TV type scale (core 0.11.0, `tvScale`): the "Sponsors" element keeps every text at 24 px of canvas or more, is never scaled down to fit (it drops its least useful lines instead), and still works without `ov-tv`.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { tvSuite, wrapOverlay } from "./helpers/tvLegibility.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const ROOT = process.env.CURIOSA_EXTRAS_DIR ?? path.join(here, "..");
const en = JSON.parse(fs.readFileSync(path.join(ROOT, "modules/sponsor-ticker/locales/en.json"), "utf8"));
const tk = (await import("../modules/sponsor-ticker/index.mjs")).default;

const CARDS = {
  rich: [{ id: "a", name: "Etoile Nord Outdoor and Camping Supplies", text: "A long sentence about what the sponsor does and why their discount is worth a look, written to need two lines at least.", url: "https://etoile-nord.example/promo", page: "https://example.test/sponsors/etoile-nord", code: "LUNEDOUCE", publishedAt: new Date().toISOString() }],
  short: [{ id: "b", name: "Lune Douce", url: "https://lune-douce.example", page: "https://example.test/sponsors/lune-douce" }],
};
const ctx = (cards) => fakeCtx({ key: "ticker", name: "Sponsors", locale: "en", messages: en, topics: { "sponsor.card": cards, "core.entry": [] } });
const render = (cards) => async (q) => {
  const c = ctx(cards);
  const out = tk.overlay(c, { query: new URLSearchParams(q) });
  return { html: wrapOverlay(out), handler: async (u) => (new URL(u).pathname.endsWith("/items") ? tk.routes.items(new Request(u), c) : null) };
};
// The page starts after a short delay and slides in: wait for the card to be in place.
const cardIn = (page) => page.waitForSelector(".ticker-slider.on", { timeout: 6000 }).then(() => page.waitForTimeout(900));

for (const [name, cards, frames] of [
  ["a rich card", CARDS.rich, [{ name: "default frame", w: 720, h: 180 }, { name: "no QR code", w: 720, h: 180, extra: { "opt-qr": "0" } }, { name: "a larger frame", w: 960, h: 240 }]],
  ["a short card", CARDS.short, [{ name: "default frame", w: 720, h: 180 }]],
]) {
  tvSuite({
    test, before, after, label: `sponsor-ticker ${name}`, render: render(cards), afterLoad: cardIn, settle: 500,
    frames: frames.map((f) => ({ ...f, extra: { "ov-fit": "scale", "ov-demo": "1", ...(f.extra ?? {}) } })),
  });
}

test("TV scale sponsor-ticker: nothing to show is still nothing", async () => {
  const { html } = await render([])("ov-w=720&ov-h=180&ov-fit=scale&ov-text=light&ov-tv=1");
  assert.ok(!/ticker-card/.test(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "")));
});
