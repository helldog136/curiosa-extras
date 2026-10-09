// TikTok — réseau social de Curiosa. Il ne fait QU'UNE chose : fournir son bouton au cœur (sujet `social.link`) pour l'en-tête du site.
// Réglage : un identifiant ou l'adresse du profil. Rien n'est affiché tant qu'il n'est pas réglé ; seule une adresse https du bon site est acceptée.
const NAME = "TikTok";
const ICON = "tiktok";
const TEMPLATE = "https://www.tiktok.com/@{h}"; // {h} = l'identifiant ; null : adresse complète obligatoire
const HOSTS = ["tiktok.com"]; // null : n'importe quel site https
const HANDLE = /^@?[A-Za-z0-9._-]{1,60}$/;

/** { url, handle } pour ce que l'utilisateur a saisi, ou null si c'est vide, mal formé ou d'un autre site. */
export function profile(value) {
  const v = String(value ?? "").trim();
  if (!v) return null;
  if (/^https:\/\//i.test(v)) {
    let u;
    try { u = new URL(v); } catch { return null; }
    if (u.protocol !== "https:" || u.username || u.password) return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (HOSTS && !HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return null;
    return { url: u.href, handle: null };
  }
  if (!TEMPLATE || !HANDLE.test(v)) return null;
  const handle = v.replace(/^@/, "");
  return { url: TEMPLATE.replace("{h}", encodeURIComponent(handle)), handle };
}

export default {
  exports: {
    "social.link"(ctx) {
      const p = profile(ctx.setting("profile"));
      return p ? [{ label: p.handle ? `${NAME} · ${p.handle}` : NAME, url: p.url, icon: ICON }] : [];
    },
  },
};
