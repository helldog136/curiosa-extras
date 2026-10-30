// Participation 1.1.0 — le DOCK OBS de la télécommande : la même page, la même adresse secrète, une présentation étroite.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { audienceCtx, bind, def, fr, en, K, C, R, req, tok, manifest } from "./helpers/audienceHarness.mjs";
import { runRemotePage } from "./helpers/remoteDom.mjs";

const BASE = "https://x.test/m/audience";
const route = (name, ctx, request) => def.routes[name](request, ctx);
const meta = async (c) => { await K.ensureMeta(c); return (await c.api.store.list("meta")).find((r) => r.data.k === "cfg").data; };
const flat = (x) => JSON.stringify(x);

/** Un faux « Sondages » avec les VRAIES formes de bouton et de formulaire (voir modules/polls/index.mjs, remotePanel). */
function fakePolls({ running = false } = {}) {
  const seen = [];
  const describe = async () => ({ ok: true, panel: {
    title: "Sondages", state: { text: running ? "Manche 2 en cours" : "Rien en cours", tone: running ? "live" : "idle", until: running ? new Date(Date.now() + 90_000).toISOString() : null },
    buttons: [
      { id: "start", label: "Lancer", tone: "primary", disabled: running },
      { id: "next", label: "Suivant", disabled: !running },
      { id: "stop", label: "Arrêter", tone: "danger", confirm: "La manche sera fermée", disabled: !running },
    ],
    forms: [{ id: "quick", title: "A ou B ?", submit: "Lancer le sondage", fields: [
      { name: "a", label: "Premier choix", type: "text", required: true, max: 40 },
      { name: "b", label: "Deuxième choix", type: "text", required: true, max: 40 },
      { name: "seconds", label: "Durée", type: "select", value: "30", options: [{ value: "15", label: "15 secondes" }, { value: "30", label: "30 secondes" }] },
    ] }],
  } });
  const press = async (a) => { seen.push(a); return a.action === "quick" && !a.values.a ? { ok: false, error: "invalid", field: "a", message: "Écrivez le premier choix. Exemple : Pizza." } : { ok: true, message: "C'est lancé." }; };
  return { seen, services: { "audience.remote": [{ instance: "polls", name: "Sondages", methods: { describe, press } }] } };
}

const pageUrl = (key, extra = "") => `${BASE}/remote?k=${key}${extra}`;
const getPage = async (c, key, extra) => route("remote", c, req(pageUrl(key, extra)));
/** Le navigateur : envoie à la vraie route ce que le script demande, avec l'adresse que la PAGE lui a donnée. */
const dispatcher = (c) => async (url, init) => {
  const u = new URL(url), name = u.pathname.split("/").pop();
  const r = await def.routes[name](req(url, init.body ? JSON.parse(init.body) : undefined, { method: init.method }), c);
  return r;
};

/* ───────────── La page : même adresse, présentation choisie par &dock=1 ───────────── */

test("dock : la MÊME adresse secrète avec &dock=1 donne la présentation étroite ; sans, ou avec autre chose, c'est la télécommande du téléphone", async () => {
  const c = audienceCtx(); const { remoteKey: key } = await meta(c);
  const phone = await (await getPage(c, key)).text();
  const r = await getPage(c, key, "&dock=1"); const dock = await r.text();
  assert.equal(r.status, 200);
  assert.ok(dock.includes('<body class="ar-dock">') && !phone.includes("ar-dock\""), "la classe n'est que sur le dock");
  assert.ok(phone.includes("min-height:76px") && dock.includes(".ar-dock .ar-btn{min-height:40px"), "gros boutons du téléphone, boutons de 40 px dans le dock");
  for (const other of ["&dock=0", "&dock=true", "&dock=", "&dock=2", "&dock=0&dock=1"]) assert.ok(!(await (await getPage(c, key, other)).text()).includes('class="ar-dock"'), other);
  for (const html of [phone, dock]) assert.ok(html.includes('name="viewport"') && html.includes('content="noindex,nofollow"') && html.includes('name="referrer"'));
  assert.equal(R.wantsDock("https://x.test/a?k=1&dock=1"), true); assert.equal(R.wantsDock("https://x.test/a?k=1"), false);
});

