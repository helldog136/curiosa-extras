// La page « Commandes » : UN tableau de toutes les commandes (recherche en direct, filtres en pastilles, interrupteur dans la ligne), le choix « ajouter une commande pour un partenaire
// ou un réseau », le formulaire d'une commande (3 champs visibles, le reste sous « Plus d'options ») et le journal. Les règles : docs/ERGONOMIE-ADMIN.md (R14 à R17, R30).
// Le HTML des listes vient de adminkit.mjs ; le formulaire reste un formulaire du cœur, rangé par adminkit.client.js.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const K = await import(`./adminkit.mjs${v}`);
const F = await import(`./formsUi.mjs${v}`);
const { roleOptions } = F;
const { reopenLabel, periodField, isoText } = await import(`./period.mjs${v}`);

const { esc, norm } = K;
const ORIGINS = ["custom", "builtin", "partner", "network"];
const originOf = (c) => (c.kind === "group" ? "builtin" : c.kind);

/** « 1er novembre » (jour et mois seulement) pour la note d'une ligne. */
function shortDate(ctx, n) {
  const text = new Intl.DateTimeFormat(ctx.locale, { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(n.y ?? 2024, n.m - 1, n.d)));
  return String(ctx.locale).startsWith("fr") && n.d === 1 ? text.replace(/^1 /, "1er ") : text;
}
/** La phrase longue de l'état (info-bulle, recherche) et la note courte sous l'interrupteur (seulement quand l'état sort de l'ordinaire). */
export function stateTexts(ctx, state, why, reopen) {
  const t = ctx.t;
  if (state === "on") return { full: t("state_on"), note: "", word: t("state_on") };
  if (state === "off") return { full: t("state_off"), note: "", word: t("state_off") };
  if (state === "outside") return { full: reopenLabel(ctx, reopen), note: reopen ? t("note_outside", { date: shortDate(ctx, reopen) }) : t("note_ended"), word: t("state_outside") };
  return { full: t(`why_${why}`), note: t(`note_${why}`), word: t(state === "missing" ? "state_missing" : "state_hidden") };
}

const words = (prefix, c) => [c.name, ...c.aliases].map((w) => `${prefix}${w}`);
const byName = (ctx) => (a, b) => (a.enabled === b.enabled ? 0 : a.enabled ? -1 : 1) || String(a.name).localeCompare(String(b.name), ctx.locale) || (a.key < b.key ? -1 : 1);

/* ───────────── Le tableau ───────────── */

function commandRow(ctx, info, c, partnerHref) {
  const t = ctx.t, p = info.s.prefix, origin = originOf(c);
  const onState = c.kind === "partner" || c.kind === "network" ? (c.missing ? c.state : c.onState ?? "on") : c.onState ?? "on";
  const cur = stateTexts(ctx, c.state, c.why, c.reopen);
  const would = c.missing ? cur : stateTexts(ctx, onState, c.onWhy, c.onReopen);
  const [first, ...others] = words(p, c);
  const role = c.role === "everyone" ? "" : t(`role_${c.role}`);
  const hay = [...words(p, c), c.name, ...c.aliases, c.text, t(`origin_${origin}`), cur.word, role].join(" ");
  const href = c.kind === "partner" ? partnerHref.replace("{id}", encodeURIComponent(c.id)) : `?edit=${encodeURIComponent(c.key)}#edit`;
  const action = c.missing ? "" : `<a class="ck-btn small" href="${esc(href)}">${esc(c.kind === "partner" ? t("act_open_partner") : t("act_edit"))}</a>`;
  return `<tr ${K.rowAttrs({ origin, state: c.state, "on-state": onState, "on-note": would.note }, hay)}>
<td class="c-name"><span class="ck-ell" title="${esc(words(p, c).join("  "))}"><span class="ck-name">${esc(first)}</span>${others.length ? ` <span class="ck-alias">${esc(others.join(" · "))}</span>` : ""}${role ? `<span class="ck-chipr">${esc(role)}</span>` : ""}</span></td>
<td class="c-ans"><span class="ck-ell" title="${esc(c.text)}">${esc(c.text)}</span></td>
<td class="c-org">${K.originPill(origin, t(`origin_${origin}`))}</td>
<td class="c-sw">${K.switchHtml({ id: c.key, on: c.enabled, label: t("sw_label", { command: first }), disabled: !!c.missing, fail: t("err_toggle") })}<span class="ck-note" data-ck-note title="${esc(cur.full)}"${cur.note ? "" : " hidden"}>${esc(cur.note)}</span></td>
<td class="c-act"><div class="ck-acts">${action}</div></td></tr>`;
}

