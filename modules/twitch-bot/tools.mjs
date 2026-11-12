// Outils pour les assistants (MCP) : lister, créer et modifier des commandes et des timers. Jamais activés d'office (voir module.json). Pas de suppression, pas de secret, pas d'envoi de message.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { saveCommand, saveSourced, takenWords, freeName, slugName, RESERVED, mutate } = await import(`./commands.mjs${v}`);
const { context } = await import(`./admin.mjs${v}`);
const { saveError } = await import(`./errors.mjs${v}`);
const T = await import(`./timers.mjs${v}`);
const st = await import(`./state.mjs${v}`);
const R = await import(`./rewards.mjs${v}`);
const J = await import(`./redeem.mjs${v}`);
const { settingsOf } = await import(`./settings.mjs${v}`);
const RA = await import(`./rewardsAdmin.mjs${v}`);
const A = await import(`./actions.mjs${v}`);
const PER = await import(`./period.mjs${v}`);
const CO = await import(`./collab.mjs${v}`);

const expose = (message) => Object.assign(new Error(message), { expose: true });
const pad = (n) => String(n).padStart(2, "0");
const periodView = (p) => (p ? { activeFrom: p.yearly ? `${pad(p.from.m)}-${pad(p.from.d)}` : `${p.from.y}-${pad(p.from.m)}-${pad(p.from.d)}`, activeUntil: p.yearly ? `${pad(p.to.m)}-${pad(p.to.d)}` : `${p.to.y}-${pad(p.to.m)}-${pad(p.to.d)}`, yearly: p.yearly } : {});
/** activeFrom / activeUntil / yearly / clearPeriod des outils → le champ `period` (rien si aucun n'est donné). Lève une erreur claire si la forme est fausse. */
function periodOf(ctx, a) {
  if (a.clearPeriod === true) return { period: null };
  if (a.activeFrom === undefined && a.activeUntil === undefined) return {};
  const p = PER.parsePeriodIso(a.activeFrom, a.activeUntil, a.yearly);
  if (!p.ok) throw expose(saveError(ctx, { code: "period", field: p.field, reason: p.reason, month: p.month, day: p.day }));
  return { period: p.value };
}
const repeatView = (c) => (c.repeat ? { repeatEveryMinutes: c.repeat.minutes, repeatMinChatLines: c.repeat.lines, repeatWhen: c.repeat.when === "always" ? "always" : "live only", repeatEnabled: c.repeat.enabled } : {});
const view = (c) => ({
  ...(c.timerOnly ? { timerOnly: true, title: c.title } : {}), ...repeatView(c),
  kind: c.kind, name: c.name, aliases: c.aliases, text: c.text, enabled: c.enabled, role: c.role,
  state: c.state, ...(c.why ? { reason: c.why } : {}), ...periodView(c.period), ...(c.reopen ? { reopensOn: `${c.reopen.y}-${String(c.reopen.m).padStart(2, "0")}-${String(c.reopen.d).padStart(2, "0")}` } : {}), delayAllSeconds: c.cdGlobal, delayPerPersonSeconds: c.cdUser,
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
  Object.assign(f, repeatChanges(a));
  return f;
};
/** repeatEveryMinutes / repeatMinChatLines / repeatWhen / repeatEnabled / clearRepeat / timerOnly des outils → les champs `repeat` et `timerOnly` d'une commande. */
function repeatChanges(a) {
  const f = {}, r = {};
  if (a.repeatEveryMinutes !== undefined) r.minutes = a.repeatEveryMinutes;
  if (a.repeatMinChatLines !== undefined) r.lines = a.repeatMinChatLines;
  if (a.repeatWhen !== undefined) r.when = a.repeatWhen === "always" ? "always" : "live";
  if (a.repeatEnabled !== undefined) r.enabled = a.repeatEnabled === true;
  if (Object.keys(r).length) f.repeat = r;
  if (a.clearRepeat === true) f.repeat = null;
  if (a.timerOnly !== undefined) f.timerOnly = a.timerOnly === true;
  return f;
}

/** The collaboration mode as an assistant reads it (see collab.mjs). */
const iso = (at) => (Number.isFinite(at) ? new Date(at).toISOString() : null);
const collabView = (e) => ({ enabled: e.on, ...(e.on ? { since: iso(e.since), endsAt: iso(e.until), changedFrom: e.by } : {}), timers: e.mode === "pause" ? "paused" : `thinned out: 1 in ${e.ratio} is sent`, timersChoice: e.mode === "pause" ? "pause" : "every_n", timersEveryN: e.mode === "pause" ? null : e.ratio, commandDelayFactor: e.factor, muteOtherAutomaticMessages: e.quiet, autoEndHours: e.hours, autoStopHours: e.hours });

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

/** L'ancienne forme d'un timer pour les outils `timers_list`, `timer_create`, `timer_update` (leurs noms ne changent pas) : une commande qui se répète. */
const timerView = (c) => ({ ...periodView(c.period), name: c.title || c.name, command: c.name, text: c.text, everyMinutes: c.repeat.minutes, minChatLines: c.repeat.lines, when: c.repeat.when === "always" ? "always" : "live only", enabled: c.repeat.enabled !== false, ...(c.timerOnly ? { timerOnly: true } : {}) });
const timerOf = (list, name) => list.find((c) => c.repeat && [c.title, c.name].some((x) => x && x.toLowerCase() === String(name).toLowerCase()));

export default {
  async timers_list(ctx) {
    const info = await context(ctx, { declare: false });
    return { maximum: T.MAX_TIMERS, note: "A timer is the automatic repeat of a command. It is only checked when a chat message arrives (no background clock): it needs an active chat.", timers: info.list.filter((c) => c.repeat).map(timerView) };
  },
  async timer_create(ctx, args) {
    const info = await context(ctx, { declare: false });
    if (timerOf(info.list, args.name)) throw expose(saveError(ctx, { code: "timer_dup" }));
    const title = String(args.name ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, 40);
    if (!title) throw expose(saveError(ctx, { code: "timer_name" }));
    const taken = new Set([...takenWords(info.list).keys(), ...RESERVED]);
    const name = freeName(slugName(title, "timer"), taken);
    const repeat = { minutes: args.everyMinutes, lines: args.minChatLines, when: args.when === "always" ? "always" : "live", enabled: args.enabled !== false };
    const r = await saveCommand(ctx, { kind: "custom" }, { name, text: args.text, role: "everyone", enabled: true, timerOnly: true, repeat, ...periodOf(ctx, args) }, info.env);
    if (r.ok === false) throw expose(saveError(ctx, r));
    await mutate(ctx, (cfg) => { const c = cfg.custom.find((x) => `custom:${x.id}` === r.key); if (c) c.title = title; return { ok: true }; });
    return { created: true, name: title };
  },
  async timer_update(ctx, args) {
    const info = await context(ctx, { declare: false });
    const cur = timerOf(info.list, args.name);
    if (!cur) throw expose(`no timer named "${args.name}"`);
    const f = { ...periodOf(ctx, args) };
    if (args.text !== undefined) f.text = args.text;
    const rp = {};
    for (const [k, to] of [["everyMinutes", "minutes"], ["minChatLines", "lines"], ["enabled", "enabled"]]) if (args[k] !== undefined) rp[to] = args[k];
    if (args.when !== undefined) rp.when = args.when === "always" ? "always" : "live";
    if (Object.keys(rp).length) f.repeat = rp;
    if (args.newName !== undefined) {
      if (cur.timerOnly) { const t2 = String(args.newName).replace(/\s+/g, " ").trim().slice(0, 40); if (!t2) throw expose(saveError(ctx, { code: "timer_name" })); const other = timerOf(info.list, t2); if (other && other.key !== cur.key) throw expose(saveError(ctx, { code: "timer_dup" })); await mutate(ctx, (cfg) => { const c = cfg.custom.find((x) => `custom:${x.id}` === cur.key); if (c) c.title = t2; return { ok: true }; }); f.title = t2; }
      else f.name = args.newName;
    }
    const { title, ...fields } = f;
    if (!Object.keys(fields).length && title === undefined) throw expose("nothing to change");
    if (Object.keys(fields).length) {
      const r = cur.kind === "partner" || cur.kind === "network" ? await saveSourced(ctx, cur.kind, cur.id, fields, info.env) : await saveCommand(ctx, { kind: cur.kind, id: cur.id }, fields, info.env);
      if (r.ok === false) throw expose(saveError(ctx, r));
    }
    return { updated: true, name: title ?? cur.title ?? f.name ?? cur.name };
  },
  async collaboration_mode_set(ctx, args) {
    const before = CO.choicesOf(await st.readState(ctx));
    // `timers` + `n` (pause, or one out of n) is the current way; `mode` + `ratio` are the older names and still work. `autoStopHours` is the current name of `autoEndHours`.
    const timers = args.timers === undefined ? undefined : args.timers === "pause" ? "pause" : args.timers === "every_n" ? String(args.n ?? before.ratio) : "?";
    const hours = args.autoStopHours !== undefined ? args.autoStopHours : args.autoEndHours;
    if (["timers", "mode", "ratio", "commandDelayFactor", "muteOtherAutomaticMessages"].some((k) => args[k] !== undefined) || hours !== undefined) {
      const r = CO.check({ ...(timers !== undefined ? { timers } : { mode: args.mode, ratio: args.ratio }), factor: args.commandDelayFactor, hours, quiet: args.muteOtherAutomaticMessages === undefined ? undefined : args.muteOtherAutomaticMessages === true }, before);
      if (!r.ok) throw expose(Object.values(r.errors).map((code) => ctx.t(`co_e_${code}`)).join(" "));
      await CO.saveChoices(ctx, r.value);
    }
    await CO.setOn(ctx, args.enabled === true, "assistant");
    return { updated: true, collaborationMode: collabView(await CO.current(ctx)) };
  },
  async bot_commands_list(ctx, args) {
    const info = await context(ctx, { declare: false });
    const list = info.list.filter((c) => !args.kind || c.kind === args.kind);
    return { prefix: info.s.prefix, muted: await st.isMuted(ctx), collaborationMode: collabView(await CO.current(ctx)), commands: list.map(view) };
  },
  async bot_command_create(ctx, args) {
    const info = await context(ctx, { declare: false });
    const r = await saveCommand(ctx, { kind: "custom" }, { name: args.name, text: args.text, aliases: args.aliases ?? [], role: args.role ?? "everyone", enabled: args.enabled !== false, ...(args.delayAllSeconds !== undefined ? { cdGlobal: args.delayAllSeconds } : {}), ...(args.delayPerPersonSeconds !== undefined ? { cdUser: args.delayPerPersonSeconds } : {}), ...repeatChanges(args), ...periodOf(ctx, args) }, info.env);
    if (r.ok === false) throw expose(saveError(ctx, r));
    return { created: true, name: String(args.name).replace(info.s.prefix, "").toLowerCase() };
  },
  async bot_command_update(ctx, args) {
    const info = await context(ctx, { declare: false });
    const word = String(args.name).toLowerCase().replace(info.s.prefix, "");
    const c = info.list.find((x) => x.name === word || x.aliases.includes(word));
    if (!c) throw expose(`no command named "${word}"`);
    const f = { ...changes(args), ...periodOf(ctx, args) };
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
