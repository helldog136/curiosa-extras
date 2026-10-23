// Story d'annonce — module de Curiosa : une petite vidéo verticale (ou presque carrée) qui annonce le prochain stream, fabriquée dans le navigateur de la personne.
//
// Ce que fait ce module, et rien d'autre : composer l'animation et l'emballer en fichier vidéo. Ce qui appartient aux autres reste chez eux :
//   - les streams : les agendas (sujet `planning.slot`, n'importe quel agenda installé) ;
//   - les autres événements datés (vidéos et directs programmés, planning d'une chaîne…) : les modules qui offrent le service `event.source` (facultatif, aucun n'est nommé ici) ;
//   - les personnes (co-streamers) et leurs photos : Contacts (service `contact.book`, version 2), FACULTATIF. Story ne garde que des identifiants de fiche ; sans Contacts, il reste
//     la saisie « pour cette vidéo seulement » ;
//   - les jaquettes : le service du cœur (ctx.api.rawg) ; le logo et les couleurs : le thème du site.
// Aucune vidéo, aucune image n'est gardée sur le serveur : le fichier est téléchargé par le navigateur et c'est tout.
//
// Routes (toutes servies par `/m/<clé>/…`) :
//   studio, lib/*.mjs, wordmark   la page de l'éditeur, son code et la police du nom « Curiosa » (rien de personnel : aucun jeton requis) ;
//   events, cover          la liste « Pour quoi veux-tu une story ? » (événements de toutes les sources, par pages) et la jaquette d'un jeu ;
//   data, streams, prep    lectures, avec le jeton de l'éditeur (en-tête X-Story-Token) ;
//   people, members        la recherche d'une personne dans Contacts, et la relecture des fiches d'un modèle ;
//   categories, category   les catégories de Contacts, et les comptes d'une catégorie (par pages) ;
//   act                    écritures (POST) : saisie ponctuelle, ponctuels, modèles, choix de la mention « Made with Curiosa » ;
//   img                    le relais d'images (liste blanche d'hôtes).
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const P = await import(`./pure.mjs${v}`);
const data = await import(`./data.mjs${v}`);
const src = await import(`./sources.mjs${v}`);
const E = await import(`./events.mjs${v}`);
const book = await import(`./contacts.mjs${v}`);
const migrate = await import(`./migrate.mjs${v}`);
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
    case "adhoc.check": return reply(data.adhocEntry({ login: body.login, name: body.name, image: body.image }));
    case "adhoc.remove": return reply(await data.removeAdhoc(ctx, String(body.id ?? "")));
    case "prefs.watermark": return typeof body.watermark === "boolean" ? reply({ watermark: await data.setWatermarkPref(ctx, body.watermark) }) : json({ ok: false, error: "invalid" }, 400);
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
    // L'ancienne liste de co-streamers est confiée à Contacts dès que Contacts répond (l'éditeur ouvert par une personne est le seul moment : jamais en arrière-plan).
    const moved = await migrate.ensureMigrated(ctx, { waitMs: Math.floor(src.timing.routeMs * 0.6) });
    const [models, adhoc, hasBook, brand, watermark] = await Promise.all([src.within(data.readModels(ctx), 5000, []), src.within(data.readPickable(ctx), 5000, []), book.hasBook(ctx), src.brandOf(ctx), src.within(data.watermarkDefault(ctx), 3000, false)]);
    return json({
      ok: true, models, adhoc, contacts: hasBook ? "ok" : "absent", brand, defaults: { lang: ctx.locale === "en" ? "en" : "fr", watermark: watermark === true },
      migrated: moved.state === "done" && (moved.created || moved.existing || moved.kept) ? { created: moved.created, existing: moved.existing, kept: moved.kept } : null,
    });
  }),
  people: guarded("GET", async (request, ctx) => {
    const q = new URL(request.url).searchParams;
    return json({ ok: true, ...(await book.searchPeople(ctx, { q: q.get("q") ?? "", network: q.get("network") ?? "" })) });
  }),
  members: guarded("GET", async (request, ctx) => {
    const ids = new URL(request.url).searchParams.getAll("id").slice(0, 24);
    return json({ ok: true, ...(await book.resolveMembers(ctx, ids)) });
  }),
  categories: guarded("GET", async (request, ctx) => {
    const q = new URL(request.url).searchParams;
    return json({ ok: true, ...(await book.listCategories(ctx, { cursor: q.get("cursor") ?? "", q: q.get("q") ?? "" })) });
  }),
  category: guarded("GET", async (request, ctx) => {
    const q = new URL(request.url).searchParams;
    return json({ ok: true, ...(await book.categoryPeople(ctx, { categoryId: q.get("id") ?? "", cursor: q.get("cursor") ?? "" })) });
  }),
  streams: guarded("GET", async (request, ctx) => json({ ok: true, ...(await src.loadStreams(ctx, { zone: zoneSetting(ctx) })) })),
  // La liste « Pour quoi veux-tu une story ? » : tous les événements à venir de toutes les sources, par pages (50 au plus), avec recherche et filtre par source.
  // `id` / `key` : retrouver l'événement déjà choisi (même s'il n'est pas sur cette page) ; la réponse dit aussi quelles sources ont répondu.
  events: guarded("GET", async (request, ctx) => {
    const q = new URL(request.url).searchParams;
    const all = await src.loadEvents(ctx, { zone: zoneSetting(ctx), force: q.get("fresh") === "1" });
    const list = E.filterEvents(all.events, { q: q.get("q") ?? "", source: q.get("source") ?? "" });
    const page = E.pageOf(list, { cursor: q.get("cursor") ?? "", limit: q.get("limit") ?? E.LIMITS.pageDefault });
    const wanted = (q.get("id") ?? "").slice(0, 100), key = (q.get("key") ?? "").slice(0, 20);
    const selected = wanted || key ? E.findEvent(all.events, { id: P.EVENT_ID.test(wanted) ? wanted : "", key: /^[a-z0-9]{1,20}$/.test(key) ? key : "" }) : null;
    return json({ ok: true, items: page.items.map(E.publicEvent), next: page.next, total: list.length, totalAll: all.events.length, sources: all.sources, selected: selected ? E.publicEvent(selected) : null, at: all.at });
  }),
  cover: guarded("GET", async (request, ctx) => json({ ok: true, ...(await src.coverOf(ctx, new URL(request.url).searchParams.get("game") ?? "")) })),
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
// La police du nom « Curiosa » pour la mention : un petit fichier fixe (rien de personnel, aucun jeton).
routes.wordmark = async (request) => {
  const no = only(request, "GET"); if (no) return no;
  return new Response(await page.wordmarkFont(), { headers: { "Content-Type": "font/woff2", "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" } });
};
for (const name of page.LIB) routes[`lib/${name}`] = libRoute(name);

