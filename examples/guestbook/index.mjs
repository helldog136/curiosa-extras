// MODULE D'EXEMPLE : un livre d'or modéré. Il sert aussi de documentation vivante : chaque capacité du framework y
// est utilisée une fois, avec un commentaire qui explique POURQUOI (voir docs/CREATE-A-MODULE.md).
//
// Règles du jeu :
//  - un module est un simple fichier ES : aucune dépendance, aucun import du cœur. Tout passe par `ctx` ;
//  - il tourne UNE FOIS PAR INSTANCE : deux livres d'or = deux espaces de stockage et deux jeux de réglages ;
//  - tout ce qui vient d'un visiteur est une donnée NON FIABLE : on la nettoie à l'entrée et on l'échappe à la sortie.

// ── Constantes et petits outils ──────────────────────────────────────────────────────────────────────────────────

const COLLECTION = "messages"; // collection du stockage privé de l'instance (ctx.api.store)
const LIST_LIMIT = 1000; // le stockage n'a pas de requête : on lit au plus ce nombre de messages et on filtre en code
const MAX_STORED = 2000; // plafond anti-inondation : au-delà, on refuse de nouveaux messages
const HOUR = 3_600_000;

/** Échappe le texte avant de le mettre dans du HTML. Le bloc `html` du cœur est BRUT : c'est à nous de protéger. */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Nettoie un texte venu d'un formulaire : retire les caractères de contrôle (et ceux qui inversent le sens de lecture), borne la taille. */
function clean(value, max, multiline = false) {
  let text = String(value ?? "")
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, "");
  text = multiline ? text.replace(/\n{3,}/g, "\n\n") : text.replace(/\s+/g, " ");
  return text.trim().slice(0, max);
}

/** Entier borné. Un réglage peut arriver vide ou sous forme de texte : on retombe sur la valeur par défaut. */
function num(value, fallback, min, max) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : fallback;
}

/** Une couleur n'entre dans un attribut `style` que si elle est un #RRGGBB : un réglage est du texte libre. */
const safeColor = (value) => (/^#[0-9a-fA-F]{6}$/.test(String(value ?? "")) ? String(value) : null);

/** Une image n'est affichée que si c'est un chemin du site ou une adresse https (jamais `javascript:` ni `data:`). */
const safeSrc = (value) => {
  const v = String(value ?? "").trim();
  return (v.startsWith("/") && !v.startsWith("//")) || v.startsWith("https://") ? v : null;
};

/** Comparaison sans court-circuit : le temps de réponse ne dit pas combien de caractères du code étaient justes. */
function same(a, b) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** Date lisible, toujours en UTC pour un rendu identique d'un serveur à l'autre. */
function day(date, locale) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** Adresse publique de la page de l'instance (null si elle n'est pas montée sur un chemin). Préfixe la langue si ce n'est pas la langue par défaut. */
function pageHref(ctx, localized = true) {
  const base = ctx.instance.basePath;
  if (base === null || base === undefined) return null;
  const prefix = localized && ctx.locale !== ctx.defaultLocale ? `/${ctx.locale}` : "";
  return `${prefix}${base ? `/${base}` : ""}` || "/";
}

// ── Données : un message = un document du stockage de l'instance ──────────────────────────────────────────────────
//   { name, message, status: "pending" | "approved", moderatedBy? }   (+ id et createdAt fournis par le stockage)

async function all(ctx) {
  const rows = await ctx.api.store.list(COLLECTION, { limit: LIST_LIMIT }); // les plus récents d'abord
  return rows.map((r) => ({
    id: r.id,
    at: r.createdAt,
    name: String(r.data.name ?? ""),
    message: String(r.data.message ?? ""),
    status: r.data.status === "approved" ? "approved" : "pending", // tout ce qui n'est pas explicitement validé reste en attente
  }));
}
const approved = async (ctx) => (await all(ctx)).filter((m) => m.status === "approved");

// ── Rendu : l'apparence suit le thème du site ─────────────────────────────────────────────────────────────────────

/**
 * Une carte de message. Le texte du visiteur n'est JAMAIS inséré tel quel : `esc()` partout. Les couleurs viennent des
 * variables CSS du site (`--v-line`, `--v-surface`, `--v-muted`…) et du réglage « accent », dont le défaut `theme:accent`
 * vaut `ctx.theme.accent` : changer le thème du site change le livre d'or, sans rien refaire.
 */
