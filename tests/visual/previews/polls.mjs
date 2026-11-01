// Sondages : la page d'un sondage ouvert (résultats en barres) et la liste des sondages. Questions et scores inventés.
import fs from "node:fs";
import { fakeCtx } from "../../helpers/fakeCtx.mjs";
import { pollsStore } from "../../helpers/pollsStore.mjs";

export default async function scenes({ siteFrame, esc, messages, REPO }) {
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
  const p2 = await make("Quelles animations voulez-vous au prochain anniversaire de la chaîne ?", ["Un tournoi entre spectateurs", "Un tirage au sort de cadeaux", "Un direct de 12 heures", "Des défis proposés par le chat"], 2, day(5), { resultsMode: "after" });
  const one = await def.page(ctx, { segments: [p1.slug] });
  const two = await def.page(ctx, { segments: [p2.slug] });
  const shareBox = (url) => `<div class="flex flex-wrap items-center gap-2 rounded-card border border-line bg-surface p-3 text-sm"><span class="text-muted">Lien à partager</span><code class="rounded bg-bg px-2 py-1">${esc(url)}</code></div>`;
  const body = (page, extra = "") => page.blocks.map((b) => b.type === "html" ? `<div>${b.html}</div>` : b.type === "copy" ? shareBox(b.text) : b.type === "links" ? `<p><a class="text-accent underline" href="#">${esc(b.items[0].label)}</a></p>` : b.type === "markdown" ? `<p>${esc(b.text)}</p>` : "").join("") + extra;
  const nav = ["Accueil", "Planning", "Sondages", "Contact"];
  return {
    "sondage.webp": { html: siteFrame({ title: one.title, nav, current: "Sondages", body: body(one) }), h: 760 },
    "vote.webp": { html: siteFrame({ title: two.title, nav, current: "Sondages", body: body(two) }), h: 760 },
  };
}
