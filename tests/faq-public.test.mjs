// Questions fréquentes : manifeste, outils de texte, page publique (dépliants, thèmes, langues, données pour les moteurs de recherche), section d'accueil.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { parseManifest } from "@/core/modules/manifest";
import { moduleJsonLd } from "@/core/seo";
import { validateArgs } from "@/core/services/mcp/validate";
import { DIR, manifest, def, text, view, client, index, ctxFor, addItem, addTheme, pageHtml, messages } from "./helpers/faqKit.mjs";

// ── Manifeste ────────────────────────────────────────────────────────────────────────────────────────────────────

test("manifeste : valide, et le code fait ce que module.json annonce", () => {
  const r = parseManifest(manifest);
  assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(r.manifest.id, "faq");
  assert.equal(r.manifest.apiVersion, 2);
  assert.equal(r.manifest.name.fr, "Questions fréquentes");
  assert.equal(r.manifest.name.en, "FAQ");
  assert.equal(r.manifest.basePath, "faq");
  assert.equal(r.manifest.page, true);
  assert.equal(manifest.minCore, "0.2.5");
  assert.equal(index.VERSION, manifest.version, "VERSION (adresse du script mise en cache) doit suivre la version du manifeste");
  assert.deepEqual(manifest.sections.map((s) => s.id), Object.keys(def.sections));
  assert.deepEqual(manifest.mcp.map((a) => a.name).sort(), Object.keys(def.mcp).sort());
  assert.deepEqual(Object.keys(def.routes).sort(), ["ask", "client.js", "vote"]);
  assert.deepEqual(Object.keys(def.adminActions).sort(), ["dismissAsked", "moveDown", "moveUp", "publish", "publishAsked", "removeItem", "saveItem", "saveTheme", "themeDown", "themeUp", "unpublish", "removeTheme"].sort());
  // chaque action d'admin est réservée à un droit déclaré
  const rights = new Set(manifest.rights.map((x) => x.id));
  for (const [name, a] of Object.entries(def.adminActions)) assert.ok(rights.has(a.right), `${name} : droit « ${a.right} » non déclaré`);
});

test("manifeste : permissions = capacités utilisées ; réglages utiles et par défaut sensés", () => {
  const src = fs.readdirSync(DIR).filter((f) => f.endsWith(".mjs")).map((f) => fs.readFileSync(`${DIR}/${f}`, "utf8")).join("\n");
  const used = { slots: !!def.slots, routes: !!def.routes, storage: src.includes("ctx.api.store"), sections: !!def.sections, pages: !!def.page, mcp: !!def.mcp, admin: !!def.adminPanel, mail: src.includes("ctx.api.mail") };
  assert.deepEqual([...manifest.permissions].sort(), Object.keys(used).filter((k) => used[k]).sort());
  const byKey = Object.fromEntries(manifest.settings.map((s) => [s.key, s]));
  for (const k of ["allowQuestions", "votes", "fallback", "markup", "notify"]) assert.equal(byKey[k].default, true, k);
  assert.equal(byKey.footerLink.default, false);
  for (const k of ["retentionDays", "askLimit", "voteLimit"]) assert.equal(byKey[k].advanced, true, `${k} est réservé au mode avancé`);
  assert.ok(byKey.retentionDays.default <= 90, "90 jours au plus");
  assert.match(manifest.privacy.fr, /90 jours/);
  assert.ok(manifest.privacy.fr.length <= 500 && manifest.privacy.en.length <= 500);
});

