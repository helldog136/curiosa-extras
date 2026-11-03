// Les sources de secours : une MÊME interface pour chacune. `search(ctx, source, title, opts)` → { kind: "ok", list } | { kind: "off" } | { kind: "refused" } | { kind: "unreachable", skipped? },
// où `list` est une liste de candidats { id, name, year, platforms, image, source } (image = adresse https permise par hosts.mjs, sinon le candidat est écarté).
//   rawg    RAWG, avec le code d'accès du site (rawg.mjs, inchangé : même disjoncteur, même état) ;
//   twitch  les catégories de Twitch (jaquettes de boîte), par le Connecteur Twitch (service `twitch.api`) : AUCUNE clé de plus ; sans Connecteur réglé, la source est « off » ;
//   steam   la recherche publique du magasin Steam, sans clé ni compte (son image est construite à partir du numéro du jeu).
// Chaque source a son disjoncteur (une source en panne ne gêne jamais les autres), son petit cache en mémoire (trouvé 24 h, « rien » 1 h, 300 recherches) et un délai borné.
// Jamais d'exception ; jamais de secret dans une valeur rendue.
const q = new URL(import.meta.url).search;
const hosts = await import(new URL("./hosts.mjs" + q, import.meta.url).href);
const { makeBreaker } = await import(new URL("./breaker.mjs" + q, import.meta.url).href);
const rawg = await import(new URL("./rawg.mjs" + q, import.meta.url).href);

export const { SOURCES } = hosts;
export const STEAM_SEARCH = "https://store.steampowered.com/api/storesearch/";
const MAX_BYTES = 128 * 1024;
const PAGE_SIZE = 8;
const FOUND_TTL = 24 * 3_600_000;
const NONE_TTL = 3_600_000;
const MAX_CACHE = 300;

const breakers = { twitch: makeBreaker(), steam: makeBreaker() };
const cache = new Map();
export const resetSources = () => { cache.clear(); for (const b of Object.values(breakers)) b.reset(); };
/** Pour l'écran et les tests : l'état du disjoncteur d'une source (RAWG : celui de rawg.mjs). */
export const breakerOf = (source) => (source === "rawg" ? rawg.breakerInfo() : breakers[source]?.info());

