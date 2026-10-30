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

export async function remoteState(ctx, now = Date.now()) {
  const [panels, rooms] = await Promise.all([collectPanels(ctx), roomsView(ctx, now)]);
  return { ok: true, now, panels, rooms };
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
  return out;
}

/** Les gestes de la télécommande elle-même : sourdine et salle à vider. */
async function pressOwn(ctx, action, values) {
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
  return no("invalid");
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

/* ───────────── La page de la télécommande ───────────── */
// Une seule page, deux présentations : le téléphone (grands boutons, claire ou sombre selon le thème du site) et le DOCK pour OBS (étroit, 300 px, sombre, boutons de 40 px, souris et clavier).
// C'est la MÊME adresse secrète : `…/remote?k=<clé>` pour le téléphone, `…/remote?k=<clé>&dock=1` pour le dock. Même script, mêmes routes `remote-state` et `remote-press`, mêmes droits : seule la mise en page change.

const color = (v, d) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : d);
const fontOf = (v) => (typeof v === "string" && /^[\w\s,"'.-]{1,120}$/.test(v) ? v : "system-ui,sans-serif");

/** Le dock est demandé par `&dock=1` (rien d'autre : un paramètre inconnu donne la télécommande du téléphone). */
export const wantsDock = (url) => new URL(url).searchParams.get("dock") === "1";

const BASE_CSS = `*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.45 var(--font);padding-bottom:env(safe-area-inset-bottom)}
.ar-top{position:sticky;top:0;z-index:2;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 16px;background:var(--surface);border-bottom:1px solid var(--line)}
.ar-top h1{margin:0;font-size:1.15rem}.ar-dot{font-size:.9rem;color:var(--muted)}.ar-dot::before{content:"";display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--muted);margin-right:8px}.ar-dot.ok::before{background:var(--ok)}.ar-dot.bad::before{background:var(--danger)}
.ar-main{max-width:640px;margin:0 auto;padding:16px;display:grid;gap:16px}
.ar-card{background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:16px;display:grid;gap:12px}
.ar-h2{margin:0;font-size:1.25rem}.ar-h3{margin:4px 0 0;font-size:1.05rem}.ar-muted{margin:0;color:var(--muted)}
.ar-state{margin:0;font-weight:600}.ar-state.live{color:var(--ok)}.ar-clock{font-variant-numeric:tabular-nums;font-size:1.6rem;margin-left:6px;color:var(--fg)}
.ar-row{display:grid;gap:10px;grid-template-columns:1fr}@media (min-width:520px){.ar-row{grid-template-columns:1fr 1fr}}
.ar-btn{min-height:76px;width:100%;border-radius:16px;border:2px solid var(--line);background:var(--bg);color:var(--fg);font:inherit;font-size:1.2rem;font-weight:700;padding:12px 16px;cursor:pointer;touch-action:manipulation}
.ar-btn.primary{background:var(--accent);color:var(--accent-fg);border-color:transparent}.ar-btn.danger{background:var(--danger);color:var(--danger-fg);border-color:transparent}
.ar-btn.armed{outline:4px solid var(--fg);outline-offset:2px}.ar-btn:disabled{opacity:.5;cursor:not-allowed}.ar-btn[aria-busy=true]{cursor:wait}
.ar-btn:focus-visible,.ar-mini:focus-visible,.ar-in:focus-visible,summary:focus-visible{outline:3px solid var(--fg);outline-offset:2px}
.ar-form{display:grid;gap:12px;border-top:1px solid var(--line);padding-top:12px}.ar-field{display:grid;gap:4px}.ar-field label{font-weight:600}
.ar-in{min-height:52px;width:100%;border-radius:12px;border:2px solid var(--line);background:var(--bg);color:var(--fg);font:inherit;padding:8px 12px}.ar-in[aria-invalid=true]{border-color:var(--danger)}
.ar-err{margin:0;color:var(--danger);font-weight:600}
.ar-room summary{min-height:48px;display:flex;align-items:center;cursor:pointer;font-weight:600}.ar-room{border-top:1px solid var(--line);padding-top:6px}
.ar-person{display:flex;justify-content:space-between;align-items:center;gap:12px;min-height:52px;border-bottom:1px solid var(--line)}.ar-name{overflow-wrap:anywhere}.ar-name.muted{color:var(--muted);text-decoration:line-through}
.ar-mini{min-height:44px;min-width:96px;border-radius:12px;border:2px solid var(--line);background:var(--bg);color:var(--fg);font:inherit;font-weight:600;cursor:pointer}
.ar-toast{position:sticky;bottom:12px;margin:0 16px;padding:14px 16px;border-radius:14px;background:var(--fg);color:var(--bg);font-weight:700;text-align:center}.ar-toast.bad{background:var(--danger);color:var(--danger-fg)}
.ar-foot{text-align:center;color:var(--muted);font-size:.9rem;padding:0 16px 24px}[hidden]{display:none!important}`;

// Le dock : un panneau OBS de 300 px de large (la hauteur est libre : la page défile), toujours sombre, texte de 14 px, boutons de 40 px au moins, bien visible au clavier, survol à la souris.
const DOCK_CSS = `.ar-dock{font-size:14px;line-height:1.4;padding-bottom:0;overflow-wrap:anywhere}
.ar-dock .ar-top{padding:8px 10px;gap:8px}.ar-dock .ar-top h1{font-size:1rem}.ar-dock .ar-dot{font-size:.8rem;white-space:nowrap}.ar-dock .ar-dot::before{width:8px;height:8px;margin-right:6px}
.ar-dock .ar-main{max-width:560px;padding:10px;gap:10px}
.ar-dock .ar-card{padding:10px;border-radius:10px;gap:8px;min-width:0}
.ar-dock .ar-h2{font-size:1rem}.ar-dock .ar-h3{font-size:.95rem}.ar-dock .ar-state{font-size:.95rem}.ar-dock .ar-clock{font-size:1.1rem;margin-left:4px}
.ar-dock .ar-row{grid-template-columns:1fr;gap:6px}
.ar-dock .ar-btn{min-height:40px;border-radius:8px;border-width:1px;font-size:.95rem;font-weight:600;padding:6px 10px;touch-action:auto}
.ar-dock .ar-btn:hover:not(:disabled),.ar-dock .ar-mini:hover{filter:brightness(1.2)}
.ar-dock .ar-btn.armed{outline-width:3px}
.ar-dock .ar-form{gap:8px;padding-top:8px}.ar-dock .ar-field label{font-size:.9rem}
.ar-dock .ar-in{min-height:40px;border-radius:8px;border-width:1px;padding:6px 10px;font-size:.95rem}
.ar-dock .ar-room summary{min-height:40px}
.ar-dock .ar-person{min-height:44px;gap:8px}.ar-dock .ar-name{min-width:0}
.ar-dock .ar-room>.ar-btn{margin-top:8px}
.ar-dock .ar-mini{min-height:40px;min-width:76px;border-radius:8px;border-width:1px;padding:0 8px}
.ar-dock .ar-toast{bottom:8px;margin:0 10px;padding:8px 10px;border-radius:8px}
.ar-dock .ar-foot{font-size:.8rem;padding:0 10px 12px}
@media (prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}}`;

/** Les textes dont le script a besoin : ceux du dock disent « cliquez » (souris et clavier), ceux du téléphone « touchez ». */
export function remoteConfig(ctx, key, { dock = false } = {}) {
  const t = (k) => ctx.t(k);
  return {
    k: key, dock, state: `/m/${ctx.instance.key}/remote-state?k=${encodeURIComponent(key)}`, press: `/m/${ctx.instance.key}/remote-press`, lang: ctx.locale,
    t: {
      busy: t("remoteBusy"), done: t("remoteDone"), again: t(dock ? "dockAgain" : "remoteAgain"), nopanels: t("remoteNoPanels"), rooms: t("remoteRooms"), noRooms: t("remoteNoRooms"), noOne: t("remoteNoOne"),
      person: t("person_one"), people: t("person_many"), anon: t("anon"), mutedTag: t("mutedTag"), mute: t("remoteMute"), unmute: t("remoteUnmute"), clear: t("remoteClear"), clearConfirm: t("remoteClearConfirm"),
      connected: t("remoteConnected"), offline: t("remoteOffline"), denied: t("remoteDenied"),
      e_net: t("remoteErrNet"), e_gone: t("remoteErrGone"), e_failed: t("remoteErrFailed"), e_invalid: t("remoteErrInvalid"), e_limit: t("remoteErrLimit"),
    },
  };
}

export function remoteHtml(ctx, key, REMOTE_JS, { dock = false, nonce = "" } = {}) {
  const th = ctx.theme ?? {};
  const json = JSON.stringify(remoteConfig(ctx, key, { dock })).replace(/</g, "\\u003c");
  const accent = color(th.accent, "#e8a23b"), accentFg = color(th.accentFg, "#111111"), danger = color(th.danger, "#ff6b6b"), dangerFg = color(th.dangerFg, "#111111"), ok = color(th.success, "#4ade80");
  // le dock est toujours sombre (il vit dans le décor d'OBS) ; seules les couleurs d'accent suivent le thème du site
  const c = dock
    ? { bg: "#0e0e10", fg: "#efeff1", surface: "#18181b", line: "#3a3a40", muted: "#b4b4be", font: "system-ui,'Segoe UI',Roboto,sans-serif" }
    : { bg: color(th.bg, "#121214"), fg: color(th.fg, "#f4f4f5"), surface: color(th.surface, "#1b1b1d"), line: color(th.line, "#2e2e30"), muted: color(th.muted, "#a1a1a3"), font: fontOf(th.font) };
  const css = `:root{${dock ? "color-scheme:dark;" : ""}--bg:${c.bg};--fg:${c.fg};--surface:${c.surface};--line:${c.line};--accent:${accent};--accent-fg:${accentFg};--muted:${c.muted};--danger:${danger};--danger-fg:${dangerFg};--ok:${ok};--font:${c.font}}\n${BASE_CSS}${dock ? `\n${DOCK_CSS}` : ""}`;
  const n = nonce ? ` nonce="${L.esc(nonce)}"` : "";
  return `<!doctype html><html lang="${L.esc(ctx.locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${L.esc(ctx.t("remoteTitle"))}</title><link rel="icon" href="data:,"><style${n}>${css}</style></head><body${dock ? ' class="ar-dock"' : ""}>` +
    `<header class="ar-top"><h1>${L.esc(ctx.t("remoteTitle"))}</h1><span id="ar-live" class="ar-dot" role="status">${L.esc(ctx.t("remoteConnecting"))}</span></header>` +
    `<main class="ar-main" id="ar-root" aria-live="polite"><section class="ar-card"><p class="ar-muted">${L.esc(ctx.t("remoteLoading"))}</p></section></main>` +
    `<p id="ar-toast" class="ar-toast" role="status" hidden></p><p class="ar-foot">${L.esc(ctx.t("remoteFoot"))}</p>` +
    `<noscript><p class="ar-foot">${L.esc(ctx.t("needScript"))}</p></noscript><script${n}>window.__AR=${json};${REMOTE_JS}</script></body></html>`;
}

const SECURE = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow", "x-content-type-options": "nosniff" };

/** La réponse complète. Une politique de sécurité n'autorise que le script et le style de la page elle-même, et ne laisse contacter que le site. */
export function remoteResponse(ctx, key, REMOTE_JS, { dock = false } = {}) {
  const nonce = randomBytes(16).toString("base64");
  return new Response(remoteHtml(ctx, key, REMOTE_JS, { dock, nonce }), { headers: { ...SECURE, "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'` } });
}
