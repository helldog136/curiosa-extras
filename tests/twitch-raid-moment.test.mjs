// Raid Twitch 2.2 — LA SÉLECTION DU MOMENT (moment.mjs) : stabilité pendant la durée, renouvellement, « Tirer de nouveau », rotation, remplacement d'un membre parti, moins de
// membres que demandé, personne en direct, exclusions, poids, consentement (« Ne pas montrer »), Twitch ou Contacts en panne ou lent, grande communauté (plus de 500 chaînes),
// cache et quota de Twitch. Contacts et Twitch sont des doubles ; l'horloge de la sélection est injectée (`hooks.now`).
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { world, logins, login, T0 } from "./helpers/twitch-raid-world.mjs";

const M = await import("../modules/twitch-raid/moment.mjs");
const live = await import("../modules/twitch-raid/live.mjs");
const search = await import("../modules/twitch-raid/search.mjs");
const source = await import("../modules/twitch-raid/source.mjs");
const streams = await import("../modules/twitch-raid/streams.mjs");
const consent = await import("../modules/twitch-raid/consent.mjs");

const MIN = 60_000;
let clock;
const at = (min) => { clock = T0 + min * MIN; };
const t0 = { ...streams.timing }, st0 = { ...source.timing }, mt0 = { ...M.timing }, ct0 = { ...consent.timing }, lim0 = { ...search.limits };
beforeEach(() => { live.resetLive(); search.resetSearch(); source.resetSource(); M.resetMoment(); at(0); M.hooks.now = () => clock; M.hooks.rng = null; });
afterEach(() => { Object.assign(streams.timing, t0); Object.assign(source.timing, st0); Object.assign(M.timing, mt0); Object.assign(consent.timing, ct0); Object.assign(search.limits, lim0); });

/** Les directs : les n premiers pseudos de la liste, avec des spectateurs différents. */
const lives = (n, from = 0, viewers = (i) => 5 + i) => Object.fromEntries(logins(n, from).map((l, i) => [l, { viewers: viewers(i), minutes: 20 + i }]));
const refreshTwitch = () => { live.resetLive(); search.resetSearch(); };
const L = (r) => r.picks.map((p) => p.login);
// Un minuteur toujours actif pendant la lecture : sans lui, Node croit la boucle vide quand un faux service « muet » ne répond jamais (les bornes du module, elles, n'ont pas de minuteur qui retient le processus).
const read = async (w) => { const keep = setInterval(() => {}, 25); try { return await M.momentNow(w.ctx); } finally { clearInterval(keep); } };
const site = (o = {}) => world({ partners: logins(o.partners ?? 30), live: o.live ?? lives(o.liveCount ?? 30), settings: o.settings ?? {}, ...(o.extra ?? {}) });

test("la sélection : 5 membres en direct par défaut, jamais plus de ce qui est en direct, avec nom, jeu, titre, spectateurs et durée", async () => {
  const r = await read(site());
  assert.equal(r.state, "ok"); assert.equal(r.picks.length, 5); assert.equal(r.count, 5); assert.equal(r.minutes, 10);
  assert.equal(new Set(L(r)).size, 5);
  for (const p of r.picks) assert.deepEqual(Object.keys(p).sort(), ["game", "login", "name", "startedAt", "thumb", "title", "viewers"]);
  assert.equal(r.endsAt, T0 + 10 * MIN);
  assert.equal(r.pool, 30);
});

test("stable : toutes les lectures de la tranche donnent les MÊMES membres (autre visiteur, rafraîchissement, Twitch relu), avec les chiffres à jour", async () => {
  const w = site();
  const first = await read(w);
  for (let i = 0; i < 15; i++) {
    at(i * 0.6);
    refreshTwitch();
    for (const l of L(first)) w.api.streams.get(l).viewers += 1;
    assert.deepEqual(L(await read(w)), L(first), `lecture ${i}`);
  }
  const last = await read(w);
  assert.ok(last.picks.every((p) => p.viewers > first.picks.find((x) => x.login === p.login).viewers), "les spectateurs sont ceux d'aujourd'hui");
  const [a, b] = await Promise.all([read(w), read(w)]);
  assert.deepEqual(L(a), L(b));
});

