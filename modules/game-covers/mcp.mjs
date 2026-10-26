// Les deux outils de l'assistant (mêmes noms et mêmes réponses qu'avant) : lister les titres dont la jaquette est douteuse (lecture) et corriger la jaquette d'un titre (écriture,
// jamais accordée d'office). Mêmes règles que l'écran d'administration (ops.mjs) : le jeu se choisit par son numéro RAWG parmi les propositions de RAWG, une image donnée à la main
// doit être une adresse `https://media.rawg.io/media/…`, 1000 corrections au plus, cadence limitée par jeton. Aucune clé RAWG, jamais, dans une réponse.
// Les messages sont en anglais, courts et lisibles par l'agent.
const q = new URL(import.meta.url).search;
const { titleKey } = await import(new URL("./match.mjs" + q, import.meta.url).href);
const fx = await import(new URL("./fixes.mjs" + q, import.meta.url).href);
const ops = await import(new URL("./ops.mjs" + q, import.meta.url).href);

const WHY = {
  title: "title: give the game title as asked by the module (1 to 120 characters).",
  full: "There are already 1000 saved corrections: ask the owner to forget some in the Game covers module.",
  candidate: "rawgId: that game is not among the games RAWG proposes for this title. Call rawg_covers_to_check with this title to list them (or pass \"search\" with the real name).",
  image: "imageUrl: only https://media.rawg.io/media/... pictures (png, jpg or webp) are allowed, with no parameter.",
  rate: "Too many requests: wait a minute and try again.",
  nothing: "There is no cover to keep for this title right now.",
  "no-key": "No RAWG key is set: the owner pastes it in the Game covers module (Settings tab).",
  refused: "RAWG refuses the site's key: the owner checks it in the Game covers module.",
  unreachable: "RAWG cannot be reached right now: try again later.",
};
const fail = (why) => Object.assign(new Error(why), { expose: true });
const who = (actor) => `mcp:${actor?.tokenId ?? actor?.name ?? "?"}`;

export const tools = {
  async rawg_covers_to_check(ctx, args, actor) {
    const items = (await fx.readToCheck(ctx)).map((d) => ({ title: d.title, foundGame: d.name, rawgId: d.rawgId ?? null, coverUrl: fx.rawgImageUrl(d.img), candidates: d.candidates, checkedAt: d.at }));
    if (args?.title === undefined) return { items, total: items.length };
    const title = ops.checkTitle(args.title);
    if (!title) throw fail(WHY.title);
    const found = await ops.candidatesFor(ctx, who(actor), title, args.search);
    if (found.status === "rate") throw fail(WHY.rate);
    return { items, total: items.length, title, status: found.status, candidates: found.candidates.map((c) => ({ rawgId: c.id, name: c.name, year: c.year, platforms: c.platforms, coverUrl: c.url })) };
  },

  async rawg_cover_set(ctx, args, actor) {
    const modes = [args?.rawgId !== undefined, args?.none === true, args?.imageUrl !== undefined, args?.forget === true].filter(Boolean).length;
    if (modes !== 1) throw fail("pass exactly one of rawgId, none, imageUrl or forget");
    const title = ops.checkTitle(args.title);
    if (!title) throw fail(WHY.title);
    if (args.forget === true) return { forgotten: await ops.forget(ctx, who(actor), titleKey(title)), title };
    const out = args.rawgId !== undefined ? await ops.chooseGame(ctx, who(actor), title, args.rawgId, args.search)
      : args.none === true ? await ops.chooseNone(ctx, who(actor), title)
      : await ops.chooseImage(ctx, who(actor), title, args.imageUrl);
    if (!out.ok) throw fail(WHY[out.error] ?? WHY.title);
    return { saved: true, title: out.fix.title, choice: out.fix.kind, game: out.fix.name ?? null, coverUrl: out.fix.img ? fx.rawgImageUrl(out.fix.img) : null };
  },
};
