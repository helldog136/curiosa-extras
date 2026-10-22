// L'administration : un assistant en questions simples, un aperçu, une publication. Tout texte visible passe par ctx.t (français et anglais).
//
// Le panneau a trois écrans, choisis par l'adresse :
//   (rien)            l'accueil : où j'en suis, ce qui reste, ce qui a changé, publier ou retirer
//   ?step=<étape>     UNE question à la fois (6 à 8 en tout), avec l'erreur sous le champ et un exemple
//   ?view=preview     les trois pages telles que les visiteurs les liraient, avec les manques en gras

const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { appliedSteps, applyStep, evaluate, fieldsFor, stepById, withDefaults } = await import(`./answers.mjs${v}`);
const { buildDocs, longDate } = await import(`./docs.mjs${v}`);
const { fingerprint, publish, readAnswers, readPages, readState, unpublish, writeOne } = await import(`./data.mjs${v}`);
const { gatherFacts } = await import(`./facts.mjs${v}`);
const { isCollector, isQuiet, KINDS } = await import(`./known.mjs${v}`);
const { base, hrefOf, PAGES } = await import(`./public.mjs${v}`);

const htmlEsc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
/** Un texte de la langue, ou rien si la clé n'existe pas (ctx.t renvoie la clé elle-même quand elle manque). */
const maybe = (ctx, key, vars) => { const v = ctx.t(key, vars); return v === key ? undefined : v; };
const DAY = 86_400_000;
/** Le contexte réduit à ce que hrefOf lit : les adresses « du site » (langue par défaut) affichées dans l'administration. */
const siteSide = (ctx) => ({ instance: ctx.instance, locale: ctx.defaultLocale, defaultLocale: ctx.defaultLocale });

// ── Lecture de l'état ───────────────────────────────────────────────────────────────────────────────────────────

/** Tout ce dont un écran a besoin, lu une seule fois. */
export async function load(ctx) {
  const facts = await gatherFacts(ctx);
  const stored = await readAnswers(ctx);
  const state = await readState(ctx);
  const a = withDefaults(stored, facts);
  const missing = evaluate(a, facts);
  const started = Boolean(stored) && Object.keys(stored.touched ?? {}).length > 0;
  const dirty = state.published && fingerprint(a, facts) !== state.hash;
  return { facts, stored, state, a, missing, started, dirty };
}

const monthsOld = (ctx, state) => {
  const months = Math.max(1, Math.min(60, Math.trunc(Number(ctx.setting("reviewMonths")) || 12)));
  return Date.now() - Date.parse(state.at) > months * 30 * DAY;
};

/**
 * Ce qui demande l'attention de la personne : une liste de `{ id, text, step? }`. Sert au tableau de l'accueil ET à la pastille du menu.
 * Pas de « rappel » pour une extension connue comme sans effet sur la vie privée : on n'ajoute pas de bruit.
 */
export function attention(ctx, s) {
  const out = [];
  const { state, facts, missing, started, dirty } = s;
  const nameOf = (id) => [...facts.collectors, ...facts.unknown].find((x) => x.module === id)?.name ?? id;
  if (!state.published) {
    if (!started) out.push({ id: "start", text: ctx.t("rem.start") });
    else if (missing.length > 0) out.push({ id: "todo", text: ctx.t("rem.todo", { n: missing.length }) });
    else out.push({ id: "ready", text: ctx.t("rem.ready") });
    return out;
  }
  if (dirty) out.push({ id: "changed", text: missing.length > 0 ? ctx.t("rem.changedTodo", { n: missing.length }) : ctx.t("rem.changed") });
  for (const id of facts.moduleIds.filter((x) => !state.modules?.includes(x))) {
    if (isQuiet(id)) continue;
    out.push(isCollector(id) ? { id: `added:${id}`, step: "collect", text: ctx.t("rem.added.collector", { name: nameOf(id) }) } : { id: `added:${id}`, step: "collect", text: ctx.t("rem.added.unknown", { name: nameOf(id) }) });
  }
  for (const id of (state.modules ?? []).filter((x) => !facts.moduleIds.includes(x))) if (isCollector(id)) out.push({ id: `removed:${id}`, step: "collect", text: ctx.t("rem.removed.collector", { name: id }) });
  if (monthsOld(ctx, state)) out.push({ id: "old", text: ctx.t("rem.old", { date: longDate(state.at, ctx.locale) }) });
  return out;
}

