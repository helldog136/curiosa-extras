// Contacts — l'administration (mobile d'abord, FR + EN, mots simples) : liste de cartes avec recherche et filtres, fiche (comptes, photo,
// catégories, notes), catégories (créer, renommer, « Mettre dans… », supprimer sans effacer de fiche), organisations.
// Toutes les modifications passent par des `adminActions` (formulaires `adminForm` et boutons de ligne) ; la recherche et la pagination sont de
// simples liens (formulaire GET, « Voir la suite »). Droits du module : « email.view » (voir e-mails et téléphones), « categories.create ».
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const B = await import(`./book.mjs${v}`);
const N = await import(`./networks.mjs${v}`);
const U = await import(`./ui.mjs${v}`);

const PAGE = 30;
const COLORS = [["amber", "#e8a23b"], ["blue", "#4f9dde"], ["green", "#58b368"], ["rose", "#d1556b"], ["purple", "#9b6bd1"], ["teal", "#3bb3a8"], ["brown", "#c9853a"], ["grey", "#7a8794"]];
const fmt = (ctx, n) => new Intl.NumberFormat(ctx.locale || "en").format(n);
const plural = (ctx, n, base, vars = {}) => ctx.t(`${base}${(String(ctx.locale).startsWith("fr") ? n <= 1 : n === 1) ? "One" : "Many"}`, { count: fmt(ctx, n), ...vars });
const netName = (ctx) => (n) => ctx.t(`net_${n}`);
const sourceLabel = (ctx, s) => { const k = `source_${s}`; const t = ctx.t(k); return t === k ? ctx.t("sourceOther", { source: s }) : t; };
const html = (inner) => ({ type: "html", html: `<div class="ct">${inner}</div>` });
const first = (inner) => ({ type: "html", html: `${U.STYLE}<div class="ct">${inner}</div>` });
const isOn = (x) => ["on", "1", "true"].includes(String(x ?? ""));
const okImage = (u) => B.httpsUrl(u) || /^\/[A-Za-z0-9._~/%-]+(#[\w=.,:-]*)?$/.test(u);

function nav(ctx, current) {
  return U.tabs([
    { label: ctx.t("tabContacts"), href: "?", current: current === "contacts" },
    { label: ctx.t("tabOrgs"), href: "?kind=org", current: current === "orgs" },
    { label: ctx.t("tabCategories"), href: "?view=categories", current: current === "categories" },
  ], ctx.t("tabsLabel"));
}
/** Phrase « Photo YouTube (12 400 abonnés) » / « Photo choisie à la main ». */
function photoOrigin(ctx, c) {
  const p = c.photo;
  if (!p) return ctx.t("photoNone");
  if (p.source === "manual") return ctx.t("photoManual");
  const acc = c.accounts.find((a) => a.id === p.accountId);
  const network = ctx.t(`net_${p.source}`);
  return Number.isInteger(acc?.followers) ? ctx.t("photoFromFollowers", { network, followers: fmt(ctx, acc.followers) }) : ctx.t("photoFrom", { network });
}

// ── Liste (contacts ou organisations) ──────────────────────────────────────────────────────────────────────────────────────────────────────
async function listPage(ctx, q) {
  const t = ctx.t;
  const idx = await B.getIndex(ctx);
  const kind = q.kind === "org" ? "org" : undefined;
  const catParam = q.cat || q.category; // « ?category=<id> » : lien venu d'un autre module (Raid : « voir les fiches de la catégorie »)
  const cat = catParam ? B.liveCategory(idx, catParam) : null;
  const network = N.NETWORKS.includes(q.net) ? q.net : undefined;
  const review = q.review === "1";
  const orgId = q.org && idx.byId.get(q.org)?.k & 1 ? q.org : undefined;
  const text = B.searchKey(q.q);
  const base = { kind, cat: cat ?? undefined, net: network, review: review ? "1" : undefined, org: orgId, q: text ? String(q.q).slice(0, 100) : undefined };
  const filter = { kind, cat, network, review, orgId };
  let ids, total, more = null;
  if (text) {
    const offset = Math.max(0, Math.min(1_000_000, Math.trunc(Number(q.at)) || 0));
    const r = B.searchIds(idx, { q: text, limit: PAGE, offset, ...filter });
    ids = r.ids; total = r.total;
    if (offset + PAGE < total) more = U.href({ ...base, at: offset + PAGE });
  } else {
    const r = B.indexPage(idx, { cursor: q.after, limit: PAGE, tag: "admin", reverse: true, ...filter });
    ids = r.ids;
    const ok = B.matcher(idx, filter);
    total = 0; for (const e of idx.list) if (ok(e)) total++;
    if (r.next) more = U.href({ ...base, after: r.next });
  }
  const recs = await B.readMany(ctx, ids);
  const cards = ids.filter((id) => recs.has(id)).map((id) => B.card(ctx, idx, recs.get(id)));
  // Filtres : « à vérifier », catégories, réseaux présents dans le carnet.
  let toReview = 0;
  const nets = new Set();
  for (const e of idx.list) { if (e.k & 2) toReview++; if (e.a) for (const k of e.a.split("\u0001")) nets.add(k.slice(0, k.indexOf(":"))); }
  const toggle = (k, val, current) => U.href({ ...base, [k]: current ? undefined : val, after: undefined, at: undefined });
  const chipItems = [];
  if (toReview || review) chipItems.push({ label: t("filterReview", { count: fmt(ctx, toReview) }), href: toggle("review", "1", review), current: review });
  const cats = B.liveCategories(idx).sort((a, b) => N.fold(a.name).localeCompare(N.fold(b.name))).slice(0, 40);
  for (const k of cats) chipItems.push({ label: k.name, color: B.categoryView(k).color, href: toggle("cat", k.id, cat === k.id), current: cat === k.id });
  for (const n of N.NETWORKS.filter((x) => nets.has(x))) chipItems.push({ label: t(`net_${n}`), network: n, href: toggle("net", n, network === n), current: network === n });
  const filtered = !!(cat || network || review || orgId || text);
  const parts = [
    nav(ctx, kind === "org" ? "orgs" : "contacts"),
    `<p class="ct-help">${U.esc(t("private"))}</p>`,
    U.searchBar({ q: base.q ?? "", hidden: { kind, cat: base.cat, net: network, review: base.review, org: orgId }, label: t("searchLabel"), placeholder: t("searchPlaceholder"), button: t("searchButton") }),
    U.chips(chipItems, t("filtersLabel")),
    `<div class="ct-actions"><a class="ct-btn" href="?new=${kind === "org" ? "org" : "person"}">${U.esc(t(kind === "org" ? "addOrg" : "addPerson"))}</a>${filtered ? `<a class="ct-btn ct-ghost" href="${kind === "org" ? "?kind=org" : "?"}">${U.esc(t("filterAll"))}</a>` : ""}</div>`,
    `<p class="ct-count" role="status">${U.esc(text ? plural(ctx, total, "results") : plural(ctx, total, "count"))}</p>`,
    cards.length ? U.cardList(cards, { t, netName: netName(ctx), linkOf: (c) => `?contact=${encodeURIComponent(c.id)}` }) : `<p class="ct-empty">${U.esc(t(idx.list.length ? "emptySearch" : "emptyBook"))}</p>`,
    more || q.after || q.at ? `<p class="ct-more">${more ? `<a class="ct-btn" href="${U.esc(more)}">${U.esc(t("seeMore"))}</a>` : ""}${q.after || q.at ? `<a class="ct-btn ct-ghost" href="${U.esc(U.href({ ...base }))}">${U.esc(t("backToStart"))}</a>` : ""}</p>` : "",
  ];
  return [first(parts.join(""))];
}

// ── Fiche ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function contactPage(ctx, id) {
  const t = ctx.t;
  const r = await B.get(ctx, { id });
  if (!r.ok) {
    return [first(`${nav(ctx, "contacts")}<a class="ct-back" href="?">${U.esc(t("back"))}</a>`), { type: "banner", tone: "warning", text: t(r.movedTo ? "movedTo" : "notFound") },
      ...(r.movedTo ? [html(`<p><a class="ct-btn" href="?contact=${encodeURIComponent(r.movedTo)}">${U.esc(t("openMoved"))}</a></p>`)] : [])];
  }
  const c = r.contact, idx = r.index, d = r.record.data;
  const org = c.kind === "org";
  const canMail = B.can(ctx, B.RIGHT_EMAIL_VIEW);
  const nn = netName(ctx);
  const catChips = c.categoryIds.map((k) => idx.cats.get(k)).filter(Boolean).map((k) => `<span class="ct-cat"><span class="ct-dot" style="--c:${U.esc(B.categoryView(k).color)}" aria-hidden="true"></span>${U.esc(k.name)}</span>`).join(" ");
  const sub = org ? t("kindOrg") : c.orgName ? (c.role ? t("worksAt", { role: c.role, org: c.orgName }) : t("memberOf", { org: c.orgName })) : c.role ?? "";
  const subHtml = !org && c.orgId ? U.esc(sub).replace(U.esc(c.orgName), `<a href="?contact=${encodeURIComponent(c.orgId)}">${U.esc(c.orgName)}</a>`) : U.esc(sub);
  const date = new Date(c.createdAt).toLocaleDateString(ctx.locale || "en", { day: "numeric", month: "long", year: "numeric" });
  const head = `<a class="ct-back" href="${org ? "?kind=org" : "?"}">${U.esc(t(org ? "backOrgs" : "back"))}</a>
<section class="ct-head" aria-labelledby="ct-name">${U.photo(c, true)}<div class="ct-main"><h2 id="ct-name">${U.esc(c.name)}</h2>${sub ? `<span class="ct-sub">${subHtml}</span>` : ""}
${c.status === "to_review" ? `<span><span class="ct-badge">${U.esc(t("statusBadge"))}</span></span>` : ""}
${c.accounts.length ? `<span class="ct-nets">${[...new Map(c.accounts.map((a) => [a.network, a])).values()].map((a) => U.netPill(a.network, `${nn(a.network)} : ${a.handle}`, a.url)).join("")}</span>` : ""}
${catChips ? `<span>${catChips}</span>` : ""}<span class="ct-sub">${U.esc(photoOrigin(ctx, c))}</span><span class="ct-sub">${U.esc(t("sourceLine", { date, source: sourceLabel(ctx, c.source) }))}</span></div></section>
<div class="ct-actions"><a class="ct-btn" href="?contact=${encodeURIComponent(c.id)}&amp;edit=1">${U.esc(t("edit"))}</a></div>`;
  const blocks = [first(nav(ctx, org ? "orgs" : "contacts") + head)];
  if (c.status === "to_review") {
    blocks.push({ type: "banner", tone: "warning", text: t("reviewBanner") });
    blocks.push({ type: "adminForm", action: "verify", submitLabel: t("verify"), fields: [{ name: "id", kind: "hidden", value: c.id }] });
  }
  // Coordonnées (droit « voir les e-mails et téléphones »), relation.
  const info = [];
  if (canMail) info.push(c.email || c.phone ? [c.email && `**${t("email")}** : ${c.email}`, c.phone && `**${t("phone")}** : ${c.phone}`].filter(Boolean).join("\n\n") : `*${t("noContactInfo")}*`);
  else if (c.email || c.phone) info.push(`*${t("hiddenContact")}*`);
  if (c.relation) info.push(`**${t("relation")}** : ${c.relation}`);
  if (info.length) blocks.push({ type: "heading", text: t("contactInfo") }, { type: "markdown", text: info.join("\n\n").replace(/[<>]/g, "") });
  // Comptes.
  blocks.push({ type: "heading", text: t("sectionAccounts") });
  if (c.accounts.length) {
    blocks.push({
      type: "table", columns: [t("colAccount")],
      rows: c.accounts.map((a) => [[nn(a.network), a.handle, a.displayName && N.fold(a.displayName) !== N.fold(a.handle) ? a.displayName : null, Number.isInteger(a.followers) ? plural(ctx, a.followers, "followers") : null].filter(Boolean).join(" · ")]),
      rowIds: c.accounts.map((a) => `${c.id}|${a.id}`),
      rowActions: [{ label: t("accountRemove"), action: "removeAccount", confirm: t("confirmAccountRemove"), danger: true }],
    });
  } else blocks.push({ type: "markdown", text: t("noAccounts") });
  if (c.accounts.some((a) => a.network === "twitch")) blocks.push({ type: "suggestInstall", service: "twitch.api", min: 3, reason: t("suggestTwitch") });
  if (c.accounts.some((a) => a.network === "youtube")) blocks.push({ type: "suggestInstall", service: "youtube.api", reason: t("suggestYoutube") });
  blocks.push({
    type: "adminForm", action: "addAccount", title: t("addAccountTitle"), submitLabel: t("addAccountButton"),
    fields: [
      { name: "id", kind: "hidden", value: c.id },
      { name: "network", label: t("fieldNetwork"), kind: "select", value: "twitch", options: N.NETWORKS.map((n) => ({ value: n, label: nn(n) })) },
      { name: "handle", label: t("fieldHandle"), required: true, help: t("helpHandle") },
    ],
  });
  // Texte libre d'avant les comptes structurés : en lecture, avec « Ajouter comme compte ».
  if (d.others) {
    const mine = new Set(c.accounts.map((a) => N.accountKey(a.network, a.handle)));
    const found = N.accountsInText(d.others).filter((n) => !mine.has(N.accountKey(n.network, n.handle)));
    blocks.push({ type: "heading", text: t("othersTitle") }, html(`<p class="ct-help">${U.esc(t("othersHelp"))}</p><div class="ct-pre">${U.esc(d.others)}</div>`));
    if (found.length) blocks.push({ type: "table", columns: [t("othersFound")], rows: found.map((n) => [`${nn(n.network)} · ${n.handle}`]), rowIds: found.map((n) => `${c.id}|${n.network}|${n.handle}`), rowActions: [{ label: t("addAsAccount"), action: "addFromText" }] });
  }
  // Organisation : ses personnes (50 premières ; la liste complète par le filtre).
  if (org) {
    const members = B.indexPage(idx, { limit: 50, orgId: c.id, kind: "person" });
    const recs = await B.readMany(ctx, members.ids);
    const cards = members.ids.filter((x) => recs.has(x)).map((x) => B.card(ctx, idx, recs.get(x)));
    blocks.push({ type: "heading", text: t("members") });
    blocks.push(html(cards.length ? `${U.cardList(cards, { t, netName: nn, linkOf: (m) => `?contact=${encodeURIComponent(m.id)}` })}${members.next ? `<p class="ct-more"><a class="ct-btn" href="?org=${encodeURIComponent(c.id)}">${U.esc(t("seeMore"))}</a></p>` : ""}` : `<p class="ct-empty">${U.esc(t("noMembers"))}</p>`));
  }
  // Photo.
  blocks.push({ type: "heading", text: t("photoTitle") }, { type: "markdown", text: `**${photoOrigin(ctx, c)}**\n\n${t("photoHelp")}` });
  blocks.push({ type: "adminForm", action: "photo", submitLabel: t("photoSave"), fields: [{ name: "id", kind: "hidden", value: c.id }, { name: "photo", label: t("photoField"), kind: "image", value: d.photo ?? "" }] });
  if (d.photo) blocks.push({ type: "adminForm", action: "photoAuto", submitLabel: t("photoAuto"), fields: [{ name: "id", kind: "hidden", value: c.id }] });
  // Notes.
  blocks.push({ type: "heading", text: t("notes") });
  if (r.notes.length) blocks.push({ type: "table", columns: [t("notes")], rows: r.notes.map((n) => [`${n.date} · ${n.author}\n${n.text}`]), rowIds: r.notes.map((n) => n.id), rowActions: [{ label: t("noteDelete"), action: "removeNote", confirm: t("confirmDeleteNote"), danger: true }] });
  else blocks.push({ type: "markdown", text: t("noNotes") });
  blocks.push({ type: "adminForm", action: "note", title: t("noteAdd"), submitLabel: t("noteAdd"), fields: [{ name: "contactId", kind: "hidden", value: c.id }, { name: "text", label: t("noteText"), kind: "textarea", required: true }] });
  // Suppression (confirmation).
  blocks.push({ type: "heading", text: t("deleteTitle") }, { type: "markdown", text: t("deleteHelp") });
  blocks.push({ type: "table", columns: [t("name")], rows: [[c.name]], rowIds: [c.id], rowActions: [{ label: t("deleteButton"), action: "remove", confirm: t("confirmDeleteContact"), danger: true }] });
  return blocks;
}

