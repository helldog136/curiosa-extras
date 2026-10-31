// Participation — la partie « données » : salles, participants, voix, limites, direct, journal, ménage.
// Tout ce qui est gardé est borné (voir LIMITS) ; rien ne tourne en arrière-plan : le ménage se fait à la lecture.
// Un propriétaire par donnée : ici, l'identité (code → participant), le pseudo, la sourdine, les limites et le direct. Les votes, eux, restent chez Sondages.
import { randomBytes } from "node:crypto";

const V = new URL(import.meta.url).search;   // le cœur recharge ce fichier avec ?v=… : les fichiers voisins suivent
const L = await import(`./lib.mjs${V}`);
const { LIMITS } = L;

export const ROOMS = "rooms", LIVE = "live", AUDIT = "audit", META = "meta";
export const DAY = 86_400_000, HOUR = 3_600_000;
export const GENERAL = "general";

/* ───────────── Mémoire du processus : verrou, limiteur, sel du jour (rien n'est écrit sur le disque) ───────────── */

/** Un refus interne : le code de l'erreur (les méthodes du service le rendent en { ok: false, error }). */
export const fail = (code) => ({ error: code });
export const no = (code) => ({ ok: false, error: code });

const chains = (globalThis.__curiosaAudienceLocks ??= new Map());
export async function withLock(ctx, fn) {
  const key = ctx.instance.key;
  const prev = chains.get(key) ?? Promise.resolve();
  let release;
  const gate = new Promise((r) => { release = r; });
  const tail = prev.then(() => gate);
  chains.set(key, tail);
  await prev;
  try { return await fn(); } finally { release(); if (chains.get(key) === tail) chains.delete(key); }
}

export const mem = (globalThis.__curiosaAudienceMem ??= { salt: randomBytes(32), saltAt: Date.now(), hits: new Map(), swept: new Map(), ticks: new Map(), reads: [], roomsAt: 0, roomsView: null });

/** Empreinte de la connexion (sel du jour). */
export function fp(conn, now = Date.now()) {
  if (now - mem.saltAt > DAY) { mem.salt = randomBytes(32); mem.saltAt = now; mem.hits.clear(); }
  return L.connHash(mem.salt, conn);
}
export const connOf = (request) => ({ forwarded: request.headers.get("x-forwarded-for") ?? "", real: request.headers.get("x-real-ip") ?? "" });

export function over(ctx, bucket, max, windowMs, now = Date.now()) { return L.hit(mem.hits, `${ctx.instance.key}|${bucket}`, max, windowMs, now); }

/* ───────────── Accès au stockage ───────────── */

/** Lecture par clé (index du cœur). Repli pour un faux stockage sans clés : parcours borné, jamais utilisé avec le vrai cœur. */
export async function byKey(ctx, collection, key) {
  if (typeof ctx.api.store.getByKey === "function") return ctx.api.store.getByKey(collection, key);
  const rows = await ctx.api.store.list(collection, { limit: 1000 });
  return rows.filter((r) => r.key === key || r.data?.k === key).pop() ?? null;
}
async function listByKey(ctx, collection, key, limit) {
  if (typeof ctx.api.store.listByKey === "function") return (await ctx.api.store.listByKey(collection, key, { limit })).items;
  return (await ctx.api.store.list(collection, { limit: 1000 })).filter((r) => r.key === key || r.data?.k === key).slice(0, limit);
}

export const roomOf = (r) => (r ? { ...r.data, id: r.id } : null);
const pcol = (room) => `p-${room.id}-${room.gen || 0}`;
const ccol = (room) => `c-${room.id}-${room.gen || 0}`;

export const getRoom = async (ctx, key) => roomOf(await byKey(ctx, ROOMS, key));
const saveRoom = async (ctx, room) => { const { id, ...data } = room; await ctx.api.store.update(id, data, { key: data.k }); };

