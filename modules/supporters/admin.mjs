// Soutiens — la page d'administration (mobile d'abord, FR + EN, mots simples). Dans l'ordre :
//   1. où en est la connexion (assistant en étapes adapté à la plateforme choisie, état, bouton « Vérifier et actualiser ») ;
//   2. la liste des soutiens (recherche, filtres, 25 par page) → un écran par personne (lien d'accord, approuver, cacher, oublier) ;
//   3. les libellés publics des paliers (les seuls mots que le public voit sur les paliers) et les modèles de départ ;
//   4. Contacts (ranger les soutiens, SEULEMENT avec le droit « ranger les soutiens dans Contacts ») ;
//   5. le secours : importer un fichier ; 6. le nettoyage.
// Les noms ne sont PAS à nous une fois la personne rangée dans Contacts : on les relit à l'affichage (25 par page, une seule demande).
const v = new URL(import.meta.url).search;
const P = await import(`./pure.mjs${v}`);
const D = await import(`./data.mjs${v}`);
const R = await import(`./providers.mjs${v}`);
const S = await import(`./sync.mjs${v}`);
const C = await import(`./contacts.mjs${v}`);
const O = await import(`./ops.mjs${v}`);
const { LIMITS, clean, fold, pidOk, int } = P;

export const RIGHT_MANAGE = "people.manage", RIGHT_LABELS = "labels.edit", RIGHT_FILE = "contacts.file";
const can = (ctx, right) => typeof ctx.can === "function" && ctx.can(right) === true;
const str = (x) => (typeof x === "string" ? x : Array.isArray(x) && typeof x[0] === "string" ? x[0] : "");
const enc = encodeURIComponent;
const FILTERS = ["all", "active", "ended", "waiting", "pending", "unfiled"];
const when = (ctx, ms) => (ms ? new Date(ms).toLocaleString(ctx.locale || "en", { dateStyle: "medium", timeStyle: "short" }) : "");
const back = (ctx) => ({ type: "links", items: [{ label: ctx.t("back"), href: "?" }] });
const noRight = (ctx) => ({ type: "banner", tone: "warning", text: ctx.t("noRight") });

/* ───────────── Le panneau ───────────── */

export async function panel(ctx, { query = {} } = {}) {
  const pid = str(query.p), tier = str(query.tier);
  if (pidOk(pid)) return personScreen(ctx, pid);
  if (/^[a-z0-9:_-]{1,120}$/.test(tier)) return tierScreen(ctx, tier);
  const snap = await D.snapshot(ctx, { fresh: true });
  const out = [];
  out.push(...statusBlocks(ctx, snap));
  out.push(...connectionBlocks(ctx, snap));
  out.push(...await listBlocks(ctx, snap, query));
  out.push(...tierBlocks(ctx, snap));
  out.push(...await contactsBlocks(ctx, snap));
  out.push(...importBlocks(ctx));
  out.push(...tidyBlocks(ctx, snap));
  return out;
}

/* ───────────── 1. La connexion ───────────── */

function statusBlocks(ctx, snap) {
  const t = ctx.t, provider = R.providerOf(ctx), st = D.stateOf(snap), out = [];
  const token = !!clean(ctx.setting("accessToken"), 600);
  if (provider.mode !== "file" && !token) out.push({ type: "banner", tone: "warning", text: t("needToken"), href: "?tab=settings" });
  else if (provider.mode === "pull" && st.syncCode && !["ok", "partial"].includes(st.syncCode)) out.push({ type: "banner", tone: "warning", text: t(`sync_${st.syncCode}`) });
  if (P.flag(ctx.setting("publicPage"), false) !== true) out.push({ type: "banner", tone: "info", text: t("pageOff"), href: "?tab=settings" });
  return out;
}