/** « Bon à savoir » : ce que les réponses impliquent, sans bloquer la publication. */
function notes(ctx, s) {
  const { a, facts } = s;
  const out = [];
  for (const kind of KINDS) if (facts.detected[kind] && a.collect[kind] !== true) out.push(ctx.t("note.mismatch", { what: ctx.t(`f.collect_${kind}.short`) }));
  if (a.collect.thirdParty) out.push(ctx.t("note.thirdParty"));
  if (a.collect.list) out.push(ctx.t(a.country === "CA" || a.country === "CA_QC" ? "note.list.CA" : "note.list"));
  if (a.collect.messages) out.push(ctx.t("note.keep", { period: ctx.t(`o.retention.${a.retention}`) }));
  if (a.sells === "here") out.push(ctx.t("note.sellsHere"));
  if (a.country === "FR" && a.status === "person" && !a.hideAddress && a.address) out.push(ctx.t("note.addressVisible"));
  return out;
}

// ── Petits morceaux d'écran ─────────────────────────────────────────────────────────────────────────────────────

const disclaimer = (ctx, short = false) => ({ type: "markdown", text: `> ${ctx.t(short ? "adm.disclaimer.short" : "adm.disclaimer")}` });
const list = (items) => items.map((x) => `- ${x}`).join("\n");

function progress(ctx, a, stepId) {
  const steps = appliedSteps(a);
  const index = Math.max(0, steps.findIndex((x) => x.id === stepId));
  const label = ctx.t("adm.progress", { n: index + 1, total: steps.length });
  const bar = steps.map((_, i) => `<span style="flex:1;height:6px;border-radius:3px;background:currentColor;opacity:${i <= index ? 0.85 : 0.18}"></span>`).join("");
  return [{ type: "html", html: `<div role="img" aria-label="${htmlEsc(label)}" style="display:flex;gap:4px;margin:4px 0 0">${bar}</div><p style="margin:6px 0 0;font-size:.875rem;opacity:.75">${htmlEsc(label)}</p>` }];
}

const summary = (ctx, stepId, a) => {
  const t = (k) => ctx.t(k);
  switch (stepId) {
    case "country": return a.country ? t(`o.country.${a.country}`) : "";
    case "who": return a.name ? `${t(`o.status.${a.status}`)} — ${a.name}` : "";
    case "address": return a.country === "FR" && a.status === "person" && a.hideAddress ? t("adm.sum.hidden") : [a.address.split("\n")[0], a.phone].filter(Boolean).join(" · ");
    case "business": return [a.legalForm, a.regNumber].filter(Boolean).join(" · ");
    case "host": return a.hostName;
    case "collect": { const on = KINDS.filter((k) => a.collect[k]).map((k) => t(`f.collect_${k}.short`)); return on.length ? on.join(", ") : t("adm.sum.nothing"); }
    case "keep": return t(`o.retention.${a.retention}`);
    case "sells": return t(`o.sells.${a.sells}`);
    default: return "";
  }
};

// ── Écran 1 : l'accueil ─────────────────────────────────────────────────────────────────────────────────────────

