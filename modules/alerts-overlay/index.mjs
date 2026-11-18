// Overlay alertes (OBS) — module communautaire de Curiosa. Porté de l'ancien site.
//
// Flux en direct (SSE) en mémoire : un seul processus serveur, un EventEmitter suffit (pas de Redis pour ce volume).
// Quelque chose POUSSE une alerte : POST /m/<clé>/push avec `Authorization: Bearer <jeton>` et { kind, message, username? }.
// Le module ne connaît ni Twitch ni aucun outil : il affiche ce qu'on lui envoie.
//
// (1.18.0) Le module « Activité Twitch » (twitch-events) est fondu ici : l'écoute de Twitch (EventSub par adresse signée), le journal, le dock OBS, les réactions par
// type et par récompense vivent dans `twitch/` (voir twitch/home.mjs : une seule copie écoute, la première ; sans connexion Twitch sur le site, rien de Twitch ne
// s'affiche ni ne tourne). Le protocole entre les deux modules (service `alerts.reaction`, `alerts.reaction.editor`, `twitch.journal` consommé) a disparu :
// les mêmes fonctions sont appelées directement. La reprise des données d'Activité Twitch se fait une fois (service `twitch.events.handover` de sa version 1.13.0).
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
const md = await import(new URL(`./media.mjs${v}`, import.meta.url).href);
const adminMd = await import(new URL(`./media-admin.mjs${v}`, import.meta.url).href);
const rx = await import(new URL(`./reaction.mjs${v}`, import.meta.url).href);
const rxMcp = await import(new URL(`./reaction-mcp.mjs${v}`, import.meta.url).href);
const cp = await import(new URL(`./compose.mjs${v}`, import.meta.url).href);
const rw = await import(new URL(`./rewards.mjs${v}`, import.meta.url).href);
const cpMcp = await import(new URL(`./compose-mcp.mjs${v}`, import.meta.url).href);
const alertOpts = await import(new URL(`./options.mjs${v}`, import.meta.url).href);
// (1.18.0) The Twitch part (formerly the module Twitch activity)
const home = await import(new URL(`./twitch/home.mjs${v}`, import.meta.url).href);
const evWebhook = await import(new URL(`./twitch/webhook.mjs${v}`, import.meta.url).href);
const evAdmin = await import(new URL(`./twitch/admin.mjs${v}`, import.meta.url).href);
const evPub = await import(new URL(`./twitch/publish.mjs${v}`, import.meta.url).href);
const evSt = await import(new URL(`./twitch/state.mjs${v}`, import.meta.url).href);
const { default: evTools } = await import(new URL(`./twitch/tools.mjs${v}`, import.meta.url).href);
const evListen = await import(new URL(`./twitch/listen.mjs${v}`, import.meta.url).href);
const evCycle = await import(new URL(`./twitch/cycle.mjs${v}`, import.meta.url).href);
const evOpt = await import(new URL(`./twitch/settings.mjs${v}`, import.meta.url).href);
const evDockApi = await import(new URL(`./twitch/dockapi.mjs${v}`, import.meta.url).href);
const evDock = await import(new URL(`./twitch/dock.mjs${v}`, import.meta.url).href);
const evKit = await import(new URL(`./twitch/dockkit.mjs${v}`, import.meta.url).href);
const evFlag = await import(new URL(`./twitch/flag.mjs${v}`, import.meta.url).href);
const evRx = await import(new URL(`./twitch/reaction.mjs${v}`, import.meta.url).href);
// (1.20.0) The animated elements "Hype train" and "Session counter" (core 0.30.0 engine)
const gauges = await import(new URL(`./gauges.mjs${v}`, import.meta.url).href);
/** (1.18.0) What each Twitch event type and each reward shows: the methods of the former service `alerts.reaction` (version 3), same inputs and answers, now internal. */
export const reactionService = evRx.methods;
/**
 * (1.16.0) A caller declares the place of one of its commands (`alerts.show.place`): its label, its files (addresses of this library), the automatic values its texts
 * may use, a sample sentence, and, when its window could place text, `compositions` ({ [src]: composition | null }). `check: true` only checks. Every file must
 * be in the library (the caller added new ones with `add` first). Rends { ok: true, placed } or { ok: false, code, errors? }.
 */