// ── Création / modification d'une fiche ────────────────────────────────────────────────────────────────────────────────────────────────────
async function editPage(ctx, id, kindWanted) {
  const t = ctx.t;
  const idx = await B.getIndex(ctx);
  let c = null, d = null;
  if (id) {
    const r = await B.get(ctx, { id });
    if (!r.ok) return [first(`${nav(ctx, "contacts")}<a class="ct-back" href="?">${U.esc(t("back"))}</a>`), { type: "banner", tone: "warning", text: t("notFound") }];
    c = r.contact; d = r.record.data;
  }
  const kind = c ? c.kind : kindWanted === "org" ? "org" : "person";
  const canMail = B.can(ctx, B.RIGHT_EMAIL_VIEW);
  const cats = B.liveCategories(idx).sort((a, b) => N.fold(a.name).localeCompare(N.fold(b.name)));
  const fields = [
    { name: "id", kind: "hidden", value: c?.id ?? "" },
    { name: "kind", kind: "hidden", value: kind },
    { name: "name", label: t(kind === "org" ? "nameOrg" : "name"), required: true, value: c?.name ?? "" },
    ...(kind === "person" ? [
      { name: "role", label: t("role"), value: c?.role ?? "", help: t("helpRole") },
      { name: "organisation", label: t("organisation"), value: c?.orgName ?? "", help: t("helpOrganisation") },
    ] : []),
    ...(canMail ? [{ name: "email", label: t("email"), kind: "email", value: c?.email ?? "" }, { name: "phone", label: t("phone"), value: c?.phone ?? "" }] : []),
    { name: "relation", label: t("relation"), value: d?.relation ?? "", help: t("helpRelation") },
    { name: "status", label: t("status"), kind: "select", options: B.STATUSES.map((s) => ({ value: s, label: t(`status_${s}`) })), value: c?.status ?? "active" },
    { name: "cats", kind: "hidden", value: "1" },
    ...cats.map((k) => ({ name: `cat_${k.id}`, label: t("categoriesField", { name: k.name }), kind: "checkbox", value: c?.categoryIds.includes(k.id) ? "on" : "" })),
    ...(B.can(ctx, B.RIGHT_CREATE_CATEGORY) ? [{ name: "newCategory", label: t("newCategory"), help: t("helpNewCategory") }] : []),
  ];
  const back = c ? `?contact=${encodeURIComponent(c.id)}` : kind === "org" ? "?kind=org" : "?";
  return [
    first(`${nav(ctx, kind === "org" ? "orgs" : "contacts")}<a class="ct-back" href="${U.esc(back)}">${U.esc(t(kind === "org" ? "backOrgs" : "back"))}</a>`),
    { type: "adminForm", action: "save", title: c ? t("editTitle", { name: c.name }) : t(kind === "org" ? "newOrgTitle" : "newPersonTitle"), submitLabel: t("save"), cancelHref: back, fields },
  ];
}