function card(ctx, m) {
  const accent = safeColor(ctx.setting("accent")) ?? ctx.theme.accent;
  const plain = ctx.setting("style") === "plain";
  const box = plain
    ? "padding:8px 0;border-bottom:1px solid var(--v-line)"
    : `padding:12px 16px;border:1px solid var(--v-line);border-left:4px solid ${accent};border-radius:12px;background:var(--v-surface)`;
  return (
    `<article style="${box}"><p style="margin:0;white-space:pre-wrap;overflow-wrap:anywhere">${esc(m.message)}</p>` +
    `<p style="margin:8px 0 0;font-size:.85em;color:var(--v-muted)">— <strong style="color:var(--v-fg)">${esc(m.name)}</strong>` +
    ` · <time datetime="${esc(new Date(m.at).toISOString().slice(0, 10))}">${esc(day(m.at, ctx.locale))}</time></p></article>`
  );
}

const stack = (cards) => ({ type: "html", html: `<div style="display:grid;gap:12px">${cards.join("")}</div>` });

// ── Anti-abus en mémoire : N messages par heure et par visiteur ───────────────────────────────────────────────────
// En mémoire = remis à zéro au redémarrage, et propre à ce processus : c'est un garde-fou, pas un pare-feu.

const hits = new Map();
function limited(ctx, ip) {
  const max = num(ctx.setting("rateLimit"), 5, 1, 100);
  const key = `${ctx.instance.key}|${ip}`; // la clé d'instance isole deux livres d'or l'un de l'autre
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < HOUR);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < HOUR)) hits.delete(k); // la table ne grossit pas sans fin
  return recent.length > max;
}

// ── Sortie CSV pour la sauvegarde ─────────────────────────────────────────────────────────────────────────────────

