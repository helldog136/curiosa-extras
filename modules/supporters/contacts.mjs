// Soutiens — le pont FACULTATIF vers Contacts (service `contact.book` v2, plus `contact.curate` pour retirer d'une catégorie). Contacts possède les personnes : ce module n'en copie rien,
// il y RANGE les soutiens (une fiche par soutien, retrouvée par son « compte » `plateforme:numéro`, donc jamais en double), dans une catégorie CHOISIE par la propriétaire.
// Règles :
//   - ÉCRIRE dans Contacts (créer une fiche, l'ajouter à une catégorie) exige le droit `contacts.file`, vérifié par le cœur sur l'action d'administration ; jamais depuis une page publique ni une notification ;
//   - RETIRER une personne de la catégorie du mur des remerciements est une protection : permis à tout moment (retrait d'accord, pseudo refusé, soutien caché) ;
//   - chaque appel est BORNÉ (aucune attente sans fin) et ne lève rien ; sans Contacts, tout continue (les noms restent gardés ici, jusqu'au rangement).
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const P = await import(`./pure.mjs${v}`);
const D = await import(`./data.mjs${v}`);
const { LIMITS, clean, fold, idOk } = P;

export const SERVICE = "contact.book", CURATE = "contact.curate";
export const SOURCE = "supporters";
export const timing = { callMs: 4000, providersMs: 1500, resolveMs: 3500 };

const SLOW = Symbol("slow");
export const within = (p, ms, fallback = SLOW) => { let t; return Promise.race([Promise.resolve(p).catch(() => fallback), new Promise((r) => { t = setTimeout(() => r(fallback), ms); t.unref?.(); })]).finally(() => clearTimeout(t)); };

export async function providers(ctx, service = SERVICE) {
  const list = await within(Promise.resolve().then(() => ctx.api.services.providers(service)), timing.providersMs, null);
  return Array.isArray(list) ? list : [];
}
export const hasBook = async (ctx) => (await providers(ctx)).length > 0;

/** Un appel à un service de Contacts. Rend { ok: true, value } ou { ok: false, why } : "absent" · "slow" · "failed" ou le code d'erreur de Contacts ("not_found", "too_many"…). */
export async function call(ctx, method, args, { service = SERVICE, ms = timing.callMs } = {}) {
  const r = await within(Promise.resolve().then(() => ctx.api.services.call(service, method, args)), ms, SLOW);
  if (r === SLOW) return { ok: false, why: "slow" };
  if (!r || typeof r !== "object" || r.ok !== true) return { ok: false, why: r?.reason === "unavailable" || r?.reason === "undeclared" ? "absent" : "failed" };
  const value = r.value;
  if (!value || typeof value !== "object" || value.ok !== true) { const code = value?.["error"]; return { ok: false, why: typeof code === "string" ? code : "failed" }; }
  return { ok: true, value };
}

/**
 * La catégorie choisie dans un réglage `choice` (« category » ou « wallCategory »). Rend { state: "ok", id, label } · { state: "none" | "choose" | "gone" | "unverified" | "absent" }.
 * Une catégorie « unique » proposée d'office par le cœur (`only`) N'EST PAS prise : un soutien ne se range pas dans une catégorie sans que la propriétaire l'ait choisie.
 * Valeur de départ neutre : si rien n'est choisi, une catégorie qui s'appelle comme `defaultName` (« Soutiens » / « Supporters ») est utilisée si elle existe.
 */
