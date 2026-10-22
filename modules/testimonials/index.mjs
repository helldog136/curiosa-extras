// Témoignages — module communautaire de Curiosa.
//
// Un visiteur laisse un avis (prénom, étoiles facultatives, texte, accord de publication coché) ; l'avis arrive TOUJOURS « en attente » : il n'est montré
// qu'une fois validé par vous, et seulement si l'accord de son auteur est enregistré. Protections de la route publique : champ piège, limites de débit
// (envois, tentatives, total), validation stricte, texte échappé partout, plafonds de stockage, aucune redirection vers l'extérieur.
//
// Les fichiers voisins se chargent avec le même suffixe de version que celui-ci : après une mise à jour, tout est rechargé ensemble.
const v = new URL(import.meta.url).search;
const L = await import(`./lib.mjs${v}`);
const D = await import(`./data.mjs${v}`);
const V = await import(`./view.mjs${v}`);
const A = await import(`./admin.mjs${v}`);

const notFound = (text) => Object.assign(new Error(text), { expose: true });
const here = (ctx, ...segments) => V.href(ctx, ...segments);

/** Retour vers une page du module : toujours une adresse du site, jamais une adresse reçue. */
function go(ctx, ...segments) {
  const to = here(ctx, ...segments);
  return to ? new Response(null, { status: 303, headers: { Location: to } }) : new Response("Not found", { status: 404 });
}

// ── Pages publiques ─────────────────────────────────────────────────────────────────────────────────────────────────
const PAGE_N = /^\d{1,4}$/;
/** Lit le chemin : null = introuvable. Chaque forme a UNE seule adresse (page 1 = l'adresse sans « page »). */
function parseRoute(segments) {
  const [a, b, c, d] = segments;
  const n = (x) => (PAGE_N.test(x ?? "") && Number(x) >= 2 ? Number(x) : null);
  if (segments.length === 0) return { kind: "main" };
  if (a === "page" && segments.length === 2 && n(b)) return { kind: "main", page: n(b) };
  if (a === "tous" && segments.length === 1) return { kind: "all" };
  if (a === "tous" && segments.length === 3 && b === "page" && n(c)) return { kind: "all", page: n(c) };
  if (a === "etoiles" && /^[1-5]$/.test(b ?? "")) {
    if (segments.length === 2) return { kind: "stars", stars: Number(b) };
    if (segments.length === 4 && c === "page" && n(d)) return { kind: "stars", stars: Number(b), page: n(d) };
    return null;
  }
  if (segments.length === 1 && ["laisser", "merci", "retire", "patientez"].includes(a)) return { kind: a };
  if (segments.length === 2 && ["corriger", "merci", "retrait"].includes(a) && /^[0-9a-f]{24,32}$/.test(b)) return { kind: a, value: b };
  return null;
}

const wrap = (...parts) => ({ type: "html", html: `<div class="tm">${parts.join("")}</div>` });
const text = (html) => `<p class="tm-text">${html}</p>`;

