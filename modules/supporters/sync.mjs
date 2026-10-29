// Soutiens — faire entrer les soutiens : actualisation demandée à la plateforme (« pull »), notification entrante (« push »), fichier importé. Les trois aboutissent aux mêmes documents.
// Règles communes :
//   - rien ne devient public par ici : un nouveau soutien est TOUJOURS caché et sans accord ;
//   - jamais de montant, jamais d'adresse e-mail gardée (l'adresse d'une notification ne sert qu'à fabriquer une empreinte irréversible, puis est oubliée) ;
//   - jamais de minuteur de fond : une actualisation n'a lieu que si quelqu'un la demande (administration) ou ouvre la page publique, au plus une fois par `cacheMinutes`, et jamais deux en même temps ;
//   - un échec garde les données connues et se souvient du motif (pour le dire en mots simples).
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const P = await import(`./pure.mjs${v}`);
const D = await import(`./data.mjs${v}`);
const R = await import(`./providers.mjs${v}`);
const { LIMITS, clean, fold, int, dayOf, hmacHex } = P;

/** Le fournisseur propre à ce soutien (un fichier importé dans une instance « Patreon » reste un soutien « fichier »). */
export const providerOfPerson = (ctx, p) => R.PROVIDERS[p?.provider] ?? R.providerOf(ctx);
const expiresOf = (p) => !!R.PROVIDERS[p?.provider]?.expires;

export const timing = { failBackoffMs: 10 * 60_000, runMs: 30_000 };
const inflight = new Map(); // instance → promesse de l'actualisation en cours

