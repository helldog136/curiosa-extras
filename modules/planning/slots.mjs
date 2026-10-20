// Planning : les créneaux reçus des calendriers (sujet `planning.slot`), mis au format que lisent les apparences. Fonctions PURES : ni réseau, ni stockage,
// ni horloge cachée, aucune exception sur des données absurdes. Le Planning ne sait pas d'où viennent les créneaux : il les prend tels que le cœur les lui donne.
const V = new URL(import.meta.url).search;
const { zonedTimeToUtc, addDaysToWall } = await import(`./dates.mjs${V}`);

export const MAX_GAMES_PER_STREAM = 3;
const DAY = 86_400_000;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function validZone(tz) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return typeof tz === "string" && tz.length > 0; } catch { return false; }
}
const toDate = (v) => { const d = new Date(v); return typeof v === "string" && !Number.isNaN(d.getTime()) ? d : null; };

/** Les jeux d'un créneau (la liste donnée par son calendrier, 3 au plus). */
export const gamesOf = (slot) => (Array.isArray(slot?.games) ? slot.games : []);

/**
 * Le fuseau d'affichage : celui que l'administrateur a choisi dans les réglages du Planning ; sinon celui des calendriers (le plus fréquent parmi les
 * créneaux reçus, à égalité le premier) ; sinon UTC. Un nom inconnu est ignoré.
 */
export function displayZone(setting, items) {
  const chosen = String(setting ?? "").trim();
  if (validZone(chosen)) return chosen;
  const count = new Map();
  for (const it of Array.isArray(items) ? items : []) { const z = it?.timezone; if (validZone(z)) count.set(z, (count.get(z) ?? 0) + 1); }
  let best = "UTC", n = 0;
  for (const [z, c] of count) if (c > n) { best = z; n = c; }
  return best;
}

/**
 * Éléments du sujet `planning.slot` -> créneaux { uid, title, games, start, end, allDay, cancelled } (Dates), triés par début, sans doublon.
 * Journée entière : la date donnée par le calendrier (`day`) fait foi, lue dans le fuseau d'affichage `tz` (jamais décalée d'un jour) ; la durée en jours est gardée.
 * Un créneau illisible (début absent ou absurde) est écarté seul. Deux calendriers qui annoncent le même stream (même titre, mêmes heures) n'en font qu'un.
 */
export function toSlots(items, tz = "UTC") {
  const out = [], seen = new Set();
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it !== "object") continue;
    let start = toDate(it.start);
    if (!start) continue;
    let end = toDate(it.end);
    const allDay = it.allDay === true;
    const day = allDay && typeof it.day === "string" ? DAY_RE.exec(it.day) : null;
    if (day) {
      const [y, m, d] = [Number(day[1]), Number(day[2]), Number(day[3])];
      const span = end ? Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY)) : 1;
      const last = addDaysToWall(y, m, d, span);
      start = zonedTimeToUtc(y, m, d, 0, 0, 0, tz);
      end = zonedTimeToUtc(last.y, last.m, last.d, 0, 0, 0, tz);
    } else if (!end || end.getTime() < start.getTime()) end = new Date(start.getTime() + (allDay ? DAY : 3_600_000));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
    const title = String(it.title ?? "");
    const key = `${title}|${start.getTime()}|${end.getTime()}|${allDay}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const games = (Array.isArray(it.games) ? it.games : []).filter((g) => typeof g === "string").map((g) => g.trim()).filter(Boolean).slice(0, MAX_GAMES_PER_STREAM);
    out.push({ uid: String(it.id ?? ""), title, games, start, end, allDay, cancelled: it.status === "cancelled" });
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime() || a.title.localeCompare(b.title));
}
