// Mascot — module of Curiosa.
//
// A small, discreet character in a corner of the public pages: it appears once per visit (after a delay), says hello and a tip or an announcement (next event,
// live stream going on, news handed over by another module), then steps aside. The visitor can close it, reduce it to a badge or switch it off for good (in the browser, no cookie).
// The included drawing takes its colours from the theme of the site; its own picture or its own animation (idle and talking) can be shown instead. One mascot per site.
//
// Why code and not a "content" module: it needs a light script on the visitor's side, sentences filled with information from other modules, and a preview panel.
// Files: model.mjs (pure rules) · store.mjs (data) · lines.mjs (what it can say) · assets.mjs (script and style sent) · client.mjs, face.mjs, style.mjs, play.mjs (what goes to the visitor and to the overlay)
//        admin.mjs, admin-anim.mjs · mcp.mjs · overlay.mjs (the overlay element) · starters.mjs (starter sentences, templates). The neighbouring files are loaded with the same "version" as this one: never old code left in memory.
const v = new URL(import.meta.url).search;
const M = await import(new URL(`./model.mjs${v}`, import.meta.url).href);
const S = await import(new URL(`./store.mjs${v}`, import.meta.url).href);
const L = await import(new URL(`./lines.mjs${v}`, import.meta.url).href);
const A = await import(new URL(`./assets.mjs${v}`, import.meta.url).href);
const Admin = await import(new URL(`./admin.mjs${v}`, import.meta.url).href);
const { mcp } = await import(new URL(`./mcp.mjs${v}`, import.meta.url).href);
const O = await import(new URL(`./overlay.mjs${v}`, import.meta.url).href);

const HEADERS = { "x-content-type-options": "nosniff" };
const FOREVER = "public, max-age=31536000, immutable";
const readOnly = (request) => request.method === "GET" || request.method === "HEAD";
const notAllowed = () => new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });

export default {
  // OVERLAY PAGE ELEMENT (core 0.5.0): "Mascot", a reduced version for an overlay frame (see overlay.mjs: only the sentences written by the person, nothing of the corner, the browser or the other modules).
  overlayElements: {
    mascot: (ctx, request) => O.elementAddress(ctx, "mascot", request),
  },

  slots: {
    // The script is announced only when the mascot is published AND has something to say: otherwise the pages load nothing at all.
    async "layout.head"(ctx) {
      const built = await A.buildClient(ctx);
      return built ? [{ type: "head", tags: [{ tag: "script", src: built.src, defer: true }] }] : null;
    },
    // A small optional link to bring it back after it was switched off (off by default).
    async "layout.footer"(ctx) {
      if (!A.readSettings(ctx).footerLink || !(await A.buildClient(ctx))) return null;
      return [{ type: "links", items: [{ label: ctx.t("footerLink"), href: "/?mascot=voir" }] }];
    },
  },

  routes: {
    // The page of the overlay element (`mascot`); with ?data=1, only the sentences for the soft update.
    "element/:slug": (request, ctx) => O.elementResponse(request, ctx),

    // The visitor script (code + settings of this site). Kept "forever" when the fingerprint of the address is the right one.
    "mascot.js": async (request, ctx) => {
      if (!readOnly(request)) return notAllowed();
      const built = await A.buildClient(ctx);
      if (!built) return new Response("Not found", { status: 404, headers: HEADERS });
      const fresh = new URL(request.url).searchParams.get("v") === built.hash;
      return new Response(request.method === "HEAD" ? null : built.code, { headers: { ...HEADERS, "content-type": "application/javascript; charset=utf-8", "cache-control": fresh ? FOREVER : "no-cache" } });
    },
    "mascot.css": async (request, ctx) => {
      if (!readOnly(request)) return notAllowed();
      const q = new URL(request.url).searchParams;
      // `?a=1` (animation set, 1.3.0): the same style sheet with the animation rules; without it, the sheet and its address are what they always were.
      const moving = q.get("a") === "1";
      const fresh = q.get("v") === (moving ? A.animCssHash : A.cssHash);
      const css = moving ? `${A.CSS}\n${A.ANIM_CSS}` : A.CSS;
      return new Response(request.method === "HEAD" ? null : css, { headers: { ...HEADERS, "content-type": "text/css; charset=utf-8", "cache-control": fresh ? FOREVER : "no-cache" } });
    },
    // The sentences of the moment for a page: called only once, when the mascot is about to show.
    lines: async (request, ctx) => {
      if (!readOnly(request)) return notAllowed();
      const json = (body, cache = "no-store") => new Response(request.method === "HEAD" ? null : JSON.stringify(body), { headers: { ...HEADERS, "content-type": "application/json; charset=utf-8", "cache-control": cache } });
      const [config, phrases] = [await S.loadConfig(ctx), await S.loadPhrases(ctx)];
      const set = A.readSettings(ctx);
      const path = M.cleanPath(new URL(request.url).searchParams.get("path"));
      if (!config.published || !M.placeAllows(set.where, set.pages, path)) return json({ items: [] });
      const items = await L.buildLines(ctx, { config, phrases, path, announce: set.announce, name: S.nameFor(ctx, config) });
      return json({ items }, "public, max-age=30");
    },
  },

  adminPanel: Admin.adminPanel,
  adminActions: Admin.adminActions,
  mcp,

  // The starter sentences are put on creation; otherwise on the first opening of the administration (see ensureSeeded).
  hooks: { onInstanceCreate: async (ctx) => { await Admin.ensureSeeded(ctx); } },

  backup: {
    async readable(ctx) {
      const phrases = await S.loadPhrases(ctx);
      const head = ["id", "state", "kind", "language", "pages", "link", "text"].map(M.cell).join(",");
      const rows = phrases.map((p) => [p.id, p.state, p.kind, p.lang || "all", p.pages.join(" "), p.link, p.text].map(M.cell).join(","));
      return [{ path: "phrases.csv", content: `\uFEFF${[head, ...rows].join("\r\n")}\r\n` }];
    },
  },
};