async function listPage(ctx, route) {
  const cfg = L.config(ctx);
  // Une seule adresse par contenu : « tous les avis » n'existe que si la page d'accueil des avis est un défilement ; les pages numérotées que si c'est une grille.
  if ((route.kind === "all" && cfg.display !== "slow") || (route.kind === "main" && route.page && cfg.display === "slow")) return { notFound: true, blocks: [] };
  const pub = await D.readPublic(ctx);
  const stats = L.summarize(pub);
  const ordered = L.orderReviews(pub, cfg.order);
  const blocks = [V.style()];
  const intro = ctx.setting("intro");
  if (intro && route.kind === "main" && !route.page) blocks.push({ type: "markdown", text: String(intro) });
  const head = V.summaryBar(ctx, stats) + V.chips(ctx, stats, route.kind === "stars" ? route.stars : null);

  // Défilement lent : la page d'accueil des avis montre les premiers ; la liste complète est sur « tous les avis ».
  if (route.kind === "main" && cfg.display === "slow" && !route.page) {
    const shown = ordered.slice(0, 20);
    blocks.push(wrap(head, shown.length ? V.scroller(ctx, shown) : emptyHtml(ctx), pub.length ? `<nav class="tm-nav"><a class="tm-btn tm-alt" href="${L.esc(here(ctx, "tous") ?? "/")}">${L.esc(ctx.t("seeAll"))}</a></nav>` : ""));
    const ld = V.ldBlock(ctx, stats, shown);
    if (ld) blocks.push(ld);
    return { title: ctx.setting("title") || ctx.t("pageTitle"), description: describe(ctx, stats), blocks };
  }

  const stars = route.kind === "stars" ? route.stars : null;
  const subject = stars ? ordered.filter((r) => r.rating === stars) : ordered;
  const pages = Math.max(1, Math.ceil(subject.length / cfg.perPage));
  const current = route.page ?? 1;
  if (current > pages) return { notFound: true, blocks: [] };
  const slice = subject.slice((current - 1) * cfg.perPage, current * cfg.perPage);
  const segs = route.kind === "stars" ? ["etoiles", String(stars)] : route.kind === "all" ? ["tous"] : [];
  const hrefFor = (p) => here(ctx, ...segs, ...(p > 1 ? ["page", String(p)] : [])) ?? "/";
  blocks.push(wrap(head, slice.length ? V.grid(ctx, slice) : stars ? text(L.esc(ctx.t("emptyStars"))) : emptyHtml(ctx), V.pager(ctx, current, pages, hrefFor)));
  const ld = route.kind === "main" ? V.ldBlock(ctx, stats, slice) : null;       // les données pour les moteurs de recherche : seulement sur la page où ces avis se lisent
  if (ld) blocks.push(ld);
  const suffix = current > 1 ? ` (${ctx.t("pageOf", { page: current, pages })})` : "";
  return { title: `${stars ? ctx.t("starsTitle", { n: stars }) : ctx.setting("title") || ctx.t("pageTitle")}${suffix}`, description: describe(ctx, stats), blocks };
}
const emptyHtml = (ctx) => text(L.esc(ctx.t("empty")));
const describe = (ctx, stats) => (stats.total ? ctx.t("pageDescription", { count: stats.total }) : ctx.t("pageDescriptionEmpty"));

function formPage(ctx, { values, errors, notice } = {}) {
  return {
    title: ctx.t("formTitle"), description: ctx.t("formDescription"),
    blocks: [V.style(), wrap(notice ? text(L.esc(notice)) : "", `<p class="tm-muted">${L.esc(ctx.t("formIntro"))}</p>`), V.form(ctx, { values, errors }),
      wrap(`<nav class="tm-nav"><a class="tm-chip" href="${L.esc(here(ctx) ?? "/")}">${L.esc(ctx.t("backToReviews"))}</a></nav>`)],
  };
}

async function thanksPage(ctx, token) {
  const r = token ? await D.findByToken(ctx, token) : null;
  const state = r ? ctx.t(`thanksState_${r.status}`) : "";
  const parts = [`<p class="tm-text">${L.esc(ctx.t("thanksBody"))}</p>`];
  const blocks = [V.style()];
  if (r) {
    parts.push(`<p class="tm-muted">${L.esc(state)}</p>`);
    blocks.push(wrap(...parts));
    blocks.push({ type: "markdown", text: ctx.t("withdrawIntro") }, { type: "copy", text: `${ctx.api.siteUrl}${here(ctx, "retrait", token)}`, label: ctx.t("withdrawCopy") });
  } else blocks.push(wrap(...parts));
  blocks.push(wrap(`<nav class="tm-nav"><a class="tm-chip" href="${L.esc(here(ctx) ?? "/")}">${L.esc(ctx.t("backToReviews"))}</a></nav>`));
  return { title: ctx.t("thanksTitle"), blocks };
}

