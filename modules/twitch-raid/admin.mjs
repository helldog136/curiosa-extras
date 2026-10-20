// La page d'administration du module : l'adresse du dock (à copier dans OBS), la liste des chaînes partenaires (jusqu'à 2 000 : par pages de 50, avec une recherche), de quoi en ajouter (par paquets collés), les modifier, les ranger.
// Écrite pour quelqu'un qui n'est pas technicien : des phrases, et chaque problème dit quoi faire.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const data = await import(`./data.mjs${v}`);
const live = await import(`./live.mjs${v}`);
const search = await import(`./search.mjs${v}`);
const { MAX_PARTNERS, FULL_VIEW_MAX, PASTE_MAX, PAGE_SIZE, oneLine, splitList, modeFor, filterPartners, pageOf, rowId, parseRowId } = await import(`./pure.mjs${v}`);

const SERVICE = "twitch.api";
/** `channel` : la valeur brute du réglage (l'id d'une instance de Ma Chaîne Twitch, ou un pseudo tapé avant le choix) ; channel.mjs la traduit en pseudo. */
export const settingsOf = (ctx) => ({ channel: oneLine(ctx.setting("channel"), 200) });
export const dockUrl = (ctx, secret) => `${String(ctx.api.siteUrl ?? "").replace(/\/+$/, "")}/m/${ctx.instance.key}/dock?k=${encodeURIComponent(secret)}`;

/** Attend `p` au plus `ms` (la page d'administration ne reste jamais suspendue à un autre module). */
const within = (p, ms, fallback) => { let t; return Promise.race([p, new Promise((r) => { t = setTimeout(() => r(fallback), ms); t.unref?.(); })]).finally(() => clearTimeout(t)); };

const errorText = (ctx, e) => ctx.t(`add_${e.error}`, { value: e.text ?? "" });
const quote = (list) => list.map((x) => `« ${x} »`).join(", ");
const SHOWN = 10;   // combien de noms le bilan d'un ajout énumère avant de passer aux totaux

/** Dit en quelques phrases ce qui s'est passé quand on ajoute des chaînes (jamais une liste de 500 noms). */
function addReport(ctx, r, cut) {
  const t = ctx.t, parts = [];
  if (r.added.length) parts.push(r.added.length <= SHOWN ? t("add_done", { n: r.added.length, list: r.added.join(", ") }) : t("add_done_many", { n: r.added.length }));
  if (r.dup.length) parts.push(r.dup.length <= SHOWN ? t("add_dup", { list: quote(r.dup) }) : t("add_dup_many", { n: r.dup.length }));
  if (r.full.length) parts.push(t("add_full", { max: MAX_PARTNERS, n: r.full.length }));
  for (const b of r.bad.slice(0, 5)) parts.push(errorText(ctx, b));
  if (r.bad.length > 5) parts.push(t("add_bad_more", { n: r.bad.length - 5 }));
  if (cut) parts.push(t("add_cut", { after: cut }));
  return parts.join(" ");
}

/** L'adresse de la page demandée de la liste (`?page=3&q=alice`), ou `?` pour la première page sans recherche. */
const listHref = (page, q) => { const p = new URLSearchParams(); if (page > 1) p.set("page", String(page)); if (q) p.set("q", q); const s = p.toString(); return s ? `?${s}` : "?"; };

