// Compte à rebours — le script des visiteurs et de la source OBS, essayés dans un navigateur factice avec une horloge
// qu'on avance à la main : pas de dérive, pause quand l'onglet est caché, mouvement réduit, horloge d'appareil fausse, fin et disparition.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { makeBrowser, addCard, addOverlay } from "./helpers/countdownDom.mjs";

const T = await import("../modules/countdown/time.mjs");
const R = await import("../modules/countdown/render.mjs");
const M = await import("../modules/countdown/model.mjs");

const BASE = Date.UTC(2026, 10, 14, 12, 0, 0); // « maintenant » des essais
const shown = (card) => ({ d: card.u.d.textContent, h: card.u.h.textContent, m: card.u.m.textContent, s: card.u.s.textContent });
const expected = (rem) => { const b = T.breakdown(rem); return { d: String(b.d), h: T.pad2(b.h), m: T.pad2(b.m), s: T.pad2(b.s) }; };

/** Générateur pseudo-aléatoire reproductible (les essais doivent donner le même résultat à chaque fois). */
function prng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); }

/** Navigateur dont les minuteurs se déclenchent EN RETARD (comme dans un vrai navigateur chargé) et parfois très en retard. */
function laggyBrowser(opts, seed = 7) {
  const rnd = prng(seed);
  const env = makeBrowser(opts);
  const raw = env.win.setTimeout;
  env.win.setTimeout = (fn, ms) => raw((() => fn()), ms + (rnd() < 0.02 ? 1500 + rnd() * 1500 : rnd() * 40));
  return env;
}

// ── Pas de dérive ───────────────────────────────────────────────────────────────────────────────────────────────────

test("le compteur ne dérive pas : à chaque réveil, même très en retard, l'affichage est exactement le temps restant", () => {
  const env = laggyBrowser({ now: BASE });
  const start = BASE + 2 * 3_600_000 + 5_000;
  const card = addCard(env, { start });
  T.bootCountdowns(env.win, env.doc);
  assert.deepEqual(shown(card), expected(start - env.now), "dès le départ");
  // on regarde l'affichage à CHAQUE minuterie qui se déclenche, pendant 30 minutes
  let checks = 0;
  const fire = env.win.setTimeout;
  env.win.setTimeout = (fn, ms) => fire(() => { fn(); assert.deepEqual(shown(card), expected(start - env.now), `à t+${env.now - BASE} ms`); checks++; }, ms);
  env.advance(1); // laisse la minuterie en cours se déclencher une fois pour enrouler les suivantes
  env.advance(30 * 60_000);
  assert.ok(checks > 1000, `beaucoup de vérifications (${checks})`);
});

test("pas de minuterie en rafale : environ un réveil par seconde (jamais un par milliseconde)", () => {
  const env = makeBrowser({ now: BASE });
  addCard(env, { start: BASE + 3_600_000 });
  T.bootCountdowns(env.win, env.doc);
  const before = env.log.setTimeouts;
  env.advance(10 * 60_000);
  const n = env.log.setTimeouts - before;
  assert.ok(n >= 590 && n <= 620, `${n} réveils en 10 minutes`);
});

test("ordinateur mis en veille puis réveillé : tout est recalculé d'un coup, sans rattraper seconde par seconde", () => {
  const env = makeBrowser({ now: BASE });
  const start = BASE + 5 * 3_600_000;
  const card = addCard(env, { start });
  T.bootCountdowns(env.win, env.doc);
  env.jump(3 * 3_600_000 + 17_000); // 3 h de sommeil, aucun minuteur n'a tourné
  env.advance(1_000);
  assert.deepEqual(shown(card), expected(start - env.now));
  assert.equal(card.u.h.textContent, "01");
});

test("changement d'heure pendant le compte à rebours : on compte le vrai temps écoulé", () => {
  const night = T.zonedToUtc(2026, 3, 29, 12, 0, "Europe/Paris").ms; // dimanche midi (été)
  const env = makeBrowser({ now: T.zonedToUtc(2026, 3, 28, 12, 0, "Europe/Paris").ms }); // samedi midi (hiver)
  const card = addCard(env, { start: night });
  T.bootCountdowns(env.win, env.doc);
  assert.deepEqual(shown(card), { d: "0", h: "23", m: "00", s: "00" }, "23 heures et non 24");
  env.advance(11 * 3_600_000 + 59_000);
  assert.deepEqual(shown(card), expected(night - env.now));
});

