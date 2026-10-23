// La page « En direct » : l'état de la lecture, le gros bouton « Tout couper », les règles, la simulation, le journal et la limite du jour.
// Pensée pour une personne qui n'est pas technicienne : des phrases, pas de jargon ; chaque problème dit quoi faire. Un don se dit « un don », jamais « des points ».
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const S = await import(`./store.mjs${v}`);
const R = await import(`./rules.mjs${v}`);
const B = await import(`./bridge.mjs${v}`);
const E = await import(`./engine.mjs${v}`);
const { settingsOf } = await import(`./settings.mjs${v}`);

export const SUGGEST_BRIDGE = "home-assistant.bridge";
const esc = (x) => String(x ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const can = (ctx, right) => typeof ctx.can === "function" && ctx.can(right) === true;
const lang = (ctx) => (ctx.locale === "en" ? "en" : "fr");

/** « il y a 3 min » — sans fuseau horaire à deviner. */
export function ago(ctx, ms, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  const rtf = new Intl.RelativeTimeFormat(lang(ctx), { numeric: "auto" });
  if (s < 45) return rtf.format(-s, "second");
  if (s < 3600) return rtf.format(-Math.round(s / 60), "minute");
  if (s < 86400) return rtf.format(-Math.round(s / 3600), "hour");
  return rtf.format(-Math.round(s / 86400), "day");
}
/** « 9 h » / « 9:00 AM », « demain à … » : quand la lecture reprend. */
export function whenText(ctx, at, now = Date.now()) {
  const d = new Date(at);
  const fr = lang(ctx) === "fr";
  const hour = fr ? `${d.getHours()} h${d.getMinutes() ? ` ${String(d.getMinutes()).padStart(2, "0")}` : ""}` : new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(d);
  const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
  return ctx.t(sameDay(at, now) ? "when_today" : sameDay(at, now + 86_400_000) ? "when_tomorrow" : "when_later", { hour, date: d.toLocaleDateString(fr ? "fr" : "en") });
}
const percent = (ctx, units) => String(units > 0 && units < 100 ? 1 : Math.round(units / 100));

/* ───────────── Les phrases ───────────── */

/** « Super Chat de 5,00 € » / « nouvelle adhésion » / « cadeau de 5 adhésions ». */
export function eventText(ctx, e) {
  switch (e.kind) {
    case "superchat": return ctx.t("kind_superchat_amount", { amount: R.formatMoney(e.micros, e.currency, lang(ctx)) });
    case "supersticker": return ctx.t("kind_supersticker_amount", { amount: R.formatMoney(e.micros, e.currency, lang(ctx)) });
    case "member": return ctx.t("kind_member");
    case "gift": return ctx.t("kind_gift_count", { count: e.count });
    default: return ctx.t("kind_other");
  }
}
/** Une règle en une phrase : « Super Chat de 5 € ou plus » / « Super Chat, toutes devises ». */
export function ruleWhen(ctx, r) {
  const money = R.MONEY_TYPES.includes(r.type);
  const label = ctx.t(`type_${r.type}`);
  if (money) return r.currency === "*" ? ctx.t("when_any_currency", { type: label }) : ctx.t("when_min", { type: label, amount: R.formatMoney(r.minMicros || 0, r.currency, lang(ctx)) });
  if (r.type === "gift") return ctx.t("when_gift", { type: label, count: r.minCount || 1 });
  return label;
}
function ruleSummary(ctx, r) {
  const parts = [ruleWhen(ctx, r), `→ ${r.action}${r.readMessage ? ` ${ctx.t("rule_with_message")}` : ""}`];
  parts.push(ctx.t("rule_cooldown", { seconds: r.cooldownSec || 0 }));
  if (r.enabled === false) parts.push(ctx.t("rule_paused"));
  return parts.join(" · ");
}

const REFUSED = ["off", "offline", "not_live", "blocked", "busy", "unknown_key", "not_paired", "not_installed"];
/** Ce qui est arrivé, en une phrase (journal et message après une simulation). */
export function resultText(ctx, l) {
  const t = ctx.t;
  if (l.kind === "command") {
    if (l.status === "done") return t(l.command === "stop" ? "res_cmd_stopped" : "res_cmd_started");
    if (l.status === "refused") return t("res_cmd_refused", { command: `!${l.command}` });
    return t("res_cmd_failed", { command: `!${l.command}` });
  }
  const extra = `${l.thanks ? ` ${t("res_thanks_only")}` : ""}${l.voiceRefused && !l.thanks ? ` ${t("res_voice_refused")}` : ""}`;
  switch (l.status) {
    case "sent": return t("res_sent");
    case "done": return `${t("res_done")}${extra}`;
    case "failed": return t("res_failed");
    case "expired": return t("res_expired");
    case "lost": return t("res_lost");
    case "ignored": return t(["unmapped", "disabled", "expired", "error"].includes(l.code) ? `res_ignored_${l.code}` : "res_ignored_error");
    case "skipped": return l.reason === "cooldown" ? t("res_cooldown", { seconds: l.seconds ?? 0 }) : l.reason === "alert_only" ? t("res_alert_only") : t("res_no_rule");
    case "refused": {
      if (!l.reason) return t("res_refused_off");   // refusé par la maison après coup (coupe-circuit)
      return `${t(REFUSED.includes(l.reason) ? `res_refused_${l.reason}` : "res_refused_error")}${extra}`;
    }
    default: return "";
  }
}
const tone = (l) => (l.status === "done" || (l.kind === "command" && l.status === "done") ? "ok" : ["refused", "failed", "expired", "lost"].includes(l.status) || (l.status === "skipped" && l.reason === "cooldown") ? "bad" : "mid");

/* ───────────── Les blocs ───────────── */

function errorText(ctx, e, now) {
  const retry = e?.retryAt > now ? whenText(ctx, e.retryAt, now) : ctx.t("soon");
  const code = ["config", "unavailable", "auth", "chat_denied", "quota", "rate", "timeout", "network", "channel", "invalid"].includes(e?.code) ? e.code : "network";
  return ctx.t(`err_${code}`, { when: retry });
}

function statusBlocks(ctx, o) {
  const t = ctx.t;
  const st = o.state;
  const out = [];
  const title = st.title ? `« ${st.title.replace(/[«»]/g, "")} »` : "";
  switch (st.status) {
    case "off": out.push({ type: "banner", tone: "warning", text: t("st_off") }); break;
    case "no_bridge": out.push({ type: "banner", tone: "info", text: t("st_no_bridge") }, { type: "suggestInstall", service: SUGGEST_BRIDGE, reason: t("suggest_bridge") }); break;
    case "no_api": out.push({ type: "banner", tone: "warning", text: t("st_no_api") }, { type: "suggestInstall", service: B.API, reason: t("suggest_api") }); break;
    case "no_channel": out.push({ type: "banner", tone: "info", text: t("st_no_channel") }, { type: "suggestInstall", service: B.LIVE, reason: t("suggest_channel") }); break;
    case "ambiguous": out.push({ type: "banner", tone: "warning", text: t("st_ambiguous") }); break;
    case "unverified": out.push({ type: "banner", tone: "warning", text: t("st_unverified") }); break;
    case "budget": out.push({ type: "banner", tone: "warning", text: t("st_budget", { percent: o.s.budgetPercent, when: whenText(ctx, nextReset(o.now), o.now) }) }); break;
    case "backoff": out.push({ type: "banner", tone: "warning", text: errorText(ctx, st.error, o.now) }); break;
    case "no_chat": out.push({ type: "banner", tone: "info", text: t("st_no_chat", { title }) }); break;
    case "idle": out.push({ type: "banner", tone: "info", text: t("st_idle") }); break;
    case "reading": out.push({ type: "banner", tone: "success", text: t("st_reading", { title, when: st.lastPollAt ? ago(ctx, st.lastPollAt, o.now) : t("st_just_now") }) }); break;
    default: out.push({ type: "banner", tone: "info", text: t("st_starting") });
  }
  return out;
}
/** Prochaine remise à zéro de la limite YouTube (minuit à Los Angeles) : 9 h du matin en France (hiver : 9 h aussi à Bruxelles, à une heure près selon l'heure d'été). */
function nextReset(now) {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const parts = (t) => Object.fromEntries(fmt.formatToParts(new Date(t)).filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)]));
  const p = parts(now);
  const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(now / 1000) * 1000;
  let at = Date.UTC(p.year, p.month - 1, p.day + 1, 0, 0, 0) - offset;
  const q = parts(at);
  if (q.hour !== 0) at -= (q.hour > 12 ? q.hour - 24 : q.hour) * 3_600_000;
  return at;
}

