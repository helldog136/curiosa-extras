// Participation 1.1.0 — le DOCK OBS de la télécommande : la même page, la même adresse secrète, une présentation étroite.
import test from "node:test";
import assert from "node:assert/strict";
import { audienceCtx, def, fr, en, K, C, req } from "./helpers/audienceHarness.mjs";

const BASE = "https://x.test/m/audience";
const route = (name, ctx, request) => def.routes[name](request, ctx);
const meta = async (c) => { await K.ensureMeta(c); return (await c.api.store.list("meta")).find((r) => r.data.k === "cfg").data; };
const flat = (x) => JSON.stringify(x);

const pageUrl = (key, extra = "") => `${BASE}/remote?k=${key}${extra}`;
const getPage = async (c, key, extra) => route("remote", c, req(pageUrl(key, extra)));

/* ───────────── La page : même adresse, présentation choisie par &dock=1 ───────────── */


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
    assert.deepEqual(diff, [], "la page du téléphone et celle du dock disent les mêmes mots (la confirmation est « Confirmer / Annuler », sans « touchez » ni « cliquez »)");
    assert.ok(!phone.includes(`k":"${key}","dock":true`));
  }
});


/* ───────────── Le dock rend les mêmes boutons et passe par le même chemin ───────────── */





/* ───────────── Administration : l'adresse du dock à côté de celle du téléphone ───────────── */

test("administration : l'adresse du dock est montrée à côté de celle du téléphone (même clé), avec « Copier » et les 3 étapes OBS ; sans le droit, jamais d'adresse", async () => {
  for (const [locale, msgs] of [["fr", fr], ["en", en]]) {
    const c = audienceCtx({ locale, messages: msgs }); const { remoteKey: key } = await meta(c);
    const blocks = await def.adminPanel(c, { query: {} });
    const copies = blocks.filter((b) => b.type === "copy");
    assert.deepEqual(copies.map((b) => b.label), [msgs.remoteAddress, msgs.dockAddress, msgs.drawScreenAddress]);
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