// ── Pause quand l'onglet est caché ──────────────────────────────────────────────────────────────────────────────────

test("onglet caché : plus aucun minuteur ; au retour tout est juste tout de suite et ça repart", () => {
  const env = makeBrowser({ now: BASE });
  const start = BASE + 3_600_000;
  const card = addCard(env, { start });
  T.bootCountdowns(env.win, env.doc);
  env.advance(5_000);
  env.setHidden(true);
  assert.equal(env.pending(), 0, "aucun minuteur en attente");
  const before = env.log.setTimeouts;
  env.advance(30 * 60_000);
  assert.equal(env.log.setTimeouts, before, "rien n'a tourné pendant 30 minutes");
  env.setHidden(false);
  assert.deepEqual(shown(card), expected(start - env.now), "recalculé au retour");
  assert.equal(env.pending(), 1, "et la boucle repart");
  env.advance(3_000);
  assert.deepEqual(shown(card), expected(start - env.now));
});

test("page ouverte dans un onglet déjà caché : rien ne tourne avant qu'il soit visible", () => {
  const env = makeBrowser({ now: BASE, hiddenTab: true });
  const card = addCard(env, { start: BASE + 60_000 });
  T.bootCountdowns(env.win, env.doc);
  assert.equal(env.pending(), 0);
  env.setHidden(false);
  assert.deepEqual(shown(card), expected(60_000));
});

// ── Mouvement réduit ────────────────────────────────────────────────────────────────────────────────────────────────

test("mouvement réduit : pas de secondes, un seul réveil par minute", () => {
  const env = makeBrowser({ now: BASE, reduced: true });
  const card = addCard(env, { start: BASE + 3_600_000 });
  T.bootCountdowns(env.win, env.doc);
  assert.equal(card.tileS.hidden, true, "la tuile des secondes est cachée");
  const before = env.log.setTimeouts;
  env.advance(10 * 60_000);
  const n = env.log.setTimeouts - before;
  assert.ok(n >= 9 && n <= 12, `${n} réveils en 10 minutes`);
  assert.equal(card.u.m.textContent, T.pad2(T.breakdown(3_600_000 - 10 * 60_000).m));
});

test("secondes désactivées dans les réglages : même comportement calme, tuile cachée", () => {
  const env = makeBrowser({ now: BASE });
  const card = addCard(env, { start: BASE + 3_600_000, seconds: false });
  T.bootCountdowns(env.win, env.doc);
  assert.equal(card.tileS.hidden, true);
  const before = env.log.setTimeouts;
  env.advance(5 * 60_000);
  assert.ok(env.log.setTimeouts - before <= 7);
});

test("les secondes sont affichées par défaut", () => {
  const env = makeBrowser({ now: BASE });
  const card = addCard(env, { start: BASE + 3_600_000 });
  T.bootCountdowns(env.win, env.doc);
  assert.equal(card.tileS.hidden, false);
});

// ── Quand l'heure arrive, puis la disparition ───────────────────────────────────────────────────────────────────────

test("à l'heure pile : les chiffres sont remplacés par le message de fin, puis la carte disparaît au bon moment", () => {
  const env = makeBrowser({ now: BASE });
  const start = BASE + 90_000;
  const hide = start + 3_600_000;
  const card = addCard(env, { start, hide });
  T.bootCountdowns(env.win, env.doc);
  assert.equal(card.run.hidden, false);
  assert.equal(card.end.hidden, true);
  env.advance(89_999);
  assert.equal(card.run.hidden, false, "une milliseconde avant : encore les chiffres");
  assert.equal(card.u.s.textContent, "01");
  env.advance(1);
  assert.equal(card.run.hidden, true);
  assert.equal(card.end.hidden, false);
  assert.equal(card.art.getAttribute("data-vcd-state"), "started");
  assert.equal(card.kicker.textContent, "C’est maintenant", "le petit titre suit : plus « prochain rendez-vous »");
  assert.equal(card.art.hidden, false);
  env.advance(3_600_000 - 1);
  assert.equal(card.art.hidden, false, "une milliseconde avant le délai : encore là");
  env.advance(1);
  assert.equal(card.art.hidden, true, "disparu, sans rechargement");
  assert.equal(env.pending(), 0, "plus aucun minuteur : rien ne tourne pour rien");
});

