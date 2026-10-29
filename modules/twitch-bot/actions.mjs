// Les actions d'une récompense, en mots simples. La personne choisit « ce qui se passe » (répondre dans le chat, changer la couleur des lumières, lire un message, ou « autre chose
// chez moi » avec un NOM qu'elle donne) ; le module fabrique lui-même la clé technique (« perso:lancer-l-aspirateur ») et la garde STABLE : renommer une action ne change jamais sa clé,
// donc ce qui est relié côté maison ne casse pas. La clé n'est montrée qu'en mode avancé. Ce fichier ne dépend d'aucun autre fichier du bot (sauf le nettoyage et l'état) : il est
// partagé par les récompenses, l'administration, les outils et le sujet `home.actions`.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { clean } = await import(`./variables.mjs${v}`);
const st = await import(`./state.mjs${v}`);

export const ACTION_RE = /^[a-z0-9][a-z0-9:_-]{0,39}$/;
export const BOT_ACTION = "chat:repondre";
export const VOICE_ACTION = "tts:lire";
export const COLORS = ["rouge", "vert", "bleu", "jaune", "orange", "violet", "rose", "blanc"];
export const lightKey = (color) => `lumieres:${color}`;
/** Les actions de base. `home` : demande le Connecteur Home Assistant ; `input` : la personne qui prend la récompense écrit un message ; l'intitulé vient des textes `act_<clé avec _>`. */
export const KNOWN = [
  ...COLORS.map((c) => ({ key: lightKey(c), home: true })),
  { key: VOICE_ACTION, home: true, input: true }, { key: BOT_ACTION, home: false },
];
export const labelKey = (key) => `act_${key.replace(/[^a-z0-9]/g, "_")}`;
export const isHome = (key) => key !== BOT_ACTION;
export const needsInputFor = (key) => key === VOICE_ACTION;

/** Les actions nommées : 50 au plus (c'est aussi la taille du sujet `home.actions`), un nom de 60 caractères au plus, une clé fabriquée sur le modèle `perso:<nom>`. */
export const MAX_ACTIONS = 50, MAX_LABEL = 60, PREFIX = "perso:", MAX_LINKS = 50;
const COL = "homeAction";   // un document par action nommée : { key, label, at }

const rec = (x) => (x && typeof x === "object" && !Array.isArray(x) ? x : {});

/* ───────────── Noms et clés ───────────── */

const LETTERS = { "œ": "oe", "æ": "ae", "ß": "ss", "ø": "o", "đ": "d", "ł": "l" };
/** Minuscules, sans accents : « Lancer l’aspirateur » et « lancer l'aspirateur » se comparent pareil. */
const fold = (x) => String(x ?? "").normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[œæßøđł]/g, (c) => LETTERS[c]);
/** Le texte d'un nom pour la clé : minuscules sans accents, lettres et chiffres séparés par « - » ; vide s'il ne reste rien. */
export const slug = (x) => fold(x).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
/** Ce qui rend deux noms « le même » : même mots, sans tenir compte des majuscules, des accents ni de la ponctuation. */
export const nameKey = (x) => { const s = fold(x).replace(/[^\p{L}\p{N}]+/gu, " ").trim(); return s || fold(x).trim(); };
export const sameName = (a, b) => nameKey(a) === nameKey(b);

/** Le nom tel qu'on le garde : une ligne, sans caractère de contrôle ni balise, 60 caractères (points de code) au plus ; `ok` vaut false si c'est vide ou trop long. */
export function cleanName(x) {
  const text = clean(String(x ?? "").replace(/[<>]+/g, ""), 400);
  const long = [...text].length > MAX_LABEL;
  return { text, ok: !!text && !long, code: !text ? "empty" : long ? "long" : null };
}
/** Un libellé sûr pour le sujet `home.actions` : nettoyé, 60 caractères (points de code) au plus. */
export const safeLabel = (x) => [...clean(String(x ?? "").replace(/[<>]+/g, ""), 400)].slice(0, MAX_LABEL).join("").trim();

