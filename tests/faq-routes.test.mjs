// Questions fréquentes : les routes publiques (avis, questions des visiteurs) — protections, confidentialité, redirections.
import test from "node:test";
import assert from "node:assert/strict";
import { def, data, ctxFor, addItem, rows, post, json } from "./helpers/faqKit.mjs";

const vote = (ctx, id, v, opts) => def.routes.vote(post("vote", { q: id, v }, opts), ctx);
const ask = (ctx, question, opts, extra = {}) => def.routes.ask(post("ask", { question, ...extra }, opts), ctx);
const body = async (res) => res.json();

// ── Avis ─────────────────────────────────────────────────────────────────────────────────────────────────────────

test("avis : « Cela m'a aidé » et « Pas vraiment » incrémentent un compteur, rien d'autre", async () => {
  const ctx = ctxFor();
  const id = await addItem(ctx);
  let res = await vote(ctx, id, "up", { ip: "198.51.100.1", headers: json });
  assert.equal(res.status, 200);
  assert.deepEqual(await body(res), { ok: true, y: 1, already: false });
  res = await vote(ctx, id, "down", { ip: "198.51.100.2", headers: json });
  assert.equal(res.status, 200);
  res = await vote(ctx, id, "up", { ip: "198.51.100.3", headers: json });
  assert.deepEqual(await body(res), { ok: true, y: 2, already: false });
  const [item] = rows(ctx, "faq_items");
  assert.equal(item.y, 2);
  assert.equal(item.n, 1);
  assert.equal(item.status, "published", "le reste de la question est intact");
  assert.equal(item.tr.fr.q, "Quand streamez-vous ?");
});

test("avis : un seul par question et par visiteur (24 h) ; un autre visiteur compte", async () => {
  const ctx = ctxFor();
  const id = await addItem(ctx);
  const other = await addItem(ctx, { q: "Autre ?", slug: "autre" });
  assert.equal((await body(await vote(ctx, id, "up", { ip: "198.51.100.9", headers: json }))).already, false);
  const again = await body(await vote(ctx, id, "down", { ip: "198.51.100.9", headers: json }));
  assert.equal(again.already, true);
  assert.equal(again.y, 1);
  assert.equal(rows(ctx, "faq_items").find((r) => r.id === id).n, 0, "le deuxième avis n'a pas été compté");
  assert.equal((await body(await vote(ctx, other, "up", { ip: "198.51.100.9", headers: json }))).already, false, "une autre question compte");
  assert.equal((await body(await vote(ctx, id, "up", { ip: "198.51.100.10", headers: json }))).y, 2, "un autre visiteur compte");
});

test("avis : l'adresse utile est la dernière de la liste (celle du relais du site) ; une liste inventée ne contourne rien", async () => {
  const ctx = ctxFor();
  const id = await addItem(ctx);
  await vote(ctx, id, "up", { headers: { ...json, "x-forwarded-for": "1.1.1.1, 203.0.113.50" } });
  const again = await body(await vote(ctx, id, "up", { headers: { ...json, "x-forwarded-for": "9.9.9.9, 203.0.113.50" } }));
  assert.equal(again.already, true);
});

test("avis : limite par visiteur et par heure, puis 429", async () => {
  const ctx = ctxFor({ voteLimit: 3 });
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push(await addItem(ctx, { q: `Q${i}`, slug: `q${i}` }));
  const codes = [];
  for (const id of ids) codes.push((await vote(ctx, id, "up", { ip: "198.51.100.20", headers: json })).status);
  assert.deepEqual(codes, [200, 200, 200, 429, 429]);
  assert.equal((await vote(ctx, ids[0], "up", { ip: "198.51.100.21", headers: json })).status, 200, "un autre visiteur n'est pas touché");
});

