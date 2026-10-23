// Mur des remerciements — la page d'administration (mobile d'abord, FR + EN, mots simples). Trois choses seulement :
//   1. où en est le mur (quelles catégories, combien de personnes, qui est caché) et un lien pour le voir ;
//   2. la mise à l'honneur de chaque mois (on cherche une personne, on choisit le mois, on écrit un mot) ;
//   3. un message court par personne (liste avec recherche, 25 par page).
// Les noms et les photos ne sont PAS à nous : ils sont lus dans Contacts à chaque affichage. Ici, on ne garde que « fiche → message » et « mois → fiche ».
const v = new URL(import.meta.url).search;
const P = await import(`./pure.mjs${v}`);
const C = await import(`./contacts.mjs${v}`);
const D = await import(`./data.mjs${v}`);
const View = await import(`./view.mjs${v}`);
const { LIMITS, clean, fold, idOk } = P;

export const RIGHT = "messages.edit";
const can = (ctx) => typeof ctx.can === "function" && ctx.can(RIGHT) === true;
const str = (x) => (typeof x === "string" ? x : Array.isArray(x) && typeof x[0] === "string" ? x[0] : "");
const publicPath = (ctx) => (ctx.instance.basePath ? `/${String(ctx.instance.basePath).replace(/^\/+|\/+$/g, "")}` : "/");
const enc = (s) => encodeURIComponent(s);

/** Les champs « un texte par langue du site » d'un formulaire. */
const textFields = (ctx, prefix, values, { label, help, max }) => ctx.locales.map((loc) => ({
  name: `${prefix}_${loc}`, kind: "textarea", label: ctx.locales.length > 1 ? `${ctx.t(label)} (${loc.toUpperCase()})` : ctx.t(label), value: values?.[loc] ?? "", help: ctx.t(help, { max }),
}));
const readTexts = (ctx, prefix, values) => Object.fromEntries(ctx.locales.map((loc) => [loc, P.clean(values[`${prefix}_${loc}`], 400, true)]).filter(([, t]) => t));

/* ───────────── Le panneau ───────────── */

export async function panel(ctx, { query = {} } = {}) {
  const t = ctx.t, blocks = [];
  const book = await C.providers(ctx);
  if (!book.length) {
    return [
      { type: "banner", tone: "warning", text: t("adminNoBook") },
      { type: "suggestInstall", service: C.SERVICE, min: 2, reason: t("suggestReason") },
    ];
  }
  const contactsPath = `/admin/instances/${book[0].id}`;

  // Un écran à part pour écrire un message ou choisir le mois d'une personne : une tâche à la fois, on revient d'un clic.
  const msgId = str(query.msg), honorId = str(query.honor);
  if (idOk(msgId)) return messageScreen(ctx, msgId);
  if (idOk(honorId)) return honorScreen(ctx, honorId);

  const wall = await C.getWall(ctx, { maxAgeMs: C.timing.adminFreshMs, waitMs: 7000 });
  blocks.push(...statusBlocks(ctx, wall, contactsPath));
  if (wall.state === "ok") blocks.push(...summaryBlocks(ctx, wall, contactsPath));
  blocks.push(...await honorBlocks(ctx, wall, query));
  if (wall.state === "ok") blocks.push(...await messageBlocks(ctx, wall, query));
  blocks.push(...await tidyBlocks(ctx));
  return blocks;
}

/* ───────────── 1. Où en est le mur ───────────── */

function statusBlocks(ctx, wall, contactsPath) {
  const t = ctx.t, out = [];
  if (wall.state === "unready") out.push({ type: "banner", tone: "warning", text: t(`adminUnready_${wall.reason}`), href: `?tab=settings` });
  else if (wall.state === "slow") out.push({ type: "banner", tone: "warning", text: t("adminSlow") });
  else if (wall.state === "absent") out.push({ type: "banner", tone: "warning", text: t("adminNoBook") }, { type: "suggestInstall", service: C.SERVICE, min: 2, reason: t("suggestReason") });
  else {
    if (wall.stale) out.push({ type: "banner", tone: "warning", text: t("adminStale") });
    if (wall.partial) out.push({ type: "banner", tone: "warning", text: t("adminPartial") });
    if (wall.hideHow === "gone") out.push({ type: "banner", tone: "warning", text: t("adminHideGone"), href: `?tab=settings` });
  }
  for (const p of wall.problems ?? []) if (["gone", "duplicate"].includes(p.problem) && p.n > 1) out.push({ type: "banner", tone: "warning", text: t(`adminGroup_${p.problem}`, { n: p.n }), href: `?tab=settings` });
  if (wall.state === "ok" && wall.groups.some((g) => g.truncated)) out.push({ type: "banner", tone: "info", text: t("adminTruncated", { max: LIMITS.perGroup }) });
  void contactsPath;
  return out;
}

