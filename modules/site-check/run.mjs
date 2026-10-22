// Santé du site — le déroulement d'une vérification : lire le site, puis visiter les liens PAR PAQUETS, à la demande seulement.
//
// Garde-fous (tous ici) :
//  - jamais en arrière-plan : rien ne part sans un clic (ou un appel explicite d'un assistant) ; aucune tâche planifiée, aucun minuteur ;
//  - un seul passage à la fois (une réservation en mémoire du processus ET une date de fin gardée dans les données) ;
//  - au plus 200 liens par vérification, 25 par site visité, répartis pour ne jamais frapper deux fois de suite le même site ;
//  - un paquet s'arrête à 20 secondes ou 60 liens ; un quart de seconde entre deux visites, une seconde entre deux visites du même site ;
//  - un site qui dit « trop de demandes » n'est plus contacté du tout pendant cette vérification.
//
// Données gardées (stockage de l'instance) : « report » (le dernier rapport), « run » (la vérification en cours, supprimée à la fin),
// « state » (où reprendre la fenêtre de liens), « history » (les 5 dernières vérifications), « ignored » (remarques masquées, 200 au plus).
import { scanSite, LIMITS, SEVERITY, fixHref } from "./scan.mjs";
import { probeLink } from "./probe.mjs";
import { hostKey, clip } from "./urls.mjs";

export const BATCH_MS = 20000;
export const BATCH_MAX = 60;
export const GAP_MS = 250;
export const SAME_HOST_MS = 1000;
export const BUSY_MS = 120000;
export const KEEP_HISTORY = 5;
export const MAX_IGNORED = 200;

const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));
const busyBox = () => (globalThis[Symbol.for("curiosa.site-check.busy")] ??= new Set());
const iso = (ms) => new Date(ms).toISOString();

/* ───────────── Réglages ───────────── */

const truthy = (v) => v === true || v === "true" || v === "on" || v === 1 || v === "1";
export function readSettings(ctx) {
  const raw = ctx.setting("checkLinks");
  const max = Math.trunc(Number(ctx.setting("maxLinks")));
  return {
    checkLinks: raw === undefined || raw === null || raw === "" ? true : truthy(raw),
    maxLinks: Number.isFinite(max) && max >= 1 ? Math.min(LIMITS.links, max) : LIMITS.links,
    ignoredHosts: String(ctx.setting("ignoreHosts") ?? ""),
  };
}

/* ───────────── Données ───────────── */

async function single(ctx, collection) {
  const [row] = await ctx.api.store.list(collection, { limit: 1 });
  return row ? { ...row.data, _row: row.id } : null;
}
/** Écrit un document unique : met à jour celui qui existe (`current`), sinon le crée. `data._row` retient l'identifiant de la ligne. */
async function put(ctx, collection, current, data) {
  const { _row, ...clean } = data;
  const row = current?._row ?? _row;
  if (row) { await ctx.api.store.update(row, clean); data._row = row; return row; }
  data._row = await ctx.api.store.add(collection, clean);
  return data._row;
}

export async function readState(ctx) {
  const [report, run, state, history, ignoredRows] = await Promise.all([
    single(ctx, "report"), single(ctx, "run"), single(ctx, "state"),
    ctx.api.store.list("history", { limit: 10 }), ctx.api.store.list("ignored", { limit: MAX_IGNORED }),
  ]);
  return { report, run, state, history: history.slice(0, KEEP_HISTORY).map((r) => r.data), ignored: new Set(ignoredRows.map((r) => r.data.k)), ignoredCount: ignoredRows.length };
}

/* ───────────── Du résultat de chaque lien aux remarques ───────────── */

const LINK_GROUPS = new Set(["link_gone", "img_gone", "link_down", "link_loop", "link_blocked", "link_moved", "link_insecure", "link_unverified"]);

function linkGroup(link) {
  const r = link.r;
  if (!r) return null;
  const image = link.k === "image";
  switch (r.st) {
    case "gone": return [image ? "img_gone" : "link_gone", "important"];
    case "down": return ["link_down", "advised"];
    case "loop": return ["link_loop", "advised"];
    case "blocked": return ["link_blocked", "info"];
    case "moved": return ["link_moved", "info"];
    case "ok": return r.ins ? ["link_insecure", "info"] : null;
    default: return ["link_unverified", "info"];   // paused · refused · unverified · skipped
  }
}

