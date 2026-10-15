// Garde SRP (une responsabilité par module, un propriétaire par donnée) : ce qui doit rester vrai quand on ajoute un module.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { assertNoSrpViolations, findSrpViolations } from "./helpers/builtinChecks.mjs";

const root = new URL("..", import.meta.url).pathname;
const mods = ["modules", "examples"].flatMap((group) => fs.readdirSync(path.join(root, group), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => {
  const dir = path.join(root, group, e.name);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "module.json"), "utf8"));
  const code = fs.readdirSync(dir).filter((f) => /\.m?js$/.test(f)).map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
  return { id: manifest.id, manifest, code };
}));

// Listes blanches : une entrée = une exception EXPLIQUÉE, à retirer quand la cause disparaît. Vides aujourd'hui sur dev.
// (Si un autre module viole une règle avant d'être corrigé par sa propre branche : l'ajouter ici avec le commentaire « à retirer quand <branche> est fusionnée ».)
const SAME_TOOL_NAME_OK = new Map(); // nom d'outil MCP → raison
const SAME_COLLECTION_OK = new Map(); // nom de collection → raison

test("SRP : aucun nom d'outil MCP n'est déclaré par deux modules (une IA ne doit jamais hésiter entre deux outils du même nom)", () => {
  const owners = new Map();
  for (const m of mods) for (const t of m.manifest.mcp ?? []) owners.set(t.name, [...(owners.get(t.name) ?? []), m.id]);
  for (const [name, who] of owners) if (who.length > 1) assert.ok(SAME_TOOL_NAME_OK.has(name), `outil « ${name} » déclaré par ${who.join(" et ")} : un seul propriétaire, ou une exception expliquée dans la liste blanche`);
});

