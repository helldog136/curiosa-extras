// Chaîne Twitch — module communautaire de Curiosa. Porté de l'ancien site (Helix, client-credentials).
// C'est LE module qui connaît Twitch : identifiants, jeton, appels et caches sont ici (helix.mjs) et nulle part ailleurs.
// Il les met à disposition des autres modules : le SERVICE `twitch.live` (pour ceux qui en dépendent, comme « Statut live ») et les sujets
// `social.link` (bouton), `stream.live` (live en cours, vide sinon) et `maze.poster` (derniers clips). Sans identifiants valides, tout est vide plutôt qu'en erreur.
// Le fichier voisin est importé avec la même « version » que celui-ci : après une mise à jour, jamais d'ancien helix.mjs resté en mémoire.
const helix = await import(new URL(`./helix.mjs${new URL(import.meta.url).search}`, import.meta.url).href);
const { LOGIN, hasCredentials, valid, liveStatus, recentClips } = helix;
export const { resetCache, currentStream } = helix;
export { recentClips };

const ADOPTED = "adopted";
const FIELDS = ["channel", "clientId", "clientSecret"];
const text = (v) => String(v ?? "").trim();

/** Ce que « Statut live » (ancienne version) a fait reprendre : un seul document, jamais affiché. Les réglages saisis ici ont toujours le dessus. */
async function adoptedDoc(ctx) {
  try { return (await ctx.api.store.list(ADOPTED, { limit: 1 }))[0] ?? null; } catch { return null; }
}
/** Identifiants de l'instance, champ par champ : le réglage s'il est rempli, sinon la valeur reprise. */
async function credentials(ctx) {
  const own = { channel: text(ctx.setting("channel")).toLowerCase(), clientId: text(ctx.setting("clientId")), secret: text(ctx.setting("clientSecret")) };
  if (own.channel && own.clientId && own.secret) return own;
  const a = (await adoptedDoc(ctx))?.data ?? {};
  return { channel: own.channel || text(a.channel).toLowerCase(), clientId: own.clientId || text(a.clientId), secret: own.secret || text(a.clientSecret) };
}
const urlOf = (channel) => (LOGIN.test(channel) ? `https://twitch.tv/${channel}` : null);
const missing = (c) => [!LOGIN.test(c.channel) && "channel", !c.clientId && "clientId", !c.secret && "clientSecret"].filter(Boolean);

/** Un identifiant reçu d'un autre module : texte court sans espace, sinon on l'ignore. */
const plain = (v) => (typeof v === "string" && /^\S{1,200}$/.test(v.trim()) ? v.trim() : "");

export default {
  exports: {
    /** Le bouton de la chaîne pour le cœur (en-tête) : rien tant que la chaîne n'est pas réglée. */
    async "social.link"(ctx) {
      const { channel } = await credentials(ctx);
      return LOGIN.test(channel) ? [{ label: `Twitch · ${channel}`, url: urlOf(channel), icon: "twitch" }] : [];
    },
    async "stream.live"(ctx) {
      const c = await credentials(ctx);
      const s = await currentStream(c);
      return s ? [{ id: s.id, title: s.title, url: urlOf(c.channel), startedAt: s.startedAt, game: s.game ?? undefined }] : [];
    },
    async "maze.poster"(ctx, { limit }) {
      return (await recentClips(await credentials(ctx))).slice(0, limit ?? 10).map((x) => ({ title: x.title, url: x.url, ...(x.image ? { image: x.image } : {}), kind: "clip" }));
    },
  },

  services: {
    "twitch.live": {
      /** { channel, url, configured, ready, missing } — la chaîne de cette instance et si Twitch est utilisable ; ne fait aucun appel réseau. */
      async channel(ctx) {
        const c = await credentials(ctx);
        return { channel: LOGIN.test(c.channel) ? c.channel : null, url: urlOf(c.channel), configured: hasCredentials(c), ready: valid(c), missing: missing(c) };
      },
      /**
       * L'état de la chaîne : { configured, known, live, channel, url, id, title, game, viewers, startedAt, thumbnail, error? }. Ne lève jamais.
       * `known` : Twitch a répondu (sinon `live` vaut false et `error` dit pourquoi : auth, rate, network, config).
       * args.channel : une autre chaîne, avec les identifiants de cette instance.
       * args.legacy : { channel, clientId, clientSecret } d'un consommateur qui n'a pas encore été repris — utilisés SEULEMENT si cette instance n'a pas ses propres identifiants.
       */
      async status(ctx, args) {
        const a = args && typeof args === "object" ? args : {};
        let c = await credentials(ctx);
        if (!hasCredentials(c) && a.legacy && typeof a.legacy === "object") {
          c = { channel: c.channel || text(a.legacy.channel).toLowerCase(), clientId: plain(a.legacy.clientId), secret: plain(a.legacy.clientSecret) };
        }
        const other = text(a.channel).toLowerCase();
        if (LOGIN.test(other)) c = { ...c, channel: other };
        const base = { configured: hasCredentials(c), known: false, live: false, channel: LOGIN.test(c.channel) ? c.channel : null, url: urlOf(c.channel) };
        const r = await liveStatus(c);
        if (r.error) return { ...base, error: r.error };
        const s = r.stream;
        return { ...base, known: true, live: !!s, ...(s ? { id: s.id, title: s.title, game: s.game, viewers: s.viewers, startedAt: s.startedAt, thumbnail: s.thumbnail } : {}) };
      },
      /**
       * Reprise des identifiants d'un autre module (« Statut live ») : chaque champ vide ICI est rempli, un champ déjà rempli (réglage ou reprise) n'est JAMAIS écrasé.
       * Renvoie { adopted: [champs repris], ready } — jamais une valeur. Idempotent. N'importe quel module qui déclare dépendre de ce service peut l'appeler.
       */
      async adopt(ctx, args) {
        const a = args && typeof args === "object" ? args : {};
        const incoming = { channel: LOGIN.test(text(a.channel)) ? text(a.channel).toLowerCase() : "", clientId: plain(a.clientId), clientSecret: plain(a.clientSecret) };
        const doc = await adoptedDoc(ctx);
        const had = doc?.data ?? {};
        const next = { ...had };
        const adopted = [];
        for (const f of FIELDS) {
          if (text(ctx.setting(f)) || text(had[f]) || !incoming[f]) continue;
          next[f] = incoming[f];
          adopted.push(f);
        }
        if (adopted.length) {
          if (doc) await ctx.api.store.update(doc.id, next);
          else await ctx.api.store.add(ADOPTED, next);
        }
        return { adopted, ready: valid(await credentials(ctx)) };
      },
    },
  },

  // Seul indice visible de la reprise : jamais les valeurs. « Oublier » rend la main aux seuls réglages (retour en arrière).
  async adminPanel(ctx) {
    const doc = await adoptedDoc(ctx);
    const a = doc?.data ?? {};
    const fields = FIELDS.filter((f) => text(a[f]));
    if (!fields.length) return [];
    return [
      { type: "banner", tone: "info", text: ctx.t("adoptedNote", { fields: fields.map((f) => ctx.t(`field_${f}`)).join(", ") }) },
      { type: "adminForm", action: "forgetAdopted", submitLabel: ctx.t("forget"), fields: [] },
    ];
  },
  adminActions: {
    async forgetAdopted(ctx) {
      const doc = await adoptedDoc(ctx);
      if (doc) await ctx.api.store.remove(doc.id);
      return { ok: ctx.t("forgotten"), redirect: "?" };
    },
  },
};
