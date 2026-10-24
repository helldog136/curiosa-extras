// Carte : les routes publiques, toutes en lecture (GET) : les points de la carte, la fiche d'un lieu, la liste filtrée (recherche sans recharger la page),
// et la recherche sans JavaScript (qui renvoie vers une adresse de la page). Rien n'est écrit, aucun visiteur n'est repéré : le limiteur ne garde que
// l'empreinte du cœur (changée chaque jour, jamais l'adresse). La position d'un visiteur n'arrive JAMAIS ici : « Près de moi » se calcule dans son navigateur.
// Les fichiers voisins sont importés avec la même « version » que celui-ci.

const q = new URL(import.meta.url).search;
const { esc, clean, safeId, isCode, LIMITS } = await import(new URL(`./text.mjs${q}`, import.meta.url).href);
const { visible, typeInfo, limited, visitorId, MINUTE } = await import(new URL(`./data.mjs${q}`, import.meta.url).href);
const { filterPlaces, listParts, ficheHtml, listHref, placeHref, pageHref } = await import(new URL(`./view.mjs${q}`, import.meta.url).href);

const json = (body, status = 200, cache = "no-store") => Response.json(body, { status, headers: { "cache-control": cache, "x-content-type-options": "nosniff" } });
const readOnly = (request) => (request.method === "GET" || request.method === "HEAD" ? null : new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } }));

/** Les paramètres de filtre venus de l'adresse : toujours nettoyés (type = lettres/chiffres/tirets, recherche = texte court). */
function filters(url) {
  return { t: safeId(url.searchParams.get("t") ?? ""), q: clean(url.searchParams.get("q") ?? "", LIMITS.search) };
}

function slow(request, ctx, scope, max) {
  return limited(`${ctx.instance.key}|${scope}|${visitorId(request, ctx, scope)}`, max, MINUTE);
}

export const routes = {
  // GET /m/<clé>/points : tous les lieux de la liste filtrée, en version compacte, pour la carte et pour « Près de moi ». [code, lat, lng, type, nom, venu d'ailleurs ?]
  async points(request, ctx) {
    const bad = readOnly(request); if (bad) return bad;
    if (slow(request, ctx, "points", 30)) return json({ ok: false }, 429);
    const vis = await visible(ctx);
    const f = filters(new URL(request.url));
    const list = filterPlaces(vis.all, f);
    const types = [];
    const index = new Map();
    const pts = list.map((p) => {
      if (!index.has(p.type)) { index.set(p.type, types.length); const i = typeInfo(ctx, vis.world, p.type); types.push([i.id, i.name, i.sym]); }
      return [p.code, p.lat, p.lng, index.get(p.type), p.name, p.ext ? 1 : 0];
    });
    return json({ ok: true, v: 1, n: pts.length, types, pts }, 200, "public, max-age=60");
  },

  // GET /m/<clé>/place?c=<code> : la fiche d'un lieu (HTML déjà échappé), pour le panneau sous la carte.
  async place(request, ctx) {
    const bad = readOnly(request); if (bad) return bad;
    if (slow(request, ctx, "place", 120)) return json({ ok: false }, 429);
    const code = String(new URL(request.url).searchParams.get("c") ?? "");
    if (!isCode(code)) return json({ ok: false }, 404);
    const vis = await visible(ctx);
    const p = vis.byCode.get(code);
    if (!p) return json({ ok: false }, 404);
    const href = placeHref(ctx, code);
    const link = href ? `<p class="cm-links"><a class="cm-link" href="${esc(href)}">${esc(ctx.t("ficheLink"))}</a></p>` : "";
    return json({ ok: true, code, name: p.name, lat: p.lat, lng: p.lng, html: ficheHtml(ctx, vis.world, p) + link }, 200, "public, max-age=30");
  },

  // GET /m/<clé>/list?q=…&t=…&p=… : la liste filtrée, en morceaux de HTML (recherche sans recharger la page).
  async list(request, ctx) {
    const bad = readOnly(request); if (bad) return bad;
    if (slow(request, ctx, "list", 90)) return json({ ok: false }, 429);
    const url = new URL(request.url);
    const f = filters(url);
    const page = Math.min(1000, Math.max(1, Math.trunc(Number(url.searchParams.get("p"))) || 1));
    const vis = await visible(ctx);
    const parts = listParts(ctx, vis, f, page);
    return json({ ok: true, ...parts, href: listHref(ctx, f) }, 200, "no-store");
  },

  // GET /m/<clé>/go?q=…&t=… : la recherche d'un formulaire sans JavaScript. La destination est TOUJOURS construite ici (jamais lue dans la requête).
  async go(request, ctx) {
    const bad = readOnly(request); if (bad) return bad;
    if (slow(request, ctx, "go", 30)) return new Response("Too many requests", { status: 429 });
    const f = filters(new URL(request.url));
    const href = listHref(ctx, f) ?? pageHref(ctx);
    if (href === null) return new Response("Not found", { status: 404 });
    return new Response(null, { status: 303, headers: { location: href, "cache-control": "no-store" } });
  },
};
