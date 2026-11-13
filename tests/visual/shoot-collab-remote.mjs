// Captures of the collaboration card on the Bot tab of the remote control (phone 390 px and OBS dock 280 px, light and dark), not run by npm test. The REAL bot and the REAL remote page, invented data.
//   cd $CURIOSA_DIR && node --import ./tests/helpers/register.mjs <this repository>/tests/visual/shoot-collab-remote.mjs <output folder>
import fs from "node:fs";
import path from "node:path";
import { browser, closeBrowser, serve } from "../helpers/dockBrowser.mjs";
import { remoteWorld, audDef } from "../helpers/botRemoteWorld.mjs";

const OUT = path.resolve(process.argv[2] ?? "."); fs.mkdirSync(OUT, { recursive: true });
const b = await browser(); if (!b) throw new Error("Chromium or Playwright not available");
for (const [name, width, height, dock] of [["phone-390", 390, 900, false], ["dock-280", 280, 760, true]]) for (const scheme of ["light", "dark"]) for (const locale of ["en", "fr"]) {
  if (locale === "fr" && scheme === "dark") continue;
  const w = await remoteWorld({ locale }), srv = await serve(audDef, w.aud);
  const ctx = await b.newContext({ viewport: { width, height }, colorScheme: scheme, locale: locale === "fr" ? "fr-FR" : "en-US" }), page = await ctx.newPage();
  await page.goto(`${srv.base}/m/audience/remote?k=${w.key}${dock ? "&dock=1" : ""}&scheme=${scheme}`);
  await page.waitForSelector(".tab"); await page.click('[data-tab^="p:id-bot"]'); await page.waitForSelector(".tg");
  const shot = (n) => page.screenshot({ path: path.join(OUT, `${n}-${name}-${scheme}-${locale}.png`) });
  const card = '.tg[data-in$=":tg1"]';
  await shot("1-off-default-prepared");
  await page.locator(".sgb").nth(3).click(); await page.waitForTimeout(700);
  await shot("2-off-one-in-5-prepared");
  await page.locator(card).click(); await page.waitForSelector(card + '[aria-checked="true"]'); await page.waitForTimeout(500);
  await shot("3-on-one-in-5-active");
  await page.locator(".sgb").nth(0).click(); await page.waitForTimeout(700);
  await page.locator(".tgw", { has: page.locator(card) }).locator(".qm").click(); await page.locator(".mo summary").click(); await page.waitForTimeout(300);
  await shot("4-on-paused-all-open");
  await ctx.close(); await srv.close();
}
await closeBrowser();
