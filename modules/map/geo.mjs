// Carte : lire une position (latitude, longitude) dans ce que la personne colle : un lien Google Maps, OpenStreetMap, Apple Plans, Waze, Bing,
// un lien « geo: », ou simplement deux nombres (« 12.3456, 34.5678 », « 12,3456 N 34,5678 E », degrés-minutes-secondes).
// Aucun service de recherche d'adresse n'est interrogé : sans coordonnées dans le texte, on ne devine rien (voir `reason`).
// Fichier sans import : il peut être chargé seul par les tests.

const NUM = "[+-]?\\d{1,3}(?:[.,]\\d+)?";
const PAIR = new RegExp(`^\\(?\\s*(${NUM})\\s*°?\\s*([NSns])?\\s*[,;\\s]\\s*(${NUM})\\s*°?\\s*([EWOewo])?\\s*\\)?$`);
const DMS = /(\d{1,3})\s*°\s*(\d{1,2})\s*['′’]\s*(\d{1,2}(?:[.,]\d+)?)\s*(?:["″]|''|′′)?\s*([NSns])\s*[,;\s]*(\d{1,3})\s*°\s*(\d{1,2})\s*['′’]\s*(\d{1,2}(?:[.,]\d+)?)\s*(?:["″]|''|′′)?\s*([EWOewo])/;
const SHORT_HOSTS = /^(maps\.app\.goo\.gl|goo\.gl|g\.co|bit\.ly|tinyurl\.com|t\.co|l\.facebook\.com|share\.here\.com|what3words\.com)$/i;

const dec = (s) => Number(String(s).replace(",", "."));
const round6 = (n) => Math.round(n * 1e6) / 1e6;

/** Une position est utilisable : nombres finis, dans les bornes, et pas le point (0, 0) qui est presque toujours une position oubliée. */
export function validPosition(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

const ok = (lat, lng, from) => (validPosition(lat, lng) ? { ok: true, lat: round6(lat), lng: round6(lng), from } : null);

/** Deux nombres isolés, avec ou sans lettres de direction. */
function fromText(text) {
  const t = String(text).trim();
  const d = DMS.exec(t);
  if (d) {
    let lat = Number(d[1]) + Number(d[2]) / 60 + dec(d[3]) / 3600;
    let lng = Number(d[5]) + Number(d[6]) / 60 + dec(d[7]) / 3600;
    if (/s/i.test(d[4])) lat = -lat;
    if (/[wo]/i.test(d[8])) lng = -lng;
    return ok(lat, lng, "text");
  }
  const front = /^([NSns])\s*(\d{1,3}(?:[.,]\d+)?)\s*[,;\s]\s*([EWOewo])\s*(\d{1,3}(?:[.,]\d+)?)$/.exec(t);
  if (front) return ok((/s/i.test(front[1]) ? -1 : 1) * dec(front[2]), (/[wo]/i.test(front[3]) ? -1 : 1) * dec(front[4]), "text");
  const m = PAIR.exec(t);
  if (!m) return null;
  let lat = dec(m[1]);
  let lng = dec(m[3]);
  if (m[2] && /s/i.test(m[2])) lat = -Math.abs(lat);
  if (m[4] && /[wo]/i.test(m[4])) lng = -Math.abs(lng);
  return ok(lat, lng, "text");
}

function decodeURIComponent_(s) { try { return decodeURIComponent(s); } catch { return String(s); } }
const pairIn = (s) => (s == null ? null : fromText(decodeURIComponent_(s).replace(/\+/g, " ")));

/** Lit un lien. Rend une position, ou null. */
function fromUrl(url) {
  const q = url.searchParams;
  const full = decodeURIComponent_(url.pathname + url.search + url.hash);
  // Google : le repère posé (!3d…!4d…) est plus précis que le centre de la vue (@…)
  const pin = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(full);
  if (pin) return ok(Number(pin[1]), Number(pin[2]), "pin");
  // OpenStreetMap : ?mlat=…&mlon=… (repère), puis #map=zoom/lat/lng (centre de la vue)
  if (q.get("mlat") && q.get("mlon")) { const r = ok(dec(q.get("mlat")), dec(q.get("mlon")), "pin"); if (r) return r; }
  for (const key of ["q", "query", "ll", "sll", "coordinate", "destination", "daddr", "center", "viewpoint", "pll"]) {
    const v = q.get(key);
    if (v) { const r = pairIn(v); if (r) return r; }
  }
  const cp = q.get("cp");
  if (cp && cp.includes("~")) { const [a, b] = cp.split("~"); const r = ok(dec(a), dec(b), "view"); if (r) return r; }
  for (const [a, b] of [["lat", "lon"], ["lat", "lng"], ["lat", "long"], ["latitude", "longitude"], ["y", "x"]]) {
    if (q.get(a) && q.get(b)) { const r = ok(dec(q.get(a)), dec(q.get(b)), "pin"); if (r) return r; }
  }
  const osm = /#map=\d{1,2}\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/.exec(url.hash);
  if (osm) return ok(Number(osm[1]), Number(osm[2]), "view");
  const at = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(full);
  if (at) return ok(Number(at[1]), Number(at[2]), "view");
  const seg = /\/(?:search|place|dir)\/(-?\d+(?:\.\d+)?),\+?(-?\d+(?:\.\d+)?)(?:\/|$)/.exec(full);
  if (seg) return ok(Number(seg[1]), Number(seg[2]), "pin");
  const to = q.get("to");
  if (to) { const m = /(?:ll\.)?(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(to); if (m) return ok(Number(m[1]), Number(m[2]), "pin"); }
  return null;
}

/**
 * Lit ce que la personne a collé.
 * Rend { ok: true, lat, lng, from } ou { ok: false, reason } avec reason ∈ "empty" | "short" (lien raccourci : on ne le suit pas) | "none" (rien de lisible) | "range" (nombres hors limites).
 */
export function readPosition(input) {
  const raw = String(input ?? "").trim().slice(0, 2000);
  if (!raw) return { ok: false, reason: "empty" };
  const direct = fromText(raw);
  if (direct) return direct;
  const m = /(?:^|[\s<(])((?:https?|geo|maps):[^\s<>"')]+|(?:[a-z0-9-]+\.)+[a-z]{2,}\/[^\s<>"')]*)/i.exec(raw);
  const candidate = m ? m[1] : raw;
  const geo = /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i.exec(candidate);
  if (geo) { const r = ok(Number(geo[1]), Number(geo[2]), "pin"); if (r) return r; }
  let url = null;
  try { url = new URL(/^[a-z]+:/i.test(candidate) ? candidate : `https://${candidate}`); } catch { url = null; }
  if (url && /^https?:$/.test(url.protocol)) {
    if (SHORT_HOSTS.test(url.hostname) || /\bgoo\.gl\b/.test(url.hostname)) return { ok: false, reason: "short" };
    const r = fromUrl(url);
    if (r) return r;
  }
  const loose = new RegExp(`^\\(?\\s*(${NUM})\\s*[,;\\s]\\s*(${NUM})\\s*\\)?$`).exec(raw);
  if (loose) return { ok: false, reason: "range" };
  return { ok: false, reason: "none" };
}

/** Un nombre saisi dans un champ de coordonnées (virgule ou point). null si illisible. */
export function readNumber(value) {
  const t = String(value ?? "").trim().replace(/\s+/g, "").replace(",", ".");
  if (!/^[+-]?\d{1,3}(?:\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** La position d'un formulaire : lien collé (prioritaire), sinon deux champs. Rend { ok, lat, lng } ou { ok: false, field, reason } (field = champ en erreur). */
export function positionFromForm({ link, lat, lng }) {
  if (String(link ?? "").trim()) {
    const r = readPosition(link);
    if (r.ok) return { ok: true, lat: r.lat, lng: r.lng, fromLink: true };
    return { ok: false, field: "mapLink", reason: r.reason };
  }
  const a = readNumber(lat);
  const b = readNumber(lng);
  if (String(lat ?? "").trim() === "" && String(lng ?? "").trim() === "") return { ok: false, field: "mapLink", reason: "missing" };
  if (a === null) return { ok: false, field: "lat", reason: "number" };
  if (b === null) return { ok: false, field: "lng", reason: "number" };
  if (!validPosition(a, b)) return { ok: false, field: Math.abs(a) > 90 ? "lat" : "lng", reason: a === 0 && b === 0 ? "zero" : "range" };
  return { ok: true, lat: round6(a), lng: round6(b) };
}
