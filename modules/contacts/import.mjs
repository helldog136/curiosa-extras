// Contacts — l'import CSV : collage ou fichier (5 Mo au plus), aperçu AVANT d'importer, puis import par lots qui reprend là où il s'est arrêté.
//
// Principe « dézoom permanent » : le fichier n'est lu qu'une fois (ligne par ligne) et rangé en paquets de 200 lignes déjà comprises dans la collection
// `importRows` ; ensuite l'aperçu puis l'import avancent paquet par paquet, chacun en temps borné (8 s), et la position est notée dans le document de
// l'import (`imports`, clé « job »). Rien n'est jamais tout en mémoire, rien ne tourne en arrière-plan : chaque pas est un clic de la personne.
// Un seul import à la fois. Plafond : 100 000 lignes (le plafond du carnet). Idempotent : un fichier réimporté ne crée rien de plus.
//
// Pour chaque ligne le résultat est l'un de quatre : créée · rattachée (la fiche existait : on lui ajoute ce qui manque, sans jamais changer son nom) ·
// ignorée (existait déjà, rien à ajouter) · en erreur (avec la raison et un exemple). L'aperçu et l'import passent par la MÊME fonction (`evaluate`).
//
// Collections : `imports` (le document de l'import), `importRows` (paquets de lignes, clé = id de l'import), `importLog` (journal par résultat, clé « id:résultat »).
const v = new URL(import.meta.url).search;
const B = await import(`./book.mjs${v}`);
const D = await import(`./data.mjs${v}`);
const C = await import(`./csv.mjs${v}`);
const N = await import(`./networks.mjs${v}`);

export const OUTCOMES = ["created", "linked", "skipped", "error"];
const CHUNK = 200;                 // lignes par paquet rangé
const LOG_CHUNK = 100;             // entrées par document de journal
const LOG_CAP = { error: 1000, created: 200, linked: 200, skipped: 200 };
const STALE_MS = 7 * 86_400_000;   // un import abandonné est effacé au bout de 7 jours
const OVERLAY_MS = 30 * 60_000;
const opt = (ctx, k, def) => { const n = ctx?.__contactsTest?.[k]; return Number.isInteger(n) && n > 0 ? n : def; };
export const stepMs = (ctx) => opt(ctx, "importStepMs", 8000);
const lockRows = (ctx) => opt(ctx, "importLockRows", 100);
const today = () => new Date().toISOString().slice(0, 10);
const fold = N.fold;

// ── Le document de l'import ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function getJob(ctx) {
  const r = await D.getByKey(ctx, "imports", "job");
  return r && r.data && typeof r.data === "object" ? r : null;
}
const saveJob = (ctx, job) => ctx.api.store.update(job.id, job.data, { key: "job" });

/** Efface les paquets de lignes (et, avec `all`, le journal puis le document) d'un import, dans la limite du temps donné. Rend true si tout est parti. */
async function purge(ctx, job, { all = false, budgetMs = 6000 } = {}) {
  const t0 = Date.now();
  const store = ctx.api.store;
  const sweep = async (collection, key) => {
    for (let guard = 0; guard < 1000; guard++) {
      const p = await store.page(collection, { key, limit: 500, order: "asc" });
      if (!(p.items ?? []).length) return true;
      for (const it of p.items) { await store.remove(it.id); if (Date.now() - t0 > budgetMs) return false; }
    }
    return false;
  };
  let clean = await sweep("importRows", job.id);
  if (all) {
    for (const o of OUTCOMES) clean = (await sweep("importLog", `${job.id}:${o}`)) && clean;
    if (clean) await store.remove(job.id);
  }
  if (!all) { job.data.stagingLeft = !clean; await saveJob(ctx, job).catch(() => {}); }
  OVERLAYS.delete(overlayKey(ctx, job));
  return clean;
}
/** Abandonne l'import en cours : tout ce qu'il avait rangé est effacé (les fiches déjà créées restent). */
export async function cancel(ctx) {
  const job = await getJob(ctx);
  if (!job) return true;
  return purge(ctx, job, { all: true, budgetMs: 20_000 });
}
/** Au passage sur la page : un import fini ou oublié depuis plus de 7 jours est effacé ; un nettoyage inachevé continue. */
export async function tidy(ctx) {
  const job = await getJob(ctx);
  if (!job) return null;
  if (Date.now() - (job.data.updatedAt ?? 0) > STALE_MS) { await purge(ctx, job, { all: true, budgetMs: 10_000 }); return null; }
  if (job.data.stagingLeft && ["done", "cancelled"].includes(job.data.state)) await purge(ctx, job, { budgetMs: 4000 });
  return getJob(ctx);
}