export async function categoryOf(ctx, key, defaultNames = []) {
  if (!(await hasBook(ctx))) return { state: "absent" };
  const r = typeof ctx.resolveChoice === "function" ? await within(ctx.resolveChoice(key), 3500, { status: "unverified" }) : { status: "unverified" };
  const res = r && typeof r === "object" ? r : { status: "unverified" };
  if (res.status === "chosen" && idOk(res.id)) return { state: "ok", id: res.id, label: clean(res.label, 100) };
  if (res.status === "unverified") return { state: "unverified" };
  if (res.status === "missing" && ctx.setting(key)) return { state: "gone" };
  // Rien de choisi : la catégorie au nom de départ, si elle existe.
  for (const name of defaultNames) {
    const f = await call(ctx, "categories", { q: name, limit: 20 });
    if (!f.ok) return { state: f.why === "absent" ? "absent" : "unverified" };
    const hit = (Array.isArray(f.value.items) ? f.value.items : []).find((k) => idOk(k?.id) && fold(k.label ?? k.name) === fold(name));
    if (hit) return { state: "ok", id: hit.id, label: clean(hit.label ?? hit.name, 100), byName: true };
  }
  return { state: res.status === "ambiguous" || res.status === "only" ? "choose" : "none" };
}

/** Les noms de fiche pour des identifiants (par paquets de 100) : Map(id → { name, status }) ; suit les fusions. { state: "ok" | "absent" | "slow" | "failed", names, missing: [id], moved: {ancien: gardé} }. */
export async function cardNames(ctx, ids) {
  const wanted = [...new Set((Array.isArray(ids) ? ids : []).filter(idOk))];
  const names = new Map(), missing = [], moved = {};
  for (let i = 0; i < wanted.length; i += 100) {
    const batch = wanted.slice(i, i + 100);
    const r = await call(ctx, "resolve", { ids: batch }, { ms: timing.resolveMs });
    if (!r.ok) return { state: r.why === "absent" || r.why === "slow" ? r.why : "failed", names, missing, moved };
    const byId = new Map((Array.isArray(r.value.contacts) ? r.value.contacts : []).filter((c) => c && idOk(c.id)).map((c) => [c.id, c]));
    const mv = r.value.moved && typeof r.value.moved === "object" ? r.value.moved : {};
    const extra = [...new Set(Object.values(mv).filter((t) => idOk(t) && !byId.has(t)))].slice(0, 100);
    if (extra.length) { const again = await call(ctx, "resolve", { ids: extra }, { ms: timing.resolveMs }); if (again.ok) for (const c of Array.isArray(again.value.contacts) ? again.value.contacts : []) if (c && idOk(c.id)) byId.set(c.id, c); }
    for (const id of batch) {
      const c = byId.get(id) ?? (idOk(mv[id]) ? byId.get(mv[id]) : undefined);
      if (c) { names.set(id, { name: clean(c.name, LIMITS.name), status: c.status, id: c.id }); if (c.id !== id) moved[id] = c.id; } else missing.push(id);
    }
  }
  return { state: "ok", names, missing, moved };
}

/* ───────────── Ranger les soutiens ───────────── */

/**
 * Range dans Contacts (catégorie `categoryId`) les soutiens ACTIFS pas encore rangés, `LIMITS.fileBatch` au plus. À appeler depuis une action protégée par le droit `contacts.file`.
 * Rend { ok: true, filed, created, existing, left, stopped?: "absent" | "slow" | "full" | "category" | "failed" }.
 */
export async function fileSupporters(ctx, categoryId, { platformLabel = "" } = {}) {
  const snap = await D.snapshot(ctx, { fresh: true });
  const todo = [...snap.people.values()].filter((r) => !r.data.contactId && r.data.status === "active" && clean(r.data.name, LIMITS.name)).slice(0, LIMITS.fileBatch);
  const out = { ok: true, filed: 0, created: 0, existing: 0, left: 0, stopped: null };
  for (const rec of todo) {
    const p = rec.data;
    const r = await call(ctx, "upsertByAccount", { network: "other", handle: p.k, name: p.name, kind: "person", categoryId, source: SOURCE, note: ctx.t("contactNote", { platform: platformLabel || p.provider, since: p.since ?? "—" }) });
    if (!r.ok) { out.stopped = r.why === "absent" || r.why === "slow" ? r.why : r.why === "too_many" ? "full" : r.why === "not_found" ? "category" : "failed"; break; }
    const id = r.value.id;
    if (!idOk(id)) { out.stopped = "failed"; break; }
    await D.withLock(ctx, async () => {
      const fresh = (await D.snapshot(ctx, { fresh: true })).byPid.get(p.pid);
      if (fresh && !fresh.data.contactId) await ctx.api.store.update(fresh.id, { ...fresh.data, contactId: id, name: "" });
    });
    out.filed++;
    if (r.value.created) out.created++; else out.existing++;
  }
  out.left = Math.max(0, [...(await D.snapshot(ctx, { fresh: true })).people.values()].filter((r) => !r.data.contactId && r.data.status === "active" && clean(r.data.name, LIMITS.name)).length);
  return out;
}

