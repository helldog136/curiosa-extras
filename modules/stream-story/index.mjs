// Story d'annonce — module de Curiosa : une petite vidéo verticale (ou presque carrée) qui annonce le prochain stream, fabriquée dans le navigateur de la personne.
//
// Ce que fait ce module, et rien d'autre : composer l'animation et l'emballer en fichier vidéo. Ce qui appartient aux autres reste chez eux :
//   - les streams : les agendas (sujet `planning.slot`, n'importe quel agenda installé) ;
//   - les partenaires et leurs photos : le Raid Twitch (sujet `stream.partner`), facultatif ;
//   - les jaquettes : le service du cœur (ctx.api.rawg) ; le logo et les couleurs : le thème du site.
// Aucune vidéo, aucune image n'est gardée sur le serveur : le fichier est téléchargé par le navigateur et c'est tout.
//
// Routes (toutes servies par `/m/<clé>/…`) :
//   studio, lib/*.mjs      la page de l'éditeur et son code (rien de personnel : aucun jeton requis) ;
//   data, streams, prep    lectures, avec le jeton de l'éditeur (en-tête X-Story-Token) ;
//   act                    écritures (POST) : co-streamers, modèles ;
//   img                    le relais d'images (liste blanche d'hôtes).
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const P = await import(`./pure.mjs${v}`);
const data = await import(`./data.mjs${v}`);
const src = await import(`./sources.mjs${v}`);
const images = await import(`./images.mjs${v}`);
const page = await import(`./page.mjs${v}`);
const admin = await import(`./admin.mjs${v}`);
const tools = await import(`./mcp.mjs${v}`);

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...NO_STORE } });
const only = (request, method) => (request.method === method || (method === "GET" && request.method === "HEAD") ? null : new Response("Method not allowed", { status: 405, headers: { Allow: method } }));
const HEX = /^#[0-9a-fA-F]{6}$/;
const hex = (value, fallback) => (HEX.test(String(value ?? "")) ? String(value) : fallback);

const zoneSetting = (ctx) => { const z = String(ctx.setting("timezone") ?? "").trim(); return P.validZone(z) ? z : ""; };
const videoColors = (ctx) => {
  const th = ctx.theme ?? {};
  const accent = hex(ctx.setting("colorAccent"), hex(th.accent, "#7c5cff"));
  return { accent, accent2: hex(ctx.setting("colorAccent2"), hex(th.accent2, accent)), bg: hex(ctx.setting("colorBackground"), hex(th.bg, "#111111")), fg: hex(ctx.setting("colorText"), hex(th.fg, "#f2f2f2")) };
};

/** Une route à jeton : 401 (une phrase, aucune donnée) sans le bon jeton ; et quoi qu'il arrive, une réponse au plus tard après `timing.routeMs` (jamais d'attente sans fin). */
const guarded = (method, handler) => async (request, ctx) => {
  const no = only(request, method); if (no) return no;
  const ok = await src.within(data.tokenValid(ctx, request.headers.get("x-story-token") ?? ""), src.timing.authMs, false);
  if (!ok) return json({ ok: false, error: "auth" }, 401);
  const out = await src.within(Promise.resolve().then(() => handler(request, ctx)).then((value) => ({ value }), (error) => ({ error })), src.timing.routeMs, null);
  if (!out) return json({ ok: false, error: "network" }, 504);
  if (out.error) { console.error("[stream-story] route failed:", out.error?.message ?? out.error); return json({ ok: false, error: "generic" }, 500); }
  return out.value;
};

const libRoute = (name) => async (request) => {
  const no = only(request, "GET"); if (no) return no;
  const text = await libSource(name);
  return new Response(text, { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" } });
};
const libSource = (name) => page.libSource(name);

/** Les écritures de l'éditeur : un corps JSON court, une opération connue. */
async function act(request, ctx) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 20_000) return json({ ok: false, error: "invalid" }, 413);
  let body;
  try { const text = await request.text(); if (text.length > 20_000) return json({ ok: false, error: "invalid" }, 413); body = JSON.parse(text); } catch { return json({ ok: false, error: "invalid" }, 400); }
  if (!body || typeof body !== "object") return json({ ok: false, error: "invalid" }, 400);
  const reply = (r) => json(r.error ? { ok: false, error: r.error } : { ok: true, ...r });
  switch (body.op) {
    case "costreamer.save": {
      const image = typeof body.image === "string" ? body.image.trim() : "";
      if (image && !images.allowedUrl(image)) return json({ ok: false, error: "image" });
      return reply(await data.saveCostreamer(ctx, { login: body.login, name: body.name, image: body.image === undefined ? undefined : image }, { originalLogin: typeof body.original === "string" ? body.original : undefined }));
    }
    case "costreamer.remove": return reply(await data.removeCostreamer(ctx, String(body.login ?? "")));
    case "costreamers.import": {
      const p = await src.loadPartners(ctx);
      if (p.state !== "ok") return json({ ok: false, error: p.state === "slow" ? "network" : "none" });
      return reply(await data.mergeCostreamers(ctx, p.items));
    }
    case "model.save": return reply(await data.saveModel(ctx, { name: body.name, config: body.config, replaceId: typeof body.replaceId === "string" ? body.replaceId : undefined }));
    case "model.remove": return reply(await data.removeModel(ctx, String(body.id ?? "")));
    default: return json({ ok: false, error: "invalid" }, 400);
  }
}

