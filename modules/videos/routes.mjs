// Vidéothèque — les deux petites routes publiques (lecture seule, aucune écriture, aucun cookie) :
//   thumb?v=<n>      la miniature GARDÉE par le site (jamais récupérée chez la plateforme à ce moment-là : seulement lue dans le stockage)
//   find?q=…&c=…     la recherche : le formulaire envoie ici, la route renvoie vers l'adresse du catalogue filtré (fabriquée à partir de mots nettoyés et d'une catégorie connue : jamais d'adresse reçue)
const v = new URL(import.meta.url).search;
const P = await import(`./pure.mjs${v}`);
const D = await import(`./data.mjs${v}`);

const refuse = (status, text = "") => new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...(status === 405 ? { allow: "GET" } : {}) } });

export const routes = {
  async thumb(request, ctx) {
    if (request.method !== "GET") return refuse(405);
    const raw = new URL(request.url).searchParams.get("v") ?? "";
    if (!/^\d{1,7}$/.test(raw)) return refuse(404);
    try {
      if (D.settings(ctx).thumbs === "plain") return refuse(404);
      const snap = await D.snapshot(ctx);
      const x = snap.byN.get(Number(raw));
      if (!x || !D.isPublic(x) || !x.thumb) return refuse(404);
      const t = await D.getThumb(ctx, x.n);
      if (!t) return refuse(404);
      const headers = { "content-type": t.type, "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff", etag: t.etag, "content-security-policy": "sandbox" };
      if (request.headers.get("if-none-match") === t.etag) return new Response(null, { status: 304, headers });
      return new Response(t.bytes, { status: 200, headers: { ...headers, "content-length": String(t.bytes.length) } });
    } catch { return refuse(404); }
  },

  async find(request, ctx) {
    if (request.method !== "GET") return refuse(405);
    const params = new URL(request.url).searchParams;
    const q = P.searchSlug(params.get("q") ?? "");
    let cat = "";
    try {
      const wanted = P.clean(params.get("c") ?? "", 40);
      if (wanted) cat = D.catByRef(await D.snapshot(ctx), wanted)?.slug ?? "";
    } catch { cat = ""; }
    const to = P.listPath(ctx, { cat, q });
    if (to === null || !to.startsWith("/") || to.startsWith("//")) return refuse(404);
    return new Response(null, { status: 303, headers: { location: to, "cache-control": "no-store" } });
  },
};