/* ───────────── Le lien facultatif avec le mur des remerciements ───────────── */

/** Cette personne doit-elle être dans la catégorie du mur ? Oui seulement si son pseudo approuvé est EXACTEMENT le nom de sa fiche (le mur montre le nom de la fiche). */
export const wallEligible = (person, cardName, shown) => !!shown && !!person.consent?.pseudo && fold(person.consent.pseudo) === fold(cardName);

/** Retire (protection : toujours permis) une personne de la catégorie du mur. Rend true si c'est fait ou inutile. */
export async function wallRemove(ctx, person, wallCategoryId) {
  if (!person.contactId || !idOk(wallCategoryId) || !person.wall) return true;
  const r = await call(ctx, "removeCategory", { id: person.contactId, categoryId: wallCategoryId }, { service: CURATE });
  if (r.ok || r.why === "not_found") return true;
  return false;
}

/**
 * Met la catégorie du mur d'équerre : ajoute (droit `contacts.file` exigé par l'action appelante) les personnes éligibles, retire celles qui ne le sont plus. `shownOf(person)` dit si elle est montrable.
 * Rend { added, removed, stopped? }.
 */
export async function syncWall(ctx, wallCategoryId, shownOf, { allowAdd }) {
  const snap = await D.snapshot(ctx, { fresh: true });
  const filed = [...snap.people.values()].filter((r) => r.data.contactId);
  const out = { added: 0, removed: 0, stopped: null };
  const cards = await cardNames(ctx, filed.map((r) => r.data.contactId));
  if (cards.state !== "ok") { out.stopped = cards.state; return out; }
  let budget = LIMITS.fileBatch;
  for (const rec of filed) {
    if (budget <= 0) break;
    const p = rec.data;
    const card = cards.names.get(p.contactId);
    const eligible = !!card && wallEligible(p, card.name, shownOf(p));
    if (eligible && !p.wall && allowAdd) {
      const r = await call(ctx, "upsertByAccount", { network: "other", handle: p.k, categoryId: wallCategoryId, source: SOURCE });
      if (!r.ok) { out.stopped = r.why; break; }
      await D.withLock(ctx, async () => { const f = (await D.snapshot(ctx, { fresh: true })).byPid.get(p.pid); if (f) await ctx.api.store.update(f.id, { ...f.data, wall: true }); });
      out.added++; budget--;
    } else if (!eligible && p.wall) {
      if (await wallRemove(ctx, p, wallCategoryId)) {
        await D.withLock(ctx, async () => { const f = (await D.snapshot(ctx, { fresh: true })).byPid.get(p.pid); if (f) await ctx.api.store.update(f.id, { ...f.data, wall: false }); });
        out.removed++; budget--;
      } else { out.stopped = "failed"; break; }
    }
  }
  return out;
}

/** Un retrait d'accord, un pseudo changé ou refusé, un soutien caché : la personne quitte la catégorie du mur (protection : toujours permis, jamais d'ajout). Meilleur effort : ne lève jamais. */
export async function protectWall(ctx, person) {
  try {
    if (!person.wall || !person.contactId) return;
    const cat = await categoryOf(ctx, "wallCategory", []);
    if (cat.state !== "ok") return;
    if (await wallRemove(ctx, person, cat.id)) await D.withLock(ctx, async () => { const f = (await D.snapshot(ctx, { fresh: true })).byPid.get(person.pid); if (f) await ctx.api.store.update(f.id, { ...f.data, wall: false }); });
  } catch { /* meilleur effort */ }
}