export function commandsList(ctx, info, { partnerHref }) {
  const t = ctx.t, list = [...info.list].sort(byName(ctx));
  const count = (f) => list.filter(f).length;
  const origin = ORIGINS.map((o) => ({ val: o, label: t(`filter_${o}`), count: count((c) => originOf(c) === o) })).filter((x) => x.count > 0);
  const states = [["on", "filter_on"], ["off", "filter_off"], ["outside", "filter_outside"], ["hidden", "filter_hidden"]]
    .map(([val, key]) => ({ val, label: t(key), count: count((c) => (val === "hidden" ? c.state === "hidden" || c.state === "missing" : c.state === val)) })).filter((x) => x.count > 0);
  const head = `<div class="ck-head"><h2 class="ck-title">${esc(t("summary_title"))}</h2><a class="ck-btn primary" href="?new=1#edit">${esc(t("new_open"))}</a></div><p class="ck-intro">${esc(t("summary_help"))}</p>`;
  return {
    type: "html",
    html: K.listShell({
      ctx, id: "commands", head,
      columns: [{ label: t("col_command"), width: "21%" }, { label: t("col_answer") }, { label: t("col_origin"), width: "11%" }, { label: t("col_active"), width: "25%" }, { label: t("col_action"), width: "15%", sr: true }],
      rows: list.map((c) => commandRow(ctx, info, c, partnerHref)).join(""),
      pills: [{ key: "origin", label: t("filter_origin"), items: [{ val: "all", label: t("filter_all"), count: list.length }, ...origin] }, { key: "state", label: t("filter_state"), items: [{ val: "all", label: t("filter_any"), count: list.length }, ...states] }],
      groups: { state: { hidden: ["hidden", "missing"] } },
      text: { search: t("search_label"), placeholder: t("search_commands"), empty: t("search_none"), clear: t("search_clear"), count: t("search_count") },
    }),
  };
}

/* ───────────── « Ajouter une commande pour un partenaire ou un réseau » ───────────── */

export function addChooser(ctx, info, { partnerHref }) {
  const t = ctx.t, { sources, list, s } = info;
  const known = new Set(list.map((c) => c.key));
  const partners = (sources.partners?.items ?? []).filter((p) => !known.has(`partner:${p.id}`));
  const networks = (sources.networks?.items ?? []).filter((n) => !known.has(`network:${n.key}`));
  if (!partners.length && !networks.length) return null;
  const rows = [
    ...partners.map((p) => ({ origin: "partner", name: p.title, href: partnerHref.replace("{id}", encodeURIComponent(p.id)) })),
    ...networks.map((n) => ({ origin: "network", name: n.label || n.name, href: `?edit=${encodeURIComponent(`network:${n.key}`)}#edit` })),
  ];
  const part = (n, one, many) => (n === 1 ? t(one) : t(many, { n }));
  const bits = [partners.length ? part(partners.length, "add_partners_1", "add_partners_n") : "", networks.length ? part(networks.length, "add_networks_1", "add_networks_n") : ""].filter(Boolean);
  const total = partners.length + networks.length;
  const status = t(total === 1 ? "add_status_one" : "add_status", { list: bits.length === 2 ? t("add_join", { a: bits[0], b: bits[1] }) : bits[0] });
  const body = K.listShell({
    ctx, id: "add", columns: [{ label: t("col_name") }, { label: t("col_origin"), width: "16%" }, { label: t("col_action"), width: "20%", sr: true }],
    rows: rows.map((r) => `<tr ${K.rowAttrs({ origin: r.origin }, `${r.name} ${t(`origin_${r.origin}`)}`)}><td class="c-name"><span class="ck-ell" title="${esc(r.name)}"><span class="ck-name">${esc(r.name)}</span></span></td><td class="c-org">${K.originPill(r.origin, t(`origin_${r.origin}`))}</td><td class="c-act"><div class="ck-acts"><a class="ck-btn small" href="${esc(r.href)}">${esc(t("add_go"))}</a></div></td></tr>`).join(""),
    text: { search: t("search_label"), placeholder: t("search_sources"), empty: t("search_none"), clear: t("search_clear"), count: t("search_count") },
  });
  return { type: "html", html: `<div class="ck"><details class="ck-add"><summary><span class="ck-add-b">${esc(t("add_btn"))}</span><span class="ck-add-s">${esc(status)}</span></summary><div class="ck-add-body">${body}</div></details></div>` };
}

/* ───────────── Le formulaire d'une commande ───────────── */

/**
 * `view` : la commande (ou la proposition) ; `mode` : "new" ou "edit" ; `unsaved` : une proposition pas encore enregistrée (la sauvegarde l'active).
 * Champs visibles : Nom, Ce que le bot répond, Qui peut l'utiliser (3). Sous « Plus d'options » : autres noms, attentes, période.
 */