test("deux lectures qui arrivent en même temps sur une tranche neuve donnent le même tirage", async () => {
  const w = site();
  const rs = await Promise.all(Array.from({ length: 8 }, () => read(w)));
  assert.equal(new Set(rs.map((r) => L(r).join())).size, 1);
});

test("renouvellement : à la tranche suivante, une nouvelle sélection ; personne ne revient tant que d'autres sont en direct", async () => {
  const w = site();
  const a = await read(w);
  at(9.9); refreshTwitch(); assert.deepEqual(L(await read(w)), L(a), "encore la même juste avant la fin");
  at(10); refreshTwitch(); const b = await read(w);
  assert.notDeepEqual(L(b), L(a));
  assert.ok(L(b).every((l) => !L(a).includes(l)), "aucune des personnes de la sélection précédente");
  assert.equal(b.endsAt, T0 + 20 * MIN);
  at(20); refreshTwitch(); const c = await read(w);
  assert.ok(L(c).every((l) => !L(a).includes(l) && !L(b).includes(l)));
});

test("durée réglable : 3 minutes → la sélection change toutes les 3 minutes ; les valeurs illisibles donnent 10 ; 1 à 240 seulement", async () => {
  const w = site({ settings: { duration: 3 } });
  const a = await read(w); assert.equal(a.minutes, 3); assert.equal(a.endsAt, T0 + 3 * MIN);
  at(2.9); refreshTwitch(); assert.deepEqual(L(await read(w)), L(a));
  at(3); refreshTwitch(); assert.notDeepEqual(L(await read(w)), L(a));
  for (const [raw, want] of [["", 10], ["abc", 10], [0, 1], [9999, 240], [undefined, 10]]) assert.equal((await read(site({ settings: { duration: raw } }))).minutes, want, String(raw));
});

test("nombre réglable : 1 à 10 (5 par défaut), ramené dans l'intervalle", async () => {
  for (const [raw, want] of [[3, 3], [10, 10], [1, 1], [0, 1], [50, 10], ["", 5], [undefined, 5], ["7", 7]]) {
    const r = await read(site({ settings: { count: raw } }));
    assert.equal(r.picks.length, want, String(raw)); assert.equal(r.count, want);
  }
});

test("« Tirer de nouveau » : une nouvelle sélection pour tout le monde, au plus une fois toutes les 5 secondes", async () => {
  const w = site();
  const a = await read(w);
  at(0.2);
  const b = await M.momentNow(w.ctx, { reroll: true });
  assert.equal(b.rerolled, true); assert.ok(L(b).every((l) => !L(a).includes(l)), "d'autres personnes");
  assert.deepEqual(L(await read(w)), L(b), "tous les visiteurs voient la nouvelle");
  at(0.25);
  const c = await M.momentNow(w.ctx, { reroll: true });
  assert.equal(c.wait, true); assert.equal(c.rerolled, undefined); assert.deepEqual(L(c), L(b), "rien ne change");
  at(0.5);
  const d = await M.momentNow(w.ctx, { reroll: true });
  assert.equal(d.rerolled, true); assert.ok(L(d).every((l) => !L(b).includes(l)));
  assert.equal(d.endsAt, b.endsAt, "la fin de la tranche ne bouge pas");
});

test("rotation équitable : 12 membres, 4 par tranche, 6 tranches → chacun est montré exactement deux fois", async () => {
  const w = site({ partners: 12, liveCount: 12, settings: { count: 4 } });
  const times = new Map();
  for (let i = 0; i < 6; i++) { at(i * 10); refreshTwitch(); for (const l of L(await read(w))) times.set(l, (times.get(l) ?? 0) + 1); }
  assert.equal(times.size, 12);
  assert.ok([...times.values()].every((n) => n === 2), JSON.stringify([...times]));
});

