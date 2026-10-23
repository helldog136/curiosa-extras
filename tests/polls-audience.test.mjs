import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { world, pollsMod, pollsDef, pollsFr, post, get, tok } from "./helpers/audienceWorld.mjs";
import { def as audDef, K as AK, req as areq } from "./helpers/audienceHarness.mjs";

const L = await import("../modules/polls/lib.mjs");
const T0 = Date.parse("2026-10-22T20:00:00Z");
const MIN = 60_000;
const flat = (x) => JSON.stringify(x);
const polls = async (c) => (await c.api.store.list("polls")).map((r) => ({ id: r.id, ...r.data }));
const current = async (c) => (await polls(c)).find((p) => p.round);
const rounds = async (c) => (await c.api.store.list("rounds")).map((r) => r.data);
const cfgOf = async (c) => (await c.api.store.list("meta")).find((r) => r.data.k === "cfg").data;
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
const make = async (c, over = {}) => {
  const v = L.validatePollForm({ question: "Quel jeu ?", choices: "Hollow Knight\nCeleste\nHades", max: 1, ...over }, { tz: "Europe/Paris" });
  const r = await pollsMod.createPoll(c, v.value, "Europe/Paris"); assert.ok(r.ok); return r;
};
const vote = (c, slug, ids, i, ip = `10.0.${i % 250}.${1 + Math.floor(i / 250)}`) => pollsDef.routes.vote(post("https://x.test/m/polls/vote", { poll: slug, t: tok(i), c: ids }, ip), c);
const room = (w) => `polls:${w.polls.instance.key}`;
const liveRows = async (w) => (await w.aud.api.store.list("live")).map((r) => r.data);

/* ───────────── Avec Participation : identité, voix unique, limites ───────────── */

test("un vote passe par Participation : inscrit dans la salle des sondages, une voix enregistrée, rien de lisible gardé ; le résultat est le même qu'avant", async () => {
  const w = world(); const { slug } = await make(w.polls);
  const r = await vote(w.polls, slug, ["c2"], 1, "198.51.100.20");
  assert.equal(r.status, 200); const body = await r.json(); assert.equal(body.ok, true); assert.deepEqual(body.mine, ["c2"]);
  const rm = await AK.getRoom(w.aud, room(w)); assert.deepEqual([rm.count, rm.claims], [1, 1]);
  const poll = (await polls(w.polls))[0]; assert.equal(poll.voters, 1); assert.equal(poll.counts.c2, 1);
  assert.equal((await w.polls.api.store.list(`b-${poll.id}`)).length, 1, "le bulletin reste chez Sondages");
  for (const c of [w.polls, w.aud]) { const all = flat(c.api.store.all()); assert.ok(!all.includes(tok(1)) && !all.includes("198.51.100.20")); }
  assert.ok(w.state.calls.some(([m]) => m === "limit") && w.state.calls.some(([m]) => m === "join") && w.state.calls.some(([m]) => m === "claim"));
  assert.ok(w.state.calls.filter(([m]) => m !== "claim" && m !== "join" && m !== "limit").every(([, a]) => !JSON.stringify(a).includes("tok0")), "le code ne voyage que là où il sert");
});

test("une voix par personne : rejouer = « déjà voté », même depuis une autre connexion ; deux personnes = deux voix ; un vote refusé rend la voix", async () => {
  const w = world(); const { slug } = await make(w.polls);
  assert.equal((await vote(w.polls, slug, ["c1"], 1, "1.1.1.1")).status, 200);
  const again = await vote(w.polls, slug, ["c3"], 1, "2.2.2.2");
  assert.deepEqual([again.status, (await again.json()).reason], [409, "already"]);
  assert.equal((await polls(w.polls))[0].voters, 1);
  assert.equal((await vote(w.polls, slug, ["c1"], 2, "1.1.1.1")).status, 200);
  assert.equal((await polls(w.polls))[0].counts.c1, 2);
  // un choix invalide : la voix est rendue, la personne peut réessayer
  const bad = await vote(w.polls, slug, ["zz"], 3);
  assert.equal(bad.status, 400);
  assert.equal((await vote(w.polls, slug, ["c2"], 3)).status, 200, "la voix n'a pas été gâchée");
  assert.equal((await AK.getRoom(w.aud, room(w))).claims, 3);
  // un sondage fermé ne consomme aucune voix
  const closed = await make(w.polls, { question: "Fermé ?" });
  await pollsDef.mcp.poll_close(w.polls, { id: closed.id });
  const before = (await AK.getRoom(w.aud, room(w))).claims;
  assert.equal((await vote(w.polls, closed.slug, ["c1"], 9)).status, 409);
  assert.equal((await AK.getRoom(w.aud, room(w))).claims, before);
});

