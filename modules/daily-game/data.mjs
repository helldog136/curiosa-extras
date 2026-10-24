// Jeu du jour — les données et leurs garde-fous : stockage de l'instance, mémoire à durée limitée, verrou d'écriture, limites par visiteur.
//
// Trois collections, toutes propres à l'instance :
//   dg_questions  { type, status: "published" | "draft", cat, lvl, date?, pos, pack?, by, d }   `d` : le contenu propre au type de jeu (voir games.mjs)
//   dg_plan       { seed, cycleStart, hist: { "AAAA-MM-JJ": idDeQuestion }, tpl }               un seul document : ce qui est déjà passé (borné à 400 jours)
//   dg_board      { week: "AAAA-Www", rows: [{ p, n, pts, w, g, d }] }                            classement d'une semaine (facultatif, 100 lignes au plus)
// Rien n'est lu sans borne : 2 000 questions au plus, 4 semaines de classement.
const q = new URL(import.meta.url).search;   // le cœur recharge index.mjs avec ?v=… : les fichiers voisins suivent
const L = await import(`./lib.mjs${q}`);
const G = await import(`./games.mjs${q}`);
const P = await import(`./plan.mjs${q}`);
const { clean, num, LIMITS, LEVELS, dayKey, addDays, isDay, weekKey, seededIndex, isId, DEFAULT_TZ, isValidTimeZone, hash32 } = L;

export const C = { q: "dg_questions", plan: "dg_plan", board: "dg_board" };
/** L'horloge du module (les tests peuvent la remplacer pour jouer plusieurs jours de suite). */
export const clock = { now: () => Date.now() };
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
const TTL = 60_000;   // la mémoire de la banque vit une minute (et tombe à chaque écriture)

// ── Réglages ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export const flag = (ctx, key, fallback) => { const v = ctx.setting(key); return v === undefined || v === null || v === "" ? fallback : v === true || v === "true" || v === 1 || v === "1"; };
export const tzOf = (ctx) => { const z = String(ctx.setting("timezone") ?? ""); return isValidTimeZone(z) ? z : DEFAULT_TZ; };
export const modeOf = (ctx) => (ctx.setting("order") === "random" ? "random" : "sequence");
export const typeOf = (ctx) => G.gameType(ctx.setting("gameType"));
export const timerModeOf = (ctx) => (["on", "off", "none"].includes(ctx.setting("timerMode")) ? ctx.setting("timerMode") : "on");
export const secondsOf = (ctx) => num(ctx.setting("seconds"), 15, 5, 60);
/** Les langues du site, la langue par défaut d'abord. */
export const localesOf = (ctx) => [ctx.defaultLocale, ...ctx.locales.filter((l) => l !== ctx.defaultLocale)].filter((l, i, a) => l && a.indexOf(l) === i);
export const today = (ctx, now = clock.now()) => dayKey(now, tzOf(ctx));

// ── Lecture ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Une ligne du stockage remise en forme : une sauvegarde abîmée ne fait jamais planter une page. */
export function toItem(row) {
  const data = row?.data ?? {};
  const type = G.hasGameType(data.type) ? data.type : "quiz";
  const date = isDay(data.date) ? data.date : "";
  return {
    id: row.id,
    createdAt: new Date(row.createdAt).getTime() || 0,
    type,
    status: data.status === "published" ? "published" : "draft",
    cat: clean(data.cat, LIMITS.cat),
    lvl: LEVELS.includes(data.lvl) ? data.lvl : "",
    date,
    pos: Number(data.pos) || 0,
    pack: typeof data.pack === "string" ? data.pack.slice(0, 40) : "",
    by: ["assistant", "import", "pack"].includes(data.by) ? data.by : "admin",
    d: G.gameType(type).normalize(data.d),
  };
}

export const playable = (ctx, item) => item.status === "published" && item.type === typeOf(ctx).id && typeOf(ctx).complete(item.d);

const caches = new Map();
export function invalidate(ctx) { caches.delete(ctx.instance.key); }

