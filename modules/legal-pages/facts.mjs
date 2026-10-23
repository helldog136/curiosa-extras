// Ce que le site sait déjà, lu uniquement par l'interface publique des extensions (`ctx.api`) : nom du site, adresse de contact, extensions actives.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { classify } = await import(`./known.mjs${v}`);

const LANGS = ["fr", "en"];
const attempt = async (fn, fallback) => { try { return (await fn()) ?? fallback; } catch { return fallback; } };

export async function gatherFacts(ctx) {
  const instances = await attempt(() => ctx.api.instances.list({ locale: ctx.locale }), []);
  const brand = await attempt(() => ctx.api.brand(ctx.defaultLocale), {});
  const siteName = {};
  for (const lang of LANGS) siteName[lang] = String((await attempt(() => ctx.api.site(lang), {}))?.name ?? "").trim().slice(0, 120);
  const email = String(brand?.contactEmail ?? "").trim().slice(0, 200);
  return {
    siteName,
    brandEmail: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : "",
    siteUrl: ctx.api.siteUrl,
    basePath: ctx.instance.basePath,
    ...classify(instances),
  };
}
