// Sponsors — module communautaire de Curiosa.
//
// Un module « à contenu » : l'éditeur, les pages publiques, les langues et les liens /go/… viennent
// du cœur (voir module.json). Ce code ajoute seulement trois choses :
//   1. la MENTION DE PARTENARIAT, affichée sur chaque page de sponsor et au-dessus de la liste ;
//   2. le sujet « sponsor.card » qui nourrit les overlays sponsors (aucun overlay n'est connu d'ici) ;
//   3. la résolution du champ « Partenaire » : une référence vers une fiche du module Partenariats,
//      dont on reprend le logo quand le sponsor n'a pas d'image.
const disclosure = (ctx) => ctx.setting("disclosure") || ctx.t("disclosure");

// Une seule ligne : un réglage multiligne ne doit pas sortir de la citation ni ouvrir un titre ou une liste.
const notice = (ctx) => [{ type: "markdown", text: `> ℹ️ ${String(disclosure(ctx)).replace(/\s*[\r\n]+\s*/g, " ").trim()}` }];

// Les overlays affichent et encodent ces adresses : seules http(s) et les chemins du site passent.
const safeLink = (v) => (typeof v === "string" && /^(https?:\/\/|\/(?!\/))/i.test(v.trim()) ? v.trim() : undefined);

export default {
  slots: {
    // N'ajoute la mention que sur les pages de SES propres entrées (une instance de sponsors par liste).
    "page.top": (ctx) => (ctx.page?.key === ctx.instance.key ? notice(ctx) : null),
    "entry.top": (ctx) => (ctx.page?.key === ctx.instance.key ? notice(ctx) : null),
  },

  exports: {
    async "sponsor.card"(ctx, { limit }) {
      const [entries, partners] = await Promise.all([
        ctx.api.entries.list({ limit }),
        // Peut échouer ou être vide (module Partenariats absent) : un sponsor reste affichable sans partenaire.
        ctx.api.topics.collect("partnership.partner", { limit: 200 }).catch(() => []),
      ]);
      const site = ctx.api.siteUrl;
      return entries.map((e) => {
        const partner = partners.find((p) => p.id === e.fields.partner);
        return {
          id: e.id,
          name: e.title,
          text: e.summary || undefined,
          url: safeLink(e.url) ?? `${site}${e.path}`,
          code: e.code ?? undefined,
          logo: safeLink(e.cover) ?? safeLink(partner?.logo),
          publishedAt: e.publishedAt ? e.publishedAt.toISOString() : undefined,
          tags: e.tags,
        };
      });
    },
  },
};
