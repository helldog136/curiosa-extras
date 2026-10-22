// Témoignages — l'administration : lire et décider (valider, refuser, mettre en avant), modifier, ajouter un avis reçu ailleurs, partager le lien, exporter.
const v = new URL(import.meta.url).search;
const L = await import(`./lib.mjs${v}`);
const D = await import(`./data.mjs${v}`);

export const RIGHTS = { moderate: "reviews.moderate", delete: "reviews.delete", email: "email.view", export: "reviews.export" };
/** `ctx.can` n'existe pas sur un cœur ancien (et reste faux hors de l'administration) : l'absence vaut un refus. */
export const can = (ctx, right) => typeof ctx.can === "function" && ctx.can(right) === true;

const word = (ctx, status) => ctx.t(`status_${status}`);
const notFound = () => Object.assign(new Error("review not found"), { expose: true });
const excerpt = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ── Le lien à partager et son QR code ──────────────────────────────────────────────────────────────────────────────
/** L'adresse du formulaire, dans la langue par défaut du site (une personne qui préfère une autre langue la change sur la page). */
export function shareUrl(ctx) {
  const b = ctx.instance.basePath;
  if (b === null || b === undefined) return null;
  return `${ctx.api.siteUrl}${b ? `/${b}` : ""}/laisser`;
}
/** Le QR code avec une marge blanche (le cœur le fabrique sur fond transparent, illisible sur un fond sombre ou imprimé sur du papier de couleur). */
export function framedQr(svg) {
  const m = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(svg);
  const inner = /^<svg[^>]*>([\s\S]*)<\/svg>\s*$/.exec(String(svg));
  if (!m || !inner) return String(svg);
  const w = Number(m[1]), h = Number(m[2]);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 ${w + 8} ${h + 8}" shape-rendering="crispEdges"><rect x="-4" y="-4" width="${w + 8}" height="${h + 8}" fill="#ffffff"/>${inner[1]}</svg>`;
}

function shareBlocks(ctx, qr) {
  const url = shareUrl(ctx);
  if (!url) return [{ type: "banner", tone: "warning", text: ctx.t("shareNoPage"), tab: "share" }];
  return [
    { type: "heading", text: ctx.t("shareTitle"), tab: "share" },
    { type: "markdown", text: ctx.t("shareHelp"), tab: "share" },
    { type: "copy", text: url, label: ctx.t("shareCopy"), tab: "share" },
    ...(qr ? [{ type: "html", html: `<div style="background:#fff;padding:12px;border-radius:12px;width:min(100%,220px);line-height:0" role="img" aria-label="${L.esc(ctx.t("qrAlt"))}">${framedQr(qr)}</div>`, tab: "share" }] : []),
    { type: "links", items: [{ label: ctx.t("qrDownload"), href: `/m/${ctx.instance.key}/qr` }, { label: ctx.t("shareOpen"), href: url }], tab: "share" },
    { type: "markdown", text: ctx.t("shareHome"), tab: "share" },
  ];
}

// ── Le panneau ──────────────────────────────────────────────────────────────────────────────────────────────────────
const STATUS_LIST = ["pending", "approved", "rejected"];
const query = (o) => { const p = new URLSearchParams(); for (const [k, val] of Object.entries(o)) if (val !== undefined && val !== null && val !== "") p.set(k, String(val)); const s = p.toString(); return s ? `?${s}` : "?"; };

