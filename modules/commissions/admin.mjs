// Commandes — l'administration : l'état de la file en un clic, la liste des demandes, la fiche d'une commande, les formules.
// Les droits sont décidés par le cœur (`rights` du manifeste : gérer, voir les e-mails, exporter) ; ici on cache seulement ce qu'une personne n'a pas le droit de faire.
// Rien de ce qu'une visiteuse a écrit n'entre dans du HTML : tout passe par des blocs « table », « heading », « banner » que le cœur échappe.
const v = new URL(import.meta.url).search;
const L = await import(`./lib.mjs${v}`);
const D = await import(`./data.mjs${v}`);
const B = await import(`./book.mjs${v}`);
const M = await import(`./mailer.mjs${v}`);
const { STATUSES, ACTIVE, FINISHED, MODES, NEXT, LIMITS, clean, idOk, dayOk, newToken, hashToken, tokenKey, pathPrefix, fmtDay } = L;

const can = (ctx, right) => typeof ctx.can === "function" && ctx.can(right) === true;
const one = (x) => (typeof x === "string" ? x : Array.isArray(x) ? String(x[0] ?? "") : "");
const day = (d) => d.toISOString().slice(0, 10);
const stamp = (d) => `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}`;
const FILTERS = ["new", "queue", "done", "all"];

const matches = (filter, o) => filter === "all" || (filter === "new" && o.status === "new") || (filter === "queue" && ACTIVE.includes(o.status)) || (filter === "done" && FINISHED.includes(o.status));
const queueTime = (o) => Date.parse(o.queuedAt) || o.at.getTime();

// ── Le panneau ────────────────────────────────────────────────────────────────────────────────────────────────────
export async function adminPanel(ctx, { query } = {}) {
  const q = query && typeof query === "object" ? query : {};
  const manage = can(ctx, "manage");
  const blocks = [];
  if (idOk(one(q.order))) blocks.push(...(await detail(ctx, one(q.order), manage)));
  else blocks.push(...(await overview(ctx, q, manage)));
  blocks.push(...(await formulasTab(ctx, one(q.formula), manage)));
  return blocks;
}

