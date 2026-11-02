// Boîte à idées : le manifeste, la page publique, les idées proposées, les soutiens, l'anti-abus, la vie privée.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { parseManifest } from "@/core/modules/manifest";
import { DIR, def, manifestJson, fr, en, ctxFor, propose, support, note, seed, all, htmlOf, lib, ops } from "./helpers/ideaBox.mjs";

const source = ["index", "lib", "ops", "routes", "view", "admin", "mcp"].map((f) => fs.readFileSync(`${DIR}/${f}.mjs`, "utf8")).join("\n");
const bodyOf = async (ctx, segments = []) => { const p = await def.page(ctx, { segments }); return { ...p, html: htmlOf(p.blocks) }; };

test("manifeste valide, réglages déclarés et lus, parité FR/EN, clés ctx.t existantes, outils et tableau de bord implémentés", () => {
  const r = parseManifest(manifestJson); assert.ok(r.ok, r.ok ? "" : r.error);
  const declared = new Set(manifestJson.settings.map((s) => s.key));
  for (const m of source.matchAll(/ctx\.setting\("([A-Za-z0-9_]+)"\)/g)) assert.ok(declared.has(m[1]), `réglage non déclaré : ${m[1]}`);
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort(), "mêmes clés en FR et en EN");
  for (const k of Object.keys(fr)) assert.deepEqual([...fr[k].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), [...en[k].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), `variables de ${k}`);
  for (const m of source.matchAll(/\bt\("([A-Za-z0-9_]+)"/g)) assert.ok(m[1] in fr, `clé absente : ${m[1]}`);
  for (const s of lib.STATUSES) assert.ok(`status_${s}` in fr);
  for (const a of manifestJson.mcp) assert.equal(typeof def.mcp[a.name], "function", a.name);
  assert.ok(manifestJson.dashboard.tasks.every((t) => typeof def.dashboard.tasks[t.id] === "function"));
  assert.ok(manifestJson.dashboard.cards.every((c) => typeof def.dashboard.cards[c.id] === "function"));
  assert.equal(manifestJson.minCore, "0.6.0");
  assert.equal(manifestJson.settings.find((s) => s.key === "autoPublish").default, false, "la relecture est la règle");
  assert.deepEqual(manifestJson.permissions.slice().sort(), ["admin", "mcp", "pages", "routes", "storage"], "aucune permission en trop : ni e-mail, ni réseau");
});

