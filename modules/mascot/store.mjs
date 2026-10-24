// Mascotte — les données (le seul fichier qui touche au stockage). Deux collections :
//   « config »  : un seul document (l'apparence et l'état publié / brouillon) ;
//   « phrases » : une ligne par phrase (100 au plus).
// Les lectures sont gardées quelques secondes en mémoire (la mascotte est lue à chaque page vue) ; toute écriture faite ici vide la mémoire tout de suite.
const v = new URL(import.meta.url).search;
const M = await import(new URL(`./model.mjs${v}`, import.meta.url).href);

export const COLLECTIONS = { config: "config", phrases: "phrases" };
export const timing = { keepMs: 15_000 };
const memo = new Map(); // clé d'instance → { at, config, phrases }
const forget = (ctx) => memo.delete(ctx.instance.key);
export const resetStore = () => memo.clear();

const text = (x, max) => M.oneLine(x, max);

/** Une valeur par langue (objet { langue: texte }) → nettoyée et bornée. */
function perLang(raw, max) {
  const out = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) for (const [k, val] of Object.entries(raw).slice(0, 12)) if (/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(k) && text(val, max)) out[k] = text(val, max);
  return out;
}

export function normalizeConfig(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    published: r.published === true,
    seeded: r.seeded === true,
    look: r.look === "image" ? "image" : "builtin",
    image: M.safeImage(r.image),
    crop: r.crop === "square" ? "square" : "round",
    names: perLang(r.names, M.LIMITS.name),
    alts: perLang(r.alts, M.LIMITS.alt),
  };
}

export function normalizePhrase(id, raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const pages = M.parsePages(Array.isArray(r.pages) ? r.pages.join("\n") : "").list;
  return {
    id, kind: M.KINDS.includes(r.kind) ? r.kind : "hello", lang: /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(String(r.lang ?? "")) ? r.lang : "",
    text: text(r.text, M.LIMITS.text), pages, link: M.safeLink(r.link), state: r.state === "draft" ? "draft" : "published", at: Number(r.at) || 0,
  };
}

async function load(ctx) {
  const key = ctx.instance.key;
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < timing.keepMs) return hit;
  const [cfgRows, phraseRows] = await Promise.all([ctx.api.store.list(COLLECTIONS.config, { limit: 1 }), ctx.api.store.list(COLLECTIONS.phrases, { limit: M.LIMITS.phrases + 20 })]);
  const config = normalizeConfig(cfgRows[0]?.data);
  const phrases = phraseRows.map((r) => normalizePhrase(r.id, r.data)).filter((p) => p.text).sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1)).slice(0, M.LIMITS.phrases);
  const value = { at: Date.now(), config, phrases, configId: cfgRows[0]?.id ?? null };
  memo.set(key, value);
  while (memo.size > 20) memo.delete(memo.keys().next().value);
  return value;
}

export const loadConfig = async (ctx) => (await load(ctx)).config;
export const loadPhrases = async (ctx) => (await load(ctx)).phrases;

/** Change l'apparence ou l'état (fusionne les champs donnés). */
export async function saveConfig(ctx, patch) {
  const { config, configId } = await load(ctx);
  const next = normalizeConfig({ ...config, ...patch });
  if (configId) await ctx.api.store.update(configId, next);
  else await ctx.api.store.add(COLLECTIONS.config, next);
  forget(ctx);
  return next;
}

/** Ajoute une phrase déjà vérifiée (`checkPhrase`). Refuse au-delà de 100. → { id } ou { full: true }. */
export async function addPhrase(ctx, value) {
  const count = (await loadPhrases(ctx)).length;
  if (count >= M.LIMITS.phrases) return { full: true };
  const id = await ctx.api.store.add(COLLECTIONS.phrases, { ...value, at: Date.now() });
  forget(ctx);
  return { id };
}

/** Une phrase par son identifiant, relue sans passer par la mémoire (un identifiant venu d'un formulaire ne doit jamais viser autre chose qu'une phrase). */
async function known(ctx, id) {
  forget(ctx);
  return (await loadPhrases(ctx)).find((p) => p.id === String(id ?? ""));
}
export const findPhrase = known;

export async function updatePhrase(ctx, id, value) {
  const old = await known(ctx, id);
  if (!old) return false;
  const ok = await ctx.api.store.update(old.id, { ...value, at: old.at || Date.now() });
  forget(ctx);
  return ok;
}

export async function removePhrase(ctx, id) {
  const old = await known(ctx, id);
  if (!old) return false;
  await ctx.api.store.remove(old.id);
  forget(ctx);
  return true;
}

/** Remplace toutes les phrases par une liste (gabarit). */
export async function replacePhrases(ctx, list) {
  forget(ctx);
  const rows = await ctx.api.store.list(COLLECTIONS.phrases, { limit: M.LIMITS.phrases + 20 });
  for (const r of rows) await ctx.api.store.remove(r.id);
  const base = Date.now();
  let i = 0;
  for (const p of list.slice(0, M.LIMITS.phrases)) await ctx.api.store.add(COLLECTIONS.phrases, { ...p, at: base + i++ });
  forget(ctx);
}

/** Le nom à afficher dans la langue demandée (puis la langue par défaut, puis n'importe laquelle, puis le nom par défaut du module). */
export function nameFor(ctx, config) {
  return config.names[ctx.locale] || config.names[ctx.defaultLocale] || Object.values(config.names)[0] || ctx.t("defaultName");
}
export function altFor(ctx, config) {
  return config.alts[ctx.locale] || config.alts[ctx.defaultLocale] || Object.values(config.alts)[0] || "";
}
