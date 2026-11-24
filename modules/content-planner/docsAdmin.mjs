// Content notebook: the "Documents" area of an idea, its reading screen, the three windows (new document, edit, new version) and their actions.
// Everything a person typed is escaped in view.mjs (`esc`) or by the core (table cells, form values); this file never builds HTML from raw text.
const v = new URL(import.meta.url).search; // the module version travels to the sibling files
const D = await import(`./data.mjs${v}`);
const V = await import(`./view.mjs${v}`);
const X = await import(`./documents.mjs${v}`);
const { DOC_LIMITS, MAX_DOCS_PER_IDEA, MAX_CHARS_PER_IDEA, MAX_DOCS_TOTAL } = X;

const num = (ctx, n) => { try { return new Intl.NumberFormat(String(ctx.locale ?? "en")).format(n); } catch { return String(n); } };
const day = (iso) => String(iso ?? "").slice(0, 10);
const docName = (ctx, doc) => doc.title || ctx.t("untitled");

/** The address of a screen of the idea page, keeping where the person came from (place, search, page). */
const link = (idea, q, extra = {}) => V.href({ idea: idea.id, col: q.col, q: q.q, page: q.page, ...extra });
const withRow = (href) => href.replace("%7Bid%7D", "{id}");

// ── The area on the idea page ─────────────────────────────────────────────────────────────────────────────────
function addButton(ctx, idea, q, label, quiet = false) {
  return { type: "html", html: `<p class="cp-actions" style="margin:0"><a class="cp-btn${quiet ? " cp-btn-quiet" : ""}" href="${V.esc(link(idea, q, { newDoc: 1 }))}">${V.esc(label)}</a></p>` };
}

/** The "Documents" heading, then the empty state with one button, or the table of documents. */
export function docsSection(ctx, idea, docs, q) {
  const t = ctx.t;
  const blocks = [{ type: "heading", text: t("docsTitle") }];
  if (!docs.length) {
    blocks.push(V.empty(t("docsEmpty")), addButton(ctx, idea, q, t("docAddFirst")));
    return blocks;
  }
  if (docs.length < MAX_DOCS_PER_IDEA) blocks.push(addButton(ctx, idea, q, t("docAdd")));
  else blocks.push(V.note([t("errDocTooMany", { max: MAX_DOCS_PER_IDEA })]));
  blocks.push({
    type: "table",
    columns: [t("docColumn"), t("docVersion"), t("docEdited"), t("docLength")],
    rowIds: docs.map((d) => d.id),
    searchable: true,
    truncate: [0],
    rows: docs.map((d) => [
      { text: docName(ctx, d), title: docName(ctx, d) },
      d.version ? { text: d.version, badge: "neutral" } : "",
      V.fmtDate(ctx, day(d.updatedAt)),
      t("docChars", { n: num(ctx, d.text.length) }),
    ]),
    rowActions: [
      { label: t("docRead"), href: withRow(link(idea, q, { doc: "{id}" })) },
      { label: t("docEdit"), href: withRow(link(idea, q, { editDoc: "{id}" })), presentation: "dialog" },
      { label: t("docNewVersion"), href: withRow(link(idea, q, { versionDoc: "{id}" })), presentation: "dialog", inMenu: true },
      { label: t("docDelete"), action: "deleteDoc", danger: true, confirm: t("docRowDeleteConfirm") },
    ],
  });
  return blocks;
}

// ── The windows ───────────────────────────────────────────────────────────────────────────────────────────────
const hidden = (name, value) => ({ name, kind: "hidden", label: name, value });

