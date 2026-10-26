// Le service `game.cover` (version 1) : ce que le module met à la disposition des autres pour illustrer un jeu. Sans clé, tout répond « no-key » et rien ne casse.
//   status()                          { ready, configured, source, state?, at? } — sans aucun appel réseau ; jamais la clé ;
//   cover({ title })                  { status: "found" | "none" | "no-key" | "refused" | "unreachable", url, name?, id?, ambiguous? } ;
//   candidates({ title, search? })    { status, candidates: [{ id, name, year, platforms, url }] } — 6 au plus ;
//   fix({ title, rawgId | none | forget })   écriture réservée à une personne qui a le droit « fix » (appel avec { asCaller: true } depuis une action d'administration) ;
//   adopt({ key?, fixes?, todo? })    reprise des données d'un ancien réglage du site : ne remplace jamais, ne rend jamais une valeur.
const q = new URL(import.meta.url).search;
const match = await import(new URL("./match.mjs" + q, import.meta.url).href);
const fx = await import(new URL("./fixes.mjs" + q, import.meta.url).href);
const rawg = await import(new URL("./rawg.mjs" + q, import.meta.url).href);
const ops = await import(new URL("./ops.mjs" + q, import.meta.url).href);
const { COL } = fx;

/** Le titre demandé : une chaîne, ou { title }. */
const titleOf = (args) => (typeof args === "string" ? args : args?.title);

export const methods = {
  /** { ready, configured, source: "setting" | "adopted" | null, state: "ok" | "refused" | "unreachable" | null, at? } */
  async status(ctx) {
    const { key, source, valid } = await rawg.keyOf(ctx);
    const state = key ? await rawg.readState(ctx) : null;
    return { ready: valid, configured: !!key, source, state: state?.state ?? null, ...(state ? { at: state.at } : {}) };
  },

  async cover(ctx, args) {
    return rawg.cover(ctx, titleOf(args));
  },

  async candidates(ctx, args) {
    return rawg.candidates(ctx, titleOf(args), typeof args === "object" ? args?.search : undefined);
  },

  /** { title, rawgId } | { title, none: true } | { title, forget: true } → { ok: true, choice } | { ok: false, error }. */
  async fix(ctx, args) {
    if (typeof ctx.can !== "function" || !ctx.can("fix")) return { ok: false, error: "denied" };
    const a = args && typeof args === "object" ? args : {};
    const who = "service";
    if (a.forget === true) {
      const title = ops.checkTitle(a.title);
      if (!title) return { ok: false, error: "title" };
      return { ok: true, forgotten: await ops.forget(ctx, who, match.titleKey(title)) };
    }
    const out = a.none === true ? await ops.chooseNone(ctx, who, a.title) : await ops.chooseGame(ctx, who, a.title, Number(a.rawgId ?? a.id), typeof a.search === "string" ? a.search : undefined);
    // chooseGame cherche d'abord les propositions de RAWG pour ce titre : l'appel est rejeté si le jeu n'en fait pas partie.
    return out.ok ? { ok: true, choice: out.fix.kind, title: out.fix.title } : { ok: false, error: out.error };
  },

  /**
   * Reprise des données d'un ancien réglage du site (le cœur l'appelle une fois, après la mise à jour) : { key?, fixes?, todo? } → { ok, keyHeld, keyAdopted, fixes, todo, ready }.
   * Elle ne remplace JAMAIS ce que ce module a déjà (une clé saisie ici, une correction faite ici) et ne rend jamais une valeur. Rejouée, elle ne fait rien de plus.
   */
  async adopt(ctx, args) {
    const a = args && typeof args === "object" ? args : {};
    const report = { ok: true, keyHeld: false, keyAdopted: false, fixes: 0, todo: 0, ready: false };
    const have = await rawg.keyOf(ctx);
    if (!have.key && rawg.isValidKey(a.key)) {
      await fx.writeOne(ctx, COL.key, { key: a.key, at: new Date().toISOString() });
      report.keyAdopted = true;
    }
    report.keyHeld = report.keyAdopted || !!have.key;

    // Corrections : { "<titre normalisé>": Fix } ou [Fix] ; seules les valides, 1000 au plus, sans remplacer l'existant.
    const fixes = Array.isArray(a.fixes) ? a.fixes : a.fixes && typeof a.fixes === "object" ? Object.values(a.fixes) : [];
    for (const raw of fixes.slice(0, fx.MAX_FIXES)) {
      const fix = fx.sanitizeFix(raw);
      if (!fix) continue;
      const k = match.titleKey(fix.title);
      if (!k) continue;
      const added = await fx.serial(async () => {
        if (await ctx.api.store.getByKey(COL.fixes, k)) return false;
        if ((await fx.countFixes(ctx)) >= fx.MAX_FIXES) return false;
        await ctx.api.store.add(COL.fixes, fix, { key: k });
        return true;
      });
      if (added) report.fixes++;
    }
    // Titres à vérifier : un journal, repris au mieux (100 au plus), sans ceux qui ont une correction.
    const todo = Array.isArray(a.todo) ? a.todo : [];
    for (const raw of todo.slice(0, fx.MAX_TO_CHECK)) {
      const d = fx.sanitizeDoubtful(raw);
      if (!d || (await ctx.api.store.getByKey(COL.fixes, d.key))) continue;
      const added = await fx.serial(async () => {
        if (await ctx.api.store.getByKey(COL.todo, d.key)) return false;
        await ctx.api.store.add(COL.todo, d, { key: d.key });
        return true;
      });
      if (added) report.todo++;
    }
    report.ready = report.keyHeld || (await fx.countFixes(ctx)) > 0;
    await fx.writeOne(ctx, COL.handover, { at: new Date().toISOString(), key: report.keyHeld, fixes: report.fixes, todo: report.todo });
    return report;
  },
};
