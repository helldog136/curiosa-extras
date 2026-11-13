// Participation — la télécommande : ce que les modules branchés décrivent (service « audience.remote »), l'état qu'on envoie au téléphone, et la page elle-même.
//
// Le service « audience.remote » (version 1) est OFFERT par les modules qui ont des boutons à montrer (Sondages, plus tard Quiz, Bingo…) et exigé, en facultatif, par ce module :
//   describe({ locale })              → { ok: true, panel: { title, state?, buttons?, forms? } }
//   press({ action, values, locale }) → { ok: true, message? } | { ok: false, error, message?, field? }
//   tick({ room, channel })           → { ok: true, handled } : « rafraîchis ton direct, il est périmé » (facultatif)
// Voir docs/ideas/audience.md pour les formes exactes.
import { randomBytes } from "node:crypto";
const V = new URL(import.meta.url).search;
const L = await import(`./lib.mjs${V}`);
const K = await import(`./core.mjs${V}`);
const D = await import(`./draw.mjs${V}`);
const { LIMITS } = L;

export const SERVICE = "audience.remote";

/** Attente bornée : la réponse du module, ou `fallback` s'il ne répond pas à temps (le délai est toujours libéré). */
export const withTimeout = (promise, ms, fallback) => new Promise((resolve) => {
  const t = setTimeout(() => resolve(fallback), ms);
  Promise.resolve(promise).then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(fallback); });
});

async function providersOf(ctx) {
  try { return typeof ctx.api.services.providers === "function" ? (await ctx.api.services.providers(SERVICE)).slice(0, LIMITS.panels) : []; } catch { return []; }
}

/** Les panneaux des modules branchés : décrits, ramenés à une forme sûre. Un module qui ne répond pas dans les 3 secondes est simplement absent. */
export async function collectPanels(ctx) {
  const list = await providersOf(ctx);
  const got = await Promise.all(list.map(async (p) => {
    const r = await withTimeout(ctx.api.services.call(SERVICE, "describe", { locale: ctx.locale }, { provider: p.id }).catch(() => null), 3000, null);
    if (!r?.ok || !r.value?.ok) return null;
    const panel = L.sanitizePanel(r.value.panel);
    return panel ? { id: p.id, ...panel } : null;
  }));
  return got.filter(Boolean);
}

/** Les salles les plus récentes avec leurs dernières personnes (pour la sourdine). Mis en cache 2 secondes. */
export async function roomsView(ctx, now = Date.now()) {
  if (K.mem.roomsView && now - K.mem.roomsAt < 2000 && K.mem.roomsFor === ctx.instance.key) return K.mem.roomsView;
  const rooms = (await K.listRooms(ctx)).slice(0, 4);
  const out = [];
  for (const room of rooms) {
    const page = await K.participantsPage(ctx, room, null, 50);
    const named = page.items.filter((p) => p.pseudo).concat(page.items.filter((p) => !p.pseudo));
    out.push({ key: room.k, label: room.label, count: room.count || 0, recent: named.slice(0, LIMITS.recent).map((p) => ({ id: p.id, pseudo: p.pseudo, muted: p.muted })) });
  }
  K.mem.roomsView = out; K.mem.roomsAt = now; K.mem.roomsFor = ctx.instance.key;
  return out;
}

/** Le panneau « Tirage au sort » de Participation elle-même : il se montre après ceux des modules branchés, avec la même forme (téléphone et dock). */
async function ownPanel(ctx, now) {
  try { const p = L.sanitizePanel(await D.remotePanel(ctx, now)); return p ? { id: "audience", ...p } : null; } catch { return null; }
}

export async function remoteState(ctx, now = Date.now()) {
  const [panels, rooms, mine] = await Promise.all([collectPanels(ctx), roomsView(ctx, now), ownPanel(ctx, now)]);
  return { ok: true, now, panels: mine ? [...panels, mine] : panels, rooms };
}

/** Une réponse de refus de la télécommande : { ok: false, error: code }. */
const no = (error, extra = {}) => ({ ok: false, error, ...extra });
const errCode = (v) => (typeof v === "string" && /^[a-z][a-z0-9_]{0,29}$/.test(v) ? v : "failed");

/** Un appui sur un bouton ou un formulaire. Le module visé décide (et valide) ; la réponse est ramenée à { ok, message?, error?, field? }. */
export async function pressPanel(ctx, { panel, action, values }) {
  if (typeof action !== "string" || !/^[a-z][a-z0-9_-]{0,29}$/.test(action)) return no("invalid");
  const clean = L.sanitizeValues(values);
  if (panel === "audience") return pressOwn(ctx, action, clean);
  const known = (await providersOf(ctx)).find((p) => p.id === panel);
  if (!known) return no("gone");
  const r = await withTimeout(ctx.api.services.call(SERVICE, "press", { action, values: clean, locale: ctx.locale }, { provider: known.id }).catch(() => null), 6000, null);
  if (!r?.ok || !L.isObj(r.value)) return no("failed");
  const v = r.value;
  const out = v.ok === true ? { ok: true, message: L.clean(v.message, 200) } : { ok: false, error: errCode(v.error), message: L.clean(v.message, 200) };
  if (v.field && /^[a-z][a-z0-9_]{0,19}$/.test(String(v.field))) out.field = String(v.field);
  await K.journal(ctx, { who: "remote", what: `${known.key}.${action}`, detail: out.ok ? "ok" : out.error });
  if (!out.ok) void ctx.api.log?.write({ action: "remote.failed", data: { panel: known.key, action } });   // seuls les échecs vont au journal du cœur
  return out;
}

