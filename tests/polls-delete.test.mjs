// Sondages 1.2.0 : supprimer un sondage (terminé, en cours ou archivé) — confirmation, droit, identifiant forgé, rien d'orphelin, affichage public, bornes, parité FR/EN, mise à jour à chaud.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { world, pollsMod, pollsDef, pollsFr, pollsEn, post, get, tok } from "./helpers/audienceWorld.mjs";
import { def as audDef, req as areq } from "./helpers/audienceHarness.mjs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { pollsStore } from "./helpers/pollsStore.mjs";

const L = await import("../modules/polls/lib.mjs");
const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const manifest = JSON.parse(fs.readFileSync(`${ROOT}/modules/polls/module.json`, "utf8"));
const T0 = Math.floor(Date.now() / 60_000) * 60_000;
const MIN = 60_000;
const flat = (x) => JSON.stringify(x);

let n = 0;
const ctx = (over = {}) => {
  const c = fakeCtx({ moduleId: "polls", key: `del${++n}`, name: "Sondages", basePath: "polls", locale: "fr", messages: pollsFr, ...over });
  c.api.store = pollsStore();
  c.can = () => true;
  return c;
};
const make = async (c, over = {}) => {
  const v = L.validatePollForm({ question: "Quel jeu ?", choices: "Hollow Knight\nCeleste\nHades", max: 1, ...over }, { tz: "Europe/Paris" });
  assert.deepEqual(v.errors, {});
  const r = await pollsMod.createPoll(c, v.value, "Europe/Paris");
  assert.ok(r.ok);
  return r;
};
const vote = (c, slug, ids, i, now) => pollsMod.castVote(c, { slug, token: tok(i), ids, now });
const polls = async (c) => (await c.api.store.list("polls")).map((r) => ({ id: r.id, ...r.data }));
const cfgOf = async (c) => (await c.api.store.list("meta")).find((r) => r.data.k === "cfg")?.data;
const remove = (c, values) => pollsDef.adminActions.remove(c, values);
const close = (c, id) => pollsDef.adminActions.close(c, { id, confirm: "on" });
/** Un sondage terminé, avec k votes. */
const finished = async (c, k = 3, over = {}) => {
  const p = await make(c, over);
  for (let i = 1; i <= k; i++) assert.ok((await vote(c, p.slug, [`c${(i % 3) + 1}`], i)).ok);
  assert.ok((await close(c, p.id)).ok);
  return p;
};
/** Tout ce qu'il y a dans le stockage, par collection (le faux stockage ne dit pas la collection d'une ligne : on liste celles que le module connaît). */
const COLLECTIONS = (ids) => ["polls", "archive", "meta", "rounds", ...ids.map((id) => `b-${id}`)];
const everything = async (c, ids = []) => Object.fromEntries(await Promise.all(COLLECTIONS(ids).map(async (k) => [k, (await c.api.store.list(k, { limit: 10000 })).map((r) => r.id).sort()])));

/* ───────────── Un sondage terminé ───────────── */

test("sondage terminé : la page de confirmation dit ce qui sera perdu ; sans la case, rien ne part ; avec elle, sondage et votes disparaissent", async () => {
  const c = ctx(); const p = await finished(c, 4);
  const view = await pollsDef.adminPanel(c, { query: { delete: p.id } });
  const text = flat(view);
  assert.ok(text.includes("Ce sondage et ses 4 votes seront supprimés définitivement."), "la phrase demandée, avec le nombre de votes");
  const form = view.find((b) => b.action === "remove");
  assert.equal(form.submitLabel, pollsFr.deleteBtn);
  assert.deepEqual(form.fields.map((f) => f.name).sort(), ["confirm", "id"], "sondage terminé : une seule case");
  assert.ok(form.fields.find((f) => f.name === "confirm").required);
  assert.ok(!view.some((b) => b.action === "close"), "pas de proposition de fermer : il est déjà terminé");
  assert.ok(!text.includes(pollsFr.deleteOpenWarn_many.slice(0, 30)));
  const before = c.api.store.writes.length;
  const refused = await remove(c, { id: p.id });
  assert.ok(refused.errors.confirm.includes("rien n'est supprimé") && !refused.ok);
  assert.equal(c.api.store.writes.length, before, "un appel sans confirmation n'écrit rien");
  assert.equal((await polls(c)).length, 1); assert.equal(await c.api.store.count(`b-${p.id}`), 4);
  const done = await remove(c, { id: p.id, confirm: "on" });
  assert.deepEqual([done.ok, done.redirect], ["Sondage supprimé, avec ses 4 votes.", "?"]);
  assert.equal((await polls(c)).length, 0);
  assert.equal(await c.api.store.count(`b-${p.id}`), 0, "les votes sont partis avec lui");
  assert.equal((await remove(c, { id: p.id, confirm: "on" })).error, pollsFr.errGone, "le supprimer deux fois dit simplement qu'il n'existe plus");
});