// ── Catégories ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function categoriesPage(ctx, q) {
  const t = ctx.t;
  const idx = await B.getIndex(ctx);
  const cats = B.liveCategories(idx).sort((a, b) => N.fold(a.name).localeCompare(N.fold(b.name)));
  const counts = new Map();
  for (const e of idx.list) for (const k of new Set((e.c ?? []).map((x) => B.liveCategory(idx, x)).filter(Boolean))) counts.set(k, (counts.get(k) ?? 0) + 1);
  const target = q.edit && idx.cats.get(q.edit);
  // Une catégorie : renommer, « Mettre dans… », supprimer (une page par catégorie : rien de trop large sur un téléphone).
  if (target && !target.movedTo) {
    const others = cats.filter((k) => k.id !== target.id);
    const n = counts.get(target.id) ?? 0;
    const blocks = [first(`${nav(ctx, "categories")}<a class="ct-back" href="?view=categories">${U.esc(t("backCategories"))}</a>
<p class="ct-head"><span class="ct-cat"><span class="ct-dot" style="--c:${U.esc(B.categoryView(target).color)}" aria-hidden="true"></span>${U.esc(target.name)}</span> <a class="ct-btn ct-ghost" href="?cat=${encodeURIComponent(target.id)}">${U.esc(plural(ctx, n, "catSeeCount"))}</a></p>`)];
    blocks.push({ type: "adminForm", action: "renameCategory", title: t("catRenameTitle", { name: target.name }), submitLabel: t("catRename"), fields: [{ name: "id", kind: "hidden", value: target.id }, { name: "label", label: t("catLabel"), required: true, value: target.name }] });
    blocks.push({ type: "heading", text: t("catMergeTitle", { name: target.name }) }, { type: "markdown", text: t("catMergeHelp", { name: target.name }) });
    blocks.push(others.length
      ? { type: "adminForm", action: "mergeCategory", submitLabel: t("catMergeButton"), fields: [{ name: "drop", kind: "hidden", value: target.id }, { name: "keep", label: t("catMergeTarget"), kind: "select", options: others.map((k) => ({ value: k.id, label: k.name })), value: others[0].id }] }
      : { type: "banner", tone: "info", text: t("catMergeNone") });
    blocks.push({ type: "heading", text: t("catDeleteTitle") }, { type: "markdown", text: t("catDeleteHelp") });
    blocks.push({ type: "table", columns: [t("colCategory")], rows: [[target.name]], rowIds: [target.id], rowActions: [{ label: t("catDelete"), action: "deleteCategory", confirm: t("confirmCatDelete"), danger: true }] });
    return blocks;
  }
  const items = cats.map((k) => `<li><a class="ct-card" href="?view=categories&amp;edit=${encodeURIComponent(k.id)}"><span class="ct-dot" style="--c:${U.esc(B.categoryView(k).color)}" aria-hidden="true"></span><span class="ct-main"><span class="ct-name">${U.esc(k.name)}</span><span class="ct-sub">${U.esc(plural(ctx, counts.get(k.id) ?? 0, "count"))}</span></span><span class="ct-sub" aria-hidden="true">›</span></a></li>`).join("");
  const blocks = [first(`${nav(ctx, "categories")}<p class="ct-help">${U.esc(t("categoriesHelp"))}</p>${cats.length ? `<ul class="ct-cards" aria-label="${U.esc(t("categoriesTitle"))}">${items}</ul>` : `<p class="ct-empty">${U.esc(t("catNone"))}</p>`}`)];
  if (B.can(ctx, B.RIGHT_CREATE_CATEGORY)) {
    blocks.push({ type: "adminForm", action: "createCategory", title: t("catCreateTitle"), submitLabel: t("catCreate"), fields: [{ name: "label", label: t("catLabel"), required: true }, { name: "color", label: t("catColor"), kind: "select", value: COLORS[cats.length % COLORS.length][1], options: COLORS.map(([n, hex]) => ({ value: hex, label: t(`color_${n}`) })) }] });
  }
  return blocks;
}