function connectionBlocks(ctx, snap) {
  const t = ctx.t, provider = R.providerOf(ctx), st = D.stateOf(snap), out = [];
  const token = !!clean(ctx.setting("accessToken"), 600);
  out.push({ type: "heading", text: t("connTitle", { platform: R.say(ctx, provider.label) }) });
  out.push({ type: "markdown", text: R.say(ctx, provider.what) });
  const steps = R.say(ctx, provider.steps);
  const list = Array.isArray(steps) ? steps : [];
  list.forEach((text, i) => {
    out.push({ type: "markdown", text: `**${i + 1}.** ${text}` });
    if (provider.mode === "push" && i + 1 === (provider.webhookStep ?? 1)) out.push({ type: "copy", label: t("webhookLabel"), text: `${String(ctx.api.siteUrl ?? "").replace(/\/+$/, "")}/m/${ctx.instance.key}/${provider.id}` });
  });
  if (provider.mode !== "file") out.push({ type: "markdown", text: token ? t("tokenSaved") : t("tokenMissing") });
  const summary = S.summary(ctx, snap);
  if (provider.mode === "pull") {
    if (st.syncedAt) out.push({ type: "markdown", text: t("lastRefresh", { when: when(ctx, st.syncedAt), n: st.syncCount ?? 0 }) });
    out.push({ type: "netHealth", items: [{ host: provider.hosts[0], label: R.say(ctx, provider.label), ...(st.syncedAt ? { lastGoodAt: new Date(st.syncedAt).toISOString() } : {}) }] });
    if (can(ctx, RIGHT_MANAGE)) out.push({ type: "adminForm", action: "refresh", submitLabel: t("refreshButton"), fields: [{ name: "go", kind: "hidden", value: "1" }] });
  } else if (provider.mode === "push") {
    out.push({ type: "markdown", text: st.eventAt ? t("lastEvent", { when: when(ctx, st.eventAt) }) : t("noEventYet") });
  }
  out.push({ type: "markdown", text: t("sumLine", summary) });
  return out;
}

/* ───────────── 2. La liste ───────────── */

function displayState(ctx, p, provider) {
  const t = ctx.t, { activeDays } = S.knobs(ctx);
  if (p.hidden === true) return t("dsHidden");
  const cs = P.consentState(p);
  if (cs === "none") return t("dsNoConsent");
  if (cs === "pending") return t("dsPending", { pseudo: p.consent.pseudo });
  return P.isActive(p, provider, activeDays) ? t("dsShown", { pseudo: p.consent.pseudo }) : t("dsShownLater", { pseudo: p.consent.pseudo });
}

async function listBlocks(ctx, snap, query) {
  const t = ctx.t, out = [{ type: "heading", text: t("listTitle") }];
  if (!snap.people.size) { out.push({ type: "markdown", text: t("listEmpty") }); return out; }
  const { activeDays } = S.knobs(ctx);
  const filter = FILTERS.includes(str(query.filter)) ? str(query.filter) : "all";
  const q = fold(clean(str(query.q), 100));
  let rows = [...snap.people.values()].map((r) => r.data);
  rows = rows.filter((p) => {
    const prov = S.providerOfPerson(ctx, p), active = P.isActive(p, prov, activeDays), cs = P.consentState(p);
    if (filter === "active" && !active) return false;
    if (filter === "ended" && active) return false;
    if (filter === "waiting" && !(active && cs === "none")) return false;
    if (filter === "pending" && cs !== "pending") return false;
    if (filter === "unfiled" && p.contactId) return false;
    if (q && !fold(`${p.name} ${p.consent?.pseudo ?? ""}`).includes(q)) return false;
    return true;
  });
  rows.sort((a, b) => P.sortText(a.name || a.consent?.pseudo || a.pid, b.name || b.consent?.pseudo || b.pid, ctx.locale));
  const pages = Math.max(1, Math.ceil(rows.length / LIMITS.adminPage));
  const page = Math.min(pages, int(str(query.page), 1, 1, 100000));
  const slice = rows.slice((page - 1) * LIMITS.adminPage, page * LIMITS.adminPage);
  out.push({ type: "links", items: FILTERS.map((f) => ({ label: `${f === filter ? "● " : ""}${t(`filter_${f}`)}`, href: `?filter=${f}` })) });
  out.push({ type: "adminForm", action: "search", submitLabel: t("searchButton"), fields: [{ name: "q", kind: "text", label: t("searchLabel"), value: str(query.q).slice(0, 100), help: t("searchHelp") }, { name: "filter", kind: "hidden", value: filter }] });
  if (!slice.length) { out.push({ type: "markdown", text: t("listNone") }); return out; }
  const names = await C.cardNames(ctx, slice.map((p) => p.contactId).filter(Boolean));
  const nameOf = (p) => p.name || (p.contactId ? (names.names.get(p.contactId)?.name ?? (names.state === "ok" ? t("nameGone") : t("nameInContacts"))) : "—");
  const tierNames = (p) => (p.tiers ?? []).map((k) => snap.tiers.get(k)?.data.name ?? "").filter(Boolean).slice(0, 2).join(", ") || "—";
  out.push({
    type: "table", columns: [t("colPerson"), t("colTier"), t("colState"), t("colPublic")],
    rows: slice.map((p) => [nameOf(p), tierNames(p), P.isActive(p, S.providerOfPerson(ctx, p), activeDays) ? t("stActive") : t("stEnded"), displayState(ctx, p, S.providerOfPerson(ctx, p))]),
    rowIds: slice.map((p) => p.pid), rowActions: [{ label: t("open"), href: "?p={id}" }],
  });
  if (pages > 1) {
    const link = (n, label) => ({ label, href: `?page=${n}&filter=${filter}${q ? `&q=${enc(str(query.q).slice(0, 100))}` : ""}` });
    out.push({ type: "links", items: [...(page > 1 ? [link(page - 1, t("prev"))] : []), ...(page < pages ? [link(page + 1, t("next"))] : [])] });
    out.push({ type: "markdown", text: t("pageOf", { page, pages }) });
  }
  return out;
}

