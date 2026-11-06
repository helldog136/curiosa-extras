// Showcase seed, run AFTER the core's visual harness has seeded its demo site (see scripts/showcase-shots.mjs). INVENTED data only.
//   node --import ./tests/helpers/register.mjs -r scripts/visual/preload.cjs <this file>      (cwd = the core's source folder)
// It names the demo streamer "Etoile Nord", swaps the harness' people for invented nicknames, translates the harness' French-only demo texts,
// removes its French-only extra instances (clean admin menu), switches the admin to English, then runs scripts/showcase/demo/<module>.mjs.
// Every step is best-effort and logged.
import path from "node:path";
import fs from "node:fs";

const { prisma } = await import("@/core/db");
const { setSetting } = await import("@/core/settings");
const R = await import("@/core/modules/registry");
const { buildContext } = await import("@/core/modules/context");
const { listInstances } = await import("@/core/instances");
const { deleteInstance } = await import("@/core/instanceService");
const { MODULES_DIR } = await import("@/core/config");
const NOW = new Date(process.env.VISUAL_NOW || "2026-06-15T10:00:00.000Z");
const log = (...a) => console.log("[showcase-seed]", ...a);

const PEOPLE = {
  "Aurélie Marchand": "brume_claire", "Basile Noël": "pixel_renard", "Cléa Dufour": "sel_et_miel", "Damien Roux": "Camille", "Eloïse Vidal": "vague_douce", "Farid Benali": "petit_orage",
  "Gaëlle Perrin": "lune_douce", "Hugo Lambert": "nova_pomme", "Inès Moreau": "fil_d_argent", "Jules Garnier": "Jade", "Karine Fabre": "coin_cosy",
  "Léa Charpentier": "mousse_verte", "Mathis Colin": "Alix", "Noémie Faure": "cobalt_14",
  "Océane Bailly": "ciel_de_craie", "Paul Renard": "plume_bleue", "Quentin Maillard": "Sacha", "Rosalie Giraud": "herbe_folle", "Samir Haddad": "thym_citron", "Tessa Lemaire": "Noa", "Ulysse Poirier": "menthe_poivree", "Valentine Klein": "tempete_calme", "Wilfried Adam": "Lou", "Yasmine Orsini": "cerf_volant",
};
const slug = (n) => n.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_");
const swaps = [];
for (const [full, nick] of Object.entries(PEOPLE)) swaps.push([full, nick], [slug(full), slug(nick)], [`"${full.split(" ")[0]}"`, `"${nick}"`]);
// the harness' demo data has French-only texts: the English pictures show them in English (same sense)
const FR_EN = [["Atelier Démo", "Etoile Nord"], ["Demo Workshop", "Etoile Nord"],
  ["Exploration en direct", "Live exploration"], ["Soirée détente", "Chill evening"], ["Défi du mardi", "Tuesday challenge"], ["Discussion avec la communauté", "Chat with the community"], ["Série hebdomadaire", "Weekly series"], ["Journée caritative", "Charity day"], ["Rediffusion du dimanche", "Sunday replay"], ["Marathon de la semaine suivante", "Next week's marathon"],
  ["Ouverture de la billetterie", "Ticket sales open"], ["Lancement du nouveau projet", "New project launch"], ["Fin de la campagne de soutien", "End of the support campaign"],
  ["Un croquis noir et blanc", "A black and white sketch"], ["Illustration complète", "Full illustration"], ["Illustration couleur", "Colour illustration"], ["Fichier haute définition", "High-definition file"], ["Deux révisions", "Two revisions"], ["Une révision", "One revision"], ["Série de quatre", "Set of four"], ["Croquis", "Sketch"],
  ["Marque Alpha", "Alpha Brand"], ["Un partenaire de confiance", "A trusted partner"], ["Atelier Gamma", "Gamma Workshop"],
  ["Mécènes", "Patrons"], ["Équipe", "Team"], ["Membres", "Members"], ["Modération", "Moderators"], ["Ne pas montrer", "Do not show"],
  ["Carnet de bord : la saison commence", "Logbook: the season begins"], ["À propos", "About"],
  ["Pourquoi nous partageons nos brouillons", "Why we share our drafts"], ["Le matériel que nous utilisons", "The gear we use"], ["Prochaines étapes", "Next steps"],
  ["Résumé du billet « ", "Summary of “"], [" » : une ou deux phrases pour donner envie de lire la suite.", "”: a sentence or two to make you want to read on."],
  ["Atelier d'initiation à la gravure", "Introduction to engraving workshop"], ["Salle des fêtes, rue du Marché", "Community hall, Market Street"], ["Salle des fêtes", "Community hall"], ["Rencontre mensuelle des membres", "Monthly members' meetup"], ["Masterclass de reliure japonaise", "Japanese bookbinding masterclass"], ["Stage d'été : initiation à la céramique", "Summer course: introduction to ceramics"], ["Formation : photographier ses réalisations", "Training: photographing your work"],
  ["Quels matériaux aimeriez-vous essayer ?", "Which materials would you like to try?"], ["Quel sera le thème du prochain atelier ?", "What will the theme of the next workshop be?"], ["Quel jour vous convient le mieux ?", "Which day suits you best?"], ["Samedi", "Saturday"], ["Dimanche", "Sunday"], ["Vendredi", "Friday"],
  ["Une belle découverte, merci à toute l'équipe pour sa bienveillance et ses conseils précieux tout au long de la journée.", "A lovely discovery, thank you to the whole team for their kindness and valuable advice throughout the day."], ["Bien, mais j'aurais aimé plus de temps pour pratiquer.", "Good, but I would have liked more time to practise."], ["Parfait pour débuter. Peut-être un peu court.", "Perfect for beginners. Maybe a little short."], ["Du matériel de qualité et une équipe patiente.", "Quality equipment and a patient team."], ["Très bonne expérience, j'ai appris énormément en une demi-journée.", "Great experience, I learned a lot in half a day."], ["Un accueil formidable et des ateliers très clairs. Je recommande sans hésiter !", "A wonderful welcome and very clear workshops. I recommend it without hesitation."],
  ["12 rue de l'Exemple", "12 Example Street"], ["Le studio principal, ouvert sur rendez-vous.", "The main studio, open by appointment."], ["Café de la création", "The Maker's Café"], ["Un café où l'on se retrouve après les ateliers.", "A café where people meet after the workshops."], ["Salon des métiers d'art", "Crafts fair"], ["Rendez-vous annuel.", "Annual meeting."], ["Un atelier partenaire.", "A partner workshop."], ["Une bonne librairie.", "A good bookshop."], ["Rencontre de quartier", "Neighbourhood meetup"],
  ["Coulisses d'une exposition", "Behind the scenes of an exhibition"], ["Retour sur la saison", "Looking back at the season"], ["Questions des spectateurs", "Viewer questions"], ["Visite du studio", "Studio tour"], ["Gravure : les bases", "Engraving: the basics"], ["Présentation de l'atelier", "Presenting the workshop"], ["Démonstration d'impression", "Printing demonstration"], ["Table ronde", "Round table"],
  ["Certains liens sont sponsorisés.", "Some links are sponsored."], ["Conférence d'ouverture", "Opening talk"], ["Atelier enfants", "Kids workshop"], ["Matériel conseillé", "Recommended gear"], ["Café associatif", "Community café"],
  ["Les coulisses d'un atelier ouvert", "Behind the scenes of an open workshop"], ["Trois outils qui changent le quotidien", "Three tools that change daily life"], ["Retour sur le week-end de la création", "Looking back at the makers' weekend"], ["Un mois de petits projets", "A month of small projects"],
  ["Boutique", "Shop"], ["Journal vidéo", "Video log"], ["Plans à télécharger", "Plans to download"], ["Forum d'entraide", "Help forum"], ["Soutenir le projet", "Support the project"],
  ["Atelier de printemps", "Spring workshop"], ["Soirée de lancement", "Launch evening"], ["Journée portes ouvertes", "Open day"], ["Brouillon d'album", "Album draft"]];
