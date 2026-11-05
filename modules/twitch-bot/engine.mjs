// Le cœur du bot : un message du chat arrive, on décide si on répond, et quoi. Chaque refus a une raison, notée dans le journal (« pourquoi il n'a pas répondu »).
// Ce fichier ne connaît pas les détails de Twitch (eventsub.mjs) ni les autres modules (sources.mjs).
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { levelOf } = await import(`./eventsub.mjs${v}`);
const { settingsOf } = await import(`./settings.mjs${v}`);
const { catalog, loadConfigCached, norm, ROLE_LEVEL } = await import(`./commands.mjs${v}`);
const { renderRich, used, pseudo, clean, plain, parseRandom } = await import(`./variables.mjs${v}`);
const { calc } = await import(`./calc.mjs${v}`);
const { reopenIso } = await import(`./period.mjs${v}`);
const { fetchText } = await import(`./urlfetch.mjs${v}`);
const { handleManage, MANAGE_WORDS } = await import(`./manage.mjs${v}`);
const { randomInt } = await import("node:crypto");
const src = await import(`./sources.mjs${v}`);
const st = await import(`./state.mjs${v}`);
const { diagnoseFast, sendChat } = await import(`./listen.mjs${v}`);
const { handleKill } = await import(`./kill.mjs${v}`);

/* ───────────── Les valeurs des variables ───────────── */

function duration(ms, t) {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return t("dur_lt1");
  const h = Math.floor(min / 60), m = min % 60;
  return h ? t("dur_hm", { h, m }) : t("dur_m", { m });
}
/** « samedi 18 octobre à 20:30 » (sans l'heure pour un événement sur la journée) ; « UTC » ajouté si aucun fuseau n'est réglé, pour ne jamais induire en erreur. */
export function formatWhen(slot, { locale, timeZone }, t) {
  const day = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone }).format(slot.start);
  if (slot.allDay) return day;
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(slot.start);
  return t("when_at", { day, time: timeZone === "UTC" ? `${time} UTC` : time });
}

/**
 * Les valeurs dont ce texte a besoin (pas plus : on n'interroge Planning que si le texte parle du prochain stream).
 * `who` : le pseudo de celui qui tape. `cmd.vars` : ce que la commande apporte (partenaire, adresse, réseau, lien) ; la commande groupée reçoit `liste`.
 */
export async function valuesFor(ctx, s, cmd, who, { channel, sources, list, now = Date.now() }) {
  const t = ctx.t, need = new Set(used(cmd.text));
  const v = { utilisateur: pseudo(who), ...cmd.vars };
  if (need.has("jeu") || need.has("titre") || need.has("uptime")) {
    const live = channel ? await src.liveState(ctx, channel) : null;
    v.jeu = live?.live && live.game ? live.game : t("fb_jeu");
    v.titre = live?.live && live.title ? live.title : t("fb_titre");
    v.uptime = live?.live && live.startedAt ? duration(now - Date.parse(live.startedAt), t) : t("fb_uptime");
  }
  if (need.has("followers")) { const n = sources.followers.available ? sources.followers.value : null; v.followers = n === null ? t("fb_followers") : n.toLocaleString(ctx.locale); }
  if (need.has("prochain_stream")) {
    const next = sources.planning.next;
    v.prochain_stream = next ? `${formatWhen(next, { locale: ctx.locale, timeZone: s.timeZone }, t)}${next.title && next.title.length <= 60 ? ` (${clean(next.title, 60)})` : ""}` : t("fb_prochain_stream");
  }
  if (need.has("liste")) {
    const parts = [];
    let size = 0;
    for (const c of list.filter((x) => x.kind === "network" && x.state === "on").sort((a, b) => a.name.localeCompare(b.name))) {
      const p = `${c.vars.reseau} : ${c.vars.lien}`;
      if (size + p.length > 380) break;
      parts.push(p); size += p.length + 3;
    }
    v.liste = parts.join(" · ");
  }
  return v;
}

/** L'heure ou la date dans un fuseau (celui du morceau, sinon celui des réglages). */
function clock(kind, arg, ctx, s, now) {
  const timeZone = arg && ((() => { try { new Intl.DateTimeFormat("en", { timeZone: arg }); return true; } catch { return false; } })()) ? arg : s.timeZone;
  const f = kind === "heure" ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone } : { weekday: "long", day: "numeric", month: "long", timeZone };
  return new Intl.DateTimeFormat(ctx.locale, f).format(now);
}

/**
 * Le texte d'une commande ou d'un timer, prêt à envoyer. `args` : les mots tapés après la commande (déjà nettoyés) ; `counter` : la valeur de {compteur} ;
 * `person` : faux pour un timer (aucune personne ne l'a demandé).
 */
