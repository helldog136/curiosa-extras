// La partie « Ajouter une chaîne » et « Ma liste » de la page d'administration de Raid : un champ pour ajouter, un aperçu pour coller beaucoup de lignes, la liste
// par pages avec « Retirer ». La logique est dans quick.mjs ; ici : les blocs affichés et les actions des boutons. Écrit pour quelqu'un qui n'est pas technicien :
// des phrases, chaque erreur s'affiche SOUS le champ concerné (`errors`) et dit quoi faire.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const live = await import(`./live.mjs${v}`);
const source = await import(`./source.mjs${v}`);
const quick = await import(`./quick.mjs${v}`);
const pure = await import(`./pure.mjs${v}`);
const { explainLogin, looksLikeChannel, oneLine } = pure;
const { settingsOf } = await import(`./settings.mjs${v}`);

const forget = () => { source.resetSource(); live.resetLive(); };
const isId = (x) => typeof x === "string" && x.length > 0 && x.length <= 80;
const short = (s, n = 40) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const enc = encodeURIComponent;
/** Une valeur d'adresse d'administration → texte propre (jamais de HTML, 100 caractères au plus). */
const param = (query, key, max = 100) => oneLine(typeof query?.[key] === "string" ? query[key] : "", max);

/** Les problèmes qui empêchent d'ajouter quoi que ce soit : Contacts absent, trop ancien, muet ; catégorie choisie disparue. */
export const BLOCKING = new Set(["contacts_missing", "contacts_old", "contacts_down", "category_gone"]);

/** La phrase d'un problème d'ajout (sous le champ). `extra` : { label } */
export function problemLine(ctx, problem, extra = {}) {
  const t = ctx.t, label = extra.label ?? source.defaultName(ctx);
  switch (problem) {
    case "category_denied": return t("add_err_category", { label });
    case "taken": return t("add_err_taken", { name: extra.name ? `« ${short(extra.name, 60)} »` : t("add_another_card") });
    case "person_gone": return t("add_err_person_gone");
    case "too_many_accounts": return t("add_err_too_many_accounts");
    case "invalid": return t("add_err_invalid");
    case "no_batch": return t("batch_err_none");
    default: return t(`dock_nr_${problem}`, { label });
  }
}
/** La phrase d'un pseudo refusé. */
export const loginLine = (ctx, error, input) => ctx.t(`add_err_${error === "empty" ? "chars" : error}`, { input: short(oneLine(input, 80), 50) });

/** Ce que dit un ajout réussi (une chaîne ou plusieurs). */
function summary(ctx, r, name) {
  const t = ctx.t, parts = [];
  const one = r.added + r.joined + r.already + r.unknown.length + r.failed.length === 1;
  if (one && r.added) parts.push(t("add_done_new", { name }));
  else if (one && r.joined) parts.push(t("add_done_joined", { name }));
  else if (one && r.already) parts.push(t("add_done_already", { name }));
  else {
    if (r.added) parts.push(t("add_n_new", { n: r.added }));
    if (r.joined) parts.push(t("add_n_joined", { n: r.joined }));
    if (r.already) parts.push(t("add_n_already", { n: r.already }));
  }
  if (r.category?.created) parts.push(t("add_cat_created", { label: r.category.label }));
  if (r.twitch === "rate") parts.push(t("add_twitch_rate"));
  else if (r.twitch === "down" || r.twitch === "none" || r.twitch === "partial") parts.push(t("add_twitch_later"));
  return parts.join(" ");
}

/* ───────────── Les blocs ───────────── */

