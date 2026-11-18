// Stream goals (« Objectifs du live »): a goal bar towards a number (followers, paid subs, or a number you keep by hand) and a SUBATHON countdown whose time
// grows with each sub, bits and follow (your rules). The module is only the PRINCIPLE: it computes a state and the core's engine (core 0.30.0,
// docs/OVERLAY-ANIMATIONS.md) draws it in the style of the overlay page's skin; every skin works, through the engine's plain fallback when it has no recipe.
//
// Granularity: nothing is required. Without any Twitch module the bar and the countdown work with the values and the time you set by hand. With the
// Alerts overlay (it listens to Twitch) the events move them within about 3 seconds; with My Twitch channel the bar starts from the channel's real figure.
// The rule against double counting, the subathon arithmetic and the rehearsals are in model.mjs (pure, tested alone); the reading of the sources in store.mjs.
const v = new URL(import.meta.url).search; // the version of the module spreads to the neighbour files (docs/HOT-UPDATE.md)
const S = await import(new URL(`./store.mjs${v}`, import.meta.url).href);
const A = await import(new URL(`./admin.mjs${v}`, import.meta.url).href);
const T = await import(new URL(`./tools.mjs${v}`, import.meta.url).href);
const P = await import(new URL(`./page.mjs${v}`, import.meta.url).href);

const LANG = /^[a-z]{2}(-[A-Za-z]{2,4})?$/;
const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
const ELEMENTS = ["goal", "subathon"];

/** The address of an element: its page and the secret of this instance (the core adds ov-* and opt-*). */
async function elementUrl(ctx, el, request) {
  const k = await S.secretOf(ctx);
  return { url: `/m/${ctx.instance.key}/element/${el}?k=${encodeURIComponent(k)}${LANG.test(request?.lang ?? "") ? `&lang=${request.lang}` : ""}` };
}
const allowed = new Map();   // instance → [times]: 600 readings a minute per instance at most (two pages read 80)
function allow(ctx, now) {
  const k = ctx.instance.key, list = (allowed.get(k) ?? []).filter((t) => now - t < 60_000);
  if (list.length >= 600) { allowed.set(k, list); return false; }
  list.push(now); allowed.set(k, list);
  return true;
}

export default {
  routes: {
    /** The element page (an overlay page frame). The secret is checked by the state route; without the engine (older core), a plain sentence. */
    "element/:slug"(request, ctx) {
      const el = ctx.params?.slug;
      if (!ELEMENTS.includes(el)) return new Response("Not found", { status: 404 });
      return new Response(P.elementPage(ctx, el, new URL(request.url).searchParams), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": P.CSP, "X-Content-Type-Options": "nosniff" } });
    },
    /** What the element reads every 1.5 s: { now (server clock), state }. Reading it is what moves the module: the sources are read here, throttled. */
    async "state/:slug"(request, ctx) {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
      const el = ctx.params?.slug;
      if (!ELEMENTS.includes(el)) return new Response("Not found", { status: 404 });
      const q = new URL(request.url).searchParams, now = Date.now();
      if (!P.sameSecret(await S.secretOf(ctx), q.get("k") ?? "")) return json({ denied: true }, 403);
      if (!allow(ctx, now)) return json({ now }, 429);
      if (q.get("demo") === "1") return json({ now, state: P.demoState(el, now, ctx.t(el === "goal" ? "label_followers" : "label_subathon")) });
      await S.sync(ctx, { now });
      return json({ now, state: el === "goal" ? await S.goalState(ctx, now) : await S.subathonState(ctx, now) });
    },
  },
  overlayElements: {
    goal: (ctx, request) => elementUrl(ctx, "goal", request),
    subathon: (ctx, request) => elementUrl(ctx, "subathon", request),
  },
  adminPanel: A.panel,
  adminActions: A.actions,
  mcp: T.default,
  tasks: { purge: { everyMinutes: 60, run: async (ctx) => { await S.purge(ctx); } } },
};
