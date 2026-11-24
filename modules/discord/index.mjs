// Discord — a social network of Curiosa. It gives the core its button (topic `social.link`, for the site header) and its own figures (topic `social.stat`).
// Setting: an identifier or the profile address. Nothing is shown until it is set; only an https address of the right site is accepted.
// ═══ DÉBUT du bloc « adresse du profil » — GÉNÉRÉ par scripts/social-networks.mjs (node scripts/gen-social.mjs) : ne le modifiez pas à la main ═══
const NAME = "Discord";
const ICON = "discord";
const TEMPLATE = "https://discord.gg/{h}"; // {h} = le nom du compte ; null : l'adresse complète est obligatoire
const HOSTS = ["discord.gg","discord.com","discordapp.com"]; // null : n'importe quel serveur, mais une forme de profil est exigée (réseaux fédérés)
const HANDLE = new RegExp("^@?[A-Za-z0-9._-]{1,60}$"); // un nom de compte saisi seul
const TAG = ""; // texte devant le nom du compte dans le bouton
const ALIASES = []; // [adresse courte, vrai site]
const FORMS = []; // [forme courte, adresse complète]
const SHAPES = [{"host":"^discord\\.gg$","re":"^/([A-Za-z0-9-]{2,32})/?$","handle":true},{"host":"^discord(?:app)?\\.com$","re":"^/invite/([A-Za-z0-9-]{2,32})/?$","handle":true}]; // façons dont une adresse désigne un compte
const FEDIVERSE = false; // accepte @nom@serveur
const TRACKING = /^(?:utm_.*|igsh|igshid|si|s|t|fbclid|gclid|ref|ref_src|ref_url|mibextid|share_id|feature|_t|_r|sender_device|is_from_webapp|app)$/i; // suivi publicitaire, retiré de l'adresse
const SHAPE_RE = SHAPES.map((s) => ({ ...s, re: new RegExp(s.re), host: s.host ? new RegExp(s.host, "i") : null }));
const hostIs = (host, list) => list.some((h) => host === h || host.endsWith(`.${h}`));

/**
 * { url, handle, tag } pour ce que la personne a collé, ou null si c'est vide, mal formé ou d'un autre site.
 * Accepté : le nom seul (avec ou sans @), l'adresse avec ou sans https:// et avec ou sans www., les adresses courtes (fb.me, t.me…), @nom@serveur (réseaux fédérés).
 * Retiré : les paramètres de suivi (igsh, utm_*, fbclid…) et l'ancre. Jamais d'http, d'identifiants dans l'adresse ni de javascript:.
 * `url` est toujours la MÊME pour un même compte (celle du modèle), `tag` le texte du bouton (« monpseudo »), `handle` le nom du compte quand on le connaît.
 */
