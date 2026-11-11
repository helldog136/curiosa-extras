// "My styles" (Announcement story 2.12.0): saved variants of a style (a name, a base style, optional colours, a font from a short safe list), made in the administration or by an AI
// assistant with ONE validation, shown as cards in the style step, remembered by models and by the default style, and falling back to the base style when deleted.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { fakeCanvasContext, fakeImage } from "./helpers/fakeCanvas.mjs";
import { assertAdminPageErgonomics } from "./helpers/ergonomics.mjs";

const DIR = new URL("../modules/stream-story", import.meta.url).pathname;
const read = (f) => fs.readFileSync(`${DIR}/${f}`, "utf8");
const manifest = JSON.parse(read("module.json")), fr = JSON.parse(read("locales/fr.json")), en = JSON.parse(read("locales/en.json"));
const def = (await import("../modules/stream-story/index.mjs")).default;
const P = await import("../modules/stream-story/pure.mjs");
const S = await import("../modules/stream-story/scenes.mjs");
const data = await import("../modules/stream-story/data.mjs");
const tools = await import("../modules/stream-story/mcp.mjs");

const SITE = "https://site.example.test";
const THEME = { accent: "#7c5cff", accentFg: "#ffffff", bg: "#101018", fg: "#f2f2f2", accent2: "#ff4d8d", font: "Inter, sans-serif" };
const SITE_COLORS = { accent: "#7c5cff", accent2: "#ff4d8d", bg: "#101018", fg: "#f2f2f2" };
const mk = ({ locale = "fr", settings = {} } = {}) => fakeCtx({
  key: "story", moduleId: "stream-story", locale, messages: { ...(locale === "en" ? en : fr) }, permissions: manifest.permissions, siteUrl: SITE, settings, topics: { "planning.slot": () => [] },
  instances: [{ id: "id-story", key: "story", module: "stream-story", basePath: "", name: "Story", adminPath: "/admin/instances/id-story" }], theme: THEME,
});
const run = (sc, t) => { const c = fakeCanvasContext(); sc.draw(c, t); return c.log; };
const members = ["Alice", "Bob le Bricoleur", "Carl"].map((name, i) => ({ login: `chaine_${i}`, name }));
function scene({ style, format = "vertical", colors = SITE_COLORS, font }) {
  const content = P.buildContent({ ...P.DEFAULT_CONFIG, elements: P.ELEMENTS, style, format, text: "Venez nombreux !", costreamers: members.map((m) => m.login) }, { stream: { title: "Grande soirée découverte", startMs: Date.parse("2026-10-22T17:30:00Z"), allDay: false, games: ["Hades"], timezone: "Europe/Brussels" }, coStreamers: members, site: { name: "Emma" }, nowMs: Date.parse("2026-10-22T10:00:00Z"), tz: "Europe/Brussels" });
  return S.createScene({ style, format, duration: 15, content, assets: { logo: fakeImage(200, 200), cover: fakeImage(600, 338), avatars: {} }, colors, font, measureContext: fakeCanvasContext() });
}

test("validation: colours of 3 or 6 digits are normalised, the style and the font come from white lists, the name is one bounded line; a partial change only touches what is given", () => {
  const ok = P.checkVariant({ name: "  Soft   night ", base: "epic", accent: "F80", accent2: "#2F6FED", font: "serif" });
  assert.deepEqual([ok.ok, ok.value], [true, { name: "Soft night", base: "epic", colors: { accent: "#ff8800", accent2: "#2f6fed" }, font: "serif" }]);
  const bad = P.checkVariant({ name: "", base: "disco", accent: "red", bg: "#12345", fg: "url(x)", font: "comic" });
  assert.deepEqual(bad.errors, { name: "name", base: "base", accent: "hex", bg: "hex", fg: "hex", font: "font" });
  for (const x of ["#ff880", "#gg0000", "ff88001", "rgb(1,2,3)", "javascript:1", "#ff8800;x", "<b>"]) assert.equal(P.cleanHex(x), "", x);
  assert.equal(P.checkVariant({ name: "x".repeat(200), base: "neon" }).value.name.length, P.LIMITS.variantName);
  const cur = ok.value, part = P.checkVariant({ accent: "", bg: "#000" }, cur);
  assert.deepEqual(part.value, { ...cur, colors: { accent2: "#2f6fed", bg: "#000000" } }, "an empty colour is removed, the others stay");
  assert.equal(P.checkVariant({}, cur).ok, true); assert.deepEqual(P.checkVariant({}, cur).value, cur);
  assert.deepEqual(Object.keys(P.FONT_STACKS), P.FONTS); assert.equal(P.fontFamilyOf("nope", "X, serif"), "X, serif"); assert.equal(P.fontFamilyOf("mono", "X"), P.FONT_STACKS.mono);
  assert.ok(Object.values(P.FONT_STACKS).every((f) => !/[;{}<>]/.test(f)), "a font stack is never CSS");
});

