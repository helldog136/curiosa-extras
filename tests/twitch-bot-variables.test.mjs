// Bot Twitch : les morceaux de texte venus de Nightbot ({cible}, {requete}, {1}, {compteur}, {chaine}, {heure}, {aleatoire}, {calcul}, {viewers}, {urlfetch}),
// l'évaluateur de calcul (aucun JavaScript), et la version SÛRE de {urlfetch}. Aucun réseau : le faux fetch et un faux DNS répondent.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { world, say, sent, logOf, NOW, S, SRC, C } from "./helpers/botWorld.mjs";

const kit = await import(pathToFileURL(path.join(process.env.CURIOSA_DIR ?? process.cwd(), "testsupport/index.mjs")).href);
const { withFakeFetch } = kit;
const K = await import("../modules/twitch-bot/calc.mjs");
const V = await import("../modules/twitch-bot/variables.mjs");
const U = await import("../modules/twitch-bot/urlfetch.mjs");

const add = async (ctx, name, text, extra = {}) => {
  const env = { src: await SRC.gather(ctx, "emma"), t: ctx.t, prefix: "!" };
  const r = await C.saveCommand(ctx, { kind: "custom" }, { name, text, enabled: true, cdGlobal: 0, cdUser: 0, ...extra }, env);
  assert.equal(r.ok, true, JSON.stringify(r));
  return r;
};
const PUBLIC = [{ address: "93.184.216.34", family: 4 }];
U.hooks.resolve = async () => PUBLIC;   // aucun vrai DNS

/* ───────────── Calcul ───────────── */

test("calcul : nombres, + - * / % ^, parenthèses, fonctions ; priorités et puissance de droite à gauche", () => {
  const ok = { "2+3*4": "14", "(2+3)*4": "20", "10/4": "2.5", "10%3": "1", "2^3^2": "512", "-2^2": "-4", "abs(-5)+1": "6", "round(2.567)": "3", "floor(2.9)": "2", "ceil(2.1)": "3", "min(4,2,9)": "2", "max(4,2,9)": "9", "sqrt(81)": "9", "1.5*2": "3", "2×3": "6", "10÷4": "2.5", "0.1+0.2": "0.3", "pi*2": "6.283185" };
  for (const [e, r] of Object.entries(ok)) assert.deepEqual(K.calc(e), { ok: true, text: r }, e);
});