async function panel(ctx, q) {
  if (q.view === "categories") return categoriesPage(ctx, q);
  if (q.new) return editPage(ctx, null, q.new);
  if (q.contact) return q.edit ? editPage(ctx, q.contact) : contactPage(ctx, q.contact);
  return listPage(ctx, q);
}

// ── Actions ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const guard = (fn) => async (ctx, values) => {
  try { return await fn(ctx, values ?? {}); } catch (e) { if (e?.code === "busy") return { error: ctx.t("busy") }; throw e; }
};
const back = (id) => `?contact=${encodeURIComponent(id)}`;

/** Ajout d'un compte : erreurs actionnables sous le champ (« Ce lien est un lien YouTube : choisissez… »). */
async function addAccountFlow(ctx, id, network, handle) {
  const t = ctx.t;
  if (!N.clean(handle, 300)) return { errors: { handle: t("errEmptyHandle") } };
  if (!N.NETWORKS.includes(network)) return { errors: { network: t("errHandle_other") } };
  const detected = N.detectNetwork(handle);
  if (network === "web" && detected && detected !== "web") return { errors: { handle: t("errWrongNetwork", { network: t(`net_${detected}`) }) } };
  const r = await B.addAccount(ctx, { id, network, handle });
  if (r.ok) return { ok: t(r.existed ? "accountExisted" : "accountAdded"), redirect: back(id) };
  if (r.error === "invalid_handle") {
    if (detected && detected !== network && detected !== "web") return { errors: { handle: t("errWrongNetwork", { network: t(`net_${detected}`) }) } };
    return { errors: { handle: t(`errHandle_${network}`) } };
  }
  if (r.error === "taken") { const other = await B.readContact(ctx, r.id); return { errors: { handle: t("errTaken", { name: other?.data.name ?? "?" }) } }; }
  if (r.error === "too_many_accounts") return { errors: { handle: t("errTooManyAccounts") } };
  return { error: t("notFound") };
}