function summaryBlocks(ctx, wall, contactsPath) {
  const t = ctx.t;
  const groups = wall.groups.filter((g) => !g.problem);
  const total = new Set(groups.flatMap((g) => g.people.map((p) => p.id))).size;
  const hidden = groups.reduce((n, g) => n + g.hidden, 0);
  const out = [{ type: "heading", text: t("adminWallTitle") }];
  out.push({ type: "markdown", text: total ? t("adminWallSummary", { people: total, groups: groups.length }) : t("adminWallEmpty") });
  if (groups.length) out.push({ type: "table", columns: [t("colGroup"), t("colPeople"), t("colHidden")], rows: groups.map((g) => [g.title, String(g.people.length), String(g.hidden)]) });
  out.push({ type: "links", items: [{ label: t("adminSeeWall"), href: publicPath(ctx) }, { label: t("adminOpenContacts"), href: contactsPath }] });
  // « Ne pas montrer » : expliqué en une phrase, avec le nom de la catégorie qui sert.
  const how = wall.hideHow;
  out.push({ type: "markdown", text: how === "none" || how === "gone" ? t("adminHideNone") : t("adminHideHow", { category: wall.hideLabel || "—", hidden }) });
  return out;
}

/* ───────────── 2. Le mois à l'honneur ───────────── */

async function honorBlocks(ctx, wall, query) {
  const t = ctx.t, out = [];
  const writable = can(ctx);
  const data = await D.readData(ctx, { fresh: true }).catch(() => null);
  out.push({ type: "heading", text: t("honorTitle") });
  out.push({ type: "markdown", text: t("honorIntro") });
  const honors = data?.honors ?? [];
  const now = P.monthKey();
  if (honors.length) {
    const names = await C.resolveCards(ctx, honors.map((h) => h.contactId));
    const rows = honors.map((h) => {
      const c = names.cards.get(h.contactId);
      const who = c ? P.shownName(c, "card") : names.state === "ok" ? t("honorGone") : "…";
      const when = h.month === now ? t("honorNow") : h.month > now ? t("honorPlanned") : t("honorPast");
      return [`${P.monthLabel(h.month, ctx.locale)} (${when.toLowerCase()})`, who];
    });
    out.push({ type: "table", columns: [t("colMonth"), t("colPerson")], rows, rowIds: honors.map((h) => h.month), rowActions: writable ? [{ label: t("honorRemove"), action: "honorClear", confirm: t("honorRemoveConfirm"), danger: true }] : [] });
  } else out.push({ type: "markdown", text: t("honorNone") });
  if (!writable) return out;
  // Chercher la personne à mettre à l'honneur (un nom, ou un morceau de nom).
  const hq = str(query.hq);
  out.push({ type: "adminForm", action: "honorSearch", title: t("honorSearchTitle"), submitLabel: t("honorSearchButton"), fields: [{ name: "q", kind: "text", label: t("honorSearchLabel"), value: hq, help: t("honorSearchHelp") }] });
  if (hq) {
    const found = await C.searchPeople(ctx, hq);
    if (found.state !== "ok") out.push({ type: "banner", tone: "warning", text: t("adminSlow") });
    else if (!found.items.length) out.push({ type: "markdown", text: t("honorSearchNone") });
    else out.push({ type: "table", columns: [t("colPerson")], rows: found.items.map((x) => [x.name]), rowIds: found.items.map((x) => x.id), rowActions: [{ label: t("honorChoose"), href: "?honor={id}" }] });
  }
  void wall;
  return out;
}

async function honorScreen(ctx, id) {
  const t = ctx.t;
  if (!can(ctx)) return [{ type: "banner", tone: "warning", text: t("adminNoRight") }, { type: "links", items: [{ label: t("back"), href: "?" }] }];
  const r = await C.resolveCards(ctx, [id]);
  const card = r.cards.get(id);
  if (r.state !== "ok") return [{ type: "banner", tone: "warning", text: t("adminSlow") }, { type: "links", items: [{ label: t("back"), href: "?" }] }];
  if (!card) return [{ type: "banner", tone: "warning", text: t("honorGoneBanner") }, { type: "links", items: [{ label: t("back"), href: "?" }] }];
  const cardId = r.moved[id] ?? id;
  const now = P.monthKey();
  const data = await D.readData(ctx, { fresh: true });
  const months = Array.from({ length: 6 }, (_, i) => P.addMonths(now, i));
  const existing = data.honors.find((h) => h.month === now);
  return [
    { type: "heading", text: t("honorScreenTitle", { name: P.shownName(card, "card") }) },
    { type: "adminForm", action: "honorSave", submitLabel: t("honorSave"), cancelHref: "?", fields: [
      { name: "contactId", kind: "hidden", value: cardId },
      { name: "month", kind: "select", label: t("honorMonth"), value: now, required: true, options: months.map((m) => ({ value: m, label: P.monthLabel(m, ctx.locale) })), help: existing ? t("honorMonthReplace") : t("honorMonthHelp") },
      ...textFields(ctx, "why", null, { label: "honorWhy", help: "honorWhyHelp", max: LIMITS.why }),
    ] },
  ];
}

