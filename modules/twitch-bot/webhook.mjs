// La porte d'entrée publique : Twitch appelle cette adresse pour chaque message du chat. On vérifie d'abord que c'est bien Twitch (signature, âge), on répond VITE,
// et le traitement du message se fait ensuite, sans faire attendre Twitch (qui coupe un abonnement dont le site répond trop lentement ou en erreur).
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const es = await import(`./eventsub.mjs${v}`);
const { settingsOf } = await import(`./settings.mjs${v}`);
const { readState, updateState, seenBefore } = await import(`./state.mjs${v}`);
const { processChat } = await import(`./engine.mjs${v}`);
const { processRedemption, reconcile } = await import(`./redeem.mjs${v}`);
const { ensureListening } = await import(`./listen.mjs${v}`);

const MAX_BODY = 100_000;
const reply = (status, body = null, type = "text/plain; charset=utf-8") => new Response(body, { status, headers: { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

const lastNote = new Map();   // instance → dernière écriture de « dernier message reçu » (au plus une par minute : un chat animé n'écrit pas à chaque message)
const rejected = new Map();   // instance → dernier refus noté (au plus un par minute : un attaquant ne fait pas écrire notre stockage)
async function noteRejected(ctx, reason, now) {
  const k = ctx.instance.key;
  if ((rejected.get(k) ?? 0) > now - 60_000) return;
  rejected.set(k, now);
  await updateState(ctx, (d) => { d.rejected = { reason, at: now }; });
}

/**
 * Traite une requête de Twitch. Rend { response, done } : `response` part tout de suite, `done` est la promesse du traitement (les tests l'attendent ; le serveur, non).
 * Ne lève jamais.
 */
export async function handle(request, ctx, { now = Date.now() } = {}) {
  const none = Promise.resolve();
  try {
    if (request.method !== "POST") return { response: reply(405, "Method not allowed"), done: none };
    const raw = await request.text();
    if (raw.length > MAX_BODY) return { response: reply(413, "Too large"), done: none };
    const state = await readState(ctx);
    const s = settingsOf(ctx);
    const v = es.verify({ secret: state.secret, headers: request.headers, rawBody: raw, now, maxAgeMs: s.toleranceMin * 60_000 });
    if (!v.ok) {
      const done = noteRejected(ctx, v.reason, now).catch(() => {});
      return { response: reply(v.reason === "secret" ? 404 : 403, "Forbidden"), done };
    }
    const body = es.parseBody(v.type, raw);
    if (body.kind === "challenge") {
      return { response: reply(200, body.challenge), done: updateState(ctx, (d) => { d.verifiedAt = now; }).catch(() => {}) };
    }
    if (body.kind === "invalid" || body.kind === "ignored") return { response: reply(body.kind === "invalid" ? 400 : 204), done: none };
    if (seenBefore(ctx, v.id, now)) return { response: reply(204), done: none };   // Twitch renvoie parfois le même message : une seule fois
    if (body.kind === "revocation") {
      const done = (async () => {
        await updateState(ctx, (d) => { d.sub = { code: "revoked", detail: body.status, at: now }; });
        await ensureListening(ctx, s).catch(() => {});   // l'autorisation est peut-être revenue entre-temps : on tente de se remettre à l'écoute
      })().catch(() => {});
      return { response: reply(204), done };
    }
    if (body.kind === "redemption") {
      // Un échange de points : traité une seule fois (identifiant du message, puis identifiant de l'échange gardé en mémoire durable) ; la réponse à Twitch part tout de suite
      const done = processRedemption(ctx, body.redemption, { now }).catch((e) => { console.error(`[twitch-bot] ${ctx.instance.key}: échange en échec (${e?.message ?? e})`); });
      return { response: reply(204), done };
    }
    const done = (async () => {
      await reconcile(ctx, { now }).catch(() => {});   // à chaque évènement : les résultats de la maison et les échanges trop longs sont vus (au plus toutes les 5 secondes)
      if ((lastNote.get(ctx.instance.key) ?? 0) < now - 60_000) { lastNote.set(ctx.instance.key, now); await updateState(ctx, (d) => { d.lastMessageAt = now; }); }
      await processChat(ctx, body.chat, { now });
    })().catch((e) => { console.error(`[twitch-bot] ${ctx.instance.key}: traitement d'un message en échec (${e?.message ?? e})`); });
    return { response: reply(204), done };
  } catch (e) {
    console.error(`[twitch-bot] ${ctx.instance.key}: webhook en échec (${e?.message ?? e})`);
    return { response: reply(500, "Error"), done: none };
  }
}
