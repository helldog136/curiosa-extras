// Cahier de contenu — l'administration : la liste (un gros bouton « J'ai une idée ! », les endroits, la recherche) et la page d'une idée.
// Pensé pour le téléphone d'abord : des cartes entières cliquables, des cibles de 44 px, jamais de glisser-déposer.
// Le glisser-déposer, lui, n'existe pas ici : le panneau d'un module est fait de blocs du cœur, qui n'en offrent pas. On range une idée avec un menu de boutons.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins
const D = await import(`./data.mjs${v}`);
const V = await import(`./view.mjs${v}`);
const { PLACES, LIMITS, MAX_IDEAS, MAX_STEPS, MAX_NETWORKS } = D;

const canDo = (ctx, right) => (typeof ctx.can === "function" ? ctx.can(right) : true);
const title0 = (ctx, idea) => idea.title || ctx.t("untitled");

// ── Les phrases douces du haut de la page ─────────────────────────────────────────────────────────────────
function nextHint(ctx, ideas) {
  const doing = D.inPlace(ideas, "doing").sort(D.compare)[0];
  if (doing) return ctx.t("hintDoing", { title: title0(ctx, doing) });
  return ideas.some((i) => i.column === "idea" && !i.archived) ? ctx.t("hintPick") : ctx.t("hintAdd");
}

/** Le rythme (facultatif) et les dates visées passées, en phrases qui encouragent et ne reprochent jamais. Calculé à la lecture. */
export function gentleLines(ctx, ideas, today) {
  const lines = [];
  const rhythm = D.rhythmOf(ctx);
  if (rhythm) {
    const every = ctx.t(`every_${rhythm.period}`, { n: rhythm.count });
    const s = D.rhythmStatus(ideas, rhythm, today);
    const date = s.last ? V.fmtDate(ctx, s.last) : "";
    if (s.state === "start") lines.push(ctx.t("rhythmStart", { every }));
    else if (s.state === "ok") lines.push(ctx.t("rhythmOk", { every, date }));
    else if (s.state === "behind") lines.push(ctx.t("rhythmBehind", { every, days: s.since, date, next: nextHint(ctx, ideas) }));
    else lines.push(ctx.t("rhythmPause", { every, date, next: nextHint(ctx, ideas) }));
  }
  const late = ideas.filter((i) => D.isLate(i, today)).length;
  if (late) lines.push(ctx.t(late === 1 ? "lateOne" : "lateMany", { n: late }));
  return lines;
}

// ── La liste ──────────────────────────────────────────────────────────────────────────────────────────────
function listPage(ctx, ideas, query, today, gone) {
  const t = ctx.t;
  const q = D.line(query.q, LIMITS.query);
  const words = D.searchWords(q);
  const searching = words.length > 0;
  const place = PLACES.includes(query.col) ? query.col : "idea";
  const cnt = D.counts(ideas);
  const blocks = [V.styleBlock(), { type: "markdown", text: `*${t("private")}*` }];
  if (gone) blocks.push(V.note([t("ideaGone")]));
  const lines = gentleLines(ctx, ideas, today);
  if (lines.length) blocks.push(V.note(lines));
  blocks.push({ type: "adminForm", action: "quickAdd", submitLabel: t("quickAdd"), fields: [{ name: "quickTitle", label: t("quickTitle"), help: t("quickHelp") }] });

  let list, linkFor, current;
  if (searching) {
    list = ideas.filter((i) => D.matches(i, words)).sort(D.compare);
    linkFor = (p) => V.href({ q, page: p });
    blocks.push(V.note([t("resultsFor", { q, n: list.length })]));
    blocks.push({ type: "html", html: `<p style="margin:0"><a class="cp-link" href="?">${V.esc(t("clearSearch"))}</a></p>` });
  } else {
    list = D.inPlace(ideas, place).sort(D.compare);
    linkFor = (p) => V.href({ col: place, page: p });
    blocks.push(V.tabs(ctx, place, cnt, (p) => V.href({ col: p })));
  }
  if (ideas.length >= 8 || searching) {
    blocks.push({ type: "adminForm", action: "search", title: t("searchTitle"), submitLabel: t("search"), fields: [{ name: "q", label: t("searchLabel"), help: t("searchHelp"), value: q }] });
  }

  const pg = D.pageOf(list, D.pageNumber(query.page));
  if (!pg.items.length) {
    blocks.push(V.empty(searching ? t("emptySearch") : ideas.length === 0 ? t("emptyAll") : t(`empty_${place}`)));
  } else {
    const items = pg.items.map((i) => V.card(ctx, i, today, V.href({ idea: i.id, col: searching ? placeOfCol(i) : place, q: searching ? q : "", page: pg.page }), { withPlace: searching }));
    blocks.push({ type: "html", html: `<ul class="cp-list">${items.join("")}</ul>` });
  }
  const pager = V.pager(ctx, pg.page, pg.pages, linkFor);
  if (pager) blocks.push(pager);

  if (ideas.length && canDo(ctx, "ideas.export")) {
    blocks.push({ type: "heading", text: t("copyTitle") }, { type: "markdown", text: t("copyText", { max: MAX_IDEAS }) }, { type: "download", name: "ideas", label: t("download") });
  }
  return blocks;
}
const placeOfCol = (i) => D.placeOf(i);