/** La banque et l'historique, en mémoire une minute au plus. `fresh` : relire tout de suite (administration). */
export async function snapshot(ctx, { fresh = false } = {}) {
  const key = ctx.instance.key;
  const gen = typeof ctx.api.store.generation === "function" ? await ctx.api.store.generation() : 0;
  const hit = caches.get(key);
  if (!fresh && hit && Date.now() - hit.at < TTL && hit.gen === gen) return hit;
  const rows = await ctx.api.store.list(C.q, { limit: LIMITS.questions + 50 });
  const items = rows.map(toItem).sort((a, b) => a.pos - b.pos || a.createdAt - b.createdAt);
  const planRows = await ctx.api.store.list(C.plan, { limit: 1 });
  const raw = planRows[0]?.data ?? {};
  const plan = { id: planRows[0]?.id ?? null, seed: Number.isInteger(raw.seed) ? raw.seed : 0, cycleStart: isDay(raw.cycleStart) ? raw.cycleStart : "", hist: cleanHist(raw.hist), tpl: clean(raw.tpl, 20) };
  const next = { at: Date.now(), gen, items, plan, today: null };
  caches.set(key, next);
  return next;
}

function cleanHist(h) {
  const out = {};
  if (h && typeof h === "object") for (const [d, id] of Object.entries(h).slice(0, LIMITS.history + 50)) if (isDay(d) && isId(id)) out[d] = id;
  return out;
}

export async function getRow(ctx, id, expect = "item") {
  if (!isId(id)) return null;
  const row = await ctx.api.store.get(id);
  if (!row || typeof row.data !== "object" || row.data === null) return null;
  if (expect === "item" && !("d" in row.data)) return null;
  return row;
}

// ── Écriture : une à la fois par instance (le stockage n'a pas d'incrément atomique). Ne jamais appeler `locked` dans `locked`. ─────

const chains = new Map();
export function locked(ctx, fn) {
  const key = ctx.instance.key;
  const prev = chains.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => {});
  chains.set(key, tail);
  tail.then(() => { if (chains.get(key) === tail) chains.delete(key); });
  return run;
}

export async function saveItem(ctx, id, { type, status, cat, lvl, date, pos, pack, by, d }) {
  const data = { type, status, cat: clean(cat, LIMITS.cat), lvl: LEVELS.includes(lvl) ? lvl : "", pos, by, d };
  if (isDay(date)) data.date = date;
  if (pack) data.pack = pack;
  invalidate(ctx);
  if (id) return (await ctx.api.store.update(id, data)) ? id : null;
  return ctx.api.store.add(C.q, data);
}

export const nextPos = (items) => items.reduce((m, i) => Math.max(m, i.pos), 0) + 1;

/** Les dates à venir déjà prises : date → question. */
export const plannedDays = (items, from) => new Map(items.filter((i) => i.date && i.date >= from).map((i) => [i.date, i]));

// ── Quelle question aujourd'hui ? ────────────────────────────────────────────────────────────────────────────────────

/** La graine du tirage au hasard : celle de l'historique si elle existe, sinon une valeur propre à l'instance (le même aperçu avant et après la première visite). */
const seedOf = (ctx, snap) => (snap.plan.seed || hash32(`dg|${ctx.instance.id}`));
const rander = (seed) => (n, day) => seededIndex(seed, day, n);

async function writePlan(ctx, snap, state) {
  const data = { seed: state.seed, cycleStart: state.cycleStart, hist: state.hist, tpl: state.tpl ?? snap.plan.tpl ?? "" };
  if (snap.plan.id) await ctx.api.store.update(snap.plan.id, data);
  else snap.plan.id = await ctx.api.store.add(C.plan, data);
  invalidate(ctx);
}

/** La question du jour (figée à la première visite du jour). Rend { day, prev, item } — `item` est null quand il n'y a rien à jouer. */
export async function getToday(ctx, now = clock.now()) {
  const day = today(ctx, now);
  const prev = addDays(day, -1);
  let snap = await snapshot(ctx);
  if (snap.today?.day === day) return { day, prev, item: snap.today.item };
  const usable = snap.items.filter((i) => playable(ctx, i));
  const frozen = usable.find((i) => i.id === snap.plan.hist[day]);
  if (frozen) { snap.today = { day, item: frozen }; return { day, prev, item: frozen }; }
  return locked(ctx, async () => {
    snap = await snapshot(ctx, { fresh: true });   // un autre passage a peut-être déjà choisi
    const items = snap.items.filter((i) => playable(ctx, i));
    const again = items.find((i) => i.id === snap.plan.hist[day]);
    if (again) { snap.today = { day, item: again }; return { day, prev, item: again }; }
    const state = { seed: seedOf(ctx, snap), cycleStart: snap.plan.cycleStart, hist: snap.plan.hist, tpl: snap.plan.tpl };
    const choice = P.choose(day, state, items, modeOf(ctx), rander(state.seed));
    const item = items.find((i) => i.id === choice.id) ?? null;
    if (item) {
      try { await writePlan(ctx, snap, P.remember(state, day, choice, LIMITS.history)); } catch (e) { console.error("[daily-game] plan not saved:", e?.message); }
    }
    const fresh = await snapshot(ctx);
    fresh.today = { day, item };
    return { day, prev, item };
  });
}