test("dock : secret invalide refusé comme pour le téléphone (404, rien d'autre), mêmes freins ; la bonne adresse n'est jamais freinée", async () => {
  const c = audienceCtx(); const { remoteKey: key } = await meta(c);
  for (const extra of ["&dock=1", ""]) {
    for (const k of ["", "pas-la-bonne-cle", key.slice(0, -1), `${key}x`, key.toUpperCase()]) {
      const r = await route("remote", c, req(`${BASE}/remote?k=${k}${extra}`));
      assert.equal(r.status, 404, `${k}${extra}`); assert.equal(await r.text(), "Not found", "aucune page, aucun indice");
    }
  }
  assert.equal((await route("remote", c, req(`${BASE}/remote?dock=1`))).status, 404);
  const statuses = []; for (let i = 0; i < 45; i++) statuses.push((await route("remote", c, req(`${BASE}/remote?k=essai${i}&dock=1`, undefined, { ip: "6.6.6.6" }))).status);
  assert.equal(statuses.filter((x) => x === 429).length, 5, "40 essais ratés par heure et par connexion, comme la télécommande");
  for (let i = 0; i < 60; i++) assert.equal((await route("remote", c, req(`${BASE}/remote?k=${key}&dock=1`, undefined, { ip: "6.6.6.7" }))).status, 200);
  assert.equal((await route("remote", c, req(`${BASE}/remote?k=${key}&dock=1`, "x"))).status, 405);
});

test("dock : même script, mêmes routes d'état et d'appui, mêmes textes (sauf « cliquez »), une politique de sécurité qui n'autorise que la page", async () => {
  for (const [locale, msgs] of [["fr", fr], ["en", en]]) {
    const c = audienceCtx({ locale, messages: msgs }); const { remoteKey: key } = await meta(c);
    const [pr, dr] = [await getPage(c, key), await getPage(c, key, "&dock=1")];
    const [phone, dock] = [await pr.text(), await dr.text()];
    for (const [res, html] of [[pr, phone], [dr, dock]]) {
      assert.ok(html.includes(C.REMOTE_JS), "le script de la télécommande, tel quel");
      const nonce = /<script nonce="([^"]+)"/.exec(html)[1];
      const csp = res.headers.get("content-security-policy");
      assert.ok(csp.includes(`script-src 'nonce-${nonce}'`) && csp.includes(`style-src 'nonce-${nonce}'`) && csp.includes("default-src 'none'") && csp.includes("connect-src 'self'") && csp.includes("form-action 'none'"));
      assert.ok(html.includes(`<style nonce="${nonce}">`) && !/\son\w+=/.test(html) && !/\sstyle="/.test(html), "ni gestionnaire dans le HTML ni style en ligne");
      assert.equal(res.headers.get("cache-control"), "no-store"); assert.match(res.headers.get("x-robots-tag"), /noindex/); assert.equal(res.headers.get("referrer-policy"), "no-referrer");
    }
    const cfgOf = (html) => JSON.parse(/window\.__AR=(\{.*?\});\(function/s.exec(html)[1].replace(/\\u003c/g, "<"));
    const [a, b] = [cfgOf(phone), cfgOf(dock)];
    assert.deepEqual([b.state, b.press, b.k, b.lang], [a.state, a.press, a.k, a.lang], "mêmes routes, même clé");
    assert.deepEqual([a.dock, b.dock], [false, true]);
    const diff = Object.keys(a.t).filter((k) => a.t[k] !== b.t[k]);
    assert.deepEqual(diff, ["again"], "une seule phrase change : « touchez/appuyez » devient « cliquez »");
    assert.equal(b.t.again, msgs.dockAgain); assert.ok(!/touch|tap/i.test(msgs.dockAgain));
    assert.ok(!phone.includes(`k":"${key}","dock":true`));
  }
});

test("dock : une police de thème piégée n'entre pas dans la feuille de style ; titre piégé échappé", async () => {
  const c = audienceCtx({ messages: { ...fr, remoteTitle: "</title><script>alert(1)</script>" }, theme: { font: "x;}</style><script>alert(2)</script>", accent: "pas-une-couleur" } });
  const { remoteKey: key } = await meta(c);
  for (const extra of ["", "&dock=1"]) {
    const html = await (await getPage(c, key, extra)).text();
    assert.ok(!html.includes("alert(2)") && !html.includes("<script>alert(1)"), extra);
    assert.ok(html.includes("--accent:#e8a23b"), "couleur invalide : valeur par défaut");
  }
});

/* ───────────── Le dock rend les mêmes boutons et passe par le même chemin ───────────── */

