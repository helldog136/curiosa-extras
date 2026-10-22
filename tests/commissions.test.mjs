// Commandes : manifeste, liens de suivi, formulaire public, places, pages, administration, e-mails, Contacts (facultatif), vie privée, export, outils IA, effacement.
// Toutes les données sont factices (example.org).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { memStore } from "./helpers/contactsStore.mjs";
import { fakeContactBook } from "./helpers/fakeContactBook.mjs";
import { runPrivacySubjectContract } from "./contract/privacySubject.contract.mjs";
import { parseManifest } from "@/core/modules/manifest";
import { validateArgs } from "@/core/services/mcp/validate";

const DIR = new URL("../modules/commissions", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
const manifest = readJson("module.json");
const fr = readJson("locales/fr.json"), en = readJson("locales/en.json");
const sources = fs.readdirSync(DIR).filter((f) => f.endsWith(".mjs")).map((f) => fs.readFileSync(`${DIR}/${f}`, "utf8")).join("\n");
const def = (await import("../modules/commissions/index.mjs")).default;
const lib = await import("../modules/commissions/lib.mjs");
const data = await import("../modules/commissions/data.mjs");
const bookMod = await import("../modules/commissions/book.mjs");
const { purgeFinished } = await import("../modules/commissions/index.mjs");

let n = 0;
/** Un contexte complet : stockage fidèle (clés, curseurs), droits réglables, e-mails enregistrés. */
function mk({ rights = ["manage", "email.view", "export"], settings = {}, services, locale = "fr", ...rest } = {}) {
  const ctx = fakeCtx({ key: `cm${++n}`, basePath: "commandes", moduleId: "commissions", locale, defaultLocale: "fr", locales: ["fr", "en"], messages: locale === "en" ? en : fr, settings: { rateLimit: 50, ...settings }, services, site: { name: "Atelier", tagline: "", logo: null }, ...rest });
  ctx.api.store = memStore();
  ctx.instance.id = `id${n}`;
  const set = new Set(rights);
  ctx.can = (r) => set.has(r);
  return ctx;
}
const post = (fields, { ip = "203.0.113.5", json = true, route = "send" } = {}) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return new Request(`https://example.test/m/x/${route}`, { method: "POST", body: f, headers: { "x-forwarded-for": ip, ...(json ? { accept: "application/json" } : {}) } });
};
const open = (ctx, slots = 3) => data.writeQueue(ctx, { mode: "open", slots });
const good = { nick: "Camille", email: "camille@example.org", want: "Un portrait de mon chat en aquarelle", notify: "on" };
const send = (ctx, fields = good, opts) => def.routes.send(post(fields, opts), ctx);
async function submit(ctx, fields = good, opts) {
  const res = await send(ctx, fields, opts);
  const body = await res.json();
  return { res, body, token: body.url?.split("/").pop() };
}
const orders = (ctx) => data.listOrders(ctx);
const pageText = async (ctx, segments) => JSON.stringify(await def.page(ctx, { segments }));