export function profile(value) {
  let v = String(value ?? "").trim().replace(/^<(.*)>$/s, "$1").replace(/^["'“«‘]+|["'”»’]+$/g, "").trim();
  if (!v || /\s/.test(v) || v.length > 300) return null;
  if (FEDIVERSE) { const m = /^@?([A-Za-z0-9_.-]{1,60})@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)$/.exec(v); if (m) v = `https://${m[2]}/@${m[1]}`; }
  for (const [form, url] of FORMS) { const m = new RegExp(form).exec(v); if (m) { v = url.replace("{1}", m[1]); break; } }
  if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) {   // « instagram.com/nom » sans https:// : seulement si le début est bien l'adresse de ce réseau
    const first = v.split(/[/?#]/)[0].toLowerCase().replace(/^www\./, "");
    const known = HOSTS ? [...HOSTS, ...ALIASES.map((a) => a[0])] : null;
    if (first.includes(".") && (known ? hostIs(first, known) : /^[^/]+\/(?:@|users\/)/.test(v))) v = `https://${v}`;
  }
  if (/^https:\/\//i.test(v)) {
    let u;
    try { u = new URL(v); } catch { return null; }
    if (u.protocol !== "https:" || u.username || u.password) return null;
    let host = u.hostname.toLowerCase().replace(/^www\./, "");
    for (const [short, real] of ALIASES) if (hostIs(host, [short])) { host = real.replace(/^www\./, ""); u.hostname = real; break; }
    if (HOSTS && !hostIs(host, HOSTS)) return null;
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    u.hash = "";
    for (const s of SHAPE_RE) {
      const hm = s.host ? s.host.exec(host) : null;
      if (s.host && !hm) continue;
      if (s.handle && !s.fromHost && HOSTS && !HOSTS.includes(host)) continue;   // un sous-domaine (gist.github.com) garde son adresse
      const pm = s.re.exec(u.pathname);
      const name = pm && (s.fromHost ? hm?.[1] : pm[1]);
      if (!name) continue;
      const handle = s.handle ? name : null;
      const model = s.template ?? (handle ? TEMPLATE : null);   // l'adresse du modèle : toujours la même pour un même compte
      return { url: model ? model.replace("{h}", encodeURIComponent(name)) : u.href, handle, tag: `${s.handle ? TAG : s.prefix ?? ""}${name}${s.withHost ? `@${host}` : ""}` };
    }
    return HOSTS ? { url: u.href, handle: null, tag: null } : null;
  }
  if (!TEMPLATE || !HANDLE.test(v)) return null;
  const handle = v.replace(/^@/, "");
  return { url: TEMPLATE.replace("{h}", encodeURIComponent(handle)), handle, tag: TAG + handle };
}

/** Le bouton du réseau : le même texte quelle que soit la façon dont l'adresse a été collée. */
export const buttonLabel = (p) => (p.tag ? `${NAME} · ${p.tag}` : NAME);
// ═══ FIN du bloc « adresse du profil » ═══
/* ───────────── Statistics (topic `social.stat`) ─────────────
 * This module publishes ITS figure (the member count, approximate); another module collects it. Nothing is invented: with no reliable figure, the item carries `error` and no `value`.
 * Two sources, in this order:
 *   1. The Discord bot of the connector (optional service `discord.api`, method `guildStats`), ONLY when it is ready AND this account is the bot's own server
 *      (an instance may be somebody else's Discord: the bot's number would be wrong there). The server is known from the invitation (`guild.id`), which never changes.
 *   2. The public invitation (`GET /invites/<code>?with_counts=true`), as before, with no bot and no key.
 * If both fail, the last figure is used while it is younger than its delay (30 minutes), with its real date; never older, never invented.
 * An answer is kept 30 min for an invitation, 5 min for the bot (errors: 2 min, rate limit: 15 min). Two simultaneous requests share the same call.
 * The connector is never waited for long (a few seconds, less in a public page) and a failure is never shown to visitors: the figure just comes from the next source. */
const TTL = 30 * 60_000, BOT_TTL = 5 * 60_000, FAIL_TTL = 2 * 60_000, RATE_TTL = 15 * 60_000, STATUS_TTL = 60_000;
const memo = new Map(), pending = new Map(), known = new Map(), lastGood = new Map();
let botMemo = null;
export const timing = { sharedMs: 15000, botMs: 3000 };   // milliseconds; an object so that the tests can shorten it
export const resetCache = () => { memo.clear(); pending.clear(); known.clear(); lastGood.clear(); botMemo = null; };
const MAX_BYTES = 200_000;
const SERVICE = "discord.api";
const SNOWFLAKE = /^[0-9]{15,25}$/;
const CONNECTOR_PAGE = "/admin/modules/discord-connector";

/** JSON body with a limit (a platform that answers anything does not fill the memory of the site). */
async function readJson(res) {
  if (!res.body?.getReader) return res.json();
  const reader = res.body.getReader(), chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) { await reader.cancel(); throw new Error("too big"); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
const count = (v) => (Number.isInteger(v) && v >= 0 ? v : undefined);
const remember = (map, k, v, max = 50) => { map.delete(k); map.set(k, v); while (map.size > max) map.delete(map.keys().next().value); };

/** Waits for `p` at most `ms`, else `fallback()`. The timer is always released and never keeps the process alive. */
function within(p, ms, fallback) {
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(fallback()), ms); timer.unref?.(); });
  return Promise.race([Promise.resolve(p).catch(() => fallback()), late]).finally(() => clearTimeout(timer));
}
/** Delay of a step: `ms`, or less when the public page has no more time than that (300 ms are kept to show the fallback). */
function limit(ctx, ms) {
  const b = typeof ctx.api?.net?.budgetMs === "function" ? ctx.api.net.budgetMs() : null;
  return typeof b === "number" && b > 0 ? Math.max(100, Math.min(ms, b - 300)) : ms;
}

