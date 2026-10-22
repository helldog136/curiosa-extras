// Sondages — module de Curiosa.
//
// Un sondage = une question, 2 à 8 choix, un choix unique ou plusieurs, une date de fin facultative. Un vote par personne SANS compte ni cookie :
// le navigateur garde un code anonyme au hasard (localStorage) ; le site n'en garde que l'empreinte, propre à chaque sondage (jamais deux sondages
// reliés). Le débit est limité par une empreinte salée, tournante (le sel change chaque jour, il n'est jamais écrit sur le disque), calculée sur la
// connexion : l'adresse IP n'est jamais gardée ni journalisée. Voir README.md (« Ce que le sondage ne garantit pas »).
//
// Données (stockage de l'instance, tout est borné) :
//   polls     ≤ 200  sondages complets (question, choix, voix par choix, nombre de votants, dates)
//   archive   ≤ 800  sondages archivés (même forme, sans bulletins)
//   b-<id>    ≤ 5000 bulletins d'un sondage (clé = empreinte du code anonyme ; gardés 30 jours après la fin, puis effacés)
//   meta      un document : code secret de la source OBS, sondage à l'écran
// Rien ne tourne en arrière-plan : l'état « ouvert / fermé » est calculé à la lecture, le ménage se fait quand quelqu'un vote ou ouvre l'admin.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const V = new URL(import.meta.url).search;   // le cœur recharge index.mjs avec ?v=… : les fichiers voisins suivent
const L = await import(`./lib.mjs${V}`);
const C = await import(`./client.mjs${V}`);
const { esc, clean, num, LIMITS } = L;

const POLLS = "polls", ARCHIVE = "archive", META = "meta";
const DAY = 86_400_000, HOUR = 3_600_000;
const PAGE = 50;
const DEFAULT_TZ = "Europe/Paris";
const TOKEN_RE = /^[A-Za-z0-9_-]{22,64}$/;

/* ───────────── Mémoire du processus : verrou et limiteur (rien n'est écrit sur le disque) ───────────── */

const chains = (globalThis.__curiosaPollsLocks ??= new Map());
/** Passe les écritures d'une instance l'une après l'autre : deux votes simultanés ne se marchent jamais dessus. */
async function withLock(ctx, fn) {
  const key = ctx.instance.key;
  const prev = chains.get(key) ?? Promise.resolve();
  let release;
  const gate = new Promise((r) => { release = r; });
  const tail = prev.then(() => gate);
  chains.set(key, tail);
  await prev;
  try { return await fn(); } finally { release(); if (chains.get(key) === tail) chains.delete(key); }
}

const mem = (globalThis.__curiosaPollsMem ??= { salt: randomBytes(32), saltAt: Date.now(), hits: new Map(), swept: new Map() });
const MAX_BUCKETS = 5000;