test("pluriel et zéro : « son vote », « aucun vote ne sera perdu », jamais « 1 votes »", async () => {
  const c = ctx();
  const zero = await make(c, { question: "Zéro ?" });
  const one = await finished(c, 1, { question: "Un ?" });
  assert.ok(flat(await pollsDef.adminPanel(c, { query: { delete: zero.id } })).includes("aucun vote ne sera perdu"));
  assert.ok(flat(await pollsDef.adminPanel(c, { query: { delete: one.id } })).includes("Ce sondage et son vote seront supprimés"));
  assert.equal((await remove(c, { id: one.id, confirm: "on" })).ok, "Sondage supprimé, avec son vote.");
  assert.equal((await remove(c, { id: zero.id, confirm: "on", confirmOpen: "on" })).ok, "Sondage supprimé.");
});

/* ───────────── Un sondage en cours ───────────── */

test("sondage en cours : confirmation renforcée (il est ouvert, ses votes en cours seront perdus), « fermer plutôt » proposé ; la case seule ne suffit pas", async () => {
  const c = ctx(); const p = await make(c);
  for (let i = 1; i <= 5; i++) await vote(c, p.slug, ["c1"], i);
  const view = await pollsDef.adminPanel(c, { query: { delete: p.id } });
  const text = flat(view);
  const warn = view.find((b) => b.type === "banner");
  assert.ok(warn.text.includes("est en cours") && warn.text.includes("5 votes en cours seront perdus"), warn.text);
  assert.ok(text.includes(pollsFr.deleteInstead), "propose de fermer plutôt");
  assert.ok(view.some((b) => b.action === "close"), "avec le vrai bouton « Fermer maintenant » du module");
  const form = view.find((b) => b.action === "remove");
  assert.deepEqual(form.fields.map((f) => f.name).sort(), ["confirm", "confirmOpen", "id"]);
  assert.ok(form.fields.find((f) => f.name === "confirmOpen").required && form.fields.find((f) => f.name === "confirmOpen").label.includes("en cours"));
  const before = c.api.store.writes.length;
  const half = await remove(c, { id: p.id, confirm: "on" });
  assert.ok(half.errors.confirmOpen.includes("en cours") && half.error, "la confirmation renforcée manque : erreur sous la case");
  const none = await remove(c, { id: p.id, confirmOpen: "on" });
  assert.ok(none.errors.confirm, "et l'autre case aussi");
  assert.equal(c.api.store.writes.length, before, "rien n'est écrit");
  assert.equal((await polls(c))[0].voters, 5);
  const ok = await remove(c, { id: p.id, confirm: "on", confirmOpen: "on" });
  assert.equal(ok.ok, "Sondage supprimé, avec ses 5 votes.");
  assert.equal((await polls(c)).length, 0); assert.equal(await c.api.store.count(`b-${p.id}`), 0);
});

test("un sondage qui s'est rouvert ou fermé entre l'affichage et le clic : le serveur relit l'état, jamais le formulaire", async () => {
  const c = ctx(); const p = await make(c);
  await vote(c, p.slug, ["c1"], 1);
  // la page a été affichée quand le sondage était terminé (une seule case) mais il est ouvert au moment du clic
  const r = await remove(c, { id: p.id, confirm: "on", open: "no", state: "closed", voters: "0", slug: "autre" });
  assert.ok(r.errors.confirmOpen && (await polls(c)).length === 1, "les champs du formulaire sont ignorés");
  // l'inverse : affiché ouvert (deux cases), terminé au moment du clic : tout passe, la case en plus ne gêne pas
  await close(c, p.id);
  assert.ok((await remove(c, { id: p.id, confirm: "on", confirmOpen: "on" })).ok);
});

/* ───────────── Droit, identifiant forgé ───────────── */