const slug = (s) => fold(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "x";
const today = () => dayOf(Date.now());

/** Les réglages de durée, bornés. */
export const knobs = (ctx) => ({
  activeDays: int(ctx.setting("activeDays"), 40, 7, 400),
  keepDays: int(ctx.setting("keepDays"), 365, 30, 1100),
  cacheMs: int(ctx.setting("cacheMinutes"), 360, 15, 1440) * 60_000,
});

export function within(p, ms, fallback) {
  let t;
  return Promise.race([Promise.resolve(p).catch(() => fallback), new Promise((r) => { t = setTimeout(() => r(fallback), ms); })]).finally(() => clearTimeout(t));
}

/** Écrit la personne si elle a changé. */
async function put(ctx, snap, rec, next) {
  if (JSON.stringify(rec.data) === JSON.stringify(next)) return false;
  rec.data = next;
  const r = await D.savePerson(ctx, snap, rec);
  return r.ok;
}

/* ───────────── Pull : la liste complète demandée à la plateforme ───────────── */

async function applyPull(ctx, provider, res) {
  const { keepDays, activeDays } = knobs(ctx);
  return D.withLock(ctx, async () => {
    const snap = await D.snapshot(ctx, { fresh: true });
    for (const t of res.tiers) await D.upsertTier(ctx, snap, t);
    const seen = new Set();
    const out = { added: 0, updated: 0, ended: 0, full: false };
    for (const p of res.people) {
      seen.add(p.k);
      const old = snap.people.get(p.k);
      const base = old ? { ...old.data } : D.blankPerson(p.k, provider.id);
      if (!base.contactId) base.name = p.name;
      base.tiers = p.tiers;
      base.since = p.since ?? base.since;
      base.status = p.active ? "active" : "ended";
      if (p.active) base.last = today();
      if (old) { if (await put(ctx, snap, old, base)) out.updated++; continue; }
      if (!p.active) continue;   // une personne qui ne soutient plus et qu'on n'a jamais connue n'a rien à faire ici : on ne garde que le nécessaire
      const rec = { id: null, data: base };
      const r = await D.savePerson(ctx, snap, rec);
      if (r.ok) out.added++; else out.full = true;
    }
    // Quelqu'un qui n'est plus dans la liste COMPLÈTE n'est plus un soutien actif. Liste incomplète (trop de membres, panne en route) : on ne déclare personne arrêté à tort.
    if (res.complete) for (const rec of snap.people.values()) if (rec.data.provider === provider.id && rec.data.status === "active" && !seen.has(rec.data.k)) { if (await put(ctx, snap, rec, { ...rec.data, status: "ended", tiers: [] })) out.ended++; }
    out.purged = await D.purge(ctx, snap, { keepDays, activeDays, expiresOf });
    await D.patchState(ctx, { syncedAt: Date.now(), triedAt: Date.now(), syncCode: res.complete ? "ok" : "partial", syncCount: res.people.length });
    return out;
  });
}

/**
 * Actualise depuis la plateforme (mode « pull » seulement). `force` : la propriétaire l'a demandé (on ignore le délai de repos, pas la pause après un échec récent).
 * Rend { ok: true, cached?, added, updated, ended, count } ou { ok: false, code } avec code ∈ "no_token" · "token" · "scope" · "none" · "busy" · "unreachable" · "unreadable" · "blocked" · "not_pull".
 */
export async function refresh(ctx, { force = false } = {}) {
  const provider = R.providerOf(ctx);
  if (provider.mode !== "pull") return { ok: false, code: "not_pull" };
  const token = clean(ctx.setting("accessToken"), 600);
  if (!token) return { ok: false, code: "no_token" };
  const { cacheMs } = knobs(ctx);
  const snap = await D.snapshot(ctx);
  const st = D.stateOf(snap), now = Date.now();
  const good = ["ok", "partial"].includes(st.syncCode);
  if (!force && good && st.syncedAt && now - st.syncedAt < cacheMs) return { ok: true, cached: true, count: st.syncCount ?? 0 };
  if (!force && st.syncCode && !good && st.triedAt && now - st.triedAt < timing.failBackoffMs) return { ok: false, code: st.syncCode, cached: true };
  const id = ctx.instance.id;
  let run = inflight.get(id);
  if (!run) {
    run = within((async () => {
      const res = await provider.pull(ctx, token);
      if (!res.ok) {
        await D.withLock(ctx, async () => { await D.patchState(ctx, { triedAt: Date.now(), syncCode: res.code }); });
        return { ok: false, code: res.code };
      }
      const out = await applyPull(ctx, provider, res);
      return { ok: true, ...out, count: res.people.length, partial: res.complete ? undefined : true };
    })(), timing.runMs, { ok: false, code: "unreachable" }).finally(() => { if (inflight.get(id) === run) inflight.delete(id); });
    inflight.set(id, run);
  }
  return run;
}

/**
 * Appelé à l'ouverture de la page publique : si les données sont vieilles, lance une actualisation SANS l'attendre (le visiteur n'attend jamais la plateforme).
 * Aucun minuteur : c'est la visite qui déclenche, au plus une fois par `cacheMinutes`.
 */
export function ensureFresh(ctx) {
  try {
    const provider = R.providerOf(ctx);
    if (provider.mode !== "pull" || !clean(ctx.setting("accessToken"), 600)) return;
    refresh(ctx).catch(() => {});
  } catch { /* jamais d'erreur vers la page */ }
}

/* ───────────── Push : une notification de la plateforme ───────────── */

/** Applique un événement déjà vérifié et nettoyé (voir routes.mjs). Rend { ok: true, dup? } ou { ok: false, code }. */
export async function applyEvent(ctx, provider, ev) {
  const { keepDays, activeDays } = knobs(ctx);
  return D.withLock(ctx, async () => {
    const snap = await D.snapshot(ctx, { fresh: true });
    const secret = await D.secretOf(ctx);
    const st = D.stateOf(await D.snapshot(ctx, { fresh: true }));
    const seen = Array.isArray(st.seen) ? st.seen : [];
    if (seen.includes(ev.id)) return { ok: true, dup: true };
    const k = `${provider.id}:${hmacHex(secret, `${provider.id}|${ev.identity}`).slice(0, 20)}`;
    const tierKey = ev.tierName ? `${provider.id}:t:${slug(ev.tierName)}` : null;
    if (tierKey) await D.upsertTier(ctx, snap, { k: tierKey, name: ev.tierName });
    const old = snap.people.get(k);
    const base = old ? { ...old.data } : D.blankPerson(k, provider.id);
    if (!base.contactId) base.name = ev.name;
    base.status = "active";
    base.last = today();
    base.since = base.since ?? ev.at ?? today();
    if (tierKey) base.tiers = [tierKey, ...base.tiers.filter((t) => t !== tierKey)].slice(0, LIMITS.tiersPerPerson);
    if (old) await put(ctx, snap, old, base);
    else { const r = await D.savePerson(ctx, snap, { id: null, data: base }); if (!r.ok) return { ok: false, code: "full" }; }
    await D.purge(ctx, snap, { keepDays, activeDays, expiresOf });
    await D.patchState(ctx, { eventAt: Date.now(), seen: [ev.id, ...seen].slice(0, LIMITS.seen) });
    return { ok: true };
  });
}

/* ───────────── Fichier : une liste importée ───────────── */

/**
 * Importe les lignes d'un fichier (voir providers.parseRows). `replace` : ceux du fichier ET déjà connus par fichier mais absents du nouveau passent à « arrêté ».
 * Rend { ok: true, added, updated, ended, full }.
 */
export async function applyRows(ctx, provider, rows, { replace = false } = {}) {
  const { keepDays, activeDays } = knobs(ctx);
  return D.withLock(ctx, async () => {
    const snap = await D.snapshot(ctx, { fresh: true });
    const secret = await D.secretOf(ctx);
    const out = { added: 0, updated: 0, ended: 0, full: false };
    const seen = new Set();
    for (const row of rows) {
      const k = `${provider.id}:${hmacHex(secret, `${provider.id}|${row.identity}`).slice(0, 20)}`;
      seen.add(k);
      const tierKey = row.tierName ? `${provider.id}:t:${slug(row.tierName)}` : null;
      if (tierKey) await D.upsertTier(ctx, snap, { k: tierKey, name: row.tierName });
      const old = snap.people.get(k);
      const base = old ? { ...old.data } : D.blankPerson(k, provider.id);
      if (!base.contactId) base.name = row.name;
      base.status = row.active ? "active" : "ended";
      if (row.active) base.last = today();
      base.since = row.since ?? base.since;
      base.tiers = row.active && tierKey ? [tierKey] : row.active ? base.tiers : [];
      if (old) { if (await put(ctx, snap, old, base)) out.updated++; continue; }
      if (!row.active) continue;   // une ligne « arrêté » pour une personne inconnue : rien à garder
      const r = await D.savePerson(ctx, snap, { id: null, data: base });
      if (r.ok) out.added++; else out.full = true;
    }
    if (replace) for (const rec of snap.people.values()) if (rec.data.provider === provider.id && rec.data.status === "active" && !seen.has(rec.data.k)) { if (await put(ctx, snap, rec, { ...rec.data, status: "ended", tiers: [] })) out.ended++; }
    out.purged = await D.purge(ctx, snap, { keepDays, activeDays, expiresOf });
    await D.patchState(ctx, { syncedAt: Date.now(), triedAt: Date.now(), syncCode: "ok", syncCount: rows.length });
    return { ok: true, ...out };
  });
}

/* ───────────── Résumé (administration, assistant) ───────────── */

export function summary(ctx, snap) {
  const { activeDays } = knobs(ctx);
  const c = { total: snap.people.size, active: 0, ended: 0, filed: 0, unfiled: 0, waiting: 0, pending: 0, approved: 0, shown: 0 };
  for (const { data: p } of snap.people.values()) {
    const active = P.isActive(p, providerOfPerson(ctx, p), activeDays);
    if (active) c.active++; else c.ended++;
    if (p.contactId) c.filed++; else c.unfiled++;
    const cs = P.consentState(p);
    if (cs === "pending") c.pending++;
    if (cs === "approved") c.approved++;
    if (cs === "none" && active) c.waiting++;
    if (P.isShown(p, providerOfPerson(ctx, p), activeDays)) c.shown++;
  }
  return c;
}
