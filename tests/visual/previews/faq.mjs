// Questions fréquentes : la page du public (une réponse ouverte) et l'administration. Questions et thèmes inventés.
import { ctxFor, addItem, addTheme, pageHtml, def } from "../../helpers/faqKit.mjs";

export default async function scenes({ siteFrame, adminFrame, SITE }) {
  const ctx = ctxFor({}, { rights: ["edit", "publish"] });
  ctx.instance = { ...(ctx.instance ?? {}), id: "faq1", basePath: "faq" };
  const abo = await addTheme(ctx, { fr: "Abonnements et soutien", en: "Subscriptions and support" }, 1);
  const chat = await addTheme(ctx, { fr: "Le chat et les commandes", en: "Chat and commands" }, 2);
  const prog = await addTheme(ctx, { fr: "Programme et rediffusions", en: "Schedule and replays" }, 3);
  const items = [
    ["Comment soutenir la chaîne gratuitement ?", "Regardez le direct, suivez la chaîne et partagez-la autour de vous. **Chaque passage compte**, même sans rien dépenser.", abo, 14, "How can I support the channel for free?", "Watch the stream, follow the channel and share it around you. **Every visit counts**, even without spending anything."],
    ["Que donne un abonnement ?", "Des émoticônes exclusives, un badge à côté de votre pseudo et l'accès au salon privé du Discord.", abo, 9, "What does a subscription give?", "Exclusive emotes, a badge next to your name and access to the private lounge on Discord."],
    ["Peut-on résilier à tout moment ?", "Oui, depuis votre compte de la plateforme, sans justification.", abo, 5, "Can I cancel at any time?", "Yes, from your account on the platform, with no justification."],
    ["Quelles commandes puis-je utiliser dans le chat ?", "Tapez **!commandes** : la liste s'affiche aussitôt. **!planning** donne le prochain direct.", chat, 21, "Which commands can I use in chat?", "Type **!commands**: the list appears at once. **!schedule** gives the next stream."],
    ["Comment proposer un jeu ?", "Utilisez la page « Proposer un jeu » du site : une proposition par personne et par semaine.", chat, 11, "How do I suggest a game?", "Use the “Suggest a game” page: one suggestion per person per week."],
    ["À quelle heure commencent les directs ?", "Le plus souvent à 20 h 30, heure de Paris. Le planning de la semaine est toujours à jour.", prog, 17, "What time do streams start?", "Most often at 8:30 pm, Paris time. The weekly schedule is always up to date."],
    ["Les rediffusions sont-elles gardées ?", "Pendant 60 jours, puis les meilleurs moments sont rangés dans la page Vidéos.", prog, 6, "Are replays kept?", "For 60 days, then the best moments are filed on the Videos page."],
  ];
  let pos = {};
  for (const [q, a, theme, y, eq, ea] of items) { pos[theme] = (pos[theme] ?? 0) + 1; await addItem(ctx, { q, a, theme, pos: pos[theme], y, n: Math.round(y / 6), en: { q: eq, a: ea } }); }
  const html = await pageHtml(ctx);
  const page = (lang) => siteFrame({ title: "Questions fréquentes", lead: "Les réponses aux questions que l'on nous pose le plus souvent.", nav: ["Accueil", "Planning", "Questions fréquentes", "Contact"], current: "Questions fréquentes", body: html, lang });
  const open = [{ eval: "document.querySelectorAll('details')[1].open = true" }];
  const panel = await def.adminPanel(ctx, { query: {} });
  return {
    "page.webp": { html: page("fr"), steps: open, h: 1000 },
    "admin.webp": { html: adminFrame({ title: "Questions fréquentes", icon: "❓", lead: "Vos questions et réponses, rangées par thèmes, telles que le public les lit.", tabs: [["faq", "Ma FAQ"], ["asked", "Questions reçues"]], tab: "faq", blocks: panel }), h: 820 },
  };
}
