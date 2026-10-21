// Le nom et la photo d'une chaîne, demandés à Twitch AU MOMENT de l'ajout (c'est une personne qui clique : jamais en arrière-plan, jamais en balayage).
// Par le Connecteur Twitch (service `twitch.api`, qui garde les jetons ; ce fichier ne parle jamais à Twitch lui-même) : UN appel `GET users` pour 100 pseudos au plus.
// Ce que Twitch répond n'est pas gardé ici : l'appelant le dépose dans la fiche de Contacts (`setAccountProfile`), propriétaire de la donnée.
// Règles de ce fichier :
//   - le Connecteur est une aide, jamais une condition : absent, pas réglé, muet, lent ou limité (429), on rend un état et l'ajout continue (la fiche prend le pseudo comme nom,
//     Contacts la complétera à sa première ouverture) ;
//   - chaque attente est bornée (`timing`), l'ensemble aussi ; aucune promesse partagée ; ce qui arrive après la borne n'écrit plus rien ;
//   - une réponse n'est jamais crue sur parole : pseudo, nom (40 caractères), photo (https seulement) sont vérifiés et coupés.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { chunk, httpsUrl, LOGIN } = await import(`./pure.mjs${v}`);
const streams = await import(`./streams.mjs${v}`);
const { SERVICE, within, str, pickChannel } = streams;

/** Les délais (en millisecondes). Un objet pour que les tests puissent les raccourcir. */
export const timing = { channelMs: 3500, packetMs: 6000, totalMs: 10_000 };
export const PACKET = 100;
const usable = (r) => r.ok && r.value && r.value.ok !== false && r.value.error !== "other_channel";

/** Ce que Twitch répond (GET users) → Map pseudo → { name, avatar? } ; null si illisible. */
export function readUsers(json) {
  if (!json || !Array.isArray(json.data)) return null;
  const out = new Map();
  for (const u of json.data) {
    const login = str(u?.login, 40).toLowerCase();
    if (!LOGIN.test(login) || out.has(login)) continue;
    const name = str(u.display_name, 40);
    out.set(login, { name: name || login, ...(httpsUrl(u.profile_image_url) ? { avatar: u.profile_image_url } : {}) });
  }
  return out;
}

async function callUsers(ctx, channel, logins) {
  try {
    const answers = await within(ctx.api.services.callAll(SERVICE, "request", { as: "app", method: "GET", path: "users", query: { login: logins }, channel }), timing.packetMs, null);
    if (!answers) return { error: "network" };
    const r = answers.find(usable) ?? answers.find((x) => x.ok && x.value);
    if (!r?.value) return { error: "network" };
    const val = r.value;
    if (val.ok === false) return { error: typeof val.error === "string" ? val.error : "network" };
    if (val.status === 429) return { error: "rate" };
    if (val.status !== 200) return { error: "twitch" };
    const users = readUsers(val.json);
    return users ? { users } : { error: "twitch" };
  } catch { return { error: "network" }; }
}

/**
 * Le nom et la photo de ces pseudos (jusqu'à 100 par appel, par paquets). Rend toujours un objet, sans jamais lever ni attendre plus de `timing.totalMs` :
 *   { state: "ok" | "partial" | "none" | "rate" | "down", byLogin: Map(pseudo → { name, avatar? }), asked: Set(pseudos dont Twitch a vraiment répondu) }
 * `ok` : tout a été demandé et Twitch a répondu ; `partial` : une partie seulement ; `none` : pas de Connecteur prêt (rien n'a été demandé) ;
 * `rate` : Twitch demande de patienter ; `down` : Twitch ou le Connecteur ne répond pas. Un pseudo de `asked` absent de `byLogin` n'existe pas sur Twitch.
 */
export async function fetchProfiles(ctx, logins, wantedChannel = "") {
  const out = { state: "none", byLogin: new Map(), asked: new Set() };
  const list = [...new Set(logins)].filter((l) => LOGIN.test(l));
  if (!list.length) return { ...out, state: "ok" };
  const t0 = Date.now();
  const c = await within(pickChannel(ctx, wantedChannel).catch(() => ({ problem: "slow" })), timing.channelMs, { problem: "slow" });
  if (c.problem === "slow") return { ...out, state: "down" };
  if (c.problem) return out;
  let done = 0, error = null, closed = false;
  const total = chunk(list, PACKET);
  const budget = setTimeout(() => { closed = true; }, Math.max(0, timing.totalMs - (Date.now() - t0))); budget.unref?.();
  try {
    for (const part of total) {
      if (closed) { error ??= "network"; break; }
      const r = await callUsers(ctx, c.channel, part);
      if (closed) { error ??= "network"; break; }   // le délai global est passé : ce retardataire n'écrit plus rien
      if (r.error) { error = r.error; if (r.error === "rate" || r.error === "config" || r.error === "auth") break; continue; }
      done++;
      for (const l of part) out.asked.add(l);
      for (const [l, p] of r.users) out.byLogin.set(l, p);
    }
  } finally { clearTimeout(budget); }
  if (done === total.length) return { ...out, state: "ok" };
  if (error === "rate") return { ...out, state: done ? "partial" : "rate" };
  if (error === "config" || error === "auth" || error === "forbidden" || error === "invalid") return { ...out, state: done ? "partial" : "none" };
  return { ...out, state: done ? "partial" : "down" };
}
