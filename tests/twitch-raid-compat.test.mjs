// Raid Twitch 2.2 — NON-RÉGRESSION DU DOCK : le dock existant (page, liste « live », « au hasard » « pick », page refusée) doit rester STRICTEMENT identique à celui de la 2.1,
// même quand les nouveaux réglages (sélection du moment, page publique, exclusions…) sont réglés. Les « empreintes » viennent de la 2.1 (tests/helpers/twitch-raid-golden.mjs,
// enregistrées avec RAID_GOLDEN=print RAID_GOLDEN_FILE=… sur le code d'AVANT). Contacts et Twitch sont des doubles.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { world, logins, manifest, en } from "./helpers/twitch-raid-world.mjs";
import { GOLDEN } from "./helpers/twitch-raid-golden.mjs";

const def = (await import("../modules/twitch-raid/index.mjs")).default;
const data = await import("../modules/twitch-raid/data.mjs");
const live = await import("../modules/twitch-raid/live.mjs");
const search = await import("../modules/twitch-raid/search.mjs");
const source = await import("../modules/twitch-raid/source.mjs");

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 32);
const norm = (html, k, ctx) => html.replace(/nonce="[^"]+"/g, 'nonce="N"').replaceAll(encodeURIComponent(k), "K").replaceAll(`/m/${ctx.instance.key}/`, "/m/KEY/");
const NEW_SETTINGS = { count: 7, duration: 30, smallFirst: true, exclude: "membre_0001\nmembre_0002", publicPage: true, pageTitle: "Mon titre", emptyText: "Rien", watchLabel: "Go", thumbs: true, dockMode: "list" };
const reset = () => { live.resetLive(); search.resetSearch(); source.resetSource(); };

/** Tout ce que le dock d'une 2.1 montre pour ce monde : empreintes des pages, JSON de « live » et de « pick ». */
async function snapshot(settings) {
  reset();
  const ps = logins(6);
  const w = world({ partners: ps, live: { [ps[0]]: { viewers: 40, minutes: 90, game: "Zelda" }, [ps[2]]: { viewers: 3, minutes: 5 }, [ps[4]]: { viewers: 12, minutes: 61, title: "Un <titre> & \"guillemets\"" } }, settings });
  const k = await data.dockSecret(w.ctx), base = `https://site.example.test/m/${w.ctx.instance.key}`;
  const out = {};
  const page = await def.routes.dock(new Request(`${base}/dock?k=${k}`), w.ctx);
  out.dockStatus = page.status; out.dockCsp = (page.headers.get("content-security-policy") ?? "").replace(/nonce-[^']+/g, "nonce-N");
  out.dockPage = sha(norm(await page.text(), k, w.ctx));
  const denied = await def.routes.dock(new Request(`${base}/dock?k=wrong`), w.ctx);
  out.denied = [denied.status, sha(await denied.text())];
  const lv = await (await def.routes.live(new Request(`${base}/live?k=${k}`), w.ctx)).json(); delete lv.now; delete lv.asOf;
  out.live = lv;
  const bad = await def.routes.live(new Request(`${base}/live?k=wrong`), w.ctx);
  out.liveDenied = [bad.status, await bad.json()];
  // « au hasard » (plus de 500 chaînes) : hasard fixé
  reset();
  const big = world({ partners: logins(520), live: { [logins(520)[300]]: { viewers: 9 } }, settings });
  const kb = await data.dockSecret(big.ctx);
  let i = 0; const seq = [0.11, 0.62, 0.37, 0.93, 0.28, 0.74, 0.51, 0.05];
  mock.method(Math, "random", () => seq[i++ % seq.length]);
  try {
    const bl = await (await def.routes.live(new Request(`${base}/live?k=${kb}`), big.ctx)).json(); delete bl.now; delete bl.asOf;
    const pk = await (await def.routes.pick(new Request(`${base}/pick?k=${kb}`, { method: "POST", body: JSON.stringify({ avoid: "" }) }), big.ctx)).json(); delete pk.now;
    out.bigLive = bl; out.bigPick = pk;
  } finally { mock.restoreAll(); }
  // l'ancien dock en anglais
  reset();
  const e = world({ partners: ps, live: { [ps[0]]: { viewers: 40 } }, settings, locale: "en", messages: { ...en } });
  const ke = await data.dockSecret(e.ctx);
  out.dockPageEn = sha(norm(await (await def.routes.dock(new Request(`${base}/dock?k=${ke}`), e.ctx)).text(), ke, e.ctx));
  return out;
}

test("dock 2.1 : page, liste, « au hasard », refus : identiques à l'enregistrement de la 2.1 (réglages par défaut)", async () => {
  const got = await snapshot({});
  if (process.env.RAID_GOLDEN === "print") fs.writeFileSync(process.env.RAID_GOLDEN_FILE, JSON.stringify(got));
  else assert.deepEqual(got, GOLDEN);
});

test("dock : les nouveaux réglages (mode « list » = défaut, comptes, durée, exclusions, page publique…) ne changent RIEN au dock ordinaire", async () => {
  const got = await snapshot(NEW_SETTINGS);
  if (process.env.RAID_GOLDEN !== "print") assert.deepEqual(got, GOLDEN);
});

test("le manifeste garde ce que la 2.1 déclarait (routes, permissions, besoins, outil MCP d'origine)", () => {
  assert.deepEqual(manifest.requires.map((r) => r.service), ["twitch.api", "twitch.live", "contact.book", "contact.curate"]);
  assert.ok(manifest.permissions.includes("routes") && manifest.permissions.includes("storage") && manifest.permissions.includes("admin") && manifest.permissions.includes("mcp"));
  assert.ok(manifest.mcp.some((m) => m.name === "raid_partners_live" && m.readOnly === true && m.default === false));
  for (const r of ["dock", "live", "pick"]) assert.equal(typeof def.routes[r], "function");
  assert.equal(manifest.instances, "single");
});
