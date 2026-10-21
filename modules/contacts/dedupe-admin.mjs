// Contacts — l'écran « Doublons » : la liste des fiches qui se ressemblent (par pages de 20), la comparaison de deux fiches, l'aperçu de la réunion, puis la
// réunion elle-même (`merge` du contrat : comptes, catégories, notes passent sur la fiche gardée, les autres modules sont prévenus par `remap`).
// Rien n'est réuni avant le dernier clic « Valider » : tant que la personne n'a pas validé, « Annuler » (ou simplement quitter la page) ne change rien.
const v = new URL(import.meta.url).search;
const B = await import(`./book.mjs${v}`);
const DD = await import(`./dedupe.mjs${v}`);
const D = await import(`./data.mjs${v}`);
const U = await import(`./ui.mjs${v}`);
const N = await import(`./networks.mjs${v}`);
const { nav } = await import(`./nav.mjs${v}`);

const fmt = (ctx, n) => new Intl.NumberFormat(ctx.locale || "en").format(n);
const plural = (ctx, n, base) => ctx.t(`${base}${(String(ctx.locale).startsWith("fr") ? n <= 1 : n === 1) ? "One" : "Many"}`, { count: fmt(ctx, n) });
const link = (a, b) => `?view=merge&a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`;
const FIELD_WORDS = { email: "mgField_email", phone: "mgField_phone", role: "mgField_role", others: "mgField_others", relation: "mgField_relation", photo: "mgField_photo" };

const reasonText = (ctx, reasons) => reasons.map((r) => ctx.t(`dupReason_${r}`)).join(" · ");

export async function listPage(ctx, q) {
  const t = ctx.t;
  const p = await DD.page(ctx, q.at);
  const idx = p.idx;
  const recs = await B.readMany(ctx, [...new Set(p.items.flatMap((g) => g.ids.slice(0, 3)))]);
  const items = p.items.map((g) => {
    const cards = g.ids.slice(0, 3).filter((id) => recs.has(id)).map((id) => B.card(ctx, idx, recs.get(id)));
    if (cards.length < 2) return "";
    const more = g.size > 2 ? `<span class="ct-sub">${U.esc(t("dupMore", { count: fmt(ctx, g.size - 2) }))}</span>` : "";
    return `<li><a class="ct-card" href="${U.esc(link(cards[0].id, cards[1].id))}">${U.photo(cards[0])}<span class="ct-main"><span class="ct-name">${U.esc(cards.slice(0, 2).map((c) => c.name).join(" · "))}</span><span class="ct-sub">${U.esc(reasonText(ctx, g.reasons))}</span>${more}</span><span class="ct-sub" aria-hidden="true">›</span></a></li>`;
  }).join("");
  const nextLink = p.next ? `<p class="ct-more"><a class="ct-btn" href="${U.esc(U.href({ view: "dupes", at: p.next }))}">${U.esc(t("seeMore"))}</a>${q.at ? `<a class="ct-btn ct-ghost" href="?view=dupes">${U.esc(t("backToStart"))}</a>` : ""}</p>` : q.at ? `<p class="ct-more"><a class="ct-btn ct-ghost" href="?view=dupes">${U.esc(t("backToStart"))}</a></p>` : "";
  const body = p.total
    ? `<p class="ct-count" role="status">${U.esc(plural(ctx, p.total, "dupCount"))}</p>${p.truncated ? `<p class="ct-help">${U.esc(t("dupTruncated"))}</p>` : ""}<ul class="ct-cards">${items}</ul>${nextLink}`
    : `<p class="ct-empty">${U.esc(t("dupNone"))}</p>`;
  return [U.firstBlock(`${nav(ctx, "dupes")}<h2 class="ct-name">${U.esc(t("dupTitle"))}</h2><p class="ct-help">${U.esc(t("dupIntro"))}</p>${body}`)];
}