async function placeOfCaller(ctx, input) {
  const decl = cp.readPlace(input);
  if (!decl) return { ok: false, code: "place" };
  const lib = new Set((await md.list(ctx, { tones: false })).map((m) => m.url).filter(Boolean));
  const outside = decl.files.filter((src) => !lib.has(src));
  if (outside.length) return { ok: false, code: "file", files: outside };
  let value = {};
  if (input?.compositions && typeof input.compositions === "object" && cp.available(ctx)) {
    const c = cp.check(ctx, input.compositions, { files: decl.files, variables: decl.variables });
    if (!c.ok) return { ok: false, code: "compose", errors: c.errors };
    value = c.value;
  }
  if (input?.check === true) return { ok: true, placed: Object.values(value).filter(Boolean).length };
  await cp.declarePlace(ctx, decl);
  if (input?.compositions && typeof input.compositions === "object" && cp.available(ctx)) await cp.save(ctx, decl.place, value, { files: decl.files });
  return { ok: true, placed: Object.keys(await cp.forPlace(ctx, decl.place)).length };
}
/** Sounds: small synthesised notes (the page makes them, nothing is loaded). [frequency Hz, start s, length s]. Played only when the person switched sounds on. */
const SOUND_SCRIPT = `
        var ac=null,SND={chime:[[880,0,.18],[1320,.12,.32]],bell:[[1046,0,.7]],pop:[[420,0,.09]],fanfare:[[523,0,.14],[659,.14,.14],[784,.28,.14],[1046,.42,.42]]};
        function beep(name,own){try{var A=window.AudioContext||window.webkitAudioContext;var vol=own?c.mvol:c.volume;if(!A||!SND[name]||!vol)return;ac=ac||new A();var t=ac.currentTime,v=vol/100*.25;SND[name].forEach(function(n){var o=ac.createOscillator(),g=ac.createGain();o.type=name==="pop"?"square":"sine";o.frequency.value=n[0];g.gain.setValueAtTime(.0001,t+n[1]);g.gain.exponentialRampToValueAtTime(v,t+n[1]+.02);g.gain.exponentialRampToValueAtTime(.0001,t+n[1]+n[2]);o.connect(g);g.connect(ac.destination);o.start(t+n[1]);o.stop(t+n[1]+n[2]+.05)})}catch(e){}}`;
/** The picture of a type, only an address of the site itself (checked here as well as on the server); the way of entering is remembered on the card for the transition. */
const UPLOAD = (ext) => `/^\\/uploads\\/[0-9a-f-]{36}\\.(${ext})$/`;
/** What the page draws for an alert of Twitch activity, in pieces. The way of entering is remembered on the card; a GIF or a video of the site stands alone; otherwise the picture (if any) goes above the text. */
const ANIM_SCRIPT = (fx) => `${fx ? "card._anim=e.anim||\"\";" : ""}shownCard=card;`;
const MEDIA_SCRIPT = (ov) => `var mc=null;
          if(e.video&&${UPLOAD("mp4|webm")}.test(e.video)){mc=document.createElement("video");mc.src=e.video;mc.muted=!e.videoSound;mc.autoplay=true;mc.playsInline=true;mc.setAttribute("aria-label",e.message);if(mc.play){var pp=mc.play();if(pp&&pp.catch)pp.catch(function(){mc.muted=true;try{mc.play()}catch(x){}})}}
          else if(e.image&&${UPLOAD("png|jpg|webp|gif")}.test(e.image)){mc=document.createElement("img");mc.src=e.image;mc.alt=e.message}
          if(mc){${ov ? 'mc.setAttribute("data-ov-part","media");card.setAttribute("data-ov-media","1");' : 'mc.className="al-media";card.className+=" al-media-card";'}card.append(mc)}`;
/**
 * (1.12.0) An alert with a placed text (`e.compose`, filled by the server): the core's engine draws it in a frame of its own (never a card: the appearance kit gives
 * it no panel), whole inside the element, with transparent bands. Present only when the overlay holds a composition and the core has the engine.
 */
const COMPOSE_DRAW = 'if(e.compose&&window.CuriosaCompose){card=document.createElement("div");card.className="al-cmp";card._cmp=e.compose;card._anim=e.anim||"";shownCard=card}else ';
const COMPOSE_MOUNT = "if(card._cmp)window.CuriosaCompose.mount(card,card._cmp,{seconds:secs});";
/** (1.14.0) The backdrop of the alert that waits next is loaded while this one shows (one at a time), so a video starts without a black gap. */
const NEXT_AHEAD = "function ahead(){var n=q[0];if(n&&n.compose&&window.CuriosaCompose&&window.CuriosaCompose.preload)window.CuriosaCompose.preload(n.compose)}function next(){if(!busy){var e=q.shift();if(e){busy=true;draw(e)}}ahead()}";
const COMPOSE_DONE = 'var cr=stage.querySelector(\'[data-ov-region="composition"]\');if(cr&&window.CuriosaCompose)window.CuriosaCompose.unmount(cr);';
/** A sound file of the site, played once per alert at the volume of the sounds; it stops with the card (skip, next alert). Same condition as the synthesised sounds. */
const AUDIO_SCRIPT = `
        var fileSnd=null;
        function stopFile(){try{if(fileSnd){fileSnd.pause();fileSnd=null}}catch(x){}}
        function playFile(e){stopFile();var vol=e.own?c.mvol:c.volume;if(!e.audio||!vol||!${UPLOAD("mp3|ogg|wav|m4a|aac")}.test(e.audio))return;try{var a=new Audio(e.audio);a.volume=vol/100;fileSnd=a;var p=a.play();if(p&&p.catch)p.catch(function(){})}catch(x){}}`;
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
/** A media that is only a sound: nothing is drawn, the sound plays, the queue waits for its seconds. Placed after the sound calls of draw(). */
const SOUND_ONLY = "if(e.present===\"sound\"){stage.replaceChildren();clearTimeout(timer);timer=setTimeout(done,(e.duration||c.duration)*1000);return}";
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

