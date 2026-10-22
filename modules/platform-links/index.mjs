// Autres plateformes — module communautaire de Curiosa.
//
// UN SEUL propriétaire pour cette liste de liens (OnlyFans, Mym, Fansly, Patreon, Ko-fi… ou « Autre »). Les icônes ne sont PAS redessinées ici :
// comme tous les réseaux du site, le module fournit ses boutons au cœur (sujet `social.link`), qui les range dans l'en-tête, au même endroit,
// avec le même rendu que Instagram, Bluesky, Twitch, YouTube…
//
// Un lien peut passer par une page d'avertissement (« contenu pour adultes ») : le bouton du site mène alors à /m/<clé>/go?l=<clé du lien>, une page
// simple, sans JavaScript, qui n'est jamais indexée. Sans avertissement, l'icône mène directement à la destination.
// La destination vient TOUJOURS de la configuration (jamais d'un paramètre de l'adresse visitée) ; l'origine des visites (utm_*) est ajoutée côté serveur.
import {
  MAX_LINKS, PLATFORMS, cleanLabel, cleanText, destinationOf, flag, inOrder, isKey, isPlatform, move, newKey,
  normalizeUrl, originChoice, platformById, shouldAddOrigin, shouldWarn, warnChoice,
} from "./links.mjs";

const COLLECTION = "links";
const RIGHT = "links.edit";

/* ───────────── Lecture ───────────── */

const bool = (v, d) => flag(v, d);

/** Les liens enregistrés, dans l'ordre choisi. Une ligne illisible est ignorée, jamais fatale. */
export async function readLinks(ctx) {
  const rows = await ctx.api.store.list(COLLECTION, { limit: 100 });
  const out = [];
  for (const r of rows) {
    const d = r.data ?? {};
    if (typeof d.url !== "string" || !isKey(d.key)) continue;
    out.push({
      id: r.id, at: new Date(r.createdAt ?? 0).getTime() || 0, key: d.key, platform: isPlatform(d.platform) ? d.platform : "other",
      url: d.url, label: cleanLabel(d.label), visible: d.visible !== false, warn: warnChoice(d.warn), origin: originChoice(d.origin),
      order: Number.isFinite(Number(d.order)) ? Number(d.order) : 0,
    });
  }
  return inOrder(out);
}

function siteHostOf(ctx) {
  try { return new URL(String(ctx.api.siteUrl)).hostname.toLowerCase(); } catch { return ""; }
}

/** Les réglages utiles aux adresses et à l'avertissement (valeurs par défaut sensées si rien n'est réglé). */
export function configOf(ctx) {
  return {
    warnAdult: bool(ctx.setting("warnAdult"), true),
    originEnabled: bool(ctx.setting("originEnabled"), true),
    campaign: cleanLabel(ctx.setting("originCampaign"), 60),
    perLinkOrigin: bool(ctx.setting("perLinkOrigin"), false),
    siteHost: siteHostOf(ctx),
  };
}

const nameOf = (ctx, link) => link.label || (link.platform === "other" ? ctx.t("platformOther") : platformById(link.platform).name);

/* ───────────── Écriture (administration ET assistant IA) ───────────── */

const sameUrl = (a, b) => String(a).toLowerCase().replace(/\/+$/, "") === String(b).toLowerCase().replace(/\/+$/, "");

/**
 * Ajoute (existingId absent) ou modifie un lien. `input` : platform, url, label, visible (booléen), warn, origin ; un champ absent (undefined) ne change pas
 * (ou prend sa valeur par défaut à la création). Renvoie `{ ok: true, link }` ou `{ ok: false, errors: { champ: code }, general?: code }`.
 */
