// Overlay alertes (OBS) — module communautaire de Curiosa. Porté de l'ancien site.
//
// Flux en direct (SSE) en mémoire : un seul processus serveur, un EventEmitter suffit (pas de Redis pour ce volume).
// Quelque chose POUSSE une alerte : POST /m/<clé>/push avec `Authorization: Bearer <jeton>` et { kind, message, username? }.
// Le module ne connaît ni Twitch ni aucun outil : il affiche ce qu'on lui envoie.
//
// Deuxième source, FACULTATIVE (1.1.0) : le sujet `live.event`, que « Actions du live YouTube » publie (Super Chat, Super Sticker, adhésions). Le sujet se lit à la demande, jamais en arrière-plan :
// la page de l'overlay (ouverte dans OBS) vient chercher les nouveautés toutes les 5 secondes (route `pull`, au plus une lecture toutes les 2 secondes par overlay) ; sans page ouverte, rien
// ne tourne. Sans « Actions du live YouTube » sur le site, la page ne demande rien : l'overlay se comporte exactement comme avant.
import { EventEmitter } from "node:events";
import { timingSafeEqual } from "node:crypto";

const bus = (globalThis.__curiosaAlertsBus ??= Object.assign(new EventEmitter(), {}));
bus.setMaxListeners(100);

const KINDS = ["follow", "sub", "raid", "test", "alert"];
/** Les alertes venues du sujet `live.event` (leurs titres ne sont pas acceptés par `push`). */
const LIVE_KINDS = ["superchat", "supersticker", "member", "gift"];
/** Modules dont la présence active la lecture du sujet `live.event` par la page de l'overlay. */
const LIVE_PROVIDERS = ["youtube-live-actions"];
export const LIMITS = { queue: 50, seen: 400, maxAgeMs: 120_000, throttleMs: 2000, name: 40, message: 200, detail: 140, perPull: 20 };
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
/** Le texte venu d'ailleurs (sujet `live.event`) : normalisé, sans caractère de contrôle ni de sens d'écriture, espaces réduits, borné. */
const cleanText = (v, max) => String(v ?? "").normalize("NFKC").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const color = (v, def) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : def);

export const emit = (key, event) => bus.emit(key, event);

/** Un montant lisible : « 5,00 € » (monnaie et langue du site) ; une devise inconnue du navigateur retombe sur « 5 XYZ ». */
export function formatAmount(amount, currency, locale) {
  if (!Number.isFinite(amount) || !/^[A-Z]{3}$/.test(String(currency ?? ""))) return "";
  try { return new Intl.NumberFormat(locale || "en", { style: "currency", currency }).format(amount); } catch { return `${amount} ${currency}`; }
}

/**
 * Un élément du sujet `live.event` → l'alerte à afficher, ou null. TOUT est du texte brut (l'overlay l'insère avec textContent) et borné ici aussi.
 * `withText` : afficher le message du spectateur (réglage, éteint par défaut). Pas de montant sans devise : un don sans montant lisible est écarté.
 */
export function liveAlert(item, { withText = false, locale = "en" } = {}) {
  if (!item || typeof item !== "object" || !LIVE_KINDS.includes(item.kind)) return null;
  const who = cleanText(item.who, LIMITS.name) || "?";
  let message = who, detail = "";
  if (item.kind === "superchat" || item.kind === "supersticker") {
    const amount = typeof item.amount === "number" ? formatAmount(item.amount, item.currency, locale) : "";
    if (!amount) return null;
    message = `${who} · ${amount}`;
    if (item.kind === "superchat" && withText) detail = cleanText(item.text, LIMITS.detail);
  } else if (item.kind === "gift") {
    const n = item.count;
    if (!Number.isInteger(n) || n < 1 || n > 10_000) return null;
    message = `${who} · ×${n}`;
  }
  return { kind: item.kind, message: message.slice(0, LIMITS.message), ...(detail ? { detail } : {}), queued: true };
}

