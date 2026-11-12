// How a journal line is described in words (shared by the admin page and the OBS dock): the colour of its badge, who, and the details ("12 months · tier 2", "500 bits").
/** Colour of the badge of each kind (always written next to it: the colour alone never carries the meaning). */
export const TONE = { follow: "ok", sub: "accent", resub: "accent", gift: "accent", cheer: "warn", raid: "info", online: "ok", offline: "neutral", hype_begin: "warn", hype_progress: "warn", hype_end: "neutral", redeem: "neutral" };

const fmtDate = (ctx, at) => new Date(at).toLocaleString(ctx.locale, { dateStyle: "short", timeStyle: "short", timeZone: ctx.timezone });
const num = (ctx, n) => new Intl.NumberFormat(ctx.locale).format(n);

/** The details of a line, in words: "12 months · tier 2", "500 bits", "42 viewers"… */
export function detail(ctx, d) {
  const t = ctx.t, p = [];
  const tier = d.tier ? t("d_tier", { n: d.tier }) : "";
  switch (d.kind) {
    case "sub": p.push(d.gifted ? t("d_gifted") : tier); break;
    case "resub": p.push(t("d_months", { n: d.months ?? 0 }), tier); break;
    case "gift": p.push(t("d_gift", { n: d.count ?? 0 }), tier); break;
    case "cheer": p.push(t("d_bits", { n: num(ctx, d.amount ?? 0) })); break;
    case "raid": p.push(t("d_viewers", { n: num(ctx, d.viewers ?? 0) })); break;
    case "hype_begin": case "hype_progress": case "hype_end": p.push(t("d_level", { n: d.level ?? 1 }), t("d_points", { n: num(ctx, d.total ?? 0) })); break;
    case "redeem": p.push(d.title ?? "", d.amount ? t("d_cost", { n: num(ctx, d.amount) }) : ""); break;
    default: break;
  }
  if (d.source === "test") p.push(t("d_test"));
  if (d.source === "replay") p.push(t("d_replay"));
  if (d.missed) p.push(t("d_missed"));
  return p.filter(Boolean).join(" · ");
}
export const who = (ctx, d) => (d.anonymous ? ctx.t("anonymous") : d.name || "");

