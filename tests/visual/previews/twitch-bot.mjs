// Bot Twitch : l'administration des commandes (tableau unique, recherche, interrupteurs) et l'onglet Récompenses.
// Les tableaux et formulaires sont rendus par les VRAIS composants du cœur (AdminTable, AdminBlockForm). Chaîne, pseudos, partenaires et adresses sont inventés.
import fs from "node:fs";
import assert from "node:assert/strict";
import { fakeCtx } from "../../helpers/fakeCtx.mjs";
import { fakeRewardsApi } from "../../helpers/fakeRewards.mjs";
import { fakeHaBridge } from "../../helpers/fakeHaBridge.mjs";
import { world, entry, link, C, SRC, say, NOW as BOT_NOW } from "../../helpers/botWorld.mjs";

export default async function scenes({ adminFrame, messages }) {
  const es = await import("../../../modules/twitch-bot/eventsub.mjs");
  const S = await import("../../../modules/twitch-bot/state.mjs");
  const R = await import("../../../modules/twitch-bot/rewards.mjs");
  const J = await import("../../../modules/twitch-bot/redeem.mjs");
  const A = await import("../../../modules/twitch-bot/admin.mjs");
  const RA = await import("../../../modules/twitch-bot/rewardsAdmin.mjs");
  const TABS = [["use", "Commandes"], ["timers", "Timers"], ["rewards", "Récompenses"], ["settings", "Réglages"], ["sources", "Informations utilisées"], ["general", "Général"]];
  const LEAD = "Votre site répond aux commandes de votre chat Twitch, et gère timers, récompenses en points de chaîne et arrêt d'urgence.";
  const frame = (blocks, tab) => adminFrame({ title: "Bot Twitch", icon: "🤖", lead: LEAD, tabs: TABS, tab, blocks });
  // Le nom de la chaîne de démonstration est écrit dans le faux monde des tests : on le remplace par un nom neutre.
  const neutral = (html) => html.replace(/\bemma\b/gi, "chaine_demo");

  /* ───── Commandes ───── */
  const w = world({
    sponsors: [entry("p1", "atelier-aurore", "Atelier Aurore"), entry("p2", "cafe-bellevue", "Café Bellevue"), entry("p3", "papeterie-lune", "Papeterie Lune")],
    links: [link("twitch-channel", "twitch-channel", "Twitch", "https://twitch.example.org/chaine_demo"), link("youtube-channel", "youtube-channel", "YouTube", "https://video.example.org/chaine_demo"), link("instagram", "instagram", "Instagram", "https://insta.example.org/chaine_demo")],
    followers: null, settings: { cooldownGlobal: 0, cooldownUser: 0, maxPer30s: 18 },
  });
  const env = { src: await SRC.gather(w.ctx, "chaine_demo"), t: w.ctx.t, prefix: "!" };
  const ACTIVE = [
    ["discord", "Rejoignez-nous sur Discord : discord.example.org/chaine_demo"], ["so", "Allez voir {cible} sur sa chaîne.", { role: "mods" }], ["lurk", "{utilisateur} se met en mode lurk, à tout à l'heure."],
    ["merci", "Merci {cible} pour ton soutien."], ["regles", "Soyez bienveillants et respectueux, les règles sont dans le panneau sous le stream."], ["setup", "Mon matériel : liste complète sur la page Matériel du site."],
    ["boutique", "La boutique est ouverte : boutique.example.org"], ["heure", "Il est {heure Europe/Paris} chez moi."], ["bonjour", "Bonjour {utilisateur}, bienvenue dans le chat."], ["clip", "Un moment à retenir ? Proposez votre clip dans le chat."],
  ];
  const OFF = [
    ["alive", "Toujours en vie, merci de demander.", { aliases: ["a-live"] }], ["noel", "Les décorations sont de sortie ce mois-ci.", { period: { yearly: true, from: { m: 12, d: 1 }, to: { m: 12, d: 31 } } }],
    ["pc", "Mon PC : processeur et carte graphique à retrouver sur la page Matériel."], ["insta", "Les coulisses sont sur Instagram."], ["giveaway", "Un tirage au sort arrive bientôt, restez attentifs."],
  ];
  for (const [name, text, extra = {}] of ACTIVE) await C.saveCommand(w.ctx, { kind: "custom" }, { name, text, enabled: true, ...extra }, env);
  for (const [name, text, extra = {}] of OFF) await C.saveCommand(w.ctx, { kind: "custom" }, { name, text, enabled: false, ...extra }, env);
  await C.saveCommand(w.ctx, { kind: "builtin", id: "jeu" }, { name: "playing", aliases: ["queljeu"] }, env);
  await C.saveSourced(w.ctx, "partner", "p1", { enabled: true, name: "atelier-aurore" }, env);
  await C.saveSourced(w.ctx, "partner", "p2", { enabled: true, name: "cafe-bellevue" }, env);
  await C.saveSourced(w.ctx, "partner", "p3", { enabled: false, name: "papeterie-lune" }, env);
  SRC.resetSources();
  // quelques utilisations pour que les compteurs parlent
  for (const [t, o] of [["!discord", { login: "viewer_01" }], ["!setup", { login: "viewer_02" }], ["!discord", { login: "viewer_03" }], ["!regles", { login: "viewer_04" }], ["!discord", { login: "viewer_05" }]]) await say(w.ctx, t, o, BOT_NOW + Math.random() * 1e6);
  await A.panel(w.ctx, { query: {} });                                // première ouverture : le site demande à Twitch d'écouter le chat
  for (const sub of w.tw.subs) sub.status = "enabled";                  // Twitch a vérifié : l'écoute est en route
  await A.actions.check(w.ctx);
  const commands = await A.panel(w.ctx, { query: {} });

  /* ───── Récompenses ───── */
  const RNOW = BOT_NOW;
  const rworld = (o = {}) => {
    S.resetMemory(); SRC.resetSources(); R.resetRewards(); J.resetRedeem(); J.resetSims();
    const tw = fakeRewardsApi(o.tw);
    const ha = fakeHaBridge(o.ha);
    const acct = { ok: true, channel: "chaine_demo", ready: true, https: true, status: "ok", login: "chaine_demo", userId: "100", scopes: [...es.SCOPES.own, ...es.REWARD_SCOPES], wanted: [], adminPath: "/admin/instances/tw1" };
    const ctx = fakeCtx({
      key: "bot", moduleId: "twitch-bot", locale: "fr", defaultLocale: "fr", locales: ["fr", "en"], messages: messages("twitch-bot", "fr"), siteUrl: "https://site.example.org",
      settings: { onlyWhenLive: true, timezone: "Europe/Paris" }, topics: { "social.stat": [], "planning.slot": [], "social.link": [], ...ha.topics }, services: { "home-assistant.bridge": ha.methods },
      serviceInstances: {
        "twitch.api": [{ instance: "chaine_demo", name: "chaine_demo", methods: { account: (a) => (a?.slot === "bot" ? { ...acct, status: "none", userId: null, scopes: [] } : acct), wantScopes: () => ({ ok: true }), connectLink: () => ({ ok: true, url: "https://id.twitch.example.org/main" }), disconnect: () => ({ ok: true }), request: (a) => tw.request(a) } }],
        "twitch.live": [{ instance: "chaine_demo", name: "chaine_demo", methods: { status: () => ({ channel: "chaine_demo", configured: true, known: true, live: true, title: "T", game: "G", startedAt: new Date(RNOW - 3_600_000).toISOString() }) } }],
      },
    });
    ctx.can = () => true;
    return { ctx, tw, ha };
  };
  const mk = async (rw, over) => { const r = await A.actions.rewardCreate.run(rw.ctx, { title: "Rouge", cost: "500", cooldownMin: "1", prompt: "", action: "lumieres:rouge", ...over }); assert.ok(r.ok, JSON.stringify(r)); };
  const rw = rworld();
  await A.actions.rewardsEnable.run(rw.ctx, {});
  await mk(rw, { title: "Lumières rouges", action: "lumieres:rouge", cost: "500" });
  await mk(rw, { title: "Lumières vertes", action: "lumieres:vert", cost: "500" });
  await mk(rw, { title: "Parle au salon", action: "tts:lire", cost: "300" });
  await mk(rw, { title: "Un mot gentil", action: "chat:repondre", reply: "Merci {utilisateur}.", cost: "100" });
  const aspi = await A.actions.rewardCreate.run(rw.ctx, { title: "Lance l'aspirateur", cost: "1500", what: "custom", actionName: "Lancer l'aspirateur", cooldownMin: "10" });
  assert.ok(aspi.ok, JSON.stringify(aspi));
  const rows = await R.list(rw.ctx);
  await A.actions.rewardEnable.run(rw.ctx, { id: rows.find((r) => r.title === "Lumières vertes").id, enabled: "0" });
  const now = Date.now();
  for (const [i, [title, action, status, reason, user]] of [["Lumières rouges", "lumieres:rouge", "done", "ok", "viewer_01"], ["Parle au salon", "tts:lire", "refunded", "offline", "viewer_02"], ["Un mot gentil", "chat:repondre", "done", "ok", "viewer_03"], ["Lance l'aspirateur", "perso:lancer-l-aspirateur", "failed", "unmapped", "viewer_04"]].entries())
    await rw.ctx.api.store.add("redeem", { rid: `r${i}`, rewardTid: "x", title, action, user, name: user, at: now - i * 60_000, status, todo: null, reason, attempts: 1 }, { key: `r${i}` });
  const info = await A.context(rw.ctx, { declare: false });
  const rewards = await RA.blocks(rw.ctx, info);

  return {
    "commandes.webp": { html: neutral(frame(commands, "use")), h: 900, scripts: [fs.readFileSync(new URL("../../../modules/twitch-bot/adminkit.client.js", import.meta.url), "utf8")], forbid: [/\bemma\b/i] },
    "recompenses.webp": { html: neutral(frame(rewards, "rewards")), h: 1000, forbid: [/\bemma\b/i] },
  };
}