test("avis : entrées invalides ou inconnues, brouillons, réglage coupé, mauvaise méthode", async () => {
  const ctx = ctxFor();
  const id = await addItem(ctx);
  const draft = await addItem(ctx, { q: "Brouillon", status: "draft", slug: "b" });
  const theme = await ctx.api.store.add("faq_themes", { names: { fr: "T" }, pos: 1 });
  const cases = [[id, "maybe", 400], ["../etc", "up", 400], ["", "up", 400], ["x".repeat(500), "up", 400], ["nope", "up", 404], [draft, "up", 404], [theme, "up", 404]];
  for (const [q, v, status] of cases) assert.equal((await vote(ctx, q, v, { headers: json })).status, status, `${q.slice(0, 10)} ${v}`);
  assert.equal(rows(ctx, "faq_items").find((r) => r.id === id).y, 0);
  assert.equal((await def.routes.vote(new Request("https://example.org/m/x/vote"), ctx)).status, 405, "GET n'écrit jamais");
  assert.equal((await def.routes.vote(new Request("https://example.org/m/x/vote", { method: "PUT", body: "x" }), ctx)).status, 405);
  assert.equal((await vote(ctxFor({ votes: false }), id, "up", { headers: json })).status, 404);
  const garbage = await def.routes.vote(new Request("https://example.org/m/x/vote", { method: "POST", body: "{pas json", headers: { "content-type": "application/json", accept: "application/json" } }), ctx);
  assert.equal(garbage.status, 400);
});

test("avis : sans JavaScript, la page revient avec un message ; l'adresse de retour ne vient jamais de la requête", async () => {
  const ctx = ctxFor();
  const id = await addItem(ctx);
  const res = await def.routes.vote(post("vote", { q: id, v: "up", next: "https://evil.example/", redirect: "//evil.example", return: "https://evil.example" }, { ip: "198.51.100.30" }), ctx);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/faq#faq-thanks");
  const en = ctxFor({}, { locale: "en" });
  const id2 = await addItem(en);
  assert.equal((await vote(en, id2, "up", { ip: "198.51.100.31" })).headers.get("location"), "/en/faq#faq-thanks");
  const bad = await vote(ctx, "nope", "up", { ip: "198.51.100.32" });
  assert.equal(bad.headers.get("location"), "/faq#faq-problem");
  const root = ctxFor({}, { basePath: "" });
  assert.equal((await vote(root, await addItem(root), "up", { ip: "198.51.100.33" })).headers.get("location"), "/#faq-thanks");
  const noPage = ctxFor({}, { basePath: null });
  assert.equal((await vote(noPage, await addItem(noPage), "up", { ip: "198.51.100.34" })).status, 200, "sans page : réponse simple");
});

test("avis : aucun cookie, aucune adresse gardée", async () => {
  const ctx = ctxFor();
  const id = await addItem(ctx);
  const res = await vote(ctx, id, "up", { ip: "203.0.113.222", headers: json });
  assert.equal(res.headers.get("set-cookie"), null);
  assert.ok(!JSON.stringify(ctx.dumpStore()).includes("203.0.113.222"), "l'adresse n'est écrite nulle part");
  assert.equal(data.visitorId(post("vote", {}, { ip: "203.0.113.222" }), ctx).includes("203.0.113.222"), false);
  assert.equal(data.visitorId(post("vote", {}, { ip: "203.0.113.222" }), ctx), data.visitorId(post("vote", {}, { ip: "203.0.113.222" }), ctx), "même connexion, même empreinte");
  assert.notEqual(data.visitorId(post("vote", {}, { ip: "203.0.113.222" }), ctx), data.visitorId(post("vote", {}, { ip: "203.0.113.223" }), ctx));
  assert.notEqual(data.visitorId(post("vote", {}, { ip: "203.0.113.222" }), ctx), data.visitorId(post("vote", {}, { ip: "203.0.113.222" }), ctxFor()), "l'empreinte est propre à l'instance");
});

test("avis : 40 avis simultanés ne s'écrasent pas", async () => {
  const ctx = ctxFor({ voteLimit: 500 });
  const id = await addItem(ctx);
  const all = await Promise.all(Array.from({ length: 40 }, (_, i) => vote(ctx, id, i % 4 === 0 ? "down" : "up", { ip: `198.51.100.${100 + i}`, headers: json })));
  assert.ok(all.every((r) => r.status === 200));
  const item = rows(ctx, "faq_items")[0];
  assert.equal(item.y + item.n, 40);
  assert.equal(item.n, 10);
});

// ── Questions des visiteurs ──────────────────────────────────────────────────────────────────────────────────────

test("question : enregistrée sans aucune donnée personnelle, langue du visiteur", async () => {
  const ctx = ctxFor({}, { locale: "en" });
  const res = await ask(ctx, "  Do you   ship abroad?  ", { ip: "198.51.100.40", headers: json });
  assert.equal(res.status, 200);
  const [a] = rows(ctx, "faq_asked");
  assert.equal(a.text, "Do you ship abroad?");
  assert.equal(a.lang, "en");
  assert.equal(a.count, 1);
  assert.equal(a.status, "new");
  assert.deepEqual(Object.keys(a).sort(), ["count", "id", "lang", "last", "status", "text"], "pas de nom, pas d'e-mail, pas d'adresse");
  assert.equal(res.headers.get("set-cookie"), null);
  assert.ok(!JSON.stringify(ctx.dumpStore()).includes("198.51.100.40"));
});

