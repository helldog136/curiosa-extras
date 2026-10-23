// Cahier de contenu — les données et les règles : une idée = un document de la collection « ideas » du stockage privé de l'instance.
// Rien ici ne touche à l'écran (admin.mjs), aux outils pour l'assistant (tools.mjs) ni aux fichiers (export.mjs).
//
// Bornes (« dézoom permanent ») : 1 000 idées au plus (archivées comprises), 12 étapes et 12 réseaux par idée, textes courts, notes de 4 000 caractères.
// Tout est calculé à la lecture : aucune tâche de fond, aucun minuteur. Les dates sont des jours « AAAA-MM-JJ » lus en UTC.

export const PLACES = ["idea", "doing", "published", "archived"];
export const COLUMNS = ["idea", "doing", "published"];
export const MAX_IDEAS = 1000;
export const PAGE_SIZE = 50;
export const MAX_STEPS = 12;
export const MAX_NETWORKS = 12;
export const LIMITS = { title: 120, summary: 300, notes: 4000, step: 60, network: 30, query: 100 };
export const DEFAULT_NETWORKS = "YouTube, Twitch, Instagram, TikTok, Blog, Newsletter, Podcast, Bluesky";
const DAY = 86_400_000;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// ── Petits nettoyages ─────────────────────────────────────────────────────────────────────────────────────
const CONTROL = /[\u0000-\u001f\u007f\u2028\u2029\u200b-\u200f\u202a-\u202e\ufeff]/g;
const cut = (s, max) => { const t = s.slice(0, max); return /[\ud800-\udbff]$/.test(t) ? t.slice(0, -1) : t; };
/** Une ligne de texte : espaces réduits, caractères de contrôle retirés, longueur bornée. */
export const line = (v, max) => cut(String(v ?? "").replace(CONTROL, " ").replace(/\s+/g, " ").trim(), max);
/** Un texte sur plusieurs lignes (les notes). */
export const para = (v, max) => cut(String(v ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029\u200b-\u200f\u202a-\u202e\ufeff]/g, "").trim(), max);
export const idOk = (v) => typeof v === "string" && ID_RE.test(v);
export const fold = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** « AAAA-MM-JJ » si le jour existe (entre 2000 et 2100), sinon "". */
export function validDate(v) {
  const s = String(v ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return "";
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 2000 || y > 2100) return "";
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? s : "";
}
const isoOrEmpty = (v) => { const t = typeof v === "string" ? Date.parse(v) : NaN; return Number.isNaN(t) ? "" : new Date(t).toISOString(); };