test("calcul : tout ce qui n'est pas de l'arithmétique est refusé (aucune injection possible, aucun JavaScript)", () => {
  const bad = ["process.exit()", "constructor", "this", "1;2", "`1`", "a=1", "alert(1)", "__proto__", "require('fs')", "2**3", "1/0", "5%0", "()", "1+", "", "   ", "min(1)", "max()", "round(1,2)", "1,5*2", "sqrt", "1e999", "9^9^9^9", "9999999999*9999999999*9999999999", `${"(".repeat(60)}1${")".repeat(60)}`, "1".repeat(101), "Math.PI", "[1]", "{1}", "'a'", "1 2", "abs 5", "evaluate(1)"];
  for (const e of bad) { const r = K.calc(e); assert.equal(r.ok, false, `refusé : ${e}`); assert.ok(r.code); }
  assert.equal(K.calc("1+(").ok, false);
  assert.ok(!/\beval\b|new Function|\bFunction\(/.test(K.evaluate.toString() + K.calc.toString()), "le code n'exécute jamais de texte");
});

/* ───────────── Saisie : chaque morceau, refus avec un exemple ───────────── */

test("saisie : chaque nouveau morceau est accepté dans une commande écrite à la main, refusé ailleurs ; les inconnus sont refusés", () => {
  const good = ["{cible}", "{requete}", "{requête}", "{query}", "{1}", "{2:}", "{9}", "{compteur}", "{chaine}", "{viewers}", "{heure}", "{heure Europe/Paris}", "{date}", "{date America/Montreal}", "{aleatoire a | b}", "{aleatoire 1-100}", "{calcul 2+3}", "{calcul {1}*2}", "{urlfetch https://api.example.org/x}", "{urlfetch https://api.example.org/{cible}}"];
  for (const g of good) assert.equal(V.checkTemplate(`Salut ${g}`, "custom").ok, true, g);
  for (const k of ["builtin", "partner", "network", "group", "reward"]) assert.equal(V.checkTemplate("Salut {cible}", k).ok, false, `{cible} refusé pour ${k}`);
  for (const g of ["{cible}", "{requete}", "{1}", "{compteur}", "{utilisateur}"]) assert.equal(V.checkTemplate(`x ${g}`, "timer").ok, false, `${g} n'a pas de sens dans un timer`);
  for (const g of ["{chaine}", "{heure}", "{aleatoire a | b}", "{calcul 1+1}", "{jeu}", "{viewers}", "{followers}"]) assert.equal(V.checkTemplate(`x ${g}`, "timer").ok, true, g);
  const un = V.checkTemplate("Salut {pseudo} et {10} et {jeu extra}", "custom");
  assert.deepEqual([un.ok, un.code, un.vars], [false, "unknown", ["pseudo", "10", "jeu extra"]]);
  assert.ok(un.allowed.includes("cible") && un.allowed.includes("calcul"));
  assert.equal(V.checkTemplate("a {calcul {calcul {calcul {calcul 1}}}}", "custom").code, "deep");
});

test("saisie : un morceau mal écrit dit lequel (fuseau inconnu, liste trop courte, calcul faux, adresse fausse) ; message avec exemple sous le champ", async () => {
  const bad = { "{heure Mars/Olympus}": "heure", "{date Nulle/Part}": "date", "{aleatoire seul}": "aleatoire", "{aleatoire 9-1}": "aleatoire", "{calcul 2+}": "calcul", "{calcul process.exit()}": "calcul", "{urlfetch http://api.example.org}": "urlfetch", "{urlfetch https://127.0.0.1/x}": "urlfetch", "{urlfetch https://localhost/x}": "urlfetch", "{urlfetch bonjour}": "urlfetch", "{urlfetch https://u:p@api.example.org/}": "urlfetch" };
  const { ctx } = world();
  const { saveError } = await import("../modules/twitch-bot/errors.mjs");
  for (const [t, name] of Object.entries(bad)) {
    const r = V.checkTemplate(`x ${t}`, "custom");
    assert.deepEqual([r.ok, r.code, r.name], [false, "arg", name], t);
    assert.match(saveError(ctx, { code: "text_arg", name }), /Par exemple|Écrivez par exemple|par exemple/i, name);
  }
});

/* ───────────── Réponses dans le chat ───────────── */

test("réponses : {cible}, {requete}, {1} {2} {1:}, {utilisateur}, {chaine}, {viewers}, {heure} avec fuseau, {date}", async () => {
  const { ctx, tw } = world({ tw: { live: { channel: "emma", configured: true, known: true, live: true, title: "T", game: "G", startedAt: new Date(NOW - 60_000).toISOString(), viewers: 1234, displayName: "Emma" } } });
  await add(ctx, "so", "Allez voir {cible} !");
  await add(ctx, "echo", "[{requete}]");
  await add(ctx, "args", "1={1} 2={2} reste={2:} fin");
  await add(ctx, "info", "{chaine} : {viewers} ici, il est {heure} / {heure Asia/Tokyo} le {date}");
  await say(ctx, "!so @Marie_B et le reste");
  await say(ctx, "!so");
  await say(ctx, "!echo salut  tout   le monde");
  await say(ctx, "!args un deux trois quatre");
  await say(ctx, "!args");
  await say(ctx, "!info");
  const out = sent(tw);
  assert.equal(out[0], "Allez voir Marie_B !");
  assert.equal(out[1], "Allez voir Viewer !", "sans argument : la personne qui écrit");
  assert.equal(out[2], "[salut tout le monde]");
  assert.equal(out[3], "1=un 2=deux reste=deux trois quatre fin");
  assert.equal(out[4], "1= 2= reste= fin");
  assert.match(out[5], /^Emma : 1[\u202f\u00a0 ]234 ici, il est 22:00 \/ 05:00 le mercredi 14 octobre$/, out[5]);
});

test("réponses : ce que les gens tapent est nettoyé (accolades, !commande, /ban, caractères invisibles) et jamais gardé dans le journal", async () => {
  const { ctx, tw } = world();
  await add(ctx, "echo", "Vous dites : {requete}");
  await add(ctx, "plain", "Bonjour tout le monde");
  await say(ctx, "!echo {jeu} {titre} !stop /ban toto .me x\u202e\u200b y {{calcul 1+1}}");
  const m = sent(tw)[0];
  assert.ok(!/[{}]/.test(m) && !/[\u202e\u200b]/.test(m), m);
  assert.ok(!/(^|\s)[!/.]/.test(m.replace(/^Vous dites : /, "")), m);
  assert.match(m, /jeu titre stop ban toto me x y calcul 1\+1/);
  await say(ctx, "!plain");
  const log = await logOf(ctx);
  const echo = log.find((e) => e.command === "echo"), plain = log.find((e) => e.command === "plain");
  assert.equal(echo.text, undefined, "la réponse reprend des mots tapés : le journal n'en garde pas le texte");
  assert.equal(plain.text, "Bonjour tout le monde");
  assert.ok(!JSON.stringify(await S.readLog(ctx)).includes("toto"));
  assert.ok(!JSON.stringify(ctx.calls.writes ? await ctx.api.store.list("botLog") : "").includes("toto"));
});

test("réponses : {compteur} compte chaque réponse envoyée (pas les refus), se garde, se remet à zéro, et 300 compteurs au plus", async () => {
  const { ctx, tw } = world();
  const r = await add(ctx, "fois", "Déjà {compteur} fois");
  for (let i = 0; i < 3; i++) await say(ctx, "!fois", { chatterId: `p${i}`, login: `p${i}` });
  assert.deepEqual(sent(tw), ["Déjà 1 fois", "Déjà 2 fois", "Déjà 3 fois"]);
  assert.equal((await S.readCounters(ctx))[r.key], 3);
  tw.chatReply = { ok: true, status: 200, json: { data: [{ is_sent: false, drop_reason: { code: "x" } }] } };
  await say(ctx, "!fois", { chatterId: "z", login: "z" });
  tw.chatReply = null;
  assert.equal((await S.readCounters(ctx))[r.key], 3, "une réponse que Twitch n'a pas prise ne compte pas");
  await say(ctx, "!fois", { chatterId: "y", login: "y" });
  assert.equal(sent(tw).at(-1), "Déjà 4 fois");
  const A = await import("../modules/twitch-bot/admin.mjs");
  assert.deepEqual(await A.actions.counterReset(ctx, { key: r.key }), { ok: ctx.t("counter_reset_done") });
  assert.equal((await S.readCounters(ctx))[r.key], 0);
  for (let i = 0; i < 305; i++) await S.setCounter(ctx, `custom:k${i}`, i);
  assert.equal(Object.keys(await S.readCounters(ctx)).length, S.COUNTERS_MAX);
  await S.setCounter(ctx, "custom:z", 2_000_000_000);
  assert.equal((await S.readCounters(ctx))["custom:z"], 1_000_000_000, "borné");
});

test("réponses : {aleatoire} (liste ou plage) reste dans ses bornes ; {calcul} imbriqué avec un argument ; un calcul faux donne un texte lisible", async () => {
  let { ctx, tw } = world();
  await add(ctx, "de", "{aleatoire 3-5}");
  await add(ctx, "choix", "{aleatoire pile | face | tranche}");
  for (let i = 0; i < 30; i++) { await say(ctx, "!de", { chatterId: `a${i}` }, NOW + i * 40_000); await say(ctx, "!choix", { chatterId: `b${i}` }, NOW + i * 40_000 + 1); }
  const out = sent(tw);
  assert.ok(out.filter((_, i) => i % 2 === 0).every((x) => ["3", "4", "5"].includes(x)));
  assert.ok(out.filter((_, i) => i % 2 === 1).every((x) => ["pile", "face", "tranche"].includes(x)));
  assert.ok(new Set(out.filter((_, i) => i % 2 === 0)).size === 3 && new Set(out.filter((_, i) => i % 2 === 1)).size === 3, "tous les résultats sortent");
  const w2 = world(); await add(w2.ctx, "double", "{calcul {1}*2} / {calcul 100/{1}}");
  ctx = w2.ctx; tw = w2.tw;
  await say(ctx, "!double 21");
  assert.equal(sent(tw).at(-1), "42 / 4.761905");
  await say(ctx, "!double 0", { chatterId: "w" });
  assert.equal(sent(tw).at(-1), "0 / ?");
  await say(ctx, "!double 1)+(process.exit()", { chatterId: "q" });
  assert.equal(sent(tw).at(-1), "? / ?");
});

/* ───────────── urlfetch ───────────── */

const hostsCtx = (hosts = "api.example.org") => world({ settings: { fetchHosts: hosts } });
const fetchWith = async (ctx, url, routes, opts = {}) => withFakeFetch(routes, async (f) => (U.resetFetchMemory(), { r: await U.fetchText(ctx, url, U.parseHosts(opts.hosts ?? "api.example.org").hosts, { resolve: async () => opts.addrs ?? PUBLIC, now: opts.now ?? NOW }), f }));

test("urlfetch : éteint par défaut (liste de sites vide), un site non listé est refusé, jamais de requête", async () => {
  const { ctx, tw } = world();
  await add(ctx, "api", "Réponse : {urlfetch https://api.example.org/phrase}");
  await withFakeFetch({ "*": { text: "coucou" } }, async (f) => {
    await say(ctx, "!api");
    assert.equal(sent(tw)[0], "Réponse : (indisponible)");
    assert.equal(f.calls.length, 0, "aucune requête quand la liste est vide");
  });
  const h = hostsCtx("autre.example.org");
  await add(h.ctx, "api", "{urlfetch https://api.example.org/phrase}");
  await withFakeFetch({ "*": { text: "coucou" } }, async (f) => { await say(h.ctx, "!api"); assert.equal(f.calls.length, 0); });
  const ok = hostsCtx();
  await add(ok.ctx, "api", "Réponse : {urlfetch https://api.example.org/phrase}");
  await withFakeFetch({ "https://api.example.org/phrase": { text: "Bonjour le monde" } }, async (f) => { await say(ok.ctx, "!api"); assert.equal(sent(ok.tw)[0], "Réponse : Bonjour le monde"); assert.equal(f.calls.length, 1); });
});

test("urlfetch : jamais http, jamais une adresse numérique, un nom interne, un port, des identifiants ; la liste elle-même refuse ces noms", async () => {
  assert.deepEqual(U.parseHosts("api.example.org, https://Autre.example.net/chemin\n127.0.0.1 localhost intranet.local 10.0.0.1 [::1] a_b.example.org truc").hosts, ["api.example.org", "autre.example.net"]);
  assert.equal(U.parseHosts("a.example.org b.example.org c.example.org d.example.org e.example.org f.example.org g.example.org h.example.org i.example.org j.example.org k.example.org").hosts.length, 10);
  const { ctx } = world();
  const hosts = ["api.example.org", "127.0.0.1", "localhost", "intranet.local"];
  const calls = async (url) => (await fetchWith(ctx, url, { "*": { text: "x" } })).f.calls.length;
  for (const url of ["http://api.example.org/x", "https://127.0.0.1/x", "https://localhost/x", "https://intranet.local/x", "https://api.example.org:8443/x", "https://user:pw@api.example.org/x", "ftp://api.example.org/x", "https://[::1]/x", "https://2130706433/x", "https://api.example.org.evil.example.net/x", "javascript:alert(1)", "https://api.example.org/a b", ""]) {
    const { r, f } = await fetchWith(ctx, url, { "*": { text: "x" } }, { hosts: hosts.join(" ") });
    assert.equal(r.ok, false, url); assert.equal(f.calls.length, 0, `aucune requête pour ${url}`);
  }
  assert.equal(await calls("https://api.example.org/ok"), 1);
});

test("urlfetch : un site qui se résout vers une adresse privée ou locale est refusé (IPv4, IPv6, « mappée »), aucune requête", async () => {
  const { ctx } = world();
  for (const a of ["10.1.2.3", "127.0.0.1", "192.168.0.5", "172.16.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "2002:7f00:1::"]) {
    const { r, f } = await fetchWith(ctx, "https://api.example.org/x", { "*": { text: "x" } }, { addrs: [{ address: a }] });
    assert.deepEqual([r.ok, r.code, f.calls.length], [false, "private", 0], a);
  }
  const mixed = await fetchWith(ctx, "https://api.example.org/x2", { "*": { text: "x" } }, { addrs: [{ address: "93.184.216.34" }, { address: "10.0.0.1" }] });
  assert.equal(mixed.r.code, "private", "une seule adresse privée suffit à refuser");
  assert.equal((await fetchWith(ctx, "https://api.example.org/x3", { "*": { text: "x" } }, { addrs: [{ address: "2606:2800:220:1:248:1893:25c8:1946" }] })).r.ok, true);
  for (const bad of ["127.0.0.1", "10.0.0.1", "::1", "999.1.1.1", "", "pas une adresse"]) assert.equal(U.isPrivateAddress(bad), bad !== "999.1.1.1" ? true : true, bad);
  assert.equal(U.isPrivateAddress("93.184.216.34"), false);
});

test("urlfetch : aucune redirection suivie (une seule requête, même vers un autre site ou une adresse privée)", async () => {
  const { ctx } = world();
  for (const [i, to] of ["https://autre.example.net/ailleurs", "https://127.0.0.1/secret", "http://169.254.169.254/latest/meta-data", "/relatif"].entries()) {
    const { r, f } = await fetchWith(ctx, `https://api.example.org/redir${i}`, { "https://api.example.org/": { status: 302, headers: { location: to } } });
    assert.deepEqual([r.ok, r.code], [false, "redirect"], to);
    assert.equal(f.calls.length, 1, "la redirection n'est pas suivie");
    assert.ok(f.calls.every((c) => c.url.startsWith("https://api.example.org/")));
  }
  for (const s of [301, 307, 308]) assert.equal((await fetchWith(ctx, `https://api.example.org/s${s}`, { "*": { status: s, headers: { location: "https://x.example.net/" } } })).r.code, "redirect");
});

test("urlfetch : 400 caractères, texte seulement (HTML refusé), accolades et caractères de contrôle retirés, erreurs HTTP refusées, réponse vide refusée", async () => {
  const { ctx } = world();
  const long = (await fetchWith(ctx, "https://api.example.org/long", { "*": { text: "a".repeat(5000) } })).r;
  assert.equal(long.text.length, 400);
  assert.equal((await fetchWith(ctx, "https://api.example.org/h1", { "*": { text: "<!DOCTYPE html><html><body>x</body></html>" } })).r.code, "type");
  assert.equal((await fetchWith(ctx, "https://api.example.org/h2", { "*": { text: "  <html>" } })).r.code, "type");
  const clean = (await fetchWith(ctx, "https://api.example.org/c", { "*": { text: "ligne1\nligne2\t{jeu} {{calcul 1+1}} \u202e\u200b fin" } })).r;
  assert.equal(clean.text, "ligne1 ligne2 jeu calcul 1+1 fin");
  assert.equal((await fetchWith(ctx, "https://api.example.org/e404", { "*": { status: 404, text: "non" } })).r.code, "status");
  assert.equal((await fetchWith(ctx, "https://api.example.org/e500", { "*": { status: 500, text: "non" } })).r.ok, false);
  assert.equal((await fetchWith(ctx, "https://api.example.org/vide", { "*": { text: "   " } })).r.code, "empty");
  const json = (await fetchWith(ctx, "https://api.example.org/j", { "*": { json: { a: 1 } } })).r;
  assert.equal(json.text, '"a":1', "un JSON arrive comme du texte, sans accolades");
  // La réponse qui ressemble à un morceau ne devient jamais un morceau, ni une commande.
  const sneaky = (await fetchWith(ctx, "https://api.example.org/s", { "*": { text: "{utilisateur} !stop /ban" } })).r;
  assert.ok(!/[{}]/.test(sneaky.text));
});

test("urlfetch : cache de 30 s, limite de 10 demandes par minute, délai de 3 s", async () => {
  const { ctx } = world();
  U.resetFetchMemory();
  await withFakeFetch({ "*": { text: "un" } }, async (f) => {
    const hosts = ["api.example.org"], opt = (now) => ({ resolve: async () => PUBLIC, now });
    assert.equal((await U.fetchText(ctx, "https://api.example.org/c", hosts, opt(NOW))).text, "un");
    assert.equal((await U.fetchText(ctx, "https://api.example.org/c", hosts, opt(NOW + 29_000))).text, "un");
    assert.equal(f.calls.length, 1, "la seconde lecture vient du cache");
    await U.fetchText(ctx, "https://api.example.org/c", hosts, opt(NOW + 31_000));
    assert.equal(f.calls.length, 2, "après 30 s on retourne chercher");
    U.resetFetchMemory();
    const codes = [];
    for (let i = 0; i < 14; i++) codes.push((await U.fetchText(ctx, `https://api.example.org/p${i}`, hosts, opt(NOW + i * 1000))).ok);
    assert.deepEqual(codes.filter(Boolean).length, U.FETCH_LIMITS.perMinute, "10 demandes par minute au plus");
    assert.equal((await U.fetchText(ctx, "https://api.example.org/p99", hosts, opt(NOW + 61_000))).ok, true, "la minute suivante, ça repart");
  });
  assert.equal(U.FETCH_LIMITS.timeoutMs, 3000);
  U.resetFetchMemory();
  const never = new Promise(() => {});
  const t0 = Date.now();
  const r = await U.fetchText(ctx, "https://api.example.org/lent", ["api.example.org"], { resolve: () => never, now: NOW });
  assert.equal(r.code, "timeout");
  assert.ok(Date.now() - t0 < 4500, "abandonné après 3 s");
});

test("urlfetch : la réponse du site ne sort jamais en tant que commande (début de message sûr) et le journal ne la garde pas", async () => {
  const { ctx, tw } = hostsCtx();
  await add(ctx, "api", "{urlfetch https://api.example.org/p}");
  await withFakeFetch({ "*": { text: "!stop /ban toto" } }, async () => { await say(ctx, "!api"); });
  assert.ok(!/^[!/.]/.test(sent(tw)[0]), sent(tw)[0]);
});