/** « Ajouter une chaîne » : le champ, les résultats, le formulaire de création, l'envoi en gros. */
export async function addBlocks(ctx, src, query) {
  const t = ctx.t, out = [];
  out.push({ type: "heading", text: t("add_title") });
  if (src.state !== "ok" && BLOCKING.has(src.problem)) { out.push({ type: "markdown", text: t("add_blocked") }); return out; }
  out.push({ type: "markdown", text: t("add_help") });
  if (src.state !== "ok" || !src.category) out.push({ type: "banner", tone: "info", text: t("add_will_create", { label: source.defaultName(ctx) }) });

  const q = param(query, "add"), who = param(query, "who", 80);
  out.push({ type: "adminForm", action: "find", submitLabel: t("add_btn"), fields: [{ name: "q", label: t("add_label"), kind: "text", help: t("add_field_help"), value: q }] });

  if (isId(who)) out.push(...await attachBlocks(ctx, who, q));
  else if (q) out.push(...await resultBlocks(ctx, src, q, Number(param(query, "more", 3))));

  out.push(...await batchBlocks(ctx));
  return out;
}

/** Les résultats d'une recherche de nom : qui est dans Contacts (avec ou sans chaîne Twitch), et le bouton « Créer ». */
async function resultBlocks(ctx, src, q, more) {
  const t = ctx.t, out = [];
  const limit = more === 20 ? 20 : more === 30 ? 30 : quick.SEARCH_STEP;
  const res = await quick.findPeople(ctx, q, { limit, categoryId: src.category?.id ?? null });
  out.push({ type: "heading", text: t("res_title", { q: short(q, 50) }) });
  if (!res.ok) { out.push({ type: "banner", tone: "warning", text: problemLine(ctx, res.problem) }); return out; }
  const rows = [], ids = [], without = [], withoutIds = [], inList = [];
  for (const p of res.people) {
    if (!p.twitch.length) { without.push([p.name]); withoutIds.push(enc(p.id)); continue; }
    for (const c of p.twitch) {
      if (c.inList) inList.push(`${p.name} (@${c.handle})`);
      else { rows.push([p.name, `@${c.handle}`]); ids.push(`${enc(p.id)}~${c.handle}`); }
    }
  }
  if (!res.people.length) out.push({ type: "markdown", text: t("res_none", { q: short(q, 50) }) });
  if (rows.length) out.push({ type: "table", columns: [t("res_col_name"), t("res_col_twitch")], rows, rowIds: ids, rowActions: [{ label: t("res_add"), action: "pick" }] });
  if (inList.length) out.push({ type: "markdown", text: t("res_in_list", { list: inList.slice(0, 10).join(", ") }) });
  if (without.length) {
    out.push({ type: "markdown", text: t("res_no_twitch_intro") });
    out.push({ type: "table", columns: [t("res_col_name"), t("res_col_twitch")], rows: without.map((r) => [r[0], t("res_no_twitch")]), rowIds: withoutIds, rowActions: [{ label: t("res_set_pseudo"), href: `?add=${enc(q)}&who={id}` }] });
  }
  if (res.more) out.push({ type: "links", items: [{ label: t("res_more"), href: `?add=${enc(q)}&more=${limit === 10 ? 20 : 30}` }] });

  // Créer : le pseudo tapé s'il en est un ; sinon un nom, et on demande son pseudo Twitch (la seule chose nécessaire).
  const asLogin = explainLogin(q);
  const fields = [{ name: "q", kind: "hidden", value: q }];
  if (!asLogin.login) fields.push({ name: "handle", label: t("create_handle_label", { name: short(q, 40) }), kind: "text", help: t("create_handle_help") });
  out.push({ type: "adminForm", action: "create", submitLabel: res.people.length ? t("create_btn_other", { q: short(q, 30) }) : t("create_btn", { q: short(q, 30) }), fields });
  return out;
}

/** Une personne de Contacts sans chaîne Twitch : un champ pour son pseudo. */
async function attachBlocks(ctx, who, q) {
  const t = ctx.t;
  const r = await ctx.api.services.call(source.BOOK, "resolve", { ids: [who] }).catch(() => null);
  const person = r?.ok && r.value?.ok !== false && Array.isArray(r.value?.contacts) ? r.value.contacts[0] : null;
  if (!person) return [{ type: "banner", tone: "warning", text: t("add_err_person_gone") }, { type: "links", items: [{ label: t("cancel"), href: "?" }] }];
  return [
    { type: "heading", text: t("attach_title", { name: short(oneLine(person.name, 120), 60) }) },
    { type: "adminForm", action: "attach", submitLabel: t("attach_btn"), cancelHref: q ? `?add=${enc(q)}` : "?", fields: [{ name: "id", kind: "hidden", value: who }, { name: "handle", label: t("attach_label"), kind: "text", help: t("add_field_help") }] },
  ];
}