test("Participation absente : tout marche comme avant (mode autonome), sans appel ni erreur", async () => {
  const w = world({ audience: false }); const { slug } = await make(w.polls);
  assert.equal((await vote(w.polls, slug, ["c1"], 1)).status, 200);
  assert.equal((await vote(w.polls, slug, ["c1"], 1)).status, 409);
  const same = []; for (let i = 0; i < 12; i++) same.push((await vote(w.polls, slug, ["c1"], 100 + i, "3.3.3.3")).status);
  assert.equal(same.filter((x) => x === 200).length, 8, "la limite locale s'applique : 8 essais en 10 minutes par sondage et par connexion");
  const hourly = []; for (let p = 0; p < 5; p++) { const other = await make(w.polls, { question: `Autre ${p} ?` }); for (let i = 0; i < 7; i++) hourly.push((await vote(w.polls, other.slug, ["c1"], 200 + p * 10 + i, "3.3.3.4")).status); }
  assert.equal(hourly.filter((x) => x === 200).length, 30, "30 votes par heure et par connexion");
  assert.equal(hourly.filter((x) => x === 429).length, 5);
});

test("Participation en panne ou muette : le vote passe par le mode autonome, jamais bloqué ; il reprend avec elle quand elle revient", async () => {
  const w = world(); const { slug } = await make(w.polls);
  w.down(true);
  assert.equal((await vote(w.polls, slug, ["c1"], 1, "4.4.4.4")).status, 200, "en panne : autonome");
  assert.equal((await vote(w.polls, slug, ["c1"], 1, "4.4.4.4")).status, 409, "le bulletin unique reste la dernière garantie");
  assert.deepEqual([(await AK.getRoom(w.aud, room(w)))], [null], "rien n'a été confié à Participation");
  w.down(false);
  assert.equal((await vote(w.polls, slug, ["c2"], 2, "4.4.4.4")).status, 200);
  assert.deepEqual((await AK.getRoom(w.aud, room(w))).count, 1);
  // un bulletin posé en mode autonome est reconnu quand Participation revient : pas de double vote
  const back = await vote(w.polls, slug, ["c3"], 1, "5.5.5.5");
  assert.deepEqual([back.status, (await back.json()).reason], [409, "already"]);
  assert.equal((await polls(w.polls))[0].voters, 2);
});

test("trou noir : si Participation ne répond jamais, le vote attend au plus quelques secondes puis passe en mode autonome", async () => {
  const w = world(); const { slug } = await make(w.polls);
  w.hang(true);
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const p = vote(w.polls, slug, ["c1"], 1, "6.6.6.6");
    for (let i = 0; i < 6; i++) { await flush(); mock.timers.tick(3000); }
    const r = await p;
    assert.equal(r.status, 200); assert.equal((await polls(w.polls))[0].voters, 1);
  } finally { mock.timers.reset(); }
});

test("sourdine : une personne en sourdine ne peut plus voter (message neutre), les autres oui ; rétablie, elle revote", async () => {
  const w = world(); const { slug } = await make(w.polls);
  assert.equal((await vote(w.polls, slug, ["c1"], 1)).status, 200);
  const me = (await audDef.services["audience.session"].who(w.aud, { room: room(w), token: tok(1) })).participant;
  const other = await make(w.polls, { question: "Autre ?" });
  const mod = Object.assign(Object.create(w.aud), { can: () => true });
  assert.equal((await audDef.services["audience.session"].mute(mod, { room: room(w), id: me.id, muted: true })).ok, true);
  const r = await vote(w.polls, other.slug, ["c1"], 1);
  assert.deepEqual([r.status, (await r.json()).reason], [403, "muted"]);
  assert.equal((await vote(w.polls, other.slug, ["c1"], 2)).status, 200);
  await audDef.services["audience.session"].mute(mod, { room: room(w), id: me.id, muted: false });
  assert.equal((await vote(w.polls, other.slug, ["c1"], 1)).status, 200);
  assert.equal(pollsFr.msg_muted.length > 10, true);
});

