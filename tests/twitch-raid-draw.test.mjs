// Raid Twitch 2.2 — LE TIRAGE (règles pures, draw.mjs) : bornes de réglage, graine, rotation sans répétition, poids des petites chaînes, exclusions, moins de membres que demandé,
// personne en direct. Aucun Curiosa, aucun réseau : le générateur aléatoire est toujours donné.
import test from "node:test";
import assert from "node:assert/strict";

const D = await import("../modules/twitch-raid/draw.mjs");

const people = (n, viewers = () => 10) => Array.from({ length: n }, (_, i) => ({ login: `membre_${String(i).padStart(4, "0")}`, viewers: viewers(i) }));
const L = (r) => r.picks.map((p) => p.login);
const seeded = (...seed) => D.mulberry32(D.hashSeed(...seed));

test("réglages : le nombre va de 1 à 10 (5 par défaut), la durée de 1 à 240 minutes (10 par défaut), tout le reste est ramené dans l'intervalle", () => {
  assert.deepEqual([undefined, null, "", "  ", "abc", NaN, true].map(D.clampCount), [5, 5, 5, 5, 5, 5, 5]);
  assert.deepEqual([0, -3, 1, 5, 10, 11, 500, "7", 3.9].map(D.clampCount), [1, 1, 1, 5, 10, 10, 10, 7, 3]);
  assert.deepEqual([undefined, "x", "", 0, 1, 10, 240, 241, 9999, "30", 2.7].map(D.clampMinutes), [10, 10, 10, 1, 1, 10, 240, 240, 240, 30, 2]);
  assert.deepEqual([true, "true", "on", 1, false, "false", undefined, 0, ""].map(D.flag), [true, true, true, true, false, false, false, false, false]);
});

test("graine : la même graine donne la même suite, une autre graine une autre ; hashSeed est stable", () => {
  const a = seeded("site", 12, 0), b = seeded("site", 12, 0), c = seeded("site", 13, 0);
  const sa = Array.from({ length: 5 }, a), sb = Array.from({ length: 5 }, b), sc = Array.from({ length: 5 }, c);
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  assert.ok(sa.every((x) => x >= 0 && x < 1));
  assert.equal(D.hashSeed("a", 1), D.hashSeed("a", 1));
  assert.notEqual(D.hashSeed("a", 1), D.hashSeed("a", 2));
  assert.notEqual(D.hashSeed("ab", "c"), D.hashSeed("a", "bc"));
});

test("tirage : N membres parmi ceux en direct, sans doublon, déterministe sous graine, indépendant de l'ordre dans lequel Twitch a répondu", () => {
  const live = people(30);
  const r1 = D.drawMoment({ eligible: live, n: 5, rng: seeded("s") }), r2 = D.drawMoment({ eligible: live, n: 5, rng: seeded("s") });
  assert.deepEqual(L(r1), L(r2));
  assert.equal(new Set(L(r1)).size, 5);
  assert.ok(L(r1).every((l) => live.some((x) => x.login === l)));
  assert.deepEqual(L(D.drawMoment({ eligible: live.slice().reverse(), n: 5, rng: seeded("s") })), L(r1), "l'ordre d'arrivée ne change pas le tirage");
  assert.notDeepEqual(L(D.drawMoment({ eligible: live, n: 5, rng: seeded("autre") })), L(r1));
  assert.deepEqual(live.map((x) => x.login), people(30).map((x) => x.login), "la liste donnée n'est pas modifiée");
});

test("N plus grand que le nombre de membres en direct : on montre ceux qui le sont ; personne en direct : rien (sans erreur)", () => {
  assert.deepEqual(L(D.drawMoment({ eligible: people(3), n: 5, rng: seeded("a") })).sort(), people(3).map((x) => x.login));
  assert.deepEqual(L(D.drawMoment({ eligible: people(1), n: 10, rng: seeded("a") })), ["membre_0000"]);
  const none = D.drawMoment({ eligible: [], n: 5, recent: ["membre_0001"], rng: seeded("a") });
  assert.deepEqual([none.picks, none.recent], [[], ["membre_0001"]]);
  assert.equal(L(D.drawMoment({ eligible: people(20), n: 99, rng: seeded("a") })).length, 10, "N est ramené à 10 au plus");
  assert.equal(L(D.drawMoment({ eligible: people(20), n: 0, rng: seeded("a") })).length, 1, "et à 1 au moins");
  assert.equal(L(D.drawMoment({ eligible: [...people(2), ...people(2)], n: 5, rng: seeded("a") })).length, 2, "un membre doublé dans la liste n'est tiré qu'une fois");
});

