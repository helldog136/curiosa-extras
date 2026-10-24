// Jeu du jour — les routes publiques (POST seulement, sauf le petit script du bloc d'accueil).
//  • answer : juge la réponse et ne montre la solution qu'APRÈS. Ne garde rien : ni la réponse, ni qui l'a donnée.
//  • board  : (facultatif, avec Participation) pseudo, score du jour et classement de la semaine, ou « oubliez-moi ».
//  • card.js: le script du bloc d'accueil.
// Chaque route : méthode vérifiée, corps borné, piège à robots, limite par visiteur ET limite globale, aucun détail interne dans les erreurs.
const q = new URL(import.meta.url).search;
const L = await import(`./lib.mjs${q}`);
const D = await import(`./data.mjs${q}`);
const B = await import(`./bridge.mjs${q}`);
const C = await import(`./client.mjs${q}`);
const { num, weekKey } = L;

const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
const notAllowed = (allow) => new Response("Method not allowed", { status: 405, headers: { Allow: allow } });
const TOKEN_RE = /^[A-Za-z0-9_-]{22,64}$/;

async function readBody(request, max) {
  const raw = await request.text();
  if (raw.length > max) return { status: 413 };
  try { const body = JSON.parse(raw); return body && typeof body === "object" && !Array.isArray(body) ? { body } : { status: 400 }; } catch { return { status: 400 }; }
}

/** Les points d'une réponse : 100 pour une bonne réponse, plus un bonus de rapidité (50 au plus) si la personne a gardé le chronomètre. */
export function scoreOf(ctx, result, body) {
  const base = Math.round(100 * (typeof result.score === "number" ? Math.min(1, Math.max(0, result.score)) : result.correct ? 1 : 0));
  let bonus = 0;
  const ms = Number(body?.ms);
  if (base > 0 && D.timerModeOf(ctx) !== "none" && body?.timer === true && Number.isFinite(ms) && ms >= 0) {
    bonus = Math.round(50 * Math.max(0, 1 - ms / (D.secondsOf(ctx) * 1000)));
  }
  return { pts: base + bonus, bonus };
}

/** Le jour et la question que la personne croit jouer : sont-ils toujours ceux d'aujourd'hui ? */
async function currentPlay(ctx, body) {
  const { day, item } = await D.getToday(ctx);
  if (!item) return { stop: "none", status: 404 };
  if (body.day !== day || body.qid !== item.id) return { stop: "newday", status: 409 };
  return { day, item };
}

