// Chaîne Twitch — module communautaire de Curiosa. Porté de l'ancien site (Helix, client-credentials).
// C'est LE module qui connaît Twitch : identifiants, jeton, appels et caches sont ici (helix.mjs) et nulle part ailleurs.
// Il les met à disposition des autres modules : le SERVICE `twitch.live` (pour ceux qui en dépendent, comme « Statut live ») et les sujets
// `social.link` (bouton), `stream.live` (live en cours, vide sinon) et `maze.poster` (derniers clips). Sans identifiants valides, tout est vide plutôt qu'en erreur.
// Le fichier voisin est importé avec la même « version » que celui-ci : après une mise à jour, jamais d'ancien helix.mjs resté en mémoire.
const helix = await import(new URL(`./helix.mjs${new URL(import.meta.url).search}`, import.meta.url).href);
const { LOGIN, hasCredentials, valid, liveStatus, recentClips, schedule, scheduleStatus } = helix;
export const { currentStream } = helix;
export { recentClips };

const ADOPTED = "adopted";
const BORROWED = "borrowed";
const FIELDS = ["channel", "clientId", "clientSecret"];
const text = (v) => String(v ?? "").trim();

/**
 * Chaque instance (une par chaîne) connaît ses propres identifiants ; elle ne peut ni lire les réglages ni le stockage d'une autre.
 * Pour que l'application Twitch d'un propriétaire serve plusieurs chaînes sans qu'il ressaisisse le secret, chaque instance dont les identifiants sont
 * complets les « prête » ici, EN MÉMOIRE SEULEMENT (jamais écrits, affichés ni renvoyés) ; une autre instance qui nomme cette chaîne dans son réglage
 * « Utiliser les identifiants d'une autre chaîne » les reprend (champs vides seulement) et en garde une copie dans SON stockage, pour qu'un redémarrage
 * ne dépende pas de l'ordre dans lequel les instances sont lues. Le module (donc cette mémoire) est partagé par toutes ses instances.
 */
const lent = new Map();   // clé d'instance → { channel, clientId, secret }
export const resetCache = () => { helix.resetCache(); lent.clear(); };

const firstDoc = async (ctx, collection) => { try { return (await ctx.api.store.list(collection, { limit: 1 }))[0] ?? null; } catch { return null; } };
/** Ce que « Statut live » (ancienne version) a fait reprendre : un seul document, jamais affiché. Les réglages saisis ici ont toujours le dessus. */
const adoptedDoc = (ctx) => firstDoc(ctx, ADOPTED);

/**
 * Identifiants de l'instance, champ par champ : le réglage saisi ici, sinon ceux de l'autre chaîne demandée, sinon la valeur reprise d'un autre module.
 * Renvoie { creds: { channel, clientId, secret }, share: null | { from, state } } ; state : "live" (prêtés à l'instant), "copy" (copie gardée), "none" (introuvables), "self".
 */
async function resolve(ctx) {
  const key = ctx.instance.key;
  const own = { channel: text(ctx.setting("channel")).toLowerCase(), clientId: text(ctx.setting("clientId")), secret: text(ctx.setting("clientSecret")) };
  const from = text(ctx.setting("useCredentialsOf")).toLowerCase();
  const wants = LOGIN.test(from);
  const complete = own.channel && own.clientId && own.secret;
  if (complete) { lent.set(key, own); return { creds: own, share: wants ? { from, state: from === own.channel ? "self" : "none" } : null }; }
  const a = (await adoptedDoc(ctx))?.data ?? {};
  const base = { channel: own.channel || text(a.channel).toLowerCase(), clientId: own.clientId || text(a.clientId), secret: own.secret || text(a.clientSecret) };
  if (base.channel && base.clientId && base.secret) lent.set(key, base); else lent.delete(key);
  if (!wants) return { creds: base, share: null };
  if (from === base.channel) return { creds: base, share: { from, state: "self" } };
  let b = null, state = "none";
  const donor = [...lent].find(([k, v]) => k !== key && v.channel === from)?.[1];
  const doc = await firstDoc(ctx, BORROWED);
  if (donor) {
    b = { clientId: donor.clientId, secret: donor.secret }; state = "live";
    const d = doc?.data ?? {};
    if (d.from !== from || d.clientId !== b.clientId || d.clientSecret !== b.secret) {
      try { const data = { from, clientId: b.clientId, clientSecret: b.secret }; if (doc) await ctx.api.store.update(doc.id, data); else await ctx.api.store.add(BORROWED, data); } catch { /* la copie est un plus */ }
    }
  } else if (doc?.data?.from === from) {
    b = { clientId: text(doc.data.clientId), secret: text(doc.data.clientSecret) }; state = "copy";
  }
  const creds = { channel: base.channel, clientId: own.clientId || b?.clientId || text(a.clientId), secret: own.secret || b?.secret || text(a.clientSecret) };
  return { creds, share: { from, state } };
}
const credentials = async (ctx) => (await resolve(ctx)).creds;
const urlOf = (channel) => (LOGIN.test(channel) ? `https://twitch.tv/${channel}` : null);
const missing = (c) => [!LOGIN.test(c.channel) && "channel", !c.clientId && "clientId", !c.secret && "clientSecret"].filter(Boolean);

