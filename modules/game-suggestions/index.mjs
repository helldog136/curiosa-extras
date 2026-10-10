// Suggestions de jeux — module communautaire de Curiosa. Porté de l'ancien site.
//
// Le public propose un jeu (liste publique, statut « proposé ») ; l'administrateur le fait avancer (planifié, accepté, déjà joué, fini…).
// Sur les jeux « déjà joués », le public vote « rejoue-le » : N votes par mois et par visiteur (un cookie + une mémoire côté serveur).
// La jaquette vient de RAWG par le service du cœur (`ctx.api.rawg`, permission `rawg` ; la clé se règle dans Admin → Réglages) — au mieux :
// sans clé, la suggestion n'a simplement pas d'image. Un cœur plus ancien, sans ce service, garde l'ancien réglage `rawgApiKey` du module.
// Une suggestion restée sans jaquette (migrée, restaurée d'une sauvegarde, créée pendant une panne de RAWG) est rattrapée plus tard :
// une tâche du cœur en traite quelques-unes à la fois, et un bouton de l'admin lance la même opération tout de suite. Tout ce qui
// sert à ne pas marteler RAWG (date et résultat de chaque essai) est écrit dans les données de l'instance : rien ne vit en mémoire seulement.
import { createHash } from "node:crypto";

const COLLECTION = "games";
const STATE = "state";                // un seul document : dernière recherche de jaquettes, pause éventuelle
const STATUSES = ["proposed", "planned", "accepted", "rejected", "already_played", "finished"];
const PUBLIC = ["proposed", "planned", "accepted", "already_played", "finished"];   // « rejeté » n'est pas public
const MAX_STORED = 2000;
const HOUR = 3_600_000;
const MONTH = 30 * 24 * HOUR;
const COOKIE = "vh_gs_votes";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const clean = (v, max, multiline = false) => {
  let t = String(v ?? "").normalize("NFC").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029‪-‮⁦-⁩]/g, "");
  t = multiline ? t.replace(/\n{3,}/g, "\n\n") : t.replace(/\s+/g, " ");
  return t.trim().slice(0, max);
};
const num = (v, def, min, max) => { const n = Number(v); return v === undefined || v === null || v === "" || !Number.isFinite(n) ? def : Math.min(max, Math.max(min, Math.trunc(n))); };
const safeHttps = (v) => (typeof v === "string" && /^https:\/\//.test(v) ? v : null);
const ipOf = (request) => request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
export const isStatus = (v) => STATUSES.includes(v);

const memory = new Map();           // limiteurs en mémoire : un garde-fou, pas un pare-feu
function limited(bucket, max, windowMs, now = Date.now()) {
  const recent = (memory.get(bucket) ?? []).filter((t) => now - t < windowMs);
  recent.push(now); memory.set(bucket, recent);
  if (memory.size > 5000) for (const [k, v] of memory) if (!v.some((t) => now - t < MONTH)) memory.delete(k);
  return recent.length > max;
}

/**
 * Cherche une jaquette sur RAWG (au mieux, jamais d'exception, https seulement, 5 s au plus).
 * `status` : found (jaquette trouvée) · none (RAWG ne connaît pas ce titre) · no_key (aucune clé) · denied (clé refusée, 401/403)
 *          · busy (RAWG demande de patienter, 429) · down (RAWG injoignable ou réponse illisible).
 */
export async function lookupCover(title, apiKey, fetchImpl = fetch) {
  const key = String(apiKey ?? "").trim();
  const name = String(title ?? "").trim();
  if (!key) return { status: "no_key", url: null };
  if (!name) return { status: "none", url: null };
  try {
    const url = new URL("https://api.rawg.io/api/games");
    url.searchParams.set("search", name); url.searchParams.set("page_size", "1"); url.searchParams.set("key", key);
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(5000) });
    if (res.status === 401 || res.status === 403) return { status: "denied", url: null };
    if (res.status === 429) return { status: "busy", url: null };
    if (!res.ok) return { status: "down", url: null };
    const cover = safeHttps((await res.json()).results?.[0]?.background_image ?? null);
    return cover ? { status: "found", url: cover } : { status: "none", url: null };
  } catch { return { status: "down", url: null }; }
}

const SVC_STATUS = { found: "found", none: "none", "no-key": "no_key", refused: "denied", unreachable: "down" };
const coreRawg = (ctx) => (ctx.api?.rawg && typeof ctx.api.rawg.cover === "function" ? ctx.api.rawg : null);

