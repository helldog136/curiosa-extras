// Mastodon — réseau social de Curiosa. Il fournit son bouton au cœur (sujet `social.link`, pour l'en-tête du site) et ses propres chiffres (sujet `social.stat`).
// Réglage : un identifiant ou l'adresse du profil. Rien n'est affiché tant qu'il n'est pas réglé ; seule une adresse https du bon site est acceptée.
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
// ═══ DÉBUT du bloc « adresse du profil » — GÉNÉRÉ par scripts/social-networks.mjs (node scripts/gen-social.mjs) : ne le modifiez pas à la main ═══
const NAME = "Mastodon";
const ICON = "mastodon";
const TEMPLATE = null; // {h} = le nom du compte ; null : l'adresse complète est obligatoire
const HOSTS = null; // null : n'importe quel serveur, mais une forme de profil est exigée (réseaux fédérés)
const HANDLE = new RegExp("^@?[A-Za-z0-9._-]{1,60}$"); // un nom de compte saisi seul
const TAG = ""; // texte devant le nom du compte dans le bouton
const ALIASES = []; // [adresse courte, vrai site]
const FORMS = []; // [forme courte, adresse complète]
const SHAPES = [{"re":"^/@([A-Za-z0-9_.-]{1,60})/?$","withHost":true},{"re":"^/users/([A-Za-z0-9_.-]{1,60})/?$","withHost":true},{"re":"^/@([A-Za-z0-9_.-]{1,60}@[A-Za-z0-9.-]{1,200})/?$"}]; // façons dont une adresse désigne un compte
const FEDIVERSE = true; // accepte @nom@serveur
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
/* ───────────── Statistiques (sujet `social.stat`) ─────────────
 * Ce module publie SES chiffres (vos abonnés et vos publications) ; un autre module les collecte. Rien d'inventé : sans chiffre fiable, l'élément porte `error` et pas de `value`.
 * Une réponse est gardée 30 min (erreur : 2 min, limite de débit : 15 min) et n'est JAMAIS servie après son délai ; deux demandes simultanées partagent le même appel. */
const TTL = 30 * 60_000, FAIL_TTL = 2 * 60_000, RATE_TTL = 15 * 60_000;
const memo = new Map(), pending = new Map();
export const timing = { sharedMs: 15000 };   // millisecondes ; un objet pour que les tests puissent le raccourcir
export const resetCache = () => { memo.clear(); pending.clear(); };
const MAX_BYTES = 200_000;