async function withdrawPage(ctx, token) {
  const r = await D.findByToken(ctx, token);
  if (!r) return { notFound: true, blocks: [] };
  return {
    title: ctx.t("withdrawTitle"),
    blocks: [V.style(), wrap(`<div class="tm-panel"><p class="tm-muted">${L.esc(ctx.t(`thanksState_${r.status}`))}</p>${V.card(ctx, { ...r, featured: false })}` +
      `<form method="post" action="/m/${L.esc(ctx.instance.key)}/withdraw?lang=${L.esc(ctx.locale)}"><input type="hidden" name="token" value="${L.esc(token)}"><p class="tm-hint">${L.esc(ctx.t("withdrawWarn"))}</p><button class="tm-btn" type="submit">${L.esc(ctx.t("withdrawButton"))}</button></form></div>`)],
  };
}

function messagePage(ctx, titleKey, bodyKey) {
  return { title: ctx.t(titleKey), blocks: [V.style(), wrap(text(L.esc(ctx.t(bodyKey))), `<nav class="tm-nav"><a class="tm-chip" href="${L.esc(here(ctx) ?? "/")}">${L.esc(ctx.t("backToReviews"))}</a></nav>`)] };
}

// ── Les avis à montrer ailleurs ─────────────────────────────────────────────────────────────────────────────────────
const homeOrder = (cfg) => (cfg.order === "manual" || cfg.order === "best" ? cfg.order : "favorites");
async function publicSorted(ctx, order) { return L.orderReviews(await D.readPublic(ctx), order); }

// ── Plan de l'envoi ─────────────────────────────────────────────────────────────────────────────────────────────────
async function notifyOwner(ctx, review, email) {
  try {
    const stars = review.rating ? ctx.t("starsLabel", { n: review.rating }) : ctx.t("noRatingMail");
    await ctx.api.mail.send({
      to: "owner", ...(email ? { replyTo: email } : {}),
      subject: ctx.t("mailSubject", { name: review.name }),
      text: `${ctx.t("mailBody", { name: review.name })}\n${stars}\n\n${review.text}\n\n${ctx.t("mailAdmin")} ${ctx.api.siteUrl}/admin/instances/${ctx.instance.id}\n`,
    });
  } catch (error) {
    console.error("[testimonials] mail failed:", error?.message);       // ni texte d'avis ni adresse dans les journaux
  }
}

const day = (t) => (t > 0 ? new Date(t).toISOString() : null);
const view = (r) => ({ id: r.id, name: r.name, text: r.text, rating: r.rating, status: r.status, featured: r.featured, position: r.position, createdAt: day(r.at), publishedAt: day(r.publishedAt), consentAt: day(r.consentAt) });
const expose = (ctx, key) => notFound(ctx.t(key));