test("un membre choisi qui n'est plus en direct est remplacé ; les autres ne bougent pas", async () => {
  const w = site();
  const a = await read(w);
  const gone = L(a)[2];
  w.api.streams.delete(gone);
  at(1); refreshTwitch();
  const b = await read(w);
  assert.equal(b.picks.length, 5);
  assert.ok(!L(b).includes(gone));
  assert.ok(L(a).filter((l) => l !== gone).every((l) => L(b).includes(l)), "les quatre autres sont toujours là");
  assert.deepEqual(L(b).slice(0, 2), L(a).slice(0, 2), "et à leur place");
  at(2); refreshTwitch(); assert.deepEqual(L(await read(w)), L(b), "puis la sélection reste stable");
});

test("moins de membres en direct que demandé : on montre ceux-là, et la sélection se complète quand d'autres arrivent (sans bouger les premiers)", async () => {
  const w = site({ liveCount: 2 });
  const a = await read(w);
  assert.equal(a.picks.length, 2); assert.equal(a.pool, 2);
  for (const [l, s] of Object.entries(lives(5, 10))) w.api.streams.set(l, s);
  at(1); refreshTwitch();
  const b = await read(w);
  assert.equal(b.picks.length, 5);
  assert.deepEqual(L(b).slice(0, 2), L(a), "les deux premiers restent");
  assert.equal((await read(site({ liveCount: 1, settings: { count: 10 } }))).picks.length, 1);
});

test("personne en direct : une sélection vide (jamais d'erreur), qui se remplit dès que quelqu'un arrive", async () => {
  const w = site({ liveCount: 0 });
  const a = await read(w);
  assert.deepEqual([a.state, a.picks, a.pool], ["ok", [], 0]);
  w.api.streams.set(login(4), { viewers: 3, minutes: 5 });
  at(0.5); refreshTwitch();
  assert.deepEqual(L(await read(w)), [login(4)]);
  assert.equal((await read(world({ partners: [] }))).state, "no_partners");
});

test("exclusions : jamais tirés (pseudo, @pseudo ou lien), même si c'est tout ce qui est en direct ; votre propre chaîne n'est jamais tirée", async () => {
  const w = site({ partners: 8, liveCount: 8, settings: { count: 10, exclude: `${login(0)}\n@${login(1).toUpperCase()}, https://www.twitch.tv/${login(2)}` } });
  assert.deepEqual(L(await read(w)).sort(), logins(5, 3), "les trois exclus manquent");
  const own = world({ partners: [...logins(5), "ma_chaine"], live: { ...lives(5), ma_chaine: { viewers: 1 } }, settings: { count: 10 } });
  const r2 = await read(own);
  assert.ok(!L(r2).includes("ma_chaine") && r2.picks.length === 5);
  assert.deepEqual((await read(site({ partners: 3, liveCount: 3, settings: { exclude: logins(3).join("\n") } }))).picks, []);
});

test("« petites chaînes d'abord » : la chaîne à 1 spectateur sort presque toujours devant celle à 5 000 ; par défaut, le tirage est égal", async () => {
  const tally = async (settings) => {
    let n = 0;
    for (let i = 0; i < 60; i++) {
      live.resetLive(); search.resetSearch(); M.resetMoment(); at(i * 10);
      const w = world({ partners: [login(0), login(1)], live: { [login(0)]: { viewers: 1 }, [login(1)]: { viewers: 5000 } }, settings: { count: 1, ...settings }, key: `poids${i}${settings.smallFirst ? "p" : "u"}` });
      if (L(await read(w))[0] === login(0)) n++;
    }
    return n;
  };
  const small = await tally({ smallFirst: true }), even = await tally({});
  assert.ok(small >= 55, `avec l'option : ${small} / 60`);
  assert.ok(even > 15 && even < 45, `par défaut : ${even} / 60`);
});

test("déterminisme : même site, même tranche, même nombre de « Tirer de nouveau » → même tirage, même après un redémarrage ; générateur injectable", async () => {
  const mk = () => site({ extra: { key: "site-fixe" } });
  const restart = () => { M.resetMoment(); live.resetLive(); source.resetSource(); };
  const a = await read(mk());
  restart();
  assert.deepEqual(L(await read(mk())), L(a));
  restart(); at(10);
  assert.notDeepEqual(L(await read(mk())), L(a), "une autre tranche tire autre chose");
  restart(); at(0);
  M.hooks.rng = () => 0;
  const c = await read(mk());
  assert.equal(c.picks.length, 5);
  restart();
  assert.deepEqual(L(await read(mk())), L(c));
});