function summary(ctx, idx, rec, canMail, notesLabel) {
  const t = ctx.t;
  const c = B.card(ctx, idx, rec);
  const nn = (n) => t(`net_${n}`);
  const rows = [];
  const kv = (label, value) => { if (value) rows.push(`<dt>${U.esc(label)}</dt><dd>${value}</dd>`); };
  kv(t("mgKind"), U.esc(t(c.kind === "org" ? "kindOrg" : "kindPerson")));
  kv(t("role"), U.esc(c.role ?? ""));
  kv(t("organisation"), U.esc(c.orgName ?? ""));
  if (canMail) { kv(t("email"), U.esc(c.email ?? "")); kv(t("phone"), U.esc(c.phone ?? "")); }
  kv(t("sectionAccounts"), c.accounts.length ? `<ul class="ct-list">${c.accounts.map((a) => `<li>${U.esc(nn(a.network))} · ${U.esc(a.handle)}</li>`).join("")}</ul>` : "");
  kv(t("categoriesOf"), c.categoryIds.map((k) => idx.cats.get(k)?.name).filter(Boolean).map(U.esc).join(", "));
  kv(t("notes"), U.esc(notesLabel));
  kv(t("mgCreated"), U.esc(new Date(c.createdAt).toLocaleDateString(ctx.locale || "en", { day: "numeric", month: "long", year: "numeric" })));
  return `<div class="ct-box"><h3>${U.photo(c)} ${U.esc(c.name)}</h3><dl class="ct-kv">${rows.join("")}</dl></div>`;
}

async function notesLabel(ctx, id) {
  const list = await D.latestNotes(ctx, id, 51);
  return list.length ? (list.length > 50 ? plural(ctx, 50, "mgNotesPlus") : plural(ctx, list.length, "mgNotes")) : "";
}

export async function comparePage(ctx, q) {
  const t = ctx.t;
  const idx = await B.getIndex(ctx);
  const [a, b] = [await B.readContact(ctx, q.a), await B.readContact(ctx, q.b)];
  const back = `<a class="ct-back" href="?view=dupes">${U.esc(t("dupBack"))}</a>`;
  if (!a || !b || q.a === q.b) return [U.firstBlock(`${nav(ctx, "dupes")}${back}`), { type: "banner", tone: "warning", text: t("mgGone") }];
  const canMail = B.can(ctx, B.RIGHT_EMAIL_VIEW);
  const boxes = `<div class="ct-cmp">${summary(ctx, idx, a, canMail, await notesLabel(ctx, a.id))}${summary(ctx, idx, b, canMail, await notesLabel(ctx, b.id))}</div>`;
  const blocks = [U.firstBlock(`${nav(ctx, "dupes")}${back}<h2 class="ct-name">${U.esc(t("mgCompareTitle"))}</h2><p class="ct-help">${U.esc(t("mgCompareHelp"))}</p>${boxes}<h3>${U.esc(t("mgWhich"))}</h3>`)];
  if (D_kind(a) !== D_kind(b)) { blocks.push({ type: "banner", tone: "warning", text: t("mgKindMismatch") }); }
  else {
    blocks.push({ type: "adminForm", action: "mergePick", submitLabel: t("mgKeep", { name: a.data.name }), fields: [{ name: "keep", kind: "hidden", value: a.id }, { name: "drop", kind: "hidden", value: b.id }] });
    blocks.push({ type: "adminForm", action: "mergePick", submitLabel: t("mgKeep", { name: b.data.name }), fields: [{ name: "keep", kind: "hidden", value: b.id }, { name: "drop", kind: "hidden", value: a.id }] });
  }
  blocks.push({ type: "adminForm", action: "dupIgnore", submitLabel: t("mgNotDup"), fields: [{ name: "a", kind: "hidden", value: a.id }, { name: "b", kind: "hidden", value: b.id }] });
  return blocks;
}
const D_kind = (rec) => (rec.data.kind === "org" ? "org" : "person");

