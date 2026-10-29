// Les récompenses en points de chaîne créées PAR CURIOSA : leur liste (document `reward` par récompense, 20 au plus), leur vérification, et leurs appels à Twitch
// (créer, modifier, mettre en pause, supprimer) avec le jeton de la chaîne, par le Connecteur Twitch. Les détails de Twitch sont dans eventsub.mjs (hypothèses non vérifiées en tête).
// Seules les récompenses créées par notre application sont gérables : la liste de Twitch est lue avec `only_manageable_rewards`, les autres n'existent pas pour nous.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const es = await import(`./eventsub.mjs${v}`);
const st = await import(`./state.mjs${v}`);
const { accounts, twitch } = await import(`./listen.mjs${v}`);
const { checkTemplate, clean } = await import(`./variables.mjs${v}`);
const A = await import(`./actions.mjs${v}`);

export const MAX_REWARDS = es.LIMITS.maxRewards;
// Les actions (clés, noms, actions nommées) sont dans actions.mjs ; ils restent exportés d'ici pour ceux qui les ont toujours pris ici.
export const { ACTION_RE, BOT_ACTION, KNOWN, labelKey, isHome, needsInputFor } = A;
/** Les clés permises dans la liste : les actions de base, celles de l'ancien réglage « Autres actions » (les invalides sont écartées) et les actions nommées (`named` : leurs clés). */
export const allowedKeys = (s, named = []) => [...new Set([...KNOWN.map((k) => k.key), ...(s.extraActions ?? []).filter((k) => ACTION_RE.test(k)), ...named.filter((k) => ACTION_RE.test(k))])];

const rec = (x) => (x && typeof x === "object" && !Array.isArray(x) ? x : {});
const COL = "reward";
export async function list(ctx) {
  const rows = (await ctx.api.store.list(COL, { limit: MAX_REWARDS + 5 })).slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  return rows.map((r) => ({ id: r.id, ...rec(r.data) }));
}
export const byTwitchId = async (ctx, tid) => (await list(ctx)).find((r) => r.tid === tid) ?? null;
const save = (ctx, doc) => { const { id, ...data } = doc; return ctx.api.store.update(id, data); };

/** État affiché : "gone" (supprimée chez Twitch) · "refused" (Twitch a refusé notre dernière demande) · "paused" · "active". */
export const statusOf = (r) => (r.gone ? "gone" : r.refused ? "refused" : r.pause ? "paused" : "active");

/* ───────────── Vérification des champs ───────────── */

const num = (x) => { const n = typeof x === "number" ? x : Number(String(x ?? "").replace(",", ".").trim()); return Number.isFinite(n) ? n : NaN; };
/**
 * Vérifie une récompense saisie. `raw` : { title, cost, cooldownMin | cooldown (secondes), prompt, needsInput, action (la clé), reply }. `others` : les autres récompenses (doublon de titre) ; `named` : les clés des actions nommées.
 * Rend { ok: true, value } ou { ok: false, errors: { champ: code } } ; codes : title, title_long, dup, cost, cooldown, prompt, action, reply, reply_vars (+ `vars`).
 */
export function check(raw, { s, others = [], prefix = "!", named = [] }) {
  const errors = {}, r = rec(raw);
  const title = clean(r.title, 100);
  if (!title) errors.title = "title"; else if ([...title].length > es.LIMITS.title) errors.title = "title_long";
  else if (others.some((o) => o.title.toLowerCase() === title.toLowerCase())) errors.title = "dup";
  const cost = num(r.cost);
  if (!Number.isInteger(cost) || cost < 1 || cost > es.LIMITS.maxCost) errors.cost = "cost";
  const cdSec = r.cooldown !== undefined ? num(r.cooldown) : (String(r.cooldownMin ?? "").trim() === "" ? 0 : num(r.cooldownMin) * 60);
  if (!Number.isFinite(cdSec) || cdSec < 0 || cdSec > es.LIMITS.maxCooldown || !Number.isInteger(Math.round(cdSec))) errors.cooldown = "cooldown";
  const prompt = clean(r.prompt, 400);
  if ([...prompt].length > es.LIMITS.prompt) errors.prompt = "prompt";
  const action = String(r.action ?? "").trim();
  if (!ACTION_RE.test(action) || !allowedKeys(s, named).includes(action)) errors.action = "action";
  let reply = "";
  if (action === BOT_ACTION) {
    const t = checkTemplate(r.reply, "reward", prefix);
    if (!t.ok) { errors.reply = t.code === "unknown" ? "reply_vars" : `reply_${t.code}`; if (t.vars) errors.vars = t.vars.map((x) => `{${x}}`).join(", "); } else reply = t.text;
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { title, cost, cooldown: Math.round(cdSec), prompt, action, reply, needsInput: needsInputFor(action) ? true : r.needsInput === true || r.needsInput === "on" } };
}

