// EXPERIMENT (branch explore/shop-module): do simultaneous buyers of the last piece ever oversell on the REAL core store (Prisma + SQLite)?
// Usage, from the Curiosa core folder (it provides the "@/core/..." loader):
//   cd ../Curiosa && CONN=default ROUNDS=150 BUYERS=30 node --import ./tests/helpers/register.mjs ../curiosa-extras/scripts/shop-real-store-stress.mjs
// CONN=default uses the production setting (a pool of connections); CONN=1 uses the core tests' single connection.
// Builds a throwaway migrated database in the system temp folder; invented data only; nothing else is touched.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const extras = path.resolve(here, "..");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "shop-stress-"));
const template = path.join(work, "template.db");
execFileSync("npx", ["prisma", "migrate", "deploy"], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: `file:${template}` }, stdio: "pipe" });
const file = path.join(work, "run.db");
fs.copyFileSync(template, file);
process.env.DATABASE_URL = `file:${file}${process.env.CONN === "1" ? "?connection_limit=1" : ""}`;

const { createStore } = await import("@/core/services/store");
const { prisma } = await import("@/core/db");
const { fakeCtx } = await import(path.join(extras, "tests/helpers/fakeCtx.mjs"));
const X = path.join(extras, "modules/shop");
const D = await import(`${X}/data.mjs`), C = await import(`${X}/cart.mjs`), S = await import(`${X}/stock.mjs`);
const en = JSON.parse(fs.readFileSync(`${X}/locales/en.json`, "utf8"));
const rounds = Number(process.env.ROUNDS ?? 100), buyers = Number(process.env.BUYERS ?? 20);
const ctx = fakeCtx({ key: "shopreal", basePath: "shop", moduleId: "shop", locale: "en", defaultLocale: "en", locales: ["en"], messages: en, settings: {} });
ctx.api.store = createStore("inst-real");

const started = Date.now();
let oversold = 0, won = 0;
for (let r = 0; r < rounds; r++) {
  const cap = 1 + (r % 3);
  const made = D.normaliseProduct({ title: `Plush ${r}`, price: "10", stockMode: "tracked", onHand: String(cap), published: "on" });
  const id = await D.saveProduct(ctx, null, made.value);
  const results = await Promise.all(Array.from({ length: buyers }, () => C.addToCart(ctx, null, { productId: id, variantId: "v1", qty: 1 }, Date.now())));
  const got = results.filter((x) => x.ok).length;
  won += got;
  if (got > cap) { oversold++; console.log(`OVERSOLD round ${r}: capacity ${cap}, ${got} buyers got it, ${(await S.readAll(ctx, id, "v1")).length} documents`); }
}
console.log(JSON.stringify({ connections: process.env.CONN ?? "default", rounds, buyers, attempts: rounds * buyers, oversoldRounds: oversold, piecesSold: won, seconds: +((Date.now() - started) / 1000).toFixed(1) }));
await prisma.$disconnect();
fs.rmSync(work, { recursive: true, force: true });
process.exit(oversold ? 1 : 0);