// Le grand bouton : le formulaire du cœur, agrandi par une règle de style qui le retrouve grâce à un champ caché.
const BIG_CSS = `<style>
form:has(input[name="yt_big"]){padding:1rem}
form:has(input[name="yt_big"]) button{width:100%;min-height:4.5rem;font-size:1.5rem;font-weight:800;border-radius:1rem;letter-spacing:.01em}
form:has(input[name="yt_big"][value="stop"]) button{background:#b91c1c!important;color:#fff!important;border-color:#7f1d1d!important}
form:has(input[name="yt_big"][value="start"]) button{background:#15803d!important;color:#fff!important;border-color:#14532d!important}
form:has(input[name="yt_big"]) button:focus-visible{outline:3px solid currentColor;outline-offset:3px}
</style>`;

function houseBlocks(ctx, o) {
  const t = ctx.t;
  const h = o.house;
  if (!h.installed) return [{ type: "markdown", text: t("house_none") }, { type: "suggestInstall", service: SUGGEST_BRIDGE, reason: t("suggest_bridge") }];
  const out = [];
  const hidden = (value) => ({ name: "yt_big", kind: "hidden", value });
  if (!h.known) out.push({ type: "markdown", text: t("house_unknown") });
  else if (!h.paired) out.push({ type: "banner", tone: "info", text: t("house_unpaired") });
  else if (!h.enabled) out.push({ type: "banner", tone: "warning", text: t("house_cut") });
  else {
    const seen = h.lastSeenAt ? Date.parse(h.lastSeenAt) : 0;
    if (!seen || o.now - seen > 60_000) out.push({ type: "banner", tone: "warning", text: t("house_offline") });
    else if (!h.live) out.push({ type: "banner", tone: "warning", text: t("house_not_live") });
    else out.push({ type: "banner", tone: "success", text: t("house_ok") });
  }
  if (h.known && h.enabled !== false) {
    out.push(can(ctx, "yt.stop") ? { type: "html", html: BIG_CSS } : { type: "markdown", text: t("big_no_right") });
    if (can(ctx, "yt.stop")) out.push({ type: "adminForm", action: "stop", submitLabel: t("big_stop"), fields: [hidden("stop")] });
  } else if (h.known) {
    if (can(ctx, "yt.manage")) out.push({ type: "html", html: BIG_CSS }, { type: "adminForm", action: "start", submitLabel: t("big_start"), fields: [hidden("start")] });
    else out.push({ type: "markdown", text: t("big_resume_no_right") });
  }
  return out;
}

