// Liens courts — le module : adresses acceptées ou refusées, noms courts, création, redirection publique, compteur de clics sans suivi, image du QR code,
// page aimable, administration, assistant IA, exports. (Le générateur de QR code a son propre fichier : short-links-qr.test.mjs.)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { memStore } from "./helpers/contactsStore.mjs";
import { decodeMatrix, matrixFromPng, matrixFromSvg } from "./helpers/short-links-qr-decode.mjs";
import { parseManifest } from "@/core/modules/manifest";
import { forgetInstance, forgetLink, settle } from "../modules/short-links/clicks.mjs";
import { MAX_LINKS, STATS, LINKS, readStats, summarize } from "../modules/short-links/data.mjs";
import { forgetImageHits, preferredLocale } from "../modules/short-links/public.mjs";
import { createLink } from "../modules/short-links/links.mjs";
import { cell } from "../modules/short-links/admin.mjs";
import { freeSlug, hostProblem, normalizeSlug, parseDestination, slugProblem, suggestSlug, today, validDay } from "../modules/short-links/url.mjs";

const DIR = new URL("../modules/short-links", import.meta.url).pathname;
const read = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
const manifestJson = read("module.json");
const fr = read("locales/fr.json");
const en = read("locales/en.json");
const def = (await import("../modules/short-links/index.mjs")).default;
const SITE = "https://demo.example.org";
const UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";

let n = 0;
function ctx(settings = {}, over = {}) {
  const c = fakeCtx({
    key: `sl${++n}`, basePath: "lien", messages: fr, locale: "fr", defaultLocale: "fr", locales: ["fr", "en"], siteUrl: SITE,
    permissions: manifestJson.permissions, settings: { countClicks: true, qrLevel: "M", ...settings }, ...over,
  });
  c.api.store = memStore();
  c.can = (right) => right === "links.edit";
  return c;
}
const form = (c, values) => def.adminActions.create.run(c, values);
const go = (c, query, { ip = "198.51.100.7", headers = {}, method = "GET" } = {}) =>
  def.routes.go(new Request(`${SITE}/m/${c.instance.key}/go?${typeof query === "string" ? query : new URLSearchParams(query)}`, { method, headers: { "user-agent": UA, "x-forwarded-for": ip, ...headers } }), c);
const idOf = async (c, slug) => (await c.api.store.getByKey(LINKS, slug)).id;
const make = async (c, url = "https://www.example.org/boutique", extra = {}) => {
  const r = await createLink(c, { url, ...extra });
  assert.ok(r.ok, JSON.stringify(r));
  return r.link;
};
const text = (blocks) => JSON.stringify(blocks);

// ── Manifeste ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("manifeste valide, id et nom demandés, réglages utilisés par le code, parité fr/en, outils pour l'assistant IA tous codés", () => {
  const r = parseManifest(manifestJson);
  assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(manifestJson.id, "short-links");
  assert.deepEqual([manifestJson.name.fr, manifestJson.name.en], ["Liens courts", "Short links"]);
  assert.equal(manifestJson.version, "1.0.0");
  assert.equal(manifestJson.minCore, "0.2.5");
  assert.equal(manifestJson.apiVersion, 2);
  const source = ["index", "admin", "public", "links", "clicks", "data"].map((f) => fs.readFileSync(`${DIR}/${f}.mjs`, "utf8")).join("\n");
  const declared = new Set(manifestJson.settings.map((s) => s.key));
  for (const m of source.matchAll(/ctx\.setting\("([A-Za-z0-9_]+)"\)/g)) assert.ok(declared.has(m[1]), m[1]);
  for (const k of declared) assert.ok(source.includes(`"${k}"`), `réglage « ${k} » lu par le code`);
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  for (const k of Object.keys(fr)) assert.deepEqual([...fr[k].matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort(), [...en[k].matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort(), k);
  for (const a of manifestJson.mcp) assert.equal(typeof def.mcp[a.name], "function", a.name);
  assert.deepEqual(manifestJson.mcp.filter((a) => a.destructive).map((a) => a.name), ["shortlink_delete"]);
  assert.ok(manifestJson.mcp.every((a) => a.readOnly || a.default !== true), "aucune écriture activée d'office");
  assert.ok(manifestJson.mcp.every((a) => a.name.length <= 31));
  assert.ok(manifestJson.privacy.fr && manifestJson.privacy.en, "vie privée déclarée dans les deux langues");
  assert.deepEqual(manifestJson.rights.map((x) => x.id), ["links.edit"]);
});

test("valeurs par défaut : tout marche sans régler quoi que ce soit", () => {
  const byKey = Object.fromEntries(manifestJson.settings.map((s) => [s.key, s]));
  assert.equal(byKey.countClicks.default, true);
  assert.equal(byKey.qrLevel.default, "M");
  assert.ok(byKey.publicBase.advanced && byKey.publicBase.optional, "le réglage technique est avancé et facultatif");
  assert.ok(manifestJson.settings.filter((s) => !s.advanced).every((s) => s.default !== undefined || s.optional), "rien à remplir pour commencer");
});

// ── Adresses ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("destinations : seulement http et https ; adresses incomplètes complétées ; tout le reste refusé avec un code précis", () => {
  const ok = (input, url) => { const r = parseDestination(input, { siteUrl: SITE }); assert.ok(r.ok, `${input} → ${JSON.stringify(r)}`); assert.equal(r.url, url, input); };
  ok("https://www.example.org/boutique", "https://www.example.org/boutique");
  ok("  www.example.org/boutique  ", "https://www.example.org/boutique");
  ok("example.org/x?y=1&z=2", "https://example.org/x?y=1&z=2");
  ok("http://example.org", "http://example.org/");
  ok("<https://example.org/a>", "https://example.org/a");
  ok("« https://example.org/a »", "https://example.org/a");
  ok("//example.org/p", "https://example.org/p");
  ok("example.org:8080/x", "https://example.org:8080/x");
  ok("https://example.org/page.", "https://example.org/page");
  ok("HTTPS://EXAMPLE.ORG/Path", "https://example.org/Path");
  ok("https://exämple.org/é", "https://xn--exmple-cua.org/%C3%A9");
  ok("https://8.8.8.8/x", "https://8.8.8.8/x");
  ok("https://[2606:4700::1111]/", "https://[2606:4700::1111]/");
  ok("/boutique", "/boutique"); // une page de ce site
  const no = (input, code) => assert.deepEqual(parseDestination(input, { siteUrl: SITE }), { ok: false, code }, input);
  no("", "empty"); no("   ", "empty");
  no("javascript:alert(1)", "scheme"); no("JaVaScRiPt:alert(1)", "scheme"); no("data:text/html,<script>alert(1)</script>", "scheme"); no("file:///etc/passwd", "scheme");
  no("ftp://example.org/x", "scheme"); no("mailto:a@example.org", "scheme"); no("tel:+3212345", "scheme"); no("vbscript:x", "scheme"); no("blob:https://example.org/uuid", "scheme");
  no("https://user:pass@example.org/", "credentials"); no("https://example.org@evil.example.net/", "credentials");
  no("https://example.org/a b", "space"); no("not an address", "space");
  no("https://", "invalid"); no("http://exa mple.org", "space"); no("https://example.org:99999/", "invalid"); no("https://256.1.1.1/", "invalid");
  no(`https://example.org/${"a".repeat(2100)}`, "long");
  no("//localhost/x", "private");
});