export async function compose(ctx, s, cmd, who, { channel, sources, list, now = Date.now(), args = [], counter = 0 }) {
  const t = ctx.t, base = await valuesFor(ctx, s, cmd, who, { channel, sources, list, now });
  let live;
  const liveOnce = async () => (live === undefined ? (live = channel ? await src.liveState(ctx, channel) : null) : live);
  const rest = (from) => args.slice(from).join(" ");
  const resolve = async (name, arg) => {
    if (Object.hasOwn(base, name)) return base[name];
    switch (name) {
      case "chaine": return (await liveOnce())?.displayName ?? channel ?? t("fb_chaine");
      case "viewers": { const l = await liveOnce(); return l?.live && Number.isInteger(l.viewers) ? l.viewers.toLocaleString(ctx.locale) : t("fb_viewers"); }
      case "heure": case "date": return clock(name, arg, ctx, s, now);
      case "aleatoire": { const p = parseRandom(arg); return !p ? "" : p.range ? String(randomInt(p.range[0], p.range[1] + 1)) : p.list[randomInt(p.list.length)]; }
      case "calcul": { const r = calc(arg); return r.ok ? r.text : t("fb_calcul"); }
      case "urlfetch": { const r = await fetchText(ctx, arg, s.fetchHosts, { now }); return r.ok ? r.text : t("fb_urlfetch"); }
      case "compteur": return String(counter);
      case "cible": return args[0] ? pseudo(args[0].replace(/^@+/, "")) : base.utilisateur;
      case "requete": case "query": return rest(0).slice(0, 200);
      default: {
        const m = /^([1-9])(:?)$/.exec(name);
        if (!m) return undefined;
        return m[2] ? rest(Number(m[1]) - 1).slice(0, 200) : (args[Number(m[1]) - 1] ?? "");
      }
    }
  };
  return renderRich(cmd.text, resolve, s.prefix);
}
/** Ce texte reprend-il des mots tapés dans le chat ? (alors rien du message n'est gardé dans le journal) */
export const usesChatWords = (text) => used(text).some((n) => ["cible", "requete", "query"].includes(n) || /^[1-9]:?$/.test(n));

/** Ce que répondrait la commande, pour l'aperçu de l'administration (rien n'est envoyé). */
export async function preview(ctx, cmd, { channel, sources, list, counter = 0 }) {
  const s = settingsOf(ctx);
  return compose(ctx, s, cmd, ctx.t("preview_user"), { channel, sources, list, args: [ctx.t("preview_arg1"), ctx.t("preview_arg2")], counter });
}

/* ───────────── Un message du chat ───────────── */

const REASONS = { muted: "muted", off: "off", hidden: "hidden", missing: "missing", outside: "outside" };
/** The variables that ask for the state of the live (a fresh reading from the Twitch channel module). */
const LIVE_VARS = ["jeu", "titre", "uptime", "chaine", "viewers"];

/** The readings from other modules that THIS command needs to answer (the others are not done: see sources.gather). */
export function needsOf(cmd) {
  const need = new Set(), vars = used(cmd.text);
  if (cmd.kind === "partner") need.add("partners");
  if (cmd.kind === "network" || cmd.kind === "group") need.add("networks");
  if (cmd.kind === "builtin" && (cmd.needs === "planning" || cmd.needs === "followers")) need.add(cmd.needs);
  if (vars.includes("followers")) need.add("followers");
  if (vars.includes("prochain_stream")) need.add("planning");
  if (vars.includes("liste")) need.add("networks");
  return need;
}

/**
 * Traite un message du chat. Rend { handled: false, why } quand le message n'est pas pour nous (silencieux), sinon { handled: true, result: "sent" | "refused" | "error", reason, text? }.
 * `now`: for tests. `state`: the state the caller already read (saves one read). `deferLog`: the reply goes out, then the journal is written while the caller carries on;
 * the promise of that write is in `result.logged` (the caller awaits it before it returns: nothing is lost).
 */
