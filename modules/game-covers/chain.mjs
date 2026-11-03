// LA CHAÎNE DE SOURCES — « peu importe la source, utilise-les dans l'ordre le plus logique ». Une jaquette est cherchée chez RAWG, puis (si RAWG n'a pas de réponse sûre, est en panne ou n'a pas de clé)
// dans le magasin Steam (sans clé), puis EN DERNIER SECOURS dans les jaquettes de boîte de Twitch (par le Connecteur, sans clé de plus) : une copie Twitch ne peut vivre que 24 h (leurs conditions), les autres 30 jours. La première réponse SÛRE (titre quasi identique, sans rival de même force : match.mjs)
// gagne ; sinon on garde la meilleure réponse incertaine de la première source qui en a une, et le titre entre dans « Jaquettes à vérifier ». Chaque source a son disjoncteur : une source en panne
// ne bloque pas les autres. Une source « absente » (pas de clé, pas de Connecteur) n'est ni une erreur ni un message : c'est une source de moins. « Indisponible » seulement si AUCUNE source disponible n'a répondu.
// Ordre des choses pour un titre : correction de la personne → jaquette gardée encore bonne → chaîne de sources → jaquette gardée même périmée. Puis l'image est copiée sur le site (copies.mjs) :
// ce qui sort d'ici est l'adresse de la copie, jamais celle de la source (sauf réglage avancé).
const q = new URL(import.meta.url).search;
const match = await import(new URL("./match.mjs" + q, import.meta.url).href);
const hosts = await import(new URL("./hosts.mjs" + q, import.meta.url).href);
const fx = await import(new URL("./fixes.mjs" + q, import.meta.url).href);
const rawg = await import(new URL("./rawg.mjs" + q, import.meta.url).href);
const srcs = await import(new URL("./sources.mjs" + q, import.meta.url).href);
const copies = await import(new URL("./copies.mjs" + q, import.meta.url).href);
const { rank, isAmbiguous, titleKey } = match;

/** Une page du site n'attend jamais plus de ça pour toute la chaîne ; chaque source a son propre délai (3 s). */
export const PAGE_DEADLINE_MS = 5_000;
/** Candidats montrés par source, et au total, à l'écran de choix. */
export const PER_SOURCE = 6;
export const MAX_CANDIDATES = 12;

/** Les sources et leur disponibilité, dans l'ordre : [{ source, on, why? }]. Sans appel réseau. */
export async function availableSources(ctx) {
  const out = [];
  for (const source of hosts.SOURCES) out.push({ source, ...(await srcs.availability(ctx, source)) });
  return out;
}

/** La réponse « jaquette » d'un choix gardé : la copie sur le site (jamais l'adresse de la source, sauf réglage avancé). */
async function entryCover(ctx, key, e, extra = {}) {
  const src = e.src ?? "rawg";
  const url = await copies.ensure(ctx, key, src, e.img);
  const base = { ...(e.name ? { name: e.name } : {}), ...(src === "rawg" && e.rawgId ? { id: e.rawgId } : {}), source: src, ...extra };
  if (url) return { status: "found", url, ...base };
  if (copies.remoteFallbackOn(ctx)) return { status: "found", url: hosts.imageUrl(src, e.img), ...base };
  return { status: "unreachable", url: null };   // la copie n'est pas prête : elle le sera à la prochaine demande (jamais « aucune jaquette », jamais d'erreur)
}

/** Interroge les sources dans l'ordre. → { pick?, answered, down, refused } ; pick : { source, ranked, best, ambiguous, fresh }. */
async function runChain(ctx, words, sources, { timeoutMs, deadlineMs, quiet = false } = {}) {
  const started = Date.now();
  let confident = null, doubtful = null, answered = false, down = false, refused = false;
  for (const source of sources) {
    const left = deadlineMs - (Date.now() - started);
    if (left < 400) break;
    const r = await srcs.search(ctx, source, words, { timeoutMs: Math.min(timeoutMs, left), quiet });
    if (r.kind === "unreachable") { down = true; continue; }
    if (r.kind === "refused") { refused = true; continue; }
    if (r.kind !== "ok") continue;
    answered = true;
    const ranked = rank(words, r.list);
    const best = ranked[0];
    if (!best || !best.image) continue;
    const ambiguous = best.name ? isAmbiguous(ranked) : undefined;
    const pick = { source, ranked, best, ambiguous, fresh: r.fresh !== false };
    if (ambiguous === false) { confident = pick; break; }
    doubtful ??= pick;
  }
  return { pick: confident ?? doubtful, answered, down, refused };
}

/**
 * Jaquette d'un jeu → { status: "found" | "none" | "no-key" | "refused" | "unreachable", url, name?, id?, ambiguous?, source? }. Ne lève jamais.
 *   found        `url` : l'adresse de la copie sur le site (https absolue). `source` : "rawg" | "twitch" | "steam".
 *   none         au moins une source a répondu et aucune n'a ce jeu (ou la personne a choisi « Aucune jaquette ») ;
 *   unreachable  des sources étaient disponibles mais aucune n'a répondu (ou la copie n'est pas encore prête) : ce n'est JAMAIS gardé comme « aucune jaquette » ;
 *   no-key       aucune source disponible (RAWG sans clé, Twitch non réglé, Steam coupé) ; refused : la clé RAWG est refusée et rien d'autre n'est disponible.
 */
