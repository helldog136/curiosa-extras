// Mascotte — l'administration : trois onglets. « Ma mascotte » (état, aperçu, apparence), « Phrases » (gabarits, liste, ajout / modification), « Quand et où » (réglages du cœur).
// Chaque erreur s'affiche SOUS son champ, avec un exemple. Rien n'est jamais publié sans un clic sur « Publier ».
const v = new URL(import.meta.url).search;
const M = await import(new URL(`./model.mjs${v}`, import.meta.url).href);
const S = await import(new URL(`./store.mjs${v}`, import.meta.url).href);
const A = await import(new URL(`./assets.mjs${v}`, import.meta.url).href);
const F = await import(new URL(`./face.mjs${v}`, import.meta.url).href);
const T = await import(new URL(`./starters.mjs${v}`, import.meta.url).href);

export const RIGHTS = { edit: "edit", publish: "publish" };
/** `ctx.can` n'existe pas sur un cœur ancien (et reste faux hors de l'administration) : l'absence vaut un refus. */
export const can = (ctx, right) => typeof ctx.can === "function" && ctx.can(right) === true;
const PER_PAGE = 50;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const short = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const query = (o) => { const p = new URLSearchParams(); for (const [k, val] of Object.entries(o)) if (val !== undefined && val !== null && val !== "") p.set(k, String(val)); return `?${p.toString()}`; };

/** Le nom d'une langue, dans la langue de la personne (le code si le navigateur ne sait pas). */
export function langLabel(ctx, code) {
  if (!code) return ctx.t("langAll");
  try { return new Intl.DisplayNames([ctx.locale], { type: "language" }).of(code) || code; } catch { return code; }
}
const t = (ctx, error) => (Array.isArray(error) ? ctx.t(error[0], error[1]) : String(error));

/** Les phrases de départ sont posées UNE fois (à la création, ou à la première ouverture si le crochet n'a pas tourné) ; supprimer toutes ses phrases ne les ramène pas. */
export async function ensureSeeded(ctx) {
  const config = await S.loadConfig(ctx);
  if (config.seeded) return;
  const have = await S.loadPhrases(ctx);
  if (!have.length) await S.replacePhrases(ctx, T.templatePhrases("welcome", ctx.locales, ctx.defaultLocale));
  await S.saveConfig(ctx, { seeded: true });
}

// ── L'aperçu : ce que verront les visiteurs, avec les couleurs de ce site ───────────────────────────────────────────
const HEX = /^#[0-9a-f]{6}$/i;
function themeVars(theme) {
  const t0 = theme ?? {};
  const pairs = [["accent", t0.accent], ["accent2", t0.accent2 || t0.accent], ["surface", t0.surface], ["fg", t0.fg], ["muted", t0.muted], ["line", t0.line], ["bg", t0.bg]];
  return pairs.filter(([, c]) => HEX.test(String(c ?? ""))).map(([k, c]) => `--v-${k}:${c}`).join(";");
}
export function previewHtml(ctx, config, sample) {
  const name = S.nameFor(ctx, config);
  const alt = S.altFor(ctx, config);
  const image = config.look === "image" && config.image;
  const avatar = (mood, pill) => `<div class="mc-av${pill ? " mcp-pill" : ""}" aria-hidden="true">${image ? `<img class="mc-i ${config.crop === "square" ? "mc-sq" : "mc-rd"}" src="${esc(config.image)}" alt="">` : F.drawFace(mood)}</div>`;
  const figures = (image ? [["happy", ctx.t("previewImage"), false], ["happy", ctx.t("previewPill"), true]] : [["happy", ctx.t("moodHappy"), false], ["curious", ctx.t("moodCurious"), false], ["sleepy", ctx.t("moodSleepy"), true]])
    .map(([mood, label, pill]) => `<figure class="mcp-fig">${avatar(mood, pill)}<figcaption>${esc(label)}</figcaption></figure>`).join("");
  return {
    type: "html",
    html: `<style>${A.CSS}
.mcp{padding:16px;border-radius:12px;border:1px solid var(--v-line,#d5d8e0);background:var(--v-bg,#fff);color:var(--v-fg,#1f2430);max-width:560px}
.mcp-row{display:flex;flex-wrap:wrap;gap:20px;align-items:flex-end}
.mcp-fig{margin:0;text-align:center;font-size:13px;color:var(--v-muted,#566070)}
.mcp-fig .mc-av{margin:0 auto 6px;cursor:default}
.mcp-pill{width:52px!important;height:52px!important;padding:4px;background:var(--v-surface,#fff);border:1px solid var(--v-line,#d5d8e0)}
.mcp-stage{display:flex;flex-direction:column;align-items:flex-end;gap:8px;margin-top:22px;max-width:330px;font:15px/1.4 var(--v-font,system-ui,sans-serif)}
.mcp-stage .mc-bub{margin:0}
</style>
<div class="mcp" style="${esc(themeVars(ctx.theme))}" role="group" aria-label="${esc(ctx.t("previewLabel"))}">
<div class="mcp-row">${figures}</div>
<div class="mcp-stage mc-r"><div class="mc-bub"><p class="mc-n">${esc(name)}</p><p class="mc-p">${esc(sample)}</p><div class="mc-o"><span style="font-size:13px;color:var(--v-muted,#566070)">${esc(ctx.t("uiReduce"))} · ${esc(ctx.t("uiMute"))}</span></div><span class="mc-x" aria-hidden="true" style="text-align:center">×</span></div>${avatar("happy", false)}</div>
${image && !alt ? `<p style="margin:12px 0 0;color:var(--v-fg)"><strong>${esc(ctx.t("previewNoAlt"))}</strong></p>` : ""}
</div>`,
  };
}

