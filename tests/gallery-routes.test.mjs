// Galeries photos : les routes publiques (service des images, demande de retrait) : confidentialité, protections, redirections, services facultatifs.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { def, ctxFor, makeAlbum, data, rows, post, get, json } from "./helpers/galleryKit.mjs";

const remove = (ctx, fields, opts) => def.routes.removal(post("removal", fields, opts), ctx);

test("plus de route d'image : les photos sont servies par le cœur (/uploads/…), la seule route du module est la demande de retrait", () => {
  assert.deepEqual(Object.keys(def.routes), ["removal"]);
});

// ── Demande de retrait ───────────────────────────────────────────────────────────────────────────────────────────────

test("retrait : photo choisie sur le site + message ; la demande est gardée avec un libellé lisible, sans adresse ni empreinte", async () => {
  const ctx = ctxFor();
  const a = await makeAlbum(ctx, { n: 3 });
  const res = await remove(ctx, { album: a.id, photo: a.photos[1], message: "Je suis à gauche sur cette photo, merci de la retirer.", contact: "" }, { headers: json });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  const [r] = rows(ctx, "gallery_requests");
  assert.equal(r.album, a.id);
  assert.equal(r.photo, a.photos[1]);
  assert.equal(r.label, "Soirée de printemps #2");
  assert.equal(r.status, "new");
  assert.doesNotMatch(JSON.stringify(r), /203\.0\.113|forwarded|fingerprint/);
});

test("retrait : sans JavaScript, le navigateur est ramené sur une page du module (jamais une adresse reçue)", async () => {
  const ctx = ctxFor();
  const a = await makeAlbum(ctx, { n: 1 });
  const ok = await remove(ctx, { album: a.id, photo: a.photos[0], message: "Merci de la retirer s'il vous plaît.", next: "https://evil.example.net/", redirect: "//evil.example.net" });
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get("location"), "/galeries/retrait/merci");
  const bad = await remove(ctx, { album: a.id, photo: a.photos[0], message: "x" });
  assert.equal(bad.status, 303);
  assert.equal(bad.headers.get("location"), "/galeries/retrait/erreur");
  assert.equal(rows(ctx, "gallery_requests").length, 1);
});

test("retrait : le champ piège répond « merci » sans rien garder ; message trop court ou rempli de liens, photo non désignée : refusés", async () => {
  const ctx = ctxFor();
  const a = await makeAlbum(ctx, { n: 1 });
  const trap = await remove(ctx, { album: a.id, photo: a.photos[0], message: "Un vrai message assez long.", website: "https://spam.example.net" }, { headers: json });
  assert.equal(trap.status, 200);
  assert.equal(rows(ctx, "gallery_requests").length, 0);
  let n = 100;
  for (const fields of [
    { album: a.id, photo: a.photos[0], message: "ok" },
    { album: a.id, photo: a.photos[0], message: "https://a.example.net https://b.example.net https://c.example.net" },
    { message: "Un message assez long mais aucune photo." },
    { which: "x", message: "Un message assez long." },
    {},
  ]) {
    const res = await remove(ctx, fields, { headers: json, ip: `198.51.100.${++n}` });
    assert.equal(res.status, 400, JSON.stringify(fields));
    assert.equal((await res.json()).ok, false);
  }
  assert.equal(rows(ctx, "gallery_requests").length, 0);
});

test("retrait : une photo décrite par la personne est acceptée ; une photo masquée ou d'un brouillon ne peut pas être désignée par identifiant", async () => {
  const ctx = ctxFor();
  const a = await makeAlbum(ctx, { n: 2, hidden: [1] });
  const d = await makeAlbum(ctx, { title: "Brouillon", n: 1, status: "draft" });
  const free = await remove(ctx, { which: "Fête d'été, photo 12", message: "Merci de la retirer, je suis dessus." }, { headers: json });
  assert.equal(free.status, 200);
  assert.equal(rows(ctx, "gallery_requests")[0].album, "");
  assert.equal(rows(ctx, "gallery_requests")[0].label, "Fête d'été, photo 12");
  const hid = await remove(ctx, { album: a.id, photo: a.photos[1], message: "Merci de la retirer, je suis dessus." }, { headers: json });
  assert.equal(hid.status, 400, "ni identifiant utile ni description : refusée");
  const draft = await remove(ctx, { album: d.id, photo: d.photos[0], message: "Merci de la retirer, je suis dessus." }, { headers: json });
  assert.equal(draft.status, 400);
});

