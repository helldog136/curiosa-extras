// Actions du live YouTube : la page « En direct » (blocs, droits, langues, échappement), les actions d'administration et la simulation.
import test from "node:test";
import assert from "node:assert/strict";
import { world, A, E, S, R, def, manifest, messages } from "./helpers/ytLiveWorld.mjs";

const BLOCK_TYPES = new Set(["markdown", "html", "heading", "banner", "table", "adminForm", "suggestInstall", "copy", "links", "netHealth", "download"]);
const texts = (blocks) => blocks.flatMap((b) => [b.text, b.html, b.submitLabel, b.title, ...(b.fields ?? []).flatMap((f) => [f.label, f.help]), ...(b.columns ?? []), ...(b.rows ?? []).flat(), b.reason].filter((x) => typeof x === "string"));
const find = (blocks, type, pred = () => true) => blocks.filter((b) => b.type === type && pred(b));
const addRule = (w, over = {}) => S.saveRule(w.ctx, null, { ...R.validateRule({ name: "Rouge", type: "superchat", currency: "EUR", min: "5", cooldownSec: "30", action: "lumieres:rouge", ...over }).rule, lastAt: 0 });
const act = (w, name, values = {}) => def.adminActions[name].run(w.ctx, values);

test("la page : blocs valides, état clair, gros bouton « Tout couper », règles, simulation, journal, limite du jour, rechargement", async () => {
  const w = await world();
  const blocks = await w.panel();
  for (const b of blocks) assert.ok(BLOCK_TYPES.has(b.type), b.type);
  assert.equal(blocks[0].type, "banner");
  const big = find(blocks, "adminForm", (b) => b.action === "stop")[0];
  assert.ok(big && big.fields[0].name === "yt_big" && big.submitLabel === messages.fr.big_stop, "le gros bouton est le premier formulaire");
  assert.ok(blocks.indexOf(big) < blocks.findIndex((b) => b.type === "heading"), "visible sans défiler : avant les règles");
  assert.ok(find(blocks, "adminForm", (b) => b.action === "simulate").length === 1);
  assert.ok(find(blocks, "adminForm", (b) => b.action === "saveRule").length === 1);
  const all = texts(blocks).join("\n");
  assert.match(all, /Gardez cette page ouverte/);
  assert.match(all, /!stop/);
  assert.match(all, /environ|%/);
  const reload = find(blocks, "html", (b) => /location\.reload/.test(b.html))[0];
  assert.ok(reload, "la page se recharge d'elle-même");
  assert.match(reload.html, /getClientRects/, "elle ne recharge pas un onglet caché");
  assert.match(reload.html, /INPUT\|TEXTAREA\|SELECT/, "ni pendant qu'on écrit dans un champ");
  w.done();
});

test("état de la page selon la situation : chaque cas a sa phrase et dit quoi faire", async () => {
  const cases = [
    [{ settings: { readChat: false } }, /coupée dans les Réglages/],
    [{ noBridge: true }, /Il manque le Connecteur Home Assistant/],
    [{ noConnector: true }, /clé YouTube du site/],
    [{ noChannel: true }, /Chaîne YouTube/],
    [{ choice: { status: "ambiguous" } }, /plusieurs chaînes/],
    [{}, /Pas de direct YouTube/],
  ];
  for (const [opts, re] of cases) {
    const w = await world(opts);
    const blocks = await w.panel();
    assert.match(texts(blocks).join("\n"), re, JSON.stringify(opts));
    w.done();
  }
  const w = await world();
  w.yt.goLive({ title: "Soirée jeux" });
  assert.match(texts(await w.panel()).join("\n"), /Je lis le chat de votre direct « Soirée jeux »/);
  w.done();
});