export default {
  // Pastille du menu d'admin : les fiches « à vérifier » (messages du formulaire). Jamais d'attente longue : 0 si l'index n'est pas prêt.
  async adminBadge(ctx) {
    // Drapeau 2 de l'index = statut « to_review ».
    try { const idx = await B.getIndex(ctx, { waitMs: 2000 }); let n = 0; for (const e of idx.list) if (e.k & 2) n++; return n; } catch { return 0; }
  },

  async adminPanel(ctx, { query } = {}) {
    try { return await panel(ctx, query ?? {}); } catch (e) { if (e?.code === "busy") return [{ type: "banner", tone: "warning", text: ctx.t("busy") }]; throw e; }
  },

  adminActions: {
    save: guard(async (ctx, v) => {
      const t = ctx.t;
      const categoryIds = Object.keys(v).filter((k) => k.startsWith("cat_") && isOn(v[k])).map((k) => k.slice(4));
      const extra = N.clean(v.newCategory, 100);
      if (extra) {
        if (!B.can(ctx, B.RIGHT_CREATE_CATEGORY)) return { errors: { newCategory: t("catDenied") } };
        const k = await B.createCategory(ctx, { label: extra }, { allowed: true });
        if (k.ok || k.error === "duplicate") categoryIds.push(k.id);
        else return { errors: { newCategory: t(k.error === "too_many" ? "catTooMany" : "catInvalid") } };
      }
      const values = { id: v.id || undefined, kind: v.kind, name: v.name, role: v.role, organisation: v.organisation, relation: v.relation, status: v.status, email: v.email, phone: v.phone, ...(v.cats ? { categoryIds } : {}) };
      const r = await B.saveCard(ctx, values, { withContact: B.can(ctx, B.RIGHT_EMAIL_VIEW) });
      if (r.ok) return { ok: t("saved"), redirect: back(r.id) };
      const msg = { name_required: "nameRequired", invalid_email: "emailInvalid", email_taken: "emailTaken", too_many: "bookFull", not_found: "notFound" }[r.error] ?? "notFound";
      return r.field ? { errors: { [r.field]: t(msg) } } : { error: t(msg) };
    }),
    verify: guard(async (ctx, v) => {
      const r = await B.update(ctx, { id: v.id, status: "active" }, { allowStatus: true });
      return r.ok ? { ok: ctx.t("verified"), redirect: back(v.id) } : { error: ctx.t("notFound") };
    }),
    addAccount: guard((ctx, v) => addAccountFlow(ctx, v.id, v.network, v.handle)),
    addFromText: guard(async (ctx, v) => {
      const [id, network, ...rest] = String(v.id ?? "").split("|");
      const r = await addAccountFlow(ctx, id, network, rest.join("|"));
      return r.errors ? { error: Object.values(r.errors)[0] } : r;
    }),
    removeAccount: guard(async (ctx, v) => {
      const [id, accountId] = String(v.id ?? "").split("|");
      const r = await B.removeAccount(ctx, id, accountId);
      return r.ok ? { ok: ctx.t("accountRemoved"), redirect: back(id) } : { error: ctx.t("notFound") };
    }),
    photo: guard(async (ctx, v) => {
      const url = String(v.photo ?? "").trim();
      if (url && !okImage(url)) return { errors: { photo: ctx.t("photoInvalid") } };
      const r = await B.setManualPhoto(ctx, v.id, url || null, { allowLocal: true });
      return r.ok ? { ok: ctx.t("photoSaved"), redirect: back(v.id) } : r.error === "invalid" ? { errors: { photo: ctx.t("photoInvalid") } } : { error: ctx.t("notFound") };
    }),
    photoAuto: guard(async (ctx, v) => {
      const r = await B.setManualPhoto(ctx, v.id, null);
      return r.ok ? { ok: ctx.t("photoSaved"), redirect: back(v.id) } : { error: ctx.t("notFound") };
    }),
    note: guard(async (ctx, v) => {
      const r = await B.note(ctx, { id: v.contactId, text: v.text, author: "admin" });
      if (r.ok) return { ok: ctx.t("noteSaved"), redirect: back(v.contactId) };
      return r.error === "text_required" ? { errors: { text: ctx.t("textRequired") } } : { error: ctx.t("notFound") };
    }),
    removeNote: guard(async (ctx, v) => {
      const r = await B.removeNote(ctx, v.id);
      return r.ok ? { ok: ctx.t("noteDeleted") } : { error: ctx.t("notFound") };
    }),
    remove: guard(async (ctx, v) => {
      const r = await B.erase(ctx, { id: v.id, confirm: true });
      if (!r.ok) return { error: ctx.t("notFound") };
      const silent = r.modules.filter((m) => !m.ok).map((m) => m.name);
      return { ok: silent.length ? ctx.t("deletedSilent", { modules: silent.join(", ") }) : ctx.t("deleted"), redirect: "?" };
    }),
    createCategory: {
      right: "categories.create",
      run: guard(async (ctx, v) => {
        const r = await B.createCategory(ctx, { label: v.label, color: v.color }, { allowed: true });
        if (r.ok) return { ok: ctx.t("catCreated"), redirect: "?view=categories" };
        return { errors: { label: ctx.t({ duplicate: "catDuplicate", too_many: "catTooMany" }[r.error] ?? "catInvalid") } };
      }),
    },
    renameCategory: guard(async (ctx, v) => {
      const r = await B.renameCategory(ctx, v.id, v.label);
      if (r.ok) return { ok: ctx.t("catRenamed"), redirect: `?view=categories&edit=${encodeURIComponent(v.id)}` };
      if (r.error === "not_found") return { error: ctx.t("catNotFound") };
      return { errors: { label: ctx.t(r.error === "duplicate" ? "catDuplicate" : "catInvalid") } };
    }),
    mergeCategory: guard(async (ctx, v) => {
      const r = await B.mergeCategories(ctx, v.keep, v.drop);
      return r.ok ? { ok: ctx.t("catMerged"), redirect: "?view=categories" } : { error: ctx.t("catNotFound") };
    }),
    deleteCategory: guard(async (ctx, v) => {
      const r = await B.deleteCategory(ctx, v.id);
      return r.ok ? { ok: ctx.t("catDeleted"), redirect: "?view=categories" } : { error: ctx.t("catNotFound") };
    }),
  },
};