async function overview(ctx, q, manage) {
  const [queue, st] = await Promise.all([D.readQueue(ctx), D.stats(ctx)]);
  const ps = D.publicState(queue, st);
  const blocks = [];
  if (!(await M.enabled(ctx))) {
    blocks.push({ type: "banner", tone: "info", text: ctx.t(ctx.setting("clientMails") === false ? "mailOff" : "mailNotSet") });
    if (ctx.setting("clientMails") !== false) blocks.push({ type: "links", items: [{ label: ctx.t("mailSetLink"), href: "/admin/settings" }] });
  }
  if (st.total >= LIMITS.orders * 0.9) blocks.push({ type: "banner", tone: "warning", text: ctx.t("nearFull", { n: st.total, max: LIMITS.orders }) });
  blocks.push({ type: "heading", text: ctx.t("stateTitle") });
  const free = ps.free === null ? "" : ctx.t("slotsFree", { free: ps.free, slots: queue.slots });
  blocks.push({ type: "banner", tone: ps.state === "open" ? "success" : ps.state === "full" ? "warning" : "info", text: ctx.t(`seen_${ps.state}`, { free }) });
  if (queue.reopenOn && ps.state !== "open" && queue.reopenOn < day(new Date())) blocks.push({ type: "banner", tone: "info", text: ctx.t("reopenPassed", { date: fmtDay(ctx.locale, queue.reopenOn) }) });
  if (manage) {
    blocks.push({
      type: "table", columns: [ctx.t("colMode"), ctx.t("colModeSeen")],
      rows: MODES.map((m) => [`${queue.mode === m ? "✓ " : ""}${ctx.t(`mode_${m}`)}`, ctx.t(`modeHelp_${m}`)]),
      rowIds: [...MODES], rowActions: [{ label: ctx.t("modeChoose"), action: "setMode" }],
    });
    blocks.push({
      type: "adminForm", action: "saveQueue", title: ctx.t("queueFormTitle"), submitLabel: ctx.t("save"),
      fields: [
        { name: "slots", kind: "number", label: ctx.t("fSlots"), help: ctx.t("fSlotsHelp"), value: String(queue.slots) },
        { name: "reopenOn", kind: "date", label: ctx.t("fReopen"), help: ctx.t("fReopenHelp"), value: queue.reopenOn },
        { name: "message", kind: "text", label: ctx.t("fMessage"), help: ctx.t("fMessageHelp"), value: queue.message },
      ],
    });
  }

  // La liste : 50 par page, filtrée, par curseur (l'identifiant de la dernière ligne vue).
  const filter = FILTERS.includes(one(q.filter)) ? one(q.filter) : st.byStatus.new ? "new" : st.active ? "queue" : "all";
  const count = { new: st.byStatus.new, queue: st.active, done: FINISHED.reduce((n, s) => n + st.byStatus[s], 0), all: st.total };
  blocks.push({ type: "heading", text: ctx.t("ordersTitle") });
  blocks.push({ type: "links", items: FILTERS.map((f) => ({ label: `${f === filter ? "● " : ""}${ctx.t(`filter_${f}`, { n: count[f] })}`, href: `?filter=${f}` })) });
  const sorted = st.orders.filter((o) => matches(filter, o));
  if (filter === "new" || filter === "queue") sorted.sort((a, b) => queueTime(a) - queueTime(b) || (a.id < b.id ? -1 : 1));
  else sorted.sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
  const after = one(q.after);
  const from = after ? sorted.findIndex((o) => o.id === after) + 1 : 0;
  const pageRows = sorted.slice(from, from + LIMITS.page);
  if (!pageRows.length) blocks.push({ type: "markdown", text: ctx.t(st.total ? "emptyFilter" : "emptyAll") });
  else {
    blocks.push({
      type: "table", columns: [ctx.t("colDate"), ctx.t("colNick"), ctx.t("colFormula"), ctx.t("colStatus")],
      rows: pageRows.map((o) => [day(o.at), o.nick || "—", o.formulaName || "—", `${ctx.t(`status_${o.status}`)}${o.contactId ? " · 📇" : ""}`]),
      rowIds: pageRows.map((o) => o.id), rowActions: [{ label: ctx.t("open"), href: "?order={id}" }],
    });
    if (from + LIMITS.page < sorted.length) blocks.push({ type: "links", items: [{ label: ctx.t("nextPage"), href: `?filter=${filter}&after=${pageRows[pageRows.length - 1].id}` }] });
  }
  if (can(ctx, "export")) blocks.push({ type: "download", name: "orders", label: ctx.t("exportCsv") });
  return blocks;
}

