// Mascotte — les outils pour un assistant IA : lire les phrases, en proposer une. Une phrase proposée est TOUJOURS un brouillon : seule la personne qui gère le site la publie.
const v = new URL(import.meta.url).search;
const M = await import(new URL(`./model.mjs${v}`, import.meta.url).href);
const S = await import(new URL(`./store.mjs${v}`, import.meta.url).href);

const refused = (message) => Object.assign(new Error(message), { expose: true });

export const mcp = {
  async mascot_phrases_list(ctx, args) {
    const phrases = await S.loadPhrases(ctx);
    const status = args?.status === "published" || args?.status === "draft" ? args.status : "all";
    const limit = Math.min(M.LIMITS.phrases, Math.max(1, Math.floor(Number(args?.limit)) || 50));
    const list = phrases.filter((p) => status === "all" || p.state === status).slice(0, limit);
    const config = await S.loadConfig(ctx);
    return {
      mascotPublished: config.published, total: phrases.length, max: M.LIMITS.phrases, maxLength: M.LIMITS.text,
      variables: M.VARIABLES.map((x) => `{${x.names[0]}}`),
      phrases: list.map((p) => ({ id: p.id, kind: p.kind, language: p.lang || "all", text: p.text, pages: p.pages, state: p.state })),
    };
  },
  async mascot_phrase_add(ctx, args) {
    const checked = M.checkPhrase({ text: args?.text, kind: args?.kind, lang: args?.language && args.language !== "all" ? args.language : "", pages: Array.isArray(args?.pages) ? args.pages.join("\n") : "", state: "draft" }, { locales: ctx.locales, locale: ctx.locale });
    if (checked.errors) {
      const [field, e] = Object.entries(checked.errors)[0];
      throw refused(`${field}: ${ctx.t(e[0], e[1])}`);
    }
    const r = await S.addPhrase(ctx, checked.value);
    if (r.full) throw refused(ctx.t("errFull", { max: M.LIMITS.phrases }));
    return { id: r.id, state: "draft", note: "Saved as a draft. The site team publishes it from the administration." };
  },
};
