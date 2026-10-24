// LA SÉLECTION DU MOMENT (2.2) : N membres en direct tirés au hasard, STABLES pendant une durée réglable, les mêmes pour tout le monde (dock de sélection d'OBS, page publique,
// outil de l'assistant). Ce fichier assemble les morceaux ; les règles du tirage sont dans draw.mjs, le consentement dans consent.mjs.
//
// Comment ça marche, sans minuteur ni disque :
//   - Le temps est découpé en tranches de `duration` minutes (réglage, 10 par défaut) alignées sur l'horloge. À la première lecture d'une tranche, on tire N membres ;
//     toutes les lectures suivantes de la tranche (n'importe quel visiteur, n'importe quel rafraîchissement) rendent LES MÊMES, avec leurs chiffres à jour. À la tranche suivante,
//     une nouvelle sélection est tirée : tout est calculé à la lecture.
//   - La graine du tirage vient de (instance, tranche, nombre de « Tirer de nouveau ») : deux lectures qui arrivent en même temps, ou un redémarrage du site, retombent sur le même tirage.
//   - Un membre choisi qui n'est plus en direct est remplacé (et si moins de N étaient en direct au tirage, la sélection se complète quand d'autres arrivent) ; les autres ne bougent pas.
//   - Rotation : la mémoire des derniers membres montrés (200 pseudos au plus) fait que personne ne revient tant que d'autres sont en direct (voir draw.mjs).
//   - Qui est en direct vient du cache existant du dock (`liveNow` : un appel groupé pour 100 chaînes, gardé 30 s). Au-delà de 500 chaînes, on ne peut pas tout vérifier : on
//     vérifie seulement les membres déjà choisis (un appel, gardé 30 s) et, quand il en faut d'autres, on pioche des paquets de 100 comme la recherche « au hasard » (mêmes bornes).
//   - Twitch ou Contacts en panne : le dernier état connu sert 10 minutes au plus (« stale »), puis l'erreur est dite.
// Tout est en MÉMOIRE du processus (rien sur le disque) ; un redémarrage oublie la rotation, sans conséquence.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const D = await import(`./draw.mjs${v}`);
const { modeFor } = await import(`./pure.mjs${v}`);
const source = await import(`./source.mjs${v}`);
const live = await import(`./live.mjs${v}`);
const search = await import(`./search.mjs${v}`);
const streams = await import(`./streams.mjs${v}`);
const consent = await import(`./consent.mjs${v}`);
const { settingsOf } = await import(`./settings.mjs${v}`);

/** Pour les tests : l'horloge et, au besoin, le générateur aléatoire (sinon une graine tirée de l'instance, de la tranche et du nombre de « Tirer de nouveau »). */
export const hooks = { now: () => Date.now(), rng: null };
/** Les délais (en millisecondes). Un objet pour que les tests puissent les raccourcir. */
export const timing = { rerollGapMs: 5000, staleMs: 10 * 60_000, verifyOkMs: 30_000, verifyFailMs: 15_000 };
const STATES_MAX = 50;

const states = new Map();          // instance → l'état de la sélection (voir stateOf)
const verifyCache = new Map(), verifyInflight = new Map();
export const resetMoment = () => { states.clear(); verifyCache.clear(); verifyInflight.clear(); consent.resetConsent(); };

function stateOf(key) {
  let st = states.get(key);
  if (!st) {
    if (states.size >= STATES_MAX) states.delete(states.keys().next().value);
    st = { slot: -1, reroll: 0, picks: [], recent: [], rerolledAt: 0, known: new Map(), lastGood: null };
    states.set(key, st);
  }
  return st;
}

/** Les réglages de la sélection, lus et ramenés dans leurs bornes. */
export function momentSettings(ctx) {
  const ex = D.parseExclusions(ctx.setting("exclude"));
  return { count: D.clampCount(ctx.setting("count")), minutes: D.clampMinutes(ctx.setting("duration")), weighted: D.flag(ctx.setting("smallFirst")), exclude: ex.logins, ignored: ex.ignored, over: ex.over };
}

/** Un membre tel que le voient le dock de sélection et la page publique (jamais d'identifiant de fiche). */
export const view = (e) => ({ login: e.login, name: e.name, game: e.game, title: e.title, viewers: e.viewers, startedAt: e.startedAt, ...(streams.thumbOf(e) ? { thumb: streams.thumbOf(e) } : {}) });