async function detail(ctx, id, manage) {
  const o = await D.getOrder(ctx, id);
  const back = { type: "links", items: [{ label: ctx.t("backToList"), href: "?" }] };
  if (!o) return [back, { type: "banner", tone: "warning", text: ctx.t("errGone") }];
  const card = await B.cardOf(ctx, o);
  const blocks = [back, { type: "heading", text: ctx.t("orderOf", { nick: o.nick || "—" }) }];
  if (card.state === "missing") blocks.push({ type: "banner", tone: "warning", text: ctx.t("cardMissing") });
  if (card.state === "unavailable") blocks.push({ type: "banner", tone: "info", text: ctx.t("cardUnavailable") });
  const rows = [
    [ctx.t("fStatus"), ctx.t(`status_${o.status}`)],
    [ctx.t("fReceived"), stamp(o.at)],
    [ctx.t("fFormula"), o.formulaName || "—"],
  ];
  if (can(ctx, "email.view")) {
    const email = o.email || (card.state === "found" && typeof card.card.email === "string" ? card.card.email : "");
    rows.push([ctx.t("fEmail"), email ? (o.email ? email : ctx.t("emailInContacts", { email })) : "—"]);
  }
  rows.push([ctx.t("fContact"), card.state === "found" ? ctx.t("contactYes") : o.contactId ? ctx.t("contactLost") : ctx.t("contactNo")]);
  rows.push([ctx.t("fMailOpt"), ctx.t(o.mailOptIn ? "yes" : "no")], [ctx.t("fWant"), o.want || "—"], [ctx.t("fInspiration"), o.inspiration || "—"]);
  blocks.push({ type: "table", columns: [ctx.t("colDetail"), ctx.t("colValue")], rows });
  const links = [];
  if (o.inspiration) links.push({ label: ctx.t("openInspiration"), href: o.inspiration });
  if (card.state === "found" && typeof card.card.adminPath === "string" && /^\/admin\/[A-Za-z0-9/_-]*$/.test(card.card.adminPath)) links.push({ label: ctx.t("openCard"), href: card.card.adminPath });
  if (links.length) blocks.push({ type: "links", items: links });
  const hist = o.history.length ? o.history : [{ s: "new", at: o.at.toISOString() }];
  blocks.push({ type: "heading", text: ctx.t("historyTitle") }, { type: "table", columns: [ctx.t("colDate"), ctx.t("colStatus")], rows: hist.map((h) => [stamp(new Date(h.at)), ctx.t(`status_${h.s}`)]) });

  if (!manage) return blocks;
  const mailOn = await M.enabled(ctx);
  const canLink = !o.contactId && (await B.available(ctx));
  blocks.push({ type: "heading", text: ctx.t("moveTitle") });
  const fields = [
    { name: "id", kind: "hidden", value: o.id },
    { name: "status", kind: "select", label: ctx.t("fNewStatus"), value: NEXT[o.status] ?? o.status, options: STATUSES.map((s) => ({ value: s, label: ctx.t(`status_${s}`) })) },
    { name: "clientNote", kind: "textarea", label: ctx.t("fClientNote"), help: ctx.t("fClientNoteHelp"), value: o.clientNote },
  ];
  if (mailOn && o.mailOptIn) fields.push({ name: "notify", kind: "checkbox", label: ctx.t("fNotifyThem"), value: "on" });
  if (canLink) fields.push({ name: "contact", kind: "checkbox", label: ctx.t("fCreateCard"), help: ctx.t("fCreateCardHelp"), value: "" });
  blocks.push({ type: "adminForm", action: "setStatus", submitLabel: ctx.t("save"), fields, cancelHref: "?" });
  blocks.push({
    type: "adminForm", action: "saveNote", title: ctx.t("noteTitle"), submitLabel: ctx.t("save"),
    fields: [{ name: "id", kind: "hidden", value: o.id }, { name: "privateNote", kind: "textarea", label: ctx.t("fNote"), help: ctx.t("fNoteHelp"), value: o.privateNote }],
  });
  const row1 = (title, text, action, label, extra = {}) => ({ type: "table", columns: [title], rows: [[text]], rowIds: [o.id], rowActions: [{ label, action, ...extra }] });
  if (canLink) blocks.push(row1(ctx.t("contactsTitle"), ctx.t("contactsText"), "linkContact", ctx.t("contactsBtn")));
  blocks.push(row1(ctx.t("linkTitle"), ctx.t("linkText"), "renewLink", ctx.t("linkBtn"), { confirm: ctx.t("linkConfirm") }));
  blocks.push(row1(ctx.t("deleteTitle"), ctx.t("deleteText"), "removeOrder", ctx.t("deleteBtn"), { confirm: ctx.t("deleteConfirm"), danger: true }));
  return blocks;
}

async function formulasTab(ctx, editId, manage) {
  const list = await D.listFormulas(ctx);
  const blocks = [{ type: "markdown", text: ctx.t("formulasHelp"), tab: "formulas" }];
  if (!list.length) blocks.push({ type: "banner", tone: "info", text: ctx.t("formulasNone"), tab: "formulas" });
  else {
    blocks.push({
      type: "table", tab: "formulas", columns: [ctx.t("colName"), ctx.t("price"), ctx.t("delay"), ctx.t("colShown")],
      rows: list.map((f) => [f.name, f.price || "—", f.delay || "—", ctx.t(f.visible ? "yes" : "no")]), rowIds: list.map((f) => f.id),
      rowActions: manage ? [
        { label: ctx.t("edit"), href: "?formula={id}&tab=formulas" }, { label: ctx.t("moveUp"), action: "moveUp" }, { label: ctx.t("moveDown"), action: "moveDown" },
        { label: ctx.t("delete"), action: "removeFormula", confirm: ctx.t("formulaDeleteConfirm"), danger: true },
      ] : [],
    });
  }
  if (!manage) return blocks;
  const editing = idOk(editId) ? list.find((f) => f.id === editId) : null;
  if (!editing && list.length >= LIMITS.formulas) return [...blocks, { type: "banner", tone: "info", tab: "formulas", text: ctx.t("formulasMax", { n: LIMITS.formulas }) }];
  blocks.push({
    type: "adminForm", tab: "formulas", action: "saveFormula", title: ctx.t(editing ? "formulaEdit" : "formulaAdd"), submitLabel: ctx.t("save"), ...(editing ? { cancelHref: "?tab=formulas" } : {}),
    fields: [
      { name: "id", kind: "hidden", value: editing?.id ?? "" },
      { name: "name", kind: "text", label: ctx.t("fFormulaName"), help: ctx.t("fFormulaNameHelp"), required: true, value: editing?.name ?? "" },
      { name: "price", kind: "text", label: ctx.t("fFormulaPrice"), help: ctx.t("fFormulaPriceHelp"), value: editing?.price ?? "" },
      { name: "delay", kind: "text", label: ctx.t("fFormulaDelay"), help: ctx.t("fFormulaDelayHelp"), value: editing?.delay ?? "" },
      { name: "includes", kind: "textarea", label: ctx.t("fFormulaIncludes"), help: ctx.t("fFormulaIncludesHelp"), value: editing?.includes ?? "" },
      { name: "visible", kind: "checkbox", label: ctx.t("fFormulaVisible"), value: editing && !editing.visible ? "" : "on" },
    ],
  });
  return blocks;
}

