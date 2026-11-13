// The "Media" tab of the overlay: ONE table of the pictures, GIFs and sounds (live search, filter by type, a coloured and written type, edit in a window, delete confirmed, test in the row menu).
// Videos stay in the six video fields of the same tab (the core only lets settings receive videos). Other modules pick from this library through the service `alerts.show`.
const v = new URL(import.meta.url).search; // the version of the module spreads to the neighbour files
const md = await import(new URL(`./media.mjs${v}`, import.meta.url).href);

const TAB = "media";
const BADGE = { picture: "accent", sound: "info", video: "warn" };
const ERR = { name: "md_err_name", dup: "md_err_dup", file: "md_err_file", full: "md_err_full", unknown: "md_err_unknown", seconds: "md_err_name", busy: "md_err_busy" };

/** The blocks of the tab (the video fields are the settings of the tab, drawn by the core). */
export async function blocks(ctx, { query = {} } = {}) {
  const t = ctx.t, items = (await md.list(ctx, { tones: false })).filter((m) => !m.id.startsWith("video:"));
  const add = query.add === "picture" || query.add === "sound" ? query.add : null;
  const edit = typeof query.media === "string" ? items.find((m) => m.id === query.media) : null;
  const rows = items.map((m) => [
    { text: m.name, title: m.name, ...(m.kind === "picture" ? { image: { src: m.url, alt: t("md_alt", { name: m.name }) } } : {}) },
    { text: t(`md_type_${m.kind}`), badge: BADGE[m.kind] },
  ]);
  const dialog = add ? [{
    type: "adminForm", tab: TAB, presentation: "dialog", action: "addMedia", cancelHref: `?tab=${TAB}`, title: t(`md_new_${add}_title`), submitLabel: t(`md_new_${add}_btn`),
    fields: [
      { name: "kind", kind: "hidden", label: "kind", value: add },
      { name: "name", label: t("md_f_name"), required: true, example: t("md_f_name_example") },
      { name: "file", kind: add === "sound" ? "audio" : "image", label: t(add === "sound" ? "md_f_sound" : "md_f_picture"), required: true },
    ],
  }] : edit ? [{
    type: "adminForm", tab: TAB, presentation: "dialog", action: "renameMedia", cancelHref: `?tab=${TAB}`, title: t("md_edit_title", { name: edit.name }), submitLabel: t("md_edit_save"),
    fields: [{ name: "id", kind: "hidden", label: "id", value: edit.id }, { name: "name", label: t("md_f_name"), required: true, value: edit.name, example: t("md_f_name_example") }],
  }] : [];
  return [
    { type: "markdown", tab: TAB, text: t("md_intro") },
    { type: "links", tab: TAB, items: [{ label: t("md_add_picture"), href: `?tab=${TAB}&add=picture`, presentation: "dialog" }, { label: t("md_add_sound"), href: `?tab=${TAB}&add=sound`, presentation: "dialog" }] },
    ...(items.length
      ? [{ type: "table", tab: TAB, columns: [t("md_col_name"), t("md_col_type")], rows, rowIds: items.map((m) => m.id), searchable: true, searchPlaceholder: t("md_search"), filters: [{ column: 1, allLabel: t("md_all") }], truncate: [0], pageSize: 50,
        rowActions: [{ label: t("md_edit_btn"), href: `?tab=${TAB}&media={id}`, presentation: "dialog" }, { label: t("md_show_btn"), action: "showMedia", inMenu: true }, { label: t("md_delete_btn"), action: "removeMedia", inMenu: true, danger: true, confirm: t("md_delete_confirm") }] }]
      : [{ type: "markdown", tab: TAB, text: t("md_empty") }]),
    ...dialog,
  ];
}

const fail = (ctx, code, field) => (field ? { errors: { [field]: ctx.t(ERR[code] ?? "md_err_unknown", { max: md.LIMITS.items }) } } : { error: ctx.t(ERR[code] ?? "md_err_unknown", { max: md.LIMITS.items }) });
const fieldOf = { name: "name", dup: "name", file: "file" };

/** The admin actions, given the function that sends an alert to the pages of this overlay. */
export function actions(emit) {
  return {
    async addMedia(ctx, values) {
      const r = await md.add(ctx, { name: values.name, kind: values.kind, url: values.file });
      return r.ok ? { ok: ctx.t("md_added") } : fail(ctx, r.code, fieldOf[r.code]);
    },
    async renameMedia(ctx, values) {
      const r = await md.rename(ctx, String(values.id ?? ""), values.name);
      return r.ok ? { ok: ctx.t("md_saved") } : fail(ctx, r.code, fieldOf[r.code]);
    },
    async removeMedia(ctx, values) {
      const r = await md.remove(ctx, String(values.id ?? ""));
      return r.ok ? { ok: ctx.t("md_deleted") } : fail(ctx, r.code);
    },
    async showMedia(ctx, values) {
      const m = await md.find(ctx, String(values.id ?? ""));
      if (!m) return fail(ctx, "unknown");
      const r = await md.show(ctx, m.kind === "sound" ? { sound: m.id } : { visual: m.id }, (a) => emit(ctx.instance.key, a));
      return r.ok ? { ok: ctx.t(r.state === "held" ? "md_held" : "md_shown") } : fail(ctx, r.code === "busy" ? "busy" : "unknown");
    },
  };
}
