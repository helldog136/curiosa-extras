// The Twitch bot panel of the remote control (phone and OBS dock) of Audience: the service "audience.remote" (version 1), offered to Audience and called by it.
// Audience holds the secret address, the rate limit and the audit journal; this file only describes the panel and obeys three gestures:
//   describe({ locale })              → { ok: true, panel }   one switch (the bot answers / is paused), a two-field form to add a command, "undo" buttons for the last additions
//   press({ action, values, locale }) → { ok, message?, error?, field? }
//     pause / resume   the existing emergency stop (state.mjs: `muted`), the one the administration shows; honoured by every path that writes in the chat (see README)
//     collabon / collaboff   the collaboration mode (collab.mjs): the bot talks less on its own while you stream with other people, with the choices kept in the state (the same as the administration)
//     collabset        the choices of the mode, from the switch card itself: what the timers do (pause, or 1 in 2, 3 or 5) and the automatic end (2, 4, 6 hours, never); saved for next time, applied at once when the mode is on
//     addcom           a text-only command: name + reply, everything else is the default of the bot (everyone, usual delays, enabled)
//     undo             removes a command added from here, only while nobody changed it since
// Nothing here is reachable without the secret address: the only caller is Audience, after it checked the address (see its README).
const v = new URL(import.meta.url).search; // the version of the module spreads to the neighbouring files (otherwise the old code would stay cached after an update)
const st = await import(`./state.mjs${v}`);
const { settingsOf } = await import(`./settings.mjs${v}`);
const { loadConfig, loadConfigCached, saveCommand, removeCustom, norm, NAME_RE } = await import(`./commands.mjs${v}`);
const { used } = await import(`./variables.mjs${v}`);
const { saveError } = await import(`./errors.mjs${v}`);
const { noSources } = await import(`./sources.mjs${v}`);
const CO = await import(`./collab.mjs${v}`);

export const RECENT_MAX = 3;
/** The error field name the page puts the message under for the switch. */
const SWITCH_FIELD = "tg";
/** The second switch of the panel (collaboration mode): Audience names its error field after the position of the switch. */
const COLLAB_FIELD = "tg1";

const no = (error, message, field) => ({ ok: false, error, message, ...(field ? { field } : {}) });
/** What makes a quick-added command "still the one we added": if the person changed anything in the administration, the undo button disappears. */
const signature = (c) => JSON.stringify([c.name, c.text, c.enabled !== false, c.role ?? "everyone", c.aliases ?? [], c.cdGlobal ?? null, c.cdUser ?? null, c.period ?? null, c.repeat ?? null, c.timerOnly === true]);

/** The quick-added commands that still exist and were not changed since (the last three, newest first). */
async function recentOf(ctx, state) {
  const cfg = (await loadConfigCached(ctx)).data;
  return (Array.isArray(state.quick) ? state.quick : []).filter((q) => q && typeof q.id === "string").flatMap((q) => {
    const c = cfg.custom.find((x) => x.id === q.id);
    return c && signature(c) === q.sig ? [{ id: q.id, name: c.name }] : [];
  }).slice(0, RECENT_MAX);
}

