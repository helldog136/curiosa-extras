// Carte : import et export des lieux en fichier CSV (le format des tableurs). L'import est PROGRESSIF : 500 lignes à la fois au plus, et le compte rendu dit
// par où reprendre. Les lieux d'une tranche sont ajoutés ensemble (une seule écriture groupée quand le cœur la propose).
// Les fichiers voisins sont importés avec la même « version » que celui-ci.

const q = new URL(import.meta.url).search;
const { fold, parseCsv, cell, clean, LIMITS } = await import(new URL(`./text.mjs${q}`, import.meta.url).href);
const { C, world, invalidate, locked, newCode, nextPos } = await import(new URL(`./data.mjs${q}`, import.meta.url).href);
const { checkPlace, dupKey } = await import(new URL(`./ops.mjs${q}`, import.meta.url).href);

// Noms de colonnes acceptés (sans accents ni majuscules), en français et en anglais.
const COLUMNS = {
  name: ["name", "nom", "titre", "title"],
  type: ["type", "genre", "categorie", "category"],
  lat: ["lat", "latitude"],
  lng: ["lng", "lon", "long", "longitude"],
  mapLink: ["link", "map link", "map_link", "maplink", "lien carte", "lien_carte", "position", "carte", "map", "maps"],
  address: ["address", "adresse"],
  description: ["description", "desc", "texte", "text"],
  hours: ["hours", "horaires", "opening hours", "heures"],
  url: ["url", "site", "site web", "website", "web", "lien"],
};

export function mapColumns(header) {
  const out = {};
  header.forEach((h, i) => {
    const name = fold(h).replace(/[^a-z0-9_ ]/g, "").trim();
    for (const [field, list] of Object.entries(COLUMNS)) if (out[field] === undefined && list.includes(name)) out[field] = i;
  });
  return out;
}

const unquote = (v) => String(v ?? "").replace(/^'(?=[=+\-@])/, ""); // l'apostrophe ajoutée à l'export contre les formules

/**
 * Lit une tranche du fichier et l'ajoute. `from` : première ligne de données à traiter (1 = la première après les titres).
 * Rend { ok: false, field, message } si le fichier n'est pas lisible, sinon un compte rendu { added, duplicates, failed, problems, total, from, to, remaining }.
 */
export async function importCsv(ctx, text, { from = 1, asDraft = true, canPublish = false, by = "import" } = {}) {
  const { rows } = parseCsv(text, { maxRows: LIMITS.places + 600 });
  if (rows.length < 2) return { ok: false, field: "file", message: ctx.t("importEmpty") };
  const cols = mapColumns(rows[0]);
  if (cols.name === undefined) return { ok: false, field: "file", message: ctx.t("importNoName") };
  if (cols.mapLink === undefined && (cols.lat === undefined || cols.lng === undefined)) return { ok: false, field: "file", message: ctx.t("importNoPosition") };
  const data = rows.slice(1);
  const start = Math.max(1, Math.trunc(from) || 1);
  if (start > data.length) return { ok: false, field: "from", message: ctx.t("importPastEnd", { n: data.length }) };
  const slice = data.slice(start - 1, start - 1 + LIMITS.importRows);
  return locked(ctx, async () => {
    invalidate(ctx);
    const w = await world(ctx);
    const seen = new Set(w.places.map((p) => dupKey(p.name, p.lat, p.lng)));
    const taken = new Set(w.places.map((p) => p.code));
    const publish = !asDraft && canPublish;
    const add = [];
    const problems = [];
    let duplicates = 0;
    let failed = 0;
    let full = false;
    let pos = nextPos(w.places);
    for (let i = 0; i < slice.length; i++) {
      const line = start + i;
      const get = (f) => (cols[f] === undefined ? "" : unquote(slice[i][cols[f]] ?? ""));
      if (slice[i].every((c) => !String(c).trim())) continue;
      const r = checkPlace(ctx, { name: get("name"), type: get("type"), mapLink: get("mapLink"), lat: get("lat"), lng: get("lng"), address: get("address"), description: get("description"), hours: get("hours"), url: get("url") }, w.types);
      if (!r.ok) {
        failed++;
        if (problems.length < 8) problems.push(ctx.t("importLine", { line, message: Object.values(r.errors)[0] }));
        continue;
      }
      const key = dupKey(r.value.name, r.value.lat, r.value.lng);
      if (seen.has(key)) { duplicates++; continue; }
      if (w.places.length + add.length >= LIMITS.places) { full = true; break; }
      seen.add(key);
      const code = newCode(taken);
      taken.add(code);
      add.push({ data: { code, name: r.value.name, type: r.value.type, lat: r.value.lat, lng: r.value.lng, address: r.value.address, desc: r.value.desc, hours: r.value.hours, url: r.value.url, status: publish ? "published" : "draft", pos: pos++, by } });
    }
    if (typeof ctx.api.store.addMany === "function" && add.length) await ctx.api.store.addMany(C.places, add);
    else for (const a of add) await ctx.api.store.add(C.places, a.data);
    invalidate(ctx);
    const to = start - 1 + slice.length;
    const report = { kind: "report", at: new Date().toISOString(), added: add.length, duplicates, failed, problems, total: data.length, from: start, to, remaining: Math.max(0, data.length - to), full, published: publish };
    const old = await ctx.api.store.list(C.meta, { limit: 20 }); // un seul compte rendu gardé : le dernier
    for (const r of old) if (r.data?.kind === "report") await ctx.api.store.remove(r.id);
    await ctx.api.store.add(C.meta, report);
    return { ok: true, ...report };
  });
}

export async function lastReport(ctx) {
  const rows = await ctx.api.store.list(C.meta, { limit: 20 });
  const r = rows.find((x) => x.data?.kind === "report");
  if (!r) return null;
  const d = r.data;
  const n = (v) => Math.max(0, Math.trunc(Number(v)) || 0);
  return { at: String(d.at ?? ""), added: n(d.added), duplicates: n(d.duplicates), failed: n(d.failed), problems: Array.isArray(d.problems) ? d.problems.slice(0, 8).map((p) => clean(p, 300)) : [], total: n(d.total), from: n(d.from), to: n(d.to), remaining: n(d.remaining), full: d.full === true, published: d.published === true };
}

const HEADER = ["name", "type", "lat", "lng", "address", "description", "hours", "url"];

/** Les lieux de l'équipe en CSV, ligne par ligne (jamais construits d'un bloc). Les nombres restent des nombres (un « - » devant n'est pas une formule). */
export async function* exportLines(ctx) {
  yield `﻿${HEADER.join(",")}\r\n`;
  let cursor = null;
  do {
    const page = await ctx.api.store.page(C.places, { limit: 500, cursor, order: "asc" });
    for (const r of page.items) {
      const d = r.data ?? {};
      if (!Number.isFinite(Number(d.lat)) || !Number.isFinite(Number(d.lng))) continue;
      yield `${[cell(d.name), cell(d.type), Number(d.lat), Number(d.lng), cell(d.address), cell(d.desc), cell(d.hours), cell(d.url)].join(",")}\r\n`;
    }
    cursor = page.next;
  } while (cursor);
}

export async function exportText(ctx) {
  let out = "";
  for await (const line of exportLines(ctx)) out += line;
  return out;
}