/** Corps JSON borné (une plateforme qui répond n'importe quoi ne remplit pas la mémoire du site). */
async function readJson(res) {
  if (!res.body?.getReader) return res.json();
  const reader = res.body.getReader(), chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) { await reader.cancel(); throw new Error("trop gros"); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
const count = (v) => (Number.isInteger(v) && v >= 0 ? v : undefined);

/** { stats, account, at } ou { error, reason?, at } pour un compte ; `load` fait l'appel (jamais d'exception). */
function lookup(key, load) {
  const hit = memo.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const running = pending.get(key);
  if (running) return running;
  // Jamais éternel : si l'appel (lecture du corps comprise) ne se termine pas dans `timing.sharedMs`, tout le monde reçoit « network » et l'entrée partagée est retirée
  // (sinon chaque demande suivante attendrait la même promesse jusqu'au redémarrage). Le minuteur est libéré et ne retient pas le processus.
  let timer;
  const expiry = new Promise((resolve) => { timer = setTimeout(() => resolve({ error: "network" }), timing.sharedMs); timer.unref?.(); });
  const run = Promise.race([Promise.resolve().then(load).catch(() => ({ error: "network" })), expiry]).then((found) => {
    const value = { ...found, at: Date.now() };
    memo.set(key, { value, until: Date.now() + (value.error === "rate" ? RATE_TTL : value.error ? FAIL_TTL : TTL) });
    return value;
  }).finally(() => { clearTimeout(timer); if (pending.get(key) === run) pending.delete(key); });
  pending.set(key, run);
  return run;
}
const get = (url, init = {}) => fetch(url, { signal: AbortSignal.timeout(6000), ...init });

const METRICS = ["followers", "content"];
/** Les éléments `social.stat` d'un résultat. */
function statItems(ctx, target, r) {
  return METRICS.map((metric) => {
    const error = r.error ?? (r.stats[metric] === undefined && metric === "followers" ? "hidden" : null);
    if (!error && r.stats[metric] === undefined) return null;   // la plateforme n'a pas donné ce chiffre : on ne le publie pas
    return {
      id: `mastodon:${ctx.instance.key}:${metric}`, platform: "mastodon", account: r.account ?? target.account, accountKey: ctx.instance.key, metric, label: ctx.t(`stat_${metric}`),
      ...(error ? {} : { value: r.stats[metric] }), asOf: new Date(r.at).toISOString(), url: target.url, ...(error ? { error } : {}),
    };
  }).filter(Boolean);
}
const whyNot = (ctx, item, r) => ctx.t(item.error === "config" ? `err_config_${r.reason ?? "account"}` : `err_${item.error}`);
const wanted = (ctx) => ctx.setting("trackStats") !== false;   // activé par défaut : des chiffres publics, aucune clé à fournir

/**
 * Public address check: https only, no credentials or port, never a local or private machine (the site's server calls it: no request to the internal network).
 * Redirects are followed by hand and every hop is checked again, including the addresses its name resolves to (see `resolvesToPublic`).
 */
export function isPublicHttpsUrl(value) {
  let url;
  try { url = new URL(String(value).trim()); } catch { return false; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (isIP(host)) return !isPrivateAddress(host);
  return host.includes(".");
}

/** The 8 groups of an IPv6 address as numbers (null if unreadable). Handles "::" and a trailing IPv4 part (::ffff:1.2.3.4). */
function ipv6Groups(a) {
  let s = a.split("%")[0];
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) {
    const b = v4[1].split(".").map(Number);
    s = `${s.slice(0, -v4[1].length)}${((b[0] << 8) | b[1]).toString(16)}:${((b[2] << 8) | b[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [], tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const parts = [...head, ...Array(Math.max(fill, 0)).fill("0"), ...tail];
  if (parts.length !== 8 || !parts.every((x) => /^[0-9a-f]{1,4}$/.test(x))) return null;
  return parts.map((x) => parseInt(x, 16));
}
/**
 * True for any address the site must never call: private, loopback, link-local (169.254.x.x, cloud metadata), shared (100.64.0.0/10), reserved,
 * documentation, multicast, IPv6 unique local (fc00::/7), link-local (fe80::/10) and every IPv6 form that wraps an IPv4 address.
 * Only ordinary public unicast addresses pass. An unreadable value is refused.
 */
export function isPrivateAddress(ip) {
  const a = String(ip ?? "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  const v = isIP(a);
  if (v === 4) {
    const [p, q, r] = a.split(".").map(Number);
    return p === 0 || p === 10 || p === 127 || (p === 100 && q >= 64 && q <= 127) || (p === 169 && q === 254) || (p === 172 && q >= 16 && q <= 31)
      || (p === 192 && q === 0 && (r === 0 || r === 2)) || (p === 192 && q === 88 && r === 99) || (p === 192 && q === 168) || (p === 198 && (q === 18 || q === 19))
      || (p === 198 && q === 51 && r === 100) || (p === 203 && q === 0 && r === 113) || p >= 224;
  }
  if (v === 6) {
    const g = ipv6Groups(a);
    if (!g) return true;
    // an IPv4 address carried in IPv6 (mapped ::ffff:a.b.c.d, compatible ::a.b.c.d, translated 64:ff9b::/96): judged as that IPv4 address
    const embedded = g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0) || (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0));
    if (embedded && !(g[5] === 0 && g[6] === 0 && g[7] <= 1)) return isPrivateAddress(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`);
    if ((g[0] & 0xe000) !== 0x2000) return true;   // only global unicast (2000::/3) is public: ::, ::1, fc00::/7, fe80::/10, ff00::/8… are refused
    return (g[0] === 0x2001 && g[1] === 0x0db8) || (g[0] === 0x2001 && g[1] < 0x200) || g[0] === 0x2002 || (g[0] === 0x3fff && g[1] < 0x1000);   // documentation, Teredo and protocol range, 6to4
  }
  return true;
}