export async function describe(ctx) {
  const t = ctx.t, s = settingsOf(ctx), state = await st.readState(ctx);
  const paused = state.muted === true;
  const code = state.sub?.code;
  const problem = !paused && !!code && !["listening", "pending"].includes(code);
  const recent = await recentOf(ctx, state);
  const co = await CO.current(ctx);
  return {
    ok: true,
    panel: {
      title: t("rc_title"), tab: t("rc_tab"),
      badge: paused ? t("rc_badge_paused") : co.on ? t("rc_badge_collab") : "", alert: paused,
      state: problem ? { text: t("rc_not_listening"), tone: "idle" } : null,
      // The switch shows the CURRENT state; the action it carries says the state we want, so a second tap never undoes the first.
      toggles: [{ id: paused ? "resume" : "pause", label: t("rc_switch"), on: !paused, text: t(paused ? "rc_state_paused" : "rc_state_on"), hint: t("rc_switch_hint") },
        // Same rule: the switch shows the CURRENT state, its action says the state we want. The card says only the state (text); what it does is in the "?" bubble (more), and lets the person choose.
        { id: co.on ? "collaboff" : "collabon", label: t("rc_collab"), on: co.on, calm: true, text: CO.stateLine(t, co, Date.now()), more: t("rc_collab_more"), foldLabel: t("rc_collab_fold"),
          choices: [
            { id: "collabset", name: "timers", label: t("rc_collab_timers"),
              options: CO.TIMERS.map((x) => ({ value: x, label: x === "pause" ? t("rc_o_pause") : t("co_o_ratio", { n: x }), on: CO.timersOf(co) === x })) },
            { id: "collabset", name: "hours", label: t("rc_collab_hours"), folded: true,
              options: CO.HOURS_LIST.map((h) => ({ value: String(h), label: h === 0 ? t("rc_o_never") : t("rc_o_hours", { h }), on: co.hours === h })) },
          ] }],
      forms: [{
        id: "addcom", title: t("rc_add_title"), submit: t("rc_add_btn"),
        fields: [
          { name: "name", label: t("rc_f_name"), type: "text", required: true, max: 30, example: t("rc_f_name_ex") },
          { name: "text", label: t("rc_f_text"), type: "text", required: true, max: 200, example: t("rc_f_text_ex") },
        ],
      }],
      buttons: recent.map((r) => ({ id: "undo", label: t("rc_undo", { command: `${s.prefix}${r.name}` }), values: { id: r.id }, group: t("rc_recent") })),
      note: t("rc_note"),
    },
  };
}

async function setPaused(ctx, paused) {
  const t = ctx.t;
  try {
    const before = await st.isMuted(ctx);
    if (before !== paused) {
      await st.setMuted(ctx, paused, "remote");
      if ((await st.isMuted(ctx)) !== paused) throw new Error("not saved");
      await ctx.api.log?.write({ action: paused ? "bot.paused" : "bot.resumed" });
    }
  } catch {
    return no("failed", t("rc_e_switch"), SWITCH_FIELD);
  }
  return { ok: true, message: t(paused ? "rc_paused_done" : "rc_resumed_done") };
}

async function setCollab(ctx, on) {
  const t = ctx.t;
  try {
    await CO.setOn(ctx, on, "remote");
    if ((await CO.current(ctx)).on !== on) throw new Error("not saved");
  } catch {
    return no("failed", t("rc_e_collab"), COLLAB_FIELD);
  }
  return { ok: true, message: t(on ? "co_on_done" : "co_off_done") };
}

/** The choices of the card (timers, automatic end): checked against the short lists, saved for next time, applied at once when the mode is on. */
async function setChoices(ctx, values) {
  const t = ctx.t;
  try {
    const cur = CO.choicesOf(await st.readState(ctx));
    const asked = {};
    if (values.timers !== undefined) asked.timers = values.timers;
    if (values.hours !== undefined) { if (!CO.HOURS_LIST.map(String).includes(String(values.hours))) return no("invalid", t("rc_e_collab_choice"), COLLAB_FIELD); asked.hours = values.hours; }
    if (!Object.keys(asked).length) return no("invalid", t("rc_e_collab_choice"), COLLAB_FIELD);
    const r = CO.check(asked, cur);
    if (!r.ok) return no("invalid", t("rc_e_collab_choice"), COLLAB_FIELD);
    await CO.saveChoices(ctx, r.value);
    const back = CO.choicesOf(await st.readState(ctx));
    if (back.mode !== r.value.mode || back.ratio !== r.value.ratio || back.hours !== r.value.hours) throw new Error("not saved");
    return { ok: true, message: t((await CO.current(ctx)).on ? "rc_collab_saved_on" : "rc_collab_saved_off") };
  } catch {
    return no("failed", t("rc_e_collab"), COLLAB_FIELD);
  }
}