const seenOf = (globalThis.__curiosaAlertsSeen ??= new Map());   // clé d'overlay → { ids: Set, last }
/** Lit le sujet et envoie à l'overlay ce qui est NOUVEAU (jamais deux fois la même alerte, rien de plus vieux que 2 minutes). Rend le nombre d'alertes envoyées. Ne lève jamais. */
export async function pullLive(ctx, now = Date.now()) {
  const key = ctx.instance.key;
  const st = seenOf.get(key) ?? { ids: new Set(), last: 0 };
  seenOf.delete(key); seenOf.set(key, st);
  while (seenOf.size > 50) seenOf.delete(seenOf.keys().next().value);
  if (now - st.last < LIMITS.throttleMs) return { sent: 0, throttled: true };
  st.last = now;
  let items = [];
  try { const r = await ctx.api.topics.collect("live.event", { limit: LIMITS.queue }); items = Array.isArray(r) ? r.slice(0, LIMITS.queue) : []; } catch { items = []; }
  const withText = ctx.setting("youtubeText") === true;
  const fresh = [];
  for (const it of items) {
    const id = typeof it?.id === "string" && it.id.length > 0 && it.id.length <= 80 ? `${it.source?.instance ?? ""}|${it.id}` : null;
    if (!id || st.ids.has(id)) continue;
    st.ids.add(id);
    const at = Date.parse(it.at ?? "");
    if (!Number.isFinite(at) || now - at > LIMITS.maxAgeMs || at - now > 60_000) continue;   // trop ancienne (OBS rouvert, serveur redémarré) : notée comme vue, jamais affichée
    const alert = liveAlert(it, { withText, locale: ctx.locale });
    if (alert) fresh.push({ at, alert });
  }
  while (st.ids.size > LIMITS.seen) st.ids.delete(st.ids.values().next().value);
  fresh.sort((a, b) => a.at - b.at);
  const out = fresh.slice(-LIMITS.perPull);
  for (const f of out) emit(key, f.alert);
  return { sent: out.length };
}
export const listeners = (key) => bus.listenerCount(key);

/** Compare sans fuite de temps. */
const sameToken = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/** Les alertes YouTube dans l'administration : si « Actions du live YouTube » est là, comment ça marche et un essai ; sinon, une phrase pour savoir que ça existe. */
async function youtubeBlocks(ctx) {
  let here = false;
  try { here = (await Promise.all(LIVE_PROVIDERS.map((m) => ctx.api.instances.list({ module: m })))).some((l) => Array.isArray(l) && l.length > 0); } catch { here = false; }
  if (!here) return [{ type: "markdown", text: ctx.t("ytAbsent") }];
  return [
    { type: "heading", text: ctx.t("ytTitle") },
    { type: "markdown", text: ctx.t("ytHelp") },
    { type: "adminForm", action: "testYoutube", title: ctx.t("ytTestTitle"), submitLabel: ctx.t("testSubmit"), fields: [] },
  ];
}