test("cache et quota de Twitch : des dizaines de lectures = UN appel groupé (jusqu'à 100 chaînes par appel), jamais un par visiteur", async () => {
  const w = site({ partners: 250, liveCount: 40 });
  for (let i = 0; i < 40; i++) await read(w);
  assert.equal(w.api.calls.length, 3, "250 chaînes = 3 paquets de 100 au plus, une seule fois");
  assert.ok(w.api.calls.every((c) => c.size <= 100));
  assert.equal((await M.momentNow(w.ctx, { reroll: true })).rerolled, true);
  assert.equal(w.api.calls.length, 3, "« Tirer de nouveau » ne redemande rien à Twitch");
});

test("Twitch en panne : la dernière sélection connue reste affichée (10 minutes au plus), puis l'erreur est dite", async () => {
  const w = site();
  const a = await read(w);
  w.api.fail = "network"; at(1); refreshTwitch();
  const b = await read(w);
  assert.equal(b.state, "ok"); assert.equal(b.stale, T0); assert.deepEqual(L(b), L(a));
  at(9.5); refreshTwitch(); assert.equal((await read(w)).stale, T0);
  at(11); refreshTwitch();
  const c = await read(w);
  assert.deepEqual([c.state, c.reason], ["error", "network"]);
  w.api.fail = null; at(12); refreshTwitch();
  assert.equal((await read(w)).state, "ok", "Twitch revient : tout reprend");
  const fresh = site(); fresh.api.fail = "rate";
  const d = await read(fresh);
  assert.deepEqual([d.state, d.reason], ["error", "rate"]);
});

test("Twitch lent ou muet : la lecture se termine quand même (bornée), avec la dernière sélection ou l'erreur", async () => {
  streams.timing.callMs = 150; streams.timing.packetMs = 100;
  const w = site();
  const a = await read(w);
  w.api.hang = true; at(1); refreshTwitch();
  const t = Date.now();
  const b = await read(w);
  assert.ok(Date.now() - t < 3000, "pas d'attente sans fin");
  assert.deepEqual([b.state, typeof b.stale], ["ok", "number"]); assert.deepEqual(L(b), L(a));
  const mute = site(); mute.api.hang = true;
  assert.equal((await read(mute)).state, "error");
});

test("la liste de raid manque ou Twitch n'est pas prêt : l'état est dit, sans liste ni tirage", async () => {
  const w = site(); w.api.accounts[0] = { ok: true, channel: "ma_chaine", ready: false, adminPath: "/admin/instances/x" };
  const a = await read(w); assert.deepEqual([a.state, a.reason], ["not_ready", "setup"]);
  const noCat = world({ partners: [], withHideCategory: false }); noCat.ctx.setting = (k) => (k === "category" ? "inconnue" : undefined);
  assert.equal((await read(noCat)).state, "not_ready");
});

/* ───────────── Consentement ───────────── */

test("consentement : une personne rangée dans « Ne pas montrer » n'est JAMAIS tirée ni montrée ; une fiche encore à relire non plus", async () => {
  const ps = logins(20).map((l, i) => ({ login: l, hidden: i % 4 === 0, status: i === 1 ? "to_review" : "active" }));
  const hiddenLogins = ps.filter((p) => p.hidden).map((p) => p.login);
  const w = world({ partners: ps, live: lives(20), settings: { count: 10 } });
  const seen = new Set();
  for (let i = 0; i < 12; i++) { at(i * 10); refreshTwitch(); for (const p of (await read(w)).picks) seen.add(p.login); }
  for (const h of hiddenLogins) assert.ok(!seen.has(h), `${h} est « ne pas montrer »`);
  assert.ok(!seen.has(login(1)), "la fiche à relire n'est pas montrée");
  assert.ok(seen.size >= 10, "les autres passent bien");
  assert.equal((await read(w)).pool, 20 - hiddenLogins.length - 1);
});

