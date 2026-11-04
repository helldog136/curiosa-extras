// Écrit les deux pages de la télécommande Participation (téléphone et dock) dans un dossier, pour tests/visual/shoot-remote.cjs.
//   cd <cœur> && node --import ./tests/helpers/register.mjs <extras>/tests/visual/render-remote.mjs <dossier de sortie> [fr|en]
import fs from "node:fs";
import path from "node:path";
const out = path.resolve(process.argv[2] ?? "."), locale = process.argv[3] ?? "fr";
const ROOT = new URL("../../modules/audience", import.meta.url).pathname;
const messages = JSON.parse(fs.readFileSync(`${ROOT}/locales/${locale}.json`, "utf8"));
const C = await import(`${ROOT}/client.mjs`), R = await import(`${ROOT}/remote.mjs`);
const ctx = { locale, theme: {}, instance: { key: "audience" }, t: (k, v = {}) => String(messages[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => v[n] ?? `{${n}}`) };
fs.mkdirSync(out, { recursive: true });
for (const [name, dock] of [["phone", false], ["dock", true]]) fs.writeFileSync(path.join(out, `${name}.html`), R.remoteHtml(ctx, "cle-d-exemple", C.REMOTE_JS, { dock, nonce: "n0nce" }));
console.log("pages écrites dans", out);