const routes = {
  async studio(request, ctx) {
    const no = only(request, "GET"); if (no) return no;
    const th = ctx.theme ?? {};
    return page.studioPage(ctx, { base: `/m/${ctx.instance.key}`, colors: videoColors(ctx), timezone: zoneSetting(ctx), font: typeof th.font === "string" ? th.font.slice(0, 200) : "", accent: hex(th.accent, "#4f46e5"), accentFg: hex(th.accentFg, "#ffffff") });
  },
  data: guarded("GET", async (request, ctx) => {
    const [costreamers, models, partners, brand] = await Promise.all([
      src.within(data.readCostreamers(ctx), 5000, []), src.within(data.readModels(ctx), 5000, []), src.within(src.loadPartners(ctx), src.timing.partnersMs + 1000, { items: [] }), src.brandOf(ctx),
    ]);
    return json({ ok: true, costreamers, models, partners: partners.items.length, brand, defaults: { lang: ctx.locale === "en" ? "en" : "fr" } });
  }),
  streams: guarded("GET", async (request, ctx) => json({ ok: true, ...(await src.loadStreams(ctx, { zone: zoneSetting(ctx) })) })),
  prep: guarded("GET", async (request, ctx) => {
    const id = new URL(request.url).searchParams.get("id") ?? "";
    const prep = await data.readPrep(ctx, id);
    return json(prep ? { ok: true, prep } : { ok: false, error: "missing" });
  }),
  act: guarded("POST", act),
  img: guarded("GET", async (request) => {
    const r = await images.fetchImage(new URL(request.url).searchParams.get("u") ?? "");
    if (!r.ok) return new Response(null, { status: r.error === "refused" ? 400 : r.error === "busy" ? 503 : r.error === "missing" ? 404 : 502, headers: NO_STORE });
    return new Response(r.bytes, { headers: { "Content-Type": r.type, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'" } });
  }),
};
for (const name of page.LIB) routes[`lib/${name}`] = libRoute(name);

export default {
  routes,
  adminPanel: admin.panel,

  mcp: {
    /** Lecture seule : les modèles enregistrés. */
    async story_models(ctx) { return { models: (await src.within(data.readModels(ctx), 5000, [])).map(tools.publicModel) }; },
    /** Lecture seule : les prochains streams de l'agenda (clé, titre, début, jeux). */
    async story_next_streams(ctx) {
      const r = await src.loadStreams(ctx, { zone: zoneSetting(ctx), max: 8 });
      return { state: r.state, streams: r.streams.map((s) => ({ key: s.key, title: s.title, start: s.start, allDay: s.allDay, games: s.games, timezone: s.timezone || null })) };
    },
    /** Écriture limitée à une « préparation » (gardée 7 jours) : rend le lien de la page préparée. Ne fabrique rien, ne publie rien. */
    async story_prepare(ctx, args) {
      const { config, manual } = tools.strictPrepare(args, { models: await src.within(data.readModels(ctx), 5000, []), tz: zoneSetting(ctx) });
      const { pid, expiresAt } = await data.savePrep(ctx, { config, manual });
      const mine = (await src.within(ctx.api.instances.list(), 4000, [])).find((i) => i.key === ctx.instance.key);
      const path = typeof mine?.adminPath === "string" && /^\/admin\//.test(mine.adminPath) ? mine.adminPath : `/admin/instances/${ctx.instance.id}`;
      return {
        ok: true, link: `${String(ctx.api.siteUrl ?? "").replace(/\/+$/, "")}${path}?prep=${pid}`, expiresAt: new Date(expiresAt).toISOString(),
        prepared: { style: config.style, format: config.format, durationSeconds: config.duration, elements: config.elements, text: config.text, costreamers: config.costreamers, stream: manual ? "hand-written" : config.streamKey || "next" },
        note: "Nothing has been generated or published. The owner opens this link while signed in to the admin, checks the preview, then clicks 'Generate the video' and saves the file.",
      };
    },
  },

  backup: {
    // La liste de co-streamers et les modèles, lisibles sans Curiosa.
    async readable(ctx) {
      const cell = (x) => { let s = String(x ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
      const members = await data.readCostreamers(ctx), models = await data.readModels(ctx);
      return [
        { path: "costreamers.csv", content: ["login,name,image", ...members.map((m) => [m.login, m.name, m.image].map(cell).join(","))].join("\r\n") },
        { path: "models.json", content: JSON.stringify(models.map(tools.publicModel), null, 2) },
      ];
    },
  },
};
