// Soutiens — la TABLE des fournisseurs (plateformes de mécénat). Ajouter une plateforme = ajouter une entrée ici (et une ligne dans les options du réglage « provider » de module.json,
// vérifiée par un test) : rien d'autre ne change. Chaque fournisseur déclare :
//   id, label            son nom (donnée du fournisseur, pas du site)
//   mode                 "pull"  : le site demande la liste à la plateforme (jeton en réglage secret)
//                        "push"  : la plateforme prévient le site à chaque événement (webhook, jeton de vérification)
//                        "file"  : la propriétaire importe un fichier
//   hosts                la LISTE BLANCHE des serveurs que le module peut appeler pour ce fournisseur (jamais autre chose ; "push" et "file" n'appellent personne)
//   expires              vrai si un soutien s'éteint seul quand le dernier signe est trop ancien (plateforme qui ne donne que des événements)
//   secret               { fr, en } : à quoi sert la clé secrète (ou null)
//   what, steps          { fr, en } : l'explication en mots simples, et les étapes de l'assistant
//   pull(ctx, token)     (mode "pull") → { ok: true, people, tiers, complete } | { ok: false, code }
//   parseEvent(payload)  (mode "push") → événement nettoyé ou null
//   verify(payload, token)
//   parseRows(text)      (mode "file") → { ok: true, rows } | { ok: false, code, line? }
// Les noms de plateformes sont des DONNÉES de cette table et de la documentation : aucun autre fichier du module n'en parle.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const P = await import(`./pure.mjs${v}`);
const { LIMITS, clean, fold, dayOf, sameSecret } = P;

export const TIMING = { callMs: 8000 };

/** Une adresse est-elle sur la liste blanche du fournisseur ? https, hôte exact, pas de compte dans l'adresse, pas de port. */
export function hostAllowed(provider, url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !u.username && !u.password && !u.port && Array.isArray(provider?.hosts) && provider.hosts.includes(u.hostname.toLowerCase());
  } catch { return false; }
}

/**
 * Un appel GET à une plateforme. L'adresse est TOUJOURS construite ici (hôte de la liste blanche + chemin) : jamais une adresse lue dans une réponse.
 * Rend { ok: true, json } ou { ok: false, code } avec code ∈ "token" · "scope" · "none" · "busy" · "unreachable" · "unreadable" · "blocked".
 * Le jeton ne sort ni dans une erreur, ni dans un journal.
 */
export async function getJson(ctx, provider, path, query, token, ms = TIMING.callMs) {
  const qs = Object.entries(query ?? {}).map(([k, val]) => `${encodeURIComponent(k)}=${encodeURIComponent(val)}`).join("&");
  const url = `https://${provider.hosts[0]}${path}${qs ? `?${qs}` : ""}`;
  if (!hostAllowed(provider, url)) return { ok: false, code: "blocked" };
  let r;
  try { r = await ctx.api.net.request({ url, method: "GET", headers: { authorization: `Bearer ${token}`, accept: "application/json" }, timeoutMs: ms, maxBytes: 2_000_000 }); } catch { return { ok: false, code: "unreachable" }; }
  if (!r || typeof r !== "object") return { ok: false, code: "unreachable" };
  if (!r.ok) return { ok: false, code: ["rate", "quota", "circuit", "busy"].includes(r.error) ? "busy" : "unreachable" };
  if (r.status === 401) return { ok: false, code: "token" };
  if (r.status === 403) return { ok: false, code: "scope" };
  if (r.status === 404) return { ok: false, code: "none" };
  if (r.status === 429) return { ok: false, code: "busy" };
  if (r.status >= 500 || r.status < 200 || r.status >= 300) return { ok: false, code: r.status >= 500 ? "unreachable" : "unreadable" };
  if (!r.json || typeof r.json !== "object") return { ok: false, code: "unreadable" };
  return { ok: true, json: r.json };
}

/* ───────────── Patreon (API v2 : membres actifs, palier, date de début) ───────────── */