test("limites confiées à Participation : par heure et par connexion (réglage des sondages), par sondage en 10 minutes, par personne ; une autre connexion n'est pas touchée", async () => {
  const w = world({ pollsSettings: { ratePerHour: 5 } }); const { slug } = await make(w.polls);
  const a = []; for (let i = 1; i <= 8; i++) a.push((await vote(w.polls, slug, ["c1"], i, "7.7.7.7")).status);
  assert.deepEqual(a, [200, 200, 200, 200, 200, 429, 429, 429]);
  const retry = await vote(w.polls, slug, ["c1"], 9, "7.7.7.7"); assert.ok(Number(retry.headers.get("retry-after")) >= 1);
  assert.equal((await vote(w.polls, slug, ["c1"], 10, "7.7.7.8")).status, 200);
  assert.equal((await AK.getRoom(w.aud, room(w))).count, 6, "les refusés ne sont même pas inscrits");
  // même personne, connexions qui changent : la limite par personne compte aussi
  const w2 = world({ pollsSettings: { ratePerHour: 5 } }); const p2 = await make(w2.polls); const other = [];
  for (let i = 0; i < 8; i++) other.push((await vote(w2.polls, p2.slug, ["zz"], 1, `8.8.8.${i}`)).status);
  assert.equal(other.filter((x) => x === 429).length, 3);
});

test("120 personnes votent en même temps : 120 voix exactes, 120 inscrites, 120 voix uniques, l'écran et la page publique affichent le total final", async () => {
  const w = world(); const { slug } = await make(w.polls);
  const res = await Promise.all(Array.from({ length: 120 }, (_, i) => vote(w.polls, slug, [`c${(i % 3) + 1}`], i + 1)));
  assert.ok(res.every((r) => r.status === 200), res.map((r) => r.status).join());
  const p = (await polls(w.polls))[0];
  assert.deepEqual([p.voters, p.counts.c1, p.counts.c2, p.counts.c3], [120, 40, 40, 40]);
  const rm = await AK.getRoom(w.aud, room(w)); assert.deepEqual([rm.count, rm.claims], [120, 120]);
  globalThis.__curiosaPollsMem.hits.clear();   // la limite de 120 votes par minute pour tout le site est déjà atteinte : on repart d'une minute neuve
  const doubles = await Promise.all(Array.from({ length: 100 }, (_, i) => vote(w.polls, slug, ["c1"], i + 1)));
  assert.ok(doubles.every((r) => r.status === 409)); assert.equal((await polls(w.polls))[0].voters, 120);
  const rows = await liveRows(w);
  const screen = JSON.parse(rows.find((r) => r.channel === "screen").json), pub = JSON.parse(rows.find((r) => r.channel === "now").json);
  assert.equal(screen.voters, 120, "la dernière publication est la plus récente, malgré le désordre des arrivées"); assert.equal(pub.voters, 120);
  assert.deepEqual(screen.rows.map((r) => r.count), [40, 40, 40]);
});

/* ───────────── Le direct ───────────── */

test("direct : l'écran (canal privé, clé = adresse secrète) et la page publique (canal public) sont publiés à chaque changement ; résultats cachés avant le vote jamais publics", async () => {
  const w = world(); const { slug } = await make(w.polls, { resultsMode: "after" });
  await vote(w.polls, slug, ["c1"], 1);
  const rows = await liveRows(w);
  const screen = rows.find((r) => r.channel === "screen"), pub = rows.find((r) => r.channel === "now");
  assert.equal(screen.public, false); assert.equal(pub.public, true);
  assert.ok(screen.kh && !screen.json.includes((await cfgOf(w.polls)).obsKey), "la clé n'est jamais stockée en clair");
  assert.equal(JSON.parse(screen.json).rows.length, 3, "l'écran de la streameuse voit tout");
  assert.equal(JSON.parse(pub.json).rows, null, "le public ne voit pas les chiffres tant que le sondage les cache"); assert.equal(JSON.parse(pub.json).hidden, true);
  const id = (await polls(w.polls))[0].id;
  await pollsDef.adminActions.onAir(w.polls, { id });
  await pollsDef.mcp.poll_close(w.polls, { id });
  await pollsMod.syncLive(w.polls);
  assert.equal(JSON.parse((await liveRows(w)).find((r) => r.channel === "now").json).rows.length, 3, "fermé : tout le monde voit");
  // lecture publique par la route de Participation
  const key = (await cfgOf(w.polls)).obsKey;
  const read = (qs) => audDef.routes.direct(areq(`https://x.test/m/audience/direct?${qs}`, undefined, { ip: "9.1.1.1" }), w.aud).then((r) => r.json());
  assert.equal((await read(`room=${encodeURIComponent(room(w))}&channel=screen`)).empty, true, "écran sans clé : rien");
  assert.equal((await read(`room=${encodeURIComponent(room(w))}&channel=screen&k=${key}`)).data.question, "Quel jeu ?");
  assert.equal((await read(`room=${encodeURIComponent(room(w))}&channel=now`)).data.slug, slug);
});

