// Garde SRP (une responsabilité par module, un propriétaire par donnée) : ce qui doit rester vrai quand on ajoute un module.
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
  // Un service « each » (chaque instance répond pour SA propre chose) est voulu chez plusieurs modules : c'est le cas de `calendar.provider`
  // (Calendrier iCal, Évènements saisis à la main, Chaîne Twitch). Tout fournisseur doit alors le déclarer « each » — sinon c'est un doublon.
  const eachEverywhere = (service) => mods.filter((m) => (m.manifest.offers ?? []).some((o) => o.service === service)).every((m) => m.manifest.offers.find((o) => o.service === service).each === true);
  for (const [service, who] of owners) assert.ok(who.length === 1 || eachEverywhere(service), `service « ${service} » offert par ${who.join(" et ")}`);
});

test("SRP : les trois fournisseurs de calendrier offrent `calendar.provider` en « each » et fournissent `calendar.event` ; le Planning n'en connaît aucun", () => {
  const providers = ["calendar-ical", "calendar-manual", "twitch-channel"];
  for (const id of providers) {
    const m = mods.find((x) => x.id === id);
    assert.deepEqual(m.manifest.offers.find((o) => o.service === "calendar.provider")?.each, true, id);
    assert.ok(m.manifest.provides.some((p) => p.topic === "calendar.event"), id);
    assert.ok(!/planning/i.test(m.code.replace(/^\s*\/\/.*$/gm, "")) || id === "twitch-channel", `${id} ne connaît pas le Planning`);
  }
  const planning = mods.find((m) => m.id === "planning");
  assert.deepEqual(planning.manifest.requires, [{ service: "calendar.provider" }]);
  assert.ok(!providers.some((id) => new RegExp(`\\b${id}\\b`).test(planning.code.replace(/^\s*\/\/.*$/gm, "").replace(/seedInstance\("calendar-ical"/, ""))), "le Planning ne nomme un fournisseur que pour semer l'instance iCal de la migration");

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