/** Les gestes de la télécommande elle-même : sourdine et salle à vider. */
async function pressOwn(ctx, action, values) {
  if (action.startsWith("draw-")) return D.pressDraw(ctx, action, { who: "remote", values });
  if (action === "mute") {
    const room = await K.getRoom(ctx, values.room);
    if (!room) return no("gone");
    const muted = values.muted === "1";
    const r = await K.setMuted(ctx, room, { id: values.id }, muted);
    if (r.error) return no("gone");
    K.mem.roomsView = null;
    await K.journal(ctx, { who: "remote", what: muted ? "mute" : "unmute", room: room.k, detail: r.participant.pseudo || "-" });
    return { ok: true, message: ctx.t(muted ? "remoteMuted" : "remoteUnmuted", { name: r.participant.pseudo || ctx.t("anon") }) };
  }
  if (action === "clear") {
    const r = await K.clearRoom(ctx, values.room);
    if (!r.ok) return no("gone");
    K.mem.roomsView = null;
    await K.journal(ctx, { who: "remote", what: "clearRoom", room: values.room, detail: `${r.removed}` });
    return { ok: true, message: ctx.t("remoteCleared", { n: r.removed }) };
  }
  if (action === "panic") return panic(ctx);
  return no("invalid");
}

/**
 * "Stop everything": what runs stops, nothing is deleted and nobody is drawn. The open draw is closed, and every connected module receives the "panic" gesture
 * (Polls closes its open polls and stops the repeating vote). A module that does not know the gesture, or does not answer in time, is simply ignored.
 */
export async function panic(ctx, now = Date.now()) {
  let stopped = 0;
  const cur = await D.current(ctx, now);
  if (cur && D.stateOf(cur, now) === "open") { const c = await D.close(ctx, { who: "remote", now }); if (c.ok) stopped++; }
  const results = await Promise.all((await providersOf(ctx)).map((p) => withTimeout(ctx.api.services.call(SERVICE, "press", { action: "panic", values: {}, locale: ctx.locale }, { provider: p.id }).catch(() => null), 6000, null)));
  for (const r of results) if (r?.ok && r.value?.ok === true) stopped++;
  K.mem.roomsView = null;
  await K.journal(ctx, { who: "remote", what: "panic", detail: `${stopped}` }, now);
  void ctx.api.log?.write({ action: "panic.stopped" });
  return { ok: true, message: ctx.t("remotePanicDone") };
}

/** Demande à tous les modules branchés de rafraîchir leur direct (un seul appel à la fois par canal, réutilisé pendant 1 s : des centaines de lecteurs ne le répètent pas). */
export function tickProviders(ctx, room, channel, now = Date.now()) {
  const id = `${ctx.instance.key}|${room}|${channel}`;
  const running = K.mem.ticks.get(id);
  if (running && now - running.at < 1000) return running.p;
  const p = withTimeout(ctx.api.services.callAll(SERVICE, "tick", { room, channel }), 3000, []);
  K.mem.ticks.set(id, { p, at: now });
  if (K.mem.ticks.size > 200) for (const [k, v] of K.mem.ticks) if (now - v.at > 5000) K.mem.ticks.delete(k);
  return p;
}

/* ───────────── The remote page: one control dock for every screen ───────────── */
// ONE page for the phone and for the OBS dock (the same secret address; `&dock=1` only adds the keyboard hints and the dark look OBS expects).
//   - a full-height grid (100dvh) that never scrolls: tab bar at the top (always visible, with live badges and the "stop everything" button), one stage, one status line;
//   - the stage is a size container: type, spacing and layout follow ITS size (container queries, clamp()), so the same page fits 300x420, a phone and a wide dock;
//   - the look is the administration's: variables --cur-* given by `ctx.api.adminTheme()` (a fallback with the same names is declared first, for an older core);
//   - the data is a "live view" given by each module (see `sanitizeView`): the page knows stages (idle, live, done) and buttons, not polls or draws.

export const wantsScheme = (url) => { const v = new URL(url).searchParams.get("scheme"); return v === "light" || v === "dark" ? v : null; };

/** The dock is requested by `&dock=1` (nothing else: an unknown value gives the phone page). */
export const wantsDock = (url) => new URL(url).searchParams.get("dock") === "1";

// Fallback for a core without `adminTheme` (before 0.6.6): the same variable names, the administration's dark palette. The theme CSS, when there is one, comes after and wins.
const FALLBACK_TOKENS = ":root{--cur-bg:#15141a;--cur-fg:#ecebf2;--cur-muted:#9d9bad;--cur-surface:#1e1d26;--cur-line:#2d2b38;--cur-accent:#9b8cff;--cur-accent-fg:#15141a;--cur-ok:#6ee7b7;--cur-ok-fg:#052e1c;--cur-warn:#fcd34d;--cur-warn-fg:#2a2000;--cur-danger:#fca5a5;--cur-danger-fg:#3a0a0a;--cur-focus:#9b8cff;--cur-radius:.5rem;--cur-radius-lg:1rem;--cur-shadow:0 1px 2px #0000000d;--cur-space:.25rem;--cur-font:ui-sans-serif,system-ui,sans-serif;color-scheme:dark}";

