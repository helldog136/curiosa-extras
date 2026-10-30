// Sondages — module de Curiosa.
//
// Un sondage = une question, 2 à 8 choix, un choix unique ou plusieurs, une date de fin facultative. Un vote par personne SANS compte ni cookie :
// le navigateur garde un code anonyme au hasard (localStorage) ; le site n'en garde que l'empreinte, propre à chaque sondage (jamais deux sondages
// reliés). Le débit est limité par une empreinte salée, tournante (le sel change chaque jour, il n'est jamais écrit sur le disque), calculée sur la
// connexion : l'adresse IP n'est jamais gardée ni journalisée. Voir README.md (« Ce que le sondage ne garantit pas »).
//
// Données (stockage de l'instance, tout est borné) :
//   polls     ≤ 200  sondages complets (question, choix, voix par choix, nombre de votants, dates)
//   archive   ≤ 800  sondages archivés (même forme, sans bulletins)
//   b-<id>    ≤ 5000 bulletins d'un sondage (clé = empreinte du code anonyme ; gardés 30 jours après la fin, puis effacés)
//   meta      un document : code secret de la source OBS, sondage à l'écran
//   rounds    ≤ 500  décisions des manches (« toutes les N minutes, le chat décide ») : les votes d'une manche sont effacés dès la décision
// Rien ne tourne en arrière-plan : l'état « ouvert / fermé » est calculé à la lecture, les manches avancent quand l'écran, la télécommande ou une page les regarde,
// le ménage se fait quand quelqu'un vote ou ouvre l'admin.
//
// Avec le module « Participation » (service « audience.session », facultatif), les sondages lui confient l'identité, les limites, la télécommande et le direct ;
// sans lui, tout continue de marcher comme avant (mode autonome). Voir README.md.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const V = new URL(import.meta.url).search;   // le cœur recharge index.mjs avec ?v=… : les fichiers voisins suivent
const L = await import(`./lib.mjs${V}`);
const C = await import(`./client.mjs${V}`);
const B = await import(`./bridge.mjs${V}`);
const { esc, clean, num, LIMITS, ROUND } = L;

const POLLS = "polls", ARCHIVE = "archive", META = "meta", ROUNDS = "rounds";
const DAY = 86_400_000, HOUR = 3_600_000;
const PAGE = 50;
const DEFAULT_TZ = "Europe/Paris";
const TOKEN_RE = /^[A-Za-z0-9_-]{22,64}$/;

/* ───────────── Mémoire du processus : verrou et limiteur (rien n'est écrit sur le disque) ───────────── */

const chains = (globalThis.__curiosaPollsLocks ??= new Map());
/** Passe les écritures d'une instance l'une après l'autre : deux votes simultanés ne se marchent jamais dessus. */
async function withLock(ctx, fn, name = "") {
  const key = `${name}${ctx.instance.key}`;
  const prev = chains.get(key) ?? Promise.resolve();
  let release;
  const gate = new Promise((r) => { release = r; });
  const tail = prev.then(() => gate);
  chains.set(key, tail);
  await prev;
  try { return await fn(); } finally { release(); if (chains.get(key) === tail) chains.delete(key); }
}

const mem = (globalThis.__curiosaPollsMem ??= { salt: randomBytes(32), saltAt: Date.now(), hits: new Map(), swept: new Map() });
const MAX_BUCKETS = 5000;

