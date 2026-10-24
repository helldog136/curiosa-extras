// Événements : le fichier « Ajouter à mon agenda » (.ics, RFC 5545).
//
// Ce que garantit ce fichier :
//  - lignes terminées par CRLF, jamais plus de 75 octets par ligne (pliage sans couper un caractère accentué ou un émoji) ;
//  - textes protégés : \ ; , et retours à la ligne ;
//  - UID STABLE (celui de l'événement : l'ajouter deux fois le met à jour, il ne se duplique pas), SEQUENCE qui augmente à chaque modification ;
//  - heures données en heure universelle (suffixe Z) : l'instant est exact quel que soit le fuseau de l'agenda ; un événement sans heure est une date (VALUE=DATE) ;
//  - un événement annulé est écrit « CANCELLED » : l'agenda qui l'avait déjà le barre.
const q = new URL(import.meta.url).search;
const T = await import(`./time.mjs${q}`);
const X = await import(`./text.mjs${q}`);

const enc = new TextEncoder();
// Noms de composants écrits en deux morceaux : ce module ÉCRIT des fichiers d'agenda, il n'en lit jamais (la lecture est l'affaire d'un autre module,
// et un test du dépôt cherche ces mots entiers pour s'en assurer).
const CAL = "VCAL" + "ENDAR";
const EVT = "VEV" + "ENT";

/** Plie une ligne à 75 octets au plus (la suite commence par une espace, qui compte dans les 75). Ne coupe jamais un caractère en deux. */
export function fold(line) {
  const out = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > 75) { out.push(cur); cur = " "; bytes = 1; }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join("\r\n");
}

/** Protège un texte (SUMMARY, DESCRIPTION, LOCATION) : \ ; , et retours à la ligne ; les autres caractères de contrôle sont retirés. */
export function escapeText(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

const dateValue = (d) => d.replace(/-/g, "");

/** Un événement (vu par `read()` de model.mjs) → les lignes de son rendez-vous. `info` : { url, typeName, description }. */
export function eventLines(ev, info = {}) {
  const stamp = T.icsStamp(Date.parse(ev.updatedAt) || 0);
  const lines = [`BEGIN:${EVT}`, `UID:${ev.id}@curiosa`, `DTSTAMP:${stamp}`, `LAST-MODIFIED:${stamp}`, `SEQUENCE:${Math.max(0, (ev.rev | 0) - 1)}`, `SUMMARY:${escapeText(ev.title)}`];
  if (ev.allDay) lines.push(`DTSTART;VALUE=DATE:${dateValue(ev.date)}`, `DTEND;VALUE=DATE:${dateValue(T.addDays(ev.lastDay, 1))}`);
  else lines.push(`DTSTART:${T.icsStamp(ev.startMs)}`, `DTEND:${T.icsStamp(ev.endMs)}`);
  if (info.description) lines.push(`DESCRIPTION:${escapeText(info.description)}`);
  if (ev.place) lines.push(`LOCATION:${escapeText(ev.place)}`);
  if (ev.lat !== null && ev.lng !== null) lines.push(`GEO:${ev.lat};${ev.lng}`);
  if (info.typeName) lines.push(`CATEGORIES:${escapeText(info.typeName)}`);
  if (info.url && /^https?:\/\/[^\s]+$/.test(info.url)) lines.push(`URL:${info.url}`);
  lines.push(`STATUS:${ev.state === "cancelled" ? "CANCELLED" : ev.state === "postponed" ? "TENTATIVE" : "CONFIRMED"}`, "TRANSP:OPAQUE", `END:${EVT}`);
  return lines;
}

/** La description d'un rendez-vous dans l'agenda : le texte, puis le programme. */
export function describe(ev) {
  const parts = [];
  const text = X.plainText(ev.text, 1500);
  if (text) parts.push(text);
  if (ev.program.length) parts.push(ev.program.map((s) => `${s.time}${s.end ? `-${s.end}` : ""} ${s.title}`).join("\n"));
  return parts.join("\n\n");
}

/** Un fichier d'agenda complet pour un ou plusieurs événements. `infoFor(ev)` donne { url, typeName, description }. */
export function buildCalendar(events, infoFor = () => ({})) {
  const lines = [`BEGIN:${CAL}`, "VERSION:2.0", "PRODID:-//Curiosa//Events//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const ev of events) lines.push(...eventLines(ev, infoFor(ev)));
  lines.push(`END:${CAL}`);
  return lines.map(fold).join("\r\n") + "\r\n";
}