/** For tests: replaces the name resolution (never a real network). `resolve(host)` gives a list of addresses (strings or { address }). */
export const hooks = { resolve: null };
const systemResolve = (host) => dnsLookup(host, { all: true, verbatim: true });
/** "public" when every address the name resolves to is public, "private" when one of them is not, "unknown" when the name does not resolve. */
async function resolvesToPublic(host) {
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(h)) return isPrivateAddress(h) ? "private" : "public";
  let found;
  try { found = await (hooks.resolve ?? systemResolve)(h); } catch { return "unknown"; }
  const list = (Array.isArray(found) ? found : [found]).map((x) => (typeof x === "string" ? x : x?.address)).filter(Boolean);
  if (!list.length) return "unknown";
  return list.some(isPrivateAddress) ? "private" : "public";
}
function targetOf(ctx) {
  const p = profile(ctx.setting("profile"));
  if (!p || !isPublicHttpsUrl(p.url)) return null;
  const u = new URL(p.url), path = u.pathname;
  const m = /^\/@([A-Za-z0-9_.-]{1,60})(?:@([A-Za-z0-9.-]{1,200}))?\/?$/.exec(path) ?? /^\/users\/([A-Za-z0-9_.-]{1,60})\/?$/.exec(path);
  if (!m) return null;
  const host = u.hostname.toLowerCase();
  return { host, acct: m[2] ? `${m[1]}@${m[2]}` : m[1], account: `${m[1]}@${host}`, url: p.url };
}
/** The response, or null (unreachable, too many redirects, a redirect to a non-public address), or "private" when the account's own server resolves to a private address. */
async function getPublic(first) {
  let current = first;
  for (let hop = 0; hop <= 2; hop++) {
    if (!isPublicHttpsUrl(current)) return null;
    const where = await resolvesToPublic(new URL(current).hostname);
    if (where !== "public") return where === "private" && hop === 0 ? "private" : null;
    const res = await get(current, { redirect: "manual", headers: { Accept: "application/json", "User-Agent": "Curiosa-statistics" } });
    const location = res.status >= 300 && res.status < 400 ? res.headers?.get?.("location") : null;
    if (!location) return res;
    current = new URL(location, current).href;
  }
  return null;
}
/** `GET /api/v1/accounts/lookup?acct=…` sur le serveur du compte : abonnés et publications. */
const measure = (ctx, t) => lookup(`${t.host}|${t.acct.toLowerCase()}`, async () => {
  const res = await getPublic(`https://${t.host}/api/v1/accounts/lookup?acct=${encodeURIComponent(t.acct)}`);
  if (res === "private") return { error: "config", reason: "private" };
  if (!res) return { error: "network" };
  if (res.status === 429) return { error: "rate" };
  if (res.status === 401 || res.status === 403) return { error: "hidden" };   // serveur qui n'ouvre pas ses chiffres au public
  if (res.status === 404 || res.status === 410 || res.status === 422) return { error: "config", reason: "account" };
  if (!res.ok) return { error: "network" };
  const j = await readJson(res);
  return { account: t.account, stats: { followers: count(j.followers_count), content: count(j.statuses_count) } };
});

export default {
  exports: {
    "social.link"(ctx) {
      const p = profile(ctx.setting("profile"));
      return p ? [{ label: buttonLabel(p), url: p.url, icon: ICON }] : [];
    },
    /** Les chiffres du compte (voir plus haut). Rien tant que le compte n'est pas réglé ou que « Suivre mes statistiques » est décoché. */
    async "social.stat"(ctx, args) {
      if (!wanted(ctx)) return [];
      const target = targetOf(ctx);
      if (!target) return [];
      const items = statItems(ctx, target, await measure(ctx, target));
      return Number.isInteger(args?.limit) && args.limit > 0 ? items.slice(0, args.limit) : items;
    },
  },
  /** Ce qui est suivi et, en cas de problème, quoi faire (mots simples). */
  async adminPanel(ctx) {
    if (!wanted(ctx)) return [];
    const target = targetOf(ctx);
    if (!target) return [];
    const r = await measure(ctx, target);
    const rows = statItems(ctx, target, r).map((i) => [i.label, i.error ? whyNot(ctx, i, r) : i.value.toLocaleString(ctx.locale)]);
    return [{ type: "heading", text: ctx.t("stats_title") }, { type: "table", columns: [ctx.t("col_stat"), ctx.t("col_value")], rows }, ...[]];
  },
};