async function overview(ctx, s, query) {
  const { a, facts, state, missing, started, dirty } = s;
  const blocks = [disclaimer(ctx)];
  if (base(ctx) === null) blocks.push({ type: "markdown", text: `**${ctx.t("adm.noPath")}**` });

  if (!started) {
    blocks.push(
      { type: "heading", text: ctx.t("adm.intro.title") },
      { type: "markdown", text: `${ctx.t("adm.intro.text")}\n\n${list([ctx.t("adm.intro.notice"), ctx.t("adm.intro.privacy"), ctx.t("adm.intro.cookies")])}\n\n${ctx.t("adm.intro.how")}` },
    );
    if (facts.collectors.length) blocks.push({ type: "markdown", text: ctx.t("adm.intro.seen", { names: facts.collectors.map((c) => c.name).join(", ") }) });
    blocks.push({ type: "adminForm", action: "go", submitLabel: ctx.t("adm.start"), fields: [{ name: "to", kind: "hidden", value: "country" }] });
    return blocks;
  }

  if (query.saved) blocks.push({ type: "markdown", text: `**${ctx.t("adm.allSaved")}**` });
  if (query.published) blocks.push({ type: "markdown", text: `**${ctx.t("adm.justPublished")}**` });

  // Où j'en suis
  const ready = missing.length === 0;
  const status = state.published && !dirty && ready ? ctx.t("adm.status.live", { date: longDate(state.at, ctx.locale) })
    : ready ? ctx.t("adm.status.ready") : ctx.t("adm.status.todo", { n: missing.length });
  blocks.push({ type: "heading", text: status });

  const reminders = attention(ctx, s).filter((r) => !["start", "todo", "ready"].includes(r.id));
  if (reminders.length) blocks.push({ type: "markdown", text: `**${ctx.t("adm.reminders")}**\n\n${list(reminders.map((r) => (r.step ? `${r.text} [${ctx.t("adm.open")}](?step=${r.step})` : r.text)))}` });

  // Les questions et leurs réponses
  const state1 = (step) => {
    const bad = missing.filter((m) => m.step === step.id);
    if (bad.some((m) => m.kind === "empty")) return ctx.t("adm.state.todo");
    if (bad.length) return ctx.t("adm.state.confirm");
    return ctx.t("adm.state.done");
  };
  const steps = appliedSteps(a);
  blocks.push({
    type: "table",
    columns: [ctx.t("adm.col.question"), ctx.t("adm.col.answer"), ctx.t("adm.col.state")],
    rows: steps.map((step) => [ctx.t(`st.${step.id}.short`), summary(ctx, step.id, a) || "—", state1(step)]),
    rowIds: steps.map((step) => step.id),
    rowActions: [{ label: ctx.t("adm.edit"), href: "?step={id}" }],
  });

  const nts = notes(ctx, s);
  if (nts.length) blocks.push({ type: "markdown", text: `**${ctx.t("adm.notes")}**\n\n${list(nts)}` });

  // Aperçu et publication
  blocks.push({ type: "heading", text: ctx.t("adm.publish.title") });
  blocks.push({ type: "markdown", text: `[${ctx.t("adm.preview.open")}](?view=preview&lang=${ctx.locale === "en" ? "en" : "fr"})` });
  if (ready && base(ctx) !== null) {
    blocks.push({
      type: "adminForm", action: "publish", submitLabel: state.published ? ctx.t("adm.publish.again") : ctx.t("adm.publish.first"),
      fields: [{ name: "ack", kind: "checkbox", label: ctx.t("adm.publish.ack"), help: ctx.t("adm.publish.ackHelp") }],
    });
  } else if (!ready) {
    blocks.push({ type: "markdown", text: ctx.t("adm.publish.blocked", { n: missing.length }) });
  }

  // Ce qui est en ligne
  if (state.published) {
    const pages = await readPages(ctx);
    const docs = pages?.[ctx.locale] ?? pages?.[ctx.defaultLocale] ?? pages?.en ?? pages?.fr;
    if (docs) {
      blocks.push({ type: "heading", text: ctx.t("adm.live.title") });
      blocks.push({
        type: "table", columns: [ctx.t("adm.col.page"), ctx.t("adm.col.address")],
        rows: PAGES.map((p) => [docs[p]?.title ?? p, hrefOf(siteSide(ctx), p) ?? "—"]),
        rowIds: PAGES.map((p) => hrefOf(siteSide(ctx), p) ?? "/"),
        rowActions: [{ label: ctx.t("adm.live.see"), href: "{id}" }],
      });
      blocks.push({ type: "table", columns: [ctx.t("adm.col.page")], rows: [[ctx.t("adm.live.all")]], rowIds: ["all"], rowActions: [{ label: ctx.t("adm.live.remove"), action: "unpublish", confirm: ctx.t("adm.live.confirm"), danger: true }] });
    }
  }
  return blocks;
}