test("question : mêmes questions regroupées (« posée 3 fois »), sans tenir compte des accents ni de la ponctuation", async () => {
  const ctx = ctxFor();
  for (const [i, q] of ["Quand streamez-vous ?", "quand streamez vous", "QUAND STREAMEZ-VOUS ??"].entries()) assert.equal((await ask(ctx, q, { ip: `198.51.100.${50 + i}`, headers: json })).status, 200);
  await ask(ctx, "Autre chose ?", { ip: "198.51.100.60", headers: json });
  const list = rows(ctx, "faq_asked");
  assert.equal(list.length, 2);
  assert.equal(list.find((r) => r.text === "Quand streamez-vous ?").count, 3);
});

test("question : piège à robots, texte trop court, adresses de sites refusées, mauvais corps", async () => {
  const ctx = ctxFor();
  const trapped = await ask(ctx, "Super offre !", { ip: "198.51.100.70", headers: json }, { website: "http://spam.example" });
  assert.equal(trapped.status, 200, "on ne dit rien au robot");
  assert.equal(rows(ctx, "faq_asked").length, 0);
  for (const [i, bad] of ["ok", "  ", "Visitez https://spam.example maintenant", "voir www.spam.example"].entries()) assert.equal((await ask(ctx, bad, { ip: `198.51.100.${130 + i}`, headers: { ...json } })).status, 400, bad);
  const garbage = await def.routes.ask(new Request("https://example.org/m/x/ask", { method: "POST", body: "{pas json", headers: { "content-type": "application/json", accept: "application/json", "x-forwarded-for": "198.51.100.72" } }), ctx);
  assert.equal(garbage.status, 400);
  assert.equal((await def.routes.ask(new Request("https://example.org/m/x/ask"), ctx)).status, 405);
  assert.equal((await ask(ctxFor({ allowQuestions: false }), "Une vraie question ?", { headers: json })).status, 404);
  const huge = await ask(ctx, "x".repeat(50_000), { ip: "198.51.100.73", headers: json });
  assert.equal(huge.status, 200);
  assert.ok(rows(ctx, "faq_asked").every((r) => r.text.length <= 300));
});

test("question : 3 par visiteur et par heure par défaut (réglable), puis 429", async () => {
  const ctx = ctxFor();
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await ask(ctx, `Question numéro ${i} ?`, { ip: "198.51.100.80", headers: json })).status);
  assert.deepEqual(codes, [200, 200, 200, 429, 429]);
  assert.equal((await ask(ctx, "Un autre visiteur ?", { ip: "198.51.100.81", headers: json })).status, 200);
  const roomy = ctxFor({ askLimit: 5 });
  const c2 = [];
  for (let i = 0; i < 6; i++) c2.push((await ask(roomy, `Autre numéro ${i} ?`, { ip: "198.51.100.82", headers: json })).status);
  assert.deepEqual(c2, [200, 200, 200, 200, 200, 429]);
});

test("question : la boîte a un plafond (200) ; au-delà, un message clair", async () => {
  const ctx = ctxFor({}, { rows: { faq_asked: Array.from({ length: 200 }, (_, i) => ({ text: `Question ${i}`, lang: "fr", count: 1, last: new Date().toISOString(), status: "new" })) } });
  const res = await ask(ctx, "Une de trop ?", { ip: "198.51.100.90", headers: json });
  assert.equal(res.status, 503);
  const html = await def.routes.ask(post("ask", { question: "Encore une de trop ?" }, { ip: "198.51.100.91" }), ctx);
  assert.equal(html.headers.get("location"), "/faq#faq-full");
  assert.equal(rows(ctx, "faq_asked").length, 200);
  // une question déjà dans la boîte, elle, est comptée
  const again = await ask(ctx, "Question 7", { ip: "198.51.100.92", headers: json });
  assert.equal(again.status, 200);
  assert.equal(rows(ctx, "faq_asked").find((r) => r.text === "Question 7").count, 2);
});

