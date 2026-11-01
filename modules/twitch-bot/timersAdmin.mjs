// L'onglet « Timers » : des messages que le bot écrit dans le chat à intervalle régulier. Un timer a besoin que le chat soit actif : le bot n'a aucun minuteur, il ne regarde ses timers
// qu'à l'arrivée d'un message. La page : un tableau (recherche en direct, filtres, interrupteur dans la ligne), puis un formulaire de 5 champs visibles au plus ; la période et le reste sont repliés.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const T = await import(`./timers.mjs${v}`);
const { loadConfig } = await import(`./commands.mjs${v}`);
const { saveError } = await import(`./errors.mjs${v}`);
const { used } = await import(`./variables.mjs${v}`);
const { settingsOf } = await import(`./settings.mjs${v}`);
const { readPeriod, isOpen, nextOpening, parsePeriodText, periodError, periodField } = await import(`./period.mjs${v}`);
const K = await import(`./adminkit.mjs${v}`);
const F = await import(`./formsUi.mjs${v}`);
const CU = await import(`./commandsUi.mjs${v}`);

const { esc } = K;
const tab = (blocks) => blocks.map((b) => ({ ...b, tab: "timers" }));
const can = (ctx) => typeof ctx.can === "function" && ctx.can("timers.manage") === true;
const run = (fn) => ({ right: "timers.manage", run: fn });
const EDIT = { type: "html", html: '<div id="edit" style="scroll-margin-top:5rem"></div>' };

/** Le formulaire d'un timer : Nom, Message, « Toutes les [ ] minutes, après au moins [ ] lignes de chat », En direct / Toujours (5 champs) ; la période est repliée. */
async function form(ctx, info, doc) {
  const t = ctx.t, v0 = doc ?? { name: "", text: "", minutes: 15, lines: 5, when: "live", enabled: true };
  const env = { channel: info.d.channel ?? null, sources: info.sources, list: info.list };
  const layout = [
    { f: "name" }, { f: "text", preview: await F.textExtras(ctx, "timer", {}, env) },
    { sentence: { title: t("tm_rhythm"), hint: t("tm_rhythm_hint", { minutes: T.LIMITS.minutes, lines: T.LIMITS.lines }), tokens: [t("tm_r1"), { f: "minutes", min: 1, max: T.LIMITS.minutes }, t("tm_r2"), { f: "lines", min: 0, max: T.LIMITS.lines }, t("tm_r3")] } },
    { seg: "when" },
    { more: { title: t("more_title"), hint: t("more_hint_timer"), open: false, items: [F.periodLayout(ctx, readPeriod(v0.period))] } },
  ];
  const id = doc ? "timer-edit" : "timer-new";
  const conf = K.formConfig(id, { layout });
  return [conf.block, { type: "adminForm", action: doc ? "timerSave" : "timerCreate", submitLabel: t(doc ? "tm_save_btn" : "tm_new_btn"), ...(doc ? { cancelHref: "?tab=timers" } : {}), fields: [
    conf.field,
    ...(doc ? [{ name: "id", kind: "hidden", value: doc.id }] : []),
    { name: "name", label: t("tm_f_name"), value: v0.name, required: true, help: t("tm_f_name_help") },
    { name: "text", label: t("tm_f_text"), kind: "textarea", value: v0.text, required: true, help: t("tm_f_text_help") },
    { name: "minutes", label: t("tm_f_minutes"), kind: "number", value: v0.minutes, required: true, help: t("tm_f_minutes_help", { max: T.LIMITS.minutes }) },
    { name: "lines", label: t("tm_f_lines"), kind: "number", value: v0.lines, help: t("tm_f_lines_help", { max: T.LIMITS.lines }) },
    { name: "when", label: t("tm_f_when"), kind: "select", value: v0.when, options: T.WHEN.map((w) => ({ value: w, label: t(`tm_when_${w}`) })) },
    periodField(ctx, readPeriod(v0.period)),
  ] }];
}
const fieldsFrom = (x) => ({ name: x.name, text: x.text, minutes: x.minutes, lines: x.lines, when: x.when || "live" });
const periodOf = (ctx, x) => {
  if (x.period === undefined) return {};
  const p = parsePeriodText(x.period);
  return p.ok ? { period: p.value } : { bad: { errors: { period: periodError(ctx, p) } } };
};
const fail = (ctx, r) => {
  const field = r.code === "period" ? "period" : { timer_name: "name", timer_dup: "name", timer_minutes: "minutes", timer_lines: "lines" }[r.code] ?? (String(r.code).startsWith("text_") ? "text" : null);
  return field ? { errors: { [field]: saveError(ctx, r) } } : { error: saveError(ctx, r) };
};

