// Les partenaires, proposés aux autres modules sous le sujet `stream.partner` (par exemple « Story d'annonce », qui s'en sert pour montrer des co-streamers) :
// le pseudo, le nom affiché et la photo de profil Twitch. JAMAIS la note, ni l'adresse secrète du dock : seulement ce que Twitch montre déjà à tout le monde.
// La photo se lit chez Twitch par Chaîne Twitch (service `twitch.api`, appel `GET users`) ; si Twitch ne répond pas, les partenaires sont rendus sans photo.
// Règles : au plus 5 demandes (20 pseudos chacune) en parallèle, bornées toutes ensemble à `timing.iconsMs` ; photos gardées 6 h en mémoire, un échec 1 minute.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const live = await import(`./live.mjs${v}`);

const SERVICE = "twitch.api";
export const timing = { iconsMs: 6000, okMs: 6 * 3600_000, failMs: 60_000 };
const CHUNK = 20;
const state = { cache: new Map(), inflight: new Map() };
export const resetPartners = () => { state.cache.clear(); state.inflight.clear(); };
const PICTURE = /^https:\/\/static-cdn\.jtvnw\.net\/(?!.*(?:\.\.|\/\/))[A-Za-z0-9_./-]{1,200}\.(?:png|jpe?g|webp)$/;
const str = (x, max) => (typeof x === "string" ? x.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max) : "");

/** Ce que Twitch répond (GET users) → { login: { name, image } }. Aucune confiance : tout est vérifié et coupé. */
export function readUsers(json) {
  const out = {};
  for (const u of Array.isArray(json?.data) ? json.data : []) {
    const login = str(u?.login, 40).toLowerCase();
    if (!login) continue;
    out[login] = { name: str(u?.display_name, 40), image: typeof u?.profile_image_url === "string" && PICTURE.test(u.profile_image_url) ? u.profile_image_url : "" };
  }
  return out;
}

async function fetchUsers(ctx, logins, settings) {
  const c = await live.pickChannel(ctx, settings?.channel);
  if (c.problem) return { ok: false };
  const groups = []; for (let i = 0; i < logins.length; i += CHUNK) groups.push(logins.slice(i, i + CHUNK));
  const found = {}; let any = false;
  await Promise.all(groups.map(async (group) => {
    const answers = await ctx.api.services.callAll(SERVICE, "request", { as: "app", method: "GET", path: "users", query: { login: group }, channel: c.channel });
    const r = answers.find((x) => x.ok && x.value && x.value.ok !== false && x.value.error !== "other_channel");
    if (r?.value?.status === 200) { any = true; Object.assign(found, readUsers(r.value.json)); }
  }));
  return { ok: any, found };
}

/**
 * Les partenaires au format du sujet : [{ id, login, title (nom affiché), image }]. Ne lève jamais et n'attend jamais plus de `timing.iconsMs` pour les photos.
 * `partners` : la liste de la personne ([{ login, name, note }]) — la note n'en sort jamais.
 */
export async function partnerItems(ctx, partners, settings = {}, limit = 100) {
  const list = partners.slice(0, Math.max(0, Math.min(100, Number(limit) || 100)));
  // `image` n'est présent que s'il y a une photo : une adresse vide n'est pas valable pour le cœur, qui écarterait tout l'élément
  const base = (users = {}) => list.map((p) => ({ id: p.login, login: p.login, title: p.name || users[p.login]?.name || p.login, ...(users[p.login]?.image ? { image: users[p.login].image } : {}) }));
  if (!list.length) return [];
  const k = `${ctx.instance.key}|${String(settings.channel ?? "").toLowerCase()}|${list.map((p) => p.login).join(",")}`;
  const hit = state.cache.get(k);
  if (hit && hit.until > Date.now()) return base(hit.users);
  let run = state.inflight.get(k);
  if (!run) {
    let timer;
    const expiry = new Promise((resolve) => { timer = setTimeout(() => resolve({ ok: false }), timing.iconsMs); timer.unref?.(); });
    run = Promise.race([Promise.resolve().then(() => fetchUsers(ctx, list.map((p) => p.login), settings)).catch(() => ({ ok: false })), expiry])
      .then((r) => { state.cache.set(k, { users: r.ok ? r.found : {}, until: Date.now() + (r.ok ? timing.okMs : timing.failMs) }); return r; })
      .finally(() => { clearTimeout(timer); if (state.inflight.get(k) === run) state.inflight.delete(k); });
    state.inflight.set(k, run);
  }
  const r = await run;
  return base(r.ok ? r.found : {});
}
