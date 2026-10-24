// Aides communes aux tests du module « Galeries photos » : faux contexte avec les vrais textes, requêtes de formulaire, albums et photos prêts.
import fs from "node:fs";
import { fakeCtx } from "./fakeCtx.mjs";

export const DIR = new URL("../../modules/gallery", import.meta.url).pathname;
export const manifest = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8"));
export const messages = (lang) => JSON.parse(fs.readFileSync(`${DIR}/locales/${lang}.json`, "utf8"));
export const def = (await import("../../modules/gallery/index.mjs")).default;
export const data = await import("../../modules/gallery/data.mjs");
export const text = await import("../../modules/gallery/text.mjs");
export const view = await import("../../modules/gallery/view.mjs");
export const ops = await import("../../modules/gallery/ops.mjs");
export const admin = await import("../../modules/gallery/admin.mjs");

let seq = 0;
/** Contexte factice : chaque appel a sa propre clé d'instance (les limiteurs et la mémoire sont par instance). `rights` : droits de la personne qui regarde l'administration. */
export function ctxFor(settings = {}, opts = {}) {
  const { rights = ["edit", "publish", "requests"], locale = "fr", basePath = "galeries", ...rest } = opts;
  const ctx = fakeCtx({
    key: `gal${++seq}`, basePath, moduleId: "gallery", name: locale === "fr" ? "Galeries" : "Galleries",
    locale, defaultLocale: "fr", locales: ["fr", "en"], messages: messages(["fr", "en"].includes(locale) ? locale : "en"), permissions: manifest.permissions, settings, ...rest,
  });
  ctx.can = (right) => rights.includes(right);
  return ctx;
}

/** Une requête POST de formulaire. */
export function post(route, fields, { ip = "203.0.113.7", headers = {} } = {}) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return new Request(`https://example.org/m/x/${route}`, { method: "POST", body, headers: { "x-forwarded-for": ip, origin: "https://example.org", ...headers } });
}
export const get = (route, query = "") => new Request(`https://example.org/m/x/${route}${query}`, { method: "GET" });
export const json = { accept: "application/json" };

export const rows = (ctx, collection) => ctx.dumpStore().filter((r) => r.collection === collection).map((r) => ({ id: r.id, ...r.data }));

const hex = (n) => Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
/** Une adresse comme celle que renvoie le mécanisme d'envoi du cœur. */
export const uploadUrl = (ext = "jpg") => `/uploads/${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}.${ext}`;

/** Un album prêt (publié par défaut), avec `n` photos « envoyées » (adresses /uploads/…). Renvoie { id, photos: [id…], album }. */
export async function makeAlbum(ctx, { title = "Soirée de printemps", n = 0, status = "published", mode = "hosted", link = "", date = "2025-03-14", desc = "", hidden = [] } = {}) {
  const made = await ops.createAlbum(ctx, { title, status, mode, link, date, desc });
  if (!made.ok) throw new Error(`createAlbum : ${made.error}`);
  const photos = [];
  for (let i = 0; i < n; i++) {
    const r = await ops.addUploadedPhoto(ctx, made.id, { full: uploadUrl(), thumb: uploadUrl(), w: 1600, h: 1200, bytes: 200_000, tbytes: 20_000, name: `photo-${i + 1}.jpg`, caption: `Légende ${i + 1}`, alt: `Description ${i + 1}`, hidden: hidden.includes(i) });
    if (!r.ok) throw new Error(`addUploadedPhoto : ${r.error}`);
    photos.push(r.id);
  }
  return { id: made.id, photos, album: await data.getAlbum(ctx, made.id) };
}

/** Efface l'adresse d'une carte « autre service » (une sauvegarde abîmée, une ancienne version…) : le module ne doit pas la montrer. */
export async function breakLink(ctx, id) {
  const row = ctx.dumpStore().find((r) => r.id === id);
  await ctx.api.store.update(id, { ...row.data, link: "" });
  data.invalidate(ctx);
}

/** Les champs que la page d'envoi donne à l'action « addPhoto » une fois les deux fichiers envoyés au cœur. */
export const photoFields = (album, extra = {}) => ({ album, full: uploadUrl(), thumb: uploadUrl(), w: "1600", h: "1200", bytes: "210000", tbytes: "21000", name: "IMG_0001.jpg", caption: "", alt: "", ...extra });