test("aucune ressource d'un autre site, aucun suivi : la page et le code n'appellent rien au dehors", async () => {
  assert.ok(!/\bfetch\(|api\.net|api\.mail|XMLHttpRequest|localStorage|sessionStorage|eval\(|new Function/.test(source + fs.readFileSync(`${DIR}/scripts/idea-box.js`, "utf8")));
  const c = ctxFor(); await seed(c, { nick: "Lune" });
  const { html } = await bodyOf(c);
  assert.ok(!/(?:src|href|action)="https?:/i.test(html) && !/url\(\s*https?:/i.test(html), "aucune adresse extérieure");
  assert.ok(!/<script|<link|<img|<iframe/i.test(html), "ni script en ligne, ni image, ni cadre");
  assert.match(manifestJson.privacy.fr, /cookie/); assert.match(manifestJson.privacy.en, /cookie/);
  assert.match(manifestJson.privacy.fr, /pseudo/); assert.doesNotMatch(manifestJson.privacy.fr, /e-mail address|adresse IP/i, "rien d'autre n'est annoncé que ce qui est gardé");
});

/* ───────────── Proposer une idée ───────────── */

test("proposer : l'idée arrive EN ATTENTE, texte nettoyé, pseudo facultatif, retour sur la page avec un message", async () => {
  const c = ctxFor();
  assert.equal(note(await propose(c, { idea: "  Un stream\u0007  de cuisine\n\n\n\nle dimanche ", nick: " Lune  92 " })), "review");
  const [i] = await all(c);
  assert.deepEqual([i.text, i.nick, i.state, i.status, i.votes, i.reply], ["Un stream de cuisine\n\nle dimanche", "Lune 92", "pending", "proposed", 0, null]);
  assert.equal((await propose(c, { idea: "Sans pseudo du tout" }, "2.2.2.2").then(note)), "review");
  assert.equal((await all(c)).find((x) => x.text === "Sans pseudo du tout").nick, null);
  const page = (await bodyOf(c)).html;
  assert.ok(!page.includes("data-ib-item") && !page.includes("Sans pseudo"), "rien n'est public avant la relecture");
});

test("proposer : le retour porte le préfixe de langue quand la page n'est pas dans la langue par défaut", async () => {
  const c = ctxFor({}, { locale: "en", defaultLocale: "fr" });
  assert.equal((await propose(c, { idea: "A cooking stream" })).headers.get("location"), "/en/idees#ib-review");
  const d = ctxFor();
  assert.equal((await propose(d, { idea: "Un stream de cuisine" })).headers.get("location"), "/idees#ib-review");
});

test("« Publier sans relecture » : l'idée est publiée tout de suite, et le message le dit", async () => {
  const c = ctxFor({ autoPublish: true });
  assert.equal(note(await propose(c, { idea: "Un stream de cuisine" })), "sent");
  assert.equal((await all(c))[0].state, "published");
  assert.match((await bodyOf(c)).html, /Un stream de cuisine/);
  assert.match((await bodyOf(c)).html, /apparaît tout de suite/);
});

test("anti-spam : piège à robots, texte vide ou trop long, deux adresses web, doublon, méthode", async () => {
  const c = ctxFor({ textMax: 60, hourlyLimit: 20 });
  assert.equal(note(await propose(c, { idea: "Robot", website: "spam.example" })), "review", "on fait semblant");
  assert.equal((await all(c)).length, 0, "le robot n'a rien laissé");
  assert.equal(note(await propose(c, { idea: "  " }, "3.3.3.3")), "invalid");
  assert.equal(note(await propose(c, { idea: "ab" }, "3.3.3.3")), "invalid");
  assert.equal(note(await propose(c, { idea: "x".repeat(61) }, "3.3.3.3")), "long");
  assert.equal(note(await propose(c, { idea: "Voir https://a.example et https://b.example" }, "3.3.3.3")), "links");
  assert.equal(note(await propose(c, { idea: "Voir https://a.example svp" }, "3.3.3.3")), "review", "un lien reste permis");
  assert.equal((await all(c)).length, 1);
  await seed(c, { text: "Un quiz le vendredi" });
  assert.equal(note(await propose(c, { idea: "un  QUIZ le vendredi !" }, "4.4.4.4")), "dup", "même idée, accents et ponctuation ignorés");
  assert.equal((await def.routes.propose(new Request("https://x.test/m/k/propose"), c)).status, 405);
  assert.equal((await def.routes.propose(new Request("https://x.test/m/k/propose", { method: "POST", body: "pas un formulaire", headers: { "content-type": "text/plain" } }), c)).status, 400);
});

test("anti-spam : un pseudo avec une adresse web ou trop long est écarté sans refuser l'idée", async () => {
  const c = ctxFor();
  await propose(c, { idea: "Une idée", nick: "visitez https://spam.example" }, "5.5.5.5");
  await propose(c, { idea: "Une autre idée", nick: "n".repeat(31) }, "5.5.5.5");
  assert.deepEqual((await all(c)).map((i) => i.nick), [null, null]);
});

test("anti-spam : la limite par heure est réglable, bornée, par personne (l'adresse écrite en tête de l'en-tête ne la contourne pas)", async () => {
  const c = ctxFor({ hourlyLimit: 2 });
  assert.equal(note(await propose(c, { idea: "Première idée" }, "9.9.9.9")), "review");
  assert.equal(note(await propose(c, { idea: "Deuxième idée" }, "9.9.9.9")), "review");
  assert.equal(note(await propose(c, { idea: "Troisième idée" }, "9.9.9.9")), "limit");
  assert.equal(note(await propose(c, { idea: "Quatrième idée" }, "8.8.8.8")), "review", "une autre personne n'est pas touchée");
  assert.equal(note(await propose(c, { idea: "Cinquième idée" }, "2.2.2.2, 9.9.9.9")), "limit", "la dernière entrée de l'en-tête fait foi");
  const wild = ctxFor({ hourlyLimit: 9999 });
  for (let k = 0; k < 25; k++) await propose(wild, { idea: `Idée numéro ${k}` }, "7.7.7.7");
  assert.equal((await all(wild)).length, 20, "le plafond du réglage est 20 par heure");
  assert.deepEqual([lib.settings(ctxFor({ hourlyLimit: 0 })).hourlyLimit, lib.settings(ctxFor({ hourlyLimit: "abc" })).hourlyLimit, lib.settings(ctxFor({ maxPending: 5 })).maxPending, lib.settings(ctxFor({ textMax: 99999 })).textMax], [1, 3, 10, 1000]);
});

test("plafonds : trop d'idées en attente, ou trop d'idées gardées au total, disent de revenir plus tard sans rien écrire", async () => {
  const c = ctxFor({ maxPending: 10 });
  for (let k = 0; k < 10; k++) await seed(c, { text: `Idée ${k}`, state: "pending" });
  assert.equal(note(await propose(c, { idea: "Une de plus" }, "6.6.6.6")), "full");
  assert.equal((await all(c)).length, 10);
  await seed(c, { text: "Publiée", state: "published" });   // les idées déjà relues ne comptent pas dans l'attente
  const d = ctxFor({ maxPending: 10 });
  for (let k = 0; k < 9; k++) await seed(d, { text: `Idée ${k}`, state: "pending" });
  assert.equal(note(await propose(d, { idea: "La dixième" }, "6.6.6.7")), "review");
  const total = ctxFor();
  for (let k = 0; k < lib.MAX_STORED; k++) await seed(total, { text: `Idée ${k}`, state: "published" });
  assert.equal(note(await propose(total, { idea: "Trop tard" }, "6.6.6.8")), "full");
  assert.equal((await all(total)).length, lib.MAX_STORED);
});

test("le ménage des idées refusées se fait à l'écriture : seulement après le délai réglé, 50 au plus par passage, sans minuteur", async () => {
  const c = ctxFor({ keepRefusedDays: 7 });
  const old = new Date(Date.now() - 8 * 86400_000).toISOString(), recent = new Date(Date.now() - 2 * 86400_000).toISOString();
  for (let k = 0; k < 60; k++) await seed(c, { text: `Vieille ${k}`, state: "refused", refusedAt: old });
  await seed(c, { text: "Récente", state: "refused", refusedAt: recent });
  await seed(c, { text: "Publiée", state: "published" });
  assert.equal(def.tasks, undefined, "aucune tâche de fond");
  await propose(c, { idea: "Une nouvelle idée" }, "2.3.4.5");
  assert.equal((await all(c)).filter((i) => i.text.startsWith("Vieille")).length, 10, "50 effacées, 10 restent pour le prochain passage");
  await propose(c, { idea: "Encore une idée" }, "2.3.4.6");
  const left = await all(c);
  assert.equal(left.filter((i) => i.text.startsWith("Vieille")).length, 0);
  assert.ok(left.some((i) => i.text === "Récente") && left.some((i) => i.text === "Publiée"));
});

test("la fabrication d'un événement du journal ne contient aucune donnée personnelle : ni texte, ni pseudo", async () => {
  const c = ctxFor({ autoPublish: true });
  await propose(c, { idea: "Un secret très personnel", nick: "Lune" });
  const lines = c.calls.log;
  assert.deepEqual(lines.map((l) => l.action), ["idea.received", "idea.published"]);
  assert.ok(!JSON.stringify(lines).match(/secret|Lune/i));
});

/* ───────────── Soutenir ───────────── */

const cookieOf = (res) => /vh_ib_votes=([^;]*)/.exec(res.headers.get("set-cookie") ?? "")?.[1];

test("soutenir : un soutien par personne et par idée, compté une fois, cookie des numéros seulement", async () => {
  const c = ctxFor();
  const id = await seed(c, { votes: 4 });
  const first = await support(c, { id }, "1.2.3.4");
  assert.equal(note(first), "voted");
  assert.equal((await all(c))[0].votes, 5);
  const set = first.headers.get("set-cookie");
  assert.match(set, /Max-Age=31536000/); assert.match(set, /HttpOnly/); assert.match(set, /SameSite=Lax/);
  assert.deepEqual(JSON.parse(decodeURIComponent(cookieOf(first))), [id], "le cookie ne garde que le numéro de l'idée");
  assert.equal(note(await support(c, { id }, "1.2.3.4", { cookie: `vh_ib_votes=${cookieOf(first)}` })), "again", "avec le cookie");
  assert.equal(note(await support(c, { id }, "1.2.3.4")), "again", "sans cookie, la mémoire du serveur le retient");
  assert.equal((await all(c))[0].votes, 5);
  assert.equal(note(await support(c, { id }, "5.6.7.8")), "voted", "une autre personne peut soutenir");
  assert.equal((await all(c))[0].votes, 6);
});

test("soutenir : seulement une idée publiée, proposée, étudiée ou planifiée ; réglage éteint ; méthode ; idée inconnue", async () => {
  const c = ctxFor();
  const pending = await seed(c, { state: "pending" }), done = await seed(c, { status: "done" }), dismissed = await seed(c, { status: "dismissed" }), planned = await seed(c, { status: "planned" });
  for (const id of [pending, done, dismissed, "inconnu", ""]) assert.equal(note(await support(c, { id }, "2.2.2.2")), "problem", String(id));
  assert.equal(note(await support(c, { id: planned }, "2.2.2.2")), "voted");
  assert.equal((await def.routes.support(new Request("https://x.test/m/k/support"), c)).status, 405);
  const off = ctxFor({ votes: false }); const id = await seed(off);
  assert.equal(note(await support(off, { id }, "3.3.3.3")), "off");
  assert.equal((await all(off))[0].votes, 0);
  assert.doesNotMatch((await bodyOf(off)).html, /Je soutiens/, "pas de bouton quand c'est éteint");
});

test("soutenir : une idée fusionnée ne se soutient pas deux fois par la même personne ; rafale limitée", async () => {
  const c = ctxFor();
  const a = await seed(c, { votes: 1 }), b = await seed(c, { votes: 1, text: "Même idée autrement dit" });
  const voted = await support(c, { id: a }, "4.4.4.4");
  await ops.mergeIdeas(c, a, b);
  assert.equal(note(await support(c, { id: b }, "4.4.4.4", { cookie: `vh_ib_votes=${cookieOf(voted)}` })), "again", "elle avait soutenu l'ancienne idée");
  assert.equal((await all(c))[0].votes, 3, "1 + 2 soutiens additionnés, rien de plus");
  const burst = ctxFor(); const ids = [];
  for (let k = 0; k < 35; k++) ids.push(await seed(burst, { text: `Idée ${k}` }));
  const outcomes = []; for (const id of ids) outcomes.push(note(await support(burst, { id }, "9.9.9.9")));
  assert.equal(outcomes.filter((o) => o === "voted").length, 30);
  assert.equal(outcomes.at(-1), "limit");
});


/* ───────────── La page publique ───────────── */

test("page : seulement les idées publiées, écartées cachées sauf réglage, tri par soutiens ou par date, 404 pour un chemin inconnu", async () => {
  const c = ctxFor();
  await seed(c, { text: "Idée ancienne très soutenue", votes: 9 });
  await seed(c, { text: "Idée récente peu soutenue", votes: 1 });
  await seed(c, { text: "Idée à relire", state: "pending" });
  await seed(c, { text: "Idée masquée", state: "hidden" });
  await seed(c, { text: "Idée refusée", state: "refused" });
  await seed(c, { text: "Idée écartée", status: "dismissed" });
  const top = (await bodyOf(c)).html;
  assert.ok(top.indexOf("très soutenue") < top.indexOf("récente peu"), "les plus soutenues d'abord");
  for (const hidden of ["à relire", "masquée", "refusée", "écartée"]) assert.ok(!top.includes(`Idée ${hidden}`), hidden);
  const recent = (await bodyOf(c, ["recent"])).html;
  assert.ok(recent.indexOf("récente peu") < recent.indexOf("très soutenue"), "les plus récentes d'abord");
  assert.match(top, /aria-current="page">Les plus soutenues/); assert.match(recent, /aria-current="page">Les plus récentes/);
  assert.match((await bodyOf(ctxFor({ showDismissed: true }))).html, /ib-card/);
  const shown = ctxFor({ showDismissed: true }); await seed(shown, { text: "Idée écartée", status: "dismissed" });
  assert.match((await bodyOf(shown)).html, /Idée écartée/); assert.match((await bodyOf(shown)).html, /Écartée/);
  for (const segs of [["autre"], ["recent", "page"], ["2"]]) assert.equal((await def.page(c, { segments: segs })).notFound, true, segs.join("/"));
  assert.deepEqual((await def.page(c, { segments: [] })).scripts, ["idea-box.js"]);
});

test("page : état vide qui dit quoi faire, formulaire (idée, pseudo replié, bouton), recherche seulement s'il y a des idées", async () => {
  const c = ctxFor();
  const empty = (await bodyOf(c)).html.replaceAll("&#39;", "'");
  assert.match(empty, /Aucune idée pour l'instant\. Proposez la première avec le champ ci-dessus\./);
  assert.doesNotMatch(empty, /data-ib-q/, "pas de recherche pour une liste vide");
  assert.match(empty, /<label for="ib-idea-[^"]+">Votre idée<\/label>/);
  assert.match(empty, /<details class="ib-more"><summary>Plus d'options<\/summary>[\s\S]*name="nick"/);
  assert.match(empty, /<button class="ib-btn ib-main" type="submit">Proposer cette idée<\/button>/);
  assert.match(empty, /est relue avant d'apparaître/);
  assert.ok(empty.indexOf("name=\"idea\"") < empty.indexOf("<details"), "l'idée d'abord, le pseudo ensuite");
  assert.equal([...empty.matchAll(/<(?:input|textarea)\b(?![^>]*type="hidden")/g)].length, 3, "idée, pseudo et piège : rien d'autre à remplir");
  await seed(c);
  const filled = (await bodyOf(c)).html.replaceAll("&#39;", "'");
  assert.match(filled, /type="search"[^>]*data-ib-q/); assert.match(filled, /<label for="ib-q-[^"]+">Rechercher une idée<\/label>/);
  assert.match(filled, /data-ib-empty hidden>[\s\S]*Effacer la recherche/);
  assert.match(filled, /class="ib-search ib-needs-js"/, "sans JavaScript, la recherche est cachée");
  assert.match(filled, /action="\/m\/ib\d+\/propose\?lang=fr"/);
});

test("page : le texte du public est toujours échappé, le Markdown ne s'applique qu'à l'introduction de la personne propriétaire", async () => {
  const c = ctxFor({ intro: "Dites-nous **tout**." });
  await seed(c, { text: '<img src=x onerror=alert(1)> [lien](javascript:alert(1)) **gras**', nick: '"><script>alert(2)</script>', reply: "<b>Merci</b>" });
  const p = await bodyOf(c);
  assert.deepEqual(p.blocks.map((b) => b.type), ["markdown", "html"]);
  assert.equal(p.blocks[0].text, "Dites-nous **tout**.");
  assert.ok(!/<img|<script|<b>/i.test(p.html.replace(/<style>[\s\S]*?<\/style>|<noscript>[\s\S]*?<\/noscript>/g, "")), "aucune balise venue du public");
  assert.match(p.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(p.html, /&lt;script&gt;alert\(2\)&lt;\/script&gt;/);
});

test("page : statut écrit (pas seulement coloré), réponse courte, pseudo, soutiens au singulier et au pluriel", async () => {
  const c = ctxFor();
  await seed(c, { text: "Un", status: "planned", votes: 1, reply: "Merci, on y pense", nick: "Lune" });
  await seed(c, { text: "Deux", status: "done", votes: 12 });
  await seed(c, { text: "Trois", status: "studied", votes: 0 });
  const { html } = await bodyOf(c);
  for (const w of ["Planifiée", "Réalisée", "Étudiée"]) assert.match(html, new RegExp(`class="ib-badge"[^>]*>${w}<`));
  assert.match(html, /1 soutien</); assert.match(html, /12 soutiens</); assert.match(html, /0 soutiens</);
  assert.match(html, /<strong>Réponse<\/strong> — Merci, on y pense/); assert.match(html, /par Lune/);
  assert.equal([...html.matchAll(/>Je soutiens</g)].length, 2, "pas de bouton sur une idée réalisée");
  assert.match(html, /aria-label="Je soutiens cette idée : Un"/);
});

test("page : plus de 150 idées, la liste est coupée et le dit", async () => {
  const c = ctxFor();
  for (let k = 0; k < lib.PUBLIC_MAX + 3; k++) await seed(c, { text: `Idée ${k}` });
  const { html } = await bodyOf(c);
  assert.equal([...html.matchAll(/data-ib-item/g)].length, lib.PUBLIC_MAX);
  assert.match(html, /Seules les 150 premières idées sont affichées/);
});

test("page : en anglais, les mêmes textes", async () => {
  const c = ctxFor({}, { locale: "en", defaultLocale: "en", messages: en });
  await seed(c, { status: "planned" });
  const { html } = await bodyOf(c);
  for (const w of ["Your idea", "More options", "Send this idea", "Planned", "I support this", "Most supported"]) assert.ok(html.includes(w), w);
});

/* ───────────── Le petit script de la page ───────────── */

function fakePage(cards) {
  const make = (text) => ({ hidden: false, textContent: text, querySelectorAll: () => [{ textContent: text }] });
  const items = cards.map(make);
  const handlers = {};
  const input = { value: "", addEventListener: (n, f) => { handlers[n] = f; }, focus() {} };
  const status = { textContent: "" }, empty = { hidden: true };
  let clearHandler;
  const clear = { addEventListener: (n, f) => { clearHandler = f; } };
  const root = {
    dataset: { tNone: "Aucune idée ne correspond.", tOne: "1 idée trouvée", tMany: "{n} idées trouvées" },
    getAttribute: () => null, setAttribute() {},
    querySelector: (s) => ({ "[data-ib-q]": input, "[data-ib-status]": status, "[data-ib-empty]": empty, "[data-ib-clear]": clear })[s] ?? null,
    querySelectorAll: (s) => (s === "[data-ib-item]" ? items : []),
  };
  return { items, input, status, empty, type: (v) => { input.value = v; handlers.input(); }, clear: () => clearHandler(), run: () => vm.runInNewContext(fs.readFileSync(`${DIR}/scripts/idea-box.js`, "utf8"), { document: { querySelector: (s) => (s === "[data-ib]" ? root : null) } }) };
}

test("script : la recherche filtre pendant la frappe, sans accents ni majuscules, dit combien, et s'efface", () => {
  const p = fakePage(["Un stream de cuisine le dimanche Planifiée", "Un quiz le vendredi Étudiée par Lune", "Des cadeaux Réalisée"]);
  p.run();
  p.type("CUISINE"); assert.deepEqual(p.items.map((i) => i.hidden), [false, true, true]); assert.equal(p.status.textContent, "1 idée trouvée");
  p.type("etudiee lune"); assert.deepEqual(p.items.map((i) => i.hidden), [true, false, true], "accents et plusieurs mots");
  p.type("q"); assert.equal(p.status.textContent, "1 idée trouvée");
  p.type("e"); assert.equal(p.status.textContent, "3 idées trouvées");
  p.type("zzz"); assert.deepEqual(p.items.map((i) => i.hidden), [true, true, true]); assert.equal(p.empty.hidden, false); assert.equal(p.status.textContent, "Aucune idée ne correspond.");
  p.clear(); assert.equal(p.input.value, ""); assert.equal(p.empty.hidden, true); assert.deepEqual(p.items.map((i) => i.hidden), [false, false, false]); assert.equal(p.status.textContent, "");
});

test("script : fichier du module, moins de 32 Ko, aucune adresse extérieure ni stockage du navigateur", () => {
  const code = fs.readFileSync(`${DIR}/scripts/idea-box.js`, "utf8");
  assert.ok(code.length < 32 * 1024);
  assert.ok(!/https?:|fetch|localStorage|sessionStorage|cookie|eval\(|innerHTML/.test(code));
  assert.ok(fs.lstatSync(`${DIR}/scripts/idea-box.js`).isFile());
});

/* ───────────── Sauvegarde et nettoyage ───────────── */

test("sauvegarde lisible : une ligne par idée, cellules neutralisées pour un tableur ; suppression de l'instance : mémoire nettoyée", async () => {
  const c = ctxFor();
  await seed(c, { text: '=HYPERLINK("http://x.example")', nick: "+Lune", reply: "ok" });
  const [file] = await def.backup.readable(c);
  assert.equal(file.path, "ideas.csv");
  assert.match(file.content, /"'=HYPERLINK\(""http:\/\/x\.example""\)"/); assert.match(file.content, /"'\+Lune"/);
  assert.equal(file.content.split("\r\n").filter(Boolean).length, 2);
  await def.hooks.onInstanceDelete(c);
});

test("données additives : une ligne sans les champs récents se lit avec des valeurs par défaut", async () => {
  const c = ctxFor();
  await c.api.store.add("ideas", { text: "Ancienne idée" });
  const [i] = await lib.loadAll(c);
  assert.deepEqual([i.state, i.status, i.votes, i.reply, i.merged], ["pending", "proposed", 0, "", []]);
  assert.equal(manifestJson.dataVersion, 1); assert.equal(def.migrations, undefined);
});
