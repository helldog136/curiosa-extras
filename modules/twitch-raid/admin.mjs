// La page d'administration du module (2.0) : l'adresse du dock (à copier dans OBS), l'état de la liste de raid et du dock, un lien vers Contacts.
// La liste elle-même se gère dans Contacts (une catégorie, « Cible de raid » par défaut) : ici, ni ajout, ni import, ni pages, ni recherche.
// Pendant la migration depuis la 1.x : où en est la copie de l'ancienne liste, et la dernière étape à faire (créer la catégorie, y ranger les chaînes).
// Écrite pour quelqu'un qui n'est pas technicien : des phrases, et chaque problème dit quoi faire.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const data = await import(`./data.mjs${v}`);
const live = await import(`./live.mjs${v}`);
const search = await import(`./search.mjs${v}`);
const source = await import(`./source.mjs${v}`);
const migrate = await import(`./migrate.mjs${v}`);
const addAdmin = await import(`./add-admin.mjs${v}`);
const { settingsOf } = await import(`./settings.mjs${v}`);
export { settingsOf };
const { FULL_VIEW_MAX, MAX_TARGETS, oneLine, modeFor, fold } = await import(`./pure.mjs${v}`);

export const dockUrl = (ctx, secret) => `${String(ctx.api.siteUrl ?? "").replace(/\/+$/, "")}/m/${ctx.instance.key}/dock?k=${encodeURIComponent(secret)}`;

/** Attend `p` au plus `ms` (la page d'administration ne reste jamais suspendue à un autre module). */
const within = (p, ms, fallback) => { let t; return Promise.race([Promise.resolve(p).catch(() => fallback), new Promise((r) => { t = setTimeout(() => r(fallback), ms); t.unref?.(); })]).finally(() => clearTimeout(t)); };

