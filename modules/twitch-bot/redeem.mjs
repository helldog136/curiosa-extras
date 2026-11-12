// Un échange de points arrive : on le note UNE fois (clé = identifiant de l'échange), on lance l'action, puis on le valide (FULFILLED) ou on rend les points (CANCELED).
//   - action du bot (répondre dans le chat) : jouée tout de suite ;
//   - action de la maison : confiée au service facultatif `home-assistant.bridge` (file d'attente) ; la suite arrive par le sujet `ha.result`, lu À LA LECTURE SUIVANTE
//     (un évènement de Twitch, l'ouverture de l'administration, la tâche d'une minute, et quelques relectures espacées après un échange confié à la maison, voir `followUp`) : aucune boucle. Un échange sans résultat après `rewardWaitSec` est remboursé à ce moment-là.
// Journal : un document `redeem` par échange (50 résolus gardés + 100 en attente au plus, purge à la lecture) ; rien du message du viewer n'est gardé.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const es = await import(`./eventsub.mjs${v}`);
const st = await import(`./state.mjs${v}`);
const R = await import(`./rewards.mjs${v}`);
const collab = await import(`./collab.mjs${v}`);
const A = await import(`./actions.mjs${v}`);
const { settingsOf } = await import(`./settings.mjs${v}`);
const { diagnose, diagnoseFast, sendChat } = await import(`./listen.mjs${v}`);
const { render, pseudo, clean } = await import(`./variables.mjs${v}`);

const COL = "redeem";
export const KEEP_RESOLVED = 50, MAX_WAITING = 100, SERVICE = "home-assistant.bridge";
/** Les raisons de refus du pont (liste fermée du contrat) ; toute autre valeur est une erreur. */
export const REASONS = ["off", "offline", "not_live", "blocked", "busy", "unknown_key", "not_paired"];
const BOUND_MS = 3000;
/** Pourquoi la maison n'a pas joué l'action, d'après SON accusé : le code précis quand elle a « ignoré » (pas de script relié, interrupteur coupé…), sinon le statut. */
const IGNORED = ["unmapped", "disabled", "expired"];   // (« ignored / error » reste « ignored » : Home Assistant l'a ignorée, sans plus de détail)
const reasonOf = (res) => (res.status === "done" ? "ok" : res.status === "ignored" && IGNORED.includes(res.code) ? res.code : String(res.status ?? "failed").slice(0, 20));
/** Ce que la maison dit d'une action : « pas encore de script » (à relier) ou « ça a marché ». Sert à l'écrire sur la récompense. Ne lève jamais. */
async function noteLink(ctx, action, res, now) {
  try {
    if (!R.isHome(action)) return;
    if (res.status === "done") await A.noteLink(ctx, action, "ok", now);
    else if (res.status === "ignored" && res.code === "unmapped") await A.noteLink(ctx, action, "unmapped", now);
  } catch { /* un plus : le journal reste juste sans lui */ }
}
const within = (p, ms, fallback) => { let t; return Promise.race([Promise.resolve().then(() => p).catch(() => fallback), new Promise((r) => { t = setTimeout(() => r(fallback), ms); t.unref?.(); })]).finally(() => clearTimeout(t)); };
const rec = (x) => (x && typeof x === "object" && !Array.isArray(x) ? x : {});

/* ───────────── Le service facultatif de la maison ───────────── */

/** Appelle `home-assistant.bridge.<method>` : { ok: true, value } ou { ok: false, reason: "unavailable" | … }. Ne lève jamais, borné. */
export async function bridge(ctx, method, args) {
  const r = await within(ctx.api.services.call(SERVICE, method, args), BOUND_MS, { ok: false, reason: "unavailable" });
  return r && typeof r === "object" ? r : { ok: false, reason: "unavailable" };
}
export async function bridgeInstalled(ctx) {
  try { return (await within(ctx.api.services.providers(SERVICE), BOUND_MS, [])).length > 0; } catch { return false; }
}
/** Où ouvrir la page d'administration du premier module `module` installé (un chemin du site, « /admin/… »), ou null. Borné. */
export async function adminPathOf(ctx, module) {
  try {
    const list = await within(ctx.api.instances.list({ module }), BOUND_MS, []);
    const path = Array.isArray(list) ? list.find((i) => !i?.module || i.module === module)?.adminPath : null;
    return typeof path === "string" && path.startsWith("/admin/") ? path : null;
  } catch { return null; }
}
const collect = async (ctx, topic, limit) => { try { const a = await within(ctx.api.topics.collect(topic, { limit }), BOUND_MS, []); return Array.isArray(a) ? a : []; } catch { return []; } };