/** Coller plusieurs chaînes : le formulaire, ou l'aperçu (et sa suite) quand un envoi attend. */
async function batchBlocks(ctx) {
  const t = ctx.t, out = [];
  const b = await quick.readBatch(ctx);
  out.push({ type: "heading", text: t("batch_title") });
  if (!b) {
    out.push({ type: "markdown", text: t("batch_help", { max: quick.MAX_LINES }) });
    out.push({ type: "adminForm", action: "bulkPreview", submitLabel: t("batch_preview_btn"), fields: [{ name: "lines", label: t("batch_label"), kind: "textarea", help: t("batch_field_help", { max: quick.MAX_LINES }) }] });
    return out;
  }
  const todo = b.todo.length, a = b.applied;
  if (b.started) {
    const total = a.added + a.joined + a.already + a.unknown + a.failed + todo;
    const done = total - todo;
    out.push({ type: "html", html: `<p><progress value="${done}" max="${Math.max(1, total)}" aria-label="${escapeHtml(t("batch_progress", { done, total }))}" style="width:100%;max-width:24rem"></progress></p>` });
    out.push({ type: "markdown", text: t("batch_progress", { done, total }) });
  } else {
    out.push({ type: "markdown", text: previewText(ctx, b) });
  }
  if (todo) {
    out.push({ type: "adminForm", action: "bulkApply", submitLabel: b.started ? t("batch_continue_btn", { n: todo }) : t("batch_apply_btn", { n: todo }), fields: [] });
    out.push({ type: "adminForm", action: "bulkCancel", submitLabel: t("batch_cancel_btn"), fields: [] });
  } else {
    out.push({ type: "adminForm", action: "bulkCancel", submitLabel: t("batch_close_btn"), fields: [] });
  }
  return out;
}
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** L'aperçu : « N nouvelles, N déjà dans Contacts, N invalides (raison et exemple) » avant de valider. */
function previewText(ctx, b) {
  const t = ctx.t, lines = [t("batch_preview", { news: b.news, existing: b.existing, already: b.already, invalid: b.invalidCount })];
  if (b.dups) lines.push(t("batch_dups", { n: b.dups }));
  if (b.invalidCount) {
    const seen = new Map();
    for (const x of b.invalid) if (!seen.has(x.reason)) seen.set(x.reason, { ...x, n: 0 });
    for (const x of b.invalid) seen.get(x.reason).n++;
    if (b.invalidCount > b.invalid.length) { const first = seen.values().next().value; if (first) first.n += b.invalidCount - b.invalid.length; }
    for (const x of seen.values()) lines.push(t("batch_invalid_line", { reason: t(`batch_reason_${x.reason}`), line: x.line, example: x.input }));
    lines.push(t("batch_invalid_skipped"));
  }
  return lines.join("\n\n");
}