/* ───────────── Accès à Twitch ───────────── */

/** Peut-on gérer les récompenses ? { ok: true, channel, broadcasterId } ou { ok: false, code } : no_channel · creds_missing · need_connect · need_reconnect · need_scope · twitch_down. */
export async function access(ctx, s) {
  const acc = await accounts(ctx, s);
  if (acc.problem) return { ok: false, code: acc.problem === "twitch_down" ? "twitch_down" : "no_channel" };
  const m = acc.main;
  if (!m?.channel) return { ok: false, code: "no_channel" };
  if (!m.ready) return { ok: false, code: "creds_missing", adminPath: m.adminPath };
  if (m.status === "none" || !m.userId) return { ok: false, code: "need_connect" };
  if (m.status === "reconnect") return { ok: false, code: "need_reconnect" };
  if (!es.REWARD_SCOPES.every((x) => (m.scopes ?? []).includes(x))) return { ok: false, code: "need_scope" };
  return { ok: true, channel: m.channel, broadcasterId: m.userId };
}

/** Une opération Helix : { ok: true, rewards } ou { ok: false, code } (voir readReward ; plus "denied" si l'autorisation manque, "rate", "twitch"). Note aussi « compte sans points de chaîne ». */
export async function call(ctx, acc, req) {
  const res = await twitch(ctx, acc.channel, req);
  let out;
  if (!res.ok) out = { ok: false, code: res.error === "auth" || res.error === "scope" ? "denied" : res.error === "rate" ? "rate" : "twitch" };
  else out = es.readReward(res);
  if (out.code === "na") await st.updateState(ctx, (d) => { d.rewardsNA = Date.now(); }).catch(() => {});
  else if (out.ok && (await st.readState(ctx)).rewardsNA) await st.updateState(ctx, (d) => { delete d.rewardsNA; }).catch(() => {});
  return out;
}

/* ───────────── Créer, modifier, supprimer, mettre en pause ───────────── */

const guard = (ctx, fn) => st.serial(ctx, "rewards", fn);

export function create(ctx, s, value) {
  return guard(ctx, async () => {
    const rows = await list(ctx);
    if (rows.length >= MAX_REWARDS) return { ok: false, code: "too_many" };
    const acc = await access(ctx, s);
    if (!acc.ok) return acc;
    const r = await call(ctx, acc, es.rewardRequests.create(acc.broadcasterId, value));
    if (!r.ok) return r;
    const tid = r.rewards[0]?.id;
    if (!tid) return { ok: false, code: "twitch" };
    const doc = { tid, ...value, pause: null, gone: false, refused: null };
    const id = await ctx.api.store.add(COL, doc);
    const created = { id, ...doc };
    // Les récompenses de la maison naissent en pause tant que la maison est coupée ou hors direct : jamais d'échange qui ne pourrait pas être joué.
    if (isHome(value.action) && (await st.readState(ctx)).applied === "paused") await pauseOne(ctx, acc, created, true, "auto");
    return { ok: true, id };
  });
}

export function update(ctx, s, id, value) {
  return guard(ctx, async () => {
    const doc = (await list(ctx)).find((r) => r.id === id);
    if (!doc) return { ok: false, code: "unknown" };
    if (doc.gone) { await ctx.api.store.remove(id); return { ok: false, code: "gone" }; }
    const acc = await access(ctx, s);
    if (!acc.ok) return acc;
    const r = await call(ctx, acc, es.rewardRequests.update(acc.broadcasterId, doc.tid, value));
    if (!r.ok) { if (r.code === "gone") { await save(ctx, { ...doc, gone: true }); } else if (r.code === "refused" || r.code === "duplicate") { await save(ctx, { ...doc, refused: { code: r.code, at: Date.now() } }); } return r; }
    const next = { ...doc, ...value, refused: null };
    await save(ctx, next);
    return { ok: true };
  });
}

export function remove(ctx, s, id) {
  return guard(ctx, async () => {
    const doc = (await list(ctx)).find((r) => r.id === id);
    if (!doc) return { ok: true };
    if (!doc.gone) {
      const acc = await access(ctx, s);
      if (!acc.ok) return acc;
      const r = await call(ctx, acc, es.rewardRequests.remove(acc.broadcasterId, doc.tid));
      if (!r.ok && r.code !== "gone") return r;
    }
    await ctx.api.store.remove(id);
    return { ok: true };
  });
}

