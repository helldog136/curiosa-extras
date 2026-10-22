// Compte à rebours — module de Curiosa.
//
// Pour les ÉVÉNEMENTS ponctuels : une sortie, un lancement, un anniversaire, une convention. (Les streams réguliers, eux, sont
// l'affaire du module « Planning ».) Chaque événement est gardé avec son jour, son heure et son fuseau ; le visiteur lit le temps
// qui reste et l'heure chez lui. Le module offre : une page, deux morceaux d'accueil, un fichier d'agenda (.ics) et une source
// navigateur pour OBS. Rien ne tourne en arrière-plan : ce qui est masqué ou à la une se décide à chaque lecture.
import { createHash } from "node:crypto";

const V = new URL(import.meta.url).search; // même « version » pour les fichiers voisins : jamais d'ancien code en mémoire après une mise à jour
const T = await import(`./time.mjs${V}`);
const M = await import(`./model.mjs${V}`);
const R = await import(`./render.mjs${V}`);
const A = await import(`./admin.mjs${V}`);
const { buildCalendar, fold } = await import(`./ics.mjs${V}`);

const num = (value, fallback, min, max) => {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : fallback;
};
const exposed = (text) => Object.assign(new Error(text), { expose: true }); // ce message peut être lu par l'assistant (MCP)

// ── Garde-fou : un visiteur ne peut pas marteler les adresses publiques (en mémoire, par visiteur, sans garder son adresse) ──────

const hits = new Map();
function limited(request, ctx, bucket, max) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const who = createHash("sha256").update(ip).digest("hex").slice(0, 16);
  const key = `${ctx.instance.key}|${bucket}|${who}`;
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < 60_000)) hits.delete(k); // la table ne grossit pas sans fin
  return recent.length > max;
}
const readOnly = (request) => request.method === "GET" || request.method === "HEAD";
const notAllowed = () => new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
const tooMany = () => new Response("Too many requests", { status: 429, headers: { "Retry-After": "60" } });
const NO_STORE = { "cache-control": "no-store" };

const overlayEndMs = (ctx) => num(ctx.setting("overlayEndMinutes"), 5, 1, 120) * 60_000;
let scriptCache = null;
/** Le script de la page + une courte empreinte pour que le navigateur le garde jusqu'à ce qu'il change. */
function liveFile() {
  if (!scriptCache) {
    const body = R.liveScript();
    scriptCache = { body, hash: createHash("sha256").update(body).digest("hex").slice(0, 10) };
  }
  return scriptCache;
}

// ── Les pages ───────────────────────────────────────────────────────────────────────────────────────────────────

function listPage(ctx, all, now, current) {
  const featured = M.pickFeatured(all);
  const list = M.order(M.visible(all));
  const rest = list.filter((v) => v.id !== featured?.id);
  const ordered = featured ? [featured, ...rest] : rest;
  const pages = Math.max(1, Math.ceil(ordered.length / M.PER_PAGE));
  if (current < 1 || current > pages) return { notFound: true, blocks: [] };
  const slice = ordered.slice((current - 1) * M.PER_PAGE, current * M.PER_PAGE);
  const title = M.clean(ctx.setting("pageTitle"), 80) || ctx.t("pageTitle");
  const blocks = [];
  if (!slice.length) {
    blocks.push({ type: "markdown", text: ctx.t("empty") });
  } else {
    const cards = slice.map((v) => R.card(ctx, v, {
      variant: v.id === featured?.id ? "big" : "card",
      kicker: v.id === featured?.id ? ctx.t(v.phase === "started" ? "kickerStarted" : "kickerNext") : "",
      href: R.eventHref(ctx, v), now,
    }));
    blocks.push({ type: "html", html: R.wrap(ctx, cards.join(""), now) });
  }
  const href = R.pageHref(ctx) ?? "/";
  const root = href === "/" ? "" : href;
  const links = [];
  if (current > 1) links.push({ label: ctx.t("prevPage"), href: current === 2 ? href : `${root}/page/${current - 1}` });
  if (current < pages) links.push({ label: ctx.t("nextPage"), href: `${root}/page/${current + 1}` });
  if (links.length) blocks.push({ type: "links", items: links });
  return { title, description: ctx.t("pageDescription"), blocks };
}

