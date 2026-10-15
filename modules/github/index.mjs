// GitHub — réseau social de Curiosa. Il fournit son bouton au cœur (sujet `social.link`, pour l'en-tête du site) et ses propres chiffres (sujet `social.stat`).
// Réglage : un identifiant ou l'adresse du profil. Rien n'est affiché tant qu'il n'est pas réglé ; seule une adresse https du bon site est acceptée.
const NAME = "GitHub";
const ICON = "github";
const TEMPLATE = "https://github.com/{h}"; // {h} = l'identifiant ; null : adresse complète obligatoire
const HOSTS = ["github.com"]; // null : n'importe quel site https
const HANDLE = /^@?[A-Za-z0-9._-]{1,60}$/;

/** { url, handle } pour ce que l'utilisateur a saisi, ou null si c'est vide, mal formé ou d'un autre site. */
export function profile(value) {
  const v = String(value ?? "").trim();
  if (!v) return null;
  if (/^https:\/\//i.test(v)) {
    let u;
    try { u = new URL(v); } catch { return null; }
    if (u.protocol !== "https:" || u.username || u.password) return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (HOSTS && !HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return null;
    return { url: u.href, handle: null };
  }
  if (!TEMPLATE || !HANDLE.test(v)) return null;
  const handle = v.replace(/^@/, "");
  return { url: TEMPLATE.replace("{h}", encodeURIComponent(handle)), handle };
}

/* ───────────── Statistiques (sujet `social.stat`) ─────────────
 * Ce module publie SES chiffres (vos abonnés) ; un autre module les collecte. Rien d'inventé : sans chiffre fiable, l'élément porte `error` et pas de `value`.
 * Une réponse est gardée 30 min (erreur : 2 min, limite de débit : 15 min) et n'est JAMAIS servie après son délai ; deux demandes simultanées partagent le même appel. */
const TTL = 30 * 60_000, FAIL_TTL = 2 * 60_000, RATE_TTL = 15 * 60_000;
const memo = new Map(), pending = new Map();
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
  const run = load().catch(() => ({ error: "network" })).then((found) => {
    const value = { ...found, at: Date.now() };
    memo.set(key, { value, until: Date.now() + (value.error === "rate" ? RATE_TTL : value.error ? FAIL_TTL : TTL) });
    return value;
  }).finally(() => pending.delete(key));
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
      id: `github:${ctx.instance.key}:${metric}`, platform: "github", account: r.account ?? target.account, accountKey: ctx.instance.key, metric, label: ctx.t(`stat_${metric}`),
      ...(error ? {} : { value: r.stats[metric] }), asOf: new Date(r.at).toISOString(), url: target.url, ...(error ? { error } : {}),
    };
  }).filter(Boolean);
}
const whyNot = (ctx, item, r) => ctx.t(item.error === "config" ? `err_config_${r.reason ?? "account"}` : `err_${item.error}`);
const wanted = (ctx) => ctx.setting("trackStats") !== false;   // activé par défaut : des chiffres publics, aucune clé à fournir

function targetOf(ctx) {
  const p = profile(ctx.setting("profile"));
  if (!p) return null;
  const name = p.handle ?? new URL(p.url).pathname.split("/")[1];
  return /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(name ?? "") ? { name, account: name, url: p.url } : null;
}
/** `GET /users/<nom>` public. Sans clé GitHub limite à 60 demandes par heure et par adresse du serveur : réponse gardée 30 minutes, et « rate » dit les choses clairement. */
const measure = (ctx, t) => lookup(t.name.toLowerCase(), async () => {
  const res = await get(`https://api.github.com/users/${encodeURIComponent(t.name)}`, { headers: { Accept: "application/vnd.github+json", "User-Agent": "Curiosa-statistics", "X-GitHub-Api-Version": "2022-11-28" } });
  if (res.status === 403 || res.status === 429) return { error: "rate" };   // limite de débit (primaire ou secondaire)
  if (res.status === 404) return { error: "config", reason: "account" };
  if (!res.ok) return { error: "network" };
  const j = await readJson(res);
  return { account: typeof j.login === "string" && j.login.length <= 60 ? j.login : t.account, stats: { followers: count(j.followers) } };
});

export default {
  exports: {
    "social.link"(ctx) {
      const p = profile(ctx.setting("profile"));
      return p ? [{ label: p.handle ? `${NAME} · ${p.handle}` : NAME, url: p.url, icon: ICON }] : [];
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
