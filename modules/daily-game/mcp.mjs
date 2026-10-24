// Jeu du jour — les outils de l'assistant IA : LIRE la banque et AJOUTER un BROUILLON de question. Il ne publie jamais : rendre une question
// visible (donc la mettre dans la rotation du jour) est un clic humain dans l'administration. Les réponses ne sont rendues que si on les demande.
const q = new URL(import.meta.url).search;
const L = await import(`./lib.mjs${q}`);
const D = await import(`./data.mjs${q}`);
const { clean, num, LIMITS, LEVELS } = L;

const refuse = (message) => Object.assign(new Error(message), { expose: true });   // `expose` : ce message peut être lu par l'assistant
const adminUrl = (ctx) => `${ctx.api.siteUrl}/admin/instances/${ctx.instance.id}`;
const cursorOf = (value) => (/^\d{1,5}$/.test(String(value ?? "")) ? Number(value) : 0);
const titleKey = (type, d, order) => L.fold(type.title(d, order)).replace(/\s+/g, " ").trim();

export const mcp = {
  async daily_questions_list(ctx, args) {
    const type = D.typeOf(ctx);
    const status = args?.status === "published" || args?.status === "draft" ? args.status : "all";
    const limit = num(args?.limit, 30, 1, 100);
    const from = cursorOf(args?.cursor);
    const out = await D.outlook(ctx, { count: 1 });
    const list = out.snap.items
      .filter((i) => i.type === type.id && (status === "all" || i.status === status))
      .sort((a, b) => b.createdAt - a.createdAt);
    const page = list.slice(from, from + limit);
    return {
      today: { day: out.day, id: out.days[0]?.id ?? null },
      daysLeft: out.left.days,
      order: D.modeOf(ctx) === "random" ? "random without repeating until the bank is used up" : "in order, one per day",
      items: page.map((i) => ({
        id: i.id, status: i.status, category: i.cat || null, level: i.lvl || null, date: i.date || null, author: i.by,
        ...type.describe(ctx, i, { solution: args?.full === true }),
      })),
      next: from + limit < list.length ? String(from + limit) : null,
    };
  },

  async daily_question_add(ctx, args, actor) {
    const type = D.typeOf(ctx);
    const locales = D.localesOf(ctx);
    if (args?.lang !== undefined && args.lang !== "" && !locales.includes(args.lang)) throw refuse(`Unknown language "${String(args.lang).slice(0, 12)}". Available: ${locales.join(", ")}.`);
    const made = type.fromAssistant(ctx, args ?? {}, { locales });
    if (made.fail) throw refuse(made.fail);
    const level = args?.level === undefined || args.level === "" ? "" : LEVELS.includes(args.level) ? args.level : null;
    if (level === null) throw refuse(`'level' must be one of: ${LEVELS.join(", ")}.`);
    return D.locked(ctx, async () => {
      const snap = await D.snapshot(ctx, { fresh: true });
      if (snap.items.length >= LIMITS.questions) throw refuse(`The bank is full (${LIMITS.questions} questions).`);
      if (snap.items.filter((i) => i.status === "draft" && i.by === "assistant").length >= LIMITS.aiDrafts) {
        throw refuse(`Too many assistant drafts are waiting for review (${LIMITS.aiDrafts}). Ask the site team to publish or delete some.`);
      }
      const order = [made.lang ?? locales[0], ...locales];
      const title = titleKey(type, made.d, order);
      if (snap.items.some((i) => i.type === type.id && titleKey(type, i.d, order) === title)) {
        throw refuse("A question with the same text already exists: use daily_questions_list before adding.");
      }
      const id = await D.saveItem(ctx, "", { type: type.id, status: "draft", cat: clean(args?.category, LIMITS.cat), lvl: level, date: "", pos: D.nextPos(snap.items), pack: "", by: "assistant", d: made.d });
      return {
        id, status: "draft", language: made.lang ?? locales[0],
        note: "This is a DRAFT. It is not visible on the website and is not part of the daily rotation: the site team reads it and publishes it from the administration.",
        source: actor?.name ?? null,
        adminUrl: adminUrl(ctx),
      };
    });
  },
};
