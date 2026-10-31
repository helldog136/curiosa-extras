// Les commandes du bot : le modèle, la vérification (noms, alias, collisions, textes) et leur enregistrement.
// Quatre familles : les commandes que l'on écrit soi-même (« custom »), les commandes toutes prêtes (« builtin »), celles des partenaires (« partner », une par fiche de Sponsors)
// et celles des réseaux sociaux (« network », une par lien fourni par un module de réseau), plus la commande groupée (« group »).
// Tout vit dans UN document (`config`) : un propriétaire, une écriture, des collisions vérifiées d'un seul coup d'œil. Les partenaires et les réseaux ne sont connus que par leur identifiant :
// leur titre, leur adresse et leur nom appartiennent aux modules qui les fournissent et sont lus au moment de répondre.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { checkTemplate, used, allowedFor } = await import(`./variables.mjs${v}`);
const { parsePeriod, readPeriod, isOpen, nextOpening } = await import(`./period.mjs${v}`);

export const ROLES = ["everyone", "subscribers", "mods", "owner"];
export const ROLE_LEVEL = { everyone: 0, subscribers: 1, mods: 2, owner: 3 };
export const NAME_RE = /^[\p{L}\p{N}_-]{1,25}$/u;
export const MAX_ALIASES = 5;
export const MAX_CUSTOM = 100;
export const MAX_DELAY = 3600;
/** Mots réservés aux commandes d'arrêt de la maison (kill.mjs) : aucune autre commande ne peut les prendre. */
export const RESERVED = ["stop", "start", "addcom", "editcom", "delcom", "commands"];
export const GROUP_ID = "reseaux";

/** Les commandes toutes prêtes. `needs` : ce dont elles ont besoin pour répondre. Le texte par défaut vient des textes traduits (`cmd_<id>_text`). */
export const BUILTINS = [
  { id: "planning", name: "planning", aliases: [], needs: "planning" },
  { id: "jeu", name: "jeu", aliases: ["game"], needs: "live" },
  { id: "titre", name: "titre", aliases: ["title"], needs: "live" },
  { id: "followers", name: "followers", aliases: [], needs: "followers" },
  { id: "uptime", name: "uptime", aliases: [], needs: "live" },
];

/** Nom et alias proposés pour un réseau, d'après le module qui le fournit. Un réseau inconnu reçoit son nom en minuscules, sans espaces ni accents. */
export const NETWORK_HINTS = {
  "youtube-channel": { name: "youtube", aliases: ["yt"] }, tiktok: { name: "tiktok", aliases: ["tik-tok"] }, instagram: { name: "instagram", aliases: ["insta", "ig"] },
  "x-twitter": { name: "x", aliases: ["twitter"] }, discord: { name: "discord", aliases: [] }, bluesky: { name: "bluesky", aliases: ["bsky"] }, mastodon: { name: "mastodon", aliases: [] },
  facebook: { name: "facebook", aliases: ["fb"] }, "twitch-channel": { name: "twitch", aliases: [] }, kofi: { name: "kofi", aliases: ["ko-fi"] }, patreon: { name: "patreon", aliases: [] },
  snapchat: { name: "snapchat", aliases: ["snap"] }, telegram: { name: "telegram", aliases: ["tg"] }, github: { name: "github", aliases: [] }, reddit: { name: "reddit", aliases: [] },
  threads: { name: "threads", aliases: [] }, spotify: { name: "spotify", aliases: [] }, soundcloud: { name: "soundcloud", aliases: [] }, steam: { name: "steam", aliases: [] },
  kick: { name: "kick", aliases: [] }, pinterest: { name: "pinterest", aliases: [] }, bandcamp: { name: "bandcamp", aliases: [] },
};

/* ───────────── Mots et noms ───────────── */