/** Vrai si la limite est dépassée. Fenêtre glissante, en mémoire, bornée. */
function over(bucket, max, windowMs, now = Date.now()) {
  const recent = (mem.hits.get(bucket)?.times ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  mem.hits.delete(bucket);
  mem.hits.set(bucket, { times: recent, windowMs });
  if (mem.hits.size > MAX_BUCKETS) {
    for (const [k, v] of mem.hits) if (!v.times.some((t) => now - t < v.windowMs)) mem.hits.delete(k);
    for (const k of mem.hits.keys()) { if (mem.hits.size <= MAX_BUCKETS / 2) break; mem.hits.delete(k); }
  }
  return recent.length > max;
}

/** Empreinte de la connexion : HMAC avec un sel au hasard qui change chaque jour. L'adresse reste dans cette fonction, jamais ailleurs. */
export function fingerprint(request, now = Date.now()) {
  if (now - mem.saltAt > DAY) { mem.salt = randomBytes(32); mem.saltAt = now; mem.hits.clear(); }
  const forwarded = (request.headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const who = forwarded.length ? forwarded[forwarded.length - 1] : request.headers.get("x-real-ip") || "local";
  return createHmac("sha256", mem.salt).update(String(who).slice(0, 80)).digest("hex").slice(0, 16);
}

const ballotKey = (pollId, token) => createHash("sha256").update(`${pollId}|${token}`).digest("hex").slice(0, 40);
const sameSecret = (a, b) => { const x = Buffer.from(String(a ?? "")), y = Buffer.from(String(b ?? "")); return x.length > 0 && x.length === y.length && timingSafeEqual(x, y); };

/* ───────────── Accès aux données ───────────── */


/** Lecture par clé (index du cœur). Repli pour le faux stockage du kit de test, qui n'a pas de clés : parcours borné, jamais utilisé avec le vrai cœur. */
async function byKey(ctx, collection, key, field) {
  if (typeof ctx.api.store.getByKey === "function") return ctx.api.store.getByKey(collection, key);
  const rows = await ctx.api.store.list(collection, { limit: 1000 });
  return rows.filter((r) => r.data?.[field] === key).pop() ?? null;   // le plus ancien, comme getByKey
}

const pollOf = (r, kind = "live") => (r ? { ...r.data, id: r.id, archived: kind === "archive" } : null);
const can = (ctx, right) => (typeof ctx.can === "function" ? !!ctx.can(right) : true);   // le cœur refuse déjà l'action elle-même : ici, on ne fait que cacher ce qu'on ne peut pas utiliser

async function livePolls(ctx) {
  return (await ctx.api.store.list(POLLS, { limit: LIMITS.livePolls + 20 })).map((r) => pollOf(r));
}
async function findPoll(ctx, slug) {
  const s = clean(slug, 80).toLowerCase();
  if (!s) return null;
  return pollOf(await byKey(ctx, POLLS, s, "slug")) ?? pollOf(await byKey(ctx, ARCHIVE, s, "slug"), "archive");
}
async function findById(ctx, id) {
  const r = typeof id === "string" && id ? await ctx.api.store.get(id) : null;
  return r && r.data?.slug && Array.isArray(r.data?.choices) ? pollOf(r) : null;
}
async function getCfg(ctx) { const r = await byKey(ctx, META, "cfg", "k"); return r ? { id: r.id, ...r.data } : null; }
async function ensureCfg(ctx) {
  const found = await getCfg(ctx);
  if (found) return found;
  return withLock(ctx, async () => {
    const again = await getCfg(ctx);
    if (again) return again;
    const data = { k: "cfg", obsKey: randomBytes(18).toString("base64url"), onAir: null };
    return { id: await ctx.api.store.add(META, data, { key: "cfg" }), ...data };
  });
}
const saveCfg = async (ctx, cfg) => { const { id, ...data } = cfg; await ctx.api.store.update(id, data); };

const tzOf = (ctx) => { const z = String(ctx.setting("timezone") ?? ""); return L.isValidTimeZone(z) ? z : DEFAULT_TZ; };
const baseOf = (ctx) => { const b = ctx.instance.basePath; return b === null || b === undefined ? null : b ? `/${b}` : ""; };
const pollHref = (ctx, slug) => { const b = baseOf(ctx); return b === null ? null : `${b}/${encodeURIComponent(slug)}`; };

/** Efface des bulletins d'un sondage (par tranches). Renvoie vrai s'il en reste. */
async function purgeBallots(ctx, pollId, { pages = 1 } = {}) {
  const col = `b-${pollId}`;
  for (let i = 0; i < pages; i++) {
    const page = await ctx.api.store.page(col, { limit: 200, order: "asc" });
    if (!page.items.length) return false;
    for (const it of page.items) await ctx.api.store.remove(it.id);
    if (page.items.length < 200) return (await ctx.api.store.count(col)) > 0;
  }
  return (await ctx.api.store.count(col)) > 0;
}

/** Ménage de la conservation : bulletins des sondages finis depuis plus de N jours. Quelques centaines d'effacements au plus par passage. */
export async function sweep(ctx, now = Date.now(), { force = false } = {}) {
  const k = ctx.instance.key;
  if (!force && now - (mem.swept.get(k) ?? 0) < 10 * 60_000) return 0;
  mem.swept.set(k, now);
  const days = num(ctx.setting("retentionDays"), 30, 1, 90);
  let budget = 3;
  let cleaned = 0;
  for (const p of await livePolls(ctx)) {
    if (budget <= 0) break;
    if (p.purgedAt || L.stateOf(p, now) !== "closed") continue;
    const ended = L.endedAtMs(p, now);
    if (!ended || now - ended < days * DAY) continue;
    budget--;
    const left = await purgeBallots(ctx, p.id, { pages: 1 });
    cleaned++;
    if (!left) await withLock(ctx, async () => { const f = await ctx.api.store.get(p.id); if (f) await ctx.api.store.update(p.id, { ...f.data, purgedAt: new Date(now).toISOString() }); });
  }
  return cleaned;
}

/* ───────────── Écritures : créer, voter, fermer, archiver, supprimer ───────────── */

const freshSlug = async (ctx, question) => {
  for (let i = 0; i < 8; i++) {
    const s = L.slugify(question);
    if (!(await findPoll(ctx, s))) return s;
  }
  return `${L.slugify(question)}${Date.now().toString(36)}`;
};

async function archiveOne(ctx, p, now = Date.now()) {
  while (await purgeBallots(ctx, p.id, { pages: 10 })) { /* jusqu'à la dernière tranche (5 000 bulletins au plus) */ }
  if ((await ctx.api.store.count(ARCHIVE)) >= LIMITS.archived) {
    const [oldest] = (await ctx.api.store.page(ARCHIVE, { limit: 1, order: "asc" })).items;
    if (oldest) await ctx.api.store.remove(oldest.id);
  }
  const { id, archived, ...data } = p;
  await ctx.api.store.add(ARCHIVE, { ...data, archivedAt: new Date(now).toISOString(), endedAt: new Date(L.endedAtMs(p, now) || now).toISOString() }, { key: p.slug });
  await ctx.api.store.remove(id);
}

/** Crée un sondage (borné : au-delà de 200, le plus ancien sondage fini est archivé ; s'il n'y en a pas, on le dit). */
export async function createPoll(ctx, value, tz, now = Date.now()) {
  return withLock(ctx, async () => {
    if ((await ctx.api.store.count(POLLS)) >= LIMITS.livePolls) {
      const closed = (await livePolls(ctx)).filter((p) => L.stateOf(p, now) === "closed").sort((a, b) => (L.endedAtMs(a, now) || 0) - (L.endedAtMs(b, now) || 0));
      if (!closed.length) return { ok: false, error: "full" };
      await archiveOne(ctx, closed[0], now);
    }
    const slug = await freshSlug(ctx, value.question);
    const data = {
      slug, question: value.question, choices: value.choices.map((text, i) => ({ id: `c${i + 1}`, text })), max: value.max, endsAt: value.endsAt,
      tz, resultsMode: value.resultsMode, counts: {}, voters: 0, rev: 0, createdAt: new Date(now).toISOString(), closedAt: null,
    };
    const id = await ctx.api.store.add(POLLS, data, { key: slug });
    return { ok: true, id, slug };
  });
}

/** Un vote. Tout se passe dans le verrou : lecture du sondage, bulletin unique, mise à jour des compteurs. Renvoie { ok } ou { ok:false, error }. */
export async function castVote(ctx, { slug, token, ids, now = Date.now() }) {
  return withLock(ctx, async () => {
    const live = pollOf(await byKey(ctx, POLLS, clean(slug, 80).toLowerCase(), "slug"));
    if (!live) return { ok: false, error: (await findPoll(ctx, slug)) ? "closed" : "gone" };
    if (L.stateOf(live, now) !== "open") return { ok: false, error: "closed" };
    const picked = L.validBallot(live, ids);
    if (!picked) return { ok: false, error: "invalid" };
    if ((Number(live.voters) || 0) >= LIMITS.voters) return { ok: false, error: "full" };
    const col = `b-${live.id}`, key = ballotKey(live.id, token);
    if (await byKey(ctx, col, key, "k")) return { ok: false, error: "already" };
    const mine = await ctx.api.store.add(col, { k: key, c: picked, at: new Date(now).toISOString() }, { key });
    // Si deux processus avaient écrit en même temps, le plus ancien bulletin gagne : l'autre s'efface (jamais de double comptage).
    const first = await byKey(ctx, col, key, "k");
    if (first && first.id !== mine) { await ctx.api.store.remove(mine); return { ok: false, error: "already" }; }
    try {
      const fresh = await ctx.api.store.get(live.id);
      if (!fresh) throw new Error("gone");
      const counts = { ...(fresh.data.counts ?? {}) };
      for (const id of picked) counts[id] = (Number(counts[id]) || 0) + 1;
      const ok = await ctx.api.store.update(live.id, { ...fresh.data, counts, voters: (Number(fresh.data.voters) || 0) + 1, rev: (Number(fresh.data.rev) || 0) + 1 });
      if (!ok) throw new Error("gone");
    } catch {
      await ctx.api.store.remove(mine);   // rien n'est compté sans bulletin, ni de bulletin sans compte
      return { ok: false, error: "busy" };
    }
    return { ok: true, picked, poll: pollOf(await ctx.api.store.get(live.id)) };
  });
}

/** Refait les compteurs à partir des bulletins (réparation si deux processus ont écrit en même temps). Impossible une fois les bulletins effacés. */
export async function recount(ctx, id) {
  return withLock(ctx, async () => {
    const p = await findById(ctx, id);
    if (!p) return { ok: false, error: "gone" };
    if (p.purgedAt) return { ok: false, error: "purged" };
    const col = `b-${p.id}`, counts = {};
    let voters = 0, cursor = null;
    for (let i = 0; i < 40; i++) {
      const page = await ctx.api.store.page(col, { limit: 200, order: "asc", cursor });
      for (const it of page.items) { voters++; for (const c of it.data.c ?? []) if (p.choices.some((x) => x.id === c)) counts[c] = (counts[c] || 0) + 1; }
      cursor = page.next;
      if (!cursor) break;
    }
    const f = await ctx.api.store.get(p.id);
    await ctx.api.store.update(p.id, { ...f.data, counts, voters, rev: (Number(f.data.rev) || 0) + 1 });
    return { ok: true, voters };
  });
}

const closeNow = (ctx, id, now = Date.now()) => withLock(ctx, async () => {
  const p = await findById(ctx, id);
  if (!p) return { ok: false, error: "gone" };
  if (L.stateOf(p, now) === "closed") return { ok: false, error: "already" };
  const f = await ctx.api.store.get(p.id);
  await ctx.api.store.update(p.id, { ...f.data, closedAt: new Date(now).toISOString(), rev: (Number(f.data.rev) || 0) + 1 });
  return { ok: true };
});

async function removePoll(ctx, p) {
  while (await purgeBallots(ctx, p.id, { pages: 10 })) { /* tout */ }
  await ctx.api.store.remove(p.id);
  const cfg = await getCfg(ctx);
  if (cfg?.onAir === p.slug) await saveCfg(ctx, { ...cfg, onAir: null });
}

/* ───────────── Visibilité des résultats ───────────── */

const myBallot = async (ctx, p, token) => (TOKEN_RE.test(String(token ?? "")) && !p.archived ? byKey(ctx, `b-${p.id}`, ballotKey(p.id, token), "k") : null);
const canSeeResults = (p, voted, now = Date.now()) => L.stateOf(p, now) === "closed" || p.resultsMode !== "after" || voted;

/* ───────────── Affichage public ───────────── */

const CSS = `.vp{box-sizing:border-box;border:1px solid var(--v-line);background:var(--v-surface);color:var(--v-fg);border-radius:16px;padding:16px;display:grid;gap:14px;max-width:44rem;margin:0 auto}
.vp *{box-sizing:border-box}.vp-q{margin:0;font-size:1.25rem;line-height:1.3;overflow-wrap:anywhere}.vp-meta,.vp-hint{margin:0;color:var(--v-muted);font-size:.92rem}
.vp-form fieldset{border:0;margin:0;padding:0;min-width:0;display:grid;gap:8px}.vp-form legend{color:var(--v-muted);font-size:.92rem;padding:0;margin-bottom:6px}
.vp-opt{display:flex;align-items:center;gap:12px;min-height:48px;padding:8px 12px;border:1px solid var(--v-line);border-radius:12px;cursor:pointer;overflow-wrap:anywhere}
.vp-opt:has(input:checked){border-color:var(--v-accent);box-shadow:0 0 0 2px var(--v-accent)}.vp-opt:focus-within{outline:3px solid var(--v-fg);outline-offset:2px}
.vp-opt input{width:22px;height:22px;flex:none;accent-color:var(--v-accent)}.vp-opt input:disabled+span{opacity:.55}
.vp-btn{min-height:48px;padding:0 22px;border-radius:999px;border:0;background:var(--v-accent);color:var(--v-accent-fg);font:inherit;font-weight:700;cursor:pointer;justify-self:start}
.vp-btn:disabled{opacity:.6;cursor:wait}.vp-btn:focus-visible{outline:3px solid var(--v-fg);outline-offset:2px}
.vp-err{color:var(--v-danger);margin:0;font-weight:600}.vp-ok{margin:0;font-weight:600}.vp-hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.vp-bars{list-style:none;margin:0;padding:0;display:grid;gap:14px}.vp-line{display:flex;justify-content:space-between;align-items:baseline;gap:4px 12px;flex-wrap:wrap}
.vp-label{font-weight:600;overflow-wrap:anywhere}.vp-num{font-variant-numeric:tabular-nums}
.vp-track{height:16px;border-radius:8px;background:var(--v-bg);border:1px solid var(--v-muted);overflow:hidden;margin-top:6px}
.vp-fill{height:100%;background:var(--v-accent);transition:width .5s}.vp-lead .vp-fill{background-image:repeating-linear-gradient(135deg,transparent 0 6px,rgba(0,0,0,.28) 6px 9px)}
.vp-tag{display:inline-block;margin:6px 6px 0 0;font-size:.82rem;font-weight:700;border:1px solid var(--v-fg);border-radius:999px;padding:1px 10px}
.vp-list{list-style:none;margin:0;padding:0;display:grid;gap:10px}.vp-list a{display:block;padding:12px 14px;min-height:48px;border:1px solid var(--v-line);border-radius:12px;background:var(--v-surface);color:var(--v-fg);text-decoration:none}
.vp-list a:hover,.vp-list a:focus-visible{border-color:var(--v-accent)}.vp-list b{display:block;overflow-wrap:anywhere}.vp-list small{color:var(--v-muted)}
@media (prefers-reduced-motion:reduce){.vp-fill{transition:none}}`;

const votesText = (ctx, n) => ctx.t(n === 1 ? "voice_one" : "voice_many", { n });
const votersText = (ctx, n) => ctx.t(n === 1 ? "voters_one" : "voters_many", { n });

function resultsHtml(ctx, p, mine = []) {
  const rows = L.rows(p);
  const closed = L.stateOf(p) === "closed";
  const items = rows.map((r) => `<li class="vp-row${r.lead ? " vp-lead" : ""}"><div class="vp-line"><span class="vp-label">${esc(r.text)}</span><span class="vp-num"><strong>${r.pct} %</strong> · ${esc(votesText(ctx, r.count))}</span></div>` +
    `<div class="vp-track" aria-hidden="true"><div class="vp-fill" style="width:${r.pct}%"></div></div>` +
    `${r.lead ? `<span class="vp-tag">${esc(ctx.t(closed ? "winner" : "leading"))}</span>` : ""}${mine.includes(r.id) ? `<span class="vp-tag">✓ ${esc(ctx.t("yourChoice"))}</span>` : ""}</li>`).join("");
  return `<p class="vp-hint">${esc(ctx.t(closed ? "finalResult" : "liveResult"))} · ${esc(votersText(ctx, Number(p.voters) || 0))}</p><ol class="vp-bars">${items}</ol>`;
}

function endLine(ctx, p) {
  const closed = L.stateOf(p) === "closed";
  if (closed) {
    const when = L.endedAtMs(p);
    return esc(ctx.t("endedOn", { date: when ? L.formatEnd(new Date(when).toISOString(), p.tz || DEFAULT_TZ, ctx.locale) : "" }));
  }
  if (!p.endsAt) return esc(ctx.t("noEnd"));
  return `${esc(ctx.t("endsOn", { date: "" }))}<time datetime="${esc(p.endsAt)}" data-vp-end data-label="${esc(ctx.t("localLabel"))}">${esc(L.formatEnd(p.endsAt, p.tz || DEFAULT_TZ, ctx.locale))}</time><span data-vp-local hidden></span>`;
}

/** Le bloc d'un sondage : question, formulaire (s'il est ouvert), résultats (selon le choix d'Emma). Même rendu sur la page, l'accueil et après un vote. */
export function pollHtml(ctx, p, { title = "h2", link = null } = {}) {
  const closed = L.stateOf(p) === "closed";
  const head = title ? `<${title} class="vp-q">${link ? `<a href="${esc(link)}" style="color:inherit">${esc(p.question)}</a>` : esc(p.question)}</${title}>` : "";
  const max = Math.min(p.max || 1, p.choices.length);
  const attrs = ["closed", "already", "limit", "invalid", "net", "busy", "full", "gone", "thanks", "pick"].map((c) => `data-m-${c}="${esc(ctx.t(`msg_${c}`))}"`).join(" ")
    + ` data-m-busy="${esc(ctx.t("sending"))}"`;
  const type = max > 1 ? "checkbox" : "radio";
  const form = closed ? "" :
    `<form class="vp-form" data-vp-form hidden novalidate><fieldset><legend>${esc(ctx.t(max > 1 ? "hintMany" : "hintOne", { n: max }))}</legend>` +
    p.choices.map((c) => `<label class="vp-opt"><input type="${type}" name="c" value="${esc(c.id)}"><span>${esc(c.text)}</span></label>`).join("") +
    `</fieldset><div class="vp-hp" aria-hidden="true"><label>Website<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>` +
    `<p class="vp-err" data-vp-err role="alert" hidden></p><button type="submit" class="vp-btn">${esc(ctx.t("vote"))}</button></form>` +
    `<noscript><p class="vp-hint">${esc(ctx.t("needScript"))}</p></noscript><p class="vp-ok" data-vp-ok role="status" hidden></p>`;
  const show = canSeeResults(p, false);
  const res = show ? resultsHtml(ctx, p) : `<p class="vp-hint">${esc(ctx.t("hiddenUntilVote"))}</p>`;
  return `<style>${CSS}</style><section class="vp" data-vp data-poll="${esc(p.slug)}" data-api="/m/${esc(ctx.instance.key)}" data-lang="${esc(ctx.locale)}" data-max="${max}" ${attrs}>` +
    `${head}<p class="vp-meta">${endLine(ctx, p)}${p.archived ? ` · ${esc(ctx.t("archivedNote"))}` : ""}</p>${form}<div data-vp-res aria-live="polite">${res}</div></section>`;
}

const fmtDay = (ctx, iso, tz) => { try { return new Intl.DateTimeFormat(ctx.locale, { timeZone: tz, dateStyle: "long" }).format(new Date(iso)); } catch { return String(iso).slice(0, 10); } };

function listItem(ctx, p) {
  const href = pollHref(ctx, p.slug);
  const open = L.stateOf(p) === "open";
  const rows = L.rows(p);
  const lead = rows.filter((r) => r.lead).map((r) => r.text).join(", ");
  const meta = open
    ? `${endLine(ctx, p).replace(/<[^>]+>/g, "")}`
    : `${esc(ctx.t("endedShort", { date: fmtDay(ctx, new Date(L.endedAtMs(p) || Date.now()).toISOString(), p.tz || DEFAULT_TZ) }))} · ${esc(votersText(ctx, Number(p.voters) || 0))}${lead ? ` · ${esc(ctx.t("winnerIs", { text: lead }))}` : ""}`;
  return `<li><a href="${esc(href ?? "#")}"><b>${esc(p.question)}</b><small>${meta}</small></a></li>`;
}

const byEnded = (now) => (a, b) => (L.endedAtMs(b, now) || 0) - (L.endedAtMs(a, now) || 0);

/** Les sondages terminés, du plus récent au plus ancien : d'abord les complets, puis les archivés. 50 par page. */
async function pastPage(ctx, page, now = Date.now()) {
  const live = (await livePolls(ctx)).filter((p) => L.stateOf(p, now) === "closed").sort(byEnded(now));
  const archived = await ctx.api.store.count(ARCHIVE);
  const total = live.length + archived;
  const start = (page - 1) * PAGE;
  const items = live.slice(start, start + PAGE);
  const need = Math.min(PAGE - items.length, Math.max(0, total - start - items.length));
  if (need > 0) {
    const skip = Math.max(0, start - live.length);
    let cursor = null, seen = 0;
    const got = [];
    for (let i = 0; i < 20 && got.length < need; i++) {
      const pg = await ctx.api.store.page(ARCHIVE, { limit: 100, cursor });
      for (const r of pg.items) { if (seen++ >= skip && got.length < need) got.push(pollOf(r, "archive")); }
      cursor = pg.next;
      if (!cursor) break;
    }
    items.push(...got);
  }
  return { items, total, pages: Math.max(1, Math.ceil(total / PAGE)) };
}

const pager = (ctx, page, pages) => {
  const b = baseOf(ctx) ?? "";
  const link = (n, label) => `<a href="${esc(n === 1 ? b || "/" : `${b}/page/${n}`)}">${esc(label)}</a>`;
  return pages > 1 ? `<p>${page > 1 ? link(page - 1, ctx.t("prevPage")) : ""}${page > 1 && page < pages ? " · " : ""}${page < pages ? link(page + 1, ctx.t("nextPage")) : ""}</p>` : "";
};

/* ───────────── Source navigateur OBS ───────────── */

async function onAirPoll(ctx, cfg, query) {
  const asked = query?.get?.("poll");
  if (asked) { const p = await findPoll(ctx, asked); if (p) return p; }
  if (cfg?.onAir) { const p = await findPoll(ctx, cfg.onAir); if (p) return p; }
  const open = (await livePolls(ctx)).filter((p) => L.stateOf(p) === "open").sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return open[0] ?? null;
}

function liveData(p, now = Date.now()) {
  if (!p) return { empty: true, rev: "none" };
  const state = L.stateOf(p, now);
  return { rev: `${p.id}.${p.rev || 0}.${state}`, state, question: p.question, voters: Number(p.voters) || 0, endsAt: p.endsAt ?? null, rows: L.rows(p) };
}

const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });

