// Liens : la page de liens avec icônes (vrai composant de liste du cœur) et le bouton « Mes réseaux » en tête du site. Liens inventés (example.org).
export default async function scenes({ siteFrame, entryListHtml, socialsHtml, esc }) {
  const entries = [
    { title: "Ma chaîne Twitch", icon: "twitch", url: "https://twitch.example.org/demo" },
    { title: "Mes vidéos", icon: "youtube", url: "https://videos.example.org/demo" },
    { title: "Mon Discord", icon: "discord", url: "https://discord.example.org/demo" },
    { title: "Mon fil Bluesky", icon: "bluesky", url: "https://bsky.example.org/demo" },
    { title: "Mon Instagram", icon: "instagram", url: "https://insta.example.org/demo" },
    { title: "Ma boutique", icon: "🛍️", url: "https://boutique.example.org" },
    { title: "Le kit de presse", icon: "📎", url: "https://presse.example.org" },
    { title: "Me soutenir sur Ko-fi", icon: "kofi", url: "https://kofi.example.org/demo" },
  ];
  const body = `<p class="text-muted">Tous les endroits où me retrouver, au même endroit.</p>${entryListHtml(entries)}`;
  const socials = socialsHtml([{ label: "Twitch", icon: "twitch" }, { label: "YouTube", icon: "youtube" }, { label: "Bluesky", icon: "bluesky" }]);
  return {
    "page.webp": { html: siteFrame({ title: "Mes liens", nav: ["Accueil", "Planning", "Mes liens", "Contact"], current: "Mes liens", body, button: "Mes réseaux", socials }), h: 560 },
  };
}