async function getMeta(ctx) {
  const r = await byKey(ctx, META, "cfg");
  return r ? { id: r.id, ...r.data } : null;
}
export async function ensureMeta(ctx) {
  const found = await getMeta(ctx);
  if (found) return found;
  // Sans verrou (appelée aussi depuis les sections verrouillées) : si deux créations se croisent, la plus ancienne gagne.
  const data = { k: "cfg", remoteKey: randomBytes(18).toString("base64url"), garbage: [], sweep: null };
  const id = await ctx.api.store.add(META, data, { key: "cfg" });
  const first = await byKey(ctx, META, "cfg");
  if (first && first.id !== id) { await ctx.api.store.remove(id); return { id: first.id, ...first.data }; }
  return { id, ...data };
}
export const saveMeta = async (ctx, meta) => { const { id, ...data } = meta; await ctx.api.store.update(id, data, { key: "cfg" }); };

/* ───────────── Réglages ───────────── */

export const cfgOf = (ctx) => ({
  min: L.num(ctx.setting("pseudoMin"), 3, 2, 10),
  max: L.num(ctx.setting("pseudoMax"), 20, 8, 30),
  days: L.num(ctx.setting("retentionDays"), 14, 1, 90),
  joinsPerHour: L.num(ctx.setting("joinsPerHour"), 200, 5, 5000),
  banned: L.parseBanned(typeof ctx.setting("bannedWords") === "string" && ctx.setting("bannedWords").trim() ? ctx.setting("bannedWords") : L.STARTER_BANNED),
  directMin: L.num(ctx.setting("directSeconds"), 3, 2, 30) * 1000,
});

/* ───────────── Salles ───────────── */

/** Crée la salle si besoin (au plus 200). Renvoie la salle, ou { error }. */
export async function ensureRoom(ctx, key, label, now = Date.now()) {
  const found = await getRoom(ctx, key);
  if (found) return found;
  return withLock(ctx, async () => {
    const again = await getRoom(ctx, key);
    if (again) return again;
    if ((await ctx.api.store.count(ROOMS)) >= LIMITS.rooms) {
      if (!(await dropOldestRoom(ctx, now))) return fail("too_many_rooms");
    }
    const data = { k: key, label: L.clean(label, LIMITS.label) || key, salt: randomBytes(16).toString("base64url"), gen: 0, count: 0, claims: 0, createdAt: new Date(now).toISOString(), lastAt: new Date(now).toISOString() };
    return { id: await ctx.api.store.add(ROOMS, data, { key }), ...data };
  });
}

/** Retire la salle la moins récemment utilisée si elle est inactive depuis plus d'un jour (sinon la liste est vraiment pleine). */
async function dropOldestRoom(ctx, now) {
  const rooms = (await ctx.api.store.list(ROOMS, { limit: LIMITS.rooms + 20 })).map(roomOf).filter((r) => r.k !== GENERAL).sort((a, b) => String(a.lastAt).localeCompare(String(b.lastAt)));
  const oldest = rooms[0];
  if (!oldest || now - Date.parse(oldest.lastAt) < DAY) return false;
  await retireRoom(ctx, oldest);
  return true;
}

async function retireRoom(ctx, room) {
  const meta = await ensureMeta(ctx);
  const garbage = [...(meta.garbage ?? []), pcol(room), ccol(room)].slice(-60);
  await saveMeta(ctx, { ...meta, garbage });
  await ctx.api.store.remove(room.id);
}

async function touchRoom(ctx, room, patch, now) {
  const stale = !room.lastAt || now - Date.parse(room.lastAt) > 60_000;
  if (!stale && !Object.keys(patch).length) return room;
  const f = await ctx.api.store.get(room.id);
  if (!f) return room;
  const next = { ...f.data, ...patch, lastAt: new Date(now).toISOString() };
  await ctx.api.store.update(room.id, next, { key: next.k });
  return { ...next, id: room.id };
}

/** « Vider la salle » : tout le monde repart de zéro (nouveau sel, plus personne n'est reconnu). Immédiat ; les anciennes données sont effacées par le ménage. */
export async function clearRoom(ctx, key, now = Date.now()) {
  return withLock(ctx, async () => {
    const room = await getRoom(ctx, key);
    if (!room) return no("unknown_room");
    const removed = room.count || 0;
    const meta = await ensureMeta(ctx);
    await saveMeta(ctx, { ...meta, garbage: [...(meta.garbage ?? []), pcol(room), ccol(room)].slice(-60) });
    const { id, ...data } = room;
    await ctx.api.store.update(id, { ...data, gen: (room.gen || 0) + 1, salt: randomBytes(16).toString("base64url"), count: 0, claims: 0, lastAt: new Date(now).toISOString() }, { key: room.k });
    return { ok: true, removed };
  });
}