export async function panel(ctx, { query: q0 } = {}) {
  const q = q0 && typeof q0 === "object" ? q0 : {};
  const all = await D.readAll(ctx);
  const count = Object.fromEntries(STATUS_LIST.map((s) => [s, all.filter((r) => r.status === s).length]));
  const status = STATUS_LIST.includes(q.status) ? q.status : count.pending ? "pending" : "approved";
  const stars = /^[1-5]$/.test(String(q.stars ?? "")) ? Number(q.stars) : null;
  const needle = L.clean(q.q, 100).toLowerCase();
  const withEmail = can(ctx, RIGHTS.email);
  const blocks = [];

  if (count.pending) blocks.push({ type: "banner", tone: "info", text: ctx.t("bannerPending", { count: count.pending }) });
  else if (!all.length) blocks.push({ type: "markdown", text: ctx.t("emptyAdmin") });

  // Modifier ou ajouter : le formulaire s'ouvre en haut de page.
  const editing = q.edit ? all.find((r) => r.id === String(q.edit)) : undefined;
  if (editing) blocks.push(...editForm(ctx, editing, withEmail));
  else if (String(q.add) === "1") blocks.push(addForm(ctx));
  else if (can(ctx, RIGHTS.moderate)) blocks.push({ type: "links", items: [{ label: ctx.t("addLink"), href: "?add=1" }] });

  const published = all.filter(L.isPublic);
  const stats = L.summarize(published);
  blocks.push({ type: "heading", text: ctx.t("adminTitle", { count: all.length }) });
  if (stats.rated >= 1) blocks.push({ type: "markdown", text: ctx.t("adminStats", { avg: L.formatAverage(stats.average, ctx.locale), rated: stats.rated, published: published.length }) });

  blocks.push({ type: "links", items: STATUS_LIST.map((s) => ({ label: `${status === s ? "● " : ""}${ctx.t(`tab_${s}`, { count: count[s] })}`, href: query({ status: s }) })) });
  blocks.push({ type: "links", items: [{ label: `${stars === null ? "● " : ""}${ctx.t("allStars")}`, href: query({ status, q: needle }) }, ...[5, 4, 3, 2, 1].map((n) => ({ label: `${stars === n ? "● " : ""}${ctx.t("nStarsShort", { n })}`, href: query({ status, stars: n, q: needle }) }))] });
  blocks.push({ type: "adminForm", action: "search", submitLabel: ctx.t("searchButton"), fields: [{ name: "status", label: "status", kind: "hidden", value: status }, { name: "stars", label: "stars", kind: "hidden", value: stars ?? "" }, { name: "q", label: ctx.t("searchLabel"), kind: "text", value: needle, help: ctx.t("searchHelp") }] });

  const list = all
    .filter((r) => r.status === status && (stars === null || r.rating === stars))
    .filter((r) => !needle || [r.name, r.text, withEmail ? r.email ?? "" : ""].some((s) => s.toLowerCase().includes(needle)))
    .sort((a, b) => b.at - a.at);
  const pages = Math.max(1, Math.ceil(list.length / L.ADMIN_PER_PAGE));
  const page = Math.min(pages, L.num(q.page, 1, 1, 100000));
  const slice = list.slice((page - 1) * L.ADMIN_PER_PAGE, page * L.ADMIN_PER_PAGE);

  if (!slice.length) blocks.push({ type: "markdown", text: ctx.t(all.length ? "emptyFilter" : "emptyAdmin") });
  else {
    const actions = status === "pending"
      ? [{ label: ctx.t("actApprove"), action: "approve" }, { label: ctx.t("actReject"), action: "reject" }, { label: ctx.t("actEdit"), href: "?edit={id}" }]
      : status === "approved"
        ? [{ label: ctx.t("actFavorite"), action: "feature" }, { label: ctx.t("actUnpublish"), action: "unpublish" }, { label: ctx.t("actEdit"), href: "?edit={id}" }]
        : [{ label: ctx.t("actRestore"), action: "restore" }];
    if (can(ctx, RIGHTS.delete)) actions.push({ label: ctx.t("actDelete"), action: "remove", confirm: ctx.t("confirmDelete"), danger: true });
    blocks.push({
      type: "table",
      // L'état se lit déjà sur l'onglet choisi : on ne le répète que pour les avis publiés (favori, modifié).
      columns: [ctx.t("colDate"), ctx.t("colName"), ctx.t("colRating"), ctx.t("colReview"), ...(status === "approved" ? [ctx.t("colState")] : []), ...(withEmail ? [ctx.t("colEmail")] : [])],
      rows: slice.map((r) => [L.isoDay(r.at), r.name, r.rating ? ctx.t("ratingShort", { n: r.rating }) : "—", excerpt(r.text, 120), ...(status === "approved" ? [`${word(ctx, r.status)}${r.featured ? ` · ★ ${ctx.t("favorite")}` : ""}${r.editedAt ? ` · ${ctx.t("edited")}` : ""}`] : []), ...(withEmail ? [r.email ?? "—"] : [])]),
      rowIds: slice.map((r) => r.id),
      rowActions: actions,
    });
    blocks.push({ type: "markdown", text: ctx.t("rangeInfo", { from: (page - 1) * L.ADMIN_PER_PAGE + 1, to: (page - 1) * L.ADMIN_PER_PAGE + slice.length, total: list.length }) });
    const nav = [];
    if (page > 1) nav.push({ label: ctx.t("prevPage"), href: query({ status, stars, q: needle, page: page - 1 }) });
    if (page < pages) nav.push({ label: ctx.t("nextPage"), href: query({ status, stars, q: needle, page: page + 1 }) });
    if (nav.length) blocks.push({ type: "links", items: nav });
  }
  if (status === "rejected") blocks.push({ type: "markdown", text: ctx.t("rejectedNote", { days: L.REFUSED_KEEP_DAYS }) });
  if (status === "pending" && slice.length) blocks.push({ type: "markdown", text: ctx.t("moderationTip") });

  blocks.push({ type: "heading", text: ctx.t("exportTitle") });
  blocks.push({ type: "markdown", text: ctx.t("exportHelp") });
  blocks.push({ type: "download", name: "reviews", label: ctx.t("exportButton"), params: { emails: "0" } });
  if (withEmail) blocks.push({ type: "download", name: "reviews", label: ctx.t("exportButtonEmails"), params: { emails: "1" } });

  const qr = shareUrl(ctx) ? await ctx.api.qr(shareUrl(ctx)).catch(() => null) : null;
  blocks.push(...shareBlocks(ctx, qr));
  return blocks;
}