/** Les noms que l'IA peut redonner à `story_prepare` : le pseudo Twitch de la fiche, sinon son nom. Une fiche illisible (Contacts muet) est simplement omise. */
async function namesOf(ctx, entriesLists, known = new Map()) {
  const ids = [...new Set(entriesLists.flat().filter((e) => e.id && !known.has(e.id)).map((e) => e.id))].slice(0, 100);
  const names = new Map(known);
  if (!ids.length) return names;
  const r = await book.resolveMembers(ctx, ids);
  for (const m of r.members) names.set(m.ref, m.accounts.find((a) => a.network === "twitch")?.handle || m.name);
  return names;
}
/** Les pseudos Twitch donnés à l'IA : si Contacts connaît la personne, la vidéo en garde l'identifiant de fiche ; sinon un co-streamer « pour cette vidéo seulement ». */
async function linkLogins(ctx, config) {
  const todo = [...new Set(config.costreamers.filter((e) => !e.id && e.login && !e.name && !e.image && P.LOGIN.test(e.login)).map((e) => e.login))];
  if (!todo.length || !(await book.hasBook(ctx))) return { config, known: new Map() };
  const found = new Map((await Promise.all(todo.map(async (login) => [login, await book.idOfTwitchLogin(ctx, login)]))).filter(([, id]) => id));
  const known = new Map([...found].map(([login, id]) => [id, login]));
  const list = [];
  for (const e of config.costreamers) {
    const m = !e.id && found.has(e.login) && !e.name && !e.image ? { id: found.get(e.login) } : e;
    if (!list.some((x) => P.memberKey(x) === P.memberKey(m))) list.push(m);
  }
  return { config: { ...config, costreamers: list }, known };
}