test("droit : sans « manage », ni la page ni l'action ne suppriment, rien n'est écrit ; le droit relu côté serveur", async () => {
  const c = ctx(); const p = await finished(c);
  c.can = (r) => r === "obs.view";
  const before = c.api.store.writes.length;
  assert.equal((await remove(c, { id: p.id, confirm: "on", confirmOpen: "on" })).error, pollsFr.errRight);
  assert.equal(c.api.store.writes.length, before);
  const view = await pollsDef.adminPanel(c, { query: { delete: p.id } });
  assert.ok(!view.some((b) => b.type === "adminForm") && flat(view).includes(pollsFr.errRight), "pas de formulaire sans le droit");
  assert.ok(!flat(await pollsDef.adminPanel(c, { query: {} })).includes("?delete="), "pas de lien « Supprimer » sans le droit");
  assert.equal((await polls(c)).length, 1);
  assert.equal(manifest.rights.find((r) => r.id === "manage").label.fr.includes("supprimer"), true, "le droit « manage » dit déjà qu'il couvre la suppression");
  assert.deepEqual(manifest.rights.map((r) => r.id).sort(), ["manage", "obs.view"], "aucun nouveau droit : manage couvre déjà la suppression des sondages");
  assert.deepEqual(manifest.rights.find((r) => r.id === "manage").default, { admin: true, editor: false });
});

test("identifiant forgé ou inconnu : rien n'est supprimé (ni sondage, ni vote, ni réglage, ni décision)", async () => {
  const c = ctx(); const p = await finished(c, 2);
  await pollsMod.startSeries(c, T0);                                       // crée la configuration des manches, une manche
  await pollsMod.nextRound(c, T0 + MIN);                                   // et une décision dans l'historique
  const cfgRow = (await c.api.store.list("meta")).find((r) => r.data.k === "cfg");
  const seriesRow = (await c.api.store.list("meta")).find((r) => r.data.k === "series");
  const decision = (await c.api.store.list("rounds"))[0];
  const ballot = (await c.api.store.list(`b-${p.id}`))[0];
  const snapshot = await everything(c, [p.id]);
  const forged = ["", "nope", "r999999", cfgRow.id, seriesRow.id, decision.id, ballot.id, "x".repeat(500), "../polls", null, undefined, 42, { id: p.id }, [p.id], `${p.id} `];
  for (const id of forged) {
    const r = await remove(c, { id, confirm: "on", confirmOpen: "on" });
    assert.ok(r.error && !r.ok, `refusé : ${String(id).slice(0, 20)}`);
    await assert.rejects(pollsDef.mcp.poll_delete(c, { id, allowOpen: true }), (e) => e.expose && /poll not found/.test(e.message));
  }
  assert.deepEqual(await everything(c, [p.id]), snapshot, "rien n'a bougé");
  const view = await pollsDef.adminPanel(c, { query: { delete: cfgRow.id } });
  assert.ok(flat(view).includes(pollsFr.errGone) && !view.some((b) => b.type === "adminForm"), "la page de confirmation d'une ligne qui n'est pas un sondage n'ouvre rien");
});

/* ───────────── Rien d'orphelin ───────────── */

test("rien d'orphelin : options, votes, totaux, place à l'écran ; les autres sondages et l'historique des décisions ne bougent pas", async () => {
  const c = ctx(); const a = await finished(c, 6, { question: "A ?" }); const b = await finished(c, 3, { question: "B ?" });
  await pollsMod.startSeries(c, T0); await pollsMod.nextRound(c, T0 + MIN);
  assert.ok((await pollsDef.adminActions.onAir(c, { id: a.id })).ok);
  assert.equal((await cfgOf(c)).onAir, a.slug);
  const decisions = (await c.api.store.list("rounds")).map((r) => r.id);
  const bBallots = (await c.api.store.list(`b-${b.id}`)).map((r) => r.id);
  assert.ok((await remove(c, { id: a.id, confirm: "on" })).ok);
  assert.equal(await c.api.store.count(`b-${a.id}`), 0);
  assert.equal((await polls(c)).filter((p) => p.slug === a.slug).length, 0);
  assert.equal(await c.api.store.count("archive"), 0);
  const cfg = await cfgOf(c);
  assert.deepEqual([cfg.onAir, cfg.onAirUntil], [null, null], "la place à l'écran est libérée");
  assert.ok(!flat(await c.api.store.all()).includes(a.slug) && !flat(await c.api.store.all()).includes(a.id), "plus aucune ligne ne parle de ce sondage");
  assert.deepEqual((await c.api.store.list("rounds")).map((r) => r.id), decisions, "l'historique des décisions n'est pas touché");
  assert.deepEqual((await c.api.store.list(`b-${b.id}`)).map((r) => r.id), bBallots, "les votes des autres sondages non plus");
  assert.equal((await polls(c)).filter((p) => !p.round).length, 1);
});

