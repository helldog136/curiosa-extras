// Small pure functions of the OBS dock. The page runs the SAME source (`fn.toString()` is put in the page), and the tests run it here: what is tested is what runs.
// Each function must stay self-contained (no import, no outer variable).

/** "just now", "2 minutes ago" (in the language of the page); a date in the future counts as now. */
export function relTime(at, now, locale) {
  var s = Math.max(0, Math.round((now - at) / 1000)), rtf;
  try { rtf = new Intl.RelativeTimeFormat(locale || "en", { numeric: "auto", style: "short" }); } catch (e) { rtf = null; }
  if (!rtf) return s < 60 ? "<1 min" : Math.round(s / 60) + " min";
  if (s < 45) return rtf.format(0, "second");
  if (s < 3600) return rtf.format(-Math.max(1, Math.round(s / 60)), "minute");
  if (s < 86400) return rtf.format(-Math.round(s / 3600), "hour");
  return rtf.format(-Math.round(s / 86400), "day");
}

/** The wait before the next read: 3 s while all goes well, then 6, 12, 24, 30 s (at most) after each failure in a row. */
export function nextDelay(failures) {
  if (!failures) return 3000;
  return Math.min(30000, 3000 * Math.pow(2, failures));
}

/** Which lines the dock shows: `f` = { type: "" | kind group, q: text }; type is a prefix of the kind ("hype" covers hype_begin, hype_progress, hype_end). Newest first as received. */
export function visible(events, f) {
  var q = String((f && f.q) || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  var t = (f && f.type) || "";
  return events.filter(function (e) {
    if (t && e.kind !== t && e.kind.indexOf(t + "_") !== 0) return false;
    if (!q) return true;
    return (e.label + " " + e.name + " " + e.detail).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").indexOf(q) >= 0;
  });
}
