// Témoignages : ce que voit le public et ce qui entre par le formulaire.
import test from "node:test";
import assert from "node:assert/strict";
import { parseManifest } from "@/core/modules/manifest";
import { validateArgs } from "@/core/services/mcp/validate";
import { def, manifestJson, messages, L, V, ctxFor, seed, seedMany, review, send, post, GOOD, htmlOf, flat, page, stored, location, NOW, DAY, readJson } from "./helpers/testimonials.mjs";
import fs from "node:fs";

const source = ["index", "lib", "data", "view", "admin"].map((f) => fs.readFileSync(new URL(`../modules/testimonials/${f}.mjs`, import.meta.url), "utf8")).join("\n");
const HOSTILE = `"' onmouseover=PROBEATTR x='"></style></script><img src=x onerror=PROBEIMG><script>PROBESCRIPT</script>`;

// ── Manifeste et textes ────────────────────────────────────────────────────────────────────────────────────────────
test("manifeste : valide, réglages lus par le code, textes fr/en alignés, actions et sections déclarées et réalisées", () => {
  const r = parseManifest(manifestJson); assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(manifestJson.id, "testimonials");
  assert.equal(manifestJson.minCore, "0.2.5");
  assert.equal(manifestJson.name.fr, "Témoignages"); assert.equal(manifestJson.name.en, "Testimonials");
  assert.equal(manifestJson.instances, "single"); assert.equal(manifestJson.basePath, "avis");
  for (const s of manifestJson.settings) assert.ok(new RegExp(`["'.]${s.key}\\b`).test(source), `réglage jamais lu : ${s.key}`);
  assert.deepEqual(Object.keys(messages.fr).sort(), Object.keys(messages.en).sort());
  for (const m of source.matchAll(/\bt\("([A-Za-z0-9_]+)"/g)) assert.ok(m[1] in messages.fr, `clé absente : ${m[1]}`);
  for (const a of manifestJson.mcp) assert.equal(typeof def.mcp[a.name], "function", a.name);
  for (const s of manifestJson.sections) assert.equal(typeof def.sections[s.id], "function", s.id);
  for (const p of manifestJson.provides) assert.equal(typeof def.exports[p.topic], "function", p.topic);
  // Les arguments MCP sont acceptés par le validateur du cœur.
  const decide = manifestJson.mcp.find((a) => a.name === "testimonials_decide").input;
  assert.doesNotThrow(() => validateArgs(decide, { id: "x", action: "approve" }));
  assert.throws(() => validateArgs(decide, { id: "x", action: "hack" }));
  assert.throws(() => validateArgs(decide, { id: "x", action: "approve", email: "a@b.c" }), "aucun argument inconnu");
  for (const a of manifestJson.mcp.filter((x) => x.name !== "testimonials_list" && x.name !== "testimonials_summary")) assert.notEqual(a.default, true, `${a.name} n'est pas accordée d'office`);
  assert.equal(manifestJson.mcp.find((a) => a.name === "testimonials_delete").destructive, true);
  assert.deepEqual(manifestJson.rights.map((x) => x.id).sort(), ["email.view", "reviews.delete", "reviews.export", "reviews.moderate"]);
  assert.ok(manifestJson.rights.filter((x) => x.sensitive).length >= 3);
  assert.ok(manifestJson.privacy.fr && manifestJson.privacy.en);
});

// ── Envoyer un avis ─────────────────────────────────────────────────────────────────────────────────────────────────
test("un avis valide arrive TOUJOURS « en attente », avec l'accord (texte et date) et un lien privé, sans e-mail ni adresse IP", async () => {
  const ctx = ctxFor();
  const res = await send(ctx);
  assert.equal(res.status, 303);
  const [r] = stored(ctx);
  assert.equal(r.data.status, "pending");
  assert.equal(r.data.name, "Camille"); assert.equal(r.data.rating, 5);
  assert.equal(r.data.consent.text, messages.en.consentText);
  assert.ok(Math.abs(Date.parse(r.data.consent.at) - Date.now()) < 5000, "date de l'accord");
  assert.equal(r.data.consent.locale, "en");
  assert.match(r.data.tokenHash, /^[0-9a-f]{64}$/);
  assert.match(location(res), /^\/en\/avis\/merci\/[0-9a-f]{32}$/);
  assert.ok(!location(res).includes(r.data.tokenHash), "seule l'empreinte est gardée, jamais le lien");
  assert.equal(r.data.email, null);
  assert.ok(!JSON.stringify(ctx.dumpStore()).includes("203.0.113.7"), "aucune adresse IP rangée");
  assert.equal(res.headers.get("set-cookie"), null, "aucun cookie");
  assert.equal((await page(ctx)).blocks.length > 0, true);
  assert.ok(!htmlOf(await page(ctx)).includes("Camille"), "pas publié tant qu'on ne l'a pas validé");
});

test("aucun réglage ne permet de publier sans validation : même « tout activé », l'avis reste en attente", async () => {
  const ctx = ctxFor({ settings: { autoApprove: true, moderation: "off", askEmail: true, ratingMode: "none" } });
  await send(ctx);
  assert.equal(stored(ctx)[0].data.status, "pending");
  assert.ok(!/autoApprove|auto_approve/i.test(JSON.stringify(manifestJson.settings)));
});

test("la case d'accord est obligatoire : sans elle, rien n'est gardé et le message est sous la case", async () => {
  const ctx = ctxFor();
  const res = await send(ctx, { consent: "" });
  assert.equal(stored(ctx).length, 0);
  const back = location(res);
  assert.match(back, /^\/en\/avis\/corriger\/[0-9a-f]{24}$/);
  const form = htmlOf(await page(ctx, "corriger", back.split("/").pop()));
  assert.match(form, /id="tm-consent-e"[^>]*>[^<]*Tick the box/);
  assert.match(form, /aria-invalid="true"/);
  assert.match(form, /role="alert"/);
  assert.ok(!/id="tm-consent"[^>]*\bchecked\b/.test(form), "l'accord n'est jamais pré-coché");
});

test("erreurs : sous chaque champ, avec un exemple ; ce qui était écrit revient dans le formulaire (30 minutes)", async () => {
  const ctx = ctxFor({ settings: { askEmail: true } });
  const res = await send(ctx, { name: "  ", text: "court", email: "pas-une-adresse", rating: "9", consent: "" });
  const draft = await page(ctx, "corriger", location(res).split("/").pop());
  const html = htmlOf(draft);
  for (const id of ["name", "rating", "text", "email", "consent"]) assert.match(html, new RegExp(`id="tm-${id}-e"`), id);
  assert.match(html, /for example “Camille”/);
  assert.match(html, /Great welcome/);
  assert.match(html, /camille@example\.org/);
  assert.match(html, /value="pas-une-adresse"/);
  assert.match(html, />court<\/textarea>/);
  assert.match(html, /autofocus/);
  // En français aussi
  const fr = ctxFor({ locale: "fr", settings: { askEmail: true } });
  const r2 = await send(fr, { name: "", consent: "" });
  assert.match(htmlOf(await page(fr, "corriger", location(r2).split("/").pop())), /Écrivez votre prénom ou un pseudo, par exemple « Camille »/);
  // Périmé : le brouillon n'est plus gardé
  assert.equal(await (async () => { const { D } = await import("./helpers/testimonials.mjs"); return D.findDraft(ctx, location(res).split("/").pop(), Date.now() + 31 * 60_000); })(), null);
  const gone = htmlOf(await page(ctx, "corriger", "0".repeat(24)));
  assert.match(gone, /no longer kept/);
});

test("texte : trop court, trop long, trop de liens ; nom vide ; note imposée ; e-mail mal écrit", () => {
  const cfg = { askEmail: true, ratingMode: "required", maxLength: 200 };
  const get = (o) => (k) => o[k];
  const ok = { name: "Ada", text: "Un très bon moment passé ici.", rating: "4", email: "ada@example.org", consent: "yes" };
  assert.deepEqual(L.validateReview(get(ok), cfg).errors, {});
  assert.equal(L.validateReview(get({ ...ok, text: "court" }), cfg).errors.text, "textShort");
  assert.equal(L.validateReview(get({ ...ok, text: "x".repeat(201) }), cfg).errors.text, "textLong");
  assert.equal(L.validateReview(get({ ...ok, text: "Voir https://a.example.org et https://b.example.org pour la suite" }), cfg).errors.text, "links");
  assert.deepEqual(L.validateReview(get({ ...ok, text: "Voir https://a.example.org pour la suite" }), cfg).errors, {}, "un seul lien passe");
  assert.equal(L.validateReview(get({ ...ok, rating: "" }), cfg).errors.rating, "rating");
  assert.equal(L.validateReview(get({ ...ok, rating: "" }), { ...cfg, ratingMode: "optional" }).errors.rating, undefined);
  assert.equal(L.validateReview(get({ ...ok, rating: "3" }), { ...cfg, ratingMode: "none" }).values.rating, null);
  assert.equal(L.validateReview(get({ ...ok, email: "a@b" }), cfg).errors.email, "email");
  assert.equal(L.validateReview(get({ ...ok, email: "" }), cfg).errors.email, undefined, "l'e-mail est facultatif");
  assert.equal(L.validateReview(get({ ...ok, email: "ada@example.org" }), { ...cfg, askEmail: false }).values.email, "", "pas demandé : jamais gardé");
  assert.equal(L.validateReview(get({ ...ok, consent: "on" }), cfg).errors.consent, "consent", "seule la valeur du formulaire compte");
  assert.equal(L.validateReview(get({ ...ok, name: "A\u0007‮B   C" }), cfg).values.name, "AB C", "caractères de contrôle retirés");
});

test("e-mail : demandé seulement si le réglage est actif, facultatif, gardé avec une date de fin, jamais affiché", async () => {
  const ctx = ctxFor({ settings: { askEmail: true, emailDays: 30 } });
  assert.match(htmlOf(await page(ctx, "laisser")), /name="email"/);
  assert.equal(htmlOf(await page(ctxFor(), "laisser")).includes('name="email"'), false, "pas demandé par défaut");
  await send(ctx, { email: "ada@example.org" });
  const [r] = stored(ctx);
  assert.equal(r.data.email, "ada@example.org");
  assert.ok(Math.abs(Date.parse(r.data.emailUntil) - (Date.now() + 30 * DAY)) < 5000);
  await D_approve(ctx, r.id);
  assert.ok(!flat(await page(ctx)).includes("ada@example.org"));
  assert.ok(!flat(await def.sections.featured(ctx, { count: 3 })).includes("ada@example.org"));
  assert.ok(!flat(await def.exports["overlay.item"](ctx, { limit: 5 })).includes("ada@example.org"));
  // facultatif : on peut laisser vide
  const c2 = ctxFor({ settings: { askEmail: true } });
  await send(c2, { email: "" });
  assert.equal(stored(c2)[0].data.email, null);
});
async function D_approve(ctx, id) { const { A } = await import("./helpers/testimonials.mjs"); return A.decide(ctx, id, "approve"); }

test("l'e-mail du propriétaire est prévenu APRÈS la conservation, avec l'adresse de la personne en « répondre à » ; une panne n'efface rien", async () => {
  const ctx = ctxFor({ settings: { askEmail: true } });
  await send(ctx, { email: "ada@example.org" });
  assert.equal(stored(ctx).length, 1);
  assert.equal(ctx.calls.mail.length, 1);
  assert.equal(ctx.calls.mail[0].to, "owner");
  assert.equal(ctx.calls.mail[0].replyTo, "ada@example.org");
  assert.match(ctx.calls.mail[0].text, /\/admin\/instances\//);
  const down = ctxFor({ mailResult: () => { throw new Error("SMTP en panne"); } });
  assert.equal((await send(down)).status, 303);
  assert.equal(stored(down).length, 1, "l'avis est gardé même si le courrier échoue");
  const silent = ctxFor({ settings: { notify: false } });
  await send(silent);
  assert.equal(silent.calls.mail.length, 0);
});

// ── Protections ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("piège à robots : réponse « ok », rien de gardé ; GET et autres méthodes refusés ; corps illisible", async () => {
  const ctx = ctxFor();
  const bot = await def.routes.send(post({ ...GOOD, website: "https://spam.example.org" }), ctx);
  assert.equal(bot.status, 200);
  assert.equal(stored(ctx).length, 0);
  assert.equal((await def.routes.send(new Request("https://example.org/m/x/send", { method: "GET" }), ctx)).status, 405);
  assert.equal((await def.routes.send(new Request("https://example.org/m/x/send", { method: "PUT", body: "x" }), ctx)).status, 405);
  assert.equal((await def.routes.send(new Request("https://example.org/m/x/send", { method: "POST", body: "{pas json", headers: { "content-type": "application/json" } }), ctx)).status, 400);
  assert.equal(stored(ctx).length, 0);
});

