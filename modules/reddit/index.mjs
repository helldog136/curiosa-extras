// Reddit — réseau social de Curiosa. Il fournit son bouton au cœur (sujet `social.link`, pour l'en-tête du site) et ses propres chiffres (sujet `social.stat`).
// Réglage : un identifiant ou l'adresse du profil. Rien n'est affiché tant qu'il n'est pas réglé ; seule une adresse https du bon site est acceptée.
// ═══ DÉBUT du bloc « adresse du profil » — GÉNÉRÉ par scripts/social-networks.mjs (node scripts/gen-social.mjs) : ne le modifiez pas à la main ═══
const NAME = "Reddit";
const ICON = "reddit";
const TEMPLATE = "https://www.reddit.com/user/{h}"; // {h} = le nom du compte ; null : l'adresse complète est obligatoire
const HOSTS = ["reddit.com"]; // null : n'importe quel serveur, mais une forme de profil est exigée (réseaux fédérés)
const HANDLE = new RegExp("^@?[A-Za-z0-9._-]{1,60}$"); // un nom de compte saisi seul
const TAG = "u/"; // texte devant le nom du compte dans le bouton
const ALIASES = []; // [adresse courte, vrai site]
const FORMS = [["^/?r/([A-Za-z0-9_]{2,21})/?$","https://www.reddit.com/r/{1}"],["^/?(?:u|user)/([A-Za-z0-9_-]{2,21})/?$","https://www.reddit.com/user/{1}"]]; // [forme courte, adresse complète]
const SHAPES = [{"re":"^/(?:u|user)/([A-Za-z0-9_-]{2,21})/?$","handle":true},{"re":"^/r/([A-Za-z0-9_]{2,21})/?$","prefix":"r/","template":"https://www.reddit.com/r/{h}"}]; // façons dont une adresse désigne un compte
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
/* ───────────── Statistiques (sujet `social.stat`) ─────────────
 * Ce module publie SES chiffres (vos abonnés) ; un autre module les collecte. Rien d'inventé : sans chiffre fiable, l'élément porte `error` et pas de `value`.
 * Une réponse est gardée 60 min (erreur : 5 min, limite de débit : 30 min) et n'est JAMAIS servie après son délai ; deux demandes simultanées partagent le même appel. */
const TTL = 60 * 60_000, FAIL_TTL = 5 * 60_000, RATE_TTL = 30 * 60_000;
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

const METRICS = ["followers"];
/** Les éléments `social.stat` d'un résultat. */
function statItems(ctx, target, r) {
  return METRICS.map((metric) => {
    const error = r.error ?? (r.stats[metric] === undefined && metric === "followers" ? "hidden" : null);
    if (!error && r.stats[metric] === undefined) return null;   // la plateforme n'a pas donné ce chiffre : on ne le publie pas
    return {
      id: `reddit:${ctx.instance.key}:${metric}`, platform: "reddit", account: r.account ?? target.account, accountKey: ctx.instance.key, metric, label: ctx.t(`stat_${metric}`),
      ...(error ? {} : { value: r.stats[metric] }), asOf: new Date(r.at).toISOString(), url: target.url, ...(error ? { error } : {}),
    };
  }).filter(Boolean);
}
const whyNot = (ctx, item, r) => ctx.t(item.error === "config" ? `err_config_${r.reason ?? "account"}` : `err_${item.error}`);
const wanted = (ctx) => ctx.setting("trackStats") !== false;   // activé par défaut : des chiffres publics, aucune clé à fournir

function targetOf(ctx) {
  const p = profile(ctx.setting("profile"));
  if (!p) return null;
  let kind = null, name = null;
  if (p.handle) { kind = "user"; name = p.handle; }
  else {
    const path = new URL(p.url).pathname;
    let m = /^\/(?:r|subreddit)\/([^/]+)(?:\/|$)/i.exec(path);
    if (m) { kind = "subreddit"; name = m[1]; } else if ((m = /^\/(?:u|user)\/([^/]+)(?:\/|$)/i.exec(path))) { kind = "user"; name = m[1]; }
  }
  if (!kind || !/^[A-Za-z0-9_-]{2,21}$/.test(name ?? "")) return null;
  return { kind, name, account: `${kind === "user" ? "u" : "r"}/${name}`, url: p.url };
}
/**
 * `about.json` public d'une communauté (`subscribers`) ou d'un profil (`subreddit.subscribers` : ses abonnés). Reddit demande un agent HTTP qui dit qui l'appelle et refuse volontiers les anonymes :
 * réponse gardée 60 minutes, et « rate » dit les choses clairement. Le karma n'est pas publié (il ne correspond à aucun des chiffres partagés).
 */
const measure = (ctx, t) => lookup(`${t.kind}|${t.name.toLowerCase()}`, async () => {
  const site = String(ctx.api?.siteUrl ?? "").replace(/\/+$/, "");
  const res = await get(`https://www.reddit.com/${t.kind === "user" ? "user" : "r"}/${encodeURIComponent(t.name)}/about.json?raw_json=1`, { redirect: "manual", headers: { Accept: "application/json", "User-Agent": `curiosa:statistics:1.1.0${site ? ` (+${site})` : ""}` } });
  if (res.status === 429) return { error: "rate" };
  if (res.status >= 300 && res.status < 400) return { error: "config", reason: "account" };   // Reddit renvoie vers une recherche quand la communauté n'existe pas
  if (res.status === 404) return { error: "config", reason: "account" };
  if (res.status === 403) {
    const reason = String((await readJson(res).catch(() => ({}))).reason ?? "");
    return /private|quarantined|banned/.test(reason) ? { error: "hidden" } : { error: "rate" };   // sans motif : Reddit bloque les demandes anonymes de ce serveur
  }
  if (!res.ok) return { error: "network" };
  const d = (await readJson(res)).data ?? {};
  const followers = t.kind === "user" ? d.subreddit?.subscribers : d.subscribers;
  return { account: t.account, stats: { followers: count(followers) } };
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
