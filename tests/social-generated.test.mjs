// Le gabarit « adresse de votre profil » des 20 modules de réseau est ÉCRIT UNE SEULE FOIS (scripts/social-networks.mjs) :
//   • ANTI-COPIE : le bloc d'adresse de chaque `index.mjs`, son réglage `profile`, sa description et sa ligne de README sont exactement ce que la table produit ;
//     une `profile()` modifiée à la main, ou recopiée d'un autre module, fait échouer ce test ;
//   • TOLÉRANCE : les collages réels (sans https, avec www., @nom@serveur, fb.me, paramètres de suivi) donnent le même bouton que le nom seul.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { NETWORKS, BEGIN, END, renderBlock } from "../scripts/social-networks.mjs";
import { analyzeModule } from "./helpers/ergonomics.mjs";

const root = new URL("../", import.meta.url).pathname;
const read = (id, f) => fs.readFileSync(`${root}modules/${id}/${f}`, "utf8");
const json = (id, f) => JSON.parse(read(id, f));
const mod = (id) => import(`../modules/${id}/index.mjs`);
const link = async (id, value) => (await mod(id)).default.exports["social.link"]({ setting: (k) => (k === "profile" ? value : undefined) });

test("anti-copie : la table couvre les 20 modules de réseau au gabarit, et eux seuls ont un bloc généré", () => {
  const withBlock = fs.readdirSync(`${root}modules`).filter((id) => fs.existsSync(`${root}modules/${id}/index.mjs`) && read(id, "index.mjs").includes(BEGIN));
  assert.deepEqual(withBlock.sort(), NETWORKS.map((n) => n.id).sort());
  assert.equal(NETWORKS.length, 20);
});

test("anti-copie : tout ce que la table écrit est à jour (node scripts/gen-social.mjs --check)", () => {
  const r = spawnSync(process.execPath, [`${root}scripts/gen-social.mjs`, "--check"], { encoding: "utf8", cwd: root });
  assert.equal(r.status, 0, `${r.stderr}${r.stdout}`);
});

test("anti-copie : une seule définition de profile() par module, dans le bloc généré, identique à celle de la table", () => {
  for (const n of NETWORKS) {
    const src = read(n.id, "index.mjs");
    assert.equal(src.split("export function profile(").length - 1, 1, `${n.id} : une seule profile()`);
    const a = src.indexOf(BEGIN), b = src.indexOf(END);
    assert.ok(a >= 0 && b > a, `${n.id} : bloc généré présent`);
    assert.equal(src.slice(a, b + END.length), renderBlock(n), `${n.id} : le bloc a été modifié à la main`);
    assert.ok(!/function profile\b/.test(src.slice(0, a) + src.slice(b)), `${n.id} : aucune profile() hors du bloc`);
  }
});

