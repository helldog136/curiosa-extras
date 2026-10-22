// Santé du site — les garde-fous : le module ne doit jamais servir à sonder un réseau interne ni à attaquer un autre site.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { makeSite, withFakeFetch, fakeFetch, netReplies, U, P, DIR, clock } from "./helpers/site-check-kit.mjs";

const publicDns = async () => ({ ok: true, addresses: ["93.184.216.34"] });
/** Visite `url` avec un faux site distant ; `calls` = ce qui est VRAIMENT parti sur le réseau (pas ce que le module a demandé au client du cœur). */
const probe = async (url, routes, deps = {}) => {
  const ctx = makeSite();
  let result, calls;
  await withFakeFetch(routes, async (f) => { result = await P.probeLink(ctx, url, { resolve: publicDns, ...deps }); calls = f.calls.map((c) => ({ url: c.url, method: c.init?.method })); });
  return { result, calls, ctx };
};

test("adresses refusées d'avance : numériques (toutes écritures), noms internes, ports exotiques, identifiants dans l'adresse", () => {
  const refused = ["https://127.0.0.1/", "https://10.0.0.5/x", "https://192.168.1.1/", "https://169.254.169.254/latest/meta-data", "https://2130706433/", "https://0x7f000001/", "https://017700000001/", "https://127.1/", "https://[::1]/", "https://[::ffff:127.0.0.1]/", "https://[fd00::1]/",
    "https://localhost/", "https://intranet/", "https://printer.local/", "https://nas.lan/", "https://db.internal/", "https://x.home.arpa/", "https://example.org:8443/", "https://example.org:22/", "https://user:pass@example.org/", "ftp://example.org/", "https://exemple/"];
  for (const u of refused) assert.notEqual(U.hostProblem(new URL(u)), null, `${u} doit être refusée`);
  for (const u of ["https://example.org/", "https://www.example.org:443/x?y=1", "https://sub.domaine.example.org/", "http://example.org/", "https://xn--bcher-kva.example/"]) assert.equal(U.hostProblem(new URL(u)), null, `${u} peut être visitée`);
});

test("une adresse numérique issue de la résolution d'un nom : privée, locale, réservée → refusée ; publique → permise", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.10", "169.254.1.1", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1", "::1", "::", "fe80::1", "fd12:3456::1", "::ffff:10.0.0.1", "::ffff:7f00:1", "fec0::1", "ff02::1", "2001:db8::1", "64:ff9b::7f00:1", "not-an-ip"]) assert.equal(U.addressIsPrivate(ip), true, ip);
  for (const ip of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "172.15.255.255", "2606:4700:4700::1111", "100.63.255.255"]) assert.equal(U.addressIsPrivate(ip), false, ip);
});

test("un nom de domaine qui mène vers une adresse privée n'est JAMAIS contacté", async () => {
  const { result, calls } = await probe("https://innocent.example.org/page", { "*": { status: 200 } }, { resolve: async () => ({ ok: true, addresses: ["93.184.216.34", "10.0.0.7"] }) });
  assert.deepEqual([result.st, result.why], ["refused", "private"]);
  assert.equal(calls.length, 0, "aucune demande n'est partie");
});

test("les adresses internes ne partent pas non plus : aucune demande réseau", async () => {
  for (const u of ["https://localhost/", "https://127.0.0.1/", "https://[::1]/x", "https://example.org:8443/", "https://u:p@example.org/", "https://intranet/"]) {
    const { result, calls } = await probe(u, { "*": { status: 200 } });
    assert.equal(result.st, "refused", u);
    assert.equal(calls.length, 0, u);
  }
});

test("une redirection vers une adresse interne est refusée, sans contacter la destination", async () => {
  const { result, calls } = await probe("https://example.org/a", { "https://example.org/a": { status: 302, headers: { location: "https://169.254.169.254/latest" } }, "*": { status: 200 } });
  assert.deepEqual([result.st, result.why], ["refused", "redirect_address"]);
  assert.deepEqual(calls.map((c) => c.url), ["https://example.org/a"], "seule la première adresse a été visitée");
  const loop = await probe("https://example.org/a", { "https://example.org/a": { status: 302, headers: { location: "http://example.org/b" } } });
  assert.deepEqual([loop.result.st, loop.result.why], ["unverified", "insecure"], "une destination non sécurisée n'est pas visitée");
  assert.equal(loop.calls.length, 1);
});

test("redirections : 5 au plus, boucles détectées, redirection permanente vers un autre endroit = « a changé d'adresse »", async () => {
  const chain = {}; for (let i = 0; i < 10; i++) chain[`https://example.org/r${i}`] = { status: 302, headers: { location: `https://example.org/r${i + 1}` } };
  const long = await probe("https://example.org/r0", chain);
  assert.equal(long.result.st, "loop");
  assert.ok(long.calls.length <= 6, `au plus 6 demandes (1 + 5 renvois), vu ${long.calls.length}`);
  const circle = await probe("https://example.org/a", { "https://example.org/a": { status: 301, headers: { location: "https://example.org/b" } }, "https://example.org/b": { status: 301, headers: { location: "https://example.org/a" } } });
  assert.equal(circle.result.st, "loop");
  const moved = await probe("https://old.example.org/page", { "https://old.example.org/page": { status: 301, headers: { location: "https://new.example.org/page" } }, "https://new.example.org/": { status: 200 }, "https://new.example.org/page": { status: 200 } });
  assert.deepEqual([moved.result.st, moved.result.to], ["moved", "https://new.example.org/page"]);
  const trivial = await probe("https://example.org/page", { "https://example.org/page": { status: 301, headers: { location: "https://www.example.org/page/" } }, "https://www.example.org/page/": { status: 200 } });
  assert.equal(trivial.result.st, "ok", "www ou barre finale : pas de remarque");
  const temp = await probe("https://example.org/page", { "https://example.org/page": { status: 302, headers: { location: "https://other.example.org/x" } }, "https://other.example.org/x": { status: 200 } });
  assert.equal(temp.result.st, "ok", "un renvoi temporaire n'est pas une erreur");
});