/* ───────────── 3. Un message par personne ───────────── */

async function messageBlocks(ctx, wall, query) {
  const t = ctx.t, out = [];
  const data = await D.readData(ctx, { fresh: true }).catch(() => null);
  const seen = new Map(); // id → { shown, groups: [titres] }
  for (const g of wall.groups.filter((x) => !x.problem)) for (const p of View.shownPeople(ctx, g, View.displayOf(ctx))) {
    const e = seen.get(p.id) ?? { id: p.id, shown: p.shown, groups: [] };
    e.groups.push(g.title); seen.set(p.id, e);
  }
  const all = P.sortPeople([...seen.values()], "alpha", ctx.locale);
  const many = wall.groups.filter((x) => !x.problem).length > 1;
  out.push({ type: "heading", text: t("msgTitle") });
  const withMessage = all.filter((p) => data?.messages.has(p.id)).length;
  const aside = data ? [...data.messages.keys()].filter((id) => !seen.has(id)).length : 0;
  out.push({ type: "markdown", text: t("msgIntro", { max: LIMITS.message }) + (data ? ` ${t("msgCount", { n: withMessage, total: all.length })}` : "") + (aside ? ` ${t("msgAside", { n: aside })}` : "") });
  if (!all.length) return out;
  const q = str(query.q).slice(0, 100);
  const filtered = q ? all.filter((p) => fold(p.shown).includes(fold(q))) : all;
  const pages = Math.max(1, Math.ceil(filtered.length / LIMITS.adminPage));
  const page = Math.min(pages, Math.max(1, P.int(str(query.page), 1, 1, 100000)));
  const slice = filtered.slice((page - 1) * LIMITS.adminPage, page * LIMITS.adminPage);
  if (all.length > LIMITS.adminPage || q) out.push({ type: "adminForm", action: "messageSearch", submitLabel: t("msgSearchButton"), fields: [{ name: "q", kind: "text", label: t("msgSearchLabel"), value: q, help: t("msgSearchHelp") }] });
  if (!filtered.length) { out.push({ type: "markdown", text: t("msgSearchNone") }); return out; }
  out.push({
    type: "table", columns: [t("colPerson"), t("colMessage")],
    rows: slice.map((p) => [many ? `${p.shown} (${[...new Set(p.groups)].join(", ")})` : p.shown, data?.messages.has(p.id) ? P.pickText(data.messages.get(p.id).texts, ctx.locale, ctx.defaultLocale) : "—"]),
    rowIds: slice.map((p) => p.id), rowActions: can(ctx) ? [{ label: t("msgWrite"), href: "?msg={id}" }] : [],
  });
  if (pages > 1) {
    const link = (n, label) => ({ label, href: `?page=${n}${q ? `&q=${enc(q)}` : ""}` });
    out.push({ type: "links", items: [...(page > 1 ? [link(page - 1, t("msgPrev"))] : []), ...(page < pages ? [link(page + 1, t("msgNext"))] : [])] });
    out.push({ type: "markdown", text: t("msgPageOf", { page, pages }) });
  }
  return out;
}

async function messageScreen(ctx, id) {
  const t = ctx.t;
  const back = { type: "links", items: [{ label: t("back"), href: "?" }] };
  if (!can(ctx)) return [{ type: "banner", tone: "warning", text: t("adminNoRight") }, back];
  const r = await C.resolveCards(ctx, [id]);
  if (r.state !== "ok") return [{ type: "banner", tone: "warning", text: t("adminSlow") }, back];
  const card = r.cards.get(id);
  if (!card) return [{ type: "banner", tone: "warning", text: t("honorGoneBanner") }, back];
  const cardId = r.moved[id] ?? id;
  const data = await D.readData(ctx, { fresh: true });
  const cur = data.messages.get(cardId);
  return [
    { type: "heading", text: t("msgScreenTitle", { name: P.shownName(card, "card") }) },
    { type: "adminForm", action: "messageSave", submitLabel: t("msgSave"), cancelHref: "?", fields: [
      { name: "contactId", kind: "hidden", value: cardId },
      ...textFields(ctx, "text", cur?.texts, { label: "msgField", help: "msgFieldHelp", max: LIMITS.message }),
    ] },
  ];
}

