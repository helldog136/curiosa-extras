// Questions fréquentes — module de Curiosa.
//
// Une page de questions et réponses, rangées par thèmes, qui s'ouvrent et se referment (balises natives : tout marche sans JavaScript).
// Les visiteurs cherchent en tapant, donnent leur avis, posent la question qui manque ; l'équipe la transforme en réponse publiée.
// Un assistant IA peut proposer des BROUILLONS de réponse (jamais publier).
//
// Pourquoi du code et pas le type « contenu » (zéro code) du cœur : voir docs/ideas/faq.md. En bref, le type « contenu » donne un éditeur,
// des brouillons et des pages par entrée, mais ni dépliants, ni recherche, ni avis, ni thèmes réordonnables par boutons, ni boîte de
// questions, ni données FAQPage ; et ses réponses ne sont pas lisibles par le code d'un module.
//
// Fichiers : text.mjs (outils de texte) · data.mjs (données, limiteurs) · ops.mjs (écritures partagées) · view.mjs (pages) · client.mjs (le script de confort ; son texte est recopié dans scripts/faq.js, vérifié par les tests)
//           routes.mjs (poser une question, avis, script) · admin.mjs (administration) · mcp.mjs (assistant IA)

// Chaque fichier voisin est importé AVEC la version du fichier principal : sinon une mise à jour à chaud garderait l'ancien (voir docs/HOT-UPDATE.md).
const v = new URL(import.meta.url).search;
const { C, loadItems, loadThemes, loadAsked, flag, forget } = await import(`./data.mjs${v}`);
const { adminActions, adminBadge, adminPanel } = await import(`./admin.mjs${v}`);
const { mcp } = await import(`./mcp.mjs${v}`);
const { routes } = await import(`./routes.mjs${v}`);
const { cell, plainText, slugify } = await import(`./text.mjs${v}`);
const { pageHref, renderPage, renderTop } = await import(`./view.mjs${v}`);

/** Doit rester égale à `version` de module.json (le script est mis en cache par son numéro). */
export const VERSION = "1.0.1";

// Deux brouillons d'exemple, créés avec l'instance : invisibles pour les visiteurs, ils montrent à Emma comment ça marche.
const SEED = {
  fr: { theme: "Général", items: [
    { q: "Exemple : comment fonctionne cette page ?", a: "Ceci est un exemple de réponse : modifiez-la, publiez-la ou supprimez-la depuis l'administration.\n\nVous pouvez écrire en **gras**, en *italique*, ajouter un [lien](https://example.org) et des listes :\n- une première idée\n- une deuxième idée" },
    { q: "Exemple : où trouver les dernières nouvelles ?", a: "Remplacez ce texte par votre réponse. Un visiteur peut dire si elle l'a aidé ; vous voyez le résultat dans votre administration." },
  ] },
  en: { theme: "General", items: [
    { q: "Example: how does this page work?", a: "This is an example answer: edit it, publish it or delete it from the administration.\n\nYou can write in **bold**, in *italics*, add a [link](https://example.org) and lists:\n- a first idea\n- a second idea" },
    { q: "Example: where can I find the latest news?", a: "Replace this text with your answer. A visitor can say whether it helped; you see the result in your administration." },
  ] },
};

export default {
  // PAGE PUBLIQUE : /faq (un seul chemin ; tout autre chemin est une 404).
  async page(ctx, { segments }) {
    if (segments.length > 0) return { notFound: true, blocks: [] };
    const { html } = await renderPage(ctx);
    const intro = ctx.setting("intro");
    // Le petit script de confort (recherche, avis sans rechargement) n'est chargé que sur CETTE page (cœur 0.2.6) : fichier scripts/faq.js.
    return { title: ctx.instance.name || ctx.t("pageTitle"), description: intro ? plainText(intro, 160) : ctx.t("pageDescription"), blocks: [{ type: "html", html }], scripts: ["faq.js"] };
  },

  routes,

  // ACCUEIL : les questions les plus utiles.
  sections: {
    top: (ctx, options) => renderTop(ctx, options),
  },

  slots: {
    "layout.footer"(ctx) {
      const href = pageHref(ctx);
      if (!flag(ctx, "footerLink", false) || !href) return null;
      return [{ type: "links", items: [{ label: ctx.t("footerLink"), href }] }];
    },
  },

  adminPanel,
  adminActions,
  adminBadge,
  mcp,

  // SAUVEGARDE LISIBLE : deux tableaux, lisibles dans n'importe quel tableur même si le site n'existe plus.
  backup: {
    async readable(ctx) {
      const [themes, items, asked] = await Promise.all([loadThemes(ctx), loadItems(ctx), loadAsked(ctx)]);
      const langs = [...new Set([ctx.defaultLocale, ...ctx.locales, ...items.flatMap((i) => Object.keys(i.tr))])].slice(0, 12);
      const name = (id) => { const t = themes.find((x) => x.id === id); return t ? Object.values(t.names).join(" / ") : ""; };
      const head = ["id", "state", "theme", "helpful", "not_helpful", ...langs.flatMap((l) => [`question_${l}`, `answer_${l}`])].map(cell).join(",");
      const rows = items.map((i) => [i.id, i.status, name(i.theme), i.y, i.n, ...langs.flatMap((l) => [i.tr[l]?.q ?? "", i.tr[l]?.a ?? ""])].map(cell).join(","));
      const received = [["id", "question", "language", "times_asked", "last_asked"].map(cell).join(","), ...asked.map((a) => [a.id, a.text, a.lang, a.count, new Date(a.last).toISOString()].map(cell).join(","))];
      return [
        { path: "questions.csv", content: `\uFEFF${[head, ...rows].join("\r\n")}\r\n` },
        { path: "received.csv", content: `\uFEFF${received.join("\r\n")}\r\n` },
      ];
    },
  },

  hooks: {
    // Créé avec l'instance (pas lors d'une restauration) : un thème et deux brouillons d'exemple, jamais publiés. Idempotent.
    async onInstanceCreate(ctx) {
      if ((await ctx.api.store.count(C.items)) > 0 || (await ctx.api.store.count(C.themes)) > 0) return;
      const known = ctx.locales.filter((l) => SEED[l]);
      const texts = known.length ? Object.fromEntries(known.map((l) => [l, SEED[l]])) : { [ctx.defaultLocale]: SEED.en };
      const theme = await ctx.api.store.add(C.themes, { names: Object.fromEntries(Object.entries(texts).map(([l, s]) => [l, s.theme])), pos: 1 });
      const lead = texts[ctx.defaultLocale] ?? Object.values(texts)[0];
      for (const [n, first] of lead.items.entries()) {
        const tr = Object.fromEntries(Object.entries(texts).map(([l, s]) => [l, { q: s.items[n].q, a: s.items[n].a }]));
        await ctx.api.store.add(C.items, { slug: slugify(first.q), theme, pos: n + 1, status: "draft", tr, y: 0, n: 0, by: "admin" });
      }
    },
    // Quand l'instance disparaît, sa mémoire aussi (une FAQ recréée sous la même clé ne doit rien hériter de l'ancienne).
    async onInstanceDelete(ctx) {
      forget(ctx);
    },
  },
};
