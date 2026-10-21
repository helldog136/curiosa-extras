// Contacts — rafraîchir la photo et le nombre d'abonnés d'une fiche depuis les services (Twitch, YouTube, Bluesky).
//
// RÈGLE D'OR : seulement sur une interaction humaine — la personne OUVRE la fiche, ou clique « Actualiser la photo ». Jamais de balayage du carnet, jamais de
// minuteur, jamais depuis le service `contact.book` ni une migration. Une fiche ouverte récemment (moins de 24 h) ou déjà essayée il y a moins de 10 minutes
// n'appelle personne. Au plus 10 comptes par service et par fois ; attente totale bornée (6 s) ; une panne ou une limite d'un service ne gêne ni la page, ni les autres.
// Qui répond : Twitch par le service `twitch.api`, YouTube par `youtube.api` (deux besoins FACULTATIFS : sans eux la fiche propose de les installer, par service),
// Bluesky directement (profil public) par `ctx.api.net`. Le choix de la photo reste dans networks.mjs (`pickPhoto`) : manuelle, puis la plus grosse communauté
// connue (cache daté), sinon Twitch, YouTube, Bluesky.
const v = new URL(import.meta.url).search;
const B = await import(`./book.mjs${v}`);
const D = await import(`./data.mjs${v}`);

export const TTL_MS = 24 * 3_600_000;      // un profil lu il y a moins de 24 h est encore bon
export const TRY_MS = 10 * 60_000;         // pas deux essais en 10 minutes pour la même fiche
export const OVERALL_MS = 6000;            // attente totale
export const PER_SERVICE = 10;             // comptes par service et par fois
export const NETWORKS = ["twitch", "youtube", "bluesky"];
export const SERVICE_OF = { twitch: "twitch.api", youtube: "youtube.api" };
const overall = (ctx) => { const n = ctx?.__contactsTest?.photoWaitMs; return Number.isInteger(n) && n > 0 ? n : OVERALL_MS; };
const call = (ctx) => { const n = ctx?.__contactsTest?.photoCallMs; return Number.isInteger(n) && n > 0 ? n : 5000; };

const TRIES = new Map(); // « instance|fiche » → date du dernier essai (borné à 500, expire)
function tried(ctx, id, mark) {
  const now = Date.now();
  if (TRIES.size > 500) for (const [k, t] of TRIES) if (now - t > TRY_MS) TRIES.delete(k);
  if (TRIES.size > 500) TRIES.clear();
  const k = `${ctx.instance?.id ?? "?"}|${id}`;
  const last = TRIES.get(k);
  if (mark) TRIES.set(k, now);
  return last !== undefined && now - last < TRY_MS;
}
export const forgetTries = () => TRIES.clear();

export const isStale = (acc, now = Date.now()) => !acc.profileAt || !(now - Date.parse(acc.profileAt) < TTL_MS);
/** Les comptes d'une fiche dont le profil pourrait être rafraîchi (Twitch, YouTube, Bluesky). */
export const refreshable = (data) => B.accountsOf(data).filter((a) => NETWORKS.includes(a.network)).slice(0, D.LIMITS.accountsPerContact);

async function hasProvider(ctx, service) {
  try { const p = await D.within(ctx.api.services.providers(service), 2000, "providers"); return Array.isArray(p) && p.length > 0; } catch { return false; }
}
const answer = async (ctx, service, method, args) => {
  const r = await D.within(ctx.api.services.call(service, method, args), call(ctx), service);
  return r?.ok && r.value?.ok !== false ? { value: r.value } : { error: r?.value?.error ?? r?.reason ?? "failed" };
};

