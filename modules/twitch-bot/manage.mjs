// « !addcom », « !editcom », « !delcom » et « !commands » : gérer les commandes depuis le chat. Réservé à l'équipe de modération et à la chaîne, et seulement si la personne
// l'a permis dans les réglages. Mêmes vérifications que l'administration (c'est le même code : saveCommand) ; jamais d'écrasement d'une commande existante ;
// seules les commandes écrites à la main se modifient ou se suppriment d'ici. Chaque action est notée dans le journal (qui, quelle commande, résultat).
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { levelOf } = await import(`./eventsub.mjs${v}`);
const { catalog, loadConfig, saveCommand, removeCustom, norm, NAME_RE, MAX_CUSTOM, MAX_DELAY } = await import(`./commands.mjs${v}`);
const { pseudo, safeStart, truncate } = await import(`./variables.mjs${v}`);
const { saveError } = await import(`./errors.mjs${v}`);
const st = await import(`./state.mjs${v}`);
const { sendChat } = await import(`./listen.mjs${v}`);

export const MANAGE_WORDS = ["addcom", "editcom", "delcom", "commands"];
const LEVELS = {
  everyone: "everyone", all: "everyone", tous: "everyone", tout: "everyone",
  subscriber: "subscribers", subscribers: "subscribers", sub: "subscribers", abonne: "subscribers", abonnes: "subscribers",
  moderator: "mods", mod: "mods", mods: "mods", moderation: "mods",
  owner: "owner", moi: "owner", proprietaire: "owner",
};
const fold = (x) => String(x ?? "").normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();

/** « -cd=30 -ul=mods nom le texte » → { flags: { cdGlobal?, role? }, name, rest, error? }. Les options viennent avant le nom. */
export function parseManage(line, prefix) {
  const words = String(line).trim().split(/\s+/).slice(1);
  const flags = {};
  let i = 0;
  for (; i < words.length && /^-[a-z]+=/i.test(words[i]); i++) {
    const [k, ...val] = words[i].slice(1).split("="), value = val.join("=");
    if (["cd", "cooldown", "delai"].includes(k.toLowerCase())) {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0 || n > MAX_DELAY) return { error: "delay" };
      flags.cdGlobal = n;
    } else if (["ul", "userlevel", "niveau"].includes(k.toLowerCase())) {
      const role = LEVELS[fold(value)];
      if (!role) return { error: "level" };
      flags.role = role;
    } else return { error: "option", value: words[i].slice(0, 20) };
  }
  const name = norm(words[i] ?? "", prefix);
  return { flags, name, rest: words.slice(i + 1).join(" ") };
}

/** Traite l'une des quatre commandes. Rend le même genre de résultat que processChat. */
export async function handleManage(ctx, s, chat, word, text, { now = Date.now(), d, sources }) {
  const t = ctx.t, by = pseudo(chat.name || chat.login);
  const log = async (result, reason, extra = {}) => { await st.addLog(ctx, { user: chat.login, command: word, result, reason, ...extra }); return { handled: true, result, reason, ...extra }; };
  if (d.code !== "ready") return log("refused", "not_ready");
  if (chat.broadcasterId !== d.broadcasterId) return { handled: false, why: "other_channel" };
  if (s.replyAs === "bot" && chat.chatterId === d.senderId) return { handled: false, why: "own" };
  if (await st.isMuted(ctx)) return log("refused", "muted");
  if (levelOf(chat) < 2) return log("refused", "role");   // une personne sans le droit n'obtient aucune réponse : on ne révèle rien
  if (st.checkCooldown(ctx, { command: "manage", user: chat.chatterId, globalSec: 0, userSec: 2, now })) return log("refused", "cooldown", { seconds: 2 });
  const answer = async (key, vars = {}, result = "ok") => {
    const reply = truncate(safeStart(t(key, { user: by, prefix: s.prefix, ...vars }), s.prefix), 400);
    if (!st.takeSendSlot(ctx, { max: s.maxPerWindow, windowMs: 30_000, now })) return log("refused", "rate");
    const sent = await sendChat(ctx, d, reply);
    if (!sent.sent) { st.giveBackSendSlot(ctx); return log("error", `send_${sent.code}`, { detail: sent.detail ?? null }); }
    st.rememberSent(ctx, sent.messageId);
    return log(result === "ok" ? "sent" : "refused", result === "ok" ? "ok" : result, { text: reply.slice(0, 160) });
  };
  const cfg = (await loadConfig(ctx)).data;
  const env = { src: sources, t, prefix: s.prefix };
  const list = catalog(cfg, sources, t);

  if (word === "commands") {
    const names = cfg.custom.filter((c) => c.enabled !== false).map((c) => `${s.prefix}${c.name}`);
    if (!names.length) return answer("mg_list_none");
    let shown = "";
    for (const n of names) { if ((shown + n).length > 330) break; shown += `${shown ? " " : ""}${n}`; }
    return answer("mg_list", { list: shown, more: names.length - shown.split(" ").length > 0 ? ` (+${names.length - shown.split(" ").length})` : "" });
  }

  const p = parseManage(text, s.prefix);
  if (p.error === "delay") return answer("mg_e_delay", {}, "invalid");
  if (p.error === "level") return answer("mg_e_level", {}, "invalid");
  if (p.error === "option") return answer("mg_e_option", { value: p.value }, "invalid");
  if (!p.name) return answer(`mg_usage_${word}`, {}, "invalid");
  if (!NAME_RE.test(p.name)) return answer("mg_e_name", { value: p.name.slice(0, 25) }, "invalid");
  const existing = list.find((c) => c.name === p.name || c.aliases.includes(p.name));

  if (word === "addcom") {
    if (!p.rest) return answer("mg_usage_addcom", {}, "invalid");
    if (existing) return answer(existing.kind === "custom" ? "mg_e_exists" : "mg_e_taken", { name: p.name }, "invalid");
    if (cfg.custom.length >= MAX_CUSTOM) return answer("mg_e_many", { max: MAX_CUSTOM }, "invalid");
    const r = await saveCommand(ctx, { kind: "custom" }, { name: p.name, text: p.rest, enabled: true, ...p.flags }, env);
    return r.ok === false ? answer("mg_e_save", { why: saveError(ctx, r) }, "invalid") : answer("mg_added", { name: p.name });
  }
  if (!existing) return answer("mg_e_unknown", { name: p.name }, "invalid");
  if (existing.kind !== "custom") return answer("mg_e_notmine", { name: p.name }, "invalid");
  if (word === "delcom") {
    const r = await removeCustom(ctx, existing.id);
    if (r.ok === false) return answer("mg_e_unknown", { name: p.name }, "invalid");
    await st.dropCounter(ctx, existing.key).catch(() => {});
    return answer("mg_deleted", { name: p.name });
  }
  // editcom
  if (!p.rest && !Object.keys(p.flags).length) return answer("mg_usage_editcom", {}, "invalid");
  const r = await saveCommand(ctx, { kind: "custom", id: existing.id }, { ...(p.rest ? { text: p.rest } : {}), ...p.flags }, env);
  return r.ok === false ? answer("mg_e_save", { why: saveError(ctx, r) }, "invalid") : answer("mg_edited", { name: p.name });
}
