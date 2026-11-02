// Événements : la liste des prochains rendez-vous, le calendrier du mois et la fiche d'un événement. Événements inventés, aucune adresse réelle.
import { ctxFor, addEvent, addType, def } from "../../helpers/eventsKit.mjs";

export default async function scenes({ siteFrame, blocksHtml }) {
  const ctx = ctxFor({ intro: "Les prochains rendez-vous de la communauté. Un clic sur un événement pour tous les détails." });
  await addType(ctx, { key: "atelier", names: { fr: "Atelier", en: "Workshop" }, color: "teal", pos: 1 });
  await addType(ctx, { key: "rencontre", names: { fr: "Rencontre", en: "Meetup" }, color: "violet", pos: 2 });
  await addType(ctx, { key: "formation", names: { fr: "Formation", en: "Training" }, color: "amber", pos: 3 });
  const prog = [
    { time: "14:00", end: "14:30", title: "Accueil et présentation", text: "Café offert à l'arrivée." },
    { time: "14:30", end: "16:00", title: "Première partie : les bases", text: "" },
    { time: "16:15", end: "17:30", title: "Mise en pratique par petits groupes", text: "Apportez votre ordinateur." },
  ];
  const speakers = [{ name: "Camille Durand", role: "Illustratrice invitée", link: "" }, { name: "Alex Morel", role: "Animation", link: "" }];
  await addEvent(ctx, { title: "Atelier d'initiation au dessin numérique", type: "atelier", date: "2026-10-17", time: "14:00", endTime: "17:30", place: "Salle des Tilleuls, 12 rue des Lilas, Lyon", text: "Un après-midi pour **découvrir le dessin numérique**, sans matériel particulier : nous prêtons des tablettes.\n\nTous niveaux, dans la bonne humeur.", program: prog, speakers, seatsTotal: 20, seatsLeft: 6, signupUrl: "https://inscriptions.example.org/atelier" });
  await addEvent(ctx, { title: "Rencontre de la communauté", type: "rencontre", date: "2026-10-24", time: "18:30", endTime: "21:00", place: "Café Le Petit Théâtre, Nantes", text: "Une soirée pour se rencontrer en vrai et discuter des projets de la saison." });
  await addEvent(ctx, { title: "Formation : monter son premier direct", type: "formation", date: "2026-10-29", time: "19:00", endTime: "21:00", place: "En ligne", text: "Matériel, réglages, scènes : tout pour lancer son premier direct sereinement.", seatsTotal: 30, seatsLeft: 12, signupUrl: "https://inscriptions.example.org/formation" });
  await addEvent(ctx, { title: "Atelier couleurs et ambiances", type: "atelier", date: "2026-11-07", time: "14:00", endTime: "16:30", place: "Salle des Tilleuls, 12 rue des Lilas, Lyon", text: "Choisir une palette et créer une ambiance." });
  await addEvent(ctx, { title: "Soirée jeux de société", type: "rencontre", date: "2026-11-14", time: "19:00", endTime: "23:00", place: "Médiathèque, Grenoble", text: "On apporte ses jeux préférés." });
  await addEvent(ctx, { title: "Formation : bien présenter son travail", type: "formation", date: "2026-11-19", time: "18:00", endTime: "20:00", place: "En ligne", text: "Présenter un projet en quelques minutes." });
  const nav = ["Accueil", "Agenda", "Planning", "Contact"];
  const frame = (p) => siteFrame({ title: p.title, nav, current: "Agenda", body: blocksHtml(p.blocks) });
  const list = await def.page(ctx, { segments: [] });
  const cal = await def.page(ctx, { segments: ["cal", "2026-10"] });
  // la fiche : le premier événement
  const slug = list.blocks[0].html.match(/href="[^"]*\/e\/([a-z0-9-]+)"/)?.[1];
  if (!slug) throw new Error("fiche : aucun lien d'événement trouvé dans la liste");
  const one = await def.page(ctx, { segments: ["e", slug] });
  return {
    "liste.webp": { html: frame(list), h: 900 },
    "calendrier.webp": { html: frame(cal), h: 1180 },
    "fiche.webp": { html: frame(one), h: 1000 },
  };
}
