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
// Neighbour file: dynamic, versioned import (docs/HOT-UPDATE.md).
const v = new URL(import.meta.url).search;
const { ovTransition, transitionConfig } = await import(new URL(`./transition.mjs${v}`, import.meta.url).href);

const bus = (globalThis.__curiosaAlertsBus ??= Object.assign(new EventEmitter(), {}));
bus.setMaxListeners(100);

const tw = await import(new URL(`./twitch.mjs${v}`, import.meta.url).href);
const adminTw = await import(new URL(`./twitch-admin.mjs${v}`, import.meta.url).href);
/** Sounds: small synthesised notes (the page makes them, nothing is loaded). [frequency Hz, start s, length s]. Played only when the person switched sounds on. */
const SOUND_SCRIPT = `
        var ac=null,SND={chime:[[880,0,.18],[1320,.12,.32]],bell:[[1046,0,.7]],pop:[[420,0,.09]],fanfare:[[523,0,.14],[659,.14,.14],[784,.28,.14],[1046,.42,.42]]};
        function beep(name){try{var A=window.AudioContext||window.webkitAudioContext;if(!A||!SND[name]||!c.volume)return;ac=ac||new A();var t=ac.currentTime,v=c.volume/100*.25;SND[name].forEach(function(n){var o=ac.createOscillator(),g=ac.createGain();o.type=name==="pop"?"square":"sine";o.frequency.value=n[0];g.gain.setValueAtTime(.0001,t+n[1]);g.gain.exponentialRampToValueAtTime(v,t+n[1]+.02);g.gain.exponentialRampToValueAtTime(.0001,t+n[1]+n[2]);o.connect(g);g.connect(ac.destination);o.start(t+n[1]);o.stop(t+n[1]+n[2]+.05)})}catch(e){}}`;
/** The picture of a type, only an address of the site itself (checked here as well as on the server); the way of entering is remembered on the card for the transition. */
const UPLOAD = (ext) => `/^\\/uploads\\/[0-9a-f-]{36}\\.(${ext})$/`;
/** What the page draws for an alert of Twitch activity, in pieces. The way of entering is remembered on the card; a GIF or a video of the site stands alone; otherwise the picture (if any) goes above the text. */
const ANIM_SCRIPT = (fx) => `${fx ? "card._anim=e.anim||\"\";" : ""}shownCard=card;`;
const MEDIA_SCRIPT = (ov) => `var mc=null;
          if(e.video&&${UPLOAD("mp4|webm")}.test(e.video)){mc=document.createElement("video");mc.src=e.video;mc.muted=!e.videoSound;mc.autoplay=true;mc.playsInline=true;mc.setAttribute("aria-label",e.message);if(mc.play){var pp=mc.play();if(pp&&pp.catch)pp.catch(function(){mc.muted=true;try{mc.play()}catch(x){}})}}
          else if(e.image&&${UPLOAD("png|jpg|webp|gif")}.test(e.image)){mc=document.createElement("img");mc.src=e.image;mc.alt=e.message}
          if(mc){${ov ? 'mc.setAttribute("data-ov-part","media");card.setAttribute("data-ov-media","1");' : 'mc.className="al-media";card.className+=" al-media-card";'}card.append(mc)}`;
/** A sound file of the site, played once per alert at the volume of the sounds; it stops with the card (skip, next alert). Same condition as the synthesised sounds. */
const AUDIO_SCRIPT = `
        var fileSnd=null;
        function stopFile(){try{if(fileSnd){fileSnd.pause();fileSnd=null}}catch(x){}}
        function playFile(e){stopFile();if(!e.audio||!c.volume||!${UPLOAD("mp3|ogg|wav|m4a|aac")}.test(e.audio))return;try{var a=new Audio(e.audio);a.volume=c.volume/100;fileSnd=a;var p=a.play();if(p&&p.catch)p.catch(function(){})}catch(x){}}`;