test("nouvelle adresse secrète : l'ancienne ne lit plus l'écran, ni chez Sondages ni chez Participation", async () => {
  const w = world(); const { slug } = await make(w.polls); await vote(w.polls, slug, ["c1"], 1);
  const k1 = (await cfgOf(w.polls)).obsKey;
  const read = (k) => audDef.routes.direct(areq(`https://x.test/m/audience/direct?room=${encodeURIComponent(room(w))}&channel=screen&k=${k}`, undefined, { ip: "9.2.2.2" }), w.aud).then((r) => r.json());
  assert.ok((await read(k1)).data);
  assert.ok((await pollsDef.adminActions.regenerate(w.polls, { confirm: "on" })).ok);
  const k2 = (await cfgOf(w.polls)).obsKey; assert.notEqual(k1, k2);
  assert.equal((await read(k1)).empty, true); assert.ok((await read(k2)).data);
});

test("écran OBS : avec Participation il lit son point de direct (repli sur la route du module après trois échecs) ; un sondage choisi dans l'adresse reste sur la route du module ; script sûr", async () => {
  const w = world(); const { slug } = await make(w.polls);
  const key = (await (async () => { await pollsDef.hooks.onInstanceCreate(w.polls); return cfgOf(w.polls); })()).obsKey;
  const o = await pollsDef.overlay(w.polls, { query: new URLSearchParams({ k: key }) });
  const cfg = JSON.parse(/window\.__VO=(\{.*?\});\(function/s.exec(o.script)[1].replace(/\\u003c/g, "<"));
  assert.equal(cfg.url, `/m/${w.aud.instance.key}/direct?room=${encodeURIComponent(room(w))}&channel=screen&k=${key}`);
  assert.equal(cfg.alt, `/m/${w.polls.instance.key}/live?k=${key}`);
  const picked = await pollsDef.overlay(w.polls, { query: new URLSearchParams({ k: key, poll: slug }) });
  assert.ok(picked.script.includes(`/live?k=${key}&poll=${slug}`) && picked.script.includes('"alt":null'));
  const alone = world({ audience: false }); await pollsDef.hooks.onInstanceCreate(alone.polls);
  const k3 = (await cfgOf(alone.polls)).obsKey;
  assert.ok((await pollsDef.overlay(alone.polls, { query: new URLSearchParams({ k: k3 }) })).script.includes('"alt":null'));
  assert.equal((await pollsDef.overlay(w.polls, { query: new URLSearchParams({ k: "mauvaise-cle-aaaaaaaaaa" }) })).html.includes("vo-box"), false, "sans la bonne clé : un message, aucun résultat");
  assert.ok(!flat(o).includes('</script><'), "rien de fermant dans la configuration");
});

test("script des visiteurs : la bibliothèque du direct est livrée devant avec Participation, pas sans elle", async () => {
  const w = world(); await make(w.polls);
  const withLib = await (await pollsDef.routes.client(get("https://x.test/"), w.polls)).text();
  assert.ok(withLib.indexOf("AudienceDirect") >= 0 && withLib.indexOf("AudienceDirect") < withLib.indexOf("vp-id"));
  const alone = await (await pollsDef.routes.client(get("https://x.test/"), world({ audience: false }).polls)).text();
  assert.ok(!alone.includes("g.AudienceDirect = {") && alone.includes("vp-id"));
  new (await import("node:vm")).Script(withLib);
});

test("page « en cours » avec Participation : se met à jour par le direct (adresse du point de lecture, manche et état connus) ; sans elle : aucun direct", async () => {
  const w = world(); await pollsMod.startSeries(w.polls, Date.now());
  const html = (await pollsDef.page(w.polls, { segments: ["now"] })).blocks[0].html;
  const cfg = JSON.parse(/data-vp-live="([^"]+)"/.exec(html)[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;/g, "'"));
  assert.equal(cfg.url, `/m/${w.aud.instance.key}/direct?room=${encodeURIComponent(room(w))}&channel=now`);
  assert.deepEqual([cfg.slug, cfg.state], [(await current(w.polls)).slug, "open"]);
  assert.ok(cfg.base >= 3000 && cfg.max <= 30000 && cfg.t.decided.includes("{winner}"));
});

