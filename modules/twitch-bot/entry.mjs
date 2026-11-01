// La commande de chat d'UN partenaire, réglée dans la FICHE du partenaire (l'éditeur d'entrée de Sponsors) : le cœur y ajoute cette section (`entryPanels` de module.json) et
// ne l'affiche que parce que ce module est installé ; Sponsors ne sait rien du bot. La donnée reste ici : la commande est rangée sous l'identifiant de la fiche, avec les autres
// commandes (commands.mjs), et le titre et l'adresse de la fiche sont lus au moment de répondre. La page du bot ne garde que le résumé et un lien « Modifier » vers cette section.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { catalog, proposePartner, saveSourced, stripScheme } = await import(`./commands.mjs${v}`);
const A = await import(`./admin.mjs${v}`);
const { preview } = await import(`./engine.mjs${v}`);

/** Le lien d'une fiche, tel que Sponsors le montre (et tel que le bot le lit : titre, adresse). La fiche vient du cœur, jamais du navigateur. */
function itemOf(ctx, entry) {
  const site = String(ctx.api.siteUrl ?? "").replace(/\/+$/, "");
  return { id: String(entry.id), title: String(entry.title || entry.slug || "").slice(0, 120), slug: String(entry.slug ?? ""), path: String(entry.path ?? ""), address: stripScheme(`${site}${entry.path ?? ""}`), instance: String(entry.instance) };
}

/** Cette fiche est-elle bien celle d'un sponsor ? (la section est demandée par sujet ; ce module ne règle que les fiches des instances de Sponsors) */
async function isPartner(ctx, entry) {
  return (await ctx.api.instances.list({ module: "sponsors" })).some((i) => i.key === entry.instance);
}

/** Les sources du bot, avec CETTE fiche en plus : un brouillon n'est pas dans la liste des fiches publiées, mais on doit pouvoir régler sa commande (elle attendra la publication). */
function withEntry(env, item) {
  const p = env.src.partners ?? { installed: true, items: [] };
  const items = p.items.some((x) => x.id === item.id) ? p.items : [...p.items, item];
  return { ...env, src: { ...env.src, partners: { ...p, installed: true, items } } };
}

export default {
  /** Les blocs de la section pour cette fiche. Rien (`[]`) quand la fiche n'est pas celle d'un sponsor : le cœur n'affiche alors aucune section. */
  async render(ctx, entry, { advanced, role }) {
    if (!(await isPartner(ctx, entry))) return [];
    const t = ctx.t;
    const info = await A.context(ctx, { declare: false });
    const item = itemOf(ctx, entry);
    const env = withEntry(info.env, item);
    const list = catalog(info.cfg, env.src, t);
    const current = list.find((c) => c.key === `partner:${item.id}`);
    const proposal = current ? null : proposePartner(item, list, t);
    const view = current ?? { kind: "partner", id: item.id, name: proposal.name, aliases: proposal.aliases, text: proposal.text, role: "everyone", cdGlobal: null, cdUser: null, enabled: false, vars: { partenaire: item.title, adresse: item.address } };
    const out = [];
    if (!entry.published) out.push({ type: "banner", tone: "info", text: t("entry_unpublished") });
    // Le bot ne répond pas encore (autorisation Twitch, site privé…) : on le dit ici aussi, avec le chemin vers la page qui explique quoi faire.
    // Une éditrice n'ouvre pas la page du bot (réservée aux administrateurs) : pas de lien pour elle, mais une phrase qui dit à qui s'adresser.
    const canOpenBot = role !== "editor";
    if (info.d.code !== "ready") out.push({ type: "banner", tone: "warning", text: t(canOpenBot ? "entry_bot_not_ready" : "entry_bot_not_ready_editor"), ...(canOpenBot ? { href: `/admin/instances/${ctx.instance.id}` } : {}) });
    // Aperçu : ce que répondrait la commande avec les données du moment (rien n'est envoyé).
    try {
      const text = await preview(ctx, view, { channel: info.d.channel ?? null, sources: env.src, list });
      out.push({ type: "markdown", text: t("edit_preview", { text: text.replace(/([\\`*_[\]<>])/g, "\\$1") }) });
    } catch { /* l'aperçu est un plus */ }
    out.push({ type: "adminForm", action: "save", submitLabel: t("save_btn"), fields: [
      { name: "enabled", label: t("f_enabled_chat"), kind: "checkbox", value: view.enabled ? "on" : "" },
      { name: "name", label: t("f_name", { prefix: info.s.prefix }), value: view.name, required: true, help: t("f_name_help", { prefix: info.s.prefix }) },
      { name: "text", label: t("f_text"), kind: "textarea", value: view.text, required: true, help: A.varsHelp(t, "partner") },
      // Le reste est pour le mode avancé : sans lui, ces réglages gardent leur valeur (« tout le monde », attentes par défaut).
      ...(advanced ? [
        { name: "aliases", label: t("f_aliases"), value: view.aliases.join(", "), help: t("f_aliases_help") },
        { name: "role", label: t("f_role"), kind: "select", value: view.role, options: A.roleOptions(t) },
        ...A.delayFields(t, view, info.s),
      ] : []),
    ] });
    if (canOpenBot) out.push({ type: "links", items: [{ label: t("entry_open_bot"), href: `/admin/instances/${ctx.instance.id}` }] });
    return out;
  },

  actions: {
    async save(ctx, entry, v) {
      if (!(await isPartner(ctx, entry))) return { error: ctx.t("err_unknown") };
      const info = await A.context(ctx, { declare: false });
      const fields = { enabled: v.enabled === "on", name: v.name, text: v.text };
      for (const k of ["aliases", "role", "cdGlobal", "cdUser"]) if (v[k] !== undefined) fields[k] = v[k] || (k === "role" ? "everyone" : "");
      const r = await saveSourced(ctx, "partner", String(entry.id), fields, withEntry(info.env, itemOf(ctx, entry)));
      return r.ok === false ? { error: A.saveError(ctx, r) } : { ok: ctx.t(entry.published ? "saved" : "entry_saved_unpublished") };
    },
  },
};
