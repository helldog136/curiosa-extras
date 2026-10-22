// L'administration : « Mes liens » (créer, retrouver, voir le QR code et les chiffres, modifier, supprimer), les exports et la sauvegarde lisible.
//
// Tout ce qui est affiché en HTML passe par esc() : les adresses, les notes et les noms viennent de la personne (ou d'un assistant), jamais de confiance.
import { MAX_LINKS, allLinks, linkById, linkCount, linkPage, readStats, summarize } from "./data.mjs";
import { settle } from "./clicks.mjs";
import { cleanText, createLink, deleteLink, editLink, isEnded, qrFor, shortUrl, siteUrlLooksLocal } from "./links.mjs";
import { qrToSvg } from "./qr-render.mjs";
import { hostLabel } from "./url.mjs";

/** Le sigle qui fait lire correctement les accents aux tableurs (marque d'ordre des octets). */
const BOM = String.fromCharCode(0xfeff);

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Peut-on modifier ? (droit « links.edit » ; un cœur sans droits traite l'absence comme un refus.) */
const mayEdit = (ctx) => typeof ctx.can === "function" && ctx.can("links.edit");

function day(ctx, value) {
  const d = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return String(value ?? "");
  try {
    return new Intl.DateTimeFormat(ctx.locale, { dateStyle: "medium", timeZone: "UTC" }).format(d);
  } catch {
    return String(value);
  }
}

const number = (ctx, n) => {
  try {
    return new Intl.NumberFormat(ctx.locale).format(n);
  } catch {
    return String(n);
  }
};

/** Un message d'erreur sous un champ : ce qui ne va pas, un exemple, quoi faire. */
function errorText(ctx, field, code, suggestion) {
  if (field === "slug" && (code === "taken" || code === "reserved" || code === "chars" || code === "short" || code === "long")) {
    return ctx.t(`err_slug_${code}`, { name: suggestion ?? "boutique" });
  }
  return ctx.t(`err_${field}_${code}`);
}

function formErrors(ctx, result) {
  const errors = {};
  let general = "";
  for (const [field, code] of Object.entries(result.codes)) {
    if (field === "form") general = ctx.t(`err_form_${code}`, { max: MAX_LINKS });
    else errors[field] = errorText(ctx, field, code, result.suggestion);
  }
  return general ? { error: general } : { errors: errors };
}

// ── Les actions ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const adminActions = {
  create: {
    right: "links.edit",
    async run(ctx, values) {
      const result = await createLink(ctx, { url: values.url, slug: values.slug, title: values.title, expires: values.expires });
      if (!result.ok) return formErrors(ctx, result);
      return { ok: ctx.t("okCreated", { name: result.slug }), redirect: `?open=${encodeURIComponent(result.link.id)}&new=${result.suggested ? "2" : "1"}` };
    },
  },
  update: {
    right: "links.edit",
    async run(ctx, values) {
      const result = await editLink(ctx, String(values.id ?? ""), { url: values.url, title: values.title, expires: values.expires });
      if (!result.ok) return formErrors(ctx, result);
      return { ok: ctx.t("okSaved"), redirect: `?open=${encodeURIComponent(result.link.id)}&saved=1` };
    },
  },
  remove: {
    right: "links.edit",
    async run(ctx, values) {
      const result = await deleteLink(ctx, String(values.id ?? ""));
      if (!result.ok) return { error: ctx.t("err_form_gone") };
      return { ok: ctx.t("okRemoved", { name: result.link.slug }), redirect: "?removed=1" };
    },
  },
};

