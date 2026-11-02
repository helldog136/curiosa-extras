// Boîte à idées — l'administration : un seul tableau (recherche, pastilles, interrupteur « Publiée »), l'écran d'une idée, la fusion de doublons,
// le tableau de bord et la pastille du menu. Les gestes eux-mêmes sont dans ops.mjs (partagés avec l'assistant IA).
const v = new URL(import.meta.url).search;   // chaque fichier voisin est importé avec la version du module (voir index.mjs)
const { PAGE_SIZE, STATUSES, excerpt, isStatus, loadAll, settings } = await import(`./lib.mjs${v}`);
const { mergeIdeas, pendingCount, purgeRefused, removeIdea, saveIdea, setState, setVisible } = await import(`./ops.mjs${v}`);

const RIGHTS = { moderate: "ideas.moderate", delete: "ideas.delete" };
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const oneLine = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

const BADGES = { proposed: "neutral", studied: "info", planned: "accent", done: "ok", dismissed: "neutral" };
/** Le mot et la couleur de la colonne « État » : à relire, masquée ou refusée avant le statut de l'idée. */
function stateCell(ctx, i) {
  if (i.state === "pending") return { text: ctx.t("state_pending"), badge: "warn" };
  if (i.state === "hidden") return { text: ctx.t("state_hidden"), badge: "neutral" };
  if (i.state === "refused") return { text: ctx.t("state_refused"), badge: "danger" };
  return { text: ctx.t(`status_${i.status}`), badge: BADGES[i.status] };
}

/** Les idées dans l'ordre de travail : celles à relire d'abord, puis les plus récentes. */
const inWorkOrder = (list) => [...list].sort((a, b) => (b.state === "pending") - (a.state === "pending") || b.at - a.at);

function listBlocks(ctx, all, review) {
  const s = settings(ctx);
  const pending = all.filter((i) => i.state === "pending").length;
  const shown = review ? all.filter((i) => i.state === "pending") : all;
  const blocks = [{ type: "markdown", text: ctx.t("adminIntro") }];
  if (review) {
    blocks.push({ type: "links", items: [{ label: ctx.t("seeAll"), href: "?tab=use" }] });
    if (!shown.length) return [...blocks, { type: "markdown", text: ctx.t("nothingToReview") }];
  } else if (pending > 0) {
    blocks.push({ type: "banner", tone: "info", text: ctx.t(pending === 1 ? "pendingBanner_one" : "pendingBanner", { n: pending }) });
  }
  const rows = inWorkOrder(shown);
  const path = ctx.instance.basePath ? `/${ctx.instance.basePath}` : "/";
  const stateOf = (i) => stateCell(ctx, i);
  // Ce qui est identique pour toutes les lignes est un titre, pas une colonne (R14) : « À relire » partout, ou 0 soutien partout, ne s'affiche pas.
  const same = (f) => rows.length > 5 && rows.every((i) => f(i) === f(rows[0]));
  const dropState = review || same((i) => stateOf(i).text), dropSupport = !s.votes || same((i) => i.votes);
  const cols = [
    { head: ctx.t("colIdea"), cell: (i) => ({ text: oneLine(i.text), title: i.text }) },
    { head: ctx.t("colNick"), cell: (i) => i.nick || "—" },
    ...(dropSupport ? [] : [{ head: ctx.t("colSupport"), cell: (i) => String(i.votes) }]),
    ...(dropState ? [] : [{ head: ctx.t("colState"), cell: stateOf, filter: true }]),
    { head: ctx.t("colPublished"), cell: (i) => ({ text: ctx.t(i.state === "published" ? "published" : "notPublished"), switch: { on: i.state === "published", action: "setVisible", label: ctx.t("switchLabel", { idea: excerpt(i.text, 50) }), onText: ctx.t("published"), offText: ctx.t("notPublished") } }) },
  ];
  blocks.push({
    type: "table", columns: cols.map((c) => c.head), rowIds: rows.map((i) => i.id), searchable: true, searchPlaceholder: ctx.t("adminSearch"), truncate: [0], pageSize: PAGE_SIZE, empty: ctx.t("tableEmpty", { path }),
    filters: cols.flatMap((c, n) => (c.filter ? [{ column: n }] : [])),
    rows: rows.map((i) => cols.map((c) => c.cell(i))),
    rowActions: [
      { label: ctx.t("rowEdit"), href: "?tab=use&edit={id}" },
      { label: ctx.t("rowRefuse"), action: "refuse", confirm: ctx.t("confirmRefuse", { days: s.keepRefusedDays }) },
      { label: ctx.t("rowMerge"), href: "?tab=use&merge={id}", inMenu: true },
      { label: ctx.t("rowDelete"), action: "remove", danger: true, confirm: ctx.t("confirmDelete") },
    ],
  });
  return blocks;
}

function editBlocks(ctx, i) {
  const note = i.state === "published" ? "editPublished" : i.state === "pending" ? "editPending" : i.state === "refused" ? "editRefused" : "editHidden";
  return [
    { type: "heading", text: ctx.t("editTitle") },
    { type: "markdown", text: ctx.t(note) },
    {
      type: "adminForm", action: "saveIdea", submitLabel: ctx.t("saveIdea"), cancelHref: "?tab=use",
      fields: [
        { name: "id", kind: "hidden", value: i.id },
        { name: "visible", kind: "switch", label: ctx.t("fieldPublished"), value: i.state === "published" ? "on" : "" },
        { name: "status", kind: "select", label: ctx.t("fieldStatus"), value: i.status, options: STATUSES.map((s) => ({ value: s, label: ctx.t(`status_${s}`) })) },
        { name: "reply", kind: "textarea", label: ctx.t("fieldReply"), value: i.reply, example: ctx.t("replyExample") },
        { name: "text", kind: "textarea", label: ctx.t("fieldText"), value: i.text, folded: true },
        { name: "nick", kind: "text", label: ctx.t("fieldNick"), value: i.nick, folded: true },
      ],
    },
  ];
}