/** « Ma liste » : les chaînes de la catégorie, par pages de 50, avec recherche et « Retirer » (la fiche reste dans Contacts). */
export async function listBlocks(ctx, src, query) {
  const t = ctx.t, out = [];
  if (src.state !== "ok" || !src.category || src.stale) return out;   // Contacts muet : la liste lue plus haut suffit, on n'insiste pas
  const q = param(query, "lq"), cursor = param(query, "cur", pure.CURSOR_MAX);
  if (!src.partners.length && !q) return out;   // liste vide : le compteur ci-dessus le dit déjà
  out.push({ type: "heading", text: t("mylist_title") });
  out.push({ type: "adminForm", action: "listSearch", submitLabel: t("mylist_search_btn"), fields: [{ name: "lq", label: t("mylist_search_label"), kind: "text", value: q }] });
  const page = await quick.listPage(ctx, src.category.id, { cursor, q });
  if (!page.ok) { out.push({ type: "banner", tone: "warning", text: problemLine(ctx, page.problem) }); return out; }
  if (!page.items.length) { out.push({ type: "markdown", text: q ? t("mylist_no_match", { q: short(q, 50) }) : t("mylist_empty") }); if (q) out.push({ type: "links", items: [{ label: t("mylist_clear"), href: "?" }] }); return out; }
  out.push({
    type: "table", columns: [t("mylist_col_name"), t("mylist_col_twitch")],
    rows: page.items.map((x) => [x.displayName && pure.fold(x.displayName) !== pure.fold(x.name) ? `${x.name} (${x.displayName})` : x.name, `@${x.handle}`]),
    rowIds: page.items.map((x) => x.id),
    rowActions: [{ label: t("mylist_remove"), action: "remove", confirm: t("mylist_remove_confirm", { label: src.category.label }) }],
  });
  const links = [];
  if (cursor) links.push({ label: t("mylist_first"), href: q ? `?lq=${enc(q)}` : "?" });
  if (q) links.push({ label: t("mylist_clear"), href: "?" });
  if (page.next) links.push({ label: t("mylist_next"), href: `?${q ? `lq=${enc(q)}&` : ""}cur=${enc(page.next)}` });
  if (links.length) out.push({ type: "links", items: links });
  return out;
}

/* ───────────── Les actions ───────────── */

const back = (message, to = "?") => ({ ok: message, redirect: to });
const failAt = (field, message) => ({ errors: { [field]: message } });

/** Le résultat d'un ajout → la réponse de l'action. `field` : le champ sous lequel afficher une erreur. */
function reply(ctx, r, { field, name }) {
  const fail = (message) => (field ? failAt(field, message) : { error: message });   // sans champ (bouton d'une ligne) : le bandeau d'erreur
  if (!r.ok) return fail(problemLine(ctx, r.problem, { name: r.taken?.name, label: source.defaultName(ctx) }));
  if (r.unknown.length && !r.added && !r.joined && !r.already) return fail(ctx.t("add_err_unknown_twitch", { login: r.unknown[0] }));
  if (r.problem && !r.added && !r.joined && !r.already) return fail(problemLine(ctx, r.problem));
  if (r.failed.length && !r.added && !r.joined && !r.already) return fail(r.failed[0].error === "category_gone" ? problemLine(ctx, "category_gone") : problemLine(ctx, "invalid"));
  if (r.full) return { error: ctx.t("add_err_full") };
  forget();
  return back(summary(ctx, r, name));
}

