// Commandes — les trois routes publiques, toutes en POST : « send » (une demande), « cancel » (la cliente annule), « forget » (la cliente efface sa demande).
// Protections : champ piège, limite de demandes par heure et par visiteur (et pour tout le site), une même adresse ne peut pas inonder la file, tailles bornées,
// plafond de commandes gardées, lien de suivi contrôlé avant toute lecture, réponses d'erreur sans détail, aucune redirection vers une adresse reçue.
const v = new URL(import.meta.url).search;
const L = await import(`./lib.mjs${v}`);
const D = await import(`./data.mjs${v}`);
const M = await import(`./mailer.mjs${v}`);
const { LIMITS, HOUR, DAY, clean, num, validEmail, httpUrl, countLinks, limited, peek, visitorOf, addressKey, newToken, hashToken, isToken, pathPrefix } = L;

const json = (body, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const wantsJson = (request) => /application\/json/i.test(request.headers.get("accept") ?? "");
const see = (location) => new Response(null, { status: 303, headers: { location, "cache-control": "no-store" } });
const readForm = async (request) => { try { return await request.formData(); } catch { return null; } };

/** Un refus : en JSON (formulaire avec JavaScript) ou par une redirection vers une petite page claire (formulaire sans JavaScript). */
function refuse(ctx, request, code, status, errors) {
  if (wantsJson(request)) return json({ ok: false, errors: errors ?? { _: ctx.t(`oops_${code}`) } }, status);
  return see(`${pathPrefix(ctx, ctx.locale)}/oups/${code}`);
}

async function send(request, ctx) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const form = await readForm(request);
  if (!form) return json({ ok: false }, 400);
  if (String(form.get("website") ?? "")) return json({ ok: true });                                  // piège à robots : on fait semblant que tout va bien
  const key = ctx.instance.key;
  // Trois compteurs : les essais d'un visiteur (même refusés : un robot qui insiste est freiné), puis les demandes ACCEPTÉES par visiteur et pour tout le site
  // (une faute de frappe n'use pas la limite d'une vraie cliente). Les adresses IP ne sont jamais gardées : seulement une empreinte salée, en mémoire.
  const visitor = visitorOf(request);
  const perVisitor = num(ctx.setting("rateLimit"), 3, 1, 100);
  if (limited(`x|${key}|${visitor}`, 40, HOUR)) return refuse(ctx, request, "rate", 429);
  if (peek(`s|${key}|${visitor}`, perVisitor, HOUR) || peek(`g|${key}|all`, LIMITS.globalPerHour, HOUR)) return refuse(ctx, request, "rate", 429);

  const [queue, st, formulas] = await Promise.all([D.readQueue(ctx), D.stats(ctx), D.listFormulas(ctx)]);
  if (D.publicState(queue, st).state !== "open") return refuse(ctx, request, "closed", 409);

  // Validation : chaque refus dit quel champ corriger et donne un exemple.
  const errors = {};
  const nick = clean(form.get("nick"), LIMITS.nick);
  const email = clean(form.get("email"), LIMITS.email).toLowerCase();
  const want = clean(form.get("want"), LIMITS.want, true);
  const rawInspiration = clean(form.get("inspiration"), LIMITS.inspiration + 50);
  const shown = formulas.filter((f) => f.visible).slice(0, LIMITS.formulas);
  const formulaId = clean(form.get("formula"), 80);
  const formula = shown.find((f) => f.id === formulaId);
  if (!nick) errors.nick = ctx.t("errNick");
  if (!validEmail(email)) errors.email = ctx.t("errEmail");
  if (shown.length && !formula) errors.formula = ctx.t("errFormula");
  if (want.length < 5) errors.want = ctx.t("errWant");
  else if (countLinks(want) > LIMITS.wantLinks) errors.want = ctx.t("errWantLinks");
  const inspiration = rawInspiration ? httpUrl(rawInspiration) : "";
  if (rawInspiration && !inspiration) errors.inspiration = ctx.t("errInspiration");
  if (Object.keys(errors).length) return refuse(ctx, request, "invalid", 400, errors);

  // Plafonds : jamais de stockage sans fin, jamais une file noyée par une seule personne.
  if (st.total >= LIMITS.orders || st.byStatus.new >= num(ctx.setting("maxWaiting"), 100, 10, 500)) return refuse(ctx, request, "busy", 503);
  if (peek(`a|${key}|${addressKey(email)}`, LIMITS.requestsPerAddressPerDay, DAY)) return refuse(ctx, request, "rate", 429, { email: ctx.t("errEmailTooMany") });

  const token = newToken();
  const mailOk = await M.enabled(ctx);
  const now = new Date().toISOString();
  const order = {
    nick, email, mailOptIn: mailOk && form.get("notify") === "on", contactId: null, formulaId: formula?.id ?? "", formulaName: formula?.name ?? "", want, inspiration: inspiration || "",
    status: "new", history: [{ s: "new", at: now }], privateNote: "", clientNote: "", tokenHash: hashToken(token), lang: ctx.locale, queuedAt: "",
  };
  const id = await D.addOrder(ctx, order);
  limited(`s|${key}|${visitor}`, perVisitor, HOUR); limited(`g|${key}|all`, LIMITS.globalPerHour, HOUR); limited(`a|${key}|${addressKey(email)}`, LIMITS.requestsPerAddressPerDay, DAY);   // la demande est enregistrée : on la compte
  // Tout est déjà enregistré : les e-mails sont un plus, une panne ne perd rien et ne change pas la réponse.
  order.id = id;
  await M.confirmation(ctx, order, email, token);
  await M.tellTeam(ctx, order, queue, D.writeQueue);

  const url = `${pathPrefix(ctx, ctx.locale)}/suivi/${token}`;
  return wantsJson(request) ? json({ ok: true, url }) : see(url);
}

/** Les deux actions de la cliente partent de son lien : sans lien valide, la réponse est toujours la même (aucun moyen de savoir si un lien existe). */
async function withOrder(request, ctx, run) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const form = await readForm(request);
  if (!form) return new Response("Bad request", { status: 400 });
  if (limited(`t|${ctx.instance.key}|${visitorOf(request)}`, 20, HOUR)) return new Response("Too many requests", { status: 429 });
  const token = String(form.get("t") ?? "");
  const order = isToken(token) ? await D.findByToken(ctx, token) : null;
  if (!order) return new Response("Not found", { status: 404 });
  return run(order, token);
}

async function cancel(request, ctx) {
  return withOrder(request, ctx, async (order, token) => {
    if (order.status === "new" || order.status === "accepted") {
      order.status = "cancelled";
      order.history = [...order.history, { s: "cancelled", at: new Date().toISOString() }].slice(-LIMITS.history);
      await D.saveOrder(ctx, order);
    }
    return see(`${pathPrefix(ctx, ctx.locale)}/suivi/${token}`);
  });
}

async function forget(request, ctx) {
  return withOrder(request, ctx, async (order) => {
    if (order.status === "new" || ["delivered", "refused", "cancelled"].includes(order.status)) await D.removeOrder(ctx, order.id);
    return see(pathPrefix(ctx, ctx.locale) || "/");
  });
}

export default { send, cancel, forget };