/** Vrai si la limite est dépassée. Fenêtre glissante, en mémoire, bornée. */
function over(bucket, max, windowMs, now = Date.now()) {
  const recent = (mem.hits.get(bucket)?.times ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  mem.hits.delete(bucket);
  mem.hits.set(bucket, { times: recent, windowMs });
  if (mem.hits.size > MAX_BUCKETS) {
    for (const [k, v] of mem.hits) if (!v.times.some((t) => now - t < v.windowMs)) mem.hits.delete(k);
    for (const k of mem.hits.keys()) { if (mem.hits.size <= MAX_BUCKETS / 2) break; mem.hits.delete(k); }
  }
  return recent.length > max;
}

/** Empreinte de la connexion : HMAC avec un sel au hasard qui change chaque jour. L'adresse reste dans cette fonction, jamais ailleurs. */
export function fingerprint(request, now = Date.now()) {
  if (now - mem.saltAt > DAY) { mem.salt = randomBytes(32); mem.saltAt = now; mem.hits.clear(); }
  const forwarded = (request.headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const who = forwarded.length ? forwarded[forwarded.length - 1] : request.headers.get("x-real-ip") || "local";
  return createHmac("sha256", mem.salt).update(String(who).slice(0, 80)).digest("hex").slice(0, 16);
}

const ballotKey = (pollId, token) => createHash("sha256").update(`${pollId}|${token}`).digest("hex").slice(0, 40);
const sameSecret = (a, b) => { const x = Buffer.from(String(a ?? "")), y = Buffer.from(String(b ?? "")); return x.length > 0 && x.length === y.length && timingSafeEqual(x, y); };

/* ───────────── Accès aux données ───────────── */


/** Lecture par clé (index du cœur). Repli pour le faux stockage du kit de test, qui n'a pas de clés : parcours borné, jamais utilisé avec le vrai cœur. */
async function byKey(ctx, collection, key, field) {
  if (typeof ctx.api.store.getByKey === "function") return ctx.api.store.getByKey(collection, key);
  const rows = await ctx.api.store.list(collection, { limit: 1000 });
  return rows.filter((r) => r.data?.[field] === key).pop() ?? null;   // le plus ancien, comme getByKey
}

const pollOf = (r, kind = "live") => (r ? { ...r.data, id: r.id, archived: kind === "archive" || !!r.data?.archivedAt } : null);
/** Les manches en cours ne sont pas des sondages « à lister » : elles vivent sur la page « en cours » et à l'écran. */
const listed = (p) => !p.round;
const can = (ctx, right) => (typeof ctx.can === "function" ? !!ctx.can(right) : true);   // le cœur refuse déjà l'action elle-même : ici, on ne fait que cacher ce qu'on ne peut pas utiliser

async function livePolls(ctx) {
  return (await ctx.api.store.list(POLLS, { limit: LIMITS.livePolls + 20 })).map((r) => pollOf(r));
}
async function findPoll(ctx, slug) {
  const s = clean(slug, 80).toLowerCase();
  if (!s) return null;
  return pollOf(await byKey(ctx, POLLS, s, "slug")) ?? pollOf(await byKey(ctx, ARCHIVE, s, "slug"), "archive");
}
async function findById(ctx, id) {
  const r = typeof id === "string" && id && id.length <= 100 ? await ctx.api.store.get(id) : null;   // seule une vraie ligne de sondage passe : un identifiant de vote, de réglage ou de décision est refusé
  return r && r.data?.slug && Array.isArray(r.data?.choices) ? pollOf(r) : null;
}
async function getCfg(ctx) { const r = await byKey(ctx, META, "cfg", "k"); return r ? { id: r.id, ...r.data } : null; }
/** Sans verrou (elle est aussi appelée depuis des sections déjà verrouillées) : si deux créations se croisent, la plus ancienne gagne. */
async function ensureCfg(ctx) {
  const found = await getCfg(ctx);
  if (found) return found;
  const data = { k: "cfg", obsKey: randomBytes(18).toString("base64url"), onAir: null, onAirUntil: null, garbage: [] };
  const id = await ctx.api.store.add(META, data, { key: "cfg" });
  const first = await byKey(ctx, META, "cfg", "k");
  if (first && first.id !== id) { await ctx.api.store.remove(id); return { id: first.id, ...first.data }; }
  return { id, ...data };
}
const saveCfg = async (ctx, cfg) => { const { id, ...data } = cfg; await ctx.api.store.update(id, data); };

const tzOf = (ctx) => { const z = String(ctx.setting("timezone") ?? ""); return L.isValidTimeZone(z) ? z : DEFAULT_TZ; };
const baseOf = (ctx) => { const b = ctx.instance.basePath; return b === null || b === undefined ? null : b ? `/${b}` : ""; };
/** Lien interne écrit dans du HTML : la langue choisie (préfixe /en) est gardée. */
const loc = (ctx, href) => (ctx.locale && ctx.defaultLocale && ctx.locale !== ctx.defaultLocale ? `/${ctx.locale}${href === "/" ? "" : href}` || "/" : href);
const pollHref = (ctx, slug) => { const b = baseOf(ctx); return b === null ? null : `${b}/${encodeURIComponent(slug)}`; };

/** Efface des bulletins d'un sondage (par tranches). Renvoie vrai s'il en reste. */
async function purgeBallots(ctx, pollId, { pages = 1 } = {}) {
  const col = `b-${pollId}`;
  for (let i = 0; i < pages; i++) {
    const page = await ctx.api.store.page(col, { limit: 200, order: "asc" });
    if (!page.items.length) return false;
    for (const it of page.items) await ctx.api.store.remove(it.id);
    if (page.items.length < 200) return (await ctx.api.store.count(col)) > 0;
  }
  return (await ctx.api.store.count(col)) > 0;
}

/** Efface les votes des manches décidées (collections mises de côté), 300 lignes au plus par passage. */
async function eatGarbage(ctx, limit) {
  const cfg = await getCfg(ctx);
  if (!cfg?.garbage?.length) return 0;
  const garbage = [...cfg.garbage];
  let used = 0;
  while (garbage.length && used < limit) {
    const page = await ctx.api.store.page(garbage[0], { limit: Math.min(100, limit - used), order: "asc" });
    for (const it of page.items) { await ctx.api.store.remove(it.id); used++; }
    if (!page.items.length) garbage.shift();
  }
  const done = cfg.garbage.filter((g) => !garbage.includes(g));
  if (done.length) await withLock(ctx, async () => { const c = await getCfg(ctx); if (c) await saveCfg(ctx, { ...c, garbage: (c.garbage ?? []).filter((g) => !done.includes(g)) }); });
  return used;
}

/** Ménage de la conservation : bulletins des sondages finis depuis plus de N jours. Quelques centaines d'effacements au plus par passage. */
export async function sweep(ctx, now = Date.now(), { force = false } = {}) {
  const k = ctx.instance.key;
  if (!force && now - (mem.swept.get(k) ?? 0) < 10 * 60_000) return 0;
  mem.swept.set(k, now);
  const days = num(ctx.setting("retentionDays"), 30, 1, 90);
  let budget = 3;
  let cleaned = await eatGarbage(ctx, 300);
  for (const p of await livePolls(ctx)) {
    if (budget <= 0) break;
    if (p.purgedAt || L.stateOf(p, now) !== "closed") continue;
    const ended = L.endedAtMs(p, now);
    if (!ended || now - ended < days * DAY) continue;
    budget--;
    const left = await purgeBallots(ctx, p.id, { pages: 1 });
    cleaned++;
    if (!left) await withLock(ctx, async () => { const f = await ctx.api.store.get(p.id); if (f) await ctx.api.store.update(p.id, { ...f.data, purgedAt: new Date(now).toISOString() }); });
  }
  return cleaned;
}

/* ───────────── Écritures : créer, voter, fermer, archiver, supprimer ───────────── */

const freshSlug = async (ctx, question) => {
  for (let i = 0; i < 8; i++) {
    const s = L.slugify(question);
    if (!(await findPoll(ctx, s))) return s;
  }
  return `${L.slugify(question)}${Date.now().toString(36)}`;
};

async function archiveOne(ctx, p, now = Date.now()) {
  while (await purgeBallots(ctx, p.id, { pages: 10 })) { /* jusqu'à la dernière tranche (5 000 bulletins au plus) */ }
  for (let over = (await ctx.api.store.count(ARCHIVE)) - LIMITS.archived + 1; over > 0; over--) {   // jamais plus de 800 archives : les plus anciennes s'effacent
    const [oldest] = (await ctx.api.store.page(ARCHIVE, { limit: 1, order: "asc" })).items;
    if (!oldest) break;
    await ctx.api.store.remove(oldest.id);
  }
  const { id, archived, ...data } = p;
  await ctx.api.store.add(ARCHIVE, { ...data, archivedAt: new Date(now).toISOString(), endedAt: new Date(L.endedAtMs(p, now) || now).toISOString() }, { key: p.slug });
  await ctx.api.store.remove(id);
}

/** Crée un sondage (borné : au-delà de 200, le plus ancien sondage fini est archivé ; s'il n'y en a pas, on le dit). */
export async function createPoll(ctx, value, tz, now = Date.now(), extra = {}) {
  return withLock(ctx, async () => {
    if ((await ctx.api.store.count(POLLS)) >= LIMITS.livePolls) {
      const closed = (await livePolls(ctx)).filter((p) => L.stateOf(p, now) === "closed").sort((a, b) => (L.endedAtMs(a, now) || 0) - (L.endedAtMs(b, now) || 0));
      if (!closed.length) return { ok: false, error: "full" };
      await archiveOne(ctx, closed[0], now);
    }
    const slug = await freshSlug(ctx, value.question);
    const data = {
      slug, question: value.question, choices: value.choices.map((text, i) => ({ id: `c${i + 1}`, text })), max: value.max, endsAt: value.endsAt,
      tz, resultsMode: value.resultsMode, counts: {}, voters: 0, rev: 0, createdAt: new Date(now).toISOString(), closedAt: null, ...extra,
    };
    const id = await ctx.api.store.add(POLLS, data, { key: slug });
    return { ok: true, id, slug };
  });
}

/** Un vote. Tout se passe dans le verrou : lecture du sondage, bulletin unique, mise à jour des compteurs. Renvoie { ok } ou { ok:false, error }. */
export async function castVote(ctx, { slug, token, ids, now = Date.now() }) {
  return withLock(ctx, async () => {
    const live = pollOf(await byKey(ctx, POLLS, clean(slug, 80).toLowerCase(), "slug"));
    if (!live) return { ok: false, error: (await findPoll(ctx, slug)) ? "closed" : "gone" };
    if (L.stateOf(live, now) !== "open") return { ok: false, error: "closed" };
    const picked = L.validBallot(live, ids);
    if (!picked) return { ok: false, error: "invalid" };
    if ((Number(live.voters) || 0) >= LIMITS.voters) return { ok: false, error: "full" };
    const col = `b-${live.id}`, key = ballotKey(live.id, token);
    if (await byKey(ctx, col, key, "k")) return { ok: false, error: "already" };
    const mine = await ctx.api.store.add(col, { k: key, c: picked, at: new Date(now).toISOString() }, { key });
    // Si deux processus avaient écrit en même temps, le plus ancien bulletin gagne : l'autre s'efface (jamais de double comptage).
    const first = await byKey(ctx, col, key, "k");
    if (first && first.id !== mine) { await ctx.api.store.remove(mine); return { ok: false, error: "already" }; }
    try {
      const fresh = await ctx.api.store.get(live.id);
      if (!fresh) throw new Error("gone");
      const counts = { ...(fresh.data.counts ?? {}) };
      for (const id of picked) counts[id] = (Number(counts[id]) || 0) + 1;
      const ok = await ctx.api.store.update(live.id, { ...fresh.data, counts, voters: (Number(fresh.data.voters) || 0) + 1, rev: (Number(fresh.data.rev) || 0) + 1 });
      if (!ok) throw new Error("gone");
    } catch {
      await ctx.api.store.remove(mine);   // rien n'est compté sans bulletin, ni de bulletin sans compte
      return { ok: false, error: "busy" };
    }
    return { ok: true, picked, poll: pollOf(await ctx.api.store.get(live.id)) };
  });
}

/** Refait les compteurs à partir des bulletins (réparation si deux processus ont écrit en même temps). Impossible une fois les bulletins effacés. */
export async function recount(ctx, id) {
  return withLock(ctx, async () => {
    const p = await findById(ctx, id);
    if (!p) return { ok: false, error: "gone" };
    if (p.purgedAt) return { ok: false, error: "purged" };
    const col = `b-${p.id}`, counts = {};
    let voters = 0, cursor = null;
    for (let i = 0; i < 40; i++) {
      const page = await ctx.api.store.page(col, { limit: 200, order: "asc", cursor });
      for (const it of page.items) { voters++; for (const c of it.data.c ?? []) if (p.choices.some((x) => x.id === c)) counts[c] = (counts[c] || 0) + 1; }
      cursor = page.next;
      if (!cursor) break;
    }
    const f = await ctx.api.store.get(p.id);
    await ctx.api.store.update(p.id, { ...f.data, counts, voters, rev: (Number(f.data.rev) || 0) + 1 });
    return { ok: true, voters };
  });
}

const closeNow = (ctx, id, now = Date.now()) => withLock(ctx, async () => {
  const p = await findById(ctx, id);
  if (!p) return { ok: false, error: "gone" };
  if (L.stateOf(p, now) === "closed") return { ok: false, error: "already" };
  const f = await ctx.api.store.get(p.id);
  await ctx.api.store.update(p.id, { ...f.data, closedAt: new Date(now).toISOString(), rev: (Number(f.data.rev) || 0) + 1 });
  return { ok: true };
});

/** Tranches de 200 bulletins : 30 tranches couvrent les 5 000 votants au plus, avec de la marge. Jamais de lecture sans borne. */
const DELETE_SLICES = Math.ceil(LIMITS.voters / 200) + 5;

/**
 * Supprime UN sondage et tout ce que le module garde à son sujet : ses votes (par tranches), sa place à l'écran (si c'était lui), puis le sondage lui-même,
 * en dernier : si quelque chose s'interrompt, le sondage existe encore et un nouvel essai reprend là où l'on s'était arrêté (jamais de votes sans sondage).
 * Tout est relu ICI, côté serveur, à partir du seul identifiant : le sondage, son état (ouvert ou non), son nombre de votes. Rien ne vient du formulaire.
 * `allowOpen` : la personne a confirmé, en plus, que le sondage est en cours et que ses votes seront perdus.
 * Rend { ok: true, voters, wasOpen } ou { ok: false, error: "gone" | "round" | "open" | "partial" }.
 */
export async function deletePoll(ctx, id, { allowOpen = false, now = Date.now() } = {}) {
  const first = await findById(ctx, id);
  if (!first) return { ok: false, error: "gone" };
  const body = () => withLock(ctx, async () => {
    const p = await findById(ctx, id);   // relu sous le verrou : un vote ou une fermeture qui vient d'arriver est vu
    if (!p) return { ok: false, error: "gone" };
    const series = await getSeries(ctx);
    if (series?.status === "running" && series.current === p.slug) return { ok: false, error: "round" };   // la manche en cours appartient aux manches : « Arrêter » ou « Suivant »
    const wasOpen = L.stateOf(p, now) === "open";
    if (wasOpen && !allowOpen) return { ok: false, error: "open", voters: Number(p.voters) || 0 };
    if (wasOpen) {   // d'abord fermé : si la suppression devait s'arrêter en route, personne ne peut revoter dans un sondage dont des bulletins sont déjà partis
      const f = await ctx.api.store.get(p.id);
      if (f) await ctx.api.store.update(p.id, { ...f.data, closedAt: new Date(now).toISOString(), rev: (Number(f.data.rev) || 0) + 1 });
    }
    let left = !p.archived;
    for (let i = 0; i < DELETE_SLICES && left; i++) left = await purgeBallots(ctx, p.id, { pages: 1 });
    if (left) return { ok: false, error: "partial" };
    const cfg = await getCfg(ctx);
    if (cfg?.onAir === p.slug) await saveCfg(ctx, { ...cfg, onAir: null, onAirUntil: null });
    await ctx.api.store.remove(p.id);
    return { ok: true, voters: Number(p.voters) || 0, wasOpen };
  });
  const r = await (first.round ? withLock(ctx, body, "series:") : body());
  if (r.ok) await syncLive(ctx);   // l'écran du stream et la page « en cours » se mettent à jour tout de suite (avec Participation)
  return r;
}

/* ───────────── Manches : « toutes les N minutes, le chat décide » ───────────── */

// Une manche = un sondage ordinaire (même comptage, mêmes bulletins) qui se ferme tout seul à l'heure dite. Au premier regard APRÈS sa fin (écran, télécommande, page),
// la décision est prise : le vainqueur est écrit dans l'historique, les votes de la manche sont effacés, et la manche suivante démarre. Aucun minuteur.
const SERIES_KEY = "series";
const getSeries = async (ctx) => { const r = await byKey(ctx, META, SERIES_KEY, "k"); return r ? { id: r.id, ...r.data } : null; };
const saveSeries = async (ctx, s) => { const { id, ...data } = s; await ctx.api.store.update(id, data, { key: SERIES_KEY }); };
const bySlug = async (ctx, slug) => (slug ? pollOf(await byKey(ctx, POLLS, slug, "slug")) : null);
const isoOf = (ms) => new Date(ms).toISOString();

/** La configuration des manches (une seule par site). Créée au premier besoin avec des valeurs qui marchent tout de suite. */
async function ensureSeries(ctx) {
  const found = await getSeries(ctx);
  if (found) return found;
  const data = { k: SERIES_KEY, status: "idle", question: ctx.t("roundQuestion"), choices: [ctx.t("roundChoice1"), ctx.t("roundChoice2"), ctx.t("roundChoice3")], minutes: ROUND.defaultMinutes, runId: null, n: 0, current: null, startedAt: null, stoppedAt: null, lastDecision: null };
  const id = await ctx.api.store.add(META, data, { key: SERIES_KEY });
  const first = await byKey(ctx, META, SERIES_KEY, "k");
  if (first && first.id !== id) { await ctx.api.store.remove(id); return { id: first.id, ...first.data }; }
  return { id, ...data };
}

/** Note dans le journal de Participation, s'il est là (qui a décidé quoi). Silencieux. */
const note = (ctx, what, detail) => B.audience(ctx, "journal", { who: "polls", what, room: B.roomOf(ctx), detail: clean(detail, 160) || undefined });

/** Met de côté les votes d'une collection (effacés par petites tranches au prochain passage de ménage), puis supprime le sondage. */
async function dropRoundPoll(ctx, p) {
  await withLock(ctx, async () => {
    const cfg = await ensureCfg(ctx);
    await saveCfg(ctx, { ...cfg, garbage: [...(cfg.garbage ?? []), `b-${p.id}`].slice(-40), onAir: cfg.onAir === p.slug ? null : cfg.onAir });
    await ctx.api.store.remove(p.id);
  });
}

/** Prend la décision d'une manche terminée : vainqueur (ou tirage au sort, dit en clair), historique borné, votes effacés. Renvoie l'enregistrement. */
async function decideRound(ctx, series, cur, now, { rand, via = "timer" } = {}) {
  const { winner, tie } = L.pickWinner(cur, rand);
  const at = L.endedAtMs(cur, now) || now;
  const rec = {
    k: cur.slug, run: series.runId, n: cur.round?.n ?? series.n, question: cur.question,
    choices: cur.choices.map((c) => ({ text: c.text, count: Math.max(0, Number(cur.counts?.[c.id]) || 0) })),
    voters: Number(cur.voters) || 0, winner: winner ? winner.text : null, tie, at: isoOf(at), decidedAt: isoOf(now), via,
  };
  await withLock(ctx, async () => {
    await ctx.api.store.add(ROUNDS, rec, { key: cur.slug });
    for (let extra = (await ctx.api.store.count(ROUNDS)) - ROUND.history; extra > 0; extra--) {   // jamais plus de 500 décisions : les plus anciennes s'effacent
      const [oldest] = (await ctx.api.store.page(ROUNDS, { limit: 1, order: "asc" })).items;
      if (!oldest) break;
      await ctx.api.store.remove(oldest.id);
    }
  });
  await dropRoundPoll(ctx, cur);
  await note(ctx, "round.decision", `${ctx.t("journalRound", { n: rec.n })} : ${rec.winner ?? ctx.t("noWinner")}${tie ? ` (${ctx.t("journalTie", { list: tie.join(", ") })})` : ""}`);
  return rec;
}

const decisionOf = (rec) => ({ slug: rec.k, n: rec.n, question: rec.question, winner: rec.winner, tie: rec.tie, voters: rec.voters, decidedAt: rec.decidedAt, choices: rec.choices });

/** Fait avancer la série si une manche est finie. À appeler SOUS le verrou « series: ». */
async function advanceLocked(ctx, now, opts = {}) {
  let series = await getSeries(ctx);
  if (!series || series.status !== "running") return series;
  const cur = await bySlug(ctx, series.current);
  if (cur && L.stateOf(cur, now) === "open") return series;
  let prevEnd = null;
  if (cur) {
    prevEnd = L.endedAtMs(cur, now);
    series = { ...series, current: null, lastDecision: decisionOf(await decideRound(ctx, series, cur, now, opts)) };
  } else if (series.current) series = { ...series, current: null };
  const startAt = prevEnd && now - prevEnd >= 0 && now - prevEnd < ROUND.resumeGapMs ? prevEnd : now;   // sans trou ni dérive quand l'écran regarde en continu
  const n = (Number(series.n) || 0) + 1;
  const made = await createPoll(ctx, { question: series.question, choices: series.choices, max: 1, endsAt: isoOf(startAt + series.minutes * 60_000), resultsMode: "always" }, tzOf(ctx), startAt, { round: { n, run: series.runId } });
  series = made.ok ? { ...series, n, current: made.slug } : series;
  await saveSeries(ctx, series);
  return series;
}

/** Regarde si une manche est finie et, si oui, décide et passe à la suivante. Ne coûte presque rien quand il n'y a rien à faire. */
export async function advance(ctx, now = Date.now(), opts = {}) {
  const series = await getSeries(ctx);
  if (!series || series.status !== "running") return series;
  const cur = await bySlug(ctx, series.current);
  if (cur && L.stateOf(cur, now) === "open") return series;
  const out = await withLock(ctx, () => advanceLocked(ctx, now, opts), "series:");
  await syncLive(ctx, now);
  return out;
}

export async function startSeries(ctx, now = Date.now(), opts = {}) {
  const r = await withLock(ctx, async () => {
    const series = await ensureSeries(ctx);
    if (series.status === "running") return { ok: false, error: "already" };
    await saveSeries(ctx, { ...series, status: "running", runId: randomBytes(6).toString("hex"), n: 0, current: null, startedAt: isoOf(now), stoppedAt: null });
    await advanceLocked(ctx, now, opts);
    return { ok: true };
  }, "series:");
  if (r.ok) { await note(ctx, "round.start", ctx.t("journalStart")); await syncLive(ctx, now); }
  return r;
}

/** « Suivant » : la manche en cours se termine tout de suite, le vainqueur est décidé, la suivante démarre. */
export async function nextRound(ctx, now = Date.now(), opts = {}) {
  const r = await withLock(ctx, async () => {
    const series = await getSeries(ctx);
    if (!series || series.status !== "running") return { ok: false, error: "idle" };
    const cur = await bySlug(ctx, series.current);
    if (cur && L.stateOf(cur, now) === "open") await closeNow(ctx, cur.id, now);
    await advanceLocked(ctx, now, { via: "next", ...opts });
    return { ok: true };
  }, "series:");
  if (r.ok) await syncLive(ctx, now);
  return r;
}

/** « Arrêter » : la série s'arrête et la manche en cours est annulée (aucune décision, ses votes sont effacés). */
export async function stopSeries(ctx, now = Date.now()) {
  const r = await withLock(ctx, async () => {
    const series = await getSeries(ctx);
    if (!series || series.status !== "running") return { ok: false, error: "idle" };
    const cur = await bySlug(ctx, series.current);
    if (cur) await dropRoundPoll(ctx, cur);
    await saveSeries(ctx, { ...series, status: "idle", current: null, stoppedAt: isoOf(now) });
    return { ok: true, cancelled: !!cur && (Number(cur.voters) || 0) > 0 };
  }, "series:");
  if (r.ok) { await note(ctx, "round.stop", ctx.t("journalStop")); await syncLive(ctx, now); }
  return r;
}

/** « A ou B ? » en un geste : un sondage court de 2 à 4 choix, tout de suite à l'écran. */
export async function quickPoll(ctx, values, now = Date.now()) {
  const q = L.validateQuick(values);
  if (Object.keys(q.errors).length) return { ok: false, errors: q.errors };
  const question = q.value.question || (q.value.choices.length === 2 ? ctx.t("quickQuestion2", { a: q.value.choices[0], b: q.value.choices[1] }) : ctx.t("quickQuestionMany"));
  const ends = now + q.value.seconds * 1000;
  const made = await createPoll(ctx, { question: clean(question, LIMITS.question), choices: q.value.choices, max: 1, endsAt: isoOf(ends), resultsMode: "always" }, tzOf(ctx), now, { quick: true });
  if (!made.ok) return { ok: false, error: "full" };
  await withLock(ctx, async () => { const cfg = await ensureCfg(ctx); await saveCfg(ctx, { ...cfg, onAir: made.slug, onAirUntil: isoOf(ends + ROUND.pinGraceMs) }); });
  await note(ctx, "poll.quick", `${clean(question, 100)}`);
  await syncLive(ctx, now);
  return { ok: true, slug: made.slug, id: made.id, endsAt: isoOf(ends) };
}

/**
 * Les limites et l'identité d'un vote. Avec Participation : débit par connexion et par personne, inscription dans la salle, sourdine. Sans lui (ou s'il ne répond pas) :
 * le limiteur local, comme avant. Rend { audience: true|false } pour voter, ou { refuse, status } pour refuser.
 */
async function voteGate(ctx, request, { slug, token, now }) {
  const room = B.roomOf(ctx), conn = B.connOf(request);
  if (await B.present(ctx)) {
    const hourly = await B.audience(ctx, "limit", { room, scope: "vote", conn, token, max: num(ctx.setting("ratePerHour"), 30, 3, 300), per: 3600 });
    if (hourly) {
      const poll = hourly.ok ? await B.audience(ctx, "limit", { room, scope: `p-${slug}`.replace(/[^a-z0-9:._-]/g, "").slice(0, 40) || "p", conn, max: 8, per: 600 }) : null;
      const joined = poll?.ok ? await B.audience(ctx, "join", { room, label: ctx.instance.name, token, conn }) : null;
      const bad = [hourly, poll, joined].find((x) => x && !x.ok);
      if (bad) return { refuse: B.reasonOf(bad.error), status: bad.error === "limit" ? 429 : bad.error === "muted" ? 403 : bad.error === "room_full" || bad.error === "busy" ? 503 : 400, retryAfter: bad.retryAfter };
      if (joined?.participant?.muted) return { refuse: "muted", status: 403 };
      if (joined) return { audience: true };
    }
  }
  const fp = fingerprint(request, now);
  if (over(`a|${ctx.instance.key}|${fp}`, num(ctx.setting("ratePerHour"), 30, 3, 300), HOUR, now) || over(`p|${ctx.instance.key}|${fp}|${slug}`, 8, 10 * 60_000, now)) return { refuse: "limit", status: 429 };
  return { audience: false };
}

/* ───────────── Visibilité des résultats ───────────── */

const myBallot = async (ctx, p, token) => (TOKEN_RE.test(String(token ?? "")) && !p.archived ? byKey(ctx, `b-${p.id}`, ballotKey(p.id, token), "k") : null);
const canSeeResults = (p, voted, now = Date.now()) => L.stateOf(p, now) === "closed" || p.resultsMode !== "after" || voted;

/* ───────────── Affichage public ───────────── */

const CSS = `.vp{box-sizing:border-box;border:1px solid var(--v-line);background:var(--v-surface);color:var(--v-fg);border-radius:16px;padding:16px;display:grid;gap:14px;max-width:44rem;margin:0 auto}
.vp *{box-sizing:border-box}.vp-q{margin:0;font-size:1.25rem;line-height:1.3;overflow-wrap:anywhere}.vp-meta,.vp-hint{margin:0;color:var(--v-muted);font-size:.92rem}
.vp-form fieldset{border:0;margin:0;padding:0;min-width:0;display:grid;gap:8px}.vp-form legend{color:var(--v-muted);font-size:.92rem;padding:0;margin-bottom:6px}
.vp-opt{display:flex;align-items:center;gap:12px;min-height:48px;padding:8px 12px;border:1px solid var(--v-line);border-radius:12px;cursor:pointer;overflow-wrap:anywhere}
.vp-opt:has(input:checked){border-color:var(--v-accent);box-shadow:0 0 0 2px var(--v-accent)}.vp-opt:focus-within{outline:3px solid var(--v-fg);outline-offset:2px}
.vp-opt input{width:22px;height:22px;flex:none;accent-color:var(--v-accent)}.vp-opt input:disabled+span{opacity:.55}
.vp-btn{min-height:48px;padding:0 22px;border-radius:999px;border:0;background:var(--v-accent);color:var(--v-accent-fg);font:inherit;font-weight:700;cursor:pointer;justify-self:start}
.vp-btn:disabled{opacity:.6;cursor:wait}.vp-btn:focus-visible{outline:3px solid var(--v-fg);outline-offset:2px}
.vp-err{color:var(--v-danger);margin:0;font-weight:600}.vp-ok{margin:0;font-weight:600}.vp-hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.vp-bars{list-style:none;margin:0;padding:0;display:grid;gap:14px}.vp-line{display:flex;justify-content:space-between;align-items:baseline;gap:4px 12px;flex-wrap:wrap}
.vp-label{font-weight:600;overflow-wrap:anywhere}.vp-num{font-variant-numeric:tabular-nums}
.vp-track{height:16px;border-radius:8px;background:var(--v-bg);border:1px solid var(--v-muted);overflow:hidden;margin-top:6px}
.vp-fill{height:100%;background:var(--v-accent);transition:width .5s}.vp-lead .vp-fill{background-image:repeating-linear-gradient(135deg,transparent 0 6px,rgba(0,0,0,.28) 6px 9px)}
.vp-tag{display:inline-block;margin:6px 6px 0 0;font-size:.82rem;font-weight:700;border:1px solid var(--v-fg);border-radius:999px;padding:1px 10px}
.vp-h{margin:1.6rem 0 .8rem;font-size:1.3rem;font-weight:700}.vp-list{list-style:none;margin:0;padding:0;display:grid;gap:10px}.vp-list a{display:block;padding:12px 14px;min-height:48px;border:1px solid var(--v-line);border-radius:12px;background:var(--v-surface);color:var(--v-fg);text-decoration:none}
.vp-list a:hover,.vp-list a:focus-visible{border-color:var(--v-accent)}.vp-list b{display:block;overflow-wrap:anywhere}.vp-list small{color:var(--v-muted)}
.vp-cd{font-variant-numeric:tabular-nums}.vp-decision{margin:0;padding:12px 16px;border:3px solid var(--v-accent);border-radius:14px;font-weight:700;overflow-wrap:anywhere}
.vp-dec b{display:block}.vp-nav{display:flex;flex-wrap:wrap;gap:8px 18px;margin:.4rem 0 0}.vp-nav a{display:inline-flex;align-items:center;min-height:44px}
@media (prefers-reduced-motion:reduce){.vp-fill{transition:none}}`;

const votesText = (ctx, n) => ctx.t(n === 1 ? "voice_one" : "voice_many", { n });
const votersText = (ctx, n) => ctx.t(n === 1 ? "voters_one" : "voters_many", { n });

function resultsHtml(ctx, p, mine = []) {
  const rows = L.rows(p);
  const closed = L.stateOf(p) === "closed";
  const items = rows.map((r) => `<li class="vp-row${r.lead ? " vp-lead" : ""}"><div class="vp-line"><span class="vp-label">${esc(r.text)}</span><span class="vp-num"><strong>${r.pct} %</strong> · ${esc(votesText(ctx, r.count))}</span></div>` +
    `<div class="vp-track" aria-hidden="true"><div class="vp-fill" style="width:${r.pct}%"></div></div>` +
    `${r.lead ? `<span class="vp-tag">${esc(ctx.t(closed ? "winner" : "leading"))}</span>` : ""}${mine.includes(r.id) ? `<span class="vp-tag">✓ ${esc(ctx.t("yourChoice"))}</span>` : ""}</li>`).join("");
  return `<p class="vp-hint">${esc(ctx.t(closed ? "finalResult" : "liveResult"))} · ${esc(votersText(ctx, Number(p.voters) || 0))}</p><ol class="vp-bars">${items}</ol>`;
}

function endLine(ctx, p, reload = false) {
  const closed = L.stateOf(p) === "closed";
  if (closed) {
    const when = L.endedAtMs(p);
    return esc(ctx.t("endedOn", { date: when ? L.formatEnd(new Date(when).toISOString(), p.tz || DEFAULT_TZ, ctx.locale) : "" }));
  }
  if (!p.endsAt) return esc(ctx.t("noEnd"));
  if (p.round || p.quick) {   // une manche ou un sondage rapide : le temps qui reste, pas une date
    const left = Math.max(0, Date.parse(p.endsAt) - Date.now());
    return `${p.round ? `${esc(ctx.t("roundBadge", { n: p.round.n }))} · ` : ""}${esc(ctx.t("timeLeft"))} <strong class="vp-cd" data-vp-cd data-left="${left}"${reload ? ' data-reload="1"' : ""}>${esc(L.clock(left))}</strong>`;
  }
  return `${esc(ctx.t("endsOn", { date: "" }))}<time datetime="${esc(p.endsAt)}" data-vp-end data-label="${esc(ctx.t("localLabel"))}">${esc(L.formatEnd(p.endsAt, p.tz || DEFAULT_TZ, ctx.locale))}</time><span data-vp-local hidden></span>`;
}

/** Le bloc d'un sondage : question, formulaire (s'il est ouvert), résultats (selon le choix d'Emma). Même rendu sur la page, l'accueil et après un vote. */
export function pollHtml(ctx, p, { title = "h2", link = null, reload = false } = {}) {
  const closed = L.stateOf(p) === "closed";
  const head = title ? `<${title} class="vp-q">${link ? `<a href="${esc(link)}" style="color:inherit">${esc(p.question)}</a>` : esc(p.question)}</${title}>` : "";
  const max = Math.min(p.max || 1, p.choices.length);
  const attrs = ["closed", "already", "limit", "invalid", "net", "busy", "full", "gone", "thanks", "pick", "muted"].map((c) => `data-m-${c}="${esc(ctx.t(`msg_${c}`))}"`).join(" ")
    + ` data-m-busy="${esc(ctx.t("sending"))}"`
    + ` data-t-live="${esc(ctx.t("liveResult"))}" data-t-final="${esc(ctx.t("finalResult"))}" data-t-leading="${esc(ctx.t("leading"))}" data-t-winner="${esc(ctx.t("winner"))}" data-t-yours="${esc(ctx.t("yourChoice"))}"`
    + ` data-t-voice1="${esc(ctx.t("voice_one", { n: "{n}" }))}" data-t-voicen="${esc(ctx.t("voice_many", { n: "{n}" }))}" data-t-voters1="${esc(ctx.t("voters_one", { n: "{n}" }))}" data-t-votersn="${esc(ctx.t("voters_many", { n: "{n}" }))}"`;
  const type = max > 1 ? "checkbox" : "radio";
  const form = closed ? "" :
    `<form class="vp-form" data-vp-form hidden novalidate><fieldset><legend>${esc(ctx.t(max > 1 ? "hintMany" : "hintOne", { n: max }))}</legend>` +
    p.choices.map((c) => `<label class="vp-opt"><input type="${type}" name="c" value="${esc(c.id)}"><span>${esc(c.text)}</span></label>`).join("") +
    `</fieldset><div class="vp-hp" aria-hidden="true"><label>Website<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>` +
    `<p class="vp-err" data-vp-err role="alert" hidden></p><button type="submit" class="vp-btn">${esc(ctx.t("vote"))}</button></form>` +
    `<noscript><p class="vp-hint">${esc(ctx.t("needScript"))}</p></noscript><p class="vp-ok" data-vp-ok role="status" hidden></p>`;
  const show = canSeeResults(p, false);
  const res = show ? resultsHtml(ctx, p) : `<p class="vp-hint">${esc(ctx.t("hiddenUntilVote"))}</p>`;
  return `<style>${CSS}</style><section class="vp" data-vp data-poll="${esc(p.slug)}" data-api="/m/${esc(ctx.instance.key)}" data-lang="${esc(ctx.locale)}" data-max="${max}" ${attrs}>` +
    `${head}<p class="vp-meta">${endLine(ctx, p, reload)}${p.archived ? ` · ${esc(ctx.t("archivedNote"))}` : ""}</p>${form}<div data-vp-res${show ? ' data-shown="1"' : ""} aria-live="polite">${res}</div></section>`;
}

const fmtDay = (ctx, iso, tz) => { try { return new Intl.DateTimeFormat(ctx.locale, { timeZone: tz, dateStyle: "long" }).format(new Date(iso)); } catch { return String(iso).slice(0, 10); } };

function listItem(ctx, p) {
  const href = pollHref(ctx, p.slug);
  const open = L.stateOf(p) === "open";
  const rows = L.rows(p);
  const lead = rows.filter((r) => r.lead).map((r) => r.text).join(", ");
  const meta = open
    ? `${endLine(ctx, p).replace(/<[^>]+>/g, "")}`
    : `${esc(ctx.t("endedShort", { date: fmtDay(ctx, new Date(L.endedAtMs(p) || Date.now()).toISOString(), p.tz || DEFAULT_TZ) }))} · ${esc(votersText(ctx, Number(p.voters) || 0))}${lead ? ` · ${esc(ctx.t("winnerIs", { text: lead }))}` : ""}`;
  return `<li><a href="${esc(href ? loc(ctx, href) : "#")}"><b>${esc(p.question)}</b><small>${meta}</small></a></li>`;
}

const byEnded = (now) => (a, b) => (L.endedAtMs(b, now) || 0) - (L.endedAtMs(a, now) || 0);

/** Les sondages terminés, du plus récent au plus ancien : d'abord les complets, puis les archivés. 50 par page. */
async function pastPage(ctx, page, now = Date.now()) {
  const live = (await livePolls(ctx)).filter((p) => listed(p) && L.stateOf(p, now) === "closed").sort(byEnded(now));
  const archived = await ctx.api.store.count(ARCHIVE);
  const total = live.length + archived;
  const start = (page - 1) * PAGE;
  const items = live.slice(start, start + PAGE);
  const need = Math.min(PAGE - items.length, Math.max(0, total - start - items.length));
  if (need > 0) {
    const skip = Math.max(0, start - live.length);
    let cursor = null, seen = 0;
    const got = [];
    for (let i = 0; i < 20 && got.length < need; i++) {
      const pg = await ctx.api.store.page(ARCHIVE, { limit: 100, cursor });
      for (const r of pg.items) { if (seen++ >= skip && got.length < need) got.push(pollOf(r, "archive")); }
      cursor = pg.next;
      if (!cursor) break;
    }
    items.push(...got);
  }
  return { items, total, pages: Math.max(1, Math.ceil(total / PAGE)) };
}

const pager = (ctx, page, pages) => {
  const b = baseOf(ctx) ?? "";
  const link = (n, label) => `<a href="${esc(loc(ctx, n === 1 ? b || "/" : `${b}/page/${n}`))}">${esc(label)}</a>`;
  return pages > 1 ? `<p>${page > 1 ? link(page - 1, ctx.t("prevPage")) : ""}${page > 1 && page < pages ? " · " : ""}${page < pages ? link(page + 1, ctx.t("nextPage")) : ""}</p>` : "";
};

/* ───────────── Pages « en cours » et « décisions » ───────────── */

/** La phrase d'une décision, dite en clair — avec le tirage au sort quand il y a eu égalité. */
function decisionText(ctx, d) {
  if (!d.winner) return ctx.t("decisionNone");
  return d.tie && d.tie.length > 1 ? ctx.t("decisionTie", { list: d.tie.join(", "), winner: d.winner }) : ctx.t("decisionWinner", { winner: d.winner });
}

/** Le lien stable à partager pendant un live : toujours le sondage ou la manche du moment. */
async function nowPage(ctx) {
  const now = Date.now();
  await advance(ctx, now);
  const cfg = await ensureCfg(ctx);
  const series = await getSeries(ctx);
  const p = await onAirPoll(ctx, cfg, null, now);
  const dec = recentDecision(series, now, winnerSeconds(ctx));
  const info = (await B.present(ctx)) ? await B.audience(ctx, "info", {}) : null;
  const closed = !!p && L.stateOf(p, now) === "closed";
  const live = info?.ok && typeof info.base === "string"
    ? { url: `${info.base}/direct?room=${encodeURIComponent(B.roomOf(ctx))}&channel=now`, base: 4000, max: 30000, slug: p?.slug ?? "", state: closed ? "closed" : "open",
        t: { decided: ctx.t("decisionWinner", { winner: "{winner}" }), nodecision: ctx.t("decisionNone"), tie: ctx.t("decisionTie", { list: "{list}", winner: "{winner}" }) } }
    : null;
  const b = baseOf(ctx) ?? "";
  let html = `<style>${CSS}</style><div style="display:grid;gap:14px"${live ? ` data-vp-live="${esc(JSON.stringify(live))}"` : ""}>`;
  html += `<p class="vp-decision" data-vp-decision${dec ? "" : " hidden"} role="status">${dec ? esc(decisionText(ctx, dec)) : ""}</p>`;
  html += p ? pollHtml(ctx, p, { title: "h2", reload: true }) : `<p class="vp-hint">${esc(ctx.t(series?.status === "running" ? "nowWaiting" : "nowNone"))}</p>`;
  html += `<p class="vp-nav"><a href="${esc(loc(ctx, `${b}/decisions`))}">${esc(ctx.t("seeDecisions"))}</a><a href="${esc(loc(ctx, b || "/"))}">${esc(ctx.t("allPolls"))}</a></p></div>`;
  return { title: ctx.t("nowTitle"), description: ctx.t("nowDescription"), blocks: [{ type: "html", html }] };
}

const decisionItem = (ctx, r) => {
  const counts = r.choices.map((c) => `${c.text} ${c.count}`).join(" · ");
  return `<li class="vp-dec"><b>${esc(ctx.t("roundBadge", { n: r.n }))} · ${esc(decisionText(ctx, r))}</b><small>${esc(r.question)} · ${esc(stamp(ctx, r.decidedAt, DEFAULT_TZ))} · ${esc(votersText(ctx, r.voters))} · ${esc(counts)}</small></li>`;
};

/** L'historique public des décisions du chat, 50 par page, les plus récentes d'abord. */
async function decisionsPage(ctx, n) {
  if (!Number.isInteger(n) || n < 1) return { notFound: true, blocks: [] };
  const total = await ctx.api.store.count(ROUNDS);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  if (n > pages) return { notFound: true, blocks: [] };
  let cursor = null, items = [];
  for (let i = 1; i <= n; i++) { const pg = await ctx.api.store.page(ROUNDS, { limit: PAGE, cursor }); if (i === n) items = pg.items; cursor = pg.next; if (!cursor) break; }
  const b = baseOf(ctx) ?? "";
  const link = (k, label) => `<a href="${esc(loc(ctx, k === 1 ? `${b}/decisions` : `${b}/decisions/page/${k}`))}">${esc(label)}</a>`;
  const pager = pages > 1 ? `<p>${n > 1 ? link(n - 1, ctx.t("prevPage")) : ""}${n > 1 && n < pages ? " · " : ""}${n < pages ? link(n + 1, ctx.t("nextPage")) : ""}</p>` : "";
  const html = `<style>${CSS}</style>${items.length ? `<ul class="vp-list">${items.map((r) => decisionItem(ctx, r.data)).join("")}</ul>${pager}` : `<p class="vp-hint">${esc(ctx.t("noDecisions"))}</p>`}<p class="vp-nav"><a href="${esc(loc(ctx, `${b}/now`))}">${esc(ctx.t("seeNow"))}</a><a href="${esc(loc(ctx, b || "/"))}">${esc(ctx.t("allPolls"))}</a></p>`;
  return { title: ctx.t("decisionsTitle"), description: ctx.t("decisionsDescription"), blocks: [{ type: "html", html }] };
}

/**
 * Une adresse de sondage qui ne mène à rien (supprimé, jamais existé, mal copié) : le MÊME message neutre dans tous les cas, sans le nom du sondage ni rien qui dise
 * s'il a existé. Une adresse qui ne ressemble pas à un nom de sondage reste une page « introuvable » ordinaire. (Pas de consigne aux moteurs de recherche : elle exigerait minCore 0.2.14.)
 */
function gonePage(ctx, segment) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(segment ?? "")) || String(segment).length > 80) return { notFound: true, blocks: [] };
  const b = baseOf(ctx) ?? "";
  const html = `<style>${CSS}</style><section class="vp"><p class="vp-q" role="status">${esc(ctx.t("goneText"))}</p><p class="vp-nav"><a href="${esc(loc(ctx, b || "/"))}">${esc(ctx.t("allPolls"))}</a></p></section>`;
  return { title: ctx.t("goneTitle"), description: ctx.t("goneTitle"), blocks: [{ type: "html", html }] };
}