/* ───────────── Formulaires d'administration ───────────── */

const ZONE_FALLBACK = DEFAULT_TZ;
const zoneName = (tz, locale) => { try { return new Intl.DateTimeFormat(locale, { timeZone: tz, timeZoneName: "long" }).formatToParts(new Date()).find((x) => x.type === "timeZoneName")?.value ?? tz; } catch { return tz || ZONE_FALLBACK; } };
const stamp = (ctx, iso, tz) => { try { return new Intl.DateTimeFormat(ctx.locale, { timeZone: tz, dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)); } catch { return String(iso ?? ""); } };

const pollFields = (ctx, v = {}, { withChoices = true } = {}) => [
  { name: "question", label: ctx.t("fQuestion"), kind: "text", required: true, value: v.question ?? "", help: ctx.t("fQuestionHelp") },
  ...(withChoices ? [{ name: "choices", label: ctx.t("fChoices"), kind: "textarea", required: true, value: v.choices ?? "", help: ctx.t("fChoicesHelp") }] : []),
  { name: "max", label: ctx.t("fMax"), kind: "number", value: String(v.max ?? 1), help: ctx.t("fMaxHelp") },
  { name: "resultsMode", label: ctx.t("fResults"), kind: "select", value: v.resultsMode ?? (ctx.setting("resultsDefault") === "after" ? "after" : "always"),
    options: [{ value: "always", label: ctx.t("resAlways") }, { value: "after", label: ctx.t("resAfter") }], help: ctx.t("fResultsHelp") },
  { name: "endDate", label: ctx.t("fEndDate"), kind: "date", value: v.endDate ?? "", help: ctx.t("fEndDateHelp", { zone: zoneName(tzOf(ctx), ctx.locale) }) },
  { name: "endTime", label: ctx.t("fEndTime"), kind: "text", value: v.endTime ?? "", help: ctx.t("fEndTimeHelp") },
];

