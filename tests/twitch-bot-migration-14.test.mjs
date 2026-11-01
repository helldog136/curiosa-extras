// Bot Twitch 1.4.0 → 1.5.0 (données 3 → 4) rejoué sur un état produit par le VRAI code 1.4.0 (extrait de l'étiquette de la dernière version publiée) :
// 30 commandes comme celles de la propriétaire (texte avec {jeu}, alias, rôle « tout le monde », la moitié désactivée), des récompenses, des actions nommées, l'état.
// Rien ne se perd, et chaque commande répond (ou se tait) EXACTEMENT comme avant.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { world, NOW, S, SRC, chat } from "./helpers/botWorld.mjs";
import { extractRelease, publishedTags, versionsAt } from "./helpers/hotUpdate.mjs";
import { makeTempDir } from "./helpers/tmp.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const REPO = process.env.CURIOSA_EXTRAS_DIR ?? path.join(here, "..");
const def = (await import("../modules/twitch-bot/index.mjs")).default;
const E = await import("../modules/twitch-bot/engine.mjs");

// La version 1.4.0 du Bot Twitch : l'étiquette la plus récente où le module est EN 1.4.0 (et non « la plus récente qui n'est pas 1.5.0 » : une étiquette
// publiée plus tard, avec le Bot Twitch en 1.6.0, ferait sinon échouer ce test dès que l'étiquette existe).
function oldRelease() {
  const { tags } = publishedTags(REPO);
  return tags.find((tag) => versionsAt(REPO, tag).get("twitch-bot") === "1.4.0") ?? null;
}
const TAG = oldRelease();
const skip = TAG ? false : (process.env.HOT_UPDATE_REQUIRE_HISTORY === "1" ? false : "historique git des étiquettes absent");

const imp = (dir, f) => import(`${pathToFileURL(path.join(dir, f)).href}?v=1.4.0`);
const NAMES = ["regles", "discord", "lurk", "jeu2", "merci", "sub", "bonjour", "clip", "planning2", "boutique", "youtube", "tiktok", "insta", "faq", "rules", "hydrate", "pause", "gg", "bienvenue", "followage2", "heure", "setup", "pc", "musique", "sons", "wizz", "roulette", "quoi", "uptime2", "social"];