test("rotation : personne ne revient tant que d'autres sont en direct ; quand tout le monde est passé, on recommence par les plus anciens", () => {
  const live = people(12);
  let recent = [], rounds = [];
  for (let i = 0; i < 6; i++) { const r = D.drawMoment({ eligible: live, n: 4, recent, rng: seeded("rot", i) }); rounds.push(L(r)); recent = r.recent; }
  assert.equal(new Set(rounds.slice(0, 3).flat()).size, 12, "trois tirages = 12 personnes différentes");
  assert.equal(new Set(rounds.slice(3).flat()).size, 12, "puis la rotation recommence : tout le monde repasse");
  for (let i = 1; i < 3; i++) assert.ok(rounds[i].every((l) => !rounds[i - 1].includes(l) && !rounds[0].includes(l)), "aucune répétition dans un tour");
  const r = D.drawMoment({ eligible: people(6), n: 4, recent: ["membre_0003", "membre_0000", "membre_0001", "membre_0002"], rng: seeded("x") });
  assert.ok(L(r).includes("membre_0004") && L(r).includes("membre_0005"), "les deux jamais montrés sont tirés");
  assert.ok(L(r).includes("membre_0003") && L(r).includes("membre_0000"), "complété par les deux montrés il y a le plus longtemps");
  assert.deepEqual(r.recent.slice(-4).sort(), L(r).sort(), "la mémoire se termine par ce qui vient d'être montré");
});

test("mémoire de rotation : bornée à 200 pseudos (les plus anciens sont oubliés d'abord), sans doublon", () => {
  assert.equal(D.RECENT_MAX, 200);
  const huge = Array.from({ length: 450 }, (_, i) => `ancien_${i}`);
  const r = D.drawMoment({ eligible: people(8), n: 5, recent: huge, rng: seeded("m") });
  assert.equal(r.recent.length, 200);
  assert.ok(!r.recent.includes("ancien_0") && r.recent.includes("ancien_449"));
  assert.deepEqual(r.recent.slice(-5).sort(), L(r).sort());
  assert.deepEqual(D.remember(["a", "b", "c"], ["b", "d"]), ["a", "c", "b", "d"], "un membre déjà là passe en dernier");
  let recent = []; for (let i = 0; i < 400; i++) recent = D.remember(recent, [`m${i}`]);
  assert.equal(recent.length, 200);
});

test("poids : « petites chaînes d'abord » favorise celles qui ont peu de spectateurs ; sans l'option, le tirage est égal pour tous", () => {
  assert.ok(D.weightOf(0) > D.weightOf(1) && D.weightOf(1) > D.weightOf(100));
  assert.ok(Number.isFinite(D.weightOf(0)) && D.weightOf(-5) === D.weightOf(0) && D.weightOf(undefined) === D.weightOf(0));
  const live = [{ login: "petit_a", viewers: 1 }, { login: "grand_b", viewers: 5000 }];
  const count = (weighted, rounds = 2000) => {
    const rng = seeded("stat", weighted); let small = 0;
    for (let i = 0; i < rounds; i++) { if (D.drawMoment({ eligible: live, n: 1, weighted, rng }).picks[0].login === "petit_a") small++; }
    return small / rounds;
  };
  assert.ok(count(true) > 0.99, "avec l'option, la petite chaîne sort presque toujours");
  const even = count(false);
  assert.ok(even > 0.45 && even < 0.55, `sans l'option, c'est égal (${even})`);
  const four = [{ login: "a", viewers: 0 }, { login: "b", viewers: 1 }, { login: "c", viewers: 2 }, { login: "d", viewers: 100000 }];
  const rng = seeded("four"); let bigIn = 0;
  for (let i = 0; i < 1000; i++) if (D.drawMoment({ eligible: four, n: 3, weighted: true, rng }).picks.some((p) => p.login === "d")) bigIn++;
  assert.ok(bigIn < 60, `le plus gros est rarement tiré (${bigIn} / 1000)`);
  assert.equal(D.weightedTake([{ login: "z" }, { login: "y" }], 2, seeded("z"), () => 0).length, 2, "des poids tous nuls ne plantent pas");
});

test("la rotation reste juste avec l'option « petites chaînes » : personne ne revient tant que des nouveaux existent", () => {
  const live = people(10, (i) => (i === 0 ? 1 : 500));
  let recent = [], seen = [];
  for (let i = 0; i < 2; i++) { const r = D.drawMoment({ eligible: live, n: 5, weighted: true, recent, rng: seeded("w", i) }); seen.push(...L(r)); recent = r.recent; }
  assert.equal(new Set(seen).size, 10, "deux tirages de 5 couvrent les 10 membres, même avec un poids très inégal");
});

test("exclusions : un pseudo, @pseudo ou lien twitch.tv par ligne (ou séparés par des virgules) ; le reste est signalé ; borné à 200", () => {
  const r = D.parseExclusions("moi_meme\n@Ami_Tv, https://www.twitch.tv/Autre_Un ; twitch.tv/dernier_x\n\nn'importe quoi ?!\nab");
  assert.deepEqual([...r.logins].sort(), ["ami_tv", "autre_un", "dernier_x", "moi_meme"]);
  assert.ok(r.ignored.length >= 2 && r.ignored.includes("ab"), "trop court ou mal écrit : signalé");
  assert.equal(r.over, false);
  assert.deepEqual([...D.parseExclusions(undefined).logins], []);
  assert.deepEqual([...D.parseExclusions("   \n  ").logins], []);
  const many = D.parseExclusions(Array.from({ length: 300 }, (_, i) => `membre_${String(i).padStart(4, "0")}`).join("\n"));
  assert.equal(many.logins.size, 200); assert.equal(many.over, true);
  assert.equal(D.parseExclusions("x".repeat(100_000)).logins.size, 0, "un texte démesuré est coupé et ne plante pas");
});
