// Discord : l'adresse courte « /discord » (clé `shortLink` du module.json, cœur après 0.6.3). Le module DEMANDE, le cœur crée et tient à jour (les redirections lui appartiennent) :
// il n'y a aucun code ici. Avec un cœur qui ne connaît pas la clé (cœur publié 0.6.0), le manifeste reste valide et la clé est ignorée ; les scénarios (création, nom pris, changement
// d'adresse, option coupée) ne tournent que si le cœur testé contient `src/core/managedRedirects.ts`.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { coreHelper } from "./helpers/core.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifestOf = () => JSON.parse(fs.readFileSync(`${root}modules/discord/module.json`, "utf8"));
const core = path.resolve(process.env.CURIOSA_DIR ?? process.cwd());
const hasCore = fs.existsSync(path.join(core, "src/core/managedRedirects.ts"));
const skip = hasCore ? false : "cœur sans adresses courtes gérées (cœur publié < prochaine version) : la clé shortLink est ignorée";

const { useTestDb } = await coreHelper("db.mjs");
const db = await useTestDb();
const { parseManifest } = await import("@/core/modules/manifest");
const R = await import("@/core/modules/registry");
const { createInstance } = await import("@/core/instanceService");
const { setSetting } = await import("@/core/settings");
beforeEach(() => db.reset());
after(() => db.close());

test("manifeste : la demande est déclarée, éteinte par défaut, avec un nom modifiable sous « Plus d'options » ; le module reste valide et installable avec le cœur testé", () => {
  const m = manifestOf();
  const parsed = parseManifest(m);
  assert.equal(parsed.ok, true, parsed.error);
  assert.deepEqual(m.shortLink, { enabled: "createShortLink", name: "shortLinkName", default: "discord", target: "social.link" });
  const by = Object.fromEntries(m.settings.map((s) => [s.key, s]));
  assert.equal(by.createShortLink.type, "boolean");
  assert.equal(by.createShortLink.default, false, "éteinte par défaut : une adresse publique que personne n'a demandée ne naît pas d'une mise à jour");
  assert.equal(by.shortLinkName.type, "text");
  assert.equal(by.shortLinkName.rare, true, "le nom est replié sous « Plus d'options »");
  assert.equal(by.shortLinkName.optional, true);
  assert.ok(by.shortLinkName.example.fr && by.shortLinkName.example.en, "un exemple concret");
  assert.ok((m.provides ?? []).some((p) => p.topic === "social.link"), "la destination est le bouton du réseau");
  assert.equal(m.minCore, "0.6.0", "inchangé : un cœur sans la clé l'ignore, le bouton et les statistiques marchent comme avant");
  assert.ok(!m.permissions.includes("redirects"), "pas de nouvelle permission : un cœur plus ancien refuserait le manifeste");
});

test("textes : français et anglais, vouvoiement, libellés courts sans deux-points, aides d'une ligne", () => {
  const m = manifestOf();
  for (const key of ["createShortLink", "shortLinkName"]) {
    const s = m.settings.find((x) => x.key === key);
    for (const lang of ["fr", "en"]) {
      assert.ok(s.label[lang] && s.help[lang], `${key} ${lang}`);
      assert.ok(s.label[lang].length <= 60 && !/:/.test(s.label[lang]), `${key} libellé ${lang}`);
      assert.ok(s.help[lang].length <= 60, `${key} aide ${lang} : ${s.help[lang].length}`);
      assert.ok(!/!/.test(s.label[lang] + s.help[lang]));
    }
  }
  assert.match(m.settings.find((x) => x.key === "createShortLink").label.fr, /votre/, "vouvoiement");
});

/* ───────────── avec un cœur qui connaît la clé ───────────── */

async function install() {
  const dest = R.moduleDir("discord");
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(`${root}modules/discord`, dest, { recursive: true });
  await db.prisma.module.create({ data: { id: "discord", source: "git", version: manifestOf().version } });
  R.forgetModule?.("discord");
  const mod = await R.getModule("discord");
  const inst = await createInstance(db.prisma, { manifest: mod.manifest, names: { fr: "Discord", en: "Discord" } });
  return inst;
}
const form = (inst, entries) => { const fd = new FormData(); fd.set("id", inst.id); for (const [k, v] of entries) fd.append(k, v); return fd; };
async function admin() {
  const u = await db.prisma.user.create({ data: { email: "admin@example.org", name: "Adam", role: "admin", passwordHash: "x" } });
  globalThis.curiosaTestSession = { user: { id: u.id, sv: 0 } };
}
const save = async (inst, entries) => (await import("@/app/admin/(panel)/instances/actions")).saveInstanceSettings(null, form(inst, entries));
const managed = () => db.prisma.redirect.findMany({ where: { managedBy: { not: null } } });