/** L'équipe choisit la question d'aujourd'hui (change ce qui a été figé). */
export async function setToday(ctx, id, now = clock.now()) {
  return locked(ctx, async () => {
    const snap = await snapshot(ctx, { fresh: true });
    const item = snap.items.find((i) => i.id === id && playable(ctx, i));
    if (!item) return false;
    const day = today(ctx, now);
    await writePlan(ctx, snap, { seed: seedOf(ctx, snap), cycleStart: snap.plan.cycleStart, hist: { ...snap.plan.hist, [day]: id }, tpl: snap.plan.tpl });
    return true;
  });
}

/** Réinitialise l'historique (un nouveau tour recommence, les jours passés sont oubliés). */
export async function resetPlan(ctx) {
  return locked(ctx, async () => {
    const snap = await snapshot(ctx, { fresh: true });
    await writePlan(ctx, snap, { seed: seedOf(ctx, snap), cycleStart: "", hist: {}, tpl: snap.plan.tpl });
  });
}

/** Retient le gabarit choisi au départ (le choix « de départ » n'est plus proposé ensuite). À appeler DANS `locked(ctx, …)`. */
export async function chooseTemplate(ctx, id) {
  const snap = await snapshot(ctx, { fresh: true });
  await writePlan(ctx, snap, { seed: seedOf(ctx, snap), cycleStart: snap.plan.cycleStart, hist: snap.plan.hist, tpl: clean(id, 20) });
}

/** Les prochains jours et « il reste N jours de questions » (sans rien écrire). */
export async function outlook(ctx, { count = 7, now = clock.now(), fresh = false } = {}) {
  const snap = await snapshot(ctx, { fresh });
  const items = snap.items.filter((i) => playable(ctx, i));
  const day = today(ctx, now);
  const state = { seed: seedOf(ctx, snap), cycleStart: snap.plan.cycleStart, hist: snap.plan.hist };
  const rand = rander(state.seed);
  const days = P.forecast(day, count, state, items, modeOf(ctx), rand, addDays);
  const left = P.daysLeft(day, state, items, modeOf(ctx), rand, addDays);
  return { day, days, left, items, snap, pool: P.rotation(items), hist: snap.plan.hist };
}

// ── Limites par visiteur : en mémoire seulement (remises à zéro au redémarrage), rien d'écrit sur le disque ───────────