test("manches : la manche en cours ne se supprime pas ici (« Arrêter » ou « Suivant » s'en chargent) ; une ancienne manche restée là se supprime", async () => {
  const c = ctx();
  await pollsMod.startSeries(c, T0);
  const cur = (await polls(c)).find((p) => p.round);
  await vote(c, cur.slug, ["c1"], 1, T0 + 1000);
  const view = await pollsDef.adminPanel(c, { query: { delete: cur.id } });
  assert.ok(flat(view).includes("manche en cours") && !view.some((b) => b.type === "adminForm"), "pas de bouton : on dit quoi faire");
  const r = await remove(c, { id: cur.id, confirm: "on", confirmOpen: "on" });
  assert.equal(r.error, pollsFr.deleteRound);
  await assert.rejects(pollsDef.mcp.poll_delete(c, { id: cur.id, allowOpen: true }), (e) => e.expose && /running round/.test(e.message));
  assert.equal((await polls(c)).length, 1); assert.equal(await c.api.store.count(`b-${cur.id}`), 1);
  assert.equal((await pollsMod.stopSeries(c, T0 + MIN)).ok, true);
  assert.equal((await polls(c)).length, 0, "« Arrêter » reste le seul propriétaire de la manche");
  // une manche d'une série arrêtée qui serait restée (donnée d'avant) : plus liée à rien, elle se supprime
  const stale = await pollsMod.createPoll(c, { question: "Reste ?", choices: ["A", "B"], max: 1, endsAt: new Date(T0 + 10 * MIN).toISOString(), resultsMode: "always" }, "Europe/Paris", T0, { round: { n: 9, run: "old" } });
  assert.ok((await remove(c, { id: stale.id, confirm: "on", confirmOpen: "on" })).ok);
  assert.equal((await polls(c)).length, 0);
});

test("sondage archivé : listé dans l'administration (50 par page), ouvrable, supprimable ; sa page publique le dit aussi", async () => {
  const c = ctx(); const p = await finished(c, 3);
  assert.ok((await pollsDef.adminActions.archive(c, { id: p.id, confirm: "on" })).ok);
  const [row] = await c.api.store.list("archive");
  const list = flat(await pollsDef.adminPanel(c, { query: {} }));
  assert.ok(list.includes(`?poll=${row.id}`) && list.includes(`?delete=${row.id}`), "visible et supprimable depuis la liste");
  const detail = await pollsDef.adminPanel(c, { query: { poll: row.id } });
  assert.ok(flat(detail).includes(pollsFr.stateArchived) && !detail.some((b) => b.action === "reopen" || b.action === "recount" || b.action === "archive"), "un sondage archivé n'a que « Supprimer »");
  assert.ok(flat(detail).includes(`?delete=${row.id}`));
  assert.ok(flat(await pollsDef.adminPanel(c, { query: { delete: row.id } })).includes("Ce sondage et ses 3 votes seront supprimés définitivement."));
  assert.equal((await pollsDef.page(c, { segments: [p.slug] })).blocks[0].html.includes(pollsFr.finalResult), true);
  assert.ok((await remove(c, { id: row.id, confirm: "on" })).ok);
  assert.equal(await c.api.store.count("archive"), 0);
  assert.equal((await pollsDef.page(c, { segments: [p.slug] })).title, pollsFr.goneTitle);
  for (let i = 0; i < 60; i++) await c.api.store.add("archive", { slug: `a${i}-zzzz`, question: `Q${i}`, choices: [{ id: "c1", text: "A" }, { id: "c2", text: "B" }], counts: {}, voters: 0, archivedAt: new Date(T0).toISOString(), createdAt: new Date(T0).toISOString() }, { key: `a${i}-zzzz` });
  const page1 = await pollsDef.adminPanel(c, { query: {} });
  assert.equal(flat(page1).split("?delete=").length - 1, 50, "50 archives au plus par page");
  assert.ok(flat(page1).includes("?ac="), "page suivante");
});

/* ───────────── Affichage public, écran, consommateurs ───────────── */

