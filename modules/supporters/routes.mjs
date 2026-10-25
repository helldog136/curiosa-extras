// Soutiens — les deux seules routes publiques (POST uniquement) :
//   • kofi    : la notification d'une plateforme qui prévient à chaque don (webhook). VÉRIFIÉE (jeton secret, comparaison en temps constant), LIMITÉE en débit, bornée en taille,
//               idempotente (un même message n'est compté qu'une fois), muette dans ses erreurs. Le site ne contacte jamais la plateforme pour cela.
//   • consent : l'accord (ou le retrait) d'une personne sur SON lien personnel. Aucune donnée n'est lue : seulement un pseudo choisi, jamais montré avant accord ET relecture.
// Chaque route : méthode vérifiée, corps borné, piège à robots, limite par visiteur ET limite globale, aucun détail interne dans les erreurs, aucun cookie, aucune adresse gardée.
const v = new URL(import.meta.url).search;
const P = await import(`./pure.mjs${v}`);
const D = await import(`./data.mjs${v}`);
const R = await import(`./providers.mjs${v}`);
const S = await import(`./sync.mjs${v}`);
const C = await import(`./contacts.mjs${v}`);
const V = await import(`./view.mjs${v}`);
const { LIMITS, clean } = P;

const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
const notAllowed = (allow) => new Response("Method not allowed", { status: 405, headers: { Allow: allow } });

/* ───────────── Limiteur de débit (en mémoire, borné) ───────────── */
const hits = new Map(); // « clé » → { n, reset }
export const resetLimits = () => hits.clear();
/** Vrai si la limite est dépassée. 2 000 compteurs au plus (les plus anciens partent). */
export function limited(key, max, windowMs) {
  const now = Date.now(), h = hits.get(key);
  if (!h || now >= h.reset) {
    if (hits.size >= 2000) for (const k of hits.keys()) { hits.delete(k); if (hits.size < 1800) break; }
    hits.set(key, { n: 1, reset: now + windowMs });
    return false;
  }
  h.n++;
  return h.n > max;
}
const who = (ctx, request, scope) => { try { return String(ctx.api.visitor.fingerprint(request, scope)); } catch { return "x"; } };

/** Lit le corps en texte, borné. { text } ou { status }. */
async function readText(request, max) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return { status: 413 };
  let raw;
  try { raw = await request.text(); } catch { return { status: 400 }; }
  return raw.length > max ? { status: 413 } : { text: raw };
}

export const routes = {
  // POST /m/<clé>/kofi : le corps est « data=<JSON> » (formulaire) ou le JSON lui-même.
  async kofi(request, ctx) {
    if (request.method !== "POST") return notAllowed("POST");
    const key = ctx.instance.key;
    const provider = R.providerOf(ctx);
    const token = clean(ctx.setting("accessToken"), 600);
    if (provider.id !== "kofi" || !token) return json({ ok: false }, 404);
    if (limited(`${key}|k|g`, 240, 60_000)) return json({ ok: false }, 429, { "retry-after": "30" });
    const fp = who(ctx, request, "kofi");
    if (limited(`${key}|k|${fp}`, 120, 60_000)) return json({ ok: false }, 429, { "retry-after": "30" });
    const body = await readText(request, LIMITS.kofiBytes);
    if (body.status) return json({ ok: false }, body.status);
    let payload = null;
    try {
      const t = body.text.trim();
      payload = t.startsWith("{") ? JSON.parse(t) : JSON.parse(new URLSearchParams(t).get("data") ?? "null");
    } catch { payload = null; }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return json({ ok: false }, 400);
    if (!provider.verify(payload, token)) {
      // Un mauvais jeton : réponse muette ; trop d'essais ratés d'un même visiteur → pause.
      return json({ ok: false }, limited(`${key}|k|bad|${fp}`, 10, 60_000) ? 429 : 401);
    }
    const ev = provider.parseEvent(payload);
    if (!ev) return json({ ok: true, ignored: true });
    try { await S.applyEvent(ctx, provider, ev); } catch { return json({ ok: false }, 500); }
    return json({ ok: true });
  },

  // POST /m/<clé>/consent : { pid, t, act: accept|withdraw, pseudo, agree } → 303 vers la page personnelle (avec l'état dans le chemin).
  async consent(request, ctx) {
    if (request.method !== "POST") return notAllowed("POST");
    const key = ctx.instance.key;
    if (limited(`${key}|c|g`, 300, 60_000)) return json({ ok: false }, 429, { "retry-after": "30" });
    if (limited(`${key}|c|${who(ctx, request, "consent")}`, 40, 3_600_000)) return json({ ok: false }, 429, { "retry-after": "300" });
    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > 4000) return json({ ok: false }, 413);
    let form;
    try { form = await request.formData(); } catch { return json({ ok: false }, 400); }
    const field = (name, max) => (typeof form.get(name) === "string" ? String(form.get(name)).slice(0, max) : "");
    const loc = ctx.locales.includes(field("loc", 12)) ? field("loc", 12) : ctx.defaultLocale;
    const prefix = loc !== ctx.defaultLocale ? `/${loc}` : "";
    const base = ctx.instance.basePath ? `/${String(ctx.instance.basePath).replace(/^\/+|\/+$/g, "")}` : "";
    if (field("website", 100)) return redirect(`${prefix}${base}` || "/");   // piège à robots : on fait semblant
    const pid = field("pid", 40), token = field("t", 80);
    if (!P.pidOk(pid) || !/^[a-f0-9]{32}$/.test(token)) return json({ ok: false }, 404);
    const rec = await V.personByLink(ctx, pid, token);
    if (!rec) return json({ ok: false }, 404);
    const to = (state) => redirect(`${prefix}${base}/moi/${pid}/${token}/${state}`);
    const act = field("act", 12);
    if (act === "withdraw") {
      await D.withLock(ctx, async () => {
        const f = (await D.snapshot(ctx, { fresh: true })).byPid.get(pid);
        if (f) await ctx.api.store.update(f.id, { ...f.data, consent: null, approved: false });
      });
      await C.protectWall(ctx, rec.data);
      return to("left");
    }
    if (act !== "accept") return to("e-wait");
    if (field("agree", 8) !== "yes") return to("e-agree");
    const chk = P.checkPseudo(field("pseudo", 200));
    if (!chk.ok) return to(`e-${chk.error}`);
    const review = P.flag(ctx.setting("review"), true);
    let approved = false;
    await D.withLock(ctx, async () => {
      const f = (await D.snapshot(ctx, { fresh: true })).byPid.get(pid);
      if (!f) return;
      const same = f.data.consent?.pseudo === chk.value;
      approved = !review || (same && f.data.approved === true);
      await ctx.api.store.update(f.id, { ...f.data, consent: { pseudo: chk.value, at: new Date().toISOString().slice(0, 10) }, approved });
    });
    if (!approved || rec.data.consent?.pseudo !== chk.value) await C.protectWall(ctx, rec.data);
    return to(approved ? "ok-shown" : "ok-pending");
  },
};

function redirect(location) {
  return new Response(null, { status: 303, headers: { location, "cache-control": "no-store" } });
}