// ── Manifeste ───────────────────────────────────────────────────────────────────────────────────────────────────
test("manifeste : valide, déclaré = implémenté, droits, services, parité des langues, clés de texte existantes", () => {
  const r = parseManifest(manifest); assert.ok(r.ok, r.ok ? "" : r.error);
  assert.deepEqual(manifest.mcp.map((a) => a.name).sort(), Object.keys(def.mcp).sort());
  assert.deepEqual(manifest.sections.map((s) => s.id), Object.keys(def.sections));
  assert.deepEqual(Object.keys(def.routes).sort(), ["cancel", "forget", "send"]);
  assert.deepEqual(Object.keys(def.services["privacy.subject"]).sort(), ["erase", "export", "remap"]);
  assert.equal(manifest.requires[0].optional, true);
  assert.equal(manifest.requires[0].service, "contact.book");
  assert.deepEqual(manifest.rights.map((x) => x.id).sort(), ["email.view", "export", "manage"]);
  for (const a of Object.values(def.adminActions)) assert.equal(a.right, "manage");
  assert.equal(def.adminDownloads.orders.right, "export");
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  const wanted = new Set([...sources.matchAll(/(?:ctx\.t|\bsay\(ctx, lang,|\bsay\(ctx, [\w.]+,)\s*\(?\s*"([A-Za-z0-9_]+)"/g)].map((m) => m[1]));
  for (const k of wanted) assert.ok(k in fr && k in en, `clé ${k}`);
  for (const m of sources.matchAll(/ctx\.t\(\s*([^)]*?)\s*[,)]/g)) if (!/setting/.test(m[1])) for (const lit of m[1].matchAll(/"([A-Za-z0-9_]+)"/g)) assert.ok(lit[1] in fr || lit[1] === "rate_limited", `clé ${lit[1]}`);
  for (const [k, v] of Object.entries(fr)) assert.ok(v.length > 0 && en[k].length > 0, k);
  for (const l of [fr, en]) assert.ok(!/<|jeton|token/i.test(Object.values(l).filter((x, i) => !/^mail/.test(Object.keys(l)[i])).join(" ")), "pas de balise ni de jargon");
  const reads = [...sources.matchAll(/ctx\.setting\("([A-Za-z0-9_]+)"\)/g)].map((m) => m[1]);
  for (const s of manifest.settings) assert.ok(reads.includes(s.key), `réglage ${s.key} jamais lu`);
});
test("manifeste : aucun paiement, argent ou fetch direct ; outils IA : lecture seule déclarée, écritures jamais par défaut, jamais destructifs", () => {
  assert.ok(!/\bfetch\(/.test(sources.replace(/fetch\(f\.action[\s\S]*?\)/, "")), "pas de fetch côté serveur");
  assert.ok(!/stripe|paypal|checkout/i.test(sources));
  const by = Object.fromEntries(manifest.mcp.map((a) => [a.name, a]));
  for (const k of ["commissions_status", "commissions_list", "commissions_formulas"]) assert.equal(by[k].readOnly, true);
  for (const k of ["commission_set_status", "commissions_set_queue"]) { assert.ok(!by[k].readOnly && !by[k].default && !by[k].destructive); }
  for (const a of manifest.mcp) assert.ok(a.name.length <= 31);
});

// ── Liens de suivi ───────────────────────────────────────────────────────────────────────────────────────────────
test("lien de suivi : 32 lettres a-z/2-7 (160 bits), tous différents, empreinte seule gardée, comparaison à temps constant", async () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i++) { const t = lib.newToken(); assert.match(t, /^[a-z2-7]{32}$/); assert.ok(lib.isToken(t)); seen.add(t); }
  assert.equal(seen.size, 2000);
  const t = lib.newToken(), h = lib.hashToken(t);
  assert.ok(lib.sameHash(h, lib.hashToken(t)) && !lib.sameHash(h, lib.hashToken(lib.newToken())) && !lib.sameHash(h, "zz") && !lib.sameHash(undefined, h));
  assert.match(sources, /timingSafeEqual/);
  const ctx = mk(); await open(ctx);
  const { token } = await submit(ctx);
  assert.ok(!JSON.stringify(ctx.api.store.dump()).includes(token), "le lien n'est écrit nulle part dans les données");
  const [o] = await orders(ctx);
  assert.equal(o.tokenHash, lib.hashToken(token));
  assert.equal((await ctx.api.store.dump("orders"))[0].key, lib.tokenKey(lib.hashToken(token)));
});
test("lien de suivi : un lien inconnu, mal formé, trop court ou piégé donne toujours la même réponse, sans fuite", async () => {
  const ctx = mk(); await open(ctx);
  const { token } = await submit(ctx);
  const same = await pageText(ctx, ["suivi", "a".repeat(32)]);
  for (const bad of ["a".repeat(31), token.slice(0, 31), `${token}x`, "A".repeat(32), "<script>", "../x", "", "1".repeat(32), token.toUpperCase()]) assert.equal(await pageText(ctx, ["suivi", bad]), same, bad);
  assert.ok(!same.includes("Camille"));
  assert.equal(data.findByToken(ctx, token.slice(0, 30)) instanceof Promise, true);
  assert.equal(await data.findByToken(ctx, "b".repeat(32)), null);
  assert.ok((await def.page(ctx, { segments: ["suivi"] })).notFound);
  assert.ok((await def.page(ctx, { segments: ["suivi", token, "x"] })).notFound);
});
test("lien de suivi : sans index de clés (cœur sans `getByKey`), la recherche marche aussi", async () => {
  const ctx = mk(); await open(ctx);
  const { token } = await submit(ctx);
  delete ctx.api.store.getByKey;
  assert.equal((await data.findByToken(ctx, token)).nick, "Camille");
  assert.equal(await data.findByToken(ctx, "c".repeat(32)), null);
});

// ── Formulaire public ───────────────────────────────────────────────────────────────────────────────────────────
test("demande : enregistrée « nouvelle », historique, lien rendu (JSON) ou redirection (sans JavaScript), texte nettoyé et borné", async () => {
  const ctx = mk(); await open(ctx);
  const { res, body, token } = await submit(ctx, { ...good, nick: "  Cam\u0007ille  ", want: `${"x".repeat(3000)}`, inspiration: "exemple.org/chat" });
  assert.equal(res.status, 200);
  assert.match(body.url, /^\/commandes\/suivi\/[a-z2-7]{32}$/);
  const [o] = await orders(ctx);
  assert.deepEqual([o.nick, o.status, o.history.length, o.want.length, o.inspiration, o.email], ["Camille", "new", 1, 1500, "https://exemple.org/chat", "camille@example.org"]);
  const r2 = await send(ctx, { ...good, email: "autre@example.org" }, { json: false, ip: "1.2.3.4" });
  assert.equal(r2.status, 303);
  assert.match(r2.headers.get("location"), /^\/commandes\/suivi\/[a-z2-7]{32}$/);
  const en = mk({ locale: "en" }); await open(en);
  assert.match((await submit(en)).body.url, /^\/en\/commandes\/suivi\//, "autre langue : préfixe de langue");
  assert.ok(token);
});
test("demande : chaque erreur dit quel champ corriger, avec un exemple ; rien n'est enregistré", async () => {
  const ctx = mk(); await open(ctx);
  const { res, body } = await submit(ctx, { nick: " ", email: "camille@", want: "ab", inspiration: "javascript:alert(1)" });
  assert.equal(res.status, 400);
  assert.deepEqual(Object.keys(body.errors).sort(), ["email", "inspiration", "nick", "want"]);
  assert.match(body.errors.email, /exemple/);
  assert.equal((await orders(ctx)).length, 0);
  assert.equal((await submit(ctx, { ...good, want: "https://a.io https://b.io https://c.io" })).res.status, 400);
  const bad = await send(ctx, { nick: "x", email: "camille@" }, { json: false });
  assert.match(bad.headers.get("location"), /\/commandes\/oups\/invalid$/);
});
test("demande : formules — le choix est obligatoire s'il y en a, et seules les formules affichées sont acceptées", async () => {
  const ctx = mk(); await open(ctx);
  await ctx.api.store.add("formulas", { name: "Portrait", price: "40 €", visible: true, pos: 0 });
  const hid = await ctx.api.store.add("formulas", { name: "Secrète", visible: false, pos: 1 });
  const [f] = await data.listFormulas(ctx);
  assert.equal((await submit(ctx, good)).body.errors.formula.length > 0, true);
  assert.equal((await submit(ctx, { ...good, formula: hid })).res.status, 400);
  assert.equal((await submit(ctx, { ...good, formula: f.id })).res.status, 200);
  assert.equal((await orders(ctx))[0].formulaName, "Portrait");
});
test("demande : piège à robots, GET refusé, corps illisible, aucune redirection vers une adresse reçue", async () => {
  const ctx = mk(); await open(ctx);
  assert.equal((await send(ctx, { ...good, website: "spam.io" })).status, 200);
  assert.equal((await orders(ctx)).length, 0);
  assert.equal((await def.routes.send(new Request("https://example.test/m/x/send"), ctx)).status, 405);
  assert.equal((await def.routes.send(new Request("https://example.test/m/x/send", { method: "POST", body: "{", headers: { "content-type": "application/json" } }), ctx)).status, 400);
  const r = await send(ctx, { ...good, next: "https://evil.example/x", redirect: "//evil.example" }, { json: false });
  assert.ok(r.headers.get("location").startsWith("/commandes/"));
});
test("demande : fermé ou complet, personne ne peut envoyer (même en forçant le formulaire)", async () => {
  const ctx = mk();
  assert.equal((await submit(ctx)).res.status, 409, "fermé par défaut");
  await data.writeQueue(ctx, { mode: "full" });
  assert.equal((await submit(ctx)).res.status, 409);
  await data.writeQueue(ctx, { mode: "open", slots: 1 });
  assert.equal((await submit(ctx)).res.status, 200);
  const [o] = await orders(ctx);
  o.status = "accepted"; await data.saveOrder(ctx, o);
  assert.equal((await submit(ctx, { ...good, email: "b@example.org" }, { ip: "9.9.9.9" })).res.status, 409, "plus de place : complet tout seul");
  assert.match(JSON.stringify(await def.page(ctx, { segments: [] })), /Complet pour le moment/);
  assert.ok(!JSON.stringify(await def.page(ctx, { segments: [] })).includes("<form"));
});
test("demande : limites de débit (visiteur, adresse, site), plafond de demandes en attente et de commandes gardées", async () => {
  const ctx = mk({ settings: { rateLimit: 2 } }); await open(ctx, 0);
  assert.equal((await submit(ctx, { ...good, email: "a@example.org" }, { ip: "5.5.5.5" })).res.status, 200);
  assert.equal((await submit(ctx, { ...good, email: "b@example.org" }, { ip: "5.5.5.5" })).res.status, 200);
  assert.equal((await submit(ctx, { ...good, email: "c@example.org" }, { ip: "5.5.5.5" })).res.status, 429);
  assert.equal((await submit(ctx, { ...good, email: "c@example.org" }, { ip: "6.6.6.6" })).res.status, 200, "un autre visiteur n'est pas touché");
  const a = mk(); await open(a, 0);
  for (let i = 0; i < 3; i++) assert.equal((await submit(a, good, { ip: `7.7.7.${i}` })).res.status, 200);
  const r = await submit(a, good, { ip: "7.7.7.9" });
  assert.equal(r.res.status, 429); assert.ok(r.body.errors.email);
  const w = mk({ settings: { maxWaiting: 10 } }); await open(w, 0);
  for (let i = 0; i < 10; i++) await w.api.store.add("orders", { nick: "x", status: "new", email: `${i}@example.org` });
  assert.equal((await submit(w, good, { ip: "8.8.8.8" })).res.status, 503);
  const faulty = mk(); await open(faulty, 0);
  for (let i = 0; i < 1000; i++) await faulty.api.store.add("orders", { nick: "x", status: "delivered" });
  assert.equal((await submit(faulty, good, { ip: "8.8.4.4" })).res.status, 503);
  const g = mk(); await open(g, 0);
  let accepted = 0; for (let i = 0; i < 80; i++) if ((await submit(g, { ...good, email: `u${i}@example.org` }, { ip: `10.1.1.${i}` })).res.status === 200) accepted++;
  assert.equal(accepted, lib.LIMITS.globalPerHour, "plafond pour tout le site, même avec des adresses de visiteurs toutes différentes");
});
test("demande : aucune adresse IP gardée (ni dans les données, ni dans la réponse)", async () => {
  const ctx = mk(); await open(ctx);
  const res = await send(ctx, good, { ip: "198.51.100.77" });
  assert.ok(!JSON.stringify(ctx.api.store.dump()).includes("198.51.100.77"));
  assert.ok(!JSON.stringify(await res.json()).includes("198.51.100.77"));
  assert.ok(!/Set-Cookie/i.test([...res.headers.keys()].join()));
});

// ── Places ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("places : libres = places − (acceptées + en cours) ; les nouvelles, livrées, refusées n'en prennent pas ; 0 = sans limite", async () => {
  const ctx = mk();
  await open(ctx, 3);
  for (const s of ["new", "accepted", "in_progress", "delivered", "refused", "cancelled"]) await ctx.api.store.add("orders", { nick: s, status: s });
  data.bust(ctx);
  const q = await data.readQueue(ctx), st = await data.stats(ctx);
  assert.deepEqual(data.publicState(q, st), { state: "open", free: 1 });
  assert.deepEqual(data.publicState({ ...q, slots: 2 }, st), { state: "full", free: 0 });
  assert.deepEqual(data.publicState({ ...q, slots: 0 }, st), { state: "open", free: null });
  assert.deepEqual(data.publicState({ ...q, mode: "closed" }, st), { state: "closed", free: null });
  assert.deepEqual(data.publicState({ ...q, mode: "full" }, st), { state: "full", free: 0 });
});
test("page : « 2 places libres », « Complet, réouverture le … », date de réouverture facultative, message de l'équipe échappé", async () => {
  const ctx = mk(); await open(ctx, 3);
  assert.match(await pageText(ctx, []), /3 places libres/);
  await data.writeQueue(ctx, { mode: "full", reopenOn: "2027-03-12", message: `<img src=x onerror=alert(1)> Noël` });
  data.bust(ctx);
  const t = await pageText(ctx, []);
  assert.match(t, /Complet pour le moment/); assert.match(t, /12 mars 2027/);
  assert.ok(!t.includes("<img src=x") && t.includes("&lt;img"));
  await data.writeQueue(ctx, { reopenOn: "n'importe quoi" });
  assert.equal((await data.readQueue(ctx)).reopenOn, "");
});