/** Une cellule CSV : toujours entre guillemets (les guillemets sont doublés) ; un « = », « + », « - » ou « @ » initial est neutralisé (injection de formule). */
function cell(value) {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

const notFound = (text) => Object.assign(new Error(text), { expose: true }); // `expose` : ce message peut être lu par l'agent MCP

// ── Le module ─────────────────────────────────────────────────────────────────────────────────────────────────────

export default {
  // PAGE PUBLIQUE (permission « pages » + `page: true` dans module.json). `segments` = ce qui suit le chemin de l'instance :
  //   /guestbook → []   ·   /guestbook/page/2 → ["page", "2"]. Pas de paramètre `?` ici : la pagination passe par le chemin.
  async page(ctx, { segments }) {
    let current = 1;
    if (segments.length === 2 && segments[0] === "page" && /^\d{1,4}$/.test(segments[1])) current = Number(segments[1]);
    else if (segments.length > 0) return { notFound: true, blocks: [] }; // tout autre chemin : 404

    const perPage = num(ctx.setting("perPage"), 10, 1, 50);
    const list = await approved(ctx);
    const pages = Math.max(1, Math.ceil(list.length / perPage));
    if (current < 1 || current > pages) return { notFound: true, blocks: [] };

    const blocks = [];
    const banner = safeSrc(ctx.setting("banner"));
    if (banner) blocks.push({ type: "html", html: `<img src="${esc(banner)}" alt="" style="max-width:100%;border-radius:12px">` });
    const intro = ctx.setting("intro"); // saisi par l'administrateur : du Markdown de confiance (le bloc markdown n'accepte pas de HTML brut)
    if (intro) blocks.push({ type: "markdown", text: intro });

    blocks.push({ type: "heading", text: ctx.t("signTitle") }, form(ctx));
    blocks.push({ type: "heading", text: ctx.t("recentTitle") });
    const slice = list.slice((current - 1) * perPage, current * perPage);
    blocks.push(slice.length ? stack(slice.map((m) => card(ctx, m))) : { type: "markdown", text: ctx.t("empty") });

    const href = pageHref(ctx) ?? "/";
    const links = [];
    if (current > 1) links.push({ label: ctx.t("newer"), href: current === 2 ? href : `${href === "/" ? "" : href}/page/${current - 1}` });
    if (current < pages) links.push({ label: ctx.t("older"), href: `${href === "/" ? "" : href}/page/${current + 1}` });
    if (links.length) blocks.push({ type: "links", items: links });

    return { title: ctx.setting("title") || ctx.t("pageTitle"), description: intro ? clean(intro, 160) : undefined, blocks };
  },

  // ROUTES (permission « routes ») : POST /m/<clé d'instance>/sign. Le cœur refuse déjà les POST venus d'un autre site (CSRF).
  // Le bloc `form` envoie en fetch et ne regarde que le code HTTP : 2xx = succès, le reste = message d'erreur générique.
  routes: {
    async sign(request, ctx) {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
      const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
      if (limited(ctx, ip)) return Response.json({ ok: false }, { status: 429 });

      let form;
      try {
        form = await request.formData();
      } catch {
        return Response.json({ ok: false }, { status: 400 }); // corps qui n'est pas un formulaire
      }
      // Piège à robots : le champ « website » est ajouté par le bloc `form`, invisible pour un humain. On répond « ok » pour ne rien apprendre au robot.
      if (String(form.get("website") ?? "")) return Response.json({ ok: true });

      const code = String(ctx.setting("accessCode") ?? "").trim(); // réglage de type « secret » : lu ici, jamais réaffiché ni journalisé
      if (code && !same(code, String(form.get("code") ?? "").trim())) return Response.json({ ok: false }, { status: 403 });

      const name = clean(form.get("name"), 60);
      const message = clean(form.get("message"), num(ctx.setting("maxLength"), 500, 20, 2000), true);
      const links = (message.match(/https?:\/\//gi) ?? []).length;
      if (!name || !message || links > 2) return Response.json({ ok: false }, { status: 400 }); // trop de liens = quasi sûrement du spam
      if ((await ctx.api.store.count(COLLECTION)) >= MAX_STORED) return Response.json({ ok: false }, { status: 503 });

      // 1) D'ABORD on conserve : l'e-mail est un plus, jamais la seule trace du message.
      const status = ctx.setting("autoApprove") === true ? "approved" : "pending";
      await ctx.api.store.add(COLLECTION, { name, message, status });

      // 2) ENSUITE on prévient le propriétaire (permission « mail »), au mieux : `send` ne lève jamais, mais on ne prend aucun risque.
      if (ctx.setting("notify") !== false) {
        try {
          await ctx.api.mail.send({
            to: "owner",
            subject: ctx.t("mailSubject", { name }),
            text: `${ctx.t("mailBody", { name })}\n\n${message}\n\n${status === "pending" ? ctx.t("mailPending") : ctx.t("mailPublished")}\n${ctx.t("mailAdmin")} ${ctx.api.siteUrl}/admin/instances/${ctx.instance.id}\n`,
          });
        } catch (error) {
          console.error("[guestbook] mail failed:", error?.message); // pas de contenu ni de secret dans les journaux
        }
      }
      return Response.json({ ok: true, status });
    },
  },

  // SECTIONS D'ACCUEIL (permission « sections »). La taille recommandée est dans module.json ; ici, seulement le contenu.
  // Une section sans rien à montrer renvoie null : elle disparaît et les voisines prennent sa place.
  sections: {
    // « small » : un encart, donc un seul message court.
    async latest(ctx) {
      const [m] = await approved(ctx);
      if (!m) return null;
      const href = pageHref(ctx);
      return [{ type: "heading", text: ctx.t("latestTitle") }, { type: "html", html: card(ctx, m) }, ...(href ? [{ type: "links", items: [{ label: ctx.t("seeAll"), href }] }] : [])];
    },
    // « medium » : une carte avec les derniers messages ; `options.count` est réglé à chaque placement sur l'accueil.
    async recent(ctx, options) {
      const list = (await approved(ctx)).slice(0, num(options?.count, 3, 1, 10));
      if (!list.length) return null;
      const href = pageHref(ctx);
      return [{ type: "heading", text: ctx.t("recentTitle") }, stack(list.map((m) => card(ctx, m))), ...(href ? [{ type: "links", items: [{ label: ctx.t("seeAll"), href }] }] : [])];
    },
  },

  // EMPLACEMENTS (permission « slots ») : un petit lien dans le pied de page de tout le site, si l'administrateur le souhaite.
  slots: {
    "layout.footer"(ctx) {
      const href = pageHref(ctx);
      if (!ctx.setting("footerLink") || !href) return null;
      return [{ type: "links", items: [{ label: ctx.t("footerLink"), href }] }];
    },
  },

  // SUJETS (permission « topics ») : ce que le module PROPOSE aux autres, sans savoir qui le lit. Déclaré dans `provides`.
  exports: {
    // `feed.item` : le cœur met ces éléments dans le flux RSS (/feed.xml). `topics` = rubriques PARTAGÉES : n'importe quel autre
    // module qui publie sur « guestbook » alimente la même rubrique ; le cœur ajoute lui-même `@<instance>`.
    // `url` doit être un chemin du site ou une adresse http(s) ; `publishedAt` une date ISO en texte.
    async "feed.item"(ctx, query) {
      const base = pageHref(ctx, false);
      if (base === null) return []; // pas de page = pas d'adresse à donner au lecteur RSS
      return (await approved(ctx)).slice(0, query?.limit ?? 30).map((m) => ({
        id: `guestbook:${ctx.instance.key}:${m.id}`,
        title: ctx.t("feedTitle", { name: m.name }),
        url: base,
        summary: clean(m.message, 280),
        publishedAt: new Date(m.at).toISOString(),
        topics: ["guestbook"],
      }));
    },
    // Format d'un sujet à nous. Un consommateur le déclare dans son `consumes` (avec le `schema` qu'il sait digérer)
    // et le cœur ne lui livre que les champs de ce schéma : { id, name, text, publishedAt }.
    async "guestbook.message"(ctx, query) {
      return (await approved(ctx)).slice(0, query?.limit ?? 50).map((m) => ({ id: m.id, name: m.name, text: m.message, publishedAt: new Date(m.at).toISOString() }));
    },
  },

  // PANNEAU D'ADMIN (permission « admin ») : sous les réglages de l'instance. Réservé aux administrateurs, vérifié par le cœur.
  // `query` = paramètres de l'URL d'admin : « ?edit=<id> » ouvre le formulaire de modification.
  async adminPanel(ctx, { query }) {
    const list = await all(ctx);
    const pending = list.filter((m) => m.status === "pending").length;
    const blocks = [{ type: "heading", text: ctx.t("adminTitle", { count: list.length, pending }) }];

    const editing = query?.edit ? list.find((m) => m.id === query.edit) : undefined;
    if (editing) {
      blocks.push({
        type: "adminForm", action: "edit", title: ctx.t("editTitle"), submitLabel: ctx.t("save"), cancelHref: "?",
        fields: [
          { name: "id", label: "id", kind: "hidden", value: editing.id },
          { name: "name", label: ctx.t("formName"), required: true, value: editing.name },
          { name: "message", label: ctx.t("formMessage"), kind: "textarea", required: true, value: editing.message },
        ],
      });
    }

    blocks.push({
      type: "table",
      columns: [ctx.t("colDate"), ctx.t("colName"), ctx.t("colMessage"), ctx.t("colStatus")],
      rows: list.map((m) => [day(m.at, ctx.locale), m.name, m.message, m.status === "approved" ? ctx.t("statusApproved") : ctx.t("statusPending")]),
      rowIds: list.map((m) => m.id),
      // `action` exécute une adminAction (le cœur poste `id`) ; `href` navigue ({id} est remplacé).
      rowActions: [
        { label: ctx.t("actApprove"), action: "approve" },
        { label: ctx.t("actEdit"), href: "?edit={id}" },
        { label: ctx.t("actDelete"), action: "remove", confirm: ctx.t("confirmDelete"), danger: true },
      ],
    });
    return blocks;
  },

  // ACTIONS D'ADMIN : renvoient { ok } (message vert), { error } (message rouge) et/ou { redirect: "?" } (retour à la page de l'instance).
  adminActions: {
    async approve(ctx, values) {
      const record = values.id ? await ctx.api.store.get(values.id) : null;
      if (!record) return { error: ctx.t("errNotFound") };
      await ctx.api.store.update(record.id, { ...record.data, status: "approved" }); // `update` REMPLACE le document : on garde les autres champs
      return { ok: ctx.t("okApproved") };
    },
    async edit(ctx, values) {
      const record = values.id ? await ctx.api.store.get(values.id) : null;
      if (!record) return { error: ctx.t("errNotFound") };
      const name = clean(values.name, 60);
      const message = clean(values.message, 2000, true);
      if (!name || !message) return { error: ctx.t("errInvalid") };
      await ctx.api.store.update(record.id, { ...record.data, name, message });
      return { ok: ctx.t("okSaved"), redirect: "?" };
    },
    async remove(ctx, values) {
      if (!values.id) return { error: ctx.t("errNotFound") };
      await ctx.api.store.remove(values.id);
      return { ok: ctx.t("okDeleted") };
    },
  },

  // ACTIONS MCP (permission « mcp ») : un assistant IA peut modérer. Déclarées dans module.json (`mcp`, avec leurs défauts et
  // leur schéma d'arguments) ; le cœur valide `args` AVANT d'appeler ces fonctions, et n'expose que ce que le jeton a le droit de faire.
  // `actor.name` = nom du jeton : on le garde pour savoir QUI a modéré.
  mcp: {
    async guestbook_list(ctx, args) {
      const status = args?.status ?? "all";
      const limit = num(args?.limit, 20, 1, 100);
      return (await all(ctx))
        .filter((m) => status === "all" || m.status === status)
        .slice(0, limit)
        .map((m) => ({ id: m.id, name: m.name, message: m.message, status: m.status, createdAt: new Date(m.at).toISOString() }));
    },
    async guestbook_approve(ctx, args, actor) {
      const record = typeof args?.id === "string" && args.id ? await ctx.api.store.get(args.id) : null;
      if (!record) throw notFound("message not found");
      await ctx.api.store.update(record.id, { ...record.data, status: "approved", moderatedBy: actor?.name });
      return { id: record.id, status: "approved" };
    },
    async guestbook_delete(ctx, args) {
      const record = typeof args?.id === "string" && args.id ? await ctx.api.store.get(args.id) : null;
      if (!record) throw notFound("message not found");
      await ctx.api.store.remove(record.id);
      return { id: record.id, deleted: true };
    },
  },

  // SAUVEGARDE LISIBLE : le cœur sauvegarde déjà le stockage (en JSON). Ce fichier en plus se lit avec n'importe quel tableur,
  // même si le framework n'existe plus. Il atterrit dans readable/modules/<clé de l'instance>/messages.csv.
  backup: {
    async readable(ctx) {
      const header = ["id", "date", "status", "name", "message"].map(cell).join(",");
      const rows = (await all(ctx)).map((m) => [m.id, new Date(m.at).toISOString(), m.status, m.name, m.message].map(cell).join(","));
      return [{ path: "messages.csv", content: `﻿${[header, ...rows].join("\r\n")}\r\n` }]; // BOM : les tableurs lisent bien les accents
    },
  },

  hooks: {
    // Appelé à la création de l'instance (admin ou assistant d'installation), PAS lors d'une restauration de sauvegarde : un module doit
    // donc rester idempotent et ne jamais en dépendre. Ici, un simple message de bienvenue, sans lequel tout marche.
    async onInstanceCreate(ctx) {
      if ((await ctx.api.store.count(COLLECTION)) > 0) return;
      await ctx.api.store.add(COLLECTION, { name: ctx.t("welcomeName"), message: ctx.t("welcomeText"), status: "approved" });
    },
    // Le cœur supprime lui-même réglages et stockage de l'instance ; ce crochet sert à ce que le module est seul à connaître :
    // ici, la mémoire du limiteur (sinon un livre d'or recréé sous la même clé hériterait des compteurs de l'ancien).
    async onInstanceDelete(ctx) {
      for (const key of [...hits.keys()]) if (key.startsWith(`${ctx.instance.key}|`)) hits.delete(key);
    },
  },
};

/** Le formulaire public. Le champ « code » n'existe que si l'administrateur a défini un code d'invitation. */
function form(ctx) {
  const fields = [
    { name: "name", label: ctx.t("formName"), required: true },
    { name: "message", label: ctx.t("formMessage"), kind: "textarea", required: true },
  ];
  if (String(ctx.setting("accessCode") ?? "").trim()) fields.push({ name: "code", label: ctx.t("formCode"), required: true });
  return {
    type: "form",
    action: `${ctx.instance.key}/sign`, // <clé d'instance>/<route> : posté sur /m/<clé>/sign
    fields,
    submitLabel: ctx.t("formSubmit"),
    successText: ctx.setting("autoApprove") === true ? ctx.t("thanksPublished") : ctx.t("thanksPending"),
  };
}
