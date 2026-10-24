// Galeries photos : les routes publiques.
// Les images ne passent plus par ce module : elles sont envoyées et servies par le cœur (`/uploads/…`).
//   POST /m/<clé>/removal                            « Demander le retrait d'une photo »
// La demande de retrait répond de deux façons : en JSON quand le script de la page l'appelle, et par une redirection vers
// une page du module quand le navigateur envoie le formulaire lui-même (sans JavaScript). La destination est TOUJOURS construite ici.

const { C, flag, limited, loadRequests, locked, mailDue, photoRefs, purgeRequests, visitorId, HOUR } = await import(new URL(`./data.mjs${new URL(import.meta.url).search}`, import.meta.url).href);
const { HARD, clean, num } = await import(new URL(`./text.mjs${new URL(import.meta.url).search}`, import.meta.url).href);
const { pageHref } = await import(new URL(`./view.mjs${new URL(import.meta.url).search}`, import.meta.url).href);

const json = (body, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const wantsJson = (request) => /application\/json/i.test(request.headers.get("accept") ?? "");

function reply(request, ctx, status, anchor, body) {
  if (wantsJson(request)) return json(body, status);
  const root = pageHref(ctx);
  if (root === null) return json(body, status);
  return new Response(null, { status: 303, headers: { location: `${root === "/" ? "" : root}/retrait/${anchor}`, "cache-control": "no-store" } });
}

const withTimeout = (promise, ms) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);

async function tellOwner(ctx, label) {
  if (!flag(ctx, "notify", true) || !mailDue(ctx)) return;
  try {
    if (!(await ctx.api.mail.configured())) return;
    await ctx.api.mail.send({
      to: "owner",
      subject: ctx.t("mailSubject"),
      text: `${ctx.t("mailBody")}\n\n« ${label} »\n\n${ctx.t("mailAdmin")} ${ctx.api.siteUrl}/admin/instances/${ctx.instance.id}?tab=requests\n${ctx.t("mailThrottle")}\n`,
    });
  } catch (error) {
    console.error("[gallery] mail failed:", error?.message); // ni texte de visiteur ni secret dans le journal
  }
}

/** Si la personne a laissé un e-mail ET que le carnet d'adresses est là : la demande y arrive aussi (facultatif, jamais bloquant). */
async function tellContacts(ctx, { contact, label, message }) {
  if (!flag(ctx, "forwardToContacts", true) || !/^[^@\s]{1,64}@[^@\s]{1,120}\.[^@\s]{2,24}$/.test(contact)) return;
  try {
    await withTimeout(
      ctx.api.services.call("contact.store", "add", { name: ctx.t("removalContactName"), email: contact, message: `${ctx.t("removalNote")}\n${label}\n\n${message}`, source: "contact-form" }),
      4000,
    );
  } catch (error) {
    console.error("[gallery] contact book failed:", error?.message);
  }
}

export const routes = {
  // POST /m/<clé>/removal : « Demander le retrait d'une photo ». Photo + message ; l'e-mail est facultatif.
  async removal(request, ctx) {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    if (!flag(ctx, "removal", true)) return new Response("Not found", { status: 404 });
    const who = visitorId(request, ctx, "removal");
    if (limited(`${ctx.instance.key}|removal|${who}`, num(ctx.setting("removalLimit"), 3, 1, 30), HOUR)) return reply(request, ctx, 429, "erreur", { ok: false, reason: "limit" });
    let form;
    try { form = await request.formData(); } catch { return reply(request, ctx, 400, "erreur", { ok: false, reason: "invalid" }); }
    if (String(form.get("website") ?? "")) return reply(request, ctx, 200, "merci", { ok: true }); // piège à robots : on fait comme si, sans rien garder
    const message = clean(form.get("message"), HARD.message, true);
    const contact = clean(form.get("contact"), HARD.contact);
    if (message.length < 5 || (message.match(/https?:\/\//gi) ?? []).length > 2) return reply(request, ctx, 400, "erreur", { ok: false, reason: "invalid" });

    // La photo : choisie sur le site (album + photo existants et visibles), ou décrite par la personne.
    let refs = await photoRefs(ctx, form.get("album"), form.get("photo"));
    if (!refs) {
      const which = clean(form.get("which"), HARD.label);
      if (which.length < 2) return reply(request, ctx, 400, "erreur", { ok: false, reason: "invalid" });
      refs = { album: "", photo: "", label: which };
    }

    await purgeRequests(ctx); // les demandes trop anciennes partent au fil de l'eau
    const stored = await locked(ctx, async () => {
      const waiting = (await loadRequests(ctx)).filter((r) => r.status === "new");
      if (waiting.length >= HARD.requests) return "full";
      await ctx.api.store.add(C.requests, { album: refs.album, photo: refs.photo, label: refs.label, message, contact, at: new Date().toISOString(), status: "new" });
      return "added";
    });
    if (stored === "full") return reply(request, ctx, 503, "erreur", { ok: false, reason: "full" });
    await tellContacts(ctx, { contact, label: refs.label, message });
    await tellOwner(ctx, refs.label);
    return reply(request, ctx, 200, "merci", { ok: true });
  },
};