/** Une clé RAWG est-elle disponible ? (service du cœur, sinon ancien réglage du module). Ne lève jamais. */
export async function hasKey(ctx) {
  const svc = coreRawg(ctx);
  if (!svc) return !!apiKeyOf(ctx);
  try { return !!(await svc.configured()); } catch { return false; }
}

/** Cherche une jaquette par le service du cœur (statuts du cœur traduits : found · none · no_key · denied · down), sinon par l'ancien réglage. Jamais d'exception. */
export async function coverFor(ctx, title, fetchImpl = fetch) {
  const svc = coreRawg(ctx);
  if (!svc) return lookupCover(title, apiKeyOf(ctx), fetchImpl);
  try {
    const r = await svc.cover(title);
    const status = SVC_STATUS[r?.status] ?? "down";
    const url = status === "found" ? safeHttps(r.url) : null;
    return status === "found" && !url ? { status: "none", url: null } : { status, url };
  } catch { return { status: "down", url: null }; }
}

/** Jaquette via RAWG (au mieux, jamais d'exception). */
export async function fetchCover(title, apiKey, fetchImpl = fetch) { return (await lookupCover(title, apiKey, fetchImpl)).url; }

/* ───────────── Rattrapage des jaquettes manquantes ───────────── */

const DAY = 24 * HOUR;
const AUTO_BATCH = 5;                         // titres traités par passage de la tâche
const MANUAL_BATCH = 25;                      // titres traités par clic sur le bouton de l'admin
const RETRY_AFTER_DAYS = [3, 7, 14, 30];      // délai avant le nouvel essai d'un titre sans résultat, selon le nombre d'essais déjà faits
const MAX_TRIES = RETRY_AFTER_DAYS.length + 1; // au-delà, la tâche renonce (le bouton de l'admin peut encore réessayer)
const PAUSE_MS = 400;                         // petite pause entre deux demandes à RAWG
const PAUSE_DENIED = DAY;                     // clé refusée : la tâche ne réessaie pas avant 24 h (avec l'ancien réglage : sauf si la clé change)
const PAUSE_BUSY = 2 * HOUR;                  // RAWG demande de patienter

const apiKeyOf = (ctx) => String(ctx.setting("rawgApiKey") ?? "").trim();
/** Empreinte de l'ancienne clé du module (cœur sans service RAWG) : reconnaît « la clé a changé » sans l'enregistrer. */
const fingerprint = (key) => createHash("sha256").update(`rawg:${key}`).digest("hex").slice(0, 12);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readState(ctx) { const [row] = await ctx.api.store.list(STATE, { limit: 1 }); return row ? { id: row.id, ...row.data } : null; }
async function writeState(ctx, prev, data) {
  if (prev?.id) await ctx.api.store.update(prev.id, data); else await ctx.api.store.add(STATE, data);
}

/**
 * « Époque » des essais : les titres déjà essayés à une autre époque sont de nouveau dus tout de suite. Avec le service du cœur la clé
 * est invisible : l'époque change quand la dernière recherche s'était arrêtée faute de clé ou clé refusée (donc dès que la situation a
 * pu changer). Cœur sans service : empreinte de l'ancien réglage.
 */