/** { stats, account, at } or { error, reason?, at } for an account; `load` makes the call (never throws). `load` may add `ttl` (how long a good answer is kept). */
function lookup(key, load) {
  const hit = memo.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const running = pending.get(key);
  if (running) return running;
  // Never endless: if the call (reading the body included) does not end within `timing.sharedMs`, everybody receives "network" and the shared entry is removed
  // (else every following request would wait for the same promise until the restart). The timer is released and does not hold the process.
  let timer;
  const expiry = new Promise((resolve) => { timer = setTimeout(() => resolve({ error: "network" }), timing.sharedMs); timer.unref?.(); });
  const run = Promise.race([Promise.resolve().then(load).catch(() => ({ error: "network" })), expiry]).then(({ ttl, ...found }) => {
    const value = { ...found, at: Date.now() };
    memo.set(key, { value, until: Date.now() + (value.error === "rate" ? RATE_TTL : value.error ? FAIL_TTL : ttl ?? TTL) });
    return value;
  }).finally(() => { clearTimeout(timer); if (pending.get(key) === run) pending.delete(key); });
  pending.set(key, run);
  return run;
}
const get = (url, init = {}) => fetch(url, { signal: AbortSignal.timeout(6000), ...init });

const METRICS = ["followers"];
/** The `social.stat` items of a result. */
function statItems(ctx, target, r) {
  return METRICS.map((metric) => {
    const error = r.error ?? (r.stats[metric] === undefined && metric === "followers" ? "hidden" : null);
    if (!error && r.stats[metric] === undefined) return null;   // the platform did not give this figure: it is not published
    return {
      id: `discord:${ctx.instance.key}:${metric}`, platform: "discord", account: r.account ?? target.account, accountKey: ctx.instance.key, metric, label: ctx.t(`stat_${metric}`),
      ...(error ? {} : { value: r.stats[metric] }), asOf: new Date(r.at).toISOString(), url: target.url, ...(error ? { error } : {}),
    };
  }).filter(Boolean);
}
const whyNot = (ctx, item, r) => ctx.t(item.error === "config" ? `err_config_${r.reason ?? "account"}` : `err_${item.error}`);
const wanted = (ctx) => ctx.setting("trackStats") !== false;   // on by default: public figures, no key to provide