export default {
  routes,
  adminPanel: admin.panel,

  // Les références à des fiches de Contacts : Contacts demande à Story ce qu'elle sait d'une personne (export), de l'oublier (erase) ou de suivre une fusion (remap). Jamais d'exception.
  services: {
    "privacy.subject": {
      async export(ctx, args) { try { const r = await data.referencesOf(ctx, args?.contactId); return { label: String(ctx.t?.("privacy_label") ?? "Story").slice(0, 100) || "Story", data: { models: r.models, preparations: r.preps } }; } catch { return { label: "Story", data: { models: [], preparations: 0 } }; } },
      async erase(ctx, args) { try { return { removed: await data.eraseReferences(ctx, args?.contactId) }; } catch { return { removed: 0 }; } },
      async remap(ctx, args) { try { return { updated: await data.remapReferences(ctx, args?.from, args?.to) }; } catch { return { updated: 0 }; } },
    },
  },

  // Version 2.0.0 : les co-streamers deviennent des références à des fiches de Contacts (migration « à retirer en phase 3 », voir migrate.mjs). Sans Contacts : rien n'est touché,
  // et l'éditeur rejoue la migration dès que Contacts répond.
  migrations: { 2: async (ctx) => { await migrate.migrateCostreamers(ctx); } },

  mcp: {
    /** Lecture seule : les modèles enregistrés. */
    async story_models(ctx) {
      const models = await src.within(data.readModels(ctx), 5000, []);
      const names = await src.within(namesOf(ctx, models.map((m) => m.config.costreamers)), src.timing.bookMs * 2, new Map());
      return { models: models.map((m) => tools.publicModel(m, names)) };
    },
    /** Lecture seule : les prochains streams de l'agenda (clé, titre, début, jeux). */
    async story_next_streams(ctx) {
      const r = await src.loadStreams(ctx, { zone: zoneSetting(ctx), max: 8 });
      return { state: r.state, streams: r.streams.map((s) => ({ key: s.key, title: s.title, start: s.start, allDay: s.allDay, games: s.games, timezone: s.timezone || null })) };
    },
    /** Lecture seule : les prochains événements de TOUTES les sources (agenda, vidéos et directs programmés…), triés par date et heure, par pages. */
    async story_events(ctx, args = {}) {
      const all = await src.loadEvents(ctx, { zone: zoneSetting(ctx) });
      const list = E.filterEvents(all.events, { q: typeof args.q === "string" ? args.q : "", source: typeof args.source === "string" ? args.source : "" });
      const page = E.pageOf(list, { cursor: typeof args.cursor === "string" ? args.cursor : "", limit: args.limit ?? E.LIMITS.pageDefault });
      const state = all.events.length ? "ok" : all.sources.length && all.sources.every((s) => s.state === "down") ? "slow" : "empty";
      return {
        state, total: list.length, next: page.next,
        events: page.items.map((e) => ({ id: e.id, title: e.title, start: e.start, allDay: e.allDay, timezone: e.timezone || null, type: e.type, source: e.source, sourceLabel: e.sourceLabel, alsoIn: e.alsoIn.map((s) => s.label), url: e.url || null, image: e.image || null, games: e.games })),
        sources: all.sources.map((s) => ({ source: s.kind, label: s.label, state: s.state, count: s.count, ...(s.message ? { message: s.message } : {}), ...(s.note ? { note: s.note } : {}), ...(s.stale ? { stale: true } : {}) })),
      };
    },
    /** Écriture limitée à une « préparation » (gardée 7 jours) : rend le lien de la page préparée. Ne fabrique rien, ne publie rien. */
    async story_prepare(ctx, args) {
      const wantsEvent = args && typeof args === "object" && args.event !== undefined;
      const all = wantsEvent ? await src.loadEvents(ctx, { zone: zoneSetting(ctx) }) : null;
      const prepared = tools.strictPrepare(args, { models: await src.within(data.readModels(ctx), 5000, []), tz: zoneSetting(ctx), events: all?.events ?? [], sourcesDown: !!all && all.sources.length > 0 && all.sources.every((s) => s.state === "down"), watermarkDefault: await src.within(data.watermarkDefault(ctx), 3000, false) });
      const { manual } = prepared;
      const linked = await src.within(linkLogins(ctx, prepared.config), src.timing.bookMs * 2, { config: prepared.config, known: new Map() });
      const config = linked.config;
      const { pid, expiresAt } = await data.savePrep(ctx, { config, manual });
      const names = await src.within(namesOf(ctx, [config.costreamers], linked.known), src.timing.bookMs * 2, linked.known);
      const mine = (await src.within(ctx.api.instances.list(), 4000, [])).find((i) => i.key === ctx.instance.key);
      const path = typeof mine?.adminPath === "string" && /^\/admin\//.test(mine.adminPath) ? mine.adminPath : `/admin/instances/${ctx.instance.id}`;
      return {
        ok: true, link: `${String(ctx.api.siteUrl ?? "").replace(/\/+$/, "")}${path}?prep=${pid}`, expiresAt: new Date(expiresAt).toISOString(),
        prepared: { style: config.style, format: config.format, durationSeconds: config.duration, watermark: config.watermark, elements: config.elements, text: config.text, costreamers: config.costreamers.map((e) => (e.id ? names.get(e.id) : e.login || e.name)).filter(Boolean), stream: manual ? "hand-written" : prepared.event ? "event" : config.streamKey || "next", ...(prepared.event ? { event: { id: prepared.event.id, title: prepared.event.title, source: prepared.event.sourceLabel } } : {}) },
        note: "Nothing has been generated or published. The owner opens this link while signed in to the admin, checks the preview, then clicks 'Generate the video' and saves the file.",
      };
    },
  },

  backup: {
    // Les modèles (avec, pour chaque co-streamer, l'identifiant de sa fiche : les fiches elles-mêmes sont sauvegardées par Contacts), les ponctuels et, tant qu'elle n'est pas
    // confiée à Contacts, l'ancienne liste. Lisibles sans Curiosa.
    async readable(ctx) {
      const cell = (x) => { let s = String(x ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
      const csv = (rows) => ["login,name,image", ...rows.map((m) => [m.login, m.name, m.image].map(cell).join(","))].join("\r\n");
      const [adhoc, legacy, models] = await Promise.all([data.readAdhoc(ctx), data.readLegacy(ctx), data.readModels(ctx)]);
      return [
        ...(adhoc.length ? [{ path: "adhoc-costreamers.csv", content: csv(adhoc) }] : []),
        ...(legacy.items.length ? [{ path: "costreamers.csv", content: csv(legacy.items) }] : []),
        { path: "models.json", content: JSON.stringify(models.map(tools.backupModel), null, 2) },
      ];
    },
  },
};