export function linkGroups(run) {
  const map = new Map();
  for (const link of run?.links ?? []) {
    const hit = linkGroup(link);
    if (!hit) continue;
    const [id, sev] = hit;
    let g = map.get(id);
    if (!g) { g = { id, loc: null, sev, count: 0, items: [] }; map.set(id, g); }
    g.count++;
    if (g.items.length >= LIMITS.items) continue;
    const s = link.s?.[0];
    g.items.push({ k: `lk:${link.u}`.slice(0, 190), t: link.label || hostKey(link.u), u: clip(link.u, 200), w: s?.w ?? "", d: [link.r.st, link.r.code ?? link.r.why ?? "", link.r.to ? clip(link.r.to, 200) : ""], f: s?.f ?? null });
  }
  return [...map.values()];
}

const weightOf = (item) => (item.d?.[0] === "imgs" ? Number(item.d[1]) || 1 : 1);

/** Les remarques à montrer : celles que la personne n'a pas masquées, de la plus utile à la moins urgente. */
export function visibleGroups(report, ignored = new Set()) {
  const out = [];
  for (const g of report?.groups ?? []) {
    const hidden = g.items.filter((i) => ignored.has(i.k));
    const count = g.count - hidden.reduce((n, i) => n + weightOf(i), 0);
    const items = g.items.filter((i) => !ignored.has(i.k));
    if (count > 0 && items.length) out.push({ ...g, count, items });
  }
  return out.sort((a, b) => SEVERITY[a.sev] - SEVERITY[b.sev]);
}

export function tally(groups) {
  const counts = { important: 0, advised: 0, info: 0 };
  for (const g of groups) counts[g.sev] += g.items.length ? g.count : 0;
  return counts;
}

const rebuilt = (report, run) => [...report.groups.filter((g) => !LINK_GROUPS.has(g.id)), ...linkGroups(run)];
export const progressOf = (run) => ({ done: run.links.filter((l) => l.r).length, total: run.links.length });

/* ───────────── Un paquet de liens ───────────── */

async function batch(ctx, deps, report, run) {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? sleepReal;
  const probe = deps.probe ?? probeLink;
  const started = now();
  run.busyUntil = started + BUSY_MS;
  run.paused ??= {};
  await put(ctx, "run", null, run);
  const dnsCache = new Map();
  const lastHit = new Map();
  let lastAny = 0;
  let visited = 0;
  try {
    for (const link of run.links) {
      if (link.r) continue;
      if (visited >= BATCH_MAX || now() - started >= BATCH_MS) break;
      const host = hostKey(link.u);
      const until = run.paused[host];
      if (until && until > now()) { link.r = { st: "paused", why: "rate" }; continue; }
      const wait = Math.max(lastAny + GAP_MS - now(), (lastHit.get(host) ?? 0) + SAME_HOST_MS - now(), 0);
      if (wait > 0) { if (now() + wait - started > BATCH_MS) break; await sleep(wait); }
      let r;
      try { r = await probe(ctx, link.u, { dnsCache, now, ...(deps.probeDeps ?? {}) }); } catch { r = { st: "down", why: "network" }; }
      lastAny = now();
      lastHit.set(host, lastAny);
      visited++;
      if (r.st === "paused") run.paused[host] = Math.min(now() + 3_600_000, Number(r.retryAt) > now() ? Number(r.retryAt) : now() + 60_000);
      link.r = { st: r.st, ...(r.code ? { code: r.code } : {}), ...(r.why ? { why: r.why } : {}), ...(r.to ? { to: clip(r.to, 200) } : {}), ...(r.insecure ? { ins: 1 } : {}) };
    }
  } finally {
    run.busyUntil = 0;
  }
  const { done, total } = progressOf(run);
  report.groups = rebuilt(report, run);
  report.progress = done >= total ? null : { done, total };
  await put(ctx, "run", null, run);
  await put(ctx, "report", null, report);
  if (done >= total) await finalize(ctx, report, run, deps);
  return { done, total, finished: done >= total, visited };
}