// ── Élément de page d'overlay (cœur 0.5.0) ────────────────────────────────────────────────────────────────────────────────
/** Les paramètres `ov-*` que le cœur ajoute à l'adresse de l'élément : présents (`ov-fit=scale`), la page est celle de l'ÉLÉMENT ; sinon c'est l'overlay du module, tel qu'avant. */
const elementQuery = (opts) => { const q = opts?.query; return q && typeof q.get === "function" && (q.get("ov-fit") === "scale" || q.get("ov-fit") === "fluid") ? q : null; };
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
export const twitchEnv = (ctx, now = Date.now()) => ({ t: ctx.t, locale: ctx.locale, seconds: 0, showText: alertOpts.get(ctx, "twitchText") === true, ignore: tw.ignoreOf(alertOpts.get(ctx, "ignoreNames")), groupMs: Math.min(tw.LIMITS.groupMs.max, Math.max(0, Math.trunc(Number(alertOpts.get(ctx, "groupSeconds") ?? 5)) * 1000 || 0)), baseSeconds: Math.min(60, Math.max(2, Number(ctx.setting("durationSeconds")) || 6)), videos: tw.videosOf(ctx.setting), onFlag: (item, reason, state) => { tw.journalFlag(ctx, item.id, reason, state); }, now });

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
  await alertOpts.load(ctx);
  const sentTwitch = await tw.pullTwitch(ctx, (a) => emit(key, a), { ...twitchEnv(ctx, now), items: await twitchItems(ctx), compose: cp.composerOf(ctx, await cp.allByKey(ctx).catch(() => new Map())), rewards: await rw.byId(ctx).catch(() => null) }).catch(() => 0);
  return { sent: out.length + sentTwitch };
}
export const listeners = (key) => bus.listenerCount(key);

/**
 * (1.18.0) Where the Twitch lines of this copy come from: the copy that listens reads its own journal (the same items as its topic, marked as its own); while
 * Twitch activity has not handed over yet, the topic of Twitch activity only; another copy reads the topic (offered by the copy that listens); no Twitch: nothing.
 * Returns the reader for `pullTwitch` (undefined = the topic, as before).
 */
