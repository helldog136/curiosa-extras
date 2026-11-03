// Planning : « Ajouter les jeux joués à la liste ». Quand le réglage `addPlayedGames` est oui, le jeu d'un stream COMMENCÉ (en cours ou passé) est ajouté à la liste « Déjà joué » du module
// « Suggestions de jeux », par son service `game.played` (version 1, besoin FACULTATIF). Jamais un stream à venir ni annulé, jamais une journée entière.
//   - Aucun minuteur : la synchronisation part (sans être attendue) quand le Planning lit les streams, au plus une fois toutes les 10 minutes par instance, sur les 7 derniers jours.
//   - Bornes : 20 jeux au plus par passage, 100 caractères au plus par nom, un appel à la fois, 4 secondes au plus par appel. Un jeu déjà envoyé n'est pas renvoyé tant que le site tourne.
//   - Idempotent des deux côtés : le fournisseur compare sans tenir compte des accents, des majuscules ni de la ponctuation et ne modifie JAMAIS une ligne qui existe déjà.
//   - Rien n'est gardé par le Planning (aucune liste, aucun journal) ; sans Suggestions de jeux, ou si l'appel échoue, il ne se passe rien et le prochain passage réessaie.
export const SERVICE = "game.played";
export const timing = { everyMs: 10 * 60_000, lookbackMs: 7 * 86_400_000, callMs: 4000, collectMs: 5000 };
export const LIMITS = { games: 20, title: 100, memory: 500 };

/** Le réglage : non sauf un « oui » explicite (jamais activé sans que la personne l'ait choisi). */
export function playedOn(ctx) {
  let v; try { v = ctx.setting?.("addPlayedGames"); } catch { v = undefined; }
  return v === true || v === "true" || v === 1 || v === "1" || v === "on";
}

/** Même idée que le fournisseur : sans accent, sans majuscule, sans ponctuation. */
export const keyOf = (title) => {
  const t = String(title ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  return t.replace(/[^\p{L}\p{N}]+/gu, "") || t.trim();
};

/** Les jeux à envoyer : ceux des créneaux (de `toSlots`) COMMENCÉS, pas annulés, pas en journée entière ; sans doublon, 20 au plus, dans l'ordre des streams. */
export function playedGames(slots, now = Date.now()) {
  const out = new Map();
  for (const s of Array.isArray(slots) ? slots : []) {
    if (!s || s.allDay || s.cancelled || !(s.start instanceof Date) || s.start.getTime() > now) continue;
    for (const g of Array.isArray(s.games) ? s.games : []) {
      const title = String(g ?? "").replace(/\s+/g, " ").trim();
      const k = keyOf(title);
      if (title && title.length <= LIMITS.title && k && !out.has(k)) out.set(k, title);
    }
  }
  return [...out].slice(0, LIMITS.games);
}

const SLOW = Symbol("slow");
const within = (p, ms) => { let t; return Promise.race([Promise.resolve(p).catch(() => SLOW), new Promise((r) => { t = setTimeout(() => r(SLOW), ms); t.unref?.(); })]).finally(() => clearTimeout(t)); };

const state = new Map();   // clé d'instance -> { at, sent: Set, run }
export const resetPlayed = () => state.clear();
/** Attend la synchronisation en cours (essais). */
export const playedSettled = () => Promise.all([...state.values()].map((s) => s.run));

/**
 * Lance (sans attendre) un passage si le réglage est oui et que le dernier date de plus de 10 minutes. `read(from, to)` lit les streams (ici : `collectSlots`), `toSlots` les met en forme.
 * Rend la promesse du passage, ou null s'il n'y en a pas.
 */
export function syncPlayed(ctx, { read, toSlots }, now = Date.now()) {
  if (!playedOn(ctx)) return null;
  const k = ctx.instance?.key ?? ctx.instance?.id ?? "";
  const st = state.get(k) ?? { at: -Infinity, sent: new Set(), run: null };
  if (st.run && st.pending) return st.run;
  if (now - st.at < timing.everyMs) return null;
  st.at = now; st.pending = true;
  state.set(k, st);
  st.run = (async () => {
    const list = await within(read(new Date(now - timing.lookbackMs), new Date(now)), timing.collectMs);
    if (list === SLOW || list.failed) { st.at = -Infinity; return; }   // pas de lecture : on réessaie au prochain passage
    const games = playedGames(toSlots(list.items), now).filter(([key]) => !st.sent.has(key));
    for (const [key, title] of games) {
      const r = await within(ctx.api.services.call(SERVICE, "add", { title, via: "planning" }), timing.callMs);
      if (r === SLOW || !r || r.ok !== true || r.value?.ok !== true) {
        if ((r && (r.reason === "unavailable" || r.reason === "undeclared")) || r?.value?.error === "full") break;   // pas de fournisseur, ou liste pleine : inutile d'insister ; sinon on passe au jeu suivant
        continue;
      }
      st.sent.add(key);
      while (st.sent.size > LIMITS.memory) st.sent.delete(st.sent.values().next().value);
    }
  })().catch(() => {}).finally(() => { st.pending = false; });
  return st.run;
}

/** Suggestions de jeux est-il là ? Pour l'administration : true · false · null (ne répond pas). */
export async function hasList(ctx) {
  const list = await within(Promise.resolve().then(() => ctx.api.services.providers(SERVICE)), 1500);
  return list === SLOW ? null : Array.isArray(list) && list.length > 0;
}