// ── Le panneau ──────────────────────────────────────────────────────────────────────────────────────────────────────
function statusBlocks(ctx, config, phrases, set, canPublish) {
  const live = phrases.filter((p) => p.state === "published").length;
  const out = [];
  if (!config.published) out.push({ type: "banner", tone: "warning", text: ctx.t("statusDraft") });
  else if (!live) out.push({ type: "banner", tone: "warning", text: ctx.t("statusSilent") });
  else if (set.where === "some" && !set.pages.length) out.push({ type: "banner", tone: "warning", text: ctx.t("statusNoPage") });
  else out.push({ type: "banner", tone: "success", text: ctx.t("statusLive") });
  if (canPublish) {
    out.push({ type: "adminForm", action: config.published ? "unpublish" : "publish", submitLabel: ctx.t(config.published ? "unpublishButton" : "publishButton"), fields: [{ name: "go", kind: "hidden", label: "go", value: "1" }] });
  }
  if (config.published && live) out.push({ type: "links", items: [{ label: ctx.t("seeOnSite"), href: "/?mascot=voir" }] });
  return out;
}

function lookForm(ctx, config) {
  const locales = ctx.locales.slice(0, 12);
  const many = locales.length > 1;
  const fields = [
    { name: "look", kind: "select", label: ctx.t("lookLabel"), value: config.look, options: [{ value: "builtin", label: ctx.t("lookBuiltin") }, { value: "image", label: ctx.t("lookImage") }], help: ctx.t("lookHelp") },
    { name: "image", kind: "image", label: ctx.t("imageLabel"), value: config.image, help: ctx.t("imageHelp") },
    { name: "crop", kind: "select", label: ctx.t("cropLabel"), value: config.crop, options: [{ value: "round", label: ctx.t("cropRound") }, { value: "square", label: ctx.t("cropSquare") }] },
    ...locales.map((l) => ({ name: `name_${l}`, kind: "text", label: many ? ctx.t("nameLabelLang", { lang: langLabel(ctx, l) }) : ctx.t("nameLabel"), value: config.names[l] ?? "", help: l === locales[0] ? ctx.t("nameHelp", { max: M.LIMITS.name }) : undefined })),
    ...locales.map((l) => ({ name: `alt_${l}`, kind: "text", label: many ? ctx.t("altLabelLang", { lang: langLabel(ctx, l) }) : ctx.t("altLabel"), value: config.alts[l] ?? "", help: l === locales[0] ? ctx.t("altHelp", { max: M.LIMITS.alt }) : undefined })),
  ];
  // `cancelHref` : un formulaire de modification garde ses valeurs après l'enregistrement (au lieu de se vider) et propose « annuler ».
  return { type: "adminForm", action: "saveLook", submitLabel: ctx.t("saveLook"), title: ctx.t("lookTitle"), cancelHref: "?", fields };
}

function phraseForm(ctx, editing) {
  const p = editing ?? { kind: "hello", lang: ctx.locale, text: "", pages: [], link: "", state: "published" };
  const langs = ["", ...ctx.locales.slice(0, 12)];
  return {
    type: "adminForm", action: "savePhrase", title: ctx.t(editing ? "editTitle" : "addTitle"), submitLabel: ctx.t(editing ? "saveEdit" : "addButton"),
    cancelHref: editing ? query({ tab: "phrases" }) : undefined,
    fields: [
      ...(editing ? [{ name: "id", kind: "hidden", label: "id", value: editing.id }] : []),
      { name: "text", kind: "textarea", label: ctx.t("textLabel"), value: p.text, required: true, help: ctx.t("textHelp", { max: M.LIMITS.text, ex1: M.example(ctx.locale, "event"), ex2: M.example(ctx.locale, "date") }) },
      { name: "kind", kind: "select", label: ctx.t("kindLabel"), value: p.kind, options: M.KINDS.map((k) => ({ value: k, label: ctx.t(`kind_${k}`) })), help: ctx.t("kindHelp") },
      { name: "lang", kind: "select", label: ctx.t("langLabel"), value: p.lang, options: langs.map((l) => ({ value: l, label: langLabel(ctx, l) })) },
      { name: "pages", kind: "textarea", label: ctx.t("pagesLabel"), value: p.pages.join("\n"), help: ctx.t("pagesHelp") },
      { name: "link", kind: "text", label: ctx.t("linkLabel"), value: p.link, help: ctx.t("linkHelp") },
      { name: "state", kind: "select", label: ctx.t("stateLabel"), value: p.state, options: M.STATES.map((s) => ({ value: s, label: ctx.t(`state_${s}`) })) },
    ],
  };
}