// Chaque lecteur rend { found: [{ account, displayName?, avatar?, followers?, at? }], status } ; `status` : « ok » · « missing » (pas de connecteur) · « error:<code> ».
async function readYoutube(ctx, accounts) {
  if (!(await hasProvider(ctx, SERVICE_OF.youtube))) return { found: [], status: "missing" };
  const list = accounts.slice(0, PER_SERVICE);
  const ids = list.filter((a) => /^UC[\w-]{22}$/.test(a.handle)).map((a) => a.handle);
  const handles = list.filter((a) => a.handle.startsWith("@")).map((a) => a.handle);
  const r = await answer(ctx, SERVICE_OF.youtube, "channels", { ids, handles, priority: "interactive" });
  if (r.error) return { found: [], status: `error:${r.error}` };
  const items = Array.isArray(r.value.items) ? r.value.items : [];
  const found = [];
  for (const a of list) {
    const it = items.find((x) => x.id === a.handle || (typeof x.handle === "string" && x.handle.toLowerCase() === a.handle));
    if (it) found.push({ account: a, displayName: it.title, avatar: it.avatar ?? undefined, followers: Number.isInteger(it.subscribers) ? it.subscribers : undefined, at: it.at });
  }
  return { found, status: "ok" };
}
async function readTwitch(ctx, accounts) {
  if (!(await hasProvider(ctx, SERVICE_OF.twitch))) return { found: [], status: "missing" };
  const list = accounts.slice(0, PER_SERVICE);
  const r = await answer(ctx, SERVICE_OF.twitch, "request", { as: "app", method: "GET", path: "users", query: { login: list.map((a) => a.handle) }, priority: "interactive" });
  if (r.error) return { found: [], status: `error:${r.error}` };
  const rows = Array.isArray(r.value.json?.data) ? r.value.json.data : [];
  const found = [];
  for (const a of list) {
    const u = rows.find((x) => String(x.login).toLowerCase() === a.handle);
    // Twitch ne donne le nombre d'abonnés d'une AUTRE chaîne qu'avec l'autorisation de cette chaîne : il reste inconnu ici.
    if (u) found.push({ account: a, displayName: typeof u.display_name === "string" ? u.display_name : undefined, avatar: typeof u.profile_image_url === "string" ? u.profile_image_url : undefined });
  }
  return { found, status: "ok" };
}
async function readBluesky(ctx, accounts) {
  const list = accounts.slice(0, PER_SERVICE);
  const q = list.map((a) => `actors=${encodeURIComponent(a.handle)}`).join("&");
  const r = await ctx.api.net.request({ url: `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfiles?${q}`, priority: "interactive", timeoutMs: call(ctx), maxBytes: 500_000 });
  if (!r?.ok) return { found: [], status: `error:${r?.error ?? "network"}` };
  if (r.status !== 200) return { found: [], status: `error:${r.status}` };
  const rows = Array.isArray(r.json?.profiles) ? r.json.profiles : [];
  const found = [];
  for (const a of list) {
    const p = rows.find((x) => String(x.handle).toLowerCase() === a.handle || x.did === a.handle);
    if (p) found.push({ account: a, displayName: typeof p.displayName === "string" ? p.displayName : undefined, avatar: typeof p.avatar === "string" ? p.avatar : undefined, followers: Number.isInteger(p.followersCount) ? p.followersCount : undefined });
  }
  return { found, status: "ok" };
}
const READERS = { twitch: readTwitch, youtube: readYoutube, bluesky: readBluesky };

/**
 * Rafraîchit les comptes de la fiche. `force` : le bouton « Actualiser la photo » (tous les comptes, sans attendre 24 h). Sans lui : seulement ceux dont le profil date
 * de plus de 24 h, et pas plus d'un essai toutes les 10 minutes. Rend { updated, services: { twitch?: "ok"|"missing"|"error:…", … }, skipped?: true }. Ne lève jamais.
 */
export async function refreshFiche(ctx, id, { force = false } = {}) {
  try {
    const rec = D.idOk(id) ? await D.readContact(ctx, id) : null;
    if (!rec) return { updated: 0, services: {}, skipped: true };
    const all = refreshable(rec.data);
    const want = force ? all : all.filter((a) => isStale(a));
    if (!want.length || (!force && tried(ctx, id, false))) return { updated: 0, services: {}, skipped: true };
    tried(ctx, id, true);
    const by = {};
    for (const a of want) (by[a.network] ??= []).push(a);
    const networks = Object.keys(by);
    const settled = await D.within(Promise.all(networks.map((n) => READERS[n](ctx, by[n]).catch((e) => ({ found: [], status: `error:${e?.code === "busy" ? "timeout" : "failed"}` })))), overall(ctx), "photos").catch(() => null);
    const services = {};
    let updated = 0;
    if (!settled) { for (const n of networks) services[n] = "error:timeout"; return { updated, services }; }
    for (const [i, n] of networks.entries()) {
      services[n] = settled[i].status;
      for (const f of settled[i].found) {
        const when = f.at && Date.parse(f.at) <= Date.now() ? f.at : new Date().toISOString();
        const r = await B.setAccountProfile(ctx, { id, accountId: f.account.id, displayName: f.displayName, avatar: B.httpsUrl(f.avatar) ? f.avatar : undefined, followers: f.followers, source: "contacts", at: when });
        if (r.ok && !r.stale) updated++;
      }
    }
    return { updated, services };
  } catch (e) {
    if (e?.code !== "busy") console.error("[contacts] photos:", e?.message ?? e);
    return { updated: 0, services: {}, error: true };
  }
}

/** À l'OUVERTURE d'une fiche (interaction humaine) : rafraîchit seulement si un compte date de plus de 24 h. Un échec n'empêche jamais d'ouvrir la fiche. */
export const refreshOnOpen = (ctx, id) => refreshFiche(ctx, id, { force: false });
/** Le bouton « Actualiser la photo ». */
export const refreshNow = (ctx, id) => refreshFiche(ctx, id, { force: true });