test("storage: stored items are made safe when read (bad ones dropped, at most 30), config keeps the variant identifier only when it has the right shape", () => {
  const items = [{ id: "0123456789abcdef", name: "A", base: "neon", colors: { accent: "#fff", junk: "x" }, font: "mono", extra: 1 }, { id: "nope", name: "B", base: "neon" }, { id: "0123456789abcdef", name: "dup", base: "neon" }, { id: "fedcba9876543210", name: "C", base: "zzz" }];
  assert.deepEqual(P.cleanVariants(items), [{ id: "0123456789abcdef", name: "A", base: "neon", colors: { accent: "#ffffff" }, font: "mono" }]);
  const many = Array.from({ length: 40 }, (_, i) => ({ id: i.toString(16).padStart(16, "0"), name: `n${i}`, base: "neon" }));
  assert.equal(P.cleanVariants(many).length, 30);
  assert.equal(P.cleanConfig({ variant: "0123456789abcdef" }).variant, "0123456789abcdef");
  for (const bad of ["x", 3, null, "0123456789ABCDEF", "0123456789abcdef0"]) assert.equal(P.cleanConfig({ variant: bad }).variant, "", String(bad));
  assert.equal(P.cleanConfig({}).variant, ""); assert.equal(P.cleanConfig({}, { ...P.DEFAULT_CONFIG, variant: "0123456789abcdef" }).variant, "0123456789abcdef");
});

test("data: create, partial change, duplicate name, unknown id, the limit of 30; deleting keeps models and the default usable (they fall back to the base style)", async () => {
  const ctx = mk();
  const a = await data.saveVariant(ctx, { name: "Night", base: "geometric", bg: "#0b1020" });
  assert.equal(a.ok, true); assert.match(a.item.id, /^[a-f0-9]{16}$/);
  assert.deepEqual((await data.saveVariant(ctx, { name: "night", base: "neon" })).errors, { name: "exists" }, "names are unique, whatever the case");
  assert.deepEqual((await data.saveVariant(ctx, { accent: "#123456" }, "ffffffffffffffff")), { error: "missing" });
  const b = await data.saveVariant(ctx, { accent: "#123" }, a.item.id);
  assert.deepEqual([b.item.name, b.item.base, b.item.colors], ["Night", "geometric", { bg: "#0b1020", accent: "#112233" }], "only the given key changed");
  assert.equal((await data.saveVariant(ctx, { name: "Night" }, a.item.id)).ok, true, "keeping its own name is fine");
  for (let i = 0; i < 29; i++) assert.equal((await data.saveVariant(ctx, { name: `V${i}`, base: "neon" })).ok, true);
  assert.deepEqual(await data.saveVariant(ctx, { name: "one more", base: "neon" }), { error: "full" });
  // models and default
  await data.saveModel(ctx, { name: "Mine", config: { ...P.DEFAULT_CONFIG, style: "geometric", variant: a.item.id } });
  assert.equal((await data.readModels(ctx))[0].config.variant, a.item.id, "a model remembers the variant");
  assert.deepEqual(await data.setStylePref(ctx, "geometric", a.item.id), { defaultStyle: "geometric", defaultVariant: a.item.id });
  assert.equal(await data.readVariantPref(ctx), a.item.id);
  assert.deepEqual(await data.setStylePref(ctx, "neon", a.item.id), { defaultStyle: "neon", defaultVariant: "" }, "a variant on another base style is not kept");
  await data.setStylePref(ctx, "geometric", a.item.id);
  assert.deepEqual(await data.removeVariant(ctx, "ffffffffffffffff"), { error: "missing" });
  assert.equal((await data.removeVariant(ctx, a.item.id)).ok, true);
  assert.equal((await data.readModels(ctx))[0].config.variant, a.item.id, "the model is untouched");
  assert.equal(await data.readVariantPref(ctx), "", "the default no longer finds it: no error, no variant");
  assert.equal((await data.readVariants(ctx)).length, 29);
  assert.equal((await data.watermarkDefault(ctx)), false, "the other preferences are kept");
});