test("HEAD d'abord, puis un GET de 2 Ko seulement si le site ne sait pas répondre à HEAD ; jamais de téléchargement complet", async () => {
  let n = 0;
  const { result, calls, ctx } = await probe("https://example.org/p", { "https://example.org/p": (url, init) => { n++; return init.method === "HEAD" ? { status: 405 } : { status: 200, text: "x".repeat(5000) }; } });
  assert.equal(result.st, "ok");
  assert.deepEqual(calls.map((c) => c.method), ["HEAD", "GET"]);
  const fine = await probe("https://example.org/p", { "https://example.org/p": { status: 200 } });
  assert.deepEqual(fine.calls.map((c) => c.method), ["HEAD"], "HEAD suffit quand il répond");
  assert.ok(P.REQUEST_TIMEOUT_MS <= 8000);
});

test("404 (même après GET) = « n'existe plus » ; 500 = « ne répond pas bien » ; panne réseau et silence = « ne répond pas » ; 403/451… = « refuse les visites »", async () => {
  assert.deepEqual((await probe("https://example.org/x", { "*": { status: 404 } })).result, { st: "gone", code: 404 });
  assert.deepEqual((await probe("https://example.org/x", { "*": { status: 410 } })).result, { st: "gone", code: 410 });
  const head404 = await probe("https://example.org/x", { "https://example.org/x": (u, init) => (init.method === "HEAD" ? { status: 404 } : { status: 200 }) });
  assert.equal(head404.result.st, "ok", "un site qui répond 404 à HEAD mais 200 à GET est vivant");
  assert.deepEqual((await probe("https://example.org/x", { "*": { status: 503 } })).result, { st: "down", why: "server", code: 503 });
  assert.deepEqual((await probe("https://example.org/x", { "*": netReplies.down() })).result, { st: "down", why: "network" });
  for (const code of [401, 403, 406, 451]) assert.equal((await probe("https://example.org/x", { "*": { status: code } })).result.st, "blocked", String(code));
});

test("« trop de demandes » : le site est mis en pause, la demande suivante ne part pas", async () => {
  const ctx = makeSite();
  let r1, r2, r3;
  await withFakeFetch({ "*": netReplies.rateLimited(120) }, async (f) => {
    r1 = await P.probeLink(ctx, "https://example.org/a", { resolve: publicDns });
    const before = f.calls.length;
    r2 = await P.probeLink(ctx, "https://example.org/b", { resolve: publicDns });
    r3 = f.calls.length - before;
  });
  assert.equal(r1.st, "paused");
  assert.equal(r2.st, "paused");
  assert.equal(r3, 0, "aucune demande pendant la pause");
});

test("une adresse sans « s » est vérifiée en https ; si le site ne répond pas ainsi, on dit qu'on ne peut pas conclure (jamais « cassé »)", async () => {
  const ok = await probe("http://example.org/a", { "https://example.org/a": { status: 200 } });
  assert.deepEqual(ok.result, { st: "ok", insecure: true });
  assert.ok(ok.calls.every((c) => c.url.startsWith("https://")));
  const dead = await probe("http://example.org/a", { "*": netReplies.down() });
  assert.deepEqual([dead.result.st, dead.result.why], ["unverified", "insecure"]);
  const gone = await probe("http://example.org/a", { "*": { status: 404 } });
  assert.equal(gone.result.st, "unverified");
});

test("chaque visite se présente (nom du programme et adresse du site) et passe par le client réseau du cœur avec un délai court", async () => {
  const seen = [];
  const { result } = await probe("https://example.org/p", { "https://example.org/p": (url, init) => { seen.push(init.headers); return { status: 200 }; } });
  assert.equal(result.st, "ok");
  assert.match(seen[0]["user-agent"], /SiteHealthCheck\/1\.0.*mon-site\.example\.org/);
  assert.ok(!("cookie" in seen[0]) && !("authorization" in seen[0]));
});

test("délai total par lien : un site qui ne répond jamais ne bloque pas la vérification", async () => {
  const ctx = makeSite();
  const t0 = Date.now();
  let r;
  await withFakeFetch({ "*": netReplies.silence() }, async () => { r = await P.probeLink(ctx, "https://example.org/slow", { resolve: publicDns, linkBudgetMs: 700 }); });
  assert.deepEqual([r.st, r.why], ["down", "timeout"]);
  assert.ok(Date.now() - t0 < 3000);
});

test("le code du module n'appelle jamais fetch lui-même, n'a ni minuteur répétitif ni tâche de fond", () => {
  for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith(".mjs"))) {
    const src = fs.readFileSync(`${DIR}/${f}`, "utf8").replace(/\/\/.*$/gm, "");
    assert.ok(!/\bfetch\s*\(/.test(src), `${f} : pas de fetch direct`);
    assert.ok(!/setInterval/.test(src), `${f} : pas de minuteur répétitif`);
    assert.ok(!/\btasks\s*:/.test(src), `${f} : pas de tâche planifiée`);
  }
});

test("liste des sites à laisser tranquille : tolérante (adresses entières, www, virgules, lignes)", () => {
  const set = U.parseIgnoredHosts("boutique.example.org\nhttps://www.exemple.net/page, autre.example.org ;  \n");
  assert.deepEqual([...set].sort(), ["autre.example.org", "boutique.example.org", "exemple.net"]);
  assert.equal(U.parseIgnoredHosts("").size, 0);
});
