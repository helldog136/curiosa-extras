// Contacts — le format CSV du carnet : lecture au fil de l'eau (jamais toutes les lignes en mémoire), écriture, colonnes communes à l'import et à l'export.
// Fonctions PURES (aucun accès au stockage). Les mêmes colonnes servent à l'import et à l'export : exporter puis réimporter redonne les mêmes fiches.
//
// Colonnes (titre français / titre anglais ; l'import comprend les deux, plus quelques synonymes) :
//   nom/name · type/type · fonction/role · organisation · e-mail/email · téléphone/phone · comptes/accounts · catégories/categories · notes/note
//   · statut/status · relation · autres canaux/others · photo · origine/source · id
// Seul le nom (ou un compte, dont le pseudo sert de nom) est obligatoire. Une colonne inconnue est ignorée (jamais une erreur).
// « comptes » : « twitch:pseudo | youtube:@nom | web:monsite.be » (ou simplement des liens de profil collés, le réseau se devine).
// « notes » : « 2026-05-01 · auteur⏎texte » ; plusieurs notes séparées par une ligne « --- ».
// Chaque fichier voisin est importé AVEC la version du fichier principal : sinon une mise à jour à chaud garderait l'ancien (voir docs/HOT-UPDATE.md).
const v = new URL(import.meta.url).search;
const { NETWORKS, normalizeAccount, detectNetwork, clean, fold } = await import(`./networks.mjs${v}`);

export const COLUMNS = [
  { key: "name", fr: "nom", en: "name", alias: ["nom complet", "full name", "fiche", "contact", "prenom nom"] },
  { key: "kind", fr: "type", en: "type", alias: ["kind", "genre", "nature"] },
  { key: "role", fr: "fonction", en: "role", alias: ["poste", "title", "job", "titre"] },
  { key: "organisation", fr: "organisation", en: "organisation", alias: ["organization", "societe", "entreprise", "company", "structure"] },
  { key: "email", fr: "e-mail", en: "email", alias: ["mail", "courriel", "e mail", "adresse e-mail", "adresse email", "email address"] },
  { key: "phone", fr: "téléphone", en: "phone", alias: ["telephone", "tel", "tél", "mobile", "gsm", "portable"] },
  { key: "accounts", fr: "comptes", en: "accounts", alias: ["compte", "account", "reseaux", "réseaux", "networks", "liens"] },
  { key: "categories", fr: "catégories", en: "categories", alias: ["categorie", "catégorie", "category", "tags", "groupes"] },
  { key: "note", fr: "notes", en: "notes", alias: ["note", "commentaire", "commentaires", "comments"] },
  { key: "status", fr: "statut", en: "status", alias: ["etat", "état"] },
  { key: "relation", fr: "relation", en: "relation", alias: [] },
  { key: "others", fr: "autres canaux", en: "others", alias: ["autres", "autre", "other", "autres canaux"] },
  { key: "photo", fr: "photo", en: "photo", alias: ["image", "avatar"] },
  { key: "source", fr: "origine", en: "source", alias: ["provenance"] },
  { key: "id", fr: "id", en: "id", alias: ["identifiant"] },
];
const BY_NAME = new Map();
for (const c of COLUMNS) for (const n of [c.key, c.fr, c.en, ...c.alias]) BY_NAME.set(fold(n).replace(/[^a-z0-9]+/g, " ").trim(), c.key);
/** Les titres de colonnes dans la langue donnée (export). */
export const headerLabels = (locale) => COLUMNS.map((c) => (String(locale).startsWith("fr") ? c.fr : c.en));

export const MAX_ROWS = 100_000;          // plafond technique du carnet, appliqué à l'import
export const MAX_FILE_CHARS = 5 * 1024 * 1024;
export const MAX_ACCOUNTS = 20;
export const MAX_CATEGORIES = 50;
export const MAX_NOTES = 50;
export const NOTE_MAX = 5000;

// ── Lecture ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export class CsvError extends Error { constructor(code, record) { super(code); this.code = code; this.record = record; } }