/** Choisir l'idée à garder (tableau avec recherche), puis confirmer. */
function mergeBlocks(ctx, all, from, into) {
  const back = { type: "links", items: [{ label: ctx.t("backToList"), href: "?tab=use" }] };
  const row = (i) => [{ text: oneLine(i.text), title: i.text }, String(i.votes), stateCell(ctx, i)];
  const columns = [ctx.t("colIdea"), ctx.t("colSupport"), ctx.t("colState")];
  if (into) {
    return [
      { type: "heading", text: ctx.t("mergeConfirmTitle") },
      { type: "markdown", text: ctx.t("mergeConfirmText") },
      { type: "table", columns: [ctx.t("colRole"), ...columns], truncate: [1], rows: [[ctx.t("roleFrom"), ...row(from)], [ctx.t("roleInto"), ...row(into)]] },
      { type: "adminForm", action: "mergeIdeas", submitLabel: ctx.t("mergeSubmit"), cancelHref: "?tab=use", fields: [{ name: "id", kind: "hidden", value: from.id }, { name: "into", kind: "hidden", value: into.id }] },
    ];
  }
  const others = inWorkOrder(all.filter((i) => i.id !== from.id && i.state !== "refused"));
  return [
    { type: "heading", text: ctx.t("mergeTitle") },
    { type: "markdown", text: ctx.t("mergeText") },
    { type: "table", columns, truncate: [0], rows: [row(from)] },
    { type: "heading", text: ctx.t("mergePick") },
    others.length
      ? { type: "table", columns, rowIds: others.map((i) => i.id), rows: others.map(row), searchable: true, searchPlaceholder: ctx.t("adminSearch"), truncate: [0], pageSize: PAGE_SIZE,
          rowActions: [{ label: ctx.t("mergeHere"), href: `?tab=use&merge=${from.id}&into={id}` }] }
      : { type: "markdown", text: ctx.t("mergeNone") },
    back,
  ];
}

export async function adminPanel(ctx, { query } = {}) {
  const q = query ?? {};
  let all = await loadAll(ctx);
  if (await purgeRefused(ctx, Date.now(), all)) all = await loadAll(ctx);   // le ménage des idées refusées se fait ici, pas dans un minuteur
  const find = (id) => (typeof id === "string" && ID_RE.test(id) ? all.find((i) => i.id === id) : undefined);
  const edit = find(q.edit), from = find(q.merge);
  if (edit) return editBlocks(ctx, edit);
  if (from) return mergeBlocks(ctx, all, from, find(q.into));
  return listBlocks(ctx, all, q.show === "review");
}

const fail = (ctx, code, max) => ({ error: ctx.t(`err_${code}`, { max }) });
const fieldErrors = (ctx, errors) => ({ errors: Object.fromEntries(Object.entries(errors).map(([f, code]) => [f, ctx.t(`err_${code}`, { max: settings(ctx).textMax })])) });

export const adminActions = {
  setVisible: { right: RIGHTS.moderate, async run(ctx, values) {
    const r = await setVisible(ctx, values.id, values.enabled === "1");
    return r.error ? fail(ctx, r.error) : { ok: ctx.t(values.enabled === "1" ? "okPublished" : "okHidden") };
  } },
  refuse: { right: RIGHTS.moderate, async run(ctx, values) {
    const r = await setState(ctx, values.id, "refused");
    return r.error ? fail(ctx, r.error) : { ok: ctx.t("okRefused") };
  } },
  saveIdea: { right: RIGHTS.moderate, async run(ctx, values) {
    const r = await saveIdea(ctx, values.id, {
      status: isStatus(values.status) ? values.status : values.status === undefined ? undefined : "?", reply: values.reply ?? "",
      ...(values.text !== undefined ? { text: values.text } : {}), ...(values.nick !== undefined ? { nick: values.nick } : {}), visible: values.visible === "on",
    });
    if (r.error) return fail(ctx, r.error);
    if (r.errors) return fieldErrors(ctx, r.errors);
    return { ok: ctx.t("okSaved"), redirect: "?tab=use" };
  } },
  mergeIdeas: { right: RIGHTS.moderate, async run(ctx, values) {
    const r = await mergeIdeas(ctx, values.id, values.into);
    return r.error ? fail(ctx, r.error) : { ok: ctx.t("okMerged", { n: r.votes }), redirect: "?tab=use" };
  } },
  remove: { right: RIGHTS.delete, async run(ctx, values) {
    const r = await removeIdea(ctx, values.id);
    return r.error ? fail(ctx, r.error) : { ok: ctx.t("okDeleted") };
  } },
};

/** Le tableau de bord : une tâche (« n idées à relire ») et une carte (les idées les plus soutenues). Lecture rapide, jamais de service externe. */
export const dashboard = {
  tasks: { review: (ctx) => pendingCount(ctx) },
  cards: {
    async top(ctx) {
      const best = (await loadAll(ctx)).filter((i) => i.state === "published").sort((a, b) => b.votes - a.votes || b.at - a.at).slice(0, 5);
      return { rows: best.map((i) => ({ title: excerpt(i.text, 70), detail: ctx.t(i.votes === 1 ? "supportCount_one" : "supportCount", { n: i.votes }), href: `?tab=use&edit=${encodeURIComponent(i.id)}` })) };
    },
  },
};

export const adminBadge = pendingCount;