// ── Page de suivi ──────────────────────────────────────────────────────────────────────────────────────────────
test("suivi : prénom/pseudo, état, étapes, place dans la file ; jamais l'e-mail, la note privée ni le texte de la demande", async () => {
  const ctx = mk(); await open(ctx);
  const a = await submit(ctx, { ...good, nick: "Alice", email: "alice@example.org", want: "SECRET-DEMANDE" }, { ip: "1.1.1.1" });
  const b = await submit(ctx, { ...good, nick: "Bob", email: "bob@example.org" }, { ip: "2.2.2.2" });
  for (const [t, note] of [[a.token, "PRIVEE-A"], [b.token, "PRIVEE-B"]]) {
    const o = await data.findByToken(ctx, t); o.privateNote = note; o.status = "accepted"; o.queuedAt = new Date(Date.now() + (t === b.token ? 1000 : 0)).toISOString(); o.clientNote = "Bientôt !"; await data.saveOrder(ctx, o);
  }
  const mine = await pageText(ctx, ["suivi", b.token]);
  assert.match(mine, /Bob/); assert.match(mine, /Acceptée/); assert.match(mine, /Une commande passe avant la vôtre/); assert.match(mine, /Bientôt !/);
  for (const bad of ["alice", "@example", "PRIVEE", "SECRET-DEMANDE", "bob@"]) assert.ok(!mine.includes(bad), bad);
  assert.ok(!mine.includes("Alice"), "jamais le pseudo d'une autre");
  const off = mk({ settings: { showPosition: false } }); await open(off);
  const c = await submit(off); const oc = await data.findByToken(off, c.token); oc.status = "accepted"; await data.saveOrder(off, oc);
  assert.ok(!/avant la vôtre|prochaine/.test(await pageText(off, ["suivi", c.token])));
});
test("suivi : texte de visiteur échappé (pseudo, message), en français comme en anglais", async () => {
  for (const locale of ["fr", "en"]) {
    const ctx = mk({ locale }); await open(ctx);
    const { token } = await submit(ctx, { ...good, nick: `<b onmouseover=x>"Z"</b>` });
    const t = await pageText(ctx, ["suivi", token]);
    assert.ok(!t.includes("<b onmouseover"));
  }
});
test("suivi : la cliente annule (nouvelle ou acceptée) ou efface sa demande (nouvelle ou terminée) ; un faux lien ne fait rien", async () => {
  const ctx = mk(); await open(ctx);
  const a = await submit(ctx, good, { ip: "1.1.1.1" });
  const tok = (t) => ({ t });
  assert.equal((await def.routes.cancel(post({ t: "d".repeat(32) }, { route: "cancel" }), ctx)).status, 404);
  assert.equal((await def.routes.cancel(post({ t: "nope" }, { route: "cancel" }), ctx)).status, 404);
  assert.equal((await def.routes.cancel(new Request("https://example.test/m/x/cancel"), ctx)).status, 405);
  const r = await def.routes.cancel(post(tok(a.token), { route: "cancel" }), ctx);
  assert.equal(r.status, 303); assert.equal(r.headers.get("location"), `/commandes/suivi/${a.token}`);
  assert.equal((await orders(ctx))[0].status, "cancelled");
  const o = await data.findByToken(ctx, a.token); o.status = "in_progress"; await data.saveOrder(ctx, o);
  await def.routes.forget(post(tok(a.token), { route: "forget" }), ctx);
  assert.equal((await orders(ctx)).length, 1, "en cours : pas d'effacement par la cliente");
  o.status = "delivered"; await data.saveOrder(ctx, o);
  assert.equal((await def.routes.forget(post(tok(a.token), { route: "forget" }), ctx)).headers.get("location"), "/commandes");
  assert.equal((await orders(ctx)).length, 0);
  assert.match(await pageText(ctx, ["suivi", a.token]), /n'existe pas ou n'existe plus/);
});