const PICTURE_SCRIPT = (ov) => `if(e.image&&${UPLOAD("png|jpg|webp|gif")}.test(e.image)){var im=document.createElement("img");${ov ? 'im.setAttribute("data-ov-part","image");' : 'im.className="al-img";'}im.src=e.image;im.alt="";card.append(im)}`;
/**
 * The voice: the browser's own speech synthesis (Web Speech API), no service, no key. What is read comes from the server (`e.say`, already moderated); whether it is read, and how, comes from
 * the state the page polls (`ctl`): on, muted, voice, language, rate, pitch, volume, and two counters ("stop speaking", "skip this alert"). Voices belong to the system: the page tells the
 * server which it sees (route tts-report) so the administration can offer them; with no voice or no support nothing is read and nothing breaks.
 */
const VOICE_SCRIPT = `
        var shownCard=null,ctlv={stop:null,skip:null,tts:{on:false,muted:false}},syn=window.speechSynthesis,canSay=!!(syn&&typeof SpeechSynthesisUtterance!=="undefined");
        function hush(){try{if(canSay)syn.cancel()}catch(x){}}
        function skipNow(){if(!busy)return;if(typeof stopFile==="function")stopFile();clearTimeout(timer);done()}
        function applyCtl(x){if(!x)return;var first=ctlv.stop===null;if(!first){if(x.stop!==ctlv.stop)hush();if(x.skip!==ctlv.skip)skipNow()}ctlv.stop=x.stop;ctlv.skip=x.skip;ctlv.tts=x.tts||ctlv.tts;if(!ctlv.tts.on||ctlv.tts.muted)hush()}
        function speak(e){var t=ctlv.tts;if(!e.say||!canSay||!t||!t.on||t.muted)return;try{var u=new SpeechSynthesisUtterance(e.say),vs=syn.getVoices(),v=null,i,want=(t.lang||c.lang||"").toLowerCase();
          if(t.voice)for(i=0;i<vs.length;i++)if(vs[i].name===t.voice){v=vs[i];break}
          if(!v&&want)for(i=0;i<vs.length;i++)if(vs[i].lang&&vs[i].lang.toLowerCase().indexOf(want.slice(0,2))===0){v=vs[i];break}
          if(v){u.voice=v;u.lang=v.lang}else if(want)u.lang=want;
          u.rate=t.rate||1;u.pitch=t.pitch===undefined?1:t.pitch;u.volume=(t.volume===undefined?80:t.volume)/100;syn.speak(u)}catch(x){}}
        function report(){if(!c.reportUrl)return;var tries=0;function send(){var vs=[];try{if(canSay)vs=syn.getVoices().slice(0,60).map(function(v){return{n:v.name,l:v.lang}})}catch(x){}fetch(c.reportUrl,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({supported:canSay,voices:vs})}).catch(function(){})}
          (function wait(){if(!canSay||syn.getVoices().length||tries++>8)return send();setTimeout(wait,500)})()}
        setTimeout(report,800);`;
const KINDS = ["follow", "sub", "raid", "test", "alert"];
/** Les alertes venues du sujet `live.event` (leurs titres ne sont pas acceptés par `push`). */
const LIVE_KINDS = ["superchat", "supersticker", "member", "gift"];
/** Modules dont la présence active la lecture du sujet `live.event` par la page de l'overlay. */
const LIVE_PROVIDERS = ["youtube-live-actions"];
/** The module whose presence makes the overlay page read the topic `twitch.event` (the topic is read on demand, like `live.event`). */
const TWITCH_PROVIDERS = ["twitch-events"];
export const LIMITS = { queue: 50, seen: 400, maxAgeMs: 120_000, throttleMs: 2000, name: 40, message: 200, detail: 140, perPull: 20 };
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
/** Le texte venu d'ailleurs (sujet `live.event`) : normalisé, sans caractère de contrôle ni de sens d'écriture, espaces réduits, borné. */
const cleanText = (v, max) => String(v ?? "").normalize("NFKC").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const color = (v, def) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : def);

