// Événements : l'export et l'import de fichier tableur (CSV), progressifs.
//  - Export : écrit ligne par ligne (jamais le fichier entier en mémoire), 2 000 événements au plus ; ouvre dans n'importe quel tableur.
//  - Import : on « vérifie d'abord » (rien n'est ajouté, on obtient un rapport ligne par ligne), puis on importe ce qui est bon. Un fichier réimporté ne crée pas de doublon
//    (même titre, même jour, même heure). Un type inconnu est créé. Les lignes en erreur sont dites avec leur numéro, leur colonne et un exemple ; les bonnes passent.
const q = new URL(import.meta.url).search;
const X = await import(`./text.mjs${q}`);
const M = await import(`./model.mjs${q}`);
const D = await import(`./data.mjs${q}`);
const O = await import(`./ops.mjs${q}`);
const TPL = await import(`./templates.mjs${q}`);

export const COLUMNS = ["title", "date", "time", "end_date", "end_time", "timezone", "type", "place", "latitude", "longitude", "description", "state", "publication", "signup_url", "seats_left", "seats_total", "image", "image_alt", "video_url", "program", "speakers"];

const ALIASES = {
  title: ["title", "titre", "nom", "name", "intitule"],
  date: ["date", "jour", "day", "date_debut", "start_date", "debut", "start"],
  time: ["time", "heure", "hour", "heure_debut", "start_time"],
  end_date: ["end_date", "date_fin", "fin", "jour_fin", "end"],
  end_time: ["end_time", "heure_fin"],
  timezone: ["timezone", "fuseau", "fuseau_horaire", "tz"],
  type: ["type", "categorie", "category"],
  place: ["place", "lieu", "location", "adresse", "address", "endroit"],
  latitude: ["latitude", "lat"],
  longitude: ["longitude", "lng", "lon", "long"],
  description: ["description", "texte", "text", "details", "detail"],
  state: ["state", "etat", "etat_evenement"],
  publication: ["publication", "status", "statut", "publie", "published"],
  signup_url: ["signup_url", "inscription", "lien_inscription", "registration", "signup"],
  seats_left: ["seats_left", "places_restantes", "restantes", "remaining"],
  seats_total: ["seats_total", "places", "places_totales", "capacite", "capacity"],
  image: ["image", "affiche", "photo", "poster"],
  image_alt: ["image_alt", "texte_alternatif", "alt"],
  video_url: ["video_url", "video"],
  program: ["program", "programme", "schedule"],
  speakers: ["speakers", "intervenants", "intervenant", "speaker"],
};
const headerKey = (h) => X.fold(h).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const COLUMN_OF = new Map(Object.entries(ALIASES).flatMap(([col, list]) => list.map((a) => [a, col])));

const STATE_WORDS = { ok: "ok", normal: "ok", normale: "ok", confirme: "ok", full: "full", complet: "full", cancelled: "cancelled", canceled: "cancelled", annule: "cancelled", postponed: "postponed", reporte: "postponed" };
const PUBLISH_WORDS = { published: "published", publie: "published", oui: "published", yes: "published", "1": "published", true: "published", draft: "draft", brouillon: "draft", non: "draft", no: "draft", "0": "draft", false: "draft" };

/** Le champ du formulaire → la colonne du fichier. */
const FIELD_COLUMN = { title: "title", date: "date", time: "time", endDate: "end_date", endTime: "end_time", tz: "timezone", type: "type", place: "place", lat: "latitude", lng: "longitude", text: "description", state: "state", status: "publication", signupUrl: "signup_url", seatsLeft: "seats_left", seatsTotal: "seats_total", image: "image", imageAlt: "image_alt", videoUrl: "video_url", program: "program", speakers: "speakers" };

