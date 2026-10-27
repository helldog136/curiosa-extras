// MIGRATION (version 2.0.0, « à retirer en phase 3 ») : l'ancienne liste « Ma liste de co-streamers » (copies pseudo / nom / photo) devient des fiches de Contacts.
//
// Pour chaque ancien co-streamer : `upsertByAccount({ network: "twitch", handle, name, source: "stream-story" })` (le même compte donne la même fiche : on peut rejouer), puis les
// modèles et préparations qui nommaient ce pseudo gardent l'IDENTIFIANT de la fiche. Les personnes que Contacts ne peut pas accueillir (pseudo refusé, carnet plein) restent dans la
// petite liste de « ponctuels » de Story. L'ancienne liste n'est effacée qu'à la toute fin, quand tout est confié.
//
// Rien n'est jamais perdu :
//   - pas de Contacts (version 2), Contacts muet ou en panne : on ne touche à rien (« waiting ») ; l'ancienne liste reste, lue en repli ; la migration est rejouée par l'éditeur
//     (`ensureMigrated`) dès que Contacts répond ;
//   - une interruption au milieu laisse l'ancienne liste en place : le rejeu ne crée aucun doublon (fiche, ponctuel, référence).
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const P = await import(`./pure.mjs${v}`);
const data = await import(`./data.mjs${v}`);
const images = await import(`./images.mjs${v}`);
const book = await import(`./contacts.mjs${v}`);
const { within, timing } = await import(`./sources.mjs${v}`);

/** Les refus définitifs de Contacts pour UN co-streamer : la personne reste alors dans les ponctuels. Les autres échecs (muet, panne) arrêtent et se réessaient plus tard. */
const DEFINITIVE = new Set(["invalid", "invalid_handle", "invalid_network", "not_found", "name_required", "too_many"]);

/**
 * Une passe. Rend { state: "none" | "waiting" | "done", created, existing, kept, models }.
 *   none     rien à migrer (pas d'ancienne liste) ;
 *   waiting  Contacts (v2) absent, muet ou en panne : rien n'a été retiré ;
 *   done     tout est confié ; l'ancienne liste est effacée.
 */
export async function migrateCostreamers(ctx, { deadlineMs = timing.migrateMs } = {}) {
  const legacy = await data.readLegacy(ctx);
  if (!legacy.docs.length) return { state: "none", created: 0, existing: 0, kept: 0, models: 0 };
  const result = (state, extra = {}) => ({ state, created: 0, existing: 0, kept: 0, models: 0, ...extra });
  if (legacy.items.length && !(await book.hasBook(ctx))) return result("waiting");
  const until = Date.now() + deadlineMs;
  const ids = new Map(), leftovers = [];
  let created = 0, existing = 0;
  for (const m of legacy.items) {
    if (Date.now() > until) return result("waiting", { created, existing });
    const r = await book.call(ctx, "upsertByAccount", { network: "twitch", handle: m.login, kind: "person", ...(m.name ? { name: m.name } : {}), source: "stream-story" });
    if (r.ok && typeof r.value.id === "string") {
      ids.set(m.login, r.value.id);
      if (r.value.created) created++; else existing++;
      // La photo saisie à la main reste utile : on la CONFIE à Contacts (qui garde la plus récente), sans la garder chez nous.
      if (m.image && images.allowedUrl(m.image) && typeof r.value.accountId === "string") {
        await book.call(ctx, "setAccountProfile", { id: r.value.id, accountId: r.value.accountId, avatar: m.image, source: "stream-story", at: new Date().toISOString() });
      }
    } else if (!r.ok && DEFINITIVE.has(r.why)) leftovers.push(m);
    else return result("waiting", { created, existing });
  }
  if (leftovers.length) await data.addAdhoc(ctx, leftovers);
  const models = await data.rewriteMembers(ctx, (entries) => {
    let changed = false;
    const out = [];
    for (const e of entries) {
      const id = !e.id && ids.get(String(e.login).toLowerCase());
      const next = id ? { id } : e;
      if (id) changed = true;
      if (!out.some((x) => P.memberKey(x) === P.memberKey(next))) out.push(next); else changed = true;
    }
    return changed ? out : null;
  });
  await data.removeLegacy(ctx);
  return result("done", { created, existing, kept: leftovers.length, models });
}

const running = new Map(); // instance → passe en cours (une seule à la fois ; retirée dès qu'elle finit, jamais gardée)
/**
 * Rejoue la migration au besoin, quand la personne ouvre l'éditeur (jamais en arrière-plan). Peu coûteux s'il n'y a rien à faire (une lecture).
 * Borné : rend `{ state: "waiting" }` si la passe dure trop (elle continue en silence, et le rejeu reprend là où elle s'est arrêtée).
 */
export function ensureMigrated(ctx, { waitMs = timing.migrateMs + 2000 } = {}) {
  const key = String(ctx.instance?.id ?? ctx.instance?.key ?? "");
  const mine = running.get(key) ?? (() => {
    const run = migrateCostreamers(ctx).catch((e) => { console.error("[stream-story] migration failed:", e?.message ?? e); return { state: "waiting", created: 0, existing: 0, kept: 0, models: 0 }; })
      .finally(() => { if (running.get(key) === run) running.delete(key); });
    running.set(key, run);
    return run;
  })();
  return within(mine, waitMs, { state: "waiting", created: 0, existing: 0, kept: 0, models: 0 });
}