/** Une manche déjà décidée : son ancien lien montre ce que le chat a choisi. */
function decisionPage(ctx, r) {
  const b = baseOf(ctx) ?? "";
  const html = `<style>${CSS}</style><section class="vp"><h2 class="vp-q">${esc(r.question)}</h2><p class="vp-decision" role="status">${esc(decisionText(ctx, r))}</p><ul class="vp-list">${decisionItem(ctx, r)}</ul>` +
    `<p class="vp-nav"><a href="${esc(loc(ctx, `${b}/decisions`))}">${esc(ctx.t("seeDecisions"))}</a><a href="${esc(loc(ctx, `${b}/now`))}">${esc(ctx.t("seeNow"))}</a></p></section>`;
  return { title: r.question, description: ctx.t("decisionsDescription"), blocks: [{ type: "html", html }] };
}

/* ───────────── Source navigateur OBS et direct ───────────── */

/** Ce qui est à l'écran : le sondage demandé dans l'adresse, puis celui qu'Emma a choisi (ou le sondage rapide, le temps qu'il dure), puis la manche en cours, puis le plus récent. */
async function onAirPoll(ctx, cfg, query, now = Date.now()) {
  const asked = query?.get?.("poll");
  if (asked) return findPoll(ctx, asked);   // une source épinglée sur un sondage qui n'existe plus (supprimé) n'affiche RIEN : jamais un autre sondage à sa place
  // Élément de page d'overlay (option « Quel sondage ») : un sondage précis s'il existe encore, sinon on retombe sur le choix automatique ci-dessous, sans rien casser.
  const want = clean(query?.get?.("want"), 100);
  if (want) { const p = (await findPoll(ctx, want)) ?? (await findById(ctx, want)); if (p) return p; }
  if (cfg?.onAir && (!cfg.onAirUntil || Date.parse(cfg.onAirUntil) > now)) { const p = await findPoll(ctx, cfg.onAir); if (p) return p; }
  const series = await getSeries(ctx);
  if (series?.status === "running") { const p = await bySlug(ctx, series.current); if (p) return p; }
  const open = (await livePolls(ctx)).filter((p) => listed(p) && L.stateOf(p, now) === "open").sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return open[0] ?? null;
}