/** Le séparateur le plus fréquent de la première ligne (hors guillemets) : « ; » (tableur français), « , » ou tabulation. */
export function detectDelimiter(text) {
  const head = String(text).slice(0, 6000);
  const count = { ",": 0, ";": 0, "\t": 0 };
  let inQ = false;
  for (let i = 0; i < head.length; i++) {
    const ch = head[i];
    if (ch === '"') inQ = !inQ;
    else if (!inQ && (ch === "\n" || ch === "\r")) break;
    else if (!inQ && ch in count) count[ch]++;
  }
  return Object.entries(count).sort((a, b) => b[1] - a[1])[0][1] > 0 ? Object.entries(count).sort((a, b) => b[1] - a[1])[0][0] : ",";
}

/**
 * Lit le texte enregistrement par enregistrement : `{ record, cells }` (`record` = numéro de ligne comme dans un tableur, titres = 1). Les lignes vides sont sautées.
 * Un guillemet jamais refermé lève `CsvError("quote", numéro)`. Rien n'est construit pour tout le fichier : un générateur, une ligne à la fois.
 */
export function* parseCsv(text, delimiter = ",") {
  const s = String(text);
  const n = s.length;
  let i = s.charCodeAt(0) === 0xfeff ? 1 : 0;
  let record = 0;
  while (i < n) {
    record++;
    const cells = [];
    for (;;) {
      let cell = "";
      if (s[i] === '"') {
        i++;
        for (;;) {
          const j = s.indexOf('"', i);
          if (j < 0) throw new CsvError("quote", record);
          cell += s.slice(i, j);
          if (s[j + 1] === '"') { cell += '"'; i = j + 2; } else { i = j + 1; break; }
        }
        let j = i;
        while (j < n && s[j] !== delimiter && s[j] !== "\n" && s[j] !== "\r") j++;
        cell += s.slice(i, j); // texte collé après un guillemet fermant : gardé tel quel
        i = j;
      } else {
        let j = i;
        while (j < n && s[j] !== delimiter && s[j] !== "\n" && s[j] !== "\r") j++;
        cell = s.slice(i, j);
        i = j;
      }
      cells.push(cell);
      if (i >= n) break;
      if (s[i] === delimiter) { i++; if (i >= n) { cells.push(""); break; } continue; }
      if (s[i] === "\r" && s[i + 1] === "\n") i++;
      i++;
      break;
    }
    if (cells.length === 1 && cells[0].trim() === "") continue;
    yield { record, cells };
  }
}

/** Associe les titres aux colonnes connues. `{ map: { clé: index }, unknown: [titres ignorés] }`. */
export function readHeader(cells) {
  const map = {}, unknown = [];
  cells.forEach((h, i) => {
    const key = BY_NAME.get(fold(String(h ?? "")).replace(/[^a-z0-9]+/g, " ").trim());
    if (key && map[key] === undefined) map[key] = i; else if (String(h ?? "").trim()) unknown.push(String(h).trim().slice(0, 40));
  });
  return { map, unknown };
}

// ── Valeurs ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Une cellule exportée avec l'apostrophe de protection (« '=1+1 ») retrouve sa valeur. */
export const unguard = (v) => (/^'[=+\-@\t\r']/.test(v) ? v.slice(1) : v);
const enc = (v) => String(v).replace(/%/g, "%25").replace(/\|/g, "%7C");
const dec = (v) => v.replace(/%7C/gi, "|").replace(/%25/g, "%");

const KIND_ALIASES = new Map([["person", "person"], ["personne", "person"], ["individu", "person"], ["humain", "person"], ["org", "org"], ["organisation", "org"], ["organization", "org"], ["societe", "org"], ["entreprise", "org"], ["company", "org"], ["structure", "org"]]);
const STATUS_ALIASES = new Map([["active", "active"], ["verifiee", "active"], ["verifie", "active"], ["checked", "active"], ["ok", "active"], ["actif", "active"], ["to review", "to_review"], ["to_review", "to_review"], ["a verifier", "to_review"], ["review", "to_review"]]);
const keyOf = (v) => fold(v).replace(/[^a-z0-9_]+/g, " ").trim();
const NETWORK_ALIASES = { twitter: "x", "x (twitter)": "x", yt: "youtube", ig: "instagram", insta: "instagram", site: "web", website: "web", "site web": "web", autre: "other", bsky: "bluesky", fediverse: "mastodon" };