export const routes = {
  // POST /m/<clé>/answer : { day, qid, choice, ms?, timer? } → { ok, correct, pts, bonus, reveal }
  async answer(request, ctx) {
    if (request.method !== "POST") return notAllowed("POST");
    const key = ctx.instance.key;
    if (D.limited(`${key}|g`, 900, 60_000)) return json({ ok: false, reason: "busy" }, 429, { "retry-after": "30" });
    if (D.limited(`${key}|a|${D.visitor(ctx, request, "answer")}`, num(ctx.setting("answerLimit"), 40, 5, 500), D.HOUR)) return json({ ok: false, reason: "limit" }, 429, { "retry-after": "300" });
    const read = await readBody(request, 1000);
    if (!read.body) return json({ ok: false, reason: "invalid" }, read.status);
    const body = read.body;
    if (String(body.website ?? "")) return json({ ok: true, correct: false, pts: 0, bonus: 0, reveal: {} });   // piège à robots : on fait semblant, rien ne se passe
    const play = await currentPlay(ctx, body);
    if (play.stop) return json({ ok: false, reason: play.stop }, play.status);
    const result = D.typeOf(ctx).check(ctx, play.item, body);
    if (!result?.ok) return json({ ok: false, reason: "invalid" }, 400);
    const { pts, bonus } = scoreOf(ctx, result, body);
    return json({ ok: true, correct: !!result.correct, pts, bonus, reveal: result.reveal ?? {} });
  },

  // POST /m/<clé>/board : { act: "join" | "score" | "leave", t, nick?, day?, qid?, choice?, ms?, timer? }
  async board(request, ctx) {
    if (request.method !== "POST") return notAllowed("POST");
    if (!D.flag(ctx, "leaderboard", false)) return json({ ok: false, reason: "off" }, 404);
    const key = ctx.instance.key;
    const who = D.visitor(ctx, request, "board");
    if (D.limited(`${key}|g2`, 300, 60_000)) return json({ ok: false, reason: "busy" }, 429, { "retry-after": "30" });
    if (D.limited(`${key}|b|${who}`, 60, D.HOUR)) return json({ ok: false, reason: "limit" }, 429, { "retry-after": "300" });
    const read = await readBody(request, 1500);
    if (!read.body) return json({ ok: false, reason: "invalid" }, read.status);
    const body = read.body;
    if (String(body.website ?? "")) return json({ ok: true, top: [] });
    if (!TOKEN_RE.test(String(body.t ?? ""))) return json({ ok: false, reason: "invalid" }, 400);
    if (!["join", "score", "leave"].includes(body.act)) return json({ ok: false, reason: "invalid" }, 400);
    if (!(await B.present(ctx))) return json({ ok: false, reason: "boardOff" }, 503);
    const room = B.roomOf(ctx), conn = B.connOf(who), token = String(body.t);

    if (body.act === "leave") {
      const known = await B.audience(ctx, "who", { room, token });
      const pid = known?.ok ? known.participant?.id : null;
      if (pid) await D.boardForget(ctx, pid);
      await B.audience(ctx, "forget", { token });
      return json({ ok: true });
    }

    const limit = await B.audience(ctx, "limit", { room, scope: "board", conn, token, max: 30, per: 3600 });
    if (!limit) return json({ ok: false, reason: "boardOff" }, 503);
    if (!limit.ok) return json({ ok: false, reason: B.reasonOf(limit.error) }, limit.error === "limit" ? 429 : 400);
    const nick = typeof body.nick === "string" && body.nick.trim() ? body.nick : undefined;
    const joined = await B.audience(ctx, "join", { room, label: ctx.instance.name, token, conn, ...(nick ? { pseudo: nick } : {}) });
    if (!joined) return json({ ok: false, reason: "boardOff" }, 503);
    if (!joined.ok) return json({ ok: false, reason: B.reasonOf(joined.error) }, joined.error === "limit" ? 429 : joined.error === "busy" ? 503 : 400);
    const me = joined.participant ?? {};
    if (me.muted) return json({ ok: false, reason: "muted" }, 403);
    if (!me.pseudo) return json({ ok: false, reason: "boardNeedPseudo" }, 400);
    const { day } = await D.getToday(ctx);
    const week = weekKey(day);
    if (body.act === "join") return json({ ok: true, rank: null, top: await publicTop(ctx, week) });

    // act === "score" : la bonne réponse est recalculée ICI (jamais crue sur parole), et chaque jour ne compte qu'une fois par personne.
    const play = await currentPlay(ctx, body);
    if (play.stop) return json({ ok: false, reason: play.stop }, play.status);
    const result = D.typeOf(ctx).check(ctx, play.item, body);
    if (!result?.ok) return json({ ok: false, reason: "invalid" }, 400);
    const claim = await B.audience(ctx, "claim", { room, token, key: `s${play.day.replace(/-/g, "")}` });
    if (!claim) return json({ ok: false, reason: "boardOff" }, 503);
    if (!claim.ok && claim.error !== "already") return json({ ok: false, reason: B.reasonOf(claim.error) }, claim.error === "limit" ? 429 : 400);
    const { pts } = scoreOf(ctx, result, body);
    const added = claim.ok
      ? await D.boardAdd(ctx, { week, pid: me.id, nick: me.pseudo, pts, win: !!result.correct, day: play.day })
      : { rank: (await D.boardTop(ctx, week, L.LIMITS.board)).find((r) => r.id === me.id)?.rank ?? null, already: true };
    return json({ ok: true, rank: added.rank, already: !!added.already, top: await publicTop(ctx, week) });
  },

  // GET /m/<clé>/card.js : le petit script du bloc d'accueil (le même pour tous, gardé en mémoire par les navigateurs quelques minutes)
  async "card.js"(request) {
    if (request.method !== "GET") return notAllowed("GET");
    return new Response(C.CARD_JS, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=300", "x-content-type-options": "nosniff" } });
  },
};

/** Le haut du classement, sans identifiant (seulement ce qui s'affiche). */
async function publicTop(ctx, week) {
  return (await D.boardTop(ctx, week, 10)).map((r) => ({ rank: r.rank, name: r.name, pts: r.pts }));
}