export async function saveLink(ctx, input, existingId = null) {
  const links = await readLinks(ctx);
  const cur = existingId ? links.find((l) => l.id === existingId) : null;
  if (existingId && !cur) return { ok: false, errors: {}, general: "notfound" };
  if (!cur && links.length >= MAX_LINKS) return { ok: false, errors: {}, general: "limit" };
  const errors = {};
  const platform = input.platform === undefined ? cur?.platform ?? "other" : String(input.platform);
  if (!isPlatform(platform)) errors.platform = "platform_unknown";
  const label = input.label === undefined ? cur?.label ?? "" : cleanLabel(input.label);
  if (platform === "other" && !label) errors.label = "label_needed";
  const checked = normalizeUrl(input.url === undefined ? cur?.url : input.url, isPlatform(platform) ? platform : "other");
  if (!checked.ok) errors.url = checked.reason;
  else if (links.some((l) => l.id !== cur?.id && sameUrl(l.url, checked.url))) errors.url = "duplicate";
  if (input.warn !== undefined && !["auto", "on", "off"].includes(input.warn)) errors.warn = "choice";
  if (input.origin !== undefined && !["auto", "on", "off"].includes(input.origin)) errors.origin = "choice";
  if (Object.keys(errors).length) return { ok: false, errors };
  const data = {
    key: cur?.key ?? newKey(new Set(links.map((l) => l.key))),
    platform, url: checked.url, label,
    visible: input.visible === undefined ? cur?.visible ?? true : !!input.visible,
    warn: input.warn === undefined ? cur?.warn ?? "auto" : input.warn,
    origin: input.origin === undefined ? cur?.origin ?? "auto" : input.origin,
    order: cur ? cur.order : links.reduce((m, l) => Math.max(m, l.order + 1), 0),
  };
  if (cur) await ctx.api.store.update(cur.id, data);
  else await ctx.api.store.add(COLLECTION, data);
  const saved = (await readLinks(ctx)).find((l) => l.key === data.key);
  return { ok: true, link: saved };
}

/* ───────────── Page d'avertissement (visiteur) ───────────── */

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const hex = (v, d) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : d);
const paragraphs = (text) => String(text).split(/\n{2,}/).map((p) => `<p>${esc(p.trim()).replace(/\n/g, "<br>")}</p>`).join("");

/** La page, en HTML simple : aucun script, aucune ressource extérieure, tout texte échappé. */
function pagehtml(ctx, { title, body, buttons, siteName }) {
  const t = ctx.theme ?? {};
  const bg = hex(t.bg, "#ffffff"), fg = hex(t.fg, "#111111"), muted = hex(t.muted, "#555555"), line = hex(t.line, "#cccccc");
  const surface = hex(t.surface, bg), accent = hex(t.accent, "#1d4ed8"), accentFg = hex(t.accentFg, "#ffffff");
  const css = `:root{color-scheme:light dark}*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;background:${bg};color:${fg};font-family:${/^[\w ,"'-]{1,200}$/.test(t.font ?? "") ? t.font : "system-ui,sans-serif"};line-height:1.5}` +
    `main{width:100%;max-width:34rem;background:${surface};border:1px solid ${line};border-radius:16px;padding:24px}` +
    `.site{margin:0 0 4px;font-size:.875rem;color:${muted}}h1{margin:0 0 12px;font-size:1.5rem;line-height:1.25}p{margin:0 0 12px;overflow-wrap:anywhere}.to{font-size:.875rem;color:${muted}}` +
    `.actions{display:flex;flex-wrap:wrap;gap:12px;margin:20px 0 16px}.btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:10px 20px;border-radius:999px;border:2px solid ${accent};font-weight:600;text-align:center;text-decoration:none;flex:1 1 14rem}` +
    `.primary{background:${accent};color:${accentFg}}.secondary{background:transparent;color:${fg};border-color:${fg}}.btn:focus-visible{outline:3px solid ${fg};outline-offset:3px}.btn:hover{filter:brightness(1.08)}`;
  return `<!doctype html><html lang="${esc(ctx.locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="strict-origin-when-cross-origin"><title>${esc(title)}</title><style>${css}</style></head>` +
    `<body><main><p class="site">${esc(siteName)}</p><h1>${esc(title)}</h1>${body}<div class="actions">${buttons}</div></main></body></html>`;
}

const HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "x-robots-tag": "noindex, nofollow",
  "cache-control": "no-store",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

/** Le bouton qui ouvre la destination : un vrai lien, même onglet, sans transmettre le chemin de la page d'origine. */
export const OUTBOUND_REL = "noopener nofollow";
export const OUTBOUND_REFERRER = "strict-origin-when-cross-origin";

