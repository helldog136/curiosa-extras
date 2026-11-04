// Press kit — a Curiosa module.
/**
 * PRESS KIT — a showcase, nothing else.
 *
 * The module stores NO data of its own. By default everything it shows (name, tagline, presentation, logos, colors,
 * font, contact e-mail) comes from the core brand (Settings → Identity and Appearance, read with `ctx.api.brand()`),
 * so the kit always shows what the site really uses.
 *
 * Since 1.1.0 the kit can also be filled in through ordinary module settings, by a person (admin page) or by an
 * assistant (`maintenance_module_settings` / `maintenance_module_configure`):
 *   - texts: `about` (presentation), `tagline` (one line), `facts` (one per line), `contactName`;
 *   - `brandSource`: "site" (default, the core brand) or "own" (the values below);
 *   - own values (read only when `brandSource` is "own"): `ownColors` (one "Name #1B1A2E" per line), `ownHeadingFont`,
 *     `ownTextFont`, `ownLogoWide` / `ownLogoSquare` / `ownLogoWideDark` / `ownLogoSquareDark`.
 * Every value is checked again here (the core only checks images and choices): a bad line is ignored and the section
 * falls back to the site. Privacy: a visitor's browser loads nothing from a third party. Logos must be files uploaded to the
 * site (`/uploads/...`) and the texts never render remote images.
 */
const MAX_COLORS = 8;
const MAX_FACTS = 12;
const MAX_FONTS = 5;
const LOGO_KINDS = [["wide", "ownLogoWide"], ["square", "ownLogoSquare"], ["wideDark", "ownLogoWideDark"], ["squareDark", "ownLogoSquareDark"]];

/** Plain text of simple Markdown, for the descriptions to copy. */
const plain = (md) => md.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*_`>#]/g, "").replace(/\s+/g, " ").trim();
/** Markdown from a setting: remote or local images are replaced by their description, so the page never loads one from a third party. */
const noImages = (md) => md.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/!\[([^\]]*)\]\[[^\]]*\]/g, "$1");
const text = (v, max) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim().slice(0, max) : "");
/** Short plain label: no tags, no Markdown marks. */
const label = (v, max) => oneLine(v, max * 2).replace(/<[^>]*>/g, "").replace(/[`*_[\]<>]/g, "").slice(0, max).trim();
const oneLine = (v, max) => text(v, max * 2).replace(/\s+/g, " ").slice(0, max).trim();

/** "#abc" or "#aabbcc" (any case) becomes "#AABBCC"; anything else is null. */
function normalizeHex(value) {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value ?? "").trim());
    if (!m) return null;
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
    return `#${h.toUpperCase()}`;
}
/** Lines "Night blue #1B1A2E" (or just "#1B1A2E"); invalid lines are skipped, 8 colors at most. */
function parseColors(value) {
    const out = [];
    for (const line of text(value, 4000).split("\n")) {
        const m = /^(?:(.*?)[\s:,;=\-–—]*)?(#[0-9a-f]{3}(?:[0-9a-f]{3})?)$/i.exec(line.trim());
        const hex = m ? normalizeHex(m[2]) : null;
        if (!hex) continue;
        out.push({ name: label(m[1] ?? "", 40) || hex, hex });
        if (out.length === MAX_COLORS) break;
    }
    return out;
}
/** Font names separated by commas: letters, digits, spaces, dots, dashes only; 5 names at most. */
function parseFonts(value) {
    return oneLine(value, 300).split(",").map((n) => n.replace(/["']/g, "").trim()).filter((n) => /^[\p{L}\p{N} ._-]{1,60}$/u.test(n)).slice(0, MAX_FONTS);
}
/** Only a file uploaded to this site: "/uploads/..." without "..", query or scheme. Anything else is null (no third-party load). */
function ownLogoSrc(value) {
    const v = typeof value === "string" ? value.trim() : "";
    return /^\/uploads\/[A-Za-z0-9][A-Za-z0-9._\/-]{0,200}$/.test(v) && !v.includes("..") && !v.includes("//") ? v : null;
}
/** One fact per line (a leading dash or bullet is dropped). */
function parseFacts(value) {
    return noImages(text(value, 4000)).split("\n").map((l) => l.replace(/^\s*(?:[-*•]\s+)/, "").trim().slice(0, 200)).filter(Boolean).slice(0, MAX_FACTS);
}

export default ({
    async page(ctx) {
        const t = ctx.t;
        const brand = await ctx.api.brand(ctx.locale);
        const own = ctx.setting("brandSource") === "own";
        const about = noImages(text(ctx.setting("about"), 5000)) || brand.about || "";
        const tagline = oneLine(ctx.setting("tagline"), 300) || brand.tagline || "";
        const facts = parseFacts(ctx.setting("facts"));
        const contactName = label(ctx.setting("contactName"), 80);
        const blocks = [{ type: "markdown", text: t("intro", { name: brand.name }) }];
        if (about)
            blocks.push({ type: "heading", text: t("about") }, { type: "markdown", text: about });
        if (facts.length)
            blocks.push({ type: "heading", text: t("facts") }, { type: "markdown", text: facts.map((f) => `- ${f}`).join("\n") });
        const copies = [];
        if (tagline)
            copies.push({ type: "copy", label: t("short"), text: tagline });
        if (about)
            copies.push({ type: "copy", label: t("long"), text: plain(about) });
        blocks.push(...copies);
        // Logos: the site's, or the ones chosen here; an empty or invalid choice falls back to the site's.
        const ownLogos = own ? LOGO_KINDS.map(([kind, key]) => ({ kind, src: ownLogoSrc(ctx.setting(key)) })).filter((l) => l.src) : [];
        const logos = ownLogos.length ? ownLogos.map((l) => ({ src: l.src, label: t(`logo.${l.kind}`) }))
            : brand.logos?.length ? brand.logos.map((l) => ({ src: l.src, label: t(`logo.${l.kind}`) })) : brand.logo ? [{ src: brand.logo, label: t("logo") }] : [];
        if (logos.length)
            blocks.push({ type: "heading", text: t("visuals") }, { type: "downloads", items: logos });
        const ownColors = own ? parseColors(ctx.setting("ownColors")) : [];
        const colors = ownColors.length ? ownColors.map((c) => ({ name: c.name, hex: c.hex, role: undefined })) : brand.colors.map((c) => ({ name: c.name, hex: c.hex, role: c.role }));
        blocks.push({ type: "heading", text: t("colors") }, { type: "markdown", text: `*${t("colorsHelp")}*` }, { type: "swatches", items: colors });
        if (ctx.setting("showTypography") !== false) {
            const heading = own ? parseFonts(ctx.setting("ownHeadingFont")).join(", ") : "";
            const body = own ? parseFonts(ctx.setting("ownTextFont")).join(", ") : "";
            let md = `**${brand.font.name}** — \`${brand.font.stack}\``;
            if (heading && body && heading !== body)
                md = `- ${t("fontTitles")} — **${heading}**\n- ${t("fontText")} — **${body}**`;
            else if (heading || body)
                md = `**${heading || body}**`;
            blocks.push({ type: "heading", text: t("typography") }, { type: "markdown", text: md });
        }
        if (ctx.setting("showContact") !== false && (brand.contactEmail || contactName)) {
            const lines = [];
            if (contactName)
                lines.push(`**${contactName}**`);
            if (brand.contactEmail)
                lines.push(`[${brand.contactEmail}](mailto:${brand.contactEmail})`);
            blocks.push({ type: "heading", text: t("contact") }, { type: "markdown", text: lines.join("\n\n") });
        }
        return { title: t("title"), description: tagline || undefined, blocks };
    },
});