test("dock : mêmes boutons, même formulaire « A ou B ? » et mêmes valeurs que la télécommande, pour un module branché (faux Sondages)", async () => {
  const labels = {};
  for (const extra of ["", "&dock=1"]) {
    const p = fakePolls({ running: true });
    const c = audienceCtx({ serviceInstances: p.services }); const s = bind(c);
    await s.join({ room: "polls", token: tok(1), pseudo: "Boute Feu" });
    const { remoteKey: key } = await meta(c);
    const page = runRemotePage(await (await getPage(c, key, extra)).text(), { dispatch: dispatcher(c) });
    await page.advance(10);
    const root = page.root;
    assert.equal(page.live.textContent, fr.remoteConnected);
    const heads = root.all("h2").map((h) => h.textContent);
    assert.deepEqual(heads, ["Sondages", fr.remoteRooms]);
    const btns = root.all("button").map((b) => b.textContent);
    labels[extra] = { heads, btns, fields: root.all("label").map((l) => l.textContent), tones: root.all("button").map((b) => b.className.replace(/ar-(btn|mini) ?/, "")) };
    assert.deepEqual(btns.slice(0, 3), ["Lancer", "Suivant", "Arrêter"]);
    assert.ok(btns.includes("Lancer le sondage") && btns.includes(fr.remoteMute) && btns.includes(fr.remoteClear));
    assert.deepEqual(root.all("label").map((l) => l.textContent), ["Premier choix", "Deuxième choix", "Durée"]);
    const [start, next, stop] = root.all("button");
    assert.deepEqual([start.disabled, next.disabled, stop.disabled], [true, false, false], "« Lancer » est grisé pendant une manche");
    assert.equal(root.all("select")[0].value, "30");
    assert.equal(root.all("[data-until]").length, 1, "le compte à rebours est là");
    assert.ok(/^\d\d:\d\d$/.test(root.all("[data-until]")[0].textContent));
    assert.ok(root.all("summary")[0].textContent.includes("polls") || root.all("summary")[0].textContent.includes("1"), "les salles sont là");

    // « Suivant » : un geste
    next.click(); await page.advance(10);
    assert.deepEqual([p.seen.at(-1).action, p.seen.at(-1).values], ["next", {}]);
    assert.equal(page.toast.textContent, "C'est lancé.");
    // « Arrêter » demande de confirmer, avec les mots du bon appareil
    const stop2 = () => page.root.all("button")[2];
    stop2().click(); await page.advance(10);
    assert.equal(p.seen.filter((x) => x.action === "stop").length, 0, "un premier clic ne suffit pas");
    assert.equal(stop2().textContent, `La manche sera fermée — ${extra ? fr.dockAgain : fr.remoteAgain}`);
    stop2().click(); await page.advance(10);
    assert.equal(p.seen.filter((x) => x.action === "stop").length, 1);
    // « A ou B ? » : valeurs envoyées, erreur SOUS le champ avec son exemple
    const inputs = () => page.root.all("input");
    inputs()[0].value = ""; inputs()[1].value = "Pâtes";
    const form = page.root.all("form")[0];
    form.dispatch("submit"); await page.advance(10);
    const err = page.root.all("[data-err]")[0];
    assert.equal(err.hidden, false); assert.equal(err.textContent, "Écrivez le premier choix. Exemple : Pizza."); assert.equal(err.getAttribute("role"), "alert");
    assert.equal(inputs()[0].getAttribute("aria-invalid"), "true");
    inputs()[0].value = "Pizza";
    page.root.all("form")[0].dispatch("submit"); await page.advance(10);
    assert.deepEqual(p.seen.at(-1), { action: "quick", values: { a: "Pizza", b: "Pâtes", seconds: "30" }, locale: "fr" });
    // sourdine d'une personne, au même chemin
    const mute = page.root.all("button").find((b) => b.textContent === fr.remoteMute);
    mute.click(); await page.advance(10);
    assert.equal((await s.who({ room: "polls", token: tok(1) })).participant.muted, true);
    assert.match(page.toast.textContent, /Boute Feu/);
    // la journalisation est la même, avec « remote » comme auteur et sans l'adresse secrète
    const log = (await c.api.store.list("audit")).map((x) => x.data);
    assert.ok(log.some((l) => l.who === "remote" && l.what === "polls.next") && log.some((l) => l.what === "polls.stop") && log.some((l) => l.what === "mute"));
    assert.ok(!flat(log).includes(key));
  }
  const [phone, dock] = [labels[""], labels["&dock=1"]];
  assert.deepEqual(dock.heads, phone.heads); assert.deepEqual(dock.btns, phone.btns, "les mêmes boutons, dans le même ordre");
  assert.deepEqual(dock.fields, phone.fields); assert.deepEqual(dock.tones, phone.tones);
});

