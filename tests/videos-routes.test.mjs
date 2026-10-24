// Vidéothèque : les deux routes publiques. La miniature (lue dans le stockage, jamais récupérée chez la plateforme) et la recherche (redirection fabriquée, jamais une adresse reçue).
import test from "node:test";
import assert from "node:assert/strict";
import { blockNetwork } from "/dev/shm/core-assoc/testsupport/index.mjs";
import { ctxFor, def, seedVideos, seedCategory, keepThumb, id } from "./helpers/videosKit.mjs";

const get = (ctx, route, qs = "") => def.routes[route](new Request(`https://example.test/m/${ctx.instance.key}/${route}${qs}`), ctx);

test("miniature : octets gardés, bons en-têtes, ETag et 304, aucune écriture ni appel réseau", async () => {
  const ctx = ctxFor();
  const [a] = await seedVideos(ctx, [{ ext: id(1), title: "A" }]);
  await keepThumb(ctx, a.n, 1234);
  const writes = ctx.calls.writes.length;
  const { value: res, calls } = await blockNetwork(() => get(ctx, "thumb", `?v=${a.n}`));
  assert.equal(calls.length, 0);
  assert.equal(res.status, 200); assert.equal(res.headers.get("content-type"), "image/jpeg"); assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.match(res.headers.get("cache-control"), /public, max-age=\d+/); assert.equal(res.headers.get("content-security-policy"), "sandbox");
  assert.equal((await res.arrayBuffer()).byteLength, 1234);
  const etag = res.headers.get("etag");
  assert.ok(etag);
  assert.equal((await def.routes.thumb(new Request(`https://example.test/m/x/thumb?v=${a.n}`, { headers: { "if-none-match": etag } }), ctx)).status, 304);
  assert.equal(ctx.calls.writes.length, writes, "lire une miniature n'écrit rien");
});

test("miniature : introuvable pour une vidéo inconnue, brouillon, sans copie ou avec « fond sobre » ; entrées piégées", async () => {
  const ctx = ctxFor();
  const [pub, draft, nocopy] = await seedVideos(ctx, [{ ext: id(1), title: "A" }, { ext: id(2), title: "B", status: "draft" }, { ext: id(3), title: "C" }]);
  await keepThumb(ctx, pub.n); await keepThumb(ctx, draft.n);
  assert.equal((await get(ctx, "thumb", `?v=${pub.n}`)).status, 200);
  for (const qs of [`?v=${draft.n}`, `?v=${nocopy.n}`, "?v=999", "?v=", "", "?v=abc", "?v=1e2", "?v=-1", "?v=1%20or%201", "?v=99999999"]) {
    const r = await get(ctx, "thumb", qs);
    assert.equal(r.status, 404, qs); assert.ok(!(await r.text()).includes("/"));
  }
  const plain = ctxFor({ thumbs: "plain" });
  const [p] = await seedVideos(plain, [{ ext: id(1), title: "A" }]);
  await keepThumb(plain, p.n);
  assert.equal((await get(plain, "thumb", `?v=${p.n}`)).status, 404);
});

test("une autre méthode que GET est refusée (405)", async () => {
  const ctx = ctxFor();
  for (const method of ["POST", "PUT", "DELETE"]) {
    const init = { method, ...(method === "POST" ? { body: "x" } : {}) };
    const r = await def.routes.thumb(new Request("https://example.test/m/x/thumb?v=1", init), ctx);
    assert.equal(r.status, 405); assert.equal(r.headers.get("allow"), "GET");
    assert.equal((await def.routes.find(new Request("https://example.test/m/x/find?q=a", init), ctx)).status, 405);
  }
});

test("recherche : redirection vers le catalogue du site, mots nettoyés, catégorie connue seulement", async () => {
  const ctx = ctxFor();
  await seedCategory(ctx, "Tutoriels");
  const loc = async (qs) => { const r = await get(ctx, "find", qs); assert.equal(r.status, 303, qs); return r.headers.get("location"); };
  assert.equal(await loc("?q=Éclairage doux"), "/videos/s/eclairage-doux");
  assert.equal(await loc("?q=lumière&c=tutoriels"), "/videos/c/tutoriels/s/lumiere");
  assert.equal(await loc("?q=&c=tutoriels"), "/videos/c/tutoriels");
  assert.equal(await loc("?q="), "/videos"); assert.equal(await loc(""), "/videos");
  assert.equal(await loc("?q=a&c=inconnue"), "/videos/s/a");
  assert.equal(await loc("?q=%3Cscript%3Ealert(1)%3C/script%3E"), "/videos/s/script-alert-1-script");
  assert.equal(await loc("?q=../../etc/passwd"), "/videos/s/etc-passwd");
  assert.equal(await loc(`?q=${"x".repeat(500)}`), `/videos/s/${"x".repeat(60)}`);
});

test("recherche : jamais de redirection vers une adresse reçue (next, redirect, return, url…)", async () => {
  const ctx = ctxFor();
  for (const evil of ["https://evil.test/", "//evil.test", "javascript:alert(1)", "/\\evil.test"]) {
    for (const key of ["next", "redirect", "return", "url", "to", "c", "q"]) {
      const l = (await get(ctx, "find", `?${key}=${encodeURIComponent(evil)}`)).headers.get("location");
      if (l) { assert.ok(l.startsWith("/videos")); assert.ok(!l.startsWith("//") && !l.includes("://") && !/^\/videos\/(?!s\/|c\/)./.test(l)); }
    }
  }
  assert.equal((await get(ctxFor({}, { basePath: "" }), "find", "?q=abc")).headers.get("location"), "/s/abc");
  assert.equal((await get(ctxFor({}, { basePath: null }), "find", "?q=abc")).status, 404);
});
