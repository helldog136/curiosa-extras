// Ce que voit le visiteur : la redirection, l'image du QR code, et la page aimable d'un lien terminé ou introuvable.
//
// La route de redirection est PUBLIQUE. Ses garde-fous :
//  - elle ne lit qu'un seul paramètre, `c` (le nom court) ; la destination vient toujours du stockage, jamais de la requête
//    (aucune redirection ouverte, quel que soit le paramètre qu'on lui passe : `next`, `url`, `redirect`…) ;
//  - la destination est revérifiée à chaque passage (http ou https seulement, rien d'interne), au cas où le stockage aurait été modifié ;
//  - redirection « 302 » (jamais « 301 », que les navigateurs gardent en mémoire : on pourrait plus changer la destination), sans mise en mémoire ;
//  - une réponse prête sans attendre : le décompte des clics se fait derrière (voir clicks.mjs).
import { cachedLink, looksLikeRobot, mayCount, recordClick, visitorKey } from "./clicks.mjs";
import { isEnded, qrFor } from "./links.mjs";
import { qrToPng, qrToSvg, scaleFor } from "./qr-render.mjs";
import { SLUG_MAX, SLUG_RE, endOfDay, parseDestination } from "./url.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const safeColor = (v) => (/^#[0-9a-fA-F]{6}$/.test(String(v ?? "")) ? String(v) : null);

/** L'adresse du visiteur d'après le dernier maillon de X-Forwarded-For (celui qu'ajoute notre propre proxy). Sert à limiter le débit en mémoire, jamais stockée. */
export function clientIp(request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",");
    return parts[parts.length - 1].trim() || "local";
  }
  return request.headers.get("x-real-ip") || "local";
}

const slugOf = (value) => {
  const s = String(value ?? "");
  return s.length >= 1 && s.length <= SLUG_MAX && SLUG_RE.test(s) ? s : "";
};

// ── Limite de débit pour les images ──────────────────────────────────────────────────────────────────────────────────────────
const imageHits = new Map();
function imageLimited(ctx, visitor, now = Date.now()) {
  const key = `${ctx.instance.id ?? ctx.instance.key}|${visitor}`;
  const cur = imageHits.get(key);
  if (!cur || now - cur.since >= 60_000) {
    imageHits.set(key, { since: now, n: 1 });
    if (imageHits.size > 3000) for (const [k, v] of imageHits) if (now - v.since >= 60_000) imageHits.delete(k);
    return false;
  }
  cur.n++;
  return cur.n > 120;
}
export function forgetImageHits(ctx) {
  const prefix = `${ctx.instance.id ?? ctx.instance.key}|`;
  for (const k of [...imageHits.keys()]) if (k.startsWith(prefix)) imageHits.delete(k);
}

// ── Langue du visiteur ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** La langue du site la plus proche de celles que le navigateur demande (« fr-BE,fr;q=0.9,en;q=0.5 »). */
export function preferredLocale(request, ctx) {
  const header = request.headers.get("accept-language") ?? "";
  const wanted = header
    .split(",")
    .slice(0, 12)
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = Number(/q=([0-9.]+)/.exec(params.join(";"))?.[1] ?? 1);
      return { lang: tag.trim().toLowerCase().split("-")[0], q: Number.isFinite(q) ? q : 0 };
    })
    .filter((w) => w.lang && w.lang !== "*" && w.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const w of wanted) {
    const hit = (ctx.locales ?? []).find((l) => l.toLowerCase() === w.lang);
    if (hit) return hit;
  }
  return ctx.defaultLocale;
}

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };

/** Redirection (jamais vers une adresse reçue). */
const redirectTo = (location) => new Response(null, { status: 302, headers: { Location: location, ...NO_STORE } });

function homeHref(ctx, locale) {
  return locale && locale !== ctx.defaultLocale ? `/${locale}` : "/";
}

/**
 * Lien terminé ou introuvable : une petite page autonome aux couleurs du site, dans la langue du visiteur. Si la langue demandée par le navigateur n'est pas
 * celle du contexte, on repart une fois vers la même route avec `lang` (le cœur y prépare alors les textes dans cette langue).
 */
function friendly(request, ctx, kind, link) {
  const wanted = preferredLocale(request, ctx);
  if (!new URL(request.url).searchParams.has("lang") && wanted !== ctx.locale) {
    const params = new URLSearchParams();
    const slug = slugOf(new URL(request.url).searchParams.get("c"));
    if (slug) params.set("c", slug);
    params.set("lang", wanted);
    return redirectTo(`/m/${encodeURIComponent(ctx.instance.key)}/go?${params}`);
  }
  return plainPage(ctx, kind, link);
}

