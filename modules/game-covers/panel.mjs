// L'administration du module : l'état de la clé (jamais sa valeur), la liste « Jaquettes à vérifier », les choix gardés et l'écran « Quel est le bon jeu ? ».
// Écran de correction : `?titre=<titre demandé>` (adresse stable : les modules qui affichent « Ce n'est pas le bon jeu ? » y renvoient), `&q=<autre recherche>`.
// Mobile d'abord : des blocs simples (titres, tableaux, formulaires) que le cœur met en page ; les jaquettes sont des images fixes, sans défilement.
const q = new URL(import.meta.url).search;
const { titleKey } = await import(new URL("./match.mjs" + q, import.meta.url).href);
const fx = await import(new URL("./fixes.mjs" + q, import.meta.url).href);
const rawg = await import(new URL("./rawg.mjs" + q, import.meta.url).href);
const ops = await import(new URL("./ops.mjs" + q, import.meta.url).href);
const { COL } = fx;

const PAGE = 25;
const SAVED = new Set(["game", "none", "confirm", "forgot", "tested"]);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const one = (v) => (Array.isArray(v) ? v[0] : v);
/** Un texte de Markdown : les signes qui casseraient un lien ou une liste sont protégés. */
const escMd = (s) => String(s ?? "").replace(/([\\`*_[\]<>])/g, "\\$1");
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const day = (ctx, iso) => { try { return new Date(iso).toLocaleDateString(ctx.locale, { day: "numeric", month: "long", year: "numeric" }); } catch { return String(iso).slice(0, 10); } };
const when = (ctx, iso) => { try { return new Date(iso).toLocaleString(ctx.locale); } catch { return String(iso).slice(0, 16).replace("T", " "); } };

/** Une jaquette : image fixe, avec un texte vide (le nom du jeu est juste à côté). */
const coverImg = (url, cls = "h-24 w-[4.5rem]") => url
  ? `<img src="${esc(url)}" alt="" width="72" height="96" loading="lazy" decoding="async" referrerpolicy="no-referrer" class="${cls} shrink-0 rounded-lg border border-line bg-bg object-cover">`
  : `<div aria-hidden="true" class="${cls} shrink-0 rounded-lg border border-dashed border-line bg-bg"></div>`;

/** Le texte du choix gardé : « Aucune jaquette », « Image choisie à la main » ou le nom du jeu. */
const choiceText = (ctx, f) => (f.kind === "none" ? ctx.t("kept_none") : f.kind === "image" ? ctx.t("kept_image") : f.name || ctx.t("kept_game"));

export async function render(ctx, { query } = {}) {
  const asked = String(one(query?.titre) ?? "");
  const title = asked ? ops.checkTitle(asked) : null;
  const saved = SAVED.has(String(one(query?.saved) ?? "")) ? String(one(query.saved)) : "";
  const out = [];
  if (saved) out.push({ type: "banner", tone: "success", text: ctx.t(`saved_${saved}`) });
  if (asked && !title) out.push({ type: "banner", tone: "warning", text: ctx.t("err_title") });
  if (title) return [...out, ...(await fixScreen(ctx, title, String(one(query?.q) ?? "").slice(0, 400)))];
  return [...out, ...(await listScreen(ctx, query))];
}

// ── La liste : clé, jaquettes à vérifier, choix gardés ─────────────────────────────────────────────────────────────────────
async function keyBlocks(ctx) {
  const { key, source } = await rawg.keyOf(ctx);
  const blocks = [{ type: "heading", text: ctx.t("key_title") }];
  if (!key) {
    blocks.push({ type: "banner", tone: "warning", text: ctx.t("key_none") }, { type: "markdown", text: ctx.t("guide") });
    return blocks;
  }
  blocks.push({ type: "banner", tone: "success", text: ctx.t("key_ok") });
  if (source === "adopted") blocks.push({ type: "markdown", text: ctx.t("key_adopted") }, { type: "adminForm", action: "forgetKey", submitLabel: ctx.t("forget_key"), fields: [] });
  const state = await rawg.readState(ctx);
  blocks.push({ type: "markdown", text: state ? ctx.t("last_check", { date: when(ctx, state.at), state: ctx.t(`state_${state.state}`) }) : ctx.t("never_checked") });
  blocks.push({ type: "adminForm", action: "testKey", submitLabel: ctx.t("test_key"), fields: [] });
  blocks.push({ type: "netHealth", items: [{ host: "api.rawg.io", label: ctx.t("health_label") }] });
  return blocks;
}

async function listScreen(ctx, query) {
  const out = [...(await keyBlocks(ctx))];
  const { key } = await rawg.keyOf(ctx);

  const todo = await fx.readToCheck(ctx);
  out.push({ type: "heading", text: ctx.t("todo_title") }, { type: "markdown", text: ctx.t(key ? "todo_intro" : "todo_intro_nokey") });
  if (!todo.length) out.push({ type: "markdown", text: ctx.t("todo_empty") });
  else {
    const shown = todo.slice(0, 25);
    out.push({
      type: "table", columns: [ctx.t("col_asked"), ctx.t("col_found"), ctx.t("col_seen")],
      rows: shown.map((d) => [d.title, d.name, day(ctx, d.at)]), rowIds: shown.map((d) => d.title),
      rowActions: [{ label: ctx.t("act_fix"), href: "?titre={id}" }, { label: ctx.t("act_good"), action: "confirm" }],
    });
    if (todo.length > shown.length) out.push({ type: "markdown", text: ctx.t("todo_more", { count: todo.length - shown.length }) });
  }

  const cursor = /^[A-Za-z0-9_=-]{1,300}$/.test(String(one(query?.cursor) ?? "")) ? String(one(query.cursor)) : undefined;
  const total = await fx.countFixes(ctx);
  const kept = await fx.listFixes(ctx, { cursor, size: PAGE });
  out.push({ type: "heading", text: ctx.t("kept_title") }, { type: "markdown", text: ctx.t("kept_help") });
  if (!kept.items.length) out.push({ type: "markdown", text: ctx.t(total ? "kept_end" : "kept_empty") });
  else {
    out.push({
      type: "table", columns: [ctx.t("col_asked"), ctx.t("col_choice"), ctx.t("col_date")],
      rows: kept.items.map((f) => [f.title, choiceText(ctx, f), day(ctx, f.at)]), rowIds: kept.items.map((f) => f.title),
      rowActions: [{ label: ctx.t("act_change"), href: "?titre={id}" }, { label: ctx.t("act_forget"), action: "forget", confirm: ctx.t("forget_confirm") }],
    });
    const links = [cursor ? `[${ctx.t("kept_first")}](?)` : "", kept.next ? `[${ctx.t("kept_next")}](?cursor=${enc(kept.next)})` : ""].filter(Boolean);
    if (links.length) out.push({ type: "markdown", text: links.join(" · ") });
  }
  if (total > 0) {
    out.push({
      type: "adminForm", action: "forgetAll", submitLabel: ctx.t("forget_all"),
      fields: [{ name: "confirm", kind: "checkbox", label: ctx.t("forget_all_confirm", { count: total }), required: true }],
    });
  }
  return out;
}

// ── « Quel est le bon jeu ? » ─────────────────────────────────────────────────────────────────────────────────────────────
async function fixScreen(ctx, title, search) {
  const key = titleKey(title);
  const saved = await fx.fixFor(ctx, title);
  const doubtful = (await fx.readToCheck(ctx)).find((d) => d.key === key);
  const { key: apiKey } = await rawg.keyOf(ctx);
  const tooLong = search.trim().length > 100;
  const list = apiKey && !tooLong ? await ops.candidatesFor(ctx, "admin", title, search.trim() || undefined) : null;
  const current = saved
    ? { url: saved.img ? fx.rawgImageUrl(saved.img) : null, label: choiceText(ctx, saved), id: saved.rawgId, isSaved: true }
    : doubtful ? { url: fx.rawgImageUrl(doubtful.img), label: doubtful.name, id: doubtful.rawgId, isSaved: false } : null;

  const out = [
    { type: "markdown", text: `[${ctx.t("back")}](?)` },
    { type: "heading", text: ctx.t("which") },
    { type: "markdown", text: ctx.t("which_intro") },
    { type: "html", html: `<section class="rounded-2xl border border-line bg-surface p-5 space-y-3"><p class="text-sm text-muted break-words">${esc(ctx.t("asked"))}</p><p class="text-xl font-semibold break-words" data-testid="asked">${esc(title)}</p>` +
      (current ? `<div class="flex items-center gap-3" data-testid="current">${coverImg(current.url, "h-16 w-12")}<p class="min-w-0 break-words text-sm"><span class="text-muted">${esc(ctx.t(current.isSaved ? "current_saved" : "current_auto"))}</span><br>${esc(current.label)}</p></div>` : "") + `</section>` },
  ];
  if (!apiKey) out.push({ type: "banner", tone: "warning", text: ctx.t("err_no_key") });
  if (!saved && doubtful) out.push({ type: "adminForm", action: "confirm", submitLabel: ctx.t("act_good"), fields: [{ name: "id", kind: "hidden", value: title }] });

  out.push({
    type: "adminForm", action: "search", submitLabel: ctx.t("search_button"), title: ctx.t("search_label"),
    fields: [{ name: "id", kind: "hidden", value: title }, { name: "q", label: ctx.t("search_label"), value: search, help: ctx.t("search_help") }],
  });
  if (tooLong) out.push({ type: "banner", tone: "warning", text: ctx.t("err_search") });

  out.push({ type: "heading", text: ctx.t("candidates") });
  if (list && list.status !== "found") out.push({ type: "markdown", text: ctx.t(`status_${list.status === "no-key" ? "no_key" : list.status}`) });
  if (list?.status === "found") {
    out.push({
      type: "html",
      html: `<ul class="grid gap-3 sm:grid-cols-2" data-testid="candidates">${list.candidates.map((c, i) =>
        `<li class="flex gap-4 rounded-2xl border border-line bg-surface p-4" data-testid="candidate">${coverImg(c.url)}<div class="min-w-0 space-y-1"><p class="font-semibold break-words">${i + 1}. ${esc(c.name)}</p>` +
        `<p class="text-sm text-muted">${esc(c.year ? ctx.t("year", { year: c.year }) : ctx.t("year_unknown"))}</p>` +
        `<p class="text-sm text-muted break-words">${esc(c.platforms.length ? ctx.t("platforms", { list: c.platforms.join(", ") }) : ctx.t("platforms_unknown"))}</p>` +
        (current?.id === c.id ? `<p><span class="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-700">${esc(ctx.t("is_current"))}</span></p>` : "") +
        `</div></li>`).join("")}</ul>`,
    });
    // Les boutons : l'identifiant de la ligne porte le jeu, le titre et la recherche (le bouton de ligne n'envoie que cet identifiant).
    out.push({
      type: "table", columns: ["#", ctx.t("col_game")], rows: list.candidates.map((c, i) => [String(i + 1), `${c.name}${c.year ? ` (${c.year})` : ""}`]),
      rowIds: list.candidates.map((c) => `${c.id}|${enc(title)}|${enc(search.trim().slice(0, 100))}`),
      rowActions: [{ label: ctx.t("choose"), action: "choose" }],
    });
  }
  out.push({ type: "heading", text: ctx.t("none_title") }, { type: "markdown", text: ctx.t("none_help") },
    { type: "adminForm", action: "chooseNone", submitLabel: ctx.t("none_button"), fields: [{ name: "id", kind: "hidden", value: title }] });
  return out;
}

// ── Actions ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const who = "admin";
const back = (saved) => ({ redirect: `?saved=${saved}` });
const fail = (ctx, error) => ({ error: ctx.t(`err_${String(error).replace("-", "_")}`) });

export const actions = {
  /** « Tester la clé » */
  async testKey(ctx) {
    const result = await rawg.checkKey(ctx);
    if (result === "ok") return { ok: ctx.t("test_ok"), redirect: "?saved=tested" };
    return { error: ctx.t(`test_${String(result).replace("-", "_")}`) };
  },
  /** Oublie la clé reprise du site (celle des Réglages de cette page n'est pas touchée). */
  async forgetKey(ctx) {
    await fx.removeOne(ctx, COL.key);
    await rawg.forgetState(ctx);
    rawg.clearCache();
    return { ok: ctx.t("forgot_key"), redirect: "?" };
  },
  /** Un titre à chercher sous un autre nom : on revient sur l'écran de correction avec `&q=`. */
  async search(ctx, values) {
    const title = ops.checkTitle(values?.id);
    if (!title) return { error: ctx.t("err_title") };
    const text = String(values?.q ?? "").trim();
    if (text.length > 100) return { errors: { q: ctx.t("err_search") } };
    return { redirect: `?titre=${enc(title)}${text ? `&q=${enc(text)}` : ""}` };
  },
  /** « C'est ce jeu » : l'identifiant de ligne = `<numéro RAWG>|<titre>|<recherche>`. */
  async choose(ctx, values) {
    const [id, title, search] = String(values?.id ?? "").slice(0, 900).split("|");
    const out = await ops.chooseGame(ctx, who, decodeURIComponentSafe(title), Number(id), decodeURIComponentSafe(search) || undefined);
    return out.ok ? back("game") : fail(ctx, out.error);
  },
  async chooseNone(ctx, values) {
    const out = await ops.chooseNone(ctx, who, String(values?.id ?? ""));
    return out.ok ? back("none") : fail(ctx, out.error);
  },
  /** « Ce choix est bon » : on garde le jeu trouvé tel quel. */
  async confirm(ctx, values) {
    const out = await ops.confirmCurrent(ctx, who, String(values?.id ?? ""));
    return out.ok ? back("confirm") : fail(ctx, out.error);
  },
  /** « Oublier » : le titre retrouve le choix automatique. */
  async forget(ctx, values) {
    const title = ops.checkTitle(String(values?.id ?? ""));
    if (!title || !(await ops.forget(ctx, who, titleKey(title)))) return { error: ctx.t("err_forget") };
    return back("forgot");
  },
  async forgetAll(ctx, values) {
    if (values?.confirm !== "on") return { errors: { confirm: ctx.t("err_confirm") } };
    const n = await ops.forgetAll(ctx, who);
    return n === null ? { error: ctx.t("err_rate") } : back("forgot");
  },
};

function decodeURIComponentSafe(v) {
  try { return decodeURIComponent(String(v ?? "")); } catch { return ""; }
}