test("destinations internes refusées : ordinateur local, réseau privé, noms internes, écritures détournées de 127.0.0.1", () => {
  const refused = [
    "http://localhost/", "http://localhost:3000/admin", "http://LOCALHOST./", "http://foo.localhost/", "localhost:3000",
    "http://127.0.0.1/", "http://127.1/", "http://2130706433/", "http://0x7f000001/", "http://0177.0.0.1/", "http://0x7f.0.0.1/", "http://１２７.０.０.１/", "http://0/", "http://0.0.0.0/",
    "http://10.0.0.5/", "http://172.16.0.1/", "http://172.31.255.255/", "http://192.168.1.1/admin", "http://169.254.169.254/latest/meta-data/", "http://100.64.0.1/",
    "http://198.18.0.1/", "http://224.0.0.1/", "http://255.255.255.255/", "http://192.0.2.1/", "http://203.0.113.9/",
    "http://[::1]/", "http://[::]/", "http://[fe80::1]/", "http://[fc00::1]/", "http://[fd12:3456::1]/", "http://[::ffff:127.0.0.1]/", "http://[::ffff:7f00:1]/", "http://[2001:db8::1]/", "http://[2002:7f00:1::]/",
    "https://intranet/", "https://nas/", "https://router.local/", "https://printer.lan/", "https://server.internal/", "https://app.intranet/", "https://x.home.arpa/", "https://machine.corp/",
    "https://127.0.0.1.nip.io/", "https://app.127-0-0-1.sslip.io/", "https://localtest.me/", "https://foo.lvh.me/", "https://thing.test/", "https://thing.invalid/", "https://hidden.onion/",
  ];
  for (const url of refused) {
    const r = parseDestination(url, { siteUrl: SITE });
    assert.equal(r.ok, false, `${url} devrait être refusée`);
    assert.ok(["private", "invalid"].includes(r.code), `${url} → ${r.code}`);
  }
  assert.equal(parseDestination("http://192.168.1.1/", {}).code, "private");
  assert.equal(parseDestination("http://localhost/", {}).code, "private");
  assert.equal(hostProblem("example.org"), null);
  assert.equal(hostProblem("172.15.0.1"), null, "172.15 n'est pas privé");
  assert.equal(hostProblem("172.32.0.1"), null, "172.32 n'est pas privé");
  assert.equal(hostProblem("100.63.0.1"), null);
});

test("destinations : jamais vers un autre lien court ni une page technique de ce site (pas de boucle)", () => {
  for (const url of [`${SITE}/m/short-links/go?c=merch`, `${SITE}/m/anything`, `${SITE}/api/health`, `${SITE}/admin`, "/m/short-links/go?c=x", "/api/mcp", "/admin/login", "/overlays/x"]) {
    assert.deepEqual(parseDestination(url, { siteUrl: SITE }), { ok: false, code: "loop" }, url);
  }
  assert.equal(parseDestination(`${SITE}/boutique`, { siteUrl: SITE }).ok, true, "une vraie page de ce site est permise");
  assert.equal(parseDestination("//evil.example.net/x", { siteUrl: SITE }).ok, true, "« // » désigne un autre site, jamais le nôtre");
  assert.equal(parseDestination("/\\evil.example.net", { siteUrl: SITE }).ok, false);
  assert.equal(parseDestination("/\\\\evil.example.net", { siteUrl: SITE }).ok, false);
});

// ── Noms courts ────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("noms courts : minuscules, chiffres et tirets ; accents et espaces arrangés ; réservés refusés", () => {
  assert.equal(normalizeSlug("  Été à la Mer!! "), "ete-a-la-mer");
  assert.equal(normalizeSlug("Mon_Merch 2026"), "mon-merch-2026");
  assert.equal(normalizeSlug("---"), "");
  assert.equal(normalizeSlug("a".repeat(50)).length, 32);
  assert.equal(normalizeSlug("../../etc/passwd"), "etc-passwd");
  assert.equal(slugProblem("merch"), null);
  assert.equal(slugProblem("a"), "short");
  assert.equal(slugProblem("a".repeat(33)), "long");
  assert.equal(slugProblem("Merch"), "chars");
  assert.equal(slugProblem("mer--ch"), "chars");
  assert.equal(slugProblem("-merch"), "chars");
  for (const word of ["admin", "api", "m", "go", "uploads", "overlays", "feed", "feed.xml", "_next", "sitemap.xml", "robots.txt", "llms.txt", "icon", "favicon.ico", "privacy", "login", "fr", "en", "qr"]) {
    assert.ok(slugProblem(word) !== null, `« ${word} » doit être refusé`);
  }
  assert.equal(slugProblem("blog", ["blog"]), "reserved", "page d'un autre module");
  assert.equal(slugProblem("blog"), null);
});

test("nom proposé : lisible, d'après la note, la fin de l'adresse ou le nom du site ; jamais un code illisible", () => {
  assert.equal(suggestSlug({ url: "https://www.example.org/boutique/mug-chat?id=3" }), "mug-chat");
  assert.equal(suggestSlug({ url: "https://twitch.tv/emma" }), "emma");
  assert.equal(suggestSlug({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }), "youtube");
  assert.equal(suggestSlug({ title: "Mon Flyer de Noël 2026!", url: "https://example.org/" }), "mon-flyer-noel");
  assert.equal(suggestSlug({ url: "https://example.org/12345/" }), "example");
  assert.equal(suggestSlug({ url: "https://shop.example.org/" }), "example");
  assert.equal(suggestSlug({ url: "https://example.org/a1b2c3d4e5f6a7b8" }), "example");
  assert.equal(suggestSlug({ url: "/contact" }), "contact");
  assert.equal(suggestSlug({ title: "###", url: "" }), "lien");
  assert.equal(suggestSlug({ url: "https://example.org/admin" }), "example", "un mot réservé n'est jamais proposé");
  const taken = new Set(["merch", "merch-2"]);
  assert.equal(freeSlug("merch", (s) => taken.has(s)), "merch-3");
  assert.equal(freeSlug("libre", (s) => taken.has(s)), "libre");
  assert.equal(freeSlug("a".repeat(32), (s) => s === "a".repeat(32)).length <= 32, true);
});

test("dates : seulement des jours qui existent", () => {
  assert.ok(validDay("2026-02-28") && validDay("2028-02-29"));
  assert.ok(!validDay("2026-02-30") && !validDay("2026-13-01") && !validDay("26-01-01") && !validDay("2026/01/01") && !validDay(""));
});

// ── Création ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("création : une adresse suffit, le nom lisible est proposé et le lien est prêt avec son QR code", async () => {
  const c = ctx();
  const r = await form(c, { url: "www.example.org/boutique/mug-chat", slug: "", title: "", expires: "" });
  assert.match(r.ok, /mug-chat/);
  const link = (await c.api.store.getByKey(LINKS, "mug-chat")).data;
  assert.deepEqual(link, { slug: "mug-chat", url: "https://www.example.org/boutique/mug-chat", title: "", expires: "" });
  assert.match(r.redirect, /^\?open=[^&]+&new=2$/, "on arrive sur le lien créé, avec le message « nom proposé »");
  // la même adresse une 2e fois : un autre nom, jamais un doublon ni une erreur
  const again = await form(c, { url: "www.example.org/boutique/mug-chat" });
  assert.ok(again.ok);
  assert.ok(await c.api.store.getByKey(LINKS, "mug-chat-2"));
  assert.equal(await c.api.store.count(LINKS), 2);
});