/** La phrase d'un problème de liste (les mêmes que celles du dock). */
export const problemText = (ctx, problem) => ctx.t(`dock_nr_${problem}`, { label: source.defaultLabels(ctx)[0] });
/** Une catégorie qui est vraiment la liste de raid (choisie, suivie après fusion, ou « Cible de raid ») ; « only » (l'unique catégorie de Contacts) sert au dock, mais la migration n'y range jamais rien d'office. */
const isRaidCategory = (cat) => !!cat && ["chosen", "moved", "default"].includes(cat.how);
const timeOf = (ctx, ms) => { try { return new Date(ms).toLocaleTimeString(ctx.locale || "en", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };

export async function panel(ctx, { query = {} } = {}) {
  const t = ctx.t, s = settingsOf(ctx), label0 = source.defaultLabels(ctx)[0];
  const [src, secret, tw, st] = await Promise.all([
    within(source.targets(ctx), source.timing.readMs + 1000, { state: "problem", problem: "contacts_down" }),
    data.dockSecret(ctx),
    within(live.pickChannel(ctx, s.channel), 4000, { problem: "slow" }),
    migrate.readState(ctx).catch(() => null),
  ]);
  const contactsPath = src.problem !== "contacts_missing" ? await source.contactsAdminPath(ctx, src.category?.id) : null;
  const address = dockUrl(ctx, secret);
  const blocks = [];
  if (tw.problem && tw.problem !== "slow") blocks.push({ type: "banner", tone: "warning", text: t(`dock_nr_${tw.problem}`), ...(tw.adminPath ? { href: tw.adminPath } : {}) });

  // Contacts : absent (proposer de l'installer, par SERVICE), trop ancien, muet ; catégorie disparue, à choisir, à créer.
  if (src.state !== "ok") {
    if (src.problem === "contacts_missing") blocks.push({ type: "suggestInstall", service: source.BOOK, min: 2, reason: t("suggest_reason") });
    blocks.push({ type: "banner", tone: "warning", text: problemText(ctx, src.problem) });
  } else if (src.stale) blocks.push({ type: "banner", tone: "warning", text: t("contacts_stale", { time: timeOf(ctx, src.asOf) }) });

  // La migration depuis la 1.x (à retirer en phase 3).
  if (st && st.total > 0 && !st.migratedAt) {
    if (!st.copiedAt) {
      blocks.push({ type: "banner", tone: "warning", text: t("mig_copy_todo", { done: st.done, total: st.total }) + (st.full ? " " + t("mig_full") : st.stopped ? " " + problemText(ctx, st.stopped) : "") });
      blocks.push({ type: "adminForm", action: "migrate", submitLabel: t("mig_copy_btn"), fields: [] });
    } else if (st.pending.length && !(src.state !== "ok" && ["contacts_missing", "contacts_old", "contacts_down", "category_gone"].includes(src.problem))) {
      // Dernière étape : la catégorie est créée toute seule si elle manque (avec vos droits), puis les chaînes de la version 1 y sont rangées.
      const label = src.state === "ok" && isRaidCategory(src.category) ? src.category.label : source.defaultName(ctx);
      blocks.push({ type: "heading", text: t("mig_finish_title") });
      blocks.push({ type: "markdown", text: t("mig_finish_text", { n: st.pending.length, label }) });
      blocks.push({ type: "adminForm", action: "finish", submitLabel: t("mig_finish_btn"), fields: [] });
    }
  }
  if (st?.skippedCount) blocks.push({ type: "markdown", text: t("mig_skipped", { n: st.skippedCount, list: st.skipped.slice(0, 10).map((x) => `« ${oneLine(x.login, 40)} »`).join(", ") }) });

  // Ajouter une chaîne (en haut : c'est ce qu'on fait le plus souvent), puis la liste, puis l'explication du dock.
  blocks.push(...await within(addAdmin.addBlocks(ctx, src, query), source.timing.readMs + 3000, []));

  // La liste de raid : un compteur, le mode du dock, le lien vers Contacts.
  blocks.push({ type: "heading", text: t("list_title") });
  if (src.state === "ok") {
    const n = src.partners.length;
    if (src.category) {
      if (src.category.how === "moved") blocks.push({ type: "banner", tone: "info", text: t("list_moved", { label: src.category.label }) });
      if (src.category.how === "only" && !source.defaultLabels(ctx).some((l) => fold(l) === fold(src.category.label))) blocks.push({ type: "markdown", text: t("list_only", { label: src.category.label, default: label0 }) });
      blocks.push({ type: "markdown", text: n ? t(n === 1 ? "list_count_one" : "list_count", { n, label: src.category.label }) : t("list_empty", { label: src.category.label }) });
    } else blocks.push({ type: "markdown", text: t(n === 1 ? "list_count_awaiting_one" : "list_count_awaiting", { n }) });
    if (n) blocks.push({ type: "banner", tone: "info", text: t(modeFor(n) === "random" ? "mode_random" : n === 1 ? "mode_full_one" : "mode_full", { n, max: FULL_VIEW_MAX }) });
    if (src.truncated) blocks.push({ type: "banner", tone: "warning", text: t("list_truncated", { max: MAX_TARGETS }) });
  }
  if (contactsPath) blocks.push({ type: "links", items: [{ label: t("manage_link"), href: contactsPath }] });
  blocks.push(...await within(addAdmin.listBlocks(ctx, src, query), source.timing.readMs + 1000, []));

  blocks.push({ type: "markdown", text: t("admin_intro", { label: label0 }) });

  blocks.push({ type: "heading", text: t("addr_title") });
  blocks.push({ type: "markdown", text: t("addr_steps") });
  blocks.push({ type: "copy", label: t("addr_label"), text: address });
  blocks.push({ type: "links", items: [{ label: t("addr_open"), href: address }] });
  blocks.push({ type: "adminForm", action: "check", title: t("check_title"), submitLabel: t("check_btn"), fields: [] });
  blocks.push({ type: "table", columns: [t("renew_title")], rows: [[t("renew_help")]], rowIds: ["dock"], rowActions: [{ label: t("renew_btn"), action: "renew", confirm: t("renew_confirm"), danger: true }] });
  return blocks;
}

const back = (message) => ({ ok: message, redirect: "?" });
const forget = () => { source.resetSource(); live.resetLive(); };

export const actions = {
  ...addAdmin.actions,
  async renew(ctx) {
    await data.renewSecret(ctx);
    return back(ctx.t("renewed"));
  },
  /** « Continuer la copie » : la suite de la migration de l'ancienne liste vers Contacts, bornée (un clic = quelques secondes de travail). */
  async migrate(ctx) {
    const cat = await source.resolveCategory(ctx);
    const r = await migrate.copyToContacts(ctx, { budgetMs: migrate.timing.actionMs, categoryId: isRaidCategory(cat) ? cat.id : null });
    forget();
    const st = r.state;
    if (r.status === "done" || r.status === "copied") return back(ctx.t("mig_copy_done", { total: st.total }));
    if (r.status === "partial") return { ok: ctx.t("mig_copy_partial", { done: st.done, total: st.total }) };
    return { error: st.full ? ctx.t("mig_full") : problemText(ctx, st.stopped ?? "contacts_down") };
  },
  /** « Ranger mes chaînes dans cette catégorie » : les fiches recopiées rejoignent la catégorie choisie ou « Cible de raid », créée toute seule si elle manque (avec vos droits). */
  async finish(ctx) {
    const cat = await source.ensureCategory(ctx, undefined, { ownList: true });
    if (!cat.ok) return { error: addAdmin.problemLine(ctx, cat.problem) };
    const r = await migrate.finishCategory(ctx, cat.id);
    forget();
    if (r.status === "done") return back(ctx.t("mig_finish_done", { label: cat.label }) + (cat.created ? " " + ctx.t("add_cat_created", { label: cat.label }) : ""));
    if (r.status === "partial") return { ok: ctx.t("mig_finish_partial", { n: r.state.pending.length }) };
    return { error: problemText(ctx, r.state.stopped ?? "contacts_down") };
  },
  /** « Voir qui est en direct » : un essai tout de suite, pour savoir si tout est en place sans ouvrir le dock. */
  async check(ctx) {
    forget();
    const src = await source.targets(ctx);
    if (src.state !== "ok") return { error: problemText(ctx, src.problem) };
    const partners = src.partners;
    const r = await live.liveNow(ctx, partners, settingsOf(ctx));
    if (r.state === "ok" && r.mode === "random") {
      const f = await search.findRandom(ctx, partners, settingsOf(ctx));
      if (f.state === "found") return { ok: ctx.t("check_random_found", { name: f.pick.name }) };
      if (f.state === "none") return { ok: ctx.t("check_random_none", { n: partners.length }) };
      if (f.state === "limited") return { error: ctx.t("dock_limited") };
      if (f.state === "not_ready") return { error: ctx.t(`dock_nr_${f.reason}`) };
      return { error: ctx.t(f.reason === "rate" ? "dock_err_rate" : "dock_err_twitch") };
    }
    if (r.state === "ok") {
      const note = r.partial ? " " + ctx.t("check_partial", { n: r.partial }) : "";
      return { ok: (r.live.length ? ctx.t("check_live", { n: r.live.length, list: r.live.map((x) => x.name).join(", ") }) : ctx.t("check_none", { n: r.listed })) + note };
    }
    if (r.state === "no_partners") return { error: ctx.t("dock_no_partners") };
    if (r.state === "not_ready") return { error: ctx.t(`dock_nr_${r.reason}`) };
    return { error: ctx.t(r.reason === "rate" ? "dock_err_rate" : "dock_err_twitch") };
  },
};
