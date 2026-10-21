// Contacts (lot K2) — RGPD : « tout ce que le site sait de cette personne » (la fiche + ce que chaque module garde, par les appels bornés de `privacy.subject`)
// et l'effacement avec un bilan clair, module par module, et une confirmation en clair.
import test from "node:test";
import assert from "node:assert/strict";
import { fakePrivacySubject } from "./helpers/fakeContactBook.mjs";
import { makeCtx, def, B, PV, svc, htmlOf, textOf, plain, collect } from "./helpers/contactsK2.mjs";

const mute = (name = "Module muet") => ({ instance: "mute-one", name, methods: { erase: () => new Promise(() => {}), remap: () => new Promise(() => {}), export: () => new Promise(() => {}) } });
const json = async (ctx, id) => JSON.parse((await collect(def.adminDownloads.person.generate(ctx, { id }))).join(""));

async function personWithData(ctx) {
  const r = await svc.create(ctx, { name: "Camille Privée", email: "camille@example.test", phone: "+33 1 23 45 67 89", organisation: "Acme", role: "CTO", relation: "Amie" });
  await B.addAccount(ctx, { id: r.id, network: "twitch", handle: "camille_live" });
  await svc.note(ctx, { id: r.id, text: "Aime les chats.", author: "admin" });
  await svc.note(ctx, { id: r.id, text: "Allergique aux noix.", author: "partnerships" });
  return r.id;
}

test("export d'une personne : la fiche (avec e-mail et téléphone si le droit est là), ses notes, puis ce que chaque module garde — un fichier JSON valide", async () => {
  const raid = fakePrivacySubject("raid-like", { label: "Raid" });
  const story = fakePrivacySubject("story-like", { label: "Story" });
  const ctx = makeCtx({ subjects: [raid, story] });
  const id = await personWithData(ctx);
  raid.refs.set(id, 2); story.refs.set(id, 1);
  const out = await json(ctx, id);
  assert.equal(out.contacts.name, "Camille Privée");
  assert.equal(out.contacts.email, "camille@example.test");
  assert.equal(out.contacts.phone, "+33 1 23 45 67 89");
  assert.deepEqual(out.contacts.notes.map((n) => n.text), ["Aime les chats.", "Allergique aux noix."]);
  assert.deepEqual(out.contacts.accounts.map((a) => `${a.network}:${a.handle}`), ["twitch:camille_live"]);
  assert.equal(out.contacts.organisation, "Acme");
  assert.deepEqual(out.modules.map((m) => [m.module, m.ok]).sort(), [["raid-like", true], ["story-like", true]].sort());
  assert.ok(out.modules.every((m) => typeof m.label === "string" && m.data !== undefined));
  assert.ok(out.generatedAt);
  // Sans le droit « voir les e-mails et téléphones » : ni l'un ni l'autre dans le fichier.
  const limited = makeCtx({ subjects: [raid], store: ctx.api.store, rights: ["export"] });
  limited.instance = ctx.instance;
  const lim = await json(limited, id);
  assert.ok(!("email" in lim.contacts) && !("phone" in lim.contacts));
  assert.ok(!JSON.stringify(lim).includes("camille@example.test"));
  assert.equal(def.adminDownloads.person.contentType, "application/json");
  assert.equal((await json(ctx, "nope")).error, "not_found");
  assert.equal(JSON.parse((await collect(def.adminDownloads.person.generate(ctx, {}))).join("")).error, "not_found", "paramètre absent ou absurde : rien à exporter");
});

test("export : un module muet est listé « n'a pas répondu » sans retarder les autres ; une réponse trop grosse est refusée ; un module absent ne gêne pas", async () => {
  const good = fakePrivacySubject("good-one");
  const big = { instance: "big-one", name: "Gros", methods: { export: () => ({ label: "Big", data: "x".repeat(PV.MODULE_EXPORT_MAX + 10) }), erase: () => ({ removed: 0 }), remap: () => ({ updated: 0 }) } };
  const ctx = makeCtx({ subjects: [good, mute(), big], test: { privacyTimeoutMs: 80 } });
  const id = await personWithData(ctx);
  const t = Date.now();
  const out = await json(ctx, id);
  assert.ok(Date.now() - t < 1500, "borné par module (tous en parallèle)");
  const by = Object.fromEntries(out.modules.map((m) => [m.module, m]));
  assert.equal(by["good-one"].ok, true);
  assert.deepEqual([by["mute-one"].ok, by["mute-one"].timeout], [false, true]);
  assert.deepEqual([by["big-one"].ok, by["big-one"].tooLarge], [false, true]);
  const none = makeCtx({ subjects: [] });
  const i2 = await personWithData(none);
  assert.deepEqual((await json(none, i2)).modules, []);
});