export default {
  routes: {
    // Flux SSE lu par la page de l'overlay.
    events(request, ctx) {
      const key = ctx.instance.key;
      const enc = new TextEncoder();
      let off = () => {}, ping;
      const stream = new ReadableStream({
        start(controller) {
          const send = (s) => { try { controller.enqueue(enc.encode(s)); } catch { /* flux fermé */ } };
          send(":ok\n\n");                       // force certains proxies à ouvrir le flux tout de suite
          const on = (e) => send(`data: ${JSON.stringify(e)}\n\n`);
          bus.on(key, on); off = () => bus.off(key, on);
          ping = setInterval(() => send(":ping\n\n"), 25_000);
          request.signal.addEventListener("abort", () => { clearInterval(ping); off(); try { controller.close(); } catch { /* déjà fermé */ } });
        },
        cancel() { clearInterval(ping); off(); },
      });
      return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
    },

    // La page de l'overlay vient chercher les alertes du sujet `live.event` (voir plus haut). Rien d'autre qu'un compte n'est répondu.
    async pull(request, ctx) {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
      const r = await pullLive(ctx);
      return Response.json({ ok: true, sent: r.sent }, { headers: { "Cache-Control": "no-store" } });
    },

    // Pousser une alerte : jeton obligatoire, corps JSON borné, texte seulement.
    async push(request, ctx) {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
      const token = String(ctx.setting("pushToken") ?? "").trim();
      const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
      if (!token || !given || !sameToken(token, given)) return new Response("Unauthorized", { status: 401 });
      const raw = await request.text();
      if (raw.length > 4000) return new Response("Too large", { status: 413 });
      let body; try { body = JSON.parse(raw); } catch { return new Response("Bad request", { status: 400 }); }
      const message = clean(body?.message, 200);
      if (!message) return new Response("Bad request", { status: 400 });
      const kind = KINDS.includes(body?.kind) ? body.kind : "alert";
      const username = clean(body?.username, 60);
      emit(ctx.instance.key, { kind, message, ...(username ? { username } : {}) });
      return Response.json({ ok: true, listeners: listeners(ctx.instance.key) });
    },
  },

  async overlay(ctx) {
    // La page ne va chercher les alertes YouTube que si « Actions du live YouTube » est installé sur le site.
    let pull = false;
    try { pull = (await Promise.all(LIVE_PROVIDERS.map((m) => ctx.api.instances.list({ module: m })))).some((l) => Array.isArray(l) && l.length > 0); } catch { pull = false; }
    const duration = Math.min(60, Math.max(2, Number(ctx.setting("durationSeconds")) || 6));
    const cfg = {
      eventsUrl: `/m/${ctx.instance.key}/events`,
      duration,
      neon: ctx.setting("visual") !== "plain",
      labels: Object.fromEntries((pull ? [...KINDS, ...LIVE_KINDS] : KINDS).map((k) => [k, ctx.t(`kind_${k}`)])),
      ...(pull ? { pullUrl: `/m/${ctx.instance.key}/pull`, pullMs: 5000, queueMax: LIMITS.queue } : {}),
    };
    const accent = color(ctx.setting("accentColor"), ctx.theme.accent);
    const t = ctx.theme;
    const json = JSON.stringify(cfg).replace(/</g, "\\u003c");
    return {
      title: ctx.instance.name,
      html: `<div id="al-stage" style="--al-accent:${accent};--al-bg:${t.surface};--al-fg:${t.fg}"></div>`,
      css: `
        html,body{margin:0;height:100%;background:transparent;overflow:hidden;font-family:system-ui,"Segoe UI",sans-serif}
        #al-stage{position:fixed;inset:0;display:flex;align-items:center;justify-content:center}
        .al-card{display:flex;flex-direction:column;align-items:center;gap:.5rem;padding:2rem 3rem;border-radius:1.5rem;border:1px solid color-mix(in srgb,var(--al-accent) 40%,transparent);background:color-mix(in srgb,var(--al-bg) 90%,transparent);backdrop-filter:blur(6px);text-align:center;animation:alPop var(--al-dur) ease-in-out forwards}
        .al-card.neon{box-shadow:0 0 28px color-mix(in srgb,var(--al-accent) 45%,transparent)}
        .al-kind{font-size:1.6rem;font-weight:700;color:var(--al-accent)}
        .al-card.neon .al-kind{text-shadow:0 0 12px var(--al-accent)}
        .al-msg{font-size:1.15rem;color:var(--al-fg)}
${pull ? `        .al-detail{font-size:1rem;color:var(--al-fg);opacity:.85;max-width:32rem;overflow-wrap:anywhere}
` : ""}        @keyframes alPop{0%{opacity:0;transform:scale(.85)}10%{opacity:1;transform:scale(1)}90%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(.95)}}`,
      // Sans « Actions du live YouTube » : le script d'avant, à l'identique. Avec : une file (50 au plus, la plus vieille part la première) pour que plusieurs dons de suite
      // s'affichent l'un après l'autre au lieu de se remplacer ; les alertes poussées (push) remplacent toujours la carte à l'écran, comme avant.
      script: pull ? `(function(){var c=${json},stage=document.getElementById("al-stage"),timer,q=[],busy=false;
        stage.style.setProperty("--al-dur",c.duration+"s");
        function draw(e){var card=document.createElement("div");card.className="al-card"+(c.neon?" neon":"");
          var k=document.createElement("div");k.className="al-kind";k.textContent=c.labels[e.kind]||c.labels.alert;
          var m=document.createElement("div");m.className="al-msg";m.textContent=e.message;card.append(k,m);
          if(e.detail){var d=document.createElement("div");d.className="al-detail";d.textContent=e.detail;card.append(d)}
          stage.replaceChildren(card);clearTimeout(timer);timer=setTimeout(done,c.duration*1000)}
        function done(){stage.replaceChildren();busy=false;next()}
        function next(){if(busy)return;var e=q.shift();if(e){busy=true;draw(e)}}
        function show(e){if(e.queued){if(q.length>=c.queueMax)q.shift();q.push(e);next()}else{busy=true;draw(e)}}
        var es=new EventSource(c.eventsUrl);es.onmessage=function(ev){try{show(JSON.parse(ev.data))}catch(e){}};
        var gap=c.pullMs;function pull(){fetch(c.pullUrl,{cache:"no-store"}).then(function(r){gap=r.ok?c.pullMs:30000},function(){gap=30000}).then(function(){setTimeout(pull,gap)})}
        setTimeout(pull,1000)})();` : `(function(){var c=${json},stage=document.getElementById("al-stage"),timer;
        stage.style.setProperty("--al-dur",c.duration+"s");
        function show(e){var card=document.createElement("div");card.className="al-card"+(c.neon?" neon":"");
          var k=document.createElement("div");k.className="al-kind";k.textContent=c.labels[e.kind]||c.labels.alert;
          var m=document.createElement("div");m.className="al-msg";m.textContent=e.message;card.append(k,m);
          stage.replaceChildren(card);clearTimeout(timer);timer=setTimeout(function(){stage.replaceChildren()},c.duration*1000)}
        var es=new EventSource(c.eventsUrl);es.onmessage=function(ev){try{show(JSON.parse(ev.data))}catch(e){}}})();`,
    };
  },

  async adminPanel(ctx) {
    const base = `${ctx.api.siteUrl}/m/${ctx.instance.key}/push`;
    const hasToken = !!String(ctx.setting("pushToken") ?? "").trim();
    return [
      { type: "heading", text: ctx.t("adminTitle") },
      { type: "markdown", text: ctx.t("adminHelp") },
      { type: "copy", label: "POST", text: `curl -X POST ${base} -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d '{"kind":"follow","message":"Alice","username":"alice"}'` },
      ...(hasToken ? [] : [{ type: "markdown", text: ctx.t("noToken") }]),
      { type: "adminForm", action: "test", title: ctx.t("testTitle"), submitLabel: ctx.t("testSubmit"), fields: [] },
      ...(await youtubeBlocks(ctx)),
    ];
  },

  adminActions: {
    // Un faux Super Chat, mis en forme comme un vrai (montant dans la monnaie du site, texte seulement si le réglage est coché).
    async testYoutube(ctx) {
      const alert = liveAlert({ kind: "superchat", who: ctx.t("ytTestWho"), amount: 5, currency: ctx.locale === "fr" ? "EUR" : "USD", text: ctx.t("ytTestText") }, { withText: ctx.setting("youtubeText") === true, locale: ctx.locale });
      if (!alert) return { error: ctx.t("ytTestError") };
      emit(ctx.instance.key, alert);
      return { ok: ctx.t("okTest") };
    },
    async test(ctx) {
      emit(ctx.instance.key, { kind: "test", message: ctx.t("testMessage") });
      return { ok: ctx.t("okTest") };
    },
  },
};