export async function cover(ctx, title) {
  try {
    const asked = rawg.cleanTitle(title, 120);
    const search = asked.slice(0, 100).trim();
    if (!search) return { status: "none", url: null };
    const key = titleKey(asked);
    if (!key) return { status: "none", url: null };

    const fix = await fx.fixFor(ctx, asked);
    if (fix) return fix.kind === "none" || !fix.img ? { status: "none", url: null } : entryCover(ctx, key, fix, { ambiguous: false });

    const stored = await fx.autoFor(ctx, asked);
    if (stored && Date.parse(stored.until) > Date.now()) return entryCover(ctx, key, stored, typeof stored.ambiguous === "boolean" ? { ambiguous: stored.ambiguous } : {});

    const avail = (await availableSources(ctx)).filter((a) => a.on);
    if (!avail.length) {
      if (stored) return entryCover(ctx, key, stored, typeof stored.ambiguous === "boolean" ? { ambiguous: stored.ambiguous } : {});
      return { status: (await srcs.availability(ctx, "rawg")).why === "refused" ? "refused" : "no-key", url: null };
    }
    const found = await runChain(ctx, search, avail.map((a) => a.source), { timeoutMs: rawg.PAGE_TIMEOUT_MS, deadlineMs: PAGE_DEADLINE_MS });
    const { pick } = found;
    if (!pick) {
      // Une réponse vide pendant un incident n'efface pas une bonne jaquette : on la garde et on redemande dans une heure. Une panne ne repousse rien (le disjoncteur espace déjà les essais).
      if (stored) { if (found.answered) void fx.deferAuto(ctx, stored, rawg.NONE_TTL); return entryCover(ctx, key, stored, typeof stored.ambiguous === "boolean" ? { ambiguous: stored.ambiguous } : {}); }
      return found.answered ? { status: "none", url: null } : { status: found.refused && !found.down ? "refused" : "unreachable", url: null };
    }
    const { best, ranked, source, ambiguous } = pick;
    const entry = { title: asked, name: best.name || undefined, ...(source === "rawg" ? { rawgId: best.id || undefined } : { srcId: best.id || undefined }), src: source, url: best.image, ambiguous, candidates: ranked.length, ttlMs: copies.keepMs(ctx, source) };
    // On garde la jaquette trouvée (une même entrée est réécrite, pas doublée).
    await fx.saveAuto(ctx, entry);
    if (ambiguous && pick.fresh) void fx.noteDoubtful(ctx, { title: asked, name: best.name, ...(source === "rawg" ? { rawgId: best.id || undefined } : { srcId: best.id || undefined }), src: source, url: best.image, candidates: ranked.length });
    const img = hosts.imagePath(source, best.image);
    if (!img) return { status: "none", url: null };
    return entryCover(ctx, key, { src: source, img, name: best.name, rawgId: source === "rawg" ? best.id : undefined }, ambiguous !== undefined ? { ambiguous } : {});
  } catch {
    return { status: "unreachable", url: null };
  }
}

/**
 * Les jeux proposés pour ce titre par TOUTES les sources disponibles (6 au plus par source, 12 au total), du plus ressemblant au moins ressemblant, source par source dans l'ordre de priorité.
 * `search` : une autre recherche (l'écran laisse taper le vrai nom) ; ce texte n'est qu'un mot de recherche, jamais une adresse. `quiet` : n'écrit rien (outil de lecture de l'assistant). Ne lève jamais.
 * → { status: "found" | "none" | "no-key" | "refused" | "unreachable", candidates: [{ id, name, year, platforms, url, source }], sources: [{ source, state }] }
 */
export async function candidates(ctx, title, search, { quiet = false } = {}) {
  try {
    const asked = rawg.cleanTitle(title);
    const words = rawg.cleanTitle(search) || asked;
    const avail = await availableSources(ctx);
    const on = avail.filter((a) => a.on);
    if (!on.length) return { status: avail.find((a) => a.source === "rawg")?.why === "refused" ? "refused" : "no-key", candidates: [], sources: [] };
    if (!words) return { status: "none", candidates: [], sources: [] };
    const out = [], states = [];
    for (const { source } of on) {
      const r = await srcs.search(ctx, source, words, { quiet, timeoutMs: 5_000 });
      states.push({ source, state: r.kind });
      if (r.kind !== "ok") continue;
      let n = 0;
      for (const c of rank(words, r.list)) {
        if (!c.image || !hosts.imagePath(source, c.image) || !c.id || !c.name || out.some((o) => o.source === source && o.id === c.id)) continue;
        out.push({ id: c.id, name: c.name, year: c.year, platforms: c.platforms, url: c.image, source });
        if (++n >= PER_SOURCE || out.length >= MAX_CANDIDATES) break;
      }
    }
    if (out.length) return { status: "found", candidates: out, sources: states };
    const ok = states.some((s) => s.state === "ok");
    return { status: ok ? "none" : states.some((s) => s.state === "unreachable") || !states.some((s) => s.state === "refused") ? "unreachable" : "refused", candidates: [], sources: states };
  } catch {
    return { status: "unreachable", candidates: [], sources: [] };
  }
}