test("SRP : une collection de données de même nom n'existe que dans un module, ou chez un fournisseur et son consommateur", () => {
  const collections = (code) => new Set([...code.matchAll(/(?:store\.(?:add|list|count)|\ball)\(\s*(?:ctx,\s*)?"([A-Za-z]+)"/g)].map((x) => x[1]));
  const offeredBy = (service) => mods.filter((m) => (m.manifest.offers ?? []).some((o) => o.service === service)).map((m) => m.id);
  const related = (a, b) => [[a, b], [b, a]].some(([x, y]) => (x.manifest.requires ?? []).some((r) => offeredBy(r.service).includes(y.id)));
  const seen = new Map();
  for (const m of mods) for (const c of collections(m.code)) seen.set(c, [...(seen.get(c) ?? []), m]);
  for (const [name, who] of seen) {
    for (let i = 0; i < who.length; i++) for (let j = i + 1; j < who.length; j++) {
      assert.ok(SAME_COLLECTION_OK.has(name) || related(who[i], who[j]), `collection « ${name} » utilisée par ${who[i].id} et ${who[j].id}, qui ne sont ni fournisseur ni consommateur l'un de l'autre`);
    }
  }
});

test("SRP : un service n'est offert que par un seul module du dépôt (le cœur gère les doublons d'installation, pas ce dépôt)", () => {
  const owners = new Map();
  for (const m of mods) for (const o of m.manifest.offers ?? []) owners.set(o.service, [...(owners.get(o.service) ?? []), m.id]);
  for (const [service, who] of owners) assert.equal(who.length, 1, `service « ${service} » offert par ${who.join(" et ")}`);
});

test("SRP : Contacts possède les personnes, Partenariats ne garde que des références (aucune coordonnée, aucun outil qui écrit dans le carnet)", () => {
  const contacts = mods.find((m) => m.id === "contacts"), partnerships = mods.find((m) => m.id === "partnerships");
  assert.ok((partnerships.manifest.requires ?? []).some((r) => r.service === "contact.book"));
  const tools = (partnerships.manifest.mcp ?? []).map((t) => t.name);
  assert.ok(!tools.some((n) => /^contacts?_/.test(n)), "Partenariats n'expose aucun outil de personne : seuls partner_link_contact / partner_unlink_contact");
  assert.ok(!(contacts.manifest.mcp ?? []).some((t) => /^partners?_/.test(t.name)), "Contacts n'a aucun outil de prospection");
  assert.ok(!/partner|prospect|brand|marque/i.test(contacts.code.replace(/"partnerships"|source_partnerships|partnerships/g, "")), "Contacts ne connaît pas la prospection (hors le libellé d'origine « partenariats »)");
  // Partenariats n'écrit des personnes que via le service (« contacts » = seulement la restauration de l'ancien carnet par « Annuler la fusion »)
  const writes = [...partnerships.code.matchAll(/store\.add\("([A-Za-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(writes)].sort(), ["contacts", "journal", "legacyContacts", "meta", "partners"]);
  for (const m of mods) if (m.id !== "contacts") assert.ok(!/store\.(?:add|list)\("notes"/.test(m.code) || m.id === "contacts", `${m.id} ne réimplémente pas les notes de Contacts`);
});

test("SRP : Statistiques de la communauté collecte et garde les chiffres, sans en fournir ; chaque module de réseau reste propriétaire des siens", () => {
  const stats = mods.find((m) => m.id === "community-stats");
  assert.ok(stats, "module présent");
  assert.deepEqual((stats.manifest.consumes ?? []).map((c) => c.topic), ["social.stat"]);
  assert.deepEqual(stats.manifest.provides ?? [], [], "il ne republie rien : les chiffres restent à leur propriétaire");
  assert.ok((stats.manifest.mcp ?? []).every((t) => (t.name.startsWith("community_stats_") || t.name === "stats_set_manual") && t.default === false));
  for (const m of mods) if (m.id !== "community-stats") assert.ok(!(m.manifest.mcp ?? []).some((t) => t.name.startsWith("community_stats_") || t.name === "stats_set_manual"), `${m.id} n'expose pas d'outil de statistiques de la communauté`);
  for (const m of mods) if (m.id !== "community-stats") assert.ok(!/communityStats|communitySamples|communityRun/.test(m.code), `${m.id} n'écrit pas dans les collections de Statistiques de la communauté`);
});

// ── Statistiques des réseaux (« social.stat ») : chaque module publie SES chiffres, un seul parle à chaque plateforme ──────────────────

test("SRP : aucun secret n'est demandé en double par deux modules sans lien de service (clé YouTube, secret Twitch… un seul propriétaire)", () => {
  assertNoSrpViolations(mods.map((m) => m.manifest));
  // la règle voit bien une duplication (garde de la garde)
  const dup = findSrpViolations([{ id: "a", settings: [{ key: "clientSecret", type: "secret" }] }, { id: "b", settings: [{ key: "clientSecret", type: "secret" }] }]);
  assert.deepEqual(dup.map((v) => v.rule), ["secret"]);
});

test("SRP : seul le module Chaîne Twitch parle à Twitch (adresses, jetons, connexion) ; les autres passent par son service", () => {
  for (const m of mods) {
    if (m.id === "twitch-channel") continue;
    assert.ok(!/(?:id|api)\.twitch\.tv|oauth2\/(?:token|authorize|revoke|validate)|helix\//.test(m.code), `${m.id} parle à Twitch : passez par le service twitch.live`);
    assert.ok(!/twitchConnection|twitchPending|refresh_token/.test(m.code), `${m.id} touche aux jetons Twitch`);
  }
});

test("SRP : chaque plateforme n'est appelée que par SON module (YouTube, Bluesky, Mastodon, GitHub, Discord, Reddit) ; aucun fournisseur de chiffres n'appelle un autre", () => {
  const owner = { "googleapis.com": "youtube-channel", "youtube.com/feeds": "youtube-channel", "public.api.bsky.app": "bluesky", "api.github.com": "github", "discord.com/api": "discord", "reddit.com/": "reddit" };
  for (const m of mods) {
    for (const [host, id] of Object.entries(owner)) {
      if (m.id === id) continue;
      // les URL de profil (boutons) d'autres modules peuvent citer reddit.com… : on ne regarde que les appels réseau (fetch/get)
      const calls = [...m.code.matchAll(/\b(?:fetch|get|getPublic)\(\s*[`"']([^`"']*)/g)].map((x) => x[1]);
      assert.ok(!calls.some((c) => c.includes(host)), `${m.id} appelle ${host}, qui appartient à ${id}`);
    }
  }
});

test("SRP : les fournisseurs de « social.stat » déclarent le sujet, l'implémentent, et ne le consomment pas (le collecteur est un autre module)", () => {
  const providers = mods.filter((m) => (m.manifest.provides ?? []).some((p) => p.topic === "social.stat"));
  assert.deepEqual(providers.map((m) => m.id).sort(), ["bluesky", "discord", "github", "mastodon", "reddit", "twitch-channel", "youtube-channel"]);
  for (const m of providers) {
    assert.ok(/"social\.stat"/.test(m.code), `${m.id} : exports["social.stat"] absent`);
    assert.ok(!(m.manifest.consumes ?? []).some((c) => c.topic === "social.stat"), `${m.id} ne consomme pas ses propres chiffres`);
    assert.ok(!/topics\.collect\(\s*["']social\.stat/.test(m.code), m.id);
    assert.equal(new Set(m.manifest.provides.map((p) => p.topic)).size, m.manifest.provides.length, `${m.id} : sujet déclaré deux fois`);
  }
});

test("SRP : les collections de l'enregistreur de directs (twitchLive…) appartiennent au seul module Chaîne Twitch, qui n'écrit nulle part ailleurs que dans les siennes ; les outils twitch_* ne sont déclarés que par lui", () => {
  const twitch = mods.find((m) => m.id === "twitch-channel");
  const own = new Set([...twitch.code.matchAll(/(?:store\.(?:add|list|count)|\ball|\bfirst)\(\s*(?:ctx,\s*)?"([A-Za-z]+)"/g)].map((x) => x[1]));
  for (const c of ["twitchLiveState", "twitchLiveSessions", "twitchLiveDays", "twitchLiveLists"]) assert.ok(twitch.code.includes(`"${c}"`), c);
  for (const m of mods) if (m.id !== "twitch-channel") assert.ok(!/twitchLive|twitchConnection/.test(m.code), `${m.id} touche aux données Twitch`);
  for (const c of own) assert.match(c, /^(twitch[A-Z][A-Za-z]*|adopted|borrowed)$/, `collection « ${c} » : préfixe twitch… attendu`);
  for (const m of mods) if (m.id !== "twitch-channel") assert.ok(!(m.manifest.mcp ?? []).some((t) => /^twitch_/.test(t.name)), `${m.id} n'expose pas d'outil twitch_`);
  assert.deepEqual((twitch.manifest.mcp ?? []).map((t) => t.name), ["twitch_streams", "twitch_games", "twitch_videos"]);
  assert.ok(twitch.manifest.mcp.every((t) => t.default === false && t.readOnly === true));
  // les chiffres de période sont publiés par le module Twitch, collectés (jamais calculés) par Statistiques de la communauté
  const stats = mods.find((m) => m.id === "community-stats");
  assert.ok(!/helix|twitchLive|streamNow/.test(stats.code), "le collecteur ne parle pas à Twitch et ne lit pas ses directs");
});