/* ───────────── Journal ───────────── */

const rows = async (ctx) => (await ctx.api.store.list(COL, { limit: 400 })).map((r) => ({ id: r.id, ...rec(r.data) }));
const write = (ctx, doc) => { const { id, ...data } = doc; return ctx.api.store.update(id, data, { key: doc.rid }); };
/** Cet échange est-il déjà noté ? (index par clé quand le cœur l'offre, sinon lecture bornée.) */
const known = async (ctx, rid) => (typeof ctx.api.store.getByKey === "function" ? !!(await ctx.api.store.getByKey(COL, rid)) : (await rows(ctx)).some((r) => r.rid === rid));
const PENDING = new Set(["new", "waiting", "settle"]);

/** Le journal pour l'administration : les 50 derniers échanges (et ceux en attente) ; ce qui dépasse est supprimé ici, à la lecture. */
export async function journal(ctx) {
  const all = (await rows(ctx)).sort((a, b) => b.at - a.at);
  const keep = [], drop = [];
  let resolved = 0;
  for (const r of all) { if (PENDING.has(r.status) || resolved++ < KEEP_RESOLVED) keep.push(r); else drop.push(r); }
  for (const r of drop) await ctx.api.store.remove(r.id);
  return keep.slice(0, KEEP_RESOLVED + MAX_WAITING);
}
export const clearJournal = (ctx) => st.serial(ctx, "redeem", async () => { for (const r of await rows(ctx)) if (!PENDING.has(r.status)) await ctx.api.store.remove(r.id); });

/* ───────────── Valider ou rembourser ───────────── */

/** Collaboration mode is on and asks to mute the automatic messages of the bot (see collab.mjs). */
const quiet = async (ctx) => { try { const e = collab.effective(await st.readState(ctx)); return e.on && e.quiet; } catch { return false; } };
async function notice(ctx, s, text) {
  if (!s.rewardsNotice) return;
  if (await st.isMuted(ctx).catch(() => false)) return;   // paused (emergency stop): nothing is written in the chat, not even this notice
  if (await quiet(ctx)) return;   // collaboration mode with "mute the other automatic messages": not this notice either
  try { const d = await diagnose(ctx, s, { declare: false }); if (d.code === "ready") await sendChat(ctx, d, text); } catch { /* le message est un plus */ }
}

/** Raisons de remboursement normales (maison coupée, pas en direct, trop de demandes, message refusé…) : elles restent dans le journal des échanges, pas dans l'Historique. */
const BENIGN = new Set(["off", "not_live", "busy", "blocked", "no_text", "expired", "muted"]);
/** Journal du cœur (Historique) : un remboursement qui demande peut-être votre attention, ou un échange que Twitch n'a pas confirmé. Jamais le pseudo ni le message. Ne lève jamais. */
const centralLog = (ctx, action, doc) => ctx.api.log?.write({ action, data: { title: clean(doc.title, 45), ...(action === "reward.refunded" ? { reason: ctx.t(`rw_reason_${doc.reason}`) } : {}) } });

/** Envoie le verdict à Twitch pour un échange dont `doc.todo` est FULFILLED ou CANCELED. Met le document à jour ; ne lève jamais. */
async function settle(ctx, s, doc, acc) {
  const reward = await R.byTwitchId(ctx, doc.rewardTid);
  const res = await R.call(ctx, acc, es.rewardRequests.settle(acc.broadcasterId, doc.rewardTid, doc.rid, doc.todo));
  const final = doc.todo === "FULFILLED" ? "done" : "refunded";
  if (res.ok || res.code === "gone" || res.code === "refused") {   // déjà traité chez Twitch (ou plus à nous) : rien d'autre à faire
    const next = { ...doc, status: final, todo: null, closed: res.ok ? undefined : true };
    await write(ctx, next);
    if (final === "refunded" && res.ok && doc.reason && !BENIGN.has(doc.reason) && !doc.test) await centralLog(ctx, "reward.refunded", doc);
    if (final === "refunded" && res.ok && !doc.noticed) { await write(ctx, { ...next, noticed: true }); await notice(ctx, s, ctx.t("redeem_notice", { user: pseudo(doc.name || doc.user), reward: clean(doc.title, 45) })); }
    return next;
  }
  const attempts = (doc.attempts ?? 0) + 1;
  const next = { ...doc, status: attempts >= 5 ? "failed" : "settle", attempts };
  await write(ctx, next);
  if (next.status === "failed") await centralLog(ctx, "reward.failed", doc);
  return next;
}
const verdict = (doc, todo, reason) => ({ ...doc, status: "settle", todo, reason: doc.reason ?? reason });