/** Le dernier état connu si Twitch ou Contacts ne répond pas (10 minutes au plus), sinon l'erreur. */
function fallback(st, now, error) {
  const g = st.lastGood;
  return g && now - g.at <= timing.staleMs ? { ...g.result, stale: g.at, staleReason: error.reason } : error;
}

/** Vérifie que les membres déjà choisis sont toujours en direct (plus de 500 chaînes : un seul appel pour 10 pseudos au plus), gardé 30 s et partagé. */
function verifyPicks(ctx, partners, logins, settings) {
  const k = `${ctx.instance.key}|${logins.slice().sort().join(",")}`, hit = verifyCache.get(k);
  if (hit && hit.until > Date.now()) return Promise.resolve(hit.value);
  const pending = verifyInflight.get(k);
  if (pending) return pending;
  const work = (async () => {
    const c = await streams.within(streams.pickChannel(ctx, settings.channel).catch(() => ({ problem: "slow" })), streams.timing.callMs, { problem: "slow" });
    if (c.problem === "slow") return { error: "network" };
    if (c.problem) return { problem: c.problem };
    const byLogin = new Map(partners.map((p, pos) => [p.login, { ...p, pos }]));
    const group = logins.map((l) => byLogin.get(l)).filter((p) => p && p.login !== c.channel);
    if (!group.length) return { live: [] };
    const run = { closed: false, fatal: false };
    const r = await streams.within(streams.lookup(ctx, c.channel, ctx.instance.key, group, run), streams.timing.callMs, null);
    run.closed = true;
    return !r || r.checked < group.length ? { error: r?.error ?? "network" } : { live: r.live };
  })().catch(() => ({ error: "network" })).then((value) => {
    if (verifyCache.size >= STATES_MAX) verifyCache.delete(verifyCache.keys().next().value);
    verifyCache.set(k, { value, until: Date.now() + (value.live ? timing.verifyOkMs : timing.verifyFailMs) });
    return value;
  }).finally(() => { if (verifyInflight.get(k) === work) verifyInflight.delete(k); });
  verifyInflight.set(k, work);
  return work;
}

const toNotReady = (reason) => ({ state: "not_ready", reason });
const toError = (reason) => ({ state: "error", reason });
const failureOf = (r) => (r.state === "not_ready" ? toNotReady(r.reason) : toError(r.state === "limited" ? "rate" : r.reason ?? "network"));

/**
 * Qui est en direct et pourrait être tiré : { eligible: [entrées], partial } ou { problem: l'état à rendre }.
 * Jusqu'à 500 chaînes : la vue complète du dock (cache de 30 s). Au-delà : les membres déjà choisis (vérifiés) et, si `needMore`, un échantillon de paquets de 100.
 */
async function liveCandidates(ctx, partners, s, st, needMore) {
  const settings = settingsOf(ctx);
  if (modeFor(partners.length) === "full") {
    const r = await live.liveNow(ctx, partners, settings);
    if (r.state === "no_partners") return { problem: { state: "no_partners" } };
    if (r.state === "not_ready") return { problem: toNotReady(r.reason), config: true };
    if (r.state !== "ok") return { problem: toError(r.reason ?? "network"), transient: true };
    return { eligible: r.live.filter((x) => !s.exclude.has(x.login)), partial: !!r.partial };
  }
  const out = new Map();
  const kept = st.picks.filter((l) => !s.exclude.has(l));
  if (kept.length) {
    const r = await verifyPicks(ctx, partners, kept, settings);
    if (r.problem) return { problem: toNotReady(r.problem), config: true };
    if (r.error) return { problem: toError(r.error === "rate" ? "rate" : r.error), transient: true };
    for (const x of r.live) out.set(x.login, x);
  }
  if (needMore || out.size < s.count) {
    const f = await search.findMany(ctx, partners, settings, { want: Math.max(s.count * 3, s.count + 3), rng: hooks.rng ?? D.mulberry32(D.hashSeed(ctx.instance.key, "sample", Math.floor(hooks.now() / 60_000))), exclude: s.exclude });
    if (f.state === "found") { for (const x of f.entries) if (!out.has(x.login)) out.set(x.login, x); }
    else if (f.state === "not_ready") return { problem: toNotReady(f.reason), config: true };
    else if (f.state === "no_partners") return { problem: { state: "no_partners" } };
    else if (!out.size && f.state !== "none") return { problem: failureOf(f), transient: true };
  }
  return { eligible: [...out.values()], partial: false };
}