/* ───────────── Participants ───────────── */

const view = (rec) => ({ id: rec.data.k, pseudo: rec.data.pseudo ?? null, muted: rec.data.muted === true });
export const idOf = (room, token) => L.participantId(room.salt, token);
export const findParticipant = async (ctx, room, token) => byKey(ctx, pcol(room), idOf(room, token));
/** La fiche d'une personne de la salle d'après son identifiant (pas son code). Sert au tirage au sort. */
export const participantById = async (ctx, room, pid) => { const r = await byKey(ctx, pcol(room), pid); return r && !r.data.n ? r : null; };

/**
 * Enregistre (ou retrouve) la personne dans la salle. Renvoie { participant, isNew } ou { error }.
 * Le code du navigateur n'est jamais gardé : seul un identifiant propre à la salle l'est.
 */
export async function joinRoom(ctx, room, token, now = Date.now()) {
  const pid = idOf(room, token);
  const found = await byKey(ctx, pcol(room), pid);
  if (found) {
    if (now - Date.parse(found.data.last || 0) > 5 * 60_000) await withLock(ctx, async () => { const f = await ctx.api.store.get(found.id); if (f) await ctx.api.store.update(found.id, { ...f.data, last: new Date(now).toISOString() }, { key: pid }); });
    return { participant: view(found), isNew: false };
  }
  return withLock(ctx, async () => {
    const again = await byKey(ctx, pcol(room), pid);
    if (again) return { participant: view(again), isNew: false };
    const fresh = await getRoom(ctx, room.k);
    if (!fresh || fresh.gen !== room.gen) return fail("busy");
    if ((fresh.count || 0) >= LIMITS.participants) return fail("room_full");
    const iso = new Date(now).toISOString();
    const id = await ctx.api.store.add(pcol(fresh), { k: pid, pseudo: null, pk: null, muted: false, at: iso, last: iso }, { key: pid });
    const first = await byKey(ctx, pcol(fresh), pid);
    if (first && first.id !== id) { await ctx.api.store.remove(id); return { participant: view(first), isNew: false }; }
    await touchRoom(ctx, fresh, { count: (fresh.count || 0) + 1 }, now);
    return { participant: { id: pid, pseudo: null, muted: false }, isNew: true };
  });
}

/** Choisit (ou change) le pseudo. Unique dans la salle, sans tenir compte des accents, majuscules et chiffres pour lettres. */
export async function choosePseudo(ctx, room, token, raw, cfg, now = Date.now()) {
  const v = L.validatePseudo(raw, { min: cfg.min, max: cfg.max, banned: cfg.banned });
  if (!v.ok) return fail(v.code);
  const pid = idOf(room, token);
  return withLock(ctx, async () => {
    const rec = await byKey(ctx, pcol(room), pid);
    if (!rec) return fail("unknown_participant");
    if (rec.data.muted) return fail("muted");
    if (rec.data.pk === v.key) { await ctx.api.store.update(rec.id, { ...rec.data, pseudo: v.value, last: new Date(now).toISOString() }, { key: pid }); return { participant: { id: pid, pseudo: v.value, muted: false } }; }
    const taken = await byKey(ctx, pcol(room), `n:${v.key}`);
    if (taken && taken.data.id !== pid) return fail("pseudo_taken");
    const nameId = await ctx.api.store.add(pcol(room), { k: `n:${v.key}`, n: true, id: pid }, { key: `n:${v.key}` });
    const first = await byKey(ctx, pcol(room), `n:${v.key}`);
    if (first && first.id !== nameId) { await ctx.api.store.remove(nameId); return fail("pseudo_taken"); }
    if (rec.data.pk) { const old = await byKey(ctx, pcol(room), `n:${rec.data.pk}`); if (old && old.data.id === pid) await ctx.api.store.remove(old.id); }
    await ctx.api.store.update(rec.id, { ...rec.data, pseudo: v.value, pk: v.key, last: new Date(now).toISOString() }, { key: pid });
    return { participant: { id: pid, pseudo: v.value, muted: false } };
  });
}

