// Les outils de l'assistant (mêmes noms qu'avant ; les réponses gagnent seulement un champ `source`) : lister les titres dont la jaquette est douteuse (lecture), lister ce que le module garde (lecture) et corriger
// la jaquette d'un titre (écriture, jamais accordée d'office). Mêmes règles que l'écran d'administration (ops.mjs) : le jeu se choisit par sa source et son numéro parmi les propositions des sources (RAWG, Twitch,
// Steam), une image donnée à la main doit être une adresse `https://media.rawg.io/media/…`, 1000 corrections au plus, cadence limitée par jeton. Aucune clé, jamais, dans une réponse.
// Les messages sont en anglais, courts et lisibles par l'agent.
const q = new URL(import.meta.url).search;
const { titleKey } = await import(new URL("./match.mjs" + q, import.meta.url).href);
const fx = await import(new URL("./fixes.mjs" + q, import.meta.url).href);
const ops = await import(new URL("./ops.mjs" + q, import.meta.url).href);

const WHY = {
  title: "title: give the game title as asked by the module (1 to 120 characters).",
  full: "There are already 1000 saved corrections: ask the owner to forget some in the Game covers module (Kept covers tab).",
  candidate: "That game is not among the games the sources propose for this title. Call rawg_covers_to_check with this title to list them (or pass \"search\" with the real name).",
  image: "imageUrl: only https://media.rawg.io/media/... pictures (png, jpg or webp) are allowed, with no parameter.",
  rate: "Too many requests: wait a minute and try again.",
  nothing: "There is no cover to keep for this title right now.",
  "no-key": "No cover source is available: the owner enables one in the Game covers module (a RAWG code in Settings, the Twitch connector, or Steam).",
  refused: "RAWG refuses the site's key and no other source is available: the owner checks it in the Game covers module.",
  unreachable: "The cover sources cannot be reached right now: try again later.",
};
const fail = (why) => Object.assign(new Error(why), { expose: true });
const who = (actor) => `mcp:${actor?.tokenId ?? actor?.name ?? "?"}`;

export const tools = {
  async rawg_covers_to_check(ctx, args, actor) {
    const items = (await fx.readToCheck(ctx)).map((d) => ({ title: d.title, foundGame: d.name, rawgId: d.rawgId ?? null, source: d.src ?? "rawg", coverUrl: fx.imgUrl(d.src ?? "rawg", d.img), candidates: d.candidates, checkedAt: d.at }));
    if (args?.title === undefined) return { items, total: items.length };
    const title = ops.checkTitle(args.title);
    if (!title) throw fail(WHY.title);
    const found = await ops.candidatesFor(ctx, who(actor), title, args.search, { quiet: true });   // une lecture n'écrit rien (pas même l'état de la clé)
    if (found.status === "rate") throw fail(WHY.rate);
    return { items, total: items.length, title, status: found.status, candidates: found.candidates.map((c) => ({ ...(c.source === "rawg" ? { rawgId: c.id } : {}), gameId: c.id, source: c.source, name: c.name, year: c.year, platforms: c.platforms, coverUrl: c.url })) };
  },

  /** Lecture seule : ce que le module retient (même liste que l'onglet « Jaquettes gardées »). Aucun appel au service de jaquettes, aucune clé. */
  async rawg_covers_list(ctx, args) {
    const origin = args?.origin;
    if (origin !== undefined && origin !== "corrected" && origin !== "none" && origin !== "auto") throw fail("origin: corrected, none or auto.");
    const limit = args?.limit === undefined ? 50 : Number(args.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw fail("limit: a whole number from 1 to 100.");
    const words = typeof args?.search === "string" ? titleKey(args.search.slice(0, 100)) : "";
    const all = (await fx.savedEntries(ctx)).filter((e) => (!origin || e.origin === origin) && (!words || titleKey(e.title).includes(words)));
    return {
      total: all.length,
      items: all.slice(0, limit).map((e) => ({ title: e.title, origin: e.origin, game: e.name || null, source: e.img ? e.src : null, coverUrl: e.img ? fx.imgUrl(e.src, e.img) : null, at: e.at })),
    };
  },

  async rawg_cover_set(ctx, args, actor) {
    const modes = [args?.rawgId !== undefined || args?.gameId !== undefined, args?.none === true, args?.imageUrl !== undefined, args?.forget === true].filter(Boolean).length;
    if (modes !== 1) throw fail("pass exactly one of rawgId (or gameId with source), none, imageUrl or forget");
    const title = ops.checkTitle(args.title);
    if (!title) throw fail(WHY.title);
    if (args.forget === true) return { forgotten: await ops.forget(ctx, who(actor), titleKey(title), title), title };
    const out = args.rawgId !== undefined || args.gameId !== undefined ? await ops.chooseGame(ctx, who(actor), title, args.rawgId ?? args.gameId, args.search, args.rawgId !== undefined ? "rawg" : args.source)
      : args.none === true ? await ops.chooseNone(ctx, who(actor), title)
      : await ops.chooseImage(ctx, who(actor), title, args.imageUrl);
    if (!out.ok) throw fail(WHY[out.error] ?? WHY.title);
    return { saved: true, title: out.fix.title, choice: out.fix.kind, game: out.fix.name ?? null, source: out.fix.img ? (out.fix.src ?? "rawg") : null, coverUrl: out.fix.img ? fx.imgUrl(out.fix.src ?? "rawg", out.fix.img) : null };
  },
};