test("sans Home Assistant : le module propose de l'installer, reste utile pour les règles et le journal, et le dit", async () => {
  const w = await world({ noBridge: true });
  const blocks = await w.panel();
  const suggest = find(blocks, "suggestInstall");
  assert.ok(suggest.some((b) => b.service === "home-assistant.bridge"));
  assert.equal(find(blocks, "adminForm", (b) => b.action === "stop").length, 0, "pas de bouton Tout couper sans pont");
  assert.equal(find(blocks, "adminForm", (b) => b.action === "simulate").length, 0);
  assert.match(texts(blocks).join("\n"), /écrire des règles et lire le journal/);
  assert.equal(find(blocks, "adminForm", (b) => b.action === "saveRule").length, 1);
  assert.equal(w.yt.calls.all.length, 0);
  w.done();
});

test("état de la maison : coupée, pas en direct, ne répond plus, pas associée — chacun a sa phrase ; coupée : le bouton devient « Tout reprendre »", async () => {
  const w = await world({ twitchLive: { known: true, live: false } });
  assert.match(texts(await w.panel()).join("\n"), /ne vous voit pas en direct/);
  w.done();
  const w2 = await world({ paired: false });
  assert.match(texts(await w2.panel()).join("\n"), /pas encore associé/);
  w2.done();
  const w3 = await world();
  w3.tick(70_000);
  assert.match(texts(await w3.panel()).join("\n"), /ne répond plus chez vous/);
  await w3.ha.pull(); w3.tick(1100);
  assert.match(texts(await w3.panel()).join("\n"), /connecté et vous voit en direct/);
  await w3.bridge.stop({ by: "test" });
  const blocks = await w3.panel();
  assert.match(texts(blocks).join("\n"), /Tout est coupé/);
  assert.ok(find(blocks, "adminForm", (b) => b.action === "start").length === 1);
  assert.equal(find(blocks, "adminForm", (b) => b.action === "stop").length, 0);
  w3.done();
});

test("droits : sans les droits, ni règles à écrire, ni simulation, ni bouton de coupure", async () => {
  const w = await world({ rights: [] });
  const blocks = await w.panel();
  assert.equal(find(blocks, "adminForm").length, 0);
  assert.match(texts(blocks).join("\n"), /pas le droit de tout couper/);
  w.done();
  const w2 = await world({ rights: ["yt.stop"] });
  const b2 = await w2.panel();
  assert.deepEqual(find(b2, "adminForm").map((b) => b.action), ["stop"]);
  w2.done();
  for (const [name, a] of Object.entries(def.adminActions)) assert.ok(manifest.rights.some((r) => r.id === a.right), `${name} : droit déclaré`);
  assert.equal(def.adminActions.stop.right, "yt.stop"); assert.equal(def.adminActions.simulate.right, "yt.test"); assert.equal(def.adminActions.start.right, "yt.manage");
});

test("anglais : la page est entièrement traduite (aucune clé brute, aucun mot français de l'interface)", async () => {
  const w = await world({ locale: "en" });
  await addRule(w);
  w.yt.goLive();
  const blocks = await w.panel();
  const all = texts(blocks);
  for (const t of all) assert.ok(!/^[a-z]+_[a-z_]+$/.test(t), `clé brute : ${t}`);
  const joined = all.join("\n");
  assert.match(joined, /Keep this page open/); assert.match(joined, /Cut everything/); assert.match(joined, /Super Chat of .* or more/);
  assert.ok(!/Gardez|Tout couper|Ajouter une règle/.test(joined));
  w.done();
});