function infoBlocks(ctx) {
  const t = ctx.t;
  return [
    { type: "markdown", text: t("info_open") },
    { type: "html", html: `<details><summary>${esc(t("info_more_title"))}</summary><div style="line-height:1.6;margin-top:.5rem"><p>${esc(t("info_stop"))}</p><p>${esc(t("info_gift"))}</p><p>${esc(t("info_currency"))}</p><p>${esc(t("info_nochat"))}</p></div></details>` },
  ];
}

function ruleForm(ctx, o, editing) {
  const t = ctx.t;
  const cur = editing ?? { type: "superchat", currency: "EUR", minMicros: 5_000_000, minCount: 1, cooldownSec: 30, action: R.EXAMPLE_KEYS[0], readMessage: false, enabled: true, name: "" };
  const isExample = R.EXAMPLE_KEYS.includes(cur.action);
  const currencies = R.currenciesOf(o.s.extraCurrencies);
  const fields = [
    ...(editing ? [{ name: "id", kind: "hidden", value: editing.id }] : []),
    { name: "name", kind: "text", label: t("f_name"), value: cur.name, required: true, help: t("f_name_help") },
    { name: "type", kind: "select", label: t("f_type"), value: cur.type, options: R.TYPES.map((x) => ({ value: x, label: t(`type_${x}`) })), help: t("f_type_help") },
    { name: "currency", kind: "select", label: t("f_currency"), value: cur.currency, options: [{ value: "*", label: t("any_currency") }, ...currencies.map((c) => ({ value: c, label: c }))], help: t("f_currency_help") },
    { name: "min", kind: "text", label: t("f_min"), value: cur.type === "gift" ? String(cur.minCount ?? 1) : R.fromMicros(cur.minMicros || 0, lang(ctx)), help: t("f_min_help") },
    { name: "cooldownSec", kind: "text", label: t("f_cooldown"), value: String(cur.cooldownSec ?? 30), help: t("f_cooldown_help") },
    { name: "action", kind: "select", label: t("f_action"), value: isExample ? cur.action : R.EXAMPLE_KEYS[0], options: R.EXAMPLE_KEYS.map((k) => ({ value: k, label: k })), help: t("f_action_help") },
    { name: "customAction", kind: "text", label: t("f_custom_action"), value: isExample ? "" : cur.action, help: t("f_custom_action_help") },
    { name: "readMessage", kind: "checkbox", label: t("f_read"), value: cur.readMessage ? "on" : "", help: t("f_read_help") },
  ];
  return [
    { type: "heading", text: editing ? t("rules_edit_title", { name: editing.name }) : t("rules_add_title") },
    { type: "adminForm", action: "saveRule", submitLabel: editing ? t("rules_save") : t("rules_add"), fields, ...(editing ? { cancelHref: "?" } : {}) },
  ];
}

