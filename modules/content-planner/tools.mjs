// Content notebook: the tools for the AI assistant (MCP). Ten tools: list, read, add, change, move, tick a step, and four for the documents of an idea (list, read, add, change).
// Writes are explicit (none is granted by default) and touch ONLY the ideas and documents of this notebook: the assistant never reads the data of another module.
// These tools delete nothing: "archived" is a place like any other, and an idea comes back from it. Error messages are in plain English, for the assistant.
const v = new URL(import.meta.url).search; // the module version travels to the sibling files
const D = await import(`./data.mjs${v}`);
const X = await import(`./documents.mjs${v}`);
const { PLACES, LIMITS, MAX_IDEAS, MAX_STEPS, MAX_NETWORKS } = D;

const fail = (message) => Object.assign(new Error(message), { expose: true });
const LIST_DEFAULT = 20, LIST_MAX = 50;

/** An idea for the assistant (the notes only when `full`). */
export function present(idea, today, full = false, docCount = undefined) {
  return {
    id: idea.id,
    title: idea.title,
    summary: idea.summary,
    place: D.placeOf(idea),
    steps: idea.steps.map((s, i) => ({ number: i + 1, name: s.label, done: s.done })),
    stepsDone: D.stepsDone(idea),
    targetDate: idea.targetDate || null,
    late: D.isLate(idea, today),
    publishedAt: idea.publishedAt || null,
    networks: idea.networks,
    ...(full ? { notes: idea.notes, createdAt: idea.createdAt, updatedAt: idea.updatedAt, addedBy: idea.by } : {}),
    ...(full && docCount !== undefined ? { documentCount: docCount } : {}),
  };
}

/** A document for the assistant: the text only when `full`. */
export function presentDoc(doc, full = false) {
  return {
    id: doc.id,
    title: doc.title,
    version: doc.version,
    characters: doc.text.length,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    addedBy: doc.by,
    ...(full ? { text: doc.text } : {}),
  };
}
const DOC_PROBLEMS = {
  titleEmpty: () => "title is required: write a few words, for example \"Video script\".",
  titleLong: (p) => `title is too long (${p.max} characters at most).`,
  versionLong: (p) => `version is too long (${p.max} characters at most): something short like "v2" or "final".`,
  textLong: (p) => `text is too long (${p.max} characters at most). Split it into two documents.`,
};
const CAP_PROBLEMS = {
  tooMany: () => `An idea holds ${X.MAX_DOCS_PER_IDEA} documents at most. Ask the owner to delete one in the notebook.`,
  tooBig: () => `The documents of an idea hold ${X.MAX_CHARS_PER_IDEA} characters in all, at most. Shorten a text or ask the owner to delete an old version.`,
  full: () => `The notebook holds ${X.MAX_DOCS_TOTAL} documents at most. Ask the owner to delete some.`,
};

const encodeCursor = (n) => Buffer.from(`o${n}`).toString("base64url");
const decodeCursor = (c) => { try { const m = /^o(\d{1,6})$/.exec(Buffer.from(String(c), "base64url").toString()); return m ? Number(m[1]) : 0; } catch { return 0; } };

async function need(ctx, id) {
  const idea = await D.getIdea(ctx, id);
  if (!idea) throw fail("No idea with this id. Use ideas_list to find the id.");
  return idea;
}
function cleanDate(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const d = D.validDate(s);
  if (!d) throw fail("targetDate must be a real day written YYYY-MM-DD, for example 2026-11-14.");
  return d;
}
function cleanTitle(raw) {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!s) throw fail("title is required: write a few words.");
  if (s.length > LIMITS.title) throw fail(`title is too long (${LIMITS.title} characters at most). Keep the essentials; details go in notes.`);
  return D.line(s, LIMITS.title);
}
function cleanNetworks(list) {
  const raw = (Array.isArray(list) ? list : []).map((x) => String(x ?? "").trim()).filter(Boolean);
  const out = D.parseNetworks(raw);
  if (out.length > MAX_NETWORKS || new Set(raw.map(D.fold)).size > MAX_NETWORKS) throw fail(`At most ${MAX_NETWORKS} networks per idea.`);
  return out;
}