/** The form the address asks for (`newDoc`, `editDoc` or `versionDoc`), shown in a window; null when none is asked or the document does not exist. */
// No field is marked `required`: the browser would block the send with its own English bubble and the readable error under the field (R22) would never show. The server checks and answers.
export function docDialog(ctx, idea, docs, q, cancelHref) {
  const t = ctx.t;
  if (q.newDoc) {
    return {
      type: "adminForm", presentation: "dialog", action: "saveDoc", cancelHref, title: t("docNewTitle"), submitLabel: t("docNewSubmit"),
      fields: [
        hidden("idea", idea.id), hidden("id", ""),
        { name: "title", label: t("docFieldTitle"), value: "", example: t("docTitleExample") },
        { name: "text", kind: "textarea", label: t("docFieldText"), placeholder: t("docTextPlaceholder", { max: num(ctx, DOC_LIMITS.text) }), value: "" },
        // Empty and folded: "More options" opens by itself when a folded field has a value, which would put the rare field back in the short path. An empty version is stored as v1.
        { name: "version", label: t("docFieldVersion"), folded: true, value: "", placeholder: X.DEFAULT_VERSION, example: t("docVersionExample") },
      ],
    };
  }
  const doc = docs.find((d) => d.id === (q.editDoc || q.versionDoc));
  if (!doc) return null;
  if (q.editDoc) {
    return {
      type: "adminForm", presentation: "dialog", action: "saveDoc", cancelHref, title: t("docEditTitle"), submitLabel: t("docEditSubmit"),
      secondaryAction: { label: t("docDeleteButton"), action: "deleteDoc", confirm: t("docDeleteConfirm", { title: docName(ctx, doc), n: num(ctx, doc.text.length) }) },
      fields: [
        hidden("idea", idea.id), hidden("id", doc.id),
        { name: "title", label: t("docFieldTitle"), value: doc.title, example: t("docTitleExample") },
        { name: "version", label: t("docFieldVersion"), value: doc.version, example: t("docVersionExample") },
        { name: "text", kind: "textarea", label: t("docFieldText"), placeholder: t("docTextPlaceholder", { max: num(ctx, DOC_LIMITS.text) }), value: doc.text },
      ],
    };
  }
  return {
    type: "adminForm", presentation: "dialog", action: "newVersion", cancelHref, title: t("docVersionTitle"), submitLabel: t("docVersionSubmit"),
    fields: [
      hidden("idea", idea.id), hidden("id", doc.id),
      { name: "version", label: t("docVersionField"), value: X.nextVersion(doc.version), example: t("docVersionExample"), help: t("docVersionHelp", { title: docName(ctx, doc), version: doc.version || "—" }) },
    ],
  };
}

// ── The reading screen ────────────────────────────────────────────────────────────────────────────────────────
export function readPage(ctx, idea, doc, docs, q) {
  const t = ctx.t;
  const back = link(idea, q);
  const chips = [doc.version ? V.chipHtml(doc.version) : "", V.chipHtml(t("docChars", { n: num(ctx, doc.text.length) })), V.chipHtml(t("docChipEdited", { date: V.fmtDate(ctx, day(doc.updatedAt)) }))].filter(Boolean);
  const blocks = [V.styleBlock(), V.backLink(ctx, back, t("docBack", { title: idea.title || t("untitled") })), { type: "heading", text: docName(ctx, doc) }];
  blocks.push({ type: "html", html: `<div><span class="cp-chips" style="margin-top:0">${chips.join("")}</span>${doc.updatedBy === "assistant" ? `<p class="cp-sub">${V.esc(t("docByAssistant"))}</p>` : ""}</div>` });
  blocks.push(doc.text ? { type: "html", html: `<pre class="cp-notes cp-doc" tabindex="0" aria-label="${V.esc(docName(ctx, doc))}">${V.esc(doc.text)}</pre>` } : V.empty(t("docEmptyText")));
  const edit = link(idea, q, { doc: doc.id, editDoc: doc.id });
  const version = link(idea, q, { doc: doc.id, versionDoc: doc.id });
  blocks.push({ type: "html", html: `<p class="cp-actions" style="margin:0"><a class="cp-btn" href="${V.esc(edit)}">${V.esc(t("docReadEdit"))}</a><a class="cp-btn cp-btn-quiet" href="${V.esc(version)}">${V.esc(t("docReadVersion"))}</a></p>` });
  const dialog = docDialog(ctx, idea, docs, { ...q, newDoc: undefined }, link(idea, q, { doc: doc.id }));
  if (dialog) blocks.push(dialog);
  return blocks;
}