test("effacement : la confirmation se fait en clair (case à cocher), chaque module efface, la fiche et ses notes disparaissent, le bilan dit ce que chaque module a fait", async () => {
  const raid = fakePrivacySubject("raid-like", { label: "Raid" });
  const story = fakePrivacySubject("story-like", { label: "Story" });
  const ctx = makeCtx({ locale: "fr", subjects: [raid, story] });
  const id = await personWithData(ctx);
  raid.refs.set(id, 3);
  const page = await def.adminPanel(ctx, { query: { contact: id, erase: "1" } });
  assert.match(htmlOf(page), /Effacer Camille Privée partout/);
  assert.match(plain(page), /C'est définitif : il n'y a pas de retour en arrière\./);
  assert.match(htmlOf(page), /<li>raid-like<\/li>|<li>Raid/, "les modules concernés sont nommés");
  assert.ok(page.some((b) => b.type === "download" && b.name === "person" && b.params.id === id), "on peut télécharger ses données avant");
  const form = page.find((b) => b.action === "erase");
  assert.deepEqual(form.fields.map((f) => [f.name, f.kind]), [["id", "hidden"], ["confirm", "checkbox"]]);
  assert.equal(form.fields[1].label, "Oui, je veux effacer Camille Privée partout, définitivement.");
  // Sans cocher : l'erreur est SOUS la case, rien n'est effacé.
  assert.deepEqual((await def.adminActions.erase(ctx, { id, confirm: "" })).errors, { confirm: "Cochez la case pour confirmer : l'effacement est définitif." });
  assert.equal((await svc.get(ctx, { id })).ok, true);
  assert.equal(raid.refs.get(id), 3);
  const r = await def.adminActions.erase(ctx, { id, confirm: "on" });
  assert.equal(r.ok, "Fiche supprimée.");
  assert.equal(r.redirect, "?view=erased");
  assert.equal((await svc.get(ctx, { id })).ok, false);
  assert.equal(raid.refs.has(id), false);
  assert.equal(await ctx.api.store.count("notes"), 0, "les notes disparaissent avec la fiche");
  // Le bilan, module par module — sans le nom de la personne.
  const bilan = plain(await def.adminPanel(ctx, { query: { view: "erased" } }));
  assert.match(bilan, /raid-like : 3 références effacées\./);
  assert.match(bilan, /story-like : rien à effacer\./);
  assert.ok(!bilan.includes("Camille"), "le bilan ne garde pas le nom de la personne effacée");
  assert.ok(!JSON.stringify(await ctx.api.store.page("reports", {})).includes("Camille"));
});

test("effacement : un module muet est dit « n'a pas répondu à temps » (page de bilan et message) ; l'effacement n'est jamais bloqué ; 20 bilans gardés au plus", async () => {
  const good = fakePrivacySubject("good-one");
  const ctx = makeCtx({ locale: "fr", subjects: [good, mute("Partenariats muet")], test: { privacyTimeoutMs: 60 } });
  const id = await personWithData(ctx);
  good.refs.set(id, 1);
  const t = Date.now();
  const r = await def.adminActions.erase(ctx, { id, confirm: "1" });
  assert.ok(Date.now() - t < 1500);
  assert.equal(r.ok, "Fiche supprimée. N'a pas répondu à temps : Partenariats muet (sa référence est peut-être restée).");
  const page = await def.adminPanel(ctx, { query: { view: "erased" } });
  assert.match(plain(page), /Partenariats muet : n'a pas répondu à temps \(sa référence est peut-être restée\)\./);
  assert.match(plain(page), /good-one : 1 référence effacée\./);
  assert.ok(page.some((b) => b.type === "banner" && b.tone === "warning"), "un avertissement quand un module n'a pas répondu");
  for (let i = 0; i < 25; i++) { const x = await svc.create(ctx, { name: `Temp ${i}` }); await PV.erasePerson(ctx, x.id); }
  assert.equal((await PV.reports(ctx)).length, 20);
  assert.match(textOf(await def.adminPanel(makeCtx({ locale: "en" }), { query: { view: "erased" } })), /No erasure yet\./);
});

test("fiche : section « Données personnelles » (télécharger tout ce que le site sait, effacer partout) ; le service `erase` du contrat garde son comportement", async () => {
  const ctx = makeCtx({ locale: "fr" });
  const id = await personWithData(ctx);
  const blocks = await def.adminPanel(ctx, { query: { contact: id } });
  const all = textOf(blocks);
  assert.match(all, /Données personnelles/);
  assert.ok(blocks.some((b) => b.type === "download" && b.name === "person" && b.params.id === id && b.label === "Télécharger tout ce que le site sait de cette personne"));
  assert.match(htmlOf(blocks), new RegExp(`href="\\?contact=${id}&amp;erase=1"[^>]*>Effacer cette personne partout…`));
  assert.deepEqual(await svc.erase(ctx, { id, confirm: false }), { ok: false, error: "confirm_required" });
  const r = await svc.erase(ctx, { id, confirm: true });
  assert.equal(r.ok, true);
  assert.deepEqual(await svc.erase(ctx, { id, confirm: true }), { ok: false, error: "not_found" });
});
