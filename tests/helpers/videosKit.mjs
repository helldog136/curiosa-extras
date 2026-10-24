// Aides communes aux tests de la Vidéothèque : faux contexte avec les vraies traductions, faux YouTube (titre + miniature, avec pannes), remplissage rapide du stockage.
import fs from "node:fs";
import { fakeCtx } from "./fakeCtx.mjs";

export const DIR = new URL("../../modules/videos", import.meta.url).pathname;
export const manifest = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8"));
export const messages = (lang) => JSON.parse(fs.readFileSync(`${DIR}/locales/${lang}.json`, "utf8"));
export const def = (await import("../../modules/videos/index.mjs")).default;
export const P = await import("../../modules/videos/pure.mjs");
export const R = await import("../../modules/videos/providers.mjs");
export const D = await import("../../modules/videos/data.mjs");
export const O = await import("../../modules/videos/ops.mjs");
export const V = await import("../../modules/videos/view.mjs");
export const Admin = await import("../../modules/videos/admin.mjs");
export const Mcp = await import("../../modules/videos/mcp.mjs");
export const S = await import("../../modules/videos/service.mjs");
export const Albums = await import("../../modules/videos/albums.mjs");
export const Routes = await import("../../modules/videos/routes.mjs");

let seq = 0;
/** Contexte factice : chaque appel a sa propre clé d'instance. `rights` : droits de la personne qui regarde l'administration. */
export function ctxFor(settings = {}, opts = {}) {
  const { rights = ["edit", "publish"], locale = "fr", ...rest } = opts;
  const ctx = fakeCtx({
    key: `vid${++seq}`, basePath: "videos", moduleId: "videos", name: locale === "fr" ? "Vidéothèque" : "Video library",
    locale, defaultLocale: "fr", locales: ["fr", "en"], messages: messages(["fr", "en"].includes(locale) ? locale : "en"), permissions: manifest.permissions, settings, ...rest,
  });
  ctx.instance.id = `inst-${ctx.instance.key}`;
  ctx.can = (right) => rights.includes(right);
  return ctx;
}

// ── Faux YouTube ──────────────────────────────────────────────────────────────────────────────────────────────────

export const JPEG = (size = 600) => { const b = new Uint8Array(size); b.set([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]); return b; };

/**
 * Routes pour `withFakeFetch` : le titre (oEmbed) et la miniature de quelques vidéos.
 *   videos : { <identifiant>: { title, embeddable?: false (401), thumb?: false (404), thumbBytes? } } ; tout autre identifiant : 404 (vidéo inconnue).
 *   down: true → tout échoue comme un réseau coupé. `calls` : les adresses demandées.
 */
export function platform(videos = {}, { down = false } = {}) {
  const calls = [];
  const handler = async (url) => {
    calls.push(url);
    if (down) throw new TypeError("fetch failed");
    const o = /^https:\/\/www\.youtube\.com\/oembed\?format=json&url=(.+)$/.exec(url);
    if (o) {
      const vid = /v%3D([A-Za-z0-9_-]{11})$/.exec(o[1])?.[1];
      const v = vid && videos[vid];
      if (!v) return { status: 404, text: "Not Found" };
      if (v.embeddable === false) return { status: 401, text: "Unauthorized" };
      return { json: { title: v.title, author_name: "Une chaîne", thumbnail_url: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`, type: "video" } };
    }
    const t = /^https:\/\/i\.ytimg\.com\/vi\/([A-Za-z0-9_-]{11})\/mqdefault\.jpg$/.exec(url);
    if (t) {
      const v = videos[t[1]];
      if (!v || v.thumb === false) return { status: 404, text: "" };
      return new Response(v.thumbBytes ?? JPEG(), { status: 200, headers: { "content-type": "image/jpeg" } });
    }
    throw new TypeError("fetch failed");
  };
  return { routes: { "*": handler }, calls };
}

// ── Remplissage direct du stockage (rapide) ───────────────────────────────────────────────────────────────────────

/** Ajoute des vidéos par le chemin normal du module. `list` : [{ ext, title, status?, cat?, date?, … }]. Renvoie les vidéos ajoutées. */
export async function seedVideos(ctx, list) {
  const r = await D.addVideos(ctx, list.map((x) => ({ provider: "youtube", status: "published", ...x })));
  return r.added;
}
export async function seedCategory(ctx, name) {
  const r = await D.addCategory(ctx, { fr: name, en: name });
  return r.k;
}
/** Une série avec ces vidéos (numéros). */
export async function seedSeries(ctx, name, numbers, status = "published") {
  const r = await D.addSeries(ctx, { fr: name, en: name });
  for (const n of numbers) await D.editSeriesItems(ctx, r.p, n, "add");
  await D.updateSeries(ctx, r.p, { status });
  return r.p;
}
/** Garde une miniature pour la vidéo n (octets de test). */
export async function keepThumb(ctx, n, size = 600) {
  await D.putThumb(ctx, n, JPEG(size), "image/jpeg");
  await D.updateVideo(ctx, n, { thumb: true });
}
export const id = (i) => `abcdefg${String(i).padStart(4, "0")}`; // 11 caractères valides : abcdefg0001…

export const pageHtml = async (ctx, segments = []) => { const r = await def.page(ctx, { segments }); return r.notFound ? null : r.blocks.map((b) => b.html ?? b.text ?? "").join(""); };