/* ───────────── Un échange arrive ───────────── */

const NOT_OURS = { handled: false, why: "not_ours" };
/**
 * Traite un échange de points (déjà authentifié par la signature). Rend { handled: false, why } (pas pour nous, déjà vu, périmé…) ou { handled: true, result }.
 * `result` : "waiting" (confié à la maison) · "done" · "refunded" · "settling" (le verdict part à la prochaine lecture).
 */
export async function processRedemption(ctx, red, { now = Date.now() } = {}) {
  const s = settingsOf(ctx);
  if (red.status && red.status !== "unfulfilled") return { handled: false, why: "status" };
  if (Number.isFinite(red.at) && Math.abs(now - red.at) > 15 * 60_000) return { handled: false, why: "stale" };
  const reward = await R.byTwitchId(ctx, red.rewardId);
  if (!reward || reward.gone) return NOT_OURS;
  // First the backlog, if any (results received, redemptions that waited too long), then this one. Reading the state of the home (another module, up to 3 s) has nothing to do with THIS redemption:
  // it happens while this one is handled, and is awaited before returning.
  await reconcile(ctx, { now, force: true, house: false }).catch(() => {});
  const house = syncHouse(ctx, s, { now }).catch(() => {});
  const out = await st.serial(ctx, "redeem", async () => {
    // Everything that depends on nothing else is read at the same time; the chat diagnosis is only needed for the bot's own actions.
    const doubled = known(ctx, red.id), rowsP = rows(ctx), accP = R.access(ctx, s), namedP = A.named(ctx, s), chatP = R.isHome(reward.action) ? null : diagnoseFast(ctx, s);
    for (const p of [doubled, rowsP, accP, namedP, chatP]) p?.catch(() => {});
    if (await doubled) return { handled: false, why: "duplicate" };   // a redemption is handled only once, even after a restart
    const acc = await accP;
    if (acc.ok && acc.broadcasterId !== red.broadcasterId) return { handled: false, why: "other_channel" };
    const waiting = (await rowsP).filter((r) => PENDING.has(r.status) && !r.test).length;
    const an = (await namedP).find((a) => a.key === reward.action)?.label;   // the name of the action at the time of the redemption: the journal stays readable even if it disappears
    const doc0 = { rid: red.id, rewardTid: red.rewardId, title: reward.title, action: reward.action, ...(an ? { an } : {}), user: red.login, name: red.name, at: now, status: "new", todo: null, reason: null, attempts: 0 };
    const id = await ctx.api.store.add(COL, doc0, { key: red.id });
    let doc = { id, ...doc0 };
    if (waiting >= MAX_WAITING) doc = verdict(doc, "CANCELED", "busy");
    else if (await st.isMuted(ctx)) doc = verdict(doc, "CANCELED", "muted");   // paused (emergency stop): no chat answer, no action at home; the points are given back
    else if (R.isHome(reward.action)) {
      const text = reward.action === "tts:lire" ? clean(red.input, 300) : undefined;
      if (reward.action === "tts:lire" && !text) doc = verdict(doc, "CANCELED", "no_text");
      else {
        const r = await bridge(ctx, "enqueue", { key: reward.action, ...(text ? { text } : {}), viewer: pseudo(red.name || red.login), ref: red.id });
        if (r.ok && r.value?.ok === true) doc = { ...doc, status: "waiting", haId: String(r.value.id ?? "").slice(0, 80) };
        else if (r.ok && r.value?.ok === false) doc = verdict(doc, "CANCELED", REASONS.includes(r.value.reason) ? r.value.reason : "error");
        else doc = verdict(doc, "CANCELED", "not_installed");
      }
    } else {
      // action du bot : répondre dans le chat (texte de la récompense, pseudo nettoyé ; jamais le message du viewer)
      const d = await chatP;
      const text = render(reward.reply, { utilisateur: pseudo(red.name || red.login), recompense: reward.title }, s.prefix);
      if (await quiet(ctx)) doc = verdict(doc, "CANCELED", "collab");   // collaboration mode, "mute the other automatic messages": no answer in the chat, the points are given back
      else if (d.code !== "ready" || !text) doc = verdict(doc, "CANCELED", "chat_not_ready");
      else { const sent = await sendChat(ctx, d, text); if (sent.sent) { st.rememberSent(ctx, sent.messageId); doc = verdict(doc, "FULFILLED", "ok"); } else doc = verdict(doc, "CANCELED", "send_failed"); }
    }
    await write(ctx, doc);
    if (doc.status === "settle") {
      if (!acc.ok) return { handled: true, result: "settling" };
      doc = await settle(ctx, s, doc, acc);
    }
    if (["off", "not_live", "not_paired"].includes(doc.reason)) await syncHouse(ctx, s, { now }).catch(() => {});
    return { handled: true, result: doc.status === "waiting" ? "waiting" : doc.status === "done" ? "done" : doc.status === "refunded" ? "refunded" : "settling", reason: doc.reason };
  });
  await house;
  return out;
}

