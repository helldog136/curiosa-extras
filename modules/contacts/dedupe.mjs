// Contacts — le détecteur de doublons et l'aperçu de fusion.
//
// Ce que le carnet regarde pour dire « ces fiches se ressemblent » (rien d'autre, tout vient de l'index : aucune lecture du stockage) :
//   · même compte (un compte ne devrait être que sur une fiche : ce cas ne vient que de données anciennes),
//   · même e-mail (idem),
//   · même nom ET même organisation (personnes), même nom (organisations),
//   · nom presque pareil ET même organisation : lettres en trop ou en moins, ou prénom et nom inversés,
//   · même nom sans organisation (le plus incertain : deux personnes peuvent porter le même nom).
// Le résultat est calculé en une passe sur l'index (quelques dizaines de ms pour 100 000 fiches, le processus respire tous les 5 000), gardé 5 minutes et jeté dès
// que le carnet change ; l'écran le lit PAR PAGES (20 groupes). 5 000 groupes au plus sont gardés : on règle ceux-là, et la liste se met à jour.
// « Ce ne sont pas des doublons » est mémorisé par paire (collection `notdup`, 20 000 paires au plus) et les cache pour de bon.
const v = new URL(import.meta.url).search;
const B = await import(`./book.mjs${v}`);
const D = await import(`./data.mjs${v}`);

export const GROUP_PAGE = 20;
export const MAX_GROUPS = 5000;
export const MAX_NOTDUP = 20_000;
const CACHE_MS = 5 * 60_000;
const CACHE = new Map(); // id d'instance → { stamp, at, result }
const MAX_COMPARES = 2_000_000;
export const REASONS = ["account", "email", "name_org", "name_close", "name"];
const RANK = Object.fromEntries(REASONS.map((r, i) => [r, i]));

const sameTick = () => new Promise((r) => setImmediate(r));
/** Distance d'édition bornée à 2 (rend 3 si plus loin). */
function near(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = cur[0];
    for (let j = 1; j <= b.length; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); if (cur[j] < best) best = cur[j]; }
    if (best > 2) return 3;
    prev = cur;
  }
  return prev[b.length];
}
const sortedTokens = (n) => n.split(" ").filter(Boolean).sort().join(" ");

export async function loadNotDup(ctx) {
  const out = new Set();
  let cursor = null, pages = 0;
  do {
    const p = await ctx.api.store.page("notdup", { limit: 1000, order: "asc", cursor });
    for (const r of p.items ?? []) if (typeof r.data?.a === "string" && typeof r.data?.b === "string") out.add(`${r.data.a}|${r.data.b}`);
    cursor = p.next ?? null;
  } while (cursor && ++pages < 30);
  return out;
}
const pairKey = (x, y) => (x < y ? `${x}|${y}` : `${y}|${x}`);

/** Calcule les groupes sur l'index `idx`. Rend { groups: [{ ids, reasons, rank }], truncated }. `ids` dans l'ordre de création. */
async function compute(ctx, idx) {
  const notDup = await loadNotDup(ctx);
  const parent = new Map(); // union-find sur les ids
  const reasons = new Map(); // racine → Set de raisons
  const find = (x) => { let r = x; while (parent.get(r) !== r) r = parent.get(r); while (parent.get(x) !== r) { const n = parent.get(x); parent.set(x, r); x = n; } return r; };
  const note = (x, y, reason) => {
    if (notDup.has(pairKey(x, y))) return;
    for (const k of [x, y]) if (!parent.has(k)) parent.set(k, k);
    const rx = find(x), ry = find(y);
    const set = new Set([...(reasons.get(rx) ?? []), ...(reasons.get(ry) ?? []), reason]);
    if (rx !== ry) { parent.set(ry, rx); reasons.delete(ry); }
    reasons.set(rx, set);
  };
  const seen = { account: new Map(), email: new Map(), exact: new Map() };
  const byOrg = new Map(); // id d'organisation → [entrées]
  const orgNames = [];
  let i = 0;
  for (const e of idx.list) {
    if (++i % 5000 === 0) await sameTick();
    for (const k of D.keysOf(e)) { const o = seen.account.get(k); if (o) note(o, e.id, "account"); else seen.account.set(k, e.id); }
    if (e.m) { const o = seen.email.get(e.m); if (o) note(o, e.id, "email"); else seen.email.set(e.m, e.id); }
    const org = e.k & 1;
    const key = org ? `o\u0001${e.n}` : `p\u0001${e.n}\u0001${e.o ?? ""}`;
    const o = seen.exact.get(key);
    if (o) note(o, e.id, org || e.o ? "name_org" : "name"); else seen.exact.set(key, e.id);
    if (org) orgNames.push(e); else if (e.o) { let l = byOrg.get(e.o); if (!l) byOrg.set(e.o, (l = [])); l.push(e); }
  }
  let compares = 0;
  const closeIn = (list, label) => {
    // Blocs par les deux premières lettres du nom (trié en mots) : on ne compare que ce qui peut se ressembler.
    const blocks = new Map();
    for (const e of list) { const s = sortedTokens(e.n); const b = s.slice(0, 2); let l = blocks.get(b); if (!l) blocks.set(b, (l = [])); l.push([e, s]); }
    for (const l of blocks.values()) {
      if (l.length > 400) l.length = 400;
      for (let x = 0; x < l.length; x++) for (let y = x + 1; y < l.length; y++) {
        if (++compares > MAX_COMPARES) return;
        const [a, sa] = l[x], [b, sb] = l[y];
        if (a.n === b.n) continue;
        if (sa === sb || (sa.length >= 5 && !/\d/.test(sa) && !/\d/.test(sb) && near(sa, sb) <= (sa.length >= 12 ? 2 : 1))) note(a.id, b.id, label);
      }
    }
  };
  for (const members of byOrg.values()) { if (members.length > 1) closeIn(members, "name_close"); if (compares > MAX_COMPARES) break; }
  if (orgNames.length > 1 && compares <= MAX_COMPARES) closeIn(orgNames, "name_close");

  const comps = new Map();
  for (const id of parent.keys()) { const r = find(id); let l = comps.get(r); if (!l) comps.set(r, (l = [])); l.push(id); }
  const order = (id) => idx.byId.get(id);
  const groups = [];
  for (const [root, ids] of comps) {
    if (ids.length < 2) continue;
    const rs = [...(reasons.get(root) ?? [])].sort((a, b) => RANK[a] - RANK[b]);
    ids.sort((a, b) => (order(a).t - order(b).t) || (a < b ? -1 : 1));
    groups.push({ ids: ids.slice(0, 8), size: ids.length, reasons: rs, rank: RANK[rs[0]] ?? 9, t: order(ids[0]).t });
  }
  groups.sort((a, b) => a.rank - b.rank || a.t - b.t || (a.ids[0] < b.ids[0] ? -1 : 1));
  return { groups: groups.slice(0, MAX_GROUPS), total: groups.length, truncated: groups.length > MAX_GROUPS };
}