/* ───────────── L'écran d'une personne ───────────── */

async function personScreen(ctx, pid) {
  const t = ctx.t;
  const snap = await D.snapshot(ctx, { fresh: true });
  const rec = snap.byPid.get(pid);
  if (!rec) return [{ type: "banner", tone: "warning", text: t("personGone") }, back(ctx)];
  const p = rec.data, prov = S.providerOfPerson(ctx, p), { activeDays } = S.knobs(ctx);
  let name = p.name;
  if (!name && p.contactId) { const c = await C.cardNames(ctx, [p.contactId]); name = c.names.get(p.contactId)?.name ?? t("nameInContacts"); }
  const out = [{ type: "heading", text: name || t("personAnon") }];
  const tiers = (p.tiers ?? []).map((k) => snap.tiers.get(k)?.data.name).filter(Boolean).join(", ") || "—";
  out.push({ type: "markdown", text: t("personFacts", { platform: R.say(ctx, prov.label), tiers, since: p.since ?? "—", state: P.isActive(p, prov, activeDays) ? t("stActive") : t("stEnded"), filed: p.contactId ? t("yes") : t("no") }) });
  out.push({ type: "markdown", text: `**${t("colPublic")} :** ${displayState(ctx, p, prov)}` });
  if (p.consent) out.push({ type: "markdown", text: t("personAgreement", { pseudo: p.consent.pseudo, on: p.consent.at }) });
  const manage = can(ctx, RIGHT_MANAGE);
  if (!manage) { out.push(noRight(ctx)); out.push(back(ctx)); return out; }
  // Le lien d'accord : la personne l'ouvre, choisit son pseudo et dit oui (ou non). Rien n'est montré avant.
  out.push({ type: "heading", text: t("linkTitle") });
  out.push({ type: "markdown", text: t("linkIntro") });
  if (P.flag(ctx.setting("publicPage"), false) !== true) out.push({ type: "banner", tone: "warning", text: t("linkNeedsPage"), href: "?tab=settings" });
  const link = await O.consentLink(ctx, pid);
  if (link.ok) out.push({ type: "copy", label: t("linkLabel"), text: link.url });
  out.push({ type: "adminForm", action: "personRenew", submitLabel: t("linkRenew"), fields: [{ name: "pid", kind: "hidden", value: pid }], title: t("linkRenewTitle") });
  out.push({ type: "heading", text: t("actionsTitle") });
  if (P.consentState(p) === "pending") {
    out.push({ type: "markdown", text: t("approveIntro", { pseudo: p.consent.pseudo }) });
    out.push({ type: "adminForm", action: "personApprove", submitLabel: t("approveYes"), fields: [{ name: "pid", kind: "hidden", value: pid }, { name: "approve", kind: "hidden", value: "1" }] });
    out.push({ type: "adminForm", action: "personApprove", submitLabel: t("approveNo"), fields: [{ name: "pid", kind: "hidden", value: pid }, { name: "approve", kind: "hidden", value: "0" }] });
  }
  out.push({ type: "adminForm", action: "personHide", submitLabel: p.hidden ? t("showAgain") : t("hide"), fields: [{ name: "pid", kind: "hidden", value: pid }, { name: "hidden", kind: "hidden", value: p.hidden ? "0" : "1" }], title: p.hidden ? t("hiddenHelp") : t("hideHelp") });
  out.push({ type: "table", columns: [t("forgetCol")], rows: [[t("forgetRow")]], rowIds: [pid], rowActions: [{ label: t("forget"), action: "personForget", confirm: t("forgetConfirm"), danger: true }] });
  out.push(back(ctx));
  return out;
}

