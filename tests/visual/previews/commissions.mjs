// Commandes : la page publique d'une personne qui crée sur commande (places, formulaire, suivi). Demande et pseudo inventés.
import fs from "node:fs";
import { fakeCtx } from "../../helpers/fakeCtx.mjs";
import { memStore } from "../../helpers/contactsStore.mjs";

export default async function scenes({ siteFrame, blocksHtml, messages }) {
  const def = (await import("../../../modules/commissions/index.mjs")).default;
  const data = await import("../../../modules/commissions/data.mjs");
  const ctx = fakeCtx({ key: "cm-demo", basePath: "commandes", moduleId: "commissions", locale: "fr", defaultLocale: "fr", locales: ["fr", "en"], messages: messages("commissions", "fr"), settings: { rateLimit: 50 }, siteUrl: "https://site.example.org" });
  ctx.api.store = memStore();
  ctx.instance.id = "id1";
  ctx.can = () => true;
  await data.writeQueue(ctx, { mode: "open", slots: 3 });
  const page = await def.page(ctx, { segments: [] });
  return { "page.webp": { html: siteFrame({ title: page.title, nav: ["Accueil", "Commandes", "Galeries", "Contact"], current: "Commandes", body: blocksHtml(page.blocks) }), h: 900, allow: ["exemple.org"] } };
}
