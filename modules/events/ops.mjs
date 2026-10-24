// Événements : les écritures partagées par l'administration, l'import de fichier et l'assistant IA.
// Règle de fond : un événement n'est jamais écrit sans être vérifié ici ; l'assistant IA n'a accès qu'à des brouillons (`by: "assistant"`),
// et seule une personne autorisée publie. Chaque erreur est un CODE (`errors.<champ> = { code, vars? }`) : l'écran en fait une phrase avec un exemple.
import { randomUUID } from "node:crypto";
const q = new URL(import.meta.url).search;
const X = await import(`./text.mjs${q}`);
const T = await import(`./time.mjs${q}`);
const M = await import(`./model.mjs${q}`);
const D = await import(`./data.mjs${q}`);
const TPL = await import(`./templates.mjs${q}`);
const Z = await import(`./zones.mjs${q}`);

const err = (code, vars) => ({ code, ...(vars ? { vars } : {}) });
const has = (v, k) => v[k] !== undefined && v[k] !== null;

/** Un type désigné par son identifiant ou par son nom (accents et majuscules ignorés). `null` si aucun ne correspond. */
export function matchType(types, ref) {
  const wanted = X.clean(ref, 80);
  if (!wanted) return null;
  const key = X.fold(wanted);
  return types.find((t) => t.key === wanted.toLowerCase()) ?? types.find((t) => Object.values(t.names).some((n) => X.fold(n) === key)) ?? null;
}

