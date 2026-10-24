// Événements : chercher, filtrer, découper en pages, et les adresses de la page publique.
// La page publique n'a pas de paramètres d'adresse (le cœur ne donne au module que le chemin) : les choix de la personne vivent dans le chemin
//   /agenda                        les prochains            /agenda/t/atelier/q/dessin/p/2   un type, des mots, la page 2
//   /agenda/cal/2026-11            le calendrier du mois    /agenda/past                     les événements passés
//   /agenda/e/atelier-2026-11-14   la fiche d'un événement
// Ce fichier ne connaît ni le stockage ni l'horloge (l'heure « maintenant » est donnée par l'appelant).
const q = new URL(import.meta.url).search;
const X = await import(`./text.mjs${q}`);
const T = await import(`./time.mjs${q}`);

const MAX_SEGMENTS = 9;

/** Les mots d'une recherche, nettoyés : minuscules sans accents, lettres et chiffres, 6 mots au plus, 80 caractères au plus. */
export function words(raw) {
  return X.fold(X.clean(raw, X.LIMITS.query)).split(/[^a-z0-9]+/).filter(Boolean).slice(0, 6);
}

/** Le chemin lu par la page publique → ce qui est demandé, ou null (page introuvable). */
export function parsePath(segments) {
  const segs = Array.isArray(segments) ? segments.map(String) : [];
  if (segs.length > MAX_SEGMENTS) return null;
  const out = { mode: "list", type: "", words: [], page: 1, month: "", slug: "" };
  let i = 0;
  if (segs[0] === "e") {
    const slug = X.safeSlug(segs[1]);
    return segs.length === 2 && slug && slug === segs[1] ? { ...out, mode: "event", slug } : null;
  }
  if (segs[0] === "cal") {
    out.mode = "cal";
    i = 1;
    if (segs[1] !== undefined && /^\d{4}-\d{2}$/.test(segs[1])) {
      if (!T.parseMonth(segs[1])) return null;
      out.month = segs[1];
      i = 2;
    }
  } else if (segs[0] === "past") { out.mode = "past"; i = 1; }
  const seen = new Set();
  for (; i < segs.length; i += 2) {
    const key = segs[i], val = segs[i + 1];
    if (val === undefined || seen.has(key)) return null;
    seen.add(key);
    if (key === "t") { const t = X.safeSlug(val); if (!t || t !== val) return null; out.type = t; }
    else if (key === "q") { const w = words(val.replace(/-/g, " ")); if (!w.length) return null; out.words = w; }
    else if (key === "p") { if (out.mode === "cal" || !/^[1-9]\d{0,3}$/.test(val)) return null; out.page = Number(val); }
    else return null;
  }
  return out;
}

/** Le chemin d'une demande (sans la base ni la langue). `""` = les prochains, sans filtre. */
export function buildPath(r) {
  const parts = [];
  if (r.mode === "event") return `/e/${r.slug}`;
  if (r.mode === "cal") { parts.push("cal"); if (r.month) parts.push(r.month); }
  else if (r.mode === "past") parts.push("past");
  if (r.type) parts.push("t", r.type);
  if (r.words?.length) parts.push("q", r.words.join("-"));
  if (r.page > 1 && r.mode !== "cal") parts.push("p", String(r.page));
  return parts.length ? `/${parts.join("/")}` : "";
}

/** Un événement répond-il au filtre (type et mots) ? Les mots cherchent dans le titre, le lieu, le texte, les intervenants et le nom du type. */
export function matches(ev, filter, typeNames) {
  if (filter.type && ev.type !== filter.type) return false;
  if (!filter.words?.length) return true;
  const hay = X.fold(`${ev.title} ${ev.place} ${ev.text} ${ev.speakers.map((s) => `${s.name} ${s.role}`).join(" ")} ${typeNames.get(ev.type) ?? ""} ${ev.program.map((s) => s.title).join(" ")}`);
  return filter.words.every((w) => hay.includes(w));
}

/** Les événements publics à venir (ou en cours), du plus proche au plus lointain. Annulé et reporté restent visibles, avec leur étiquette. */
export const upcoming = (events, now, filter, typeNames) => events.filter((e) => e.endMs > now && matches(e, filter, typeNames));
/** Les événements passés (rétrospective), du plus récent au plus ancien. Un événement annulé ou reporté n'a pas eu lieu : il n'y figure pas. */
export const past = (events, now, filter, typeNames) => events.filter((e) => e.endMs <= now && e.state !== "cancelled" && e.state !== "postponed" && matches(e, filter, typeNames)).reverse();

/** Une page d'une liste : { items, pages, page }. `page` est ramené dans les bornes. */
export function paginate(list, page, per) {
  const pages = Math.max(1, Math.ceil(list.length / per));
  const p = Math.min(Math.max(1, page), pages);
  return { items: list.slice((p - 1) * per, p * per), pages, page: p, total: list.length };
}

/** Les événements d'un mois, rangés par jour : Map « AAAA-MM-JJ » → événements. Un événement sur plusieurs jours figure sur chacun. */
export function byDay(events, firstDay, lastDay, filter, typeNames) {
  const map = new Map();
  for (const e of events) {
    if (e.lastDay < firstDay || e.date > lastDay || !matches(e, filter, typeNames)) continue;
    let d = e.date < firstDay ? firstDay : e.date;
    const end = e.lastDay > lastDay ? lastDay : e.lastDay;
    for (let n = 0; d <= end && n < 40; n++) {
      if (!map.has(d)) map.set(d, []);
      map.get(d).push(e);
      d = T.addDays(d, 1);
    }
  }
  return map;
}

// ── Pages par curseur (assistant IA, sources d'événements) ─────────────────────────────────────────────────────────────
const encode = (e) => Buffer.from(JSON.stringify({ i: e.id, s: e.startMs })).toString("base64url");
const decode = (c) => {
  if (typeof c !== "string" || !/^[A-Za-z0-9_-]{1,260}$/.test(c)) return null;
  try { const o = JSON.parse(Buffer.from(c, "base64url").toString("utf8")); return typeof o?.i === "string" && Number.isFinite(o?.s) ? o : null; } catch { return null; }
};
/** Une page d'une liste déjà triée : { items, next }. Un curseur dont l'événement a disparu reprend après son heure ; un curseur illisible redonne la première page. */
export function cursorPage(list, cursor, limit, dir = 1) {
  const n = Math.min(100, Math.max(1, Math.trunc(Number(limit)) || 30));
  const c = decode(cursor);
  let from = 0;
  if (c) {
    const at = list.findIndex((e) => e.id === c.i);
    from = at >= 0 ? at + 1 : list.findIndex((e) => (dir > 0 ? e.startMs > c.s : e.startMs < c.s));
    if (from < 0) from = list.length;
  }
  const items = list.slice(from, from + n);
  return { items, next: from + n < list.length && items.length ? encode(items[items.length - 1]) : null };
}