export async function commandForm(ctx, info, { mode, view, key, unsaved = false, kind }) {
  const t = ctx.t, s = info.s;
  const env = { channel: info.d.channel ?? null, sources: info.sources, list: info.list };
  const cfg = F.textExtras ? await F.textExtras(ctx, kind, view.vars, env) : null;
  const layout = [
    { f: "name" },
    { f: "text", preview: cfg },
    { seg: "role" },
    { more: { title: t("more_title"), hint: t("more_hint_cmd"), open: false, items: [{ f: "aliases", label: t("f_aliases") }, F.waitSentence(ctx, s), F.periodLayout(ctx, view.period ?? null, s.timeZone)] } },
  ];
  const id = mode === "new" ? "cmd-new" : "cmd-edit";
  const conf = K.formConfig(id, { layout });
  const form = { type: "adminForm", action: mode === "new" ? "create" : "save", submitLabel: t(mode === "new" ? "new_btn" : "save_btn"), cancelHref: "?", fields: [
    conf.field,
    ...(mode === "edit" ? [{ name: "key", kind: "hidden", value: key }] : []),
    ...(unsaved ? [{ name: "enabled", kind: "hidden", value: "on" }] : []),
    { name: "name", label: t("f_name"), value: view.name ?? "", required: true, help: t("f_name_help", { prefix: s.prefix }) },
    { name: "text", label: t("f_text"), kind: "textarea", value: view.text ?? "", required: true, help: t("f_text_help") },
    { name: "role", label: t("f_role"), kind: "select", value: view.role ?? "everyone", options: roleOptions(t) },
    { name: "aliases", label: t("f_aliases"), value: (view.aliases ?? []).join(", "), help: t("f_aliases_help") },
    { name: "cdGlobal", label: t("f_cd_global"), kind: "number", value: view.cdGlobal ?? "", help: t("f_cd_help", { n: s.cdGlobal }) },
    { name: "cdUser", label: t("f_cd_user"), kind: "number", value: view.cdUser ?? "", help: t("f_cd_help", { n: s.cdUser }) },
    periodField(ctx, view.period ?? null),
  ] };
  return [conf.block, form];
}

/* ───────────── Le journal ───────────── */

export function logBlock(ctx, s, entries) {
  const t = ctx.t;
  const when = (at) => new Date(at).toLocaleTimeString(ctx.locale, { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: s.timeZone });
  const reason = (e) => (e.result === "sent" ? e.text ?? "" : `${e.reason === "outside" ? (e.reopen ? t("per_outside", { date: isoText(ctx, e.reopen) }) : t("per_ended")) : t(`reason_${e.reason}`, { seconds: e.seconds ?? "" })}${e.detail && e.result === "error" ? ` (${K.cut(e.detail, 40)})` : ""}`);
  const rows = entries.map((e) => {
    const cmd = e.command.startsWith("⏱") ? e.command : `${s.prefix}${e.command}`, what = `${t(`log_${e.result}`)} : ${reason(e)}`;
    return `<tr ${K.rowAttrs({ result: e.result }, `${e.user} ${cmd} ${what}`)}><td class="c-name"><span class="ck-ell">${esc(when(e.at))} · ${esc(e.user)}</span></td><td class="c-ans"><span class="ck-ell ck-name" title="${esc(cmd)}">${esc(cmd)}</span></td><td class="c-extra"><span class="ck-ell" title="${esc(what)}">${esc(what)}</span></td></tr>`;
  }).join("");
  const clear = entries.length ? `<button type="button" class="ck-btn small ck-js" data-ck-act="clearLog" data-ck-confirm="${esc(t("log_clear_confirm", { n: entries.length }))}" data-ck-yes="${esc(t("log_clear"))}" data-ck-no="${esc(t("cancel_btn"))}" data-ck-reload data-ck-fail="${esc(t("err_toggle"))}">${esc(t("log_clear"))}</button>` : "";
  const head = `<div class="ck-head"><h2 class="ck-title">${esc(t("log_title"))}</h2>${clear}</div><p class="ck-intro">${esc(t("log_help"))}</p>`;
  if (!entries.length) return { type: "html", html: `<div class="ck ck-log">${head}<p class="ck-intro">${esc(t("log_empty"))}</p></div>` };
  const sent = entries.filter((e) => e.result === "sent").length;
  return {
    type: "html",
    html: K.listShell({
      ctx, id: "log", className: "ck-log", head,
      columns: [{ label: t("log_time_user"), width: "24%" }, { label: t("col_command"), width: "20%" }, { label: t("log_why") }],
      rows,
      pills: [{ key: "result", label: t("log_filter"), items: [{ val: "all", label: t("filter_all"), count: entries.length }, { val: "sent", label: t("log_sent"), count: sent }, { val: "not", label: t("log_not_sent"), count: entries.length - sent }] }],
      groups: { result: { not: ["refused", "error"] } },
      text: { search: t("search_label"), placeholder: t("search_log"), empty: t("search_none"), clear: t("search_clear"), count: t("search_count") },
    }),
  };
}

export { norm };