// ── La page d'une idée ────────────────────────────────────────────────────────────────────────────────────
function ideaPage(ctx, idea, query, today) {
  const t = ctx.t;
  const place = D.placeOf(idea);
  const backCol = PLACES.includes(query.col) ? query.col : place;
  const back = V.href({ col: query.q ? "" : backCol, q: D.line(query.q, LIMITS.query), page: query.page });
  const blocks = [V.styleBlock(), V.backLink(ctx, back, query.q ? t("backSearch") : t("backTo", { place: t(`tab_${backCol}`) })), { type: "heading", text: title0(ctx, idea) }];
  const head = [idea.summary ? `<p class="cp-sub">${V.esc(idea.summary)}</p>` : "", V.chipsOf(ctx, idea, today, { withPlace: true, maxNetworks: MAX_NETWORKS }), idea.by === "assistant" ? `<p class="cp-sub">${V.esc(t("byAssistant"))}</p>` : ""].filter(Boolean).join("");
  blocks.push({ type: "html", html: `<div>${head}</div>` });
  if (D.isLate(idea, today)) blocks.push(V.note([t("lateIdea")]));
  if (idea.archived) blocks.push(V.note([t("archivedNote")]));

  // Où ranger l'idée : un menu de boutons (une ligne par endroit).
  blocks.push({ type: "heading", text: t("moveTitle") });
  blocks.push({ type: "table", columns: [t("moveColumn")], rows: PLACES.map((p) => [`${p === place ? "✔ " : ""}${t(`place_${p}`)}`]), rowIds: PLACES.map((p) => `${idea.id}~${p}`), rowActions: [{ label: t("moveHere"), action: "moveIdea" }] });

  if (idea.steps.length) {
    blocks.push({ type: "adminForm", action: "saveSteps", title: t("stepsTitle"), submitLabel: t("saveSteps"), fields: [
      { name: "id", kind: "hidden", value: idea.id },
      { name: "n", kind: "hidden", value: String(idea.steps.length) },
      ...idea.steps.map((s, i) => ({ name: `step_${i}`, kind: "checkbox", label: s.label, value: s.done ? "on" : "" })),
    ] });
  } else blocks.push({ type: "markdown", text: t("noSteps") });

  const offered = D.suggestions(ctx);
  const mine = new Set(idea.networks.map(D.fold));
  const offeredKeys = new Set(offered.map(D.fold));
  blocks.push({ type: "adminForm", action: "saveWhen", title: t("whenTitle"), submitLabel: t("saveWhen"), fields: [
    { name: "id", kind: "hidden", value: idea.id },
    { name: "netNames", kind: "hidden", value: offered.join("\n") },
    { name: "targetDate", kind: "date", label: t("targetDate"), help: t("targetHelp"), value: idea.targetDate },
    ...(idea.column === "published" ? [{ name: "publishedAt", kind: "date", label: t("publishedAt"), value: idea.publishedAt }] : []),
    ...offered.map((n, i) => ({ name: `net_${i}`, kind: "checkbox", label: n, value: mine.has(D.fold(n)) ? "on" : "" })),
    { name: "otherNetworks", label: t("otherNetworks"), help: t("otherHelp"), value: idea.networks.filter((n) => !offeredKeys.has(D.fold(n))).join(", ") },
  ] });

  blocks.push({ type: "adminForm", action: "saveText", title: t("textTitle"), submitLabel: t("saveText"), fields: [
    { name: "id", kind: "hidden", value: idea.id },
    { name: "title", label: t("fieldTitle"), value: idea.title },
    { name: "summary", label: t("fieldSummary"), help: t("summaryHelp"), value: idea.summary },
    { name: "notes", kind: "textarea", label: t("fieldNotes"), help: t("notesHelp"), value: idea.notes },
    { name: "stepsText", kind: "textarea", label: t("fieldSteps"), help: t("stepsHelp", { max: MAX_STEPS }), value: idea.steps.map((s) => s.label).join("\n") },
  ] });

  if (idea.archived) {
    blocks.push({ type: "heading", text: t("deleteTitle") }, { type: "markdown", text: t("deleteText") });
    blocks.push({ type: "table", columns: [t("deleteColumn")], rows: [[title0(ctx, idea)]], rowIds: [idea.id], rowActions: [{ label: t("deleteButton"), action: "deleteIdea", danger: true, confirm: t("deleteConfirm", { title: title0(ctx, idea) }) }] });
  }
  return blocks;
}