function ruleBlocks(ctx, o, query) {
  const t = ctx.t;
  const manage = can(ctx, "yt.manage");
  const out = [{ type: "heading", text: t("rules_title") }];
  if (!o.rules.length) out.push({ type: "markdown", text: t("rules_empty") });
  else {
    out.push({
      type: "table", columns: [t("col_rule")], rows: o.rules.map((r) => [`${r.name} — ${ruleSummary(ctx, r)}`]), rowIds: o.rules.map((r) => r.id),
      ...(manage ? { rowActions: [{ label: t("rule_edit"), href: "?edit={id}" }, { label: t("rule_toggle"), action: "toggleRule" }, { label: t("rule_delete"), action: "removeRule", confirm: t("rule_delete_confirm"), danger: true }] } : {}),
    });
  }
  if (manage) {
    const editing = typeof query?.edit === "string" ? o.rules.find((r) => r.id === query.edit) : null;
    if (editing || o.rules.length < S.LIMITS.rules) out.push(...ruleForm(ctx, o, editing));
    else out.push({ type: "markdown", text: t("rules_full", { max: S.LIMITS.rules }) });
  }
  return out;
}

function simBlocks(ctx, o) {
  const t = ctx.t;
  if (!can(ctx, "yt.test")) return [];
  const house = o.house;
  const currencies = R.currenciesOf(o.s.extraCurrencies);
  return [
    { type: "heading", text: t("sim_title") },
    { type: "markdown", text: house.installed ? t("sim_help") : t("sim_no_bridge") },
    ...(house.installed ? [{
      type: "adminForm", action: "simulate", submitLabel: t("sim_btn"), fields: [
        { name: "type", kind: "select", label: t("f_type"), value: "superchat", options: R.TYPES.map((x) => ({ value: x, label: t(`type_${x}`) })) },
        { name: "amount", kind: "text", label: t("sim_amount"), value: "5", help: t("sim_amount_help") },
        { name: "currency", kind: "select", label: t("f_currency"), value: "EUR", options: currencies.map((c) => ({ value: c, label: c })) },
        { name: "count", kind: "text", label: t("sim_count"), value: "5", help: t("sim_count_help") },
        { name: "text", kind: "textarea", label: t("sim_text"), help: t("sim_text_help") },
      ],
    }] : []),
  ];
}