test("question : les anciennes s'effacent d'elles-mêmes (90 jours au plus, au fil de l'eau)", async () => {
  const old = new Date(Date.now() - 100 * 86_400_000).toISOString();
  const recent = new Date(Date.now() - 10 * 86_400_000).toISOString();
  const ctx = ctxFor({}, { rows: { faq_asked: [{ text: "Vieille", lang: "fr", count: 4, last: old, status: "new" }, { text: "Récente", lang: "fr", count: 1, last: recent, status: "new" }] } });
  await ask(ctx, "Nouvelle question ?", { ip: "198.51.100.95", headers: json });
  assert.deepEqual(rows(ctx, "faq_asked").map((r) => r.text).sort(), ["Nouvelle question ?", "Récente"]);
  const short = ctxFor({ retentionDays: 5 }, { rows: { faq_asked: [{ text: "Dix jours", lang: "fr", count: 1, last: recent, status: "new" }] } });
  assert.equal(await data.purgeAsked(short), 1);
  assert.equal(rows(short, "faq_asked").length, 0);
  const long = ctxFor({ retentionDays: 1000 }, { rows: { faq_asked: [{ text: "Vieille", lang: "fr", count: 1, last: old, status: "new" }] } });
  assert.equal(await data.purgeAsked(long), 1, "jamais plus de 90 jours, quoi qu'on règle");
});

test("question : un e-mail à l'équipe, au plus un toutes les 6 heures, et sa panne ne perd rien", async () => {
  const ctx = ctxFor();
  await ask(ctx, "Première question ?", { ip: "198.51.100.100", headers: json });
  await ask(ctx, "Deuxième question ?", { ip: "198.51.100.101", headers: json });
  assert.equal(ctx.calls.mail.length, 1);
  assert.equal(ctx.calls.mail[0].to, "owner");
  assert.match(ctx.calls.mail[0].text, /Première question/);
  assert.match(ctx.calls.mail[0].text, /\/admin\/instances\/id-faq\d+/);
  assert.ok(!ctx.calls.mail[0].text.includes("198.51.100"));
  const quiet = ctxFor({ notify: false });
  await ask(quiet, "Sans e-mail ?", { ip: "198.51.100.102", headers: json });
  assert.equal(quiet.calls.mail.length, 0);
  const broken = ctxFor({}, { mailResult: () => { throw new Error("SMTP en panne"); } });
  assert.equal((await ask(broken, "Malgré la panne ?", { ip: "198.51.100.103", headers: json })).status, 200);
  assert.equal(rows(broken, "faq_asked").length, 1, "la question est gardée avant tout");
  const noMail = ctxFor({}, { mailConfigured: false });
  await ask(noMail, "Pas d'e-mail réglé ?", { ip: "198.51.100.104", headers: json });
  assert.equal(noMail.calls.mail.length, 0);
});

test("question : sans JavaScript, retour sur la page avec un message", async () => {
  const ctx = ctxFor();
  const ok = await def.routes.ask(post("ask", { question: "Une question sans script ?", next: "https://evil.example" }, { ip: "198.51.100.110" }), ctx);
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get("location"), "/faq#faq-sent");
  const bad = await def.routes.ask(post("ask", { question: "ok" }, { ip: "198.51.100.111" }), ctx);
  assert.equal(bad.headers.get("location"), "/faq#faq-invalid");
  for (let i = 0; i < 3; i++) await def.routes.ask(post("ask", { question: `Encore une ${i} ?` }, { ip: "198.51.100.112" }), ctx);
  assert.equal((await def.routes.ask(post("ask", { question: "Trop ?" }, { ip: "198.51.100.112" }), ctx)).headers.get("location"), "/faq#faq-limit");
});

test("question : un texte piégé est gardé tel quel mais jamais exécuté (l'administration le montre comme du texte)", async () => {
  const ctx = ctxFor();
  const bad = "<img src=x onerror=alert(1)> et <script>alert(2)</script> ?";
  await ask(ctx, bad, { ip: "198.51.100.120", headers: json });
  const panel = await def.adminPanel(ctx, { query: {} });
  const table = panel.find((b) => b.type === "table" && b.tab === "inbox");
  assert.equal(table.rows[0][0], bad.replace(/\s+/g, " "), "cellule de tableau : le cœur l'échappe");
  assert.ok(!panel.some((b) => b.type === "markdown" && /<img|<script/.test(b.text)), "jamais dans un bloc Markdown");
  assert.ok(!panel.some((b) => b.type === "html"));
});
