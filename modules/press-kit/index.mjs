// Press kit — module de Curiosa.
/**
 * KIT PRESSE — une vitrine, rien d'autre.
 *
 * Ce module ne stocke AUCUNE donnée. Tout ce qu'il montre (nom, accroche, présentation, logo, couleurs,
 * police, email de contact) est réglé dans l'admin du cœur (Réglages → Identité et Apparence) et lu via
 * `ctx.api.brand()`. Changer le thème du site change donc le kit presse, sans rien refaire ici, et le kit
 * montre toujours ce que le site utilise vraiment.
 */
/** Texte brut d'un Markdown simple, pour les descriptions à copier. */
const plain = (md) => md.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*_`>#]/g, "").replace(/\s+/g, " ").trim();
export default ({
    async page(ctx) {
        const t = ctx.t;
        const brand = await ctx.api.brand(ctx.locale);
        const blocks = [{ type: "markdown", text: t("intro", { name: brand.name }) }];
        if (brand.about)
            blocks.push({ type: "heading", text: t("about") }, { type: "markdown", text: brand.about });
        const copies = [];
        if (brand.tagline)
            copies.push({ type: "copy", label: t("short"), text: brand.tagline });
        if (brand.about)
            copies.push({ type: "copy", label: t("long"), text: plain(brand.about) });
        blocks.push(...copies);
        const logos = brand.logos?.length ? brand.logos.map((l) => ({ src: l.src, label: t(`logo.${l.kind}`) })) : brand.logo ? [{ src: brand.logo, label: t("logo") }] : [];
        if (logos.length)
            blocks.push({ type: "heading", text: t("visuals") }, { type: "downloads", items: logos });
        blocks.push({ type: "heading", text: t("colors") }, { type: "markdown", text: `*${t("colorsHelp")}*` }, { type: "swatches", items: brand.colors.map((c) => ({ name: c.name, hex: c.hex, role: c.role })) });
        if (ctx.setting("showTypography") !== false) {
            blocks.push({ type: "heading", text: t("typography") }, { type: "markdown", text: `**${brand.font.name}** — \`${brand.font.stack}\`` });
        }
        if (ctx.setting("showContact") !== false && brand.contactEmail) {
            blocks.push({ type: "heading", text: t("contact") }, { type: "markdown", text: `[${brand.contactEmail}](mailto:${brand.contactEmail})` });
        }
        return { title: t("title"), description: brand.tagline || undefined, blocks };
    },
});