const PATREON = {
  id: "patreon",
  label: { fr: "Patreon", en: "Patreon" },
  mode: "pull",
  hosts: ["www.patreon.com"],
  expires: false,
  secret: { fr: "Le « Creator's Access Token » de votre page développeur Patreon. Il permet seulement de LIRE la liste de vos membres.", en: "The “Creator's Access Token” from your Patreon developer page. It only lets the site READ your member list." },
  what: {
    fr: "Le site demande à Patreon la liste de vos membres (leur nom, leur palier, leur date de début) quand vous le demandez, ou quand quelqu'un ouvre la page des soutiens après quelques heures. Aucun montant n'est gardé et aucune adresse e-mail n'est demandée.",
    en: "The site asks Patreon for your member list (name, tier, start date) when you ask, or when someone opens the supporters page after a few hours. No amount is kept and no e-mail address is requested.",
  },
  steps: {
    fr: [
      "Connectez-vous à Patreon, puis ouvrez la page « développeurs » (patreon.com/portal/registration/register-clients).",
      "Créez un « client » avec le nom de votre site. Le reste peut rester tel quel.",
      "Copiez le « Creator's Access Token » affiché sur la page du client.",
      "Collez-le dans l'onglet Réglages, champ « Clé secrète de la plateforme », puis enregistrez. Il ne sera plus jamais réaffiché.",
      "Revenez ici et cliquez sur « Vérifier et actualiser ».",
    ],
    en: [
      "Log in to Patreon, then open the “developers” page (patreon.com/portal/registration/register-clients).",
      "Create a “client” with your site's name. Everything else can stay as it is.",
      "Copy the “Creator's Access Token” shown on the client's page.",
      "Paste it in the Settings tab, field “Secret key from the platform”, then save. It will never be shown again.",
      "Come back here and click “Check and refresh”.",
    ],
  },
  async pull(ctx, token) {
    const started = Date.now();
    const left = () => LIMITS.pullMs - (Date.now() - started);
    const camp = await getJson(ctx, PATREON, "/api/oauth2/v2/campaigns", {}, token);
    if (!camp.ok) return camp;
    const cid = Array.isArray(camp.json.data) ? camp.json.data.find((c) => /^\d{1,20}$/.test(String(c?.id)))?.id : null;
    if (!cid) return { ok: false, code: "none" };
    const people = [], amounts = new Map(), tierNames = new Map();
    let cursor = null, complete = false;
    for (let page = 0; page < LIMITS.pullPages; page++) {
      if (left() < 1500) break;
      const q = {
        include: "currently_entitled_tiers",
        "fields[member]": "full_name,patron_status,pledge_relationship_start",
        "fields[tier]": "title,amount_cents",
        "page[count]": String(LIMITS.pullPerPage),
        ...(cursor ? { "page[cursor]": cursor } : {}),
      };
      const r = await getJson(ctx, PATREON, `/api/oauth2/v2/campaigns/${cid}/members`, q, token, Math.min(TIMING.callMs, left()));
      if (!r.ok) return page === 0 ? r : { ok: true, people, tiers: tiersOf(amounts, tierNames), complete: false, partialError: r.code };
      const body = r.json;
      for (const t of Array.isArray(body.included) ? body.included : []) {
        if (t?.type !== "tier" || !/^\d{1,20}$/.test(String(t.id))) continue;
        tierNames.set(String(t.id), clean(t.attributes?.title, LIMITS.tierName) || `#${t.id}`);
        const cents = Number(t.attributes?.amount_cents);
        amounts.set(String(t.id), Number.isFinite(cents) ? cents : 0);
      }
      for (const m of Array.isArray(body.data) ? body.data : []) {
        if (m?.type !== "member" || !/^\d{1,20}$/.test(String(m.id))) continue;
        const status = m.attributes?.patron_status;
        if (typeof status !== "string") continue;              // un simple abonné qui n'a jamais soutenu : pas un soutien
        const active = status === "active_patron";
        const ids = (m.relationships?.currently_entitled_tiers?.data ?? []).map((t) => String(t?.id)).filter((id) => /^\d{1,20}$/.test(id));
        people.push({ k: `patreon:${m.id}`, name: clean(m.attributes?.full_name, LIMITS.name), active, since: dayOf(m.attributes?.pledge_relationship_start), tiers: active ? ids.slice(0, LIMITS.tiersPerPerson).map((id) => `patreon:${id}`) : [] });
        if (people.length >= LIMITS.pullMembers) break;
      }
      const next = body.meta?.pagination?.cursors?.next;
      if (people.length >= LIMITS.pullMembers) break;
      if (typeof next !== "string" || !next) { complete = true; break; }
      if (!/^[\w.=:+\/-]{1,300}$/.test(next)) break;
      cursor = next;
    }
    return { ok: true, people, tiers: tiersOf(amounts, tierNames), complete };
  },
};