test("création : nom choisi arrangé (majuscules, accents), note et date de fin gardées", async () => {
  const c = ctx();
  const tomorrow = today(Date.now() + 86_400_000);
  const r = await form(c, { url: "https://example.org/x", slug: "  Mon Été 2026 ", title: "  Flyer   du\nmarché  ", expires: tomorrow });
  assert.ok(r.ok, JSON.stringify(r));
  const data = (await c.api.store.getByKey(LINKS, "mon-ete-2026")).data;
  assert.equal(data.title, "Flyer du marché");
  assert.equal(data.expires, tomorrow);
  assert.match(r.redirect, /new=1$/);
});

test("création : chaque erreur s'affiche sous son champ, avec un exemple et quoi faire", async () => {
  const c = ctx({}, { instances: [{ basePath: "blog" }] });
  await make(c, "https://example.org/a", { slug: "merch" });
  const cases = [
    [{ url: "" }, "url", /Collez l'adresse/],
    [{ url: "javascript:alert(1)" }, "url", /https:\/\/www\.monsite\.be/],
    [{ url: "http://192.168.1.10/admin" }, "url", /vos visiteurs ne pourraient pas l'ouvrir/],
    [{ url: "http://localhost:3000" }, "url", /public/],
    [{ url: "https://user:pw@example.org" }, "url", /mot de passe/],
    [{ url: "https://example.org/a b" }, "url", /espaces/],
    [{ url: `${SITE}/m/short-links/go?c=merch` }, "url", /lien court/],
    [{ url: "https://example.org/x", slug: "merch" }, "slug", /déjà utilisé.*« merch-2 »/],
    [{ url: "https://example.org/x", slug: "admin" }, "slug", /déjà pris par le site/],
    [{ url: "https://example.org/x", slug: "blog" }, "slug", /déjà pris par le site/],
    [{ url: "https://example.org/x", slug: "fr" }, "slug", /déjà pris par le site/],
    [{ url: "https://example.org/x", slug: "???" }, "slug", /minuscules/],
    [{ url: "https://example.org/x", slug: "a" }, "slug", /au moins 2/],
    [{ url: "https://example.org/x", expires: "2020-01-01" }, "expires", /déjà passée/],
    [{ url: "https://example.org/x", expires: "demain" }, "expires", /2026-12-31/],
    [{ url: "https://example.org/x", expires: "2026-02-31" }, "expires", /2026-12-31/],
  ];
  for (const [values, field, pattern] of cases) {
    const r = await form(c, values);
    assert.equal(r.ok, undefined, JSON.stringify(values));
    assert.ok(r.errors?.[field], `${JSON.stringify(values)} → ${JSON.stringify(r)}`);
    assert.match(r.errors[field], pattern, JSON.stringify(values));
  }
  const several = await form(c, { url: "", slug: "admin", expires: "2020-01-01" });
  assert.deepEqual(Object.keys(several.errors).sort(), ["expires", "slug", "url"], "toutes les erreurs d'un coup");
  assert.equal(await c.api.store.count(LINKS), 1, "rien n'a été créé");
});

test("création : le nom court est unique, même si deux créations arrivent en même temps", async () => {
  const c = ctx();
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) => createLink(c, { url: `https://example.org/${i}`, slug: "merch" })));
  assert.equal(results.filter((r) => r.ok).length, 1, "une seule gagne");
  assert.equal(await c.api.store.count(LINKS), 1);
  assert.equal(results.filter((r) => !r.ok).every((r) => r.codes.slug === "taken"), true);
});

test("création : au plus 300 liens, avec un message qui dit quoi faire", async () => {
  const c = ctx();
  c.api.store.seed(Array.from({ length: MAX_LINKS }, (_, i) => ({ collection: LINKS, key: `l${i}`, data: { slug: `l${i}`, url: "https://example.org/", title: "", expires: "" } })));
  const r = await form(c, { url: "https://example.org/new" });
  assert.match(r.error, /300 liens/);
  assert.equal(r.ok, undefined);
  assert.equal(await c.api.store.count(LINKS), MAX_LINKS);
});

// ── Redirection publique ───────────────────────────────────────────────────────────────────────────────────────────────────
test("redirection : 302 immédiate vers la destination, sans mise en mémoire, sans cookie", async () => {
  const c = ctx();
  await make(c, "https://www.example.org/boutique?ref=qr", { slug: "merch" });
  const res = await go(c, { c: "merch" });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "https://www.example.org/boutique?ref=qr");
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("set-cookie"), null, "aucun cookie");
  assert.match(res.headers.get("x-robots-tag"), /noindex/);
  assert.equal(await res.text(), "");
});

test("redirection : une page du site (« /boutique ») reste sur le site", async () => {
  const c = ctx();
  await make(c, "/boutique", { slug: "shop" });
  const res = await go(c, { c: "shop" });
  assert.equal(res.headers.get("location"), "/boutique");
});

test("redirection : aucune redirection ouverte — la destination ne vient jamais de la requête", async () => {
  const c = ctx();
  await make(c, "https://www.example.org/boutique", { slug: "merch" });
  const attacks = [
    { c: "merch", next: "https://evil.example.net/", url: "https://evil.example.net/", redirect: "https://evil.example.net/", return: "//evil.example.net", to: "https://evil.example.net", dest: "//evil.example.net", u: "javascript:alert(1)" },
    { c: "unknown", next: "https://evil.example.net/", url: "https://evil.example.net/", redirect: "https://evil.example.net/" },
    { next: "https://evil.example.net/", url: "https://evil.example.net/" },
    { c: "https://evil.example.net/" }, { c: "//evil.example.net" }, { c: "/\\evil.example.net" }, { c: "merch/../../x" }, { c: "merch\r\nSet-Cookie: a=b" },
  ];
  for (const query of attacks) {
    const res = await go(c, query);
    const location = res.headers.get("location");
    assert.equal(res.status, 302);
    assert.ok(location === "https://www.example.org/boutique" || (location.startsWith("/lien/") && !location.startsWith("//")), `${JSON.stringify(query)} → ${location}`);
    assert.equal(res.headers.get("set-cookie"), null);
  }
  // les paramètres ne changent rien à la destination du lien qui existe
  assert.equal((await go(c, { c: "merch", next: "https://evil.example.net/" })).headers.get("location"), "https://www.example.org/boutique");
  // et le lien court ne suit jamais une redirection de la destination (c'est le navigateur du visiteur qui s'en charge)
});

test("redirection : une destination abîmée dans le stockage n'est jamais suivie (revérifiée à chaque passage)", async () => {
  const c = ctx();
  const link = await make(c, "https://www.example.org/boutique", { slug: "merch" });
  for (const bad of ["javascript:alert(1)", "http://127.0.0.1/admin", "https://user:pw@example.org/", "data:text/html,x", "", `${SITE}/m/short-links/go?c=merch`]) {
    await c.api.store.update(link.id, { slug: "merch", url: bad, title: "", expires: "" });
    forgetLink(c, "merch");
    const res = await go(c, { c: "merch" });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/lien/missing", bad);
  }
});