test("retrait : taille bornée, limite par visiteur et par heure (429), autre visiteur non touché, plafond de demandes en attente (503)", async () => {
  const ctx = ctxFor({ removalLimit: 3 });
  const a = await makeAlbum(ctx, { n: 1 });
  const fields = (i) => ({ album: a.id, photo: a.photos[0], message: `${"Un message très long. ".repeat(500)} ${i}`, contact: "x".repeat(900) });
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await remove(ctx, fields(i), { ip: "198.51.100.1", headers: json })).status);
  assert.deepEqual(codes, [200, 200, 200, 429, 429]);
  for (const r of rows(ctx, "gallery_requests")) { assert.ok(r.message.length <= 1000); assert.ok(r.contact.length <= 120); }
  assert.equal((await remove(ctx, fields(9), { ip: "198.51.100.2", headers: json })).status, 200);
  const busy = ctxFor({ removalLimit: 30 });
  const b = await makeAlbum(busy, { n: 1 });
  let accepted = 0;
  for (let i = 0; i < 40; i++) if ((await remove(busy, { album: b.id, photo: b.photos[0], message: `Message numéro ${i} assez long` }, { ip: "198.51.100.5", headers: json })).status === 200) accepted++;
  assert.equal(accepted, 30);
  const full = ctxFor({ removalLimit: 30 });
  const c = await makeAlbum(full, { n: 1 });
  for (let i = 0; i < 200; i++) await full.api.store.add("gallery_requests", { album: c.id, photo: c.photos[0], label: "x", message: "m", at: new Date().toISOString(), status: "new" });
  const over = await remove(full, { album: c.id, photo: c.photos[0], message: "Encore une demande assez longue." }, { ip: "198.51.100.9", headers: json });
  assert.equal(over.status, 503);
  assert.equal(rows(full, "gallery_requests").length, 200);
});

test("retrait : GET refusé (405), formulaire coupé : introuvable, corps qui n'est pas un formulaire : 400", async () => {
  const ctx = ctxFor();
  assert.equal((await def.routes.removal(get("removal"), ctx)).status, 405);
  assert.equal((await def.routes.removal(new Request("https://example.org/m/x/removal", { method: "PUT" }), ctx)).status, 405);
  const off = ctxFor({ removal: false });
  assert.equal((await remove(off, { message: "Un message assez long." })).status, 404);
  const garbage = new Request("https://example.org/m/x/removal", { method: "POST", headers: { "content-type": "text/plain", accept: "application/json" }, body: "n'importe quoi" });
  assert.equal((await def.routes.removal(garbage, ctx)).status, 400);
});

test("retrait : les demandes trop anciennes s'effacent d'elles-mêmes (non traitées 90 jours au plus, traitées 30 jours), sans minuteur de fond", async () => {
  const ctx = ctxFor({ retentionDays: 90 });
  const a = await makeAlbum(ctx, { n: 1 });
  const day = 86_400_000;
  const add = (over) => ctx.api.store.add("gallery_requests", { album: a.id, photo: a.photos[0], label: "x", message: "m", status: "new", at: new Date().toISOString(), ...over });
  await add({ at: new Date(Date.now() - 100 * day).toISOString() });
  await add({ at: new Date(Date.now() - 10 * day).toISOString() });
  await add({ status: "done", at: new Date(Date.now() - 100 * day).toISOString(), handledAt: new Date(Date.now() - 31 * day).toISOString() });
  await add({ status: "done", at: new Date(Date.now() - 100 * day).toISOString(), handledAt: new Date(Date.now() - 5 * day).toISOString() });
  assert.equal(await data.purgeRequests(ctx), 2);
  assert.equal(rows(ctx, "gallery_requests").length, 2);
  assert.equal(data.retentionDays(ctxFor({ retentionDays: 9999 })), 90);
});

// ── Services facultatifs : carnet d'adresses et e-mail ───────────────────────────────────────────────────────────────