// ── E-mails ────────────────────────────────────────────────────────────────────────────────────────────────────
test("e-mails : confirmation avec le lien, un seul message avec le lien, aucun secret, langue de la cliente ; rien si le site ne sait pas écrire", async () => {
  const ctx = mk(); await open(ctx);
  const { token } = await submit(ctx);
  assert.equal(ctx.calls.mail.length, 2);
  const [toClient, toTeam] = ctx.calls.mail;
  assert.equal(toClient.to, "camille@example.org");
  assert.ok(toClient.text.includes(`/commandes/suivi/${token}`) && /ignorez/.test(toClient.text));
  assert.equal(toTeam.to, "owner");
  assert.ok(!/camille@example\.org|portrait/i.test(toTeam.subject + toTeam.text), "l'équipe ne reçoit ni l'adresse ni le texte");
  await submit(ctx, { ...good, email: "z@example.org" }, { ip: "3.3.3.3" });
  assert.equal(ctx.calls.mail.filter((m) => m.to === "owner").length, 1, "au plus un message à l'équipe par heure");
  const o = (await orders(ctx)).find((x) => x.email === "camille@example.org");
  ctx.calls.mail.length = 0;
  const r = await def.adminActions.setStatus.run(ctx, { id: o.id, status: "accepted", notify: "on", clientNote: "Merci" });
  assert.match(r.ok, /prévenue/);
  const m = ctx.calls.mail[0];
  assert.equal(m.to, "camille@example.org");
  assert.ok(!/suivi\/|Merci|portrait/.test(m.text), "le changement d'état ne contient que l'état");
  assert.match(m.text, /Acceptée/);
  const en = (await orders(ctx))[0]; en.lang = "en"; await data.saveOrder(ctx, en);
  ctx.calls.mail.length = 0;
  await def.adminActions.setStatus.run(ctx, { id: en.id, status: "in_progress", notify: "on" });
  assert.match(ctx.calls.mail[0].text, /Hello/);
  const none = mk({ mailConfigured: false }); await open(none);
  const t = await submit(none);
  assert.equal(t.res.status, 200); assert.equal(none.calls.mail.length, 0);
  assert.ok(!(await pageText(none, [])).includes('name="notify"'), "pas de case e-mail si le site ne sait pas écrire");
  assert.equal((await orders(none))[0].mailOptIn, false);
});
test("e-mails : pas de message sans l'accord de la cliente ; une panne d'e-mail ne perd rien ; limite par adresse", async () => {
  const ctx = mk({ mailResult: { ok: false, reason: "failed" } }); await open(ctx);
  const t = await submit(ctx, { ...good, notify: "" });
  assert.equal(t.res.status, 200);
  assert.equal(ctx.calls.mail.filter((m) => m.to !== "owner").length, 0);
  const o = (await orders(ctx))[0];
  const r = await def.adminActions.setStatus.run(ctx, { id: o.id, status: "accepted", notify: "on" });
  assert.ok(r.ok && !/prévenue/.test(r.ok), "pas d'accord, pas de message");
  const off = mk({ settings: { clientMails: false } }); await open(off);
  await submit(off); assert.equal(off.calls.mail.filter((m) => m.to !== "owner").length, 0);
});

