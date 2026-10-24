// Événements — module de Curiosa.
//
// Un agenda d'événements et de formations pour un site : les prochains (avec filtre par type, recherche, pages), un calendrier du mois lisible sans JavaScript,
// la fiche de chaque événement (date et heure dans le fuseau du site ET chez le visiteur, programme, intervenants, inscription, vidéo, « Ajouter à mon agenda »),
// et la rétrospective des événements passés. Les types (atelier, rencontre, live…) sont ceux de la propriétaire : le code n'en connaît aucun.
//
// Pourquoi du code et pas le type « contenu » (zéro code) du cœur : voir docs/ideas/events.md. En bref, un événement a un fuseau, un jour et une heure qui
// se lisent à la volée, des répétitions, un calendrier, un fichier d'agenda, des places restantes, des liens facultatifs avec d'autres services, et il est offert
// aux autres (liste de la Story, carte) : l'éditeur d'entrées du cœur ne le permet pas.
//
// Fichiers : text.mjs · time.mjs · zones.mjs · templates.mjs · model.mjs · data.mjs · ops.mjs · query.mjs · urls.mjs · view.mjs · ics.mjs · csv.mjs · links.mjs
//            source.mjs (ce qu'on offre aux autres) · admin.mjs · mcp.mjs · scripts/events.js (le petit script de confort de la page)
const q = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en mémoire après une mise à jour)
const X = await import(`./text.mjs${q}`);
const D = await import(`./data.mjs${q}`);
const Q = await import(`./query.mjs${q}`);
const U = await import(`./urls.mjs${q}`);
const V = await import(`./view.mjs${q}`);
const ICS = await import(`./ics.mjs${q}`);
const CSV = await import(`./csv.mjs${q}`);
const S = await import(`./source.mjs${q}`);
const A = await import(`./admin.mjs${q}`);
const { mcp } = await import(`./mcp.mjs${q}`);
const MM = await import(`./model.mjs${q}`);
const L = await import(`./links.mjs${q}`);

/** Doit rester égale à `version` de module.json (vérifié par les tests). */
export const VERSION = "1.0.0";

const notFound = { notFound: true, blocks: [] };
const readOnly = (request) => request.method === "GET" || request.method === "HEAD";
const notAllowed = () => new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
const tooMany = () => new Response("Too many requests", { status: 429, headers: { "Retry-After": "60" } });
const NO_STORE = { "cache-control": "no-store" };

const infoFor = (ctx, data) => (ev) => ({
  url: U.eventUrl(ctx, ev),
  typeName: data.typeByKey.has(ev.type) ? MM.typeName(data.typeByKey.get(ev.type), ctx.locale, ctx.defaultLocale) : "",
  description: ICS.describe(ev),
});