test("colours: every style x 2 formats x hostile combinations keeps text at 4.5:1 or more on its own ground, never throws, and the layout is the one of the site colours", () => {
  const hostile = [
    { accent: "#ffffff", accent2: "#ffffff", bg: "#ffffff", fg: "#ffffff" }, { accent: "#000000", accent2: "#000000", bg: "#000000", fg: "#000000" },
    { accent: "#808080", accent2: "#808080", bg: "#777777", fg: "#808080" }, { accent: "#101018", accent2: "#101018", bg: "#101018", fg: "#101018" },
    { accent: "#ffe27a", accent2: "#ffd1e8", bg: "#ffffff", fg: "#fefefe" }, { accent: "#ff0000", accent2: "#00ff00", bg: "#0000ff", fg: "#ff00ff" },
  ];
  for (const style of P.STYLES) for (const format of ["vertical", "passeport"]) for (const custom of hostile) {
    const merged = P.mergeColors(SITE_COLORS, { base: style, colors: custom }), pal = S.paletteFor(style, merged);
    for (const k of ["text", "accent", "soft"]) assert.ok(P.contrast(pal[k], pal.base) >= 4.5 - 0.01, `${style} ${k} ${JSON.stringify(custom)}: ${P.contrast(pal[k], pal.base).toFixed(2)}`);
    const sc = scene({ style, format, colors: merged, font: P.fontFamilyOf("serif", "Inter") }), plain = scene({ style, format });
    assert.doesNotThrow(() => { for (const t of [0, 3, 9, 15]) run(sc, t); });
    assert.deepEqual(sc.boxes, plain.boxes, `${style}/${format}: colours never move anything`);
    assert.ok(!JSON.stringify(run(sc, sc.restTime)).includes("NaN"));
  }
});

test("colours: only the colours a style reads are applied; the drawing is a function of time with a variant; the font reaches the text through the white list only", () => {
  assert.deepEqual(P.colorsOf("minimal"), ["accent", "bg", "fg"]); assert.deepEqual(P.colorsOf("neon"), ["accent", "accent2"]); assert.deepEqual(P.colorsOf("geometric"), ["accent", "accent2", "bg"]);
  assert.deepEqual(P.mergeColors(SITE_COLORS, { base: "neon", colors: { bg: "#ffffff", accent: "#ff8800" } }), { ...SITE_COLORS, accent: "#ff8800" }, "neon does not read the background");
  assert.deepEqual(P.mergeColors(SITE_COLORS, null), SITE_COLORS);
  const v = { base: "arena", colors: { accent: "#ff8800", accent2: "#2f6fed" }, font: "mono" };
  const a = scene({ style: "arena", colors: P.mergeColors(SITE_COLORS, v), font: P.fontFamilyOf(v.font, "Inter") }), b = scene({ style: "arena", colors: P.mergeColors(SITE_COLORS, v), font: P.fontFamilyOf(v.font, "Inter") });
  for (const t of [0, 1.7, 6, 15]) assert.deepEqual(run(a, t), run(b, t));
  assert.notDeepEqual(run(a, 9), run(scene({ style: "arena" }), 9), "the colours change the picture");
  assert.ok(run(a, 15).filter((e) => e[0] === "fillText").every((e) => !/;|\}|</.test(e[4])), "no CSS in a font");
  assert.deepEqual(S.adjustedColors(SITE_COLORS, { base: "neon", colors: { accent: "#101010" } }), ["accent"], "a colour too dark for its ground is reported");
  assert.deepEqual(S.adjustedColors(SITE_COLORS, { base: "neon", colors: { accent: "#ffb000" } }), []);
  assert.deepEqual(S.adjustedColors(SITE_COLORS, { base: "neon", colors: {} }), []);
});