// ── Écran 2 : une question ──────────────────────────────────────────────────────────────────────────────────────

function fieldBlock(ctx, f, a, facts) {
  const label = ctx.t(f.labelKey ? f.labelKey(a) : `f.${f.name}.label`);
  const help = maybe(ctx, f.helpKey ? f.helpKey(a) : `f.${f.name}.help`);
  const raw = f.name.startsWith("collect_") ? a.collect[f.name.slice(8)] : a[f.name];
  const out = { name: f.name, label, ...(help ? { help } : {}) };
  if (f.type === "checkbox") return { ...out, kind: "checkbox", value: raw ? "on" : "" };
  const required = f.req(a, facts);
  if (f.type === "select") {
    const options = f.options.map((v) => ({ value: v, label: ctx.t(`o.${f.name}.${v}`) }));
    if (!raw) options.unshift({ value: "", label: ctx.t("adm.choose") });
    return { ...out, kind: "select", required, options, value: String(raw ?? "") };
  }
  return { ...out, kind: f.type === "email" ? "email" : f.type === "textarea" ? "textarea" : "text", required, value: String(raw || (f.name === "director" ? a.name : "") || "") };
}

function stepScreen(ctx, s, step) {
  const { a, facts } = s;
  const blocks = [disclaimer(ctx, true), ...progress(ctx, a, step.id)];
  const intro = maybe(ctx, `st.${step.id}.help.${a.country || "OTHER"}`) ?? maybe(ctx, `st.${step.id}.help`);
  if (intro) blocks.push({ type: "markdown", text: intro });
  if (step.id === "collect") {
    if (facts.collectors.length) blocks.push({ type: "markdown", text: ctx.t("adm.collect.seen", { names: facts.collectors.map((c) => c.name).join(", ") }) });
    if (facts.unknown.length) blocks.push({ type: "markdown", text: ctx.t("adm.collect.unknown", { names: facts.unknown.map((c) => c.name).join(", ") }) });
  }
  const fields = fieldsFor(step.id, a, facts).map((f) => fieldBlock(ctx, f, a, facts));
  fields.push({ name: "step", kind: "hidden", value: step.id });
  blocks.push({ type: "adminForm", action: "saveStep", title: ctx.t(`st.${step.id}.title`), submitLabel: ctx.t("adm.next"), fields });
  const steps = appliedSteps(a);
  const index = steps.findIndex((x) => x.id === step.id);
  const previous = index > 0 ? steps[index - 1] : null;
  const links = [previous ? `[← ${ctx.t("adm.back")}](?step=${previous.id})` : null, `[${ctx.t("adm.toOverview")}](?)`].filter(Boolean);
  blocks.push({ type: "markdown", text: links.join(" · ") });
  return blocks;
}

// ── Écran 3 : l'aperçu ──────────────────────────────────────────────────────────────────────────────────────────

/** Les liens internes d'un texte, écrits en adresses complètes : c'est ce qu'on copie pour le coller ailleurs. */
const absolutize = (md, ctx) => md.replace(/\]\(@(privacy|notice|cookies|home)\)/g, (m, name) => `](${ctx.api.siteUrl}${name === "privacy" ? "/privacy" : `${base(ctx) ?? ""}${name === "home" ? "" : `/${name}`}`})`);