/**
 * La clé fabriquée à partir d'un nom : `perso:` + le nom en minuscules sans accents (lettres, chiffres, « - »), 40 caractères au plus au total ; si elle est prise, `-2`, `-3`…
 * `taken` : l'ensemble des clés déjà utilisées. Forme garantie : ^[a-z0-9][a-z0-9:_-]{0,39}$.
 */
export function keyFor(label, taken) {
  const room = 40 - PREFIX.length;
  const base = slug(label).slice(0, room).replace(/-+$/, "") || "action";
  let key = `${PREFIX}${base}`;
  for (let n = 2; taken.has(key) && n < 1000; n += 1) {
    const suffix = `-${n}`;
    key = `${PREFIX}${base.slice(0, room - suffix.length).replace(/-+$/, "") || "action"}${suffix}`;
  }
  return key;
}

/* ───────────── Les actions nommées ───────────── */

const byAge = (a, b) => (new Date(a.createdAt) - new Date(b.createdAt)) || String(a.id).localeCompare(String(b.id));
/** Les actions nommées enregistrées : [{ id, key, label }], les plus anciennes d'abord, 50 au plus. */
export async function list(ctx) {
  const rows = (await ctx.api.store.list(COL, { limit: MAX_ACTIONS + 10 })).slice().sort(byAge);
  const seen = new Set(), out = [];
  for (const r of rows) {
    const d = rec(r.data), key = String(d.key ?? ""), label = safeLabel(d.label) || key;
    if (!ACTION_RE.test(key) || seen.has(key) || KNOWN.some((k) => k.key === key)) continue;
    seen.add(key); out.push({ id: r.id, key, label });
  }
  return out.slice(0, MAX_ACTIONS);
}
/** Les mots de l'ancien réglage « Autres actions » (mode avancé) qui ne sont pas déjà des actions de base : ils continuent de marcher. */
export const legacyKeys = (s) => [...new Set((s?.extraActions ?? []).filter((k) => ACTION_RE.test(k) && !KNOWN.some((x) => x.key === k)))];
/** Toutes les actions nommées : celles enregistrées, puis les mots de l'ancien réglage qui n'y sont pas encore (leur nom est le mot lui-même). 50 au plus. */
export async function named(ctx, s) {
  const mine = await list(ctx), have = new Set(mine.map((a) => a.key));
  const legacy = legacyKeys(s).filter((k) => !have.has(k)).map((key) => ({ id: null, key, label: key, legacy: true }));
  return [...mine, ...legacy].slice(0, MAX_ACTIONS);
}

/** key → nom lisible, pour les actions de base (dans la langue de `t`) comme pour les actions nommées. Jamais de clé dans un nom. */
export function names(t, namedList) {
  const m = new Map(KNOWN.map((k) => [k.key, t(labelKey(k.key))]));
  for (const a of namedList) m.set(a.key, a.label);
  return m;
}
/** Le nom à montrer pour `key` : celui de la liste ; sinon (action disparue) « Action inconnue » ; avec `advanced`, la clé est ajoutée entre parenthèses. */
export function labelOf(t, map, key, { advanced = false } = {}) {
  const name = map.get(key) ?? t("rw_action_unknown");
  return advanced ? `${name} (${key})` : name;
}

/**
 * Prépare une action nommée SANS rien écrire : le nom donné existe déjà (même mots) → on la reprend ; sinon on prévoit une nouvelle clé. `wantedKey` (mode avancé) impose la clé d'une nouvelle action.
 * `rewardKeys` : les clés déjà portées par des récompenses (pour ne jamais en réutiliser une par hasard).
 * Rend { ok: true, action: { key, label }, isNew } ou { ok: false, code: "empty" | "long" | "too_many" | "key" | "key_taken" }.
 */
