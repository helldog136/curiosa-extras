// Participation : ce qui va au journal du cœur (Historique). Le cœur note déjà les gestes de la page d'administration et de l'assistant : seuls les autres sont écrits ici.
import test from "node:test";
import assert from "node:assert/strict";
import { audienceCtx, def, fr, en, K, manifest } from "./helpers/audienceHarness.mjs";
import { parseManifest } from "@/core/modules/manifest";

const D = await import("../modules/audience/draw.mjs");
const R = await import("../modules/audience/remote.mjs");
const T0 = Date.now();
const FORM = { title: "Cadeau du jour", keyword: "!cadeau", level: "all", site: true, minutes: 30, winners: 1 };
const mk = (over = {}) => audienceCtx({ logEvents: manifest.logEvents, ...over });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Le journal du cœur est écrit sans faire attendre le geste : on laisse les écritures finir (la liste ne bouge plus pendant 80 ms).
const central = async (c) => { let n = -1; for (let i = 0; i < 20 && c.dumpLog().length !== n; i++) { n = c.dumpLog().length; await wait(80); } return c.dumpLog(); };
await mk().api.log.write({ action: "warm.up" });   // le premier appel charge le cœur : on le fait avant les tests
const enter = (c, name) => def.services["audience.draw"].enter(c, { pseudo: name, platform: "twitch", login: name.toLowerCase() });

test("manifeste : événements déclarés, valides, minCore inchangé (le journal du cœur est facultatif)", () => {
  const r = parseManifest(manifest); assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(manifest.minCore, "0.5.0");
  assert.ok(manifest.logEvents.length <= 30);
  assert.ok(Object.keys(fr).every((k) => k in en) && Object.keys(en).every((k) => k in fr));
});

test("page d'administration et assistant : rien de plus (le cœur les note déjà)", async () => {
  const c = mk();
  assert.ok((await D.openNew(c, FORM, { who: "admin", now: T0 })).ok);
  await enter(c, "Alice"); await enter(c, "Bruno");
  assert.ok((await D.close(c, { who: "assistant", now: T0 + 1000 })).ok);
  assert.deepEqual(await central(c), []);
  assert.ok((await c.api.store.count("audit")) >= 2, "l'ancien journal du module continue d'être écrit");
});

test("télécommande : ouverture, tirage, vidage notés sans pseudo ; le titre et un nombre seulement", async () => {
  const c = mk();
  assert.ok((await D.openNew(c, FORM, { who: "remote", now: T0 })).ok);
  await enter(c, "Alice"); await enter(c, "Bruno");
  assert.ok((await D.close(c, { who: "remote", now: T0 + 1000 })).ok);
  const p = await D.pick(c, { who: "remote", now: T0 + 2000 });
  assert.ok(p.ok);
  assert.ok((await D.clear(c, { who: "remote", now: T0 + 3000 })).ok);
  const l = await central(c);
  assert.deepEqual(l.map((x) => x.action), ["draw.opened", "draw.closed", "draw.picked", "draw.cleared"]);
  assert.deepEqual(l[0].data, { title: "Cadeau du jour" });
  assert.deepEqual(l[2].data, { count: 1 });
  assert.equal(l[3].data.removed, 2);
  assert.doesNotMatch(JSON.stringify(l), /Alice|Bruno|alice|bruno/);
});

test("un tirage qui se ferme tout seul à l'échéance est noté une fois", async () => {
  const c = mk();
  assert.ok((await D.openNew(c, FORM, { who: "admin", now: T0 })).ok);
  await D.current(c, T0 + 31 * 60_000);
  await D.current(c, T0 + 32 * 60_000);
  assert.deepEqual((await central(c)).map((x) => x.action), ["draw.closed"]);
});

test("sourdine et salle vidée : seulement si le geste ne vient pas déjà d'une action notée par le cœur", async () => {
  const c = mk();
  await K.journal(c, { who: "admin", what: "mute", room: "salle-1", detail: "Alice" });
  await K.journal(c, { who: "remote", what: "mute", room: "salle-1", detail: "Alice" });
  await K.journal(c, { who: "remote", what: "clearRoom", room: "salle-1", detail: "12" });
  await K.journal(c, { who: "admin", what: "clearRoom", room: "salle-1", detail: "3", central: true });   // venu d'une autre extension
  await K.journal(c, { who: "bot", what: "removePerson", room: "salle-1" });                              // pas d'événement du cœur pour celui-là
  const l = await central(c);
  assert.deepEqual(l.map((x) => [x.action, x.target, x.data ?? null]), [["person.muted", "salle-1", {}], ["room.cleared", "salle-1", { removed: 12 }], ["room.cleared", "salle-1", { removed: 3 }]]);
  assert.doesNotMatch(JSON.stringify(l), /Alice/);
});

test("les manches des autres extensions restent dans l'ancien journal (elles écrivent chacune au journal du cœur sous leur nom)", async () => {
  const c = mk();
  const svc = def.services["audience.session"];
  for (const what of ["round.start", "round.decision", "round.stop"]) await svc.journal(c, { who: "bot", what });
  assert.deepEqual(await central(c), []);
  assert.equal(await c.api.store.count("audit"), 3);
});

test("un bouton de la télécommande qui échoue est noté (module et geste, jamais le texte) ; un succès ne l'est pas", async () => {
  const methods = {
    describe: async () => ({ ok: true, panel: { title: "Sondages", state: { text: "Rien", tone: "idle" }, buttons: [{ id: "start", label: "Lancer" }] } }),
    press: async (a) => (a.action === "start" ? { ok: true, message: "C'est lancé." } : { ok: false, error: "invalid", message: "Texte du public à ne pas garder" }),
  };
  const c = mk({ serviceInstances: { "audience.remote": [{ instance: "polls", name: "Sondages", methods }] } });
  const [panel] = await R.collectPanels(c);
  assert.ok(panel);
  assert.equal((await R.pressPanel(c, { panel: panel.id, action: "start", values: {} })).ok, true);
  assert.deepEqual(await central(c), []);
  assert.equal((await R.pressPanel(c, { panel: panel.id, action: "quick", values: {} })).ok, false);
  const l = await central(c);
  assert.equal(l.length, 1); assert.equal(l[0].action, "remote.failed"); assert.equal(l[0].level, "warn");
  assert.doesNotMatch(JSON.stringify(l), /public/);
});

test("sans journal du cœur (cœur plus ancien) tout marche comme avant", async () => {
  const c = mk();
  delete c.api.log;
  assert.ok((await D.openNew(c, FORM, { who: "remote", now: T0 })).ok);
  await K.journal(c, { who: "remote", what: "mute", room: "s", detail: "x" });
});

test("la page de l'onglet « Salles » relie le journal à l'Historique", async () => {
  const c = mk();
  const blocks = await def.adminPanel(c, { query: {} });
  assert.ok(blocks.some((b) => b.type === "links" && b.items?.some((i) => i.href === "?tab=history")));
});