// ── 1. Lire le fichier et le ranger ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Lit tout le texte une seule fois, ligne par ligne, et range les lignes comprises. Rend { ok: true, job } ou { ok: false, error: { code, … } } :
 * `busy_job` (un import est déjà en cours), `empty`, `header` (aucune colonne reconnue), `quote` (record), `norows`, `too_many` (plus de 100 000 lignes).
 */
export async function stage(ctx, text, { locale = "en" } = {}) {
  const store = ctx.api.store;
  const old = await tidy(ctx);
  if (old && !["done", "cancelled"].includes(old.data.state)) return { ok: false, error: { code: "busy_job" } };
  if (old) await purge(ctx, old, { all: true, budgetMs: 20_000 });
  const src = String(text ?? "");
  if (!src.trim()) return { ok: false, error: { code: "empty" } };
  const delimiter = C.detectDelimiter(src);
  const data = { state: "staging", createdAt: Date.now(), updatedAt: Date.now(), total: 0, delimiter, locale, p: { cursor: null, offset: 0, done: false }, processed: 0, counts: { created: 0, linked: 0, skipped: 0, error: 0 }, logs: {}, newCategories: [], phase: "stage" };
  const id = await store.add("imports", data, { key: "job" });
  const job = { id, data };
  let it, map = null, width = 0, total = 0, chunk = [], pending = [], seq = 0;
  const flush = async (force) => {
    if (chunk.length && (force || chunk.length >= CHUNK)) { pending.push({ data: { job: id, seq: seq++, rows: chunk }, key: id }); chunk = []; }
    if (pending.length >= (force ? 1 : 5)) {
      const list = pending; pending = [];
      if (typeof store.addMany === "function") await store.addMany("importRows", list); else for (const r of list) await store.add("importRows", r.data, { key: r.key });
    }
  };
  try {
    it = C.parseCsv(src, delimiter);
    for (const { record, cells } of it) {
      if (!map) {
        const h = C.readHeader(cells);
        if (h.map.name === undefined && h.map.accounts === undefined) { await purge(ctx, job, { all: true }); return { ok: false, error: { code: "header", headers: cells.map((c) => String(c).trim().slice(0, 30)).filter(Boolean).slice(0, 8) } }; }
        map = h.map; width = cells.length; data.map = map; data.header = cells.slice(0, 40).map((c) => String(c).slice(0, 60)); data.unknown = h.unknown.slice(0, 20);
        continue;
      }
      if (++total > C.MAX_ROWS) { await purge(ctx, job, { all: true }); return { ok: false, error: { code: "too_many", max: C.MAX_ROWS } }; }
      const r = C.rowInput(map, cells, width);
      chunk.push(r.ok ? { line: record, input: r.input } : { line: record, error: r.error, raw: cells.slice(0, 40).map((c) => String(c).slice(0, 500)) });
      await flush(false);
    }
    await flush(true);
  } catch (e) {
    await purge(ctx, job, { all: true, budgetMs: 20_000 }).catch(() => {});
    if (e?.code === "quote") return { ok: false, error: { code: "quote", record: e.record } };
    throw e;
  }
  if (!map) { await purge(ctx, job, { all: true }); return { ok: false, error: { code: "empty" } }; }
  if (!total) { await purge(ctx, job, { all: true }); return { ok: false, error: { code: "norows" } }; }
  data.total = total; data.state = "staged"; data.updatedAt = Date.now();
  await saveJob(ctx, job);
  return { ok: true, job };
}