function eventPage(ctx, all, now, slug) {
  const v = M.visible(all).find((e) => e.slug === slug);
  if (!v) return { notFound: true, blocks: [] };
  const lines = T.linesFor(v.startMs, now, v.tz, "", ctx.locale, R.labels(ctx), v.allDay);
  const blocks = [{ type: "html", html: R.wrap(ctx, R.card(ctx, v, { variant: "big", noTitle: true, details: true, now }), now) }];
  const back = R.pageHref(ctx);
  if (back !== null) blocks.push({ type: "links", items: [{ label: ctx.t("back"), href: back }] });
  return { title: v.title, description: lines.event, blocks };
}

export default {
  // PAGE PUBLIQUE : /<chemin> (la liste), /<chemin>/<nom-court> (un événement), /<chemin>/page/2.
  async page(ctx, { segments }) {
    const now = Date.now();
    const all = await M.readAll(ctx, now);
    if (segments.length === 0) return listPage(ctx, all, now, 1);
    if (segments.length === 2 && segments[0] === "page" && /^\d{1,3}$/.test(segments[1])) return listPage(ctx, all, now, Number(segments[1]));
    if (segments.length === 1 && M.isSlug(segments[0])) return eventPage(ctx, all, now, segments[0]);
    return { notFound: true, blocks: [] };
  },

  // ACCUEIL : le compte à rebours à la une, et la liste des prochains événements.
  sections: {
    async featured(ctx) {
      const now = Date.now();
      const v = M.pickFeatured(await M.readAll(ctx, now));
      if (!v) return null;
      const html = R.wrap(ctx, R.card(ctx, v, { variant: "big", kicker: ctx.t(v.phase === "started" ? "kickerStarted" : "kickerNext"), href: R.eventHref(ctx, v), now }), now);
      return [{ type: "html", html }];
    },
    async upcoming(ctx, options) {
      const now = Date.now();
      const all = await M.readAll(ctx, now);
      const featured = options?.skipFeatured === false ? null : M.pickFeatured(all);
      const list = M.order(M.visible(all)).filter((v) => v.id !== featured?.id).slice(0, num(options?.count, 3, 1, 10));
      if (!list.length) return null;
      const cards = list.map((v) => R.card(ctx, v, { variant: "compact", href: R.eventHref(ctx, v), now }));
      const href = R.pageHref(ctx);
      return [
        { type: "heading", text: ctx.t("upcomingTitle") },
        { type: "html", html: R.wrap(ctx, cards.join(""), now) },
        ...(href !== null ? [{ type: "links", items: [{ label: ctx.t("seeAll"), href }] }] : []),
      ];
    },
  },

  // Le petit script qui fait avancer les chiffres : chargé une fois, partout sur le site, seulement s'il y a des événements.
  slots: {
    async "layout.head"(ctx) {
      if ((await ctx.api.store.count("events")) === 0) return null;
      return [{ type: "head", tags: [{ tag: "script", src: `/m/${ctx.instance.key}/live.js?v=${liveFile().hash}`, defer: true }] }];
    },
  },

  routes: {
    // Le script des visiteurs (le même pour tous : il lit ce que la page lui donne).
    "live.js"(request) {
      if (!readOnly(request)) return notAllowed();
      return new Response(liveFile().body, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" } });
    },

    // L'heure du serveur : sert à vérifier l'horloge d'un appareil qui semble se tromper.
    now(request, ctx) {
      if (!readOnly(request)) return notAllowed();
      if (limited(request, ctx, "now", 120)) return tooMany();
      return Response.json({ now: Date.now() }, { headers: NO_STORE });
    },

    // « Ajouter à mon agenda » : un fichier .ics pour UN événement visible.
    async ics(request, ctx) {
      if (!readOnly(request)) return notAllowed();
      if (limited(request, ctx, "ics", 60)) return tooMany();
      const slug = new URL(request.url).searchParams.get("e") ?? "";
      if (!M.isSlug(slug)) return new Response("Not found", { status: 404 });
      const v = M.visible(await M.readAll(ctx)).find((e) => e.slug === slug);
      if (!v) return new Response("Not found", { status: 404 });
      const body = buildCalendar([v], { urlFor: (e) => R.absoluteEventUrl(ctx, e) });
      return new Response(request.method === "HEAD" ? null : body, {
        headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": `attachment; filename="${v.slug}.ics"`, "x-content-type-options": "nosniff", ...NO_STORE },
      });
    },

    // Ce que la source OBS demande de temps en temps : l'événement à montrer maintenant.
    async state(request, ctx) {
      if (!readOnly(request)) return notAllowed();
      if (limited(request, ctx, "state", 120)) return tooMany();
      const asked = new URL(request.url).searchParams.get("e") ?? "";
      const now = Date.now();
      const endMs = overlayEndMs(ctx);
      const pick = M.pickForOverlay(await M.readAll(ctx, now), now, endMs, M.isSlug(asked) ? asked : "");
      return Response.json({ now, event: R.overlayEvent(ctx, pick, endMs) }, { headers: NO_STORE });
    },
  },

  // SOURCE NAVIGATEUR POUR OBS : /overlays/<clé> (l'événement à la une) ou /overlays/<clé>?e=<nom-court> (un événement précis).
  async overlay(ctx, { query }) {
    const now = Date.now();
    const endMs = overlayEndMs(ctx);
    const asked = query?.get?.("e") ?? "";
    const slug = M.isSlug(asked) ? asked : "";
    const pick = M.pickForOverlay(await M.readAll(ctx, now), now, endMs, slug);
    const stateUrl = `/m/${ctx.instance.key}/state?lang=${encodeURIComponent(ctx.locale)}${slug ? `&e=${slug}` : ""}`;
    return R.overlayParts(ctx, { initial: { now, event: R.overlayEvent(ctx, pick, endMs) }, stateUrl, endMs });
  },

  adminPanel: (ctx, o) => A.panel(ctx, o),
  adminActions: A.actions,

  // Télécharger tous ses événements dans un agenda : écrit ligne par ligne (100 événements au plus).
  adminDownloads: {
    calendar: {
      contentType: "text/plain",
      filename: () => "evenements.ics",
      async *generate(ctx) {
        const all = await M.readAll(ctx);
        const ordered = [...M.order(M.visible(all)), ...all.filter((v) => v.phase === "hidden")];
        for (const line of buildCalendar(ordered, { urlFor: (e) => R.absoluteEventUrl(ctx, e) }).split("\r\n")) if (line) yield `${line}\r\n`;
      },
    },
  },

  // POUR LES ASSISTANTS : lire, créer, modifier, mettre à la une, supprimer.
  mcp: {
    async events_list(ctx, args) {
      const all = await M.readAll(ctx);
      const shown = M.pickFeatured(all)?.id;
      const list = args?.include_hidden === true ? [...M.order(M.visible(all)), ...all.filter((v) => v.phase === "hidden")] : M.order(M.visible(all));
      return list.map((v) => brief(v, shown));
    },
    async event_create(ctx, args) {
      const r = await A.persist(ctx, valuesFromArgs(args), null);
      if (!r.ok) throw exposed(r.error ?? Object.values(r.errors).join(" "));
      return answer(ctx, r);
    },
    async event_update(ctx, args) {
      const row = (await ctx.api.store.list("events", { limit: M.MAX_EVENTS + 20 })).find((x) => x.id === args.id);
      const current = row ? M.read(row) : null;
      if (!current) throw exposed(ctx.t("notFound"));
      const r = await A.persist(ctx, { ...valuesFromEvent(current), ...valuesFromArgs(args) }, current.id);
      if (!r.ok) throw exposed(r.error ?? Object.values(r.errors).join(" "));
      return answer(ctx, r);
    },
    async event_set_featured(ctx, args) {
      const r = await A.actions.feature.run(ctx, { id: args.id });
      if (r.error) throw exposed(r.error);
      return { ok: true, message: r.ok };
    },
    async event_delete(ctx, args) {
      const r = await A.actions.remove.run(ctx, { id: args.id });
      if (r.error) throw exposed(r.error);
      return { ok: true, message: r.ok };
    },
  },

  // SAUVEGARDE LISIBLE sans le framework : un tableau (CSV) et un fichier d'agenda.
  backup: {
    async readable(ctx) {
      const all = await M.readAll(ctx);
      const cell = (value) => {
        let s = String(value ?? "");
        if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise une formule de tableur
        return `"${s.replace(/"/g, '""')}"`;
      };
      const head = ["title", "date", "time", "all_day", "timezone", "starts_at_utc", "end_date", "end_time", "location", "description", "end_message", "end_link"];
      const rows = all.map((v) => [v.title, v.date, v.time, v.allDay ? "yes" : "no", v.tz, new Date(v.startMs).toISOString(), v.endDate, v.endTime, v.where, v.description, v.endMessage, v.endLink].map(cell).join(","));
      return [
        { path: "events.csv", content: `${head.map(cell).join(",")}\r\n${rows.join("\r\n")}${rows.length ? "\r\n" : ""}` },
        { path: "events.ics", content: buildCalendar(all, { urlFor: (e) => R.absoluteEventUrl(ctx, e) }) },
      ];
    },
  },
};

// ── Assistants : passer des arguments au formulaire et inversement ───────────────────────────────────────────────

async function answer(ctx, r) {
  const all = await M.readAll(ctx);
  const v = all.find((e) => e.id === r.id);
  return { ok: true, notes: r.notes, event: v ? brief(v, M.pickFeatured(all)?.id) : null };
}
function brief(v, shownId) {
  return {
    id: v.id, name: v.slug, title: v.title, date: v.date, time: v.time || null, timezone: v.tz, all_day: v.allDay,
    starts_at_utc: new Date(v.startMs).toISOString(), state: v.phase,
    visible_until_utc: Number.isFinite(v.hideMs) ? new Date(v.hideMs).toISOString() : null,
    featured: v.featured, shown_first: v.id === shownId,
    end_date: v.endDate || null, end_time: v.endTime || null, location: v.where || null, description: v.description || null,
    end_message: v.endMessage || null, end_link: v.endLink || null, keep: v.keep || null,
    warning: v.note === "gap" ? "This time does not exist on that day (clocks go forward): the next valid time is used." : v.note === "fold" ? "This time happens twice that day (clocks go back): the first one is used." : null,
  };
}
const on = (b) => (b === true ? "on" : "");
function valuesFromArgs(a = {}) {
  const out = {};
  const put = (k, v) => { if (v !== undefined) out[k] = v; };
  put("title", a.title); put("date", a.date); put("time", a.time); put("tzOther", a.timezone);
  if (a.all_day !== undefined) out.allDay = on(a.all_day);
  put("endDate", a.end_date); put("endTime", a.end_time); put("description", a.description); put("where", a.location);
  put("endMessage", a.end_message); put("endLinkLabel", a.end_link_label); put("endLink", a.end_link); put("keep", a.keep);
  if (a.featured !== undefined) out.featured = on(a.featured);
  return out;
}
function valuesFromEvent(e) {
  return {
    title: e.title, date: e.date, time: e.time, allDay: on(e.allDay), tzOther: e.tz, endDate: e.endDate, endTime: e.endTime, description: e.description, where: e.where,
    endMessage: e.endMessage, endLinkLabel: e.endLinkLabel, endLink: e.endLink, keep: e.keep, featured: on(e.featured), image: e.image,
  };
}