// ── Morceaux de page ────────────────────────────────────────────────────────────────────────────────────────────────────────
const box = "border:1px solid var(--v-line);border-radius:14px;background:var(--v-surface);padding:14px 16px";
const muted = "color:var(--v-muted);font-size:13px;line-height:1.45;overflow-wrap:anywhere";
const chip = (text, tone) => {
  const color = tone === "warn" ? "var(--v-warning)" : tone === "ok" ? "var(--v-success)" : "var(--v-muted)";
  return `<span style="display:inline-block;padding:2px 10px;border-radius:999px;border:1px solid ${color};color:${color};font-size:12px;font-weight:600;line-height:1.5">${esc(text)}</span>`;
};
const button = (href, label, { primary = false, download = false } = {}) =>
  `<a href="${esc(href)}"${download ? " download" : ""} style="display:inline-flex;align-items:center;justify-content:center;min-height:44px;box-sizing:border-box;padding:10px 18px;border-radius:12px;font-size:14px;font-weight:600;text-decoration:none;` +
  (primary ? "background:var(--v-accent);color:var(--v-accent-fg);border:1px solid var(--v-accent)" : "background:var(--v-surface);color:var(--v-fg);border:1px solid var(--v-line)") +
  `">${esc(label)}</a>`;

function statusChip(ctx, link) {
  if (isEnded(link)) return chip(ctx.t("chipEnded", { date: day(ctx, link.expires) }), "warn");
  if (link.expires) return chip(ctx.t("chipUntil", { date: day(ctx, link.expires) }), "info");
  return "";
}

/** Histogramme des 30 derniers jours : un dessin simple, avec un texte qui dit la même chose pour les lecteurs d'écran. */
function chart(ctx, sums) {
  if (sums.total === 0) return `<p style="${muted};margin:0">${esc(ctx.t("noClicksYet"))}</p>`;
  const series = sums.series;
  const max = Math.max(1, ...series.map((s) => s.n));
  const w = 300, h = 72, gap = 2;
  const bw = (w - gap * (series.length - 1)) / series.length;
  const bars = series
    .map((s, i) => {
      const bh = s.n === 0 ? 1 : Math.max(3, Math.round((s.n / max) * (h - 4)));
      return `<rect x="${(i * (bw + gap)).toFixed(2)}" y="${h - bh}" width="${bw.toFixed(2)}" height="${bh}" rx="1.5" fill="${s.n === 0 ? "var(--v-line)" : "var(--v-accent)"}"><title>${esc(day(ctx, s.day))} : ${esc(number(ctx, s.n))}</title></rect>`;
    })
    .join("");
  const top = series.reduce((a, b) => (b.n > a.n ? b : a), series[0]);
  const label = ctx.t("chartLabel", { month: sums.month, best: top.n, date: day(ctx, top.day) });
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}" style="display:block;width:100%;height:auto;max-height:110px">${bars}</svg>` +
    `<p style="${muted};display:flex;justify-content:space-between;margin:6px 0 0"><span>${esc(day(ctx, series[0].day))}</span><span>${esc(day(ctx, series[series.length - 1].day))}</span></p>`;
}

function numbers(ctx, sums) {
  const tile = (value, name) =>
    `<div style="flex:1 1 120px;min-width:0;${box};padding:10px 14px"><div style="font-size:24px;font-weight:700;line-height:1.2">${esc(number(ctx, value))}</div><div style="${muted}">${esc(name)}</div></div>`;
  return `<div style="display:flex;flex-wrap:wrap;gap:10px">${tile(sums.today, ctx.t("statToday"))}${tile(sums.week, ctx.t("statWeek"))}${tile(sums.month, ctx.t("statMonth"))}${tile(sums.total, ctx.t("statTotal"))}</div>`;
}

/** La destination en court : « boutique.example.org/mug-chat ». */
function destinationText(url) {
  if (String(url).startsWith("/")) return String(url);
  try {
    const u = new URL(url);
    return hostLabel(url) + (u.pathname !== "/" ? u.pathname : "");
  } catch {
    return String(url);
  }
}