/** Un compte écrit « réseau:pseudo » ou collé comme lien. `{ network, handle }` ou `{ error: "network" | "handle", value, network? }`. */
export function parseAccountToken(token) {
  const t = String(token ?? "").trim();
  if (!t) return null;
  const m = /^([A-Za-zÀ-ÿ ()]{1,20}):(?!\/\/)(.+)$/s.exec(t);
  if (m) {
    const name = fold(m[1]);
    const network = NETWORKS.includes(name) ? name : NETWORK_ALIASES[name];
    if (network) {
      const n = normalizeAccount(network, dec(m[2].trim()));
      return n.error ? { error: "handle", value: t, network } : { network, handle: n.handle, url: n.url };
    }
  }
  const detected = detectNetwork(t);
  if (detected && /[/.]/.test(t) && !/^@/.test(t)) {
    const n = normalizeAccount(detected, dec(t));
    return n.error ? { error: "handle", value: t, network: detected } : { network: detected, handle: n.handle, url: n.url };
  }
  const mast = normalizeAccount("mastodon", t);
  if (!mast.error && /^@?[\w]+@[\w.-]+\.[a-z]{2,}$/i.test(t)) return { network: "mastodon", handle: mast.handle, url: mast.url };
  return { error: "network", value: t };
}

/** Plusieurs notes dans une cellule : « date · auteur⏎texte », séparées par une ligne « --- » (une ligne « --- » dans un texte est protégée par « \ »). */
export function parseNotes(cell) {
  const text = String(cell ?? "").replace(/\r\n?/g, "\n").trim();
  if (!text) return [];
  const blocks = [[]];
  for (const line of text.split("\n")) { if (line.trim() === "---") blocks.push([]); else blocks[blocks.length - 1].push(/^\\+---$/.test(line) ? line.slice(1) : line); }
  const out = [];
  for (const lines of blocks) {
    const head = /^(\d{4}-\d{2}-\d{2}) · (.{1,60})$/.exec(lines[0] ?? "");
    const body = (head ? lines.slice(1) : lines).join("\n").trim();
    if (!body) continue;
    out.push({ ...(head ? { date: head[1], author: head[2].trim() } : {}), text: body });
  }
  return out;
}
export function formatNotes(notes) {
  const esc = (t) => String(t).replace(/\r\n?/g, "\n").split("\n").map((l) => (/^\\*---$/.test(l.trim()) ? `\\${l}` : l)).join("\n");
  return notes.map((n) => (n.date ? `${n.date} · ${String(n.author || "module").replace(/[\r\n]+/g, " ").slice(0, 60)}\n${esc(n.text)}` : esc(n.text))).join("\n---\n");
}