export async function plan(ctx, s, name, { wantedKey = "", rewardKeys = [] } = {}) {
  const n = cleanName(name);
  if (!n.ok) return { ok: false, code: n.code };
  const all = await named(ctx, s);
  const hit = all.find((a) => sameName(a.label, n.text));
  if (hit) return { ok: true, action: { key: hit.key, label: hit.label }, isNew: false };
  if (all.length >= MAX_ACTIONS) return { ok: false, code: "too_many" };
  const taken = new Set([...KNOWN.map((k) => k.key), ...all.map((a) => a.key), ...rewardKeys]);
  const want = String(wantedKey ?? "").trim();
  if (want) {
    if (!ACTION_RE.test(want)) return { ok: false, code: "key" };
    if (taken.has(want)) return { ok: false, code: "key_taken" };
    return { ok: true, action: { key: want, label: n.text }, isNew: true };
  }
  return { ok: true, action: { key: keyFor(n.text, taken), label: n.text }, isNew: true };
}
/** Enregistre l'action prévue par `plan` si elle est nouvelle (sans doublon, même appelée deux fois). */
export function commit(ctx, p) {
  if (!p?.isNew) return Promise.resolve();
  return st.serial(ctx, "actions", async () => {
    if ((await list(ctx)).some((a) => a.key === p.action.key)) return;
    await ctx.api.store.add(COL, { key: p.action.key, label: p.action.label, at: Date.now() });
  });
}
/** Défait `commit` d'une action NOUVELLE (la création de la récompense a échoué chez Twitch). */
export function discard(ctx, p) {
  if (!p?.isNew) return Promise.resolve();
  return st.serial(ctx, "actions", async () => { for (const a of await list(ctx)) if (a.key === p.action.key) await ctx.api.store.remove(a.id); });
}

/**
 * Change le nom d'une action (et, en mode avancé seulement, sa clé). Rend { ok: true, from, to } ou { ok: false, code: "unknown" | "empty" | "long" | "dup" | "key" | "key_taken" }.
 * Si la clé change, l'appelant doit la reporter sur les récompenses (rewards.retarget). Sans `newKey`, la clé ne change JAMAIS.
 */
export function rename(ctx, s, key, name, { newKey = "", rewardKeys = [] } = {}) {
  return st.serial(ctx, "actions", async () => {
    const n = cleanName(name);
    if (!n.ok) return { ok: false, code: n.code };
    const all = await named(ctx, s), cur = all.find((a) => a.key === key);
    if (!cur) return { ok: false, code: "unknown" };
    if (all.some((a) => a.key !== key && sameName(a.label, n.text))) return { ok: false, code: "dup" };
    const to = String(newKey ?? "").trim() || key;
    if (to !== key) {
      if (!ACTION_RE.test(to)) return { ok: false, code: "key" };
      if (KNOWN.some((k) => k.key === to) || all.some((a) => a.key === to) || rewardKeys.includes(to)) return { ok: false, code: "key_taken" };
    }
    if (cur.id) await ctx.api.store.update(cur.id, { key: to, label: n.text, at: Date.now() });
    else await ctx.api.store.add(COL, { key: to, label: n.text, at: Date.now() });   // un mot de l'ancien réglage qu'on nomme enfin : il rejoint la liste
    return { ok: true, from: key, to, label: n.text };
  });
}
/** Retire une action nommée qu'aucune récompense n'utilise. `used` : les clés portées par des récompenses. Rend { ok: true } ou { ok: false, code: "unknown" | "used" | "legacy" }. */
export function remove(ctx, s, key, used) {
  return st.serial(ctx, "actions", async () => {
    const cur = (await list(ctx)).find((a) => a.key === key);
    if (!cur) return { ok: false, code: legacyKeys(s).includes(key) ? "legacy" : "unknown" };
    if (used.includes(key)) return { ok: false, code: "used" };
    if (legacyKeys(s).includes(key)) return { ok: false, code: "legacy" };   // l'ancien réglage la remettrait aussitôt : on le retire là-bas
    await ctx.api.store.remove(cur.id);
    return { ok: true };
  });
}