export async function processChat(ctx, chat, { now = Date.now(), state = null, deferLog = false } = {}) {
  const s = settingsOf(ctx);
  const text = chat.text.trim();
  if (!s.prefix || !text.startsWith(s.prefix)) return { handled: false, why: "not_command" };
  const word = norm(text.slice(s.prefix.length).split(/\s+/)[0] ?? "", "");
  if (!word) return { handled: false, why: "no_word" };
  // Jamais de réponse à un message venu d'ailleurs, à un bot connu ou à l'un de nos propres messages (pas de boucle) : en silence.
  if (chat.foreign) return { handled: false, why: "foreign" };
  if (st.isOwnMessage(ctx, chat.messageId)) return { handled: false, why: "own" };
  if (s.bots.has(chat.login)) return { handled: false, why: "bot" };

  if (word === "stop" || word === "start") return handleKill(ctx, s, chat, word, { now });
  const cfg = (await loadConfigCached(ctx)).data;
  // Which command is it? The NAMES come from the configuration alone, so this is known without asking anybody: a "!something" that is not a command costs nothing.
  const known = catalog(cfg, src.noSources(), ctx.t, { now, timeZone: s.timeZone }).find((c) => !c.timerOnly && (c.name === word || c.aliases.includes(word)));   // a command "reserved for the timer" never answers in the chat
  if (!known) {
    // Les commandes de gestion (!addcom…) : seulement si la personne les a permises, et jamais si une commande portant ce nom existe déjà.
    if (s.chatManage && MANAGE_WORDS.includes(word)) {
      const d = await diagnoseFast(ctx, s);
      const channel = d.channel ?? null;
      return handleManage(ctx, s, chat, word, text, { now, d, channel, sources: await src.gather(ctx, channel) });
    }
    return { handled: false, why: "unknown_command" };
  }

  // Everything that depends on nothing else starts at the same time: the accounts, the readings from other modules this command needs, the emergency stop.
  const need = needsOf(known);
  const diag = diagnoseFast(ctx, s);
  const channelP = diag.then((d) => d.channel ?? null);
  const gathering = src.gather(ctx, channelP, [...need]);
  const mutedP = state ? Promise.resolve(state.muted === true) : st.isMuted(ctx);
  for (const p of [diag, channelP, gathering, mutedP]) p.catch(() => {});   // a failure is picked up by the `await` below; no promise is left without a listener
  const d = await diag;
  const channel = d.channel ?? null;
  // The text talks about the live ({jeu}…): the fresh reading starts right now, during the checks below.
  if (channel && d.code === "ready" && used(known.text).some((n) => LIVE_VARS.includes(n))) src.liveState(ctx, channel).catch(() => {});
  const sources = await gathering;
  const list = catalog(cfg, sources, ctx.t, { now, timeZone: s.timeZone });
  const cmd = list.find((c) => !c.timerOnly && (c.name === word || c.aliases.includes(word))) ?? known;

  const logs = [];
  const log = async (result, reason, extra = {}) => {
    const written = st.addLog(ctx, { user: chat.login, command: cmd.name, result, reason, ...extra });
    if (deferLog) { logs.push(written.catch(() => {})); const out = { handled: true, result, reason, ...extra }; Object.defineProperty(out, "logged", { value: Promise.all(logs).then(() => {}), enumerable: false }); return out; }
    await written;
    return { handled: true, result, reason, ...extra };
  };
  if (d.code !== "ready") return log("refused", "not_ready");
  if (chat.broadcasterId !== d.broadcasterId) return { handled: false, why: "other_channel" };
  if (s.replyAs === "bot" && chat.chatterId === d.senderId) return { handled: false, why: "own" };   // le compte bot ne se répond jamais à lui-même
  if (await mutedP) return log("refused", "muted");
  if (cmd.state === "outside") return log("refused", "outside", { reopen: reopenIso(cmd.period, now, s.timeZone) });   // hors période : se réactive tout seul, la commande reste visible
  if (cmd.state !== "on") return log("refused", REASONS[cmd.state] ?? "hidden", cmd.why ? { detail: cmd.why } : {});
  if (s.onlyWhenLive) {
    const live = await src.liveGate(ctx, channel);
    if (!live?.known) return log("refused", "live_unknown");
    if (!live.live) return log("refused", "offline");
  }
  if (levelOf(chat) < ROLE_LEVEL[cmd.role]) return log("refused", "role");
  const delays = { command: cmd.key, user: chat.chatterId, globalSec: cmd.cdGlobal ?? s.cdGlobal, userSec: cmd.cdUser ?? s.cdUser, now };
  const wait = st.checkCooldown(ctx, { ...delays, reserve: false });
  if (wait) return log("refused", "cooldown", { seconds: wait });
  if (!st.takeSendSlot(ctx, { max: s.maxPerWindow, windowMs: 30_000, now })) return log("refused", "rate");
  st.checkCooldown(ctx, delays);

  // Les mots tapés après la commande (nettoyés : jamais d'accolades, jamais de « !commande » ou « /ban » en début de mot) servent aux morceaux {1} {cible} {requete}…
  const args = text.slice(s.prefix.length).split(/\s+/).slice(1, 21).map((w) => plain(w, 100, s.prefix)).filter(Boolean);
  const counts = cmd.kind === "custom" && used(cmd.text).includes("compteur");
  const next = counts ? ((await st.readCounters(ctx))[cmd.key] ?? 0) + 1 : 0;
  const message = await compose(ctx, s, cmd, chat.name || chat.login, { channel, sources, list, now, args, counter: next });
  if (!message) { st.releaseCooldown(ctx, delays); st.giveBackSendSlot(ctx); return log("refused", "empty"); }
  const sent = await sendChat(ctx, d, message);
  if (!sent.sent) {
    st.releaseCooldown(ctx, delays); st.giveBackSendSlot(ctx);
    return log("error", `send_${sent.code}`, { detail: sent.detail ?? null });
  }
  st.rememberSent(ctx, sent.messageId);
  // The reply is gone: the counter and the journal are written now (one after the other, in order).
  if (counts) { const w = st.setCounter(ctx, cmd.key, next).catch(() => {}); if (deferLog) logs.push(w); else await w; }
  // Ce que les gens tapent n'est jamais gardé : si la réponse reprend leurs mots, le journal n'en garde pas le texte.
  return log("sent", "ok", usesChatWords(cmd.text) ? {} : { text: message.slice(0, 160) });
}