async function epochOf(ctx, state, now) {
  if (!coreRawg(ctx)) return fingerprint(apiKeyOf(ctx));
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
 * Ne lève jamais à cause de RAWG ; s'arrête dès que RAWG refuse la clé, demande de patienter ou ne répond pas.
 * Renvoie { status, found, none, left, missing } — status : nothing · no_key · denied · busy · down · done.
 */
export async function catchUpCovers(ctx, { force = false, fetchImpl = fetch, now = Date.now(), pauseMs = PAUSE_MS } = {}) {
  const report = { status: "done", found: 0, none: 0, left: 0, missing: 0 };
  const missing = (await ctx.api.store.list(COLLECTION, { limit: 1000 })).filter((r) => !safeHttps(r.data.coverUrl) && String(r.data.title ?? "").trim());
  report.missing = missing.length;
  if (!missing.length) return { ...report, status: "nothing" };
  const state = await readState(ctx);
  const svc = !!coreRawg(ctx);
  if (!(await hasKey(ctx))) {
    if (state?.lastStatus !== "no_key") await writeState(ctx, state, { ...state, id: undefined, epoch: state?.epoch, pausedFor: undefined, pausedUntil: undefined, lastRunAt: new Date(now).toISOString(), lastStatus: "no_key", lastFound: 0, lastNone: 0 });
    return { ...report, status: "no_key", left: missing.length };
  }
  const paused = state && Date.parse(state.pausedUntil ?? "") > now && (svc || state.keyFp === fingerprint(apiKeyOf(ctx)));
  if (!force && paused) return { ...report, status: state.pausedFor === "denied" ? "denied" : "busy", left: missing.length };
  const fp = await epochOf(ctx, state, now);

  const due = (force ? missing : missing.filter((r) => isDue(r.data, fp, now)))
    .sort((a, b) => (Date.parse(a.data.coverCheckedAt ?? "") || 0) - (Date.parse(b.data.coverCheckedAt ?? "") || 0));
  const batch = due.slice(0, force ? MANUAL_BATCH : AUTO_BATCH);
  let stop = null;
  for (const [i, row] of batch.entries()) {
    if (i > 0 && pauseMs > 0) await sleep(pauseMs);
    const res = await coverFor(ctx, row.data.title, fetchImpl);
    if (res.status !== "found" && res.status !== "none") { stop = res.status; break; }
    const fresh = await ctx.api.store.get(row.id);          // relit : un vote arrivé entre-temps ne doit pas être écrasé
    if (!fresh) continue;
    const tries = fresh.data.coverKey === fp ? Number(fresh.data.coverTries) || 0 : 0;
    await ctx.api.store.update(row.id, { ...fresh.data, ...(res.url ? { coverUrl: res.url } : {}), coverCheckedAt: new Date(now).toISOString(), coverResult: res.status, coverKey: fp, coverTries: tries + 1 });
    report[res.status === "found" ? "found" : "none"]++;
  }
  report.left = due.length - report.found - report.none;
  if (stop) report.status = stop;
  await writeState(ctx, state, {
    keyFp: fp, epoch: fp, lastRunAt: new Date(now).toISOString(), lastStatus: report.status, lastFound: report.found, lastNone: report.none,
    ...(stop === "denied" || stop === "busy" ? { pausedFor: stop, pausedUntil: new Date(now + (stop === "denied" ? PAUSE_DENIED : PAUSE_BUSY)).toISOString() } : {}),
  });
  return report;
}

const rows = async (ctx) => (await ctx.api.store.list(COLLECTION, { limit: 1000 })).map((r) => ({
  id: r.id, at: r.createdAt, title: String(r.data.title ?? ""), status: isStatus(r.data.status) ? r.data.status : "proposed",
  cover: safeHttps(r.data.coverUrl), by: String(r.data.submitterName ?? ""), note: String(r.data.note ?? ""), votes: Number(r.data.replayVotes) || 0,
}));

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
  // /suggestions → tous (sauf rejetés) · /suggestions/<statut> → un statut
  async page(ctx, { segments }) {
    let filter = null;
    if (segments.length === 1 && PUBLIC.includes(segments[0])) filter = segments[0];
    else if (segments.length > 0) return { notFound: true, blocks: [] };

    const list = (await rows(ctx)).filter((g) => PUBLIC.includes(g.status) && (!filter || g.status === filter));
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
    async suggest(request, ctx) {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
      if (limited(`s|${ctx.instance.key}|${ipOf(request)}`, num(ctx.setting("rateLimit"), 5, 1, 100), HOUR)) return Response.json({ ok: false }, { status: 429 });
      let form; try { form = await request.formData(); } catch { return Response.json({ ok: false }, { status: 400 }); }
      if (String(form.get("website") ?? "")) return Response.json({ ok: true });          // piège à robots
      const title = clean(form.get("title"), 100);
      const note = clean(form.get("note"), 280, true);
      if (!title || (note.match(/https?:\/\//gi) ?? []).length > 1) return Response.json({ ok: false }, { status: 400 });
      if ((await ctx.api.store.count(COLLECTION)) >= MAX_STORED) return Response.json({ ok: false }, { status: 503 });
      const found = await coverFor(ctx, title);
      // Une réponse claire de RAWG (jaquette ou « inconnu ») est mémorisée ; une panne ou une clé absente laisse la tâche de rattrapage s'en charger.
      const tried = found.status === "found" || found.status === "none" ? { coverCheckedAt: new Date().toISOString(), coverResult: found.status, coverKey: await currentEpoch(ctx), coverTries: 1 } : {};
      await ctx.api.store.add(COLLECTION, { title, status: "proposed", coverUrl: found.url, ...tried, submitterName: clean(form.get("name"), 40) || null, note: note || null, replayVotes: 0, lastVotedAt: null });
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
      if (mine.length >= max || limited(`v|${ctx.instance.key}|${ipOf(request)}`, max, MONTH, now)) return new Response("Too many votes", { status: 429 });
      await ctx.api.store.update(record.id, { ...record.data, replayVotes: (Number(record.data.replayVotes) || 0) + 1, lastVotedAt: new Date(now).toISOString() });
      mine.push(now);
      back.headers.append("Set-Cookie", `${COOKIE}=${encodeURIComponent(JSON.stringify(mine))}; Path=/; Max-Age=${30 * 86400}; SameSite=Lax; HttpOnly`);
      return back;
    },
  },

  // Rattrapage des jaquettes manquantes : quelques titres toutes les 15 minutes (instances actives seulement, voir catchUpCovers).
  tasks: {
    covers: { everyMinutes: 15, run: async (ctx) => { await catchUpCovers(ctx); } },
  },

  async adminPanel(ctx) {
    const list = await rows(ctx);
    const missing = list.filter((g) => !g.cover).length;
    const state = await readState(ctx);
    const coverBlocks = [{ type: "heading", text: ctx.t("coversTitle") }];
    if (missing === 0) coverBlocks.push({ type: "markdown", text: ctx.t("coversAll") });
    else {
      const keyed = await hasKey(ctx);
      coverBlocks.push({ type: "markdown", text: `${keyed ? "" : "⚠️ "}${ctx.t(keyed ? "coversMissing" : "coversNoKeyHint", { n: missing })}` });
      if (state?.lastRunAt) coverBlocks.push({ type: "markdown", text: ctx.t("coversLast", { date: String(state.lastRunAt).slice(0, 16).replace("T", " "), found: Number(state.lastFound) || 0, none: Number(state.lastNone) || 0 }) });
      if (state?.lastStatus === "denied" && (coreRawg(ctx) || state.keyFp === fingerprint(apiKeyOf(ctx)))) coverBlocks.push({ type: "markdown", text: `⚠️ ${ctx.t("coversDeniedHint")}` });
      coverBlocks.push({ type: "adminForm", action: "findCovers", submitLabel: ctx.t("coversButton"), fields: [] });
    }
    return [
      { type: "heading", text: ctx.t("adminTitle", { count: list.length, proposed: list.filter((g) => g.status === "proposed").length }) },
      {
        type: "table", columns: [ctx.t("colDate"), ctx.t("colGame"), ctx.t("colCover"), ctx.t("colBy"), ctx.t("colStatus"), ctx.t("colVotes")],
        rows: list.map((g) => [new Date(g.at).toISOString().slice(0, 10), g.title, g.cover ? "✓" : "—", g.by, ctx.t(`status_${g.status}`), String(g.votes)]),
        rowIds: list.map((g) => g.id),
        rowActions: [...STATUSES.map((s) => ({ label: ctx.t("setTo", { status: ctx.t(`status_${s}`) }), action: `status_${s}` })), { label: ctx.t("actDelete"), action: "remove", confirm: ctx.t("confirmDelete"), danger: true }],
      },
      ...coverBlocks,
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
      if (r.status === "busy") return { error: `${ctx.t("coversBusy")}${partial}` };
      if (r.status === "down") return { error: `${ctx.t("coversDown")}${partial}` };
      return { ok: `${ctx.t("coversDone", { found: r.found, none: r.none })}${r.left > 0 ? ctx.t("coversMore", { left: r.left }) : ""}` };
    },
    async remove(ctx, values) {
      if (!values.id || !(await ctx.api.store.get(values.id))) return { error: ctx.t("errNotFound") };
      await ctx.api.store.remove(values.id);
      return { ok: ctx.t("okDeleted") };
    },
  },

  mcp: {
    async game_suggestions_list(ctx, args) {
      return (await rows(ctx)).filter((g) => !args?.status || g.status === args.status).slice(0, num(args?.limit, 30, 1, 100))
        .map((g) => ({ id: g.id, title: g.title, status: g.status, submitter: g.by || null, note: g.note || null, replayVotes: g.votes, createdAt: new Date(g.at).toISOString() }));
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
      const lines = (await rows(ctx)).map((g) => [g.id, new Date(g.at).toISOString(), g.status, g.title, g.by, g.note, g.votes].map(cell).join(","));
      return [{ path: "games.csv", content: `﻿${[["id", "date", "status", "game", "by", "note", "votes"].map(cell).join(","), ...lines].join("\r\n")}\r\n` }];
    },
  },

  hooks: {
    async onInstanceDelete(ctx) { for (const k of [...memory.keys()]) if (k.split("|")[1] === ctx.instance.key) memory.delete(k); },
  },
};