/* ───────────── 3. Les paliers ───────────── */

function tierBlocks(ctx, snap) {
  const t = ctx.t, out = [{ type: "heading", text: t("tiersTitle") }];
  out.push({ type: "markdown", text: t("tiersIntro") });
  const tiers = [...snap.tiers.values()].map((r) => r.data).sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0));
  if (!tiers.length) { out.push({ type: "markdown", text: t("tiersNone") }); return out; }
  out.push({
    type: "table", columns: [t("colTierName"), t("colTierLabel")],
    rows: tiers.map((x) => [x.name, P.pickText(x.label, ctx.locale, ctx.defaultLocale) || t("tierNoLabel")]),
    rowIds: tiers.map((x) => x.k), rowActions: can(ctx, RIGHT_LABELS) ? [{ label: t("tierName"), href: "?tier={id}" }] : [],
  });
  if (can(ctx, RIGHT_LABELS)) out.push({ type: "adminForm", action: "tierTemplate", submitLabel: t("tplApply"), title: t("tplTitle"), fields: [{ name: "template", kind: "select", label: t("tplField"), value: "three", help: t("tplHelp"), options: O.TEMPLATE_IDS.map((id) => ({ value: id, label: t(`tpl_${id}`) })) }] });
  return out;
}

async function tierScreen(ctx, k) {
  const t = ctx.t;
  const snap = await D.snapshot(ctx, { fresh: true });
  const tier = snap.tiers.get(k)?.data;
  if (!tier) return [{ type: "banner", tone: "warning", text: t("tierGone") }, back(ctx)];
  if (!can(ctx, RIGHT_LABELS)) return [noRight(ctx), back(ctx)];
  return [
    { type: "heading", text: t("tierScreenTitle", { name: tier.name }) },
    { type: "markdown", text: t("tierScreenHelp") },
    { type: "adminForm", action: "tierSave", submitLabel: t("save"), cancelHref: "?", fields: [
      { name: "k", kind: "hidden", value: k },
      ...ctx.locales.map((loc) => ({ name: `label_${loc}`, kind: "text", label: ctx.locales.length > 1 ? `${t("tierLabelField")} (${loc.toUpperCase()})` : t("tierLabelField"), value: tier.label?.[loc] ?? "", help: t("tierLabelHelp", { max: LIMITS.label }) })),
    ] },
  ];
}

/* ───────────── 4. Contacts ───────────── */

