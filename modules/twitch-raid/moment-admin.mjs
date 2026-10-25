// L'ONGLET « Sélection du moment » de la page d'administration (2.2) : ce que fait la sélection, l'adresse de son dock (OBS ou onglet), l'état de la page publique,
// les avertissements sur les réglages (nombre, durée, pseudos ignorés, catégorie « Ne pas montrer ») et deux boutons : « Voir la sélection » et « Tirer de nouveau ».
// Écrit pour quelqu'un qui n'est pas technicien : des phrases, et chaque problème dit quoi faire. Les blocs portent `tab: "moment"` : ils n'apparaissent que dans cet onglet.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const D = await import(`./draw.mjs${v}`);
const data = await import(`./data.mjs${v}`);
const M = await import(`./moment.mjs${v}`);
const consent = await import(`./consent.mjs${v}`);
const pub = await import(`./public.mjs${v}`);

const TAB = "moment";
const within = (p, ms, fallback) => { let t; return Promise.race([Promise.resolve(p).catch(() => fallback), new Promise((r) => { t = setTimeout(() => r(fallback), ms); t.unref?.(); })]).finally(() => clearTimeout(t)); };
const timeOf = (ctx, ms) => { try { return new Date(ms).toLocaleTimeString(ctx.locale || "en", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
const tab = (b) => ({ ...b, tab: TAB });

export const featuredUrl = (ctx, secret) => `${String(ctx.api.siteUrl ?? "").replace(/\/+$/, "")}/m/${ctx.instance.key}/featured?k=${encodeURIComponent(secret)}`;

/** Les phrases d'un problème de sélection (les mêmes que celles du dock). */
export function problemText(ctx, r) {
  if (r.state === "not_ready") return ctx.t(`dock_nr_${r.reason}`, { label: ctx.t("default_category") });
  if (r.state === "no_partners") return ctx.t("dock_no_partners");
  return ctx.t(r.reason === "rate" ? "dock_err_rate" : r.reason === "contacts" ? "dock_nr_contacts_down" : "dock_err_twitch");
}

/** Les blocs de l'onglet. */
export async function blocks(ctx) {
  const t = ctx.t, s = M.momentSettings(ctx), out = [];
  const [secret, hide] = await Promise.all([data.dockSecret(ctx), within(consent.hideCategory(ctx), consent.timing.readMs, { state: "unverified" })]);
  out.push(tab({ type: "heading", text: t("mo_title") }));
  out.push(tab({ type: "markdown", text: t("mo_intro", { minutes: s.minutes, count: s.count }) }));

  // Les réglages ramenés dans leurs bornes, les mots ignorés.
  const rawCount = Number(ctx.setting("count")), rawMinutes = Number(ctx.setting("duration"));
  if (ctx.setting("count") !== undefined && ctx.setting("count") !== "" && rawCount !== s.count) out.push(tab({ type: "banner", tone: "warning", text: t("mo_warn_count", { count: s.count }) }));
  if (ctx.setting("duration") !== undefined && ctx.setting("duration") !== "" && rawMinutes !== s.minutes) out.push(tab({ type: "banner", tone: "warning", text: t("mo_warn_duration", { minutes: s.minutes }) }));
  if (s.ignored.length) out.push(tab({ type: "banner", tone: "warning", text: t("mo_warn_exclude", { list: s.ignored.map((x) => `« ${x} »`).join(", ") }) }));
  if (s.over) out.push(tab({ type: "banner", tone: "warning", text: t("mo_warn_exclude_over", { max: D.EXCLUDE_MAX }) }));

  // Les personnes qui ne veulent pas apparaître.
  if (hide.state !== "ok") out.push(tab({ type: "banner", tone: "warning", text: t("mo_hide_unverified") }));
  else if (hide.how === "gone") out.push(tab({ type: "banner", tone: "warning", text: t("mo_hide_gone") }));
  else if (hide.id) out.push(tab({ type: "banner", tone: "info", text: t("mo_hide_info", { label: hide.label || t("mo_title") }) }));
  else out.push(tab({ type: "markdown", text: t("mo_hide_none") }));

  if (ctx.setting("dockMode") === "selection") out.push(tab({ type: "banner", tone: "info", text: t("mo_ordinary_shows") }));

  // Le dock de la sélection.
  const address = featuredUrl(ctx, secret);
  out.push(tab({ type: "heading", text: t("mo_addr_title") }));
  out.push(tab({ type: "markdown", text: t("mo_addr_steps") }));
  out.push(tab({ type: "copy", label: t("mo_addr_label"), text: address }));
  out.push(tab({ type: "links", items: [{ label: t("mo_addr_open"), href: address }] }));
  out.push(tab({ type: "adminForm", action: "momentCheck", title: t("mo_check_title"), submitLabel: t("mo_check_btn"), fields: [] }));
  out.push(tab({ type: "adminForm", action: "momentReroll", submitLabel: t("mo_reroll_btn"), fields: [] }));

  // La page publique.
  out.push(tab({ type: "heading", text: t("mo_page_title") }));
  if (!pub.enabled(ctx)) {
    out.push(tab({ type: "markdown", text: t("mo_page_off") }));
    // Éteinte mais avec une adresse : dire ce que voient les visiteurs (page introuvable, absente du menu et du plan du site : le cœur 0.2.12 s'en charge via `pageSetting`).
    const kept = ctx.instance.basePath;
    if (kept !== null && kept !== undefined && kept !== "") out.push(tab({ type: "banner", tone: "info", text: t("mo_page_off_addr", { path: String(kept).replace(/^\/+|\/+$/g, "") }) }));
  } else {
    out.push(tab({ type: "markdown", text: t("mo_page_on", { button: pub.texts(ctx).watch }) }));
    const path = ctx.instance.basePath;
    if (path === null || path === undefined) out.push(tab({ type: "banner", tone: "warning", text: t("mo_page_nopath") }));
    else out.push(tab({ type: "links", items: [{ label: t("mo_page_link"), href: path === "" ? "/" : `/${String(path).replace(/^\/+|\/+$/g, "")}` }] }));
  }
  return out;
}

const names = (r) => r.picks.map((p) => p.name).join(", ");

export const actions = {
  /** « Voir la sélection » : la sélection actuelle, sans la changer. */
  async momentCheck(ctx) {
    const r = await M.momentNow(ctx);
    if (r.state !== "ok") return { error: problemText(ctx, r) };
    if (!r.picks.length) return { ok: ctx.t("mo_check_none") };
    return { ok: ctx.t("mo_check_ok", { names: names(r), pool: r.pool, time: timeOf(ctx, r.endsAt) }) + (r.stale ? " " + ctx.t("mo_check_stale") : "") };
  },
  /** « Tirer de nouveau » : une nouvelle sélection, pour le dock comme pour la page publique. */
  async momentReroll(ctx) {
    const r = await M.momentNow(ctx, { reroll: true });
    if (r.state !== "ok") return { error: problemText(ctx, r) };
    if (r.wait) return { error: ctx.t("mo_reroll_wait") };
    return { ok: r.picks.length ? ctx.t("mo_rerolled", { names: names(r) }) : ctx.t("mo_check_none") };
  },
};
