import test from "node:test";
import assert from "node:assert/strict";
import { loadModule } from "./helpers/moduleLoader.mjs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { assertValidManifest, assertDefinitionMatchesManifest, assertSettingsSane, assertLocalesParity } from "./helpers/builtinChecks.mjs";

const cf = await loadModule("modules/contact-form");
const { definition: def, manifest, locales } = cf;

let ipSeq = 0;
const freshIp = () => `10.0.0.${++ipSeq}`;
const post = (fields, { ip = freshIp(), method = "POST" } = {}) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return new Request("https://x.test/m/contact/send", { method, headers: { "x-forwarded-for": ip }, ...(method === "GET" ? {} : { body: fd }) });
};
const ok = { name: "Alice", email: "alice@example.org", message: "Bonjour" };
// Le formulaire ne stocke rien : il appelle le service « contact.store » (fourni par le module Contacts). On le simule et on garde ce qu'il reçoit.
const formCtx = (opts = {}) => {
  const saved = [];
  const c = fakeCtx({ services: { "contact.store": { add: async (a) => { saved.push(a); return { id: `c${saved.length}`, created: true }; } } }, ...opts });
  c.saved = saved;
  return c;
};
const messagesOf = async (ctx) => ctx.saved.map((a) => ({ data: { name: a.name, email: a.email, message: a.message } }));

test("contact-form : manifeste valide, section « form », permissions routes/slots/sections, dépend du service contact.store, désactivé tant qu'on ne l'active pas", async () => {
  const m = await assertValidManifest(manifest);
  assertDefinitionMatchesManifest(m, def);
  assertSettingsSane(m);
  assert.deepEqual(m.sections.map((s) => s.id), ["form"]);
  for (const p of ["slots", "routes", "sections"]) assert.ok(m.permissions.includes(p), p);
  assert.ok(!m.permissions.includes("storage"), "il ne stocke rien lui-même");
  assert.deepEqual(m.requires.map((r) => r.service), ["contact.store"]);
  assert.equal(m.defaultEnabled, false);
  assert.equal(m.instances, "multiple");
  assert.equal(m.settings[0].key, "pageSlug");
  assert.equal(m.settings[0].translatable, true);
  assert.equal(m.settings[0].default, undefined, "pas de page choisie par défaut");
  assert.equal(m.mcp, undefined);
});

test("contact-form : locales en/fr identiques et utilisées par le formulaire", () => {
  assertLocalesParity(locales);
  for (const k of ["name", "email", "message", "send", "sent", "mailSubject", "mailBody"]) assert.ok(locales.en[k] && locales.fr[k], k);
});

test("contact-form : message valide enregistré dans ctx.api.store, réponse ok", async () => {
  const ctx = formCtx();
  const res = await def.routes.send(post(ok), ctx);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  const rows = await messagesOf(ctx);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].data, ok);
});

test("contact-form : méthode autre que POST → 405, rien stocké", async () => {
  const ctx = formCtx();
  const res = await def.routes.send(post(ok, { method: "GET" }), ctx);
  assert.equal(res.status, 405);
  assert.equal(ctx.saved.length, 0);
});

test("contact-form : champs vides ou manquants → 400, rien stocké", async () => {
  const ctx = formCtx();
  for (const bad of [{}, { ...ok, name: "   " }, { ...ok, message: "" }, { name: "A", message: "M" }, { ...ok, email: "" }]) {
    const res = await def.routes.send(post(bad), ctx);
    assert.equal(res.status, 400, JSON.stringify(bad));
    assert.deepEqual(await res.json(), { ok: false });
  }
  assert.equal(ctx.saved.length, 0);
});

test("contact-form : emails invalides refusés", async () => {
  const ctx = formCtx();
  for (const email of ["alice", "alice@", "@x.org", "a b@x.org", "alice@x", "alice@@x.org", "a@x .org"]) {
    const res = await def.routes.send(post({ ...ok, email }), ctx);
    assert.equal(res.status, 400, email);
  }
  assert.equal(ctx.saved.length, 0);
});

test("contact-form : valeurs rognées et tronquées (120 / 200 / 5000)", async () => {
  const ctx = formCtx();
  await def.routes.send(post({ name: `  ${"n".repeat(500)}  `, email: "a@b.co", message: ` ${"m".repeat(9000)} ` }), ctx);
  const [row] = await messagesOf(ctx);
  assert.equal(row.data.name.length, 120);
  assert.equal(row.data.message.length, 5000);
  const ctx2 = formCtx();
  const longEmail = `${"a".repeat(250)}@x.org`;
  const res = await def.routes.send(post({ ...ok, email: longEmail }), ctx2);
  assert.equal(res.status, 400, "un email tronqué à 200 car. n'est plus valide");
});

test("contact-form : pot de miel rempli → réponse ok mais rien stocké", async () => {
  const ctx = formCtx();
  const res = await def.routes.send(post({ ...ok, website: "http://spam.test" }), ctx);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(ctx.saved.length, 0);
});

test("contact-form : limite de 5 messages par heure et par IP (429 ensuite), les autres IP passent", async () => {
  const ctx = formCtx();
  const ip = freshIp();
  const statuses = [];
  for (let i = 0; i < 7; i++) statuses.push((await def.routes.send(post(ok, { ip }), ctx)).status);
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429, 429]);
  assert.equal(ctx.saved.length, 5);
  assert.equal((await def.routes.send(post(ok, { ip: freshIp() }), ctx)).status, 200);
});