const split = (cell) => String(cell ?? "").split(/\s*\|\s*|\n/).map((x) => x.trim()).filter(Boolean);
const httpsOk = (v) => typeof v === "string" && v.length <= 500 && /^https:\/\/[^\s/?#]+\.[^\s/?#]+(\/[^\s]*)?$/i.test(v);
const localOk = (v) => typeof v === "string" && v.length <= 500 && /^\/[A-Za-z0-9._~/%-]+(#[\w=.,:-]*)?$/.test(v);
const validEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);

/**
 * Une ligne lue → { ok: true, input } ou { ok: false, error: { code, value?, network? } } (premier problème trouvé, avec la valeur fautive).
 * `input` : { kind, name, role, organisation, email, phone, status, relation, others, categories: [noms], accounts: [{ network, handle, url }],
 * photo, notes: [{ date?, author?, text }], source?, id? }.
 */
export function rowInput(map, cells, width = Object.keys(map).length) {
  const get = (k) => (map[k] === undefined ? "" : unguard(String(cells[map[k]] ?? "")));
  // Plus de cellules que de titres, et du texte dans les cellules en trop : un séparateur est apparu dans un texte non mis entre guillemets.
  if (cells.length > width && cells.slice(width).some((c) => String(c).trim())) return { ok: false, error: { code: "columns", value: String(cells.length), width: String(width) } };
  const kindRaw = get("kind").trim();
  let kind = "person";
  if (kindRaw) { kind = KIND_ALIASES.get(keyOf(kindRaw)); if (!kind) return { ok: false, error: { code: "kind", value: kindRaw.slice(0, 40) } }; }
  const statusRaw = get("status").trim();
  let status = "active";
  if (statusRaw) { status = STATUS_ALIASES.get(keyOf(statusRaw)); if (!status) return { ok: false, error: { code: "status", value: statusRaw.slice(0, 40) } }; }
  const email = clean(get("email"), 200).toLowerCase();
  if (email && !validEmail(email)) return { ok: false, error: { code: "email", value: email.slice(0, 60) } };
  const accounts = [];
  const seen = new Set();
  for (const tok of split(get("accounts"))) {
    const a = parseAccountToken(tok);
    if (!a) continue;
    if (a.error) return { ok: false, error: { code: a.error === "network" ? "account_network" : "account_handle", value: a.value.slice(0, 80), ...(a.network ? { network: a.network } : {}) } };
    const k = `${a.network}:${a.handle}`;
    if (!seen.has(k)) { seen.add(k); accounts.push(a); }
  }
  if (accounts.length > MAX_ACCOUNTS) return { ok: false, error: { code: "too_many_accounts", value: String(accounts.length) } };
  const categories = [...new Set(split(get("categories")).map((c) => clean(dec(c), 100)).filter(Boolean))];
  if (categories.length > MAX_CATEGORIES) return { ok: false, error: { code: "too_many_categories", value: String(categories.length) } };
  const notes = parseNotes(get("note"));
  if (notes.length > MAX_NOTES) return { ok: false, error: { code: "too_many_notes", value: String(notes.length) } };
  if (notes.some((x) => x.text.length > NOTE_MAX)) return { ok: false, error: { code: "note_long", value: String(NOTE_MAX) } };
  const photo = get("photo").trim();
  if (photo && !httpsOk(photo) && !localOk(photo)) return { ok: false, error: { code: "photo", value: photo.slice(0, 60) } };
  let name = clean(get("name"), kind === "org" ? 200 : 120);
  if (!name && accounts.length) name = accounts[0].handle.slice(0, 120);
  if (!name) return { ok: false, error: { code: "name" } };
  const source = get("source").trim();
  return {
    ok: true,
    input: {
      kind, name, role: clean(get("role"), 120), organisation: kind === "org" ? "" : clean(get("organisation"), 200), email, phone: clean(get("phone"), 60), status,
      relation: clean(get("relation"), 300), others: clean(get("others"), 1000, true), categories, accounts, photo: photo || null, notes,
      ...(/^[a-z][a-z0-9-]{0,39}$/.test(source) ? { source } : {}), ...(get("id").trim() && get("id").trim().length <= 80 ? { id: get("id").trim() } : {}),
    },
  };
}

// ── Écriture ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Une cellule : entre guillemets si besoin ; une valeur qui commence par = + - @ (lue comme une formule par un tableur) reçoit une apostrophe, sauf un numéro de téléphone. */
export function cell(v, delimiter = ",") {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r']/.test(s) && !/^\+\d[\d ().-]{5,}$/.test(s)) s = `'${s}`;
  return s === "" ? "" : new RegExp(`[\"\\n\\r${delimiter === "\t" ? "\\t" : delimiter}]|^\\s|\\s$`).test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const line = (cells, delimiter = ",") => `${cells.map((c) => cell(c, delimiter)).join(delimiter)}\r\n`;
/** Le séparateur de l'export : « ; » avec un tableur français (il s'ouvre en colonnes), « , » sinon. L'import reconnaît les deux. */
export const exportDelimiter = (locale) => (String(locale).startsWith("fr") ? ";" : ",");

/** Une fiche → les cellules de l'export, dans l'ordre de COLUMNS. `labels` : { kind: {person, org}, status: {active, to_review} } dans la langue de l'export. */
export function cardCells({ data, id, categoryNames, notes, withContact, labels }) {
  const accounts = (Array.isArray(data.accounts) ? data.accounts : []).filter((a) => a && NETWORKS.includes(a.network) && typeof a.handle === "string").map((a) => `${a.network}:${enc(a.handle)}`).join(" | ");
  const values = {
    name: data.name, kind: labels.kind[data.kind === "org" ? "org" : "person"], role: data.role ?? "", organisation: data.orgName ?? "", email: withContact ? data.email ?? "" : "", phone: withContact ? data.phone ?? "" : "",
    accounts, categories: categoryNames.map(enc).join(" | "), note: formatNotes(notes), status: labels.status[data.status === "to_review" ? "to_review" : "active"],
    relation: data.relation ?? "", others: data.others ?? "", photo: data.photo ?? "", source: data.source ?? "", id,
  };
  return COLUMNS.map((c) => values[c.key]);
}