test("administration: hidden until turned on (advanced setting) or a variant exists; then a sentence, a list with search, thumbnails, Edit in a window, a named delete that says what is lost, the example in one click", async () => {
  const ctx = mk();
  assert.deepEqual(await def.adminPanel(ctx, { query: { tab: "styles" } }).then((b) => b.filter((x) => x.tab === "styles")), [], "nothing in the simple admin");
  const on = mk({ settings: { showVariants: true } });
  let blocks = (await def.adminPanel(on, { query: {} })).filter((b) => b.tab === "styles");
  assert.ok(blocks[0].type === "markdown" && blocks[0].text === fr.vr_intro, "R1: one sentence");
  const table = blocks.find((b) => b.type === "table");
  assert.deepEqual([table.searchable, table.rows.length, table.empty], [true, 0, fr.vr_empty], "live search from the start, an empty state that says what to do");
  const example = blocks.find((b) => b.type === "adminForm");
  assert.deepEqual([example.action, example.submitLabel], ["addExampleVariants", fr.vr_example_btn], "one click adds the example");
  assert.equal(blocks.find((b) => b.type === "links").items[0].presentation, "dialog");
  assert.match(manifest.tabs.find((t) => t.id === "styles").label.fr, /Mes styles/); assert.equal(manifest.tabs.find((t) => t.id === "styles").panel, true);
  // one click: three backgrounds
  assert.match((await def.adminActions.addExampleVariants(on, {})).ok, /3/);
  blocks = (await def.adminPanel(on, { query: {} })).filter((b) => b.tab === "styles");
  const t2 = blocks.find((b) => b.type === "table");
  assert.equal(t2.rows.length, 3); assert.equal(blocks.some((b) => b.type === "adminForm"), false, "no example button once the list has rows");
  assert.deepEqual(t2.columns, [fr.vr_col_name, fr.vr_col_base, fr.vr_col_colors]);
  const cell = t2.rows[0][0]; assert.match(cell.image.src, /^\/m\/story\/variant-thumb\?id=[a-f0-9]{16}$/); assert.ok(cell.image.alt.length > 3);
  assert.deepEqual(t2.rows.map((r) => r[1]), [fr.ui_style_geometric, fr.ui_style_geometric, fr.ui_style_geometric]);
  assert.equal(t2.rowActions.length, 2); assert.equal(t2.rowActions[0].presentation, "dialog"); assert.equal(t2.rowActions[1].danger, true); assert.equal(t2.rowActions[1].confirm, fr.vr_confirm_delete);
  assert.match(fr.vr_confirm_delete, /reviennent au style de départ/);
  // the edit window
  const id = t2.rowIds[0];
  const dlg = (await def.adminPanel(on, { query: { editvar: id } })).find((b) => b.type === "adminForm" && b.presentation === "dialog");
  assert.equal(dlg.cancelHref, "?tab=styles"); assert.equal(dlg.submitLabel, fr.vr_save);
  const visible = dlg.fields.filter((f) => f.kind !== "hidden" && !f.folded); assert.deepEqual(visible.map((f) => f.name), ["name", "base"], "two fields on the short path");
  assert.deepEqual(dlg.fields.filter((f) => f.folded).map((f) => f.name), ["accent", "accent2", "bg", "fg", "font"], "colours and font are under « More options »");
  assert.equal(dlg.fields.find((f) => f.name === "base").options.length, 14);
  assert.ok(dlg.fields.filter((f) => f.kind === "text").every((f) => f.example), "every free field has an example");
  assert.deepEqual(dlg.fields.find((f) => f.name === "font").options.map((o) => o.value), P.FONTS);
  const fresh = (await def.adminPanel(on, { query: { newvar: "1" } })).find((b) => b.type === "adminForm" && b.presentation === "dialog");
  assert.equal(fresh.title, fr.vr_new);
  // the kit's rules for an administration page
  assertAdminPageErgonomics(await def.adminPanel(on, { query: {} }), { moduleId: "stream-story", skip: [] });
  assertAdminPageErgonomics(await def.adminPanel(on, { query: { editvar: id } }), { moduleId: "stream-story", skip: [] });
  // search covers the names; the English page uses the English words
  const enBlocks = (await def.adminPanel(mk({ locale: "en", settings: { showVariants: true } }), { query: {} })).filter((b) => b.tab === "styles");
  assert.equal(enBlocks.find((b) => b.type === "table").columns[1], en.vr_col_base);
});