test("contact-form : première IP de x-forwarded-for prise en compte, absence d'en-tête → « local »", async () => {
  const ctx = formCtx();
  const a = freshIp();
  for (let i = 0; i < 5; i++) await def.routes.send(post(ok, { ip: `${a}, 1.1.1.1` }), ctx);
  assert.equal((await def.routes.send(post(ok, { ip: `${a}, 2.2.2.2` }), ctx)).status, 429);
  const fd = new FormData(); for (const [k, v] of Object.entries(ok)) fd.set(k, v);
  const res = await def.routes.send(new Request("https://x.test/s", { method: "POST", body: fd }), ctx);
  assert.ok([200, 429].includes(res.status));
});

test("contact-form : erreurs sans fuite (corps JSON minimal, aucun détail ni donnée saisie)", async () => {
  const ctx = formCtx();
  const res = await def.routes.send(post({ ...ok, email: "secret-pas-un-email" }), ctx);
  const txt = await res.text();
  assert.equal(txt, JSON.stringify({ ok: false }));
});

test("contact-form : corps non-formulaire (JSON) → ne doit pas planter la route", async () => {
  const ctx = formCtx();
  const req = new Request("https://x.test/s", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": freshIp() }, body: "{}" });
  const res = await def.routes.send(req, ctx);
  assert.equal(res.status, 400);
});

test("contact-form : le texte malveillant est transmis tel quel (donnée) — le module n'a plus de rendu à lui", async () => {
  const ctx = formCtx();
  const evil = `<script>alert(1)</script>`;
  await def.routes.send(post({ name: evil, email: "a@b.co", message: evil }), ctx);
  assert.equal(ctx.saved[0].message, evil);
  assert.equal(def.adminPanel, undefined, "plus de panneau d'admin : les messages sont dans le carnet de contacts");
});

test("contact-form : slot entry.bottom seulement sur la page choisie", () => {
  const slot = def.slots["entry.bottom"];
  assert.equal(slot(fakeCtx({ settings: {} })), null);
  assert.equal(slot(Object.assign(fakeCtx({ settings: { pageSlug: "contact" } }), { entry: { slug: "autre" } })), null);
  assert.equal(slot(fakeCtx({ settings: { pageSlug: "contact" } })), null, "pas d'entrée courante");
  const out = slot(Object.assign(fakeCtx({ settings: { pageSlug: "contact" }, key: "cf" }), { entry: { slug: "contact" } }));
  assert.equal(out.length, 1);
  assert.equal(out[0].type, "form");
});

test("contact-form : formulaire — action relative à l'instance, 3 champs requis, libellés traduits", () => {
  const ctx = fakeCtx({ key: "contact", messages: { send: "Envoyer", sent: "Merci", name: "Nom", email: "Email", message: "Message" } });
  const [f] = def.sections.form(ctx);
  assert.equal(f.type, "form");
  assert.equal(f.action, "contact/send");
  assert.equal(f.submitLabel, "Envoyer");
  assert.equal(f.successText, "Merci");
  assert.deepEqual(f.fields.map((x) => [x.name, x.required, x.kind]), [["name", true, undefined], ["email", true, "email"], ["message", true, "textarea"]]);
  assert.ok(!f.fields.some((x) => x.name === "website"), "le pot de miel n'est pas un champ déclaré (rendu par le cœur)");
});

test("contact-form : prévient le propriétaire par e-mail, en répondant à l'expéditeur, sans jamais perdre le message", async () => {
  const ctx = formCtx({ messages: { mailSubject: "Nouveau message de {name}", mailBody: "{name} <{email}> a écrit :" } });
  const res = await def.routes.send(post(ok), ctx);
  assert.equal(res.status, 200);
  assert.equal(ctx.calls.mail.length, 1);
  const mail = ctx.calls.mail[0];
  assert.deepEqual([mail.to, mail.replyTo, mail.subject], ["owner", "alice@example.org", "Nouveau message de Alice"]);
  assert.match(mail.text, /Alice <alice@example.org> a écrit :\n\nBonjour/);
  assert.equal((await messagesOf(ctx)).length, 1);
});

test("contact-form : panne ou absence de serveur d'e-mail → le message est quand même conservé et la réponse reste positive", async () => {
  const ctx = formCtx({ mailResult: { ok: false, reason: "not_configured" } });
  assert.equal((await def.routes.send(post(ok), ctx)).status, 200);
  assert.equal((await messagesOf(ctx)).length, 1);
});

test("contact-form : option « me prévenir » décochée → aucun e-mail ; messages invalides ou pièges à robots → aucun e-mail", async () => {
  const off = formCtx({ settings: { notify: false } });
  await def.routes.send(post(ok), off);
  assert.equal(off.calls.mail.length, 0);
  const ctx = formCtx();
  await def.routes.send(post({ ...ok, email: "mauvais" }), ctx);
  await def.routes.send(post({ ...ok, website: "http://spam" }), ctx);
  assert.equal(ctx.calls.mail.length, 0);
});

test("contact-form : la permission « mail » est déclarée et l'option est activée par défaut", async () => {
  const m = await assertValidManifest(manifest);
  assert.ok(m.permissions.includes("mail"));
  const notify = m.settings.find((s) => s.key === "notify");
  assert.deepEqual([notify.type, notify.default], ["boolean", true]);
});

test("contact-form : le message part vers le service avec son origine ; sans carnet disponible → 503, rien annoncé, aucun e-mail", async () => {
  const ctx = formCtx();
  await def.routes.send(post(ok), ctx);
  assert.deepEqual(ctx.calls.services[0], ["contact.store", "add", { ...ok, source: "contact-form" }]);
  const none = fakeCtx();   // aucun fournisseur
  const res = await def.routes.send(post(ok), none);
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { ok: false });
  assert.equal(none.calls.mail.length, 0, "message non conservé : pas de faux espoir par e-mail");
});