/** Un texte de tableur → lignes de cellules. Gère les guillemets, les retours à la ligne dans une cellule, le séparateur « , » « ; » ou tabulation. `max` lignes au plus. */
export function parseCsv(text, max = X.LIMITS.importRows + 1) {
  const s = String(text ?? "").replace(/^﻿/, "");
  const firstLine = s.split(/\r?\n/, 1)[0] ?? "";
  const count = (c) => { let n = 0, inQ = false; for (const ch of firstLine) { if (ch === '"') inQ = !inQ; else if (ch === c && !inQ) n++; } return n; };
  const sep = [";", "\t", ","].map((c) => [c, count(c)]).sort((a, b) => b[1] - a[1])[0];
  const delimiter = sep[1] > 0 ? sep[0] : ",";
  const rows = [];
  let row = [], cell = "", inQ = false, truncated = false;
  const push = () => { row.push(cell); cell = ""; };
  const endRow = () => { push(); if (row.length > 1 || row[0].trim() !== "") rows.push(row); row = []; };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else inQ = false; } else cell += ch;
    } else if (ch === '"' && cell === "") inQ = true;
    else if (ch === delimiter) push();
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && s[i + 1] === "\n") i++; endRow(); if (rows.length >= max) { truncated = true; break; } }
    else cell += ch;
  }
  if (!truncated && (cell !== "" || row.length)) endRow();
  return { rows, delimiter, truncated };
}

// ── Export ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const exportRow = (ev) => [
  ev.title, ev.date, ev.time, ev.endDate, ev.endTime, ev.tz, ev.type, ev.place, ev.lat ?? "", ev.lng ?? "", ev.text, ev.state, ev.status, ev.signupUrl,
  ev.seatsLeft ?? "", ev.seatsTotal ?? "", ev.image, ev.imageAlt, ev.videoUrl, M.programText(ev.program), M.speakersText(ev.speakers),
];

/** Le fichier tableur de tous les événements, ligne par ligne (le type est écrit par son identifiant : il se relit à l'import). */
export async function* exportLines(ctx) {
  yield `﻿${COLUMNS.map(X.cell).join(",")}\r\n`;
  const data = await D.load(ctx, { fresh: true });
  for (const ev of data.events) yield `${exportRow(ev).map(X.cell).join(",")}\r\n`;
}

// ── Import ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const dupKey = (title, date, time) => `${X.fold(title)}|${date}|${time}`;

/**
 * Lit un fichier tableur. `dry` : ne rien écrire, seulement le rapport. `publish` : les lignes sans colonne « publication » sont publiées (sinon brouillons).
 * Rapport : { total, valid, created, duplicates, errors: [{ line, field, column, code, vars }], newTypes: [nom], unknownColumns: [nom], truncated, full }.
 */
