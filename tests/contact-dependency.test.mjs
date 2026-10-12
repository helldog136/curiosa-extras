import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { coreHelper } from "./helpers/core.mjs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { loadModule } from "./helpers/moduleLoader.mjs";

const { useTestDb } = await coreHelper("db.mjs");
const db = await useTestDb();
const { setModuleEnabled, uninstallModule } = await import("@/core/modules/installer");
const R = await import("@/core/modules/registry");
const Dep = await import("@/core/modules/dependencies");
const { createInstance } = await import("@/core/instanceService");
const fs = await import("node:fs");
const { fileURLToPath } = await import("node:url");
const repoModules = (id) => fileURLToPath(new URL(`../modules/${id}`, import.meta.url));
const cfModule = await loadModule("modules/contact-form");
const cf = { manifest: cfModule.manifest, definition: cfModule.definition };

beforeEach(() => db.reset());
after(() => db.close());

// Installe un module depuis ce dépôt, sans réseau : ses fichiers sont copiés où le cœur les cherche, et sa ligne enregistrée
// (la cascade d'installation du fournisseur depuis le catalogue est testée par le cœur lui-même).
async function installFromRepo(id, enabled) {
  const dest = R.moduleDir(id);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(repoModules(id), dest, { recursive: true });
  const { version } = JSON.parse(fs.readFileSync(`${repoModules(id)}/module.json`, "utf8"));
  await db.prisma.module.create({ data: { id, source: "git", version, enabled } });
  R.forgetModule?.(id);
}

test("formulaire de contact → carnet : le formulaire dépend du carnet (Contacts) ; un message devient un contact à vérifier", async () => {
  await installFromRepo("contact-form", false);
  await installFromRepo("contacts", true);
  const row = await db.prisma.module.findUnique({ where: { id: "contact-form" } });
  assert.equal(row.enabled, false, "désactivé au départ");

  const on = await setModuleEnabled("contact-form", true);
  assert.equal(on.ok, true, JSON.stringify(on));

  await createInstance(db.prisma, { manifest: (await R.getModule("contacts")).manifest, nickname: "carnet", names: { fr: "Carnet" } });
  const form = await createInstance(db.prisma, { manifest: cf.manifest, nickname: "contact", names: { fr: "Contact" } });
  const consumer = (await R.getActiveInstances()).find((a) => a.instance.id === form.id);
  const fd = new FormData(); fd.set("name", "Alice"); fd.set("email", "alice@example.org"); fd.set("message", "Bonjour !");
  // la vraie route du formulaire, avec le vrai service du cœur comme `ctx.api.services`
  const ctx = fakeCtx({ key: "contact" });
  ctx.api.services.call = (service, method, args) => Dep.callService(consumer, service, method, args);
  ctx.api.mail.send = async () => ({ ok: true });
  const res = await cf.definition.routes.send(new Request("https://x.test/m/contact/send", { method: "POST", headers: { "x-forwarded-for": "7.7.7.7" }, body: fd }), ctx);
  assert.equal(res.status, 200);
  const rows = await db.prisma.moduleRecord.findMany({ where: { collection: "contacts" } });
  assert.equal(rows.length, 1);
  assert.deepEqual([JSON.parse(rows[0].data).name, JSON.parse(rows[0].data).status, JSON.parse(rows[0].data).source], ["Alice", "to_review", "contact-form"]);
  assert.equal((await db.prisma.moduleRecord.findMany({ where: { collection: "notes" } })).length, 1);

  // tant que le formulaire est actif, le carnet ne peut ni s'arrêter ni disparaître
  const off = await setModuleEnabled("contacts", false);
  assert.deepEqual([off.ok, off.error, off.detail], [false, "modules.error.requiredBy", "contact-form"]);
  assert.equal((await uninstallModule("contacts")).ok, false);
  assert.equal((await setModuleEnabled("contact-form", false)).ok, true);
  assert.equal((await setModuleEnabled("contacts", false)).ok, true);
});
