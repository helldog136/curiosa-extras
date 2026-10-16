// Connexion d'un compte Twitch (flux « code d'autorisation ») avec L'APPLICATION TWITCH DE L'UTILISATEUR : aucune application centrale, aucun secret partagé.
// Fichier sans mémoire et sans connaissance de Curiosa : il parle à id.twitch.tv (adresse d'autorisation, échange du code, renouvellement, révocation, validation)
// et rend { … } ou { error }. Il ne journalise rien et ne renvoie jamais un secret dans une erreur.
// PKCE : non utilisé. Twitch ne le documente pas pour son flux « code d'autorisation » (il demande le secret de l'application, que nous envoyons depuis le serveur) :
// envoyer un paramètre que Twitch ignorerait donnerait une fausse impression de protection. La protection tient au `state` (usage unique, secret, 10 minutes),
// à l'adresse de retour exacte et à la vérification du compte connecté (voir connect.mjs).
export const SCOPES = { followers: "moderator:read:followers", paying: "channel:read:subscriptions" };
const ID = "https://id.twitch.tv/oauth2";
/**
 * Les délais (en millisecondes). Un objet pour que les tests puissent les raccourcir ; helix.mjs le réexporte.
 *   requestMs : un appel réseau (signal d'abandon) ; la borne dure est 20 % plus longue (une réponse qui ignorerait le signal ne bloque pas pour autant) ;
 *   sharedMs  : un travail partagé par plusieurs demandes (jeton, état du direct, listes…) : passé ce délai, tout le monde reçoit « network » et le travail n'est plus partagé.
 */
export const timing = { requestMs: 5000, sharedMs: 15000 };
/** Attend `p` au plus `ms`, sinon refuse. Le minuteur est libéré dans tous les cas et ne retient pas le processus. */
export function within(p, ms) {
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), ms); timer.unref?.(); });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}
/** fetch avec signal d'abandon ET borne dure, y compris pour la lecture du corps. Ne rend que { ok, status, json(), text() }. */
export async function request(url, init = {}) {
  const ms = timing.requestMs, hard = Math.round(ms * 1.2);
  const res = await within(fetch(url, { signal: AbortSignal.timeout(ms), ...init }), hard);
  return { ok: res.ok, status: res.status, json: () => within(res.json(), hard), text: () => within(res.text(), hard) };
}
const post = (path, body) => request(`${ID}/${path}`, { method: "POST", body: new URLSearchParams(body) });
const failure = (status) => (status === 429 ? "rate" : status >= 500 ? "network" : "refused");
const readJson = async (res) => { try { return await res.json(); } catch { return {}; } };

/** Adresse de la page d'autorisation de Twitch. `redirect_uri` est exactement celle que l'utilisateur a enregistrée dans sa console Twitch ; `force_verify` : Twitch redemande toujours (choix du compte). */
export function authorizeUrl({ clientId, redirectUri, scopes, state }) {
  const u = new URL(`${ID}/authorize`);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", scopes.join(" "));
  u.searchParams.set("state", state);
  u.searchParams.set("force_verify", "true");
  return u.href;
}

const tokensOf = (json) => {
  if (typeof json.access_token !== "string" || typeof json.refresh_token !== "string" || !json.access_token || !json.refresh_token) return null;
  return { access: json.access_token, refresh: json.refresh_token, expiresAt: Date.now() + (Number.isFinite(json.expires_in) ? json.expires_in : 3600) * 1000, scopes: Array.isArray(json.scope) ? json.scope.filter((s) => typeof s === "string") : null };
};

/** Échange le code contre des jetons : { tokens } ou { error: "refused" | "rate" | "network" }. */
export async function exchangeCode({ clientId, secret, code, redirectUri }) {
  try {
    const res = await post("token", { client_id: clientId, client_secret: secret, code, grant_type: "authorization_code", redirect_uri: redirectUri });
    if (!res.ok) return { error: failure(res.status) };
    const tokens = tokensOf(await readJson(res));
    return tokens ? { tokens } : { error: "refused" };
  } catch { return { error: "network" }; }
}

/** Renouvelle : { tokens } ou { error: "invalid" (refus définitif : il faut reconnecter) | "rate" | "network" }. */
export async function refreshTokens({ clientId, secret, refresh }) {
  try {
    const res = await post("token", { client_id: clientId, client_secret: secret, grant_type: "refresh_token", refresh_token: refresh });
    if (!res.ok) return { error: res.status === 429 ? "rate" : res.status >= 500 ? "network" : "invalid" };
    const tokens = tokensOf(await readJson(res));
    return tokens ? { tokens } : { error: "invalid" };
  } catch { return { error: "network" }; }
}

/** À qui appartient ce jeton ? { login, userId, scopes, clientId } ou { error }. */
export async function validate(access) {
  try {
    const res = await request(`${ID}/validate`, { headers: { Authorization: `OAuth ${access}` } });
    if (!res.ok) return { error: failure(res.status) };
    const j = await readJson(res);
    if (typeof j.login !== "string" || typeof j.user_id !== "string") return { error: "refused" };
    return { login: j.login.toLowerCase(), userId: j.user_id, scopes: Array.isArray(j.scopes) ? j.scopes.filter((s) => typeof s === "string") : [], clientId: String(j.client_id ?? "") };
  } catch { return { error: "network" }; }
}

/** Révoque un jeton chez Twitch : true si Twitch a répondu « fait » (ou « déjà invalide »), false si on n'a pas pu le joindre. */
export async function revoke({ clientId, token }) {
  if (!token) return true;
  try {
    const res = await post("revoke", { client_id: clientId, token });
    return res.ok || res.status === 400;   // 400 : jeton déjà invalide, donc plus rien à révoquer
  } catch { return false; }
}