// ── Les actions ───────────────────────────────────────────────────────────────────────────────────────────
/** Vérifie un titre : `{ title }` ou `{ error }` (phrase avec un exemple). */
export function checkTitle(ctx, raw) {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!s) return { error: ctx.t("errTitleEmpty") };
  if (s.length > LIMITS.title) return { error: ctx.t("errTitleLong", { max: LIMITS.title }) };
  return { title: D.line(s, LIMITS.title) };
}
const badDate = (ctx) => ctx.t("errDate", { example: D.addDays(D.todayOf(ctx), 7) });

async function load(ctx, id) {
  const idea = await D.getIdea(ctx, id);
  return idea ?? null;
}

const actions = {
  // Un titre, et c'est noté. Le reste vient après.
  quickAdd: async (ctx, v0) => {
    const r = checkTitle(ctx, v0.quickTitle);
    if (r.error) return { errors: { quickTitle: r.error } };
    const made = await D.addIdea(ctx, { title: r.title });
    if (made.full) return { errors: { quickTitle: ctx.t("errFull", { max: MAX_IDEAS }) } };
    return { ok: ctx.t("added", { title: r.title }) };
  },
  // La recherche ne change rien : elle renvoie simplement vers la liste filtrée.
  search: async (ctx, v0) => {
    const q = D.line(v0.q, LIMITS.query);
    return { redirect: V.href({ q }) };
  },
  moveIdea: async (ctx, v0) => {
    const [id, to] = String(v0.id ?? "").split("~");
    if (!PLACES.includes(to)) return { error: ctx.t("errGeneric") };
    const idea = await load(ctx, id);
    if (!idea) return { error: ctx.t("errGone") };
    if (D.placeOf(idea) === to) return { ok: ctx.t("alreadyThere", { place: ctx.t(`place_${to}`) }) };
    await D.saveIdea(ctx, D.placeIdea(idea, to, D.todayOf(ctx)));
    return { ok: ctx.t("moved", { place: ctx.t(`place_${to}`) }), redirect: V.href({ idea: id, col: to }) };
  },
  saveSteps: async (ctx, v0) => {
    const idea = await load(ctx, v0.id);
    if (!idea) return { error: ctx.t("errGone") };
    if (Number(v0.n) !== idea.steps.length) return { error: ctx.t("errChanged") };
    const steps = idea.steps.map((s, i) => ({ label: s.label, done: v0[`step_${i}`] === "on" }));
    await D.saveIdea(ctx, { ...idea, steps });
    const done = steps.filter((s) => s.done).length;
    return { ok: ctx.t("stepsSaved", { done, total: steps.length }) };
  },
  saveWhen: async (ctx, v0) => {
    const idea = await load(ctx, v0.id);
    if (!idea) return { error: ctx.t("errGone") };
    const errors = {};
    const date = String(v0.targetDate ?? "").trim();
    const targetDate = D.validDate(date);
    if (date && !targetDate) errors.targetDate = badDate(ctx);
    let publishedAt = idea.publishedAt;
    if (idea.column === "published" && v0.publishedAt !== undefined) {
      const raw = String(v0.publishedAt ?? "").trim();
      publishedAt = D.validDate(raw) || (raw ? "" : D.todayOf(ctx));
      if (raw && !D.validDate(raw)) errors.publishedAt = badDate(ctx);
    }
    const names = String(v0.netNames ?? "").split("\n").map((n) => D.line(n, LIMITS.network)).slice(0, MAX_NETWORKS);
    const ticked = names.filter((n, i) => n && v0[`net_${i}`] === "on");
    const otherRaw = String(v0.otherNetworks ?? "").split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
    const longOne = otherRaw.find((x) => x.length > LIMITS.network);
    const networks = D.parseNetworks([...ticked, ...otherRaw]);
    if (longOne) errors.otherNetworks = ctx.t("errNetworkLong", { max: LIMITS.network, name: D.line(longOne, 24) });
    else if (new Set([...ticked, ...otherRaw].map(D.fold)).size > MAX_NETWORKS) errors.otherNetworks = ctx.t("errNetworks", { max: MAX_NETWORKS });
    if (Object.keys(errors).length) return { errors };
    await D.saveIdea(ctx, { ...idea, targetDate, publishedAt, networks });
    return { ok: ctx.t("saved") };
  },
  saveText: async (ctx, v0) => {
    const idea = await load(ctx, v0.id);
    if (!idea) return { error: ctx.t("errGone") };
    const errors = {};
    const tt = checkTitle(ctx, v0.title);
    if (tt.error) errors.title = tt.error;
    const summaryRaw = String(v0.summary ?? "").replace(/\s+/g, " ").trim();
    if (summaryRaw.length > LIMITS.summary) errors.summary = ctx.t("errSummaryLong", { max: LIMITS.summary });
    const notesRaw = String(v0.notes ?? "");
    if (notesRaw.trim().length > LIMITS.notes) errors.notes = ctx.t("errNotesLong", { max: LIMITS.notes });
    const lines = String(v0.stepsText ?? "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    const longStep = lines.find((x) => x.length > LIMITS.step);
    const labels = D.parseStepLines(lines);
    if (longStep) errors.stepsText = ctx.t("errStepLong", { max: LIMITS.step, step: D.line(longStep, 24) });
    else if (new Set(lines.map(D.fold)).size > MAX_STEPS) errors.stepsText = ctx.t("errSteps", { max: MAX_STEPS });
    if (Object.keys(errors).length) return { errors };
    await D.saveIdea(ctx, { ...idea, title: tt.title, summary: D.line(summaryRaw, LIMITS.summary), notes: D.para(notesRaw, LIMITS.notes), steps: D.mergeSteps(idea.steps, labels) });
    return { ok: ctx.t("saved") };
  },
  // Suppression définitive : seulement une idée déjà archivée (l'écran la propose avec une confirmation en clair).
  deleteIdea: async (ctx, v0) => {
    const idea = await load(ctx, v0.id);
    if (!idea) return { error: ctx.t("errGone") };
    if (!idea.archived) return { error: ctx.t("errDeleteFirst") };
    await ctx.api.store.remove(idea.id);
    return { ok: ctx.t("deleted"), redirect: V.href({ col: "archived" }) };
  },
};

export default {
  async adminPanel(ctx, { query }) {
    const q = query && typeof query === "object" ? query : {};
    const ideas = await D.loadAll(ctx);
    const today = D.todayOf(ctx);
    const idea = typeof q.idea === "string" ? ideas.find((i) => i.id === q.idea) : null;
    if (idea) return ideaPage(ctx, idea, q, today);
    return listPage(ctx, ideas, q, today, typeof q.idea === "string" && q.idea !== "");
  },
  adminActions: actions,
};