// ── 2. Comprendre une ligne (aperçu ET import) ──────────────────────────────────────────────────────────────────────────────────────────────
const OVERLAYS = new Map(); // id de l'import → { at, keys: Map(clé → ligne), orgs: Set, cats: Set, virtual: nombre de fiches « à créer » } (aperçu seulement, expire)
const overlayKey = (ctx, job) => `${ctx.instance?.id ?? "?"}|${job.id}`;
function overlayFor(id, fresh) {
  const now = Date.now();
  for (const [k, o] of OVERLAYS) if (now - o.at > OVERLAY_MS) OVERLAYS.delete(k);
  let o = OVERLAYS.get(id);
  if (!o || fresh) { o = { at: now, keys: new Map(), orgs: new Set(), cats: new Set(), catNames: [], applied: new Map(), bare: new Set(), virtual: 0 }; OVERLAYS.set(id, o); }
  o.at = now;
  return o;
}

const rowKeys = (inp) => [...inp.accounts.map((a) => N.accountKey(a.network, a.handle)), ...(inp.email ? [`e:${inp.email}`] : []), `n:${inp.kind}:${fold(inp.name)}\u0001${inp.kind === "org" ? "" : fold(inp.organisation)}`];
const kindOfEntry = (e) => (e.k & 1 ? "org" : "person");

/** Table « nom + organisation → fiche » des personnes (une lecture de l'index par pas ; tenue à jour pendant le pas). */
function nameTable(idx) {
  const t = new Map();
  for (const e of idx.list) {
    if (e.k & 1) continue;
    const k = `n:person:${e.n}\u0001${e.o ? idx.byId.get(e.o)?.n ?? "" : ""}`;
    if (!t.has(k)) t.set(k, e.id);
  }
  return t;
}

async function existingNotes(ctx, id) {
  const seen = new Set();
  let n = 0;
  for await (const x of D.allNotes(ctx, id)) { seen.add(`${x.data.author}\u0001${x.data.text}`); if (++n >= 1000) break; }
  return seen;
}

/** Les catégories d'une ligne : ids existants, ou (aperçu) comptées comme à créer, ou (import) créées. Rend { ids } ou { error }. */
async function categoriesFor(ctx, idx, names, write, env) {
  const ids = [];
  for (const name of names) {
    const known = B.catByLabel(idx, name);
    if (known) { ids.push(known.id); continue; }
    const f = fold(name);
    if (!write && env.ov?.cats.has(f)) { ids.push(`~${f}`); continue; }
    if (!B.can(ctx, B.RIGHT_CREATE_CATEGORY)) return { error: { code: "category_denied", value: name } };
    if (B.liveCategories(idx).length + (write ? 0 : env.ov.cats.size) >= D.LIMITS.categories) return { error: { code: "category_limit", value: name } };
    if (write) {
      const data = { name, color: D.PALETTE[B.liveCategories(idx).length % D.PALETTE.length], icon: null };
      const id = await ctx.api.store.add("categories", data);
      D.indexPutCategory(idx, { id, data });
      ids.push(id);
      env.newCats.add(name);
    } else { env.ov.cats.add(f); env.ov.catNames.push(name); ids.push(`~${f}`); }
  }
  return { ids };
}

const nameOf = async (ctx, id) => (await D.readContact(ctx, id))?.data.name ?? "?";

/**
 * Une ligne. `write` : écrire pour de bon (sous le verrou, index à jour) ou seulement regarder. Rend { outcome, id?, name, via?, code?, value?, … }.
 * Ne change jamais le nom d'une fiche existante ; ne remplit que les champs vides ; n'ajoute que ce qui manque (compte, catégorie, note).
 */