test("manifeste : l'assistant n'a que des lectures et des brouillons, jamais de publication", () => {
  const byName = Object.fromEntries(manifest.mcp.map((a) => [a.name, a]));
  assert.deepEqual(Object.keys(byName).sort(), ["faq_asked_list", "faq_draft_answer", "faq_list", "faq_update_draft"]);
  assert.equal(byName.faq_list.readOnly, true);
  assert.equal(byName.faq_asked_list.readOnly, true);
  for (const n of ["faq_draft_answer", "faq_update_draft"]) { assert.equal(byName[n].readOnly, undefined); assert.notEqual(byName[n].default, true, `${n} : écriture éteinte d'office`); }
  for (const name of Object.keys(def.mcp)) assert.ok(!/publish|delete|remove/.test(name), name);
  // les arguments d'exemple passent la validation du cœur
  const ok = validateArgs(byName.faq_draft_answer.input, { answer: "Oui.", question: "Vraiment ?" });
  assert.ok(ok.ok !== false, JSON.stringify(ok));
});

// ── Outils de texte ──────────────────────────────────────────────────────────────────────────────────────────────

test("fold : accents, majuscules, ligatures et apostrophes ignorés", () => {
  assert.equal(text.fold("Été"), "ete");
  assert.equal(text.fold("ÉCOLE d’Été"), "ecole d'ete");
  assert.equal(text.fold("Cœur & Œuvre Æon Straße"), "coeur & oeuvre aeon strasse");
  assert.equal(text.fold(null), "");
});