/** « !Jeu » → « jeu » (préfixe retiré, minuscules). */
export function norm(value, prefix = "!") {
  let s = String(value ?? "").normalize("NFKC").trim().toLowerCase();
  if (prefix && s.startsWith(prefix)) s = s.slice(prefix.length);
  return s.trim();
}
/** Un nom à partir d'un texte libre (titre d'une fiche, nom d'un réseau…) : minuscules, sans accents ni espaces, 25 caractères ; « commande » si rien ne reste. */
export function slugName(value, fallback = "commande") {
  const s = String(value ?? "").normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, "").slice(0, 25);
  return s || fallback;
}
/** Liste d'alias saisie à la main (« a, b c ») ou déjà en tableau → { aliases } ou { error: { code: "alias", value } }. */
export function parseAliases(input, prefix = "!") {
  const raw = Array.isArray(input) ? input : String(input ?? "").split(/[\s,;]+/);
  const out = [];
  for (const r of raw) {
    const n = norm(r, prefix);
    if (!n) continue;
    if (!NAME_RE.test(n)) return { error: { code: "alias", value: String(r).slice(0, 40) } };
    if (!out.includes(n)) out.push(n);
  }
  return out.length > MAX_ALIASES ? { error: { code: "aliases_many" } } : { aliases: out };
}
/** Un délai en secondes : null (par défaut) ou un entier de 0 à une heure. */
export function parseDelay(v) {
  if (v === null || v === undefined || String(v).trim() === "") return { value: null };
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= MAX_DELAY ? { value: n } : { error: { code: "delay" } };
}

/* ───────────── Le document de configuration ───────────── */

export const emptyConfig = () => ({ v: 1, custom: [], builtin: {}, partners: {}, networks: {}, group: {}, timers: [] });
const rec = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
/** Relit le document avec prudence : une forme inattendue ne casse rien. */
export function readConfig(data) {
  const d = rec(data), c = emptyConfig();
  c.custom = Array.isArray(d.custom) ? d.custom.filter((x) => x && typeof x === "object" && typeof x.id === "string") : [];
  c.timers = Array.isArray(d.timers) ? d.timers.filter((x) => x && typeof x === "object" && typeof x.id === "string") : [];
  for (const k of ["builtin", "partners", "networks", "group"]) c[k] = rec(d[k]);
  return c;
}
export async function loadConfig(ctx) {
  const row = (await ctx.api.store.list("botConfig", { limit: 1 }))[0];
  return { id: row?.id ?? null, data: readConfig(row?.data) };
}
const chain = new Map();
const bumps = new Map();
/** Un numéro qui change à chaque écriture de la configuration : de quoi savoir qu'une copie gardée en mémoire est périmée. */
export const configVersion = (ctx) => bumps.get(ctx.instance.key) ?? 0;
/** Lit, modifie, écrit — l'une après l'autre pour une même instance (deux modifications simultanées ne s'écrasent pas). `fn(data)` peut modifier `data` et rend le résultat. */
export function mutate(ctx, fn) {
  const k = ctx.instance.key;
  const run = (chain.get(k) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const cfg = await loadConfig(ctx);
    const result = await fn(cfg.data);
    if (result?.ok === false) return result;
    if (cfg.id) await ctx.api.store.update(cfg.id, cfg.data); else await ctx.api.store.add("botConfig", cfg.data);
    bumps.set(k, (bumps.get(k) ?? 0) + 1);
    return result;
  });
  chain.set(k, run);
  return run;
}

/** Migration des données 3 → 4 : ajoute la liste de timers (vide) au document de configuration s'il existe ; ne touche à rien d'autre. */
export async function migrateConfig(ctx) {
  const row = (await ctx.api.store.list("botConfig", { limit: 1 }))[0];
  if (!row || (row.data && Array.isArray(row.data.timers))) return;
  await ctx.api.store.update(row.id, { ...rec(row.data), timers: [] });
}

/* ───────────── Les commandes telles qu'elles sont (réglage + ce que fournissent les autres modules) ───────────── */

