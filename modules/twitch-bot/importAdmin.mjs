// L'écran « Importer depuis Nightbot » : coller la liste, voir pour chaque ligne ce qui sera repris, adapté ou impossible, cocher, valider. Rien n'est écrit avant la validation.
// Le brouillon (la liste lue et traduite, 200 lignes au plus) est gardé dans le stockage du module le temps de la validation, puis effacé (au plus 24 heures).
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const NB = await import(`./nightbot.mjs${v}`);
const { catalog, loadConfig, saveCommand, freeName, MAX_CUSTOM } = await import(`./commands.mjs${v}`);
const { saveTimer } = await import(`./timers.mjs${v}`);
const { saveError } = await import(`./errors.mjs${v}`);
const { settingsOf } = await import(`./settings.mjs${v}`);
const { parsePeriodText, periodError } = await import(`./period.mjs${v}`);
const st = await import(`./state.mjs${v}`);

export const DRAFT_TTL_MS = 24 * 3_600_000;
const cut = (x, n) => { const s = String(x ?? ""); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

/* ───────────── Le brouillon ───────────── */

export async function readDraft(ctx, now = Date.now()) {
  const r = (await ctx.api.store.list("botImport", { limit: 1 }))[0];
  if (!r) return null;
  const rows = Array.isArray(r.data?.rows) ? r.data.rows : [];
  if (!rows.length || now - (r.data?.at ?? 0) > DRAFT_TTL_MS) { await ctx.api.store.remove(r.id).catch(() => {}); return null; }
  return { rows, truncated: r.data.truncated === true, at: r.data.at };
}
const writeDraft = (ctx, draft) => st.serial(ctx, "import", async () => {
  const r = (await ctx.api.store.list("botImport", { limit: 1 }))[0];
  if (r) await ctx.api.store.update(r.id, draft); else await ctx.api.store.add("botImport", draft);
});
export const clearDraft = (ctx) => st.serial(ctx, "import", async () => { const r = (await ctx.api.store.list("botImport", { limit: 1 }))[0]; if (r) await ctx.api.store.remove(r.id); });

/* ───────────── Analyse ───────────── */

/** Qui porte déjà ce nom ? (commande de n'importe quelle famille, ou timer) */
function conflicts(cfg, sources, t) {
  const list = catalog(cfg, sources, t);
  return (kind, name) => {
    if (kind === "timer") { const x = cfg.timers.find((y) => y.name.toLowerCase() === name.toLowerCase()); return x ? { kind: "timer", id: x.id, label: x.name } : null; }
    const c = list.find((y) => y.name === name || y.aliases.includes(name));
    return c ? { kind: c.kind, id: c.id, label: c.name } : null;
  };
}
/** Lit et évalue une liste collée, sans rien écrire. Rend { rows, truncated, format }. */
export async function analyse(ctx, text, { sources }) {
  const s = settingsOf(ctx), cfg = (await loadConfig(ctx)).data;
  const parsed = NB.parseNightbot(text);
  const conflictOf = conflicts(cfg, sources, ctx.t);
  const seen = new Set();
  const rows = parsed.rows.map((r, i) => {
    const e = { i, ...NB.evaluateRow(r, { prefix: s.prefix, conflictOf }) };
    delete e.conflict;
    if (e.status !== "impossible") {
      const key = `${e.kind}:${e.name.toLowerCase()}`;
      if (seen.has(key)) { e.status = "impossible"; e.reasons.push({ c: "dup" }); } else seen.add(key);
    }
    return e;
  });
  return { rows, truncated: parsed.truncated, format: parsed.format };
}

/* ───────────── Enregistrement ───────────── */

/**
 * Écrit les lignes choisies. `picks` : { [i]: "skip" | "replace" | "rename" | "add" } (« add » : pas de conflit). Les conflits sont revus au moment d'écrire (la configuration a pu changer).
 * Rend { created, replaced, renamed, skipped, failed: [{ name, why }] }.
 */
export async function applyRows(ctx, rows, picks, { sources, t }, periods = {}) {
  const s = settingsOf(ctx);
  const env = { src: sources, t, prefix: s.prefix };
  const out = { created: 0, replaced: 0, renamed: 0, skipped: 0, failed: [] };
  const fail = (r, why) => { out.failed.push({ name: r.name, why: cut(why, 120) }); };
  for (const r of rows) {
    const policy = picks[r.i];
    if (!policy || r.status === "impossible") { if (policy) out.skipped++; continue; }
    const cfg = (await loadConfig(ctx)).data;
    const conflict = conflicts(cfg, sources, t)(r.kind, r.name);
    let name = r.name, replaceId = null;
    if (conflict) {
      if (policy === "replace" && (r.kind === "timer" ? conflict.kind === "timer" : conflict.kind === "custom")) replaceId = conflict.id;
      else if (policy === "rename" || policy === "replace") {
        const taken = new Set(catalog(cfg, sources, t).flatMap((c) => [c.name, ...c.aliases]));
        for (const x of cfg.timers) taken.add(x.name.toLowerCase());
        name = r.kind === "timer" ? `${r.name.slice(0, 36)} 2` : freeName(r.name, taken);
        if (r.kind === "timer") for (let k = 2; k < 50 && taken.has(name.toLowerCase()); k++) name = `${r.name.slice(0, 36)} ${k}`;
      } else { out.skipped++; continue; }
    }
    if (r.kind === "timer") {
      const res = await saveTimer(ctx, replaceId ? { id: replaceId } : {}, { name, text: r.text, minutes: r.minutes, lines: r.lines, when: "live", enabled: r.enabled, ...(periods[r.i] ? { period: periods[r.i] } : {}) }, { prefix: s.prefix });
      if (res.ok === false) { if (res.code === "timer_many") { fail(r, saveError(ctx, res)); break; } fail(r, saveError(ctx, res)); continue; }
    } else {
      if (!replaceId && cfg.custom.length >= MAX_CUSTOM) { fail(r, saveError(ctx, { code: "too_many" })); break; }
      const fields = { name, text: r.text, role: r.role, enabled: true, ...(r.cdGlobal !== null ? { cdGlobal: r.cdGlobal } : {}), ...(periods[r.i] ? { period: periods[r.i] } : {}) };
      const res = await saveCommand(ctx, replaceId ? { kind: "custom", id: replaceId } : { kind: "custom" }, fields, env);
      if (res.ok === false) { fail(r, saveError(ctx, res)); continue; }
      if (r.count !== null) await st.setCounter(ctx, res.key, r.count).catch(() => {});
    }
    if (replaceId) out.replaced++; else if (name !== r.name) out.renamed++; else out.created++;
  }
  return out;
}
export const summaryOf = (ctx, o) => ctx.t("nb_done", { created: o.created + o.renamed, replaced: o.replaced, skipped: o.skipped, failed: o.failed.length })
  + (o.failed.length ? ` ${ctx.t("nb_done_failed", { list: o.failed.slice(0, 3).map((f) => `${f.name} (${f.why})`).join(" ; ") })}` : "");

/* ───────────── L'écran ───────────── */

const run = (fn) => ({ right: "nightbot.import", run: fn });
const can = (ctx) => typeof ctx.can === "function" && ctx.can("nightbot.import") === true;
const noteText = (t, n) => t(`nb_n_${n.c}`, { d: n.d ?? "" });
const reasonText = (t, n) => t(`nb_r_${n.c}`, { d: n.d ?? "" });
const label = (s, r) => (r.kind === "timer" ? `⏱ ${r.name}` : `${s.prefix}${r.name}`);

export async function blocks(ctx, info) {
  const t = ctx.t, s = info.s, out = [{ type: "html", html: '<div id="import" style="scroll-margin-top:5rem"></div>' }, { type: "heading", text: t("nb_title") }];
  out.push({ type: "links", items: [{ label: t("nb_back"), href: "?" }] });
  if (!can(ctx)) return [...out, { type: "markdown", text: t("nb_no_right") }];
  const draft = await readDraft(ctx);
  if (!draft) {
    out.push({ type: "markdown", text: t("nb_help", { max: NB.IMPORT_LIMITS.rows }) });
    out.push({ type: "adminForm", action: "importAnalyse", submitLabel: t("nb_analyse_btn"), fields: [{ name: "paste", label: t("nb_f_paste"), kind: "textarea", required: true, help: t("nb_f_paste_help") }] });
    return out;
  }
  const conflictOf = conflicts((await loadConfig(ctx)).data, info.sources, t);
  const rows = draft.rows.map((r) => ({ ...r, conflict: r.status === "impossible" ? null : conflictOf(r.kind, r.name) }));
  const by = (x) => rows.filter((r) => r.status === x).length;
  out.push({ type: "banner", tone: "success", text: t("nb_summary", { total: rows.length, same: by("same"), adapted: by("adapted"), impossible: by("impossible") }) });
  if (draft.truncated) out.push({ type: "banner", tone: "warning", text: t("nb_truncated", { max: NB.IMPORT_LIMITS.rows }) });
  const bad = rows.filter((r) => r.status === "impossible");
  if (bad.length) out.push({ type: "heading", text: t("nb_bad_title") }, { type: "table", columns: [t("nb_col_line"), t("nb_col_why")], rows: bad.map((r) => [cut(r.name ? label(s, r) : r.reasons[0]?.d ?? "?", 40), cut(r.reasons.map((n) => reasonText(t, n)).join(" "), 200)]) });
  const good = rows.filter((r) => r.status !== "impossible");
  if (good.length) {
    out.push({ type: "heading", text: t("nb_pick_title") }, { type: "markdown", text: t("nb_pick_help") });
    const fields = [];
    for (const r of good) {
      const note = r.status === "same" ? t("nb_same") : r.notes.map((n) => noteText(t, n)).join(" ");
      fields.push({ name: `pick_${r.i}`, label: `${label(s, r)} · ${t(`nb_status_${r.status}`)}`, kind: "checkbox", value: r.conflict ? "" : "on", help: `${cut(r.text, 140)}${note ? ` — ${note}` : ""}` });
      fields.push({ name: `period_${r.i}`, label: t("nb_f_period", { name: label(s, r) }), help: t("nb_f_period_help") });
      if (r.conflict) fields.push({ name: `policy_${r.i}`, label: t("nb_conflict", { name: label(s, r) }), kind: "select", value: "skip", options: [{ value: "skip", label: t("nb_p_skip") }, { value: "replace", label: t("nb_p_replace") }, { value: "rename", label: t("nb_p_rename") }], help: t("nb_conflict_help") });
    }
    out.push({ type: "adminForm", action: "importApply", submitLabel: t("nb_apply_btn"), cancelHref: "?import=1", fields });
  }
  out.push({ type: "adminForm", action: "importCancel", submitLabel: t("nb_cancel_btn"), fields: [] });
  return out;
}

export const actions = {
  importAnalyse: run(async (ctx, x) => {
    const text = String(x.paste ?? "");
    if (!text.trim()) return { errors: { paste: ctx.t("nb_e_empty") } };
    const sources = (await (await import(`./sources.mjs${v}`)).gather(ctx, null));
    const a = await analyse(ctx, text, { sources });
    if (!a.rows.length) return { errors: { paste: ctx.t("nb_e_nothing") } };
    await writeDraft(ctx, { at: Date.now(), truncated: a.truncated, rows: a.rows });
    return { ok: ctx.t("nb_analysed", { n: a.rows.length }), redirect: "?import=1#import" };
  }),
  importApply: run(async (ctx, x) => {
    const draft = await readDraft(ctx);
    if (!draft) return { error: ctx.t("nb_e_expired") };
    const picks = {};
    for (const r of draft.rows) if (x[`pick_${r.i}`] === "on") picks[r.i] = ["replace", "rename", "skip"].includes(x[`policy_${r.i}`]) ? x[`policy_${r.i}`] : "add";
    if (!Object.keys(picks).length) return { error: ctx.t("nb_e_none") };
    // Les dates de validité ne se devinent pas : un champ facultatif par ligne (« 01/11 - 30/11 » : chaque année ; avec les années : une seule fois).
    const periods = {}, errors = {};
    for (const i of Object.keys(picks)) {
      const p = parsePeriodText(x[`period_${i}`]);
      if (!p.ok) errors[`period_${i}`] = periodError(ctx, p); else if (p.value) periods[i] = p.value;
    }
    if (Object.keys(errors).length) return { errors };
    const sources = await (await import(`./sources.mjs${v}`)).gather(ctx, null);
    const res = await applyRows(ctx, draft.rows, picks, { sources, t: ctx.t }, periods);
    await clearDraft(ctx);
    return { ok: summaryOf(ctx, res), redirect: "?" };
  }),
  importCancel: run(async (ctx) => { await clearDraft(ctx); return { ok: ctx.t("nb_cancelled"), redirect: "?import=1#import" }; }),
};