/** L'état d'un timer : { state: "on" | "off" | "outside", full (info-bulle), note (sous l'interrupteur, seulement si ça sort de l'ordinaire) }. */
async function stateOf(ctx, s, x) {
  const t = ctx.t;
  if (x.enabled === false) return { state: "off", full: t("tm_state_off"), note: "", word: t("tm_state_off") };
  const per = readPeriod(x.period);
  if (per && !isOpen(per, Date.now(), s.timeZone)) { const st = CU.stateTexts(ctx, "outside", "outside_period", nextOpening(per, Date.now(), s.timeZone)); return { state: "outside", full: st.full, note: st.note, word: st.word }; }
  const it = await T.stateOf(ctx, x.id);
  if (!it) return { state: "on", full: t("tm_state_new"), note: "", word: t("state_on") };
  const left = Math.max(0, Math.ceil((x.minutes * 60_000 - (Date.now() - it.lastAt)) / 60_000)), more = Math.max(0, x.lines - it.lines);
  return left || more ? { state: "on", full: t("tm_state_wait", { min: left, lines: more }), note: t("tm_note_wait", { min: left, lines: more }), word: t("state_on") } : { state: "on", full: t("tm_state_due"), note: t("tm_note_due"), word: t("state_on") };
}

async function listBlock(ctx, info, rows, writable) {
  const t = ctx.t, s = info.s;
  const states = await Promise.all(rows.map((x) => stateOf(ctx, s, x)));
  const html = rows.map((x, i) => {
    const st = states[i], rhythm = t("tm_every", { min: x.minutes, lines: x.lines }) + (x.when === "always" ? ` · ${t("tm_when_always")}` : "");
    const action = writable ? `<a class="ck-btn small" href="?tab=timers&timerEdit=${encodeURIComponent(x.id)}#edit">${esc(t("act_edit"))}</a><button type="button" class="ck-btn small ck-js" data-ck-act="timerSend" data-ck-id="${esc(x.id)}" data-ck-confirm="${esc(t("tm_send_confirm"))}" data-ck-yes="${esc(t("tm_send_btn"))}" data-ck-no="${esc(t("cancel_btn"))}" data-ck-fail="${esc(t("err_toggle"))}">${esc(t("tm_send_btn"))}</button>` : "";
    return `<tr ${K.rowAttrs({ state: st.state }, `${x.name} ${x.text} ${rhythm} ${st.word} ${st.full}`)}>
<td class="c-name"><span class="ck-ell" title="${esc(x.name)}"><span class="ck-name">${esc(x.name)}</span></span></td>
<td class="c-ans"><span class="ck-ell" title="${esc(x.text)}">${esc(x.text)}</span></td>
<td class="c-org"><span class="ck-ell" title="${esc(rhythm)}">${esc(rhythm)}</span></td>
<td class="c-sw">${K.switchHtml({ id: x.id, on: x.enabled !== false, label: t("sw_label_timer", { name: x.name }), act: "timerToggle", disabled: !writable, fail: t("err_toggle") }).replace("data-ck-switch", "data-ck-switch data-ck-reload")}<span class="ck-note" data-ck-note title="${esc(st.full)}"${st.note ? "" : " hidden"}>${esc(st.note)}</span></td>
<td class="c-act"><div class="ck-acts">${action}</div></td></tr>`;
  }).join("");
  const count = (st) => states.filter((x) => x.state === st).length;
  const items = [["on", "tm_filter_on"], ["off", "tm_filter_off"], ["outside", "tm_filter_outside"]].map(([val, key]) => ({ val, label: t(key), count: count(val) })).filter((x) => x.count > 0);
  const head = `<div class="ck-head"><h2 class="ck-title">${esc(t("tm_title"))}</h2>${writable && rows.length < T.MAX_TIMERS ? `<a class="ck-btn primary" href="?tab=timers&timerNew=1#edit">${esc(t("tm_new_open"))}</a>` : ""}</div><p class="ck-intro">${esc(t("tm_intro"))}</p>`;
  return { type: "html", html: K.listShell({
    ctx, id: "timers", head,
    columns: [{ label: t("tm_col_timer"), width: "20%" }, { label: t("col_answer") }, { label: t("tm_col_rhythm"), width: "17%" }, { label: t("col_active"), width: "21%" }, { label: t("col_action"), width: "20%", sr: true }],
    rows: html,
    pills: [{ key: "state", label: t("filter_state"), items: [{ val: "all", label: t("filter_any"), count: rows.length }, ...items] }],
    text: { search: t("search_label"), placeholder: t("search_timers"), empty: t("search_none"), clear: t("search_clear"), count: t("search_count") },
  }) };
}