export function importCsv(ctx, text, { dry = true, publish = false } = {}) {
  return D.locked(ctx, async () => {
    const parsed = parseCsv(text);
    const report = { total: 0, valid: 0, created: 0, duplicates: 0, errors: [], newTypes: [], unknownColumns: [], truncated: parsed.truncated, full: false, noTitleColumn: false };
    if (!parsed.rows.length) return { ...report, empty: true };
    const header = parsed.rows[0].map((h) => COLUMN_OF.get(headerKey(h)) ?? "");
    // le nom de la colonne tel qu'il est écrit dans le fichier (pour dire à la personne OÙ corriger)
    const columnOf = (field) => { const col = FIELD_COLUMN[field]; const i = header.indexOf(col); return X.clean(i >= 0 ? parsed.rows[0][i] : col ?? field, 40); };
    parsed.rows[0].forEach((h, i) => { if (!header[i] && X.clean(h, 40)) report.unknownColumns.push(X.clean(h, 40)); });
    if (!header.includes("title") || !header.includes("date")) return { ...report, noTitleColumn: true };
    const data = await D.load(ctx, { fresh: true });
    const known = new Set(data.events.map((e) => dupKey(e.title, e.date, e.time)));
    const slugs = new Set(data.events.map((e) => e.slug));
    const virtual = [...data.types];                         // les types existants + ceux que le fichier demande
    const wanted = new Map();                                // identifiant → type à créer
    const docs = [];
    const room = Math.max(0, X.LIMITS.events - data.events.length);
    for (let r = 1; r < parsed.rows.length; r++) {
      const cells = parsed.rows[r];
      const line = r + 1;
      const get = (col) => { const i = header.indexOf(col); return i < 0 ? undefined : String(cells[i] ?? "").trim(); };
      if (cells.every((c) => !String(c).trim())) continue;
      report.total++;
      if (docs.length >= room) { report.full = true; continue; }
      const values = {};
      for (const [col, field] of [["title", "title"], ["date", "date"], ["time", "time"], ["end_date", "endDate"], ["end_time", "endTime"], ["timezone", "tz"], ["place", "place"], ["latitude", "lat"], ["longitude", "lng"], ["description", "text"], ["signup_url", "signupUrl"], ["seats_left", "seatsLeft"], ["seats_total", "seatsTotal"], ["image", "image"], ["image_alt", "imageAlt"], ["video_url", "videoUrl"], ["program", "program"], ["speakers", "speakers"]]) {
        const v = get(col);
        if (v !== undefined) values[field] = col === "description" || col === "program" || col === "speakers" ? String(cells[header.indexOf(col)] ?? "") : v;
      }
      let rowError = null;
      const typeRaw = get("type");
      if (typeRaw) {
        let t = O.matchType(virtual, typeRaw);
        if (!t) {
          const name = X.clean(typeRaw, X.LIMITS.typeName);
          if (virtual.length >= X.LIMITS.types) rowError = { field: "type", code: "typeFull", vars: { max: X.LIMITS.types } };
          else {
            const base = X.slugify(name, 30, "type");
            t = { id: "", key: base + (virtual.some((x) => x.key === base) ? `-${virtual.length}` : ""), names: { [ctx.defaultLocale]: name }, color: TPL.COLOR_KEYS[virtual.length % 5], icon: "", pos: virtual.length + 1 };
            virtual.push(t);
            wanted.set(t.key, t);
          }
        }
        if (t) values.type = t.key;
      }
      const state = get("state");
      if (state) { const s = STATE_WORDS[X.fold(state).replace(/[^a-z0-9]/g, "")]; if (s) values.state = s; else rowError ??= { field: "state", code: "stateBad" }; }
      const pub = get("publication");
      values.status = publish ? "published" : "draft";
      if (pub) { const s = PUBLISH_WORDS[X.fold(pub).replace(/[^a-z0-9]/g, "")]; if (s) values.status = s; else rowError ??= { field: "publication", code: "publicationBad" }; }
      const { doc, errors } = O.draftFrom(values, { types: virtual, zone: data.zone, zones: [] }, "import");
      if (rowError) errors[rowError.field] = { code: rowError.code, vars: rowError.vars };
      const first = Object.entries(errors)[0];
      if (first) { report.errors.push({ line, field: first[0], column: columnOf(first[0]), code: first[1].code, vars: first[1].vars }); continue; }
      const key = dupKey(doc.title, doc.date, doc.time);
      if (known.has(key)) { report.duplicates++; continue; }
      known.add(key);
      report.valid++;
      doc.slug = M.uniqueSlug(slugs, doc.title, doc.date);
      slugs.add(doc.slug);
      doc.updatedAt = new Date().toISOString();
      if (doc.status === "published") doc.publishedAt = doc.updatedAt;
      docs.push(doc);
    }
    report.newTypes = [...wanted.values()].filter((t) => docs.some((d) => d.type === t.key)).map((t) => Object.values(t.names)[0]);
    if (dry || !docs.length) return report;
    for (const t of wanted.values()) {
      if (!docs.some((d) => d.type === t.key)) continue;
      await ctx.api.store.add(D.C.types, { key: t.key, names: t.names, color: t.color, icon: t.icon, pos: t.pos });
    }
    await D.addMany(ctx, D.C.events, docs.map((d) => M.toDoc(d)));
    report.created = docs.length;
    return report;
  });
}