/** Une clé d'action change (mode avancé) : les récompenses qui la portaient portent la nouvelle. Rien n'est envoyé à Twitch (l'action ne s'y trouve pas). Rend le nombre de récompenses touchées. */
export function retarget(ctx, from, to) {
  return guard(ctx, async () => {
    let n = 0;
    for (const doc of await list(ctx)) if (doc.action === from) { await save(ctx, { ...doc, action: to }); n += 1; }
    return n;
  });
}

async function pauseOne(ctx, acc, doc, paused, by) {
  const r = await call(ctx, acc, es.rewardRequests.pause(acc.broadcasterId, doc.tid, paused));
  if (r.ok) await save(ctx, { ...doc, pause: paused ? by : null, refused: null });
  else if (r.code === "gone") await save(ctx, { ...doc, gone: true });
  else if (r.code === "refused") await save(ctx, { ...doc, refused: { code: r.code, at: Date.now() } });
  return r;
}
/** Pause ou reprise voulue par la propriétaire (bouton). */
export function setPaused(ctx, s, id, paused) {
  return guard(ctx, async () => {
    const doc = (await list(ctx)).find((r) => r.id === id);
    if (!doc || doc.gone) return { ok: false, code: "unknown" };
    const acc = await access(ctx, s);
    if (!acc.ok) return acc;
    return pauseOne(ctx, acc, doc, paused, "owner");
  });
}

/**
 * Lit les récompenses chez Twitch et met la liste au clair : une récompense qui n'existe plus est marquée « supprimée chez Twitch », une pause faite chez Twitch est reconnue.
 * Une seule demande ; au plus une toutes les 30 s par instance (admin ouverte en boucle). Ne lève jamais.
 */
const lastSync = new Map();
export function sync(ctx, s, { now = Date.now(), force = false } = {}) {
  const k = ctx.instance.key;
  if (!force && (lastSync.get(k) ?? 0) > now - 30_000) return Promise.resolve({ ok: true, skipped: true });
  lastSync.set(k, now);
  return guard(ctx, async () => {
    const rows = await list(ctx);
    if (!rows.length) return { ok: true };
    const acc = await access(ctx, s);
    if (!acc.ok) return acc;
    const r = await call(ctx, acc, es.rewardRequests.list(acc.broadcasterId));
    if (!r.ok) return r;
    const there = new Map(r.rewards.map((x) => [x.id, x]));
    for (const doc of rows) {
      const t = there.get(doc.tid);
      let next = doc;
      if (!t) next = { ...doc, gone: true };
      else {
        next = { ...doc, gone: false };
        if (t.paused && !doc.pause) next.pause = "owner";
        if (!t.paused && doc.pause) next.pause = null;
      }
      if (JSON.stringify(next) !== JSON.stringify(doc)) await save(ctx, next);
    }
    return { ok: true };
  }).catch(() => ({ ok: false, code: "twitch" }));
}

/**
 * La maison est-elle prête ? `state` : le dernier `ha.state` ({ enabled, live, paired }). Prête → on remet en vente les récompenses MISES EN PAUSE PAR NOUS ; sinon on met en pause celles de la maison.
 * N'agit qu'au CHANGEMENT d'état (noté dans `applied`) ; un échec est retenté au prochain évènement (au plus toutes les 30 s). Aucun minuteur.
 */
const lastApply = new Map();
export const resetRewards = () => { lastSync.clear(); lastApply.clear(); };
export function applyHouseState(ctx, s, state, { now = Date.now() } = {}) {
  if (!state || typeof state !== "object") return Promise.resolve({ ok: true, skipped: true });
  const ready = state.enabled === true && state.live === true && state.paired !== false;
  const k = ctx.instance.key;
  return guard(ctx, async () => {
    const d = await st.readState(ctx);
    const want = ready ? "run" : "paused";
    if (d.applied === want) return { ok: true, same: true };
    if ((lastApply.get(k) ?? 0) > now - 30_000) return { ok: true, skipped: true };   // seulement après un échec : on ne harcèle pas Twitch
    const rows = await list(ctx);
    const todo = rows.filter((r) => !r.gone && (ready ? r.pause === "auto" : isHome(r.action) && !r.pause));
    let done = true;
    if (todo.length) {
      const acc = await access(ctx, s);
      if (!acc.ok) return acc;
      for (const doc of todo) {
        const r = await pauseOne(ctx, acc, doc, !ready, "auto");
        if (!r.ok && r.code !== "gone") { done = false; if (r.code === "rate" || r.code === "denied" || r.code === "na") break; }
      }
    }
    if (done) await st.updateState(ctx, (x) => { x.applied = want; }); else lastApply.set(k, now);
    return { ok: done };
  }).catch(() => ({ ok: false, code: "twitch" }));
}