function journalHtml(ctx, o) {
  const t = ctx.t;
  const rows = o.journal.slice(0, 50).map((l) => {
    const when = esc(ago(ctx, l.at, o.now));
    if (l.kind === "system") return `<li class="yj-row yj-sys"><span class="yj-when">${when}</span><span class="yj-what">${esc(t("ev_old", { count: l.count ?? 0 }))}</span></li>`;
    const what = l.kind === "command" ? `<code>!${esc(l.command)}</code>` : esc(eventText(ctx, l));
    const who = l.who && !l.test ? ` <span class="yj-who">${esc(l.who)}</span>` : "";
    const pill = l.test ? ` <b class="yj-pill">${esc(t("jr_test"))}</b>` : "";
    const act = l.key ? `<span class="yj-act">${l.rule ? `${esc(l.rule)} · ` : ""}<code>${esc(l.key)}</code></span>` : "";
    return `<li class="yj-row yj-${tone(l)}"><span class="yj-when">${when}</span><span class="yj-what">${what}${pill}${who}${act}</span><span class="yj-res">${esc(resultText(ctx, l))}</span></li>`;
  });
  const css = `<style>
.yj{list-style:none;margin:0;padding:0;border:1px solid rgba(128,128,128,.35);border-radius:.75rem;overflow:hidden}
.yj-row{display:grid;grid-template-columns:9.5rem 1fr;gap:.15rem .75rem;padding:.65rem .8rem;border-top:1px solid rgba(128,128,128,.25);font-size:.92rem;align-items:baseline}
.yj-row:first-child{border-top:0}
.yj-when{opacity:.75;white-space:nowrap}
.yj-res{grid-column:2;font-weight:600}
.yj-ok .yj-res{color:#15803d}.yj-bad .yj-res{color:#b91c1c}
@media (prefers-color-scheme:dark){.yj-ok .yj-res{color:#4ade80}.yj-bad .yj-res{color:#f87171}}
:root[data-theme="dark"] .yj-ok .yj-res{color:#4ade80}:root[data-theme="dark"] .yj-bad .yj-res{color:#f87171}
:root[data-theme="light"] .yj-ok .yj-res{color:#15803d}:root[data-theme="light"] .yj-bad .yj-res{color:#b91c1c}
.yj-sys .yj-what{opacity:.85;font-style:italic;grid-column:2}
.yj-pill{display:inline-block;padding:0 .5rem;border-radius:999px;background:rgba(128,128,128,.25);font-size:.8em}
.yj-who{opacity:.8}.yj-act{display:block;opacity:.85;overflow-wrap:anywhere}
.yj-what{overflow-wrap:anywhere}
@media (max-width:520px){.yj-row{grid-template-columns:1fr}.yj-res{grid-column:1}.yj-sys .yj-what{grid-column:1}}
</style>`;
  return `${css}<ul class="yj" aria-label="${esc(t("jr_title"))}">${rows.join("")}</ul>`;
}

function journalBlocks(ctx, o) {
  const t = ctx.t;
  const out = [{ type: "heading", text: t("jr_title") }];
  if (!o.journal.length) { out.push({ type: "markdown", text: t("jr_empty") }); return out; }
  out.push({ type: "html", html: journalHtml(ctx, o) });
  out.push({ type: "markdown", text: t("jr_note") });
  if (can(ctx, "yt.manage")) out.push({ type: "adminForm", action: "clearJournal", submitLabel: t("jr_clear"), fields: [] });
  return out;
}

function limitBlocks(ctx, o) {
  const t = ctx.t;
  const perHour = Math.max(1, Math.round(((3_600_000 / Math.max(o.s.intervalMs, o.state.pollingMs || 0)) * 5) / 100));
  return [
    { type: "heading", text: t("limit_title") },
    { type: "markdown", text: t("limit_text", { used: percent(ctx, o.units), max: o.s.budgetPercent, hour: perHour }) },
  ];
}

/** Le petit mot qui recharge la page tant qu'elle est ouverte : c'est son « battement de cœur » (voir engine.mjs). Pas d'objet qui tourne côté serveur. */
export function reloadMs(o) {
  const st = o.state, soon = o.journal.some((l) => l.status === "sent" && o.now - l.at < 90_000);
  let at = null;
  if (st.status === "reading") at = st.nextPollAt;
  else if (st.status === "idle" || st.status === "no_chat") at = st.nextDetectAt;
  else if (st.status === "backoff") at = st.backoffUntil;
  else if (st.status === "budget") at = o.now + E.timing.reloadMaxMs;
  if (soon) at = Math.min(at ?? Infinity, o.now + 5000);
  if (at === null) return null;
  return Math.round(Math.min(E.timing.reloadMaxMs, Math.max(E.timing.reloadMinMs, at - o.now + 400)));
}
function reloadBlock(ctx, ms) {
  if (!ms) return [];
  // Ne recharge pas si l'onglet n'est pas affiché ou si quelqu'un est en train d'écrire dans un champ (on réessaie 2 s plus tard).
  const js = `var T=this.closest('[role=tabpanel]');setTimeout(function r(){var a=document.activeElement,n=a&&a.tagName;if((T&&!T.getClientRects().length)||(n&&/^(INPUT|TEXTAREA|SELECT)$/.test(n))){setTimeout(r,2000);return}location.reload()},${ms})`;
  return [{ type: "html", html: `<p style="margin:0;font-size:.85em;opacity:.75">${esc(ctx.t("reload_note"))}</p><img alt="" width="1" height="1" src="data:," onerror="${js}">` }];
}