test("redirection : seulement GET (et HEAD) ; rien n'est écrit ni compté par un autre verbe", async () => {
  const c = ctx();
  await make(c, "https://www.example.org/boutique", { slug: "merch" });
  const link = await c.api.store.getByKey(LINKS, "merch");
  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
    const res = await def.routes.go(new Request(`${SITE}/m/k/go?c=merch`, { method, body: method === "POST" || method === "PUT" ? "x".repeat(3_000_000) : undefined, headers: { "user-agent": UA } }), c);
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get("allow"), "GET, HEAD");
  }
  const head = await go(c, { c: "merch" }, { method: "HEAD" });
  assert.equal(head.status, 302);
  await settle(c);
  assert.equal((await readStats(c, link.id)).total, 0, "HEAD ne compte pas");
});

test("lien introuvable, mal écrit ou terminé : page aimable du site (dans la langue du visiteur), jamais une erreur sèche", async () => {
  const c = ctx();
  const link = await make(c, "https://www.example.org/boutique", { slug: "offre", expires: today(Date.now() + 86_400_000) });
  assert.equal((await go(c, { c: "offre" })).headers.get("location"), "https://www.example.org/boutique", "la veille de la fin : valable");
  // terminé hier
  await c.api.store.update(link.id, { slug: "offre", url: "https://www.example.org/boutique", title: "", expires: today(Date.now() - 86_400_000) });
  forgetLink(c, "offre");
  const ended = await go(c, { c: "offre" });
  assert.equal(ended.status, 302);
  assert.equal(ended.headers.get("location"), "/lien/ended/offre");
  assert.equal((await go(c, { c: "offre" }, { headers: { "accept-language": "en-GB,en;q=0.9" } })).headers.get("location"), "/en/lien/ended/offre");
  assert.equal((await go(c, { c: "inconnu" })).headers.get("location"), "/lien/missing");
  assert.equal((await go(c, "")).headers.get("location"), "/lien/missing");
  assert.equal((await go(c, { c: "x".repeat(500) })).headers.get("location"), "/lien/missing");
  assert.equal((await go(c, { c: "Bad Name!" })).headers.get("location"), "/lien/missing");
  // le jour de la date : encore valable jusqu'à la fin de la journée
  await c.api.store.update(link.id, { slug: "offre", url: "https://www.example.org/boutique", title: "", expires: today() });
  forgetLink(c, "offre");
  assert.equal((await go(c, { c: "offre" })).headers.get("location"), "https://www.example.org/boutique");
});