const DOCK_CSS = String.raw`
*{box-sizing:border-box}
html,body{height:100%;margin:0;overflow:hidden;overscroll-behavior:none}
html{-webkit-text-size-adjust:100%}
body{background:var(--cur-bg);color:var(--cur-fg);font:15px/1.35 var(--cur-font);padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}
button,input,select{font:inherit;color:inherit}
[hidden]{display:none!important}
.sr{position:absolute;top:0;left:0;margin:0;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
:focus-visible{outline:3px solid var(--cur-focus);outline-offset:2px}

.app{display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr) auto;height:100dvh;max-height:100dvh;overflow:hidden}

/* Top bar: tabs + stop everything. Always visible. */
.top{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px;padding:6px;background:var(--cur-surface);border-bottom:1px solid var(--cur-line);position:relative}
.tabs{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:4px}
.tab{min-height:52px;min-width:0;display:grid;align-content:center;justify-items:center;gap:1px;padding:4px 4px;border:2px solid transparent;border-radius:var(--cur-radius);background:transparent;color:var(--cur-muted);cursor:pointer;touch-action:manipulation;line-height:1.15}
.tab .tl{font-weight:700;font-size:clamp(12px,3.6vw,15px);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tab .tb .g{font-size:.8em;margin-right:3px}
@media (max-width:359px){.tab .tb .g,.tab .tb .c{display:none}}
.tab .tb{font-size:12px;font-variant-numeric:tabular-nums;min-height:1.2em;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tab[aria-selected=true]{background:var(--cur-bg);color:var(--cur-fg);border-color:var(--cur-accent)}
.tab.live .tb{color:var(--cur-ok);font-weight:700}
.tab:hover:not([aria-selected=true]){background:color-mix(in srgb,var(--cur-fg) 8%,transparent)}
.panic{min-height:52px;min-width:56px;max-width:68px;display:grid;align-content:center;justify-items:center;gap:1px;padding:4px 6px;text-align:center;white-space:normal;border:2px solid var(--cur-danger);border-radius:var(--cur-radius);background:transparent;color:var(--cur-danger);font-weight:700;font-size:11px;cursor:pointer;touch-action:manipulation;line-height:1.1}
.panic .gl{font-size:16px;line-height:1}
.panic:hover{background:color-mix(in srgb,var(--cur-danger) 14%,transparent)}
.armbar{position:absolute;inset:6px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px;z-index:3}
.armbar{background:var(--cur-surface)}
.armbar .btn{min-height:52px}

/* Stage: a size container; its own size drives the layout. */
.stage{container:stage/size;position:relative;min-height:0;min-width:0;overflow:hidden}
.view{height:100%;display:grid;grid-template-rows:auto auto minmax(0,1fr) auto;grid-template-columns:minmax(0,1fr);gap:clamp(6px,1.8cqh,12px);padding:clamp(8px,2.4cqmin,16px);font-size:clamp(13px,2.2cqmin + 8px,18px)}
.hd{min-width:0;display:grid;gap:2px}
.ttl{margin:0;font-size:1.18em;font-weight:800;line-height:1.2;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.sub{margin:0;color:var(--cur-muted);font-size:.92em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.meter{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:4px 12px}
.clock{font-size:clamp(26px,10cqmin,60px);font-weight:800;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.clock.end{color:var(--cur-warn)}
.cnt{grid-column:2;display:grid;gap:1px;justify-items:end;text-align:right;min-width:0}
.cnt b{font-size:1.5em;line-height:1;font-variant-numeric:tabular-nums}
.cnt span{color:var(--cur-muted);font-size:.9em;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.prog{grid-column:1/-1;height:6px;border-radius:3px;background:color-mix(in srgb,var(--cur-fg) 14%,transparent);overflow:hidden}
.prog i{display:block;height:100%;background:var(--cur-accent)}
.word{font-size:clamp(26px,15cqmin,88px);font-weight:800;line-height:1.1;overflow-wrap:anywhere;color:var(--cur-accent);margin:0;align-self:center;text-align:center}
.bd:has(>.word){align-content:center}

/* Body: results, winners, start form. */
.bd{min-height:0;min-width:0;display:grid;gap:clamp(4px,1cqh,8px);align-content:stretch;overflow:hidden}
.bd.start{align-content:start}
.bars{min-height:0;display:grid;grid-auto-rows:minmax(0,1fr);gap:clamp(3px,.8cqh,8px)}
.bar{--p:0%;position:relative;min-height:0;min-width:0;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px;padding:0 10px;border-radius:var(--cur-radius);border:1px solid var(--cur-line);background:linear-gradient(90deg,color-mix(in srgb,var(--cur-accent) 38%,var(--cur-surface)) var(--p),var(--cur-surface) var(--p));overflow:hidden;line-height:1.1}
.bar .bt{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;font-size:clamp(11px,calc(34cqh / var(--n,4)),1em)}
.bar .bv{font-variant-numeric:tabular-nums;font-weight:800;white-space:nowrap;font-size:clamp(11px,calc(38cqh / var(--n,4)),1.1em)}
.bar .bv small{font-weight:500;color:var(--cur-muted);margin-left:4px}
.bar.lead{border-color:var(--cur-accent);border-width:2px}
.bar.lead .bt::before{content:"★ ";color:var(--cur-accent)}
.bars[data-n="2"]{grid-auto-flow:column;grid-auto-rows:auto;grid-template-columns:repeat(2,minmax(0,1fr))}
.bars[data-n="2"] .bar{grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr);justify-items:center;align-items:start;padding:8px;text-align:center;background:linear-gradient(0deg,color-mix(in srgb,var(--cur-accent) 38%,var(--cur-surface)) var(--p),var(--cur-surface) var(--p))}
.bars[data-n="2"] .bar .bt{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;font-size:1em}
.bars[data-n="2"] .bar .bv{align-self:center;font-size:clamp(22px,13cqmin,64px)}
.bars[data-n="3"],.bars[data-n="4"]{grid-template-columns:repeat(2,minmax(0,1fr))}
.bars[data-n="3"] .bar:last-child{grid-column:1/-1}
.bars[data-n="3"] .bar,.bars[data-n="4"] .bar{grid-template-columns:minmax(0,1fr);justify-items:start;gap:2px;padding:6px 10px;align-content:center}
.bars[data-n="3"] .bar .bv,.bars[data-n="4"] .bar .bv{font-size:clamp(16px,6cqmin,34px)}
@container stage (min-width:520px){
  .bars[data-n="3"],.bars[data-n="4"]{grid-auto-flow:column;grid-auto-rows:auto}
  .bars[data-n="3"]{grid-template-columns:repeat(3,minmax(0,1fr))}.bars[data-n="4"]{grid-template-columns:repeat(4,minmax(0,1fr))}
  .bars[data-n="3"] .bar:last-child{grid-column:auto}
  .bars[data-n="3"] .bar,.bars[data-n="4"] .bar{grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr);justify-items:center;align-items:start;padding:8px;text-align:center;background:linear-gradient(0deg,color-mix(in srgb,var(--cur-accent) 38%,var(--cur-surface)) var(--p),var(--cur-surface) var(--p))}
  .bars[data-n="3"] .bar .bt,.bars[data-n="4"] .bar .bt{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;font-size:1em}
  .bars[data-n="3"] .bar .bv,.bars[data-n="4"] .bar .bv{align-self:center;font-size:clamp(20px,9cqmin,52px)}
}
.bars[data-n="5"] .bar,.bars[data-n="6"] .bar,.bars[data-n="7"] .bar,.bars[data-n="8"] .bar{padding:0 8px}
.empty{align-self:center;justify-self:center;text-align:center;color:var(--cur-muted);margin:0}
.winners{display:grid;gap:6px;align-content:start;grid-template-columns:repeat(auto-fit,minmax(min(100%,128px),1fr));grid-auto-rows:minmax(48px,auto)}
.winners[data-n="1"]{grid-auto-rows:minmax(64px,auto)}
.win{min-height:48px;min-width:0;display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-rows:auto auto;align-items:center;gap:0 6px;padding:4px 10px;border-radius:var(--cur-radius);border:2px solid var(--cur-ok);background:var(--cur-surface);color:var(--cur-fg);cursor:pointer;text-align:left;touch-action:manipulation}
.win:hover{background:color-mix(in srgb,var(--cur-ok) 12%,var(--cur-surface))}
.win .wn{grid-column:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:800;font-size:1.1em}
.win .wn::before{content:"★ ";color:var(--cur-ok)}
.win .nh{grid-column:1;grid-row:2;display:none;font-size:.8em;color:var(--cur-muted)}
.win .gl{grid-column:2;grid-row:1/3;font-size:1.3em;color:var(--cur-muted)}
.winners[data-n="1"] .nh,.winners[data-n="2"] .nh{display:block}

/* Buttons */
.btn{min-height:48px;min-width:48px;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:6px 12px;border-radius:var(--cur-radius);border:2px solid var(--cur-line);background:var(--cur-surface);color:var(--cur-fg);font-weight:700;cursor:pointer;touch-action:manipulation;line-height:1.1;text-align:center;position:relative;min-width:0}
.btn .lb{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.btn .lb.s{display:none}
.btn:hover:not(:disabled){border-color:var(--cur-fg)}
.btn:disabled,.btn[aria-disabled=true]{opacity:.5;cursor:not-allowed}
.btn[aria-busy=true]{cursor:wait}
.btn.primary{min-height:clamp(56px,13cqh,92px);background:var(--cur-accent);color:var(--cur-accent-fg);border-color:transparent;font-size:clamp(15px,3.2cqmin + 6px,24px);font-weight:800}
.btn.primary .lb.l{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;text-align:center}
.btn.primary .lb.s{display:none}
.btn.primary:hover:not(:disabled){filter:brightness(1.08);border-color:transparent}
.btn.danger{border-color:var(--cur-danger);color:var(--cur-danger)}
.btn.danger.go{background:var(--cur-danger);color:var(--cur-danger-fg)}
.btn.undo{background:transparent}
.btn.ok{background:var(--cur-ok);color:var(--cur-ok-fg);border-color:transparent}
.btn.chip{border-style:dashed}
.btn .loss{display:block;font-weight:500;font-size:.78em}
.btn.arm{padding:2px 8px}
.btn.arm .col{display:grid;gap:1px;min-width:0}
.btn.arm .col span{white-space:normal;overflow-wrap:anywhere}
.btn.arm .loss{font-size:11px}
.row:has(.btn.arm){grid-auto-columns:unset;grid-template-columns:minmax(0,3fr) minmax(0,2fr)}
.btn.arm::after{content:"";position:absolute;left:0;bottom:0;height:4px;width:100%;background:currentColor;opacity:.55;transform-origin:left;animation:arm 3s linear forwards}
@keyframes arm{from{transform:scaleX(1)}to{transform:scaleX(0)}}
kbd{display:none;font:600 11px/1 ui-monospace,monospace;padding:2px 5px;border-radius:4px;border:1px solid currentColor;opacity:.7}
@media (pointer:fine){.dk kbd{display:inline-block}}
.acts{display:grid;gap:clamp(6px,1.4cqh,10px);min-width:0}
.row{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:6px;min-width:0}
.chips{display:flex;gap:6px;min-width:0}.chips .btn{flex:1 1 0}.chips .btn.more{flex:0 0 52px;padding:0}
/* Long labels when the row is wide enough for them, short ones otherwise (a label is never cut). */
.row[data-n="3"] .btn,.row[data-n="4"] .btn{padding-left:4px;padding-right:4px}.row[data-n="4"] .btn{font-size:.84em}
.acts,.chips{container-type:inline-size}
@container (max-width:300px){.row[data-n="2"] .lb.l,.chips .lb.l{display:none}.row[data-n="2"] .lb.s,.chips .lb.s{display:inline}}
@container (max-width:560px){.row[data-n="3"] .lb.l,.chips .lb.l{display:none}.row[data-n="3"] .lb.s,.chips .lb.s{display:inline}}
@container (max-width:760px){.row[data-n="4"] .lb.l{display:none}.row[data-n="4"] .lb.s{display:inline}}

/* Start form */
.form{display:grid;gap:clamp(5px,1.2cqh,10px);align-content:start;min-height:0}
.fld{display:grid;gap:2px;min-width:0}
.fld label{font-weight:600;font-size:.88em;color:var(--cur-muted)}
.in{min-height:48px;width:100%;min-width:0;padding:6px 12px;border-radius:var(--cur-radius);border:2px solid var(--cur-line);background:var(--cur-bg);color:var(--cur-fg)}
.in[aria-invalid=true]{border-color:var(--cur-danger)}
.in::placeholder{color:var(--cur-muted)}
@container stage (min-height:441px){.form .in::placeholder{color:transparent}}
.err{margin:0;color:var(--cur-danger);font-weight:600;font-size:.88em}
.seg{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:4px}
.seg label{min-height:48px;display:flex;align-items:center;justify-content:center;gap:4px;border-radius:var(--cur-radius);border:2px solid var(--cur-line);background:var(--cur-surface);color:var(--cur-fg);font-weight:600;cursor:pointer;text-align:center;font-size:.92em;padding:0 4px}
.seg input{position:absolute;opacity:0;pointer-events:none}
.seg input:checked+label{border-color:var(--cur-accent);background:color-mix(in srgb,var(--cur-accent) 22%,var(--cur-surface));font-weight:800}
.seg input:checked+label::before{content:"✓ "}
.seg input:focus-visible+label{outline:3px solid var(--cur-focus);outline-offset:2px}
.seg input.cust{position:static;opacity:1;pointer-events:auto;grid-column:span 2;min-height:48px;padding:4px 6px;text-align:center}.seg input.cust[hidden]{display:none}.form .seg input.cust::placeholder{color:var(--cur-muted)}
.seg.oth .lastopt,.seg input.cr:checked+label{display:none}
.seg.many{gap:3px}.seg.many label{white-space:nowrap;font-size:.86em;padding:0 2px}.seg.many .lastopt{font-size:.8em;letter-spacing:-.02em}.seg.many input:checked+label::before{content:none}.seg.many input:checked+label{box-shadow:inset 0 -5px 0 var(--cur-accent)}
.sheet .fld.wide{grid-column:1/-1}
.recallrow{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:6px;min-width:0}
.btn.recall{font-weight:600;font-size:.88em;padding:0 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;text-align:left}
.seglab{font-weight:600;font-size:.88em;color:var(--cur-muted)}.form .seglab{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.sheet{position:absolute;inset:0;z-index:2;background:var(--cur-bg);display:grid;grid-template-rows:auto minmax(0,1fr) auto;gap:8px;padding:clamp(8px,2.4cqmin,16px)}
.sheet .rows{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:6px 8px;align-content:start;min-height:0}
.sheet .fld>label,.sheet .fld>.seglab{font-size:.8em;line-height:1.15;min-height:2.3em;display:flex;align-items:flex-end}

/* Panel without a live view (the Twitch bot): a switch that shows its state, a small form, undo buttons. It may scroll up and down inside the stage when the dock is short, never sideways. */
.view.gen{display:flex;flex-direction:column;align-items:stretch;gap:clamp(8px,1.6cqh,14px);overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain}
.view.gen>*{flex:none;min-width:0}
.gen .hd .sub{display:block;white-space:normal}
.tgw{display:grid;gap:4px}
.tg{position:relative;width:100%;min-height:68px;display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"l k" "s k";align-items:center;gap:1px 14px;padding:8px 14px;text-align:left;border-radius:var(--cur-radius);border:2px solid var(--cur-line);background:var(--cur-surface);color:var(--cur-fg);cursor:pointer;touch-action:manipulation}
.tg:disabled,.tg[aria-busy=true]{opacity:1;cursor:wait}
.tg .tgl{grid-area:l;font-weight:800;font-size:1.05em;min-width:0;overflow-wrap:anywhere}
.tg .tgs{grid-area:s;font-size:.92em;color:var(--cur-muted);min-width:0;overflow-wrap:anywhere}
.tg .trk{grid-area:k;position:relative;width:60px;height:34px;border-radius:17px;background:color-mix(in srgb,var(--cur-fg) 24%,transparent);border:2px solid transparent;transition:background .15s}
.tg .knob{position:absolute;top:3px;left:3px;width:24px;height:24px;border-radius:50%;background:var(--cur-bg);transition:left .15s}
.tg.on{border-color:var(--cur-ok)}
.tg.on .trk{background:var(--cur-ok)}
.tg.on .knob{left:29px}
.tg.on .tgs{color:var(--cur-ok)}
.tg.on .tgs::before{content:"● "}
.tg.off{border-color:var(--cur-warn);background:color-mix(in srgb,var(--cur-warn) 14%,var(--cur-surface))}
.tg.off .tgs{color:var(--cur-fg);font-weight:700}
.tg.off .tgs::before{content:"";display:inline-block;width:11px;height:12px;margin-right:7px;vertical-align:-1px;border-left:4px solid currentColor;border-right:4px solid currentColor;box-sizing:border-box}
.tg:hover:not(:disabled){border-color:var(--cur-fg)}
.tg.calm.off{border-color:var(--cur-line);background:var(--cur-surface)}
.tg.calm.off .tgs{color:var(--cur-fg);font-weight:600}
.tg.calm.off .tgs::before{content:"○ ";display:inline;width:auto;height:auto;margin:0;border:0;vertical-align:baseline}
.tg.calm.on{border-color:var(--cur-accent);background:color-mix(in srgb,var(--cur-accent) 14%,var(--cur-surface))}
.tg.calm.on .trk{background:var(--cur-accent)}
.tg.calm.on .tgs{color:var(--cur-fg);font-weight:700}
.tg.calm.on .tgs::before{content:"✓ ";color:var(--cur-accent)}
.tg:focus-visible,.sgb:focus-visible,.qm:focus-visible,.mo summary:focus-visible{outline:3px solid var(--cur-focus);outline-offset:2px}
.tgc{display:grid;gap:4px;min-width:0;margin:0;padding:0;border:0}
.tgc .seglab{font-weight:600;font-size:.88em;color:var(--cur-muted)}
.sgs{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:4px}
.sgb{min-height:48px;min-width:0;display:flex;align-items:center;justify-content:center;border-radius:var(--cur-radius);border:2px solid var(--cur-line);background:var(--cur-surface);color:var(--cur-fg);font:inherit;font-weight:600;font-size:.88em;cursor:pointer;text-align:center;padding:0 2px;overflow-wrap:anywhere;touch-action:manipulation}
.sgb[aria-checked=true]{border-color:var(--cur-accent);background:color-mix(in srgb,var(--cur-accent) 22%,var(--cur-surface));font-weight:800;box-shadow:inset 0 -5px 0 var(--cur-accent)}
.sgb:disabled,.sgb[aria-busy=true]{cursor:wait}
.mo{min-width:0}.mo summary{min-height:44px;display:flex;align-items:center;cursor:pointer;font-weight:600;font-size:.88em;color:var(--cur-muted);touch-action:manipulation}
.mo[open] summary{color:var(--cur-fg)}
.mop{margin:0;color:var(--cur-fg);font-size:.88em;overflow-wrap:anywhere;padding:6px 8px;border-radius:var(--cur-radius);border:1px solid var(--cur-line);background:var(--cur-surface)}.mop[hidden]{display:none}
.tgh{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:44px}
.qm{min-width:44px;min-height:44px;border-radius:50%;border:2px solid var(--cur-line);background:var(--cur-surface);color:var(--cur-fg);font:inherit;font-weight:800;cursor:pointer;touch-action:manipulation}
.qm[aria-expanded=true]{border-color:var(--cur-accent)}.qh{display:grid;gap:4px;justify-items:end}.qh .mop{justify-self:stretch}
.mo .tgc{margin-bottom:6px}
/* A switch drawn as a card (toggle.card): the switch is the header, its choices and fold sit inside. The border and the fill carry the state; the chosen option is only "prepared" (dashed, with a check) while it is off. */
.tgcard{border-radius:var(--cur-radius);border:2px solid var(--cur-line);background:var(--cur-surface);gap:0}
.tgcard.on{border-color:var(--cur-accent);background:color-mix(in srgb,var(--cur-accent) 10%,var(--cur-surface))}
.tgcard.off:not(.calm){border-color:var(--cur-warn)}
.tgcard .tg.tg.tg{border-color:transparent;background:transparent}
.tgin{display:grid;gap:2px;min-width:0;padding:0 10px 6px}
.tgcard.off .sgb[aria-checked=true]{position:relative;border-style:dashed;border-color:var(--cur-accent);background:transparent;box-shadow:none;font-weight:700}
.tgcard.off .sgb[aria-checked=true]::after{content:"✓" / "";position:absolute;top:1px;right:5px;font-size:.8em;line-height:1;font-weight:800;color:var(--cur-accent)}
.hint,.note{margin:0;color:var(--cur-muted);font-size:.86em}
.gform{display:grid;gap:clamp(6px,1.2cqh,10px);min-width:0}
.gform .form .in::placeholder{color:var(--cur-muted);opacity:.75}
.ftl{margin:0;font-weight:800}
.grp{margin:4px 0 0;font-weight:700;font-size:.88em;color:var(--cur-muted)}
.tab.alert .tb{color:var(--cur-warn);font-weight:700}

/* Chat tab */
.chat{height:100%;display:grid;grid-template-rows:auto minmax(0,1fr) auto;gap:8px;padding:clamp(8px,2.4cqmin,16px)}
.people{display:grid;gap:4px;align-content:start;min-height:0;overflow:hidden}
.pp{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px;min-height:50px;border-bottom:1px solid var(--cur-line)}
.pp .pn{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pp .pn.m{color:var(--cur-muted);text-decoration:line-through}
.pp .tag{font-size:.8em;font-weight:700;border:1px solid currentColor;border-radius:99px;padding:0 6px;margin-left:6px;text-decoration:none;display:inline-block}
.pager .btn{min-width:48px}.pager{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:6px;text-align:center;color:var(--cur-muted);font-size:.9em}
.foot{display:grid;grid-template-columns:minmax(0,1fr);gap:6px}
@container stage (min-width:560px) and (max-height:560px){
  .chat{grid-template-columns:minmax(0,1fr) minmax(0,280px);grid-template-rows:auto minmax(0,1fr)}
  .chat>.hd{grid-column:1/-1}.chat>.people{grid-column:1;grid-row:2}.chat>.foot{grid-column:2;grid-row:2;align-self:end}
}

/* Status line */
.strip{display:flex;align-items:center;gap:8px;min-height:32px;padding:4px 10px;border-top:1px solid var(--cur-line);background:var(--cur-surface);font-size:13px}
.strip .dot{flex:none;width:10px;height:10px;border-radius:50%;background:var(--cur-muted)}
.strip.ok .dot{background:var(--cur-ok)}
.strip.bad{background:var(--cur-warn);color:var(--cur-warn-fg);font-weight:700}
.strip.bad .dot{background:var(--cur-warn-fg)}
.strip.err{background:var(--cur-danger);color:var(--cur-danger-fg);font-weight:700}
.strip .msg{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.strip .st{flex:none;color:inherit;opacity:.85;font-weight:600}

/* Low stage (a 300 x 420 dock): the labels become the placeholders, the subtitle goes, the title keeps one line. */
@container stage (max-height:440px){
  .sub{display:none}.ttl{-webkit-line-clamp:1}.prog{display:none}
  .form .fld>label{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
  .sheet>.ttl{display:none}.sheet{grid-template-rows:minmax(0,1fr) auto}
  .btn.primary{min-height:52px}
  .sheet .frow{grid-template-columns:minmax(0,1fr)}
}
@container stage (max-height:440px) and (max-width:559px){
  .view{gap:4px;padding:8px;grid-template-columns:minmax(0,1fr) auto;grid-template-rows:auto minmax(0,1fr) auto}
  .view .hd{grid-column:1;grid-row:1;align-self:center}.view .meter{grid-column:2;grid-row:1;grid-template-columns:auto auto;gap:0 10px}
  .view .bd{grid-column:1/-1;grid-row:2}.view .acts{grid-column:1/-1;grid-row:3}
  .clock{font-size:26px}.cnt b{font-size:1.25em}.cnt span{display:none}
  .bars{gap:2px}.bar{border-width:1px}.bar.lead{border-width:1px;outline:2px solid var(--cur-accent);outline-offset:-2px}
}

/* Wide stage: two columns (header and actions left, results right). */
@container stage (min-width:560px) and (max-height:560px){
  .view{grid-template-columns:minmax(0,5fr) minmax(0,7fr);grid-template-rows:auto auto minmax(0,1fr)}
  .view .hd,.view .meter{grid-column:1}.view .hd{grid-row:1}.view .meter{grid-row:2}.view .bd{grid-column:2;grid-row:1/4}.view .acts{grid-column:1;grid-row:3;align-self:end}
}
@container stage (min-width:560px) and (max-height:560px){.row[data-n="3"],.row[data-n="4"]{grid-auto-flow:row;grid-template-columns:repeat(2,minmax(0,1fr))}}
@container stage (min-width:900px){
  .view{grid-template-columns:minmax(0,5fr) minmax(0,7fr);grid-template-rows:auto auto minmax(0,1fr)}
  .view .hd,.view .meter{grid-column:1}.view .hd{grid-row:1}.view .meter{grid-row:2}.view .bd{grid-column:2;grid-row:1/4}.view .acts{grid-column:1;grid-row:3;align-self:end}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}.btn.arm::after{animation:none;transform:none;opacity:.35}}
@media (forced-colors:active){.bar.lead,.tab[aria-selected=true]{outline:2px solid CanvasText}}
`;

