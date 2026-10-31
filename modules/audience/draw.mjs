// Participation — le tirage au sort : les données et les gestes (ouvrir, fermer, tirer, vider), le service « audience.draw », le direct de l'écran et le panneau de la télécommande.
//
// Un propriétaire par donnée : Participation possède déjà les personnes (pseudo, sourdine, limites) ; ce fichier possède le TIRAGE (ses réglages, ses inscriptions, ses personnes gagnantes).
//   • `draws`        : le tirage en cours (clé « cur ») et l'historique (20 au plus, clé « h-<id> »).
//   • `de-<id>-<n>`  : les inscriptions d'un tirage (une ligne par personne, clé = identifiant de la personne dans la salle « draw »).
//   • la salle « draw » : l'identité de chaque personne, qu'elle vienne du site (code du navigateur) ou du chat (empreinte « plateforme + identifiant »). La sourdine y vit.
// Rien ne tourne en arrière-plan : la fermeture à l'échéance et l'effacement des inscriptions (24 h après la fermeture) sont constatés quand quelqu'un lit.
import { randomBytes } from "node:crypto";

const V = new URL(import.meta.url).search;   // le cœur recharge ce fichier avec ?v=… : les fichiers voisins suivent
const L = await import(`./lib.mjs${V}`);
const K = await import(`./core.mjs${V}`);
const P = await import(`./drawlib.mjs${V}`);
export const { DRAW } = P;

