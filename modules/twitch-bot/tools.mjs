// Outils pour les assistants (MCP) : lister, créer et modifier des commandes. Jamais activés d'office (voir module.json). Pas de suppression, pas de secret, pas d'envoi de message.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { saveCommand, saveSourced } = await import(`./commands.mjs${v}`);
const { context, saveError } = await import(`./admin.mjs${v}`);
const st = await import(`./state.mjs${v}`);
const R = await import(`./rewards.mjs${v}`);
const J = await import(`./redeem.mjs${v}`);
const { settingsOf } = await import(`./settings.mjs${v}`);
const RA = await import(`./rewardsAdmin.mjs${v}`);
const A = await import(`./actions.mjs${v}`);

const expose = (message) => Object.assign(new Error(message), { expose: true });
const view = (c) => ({
  kind: c.kind, name: c.name, aliases: c.aliases, text: c.text, enabled: c.enabled, role: c.role,
  state: c.state, ...(c.why ? { reason: c.why } : {}), delayAllSeconds: c.cdGlobal, delayPerPersonSeconds: c.cdUser,
  ...(c.kind === "partner" || c.kind === "network" ? { source: c.label } : {}),
});
const changes = (a) => {
  const f = {};
  if (a.newName !== undefined) f.name = a.newName;
  if (a.text !== undefined) f.text = a.text;
  if (a.aliases !== undefined) f.aliases = a.aliases;
  if (a.role !== undefined) f.role = a.role;
  if (a.enabled !== undefined) f.enabled = a.enabled;
  if (a.delayAllSeconds !== undefined) f.cdGlobal = a.delayAllSeconds;
  if (a.delayPerPersonSeconds !== undefined) f.cdUser = a.delayPerPersonSeconds;
  return f;
};

const rewardView = (r, names) => ({ name: r.title, costPoints: r.cost, delaySeconds: r.cooldown, helpText: r.prompt, viewerWritesMessage: r.needsInput, action: r.action, actionName: names.get(r.action) ?? null, state: R.statusOf(r), ...(r.action === R.BOT_ACTION ? { chatReply: r.reply } : {}) });
const fieldsOf = (a, cur = {}) => ({ title: a.name ?? cur.title, cost: a.costPoints ?? cur.cost, cooldown: a.delaySeconds ?? cur.cooldown ?? 0, prompt: a.helpText ?? cur.prompt ?? "", needsInput: a.viewerWritesMessage ?? cur.needsInput ?? false, action: a.action ?? cur.action, reply: a.chatReply ?? cur.reply ?? "" });
/** Une action nommée donnée par son nom (`customActionName`) devient la clé de la récompense : reprise si le nom existe, sinon prévue (écrite après la réussite chez Twitch). */
async function withName(ctx, s, a, fields) {
  if (a.customActionName === undefined) return { fields };
  const p = await A.plan(ctx, s, a.customActionName, { rewardKeys: (await R.list(ctx)).map((r) => r.action) });
  if (!p.ok) throw expose(ctx.t(`rw_e_${p.code === "empty" ? "an_empty" : p.code === "long" ? "an_long" : "an_too_many"}`, { max: A.MAX_LABEL, limit: A.MAX_ACTIONS }));
  return { fields: { ...fields, action: p.action.key }, plan: p };
}
const refuse = (ctx, r) => { const f = RA.failure(ctx, r); throw expose(f.error ?? Object.values(f.errors ?? {})[0] ?? ctx.t("rw_err_twitch")); };

