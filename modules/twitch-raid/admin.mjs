// La page d'administration du module : l'adresse du dock (à copier dans OBS), la liste des chaînes partenaires, de quoi en ajouter, les modifier, les ranger.
// Écrite pour quelqu'un qui n'est pas technicien : des phrases, et chaque problème dit quoi faire.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const data = await import(`./data.mjs${v}`);
const live = await import(`./live.mjs${v}`);
const { MAX_PARTNERS, oneLine } = await import(`./pure.mjs${v}`);

const SERVICE = "twitch.api";
export const settingsOf = (ctx) => ({ channel: oneLine(ctx.setting("channel"), 40).toLowerCase() });
export const dockUrl = (ctx, secret) => `${String(ctx.api.siteUrl ?? "").replace(/\/+$/, "")}/m/${ctx.instance.key}/dock?k=${encodeURIComponent(secret)}`;

/** Attend `p` au plus `ms` (la page d'administration ne reste jamais suspendue à un autre module). */
const within = (p, ms, fallback) => { let t; return Promise.race([p, new Promise((r) => { t = setTimeout(() => r(fallback), ms); t.unref?.(); })]).finally(() => clearTimeout(t)); };

const errorText = (ctx, e) => ctx.t(`add_${e.error}`, { value: e.text ?? "" });
const quote = (list) => list.map((x) => `« ${x} »`).join(", ");

/** Dit en une phrase ce qui s'est passé quand on ajoute des chaînes. */
function addReport(ctx, r) {
  const t = ctx.t, parts = [];
  if (r.added.length) parts.push(t("add_done", { n: r.added.length, list: r.added.join(", ") }));
  if (r.dup.length) parts.push(t("add_dup", { list: quote(r.dup) }));
  if (r.full.length) parts.push(t("add_full", { max: MAX_PARTNERS }));
  for (const b of r.bad) parts.push(errorText(ctx, b));
  return parts.join(" ");
}

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

  blocks.push({ type: "heading", text: t("list_title", { n: partners.length, max: MAX_PARTNERS }) });
  if (!partners.length) blocks.push({ type: "markdown", text: t("list_empty") });
  else {
    blocks.push({
      type: "table", columns: [t("col_channel"), t("col_note")],
      rows: partners.map((p) => [p.name ? `${p.name}\n${p.login}` : p.login, p.note || "—"]), rowIds: partners.map((p) => p.login),
      rowActions: [{ label: t("act_edit"), href: "?edit={id}" }, { label: t("act_up"), action: "up" }, { label: t("act_down"), action: "down" }, { label: t("act_remove"), action: "remove", confirm: t("confirm_remove"), danger: true }],
    });
  }

  const editing = partners.find((p) => p.login === String(query?.edit ?? ""));
  if (editing) {
    blocks.push({ type: "heading", text: t("edit_title", { login: editing.login }) });
    blocks.push({
      type: "adminForm", action: "save", submitLabel: t("edit_btn"), cancelHref: "?",
      fields: [
        { name: "id", kind: "hidden", value: editing.login },
        { name: "login", label: t("f_login"), value: editing.login, required: true, help: t("f_login_help") },
        { name: "name", label: t("f_name"), value: editing.name, help: t("f_name_help") },
        { name: "note", label: t("f_note"), value: editing.note, help: t("f_note_help") },
      ],
    });
  } else {
    blocks.push({ type: "heading", text: t("add_title") });
    blocks.push({ type: "adminForm", action: "add", submitLabel: t("add_btn"), fields: [{ name: "logins", kind: "textarea", label: t("f_logins"), help: t("f_logins_help"), required: true }] });
  }
  return blocks;
}

const back = (ctx, message) => ({ ok: message, redirect: "?" });

export const actions = {
  async add(ctx, values) {
    const r = await data.addPartners(ctx, values.logins);
    live.resetLive();
    const text = addReport(ctx, r);
    if (!r.added.length) return { error: text || ctx.t("add_empty") };
    // Tout est bon : on revient à la liste. Sinon on reste là, pour que la personne lise ce qui n'a pas été ajouté.
    return r.dup.length || r.bad.length || r.full.length ? { ok: text } : back(ctx, text);
  },
  async save(ctx, values) {
    const r = await data.updatePartner(ctx, oneLine(values.id, 40), { newLogin: values.login, name: values.name, note: values.note });
    if (r.error) return { error: r.error === "dup" ? ctx.t("add_dup", { list: quote([r.login]) }) : r.error === "missing" ? ctx.t("err_missing") : errorText(ctx, { error: r.error, text: oneLine(values.login, 60) }) };
    live.resetLive();
    return back(ctx, ctx.t("saved"));
  },
  async remove(ctx, values) {
    const r = await data.removePartner(ctx, oneLine(values.id, 40));
    live.resetLive();
    return r.error ? { error: ctx.t("err_missing") } : back(ctx, ctx.t("removed"));
  },
  async up(ctx, values) { const r = await data.movePartner(ctx, oneLine(values.id, 40), -1); live.resetLive(); return r.error ? { error: ctx.t("err_missing") } : back(ctx, ctx.t("moved")); },
  async down(ctx, values) { const r = await data.movePartner(ctx, oneLine(values.id, 40), +1); live.resetLive(); return r.error ? { error: ctx.t("err_missing") } : back(ctx, ctx.t("moved")); },
  async renew(ctx) {
    await data.renewSecret(ctx);
    return back(ctx, ctx.t("renewed"));
  },
  /** « Voir qui est en direct » : un essai tout de suite, pour savoir si tout est en place sans ouvrir le dock. */
  async check(ctx) {
    live.resetLive();
    const r = await live.liveNow(ctx, await data.readPartners(ctx), settingsOf(ctx));
    if (r.state === "ok") return { ok: r.live.length ? ctx.t("check_live", { n: r.live.length, list: r.live.map((x) => x.name).join(", ") }) : ctx.t("check_none", { n: r.listed }) };
    if (r.state === "no_partners") return { error: ctx.t("dock_no_partners") };
    if (r.state === "not_ready") return { error: ctx.t(`dock_nr_${r.reason}`) };
    return { error: ctx.t(r.reason === "rate" ? "dock_err_rate" : "dock_err_twitch") };
  },
};
