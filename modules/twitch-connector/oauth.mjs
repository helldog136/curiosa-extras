// id.twitch.tv : page d'autorisation, échange du code, renouvellement, validation, révocation et jeton d'application.
// Fichier sans mémoire et sans connaissance de Curiosa, sauf le client réseau `net` (ctx.api.net) qu'on lui passe : délai, pause après « trop de demandes »,
// disjoncteur et journal sans corps ni requête sont fournis par le cœur. Les secrets partent dans le CORPS des demandes (jamais dans l'adresse, donc jamais
// dans le journal du cœur). Rien n'est journalisé ici ; aucune erreur ne contient une valeur.
// PKCE : non utilisé. Twitch ne le documente pas pour son flux « code d'autorisation » (il demande le secret de l'application, envoyé depuis le serveur).
// La protection tient au `state` (usage unique, secret, 10 minutes), à l'adresse de retour exacte et à la vérification du compte connecté (voir connections.mjs).
export const ID = "https://id.twitch.tv/oauth2";
export const ID_HOST = "id.twitch.tv";
/** Délais (ms), modifiables par les tests. `requestMs` : un appel réseau ; `sharedMs` : un travail partagé ou un appel complet du service (borne dure). */
export const timing = { requestMs: 8000, sharedMs: 15000 };

/** Attend `p` au plus `ms` ; sinon rend `fallback()`. Ne rejette jamais ; le minuteur est libéré et ne retient pas le processus. */
export function within(p, ms, fallback) {
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(fallback()), ms); timer.unref?.(); });
  return Promise.race([Promise.resolve(p).catch(() => fallback()), late]).finally(() => clearTimeout(timer));
}

const form = (o) => new URLSearchParams(o).toString();
const post = (net, path, body) => net.request({
  url: `${ID}/${path}`, method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form(body),
  timeoutMs: timing.requestMs, retry: 0, priority: "interactive",
});
/** Réponse refusée par le client réseau : « rate » (pause en cours, partagée) ou « network » (délai, panne, disjoncteur…). */
const netError = (r) => (r.error === "rate" || r.error === "quota" ? "rate" : "network");
const jsonOf = (r) => (r.json && typeof r.json === "object" && !Array.isArray(r.json) ? r.json : null);

/** Adresse de la page d'autorisation de Twitch. `force_verify` : Twitch redemande toujours (choix du compte). */
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
  if (!json || typeof json.access_token !== "string" || typeof json.refresh_token !== "string" || !json.access_token || !json.refresh_token) return null;
  return { access: json.access_token, refresh: json.refresh_token, expiresAt: Date.now() + (Number.isFinite(json.expires_in) ? json.expires_in : 3600) * 1000, scopes: Array.isArray(json.scope) ? json.scope.filter((s) => typeof s === "string") : null };
};

/** Jeton d'application : { token, expiresIn } ou { error: "auth" (identifiants refusés) | "rate" | "network" }. */
export async function appToken(net, { clientId, secret }) {
  const r = await post(net, "token", { client_id: clientId, client_secret: secret, grant_type: "client_credentials" });
  if (!r.ok) return { error: netError(r) };
  if (r.status >= 500) return { error: "network" };
  const j = jsonOf(r);
  if (r.status !== 200) return { error: "auth" };
  if (!j || typeof j.access_token !== "string" || !j.access_token) return { error: "network" };   // corps illisible (coupé) : passager
  return { token: j.access_token, expiresIn: Number.isFinite(j.expires_in) ? j.expires_in : 3600 };
}

/** Échange le code contre des jetons : { tokens } ou { error: "refused" | "rate" | "network" }. `redirectUri` : EXACTEMENT celle de l'autorisation. */
export async function exchangeCode(net, { clientId, secret, code, redirectUri }) {
  const r = await post(net, "token", { client_id: clientId, client_secret: secret, code, grant_type: "authorization_code", redirect_uri: redirectUri });
  if (!r.ok) return { error: netError(r) };
  if (r.status >= 500) return { error: "network" };
  if (r.status !== 200) return { error: "refused" };
  const tokens = tokensOf(jsonOf(r));
  return tokens ? { tokens } : { error: "network" };
}

/** Renouvelle : { tokens } ou { error: "invalid" (refus définitif : il faut reconnecter) | "rate" | "network" }. */
export async function refreshTokens(net, { clientId, secret, refresh }) {
  const r = await post(net, "token", { client_id: clientId, client_secret: secret, grant_type: "refresh_token", refresh_token: refresh });
  if (!r.ok) return { error: netError(r) };
  if (r.status >= 500) return { error: "network" };
  if (r.status !== 200) return { error: "invalid" };
  const tokens = tokensOf(jsonOf(r));
  return tokens ? { tokens } : { error: "network" };   // réponse coupée : on réessaiera, ce n'est pas un refus
}

/** À qui appartient ce jeton ? { login, userId, scopes, clientId } ou { error: "refused" | "rate" | "network" }. */
export async function validate(net, access) {
  const r = await net.request({ url: `${ID}/validate`, headers: { authorization: `OAuth ${access}` }, timeoutMs: timing.requestMs, dedupe: false, priority: "interactive" });
  if (!r.ok) return { error: netError(r) };
  if (r.status >= 500) return { error: "network" };
  if (r.status !== 200) return { error: "refused" };
  const j = jsonOf(r);
  if (!j || typeof j.login !== "string" || typeof j.user_id !== "string") return { error: "network" };
  return { login: j.login.toLowerCase(), userId: j.user_id, scopes: Array.isArray(j.scopes) ? j.scopes.filter((s) => typeof s === "string") : [], clientId: String(j.client_id ?? "") };
}

/** Révoque un jeton chez Twitch : true si Twitch a répondu « fait » (ou « déjà invalide »), false s'il n'a pas pu être joint. */
export async function revoke(net, { clientId, token }) {
  if (!token || !clientId) return true;
  const r = await post(net, "revoke", { client_id: clientId, token });
  return r.ok && (r.status < 300 || r.status === 400);   // 400 : jeton déjà invalide, plus rien à révoquer
}
