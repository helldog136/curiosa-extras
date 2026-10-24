// Annuaire — les deux routes publiques, toutes deux en lecture (GET) : elles n'écrivent jamais rien.
//   /m/<clé>/go   le formulaire de recherche : lit les champs, REFAIT l'adresse de la page à partir de valeurs vérifiées (jamais d'adresse reçue) et renvoie dessus (303).
//   /m/<clé>/csv  la liste publique en tableur : seulement ce que la page montre déjà (jamais un e-mail, un téléphone ni une note), 5 000 lignes au plus, au plus 10 demandes par minute et par visiteur.
const v = new URL(import.meta.url).search;
const P = await import(`./pure.mjs${v}`);
const D = await import(`./data.mjs${v}`);
const Dir = await import(`./directory.mjs${v}`);
const View = await import(`./view.mjs${v}`);
const { LIMITS, cell, clean } = P;

const get = (request, status = 405) => (request.method === "GET" || request.method === "HEAD" ? null : new Response("Method not allowed", { status, headers: { allow: "GET, HEAD" } }));

const hits = new Map();
/** Un visiteur dépasse-t-il `max` demandes par minute ? Compte ce passage. Mémoire bornée ; seule une empreinte (jamais l'adresse) est gardée. */
function limited(bucket, max, now = Date.now()) {
  const recent = (hits.get(bucket) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(bucket, recent);
  if (hits.size > 3000) {
    for (const [k, vv] of hits) if (!vv.some((t) => now - t < 60_000)) hits.delete(k);
    for (const k of hits.keys()) { if (hits.size <= 2000) break; hits.delete(k); }
  }
  return recent.length > max;
}
export const resetLimits = () => hits.clear();
function who(ctx, request, scope) {
  try { const f = ctx.api?.visitor?.fingerprint?.(request, scope); if (typeof f === "string" && f) return { id: f, max: 10 }; } catch { /* repli */ }
  return { id: "all", max: 60 }; // un cœur sans empreinte : une seule limite pour tout le monde, plus large
}

/** Les réglages de liste lus d'une adresse (`?c=a+b&q=…&s=new&ph=1`), vérifiés contre les catégories connues. */
function listFrom(url, slugs) {
  const params = url.searchParams;
  const rawCats = params.getAll("c").slice(0, 4).flatMap((x) => String(x).split(/[ +,]/)).filter(Boolean);
  const cats = [...new Set(rawCats.filter((s) => P.slugOk(s) && slugs.has(s)))].slice(0, LIMITS.cats);
  const q = clean((params.get("q") ?? "").replace(/\//g, " "), LIMITS.q);
  const s = params.get("s");
  return { cats, q, sort: P.SORTS.includes(s) ? s : "", photos: params.get("ph") === "1" };
}

export const routes = {
  async go(request, ctx) {
    const no = get(request);
    if (no) return no;
    if (ctx.instance.basePath === null || ctx.instance.basePath === undefined) return new Response("Not found", { status: 404 });
    const data = await D.readData(ctx).catch(() => null);
    const slugs = new Set((data?.config.cats ?? []).map((c) => c.slug));
    const o = listFrom(new URL(request.url), slugs);
    return new Response(null, { status: 303, headers: { location: Dir.listPath(P.sitePath(ctx.instance.basePath), o), "cache-control": "no-store" } });
  },

  async csv(request, ctx) {
    const no = get(request);
    if (no) return no;
    if (!View.displayOf(ctx).downloads) return new Response("Not found", { status: 404 });
    const w = who(ctx, request, "csv");
    if (limited(`${ctx.instance.key}|csv|${w.id}`, w.max)) return new Response("Too many requests", { status: 429, headers: { "retry-after": "60" } });
    const st = await View.load(ctx, {});
    if (st.state !== "ok") return new Response("The directory is not ready yet", { status: 503, headers: { "retry-after": "60" } });
    const o = listFrom(new URL(request.url), new Set(st.data.config.cats.map((c) => c.slug)));
    const q = Dir.query(st.view, { cats: o.cats, q: o.q, sort: o.q && !o.sort ? "" : o.sort || st.display.sort, perPage: LIMITS.perPageMax });
    const rows = q.all.slice(0, LIMITS.csvMax);
    const site = ctx.api?.siteUrl ?? "";
    const base = P.sitePath(ctx.instance.basePath);
    const showLinks = st.display.links !== "none";
    const head = [ctx.t("colName"), ctx.t("colRole"), ctx.t("colCategories"), ctx.t("colCity"), ctx.t("colPage"), ...(showLinks ? [ctx.t("colLinks")] : [])].map(cell).join(",");
    const lines = rows.map((e) => [
      e.name, P.pickText(e.role, ctx.locale, ctx.defaultLocale),
      e.catSlugs.map((s) => st.view.cats.find((c) => c.slug === s)).filter(Boolean).map((c) => Dir.catLabel(ctx, c)).join(" / "),
      e.city, `${site}${base}/p/${e.slug}`, ...(showLinks ? [e.links.map((l) => l.u).join(" ")] : []),
    ].map(cell).join(","));
    const name = P.slugify(ctx.instance.key, 30) || "directory";
    return new Response(`﻿${[head, ...lines].join("\r\n")}\r\n`, {
      status: 200,
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"`, "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  },
};
