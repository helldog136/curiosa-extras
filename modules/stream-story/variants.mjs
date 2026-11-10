// "My styles": saved variants of a style (a name, a base style among the twelve, optional colours and a font from a short safe list). Advanced configuration, made in the administration
// (a list with live search and an edit window) or by an AI assistant (three tools). The video studio has no control for it: a variant is simply one more card of the style step.
// ONE validation (`checkVariant` in pure.mjs, `saveVariant` in data.mjs) serves both ways in. Nothing here is ever read as HTML or CSS: colours are normalised to #rrggbb and the font is one of four words.
const v = new URL(import.meta.url).search; // the module version spreads to the neighbouring files (otherwise the old code would stay in cache after an update)
const P = await import(`./pure.mjs${v}`);
const S = await import(`./scenes.mjs${v}`);
const data = await import(`./data.mjs${v}`);
const src = await import(`./sources.mjs${v}`);

const expose = (message) => Object.assign(new Error(message), { expose: true });
const TAB = "styles";

/* ───────────── The administration: the "My styles" tab ───────────── */
const colorSummary = (item) => [...P.COLOR_KEYS.filter((k) => item.colors[k]).map((k) => item.colors[k]), ...(item.font !== "site" ? [item.font] : [])].join(", ");

/** The blocks of the tab: a sentence, the list (search, one thumbnail per row, Edit and Delete), the edit window when the address asks for it, and a one-click example while the list is empty. */
export async function blocks(ctx, query) {
  const items = await src.within(data.readVariants(ctx), src.timing.authMs, []);   // a storage that does not answer never blocks the page
  if (!items.length && ctx.setting("showVariants") !== true) return [];   // advanced mode only: nothing shows until the person turns the section on (or an assistant created a variant)
  const t = ctx.t, key = ctx.instance.key, out = [{ type: "markdown", text: t("vr_intro"), tab: TAB }];
  const editing = query?.editvar ? items.find((x) => x.id === query.editvar) : query?.newvar ? { id: "", name: "", base: "geometric", colors: {}, font: "site" } : null;
  if (editing) {
    const f = (name, label, value, example, extra = {}) => ({ name, label: t(label), kind: "text", value, example, ...extra });
    out.push({
      type: "adminForm", presentation: "dialog", action: "saveVariant", cancelHref: `?tab=${TAB}`, tab: TAB, title: t(editing.id ? "vr_edit" : "vr_new"), submitLabel: t("vr_save"),
      fields: [
        { name: "id", kind: "hidden", label: "id", value: editing.id },
        { name: "name", label: t("vr_f_name"), kind: "text", required: true, value: editing.name, example: t("vr_ex_name") },
        { name: "base", label: t("vr_f_base"), kind: "select", required: true, value: editing.base, options: P.STYLES.map((s) => ({ value: s, label: t(`ui_style_${s}`) })) },
        f("accent", "vr_f_accent", editing.colors.accent ?? "", "#ff8800", { folded: true, help: t("vr_h_colors") }),
        f("accent2", "vr_f_accent2", editing.colors.accent2 ?? "", "#2f6fed", { folded: true }),
        f("bg", "vr_f_bg", editing.colors.bg ?? "", "#101820", { folded: true }),
        f("fg", "vr_f_fg", editing.colors.fg ?? "", "#f5f5f5", { folded: true }),
        { name: "font", label: t("vr_f_font"), kind: "segmented", folded: true, value: editing.font, help: t("vr_h_font"), options: P.FONTS.map((x) => ({ value: x, label: t(`vr_font_${x}`) })) },
      ],
    });
  }
  out.push({ type: "links", tab: TAB, items: [{ label: t("vr_new_btn"), href: `?newvar=1&tab=${TAB}`, presentation: "dialog" }] });
  if (!items.length) out.push({ type: "adminForm", tab: TAB, action: "addExampleVariants", submitLabel: t("vr_example_btn"), title: t("vr_example_title"), fields: [{ name: "example", kind: "hidden", label: "example", value: "1" }] });
  out.push({
    type: "table", tab: TAB, columns: [t("vr_col_name"), t("vr_col_base"), t("vr_col_colors")], rowIds: items.map((x) => x.id), searchable: true, searchPlaceholder: t("vr_search"), truncate: [2], empty: t("vr_empty"),
    rows: items.map((x) => [{ text: x.name, image: { src: `/m/${key}/variant-thumb?id=${x.id}`, alt: t("vr_thumb_alt", { name: x.name }) } }, t(`ui_style_${x.base}`), colorSummary(x)]),
    rowActions: [
      { label: t("vr_edit_btn"), href: "?editvar={id}&tab=" + TAB, presentation: "dialog" },
      { label: t("vr_delete_btn"), action: "removeVariant", danger: true, confirm: t("vr_confirm_delete") },
    ],
  });
  return out;
}

