// Contacts — l'écran « Importer / exporter » : formulaire (collage ou fichier), aperçu, import par lots, rapport des lignes à corriger, export complet.
// Toute la logique est dans import.mjs (lots), export.mjs (flux) et csv.mjs (format) ; ici seulement l'écran, les actions et les phrases.
const v = new URL(import.meta.url).search;
const B = await import(`./book.mjs${v}`);
const D = await import(`./data.mjs${v}`);
const I = await import(`./import.mjs${v}`);
const C = await import(`./csv.mjs${v}`);
const U = await import(`./ui.mjs${v}`);
const { nav } = await import(`./nav.mjs${v}`);
const { describeError } = await import(`./messages.mjs${v}`);

const fmt = (ctx, n) => new Intl.NumberFormat(ctx.locale || "en").format(n);
const hiddenId = [{ name: "go", kind: "hidden", value: "1" }];
const CHANGE_WORDS = { f: "impChange_f", a: "impChange_a", c: "impChange_c", n: "impChange_n" };

const KEPT_WORDS = { email: "mgField_email", phone: "mgField_phone", role: "mgField_role", others: "mgField_others", relation: "mgField_relation", photo: "mgField_photo" };
function entryText(ctx, outcome, e) {
  const head = ctx.t("impLine", { line: e.line, name: e.name || "—" });
  const kept = e.kept?.length ? ` ${ctx.t("impKept", { fields: e.kept.map((f) => ctx.t(KEPT_WORDS[f])).join(", ") })}` : "";
  if (outcome === "error") return describeError(ctx, e);
  if (outcome === "linked") return `${head} : ${ctx.t(e.via === "file" ? "impLinkedFile" : "impLinked", { changes: (e.changes ?? []).map((c) => ctx.t(CHANGE_WORDS[c] ?? "impChange_f")).join(", "), line: e.sameAs ?? "" })}${kept}`;
  if (outcome === "skipped") return `${head} : ${e.via === "file" ? ctx.t("impSkippedFile", { line: e.sameAs ?? "" }) : ctx.t("impSkipped")}${kept}`;
  return head;
}

function jobBlocks(ctx, job) {
  const t = ctx.t, d = job.data;
  const out = [];
  const total = d.total, c = d.counts;
  const state = d.state;
  const title = t(`impState_${state === "staging" ? "staged" : state}`);
  let body = `<h2 class="ct-name">${U.esc(title)}</h2>`;
  if (["staged", "previewing", "running"].includes(state)) {
    body += `${U.bar(d.processed, total, title)}<p class="ct-count" role="status">${U.esc(t("impProgress", { done: fmt(ctx, d.processed), total: fmt(ctx, total) }))}</p>`;
  }
  if (state === "previewed") body += `<p class="ct-help">${U.esc(t("impPreviewHelp"))}</p>`;
  if (state === "done") body += `<p class="ct-help">${U.esc(t("impDoneHelp"))}</p>`;
  if (["previewed", "running", "done", "previewing"].includes(state) || c.created + c.linked + c.skipped + c.error > 0) {
    body += U.stats([{ n: fmt(ctx, c.created), label: t("impStat_created") }, { n: fmt(ctx, c.linked), label: t("impStat_linked") }, { n: fmt(ctx, c.skipped), label: t("impStat_skipped") }, { n: fmt(ctx, c.error), label: t("impStat_error") }], t("impStatsLabel"));
  }
  if (d.newCategories?.length && state !== "done") body += `<p class="ct-help">${U.esc(t("impNewCats", { names: d.newCategories.slice(0, 12).join(", ") + (d.newCategories.length > 12 ? "…" : "") }))}</p>`;
  if (d.unknown?.length && ["staged", "previewing", "previewed"].includes(state)) body += `<p class="ct-help">${U.esc(t("impIgnoredColumns", { names: d.unknown.slice(0, 6).join(", ") }))}</p>`;
  if (c.error > 0 && ["previewed", "done"].includes(state)) body += `<p class="ct-help">${U.esc(t("impErrorsHelp"))}</p>`;
  out.push(U.htmlBlock(body));
  const step = (mode, label) => ({ type: "adminForm", action: "importStep", submitLabel: label, fields: [...hiddenId, { name: "mode", kind: "hidden", value: mode }] });
  if (state === "staging") out.push({ type: "banner", tone: "warning", text: t("impStaging") });
  if (state === "staged" || state === "previewing") out.push(step("preview", t(state === "staged" ? "impPreviewStart" : "impPreviewMore")));
  if (state === "previewed") out.push(step("run", t("impRunStart")));
  if (state === "running") out.push(step("run", t("impRunMore")));
  if (c.error > 0 && ["previewed", "done"].includes(state)) out.push({ type: "download", name: "importReport", label: t("impReportButton") });
  if (state === "done") out.push({ type: "adminForm", action: "importClose", submitLabel: t("impClose"), fields: hiddenId });
  // Annuler vient en dernier, après la liste des lignes (voir panel).
  const cancel = state === "done" ? [] : [{ type: "table", columns: [t("impCancelCol")], rows: [[t("impCancelRow")]], rowIds: ["x"], rowActions: [{ label: t("impCancel"), action: "importCancel", confirm: t("impCancelConfirm"), danger: true }] }];
  return { top: out, bottom: cancel };
}