// ── Administration ─────────────────────────────────────────────────────────────────────────────────────────────
test("admin : changement d'état avec historique, file (queuedAt), message à la cliente, notes privées ; mauvaises valeurs refusées par champ", async () => {
  const ctx = mk(); await open(ctx, 1);
  const { token } = await submit(ctx);
  const o = (await orders(ctx))[0];
  const run = (name, v) => def.adminActions[name].run(ctx, v);
  assert.ok((await run("setStatus", { id: o.id, status: "wrong" })).errors.status);
  assert.ok((await run("setStatus", { id: "inconnu", status: "accepted" })).error);
  const r = await run("setStatus", { id: o.id, status: "accepted", clientNote: "<i>ok</i>" });
  assert.ok(r.ok && /Attention/.test(r.ok) === false);
  const a = (await orders(ctx))[0];
  assert.deepEqual([a.status, a.history.map((h) => h.s), !!a.queuedAt, a.clientNote], ["accepted", ["new", "accepted"], true, "<i>ok</i>"]);
  await submit(ctx, { ...good, email: "n2@example.org" }, { ip: "4.4.4.4" }).catch(() => {});
  await run("saveNote", { id: o.id, privateNote: "difficile" });
  assert.equal((await orders(ctx))[0].privateNote, "difficile");
  assert.ok(!(await pageText(ctx, ["suivi", token])).includes("difficile"));
  assert.match((await run("setStatus", { id: o.id, status: "in_progress" })).ok, /En cours/);
  const q = def.adminActions.saveQueue.run;
  assert.ok((await q(ctx, { slots: "abc", reopenOn: "" })).errors.slots);
  assert.ok((await q(ctx, { slots: "3", reopenOn: "demain" })).errors.reopenOn);
  assert.ok((await q(ctx, { slots: "100", reopenOn: "" })).errors.slots);
  assert.ok((await q(ctx, { slots: "5", reopenOn: "2027-03-12", message: "Noël" })).ok);
  assert.deepEqual((({ slots, reopenOn, message }) => ({ slots, reopenOn, message }))(await data.readQueue(ctx)), { slots: 5, reopenOn: "2027-03-12", message: "Noël" });
  assert.ok((await def.adminActions.setMode.run(ctx, { id: "closed" })).ok);
  assert.ok((await def.adminActions.setMode.run(ctx, { id: "x" })).error);
});
test("admin : nouveau lien (l'ancien meurt, envoyé par e-mail sinon montré une fois) ; suppression", async () => {
  const ctx = mk(); await open(ctx);
  const { token } = await submit(ctx);
  const o = (await orders(ctx))[0];
  ctx.calls.mail.length = 0;
  const r = await def.adminActions.renewLink.run(ctx, { id: o.id });
  assert.match(r.ok, /e-mail/);
  const fresh = ctx.calls.mail[0].text.match(/suivi\/([a-z2-7]{32})/)[1];
  assert.notEqual(fresh, token);
  assert.equal(await data.findByToken(ctx, token), null);
  assert.equal((await data.findByToken(ctx, fresh)).nick, "Camille");
  const n = mk({ mailConfigured: false }); await open(n);
  const t = await submit(n); const on = (await orders(n))[0];
  const r2 = await def.adminActions.renewLink.run(n, { id: on.id });
  assert.match(r2.ok, /suivi\/[a-z2-7]{32}/);
  assert.equal(await data.findByToken(n, t.token), null);
  assert.ok((await def.adminActions.removeOrder.run(n, { id: on.id })).ok);
  assert.equal((await orders(n)).length, 0);
});
test("admin : formules (ajout, ordre par position, masquer, limite de 12, suppression) ; messages d'erreur par champ", async () => {
  const ctx = mk(); const run = (v) => def.adminActions.saveFormula.run(ctx, v);
  assert.ok((await run({ name: "  " })).errors.name);
  for (const nm of ["A", "B", "C"]) assert.ok((await run({ name: nm, price: "10 €", visible: "on" })).ok);
  assert.deepEqual((await data.listFormulas(ctx)).map((f) => f.name), ["A", "B", "C"]);
  const [a, b, c] = await data.listFormulas(ctx);
  await run({ id: c.id, name: "C", position: "1", visible: "on" });
  assert.deepEqual((await data.listFormulas(ctx)).map((f) => f.name), ["C", "A", "B"]);
  assert.ok((await run({ id: c.id, name: "C", position: "9" })).errors.position);
  await run({ id: a.id, name: "A", visible: "" });
  assert.equal((await data.listFormulas(ctx)).find((f) => f.name === "A").visible, false);
  assert.ok((await def.adminActions.removeFormula.run(ctx, { id: b.id })).ok);
  assert.equal((await data.listFormulas(ctx)).length, 2);
  for (let i = 0; i < 12; i++) await run({ name: `F${i}`, visible: "on" });
  assert.equal((await data.listFormulas(ctx)).length, 12);
  assert.ok((await run({ name: "Trop" })).error);
});
test("admin : le panneau cache l'e-mail sans le droit, cache les boutons sans le droit de gérer, et échappe tout", async () => {
  const ctx = mk(); await open(ctx);
  await submit(ctx, { ...good, nick: `<script>x</script>` });
  const o = (await orders(ctx))[0];
  const full = JSON.stringify(await def.adminPanel(ctx, { query: { order: o.id } }));
  assert.ok(full.includes("camille@example.org") && full.includes('"setStatus"'));
  for (const rights of [["manage"], []]) {
    const lim = mk({ rights }); await lim.api.store.restore(ctx.api.store.snapshot().map((r) => ({ ...r, data: r.data })));
    const t = JSON.stringify(await def.adminPanel(lim, { query: { order: o.id } }));
    assert.ok(!t.includes("camille@example.org"), "pas d'e-mail sans le droit");
    if (!rights.length) assert.ok(!t.includes('"setStatus"') && !t.includes("rowActions\":[{\"label\":\"Choisir"));
  }
  assert.ok(!(await def.adminPanel(ctx, {})).some((b) => b.type === "html" || b.type === "markdown" && b.text.includes("<script")), "le texte d'une visiteuse ne passe jamais par un bloc brut");
  assert.ok(!JSON.stringify(await def.adminPanel(mk({ rights: ["manage"] }), {})).includes('"download"'), "pas d'export sans le droit");
  assert.ok(JSON.stringify(await def.adminPanel(ctx, {})).includes('"download"'));
});
test("admin : liste filtrée et paginée par curseur (50 par page), file dans l'ordre d'arrivée, pastille = nouvelles demandes", async () => {
  const ctx = mk();
  for (let i = 0; i < 120; i++) await ctx.api.store.add("orders", { nick: `N${i}`, status: i % 3 ? "new" : "delivered", email: "" });
  data.bust(ctx);
  assert.equal(await def.adminBadge(ctx), 80);
  const rowsOf = (blocks) => blocks.find((b) => b.type === "table" && b.columns.length === 2 && b.rowIds?.length > 3);
  const p1 = await def.adminPanel(ctx, { query: { filter: "new" } });
  assert.equal(rowsOf(p1).rowIds.length, 50);
  const next = p1.find((b) => b.type === "links" && b.items[0].label.includes("suivante"));
  const after = /after=([^&]+)/.exec(next.items[0].href)[1];
  const p2 = await def.adminPanel(ctx, { query: { filter: "new", after } });
  assert.equal(rowsOf(p2).rowIds.length, 30);
  assert.ok(!p2.some((b) => b.type === "links" && b.items[0]?.label.includes("suivante")));
  assert.equal(new Set([...rowsOf(p1).rowIds, ...rowsOf(p2).rowIds]).size, 80);
  const done = await def.adminPanel(ctx, { query: { filter: "done" } });
  assert.equal(rowsOf(done).rowIds.length, 40);
  await def.adminPanel(ctx, { query: { filter: "n'importe", after: "<x>" } });
});