const shortText = (v, max) => (typeof v === "string" ? v.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
const within = (p, ms) => { let t; return Promise.race([Promise.resolve(p), new Promise((r) => { t = setTimeout(() => r(null), ms); t.unref?.(); })]).finally(() => clearTimeout(t)); };
const flag = (ctx, key) => { try { const v = ctx.setting?.(key); return !(v === false || v === "false" || v === 0 || v === "0" || v === "off"); } catch { return true; } };

// ── Twitch (par le Connecteur) ───────────────────────────────────────────────────────────────────────────────────────────
/** Lecture d'une catégorie Twitch : { id, name, box_art_url }. Une jaquette absente ou d'un autre hôte écarte le candidat. */
export function parseTwitch(r) {
  if (!r || typeof r !== "object") return null;
  const id = /^[0-9]{1,12}$/.test(String(r.id)) ? Number(r.id) : 0;
  const image = hosts.twitchBoxArt(r.box_art_url);
  const name = shortText(r.name, 150);
  return id > 0 && name && image ? { id, name, year: null, platforms: [], image, source: "twitch" } : null;
}

/** Le Connecteur Twitch est-il là et réglé (application Twitch complète) ? Sans appel réseau. */
export async function twitchReady(ctx) {
  if (!flag(ctx, "useTwitch")) return false;
  try {
    const providers = await within(Promise.resolve().then(() => ctx.api.services.providers("twitch.api")), 1_500);
    if (!Array.isArray(providers) || !providers.length) return false;
    const r = await within(Promise.resolve().then(() => ctx.api.services.call("twitch.api", "status", {})), 1_500);
    return !!(r && r.ok && r.value && r.value.ready === true);
  } catch { return false; }
}

async function queryTwitch(ctx, title, timeoutMs) {
  try {
    const r = await within(Promise.resolve().then(() => ctx.api.services.call("twitch.api", "request", { as: "app", method: "GET", path: "search/categories", query: { query: [title], first: [PAGE_SIZE] }, priority: "interactive" })), timeoutMs);
    if (!r) return { kind: "unreachable", down: true };
    if (!r.ok) return { kind: "off" };   // pas de Connecteur, ou service indisponible : une source de moins, pas une panne
    const v = r.value;
    if (!v || v.ok !== true) {
      const e = v?.error;
      if (e === "network") return { kind: "unreachable", down: true };
      if (e === "rate") return { kind: "unreachable", down: false };
      return { kind: "off" };   // forbidden (Connecteur trop ancien), config, auth, invalid
    }
    if (v.status === 401 || v.status === 403) return { kind: "off" };
    if (v.status >= 500 || v.status === 408) return { kind: "unreachable", down: true };
    if (v.status !== 200) return { kind: "unreachable", down: false };
    const data = Array.isArray(v.json?.data) ? v.json.data.slice(0, PAGE_SIZE) : [];
    return { kind: "ok", list: data.map(parseTwitch).filter(Boolean) };
  } catch { return { kind: "unreachable", down: true }; }
}

// ── Steam (recherche publique du magasin) ────────────────────────────────────────────────────────────────────────────────────
/** Lecture d'un résultat de la recherche du magasin : { type: "app", id, name }. L'image est construite à partir du numéro. */
export function parseSteam(r) {
  if (!r || typeof r !== "object" || r.type !== "app") return null;
  const id = typeof r.id === "number" && Number.isSafeInteger(r.id) && r.id > 0 && r.id < 10_000_000_000 ? r.id : 0;
  const name = shortText(r.name, 150);
  const image = id ? hosts.imagePath("steam", hosts.imageUrl("steam", `/store_item_assets/steam/apps/${id}/library_600x900.jpg`)) : null;
  return id && name && image ? { id, name, year: null, platforms: [], image: hosts.imageUrl("steam", image), source: "steam" } : null;
}

async function querySteam(ctx, title, timeoutMs) {
  const url = `${STEAM_SEARCH}?${new URLSearchParams({ term: title, l: "english", cc: "US" })}`;
  try {
    const r = await ctx.api.net.request({ url, headers: { accept: "application/json" }, timeoutMs, maxBytes: MAX_BYTES, priority: "interactive", bucket: "steam-store" });
    if (!r?.ok) return { kind: "unreachable", down: !r || r.error === "timeout" || r.error === "network" };
    if (r.status < 200 || r.status >= 300) return { kind: "unreachable", down: r.status >= 500 || r.status === 408 };
    if (!Array.isArray(r.json?.items)) return { kind: "unreachable", down: false };   // réponse inattendue : ni « rien » ni panne
    return { kind: "ok", list: r.json.items.slice(0, PAGE_SIZE).map(parseSteam).filter(Boolean) };
  } catch (error) {
    console.error("[game-covers] steam failed:", error?.name);
    return { kind: "unreachable", down: true };
  }
}

const RUNNERS = { twitch: queryTwitch, steam: querySteam };

/** La source est-elle utilisable maintenant ? { on: bool, why?: "no-key" | "refused" | "off" } (sans appel réseau). */
export async function availability(ctx, source) {
  if (source === "rawg") {
    const { key, valid } = await rawg.keyOf(ctx);
    return key ? (valid ? { on: true } : { on: false, why: "refused" }) : { on: false, why: "no-key" };
  }
  if (source === "twitch") return (await twitchReady(ctx)) ? { on: true } : { on: false, why: "off" };
  if (source === "steam") return flag(ctx, "useSteam") ? { on: true } : { on: false, why: "off" };
  return { on: false, why: "off" };
}

/** Une recherche chez une source. Ne lève jamais. `quiet` : n'écrit aucun état. */
export async function search(ctx, source, title, { timeoutMs = 3_000, quiet = false } = {}) {
  try {
    const words = rawg.cleanTitle(title);
    if (!words) return { kind: "ok", list: [] };
    if (source === "rawg") {
      const looked = await rawg.searchList(ctx, words, { quiet, timeoutMs });
      return looked.kind === "ok" ? { kind: "ok", list: looked.list.map((c) => ({ ...c, source: "rawg" })) } : looked;
    }
    const run = RUNNERS[source];
    if (!run) return { kind: "off" };
    if (!(await availability(ctx, source)).on) return { kind: "off" };
    const id = `${source}|${words.toLowerCase()}`;
    const hit = cache.get(id);
    if (hit && hit.until > Date.now()) return { kind: "ok", list: hit.list, fresh: false };
    const br = breakers[source];
    if (br.gate() === "wait") return { kind: "unreachable", skipped: true };
    const out = await run(ctx, words, timeoutMs);
    if (out.kind === "ok") {
      br.answered();
      if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
      cache.set(id, { list: out.list, until: Date.now() + (out.list.length ? FOUND_TTL : NONE_TTL) });
      return { kind: "ok", list: out.list, fresh: true };
    }
    if (out.kind === "unreachable") { if (out.down) br.failed(); return { kind: "unreachable" }; }
    br.answered();   // « off » : la source a répondu (elle n'est pas disponible), ce n'est pas une panne
    return { kind: "off" };
  } catch { return { kind: "unreachable" }; }
}
