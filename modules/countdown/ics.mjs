// Compte à rebours — le fichier « Ajouter à mon agenda » (.ics, RFC 5545).
//
// Ce que garantit ce fichier :
//  - lignes terminées par CRLF, jamais plus de 75 octets par ligne (pliage sans couper un caractère accentué ou un émoji) ;
//  - textes protégés : \ ; , et retours à la ligne ;
//  - UID STABLE (celui de l'événement, jamais refait : ajouter deux fois le même événement le met à jour, il ne se duplique pas) ;
//  - DTSTAMP et LAST-MODIFIED = la dernière modification de l'événement (le même fichier est produit à chaque téléchargement) ;
//  - SEQUENCE augmente à chaque modification : les agendas déjà abonnés mettent l'événement à jour ;
//  - heures données en heure universelle (suffixe Z) : l'instant est exact quel que soit le fuseau de l'agenda, sans définition
//    de fuseau à embarquer ; un événement « toute la journée » est une date (VALUE=DATE), sans heure.
const V = new URL(import.meta.url).search;
const { icsStamp } = await import(`./time.mjs${V}`);

const enc = new TextEncoder();

/** Plie une ligne à 75 octets au plus (la suite commence par une espace, qui compte dans les 75). Ne coupe jamais un caractère en deux. */
export function fold(line) {
  const out = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > 75) {
      out.push(cur);
      cur = " ";
      bytes = 1;
    }
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
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

const dateValue = (isoDay) => isoDay.replace(/-/g, "");

/**
 * Un événement (vu par `view()` de model.mjs) → les lignes d'un VEVENT.
 * `url` : adresse de la page de l'événement (ou vide). Une URL doit être absolue et sans espace.
 */
export function eventLines(ev, { url = "" } = {}) {
  const lines = ["BEGIN:VEVENT", `UID:${ev.uid}@curiosa`, `DTSTAMP:${icsStamp(Date.parse(ev.updatedAt) || 0)}`, `LAST-MODIFIED:${icsStamp(Date.parse(ev.updatedAt) || 0)}`, `SEQUENCE:${Math.max(0, ev.rev | 0)}`];
  lines.push(`SUMMARY:${escapeText(ev.title)}`);
  if (ev.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${dateValue(ev.date)}`, `DTEND;VALUE=DATE:${dateValue(ev.endForCalendar.date)}`);
  } else {
    lines.push(`DTSTART:${icsStamp(ev.startMs)}`, `DTEND:${icsStamp(ev.endForCalendar.ms)}`);
  }
  if (ev.description) lines.push(`DESCRIPTION:${escapeText(ev.description)}`);
  if (ev.where) lines.push(`LOCATION:${escapeText(ev.where)}`);
  if (url && /^https?:\/\/[^\s]+$/.test(url)) lines.push(`URL:${url}`);
  lines.push("STATUS:CONFIRMED", "TRANSP:OPAQUE", "END:VEVENT");
  return lines;
}

/** Un fichier d'agenda complet pour un ou plusieurs événements. */
export function buildCalendar(events, { urlFor = () => "" } = {}) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Curiosa//Countdown//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const ev of events) lines.push(...eventLines(ev, { url: urlFor(ev) }));
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