/** Applique à `doc` les champs d'UNE section du formulaire (seuls ceux présents dans `v`). Renvoie les erreurs par champ. Sections : essential · where · program · media · after. */
export function applySection(doc, section, v, ref) {
  const errors = {};
  if (section === "essential") {
    if (has(v, "title")) { doc.title = X.clean(v.title, X.LIMITS.title); if (!doc.title) errors.title = err("titleRequired"); }
    if (has(v, "type")) {
      const raw = X.clean(v.type, 80);
      if (!raw) doc.type = "";
      else { const t = matchType(ref.types, raw); if (t) doc.type = t.key; else errors.type = err("typeBad"); }
    }
    if (has(v, "date")) { const d = T.readDate(v.date); if (d) doc.date = d; else errors.date = err(String(v.date).trim() ? "dateBad" : "dateRequired"); }
    if (has(v, "time")) {
      const raw = String(v.time).trim();
      if (!raw) doc.time = ""; else { const t = T.readTime(raw); if (t) doc.time = t; else errors.time = err("timeBad"); }
    }
    if (has(v, "place")) doc.place = X.clean(v.place, X.LIMITS.place);
    if (has(v, "text")) doc.text = X.clean(v.text, X.LIMITS.text, true);
    if (has(v, "status") && M.STATUSES.includes(v.status)) doc.status = v.status;
    if (has(v, "state") && M.STATES.includes(v.state)) doc.state = v.state;
  } else if (section === "where") {
    if (has(v, "endDate")) { const raw = String(v.endDate).trim(); if (!raw) doc.endDate = ""; else { const d = T.readDate(raw); if (d) doc.endDate = d; else errors.endDate = err("dateBad"); } }
    if (has(v, "endTime")) { const raw = String(v.endTime).trim(); if (!raw) doc.endTime = ""; else { const t = T.readTime(raw); if (t) doc.endTime = t; else errors.endTime = err("timeBad"); } }
    if (has(v, "tz")) { const raw = String(v.tz).trim(); if (!raw) doc.tz = ""; else { const z = T.canonicalZone(raw, ref.zones); if (z) doc.tz = z; else errors.tz = err("zoneBad"); } }
    if (has(v, "lat")) { const n = X.parseCoord(v.lat, 90); if (n === undefined) errors.lat = err("latBad"); else doc.lat = n; }
    if (has(v, "lng")) { const n = X.parseCoord(v.lng, 180); if (n === undefined) errors.lng = err("lngBad"); else doc.lng = n; }
  } else if (section === "program") {
    if (has(v, "program")) {
      const r = M.parseProgram(v.program);
      if (r.errors.length) errors.program = err(r.errors[0].code === "tooMany" ? "programMany" : r.errors[0].code === "slotEnd" ? "slotEnd" : "programLine", { line: r.errors[0].line, max: X.LIMITS.program });
      else doc.program = r.items;
    }
    if (has(v, "speakers")) {
      const r = M.parseSpeakers(v.speakers);
      if (r.errors.length) errors.speakers = err(r.errors[0].code === "tooMany" ? "speakersMany" : r.errors[0].code === "badSpeakerLink" ? "speakerLink" : "speakerLine", { line: r.errors[0].line, max: X.LIMITS.speakers });
      else doc.speakers = r.items;
    }
  } else if (section === "media") {
    if (has(v, "image")) { const raw = String(v.image).trim(); if (!raw) doc.image = ""; else { const m = X.safeMedia(raw); if (m) doc.image = m; else errors.image = err("imageBad"); } }
    if (has(v, "imageAlt")) doc.imageAlt = X.clean(v.imageAlt, 160);
    if (has(v, "signupUrl")) { const raw = String(v.signupUrl).trim(); if (!raw) doc.signupUrl = ""; else { const h = X.safeHref(raw); if (h) doc.signupUrl = h; else errors.signupUrl = err("urlBad"); } }
    if (has(v, "seatsLeft")) { const n = X.parseCount(v.seatsLeft); if (n === undefined) errors.seatsLeft = err("countBad"); else doc.seatsLeft = n; }
    if (has(v, "seatsTotal")) { const n = X.parseCount(v.seatsTotal); if (n === undefined) errors.seatsTotal = err("countBad"); else doc.seatsTotal = n; }
    if (has(v, "videoUrl")) { const raw = String(v.videoUrl).trim(); if (!raw) doc.videoUrl = ""; else if (X.youtubeId(raw) || X.videoFile(raw)) doc.videoUrl = raw; else errors.videoUrl = err("videoBad"); }
  } else if (section === "after") {
    const idOk = (s) => /^[A-Za-z0-9_.:-]{1,100}$/.test(s);
    if (has(v, "albumId")) { const raw = String(v.albumId).trim(); if (!raw) doc.albumId = ""; else if (idOk(raw)) doc.albumId = raw; else errors.albumId = err("pickBad"); }
    if (has(v, "albumLink")) { const raw = String(v.albumLink).trim(); if (!raw) doc.albumLink = ""; else { const h = X.safeHref(raw); if (h && !h.startsWith("mailto:")) doc.albumLink = h; else errors.albumLink = err("urlBad"); } }
    if (has(v, "videoId")) { const raw = String(v.videoId).trim(); if (!raw) { doc.videoId = ""; doc.videoHint = ""; } else if (idOk(raw)) doc.videoId = raw; else errors.videoId = err("pickBad"); }
    if (has(v, "videoHint")) doc.videoHint = X.clean(v.videoHint, 120);
  }
  return errors;
}

export const SECTIONS = ["essential", "where", "program", "media", "after"];

/** Les vérifications qui regardent plusieurs champs à la fois. Renvoie { errors, notes }. */
export function finish(doc, zone) {
  const errors = {};
  const notes = [];
  if (!doc.title) errors.title = err("titleRequired");
  if (!doc.date) errors.date = err("dateRequired");
  if (!doc.time && doc.endTime) doc.endTime = "";
  if ((doc.lat === null) !== (doc.lng === null)) errors[doc.lat === null ? "lat" : "lng"] = err("coordPair");
  if (doc.seatsLeft !== null && doc.seatsTotal !== null && doc.seatsLeft > doc.seatsTotal) errors.seatsLeft = err("seatsOver", { total: doc.seatsTotal });
  if (doc.date) {
    const tz = doc.tz || zone;
    const t0 = M.times({ date: doc.date, time: doc.time, endDate: "", endTime: "" }, tz);
    if (t0 && t0.note) notes.push(t0.note);
    if (doc.endDate && doc.endDate < doc.date) errors.endDate = err("endBefore");
    else if (doc.endDate || doc.endTime) {
      const start = T.zonedToUtc(...dateArgs(doc.date, doc.time), tz).ms;
      const ed = doc.endDate || doc.date;
      const end = T.zonedToUtc(...dateArgs(ed, doc.time ? doc.endTime || doc.time : "00:00"), tz).ms;
      if (doc.time && end <= start) errors[doc.endTime ? "endTime" : "endDate"] = err("endBefore");
    }
  }
  return { errors, notes };
}
function dateArgs(date, time) {
  const d = T.parseDate(date), t = T.splitTime(time) ?? { h: 0, mi: 0 };
  return [d.y, d.mo, d.d, t.h, t.mi];
}