/** Sourdine : la personne reste dans la salle, mais ne peut plus ni voter, ni changer de pseudo, ni être comptée. Par identifiant ou par pseudo. */
export async function setMuted(ctx, room, who, muted) {
  return withLock(ctx, async () => {
    let rec = null;
    if (who.id && /^[0-9a-f]{40}$/.test(who.id)) rec = await byKey(ctx, pcol(room), who.id);
    else if (who.pseudo) {
      const pk = L.fold(who.pseudo);
      const name = pk ? await byKey(ctx, pcol(room), `n:${pk}`) : null;
      if (name) rec = await byKey(ctx, pcol(room), name.data.id);
    }
    if (!rec || rec.data.n) return fail("not_found");
    await ctx.api.store.update(rec.id, { ...rec.data, muted: muted === true }, { key: rec.data.k });
    return { participant: { id: rec.data.k, pseudo: rec.data.pseudo ?? null, muted: muted === true } };
  });
}

export async function removeParticipant(ctx, room, pid) {
  const rec = await byKey(ctx, pcol(room), pid);
  if (!rec || rec.data.n) return false;
  if (rec.data.pk) { const name = await byKey(ctx, pcol(room), `n:${rec.data.pk}`); if (name?.data.id === pid) await ctx.api.store.remove(name.id); }
  for (const c of await listByKey(ctx, ccol(room), pid, 500)) await ctx.api.store.remove(c.id);
  await ctx.api.store.remove(rec.id);
  const fresh = await getRoom(ctx, room.k);
  if (fresh && fresh.gen === room.gen) await touchRoom(ctx, fresh, { count: Math.max(0, (fresh.count || 0) - 1) }, Date.now());
  return true;
}

/** Droit à l'oubli : retire la personne de TOUTES les salles. */
export async function forgetEverywhere(ctx, token) {
  let removed = 0;
  for (const r of await ctx.api.store.list(ROOMS, { limit: LIMITS.rooms + 20 })) {
    const room = roomOf(r);
    const rec = await byKey(ctx, pcol(room), idOf(room, token));
    if (rec) { await withLock(ctx, () => removeParticipant(ctx, room, rec.data.k)); removed++; }
  }
  return removed;
}

/* ───────────── Une voix par participant et par salle ───────────── */

export async function claim(ctx, room, token, key, now = Date.now()) {
  const pid = idOf(room, token);
  return withLock(ctx, async () => {
    const rec = await byKey(ctx, pcol(room), pid);
    if (!rec) return fail("unknown_participant");
    if (rec.data.muted) return fail("muted");
    const mine = await listByKey(ctx, ccol(room), pid, 501);
    if (mine.some((c) => c.data.ck === key)) return fail("already");
    if (mine.length > 500) return fail("limit");
    const fresh = await getRoom(ctx, room.k);
    if (!fresh || fresh.gen !== room.gen) return fail("busy");
    if ((fresh.claims || 0) >= LIMITS.claims) return fail("room_full");
    await ctx.api.store.add(ccol(fresh), { pid, ck: key, at: new Date(now).toISOString() }, { key: pid });
    await touchRoom(ctx, fresh, { claims: (fresh.claims || 0) + 1 }, now);
    return { first: true };
  });
}

export async function release(ctx, room, token, key) {
  const pid = idOf(room, token);
  return withLock(ctx, async () => {
    const hit = (await listByKey(ctx, ccol(room), pid, 501)).find((c) => c.data.ck === key);
    if (!hit) return { released: false };
    await ctx.api.store.remove(hit.id);
    const fresh = await getRoom(ctx, room.k);
    if (fresh && fresh.gen === room.gen) await touchRoom(ctx, fresh, { claims: Math.max(0, (fresh.claims || 0) - 1) }, Date.now());
    return { released: true };
  });
}

/* ───────────── Le direct : un point de lecture borné par salle et par canal ───────────── */

const liveKey = (room, channel) => `${room}|${channel}`;
const LIVE_TTL = { def: 6 * HOUR, max: DAY };

