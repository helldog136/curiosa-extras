// LIENS COURTS — une adresse longue devient un nom court (« merch »), avec son QR code prêt à imprimer et un compteur de clics par jour.
//
// Qui fait quoi :
//   url.mjs        ce qu'on accepte (destinations, noms courts) et la proposition d'un nom lisible
//   qr.mjs         le générateur de QR code (octets, correction L / M / Q, versions 1 à 10), sans dépendance
//   qr-render.mjs  le dessin : SVG propre et PNG, avec zone de silence et contraste maximal
//   data.mjs       le stockage (liens, un document de statistiques par lien), tout borné
//   clicks.mjs     le décompte des clics : en mémoire d'abord, écrit derrière, jamais d'attente pour le visiteur
//   links.mjs      créer / modifier / supprimer (mêmes règles pour l'administration et pour l'assistant IA)
//   public.mjs     la redirection publique, l'image du QR code et la page aimable d'un lien terminé ou introuvable
//   admin.mjs      le panneau « Mes liens », les exports, la sauvegarde lisible
import { adminActions, adminDownloads, adminPanel, backup } from "./admin.mjs";
import { forgetInstance, settle } from "./clicks.mjs";
import { MAX_LINKS, linkById, linkPage, readStats, summarize } from "./data.mjs";
import { createLink, deleteLink, editLink, isEnded, shortUrl } from "./links.mjs";
import { forgetImageHits, routes } from "./public.mjs";

/** Une erreur dont le message peut être lu par l'assistant (les autres sont masquées par le cœur). */
const refuse = (message) => Object.assign(new Error(message), { expose: true });

const MESSAGES = {
  url: {
    empty: "The address is empty.",
    long: "The address is too long (2000 characters at most).",
    space: "The address contains spaces.",
    scheme: "Only web addresses are accepted (https://… or http://…).",
    invalid: "This does not look like a web address, for example https://www.example.org/shop.",
    credentials: "An address must not contain a user name or a password.",
    private: "This address points to a private or internal computer or network, which visitors could not open.",
    loop: "This address leads to another short link or to a technical page of this site.",
  },
  slug: {
    short: "The short name needs at least 2 characters.",
    long: "The short name can have 32 characters at most.",
    chars: "Use only lowercase letters, digits and hyphens.",
    reserved: "This short name is reserved by the site.",
    taken: "This short name is already used.",
  },
  expires: { date: "The end date must look like 2026-12-31.", past: "The end date is already past." },
  form: { full: `The limit of ${MAX_LINKS} links is reached: delete one first.`, gone: "This link does not exist." },
};

function fail(result) {
  const lines = Object.entries(result.codes).map(([field, code]) => MESSAGES[field]?.[code] ?? `${field}: ${code}`);
  if (result.suggestion) lines.push(`Suggestion: ${result.suggestion}`);
  return refuse(lines.join(" "));
}

const view = (ctx, link, sums) => ({
  id: link.id,
  name: link.slug,
  shortUrl: shortUrl(ctx, link.slug),
  destination: link.url,
  note: link.title,
  endsOn: link.expires || null,
  ended: isEnded(link),
  ...(sums ? { clicksLast30Days: sums.month, clicksTotal: sums.total } : {}),
});

export default {
  routes,
  adminPanel,
  adminActions,
  adminDownloads,
  backup,

  mcp: {
    async shortlink_list(ctx, args) {
      const limit = Math.min(100, Math.max(1, Math.trunc(Number(args?.limit)) || 30));
      const { items, next } = await linkPage(ctx, { limit, cursor: typeof args?.cursor === "string" ? args.cursor : null });
      const out = [];
      for (const link of items) out.push(view(ctx, link, summarize(await readStats(ctx, link.id))));
      return { items: out, next };
    },
    async shortlink_stats(ctx, args) {
      const link = await linkById(ctx, String(args?.id ?? ""));
      if (!link) throw refuse(MESSAGES.form.gone);
      await settle(ctx, link.id);
      const stats = await readStats(ctx, link.id);
      const days = Math.min(120, Math.max(1, Math.trunc(Number(args?.days)) || 30));
      const sums = summarize(stats, Date.now(), days);
      return { ...view(ctx, link, summarize(stats)), days: sums.series.filter((d) => d.n > 0).map((d) => ({ day: d.day, clicks: d.n })), clicksInPeriod: sums.month, period: days };
    },
    async shortlink_create(ctx, args, actor) {
      const result = await createLink(ctx, { url: args?.url, slug: args?.name, title: args?.note, expires: args?.endsOn });
      if (!result.ok) throw fail(result);
      console.log(`[short-links] link created by ${String(actor?.name ?? "assistant").slice(0, 40)}`);
      return view(ctx, result.link);
    },
    async shortlink_update(ctx, args) {
      const link = await linkById(ctx, String(args?.id ?? ""));
      if (!link) throw refuse(MESSAGES.form.gone);
      const endsOn = args?.endsOn === undefined ? link.expires : args.endsOn === "none" ? "" : args.endsOn;
      const result = await editLink(ctx, link.id, { url: args?.url ?? link.url, title: args?.note ?? link.title, expires: endsOn });
      if (!result.ok) throw fail(result);
      return view(ctx, result.link);
    },
    async shortlink_delete(ctx, args) {
      const result = await deleteLink(ctx, String(args?.id ?? ""));
      if (!result.ok) throw refuse(MESSAGES.form.gone);
      return { id: result.link.id, name: result.link.slug, deleted: true };
    },
  },

  hooks: {
    // Le cœur supprime lui-même les réglages et le stockage ; il reste à vider ce que seul le module connaît : la mémoire.
    async onInstanceDelete(ctx) {
      forgetInstance(ctx);
      forgetImageHits(ctx);
    },
  },
};