function phraseBlocks(ctx, phrases, q, canEdit) {
  const tab = "phrases";
  const out = [{ type: "heading", text: ctx.t("phrasesTitle", { count: phrases.length, max: M.LIMITS.phrases }), tab }, { type: "markdown", text: ctx.t("phrasesHelp", { vars: M.VARIABLES.map((x) => `\`{${x.names[ctx.locale === "fr" ? 0 : 1]}}\``).join(", "), alias: `\`${M.example(ctx.locale === "fr" ? "en" : "fr", "event")}\`` }), tab }];
  const editing = canEdit && q.edit ? phrases.find((p) => p.id === String(q.edit)) : undefined;
  if (canEdit) out.push({ ...phraseForm(ctx, editing), tab });
  const pages = Math.max(1, Math.ceil(phrases.length / PER_PAGE));
  const page = Math.min(pages, Math.max(1, Math.floor(Number(q.page)) || 1));
  const slice = phrases.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  if (!slice.length) out.push({ type: "markdown", text: ctx.t("phrasesEmpty"), tab });
  else {
    out.push({
      type: "table", tab, columns: [ctx.t("colPhrase"), ctx.t("colDetails")],
      rows: slice.map((p) => [short(p.text, 90), [ctx.t(`kind_${p.kind}`), langLabel(ctx, p.lang), p.pages.length ? p.pages.join(" ") : null, ctx.t(`state_${p.state}`)].filter(Boolean).join(" · ")]),
      rowIds: slice.map((p) => p.id),
      rowActions: canEdit ? [{ label: ctx.t("actEdit"), href: query({ tab, edit: "{id}" }) }, { label: ctx.t("actToggle"), action: "togglePhrase" }, { label: ctx.t("actDelete"), action: "removePhrase", confirm: ctx.t("confirmDelete"), danger: true }] : undefined,
    });
    const nav = [];
    if (page > 1) nav.push({ label: ctx.t("prevPage"), href: query({ tab, page: page - 1 }) });
    if (page < pages) nav.push({ label: ctx.t("nextPage"), href: query({ tab, page: page + 1 }) });
    if (nav.length) out.push({ type: "links", items: nav, tab });
  }
  if (canEdit) {
    out.push({ type: "heading", text: ctx.t("templatesTitle"), tab }, { type: "markdown", text: ctx.t("templatesHelp"), tab });
    out.push({
      type: "table", tab, columns: [ctx.t("colTemplate"), ctx.t("colAbout")],
      rows: T.TEMPLATES.map((id) => [ctx.t(`tpl_${id}`), ctx.t(`tpl_${id}_about`)]), rowIds: [...T.TEMPLATES],
      rowActions: [{ label: ctx.t("tplUse"), action: "applyTemplate", confirm: ctx.t("tplConfirm") }],
    });
  }
  return out;
}

export async function adminPanel(ctx, { query: q0 } = {}) {
  const q = q0 && typeof q0 === "object" ? q0 : {};
  await ensureSeeded(ctx);
  const [config, phrases] = [await S.loadConfig(ctx), await S.loadPhrases(ctx)];
  const set = A.readSettings(ctx);
  const canEdit = can(ctx, RIGHTS.edit), canPublish = can(ctx, RIGHTS.publish);
  const sample = phrases.find((p) => p.state === "published" && p.kind === "hello" && (p.lang === "" || p.lang === ctx.locale) && !M.variablesIn(p.text).keys.some((k) => M.SOURCE_OF[k]))?.text ?? ctx.t("previewSample");
  const site = await Promise.resolve().then(() => ctx.api.site(ctx.locale)).catch(() => null);
  const filled = M.fillText(sample, { site: M.oneLine(site?.name, 80), name: S.nameFor(ctx, config) }) ?? ctx.t("previewSample");
  const blocks = [
    ...statusBlocks(ctx, config, phrases, set, canPublish),
    { type: "heading", text: ctx.t("previewTitle") },
    previewHtml(ctx, config, filled),
  ];
  if (canEdit) blocks.push(lookForm(ctx, config));
  blocks.push(...phraseBlocks(ctx, phrases, q, canEdit));
  blocks.push({ type: "markdown", text: ctx.t("settingsHelp"), tab: "settings" }, { type: "copy", text: `${ctx.api.siteUrl}/?mascot=voir`, label: ctx.t("copyReview"), tab: "settings" });
  return blocks;
}