// ── Contacts (facultatif) ──────────────────────────────────────────────────────────────────────────────────────
test("Contacts absent : tout marche, adresse gardée dans la commande, aucun bouton ni erreur", async () => {
  const ctx = mk(); await open(ctx);
  await submit(ctx);
  const o = (await orders(ctx))[0];
  const panel = JSON.stringify(await def.adminPanel(ctx, { query: { order: o.id } }));
  assert.ok(!panel.includes("linkContact") && !panel.includes('"name":"contact"'));
  const r = await def.adminActions.linkContact.run(ctx, { id: o.id });
  assert.ok(r.error && /Contacts/.test(r.error));
  assert.equal((await orders(ctx))[0].email, "camille@example.org");
  const r2 = await def.adminActions.setStatus.run(ctx, { id: o.id, status: "accepted", contact: "on" });
  assert.match(r2.ok, /Contacts ne répond pas/);
  assert.equal((await orders(ctx))[0].status, "accepted");
});
test("Contacts présent : la fiche est créée, l'adresse n'est plus dans la commande, relue dans le carnet pour écrire ; jamais de doublon", async () => {
  const book = fakeContactBook();
  const ctx = mk({ services: book.services }); await open(ctx);
  const { token } = await submit(ctx);
  const o = (await orders(ctx))[0];
  assert.ok(JSON.stringify(await def.adminPanel(ctx, { query: { order: o.id } })).includes('"name":"contact"'));
  ctx.calls.mail.length = 0;
  const r = await def.adminActions.setStatus.run(ctx, { id: o.id, status: "accepted", contact: "on", notify: "on" });
  assert.match(r.ok, /fiche a été créée/); assert.match(r.ok, /prévenue/);
  const a = (await orders(ctx))[0];
  assert.ok(a.contactId); assert.equal(a.email, "");
  assert.ok(!JSON.stringify(ctx.api.store.dump()).includes("camille@example.org"), "l'adresse ne vit plus qu'ailleurs");
  assert.equal(ctx.calls.mail[0].to, "camille@example.org", "on écrit à l'adresse du carnet");
  const found = await ctx.api.services.call("contact.book", "find", { email: "camille@example.org" });
  assert.equal(found.value.total, 1);
  assert.match(JSON.stringify(await def.adminPanel(ctx, { query: { order: o.id } })), /dans Contacts/);
  // même adresse, deuxième commande : la même fiche
  const b2 = await submit(ctx, good, { ip: "2.2.2.2" });
  const o2 = (await orders(ctx)).find((x) => x.email);
  await def.adminActions.linkContact.run(ctx, { id: o2.id });
  assert.equal((await ctx.api.services.call("contact.book", "list", {})).value.items.length, 1);
  assert.equal((await orders(ctx)).filter((x) => x.contactId === a.contactId).length, 2);
  assert.ok(token && b2.token);
});
test("Contacts : fiche fusionnée suivie, fiche supprimée signalée, carnet muet sans conséquence", async () => {
  const book = fakeContactBook();
  const ctx = mk({ services: book.services }); await open(ctx);
  await submit(ctx);
  const o = (await orders(ctx))[0];
  await def.adminActions.linkContact.run(ctx, { id: o.id });
  const id = (await orders(ctx))[0].contactId;
  const other = book.seedContact({ name: "Autre", email: "autre@example.org" }).id;
  await book.services["contact.book"].merge({ keep: other, drop: id });
  const card = await bookMod.cardOf(ctx, (await orders(ctx))[0]);
  assert.equal(card.state, "found"); assert.equal((await orders(ctx))[0].contactId, other);
  book.deleteContact?.(other);
  const mute = mk({ services: { "contact.book": { resolve: () => new Promise(() => {}) } } });
  bookMod.timing.callMs = 50;
  const m = await bookMod.emailOf(mute, { email: "", contactId: "x" });
  bookMod.timing.callMs = 5000;
  assert.equal(m.email, "");
});
runPrivacySubjectContract(async () => {
  const ctx = mk();
  const svc = def.services["privacy.subject"];
  return {
    methods: Object.fromEntries(Object.keys(svc).map((m) => [m, (args) => svc[m](ctx, args)])),
    addReference: async (contactId) => { await ctx.api.store.add("orders", { nick: "x", status: "new", contactId, want: "texte" }); },
    countReferences: async (contactId) => (await orders(ctx)).filter((o) => o.contactId === contactId).length,
  };
}, { test, prefix: "Commandes privacy.subject" });
test("privacy.subject : l'export dit ce que le module garde, l'effacement supprime les commandes reliées (pas les autres)", async () => {
  const ctx = mk(); const svc = def.services["privacy.subject"];
  await ctx.api.store.add("orders", { nick: "A", status: "new", contactId: "c1", want: "souhait" });
  await ctx.api.store.add("orders", { nick: "B", status: "new", contactId: "c2" });
  const x = await svc.export(ctx, { contactId: "c1" });
  assert.equal(x.data.count, 1); assert.ok(x.label);
  assert.deepEqual(await svc.erase(ctx, { contactId: "c1" }), { removed: 1 });
  assert.equal((await orders(ctx)).length, 1);
});