const ratingOptions = (ctx) => [{ value: "", label: ctx.t("noRating") }, ...[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: ctx.t("ratingShort", { n }) }))];

function editForm(ctx, r, withEmail) {
  const fields = [
    { name: "id", label: "id", kind: "hidden", value: r.id },
    { name: "name", label: ctx.t("colName"), kind: "text", required: true, value: r.name },
    { name: "text", label: ctx.t("colReview"), kind: "textarea", required: true, value: r.text, help: ctx.t("editHelp") },
    { name: "rating", label: ctx.t("colRating"), kind: "select", options: ratingOptions(ctx), value: r.rating ? String(r.rating) : "" },
    { name: "photo", label: ctx.t("photoLabel"), kind: "image", value: r.photo ?? "", help: ctx.t("photoHelp") },
    { name: "featured", label: ctx.t("featuredLabel"), kind: "checkbox", value: r.featured ? "on" : "" },
    { name: "position", label: ctx.t("positionLabel"), kind: "number", value: r.position ?? "", help: ctx.t("positionHelp") },
  ];
  if (r.email) fields.push({ name: "clearEmail", label: withEmail ? ctx.t("clearEmailNamed", { email: r.email }) : ctx.t("clearEmail"), kind: "checkbox", value: "", help: ctx.t("clearEmailHelp") });
  const consent = r.consentAt ? ctx.t("consentRecord", { date: L.day(r.consentAt, ctx.locale), who: ctx.t(r.consentBy === "owner" ? "consentByOwner" : "consentByVisitor"), text: r.consentText }) : ctx.t("consentNone");
  return [{ type: "markdown", text: consent }, { type: "adminForm", action: "save", title: ctx.t("editTitle"), submitLabel: ctx.t("save"), cancelHref: "?", fields }];
}