const stamp = () => new Date().toISOString();
/** Ajoute les erreurs de `more` pour les champs qui n'en ont pas déjà une (la plus précise gagne). */
const addMissing = (errors, more) => { for (const [k, v] of Object.entries(more)) if (!(k in errors)) errors[k] = v; };

/** Les repères dont les vérifications ont besoin. */
export function refOf(ctx, data) {
  return { types: data.types, zone: data.zone, zones: Z.ZONES.map((z) => z[0]) };
}

/** Construit (sans rien écrire) l'événement décrit par `values`, avec ses erreurs et ses remarques. Sert à créer, à vérifier un fichier avant de l'importer, et aux assistants. */
export function draftFrom(values, ref, by = "admin") {
  const doc = M.blank({ by });
  const errors = {};
  for (const s of SECTIONS) Object.assign(errors, applySection(doc, s, values, ref));
  const fin = finish(doc, ref.zone);
  addMissing(errors, fin.errors);
  return { doc, errors, notes: fin.notes };
}

/** Crée un événement. `values` : les champs de toutes les sections. `opts.by` : admin · assistant · import ; `opts.status` impose l'état de publication. */
export function createEvent(ctx, values, opts = {}) {
  return D.locked(ctx, async () => {
    const data = await D.load(ctx, { fresh: true });
    if (data.events.length >= X.LIMITS.events) return { ok: false, full: true, errors: {} };
    const { doc, errors, notes } = draftFrom(values, refOf(ctx, data), opts.by ?? "admin");
    if (Object.keys(errors).length) return { ok: false, errors };
    if (opts.status) doc.status = opts.status;
    doc.slug = M.uniqueSlug(new Set(data.events.map((e) => e.slug)), doc.title, doc.date);
    doc.updatedAt = stamp();
    if (doc.status === "published") doc.publishedAt = doc.updatedAt;
    const id = await ctx.api.store.add(D.C.events, M.toDoc(doc));
    return { ok: true, id, notes };
  });
}

/** Modifie un événement : seuls les champs présents dans `values` changent. `opts.toSeries` : les champs partagés suivent dans les prochains rendez-vous de la série. */
export function updateEvent(ctx, id, values, opts = {}) {
  return D.locked(ctx, async () => {
    const data = await D.load(ctx, { fresh: true });
    const current = data.byId.get(id);
    const row = current ? await D.getRow(ctx, id, "event") : null;
    if (!current || !row) return { ok: false, missing: true, errors: {} };
    const doc = M.toDoc(current);
    const ref = refOf(ctx, data);
    const errors = {};
    for (const s of opts.sections ?? SECTIONS) Object.assign(errors, applySection(doc, s, values, ref));
    const fin = finish(doc, data.zone);
    addMissing(errors, fin.errors);
    if (Object.keys(errors).length) return { ok: false, errors };
    if (opts.keepStatus) doc.status = current.status;
    if (doc.status === "published" && !doc.publishedAt) doc.publishedAt = stamp();
    doc.rev = current.rev + 1;
    doc.updatedAt = stamp();
    doc.by = current.by;
    await ctx.api.store.update(id, { ...row.data, ...doc });
    let series = 0;
    if (opts.toSeries && current.series) {
      for (const sibling of data.events) {
        if (sibling.id === id || sibling.series !== current.series || !(sibling.startMs > current.startMs)) continue;
        if (series >= X.LIMITS.occurrences) break;
        const r = await D.getRow(ctx, sibling.id, "event");
        if (!r) continue;
        const next = { ...r.data };
        for (const f of M.SERIES_FIELDS) next[f] = doc[f];
        next.rev = sibling.rev + 1;
        next.updatedAt = doc.updatedAt;
        await ctx.api.store.update(sibling.id, next);
        series++;
      }
    }
    return { ok: true, id, notes: fin.notes, series };
  });
}

