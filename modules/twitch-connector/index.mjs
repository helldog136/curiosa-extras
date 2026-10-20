// Connecteur Twitch — module de Curiosa. LE seul module qui parle à Twitch au nom du site : il possède l'application Twitch (identifiant et secret)
// et les autorisations des comptes connectés (la chaîne, et un compte « bot » facultatif), les renouvelle, et rend le service `twitch.api` (version 3)
// aux autres modules (Ma Chaîne Twitch, Bot Twitch, Raid Twitch…), qui décrivent l'appel voulu sans jamais voir un jeton.
//   oauth.mjs        id.twitch.tv (autorisation, échange, renouvellement, validation, révocation, jeton d'application) ;
//   helix.mjs        api.twitch.tv : liste fermée des appels, jetons, cache, bornes, seau de limite partagé par application ;
//   connections.mjs  lien d'autorisation, retour de Twitch, déconnexion, reprise (adopt) ;
//   store.mjs        ce qui est gardé (stockage privé de l'instance) ; service.mjs : les méthodes du service ; panel.mjs : l'administration.
const version = new URL(import.meta.url).search;
const store = await import(new URL(`./store.mjs${version}`, import.meta.url).href);
const helix = await import(new URL(`./helix.mjs${version}`, import.meta.url).href);
const conn = await import(new URL(`./connections.mjs${version}`, import.meta.url).href);
const service = await import(new URL(`./service.mjs${version}`, import.meta.url).href);
const panel = await import(new URL(`./panel.mjs${version}`, import.meta.url).href);

/* ───────────── Retour de Twitch : /m/<clé>/oauth/callback ───────────── */
const bad = new Map();   // clé d'instance → { n, until } : au plus 20 retours invalides par tranche de 10 minutes
const tooMany = (key) => { const b = bad.get(key); return !!b && b.until > Date.now() && b.n >= 20; };
const noteBad = (key) => { const b = bad.get(key); if (b && b.until > Date.now()) b.n++; else bad.set(key, { n: 1, until: Date.now() + conn.STATE_MS }); if (bad.size > 200) bad.delete(bad.keys().next().value); };
export const resetCache = () => { helix.resetHelix(); store.resetQueues(); bad.clear(); };

const SAFE = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
export const page = (status, text) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Twitch</title><body style="font-family:sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem"><p>${esc(text)}</p>`, { status, headers: { ...SAFE, "Content-Type": "text/html; charset=utf-8" } });
// Toujours une page d'administration de CE site : celle demandée à la création du lien (vérifiée), sinon celle du Connecteur ; jamais une adresse de la requête.
const back = (ctx, to) => new Response(null, { status: 303, headers: { ...SAFE, Location: typeof to === "string" && store.RETURN_TO.test(to) ? to : conn.adminPage(ctx) } });

async function callback(request, ctx) {
  if (request.method !== "GET") return page(405, ctx.t("cb_invalid"));
  const key = ctx.instance.key;
  if (tooMany(key)) return page(429, ctx.t("cb_invalid"));
  const q = new URL(request.url).searchParams;
  const r = await service.methods.exchangeCode(ctx, { code: q.get("code") ?? "", state: q.get("state") ?? "", redirectUri: conn.ownRedirect(ctx), error: q.get("error") ?? "" });
  if (!r.ok && r.error === "state") { noteBad(key); return page(400, ctx.t("cb_invalid")); }
  if (!r.ok && r.error === "expired") noteBad(key);
  return back(ctx, r.returnTo);
}

export default {
  services: { "twitch.api": service.methods },
  routes: { [conn.CALLBACK]: callback },
  adminPanel: (ctx) => panel.render(ctx),
  adminActions: panel.actions,
};