function addForm(ctx) {
  return {
    type: "adminForm", action: "add", title: ctx.t("addTitle"), submitLabel: ctx.t("addSubmit"), cancelHref: "?",
    fields: [
      { name: "name", label: ctx.t("colName"), kind: "text", required: true },
      { name: "text", label: ctx.t("colReview"), kind: "textarea", required: true, help: ctx.t("addTextHelp") },
      { name: "rating", label: ctx.t("colRating"), kind: "select", options: ratingOptions(ctx), value: "" },
      { name: "consent", label: ctx.t("ownerConsentLabel"), kind: "checkbox", value: "", help: ctx.t("ownerConsentHelp") },
    ],
  };
}

// ── Les actions ────────────────────────────────────────────────────────────────────────────────────────────────────
const now = () => Date.now();
/** Publie : seulement un avis dont l'auteur a donné son accord, et jamais au-delà du plafond. */
export async function approveRule(ctx, r, all = null) {
  if (!r.consentAt) return "errNoConsent";
  if (r.status === "approved") return null;
  const published = (all ?? await D.readAll(ctx)).filter((x) => x.status === "approved").length;
  return published >= L.MAX_PUBLISHED ? "errFull" : null;
}
export async function decide(ctx, id, action) {
  const r = await D.readOne(ctx, id);
  if (!r) return { error: "errNotFound" };
  const t = now();
  let next;
  if (action === "approve") {
    const problem = await approveRule(ctx, r);
    if (problem) return { error: problem };
    next = { ...r, status: "approved", decidedAt: t, publishedAt: r.publishedAt || t };
  } else if (action === "reject") next = { ...r, status: "rejected", featured: false, decidedAt: t };
  else if (action === "pending") next = { ...r, status: "pending", featured: false, decidedAt: t };
  else if (action === "feature") next = { ...r, featured: !r.featured };
  else if (action === "unfeature") next = { ...r, featured: false };
  else return { error: "errNotFound" };
  await D.save(ctx, next);
  return { review: next };
}
const run = (action) => async (ctx, values) => { const r = await decide(ctx, values.id, action); return r.error ? { error: ctx.t(r.error) } : { ok: ctx.t(`ok_${action}`) }; };

function validateEdit(ctx, values) {
  const errors = {};
  const name = L.clean(values.name, L.FIELD_MAX.name);
  const text = L.clean(values.text, L.FIELD_MAX.text, true);
  if (!name) errors.name = ctx.t("errEditName");
  if (!text) errors.text = ctx.t("errEditText");
  const ratingRaw = String(values.rating ?? "").trim();
  const rating = /^[1-5]$/.test(ratingRaw) ? Number(ratingRaw) : null;
  if (ratingRaw !== "" && rating === null) errors.rating = ctx.t("errEditRating");
  const posRaw = String(values.position ?? "").trim();
  const position = posRaw === "" ? null : /^\d{1,4}$/.test(posRaw) && Number(posRaw) >= 1 ? Number(posRaw) : undefined;
  if (position === undefined) errors.position = ctx.t("errEditPosition");
  return { errors, name, text, rating, position: position ?? null };
}