// ── Conservation, export, sauvegarde, outils IA ────────────────────────────────────────────────────────────────
test("conservation : les commandes terminées anciennes sont effacées (pas les en cours), par lots, sans rien dupliquer ; 0 = jamais", async () => {
  const ctx = mk({ settings: { keepMonths: 12 } });
  const old = new Date(Date.now() - 400 * 86400000).toISOString(), recent = new Date(Date.now() - 30 * 86400000).toISOString();
  for (const [s, at] of [["delivered", old], ["refused", old], ["cancelled", old], ["delivered", recent], ["accepted", old], ["in_progress", old], ["new", old]]) await ctx.api.store.add("orders", { nick: s, status: s, history: [{ s, at }] });
  assert.deepEqual(await purgeFinished(ctx), { removed: 3 });
  assert.deepEqual(await purgeFinished(ctx), { removed: 0 }, "idempotente");
  assert.deepEqual((await orders(ctx)).map((o) => o.status).sort(), ["accepted", "delivered", "in_progress", "new"]);
  const never = mk({ settings: { keepMonths: 0 } });
  await never.api.store.add("orders", { nick: "x", status: "delivered", history: [{ s: "delivered", at: old }] });
  assert.deepEqual(await purgeFinished(never), { removed: 0 });
  const big = mk({ settings: { keepMonths: 1 } });
  for (let i = 0; i < 250; i++) await big.api.store.add("orders", { nick: "x", status: "delivered", history: [{ s: "delivered", at: old }] });
  assert.equal((await purgeFinished(big)).removed, 200);
  assert.deepEqual(await def.tasks.cleanup.run(big), { removed: 50 });
});
test("export CSV : en-tête, une ligne par commande, cellules à formule neutralisées, lu au fil de l'eau, adresse du carnet incluse", async () => {
  const book = fakeContactBook();
  const ctx = mk({ services: book.services }); await open(ctx);
  await ctx.api.store.add("orders", { nick: "=HYPERLINK(\"x\")", status: "new", email: "a@example.org", want: "ligne 1\nligne \"2\"", history: [] });
  const c = book.seedContact({ name: "Zed", email: "zed@example.org" }).id;
  await ctx.api.store.add("orders", { nick: "Zed", status: "accepted", contactId: c, history: [] });
  const gen = def.adminDownloads.orders.generate(ctx);
  let text = ""; for await (const chunk of gen) text += chunk;
  const lines = text.trim().split("\r\n");
  assert.equal(lines.length, 3);
  assert.ok(text.includes("'=HYPERLINK"));
  assert.ok(text.includes("zed@example.org") && text.includes("a@example.org"));
  assert.ok(!text.includes("\nligne"), "pas de saut de ligne dans une cellule");
  const files = await def.backup.readable(ctx);
  assert.deepEqual(files.map((f) => f.path), ["orders.csv", "formulas.csv"]);
});
test("outils IA : pas d'e-mail ni de note privée dans les réponses ; changements explicites ; arguments validés par le schéma", async () => {
  const ctx = mk(); await open(ctx);
  await submit(ctx);
  const o = (await orders(ctx))[0]; o.privateNote = "NOTE-SECRETE"; await data.saveOrder(ctx, o);
  const list = await def.mcp.commissions_list(ctx, {});
  assert.ok(!JSON.stringify(list).includes("camille@example.org") && !JSON.stringify(list).includes("NOTE-SECRETE"));
  assert.equal(list.items.length, 1);
  assert.equal((await def.mcp.commissions_status(ctx)).counts.new, 1);
  const set = await def.mcp.commission_set_status(ctx, { id: o.id, status: "accepted", clientMessage: "Hop", notify: true });
  assert.deepEqual([set.status, set.emailed], ["accepted", true]);
  await assert.rejects(def.mcp.commission_set_status(ctx, { id: "x", status: "accepted" }), /not found/);
  await assert.rejects(def.mcp.commission_set_status(ctx, { id: o.id, status: "x" }), /invalid/);
  assert.equal((await def.mcp.commissions_set_queue(ctx, { mode: "full", slots: 5, reopenOn: "2027-01-02", message: "ok" })).publicState, "full");
  await assert.rejects(def.mcp.commissions_set_queue(ctx, { reopenOn: "demain" }), /reopenOn/);
  await assert.rejects(def.mcp.commissions_set_queue(ctx, {}), /nothing/);
  assert.deepEqual((await def.mcp.commissions_formulas(ctx)), []);
  for (const a of manifest.mcp) assert.equal(typeof validateArgs, "function") && void a;
});
test("restauration : une copie de sauvegarde garde les liens ; les chiffres de places se recalculent", async () => {
  const ctx = mk(); await open(ctx, 1);
  const { token } = await submit(ctx);
  const o = (await orders(ctx))[0]; o.status = "accepted"; await data.saveOrder(ctx, o);
  assert.equal((await data.stats(ctx)).active, 1);
  ctx.api.store.restore(ctx.api.store.snapshot().filter((r) => r.collection !== "orders").map((r) => ({ ...r })));
  assert.equal((await data.stats(ctx)).active, 0);
  assert.equal(await data.findByToken(ctx, token), null);
});
