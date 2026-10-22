// Ce que voient les visiteurs : les pages publiées (jamais autre chose) et le lien du pied de page.
// Tout vient du texte déjà publié par la personne ; rien n'est recalculé ici, rien n'est demandé au visiteur.

const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { longDate, translator } = await import(`./docs.mjs${v}`);
const { readPages, readState } = await import(`./data.mjs${v}`);

export const PAGES = ["notice", "privacy", "cookies"];

/** Début du chemin public de l'instance (« /legal »), ou null si l'instance n'a pas de page publique. La racine du site donne « ». */
export function base(ctx) {
  const b = ctx.instance.basePath;
  return b === null || b === undefined ? null : b ? `/${b}` : "";
}

/** Adresse d'une page (« notice », « privacy », « cookies », ou « » pour l'accueil de la rubrique), avec la langue du visiteur si elle n'est pas celle du site. */
export function hrefOf(ctx, page) {
  const root = base(ctx);
  if (root === null) return null;
  const prefix = ctx.locale !== ctx.defaultLocale ? `/${ctx.locale}` : "";
  return `${prefix}${root}${page ? `/${page}` : ""}` || "/";
}
const coreHref = (ctx, path) => `${ctx.locale !== ctx.defaultLocale ? `/${ctx.locale}` : ""}${path}`;

/** Quelle version lire : celle de la langue du visiteur, sinon celle du site, sinon l'anglais, sinon la première qui existe. */
export function pickLang(pages, ctx) {
  for (const l of [ctx.locale, ctx.defaultLocale, "en", "fr"]) if (pages?.[l]) return l;
  return null;
}

/** Remplace les liens internes écrits `(@privacy)`… par les vraies adresses (avec la langue du visiteur). */
export function resolveLinks(md, ctx) {
  const map = { privacy: coreHref(ctx, "/privacy"), notice: hrefOf(ctx, "notice"), cookies: hrefOf(ctx, "cookies"), home: hrefOf(ctx, "") };
  return String(md).replace(/\]\(@(privacy|notice|cookies|home)\)/g, (m, name) => `](${map[name] ?? "#"})`);
}

const labelKey = { notice: "public.link.notice", privacy: "public.link.privacy", cookies: "public.link.cookies" };

export async function page(ctx, { segments }) {
  if (base(ctx) === null || segments.length > 1) return { notFound: true, blocks: [] };
  const state = await readState(ctx);
  if (!state.published) return { notFound: true, blocks: [] };
  const pages = await readPages(ctx);
  const lang = pickLang(pages, ctx);
  if (!lang) return { notFound: true, blocks: [] };
  const docs = pages[lang];
  const T = translator(lang);
  const updated = T("public.updated", { date: longDate(state.at, lang) });

  if (segments.length === 0) {
    const items = PAGES.filter((p) => docs[p]).map((p) => `- [${docs[p].title}](${hrefOf(ctx, p)})\n  ${docs[p].description}`);
    const text = `${T("public.index.intro")}\n\n${items.join("\n")}\n\n[${T("public.link.technical")}](${coreHref(ctx, "/privacy")})\n\n*${updated}*`;
    return { title: T("public.index.title"), description: T("public.index.desc"), blocks: [{ type: "markdown", text }] };
  }

  const key = segments[0];
  if (!PAGES.includes(key) || !docs[key]) return { notFound: true, blocks: [] };
  const others = PAGES.filter((p) => p !== key && docs[p]).map((p) => ({ label: docs[p].title, href: hrefOf(ctx, p) }));
  const blocks = [{ type: "markdown", text: resolveLinks(docs[key].md, ctx) }, { type: "markdown", text: `*${updated}*` }];
  if (others.length) blocks.push({ type: "links", items: others });
  return { title: docs[key].title, description: docs[key].description, blocks };
}

/** Le lien du pied de page : un seul, trois, ou aucun selon le réglage ; jamais tant que rien n'est publié. */
export async function footer(ctx) {
  const mode = String(ctx.setting("footerLinks") ?? "one");
  if (mode === "none" || base(ctx) === null) return null;
  const state = await readState(ctx);
  if (!state.published) return null;
  const T = (key) => ctx.t(key);
  if (mode === "all") return [{ type: "links", items: [{ label: T("public.link.notice"), href: hrefOf(ctx, "notice") }, { label: T("public.link.privacy"), href: hrefOf(ctx, "privacy") }, { label: T("public.link.cookies"), href: hrefOf(ctx, "cookies") }] }];
  return [{ type: "links", items: [{ label: T("public.link.notice"), href: hrefOf(ctx, "") }] }];
}

export { labelKey };