async function evaluate(ctx, idx, inp, write, env) {
  const name = inp.name;
  const fail = (error) => ({ outcome: "error", name, ...error });
  const keys = rowKeys(inp);
  // 1. Trouver la fiche qui existe déjà : son id, un de ses comptes, son e-mail, ou (sans e-mail) le même nom dans la même organisation.
  let target = null, virtual = null;
  // (l'identifiant d'une colonne « id » ne compte que si le nom est le même : un fichier venu d'un autre carnet ne peut pas viser une fiche par hasard)
  if (inp.id && idx.byId.has(inp.id) && kindOfEntry(idx.byId.get(inp.id)) === inp.kind && idx.byId.get(inp.id).n === fold(inp.name)) target = { id: inp.id, via: "id" };
  if (!target) {
    const owners = [...new Set(inp.accounts.map((a) => idx.byAccount.get(N.accountKey(a.network, a.handle))).filter(Boolean))];
    if (owners.length > 1) return fail({ code: "accounts_two", a: await nameOf(ctx, owners[0]), b: await nameOf(ctx, owners[1]) });
    if (owners.length === 1) target = { id: owners[0], via: "account" };
  }
  if (!target && inp.email) {
    const r = await B.byEmail(ctx, idx, inp.email);
    if (r) { if (D.kindOf(r.data) !== inp.kind) return fail({ code: "email_kind", value: inp.email, a: r.data.name }); target = { id: r.id, via: "email" }; }
  }
  if (!target) {
    // Même nom : une organisation, c'est toujours la même ; une personne seulement dans la même organisation, et sans e-mail différent (deux personnes
    // de même nom peuvent exister : un e-mail déjà sur la fiche, ou une autre organisation, les distingue).
    const hit = inp.kind === "org" ? idx.orgByName.get(fold(inp.name)) : env.names.get(`n:person:${fold(inp.name)}\u0001${fold(inp.organisation)}`);
    if (hit) {
      if (inp.kind === "person" && inp.email) { const cand = await D.readContact(ctx, hit); if (cand && !cand.data.email && !env.ov?.applied.get(hit)?.has("f:email")) target = { id: hit, via: "name" }; } else target = { id: hit, via: "name" };
    }
  }
  if (!target && !write) {
    // Une fiche « à créer » plus haut dans le fichier : même compte, même e-mail, même organisation de même nom ; une personne de même nom seulement si l'une des deux n'a pas d'e-mail.
    for (const k of keys) {
      const l = env.ov.keys.get(k);
      if (l && (!k.startsWith("n:person:") || !inp.email || env.ov.bare.has(k))) { virtual = l; if (k.startsWith("n:person:") && inp.email) env.ov.bare.delete(k); break; }
    }
  }

  // 2. Les catégories.
  const cats = await categoriesFor(ctx, idx, inp.categories, write, env);
  if (cats.error) return fail(cats.error);

  // 3a. Une fiche rangée plus haut dans le même fichier (aperçu seulement) : rattachée si la ligne apporte un compte nouveau.
  if (virtual !== null) {
    const fresh = inp.accounts.some((a) => !env.ov.keys.has(N.accountKey(a.network, a.handle))) || (inp.email && !env.ov.keys.has(`e:${inp.email}`));
    for (const k of keys) if (!env.ov.keys.has(k)) env.ov.keys.set(k, virtual);
    return { outcome: fresh ? "linked" : "skipped", name, via: "file", sameAs: typeof virtual === "number" ? virtual : undefined };
  }

  // 3b. Une fiche du carnet : on lui ajoute ce qui manque. `toks` : une étiquette par chose ajoutée (l'aperçu s'en sert pour ne pas compter deux fois la même).
  if (target) {
    const rec = await D.readContact(ctx, target.id);
    if (!rec) return fail({ code: "vanished" });
    const d = { ...rec.data };
    const toks = [];
    const kept = []; // ce que la ligne dit autrement que la fiche : la fiche garde sa valeur (jamais écrasée), mais on le fait savoir
    for (const f of ["role", "phone", "relation", "others", "photo"]) {
      if (!inp[f]) continue;
      if (!d[f]) { d[f] = inp[f]; toks.push(`f:${f}`); } else if (d[f] !== inp[f]) kept.push(f);
    }
    if (inp.email && inp.email !== d.email) {
      const other = await B.byEmail(ctx, idx, inp.email);
      if (other && other.id !== target.id) return fail({ code: "email_elsewhere", value: inp.email, a: other.data.name });
      if (!d.email) { d.email = inp.email; toks.push("f:email"); } else kept.push("email");
    }
    if (inp.kind === "person" && !d.orgId && inp.organisation) {
      const known = idx.orgByName.get(fold(inp.organisation));
      if (!known && B.isFull(ctx, idx, 1 + (write ? 0 : env.ov.virtual))) return fail({ code: "too_many" });
      if (known) d.orgId = known; else if (write) d.orgId = await B.orgFor(ctx, idx, inp.organisation); else env.ov.orgs.add(fold(inp.organisation));
      toks.push("f:organisation");
    }
    const had = new Set(B.accountsOf(d).map((x) => N.accountKey(x.network, x.handle)));
    for (const a of inp.accounts) {
      const r = B.attach(idx, target.id, d, a);
      if (r.fullAccounts) return fail({ code: "too_many_accounts", value: String(D.LIMITS.accountsPerContact) });
      if (r.taken) return fail({ code: "account_elsewhere", value: `${a.network}:${a.handle}`, a: await nameOf(ctx, r.taken) });
      const k = N.accountKey(a.network, a.handle);
      if (!had.has(k)) toks.push(`a:${k}`);
    }
    const have = B.liveCategoryIds(idx, d.categoryIds ?? []);
    const add = cats.ids.filter((c) => !have.includes(c));
    if (add.length) {
      if (have.length + add.length > D.LIMITS.categoriesPerContact) return fail({ code: "too_many_categories", value: String(D.LIMITS.categoriesPerContact) });
      d.categoryIds = [...have, ...add];
      for (const c of add) toks.push(`c:${c}`);
    }
    const author = (n) => N.clean(n.author || inp.source || "import", 60) || "import";
    const noteKey = (n) => `${author(n)}\u0001${N.clean(n.text, C.NOTE_MAX, true)}`;
    let newNotes = [];
    if (inp.notes.length) {
      const seen = await existingNotes(ctx, target.id);
      newNotes = inp.notes.filter((n) => !seen.has(noteKey(n)));
      for (const n of newNotes) toks.push(`n:${noteKey(n)}`);
    }
    let fresh = toks;
    if (!write) {
      const applied = env.ov.applied.get(target.id) ?? new Set();
      fresh = toks.filter((t) => !applied.has(t));
      toks.forEach((t) => applied.add(t));
      env.ov.applied.set(target.id, applied);
    }
    if (!fresh.length) return { outcome: "skipped", name: rec.data.name, id: target.id, via: target.via, ...(kept.length ? { kept } : {}) };
    if (write) {
      if (toks.some((t) => !t.startsWith("n:"))) await B.save(ctx, idx, rec, d);
      for (const n of newNotes) await ctx.api.store.add("notes", { contactId: target.id, date: n.date ?? today(), author: author(n), text: N.clean(n.text, C.NOTE_MAX, true) }, { key: target.id });
    }
    return { outcome: "linked", name: rec.data.name, id: target.id, via: target.via, changes: [...new Set(fresh.map((t) => t.slice(0, t.indexOf(":"))))], ...(kept.length ? { kept } : {}) };
  }

  // 4. Une nouvelle fiche.
  const orgText = inp.kind === "person" ? inp.organisation : "";
  const newOrg = !!orgText && !idx.orgByName.has(fold(orgText)) && !(!write && env.ov.orgs.has(fold(orgText)));
  if (B.isFull(ctx, idx, 1 + (newOrg ? 1 : 0) + (write ? 0 : env.ov.virtual))) return fail({ code: "too_many" });
  if (inp.accounts.length > C.MAX_ACCOUNTS) return fail({ code: "too_many_accounts", value: String(C.MAX_ACCOUNTS) });
  if (!write) {
    env.ov.virtual += 1 + (newOrg ? 1 : 0);
    if (orgText) { env.ov.orgs.add(fold(orgText)); if (newOrg) env.ov.keys.set(`n:org:${fold(orgText)}\u0001`, "org"); }
    if (inp.kind === "org") env.ov.orgs.add(fold(name));
    for (const k of keys) if (!env.ov.keys.has(k)) env.ov.keys.set(k, inp.line ?? 0);
    if (inp.kind === "person" && !inp.email) env.ov.bare.add(`n:person:${fold(inp.name)}\u0001${fold(inp.organisation)}`);
    return { outcome: "created", name };
  }
  const source = inp.source ?? "import";
  const data = { ...B.blankContact({ kind: inp.kind, name, status: inp.status, source }), email: inp.email, role: inp.role, phone: inp.phone, others: inp.others, relation: inp.relation, photo: inp.photo ?? null };
  if (inp.kind === "person") data.orgId = await B.orgFor(ctx, idx, orgText);
  for (const a of inp.accounts) B.attach(idx, null, data, a);
  data.categoryIds = cats.ids.slice(0, D.LIMITS.categoriesPerContact);
  const rec = await B.insert(ctx, idx, data);
  if (inp.kind === "person") env.names.set(`n:person:${fold(name)}\u0001${fold(orgText)}`, rec.id);
  for (const n of inp.notes) await ctx.api.store.add("notes", { contactId: rec.id, date: n.date ?? today(), author: N.clean(n.author || source, 60) || "import", text: N.clean(n.text, C.NOTE_MAX, true) }, { key: rec.id });
  return { outcome: "created", name, id: rec.id };
}

