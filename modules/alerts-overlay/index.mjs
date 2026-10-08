// Overlay alertes (OBS) — module communautaire de Curiosa. Porté de l'ancien site.
//
// Flux en direct (SSE) en mémoire : un seul processus serveur, un EventEmitter suffit (pas de Redis pour ce volume).
// Quelque chose POUSSE une alerte : POST /m/<clé>/push avec `Authorization: Bearer <jeton>` et { kind, message, username? }.
// Le module ne connaît ni Twitch ni aucun outil : il affiche ce qu'on lui envoie.
import { EventEmitter } from "node:events";
import { timingSafeEqual } from "node:crypto";

const bus = (globalThis.__curiosaAlertsBus ??= Object.assign(new EventEmitter(), {}));
bus.setMaxListeners(100);

const KINDS = ["follow", "sub", "raid", "test", "alert"];
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
const color = (v, def) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : def);

export const emit = (key, event) => bus.emit(key, event);
export const listeners = (key) => bus.listenerCount(key);

/** Compare sans fuite de temps. */
const sameToken = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

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

  overlay(ctx) {
    const duration = Math.min(60, Math.max(2, Number(ctx.setting("durationSeconds")) || 6));
    const cfg = {
      eventsUrl: `/m/${ctx.instance.key}/events`,
      duration,
      neon: ctx.setting("visual") !== "plain",
      labels: Object.fromEntries(KINDS.map((k) => [k, ctx.t(`kind_${k}`)])),
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
        @keyframes alPop{0%{opacity:0;transform:scale(.85)}10%{opacity:1;transform:scale(1)}90%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(.95)}}`,
      script: `(function(){var c=${json},stage=document.getElementById("al-stage"),timer;
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
    ];
  },

  adminActions: {
    async test(ctx) {
      emit(ctx.instance.key, { kind: "test", message: ctx.t("testMessage") });
      return { ok: ctx.t("okTest") };
    },
  },
};