function previewScreen(ctx, s, query) {
  const { a, facts, missing } = s;
  const lang = query.lang === "en" ? "en" : "fr";
  const built = buildDocs({ answers: a, facts, lang, mode: "preview" });
  const blocks = [disclaimer(ctx, true), { type: "heading", text: ctx.t("adm.preview.title") }];
  blocks.push({ type: "markdown", text: `${lang === "fr" ? `**${ctx.t("adm.lang.fr")}**` : `[${ctx.t("adm.lang.fr")}](?view=preview&lang=fr)`} · ${lang === "en" ? `**${ctx.t("adm.lang.en")}**` : `[${ctx.t("adm.lang.en")}](?view=preview&lang=en)`} · [${ctx.t("adm.toOverview")}](?)` });
  if (missing.length) blocks.push({ type: "markdown", text: `**${ctx.t("adm.preview.gaps")}**\n\n${list([...new Set(missing.map((m) => m.step))].map((id) => `[${ctx.t(`st.${id}.short`)}](?step=${id})`))}` });
  for (const key of PAGES) {
    const doc = built[key];
    blocks.push({ type: "heading", text: doc.title });
    blocks.push({ type: "markdown", text: doc.md.replace(/\]\(@(privacy|notice|cookies|home)\)/g, "](#)") });
    blocks.push({ type: "copy", label: ctx.t("adm.preview.copy", { title: doc.title }), text: `# ${doc.title}\n\n${absolutize(doc.md, ctx)}` });
  }
  return blocks;
}

// ── Le panneau ──────────────────────────────────────────────────────────────────────────────────────────────────

export async function adminPanel(ctx, { query = {} } = {}) {
  const s = await load(ctx);
  if (typeof query.step === "string") {
    const step = stepById(query.step);
    if (step && step.applies(s.a)) return stepScreen(ctx, s, step);
  }
  if (query.view === "preview") return previewScreen(ctx, s, query);
  return overview(ctx, s, query);
}

// ── Les actions ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Les messages d'erreur d'un champ : une phrase qui dit quoi faire, avec un exemple. */
function messages(ctx, errors) {
  const out = {};
  for (const [field, key] of Object.entries(errors)) out[field] = ctx.t(key);
  return out;
}

const nextStepAfter = (a, stepId) => {
  const steps = appliedSteps(a);
  const index = steps.findIndex((x) => x.id === stepId);
  return index >= 0 && index < steps.length - 1 ? steps[index + 1].id : null;
};

export const adminActions = {
  /** Le bouton « Commencer ». */
  async go(ctx, values) {
    const to = stepById(String(values.to ?? "")) ? String(values.to) : "country";
    return { redirect: `?step=${to}` };
  },

  /** Enregistre UNE étape, puis passe à la suivante. Une erreur reste sous le champ et ne perd rien de ce qui a été tapé. */
  async saveStep(ctx, values) {
    const stepId = String(values.step ?? "");
    if (!stepById(stepId)) return { error: ctx.t("err.step") };
    const facts = await gatherFacts(ctx);
    const current = withDefaults(await readAnswers(ctx), facts);
    const { answers, errors } = applyStep(current, stepId, values, facts);
    if (Object.keys(errors).length > 0) return { errors: messages(ctx, errors) };
    if (stepId === "collect") answers.unknownAck = facts.unknown.map((u) => u.module).sort();
    await writeOne(ctx, "answers", { ...answers, savedAt: new Date().toISOString() });
    const next = nextStepAfter(answers, stepId);
    return { ok: ctx.t("adm.saved"), redirect: next ? `?step=${next}` : "?saved=1" };
  },

  /** Publie les trois pages (réservé à ceux qui ont le droit « publier »). */
  publish: {
    right: "publish",
    async run(ctx, values) {
      if (values.ack !== "on") return { errors: { ack: ctx.t("err.ack") } };
      if (base(ctx) === null) return { error: ctx.t("adm.noPath") };
      const s = await load(ctx);
      if (s.missing.length > 0) return { error: ctx.t("adm.publish.blocked", { n: s.missing.length }) };
      try { await publish(ctx, s.a, s.facts); } catch (error) {
        console.error("[legal-pages] publication refused:", error?.message);
        return { error: ctx.t("err.publishGap") };
      }
      return { ok: ctx.t("adm.published"), redirect: "?published=1" };
    },
  },

  /** Retire les trois pages du site (les réponses sont gardées). */
  unpublish: {
    right: "publish",
    async run(ctx) {
      await unpublish(ctx);
      return { ok: ctx.t("adm.unpublished"), redirect: "?" };
    },
  },
};