export const stripScheme = (u) => String(u ?? "").replace(/^https?:\/\//i, "").replace(/\/+$/, "");

const roleOf = (v) => (ROLES.includes(v) ? v : "everyone");
const small = (v) => (Number.isInteger(v) && v >= 0 && v <= MAX_DELAY ? v : null);
const base = (o, extra) => ({ period: readPeriod(o.period), aliases: Array.isArray(o.aliases) ? o.aliases : [], role: roleOf(o.role), cdGlobal: small(o.cdGlobal), cdUser: small(o.cdUser), ...extra });

/**
 * La liste de TOUTES les commandes, avec leur état.
 * `src` : { partners: { installed, items }, networks: { items }, planning: { installed }, followers: { available } } (voir sources.mjs) ; `t` : traduction du contexte.
 * Chaque commande : { key, kind, id, label, name, aliases, text, role, cdGlobal, cdUser, enabled, state: "on" | "off" | "hidden" | "missing", why, vars: {…} }
 *   state "hidden" : il manque quelque chose pour répondre (`why` le dit) ; "missing" : la fiche ou le lien d'origine a disparu (la commande est en pause) ; "off" : désactivée.
 */
export function catalog(cfg, src, t, { now = Date.now(), timeZone = "UTC" } = {}) {
  const out = [];
  for (const c of cfg.custom) out.push({ key: `custom:${c.id}`, kind: "custom", id: c.id, label: c.name, name: c.name, ...base(c, {}), text: String(c.text ?? ""), enabled: c.enabled !== false, vars: {} });
  for (const b of BUILTINS) {
    const o = rec(cfg.builtin[b.id]);
    out.push({ key: `builtin:${b.id}`, kind: "builtin", id: b.id, label: b.id, needs: b.needs, name: o.name ?? b.name, ...base(o, { aliases: Array.isArray(o.aliases) ? o.aliases : b.aliases }),
      text: typeof o.text === "string" && o.text ? o.text : t(`cmd_${b.id}_text`), defaultText: t(`cmd_${b.id}_text`), enabled: o.enabled !== false, vars: {} });
  }
  const sponsors = src.partners ?? { installed: false, items: [] };
  for (const [id, o0] of Object.entries(cfg.partners)) {
    const o = rec(o0), item = sponsors.items.find((p) => p.id === id);
    out.push({ key: `partner:${id}`, kind: "partner", id, label: item?.title ?? o.title ?? id, name: o.name, ...base(o, {}), text: String(o.text ?? ""), enabled: o.enabled === true,
      vars: item ? { partenaire: item.title, adresse: item.address } : {}, source: item ?? null, missing: !item });
  }
  const nets = src.networks ?? { items: [] };
  for (const [id, o0] of Object.entries(cfg.networks)) {
    const o = rec(o0), item = nets.items.find((n) => n.key === id);
    out.push({ key: `network:${id}`, kind: "network", id, label: item?.label ?? item?.name ?? o.title ?? id, name: o.name, ...base(o, {}), text: String(o.text ?? ""), enabled: o.enabled === true,
      vars: item ? { reseau: item.name, lien: stripScheme(item.url) } : {}, source: item ?? null, missing: !item });
  }
  const g = rec(cfg.group);
  out.push({ key: `group:${GROUP_ID}`, kind: "group", id: GROUP_ID, label: GROUP_ID, name: g.name ?? "reseaux", ...base(g, { aliases: Array.isArray(g.aliases) ? g.aliases : ["liens"] }),
    text: typeof g.text === "string" && g.text ? g.text : t("cmd_group_text"), defaultText: t("cmd_group_text"), enabled: g.enabled !== false, vars: {} });
  const activeNetworks = out.filter((c) => c.kind === "network" && c.enabled && !c.missing);
  for (const c of out) {
    c.state = "on"; c.why = null;
    if (c.kind === "partner" || c.kind === "network") {
      if (c.missing) { c.state = "missing"; c.why = c.kind === "partner" ? "partner_missing" : "network_missing"; continue; }
    }
    if (!c.enabled) { c.state = "off"; continue; }   // l'interrupteur « activée » à faux l'emporte toujours sur la période
    if (c.period && !isOpen(c.period, now, timeZone)) { c.state = "outside"; c.why = "outside_period"; c.reopen = nextOpening(c.period, now, timeZone); continue; }
    if (c.kind === "builtin") {
      if (c.needs === "planning" && !src.planning?.installed) { c.state = "hidden"; c.why = "planning_absent"; }
      else if (c.needs === "followers" && !src.followers?.available) { c.state = "hidden"; c.why = "followers_absent"; }
    }
    if (c.kind === "group" && !activeNetworks.length) { c.state = "hidden"; c.why = "group_empty"; }
  }
  return out;
}

/** Tous les mots pris (noms et alias) par les commandes ENREGISTRÉES, sauf `exceptKey`. Rend une Map mot → commande. */
export function takenWords(list, exceptKey = null) {
  const m = new Map();
  for (const c of list) if (c.key !== exceptKey && c.name) for (const w of [c.name, ...c.aliases]) if (!m.has(w)) m.set(w, c);
  return m;
}

/** Les mots d'une commande qui sont déjà pris par une autre : [{ word, with }]. */
export function collisions(list, key, words) {
  const taken = takenWords(list, key);
  return words.filter((w) => taken.has(w)).map((w) => ({ word: w, with: taken.get(w) }));
}

/* ───────────── Propositions (réseaux et partenaires pas encore activés) ───────────── */

/** Un nom libre : `base`, sinon `base2`, `base3`… (25 caractères au plus). */
export function freeName(base0, taken) {
  const b = slugName(base0);
  if (!taken.has(b)) return b;
  for (let i = 2; i < 100; i++) { const n = `${b.slice(0, 25 - String(i).length)}${i}`; if (!taken.has(n)) return n; }
  return `${b.slice(0, 20)}${Date.now() % 100000}`;
}

/** Nom, alias et texte proposés pour un partenaire (le nom suit la fiche UNE fois : ensuite c'est une valeur à part). `list` : les commandes enregistrées. */
export function proposePartner(item, list, t) {
  const taken = takenWords(list);
  return { name: freeName(item.slug || item.title, taken), aliases: [], text: t("cmd_partner_text") };
}
/** Idem pour un réseau ; chaque alias déjà pris est simplement écarté de la proposition. */
export function proposeNetwork(item, list, t) {
  const hint = NETWORK_HINTS[item.module];
  const taken = takenWords(list);
  const name = freeName(hint?.name ?? item.name, taken);
  const mine = new Set([name]);
  const aliases = (hint?.aliases ?? []).filter((a) => !taken.has(a) && !mine.has(a));
  return { name, aliases, text: t("cmd_network_text") };
}

/* ───────────── Enregistrer une commande (administration et assistants) ───────────── */

const errorOf = (code, extra = {}) => ({ ok: false, code, ...extra });

/**
 * Vérifie et applique des champs à une commande. `fields` : { enabled?, name?, aliases?, text?, role?, cdGlobal?, cdUser? } (seuls les champs présents changent).
 * `ref` : { kind, id } (id absent pour créer une commande « custom »). `src` : sources (partenaires, réseaux). Rend { ok: true, key } ou { ok: false, code, … }.
 */
export async function saveCommand(ctx, ref, fields, { prefix = "!", src, t }) {
  return mutate(ctx, (cfg) => {
    const list = catalog(cfg, src, t);
    const f = fields ?? {};
    const kind = ref.kind;
    const creating = kind === "custom" && !ref.id;
    let id = ref.id;
    let current = null;
    if (creating) {
      if (cfg.custom.length >= MAX_CUSTOM) return errorOf("too_many");
      id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    } else {
      current = list.find((c) => c.kind === kind && c.id === id);
      if (!current) return errorOf("unknown");
      if ((kind === "partner" || kind === "network") && current.missing) return errorOf("source_missing");
    }
    // Un partenaire ou un réseau pas encore configuré : on part de la proposition (elle devient alors une valeur à part, indépendante de la fiche).
    let item = current;
    if (!item && (kind === "partner" || kind === "network")) return errorOf("unknown");
    const key = `${kind}:${id}`;
    const draft = { enabled: item?.enabled ?? true, name: item?.name ?? "", aliases: item?.aliases ?? [], text: item?.text ?? "", role: item?.role ?? "everyone", cdGlobal: item?.cdGlobal ?? null, cdUser: item?.cdUser ?? null, period: item?.period ?? null };
    if (f.enabled !== undefined) draft.enabled = f.enabled === true;
    if (f.name !== undefined) {
      const n = norm(f.name, prefix);
      if (!NAME_RE.test(n)) return errorOf("name", { value: String(f.name).slice(0, 40) });
      draft.name = n;
    }
    if (!draft.name) return errorOf("name", { value: "" });
    if (f.aliases !== undefined) { const p = parseAliases(f.aliases, prefix); if (p.error) return errorOf(p.error.code, p.error); draft.aliases = p.aliases; }
    draft.aliases = draft.aliases.filter((a) => a !== draft.name);
    if (f.role !== undefined) { if (!ROLES.includes(f.role)) return errorOf("role"); draft.role = f.role; }
    for (const [field, k] of [["cdGlobal", "cdGlobal"], ["cdUser", "cdUser"]]) if (f[field] !== undefined) { const d = parseDelay(f[field]); if (d.error) return errorOf("delay"); draft[k] = d.value; }
    if (f.period !== undefined) { const p = parsePeriod(f.period); if (!p.ok) return errorOf("period", { field: p.field, reason: p.reason, month: p.month, day: p.day, year: p.year }); draft.period = p.value; }
    if (f.text !== undefined || creating) {
      const text = f.text !== undefined ? f.text : "";
      const ok = checkTemplate(text, kind === "builtin" ? "builtin" : kind, prefix);
      if (!ok.ok) return errorOf(`text_${ok.code}`, { vars: ok.vars, allowed: ok.allowed, name: ok.name });
      draft.text = ok.text;
    } else if (kind !== "builtin" && kind !== "group") {
      const ok = checkTemplate(draft.text, kind, prefix);
      if (!ok.ok) return errorOf(`text_${ok.code}`, { vars: ok.vars, allowed: ok.allowed, name: ok.name });
    }
    // Collisions : seulement avec les AUTRES commandes enregistrées.
    const reserved = [draft.name, ...draft.aliases].find((w) => RESERVED.includes(w));
    if (reserved) return errorOf("collision", { word: reserved, with: reserved, withLabel: "", withKind: "builtin" });
    const clash = collisions(list.filter((c) => !(creating && c.key === key)), key, [draft.name, ...draft.aliases]);
    if (clash.length) return errorOf("collision", { word: clash[0].word, with: clash[0].with.name, withLabel: clash[0].with.label, withKind: clash[0].with.kind });

    const rec0 = { enabled: draft.enabled, name: draft.name, aliases: draft.aliases, role: draft.role, cdGlobal: draft.cdGlobal, cdUser: draft.cdUser, ...(draft.period ? { period: draft.period } : {}) };
    if (kind === "custom") {
      const entry = { id, ...rec0, text: draft.text };
      if (creating) cfg.custom.push(entry); else cfg.custom = cfg.custom.map((c) => (c.id === id ? entry : c));
    } else if (kind === "builtin") {
      const def = BUILTINS.find((b) => b.id === id);
      const o = { enabled: draft.enabled, role: draft.role, cdGlobal: draft.cdGlobal, cdUser: draft.cdUser, ...(draft.period ? { period: draft.period } : {}) };
      if (draft.name !== def.name) o.name = draft.name;
      if (JSON.stringify(draft.aliases) !== JSON.stringify(def.aliases)) o.aliases = draft.aliases;
      if (f.text !== undefined && draft.text !== current.defaultText) o.text = draft.text;
      else if (f.text === undefined && typeof rec(cfg.builtin[id]).text === "string") o.text = cfg.builtin[id].text;
      cfg.builtin[id] = o;
    } else if (kind === "partner") cfg.partners[id] = { ...rec0, text: draft.text, title: current.label };
    else if (kind === "network") cfg.networks[id] = { ...rec0, text: draft.text, title: current.label };
    else if (kind === "group") {
      const o = { enabled: draft.enabled, role: draft.role, cdGlobal: draft.cdGlobal, cdUser: draft.cdUser, name: draft.name, aliases: draft.aliases, ...(draft.period ? { period: draft.period } : {}) };
      if (f.text !== undefined && draft.text !== current.defaultText) o.text = draft.text;
      cfg.group = o;
    } else return errorOf("unknown");
    return { ok: true, key };
  });
}

/**
 * Active (ou met à jour) la commande d'un partenaire ou d'un réseau PAS ENCORE enregistré : on part de la proposition, que les champs saisis complètent.
 * Une fois enregistré, le nom est une valeur à part : il ne suit plus le titre ni le réseau d'origine.
 */
export async function saveSourced(ctx, kind, id, fields, env) {
  const { src, t, prefix = "!" } = env;
  const cfg0 = (await loadConfig(ctx)).data;
  const list = catalog(cfg0, src, t);
  const existing = list.find((c) => c.kind === kind && c.id === id);
  if (!existing) {
    const item = kind === "partner" ? src.partners?.items.find((p) => p.id === id) : src.networks?.items.find((n) => n.key === id);
    if (!item) return errorOf("source_missing");
    const p = kind === "partner" ? proposePartner(item, list, t) : proposeNetwork(item, list, t);
    // On enregistre d'abord la proposition (désactivée), puis les champs saisis par-dessus : un seul chemin de vérification.
    const first = await mutate(ctx, (cfg) => { (kind === "partner" ? cfg.partners : cfg.networks)[id] = { enabled: false, name: p.name, aliases: p.aliases, text: p.text, role: "everyone", cdGlobal: null, cdUser: null, title: kind === "partner" ? item.title : item.name }; return { ok: true }; });
    if (first.ok === false) return first;
  }
  const r = await saveCommand(ctx, { kind, id }, fields, env);
  if (r.ok === false && !existing) await mutate(ctx, (cfg) => { delete (kind === "partner" ? cfg.partners : cfg.networks)[id]; return { ok: true }; });
  return r;
}

export async function removeCustom(ctx, id) {
  return mutate(ctx, (cfg) => { const before = cfg.custom.length; cfg.custom = cfg.custom.filter((c) => c.id !== id); return before === cfg.custom.length ? errorOf("unknown") : { ok: true }; });
}

/** Retire de la configuration les partenaires et réseaux dont la fiche ou le lien manque depuis plus de `days` jours. `known` : { partners, networks } = ensembles d'identifiants encore présents, ou null si la source n'a pas pu être lue (on ne touche à rien). */
export async function tidy(ctx, known, now = Date.now(), days = 14) {
  return mutate(ctx, (cfg) => {
    let changed = 0;
    for (const [bucket, ids] of [["partners", known.partners], ["networks", known.networks]]) {
      if (!ids) continue;
      for (const [id, o] of Object.entries(cfg[bucket])) {
        if (ids.has(id)) { if (o.missingSince) { delete o.missingSince; changed++; } continue; }
        if (!o.missingSince) { o.missingSince = now; changed++; } else if (now - o.missingSince > days * 86_400_000) { delete cfg[bucket][id]; changed++; }
      }
    }
    return { ok: true, changed };
  });
}

export { used, allowedFor };