/** Garde la sélection de la tranche, la complète ou la retire, ou en tire une nouvelle. SYNCHRONE : deux lectures simultanées ne peuvent pas se croiser. */
function decide(key, st, { eligible, s, slot, reroll, partial, allowedKnown, now }) {
  const byLogin = new Map(eligible.map((x) => [x.login, x]));
  let rerolled = false;
  if (reroll && now - st.rerolledAt >= timing.rerollGapMs) { st.reroll++; st.rerolledAt = now; rerolled = true; }
  const fresh = rerolled || st.slot !== slot;
  let keep = [];
  if (!fresh) {
    keep = st.picks.map((l) => {
      const k = st.known.get(l);   // Twitch n'a pas pu vérifier toutes les chaînes : un membre choisi qui manque n'est pas forcément parti, on garde ce qu'on en savait (10 minutes au plus)
      return byLogin.get(l) ?? (partial && k && now - k.at <= timing.staleMs && allowedKnown.has(l) ? k.entry : null);
    }).filter(Boolean).slice(0, s.count);
  }
  const left = s.count - keep.length;
  if (left > 0) {
    const kept = new Set(keep.map((x) => x.login));
    const rng = hooks.rng ?? D.mulberry32(D.hashSeed(key, slot, st.reroll, fresh ? "draw" : `fill:${[...kept].sort().join(",")}`));
    const res = D.drawMoment({ eligible: eligible.filter((x) => !kept.has(x.login)), n: left, recent: st.recent, weighted: s.weighted, rng });
    keep = [...keep, ...res.picks];
    st.recent = res.recent;
  }
  st.slot = slot;
  st.picks = keep.map((x) => x.login);
  st.known = new Map(keep.map((x) => [x.login, { entry: x, at: now }]));
  return { picks: keep, rerolled };
}

/**
 * La sélection du moment. Rend toujours un objet, sans jamais lever :
 *   { state: "ok", picks: [{ login, name, game, title, viewers, startedAt, thumb? }], count, minutes, endsAt, pool, asOf, stale?, staleReason?, partial?, rerolled?, wait? }
 *   · { state: "no_partners" } · { state: "not_ready", reason } · { state: "error", reason }
 * `picks` est vide quand personne n'est en direct (`pool: 0`). `reroll` : « Tirer de nouveau » (au plus une fois toutes les 5 secondes ; sinon la sélection actuelle, avec `wait: true`).
 */
export async function momentNow(ctx, { reroll = false } = {}) {
  const key = ctx.instance.key, st = stateOf(key), s = momentSettings(ctx), now = hooks.now();
  try {
    const slotMs = s.minutes * 60_000, slot = Math.floor(now / slotMs);
    const src = await source.targets(ctx);
    if (src.state !== "ok") return src.problem === "contacts_down" ? fallback(st, now, toError("contacts")) : toNotReady(src.problem);
    const partners = src.partners;
    if (!partners.length) return { state: "no_partners" };
    const needMore = reroll || st.slot !== slot;
    const c = await liveCandidates(ctx, partners, s, st, needMore);
    if (c.problem) return c.transient ? fallback(st, now, c.problem) : c.problem;

    // Le consentement : seuls les membres en direct sont demandés à Contacts (100 par appel). Les membres déjà choisis mais non vus (vérification partielle) sont demandés aussi.
    const contactOf = new Map(partners.map((p) => [p.login, p.contactId]));
    const retained = c.partial ? st.picks.filter((l) => !s.exclude.has(l) && !c.eligible.some((x) => x.login === l)) : [];
    const ids = [...c.eligible.map((x) => contactOf.get(x.login)), ...retained.map((l) => contactOf.get(l))].filter(Boolean);
    const verdict = await consent.allowedContacts(ctx, ids);
    if (verdict.state !== "ok") return fallback(st, now, toError("contacts"));
    const ok = (l) => { const id = contactOf.get(l); return !!id && verdict.allowed.has(id); };
    const eligible = c.eligible.filter((x) => ok(x.login));
    const allowedKnown = new Set(retained.filter(ok));

    const { picks, rerolled } = decide(key, st, { eligible, s, slot, reroll, partial: c.partial, allowedKnown, now });
    const base = { state: "ok", picks: picks.map(view), count: s.count, minutes: s.minutes, endsAt: (slot + 1) * slotMs, pool: eligible.length, asOf: now, ...(c.partial ? { partial: true } : {}) };
    st.lastGood = { result: base, at: now };
    return { ...base, ...(rerolled ? { rerolled: true } : {}), ...(reroll && !rerolled ? { wait: true } : {}) };
  } catch {
    return fallback(st, now, toError("network"));
  }
}