function listCard(ctx, link, sums) {
  const where = destinationText(link.url);
  const shown = where.length > 70 ? `${where.slice(0, 69)}…` : where;
  return `<a href="?open=${encodeURIComponent(link.id)}" style="display:block;${box};color:inherit;text-decoration:none;min-height:44px">` +
    `<span style="display:flex;justify-content:space-between;align-items:baseline;gap:4px 12px;flex-wrap:wrap"><strong style="font-size:17px;overflow-wrap:anywhere">${esc(link.slug)}</strong>` +
    `<span style="font-size:13px;color:var(--v-muted)">${esc(ctx.t("clicksMonth", { count: number(ctx, sums.month), total: number(ctx, sums.total) }))}</span></span>` +
    `<span style="display:block;${muted};margin-top:3px">${esc(shown)}</span>` +
    (link.title ? `<span style="display:block;font-size:14px;margin-top:3px;overflow-wrap:anywhere">${esc(link.title)}</span>` : "") +
    (statusChip(ctx, link) ? `<span style="display:block;margin-top:8px">${statusChip(ctx, link)}</span>` : "") +
    `</a>`;
}

// ── Le panneau ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
const newForm = (ctx) => ({
  type: "adminForm",
  action: "create",
  title: ctx.t("newTitle"),
  submitLabel: ctx.t("newSubmit"),
  fields: [
    { name: "url", label: ctx.t("fieldUrl"), required: true, help: ctx.t("helpUrl") },
    { name: "slug", label: ctx.t("fieldSlug"), help: ctx.t("helpSlug") },
    { name: "title", label: ctx.t("fieldTitle"), help: ctx.t("helpTitle") },
    { name: "expires", label: ctx.t("fieldExpires"), kind: "date", help: ctx.t("helpExpires") },
  ],
});

