// Which sponsor is on screen, decided by the SERVER CLOCK alone (no reporting from the page).
// Pure and deterministic. The functions below are used by the server (topic `home.info`) AND copied as text into the overlay page script
// (Function.prototype.toString), so each one must stay self-contained: no import, no reference to anything outside its own body.
// Neighbour file: dynamic, versioned import (docs/HOT-UPDATE.md).

/** Length of a slot in ms: the display period, never shorter than the hold time plus 2 seconds. */
export function slotMs(period, hold) {
  return Math.max(period, hold + 2) * 1000;
}

/** The sponsor id of a slot. Slots are grouped in cycles of n sponsors; each cycle is a deterministic shuffle of the ids (seeded by the cycle number),
 *  so every sponsor comes once per cycle. The first of a cycle never equals the last of the previous one (that cycle is a pure function too, no recursion).
 *  The order of `ids` and duplicates do not matter. null when there is no id. */
export function rotationPick(ids, slot) {
  var list = Array.from(new Set(ids)).sort(), n = list.length;
  if (!n) return null;
  if (n === 1) return list[0];
  var s = Math.floor(slot), cyc = Math.floor(s / n), pos = s - cyc * n;
  function perm(c) {
    if (n === 2) return list;   // a b a b: any shuffle of two would repeat across a boundary
    var p = list.slice(), a = ((c >>> 0) ^ 0x9e3779b9) >>> 0, i, j, t, r;
    for (i = n - 1; i > 0; i--) {
      a = (a + 0x6d2b79f5) >>> 0; t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      j = Math.floor(r * (i + 1)); t = p[i]; p[i] = p[j]; p[j] = t;
    }
    return p;
  }
  var cur = perm(cyc);
  // Only the first two places may move, so the last one (which the next cycle compares with) is the same in both spellings.
  if (pos < 2 && cur[0] === perm(cyc - 1)[n - 1]) cur = [cur[1], cur[0]].concat(cur.slice(2));
  return cur[pos];
}

/** What the server says is on screen at `now` (ms): the id of the slot's sponsor during the first `hold` seconds of the slot, else null. */
export function scheduledId(ids, now, period, hold) {
  const p = slotMs(period, hold);
  const slot = Math.floor(now / p);
  return now - slot * p < hold * 1000 ? rotationPick(ids, slot) : null;
}