async function goRoute(request, ctx) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  const site = await ctx.api.site(ctx.locale).catch(() => null);
  const siteName = String(site?.name ?? "");
  const back = ctx.locale && ctx.locale !== ctx.defaultLocale ? `/${encodeURIComponent(ctx.locale)}` : "/";
  const backButton = `<a class="btn secondary" href="${esc(back)}">${esc(ctx.t("p_back"))}</a>`;
  const asked = new URL(request.url).searchParams.get("l") ?? "";
  const link = isKey(asked) ? (await readLinks(ctx)).find((l) => l.key === asked && l.visible) : null;
  const cfg = configOf(ctx);
  const dest = link ? destinationOf(link, cfg) : null;
  if (!link || !dest) {
    const html = pagehtml(ctx, { title: ctx.t("p_missing_title"), body: `<p>${esc(ctx.t("p_missing_message"))}</p>`, buttons: backButton, siteName });
    return new Response(request.method === "HEAD" ? null : html, { status: 404, headers: HEADERS });
  }
  const name = nameOf(ctx, link);
  const warns = shouldWarn(link, cfg);
  const title = warns ? cleanLabel(ctx.setting("warnTitle"), 120) || ctx.t("p_title") : ctx.t("p_leave_title");
  const message = warns ? cleanText(ctx.setting("warnMessage")) || ctx.t("p_message") : ctx.t("p_leave_message", { label: name });
  const go = `<a class="btn primary" href="${esc(dest)}" rel="${OUTBOUND_REL}" referrerpolicy="${OUTBOUND_REFERRER}">${esc(ctx.t(warns ? "p_continue_adult" : "p_continue"))}</a>`;
  const host = new URL(dest).hostname;
  const html = pagehtml(ctx, { title, body: `${paragraphs(message)}<p class="to">${esc(ctx.t("p_to", { label: name, host }))}</p>`, buttons: go + backButton, siteName });
  return new Response(request.method === "HEAD" ? null : html, { status: 200, headers: HEADERS });
}

/* ───────────── Administration ───────────── */

const REASONS = ["empty", "long", "invalid", "http", "scheme", "credentials", "internal", "platform", "duplicate"];
const errUrl = (ctx, reason, platformId) => {
  const p = platformById(platformId);
  return ctx.t(`err_url_${REASONS.includes(reason) ? reason : "invalid"}`, { example: p.example, platform: p.name || ctx.t("platformOther") });
};
const fieldErrors = (ctx, r, platformId) => ({
  ...(r.errors.url ? { url: errUrl(ctx, r.errors.url, platformId) } : {}),
  ...(r.errors.label ? { label: ctx.t("err_label_needed") } : {}),
  ...(r.errors.platform ? { platform: ctx.t("err_platform") } : {}),
  ...(r.errors.warn ? { warn: ctx.t("err_choice") } : {}),
  ...(r.errors.origin ? { origin: ctx.t("err_choice") } : {}),
});
const general = (ctx, code) => ctx.t(code === "limit" ? "err_limit" : "err_notfound", { max: MAX_LINKS });

const shortUrl = (url) => { try { const u = new URL(url); const s = `${u.hostname.replace(/^www\./, "")}${u.pathname === "/" ? "" : u.pathname}`; return s.length > 38 ? `${s.slice(0, 37)}…` : s; } catch { return ""; } };
const can = (ctx) => typeof ctx.can === "function" && ctx.can(RIGHT);