async function contactsBlocks(ctx, snap) {
  const t = ctx.t, out = [{ type: "heading", text: t("contactsTitle") }];
  out.push({ type: "markdown", text: t("contactsIntro") });
  const book = await C.providers(ctx);
  if (!book.length) {
    out.push({ type: "markdown", text: t("contactsAbsent") });
    out.push({ type: "suggestInstall", service: C.SERVICE, min: 2, reason: t("suggestReason") });
    return out;
  }
  const cat = await C.categoryOf(ctx, "category", [t("defaultCategory"), t("defaultCategoryOther")]);
  const todo = [...snap.people.values()].filter((r) => !r.data.contactId && r.data.status === "active" && clean(r.data.name, LIMITS.name)).length;
  if (cat.state === "ok") out.push({ type: "markdown", text: t("contactsCategory", { category: cat.label || "—", todo }) });
  else out.push({ type: "banner", tone: "warning", text: t(`cat_${cat.state}`), href: "?tab=settings" });
  if (can(ctx, RIGHT_FILE)) {
    if (cat.state === "ok" && todo) out.push({ type: "adminForm", action: "fileContacts", submitLabel: t("fileButton", { n: Math.min(todo, LIMITS.fileBatch) }), fields: [{ name: "go", kind: "hidden", value: "1" }] });
    else if (cat.state === "ok" && clean(ctx.setting("wallCategory"), 120)) out.push({ type: "adminForm", action: "fileContacts", submitLabel: t("wallButton"), fields: [{ name: "go", kind: "hidden", value: "1" }] });
  } else out.push({ type: "markdown", text: t("noFileRight") });
  return out;
}

/* ───────────── 5. Le secours : importer un fichier ───────────── */

function importBlocks(ctx) {
  const t = ctx.t, out = [{ type: "heading", text: t("importTitle") }];
  out.push({ type: "markdown", text: t("importIntro", { rows: LIMITS.csvRows }) });
  if (!can(ctx, RIGHT_MANAGE)) return out;
  out.push({ type: "adminForm", action: "importFile", submitLabel: t("importButton"), fields: [
    { name: "file", kind: "file", accept: ".csv,.tsv,.txt", maxBytes: LIMITS.csvBytes, label: t("importFileLabel"), help: t("importFileHelp") },
    { name: "paste", kind: "textarea", label: t("importPasteLabel"), help: t("importPasteHelp"), value: "" },
    { name: "replace", kind: "checkbox", label: t("importReplace"), help: t("importReplaceHelp"), value: "" },
  ] });
  return out;
}

/* ───────────── 6. Le nettoyage ───────────── */

function tidyBlocks(ctx, snap) {
  if (!can(ctx, RIGHT_MANAGE) || !snap.people.size) return [];
  const t = ctx.t;
  return [
    { type: "heading", text: t("tidyTitle") },
    { type: "markdown", text: t("tidyIntro", { days: S.knobs(ctx).keepDays }) },
    { type: "adminForm", action: "tidy", submitLabel: t("tidyButton"), fields: [{ name: "go", kind: "hidden", value: "1" }] },
  ];
}

/* ───────────── Les actions ───────────── */

const back_ = (ok, extra = {}) => ({ ok, redirect: "?", ...extra });