test("délai « jamais » : le message reste, aucun minuteur ne reste armé", () => {
  const env = makeBrowser({ now: BASE });
  const card = addCard(env, { start: BASE + 5_000, hide: 0 });
  T.bootCountdowns(env.win, env.doc);
  env.advance(10_000);
  assert.equal(card.end.hidden, false);
  assert.equal(card.art.hidden, false);
  assert.equal(env.pending(), 0);
});

test("page ouverte longtemps après le délai : la carte est cachée dès le départ", () => {
  const env = makeBrowser({ now: BASE });
  const card = addCard(env, { start: BASE - 7_200_000, hide: BASE - 3_600_000, ended: true });
  T.bootCountdowns(env.win, env.doc);
  assert.equal(card.art.hidden, true);
  assert.equal(env.pending(), 0);
});

// ── Horloge d'appareil fausse ──────────────────────────────────────────────────────────────────────────────────────

test("horloge d'appareil juste : aucune demande au serveur", () => {
  const env = makeBrowser({ now: BASE });
  addCard(env, { start: BASE + 60_000, serverNow: BASE - 1_200 });
  T.bootCountdowns(env.win, env.doc);
  assert.equal(env.fetches.length, 0);
});

test("horloge d'appareil en avance de 10 minutes : une demande à l'heure du serveur, puis tout est recalé", async () => {
  const serverNow = BASE;
  const env = makeBrowser({ now: BASE + 600_000, serverNow });
  const start = BASE + 3_600_000;
  const card = addCard(env, { start, serverNow });
  const ctl = T.bootCountdowns(env.win, env.doc);
  assert.equal(env.fetches.length, 1);
  assert.equal(env.fetches[0].url, "/m/x/now");
  assert.deepEqual(env.fetches[0].opts, { cache: "no-store", credentials: "omit" }, "sans cookie, jamais mis en cache");
  assert.equal(card.u.h.textContent, "00", "avant la réponse : l'horloge de l'appareil");
  await new Promise((r) => setImmediate(r));
  assert.ok(Math.abs(ctl.skew() - 600_000) < 5, `écart mesuré : ${ctl.skew()}`);
  assert.deepEqual(shown(card), expected(start - (env.now - 600_000)));
  assert.equal(card.u.h.textContent, "01");
  env.advance(65_000);
  assert.deepEqual(shown(card), expected(start - (env.now - 600_000)));
  assert.equal(env.fetches.length, 1, "une seule demande");
});

test("page gardée en mémoire par un relais (heure du serveur très ancienne) : l'appareil, lui, est juste", async () => {
  const env = makeBrowser({ now: BASE, serverNow: BASE });
  const start = BASE + 3_600_000;
  const card = addCard(env, { start, serverNow: BASE - 300_000 }); // la page date de 5 minutes
  const ctl = T.bootCountdowns(env.win, env.doc);
  await new Promise((r) => setImmediate(r));
  assert.ok(Math.abs(ctl.skew()) < 5, "le serveur confirme l'appareil : aucun décalage appliqué");
  assert.deepEqual(shown(card), expected(start - env.now));
});

test("le serveur ne répond pas : on garde l'horloge de l'appareil, sans erreur", async () => {
  const env = makeBrowser({ now: BASE + 600_000 });
  env.win.fetch = () => Promise.reject(new Error("réseau"));
  const card = addCard(env, { start: BASE + 3_600_000, serverNow: BASE });
  T.bootCountdowns(env.win, env.doc);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(shown(card), expected(BASE + 3_600_000 - env.now));
});

// ── Phrase « chez vous » dans la page ──────────────────────────────────────────────────────────────────────────────