function detailBlocks(ctx, link, stats, query) {
  const key = ctx.instance.key;
  const blocks = [];
  const built = qrFor(ctx, link.slug);
  const sums = summarize(stats);
  const url = shortUrl(ctx, link.slug);
  const q = encodeURIComponent(link.slug);
  const imageHref = (extra) => `/m/${encodeURIComponent(key)}/qr?c=${q}&dl=1&${extra}`;

  blocks.push({ type: "links", items: [{ label: ctx.t("backToList"), href: "?" }] });
  if (query.new) blocks.push({ type: "banner", tone: "success", text: ctx.t(query.new === "2" ? "bannerCreatedSuggested" : "bannerCreated", { name: link.slug }) });
  if (query.saved) blocks.push({ type: "banner", tone: "success", text: ctx.t("bannerSaved") });
  blocks.push({ type: "heading", text: link.slug });

  const info =
    `<div style="${box}"><p style="margin:0 0 4px;font-size:13px;color:var(--v-muted)">${esc(ctx.t("leadsTo"))}</p>` +
    `<p style="margin:0;overflow-wrap:anywhere;font-size:15px"><a href="${esc(link.url)}" target="_blank" rel="noopener noreferrer" style="color:var(--v-accent)">${esc(link.url.length > 140 ? `${link.url.slice(0, 139)}…` : link.url)}</a></p>` +
    (link.title ? `<p style="margin:8px 0 0;font-size:14px;overflow-wrap:anywhere">${esc(link.title)}</p>` : "") +
    (statusChip(ctx, link) ? `<p style="margin:8px 0 0">${statusChip(ctx, link)}</p>` : "") + `</div>`;
  blocks.push({ type: "html", html: info });

  if (built) {
    const svg = qrToSvg(built.qr, { label: ctx.t("qrLabel", { name: link.slug }) });
    blocks.push({ type: "heading", text: ctx.t("qrTitle") });
    blocks.push({
      type: "html",
      html:
        `<div style="display:flex;flex-wrap:wrap;gap:16px 24px;align-items:flex-start">` +
        `<div style="flex:0 0 auto;width:min(100%,260px);border:1px solid var(--v-line);border-radius:14px;overflow:hidden;background:#ffffff;line-height:0">${svg}</div>` +
        `<div style="flex:1 1 220px;min-width:0;display:flex;flex-direction:column;gap:10px">` +
        `<p style="margin:0;${muted}">${esc(ctx.t("qrHint"))}</p>` +
        button(imageHref("fmt=svg"), ctx.t("dlSvg"), { primary: true, download: true }) + `<p style="margin:-4px 0 0;${muted}">${esc(ctx.t("dlSvgHint"))}</p>` +
        button(imageHref("fmt=png&size=m"), ctx.t("dlPngM"), { download: true }) + `<p style="margin:-4px 0 0;${muted}">${esc(ctx.t("dlPngMHint"))}</p>` +
        button(imageHref("fmt=png&size=l"), ctx.t("dlPngL"), { download: true }) + `<p style="margin:-4px 0 0;${muted}">${esc(ctx.t("dlPngLHint"))}</p>` +
        `</div></div>`,
    });
    blocks.push({ type: "markdown", text: ctx.t("printTips") });
  } else {
    blocks.push({ type: "banner", tone: "warning", text: ctx.t("qrTooLong") });
  }
  blocks.push({ type: "copy", label: ctx.t("shortAddress"), text: url });

  blocks.push({ type: "heading", text: ctx.t("statsTitle") });
  blocks.push({ type: "html", html: `${numbers(ctx, sums)}<div style="margin-top:14px">${chart(ctx, sums)}</div>` });
  if (ctx.setting("countClicks") === false) blocks.push({ type: "banner", tone: "info", text: ctx.t("countingOff") });

  if (mayEdit(ctx)) {
    blocks.push({
      type: "adminForm",
      action: "update",
      title: ctx.t("editTitle"),
      submitLabel: ctx.t("editSubmit"),
      fields: [
        { name: "id", label: "id", kind: "hidden", value: link.id },
        { name: "url", label: ctx.t("fieldUrlEdit"), required: true, value: link.url, help: ctx.t("helpUrlEdit") },
        { name: "title", label: ctx.t("fieldTitle"), value: link.title, help: ctx.t("helpTitleEdit") },
        { name: "expires", label: ctx.t("fieldExpires"), kind: "date", value: link.expires, help: ctx.t("helpExpires") },
      ],
    });
    blocks.push({
      type: "table",
      columns: [ctx.t("removeTitle")],
      rows: [[ctx.t("removeText")]],
      rowIds: [link.id],
      rowActions: [{ label: ctx.t("removeButton"), action: "remove", confirm: ctx.t("removeConfirm", { name: link.slug }), danger: true }],
    });
  }
  return blocks;
}