// ── Les actions ───────────────────────────────────────────────────────────────────────────────────────────────────
const gone = (ctx) => ({ error: ctx.t("errGone") });
const needs = (run) => ({ right: "manage", run });

async function setMode(ctx, values) {
  const mode = String(values.id ?? "");
  if (!MODES.includes(mode)) return { error: ctx.t("errMode") };
  await D.writeQueue(ctx, { mode });
  return { ok: ctx.t(`okMode_${mode}`), redirect: "?" };
}

async function saveQueue(ctx, values) {
  const errors = {};
  const rawSlots = String(values.slots ?? "").trim();
  const slots = Number(rawSlots);
  if (!/^\d{1,2}$/.test(rawSlots) || !Number.isInteger(slots) || slots > LIMITS.slots) errors.slots = ctx.t("errSlots");
  const reopenOn = String(values.reopenOn ?? "").trim();
  if (reopenOn && !dayOk(reopenOn)) errors.reopenOn = ctx.t("errReopen");
  if (Object.keys(errors).length) return { errors };
  await D.writeQueue(ctx, { slots, reopenOn, message: clean(values.message, LIMITS.message) });
  return { ok: ctx.t("okQueue") };
}

async function setStatus(ctx, values) {
  const o = await D.getOrder(ctx, String(values.id ?? ""));
  if (!o) return gone(ctx);
  const status = String(values.status ?? "");
  if (!STATUSES.includes(status)) return { errors: { status: ctx.t("errStatus") } };
  const changed = status !== o.status;
  const now = new Date().toISOString();
  if (changed) {
    o.status = status;
    o.history = [...o.history, { s: status, at: now }].slice(-LIMITS.history);
    if (ACTIVE.includes(status) && !o.queuedAt) o.queuedAt = now;
  }
  o.clientNote = clean(values.clientNote, LIMITS.clientNote, true);
  await D.saveOrder(ctx, o);
  const said = [ctx.t(changed ? "okStatus" : "okSaved", { status: ctx.t(`status_${status}`) })];
  if (values.contact === "on" && !o.contactId && ["accepted", "in_progress", "delivered"].includes(status)) {
    const r = await B.linkOrder(ctx, o);
    said.push(r.ok ? ctx.t(r.created ? "okCardCreated" : "okCardFound") : ctx.t(`errCard_${r.why}`));
  }
  if (changed && values.notify === "on" && o.mailOptIn) {
    const { email } = await B.emailOf(ctx, o);
    const r = await M.statusChanged(ctx, o, status, email);
    said.push(ctx.t(r.ok ? "okMailSent" : r.reason === "rate_limited" ? "errMailLimit" : "errMailFailed"));
  }
  if (changed && ACTIVE.includes(status)) {
    const [queue, st] = await Promise.all([D.readQueue(ctx), D.stats(ctx)]);
    if (queue.slots > 0 && st.active > queue.slots) said.push(ctx.t("overSlots", { slots: queue.slots }));
  }
  return { ok: said.join(" "), redirect: `?order=${o.id}` };
}

async function saveNote(ctx, values) {
  const o = await D.getOrder(ctx, String(values.id ?? ""));
  if (!o) return gone(ctx);
  o.privateNote = clean(values.privateNote, LIMITS.note, true);
  await D.saveOrder(ctx, o);
  return { ok: ctx.t("okNote") };
}