export default {
  // PAGES : /avis (liste), /avis/tous, /avis/etoiles/5, /avis/laisser (le lien à partager), /avis/corriger/…, /avis/merci/…, /avis/retrait/…
  async page(ctx, { segments }) {
    const route = parseRoute(Array.isArray(segments) ? segments : []);
    if (!route || V.base(ctx) === null) return { notFound: true, blocks: [] };
    switch (route.kind) {
      case "laisser": return formPage(ctx);
      case "corriger": {
        const draft = await D.findDraft(ctx, route.value);
        return draft ? formPage(ctx, { values: draft.values, errors: draft.errors }) : formPage(ctx, { notice: ctx.t("draftGone") });
      }
      case "merci": return thanksPage(ctx, route.value);
      case "retrait": return withdrawPage(ctx, route.value);
      case "retire": return messagePage(ctx, "withdrawnTitle", "withdrawnBody");
      case "patientez": return messagePage(ctx, "waitTitle", "waitBody");
      default: return listPage(ctx, route);
    }
  },

  routes: {
    // Envoyer un avis (POST). Réponse : toujours une redirection vers une page du site — jamais une page blanche pour la personne.
    async send(request, ctx) {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
      if (V.base(ctx) === null) return new Response("Not found", { status: 404 });
      const key = ctx.instance.key;
      const visitor = L.visitorKey(request);
      if (L.hit(`${key}|try|${visitor}`, 20, L.HOUR)) return go(ctx, "patientez");        // trop d'essais, bons ou mauvais
      let form;
      try { form = await request.formData(); } catch { return new Response("Bad request", { status: 400 }); }
      if (String(form.get("website") ?? "")) return Response.json({ ok: true });            // piège à robots : on ne lui apprend rien

      const cfg = L.config(ctx);
      const { values, errors } = L.validateReview((k) => form.get(k), cfg);
      if (Object.keys(errors).length) return go(ctx, "corriger", await D.saveDraft(ctx, values, errors));

      const all = await D.readAll(ctx);
      if (all.length >= L.MAX_STORED || all.filter((r) => r.status === "pending").length >= L.MAX_PENDING) return go(ctx, "patientez");
      if (L.full(`${key}|ok|${visitor}`, cfg.rateLimit, L.HOUR) || L.full(`${key}|ok|all`, 40, L.HOUR)) return go(ctx, "patientez");
      // Le même avis envoyé deux fois (double clic, retour arrière) : un seul est gardé.
      if (all.some((r) => r.name === values.name && r.text === values.text)) return go(ctx, "merci");

      const token = L.newToken();
      const t = Date.now();
      const review = {
        id: "", at: t, status: "pending", name: values.name, text: values.text, rating: values.rating, featured: false, position: null, photo: null,
        email: values.email || null, emailUntil: values.email ? t + cfg.emailDays * L.DAY : 0,
        consentAt: t, consentText: ctx.t("consentText"), consentBy: "visitor", consentLocale: ctx.locale,
        tokenHash: L.hashToken(token), decidedAt: 0, publishedAt: 0, editedAt: 0,
      };
      await D.create(ctx, review);                                    // D'ABORD on conserve ; le courrier n'est qu'un plus
      L.note(`${key}|ok|${visitor}`); L.note(`${key}|ok|all`);
      if (cfg.notify) await notifyOwner(ctx, review, values.email);
      return go(ctx, "merci", token);
    },

    // Retirer son avis avec le lien privé reçu à l'envoi (POST : un simple lien ne supprime jamais rien).
    async withdraw(request, ctx) {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
      if (V.base(ctx) === null) return new Response("Not found", { status: 404 });
      if (L.hit(`${ctx.instance.key}|withdraw|${L.visitorKey(request)}`, 20, L.HOUR)) return go(ctx, "patientez");
      let form;
      try { form = await request.formData(); } catch { return new Response("Bad request", { status: 400 }); }
      const token = String(form.get("token") ?? "").slice(0, 64);
      const review = await D.findByToken(ctx, token);
      if (!review) return new Response("Not found", { status: 404 });
      await D.remove(ctx, review.id);                                 // tout part : texte, note, adresse e-mail, accord
      return go(ctx, "retire");
    },

    // Le QR code du lien « Laissez un avis », à télécharger (lecture seulement).
    async qr(request, ctx) {
      if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
      const url = A.shareUrl(ctx);
      if (!url) return new Response("Not found", { status: 404 });
      const svg = A.framedQr(await ctx.api.qr(url));
      return new Response(svg, { headers: { "content-type": "image/svg+xml; charset=utf-8", "content-disposition": 'attachment; filename="qr-avis.svg"', "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox", "cache-control": "no-store" } });
    },
  },

  // ACCUEIL : trois morceaux. Un morceau sans rien à montrer disparaît (les autres prennent sa place).
  sections: {
    // Les avis à la une : 3 par défaut, les coups de cœur d'abord.
    async featured(ctx, options) {
      const cfg = L.config(ctx);
      const list = (await publicSorted(ctx, homeOrder(cfg))).slice(0, L.num(options?.count, 3, 1, 12));
      if (!list.length) return null;
      const slow = options?.layout === "slow";
      const all = cfg.display === "slow" ? here(ctx, "tous") : here(ctx);
      return [V.style(), { type: "heading", text: ctx.t("homeTitle") }, wrap(slow ? V.scroller(ctx, list) : V.grid(ctx, list)),
        ...(all ? [wrap(`<nav class="tm-nav"><a class="tm-chip" href="${L.esc(all)}">${L.esc(ctx.t("seeAll"))}</a></nav>`)] : [])];
    },
    // La note moyenne (à partir de 3 notes) : un petit encart.
    async rating(ctx) {
      const stats = L.summarize(await D.readPublic(ctx));
      if (!L.config(ctx).showAverage || stats.rated < L.MIN_AVERAGE) return null;
      return [V.style(), wrap(V.summaryBar(ctx, stats, { cta: false }), `<nav class="tm-nav"><a class="tm-chip" href="${L.esc(here(ctx) ?? "/")}">${L.esc(ctx.t("seeAll"))}</a></nav>`)];
    },
    // Une invitation à laisser un avis.
    async invite(ctx) {
      const link = here(ctx, "laisser");
      if (!link) return null;
      return [V.style(), { type: "heading", text: ctx.t("inviteTitle") }, wrap(text(L.esc(ctx.t("inviteBody"))), `<nav class="tm-nav"><a class="tm-btn" href="${L.esc(link)}">${L.esc(ctx.t("leaveReview"))}</a></nav>`)];
    },
  },

  // SUJET : les coups de cœur (ou, à défaut, les mieux placés) peuvent défiler dans une source navigateur de stream. Jamais d'adresse e-mail.
  exports: {
    async "overlay.item"(ctx, query) {
      const list = await publicSorted(ctx, "favorites");
      const picked = list.filter((r) => r.featured);
      return (picked.length ? picked : list.slice(0, 5)).slice(0, L.num(query?.limit, 20, 1, 50)).map((r) => ({
        title: ctx.t("overlayTitle", { name: r.name }), text: `${r.rating ? `${"★".repeat(r.rating)} ` : ""}${r.text.slice(0, 240)}`,
      }));
    },
  },

  adminBadge: (ctx) => A.pendingCount(ctx),
  adminPanel: (ctx, args) => A.panel(ctx, args),
  adminActions: A.actions,
  adminDownloads: A.downloads,

  tasks: {
    // Une fois par jour : adresses e-mail arrivées au bout de leur durée, avis refusés depuis plus de 30 jours, brouillons périmés.
    tidy: { everyMinutes: 1440, run: async (ctx) => { await D.tidy(ctx); } },
  },

  mcp: {
    async testimonials_list(ctx, args) {
      const status = args?.status ?? "all";
      const list = (await D.readAll(ctx)).filter((r) => (status === "all" || r.status === status) && (!args?.stars || r.rating === args.stars)).sort((a, b) => b.at - a.at);
      const from = /^\d{1,5}$/.test(String(args?.cursor ?? "")) ? Number(args.cursor) : 0;
      const limit = L.num(args?.limit, 20, 1, 100);
      return { items: list.slice(from, from + limit).map(view), next: from + limit < list.length ? String(from + limit) : null };
    },
    async testimonials_summary(ctx) {
      const all = await D.readAll(ctx);
      const stats = L.summarize(all.filter(L.isPublic));
      return {
        pending: all.filter((r) => r.status === "pending").length, published: all.filter(L.isPublic).length, refused: all.filter((r) => r.status === "rejected").length,
        average: stats.average === null ? null : Math.round(stats.average * 10) / 10, rated: stats.rated, distribution: stats.distribution,
      };
    },
    async testimonials_decide(ctx, args) {
      const r = await A.decide(ctx, args?.id, args?.action);
      if (r.error) throw expose(ctx, r.error);
      return view(r.review);
    },
    async testimonials_delete(ctx, args) {
      const review = await D.readOne(ctx, args?.id);
      if (!review) throw expose(ctx, "errNotFound");
      await D.remove(ctx, review.id);
      return { id: review.id, deleted: true };
    },
  },

  // Sauvegarde lisible : un tableur des avis, SANS les adresses e-mail.
  backup: { readable: (ctx) => A.backupFiles(ctx) },

  hooks: {
    async onInstanceDelete(ctx) { L.forgetInstance(ctx.instance.key); },
  },
};
