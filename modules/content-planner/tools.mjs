// Cahier de contenu — les outils pour l'assistant IA (MCP). Six outils : lister, lire, ajouter, modifier, déplacer, cocher une étape.
// Les écritures sont explicites (aucune n'est accordée d'office) et ne touchent QUE les idées de ce cahier : l'assistant ne lit jamais les données d'un autre module.
// Rien n'est supprimé par ces outils : « archivée » est un endroit comme un autre, et on en ressort. Les messages d'erreur sont en anglais simple, pour l'assistant.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins
const D = await import(`./data.mjs${v}`);
const { PLACES, LIMITS, MAX_IDEAS, MAX_STEPS, MAX_NETWORKS } = D;

const fail = (message) => Object.assign(new Error(message), { expose: true });
const LIST_DEFAULT = 20, LIST_MAX = 50;

/** Une idée pour l'assistant (les notes seulement quand `full`). */
export function present(idea, today, full = false) {
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
  };
}

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
      // Tant qu'il n'y a ni curseur ni suite, un simple tableau (comme les listes du cœur) ; sinon { items, next }.
      return !args.cursor && next === null ? items : { items, next };
    },

    async idea_get(ctx, args) {
      return present(await need(ctx, args.id), D.todayOf(ctx), true);
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
      return present(made.idea, D.todayOf(ctx), true);
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
      return present(saved, D.todayOf(ctx), true);
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
  },
};
