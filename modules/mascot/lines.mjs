// Mascotte — ce qu'elle peut dire en ce moment. Les phrases écrites par la personne, remplies avec ce que le site sait (nom du site, prochain événement, direct en cours),
// plus les nouveautés que d'autres parties du site lui confient. Chaque source est FACULTATIVE : absente, lente ou en panne, la phrase qui en dépend n'existe pas, sans erreur.
//
// Précautions : on n'interroge une source que si une phrase de cette page l'emploie ; la réponse est gardée 2 minutes (30 secondes après un échec) quel que soit le nombre de visiteurs ;
// deux demandes en même temps partagent la même question ; personne n'attend plus de 2,5 secondes ; aucun minuteur de fond.
const v = new URL(import.meta.url).search;
const M = await import(new URL(`./model.mjs${v}`, import.meta.url).href);

export const timing = { waitMs: 2_500, keepMs: 120_000, errorMs: 30_000, hintsMs: 60_000, horizonMs: 45 * 86_400_000, freshNewsMs: 21 * 86_400_000 };
const memo = new Map();    // « instance|langue|source » → { until, value }
const pending = new Map(); // la question en cours (partagée)
export const resetFacts = () => { memo.clear(); pending.clear(); };

const ID_RE = /^[A-Za-z0-9:_.-]{1,100}$/;
const CHANNEL_RE = /^[a-zA-Z0-9_]{3,25}$/;
const VIDEO_RE = /^[\w-]{11}$/;
const ISO_RE = /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?(Z|[+-]\d\d:?\d\d)$/;
const httpsUrl = (u) => { const s = M.safeLink(u); return s.startsWith("https://") ? s : ""; };

async function within(promise, ms, fallback) {
  let t;
  const late = new Promise((resolve) => { t = setTimeout(() => resolve(fallback), ms); });
  try { return await Promise.race([promise, late]); } finally { clearTimeout(t); }
}

/** Réponse gardée : `read()` renvoie { ok, value } ; un échec garde la dernière bonne valeur (et ne redemande rien avant `errorMs`). */
async function remembered(ctx, name, read, keepMs = timing.keepMs) {
  const key = `${ctx.instance.key}|${ctx.locale}|${name}`;
  const hit = memo.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  let q = pending.get(key);
  if (!q) {
    q = Promise.resolve().then(read).then((r) => {
      const value = r.ok ? r.value : hit?.value ?? null;
      memo.set(key, { until: Date.now() + (r.ok ? keepMs : timing.errorMs), value });
      while (memo.size > 60) memo.delete(memo.keys().next().value);
      return value;
    }).catch(() => {
      memo.set(key, { until: Date.now() + timing.errorMs, value: hit?.value ?? null });
      return hit?.value ?? null;
    }).finally(() => pending.delete(key));
    pending.set(key, q);
  }
  return within(q, timing.waitMs, hit?.value ?? null);
}

const callAll = async (ctx, service, method, args) => {
  const svc = ctx.api.services;
  if (!svc || typeof svc.callAll !== "function") return [];
  try { const r = await svc.callAll(service, method, args); return Array.isArray(r) ? r.slice(0, 10) : []; } catch { return []; }
};

// ── Le prochain événement (service facultatif `event.source`) ───────────────────────────────────────────────────────
export function cleanEvent(e, now) {
  if (!e || typeof e !== "object" || typeof e.id !== "string" || !ID_RE.test(e.id)) return null;
  if (e.status === "cancelled" || e.status === "canceled") return null;
  const title = M.outside(e.title, 80);
  if (!title) return null;
  const allDay = e.allDay === true && /^\d{4}-\d\d-\d\d$/.test(String(e.day ?? ""));
  if (!allDay && !ISO_RE.test(String(e.start ?? ""))) return null;
  const startMs = Date.parse(allDay ? `${e.day}T00:00:00Z` : String(e.start));
  if (!Number.isFinite(startMs)) return null;
  if ((allDay ? startMs + 86_400_000 : startMs) < now || startMs > now + timing.horizonMs + 86_400_000) return null;
  return { id: e.id, title, at: startMs, marker: allDay ? `{{d:${e.day}}}` : `{{t:${new Date(startMs).toISOString()}}}`, url: httpsUrl(e.url) };
}
async function readEvent(ctx) {
  const now = Date.now();
  const answers = await callAll(ctx, "event.source", "upcoming", { from: new Date(now).toISOString(), to: new Date(now + timing.horizonMs).toISOString(), limit: 10, locale: ctx.locale });
  let best = null, answered = false;
  for (const a of answers) {
    const val = a?.ok === true ? a.value : null;
    if (!val || typeof val !== "object" || !Array.isArray(val.events)) continue;
    answered = true;
    for (const e of val.events.slice(0, 50)) { const c = cleanEvent(e, now); if (c && (!best || c.at < best.at)) best = c; }
  }
  return { ok: answered || answers.length === 0, value: best };
}