/* ───────────── La lecture suivante : résultats, délais, pauses ───────────── */

const lastRun = new Map();
/** Lit l'état de la maison (`ha.state`) et met les récompenses en pause ou en vente. */
export async function syncHouse(ctx, s, { now = Date.now() } = {}) {
  const st1 = (await collect(ctx, "ha.state", 5))[0];
  return R.applyHouseState(ctx, s, st1, { now });
}

/**
 * Met à jour ce qui attend : les résultats de la maison (`ha.result`) valident ou remboursent, les échanges sans résultat depuis trop longtemps sont remboursés, les verdicts
 * qui n'ont pas pu partir sont renvoyés, l'état de la maison est lu. Appelée à l'arrivée d'un évènement de Twitch et à l'ouverture de l'administration — jamais par un minuteur.
 * Au plus une fois toutes les 5 s (sauf `force`), au plus 20 appels à Twitch. Ne lève jamais.
 */
export async function reconcile(ctx, { now = Date.now(), force = false, house = true } = {}) {
  const k = ctx.instance.key;
  if (!force && (lastRun.get(k) ?? 0) > now - 5000) return { skipped: true };
  lastRun.set(k, now);
  try {
    const s = settingsOf(ctx);
    const out = await st.serial(ctx, "redeem", async () => {
      const pending = (await rows(ctx)).filter((r) => PENDING.has(r.status));
      if (!pending.length) return { n: 0, open: 0 };
      const results = new Map((await collect(ctx, "ha.result", 100)).filter((x) => typeof x.ref === "string").map((x) => [x.ref, x]));
      const acc = await R.access(ctx, s);
      let calls = 0, n = 0, open = 0;
      for (const doc0 of pending) {
        let doc = doc0;
        const res = results.get(doc.rid);
        if (doc.test) {   // une simulation : jamais d'appel à Twitch, elle se termine toute seule
          const end = res ? { ...doc, status: res.status === "done" ? "done" : "failed", reason: reasonOf(res) } : now - doc.at > s.rewardWaitSec * 1000 ? { ...doc, status: "failed", reason: "timeout" } : doc;
          if (end !== doc) { await write(ctx, end); n++; if (res) await noteLink(ctx, doc.action, res, now); }
          continue;
        }
        if (doc.status === "waiting") {
          if (res) { doc = verdict(doc, res.status === "done" ? "FULFILLED" : "CANCELED", reasonOf(res)); await noteLink(ctx, doc.action, res, now); }
          else if (now - doc.at > s.rewardWaitSec * 1000) doc = verdict(doc, "CANCELED", "timeout");
        } else if (doc.status === "new" && now - doc.at > 60_000) doc = verdict(doc, "CANCELED", "lost");   // interrompu en cours de route
        if (doc !== doc0) { await write(ctx, doc); n++; }
        if (doc.status === "settle" && acc.ok && calls < 20) { calls++; doc = await settle(ctx, s, doc, acc); }
        if (doc.status === "waiting" || doc.status === "settle") open++;
      }
      return { n, open };
    });
    if (house) await syncHouse(ctx, s, { now }).catch(() => {});
    return out;
  } catch (e) {
    console.error(`[twitch-bot] ${ctx.instance.key}: lecture des échanges en échec (${e?.message ?? e})`);
    return { error: true };
  }
}
export const resetRedeem = () => lastRun.clear();

/**
 * After a redemption is handed to the home, the result arrives a few seconds later — and nobody read it before the next event from Twitch (sometimes minutes later): the redemption stayed
 * "unfulfilled" at Twitch. A few spaced re-reads (1.5 s, 4 s, 9 s, 20 s, 45 s) validate or refund as soon as the result is there, then the one-minute task takes over.
 * Never a loop: at most five re-reads per series, one series at a time per instance, stopped as soon as nothing waits any more. `now`: the caller's clock (tests).
 */
