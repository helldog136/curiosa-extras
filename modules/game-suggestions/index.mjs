// Suggestions de jeux — module communautaire de Curiosa. Porté de l'ancien site.
//
// Le public propose un jeu (liste publique, statut « proposé ») ; l'administrateur le fait avancer (planifié, accepté, déjà joué, fini…).
// Sur les jeux « déjà joués », le public vote « rejoue-le » : N votes par mois et par visiteur (un cookie + une mémoire côté serveur).
// La jaquette vient du module « Jaquettes de jeux » (service `game.cover`, besoin facultatif) — au mieux : sans clé, la suggestion n'a simplement pas d'image.
// La clé RAWG se saisit UNE seule fois, dans le module « Jaquettes de jeux » (jamais dans celui-ci) ; tant qu'elle manque, l'admin du module le dit avec un lien. Un site qui avait déjà sa clé n'a rien à refaire :
// le cœur installe « Jaquettes de jeux » et lui confie la clé tout seul, et en attendant l'ancienne interface du cœur (`ctx.api.rawg`, permission `rawg`) sert de repli.
// Le module n'appelle jamais RAWG lui-même. L'ancienne clé qu'il pouvait garder (`legacySettings`, jamais affichée) n'est plus lue : elle est effacée dès qu'une clé est réglée sur le site.
// L'administration peut aussi ajouter elle-même un jeu (ou une liste, un par ligne) : même liste, mêmes statuts, même jaquette automatique ; la ligne porte `origin: "admin"`
// (les lignes d'avant n'ont pas ce champ : elles valent « visiteur »), sans pseudo, et reste hors de la page publique tant que son statut est « rejeté ».
// Une suggestion restée sans jaquette (migrée, restaurée d'une sauvegarde, créée pendant une panne de RAWG) est rattrapée plus tard :
// une tâche du cœur en traite quelques-unes à la fois, et un bouton de l'admin lance la même opération tout de suite. Tout ce qui
// sert à ne pas marteler RAWG (date et résultat de chaque essai) est écrit dans les données de l'instance : rien ne vit en mémoire seulement.
const v = new URL(import.meta.url).search; // la version du module se propage au fichier voisin (sinon l'ancien code resterait en cache après une mise à jour)
const overlay = await import(`./overlay.mjs${v}`); // l'élément « Top des jeux proposés » des pages d'overlay (cœur 0.5.0) : seulement ce que la page publique montre
const COLLECTION = "games";
const STATE = "state";                // un seul document : dernière recherche de jaquettes, pause éventuelle
const STATUSES = ["proposed", "planned", "accepted", "rejected", "already_played", "finished"];
const PUBLIC = ["proposed", "planned", "accepted", "already_played", "finished"];   // « rejeté » n'est pas public
const MAX_STORED = 2000;
const TITLE_MAX = 100;                // longueur d'un nom de jeu (visiteur comme administration)
const NOTE_MAX = 280;
const MAX_BATCH = 50;                 // jeux ajoutés d'un coup par l'administration (une ligne = un jeu)
const INLINE_COVERS = 10;             // jaquettes cherchées pendant un ajout en lot ; le reste est rattrapé par la tâche (5 toutes les 15 min) ou par le bouton de l'admin
const PAGE_SIZE = 50;                 // lignes du tableau d'admin par page
const ADD_ORDER = ["already_played", "finished", "planned", "accepted", "proposed", "rejected"];   // ordre des choix du formulaire d'ajout (« déjà joué » d'abord)
const HOUR = 3_600_000;
const MONTH = 30 * 24 * HOUR;
const COOKIE = "vh_gs_votes";
const STATUS_TONE = { proposed: "warn", planned: "info", accepted: "ok", rejected: "danger", already_played: "accent", finished: "neutral" };   // une pastille colorée ET écrite (le texte dit toujours le statut)