/** The texts the script needs. Dock and phone use the same words, except the "tap / click" ones. */
export function remoteConfig(ctx, key, { dock = false } = {}) {
  const t = (k) => ctx.t(k);
  return {
    k: key, dock, state: `/m/${ctx.instance.key}/remote-state?k=${encodeURIComponent(key)}`, press: `/m/${ctx.instance.key}/remote-press`, lang: ctx.locale,
    t: {
      done: t("remoteDone"), busy: t("remoteBusy"), explain: t("remoteExplain"), more: t("remoteMore"), rooms: t("remoteRooms"), noRooms: t("remoteNoRooms"), noOne: t("remoteNoOne"),
      person: t("person_one"), people: t("person_many"), anon: t("anon"), mutedTag: t("mutedTag"), mute: t("remoteMute"), unmute: t("remoteUnmute"), clear: t("remoteClear"), 
      connected: t("remoteConnected"), offline: t("remoteOffline"), denied: t("remoteDenied"), connecting: t("remoteConnecting"),
      e_net: t("remoteErrNet"), e_gone: t("remoteErrGone"), e_failed: t("remoteErrFailed"), e_invalid: t("remoteErrInvalid"), e_limit: t("remoteErrLimit"),
      panic: t("remotePanic"), panicLoss: t("remotePanicConfirm"),
      tabPoll: t("dockTabPoll"), tabDraw: t("dockTabDraw"), tabChat: t("dockTabChat"),
      confirm: t("dockConfirm"), undo: t("dockUndo"), armed: t("dockArmed"), retry: t("dockRetry"), notSent: t("dockNotSent"), back: t("dockBack"), done2: t("dockDone"), 
      prev: t("dockPrev"), next: t("dockNext"), pageOf: t("dockPageOf"), live: t("dockStateLive"), finished: t("dockStateFinished"), leading: t("dockLeading"), keys: t("dockKeys"), 
      clearLoss: t("dockClearLoss"), 
    },
  };
}