// ── 3. Avancer, paquet par paquet ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const LOGKEEP = ["code", "value", "network", "a", "b", "width", "sameAs", "via", "changes", "kept"];
function logEntry(line, res, staged) {
  const e = { line, name: String(res.name ?? "").slice(0, 80) };
  if (res.id) e.id = res.id;
  for (const k of LOGKEEP) if (res[k] !== undefined) e[k] = res[k];
  if (res.outcome === "error") {
    if (staged?.raw) e.raw = staged.raw;
    else if (staged?.input) e.input = staged.input;
  }
  return e;
}
async function flushLogs(ctx, job, pending) {
  const store = ctx.api.store;
  for (const [outcome, entries] of Object.entries(pending)) {
    if (!entries.length) continue;
    const slot = (job.data.logs[outcome] ??= { n: 0, tail: null, tailN: 0 });
    const room = LOG_CAP[outcome] - slot.n;
    let list = entries.slice(0, Math.max(0, room));
    slot.n += list.length;
    while (list.length) {
      if (slot.tail && slot.tailN < LOG_CHUNK) {
        const take = list.slice(0, LOG_CHUNK - slot.tailN);
        const doc = await store.get(slot.tail);
        await store.update(slot.tail, { items: [...(doc?.data?.items ?? []), ...take] }, { key: `${job.id}:${outcome}` });
        slot.tailN += take.length; list = list.slice(take.length);
      } else {
        const take = list.slice(0, LOG_CHUNK);
        slot.tail = await store.add("importLog", { items: take }, { key: `${job.id}:${outcome}` });
        slot.tailN = take.length; list = list.slice(take.length);
      }
    }
  }
}
async function resetLogs(ctx, job) {
  const store = ctx.api.store;
  for (const o of OUTCOMES) {
    for (let g = 0; g < 100; g++) {
      const p = await store.page("importLog", { key: `${job.id}:${o}`, limit: 200, order: "asc" });
      if (!(p.items ?? []).length) break;
      for (const it of p.items) await store.remove(it.id);
    }
  }
  job.data.logs = {};
}