const tables = await prisma.$queryRawUnsafe("select name from sqlite_master where type='table' and name not like '\\_%' escape '\\' and name not like 'sqlite%'");
let touched = 0;
for (const { name: t } of tables) {
  const cols = (await prisma.$queryRawUnsafe(`pragma table_info("${t}")`)).filter((c) => /TEXT|CHAR|JSON/i.test(c.type)).map((c) => c.name);
  for (const c of cols) for (const [from, to] of [...swaps, ...FR_EN]) {
    const n = await prisma.$executeRawUnsafe(`update "${t}" set "${c}" = replace("${c}", ?, ?) where "${c}" like ?`, from, to, `%${from.replace(/[%_]/g, "")}%`).catch(() => 0);
    touched += Number(n) || 0;
  }
}
log("text swaps:", touched);

const both = async (k, fr, en) => { await setSetting(k, fr, "fr"); await setSetting(k, en, "en"); };
await both("site.name", "Etoile Nord", "Etoile Nord");
await both("site.tagline", "Streams, jeux et communauté", "Streams, games and community");
await both("site.about", "Un site de démonstration pour **Etoile Nord**, une personne qui streame. Tout ce que vous voyez ici est inventé.", "A demo site for **Etoile Nord**, a streamer. Everything you see here is made up.");
await both("footer.text", "© Etoile Nord · Site de démonstration", "© Etoile Nord · Demo site");
await setSetting("i18n.adminDefault", "en", "");
await prisma.user.updateMany({ data: { locale: "en" } });

const gone = ["Notes courtes", "Archives", "Ressources", "Raccourcis", "Formations"];
for (const row of await prisma.moduleInstance.findMany()) {
  if ((row.nickname && gone.includes(row.nickname)) || /^planning-/.test(row.basePath ?? "")) { try { await deleteInstance(row.id); } catch (e) { log("could not remove", row.nickname, e.message); } }
}
R.resetModuleRegistry();

const instOf = async (id) => (await prisma.moduleInstance.findMany({ where: { moduleId: id }, orderBy: { createdAt: "asc" } }))[0];
async function ctxOf(id) {
  R.resetModuleRegistry();
  const mod = await R.getModule(id); const row = await instOf(id);
  const view = (await listInstances()).find((v) => v.id === row.id);
  const ctx = await buildContext(mod, view, "en"); ctx.can = () => true;
  return { mod, ctx, row, dir: path.join(MODULES_DIR, id) };
}
async function act(id, action, values) {
  const { mod, ctx } = await ctxOf(id);
  const spec = mod.def.adminActions?.[action]; const fn = typeof spec === "function" ? spec : spec?.run;
  if (typeof fn !== "function") throw new Error(`no action ${action}`);
  const r = await fn(ctx, values);
  if (r?.error) throw new Error(r.error);
  if (r?.errors && Object.keys(r.errors).length) throw new Error(JSON.stringify(r.errors));
  return r;
}
const H = { prisma, NOW, ctxOf, act };
const only = process.env.SHOWCASE_SEED_ONLY?.split(",");
const dir = new URL("./demo/", import.meta.url);
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".mjs")).sort()) {
  const id = f.replace(/\.mjs$/, "");
  if (only && !only.includes(id)) continue;
  try { await (await import(new URL(f, dir).href)).default(H); log("seeded", id); } catch (e) { log("FAILED", id, String(e?.message ?? e).slice(0, 300)); }
}
await prisma.$disconnect();