export async function publishLive(ctx, { room, channel, data, public: isPublic, readKey, refreshAt, ttlSec }, now = Date.now()) {
  const json = JSON.stringify(data ?? null);
  if (json === undefined || json.length > LIMITS.liveBytes) return fail("too_big");
  const key = liveKey(room, channel);
  const exp = new Date(now + Math.min(LIVE_TTL.max, Math.max(10_000, (Number(ttlSec) || 0) * 1000 || LIVE_TTL.def))).toISOString();
  const kh = readKey ? L.keyHash(readKey) : null;
  const due = Number.isFinite(Date.parse(refreshAt ?? "")) ? new Date(Date.parse(refreshAt)).toISOString() : null;
  return withLock(ctx, async () => {
    const found = await byKey(ctx, LIVE, key);
    if (found) {
      const d = found.data;
      if (d.json === json && d.public === (isPublic === true) && d.kh === kh && d.refreshAt === due) {
        if (Date.parse(d.exp) - now < LIVE_TTL.def / 2) await ctx.api.store.update(found.id, { ...d, exp }, { key });
        return { rev: d.rev };
      }
      const rev = (Number(d.rev) || 0) + 1;
      await ctx.api.store.update(found.id, { ...d, json, public: isPublic === true, kh, refreshAt: due, rev, at: new Date(now).toISOString(), exp }, { key });
      return { rev };
    }
    if ((await ctx.api.store.count(LIVE)) >= LIMITS.channels) {
      let freed = 0;
      for (const r of await ctx.api.store.list(LIVE, { limit: LIMITS.channels + 20 })) if (Date.parse(r.data.exp) <= now) { await ctx.api.store.remove(r.id); freed++; }
      if (!freed) return fail("too_many_channels");
    }
    await ctx.api.store.add(LIVE, { k: key, room, channel, json, public: isPublic === true, kh, refreshAt: due, rev: 1, at: new Date(now).toISOString(), exp }, { key });
    return { rev: 1 };
  });
}

/** Lecture d'un point de direct. `trusted` : appel d'un module (service) ; sinon il faut un canal public ou la bonne clé. Ne dit jamais si un canal privé existe. */
export async function readLive(ctx, { room, channel, rev, key, trusted }, now = Date.now()) {
  const rec = await byKey(ctx, LIVE, liveKey(room, channel));
  if (!rec) return { empty: true };
  const d = rec.data;
  if (Date.parse(d.exp) <= now) { await ctx.api.store.remove(rec.id); return { empty: true }; }
  if (!trusted && !d.public && !(d.kh && key && L.sameSecret(L.keyHash(key), d.kh))) return { empty: true };
  const due = !!d.refreshAt && now >= Date.parse(d.refreshAt);
  if (String(rev ?? "") === String(d.rev)) return { unchanged: true, rev: d.rev, due };
  let data = null;
  try { data = JSON.parse(d.json); } catch { return { empty: true }; }
  return { rev: d.rev, data, at: d.at, due };
}

export async function dropLive(ctx, room, channel) {
  return withLock(ctx, async () => {
    const rec = await byKey(ctx, LIVE, liveKey(room, channel));
    if (rec) await ctx.api.store.remove(rec.id);
    return { dropped: !!rec };
  });
}

/* ───────────── Journal d'audit minimal ───────────── */

export async function journal(ctx, { who, what, room, detail }, now = Date.now()) {
  await ctx.api.store.add(AUDIT, { at: new Date(now).toISOString(), who: L.clean(who, 40) || "?", what: L.clean(what, 60), room: room ? L.clean(room, LIMITS.roomKey) : null, detail: L.clean(detail, LIMITS.detail) });
  const extra = (await ctx.api.store.count(AUDIT)) - LIMITS.audit;
  if (extra > 0) {   // jamais plus de 500 lignes : les plus anciennes s'effacent
    const old = await ctx.api.store.page(AUDIT, { limit: Math.min(extra, 50), order: "asc" });
    for (const r of old.items) await ctx.api.store.remove(r.id);
  }
}

/* ───────────── Ménage : à la lecture, par petites tranches ───────────── */