/** Publie ou retire (brouillon) un événement. Les événements de la série restent comme ils sont. */
export function setStatus(ctx, id, status) {
  return D.locked(ctx, async () => {
    const row = await D.getRow(ctx, id, "event");
    if (!row || !M.STATUSES.includes(status)) return { ok: false };
    const now = stamp();
    await ctx.api.store.update(id, { ...row.data, status, publishedAt: status === "published" ? row.data.publishedAt || now : row.data.publishedAt ?? null, rev: (Number(row.data.rev) || 1) + 1, updatedAt: now });
    return { ok: true };
  });
}

export function removeEvent(ctx, id) {
  return D.locked(ctx, async () => {
    const row = await D.getRow(ctx, id, "event");
    if (!row) return { ok: false };
    await ctx.api.store.remove(id);
    return { ok: true };
  });
}

/** Une copie en BROUILLON (même jour : la personne change ce qu'il faut). La copie ne garde ni série, ni album, ni vidéo liée, ni état « annulé ». */
export function duplicateEvent(ctx, id, suffix) {
  return D.locked(ctx, async () => {
    const data = await D.load(ctx, { fresh: true });
    const src = data.byId.get(id);
    if (!src) return { ok: false, missing: true };
    if (data.events.length >= X.LIMITS.events) return { ok: false, full: true };
    const doc = M.toDoc(src);
    doc.title = X.clean(`${src.title} ${suffix}`, X.LIMITS.title);
    doc.status = "draft";
    doc.state = "ok";
    doc.series = "";
    doc.albumId = ""; doc.albumLink = ""; doc.videoId = ""; doc.videoHint = "";
    doc.seatsLeft = src.seatsTotal;
    doc.rev = 1;
    doc.by = "admin";
    doc.publishedAt = null;
    doc.updatedAt = stamp();
    doc.slug = M.uniqueSlug(new Set(data.events.map((e) => e.slug)), doc.title, doc.date || "x");
    return { ok: true, id: await ctx.api.store.add(D.C.events, doc) };
  });
}

/**
 * Répète un événement : crée les rendez-vous suivants (le premier est l'événement lui-même), chacun avec la même heure du mur.
 * Toute la série est écrite d'un coup (tout ou rien). Renvoie { ok, count, cut } ou { ok: false, error }.
 */
export function repeatEvent(ctx, id, rule) {
  return D.locked(ctx, async () => {
    const data = await D.load(ctx, { fresh: true });
    const base = data.byId.get(id);
    const row = base ? await D.getRow(ctx, id, "event") : null;
    if (!base || !row || base.broken) return { ok: false, error: "missing" };
    if (base.series) return { ok: false, error: "already" };
    const plan = M.repeatDates(base.date, rule);
    if (plan.why) return { ok: false, error: plan.why };
    const rest = plan.dates.slice(1);
    if (!rest.length) return { ok: false, error: "none" };
    if (data.events.length + rest.length > X.LIMITS.events) return { ok: false, error: "full", room: Math.max(0, X.LIMITS.events - data.events.length) };
    const series = randomUUID().replace(/-/g, "").slice(0, 10);
    const taken = new Set(data.events.map((e) => e.slug));
    const docs = rest.map((date) => {
      const doc = M.moveToDate(M.toDoc(base), date);
      doc.series = series;
      doc.state = "ok"; doc.albumId = ""; doc.albumLink = ""; doc.videoId = ""; doc.videoHint = "";
      doc.seatsLeft = base.seatsTotal ?? base.seatsLeft;
      doc.rev = 1;
      doc.publishedAt = base.status === "published" ? stamp() : null;
      doc.updatedAt = stamp();
      doc.slug = M.uniqueSlug(taken, doc.title, date);
      taken.add(doc.slug);
      return doc;
    });
    await ctx.api.store.update(id, { ...row.data, series, rev: base.rev + 1, updatedAt: stamp() });
    await D.addMany(ctx, D.C.events, docs);
    return { ok: true, count: docs.length + 1, cut: !!plan.cut };
  });
}