function withZone(zone, fn) {
  const old = process.env.TZ;
  process.env.TZ = zone;
  try { return fn(); } finally { if (old === undefined) delete process.env.TZ; else process.env.TZ = old; }
}

test("la page écrit l'heure chez le visiteur selon SON fuseau, et garde celle de l'événement quand elle diffère", () => {
  const start = T.zonedToUtc(2026, 11, 20, 21, 0, "Europe/Paris").ms; // vendredi 20 novembre, 20:00 universelle
  for (const [zone, local, event] of [
    ["America/New_York", "Vendredi à 15 h chez vous", "Vendredi 20 novembre 2026 à 21 h (heure d’Europe centrale)"],
    ["Asia/Tokyo", "Samedi à 5 h chez vous", "Vendredi 20 novembre 2026 à 21 h (heure d’Europe centrale)"],
    ["Europe/Berlin", "Vendredi à 21 h chez vous", ""],
  ]) {
    withZone(zone, () => {
      const env = makeBrowser({ now: Date.UTC(2026, 10, 18, 12, 0) });
      const card = addCard(env, { start });
      T.bootCountdowns(env.win, env.doc);
      assert.equal(card.local.hidden, false);
      assert.equal(card.local.textContent, local, zone);
      assert.equal(card.event.hidden, event === "", zone);
      if (event) assert.equal(card.event.textContent, event);
    });
  }
});

test("journée entière : seulement la date, aucune phrase « chez vous »", () => {
  withZone("Asia/Tokyo", () => {
    const env = makeBrowser({ now: BASE });
    const start = T.zonedToUtc(2026, 11, 20, 0, 0, "America/Montreal").ms;
    const card = addCard(env, { start, allDay: true, tz: "America/Montreal" });
    T.bootCountdowns(env.win, env.doc);
    assert.equal(card.local.hidden, true);
    assert.equal(card.event.textContent, "Vendredi 20 novembre 2026");
  });
});

test("la phrase « chez vous » se met à jour quand le jour change chez le visiteur (« demain » devient « aujourd'hui »)", () => {
  withZone("America/New_York", () => {
    const start = T.zonedToUtc(2026, 11, 15, 21, 0, "Europe/Paris").ms; // 20:00Z, dimanche = 15:00 à New York
    const env = makeBrowser({ now: Date.UTC(2026, 10, 14, 12, 0) }); // samedi 07:00 à New York
    const card = addCard(env, { start });
    T.bootCountdowns(env.win, env.doc);
    assert.equal(card.local.textContent, "Demain à 15 h chez vous");
    env.advance(18 * 3_600_000); // dimanche 01:00 à New York
    assert.equal(card.local.textContent, "Aujourd’hui à 15 h chez vous");
  });
});

// ── La page change sans rechargement ───────────────────────────────────────────────────────────────────────────────

test("un compteur qui arrive après coup (navigation sans rechargement) est pris en charge ; un compteur retiré est oublié", () => {
  const env = makeBrowser({ now: BASE });
  const first = addCard(env, { start: BASE + 3_600_000 });
  const ctl = T.bootCountdowns(env.win, env.doc);
  const late = addCard(env, { start: BASE + 7_200_000 });
  assert.equal(late.u.h.textContent, "0", "pas encore vu");
  env.observers[0].fn(); // la page a changé
  env.advance(100);
  assert.deepEqual(shown(late), expected(7_200_000 - 100));
  assert.equal(ctl.states().length, 2);
  first.art.isConnected = false;
  env.advance(2_000);
  assert.equal(ctl.states().length, 1, "le compteur retiré de la page est oublié");
});

test("le script ne remplace jamais les nœuds de texte à chaque seconde (sinon il réveillerait sans cesse l'observateur de la page)", () => {
  const env = makeBrowser({ now: BASE });
  const card = addCard(env, { start: BASE + 3_600_000 });
  T.bootCountdowns(env.win, env.doc);
  const before = card.u.s.mutations;
  env.advance(60_000);
  assert.equal(card.u.s.mutations, before);
  assert.equal(env.observers.length, 1);
});