async function panel(ctx, { query }) {
  const links = await readLinks(ctx);
  const cfg = configOf(ctx);
  const editable = can(ctx);
  const editing = editable && query?.edit ? links.find((l) => l.id === query.edit) : null;
  const blocks = [
    { type: "markdown", text: `${ctx.t("intro")}\n\n${ctx.t("introWarn")}` },
    { type: "heading", text: ctx.t("listTitle", { n: links.length, max: MAX_LINKS }) },
  ];
  if (!links.length) blocks.push({ type: "markdown", text: ctx.t("empty") });
  else {
    blocks.push({
      type: "table",
      columns: [ctx.t("colOrder"), ctx.t("colPlatform"), ctx.t("colAddress"), ctx.t("colNotice"), ctx.t("colShown")],
      rows: links.map((l, i) => [String(i + 1), nameOf(ctx, l), shortUrl(l.url), ctx.t(shouldWarn(l, cfg) ? "yes" : "no"), ctx.t(l.visible ? "shown" : "hidden")]),
      rowIds: links.map((l) => l.id),
      ...(editable ? {
        rowActions: [
          { label: ctx.t("actEdit"), href: "?edit={id}" },
          { label: ctx.t("actUp"), action: "up" },
          { label: ctx.t("actDown"), action: "down" },
          { label: ctx.t("actToggle"), action: "toggle" },
          { label: ctx.t("actDelete"), action: "remove", confirm: ctx.t("confirmDelete"), danger: true },
        ],
      } : {}),
    });
    blocks.push({ type: "markdown", text: ctx.t("limitNote") });
  }
  if (!editable) return [...blocks, { type: "markdown", text: ctx.t("readOnly") }];
  if (!editing && links.length >= MAX_LINKS) return [...blocks, { type: "banner", tone: "warning", text: ctx.t("err_limit", { max: MAX_LINKS }) }];
  const select = (name, label, value, options, help) => ({ name, label, kind: "select", value, options, ...(help ? { help } : {}) });
  const fields = [
    ...(editing ? [{ name: "id", kind: "hidden", value: editing.id }] : []),
    select("platform", ctx.t("fPlatform"), editing?.platform ?? "onlyfans", PLATFORMS.map((p) => ({ value: p.id, label: p.name || ctx.t("platformOther") }))),
    { name: "url", label: ctx.t("fUrl"), kind: "text", required: true, value: editing?.url ?? "", help: ctx.t("fUrlHelp") },
    { name: "label", label: ctx.t("fLabel"), kind: "text", value: editing?.label ?? "", help: ctx.t("fLabelHelp") },
    { name: "visible", label: ctx.t("fVisible"), kind: "checkbox", value: editing ? (editing.visible ? "on" : "") : "on" },
    select("warn", ctx.t("fWarn"), editing?.warn ?? "auto", [{ value: "auto", label: ctx.t("warnAuto") }, { value: "on", label: ctx.t("warnOn") }, { value: "off", label: ctx.t("warnOff") }], ctx.t("fWarnHelp")),
    ...(cfg.perLinkOrigin ? [select("origin", ctx.t("fOrigin"), editing?.origin ?? "auto", [{ value: "auto", label: ctx.t("originAuto") }, { value: "on", label: ctx.t("originOn") }, { value: "off", label: ctx.t("originOff") }])] : []),
  ];
  blocks.push({ type: "adminForm", action: "save", title: ctx.t(editing ? "formEditTitle" : "formAddTitle"), submitLabel: ctx.t(editing ? "submitSave" : "submitAdd"), fields, ...(editing ? { cancelHref: "?" } : {}) });
  return blocks;
}

const guarded = (run) => ({ right: RIGHT, run });
async function byId(ctx, id) { return id ? (await readLinks(ctx)).find((l) => l.id === id) ?? null : null; }

const adminActions = {
  save: guarded(async (ctx, values) => {
    const existing = values.id ? await byId(ctx, values.id) : null;
    if (values.id && !existing) return { error: ctx.t("err_notfound") };
    const input = {
      platform: values.platform, url: values.url, label: values.label, visible: values.visible === "on",
      warn: values.warn === undefined ? undefined : values.warn, origin: values.origin === undefined ? undefined : values.origin,
    };
    const r = await saveLink(ctx, input, existing?.id ?? null);
    if (!r.ok) return r.general ? { error: general(ctx, r.general) } : { errors: fieldErrors(ctx, r, isPlatform(values.platform) ? values.platform : "other") };
    return { ok: ctx.t(existing ? "okSaved" : "okAdded"), redirect: "?" };
  }),
  up: guarded(async (ctx, values) => reorder(ctx, values.id, -1)),
  down: guarded(async (ctx, values) => reorder(ctx, values.id, 1)),
  toggle: guarded(async (ctx, values) => {
    const l = await byId(ctx, values.id);
    if (!l) return { error: ctx.t("err_notfound") };
    await ctx.api.store.update(l.id, { key: l.key, platform: l.platform, url: l.url, label: l.label, visible: !l.visible, warn: l.warn, origin: l.origin, order: l.order });
    return { ok: ctx.t(l.visible ? "okHidden" : "okShown") };
  }),
  remove: guarded(async (ctx, values) => {
    const l = await byId(ctx, values.id);
    if (!l) return { error: ctx.t("err_notfound") };
    await ctx.api.store.remove(l.id);
    return { ok: ctx.t("okDeleted") };
  }),
};