// ── Les types ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Crée ou modifie un type. `values` : names (objet langue → nom), color, icon. Renvoie { ok, id } ou { ok: false, errors }. */
export function saveType(ctx, id, values) {
  return D.locked(ctx, async () => {
    const data = await D.load(ctx, { fresh: true });
    const errors = {};
    const names = {};
    for (const [l, v] of Object.entries(values.names ?? {}).slice(0, 12)) { const n = X.clean(v, X.LIMITS.typeName); if (n) names[l] = n; }
    if (!Object.keys(names).length) errors.name = err("typeNameRequired");
    const color = values.color === undefined || values.color === "" ? TPL.DEFAULT_COLOR : values.color;
    if (!TPL.COLOR_KEYS.includes(color)) errors.color = err("colorBad");
    const icon = X.clean(values.icon, 8).replace(/[<>&"']/g, "");
    const current = id ? data.types.find((t) => t.id === id) : null;
    if (id && !current) return { ok: false, missing: true, errors: {} };
    const first = names[ctx.defaultLocale] ?? names.en ?? Object.values(names)[0] ?? "";
    const dup = data.types.find((t) => t.id !== id && Object.values(t.names).some((n) => X.fold(n) === X.fold(first)));
    if (dup && first) errors.name = err("typeDuplicate");
    if (Object.keys(errors).length) return { ok: false, errors };
    if (!current && data.types.length >= X.LIMITS.types) return { ok: false, full: true, errors: {} };
    if (current) {
      await ctx.api.store.update(id, { key: current.key, names, color, icon, pos: current.pos });
      return { ok: true, id };
    }
    const taken = new Set(data.types.map((t) => t.key));
    let key = X.slugify(names.en ?? first, 30, "type");
    for (let n = 2; taken.has(key) && n < 100; n++) key = `${X.slugify(names.en ?? first, 26, "type")}-${n}`;
    const pos = data.types.reduce((m, t) => Math.max(m, t.pos), 0) + 1;
    return { ok: true, id: await ctx.api.store.add(D.C.types, { key, names, color, icon, pos }) };
  });
}

export function removeType(ctx, id) {
  return D.locked(ctx, async () => {
    const row = await D.getRow(ctx, id, "type");
    if (!row) return { ok: false };
    await ctx.api.store.remove(id);
    return { ok: true };
  });
}

/** Monte (-1) ou descend (+1) un type dans la liste. */
export function moveType(ctx, id, delta) {
  return D.locked(ctx, async () => {
    const data = await D.load(ctx, { fresh: true });
    const list = data.types;
    const i = list.findIndex((t) => t.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) return { ok: false };
    const order = list.map((t) => t.id);
    [order[i], order[j]] = [order[j], order[i]];
    for (const [n, tid] of order.entries()) {
      const t = list.find((x) => x.id === tid);
      if (t.pos !== n + 1) { const row = await D.getRow(ctx, tid, "type"); if (row) await ctx.api.store.update(tid, { ...row.data, pos: n + 1 }); }
    }
    return { ok: true };
  });
}

/** Ajoute les types d'un gabarit (ceux qui n'existent pas déjà, par nom) et retient le choix. Renvoie le nombre de types ajoutés. */
export function applyStarter(ctx, starter, locales) {
  return D.locked(ctx, async () => {
    const def = TPL.STARTERS[starter];
    if (!def) return { ok: false };
    const data = await D.load(ctx, { fresh: true });
    const known = new Set(data.types.flatMap((t) => Object.values(t.names).map(X.fold)));
    const taken = new Set(data.types.map((t) => t.key));
    let pos = data.types.reduce((m, t) => Math.max(m, t.pos), 0);
    let added = 0;
    for (const t of def.types) {
      const label = t.names[ctx.defaultLocale] ?? t.names.en;
      if (known.has(X.fold(label)) || data.types.length + added >= X.LIMITS.types) continue;
      const names = {};
      for (const l of locales) names[l] = t.names[l] ?? t.names.en;
      let key = X.slugify(t.names.en, 30, "type");
      for (let n = 2; taken.has(key) && n < 100; n++) key = `${X.slugify(t.names.en, 26, "type")}-${n}`;
      taken.add(key);
      await ctx.api.store.add(D.C.types, { key, names, color: t.color, icon: t.icon, pos: ++pos });
      added++;
    }
    await D.writeMeta(ctx, starter);
    return { ok: true, added };
  });
}