test("administration actions: a field error stays under its field with an example, a saved style says what was adjusted, delete names the style, nothing unsafe is stored", async () => {
  const ctx = mk({ settings: { showVariants: true } });
  const bad = await def.adminActions.saveVariant(ctx, { id: "", name: "", base: "neon", accent: "red", bg: "#12", fg: "", font: "" });
  assert.deepEqual(Object.keys(bad.errors).sort(), ["accent", "bg", "name"]);
  assert.equal(bad.errors.accent, fr.vr_err_hex); assert.match(bad.errors.accent, /#ff8800/); assert.equal(bad.errors.name, fr.vr_err_name);
  assert.equal((await data.readVariants(ctx)).length, 0, "nothing was written");
  const ok = await def.adminActions.saveVariant(ctx, { id: "", name: "Dark gold", base: "neon", accent: "#101010", accent2: "", bg: "", fg: "", font: "serif" });
  assert.match(ok.ok, /Dark gold/); assert.match(ok.ok, /Couleur ajustée pour rester lisible/, "said near the form: the colour was adjusted");
  const [item] = await data.readVariants(ctx);
  assert.deepEqual([item.colors, item.font], [{ accent: "#101010" }, "serif"], "what was typed is kept, the drawing corrects it");
  const dup = await def.adminActions.saveVariant(ctx, { id: "", name: "dark GOLD", base: "poster" });
  assert.equal(dup.errors.name, fr.vr_err_exists);
  const edit = await def.adminActions.saveVariant(ctx, { id: item.id, name: "Dark gold", base: "neon", accent: "#ffb000", accent2: "", bg: "", fg: "", font: "serif" });
  assert.ok(!/ajustée/.test(edit.ok), "a readable colour is not reported");
  assert.deepEqual((await def.adminActions.saveVariant(ctx, { id: "ffffffffffffffff", name: "x", base: "neon" })).error, fr.vr_err_missing);
  for (let i = 0; i < 29; i++) await data.saveVariant(ctx, { name: `V${i}`, base: "neon" });
  assert.match((await def.adminActions.saveVariant(ctx, { id: "", name: "full", base: "neon" })).error, /30/);
  assert.equal((await def.adminActions.removeVariant(ctx, { id: item.id })).ok, fr.vr_removed);
  assert.equal((await def.adminActions.removeVariant(ctx, { id: item.id })).error, fr.vr_err_missing);
});

test("row thumbnail: an SVG made only of validated colours (no text from the person, no script), 404 for an unknown or malformed identifier", async () => {
  const ctx = mk(); const r = await data.saveVariant(ctx, { name: "<script>alert(1)</script>", base: "arena", accent: "#ff8800", font: "mono" });
  const get = (id) => def.routes["variant-thumb"](new Request(`${SITE}/m/story/variant-thumb?id=${id}`), ctx);
  const res = await get(r.item.id), svg = await res.text();
  assert.equal(res.status, 200); assert.match(res.headers.get("content-type"), /^image\/svg\+xml/); assert.match(res.headers.get("content-security-policy"), /default-src 'none'/); assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.ok(!/<script|alert|onload/i.test(svg)); assert.ok(svg.startsWith("<svg") && /#[0-9a-f]{6}/.test(svg));
  for (const bad of ["", "x", "ffffffffffffffff", "../../etc"]) assert.equal((await get(bad)).status, 404, bad);
  assert.equal((await def.routes["variant-thumb"](new Request(`${SITE}/m/story/variant-thumb?id=${r.item.id}`, { method: "POST" }), ctx)).status, 405);
});

test("AI tools: list reads, create and change write (never granted by default, never delete), the same validation as the administration, adjusted colours reported, limit of 30, French texts", async () => {
  const byName = Object.fromEntries(manifest.mcp.map((t) => [t.name, t]));
  assert.deepEqual([byName.style_variants_list.readOnly, byName.style_variants_list.default !== false], [true, true]);
  for (const n of ["style_variant_create", "style_variant_update"]) { assert.equal(byName[n].default, false); assert.ok(!byName[n].readOnly && !byName[n].destructive); assert.ok(byName[n].description.length <= 1000 && /cannot delete/.test(byName[n].description)); assert.ok(manifest.i18n.fr[`mcp.${n}`].length > 40, "French text"); }
  assert.ok(!Object.keys(byName).some((n) => /delete|remove/.test(n)), "no deletion by the AI");
  assert.deepEqual(byName.style_variant_create.input.properties.style.enum, P.STYLES); assert.deepEqual(byName.style_variant_create.input.properties.font.enum, P.FONTS);
  assert.deepEqual(Object.keys(def.mcp).sort(), Object.keys(byName).sort());
  const ctx = mk();
  const empty = await def.mcp.style_variants_list(ctx); assert.deepEqual(empty, { variants: [], maximum: 30 });
  const made = await def.mcp.style_variant_create(ctx, { name: "Dark neon", style: "neon", accent: "#101010", background: "#fff" });
  assert.equal(made.created, true); assert.deepEqual(made.adjusted, ["accent"], "the answer says what was adjusted");
  const [one] = (await def.mcp.style_variants_list(ctx)).variants; assert.deepEqual([one.name, one.style, one.accent, one.background, one.font], ["Dark neon", "neon", "#101010", "#ffffff", "site"]);
  assert.deepEqual((await data.readVariants(ctx))[0].colors, { accent: "#101010", bg: "#ffffff" }, "same storage as the administration");
  // refusals: clear messages, no trace, nothing written
  for (const [args, re] of [[{ name: "x", style: "disco" }, /'style' must be one of/], [{ name: "", style: "neon" }, /'name'/], [{ name: "y", style: "neon", accent: "red" }, /'accent' must be a colour/], [{ name: "dark neon", style: "poster" }, /already used/], [{ name: "z", style: "neon", font: "comic" }, /'font' must be one of/]]) {
    await assert.rejects(def.mcp.style_variant_create(ctx, args), (e) => e.expose === true && re.test(e.message) && !/\bat \w+ \(|node:|\/home\//.test(e.message), JSON.stringify(args));
  }
  assert.equal((await data.readVariants(ctx)).length, 1);
  // partial change, by name or by identifier
  const up = await def.mcp.style_variant_update(ctx, { variant: "DARK NEON", accent: "#ffb000" });
  assert.deepEqual([up.updated, up.adjusted], [true, []]);
  const after = (await data.readVariants(ctx))[0]; assert.deepEqual([after.name, after.base, after.colors, after.font], ["Dark neon", "neon", { accent: "#ffb000", bg: "#ffffff" }, "site"], "only the given field changed");
  await def.mcp.style_variant_update(ctx, { variant: after.id, newName: "Gold neon", background: "", font: "mono", style: "arena" });
  const last = (await data.readVariants(ctx))[0]; assert.deepEqual([last.name, last.base, last.colors, last.font], ["Gold neon", "arena", { accent: "#ffb000" }, "mono"]);
  await assert.rejects(def.mcp.style_variant_update(ctx, { variant: "nobody", accent: "#fff" }), /No style variant named 'nobody'/);
  await assert.rejects(def.mcp.style_variant_update(ctx, { variant: "Gold neon" }), /Nothing to change/);
  await assert.rejects(def.mcp.style_variant_update(ctx, { variant: "Gold neon", accent: "nope" }), /'accent' must be a colour/);
  assert.equal((await data.readVariants(ctx))[0].colors.accent, "#ffb000", "a refused change leaves the variant as it was");
  // a model that uses it keeps working after a change
  await data.saveModel(ctx, { name: "M", config: { ...P.DEFAULT_CONFIG, style: "arena", variant: last.id } });
  await def.mcp.style_variant_update(ctx, { variant: last.id, accent: "#00aa55" });
  assert.equal((await data.readModels(ctx))[0].config.variant, last.id);
  // the limit
  for (let i = 0; i < 29; i++) await def.mcp.style_variant_create(ctx, { name: `Auto ${i}`, style: "neon" });
  await assert.rejects(def.mcp.style_variant_create(ctx, { name: "Too many", style: "neon" }), /at most 30/);
});

test("AI preparation: story_prepare picks a variant by name or identifier (its base style becomes the style), refuses an unknown one or a clashing style, uses the default variant when nothing else is said, and never creates one", async () => {
  const ctx = mk(); const v = (await data.saveVariant(ctx, { name: "Night", base: "geometric", bg: "#0b1020" })).item;
  const prep = async (args) => { const r = await def.mcp.story_prepare(ctx, args); return { r, p: await data.readPrep(ctx, /prep=([A-Za-z0-9_-]{22})/.exec(r.link)[1]) }; };
  let { r, p } = await prep({ variant: "night" });
  assert.deepEqual([p.config.style, p.config.variant, r.prepared.style, r.prepared.variant], ["geometric", v.id, "geometric", "Night"]);
  ({ p } = await prep({ variant: v.id, style: "geometric" })); assert.equal(p.config.variant, v.id);
  await assert.rejects(def.mcp.story_prepare(ctx, { variant: "nobody" }), /No style variant named 'nobody'/);
  await assert.rejects(def.mcp.story_prepare(ctx, { variant: v.id, style: "neon" }), /based on the style 'geometric'/);
  await assert.rejects(def.mcp.story_prepare(ctx, { variant: 3 }), /'variant' must be/);
  ({ r, p } = await prep({ style: "poster" })); assert.deepEqual([p.config.variant, "variant" in r.prepared], ["", false], "no variant unless asked");
  await data.setStylePref(ctx, "geometric", v.id);
  ({ p } = await prep({})); assert.deepEqual([p.config.style, p.config.variant], ["geometric", v.id], "the default variant, when nothing else is said");
  ({ p } = await prep({ style: "neon" })); assert.equal(p.config.variant, "", "an explicit other style drops it");
  assert.equal((await data.readVariants(ctx)).length, 1, "story_prepare creates nothing");
  const plain = tools.strictPrepare({ model: "M" }, { models: [{ name: "M", config: { ...P.DEFAULT_CONFIG, style: "arena", variant: v.id } }], tz: "UTC", variants: [], variantDefault: v.id });
  assert.equal(plain.config.variant, v.id, "a model keeps the variant it stored (deleted later: the studio falls back to the base style)");
});

test("studio data: /data sends the variants and the default variant; the default button remembers the variant with the style; prefs refuse bad values", async () => {
  const ctx = mk(), token = await data.mintToken(ctx);
  const call = (route, opts = {}) => def.routes[route](new Request(`${SITE}/m/story/${route}`, { method: opts.method ?? "GET", headers: { "x-story-token": token, ...(opts.body ? { "content-type": "application/json" } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined }), ctx).then(async (r) => ({ status: r.status, ...(await r.json()) }));
  const v = (await data.saveVariant(ctx, { name: "Night", base: "geometric", bg: "#0b1020" })).item;
  let r = await call("data"); assert.deepEqual(r.variants, [v]); assert.equal(r.defaults.defaultVariant, "");
  r = await call("act", { method: "POST", body: { op: "prefs.style", style: "geometric", variant: v.id } }); assert.deepEqual([r.defaultStyle, r.defaultVariant], ["geometric", v.id]);
  assert.equal((await call("data")).defaults.defaultVariant, v.id);
  r = await call("act", { method: "POST", body: { op: "prefs.style", style: "neon", variant: v.id } }); assert.equal(r.defaultVariant, "", "a variant of another style is not remembered");
  r = await call("act", { method: "POST", body: { op: "prefs.style", style: "geometric", variant: "zzz" } }); assert.equal(r.defaultVariant, "");
  assert.equal((await call("act", { method: "POST", body: { op: "prefs.style", style: "nope", variant: v.id } })).status, 400);
});

test("backup: the variants are in the readable backup; the privacy text and the README mention them", async () => {
  const ctx = mk(); await data.saveVariant(ctx, { name: "Night", base: "geometric", bg: "#0b1020" });
  const files = await def.backup.readable(ctx), f = files.find((x) => x.path === "style-variants.json");
  assert.ok(f); assert.equal(JSON.parse(f.content)[0].name, "Night");
  assert.match(read("README.md"), /My styles/); assert.match(manifest.privacy.en, /style variants/); assert.match(manifest.privacy.fr, /variantes de style/);
});

/* ───────────── "Show the day with the time" (2.13.0) ───────────── */
test("show the day: the setting is the default, a video's own true/false wins, an all-day event keeps its day, every style x 2 formats renders the time alone inside the safe area", () => {
  const stream = { title: "Soirée", startMs: Date.parse("2026-10-22T17:30:00Z"), allDay: false, games: [], timezone: "Europe/Brussels" };
  const cfg = { ...P.DEFAULT_CONFIG, elements: P.ELEMENTS };
  const build = (config, over = {}, s = stream) => P.buildContent(config, { stream: s, site: {}, nowMs: Date.parse("2026-10-22T10:00:00Z"), tz: "Europe/Brussels", ...over });
  assert.ok(build(cfg).dayLine && build(cfg).timeLine, "default: the day and the time, as before");
  assert.deepEqual([build(cfg, { showDayDefault: false }).dayLine, !!build(cfg, { showDayDefault: false }).timeLine], ["", true], "the setting off: the time alone");
  assert.ok(build({ ...cfg, showDay: true }, { showDayDefault: false }).dayLine, "a video that says true wins over the setting");
  assert.equal(build({ ...cfg, showDay: false }, { showDayDefault: true }).dayLine, "", "a video that says false wins over the setting");
  const allDay = { ...stream, allDay: true }; assert.ok(build(cfg, { showDayDefault: false }, allDay).dayLine, "an all-day event has no time: its day stays, never an empty block");
  assert.deepEqual(Object.keys(P.cleanConfig({})).includes("showDay"), false, "nothing stored means follow the setting"); assert.equal(P.cleanConfig({ showDay: false }).showDay, false); assert.equal(P.cleanConfig({ showDay: "no" }).showDay, undefined);
  for (const style of P.STYLES) for (const format of ["vertical", "passeport"]) {
    const A = P.safeArea(format), mkScene = (showDayDefault) => S.createScene({ style, format, duration: 15, content: build({ ...cfg, style, format, text: "Venez !" }, { showDayDefault }), assets: { logo: null, cover: null, avatars: {} }, colors: SITE_COLORS, measureContext: fakeCanvasContext() });
    const on = mkScene(true), off = mkScene(false), texts = (sc) => [run(sc, sc.restTime).filter((e) => e[0] === "fillText").map((e) => String(e[1]).toLowerCase()).join("")];   // several styles draw glyph by glyph: the whole text is joined
    assert.ok(texts(on).some((x) => /jeudi/.test(x)), `${style}: the day is drawn by default`);
    assert.ok(!texts(off).some((x) => /jeudi|octobre/.test(x)), `${style}/${format}: no day when off`);
    assert.ok(texts(off).some((x) => /19 ?h ?30|19:30/.test(x)), `${style}/${format}: the time is still there`);
    for (const b of off.boxes) assert.ok(b.x >= A.x - 0.5 && b.x + b.w <= A.x + A.w + 0.5 && b.y >= A.y - 0.5 && b.y + b.h <= A.y + A.h + 0.5, `${style}/${format}: ${b.id} in the safe area`);
    assert.ok(off.boxes.length >= 1);
    assert.doesNotThrow(() => { for (const t of [0, 3, 9, 15]) run(off, t); });
  }
});

test("show the day: the studio data carries the setting, story_prepare passes an explicit value (never invents one), the manifest declares one simple setting with FR/EN texts", async () => {
  const off = mk({ settings: { showDay: false } }), token = await data.mintToken(off);
  const r = await def.routes.data(new Request(`${SITE}/m/story/data`, { headers: { "x-story-token": token } }), off).then((x) => x.json());
  assert.equal(r.defaults.showDay, false); const on = mk(), r2 = await def.routes.data(new Request(`${SITE}/m/story/data`, { headers: { "x-story-token": await data.mintToken(on) } }), on).then((x) => x.json()); assert.equal(r2.defaults.showDay, true);
  const prep = async (args) => { const res = await def.mcp.story_prepare(off, args); return { res, p: await data.readPrep(off, /prep=([A-Za-z0-9_-]{22})/.exec(res.link)[1]) }; };
  let x = await prep({}); assert.deepEqual([x.p.config.showDay, "showDay" in x.res.prepared], [undefined, false], "nothing said: the setting applies later, nothing is invented");
  x = await prep({ showDay: false }); assert.deepEqual([x.p.config.showDay, x.res.prepared.showDay], [false, false]);
  x = await prep({ showDay: true }); assert.equal(x.p.config.showDay, true);
  await assert.rejects(def.mcp.story_prepare(off, { showDay: "no" }), /'showDay' must be true or false/);
  await data.saveModel(off, { name: "T", config: { ...P.DEFAULT_CONFIG, showDay: false } }); assert.equal((await data.readModels(off))[0].config.showDay, false, "a model remembers its own choice");
  const s = manifest.settings.find((x) => x.key === "showDay");
  assert.deepEqual([s.type, s.default, s.advanced], ["boolean", true, undefined]);
  assert.ok(s.label.en.length <= 60 && s.label.fr.length <= 60 && s.help.en.length <= 60 && s.help.fr.length <= 60 && !/:$/.test(s.label.en));
  assert.equal(manifest.mcp.find((t) => t.name === "story_prepare").input.properties.showDay.type, "boolean");
  assert.match(read("README.md"), /Show the day with the time/);
});