// ── The actions ───────────────────────────────────────────────────────────────────────────────────────────────
const messageOf = (ctx, p) => ctx.t({ titleEmpty: "errDocTitleEmpty", titleLong: "errDocTitleLong", versionLong: "errDocVersionLong", textLong: "errDocTextLong" }[p.code], { max: num(ctx, p.max ?? 0) });
const capMessage = (ctx, code) => ctx.t({ tooMany: "errDocTooMany", tooBig: "errDocTooBig", full: "errDocsFull" }[code], { max: num(ctx, { tooMany: MAX_DOCS_PER_IDEA, tooBig: MAX_CHARS_PER_IDEA, full: MAX_DOCS_TOTAL }[code]) });

export function docActions(load) {
  return {
    // Adds a document (no `id`) or saves one (with its `id`): same form, same checks.
    saveDoc: async (ctx, v0) => {
      const idea = await load(ctx, v0.idea);
      if (!idea) return { error: ctx.t("errGone") };
      const docs = await X.docsOf(ctx, idea.id);
      const existing = v0.id ? docs.find((d) => d.id === v0.id) : null;
      if (v0.id && !existing) return { error: ctx.t("errDocGone") };
      const { values, problems } = X.check({ title: v0.title, version: v0.version, text: v0.text });
      if (problems.length) return { errors: Object.fromEntries(problems.map((p) => [p.field, messageOf(ctx, p)])) };
      const textLength = (values.text ?? existing?.text ?? "").length;
      const cap = await X.capProblem(ctx, docs, { adding: !existing, replacing: existing?.id ?? null, textLength });
      if (cap) return { errors: { [cap === "tooBig" ? "text" : "title"]: capMessage(ctx, cap) } };
      const chars = num(ctx, textLength);
      if (!existing) {
        const doc = await X.addDoc(ctx, idea.id, { title: values.title, version: values.version || X.DEFAULT_VERSION, text: values.text ?? "" });
        return { ok: ctx.t("docAdded", { title: doc.title, n: chars }) };
      }
      const saved = await X.saveDoc(ctx, { ...existing, ...values });
      if (!saved) return { error: ctx.t("errDocGone") };
      return { ok: ctx.t("docSaved", { title: saved.title, n: chars }) };
    },
    // Copies a document under a new version label: the old one stays as it is.
    newVersion: async (ctx, v0) => {
      const idea = await load(ctx, v0.idea);
      if (!idea) return { error: ctx.t("errGone") };
      const docs = await X.docsOf(ctx, idea.id);
      const source = docs.find((d) => d.id === v0.id);
      if (!source) return { error: ctx.t("errDocGone") };
      const { values, problems } = X.check({ version: v0.version }, { requireTitle: false });
      if (problems.length) return { errors: { version: messageOf(ctx, problems[0]) } };
      if (!values.version) return { errors: { version: ctx.t("errDocVersionEmpty") } };
      const cap = await X.capProblem(ctx, docs, { adding: true, textLength: source.text.length });
      if (cap) return { errors: { version: capMessage(ctx, cap) } };
      const doc = await X.addDoc(ctx, idea.id, { title: source.title, version: values.version, text: source.text });
      return { ok: ctx.t("docVersionMade", { version: doc.version, from: source.version || docName(ctx, source) }) };
    },
    // Deleting is for the owner only (the assistant has no such tool): the confirmation of the screen says what is lost.
    deleteDoc: async (ctx, v0) => {
      const doc = await X.getDoc(ctx, v0.idea ? String(v0.idea) : null, v0.id);
      if (!doc) return { error: ctx.t("errDocGone") };
      await X.removeDoc(ctx, doc);
      return { ok: ctx.t("docDeleted", { title: docName(ctx, doc) }) };
    },
  };
}
