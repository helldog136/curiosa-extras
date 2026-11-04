// Planning : le petit rond d'une personne (« Avec … »). Fonctions PURES. Décoratif : le nom est écrit à côté, donc texte alternatif vide et rond caché des lecteurs d'écran.
// La photo est toujours une adresse DU SITE (copie gardée par le site, `/m/<clé>/photo/<repère>`, ou une image envoyée à la main `/uploads/…`) : jamais celle de Twitch.
// Sans photo, ou si elle ne charge pas (elle se retire d'elle-même), le rond montre les initiales. Style en ligne et jetons du thème (--v-*) : valable partout, clair comme sombre.
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Une adresse de photo permise (chemin du site seulement), sinon null. */
export const safePhoto = (v) => (typeof v === "string" && (/^\/m\/[A-Za-z0-9_-]{1,64}\/photo\/[0-9a-f]{16}$/.test(v) || /^\/uploads\/[A-Za-z0-9._~%-]+(?:\/[A-Za-z0-9._~%-]+){0,4}$/.test(v)) && !v.includes("..") ? v : null);

/** Les initiales d'un nom (deux lettres au plus). */
export function initialsOf(name) {
  const words = String(name ?? "").normalize("NFC").trim().split(/\s+/).filter(Boolean);
  const first = (w) => Array.from(w.replace(/^[^\p{L}\p{N}]+/u, ""))[0] ?? "";
  const letters = words.length > 1 ? first(words[0]) + first(words[words.length - 1]) : Array.from(first(words[0] ?? "")).join("");
  return (letters || "?").toLocaleUpperCase();
}

export const AVATAR_PX = 32;
const RING = (size) => `position:relative;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;width:${size}px;height:${size}px;border-radius:50%;overflow:hidden;vertical-align:middle;background:var(--v-accent,#9146ff);color:var(--v-accent-fg,#fff);font-size:${Math.round(size * 0.4)}px;font-weight:700;line-height:1;letter-spacing:0`;

/** Le rond : initiales dessous, photo par-dessus si elle existe. */
export function avatarHtml(person, size = AVATAR_PX) {
  const src = safePhoto(person?.photo);
  const img = src ? `<img src="${esc(src)}" alt="" width="${size}" height="${size}" loading="lazy" decoding="async" referrerpolicy="no-referrer" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;max-width:none" onerror="this.remove()">` : "";
  return `<span aria-hidden="true" style="${RING(size)}">${esc(initialsOf(person?.name))}${img}</span>`;
}

/** Une personne : rond + nom, le tout dans un seul lien (cible d'au moins 44 px de haut) quand il y a une chaîne. */
export function personHtml(person, { link = true, size = AVATAR_PX, cls = "" } = {}) {
  const inner = `${avatarHtml(person, size)}<span>${esc(person.name)}</span>`;
  const box = "display:inline-flex;align-items:center;gap:.4rem;min-height:44px;vertical-align:middle";
  const c = cls ? ` class="${esc(cls)}"` : "";
  return link && person.url ? `<a${c} style="color:inherit;${box}" href="${esc(person.url)}" target="_blank" rel="noopener noreferrer">${inner}</a>` : `<span${c} style="${box}">${inner}</span>`;
}
