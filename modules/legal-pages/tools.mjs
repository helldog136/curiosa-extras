// Les outils pour les assistants IA : lire où en sont les pages, voir un texte, préparer un brouillon de réponses.
// Aucun outil ne publie : publier est un geste de la personne (case « j'ai relu » dans l'administration).

const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins
const { applyPatch, evaluate, withDefaults } = await import(`./answers.mjs${v}`);
const { buildDocs } = await import(`./docs.mjs${v}`);
const { readAnswers, writeOne } = await import(`./data.mjs${v}`);
const { gatherFacts } = await import(`./facts.mjs${v}`);
const { load, attention } = await import(`./admin.mjs${v}`);

const fail = (text) => Object.assign(new Error(text), { expose: true }); // `expose` : ce message peut être lu par l'assistant

const missingOf = (list) => list.map((m) => ({ step: m.step, ...(m.field ? { field: m.field } : {}), reason: m.kind === "confirm" ? "needs the owner's confirmation" : "missing or invalid" }));

export default {
  mcp: {
    async legal_status(ctx) {
      const s = await load(ctx);
      return {
        published: s.state.published, publishedAt: s.state.published ? s.state.at : null, changedSincePublication: s.dirty,
        readyToPublish: s.missing.length === 0, missing: missingOf(s.missing),
        reminders: attention(ctx, s).map((r) => r.text),
        extensionsSeen: { collectingInformation: s.facts.collectors.map((c) => c.name), unknownToThisAssistant: s.facts.unknown.map((c) => c.name) },
        country: s.a.country || null,
        note: "These texts are help templates, not legal advice. Publishing is done by the site owner in the administration.",
      };
    },

    async legal_preview(ctx, args) {
      const page = ["notice", "privacy", "cookies"].includes(args?.page) ? args.page : null;
      if (!page) throw fail("page must be notice, privacy or cookies");
      const lang = args?.lang === "en" ? "en" : "fr";
      const s = await load(ctx);
      const built = buildDocs({ answers: s.a, facts: s.facts, lang, mode: "preview" });
      return { page, lang, title: built[page].title, markdown: built[page].md, gaps: built.gaps, note: "Draft preview. A line starting with ⚠ is a missing answer." };
    },

    async legal_set_answers(ctx, args) {
      const facts = await gatherFacts(ctx);
      const current = withDefaults(await readAnswers(ctx), facts);
      const patch = Object.fromEntries(Object.entries(args ?? {}).filter(([, value]) => value !== undefined));
      if (Object.keys(patch).length === 0) throw fail("give at least one answer to record");
      const { answers, errors } = applyPatch(current, patch, facts);
      if (Object.keys(errors).length) throw fail(`not recorded, invalid: ${Object.entries(errors).map(([field, key]) => `${field} (${key})`).join(", ")}`);
      await writeOne(ctx, "answers", { ...answers, savedAt: new Date().toISOString() });
      const missing = evaluate(answers, facts);
      return { recorded: Object.keys(patch), stillMissing: missingOf(missing), note: "Saved as a draft. The owner still has to open each step to confirm it, then publish." };
    },
  },
};