export async function panel(ctx, { query } = {}) {
  const t = ctx.t, s = settingsOf(ctx);
  const [partners, secret, tw] = await Promise.all([data.readPartners(ctx), data.dockSecret(ctx), within(live.pickChannel(ctx, s.channel).catch(() => ({ problem: "no_channel" })), 4000, { problem: "slow" })]);
  const address = dockUrl(ctx, secret);
  const blocks = [];
  if (tw.problem && tw.problem !== "slow") blocks.push({ type: "banner", tone: "warning", text: t(`dock_nr_${tw.problem}`), ...(tw.adminPath ? { href: tw.adminPath } : {}) });
  blocks.push({ type: "markdown", text: t("admin_intro") });

  blocks.push({ type: "heading", text: t("addr_title") });
  blocks.push({ type: "markdown", text: t("addr_steps") });
  blocks.push({ type: "copy", label: t("addr_label"), text: address });
  blocks.push({ type: "links", items: [{ label: t("addr_open"), href: address }] });
  blocks.push({ type: "adminForm", action: "check", title: t("check_title"), submitLabel: t("check_btn"), fields: [] });
  blocks.push({ type: "table", columns: [t("renew_title")], rows: [[t("renew_help")]], rowIds: ["dock"], rowActions: [{ label: t("renew_btn"), action: "renew", confirm: t("renew_confirm"), danger: true }] });

  const wanted = query?.edit ? parseRowId(query.edit) : null;   // « Modifier » garde la page et la recherche d'où l'on vient (dans l'identifiant de la ligne)
  // Le formulaire (ajouter ou modifier) est AVANT la liste : sa place ne bouge pas quand la liste grandit, et le bilan d'un import reste affiché.
  const editing = wanted && partners.find((p) => p.login === wanted.login);
  if (editing) {
    blocks.push({ type: "heading", text: t("edit_title", { login: editing.login }) });
    blocks.push({
      type: "adminForm", action: "save", submitLabel: t("edit_btn"), cancelHref: listHref(wanted.page, wanted.q),
      fields: [
        { name: "id", kind: "hidden", value: rowId(editing.login, wanted.page, wanted.q) },
        { name: "login", label: t("f_login"), value: editing.login, required: true, help: t("f_login_help") },
        { name: "name", label: t("f_name"), value: editing.name, help: t("f_name_help") },
        { name: "note", label: t("f_note"), value: editing.note, help: t("f_note_help") },
      ],
    });
  } else {
    blocks.push({ type: "heading", text: t("add_title") });
    blocks.push({ type: "adminForm", action: "add", submitLabel: t("add_btn"), fields: [{ name: "logins", kind: "textarea", label: t("f_logins"), help: t("f_logins_help"), required: true }] });
  }
  const q = oneLine(wanted ? wanted.q : query?.q, 40), searching = q !== "";
  const matches = filterPartners(partners, q), pg = pageOf(matches, wanted ? wanted.page : query?.page, PAGE_SIZE);
  blocks.push({ type: "heading", text: searching ? t("list_title_found", { n: matches.length, total: partners.length }) : t(partners.length === 1 ? "list_title_one" : "list_title", { n: partners.length, max: MAX_PARTNERS }) });
  if (partners.length) blocks.push({ type: "banner", tone: "info", text: t(modeFor(partners.length) === "random" ? "mode_random" : partners.length === 1 ? "mode_full_one" : "mode_full", { n: partners.length, max: FULL_VIEW_MAX }) });
  if (partners.length > 20 || searching) blocks.push({ type: "adminForm", action: "search", submitLabel: t("search_btn"), cancelHref: searching ? "?" : undefined, fields: [{ name: "q", label: t("search_label"), value: q, help: t("search_help") }] });
  if (!partners.length) blocks.push({ type: "markdown", text: t("list_empty") });
  else if (!matches.length) blocks.push({ type: "markdown", text: t("search_none", { q }) });
  else {
    const pager = pg.pages > 1 ? (() => {
      // Les liens d'un bloc « links » doivent être des adresses complètes : les boutons de ligne d'un tableau, eux, acceptent « ?page=3 ». Le pager est donc un petit tableau d'une ligne.
      const buttons = [];
      if (pg.page > 1) buttons.push({ label: t("page_first"), href: listHref(1, q) }, { label: t("page_prev"), href: listHref(pg.page - 1, q) });
      if (pg.page < pg.pages) buttons.push({ label: t("page_next"), href: listHref(pg.page + 1, q) }, { label: t("page_last"), href: listHref(pg.pages, q) });
      // libellés courts : sur un téléphone, le tableau ne doit pas déborder
      return { type: "table", columns: [t("page_range", { from: (pg.page - 1) * PAGE_SIZE + 1, to: (pg.page - 1) * PAGE_SIZE + pg.items.length, total: matches.length })], rows: [[t("page_of", { page: pg.page, pages: pg.pages })]], rowIds: ["pager"], rowActions: buttons };
    })() : null;
    if (pager) blocks.push(pager);   // en haut ET en bas de la page de 50 chaînes
    blocks.push({
      type: "table", columns: [t("col_channel"), t("col_note")],
      rows: pg.items.map((p) => [p.name ? `${p.name}\n${p.login}` : p.login, p.note || "—"]), rowIds: pg.items.map((p) => rowId(p.login, pg.page, q)),
      // « Monter / Descendre » change l'ordre de TOUTE la liste : pendant une recherche, les voisins affichés ne sont pas les voisins de la liste, on ne le propose pas
      rowActions: [{ label: t("act_edit"), href: "?edit={id}" }, ...(searching ? [] : [{ label: t("act_up"), action: "up" }, { label: t("act_down"), action: "down" }]), { label: t("act_remove"), action: "remove", confirm: t("confirm_remove"), danger: true }],
    });
    if (pager) blocks.push(pager);
  }

  return blocks;
}