async function lineList(ctx, job, q) {
  const t = ctx.t, d = job.data;
  const kinds = ["error", "linked", "created", "skipped"].filter((o) => d.counts[o] > 0);
  if (!kinds.length || !["previewed", "running", "done"].includes(d.state)) return [];
  const show = kinds.includes(q.show) ? q.show : kinds[0];
  const chips = kinds.map((o) => ({ label: t(`impShow_${o}`, { count: fmt(ctx, d.counts[o]) }), href: U.href({ view: "import", show: o }), current: o === show }));
  const page = await I.logPage(ctx, show, q.lc);
  const items = page.items.map((e) => `<li>${U.esc(entryText(ctx, show, e))}</li>`).join("");
  const stored = d.logs?.[show]?.n ?? 0;
  const more = d.counts[show] > stored ? `<p class="ct-help">${U.esc(t("impTruncated", { shown: fmt(ctx, stored), count: fmt(ctx, d.counts[show]) }))}</p>` : "";
  const next = page.next ? `<p class="ct-more"><a class="ct-btn" href="${U.esc(U.href({ view: "import", show, lc: page.next }))}">${U.esc(t("seeMore"))}</a></p>` : "";
  return [U.htmlBlock(`${U.chips(chips, t("impShowLabel"))}<ul class="ct-lines">${items}</ul>${more}${next}`)];
}

function startForm(ctx) {
  const t = ctx.t;
  return [
    U.htmlBlock(`<h2 class="ct-name">${U.esc(t("impTitle"))}</h2><p class="ct-help">${U.esc(t("impIntro"))}</p><p class="ct-help">${U.esc(t("impColumns"))}</p>`),
    { type: "download", name: "template", label: t("impTemplate") },
    {
      type: "adminForm", action: "importStart", submitLabel: t("impCheck"),
      fields: [
        { name: "csv", label: t("impPaste"), kind: "textarea", help: t("impPasteHelp") },
        { name: "file", label: t("impFile"), kind: "file", accept: ".csv,.tsv,.txt", maxBytes: C.MAX_FILE_CHARS, help: t("impFileHelp") },
      ],
    },
  ];
}

function exportBlocks(ctx) {
  const t = ctx.t;
  const can = B.can(ctx, B.RIGHT_EXPORT);
  const hidden = !B.can(ctx, B.RIGHT_EMAIL_VIEW);
  const out = [U.htmlBlock(`<h2 class="ct-name">${U.esc(t("expTitle"))}</h2><p class="ct-help">${U.esc(t("expIntro"))}</p>${can && hidden ? `<p class="ct-help">${U.esc(t("expContactHidden"))}</p>` : ""}${can ? "" : `<p class="ct-help">${U.esc(t("expNoRight"))}</p>`}`)];
  if (can) out.push({ type: "download", name: "contacts", label: t("expButton") });
  return out;
}

export async function panel(ctx, q) {
  const job = await I.tidy(ctx);
  const blocks = [U.firstBlock(nav(ctx, "import"))];
  if (job) { const j = jobBlocks(ctx, job); blocks.push(...j.top, ...(await lineList(ctx, job, q)), ...j.bottom); }
  else blocks.push(...startForm(ctx));
  blocks.push(...exportBlocks(ctx));
  return blocks;
}

/** L'erreur de `stage` → un message SOUS le champ utilisé (avec un exemple). */
function stageError(ctx, field, err) {
  const t = ctx.t;
  const text = {
    empty: () => t("impErrEmpty"),
    header: () => t("impErrHeader", { found: err.headers?.length ? t("impErrHeaderFound", { names: err.headers.join(", ") }) : "" }),
    quote: () => t("impErrQuote", { record: err.record }),
    too_many: () => t("impErrTooMany", { max: fmt(ctx, err.max) }),
    norows: () => t("impErrNoRows"),
    busy_job: () => t("impErrBusy"),
  }[err.code]?.() ?? t("impErrEmpty");
  return { errors: { [field]: text } };
}

export const actions = {
  importStart: async (ctx, v) => {
    const t = ctx.t;
    const usedFile = typeof v.file === "string" && v.file.trim() !== "";
    const field = usedFile ? "file" : "csv";
    const r = await D.within(I.stage(ctx, usedFile ? v.file : v.csv, { locale: ctx.locale }), ctx.__contactsTest?.importStageMs ?? 90_000, "import stage");
    if (!r.ok) return stageError(ctx, field, r.error);
    // Une première vérification tout de suite : pour un petit fichier, l'aperçu est déjà là quand la page s'ouvre.
    await I.step(ctx, "preview", { budgetMs: Math.min(I.stepMs(ctx), 6000) });
    return { ok: t("impStaged", { count: fmt(ctx, r.job.data.total) }), redirect: "?view=import" };
  },
  importStep: async (ctx, v) => {
    const t = ctx.t;
    const mode = v.mode === "run" ? "run" : "preview";
    const r = await I.step(ctx, mode);
    if (!r.ok) return { error: t({ working: "impWorking", busy: "busy", incomplete: "impStaging" }[r.error] ?? "impNoJob") };
    return { ok: t(`impStepDone_${r.job.data.state}`), redirect: "?view=import" };
  },
  importCancel: async (ctx) => { await I.cancel(ctx); return { ok: ctx.t("impCancelled"), redirect: "?view=import" }; },
  importClose: async (ctx) => { await I.cancel(ctx); return { ok: ctx.t("impClosed"), redirect: "?view=import" }; },
};