/** La décision qui vient d'être prise, tant qu'elle doit rester à l'écran. */
function recentDecision(series, now, seconds) {
  const d = series?.lastDecision;
  if (!d) return null;
  const until = Date.parse(d.decidedAt) + seconds * 1000;
  return until > now ? { n: d.n, winner: d.winner, tie: d.tie, voters: d.voters, showUntil: isoOf(until) } : null;
}
const winnerSeconds = (ctx) => num(ctx.setting("winnerSeconds"), 20, 5, 120);

/** Les chiffres de l'écran. Sans sondage à montrer : rien, ou la décision qui vient d'être prise. `rev` change dès que quelque chose change (le navigateur ne redessine pas sinon). */
function liveData(p, now = Date.now(), series = null, seconds = 20) {
  const decision = recentDecision(series, now, seconds);
  if (!p) return decision ? { rev: `d.${series.lastDecision.decidedAt}`, kind: "decision", state: "decided", decision, question: "", voters: 0, endsAt: null, rows: [] } : { empty: true, rev: "none" };
  const state = L.stateOf(p, now);
  return {
    rev: `${p.id}.${p.rev || 0}.${state}.${decision ? series.lastDecision.decidedAt : ""}`, state, question: p.question, voters: Number(p.voters) || 0, endsAt: p.endsAt ?? null, rows: L.rows(p),
    ...(p.round ? { round: { n: p.round.n } } : {}), ...(p.quick ? { quick: true } : {}), ...(decision ? { decision } : {}),
  };
}

/** La version publique : les chiffres restent cachés tant qu'un sondage « résultats après le vote » est ouvert. */
const publicData = (d, p, now = Date.now()) => (d.empty || !p || L.stateOf(p, now) === "closed" || p.resultsMode !== "after" ? { ...d, slug: p?.slug ?? null } : { ...d, slug: p.slug, rows: null, hidden: true });

/**
 * Publie l'état en direct chez Participation (écran OBS : canal privé ; page publique : canal public), s'il est là. Silencieux, jamais bloquant.
 * `refreshAt` : l'instant où l'état change tout seul (fin de la manche) — le premier lecteur après cet instant fait avancer la série (voir « tick »).
 */
export function syncLive(ctx) {
  const key = ctx.instance.key;
  if (pendingSync.has(key)) return pendingSync.get(key);   // une mise à jour attend déjà son tour : elle lira l'état le plus récent
  const run = withLock(ctx, async () => { pendingSync.delete(key); await publishLive(ctx, Date.now()); }, "sync:").catch(() => {});
  pendingSync.set(key, run);
  return run;
}
const pendingSync = (globalThis.__curiosaPollsSync ??= new Map());

async function publishLive(ctx, now) {
  try {
    if (!(await B.present(ctx))) return;
    const cfg = await ensureCfg(ctx);
    const series = await getSeries(ctx);
    const p = await onAirPoll(ctx, cfg, null, now);
    const screen = liveData(p, now, series, winnerSeconds(ctx));
    const refreshAt = p && L.stateOf(p, now) === "open" && p.endsAt ? p.endsAt : null;
    if (!(await B.publish(ctx, "screen", screen, { readKey: cfg.obsKey, refreshAt }))) return;
    await B.publish(ctx, "now", publicData(screen, p, now), { public: true, refreshAt });
  } catch (e) { console.error("[polls] live sync failed:", e?.message); }
}

/* ───────────── Élément « Sondage » des pages d'overlay ───────────── */

/** Un sondage d'exemple pour le mode test d'une page d'overlay : rien n'est lu ni écrit, aucun vrai sondage n'est montré. */
function demoScreen(ctx) {
  const rows = [[ctx.t("ovDemoA"), 12], [ctx.t("ovDemoB"), 7], [ctx.t("ovDemoC"), 4]].map(([text, count], i) => ({ id: `d${i}`, text, count, pct: Math.round((count / 23) * 100), lead: i === 0 }));
  return { rev: "demo", state: "open", question: ctx.t("ovDemoQuestion"), voters: 23, endsAt: null, rows };
}

/**
 * La feuille de style de l'élément : elle remplit le cadre, suit le style commun par les jetons --ov-* (avec repli sur les couleurs propres du module quand le style n'est pas transmis)
 * et décrit les morceaux par leurs attributs data-ov-part. Aucune classe en dur, aucun skin du site. Cadre large et bas : le titre à gauche, les choix à droite ; sinon tout empilé.
 */