/** Les paliers vus, rangés du moins élevé au plus élevé : on ne garde que le RANG (1, 2, 3…), jamais le montant. */
function tiersOf(amounts, names) {
  const ids = [...names.keys()].sort((a, b) => (amounts.get(a) ?? 0) - (amounts.get(b) ?? 0) || Number(a) - Number(b));
  return ids.map((id, i) => ({ k: `patreon:${id}`, name: names.get(id), rank: i + 1 }));
}

/* ───────────── Ko-fi (webhook entrant : un don ou un abonnement = un événement) ───────────── */

const KOFI = {
  id: "kofi",
  label: { fr: "Ko-fi", en: "Ko-fi" },
  mode: "push",
  webhookStep: 2,   // l'adresse à copier s'affiche sous cette étape de l'assistant
  hosts: [],
  expires: true,
  secret: { fr: "Le « Verification Token » de la page Webhooks de Ko-fi. Il prouve que la notification vient bien de Ko-fi.", en: "The “Verification Token” on Ko-fi's Webhooks page. It proves the notification really comes from Ko-fi." },
  what: {
    fr: "Ko-fi prévient votre site à chaque don ou abonnement. Le site ne contacte jamais Ko-fi : il reçoit seulement ses messages, et ignore tout message dont le jeton de vérification est faux. Les montants et les adresses e-mail sont ignorés et jamais gardés.",
    en: "Ko-fi tells your site about each gift or subscription. The site never contacts Ko-fi: it only receives its messages, and ignores any message with a wrong verification token. Amounts and e-mail addresses are ignored and never kept.",
  },
  steps: {
    fr: [
      "Sur Ko-fi, ouvrez Paramètres puis la page « API » (section Webhooks).",
      "Dans « Webhook URL », collez l'adresse affichée ci-dessous (bouton « Copier »).",
      "Copiez le « Verification Token » affiché par Ko-fi et collez-le dans l'onglet Réglages, champ « Clé secrète de la plateforme », puis enregistrez. Il ne sera plus jamais réaffiché.",
      "Si Ko-fi propose un bouton d'essai, utilisez-le. Sinon, le prochain don apparaîtra ici tout seul.",
    ],
    en: [
      "On Ko-fi, open Settings, then the “API” page (Webhooks section).",
      "In “Webhook URL”, paste the address shown below (“Copy” button).",
      "Copy the “Verification Token” shown by Ko-fi and paste it in the Settings tab, field “Secret key from the platform”, then save. It will never be shown again.",
      "If Ko-fi offers a test button, use it. Otherwise the next gift will appear here by itself.",
    ],
  },
  verify(payload, token) {
    return typeof token === "string" && token.length >= 8 && typeof payload?.verification_token === "string" && sameSecret(payload.verification_token, token);
  },
  /** Un événement Ko-fi → { id, name, identity, tierName, subscription, at } ; null pour ce qui n'est pas un don ou un abonnement (commande, commission…). */
  parseEvent(payload) {
    if (!payload || typeof payload !== "object") return null;
    if (!["Donation", "Subscription"].includes(payload.type)) return null;
    const id = clean(payload.message_id, 80);
    if (!id) return null;
    const name = clean(payload.from_name, LIMITS.name);
    const email = clean(payload.email, 200).toLowerCase();
    const identity = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? `email|${email}` : name ? `name|${fold(name)}` : null;
    if (!identity) return null;
    const subscription = payload.type === "Subscription" || payload.is_subscription_payment === true;
    return { id, name: name || "—", identity, tierName: clean(payload.tier_name, LIMITS.tierName) || null, subscription, at: dayOf(payload.timestamp) };
  },
};

/* ───────────── Import d'un fichier (secours : n'importe quelle plateforme) ───────────── */

/** Un tableur → lignes de texte. Séparateur « , » « ; » ou tabulation, guillemets doublés, retours à la ligne dans les guillemets. */
export function parseTable(text) {
  const src = String(text ?? "").replace(/^\ufeff/, "");
  const first = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = [";", "\t", ","].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && src[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some((x) => x.trim() !== "")) rows.push(row); row = []; if (rows.length > LIMITS.csvRows + 1) break; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); if (row.some((x) => x.trim() !== "")) rows.push(row); }
  return rows;
}