test("limite de débit : 3 avis par heure et par visiteur (réglable) ; un autre visiteur n'est pas touché ; l'en-tête inventé ne contourne rien", async () => {
  const ctx = ctxFor();
  const texts = ["Premier avis très sympa.", "Deuxième avis bien aimable.", "Troisième avis encore bon.", "Quatrième avis de trop."];
  for (let i = 0; i < 3; i++) assert.match(location(await send(ctx, { text: texts[i] }, `198.51.100.1`)), /merci\//);
  assert.match(location(await send(ctx, { text: texts[3] }, `198.51.100.1`)), /\/patientez$/);
  assert.equal(stored(ctx).length, 3);
  assert.match(location(await send(ctx, { text: "Un autre visiteur, un autre avis." }, `198.51.100.2`)), /merci\//);
  // Le début de l'en-tête est inventé par le visiteur : seul le dernier nom compte.
  assert.match(location(await send(ctx, { text: "Encore un avis à envoyer vite." }, `10.0.0.${Math.floor(Math.random() * 200)}, 198.51.100.1`)), /\/patientez$/);
  const strict = ctxFor({ settings: { rateLimit: 1 } });
  await send(strict, { text: "Premier et seul avis permis." }, "192.0.2.5");
  assert.match(location(await send(strict, { text: "Deuxième avis refusé ici." }, "192.0.2.5")), /\/patientez$/);
});

test("le total par heure protège l'instance entière, les essais ratés comptent aussi", async () => {
  const ctx = ctxFor({ settings: { rateLimit: 50 } });
  let blocked = 0;
  for (let i = 0; i < 30; i++) if (/patientez/.test(location(await send(ctx, { consent: "" }, "192.0.2.77")))) blocked++;
  assert.ok(blocked >= 10, "au-delà de 20 tentatives par heure : on patiente");
  assert.equal(stored(ctx).length, 0);
});

test("plafonds : trop d'avis en attente ou trop d'avis au total → « patientez », rien de plus n'est gardé ; le même avis deux fois n'est gardé qu'une fois", async () => {
  const pend = ctxFor();
  await seedMany(pend, 200, () => ({ status: "pending" }));
  assert.match(location(await send(pend, { text: "Un avis de plus dans la file." })), /patientez/);
  assert.equal(stored(pend).length, 200);
  const dup = ctxFor();
  await send(dup, {}, "192.0.2.10"); await send(dup, {}, "192.0.2.10");
  assert.equal(stored(dup).length, 1);
  const huge = ctxFor();
  const res = await send(huge, { text: "x".repeat(2_000_000), name: "n".repeat(100_000) });
  assert.match(location(res), /corriger/);
  assert.ok(JSON.stringify(huge.dumpStore()).length < 10_000, "même un envoi démesuré ne remplit pas le stockage");
});

test("une route ne redirige jamais vers l'extérieur : toujours un chemin du site, quelles que soient les valeurs reçues", async () => {
  const ctx = ctxFor();
  const res = await def.routes.send(post({ ...GOOD, next: "https://evil.example/x", redirect: "//evil.example", return: "https://evil.example", consent: "" }), ctx);
  assert.match(location(res), /^\/en\/avis\//);
  assert.ok(!/evil/.test(location(res)));
});

// ── Ce que voit le public ─────────────────────────────────────────────────────────────────────────────────────────
test("rien n'est montré sans validation ET sans accord enregistré, quel que soit l'état", async () => {
  const ctx = ctxFor();
  await seed(ctx, { name: "Publié", status: "approved" });
  await seed(ctx, { name: "Attente", status: "pending" });
  await seed(ctx, { name: "Refusé", status: "rejected" });
  await seed(ctx, { name: "SansAccord", status: "approved", consent: null });
  const out = flat(await page(ctx));
  assert.match(out, /Publié/);
  for (const hidden of ["Attente", "Refusé", "SansAccord"]) assert.ok(!out.includes(hidden), hidden);
  for (const s of [await def.sections.featured(ctx, { count: 9 }), await def.exports["overlay.item"](ctx, { limit: 9 })]) for (const hidden of ["Attente", "Refusé", "SansAccord"]) assert.ok(!flat(s).includes(hidden), hidden);
});

test("étoiles : un texte pour chaque note (jamais seulement des icônes), en français et en anglais", async () => {
  const en = ctxFor(); await seed(en, { rating: 4 });
  const h = htmlOf(await page(en));
  assert.match(h, /role="img" aria-label="Rating: 4 out of 5"/);
  assert.match(h, /aria-hidden="true">★★★★☆</);
  assert.match(h, /4\/5/);
  const fr = ctxFor({ locale: "fr" }); await seed(fr, { rating: 3 });
  assert.match(htmlOf(await page(fr)), /aria-label="Note : 3 sur 5"/);
  const none = ctxFor(); await seed(none, { rating: null });
  assert.ok(!htmlOf(await page(none)).includes('class="tm-rating"'), "avis sans étoiles : pas d'étoiles");
});

test("tout ce que saisit un visiteur est échappé (nom, avis, photo, accord) ; une photo non sûre est écartée", async () => {
  const ctx = ctxFor({ settings: { structuredData: true, aboutName: HOSTILE } });
  await seedMany(ctx, 6, () => ({ name: HOSTILE, text: HOSTILE, photo: "javascript:PROBEJS(1)", rating: 5 }));
  await seed(ctx, { name: "Photo", photo: "https://img.example.org/a.jpg?x=1" });
  await seed(ctx, { name: "Photo2", photo: `/uploads/a.png" onerror="x` });
  const everything = [flat(await page(ctx)), flat(await page(ctx, "tous")), flat(await def.sections.featured(ctx, { count: 6 })), flat(await page(ctx, "etoiles", "5"))].join("\n");
  assert.ok(!everything.includes("<img src=x onerror=PROBEIMG>"));
  assert.ok(!everything.includes("<script>PROBESCRIPT"));
  assert.ok(!everything.includes("javascript:PROBEJS"));
  assert.ok(!/" onmouseover=PROBEATTR/.test(everything.replace(/&quot; onmouseover/g, "")), "guillemets échappés");
  assert.match(htmlOf(await page(ctx)), /src="https:\/\/img\.example\.org\/a\.jpg\?x=1"/);
  assert.ok(!htmlOf(await page(ctx)).includes("onerror=\"x"));
});

test("grille par défaut, pagination : une seule adresse par page, page vide ou inconnue → 404", async () => {
  const ctx = ctxFor({ settings: { perPage: 5 } });
  await seedMany(ctx, 12);
  const p1 = await page(ctx);
  assert.equal((htmlOf(p1).match(/<article/g) ?? []).length, 5);
  assert.match(htmlOf(p1), /href="\/en\/avis\/page\/2"/);
  assert.match(htmlOf(p1), /Page 1 of 3/);
  assert.equal((htmlOf(await page(ctx, "page", "3")).match(/<article/g) ?? []).length, 2);
  for (const segs of [["page", "1"], ["page", "4"], ["page", "x"], ["page", "0002"], ["tous"], ["nope"], ["page"], ["etoiles", "7"], ["etoiles"], ["merci", "x"], ["corriger", "zz"], ["retrait", "short"]]) {
    const res = await page(ctx, ...segs);
    assert.ok(res.notFound || (segs[0] === "merci" || segs[0] === "corriger") , `${segs.join("/")} devrait être introuvable`);
  }
  const empty = ctxFor();
  assert.match(htmlOf(await page(empty)), /No published review yet/);
  assert.match(htmlOf(await page(empty)), /href="\/en\/avis\/laisser"/);
  assert.equal((await page(empty, "page", "2")).notFound, true);
  const noPage = fakeNoPage();
  assert.equal((await page(noPage)).notFound, true);
});
function fakeNoPage() { const c = ctxFor(); c.instance.basePath = null; return c; }

test("ordre : favoris d'abord (défaut), plus récents, mieux notés, à la main", async () => {
  const mk = async (order) => {
    const ctx = ctxFor({ settings: { order } });
    await seed(ctx, { name: "A-vieux-5", rating: 5, at: NOW - 5 * DAY });
    await seed(ctx, { name: "B-recent-2", rating: 2, at: NOW - 1 * DAY });
    await seed(ctx, { name: "C-coeur-3", rating: 3, featured: true, at: NOW - 3 * DAY, position: 2 });
    await seed(ctx, { name: "D-milieu-4", rating: 4, at: NOW - 2 * DAY, position: 1 });
    return [...htmlOf(await page(ctx)).matchAll(/class="tm-name">([^<]+)</g)].map((m) => m[1]);
  };
  assert.deepEqual(await mk("favorites"), ["C-coeur-3", "B-recent-2", "D-milieu-4", "A-vieux-5"]);
  assert.deepEqual(await mk(undefined), ["C-coeur-3", "B-recent-2", "D-milieu-4", "A-vieux-5"]);
  assert.deepEqual(await mk("newest"), ["B-recent-2", "D-milieu-4", "C-coeur-3", "A-vieux-5"]);
  assert.deepEqual(await mk("best"), ["A-vieux-5", "D-milieu-4", "C-coeur-3", "B-recent-2"]);
  assert.deepEqual(await mk("manual"), ["D-milieu-4", "C-coeur-3", "B-recent-2", "A-vieux-5"]);
  const html = htmlOf(await page(await (async () => { const c = ctxFor(); await seed(c, { featured: true }); return c; })()));
  assert.match(html, /★ Favourite/, "le favori s'écrit en toutes lettres");
});

test("note moyenne : à partir de 3 notes, sur les seules notes données, et on peut la masquer", async () => {
  const ctx = ctxFor();
  await seed(ctx, { rating: 5 }); await seed(ctx, { rating: 4 });
  assert.ok(!htmlOf(await page(ctx)).includes("Average rating"), "2 notes : pas de moyenne");
  await seed(ctx, { rating: 3 }); await seed(ctx, { rating: null, name: "SansNote" });
  const h = htmlOf(await page(ctx));
  assert.match(h, /Average rating: 4\.0 out of 5, from 3 ratings/);
  const fr = ctxFor({ locale: "fr" }); await seedMany(fr, 3, (i) => ({ rating: [5, 4, 4][i] }));
  assert.match(htmlOf(await page(fr)), /Note moyenne : 4,3 sur 5, d&#39;après 3 notes/);
  const off = ctxFor({ settings: { showAverage: false } }); await seedMany(off, 4);
  assert.ok(!htmlOf(await page(off)).includes("Average rating"));
  assert.equal(await def.sections.rating(off), null);
  assert.equal(await def.sections.rating(ctxFor()), null);
  const avg = await def.sections.rating(ctx);
  assert.match(flat(avg), /Average rating/);
});

test("filtre par étoiles : proposé à partir de 6 notes, une adresse par note, aucune note → message", async () => {
  const ctx = ctxFor();
  await seedMany(ctx, 5, () => ({ rating: 5 }));
  assert.ok(!htmlOf(await page(ctx)).includes("Filter by rating"));
  await seed(ctx, { name: "Trois", rating: 3 });
  const h = htmlOf(await page(ctx));
  assert.match(h, /Filter by rating/);
  assert.match(h, /href="\/en\/avis\/etoiles\/3"[^>]*>Rating 3 out of 5 \(1\)/);
  assert.ok(!h.includes("etoiles/2"), "pas de lien vers une note sans avis");
  const three = await page(ctx, "etoiles", "3");
  assert.match(htmlOf(three), /Trois/); assert.ok(!htmlOf(three).includes("Personne 0"));
  assert.match(htmlOf(three), /aria-current="page"/);
  assert.match(htmlOf(await page(ctx, "etoiles", "1")), /No review with this rating/);
  assert.match(three.title, /3 out of 5/);
});

test("défilement lent : bouton pause réel, aucun script, mouvement coupé si « moins de mouvement », copie cachée aux lecteurs d'écran, grille sous 4 avis", async () => {
  const ctx = ctxFor({ settings: { display: "slow" } });
  await seedMany(ctx, 3);
  assert.ok(!htmlOf(await page(ctx)).includes("tm-track"), "3 avis : une grille suffit");
  await seedMany(ctx, 3, (i) => ({ name: `Plus ${i}` }));
  const res = await page(ctx);
  const h = htmlOf(res);
  assert.match(h, /<label class="tm-pause"><input type="checkbox">/);
  assert.match(h, /Pause scrolling/);
  assert.equal((h.match(/class="tm-card tm-dup/g) ?? []).length, 6);
  assert.equal((h.match(/class="tm-card tm-dup[^>]*aria-hidden="true"/g) ?? []).length, 6, "les copies sont cachées aux lecteurs d'écran");
  assert.ok(!/<script/i.test(h), "aucun script : la pause est une case à cocher");
  assert.match(h, /--tm-dur:\d+s/);
  const css = V.CSS;
  assert.match(css, /@media \(prefers-reduced-motion:no-preference\)[\s\S]*animation:tm-slide/);
  assert.ok(!/animation:tm-slide[^}]*}[\s\S]*@media \(prefers-reduced-motion:no-preference\)/.test(css) , "l'animation n'existe que dans le bloc « sans préférence »");
  assert.match(css, /\.tm-dup,\.tm-pause\{display:none\}/);
  assert.match(css, /animation-play-state:paused/);
  assert.match(css, /:hover \.tm-track|\.tm-viewport:hover/);
  // La liste complète est ailleurs, en grille paginée ; les pages numérotées de l'accueil des avis n'existent plus.
  assert.match(h, /href="\/en\/avis\/tous"/);
  assert.equal((await page(ctx, "tous")).notFound, undefined);
  assert.equal((await page(ctx, "page", "2")).notFound, true);
  // Sans le défilement lent, « tous » n'existe pas (une seule adresse par contenu).
  assert.equal((await page(ctxFor(), "tous")).notFound, true);
});

test("accueil : trois avis à la une par défaut (favoris d'abord), grille ou défilement, rien à montrer = la section disparaît", async () => {
  const ctx = ctxFor();
  assert.equal(await def.sections.featured(ctx, {}), null);
  await seedMany(ctx, 6);
  await seed(ctx, { name: "Star", featured: true, at: NOW - 40 * DAY });
  const out = await def.sections.featured(ctx, {});
  const h = htmlOf(out);
  assert.equal((h.match(/<article/g) ?? []).length, 3);
  assert.match(h, /Star/);
  assert.equal((htmlOf(await def.sections.featured(ctx, { count: 5 })).match(/<article/g) ?? []).length, 5);
  assert.equal((htmlOf(await def.sections.featured(ctx, { count: 999 })).match(/<article/g) ?? []).length, 7, "borné au nombre d'avis (12 au plus)");
  assert.match(htmlOf(await def.sections.featured(ctx, { count: 6, layout: "slow" })), /tm-track/);
  assert.match(h, /href="\/en\/avis"/);
  const invite = await def.sections.invite(ctx);
  assert.match(flat(invite), /Leave a review/);
  assert.match(flat(invite), /\/en\/avis\/laisser/);
  const noPage = fakeNoPage();
  assert.equal(await def.sections.invite(noPage), null);
});

// ── Données pour les moteurs de recherche ─────────────────────────────────────────────────────────────────────────────
test("données d'évaluation : éteintes par défaut ; sinon seulement avec un nom, 5 notes réelles et sur la page où les avis se lisent", async () => {
  const base = { structuredData: true, aboutName: "Cours de dessin", aboutType: "Course" };
  const off = ctxFor(); await seedMany(off, 8);
  assert.ok(!htmlOf(await page(off)).includes("application/ld+json"), "éteint par défaut");
  const few = ctxFor({ settings: base }); await seedMany(few, 4);
  assert.ok(!htmlOf(await page(few)).includes("ld+json"), "moins de 5 notes");
  const noName = ctxFor({ settings: { structuredData: true } }); await seedMany(noName, 8);
  assert.ok(!htmlOf(await page(noName)).includes("ld+json"), "sans nom de ce qui est noté");
  const ctx = ctxFor({ settings: base });
  await seedMany(ctx, 5, (i) => ({ rating: [5, 5, 4, 3, 5][i] }));
  await seed(ctx, { name: "SansNote", rating: null });
  const h = htmlOf(await page(ctx));
  const m = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(h);
  assert.ok(m, "balise présente");
  const data = JSON.parse(m[1]);
  assert.equal(data["@type"], "Course"); assert.equal(data.name, "Cours de dessin");
  assert.deepEqual([data.aggregateRating.ratingValue, data.aggregateRating.ratingCount, data.aggregateRating.reviewCount], ["4.4", 5, 5]);
  assert.equal(data.review.length, 5, "seuls les avis notés et visibles sont cités");
  assert.ok(data.review.every((r) => r.reviewRating.ratingValue >= 1 && r.author.name));
  for (const where of [["laisser"], ["etoiles", "5"], ["merci"], ["retire"]]) assert.ok(!htmlOf(await page(ctx, ...where)).includes("ld+json"), `pas de données sur /${where.join("/")}`);
  assert.ok(!flat(await def.sections.featured(ctx, {})).includes("ld+json"), "pas dans les morceaux d'accueil");
  // Un avis refusé ou en attente ne compte jamais ; une moyenne choisie (favoris seulement) n'existe pas.
  await seed(ctx, { status: "rejected", rating: 1 }); await seed(ctx, { status: "pending", rating: 1 });
  const again = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(htmlOf(await page(ctx)))[1]);
  assert.equal(again.aggregateRating.ratingCount, 5);
  // Type inconnu → service ; texte hostile jamais capable de fermer la balise
  const bad = ctxFor({ settings: { structuredData: true, aboutName: "</script><script>alert(1)</script>", aboutType: "Hacker" } });
  await seedMany(bad, 6);
  const raw = htmlOf(await page(bad));
  assert.equal((raw.match(/<\/script>/g) ?? []).length, 1, "la seule balise fermante est la nôtre");
  assert.equal(JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(raw)[1])["@type"], "Service");
  assert.match(manifestJson.settings.find((s) => s.key === "structuredData").help.fr, /pas de vous-même/);
  assert.equal(manifestJson.settings.find((s) => s.key === "structuredData").default, false);
  assert.equal(manifestJson.settings.find((s) => s.key === "structuredData").advanced, true);
});

// ── Le formulaire ───────────────────────────────────────────────────────────────────────────────────────────────────
test("formulaire : vrai formulaire de navigateur, étiquettes liées, champ piège caché, cibles de 44 px, case d'accord et lien vers la confidentialité", async () => {
  const ctx = ctxFor({ locale: "fr", settings: { ratingMode: "optional" } });
  const h = htmlOf(await page(ctx, "laisser"));
  assert.match(h, /<form class="tm-form" method="post" action="\/m\/tm\d+\/send\?lang=fr" novalidate>/);
  for (const id of ["tm-name", "tm-text", "tm-consent"]) assert.match(h, new RegExp(`<label[^>]* for="${id}"`));
  assert.match(h, /name="website" type="text" tabindex="-1" autocomplete="off"/);
  assert.match(h, /class="tm-hp" aria-hidden="true"/);
  assert.match(h, /type="checkbox" value="yes" required/);
  assert.match(h, /href="\/privacy"/);
  assert.match(h, /J&#39;accepte que mon avis/);
  assert.match(h, /value="" checked/, "« Sans note » est le choix de départ quand les étoiles sont facultatives");
  assert.match(V.CSS, /min-height:44px/); assert.match(V.CSS, /min-height:48px/);
  assert.ok(!/<script/i.test(h));
  const required = htmlOf(await page(ctxFor({ settings: { ratingMode: "required" } }), "laisser"));
  assert.ok(!required.includes("No rating"));
  const none = htmlOf(await page(ctxFor({ settings: { ratingMode: "none" } }), "laisser"));
  assert.ok(!none.includes('name="rating"'));
  const en = ctxFor({ locale: "en" });
  assert.match(htmlOf(await page(en, "laisser")), /href="\/en\/privacy"/);
});

// ── Retirer son avis ────────────────────────────────────────────────────────────────────────────────────────────────
test("lien privé : la page de remerciement le donne, la page de retrait demande confirmation (POST), tout est effacé, un mauvais lien ne fait rien", async () => {
  const ctx = ctxFor({ settings: { askEmail: true } });
  const res = await send(ctx, { email: "ada@example.org" });
  const token = location(res).split("/").pop();
  const thanks = await page(ctx, "merci", token);
  assert.match(flat(thanks), /Keep this link to yourself/);
  assert.match(flat(thanks), new RegExp(`https://example\\.test/en/avis/retrait/${token}`));
  assert.match(flat(thanks), /waiting to be read/);
  const withdraw = htmlOf(await page(ctx, "retrait", token));
  assert.match(withdraw, /<form method="post" action="\/m\/tm\d+\/withdraw\?lang=en">/);
  assert.match(withdraw, /Camille/);
  // un GET ne supprime rien
  const wr = (t) => def.routes.withdraw(post({ token: t }, "198.51.100.9", "withdraw"), ctx);
  assert.equal((await def.routes.withdraw(new Request("https://example.org/m/x/withdraw", { method: "GET" }), ctx)).status, 405);
  assert.equal(stored(ctx).length, 1);
  assert.equal((await wr("0".repeat(32))).status, 404);
  assert.equal((await wr("zz")).status, 404);
  assert.equal(stored(ctx).length, 1);
  const done = await wr(token);
  assert.equal(done.status, 303); assert.match(location(done), /\/en\/avis\/retire$/);
  assert.equal(stored(ctx).length, 0);
  assert.ok(!JSON.stringify(ctx.dumpStore()).includes("ada@example.org"), "l'e-mail part avec l'avis");
  assert.equal((await page(ctx, "retrait", token)).notFound, true);
  assert.match(flat(await page(ctx, "retire")), /withdrawn and erased/);
  // sans lien valable, la page de remerciement ne propose rien
  assert.ok(!flat(await page(ctx, "merci", "a".repeat(32))).includes("Keep this link"));
  // état publié visible pour l'auteur
  const c2 = ctxFor(); const t2 = location(await send(c2)).split("/").pop();
  await D_approve(c2, stored(c2)[0].id);
  assert.match(flat(await page(c2, "merci", t2)), /published on the site/);
});

test("la page de retrait est limitée en débit", async () => {
  const ctx = ctxFor();
  let patient = 0;
  for (let i = 0; i < 25; i++) { const r = await def.routes.withdraw(post({ token: "0".repeat(32) }, "192.0.2.50", "withdraw"), ctx); if (r.status === 303) patient++; }
  assert.ok(patient >= 4, "au-delà de 20 essais par heure : on patiente");
});

// ── QR code et lien ───────────────────────────────────────────────────────────────────────────────────────────────────
test("QR code : image à télécharger (GET seulement), sur fond blanc avec marge, sans rien écrire", async () => {
  const ctx = ctxFor();
  ctx.api.qr = async () => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21"><path d="M0 0h1v1H0z"/></svg>';
  const res = await def.routes.qr(new Request("https://example.org/m/x/qr"), ctx);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/svg+xml; charset=utf-8");
  assert.match(res.headers.get("content-disposition"), /attachment/);
  const svg = await res.text();
  assert.match(svg, /viewBox="-4 -4 29 29"/); assert.match(svg, /fill="#ffffff"/); assert.match(svg, /<path d="M0 0h1v1H0z"\/>/);
  assert.equal((await def.routes.qr(new Request("https://example.org/m/x/qr", { method: "POST", body: "x" }), ctx)).status, 405);
  assert.equal(ctx.calls.writes.length, 0);
});

test("overlay : seuls les favoris (ou les premiers avis) sont proposés, sans e-mail, bornés", async () => {
  const ctx = ctxFor();
  assert.deepEqual(await def.exports["overlay.item"](ctx, { limit: 5 }), []);
  await seedMany(ctx, 8);
  assert.equal((await def.exports["overlay.item"](ctx, { limit: 20 })).length, 5, "sans favori : les 5 premiers");
  await seed(ctx, { name: "Chouchou", featured: true, rating: 4 });
  const items = await def.exports["overlay.item"](ctx, { limit: 20 });
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Review from Chouchou");
  assert.match(items[0].text, /^★★★★ /);
});

test("aucun cookie, aucun stockage navigateur, aucun appel direct au réseau, aucun minuteur de fond", () => {
  assert.ok(!/set-cookie|document\.cookie|localStorage|sessionStorage/i.test(source));
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest/.test(source.replace(/\/\/[^\n]*/g, "")));
  assert.ok(!/\bsetInterval\s*\(/.test(source));
});
