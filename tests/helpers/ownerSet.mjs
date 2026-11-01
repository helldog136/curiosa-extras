// Le jeu de la propriétaire : 35 commandes comme sur sa capture. Prêtes : planning, playing (alias queljeu), titre (alias title), followers (masquée : pas de chiffre), uptime ;
// partenaires : trade-republic, tesla, revolut ; la commande groupée reseaux (alias liens, masquée : aucun réseau activé) ; 26 à elle : 14 actives (dont `so`, réservée à la modération)
// et 12 désactivées (dont `alive` avec l'alias `a-live`, et `movember` du 1er au 30 novembre chaque année). Six réseaux (Twitch, YouTube, Instagram, TikTok, Discord, GitHub) sans commande.
import { world, entry, link, C, SRC } from "./botWorld.mjs";

const ACTIVE = [
  ["so", "Allez voir {cible} sur sa chaîne", { role: "mods" }], ["discord", "Rejoignez-nous sur Discord : discord.example.org/emma"], ["tip", "Un petit don aide à garder la chaîne en vie."],
  ["lurk", "{utilisateur} se met en mode discret, à tout à l'heure."], ["merci", "Merci {cible} pour ton soutien."], ["regles", "Soyez bienveillants et respectueux, les règles sont dans le panneau sous le stream."],
  ["setup", "Mon matériel : liste complète sur la page Matériel du site."], ["clip", "Un moment à retenir ? Proposez votre clip dans le Discord."], ["boutique", "La boutique est ouverte : boutique.example.org"],
  ["heure", "Il est {heure Europe/Paris} chez moi."], ["musique", "La playlist du stream est sur Spotify, cherchez Emma Radio."], ["bonjour", "Bonjour {utilisateur}, bienvenue dans le chat."], ["dé", "Le dé donne {aleatoire 1-6}."], ["faq", "Les questions fréquentes sont sur la page FAQ du site."],
];
const OFF = [
  ["alive", "Toujours en vie, merci de demander.", { aliases: ["a-live"] }], ["movember", "Moustaches de rigueur ce mois-ci : mo.example.org", { period: { yearly: true, from: { m: 11, d: 1 }, to: { m: 11, d: 30 } } }],
  ["pc", "Mon PC : processeur et carte graphique à retrouver sur la page Matériel."], ["insta", "Les coulisses sont sur Instagram."], ["youtube", "Les rediffusions sont sur YouTube."], ["tiktok", "Des extraits courts sur TikTok."],
  ["giveaway", "Un tirage au sort arrive bientôt, restez attentifs."], ["sub", "Merci aux personnes abonnées, vous faites vivre la chaîne."], ["prime", "Votre abonnement offert avec Prime soutient la chaîne."], ["hydrate", "Pensez à boire de l'eau."], ["pause", "Petite pause, je reviens dans quelques minutes."], ["fin", "Le stream se termine, merci à toutes et à tous."],
];

/** Le monde de la propriétaire. `locale` : "fr" (défaut) ou "en". Rend { ctx, tw, prefix }. */
export async function ownerWorld(o = {}) {
  const w = world({
    sponsors: [entry("p1", "trade-republic", "Trade Republic"), entry("p2", "tesla", "Tesla"), entry("p3", "revolut", "Revolut")],
    links: [["twitch-channel", "Twitch", "https://twitch.tv/emma"], ["youtube-channel", "YouTube", "https://youtube.com/@emma"], ["instagram", "Instagram", "https://instagram.com/emma"], ["tiktok", "TikTok", "https://tiktok.com/@emma"], ["discord", "Discord", "https://discord.gg/emma"], ["github", "GitHub", "https://github.com/emma"]].map(([m, n, u]) => link(m, m, `${n} · emma`, u)),
    followers: null, ...o,
  });
  const env = () => ({ src: undefined, t: w.ctx.t, prefix: "!" });
  const e = { src: await SRC.gather(w.ctx, "emma"), t: w.ctx.t, prefix: "!" };
  for (const [name, text, extra = {}] of ACTIVE) await C.saveCommand(w.ctx, { kind: "custom" }, { name, text, enabled: true, ...extra }, e);
  for (const [name, text, extra = {}] of OFF) await C.saveCommand(w.ctx, { kind: "custom" }, { name, text, enabled: false, ...extra }, e);
  await C.saveCommand(w.ctx, { kind: "builtin", id: "jeu" }, { name: "playing", aliases: ["queljeu"] }, e);
  await C.saveCommand(w.ctx, { kind: "builtin", id: "titre" }, { aliases: ["title"] }, e);
  await C.saveSourced(w.ctx, "partner", "p1", { enabled: false, name: "trade-republic" }, e);
  await C.saveSourced(w.ctx, "partner", "p2", { enabled: true, name: "tesla" }, e);
  await C.saveSourced(w.ctx, "partner", "p3", { enabled: true, name: "revolut" }, e);
  SRC.resetSources();
  return { ...w, env };
}