async function reorder(ctx, id, delta) {
  const links = await readLinks(ctx);
  if (!links.some((l) => l.id === id)) return { error: ctx.t("err_notfound") };
  const r = move(links, id, delta);
  if (!r.moved) return { ok: ctx.t(delta < 0 ? "alreadyFirst" : "alreadyLast") };
  for (const c of r.changes) {
    const l = links.find((x) => x.id === c.id);
    await ctx.api.store.update(l.id, { key: l.key, platform: l.platform, url: l.url, label: l.label, visible: l.visible, warn: l.warn, origin: l.origin, order: c.order });
  }
  return { ok: ctx.t("okMoved") };
}

/* ───────────── Assistant IA ───────────── */

const expose = (message) => Object.assign(new Error(message), { expose: true });
const SAY = { empty: "url is empty", long: "url is too long", invalid: "url is not a valid web address", http: "url must start with https (http is refused)", scheme: "url must be a plain https address", credentials: "url must not contain a user name or password", internal: "url points to an internal or numeric address", platform: "url is not on the chosen platform's site (use platform \"other\" for another site)", duplicate: "this address is already in the list", label_needed: "label is required for platform \"other\"", platform_unknown: "unknown platform", choice: "invalid choice" };
const sayErrors = (r) => r.general === "limit" ? `at most ${MAX_LINKS} links` : r.general ? "link not found" : Object.entries(r.errors).map(([f, c]) => `${f === "label" ? "label" : f}: ${SAY[c] ?? c}`).join("; ");
const view = (ctx, cfg, l) => ({ id: l.id, platform: l.platform, url: l.url, label: l.label || null, visible: l.visible, warn: l.warn, noticeShownNow: shouldWarn(l, cfg), originAdded: shouldAddOrigin(l, cfg), position: l.order + 1 });

const mcp = {
  async platform_links_list(ctx) {
    const cfg = configOf(ctx);
    return (await readLinks(ctx)).map((l) => view(ctx, cfg, l));
  },
  async platform_link_create(ctx, args) {
    const r = await saveLink(ctx, { platform: args.platform, url: args.url, label: args.label, visible: args.visible ?? true, warn: args.warn ?? "auto" });
    if (!r.ok) throw expose(sayErrors(r));
    return view(ctx, configOf(ctx), r.link);
  },
  async platform_link_update(ctx, args) {
    const existing = await byId(ctx, args.id);
    if (!existing) throw expose("link not found");
    const r = await saveLink(ctx, { platform: args.platform, url: args.url, label: args.label, visible: args.visible, warn: args.warn }, existing.id);
    if (!r.ok) throw expose(sayErrors(r));
    return view(ctx, configOf(ctx), r.link);
  },
};

/* ───────────── Le module ───────────── */

export default {
  exports: {
    // Les boutons du module, au format du cœur : le cœur les range dans l'en-tête avec ceux des autres réseaux (10 au plus en tout).
    async "social.link"(ctx, query) {
      const cfg = configOf(ctx);
      const locale = typeof query?.locale === "string" && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(query.locale) ? query.locale : ctx.locale;
      const out = [];
      for (const l of await readLinks(ctx)) {
        if (!l.visible) continue;
        const dest = destinationOf(l, cfg);
        if (!dest) continue;
        const url = shouldWarn(l, cfg) ? `${String(ctx.api.siteUrl).replace(/\/+$/, "")}/m/${ctx.instance.key}/go?l=${l.key}${locale ? `&lang=${encodeURIComponent(locale)}` : ""}` : dest;
        out.push({ label: nameOf(ctx, l), url, icon: platformById(l.platform).icon });
      }
      return out;
    },
  },
  routes: { go: goRoute },
  adminPanel: panel,
  adminActions,
  mcp,
  backup: {
    async readable(ctx) {
      const cell = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
      const lines = (await readLinks(ctx)).map((l, i) => [i + 1, l.platform, l.url, l.label, l.visible ? "yes" : "no", l.warn, l.origin].map(cell).join(","));
      return [{ path: "links.csv", content: `﻿${[["order", "platform", "address", "label", "visible", "notice", "origin"].map(cell).join(","), ...lines].join("\r\n")}\r\n` }];
    },
  },
};