/* ───────────── Une manche vue de bout en bout ───────────── */

test("fin de manche vue par un lecteur de l'écran : il demande à Participation, qui voit que l'état est périmé et réveille Sondages ; la décision et la manche suivante sont publiées", async () => {
  mock.timers.enable({ apis: ["Date"], now: T0 });
  try {
    const w = world();
    await pollsDef.hooks.onInstanceCreate(w.polls);
    await pollsMod.startSeries(w.polls);
    const r1 = await current(w.polls);
    for (let i = 1; i <= 9; i++) assert.equal((await vote(w.polls, r1.slug, [i <= 5 ? "c1" : "c3"], i)).status, 200);
    const key = (await cfgOf(w.polls)).obsKey;
    const read = () => audDef.routes.direct(areq(`https://x.test/m/audience/direct?room=${encodeURIComponent(room(w))}&channel=screen&k=${key}`, undefined, { ip: "9.3.3.3" }), w.aud).then((r) => r.json());
    const during = await read();
    assert.deepEqual([during.data.round, during.data.voters], [{ n: 1 }, 9]);
    mock.timers.setTime(T0 + 10 * MIN + 3000);
    const after = await read();
    assert.equal(after.data.round.n, 2, "le lecteur voit déjà la manche suivante");
    assert.equal(after.data.decision.winner, pollsFr.roundChoice1); assert.equal(after.data.decision.voters, 9);
    assert.equal((await rounds(w.polls)).length, 1);
    const log = (await w.aud.api.store.list("audit")).map((r) => r.data);
    assert.ok(log.some((l) => l.who === "polls" && l.what === "round.decision" && /On continue/.test(l.detail)), "le journal de Participation dit qui a décidé quoi");
    assert.ok(log.some((l) => l.what === "round.start"));
    const still = await read();
    assert.equal(still.data.round.n, 2);
  } finally { mock.timers.reset(); }
});

test("égalité vue à l'écran : le tirage au sort est dit dans les données publiées", async () => {
  mock.timers.enable({ apis: ["Date"], now: T0 });
  try {
    const w = world(); await pollsDef.hooks.onInstanceCreate(w.polls); await pollsMod.startSeries(w.polls);
    const r1 = await current(w.polls);
    await vote(w.polls, r1.slug, ["c1"], 1); await vote(w.polls, r1.slug, ["c2"], 2);
    mock.timers.setTime(T0 + 10 * MIN + 1000);
    await pollsMod.advance(w.polls, Date.now(), { rand: () => 0 });
    const screen = JSON.parse((await liveRows(w)).find((r) => r.channel === "screen").json);
    assert.deepEqual(screen.decision.tie, [pollsFr.roundChoice1, pollsFr.roundChoice2]); assert.equal(screen.decision.winner, pollsFr.roundChoice1);
    const pub = JSON.parse((await liveRows(w)).find((r) => r.channel === "now").json);
    assert.deepEqual(pub.decision.tie, screen.decision.tie, "le public voit la même chose");
  } finally { mock.timers.reset(); }
});

/* ───────────── La télécommande ───────────── */