const CODE = /^[A-Za-z0-9-]{2,32}$/;
/** The code of a Discord invitation: the code alone, or its address (discord.gg/…, discord.com/invite/…, with or without https://). Nothing else. */
export function inviteCode(value) {
  const p = profile(value);
  return p?.handle && CODE.test(p.handle) ? p.handle : null;
}
function targetOf(ctx) {
  const p = profile(ctx.setting("profile"));
  const typed = String(ctx.setting("invite") ?? "").trim();
  if (!p && !typed) return null;
  const code = inviteCode(typed) ?? (p ? inviteCode(ctx.setting("profile")) : null);   // the dedicated invitation link first, else the profile if it IS an invitation
  return { code, account: "Discord", url: code ? `https://discord.gg/${code}` : p?.url };
}
/** `GET /invites/<code>?with_counts=true`: APPROXIMATE member count. Without an invitation: "config" (no request). The server of the invitation is remembered (`known`). */
const measureInvite = (ctx, t) => t.code ? lookup(t.code, async () => {
  const res = await get(`https://discord.com/api/v10/invites/${encodeURIComponent(t.code)}?with_counts=true`, { headers: { Accept: "application/json", "User-Agent": "Curiosa-statistics" } });
  if (res.status === 429) return { error: "rate" };
  if (res.status === 404) return { error: "config", reason: "expired" };
  if (!res.ok) return { error: "network" };
  const j = await readJson(res);
  const name = typeof j.guild?.name === "string" ? j.guild.name.trim() : "";
  const guildId = typeof j.guild?.id === "string" && SNOWFLAKE.test(j.guild.id) ? j.guild.id : null;
  if (guildId) remember(known, t.code, { guildId, name: name && name.length <= 100 ? name : null });
  return { account: name && name.length <= 100 ? name : t.account, stats: { followers: count(j.approximate_member_count) } };
}) : Promise.resolve({ error: "config", reason: "invite", at: Date.now() });

/** A call to the optional service `discord.api`: { ok: true, value } with the connector's own answer, or { ok: false, reason } (never throws, never waits long). */
async function viaService(ctx, method) {
  if (typeof ctx.api?.services?.call !== "function") return { ok: false, why: "unavailable" };
  const r = await within(Promise.resolve().then(() => ctx.api.services.call(SERVICE, method, {})), limit(ctx, timing.botMs), () => ({ ok: false, why: "timeout" }));
  if (!r?.ok) return { ok: false, why: r?.reason === "unavailable" || r?.reason === "undeclared" || r?.reason === "no_method" ? "unavailable" : r?.reason ?? "failed" };
  const v = r.value;
  if (!v || typeof v !== "object") return { ok: false, why: "failed" };
  return v.ok === true ? { ok: true, value: v } : { ok: false, why: typeof v.reason === "string" ? v.reason : "failed" };
}
/**
 * The bot of the connector: { ready: true, guildId } or { ready: false, gap } with gap = "absent" (no connector), "setup" (installed, not set up) or "degraded" (set up, does not answer).
 * Kept one minute (a Discord page of the admin or a public page may ask as often as it likes).
 */
async function botStatus(ctx) {
  if (botMemo && botMemo.until > Date.now()) return botMemo.value;
  const r = await viaService(ctx, "status");
  let value;
  if (!r.ok) value = { ready: false, gap: r.why === "unavailable" ? "absent" : r.why === "not_configured" ? "setup" : "degraded" };
  else if (r.value.bot !== true) value = { ready: false, gap: "setup" };
  else if (typeof r.value.guildId === "string" && SNOWFLAKE.test(r.value.guildId)) value = { ready: true, guildId: r.value.guildId };
  else value = { ready: false, gap: "setup" };
  botMemo = { value, until: Date.now() + (value.ready || value.gap !== "degraded" ? STATUS_TTL : STATUS_TTL / 2) };
  return value;
}
/** The member count of the bot's server (`guildStats`; the connector keeps it 5 minutes too). Failure: { error, botGap } where botGap says what to show the owner. */
const measureBot = (ctx, guildId) => lookup(`bot:${guildId}`, async () => {
  const r = await viaService(ctx, "guildStats");
  const n = r.ok ? count(r.value.memberCount) : undefined;
  if (n !== undefined) return { stats: { followers: n }, ttl: BOT_TTL };
  return { error: r.why === "rate_limited" ? "rate" : "network", botGap: r.why === "not_configured" ? "setup" : "degraded" };
});