// ── Le direct en cours (services facultatifs `twitch.live` et `youtube.live`) ───────────────────────────────────────
async function readLive(ctx) {
  const [tw, yt] = await Promise.all([callAll(ctx, "twitch.live", "status", {}), callAll(ctx, "youtube.live", "current", {})]);
  const lives = [];
  let answered = false;
  for (const a of tw) {
    const s = a?.ok === true ? a.value : null;
    if (!s || typeof s !== "object") continue;
    answered = true;
    if (s.live === true && CHANNEL_RE.test(String(s.channel ?? ""))) lives.push({ name: M.outside(s.displayName || s.channel, 40), title: M.outside(s.title, 80), url: `https://www.twitch.tv/${s.channel}` });
  }
  for (const a of yt) {
    const s = a?.ok === true ? a.value : null;
    if (!s || typeof s !== "object") continue;
    answered = true;
    if (s.ok === true && s.live === true && VIDEO_RE.test(String(s.videoId ?? ""))) lives.push({ name: "YouTube", title: M.outside(s.title, 80), url: `https://www.youtube.com/watch?v=${s.videoId}` });
  }
  const unique = lives.filter((l, i) => lives.findIndex((x) => x.url === l.url) === i).slice(0, 3);
  return { ok: answered || (tw.length === 0 && yt.length === 0), value: unique.length ? unique : null };
}

// ── La dernière nouveauté publiée (sujet `feed.item`, celui du flux du site : articles, vidéos…) ───────────────────────
export function cleanLatest(rows, now) {
  let best = null;
  for (const row of (Array.isArray(rows) ? rows : []).slice(0, 50)) {
    if (!row || typeof row !== "object") continue;
    const title = M.outside(row.title, 80), url = M.safeLink(row.url), at = Date.parse(String(row.publishedAt ?? ""));
    if (!title || !url || !Number.isFinite(at) || at > now + 3_600_000 || now - at > timing.freshNewsMs) continue;
    if (!best || at > best.at) best = { id: `n${M.hash(url)}`, title, url, at };
  }
  return best;
}
async function readLatest(ctx) {
  try { return { ok: true, value: cleanLatest(await ctx.api.topics.collect("feed.item", { limit: 20 }), Date.now()) }; } catch { return { ok: false, value: null }; }
}

// ── Les nouveautés confiées par d'autres modules (sujet `mascot.hint`) ──────────────────────────────────────────────
export function cleanHint(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id ?? "");
  const text = M.outside(raw.text, M.LIMITS.text);
  if (!ID_RE.test(id) || !text) return null;
  return { id: `h${M.hash(id)}`, kind: "news", text, ...(M.safeLink(raw.url) ? { href: M.safeLink(raw.url) } : {}) };
}
async function readHints(ctx) {
  try {
    const rows = await ctx.api.topics.collect("mascot.hint", { limit: M.LIMITS.hints });
    return { ok: true, value: (Array.isArray(rows) ? rows : []).slice(0, M.LIMITS.hints).map(cleanHint).filter(Boolean) };
  } catch { return { ok: false, value: null }; }
}

/**
 * Les phrases à dire sur cette page : [{ id, kind, text, href? }]. `id` change quand le sujet change (autre événement, autre direct), pour que la mascotte
 * ne répète pas deux fois la même chose mais puisse parler d'une nouveauté. Ne lève jamais pour une source en panne.
 */
export async function buildLines(ctx, { config, phrases, path, announce, name }) {
  const lang = ctx.locale;
  const published = phrases.filter((p) => p.state === "published");
  const own = published.filter((p) => p.lang === "" || p.lang === lang);
  const pool = (own.length ? own : published.filter((p) => p.lang === "" || p.lang === ctx.defaultLocale)).filter((p) => p.pages.length === 0 || M.pathMatches(p.pages, path));
  const needs = new Set(pool.flatMap((p) => M.variablesIn(p.text).keys.map((k) => M.SOURCE_OF[k]).filter(Boolean)));
  const [event, lives, latest, hints, site] = await Promise.all([
    needs.has("event") ? remembered(ctx, "event", () => readEvent(ctx)) : null,
    needs.has("live") ? remembered(ctx, "live", () => readLive(ctx)) : null,
    needs.has("latest") ? remembered(ctx, "latest", () => readLatest(ctx), timing.hintsMs) : null,
    announce ? remembered(ctx, "hints", () => readHints(ctx), timing.hintsMs) : null,
    ctx.api.site ? Promise.resolve().then(() => ctx.api.site(ctx.locale)).catch(() => null) : null,
  ]);
  const liveNames = Array.isArray(lives) ? lives.map((l) => l.name).join(` ${ctx.t("and")} `) : "";
  const facts = {
    site: M.outside(site?.name, 80), name,
    event: event?.title, date: event?.marker,
    live: liveNames, liveTitle: Array.isArray(lives) ? lives[0]?.title : "",
    news: latest?.title,
  };
  const items = [];
  for (const p of pool) {
    const keys = M.variablesIn(p.text).keys;
    const text = M.fillText(p.text, facts);
    if (text === null) continue;
    const usesEvent = keys.includes("event") || keys.includes("date"), usesLive = keys.includes("live") || keys.includes("liveTitle"), usesNews = keys.includes("news");
    const href = p.link || (usesEvent && event?.url) || (usesLive && lives?.[0]?.url) || (usesNews && latest?.url) || "";
    const id = `p${p.id}${usesEvent && event ? `:${M.hash(event.id)}` : ""}${usesLive && lives ? `:${M.hash(lives.map((l) => l.url).join(","))}` : ""}${usesNews && latest ? `:${latest.id}` : ""}`;
    items.push({ id: id.slice(0, 100), kind: p.kind, text: text.slice(0, M.LIMITS.line), ...(href ? { href } : {}) });
  }
  if (Array.isArray(hints)) for (const h of hints) if (items.length < M.LIMITS.items) items.push(h);
  return items.slice(0, M.LIMITS.items);
}
