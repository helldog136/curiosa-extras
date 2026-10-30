// Non-régression des overlays EXISTANTS (Compte à rebours, Overlay sponsors) à l'arrivée des éléments de page d'overlay (cœur 0.5.0) :
// même adresse, même rendu, mêmes réglages. Les empreintes ci-dessous ont été prises sur la version 85019dc (dépôt 1.25.0), avant toute modification.
// Sans les paramètres réservés `ov-*` / `opt-*`, `overlay()` doit rendre octet pour octet ce qu'il rendait.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { fakeCtx } from "./helpers/fakeCtx.mjs";

const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);
const sha = (s) => createHash("sha256").update(String(s)).digest("hex").slice(0, 16);
const read = (m, p) => JSON.parse(fs.readFileSync(new URL(`../modules/${m}/${p}`, import.meta.url), "utf8"));
const cd = (await import("../modules/countdown/index.mjs")).default;
const tk = (await import("../modules/sponsor-ticker/index.mjs")).default;

const row = (o) => ({ uid: `00000000-0000-4000-8000-${o.slug.padEnd(12, "0").slice(0, 12)}`, rev: 1, allDay: false, tz: "UTC", endDate: "", endTime: "", description: "", where: "", endMessage: "", endLinkLabel: "", endLink: "", keep: "", featured: false, image: "", createdAt: "2026-10-01T08:00:00.000Z", updatedAt: "2026-10-01T08:00:00.000Z", ...o });
const ROWS = [
  row({ slug: "sortie", title: "La sortie", date: "2026-11-05", time: "20:00", featured: true }),
  row({ slug: "stream", title: "Gros stream", date: "2026-11-20", time: "18:30" }),
  row({ slug: "fini", title: "Presque fini", date: "2026-10-30", time: "11:58" }),
];
const countdownCtx = (settings = {}, rows = ROWS) => fakeCtx({ key: "cd1", basePath: "countdown", moduleId: "countdown", name: "Compte à rebours", locale: "fr", defaultLocale: "fr", locales: ["fr", "en"], messages: read("countdown", "locales/fr.json"), siteUrl: "https://example.test", settings: { keep: "1d", timezone: "Europe/Paris", showSeconds: true, overlayEndMinutes: 5, ...settings }, rows: { events: rows } });
const CARDS = [{ id: "a", name: "Alpha", text: "Un texte", url: "https://alpha.example/promo", code: "HELLDOG", publishedAt: "2026-10-25T00:00:00Z" }, { id: "b", name: "Beta", url: "https://beta.example" }];
const tickerCtx = (settings = {}) => fakeCtx({ key: "ticker", name: "Mon ticker", locale: "fr", messages: read("sponsor-ticker", "locales/fr.json"), settings, topics: { "sponsor.card": CARDS, "core.entry": [] } });

async function snapshot() {
  const realNow = Date.now; Date.now = () => NOW;
  try {
    const out = {};
    const take = async (name, p) => { const r = await p; out[name] = [sha(r.title), sha(r.html), sha(r.css), sha(r.script)].join("."); };
    await take("cd-default", cd.overlay(countdownCtx(), { query: new URLSearchParams() }));
    await take("cd-event", cd.overlay(countdownCtx(), { query: new URLSearchParams("e=stream") }));
    await take("cd-unknown-event", cd.overlay(countdownCtx(), { query: new URLSearchParams("e=nope") }));
    await take("cd-look", cd.overlay(countdownCtx({ overlayLook: "light", overlayPosition: "bottom-right", overlaySize: "l", overlayAccent: "#112233", showSeconds: false, overlayEndMinutes: 30 }), { query: new URLSearchParams() }));
    await take("cd-empty", cd.overlay(countdownCtx({}, []), { query: new URLSearchParams() }));
    await take("tk-default", tk.overlay(tickerCtx(), { query: new URLSearchParams() }));
    await take("tk-broadcast", tk.overlay(tickerCtx({ visual: "broadcast", accentColor: "#12abEF", periodSeconds: 20, holdSeconds: 6, showQr: false }), { query: new URLSearchParams() }));
    await take("tk-dev", tk.overlay(tickerCtx({ devMode: true }), { query: new URLSearchParams("dev=1&seed=7") }));
    return out;
  } finally { Date.now = realNow; }
}

const GOLDEN = {
  "cd-default": "66ffd1ccfafb52c6.28d1cd0618a53bc1.5c9d8257713b6bce.b265ef2f0285346f",
  "cd-empty": "66ffd1ccfafb52c6.28d1cd0618a53bc1.5c9d8257713b6bce.c6cbf0e21613a0cf",
  "cd-event": "66ffd1ccfafb52c6.28d1cd0618a53bc1.5c9d8257713b6bce.556a6c45c0822291",
  "cd-look": "66ffd1ccfafb52c6.f32048cf0e049bfe.95ebd8288f8eb267.0d84f5685806ec58",
  "cd-unknown-event": "66ffd1ccfafb52c6.28d1cd0618a53bc1.5c9d8257713b6bce.0e3f6922532ffb88",
  "tk-broadcast": "419bdd45bea2bdf8.bd08be8d0bc79547.036ccd7547b7d551.679f80bccfddffe9",
  "tk-default": "419bdd45bea2bdf8.6b5925feeeff70ad.036ccd7547b7d551.6aa6c1e43de4483f",
  "tk-dev": "419bdd45bea2bdf8.6b5925feeeff70ad.036ccd7547b7d551.ab57566951a819ec",
};

test("non-régression : l'overlay existant rend exactement la même chose qu'avant les éléments", async () => {
  const got = await snapshot();
  if (process.env.PRINT_GOLDEN) console.log("GOLDEN=" + JSON.stringify(got, null, 2));
  assert.deepEqual(got, GOLDEN);
});

test("non-régression : l'adresse de l'overlay et ses réglages existants n'ont pas changé", () => {
  assert.equal(typeof cd.overlay, "function");
  assert.equal(typeof tk.overlay, "function");
  assert.deepEqual(read("countdown", "module.json").settings.map((s) => s.key), ["timezone", "timezoneOther", "keep", "endMessage", "pageTitle", "showSeconds", "overlayLook", "overlayPosition", "overlaySize", "overlayAccent", "overlayEndMinutes"]);
  assert.deepEqual(read("sponsor-ticker", "module.json").settings.map((s) => s.key), ["visual", "accentColor", "periodSeconds", "holdSeconds", "showQr", "devMode"]);
  assert.equal(read("countdown", "module.json").type, "widget");
  assert.equal(read("sponsor-ticker", "module.json").type, "overlay");
});