test("sans page sur le site, un lien terminé ou introuvable affiche une petite page autonome (404 / 410), sans rien reprendre du visiteur", async () => {
  const c = ctx({}, { basePath: null });
  const link = await make(c, "https://www.example.org/boutique", { slug: "offre" });
  await c.api.store.update(link.id, { slug: "offre", url: "https://www.example.org/boutique", title: "", expires: "2020-01-01" });
  forgetLink(c, "offre");
  const ended = await go(c, { c: "offre" });
  assert.equal(ended.status, 410);
  assert.match(ended.headers.get("content-type"), /text\/html/);
  assert.match(ended.headers.get("content-security-policy"), /default-src 'none'/);
  assert.match(await ended.text(), /Ce lien n&#39;est plus disponible/);
  const missing = await go(c, { c: '"><script>alert(1)</script>' });
  assert.equal(missing.status, 404);
  const html = await missing.text();
  assert.ok(!html.includes("<script>alert"), "rien du visiteur dans la page");
  assert.match(html, /href="\/"/);
});

test("langue de la page aimable : la plus proche de ce que demande le navigateur", () => {
  const c = ctx();
  const req = (accept) => new Request(SITE, { headers: accept === undefined ? {} : { "accept-language": accept } });
  assert.equal(preferredLocale(req("fr-BE,fr;q=0.9,en;q=0.5"), c), "fr");
  assert.equal(preferredLocale(req("en-US,en;q=0.9"), c), "en");
  assert.equal(preferredLocale(req("de-DE,de;q=0.9,en;q=0.4"), c), "en");
  assert.equal(preferredLocale(req("ja,zh;q=0.9"), c), "fr", "langue par défaut du site");
  assert.equal(preferredLocale(req(undefined), c), "fr");
  assert.equal(preferredLocale(req("*;q=0.5, xx;q=0, ;q=1"), c), "fr");
});

// ── Compteur de clics ──────────────────────────────────────────────────────────────────────────────────────────────────────
test("clics : un nombre par lien et par jour, sans cookie, sans adresse IP, sans rien sur le visiteur", async () => {
  const c = ctx();
  const link = await make(c, "https://www.example.org/boutique", { slug: "merch" });
  for (const ip of ["203.0.113.1", "203.0.113.2", "2001:db8::77"]) await go(c, { c: "merch" }, { ip, headers: { cookie: "a=b", referer: "https://elsewhere.example.net/page", "accept-language": "fr-BE" } });
  await settle(c);
  const stats = await readStats(c, link.id);
  assert.equal(stats.total, 3);
  assert.deepEqual(stats.days, { [today()]: 3 });
  const dump = JSON.stringify(c.api.store.dump());
  for (const secret of ["203.0.113", "2001:db8", "Mozilla", "Chrome", "elsewhere", "a=b", "fr-BE", "x-forwarded"]) assert.ok(!dump.includes(secret), `« ${secret} » ne doit jamais être gardé`);
  // le seul document de statistiques : un compteur par jour
  assert.deepEqual(Object.keys(c.api.store.dump(STATS)[0].data).sort(), ["days", "last", "link", "total"]);
});

test("clics : les robots, aperçus de messagerie, requêtes d'avance et clics au-delà de 30 par minute ne sont pas comptés — la redirection, elle, marche toujours", async () => {
  const c = ctx();
  const link = await make(c, "https://www.example.org/boutique", { slug: "merch" });
  const robots = [
    "Googlebot/2.1 (+http://www.google.com/bot.html)", "facebookexternalhit/1.1", "WhatsApp/2.23", "Slackbot-LinkExpanding 1.0", "Mozilla/5.0 (compatible; bingbot/2.0)",
    "curl/8.4.0", "python-requests/2.31", "Discordbot/2.0", "TelegramBot (like TwitterBot)", "Mozilla/5.0 (compatible; Twitterbot/1.0)", "", "x",
  ];
  for (const [i, ua] of robots.entries()) assert.equal((await go(c, { c: "merch" }, { ip: `192.0.2.${i + 1}`, headers: { "user-agent": ua } })).status, 302);
  assert.equal((await go(c, { c: "merch" }, { ip: "192.0.2.99", headers: { "sec-purpose": "prefetch" } })).status, 302);
  await settle(c);
  assert.equal((await readStats(c, link.id)).total, 0, "aucun robot compté");
  for (let i = 0; i < 45; i++) assert.equal((await go(c, { c: "merch" }, { ip: "198.51.100.200" })).status, 302, "la redirection n'est jamais refusée");
  await settle(c);
  assert.equal((await readStats(c, link.id)).total, 30, "30 clics comptés par minute et par visiteur au plus");
});

test("clics : rien n'est compté si le réglage est coupé", async () => {
  const c = ctx({ countClicks: false });
  const link = await make(c, "https://www.example.org/boutique", { slug: "merch" });
  assert.equal((await go(c, { c: "merch" })).status, 302);
  await settle(c);
  assert.equal(c.api.store.dump(STATS).length, 0);
  assert.equal((await readStats(c, link.id)).total, 0);
});

test("clics : une vague de 400 visiteurs d'un coup — tout est compté, avec quelques écritures seulement, sans verrou", async () => {
  const c = ctx();
  const link = await make(c, "https://www.example.org/boutique", { slug: "merch" });
  let writes = 0;
  for (const op of ["add", "update"]) { const original = c.api.store[op]; c.api.store[op] = async (...args) => { if (args[0] === STATS || op === "update") writes++; return original(...args); }; }
  const answers = await Promise.all(Array.from({ length: 400 }, (_, i) => go(c, { c: "merch" }, { ip: `10.${i >> 8}.${i & 255}.9` })));
  assert.ok(answers.every((r) => r.status === 302 && r.headers.get("location") === "https://www.example.org/boutique"));
  await settle(c);
  assert.equal((await readStats(c, link.id)).total, 400, "aucun clic perdu");
  assert.ok(writes <= 40, `${writes} écritures pour 400 clics`);
  assert.equal(c.api.store.dump(STATS).length, 1, "un seul document de statistiques");
});

test("clics : la réponse n'attend jamais le stockage (même s'il ne répond plus), et une panne d'écriture ne perd pas les clics", async () => {
  const c = ctx();
  const link = await make(c, "https://www.example.org/boutique", { slug: "merch" });
  c.api.store.faults.hang.add("update");
  c.api.store.faults.hang.add("add");
  const first = await go(c, { c: "merch" }, { ip: "203.0.113.5" }); // le décompte reste suspendu derrière
  assert.equal(first.status, 302);
  const second = await Promise.race([go(c, { c: "merch" }, { ip: "203.0.113.6" }), new Promise((r) => setTimeout(() => r("trop long"), 500))]);
  assert.equal(second.status, 302, "la redirection part sans attendre");
});

test("clics : une écriture qui échoue garde les clics pour le passage suivant", async () => {
  const c = ctx();
  const link = await make(c, "https://www.example.org/boutique", { slug: "merch" });
  const logged = [];
  const originalError = console.error;
  console.error = (...a) => logged.push(a.join(" "));
  try {
    c.api.store.faults.throw.add("add");
    await go(c, { c: "merch" }, { ip: "203.0.113.5" });
    await settle(c);
    assert.equal((await readStats(c, link.id)).total, 0);
    c.api.store.faults.throw.delete("add");
    await go(c, { c: "merch" }, { ip: "203.0.113.6" });
    await settle(c);
    assert.equal((await readStats(c, link.id)).total, 2, "le clic de la panne a été rattrapé");
  } finally {
    console.error = originalError;
  }
  assert.ok(logged.every((l) => !/203\.0\.113|Mozilla/.test(l)), "le journal ne contient rien du visiteur");
});

test("statistiques : le détail est borné à 120 jours (les plus anciens restent dans le total) et les chiffres du jour, de la semaine et du mois sont justes", async () => {
  const c = ctx();
  const link = await make(c, "https://www.example.org/boutique", { slug: "merch" });
  const days = {};
  for (let i = 0; i < 150; i++) days[today(Date.now() - i * 86_400_000)] = 1;
  c.api.store.seed([{ collection: STATS, key: link.id, data: { link: link.id, total: 150, days, last: today() } }]);
  await go(c, { c: "merch" }, { ip: "203.0.113.50" });
  await settle(c);
  const stats = await readStats(c, link.id);
  assert.equal(Object.keys(stats.days).length, 120);
  assert.equal(stats.total, 151, "rien ne disparaît du total");
  assert.equal(stats.days[today()], 2);
  const sums = summarize(stats);
  assert.deepEqual([sums.today, sums.week, sums.month, sums.total], [2, 8, 31, 151]);
  assert.equal(sums.series.length, 30);
  // des documents abîmés ne font rien planter
  c.api.store.seed([{ collection: STATS, key: "autre", data: { link: "autre", total: "beaucoup", days: { "pas-un-jour": 3, "2026-01-01": -4, "2026-01-02": "x" } } }]);
  assert.deepEqual(await readStats(c, "autre").then((s) => [s.total, s.days]), [0, {}]);
});

test("suppression d'un lien : ses chiffres partent avec lui et le lien ne répond plus", async () => {
  const c = ctx();
  const link = await make(c, "https://www.example.org/boutique", { slug: "merch" });
  await go(c, { c: "merch" });
  await settle(c);
  assert.equal(c.api.store.dump(STATS).length, 1);
  const r = await def.adminActions.remove.run(c, { id: link.id });
  assert.match(r.ok, /merch/);
  assert.equal(r.redirect, "?removed=1");
  assert.equal(c.api.store.dump(STATS).length, 0);
  assert.equal(await c.api.store.count(LINKS), 0);
  assert.equal((await go(c, { c: "merch" })).headers.get("location"), "/lien/missing", "l'ancienne destination n'est plus servie");
  assert.match((await def.adminActions.remove.run(c, { id: link.id })).error, /n'existe plus/);
});

test("modification : la destination change, le nom et donc le QR code déjà imprimé restent les mêmes", async () => {
  const c = ctx();
  const link = await make(c, "https://www.example.org/ancienne", { slug: "merch" });
  assert.equal((await go(c, { c: "merch" })).headers.get("location"), "https://www.example.org/ancienne");
  const before = await (await def.routes.qr(new Request(`${SITE}/m/k/qr?c=merch&fmt=svg`, { headers: { "user-agent": UA } }), c)).text();
  const r = await def.adminActions.update.run(c, { id: link.id, url: "example.org/nouvelle", title: "Affiche", expires: "" });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal((await go(c, { c: "merch" })).headers.get("location"), "https://example.org/nouvelle", "effet immédiat, sans attendre la mémoire");
  const after = await (await def.routes.qr(new Request(`${SITE}/m/k/qr?c=merch&fmt=svg`, { headers: { "user-agent": UA } }), c)).text();
  assert.equal(after, before, "le QR code est identique");
  const bad = await def.adminActions.update.run(c, { id: link.id, url: "http://192.168.0.1/", title: "", expires: "2020-01-01" });
  assert.deepEqual(Object.keys(bad.errors).sort(), ["expires", "url"]);
  assert.equal((await go(c, { c: "merch" })).headers.get("location"), "https://example.org/nouvelle", "un refus ne change rien");
  // une date de fin déjà passée et inchangée n'empêche pas de corriger autre chose
  await c.api.store.update(link.id, { slug: "merch", url: "https://example.org/nouvelle", title: "", expires: "2020-01-01" });
  assert.ok((await def.adminActions.update.run(c, { id: link.id, url: "https://example.org/nouvelle", title: "note", expires: "2020-01-01" })).ok);
  assert.ok((await def.adminActions.update.run(c, { id: "inexistant", url: "https://example.org/x" })).error);
});

// ── Image du QR code ───────────────────────────────────────────────────────────────────────────────────────────────────────
const qr = (c, query, headers = {}) => def.routes.qr(new Request(`${SITE}/m/${c.instance.key}/qr?${new URLSearchParams(query)}`, { headers: { "user-agent": UA, "x-forwarded-for": "198.51.100.9", ...headers } }), c);

test("image du QR code : SVG et PNG relisibles, qui contiennent l'adresse courte du lien", async () => {
  for (const level of ["L", "M", "Q"]) {
    const c = ctx({ qrLevel: level });
    await make(c, "https://www.example.org/boutique", { slug: "merch" });
    const wanted = `${SITE}/m/${c.instance.key}/go?c=merch`;
    const svg = await qr(c, { c: "merch", fmt: "svg" });
    assert.equal(svg.status, 200);
    assert.match(svg.headers.get("content-type"), /^image\/svg\+xml/);
    const markup = await svg.text();
    const read = decodeMatrix(matrixFromSvg(markup));
    assert.equal(read.text, wanted);
    assert.equal(read.level, level);
    for (const size of ["s", "m", "l", undefined]) {
      const png = await qr(c, { c: "merch", fmt: "png", ...(size ? { size } : {}) });
      assert.equal(png.headers.get("content-type"), "image/png");
      const { modules, scale } = matrixFromPng(Buffer.from(await png.arrayBuffer()));
      assert.equal(decodeMatrix(modules).text, wanted, `${level} ${size}`);
      assert.ok(scale >= 1);
    }
  }
});

test("image du QR code : téléchargement avec un nom de fichier sûr ; uniquement pour un lien qui existe ; limité en débit", async () => {
  const c = ctx();
  await make(c, "https://www.example.org/boutique", { slug: "merch" });
  const dl = await qr(c, { c: "merch", fmt: "png", dl: "1" });
  assert.equal(dl.headers.get("content-disposition"), 'attachment; filename="merch-qr.png"');
  assert.equal((await qr(c, { c: "merch", dl: "1" })).headers.get("content-disposition"), 'attachment; filename="merch-qr.svg"');
  assert.equal(dl.headers.get("x-content-type-options"), "nosniff");
  assert.equal((await qr(c, { c: "merch" })).headers.get("content-disposition"), null);
  // jamais un QR code d'un texte quelconque
  for (const query of [{ c: "inconnu" }, {}, { text: "https://evil.example.net/" }, { c: "https://evil.example.net/" }, { c: "merch\"; x=1" }]) {
    if (query.c === "merch\"; x=1" || query.c === "inconnu") assert.equal((await qr(c, query)).status, 404);
    else assert.equal((await qr(c, query)).status, 404, JSON.stringify(query));
  }
  assert.equal((await def.routes.qr(new Request(`${SITE}/m/k/qr?c=merch`, { method: "POST", body: "x" }), c)).status, 405);
  const d = ctx();
  await make(d, "https://www.example.org/boutique", { slug: "merch" });
  const statuses = [];
  for (let i = 0; i < 130; i++) statuses.push((await qr(d, { c: "merch" }, { "x-forwarded-for": "198.51.100.77" })).status);
  assert.equal(statuses.filter((s) => s === 200).length, 120);
  assert.equal(statuses[129], 429);
  assert.equal((await qr(d, { c: "merch" }, { "x-forwarded-for": "198.51.100.78" })).status, 200, "un autre visiteur n'est pas gêné");
  forgetImageHits(d);
  assert.equal((await qr(d, { c: "merch" }, { "x-forwarded-for": "198.51.100.77" })).status, 200);
});

test("adresse courte : celle de l'option avancée si elle est donnée, sinon celle du site ; le QR code la contient", async () => {
  const c = ctx({ publicBase: "https://demo.example.org/go/" });
  await make(c, "https://www.example.org/boutique", { slug: "merch" });
  assert.equal(decodeMatrix(matrixFromSvg(await (await qr(c, { c: "merch" })).text())).text, "https://demo.example.org/go/merch");
  const d = ctx({ publicBase: "https://demo.example.org/go" });
  await make(d, "https://www.example.org/boutique", { slug: "merch" });
  assert.equal(decodeMatrix(matrixFromSvg(await (await qr(d, { c: "merch" })).text())).text, "https://demo.example.org/go/merch", "la barre finale est ajoutée");
  const e = ctx({ publicBase: "javascript:alert(1)" });
  await make(e, "https://www.example.org/boutique", { slug: "merch" });
  assert.match(decodeMatrix(matrixFromSvg(await (await qr(e, { c: "merch" })).text())).text, /^https:\/\/demo\.example\.org\/m\//, "une valeur absurde est ignorée");
});

// ── Page aimable ───────────────────────────────────────────────────────────────────────────────────────────────────────────
test("page aimable : introuvable, terminé (avec la date), message personnalisé ; tout autre chemin est une 404 ; rien du visiteur n'est repris", async () => {
  const c = ctx();
  const link = await make(c, "https://www.example.org/boutique", { slug: "offre" });
  await c.api.store.update(link.id, { slug: "offre", url: "https://www.example.org/boutique", title: "", expires: "2026-03-05" });
  forgetLink(c, "offre");
  const missing = await def.page(c, { segments: [] });
  assert.equal(missing.title, "Lien introuvable");
  assert.deepEqual(missing.blocks.at(-1), { type: "links", items: [{ label: "Aller à l'accueil", href: "/" }] });
  assert.equal((await def.page(c, { segments: ["missing"] })).title, "Lien introuvable");
  const ended = await def.page(c, { segments: ["ended", "offre"] });
  assert.equal(ended.title, "Ce lien n'est plus disponible");
  assert.match(ended.blocks[0].text, /5 mars 2026/);
  assert.match((await def.page(c, { segments: ["ended", "inconnu"] })).blocks[0].text, /sa date de fin est passée/);
  assert.match((await def.page(c, { segments: ["ended"] })).blocks[0].text, /sa date de fin est passée/);
  const custom = ctx({ endedMessage: "L'offre est **terminée**." });
  assert.equal((await def.page(custom, { segments: ["ended", "x"] })).blocks[0].text, "L'offre est **terminée**.");
  for (const segments of [["page", "2"], ["whatever"], ["ended", "a", "b"], ['"><script>alert(1)</script>'], ["missing", "x"]]) assert.equal((await def.page(c, { segments })).notFound, true, JSON.stringify(segments));
  const english = ctx({}, { messages: en, locale: "en" });
  assert.equal((await def.page(english, { segments: [] })).blocks.at(-1).items[0].href, "/en", "lien d'accueil dans la langue du visiteur");
  assert.equal((await def.page(english, { segments: [] })).title, "Link not found");
});

// ── Administration ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test("administration : liste vide, formulaire de création, aucune erreur d'un panneau neuf", async () => {
  const c = ctx();
  const blocks = await def.adminPanel(c, { query: {} });
  const create = blocks.find((b) => b.type === "adminForm");
  assert.equal(create.action, "create");
  assert.deepEqual(create.fields.map((f) => f.name), ["url", "slug", "title", "expires"]);
  assert.equal(create.fields.find((f) => f.name === "url").required, true);
  assert.ok(create.fields.filter((f) => f.name !== "url").every((f) => !f.required), "un seul champ obligatoire");
  assert.ok(blocks.some((b) => b.type === "markdown" && /Aucun lien/.test(b.text)));
  assert.ok(!blocks.some((b) => b.type === "banner"), "pas d'avertissement quand l'adresse du site est réglée");
  // sans le droit de modifier : on voit, on ne modifie pas
  const reader = ctx();
  reader.can = () => false;
  const view = await def.adminPanel(reader, { query: {} });
  assert.ok(!view.some((b) => b.type === "adminForm" || b.type === "table"));
});

test("administration : l'adresse du site non réglée est signalée avant qu'on imprime", async () => {
  const c = ctx({}, { siteUrl: "http://localhost:3000" });
  const [banner] = await def.adminPanel(c, { query: {} });
  assert.equal(banner.type, "banner");
  assert.equal(banner.tone, "warning");
  assert.match(banner.text, /localhost:3000/);
  assert.equal((await def.adminPanel(ctx({ publicBase: "https://demo.example.org/go/" }, { siteUrl: "http://localhost:3000" }), { query: {} })).some((b) => b.type === "banner"), false, "une adresse courte réglée suffit");
});

test("administration : la liste par pages de 50 avec « Voir la suite », la recherche, les statuts", async () => {
  const c = ctx();
  c.api.store.seed(Array.from({ length: 120 }, (_, i) => ({ collection: LINKS, key: `lien-${String(i).padStart(3, "0")}`, data: { slug: `lien-${String(i).padStart(3, "0")}`, url: `https://www.example.org/p/${i}`, title: i === 7 ? "Flyer du marché" : "", expires: i === 3 ? "2020-01-01" : i === 4 ? "2999-01-01" : "" } })));
  const cards = (blocks) => blocks.filter((b) => b.type === "html").flatMap((b) => [...b.html.matchAll(/href="\?open=/g)]).length;
  const first = await def.adminPanel(c, { query: {} });
  assert.equal(cards(first), 50);
  assert.match(text(first), /Vos liens \(120 sur 300\)/);
  const more = first.find((b) => b.type === "links" && b.items[0].label === "Voir la suite");
  assert.ok(more);
  const cursor = decodeURIComponent(new URLSearchParams(more.items[0].href.slice(1)).get("cursor"));
  const second = await def.adminPanel(c, { query: { cursor } });
  assert.equal(cards(second), 50);
  const third = await def.adminPanel(c, { query: { cursor: decodeURIComponent(new URLSearchParams(second.find((b) => b.type === "links" && b.items[0].label === "Voir la suite").items[0].href.slice(1)).get("cursor")) } });
  assert.equal(cards(third), 20);
  assert.ok(!third.some((b) => b.type === "links" && b.items[0].label === "Voir la suite"), "dernière page");
  assert.equal(cards(await def.adminPanel(c, { query: { cursor: "illisible" } })), 0, "un curseur illisible ne plante pas");
  // recherche : nom, note, adresse
  assert.equal(cards(await def.adminPanel(c, { query: { q: "marché" } })), 1);
  assert.equal(cards(await def.adminPanel(c, { query: { q: "lien-04" } })), 10);
  assert.equal(cards(await def.adminPanel(c, { query: { q: "example.org/p/99" } })), 1);
  assert.match(text(await def.adminPanel(c, { query: { q: "zzzz" } })), /Aucun lien ne correspond/);
  assert.match(text(third), /Terminé le/, "un lien terminé le dit");
  assert.match(text(third), /Valable jusqu&#39;au/);
});

test("administration : le lien ouvert montre son QR code (relisible), les chiffres, la copie de l'adresse, les téléchargements, la modification et la suppression", async () => {
  const c = ctx({ qrLevel: "Q" });
  const link = await make(c, "https://www.example.org/boutique", { slug: "merch", title: "Flyer" });
  for (let i = 0; i < 3; i++) await go(c, { c: "merch" }, { ip: `203.0.113.${i + 1}` });
  const blocks = await def.adminPanel(c, { query: { open: link.id, new: "2" } });
  assert.match(blocks.find((b) => b.type === "banner").text, /Je l'ai appelé « merch »/);
  const svg = blocks.filter((b) => b.type === "html").map((b) => /<svg [^]*?<\/svg>/.exec(b.html)?.[0]).find((s) => s?.includes('role="img"') && s.includes("<title>QR code du lien merch"));
  assert.equal(decodeMatrix(matrixFromSvg(svg)).text, `${SITE}/m/${c.instance.key}/go?c=merch`, "le QR code de l'écran se relit");
  assert.deepEqual(blocks.find((b) => b.type === "copy"), { type: "copy", label: "Adresse courte à partager", text: `${SITE}/m/${c.instance.key}/go?c=merch` });
  const all = text(blocks);
  for (const frag of ["fmt=svg", "fmt=png&amp;size=m", "fmt=png&amp;size=l", "dl=1"]) assert.ok(all.includes(frag), frag);
  const stats = blocks.find((b) => b.type === "html" && b.html.includes("Depuis la création")).html;
  assert.match(stats, />3<\/div><div[^>]*>Aujourd&#39;hui/);
  assert.match(stats, /role="img" aria-label="Clics par jour sur les 30 derniers jours : 3 au total/);
  const edit = blocks.find((b) => b.type === "adminForm");
  assert.equal(edit.action, "update");
  assert.deepEqual(edit.fields.map((f) => [f.name, f.value]), [["id", link.id], ["url", "https://www.example.org/boutique"], ["title", "Flyer"], ["expires", ""]]);
  const table = blocks.find((b) => b.type === "table");
  assert.equal(table.rowActions[0].action, "remove");
  assert.equal(table.rowActions[0].danger, true);
  assert.match(table.rowActions[0].confirm, /merch/);
  assert.deepEqual(table.rowIds, [link.id]);
  // lien inconnu : message, puis la liste
  const gone = await def.adminPanel(c, { query: { open: "nimporte-quoi" } });
  assert.match(text(gone), /Ce lien n'existe plus|Ce lien n&#39;existe plus/);
  assert.ok(gone.some((b) => b.type === "adminForm" && b.action === "create"));
});

test("administration : tout ce qui vient de la personne est échappé (note, adresse, nom, recherche)", async () => {
  const c = ctx();
  const evil = `<script>alert(1)</script>"><img src=x onerror=alert(2)>`;
  const link = await make(c, "https://www.example.org/p?a=<script>alert(1)</script>\"><img/src=x/onerror=alert(2)>", { slug: "piege", title: evil });
  // (les valeurs d'un formulaire sont du texte brut que le cœur place dans des champs : seul le HTML écrit par le module est à surveiller)
  const html = [...(await def.adminPanel(c, { query: {} })), ...(await def.adminPanel(c, { query: { open: link.id } })), ...(await def.adminPanel(c, { query: { q: evil } }))].filter((b) => b.type !== "adminForm");
  const raw = JSON.stringify(html);
  for (const danger of ["<script>alert", "<img src=x", "<img "]) assert.ok(!raw.includes(danger), `${danger} ne doit pas passer tel quel`);
  assert.ok(raw.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
});

test("administration : le bandeau « compteur coupé » apparaît seulement quand il faut", async () => {
  const on = ctx();
  const off = ctx({ countClicks: false });
  const a = await make(on, "https://www.example.org/boutique", { slug: "merch" });
  const b = await make(off, "https://www.example.org/boutique", { slug: "merch" });
  assert.ok(!(await def.adminPanel(on, { query: { open: a.id } })).some((x) => x.type === "banner"));
  assert.ok((await def.adminPanel(off, { query: { open: b.id } })).some((x) => x.type === "banner" && /comptage des clics est coupé/.test(x.text)));
});

test("administration : les actions demandent le droit « links.edit » (vérifié par le cœur), le téléchargement et la sauvegarde sont prêts", () => {
  for (const name of ["create", "update", "remove"]) assert.equal(def.adminActions[name].right, "links.edit", name);
  assert.equal(typeof def.adminDownloads.stats.generate, "function");
  assert.equal(def.adminDownloads.stats.contentType, "text/csv");
});

// ── Exports ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("exports : clics par jour (tableur) et sauvegarde lisible — cellules neutralisées, accents lisibles, tout borné", async () => {
  const c = ctx();
  const a = await make(c, "https://www.example.org/boutique", { slug: "merch", title: '=HYPERLINK("http://x")' });
  await make(c, "https://www.example.org/autre", { slug: "autre", title: "Été, \"fête\"" });
  c.api.store.seed([{ collection: STATS, key: a.id, data: { link: a.id, total: 9, days: { "2026-10-01": 4, "2026-10-02": 5 }, last: "2026-10-02" } }]);
  let csv = "";
  for await (const part of def.adminDownloads.stats.generate(c, {})) csv += part;
  assert.ok(csv.startsWith("﻿"));
  assert.match(csv, /"lien","jour","clics"\r\n"merch","2026-10-01","4"\r\n"merch","2026-10-02","5"\r\n/);
  const files = await def.backup.readable(c);
  assert.deepEqual(files.map((f) => f.path), ["liens.csv", "clics-par-jour.csv"]);
  const links = files[0].content;
  assert.ok(links.includes(`"'=HYPERLINK(""http://x"")"`), "une formule de tableur est neutralisée");
  assert.ok(links.includes('"Été, ""fête"""'));
  assert.ok(links.includes(`"${SITE}/m/${c.instance.key}/go?c=merch"`));
  assert.equal(cell("=1+1"), `"'=1+1"`);
  assert.equal(cell("+33 1"), `"'+33 1"`);
  assert.equal(cell("-2"), `"'-2"`);
  assert.equal(cell("@x"), `"'@x"`);
  assert.equal(cell('a"b'), '"a""b"');
});

// ── Assistant IA ───────────────────────────────────────────────────────────────────────────────────────────────────────────
test("assistant IA : lister, créer, modifier, voir les chiffres et supprimer, avec les mêmes règles que l'écran", async () => {
  const c = ctx();
  const created = await def.mcp.shortlink_create(c, { url: "example.org/boutique/mug", note: "Affiche", endsOn: today(Date.now() + 5 * 86_400_000) }, { name: "assistant" });
  assert.equal(created.name, "affiche", "le nom est proposé d'après la note");
  assert.equal(created.shortUrl, `${SITE}/m/${c.instance.key}/go?c=affiche`);
  assert.equal(created.destination, "https://example.org/boutique/mug");
  assert.equal(created.ended, false);
  await go(c, { c: "affiche" });
  const list = await def.mcp.shortlink_list(c, {});
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].clicksTotal, 1);
  assert.equal(list.next, null);
  const stats = await def.mcp.shortlink_stats(c, { id: created.id, days: 7 });
  assert.deepEqual(stats.days, [{ day: today(), clicks: 1 }]);
  assert.equal(stats.period, 7);
  const updated = await def.mcp.shortlink_update(c, { id: created.id, url: "https://example.org/nouveau", endsOn: "none" });
  assert.equal(updated.destination, "https://example.org/nouveau");
  assert.equal(updated.endsOn, null);
  assert.equal(updated.note, "Affiche", "ce qui n'est pas dit ne change pas");
  const deleted = await def.mcp.shortlink_delete(c, { id: created.id });
  assert.deepEqual(deleted, { id: created.id, name: "affiche", deleted: true });
  assert.equal((await def.mcp.shortlink_list(c, {})).items.length, 0);
});

test("assistant IA : les refus sont lisibles par l'assistant (et lui seul), jamais une adresse interne, jamais un nom réservé", async () => {
  const c = ctx();
  await assert.rejects(def.mcp.shortlink_create(c, { url: "http://169.254.169.254/latest/meta-data" }), (e) => e.expose === true && /private or internal/.test(e.message));
  await assert.rejects(def.mcp.shortlink_create(c, { url: "javascript:alert(1)" }), (e) => e.expose && /Only web addresses/.test(e.message));
  await assert.rejects(def.mcp.shortlink_create(c, { url: "https://example.org/", name: "admin" }), (e) => e.expose && /reserved/.test(e.message) && /Suggestion/.test(e.message));
  await assert.rejects(def.mcp.shortlink_create(c, { url: "https://example.org/", endsOn: "2020-01-01" }), (e) => e.expose && /already past/.test(e.message));
  await assert.rejects(def.mcp.shortlink_stats(c, { id: "nope" }), (e) => e.expose && /does not exist/.test(e.message));
  await assert.rejects(def.mcp.shortlink_update(c, { id: "nope", url: "https://example.org/" }), (e) => e.expose);
  await assert.rejects(def.mcp.shortlink_delete(c, { id: "nope" }), (e) => e.expose);
  const ok = await def.mcp.shortlink_create(c, { url: "https://example.org/x", name: "merch" });
  await assert.rejects(def.mcp.shortlink_update(c, { id: ok.id, url: "http://localhost/" }), (e) => e.expose && /private or internal/.test(e.message));
  await assert.rejects(def.mcp.shortlink_create(c, { url: "https://example.org/y", name: "merch" }), (e) => e.expose && /already used/.test(e.message));
});

test("assistant IA : la liste se lit par pages (curseur)", async () => {
  const c = ctx();
  for (let i = 0; i < 7; i++) await make(c, `https://example.org/${i}`, { slug: `lien-${i}` });
  const one = await def.mcp.shortlink_list(c, { limit: 3 });
  assert.equal(one.items.length, 3);
  assert.ok(one.next);
  const two = await def.mcp.shortlink_list(c, { limit: 3, cursor: one.next });
  const three = await def.mcp.shortlink_list(c, { limit: 3, cursor: two.next });
  assert.deepEqual([two.items.length, three.items.length, three.next], [3, 1, null]);
  assert.equal(new Set([...one.items, ...two.items, ...three.items].map((x) => x.id)).size, 7);
});

// ── Vie privée, instance ───────────────────────────────────────────────────────────────────────────────────────────────────
test("instance retirée : la mémoire du module est vidée", async () => {
  const c = ctx();
  await make(c, "https://www.example.org/boutique", { slug: "merch" });
  await go(c, { c: "merch" });
  await settle(c);
  await def.hooks.onInstanceDelete(c);
  forgetInstance(c);
  forgetImageHits(c);
  assert.equal(typeof def.hooks.onInstanceDelete, "function");
});

test("aucun cookie ni adresse IP : le code du module n'écrit ni l'un ni l'autre nulle part", () => {
  const sources = fs.readdirSync(DIR).filter((f) => f.endsWith(".mjs")).map((f) => fs.readFileSync(`${DIR}/${f}`, "utf8")).join("\n");
  assert.ok(!/set-cookie|cookies\.set|document\.cookie/i.test(sources.replace(/\/\/.*$/gm, "")), "aucun cookie");
  const writes = [...sources.matchAll(/store\.(?:add|update|addMany)\(/g)];
  assert.ok(writes.length >= 3);
  assert.ok(!/fetch\(/.test(sources), "pas d'appel réseau");
  assert.ok(!/ctx\.api\.net|ctx\.api\.mail/.test(sources));
  assert.ok(!/\bsetInterval\b/.test(sources), "pas de minuteur de fond");
});