export const actions = {
  approve: { right: RIGHTS.moderate, run: run("approve") },
  reject: { right: RIGHTS.moderate, run: run("reject") },
  unpublish: { right: RIGHTS.moderate, run: run("pending") },
  restore: { right: RIGHTS.moderate, run: run("pending") },
  feature: { right: RIGHTS.moderate, run: run("feature") },
  remove: {
    right: RIGHTS.delete,
    run: async (ctx, values) => {
      if (!(await D.readOne(ctx, values.id))) return { error: ctx.t("errNotFound") };
      await D.remove(ctx, values.id);
      return { ok: ctx.t("okDeleted") };
    },
  },
  // Chercher : un simple aller-retour vers la même page avec les filtres dans l'adresse.
  search: async (ctx, values) => ({ redirect: query({ status: STATUS_LIST.includes(values.status) ? values.status : undefined, stars: /^[1-5]$/.test(String(values.stars ?? "")) ? values.stars : undefined, q: L.clean(values.q, 100) }) }),
  save: {
    right: RIGHTS.moderate,
    run: async (ctx, values) => {
      const r = await D.readOne(ctx, values.id);
      if (!r) return { error: ctx.t("errNotFound") };
      const e = validateEdit(ctx, values);
      if (Object.keys(e.errors).length) return { errors: e.errors };
      await D.save(ctx, {
        ...r, name: e.name, text: e.text, rating: e.rating, position: e.position, photo: L.safeSrc(values.photo), featured: values.featured === "on",
        email: values.clearEmail === "on" ? null : r.email, emailUntil: values.clearEmail === "on" ? 0 : r.emailUntil,
        editedAt: e.name !== r.name || e.text !== r.text || e.rating !== r.rating ? now() : r.editedAt,
      });
      return { ok: ctx.t("okSaved"), redirect: "?" };
    },
  },
  // Un avis reçu ailleurs (message, e-mail, commentaire) : il entre « en attente » comme les autres, avec l'accord noté comme recueilli par vous.
  add: {
    right: RIGHTS.moderate,
    run: async (ctx, values) => {
      const e = validateEdit(ctx, { ...values, position: "" });
      if (values.consent !== "on") e.errors.consent = ctx.t("errOwnerConsent");
      if (Object.keys(e.errors).length) return { errors: e.errors };
      if ((await ctx.api.store.count(L.COLLECTION)) >= L.MAX_STORED) return { error: ctx.t("errFull") };
      const t = now();
      await D.create(ctx, { id: "", at: t, status: "pending", name: e.name, text: e.text, rating: e.rating, featured: false, position: null, photo: null, email: null, emailUntil: 0, consentAt: t, consentText: ctx.t("ownerConsentRecord"), consentBy: "owner", consentLocale: ctx.locale, tokenHash: "", decidedAt: 0, publishedAt: 0, editedAt: 0 });
      return { ok: ctx.t("okAdded"), redirect: "?status=pending" };
    },
  },
};

// ── Le fichier à télécharger (tableur) et la sauvegarde lisible ───────────────────────────────────────────────────────
const stamp = () => new Date().toISOString().slice(0, 10);
function header(ctx, emails) {
  return [ctx.t("colDate"), ctx.t("colState"), ctx.t("favorite"), ctx.t("colRating"), ctx.t("colName"), ctx.t("colReview"), ctx.t("colConsentDate"), ctx.t("colConsentBy"), ctx.t("colConsentText"), ...(emails ? [ctx.t("colEmail"), ctx.t("colEmailUntil")] : [])];
}
function line(ctx, r, emails) {
  return [L.isoDay(r.at), word(ctx, r.status), r.featured ? ctx.t("yes") : "", r.rating ?? "", r.name, r.text, r.consentAt ? new Date(r.consentAt).toISOString() : "", r.consentAt ? ctx.t(r.consentBy === "owner" ? "consentByOwner" : "consentByVisitor") : "", r.consentText, ...(emails ? [r.email ?? "", r.emailUntil ? L.isoDay(r.emailUntil) : ""] : [])];
}
async function* csv(ctx, emails) {
  const sep = L.csvSeparator(ctx.locale);
  yield `﻿${L.csvLine(header(ctx, emails), sep)}`;
  for await (const r of D.eachReview(ctx)) yield L.csvLine(line(ctx, r, emails), sep);
}
export const downloads = {
  reviews: {
    right: RIGHTS.export, contentType: "text/csv",
    filename: (ctx) => `${ctx.t("exportFile")}-${stamp()}`,
    // Les adresses e-mail ne sortent que si la personne a AUSSI le droit de les voir, même si elle a coché « avec les adresses ».
    generate: (ctx, params) => csv(ctx, params?.emails === "1" && can(ctx, RIGHTS.email)),
  },
};
export async function backupFiles(ctx) {
  let content = "";
  for await (const chunk of csv(ctx, false)) content += chunk;
  return [{ path: "reviews.csv", content }];
}

// ── Pastille du menu : les avis qui attendent ─────────────────────────────────────────────────────────────────────
export async function pendingCount(ctx) { return (await D.readAll(ctx)).filter((r) => r.status === "pending").length; }
