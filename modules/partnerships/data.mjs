// Partenariats — les fiches partenaires et leur journal : champs, nettoyage, import CSV, lecture du stockage. Aucune notion de personne ici.
export const STATUSES = ["a_contacter", "envoye", "discussion", "accepte", "publie", "refuse_marque", "decline", "sans_reponse", "termine"];
export const CLOSED = new Set(["refuse_marque", "decline", "sans_reponse", "termine"]);
export const DAY = 86_400_000;

// Erreur lisible par l'agent MCP (les autres erreurs sont masquées : jamais de détail interne).
export const fail = (message) => Object.assign(new Error(message), { expose: true });
export const clip = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
export const today = () => new Date().toISOString().slice(0, 10);
export const validDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) ? v : today());
export const safeUrl = (v) => (/^https?:\/\//i.test(String(v ?? "").trim()) ? String(v).trim().slice(0, 500) : "");

export const PARTNER_FIELDS = { brand: 120, status: 30, url: 500, sector: 120, country: 80, contact: 500, brief: 10000, mail: 10000, source: 500, products: 3000, benefits: 3000, logo: 500 };

/** Garde seulement les champs connus, nettoyés (jamais de HTML ni de champ inattendu dans la fiche). */
export function cleanPartner(input, previous = {}) {
  const out = { ...previous };
  for (const [key, max] of Object.entries(PARTNER_FIELDS)) {
    if (input[key] === undefined) continue;
    out[key] = key === "url" || key === "logo" ? safeUrlOrUpload(input[key]) : clip(String(input[key]), max);
  }
  if (input.status !== undefined && !STATUSES.includes(out.status)) out.status = previous.status ?? "a_contacter";
  if (input.chances !== undefined) {
    const n = Number(input.chances);
    out.chances = input.chances === "" || !Number.isFinite(n) ? null : Math.min(100, Math.max(0, Math.round(n)));
  }
  return out;
}
export const safeUrlOrUpload = (v) => (String(v ?? "").startsWith("/uploads/") ? String(v).slice(0, 200) : safeUrl(v));

/** CSV minimal (RFC 4180) : séparateur « , » ou « ; » détecté sur l'en-tête, guillemets doublés, retours à la ligne entre guillemets. */
export function parseCsv(text) {
  const src = String(text ?? "").replace(/^\uFEFF/, "");
  const first = src.split(/\r?\n/, 1)[0] ?? "";
  const sep = (first.match(/;/g) ?? []).length > (first.match(/,/g) ?? []).length ? ";" : ",";
  const rows = []; let row = [], cell = "", quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) { if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c; }
    else if (c === '"' && cell === "") quoted = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && src[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some((x) => x.trim() !== "")) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

export const IMPORT_MAX_ROWS = 500;
/** Import en masse : un partenaire par ligne (colonne `brand` obligatoire). Relançable : une marque déjà connue n'est que COMPLÉTÉE (champs vides), jamais écrasée. */
export async function importPartners(ctx, text) {
  const table = parseCsv(String(text ?? "").slice(0, 1_000_000));
  if (table.length < 2) return { created: 0, completed: 0, skipped: 0, error: "empty" };
  const header = table[0].map((h) => h.trim().toLowerCase());
  if (!header.includes("brand")) return { created: 0, completed: 0, skipped: 0, error: "noBrand" };
  const known = new Map((await ctx.api.store.list("partners", { limit: 1000 })).map((r) => [String(r.data.brand).trim().toLowerCase(), r]));
  let created = 0, completed = 0, skipped = 0;
  for (const cells of table.slice(1, IMPORT_MAX_ROWS + 1)) {
    const input = Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]).filter(([h]) => h === "brand" || h in PARTNER_FIELDS || h === "chances"));
    const brand = clip(input.brand ?? "", 120);
    if (!brand) { skipped++; continue; }
    const existing = known.get(brand.toLowerCase());
    if (!existing) {
      const data = cleanPartner({ ...input, brand, status: input.status || "a_contacter" });
      const id = await ctx.api.store.add("partners", { ...data, updatedBy: "import" });
      known.set(brand.toLowerCase(), { id, data });
      created++;
    } else {
      const fill = Object.fromEntries(Object.entries(input).filter(([k, v]) => k !== "brand" && String(v).trim() !== "" && (existing.data[k] === undefined || existing.data[k] === "" || existing.data[k] === null)));
      const next = cleanPartner(fill, existing.data);
      if (JSON.stringify(next) !== JSON.stringify(existing.data)) { await ctx.api.store.update(existing.id, { ...next, updatedBy: "import" }); completed++; } else skipped++;
    }
  }
  return { created, completed, skipped: skipped + Math.max(0, table.length - 1 - IMPORT_MAX_ROWS) };
}

export async function all(ctx, collection) {
  return ctx.api.store.list(collection, { limit: 1000 });
}

export function lastActivity(partner, journal) {
  const dates = journal.filter((j) => j.data.partnerId === partner.id).map((j) => Date.parse(j.data.date)).filter(Number.isFinite);
  return dates.length ? Math.max(...dates) : partner.createdAt.getTime();
}
export function followUpDue(ctx, partner, journal) {
  const days = Number(ctx.setting("followUpDays")) || 14;
  return partner.data.status === "envoye" && Date.now() - lastActivity(partner, journal) > days * DAY;
}
export const fmt = (ms) => new Date(ms).toISOString().slice(0, 10);