function elementCss(query, { accent, fg, card }) {
  const given = query.has("ov-text"), dark = query.get("ov-text") === "dark", soft = query.get("ov-surface") === "soft", square = query.get("ov-corners") === "square";
  const tokens = given ? `:root{--ov-fg:${dark ? "#111111" : "#ffffff"};--ov-surface:${soft ? (dark ? "rgba(255,255,255,.7)" : "rgba(0,0,0,.55)") : "transparent"};--ov-radius:${square ? "0px" : "12px"};--ov-border:${soft ? (dark ? "rgba(0,0,0,.2)" : "rgba(255,255,255,.25)") : "transparent"}}` : "";
  const shadow = given && !dark && !soft ? "text-shadow:0 1px 4px rgba(0,0,0,.45);" : "";
  return `${tokens}
html,body{margin:0;background:transparent;overflow:hidden;font-family:system-ui,sans-serif}
[data-ov-region="element"]{position:fixed;inset:0;overflow:hidden;font-size:var(--vo-fs,18px);line-height:1.25;color:var(--ov-fg,${fg});${shadow}--vo-accent:${accent}}
[data-ov-part="panel"]{box-sizing:border-box;height:100%;display:flex;flex-direction:column;padding:.6em .8em;background:var(--ov-surface,${card});border:1px solid var(--ov-border,transparent);border-radius:var(--ov-radius,.9em);overflow:hidden}
[data-ov-part="body"]{margin:auto 0;display:flex;flex-direction:column;gap:.55em;min-width:0}
[data-ov-part="summary"]{display:contents}
[data-ov-part="status"]{order:0;margin:0;font-size:.8em;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--vo-accent)}
[data-ov-part="clock"]{margin-left:.5em;font-variant-numeric:tabular-nums}
[data-ov-part="decision"]{order:1;margin:0;padding:.4em .7em;border:.12em solid var(--vo-accent);border-radius:.6em}
[data-ov-part="decision-title"]{margin:0;font-size:.8em;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--vo-accent)}
[data-ov-part="decision-winner"]{margin:.1em 0 0;font-size:1.4em;font-weight:800;line-height:1.15;overflow-wrap:anywhere}
[data-ov-part="decision-tie"]{margin:.2em 0 0;font-size:.8em}
[data-ov-part="question"]{order:2;margin:0;font-size:1.3em;font-weight:700;line-height:1.2;overflow-wrap:anywhere}
[data-ov-part="choices"]{order:3;list-style:none;margin:0;padding:0;display:grid;gap:.5em;min-width:0}
[data-ov-part="choice-line"]{display:flex;justify-content:space-between;gap:.6em;font-size:.95em}
[data-ov-part="choice-label"]{font-weight:600;overflow-wrap:anywhere;min-width:0}
[data-ov-part="choice-count"]{white-space:nowrap}
[data-ov-part="bar"]{height:.7em;margin-top:.2em;border-radius:.4em;background:rgba(127,127,127,.35);border:.1em solid var(--ov-fg,${fg});overflow:hidden}
[data-ov-part="bar-fill"]{height:100%;background:var(--vo-accent);transition:width .6s}
[data-ov-part="choice"][data-lead] [data-ov-part="bar-fill"]{background-image:repeating-linear-gradient(135deg,transparent 0 .4em,rgba(0,0,0,.3) .4em .65em)}
[data-ov-part="tag"]{display:inline-block;margin-top:.15em;font-size:.7em;font-weight:700;border:.1em solid var(--ov-fg,${fg});border-radius:999px;padding:0 .6em}
[data-ov-part="foot"]{order:4;margin:0;font-size:.8em;opacity:.85}
@media (min-aspect-ratio:9/5){[data-ov-part="body"]{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,6fr);column-gap:1.4em;align-items:center}[data-ov-part="summary"]{display:flex;flex-direction:column;gap:.55em;min-width:0}}
@media (prefers-reduced-motion:reduce){[data-ov-part="bar-fill"]{transition:none}}`;
}

const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });

/* ───────────── Formulaires d'administration ───────────── */

const ZONE_FALLBACK = DEFAULT_TZ;
const zoneName = (tz, locale) => { try { return new Intl.DateTimeFormat(locale, { timeZone: tz, timeZoneName: "long" }).formatToParts(new Date()).find((x) => x.type === "timeZoneName")?.value ?? tz; } catch { return tz || ZONE_FALLBACK; } };
const stamp = (ctx, iso, tz) => { try { return new Intl.DateTimeFormat(ctx.locale, { timeZone: tz, dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)); } catch { return String(iso ?? ""); } };

const pollFields = (ctx, v = {}, { withChoices = true } = {}) => [
  { name: "question", label: ctx.t("fQuestion"), kind: "text", required: true, value: v.question ?? "", help: ctx.t("fQuestionHelp") },
  ...(withChoices ? [{ name: "choices", label: ctx.t("fChoices"), kind: "textarea", required: true, value: v.choices ?? "", help: ctx.t("fChoicesHelp") }] : []),
  { name: "max", label: ctx.t("fMax"), kind: "number", value: String(v.max ?? 1), help: ctx.t("fMaxHelp") },
  { name: "resultsMode", label: ctx.t("fResults"), kind: "select", value: v.resultsMode ?? (ctx.setting("resultsDefault") === "after" ? "after" : "always"),
    options: [{ value: "always", label: ctx.t("resAlways") }, { value: "after", label: ctx.t("resAfter") }], help: ctx.t("fResultsHelp") },
  { name: "endDate", label: ctx.t("fEndDate"), kind: "date", value: v.endDate ?? "", help: ctx.t("fEndDateHelp", { zone: zoneName(tzOf(ctx), ctx.locale) }) },
  { name: "endTime", label: ctx.t("fEndTime"), kind: "text", value: v.endTime ?? "", help: ctx.t("fEndTimeHelp") },
];

const fieldErrors = (ctx, errors) => Object.fromEntries(Object.entries(errors).map(([k, code]) => [k, ctx.t(`err_${code}`, { min: LIMITS.minChoices, max: LIMITS.maxChoices })]));

/** Une action d'administration réservée à un droit du module (le cœur ne contrôle que « ouvrir » pour une action écrite en simple fonction). */
const needs = (right, fn) => async (ctx, values) => (can(ctx, right) ? fn(ctx, values) : { error: ctx.t("errRight") });

/* ───────────── Administration des manches et du sondage rapide ───────────── */

const SEC_LABELS = { 30: "quickSec30", 60: "quickSec60", 120: "quickSec120", 300: "quickSec300" };
const quickFields = (ctx, v = {}) => [
  { name: "a", label: ctx.t("fQuickA"), kind: "text", required: true, value: v.a ?? "", help: ctx.t("fQuickAHelp") },
  { name: "b", label: ctx.t("fQuickB"), kind: "text", required: true, value: v.b ?? "" },
  { name: "c", label: ctx.t("fQuickC"), kind: "text", value: v.c ?? "" },
  { name: "d", label: ctx.t("fQuickD"), kind: "text", value: v.d ?? "" },
  { name: "seconds", label: ctx.t("fQuickSeconds"), kind: "select", value: String(v.seconds ?? quickDefault(ctx)), options: L.ROUND.quickSeconds.map((n) => ({ value: String(n), label: ctx.t(SEC_LABELS[n]) })) },
];
const quickDefault = (ctx) => { const n = num(ctx.setting("quickSeconds"), 60, 15, 900); return L.ROUND.quickSeconds.reduce((best, x) => (Math.abs(x - n) < Math.abs(best - n) ? x : best), 60); };

async function roundsBlocks(ctx, manage, now) {
  const tab = "screen";
  const series = await ensureSeries(ctx);
  const running = series.status === "running";
  const cur = running ? await bySlug(ctx, series.current) : null;
  const b = baseOf(ctx);
  const out = [{ type: "heading", text: ctx.t("roundsTitle"), tab }, { type: "markdown", text: ctx.t("roundsIntro"), tab }];
  const last = series.lastDecision ? ` ${ctx.t("roundsLast", { n: series.lastDecision.n, text: decisionText(ctx, series.lastDecision) })}` : "";
  out.push({ type: "markdown", tab, text: running ? `**${ctx.t("roundsRunning", { n: cur?.round?.n ?? series.n, minutes: series.minutes })}** ${cur?.endsAt ? ctx.t("roundsEnds", { time: stamp(ctx, cur.endsAt, tzOf(ctx)), voters: Number(cur.voters) || 0 }) : ""}${last}` : `**${ctx.t("roundsIdle")}**${last}` });
  if (b !== null) out.push({ type: "copy", label: ctx.t("roundsLink"), text: `${ctx.api.siteUrl}${b}/now`, tab });
  if (manage) {
    if (!running) out.push({ type: "adminForm", action: "roundStart", submitLabel: ctx.t("roundsStart"), fields: [], tab });
    else out.push(
      { type: "adminForm", action: "roundNext", submitLabel: ctx.t("roundsNext"), fields: [], tab },
      { type: "adminForm", action: "roundStop", submitLabel: ctx.t("roundsStop"), fields: [{ name: "confirm", kind: "checkbox", label: ctx.t("confirmStop"), required: true }], tab },
    );
    out.push({ type: "adminForm", action: "roundConfig", title: ctx.t("roundsConfig"), submitLabel: ctx.t("save"), tab,
      fields: [
        { name: "question", label: ctx.t("fRoundQuestion"), kind: "text", required: true, value: series.question, help: ctx.t("fRoundQuestionHelp") },
        { name: "choices", label: ctx.t("fChoices"), kind: "textarea", required: true, value: series.choices.join("\n"), help: ctx.t("fChoicesHelp") },
        { name: "minutes", label: ctx.t("fRoundMinutes"), kind: "number", value: String(series.minutes), help: ctx.t("fRoundMinutesHelp") },
      ] });
    out.push({ type: "adminForm", action: "quick", title: ctx.t("quickTitle"), submitLabel: ctx.t("quickGo"), fields: quickFields(ctx), tab });
  }
  const present = await B.present(ctx);
  if (present) {
    const provider = (await ctx.api.services.providers(B.SERVICE).catch(() => []))[0];
    const mine = provider ? (await ctx.api.instances.list().catch(() => [])).find((i) => i.key === provider.key) : null;
    out.push({ type: "markdown", tab, text: mine?.adminPath ? ctx.t("audienceOn", { href: mine.adminPath }) : ctx.t("audienceOnPlain") });
  } else out.push({ type: "markdown", text: ctx.t("audienceOff"), tab }, { type: "suggestInstall", service: B.SERVICE, reason: ctx.t("suggestReason"), tab });
  const hist = (await ctx.api.store.page(ROUNDS, { limit: 10 })).items;
  out.push({ type: "heading", text: ctx.t("historyTitle"), tab });
  out.push(hist.length
    ? { type: "table", tab, columns: [ctx.t("colRound"), ctx.t("colDecision"), ctx.t("colVoters"), ctx.t("colWhen")], rows: hist.map((r) => [String(r.data.n), decisionText(ctx, r.data), String(r.data.voters), stamp(ctx, r.data.decidedAt, tzOf(ctx))]) }
    : { type: "markdown", text: ctx.t("historyEmpty"), tab });
  if (hist.length && manage) out.push({ type: "download", name: "rounds", label: ctx.t("downloadRounds"), tab });
  return out;
}

/* ───────────── Le module ───────────── */

/* ───────────── La télécommande : ce que Sondages montre à Participation (service « audience.remote ») ───────────── */

const remoteReply = (ctx, r, okKey) => {
  if (r.ok) return { ok: true, message: ctx.t(okKey) };
  if (r.errors) { const field = Object.keys(r.errors)[0]; return { ok: false, error: "invalid", field, message: ctx.t(`err_${r.errors[field]}`) }; }
  return { ok: false, error: r.error === "idle" || r.error === "already" ? r.error : "failed", message: ctx.t(r.error === "already" ? "remoteErrAlready" : r.error === "idle" ? "remoteErrIdle" : r.error === "full" ? "errFullShort" : "remoteErrFailed") };
};

async function remotePanel(ctx, now) {
  await advance(ctx, now);
  const series = await ensureSeries(ctx);
  const running = series.status === "running";
  const cur = running ? await bySlug(ctx, series.current) : null;
  const last = series.lastDecision ? ` ${ctx.t("remoteLast", { n: series.lastDecision.n, winner: series.lastDecision.winner ?? ctx.t("noWinnerShort") })}` : "";
  const state = running
    ? { text: `${ctx.t("remoteRunning", { n: cur?.round?.n ?? series.n, voters: Number(cur?.voters) || 0 })}${last}`, tone: "live", until: cur?.endsAt ?? null }
    : { text: `${ctx.t("remoteIdle")}${last}`, tone: "idle" };
  return {
    title: ctx.t("remoteTitle"), state,
    buttons: [
      { id: "start", label: ctx.t("remoteStart"), tone: "primary", disabled: running },
      { id: "next", label: ctx.t("remoteNext"), disabled: !running },
      { id: "stop", label: ctx.t("remoteStop"), tone: "danger", confirm: ctx.t("remoteStopConfirm"), disabled: !running },
    ],
    forms: [{ id: "quick", title: ctx.t("quickTitle"), submit: ctx.t("quickGo"), fields: [
      { name: "a", label: ctx.t("fQuickAShort"), type: "text", required: true, max: LIMITS.choice },
      { name: "b", label: ctx.t("fQuickBShort"), type: "text", required: true, max: LIMITS.choice },
      { name: "c", label: ctx.t("fQuickCShort"), type: "text", max: LIMITS.choice },
      { name: "d", label: ctx.t("fQuickDShort"), type: "text", max: LIMITS.choice },
      { name: "seconds", label: ctx.t("fQuickSeconds"), type: "select", value: String(quickDefault(ctx)), options: L.ROUND.quickSeconds.map((n) => ({ value: String(n), label: ctx.t(SEC_LABELS[n]) })) },
    ] }],
  };
}

