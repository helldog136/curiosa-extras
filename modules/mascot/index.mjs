// Mascotte — module de Curiosa.
//
// Un petit personnage discret, dans un coin des pages publiques : il apparaît une fois par visite (après un délai), dit bonjour et une astuce ou une annonce (prochain événement,
// direct en cours, nouveauté confiée par un autre module), puis se range. Le visiteur peut le fermer, le réduire en pastille ou le couper pour toujours (dans son navigateur, sans cookie).
// Le dessin inclus prend ses couleurs sur le thème du site ; on peut aussi montrer sa propre image. Une seule mascotte par site.
//
// Pourquoi du code et pas un module « contenu » : il faut un script léger chez le visiteur, des phrases remplies avec des informations d'autres modules, et un panneau d'aperçu.
// Fichiers : model.mjs (règles pures) · store.mjs (données) · lines.mjs (ce qu'elle peut dire) · assets.mjs (script et style envoyés) · client.mjs, face.mjs, style.mjs (ce qui part chez le visiteur)
//           admin.mjs · mcp.mjs · starters.mjs (phrases de départ, gabarits). Les fichiers voisins sont chargés avec la même « version » que celui-ci : jamais d'ancien code resté en mémoire.
const v = new URL(import.meta.url).search;
const M = await import(new URL(`./model.mjs${v}`, import.meta.url).href);
const S = await import(new URL(`./store.mjs${v}`, import.meta.url).href);
const L = await import(new URL(`./lines.mjs${v}`, import.meta.url).href);
const A = await import(new URL(`./assets.mjs${v}`, import.meta.url).href);
const Admin = await import(new URL(`./admin.mjs${v}`, import.meta.url).href);
const { mcp } = await import(new URL(`./mcp.mjs${v}`, import.meta.url).href);

const HEADERS = { "x-content-type-options": "nosniff" };
const FOREVER = "public, max-age=31536000, immutable";
const readOnly = (request) => request.method === "GET" || request.method === "HEAD";
const notAllowed = () => new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });

export default {
  slots: {
    // Le script n'est annoncé que si la mascotte est publiée ET a de quoi parler : sinon les pages ne chargent rien du tout.
    async "layout.head"(ctx) {
      const built = await A.buildClient(ctx);
      return built ? [{ type: "head", tags: [{ tag: "script", src: built.src, defer: true }] }] : null;
    },
    // Un petit lien facultatif pour la faire revenir après l'avoir coupée (désactivé par défaut).
    async "layout.footer"(ctx) {
      if (!A.readSettings(ctx).footerLink || !(await A.buildClient(ctx))) return null;
      return [{ type: "links", items: [{ label: ctx.t("footerLink"), href: "/?mascot=voir" }] }];
    },
  },

  routes: {
    // Le script des visiteurs (code + réglages de ce site). Gardé « pour toujours » quand l'empreinte de l'adresse est la bonne.
    "mascot.js": async (request, ctx) => {
      if (!readOnly(request)) return notAllowed();
      const built = await A.buildClient(ctx);
      if (!built) return new Response("Not found", { status: 404, headers: HEADERS });
      const fresh = new URL(request.url).searchParams.get("v") === built.hash;
      return new Response(request.method === "HEAD" ? null : built.code, { headers: { ...HEADERS, "content-type": "application/javascript; charset=utf-8", "cache-control": fresh ? FOREVER : "no-cache" } });
    },
    "mascot.css": async (request, ctx) => {
      if (!readOnly(request)) return notAllowed();
      const fresh = new URL(request.url).searchParams.get("v") === A.cssHash;
      return new Response(request.method === "HEAD" ? null : A.CSS, { headers: { ...HEADERS, "content-type": "text/css; charset=utf-8", "cache-control": fresh ? FOREVER : "no-cache" } });
    },
    // Les phrases du moment pour une page : appelée une seule fois, quand la mascotte est sur le point de se montrer.
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

  // Les phrases de départ sont posées à la création ; sinon à la première ouverture de l'administration (voir ensureSeeded).
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