/* ───────────── 4. Remettre en ordre ───────────── */

async function tidyBlocks(ctx) {
  if (!can(ctx)) return [];
  const data = await D.readData(ctx).catch(() => null);
  if (!data || (!data.messages.size && !data.honors.length)) return [];
  const t = ctx.t;
  return [
    { type: "heading", text: t("tidyTitle") },
    { type: "markdown", text: t("tidyIntro") },
    { type: "adminForm", action: "tidy", submitLabel: t("tidyButton"), fields: [{ name: "go", kind: "hidden", value: "1" }] },
  ];
}

/* ───────────── Les actions ───────────── */

const back = (ctx, ok, extra = {}) => ({ ok, redirect: "?", ...extra });

async function checkPerson(ctx, id) {
  const r = await C.resolveCards(ctx, [id]);
  if (r.state !== "ok") return { error: ctx.t("adminSlow") };
  const card = r.cards.get(id);
  if (!card) return { missing: true };
  return { card, id: r.moved[id] ?? id };
}

export const actions = {
  // Chercher une personne à mettre à l'honneur.
  honorSearch: { right: RIGHT, async run(ctx, values) {
    const q = clean(values.q, 100);
    if ([...q].length < 2) return { errors: { q: ctx.t("errSearchShort") } };
    return { redirect: `?hq=${enc(q)}` };
  } },
  honorSave: { right: RIGHT, async run(ctx, values) {
    const now = P.monthKey(), allowed = Array.from({ length: 6 }, (_, i) => P.addMonths(now, i));
    const month = clean(values.month, 7);
    if (!allowed.includes(month)) return { errors: { month: ctx.t("errMonth") } };
    const texts = readTexts(ctx, "why", values);
    for (const [loc, text] of Object.entries(texts)) if ([...text].length > LIMITS.why) return { errors: { [`why_${loc}`]: ctx.t("errTooLong", { max: LIMITS.why }) } };
    const who = await checkPerson(ctx, clean(values.contactId, LIMITS.id));
    if (who.error) return { error: who.error };
    if (who.missing) return { error: ctx.t("honorGoneBanner") };
    const r = await D.setHonor(ctx, { month, contactId: who.id, why: texts });
    if (!r.ok) return { error: ctx.t("errSave") };
    return back(ctx, ctx.t("honorSaved", { name: P.shownName(who.card, "card"), month: P.monthLabel(month, ctx.locale) }));
  } },
  honorClear: { right: RIGHT, async run(ctx, values) {
    const r = await D.clearHonor(ctx, clean(values.id, 7));
    return r.ok ? back(ctx, ctx.t("honorRemoved")) : { error: ctx.t("errSave") };
  } },
  messageSearch: { right: RIGHT, async run(ctx, values) {
    const q = clean(values.q, 100);
    return { redirect: q ? `?q=${enc(q)}` : "?" };
  } },
  messageSave: { right: RIGHT, async run(ctx, values) {
    const texts = readTexts(ctx, "text", values);
    for (const [loc, text] of Object.entries(texts)) if ([...text].length > LIMITS.message) return { errors: { [`text_${loc}`]: ctx.t("errTooLong", { max: LIMITS.message }) } };
    const who = await checkPerson(ctx, clean(values.contactId, LIMITS.id));
    if (who.error) return { error: who.error };
    if (who.missing) return { error: ctx.t("honorGoneBanner") };
    const r = await D.setMessage(ctx, who.id, texts);
    if (!r.ok) return { error: r.code === "too_many" ? ctx.t("errTooMany", { max: LIMITS.messages }) : ctx.t("errSave") };
    return back(ctx, Object.keys(texts).length ? ctx.t("msgSaved", { name: P.shownName(who.card, "card") }) : ctx.t("msgRemoved", { name: P.shownName(who.card, "card") }));
  } },
  // Remettre en ordre : suivre les fiches fusionnées, retirer ce qui visait une fiche supprimée. Borné : 1 000 messages au plus = 10 lectures.
  tidy: { right: RIGHT, async run(ctx) {
    const ids = await D.keptIds(ctx);
    const r = await C.resolveCards(ctx, ids);
    if (r.state !== "ok") return { error: ctx.t("adminSlow") };
    let followed = 0, removed = 0;
    for (const [from, to] of Object.entries(r.moved)) followed += await D.remapReferences(ctx, from, to) ? 1 : 0;
    for (const id of r.missing) removed += await D.eraseReferences(ctx, id) ? 1 : 0;
    return back(ctx, followed || removed ? ctx.t("tidyDone", { followed, removed }) : ctx.t("tidyNothing"));
  } },
};