/**
 * Un pas de l'aperçu (`mode: "preview"`) ou de l'import (`mode: "run"`), au plus `budgetMs`. Rend le document à jour ; `state` dit où on en est :
 * staged → previewing → previewed → running → done. Peut être rappelé autant de fois que nécessaire : il repart de la position notée.
 */
export async function step(ctx, mode, { budgetMs = stepMs(ctx) } = {}) {
  const me = ctx.instance?.id ?? "?";
  const since = WORKING.get(me);
  if (since && Date.now() - since < 60_000) return { ok: false, error: "working" }; // un autre onglet travaille déjà sur cet import
  WORKING.set(me, Date.now());
  const ctl = { dead: false }; // si le stockage ne répond plus, ce pas est abandonné : il ne touchera plus à rien s'il se réveille
  try { return await D.within(stepInner(ctx, mode, budgetMs, ctl), opt(ctx, "importHardMs", budgetMs + 20_000), "import step"); }
  catch (e) { ctl.dead = true; if (e?.code === "busy") return { ok: false, error: "busy" }; throw e; }
  finally { WORKING.delete(me); }
}
const WORKING = new Map();
async function stepInner(ctx, mode, budgetMs, ctl) {
  const job = await getJob(ctx);
  if (!job) return { ok: false, error: "no_job" };
  const store = ctx.api.store;
  const d = job.data;
  const write = mode === "run";
  if (d.state === "staging") return { ok: false, error: "incomplete" };
  if (write ? !["previewed", "running"].includes(d.state) : !["staged", "previewing"].includes(d.state)) return { ok: true, job };
  const starting = write ? d.state === "previewed" : d.state === "staged";
  if (starting) {
    if (write) d.previewCounts = { ...d.counts };
    d.state = write ? "running" : "previewing";
    d.p = { cursor: null, offset: 0, done: false }; d.processed = 0; d.counts = { created: 0, linked: 0, skipped: 0, error: 0 };
    await resetLogs(ctx, job);
    if (!write) d.newCategories = [];
  }
  // Un aperçu qui a perdu sa mémoire (redémarrage du site, attente de plus de 30 minutes) repart du début : il est rapide et ne touche à rien.
  const had = OVERLAYS.has(overlayKey(ctx, job));
  const ov = write ? null : overlayFor(overlayKey(ctx, job));
  if (!write && !starting && !had && d.processed > 0) {
    d.p = { cursor: null, offset: 0, done: false }; d.processed = 0; d.counts = { created: 0, linked: 0, skipped: 0, error: 0 };
    await resetLogs(ctx, job);
  }
  const t0 = Date.now();
  const env = { ov, names: null, newCats: new Set() };
  const pending = { created: [], linked: [], skipped: [], error: [] };
  const persist = async () => { if (ctl.dead) return; if (ov) d.newCategories = ov.catNames.slice(0, 500); await flushLogs(ctx, job, pending); for (const k of OUTCOMES) pending[k] = []; d.updatedAt = Date.now(); await saveJob(ctx, job); };
  try {
    let progressed = false; // au moins un lot par pas, même si le temps est déjà écoulé : un pas fait toujours avancer
    while (!d.p.done && !ctl.dead && (!progressed || Date.now() - t0 < budgetMs)) {
      const page = await store.page("importRows", { key: job.id, order: "asc", limit: 1, cursor: d.p.cursor });
      const chunk = page.items?.[0];
      if (!chunk) { d.p.done = true; break; }
      const rows = chunk.data.rows ?? [];
      while (d.p.offset < rows.length && !ctl.dead && (!progressed || Date.now() - t0 < budgetMs)) {
        const slice = rows.slice(d.p.offset, d.p.offset + lockRows(ctx));
        const run = async () => {
          const idx = await D.getIndex(ctx);
          env.names ??= nameTable(idx); // une seule fois par pas : la table suit les créations du pas
          for (const staged of slice) {
            let res;
            if (staged.error) res = { outcome: "error", name: String(staged.raw?.[d.map?.name] ?? "").slice(0, 80), ...staged.error };
            else res = await evaluate(ctx, idx, { ...staged.input, line: staged.line }, write, env);
            d.counts[res.outcome]++; d.processed++;
            pending[res.outcome].push(logEntry(staged.line, res, staged));
          }
        };
        if (write) await D.withLock(ctx, run); else await run();
        d.p.offset += slice.length;
        progressed = true;
        await persist();
      }
      if (d.p.offset >= rows.length) { d.p = page.next ? { cursor: page.next, offset: 0, done: false } : { cursor: null, offset: 0, done: true }; await persist(); }
    }
  } finally {
    if (write) env.newCats.forEach((c) => { if (!d.newCategories.includes(c) && d.newCategories.length < 500) d.newCategories.push(c); });
  }
  if (ctl.dead) return { ok: false, error: "busy" };
  if (d.p.done) {
    d.state = write ? "done" : "previewed";
    d.updatedAt = Date.now();
    await persist();
    if (write) await purge(ctx, job, { budgetMs: 4000 });
  } else await persist();
  return { ok: true, job: (await getJob(ctx)) ?? job };
}

/** Une page du journal (50 lignes au plus par appel de l'écran : un document = 100 entrées). */
export async function logPage(ctx, outcome, cursor) {
  const job = await getJob(ctx);
  if (!job || !OUTCOMES.includes(outcome)) return { items: [], next: null };
  const p = await ctx.api.store.page("importLog", { key: `${job.id}:${outcome}`, order: "asc", limit: 1, cursor: cursor || null });
  return { items: p.items?.[0]?.data?.items ?? [], next: p.next ?? null };
}
/** Toutes les lignes en erreur gardées (pour le rapport à télécharger), une page à la fois. */
export async function* errorEntries(ctx) {
  const job = await getJob(ctx);
  if (!job) return;
  let cursor = null;
  do {
    const p = await ctx.api.store.page("importLog", { key: `${job.id}:error`, order: "asc", limit: 10, cursor });
    for (const doc of p.items ?? []) for (const e of doc.data?.items ?? []) yield e;
    cursor = p.next ?? null;
  } while (cursor);
}