/** Efface des données déjà abandonnées (salles vidées ou retirées), 300 lignes au plus par passage. */
async function eatGarbage(ctx, budget) {
  const meta = await ensureMeta(ctx);
  const garbage = [...(meta.garbage ?? [])];
  let used = 0;
  while (garbage.length && used < budget) {
    const page = await ctx.api.store.page(garbage[0], { limit: Math.min(100, budget - used), order: "asc" });
    for (const r of page.items) { await ctx.api.store.remove(r.id); used++; }
    if (page.items.length === 0) garbage.shift();
  }
  if (garbage.length !== (meta.garbage ?? []).length) await saveMeta(ctx, { ...meta, garbage });
  return used;
}

/**
 * Passage de ménage (au plus un toutes les 10 minutes) : participants inactifs, anciennes lignes du journal, canaux expirés, restes de salles vidées.
 * `force` : sans attendre (tests, administration). Renvoie le nombre de lignes effacées.
 */
export async function sweep(ctx, now = Date.now(), { force = false } = {}) {
  const k = ctx.instance.key;
  if (!force && now - (mem.swept.get(k) ?? 0) < 10 * 60_000) return 0;
  mem.swept.set(k, now);
  const cfg = cfgOf(ctx);
  const cutoff = now - cfg.days * DAY;
  let removed = await eatGarbage(ctx, 300);
  // 1. participants inactifs : on avance d'une salle et d'une tranche à la fois
  const meta = await ensureMeta(ctx);
  const rooms = (await ctx.api.store.list(ROOMS, { limit: LIMITS.rooms + 20 })).map(roomOf).sort((a, b) => a.k.localeCompare(b.k));
  let state = meta.sweep && rooms.some((r) => r.k === meta.sweep.room) ? meta.sweep : { room: rooms[0]?.k, cursor: null };
  let budget = 400, hops = 0;
  while (rooms.length && budget > 0 && hops <= rooms.length) {
    const room = rooms.find((r) => r.k === state.room);
    if (!room) { state = { room: rooms[0].k, cursor: null }; hops++; continue; }
    const page = await ctx.api.store.page(pcol(room), { limit: 100, order: "asc", cursor: state.cursor });
    budget -= Math.max(1, page.items.length);
    for (const it of page.items) {
      if (it.data.n) continue;
      if (Date.parse(it.data.last || it.data.at || 0) < cutoff) { await withLock(ctx, () => removeParticipant(ctx, room, it.data.k)); removed++; }
    }
    if (page.next) state = { room: room.k, cursor: page.next };
    else { state = { room: rooms[(rooms.indexOf(room) + 1) % rooms.length].k, cursor: null }; hops++; }
  }
  // 2. salles abandonnées (aucune activité depuis la durée de conservation) : retirées, leurs données partent au ménage
  for (const room of rooms) if (room.k !== GENERAL && Date.parse(room.lastAt || 0) < cutoff) { await withLock(ctx, () => retireRoom(ctx, room)); removed++; }
  // 3. journal : plus de 30 jours
  const olds = await ctx.api.store.page(AUDIT, { limit: 100, order: "asc" });
  for (const r of olds.items) { if (Date.parse(r.data.at) < now - 30 * DAY) { await ctx.api.store.remove(r.id); removed++; } else break; }
  // 4. canaux expirés
  for (const r of await ctx.api.store.list(LIVE, { limit: LIMITS.channels + 20 })) if (Date.parse(r.data.exp) <= now) { await ctx.api.store.remove(r.id); removed++; }
  const m2 = await ensureMeta(ctx);
  await saveMeta(ctx, { ...m2, sweep: state });
  return removed;
}

/* ───────────── Pour l'administration et la télécommande ───────────── */

export async function listRooms(ctx) {
  return (await ctx.api.store.list(ROOMS, { limit: LIMITS.rooms + 20 })).map(roomOf).sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)));
}

export async function participantsPage(ctx, room, cursor, limit = 50) {
  const page = await ctx.api.store.page(pcol(room), { limit, cursor, order: "desc" });
  return { items: page.items.filter((r) => !r.data.n).map((r) => ({ id: r.data.k, pseudo: r.data.pseudo ?? null, muted: r.data.muted === true, last: r.data.last })), next: page.next };
}

export const publicRoom = (r) => ({ key: r.k, label: r.label, count: r.count || 0 });