test("dock : « Vider la salle » demande confirmation (cliquez encore) puis passe par le même chemin ; la sélection au clavier ne se perd pas quand la page se met à jour", async () => {
  const c = audienceCtx({ serviceInstances: fakePolls().services }); const s = bind(c);
  await s.join({ room: "polls", token: tok(1), pseudo: "Uno" }); await s.join({ room: "polls", token: tok(2), pseudo: "Duo" });
  const { remoteKey: key } = await meta(c);
  const page = runRemotePage(await (await getPage(c, key, "&dock=1")).text(), { dispatch: dispatcher(c) });
  await page.advance(10);
  const clear = () => page.root.all("button").find((b) => b.textContent.startsWith(fr.remoteClear) || b.textContent.startsWith(fr.remoteClearConfirm));
  // au clavier : le focus est sur « Lancer », une personne arrive, la page se redessine, le focus est retrouvé
  const startBtn = () => page.root.all("button")[0];
  startBtn().focus(); assert.equal(page.doc.activeElement, startBtn());
  await s.join({ room: "polls", token: tok(3), pseudo: "Trio" });
  await page.advance(20_000);
  assert.equal(page.doc.activeElement.getAttribute("data-fk"), "b:id-polls:start", "même bouton, même focus après le redessin");
  assert.equal(page.root.all("button")[0], page.doc.activeElement);
  clear().focus();
  clear().click(); await page.advance(10);
  assert.equal(clear().textContent, `${fr.remoteClearConfirm} — ${fr.dockAgain}`);
  assert.equal((await s.who({ room: "polls", token: tok(1) })).participant.pseudo, "Uno", "rien n'est vidé au premier clic");
  clear().click(); await page.advance(10);
  assert.equal((await s.who({ room: "polls", token: tok(1) })).participant, null);
  assert.match(page.toast.textContent, /3/);
});

test("dock : la régénération de l'adresse invalide le téléphone ET le dock (page, état, appuis) ; le dock affiche « adresse refusée »", async () => {
  const c = audienceCtx({ serviceInstances: fakePolls().services });
  const { remoteKey: k1 } = await meta(c);
  const dockPage = runRemotePage(await (await getPage(c, k1, "&dock=1")).text(), { dispatch: dispatcher(c) });
  const phonePage = runRemotePage(await (await getPage(c, k1)).text(), { dispatch: dispatcher(c) });
  await dockPage.advance(10); await phonePage.advance(10);
  assert.equal(dockPage.live.textContent, fr.remoteConnected);
  assert.ok((await def.adminActions.regenerate(c, { confirm: "on" })).ok);
  const { remoteKey: k2 } = await meta(c); assert.notEqual(k1, k2);
  for (const extra of ["", "&dock=1"]) assert.equal((await getPage(c, k1, extra)).status, 404, `ancienne adresse ${extra}`);
  assert.equal((await route("remote-state", c, req(`${BASE}/remote-state?k=${k1}`))).status, 404);
  assert.equal((await route("remote-press", c, req(`${BASE}/remote-press`, { k: k1, panel: "id-polls", action: "next", values: {} }))).status, 404);
  for (const page of [dockPage, phonePage]) {   // une page restée ouverte sur l'ancienne adresse le dit à son prochain rafraîchissement
    await page.advance(60_000);
    assert.equal(page.live.textContent, fr.remoteDenied);
  }
  for (const extra of ["", "&dock=1"]) assert.equal((await getPage(c, k2, extra)).status, 200, `nouvelle adresse ${extra}`);
});

test("dock : rien ne tourne page fermée ; l'interrogation ralentit quand rien ne change et se met en pause quand la page est cachée", async () => {
  const c = audienceCtx({ serviceInstances: fakePolls().services });
  const { remoteKey: key } = await meta(c);
  let hits = 0;
  const page = runRemotePage(await (await getPage(c, key, "&dock=1")).text(), { dispatch: async (url, init) => { if (url.includes("remote-state")) hits++; return dispatcher(c)(url, init); } });
  await page.advance(10); assert.equal(hits, 1);
  await page.advance(60_000);
  assert.ok(hits <= 9, `l'intervalle grandit de 4 s vers 15 s quand rien ne change (${hits} demandes en une minute)`);
  page.doc.hidden = true; const before = hits;
  await page.advance(60_000);
  assert.ok(hits - before <= 1, "cachée : au plus une vérification, aucune demande");
  assert.ok(!/setInterval/.test(C.REMOTE_JS) && !/setInterval/.test(fs.readFileSync(new URL("../modules/audience/remote.mjs", import.meta.url), "utf8")));
});

/* ───────────── Administration : l'adresse du dock à côté de celle du téléphone ───────────── */