export const actions = {
  refresh: { right: RIGHT_MANAGE, async run(ctx) {
    const t = ctx.t;
    const r = await S.refresh(ctx, { force: true });
    if (!r.ok) return { error: t(r.code === "no_token" ? "needToken" : r.code === "not_pull" ? "sync_not_pull" : `sync_${r.code}`) };
    return back_(t(r.partial ? "refreshPartial" : "refreshDone", { n: r.count ?? 0, added: r.added ?? 0, ended: r.ended ?? 0 }));
  } },
  search: async (ctx, values) => {
    const q = clean(values.q, 100), f = FILTERS.includes(str(values.filter)) ? str(values.filter) : "all";
    return { redirect: `?filter=${f}${q ? `&q=${enc(q)}` : ""}` };
  },
  personRenew: { right: RIGHT_MANAGE, async run(ctx, values) {
    const r = await O.consentLink(ctx, clean(values.pid, 40), { renew: true });
    return r.ok ? { ok: ctx.t("linkRenewed"), redirect: `?p=${clean(values.pid, 40)}` } : { error: ctx.t("personGone") };
  } },
  personApprove: { right: RIGHT_MANAGE, async run(ctx, values) {
    const approve = str(values.approve) === "1", pid = clean(values.pid, 40);
    const r = await O.setApproval(ctx, pid, approve);
    if (!r.ok) return { error: ctx.t(r.code === "no_consent" ? "noConsentYet" : "personGone") };
    return { ok: ctx.t(approve ? "approved" : "refused"), redirect: approve ? `?p=${pid}` : "?" };
  } },
  personHide: { right: RIGHT_MANAGE, async run(ctx, values) {
    const hidden = str(values.hidden) === "1", pid = clean(values.pid, 40);
    const r = await O.setHidden(ctx, pid, hidden);
    return r.ok ? { ok: ctx.t(hidden ? "hiddenDone" : "shownDone"), redirect: `?p=${pid}` } : { error: ctx.t("personGone") };
  } },
  personForget: { right: RIGHT_MANAGE, async run(ctx, values) {
    const r = await O.forget(ctx, clean(values.id, 40));
    return r.ok ? back_(ctx.t("forgotten")) : { error: ctx.t("personGone") };
  } },
  tierSave: { right: RIGHT_LABELS, async run(ctx, values) {
    const k = clean(values.k, 120), texts = {};
    for (const loc of ctx.locales) { const x = clean(values[`label_${loc}`], 400); if (x) texts[loc] = x; }
    const r = await O.tierLabel(ctx, k, texts);
    if (!r.ok) {
      if (r.code === "long") return { errors: { [`label_${r.field}`]: ctx.t("errLabelLong", { max: LIMITS.label }) } };
      if (r.code === "amount") return { errors: { [`label_${r.field}`]: ctx.t("errLabelAmount") } };
      return { error: ctx.t("tierGone") };
    }
    return back_(ctx.t("tierSaved"));
  } },
  tierTemplate: { right: RIGHT_LABELS, async run(ctx, values) {
    const id = clean(values.template, 20);
    if (!O.TEMPLATE_IDS.includes(id)) return { errors: { template: ctx.t("errTemplate") } };
    const r = await O.applyTemplate(ctx, id);
    return r.ok ? back_(ctx.t(r.changed ? "tplDone" : "tplNothing", { n: r.changed })) : { error: ctx.t("errSave") };
  } },
  importFile: { right: RIGHT_MANAGE, async run(ctx, values) {
    const t = ctx.t;
    const file = typeof values.file === "string" ? values.file : "", paste = typeof values.paste === "string" ? values.paste : "";
    const text = file.trim() ? file : paste;
    const field = file.trim() ? "file" : "paste";
    if (!text.trim()) return { errors: { file: t("errImportEmpty") } };
    const r = await O.importText(ctx, text, { replace: str(values.replace) === "on" });
    if (!r.ok) {
      const msg = { empty: "errImportEmpty", big: "errImportBig", nohead: "errImportHead", noname: "errImportName", many: "errImportMany", norows: "errImportNoRows" }[r.code] ?? "errSave";
      return { errors: { [field]: t(msg, { max: LIMITS.csvRows, kb: Math.round(LIMITS.csvBytes / 1000), line: r.skipped?.[0]?.line ?? "" }) } };
    }
    const skipped = r.skipped?.length ? ` ${t("importSkipped", { n: r.skipped.length, line: r.skipped[0].line })}` : "";
    return back_(t("importDone", { added: r.added, updated: r.updated, ended: r.ended }) + skipped);
  } },
  fileContacts: { right: RIGHT_FILE, async run(ctx) {
    const t = ctx.t;
    const r = await O.fileContacts(ctx);
    if (!r.ok) return { error: t(r.code) };
    const stop = r.stopped ? ` ${t(`fileStop_${r.stopped}`)}` : "";
    const wall = r.wall ? ` ${r.wall.stopped ? t("wallStopped") : t("wallDone", { added: r.wall.added, removed: r.wall.removed })}` : "";
    return back_(t("fileDone", { filed: r.filed, created: r.created, left: r.left }) + stop + wall);
  } },
  tidy: { right: RIGHT_MANAGE, async run(ctx) {
    const r = await O.tidy(ctx);
    return back_(r.removed ? ctx.t("tidyDone", { n: r.removed }) : ctx.t("tidyNothing"));
  } },
};

export const badge = async (ctx) => {
  try { return S.summary(ctx, await D.snapshot(ctx)).pending; } catch { return 0; }
};
