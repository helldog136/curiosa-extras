// Questions fréquentes : les routes publiques (POST seulement, sauf le script) : poser une question, donner son avis.
// Chaque route répond de deux façons : en JSON quand le script de la page l'appelle (la page ne se recharge pas), et par une
// redirection vers la page de la FAQ quand le navigateur envoie le formulaire lui-même (sans JavaScript). La destination de
// la redirection est TOUJOURS construite ici, jamais lue dans la requête.

// Chaque fichier voisin est importé AVEC la version du fichier principal : sinon une mise à jour à chaud garderait l'ancien (voir docs/HOT-UPDATE.md).
const v = new URL(import.meta.url).search;
const { C, locked, getRow, loadAsked, purgeAsked, limited, alreadyVoted, visitorId, mailDue, flag, askedKey, HOUR } = await import(`./data.mjs${v}`);
const { LIMITS, clean, num } = await import(`./text.mjs${v}`);
const { pageHref } = await import(`./view.mjs${v}`);

const json = (body, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const wantsJson = (request) => /application\/json/i.test(request.headers.get("accept") ?? "");

/** Réponse commune : JSON pour le script, sinon retour sur la page (message affiché par l'ancre `#faq-…`). */
function reply(request, ctx, status, anchor, body) {
  if (wantsJson(request)) return json(body, status);
  const href = pageHref(ctx);
  if (href === null) return json(body, status);
  return new Response(null, { status: 303, headers: { location: `${href}#faq-${anchor}`, "cache-control": "no-store" } });
}

async function readForm(request) {
  try { return await request.formData(); } catch { return null; }
}

async function tellOwner(ctx, text) {
  if (!flag(ctx, "notify", true) || !mailDue(ctx)) return;
  try {
    if (!(await ctx.api.mail.configured())) return;
    await ctx.api.mail.send({
      to: "owner",
      subject: ctx.t("mailSubject"),
      text: `${ctx.t("mailBody")}\n\n« ${text} »\n\n${ctx.t("mailAdmin")} ${ctx.api.siteUrl}/admin/instances/${ctx.instance.id}\n${ctx.t("mailThrottle")}\n`,
    });
  } catch (error) {
    console.error("[faq] mail failed:", error?.message); // ni texte de visiteur ni secret dans le journal
  }
}

export const routes = {
  // POST /m/<clé>/ask : un visiteur pose une question. Aucune donnée personnelle demandée ni gardée.
  async ask(request, ctx) {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    if (!flag(ctx, "allowQuestions", true)) return new Response("Not found", { status: 404 });
    const who = visitorId(request, ctx);
    if (limited(`${ctx.instance.key}|ask|${who}`, num(ctx.setting("askLimit"), 3, 1, 50), HOUR)) return reply(request, ctx, 429, "limit", { ok: false });
    const form = await readForm(request);
    if (!form) return reply(request, ctx, 400, "invalid", { ok: false });
    if (String(form.get("website") ?? "")) return reply(request, ctx, 200, "sent", { ok: true }); // piège à robots : on fait comme si, sans rien garder
    const text = clean(form.get("question"), LIMITS.asking);
    if (text.length < 3 || /https?:\/\/|www\./i.test(text)) return reply(request, ctx, 400, "invalid", { ok: false });

    await purgeAsked(ctx); // les questions trop anciennes partent au fil de l'eau
    const result = await locked(ctx, async () => {
      const key = askedKey(text);
      const waiting = await loadAsked(ctx);
      const same = waiting.find((a) => askedKey(a.text) === key);
      if (same) { // la même question revient : on compte, on ne duplique pas
        const row = await getRow(ctx, same.id, "asked");
        if (row) await ctx.api.store.update(same.id, { ...row.data, count: Math.min(999, same.count + 1), last: new Date().toISOString() });
        return "again";
      }
      if (waiting.length >= LIMITS.asked) return "full";
      const lang = ctx.locales.includes(ctx.locale) ? ctx.locale : ctx.defaultLocale;
      await ctx.api.store.add(C.asked, { text, lang, count: 1, last: new Date().toISOString(), status: "new" });
      return "added";
    });
    if (result === "full") return reply(request, ctx, 503, "full", { ok: false });
    if (result === "added") await tellOwner(ctx, text);
    return reply(request, ctx, 200, "sent", { ok: true });
  },

  // POST /m/<clé>/vote : « Cela m'a aidé » / « Pas vraiment ». Un compteur, rien d'autre : ni cookie, ni adresse gardée.
  async vote(request, ctx) {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    if (!flag(ctx, "votes", true)) return new Response("Not found", { status: 404 });
    const who = visitorId(request, ctx);
    if (limited(`${ctx.instance.key}|vote|${who}`, num(ctx.setting("voteLimit"), 30, 1, 500), HOUR)) return reply(request, ctx, 429, "busy", { ok: false });
    const form = await readForm(request);
    if (!form) return reply(request, ctx, 400, "problem", { ok: false });
    const id = String(form.get("q") ?? "");
    const v = String(form.get("v") ?? "");
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || (v !== "up" && v !== "down")) return reply(request, ctx, 400, "problem", { ok: false });

    const out = await locked(ctx, async () => {
      const row = await getRow(ctx, id, "item");
      if (!row || row.data.status !== "published") return null;
      const y = Math.max(0, Math.trunc(Number(row.data.y)) || 0);
      const n = Math.max(0, Math.trunc(Number(row.data.n)) || 0);
      if (alreadyVoted(who, id)) return { y, n, already: true }; // déjà noté depuis ce navigateur / cette connexion : compté une seule fois
      const next = { ...row.data, y: v === "up" ? y + 1 : y, n: v === "down" ? n + 1 : n };
      await ctx.api.store.update(id, next);
      return { y: next.y, n: next.n, already: false };
    });
    if (!out) return reply(request, ctx, 404, "problem", { ok: false });
    return reply(request, ctx, 200, "thanks", { ok: true, y: out.y, already: out.already });
  },
};