test("administration : l'adresse du dock est montrée à côté de celle du téléphone (même clé), avec « Copier » et les 3 étapes OBS ; sans le droit, jamais d'adresse", async () => {
  for (const [locale, msgs] of [["fr", fr], ["en", en]]) {
    const c = audienceCtx({ locale, messages: msgs }); const { remoteKey: key } = await meta(c);
    const blocks = await def.adminPanel(c, { query: {} });
    const copies = blocks.filter((b) => b.type === "copy");
    assert.deepEqual(copies.map((b) => b.label), [msgs.remoteAddress, msgs.dockAddress]);
    const [phone, dock] = copies.map((b) => b.text);
    assert.equal(phone, `${c.api.siteUrl}/m/${c.instance.key}/remote?k=${key}`);
    assert.equal(dock, `${phone}&dock=1`, "une seule clé secrète : le dock n'a pas de second secret");
    const steps = blocks.find((b) => b.type === "markdown" && b.text === msgs.dockSteps);
    assert.ok(steps, "les étapes sont affichées");
    assert.match(steps.text, /\n1\. .*\n2\. .*\n3\. /s); assert.doesNotMatch(steps.text, /\n4\. /);
    for (const word of locale === "fr" ? ["Docks de navigateur personnalisés", "Appliquer", "nom", "adresse"] : ["Custom Browser Docks", "Apply", "name", "address"]) assert.ok(steps.text.includes(word), word);
    assert.ok(flat(blocks).includes(`(${dock})`), "lien pour l'ouvrir dans un onglet");
    assert.ok(blocks.some((b) => b.type === "heading" && b.text === msgs.dockTitle));
    assert.ok(blocks.some((b) => b.type === "adminForm" && b.action === "regenerate") && msgs.regenConfirm.length > 0);
    const noRight = flat(await def.adminPanel(audienceCtx({ locale, messages: msgs, can: (r) => r === "moderate" }), { query: {} }));
    assert.ok(!noRight.includes("dock=1") && !noRight.includes(msgs.dockAddress), "sans le droit : aucune adresse du dock");
    for (const url of [phone, dock]) assert.ok(!flat((await c.api.store.list("audit")).map((x) => x.data)).includes(key), url && "le journal ne garde pas la clé");
  }
});

/* ───────────── Textes, version, mots ───────────── */

test("dock : textes en français et en anglais à parité exacte, mêmes variables, pas de HTML ; version et contrat inchangés", () => {
  const keys = (o) => Object.keys(o).sort();
  assert.deepEqual(keys(fr), keys(en), "mêmes clés");
  const vars = (s) => (String(s).match(/\{\w+\}/g) ?? []).sort().join();
  for (const k of keys(fr)) assert.equal(vars(fr[k]), vars(en[k]), k);
  const dockKeys = Object.keys(fr).filter((k) => k.startsWith("dock"));
  assert.deepEqual(dockKeys, ["dockTitle", "dockSteps", "dockAddress", "dockOpen", "dockAgain"]);
  for (const k of dockKeys) { assert.ok(fr[k] && en[k], k); assert.ok(!/<[a-z!/]/i.test(fr[k] + en[k]), `${k} : du texte, pas du HTML`); }
  assert.equal(fr.dockSteps.split("\n").filter((l) => /^\d\. /.test(l)).length, 3); assert.equal(en.dockSteps.split("\n").filter((l) => /^\d\. /.test(l)).length, 3);
  assert.equal(manifest.version, "1.1.0"); assert.equal(manifest.minCore, "0.2.5"); assert.equal(manifest.apiVersion, 2);
  assert.deepEqual(manifest.rights.map((x) => x.id).sort(), ["moderate", "remote.use"], "aucun nouveau droit : le dock est derrière le même secret");
  assert.equal(manifest.dataVersion, undefined, "aucune donnée nouvelle, aucune migration");
});

test("dock : la feuille de style du dock respecte les tailles demandées (boutons de 40 px au moins, 14 px, une colonne)", () => {
  const css = fs.readFileSync(new URL("../modules/audience/remote.mjs", import.meta.url), "utf8");
  const dockCss = /const DOCK_CSS = `([\s\S]*?)`;/.exec(css)[1];
  const heights = [...dockCss.matchAll(/min-height:(\d+)px/g)].map((m) => Number(m[1]));
  assert.ok(heights.length >= 5 && heights.every((h) => h >= 40), `toutes les cibles de clic font 40 px ou plus : ${heights}`);
  assert.match(dockCss, /\.ar-dock\{font-size:14px/); assert.match(dockCss, /\.ar-dock \.ar-row\{grid-template-columns:1fr/);
  assert.doesNotMatch(dockCss, /min-width:\s*[3-9]\d\dpx/, "rien ne force une largeur de plus de 300 px");
  assert.doesNotThrow(() => new vm.Script(C.REMOTE_JS));
});
