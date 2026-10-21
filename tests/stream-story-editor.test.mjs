// L'éditeur de « Story d'annonce » 2.0.0 (app.mjs), exécuté pour de vrai dans un faux navigateur minimal (un arbre d'éléments, des événements, un faux canvas) et branché sur les vraies
// routes du module (fetch → routes → double de « contact.book »). Il vérifie le parcours de la personne : chercher dans Contacts, ajouter, catégorie, saisie ponctuelle, modèle, repli sans Contacts.
// Aucun réseau, aucun vrai navigateur : le rendu réel (polices, vidéo) reste à voir dans un navigateur.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { fakeContactBook } from "./helpers/fakeContactBook.mjs";
import { fakeCanvasContext } from "./helpers/fakeCanvas.mjs";

const DIR = new URL("../modules/stream-story", import.meta.url).pathname;
const manifest = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8")), fr = JSON.parse(fs.readFileSync(`${DIR}/locales/fr.json`, "utf8"));
const def = (await import("../modules/stream-story/index.mjs")).default;
const data = await import("../modules/stream-story/data.mjs");
const images = await import("../modules/stream-story/images.mjs");

const SITE = "https://site.example.test";
const TW = "https://static-cdn.jtvnw.net/jtv_user_pictures/abc-profile_image-300x300.png";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ───────────── Un faux navigateur, juste assez ───────────── */
class Text { constructor(t) { this.nodeType = 3; this.textContent = String(t); } }
class El {
  constructor(tag) { this.nodeType = 1; this.tagName = tag; this.children = []; this.attrs = {}; this.listeners = {}; this._text = ""; this.hidden = false; this.value = ""; this.checked = false; this.disabled = false; this.className = ""; this.dataset = {}; this.style = {}; this.open = false; this.ctx = null; }
  get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join("") : this._text; }
  set textContent(v) { this.children = []; this._text = String(v); }
  append(...kids) { for (const k of kids) this.children.push(k); }
  replaceChildren(...kids) { this.children = []; this._text = ""; this.append(...kids); }
  setAttribute(k, v) { this.attrs[k] = v; if (k === "id") this.id = v; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  fire(type, ev = {}) { for (const fn of this.listeners[type] ?? []) fn({ key: "", preventDefault() {}, target: this, ...ev }); }
  click() { if (!this.isDisabled) this.fire("click"); }
  get isDisabled() { return this.disabled || "disabled" in this.attrs; }
  focus() {}
  getContext() { return (this.ctx ??= fakeCanvasContext()); }
  querySelectorAll() { return []; }
}
const walk = (el, out = []) => { out.push(el); for (const c of el.children ?? []) if (c.nodeType === 1) walk(c, out); return out; };
const buttons = (root) => walk(root).filter((e) => e.tagName === "button");

function installDom(html, token) {
  const els = new Map();
  for (const m of html.matchAll(/<(\w+)([^>]*?)>/g)) {
    const id = /\sid="([^"]+)"/.exec(m[2])?.[1];
    if (!id || els.has(id)) continue;
    const el = new El(m[1]); el.id = id; el.hidden = /(^|\s)hidden(\s|=|$)/.test(m[2]);
    els.set(id, el);
  }
  els.get("story-config").textContent = /<script type="application\/json" id="story-config">(.*?)<\/script>/s.exec(html)[1];
  const body = new El("body"); body.classList = { toggle() {} };
  const document = { getElementById: (id) => els.get(id) ?? null, createElement: (t) => new El(t), createTextNode: (t) => new Text(t), querySelectorAll: () => [], body };
  Object.assign(globalThis, {
    document, Image: class { set src(v) { this._src = v; setTimeout(() => this.onload?.(), 0); } get src() { return this._src; } width = 100; height = 100; naturalWidth = 100; naturalHeight = 100; },
    location: { hash: `#t=${token}`, pathname: "/m/story/studio", search: "" }, history: { replaceState() {} }, matchMedia: () => ({ matches: true }) /* mouvement réduit : la vidéo est dessinée au repos */, requestAnimationFrame: () => 0,
  });
  return els;
}

/** Un serveur : les routes du module derrière un faux fetch (les images d'ailleurs rendent un PNG). */
function installServer(ctx, token) {
  const log = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input), SITE);
    if (url.origin !== SITE) return new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
    const route = url.pathname.replace(/^\/m\/story\//, "");
    log.push([init.method ?? "GET", route + url.search]);
    return def.routes[route](new Request(url, { method: init.method ?? "GET", headers: init.headers, body: init.body }), ctx);
  };
  return { log, restore: () => { globalThis.fetch = realFetch; } };
}