/** Revient à la liste, à la même page et avec la même recherche. */
const back = (ctx, message, where = {}) => ({ ok: message, redirect: listHref(where.page ?? 1, where.q ?? "") });
const clear = () => live.resetLive();

export const actions = {
  async add(ctx, values) {
    const raw = String(values.logins ?? ""), tooLong = raw.length >= PASTE_MAX;
    let text = raw, after = "";
    if (tooLong) {
      // le cœur coupe ce qu'on colle à 20 000 caractères : le dernier pseudo est peut-être coupé en deux, on ne l'ajoute SURTOUT pas (ce serait une autre chaîne)
      const lines = splitList(raw); lines.pop();
      after = lines[lines.length - 1] ?? ""; text = lines.join("\n");
    }
    const r = await data.addPartners(ctx, text);
    clear();
    const message = addReport(ctx, r, tooLong ? after || "…" : "");
    if (!r.added.length) return { error: message || ctx.t("add_empty") };
    // Tout est bon : on revient à la liste. Sinon on reste là, pour que la personne lise ce qui n'a pas été ajouté.
    return r.dup.length || r.bad.length || r.full.length || tooLong ? { ok: message } : back(ctx, message);
  },
  async save(ctx, values) {
    const at = parseRowId(values.id);
    const r = await data.updatePartner(ctx, at.login, { newLogin: values.login, name: values.name, note: values.note });
    if (r.error) return { error: r.error === "dup" ? ctx.t("add_dup", { list: quote([r.login]) }) : r.error === "missing" ? ctx.t("err_missing") : errorText(ctx, { error: r.error, text: oneLine(values.login, 60) }) };
    clear();
    return back(ctx, ctx.t("saved"), at);
  },
  async remove(ctx, values) {
    const at = parseRowId(values.id);
    const r = await data.removePartner(ctx, at.login);
    clear();
    return r.error ? { error: ctx.t("err_missing") } : back(ctx, ctx.t("removed"), at);
  },
  async up(ctx, values) { const at = parseRowId(values.id); const r = await data.movePartner(ctx, at.login, -1); clear(); return r.error ? { error: ctx.t("err_missing") } : back(ctx, ctx.t("moved"), at); },
  async down(ctx, values) { const at = parseRowId(values.id); const r = await data.movePartner(ctx, at.login, +1); clear(); return r.error ? { error: ctx.t("err_missing") } : back(ctx, ctx.t("moved"), at); },
  /** Chercher dans la liste : on revient à la page 1 de la liste filtrée (la recherche est dans l'adresse). */
  async search(ctx, values) { return { redirect: listHref(1, oneLine(values.q, 40)) }; },
  async renew(ctx) {
    await data.renewSecret(ctx);
    return back(ctx, ctx.t("renewed"));
  },
  /** « Voir qui est en direct » : un essai tout de suite, pour savoir si tout est en place sans ouvrir le dock. */
  async check(ctx) {
    live.resetLive();
    const partners = await data.readPartners(ctx);
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