/** Les groupes de doublons (en cache 5 min, jeté dès que le carnet change). */
export async function groups(ctx, { fresh = false } = {}) {
  const idx = await B.getIndex(ctx);
  const id = ctx.instance?.id ?? "?";
  const stamp = `${idx.gen}|${idx.stamp}|${idx.list.length}`;
  const hit = CACHE.get(id);
  if (!fresh && hit && hit.stamp === stamp && Date.now() - hit.at < CACHE_MS) return { ...hit.result, idx };
  const result = await compute(ctx, idx);
  CACHE.set(id, { stamp, at: Date.now(), result });
  return { ...result, idx };
}
export const forgetGroups = (ctx) => CACHE.delete(ctx.instance?.id ?? "?");
export async function page(ctx, cursor) {
  const g = await groups(ctx);
  const from = Math.max(0, Math.min(g.groups.length, Math.trunc(Number(cursor)) || 0));
  const items = g.groups.slice(from, from + GROUP_PAGE);
  return { items, next: from + GROUP_PAGE < g.groups.length ? from + GROUP_PAGE : null, total: g.total, truncated: g.truncated, idx: g.idx };
}

/** « Ce ne sont pas des doublons » : la paire est mémorisée. */
export async function ignorePair(ctx, a, b) {
  if (!D.idOk(a) || !D.idOk(b) || a === b) return { ok: false, error: "invalid" };
  const [x, y] = a < b ? [a, b] : [b, a];
  let cursor = null, pages = 0;
  do {
    const p = await D.listByKey(ctx, "notdup", x, { limit: 100, cursor });
    if ((p.items ?? []).some((r) => r.data?.b === y)) { forgetGroups(ctx); return { ok: true }; }
    cursor = p.next ?? null;
  } while (cursor && ++pages < 20);
  if ((await ctx.api.store.count("notdup")) >= MAX_NOTDUP) return { ok: false, error: "too_many" };
  await ctx.api.store.add("notdup", { a: x, b: y }, { key: x });
  forgetGroups(ctx);
  return { ok: true };
}

/** Ce que la fusion ferait (sans rien écrire) : la fiche gardée avant/après, ce qui est repris, les comptes qui ne passeront pas. */
export async function preview(ctx, keepId, dropId) {
  const idx = await B.getIndex(ctx);
  if (keepId === dropId || !idx.byId.has(keepId) || !idx.byId.has(dropId)) return { ok: false, error: "not_found" };
  const [keep, drop] = [await B.readContact(ctx, keepId), await B.readContact(ctx, dropId)];
  if (!keep || !drop) return { ok: false, error: "not_found" };
  if (D.kindOf(keep.data) !== D.kindOf(drop.data)) return { ok: false, error: "kind" };
  const plan = B.planMerge(idx, keep, drop);
  let notes = 0;
  for await (const _ of D.allNotes(ctx, drop.id)) if (++notes >= 1000) break;
  return { ok: true, idx, keep, drop, plan, notes };
}