// ── Élément de page d'overlay (cœur 0.5.0) ────────────────────────────────────────────────────────────────────────────────
/** Les paramètres `ov-*` que le cœur ajoute à l'adresse de l'élément : présents (`ov-fit=scale`), la page est celle de l'ÉLÉMENT ; sinon c'est l'overlay du module, tel qu'avant. */
const elementQuery = (opts) => { const q = opts?.query; return q && typeof q.get === "function" && q.get("ov-fit") === "scale" ? q : null; };
/** Option « Alertes montrées » : toutes (défaut), celles de la chaîne (follow, sub, raid…), ou celles du direct YouTube (dons, adhésions). */
const OV_ONLY = { all: null, channel: KINDS, live: LIVE_KINDS };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
/** Style commun de la page d'overlay (`ov-text`, `ov-surface`, `ov-corners`) → jetons --ov-* (mêmes valeurs que le cœur). Absent : l'élément garde les couleurs du module. */
function ovTokens(q) {
  if (!q.has("ov-text")) return "";
  const light = q.get("ov-text") !== "dark", soft = q.get("ov-surface") === "soft";
  return `--ov-fg:${light ? "#ffffff" : "#111111"};--ov-surface:${soft ? (light ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.7)") : "transparent"};--ov-radius:${q.get("ov-corners") === "square" ? "0px" : "12px"};--ov-border:${soft ? (light ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.2)") : "transparent"}`;
}

// ── Le flux lisible par PLUSIEURS lecteurs (éléments de page d'overlay, cœur 0.5.0) ────────────────────────────────────────
// Chaque alerte émise est aussi notée, avec un numéro d'ordre, dans un petit journal en mémoire (100 alertes au plus par overlay). Un lecteur (une page d'overlay qui affiche l'élément)
// garde SON repère (`cursor`) et le renvoie à chaque lecture : le module ne retient rien de lui et ne retire rien parce qu'une alerte a été lue. Deux pages d'overlay,
// ou deux fois le même élément, reçoivent donc les mêmes alertes, chacune à son rythme. L'« époque » change quand le serveur redémarre : un repère d'avant n'est pas confondu avec un neuf.
const feeds = (globalThis.__curiosaAlertsFeed ??= new Map());   // clé d'overlay → { epoch, seq, items: [{ seq, event }] }
let epochs = 0;
const FEED = { keep: 100, page: 50, keys: 50 };
const feedOf = (key) => {
  const f = feeds.get(key) ?? { epoch: `${Date.now().toString(36)}${(epochs++).toString(36)}`.slice(-12), seq: 0, items: [] };
  feeds.delete(key); feeds.set(key, f);
  while (feeds.size > FEED.keys) feeds.delete(feeds.keys().next().value);
  return f;
};
const cursorOf = (f, seq = f.seq) => `${f.epoch}.${seq}`;

export const emit = (key, event) => {
  const f = feedOf(key);
  f.items.push({ seq: ++f.seq, event });
  if (f.items.length > FEED.keep) f.items.splice(0, f.items.length - FEED.keep);
  return bus.emit(key, event);
};

/**
 * Lit le flux POUR UN LECTEUR : `cursor` est SON repère. `"now"` (ou rien, ou un repère d'une autre époque) ouvre un lecteur neuf à la fin du flux. Lecture bornée (50 alertes).
 * Rien n'est consommé : deux lecteurs qui demandent la même chose reçoivent la même chose.
 */
export function readFeed(key, cursor) {
  const f = feedOf(key);
  const m = /^([0-9a-z]{1,12})\.(\d{1,15})$/.exec(String(cursor ?? ""));
  if (!m || m[1] !== f.epoch) return { events: [], cursor: cursorOf(f) };
  const fresh = f.items.filter((i) => i.seq > Number(m[2])).slice(0, FEED.page);
  return { events: fresh.map((i) => i.event), cursor: fresh.length ? cursorOf(f, fresh.at(-1).seq) : cursor };
}

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

const seenOf = (globalThis.__curiosaAlertsSeen ??= new Map());   // clé d'overlay → { ids: Set, last, flight }
/**
 * Lit le sujet et envoie à l'overlay ce qui est NOUVEAU (jamais deux fois la même alerte, rien de plus vieux que 2 minutes). Rend le nombre d'alertes envoyées. Ne lève jamais.
 * La limite (une lecture toutes les 2 secondes) est PAR OVERLAY, quel que soit le nombre de pages qui la lisent. Un lecteur qui arrive pendant qu'une lecture est en cours
 * l'attend (il ne la refait pas) : il trouve alors, dans le flux, les mêmes alertes que les autres.
 */