// ── Les actions ─────────────────────────────────────────────────────────────────────────────────────────────────────
async function saveLook(ctx, values) {
  const errors = {};
  const look = values.look === "image" ? "image" : "builtin";
  const image = M.safeImage(values.image);
  const names = {}, alts = {};
  for (const l of ctx.locales.slice(0, 12)) {
    const name = M.oneLine(values[`name_${l}`], 500), alt = M.oneLine(values[`alt_${l}`], 500);
    if ([...name].length > M.LIMITS.name) errors[`name_${l}`] = ctx.t("errNameLong", { max: M.LIMITS.name });
    if ([...alt].length > M.LIMITS.alt) errors[`alt_${l}`] = ctx.t("errAltLong", { max: M.LIMITS.alt });
    if (name) names[l] = name;
    if (alt) alts[l] = alt;
  }
  if (look === "image") {
    // L'erreur de l'image va sous « Quel visage » (le champ image du cœur n'affiche pas de message sous lui) : c'est le champ juste au-dessus.
    if (String(values.image ?? "").trim() && !image) errors.look = ctx.t("errImage");
    else if (!image) errors.look = ctx.t("errImageEmpty");
    if (!alts[ctx.defaultLocale] && !errors[`alt_${ctx.defaultLocale}`]) errors[`alt_${ctx.defaultLocale}`] = ctx.t("errAltEmpty");
  }
  if (Object.keys(errors).length) return { errors };
  await S.saveConfig(ctx, { look, image, crop: values.crop === "square" ? "square" : "round", names, alts });
  return { ok: ctx.t("lookSaved") };
}

async function setPublished(ctx, published) {
  const config = await S.loadConfig(ctx);
  if (published && config.look === "image" && !(config.image && S.altFor(ctx, config))) return { error: ctx.t("errPublishImage") };
  await S.saveConfig(ctx, { published });
  return { ok: ctx.t(published ? "publishedOk" : "unpublishedOk") };
}

async function savePhrase(ctx, values) {
  const checked = M.checkPhrase(values, { locales: ctx.locales, locale: ctx.locale });
  if (checked.errors) return { errors: Object.fromEntries(Object.entries(checked.errors).map(([k, e]) => [k, t(ctx, e)])) };
  if (values.id) {
    const done = await S.updatePhrase(ctx, values.id, checked.value);
    return done ? { ok: ctx.t("phraseSaved"), redirect: "?tab=phrases" } : { error: ctx.t("errGone") };
  }
  const r = await S.addPhrase(ctx, checked.value);
  if (r.full) return { errors: { text: ctx.t("errFull", { max: M.LIMITS.phrases }) } };
  return { ok: ctx.t("phraseAdded"), redirect: "?tab=phrases" };
}

async function togglePhrase(ctx, values) {
  const p = await S.findPhrase(ctx, values.id);
  if (!p) return { error: ctx.t("errGone") };
  await S.updatePhrase(ctx, p.id, { kind: p.kind, lang: p.lang, text: p.text, pages: p.pages, link: p.link, state: p.state === "published" ? "draft" : "published" });
  return { ok: ctx.t(p.state === "published" ? "nowDraft" : "nowPublished"), redirect: "?tab=phrases" };
}

async function removePhrase(ctx, values) {
  const done = await S.removePhrase(ctx, values.id);
  return done ? { ok: ctx.t("phraseRemoved"), redirect: "?tab=phrases" } : { error: ctx.t("errGone") };
}

async function applyTemplate(ctx, values) {
  const id = String(values.id ?? "");
  if (!T.TEMPLATES.includes(id)) return { error: ctx.t("errGone") };
  await S.replacePhrases(ctx, T.templatePhrases(id, ctx.locales, ctx.defaultLocale));
  await S.saveConfig(ctx, { seeded: true });
  return { ok: ctx.t("tplApplied"), redirect: "?tab=phrases" };
}

export const adminActions = {
  saveLook: { right: RIGHTS.edit, run: saveLook },
  savePhrase: { right: RIGHTS.edit, run: savePhrase },
  togglePhrase: { right: RIGHTS.edit, run: togglePhrase },
  removePhrase: { right: RIGHTS.edit, run: removePhrase },
  applyTemplate: { right: RIGHTS.edit, run: applyTemplate },
  publish: { right: RIGHTS.publish, run: (ctx) => setPublished(ctx, true) },
  unpublish: { right: RIGHTS.publish, run: (ctx) => setPublished(ctx, false) },
};