test("après la suppression : adresse publique neutre (même réponse qu'une adresse jamais vue), vote et résultats refusés proprement, listes, accueil, écran", async () => {
  const c = ctx(); const keep = await make(c, { question: "Reste ?" }); const p = await make(c, { question: "Part ?" });
  await vote(c, p.slug, ["c2"], 1);
  assert.equal((await pollsDef.page(c, { segments: [p.slug] })).title, "Part ?");
  assert.ok((await pollsDef.adminActions.onAir(c, { id: p.id })).ok);
  assert.ok((await remove(c, { id: p.id, confirm: "on", confirmOpen: "on" })).ok);
  const gone = await pollsDef.page(c, { segments: [p.slug] });
  const never = await pollsDef.page(c, { segments: ["jamais-existe-0000"] });
  assert.deepEqual(gone, never, "aucune fuite : supprimé ou jamais créé, c'est la même page");
  assert.equal(gone.title, "Ce sondage n'existe plus"); assert.equal(gone.robots, undefined, "pas de robots:noindex, qui exigerait un minCore plus récent");
  const html = gone.blocks[0].html;
  assert.ok(html.includes("Cette adresse ne mène à aucun sondage.") && /href="(\/fr)?\/polls"/.test(html) && !html.includes("Part ?") && !html.includes(p.slug), "ni question, ni adresse, ni chiffre");
  assert.equal(flat(gone).includes("Part ?"), false);
  const en = ctx({ locale: "en", messages: pollsEn });
  assert.equal((await pollsDef.page(en, { segments: ["x-0000"] })).title, "This poll no longer exists");
  const v = await pollsDef.routes.vote(post("https://x.test/m/k/vote", { poll: p.slug, t: tok(2), c: ["c1"] }), c);
  assert.deepEqual([v.status, (await v.json()).reason], [404, "gone"]);
  const r = await pollsDef.routes.results(post("https://x.test/m/k/results", { poll: p.slug, t: tok(1) }), c);
  assert.deepEqual([r.status, (await r.json()).reason], [404, "gone"]);
  assert.equal(pollsFr.msg_gone, "Ce sondage n'existe plus.");
  const list = flat(await pollsDef.page(c, { segments: [] }));
  assert.ok(!list.includes("Part ?") && list.includes("Reste ?"));
  assert.ok(flat(await pollsDef.sections.current(c, {})).includes("Reste ?"), "l'accueil montre l'autre sondage ouvert");
  await remove(c, { id: keep.id, confirm: "on", confirmOpen: "on" });
  assert.equal(await pollsDef.sections.current(c, {}), null, "plus de sondage : l'encart disparaît de l'accueil");
  assert.equal(await pollsDef.slots["layout.head"](c), null, "et le petit script n'est plus demandé");
  assert.equal(await pollsDef.news(Object.assign(c, { visit: { lastVisit: new Date(T0 - 1000) } })), false);
  assert.deepEqual(await pollsDef.mcp.polls_list(c, {}), []);
  await assert.rejects(pollsDef.mcp.poll_results(c, { id: p.slug }), (e) => e.expose);
});

test("écran OBS : la source qui montrait ce sondage ne montre plus rien (jamais un autre sondage à sa place) ; sans choix précis, retour à l'automatique", async () => {
  const c = ctx(); const other = await make(c, { question: "Autre ?" }); const p = await make(c, { question: "Affiché ?" });
  const key = (await cfgOf(c) ?? (await pollsDef.hooks.onInstanceCreate(c), await cfgOf(c))).obsKey;
  const live = async (q = "") => (await pollsDef.routes.live(new Request(`https://x.test/m/k/live?k=${key}${q}`), c)).json();
  await pollsDef.adminActions.onAir(c, { id: p.id });
  assert.equal((await live()).question, "Affiché ?");
  assert.equal((await live(`&poll=${p.slug}`)).question, "Affiché ?");
  assert.ok((await remove(c, { id: p.id, confirm: "on", confirmOpen: "on" })).ok);
  assert.equal((await live(`&poll=${p.slug}`)).empty, true, "adresse épinglée sur le sondage supprimé : écran vide, sans erreur");
  assert.equal((await live()).question, "Autre ?", "affichage automatique : le sondage ouvert le plus récent");
  assert.equal((await pollsDef.routes.live(new Request(`https://x.test/m/k/live?k=${key}&poll=${p.slug}`), c)).status, 200);
  const o = await pollsDef.overlay(c, { query: new URLSearchParams(`k=${key}&poll=${p.slug}`) });
  assert.ok(o.script && o.html && !flat(o).includes("Affiché ?"));
});

