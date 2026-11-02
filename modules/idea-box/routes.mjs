// Boîte à idées — ce que fait le public : proposer une idée, soutenir une idée.
// Deux formulaires HTML ordinaires (ils marchent sans JavaScript) : la réponse est une redirection vers la page, avec un message dans l'adresse (#ib-…).
// Anti-abus, sans service externe ni pistage : piège à robots, limite par heure (empreinte salée du cœur, jamais gardée), texte borné, deux adresses web au plus,
// plafond d'idées en attente, un soutien par idée et par navigateur (petit cookie des numéros d'idées + mémoire du serveur).
const v = new URL(import.meta.url).search;   // chaque fichier voisin est importé avec la version du module (voir index.mjs)
const { COLLECTION, MAX_STORED, NICK_MAX, TEXT_MIN, VOTABLE, HOUR, YEAR, clean, cookieHeader, limited, linkCount, loadAll, norm, pageHref, readVotedIds, settings, textKey, toData, whoOf } = await import(`./lib.mjs${v}`);
const { journal, purgeRefused } = await import(`./ops.mjs${v}`);

const back = (ctx, note, cookie) => {
  const res = new Response(null, { status: 303, headers: { Location: `${pageHref(ctx) ?? "/"}#ib-${note}` } });
  if (cookie) res.headers.append("Set-Cookie", cookie);
  return res;
};
const form = async (request) => { try { return await request.formData(); } catch { return null; } };

export const routes = {
  async propose(request, ctx) {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const s = settings(ctx);
    if (limited(`p|${ctx.instance.key}|${whoOf(request, ctx, "propose")}`, s.hourlyLimit, HOUR)) return back(ctx, "limit");
    const data = await form(request);
    if (!data) return new Response("Bad request", { status: 400 });
    if (String(data.get("website") ?? "")) return back(ctx, s.autoPublish ? "sent" : "review");   // piège à robots : on fait semblant, rien n'est gardé
    const text = clean(data.get("idea"), true);
    if (text.length < TEXT_MIN) return back(ctx, "invalid");
    if (text.length > s.textMax) return back(ctx, "long");
    if (linkCount(text) > 1) return back(ctx, "links");
    const rawNick = clean(data.get("nick"));
    const nick = rawNick.length <= NICK_MAX && !linkCount(rawNick) ? rawNick : "";
    const all = await loadAll(ctx);
    if (all.length >= MAX_STORED || all.filter((i) => i.state === "pending").length >= s.maxPending) {
      await purgeRefused(ctx, Date.now(), all);
      return back(ctx, "full");
    }
    const key = textKey(text);
    if (all.some((i) => i.state === "published" && textKey(i.text) === key)) return back(ctx, "dup");
    const state = s.autoPublish ? "published" : "pending";
    const id = await ctx.api.store.add(COLLECTION, toData({ text, nick, state, status: "proposed", votes: 0, reply: "", refusedAt: "", merged: [] }));
    await journal(ctx, "idea.received", id);
    if (state === "published") await journal(ctx, "idea.published", id);
    await purgeRefused(ctx, Date.now(), all);
    return back(ctx, state === "published" ? "sent" : "review");
  },

  // « Je soutiens » : un seul soutien par idée et par navigateur. Le cookie ne garde que des numéros d'idées ; la mémoire du serveur double le cookie
  // (on peut effacer un cookie) avec l'empreinte salée du cœur, qui change chaque jour et n'est jamais écrite.
  async support(request, ctx) {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    if (!settings(ctx).votes) return back(ctx, "off");
    const data = await form(request);
    if (!data) return new Response("Bad request", { status: 400 });
    const row = await ctx.api.store.get(String(data.get("id") ?? "").slice(0, 100));
    const idea = row ? norm(row) : null;
    if (!idea || idea.state !== "published" || !VOTABLE.includes(idea.status)) return back(ctx, "problem");
    const voted = readVotedIds(request);
    const who = whoOf(request, ctx, "support");
    if (voted.includes(idea.id) || idea.merged.some((m) => voted.includes(m)) || limited(`s|${ctx.instance.key}|${who}|${idea.id}`, 1, YEAR)) return back(ctx, "again");
    if (limited(`b|${ctx.instance.key}|${who}`, 30, HOUR)) return back(ctx, "limit");
    const fresh = await ctx.api.store.get(idea.id);   // relu : un autre soutien arrivé entre-temps ne doit pas être écrasé
    if (!fresh) return back(ctx, "problem");
    const current = norm(fresh);
    await ctx.api.store.update(current.id, toData({ ...current, votes: current.votes + 1 }));
    return back(ctx, "voted", cookieHeader([...voted, idea.id]));
  },
};