export default {
  /**
   * Éléments des pages d'overlay (cœur 0.5.0) : l'adresse de l'élément est celle de l'overlay actuel (même rendu, aucune copie), avec le code secret ajouté ICI, côté serveur.
   * Le cœur y ajoute ov-* (taille, style commun) et opt-poll (« Quel sondage ») ; la page les lit. Chaque lecteur lit l'état tout seul, sans rien consommer : plusieurs pages peuvent l'afficher.
   */
  overlayElements: {
    poll: async (ctx, request) => {
      const cfg = await ensureCfg(ctx);
      const lang = typeof request?.lang === "string" && /^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(request.lang) ? `&lang=${request.lang}` : "";
      return { url: `/overlays/${ctx.instance.key}?k=${encodeURIComponent(cfg.obsKey)}${lang}` };
    },
  },

  services: {
    "audience.remote": {
      describe: async (ctx) => ({ ok: true, panel: await remotePanel(ctx, Date.now()) }),
      // La télécommande a déjà vérifié l'adresse secrète : aucun droit d'administration ne passe par ici (voir README).
      press: async (ctx, a) => {
        const now = Date.now(), values = a?.values && typeof a.values === "object" ? a.values : {};
        switch (a?.action) {
          case "start": return remoteReply(ctx, await startSeries(ctx, now), "remoteStarted");
          case "next": return remoteReply(ctx, await nextRound(ctx, now), "remoteNexted");
          case "stop": { const r = await stopSeries(ctx, now); return remoteReply(ctx, r, r.cancelled ? "remoteStoppedCancelled" : "remoteStopped"); }
          case "quick": return remoteReply(ctx, await quickPoll(ctx, values, now), "remoteQuickOk");
          default: return { ok: false, error: "invalid", message: ctx.t("remoteErrFailed") };
        }
      },
      // « Ton direct est périmé » : le premier lecteur après la fin d'une manche fait avancer la série et republier l'état.
      tick: async (ctx, a) => {
        if (a?.room !== B.roomOf(ctx)) return { ok: true, handled: false };
        await advance(ctx, Date.now());
        await syncLive(ctx);
        return { ok: true, handled: true };
      },
    },
  },

  slots: {
    // Le petit script du sondage n'est demandé que si le site a des sondages ; il ne fait rien sur une page sans sondage.
    "layout.head": async (ctx) => ((await ctx.api.store.count(POLLS)) > 0 ? [{ type: "head", tags: [{ tag: "script", src: `/m/${ctx.instance.key}/client?v=${C.CLIENT_REV}`, defer: true }] }] : null),
  },

  sections: {
    current: async (ctx) => {
      const open = (await livePolls(ctx)).filter((p) => L.stateOf(p) === "open").sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      const p = open[0];
      if (!p) return null;
      const all = baseOf(ctx);
      return [{ type: "html", html: pollHtml(ctx, p, { title: "h3", link: pollHref(ctx, p.slug) ? loc(ctx, pollHref(ctx, p.slug)) : null }) + (all === null ? "" : `<p style="text-align:center"><a href="${esc(loc(ctx, all || "/"))}">${esc(ctx.t("allPolls"))}</a></p>`) }];
    },
  },

  news: async (ctx) => {
    const since = ctx.visit?.lastVisit?.getTime?.() ?? 0;
    if (since <= 0) return false;   // visiteur inconnu : rien n'est « nouveau » pour lui
    return (await ctx.api.store.list(POLLS, { limit: 20 })).some((r) => !r.data.round && L.stateOf(r.data) === "open" && Date.parse(r.data.createdAt ?? "") > since);
  },

  async page(ctx, { segments }) {
    const title = ctx.t("pageTitle");
    if (segments.length === 0 || (segments.length === 2 && segments[0] === "page")) {
      const n = segments.length === 0 ? 1 : Number(segments[1]);
      if (!Number.isInteger(n) || n < 1) return { notFound: true, blocks: [] };
      const now = Date.now();
      const open = n === 1 ? (await livePolls(ctx)).filter((p) => listed(p) && L.stateOf(p, now) === "open").sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))) : [];
      const past = await pastPage(ctx, n, now);
      if (n > past.pages) return { notFound: true, blocks: [] };
      const blocks = [];
      const intro = String(ctx.setting("intro") ?? "").trim();
      if (n === 1 && intro) blocks.push({ type: "markdown", text: intro });
      let html = `<style>${CSS}</style>`;
      if (open.length) html += `<h2 class="vp-h">${esc(ctx.t("openPolls"))}</h2><ul class="vp-list">${open.map((p) => listItem(ctx, p)).join("")}</ul>`;
      html += `<h2 class="vp-h">${esc(ctx.t("pastPolls"))}</h2>`;
      html += past.items.length ? `<ul class="vp-list">${past.items.map((p) => listItem(ctx, p)).join("")}</ul>${pager(ctx, n, past.pages)}` : `<p class="vp-hint">${esc(ctx.t(open.length ? "noPast" : "noPolls"))}</p>`;
      blocks.push({ type: "html", html });
      return { title, description: ctx.t("pageDescription"), blocks };
    }
    if (segments.length === 1 && segments[0] === "now") return nowPage(ctx);
    if (segments[0] === "decisions" && (segments.length === 1 || (segments.length === 3 && segments[1] === "page"))) return decisionsPage(ctx, segments.length === 1 ? 1 : Number(segments[2]));
    if (segments.length === 1) {
      const p = await findPoll(ctx, segments[0]);
      if (!p) {
        const done = await byKey(ctx, ROUNDS, clean(segments[0], 80).toLowerCase(), "k");   // une manche déjà décidée : son lien montre la décision
        return done ? decisionPage(ctx, done.data) : gonePage(ctx, segments[0]);
      }
      const href = pollHref(ctx, p.slug);
      const blocks = [{ type: "html", html: pollHtml(ctx, p, { title: null }) }];
      if (L.stateOf(p) === "open" && href) blocks.push({ type: "copy", label: ctx.t("shareLabel"), text: `${ctx.api.siteUrl}${href}` });
      blocks.push({ type: "links", items: [{ label: ctx.t("allPolls"), href: baseOf(ctx) || "/" }] });
      return { title: p.question, description: ctx.t("pollDescription"), blocks };
    }
    return { notFound: true, blocks: [] };
  },

  routes: {
    // Le petit script des visiteurs (même contenu pour tous, mis en cache).
    async client(request, ctx) {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
      // Avec Participation, la bibliothèque du direct (mise à jour douce) est livrée devant : la page « en cours » se met alors à jour toute seule.
      const lib = (await B.present(ctx)) ? await B.audience(ctx, "directClient", {}) : null;
      const body = `${lib?.ok && typeof lib.js === "string" ? `${lib.js}\n` : ""}${C.CLIENT_JS}`;
      return new Response(body, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=300", "x-content-type-options": "nosniff" } });
    },

    async vote(request, ctx) {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
      const raw = await request.text();
      if (raw.length > 2000) return json({ ok: false, reason: "invalid" }, 413);
      let body; try { body = JSON.parse(raw); } catch { return json({ ok: false, reason: "invalid" }, 400); }
      if (!body || typeof body !== "object") return json({ ok: false, reason: "invalid" }, 400);
      if (String(body.website ?? "")) return json({ ok: true, html: "" });                    // piège à robots : on fait semblant, rien n'est enregistré
      const now = Date.now();
      const slug = clean(body.poll, 80).toLowerCase();
      if (over(`g|${ctx.instance.key}`, 120, 60_000, now)) return json({ ok: false, reason: "limit" }, 429, { "retry-after": "60" });
      if (!TOKEN_RE.test(String(body.t ?? ""))) return json({ ok: false, reason: "invalid" }, 400);
      const token = String(body.t);
      const gate = await voteGate(ctx, request, { slug, token, now });
      if (gate.refuse) return json({ ok: false, reason: gate.refuse }, gate.status, gate.status === 429 ? { "retry-after": String(gate.retryAfter ?? 60) } : {});
      // Une voix par personne : confiée à Participation s'il est là (en plus du bulletin unique, qui reste la dernière garantie).
      const known = await findPoll(ctx, slug);
      const claimKey = gate.audience && known && !known.archived && L.stateOf(known, now) === "open" ? `v-${known.id}` : null;
      if (claimKey) {
        const c = await B.audience(ctx, "claim", { room: B.roomOf(ctx), token, key: claimKey });
        if (c && !c.ok) return json({ ok: false, reason: B.reasonOf(c.error) }, c.error === "already" ? 409 : c.error === "muted" ? 403 : 400);
      }
      const r = await castVote(ctx, { slug, token, ids: Array.isArray(body.c) ? body.c.slice(0, LIMITS.maxChoices + 1).map(String) : null, now });
      if (!r.ok) {
        if (claimKey && r.error !== "already") await B.audience(ctx, "release", { room: B.roomOf(ctx), token, key: claimKey });
        return json({ ok: false, reason: r.error }, r.error === "closed" || r.error === "already" ? 409 : r.error === "gone" ? 404 : r.error === "full" ? 503 : r.error === "busy" ? 503 : 400);
      }
      sweep(ctx, now).catch(() => {});
      await syncLive(ctx);
      return json({ ok: true, html: resultsHtml(ctx, r.poll, r.picked), mine: r.picked });
    },

    // « Où en est le sondage, et ai-je déjà voté ? » — lecture seule, avec le code anonyme du navigateur.
    async results(request, ctx) {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
      const raw = await request.text();
      if (raw.length > 1000) return json({ ok: false, reason: "invalid" }, 413);
      let body; try { body = JSON.parse(raw); } catch { return json({ ok: false, reason: "invalid" }, 400); }
      const now = Date.now();
      if (over(`r|${ctx.instance.key}|${fingerprint(request, now)}`, 120, HOUR, now)) return json({ ok: false, reason: "limit" }, 429, { "retry-after": "60" });
      const p = await findPoll(ctx, body?.poll);
      if (!p) return json({ ok: false, reason: "gone" }, 404);
      const ballot = await myBallot(ctx, p, body?.t);
      const closed = L.stateOf(p, now) === "closed";
      if (!ballot && !closed) return json({ ok: false, reason: "none" });          // pas voté : le formulaire reste (et rien n'est montré si le sondage cache ses résultats)
      return json({ ok: true, html: resultsHtml(ctx, p, ballot?.data?.c ?? []), voted: !!ballot, mine: ballot?.data?.c ?? [] });
    },

    // Les chiffres pour la source navigateur OBS. Adresse secrète obligatoire ; sans elle, la route fait comme si elle n'existait pas.
    async live(request, ctx) {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
      const url = new URL(request.url);
      const cfg = await getCfg(ctx);
      if (!cfg || !sameSecret(url.searchParams.get("k"), cfg.obsKey)) return new Response("Not found", { status: 404 });
      if (over(`l|${ctx.instance.key}`, 120, 60_000)) return json({ ok: false }, 429, { "retry-after": "30" });
      const now = Date.now();
      await advance(ctx, now);
      const data = liveData(await onAirPoll(ctx, cfg, url.searchParams, now), now, await getSeries(ctx), winnerSeconds(ctx));
      if (url.searchParams.get("rev") === data.rev) return json({ unchanged: true, rev: data.rev, state: data.state ?? "open" });
      return json(data);
    },
  },

  async overlay(ctx, { query }) {
    const cfg = await getCfg(ctx);
    if (!cfg || !sameSecret(query.get("k"), cfg.obsKey)) return query.has("ov-fit") ? { title: ctx.instance.name, html: "" } : { title: ctx.instance.name, html: `<p style="margin:24px;padding:16px 20px;max-width:560px;border-radius:12px;background:#222;color:#fff;font:18px/1.4 system-ui,sans-serif">${esc(ctx.t("obsIncomplete"))}</p>` };   // sans le code secret : un simple message, aucun résultat
    const seconds = num(ctx.setting("obsRefreshSeconds"), 5, 3, 30);
    // Élément d'une page d'overlay (le cœur ajoute ov-* et opt-*) : même rendu, mais il remplit le cadre reçu, suit le style commun et ignore la place choisie pour l'overlay du module.
    const el = query.has("ov-fit"), demo = el && query.get("ov-demo") === "1";
    const want = el && !demo ? clean(query.get("opt-poll"), 100) : "";
    const own = `/m/${ctx.instance.key}/live?k=${encodeURIComponent(query.get("k"))}${query.get("poll") ? `&poll=${encodeURIComponent(query.get("poll"))}` : ""}${want ? `&want=${encodeURIComponent(want)}` : ""}`;
    // Avec Participation, l'écran lit le point de direct (léger, partagé, qui ralentit tout seul) ; sans lui, ou pour un sondage choisi dans l'adresse, la route du module.
    let direct = null;
    if (!query.get("poll") && !want && !demo && (await B.present(ctx))) {
      const info = await B.audience(ctx, "info", {});
      if (info?.ok && typeof info.base === "string") { await advance(ctx); await syncLive(ctx); direct = `${info.base}/direct?room=${encodeURIComponent(B.roomOf(ctx))}&channel=screen&k=${encodeURIComponent(query.get("k"))}`; }
    }
    const color = (v, d) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : d);
    const pos = ["left", "right", "center"].includes(ctx.setting("obsPosition")) ? ctx.setting("obsPosition") : "left";
    const cfgJs = JSON.stringify({
      url: direct ?? own, alt: direct ? own : null,
      base: seconds * 1000, max: 30000, lang: ctx.locale,
      t: { live: ctx.t("obsLive"), final: ctx.t("obsFinal"), one: ctx.t("voice_one", { n: "" }).trim(), many: ctx.t("voice_many", { n: "" }).trim(), lead: ctx.t("leading"), person: ctx.t("person_one"), people: ctx.t("person_many"), ends: ctx.t("obsEnds"),
        round: ctx.t("obsRound"), decided: ctx.t("obsDecided"), nodecision: ctx.t("obsNoDecision"), tie: ctx.t("obsTie"), quick: ctx.t("obsQuick") },
      ...(el ? { el: true, ...(demo ? { demo: demoScreen(ctx) } : {}) } : {}),
    }).replace(/</g, "\\u003c");
    const accent = color(ctx.setting("obsAccent"), ctx.theme.accent), fg = color(ctx.setting("obsText"), ctx.theme.fg), card = color(ctx.setting("obsCard"), ctx.theme.surface);
    if (el) return { title: ctx.instance.name, html: `<div id="vo-box" role="status" aria-live="polite" data-ov-region="element"></div>`, css: elementCss(query, { accent, fg, card }), script: `window.__VO=${cfgJs};${C.OVERLAY_JS}` };
    return {
      title: ctx.instance.name,
      html: `<div id="vo-box" role="status" aria-live="polite"></div>`,
      css: `html,body{margin:0;background:transparent;overflow:hidden;font-family:${ctx.theme.font || "system-ui,sans-serif"}}
#vo-box{position:fixed;${pos === "center" ? "left:50%;transform:translateX(-50%)" : `${pos}:32px`};bottom:32px;width:min(640px,calc(100vw - 64px))}
.vo-card{background:${card};color:${fg};border-radius:20px;padding:22px 26px;box-shadow:0 8px 32px rgba(0,0,0,.45);animation:vo-in .4s ease-out}
.vo-state{margin:0 0 6px;font-size:18px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:${accent}}
.vo-q{margin:0 0 16px;font-size:30px;line-height:1.2;overflow-wrap:anywhere}.vo-list{list-style:none;margin:0;padding:0;display:grid;gap:14px}
.vo-line{display:flex;justify-content:space-between;gap:12px;font-size:22px}.vo-label{font-weight:600;overflow-wrap:anywhere}.vo-num{white-space:nowrap}
.vo-track{height:18px;border-radius:9px;background:rgba(127,127,127,.35);border:2px solid ${fg};overflow:hidden;margin-top:6px}
.vo-fill{height:100%;background:${accent};transition:width .6s}.vo-row.lead .vo-fill{background-image:repeating-linear-gradient(135deg,transparent 0 7px,rgba(0,0,0,.3) 7px 11px)}
.vo-tag{display:inline-block;margin-top:4px;font-size:16px;font-weight:700;border:2px solid ${fg};border-radius:999px;padding:0 10px}
.vo-foot{margin:16px 0 0;font-size:18px;opacity:.85}
.vo-clock{font-variant-numeric:tabular-nums;font-weight:700;margin-left:8px}
.vo-decision{margin:0 0 16px;padding:14px 18px;border:3px solid ${accent};border-radius:14px;animation:vo-in .4s ease-out}
.vo-dtitle{margin:0;font-size:18px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:${accent}}.vo-dwin{margin:4px 0 0;font-size:34px;font-weight:800;line-height:1.15;overflow-wrap:anywhere}.vo-dtie{margin:6px 0 0;font-size:18px}
@keyframes vo-in{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.vo-card{animation:none}.vo-fill{transition:none}}`,
      script: `window.__VO=${cfgJs};${C.OVERLAY_JS}`,
    };
  },

  async adminPanel(ctx, { query }) {
    const now = Date.now();
    await sweep(ctx, now).catch(() => {});
    const cfg = await ensureCfg(ctx);
    const tz = tzOf(ctx);
    const manage = can(ctx, "manage");
    const blocks = [];
    const screen = [];

    // ── Onglet « En direct » : les manches, le sondage rapide, puis la source navigateur OBS ──
    screen.push(...(await roundsBlocks(ctx, manage, now)));
    screen.push({ type: "heading", text: ctx.t("obsTitle"), tab: "screen" });
    if (can(ctx, "obs.view")) {
      const addr = `${ctx.api.siteUrl}/overlays/${ctx.instance.key}?k=${cfg.obsKey}`;
      const onAir = cfg.onAir ? await findPoll(ctx, cfg.onAir) : null;
      screen.push(
        { type: "markdown", text: ctx.t("obsHelp"), tab: "screen" },
        { type: "copy", label: ctx.t("obsAddress"), text: addr, tab: "screen" },
        { type: "markdown", text: ctx.t("obsSecret"), tab: "screen" },
        { type: "markdown", text: onAir ? ctx.t("obsOnAir", { question: onAir.question }) : ctx.t("obsAuto"), tab: "screen" },
      );
      if (manage) screen.push(
        ...(cfg.onAir ? [{ type: "adminForm", action: "screenAuto", submitLabel: ctx.t("obsAutoBtn"), fields: [], tab: "screen" }] : []),
        { type: "adminForm", action: "regenerate", title: ctx.t("obsRegenTitle"), submitLabel: ctx.t("obsRegenBtn"), fields: [{ name: "confirm", kind: "checkbox", label: ctx.t("obsRegenConfirm"), help: ctx.t("obsRegenHelp") }], tab: "screen" },
      );
    } else screen.push({ type: "markdown", text: ctx.t("obsNoRight"), tab: "screen" });

    // ── Modifier un sondage ──
    if (query?.edit) {
      const p = await findById(ctx, String(query.edit));
      if (!p) return [{ type: "banner", tone: "warning", text: ctx.t("errGone") }, { type: "markdown", text: `[${ctx.t("back")}](?)` }];
      const w = p.endsAt ? L.wallParts(p.endsAt, p.tz || tz) : { date: "", time: "" };
      const locked = (Number(p.voters) || 0) > 0;
      return [
        { type: "heading", text: ctx.t("editTitle") },
        { type: "markdown", text: `[${ctx.t("back")}](?poll=${encodeURIComponent(p.id)})` },
        ...(locked ? [{ type: "markdown", text: ctx.t("choicesLocked", { n: Number(p.voters) || 0 }) }] : []),
        { type: "adminForm", action: "update", submitLabel: ctx.t("save"), cancelHref: `?poll=${encodeURIComponent(p.id)}`,
          fields: [{ name: "id", kind: "hidden", value: p.id }, ...pollFields(ctx, { question: p.question, choices: p.choices.map((c) => c.text).join("\n"), max: p.max, resultsMode: p.resultsMode, endDate: w.date, endTime: w.time }, { withChoices: !locked })] },
        ...screen,
      ];
    }

    // ── Supprimer un sondage : page de confirmation (ce qui sera perdu, dit en clair) ──
    if (query?.delete) {
      const p = await findById(ctx, String(query.delete));
      if (!p) return [{ type: "banner", tone: "warning", text: ctx.t("errGone") }, { type: "markdown", text: `[${ctx.t("back")}](?)` }];
      const open = L.stateOf(p, now) === "open";
      const n = Number(p.voters) || 0;
      const series = await getSeries(ctx);
      const isRound = series?.status === "running" && series.current === p.slug;
      const detail = `?poll=${encodeURIComponent(p.id)}`;
      const lost = (what) => ctx.t(`${what}_${n === 0 ? "zero" : n === 1 ? "one" : "many"}`, { n });
      const out = [{ type: "markdown", text: `[${ctx.t("back")}](${detail})` }, { type: "heading", text: ctx.t("deleteTitle", { question: p.question }) },
        { type: "markdown", text: `**${ctx.t(open ? "stateOpen" : p.archived ? "stateArchived" : "stateClosed")}** · ${votersText(ctx, n)}` }];
      if (!manage) return [...out, { type: "markdown", text: ctx.t("errRight") }];
      if (isRound) return [...out, { type: "banner", tone: "warning", text: ctx.t("deleteRound") }];
      if (open) out.push(
        { type: "banner", tone: "warning", text: lost("deleteOpenWarn") },
        { type: "markdown", text: ctx.t("deleteInstead") },
        { type: "adminForm", action: "close", submitLabel: ctx.t("actClose"), fields: [{ name: "id", kind: "hidden", value: p.id }, { name: "confirm", kind: "checkbox", label: ctx.t("confirmClose"), required: true }] },
      );
      out.push(
        { type: "markdown", text: lost("deleteLost") },
        { type: "adminForm", action: "remove", title: ctx.t("dangerTitle"), submitLabel: ctx.t("deleteBtn"), cancelHref: detail,
          fields: [{ name: "id", kind: "hidden", value: p.id }, ...(open ? [{ name: "confirmOpen", kind: "checkbox", label: ctx.t("confirmDeleteOpen"), required: true }] : []), { name: "confirm", kind: "checkbox", label: ctx.t("confirmDelete"), required: true }] },
      );
      return out;
    }

    // ── Détails d'un sondage ──
    if (query?.poll) {
      const p = await findById(ctx, String(query.poll));
      if (!p) return [{ type: "banner", tone: "warning", text: ctx.t("errGone") }, { type: "markdown", text: `[${ctx.t("back")}](?)` }];
      const state = L.stateOf(p, now);
      const href = pollHref(ctx, p.slug);
      const rows = L.rows(p);
      const zone = p.tz || tz;
      const id = { name: "id", kind: "hidden", value: p.id };
      const sure = (label) => ({ name: "confirm", kind: "checkbox", label, required: true });
      const act = (action, submitLabel, title, extra = []) => ({ type: "adminForm", action, title, submitLabel, fields: [id, ...extra] });
      const del = { type: "markdown", text: `**[${ctx.t("actDelete")}](?delete=${encodeURIComponent(p.id)})**` };   // mène à la page de confirmation : rien ne part d'un seul clic
      const actions = !manage ? [] : p.archived ? [del] : [
        { type: "markdown", text: `[${ctx.t("actEdit")}](?edit=${encodeURIComponent(p.id)}) · [${ctx.t("actCopy")}](?copy=${encodeURIComponent(p.id)})` },
        act("onAir", ctx.t("actOnAir"), null),
        ...(state === "open" ? [act("close", ctx.t("actClose"), null, [sure(ctx.t("confirmClose"))])]
          : [act("reopen", ctx.t("actReopen"), null, [sure(ctx.t("confirmReopen"))]), act("archive", ctx.t("actArchive"), null, [sure(ctx.t("confirmArchive"))])]),
        ...(p.purgedAt ? [] : [act("recount", ctx.t("actRecount"), null)]),
        del,
      ];
      return [
        { type: "markdown", text: `[${ctx.t("back")}](?)` },
        { type: "heading", text: p.question },
        { type: "markdown", text: [
          `**${ctx.t(state === "open" ? "stateOpen" : p.archived ? "stateArchived" : "stateClosed")}** · ${votersText(ctx, Number(p.voters) || 0)}`,
          p.endsAt ? ctx.t(state === "open" ? "endsOn" : "endedOn", { date: L.formatEnd(p.endsAt, zone, ctx.locale) }) : ctx.t("noEnd"),
          ctx.t("detailRules", { max: Math.min(p.max || 1, p.choices.length), mode: ctx.t(p.resultsMode === "after" ? "resAfter" : "resAlways") }),
          p.purgedAt ? ctx.t("ballotsGone") : ctx.t("ballotsKept", { days: num(ctx.setting("retentionDays"), 30, 1, 90) }),
        ].join("\n\n") },
        ...(href ? [{ type: "copy", label: ctx.t("publicLink"), text: `${ctx.api.siteUrl}${href}` }] : [{ type: "markdown", text: ctx.t("noPage") }]),
        { type: "table", columns: [ctx.t("colChoice"), ctx.t("colVoices"), ctx.t("colPct")], rows: rows.map((r) => [`${r.text}${r.lead ? ` — ${ctx.t(state === "open" ? "leading" : "winner")}` : ""}`, String(r.count), `${r.pct} %`]) },
        ...actions,
        ...screen,
      ];
    }

    // ── Liste ──
    const cursor = typeof query?.c === "string" && query.c.length < 400 ? query.c : null;
    const page = await ctx.api.store.page(POLLS, { limit: PAGE, cursor });
    const polls = page.items.map((r) => pollOf(r));
    const copy = query?.copy ? await findById(ctx, String(query.copy)) : null;
    const open = polls.filter((p) => L.stateOf(p, now) === "open").length;
    blocks.push({ type: "heading", text: ctx.t("adminTitle") });
    if (!polls.length && !cursor) blocks.push({ type: "markdown", text: ctx.t("adminEmpty") });
    if (manage) blocks.push({
      type: "adminForm", action: "create", title: ctx.t("newPoll"), submitLabel: ctx.t("create"),
      fields: pollFields(ctx, copy ? { question: copy.question, choices: copy.choices.map((c) => c.text).join("\n"), max: copy.max, resultsMode: copy.resultsMode } : {}),
    });
    if (polls.length) {
      blocks.push({ type: "heading", text: ctx.t("listTitle", { n: await ctx.api.store.count(POLLS), open }) });
      blocks.push({ type: "markdown", text: polls.map((p) => `- [${p.question.replace(/[\[\]\\]/g, "")}](?poll=${encodeURIComponent(p.id)}) — ${ctx.t(L.stateOf(p, now) === "open" ? "stateOpen" : "stateClosed")} · ${votersText(ctx, Number(p.voters) || 0)}${p.endsAt ? ` · ${stamp(ctx, p.endsAt, p.tz || tz)}` : ""}${manage ? ` · [${ctx.t("actDelete")}](?delete=${encodeURIComponent(p.id)})` : ""}`).join("\n") });
      if (page.next) blocks.push({ type: "markdown", text: `[${ctx.t("nextPage")}](?c=${encodeURIComponent(page.next)})` });
    }
    // Les sondages archivés (totaux seulement) se voient et se suppriment aussi : 50 par page.
    const archived = await ctx.api.store.count(ARCHIVE);
    if (archived) {
      blocks.push({ type: "markdown", text: ctx.t("archivedCount", { n: archived }) });
      const ac = typeof query?.ac === "string" && query.ac.length < 400 ? query.ac : null;
      const arch = await ctx.api.store.page(ARCHIVE, { limit: PAGE, cursor: ac });
      blocks.push({ type: "markdown", text: arch.items.map((r) => pollOf(r, "archive")).map((p) => `- [${p.question.replace(/[\[\]\\]/g, "")}](?poll=${encodeURIComponent(p.id)}) — ${votersText(ctx, Number(p.voters) || 0)}${manage ? ` · [${ctx.t("actDelete")}](?delete=${encodeURIComponent(p.id)})` : ""}`).join("\n") });
      if (arch.next) blocks.push({ type: "markdown", text: `[${ctx.t("nextPage")}](?ac=${encodeURIComponent(arch.next)})` });
    }
    blocks.push({ type: "heading", text: ctx.t("limitsTitle") }, { type: "markdown", text: ctx.t("limitsText") });
    if (polls.length && manage) blocks.push({ type: "download", name: "results", label: ctx.t("downloadResults") });
    return [...blocks, ...screen];
  },

  adminActions: {
    create: needs("manage", async (ctx, values) => {
      const tz = tzOf(ctx);
      const v = L.validatePollForm(values, { tz });
      if (Object.keys(v.errors).length) return { errors: fieldErrors(ctx, v.errors) };
      const r = await createPoll(ctx, v.value, tz);
      if (!r.ok) return { error: ctx.t("errFull", { n: LIMITS.livePolls }) };
      return { ok: ctx.t("okCreated"), redirect: `?poll=${encodeURIComponent(r.id)}` };
    }),

    update: needs("manage", async (ctx, values) => {
      const p = await findById(ctx, values.id);
      if (!p) return { error: ctx.t("errGone") };
      const tz = p.tz || tzOf(ctx);
      const locked = (Number(p.voters) || 0) > 0;
      const v = L.validatePollForm(values, { tz, keepChoices: locked ? p.choices.map((c) => c.text) : null });
      // Une fin déjà passée n'est pas une erreur quand on ne change pas la date : on garde l'ancienne.
      if (v.errors.endDate === "end_past" && p.endsAt && L.wallParts(p.endsAt, tz).date === String(values.endDate ?? "").trim() && L.wallParts(p.endsAt, tz).time === String(values.endTime ?? "").trim()) { delete v.errors.endDate; v.value.endsAt = p.endsAt; }
      if (Object.keys(v.errors).length) return { errors: fieldErrors(ctx, v.errors) };
      await withLock(ctx, async () => {
        const f = await ctx.api.store.get(p.id);
        if (!f) return;
        const choices = locked ? f.data.choices : v.value.choices.map((text, i) => ({ id: `c${i + 1}`, text }));
        await ctx.api.store.update(p.id, { ...f.data, question: v.value.question, choices, max: v.value.max, resultsMode: v.value.resultsMode, endsAt: v.value.endsAt, tz, rev: (Number(f.data.rev) || 0) + 1 });
      });
      return { ok: ctx.t("okSaved"), redirect: `?poll=${encodeURIComponent(p.id)}` };
    }),

    close: needs("manage", async (ctx, values) => {
      if (values.confirm !== "on") return { errors: { confirm: ctx.t("errConfirm") } };
      const r = await closeNow(ctx, values.id);
      return r.ok ? { ok: ctx.t("okClosed") } : { error: ctx.t(r.error === "already" ? "errAlreadyClosed" : "errGone") };
    }),

    reopen: needs("manage", async (ctx, values) => {
      if (values.confirm !== "on") return { errors: { confirm: ctx.t("errConfirm") } };
      const p = await findById(ctx, values.id);
      if (!p) return { error: ctx.t("errGone") };
      if (p.purgedAt) return { error: ctx.t("errPurged") };
      await withLock(ctx, async () => { const f = await ctx.api.store.get(p.id); await ctx.api.store.update(p.id, { ...f.data, closedAt: null, endsAt: null, rev: (Number(f.data.rev) || 0) + 1 }); });
      return { ok: ctx.t("okReopened") };
    }),

    archive: needs("manage", async (ctx, values) => {
      if (values.confirm !== "on") return { errors: { confirm: ctx.t("errConfirm") } };
      const p = await findById(ctx, values.id);
      if (!p) return { error: ctx.t("errGone") };
      if (L.stateOf(p) !== "closed") return { error: ctx.t("errNotClosed") };
      await withLock(ctx, () => archiveOne(ctx, p));
      return { ok: ctx.t("okArchived"), redirect: "?" };
    }),

    remove: needs("manage", async (ctx, values) => {
      if (values.confirm !== "on") return { errors: { confirm: ctx.t("errConfirmDelete") } };   // sans la case cochée, rien n'est lu ni supprimé
      const r = await deletePoll(ctx, values.id, { allowOpen: values.confirmOpen === "on" });   // le sondage, son état et ses votes sont relus côté serveur
      if (r.ok) return { ok: r.voters === 0 ? ctx.t("okDeleted") : r.voters === 1 ? ctx.t("okDeletedOne") : ctx.t("okDeletedMany", { n: r.voters }), redirect: "?" };
      if (r.error === "open") return { errors: { confirmOpen: ctx.t("errConfirmOpen") }, error: ctx.t("errConfirmOpenBanner") };
      return { error: ctx.t(r.error === "round" ? "deleteRound" : r.error === "partial" ? "errDeletePartial" : "errGone") };
    }),

    recount: needs("manage", async (ctx, values) => {
      const r = await recount(ctx, values.id);
      return r.ok ? { ok: ctx.t("okRecount", { n: r.voters }) } : { error: ctx.t(r.error === "purged" ? "errPurged" : "errGone") };
    }),

    onAir: needs("manage", async (ctx, values) => {
      const p = await findById(ctx, values.id);
      if (!p) return { error: ctx.t("errGone") };
      const cfg = await ensureCfg(ctx);
      await saveCfg(ctx, { ...cfg, onAir: p.slug });
      return { ok: ctx.t("okOnAir") };
    }),

    screenAuto: needs("manage", async (ctx) => {
      const cfg = await ensureCfg(ctx);
      await saveCfg(ctx, { ...cfg, onAir: null });
      return { ok: ctx.t("okAuto") };
    }),

    roundConfig: needs("manage", async (ctx, values) => {
      const v = L.validateSeriesForm(values);
      if (Object.keys(v.errors).length) return { errors: fieldErrors(ctx, v.errors) };
      await withLock(ctx, async () => { const series = await ensureSeries(ctx); await saveSeries(ctx, { ...series, ...v.value }); }, "series:");
      return { ok: ctx.t("okRoundConfig") };
    }),

    roundStart: needs("manage", async (ctx) => {
      const r = await startSeries(ctx);
      return r.ok ? { ok: ctx.t("remoteStarted") } : { error: ctx.t(r.error === "already" ? "remoteErrAlready" : "remoteErrFailed") };
    }),

    roundNext: needs("manage", async (ctx) => {
      const r = await nextRound(ctx);
      return r.ok ? { ok: ctx.t("remoteNexted") } : { error: ctx.t("remoteErrIdle") };
    }),

    roundStop: needs("manage", async (ctx, values) => {
      if (values.confirm !== "on") return { errors: { confirm: ctx.t("errConfirm") } };
      const r = await stopSeries(ctx);
      return r.ok ? { ok: ctx.t(r.cancelled ? "remoteStoppedCancelled" : "remoteStopped") } : { error: ctx.t("remoteErrIdle") };
    }),

    quick: needs("manage", async (ctx, values) => {
      const r = await quickPoll(ctx, values);
      if (r.errors) return { errors: fieldErrors(ctx, r.errors) };
      return r.ok ? { ok: ctx.t("remoteQuickOk") } : { error: ctx.t("errFullShort") };
    }),

    regenerate: needs("obs.view", async (ctx, values) => {
      if (values.confirm !== "on") return { errors: { confirm: ctx.t("errConfirm") } };
      const cfg = await ensureCfg(ctx);
      await saveCfg(ctx, { ...cfg, obsKey: randomBytes(18).toString("base64url") });
      await syncLive(ctx);   // l'ancienne adresse ne lit plus rien chez Participation non plus
      return { ok: ctx.t("okRegen") };
    }),
  },

  adminDownloads: {
    rounds: {
      right: "manage",
      contentType: "text/csv",
      filename: () => "decisions",
      async *generate(ctx) {
        const cell = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
        yield `\ufeff${["round", "question", "decided", "winner", "tie", "voters", "results"].map(cell).join(",")}\r\n`;
        let cursor = null;
        do {
          const page = await ctx.api.store.page(ROUNDS, { limit: 500, cursor, order: "asc" });
          for (const r of page.items) yield `${[r.data.n, r.data.question, r.data.decidedAt, r.data.winner ?? "", (r.data.tie ?? []).join(" | "), r.data.voters, r.data.choices.map((c) => `${c.text}: ${c.count}`).join(" | ")].map(cell).join(",")}\r\n`;
          cursor = page.next;
        } while (cursor);
      },
    },
    results: {
      right: "manage",
      contentType: "text/csv",
      filename: () => "polls",
      async *generate(ctx) {
        const cell = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
        yield `﻿${["id", "question", "state", "created", "ends", "voters", "results"].map(cell).join(",")}\r\n`;
        for (const col of [POLLS, ARCHIVE]) {
          let cursor = null;
          do {
            const page = await ctx.api.store.page(col, { limit: 500, cursor });
            for (const r of page.items) {
              const p = pollOf(r, col === ARCHIVE ? "archive" : "live");
              yield `${[p.slug, p.question, col === ARCHIVE ? "archived" : L.stateOf(p), p.createdAt, p.endsAt ?? "", p.voters ?? 0, L.rows(p).map((x) => `${x.text}: ${x.count}`).join(" | ")].map(cell).join(",")}\r\n`;
            }
            cursor = page.next;
          } while (cursor);
        }
      },
    },
  },

  mcp: {
    async polls_list(ctx, args) {
      const now = Date.now();
      const want = args?.state === "open" || args?.state === "closed" ? args.state : null;
      return (await livePolls(ctx)).filter((p) => !want || L.stateOf(p, now) === want).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, num(args?.limit, 20, 1, 100))
        .map((p) => ({ id: p.id, question: p.question, state: L.stateOf(p, now), voters: Number(p.voters) || 0, endsAt: p.endsAt ?? null, link: pollHref(ctx, p.slug) ? `${ctx.api.siteUrl}${pollHref(ctx, p.slug)}` : null }));
    },
    async poll_results(ctx, args) {
      const p = (await findById(ctx, args?.id)) ?? (await findPoll(ctx, args?.id));
      if (!p) throw Object.assign(new Error("poll not found"), { expose: true });
      return { id: p.id, question: p.question, state: L.stateOf(p), voters: Number(p.voters) || 0, maxChoices: p.max, endsAt: p.endsAt ?? null, results: L.rows(p).map((r) => ({ choice: r.text, votes: r.count, percent: r.pct })) };
    },
    async poll_create(ctx, args) {
      const tz = tzOf(ctx);
      const v = L.validatePollForm({ question: args?.question, choices: (Array.isArray(args?.choices) ? args.choices : []).join("\n"), max: args?.max ?? 1, resultsMode: args?.resultsMode }, { tz });
      if (Object.keys(v.errors).length) throw Object.assign(new Error(`invalid: ${Object.keys(v.errors).join(", ")} (question 1-${LIMITS.question} chars, ${LIMITS.minChoices}-${LIMITS.maxChoices} different choices, max between 1 and the number of choices)`), { expose: true });
      if (args?.endsAt !== undefined && args?.endsAt !== "") {
        const ms = Date.parse(String(args.endsAt));
        if (!Number.isFinite(ms) || ms <= Date.now() + 60_000 || ms - Date.now() > LIMITS.maxEndMs) throw Object.assign(new Error("endsAt must be a future date and time (ISO 8601, e.g. 2026-11-03T20:00:00+01:00), within a year"), { expose: true });
        v.value.endsAt = new Date(ms).toISOString();
      }
      const r = await createPoll(ctx, v.value, tz);
      if (!r.ok) throw Object.assign(new Error(`the site already keeps ${LIMITS.livePolls} polls and none is finished yet`), { expose: true });
      return { id: r.id, link: pollHref(ctx, r.slug) ? `${ctx.api.siteUrl}${pollHref(ctx, r.slug)}` : null };
    },
    async rounds_status(ctx) {
      const now = Date.now();
      await advance(ctx, now);
      const series = await ensureSeries(ctx);
      const cur = series.status === "running" ? await bySlug(ctx, series.current) : null;
      return {
        running: series.status === "running", question: series.question, choices: series.choices, minutes: series.minutes,
        round: cur ? { number: cur.round?.n ?? series.n, endsAt: cur.endsAt, voters: Number(cur.voters) || 0, results: L.rows(cur).map((r) => ({ choice: r.text, votes: r.count, percent: r.pct })) } : null,
        lastDecision: series.lastDecision ? { round: series.lastDecision.n, winner: series.lastDecision.winner, tie: series.lastDecision.tie, voters: series.lastDecision.voters, decidedAt: series.lastDecision.decidedAt } : null,
        link: baseOf(ctx) === null ? null : `${ctx.api.siteUrl}${baseOf(ctx)}/now`,
      };
    },
    async rounds_history(ctx, args) {
      return (await ctx.api.store.page(ROUNDS, { limit: num(args?.limit, 20, 1, 100) })).items.map((r) => ({ round: r.data.n, question: r.data.question, winner: r.data.winner, tie: r.data.tie, voters: r.data.voters, decidedAt: r.data.decidedAt, results: r.data.choices.map((c) => ({ choice: c.text, votes: c.count })) }));
    },
    async round_control(ctx, args) {
      const fail = (m) => Object.assign(new Error(m), { expose: true });
      if (args?.action === "start") {
        const r = await startSeries(ctx);
        if (!r.ok) throw fail("rounds are already running");
      } else if (args?.action === "next") {
        const r = await nextRound(ctx);
        if (!r.ok) throw fail("no rounds are running");
      } else if (args?.action === "stop") {
        const r = await stopSeries(ctx);
        if (!r.ok) throw fail("no rounds are running");
      } else throw fail("action must be start, next or stop");
      return { done: args.action };
    },
    async poll_quick(ctx, args) {
      const choices = Array.isArray(args?.choices) ? args.choices : [];
      const r = await quickPoll(ctx, { a: choices[0], b: choices[1], c: choices[2], d: choices[3], seconds: args?.seconds ?? quickDefault(ctx), question: args?.question });
      if (r.errors) throw Object.assign(new Error(`invalid: ${Object.keys(r.errors).join(", ")} (2 to 4 different choices of 60 characters at most, seconds between 15 and 900)`), { expose: true });
      if (!r.ok) throw Object.assign(new Error(`the site already keeps ${LIMITS.livePolls} polls and none is finished yet`), { expose: true });
      return { id: r.id, endsAt: r.endsAt, link: baseOf(ctx) === null ? null : `${ctx.api.siteUrl}${baseOf(ctx)}/now` };
    },
    // Suppression : jamais accordée d'office (manifeste : destructive). Un sondage ouvert demande `allowOpen: true`, comme la case de confirmation renforcée de l'administration.
    async poll_delete(ctx, args) {
      const r = await deletePoll(ctx, args?.id, { allowOpen: args?.allowOpen === true });
      if (r.ok) return { id: args.id, deleted: true, votesDeleted: r.voters };
      const why = { gone: "poll not found", round: "this is the running round: use round_control (next or stop) instead", open: `the poll is open with ${r.voters} votes: close it with poll_close to keep its result, or pass allowOpen: true to delete it and lose those votes`, partial: "the poll has many votes and was only partly deleted (it is now closed): call poll_delete again to finish" }[r.error] ?? "poll not found";
      throw Object.assign(new Error(why), { expose: true });
    },
    async poll_close(ctx, args) {
      const r = await closeNow(ctx, args?.id);
      if (!r.ok) throw Object.assign(new Error(r.error === "already" ? "poll already closed" : "poll not found"), { expose: true });
      return { id: args.id, closed: true };
    },
  },

  backup: {
    async readable(ctx) {
      const cell = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
      const lines = [["id", "question", "state", "created", "ends", "voters", "results"].map(cell).join(",")];
      for (const col of [POLLS, ARCHIVE]) {
        let cursor = null;
        do {
          const page = await ctx.api.store.page(col, { limit: 500, cursor });
          for (const r of page.items) {
            const p = pollOf(r, col === ARCHIVE ? "archive" : "live");
            lines.push([p.slug, p.question, col === ARCHIVE ? "archived" : L.stateOf(p), p.createdAt, p.endsAt ?? "", p.voters ?? 0, L.rows(p).map((x) => `${x.text}: ${x.count}`).join(" | ")].map(cell).join(","));
          }
          cursor = page.next;
        } while (cursor);
      }
      const rl = [["round", "question", "decided", "winner", "tie", "voters", "results"].map(cell).join(",")];
      let rc = null;
      do {
        const page = await ctx.api.store.page(ROUNDS, { limit: 500, cursor: rc, order: "asc" });
        for (const r of page.items) rl.push([r.data.n, r.data.question, r.data.decidedAt, r.data.winner ?? "", (r.data.tie ?? []).join(" | "), r.data.voters, r.data.choices.map((c) => `${c.text}: ${c.count}`).join(" | ")].map(cell).join(","));
        rc = page.next;
      } while (rc);
      return [{ path: "polls.csv", content: `﻿${lines.join("\r\n")}\r\n` }, { path: "decisions.csv", content: `\ufeff${rl.join("\r\n")}\r\n` }];
    },
  },

  hooks: {
    async onInstanceCreate(ctx) { await ensureCfg(ctx).catch(() => {}); },
    async onInstanceDelete(ctx) {
      for (const k of [...mem.hits.keys()]) if (k.split("|")[1] === ctx.instance.key) mem.hits.delete(k);
      mem.swept.delete(ctx.instance.key);
      pendingSync.delete(ctx.instance.key);
    },
  },
};