// ── Le script envoyé au navigateur ─────────────────────────────────────────────────────────────────────────────────

test("le script envoyé est autonome : il s'exécute seul dans un contexte vide, une seule fois même chargé deux fois", () => {
  const env = makeBrowser({ now: BASE });
  const card = addCard(env, { start: BASE + 3_600_000 });
  const sandbox = { window: env.win, document: env.doc };
  const script = R.liveScript();
  assert.ok(!/\bimport\b|\bexport\b|require\(/.test(script), "pas de syntaxe de module");
  vm.runInNewContext(script, sandbox);
  vm.runInNewContext(script, sandbox); // chargé deux fois (deux instances du module)
  assert.equal(env.observers.length, 1, "démarré une seule fois");
  assert.deepEqual(shown(card), expected(3_600_000));
  env.advance(5_000);
  assert.deepEqual(shown(card), expected(3_600_000 - 5_000));
});

test("toutes les fonctions communes ne dépendent que d'elles-mêmes (aucune variable du module serveur)", () => {
  const src = T.clientSource();
  const sandbox = vm.createContext({});
  assert.doesNotThrow(() => vm.runInContext(`${src};\nglobalThis.__out = [pad2(5), cap("été"), clockText(21, 30, "fr"), plural(1, ["a","b"], "en"), JSON.stringify(breakdown(61000)), nextDelay(1500, true), zoneParts(0, "UTC").y, fmtIn(0, "UTC", "en", {year:"numeric"}), zoneName(0, "UTC", "en"), String(sameWall(0, "UTC", "Europe/London"))]`, sandbox));
  assert.deepEqual(Array.from(sandbox.__out).slice(0, 3), ["05", "Été", "21 h 30"]);
});

test("les attributs que le script cherche existent bien dans le HTML des cartes", () => {
  const ctx = fakeCtx({ key: "cd", basePath: "countdown", locale: "fr", messages: { }, settings: {} });
  const v = M.view(M.read({ id: "r1", data: { uid: "u0000001", slug: "x", rev: 1, title: "T", allDay: false, date: "2099-01-01", time: "10:00", tz: "UTC", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" } }), "1d", 0);
  const html = R.card(ctx, v, { now: 0, kicker: "k" });
  const used = [...T.bootCountdowns.toString().matchAll(/\bq\(el, "([a-z-]+)"\)/g)].map((m) => m[1]);
  assert.ok(used.length >= 10);
  for (const name of new Set(used)) assert.ok(html.includes(`data-vcd-${name}=`), `data-vcd-${name} absent du HTML`);
  for (const attr of ["data-start", "data-hide", "data-allday", "data-tz", "data-now", "data-seconds"]) assert.ok(html.includes(`${attr}="`), attr);
  const overlay = R.overlayParts(ctx, { initial: { now: 0, event: null }, stateUrl: "/m/cd/state", endMs: 60_000 });
  const usedO = [...T.bootOverlay.toString().matchAll(/\bel\("([a-z-]+)"\)/g)].map((m) => m[1]);
  for (const name of new Set(usedO)) assert.ok(overlay.html.includes(`data-o="${name}"`), `data-o="${name}" absent du HTML de la source OBS`);
});

// ── Source navigateur pour OBS ──────────────────────────────────────────────────────────────────────────────────────

const L = { today: "aujourd’hui", tomorrow: "demain", at: "à", local: "{when} chez vous", d: ["jour", "jours"], h: ["heure", "heures"], m: ["minute", "minutes"], s: ["seconde", "secondes"] };
const cfg = (event, now, extra = {}) => ({ stateUrl: "/m/cd/state", lang: "fr", L, secs: true, poll: 30_000, initial: { now, event }, ...extra });

test("OBS : affiche l'événement, compte sans dériver, puis le message de fin, puis s'efface", () => {
  const env = laggyBrowser({ now: BASE }, 3);
  const o = addOverlay(env);
  const start = BASE + 120_000;
  const hideAt = start + 5 * 60_000;
  T.bootOverlay(env.win, env.doc, cfg({ slug: "x", title: "Sortie du jeu", start, hideAt, message: "C’est parti !" }, BASE));
  assert.equal(o.root.hidden, false);
  assert.equal(o.title.textContent, "Sortie du jeu");
  assert.equal(o.d.textContent, "0");
  assert.equal(o.m.textContent, "02");
  env.advance(60_000);
  // le dernier réveil a pu avoir lieu jusqu'à 3,5 s plus tôt (minuteurs en retard) : l'affichage est celui de ce moment-là, exactement
  const lastSeen = new Set(Array.from({ length: 36 }, (_, i) => T.pad2(T.breakdown(start - env.now + i * 100).s)));
  assert.ok(lastSeen.has(o.s.textContent), `secondes affichées : ${o.s.textContent}`);
  env.advance(61_000);
  assert.equal(o.tiles.hidden, true);
  assert.equal(o.msg.hidden, false);
  assert.equal(o.msg.textContent, "C’est parti !");
  env.advance(5 * 60_000 + 40);
  assert.equal(o.root.hidden, true, "effacée après le délai");
});

test("OBS : sans événement, la source reste vide et transparente ; elle apparaît quand le serveur en annonce un", async () => {
  const env = makeBrowser({ now: BASE, serverNow: BASE });
  const o = addOverlay(env);
  env.win.fetch = () => Promise.resolve({ json: () => Promise.resolve({ now: env.now, event: { slug: "n", title: "Nouveau", start: env.now + 3_600_000, hideAt: env.now + 4_000_000, message: "Go" } }) });
  T.bootOverlay(env.win, env.doc, cfg(null, BASE));
  assert.equal(o.root.hidden, true);
  env.advance(1_600);
  await new Promise((r) => setImmediate(r));
  assert.equal(o.root.hidden, false);
  assert.equal(o.title.textContent, "Nouveau");
  assert.equal(o.h.textContent, "01");
});

test("OBS : source cachée = plus de minuterie de comptage ; au retour, tout est recalculé", () => {
  const env = makeBrowser({ now: BASE });
  const o = addOverlay(env);
  const start = BASE + 3_600_000;
  T.bootOverlay(env.win, env.doc, cfg({ slug: "x", title: "T", start, hideAt: start + 1e6, message: "m" }, BASE));
  env.setHidden(true);
  const before = env.log.setTimeouts;
  env.advance(20 * 60_000);
  assert.equal(env.log.setTimeouts, before, "rien ne tourne caché");
  env.setHidden(false);
  assert.equal(o.m.textContent, T.pad2(T.breakdown(start - env.now).m));
});

test("OBS : le serveur injoignable ne casse rien, le compte continue tout seul", async () => {
  const env = makeBrowser({ now: BASE });
  const o = addOverlay(env);
  env.win.fetch = () => Promise.reject(new Error("réseau"));
  const start = BASE + 3_600_000;
  T.bootOverlay(env.win, env.doc, cfg({ slug: "x", title: "T", start, hideAt: start + 1e6, message: "m" }, BASE));
  env.advance(95_000);
  await new Promise((r) => setImmediate(r));
  assert.equal(o.root.hidden, false);
  assert.equal(o.s.textContent, T.pad2(T.breakdown(start - env.now).s));
});

test("OBS : horloge de l'ordinateur fausse → recalée sur le serveur dès la première réponse", async () => {
  const env = makeBrowser({ now: BASE + 120_000, serverNow: BASE });
  const o = addOverlay(env);
  const start = BASE + 3_600_000;
  env.win.fetch = () => Promise.resolve({ json: () => Promise.resolve({ now: BASE, event: { slug: "x", title: "T", start, hideAt: start + 1e6, message: "m" } }) });
  const ctl = T.bootOverlay(env.win, env.doc, cfg({ slug: "x", title: "T", start, hideAt: start + 1e6, message: "m" }, BASE));
  env.advance(1_500);
  await new Promise((r) => setImmediate(r));
  assert.ok(Math.abs(ctl.skew() - 121_500) < 50, `écart : ${ctl.skew()}`);
  assert.equal(o.m.textContent, T.pad2(T.breakdown(start - (env.now - ctl.skew())).m));
});