/** Un identifiant reçu d'un autre module : texte court sans espace, sinon on l'ignore. */
const providesSchedule = (ctx) => ctx.setting("provideSchedule") === true || ctx.setting("provideSchedule") === "true";
const hexColor = (v) => (/^#[0-9a-fA-F]{6}$|^#[0-9a-fA-F]{3}$/.test(text(v)) ? text(v) : null);
const DAY = 86_400_000;

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
    /**
     * Le planning de diffusion que Twitch publie pour la chaîne, en évènements neutres (sujet `calendar.event`). Seulement si l'option
     * « Fournir mon planning Twitch comme calendrier » est cochée (désactivée par défaut). Jamais d'erreur : sans planning ou en cas de panne, une liste vide.
     */
    async "calendar.event"(ctx, { limit, tags, from, to } = {}) {
      if (!providesSchedule(ctx) || (Array.isArray(tags) && tags.length)) return [];   // pas d'étiquettes sur cette source
      const c = await credentials(ctx);
      const r = await schedule(c);
      if (r.error) return [];
      const lo = from instanceof Date ? from.getTime() : -Infinity, hi = to instanceof Date ? to.getTime() : Infinity;
      const label = (r.displayName || c.channel).slice(0, 60), color = hexColor(ctx.setting("calendarColor"));
      return r.segments
        .filter((s) => (s.end ? Date.parse(s.end) : Date.parse(s.start)) >= lo && Date.parse(s.start) <= hi)
        .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
        .slice(0, Math.min(200, Math.max(1, Math.trunc(Number(limit)) || 50)))
        .map((s) => ({ id: `${s.id}`, title: s.title || ctx.t("scheduleUntitled"), start: s.start, ...(s.end ? { end: s.end } : {}), allDay: false, status: s.canceled ? "cancelled" : "confirmed", ...(s.category ? { category: s.category } : {}), url: urlOf(c.channel) ?? undefined, sourceLabel: label, ...(color ? { color } : {}) }))
        .map((i) => (i.url ? i : Object.fromEntries(Object.entries(i).filter(([k]) => k !== "url"))));
    },
    async "maze.poster"(ctx, { limit }) {
      return (await recentClips(await credentials(ctx))).slice(0, limit ?? 10).map((x) => ({ title: x.title, url: x.url, ...(x.image ? { image: x.image } : {}), kind: "clip" }));
    },
  },

  services: {
    "calendar.provider": {
      /** { kind, label, color?, active, state } — décrit cette source ; ne fait aucun appel réseau. Active seulement si l'option est cochée et la chaîne prête. */
      async describe(ctx) {
        const c = await credentials(ctx);
        const st = scheduleStatus(c);
        return { kind: "twitch", label: (st.displayName || (LOGIN.test(c.channel) ? c.channel : "")) || null, color: hexColor(ctx.setting("calendarColor")), active: providesSchedule(ctx) && valid(c), state: st.state, ...(st.error ? { error: st.error } : {}) };
      },
    },
    "twitch.live": {
      /** { channel, url, configured, ready, missing } — la chaîne de cette instance et si Twitch est utilisable ; ne fait aucun appel réseau. */
      async channel(ctx) {
        const c = await credentials(ctx);
        return { channel: LOGIN.test(c.channel) ? c.channel : null, url: urlOf(c.channel), configured: hasCredentials(c), ready: valid(c), missing: missing(c) };
      },
      /**
       * L'état de la chaîne : { configured, known, live, channel, url, id, title, game, viewers, startedAt, thumbnail, error? }. Ne lève jamais.
       * `known` : Twitch a répondu (sinon `live` vaut false et `error` dit pourquoi : auth, rate, network, config).
       * args.channel : une autre chaîne, avec les identifiants de cette instance. Sans argument : SA chaîne (chaque instance répond pour elle-même, aucun « maître »).
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
        return { ...base, known: true, live: !!s, ...(s ? { id: s.id, title: s.title, game: s.game, viewers: s.viewers, startedAt: s.startedAt, thumbnail: s.thumbnail, ...(s.displayName ? { displayName: s.displayName } : {}) } : {}) };
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
    const { share } = await resolve(ctx);
    const blocks = [];
    if (share) {
      const tone = share.state === "live" || share.state === "copy" ? "info" : "warning";
      blocks.push({ type: "banner", tone, text: ctx.t(`share_${share.state}`, { channel: share.from }) });
    }
    const a = (await adoptedDoc(ctx))?.data ?? {};
    const fields = FIELDS.filter((f) => text(a[f]));
    if (!fields.length) return blocks;
    return [
      ...blocks,
      { type: "banner", tone: "info", text: ctx.t("adoptedNote", { fields: fields.map((f) => ctx.t(`field_${f}`)).join(", ") }) },
      { type: "adminForm", action: "forgetAdopted", submitLabel: ctx.t("forget"), fields: [] },
    ];
  },
  adminActions: {
    async forgetAdopted(ctx) {
      for (const c of [ADOPTED, BORROWED]) { const doc = await firstDoc(ctx, c); if (doc) await ctx.api.store.remove(doc.id); }
      return { ok: ctx.t("forgotten"), redirect: "?" };
    },
  },
};