const fieldErrors = (ctx, errors) => Object.fromEntries(Object.entries(errors).map(([k, code]) => [k, ctx.t(`err_${code}`, { min: LIMITS.minChoices, max: LIMITS.maxChoices })]));

/** Une action d'administration réservée à un droit du module (le cœur ne contrôle que « ouvrir » pour une action écrite en simple fonction). */
const needs = (right, fn) => async (ctx, values) => (can(ctx, right) ? fn(ctx, values) : { error: ctx.t("errRight") });

/* ───────────── Le module ───────────── */

export default {
  slots: {
    // Le petit script du sondage n'est demandé que si le site a des sondages ; il ne fait rien sur une page sans sondage.
    "layout.head": async (ctx) => ((await ctx.api.store.count(POLLS)) > 0 ? [{ type: "head", tags: [{ tag: "script", src: `/m/${ctx.instance.key}/client?v=${C.CLIENT_REV}`, defer: true }] }] : null),
  },

  sections: {
    current: async (ctx) => {
      const open = (await livePolls(ctx)).filter((p) => L.stateOf(p) === "open").sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      const p = open[0];
      if (!p) return null;
      const all = baseOf(ctx);
      return [{ type: "html", html: pollHtml(ctx, p, { title: "h3", link: pollHref(ctx, p.slug) }) + (all === null ? "" : `<p style="text-align:center"><a href="${esc(all || "/")}">${esc(ctx.t("allPolls"))}</a></p>`) }];
    },
  },

  news: async (ctx) => {
    const since = ctx.visit?.lastVisit?.getTime?.() ?? 0;
    return (await ctx.api.store.list(POLLS, { limit: 20 })).some((r) => L.stateOf(r.data) === "open" && Date.parse(r.data.createdAt ?? "") > since);
  },

  async page(ctx, { segments }) {
    const title = ctx.t("pageTitle");
    if (segments.length === 0 || (segments.length === 2 && segments[0] === "page")) {
      const n = segments.length === 0 ? 1 : Number(segments[1]);
      if (!Number.isInteger(n) || n < 1) return { notFound: true, blocks: [] };
      const now = Date.now();
      const open = n === 1 ? (await livePolls(ctx)).filter((p) => L.stateOf(p, now) === "open").sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))) : [];
      const past = await pastPage(ctx, n, now);
      if (n > past.pages) return { notFound: true, blocks: [] };
      const blocks = [];
      const intro = String(ctx.setting("intro") ?? "").trim();
      if (n === 1 && intro) blocks.push({ type: "markdown", text: intro });
      let html = `<style>${CSS}</style>`;
      if (open.length) html += `<h2>${esc(ctx.t("openPolls"))}</h2><ul class="vp-list">${open.map((p) => listItem(ctx, p)).join("")}</ul>`;
      html += `<h2>${esc(ctx.t("pastPolls"))}</h2>`;
      html += past.items.length ? `<ul class="vp-list">${past.items.map((p) => listItem(ctx, p)).join("")}</ul>${pager(ctx, n, past.pages)}` : `<p class="vp-hint">${esc(ctx.t(open.length ? "noPast" : "noPolls"))}</p>`;
      blocks.push({ type: "html", html });
      return { title, description: ctx.t("pageDescription"), blocks };
    }
    if (segments.length === 1) {
      const p = await findPoll(ctx, segments[0]);
      if (!p) return { notFound: true, blocks: [] };
      const href = pollHref(ctx, p.slug);
      const blocks = [{ type: "html", html: pollHtml(ctx, p, { title: null }) }];
      if (L.stateOf(p) === "open" && href) blocks.push({ type: "copy", label: ctx.t("shareLabel"), text: `${ctx.api.siteUrl}${href}` });
      blocks.push({ type: "links", items: [{ label: ctx.t("allPolls"), href: baseOf(ctx) || "/" }] });
      return { title: p.question, description: ctx.t("pollDescription"), blocks };
    }
    return { notFound: true, blocks: [] };
  },

  routes: {
    // Le petit script des visiteurs (même contenu pour tous, mis en cache).
    client(request) {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
      return new Response(C.CLIENT_JS, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff" } });
    },

    async vote(request, ctx) {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
      const raw = await request.text();
      if (raw.length > 2000) return json({ ok: false, reason: "invalid" }, 413);
      let body; try { body = JSON.parse(raw); } catch { return json({ ok: false, reason: "invalid" }, 400); }
      if (!body || typeof body !== "object") return json({ ok: false, reason: "invalid" }, 400);
      if (String(body.website ?? "")) return json({ ok: true, html: "" });                    // piège à robots : on fait semblant, rien n'est enregistré
      const now = Date.now();
      const fp = fingerprint(request, now);
      const slug = clean(body.poll, 80).toLowerCase();
      if (over(`a|${ctx.instance.key}|${fp}`, num(ctx.setting("ratePerHour"), 30, 3, 300), HOUR, now)
        || over(`p|${ctx.instance.key}|${fp}|${slug}`, 8, 10 * 60_000, now)
        || over(`g|${ctx.instance.key}`, 120, 60_000, now)) return json({ ok: false, reason: "limit" }, 429, { "retry-after": "60" });
      if (!TOKEN_RE.test(String(body.t ?? ""))) return json({ ok: false, reason: "invalid" }, 400);
      const r = await castVote(ctx, { slug, token: String(body.t), ids: Array.isArray(body.c) ? body.c.slice(0, LIMITS.maxChoices + 1).map(String) : null, now });
      if (!r.ok) return json({ ok: false, reason: r.error }, r.error === "closed" || r.error === "already" ? 409 : r.error === "gone" ? 404 : r.error === "full" ? 503 : r.error === "busy" ? 503 : 400);
      sweep(ctx, now).catch(() => {});
      return json({ ok: true, html: resultsHtml(ctx, r.poll, r.picked), mine: r.picked });
    },

    // « Où en est le sondage, et ai-je déjà voté ? » — lecture seule, avec le code anonyme du navigateur.
    async results(request, ctx) {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
      const raw = await request.text();
      if (raw.length > 1000) return json({ ok: false, reason: "invalid" }, 413);
      let body; try { body = JSON.parse(raw); } catch { return json({ ok: false, reason: "invalid" }, 400); }
      const now = Date.now();
      if (over(`r|${ctx.instance.key}|${fingerprint(request, now)}`, 120, HOUR, now)) return json({ ok: false, reason: "limit" }, 429, { "retry-after": "60" });
      const p = await findPoll(ctx, body?.poll);
      if (!p) return json({ ok: false, reason: "gone" }, 404);
      const ballot = await myBallot(ctx, p, body?.t);
      const closed = L.stateOf(p, now) === "closed";
      if (!ballot && !closed) return json({ ok: false, reason: "none" });          // pas voté : le formulaire reste (et rien n'est montré si le sondage cache ses résultats)
      return json({ ok: true, html: resultsHtml(ctx, p, ballot?.data?.c ?? []), voted: !!ballot, mine: ballot?.data?.c ?? [] });
    },

    // Les chiffres pour la source navigateur OBS. Adresse secrète obligatoire ; sans elle, la route fait comme si elle n'existait pas.
    async live(request, ctx) {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
      const url = new URL(request.url);
      const cfg = await getCfg(ctx);
      if (!cfg || !sameSecret(url.searchParams.get("k"), cfg.obsKey)) return new Response("Not found", { status: 404 });
      if (over(`l|${ctx.instance.key}`, 120, 60_000)) return json({ ok: false }, 429, { "retry-after": "30" });
      const data = liveData(await onAirPoll(ctx, cfg, url.searchParams));
      if (url.searchParams.get("rev") === data.rev) return json({ unchanged: true, rev: data.rev, state: data.state ?? "open" });
      return json(data);
    },
  },

  async overlay(ctx, { query }) {
    const cfg = await getCfg(ctx);
    if (!cfg || !sameSecret(query.get("k"), cfg.obsKey)) return { title: ctx.instance.name, html: "" };   // l'adresse sans le code secret ne montre rien
    const seconds = num(ctx.setting("obsRefreshSeconds"), 5, 3, 30);
    const color = (v, d) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : d);
    const pos = ["left", "right", "center"].includes(ctx.setting("obsPosition")) ? ctx.setting("obsPosition") : "left";
    const cfgJs = JSON.stringify({
      url: `/m/${ctx.instance.key}/live?k=${encodeURIComponent(query.get("k"))}${query.get("poll") ? `&poll=${encodeURIComponent(query.get("poll"))}` : ""}`,
      base: seconds * 1000, max: 30000, lang: ctx.locale,
      t: { live: ctx.t("obsLive"), final: ctx.t("obsFinal"), one: ctx.t("voice_one", { n: "" }).trim(), many: ctx.t("voice_many", { n: "" }).trim(), lead: ctx.t("leading"), person: ctx.t("person_one"), people: ctx.t("person_many"), ends: ctx.t("obsEnds") },
    }).replace(/</g, "\\u003c");
    const accent = color(ctx.setting("obsAccent"), ctx.theme.accent), fg = color(ctx.setting("obsText"), ctx.theme.fg), card = color(ctx.setting("obsCard"), ctx.theme.surface);
    return {
      title: ctx.instance.name,
      html: `<div id="vo-box" role="status" aria-live="polite"></div>`,
      css: `html,body{margin:0;background:transparent;overflow:hidden;font-family:${ctx.theme.font || "system-ui,sans-serif"}}
#vo-box{position:fixed;${pos === "center" ? "left:50%;transform:translateX(-50%)" : `${pos}:32px`};bottom:32px;width:min(640px,calc(100vw - 64px))}
.vo-card{background:${card};color:${fg};border-radius:20px;padding:22px 26px;box-shadow:0 8px 32px rgba(0,0,0,.45);animation:vo-in .4s ease-out}
.vo-state{margin:0 0 6px;font-size:18px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:${accent}}
.vo-q{margin:0 0 16px;font-size:30px;line-height:1.2;overflow-wrap:anywhere}.vo-list{list-style:none;margin:0;padding:0;display:grid;gap:14px}
.vo-line{display:flex;justify-content:space-between;gap:12px;font-size:22px}.vo-label{font-weight:600;overflow-wrap:anywhere}.vo-num{white-space:nowrap}
.vo-track{height:18px;border-radius:9px;background:rgba(127,127,127,.35);border:2px solid ${fg};overflow:hidden;margin-top:6px}
.vo-fill{height:100%;background:${accent};transition:width .6s}.vo-row.lead .vo-fill{background-image:repeating-linear-gradient(135deg,transparent 0 7px,rgba(0,0,0,.3) 7px 11px)}
.vo-tag{display:inline-block;margin-top:4px;font-size:16px;font-weight:700;border:2px solid ${fg};border-radius:999px;padding:0 10px}
.vo-foot{margin:16px 0 0;font-size:18px;opacity:.85}
@keyframes vo-in{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.vo-card{animation:none}.vo-fill{transition:none}}`,
      script: `window.__VO=${cfgJs};${C.OVERLAY_JS}`,
    };
  },

  async adminPanel(ctx, { query }) {
    const now = Date.now();
    await sweep(ctx, now).catch(() => {});
    const cfg = await ensureCfg(ctx);
    const tz = tzOf(ctx);
    const manage = can(ctx, "manage");
    const blocks = [];
    const screen = [];

    // ── Onglet « À l'écran » : la source navigateur OBS ──
    screen.push({ type: "heading", text: ctx.t("obsTitle"), tab: "screen" });
    if (can(ctx, "obs.view")) {
      const addr = `${ctx.api.siteUrl}/overlays/${ctx.instance.key}?k=${cfg.obsKey}`;
      const onAir = cfg.onAir ? await findPoll(ctx, cfg.onAir) : null;
      screen.push(
        { type: "markdown", text: ctx.t("obsHelp"), tab: "screen" },
        { type: "copy", label: ctx.t("obsAddress"), text: addr, tab: "screen" },
        { type: "markdown", text: ctx.t("obsSecret"), tab: "screen" },
        { type: "markdown", text: onAir ? ctx.t("obsOnAir", { question: onAir.question }) : ctx.t("obsAuto"), tab: "screen" },
      );
      if (manage) screen.push(
        ...(cfg.onAir ? [{ type: "adminForm", action: "screenAuto", submitLabel: ctx.t("obsAutoBtn"), fields: [], tab: "screen" }] : []),
        { type: "adminForm", action: "regenerate", title: ctx.t("obsRegenTitle"), submitLabel: ctx.t("obsRegenBtn"), fields: [{ name: "confirm", kind: "checkbox", label: ctx.t("obsRegenConfirm"), help: ctx.t("obsRegenHelp") }], tab: "screen" },
      );
    } else screen.push({ type: "markdown", text: ctx.t("obsNoRight"), tab: "screen" });

    // ── Modifier un sondage ──
    if (query?.edit) {
      const p = await findById(ctx, String(query.edit));
      if (!p) return [{ type: "banner", tone: "warning", text: ctx.t("errGone") }, { type: "markdown", text: `[${ctx.t("back")}](?)` }];
      const w = p.endsAt ? L.wallParts(p.endsAt, p.tz || tz) : { date: "", time: "" };
      const locked = (Number(p.voters) || 0) > 0;
      return [
        { type: "heading", text: ctx.t("editTitle") },
        { type: "markdown", text: `[${ctx.t("back")}](?poll=${encodeURIComponent(p.id)})` },
        ...(locked ? [{ type: "markdown", text: ctx.t("choicesLocked", { n: Number(p.voters) || 0 }) }] : []),
        { type: "adminForm", action: "update", submitLabel: ctx.t("save"), cancelHref: `?poll=${encodeURIComponent(p.id)}`,
          fields: [{ name: "id", kind: "hidden", value: p.id }, ...pollFields(ctx, { question: p.question, choices: p.choices.map((c) => c.text).join("\n"), max: p.max, resultsMode: p.resultsMode, endDate: w.date, endTime: w.time }, { withChoices: !locked })] },
        ...screen,
      ];
    }

    // ── Détails d'un sondage ──
    if (query?.poll) {
      const p = await findById(ctx, String(query.poll));
      if (!p) return [{ type: "banner", tone: "warning", text: ctx.t("errGone") }, { type: "markdown", text: `[${ctx.t("back")}](?)` }];
      const state = L.stateOf(p, now);
      const href = pollHref(ctx, p.slug);
      const rows = L.rows(p);
      const zone = p.tz || tz;
      const actions = [
        { label: ctx.t("actOnAir"), action: "onAir" },
        ...(state === "open" ? [{ label: ctx.t("actEdit"), href: "?edit={id}" }, { label: ctx.t("actClose"), action: "close", confirm: ctx.t("confirmClose") }]
          : [{ label: ctx.t("actReopen"), action: "reopen", confirm: ctx.t("confirmReopen") }, { label: ctx.t("actArchive"), action: "archive", confirm: ctx.t("confirmArchive") }]),
        { label: ctx.t("actCopy"), href: "?copy={id}" },
        ...(p.purgedAt ? [] : [{ label: ctx.t("actRecount"), action: "recount" }]),
        { label: ctx.t("actDelete"), action: "remove", confirm: ctx.t("confirmDelete"), danger: true },
      ];
      return [
        { type: "markdown", text: `[${ctx.t("back")}](?)` },
        { type: "heading", text: p.question },
        { type: "markdown", text: [
          `**${ctx.t(state === "open" ? "stateOpen" : "stateClosed")}** · ${votersText(ctx, Number(p.voters) || 0)}`,
          p.endsAt ? ctx.t(state === "open" ? "endsOn" : "endedOn", { date: L.formatEnd(p.endsAt, zone, ctx.locale) }) : ctx.t("noEnd"),
          ctx.t("detailRules", { max: Math.min(p.max || 1, p.choices.length), mode: ctx.t(p.resultsMode === "after" ? "resAfter" : "resAlways") }),
          p.purgedAt ? ctx.t("ballotsGone") : ctx.t("ballotsKept", { days: num(ctx.setting("retentionDays"), 30, 1, 90) }),
        ].join("\n\n") },
        ...(href ? [{ type: "copy", label: ctx.t("publicLink"), text: `${ctx.api.siteUrl}${href}` }] : [{ type: "markdown", text: ctx.t("noPage") }]),
        { type: "table", columns: [ctx.t("colChoice"), ctx.t("colVoices"), ctx.t("colPct")], rows: rows.map((r) => [`${r.text}${r.lead ? ` — ${ctx.t(state === "open" ? "leading" : "winner")}` : ""}`, String(r.count), `${r.pct} %`]) },
        ...(manage ? [{ type: "table", columns: [ctx.t("colPoll"), ctx.t("colState")], rows: [[p.question, ctx.t(state === "open" ? "stateOpen" : "stateClosed")]], rowIds: [p.id], rowActions: actions }] : []),
        ...screen,
      ];
    }

    // ── Liste ──
    const cursor = typeof query?.c === "string" && query.c.length < 400 ? query.c : null;
    const page = await ctx.api.store.page(POLLS, { limit: PAGE, cursor });
    const polls = page.items.map((r) => pollOf(r));
    const copy = query?.copy ? await findById(ctx, String(query.copy)) : null;
    const open = polls.filter((p) => L.stateOf(p, now) === "open").length;
    blocks.push({ type: "heading", text: ctx.t("adminTitle") });
    if (!polls.length && !cursor) blocks.push({ type: "markdown", text: ctx.t("adminEmpty") });
    if (manage) blocks.push({
      type: "adminForm", action: "create", title: ctx.t("newPoll"), submitLabel: ctx.t("create"),
      fields: pollFields(ctx, copy ? { question: copy.question, choices: copy.choices.map((c) => c.text).join("\n"), max: copy.max, resultsMode: copy.resultsMode } : {}),
    });
    if (polls.length) {
      blocks.push({ type: "heading", text: ctx.t("listTitle", { n: await ctx.api.store.count(POLLS), open }) });
      blocks.push({
        type: "table", columns: [ctx.t("colPoll"), ctx.t("colState"), ctx.t("colVoters"), ctx.t("colEnd")],
        rows: polls.map((p) => [p.question, ctx.t(L.stateOf(p, now) === "open" ? "stateOpen" : "stateClosed"), String(Number(p.voters) || 0), p.endsAt ? stamp(ctx, p.endsAt, p.tz || tz) : "—"]),
        rowIds: polls.map((p) => p.id),
        rowActions: [{ label: ctx.t("actDetails"), href: "?poll={id}" }, ...(manage ? [{ label: ctx.t("actDelete"), action: "remove", confirm: ctx.t("confirmDelete"), danger: true }] : [])],
      });
      if (page.next) blocks.push({ type: "markdown", text: `[${ctx.t("nextPage")}](?c=${encodeURIComponent(page.next)})` });
      const archived = await ctx.api.store.count(ARCHIVE);
      if (archived) blocks.push({ type: "markdown", text: ctx.t("archivedCount", { n: archived }) });
    }
    blocks.push({ type: "heading", text: ctx.t("limitsTitle") }, { type: "markdown", text: ctx.t("limitsText") });
    if (polls.length && manage) blocks.push({ type: "download", name: "results", label: ctx.t("downloadResults") });
    return [...blocks, ...screen];
  },

  adminActions: {
    create: needs("manage", async (ctx, values) => {
      const tz = tzOf(ctx);
      const v = L.validatePollForm(values, { tz });
      if (Object.keys(v.errors).length) return { errors: fieldErrors(ctx, v.errors) };
      const r = await createPoll(ctx, v.value, tz);
      if (!r.ok) return { error: ctx.t("errFull", { n: LIMITS.livePolls }) };
      return { ok: ctx.t("okCreated"), redirect: `?poll=${encodeURIComponent(r.id)}` };
    }),

    update: needs("manage", async (ctx, values) => {
      const p = await findById(ctx, values.id);
      if (!p) return { error: ctx.t("errGone") };
      const tz = p.tz || tzOf(ctx);
      const locked = (Number(p.voters) || 0) > 0;
      const v = L.validatePollForm(values, { tz, keepChoices: locked ? p.choices.map((c) => c.text) : null });
      // Une fin déjà passée n'est pas une erreur quand on ne change pas la date : on garde l'ancienne.
      if (v.errors.endDate === "end_past" && p.endsAt && L.wallParts(p.endsAt, tz).date === String(values.endDate ?? "").trim() && L.wallParts(p.endsAt, tz).time === String(values.endTime ?? "").trim()) { delete v.errors.endDate; v.value.endsAt = p.endsAt; }
      if (Object.keys(v.errors).length) return { errors: fieldErrors(ctx, v.errors) };
      await withLock(ctx, async () => {
        const f = await ctx.api.store.get(p.id);
        if (!f) return;
        const choices = locked ? f.data.choices : v.value.choices.map((text, i) => ({ id: `c${i + 1}`, text }));
        await ctx.api.store.update(p.id, { ...f.data, question: v.value.question, choices, max: v.value.max, resultsMode: v.value.resultsMode, endsAt: v.value.endsAt, tz, rev: (Number(f.data.rev) || 0) + 1 });
      });
      return { ok: ctx.t("okSaved"), redirect: `?poll=${encodeURIComponent(p.id)}` };
    }),

    close: needs("manage", async (ctx, values) => {
      const r = await closeNow(ctx, values.id);
      return r.ok ? { ok: ctx.t("okClosed") } : { error: ctx.t(r.error === "already" ? "errAlreadyClosed" : "errGone") };
    }),

    reopen: needs("manage", async (ctx, values) => {
      const p = await findById(ctx, values.id);
      if (!p) return { error: ctx.t("errGone") };
      if (p.purgedAt) return { error: ctx.t("errPurged") };
      await withLock(ctx, async () => { const f = await ctx.api.store.get(p.id); await ctx.api.store.update(p.id, { ...f.data, closedAt: null, endsAt: null, rev: (Number(f.data.rev) || 0) + 1 }); });
      return { ok: ctx.t("okReopened") };
    }),

    archive: needs("manage", async (ctx, values) => {
      const p = await findById(ctx, values.id);
      if (!p) return { error: ctx.t("errGone") };
      if (L.stateOf(p) !== "closed") return { error: ctx.t("errNotClosed") };
      await withLock(ctx, () => archiveOne(ctx, p));
      return { ok: ctx.t("okArchived"), redirect: "?" };
    }),

    remove: needs("manage", async (ctx, values) => {
      const p = await findById(ctx, values.id);
      if (!p) return { error: ctx.t("errGone") };
      await withLock(ctx, () => removePoll(ctx, p));
      return { ok: ctx.t("okDeleted"), redirect: "?" };
    }),

    recount: needs("manage", async (ctx, values) => {
      const r = await recount(ctx, values.id);
      return r.ok ? { ok: ctx.t("okRecount", { n: r.voters }) } : { error: ctx.t(r.error === "purged" ? "errPurged" : "errGone") };
    }),

    onAir: needs("manage", async (ctx, values) => {
      const p = await findById(ctx, values.id);
      if (!p) return { error: ctx.t("errGone") };
      const cfg = await ensureCfg(ctx);
      await saveCfg(ctx, { ...cfg, onAir: p.slug });
      return { ok: ctx.t("okOnAir") };
    }),

    screenAuto: needs("manage", async (ctx) => {
      const cfg = await ensureCfg(ctx);
      await saveCfg(ctx, { ...cfg, onAir: null });
      return { ok: ctx.t("okAuto") };
    }),

    regenerate: needs("obs.view", async (ctx, values) => {
      if (values.confirm !== "on") return { errors: { confirm: ctx.t("errConfirm") } };
      const cfg = await ensureCfg(ctx);
      await saveCfg(ctx, { ...cfg, obsKey: randomBytes(18).toString("base64url") });
      return { ok: ctx.t("okRegen") };
    }),
  },

  adminDownloads: {
    results: {
      right: "manage",
      contentType: "text/csv",
      filename: () => "polls",
      async *generate(ctx) {
        const cell = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
        yield `﻿${["id", "question", "state", "created", "ends", "voters", "results"].map(cell).join(",")}\r\n`;
        for (const col of [POLLS, ARCHIVE]) {
          let cursor = null;
          do {
            const page = await ctx.api.store.page(col, { limit: 500, cursor });
            for (const r of page.items) {
              const p = pollOf(r, col === ARCHIVE ? "archive" : "live");
              yield `${[p.slug, p.question, col === ARCHIVE ? "archived" : L.stateOf(p), p.createdAt, p.endsAt ?? "", p.voters ?? 0, L.rows(p).map((x) => `${x.text}: ${x.count}`).join(" | ")].map(cell).join(",")}\r\n`;
            }
            cursor = page.next;
          } while (cursor);
        }
      },
    },
  },

  mcp: {
    async polls_list(ctx, args) {
      const now = Date.now();
      const want = args?.state === "open" || args?.state === "closed" ? args.state : null;
      return (await livePolls(ctx)).filter((p) => !want || L.stateOf(p, now) === want).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, num(args?.limit, 20, 1, 100))
        .map((p) => ({ id: p.id, question: p.question, state: L.stateOf(p, now), voters: Number(p.voters) || 0, endsAt: p.endsAt ?? null, link: pollHref(ctx, p.slug) ? `${ctx.api.siteUrl}${pollHref(ctx, p.slug)}` : null }));
    },
    async poll_results(ctx, args) {
      const p = (await findById(ctx, args?.id)) ?? (await findPoll(ctx, args?.id));
      if (!p) throw Object.assign(new Error("poll not found"), { expose: true });
      return { id: p.id, question: p.question, state: L.stateOf(p), voters: Number(p.voters) || 0, maxChoices: p.max, endsAt: p.endsAt ?? null, results: L.rows(p).map((r) => ({ choice: r.text, votes: r.count, percent: r.pct })) };
    },
    async poll_create(ctx, args) {
      const tz = tzOf(ctx);
      const v = L.validatePollForm({ question: args?.question, choices: (Array.isArray(args?.choices) ? args.choices : []).join("\n"), max: args?.max ?? 1, resultsMode: args?.resultsMode }, { tz });
      if (Object.keys(v.errors).length) throw Object.assign(new Error(`invalid: ${Object.keys(v.errors).join(", ")} (question 1-${LIMITS.question} chars, ${LIMITS.minChoices}-${LIMITS.maxChoices} different choices, max between 1 and the number of choices)`), { expose: true });
      if (args?.endsAt !== undefined && args?.endsAt !== "") {
        const ms = Date.parse(String(args.endsAt));
        if (!Number.isFinite(ms) || ms <= Date.now() + 60_000 || ms - Date.now() > LIMITS.maxEndMs) throw Object.assign(new Error("endsAt must be a future date and time (ISO 8601, e.g. 2026-11-03T20:00:00+01:00), within a year"), { expose: true });
        v.value.endsAt = new Date(ms).toISOString();
      }
      const r = await createPoll(ctx, v.value, tz);
      if (!r.ok) throw Object.assign(new Error(`the site already keeps ${LIMITS.livePolls} polls and none is finished yet`), { expose: true });
      return { id: r.id, link: pollHref(ctx, r.slug) ? `${ctx.api.siteUrl}${pollHref(ctx, r.slug)}` : null };
    },
    async poll_close(ctx, args) {
      const r = await closeNow(ctx, args?.id);
      if (!r.ok) throw Object.assign(new Error(r.error === "already" ? "poll already closed" : "poll not found"), { expose: true });
      return { id: args.id, closed: true };
    },
  },

  backup: {
    async readable(ctx) {
      const cell = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
      const lines = [["id", "question", "state", "created", "ends", "voters", "results"].map(cell).join(",")];
      for (const col of [POLLS, ARCHIVE]) {
        let cursor = null;
        do {
          const page = await ctx.api.store.page(col, { limit: 500, cursor });
          for (const r of page.items) {
            const p = pollOf(r, col === ARCHIVE ? "archive" : "live");
            lines.push([p.slug, p.question, col === ARCHIVE ? "archived" : L.stateOf(p), p.createdAt, p.endsAt ?? "", p.voters ?? 0, L.rows(p).map((x) => `${x.text}: ${x.count}`).join(" | ")].map(cell).join(","));
          }
          cursor = page.next;
        } while (cursor);
      }
      return [{ path: "polls.csv", content: `﻿${lines.join("\r\n")}\r\n` }];
    },
  },

  hooks: {
    async onInstanceCreate(ctx) { await ensureCfg(ctx).catch(() => {}); },
    async onInstanceDelete(ctx) {
      for (const k of [...mem.hits.keys()]) if (k.split("|")[1] === ctx.instance.key) mem.hits.delete(k);
      mem.swept.delete(ctx.instance.key);
    },
  },
};