export async function twitchItems(ctx) {
  const m = await home.mode(ctx);
  if (m === "on") return async () => (await evPub.topicItems(ctx, { limit: 200 })).map((i) => ({ ...i, source: { instance: ctx.instance.key, module: home.MODULE } }));
  if (m === "waiting") return async () => (await ctx.api.topics.collect(tw.TOPIC, { limit: 200 })).filter((i) => i?.source?.module !== home.MODULE);
  if (m === "off") return async () => [];
  return undefined;
}
/** The journal mark of a viewer text (hidden, held, decided): the copy that listens marks its own journal; while waiting, Twitch activity's (its hand-over service). */
tw.setJournalMark(async (ctx, input) => {
  const m = await home.mode(ctx);
  if (m === "on") return evFlag.mark(ctx, input);
  if (m === "waiting") return ctx.api.services.call(home.HANDOVER, "flag", input);
  return null;
});
/** The Twitch part answers only on the copy that listens (or is about to); elsewhere a plain "not found". */
const notHere = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
/** Runs an action or a tool with the options read first: the Twitch options of the overlay (options.mjs) and those of the listening (twitch/settings.mjs). */
const withOptions = (fn) => async (ctx, ...rest) => { await Promise.all([evOpt.loadOptions(ctx), alertOpts.load(ctx)]); return fn(ctx, ...rest); };
const allWithOptions = (o) => Object.fromEntries(Object.entries(o).map(([k, fn]) => [k, withOptions(fn)]));
/** The blocks of the page while Twitch activity has not handed over: one line, and what to do. Taken over at once when it can. */
async function waitingBlocks(ctx) {
  const t = ctx.t, r = await home.takeOver(ctx).catch(() => ({ done: false, code: "failed" }));
  if (r.done) return null;
  const old = await home.oldOne(ctx);
  return [{ type: "banner", tone: "warning", text: t(r.code === "old" ? "ho_need_update" : "ho_waiting") }, ...(old?.adminPath ? [{ type: "links", items: [{ label: t("ho_open_old"), href: old.adminPath }] }] : [])];
}
/** One line on a copy that does not listen to Twitch: where the listening is. */
async function guestBlocks(ctx) {
  const path = await home.homePath(ctx);
  return path ? [{ type: "links", tab: "twitch", items: [{ label: ctx.t("ho_guest_link"), href: path }] }] : [];
}

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

    // (1.20.0) The animated elements: the page (`gauge/hype`, `gauge/session`) and what it reads every 1.5 s (`gauge-state/<el>`). Read-only, no secret in them:
    // the numbers they give are the ones shown on stream.
    "gauge/:slug"(request, ctx) {
      const el = ctx.params?.slug;
      if (el !== "hype" && el !== "session") return new Response("Not found", { status: 404 });
      return new Response(gauges.elementPage(ctx, el, new URL(request.url).searchParams), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": gauges.CSP, "X-Content-Type-Options": "nosniff" } });
    },
    async "gauge-state/:slug"(request, ctx) {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
      const el = ctx.params?.slug;
      if (el !== "hype" && el !== "session") return new Response("Not found", { status: 404 });
      if (!evSt.allow(ctx, `gauge-${el}`, { max: 600, windowMs: 60_000 })) return Response.json({ now: Date.now() }, { status: 429, headers: { "Cache-Control": "no-store" } });
      return Response.json(await gauges.stateOf(ctx, el, new URL(request.url).searchParams), { headers: { "Cache-Control": "no-store" } });
    },

    // (1.18.0, formerly Twitch activity) The address Twitch calls. Public by nature; only a request signed with our secret is accepted. The copy that listens only.
    async webhook(request, ctx) {
      if (!(await home.isHome(ctx))) return notHere();
      await evOpt.loadOptions(ctx);
      return (await evWebhook.handle(request, ctx)).response;
    },
    // The OBS dock (secret address `?k=…`, no session needed): the page, what it reads, what it can ask for. See twitch/dock.mjs and twitch/dockapi.mjs.
    async dock(request, ctx) {
      if (!(await home.isHome(ctx))) return notHere();
      const m = await evDockApi.secretMatches(ctx, evDockApi.keyOf(request));
      if (m.limited) return new Response("Too many requests", { status: 429, headers: evKit.jsonHeaders });
      if (!m.ok) return evKit.deniedPage(ctx, ctx.t("dock_denied"), evKit.wantsScheme(request.url));
      const k = encodeURIComponent(evDockApi.keyOf(request));
      return evDock.dockPage(ctx, { dataUrl: `/m/${ctx.instance.key}/dock-data?k=${k}&lang=${encodeURIComponent(ctx.locale)}`, actUrl: `/m/${ctx.instance.key}/dock-act?k=${k}&lang=${encodeURIComponent(ctx.locale)}`, scheme: evKit.wantsScheme(request.url) });
    },
    async "dock-data"(request, ctx) {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
      if (!(await home.isHome(ctx))) return notHere();
      const m = await evDockApi.secretMatches(ctx, evDockApi.keyOf(request));
      if (m.limited) return new Response("{}", { status: 429, headers: evKit.jsonHeaders });
      if (!m.ok) return new Response(JSON.stringify({ denied: true }), { status: 403, headers: evKit.jsonHeaders });
      if (!evSt.allow(ctx, "dockData", { max: evDockApi.LIMITS.dataPerMinute, windowMs: 60_000 })) return new Response("{}", { status: 429, headers: evKit.jsonHeaders });
      const scope = new URL(request.url).searchParams.get("scope") ?? "day";
      return new Response(JSON.stringify(await evDockApi.payload(ctx, { scope })), { headers: evKit.jsonHeaders });
    },
    async "dock-act"(request, ctx) {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
      if (!(await home.isHome(ctx))) return notHere();
      const m = await evDockApi.secretMatches(ctx, evDockApi.keyOf(request));
      if (m.limited) return new Response("{}", { status: 429, headers: evKit.jsonHeaders });
      if (!m.ok) return new Response(JSON.stringify({ ok: false, code: "denied" }), { status: 403, headers: evKit.jsonHeaders });
      const raw = await request.text();
      let body = null; try { body = raw.length <= 2000 ? JSON.parse(raw) : null; } catch { body = null; }
      return new Response(JSON.stringify(await evDockApi.act(ctx, body)), { headers: evKit.jsonHeaders });
    },
  },

  // (1.18.0, formerly Twitch activity) Every minute, on the copy that listens: the hand-over from Twitch activity (once), then the subscriptions checked and repaired,
  // a catch-up after a gap and the health of the listening. Nothing runs on a site without Twitch, nor on another copy.
  tasks: {
    listen: { everyMinutes: 1, run: async (ctx) => {
      const m = await home.mode(ctx);
      if (m === "waiting") { const r = await home.takeOver(ctx); if (!r.done) return; if ((await home.mode(ctx)) !== "on") return; } else if (m !== "on") return;
      else await home.takeOver(ctx).catch(() => null);   // (1.18.1) a hand-over of 1.18.0 copies the journal again, once; afterwards one read of the state
      await evOpt.loadOptions(ctx);
      await evCycle.check(ctx, evOpt.settingsOf(ctx));
    } },
    // Old lines go (retention, tests, size cap).
    purge: { everyMinutes: 60, run: async (ctx) => { if (!(await home.isHome(ctx))) return; await evOpt.loadOptions(ctx); await evSt.purge(ctx, { retentionDays: evOpt.settingsOf(ctx).retentionDays }); } },
  },
  exports: { [evPub.TOPIC]: async (ctx, o) => ((await home.mode(ctx)) === "on" ? evPub.topicItems(ctx, o) : []) },
  async adminBadge(ctx) {
    if ((await home.mode(ctx)) !== "on") return 0;
    const state = await evSt.readState(ctx), c = state.listen?.code;
    return (c && !["listening", "pending", "nothing_on"].includes(c)) || state.health?.code === "silent" ? 1 : 0;
  },
  hooks: {
    async onInstanceCreate(ctx) {
      if ((await home.mode(ctx)) !== "on") return;
      try { await evSt.ensureSecret(ctx); } catch { /* created at the first check */ }
      // The permissions of the types that are on are declared at once (the connector adds them to its authorization).
      try { await evListen.diagnose(ctx, evOpt.settingsOf(ctx), { declare: true }); } catch { /* the minute check declares them */ }
    },
    async onInstanceDelete(ctx) { if ((await home.handoverOf(ctx).catch(() => null)) || (await evSt.readState(ctx).catch(() => ({}))).secret) { await evOpt.loadOptions(ctx); await evListen.stopListening(ctx, evOpt.settingsOf(ctx)); } },
  },
  // (1.18.0) Data version 2: the four Twitch options (settings until 1.17.0) move to the store, so a site without Twitch never sees them (options.mjs).
  migrations: { 2: async (ctx) => { await alertOpts.migrateFromSettings(ctx); } },

  // Élément de page d'overlay « alertes » (cœur 0.5.0) : l'adresse de l'élément est celle de l'overlay du module, avec la langue. Le cœur y ajoute `ov-*` et `opt-*`.
  // Cet overlay n'a pas d'adresse secrète à part (l'adresse est celle de l'overlay) : rien de plus à ajouter ici.
  overlayElements: {
    alerts: (ctx, request) => ({ url: `/overlays/${ctx.instance.key}${/^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(request?.lang ?? "") ? `?lang=${request.lang}` : ""}` }),
    // (1.12.0) "Large alerts": the same alerts in a frame the person sizes freely (the whole canvas by default), so a placed text shows at its real size.
    "alerts-stage": (ctx, request) => ({ url: `/overlays/${ctx.instance.key}${/^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(request?.lang ?? "") ? `?lang=${request.lang}` : ""}` }),
    // (1.20.0) the animated elements: the core adds ov-* and opt-* to these addresses
    "hype-train": (ctx, request) => ({ url: `/m/${ctx.instance.key}/gauge/hype${/^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(request?.lang ?? "") ? `?lang=${request.lang}` : ""}` }),
    "session-counter": (ctx, request) => ({ url: `/m/${ctx.instance.key}/gauge/session${/^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(request?.lang ?? "") ? `?lang=${request.lang}` : ""}` }),
  },

  // Overlay du module (`/overlays/<clé>`), et, avec les paramètres `ov-*` du cœur, la page de l'ÉLÉMENT : même rendu, même fichier, rien de dupliqué.
  async overlay(ctx, opts) {
    const q = elementQuery(opts), ov = q !== null;
    // La page ne va chercher les alertes YouTube que si « Actions du live YouTube » est installé sur le site.
    let pull = false;
    try { pull = (await Promise.all(LIVE_PROVIDERS.map((m) => ctx.api.instances.list({ module: m })))).some((l) => Array.isArray(l) && l.length > 0); } catch { pull = false; }
    // Twitch activity installed: the page also reads the topic `twitch.event`, queues every alert, and honours a title, a duration, a pause between alerts and "empty the queue".
    // Without it the page is byte for byte the page of before (see the non-regression test).
    // (1.18.0) "Twitch activity installed" became "this site has Twitch": the copy that listens, another copy on a Twitch site, or Twitch activity still there.
    let tx = false;
    try { tx = await home.twitchShown(ctx); } catch { tx = false; }
    await alertOpts.load(ctx);
    // The media library (pictures, GIFs, sounds, videos) shown for other modules: the page then has the queue, the media and the sounds, even without Twitch activity. Empty library: the page is what it was.
    const media = await md.hasMedia(ctx);
    if (media) tx = true;
    // Placed texts (1.12.0): the engine of the core joins the page only when there is one to draw; otherwise the page is byte for byte the page of before.
    const cmp = tx && (await cp.hasAny(ctx).catch(() => false));
    if (tx) pull = true;
    const duration = Math.min(60, Math.max(2, Number(ctx.setting("durationSeconds")) || 6));
    const kinds = ov && Object.hasOwn(OV_ONLY, q.get("opt-kinds") ?? "") ? q.get("opt-kinds") : "all";
    // Entrée / sortie : l'option de l'élément (si elle n'est pas « comme le module »), sinon le réglage. Tout en « auto » : le script d'avant, à l'identique (animation `alPop`).
    const tr = transitionConfig({ inOpt: ov ? q.get("opt-transitionIn") : null, inSetting: ctx.setting("transitionIn"), outOpt: ov ? q.get("opt-transitionOut") : null, outSetting: ctx.setting("transitionOut"), seconds: ctx.setting("transitionSeconds") }, 500);
    // Twitch activity: the look of each type (picture, sound, way of entering) comes from the configuration; sounds only if the person switched them on.
    const twcfg = tx ? await tw.loadConfig(ctx).catch(() => null) : null;
    const anyAnim = !!twcfg && Object.values(twcfg.types).some((x) => x.anim);
    const sounds = tx && alertOpts.get(ctx, "twitchSounds") === true;
    const audioOn = media || (sounds && !!twcfg && Object.values(twcfg.types).some((x) => x.audio));   // a sound file is only worth its code if a type has one
    const fx = tr.in !== "auto" || tr.out !== "auto" || anyAnim;
    const cfg = {
      ...(fx ? { tr } : {}),
      ...(ov ? {} : { eventsUrl: `/m/${ctx.instance.key}/events` }),
      duration,
      neon: ctx.setting("visual") !== "plain",
      labels: Object.fromEntries([...KINDS, ...(tx ? tw.TWITCH_KINDS.filter((k) => !KINDS.includes(k)) : []), ...(pull ? LIVE_KINDS : [])].map((k) => [k, ctx.t(`kind_${k}`)])),
      ...(tx ? { lang: ctx.locale, reportUrl: `/m/${ctx.instance.key}/tts-report` } : {}),
      ...(media ? { mvol: Math.min(100, Math.max(0, Math.trunc(Number(ctx.setting("soundVolume") ?? 50)) || 0)) } : {}),
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
      html: `<div id="al-stage"${ov ? ' data-ov-region="element"' : ""} style="${ov ? `${ovTokens(q)};` : ""}--al-accent:${accent};--al-bg:${t.surface};--al-fg:${t.fg}">${sample}</div>`,
      css: `
        html,body{margin:0;height:100%;background:transparent;overflow:hidden;font-family:system-ui,"Segoe UI",sans-serif}
        #al-stage{position:fixed;inset:0;display:flex;align-items:center;justify-content:center}
        ${S.card}{display:flex;flex-direction:column;align-items:center;gap:.5rem;padding:2rem 3rem;border-radius:${ov ? "var(--ov-radius,1.5rem)" : "1.5rem"};border:1px solid ${ov ? `var(--ov-border,${accentBorder})` : accentBorder};background:${ov ? `var(--ov-surface,${surface})` : surface};${ov ? "" : "backdrop-filter:blur(6px);"}text-align:center;${fx ? "" : "animation:alPop var(--al-dur) ease-in-out forwards"}}
${!ov || cfg.neon ? `        ${ov ? S.card : ".al-card.neon"}{box-shadow:0 0 28px color-mix(in srgb,var(--al-accent) 45%,transparent)}
` : ""}        ${S.kind}{font-size:1.6rem;font-weight:700;color:var(--al-accent)}
${!ov || cfg.neon ? `        ${ov ? `${S.card} ${S.kind}` : ".al-card.neon .al-kind"}{text-shadow:0 0 12px var(--al-accent)}
` : ""}        ${S.msg}{font-size:1.15rem;color:${ov ? "var(--ov-fg,var(--al-fg))" : "var(--al-fg)"}}
${withDetail ? `        ${S.detail}{font-size:1rem;color:${ov ? "var(--ov-fg,var(--al-fg))" : "var(--al-fg)"};opacity:.85;max-width:32rem;overflow-wrap:anywhere}
` : ""}${cmp ? `        .al-cmp{position:absolute;inset:0}
${ctx.overlay.composeCss()}
` : ""}${tx ? `        ${ov ? '[data-ov-part="image"]' : ".al-img"}{width:96px;height:96px;object-fit:cover;border-radius:${ov ? "var(--ov-radius,12px)" : "12px"}}
        ${ov ? '[data-ov-part="media"]' : ".al-media"}{display:block;max-width:calc(100vw - 8rem);max-height:calc(100vh - 8rem);object-fit:contain;border-radius:${ov ? "var(--ov-radius,12px)" : "12px"}}
` : ""}        @keyframes alPop{0%{opacity:0;transform:scale(.85)}10%{opacity:1;transform:scale(1)}90%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(.95)}}`,
      // Sans « Actions du live YouTube » : le script d'avant, à l'identique. Avec : une file (50 au plus, la plus vieille part la première) pour que plusieurs dons de suite
      // s'affichent l'un après l'autre au lieu de se remplacer ; les alertes poussées (push) remplacent toujours la carte à l'écran, comme avant.
      script: (cmp ? ctx.overlay.composeScript() + "\n" : "") + (queued ? `(function(){var c=${json},stage=document.getElementById("al-stage"),timer,q=[],busy=false;
        stage.style.setProperty("--al-dur",c.duration+"s");${fxScript}${sounds || media ? SOUND_SCRIPT : ""}${audioOn ? AUDIO_SCRIPT : ""}${tx ? VOICE_SCRIPT : ""}
        function draw(e){${node("card", "card", "al-card", `+(c.neon?" neon":"")`)}${tx ? ANIM_SCRIPT(fx) : ""}${sounds || media ? "if(e.sound)beep(e.sound,e.own);" : ""}${audioOn ? "playFile(e);" : ""}${media ? SOUND_ONLY : ""}${tx ? "speak(e);" : ""}
          ${tx ? `${cmp ? COMPOSE_DRAW : ""}if(e.present==="media"&&(e.video||e.image)){${MEDIA_SCRIPT(ov)}}else{${PICTURE_SCRIPT(ov)}` : ""}${node("k", "kind", "al-kind")}k.textContent=${tx ? "e.title||" : ""}c.labels[e.kind]||c.labels.alert;
          ${node("m", "message", "al-msg")}m.textContent=e.message;card.append(k,m);
          if(e.detail){${node("d", "detail", "al-detail")}d.textContent=e.detail;card.append(d)}${tx ? "}" : ""}
          ${tx ? "var secs=e.duration||c.duration;" : ""}stage.replaceChildren(card);${cmp ? COMPOSE_MOUNT : ""}${fx ? `fx(card,"in");hold(card,done${tx ? ",secs" : ""})` : `clearTimeout(timer);timer=setTimeout(done,${tx ? "secs" : "c.duration"}*1000)`}}
        ${tx ? `function done(){if(typeof stopFile==='function')stopFile();shownCard=null;${cmp ? COMPOSE_DONE : ""}stage.replaceChildren();if(c.between>0){setTimeout(function(){busy=false;next()},c.between)}else{busy=false;next()}}` : "function done(){stage.replaceChildren();busy=false;next()}"}
        ${cmp ? NEXT_AHEAD : "function next(){if(busy)return;var e=q.shift();if(e){busy=true;draw(e)}}"}
        ${tx ? `function show(e){if(e.control==="clear"){q=[];clearTimeout(timer);${audioOn ? "if(typeof stopFile==='function')stopFile();" : ""}stage.replaceChildren();busy=false;return}if(e.queued!==false){` : "function show(e){if(e.queued){"}if(q.length>=c.queueMax)q.shift();q.push(e);next()}else{busy=true;draw(e)}}
${ov ? `        var cur="now",gap=c.feedMs;function poll(){fetch(c.feedUrl+"?after="+encodeURIComponent(cur)+(c.feedPull?"&pull=1":"")${tx ? '+"&ctl=1"' : ""},{cache:"no-store"}).then(function(r){if(!r.ok)throw 0;return r.json()}).then(function(d){cur=d.cursor;gap=c.feedMs;${tx ? "applyCtl(d.ctl);" : ""}d.events.forEach(function(e){if(${tx ? "e.control||" : ""}!c.only||c.only.indexOf(e.kind)>=0)show(e)})}).catch(function(){gap=15000}).then(function(){setTimeout(poll,gap)})}
        poll()})();` : `        var es=new EventSource(c.eventsUrl);es.onmessage=function(ev){try{show(JSON.parse(ev.data))}catch(e){}};
        var gap=c.pullMs;${tx ? `function pull(){fetch(c.pullUrl+"?ctl=1",{cache:"no-store"}).then(function(r){gap=r.ok?c.pullMs:30000;return r.ok?r.json():null},function(){gap=30000;return null}).then(function(d){if(d)applyCtl(d.ctl)},function(){}).then(function(){setTimeout(pull,gap)})}` : `function pull(){fetch(c.pullUrl,{cache:"no-store"}).then(function(r){gap=r.ok?c.pullMs:30000},function(){gap=30000}).then(function(){setTimeout(pull,gap)})}`}
        setTimeout(pull,1000)})();`}` : `(function(){var c=${json},stage=document.getElementById("al-stage"),timer;
        stage.style.setProperty("--al-dur",c.duration+"s");${fxScript}
        function show(e){var card=document.createElement("div");card.className="al-card"+(c.neon?" neon":"");
          var k=document.createElement("div");k.className="al-kind";k.textContent=c.labels[e.kind]||c.labels.alert;
          var m=document.createElement("div");m.className="al-msg";m.textContent=e.message;card.append(k,m);
          stage.replaceChildren(card);${fx ? "fx(card,\"in\");hold(card,function(){stage.replaceChildren()})" : "clearTimeout(timer);timer=setTimeout(function(){stage.replaceChildren()},c.duration*1000)"}}
        var es=new EventSource(c.eventsUrl);es.onmessage=function(ev){try{show(JSON.parse(ev.data))}catch(e){}}})();`),
    };
  },

  async adminPanel(ctx, { query } = {}) {
    const base = `${ctx.api.siteUrl}/m/${ctx.instance.key}/push`;
    const hasToken = !!String(ctx.setting("pushToken") ?? "").trim();
    await alertOpts.load(ctx);
    // (1.18.0) The Twitch part: the listening's blocks on the copy that listens; the overlay's own editor elsewhere on a Twitch site; nothing without Twitch.
    let m = await home.mode(ctx);
    const waiting = m === "waiting" ? await waitingBlocks(ctx) : null;
    if (m === "waiting" && !waiting) m = await home.mode(ctx);
    else if (m === "on") await home.takeOver(ctx).catch(() => null);   // (1.18.1) the copy of the journal again, at once when the page opens
    const shown = await home.twitchShown(ctx, m);
    const ev = m === "on" ? await evAdmin.panel(ctx, { query: query ?? {} }) : [];
    return [
      ...(waiting ?? []),
      ...ev,
      ...(m === "guest" && shown ? await guestBlocks(ctx) : []),
      { type: "heading", text: ctx.t("adminTitle") },
      { type: "markdown", text: ctx.t("adminHelp") },
      { type: "copy", label: "POST", text: `curl -X POST ${base} -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d '{"kind":"follow","message":"Alex","username":"alex"}'` },
      ...(hasToken ? [] : [{ type: "markdown", text: ctx.t("noToken") }]),
      { type: "adminForm", action: "test", title: ctx.t("testTitle"), submitLabel: ctx.t("testSubmit"), fields: [] },
      ...(await youtubeBlocks(ctx)),
      // the queue (first tab, after the push address, as before) and the Twitch events tab of the overlay
      ...(await adminTw.panel(ctx, { query: query ?? {}, twitch: m === "on" ? "events" : shown ? "editor" : "none" })),
      ...(await adminMd.blocks(ctx, { query: query ?? {} })),
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
    // The media library for the other modules (the Twitch bot): `list` gives the files by name, `show` puts one on screen through the same queue as the alerts.
    "alerts.show": {
      list: async (ctx) => ({ items: (await md.list(ctx)).map(({ id, name, kind, builtin }) => ({ id, name, kind, ...(builtin ? { builtin: true } : {}) })) }),
      // version 2: the address of each uploaded picture or video (for a gallery that picks "from the site"); `list` still gives no address
      files: async (ctx) => ({ items: (await md.list(ctx, { tones: false })).filter((m) => m.url && m.kind !== "sound" && !m.id.startsWith("video:")).map(({ id, name, kind, url }) => ({ id, name, kind, url })) }),
      show: (ctx, input) => md.show(ctx, input, (a) => emit(ctx.instance.key, a)),
      // version 2: files just sent in the window of another module are kept HERE and named (listed in `callerRights`: the person is carried, core 0.14.0)
      add: (ctx, input) => md.addMany(ctx, input?.items),
      // version 3 (1.16.0): the text placed on the files of a caller's command ("Place the text" in the bot's window). `show` takes `place`, `vars`, `text`.
      // `place` → { compositions: { [src]: composition } }; `prefix` (the caller's instance key) → { places: { "<kind>:<id>": { [src]: composition } } }, one read for a whole window
      compositions: async (ctx, input) => {
        const out = { compose: cp.available(ctx), video: cp.videoReady(ctx) };
        if (!cp.available(ctx)) return { ...out, compositions: {}, places: {} };
        const prefix = String(input?.prefix ?? "");
        if (/^[a-z0-9-]{1,40}$/.test(prefix)) {
          const places = {};
          for (const [k, c] of await cp.allByKey(ctx)) {
            const [place, src] = k.split("|");
            if (!place.startsWith(`show:${prefix}:`)) continue;
            const key = place.slice(`show:${prefix}:`.length);
            (places[key] ??= {})[src] = c;
          }
          return { ...out, places };
        }
        const decl = cp.readPlace({ place: input?.place });
        return { ...out, compositions: decl ? await cp.forPlace(ctx, decl.place) : {} };
      },
      place: (ctx, input) => placeOfCaller(ctx, input),
      forget: async (ctx, input) => { const decl = cp.readPlace({ place: input?.place }); if (!decl) return { ok: false, code: "place" }; await cp.forgetPlace(ctx, decl.place); return { ok: true }; },
    },
    // (1.18.0, formerly Twitch activity) The journal of Twitch events: marks a line whose viewer text was hidden or held. Kept for the modules that use it.
    "twitch.journal": { flag: (ctx, input) => evFlag.mark(ctx, input) },
  },
  mcp: allWithOptions({ ...adminTw.tools((key, a) => emit(key, a)), ...rxMcp.tools((key, a) => emit(key, a)), ...cpMcp.tools(), ...evTools }),

  adminActions: allWithOptions({
    ...evAdmin.actions,
    ...adminTw.actions(emit),
    ...adminMd.actions(emit),
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
  }),
};
// (1.18.0) What the Twitch part needs of the overlay, given once (no import back): how to show an alert, and how a test alert is built.
home.wire({ emit, sample: (ctx, id, now, cfg, extra) => adminTw.sampleAlert(ctx, id, now, cfg, extra) });