test("carnet d'adresses : une demande avec un e-mail y est copiée ; sans e-mail, rien n'est copié ; réglage coupé : rien", async () => {
  const calls = [];
  const services = { "contact.store": { add: async (args) => { calls.push(args); return { id: "c1", created: true }; } } };
  const ctx = ctxFor({}, { services });
  const a = await makeAlbum(ctx, { n: 1 });
  await remove(ctx, { album: a.id, photo: a.photos[0], message: "Je suis sur cette photo, merci.", contact: "jeanne@example.org" }, { headers: json });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].email, "jeanne@example.org");
  assert.equal(calls[0].name, "Demande de retrait de photo");
  assert.equal(calls[0].source, "contact-form");
  assert.match(calls[0].message, /Soirée de printemps #1/);
  assert.match(calls[0].message, /Je suis sur cette photo/);
  await remove(ctx, { album: a.id, photo: a.photos[0], message: "Sans courrier mais assez long.", contact: "pas un e-mail" }, { headers: json, ip: "198.51.100.3" });
  assert.equal(calls.length, 1);
  const off = ctxFor({ forwardToContacts: false }, { services });
  const b = await makeAlbum(off, { n: 1 });
  await remove(off, { album: b.id, photo: b.photos[0], message: "Je suis sur cette photo, merci.", contact: "jeanne@example.org" }, { headers: json });
  assert.equal(calls.length, 1);
});

test("carnet d'adresses : absent, en panne, illisible ou lent : la demande est gardée et la réponse part quand même", async () => {
  const fields = (a) => ({ album: a.id, photo: a.photos[0], message: "Je suis sur cette photo, merci.", contact: "jeanne@example.org" });
  for (const [name, services] of [
    ["absent", {}],
    ["en panne", { "contact.store": { add: async () => { throw new Error("base fermée"); } } }],
    ["réponse illisible", { "contact.store": { add: async () => "n'importe quoi" } }],
    ["sans méthode", { "contact.store": {} }],
  ]) {
    const ctx = ctxFor({}, { services });
    const a = await makeAlbum(ctx, { n: 1 });
    const res = await remove(ctx, fields(a), { headers: json });
    assert.equal(res.status, 200, name);
    assert.equal(rows(ctx, "gallery_requests").length, 1, name);
    assert.equal(rows(ctx, "gallery_requests")[0].contact, "jeanne@example.org", name);
  }
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const ctx = ctxFor({}, { services: { "contact.store": { add: () => new Promise(() => {}) } } });
    const a = await makeAlbum(ctx, { n: 1 });
    const pending = remove(ctx, fields(a), { headers: json });
    for (let i = 0; i < 50; i++) { await new Promise((resolve) => setImmediate(resolve)); mock.timers.tick(100); } // 5 s simulées, pendant que les promesses avancent
    const res = await pending;
    assert.equal(res.status, 200, "lent : on n'attend pas plus de quelques secondes");
    assert.equal(rows(ctx, "gallery_requests").length, 1);
  } finally { mock.timers.reset(); }
});

test("e-mail à l'équipe : un seul toutes les 6 heures, jamais le contact du visiteur, pas de panne visible", async () => {
  const ctx = ctxFor();
  const a = await makeAlbum(ctx, { n: 1 });
  const send = (i) => remove(ctx, { album: a.id, photo: a.photos[0], message: `Merci de la retirer ${i}, je suis dessus.`, contact: "jeanne@example.org" }, { headers: json, ip: `198.51.100.${10 + i}` });
  await send(1);
  await send(2);
  assert.equal(ctx.calls.mail.length, 1);
  assert.equal(ctx.calls.mail[0].to, "owner");
  assert.doesNotMatch(JSON.stringify(ctx.calls.mail[0]), /jeanne@example\.org/);
  assert.match(ctx.calls.mail[0].text, /\/admin\/instances\/id-gal\d+\?tab=requests/);
  const quiet = ctxFor({ notify: false });
  const b = await makeAlbum(quiet, { n: 1 });
  await remove(quiet, { album: b.id, photo: b.photos[0], message: "Merci de la retirer, je suis dessus." }, { headers: json });
  assert.equal(quiet.calls.mail.length, 0);
  const broken = ctxFor({}, { mailResult: undefined });
  broken.api.mail.send = async () => { throw new Error("serveur d'e-mail absent"); };
  const c = await makeAlbum(broken, { n: 1 });
  assert.equal((await remove(broken, { album: c.id, photo: c.photos[0], message: "Merci de la retirer, je suis dessus." }, { headers: json })).status, 200);
});
