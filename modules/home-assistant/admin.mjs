// La page d'administration : l'état, le gros bouton « Tout couper », l'assistant d'association en 3 étapes, le test, le journal.
// Pensée pour une personne qui n'est pas technicienne : des phrases, pas de jargon, et chaque problème dit quoi faire.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const B = await import(`./bridge.mjs${v}`);
const S = await import(`./store.mjs${v}`);
const { liveNow, GRACE_MS } = await import(`./live.mjs${v}`);
const { settingsOf } = await import(`./settings.mjs${v}`);
const { DEFAULT_WORDS } = await import(`./words.mjs${v}`);

/** Le dépôt de l'intégration à installer dans Home Assistant (par HACS). */
export const INTEGRATION_REPO = "https://github.com/helldog136/homeassistant-curiosa";
export const EXAMPLE_KEYS = ["lumieres:rouge", "tts:lire"];
export const TEST_FOLLOW_MS = 60_000;

const esc = (x) => String(x ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const can = (ctx, right) => typeof ctx.can === "function" && ctx.can(right) === true;

/** « il y a 3 min » — sans fuseau horaire à deviner. */
export function ago(ctx, ms, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  const rtf = new Intl.RelativeTimeFormat(ctx.locale === "en" ? "en" : "fr", { numeric: "auto" });
  if (s < 45) return rtf.format(-s, "second");
  if (s < 3600) return rtf.format(-Math.round(s / 60), "minute");
  if (s < 86400) return rtf.format(-Math.round(s / 3600), "hour");
  return rtf.format(-Math.round(s / 86400), "day");
}
const seconds = (ctx, ms) => `${(Math.max(0, ms) / 1000).toFixed(1).replace(/\.0$/, "").replace(".", ctx.locale === "en" ? "." : ",")} s`;

/* ───────────── Ce que la page sait ───────────── */

/** Tout ce qu'il faut pour dessiner la page (et pour les outils des assistants), lu en une fois. */
export async function overview(ctx, now = Date.now()) {
  const live = await liveNow(ctx, now);
  return S.transact(ctx, async (db) => {
    const core = await db.core();
    const open = await B.openNow(db, live, { note: false });
    const queue = await db.queue();
    const log = await db.log();
    const seen = B.lastSeenOf(ctx, core);
    return {
      now, enabled: core.enabled !== false, stoppedAt: core.stoppedAt, stoppedBy: core.stoppedBy,
      paired: core.paired ? { name: core.paired.name, fp: core.paired.fp, at: core.paired.at } : null,
      pending: core.pending && core.pending.expiresAt > now ? { code: core.pending.code, expiresAt: core.pending.expiresAt, tries: core.pending.tries } : null,
      lastSeenAt: seen || null, online: !!seen && now - seen <= B.OFFLINE_MS,
      live, open, graceOnly: open && !live.live, lastLiveAt: core.lastLiveAt || 0,
      queued: queue.items.length, keys: core.keys.slice(), lines: log.lines.slice(),
    };
  }, { now });
}

/* ───────────── Les phrases du journal ───────────── */

function resultText(ctx, l) {
  const back = (l.test ? "" : ctx.t("res_points_back"));
  const text = resultBase(ctx, l);
  return ["expired", "refused"].includes(l.status) ? `${text}${back}` : text;
}
function resultBase(ctx, l) {
  const t = ctx.t;
  switch (l.status) {
    case "queued": return t("res_queued");
    case "delivered": return t("res_delivered");
    case "done": return t("res_done");
    case "failed": return t("res_failed");
    case "expired": return t("res_expired");
    case "ignored": return t(["unmapped", "disabled", "expired", "error"].includes(l.code) ? `res_ignored_${l.code}` : "res_ignored_error");
    case "refused": {
      if (l.code === "blocked") return t("res_refused_blocked", { why: whyText(ctx, l) });
      return t(["off", "offline", "not_live", "busy", "unknown_key", "not_paired"].includes(l.code) ? `res_refused_${l.code}` : "res_refused_off");
    }
    default: return "";
  }
}
function whyText(ctx, l) {
  const code = ["word", "too_long", "number", "empty"].includes(l.why) ? l.why : "empty";
  return ctx.t(`why_${code}`, { word: l.detail ?? "" });
}
function systemText(ctx, l) {
  const known = ["pair_code", "paired", "repaired", "unpaired", "pair_locked", "stop", "start", "test"];
  return ctx.t(known.includes(l.event) ? `ev_${l.event}` : "ev_other", { by: l.by ?? "", name: l.detail ?? "" });
}

/** La phrase d'un message de refus à la mise en file (sous le champ ou dans un bandeau), pour le test. */
export function refusalText(ctx, r) {
  if (r.reason === "blocked") return ctx.t("test_blocked", { why: whyText(ctx, { why: r.why?.code, detail: r.why?.detail }) });
  if (r.reason === "rate") return ctx.t("test_rate", { seconds: r.retryAfter ?? 3 });
  return ctx.t(["off", "offline", "not_paired", "busy", "unknown_key", "not_live"].includes(r.reason) ? `test_${r.reason}` : "test_off");
}

/* ───────────── Les blocs ───────────── */

function statusBlocks(ctx, o) {
  const t = ctx.t;
  const out = [];
  if (!o.paired) out.push({ type: "banner", tone: "info", text: t("st_unpaired") });
  else if (!o.enabled) out.push({ type: "banner", tone: "warning", text: t("st_cut", { by: o.stoppedBy ?? "", when: o.stoppedAt ? ago(ctx, o.stoppedAt, o.now) : "" }) });
  else if (o.online) out.push({ type: "banner", tone: "success", text: t("st_connected", { name: o.paired.name, when: ago(ctx, o.lastSeenAt, o.now) }) });
  else if (o.lastSeenAt) out.push({ type: "banner", tone: "warning", text: t("st_lost", { when: ago(ctx, o.lastSeenAt, o.now) }) });
  else out.push({ type: "banner", tone: "warning", text: t("st_never", { when: ago(ctx, o.paired.at, o.now) }) });
  return out;
}

function liveBlocks(ctx, o) {
  const t = ctx.t;
  const l = o.live;
  if (l.source === "none") return [{ type: "markdown", text: t("live_none") }, { type: "suggestInstall", service: "twitch.live", reason: t("live_reason") }];
  if (l.source === "unknown") return [{ type: "markdown", text: t("live_unknown") }];
  if (l.live) return [{ type: "markdown", text: t("live_yes") }];
  if (o.graceOnly) return [{ type: "markdown", text: t("live_grace", { minutes: Math.round(GRACE_MS / 60_000) }) }];
  return [{ type: "markdown", text: t("live_no") }];
}

// Le grand bouton : le formulaire du cœur, agrandi par une règle de style qui le retrouve grâce à un champ caché.
const BIG_CSS = `<style>
form:has(input[name="ha_big"]){padding:1rem}
form:has(input[name="ha_big"]) button{width:100%;min-height:4.5rem;font-size:1.5rem;font-weight:800;border-radius:1rem;letter-spacing:.01em}
form:has(input[name="ha_big"][value="stop"]) button{background:#b91c1c!important;color:#fff!important;border-color:#7f1d1d!important}
form:has(input[name="ha_big"][value="start"]) button{background:#15803d!important;color:#fff!important;border-color:#14532d!important}
form:has(input[name="ha_big"]) button:focus-visible{outline:3px solid currentColor;outline-offset:3px}
</style>`;

function bigButton(ctx, o) {
  const t = ctx.t;
  const hidden = (value) => ({ name: "ha_big", kind: "hidden", value });
  if (o.enabled) {
    if (!can(ctx, "ha.stop")) return [{ type: "markdown", text: t("big_no_right") }];
    return [{ type: "html", html: BIG_CSS }, { type: "adminForm", action: "stop", submitLabel: t("big_stop"), fields: [hidden("stop")] }];
  }
  if (!can(ctx, "ha.manage")) return [{ type: "markdown", text: t("big_resume_no_right") }];
  return [{ type: "html", html: BIG_CSS }, { type: "adminForm", action: "start", submitLabel: t("big_start"), fields: [hidden("start")] }];
}

function wizardBlocks(ctx, o) {
  const t = ctx.t;
  const site = String(ctx.api.siteUrl ?? "").replace(/\/+$/, "");
  const out = [{ type: "heading", text: t("wiz_title") }];
  out.push({ type: "markdown", text: t("wiz_1", { repo: INTEGRATION_REPO }) });
  out.push({ type: "markdown", text: t("wiz_2") });
  if (o.pending) {
    out.push({ type: "copy", text: o.pending.code, label: t("wiz_code_label") });
    out.push({ type: "markdown", text: t("wiz_code_help", { minutes: Math.max(1, Math.ceil((o.pending.expiresAt - o.now) / 60_000)) }) });
    out.push({ type: "copy", text: site, label: t("wiz_site_label") });
    out.push({ type: "adminForm", action: "pair", submitLabel: t("wiz_again"), fields: [] });
  } else {
    out.push({ type: "adminForm", action: "pair", submitLabel: t("wiz_make"), fields: [] });
  }
  out.push({ type: "markdown", text: t("wiz_3") });
  return out;
}

function deviceBlocks(ctx, o) {
  const t = ctx.t;
  return [
    { type: "heading", text: t("dev_title") },
    { type: "table", columns: [t("dev_name")], rows: [[t("dev_row", { name: o.paired.name, since: ago(ctx, o.paired.at, o.now), mark: o.paired.fp })]], rowIds: ["device"],
      rowActions: [{ label: t("dev_unpair"), action: "unpair", confirm: t("dev_unpair_confirm"), danger: true }] },
    ...(o.pending ? [{ type: "copy", text: o.pending.code, label: t("wiz_code_label") }, { type: "markdown", text: t("wiz_code_help", { minutes: Math.max(1, Math.ceil((o.pending.expiresAt - o.now) / 60_000)) }) }] : []),
    { type: "adminForm", action: "pair", submitLabel: t("dev_another"), fields: [] },
    { type: "markdown", text: t("dev_another_help") },
  ];
}

/** Le dernier test et où il en est, avec le délai total. Se recharge tout seul pendant 60 s tant qu'il n'est pas terminé (pas de minuteur côté serveur). */
function followBlocks(ctx, o) {
  const t = ctx.t;
  const l = o.lines.find((x) => x.kind === "action" && x.test && x.id);
  if (!l) return [];
  const finished = !["queued", "delivered"].includes(l.status);
  const steps = [t("fol_sent", { key: l.key })];
  if (l.deliveredAt) steps.push(t("fol_fetched", { after: seconds(ctx, l.deliveredAt - l.at) }));
  else if (!finished) steps.push(t("fol_waiting_fetch"));
  if (finished) steps.push(t(`fol_end_${["done", "failed", "ignored", "expired", "refused"].includes(l.status) ? l.status : "failed"}`, { after: seconds(ctx, (l.doneAt ?? o.now) - l.at), result: resultText(ctx, l) }));
  else steps.push(t("fol_waiting_run"));
  const follow = !finished && o.now - l.at < TEST_FOLLOW_MS;
  const out = [{ type: "markdown", text: `**${t("fol_title")}**\n\n${steps.map((s) => `- ${s}`).join("\n")}` }];
  if (follow) out.push({ type: "html", html: `<p style="margin:0;font-size:.85em;opacity:.75">${esc(t("fol_live"))}</p><img alt="" width="1" height="1" src="data:," onerror="var d=this;setTimeout(function(){location.reload()},3000)">` });
  return out;
}

function testBlocks(ctx, o) {
  const t = ctx.t;
  if (!can(ctx, "ha.test")) return [];
  const seen = o.keys.length ? o.keys : EXAMPLE_KEYS;
  return [
    { type: "heading", text: t("test_title") },
    { type: "markdown", text: t("test_help") },
    { type: "adminForm", action: "test", submitLabel: t("test_btn"), fields: [
      { name: "key", kind: "select", label: t("test_key"), value: seen[0], options: seen.map((k) => ({ value: k, label: k })), help: t("test_key_help") },
      { name: "customKey", kind: "text", label: t("test_custom"), help: t("test_custom_help") },
      { name: "text", kind: "textarea", label: t("test_text"), help: t("test_text_help", { max: settingsOf(ctx).maxChars }) },
    ] },
    ...followBlocks(ctx, o),
  ];
}

function journalHtml(ctx, o) {
  const t = ctx.t;
  const rows = o.lines.slice(0, 50).map((l) => {
    const when = esc(ago(ctx, l.at, o.now));
    if (l.kind === "system") return `<li class="hj-row hj-sys"><span class="hj-when">${when}</span><span class="hj-what">${esc(systemText(ctx, l))}</span></li>`;
    const tone = l.status === "done" ? "ok" : ["refused", "failed", "expired"].includes(l.status) ? "bad" : "mid";
    const who = l.test ? "" : esc(l.viewer || "");
    return `<li class="hj-row hj-${tone}"><span class="hj-when">${when}</span><span class="hj-what"><code>${esc(l.key)}</code>${l.test ? ` <b class="hj-pill">${esc(t("jr_test"))}</b>` : ""}${who ? ` <span class="hj-who">${who}</span>` : ""}${l.text ? `<span class="hj-text">« ${esc(l.text)} »</span>` : ""}</span><span class="hj-res">${esc(resultText(ctx, l))}</span></li>`;
  });
  const css = `<style>
.hj{list-style:none;margin:0;padding:0;border:1px solid rgba(128,128,128,.35);border-radius:.75rem;overflow:hidden}
.hj-row{display:grid;grid-template-columns:9.5rem 1fr;gap:.15rem .75rem;padding:.65rem .8rem;border-top:1px solid rgba(128,128,128,.25);font-size:.92rem;align-items:baseline}
.hj-row:first-child{border-top:0}
.hj-when{opacity:.75;white-space:nowrap}
.hj-res{grid-column:2;font-weight:600}
.hj-ok .hj-res{color:#15803d}.hj-bad .hj-res{color:#b91c1c}
@media (prefers-color-scheme:dark){.hj-ok .hj-res{color:#4ade80}.hj-bad .hj-res{color:#f87171}}
:root[data-theme="dark"] .hj-ok .hj-res{color:#4ade80}:root[data-theme="dark"] .hj-bad .hj-res{color:#f87171}
:root[data-theme="light"] .hj-ok .hj-res{color:#15803d}:root[data-theme="light"] .hj-bad .hj-res{color:#b91c1c}
.hj-sys .hj-what{opacity:.85;font-style:italic;grid-column:2}
.hj-pill{display:inline-block;padding:0 .5rem;border-radius:999px;background:rgba(128,128,128,.25);font-size:.8em}
.hj-who{opacity:.8}.hj-text{display:block;opacity:.85;overflow-wrap:anywhere}
.hj-what{overflow-wrap:anywhere}
@media (max-width:520px){.hj-row{grid-template-columns:1fr}.hj-res{grid-column:1}.hj-sys .hj-what{grid-column:1}}
</style>`;
  return `${css}<ul class="hj" aria-label="${esc(t("jr_title"))}">${rows.join("")}</ul>`;
}

function journalBlocks(ctx, o) {
  const t = ctx.t;
  const out = [{ type: "heading", text: t("jr_title") }];
  if (!o.lines.length) { out.push({ type: "markdown", text: t("jr_empty") }); return out; }
  out.push({ type: "html", html: journalHtml(ctx, o) });
  out.push({ type: "markdown", text: t("jr_note") });
  if (can(ctx, "ha.manage")) out.push({ type: "adminForm", action: "clearLog", submitLabel: t("jr_clear"), fields: [] });
  return out;
}

/** Réglages : ce que les mots refusés couvrent, et les actions déjà vues. Dans l'onglet « Réglages ». */
function settingsBlocks(ctx, o) {
  const t = ctx.t;
  const s = settingsOf(ctx);
  const list = `<details><summary>${esc(t("words_show", { count: DEFAULT_WORDS.length }))}</summary><p style="overflow-wrap:anywhere;line-height:1.7">${DEFAULT_WORDS.map(esc).join(" · ")}</p></details>`;
  return [
    { type: "markdown", text: t("words_intro", { count: s.matcher.size }), tab: "settings" },
    { type: "html", html: list, tab: "settings" },
    { type: "markdown", text: o.keys.length ? t("keys_seen", { keys: o.keys.map((k) => `\`${k}\``).join(", ") }) : t("keys_none"), tab: "settings" },
  ];
}

/** Le panneau de l'onglet « Utiliser » (et quelques blocs de l'onglet « Réglages »). */
export async function panel(ctx) {
  const o = await overview(ctx);
  const manage = can(ctx, "ha.manage");
  return [
    ...statusBlocks(ctx, o),
    ...bigButton(ctx, o),
    ...liveBlocks(ctx, o),
    ...(manage ? (o.paired ? deviceBlocks(ctx, o) : wizardBlocks(ctx, o)) : []),
    ...(o.paired ? testBlocks(ctx, o) : []),
    ...journalBlocks(ctx, o),
    ...settingsBlocks(ctx, o),
  ];
}

export const badge = async (ctx) => (await S.peek(ctx, "core")).enabled === false ? 1 : 0;

/* ───────────── Les actions ───────────── */

const who = (ctx) => "admin";

export const actions = {
  stop: { right: "ha.stop", run: async (ctx) => { await B.stop(ctx, { by: who(ctx) }); return { ok: ctx.t("done_stop") }; } },
  start: { right: "ha.manage", run: async (ctx) => { await B.start(ctx, { by: who(ctx) }); return { ok: ctx.t("done_start") }; } },
  pair: { right: "ha.manage", run: async (ctx) => { await B.createPairing(ctx, { by: who(ctx) }); return { ok: ctx.t("done_pair") }; } },
  unpair: { right: "ha.manage", run: async (ctx) => { await B.unpair(ctx, { by: who(ctx) }); return { ok: ctx.t("done_unpair") }; } },
  clearLog: {
    right: "ha.manage",
    run: async (ctx) => { await S.transact(ctx, async (db) => { (await db.log()).lines = []; }); return { ok: ctx.t("done_clear") }; },
  },
  test: {
    right: "ha.test",
    run: async (ctx, values) => {
      const custom = String(values.customKey ?? "").trim().toLowerCase();
      const key = custom || String(values.key ?? "").trim();
      if (!B.KEY_RE.test(key)) return { errors: { [custom ? "customKey" : "key"]: ctx.t("test_unknown_key") } };
      const r = await B.testSend(ctx, { key, text: String(values.text ?? "").slice(0, 2000), by: who(ctx) });
      if (r.ok) return { ok: ctx.t("done_test") };
      if (r.reason === "blocked") return { errors: { text: refusalText(ctx, r) } };
      return { error: refusalText(ctx, r) };
    },
  },
};