/** Fin de vérification : le rapport est complet, la vérification en cours disparaît, l'historique garde les 5 dernières. */
async function finalize(ctx, report, run, deps = {}) {
  const now = deps.now ?? Date.now;
  const { ignored } = await readState(ctx);
  const groups = visibleGroups(report, ignored);
  const counts = tally(groups);
  report.finished = true;
  report.progress = null;
  report.doneAt = iso(now());
  report.counts = counts;
  await put(ctx, "report", null, report);
  if (run?._row) await ctx.api.store.remove(run._row);
  const entry = { at: report.at, doneAt: report.doneAt, counts, ok: counts.important + counts.advised === 0, pages: report.stats.pages, links: run ? run.links.filter((l) => l.r && l.r.st !== "skipped").length : 0 };
  await ctx.api.store.add("history", entry);
  const rows = await ctx.api.store.list("history", { limit: 50 });
  for (const row of rows.slice(KEEP_HISTORY)) await ctx.api.store.remove(row.id);
  // Prochaine fenêtre de liens : on reprend là où celle-ci s'est arrêtée.
  const t = report.linkTotals;
  const state = await single(ctx, "state");
  await put(ctx, "state", state, { ...(state ?? {}), cursor: t?.window ? (t.from + t.count) % Math.max(1, t.found) : 0 });
}

/* ───────────── Les actions ───────────── */

async function withLock(ctx, fn) {
  const box = busyBox();
  const key = ctx.instance.key;
  if (box.has(key)) return { busy: true };
  const run = await single(ctx, "run");
  if (run && Number(run.busyUntil) > Date.now()) return { busy: true };
  box.add(key);
  try { return await fn(run); } finally { box.delete(key); }
}

/** Nouvelle vérification : lit le site, puis visite un premier paquet de liens. */
export function startCheck(ctx, deps = {}) {
  return withLock(ctx, async (previous) => {
    const now = deps.now ?? Date.now;
    const opts = readSettings(ctx);
    const state = await single(ctx, "state");
    const scan = await (deps.scan ?? scanSite)(ctx, { ...opts, cursor: state?.cursor });
    const report = {
      cid: `c${now().toString(36)}`, at: iso(now()), finished: false, stats: scan.stats, linkTotals: scan.linkTotals, notes: scan.notes, locales: scan.locales,
      linksOff: !opts.checkLinks, groups: scan.groups, progress: scan.links.length ? { done: 0, total: scan.links.length } : null,
    };
    const oldReport = await single(ctx, "report");
    const run = scan.links.length ? { _row: previous?._row, links: scan.links, paused: {}, busyUntil: 0, at: report.at } : null;
    if (!run && previous?._row) await ctx.api.store.remove(previous._row);
    report._row = oldReport?._row;
    report.groups = run ? rebuilt(report, run) : report.groups;
    await put(ctx, "report", null, report);
    if (!run) { await finalize(ctx, report, null, deps); return { done: 0, total: 0, finished: true, visited: 0 }; }
    return batch(ctx, deps, report, run);
  });
}

/** Paquet suivant d'une vérification commencée. */
export function continueCheck(ctx, deps = {}) {
  return withLock(ctx, async (run) => {
    const report = await single(ctx, "report");
    if (!run || !report || report.finished) return { none: true };
    return batch(ctx, deps, report, run);
  });
}

export async function ignoreItem(ctx, k) {
  const key = String(k ?? "").slice(0, 190);
  const { report, ignored, ignoredCount } = await readState(ctx);
  if (!key || !report?.groups.some((g) => g.items.some((i) => i.k === key))) return { gone: true };
  if (ignored.has(key)) return { ok: true };
  if (ignoredCount >= MAX_IGNORED) return { full: true };
  await ctx.api.store.add("ignored", { k: key, at: iso(Date.now()) });
  return { ok: true };
}

export async function unignoreAll(ctx) {
  const rows = await ctx.api.store.list("ignored", { limit: MAX_IGNORED });
  for (const r of rows) await ctx.api.store.remove(r.id);
  return rows.length;
}

/** Où « Corriger » mène pour une remarque (jamais ailleurs que dans l'administration), ou null si elle n'existe plus. */
export async function fixTarget(ctx, k) {
  const { report } = await readState(ctx);
  for (const g of report?.groups ?? []) for (const i of g.items) if (i.k === k) return fixHref(i.f, ctx.defaultLocale) ?? (g.id.startsWith("link") || g.id === "img_gone" ? "/admin/entries" : null);
  return null;
}