export async function confirmPage(ctx, q) {
  const t = ctx.t;
  const back = `<a class="ct-back" href="?view=dupes">${U.esc(t("dupBack"))}</a>`;
  const p = await DD.preview(ctx, q.keep, q.drop);
  if (!p.ok) return [U.firstBlock(`${nav(ctx, "dupes")}${back}`), { type: "banner", tone: "warning", text: t(p.error === "kind" ? "mgKindMismatch" : "mgGone") }];
  const { keep, drop, plan, idx } = p;
  const nn = (n) => t(`net_${n}`);
  const li = [];
  li.push(plan.accounts.length ? t("mgTakeAccounts", { list: plan.accounts.map((a) => `${nn(a.network)} · ${a.handle}`).join(", ") }) : t("mgTakeNoAccounts"));
  for (const s of plan.skippedAccounts) li.push(t(s.why === "full" ? "mgSkipFull" : "mgSkipTaken", { account: `${nn(s.account.network)} · ${s.account.handle}` }));
  if (plan.categories.length) li.push(t("mgTakeCategories", { list: plan.categories.map((k) => idx.cats.get(k)?.name).filter(Boolean).join(", ") }));
  li.push(p.notes ? t("mgTakeNotes", { count: p.notes >= 1000 ? "1 000+" : fmt(ctx, p.notes) }) : t("mgTakeNoNotes"));
  if (plan.filled.length) li.push(t("mgTakeFields", { list: plan.filled.map((f) => t(FIELD_WORDS[f])).join(", ") }));
  if (plan.org) li.push(t("mgTakeOrg", { org: idx.byId.get(plan.data.orgId)?.d ?? "" }));
  if (plan.status) li.push(t("mgTakeVerified"));
  if (plan.members) li.push(t("mgTakeMembers", { count: fmt(ctx, plan.members) }));
  li.push(t("mgTellModules"));
  const html = `${nav(ctx, "dupes")}<a class="ct-back" href="${U.esc(link(keep.id, drop.id))}">${U.esc(t("mgBackCompare"))}</a>
<h2 class="ct-name">${U.esc(t("mgConfirmTitle"))}</h2>
<div class="ct-box"><p><strong>${U.esc(t("mgKept"))}</strong> ${U.esc(keep.data.name)}</p><p><strong>${U.esc(t("mgMerged"))}</strong> ${U.esc(drop.data.name)}</p><ul class="ct-list">${li.map((x) => `<li>${U.esc(x)}</li>`).join("")}</ul><p class="ct-help">${U.esc(t("mgIrreversible"))}</p></div>`;
  return [U.firstBlock(html), { type: "adminForm", action: "mergeDo", submitLabel: t("mgValidate"), cancelHref: link(keep.id, drop.id), fields: [{ name: "keep", kind: "hidden", value: keep.id }, { name: "drop", kind: "hidden", value: drop.id }] }];
}

export async function panel(ctx, q) {
  if (q.keep && q.drop) return confirmPage(ctx, q);
  if (q.view === "merge" && q.a && q.b) return comparePage(ctx, q);
  return listPage(ctx, q);
}

export const actions = {
  mergePick: async (ctx, v) => ({ ok: ctx.t("mgPicked"), redirect: `?view=merge&keep=${encodeURIComponent(v.keep ?? "")}&drop=${encodeURIComponent(v.drop ?? "")}` }),
  mergeDo: async (ctx, v) => {
    const t = ctx.t;
    const r = await B.merge(ctx, { keep: v.keep, drop: v.drop });
    DD.forgetGroups(ctx);
    if (!r.ok) return { error: t(r.error === "invalid" && v.keep && v.drop && v.keep !== v.drop ? "mgKindMismatch" : "mgGone") };
    const silent = r.remapped.filter((m) => !m.ok).map((m) => m.name);
    return { ok: silent.length ? t("mgDoneSilent", { modules: silent.join(", ") }) : t("mgDone"), redirect: `?contact=${encodeURIComponent(r.id)}` };
  },
  dupIgnore: async (ctx, v) => {
    const r = await DD.ignorePair(ctx, v.a, v.b);
    return r.ok ? { ok: ctx.t("mgIgnored"), redirect: "?view=dupes" } : { error: ctx.t(r.error === "too_many" ? "mgIgnoreFull" : "mgGone") };
  },
};
