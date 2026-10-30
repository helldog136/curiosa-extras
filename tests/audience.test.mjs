import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { parseManifest } from "@/core/modules/manifest";
import { audienceCtx, bind, def, manifest, fr, en, L, K, C, R, tok } from "./helpers/audienceHarness.mjs";

const DIR = new URL("../modules/audience", import.meta.url).pathname;
const sources = Object.fromEntries(["index", "core", "lib", "remote", "client"].map((f) => [f, fs.readFileSync(`${DIR}/${f}.mjs`, "utf8")]));
const DAY = 86_400_000;

/* ───────────── Manifeste, textes, code ───────────── */

test("manifeste valide ; textes présents et alignés fr/en ; réglages lus ; actions MCP et droits cohérents", () => {
  const r = parseManifest(manifest); assert.ok(r.ok, r.ok ? "" : r.error);
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  const all = Object.values(sources).join("\n");
  for (const m of all.matchAll(/\bt\("([A-Za-z0-9_]+)"/g)) assert.ok(m[1] in en, `clé manquante : ${m[1]}`);
  for (const code of ["saved", "forgotten", "net", "limit", "busy", "invalid", "unknown_room", "room_full", "muted", "pseudo_short", "pseudo_long", "pseudo_chars", "pseudo_banned", "pseudo_taken", "unknown_participant"]) assert.ok(`pm_${code}` in en, code);
  const declared = new Set(manifest.settings.map((s) => s.key));
  for (const m of all.matchAll(/ctx\.setting\("([A-Za-z0-9_]+)"\)/g)) assert.ok(declared.has(m[1]), m[1]);
  for (const a of manifest.mcp) { assert.equal(typeof def.mcp[a.name], "function", a.name); assert.ok(a.name.length <= 31); }
  assert.deepEqual(manifest.rights.map((x) => x.id).sort(), ["moderate", "remote.use"]);
  assert.equal(manifest.minCore, "0.2.5"); assert.equal(manifest.version, "1.1.0"); assert.equal(manifest.instances, "single");
  assert.equal(manifest.offers[0].service, "audience.session");
  assert.deepEqual(manifest.requires, [{ service: "audience.remote", optional: true }], "il ne dépend de rien : les modules branchés sont facultatifs");
  const byName = Object.fromEntries(manifest.mcp.map((a) => [a.name, a]));
  assert.ok(byName.audience_rooms.readOnly && byName.audience_journal.readOnly);
  assert.ok(!byName.audience_mute.readOnly && !byName.audience_mute.default, "une écriture n'est jamais accordée d'office");
  assert.ok(byName.audience_clear_room.destructive && byName.audience_clear_room.default === false);
  assert.equal(manifest.tabs.filter((t) => !["use", "settings", "sources", "general"].includes(t.id)).length, 1, "un seul onglet ajouté");
});

test("ni appel réseau direct, ni tâche de fond, ni boucle serrée ; les scripts du navigateur se compilent et restent doux", () => {
  for (const f of ["index", "core", "lib", "remote"]) {
    assert.ok(!/\bfetch\s*\(/.test(sources[f]), `${f} : pas de fetch côté serveur`);
    assert.ok(!/setInterval/.test(sources[f]), `${f} : aucun minuteur répété`);
  }
  assert.equal(def.tasks, undefined);
  for (const js of [C.CLIENT_JS, C.DIRECT_JS, C.REMOTE_JS]) { new vm.Script(js); assert.ok(!/setInterval/.test(js), "chaque interrogation est replanifiée après la réponse"); assert.ok(!/document\.cookie/.test(js)); assert.ok(/AbortSignal/.test(js), "délai sur chaque envoi"); }
  assert.ok(/visibilitychange/.test(C.DIRECT_JS) && /document\.hidden/.test(C.DIRECT_JS), "le direct se met en pause quand la page est cachée");
  assert.ok(/visibilitychange/.test(C.REMOTE_JS) && /document\.hidden/.test(C.REMOTE_JS));
  assert.ok(/credentials: "omit"/.test(C.CLIENT_JS) && /credentials: "omit"/.test(C.DIRECT_JS));
  // la boucle de la télécommande ne redessine pas pendant que la personne écrit
  assert.ok(/typing/.test(C.REMOTE_JS));
});

/* ───────────── Fonctions pures ───────────── */

test("pseudos : longueur, caractères, nettoyage, jamais tronqué ; forme pliée (accents, majuscules, chiffres pour lettres)", () => {
  const v = (s, o) => L.validatePseudo(s, o);
  assert.deepEqual(v("  Lune   Rousse ").value, "Lune Rousse");
  assert.equal(v("ab").code, "pseudo_short"); assert.equal(v("abc").ok, true);
  assert.equal(v("x".repeat(21)).code, "pseudo_long"); assert.equal(v("x".repeat(20)).ok, true);
  assert.equal(v("😀😀😀😀").code, "pseudo_chars", "pas d'émoji : illisible dans un tableau et facile à imiter");
  assert.equal(v("<b>x</b>").code, "pseudo_chars"); assert.equal(v("a'b").code, "pseudo_chars"); assert.equal(v('a"b').code, "pseudo_chars"); assert.equal(v("a.b").code, "pseudo_chars");
  assert.equal(v("_abc").code, "pseudo_chars"); assert.equal(v("-abc").code, "pseudo_chars");
  assert.equal(v("Zoë-42 Åke").ok, true); assert.equal(v("日本語").ok, true, "d'autres alphabets sont permis");
  assert.equal(v("a‮b c").value, "a b c", "les marques de sens de lecture deviennent des espaces");
  assert.equal(L.fold("Éloïse L-U_n3"), L.fold("eloise lune"), "chiffre pour lettre et accents ne comptent pas");
  assert.equal(v("zz", { min: 2 }).ok, true); assert.equal(v("z".repeat(30), { max: 30 }).ok, true);
  assert.equal(v("abcdef", { max: 5 }).code, "pseudo_long", "refusé, jamais coupé en silence");
});

test("mots interdits : mot seul, début, fin, contenu ; accents et chiffres pour lettres ; pas de faux positifs sur des mots ordinaires", () => {
  const list = L.parseBanned("# note\nadmin\nmerd*\n*nazi*\n*shole\n\n  Fuck  \n*http*");
  assert.deepEqual(list.map((x) => x.type), ["word", "prefix", "contains", "suffix", "word", "contains"]);
  const b = (s) => L.isBanned(s, list);
  assert.ok(b("Admin") && b("ADM1N") && b("l admin") && b("the-admin-team"));
  assert.ok(!b("administrateur"), "mot seul : pas de faux positif");
  assert.ok(b("merde") && b("Merdouille") && b("m3rd3"));
  assert.ok(b("xXNaziXx") && b("sous-nazi"));
  assert.ok(b("asshole") && !b("passerelle"));
  assert.ok(b("f u c k") && b("FÜCK") && b("fuck"), "séparateurs et accents ne servent pas à contourner");
  assert.ok(b("http-lien") && b("monhttpsite"));
  for (const ok of ["Classe", "Scunthorpe", "Lune-Rousse", "Pixel Chat", "Hadrien", "Cassandre", "Vincent", "Mélusine"]) assert.ok(!L.isBanned(ok, L.parseBanned(L.STARTER_BANNED)), ok);
  assert.equal(L.parseBanned("x".repeat(100))[0].v.length, 40, "chaque mot est borné");
  assert.equal(L.parseBanned(Array.from({ length: 800 }, (_, i) => `mot${i}`).join("\n")).length, L.LIMITS.banned, "500 mots au plus");
});

test("liste de départ : sobre, en français et en anglais, bloque l'essentiel, ne bloque aucun prénom courant", () => {
  const list = L.parseBanned(L.STARTER_BANNED);
  assert.ok(list.length >= 20 && list.length <= 80);
  const bad = ["Admin", "modo", "Staff", "Streameuse", "connard42", "SuperSalope", "xfuckx", "Shit-Storm", "Hitler", "nazi", "neonazi", "t3st bitch", "pute", "encule", "https://x", "WwwTwitch"];
  for (const x of bad) assert.ok(L.isBanned(x, list), x);
  for (const ok of ["Emma", "Lucas", "Léa", "Mathis", "Ines", "Zoé", "Noah", "Louise", "Sacha", "Camille", "Manon", "Jules", "Éloïse", "Dickens", "Nazim", "Pornic", "Scunthorpe", "Cassandra", "Moderne", "Botanique", "Systemic"]) assert.ok(!L.isBanned(ok, list), `faux positif : ${ok}`);
});

test("empreintes : stables dans une salle, jamais reliées entre deux salles ; l'adresse n'est jamais lisible ; le sel du jour change tout", () => {
  const salt = Buffer.alloc(32, 1);
  assert.equal(L.participantId("s1", tok(1)), L.participantId("s1", tok(1)));
  assert.notEqual(L.participantId("s1", tok(1)), L.participantId("s2", tok(1)));
  assert.notEqual(L.participantId("s1", tok(1)), L.participantId("s1", tok(2)));
  assert.match(L.participantId("s", tok(1)), /^[0-9a-f]{40}$/);
  const h = L.connHash(salt, { forwarded: "1.2.3.4, 5.6.7.8" });
  assert.equal(h, L.connHash(salt, { forwarded: "9.9.9.9, 5.6.7.8" }), "c'est le dernier relais qui compte (le seul en qui on peut avoir confiance)");
  assert.notEqual(h, L.connHash(salt, { forwarded: "5.6.7.9" }));
  assert.notEqual(h, L.connHash(Buffer.alloc(32, 2), { forwarded: "5.6.7.8" }), "un autre sel = une autre empreinte");
  assert.ok(!h.includes("5.6.7.8") && h.length === 16);
  assert.equal(L.connHash(salt, {}), L.connHash(salt, { real: "" }), "sans adresse : une empreinte commune, jamais une erreur");
  assert.ok(L.sameSecret("abc", "abc") && !L.sameSecret("abc", "abd") && !L.sameSecret("", "") && !L.sameSecret("a", "ab") && !L.sameSecret(undefined, "x"));
});

test("limiteur : fenêtre glissante, temps d'attente réel, table bornée", () => {
  const table = new Map();
  const t0 = 1_000_000;
  for (let i = 0; i < 3; i++) assert.equal(L.hit(table, "a", 3, 60_000, t0 + i * 1000).over, false);
  const over = L.hit(table, "a", 3, 60_000, t0 + 3000);
  assert.equal(over.over, true); assert.equal(over.retryAfter, 57);
  assert.equal(L.hit(table, "a", 3, 60_000, t0 + 61_000).over, false, "la fenêtre a glissé");
  for (let i = 0; i < 7000; i++) L.hit(table, `b${i}`, 3, 60_000, t0 + 70_000);
  assert.ok(table.size <= 5000, "la table ne grossit pas sans fin");
});

test("panneau de la télécommande : forme sûre et bornée, texte nettoyé, boutons et formulaires inconnus écartés", () => {
  assert.equal(L.sanitizePanel(null), null); assert.equal(L.sanitizePanel({ title: "  " }), null);
  const p = L.sanitizePanel({
    title: "Sondages", state: { text: "x".repeat(500), tone: "weird", until: "2026-10-22T20:10:00Z" },
    buttons: [{ id: "go", label: "Lancer", tone: "primary" }, { id: "Bad Id", label: "x" }, { id: "stop", label: "Stop", confirm: "Sûr ?", tone: "<script>", disabled: 1 }, ...Array.from({ length: 20 }, (_, i) => ({ id: `b${i}`, label: `B${i}` }))],
    forms: [{ id: "quick", title: "A ou B", submit: "OK", fields: [{ name: "a", label: "Choix", type: "text", required: true }, { name: "Bad", label: "x" }, { name: "s", type: "select", options: [{ value: "1", label: "Un" }, "nope"] }] }, { id: "no title" }],
  });
  assert.equal(p.state.text.length, 200); assert.equal(p.state.tone, "idle"); assert.equal(p.state.until, "2026-10-22T20:10:00.000Z");
  assert.equal(p.buttons.length, L.LIMITS.buttons); assert.equal(p.buttons[0].tone, "primary"); assert.equal(p.buttons[1].tone, "plain"); assert.equal(p.buttons[1].disabled, false, "seul `true` désactive");
  assert.ok(!p.buttons.some((b) => b.id === "Bad Id"));
  assert.equal(p.forms.length, 1); assert.deepEqual(p.forms[0].fields.map((f) => f.name), ["a", "s"]); assert.equal(p.forms[0].fields[1].options.length, 1);
  assert.deepEqual(L.sanitizeValues({ a: "x".repeat(500), "Bad Key": "1", n: 5, o: { x: 1 } }).a.length, 200);
  assert.deepEqual(Object.keys(L.sanitizeValues({ a: 1, "Bad Key": 2 })), ["a"]);
});

/* ───────────── Salles, participants, voix ───────────── */

test("salles : créées à la demande, plafond de 200 (la plus ancienne inactive s'en va, sinon refus clair)", async () => {
  const c = audienceCtx(); const s = bind(c);
  const keep = L.LIMITS.rooms; L.LIMITS.rooms = 5;
  try {
    for (let i = 0; i < 5; i++) assert.equal((await s.join({ room: `room-${i}`, token: tok(1) })).ok, true);
    assert.equal((await s.join({ room: "room-x", token: tok(1) })).error, "too_many_rooms", "toutes actives : refus clair");
    // la plus ancienne est inactive depuis plus d'un jour : elle laisse sa place
    const first = (await c.api.store.list("rooms")).find((r) => r.data.k === "room-0");
    await c.api.store.update(first.id, { ...first.data, lastAt: new Date(Date.now() - 2 * DAY).toISOString() }, { key: "room-0" });
    assert.equal((await s.join({ room: "room-x", token: tok(1) })).ok, true);
    assert.equal(await c.api.store.count("rooms"), 5);
    assert.equal((await s.who({ room: "room-0", token: tok(1) })).error, "unknown_room");
  } finally { L.LIMITS.rooms = keep; }
});

test("plafonds : personnes par salle, voix par salle, voix par personne, points de direct", async () => {
  const c = audienceCtx(); const s = bind(c);
  const keep = { ...L.LIMITS };
  try {
    L.LIMITS.participants = 3;
    for (let i = 1; i <= 3; i++) assert.equal((await s.join({ room: "full-room", token: tok(i) })).ok, true);
    assert.equal((await s.join({ room: "full-room", token: tok(4) })).error, "room_full");
    assert.equal((await s.join({ room: "full-room", token: tok(1) })).ok, true, "une personne déjà inscrite n'est pas refusée");
    L.LIMITS.claims = 2;
    assert.equal((await s.claim({ room: "full-room", token: tok(1), key: "k1" })).ok, true);
    assert.equal((await s.claim({ room: "full-room", token: tok(2), key: "k1" })).ok, true);
    assert.equal((await s.claim({ room: "full-room", token: tok(3), key: "k1" })).error, "room_full");
    await s.release({ room: "full-room", token: tok(1), key: "k1" });
    assert.equal((await s.claim({ room: "full-room", token: tok(3), key: "k1" })).ok, true, "une voix rendue libère de la place");
    L.LIMITS.channels = 2;
    assert.equal((await s.livePublish({ room: "full-room", channel: "a", data: 1 })).ok, true);
    assert.equal((await s.livePublish({ room: "full-room", channel: "b", data: 1 })).ok, true);
    assert.equal((await s.livePublish({ room: "full-room", channel: "c", data: 1 })).error, "too_many_channels");
    assert.equal((await s.livePublish({ room: "full-room", channel: "a", data: 2 })).ok, true, "un canal existant se met à jour");
  } finally { Object.assign(L.LIMITS, keep); }
});

test("nouvelles personnes : limitées par heure et par connexion ; une personne déjà inscrite n'use pas la limite ; un pseudo refusé non plus", async () => {
  const c = audienceCtx({ settings: { joinsPerHour: 5 } }); const s = bind(c);
  const conn = { forwarded: "203.0.113.5" };
  for (let i = 1; i <= 5; i++) assert.equal((await s.join({ room: "lim", token: tok(i), conn })).ok, true);
  const over = await s.join({ room: "lim", token: tok(6), conn });
  assert.deepEqual([over.ok, over.error], [false, "limit"]); assert.ok(over.retryAfter > 0);
  for (let i = 0; i < 20; i++) assert.equal((await s.join({ room: "lim", token: tok(1), conn })).ok, true, "revenir ne coûte rien");
  assert.equal((await s.join({ room: "lim", token: tok(7), conn: { forwarded: "203.0.113.6" } })).ok, true, "une autre connexion n'est pas touchée");
  const s2 = bind(audienceCtx({ settings: { joinsPerHour: 5 } }));
  assert.equal((await s2.join({ room: "lim", token: tok(1), conn, pseudo: "ab" })).error, "pseudo_short");
});

test("pseudo modifiable : liste de mots interdits réglée par Emma, bornes de longueur réglées, au plus 8 changements par heure et par personne", async () => {
  const c = audienceCtx({ settings: { bannedWords: "licorne*\n# note", pseudoMin: 4, pseudoMax: 10 } }); const s = bind(c);
  await s.join({ room: "r", token: tok(1) });
  assert.equal((await s.setPseudo({ room: "r", token: tok(1), pseudo: "Licorne42" })).error, "pseudo_banned", "sa liste remplace celle de départ");
  assert.equal((await s.setPseudo({ room: "r", token: tok(1), pseudo: "fuck-you" })).ok, true, "Emma a retiré la liste de départ : c'est son choix");
  assert.equal((await s.setPseudo({ room: "r", token: tok(1), pseudo: "abc" })).error, "pseudo_short");
  assert.equal((await s.setPseudo({ room: "r", token: tok(1), pseudo: "abcdefghijk" })).error, "pseudo_long");
  const ok = [];
  for (let i = 0; i < 12; i++) ok.push((await s.setPseudo({ room: "r", token: tok(1), pseudo: `Nom ${String(i).padStart(2, "0")}` })).ok);
  assert.ok(ok.filter(Boolean).length < 12 && ok.filter(Boolean).length >= 6, "les changements trop fréquents sont freinés");
  const d = bind(audienceCtx()); // défauts : liste de départ
  await d.join({ room: "r", token: tok(1) });
  assert.equal((await d.setPseudo({ room: "r", token: tok(1), pseudo: "fuck-you" })).error, "pseudo_banned");
});

test("sourdine : une personne en sourdine n'est pas comptée à nouveau, et reste en sourdine si elle revient ; vider la salle la libère", async () => {
  const c = audienceCtx(); const s = bind(c, { rights: false }), m = bind(c, { rights: true });
  const me = (await s.join({ room: "r", token: tok(1), pseudo: "Mute Moi" })).participant;
  assert.equal((await m.mute({ room: "r", id: me.id, muted: true })).participant.muted, true);
  const back = await s.join({ room: "r", token: tok(1) });
  assert.equal(back.participant.muted, true, "revenir ne contourne pas la sourdine");
  assert.equal((await s.join({ room: "r", token: tok(1), pseudo: "Autre Nom" })).error, "muted");
  assert.deepEqual(await m.clearRoom({ room: "r" }), { ok: true, removed: 1 });
  assert.equal((await s.join({ room: "r", token: tok(1) })).participant.muted, false, "salle vidée : repartir de zéro");
  const log = await c.api.store.list("audit");
  assert.ok(log.some((r) => r.data.what === "mute" && r.data.who === "admin") && log.some((r) => r.data.what === "clearRoom"), "chaque geste est dans le journal");
});

test("vider une salle : instantané, les anciennes données sont effacées par le ménage, par petites tranches, jamais d'un coup", async () => {
  const c = audienceCtx(); const s = bind(c, { rights: true });
  for (let i = 1; i <= 350; i++) await s.join({ room: "big", token: tok(i), conn: { forwarded: `10.1.${i}.1` } });
  const room = await K.getRoom(c, "big");
  assert.equal(room.count, 350);
  assert.deepEqual(await s.clearRoom({ room: "big" }), { ok: true, removed: 350 });
  assert.equal((await K.getRoom(c, "big")).count, 0);
  const before = await c.api.store.count(`p-${room.id}-0`);
  assert.equal(before, 350, "pas encore effacé : le vidage est immédiat, le ménage suit");
  let guard = 0;
  while ((await c.api.store.count(`p-${room.id}-0`)) > 0 && guard++ < 10) {
    const w0 = c.api.store.writes.length;
    await K.sweep(c, Date.now() + guard * 11 * 60_000, { force: true });
    assert.ok(c.api.store.writes.length - w0 <= 700, "tranche bornée");
  }
  assert.equal(await c.api.store.count(`p-${room.id}-0`), 0);
  assert.ok(guard >= 2, "en plusieurs passages");
});

/* ───────────── Purge à la lecture ───────────── */

test("purge : personnes inactives effacées après la durée réglée (14 jours par défaut), pas avant ; pseudo libéré ; salles abandonnées retirées sauf la salle générale", async () => {
  const c = audienceCtx(); const s = bind(c);
  const now = Date.now();
  await K.ensureRoom(c, K.GENERAL, "Générale");
  await s.join({ room: "old-room", token: tok(1), pseudo: "Vieux Nom" }); await s.join({ room: "old-room", token: tok(2) });
  const age = async (hours) => { for (const r of await c.api.store.list("p-" + (await K.getRoom(c, "old-room")).id + "-0", { limit: 100 })) if (!r.data.n && r.data.k === (await K.findParticipant(c, await K.getRoom(c, "old-room"), tok(1))).data.k) await c.api.store.update(r.id, { ...r.data, last: new Date(now - hours * 3_600_000).toISOString() }, { key: r.data.k }); };
  await age(13 * 24);
  await K.sweep(c, now, { force: true });
  assert.equal((await s.who({ room: "old-room", token: tok(1) })).participant.pseudo, "Vieux Nom", "13 jours : encore là");
  await age(15 * 24);
  const removed = await K.sweep(c, now + 11 * 60_000, { force: true });
  assert.ok(removed >= 1);
  assert.equal((await s.who({ room: "old-room", token: tok(1) })).participant, null, "15 jours : effacé");
  assert.equal((await s.who({ room: "old-room", token: tok(2) })).participant.id.length, 40, "les autres restent");
  assert.equal((await s.setPseudo({ room: "old-room", token: tok(2), pseudo: "Vieux Nom" })).ok, true, "le pseudo est libre");
  // salle abandonnée
  const room = await K.getRoom(c, "old-room");
  await c.api.store.update(room.id, { ...(await c.api.store.get(room.id)).data, lastAt: new Date(now - 30 * DAY).toISOString() }, { key: "old-room" });
  const gen = await K.getRoom(c, K.GENERAL);
  await c.api.store.update(gen.id, { ...(await c.api.store.get(gen.id)).data, lastAt: new Date(now - 90 * DAY).toISOString() }, { key: K.GENERAL });
  await K.sweep(c, now + 30 * 60_000, { force: true });
  assert.equal(await K.getRoom(c, "old-room"), null, "salle abandonnée retirée");
  assert.ok(await K.getRoom(c, K.GENERAL), "la salle générale reste");
  await K.sweep(c, now + 50 * 60_000, { force: true });
  assert.equal(await c.api.store.count(`p-${room.id}-0`), 0, "ses données partent au passage suivant, par tranches");
});

test("purge : la durée de conservation est réglable de 1 à 90 jours et bornée", async () => {
  for (const [setting, days] of [[0, 1], [500, 90], ["x", 14], [30, 30]]) assert.equal(K.cfgOf(audienceCtx({ settings: { retentionDays: setting } })).days, days);
});

test("purge : journal de plus de 30 jours, canaux expirés ; journal limité à 500 lignes ; rien ne tourne sans lecture (pas de minuteur)", async () => {
  const c = audienceCtx(); const s = bind(c);
  const now = Date.now();
  await c.api.store.add("audit", { at: new Date(now - 40 * DAY).toISOString(), who: "x", what: "vieux", room: null, detail: "" });
  await c.api.store.add("audit", { at: new Date(now - 1 * DAY).toISOString(), who: "x", what: "recent", room: null, detail: "" });
  await s.livePublish({ room: "r", channel: "short", data: { a: 1 }, ttlSec: 10 });
  await K.sweep(c, now, { force: true });
  assert.equal((await c.api.store.list("audit")).some((r) => r.data.what === "vieux"), false);
  assert.equal((await c.api.store.list("audit")).some((r) => r.data.what === "recent"), true);
  await K.sweep(c, now + 11 * 60_000 + 60_000, { force: true });
  assert.equal(await c.api.store.count("live"), 0, "canal expiré effacé");
  // anneau du journal
  const keep = L.LIMITS.audit; L.LIMITS.audit = 30;
  try { for (let i = 0; i < 80; i++) await s.journal({ what: `ligne ${i}` }); assert.equal(await c.api.store.count("audit"), 30, "borné, les plus anciennes s'effacent"); assert.ok((await c.api.store.list("audit")).some((r) => r.data.what === "ligne 79")); }
  finally { L.LIMITS.audit = keep; }
  // un passage de ménage coûte peu quand il n'y a rien à faire, et n'est pas relancé avant 10 minutes
  const w = c.api.store.writes.length;
  await K.sweep(c, now + 12 * 60_000);
  const w1 = c.api.store.writes.length;
  await K.sweep(c, now + 13 * 60_000);
  assert.equal(c.api.store.writes.length, w1, "pas relancé avant 10 minutes");
  assert.ok(w1 >= w);
});

test("purge : un très grand nombre de personnes inactives s'efface sur plusieurs passages, chacun borné", async () => {
  const c = audienceCtx(); const s = bind(c);
  for (let i = 1; i <= 420; i++) await s.join({ room: "bulk", token: tok(i), conn: { forwarded: `10.2.${i}.1` } });
  const room = await K.getRoom(c, "bulk");
  for (const r of await c.api.store.list(`p-${room.id}-0`, { limit: 1000 })) await c.api.store.update(r.id, { ...r.data, last: new Date(Date.now() - 20 * DAY).toISOString() }, { key: r.data.k });
  let left = 420, passes = 0;
  while (passes < 12) {
    const w0 = c.api.store.writes.length;
    await K.sweep(c, Date.now() + (++passes) * 11 * 60_000, { force: true });
    assert.ok(c.api.store.writes.length - w0 <= 1500, "un passage ne dépasse pas ses bornes");
    left = (await c.api.store.list(`p-${room.id}-0`, { limit: 1000 })).filter((r) => !r.data.n).length;
    if (!left) break;
  }
  assert.equal(left, 0); assert.ok(passes >= 2 && passes <= 8);
});

/* ───────────── Direct ───────────── */

test("direct : état publié borné, révision qui ne bouge que si l'état change, expiration, clé de lecture jamais gardée en clair, « périmé » annoncé", async () => {
  const c = audienceCtx(); const s = bind(c);
  const t0 = Date.now();
  const p1 = await s.livePublish({ room: "r", channel: "screen", data: { n: 1 }, readKey: "secret-key-123", refreshAt: new Date(t0 + 60_000).toISOString() });
  assert.equal((await s.livePublish({ room: "r", channel: "screen", data: { n: 1 }, readKey: "secret-key-123", refreshAt: new Date(t0 + 60_000).toISOString() })).rev, p1.rev);
  const w = c.api.store.writes.length;
  await s.livePublish({ room: "r", channel: "screen", data: { n: 1 }, readKey: "secret-key-123", refreshAt: new Date(t0 + 60_000).toISOString() });
  assert.equal(c.api.store.writes.length, w, "rien n'est écrit si rien n'a changé");
  assert.ok(!JSON.stringify(c.api.store.all()).includes("secret-key-123"));
  assert.equal((await K.readLive(c, { room: "r", channel: "screen", key: "secret-key-123" }, t0)).due, false);
  const later = await K.readLive(c, { room: "r", channel: "screen", key: "secret-key-123" }, t0 + 61_000);
  assert.equal(later.due, true, "le premier lecteur après l'heure apprend que l'état est périmé");
  assert.deepEqual(await K.readLive(c, { room: "r", channel: "screen" }, t0), { empty: true }, "sans clé : comme si rien n'existait");
  assert.deepEqual(await K.readLive(c, { room: "r", channel: "screen", key: "secret-key-124" }, t0), { empty: true });
  assert.equal((await K.readLive(c, { room: "r", channel: "screen", key: "secret-key-123", rev: p1.rev }, t0)).unchanged, true);
  assert.deepEqual(await K.readLive(c, { room: "r", channel: "screen", key: "secret-key-123" }, t0 + 7 * 3_600_000), { empty: true }, "expiré après 6 heures");
  assert.equal(await c.api.store.count("live"), 0, "et effacé à la lecture");
  assert.equal((await s.livePublish({ room: "r", channel: "big", data: "x".repeat(20_000) })).error, "too_big");
  assert.equal((await s.livePublish({ room: "r", channel: "k", data: 1, readKey: "short" })).error, "invalid");
});

test("bibliothèque du direct : une visite à la fois, replanifiée APRÈS la réponse, ralentit quand rien ne change, suit le conseil du site, se met en pause quand la page est cachée", async () => {
  const urls = []; let reply = { ok: true, rev: 1, data: { a: 1 } }, fail = false;
  const timers = [];
  const win = {};
  const doc = { hidden: false, addEventListener() {}, removeEventListener() {} };
  const ctx = vm.createContext({ window: win, document: doc, encodeURIComponent, AbortSignal: { timeout: () => undefined },
    fetch: (url) => { urls.push(url); return fail ? Promise.reject(new Error("net")) : Promise.resolve({ ok: true, json: () => Promise.resolve(reply) }); },
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout: () => {} });
  vm.runInContext(C.DIRECT_JS, ctx);
  const seen = []; let empties = 0, errors = 0;
  const w = win.AudienceDirect.watch({ url: "/m/a/direct?room=r&channel=c", base: 3000, max: 30000, onData: (d) => { seen.push(d); }, onEmpty: () => { empties++; }, onError: () => { errors++; } });
  const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
  const step = async () => { const t = timers.pop(); timers.length = 0; t.f(); await flush(); return timers.at(-1)?.ms; };
  await flush();
  assert.deepEqual(seen, [{ a: 1 }]); assert.match(urls[0], /\?room=r&channel=c&rev=$/);
  assert.equal(timers.at(-1).ms, 3000, "prochaine visite planifiée après la réponse, jamais en parallèle");
  reply = { ok: true, unchanged: true, rev: 1 };
  const delays = []; for (let i = 0; i < 9; i++) delays.push(await step());
  assert.match(urls.at(-1), /rev=1$/, "la révision connue est renvoyée");
  assert.deepEqual(delays.slice(0, 3), [4500, 6750, 10125]); assert.equal(delays.at(-1), 30000, "ralentit jusqu'au maximum");
  reply = { ok: true, rev: 2, data: { a: 2 }, next: 12000 };
  assert.equal(await step(), 12000, "le site peut demander d'espacer"); assert.deepEqual(seen.at(-1), { a: 2 });
  reply = { ok: true, empty: true };
  assert.ok((await step()) >= 6000); assert.equal(empties, 1);
  fail = true;
  const slow = await step(); assert.ok(slow >= 6000); assert.equal(errors, 1);
  doc.hidden = true; fail = false; const n = urls.length;
  assert.equal(await step(), 12000, "page cachée : 4 fois plus lent et rien n'est demandé"); assert.equal(urls.length, n);
  w.stop(); const after = timers.length; await flush(); assert.equal(timers.length, after);
});