export async function pullLive(ctx, now = Date.now()) {
  const key = ctx.instance.key;
  const st = seenOf.get(key) ?? { ids: new Set(), last: 0, flight: null };
  seenOf.delete(key); seenOf.set(key, st);
  while (seenOf.size > 50) seenOf.delete(seenOf.keys().next().value);
  if (st.flight) { await st.flight; return { sent: 0, throttled: true }; }
  if (now - st.last < LIMITS.throttleMs) return { sent: 0, throttled: true };
  st.last = now;
  const run = collectLive(ctx, st, now);
  st.flight = run.catch(() => {});
  try { return await run; } finally { st.flight = null; }
}

/** How the Twitch engine writes and filters: the language, the default duration, the viewers' texts, the ignore list, the burst window. */
export const twitchEnv = (ctx, now = Date.now()) => ({ t: ctx.t, locale: ctx.locale, seconds: 0, showText: ctx.setting("twitchText") === true, ignore: tw.ignoreOf(ctx.setting("ignoreNames")), groupMs: Math.min(tw.LIMITS.groupMs.max, Math.max(0, Math.trunc(Number(ctx.setting("groupSeconds") ?? 5)) * 1000 || 0)), baseSeconds: Math.min(60, Math.max(2, Number(ctx.setting("durationSeconds")) || 6)), videos: tw.videosOf(ctx.setting), onFlag: (item, reason, state) => { tw.journalFlag(ctx, item.id, reason, state); }, now });