export const actions = {
  /** Le champ « Ajouter une chaîne » : un lien ou un @pseudo est ajouté tout de suite ; un nom est cherché dans Contacts. */
  async find(ctx, values) {
    const text = oneLine(values.q, 300);
    if (!text) return failAt("q", ctx.t("add_err_empty"));
    if (looksLikeChannel(text)) {
      const p = explainLogin(text);
      if (!p.login) return failAt("q", loginLine(ctx, p.error, text));
      return reply(ctx, await quick.addChannels(ctx, [{ login: p.login }], { wantedChannel: settingsOf(ctx).channel }), { field: "q", name: p.login });
    }
    return { ok: undefined, redirect: `?add=${enc(oneLine(text, 100))}` };
  },

  /** « Ajouter » sur un résultat : la chaîne Twitch de cette personne rejoint la liste (identifiant de ligne : `fiche~pseudo`). */
  async pick(ctx, values) {
    const raw = String(values.id ?? ""), at = raw.lastIndexOf("~");
    const login = explainLogin(raw.slice(at + 1)).login;
    if (at < 1 || !login) return { error: ctx.t("add_err_invalid") };
    return reply(ctx, await quick.addChannels(ctx, [{ login }], { wantedChannel: settingsOf(ctx).channel }), { field: null, name: login });
  },

  /** Le pseudo Twitch d'une personne qui n'en avait pas : il est ajouté à SA fiche, qui rejoint la liste. */
  async attach(ctx, values) {
    const id = oneLine(values.id, 80);
    const p = explainLogin(values.handle);
    if (!p.login) return failAt("handle", p.error === "empty" ? ctx.t("add_err_empty_handle") : loginLine(ctx, p.error, values.handle));
    return reply(ctx, await quick.attachChannel(ctx, id, p.login, { wantedChannel: settingsOf(ctx).channel }), { field: "handle", name: p.login });
  },

  /** « Créer <ce que j'ai tapé> » : une fiche avec ce seul pseudo (ou ce nom + ce pseudo), rangée dans la liste. */
  async create(ctx, values) {
    const typed = oneLine(values.q, 100);
    const asLogin = explainLogin(typed);
    if (asLogin.login) return reply(ctx, await quick.addChannels(ctx, [{ login: asLogin.login }], { wantedChannel: settingsOf(ctx).channel }), { field: null, name: asLogin.login });
    const p = explainLogin(values.handle);
    if (!p.login) return failAt("handle", p.error === "empty" ? ctx.t("add_err_empty_handle") : loginLine(ctx, p.error, values.handle));
    return reply(ctx, await quick.addChannels(ctx, [{ login: p.login, name: typed }], { wantedChannel: settingsOf(ctx).channel }), { field: "handle", name: typed });
  },

  /** Coller plusieurs lignes : l'aperçu, sans rien écrire dans Contacts. */
  async bulkPreview(ctx, values) {
    const p = quick.parsePaste(values.lines);
    if (!p.total) return failAt("lines", ctx.t("batch_err_empty"));
    if (p.over) return failAt("lines", ctx.t("batch_err_over", { max: quick.MAX_LINES, n: p.total }));
    if (!p.logins.length) return failAt("lines", ctx.t("batch_err_none_valid"));
    const r = await quick.previewBatch(ctx, values.lines);
    if (!r.ok) return failAt("lines", problemLine(ctx, r.problem));

    return back(undefined, "?");
  },

  /** Valider l'aperçu (ou « Continuer ») : ajoute ce qu'il reste, dans le temps d'un clic. */
  async bulkApply(ctx) {
    const r = await quick.applyBatch(ctx, { wantedChannel: settingsOf(ctx).channel });
    forget();
    if (!r.ok) return r.problem === "no_batch" ? { error: ctx.t("batch_err_none") } : { error: problemLine(ctx, r.problem) };
    const b = r.batch, a = b.applied, t = ctx.t;
    if (r.stopped === "full") return { error: t("add_err_full") };
    if (!r.finished) return { ok: t("batch_partial", { n: b.todo.length }) + (r.stopped ? ` ${problemLine(ctx, r.stopped)}` : ""), redirect: "?" };
    const parts = [t("batch_done", { added: a.added, joined: a.joined, already: a.already + b.already })];
    if (a.unknown) parts.push(t("batch_done_unknown", { n: a.unknown }));
    if (a.failed) parts.push(t("batch_done_failed", { n: a.failed }));
    if (b.invalidCount) parts.push(t("batch_done_invalid", { n: b.invalidCount }));
    if (r.category?.created) parts.push(t("add_cat_created", { label: r.category.label }));
    if (b.twitch && b.twitch !== "ok") parts.push(b.twitch === "rate" ? t("add_twitch_rate") : t("add_twitch_later"));
    return back(parts.join(" "));
  },

  async bulkCancel(ctx) { await quick.clearBatch(ctx); return back(undefined); },

  /** La recherche dans la liste. */
  async listSearch(ctx, values) {
    const q = oneLine(values.lq, 100);
    return { ok: undefined, redirect: q ? `?lq=${enc(q)}` : "?" };
  },

  /** « Retirer » : la fiche sort de la liste de raid ; elle reste dans Contacts avec tout ce qu'elle contient. */
  async remove(ctx, values) {
    const id = oneLine(values.id, 80);
    const r = await quick.removeFromList(ctx, id);
    forget();
    if (!r.ok) return { error: problemLine(ctx, r.problem) };
    return { ok: r.removed ? ctx.t("mylist_removed", { label: r.category }) : ctx.t("mylist_already_gone") };
  },
};