async function boot(ctx, tag) {
  const token = await data.mintToken(ctx);
  const html = await (await def.routes.studio(new Request(`${SITE}/m/story/studio`), ctx)).text();
  const server = installServer(ctx, token), els = installDom(html, token);
  await import(`../modules/stream-story/app.mjs?${tag}`);
  await wait(600);
  return { els, server, token };
}
const mk = (cb, extra = {}) => fakeCtx({
  key: "story", moduleId: "stream-story", locale: "fr", messages: { ...fr }, permissions: manifest.permissions, siteUrl: SITE, topics: { "planning.slot": () => [] },
  instances: [{ id: "id-story", key: "story", module: "stream-story", basePath: "", name: "Story", adminPath: "/admin/instances/id-story" }], ...(cb ? { services: cb.services } : {}), ...extra,
});
const type = async (el, value, ms = 500) => { el.value = value; el.fire("input"); await wait(ms); };
const rows = (el) => el.children.filter((c) => c.tagName === "li");
const btn = (root, label) => buttons(root).find((b) => b.textContent === label);
const drawn = (els) => els.get("preview").getContext().log.filter((l) => l[0] === "fillText").map((l) => l[1]);

test("éditeur avec Contacts : chercher, ajouter (6 au plus), catégorie, saisie ponctuelle, modèle de références ; la vidéo montre le nom de Contacts et sa photo passe par le relais", async () => {
  const cb = fakeContactBook();
  const cat = cb.seedCategory("Cible de raid");
  const alice = cb.seedContact({ name: "Alice Martin", accounts: [{ network: "twitch", handle: "alice_tv", displayName: "Alice TV", followers: 4, avatar: TW }] });
  const team = Array.from({ length: 8 }, (_, i) => cb.seedContact({ name: `Équipier ${i}`, accounts: [{ network: "twitch", handle: `equipier_${i}`, avatar: TW }], categoryIds: [cat] }).id);
  const ctx = mk(cb);
  const { els, server } = await boot(ctx, "contacts");
  assert.equal(els.get("book-box").hidden, false); assert.equal(els.get("book-absent").hidden, true, "Contacts répond : pas de message de repli");
  assert.match(els.get("chosen").textContent, /Personne pour le moment/);
  assert.equal(els.get("migrated").hidden, true);

  // 1. la recherche à la saisie (agnostique du réseau), pastilles de comptes
  await type(els.get("q"), "ali");
  const res = rows(els.get("results"));
  assert.equal(res.length, 1); assert.match(res[0].textContent, /Alice Martin/); assert.match(res[0].textContent, /Twitch · Alice TV/);
  assert.ok(server.log.some(([, r]) => r.startsWith("people?q=ali")));
  assert.ok(!server.log.some(([, r]) => r.includes("network=")), "aucun réseau imposé");
  await type(els.get("q"), "a", 0); assert.equal(rows(els.get("results")).length, 0, "moins de 2 lettres : liste vidée");
  assert.equal(els.get("q-note").textContent, fr.ui_search_hint);
  await type(els.get("q"), "alice");
  btn(rows(els.get("results"))[0], "Ajouter").click();
  assert.match(els.get("chosen").textContent, /Alice Martin/);
  assert.equal(btn(rows(els.get("results"))[0], "Déjà dans la vidéo").isDisabled, true);
  await wait(400);
  assert.ok(drawn(els).some((t) => /Alice Martin/.test(t)), "la vidéo montre le nom donné par Contacts");
  assert.ok(server.log.some(([, r]) => r.startsWith("img?u=" + encodeURIComponent(TW))), "la photo vient de Contacts, par le relais du site");

  // 2. une catégorie de Contacts : sélecteur, comptes par pages, « ajouter les premiers » (6 au plus au total)
  els.get("cat-box").open = true; els.get("cat-box").fire("toggle"); await wait(300);
  const options = els.get("cat").children.map((o) => o.textContent);
  assert.deepEqual(options, [fr.ui_cat_choose, "Cible de raid"]);
  els.get("cat").value = cat; els.get("cat").fire("change"); await wait(400);
  assert.equal(rows(els.get("cat-results")).length, 8);
  assert.equal(els.get("cat-add-first").hidden, false); assert.match(els.get("cat-add-first").textContent, /jusqu'à 5/);
  els.get("cat-add-first").click(); await wait(400);
  assert.equal(rows(els.get("chosen")).length, 6, "6 co-streamers au plus dans la vidéo");
  assert.match(els.get("members-note").textContent, /maximum \(6 co-streamers\)/);
  assert.ok(buttons(els.get("cat-results")).filter((b) => b.textContent === "Ajouter").every((b) => b.isDisabled), "plus rien à ajouter quand c'est plein");
  assert.equal(els.get("cat-add-first").hidden, true);
  assert.equal(els.get("status").hidden, false);

  // 3. retirer, puis une saisie ponctuelle (jamais enregistrée dans Contacts)
  btn(rows(els.get("chosen")).at(-1), "Retirer").click(); assert.equal(rows(els.get("chosen")).length, 5);
  els.get("a-login").value = "invite_x"; els.get("a-name").value = "Invité"; els.get("adhoc-add").click(); await wait(300);
  const chosen = rows(els.get("chosen"));
  assert.equal(chosen.length, 6); assert.match(chosen.at(-1).textContent, /Invité/); assert.match(chosen.at(-1).textContent, /cette vidéo seulement/);
  els.get("a-image").value = "https://evil.example/p.png"; els.get("a-login").value = "autre"; els.get("adhoc-add").click(); await wait(300);
  assert.equal(els.get("a-error").textContent, fr.err_image ?? fr.ui_err_image, "une photo non relayable est refusée avec une phrase claire");
  assert.equal(cb.dump().contacts.length, 9, "aucune fiche créée par la saisie ponctuelle");

  // 4. enregistrer un modèle : seulement des identifiants de fiche (et la saisie ponctuelle)
  els.get("model-name").value = "Soirée raid"; els.get("model-save").click(); await wait(300);
  const saved = (await data.readModels(ctx))[0];
  assert.equal(saved.name, "Soirée raid");
  assert.deepEqual(saved.config.costreamers.map((m) => m.id ?? m.login), [alice.id, ...team.slice(0, 4), "invite_x"]);
  const dump = JSON.stringify(await ctx.api.store.list("story_models"));
  for (const copy of ["Alice Martin", "alice_tv", "Équipier", "jtv_user_pictures"]) assert.ok(!dump.includes(copy), `« ${copy} » : pas de copie dans le modèle`);

  // 5. une autre session de l'éditeur : le modèle est chargé, les fiches sont relues dans Contacts (nom, photo) ; une fiche effacée entre-temps est signalée, la vidéo continue
  server.restore();
  cb.admin.deleteContact(team[0]);
  const again = await boot(ctx, "contacts-2"), e2 = again.els;
  assert.match(e2.get("chosen").textContent, /Personne pour le moment/);
  btn(rows(e2.get("model-list"))[0], "Charger").click(); await wait(600);
  const back = rows(e2.get("chosen"));
  assert.equal(back.length, 6);
  assert.match(back[0].textContent, /Alice Martin/); assert.match(back[1].textContent, /n'existe plus dans Contacts/); assert.match(back[2].textContent, /Équipier 1/); assert.match(back[5].textContent, /Invité/);
  assert.ok(again.server.log.some(([, r]) => r.startsWith("members?id=")), "les fiches sont relues dans Contacts");
  assert.equal(again.server.log.filter(([, r]) => r.startsWith("members?id=")).length, 1, "une seule demande groupée");
  await wait(300);
  const labels = drawn(e2);
  assert.ok(labels.some((t) => /^Alice/.test(t)), "le nom vient de Contacts");
  assert.equal(labels.filter((t) => /^Équipier/.test(t)).length, 3, "trois équipiers sur quatre : la fiche effacée n'apparaît pas dans la vidéo");
  again.server.restore();
});

test("éditeur sans Contacts : le repli est dit, la saisie ponctuelle marche, et la liste d'avant est proposée comme ponctuels", async () => {
  images.resetImages();
  const ctx = mk(null);
  await ctx.api.store.add("story_costreamers", { items: [{ login: "alice_tv", name: "Alice", image: "" }] });
  const { els, server } = await boot(ctx, "absent");
  assert.equal(els.get("book-box").hidden, true); assert.equal(els.get("book-absent").hidden, false);
  assert.equal(els.get("saved-box").hidden, false);
  const saved = rows(els.get("saved-list"));
  assert.equal(saved.length, 1); assert.match(saved[0].textContent, /Alice/); assert.match(saved[0].textContent, /liste d'avant/);
  assert.equal(buttons(saved[0]).map((b) => b.textContent).join("|"), "Ajouter", "pas de bouton pour retirer un élément de la liste d'avant : la migration s'en charge");
  btn(saved[0], "Ajouter").click(); await wait(200);
  assert.match(els.get("chosen").textContent, /Alice/);
  els.get("a-name").value = "Zoé"; els.get("adhoc-add").click(); await wait(300);
  assert.equal(rows(els.get("chosen")).length, 2);
  assert.ok(!server.log.some(([, r]) => /^(people|category|categories|members)/.test(r)), "Contacts absent : aucune recherche n'est tentée");
  await ctx.api.store.list("story_costreamers").then((r) => assert.equal(r.length, 1, "la liste d'avant n'a pas bougé"));
  server.restore();
});