const fieldMessage = (ctx, code) => ctx.t(`vr_err_${code}`);
const adjustedText = (ctx, site, item) => {
  const keys = S.adjustedColors(site, item);
  return keys.length ? ` ${ctx.t("vr_adjusted", { names: keys.map((k) => ctx.t(`vr_f_${k}`)).join(", ") })}` : "";
};
/** The actions of the tab. `site`: the site colours (to tell what had to be adjusted). */
export const actions = (siteOf) => ({
  async saveVariant(ctx, values) {
    const id = String(values.id ?? "");
    const r = await data.saveVariant(ctx, { name: values.name, base: values.base, accent: values.accent ?? "", accent2: values.accent2 ?? "", bg: values.bg ?? "", fg: values.fg ?? "", font: values.font ?? "" }, id);
    if (r.errors) return { errors: Object.fromEntries(Object.entries(r.errors).map(([f, c]) => [f, fieldMessage(ctx, c)])) };
    if (r.error) return { error: ctx.t(r.error === "full" ? "vr_err_full" : "vr_err_missing", { max: P.LIMITS.variants }) };
    return { ok: ctx.t("vr_saved", { name: r.item.name }) + adjustedText(ctx, siteOf(ctx), r.item) };
  },
  async removeVariant(ctx, values) {
    const r = await data.removeVariant(ctx, String(values.id ?? ""));
    return r.error ? { error: ctx.t("vr_err_missing") } : { ok: ctx.t("vr_removed") };
  },
  /** The same style on three different backgrounds, so the idea is clear at once. */
  async addExampleVariants(ctx) {
    let n = 0;
    for (const [name, bg] of [[ctx.t("vr_ex_a"), "#0b1020"], [ctx.t("vr_ex_b"), "#f5efe3"], [ctx.t("vr_ex_c"), "#1f3d2b"]]) { const r = await data.saveVariant(ctx, { name, base: "geometric", bg }); if (r.ok) n++; }
    return n ? { ok: ctx.t("vr_example_done", { n }) } : { error: ctx.t("vr_err_full", { max: P.LIMITS.variants }) };
  },
});

/* ───────────── The row thumbnail: the colours the variant really gives (an image, no script) ───────────── */
/** A small picture of the palette of a variant: its ground, its two accents and its text colour, in its font. The real animation is on the cards of the style step. */
export function thumbSvg(variant, site) {
  const pal = S.paletteFor(variant.base, P.mergeColors(site, variant)), fam = P.FONT_STACKS[variant.font] || P.FONT_STACKS.sans;
  const hex = (c) => (/^#[0-9a-f]{6}$/i.test(c) ? c : "#808080");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" width="80" height="80"><rect width="80" height="80" fill="${hex(pal.base)}"/><rect x="10" y="12" width="44" height="9" rx="2" fill="${hex(pal.accent)}"/><rect x="10" y="26" width="28" height="6" rx="2" fill="${hex(pal.accent2)}"/><text x="10" y="64" font-size="28" font-weight="700" font-family="${fam.replace(/"/g, "'")}" fill="${hex(pal.text)}">Aa</text></svg>`;
}

/* ───────────── The tools of the AI: list, create, change (never delete) ───────────── */
const view = (x) => ({ id: x.id, name: x.name, style: x.base, accent: x.colors.accent ?? null, accent2: x.colors.accent2 ?? null, background: x.colors.bg ?? null, text: x.colors.fg ?? null, font: x.font });
const toRaw = (a) => ({ name: a.name, base: a.style, accent: a.accent, accent2: a.accent2, bg: a.background, fg: a.text, font: a.font });
const NAMES = { name: "name", base: "style", accent: "accent", accent2: "accent2", bg: "background", fg: "text", font: "font" };
function refuse(errors) {
  const say = { name: "must be a short name (40 characters at most) not already used by another variant", base: `must be one of: ${P.STYLES.join(", ")}`, hex: "must be a colour like #ff8800 or #f80 (an empty text removes it)", font: `must be one of: ${P.FONTS.join(", ")}` };
  throw expose(Object.entries(errors).map(([f, c]) => (c === "exists" ? "'name' is already used by another variant." : `'${NAMES[f]}' ${say[c === "hex" ? "hex" : f]}.`)).join(" "));
}
const adjustedNames = (site, item) => S.adjustedColors(site, item).map((k) => NAMES[k]);
export const tools = (siteOf) => ({
  async style_variants_list(ctx) { return { variants: (await data.readVariants(ctx)).map(view), maximum: P.LIMITS.variants }; },
  async style_variant_create(ctx, args = {}) {
    const r = await data.saveVariant(ctx, toRaw(args));
    if (r.errors) refuse(r.errors);
    if (r.error) throw expose(`You can keep at most ${P.LIMITS.variants} style variants: ask the owner to delete one in the administration.`);
    return { created: true, id: r.item.id, name: r.item.name, adjusted: adjustedNames(siteOf(ctx), r.item) };
  },
  async style_variant_update(ctx, args = {}) {
    const ref = String(args.variant ?? "").trim().toLowerCase(), all = await data.readVariants(ctx);
    const cur = all.find((x) => x.id === ref || x.name.toLowerCase() === ref);
    if (!cur) throw expose(`No style variant named '${P.oneLine(args.variant, 60)}'. Call style_variants_list to list them.`);
    const raw = toRaw({ ...args, name: args.newName });
    if (!Object.values(raw).some((x) => x !== undefined)) throw expose("Nothing to change: give a new name, a style, a colour or a font.");
    const r = await data.saveVariant(ctx, raw, cur.id);
    if (r.errors) refuse(r.errors);
    return { updated: true, id: cur.id, name: r.item.name, adjusted: adjustedNames(siteOf(ctx), r.item) };
  },
});