test("textes : même libellé, même aide courte avec exemple, aucun « identifiant », pour les 20 réseaux (FR et EN à parité)", () => {
  for (const n of NETWORKS) {
    const m = json(n.id, "module.json");
    const f = m.settings.find((s) => s.key === "profile");
    assert.deepEqual(f.label, { en: "Your profile address", fr: "Adresse de votre profil" }, n.id);
    assert.ok(f.help.fr.length <= 60 && f.help.en.length <= 60, `${n.id} : aide courte`);
    assert.match(f.example.fr, /^https:\/\//, n.id);
    assert.ok(f.example.en, n.id);
    assert.equal(m.minCore, "0.6.0", `${n.id} : l'exemple sous le champ est une fonction du cœur 0.6.0`);
    assert.ok(!/identifiant/i.test(JSON.stringify(m.settings) + JSON.stringify(m.description)), n.id);
    assert.ok(!/Ajoutez-en un/.test(m.description.fr), `${n.id} : la description n'est pas un mode d'emploi`);
    // l'exemple du module est lui-même reconnu : sinon l'exemple induirait en erreur
    assert.ok(n.example[0].startsWith("https://"), n.id);
  }
});

test("textes : le kit d'ergonomie ne trouve plus rien sur le réglage « profile » des 20 réseaux", () => {
  for (const n of NETWORKS) {
    const locales = Object.fromEntries(["fr", "en"].filter((l) => fs.existsSync(`${root}modules/${n.id}/locales/${l}.json`)).map((l) => [l, json(n.id, `locales/${l}.json`)]));
    const gaps = analyzeModule({ id: n.id, manifest: json(n.id, "module.json"), locales }).filter((g) => /setting:profile|description/.test(JSON.stringify(g)));
    assert.deepEqual(gaps, [], n.id);
  }
});

/* ───────────── Les collages réels ───────────── */
const CASES = {
  instagram: [
    ["monpseudo", "Instagram · monpseudo", "https://www.instagram.com/monpseudo/"],
    ["@monpseudo", "Instagram · monpseudo", "https://www.instagram.com/monpseudo/"],
    ["instagram.com/monpseudo", "Instagram · monpseudo", "https://www.instagram.com/monpseudo/"],
    ["www.instagram.com/monpseudo/", "Instagram · monpseudo", "https://www.instagram.com/monpseudo/"],
    ["https://instagram.com/monpseudo", "Instagram · monpseudo", "https://www.instagram.com/monpseudo/"],
    ["https://www.instagram.com/monpseudo/?igsh=MWxkcTRz&utm_source=qr", "Instagram · monpseudo", "https://www.instagram.com/monpseudo/"],
    ["  <https://www.instagram.com/monpseudo/>  ", "Instagram · monpseudo", "https://www.instagram.com/monpseudo/"],
  ],
  "x-twitter": [
    ["monpseudo", "X · monpseudo", "https://x.com/monpseudo"],
    ["x.com/monpseudo", "X · monpseudo", "https://x.com/monpseudo"],
    ["https://twitter.com/monpseudo?s=20&t=abcDEF", "X · monpseudo", "https://x.com/monpseudo"],
    ["https://mobile.twitter.com/monpseudo", "X · monpseudo", "https://x.com/monpseudo"],
  ],
  facebook: [
    ["fb.me/monpseudo", "Facebook · monpseudo", "https://www.facebook.com/monpseudo"],
    ["https://fb.com/monpseudo?fbclid=IwAR0", "Facebook · monpseudo", "https://www.facebook.com/monpseudo"],
    ["https://www.facebook.com/profile.php?id=100012345&mibextid=abc", "Facebook", "https://www.facebook.com/profile.php?id=100012345"],
  ],
  mastodon: [
    ["@nom@mastodon.social", "Mastodon · nom@mastodon.social", "https://mastodon.social/@nom"],
    ["nom@piaille.fr", "Mastodon · nom@piaille.fr", "https://piaille.fr/@nom"],
    ["mastodon.social/@nom", "Mastodon · nom@mastodon.social", "https://mastodon.social/@nom"],
    ["https://mastodon.social/@nom", "Mastodon · nom@mastodon.social", "https://mastodon.social/@nom"],
  ],
  bandcamp: [
    ["monnom", "Bandcamp · monnom", "https://monnom.bandcamp.com"],
    ["monnom.bandcamp.com", "Bandcamp · monnom", "https://monnom.bandcamp.com"],
    ["https://monnom.bandcamp.com/album/x", "Bandcamp", "https://monnom.bandcamp.com/album/x"],
  ],
  reddit: [
    ["u/monpseudo", "Reddit · u/monpseudo", "https://www.reddit.com/user/monpseudo"],
    ["/user/monpseudo", "Reddit · u/monpseudo", "https://www.reddit.com/user/monpseudo"],
    ["r/communaute", "Reddit · r/communaute", "https://www.reddit.com/r/communaute"],
    ["reddit.com/r/communaute/?utm_source=share", "Reddit · r/communaute", "https://www.reddit.com/r/communaute"],
    ["monpseudo", "Reddit · u/monpseudo", "https://www.reddit.com/user/monpseudo"],
  ],
  discord: [
    ["abcDEF", "Discord · abcDEF", "https://discord.gg/abcDEF"],
    ["discord.gg/abcDEF", "Discord · abcDEF", "https://discord.gg/abcDEF"],
    ["https://discord.com/invite/abcDEF", "Discord · abcDEF", "https://discord.gg/abcDEF"],
  ],
  github: [
    ["https://github.com/monpseudo?tab=repositories", "GitHub · monpseudo", "https://github.com/monpseudo"],
    ["github.com/monpseudo/depot", "GitHub", "https://github.com/monpseudo/depot"],
  ],
  telegram: [["t.me/canal", "Telegram · canal", "https://t.me/canal"], ["@canal", "Telegram · canal", "https://t.me/canal"], ["https://t.me/+AbCdEf", "Telegram", "https://t.me/+AbCdEf"]],
  tiktok: [["tiktok.com/@monpseudo?is_from_webapp=1&sender_device=pc", "TikTok · monpseudo", "https://www.tiktok.com/@monpseudo"], ["@monpseudo", "TikTok · monpseudo", "https://www.tiktok.com/@monpseudo"]],
  threads: [["threads.net/@monpseudo", "Threads · monpseudo", "https://www.threads.net/@monpseudo"], ["https://www.threads.com/@monpseudo", "Threads · monpseudo", "https://www.threads.net/@monpseudo"]],
  bluesky: [["bsky.app/profile/nom.bsky.social", "Bluesky · nom.bsky.social", "https://bsky.app/profile/nom.bsky.social"], ["nom.bsky.social", "Bluesky · nom.bsky.social", "https://bsky.app/profile/nom.bsky.social"]],
  spotify: [["open.spotify.com/artist/1a2B?si=abcdef", "Spotify", "https://open.spotify.com/artist/1a2B"]],
  steam: [["76561198000000000", "Steam", "https://steamcommunity.com/profiles/76561198000000000"], ["steamcommunity.com/id/monpseudo", "Steam · monpseudo", "https://steamcommunity.com/id/monpseudo"]],
};

test("collages réels : même bouton, même adresse, quelle que soit la façon de coller", async () => {
  for (const [id, rows] of Object.entries(CASES)) {
    for (const [pasted, label, url] of rows) {
      const out = await link(id, pasted);
      assert.equal(out.length, 1, `${id} : « ${pasted} » devrait être reconnu`);
      assert.deepEqual([out[0].label, out[0].url], [label, url], `${id} : « ${pasted} »`);
    }
  }
});

test("collages réels : le même compte donne toujours la même adresse (le cœur écarte alors le doublon)", async () => {
  const same = ["monpseudo", "@monpseudo", "instagram.com/monpseudo", "https://www.instagram.com/monpseudo/?igsh=1"];
  const urls = new Set((await Promise.all(same.map((v) => link("instagram", v)))).map((r) => r[0].url));
  assert.equal(urls.size, 1);
});

test("collages réels : ce qui n'est pas ce réseau reste refusé (autre site, http, identifiants, port, javascript:, texte avec espaces)", async () => {
  const bad = ["http://www.instagram.com/x", "https://user:pw@www.instagram.com/x", "https://www.instagram.com.evil.example/x", "evil.example/instagram.com/x", "javascript:alert(1)", "data:text/html,x", "mon pseudo", "Instagram : monpseudo", "https://www.facebook.com/x"];
  for (const v of bad) assert.deepEqual(await link("instagram", v), [], v);
  assert.deepEqual(await link("mastodon", "http://mastodon.social/@a"), []);
  assert.deepEqual(await link("mastodon", "https://mastodon.social/about"), []);
  assert.deepEqual(await link("mastodon", "mastodon.social:8443/@a"), []);
  assert.deepEqual(await link("github", "https://github.com.evil.example/x"), []);
});

test("collages réels : les pages du site qui ne sont pas un profil ne deviennent pas un nom de compte", async () => {
  assert.equal((await link("instagram", "https://www.instagram.com/p/Cabc123/"))[0].label, "Instagram");
  assert.equal((await link("x-twitter", "https://x.com/intent/follow?screen_name=a"))[0].label, "X");
  assert.equal((await link("facebook", "https://www.facebook.com/groups/123"))[0].label, "Facebook");
});