const escMd = (s) => String(s).replace(/([\\`*_[\]<>])/g, "\\$1");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const clean = (v, max, multiline = false) => {
  let t = String(v ?? "").normalize("NFC").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029‪-‮⁦-⁩]/g, "");
  t = multiline ? t.replace(/\n{3,}/g, "\n\n") : t.replace(/\s+/g, " ");
  return t.trim().slice(0, max);
};
const num = (v, def, min, max) => { const n = Number(v); return v === undefined || v === null || v === "" || !Number.isFinite(n) ? def : Math.min(max, Math.max(min, Math.trunc(n))); };
const safeHttps = (v) => (typeof v === "string" && /^https:\/\//.test(v) ? v : null);
// Dernière entrée de l'en-tête : celle qu'ajoute le relais de confiance (le début vient du visiteur et peut être inventé).
// Empreinte du visiteur fournie par le cœur (0.2.6) : adresse de confiance, salée, jamais gardée en clair.
const whoOf = (request, ctx, scope) => ctx.api.visitor.fingerprint(request, scope);
export const isStatus = (v) => STATUSES.includes(v);

const memory = new Map();           // limiteurs en mémoire : un garde-fou, pas un pare-feu
function limited(bucket, max, windowMs, now = Date.now()) {
  const recent = (memory.get(bucket) ?? []).filter((t) => now - t < windowMs);
  recent.push(now); memory.set(bucket, recent);
  if (memory.size > 5000) for (const [k, v] of memory) if (!v.some((t) => now - t < MONTH)) memory.delete(k);
  return recent.length > max;
}

const SVC_STATUS = { found: "found", none: "none", "no-key": "no_key", refused: "denied", unreachable: "down" };   // statuts du service → ceux de ce module
const coreRawg = (ctx) => (ctx.api?.rawg && typeof ctx.api.rawg.cover === "function" ? ctx.api.rawg : null);

/**
 * Le service de jaquettes est le module « Jaquettes de jeux » (service `game.cover`, besoin facultatif). Rend `null` quand il n'est pas là, sinon `{ ok, value | reason }`.
 * À défaut du module, ou quand il n'a pas (encore) de clé, on retombe sur l'ancienne interface du cœur (`ctx.api.rawg`, permission `rawg`, cale à retirer en 0.3.0) :
 * un site dont le cœur garde encore la clé ne perd donc aucune jaquette entre deux mises à jour.
 */
const viaModule = async (ctx, method, args) => {
  try { return (await ctx.api?.services?.call?.("game.cover", method, args)) ?? null; } catch { return null; }
};

/** Une clé RAWG est-elle réglée sur le site ? Ne lève jamais. */
export async function hasKey(ctx) {
  const m = await viaModule(ctx, "status", {});
  if (m?.ok && m.value?.configured === true) return true;
  const svc = coreRawg(ctx);
  if (!svc) return false;
  try { return !!(await svc.configured()); } catch { return false; }
}

/** Cherche une jaquette (statuts du service traduits : found · none · no_key · denied · down). Jamais d'exception. */
export async function coverFor(ctx, title) {
  let r;
  const m = await viaModule(ctx, "cover", { title });
  if (m?.ok && m.value && m.value.status !== "no-key") r = m.value;                       // le module a répondu
  else if (m && !m.ok && m.reason === "failed") return { status: "down", url: null };    // le module est en panne : pas de repli, il garde la clé
  else {
    const svc = coreRawg(ctx);
    if (!svc) return { status: "no_key", url: null };
    try { r = await svc.cover(title); } catch { return { status: "down", url: null }; }
  }
  const status = SVC_STATUS[r?.status] ?? "down";
  const url = status === "found" ? safeHttps(r.url) : null;
  if (status === "found" && !url) return { status: "none", url: null };
  // `ambiguous` : le jeu trouvé n'est peut-être pas le bon ; ajouté seulement quand il est vrai.
  return { status, url, ...(status === "found" && r?.ambiguous === true ? { ambiguous: true } : {}) };
}

/** Où saisir la clé : l'écran du module « Jaquettes de jeux » s'il est installé, sinon une proposition de l'installer (jamais installé sans un clic du propriétaire). */
async function keySetupBlocks(ctx) {
  let path = "";
  try { path = (await ctx.api?.instances?.list?.({ module: "game-covers" }))?.[0]?.adminPath ?? ""; } catch { path = ""; }
  return path
    ? [{ type: "banner", tone: "warning", text: ctx.t("rawgBanner") }, { type: "markdown", text: `[${ctx.t("rawgOpenSettings")}](${path})` }]
    : [{ type: "banner", tone: "warning", text: ctx.t("rawgBanner") }, { type: "suggestInstall", service: "game.cover", reason: ctx.t("rawgSuggestReason") }];
}

/* ───────────── Rattrapage des jaquettes manquantes ───────────── */

const DAY = 24 * HOUR;
const AUTO_BATCH = 5;                         // titres traités par passage de la tâche
const MANUAL_BATCH = 25;                      // titres traités par clic sur le bouton de l'admin
const RETRY_AFTER_DAYS = [3, 7, 14, 30];      // délai avant le nouvel essai d'un titre sans résultat, selon le nombre d'essais déjà faits
const MAX_TRIES = RETRY_AFTER_DAYS.length + 1; // au-delà, la tâche renonce (le bouton de l'admin peut encore réessayer)
const PAUSE_MS = 400;                         // petite pause entre deux demandes à RAWG
const PAUSE_DENIED = DAY;                     // clé refusée : la tâche ne réessaie pas avant 24 h (le bouton de l'admin passe outre)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readState(ctx) { const [row] = await ctx.api.store.list(STATE, { limit: 1 }); return row ? { id: row.id, ...row.data } : null; }
async function writeState(ctx, prev, data) {
  if (prev?.id) await ctx.api.store.update(prev.id, data); else await ctx.api.store.add(STATE, data);
}

/**
 * « Époque » des essais : les titres déjà essayés à une autre époque sont de nouveau dus tout de suite. La clé est invisible pour le module :
 * l'époque change quand la dernière recherche s'était arrêtée faute de clé ou clé refusée (donc dès que la situation a pu changer).
 */
async function epochOf(ctx, state, now) {
  return state && (state.lastStatus === "no_key" || state.lastStatus === "denied") ? `e${now}` : state?.epoch ?? "core";
}
export const currentEpoch = async (ctx) => epochOf(ctx, await readState(ctx), Date.now());

/** Une suggestion sans jaquette est-elle « due » pour la tâche automatique ? Jamais essayée, époque changée, ou délai écoulé (et plafond non atteint). */
function isDue(data, fp, now) {
  if (data.coverKey !== fp) return true;
  const tries = Number(data.coverTries) || 0;
  if (tries >= MAX_TRIES) return false;
  const checked = Date.parse(data.coverCheckedAt ?? "");
  return !Number.isFinite(checked) || now - checked >= RETRY_AFTER_DAYS[Math.min(Math.max(tries, 1), RETRY_AFTER_DAYS.length) - 1] * DAY;
}

/**
 * Cherche les jaquettes manquantes, quelques titres à la fois. `force` : le bouton de l'admin (ignore les délais, 25 titres).
 * Ne lève jamais à cause de RAWG ; s'arrête dès que RAWG refuse la clé ou ne répond pas.
 * Renvoie { status, found, none, left, missing } — status : nothing · no_key · denied · down · done.
 */
export async function catchUpCovers(ctx, { force = false, now = Date.now(), pauseMs = PAUSE_MS } = {}) {
  const report = { status: "done", found: 0, none: 0, left: 0, missing: 0 };
  const missing = (await ctx.api.store.list(COLLECTION, { limit: MAX_STORED })).filter((r) => !safeHttps(r.data.coverUrl) && String(r.data.title ?? "").trim());
  report.missing = missing.length;
  if (!missing.length) return { ...report, status: "nothing" };
  const state = await readState(ctx);
  if (!(await hasKey(ctx))) {
    if (state?.lastStatus !== "no_key") await writeState(ctx, state, { ...state, id: undefined, epoch: state?.epoch, pausedFor: undefined, pausedUntil: undefined, lastRunAt: new Date(now).toISOString(), lastStatus: "no_key", lastFound: 0, lastNone: 0 });
    return { ...report, status: "no_key", left: missing.length };
  }
  const paused = state && Date.parse(state.pausedUntil ?? "") > now;
  if (!force && paused) return { ...report, status: "denied", left: missing.length };
  const fp = await epochOf(ctx, state, now);

  const due = (force ? missing : missing.filter((r) => isDue(r.data, fp, now)))
    .sort((a, b) => (Date.parse(a.data.coverCheckedAt ?? "") || 0) - (Date.parse(b.data.coverCheckedAt ?? "") || 0));
  const batch = due.slice(0, force ? MANUAL_BATCH : AUTO_BATCH);
  let stop = null;
  for (const [i, row] of batch.entries()) {
    if (i > 0 && pauseMs > 0) await sleep(pauseMs);
    const res = await coverFor(ctx, row.data.title);
    if (res.status !== "found" && res.status !== "none") { stop = res.status; break; }
    const fresh = await ctx.api.store.get(row.id);          // relit : un vote arrivé entre-temps ne doit pas être écrasé
    if (!fresh) continue;
    const tries = fresh.data.coverKey === fp ? Number(fresh.data.coverTries) || 0 : 0;
    await ctx.api.store.update(row.id, { ...fresh.data, ...(res.url ? { coverUrl: res.url } : {}), ...(res.ambiguous ? { coverAmbiguous: true } : {}), coverCheckedAt: new Date(now).toISOString(), coverResult: res.status, coverKey: fp, coverTries: tries + 1 });
    report[res.status === "found" ? "found" : "none"]++;
  }
  report.left = due.length - report.found - report.none;
  if (stop) report.status = stop;
  await writeState(ctx, state, {
    epoch: fp, lastRunAt: new Date(now).toISOString(), lastStatus: report.status, lastFound: report.found, lastNone: report.none,
    ...(stop === "denied" ? { pausedFor: stop, pausedUntil: new Date(now + PAUSE_DENIED).toISOString() } : {}),
  });
  return report;
}

/**
 * Efface l'ancienne clé RAWG de ce module (`legacySettings`) quand le site a sa clé : la valeur n'est jamais lue pour être utilisée, ni affichée, ni journalisée.
 * Ne lève jamais (la tâche et la migration ne doivent pas échouer pour si peu). Renvoie vrai si une clé a été effacée.
 */
export async function dropOldKey(ctx) {
  try {
    if (!ctx.legacy || !ctx.legacy.keys().includes("rawgApiKey")) return false;
    if (!(await hasKey(ctx))) return false;
    if ((await ctx.legacy.get("rawgApiKey")) === null) return false;
    await ctx.legacy.clear("rawgApiKey");
    return true;
  } catch { return false; }
}

const rows = async (ctx, limit = 1000) => (await ctx.api.store.list(COLLECTION, { limit })).map((r) => ({
  id: r.id, at: r.createdAt, title: String(r.data.title ?? ""), status: isStatus(r.data.status) ? r.data.status : "proposed", origin: r.data.origin === "admin" ? "admin" : "visitor",
  cover: safeHttps(r.data.coverUrl), ambiguous: r.data.coverAmbiguous === true && !!safeHttps(r.data.coverUrl), by: String(r.data.submitterName ?? ""), note: String(r.data.note ?? ""), votes: Number(r.data.replayVotes) || 0,
}));

/** Les suggestions que montre la page publique (tout sauf « rejeté »). UNE seule définition, pour la page et pour l'élément d'overlay : l'élément ne montre jamais plus que la page. */
const publicRows = async (ctx) => (await rows(ctx)).filter((g) => PUBLIC.includes(g.status));

/** Lien stable du cœur vers l'écran de correction d'une jaquette (administration seulement). Le titre est encodé, et les signes qui casseraient un lien Markdown aussi. */
export const wrongCoverHref = (title) => `/admin/settings/rawg-covers?titre=${encodeURIComponent(title).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;

/**
 * Les jaquettes douteuses (`coverAmbiguous`) sont redemandées au cœur quand l'admin s'ouvre : si la propriétaire a corrigé le choix, la nouvelle jaquette remplace l'ancienne
 * et la mention disparaît. Au plus 10 titres par ouverture, jamais d'exception ; les réponses d'erreur ne changent rien.
 */
export async function refreshAmbiguous(ctx, list) {
  const todo = list.filter((g) => g.ambiguous).slice(0, 10);
  for (const g of todo) {
    const res = await coverFor(ctx, g.title);
    if (res.status !== "found" && res.status !== "none") continue;
    if (res.ambiguous) continue;
    const fresh = await ctx.api.store.get(g.id);
    if (!fresh) continue;
    const { coverAmbiguous, ...rest } = fresh.data;
    await ctx.api.store.update(g.id, { ...rest, coverUrl: res.url ?? null, coverResult: res.status });
    g.ambiguous = false; g.cover = res.url ?? "";
  }
}

/* ───────────── Ajout par l'administration ───────────── */

/** Clé de comparaison des titres : sans accents, sans majuscules, sans espaces ni ponctuation (« Pokémon  : Rouge ! » = « pokemon rouge »). */
export const titleKey = (title) => {
  const t = String(title ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return t.replace(/[^\p{L}\p{N}]+/gu, "") || t.trim();
};
/** Une adresse d'image à la main : https seulement, sans espace ni signe qui casserait une page, 500 caractères au plus. Rend l'adresse ou `null`. */
export const imageUrlOf = (v) => { const t = String(v ?? "").trim(); return t.length <= 500 && /^https:\/\/[^\s"'<>\\]+$/.test(t) ? t : null; };
/** Les lignes d'une liste collée : une ligne = un jeu, puces au début retirées, lignes vides ignorées. */
export const linesOf = (text) => String(text ?? "").split(/\r\n?|\n/).map((l) => l.replace(/^\s*[-*•]\s+/, "")).map((l) => clean(l, 100_000)).filter(Boolean);
const plural = (ctx, key, n, vars = {}) => ctx.t(n === 1 ? `${key}_one` : key, { n, ...vars });

/**
 * Ajoute à la liste des jeux écrits par l'administration (un seul, ou une liste d'au plus 50). Tout ou rien : à la moindre ligne à corriger, rien n'est enregistré.
 * `lines` : les noms ; `field` : le champ du formulaire où afficher l'erreur (`title` ou `titles`). Ne lève jamais à cause du service de jaquettes.
 * Rend `{ errors }` (par champ), `{ error }` (général) ou `{ added, found, titles, status }`.
 */
export async function addGames(ctx, { lines, status, note = "", image = "", field = "title" }) {
  const many = field === "titles";
  const errors = {};
  const st = status ? String(status) : "already_played";
  if (!isStatus(st)) errors.status = ctx.t("errStatus");
  const cleanNote = clean(note, 10_000, true);
  if (cleanNote.length > NOTE_MAX) errors.note = ctx.t("errNoteLong", { max: NOTE_MAX });
  const rawImage = String(image ?? "").trim();
  const manualImage = rawImage ? imageUrlOf(rawImage) : null;
  if (rawImage && !manualImage) errors.image = ctx.t("errImage");
  if (!lines.length) errors[field] = ctx.t(many ? "errManyEmpty" : "errTitleEmpty");
  else if (lines.length > MAX_BATCH) errors[field] = ctx.t("errManyTooMany", { n: lines.length, max: MAX_BATCH });
  if (!errors[field]) {
    const existing = new Map();
    for (const g of await rows(ctx, MAX_STORED)) if (!existing.has(titleKey(g.title))) existing.set(titleKey(g.title), g);
    const seen = new Map();
    const problems = [];
    lines.forEach((title, i) => {
      const n = i + 1, at = (msg) => (many ? ctx.t("errManyLine", { n, problem: msg }) : msg);
      const key = titleKey(title);
      if (title.length > TITLE_MAX) problems.push(at(ctx.t(many ? "errLongShort" : "errTitleLong", { max: TITLE_MAX })));
      else if (existing.has(key)) problems.push(at(ctx.t("errDup", { title: existing.get(key).title, status: ctx.t(`status_${existing.get(key).status}`) })));
      else if (seen.has(key)) problems.push(at(ctx.t("errSame", { title, first: seen.get(key) })));
      else seen.set(key, n);
    });
    if (problems.length) errors[field] = many ? `${ctx.t("errManyIntro")} ${problems.slice(0, 5).join(" ")}${problems.length > 5 ? " " + plural(ctx, "errManyMore", problems.length - 5) : ""} ${ctx.t("errManyOutro")}` : problems[0];
  }
  if (Object.keys(errors).length) return { errors };
  const room = MAX_STORED - (await ctx.api.store.count(COLLECTION));
  if (room <= 0) return { error: ctx.t("errFull", { max: MAX_STORED }) };
  if (lines.length > room) return { errors: { [field]: plural(ctx, "errRoom", room, { max: MAX_STORED }) } };

  const now = new Date().toISOString();
  let found = 0, searched = 0, stop = false, first = manualImage ? "manual" : "later";
  for (const [i, title] of lines.entries()) {
    let data = { title, status: st, coverUrl: null, origin: "admin", submitterName: null, note: many ? null : cleanNote || null, replayVotes: 0, lastVotedAt: null };
    if (manualImage) data = { ...data, coverUrl: manualImage, coverResult: "manual", coverCheckedAt: now };
    else if (!stop && searched < (many ? INLINE_COVERS : 1)) {
      searched++;
      const res = await coverFor(ctx, title);
      // Réponse claire (jaquette ou « inconnu ») : mémorisée. Panne, clé absente ou refusée : on arrête de chercher, la tâche de rattrapage prendra la suite.
      if (res.status === "found" || res.status === "none") data = { ...data, coverUrl: res.url, coverCheckedAt: now, coverResult: res.status, coverKey: await currentEpoch(ctx), coverTries: 1, ...(res.ambiguous ? { coverAmbiguous: true } : {}) };
      else stop = true;
      if (res.url) found++;
      if (i === 0) first = stop ? "later" : res.url ? "found" : "none";
    }
    await ctx.api.store.add(COLLECTION, data);
  }
  return { added: lines.length, found, titles: lines, status: st, cover: first };
}

/** Le bilan d'un ajout en mots simples (pour le message vert de l'administration). */
function addedMessage(ctx, r) {
  const status = ctx.t(`status_${r.status}`);
  if (r.added === 1) return `${ctx.t("okAdded", { title: r.titles[0], status })} ${ctx.t({ manual: "coverManual", found: "coverFound", none: "coverNone", later: "coverLater" }[r.cover])}`;
  return `${ctx.t("okAddedMany", { n: r.added, status })} ${ctx.t("coversFoundMany", { found: r.found })}`;
}
const firstError = (r) => r.error ?? Object.values(r.errors ?? {})[0];

/* ───────────── Écrans de l'administration : ajout, jaquette d'une ligne, pages ───────────── */

const adminLink = (href, label, current = false) => `<a href="${esc(href)}"${current ? ' aria-current="page"' : ""} style="display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border:1px solid currentColor;border-radius:10px;text-decoration:none;color:inherit">${esc(label)}</a>`;
const linkRow = (html) => ({ type: "html", html: `<nav style="display:flex;flex-wrap:wrap;gap:8px">${html}</nav>` });

/** « Ajouter un jeu » : le nom et le statut ; la note et l'image, rares, sont repliées sous « Plus d'options ». Une variante derrière un lien : plusieurs jeux d'un coup. */
function addBlocks(ctx, mode) {
  const statusField = { name: "status", label: ctx.t("addStatusLabel"), kind: "select", value: "already_played", help: ctx.t("addStatusHelp"), options: ADD_ORDER.map((s) => ({ value: s, label: ctx.t(`status_${s}`) })) };
  if (mode === "plusieurs") {
    return [
      { type: "adminForm", action: "addGames", title: ctx.t("manyTitle"), submitLabel: ctx.t("manySubmit"), fields: [{ name: "titles", label: ctx.t("manyLabel"), kind: "textarea", required: true, help: ctx.t("manyHelp", { max: MAX_BATCH }), example: ctx.t("manyExample") }, statusField] },
      linkRow(adminLink("?tab=use", ctx.t("linkOne"))),
    ];
  }
  return [
    {
      type: "adminForm", action: "addGame", title: ctx.t("addTitle"), submitLabel: ctx.t("addSubmit"),
      fields: [
        { name: "title", label: ctx.t("addGameLabel"), required: true, example: ctx.t("addGameExample") },
        statusField,
        { name: "note", label: ctx.t("addNoteLabel"), kind: "textarea", folded: true, help: ctx.t("addNoteHelp"), example: ctx.t("addNoteExample") },
        { name: "image", label: ctx.t("addImageLabel"), kind: "url", folded: true, help: ctx.t("addImageHelp"), example: ctx.t("addImageExample") },
      ],
    },
    linkRow(adminLink("?tab=use&ajout=plusieurs", ctx.t("linkMany"))),
  ];
}

/** L'écran « Jaquette » d'une ligne : choisir le bon jeu (écran du module de jaquettes) ou donner soi-même l'adresse d'une image. */
function coverScreen(ctx, g) {
  return [
    { type: "heading", text: ctx.t("coverScreenTitle", { title: g.title }) },
    { type: "markdown", text: `${ctx.t(g.cover ? "coverStateHas" : "coverStateNone")}\n\n[${ctx.t("coverWrong")}](${wrongCoverHref(g.title)})` },
    { type: "adminForm", action: "setImage", title: ctx.t("imageTitle"), submitLabel: ctx.t("imageSubmit"), fields: [{ name: "id", kind: "hidden", value: g.id }, { name: "image", label: ctx.t("imageLabel"), kind: "url", required: true, help: ctx.t("addImageHelp"), example: ctx.t("addImageExample") }] },
    linkRow(adminLink("?tab=use", ctx.t("backToList"))),
  ];
}

const baseHref = (ctx) => { const b = ctx.instance.basePath; return b === null || b === undefined ? "/" : b ? `/${b}` : "/"; };

function card(ctx, g) {
  const cover = g.cover ? `<img src="${esc(g.cover)}" alt="" loading="lazy" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:8px;margin-bottom:8px">` : "";
  const vote = g.status === "already_played"
    ? `<form method="post" action="/m/${esc(ctx.instance.key)}/vote" style="margin:8px 0 0"><input type="hidden" name="id" value="${esc(g.id)}"><button style="cursor:pointer;border:1px solid var(--v-line);border-radius:8px;padding:4px 10px;background:transparent;color:var(--v-fg)">🔁 ${esc(ctx.t("replay", { n: g.votes }))}</button></form>`
    : "";
  return `<article style="padding:12px;border:1px solid var(--v-line);border-radius:12px;background:var(--v-surface)">${cover}<h3 style="margin:0;font-size:1.05em">${esc(g.title)}</h3>` +
    `<p style="margin:4px 0 0;font-size:.85em;color:var(--v-muted)">${esc(ctx.t(`status_${g.status}`))}${g.by ? ` · ${esc(ctx.t("by", { name: g.by }))}` : ""}</p>` +
    (g.note ? `<p style="margin:6px 0 0;white-space:pre-wrap;overflow-wrap:anywhere">${esc(g.note)}</p>` : "") + vote + `</article>`;
}

export default {
  // L'élément « Top des jeux proposés » des pages d'overlay : une adresse publique sans secret (elle ne rend que ce que la page publique montre).
  overlayElements: Object.fromEntries(overlay.ELEMENTS.map((id) => [id, (ctx, request) => overlay.elementAddress(ctx, id, request)])),

  // /suggestions → tous (sauf rejetés) · /suggestions/<statut> → un statut
  async page(ctx, { segments }) {
    let filter = null;
    if (segments.length === 1 && PUBLIC.includes(segments[0])) filter = segments[0];
    else if (segments.length > 0) return { notFound: true, blocks: [] };

    const list = (await publicRows(ctx)).filter((g) => !filter || g.status === filter);
    const base = baseHref(ctx) === "/" ? "" : baseHref(ctx);
    const blocks = [];
    if (ctx.setting("intro")) blocks.push({ type: "markdown", text: String(ctx.setting("intro")) });
    blocks.push({ type: "links", items: [{ label: ctx.t("all"), href: base || "/" }, ...PUBLIC.map((s) => ({ label: ctx.t(`status_${s}`), href: `${base}/${s}` }))] });
    blocks.push({ type: "heading", text: ctx.t("formTitle") }, {
      type: "form", action: `${ctx.instance.key}/suggest`, submitLabel: ctx.t("formSubmit"), successText: ctx.t("thanks"),
      fields: [{ name: "title", label: ctx.t("formGame"), required: true }, { name: "name", label: ctx.t("formName") }, { name: "note", label: ctx.t("formNote"), kind: "textarea" }],
    });
    blocks.push(list.length ? { type: "html", html: `<div style="display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(240px,1fr))">${list.map((g) => card(ctx, g)).join("")}</div>` } : { type: "markdown", text: ctx.t("empty") });
    return { title: ctx.setting("title") || ctx.t("pageTitle"), blocks };
  },

  routes: {
    "element/:slug": (request, ctx) => overlay.elementResponse(request, ctx, publicRows),   // la page de l'élément (voir overlay.mjs)

    async suggest(request, ctx) {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
      if (limited(`s|${ctx.instance.key}|${whoOf(request, ctx, "suggest")}`, num(ctx.setting("rateLimit"), 5, 1, 100), HOUR)) return Response.json({ ok: false }, { status: 429 });
      let form; try { form = await request.formData(); } catch { return Response.json({ ok: false }, { status: 400 }); }
      if (String(form.get("website") ?? "")) return Response.json({ ok: true });          // piège à robots
      const title = clean(form.get("title"), 100);
      const note = clean(form.get("note"), 280, true);
      if (!title || (note.match(/https?:\/\//gi) ?? []).length > 1) return Response.json({ ok: false }, { status: 400 });
      if ((await ctx.api.store.count(COLLECTION)) >= MAX_STORED) return Response.json({ ok: false }, { status: 503 });
      const found = await coverFor(ctx, title);
      // Une réponse claire de RAWG (jaquette ou « inconnu ») est mémorisée ; une panne ou une clé absente laisse la tâche de rattrapage s'en charger.
      const tried = found.status === "found" || found.status === "none" ? { coverCheckedAt: new Date().toISOString(), coverResult: found.status, coverKey: await currentEpoch(ctx), coverTries: 1 } : {};
      await ctx.api.store.add(COLLECTION, { title, status: "proposed", coverUrl: found.url, ...tried, ...(found.ambiguous ? { coverAmbiguous: true } : {}), submitterName: clean(form.get("name"), 40) || null, note: note || null, replayVotes: 0, lastVotedAt: null });
      return Response.json({ ok: true });
    },

    // « Rejoue-le » : seulement sur les jeux déjà joués ; N votes par mois et par visiteur. Un simple formulaire HTML : on revient sur la page.
    async vote(request, ctx) {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
      const back = new Response(null, { status: 303, headers: { Location: baseHref(ctx) } });
      let form; try { form = await request.formData(); } catch { return new Response("Bad request", { status: 400 }); }
      const record = await ctx.api.store.get(String(form.get("id") ?? ""));
      if (!record || record.data.status !== "already_played") return new Response("Not found", { status: 404 });
      const max = num(ctx.setting("maxVotesPerMonth"), 3, 1, 50);
      const now = Date.now();
      const cookie = /(?:^|;\s*)vh_gs_votes=([^;]*)/.exec(request.headers.get("cookie") ?? "")?.[1];
      let mine = []; try { mine = JSON.parse(decodeURIComponent(cookie ?? "[]")).filter((t) => Number.isFinite(t) && now - t < MONTH); } catch { mine = []; }
      // Le cookie seul se contourne (on l'efface) : une mémoire par adresse le double.
      if (mine.length >= max || limited(`v|${ctx.instance.key}|${whoOf(request, ctx, "vote")}`, max, MONTH, now)) return new Response("Too many votes", { status: 429 });
      await ctx.api.store.update(record.id, { ...record.data, replayVotes: (Number(record.data.replayVotes) || 0) + 1, lastVotedAt: new Date(now).toISOString() });
      mine.push(now);
      back.headers.append("Set-Cookie", `${COOKIE}=${encodeURIComponent(JSON.stringify(mine))}; Path=/; Max-Age=${30 * 86400}; SameSite=Lax; HttpOnly`);
      return back;
    },
  },

  // Rattrapage des jaquettes manquantes : quelques titres toutes les 15 minutes (instances actives seulement, voir catchUpCovers).
  // Et, au passage, l'ancienne clé RAWG du module est effacée dès que le site a la sienne (voir dropOldKey).
  tasks: {
    covers: { everyMinutes: 15, run: async (ctx) => { await dropOldKey(ctx); await catchUpCovers(ctx); } },
  },

  /**
   * Version 2 des données : la clé RAWG se règle une seule fois pour tout le site (Admin → Réglages). Le réglage `rawgApiKey` du module (`legacySettings`, jamais affiché,
   * plus jamais lu pour appeler RAWG) est effacé SEULEMENT quand le site a déjà sa propre clé ; sinon il reste, inutilisé, jusqu'à ce que la personne l'ait saisie (la tâche
   * ci-dessus finit alors le travail) et l'admin du module affiche un bandeau avec le lien. Idempotente : rejouée, elle ne fait rien de plus.
   */
  migrations: {
    2: async (ctx) => { await dropOldKey(ctx); },
  },

  async adminPanel(ctx, { query } = {}) {
    const list = await rows(ctx, MAX_STORED);
    const q = query ?? {};
    const row = q.jaquette ? list.find((g) => g.id === String(q.jaquette)) : null;
    const shown = list.slice(0, 1000);
    try { await refreshAmbiguous(ctx, shown); } catch { /* la vérification est un plus : l'admin s'affiche quand même */ }
    const missing = list.filter((g) => !g.cover).length;
    const state = await readState(ctx);
    const keyed = await hasKey(ctx);
    // Sans clé RAWG, aucune suggestion n'aura d'image : on le dit tout en haut, avec le lien vers l'endroit où la saisir (une seule fois pour tout le site).
    const keyBanner = keyed ? [] : await keySetupBlocks(ctx);
    const coverBlocks = [{ type: "heading", text: ctx.t("coversTitle") }];
    if (missing === 0) coverBlocks.push({ type: "markdown", text: ctx.t("coversAll") });
    else {
      coverBlocks.push({ type: "markdown", text: `${keyed ? "" : "⚠️ "}${ctx.t(keyed ? "coversMissing" : "coversNoKeyHint", { n: missing })}` });
      if (state?.lastRunAt) coverBlocks.push({ type: "markdown", text: ctx.t("coversLast", { date: String(state.lastRunAt).slice(0, 16).replace("T", " "), found: Number(state.lastFound) || 0, none: Number(state.lastNone) || 0 }) });
      if (state?.lastStatus === "denied") coverBlocks.push({ type: "markdown", text: `⚠️ ${ctx.t("coversDeniedHint")}` });
      coverBlocks.push({ type: "adminForm", action: "findCovers", submitLabel: ctx.t("coversButton"), fields: [] });
    }
    const mode = q.ajout === "plusieurs" ? "plusieurs" : "";
    const toTreat = list.filter((g) => g.status === "proposed" && g.origin !== "admin").length;
    return [
      ...keyBanner,
      ...(row ? coverScreen(ctx, row) : []),
      { type: "markdown", text: ctx.t("adminIntro") },
      ...addBlocks(ctx, mode),
      { type: "heading", text: ctx.t("adminTitle", { count: list.length, proposed: toTreat }) },
      {
        type: "table", columns: [ctx.t("colGame"), ctx.t("colStatus"), ctx.t("colOrigin"), ctx.t("colDate"), ctx.t("colVotes"), ctx.t("colCover")],
        searchable: true, searchPlaceholder: ctx.t("searchPlaceholder"), filters: [{ column: 1, allLabel: ctx.t("filterAll") }], truncate: [0], pageSize: PAGE_SIZE, empty: ctx.t("tableEmpty"),
        rows: list.map((g) => [
          { text: g.title, title: [g.title, g.by ? ctx.t("by", { name: g.by }) : "", g.note].filter(Boolean).join(" · ") },
          { text: ctx.t(`status_${g.status}`), badge: STATUS_TONE[g.status] },
          g.origin === "admin" ? { text: ctx.t("originAdmin"), badge: "accent" } : { text: ctx.t("originPublic"), badge: "info", title: g.by || undefined },
          new Date(g.at).toISOString().slice(0, 10),
          String(g.votes),
          !g.cover ? { text: ctx.t("coverMissing"), badge: "warn" } : g.ambiguous ? { text: ctx.t("coverDoubtful"), badge: "neutral" } : "",
        ]),
        rowIds: list.map((g) => g.id),
        rowActions: [
          { label: ctx.t("rowCover"), href: "?tab=use&jaquette={id}" },
          ...STATUSES.map((s) => ({ label: ctx.t("setTo", { status: ctx.t(`status_${s}`) }), action: `status_${s}`, inMenu: true })),
          { label: ctx.t("actDelete"), action: "remove", confirm: ctx.t("confirmDelete"), danger: true },
        ],
      },
      ...coverBlocks,
      // Administration seulement : pour chaque jaquette douteuse, le lien vers l'écran du cœur qui permet de choisir le bon jeu.
      ...(shown.some((g) => g.ambiguous) ? [{ type: "markdown", text: [ctx.t("coversAmbiguous"), ...shown.filter((g) => g.ambiguous).slice(0, 50).map((g) => `- ${escMd(g.title)} : [${ctx.t("coverWrong")}](${wrongCoverHref(g.title)})`)].join("\n") }] : []),
    ];
  },

  adminActions: {
    ...Object.fromEntries(STATUSES.map((s) => [`status_${s}`, async (ctx, values) => {
      const record = values.id ? await ctx.api.store.get(values.id) : null;
      if (!record) return { error: ctx.t("errNotFound") };
      await ctx.api.store.update(record.id, { ...record.data, status: s });
      return { ok: ctx.t("okStatus") };
    }])),
    // « Rechercher les jaquettes manquantes » : la même opération que la tâche, tout de suite, avec un bilan en langage simple.
    async findCovers(ctx) {
      const r = await catchUpCovers(ctx, { force: true });
      const partial = r.found ? ctx.t("coversPartial", { found: r.found }) : "";
      if (r.status === "nothing") return { ok: ctx.t("coversAll") };
      if (r.status === "no_key") return { error: ctx.t("coversNoKey") };
      if (r.status === "denied") return { error: `${ctx.t("coversDenied")}${partial}` };
      if (r.status === "down") return { error: `${ctx.t("coversDown")}${partial}` };
      return { ok: `${ctx.t("coversDone", { found: r.found, none: r.none })}${r.left > 0 ? ctx.t("coversMore", { left: r.left }) : ""}` };
    },
    // « Ajouter un jeu » : l'administration seulement (comme le changement de statut). Journal d'audit : le cœur consigne chaque action, sans son contenu.
    async addGame(ctx, values) {
      const r = await addGames(ctx, { lines: [clean(values.title, 100_000)].filter(Boolean), status: values.status, note: values.note, image: values.image, field: "title" });
      return r.errors || r.error ? { ...(r.errors ? { errors: r.errors } : {}), ...(r.error ? { error: r.error } : {}) } : { ok: addedMessage(ctx, r) };
    },
    async addGames(ctx, values) {
      const r = await addGames(ctx, { lines: linesOf(values.titles), status: values.status, field: "titles" });
      return r.errors || r.error ? { ...(r.errors ? { errors: r.errors } : {}), ...(r.error ? { error: r.error } : {}) } : { ok: addedMessage(ctx, r) };
    },
    // Une image choisie à la main pour une ligne (jamais remplacée ensuite par la recherche automatique).
    async setImage(ctx, values) {
      const record = values.id ? await ctx.api.store.get(values.id) : null;
      if (!record) return { error: ctx.t("errNotFound") };
      const url = imageUrlOf(values.image);
      if (!url) return { errors: { image: ctx.t("errImage") } };
      const { coverAmbiguous, ...rest } = record.data;
      await ctx.api.store.update(record.id, { ...rest, coverUrl: url, coverResult: "manual", coverCheckedAt: new Date().toISOString() });
      return { ok: ctx.t("okImage") };
    },
    async remove(ctx, values) {
      if (!values.id || !(await ctx.api.store.get(values.id))) return { error: ctx.t("errNotFound") };
      await ctx.api.store.remove(values.id);
      return { ok: ctx.t("okDeleted") };
    },
  },

  mcp: {
    async game_suggestions_list(ctx, args) {
      return (await rows(ctx, MAX_STORED)).filter((g) => !args?.status || g.status === args.status).slice(0, num(args?.limit, 30, 1, 100))
        .map((g) => ({ id: g.id, title: g.title, status: g.status, origin: g.origin, submitter: g.by || null, note: g.note || null, replayVotes: g.votes, createdAt: new Date(g.at).toISOString() }));
    },
    // Ajoute à la liste un ou plusieurs jeux (50 au plus) ; mêmes règles que le formulaire de l'administration : doublon refusé, tout ou rien, plafond de 2000.
    async game_suggestions_add(ctx, args) {
      const titles = Array.isArray(args?.titles) ? args.titles.map((t) => clean(t, 100_000)).filter(Boolean) : [clean(args?.title, 100_000)].filter(Boolean);
      if (titles.length > 1 && (args?.imageUrl || args?.note)) throw Object.assign(new Error("note and imageUrl go with a single title"), { expose: true });
      const r = await addGames(ctx, { lines: titles, status: args?.status, note: args?.note, image: args?.imageUrl, field: titles.length > 1 ? "titles" : "title" });
      if (r.errors || r.error) throw Object.assign(new Error(firstError(r)), { expose: true });
      return { added: r.added, status: r.status, titles: r.titles, coversFound: r.found };
    },
    async game_suggestions_set_status(ctx, args) {
      const record = typeof args?.id === "string" && args.id ? await ctx.api.store.get(args.id) : null;
      if (!record) throw Object.assign(new Error("suggestion not found"), { expose: true });
      if (!isStatus(args.status)) throw Object.assign(new Error("invalid status"), { expose: true });
      await ctx.api.store.update(record.id, { ...record.data, status: args.status });
      return { id: record.id, status: args.status };
    },
  },

  backup: {
    async readable(ctx) {
      const cell = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
      const lines = (await rows(ctx, MAX_STORED)).map((g) => [g.id, new Date(g.at).toISOString(), g.status, g.title, g.by, g.note, g.votes, g.origin].map(cell).join(","));
      return [{ path: "games.csv", content: `﻿${[["id", "date", "status", "game", "by", "note", "votes", "origin"].map(cell).join(","), ...lines].join("\r\n")}\r\n` }];
    },
  },

  hooks: {
    async onInstanceDelete(ctx) { for (const k of [...memory.keys()]) if (k.split("|")[1] === ctx.instance.key) memory.delete(k); },
  },
};
