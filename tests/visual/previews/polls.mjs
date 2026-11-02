// Sondages : la page d'un sondage ouvert (résultats en barres) et la liste des sondages. Questions et scores inventés.
import fs from "node:fs";
import { fakeCtx } from "../../helpers/fakeCtx.mjs";
import { pollsStore } from "../../helpers/pollsStore.mjs";

export default async function scenes({ siteFrame, esc, messages, art }) {
  const mod = await import("../../../modules/polls/index.mjs");
  const L = await import("../../../modules/polls/lib.mjs");
  const def = mod.default;
  const mk = (lang) => {
    const c = fakeCtx({ key: `polls-${lang}`, basePath: "sondages", moduleId: "polls", locale: lang, defaultLocale: "fr", locales: ["fr", "en"], messages: messages("polls", lang), settings: {}, siteUrl: "https://site.example.org" });
    c.api.store = pollsStore();
    return c;
  };
  const ctx = mk("fr");
  // Les heures sont celles de l'horloge réelle du module : la fin est proche, on la place dans deux jours.
  const make = async (question, choices, max = 1, end, extra = {}) => {
    const v = L.validatePollForm({ question, choices: choices.join("\n"), max, ...(end ? { endDate: end.date, endTime: end.time } : {}), ...extra }, { tz: "Europe/Paris" });
    if (Object.keys(v.errors).length) throw new Error(JSON.stringify(v.errors));
    const r = await mod.createPoll(ctx, v.value, "Europe/Paris");
    if (!r.ok) throw new Error(JSON.stringify(r));
    return r;
  };
  const day = (n) => { const d = new Date(Date.now() + n * 86400_000); return { date: d.toISOString().slice(0, 10), time: "20:00" }; };
  const tok = (i) => `demo${String(i).padStart(4, "0")}${"x".repeat(20)}`;
  const p1 = await make("Quel jeu pour le direct de samedi ?", ["Un jeu de plateforme", "Une aventure narrative", "Un jeu de gestion", "Une surprise"], 1, day(2));
  const votes = [14, 9, 6, 4];
  let i = 0;
  for (const [idx, n] of votes.entries()) for (let k = 0; k < n; k++) await mod.castVote(ctx, { slug: p1.slug, token: tok(i++), ids: [String((await ctx.api.store.get(p1.id)).data.choices[idx].id)] });
  const one = await def.page(ctx, { segments: [p1.slug] });
  const shareBox = (url) => `<div class="flex flex-wrap items-center gap-2 rounded-card border border-line bg-surface p-3 text-sm"><span class="text-muted">Lien à partager</span><code class="rounded bg-bg px-2 py-1">${esc(url)}</code></div>`;
  const body = (page, extra = "") => page.blocks.map((b) => b.type === "html" ? `<div>${b.html}</div>` : b.type === "copy" ? shareBox(b.text) : b.type === "links" ? `<p><a class="text-accent underline" href="#">${esc(b.items[0].label)}</a></p>` : b.type === "markdown" ? `<p>${esc(b.text)}</p>` : "").join("") + extra;
  // L'élément « sondage » d'une page d'overlay (OBS) : mode test du module (aucun vrai sondage), posé sur un faux fond de stream dessiné.
  const cfgRow = (await ctx.api.store.list("meta")).find((x) => x.data.k === "cfg") ?? (await def.hooks.onInstanceCreate(ctx), (await ctx.api.store.list("meta")).find((x) => x.data.k === "cfg"));
  const q = new URLSearchParams({ k: cfgRow.data.obsKey, "ov-w": "720", "ov-h": "300", "ov-fit": "fluid", "ov-lang": "fr", "ov-text": "light", "ov-surface": "soft", "ov-corners": "round", "opt-poll": "", "ov-demo": "1" });
  const ov = await def.overlay(ctx, { query: q });
  const inner = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;overflow:hidden;background:transparent}${ov.css}</style></head><body>${ov.html}<script>${ov.script}</script></body></html>`;
  const stage = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;overflow:hidden}.stage{position:fixed;inset:0;background:url("${art(250, 330, { w: 1280, hgt: 720, shape: "waves" })}") center/cover}iframe{position:absolute;left:250px;top:130px;width:780px;height:440px;border:0;background:transparent}</style></head><body><div class="stage"></div><iframe title="Sondage" srcdoc="${esc(inner)}"></iframe></body></html>`;
  const nav = ["Accueil", "Planning", "Sondages", "Contact"];
  return {
    "sondage.webp": { html: siteFrame({ title: one.title, nav, current: "Sondages", body: body(one) }), h: 760 },
    "overlay.webp": { html: stage, h: 720, steps: [{ wait: 600 }] },
  };
}
