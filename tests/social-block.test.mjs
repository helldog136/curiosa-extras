// Le bloc `social` de module.json (cœur 0.7.0) : de quoi reconnaître l'adresse d'un profil SANS installer le module. Écrit par scripts/gen-social.mjs depuis la table,
// recopié par le catalogue (catalogue/index.json), et lu par le cœur (src/core/socialRecognize.ts). Quand le cœur testé ne l'a pas encore (cœur publié < 0.7.0), la partie
// « le cœur lit comme le module » est passée.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { NETWORKS, socialBlock } from "../scripts/social-networks.mjs";

const root = new URL("../", import.meta.url).pathname;
const json = (f) => JSON.parse(fs.readFileSync(`${root}${f}`, "utf8"));
const core = path.resolve(process.env.CURIOSA_DIR ?? process.cwd());
const hasCore = fs.existsSync(path.join(core, "src/core/socialRecognize.ts"));
const R = hasCore ? await import("@/core/socialRecognize") : null;

test("bloc social : chaque réseau le porte dans son module.json, identique à la table, et le catalogue le recopie", () => {
  const index = json("catalogue/index.json");
  for (const n of NETWORKS) {
    const m = json(`modules/${n.id}/module.json`);
    assert.deepEqual(m.social, socialBlock(n), n.id);
    assert.equal(m.social.name, n.name);
    assert.ok(m.social.example.fr && m.social.example.en, n.id);
    assert.deepEqual(index.modules.find((e) => e.id === n.id)?.social, m.social, `${n.id} : recopié par le catalogue`);
  }
  assert.ok(!index.modules.some((e) => e.social && !NETWORKS.some((n) => n.id === e.id)), "seuls les réseaux au gabarit portent un bloc");
});

test("bloc social : le catalogue reste petit (le cœur lit 1 Mo au plus)", () => {
  assert.ok(fs.statSync(`${root}catalogue/index.json`).size < 300_000);
});

const SAMPLES = ["monpseudo", "@monpseudo", "instagram.com/monpseudo", "https://www.instagram.com/monpseudo/?igsh=1", "https://twitter.com/monpseudo?s=20", "fb.me/monpseudo", "@nom@mastodon.social",
  "mastodon.social/@nom", "u/pseudo", "r/communaute", "https://www.reddit.com/user/pseudo", "discord.gg/abcDEF", "https://discord.com/invite/abcDEF", "monnom.bandcamp.com", "monnom",
  "https://monnom.bandcamp.com/album/x", "t.me/canal", "https://t.me/+AbC", "tiktok.com/@moi?is_from_webapp=1", "https://www.threads.com/@moi", "bsky.app/profile/nom.bsky.social", "nom.bsky.social",
  "76561198000000000", "steamcommunity.com/id/moi", "github.com/moi/depot", "https://gist.github.com/x", "open.spotify.com/artist/1a2B?si=abc", "https://www.facebook.com/groups/123",
  "https://x.com/intent/follow", "http://www.instagram.com/x", "https://user:pw@x.com/a", "javascript:alert(1)", "mon pseudo", "a".repeat(80), "", "   ", "../x", "https://evil.example/@nom"];

test("bloc social : le cœur lit le bloc comme le module lit sa propre adresse (même bouton, même adresse) pour des saisies de toute sorte", { skip: hasCore ? false : "cœur sans socialRecognize (avant 0.7.0)" }, async () => {
  for (const n of NETWORKS) {
    const m = json(`modules/${n.id}/module.json`);
    const spec = R.parseSocialSpec(m.social);
    assert.ok(spec, `${n.id} : le cœur accepte le bloc`);
    const mod = await import(`../modules/${n.id}/index.mjs`);
    for (const text of SAMPLES) {
      const own = mod.profile(text);
      const theirs = R.recognizeOne(spec, text);
      assert.deepEqual(theirs && { url: theirs.url, handle: theirs.handle, tag: theirs.tag }, own && { url: own.url, handle: own.handle, tag: own.tag }, `${n.id} : « ${text} »`);
    }
  }
});

test("bloc social : un texte collé avec plusieurs adresses est reconnu réseau par réseau, avant toute installation", { skip: hasCore ? false : "cœur sans socialRecognize (avant 0.7.0)" }, () => {
  const index = json("catalogue/index.json");
  const sources = R.socialSourcesOf(index.modules.map((e) => ({ id: e.id, social: R.parseSocialSpec(e.social) })));
  assert.equal(sources.length, 20);
  const out = R.recognizeSocial("instagram.com/moi https://www.tiktok.com/@moi?is_from_webapp=1\nmoi@piaille.fr bsky.app/profile/moi.bsky.social https://t.me/moi", sources);
  assert.deepEqual(out.map((r) => [r.kind, r.id, r.label]), [
    ["match", "instagram", "Instagram · moi"], ["match", "tiktok", "TikTok · moi"], ["match", "mastodon", "Mastodon · moi@piaille.fr"], ["match", "bluesky", "Bluesky · moi.bsky.social"], ["match", "telegram", "Telegram · moi"]]);
});
