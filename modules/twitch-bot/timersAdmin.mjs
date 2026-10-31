// L'onglet « Timers » : des messages que le bot écrit dans le chat à intervalle régulier. Rappel affiché à l'écran : un timer a besoin que le chat soit actif (comme chez Nightbot),
// parce que le bot n'a aucun minuteur : il ne regarde ses timers qu'à l'arrivée d'un message.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const T = await import(`./timers.mjs${v}`);
const { loadConfig } = await import(`./commands.mjs${v}`);
const { compose } = await import(`./engine.mjs${v}`);
const { saveError } = await import(`./errors.mjs${v}`);
const { shownFor, used } = await import(`./variables.mjs${v}`);
const { settingsOf } = await import(`./settings.mjs${v}`);

const cut = (x, n) => { const s = String(x ?? ""); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const tab = (blocks) => blocks.map((b) => ({ ...b, tab: "timers" }));
const can = (ctx) => typeof ctx.can === "function" && ctx.can("timers.manage") === true;
const run = (fn) => ({ right: "timers.manage", run: fn });
const EDIT = { type: "html", html: '<div id="edit" style="scroll-margin-top:5rem"></div>' };

function form(ctx, doc) {
  const t = ctx.t, v0 = doc ?? { name: "", text: "", minutes: 15, lines: 5, when: "live", enabled: true };
  return { type: "adminForm", action: doc ? "timerSave" : "timerCreate", submitLabel: t(doc ? "tm_save_btn" : "tm_new_btn"), ...(doc ? { cancelHref: "?tab=timers" } : {}), fields: [
    ...(doc ? [{ name: "id", kind: "hidden", value: doc.id }] : []),
    { name: "name", label: t("tm_f_name"), value: v0.name, required: true, help: t("tm_f_name_help", { max: T.LIMITS.name }) },
    { name: "text", label: t("tm_f_text"), kind: "textarea", value: v0.text, required: true, help: t("tm_f_text_help", { vars: shownFor("timer").map((x) => `{${x}}`).join(" ") }) },
    { name: "minutes", label: t("tm_f_minutes"), kind: "number", value: v0.minutes, required: true, help: t("tm_f_minutes_help", { max: T.LIMITS.minutes }) },
    { name: "lines", label: t("tm_f_lines"), kind: "number", value: v0.lines, help: t("tm_f_lines_help", { max: T.LIMITS.lines }) },
    { name: "when", label: t("tm_f_when"), kind: "select", value: v0.when, options: T.WHEN.map((w) => ({ value: w, label: t(`tm_when_${w}`) })) },
    { name: "enabled", label: t("tm_f_enabled"), kind: "checkbox", value: v0.enabled ? "on" : "" },
  ] };
}
const fieldsFrom = (x) => ({ name: x.name, text: x.text, minutes: x.minutes, lines: x.lines, when: x.when || "live", enabled: x.enabled === "on" });
const fail = (ctx, r) => {
  const field = { timer_name: "name", timer_dup: "name", timer_minutes: "minutes", timer_lines: "lines" }[r.code] ?? (String(r.code).startsWith("text_") ? "text" : null);
  return field ? { errors: { [field]: saveError(ctx, r) } } : { error: saveError(ctx, r) };
};

export async function blocks(ctx, info, query = {}) {
  const t = ctx.t, s = info.s, cfg = (await loadConfig(ctx)).data, rows = cfg.timers;
  const out = [{ type: "heading", text: t("tm_title") }, { type: "markdown", text: t("tm_intro") }];
  if (info.d.code !== "ready") out.push({ type: "banner", tone: "warning", text: t("tm_not_ready") });
  if (!s.fetchHosts.length && rows.some((x) => used(x.text).includes("urlfetch"))) out.push({ type: "banner", tone: "warning", text: t("tm_urlfetch_off") });
  if (!rows.length) out.push({ type: "markdown", text: t("tm_empty") });
  else {
    const stateText = async (x) => {
      if (x.enabled === false) return t("tm_state_off");
      const it = await T.stateOf(ctx, x.id);
      if (!it) return t("tm_state_new");
      const left = Math.max(0, Math.ceil((x.minutes * 60_000 - (Date.now() - it.lastAt)) / 60_000)), more = Math.max(0, x.lines - it.lines);
      return left || more ? t("tm_state_wait", { min: left, lines: more }) : t("tm_state_due");
    };
    out.push({ type: "table", columns: [t("tm_col_timer"), t("tm_col_state")],
      rows: await Promise.all(rows.map(async (x) => [`${x.name} · ${t("tm_every", { min: x.minutes, lines: x.lines })} · ${t(`tm_when_${x.when}`)}`, await stateText(x)])),
      rowIds: rows.map((x) => x.id),
      rowActions: can(ctx) ? [{ label: t("act_edit"), href: "?tab=timers&timerEdit={id}#edit" }, { label: t("tm_send_btn"), action: "timerSend", confirm: t("tm_send_confirm") }, { label: t("act_toggle"), action: "timerToggle" }] : [] });
  }
  if (!can(ctx)) return tab(out);
  const editing = typeof query.timerEdit === "string" ? rows.find((x) => x.id === query.timerEdit) : null;
  out.push(EDIT);
  if (editing) {
    out.push({ type: "heading", text: t("tm_edit_title", { name: editing.name }) });
    try { out.push({ type: "markdown", text: t("tm_preview", { text: (await compose(ctx, settingsOf(ctx), { text: editing.text, kind: "timer", vars: {} }, "", { channel: info.d.channel ?? null, sources: info.sources, list: info.list })).replace(/([\\`*_[\]<>])/g, "\\$1") }) }); } catch { /* l'aperçu est un plus */ }
    out.push(form(ctx, editing));
    out.push({ type: "table", columns: [t("tm_delete_title")], rows: [[editing.name]], rowIds: [editing.id], rowActions: [{ label: t("delete_btn"), action: "timerRemove", confirm: t("tm_delete_confirm", { name: editing.name }), danger: true }] });
  } else if (rows.length < T.MAX_TIMERS) out.push({ type: "heading", text: t("tm_new_title") }, { type: "markdown", text: t("tm_new_help", { max: T.MAX_TIMERS }) }, form(ctx, null));
  else out.push({ type: "markdown", text: t("err_timer_many", { max: T.MAX_TIMERS }) });
  return tab(out);
}

export const actions = {
  timerCreate: run(async (ctx, x) => {
    const r = await T.saveTimer(ctx, {}, fieldsFrom(x), { prefix: settingsOf(ctx).prefix });
    return r.ok === false ? fail(ctx, r) : { ok: ctx.t("tm_created") };
  }),
  timerSave: run(async (ctx, x) => {
    const r = await T.saveTimer(ctx, { id: x.id }, fieldsFrom(x), { prefix: settingsOf(ctx).prefix });
    return r.ok === false ? fail(ctx, r) : { ok: ctx.t("tm_saved"), redirect: "?tab=timers" };
  }),
  timerToggle: run(async (ctx, x) => {
    const cur = (await loadConfig(ctx)).data.timers.find((y) => y.id === x.id);
    if (!cur) return { error: ctx.t("err_unknown") };
    const r = await T.saveTimer(ctx, { id: x.id }, { enabled: cur.enabled === false }, { prefix: settingsOf(ctx).prefix });
    return r.ok === false ? fail(ctx, r) : { ok: ctx.t(cur.enabled === false ? "tm_on" : "tm_off", { name: cur.name }) };
  }),
  timerRemove: run(async (ctx, x) => {
    const r = await T.removeTimer(ctx, x.id);
    return r.ok === false ? { error: ctx.t("err_unknown") } : { ok: ctx.t("tm_deleted"), redirect: "?tab=timers" };
  }),
  timerSend: run(async (ctx, x) => {
    const r = await T.sendNow(ctx, x.id);
    if (r.ok) return { ok: ctx.t("tm_sent") };
    return { error: ctx.t(`tm_send_${r.code}`) };
  }),
};