export default {
  async bot_commands_list(ctx, args) {
    const info = await context(ctx, { declare: false });
    const list = info.list.filter((c) => !args.kind || c.kind === args.kind);
    return { prefix: info.s.prefix, muted: await st.isMuted(ctx), commands: list.map(view) };
  },
  async bot_command_create(ctx, args) {
    const info = await context(ctx, { declare: false });
    const r = await saveCommand(ctx, { kind: "custom" }, { name: args.name, text: args.text, aliases: args.aliases ?? [], role: args.role ?? "everyone", enabled: args.enabled !== false, ...(args.delayAllSeconds !== undefined ? { cdGlobal: args.delayAllSeconds } : {}), ...(args.delayPerPersonSeconds !== undefined ? { cdUser: args.delayPerPersonSeconds } : {}) }, info.env);
    if (r.ok === false) throw expose(saveError(ctx, r));
    return { created: true, name: String(args.name).replace(info.s.prefix, "").toLowerCase() };
  },
  async bot_command_update(ctx, args) {
    const info = await context(ctx, { declare: false });
    const word = String(args.name).toLowerCase().replace(info.s.prefix, "");
    const c = info.list.find((x) => x.name === word || x.aliases.includes(word));
    if (!c) throw expose(`no command named "${word}"`);
    const f = changes(args);
    if (!Object.keys(f).length) throw expose("nothing to change");
    const r = c.kind === "partner" || c.kind === "network" ? await saveSourced(ctx, c.kind, c.id, f, info.env) : await saveCommand(ctx, { kind: c.kind, id: c.id }, f, info.env);
    if (r.ok === false) throw expose(saveError(ctx, r));
    return { updated: true, name: f.name ? String(f.name).toLowerCase().replace(info.s.prefix, "") : c.name };
  },
  async rewards_list(ctx) {
    const s = settingsOf(ctx);
    await R.sync(ctx, s).catch(() => {});
    const namedList = await A.named(ctx, s), names = A.names(ctx.t, namedList);
    return { rewards: (await R.list(ctx)).map((r) => rewardView(r, names)), maximum: R.MAX_REWARDS, allowedActions: R.allowedKeys(s, namedList.map((a) => a.key)), actions: [...R.allowedKeys(s, namedList.map((a) => a.key))].map((key) => ({ key, name: names.get(key) ?? null })) };
  },
  async reward_create(ctx, args) {
    const s = settingsOf(ctx), namedKeys = (await A.named(ctx, s)).map((a) => a.key);
    const w = await withName(ctx, s, args, fieldsOf(args));
    const c = R.check(w.fields, { s, others: await R.list(ctx), prefix: s.prefix, named: [...namedKeys, ...(w.plan ? [w.plan.action.key] : [])] });
    if (!c.ok) throw expose(Object.values(RA.fieldErrors(ctx, c.errors)).join(" "));
    if (R.isHome(c.value.action) && !(await J.bridgeInstalled(ctx))) throw expose(ctx.t("rw_err_action_home"));
    await A.commit(ctx, w.plan);
    const r = await R.create(ctx, s, c.value);
    if (!r.ok) { await A.discard(ctx, w.plan).catch(() => {}); refuse(ctx, r); }
    return { created: true, name: c.value.title, ...(w.plan ? { action: c.value.action, actionName: w.plan.action.label } : {}) };
  },
  async reward_update(ctx, args) {
    const s = settingsOf(ctx), all = await R.list(ctx);
    const cur = all.find((r) => r.title.toLowerCase() === String(args.name).toLowerCase());
    if (!cur) throw expose(`no reward named "${args.name}"`);
    const namedKeys = (await A.named(ctx, s)).map((a) => a.key);
    const w = await withName(ctx, s, args, fieldsOf({ ...args, name: args.newName ?? cur.title }, cur));
    const c = R.check(w.fields, { s, others: all.filter((r) => r.id !== cur.id), prefix: s.prefix, named: [...namedKeys, ...(w.plan ? [w.plan.action.key] : [])] });
    if (!c.ok) throw expose(Object.values(RA.fieldErrors(ctx, c.errors)).join(" "));
    if (R.isHome(c.value.action) && !(await J.bridgeInstalled(ctx))) throw expose(ctx.t("rw_err_action_home"));
    await A.commit(ctx, w.plan);
    const r = await R.update(ctx, s, cur.id, c.value);
    if (!r.ok) { await A.discard(ctx, w.plan).catch(() => {}); refuse(ctx, r); }
    return { updated: true, name: c.value.title };
  },
  async reward_simulate(ctx, args) {
    const s = settingsOf(ctx), cur = (await R.list(ctx)).find((r) => r.title.toLowerCase() === String(args.name).toLowerCase());
    if (!cur) throw expose(`no reward named "${args.name}"`);
    const r = await J.simulate(ctx, s, cur.id, { text: args.text ?? "", waitMs: 8000 });
    if (!r.ok) { const f = RA.simResult(ctx, r); throw expose(f.error ?? Object.values(f.errors ?? {})[0]); }
    return r.mode === "preview" ? { simulated: true, preview: r.text, sent: false } : r.mode === "pending" ? { simulated: true, answered: false } : { simulated: true, answered: true, success: r.status === "done", reason: r.reason };
  },
};
