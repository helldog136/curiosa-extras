// « !stop » et « !start » : le coupe-circuit de la maison depuis le chat. Aucune autre commande de chat ne commande la maison.
//   !stop  : la propriétaire de la chaîne et les modérateurs DÉSIGNÉS dans les réglages (le badge « modérateur » ne suffit pas) ;
//   !start : la propriétaire seulement. La personne est reconnue par son identifiant de compte (signé par Twitch), jamais par ce qu'elle écrit.
// Marche même hors direct et même quand le bot est muet (dans ce cas il agit sans répondre). Une personne qui n'a pas le droit n'obtient aucune réponse (on ne révèle rien).
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const st = await import(`./state.mjs${v}`);
const { diagnose, sendChat } = await import(`./listen.mjs${v}`);
const { bridge } = await import(`./redeem.mjs${v}`);
const { pseudo } = await import(`./variables.mjs${v}`);

/** Qui peut quoi : { stop, start } pour ce message. */
export function allowed(s, chat, broadcasterId) {
  const owner = !!broadcasterId && chat.chatterId === broadcasterId;
  return { stop: owner || s.stopMods.has(chat.login), start: owner };
}

/** Traite « !stop » / « !start ». Rend le même genre de résultat que processChat. */
export async function handleKill(ctx, s, chat, word, { now = Date.now() } = {}) {
  const d = await diagnose(ctx, s, { declare: false });
  const log = async (result, reason, extra = {}) => { await st.addLog(ctx, { user: chat.login, command: word, result, reason, ...extra }); return { handled: true, result, reason, ...extra }; };
  if (d.code !== "ready" && !d.main?.userId) return log("refused", "not_ready");
  const broadcasterId = d.broadcasterId ?? d.main?.userId;
  if (chat.broadcasterId !== broadcasterId) return { handled: false, why: "other_channel" };
  if (!allowed(s, chat, broadcasterId)[word]) return log("refused", "role");
  const by = pseudo(chat.name || chat.login);
  const r = await bridge(ctx, word, { by });
  const ok = r.ok && r.value?.ok !== false;
  const reply = async (key) => {
    if (d.code !== "ready" || (await st.isMuted(ctx)) || !st.takeSendSlot(ctx, { max: s.maxPerWindow, windowMs: 30_000, now })) return "silent";
    const sent = await sendChat(ctx, d, ctx.t(key, { user: by }));
    if (sent.sent) st.rememberSent(ctx, sent.messageId);
    return sent.sent ? "sent" : "failed";
  };
  if (r.ok === false && r.reason === "unavailable") { await reply("kill_absent"); return log("refused", "not_installed"); }
  if (!ok) { await reply("kill_failed"); return log("error", "kill_failed"); }
  await reply(word === "stop" ? "kill_stopped" : "kill_started");
  return log("sent", "ok", { text: word === "stop" ? "stop" : "start" });
}
