// Autres plateformes : les icônes à côté des réseaux, en haut du site, et la page d'avertissement facultative. Adresses inventées (example.org).
import { fakeCtx } from "../../helpers/fakeCtx.mjs";

export default async function scenes({ siteFrame, socialsHtml, messages, SITE }) {
  const mod = await import("../../../modules/platform-links/index.mjs");
  const def = mod.default;
  const ctx = fakeCtx({ key: "platform-links", moduleId: "platform-links", basePath: null, locale: "fr", locales: ["fr", "en"], defaultLocale: "fr", messages: messages("platform-links", "fr"), siteUrl: "https://site.example.org", site: { name: SITE.name },
    theme: { bg: "#fbfaf7", fg: "#1c1b22", muted: "#6b6a75", line: "#e4e1da", surface: "#ffffff", accent: "#6c5ce7", accentFg: "#ffffff" } });
  ctx.can = () => true;
  const a = await mod.saveLink(ctx, { platform: "patreon", url: "exemple" }); if (!a.ok) throw new Error(JSON.stringify(a));
  const b = await mod.saveLink(ctx, { platform: "kofi", url: "exemple" }); if (!b.ok) throw new Error(JSON.stringify(b));
  const l = await mod.saveLink(ctx, { platform: "other", label: "Mon espace réservé aux adultes", url: "https://espace.example.org/demo", warn: "on" });
  const items = await def.exports["social.link"](ctx, { locale: "fr" });
  const socials = socialsHtml([{ label: "Twitch", icon: "twitch" }, { label: "YouTube", icon: "youtube" }, { label: "Bluesky", icon: "bluesky" }, ...items.map((i) => ({ label: i.label, icon: i.icon }))]);
  const hero = `<section style="border:1px solid var(--v-line);border-radius:1rem;background:var(--v-surface);padding:2rem"><p style="margin:0;font-size:.875rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--v-accent)">Bienvenue</p><h2 style="margin:.5rem 0 0;font-size:1.5rem;font-weight:700">Des directs, des dessins et une communauté chaleureuse</h2><p style="margin:.5rem 0 0;max-width:60ch;color:var(--v-muted)">Retrouvez toutes les plateformes de la chaîne dans les icônes, en haut de la page.</p></section>`;
  const res = await def.routes.go(new Request(`https://site.example.org/m/platform-links/go?l=${l.link.key}`), ctx);
  return {
    "entete.webp": { html: siteFrame({ nav: ["Accueil", "Planning", "Contact"], current: "Accueil", body: hero, socials }), h: 360, allow: ["patreon.com", "ko-fi.com"] },
    "avertissement.webp": { html: await res.text(), h: 520 },
  };
}