test("réponse : gras, italique, listes, liens ; tout le reste est échappé", () => {
  const html = text.renderAnswer("Bonjour **vous**, *toi*.\nDeuxième ligne.\n\n- un\n- deux\n\n1. premier\n2. second\n\nVoir [le site](https://example.org/a?b=1&c=2) ou https://example.org/x.");
  assert.equal(html, '<p>Bonjour <strong>vous</strong>, <em>toi</em>.<br>Deuxième ligne.</p><ul><li>un</li><li>deux</li></ul><ol><li>premier</li><li>second</li></ol>'
    + '<p>Voir <a href="https://example.org/a?b=1&amp;c=2" rel="noopener noreferrer">le site</a> ou <a href="https://example.org/x" rel="noopener noreferrer">https://example.org/x</a>.</p>');
  const evil = text.renderAnswer('<script>alert(1)</script> <img src=x onerror=alert(2)> "quote" [x](javascript:alert(3)) [y](data:text/html,hi) [z](//evil.example/a)');
  assert.ok(!/<(script|img)/i.test(evil), evil);
  assert.ok(!/href="(javascript|data):/i.test(evil) && !/href="\/\//.test(evil), evil);
  assert.match(evil, /&lt;script&gt;/);
  assert.equal(text.renderAnswer("   \n "), "");
  assert.match(text.renderAnswer("[page](/contact) et [mail](mailto:a@example.org)"), /href="\/contact".*href="mailto:a@example\.org"/);
  assert.equal(text.plainText("**Gras** et [lien](https://example.org)", 100), "Gras et lien");
});

test("données pour les moteurs : JSON sûr dans une balise, taille bornée, jamais coupé en deux", () => {
  const nasty = text.safeJson({ a: "</script><script>alert(1)</script>", b: "a b c&d" });
  assert.ok(!nasty.includes("<") && !nasty.includes(">") && !nasty.includes(" ") && !nasty.includes("&"), nasty);
  assert.deepEqual(JSON.parse(nasty), { a: "</script><script>alert(1)</script>", b: "a b c&d" });

  const items = Array.from({ length: 300 }, (_, i) => ({ q: `Question ${i} ?`, html: `<p>${"réponse longue ".repeat(40)}${i}</p>`, other: false, lang: "fr" }));
  const { doc, count, omitted } = text.faqMarkup(items, "fr");
  assert.ok(count > 5 && count < 100 && omitted === 300 - count, `${count} décrites, ${omitted} laissées de côté`);
  assert.ok(text.safeJson(doc).length < text.LIMITS.markup + 200);
  assert.ok(moduleJsonLd({ "@context": "https://schema.org", ...doc }), "le cœur accepte ce volume");
  assert.equal(doc.mainEntity.length, count);
  assert.equal(text.faqMarkup([{ q: "x", html: "<p>" + "a".repeat(text.LIMITS.markupAnswer) + "</p>" }], "fr").doc, null, "une réponse trop grosse n'est pas décrite");
  assert.equal(text.faqMarkup([], "fr").doc, null);
});

// ── Page publique ────────────────────────────────────────────────────────────────────────────────────────────────

async function seeded(settings = {}, opts = {}) {
  const ctx = ctxFor(settings, opts);
  const abo = await addTheme(ctx, { fr: "Abonnements", en: "Subscriptions" }, 1);
  const cmd = await addTheme(ctx, { fr: "Commandes" }, 2);
  await addItem(ctx, { q: "Comment m'abonner ?", a: "Cliquez sur **S'abonner**.", theme: abo, pos: 1, en: { q: "How do I subscribe?", a: "Click **Subscribe**." }, y: 7 });
  await addItem(ctx, { q: "Puis-je me désabonner ?", a: "Oui, à tout moment.", theme: abo, pos: 2, y: 1 });
  await addItem(ctx, { q: "Où en est ma commande ?", a: "Écrivez-nous.", theme: cmd, pos: 1 });
  await addItem(ctx, { q: "Brouillon secret", a: "Pas publié.", theme: abo, pos: 3, status: "draft" });
  await addItem(ctx, { q: "Sans thème", a: "Réponse libre.", theme: "", pos: 1 });
  await addItem(ctx, { q: "", a: "", en: { q: "Only in English?", a: "Yes, only here." }, theme: cmd, pos: 2, slug: "only-in-english" });
  return ctx;
}

test("page : thèmes dans l'ordre, questions repliables, ancres, seul le publié est montré", async () => {
  const html = await pageHtml(await seeded());
  assert.ok(html.indexOf("Abonnements") < html.indexOf("Commandes") && html.indexOf("Commandes") < html.indexOf("Autres questions"));
  assert.ok(html.indexOf("Comment m&#39;abonner") < html.indexOf("Puis-je me désabonner"));
  assert.match(html, /<details class="faq-q" id="q-comment-m-abonner" data-faq-item><summary>/);
  assert.match(html, /<a href="#q-comment-m-abonner" data-faq-link>/);
  assert.ok(!html.includes("Brouillon secret"), "un brouillon n'est jamais montré");
  assert.match(html, /<strong>S&#39;abonner<\/strong>/);
  assert.equal((html.match(/<details /g) ?? []).length, 5, "4 questions françaises publiées + 1 écrite seulement en anglais");
  assert.match(html, /<nav aria-label="Thèmes">/, "plusieurs thèmes : une navigation");
  assert.match(html, /<h2 id="faq-th-1">Abonnements<\/h2>/);
});

test("page : la recherche, « tout ouvrir » et les avis sont du confort ; le contenu reste lisible sans eux", async () => {
  const html = await pageHtml(await seeded());
  assert.match(html, /class="faq-search faq-needs-js"/);
  assert.match(html, /<noscript><style>\.faq-needs-js\{display:none!important\}<\/style><\/noscript>/);
  assert.match(html, /<form method="post" action="\/m\/faq\d+\/vote\?lang=fr" data-faq-vote/, "l'avis part par un formulaire ordinaire");
  assert.match(html, /<form method="post" action="\/m\/faq\d+\/ask\?lang=fr" data-faq-ask/, "la question aussi");
  assert.match(html, /name="website" tabindex="-1" autocomplete="off"/, "champ piège");
  assert.match(html, /7 personnes ont trouvé cette réponse utile/);
  assert.ok(!/1 personnes/.test(html), "pas de compteur trop timide");
  for (const id of ["sent", "limit", "invalid", "full", "thanks", "busy", "problem"]) assert.match(html, new RegExp(`id="faq-${id}"`), `message de retour #${id}`);
  assert.ok(!/<script[^>]*src/.test(html) && !/\sonclick=|\sonerror=|javascript:/i.test(html), "aucun script dans la page elle-même");
});

test("page : réglages — boîte à questions, avis, introduction", async () => {
  const off = await pageHtml(await seeded({ allowQuestions: false, votes: false, intro: "Bienvenue **ici**." }));
  assert.ok(!off.includes("data-faq-ask") && !off.includes("data-faq-vote"));
  assert.match(off, /<div class="faq-intro"><p>Bienvenue <strong>ici<\/strong>\.<\/p><\/div>/);
  assert.ok(!off.includes('class="faq-count"'), "pas d'avis, pas de compteur");
});

test("page vide : message aimable et boîte à questions, pas de recherche", async () => {
  const ctx = ctxFor();
  const html = await pageHtml(ctx);
  assert.match(html, /Les premières réponses arrivent bientôt\. En attendant, vous pouvez poser votre question plus bas\./);
  assert.ok(!html.includes("data-faq-q") && !html.includes('type="application/ld+json"'));
  assert.match(html, /data-faq-ask/);
  const noAsk = await pageHtml(ctxFor({ allowQuestions: false }));
  assert.match(noAsk, /Les premières réponses arrivent bientôt\.<\/p>/);
  assert.ok(!noAsk.includes("data-faq-ask"));
});

test("page : une seule adresse, tout autre chemin est une 404", async () => {
  const ctx = await seeded();
  for (const segments of [["x"], ["page", "2"], ["q", "comment-m-abonner"], ["<script>"]]) assert.equal((await def.page(ctx, { segments })).notFound, true);
  const p = await def.page(ctx, { segments: [] });
  assert.equal(p.title, "Questions fréquentes");
  assert.equal(p.description, "Les réponses aux questions que l'on nous pose le plus souvent.");
  assert.equal((await def.page(await seeded({ intro: "Salut **toi**" }), { segments: [] })).description, "Salut toi");
});

// ── Plusieurs langues ────────────────────────────────────────────────────────────────────────────────────────────

test("langues : une question qui n'existe que dans une langue — montrée avec une mention, ou cachée (réglage)", async () => {
  const withFallback = await pageHtml(await seeded({ fallback: true }, { locale: "fr" }));
  assert.match(withFallback, /id="q-only-in-english" data-faq-item lang="en">/);
  assert.match(withFallback, /Cette réponse n&#39;existe pas encore dans votre langue : elle est affichée en anglais\./);
  const hidden = await pageHtml(await seeded({ fallback: false }, { locale: "fr" }));
  assert.ok(!hidden.includes("Only in English") && !hidden.includes("only-in-english"));
  // côté anglais : la question française sans traduction suit la même règle ; la traduite s'affiche
  const en = await pageHtml(await seeded({ fallback: true }, { locale: "en" }));
  assert.match(en, /How do I subscribe\?/);
  assert.match(en, /<h2 id="faq-th-1">Subscriptions<\/h2>/);
  assert.match(en, /id="q-puis-je-me-desabonner" data-faq-item lang="fr">/);
  assert.match(en, /does not exist in your language yet: it is shown in French/);
  const enOnly = await pageHtml(await seeded({ fallback: false }, { locale: "en" }));
  assert.ok(!enOnly.includes("Puis-je me d"), "caché sans le réglage");
  assert.match(enOnly, /How do I subscribe\?/);
  // un thème sans nom dans la langue du visiteur prend celui du site
  assert.match(en, /<h2 id="faq-th-\d">Commandes<\/h2>/);
});

test("langues : une question à moitié écrite (sans réponse) n'est jamais publique", async () => {
  const ctx = ctxFor();
  await addItem(ctx, { q: "Sans réponse ?", a: "" });
  await addItem(ctx, { q: "", a: "Sans question.", slug: "x" });
  const html = await pageHtml(ctx);
  assert.ok(!html.includes("Sans réponse") && !html.includes("Sans question"));
});

// ── Données pour les moteurs de recherche ────────────────────────────────────────────────────────────────────────

function ld(html) {
  const found = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)];
  return found.map((m) => JSON.parse(m[1]));
}

test("moteurs de recherche : FAQPage des seules questions publiées et visibles, échappé", async () => {
  const ctx = await seeded();
  await addItem(ctx, { q: "Piège ?", a: "</script><script>alert(1)</script> & <b>gras</b>", slug: "piege", pos: 9 });
  const html = await pageHtml(ctx);
  const docs = ld(html);
  assert.equal(docs.length, 1);
  const names = docs[0].mainEntity.map((q) => q.name);
  assert.ok(names.includes("Comment m'abonner ?") && names.includes("Piège ?") && names.includes("Only in English?"));
  assert.ok(!names.includes("Brouillon secret"), "jamais un brouillon");
  assert.equal(docs[0]["@type"], "FAQPage");
  assert.equal(docs[0].inLanguage, "fr");
  assert.equal(docs[0].mainEntity.find((q) => q.name === "Only in English?").inLanguage, "en", "langue signalée pour une question d'une autre langue");
  // chaque question décrite est affichée sur la page, avec la même réponse
  for (const q of docs[0].mainEntity) assert.ok(html.includes(q.acceptedAnswer.text), q.name);
  // rien ne sort de la balise
  assert.equal((html.match(/<script/g) ?? []).length, 1);
  assert.equal((html.match(/<\/script>/g) ?? []).length, 1);
  assert.ok(!/<(?!\/?(p|br|ul|ol|li|a|strong|em)\b)[a-z]/i.test(docs[0].mainEntity.map((q) => q.acceptedAnswer.text).join("")), "HTML simple seulement");
  // réglage coupé : rien
  assert.equal(ld(await pageHtml(await seeded({ markup: false }))).length, 0);
});

test("moteurs de recherche : beaucoup de questions — jamais plus que la taille permise", async () => {
  const ctx = ctxFor();
  for (let i = 0; i < 120; i++) await addItem(ctx, { q: `Question numéro ${i} ?`, a: "Une réponse assez longue. ".repeat(60), pos: i + 1, slug: `q${i}` });
  const html = await pageHtml(ctx);
  const [doc] = ld(html);
  assert.ok(doc.mainEntity.length < 120 && doc.mainEntity.length >= 5);
  assert.equal((html.match(/<details /g) ?? []).length, 120, "toutes les questions restent visibles");
  assert.ok(moduleJsonLd(doc));
});

// ── Section d'accueil, emplacements ──────────────────────────────────────────────────────────────────────────────

test("accueil : les questions les plus utiles, ou rien", async () => {
  assert.equal(await def.sections.top(ctxFor(), {}), null);
  const ctx = await seeded();
  const blocks = await def.sections.top(ctx, { count: 2 });
  const html = blocks.find((b) => b.type === "html").html;
  assert.equal((html.match(/<details /g) ?? []).length, 2);
  assert.ok(html.indexOf("Comment m&#39;abonner") < html.indexOf("Puis-je"), "la mieux notée d'abord");
  assert.ok(!html.includes("data-faq-item") && !html.includes("data-faq-vote"), "version compacte, sans avis");
  assert.deepEqual(blocks.at(-1), { type: "links", items: [{ label: "Voir toutes les questions", href: "/faq" }] });
  const many = await def.sections.top(ctx, { count: "999" });
  assert.ok((many.find((b) => b.type === "html").html.match(/<details /g) ?? []).length <= 10);
  const en = await def.sections.top(await seeded({}, { locale: "en" }), {});
  assert.equal(en.at(-1).items[0].href, "/en/faq");
});

test("emplacements : le script de confort est chargé avec son numéro de version ; le lien du pied de page est facultatif", () => {
  const head = def.slots["layout.head"](ctxFor());
  assert.deepEqual(head, [{ type: "head", tags: [{ tag: "script", src: `/m/${head[0].tags[0].src.split("/")[2]}/client.js?v=1.0.0`, defer: true }] }]);
  assert.equal(def.slots["layout.head"](ctxFor({}, { basePath: null })), null, "sans page, rien à charger");
  assert.equal(def.slots["layout.footer"](ctxFor()), null);
  assert.deepEqual(def.slots["layout.footer"](ctxFor({ footerLink: true })), [{ type: "links", items: [{ label: "Questions fréquentes", href: "/faq" }] }]);
});

// ── Le script du navigateur ──────────────────────────────────────────────────────────────────────────────────────

test("script : autonome, sans eval ni innerHTML, se charge et branche ses écouteurs une seule fois", () => {
  const js = client.CLIENT_JS;
  assert.ok(js.length < 12000, `${js.length} octets`);
  assert.ok(!/\beval\s*\(|new Function|innerHTML|document\.write|insertAdjacentHTML/.test(js));
  assert.ok(!/localStorage\.setItem\(.*(email|name)/i.test(js));
  const listeners = [];
  const doc = { readyState: "complete", querySelectorAll: () => [], addEventListener: (t) => listeners.push(`doc:${t}`), documentElement: {} };
  const win = { document: doc, addEventListener: (t) => listeners.push(`win:${t}`), fetch() {}, FormData: function () {}, MutationObserver: class { observe() { listeners.push("observer"); } } };
  win.window = win;
  vm.runInNewContext(js, { window: win, document: doc, WeakMap, Array, JSON, decodeURIComponent });
  assert.equal(win.__faqBoot, 1);
  assert.deepEqual(listeners.sort(), ["doc:click", "doc:input", "doc:submit", "observer", "win:hashchange"]);
  const again = listeners.length;
  vm.runInNewContext(js, { window: win, document: doc, WeakMap, Array, JSON, decodeURIComponent });
  assert.equal(listeners.length, again, "un second chargement ne double rien");
});

test("script : la route le sert avec un cache raisonnable, et seulement en lecture", async () => {
  const ctx = ctxFor();
  const res = await def.routes["client.js"](new Request("https://example.org/m/x/client.js"), ctx);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /javascript/);
  assert.match(res.headers.get("cache-control"), /max-age=3600/);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.ok((await res.text()).includes("__faqBoot"));
  assert.equal((await def.routes["client.js"](new Request("https://example.org/m/x/client.js", { method: "POST", body: "x" }), ctx)).status, 405);
});

test("textes : mêmes clés en français et en anglais, aucune clé oubliée", () => {
  const fr = Object.keys(messages("fr")).sort();
  assert.deepEqual(fr, Object.keys(messages("en")).sort());
  const src = fs.readdirSync(DIR).filter((f) => f.endsWith(".mjs")).map((f) => fs.readFileSync(`${DIR}/${f}`, "utf8")).join("\n");
  for (const k of fr) assert.ok(src.includes(`"${k}"`), `clé « ${k} » jamais utilisée`);
});

test("données piégées : rien n'est restitué tel quel dans la page", async () => {
  const bad = `"' onmouseover=PROBEATTR x='"></style></script><img src=x onerror=PROBEIMG><script>PROBESCRIPT</script>`;
  const ctx = ctxFor({ intro: bad }, { name: bad });
  const th = await addTheme(ctx, { fr: bad, en: bad });
  await addItem(ctx, { q: bad, a: `${bad} [x](javascript:PROBEJS(1)) https://example.org/?a=<b>`, theme: th, slug: bad });
  const html = await pageHtml(ctx);
  assert.ok(!html.includes("<img src=x onerror") && !html.includes("<script>PROBESCRIPT") && !/href="javascript:/i.test(html), html.slice(0, 400));
  assert.ok(!html.includes(`" onmouseover=PROBEATTR`) && !html.includes(`' onmouseover=PROBEATTR`) || !/<[^>]*onmouseover=PROBEATTR/.test(html));
  assert.ok(!/<[^>]*\sonmouseover=/.test(html));
});