async function linkContact(ctx, values) {
  const o = await D.getOrder(ctx, String(values.id ?? ""));
  if (!o) return gone(ctx);
  const r = await B.linkOrder(ctx, o);
  if (!r.ok) return { error: ctx.t(`errCard_${r.why}`) };
  return { ok: ctx.t(r.already ? "okCardFound" : r.created ? "okCardCreated" : "okCardFound"), redirect: `?order=${o.id}` };
}

async function renewLink(ctx, values) {
  const o = await D.getOrder(ctx, String(values.id ?? ""));
  if (!o) return gone(ctx);
  const token = newToken();
  o.tokenHash = hashToken(token);
  await D.saveOrder(ctx, o, { key: tokenKey(o.tokenHash) });
  const url = `${ctx.api.siteUrl}${pathPrefix(ctx, o.lang)}/suivi/${token}`;
  if (o.mailOptIn) {
    const { email } = await B.emailOf(ctx, o);
    const r = await M.newLink(ctx, o, email, token);
    if (r.ok) return { ok: ctx.t("okLinkMailed") };
  }
  return { ok: ctx.t("okLinkShown", { url }) };
}

async function removeOrder(ctx, values) {
  const o = await D.getOrder(ctx, String(values.id ?? ""));
  if (!o) return gone(ctx);
  await D.removeOrder(ctx, o.id);
  return { ok: ctx.t("okDeleted"), redirect: "?" };
}

async function saveFormula(ctx, values) {
  const errors = {};
  const name = clean(values.name, LIMITS.formulaName);
  if (!name) errors.name = ctx.t("errFormulaName");
  if (Object.keys(errors).length) return { errors };
  const list = await D.listFormulas(ctx);
  const editing = idOk(values.id) ? list.find((f) => f.id === values.id) : null;
  if (idOk(values.id) && !editing) return gone(ctx);
  if (!editing && list.length >= LIMITS.formulas) return { error: ctx.t("formulasMax", { n: LIMITS.formulas }) };
  const f = {
    name, price: clean(values.price, LIMITS.formulaPrice), delay: clean(values.delay, LIMITS.formulaDelay), includes: clean(values.includes, LIMITS.formulaIncludes, true),
    visible: values.visible === "on", pos: editing ? editing.pos : (list.length ? Math.max(...list.map((x) => x.pos)) + 1 : 0),
  };
  if (editing) await ctx.api.store.update(editing.id, D.formulaData(f)); else await ctx.api.store.add(D.FORMULAS, D.formulaData(f));
  return { ok: ctx.t(editing ? "okFormulaSaved" : "okFormulaAdded"), redirect: "?tab=formulas" };
}

async function removeFormula(ctx, values) {
  const list = await D.listFormulas(ctx);
  if (!idOk(values.id) || !list.some((f) => f.id === values.id)) return gone(ctx);
  await ctx.api.store.remove(values.id);
  return { ok: ctx.t("okFormulaDeleted"), redirect: "?tab=formulas" };
}

const move = (delta) => async (ctx, values) => {
  const list = await D.listFormulas(ctx);
  const i = list.findIndex((f) => f.id === values.id);
  if (i < 0) return gone(ctx);
  const j = i + delta;
  if (j < 0 || j >= list.length) return { ok: ctx.t("okMoved"), redirect: "?tab=formulas" };
  const order = list.map((f) => f.id);
  [order[i], order[j]] = [order[j], order[i]];
  for (const [pos, id] of order.entries()) {
    const f = list.find((x) => x.id === id);
    if (f.pos !== pos) await ctx.api.store.update(id, D.formulaData({ ...f, pos }));
  }
  return { ok: ctx.t("okMoved"), redirect: "?tab=formulas" };
};

export const adminActions = {
  setMode: needs(setMode), saveQueue: needs(saveQueue), setStatus: needs(setStatus), saveNote: needs(saveNote), linkContact: needs(linkContact),
  renewLink: needs(renewLink), removeOrder: needs(removeOrder), saveFormula: needs(saveFormula), removeFormula: needs(removeFormula),
  moveUp: needs(move(-1)), moveDown: needs(move(1)),
};

/** Pastille du menu : les demandes nouvelles qui attendent une réponse. */
export async function adminBadge(ctx) { return (await D.stats(ctx)).byStatus.new; }
