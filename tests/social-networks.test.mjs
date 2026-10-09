// Modules « réseau social » : chacun fournit SEULEMENT son bouton au cœur (sujet social.link) à partir d'un identifiant ou d'une adresse de profil.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { parseManifest } from "@/core/modules/manifest";

const root = new URL("../modules/", import.meta.url).pathname;
const ids = fs.readdirSync(root).filter((id) => JSON.parse(fs.readFileSync(`${root}${id}/module.json`, "utf8")).type === "social");
const load = async (id) => ({ manifest: JSON.parse(fs.readFileSync(`${root}${id}/module.json`, "utf8")), mod: await import(`../modules/${id}/index.mjs`) });
const link = (def, profile) => def.default.exports["social.link"]({ setting: (k) => (k === "profile" ? profile : undefined) });

test("réseaux : une vingtaine de modules, chacun valide, à instances multiples, et ne fournissant que « social.link »", async () => {
  assert.ok(ids.length >= 20, ids.join(","));
  for (const id of ids) {
    const { manifest } = await load(id);
    const r = parseManifest(manifest); assert.ok(r.ok, `${id} : ${r.ok ? "" : r.error}`);
    assert.equal(manifest.instances, "multiple", id);
    assert.deepEqual(manifest.provides.map((p) => p.topic), id === "twitch-channel" || id === "youtube-channel" ? manifest.provides.map((p) => p.topic) : ["social.link"], id);
    assert.ok(manifest.provides.some((p) => p.topic === "social.link"), id);
    assert.deepEqual(manifest.permissions ?? [], id.endsWith("-channel") ? manifest.permissions : [], `${id} : aucune permission nécessaire`);
  }
});

test("réseaux : un identifiant devient l'adresse du profil, avec l'icône du réseau ; une adresse https du bon site est gardée telle quelle", async () => {
  const insta = await load("instagram");
  assert.deepEqual(await link(insta.mod, "@mon.pseudo"), [{ label: "Instagram · mon.pseudo", url: "https://www.instagram.com/mon.pseudo/", icon: "instagram" }]);
  assert.deepEqual(await link(insta.mod, "https://www.instagram.com/autre/"), [{ label: "Instagram", url: "https://www.instagram.com/autre/", icon: "instagram" }]);
  const x = await load("x-twitter");
  assert.equal((await link(x.mod, "helldog"))[0].url, "https://x.com/helldog");
  assert.equal((await link(x.mod, "https://twitter.com/helldog"))[0].url, "https://twitter.com/helldog");
  const mastodon = await load("mastodon");
  assert.equal((await link(mastodon.mod, "https://mastodon.social/@nom"))[0].url, "https://mastodon.social/@nom", "n'importe quel serveur Mastodon");
  assert.deepEqual(await link(mastodon.mod, "nom"), [], "Mastodon exige l'adresse complète");
});

test("réseaux : rien tant que ce n'est pas réglé ; adresse d'un autre site, http, identifiants dans l'adresse, javascript: et identifiants invalides refusés — pour TOUS les réseaux", async () => {
  for (const id of ids.filter((i) => !i.endsWith("-channel"))) {
    const m = await load(id);
    // Mastodon (comme tout service fédéré) accepte n'importe quel serveur https ; tous les autres exigent leur propre site.
    const anyHost = id === "mastodon";
    for (const bad of [undefined, "", "   ", "http://evil.example/x", ...(anyHost ? [] : ["https://evil.example/x"]), "javascript:alert(1)", "https://user:pw@evil.example", "pas valide!", "../x", "a".repeat(80)]) {
      assert.deepEqual(await link(m.mod, bad), [], `${id} : ${JSON.stringify(bad)}`);
    }
  }
  // un faux site qui ressemble au vrai ne passe pas
  const gh = await load("github");
  assert.deepEqual(await link(gh.mod, "https://github.com.evil.example/x"), []);
  assert.deepEqual(await link(gh.mod, "https://notgithub.com/x"), []);
  assert.equal((await link(gh.mod, "https://gist.github.com/x"))[0].url, "https://gist.github.com/x", "sous-domaine légitime");
});

test("réseaux : chaque réseau a une icône reconnue par le cœur (simple-icons) et un README", async () => {
  const si = createRequire(`${process.cwd()}/`)("simple-icons"); // les tests tournent dans le dossier du cœur, qui l'embarque
  const slugs = new Set(Object.values(si).filter((v) => v && typeof v === "object" && v.slug).map((v) => v.slug));
  for (const id of ids) {
    const { manifest, mod } = await load(id);
    assert.ok(fs.existsSync(`${root}${id}/README.md`), `${id} : README`);
    const sample = id.endsWith("-channel") ? null : (await link(mod, id === "mastodon" ? "https://mastodon.social/@a" : id === "spotify" || id === "bandcamp" ? `https://${id === "spotify" ? "open.spotify.com" : "a.bandcamp.com"}/x` : "abc"))[0];
    if (sample) assert.ok(slugs.has(sample.icon), `${id} : icône « ${sample.icon} » inconnue`);
    assert.ok(manifest.icon, id);
  }
});