export function remoteHtml(ctx, key, REMOTE_JS, { dock = false, nonce = "", scheme = null } = {}) {
  const json = JSON.stringify(remoteConfig(ctx, key, { dock })).replace(/</g, "\\u003c");
  // The look of the administration: the dock is dark (OBS is dark) unless asked otherwise; the phone follows the device.
  let theme = null;
  try { theme = typeof ctx.api?.adminTheme === "function" ? ctx.api.adminTheme({ scheme: scheme ?? (dock ? "dark" : "auto") }) : null; } catch { theme = null; }
  const tokens = typeof theme?.css === "string" ? theme.css.replace(/[<>]/g, "") : "";
  const css = `${FALLBACK_TOKENS}${tokens}\n${DOCK_CSS}`;
  const n = nonce ? ` nonce="${L.esc(nonce)}"` : "";
  return `<!doctype html><html lang="${L.esc(ctx.locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><meta name="color-scheme" content="light dark"><title>${L.esc(ctx.t("remoteTitle"))}</title><link rel="icon" href="data:,"><style${n}>${css}</style></head><body class="${dock ? "dk dock" : "dk"}">` +
    `<div class="app" id="app"><header class="top" id="top"><div class="tabs" id="tabs" role="tablist" aria-label="${L.esc(ctx.t("remoteTabs"))}"></div><button type="button" class="panic" id="panic" aria-label="${L.esc(ctx.t("remotePanic"))}"><span class="gl" aria-hidden="true">■</span><span>${L.esc(ctx.t("dockPanicShort"))}</span></button></header>` +
    `<main class="stage" id="stage" aria-busy="true"><div class="view"><p class="empty">${L.esc(ctx.t("remoteLoading"))}</p></div></main>` +
    `<footer class="strip" id="strip" role="status" aria-live="polite"><span class="dot" aria-hidden="true"></span><span class="msg" id="msg">${L.esc(ctx.t("remoteConnecting"))}</span><span class="st" id="st"></span></footer></div>` +
    `<p class="sr" id="sr" role="status" aria-live="polite"></p>` +
    `<noscript><p class="empty">${L.esc(ctx.t("needScript"))}</p></noscript><script${n}>window.__AR=${json};${REMOTE_JS}</script></body></html>`;
}

const SECURE = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow", "x-content-type-options": "nosniff" };

/** La réponse complète. Une politique de sécurité n'autorise que le script et le style de la page elle-même, et ne laisse contacter que le site. */
export function remoteResponse(ctx, key, REMOTE_JS, { dock = false, scheme = null } = {}) {
  const nonce = randomBytes(16).toString("base64");
  return new Response(remoteHtml(ctx, key, REMOTE_JS, { dock, nonce, scheme }), { headers: { ...SECURE, "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'` } });
}