const COLUMNS = {
  name: ["name", "nom", "pseudo", "supporter", "soutien", "member", "membre", "full name", "from"],
  tier: ["tier", "palier", "niveau", "level", "reward", "formule"],
  since: ["since", "depuis", "date", "start", "debut", "start date", "pledge start"],
  status: ["status", "statut", "state", "etat"],
  id: ["id", "member id", "numero"],
};
const ENDED = ["ended", "former", "stopped", "inactive", "declined", "cancelled", "canceled", "arrete", "termine", "ancien", "no", "non", "0", "false"];

const FILE = {
  id: "csv",
  label: { fr: "Fichier importé", en: "Imported file" },
  mode: "file",
  hosts: [],
  expires: false,
  secret: null,
  what: {
    fr: "Vous importez vous-même la liste de vos soutiens (un fichier CSV ou une liste copiée d'un tableur). Rien n'est demandé à une plateforme. C'est le secours qui marche avec n'importe quel service.",
    en: "You import your supporters list yourself (a CSV file or a list copied from a spreadsheet). Nothing is requested from a platform. This is the fallback that works with any service.",
  },
  steps: {
    fr: [
      "Exportez la liste de vos soutiens depuis votre plateforme, ou écrivez-la dans un tableur.",
      "Une ligne par personne. Colonnes utiles : nom (obligatoire), palier, depuis (une date comme 2026-03-01), statut (actif ou arrêté).",
      "Enregistrez en CSV, puis importez le fichier plus bas, ou collez la liste dans la zone de texte.",
    ],
    en: [
      "Export your supporters list from your platform, or write it in a spreadsheet.",
      "One line per person. Useful columns: name (required), tier, since (a date like 2026-03-01), status (active or stopped).",
      "Save as CSV, then import the file below, or paste the list in the text box.",
    ],
  },
  /** → { ok: true, rows: [{ line, name, identity, tierName, since, active }], skipped: [{ line, why }] } | { ok: false, code } */
  parseRows(text) {
    if (typeof text !== "string" || !text.trim()) return { ok: false, code: "empty" };
    if (text.length > LIMITS.csvBytes) return { ok: false, code: "big" };
    const table = parseTable(text);
    if (table.length < 2) return { ok: false, code: "nohead" };
    if (table.length - 1 > LIMITS.csvRows) return { ok: false, code: "many" };
    const head = table[0].map((h) => fold(h));
    const col = (key) => head.findIndex((h) => COLUMNS[key].includes(h));
    const at = { name: col("name"), tier: col("tier"), since: col("since"), status: col("status"), id: col("id") };
    if (at.name < 0) return { ok: false, code: "noname" };
    const rows = [], skipped = [];
    for (let i = 1; i < table.length; i++) {
      const r = table[i], line = i + 1;
      const name = clean(r[at.name], LIMITS.name);
      if (!name) { skipped.push({ line, why: "name" }); continue; }
      const since = at.since >= 0 && clean(r[at.since], 40) ? dayOf(r[at.since]) : null;
      if (at.since >= 0 && clean(r[at.since], 40) && !since) { skipped.push({ line, why: "date" }); continue; }
      const status = at.status >= 0 ? fold(r[at.status]) : "";
      const ident = at.id >= 0 && clean(r[at.id], 80) ? `id|${clean(r[at.id], 80)}` : `name|${fold(name)}`;
      rows.push({ line, name, identity: ident, tierName: at.tier >= 0 ? clean(r[at.tier], LIMITS.tierName) || null : null, since, active: !ENDED.includes(status) });
    }
    return { ok: true, rows, skipped };
  },
};

export const PROVIDERS = Object.freeze({ patreon: PATREON, kofi: KOFI, csv: FILE });
export const PROVIDER_IDS = Object.keys(PROVIDERS);
/** Le fournisseur de cette instance (réglage « provider ») ; Patreon à défaut. */
export const providerOf = (ctx) => PROVIDERS[String(ctx.setting("provider"))] ?? PROVIDERS.patreon;
/** Un texte {fr,en} du fournisseur dans la langue courante (repli : langue par défaut, puis anglais). */
export const say = (ctx, texts) => (texts && (texts[ctx.locale] ?? texts[ctx.defaultLocale] ?? texts.en)) ?? "";