test("avec Participation : l'écran du stream et la page « en cours » sont republiés tout de suite (rien de pendant), sans erreur si Participation est en panne", async () => {
  const w = world(); const p = await make(w.polls, { question: "Direct ?" });
  await vote(w.polls, p.slug, ["c1"], 1); await pollsMod.syncLive(w.polls);
  const live = async () => Object.fromEntries((await w.aud.api.store.list("live")).map((r) => [r.data.channel, JSON.parse(r.data.json)]));
  assert.equal((await live()).now.slug, p.slug); assert.equal((await live()).screen.question, "Direct ?");
  assert.ok((await remove(w.polls, { id: p.id, confirm: "on", confirmOpen: "on" })).ok);
  await pollsMod.syncLive(w.polls);
  const after = await live();
  assert.equal(after.screen.empty, true); assert.equal(after.now.empty, true);
  assert.ok(!flat(after).includes("Direct ?") && !flat(after).includes(p.slug), "plus rien du sondage chez Participation");
  const key = (await w.polls.api.store.list("meta")).find((r) => r.data.k === "cfg").data.obsKey;
  const read = await audDef.routes.direct(areq(`https://x.test/m/audience/direct?room=${encodeURIComponent(`polls:${w.polls.instance.key}`)}&channel=screen&k=${key}`, undefined, { ip: "9.9.1.1" }), w.aud).then((r) => r.json());
  assert.ok(read.empty === true || read.data?.empty === true, JSON.stringify(read));
  // Participation en panne : la suppression réussit quand même
  const w2 = world(); const q = await make(w2.polls); w2.down(true);
  assert.ok((await remove(w2.polls, { id: q.id, confirm: "on", confirmOpen: "on" })).ok);
  assert.equal((await w2.polls.api.store.list("polls")).length, 0);
});