test("réglage : allumé, /discord mène à l'invitation du bouton (même adresse, quelle que soit la façon de la coller)", { skip }, async () => {
  await admin();
  const inst = await install();
  assert.equal(await db.prisma.redirect.count(), 0, "rien tant que la personne n'a pas allumé");
  const ok = await save(inst, [["s__profile", "discord.gg/abcDEF"], ["s__createShortLink", "on"]]);
  assert.ok(ok.ok, JSON.stringify(ok));
  assert.match(ok.ok, /\/discord/);
  const rows = await managed();
  assert.deepEqual(rows.map((r) => [r.path, r.targetUrl, r.managedBy]), [["discord", "https://discord.gg/abcDEF", inst.id]]);
});

test("alias pris : un lien de la personne nommé /discord n'est jamais touché ; l'erreur est sous le champ, avec un exemple", { skip }, async () => {
  await admin();
  const mine = await db.prisma.redirect.create({ data: { path: "discord", targetUrl: "https://ancien.example/serveur", hits: 41 } });
  const inst = await install();
  const bad = await save(inst, [["s__profile", "discord.gg/abcDEF"], ["s__createShortLink", "on"]]);
  assert.match(bad.errors?.s__shortLinkName ?? "", /\/discord/, "sous le champ du nom, replié sous « Plus d'options » (qui s'ouvre sur une erreur)");
  assert.match(bad.errors.s__shortLinkName, /discord-2/);
  const same = await db.prisma.redirect.findUnique({ where: { id: mine.id } });
  assert.deepEqual([same.targetUrl, same.hits, same.managedBy], ["https://ancien.example/serveur", 41, null]);
  // Un autre nom, sous « Plus d'options », convient.
  const ok = await save(inst, [["s__profile", "discord.gg/abcDEF"], ["s__createShortLink", "on"], ["s__shortLinkName", "discord-fr"]]);
  assert.ok(ok.ok, JSON.stringify(ok));
  assert.deepEqual((await managed()).map((r) => r.path), ["discord-fr"]);
  assert.equal((await db.prisma.redirect.findUnique({ where: { id: mine.id } })).targetUrl, "https://ancien.example/serveur");
});

test("changement d'adresse : l'invitation change, /discord suit (même lien, mêmes compteurs) ; option coupée : l'adresse disparaît", { skip }, async () => {
  await admin();
  const inst = await install();
  await save(inst, [["s__profile", "discord.gg/abcDEF"], ["s__createShortLink", "on"]]);
  const first = (await managed())[0];
  await db.prisma.redirect.update({ where: { id: first.id }, data: { hits: 5 } });
  await save(inst, [["s__profile", "https://discord.com/invite/nouvelle"], ["s__createShortLink", "on"]]);
  const moved = (await managed())[0];
  assert.deepEqual([moved.id, moved.targetUrl, moved.hits], [first.id, "https://discord.gg/nouvelle", 5]);
  await save(inst, [["s__profile", "https://discord.com/invite/nouvelle"]]);
  assert.equal(await db.prisma.redirect.count(), 0);
});

test("le bouton de l'en-tête reste celui de Discord ; il passe par /discord seulement si « Compter les clics sur mes liens » est activé", { skip }, async () => {
  await admin();
  const inst = await install();
  await save(inst, [["s__profile", "discord.gg/abcDEF"], ["s__createShortLink", "on"]]);
  const { measuredHref } = await import("@/core/redirectMeasure");
  const Gate = await import("@/core/redirectGate");
  assert.equal(await measuredHref("https://discord.gg/abcDEF"), "https://discord.gg/abcDEF");
  await setSetting("redirects.measureLinks", true);
  Gate.invalidateRedirectGate();
  assert.equal(await measuredHref("https://discord.gg/abcDEF"), "/discord");
});