test("migration 3 → 4 sur un état 1.4.0 réel : 30 commandes (alias, désactivées, {jeu}), récompenses, actions nommées, état : rien ne se perd, mêmes réponses", { skip }, async (t) => {
  assert.ok(TAG, "HOT_UPDATE_REQUIRE_HISTORY=1 : l'étiquette du Bot Twitch 1.4.0 doit exister");
  const dir = makeTempDir("bot14-", { t });
  extractRelease(REPO, TAG, "twitch-bot", path.join(dir, "old"));
  const oldDir = path.join(dir, "old");
  assert.equal(JSON.parse((await import("node:fs")).readFileSync(path.join(oldDir, "module.json"), "utf8")).dataVersion, 3);
  const oldTools = (await imp(oldDir, "tools.mjs")).default, oldE = await imp(oldDir, "engine.mjs"), oldA = await imp(oldDir, "actions.mjs"), oldS = await imp(oldDir, "state.mjs");

  const { ctx, tw } = world({ settings: { maxPer30s: 100 } });
  // ── 1. L'état tel que 1.4.0 le fabrique ──
  const spec = NAMES.map((name, i) => ({
    name, enabled: i % 2 === 0,   // 15 désactivées
    text: i % 3 === 0 ? `On joue à {jeu} ! (${name}) Merci {utilisateur}` : i % 3 === 1 ? `Texte fixe de ${name}, bienvenue.` : `Hello {utilisateur}, le jeu du moment : {jeu}`,
    aliases: i % 4 === 0 ? [`${name}x`, `a${name}`] : [], role: "everyone",
  }));
  for (const c of spec) await oldTools.bot_command_create(ctx, c);
  const s = {};
  const plan = await oldA.plan(ctx, s, "Allumer le salon"); await oldA.commit(ctx, plan);
  const plan2 = await oldA.plan(ctx, s, "Lancer la musique"); await oldA.commit(ctx, plan2);
  await ctx.api.store.add("reward", { tid: "tw-r1", title: "Hydratez-vous", cost: 100, cooldown: 60, prompt: "", needsInput: false, action: "chat:repondre", reply: "Glou glou {utilisateur}", pause: null, gone: false, refused: null });
  await ctx.api.store.add("reward", { tid: "tw-r2", title: "Salon", cost: 500, cooldown: 0, prompt: "", needsInput: false, action: plan.action.key, reply: "", pause: "auto", gone: false, refused: null });
  await oldS.ensureSecret(ctx); await oldS.updateState(ctx, (d) => { d.verifiedAt = 1234; d.lastMessageAt = 5678; d.sub = { code: "ok", at: 9 }; });
  await oldA.noteLink(ctx, plan.action.key, "ok"); await oldA.noteLink(ctx, plan2.action.key, "unmapped");
  await oldS.addLog(ctx, { user: "ada", command: "regles", result: "sent", reason: "ok" });
  await oldS.setCounter?.(ctx, "morts", 12);

  // ── 2. Ce que 1.4.0 répond, commande par commande ──
  const run = async (engine, base) => {
    const out = {};
    let k = 0;
    for (const c of spec) for (const word of [c.name, ...c.aliases]) {
      tw.chat.length = 0;
      const r = await engine.processChat(ctx, chat(`!${word}`, { messageId: `m${base}-${k}`, chatterId: `u${base}-${k}`, login: `user${k}`, name: `User${k}`, badges: [] }), { now: NOW + (base + k++) * 40_000 });
      out[word] = { handled: !!r?.handled, result: r?.result ?? null, said: tw.chat.map((m) => m.message) };
    }
    return out;
  };
  const before = await run(oldE, 0);
  const answered = Object.values(before).filter((x) => x.said.length).length;
  assert.ok(answered >= 15, `1.4.0 répond bien aux commandes actives (${answered})`);
  assert.ok(spec.filter((c) => c.enabled).every((c) => before[c.name].said.length === 1), "toute commande active répond");
  assert.ok(spec.filter((c) => !c.enabled).every((c) => before[c.name].said.length === 0), "toute commande désactivée se tait");
  assert.ok(Object.values(before).some((x) => x.said.some((m) => m.includes("Zelda"))), "{jeu} est remplacé par le jeu en cours");
  const dump = async () => (await ctx.dumpStore()).map((r) => ({ collection: r.collection, key: r.key, data: structuredClone(r.data) }));
  const stored = await dump();

  // ── 3. La migration 4 (la seule qui reste à jouer de la 3 à la 4), rejouable ──
  await def.migrations[4](ctx);
  const after = await dump();
  const strip = (rows) => rows.map((r) => (r.collection === "botConfig" ? { ...r, data: Object.fromEntries(Object.entries(r.data).filter(([k]) => k !== "timers")) } : r));
  assert.deepEqual(strip(after), strip(stored), "rien n'a bougé hors la liste de timers");
  assert.deepEqual(after.find((r) => r.collection === "botConfig").data.timers, [], "liste de timers vide ajoutée");
  assert.equal(after.length, stored.length, "aucune ligne en plus ni en moins");
  await def.migrations[4](ctx);
  assert.deepEqual(await dump(), after, "rejouée : aucun changement");
  assert.equal(stored.filter((r) => r.collection === "botConfig").length, 1);
  const cfg = after.find((r) => r.collection === "botConfig").data;
  assert.equal(cfg.custom.length, 30);
  assert.equal(cfg.custom.filter((c) => c.enabled === false).length, 15);
  assert.ok(cfg.custom.every((c) => c.role === "everyone"));
  assert.deepEqual(cfg.custom.find((c) => c.name === "regles").aliases, ["reglesx", "aregles"]);

  // ── 4. Le code 1.5.0 sur ces données : mêmes réponses, mêmes silences ──
  S.resetMemory(); SRC.resetSources();
  const now = await run(E, 1000);
  assert.deepEqual(now, Object.fromEntries(Object.entries(before)), "chaque commande répond (ou se tait) comme avant, alias compris");
  // les récompenses, les actions nommées et l'état se lisent toujours
  const R = await import("../modules/twitch-bot/rewards.mjs"), A = await import("../modules/twitch-bot/actions.mjs");
  assert.deepEqual((await R.list(ctx)).map((r) => r.title).sort(), ["Hydratez-vous", "Salon"]);
  assert.deepEqual((await A.list(ctx)).map((a) => a.label).sort(), ["Allumer le salon", "Lancer la musique"]);
  const st = await S.readState(ctx);
  assert.equal(st.verifiedAt, 1234); assert.equal(st.lastMessageAt, 5678); assert.equal(A.linkOf(st, plan.action.key), "ok"); assert.equal(A.linkOf(st, plan2.action.key), "unmapped");
  // la migration 3 (déjà jouée sur 1.4.0) rejouée sur ces données n'ajoute rien non plus
  const n = await A.migrate(ctx, {}, (await R.list(ctx)).map((r) => r.action)); assert.equal(n, 0);
});