const hits = new Map();
/** Compte un passage et dit si le visiteur dépasse `max` passages dans la fenêtre. */
export function limited(bucket, max, windowMs, now = Date.now()) {
  const recent = (hits.get(bucket) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.delete(bucket);
  hits.set(bucket, recent);
  if (hits.size > 4000) {
    for (const [k, v] of hits) if (!v.some((t) => now - t < DAY)) hits.delete(k);
    for (const k of hits.keys()) { if (hits.size <= 3000) break; hits.delete(k); }
  }
  return recent.length > max;
}

/** Qui est le visiteur, sans garder son adresse : l'empreinte salée du cœur. */
export function visitor(ctx, request, scope) {
  const fp = ctx.api?.visitor?.fingerprint;
  return typeof fp === "function" ? fp(request, scope) : "local";
}

export function forget(ctx) {
  const prefix = `${ctx.instance.key}|`;
  for (const k of [...hits.keys()]) if (k.startsWith(prefix)) hits.delete(k);
  caches.delete(ctx.instance.key);
  chains.delete(ctx.instance.key);
}

// ── Classement de la semaine ─────────────────────────────────────────────────────────────────────────────────────────

const cleanRow = (r) => ({
  p: clean(r?.p, 60), n: clean(r?.n, 30),
  pts: num(r?.pts, 0, 0, 1_000_000), w: num(r?.w, 0, 0, 100000), g: num(r?.g, 0, 0, 100000), d: isDay(r?.d) ? r.d : "",
});
const byRank = (a, b) => b.pts - a.pts || b.w - a.w || a.g - b.g || (a.p < b.p ? -1 : 1);

export async function boardDoc(ctx, week) {
  const rows = await ctx.api.store.list(C.board, { limit: LIMITS.weeks + 8 });
  const found = rows.find((r) => r.data?.week === week);
  if (!found) return null;
  const list = (Array.isArray(found.data.rows) ? found.data.rows : []).slice(0, LIMITS.board + 10).map(cleanRow).filter((r) => r.p).sort(byRank);
  return { id: found.id, week, rows: list };
}

/** Le haut du classement d'une semaine (au plus `limit` lignes). */
export async function boardTop(ctx, week, limit = 10) {
  const doc = await boardDoc(ctx, week);
  return (doc?.rows ?? []).slice(0, limit).map((r, i) => ({ rank: i + 1, name: r.n || "", pts: r.pts, wins: r.w, games: r.g, id: r.p }));
}

/** Ajoute le score d'une personne pour un jour. Rend son rang (1 = premier) ou null si elle n'est pas dans les 100 premiers. */
export function boardAdd(ctx, { week, pid, nick, pts, win, day }) {
  return locked(ctx, async () => {
    const doc = (await boardDoc(ctx, week)) ?? { id: null, week, rows: [] };
    let row = doc.rows.find((r) => r.p === pid);
    if (row) {
      if (row.d === day) return { rank: doc.rows.indexOf(row) + 1, already: true };   // ce jour est déjà compté
      row.pts += pts; row.g += 1; row.w += win ? 1 : 0; row.d = day; if (nick) row.n = nick;
    } else {
      row = { p: pid, n: nick || "", pts, w: win ? 1 : 0, g: 1, d: day };
      doc.rows.push(row);
    }
    doc.rows.sort(byRank);
    const kept = doc.rows.slice(0, LIMITS.board);
    const data = { week, rows: kept };
    if (doc.id) await ctx.api.store.update(doc.id, data); else await ctx.api.store.add(C.board, data);
    await purgeBoards(ctx, day);
    const at = kept.findIndex((r) => r.p === pid);
    return { rank: at < 0 ? null : at + 1, already: false };
  });
}

/** Retire une personne de toutes les semaines gardées (droit à l'oubli). */
export function boardForget(ctx, pid) {
  return locked(ctx, async () => {
    let removed = 0;
    for (const r of await ctx.api.store.list(C.board, { limit: LIMITS.weeks + 8 })) {
      const rows = (Array.isArray(r.data?.rows) ? r.data.rows : []).filter((x) => x?.p !== pid);
      if (rows.length !== (r.data?.rows ?? []).length) { await ctx.api.store.update(r.id, { week: r.data.week, rows }); removed++; }
    }
    return removed;
  });
}

/** Retire une ligne (modération) ou, sans `pid`, toute la semaine. */
export function boardRemove(ctx, week, pid) {
  return locked(ctx, async () => {
    const doc = await boardDoc(ctx, week);
    if (!doc) return false;
    if (!pid) { await ctx.api.store.remove(doc.id); return true; }
    const rows = doc.rows.filter((r) => r.p !== pid);
    if (rows.length === doc.rows.length) return false;
    await ctx.api.store.update(doc.id, { week, rows });
    return true;
  });
}

/** Les semaines trop anciennes partent au fil de l'eau (4 semaines gardées, 5 retraits au plus par passage). */
async function purgeBoards(ctx, from) {
  const keep = new Set();
  let day = from;
  for (let i = 0; i < LIMITS.weeks; i++) { keep.add(weekKey(day)); day = addDays(day, -7); }
  let removed = 0;
  for (const r of await ctx.api.store.list(C.board, { limit: LIMITS.weeks + 8 })) {
    if (removed >= 5) break;
    if (!keep.has(r.data?.week)) { await ctx.api.store.remove(r.id); removed++; }
  }
}
