// Garde SRP propre à ce dépôt (Contacts/Partenariats, statistiques, Twitch…). Les règles générales (noms d'outils, services, secrets, collections en double) sont dans la suite de conformité : exigence srp.single.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = new URL("..", import.meta.url).pathname;
const mods = ["modules", "examples"].flatMap((group) => fs.readdirSync(path.join(root, group), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => {
  const dir = path.join(root, group, e.name);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "module.json"), "utf8"));
  const code = fs.readdirSync(dir).filter((f) => /\.m?js$/.test(f)).map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
  return { id: manifest.id, manifest, code };
}));

test("SRP : les agendas de streams fournissent `planning.slot`, le Planning et le bot le lisent ; seul l'Agenda en ligne lit un agenda iCal et parle à son adresse ; le Planning n'affiche que", () => {
  const strip = (code) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");
  const providers = mods.filter((m) => (m.manifest.provides ?? []).some((p) => p.topic === "planning.slot")).map((m) => m.id).sort();
  assert.deepEqual(providers, ["calendar-ical", "calendar-manual"], "le Planning ne fournit plus planning.slot");
  const consumers = mods.filter((m) => (m.manifest.consumes ?? []).some((c) => c.topic === "planning.slot")).map((m) => m.id).sort();
  assert.deepEqual(consumers, ["planning", "stream-story", "twitch-bot"], "Story d'annonce lit les streams par le sujet, sans connaître aucun agenda");
  for (const id of providers) {
    const m = mods.find((x) => x.id === id);
    assert.equal(m.manifest.offers, undefined, `${id} : aucun service (deux agendas n'offrent jamais le même)`);
    assert.equal(m.manifest.requires, undefined, `${id} : utile seul, il ne dépend de personne`);
    assert.ok(!/planning(?!\.slot)/i.test(strip(m.code)), `${id} ne connaît pas le Planning`);
  }
  const planning = mods.find((m) => m.id === "planning");
  const code = strip(planning.code);
  assert.equal(planning.manifest.requires, undefined, "pas de dépendance forte");
  assert.ok(!/VEVENT|VCALENDAR|RRULE|DTSTART|\bfetch\(/.test(code), "le Planning ne lit aucun agenda et ne parle à aucun réseau");
  assert.ok(!/\bcalendar-manual\b/.test(code), "le Planning ne nomme pas un agenda");
  assert.deepEqual([...code.matchAll(/\bcalendar-ical\b/g)].length, 1, "…sauf pour semer l'instance de la migration temporaire");
  const others = mods.filter((m) => m.id !== "calendar-ical").map((m) => ({ id: m.id, code: strip(m.code) }));
  for (const m of others) assert.ok(!/VCALENDAR|BEGIN:VEVENT/.test(m.code), `${m.id} ne lit pas l'iCal : c'est l'affaire de l'Agenda en ligne`);
  const bot = mods.find((m) => m.id === "twitch-bot");
  assert.equal(bot.manifest.requires.some((r) => /planning|calendar/.test(r.service)), false, "le bot ne dépend d'aucun agenda");
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
