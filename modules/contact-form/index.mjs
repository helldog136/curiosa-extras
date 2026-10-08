// Contact form — module de Curiosa.
// Anti-abus minimal en mémoire : 5 messages / heure / IP.
const hits = new Map();
function limited(ip) {
    const now = Date.now();
    const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3_600_000);
    recent.push(now);
    hits.set(ip, recent);
    return recent.length > 5;
}
export default ({
    routes: {
        async send(request, ctx) {
            if (request.method !== "POST")
                return new Response("Method not allowed", { status: 405 });
            const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
            if (limited(ip))
                return Response.json({ ok: false }, { status: 429 });
            let form;
            try {
                form = await request.formData();
            }
            catch {
                return Response.json({ ok: false }, { status: 400 }); // corps qui n'est pas un formulaire
            }
            if (String(form.get("website") ?? ""))
                return Response.json({ ok: true }); // piège à robots
            const name = String(form.get("name") ?? "").trim().slice(0, 120);
            const email = String(form.get("email") ?? "").trim().slice(0, 200);
            const message = String(form.get("message") ?? "").trim().slice(0, 5000);
            if (!name || !message || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
                return Response.json({ ok: false }, { status: 400 });
            }
            // D'abord on CONSERVE : sans carnet disponible, on refuse plutôt que de perdre le message en annonçant un succès.
            const saved = await ctx.api.services.call("contact.store", "add", { name, email, message, source: "contact-form" });
            if (!saved.ok)
                return Response.json({ ok: false }, { status: 503 });
            // Le message est déjà conservé : une panne d'e-mail ne doit jamais le perdre ni échouer la requête (le service ne lève jamais).
            if (ctx.setting("notify") !== false) {
                await ctx.api.mail.send({ to: "owner", replyTo: email, subject: ctx.t("mailSubject", { name }), text: `${ctx.t("mailBody", { name, email })}\n\n${message}\n` });
            }
            return Response.json({ ok: true });
        },
    },
    slots: {
        "entry.bottom"(ctx) {
            const wanted = ctx.setting("pageSlug");
            if (!wanted || ctx.entry?.slug !== wanted)
                return null;
            return [form(ctx)];
        },
    },
    sections: {
        form: (ctx) => [form(ctx)],
    },
});
function form(ctx) {
    return {
        type: "form",
        action: `${ctx.instance.key}/send`,
        submitLabel: ctx.t("send"),
        successText: ctx.t("sent"),
        fields: [
            { name: "name", label: ctx.t("name"), required: true },
            { name: "email", label: ctx.t("email"), kind: "email", required: true },
            { name: "message", label: ctx.t("message"), kind: "textarea", required: true },
        ],
    };
}
