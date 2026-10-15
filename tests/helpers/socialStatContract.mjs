// Contrat du sujet « social.stat » (fournisseurs : un module par plateforme ; consommateur : le collecteur de statistiques).
// Une fonction de validation PARTAGÉE par tous les tests des fournisseurs : un seul endroit dit ce qu'est un élément valide.
export const METRICS = ["followers", "paying", "content", "views", "avg_viewers", "peak_viewers", "hours_streamed", "hours_watched", "followers_gained"];
export const ERRORS = ["auth", "rate", "network", "hidden", "config"];
const KEYS = new Set(["id", "platform", "account", "accountKey", "metric", "label", "value", "asOf", "url", "error"]);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** Liste des problèmes d'UN élément (vide = valide). `expect` : { module, platform } pour vérifier l'identifiant et la plateforme du fournisseur. */
export function problemsOf(item, expect = {}) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return ["pas un objet"];
  const p = [];
  const text = (k, max = 200) => { if (typeof item[k] !== "string" || !item[k].trim() || item[k].length > max) p.push(`${k} : texte non vide attendu`); };
  for (const k of ["id", "platform", "account", "accountKey", "label", "asOf"]) text(k);
  for (const k of Object.keys(item)) if (!KEYS.has(k)) p.push(`champ inconnu « ${k} »`);
  if (!METRICS.includes(item.metric)) p.push(`metric « ${item.metric} » hors contrat`);
  if (typeof item.id === "string" && !/^[a-z0-9-]+:[^:\s]+:(followers|paying|content|views|avg_viewers|peak_viewers|hours_streamed|hours_watched|followers_gained)$/.test(item.id)) p.push(`id « ${item.id} » : <module>:<clé d'instance>:<métrique>`);
  if (typeof item.id === "string" && typeof item.accountKey === "string" && item.id !== `${expect.module ?? item.id.split(":")[0]}:${item.accountKey}:${item.metric}`) p.push("id ≠ <module>:<accountKey>:<metric>");
  if (expect.platform && item.platform !== expect.platform) p.push(`platform « ${item.platform} » ≠ « ${expect.platform} »`);
  if (typeof item.platform === "string" && !/^[a-z][a-z0-9-]{0,30}$/.test(item.platform)) p.push("platform mal formée");
  if (typeof item.asOf === "string" && (!ISO.test(item.asOf) || Number.isNaN(Date.parse(item.asOf)))) p.push(`asOf « ${item.asOf} » : ISO 8601 attendu`);
  if ("url" in item && !(typeof item.url === "string" && /^https:\/\/[^\s]+$/.test(item.url))) p.push("url : adresse https attendue");
  if ("error" in item && !ERRORS.includes(item.error)) p.push(`error « ${item.error} » hors contrat`);
  if (item.error !== undefined) { if ("value" in item) p.push("value doit être ABSENT quand error est présent"); }
  else if (!(Number.isInteger(item.value) && item.value >= 0)) p.push(`value : entier ≥ 0 attendu (reçu ${JSON.stringify(item.value)})`);
  return p;
}

/** Valide un tableau renvoyé par exports["social.stat"] : tous les éléments valides, identifiants uniques. */
export function problemsOfList(list, expect = {}) {
  if (!Array.isArray(list)) return ["pas un tableau"];
  const out = list.flatMap((it, i) => problemsOf(it, expect).map((m) => `#${i} ${m}`));
  const ids = list.map((x) => x?.id);
  if (new Set(ids).size !== ids.length) out.push("identifiants en double");
  return out;
}