async function quickAdd(ctx, values) {
  const t = ctx.t, s = settingsOf(ctx), p = s.prefix;
  const name = norm(values.name, p), text = String(values.text ?? "").trim();
  if (!name) return no("invalid", t("rc_e_name_empty"), "name");
  if (!NAME_RE.test(name)) return no("invalid", t("rc_e_name", { value: String(values.name ?? "").trim().slice(0, 30) }), "name");
  if (!text) return no("invalid", t("rc_e_text_empty"), "text");
  // Text only: the one piece that reaches out to a website stays in the administration (where the allowed websites are chosen).
  if (used(text).includes("urlfetch")) return no("invalid", t("rc_e_fetch"), "text");
  const r = await saveCommand(ctx, { kind: "custom" }, { name, text, enabled: true, role: "everyone" }, { src: noSources(), t, prefix: p });
  if (r.ok === false) {
    if (r.code === "name") return no("invalid", t("rc_e_name", { value: name.slice(0, 30) }), "name");
    if (r.code === "collision") return no("exists", t("rc_e_taken", { command: `${p}${r.word}`, example: `${p}${r.word.slice(0, 24)}2` }), "name");
    if (r.code === "too_many") return no("full", saveError(ctx, r));
    if (r.code === "text_unknown") return no("invalid", t("rc_e_unknown", { piece: `{${String(r.vars?.[0] ?? "").slice(0, 30)}}` }), "text");
    if (String(r.code).startsWith("text_")) return no("invalid", saveError(ctx, r), "text");
    return no("failed", t("rc_e_add"));
  }
  const id = String(r.key).slice("custom:".length);
  const saved = (await loadConfig(ctx)).data.custom.find((c) => c.id === id);
  if (saved) {
    await st.updateState(ctx, (d) => { d.quick = [{ id, sig: signature(saved), at: Date.now() }, ...(Array.isArray(d.quick) ? d.quick : [])].slice(0, 10); });
    await ctx.api.log?.write({ action: "command.quickadded", data: { name } });
  }
  return { ok: true, message: t("rc_added", { command: `${p}${name}` }) };
}

async function undo(ctx, values) {
  const t = ctx.t, p = settingsOf(ctx).prefix, id = String(values.id ?? "");
  const state = await st.readState(ctx);
  const rec = (Array.isArray(state.quick) ? state.quick : []).find((q) => q?.id === id);
  const c = rec && (await loadConfig(ctx)).data.custom.find((x) => x.id === id);
  if (!rec || !c) return no("gone", t("rc_e_gone"));
  if (signature(c) !== rec.sig) return no("changed", t("rc_e_changed", { command: `${p}${c.name}` }));   // changed in the administration since: it is theirs now
  const r = await removeCustom(ctx, id);
  if (r.ok === false) return no("gone", t("rc_e_gone"));
  await st.dropCounter(ctx, `custom:${id}`).catch(() => {});
  await st.updateState(ctx, (d) => { d.quick = (Array.isArray(d.quick) ? d.quick : []).filter((q) => q?.id !== id); });
  await ctx.api.log?.write({ action: "command.quickremoved", data: { name: c.name } });
  return { ok: true, message: t("rc_undone", { command: `${p}${c.name}` }) };
}

export async function press(ctx, a) {
  const values = a?.values && typeof a.values === "object" ? a.values : {};
  try {
    switch (a?.action) {
      case "pause": return await setPaused(ctx, true);
      case "resume": return await setPaused(ctx, false);
      case "collabon": return await setCollab(ctx, true);
      case "collaboff": return await setCollab(ctx, false);
      case "collabset": return await setChoices(ctx, values);
      case "addcom": return await quickAdd(ctx, values);
      case "undo": return await undo(ctx, values);
      default: return no("invalid", ctx.t("rc_e_invalid"));   // including "panic": "stop everything" closes polls and sign-ups, it does not silence the bot
    }
  } catch {
    return no("failed", ctx.t("rc_e_add"));
  }
}

export default { describe, press };