/** L'instant « maintenant » (les tests peuvent le fixer avec `ctx.__plannerNow`). */
export const nowOf = (ctx) => { const t = ctx?.__plannerNow; const d = t ? new Date(t) : new Date(); return Number.isNaN(d.getTime()) ? new Date() : d; };
export const todayOf = (ctx) => nowOf(ctx).toISOString().slice(0, 10);
export const dayNumber = (isoDate) => Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / DAY);
export const addDays = (isoDate, n) => new Date(Date.parse(`${isoDate}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

// ── Réseaux et étapes ─────────────────────────────────────────────────────────────────────────────────────
/** Une liste de réseaux, écrite à la main (virgules, points-virgules, retours à la ligne) ou déjà en tableau : nettoyée, sans doublon, 12 au plus. */
export function parseList(input, itemMax, maxItems, splitter = /[,;\n]/) {
  const raw = Array.isArray(input) ? input : String(input ?? "").split(splitter);
  const seen = new Set(), out = [];
  for (const x of raw) {
    const s = line(x, itemMax);
    const key = fold(s);
    if (!s || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}
export const parseNetworks = (input) => parseList(input, LIMITS.network, MAX_NETWORKS);
export const parseStepLines = (input) => parseList(input, LIMITS.step, MAX_STEPS, /\n/);

/** Les réseaux proposés (réglage), jamais vide. */
export function suggestions(ctx) {
  const list = parseNetworks(ctx.setting("networkList"));
  return list.length ? list : parseNetworks(DEFAULT_NETWORKS);
}
/** Les étapes d'une nouvelle idée : le modèle du réglage, sinon les quatre étapes de base dans la langue de la personne. */
export function modelSteps(ctx) {
  const own = parseStepLines(ctx.setting("stepModel"));
  return own.length ? own : [ctx.t("stepScript"), ctx.t("stepThumbnail"), ctx.t("stepDescription"), ctx.t("stepPublish")];
}
export const stepsFromLabels = (labels) => labels.map((label) => ({ label, done: false }));
/** Nouvelles étapes à partir d'une liste de noms : une étape qui garde son nom garde son état « fait ». */
export function mergeSteps(old, labels) {
  const done = new Map(old.map((s) => [fold(s.label), s.done]));
  return labels.map((label) => ({ label, done: done.get(fold(label)) === true }));
}

// ── Une idée telle que le reste du module la lit ─────────────────────────────────────────────────────────
/** Lit un document du stockage sans jamais lever : tout champ abîmé redevient une valeur sûre. */
export function normalize(row) {
  const d = row?.data && typeof row.data === "object" ? row.data : {};
  const created = isoOrEmpty(d.createdAt) || isoOrEmpty(row?.createdAt instanceof Date ? row.createdAt.toISOString() : row?.createdAt);
  const steps = (Array.isArray(d.steps) ? d.steps : []).slice(0, MAX_STEPS).map((s) => ({ label: line(s?.label, LIMITS.step), done: s?.done === true })).filter((s) => s.label);
  const column = COLUMNS.includes(d.column) ? d.column : "idea";
  return {
    id: String(row?.id ?? ""),
    title: line(d.title, LIMITS.title),
    summary: line(d.summary, LIMITS.summary),
    column,
    archived: d.archived === true,
    steps,
    targetDate: validDate(d.targetDate),
    publishedAt: column === "published" ? validDate(d.publishedAt) : "",
    networks: parseNetworks(Array.isArray(d.networks) ? d.networks : []),
    notes: para(d.notes, LIMITS.notes),
    by: d.by === "assistant" ? "assistant" : "owner",
    createdAt: created,
    updatedAt: isoOrEmpty(d.updatedAt) || created,
  };
}
/** Ce qui est rangé dans le stockage (sans l'identifiant). */
export const toDoc = (i) => ({ title: i.title, summary: i.summary, column: i.column, archived: i.archived, steps: i.steps.map((s) => ({ label: s.label, done: s.done })), targetDate: i.targetDate, publishedAt: i.publishedAt, networks: i.networks, notes: i.notes, by: i.by, createdAt: i.createdAt, updatedAt: i.updatedAt });
export const placeOf = (i) => (i.archived ? "archived" : i.column);
export const stepsDone = (i) => i.steps.filter((s) => s.done).length;
/** Date visée dépassée pour une idée encore en cours (ni publiée ni archivée). */
export const isLate = (i, today) => !i.archived && i.column !== "published" && !!i.targetDate && i.targetDate < today;

// ── Lecture et écriture ───────────────────────────────────────────────────────────────────────────────────
/** Toutes les idées (1 000 au plus), lues par pages. */
export async function loadAll(ctx) {
  const out = [];
  let cursor = null;
  for (let pages = 0; pages < 6; pages++) {
    const p = await ctx.api.store.page("ideas", { limit: 500, cursor });
    for (const r of p?.items ?? []) if (r?.data && typeof r.data === "object" && typeof r.data.title === "string") out.push(normalize(r));
    cursor = p?.next ?? null;
    if (!cursor || out.length >= MAX_IDEAS + 50) break;
  }
  return out;
}
export async function getIdea(ctx, id) {
  if (!idOk(id)) return null;
  const row = await ctx.api.store.get(id);
  return row && row.data && typeof row.data === "object" && typeof row.data.title === "string" && "column" in row.data ? normalize(row) : null;
}
export async function saveIdea(ctx, idea, now = nowOf(ctx)) {
  const next = { ...idea, updatedAt: now.toISOString() };
  return (await ctx.api.store.update(idea.id, toDoc(next))) ? next : null;
}
/** Crée une idée : `fields` déjà nettoyés. `{ full: true }` quand le cahier est plein. */
export async function addIdea(ctx, fields, { by = "owner" } = {}) {
  if ((await ctx.api.store.count("ideas")) >= MAX_IDEAS) return { full: true };
  const now = nowOf(ctx).toISOString();
  const column = fields.column === "doing" ? "doing" : "idea";
  const idea = { id: "", title: fields.title, summary: fields.summary ?? "", column, archived: false, steps: fields.steps ?? stepsFromLabels(modelSteps(ctx)), targetDate: fields.targetDate ?? "", publishedAt: "", networks: fields.networks ?? [], notes: fields.notes ?? "", by, createdAt: now, updatedAt: now };
  idea.id = await ctx.api.store.add("ideas", toDoc(idea));
  return { idea };
}
/** Range une idée à un endroit : une colonne (désarchive) ou les archives (la colonne d'origine est gardée). */
export function placeIdea(idea, to, today) {
  if (to === "archived") return { ...idea, archived: true };
  const publishedAt = to === "published" ? (idea.column === "published" && idea.publishedAt ? idea.publishedAt : today) : "";
  return { ...idea, column: to, archived: false, publishedAt };
}

// ── Tri, recherche, pages ─────────────────────────────────────────────────────────────────────────────────
const RANK = { idea: 0, doing: 1, published: 2, archived: 3 };
/** Dans une colonne : les idées datées d'abord (la plus proche en tête), puis les autres, les plus récentes d'abord ; publié : le plus récent d'abord. */
export function compare(a, b) {
  const pa = placeOf(a), pb = placeOf(b);
  if (pa !== pb) return RANK[pa] - RANK[pb];
  if (pa === "published") return (b.publishedAt || "").localeCompare(a.publishedAt || "") || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);
  if (pa === "archived") return b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);
  if (a.targetDate && b.targetDate) return a.targetDate.localeCompare(b.targetDate) || a.id.localeCompare(b.id);
  if (a.targetDate) return -1;
  if (b.targetDate) return 1;
  return b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
}
export const searchWords = (q) => fold(line(q, LIMITS.query)).split(" ").filter(Boolean).slice(0, 6);
export function matches(idea, words) {
  if (!words.length) return true;
  const hay = fold([idea.title, idea.summary, idea.notes, idea.networks.join(" "), idea.steps.map((s) => s.label).join(" ")].join("\n"));
  return words.every((w) => hay.includes(w));
}
export const inPlace = (list, place) => list.filter((i) => placeOf(i) === place);
export const counts = (list) => { const c = { idea: 0, doing: 0, published: 0, archived: 0 }; for (const i of list) c[placeOf(i)]++; return c; };
/** Une page de `size` éléments ; `page` hors limites est ramenée dans les limites. */
export function pageOf(list, page, size = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(list.length / size));
  const p = Math.min(pages, Math.max(1, Number.isInteger(page) ? page : 1));
  return { items: list.slice((p - 1) * size, p * size), page: p, pages, total: list.length };
}
export const pageNumber = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 100000 ? n : 1; };

// ── Le rythme ─────────────────────────────────────────────────────────────────────────────────────────────
const PERIOD_DAYS = { week: 7, fortnight: 14, month: 30 };
/** Le rythme réglé (« 1 par semaine »), ou null : il est facultatif. */
export function rhythmOf(ctx) {
  const count = Number(ctx.setting("rhythmCount"));
  const period = String(ctx.setting("rhythmPeriod") ?? "");
  if (!Number.isInteger(count) || count < 1 || count > 14 || !Object.hasOwn(PERIOD_DAYS, period)) return null;
  return { count, period, days: PERIOD_DAYS[period] };
}
/**
 * Où en est le rythme, calculé à la lecture (jamais de minuteur).
 *   start  : rien n'a encore été publié, donc rien à comparer ;
 *   ok     : la dernière publication est assez récente ;
 *   behind : plus d'un intervalle sans publier (une par semaine : au 8e jour) ;
 *   pause  : un mois et plus sans publier.
 * `done` : combien de publications dans la période qui vient de s'écouler.
 */
export function rhythmStatus(ideas, rhythm, today) {
  const dates = ideas.filter((i) => i.column === "published" && i.publishedAt).map((i) => i.publishedAt).sort();
  const t = dayNumber(today);
  const done = dates.filter((d) => { const age = t - dayNumber(d); return age >= 0 && age < rhythm.days; }).length;
  const last = dates.length ? dates[dates.length - 1] : null;
  const since = last ? Math.max(0, t - dayNumber(last)) : null;
  const gap = Math.ceil(rhythm.days / rhythm.count);
  let state = "start";
  if (last) state = since >= 30 && since > gap ? "pause" : since > gap ? "behind" : "ok";
  return { state, done, since, last };
}

// ── Fichiers (CSV) ────────────────────────────────────────────────────────────────────────────────────────
/** Une cellule de tableur : entre guillemets, et jamais lue comme une formule. */
export const cell = (x) => { let s = String(x ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
export const csvLine = (cells, delimiter = ",") => `${cells.map(cell).join(delimiter)}\r\n`;
