// Le contrat `event.source` à l'échelle du dépôt : qui offre le service, que chaque fournisseur le fait de la même façon (une réponse par instance, lecture seule, jamais d'exception),
// et que Story d'annonce ne connaît AUCUNE source par son nom (un fournisseur de plus n'oblige à rien changer chez le consommateur).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fakeCtx } from "./helpers/fakeCtx.mjs";

const root = new URL("..", import.meta.url).pathname;
const mods = ["modules", "examples"].flatMap((group) => fs.readdirSync(path.join(root, group), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => {
  const dir = path.join(root, group, e.name);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "module.json"), "utf8"));
  const code = fs.readdirSync(dir).filter((f) => /\.m?js$/.test(f)).map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
  return { id: manifest.id, dir, manifest, code };
}));
const strip = (code) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");
const providers = mods.filter((m) => (m.manifest.offers ?? []).some((o) => o.service === "event.source"));

test("fournisseurs : Chaîne YouTube et Ma Chaîne Twitch offrent `event.source` (version 1, une réponse par instance, lecture seule) ; personne d'autre ne l'offre sans le déclarer de même", () => {
  assert.deepEqual(providers.map((m) => m.id).sort(), ["twitch-channel", "youtube-channel"]);
  for (const m of providers) {
    const offer = m.manifest.offers.find((o) => o.service === "event.source");
    assert.deepEqual([offer.version, offer.each, offer.readOnly], [1, true, ["upcoming"]], `${m.id} : même déclaration pour tous (le service est « each » : plusieurs fournisseurs voulus)`);
    assert.ok(offer.label?.fr && offer.label?.en, `${m.id} : libellé FR + EN`);
    assert.equal(m.manifest.instances, "multiple", `${m.id} : une réponse par chaîne`);
  }
});

test("fournisseurs : chacun répond sans exception à n'importe quel argument, avec le contrat commun (ok, source, state, events)", async () => {
  for (const m of providers) {
    const def = (await import(`../modules/${m.id}/index.mjs`)).default;
    const upcoming = def.services["event.source"]?.upcoming;
    assert.equal(typeof upcoming, "function", m.id);
    const fr = JSON.parse(fs.readFileSync(`${m.dir}/locales/fr.json`, "utf8"));
    for (const args of [undefined, null, {}, { limit: -4 }, { limit: "beaucoup" }, { limit: 1e9 }, "texte", 42, [], { from: "pas une date", to: {} }]) {
      const r = await upcoming(fakeCtx({ key: m.id, moduleId: m.id, locale: "fr", messages: fr, settings: {} }), args);
      assert.equal(r.ok, true, `${m.id} ${JSON.stringify(args)}`);
      assert.match(r.source.kind, /^[a-z][a-z0-9-]{0,19}$/); assert.ok(r.source.label.length >= 1 && r.source.label.length <= 40);
      assert.ok(["ok", "setup", "down"].includes(r.state)); assert.ok(Array.isArray(r.events) && r.events.length <= 50);
      if (r.state === "setup") assert.ok(r.message && r.message.length <= 240 && !/^events_/.test(r.message), "une phrase pour la personne, pas une clé");
    }
  }
});

test("consommateur : Story d'annonce demande `event.source` en besoin FACULTATIF et ne nomme aucune source, aucun module de fournisseur ni leur service", () => {
  const story = mods.find((m) => m.id === "stream-story");
  assert.deepEqual(story.manifest.requires.filter((r) => r.service === "event.source").map((r) => [r.min, r.optional]), [[1, true]]);
  const code = strip(story.code);
  for (const name of ["youtube-channel", "twitch-channel", "youtube-connector", "twitch-connector", "calendar-ical", "calendar-manual", "youtube.api", "twitch.api", "twitch.live"]) assert.ok(!code.includes(name), `Story ne connaît pas « ${name} »`);
  assert.equal(story.manifest.offers.some((o) => o.service === "event.source"), false, "Story ne fournit pas ce qu'elle consomme");
  assert.deepEqual(story.manifest.consumes.map((c) => c.topic), ["planning.slot"], "les agendas passent toujours par leur sujet");
  assert.ok(/ctx\.api\.services\.call\(E\.SERVICE/.test(story.code), "un appel séparé et borné par source");
});

test("fournisseurs : ils ne connaissent ni Story ni l'agenda, et ne lisent les données d'aucun autre module", () => {
  for (const m of providers) {
    const code = strip(m.code);
    assert.ok(!/stream-story|story_|planning\.slot/.test(code), `${m.id} ne connaît pas ses consommateurs`);
    assert.ok(!/\bfetch\s*\(/.test(code), `${m.id} : aucun appel réseau direct (ctx.api.net seulement)`);
    assert.ok(!/setInterval\s*\(/.test(code), `${m.id} : aucun minuteur de fond`);
  }
  assert.deepEqual(mods.filter((m) => (m.manifest.consumes ?? []).some((c) => c.topic === "event.source")).map((m) => m.id), [], "ce n'est pas un sujet : un service");
});

test("documentation : le contrat est décrit dans le README du dépôt, celui de Story et ceux des fournisseurs ; les connecteurs disent ce qu'ils laissent passer de plus", () => {
  const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
  for (const f of ["README.md", "modules/stream-story/README.md", "modules/youtube-channel/README.md", "modules/twitch-channel/README.md"]) assert.match(read(f), /event\.source/, f);
  assert.match(read("modules/youtube-connector/README.md"), /liveStreamingDetails/); assert.match(read("modules/twitch-connector/README.md"), /GET schedule/);
  assert.match(read("modules/youtube-channel/README.md"), /privée/, "la limite de YouTube est dite");
});