test("consommateurs : aucun autre module ne lit les sondages (ni sujet, ni service, ni besoin) ; seul Participation garde des « voix » de salle, expirées chez lui", () => {
  assert.equal(manifest.provides, undefined, "Sondages ne publie aucun sujet");
  assert.deepEqual((manifest.offers ?? []).map((o) => o.service), ["audience.remote"]);
  const dirs = fs.readdirSync(`${ROOT}/modules`).filter((d) => d !== "polls" && fs.existsSync(`${ROOT}/modules/${d}/module.json`));
  assert.ok(dirs.length > 30);
  const refs = [];
  for (const d of dirs) {
    const m = JSON.parse(fs.readFileSync(`${ROOT}/modules/${d}/module.json`, "utf8"));
    const wanted = [...(m.requires ?? []), ...(m.consumes ?? []), ...(m.needs ?? [])].map((x) => x.service ?? x.topic ?? x.id ?? x);
    const offered = [...(m.provides ?? []), ...(m.offers ?? [])].map((x) => x.topic ?? x.service ?? x.id ?? x);
    for (const id of [...wanted, ...offered]) if (/^polls?\b|^polls?[.:]/.test(String(id))) refs.push(`${d} → ${id}`);
    assert.ok(!/\bpolls:/.test(JSON.stringify(m.permissions ?? [])), d);
  }
  assert.deepEqual(refs, [], "aucun consommateur : rien à mettre à jour ailleurs");
  const topics = fs.readFileSync(`${ROOT}/docs/TOPICS.md`, "utf8");
  assert.ok(!/\bpolls\b/i.test(topics), "aucun sujet « polls » dans le registre");
  // le seul lien : la télécommande de Participation (service audience.remote), qui ne garde aucune adresse de sondage
  const remote = fs.readFileSync(`${ROOT}/modules/audience/remote.mjs`, "utf8") + fs.readFileSync(`${ROOT}/modules/audience/index.mjs`, "utf8");
  assert.ok(!/pollId|poll\.slug|\/polls\//.test(remote));
});

/* ───────────── Outil pour l'assistant ───────────── */

test("outil poll_delete : déclaré destructeur et jamais accordé d'office ; un sondage ouvert demande allowOpen ; erreurs lisibles", async () => {
  const tool = manifest.mcp.find((t) => t.name === "poll_delete");
  assert.deepEqual([tool.destructive, tool.default, tool.readOnly], [true, false, undefined]);
  assert.deepEqual(tool.input.required, ["id"]);
  assert.ok(manifest.mcp.some((t) => t.name === "poll_create") && manifest.mcp.some((t) => t.name === "poll_close"), "le module avait déjà des outils d'écriture");
  assert.ok(tool.name.length <= 31 && /ask the person first/.test(tool.description));
  const c = ctx(); const p = await make(c); await vote(c, p.slug, ["c1"], 1); await vote(c, p.slug, ["c2"], 2);
  await assert.rejects(pollsDef.mcp.poll_delete(c, { id: p.id }), (e) => e.expose && /open with 2 votes.*poll_close/.test(e.message));
  await assert.rejects(pollsDef.mcp.poll_delete(c, { id: p.id, allowOpen: "true" }), (e) => e.expose, "« true » en texte ne compte pas");
  assert.equal((await polls(c)).length, 1);
  assert.deepEqual(await pollsDef.mcp.poll_delete(c, { id: p.id, allowOpen: true }), { id: p.id, deleted: true, votesDeleted: 2 });
  assert.equal(await c.api.store.count(`b-${p.id}`), 0);
  const done = await finished(c, 1);
  assert.deepEqual(await pollsDef.mcp.poll_delete(c, { id: done.id }), { id: done.id, deleted: true, votesDeleted: 1 }, "un sondage terminé n'a pas besoin d'allowOpen");
  await assert.rejects(pollsDef.mcp.poll_delete(c, { id: done.id }), (e) => e.expose && /poll not found/.test(e.message));
  await assert.rejects(pollsDef.mcp.poll_delete(c, {}), (e) => e.expose);
});

/* ───────────── Bornes ───────────── */

test("bornes : des milliers de votes s'effacent par tranches de 200, sans lecture non bornée ; rien en arrière-plan", async () => {
  const c = ctx(); const p = await make(c);
  const f = await c.api.store.get(p.id); await c.api.store.update(p.id, { ...f.data, closedAt: new Date(T0).toISOString(), voters: 5000, counts: { c1: 5000 } });
  for (let i = 0; i < 5000; i++) await c.api.store.add(`b-${p.id}`, { k: `k${i}`, c: ["c1"] }, { key: `k${i}` });
  const real = c.api.store.page; const reads = [];
  c.api.store.page = async (col, o) => { reads.push([col, o?.limit]); return real(col, o); };
  const list = c.api.store.list; c.api.store.list = async (col, o) => { reads.push([col, o?.limit, "list"]); return list(col, o); };
  const r = await remove(c, { id: p.id, confirm: "on" });
  assert.ok(r.ok.includes("5000 votes"), r.ok);
  assert.equal(await c.api.store.count(`b-${p.id}`), 0);
  const ballotReads = reads.filter(([col]) => col === `b-${p.id}`);
  assert.ok(ballotReads.length <= 30 && ballotReads.every(([, limit]) => limit === 200), `tranches de 200, ${ballotReads.length} lectures au plus 30`);
  assert.ok(reads.every(([col, limit]) => limit <= 200 || !col.startsWith("b-")), "aucune lecture des votes plus large qu'une tranche");
  assert.ok(!/setInterval|setTimeout/.test(fs.readFileSync(`${ROOT}/modules/polls/index.mjs`, "utf8")), "aucun minuteur");
  assert.equal(pollsDef.tasks, undefined);
});

test("bornes : si des votes ne partent pas, la suppression s'arrête après 30 tranches, le dit, laisse le sondage FERMÉ (personne ne revote), et un nouvel essai la termine", async () => {
  const c = ctx(); const p = await make(c);
  await vote(c, p.slug, ["c1"], 1);
  const realRemove = c.api.store.remove; let stuck = true; let attempts = 0;
  c.api.store.remove = async (id) => { const r = (await c.api.store.get(id)); if (stuck && r && r.data.k && r.data.c) { attempts++; return; } return realRemove(id); };
  const r = await remove(c, { id: p.id, confirm: "on", confirmOpen: "on" });
  assert.equal(r.error, pollsFr.errDeletePartial);
  assert.ok(attempts <= 30 * 200, "borné");
  const row = (await polls(c))[0];
  assert.ok(row && L.stateOf(row) === "closed", "le sondage existe encore, fermé");
  assert.equal((await vote(c, p.slug, ["c2"], 2)).error, "closed");
  stuck = false;
  assert.ok((await remove(c, { id: p.id, confirm: "on" })).ok);
  assert.equal(await c.api.store.count(`b-${p.id}`), 0); assert.equal((await polls(c)).length, 0);
  const t = ctx(); const q = await make(t); await vote(t, q.slug, ["c1"], 1);
  assert.equal(await pollsMod.deletePoll(t, q.id).then((x) => x.error), "open", "la fonction elle-même refuse un sondage ouvert sans allowOpen");
});

test("verrou : un vote qui arrive pendant la suppression attend la fin, puis trouve un sondage qui n'existe plus (pas de vote sans sondage)", async () => {
  const c = ctx(); const p = await make(c);
  for (let i = 1; i <= 30; i++) await vote(c, p.slug, ["c1"], i);
  const [d, v] = await Promise.all([pollsMod.deletePoll(c, p.id, { allowOpen: true }), vote(c, p.slug, ["c2"], 99)]);
  assert.equal(d.ok, true);
  assert.deepEqual([v.ok, v.error].includes("gone") || v.ok === true, true);
  assert.equal(await c.api.store.count("polls"), 0);
  assert.equal(await c.api.store.count(`b-${p.id}`), 0, "qu'il soit passé juste avant ou refusé juste après, aucun vote « fantôme » ne reste");
  assert.equal((await pollsDef.page(c, { segments: [p.slug] })).title, pollsFr.goneTitle);
});

/* ───────────── Textes : parité FR/EN, mots simples ───────────── */

test("textes : parité EXACTE fr/en (mêmes clés, mêmes {variables}), toutes les clés de la suppression présentes, aucun jargon", () => {
  assert.deepEqual(Object.keys(pollsFr).sort(), Object.keys(pollsEn).sort());
  const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  for (const k of Object.keys(pollsFr)) assert.equal(vars(pollsFr[k]), vars(pollsEn[k]), `variables de « ${k} »`);
  const keys = ["goneTitle", "goneText", "stateArchived", "deleteTitle", "deleteLost_zero", "deleteLost_one", "deleteLost_many", "deleteOpenWarn_zero", "deleteOpenWarn_one", "deleteOpenWarn_many", "deleteInstead", "deleteBtn", "deleteRound",
    "confirmDelete", "confirmDeleteOpen", "errConfirmDelete", "errConfirmOpen", "errConfirmOpenBanner", "errDeletePartial", "okDeleted", "okDeletedOne", "okDeletedMany", "actDelete"];
  for (const k of keys) assert.ok(pollsFr[k] && pollsEn[k] && pollsFr[k] !== pollsEn[k] || k === "x", k);
  const source = fs.readFileSync(`${ROOT}/modules/polls/index.mjs`, "utf8");
  for (const m of source.matchAll(/\bt\("([A-Za-z0-9_]+)"/g)) assert.ok(m[1] in pollsEn && m[1] in pollsFr, m[1]);
  assert.match(pollsFr.deleteLost_many, /^Ce sondage et ses \{n\} votes seront supprimés définitivement\./);
  assert.match(pollsEn.deleteLost_many, /^This poll and its \{n\} votes will be deleted for good\./);
  const jargon = /(\bID\b|identifiant|collection|requête|API|JSON|slug|base de données|token|\bhash\b)/i;
  for (const k of keys) assert.ok(!jargon.test(pollsFr[k]) && !jargon.test(pollsEn[k]), `mots simples : ${k}`);
  for (const k of keys.filter((x) => /^(delete|confirmDelete|err(Confirm|Delete)|okDeleted)/.test(x))) assert.ok(!/\bvous\s+êtes\b|\btu\b|\bton\b|\bta\b/i.test(pollsFr[k].replace(/ton vote/g, "")), `vouvoiement : ${k}`);
});

test("la version et la mise à jour à chaud : 1.3.0, minCore 0.5.0 (éléments d'overlay), et apiVersion inchangés, aucune migration ; le module rechargé avec ?v= supprime comme avant", async () => {
  assert.equal(manifest.version, "1.3.0"); assert.equal(manifest.minCore, "0.5.0"); assert.equal(manifest.apiVersion, 2);
  assert.ok((manifest.dataVersion ?? 1) === 1 && !manifest.migrations, "aucune migration : aucune donnée n'est ajoutée ni transformée");
  const hot = await import("../modules/polls/index.mjs?v=1.2.0-hot");
  assert.equal(typeof hot.deletePoll, "function");
  const c = ctx(); const p = await finished(c, 2);
  assert.equal((await hot.default.adminActions.remove(c, { id: p.id, confirm: "on" })).ok, "Sondage supprimé, avec ses 2 votes.");
  const src = fs.readFileSync(`${ROOT}/modules/polls/index.mjs`, "utf8");
  assert.ok(/await import\(`\.\/lib\.mjs\$\{V\}`\)/.test(src) && !/^import .* from "\.\//m.test(src), "les fichiers voisins se chargent avec la version");
});