/** Le panneau de l'onglet « En direct ». Chaque affichage est un battement de cœur : il lance un tour de lecture (borné) avant de dessiner. */
export async function panel(ctx, { query } = {}) {
  await B.within(E.tick(ctx), E.timing.renderBudgetMs, null);
  await E.reconcile(ctx);
  const o = await E.overview(ctx);
  return [
    ...statusBlocks(ctx, o),
    ...houseBlocks(ctx, o),
    ...infoBlocks(ctx),
    ...ruleBlocks(ctx, o, query),
    ...simBlocks(ctx, o),
    ...journalBlocks(ctx, o),
    ...limitBlocks(ctx, o),
    ...reloadBlock(ctx, reloadMs(o)),
  ];
}

/* ───────────── Les actions ───────────── */

const who = () => "admin";
export const actions = {
  stop: { right: "yt.stop", run: async (ctx) => { const r = await B.bridge(ctx, "stop", { by: who(ctx) }); return r.ok && r.value?.ok !== false ? { ok: ctx.t("done_stop") } : { error: ctx.t("err_house_absent") }; } },
  start: { right: "yt.manage", run: async (ctx) => { const r = await B.bridge(ctx, "start", { by: who(ctx) }); return r.ok && r.value?.ok !== false ? { ok: ctx.t("done_start") } : { error: ctx.t("err_house_absent") }; } },
  saveRule: {
    right: "yt.manage",
    run: async (ctx, values) => {
      const r = R.validateRule(values);
      if (!r.ok) return { errors: Object.fromEntries(Object.entries(r.errors).map(([field, key]) => [field, ctx.t(key)])) };
      const id = typeof values.id === "string" && values.id ? values.id : null;
      const prev = id ? (await S.listRules(ctx)).find((x) => x.id === id) : null;
      const saved = await S.saveRule(ctx, id, { ...r.rule, lastAt: prev?.lastAt ?? 0, order: prev?.order });
      if (!saved) return { error: ctx.t("rules_full", { max: S.LIMITS.rules }) };
      return { ok: ctx.t(id ? "done_rule_saved" : "done_rule_added"), redirect: "?" };
    },
  },
  toggleRule: {
    right: "yt.manage",
    run: async (ctx, values) => {
      const rule = (await S.listRules(ctx)).find((x) => x.id === values.id);
      if (!rule) return { error: ctx.t("err_rule_gone") };
      const { id, ...data } = rule;
      await S.saveRule(ctx, id, { ...data, enabled: rule.enabled === false });
      return { ok: ctx.t(rule.enabled === false ? "done_rule_on" : "done_rule_off") };
    },
  },
  removeRule: { right: "yt.manage", run: async (ctx, values) => { await S.removeRule(ctx, String(values.id ?? "")); return { ok: ctx.t("done_rule_removed") }; } },
  clearJournal: { right: "yt.manage", run: async (ctx) => { await S.clearJournal(ctx); return { ok: ctx.t("done_clear") }; } },
  simulate: {
    right: "yt.test",
    run: async (ctx, values) => {
      const r = await E.simulate(ctx, values);
      if (!r.ok) {
        const field = r.field && ["type", "amount", "currency", "count"].includes(r.field) ? r.field : null;
        if (field) return { errors: { [field]: ctx.t(`sim_err_${r.code}`) } };
        return { error: ctx.t(["too_fast", "too_many", "no_bridge"].includes(r.code) ? `sim_err_${r.code}` : "sim_err_other") };
      }
      const sentences = r.lines.map((l) => `${l.rule ? `${l.rule} : ` : ""}${resultText(ctx, l)}`);
      return { ok: `${ctx.t("done_sim")} ${sentences.join(" ")}`.slice(0, 600) };
    },
  },
};