test("consentement : la catégorie vient du réglage (suivie après une fusion de catégories), ou d'un nom reconnu (« Ne pas montrer », « Do not show »)", async () => {
  const settings = { count: 10 };
  const ps = logins(6).map((l, i) => ({ login: l, hidden: i < 2 }));
  const en = world({ partners: ps, live: lives(6), settings: { count: 10 }, hideName: "Do not show" });
  assert.deepEqual(L(await read(en)).sort(), logins(4, 2));
  M.resetMoment();
  const w = world({ partners: ps, live: lives(6), settings, hideName: "Discrétion" });
  assert.equal((await read(w)).picks.length, 6, "sans le réglage, « Discrétion » ne dit rien");
  M.resetMoment(); settings.hide = w.hideCat;
  assert.deepEqual(L(await read(w)).sort(), logins(4, 2));
  M.resetMoment(); consent.resetConsent();
  const keep = w.book.seedCategory("Autre");
  w.book.admin.mergeCategories(keep, w.hideCat);
  assert.deepEqual(L(await read(w)).sort(), logins(4, 2), "la fusion ne rend personne visible");
  M.resetMoment(); consent.resetConsent();
  w.book.admin.deleteCategory(keep);
  assert.equal((await read(w)).picks.length, 6);
  const panel = await (await import("../modules/twitch-raid/moment-admin.mjs")).blocks(w.ctx);
  assert.ok(panel.some((b) => b.type === "banner" && /n'existe plus/.test(b.text)), "le panneau le dit");
});

test("consentement : une personne qui demande à ne plus apparaître disparaît de la sélection (au plus 2 minutes de cache), sans bouger les autres", async () => {
  const w = world({ partners: logins(10), live: lives(10), settings: { count: 5 } });
  const a = await read(w);
  const victim = L(a)[1];
  w.book.admin.setCategories(w.ids[victim], [w.cat, w.hideCat]);
  consent.resetConsent();
  at(1); refreshTwitch();
  const b = await read(w);
  assert.ok(!L(b).includes(victim)); assert.equal(b.picks.length, 5);
  assert.ok(L(a).filter((l) => l !== victim).every((l) => L(b).includes(l)));
  for (let i = 1; i < 8; i++) { at(i * 10); refreshTwitch(); assert.ok(!L(await read(w)).includes(victim)); }
});

test("consentement : on ne devine pas. Contacts muet pour la catégorie « Ne pas montrer » → la dernière sélection (ou rien), JAMAIS une personne non vérifiée", async () => {
  const ps = logins(10).map((l, i) => ({ login: l, hidden: i === 0 }));
  consent.timing.hideMs = 0; consent.timing.verdictMs = 0; consent.timing.staleMs = -1;
  const w = world({ partners: ps, live: lives(10), settings: { count: 10 } });
  const a = await read(w);
  assert.ok(!L(a).includes(login(0)));
  w.book.faults.hang.add("categories"); source.timing.callMs = 100;
  at(1); refreshTwitch();
  const b = await read(w);
  assert.equal(b.state, "ok"); assert.equal(typeof b.stale, "number", "la dernière sélection connue, signalée");
  assert.ok(!L(b).includes(login(0)));
  M.resetMoment(); consent.resetConsent();
  const c = await read(w);
  assert.deepEqual([c.state, c.picks], ["error", undefined]);
  const w2 = world({ partners: logins(4), live: lives(4), settings: { count: 10 } });
  w2.book.admin.deleteContact(w2.ids[login(1)]);
  source.resetSource();
  assert.ok(!L(await read(w2)).includes(login(1)));
});

test("consentement : Contacts muet pour les fiches seulement → les verdicts connus servent (10 minutes), les inconnus ne sont pas montrés", async () => {
  const w = world({ partners: logins(6), live: lives(3), settings: { count: 10 } });
  assert.equal((await read(w)).picks.length, 3);
  for (const [l, s] of Object.entries(lives(3, 3))) w.api.streams.set(l, s);
  consent.timing.verdictMs = 0; w.book.faults.hang.add("resolve"); source.timing.callMs = 100; consent.timing.readMs = 400;
  at(1); refreshTwitch();
  assert.deepEqual(L(await read(w)).sort(), logins(3), "les trois connus restent, les trois inconnus ne sont pas montrés");
});

test("la liste complète n'est jamais exposée : une sélection ne contient que les N tirés (aucun autre pseudo, aucun identifiant de fiche)", async () => {
  const w = site({ partners: 40, liveCount: 40 });
  const r = await read(w);
  const json = JSON.stringify(r);
  for (const o of logins(40).filter((l) => !L(r).includes(l))) assert.ok(!json.includes(o), o);
  for (const id of Object.values(w.ids)) assert.ok(!json.includes(id));
  assert.ok(!/contactId|categoryIds|email/.test(json));
});

/* ───────────── Grande communauté (plus de 500 chaînes) ───────────── */

test("plus de 500 chaînes : la sélection se tire par paquets de 100 (mêmes bornes que « au hasard »), reste stable et ne revérifie que les membres choisis", async () => {
  M.timing.verifyOkMs = 0;
  const w = world({ partners: logins(620), live: lives(60, 100, (i) => 3 + i), settings: { count: 5 } });
  const a = await read(w);
  assert.equal(a.state, "ok"); assert.equal(a.picks.length, 5);
  assert.ok(w.api.calls.length <= 6 && w.api.calls.every((c) => c.size <= 100), `au plus 6 paquets de 100 (${w.api.calls.length})`);
  const used = w.api.calls.length;
  at(2); refreshTwitch();
  assert.deepEqual(L(await read(w)), L(a), "stable");
  const check = w.api.calls.slice(used);
  assert.equal(check.length, 1, "un seul appel pour revérifier les membres choisis");
  assert.deepEqual(check[0].logins.sort(), L(a).sort(), "seulement eux");
  w.api.streams.delete(L(a)[0]);
  at(3); refreshTwitch();
  const c = await read(w);
  assert.equal(c.picks.length, 5); assert.ok(!L(c).includes(L(a)[0]));
});

test("plus de 500 chaînes : la tranche suivante tire d'autres membres (rotation), les exclus ne sont ni demandés ni montrés, 12 recherches par minute au plus", async () => {
  const excluded = logins(5, 100);
  const w = world({ partners: logins(620), live: lives(60, 100), settings: { count: 5, exclude: excluded.join("\n") } });
  const a = await read(w);
  at(10); refreshTwitch();
  const b = await read(w);
  assert.ok(L(b).every((l) => !L(a).includes(l)));
  for (const r of [a, b]) assert.ok(L(r).every((l) => !excluded.includes(l)), "les exclus ne sortent pas");
  assert.ok(w.api.calls.every((c) => !c.logins.some((l) => excluded.includes(l))), "les exclus ne sont jamais demandés");
  search.limits.max = 0; live.resetLive(); search.resetSearch(); M.resetMoment();
  const limited = await read(world({ partners: logins(620), live: lives(60, 100), settings: { count: 5 } }));
  assert.equal(limited.state, "error"); assert.equal(limited.reason, "rate");
});

test("plus de 500 chaînes et personne en direct : une sélection vide, sans erreur", async () => {
  const a = await read(world({ partners: logins(620), live: {}, settings: { count: 5 } }));
  assert.deepEqual([a.state, a.picks.length], ["ok", 0]);
});

/* ───────────── Pour l'assistant ───────────── */

test("outil de l'assistant raid_featured_now : la sélection actuelle en lecture seule (commande de raid, fin de tranche), sans tirer de nouveau", async () => {
  const def = (await import("../modules/twitch-raid/index.mjs")).default;
  const w = site();
  const a = await read(w);
  const r = await def.mcp.raid_featured_now(w.ctx, {});
  assert.equal(r.state, "ok"); assert.equal(r.live.length, 5); assert.deepEqual(r.live.map((x) => x.channel), L(a));
  assert.ok(r.live.every((x) => x.raidCommand === `/raid ${x.channel}` && typeof x.liveForMinutes === "number"));
  assert.equal(r.endsAt, new Date(T0 + 10 * MIN).toISOString());
  assert.ok(!JSON.stringify(r).includes("contactId"));
  assert.deepEqual(L(await read(w)), L(a), "l'outil n'a rien tiré de nouveau");
  const down = site(); down.api.fail = "network";
  const e = await def.mcp.raid_featured_now(down.ctx, {});
  assert.deepEqual([e.state, e.reason, e.live], ["error", "network", []]);
});