/* ───────────── Migration : l'ancien réglage « Autres actions » devient des actions nommées ───────────── */

/**
 * Données 3 : chaque mot de l'ancien réglage `extraActions`, et chaque clé portée par une récompense qui n'est ni de base ni déjà nommée, devient une action nommée dont le NOM est le mot.
 * Rien n'est perdu, aucune récompense ne change, l'ancien réglage continue de marcher (il reste lu) ; rejouée, la migration n'ajoute rien. Rend le nombre d'actions ajoutées.
 */
export async function migrate(ctx, s, rewardActions = []) {
  return st.serial(ctx, "actions", async () => {
    const mine = await list(ctx), have = new Set(mine.map((a) => a.key));
    const want = [...new Set([...legacyKeys(s), ...rewardActions.filter((k) => ACTION_RE.test(k) && !KNOWN.some((x) => x.key === k))])];
    let added = 0;
    for (const key of want) {
      if (have.has(key) || have.size >= MAX_ACTIONS) continue;
      await ctx.api.store.add(COL, { key, label: key, at: Date.now() });
      have.add(key); added += 1;
    }
    return added;
  });
}

/* ───────────── Ce que la maison sait de chaque action (dans l'état du bot) ───────────── */

/** Note ce que Home Assistant a répondu pour une action : "unmapped" (pas encore de script relié) ou "ok" (elle a marché). Une écriture seulement si ça change ; 50 actions au plus. */
export async function noteLink(ctx, key, status, now = Date.now()) {
  if (!ACTION_RE.test(String(key)) || !["unmapped", "ok"].includes(status)) return;
  if (rec(rec((await st.readState(ctx)).links)[key]).s === status) return;
  await st.updateState(ctx, (d) => {
    const links = { ...rec(d.links), [key]: { s: status, at: now } };
    const keys = Object.keys(links);
    if (keys.length > MAX_LINKS) for (const k of keys.sort((a, b) => (links[a].at ?? 0) - (links[b].at ?? 0)).slice(0, keys.length - MAX_LINKS)) delete links[k];
    d.links = links;
  });
}
/** Les actions que Home Assistant a dit ne pas connaître (pas de script relié). */
export const unmappedKeys = (state) => Object.entries(rec(rec(state).links)).filter(([, x]) => rec(x).s === "unmapped").map(([k]) => k);
export const linkOf = (state, key) => { const s = rec(rec(rec(state).links)[key]).s; return s === "unmapped" || s === "ok" ? s : null; };

/* ───────────── Le sujet `home.actions` ───────────── */

/**
 * Ce que le Bot Twitch publie pour que le Connecteur Home Assistant sache les NOMS : [{ key, label }], 50 au plus, libellé ≤ 60 caractères, déjà nettoyé, dans la langue de `t`.
 * Les actions de la maison de base (lumières, voix) n'y sont que si une récompense les utilise ; les actions nommées y sont toutes. Aucun secret, aucune récompense, aucun viewer.
 * `rewardActions` : les clés portées par des récompenses.
 */
export async function catalog(ctx, s, t, rewardActions) {
  const used = new Set(rewardActions);
  const items = [];
  for (const k of KNOWN) if (k.home && used.has(k.key)) items.push({ key: k.key, label: t(labelKey(k.key)) });
  for (const a of await named(ctx, s)) items.push({ key: a.key, label: a.label });
  const seen = new Set();
  return items.map((i) => ({ key: i.key, label: safeLabel(i.label) || i.key }))
    .filter((i) => ACTION_RE.test(i.key) && !seen.has(i.key) && seen.add(i.key))
    .slice(0, MAX_ACTIONS);
}