async function collectLive(ctx, st, now) {
  const key = ctx.instance.key;
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
  const sentTwitch = await tw.pullTwitch(ctx, (a) => emit(key, a), twitchEnv(ctx, now)).catch(() => 0);
  return { sent: out.length + sentTwitch };
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
    { type: "adminForm", action: "testYoutube", title: ctx.t("ytTestTitle"), submitLabel: ctx.t("ytTestSubmit"), fields: [] },
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
      const body = { ok: true, sent: r.sent };
      if (new URL(request.url).searchParams.get("ctl") === "1") body.ctl = await tw.ctlOf(ctx).catch(() => null);
      return Response.json(body, { headers: { "Cache-Control": "no-store" } });
    },

    // Le flux d'un LECTEUR (élément de page d'overlay) : `after` est SON repère (`now` pour un lecteur neuf). Rien n'est consommé ; `pull=1` va aussi chercher le sujet `live.event`
    // (au plus une lecture toutes les 2 secondes par overlay, QUEL QUE SOIT le nombre de lecteurs : la limite est par overlay, pas par lecteur).
    async feed(request, ctx) {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
      const params = new URL(request.url).searchParams;
      if (params.get("pull") === "1") await pullLive(ctx);
      const body = readFeed(ctx.instance.key, params.get("after"));
      if (params.get("ctl") === "1") body.ctl = await tw.ctlOf(ctx).catch(() => null);
      return Response.json(body, { headers: { "Cache-Control": "no-store" } });
    },

    // The page says which voices it sees (OBS browser: the voices of the computer, often none). Small, bounded, nothing secret.
    async "tts-report"(request, ctx) {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
      const raw = await request.text();
      if (raw.length > 8000) return new Response("Too large", { status: 413 });
      let body; try { body = JSON.parse(raw); } catch { return new Response("Bad request", { status: 400 }); }
      await tw.saveReport(ctx, body);
      return Response.json({ ok: true });
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
      emit(ctx.instance.key, { kind, message, ...(username ? { username } : {}), ...(body?.queue === false ? { queued: false } : {}) });
      return Response.json({ ok: true, listeners: listeners(ctx.instance.key) });
    },
  },

  // Élément de page d'overlay « alertes » (cœur 0.5.0) : l'adresse de l'élément est celle de l'overlay du module, avec la langue. Le cœur y ajoute `ov-*` et `opt-*`.
  // Cet overlay n'a pas d'adresse secrète à part (l'adresse est celle de l'overlay) : rien de plus à ajouter ici.
  overlayElements: {
    alerts: (ctx, request) => ({ url: `/overlays/${ctx.instance.key}${/^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(request?.lang ?? "") ? `?lang=${request.lang}` : ""}` }),
  },

  // Overlay du module (`/overlays/<clé>`), et, avec les paramètres `ov-*` du cœur, la page de l'ÉLÉMENT : même rendu, même fichier, rien de dupliqué.
  async overlay(ctx, opts) {
    const q = elementQuery(opts), ov = q !== null;
    // La page ne va chercher les alertes YouTube que si « Actions du live YouTube » est installé sur le site.
    let pull = false;
    try { pull = (await Promise.all(LIVE_PROVIDERS.map((m) => ctx.api.instances.list({ module: m })))).some((l) => Array.isArray(l) && l.length > 0); } catch { pull = false; }
    // Twitch activity installed: the page also reads the topic `twitch.event`, queues every alert, and honours a title, a duration, a pause between alerts and "empty the queue".
    // Without it the page is byte for byte the page of before (see the non-regression test).
    let tx = false;
    try { tx = (await Promise.all(TWITCH_PROVIDERS.map((m) => ctx.api.instances.list({ module: m })))).some((l) => Array.isArray(l) && l.some((i) => TWITCH_PROVIDERS.includes(i?.module))); } catch { tx = false; }
    if (tx) pull = true;
    const duration = Math.min(60, Math.max(2, Number(ctx.setting("durationSeconds")) || 6));
    const kinds = ov && Object.hasOwn(OV_ONLY, q.get("opt-kinds") ?? "") ? q.get("opt-kinds") : "all";
    // Entrée / sortie : l'option de l'élément (si elle n'est pas « comme le module »), sinon le réglage. Tout en « auto » : le script d'avant, à l'identique (animation `alPop`).
    const tr = transitionConfig({ inOpt: ov ? q.get("opt-transitionIn") : null, inSetting: ctx.setting("transitionIn"), outOpt: ov ? q.get("opt-transitionOut") : null, outSetting: ctx.setting("transitionOut"), seconds: ctx.setting("transitionSeconds") }, 500);
    // Twitch activity: the look of each type (picture, sound, way of entering) comes from the configuration; sounds only if the person switched them on.
    const twcfg = tx ? await tw.loadConfig(ctx).catch(() => null) : null;
    const anyAnim = !!twcfg && Object.values(twcfg.types).some((x) => x.anim);
    const sounds = tx && ctx.setting("twitchSounds") === true;
    const audioOn = sounds && !!twcfg && Object.values(twcfg.types).some((x) => x.audio);   // a sound file is only worth its code if a type has one
    const fx = tr.in !== "auto" || tr.out !== "auto" || anyAnim;
    const cfg = {
      ...(fx ? { tr } : {}),
      ...(ov ? {} : { eventsUrl: `/m/${ctx.instance.key}/events` }),
      duration,
      neon: ctx.setting("visual") !== "plain",
      labels: Object.fromEntries([...KINDS, ...(tx ? tw.TWITCH_KINDS.filter((k) => !KINDS.includes(k)) : []), ...(pull ? LIVE_KINDS : [])].map((k) => [k, ctx.t(`kind_${k}`)])),
      ...(tx ? { lang: ctx.locale, reportUrl: `/m/${ctx.instance.key}/tts-report` } : {}),
      ...(sounds ? { volume: Math.min(100, Math.max(0, Math.trunc(Number(ctx.setting("soundVolume") ?? 50)) || 0)) } : {}),
      ...(tx ? { between: Math.min(tw.LIMITS.gapMs.max, Math.max(0, Math.trunc(Number(ctx.setting("minGapSeconds") ?? 1)) * 1000 || 0)) } : {}),
      ...(pull && !ov ? { pullUrl: `/m/${ctx.instance.key}/pull`, pullMs: 5000, queueMax: LIMITS.queue } : {}),
      // Élément : chaque page lit le flux avec SON repère (route `feed`), jamais une file partagée.
      ...(ov ? { feedUrl: `/m/${ctx.instance.key}/feed`, feedMs: 1500, feedPull: pull, queueMax: LIMITS.queue, only: kinds === "channel" && tx ? [...KINDS, ...tw.TWITCH_KINDS] : OV_ONLY[kinds] } : {}),
    };
    const accent = color(ctx.setting("accentColor"), ctx.theme.accent);
    const t = ctx.theme;
    const json = JSON.stringify(cfg).replace(/</g, "\\u003c");
    // Sélecteurs : l'overlay du module garde ses classes ; l'élément se style par `data-ov-part` et les jetons `--ov-*` (avec repli sur les couleurs du module).
    const S = ov ? { card: '[data-ov-part="card"]', kind: '[data-ov-part="kind"]', msg: '[data-ov-part="message"]', detail: '[data-ov-part="detail"]' } : { card: ".al-card", kind: ".al-kind", msg: ".al-msg", detail: ".al-detail" };
    const accentBorder = "color-mix(in srgb,var(--al-accent) 40%,transparent)", surface = "color-mix(in srgb,var(--al-bg) 90%,transparent)";
    // Avec une entrée ou une sortie choisie, la carte n'a plus l'animation unique `alPop` : elle entre, reste, puis sort (« auto » = le zoom léger d'avant).
    const fxScript = fx ? `${ovTransition.toString()}
        var fx=function(card,phase){var m=${tx ? "card._anim||" : ""}c.tr[phase==="in"?"in":"out"];return ovTransition(card,phase,m==="auto"?"pop":m,{ms:c.tr.ms,pop:.85,side:"bottom"})};
        function hold(card,fin${tx ? ",secs" : ""}){clearTimeout(timer);var lead=Math.round(c.tr.ms*(c.tr.out==="jiggle"?1.3:1));timer=setTimeout(function(){fx(card,"out").then(fin)},Math.max(c.tr.ms,${tx ? "(secs||c.duration)" : "c.duration"}*1000-lead))}` : "";
    const withDetail = pull || ov;
    const queued = pull || ov;
    // Un élément en mode test (`ov-demo=1`) montre une alerte d'exemple, fixe, jusqu'à la première vraie alerte.
    const sample = ov && q.get("ov-demo") === "1" ? `<div data-ov-part="card" style="animation:none"><div data-ov-part="kind">${esc(ctx.t("kind_test"))}</div><div data-ov-part="message">${esc(ctx.t("testMessage"))}</div></div>` : "";
    // Le dessin d'une alerte : les mêmes lignes pour l'overlay et l'élément, seul le marquage (classe ou attribut) change.
    const node = (v, part, cls, extra = "") => `var ${v}=document.createElement("div");${ov ? `${v}.setAttribute("data-ov-part","${part}");` : `${v}.className="${cls}"${extra};`}`;
    return {
      title: ctx.instance.name,
      html: `<div id="al-stage" style="${ov ? `${ovTokens(q)};` : ""}--al-accent:${accent};--al-bg:${t.surface};--al-fg:${t.fg}">${sample}</div>`,
      css: `
        html,body{margin:0;height:100%;background:transparent;overflow:hidden;font-family:system-ui,"Segoe UI",sans-serif}
        #al-stage{position:fixed;inset:0;display:flex;align-items:center;justify-content:center}
        ${S.card}{display:flex;flex-direction:column;align-items:center;gap:.5rem;padding:2rem 3rem;border-radius:${ov ? "var(--ov-radius,1.5rem)" : "1.5rem"};border:1px solid ${ov ? `var(--ov-border,${accentBorder})` : accentBorder};background:${ov ? `var(--ov-surface,${surface})` : surface};${ov ? "" : "backdrop-filter:blur(6px);"}text-align:center;${fx ? "" : "animation:alPop var(--al-dur) ease-in-out forwards"}}
${!ov || cfg.neon ? `        ${ov ? S.card : ".al-card.neon"}{box-shadow:0 0 28px color-mix(in srgb,var(--al-accent) 45%,transparent)}
` : ""}        ${S.kind}{font-size:1.6rem;font-weight:700;color:var(--al-accent)}
${!ov || cfg.neon ? `        ${ov ? `${S.card} ${S.kind}` : ".al-card.neon .al-kind"}{text-shadow:0 0 12px var(--al-accent)}
` : ""}        ${S.msg}{font-size:1.15rem;color:${ov ? "var(--ov-fg,var(--al-fg))" : "var(--al-fg)"}}
${withDetail ? `        ${S.detail}{font-size:1rem;color:${ov ? "var(--ov-fg,var(--al-fg))" : "var(--al-fg)"};opacity:.85;max-width:32rem;overflow-wrap:anywhere}
` : ""}${tx ? `        ${ov ? '[data-ov-part="image"]' : ".al-img"}{width:96px;height:96px;object-fit:cover;border-radius:${ov ? "var(--ov-radius,12px)" : "12px"}}
` : ""}        @keyframes alPop{0%{opacity:0;transform:scale(.85)}10%{opacity:1;transform:scale(1)}90%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(.95)}}`,
      // Sans « Actions du live YouTube » : le script d'avant, à l'identique. Avec : une file (50 au plus, la plus vieille part la première) pour que plusieurs dons de suite
      // s'affichent l'un après l'autre au lieu de se remplacer ; les alertes poussées (push) remplacent toujours la carte à l'écran, comme avant.
      script: queued ? `(function(){var c=${json},stage=document.getElementById("al-stage"),timer,q=[],busy=false;
        stage.style.setProperty("--al-dur",c.duration+"s");${fxScript}${sounds ? SOUND_SCRIPT : ""}${audioOn ? AUDIO_SCRIPT : ""}${tx ? VOICE_SCRIPT : ""}
        function draw(e){${node("card", "card", "al-card", `+(c.neon?" neon":"")`)}${tx ? ANIM_SCRIPT(fx) : ""}${sounds ? "if(e.sound)beep(e.sound);" : ""}${audioOn ? "playFile(e);" : ""}${tx ? "speak(e);" : ""}
          ${tx ? `if(e.present==="media"&&(e.video||e.image)){${MEDIA_SCRIPT(ov)}}else{${PICTURE_SCRIPT(ov)}` : ""}${node("k", "kind", "al-kind")}k.textContent=${tx ? "e.title||" : ""}c.labels[e.kind]||c.labels.alert;
          ${node("m", "message", "al-msg")}m.textContent=e.message;card.append(k,m);
          if(e.detail){${node("d", "detail", "al-detail")}d.textContent=e.detail;card.append(d)}${tx ? "}" : ""}
          ${tx ? "var secs=e.duration||c.duration;" : ""}stage.replaceChildren(card);${fx ? `fx(card,"in");hold(card,done${tx ? ",secs" : ""})` : `clearTimeout(timer);timer=setTimeout(done,${tx ? "secs" : "c.duration"}*1000)`}}
        ${tx ? "function done(){if(typeof stopFile==='function')stopFile();shownCard=null;stage.replaceChildren();if(c.between>0){setTimeout(function(){busy=false;next()},c.between)}else{busy=false;next()}}" : "function done(){stage.replaceChildren();busy=false;next()}"}
        function next(){if(busy)return;var e=q.shift();if(e){busy=true;draw(e)}}
        ${tx ? "function show(e){if(e.control===\"clear\"){q=[];clearTimeout(timer);stage.replaceChildren();busy=false;return}if(e.queued!==false){" : "function show(e){if(e.queued){"}if(q.length>=c.queueMax)q.shift();q.push(e);next()}else{busy=true;draw(e)}}
${ov ? `        var cur="now",gap=c.feedMs;function poll(){fetch(c.feedUrl+"?after="+encodeURIComponent(cur)+(c.feedPull?"&pull=1":"")${tx ? '+"&ctl=1"' : ""},{cache:"no-store"}).then(function(r){if(!r.ok)throw 0;return r.json()}).then(function(d){cur=d.cursor;gap=c.feedMs;${tx ? "applyCtl(d.ctl);" : ""}d.events.forEach(function(e){if(${tx ? "e.control||" : ""}!c.only||c.only.indexOf(e.kind)>=0)show(e)})}).catch(function(){gap=15000}).then(function(){setTimeout(poll,gap)})}
        poll()})();` : `        var es=new EventSource(c.eventsUrl);es.onmessage=function(ev){try{show(JSON.parse(ev.data))}catch(e){}};
        var gap=c.pullMs;${tx ? `function pull(){fetch(c.pullUrl+"?ctl=1",{cache:"no-store"}).then(function(r){gap=r.ok?c.pullMs:30000;return r.ok?r.json():null},function(){gap=30000;return null}).then(function(d){if(d)applyCtl(d.ctl)},function(){}).then(function(){setTimeout(pull,gap)})}` : `function pull(){fetch(c.pullUrl,{cache:"no-store"}).then(function(r){gap=r.ok?c.pullMs:30000},function(){gap=30000}).then(function(){setTimeout(pull,gap)})}`}
        setTimeout(pull,1000)})();`}` : `(function(){var c=${json},stage=document.getElementById("al-stage"),timer;
        stage.style.setProperty("--al-dur",c.duration+"s");${fxScript}
        function show(e){var card=document.createElement("div");card.className="al-card"+(c.neon?" neon":"");
          var k=document.createElement("div");k.className="al-kind";k.textContent=c.labels[e.kind]||c.labels.alert;
          var m=document.createElement("div");m.className="al-msg";m.textContent=e.message;card.append(k,m);
          stage.replaceChildren(card);${fx ? "fx(card,\"in\");hold(card,function(){stage.replaceChildren()})" : "clearTimeout(timer);timer=setTimeout(function(){stage.replaceChildren()},c.duration*1000)"}}
        var es=new EventSource(c.eventsUrl);es.onmessage=function(ev){try{show(JSON.parse(ev.data))}catch(e){}}})();`,
    };
  },

  async adminPanel(ctx, { query } = {}) {
    const base = `${ctx.api.siteUrl}/m/${ctx.instance.key}/push`;
    const hasToken = !!String(ctx.setting("pushToken") ?? "").trim();
    return [
      { type: "heading", text: ctx.t("adminTitle") },
      { type: "markdown", text: ctx.t("adminHelp") },
      { type: "copy", label: "POST", text: `curl -X POST ${base} -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d '{"kind":"follow","message":"Alex","username":"alex"}'` },
      ...(hasToken ? [] : [{ type: "markdown", text: ctx.t("noToken") }]),
      { type: "adminForm", action: "test", title: ctx.t("testTitle"), submitLabel: ctx.t("testSubmit"), fields: [] },
      ...(await youtubeBlocks(ctx)),
      ...(await adminTw.panel(ctx, { query: query ?? {} })),
    ];
  },

  // The queue of this overlay, for the other modules that offer a remote (the dock of Twitch activity): where it stands, pause (held, nothing is lost), resume, empty.
  services: {
    "alerts.queue": {
      state: (ctx) => tw.queueState(ctx),
      pause: (ctx) => tw.pause(ctx),
      resume: (ctx) => tw.resume(ctx, (a) => emit(ctx.instance.key, a)),
      clear: (ctx) => tw.clearQueue(ctx, (a) => emit(ctx.instance.key, a)),
      // version 2: the voice, the speech and the texts of viewers (for the dock). Nothing here shows more than the dock may see: names and the flagged text.
      voice: (ctx) => tw.voiceState(ctx),
      mute: (ctx, input) => tw.setMuted(ctx, input?.muted !== false),
      voiceOn: (ctx, input) => tw.setVoiceOn(ctx, input?.on === true),
      stopSpeech: (ctx) => tw.stopSpeech(ctx),
      skip: (ctx) => tw.skipAlert(ctx),
      texts: (ctx) => tw.textsList(ctx),
      decide: (ctx, input) => tw.decideText(ctx, String(input?.id ?? ""), input?.action === "accept" ? "accept" : "dismiss", (a) => emit(ctx.instance.key, a)),
    },
  },
  mcp: adminTw.tools((key, a) => emit(key, a)),

  adminActions: {
    ...adminTw.actions(emit),
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