export async function blocks(ctx, info, query = {}) {
  const t = ctx.t, s = info.s, cfg = (await loadConfig(ctx)).data, rows = cfg.timers;
  const out = [K.bootstrap(ctx)];
  if (info.d.code !== "ready") out.push({ type: "banner", tone: "warning", text: t("tm_not_ready") });
  if (!s.fetchHosts.length && rows.some((x) => used(x.text).includes("urlfetch"))) out.push({ type: "banner", tone: "warning", text: t("tm_urlfetch_off") });
  const writable = can(ctx);
  const editing = writable && typeof query.timerEdit === "string" ? rows.find((x) => x.id === query.timerEdit) : null;
  if (writable && (editing || (query.timerNew && rows.length < T.MAX_TIMERS))) {
    out.push(EDIT);
    if (editing) {
      out.push({ type: "heading", text: t("tm_edit_title", { name: editing.name }) }, ...(await form(ctx, info, editing)));
      out.push({ type: "table", columns: [t("tm_delete_title")], rows: [[editing.name]], rowIds: [editing.id], rowActions: [{ label: t("delete_btn"), action: "timerRemove", confirm: t("tm_delete_confirm", { name: editing.name }), danger: true }] });
    } else out.push({ type: "heading", text: t("tm_new_title") }, ...(await form(ctx, info, null)));
  }
  if (!rows.length) out.push({ type: "html", html: `<div class="ck"><div class="ck-head"><h2 class="ck-title">${esc(t("tm_title"))}</h2>${writable ? `<a class="ck-btn primary" href="?tab=timers&timerNew=1#edit">${esc(t("tm_new_open"))}</a>` : ""}</div><p class="ck-intro">${esc(t("tm_intro"))}</p><div class="ck-empty"><p>${esc(t("tm_empty"))}</p></div></div>` });
  else out.push(await listBlock(ctx, info, rows, writable));
  return tab(out);
}

export const actions = {
  timerCreate: run(async (ctx, x) => {
    const per = periodOf(ctx, x);
    if (per.bad) return per.bad;
    const r = await T.saveTimer(ctx, {}, { ...fieldsFrom(x), enabled: true, ...(per.period !== undefined ? { period: per.period } : {}) }, { prefix: settingsOf(ctx).prefix });
    return r.ok === false ? fail(ctx, r) : { ok: ctx.t("tm_created") };
  }),
  timerSave: run(async (ctx, x) => {
    const per = periodOf(ctx, x);
    if (per.bad) return per.bad;
    const r = await T.saveTimer(ctx, { id: x.id }, { ...fieldsFrom(x), ...(per.period !== undefined ? { period: per.period } : {}) }, { prefix: settingsOf(ctx).prefix });
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