function dayText(ctx, day) {
  const ms = endOfDay(day);
  if (!Number.isFinite(ms)) return "";
  try {
    return new Intl.DateTimeFormat(ctx.locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(ms));
  } catch {
    return day;
  }
}

/** La page : aux couleurs du site, sans rien venant du visiteur. 404 pour un lien introuvable, 410 pour un lien terminé. */
export function plainPage(ctx, kind, link) {
  const color = (key, fallback) => safeColor(ctx.theme?.[key]) ?? fallback;
  const bg = color("bg", "#ffffff"), fg = color("fg", "#111111"), accent = color("accent", "#2255cc"), accentFg = color("accentFg", "#ffffff"), line = color("line", "#cccccc");
  const title = kind === "ended" ? ctx.t("endedTitle") : ctx.t("missingTitle");
  const custom = kind === "ended" ? String(ctx.setting("endedMessage") ?? "").trim().slice(0, 1000) : "";
  const date = kind === "ended" && link?.expires ? dayText(ctx, link.expires) : "";
  const text = custom || (kind === "ended" ? (date ? ctx.t("endedTextDate", { date }) : ctx.t("endedText")) : ctx.t("missingText"));
  const html = `<!doctype html><html lang="${esc(ctx.locale || "en")}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>` +
    `<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:${bg};color:${fg};font:16px/1.5 system-ui,sans-serif}main{max-width:32rem;padding:24px;text-align:center}` +
    `h1{font-size:1.5rem;margin:0 0 .75rem}p{margin:0 0 1.5rem;white-space:pre-line}a{display:inline-block;min-height:44px;box-sizing:border-box;padding:10px 22px;border:1px solid ${line};border-radius:999px;background:${accent};color:${accentFg};text-decoration:none;font-weight:600}</style></head>` +
    `<body><main><h1>${esc(title)}</h1><p>${esc(text)}</p><a href="${esc(homeHref(ctx, ctx.locale))}">${esc(ctx.t("goHome"))}</a></main></body></html>`;
  return new Response(html, {
    status: kind === "ended" ? 410 : 404,
    headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'", "X-Content-Type-Options": "nosniff", ...NO_STORE },
  });
}

const notAllowed = () => new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });

export const routes = {
  /** /m/<clé>/go?c=<nom court> : redirige vers la destination. */
  async go(request, ctx) {
    if (request.method !== "GET" && request.method !== "HEAD") return notAllowed();
    const slug = slugOf(new URL(request.url).searchParams.get("c"));
    if (!slug) return friendly(request, ctx, "missing");
    const link = await cachedLink(ctx, slug);
    if (!link) return friendly(request, ctx, "missing");
    const dest = parseDestination(link.url, { siteUrl: ctx.api.siteUrl });
    if (!dest.ok) return friendly(request, ctx, "missing");
    if (isEnded(link)) return friendly(request, ctx, "ended", link);
    if (request.method === "GET" && ctx.setting("countClicks") !== false && !looksLikeRobot(request) && mayCount(ctx, visitorKey(clientIp(request)))) recordClick(ctx, link.id);
    return redirectTo(dest.url);
  },

  /** /m/<clé>/qr?c=<nom court>&fmt=svg|png&size=s|m|l&dl=1 : l'image du QR code d'un lien qui existe (jamais d'un texte quelconque). */
  async qr(request, ctx) {
    if (request.method !== "GET" && request.method !== "HEAD") return notAllowed();
    if (imageLimited(ctx, visitorKey(clientIp(request)))) return new Response(null, { status: 429, headers: { "Retry-After": "60" } });
    const params = new URL(request.url).searchParams;
    const slug = slugOf(params.get("c"));
    const link = slug ? await cachedLink(ctx, slug) : null;
    if (!link) return new Response(null, { status: 404 });
    const built = qrFor(ctx, link.slug);
    if (!built) return new Response(null, { status: 422 });
    const attach = params.get("dl") === "1" ? { "Content-Disposition": `attachment; filename="${link.slug}-qr.${params.get("fmt") === "png" ? "png" : "svg"}"` } : {};
    const common = { "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'", ...attach };
    if (params.get("fmt") === "png") {
      const target = { s: 300, m: 600, l: 1500 }[params.get("size") ?? "m"] ?? 600;
      const png = qrToPng(built.qr, { scale: scaleFor(built.qr, target) });
      return new Response(png, { headers: { "Content-Type": "image/png", ...common } });
    }
    const svg = qrToSvg(built.qr, { label: ctx.t("qrLabel", { name: link.slug }), pixels: 1000 });
    return new Response(svg, { headers: { "Content-Type": "image/svg+xml; charset=utf-8", ...common } });
  },
};