test("une règle : ajout, erreurs sous le champ, modification qui garde le dernier déclenchement, pause, suppression", async () => {
  const w = await world();
  let r = await act(w, "saveRule", { name: "", type: "superchat", currency: "EUR", min: "x", cooldownSec: "30", action: "lumieres:rouge" });
  assert.deepEqual(Object.keys(r.errors).sort(), ["min", "name"]);
  assert.match(r.errors.min, /5 ou 2,50/);
  r = await act(w, "saveRule", { name: "Rouge", type: "superchat", currency: "EUR", min: "5", cooldownSec: "30", action: "lumieres:rouge" });
  assert.equal(r.ok, messages.fr.done_rule_added); assert.equal(r.redirect, "?");
  const [saved] = await S.listRules(w.ctx);
  await S.touchRule(w.ctx, saved.id, 123456);
  r = await act(w, "saveRule", { id: saved.id, name: "Rouge 2", type: "superchat", currency: "USD", min: "3", cooldownSec: "10", action: "tts:lire", readMessage: "on" });
  assert.equal(r.ok, messages.fr.done_rule_saved);
  const [edited] = await S.listRules(w.ctx);
  assert.equal(edited.id, saved.id); assert.equal(edited.name, "Rouge 2"); assert.equal(edited.lastAt, 123456); assert.equal(edited.readMessage, true); assert.equal((await S.listRules(w.ctx)).length, 1);
  await act(w, "toggleRule", { id: saved.id });
  assert.equal((await S.listRules(w.ctx))[0].enabled, false);
  const panelBlocks = await w.panel();
  assert.match(texts(panelBlocks).join("\n"), /en pause/);
  await act(w, "toggleRule", { id: saved.id });
  assert.equal((await S.listRules(w.ctx))[0].enabled, true);
  const withEdit = await w.panel({ edit: saved.id });
  const form = find(withEdit, "adminForm", (b) => b.action === "saveRule")[0];
  assert.equal(form.fields.find((f) => f.name === "id").value, saved.id);
  assert.equal(form.fields.find((f) => f.name === "name").value, "Rouge 2");
  assert.equal(form.fields.find((f) => f.name === "currency").value, "USD");
  assert.equal(form.fields.find((f) => f.name === "readMessage").value, "on");
  assert.equal(form.cancelHref, "?");
  await act(w, "removeRule", { id: saved.id });
  assert.equal((await S.listRules(w.ctx)).length, 0);
  assert.match((await act(w, "toggleRule", { id: "inconnu" })).error, /n'existe plus/);
  w.done();
});

test("20 règles : le formulaire d'ajout est remplacé par une explication ; l'ajout est refusé", async () => {
  const w = await world();
  for (let i = 0; i < 20; i++) await addRule(w, { name: `r${i}`, type: "member" });
  const blocks = await w.panel();
  assert.equal(find(blocks, "adminForm", (b) => b.action === "saveRule").length, 0);
  assert.match(texts(blocks).join("\n"), /20 règles/);
  const r = await act(w, "saveRule", { name: "21", type: "member", cooldownSec: "1", action: "lumieres:rouge" });
  assert.match(r.error, /20 règles/);
  w.done();
});

test("le tableau des règles se lit en une phrase ; les devises ajoutées en réglage avancé sont proposées", async () => {
  const w = await world({ settings: { extraCurrencies: "ISK, uah, pas-une-devise" } });
  await addRule(w, { name: "A", currency: "*", action: "tts:lire", readMessage: "on" });
  await addRule(w, { name: "B", type: "gift", min: "5", action: "lumieres:vert" });
  const blocks = await w.panel();
  const table = find(blocks, "table")[0];
  assert.deepEqual(table.rows.map((r) => r[0].split(" — ")[0]), ["A", "B"]);
  assert.match(table.rows[0][0], /Super Chat, toutes devises · → tts:lire \+ lit le message · recharge 30 s/);
  assert.match(table.rows[1][0], /Adhésions offertes : 5 ou plus/);
  assert.equal(table.rowIds.length, 2);
  assert.deepEqual(table.rowActions.map((a) => a.action ?? "href"), ["href", "toggleRule", "removeRule"]);
  assert.ok(table.rowActions[2].danger && table.rowActions[2].confirm);
  const cur = find(blocks, "adminForm", (b) => b.action === "saveRule")[0].fields.find((f) => f.name === "currency").options.map((o) => o.value);
  assert.ok(cur.includes("ISK") && cur.includes("UAH") && cur.includes("EUR") && !cur.includes("PAS-UNE-DEVISE"));
  w.done();
});

/* ───────────── Simulation ───────────── */

test("simulation : même chemin qu'un vrai don (règles, maison), AUCUN appel à YouTube, le texte passe par la vérification de la maison", async () => {
  const w = await world();
  await addRule(w, { name: "Rouge", min: "5" });
  await addRule(w, { name: "Voix", action: "tts:lire", readMessage: "on", min: "5" });
  const r = await act(w, "simulate", { type: "superchat", amount: "5", currency: "EUR", text: "Bravo l'équipe" });
  assert.match(r.ok, /Simulation faite\./); assert.match(r.ok, /Rouge : Confié à la maison/);
  assert.equal(w.yt.calls.all.length, 0, "YouTube n'est pas contacté");
  assert.equal(w.ctx.calls.net.length, 0);
  assert.equal(w.yt.fetch.calls.length, 0);
  await w.ha.step();
  assert.deepEqual(w.ha.executed.map((a) => a.key).sort(), ["lumieres:rouge", "tts:lire"]);
  assert.match(w.ha.executed.find((a) => a.key === "tts:lire").text, /Bravo l'équipe/);
  const lines = await w.journal();
  assert.ok(lines.every((l) => l.test === true && l.who === "Test"));
  w.tick(4000);
  const refused = await act(w, "simulate", { type: "superchat", amount: "5", currency: "EUR", text: "what the shit" });
  assert.match(refused.ok, /refusé par la vérification du texte/);
  w.done();
});

test("simulation : un montant faux est signalé sous son champ ; limite d'une toutes les 3 s et de 30 par heure ; sans pont, elle le dit", async () => {
  const w = await world();
  let r = await act(w, "simulate", { type: "superchat", amount: "beaucoup", currency: "EUR" });
  assert.deepEqual(Object.keys(r.errors), ["amount"]); assert.match(r.errors.amount, /5 ou 2,50/);
  r = await act(w, "simulate", { type: "superchat", amount: "5", currency: "E" });
  assert.deepEqual(Object.keys(r.errors), ["currency"]);
  r = await act(w, "simulate", { type: "gift", count: "0" });
  assert.deepEqual(Object.keys(r.errors), ["count"]);
  r = await act(w, "simulate", { type: "autre" });
  assert.deepEqual(Object.keys(r.errors), ["type"]);
  assert.ok((await act(w, "simulate", { type: "member" })).ok);
  assert.match((await act(w, "simulate", { type: "member" })).error, /une simulation toutes les 3 secondes/);
  for (let i = 0; i < 29; i++) { w.tick(3100); assert.ok((await act(w, "simulate", { type: "member" })).ok, `simulation ${i + 2}`); }
  w.tick(3100);
  assert.match((await act(w, "simulate", { type: "member" })).error, /30 simulations/);
  w.done();
  const w2 = await world({ noBridge: true });
  assert.match((await act(w2, "simulate", { type: "member" })).error, /Home Assistant n'est pas installé/);
  w2.done();
});

test("la simulation ne consomme pas le délai de recharge d'une vraie règle", async () => {
  const w = await world();
  await addRule(w, { cooldownSec: "600" });
  await act(w, "simulate", { type: "superchat", amount: "5", currency: "EUR" });
  assert.equal((await S.listRules(w.ctx))[0].lastAt, 0);
  w.yt.goLive(); w.yt.say(w.yt.superChat({ micros: 5_000_000, currency: "EUR", at: Date.now() }));
  await w.read();
  assert.ok((await w.journal()).some((l) => !l.test && l.status === "sent"), "le vrai don joue");
  w.done();
});

/* ───────────── Journal ───────────── */

test("journal : pseudos et noms échappés, phrases claires, test signalé ; suivi de la maison (joué / pas de nouvelle) ; « Vider le journal » efface", async () => {
  const w = await world();
  await addRule(w, { name: "<img src=x onerror=alert(1)>", cooldownSec: "0" });
  w.yt.goLive();
  w.yt.say(w.yt.superChat({ who: "<script>alert(1)</script>", micros: 5_000_000, currency: "EUR", at: Date.now() }));
  await w.read();
  const blocks = await w.panel();
  const html = find(blocks, "html", (b) => /yj-row/.test(b.html))[0].html;
  assert.ok(!/<script>alert|<img src=x/.test(html), "rien de brut venant d'un viewer");
  assert.match(html, /scriptalert\(1\)\/script/, "les chevrons sont retirés des pseudos dès la lecture");
  w.yt.say(w.yt.superChat({ id: "q", who: 'Tom & "Jerry"', micros: 5_000_000, currency: "EUR", at: Date.now() }));
  await w.read(16_000);
  assert.match(find(await w.panel(), "html", (b) => /yj-row/.test(b.html))[0].html, /Tom &amp; &quot;Jerry&quot;/, "et ce qui reste est échappé");
  assert.match(html, /Confié à la maison, en attente/);
  await w.ha.step();
  const after = await w.panel();
  assert.match(find(after, "html", (b) => /yj-row/.test(b.html))[0].html, /Joué chez vous/);
  // pas de nouvelle : une action qui n'est jamais récupérée
  w.yt.say(w.yt.superChat({ id: "z", micros: 5_000_000, currency: "EUR", at: Date.now() }));
  await w.read(16_000);
  w.tick(340_000);
  await E.reconcile(w.ctx);
  assert.equal((await w.journal())[0].status, "expired", "jamais récupérée par Home Assistant : elle a expiré (constaté par la maison)");
  await S.addJournal(w.ctx, [{ kind: "member", who: "Zoé", rule: "R", key: "k", status: "sent", ref: "yt-inconnue", at: Date.now() - 400_000 }]);
  await E.reconcile(w.ctx);
  assert.equal((await w.journal())[0].status, "lost", "aucune nouvelle de la maison au bout de 5 minutes");
  const cleared = await act(w, "clearJournal");
  assert.equal(cleared.ok, messages.fr.done_clear); assert.equal((await w.journal()).length, 0);
  w.done();
});

test("Tout couper / Tout reprendre depuis la page : appellent la maison ; sans elle, un message clair", async () => {
  const w = await world();
  assert.equal((await act(w, "stop")).ok, messages.fr.done_stop);
  assert.equal((await w.bridge.status()).enabled, false);
  assert.equal((await act(w, "start")).ok, messages.fr.done_start);
  assert.equal((await w.bridge.status()).enabled, true);
  w.done();
  const w2 = await world({ noBridge: true });
  assert.match((await act(w2, "stop")).error, /Home Assistant ne répond pas/);
  w2.done();
});

test("la page se recharge plus vite pendant qu'une action attend la maison, et pas du tout quand rien ne se lit", async () => {
  const w = await world();
  const o = await E.overview(w.ctx);
  assert.equal(A.reloadMs({ ...o, state: { ...o.state, status: "off" }, journal: [] }), null);
  assert.equal(A.reloadMs({ ...o, state: { ...o.state, status: "reading", nextPollAt: o.now + 12_000 }, journal: [] }), 12_400);
  assert.equal(A.reloadMs({ ...o, state: { ...o.state, status: "reading", nextPollAt: o.now + 900_000 }, journal: [] }), 60_000);
  assert.equal(A.reloadMs({ ...o, state: { ...o.state, status: "reading", nextPollAt: o.now }, journal: [] }), 4_400 > 4000 ? 4_000 : 0);
  assert.equal(A.reloadMs({ ...o, state: { ...o.state, status: "idle", nextDetectAt: o.now + 100 }, journal: [{ status: "sent", at: o.now - 1000 }] }), 4_000);
  w.done();
});