export const followTiming = { delays: [1500, 4000, 9000, 20_000, 45_000] };
const following = new Set();
export function followUp(ctx, { now = Date.now() } = {}) {
  const k = ctx.instance.key;
  if (following.has(k) || !followTiming.delays.length) return Promise.resolve();
  following.add(k);
  const t0 = Date.now();
  return (async () => {
    try {
      let last = 0;
      for (const at of followTiming.delays) {
        await new Promise((ok) => { const t = setTimeout(ok, Math.max(0, at - last)); t.unref?.(); });
        last = at;
        const r = await reconcile(ctx, { now: now + (Date.now() - t0), force: true, house: false });
        if (r?.error || !r?.open) break;
      }
    } catch { /* the one-minute task will take over */ } finally { following.delete(k); }
  })();
}

/* ───────────── Simulation (aucun appel à Twitch, aucun point) ───────────── */

const sims = new Map();
export const resetSims = () => sims.clear();
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));   // borné par waitMs ; pas unref : la demande d'administration attend vraiment
/**
 * Joue le MÊME chemin qu'un vrai échange (action de la récompense, pont de la maison) avec un faux échange : pseudo « Test », aucune mise à jour chez Twitch, aucun point.
 * Une action du bot (réponse dans le chat) n'est PAS envoyée : on rend l'aperçu. Limites : 1 test / 3 s, 30 / heure. Le coupe-circuit actif refuse le test.
 * Rend { ok: true, mode: "preview", text } | { ok: true, mode: "result", status, reason } | { ok: true, mode: "pending" } | { ok: false, code }.
 * L'attente du résultat se fait DANS la demande (au plus `waitMs`, une lecture par `pollMs`) : rien ne tourne en arrière-plan.
 */
export async function simulate(ctx, s, rewardId, { text = "", now = Date.now(), waitMs = 12_000, pollMs = 1000 } = {}) {
  const k = ctx.instance.key, m = sims.get(k) ?? { last: 0, hour: [] };
  m.hour = m.hour.filter((t) => now - t < 3_600_000);
  if (now - m.last < 3000) return { ok: false, code: "too_fast" };
  if (m.hour.length >= 30) return { ok: false, code: "too_many" };
  const reward = (await R.list(ctx)).find((x) => x.id === rewardId);
  if (!reward || reward.gone) return { ok: false, code: "unknown" };
  if (R.isHome(reward.action) && (await st.isMuted(ctx))) return { ok: false, code: "refused", reason: "muted" };   // paused: not even a test sends anything to the home
  m.last = now; m.hour.push(now); sims.set(k, m);
  const ref = `test-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const doc0 = { rid: ref, test: true, rewardTid: reward.tid, title: reward.title, action: reward.action, user: "Test", name: "Test", at: now, status: "new", todo: null, reason: null, attempts: 0 };
  const add = async (over) => { const doc = { ...doc0, ...over }; const id = await ctx.api.store.add(COL, doc, { key: ref }); return { id, ...doc }; };
  if (!R.isHome(reward.action)) {
    const out = render(reward.reply, { utilisateur: "Test", recompense: reward.title }, s.prefix);
    await add({ status: "done", reason: "ok", preview: true });
    return { ok: true, mode: "preview", text: out };
  }
  const input = clean(text, 300);
  if (reward.action === "tts:lire" && !input) return { ok: false, code: "no_text" };
  const r = await bridge(ctx, "enqueue", { key: reward.action, ...(reward.action === "tts:lire" ? { text: input } : {}), viewer: "Test", ref, test: true });
  if (!(r.ok && r.value?.ok !== undefined)) { return { ok: false, code: "not_installed" }; }
  if (r.value.ok === false) { const reason = REASONS.includes(r.value.reason) ? r.value.reason : "error"; await add({ status: "failed", reason }); return { ok: false, code: "refused", reason }; }
  const doc = await add({ status: "waiting", haId: String(r.value.id ?? "").slice(0, 80) });
  for (let waited = 0; waited < waitMs; waited += pollMs) {
    const res = (await collect(ctx, "ha.result", 100)).find((x) => x.ref === ref);
    if (res) {
      const status = res.status === "done" ? "done" : "failed", reason = reasonOf(res);
      await write(ctx, { ...doc, status, reason });
      await noteLink(ctx, reward.action, res, now);
      return { ok: true, mode: "result", status, reason };
    }
    await pause(pollMs);
  }
  return { ok: true, mode: "pending" };
}