async function needDoc(ctx, ideaId, docId) {
  const doc = await X.getDoc(ctx, ideaId, String(docId ?? ""));
  if (!doc) throw fail("No document with this id in this idea. Use idea_doc_list to find the id.");
  return doc;
}
function checkedDoc(fields, opts) {
  const { values, problems } = X.check(fields, opts);
  if (problems.length) throw fail(problems.map((p) => DOC_PROBLEMS[p.code](p)).join(" "));
  return values;
}

export default {
  mcp: {
    async ideas_list(ctx, args) {
      const place = args.place ?? "active";
      const words = D.searchWords(args.q);
      const today = D.todayOf(ctx);
      let list = (await D.loadAll(ctx)).filter((i) => D.matches(i, words));
      if (PLACES.includes(place)) list = list.filter((i) => D.placeOf(i) === place);
      else if (place === "active") list = list.filter((i) => !i.archived);
      list.sort(D.compare);
      const limit = Math.min(LIST_MAX, Math.max(1, Number.isInteger(args.limit) ? args.limit : LIST_DEFAULT));
      const from = args.cursor ? decodeCursor(args.cursor) : 0;
      const items = list.slice(from, from + limit).map((i) => present(i, today));
      const next = from + limit < list.length ? encodeCursor(from + limit) : null;
      // With no cursor and no next page, a plain array (like the core lists); otherwise { items, next }.
      return !args.cursor && next === null ? items : { items, next };
    },

    async idea_get(ctx, args) {
      const idea = await need(ctx, args.id);
      return present(idea, D.todayOf(ctx), true, (await X.docsOf(ctx, idea.id)).length);
    },

    async idea_add(ctx, args) {
      const title = cleanTitle(args.title);
      const summary = String(args.summary ?? "").replace(/\s+/g, " ").trim();
      if (summary.length > LIMITS.summary) throw fail(`summary is too long (${LIMITS.summary} characters at most): one sentence is enough.`);
      const notes = String(args.notes ?? "");
      if (notes.trim().length > LIMITS.notes) throw fail(`notes are too long (${LIMITS.notes} characters at most).`);
      const targetDate = cleanDate(args.targetDate);
      const networks = cleanNetworks(args.networks);
      let steps;
      if (Array.isArray(args.steps)) {
        const raw = args.steps.map((x) => String(x ?? "").trim()).filter(Boolean);
        if (raw.some((x) => x.length > LIMITS.step)) throw fail(`A step name is too long (${LIMITS.step} characters at most).`);
        if (new Set(raw.map(D.fold)).size > MAX_STEPS) throw fail(`At most ${MAX_STEPS} steps per idea.`);
        steps = D.stepsFromLabels(D.parseStepLines(raw));
      }
      const made = await D.addIdea(ctx, { title, summary: D.line(summary, LIMITS.summary), column: args.place === "doing" ? "doing" : "idea", targetDate, networks, notes: D.para(notes, LIMITS.notes), steps }, { by: "assistant" });
      if (made.full) throw fail(`The notebook is full (${MAX_IDEAS} ideas). Ask the owner to delete old archived ideas.`);
      return present(made.idea, D.todayOf(ctx), true, 0);
    },

    async idea_update(ctx, args) {
      const idea = await need(ctx, args.id);
      const next = { ...idea };
      if (args.title !== undefined) next.title = cleanTitle(args.title);
      if (args.summary !== undefined) {
        const s = String(args.summary).replace(/\s+/g, " ").trim();
        if (s.length > LIMITS.summary) throw fail(`summary is too long (${LIMITS.summary} characters at most): one sentence is enough.`);
        next.summary = D.line(s, LIMITS.summary);
      }
      if (args.targetDate !== undefined) next.targetDate = cleanDate(args.targetDate);
      if (args.networks !== undefined) next.networks = cleanNetworks(args.networks);
      if (args.notes !== undefined) {
        if (String(args.notes).trim().length > LIMITS.notes) throw fail(`notes are too long (${LIMITS.notes} characters at most).`);
        next.notes = D.para(args.notes, LIMITS.notes);
      }
      const saved = await D.saveIdea(ctx, next);
      if (!saved) throw fail("The idea disappeared while it was being changed.");
      return present(saved, D.todayOf(ctx), true, (await X.docsOf(ctx, idea.id)).length);
    },

    async idea_move(ctx, args) {
      if (!PLACES.includes(args.to)) throw fail("to must be one of: idea, doing, published, archived.");
      const idea = await need(ctx, args.id);
      const saved = await D.saveIdea(ctx, D.placeIdea(idea, args.to, D.todayOf(ctx)));
      if (!saved) throw fail("The idea disappeared while it was being moved.");
      return present(saved, D.todayOf(ctx));
    },

    async idea_step(ctx, args) {
      const idea = await need(ctx, args.id);
      if (!idea.steps.length) throw fail("This idea has no steps. Steps can be added in the notebook.");
      const wanted = String(args.step ?? "").trim();
      let at = idea.steps.findIndex((s) => D.fold(s.label) === D.fold(wanted));
      if (at < 0 && /^\d{1,2}$/.test(wanted) && Number(wanted) >= 1 && Number(wanted) <= idea.steps.length) at = Number(wanted) - 1;
      if (at < 0) throw fail(`No such step. The steps are: ${idea.steps.map((s, i) => `${i + 1}. ${s.label}`).join("; ")}.`);
      const steps = idea.steps.map((s, i) => (i === at ? { ...s, done: args.done !== false } : s));
      const saved = await D.saveIdea(ctx, { ...idea, steps });
      if (!saved) throw fail("The idea disappeared while it was being changed.");
      return present(saved, D.todayOf(ctx));
    },

    // ── Documents of an idea (a script, an outline…): list, read, add, change. There is no tool to delete one: only the owner deletes, in the notebook.
    async idea_doc_list(ctx, args) {
      const idea = await need(ctx, args.id);
      const docs = await X.docsOf(ctx, idea.id);
      return { idea: idea.title, documents: docs.map((d) => presentDoc(d)) };
    },

    async idea_doc_get(ctx, args) {
      const idea = await need(ctx, args.id);
      return presentDoc(await needDoc(ctx, idea.id, args.doc), true);
    },

    async idea_doc_add(ctx, args) {
      const idea = await need(ctx, args.id);
      const values = checkedDoc({ title: args.title, version: args.version ?? X.DEFAULT_VERSION, text: args.text ?? "" });
      const docs = await X.docsOf(ctx, idea.id);
      const cap = await X.capProblem(ctx, docs, { adding: true, textLength: values.text.length });
      if (cap) throw fail(CAP_PROBLEMS[cap]());
      return presentDoc(await X.addDoc(ctx, idea.id, values, { by: "assistant" }), true);
    },

    async idea_doc_update(ctx, args) {
      const idea = await need(ctx, args.id);
      const doc = await needDoc(ctx, idea.id, args.doc);
      if (args.title === undefined && args.version === undefined && args.text === undefined) throw fail("Nothing to change: give a title, a version or a text.");
      const values = checkedDoc({ title: args.title, version: args.version, text: args.text }, { requireTitle: false });
      const next = { ...doc, ...values };
      if (values.text !== undefined) {
        const cap = await X.capProblem(ctx, await X.docsOf(ctx, idea.id), { adding: false, replacing: doc.id, textLength: next.text.length });
        if (cap) throw fail(CAP_PROBLEMS[cap]());
      }
      const saved = await X.saveDoc(ctx, next, { by: "assistant" });
      if (!saved) throw fail("The document disappeared while it was being changed.");
      return presentDoc(saved, true);
    },
  },
};