/**
 * The figure of an account, from the first source that gives it (see above): { stats, account, at, source: "bot" | "invite", gap? } or { error, reason?, at }.
 * `gap` says why the bot is NOT the source when the owner could do something about it: "absent" (no connector), "setup" (not set up) or "degraded" (set up, does not answer).
 * An account that is not the bot's server never gets a `gap` (the bot is not meant for it).
 */
async function measure(ctx, t) {
  const bot = await botStatus(ctx);
  const id = key(ctx, t);
  let gap = bot.ready ? null : bot.gap;
  let invite;
  if (bot.ready) {
    let k = t.code ? known.get(t.code) : undefined;
    if (!k && t.code) { invite = await measureInvite(ctx, t); k = known.get(t.code); }   // the invitation tells which server this account is
    if (k && k.guildId === bot.guildId) {
      const b = await measureBot(ctx, bot.guildId);
      if (b.stats) { const v = { ...b, account: k.name ?? t.account, source: "bot" }; remember(lastGood, id, v); return v; }
      gap = b.botGap ?? "degraded";
    }
  }
  invite ??= await measureInvite(ctx, t);
  if (invite.stats) { remember(lastGood, id, { ...invite, source: "invite" }); return { ...invite, source: "invite", ...(gap ? { gap } : {}) }; }
  const { gap: _was, ...old } = lastGood.get(id) ?? {};
  if (old.stats && Date.now() - old.at < TTL) return { ...old, ...(gap ? { gap } : {}) };
  return invite;
}
const key = (ctx, t) => t.code ?? `i:${ctx.instance.key}`;

/**
 * The lines of the figures panel (R33): "label: value"; a figure that does not come says why. If ALL the figures say the same thing, it is written once, without label
 * (the message already names the platform).
 */
function statLines(ctx, items, why) {
  const texts = items.map((i) => (i.error ? why(i) : null));
  if (items.length && texts.every((t) => t !== null && t === texts[0])) return [texts[0]];
  return items.map((i, n) => ctx.t("stat_line", { label: i.label, value: texts[n] ?? i.value.toLocaleString(ctx.locale) }));
}

/** One plain line: where the figure comes from, and the ONE way to the connector when the bot could count but does not (not installed: the core's own suggestion, which installs nothing by itself). */
function sourceBlocks(ctx, r) {
  const link = r.gap === "setup" ? "link_setup" : r.gap === "degraded" ? "link_check" : null;
  const line = ctx.t(r.source === "bot" ? "source_bot" : "source_invite") + (link ? ` [${ctx.t(link)}](${CONNECTOR_PAGE})` : "");
  return [{ type: "markdown", text: line }, ...(r.gap === "absent" ? [{ type: "suggestInstall", service: SERVICE, min: 1, reason: ctx.t("suggest_reason") }] : [])];
}

export default {
  exports: {
    "social.link"(ctx) {
      const p = profile(ctx.setting("profile"));
      return p ? [{ label: buttonLabel(p), url: p.url, icon: ICON }] : [];
    },
    /** The figures of the account (see above). Nothing until the account is set or "Follow my statistics" is unticked. */
    async "social.stat"(ctx, args) {
      if (!wanted(ctx)) return [];
      const target = targetOf(ctx);
      if (!target) return [];
      const items = statItems(ctx, target, await measure(ctx, target));
      return Number.isInteger(args?.limit) && args.limit > 0 ? items.slice(0, args.limit) : items;
    },
  },
  /** What is followed, where the figure comes from and, in case of a problem, what to do (plain words). */
  async adminPanel(ctx) {
    if (!wanted(ctx)) return [];
    const target = targetOf(ctx);
    if (!target) return [];
    const r = await measure(ctx, target);
    const items = statItems(ctx, target, r);
    const lines = statLines(ctx, items, (i) => whyNot(ctx, i, r));
    if (!lines.length) return [];
    return [{ type: "markdown", text: lines.join("\n\n") }, ...(items.some((i) => !i.error) ? sourceBlocks(ctx, r) : [])];
  },
};