export const DRAWS = "draws";
const gl = (globalThis.__curiosaAudienceDraw ??= { sync: new Map(), sweep: new Map() });   // mémoire du processus : coalescence des lectures, ménage espacé
const ecol = (d) => `de-${d.k}-${d.gen || 0}`;
const iso = (ms) => new Date(ms).toISOString();
const newId = () => `d${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
const err = (error, extra = {}) => ({ ok: false, error, ...extra });

/* ───────────── Les réglages propres au tirage : le code de l'écran et la file d'effacement ───────────── */

async function drawMeta(ctx) {
  const found = await K.byKey(ctx, K.META, "draw-cfg");
  if (found) return { id: found.id, ...found.data };
  const data = { k: "draw-cfg", drawKey: randomBytes(18).toString("base64url"), queue: [] };
  const id = await ctx.api.store.add(K.META, data, { key: "draw-cfg" });
  const first = await K.byKey(ctx, K.META, "draw-cfg");
  if (first && first.id !== id) { await ctx.api.store.remove(id); return { id: first.id, ...first.data }; }
  return { id, ...data };
}
const saveDrawMeta = async (ctx, m) => { const { id, ...data } = m; await ctx.api.store.update(id, data, { key: "draw-cfg" }); };

/** Le code secret de l'écran du stream (lecture du direct et adresse OBS). */
export const screenKey = async (ctx) => (await drawMeta(ctx)).drawKey;

/** Change le code secret : l'ancienne adresse de l'écran cesse de marcher. */
export async function regenerateScreenKey(ctx) {
  await K.withLock(ctx, async () => { const m = await drawMeta(ctx); await saveDrawMeta(ctx, { ...m, drawKey: randomBytes(18).toString("base64url") }); });
  await K.dropLive(ctx, DRAW.room, DRAW.channel);
}

/** À appeler DANS le verrou : met une liste d'inscriptions à effacer en file. */
async function enqueue(ctx, name) {
  const m = await drawMeta(ctx);
  await saveDrawMeta(ctx, { ...m, queue: [...(m.queue ?? []), name].slice(-DRAW.queue) });
}

/** La salle des personnes du tirage (créée au besoin). À appeler HORS verrou. */
export async function ensureDrawRoom(ctx) {
  const room = await K.ensureRoom(ctx, DRAW.room, ctx.t("drawRoom"));
  return room.error ? null : room;
}

/* ───────────── Lire le tirage en cours (c'est ici que l'échéance et les 24 h sont constatées) ───────────── */

/** Le tirage en cours, ou null. Un tirage ouvert dont l'heure est passée est fermé ici ; des inscriptions fermées depuis plus de 24 h sont mises en file d'effacement ici. */
export async function current(ctx, now = Date.now()) {
  const rec = await K.byKey(ctx, DRAWS, "cur");
  if (!rec) return null;
  const d = rec.data;
  if (!((d.status === "open" && P.stateOf(d, now) === "closed") || P.purgeDue(d, now))) return { id: rec.id, ...d };
  return K.withLock(ctx, async () => {
    const f = await K.byKey(ctx, DRAWS, "cur");   // relu dans le verrou : un autre geste a pu passer entre-temps
    if (!f) return null;
    const next = { ...f.data };
    let closedNow = false;
    if (next.status === "open" && P.stateOf(next, now) === "closed") { next.status = "closed"; next.closedAt = iso(Math.min(now, P.deadlineOf(next))); closedNow = true; }
    if (P.purgeDue(next, now)) { await enqueue(ctx, ecol(next)); next.total = next.count || 0; next.count = 0; next.purged = true; }
    if (closedNow || next.purged !== f.data.purged) await ctx.api.store.update(f.id, next, { key: "cur" });
    if (closedNow) await K.journal(ctx, { who: "system", what: "draw.close", detail: next.title });
    return { id: f.id, ...next };
  });
}

export const stateOf = P.stateOf;
const picked = (d) => (d?.picked ?? []).filter((w) => !w.absent);
/** Les personnes du dernier tirage (celles qui s'affichent à l'écran). */
export const latestBatch = (d) => picked(d).filter((w) => w.at === d.pickedAt);
export const eligibleLeft = (d) => Math.max(0, (d?.count || 0) - (d?.picked ?? []).length);

/** Ce que voit le Bot Twitch : rien de secret, borné, ne lève jamais. */
export async function status(ctx, now = Date.now()) {
  const none = { open: false, keyword: "", level: "all" };
  try {
    sweepSoon(ctx, now);
    const d = await current(ctx, now);
    if (!d || P.stateOf(d, now) !== "open") return none;
    return { open: true, keyword: d.keyword || "", level: P.LEVELS.includes(d.level) ? d.level : "all", ...(d.untilClosed ? {} : { expiresAt: iso(P.deadlineOf(d)) }) };
  } catch { return none; }
}

/* ───────────── Ouvrir, fermer, rouvrir ───────────── */

/** Range le tirage en cours dans l'historique (ses inscriptions partent à l'effacement). DANS le verrou. */
async function archive(ctx, rec, now) {
  const d = { ...rec.data };
  if (d.status === "open") { d.status = "closed"; d.closedAt = iso(Math.min(now, P.deadlineOf(d))); }
  if (!d.purged) { await enqueue(ctx, ecol(d)); d.total = d.count || 0; d.count = 0; d.purged = true; }
  await ctx.api.store.update(rec.id, d, { key: `h-${d.k}` });
  const rows = (await ctx.api.store.list(DRAWS, { limit: 100 })).filter((r) => r.data?.k && r.key !== "cur").sort((a, b) => String(b.data.openedAt).localeCompare(String(a.data.openedAt)));
  for (const r of rows.slice(DRAW.history)) await ctx.api.store.remove(r.id);
}

/** « Nouveau tirage » : refuse s'il y en a un d'ouvert ; sinon range l'ancien dans l'historique. `value` vient de `validateForm`. */
export async function openNew(ctx, value, { who = "admin", now = Date.now() } = {}) {
  await ensureDrawRoom(ctx);
  const out = await K.withLock(ctx, async () => {
    const rec = await K.byKey(ctx, DRAWS, "cur");
    if (rec) {
      if (P.stateOf(rec.data, now) === "open") return err("already_open");
      await archive(ctx, rec, now);
    }
    const data = {
      k: newId(), title: value.title, keyword: P.normKeyword(value.keyword).value || "", level: value.level || "all", site: value.site !== false, minutes: value.minutes ?? null, winners: P.winnersCount(value.winners),
      status: "open", gen: 0, openedAt: iso(now), expiresAt: iso(now + (value.minutes ? value.minutes * 60_000 : DRAW.openMaxMs)), untilClosed: !value.minutes, closedAt: null,
      count: 0, total: 0, picked: [], pickedAt: null, purged: false,
    };
    await ctx.api.store.add(DRAWS, data, { key: "cur" });
    await K.journal(ctx, { who, what: "draw.new", detail: data.title });
    return { ok: true, draw: data };
  });
  if (out.ok) await syncLive(ctx, now).catch(() => {});
  return out;
}

export async function close(ctx, { who = "admin", now = Date.now() } = {}) {
  const out = await K.withLock(ctx, async () => {
    const rec = await K.byKey(ctx, DRAWS, "cur");
    if (!rec) return err("none");
    if (P.stateOf(rec.data, now) !== "open") return err("not_open");
    await ctx.api.store.update(rec.id, { ...rec.data, status: "closed", closedAt: iso(now) }, { key: "cur" });
    await K.journal(ctx, { who, what: "draw.close", detail: rec.data.title });
    return { ok: true };
  });
  if (out.ok) await syncLive(ctx, now).catch(() => {});
  return out;
}

/** Rouvre un tirage fermé par erreur (seulement tant que personne n'a été tiré et que la liste n'est pas effacée). */
export async function reopen(ctx, { who = "admin", now = Date.now() } = {}) {
  await ensureDrawRoom(ctx);
  const out = await K.withLock(ctx, async () => {
    const rec = await K.byKey(ctx, DRAWS, "cur");
    if (!rec) return err("none");
    const d = rec.data;
    if (P.stateOf(d, now) === "open") return err("already_open");
    if (d.purged || P.purgeDue(d, now) || (d.picked ?? []).length) return err("cannot_reopen");
    await ctx.api.store.update(rec.id, { ...d, status: "open", closedAt: null, expiresAt: iso(now + DRAW.openMaxMs), untilClosed: true, openedAt: d.openedAt }, { key: "cur" });
    await K.journal(ctx, { who, what: "draw.reopen", detail: d.title });
    return { ok: true };
  });
  if (out.ok) await syncLive(ctx, now).catch(() => {});
  return out;
}

/** « Ouvrir le tirage » de la télécommande : rouvre un tirage fermé par erreur, sinon en ouvre un nouveau avec les mêmes réglages que le dernier (ou des réglages simples la première fois). */
export async function openQuick(ctx, { who = "remote", now = Date.now() } = {}) {
  const cur = await current(ctx, now);
  if (cur && P.stateOf(cur, now) === "open") return err("already_open");
  if (cur && !cur.purged && !(cur.picked ?? []).length) { const r = await reopen(ctx, { who, now }); if (r.ok || r.error !== "cannot_reopen") return { ...r, reopened: r.ok }; }
  const value = cur
    ? { title: cur.title, keyword: cur.keyword, level: cur.level, site: cur.site, minutes: cur.minutes ?? null, winners: cur.winners }
    : { title: ctx.t("drawDefaultTitle"), keyword: "", level: "all", site: true, minutes: null, winners: 1 };
  return openNew(ctx, value, { who, now });
}

/* ───────────── S'inscrire ───────────── */

async function setChatPseudo(ctx, room, pid, pseudo, now) {
  await K.withLock(ctx, async () => {
    const rec = await K.participantById(ctx, room, pid);
    if (!rec || rec.data.pseudo === pseudo) return;
    await ctx.api.store.update(rec.id, { ...rec.data, pseudo, last: iso(now) }, { key: pid });
  });
}

/** Ajoute l'inscription (une par personne, bornée à 5 000). Renvoie { ok: true } ou { reason }. */
async function addEntry(ctx, { pid, pseudo, src }, now) {
  return K.withLock(ctx, async () => {
    const rec = await K.byKey(ctx, DRAWS, "cur");
    if (!rec || P.stateOf(rec.data, now) !== "open") return { reason: "closed" };
    const d = rec.data, col = ecol(d);
    if (await K.byKey(ctx, col, pid)) return { reason: "already" };
    if ((d.count || 0) >= DRAW.maxEntries) return { reason: "full" };
    await ctx.api.store.add(col, { k: pid, pseudo, src, at: iso(now) }, { key: pid });
    await ctx.api.store.update(rec.id, { ...d, count: (d.count || 0) + 1 }, { key: "cur" });
    return { ok: true };
  });
}

const REASONS = new Set(["closed", "muted", "already", "invalid", "full", "level"]);

/** Le service « audience.draw » · enter : une personne du chat. `args` : { pseudo, platform, login?, role? }. Ne lève jamais. */
export async function enterChat(ctx, args, now = Date.now()) {
  const no = (reason) => ({ ok: false, reason: REASONS.has(reason) ? reason : "closed" });
  try {
    const platform = typeof args.platform === "string" ? args.platform.trim().toLowerCase() : "";
    if (!P.platformOk(platform) || platform === P.SOURCES.site) return no("invalid");
    if (typeof args.pseudo !== "string") return no("invalid");
    const pseudo = P.chatPseudo(args.pseudo), ident = P.chatIdent(args.login, args.pseudo);
    if (!pseudo || !ident) return no("invalid");
    const cur = await current(ctx, now);
    if (!cur || P.stateOf(cur, now) !== "open" || !cur.keyword) return no("closed");
    if (!P.levelOk(cur.level, args.role)) return no("level");
    if (L.isBanned(pseudo, K.cfgOf(ctx).banned)) return no("invalid");
    const room = await ensureDrawRoom(ctx);
    if (!room) return no("full");
    const j = await K.joinRoom(ctx, room, P.chatToken(platform, ident), now);
    if (j.error) return no(j.error === "room_full" ? "full" : "closed");
    if (j.participant.muted) return no("muted");
    await setChatPseudo(ctx, room, j.participant.id, pseudo, now);
    const r = await addEntry(ctx, { pid: j.participant.id, pseudo, src: platform }, now);
    return r.ok ? { ok: true } : no(r.reason);
  } catch (e) { console.error("[audience]", e?.message ?? "error"); return no("closed"); }
}

/**
 * L'inscription depuis la page du site. `join` est la méthode « join » du service de session (identité, pseudo choisi et vérifié, sourdine, limites par connexion).
 * Renvoie { ok: true, pseudo } ou { ok: false, error } (un code que la page sait dire : closed, no_site, already, muted, full, limit, pseudo_*, busy, invalid).
 */
export async function enterSite(ctx, { token, name, conn }, join, now = Date.now()) {
  try {
    const cur = await current(ctx, now);
    if (!cur || P.stateOf(cur, now) !== "open") return err("closed");
    if (!cur.site) return err("no_site");
    if (typeof name !== "string" || !L.clean(name, 200)) return err("pseudo_short");
    const room = await ensureDrawRoom(ctx);
    if (!room) return err("busy");
    if (L.tokenOk(token) && (await K.byKey(ctx, ecol(cur), K.idOf(room, token)))) return err("already");   // déjà inscrite : on ne touche pas à son pseudo
    const r = await join(ctx, { room: DRAW.room, token, conn, pseudo: name });
    if (!r.ok) return err(r.error === "room_full" ? "full" : r.error, r.retryAfter ? { retryAfter: r.retryAfter } : {});
    if (r.participant.muted) return err("muted");
    if (!r.participant.pseudo) return err("invalid");
    const e = await addEntry(ctx, { pid: r.participant.id, pseudo: r.participant.pseudo, src: P.SOURCES.site }, now);
    if (!e.ok) return err(e.reason);
    syncLiveSoon(ctx, now);
    return { ok: true, pseudo: r.participant.pseudo };
  } catch (e) { console.error("[audience]", e?.message ?? "error"); return err("busy"); }
}

/** La personne est-elle déjà inscrite ? (page du site : « Vous participez ! » dès l'ouverture de la page.) */
export async function entryOf(ctx, token, now = Date.now()) {
  const cur = await current(ctx, now);
  const open = !!cur && P.stateOf(cur, now) === "open";
  const out = { open, site: open && !!cur.site, title: cur?.title ?? "", keyword: open ? cur.keyword || "" : "", count: open ? cur.count || 0 : 0, in: false, pseudo: null, until: open && !cur.untilClosed ? iso(P.deadlineOf(cur)) : null };
  if (!cur || !L.tokenOk(token)) return out;
  const room = await K.getRoom(ctx, DRAW.room);
  const rec = room ? await K.findParticipant(ctx, room, token) : null;
  if (!rec) return out;
  out.pseudo = rec.data.pseudo ?? null;
  out.in = !cur.purged && !!(await K.byKey(ctx, ecol(cur), rec.data.k));
  return out;
}

/* ───────────── Tirer ───────────── */

/** Les inscriptions encore éligibles (pas encore tirées), 500 par lecture. DANS le verrou. */
async function eligiblePool(ctx, d) {
  const pool = [];
  let cursor = null;
  do {
    const page = await ctx.api.store.page(ecol(d), { limit: 500, cursor, order: "asc" });
    for (const it of page.items) if (!it.data.won) pool.push({ id: it.id, k: it.data.k, pseudo: it.data.pseudo, src: it.data.src, at: it.data.at });
    cursor = page.next;
  } while (cursor && pool.length <= DRAW.maxEntries);
  return pool;
}

/** Tire `k` personnes dans le tirage `rec` (DANS le verrou). Une personne mise en sourdine depuis son inscription est écartée sans compter. */
async function pickIn(ctx, rec, d, k, rnd, now) {
  const keep = { status: d.status, closedAt: d.closedAt };   // un tirage qui ne tire personne ne ferme rien
  if (d.status === "open") { d.status = "closed"; d.closedAt = iso(Math.min(now, P.deadlineOf(d))); }
  const pool = await eligiblePool(ctx, d);
  if (!pool.length) { Object.assign(d, keep); return err("empty"); }
  const room = await K.getRoom(ctx, DRAW.room);
  const { picked: won, rejected } = await P.drawFrom(pool, k, rnd, async (c) => { if (!room) return true; const p = await K.participantById(ctx, room, c.k); return !(p && p.data.muted); });
  for (const c of rejected) { await ctx.api.store.remove(c.id); d.count = Math.max(0, (d.count || 0) - 1); }
  if (!won.length) { Object.assign(d, keep); await ctx.api.store.update(rec.id, d, { key: "cur" }); return err("empty"); }
  const at = iso(now);
  for (const c of won) await ctx.api.store.update(c.id, { k: c.k, pseudo: c.pseudo, src: c.src, at: c.at, won: true }, { key: c.k });
  d.picked = [...(d.picked ?? []), ...won.map((c) => ({ k: c.k, pseudo: c.pseudo, src: c.src, at }))].slice(-200);
  d.status = "drawn"; d.pickedAt = at;
  await ctx.api.store.update(rec.id, d, { key: "cur" });
  return { ok: true, winners: won.map((c) => c.pseudo), left: pool.length - won.length - rejected.length };
}

/** « Tirer une personne gagnante » : `count` personnes (1 à 10, sinon le nombre réglé pour ce tirage), chacune avec la même chance, sans les personnes déjà tirées. `rnd` : pour les tests seulement. */
export async function pick(ctx, { count, who = "admin", rnd, now = Date.now() } = {}) {
  const out = await K.withLock(ctx, async () => {
    const rec = await K.byKey(ctx, DRAWS, "cur");
    if (!rec) return err("none");
    const d = { ...rec.data };
    if (d.purged || P.purgeDue(d, now)) return err("gone");
    const r = await pickIn(ctx, rec, d, P.winnersCount(count, d.winners || 1), rnd, now);
    if (r.ok) await K.journal(ctx, { who, what: "draw.pick", detail: r.winners.join(", ") });
    return r;
  });
  if (out.ok) await syncLive(ctx, now).catch(() => {});
  return out;
}

/** « Tirer quelqu'un d'autre » : cette personne gagnante n'est pas là ; elle ne peut plus être tirée et une autre est tirée à sa place. */
export async function redraw(ctx, { pid, who = "admin", rnd, now = Date.now() } = {}) {
  const out = await K.withLock(ctx, async () => {
    const rec = await K.byKey(ctx, DRAWS, "cur");
    if (!rec) return err("none");
    const d = { ...rec.data };
    const i = (d.picked ?? []).findIndex((w) => w.k === pid && !w.absent);
    if (i < 0 || d.purged) return err("gone");
    const before = d.picked[i];
    d.picked = d.picked.map((w, j) => (j === i ? { ...w, absent: true } : w));
    const r = await pickIn(ctx, rec, d, 1, rnd, now);
    if (!r.ok) { await ctx.api.store.update(rec.id, d, { key: "cur" }); await K.journal(ctx, { who, what: "draw.redraw", detail: `${before.pseudo} -> -` }); return r; }
    await K.journal(ctx, { who, what: "draw.redraw", detail: `${before.pseudo} -> ${r.winners.join(", ")}` });
    return r;
  });
  await syncLive(ctx, now).catch(() => {});
  return out;
}

/* ───────────── Retirer une personne, vider ───────────── */

/** « Retirer cette personne » : son inscription disparaît (et sa victoire, s'il y en avait une). `mute` : elle est aussi mise en sourdine. */
export async function removeEntry(ctx, pid, { who = "admin", mute = false, now = Date.now() } = {}) {
  if (typeof pid !== "string" || !/^[0-9a-f]{40}$/.test(pid)) return err("gone");
  const out = await K.withLock(ctx, async () => {
    const rec = await K.byKey(ctx, DRAWS, "cur");
    if (!rec || rec.data.purged) return err("gone");
    const d = { ...rec.data };
    const row = await K.byKey(ctx, ecol(d), pid);
    if (!row) return err("gone");
    await ctx.api.store.remove(row.id);
    d.count = Math.max(0, (d.count || 0) - 1);
    d.picked = (d.picked ?? []).filter((w) => w.k !== pid);
    if (d.status === "drawn" && !picked(d).length) { d.status = "closed"; d.pickedAt = null; }
    await ctx.api.store.update(rec.id, d, { key: "cur" });
    await K.journal(ctx, { who, what: "draw.remove", detail: row.data.pseudo || "-" });
    return { ok: true, pseudo: row.data.pseudo };
  });
  if (out.ok && mute) {
    const room = await K.getRoom(ctx, DRAW.room);
    if (room) { await K.setMuted(ctx, room, { id: pid }, true); await K.journal(ctx, { who, what: "mute", room: DRAW.room, detail: out.pseudo || "-" }); }
  }
  if (out.ok) await syncLive(ctx, now).catch(() => {});
  return out;
}

/** « Vider le tirage » : toutes les inscriptions et les personnes gagnantes sont effacées ; les réglages et l'état d'ouverture restent. */
export async function clear(ctx, { who = "admin", now = Date.now() } = {}) {
  const out = await K.withLock(ctx, async () => {
    const rec = await K.byKey(ctx, DRAWS, "cur");
    if (!rec) return err("none");
    const d = { ...rec.data };
    const removed = d.count || 0;
    if (!d.purged) await enqueue(ctx, ecol(d));
    d.gen = (d.gen || 0) + 1; d.count = 0; d.total = 0; d.picked = []; d.pickedAt = null; d.purged = false;
    if (d.status === "drawn") d.status = "closed";
    await ctx.api.store.update(rec.id, d, { key: "cur" });
    await K.journal(ctx, { who, what: "draw.clear", detail: `${removed}` });
    return { ok: true, removed };
  });
  if (out.ok) await syncLive(ctx, now).catch(() => {});
  return out;
}

/* ───────────── Pour l'administration ───────────── */

export async function entriesPage(ctx, d, cursor, limit = DRAW.pageSize) {
  if (!d || d.purged) return { items: [], next: null };
  const page = await ctx.api.store.page(ecol(d), { limit, cursor, order: "desc" });
  return { items: page.items.map((r) => ({ id: r.data.k, pseudo: r.data.pseudo || "", src: r.data.src || "", at: r.data.at, won: r.data.won === true })), next: page.next };
}

/** Les 20 derniers tirages terminés (le plus récent d'abord) : titre, date, pseudos des personnes gagnantes, nombre d'inscriptions. */
export async function history(ctx, now = Date.now()) {
  const rows = (await ctx.api.store.list(DRAWS, { limit: 100 })).filter((r) => r.data?.k);
  return rows.map((r) => r.data).filter((d) => P.stateOf(d, now) !== "open" && d.openedAt)
    .sort((a, b) => String(b.openedAt).localeCompare(String(a.openedAt))).slice(0, DRAW.history)
    .map((d) => ({ title: d.title, at: d.closedAt || d.openedAt, winners: picked(d).map((w) => w.pseudo), participants: d.purged ? d.total || 0 : d.count || 0 }));
}

/* ───────────── Le ménage : effacer les listes en file, par petites tranches, à la lecture ───────────── */

/** Efface les inscriptions mises en file (200 lignes au plus par passage) et, avec elles, la fiche de la personne dans la salle — sauf si elle est en sourdine ou inscrite au tirage en cours. */
export async function sweep(ctx, now = Date.now()) {
  const m = await drawMeta(ctx);
  const queue = m.queue ?? [];
  if (!queue.length) return 0;
  const room = await K.getRoom(ctx, DRAW.room);
  const cur = await K.byKey(ctx, DRAWS, "cur");
  const live = cur && !cur.data.purged ? ecol(cur.data) : null;
  let budget = 200, removed = 0;
  const finished = [];
  for (const name of queue) {
    if (budget <= 0) break;
    const page = await ctx.api.store.page(name, { limit: Math.min(100, budget), order: "asc" });
    for (const it of page.items) {
      const pid = it.data.k;
      if (room && pid) {
        const p = await K.participantById(ctx, room, pid);
        if (p && !p.data.muted && !(live && (await K.byKey(ctx, live, pid)))) await K.withLock(ctx, () => K.removeParticipant(ctx, room, pid));
      }
      await ctx.api.store.remove(it.id);
      budget--; removed++;
    }
    if (page.items.length === 0) finished.push(name);
  }
  if (finished.length) await K.withLock(ctx, async () => { const fresh = await drawMeta(ctx); await saveDrawMeta(ctx, { ...fresh, queue: (fresh.queue ?? []).filter((n) => !finished.includes(n)) }); });
  return removed;
}

/** Le ménage, au plus une fois par minute et par site, sans attendre la fin (la lecture qui le demande ne l'attend pas). */
export function sweepSoon(ctx, now = Date.now()) {
  const k = ctx.instance.key;
  if (now - (gl.sweep.get(k) ?? 0) < 60_000) return;
  gl.sweep.set(k, now);
  sweep(ctx, now).catch((e) => console.error("[audience]", e?.message ?? "error"));
}

/* ───────────── Le direct : ce que lit l'écran du stream ───────────── */

/** L'état publié pour l'écran. Il ne dépend que du tirage (jamais de l'heure) : il change quand le tirage change, pas avant. Aucun secret, que des pseudos déjà montrés au public. */
export function liveView(d, now = Date.now()) {
  const state = P.stateOf(d, now);
  if (state === "none" || !d) return { v: 1, state: "none" };
  const batch = latestBatch(d).map((w) => w.pseudo).slice(0, 50);
  return {
    v: 1, state, title: d.title, keyword: d.keyword || "", site: d.site !== false, count: d.purged ? d.total || 0 : d.count || 0,
    until: state === "open" && !d.untilClosed ? iso(P.deadlineOf(d)) : null,
    winners: state === "drawn" ? batch : [], showUntil: state === "drawn" && d.pickedAt ? iso(Date.parse(d.pickedAt) + DRAW.showMs) : null,
  };
}

export async function syncLive(ctx, now = Date.now()) {
  const d = await current(ctx, now);
  return K.publishLive(ctx, { room: DRAW.room, channel: DRAW.channel, data: liveView(d, now), public: false, readKey: await screenKey(ctx), ttlSec: 6 * 3600 }, now);
}

/** Comme `syncLive`, mais au plus une fois toutes les 2 secondes par site, même si des dizaines d'écrans lisent en même temps. */
export function syncLiveSoon(ctx, now = Date.now()) {
  const k = ctx.instance.key, run = gl.sync.get(k);
  if (run && now - run.at < 2000) return run.p;
  const p = syncLive(ctx, now).catch((e) => { console.error("[audience]", e?.message ?? "error"); return null; });
  gl.sync.set(k, { p, at: now });
  return p;
}

/* ───────────── La télécommande : le panneau « Tirage au sort » ───────────── */

export async function remotePanel(ctx, now = Date.now()) {
  const d = await current(ctx, now);
  const st = P.stateOf(d, now), t = (k, v) => ctx.t(k, v);
  const n = d ? (d.purged ? d.total || 0 : d.count || 0) : 0;
  const names = latestBatch(d).map((w) => w.pseudo).join(", ");
  const state = st === "none" ? { text: t("drawRemoteNone"), tone: "idle" }
    : st === "open" ? { text: t("drawRemoteOpen", { title: d.title, n }), tone: "live", until: d.untilClosed ? null : iso(P.deadlineOf(d)) }
      : st === "drawn" ? { text: t("drawRemoteDrawn", { title: d.title, names }), tone: "done" }
        : { text: t("drawRemoteClosed", { title: d.title, n }), tone: "idle" };
  const many = d && P.winnersCount(d.winners) > 1 ? P.winnersCount(d.winners) : 1;
  const replaces = st !== "open" && !!d && !d.purged && (d.count || 0) > 0 && ((d.picked ?? []).length > 0 || st === "drawn");
  return {
    title: t("drawRemoteTitle"), state,
    buttons: [
      { id: "draw-open", label: t("drawBtnOpen"), tone: "primary", disabled: st === "open", confirm: replaces ? t("drawOpenConfirm") : "" },
      { id: "draw-close", label: t("drawBtnClose"), tone: "danger", confirm: t("drawCloseConfirm"), disabled: st !== "open" },
      { id: "draw-pick", label: many > 1 ? t("drawBtnPickMany", { n: many }) : t("drawBtnPick"), tone: "primary", confirm: t("drawPickConfirm"), disabled: st === "none" || !d || d.purged || eligibleLeft(d) < 1 },
    ],
    forms: [],
  };
}

/** Un message lisible pour une erreur du tirage (télécommande, administration). */
export const errorText = (ctx, code) => ctx.t(({ already_open: "drawErrAlreadyOpen", not_open: "drawErrNotOpen", none: "drawErrNone", empty: "drawErrEmpty", gone: "drawErrGone", cannot_reopen: "drawErrReopen" })[code] ?? "drawErrFailed");

/** Un geste de la télécommande ou de l'assistant. Renvoie { ok, message } ou { ok: false, error, message }. */
export async function pressDraw(ctx, action, { who = "remote", now = Date.now() } = {}) {
  let r;
  if (action === "draw-open") { r = await openQuick(ctx, { who, now }); if (r.ok) return { ok: true, message: ctx.t(r.reopened ? "drawOkReopened" : "drawOkOpened") }; }
  else if (action === "draw-close") { r = await close(ctx, { who, now }); if (r.ok) return { ok: true, message: ctx.t("drawOkClosed") }; }
  else if (action === "draw-pick") { r = await pick(ctx, { who, now }); if (r.ok) return { ok: true, message: ctx.t(r.winners.length > 1 ? "drawOkPickedMany" : "drawOkPicked", { names: r.winners.join(", "), n: r.winners.length }) }; }
  else return { ok: false, error: "invalid" };
  return { ok: false, error: r.error === "already_open" || r.error === "not_open" || r.error === "empty" || r.error === "none" || r.error === "gone" ? r.error : "failed", message: errorText(ctx, r.error) };
}