async function listBlocks(ctx, query) {
  const blocks = [];
  const count = await linkCount(ctx);
  if (query.removed) blocks.push({ type: "banner", tone: "success", text: ctx.t("bannerRemoved") });
  if (mayEdit(ctx)) blocks.push(newForm(ctx));

  const search = cleanText(query.q, 60).toLowerCase();
  let items;
  let next = null;
  if (search) {
    items = (await allLinks(ctx)).filter((l) => `${l.slug} ${l.title} ${l.url}`.toLowerCase().includes(search)).slice(0, 50);
  } else {
    const page = await linkPage(ctx, { limit: 50, cursor: typeof query.cursor === "string" && query.cursor.length < 300 ? query.cursor : null });
    items = page.items;
    next = page.next;
  }

  blocks.push({ type: "heading", text: ctx.t("listTitle", { count, max: MAX_LINKS }) });
  if (count === 0) {
    blocks.push({ type: "markdown", text: ctx.t(mayEdit(ctx) ? "emptyList" : "emptyListRead") });
    return blocks;
  }
  if (count > 8 || search) {
    blocks.push({
      type: "html",
      html:
        `<form method="get" style="display:flex;gap:8px;flex-wrap:wrap" role="search"><input type="hidden" name="tab" value="use"><label style="position:absolute;left:-9999px" for="sl-q">${esc(ctx.t("searchLabel"))}</label>` +
        `<input id="sl-q" name="q" value="${esc(search)}" maxlength="60" placeholder="${esc(ctx.t("searchPlaceholder"))}" style="flex:1 1 200px;min-height:44px;box-sizing:border-box;padding:8px 14px;border-radius:12px;border:1px solid var(--v-line);background:var(--v-bg);color:var(--v-fg);font-size:15px">` +
        `<button type="submit" style="min-height:44px;padding:8px 18px;border-radius:12px;border:1px solid var(--v-line);background:var(--v-surface);color:var(--v-fg);font-size:14px;font-weight:600;cursor:pointer">${esc(ctx.t("searchButton"))}</button></form>`,
    });
  }
  if (items.length === 0) {
    blocks.push({ type: "markdown", text: ctx.t("noMatch") });
    return blocks;
  }
  const cards = [];
  for (const link of items) cards.push(listCard(ctx, link, summarize(await readStats(ctx, link.id))));
  blocks.push({ type: "html", html: `<div style="display:grid;gap:10px">${cards.join("")}</div>` });
  if (next) blocks.push({ type: "links", items: [{ label: ctx.t("seeMore"), href: `?cursor=${encodeURIComponent(next)}` }] });
  if (search) blocks.push({ type: "links", items: [{ label: ctx.t("clearSearch"), href: "?" }] });
  blocks.push({ type: "download", name: "stats", label: ctx.t("downloadStats") });
  return blocks;
}

export async function adminPanel(ctx, { query = {} } = {}) {
  const blocks = [];
  if (siteUrlLooksLocal(ctx)) blocks.push({ type: "banner", tone: "warning", text: ctx.t("localAddress", { site: ctx.api.siteUrl }) });
  const link = query.open ? await linkById(ctx, String(query.open).slice(0, 80)) : null;
  if (link) {
    await settle(ctx, link.id); // les chiffres comprennent les clics arrivés à l'instant
    blocks.push(...detailBlocks(ctx, link, await readStats(ctx, link.id), query));
  } else {
    if (query.open) blocks.push({ type: "banner", tone: "warning", text: ctx.t("err_form_gone") });
    blocks.push(...(await listBlocks(ctx, query)));
  }
  return blocks;
}

// ── Exports ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Une cellule de tableur : entre guillemets, et un « = », « + », « - » ou « @ » au début est neutralisé (sinon le tableur le lirait comme une formule). */
export function cell(value) {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Une ligne par lien et par jour, produite lien par lien : jamais tout en mémoire. */
export async function* statsRows(ctx) {
  yield `${["lien", "jour", "clics"].map(cell).join(",")}\r\n`;
  for (const link of await allLinks(ctx)) {
    const stats = await readStats(ctx, link.id);
    for (const d of Object.keys(stats.days).sort()) yield `${[link.slug, d, stats.days[d]].map(cell).join(",")}\r\n`;
  }
}

export const adminDownloads = {
  stats: {
    contentType: "text/csv",
    filename: () => "clics-par-jour",
    async *generate(ctx) {
      yield BOM;
      for await (const line of statsRows(ctx)) yield line;
    },
  },
};

export const backup = {
  async readable(ctx) {
    const links = await allLinks(ctx);
    const header = ["nom", "adresse courte", "destination", "note", "fin", "clics au total"].map(cell).join(",");
    const lines = [];
    for (const link of links) lines.push([link.slug, shortUrl(ctx, link.slug), link.url, link.title, link.expires, (await readStats(ctx, link.id)).total].map(cell).join(","));
    let clicks = "";
    for await (const line of statsRows(ctx)) clicks += line;
    return [
      { path: "liens.csv", content: `${BOM}${[header, ...lines].join("\r\n")}\r\n` },
      { path: "clics-par-jour.csv", content: `${BOM}${clicks}` },
    ];
  },
};

