// Lecteur STRICT d'un fichier d'agenda (RFC 5545), pour vérifier ce que produit le module « countdown » sans faire confiance à son propre code.
// Il ne lit pas « ce qu'il peut » : au moindre écart (fin de ligne, ligne trop longue, échappement faux, propriété manquante) il lève une erreur qui dit où.
const enc = new TextEncoder();

/** Défait le pliage : une ligne qui commence par une espace ou une tabulation continue la précédente. */
export function unfold(text) {
  return text.replace(/\r\n[ \t]/g, "");
}

/** Défait la protection d'un texte (\\ \; \, \n). Lève une erreur sur un échappement inconnu : une barre oblique seule est interdite. */
export function unescapeText(value) {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c !== "\\") {
      if (c === ";" || c === ",") throw new Error(`« ${c} » doit être protégé dans un texte : ${value.slice(0, 60)}`);
      out += c;
      continue;
    }
    const n = value[++i];
    if (n === "\\" || n === ";" || n === ",") out += n;
    else if (n === "n" || n === "N") out += "\n";
    else throw new Error(`échappement inconnu \\${n} dans : ${value.slice(0, 60)}`);
  }
  return out;
}

/**
 * Lit un fichier et renvoie { calendar: { props }, events: [{ props }] }. `props[NOM]` = [{ params, value }].
 * Vérifie : fins de ligne CRLF partout, 75 octets au plus par ligne PHYSIQUE, imbrication BEGIN/END, UTF-8 valide.
 */
export function parseIcs(text) {
  if (typeof text !== "string") throw new Error("le fichier n'est pas du texte");
  if (/(^|[^\r])\n/.test(text)) throw new Error("fin de ligne « LF » seule : le fichier doit utiliser CRLF");
  if (!text.endsWith("\r\n")) throw new Error("le fichier doit finir par CRLF");
  for (const physical of text.split("\r\n")) {
    const n = enc.encode(physical).length;
    if (n > 75) throw new Error(`ligne de ${n} octets (75 au plus) : ${physical.slice(0, 40)}…`);
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(physical)) throw new Error("caractère de contrôle dans une ligne");
  }
  const lines = unfold(text).split("\r\n");
  if (lines.pop() !== "") throw new Error("ligne finale vide attendue");
  const stack = [];
  const calendar = { props: {} };
  const events = [];
  let current = null;
  for (const line of lines) {
    const m = /^([A-Za-z0-9-]+)((?:;[A-Za-z0-9-]+=[^:;]+)*):(.*)$/s.exec(line);
    if (!m) throw new Error(`ligne illisible : ${line.slice(0, 60)}`);
    const [, rawName, rawParams, value] = m;
    const name = rawName.toUpperCase();
    const params = Object.fromEntries(rawParams.split(";").filter(Boolean).map((p) => p.split("=")).map(([k, v]) => [k.toUpperCase(), v]));
    if (name === "BEGIN") {
      stack.push(value);
      if (value === "VEVENT") current = { props: {} };
      continue;
    }
    if (name === "END") {
      const top = stack.pop();
      if (top !== value) throw new Error(`END:${value} ne ferme pas BEGIN:${top}`);
      if (value === "VEVENT") { events.push(current); current = null; }
      continue;
    }
    const target = current ?? (stack.length === 1 ? calendar : null);
    if (!target) throw new Error(`propriété hors d'un composant : ${name}`);
    (target.props[name] ??= []).push({ params, value });
  }
  if (stack.length) throw new Error(`composant non fermé : ${stack.join(",")}`);
  return { calendar, events };
}

const one = (ev, name) => {
  const list = ev.props[name];
  if (!list || list.length !== 1) throw new Error(`${name} doit apparaître exactement une fois (trouvé ${list?.length ?? 0})`);
  return list[0];
};
const instant = (v) => {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(v);
  if (!m) throw new Error(`date-heure UTC invalide : ${v}`);
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
};
const day = (v) => {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (!m) throw new Error(`date invalide : ${v}`);
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
};

/** Vérifie les règles d'un fichier valide et renvoie les événements sous une forme simple. */
export function validateIcs(text) {
  const { calendar, events } = parseIcs(text);
  if (calendar.props.VERSION?.[0]?.value !== "2.0") throw new Error("VERSION:2.0 attendu");
  if (!calendar.props.PRODID?.[0]?.value) throw new Error("PRODID manquant");
  if (!events.length) throw new Error("aucun VEVENT");
  const uids = new Set();
  return events.map((ev) => {
    const uid = one(ev, "UID").value;
    if (!uid || uids.has(uid)) throw new Error(`UID absent ou répété : ${uid}`);
    uids.add(uid);
    const stamp = instant(one(ev, "DTSTAMP").value);
    const start = one(ev, "DTSTART");
    const end = one(ev, "DTEND");
    const allDay = start.params.VALUE === "DATE";
    if ((end.params.VALUE === "DATE") !== allDay) throw new Error("DTSTART et DTEND doivent avoir le même type");
    const s = allDay ? day(start.value) : instant(start.value);
    const e = allDay ? day(end.value) : instant(end.value);
    if (!(e > s)) throw new Error("DTEND doit venir après DTSTART");
    if (!allDay && (start.params.TZID || end.params.TZID)) throw new Error("heures en UTC attendues (suffixe Z), sans TZID");
    const text1 = (name) => (ev.props[name] ? unescapeText(one(ev, name).value) : undefined);
    const seq = ev.props.SEQUENCE ? Number(one(ev, "SEQUENCE").value) : 0;
    if (!Number.isInteger(seq) || seq < 0) throw new Error("SEQUENCE invalide");
    return { uid, stamp, allDay, start: s, end: e, summary: text1("SUMMARY"), description: text1("DESCRIPTION"), location: text1("LOCATION"), url: ev.props.URL?.[0]?.value, sequence: seq, status: ev.props.STATUS?.[0]?.value, lastModified: ev.props["LAST-MODIFIED"] ? instant(one(ev, "LAST-MODIFIED").value) : undefined };
  });
}