test("télécommande de bout en bout : la streameuse lance, passe au suivant, lance un « A ou B ? » et arrête, depuis la page secrète de Participation", async () => {
  const w = world();
  await AK.ensureMeta(w.aud); const rk = (await w.aud.api.store.list("meta")).find((r) => r.data.k === "cfg").data.remoteKey;
  const state = async () => (await audDef.routes["remote-state"](areq(`https://x.test/m/audience/remote-state?k=${rk}`), w.aud)).json();
  const press = (action, values = {}, panel = "id-polls") => audDef.routes["remote-press"](areq("https://x.test/m/audience/remote-press", { k: rk, panel, action, values }), w.aud).then(async (r) => ({ status: r.status, ...(await r.json()) }));
  let st = await state();
  const panel = st.panels[0];
  assert.equal(panel.title, "Sondages"); assert.deepEqual(panel.buttons.map((b) => [b.id, b.disabled]), [["start", false], ["next", true], ["stop", true]]);
  assert.equal(panel.buttons[2].tone, "danger"); assert.ok(panel.buttons[2].confirm);
  assert.deepEqual(panel.forms[0].fields.map((f) => f.name), ["a", "b", "c", "d", "seconds"]); assert.equal(panel.forms[0].fields[4].options.length, 4);
  let r = await press("start"); assert.deepEqual([r.status, r.ok], [200, true]); assert.match(r.message, /C'est parti/);
  st = await state(); assert.equal(st.panels[0].state.tone, "live"); assert.ok(st.panels[0].state.until); assert.match(st.panels[0].state.text, /Manche 1/);
  assert.deepEqual(st.panels[0].buttons.map((b) => b.disabled), [true, false, false]);
  r = await press("start"); assert.deepEqual([r.status, r.ok, r.error], [400, false, "already"]);
  const r1 = await current(w.polls); await vote(w.polls, r1.slug, ["c2"], 1);
  r = await press("next"); assert.ok(r.ok);
  assert.match((await state()).panels[0].state.text, /Dernière décision \(manche 1\) : On change de jeu/);
  r = await press("quick", { a: "", b: "Face", seconds: "60" });
  assert.deepEqual([r.status, r.ok, r.error, r.field], [400, false, "invalid", "a"]); assert.match(r.message, /Exemple/);
  r = await press("quick", { a: "Pile", b: "Face", seconds: "30" }); assert.ok(r.ok); assert.match(r.message, /écran/);
  const quick = (await polls(w.polls)).find((p) => p.quick); assert.equal(quick.question, "Pile ou Face ?");
  const screen = JSON.parse((await liveRows(w)).find((x) => x.channel === "screen").json);
  assert.equal(screen.question, "Pile ou Face ?", "le sondage rapide passe devant, à l'écran, tout de suite");
  r = await press("stop"); assert.ok(r.ok); assert.match(r.message, /arrêtées/);
  r = await press("stop"); assert.deepEqual([r.ok, r.error], [false, "idle"]);
  r = await press("dance"); assert.equal(r.ok, false);
  const log = (await w.aud.api.store.list("audit")).map((x) => x.data.what);
  assert.ok(["polls.start", "polls.next", "polls.quick", "polls.stop"].every((x) => log.includes(x)), "chaque geste est au journal");
});

test("télécommande : le panneau de Sondages respecte la forme attendue par Participation (boutons ≤ 8, formulaires ≤ 3, textes bornés) et reste valable en anglais", async () => {
  for (const locale of ["fr", "en"]) {
    const w = world({ locale });
    const { panel } = await pollsDef.services["audience.remote"].describe(w.polls, {});
    const clean = (await import("../modules/audience/lib.mjs")).sanitizePanel(panel);
    assert.deepEqual(clean.buttons.map((b) => b.id), panel.buttons.map((b) => b.id), "rien n'est écarté");
    assert.deepEqual(clean.forms[0].fields.map((f) => f.name), panel.forms[0].fields.map((f) => f.name));
    assert.ok(panel.title.length <= 60 && panel.buttons.every((b) => b.label.length <= 40 && (!b.confirm || b.confirm.length <= 120)));
    assert.ok(panel.forms[0].fields.every((f) => f.label.length <= 40), locale);
  }
  const w = world();
  assert.deepEqual(await pollsDef.services["audience.remote"].tick(w.polls, { room: "autre:salle", channel: "screen" }), { ok: true, handled: false });
  assert.deepEqual(await pollsDef.services["audience.remote"].tick(w.polls, { room: room(w), channel: "screen" }), { ok: true, handled: true });
  const manifest = JSON.parse((await import("node:fs")).readFileSync(new URL("../modules/polls/module.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.offers, [{ service: "audience.remote", version: 1, each: true }]);
  assert.deepEqual(manifest.requires, [{ service: "audience.session", min: 1, optional: true }], "Participation est facultative");
});

test("administration avec Participation : plus d'invitation à l'installer, un lien vers elle", async () => {
  const w = world({ audience: true });
  w.polls.api.services.providers = async () => [{ id: "id-audience", key: "audience", name: "Participation", module: "audience", version: 1, each: false, master: true }];
  w.polls.api.instances.list = async () => [{ id: "i1", key: "audience", module: "audience", basePath: "participation", name: "Participation", adminPath: "/admin/instances/i1" }];
  const b = (await pollsDef.adminPanel(w.polls, { query: {} })).filter((x) => x.tab === "screen");
  assert.ok(!b.some((x) => x.type === "suggestInstall"));
  assert.ok(flat(b).includes("/admin/instances/i1"));
});