export default {
  // PAGE PUBLIQUE : /<chemin> (les prochains), /<chemin>/cal/2026-11, /<chemin>/past, /<chemin>/e/<nom-court>, avec /t/<type> /q/<mots> /p/<page> (voir query.mjs).
  async page(ctx, { segments }) {
    const req = Q.parsePath(segments);
    if (!req) return notFound;
    const data = await D.load(ctx);
    const now = Date.now();
    let out = null;
    if (req.mode === "event") {
      const ev = data.bySlug.get(req.slug);
      if (!ev || ev.broken || ev.status !== "published") return notFound;
      out = await V.eventPage(ctx, data, ev, now);
    } else if (req.mode === "cal") out = V.calendarPage(ctx, data, req, now);
    else if (req.mode === "past") out = D.flag(ctx, "showPast", true) ? V.pastPage(ctx, data, req, now) : null;
    else out = V.listPage(ctx, data, req, now);
    if (!out) return notFound;
    // Le petit script de confort (heure chez le visiteur, vidéo après un clic) n'est chargé que sur CETTE page (cœur 0.2.6) : fichier scripts/events.js.
    return { title: out.title, description: out.description, blocks: [{ type: "html", html: out.html }], scripts: ["events.js"] };
  },

  // ACCUEIL : les prochains événements.
  sections: {
    async next(ctx, options) {
      const data = await D.load(ctx);
      const html = V.nextSection(ctx, data, Date.now(), X.num(options?.count, 3, 1, 10));
      return html ? [{ type: "html", html }] : null;
    },
  },

  routes: {
    // GET /m/<clé>/find?q=…&t=…&v=list|past|cal&m=2026-11 : la recherche et les filtres de la page, SANS JavaScript. Répond par un renvoi vers la page, dont l'adresse est construite ici.
    async find(request, ctx) {
      if (!readOnly(request)) return notAllowed();
      if (D.limited(`${ctx.instance.key}|find|${D.visitor(request, ctx, "find")}`, 60, 60_000)) return tooMany();
      const p = new URL(request.url).searchParams;
      const mode = ["list", "past", "cal"].includes(p.get("v")) ? p.get("v") : "list";
      const type = X.safeSlug(p.get("t"));
      const month = /^\d{4}-\d{2}$/.test(p.get("m") ?? "") ? p.get("m") : "";
      const href = U.hrefFor(ctx, { mode, type, words: Q.words(p.get("q") ?? ""), month: mode === "cal" ? month : "", page: 1 }) ?? "/";
      return new Response(null, { status: 303, headers: { location: href, ...NO_STORE } });
    },

    // « Ajouter à mon agenda » : un fichier .ics pour UN événement publié.
    async ics(request, ctx) {
      if (!readOnly(request)) return notAllowed();
      if (D.limited(`${ctx.instance.key}|ics|${D.visitor(request, ctx, "ics")}`, 60, 60_000)) return tooMany();
      const slug = X.safeSlug(new URL(request.url).searchParams.get("e"));
      const data = await D.load(ctx);
      const ev = slug ? data.bySlug.get(slug) : null;
      if (!ev || ev.broken || ev.status !== "published") return new Response("Not found", { status: 404 });
      const body = ICS.buildCalendar([ev], infoFor(ctx, data));
      return new Response(request.method === "HEAD" ? null : body, { headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": `attachment; filename="${ev.slug}.ics"`, "x-content-type-options": "nosniff", ...NO_STORE } });
    },

    // « S'abonner » : tous les événements à venir (100 au plus), pour un agenda qui se met à jour tout seul.
    async "feed.ics"(request, ctx) {
      if (!readOnly(request)) return notAllowed();
      if (!D.flag(ctx, "subscribe", true)) return new Response("Not found", { status: 404 });
      if (D.limited(`${ctx.instance.key}|feed|${D.visitor(request, ctx, "feed")}`, 30, 60_000)) return tooMany();
      const data = await D.load(ctx);
      const now = Date.now();
      const list = D.visible(data).filter((e) => e.endMs > now).slice(0, 100);
      const body = ICS.buildCalendar(list, infoFor(ctx, data));
      return new Response(request.method === "HEAD" ? null : body, { headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": 'inline; filename="events.ics"', "x-content-type-options": "nosniff", "cache-control": "public, max-age=300" } });
    },
  },

  // CE QU'ON OFFRE AUX AUTRES : la liste des événements à venir (contrat `event.source`) et les lieux (sujet `map.place`).
  services: {
    "event.source": {
      async upcoming(ctx, args) { return S.upcomingAnswer(ctx, args); },
    },
  },
  exports: {
    "map.place": (ctx, args) => S.places(ctx, args),
  },

  adminPanel: A.panel,
  adminActions: A.actionRights,
  adminBadge: A.badge,
  adminDownloads: A.downloads,
  mcp,

  // SAUVEGARDE LISIBLE : un tableur des événements, relisible sans le site (et réimportable tel quel).
  backup: {
    async readable(ctx) {
      let events = "";
      for await (const chunk of CSV.exportLines(ctx)) events += chunk;
      const data = await D.load(ctx);
      const head = ["id", "names", "color", "icon"].map(X.cell).join(",");
      const types = data.types.map((t) => [t.key, Object.entries(t.names).map(([l, n]) => `${l}: ${n}`).join(" / "), t.color, t.icon].map(X.cell).join(","));
      return [{ path: "events.csv", content: events }, { path: "types.csv", content: `﻿${[head, ...types].join("\r\n")}\r\n` }];
    },
  },

  hooks: {
    // Quand l'instance disparaît, sa mémoire aussi (un agenda recréé sous la même clé ne doit rien hériter de l'ancien).
    async onInstanceDelete(ctx) {
      D.forget(ctx);
      L.forgetLinks(ctx);
    },
  },
};
