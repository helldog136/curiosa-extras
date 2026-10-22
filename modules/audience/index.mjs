// Participation — module de Curiosa (service « audience.session »).
//
// La base commune des modules « interaction en stream » (Sondages, plus tard Quiz, Bingo, Tombola…). Elle possède :
//   • l'IDENTITÉ ANONYME d'un participant : un code au hasard gardé par le navigateur (stockage local, jamais un cookie) ; le site n'en garde qu'une empreinte propre à chaque salle ;
//   • le PSEUDO (unique par salle, mots interdits modifiables, sourdine) ;
//   • les LIMITES : débit, une voix par participant et par salle (sans jamais garder d'adresse IP en clair) ;
//   • la TÉLÉCOMMANDE de la streameuse (page secrète, grands boutons), alimentée par les modules branchés (service « audience.remote ») ;
//   • le DIRECT : un point de lecture borné pour les overlays et les pages publiques (interrogation douce et ralentissante) ;
//   • un JOURNAL d'audit minimal et la PURGE à la lecture.
// Les votes, eux, restent chez Sondages : un propriétaire par donnée. Voir README.md et docs/ideas/audience.md.
import { randomBytes } from "node:crypto";

const V = new URL(import.meta.url).search;   // le cœur recharge index.mjs avec ?v=… : les fichiers voisins suivent
const L = await import(`./lib.mjs${V}`);
const K = await import(`./core.mjs${V}`);
const C = await import(`./client.mjs${V}`);
const R = await import(`./remote.mjs${V}`);
const { esc, clean, num, LIMITS } = L;
const { HOUR } = K;

const SERVICE_VERSION = 1;
const SCOPE_RE = /^[a-z0-9][a-z0-9:._-]{0,39}$/;

const can = (ctx, right) => (typeof ctx.can === "function" ? !!ctx.can(right) : true);   // l'action elle-même est déjà protégée par le cœur : ici on ne fait que cacher ce qu'on ne peut pas utiliser
const strict = (ctx, right) => typeof ctx.can === "function" && !!ctx.can(right);        // service appelé par un autre module : jamais de droit d'office
const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
const notAllowed = (allow) => new Response("Method not allowed", { status: 405, headers: { Allow: allow } });
const KEEP = (e) => { console.error("[audience]", e?.message ?? "error"); };

/** Lit un corps JSON borné. Renvoie { body } ou { response }. */
async function readJson(request, max) {
  const raw = await request.text();
  if (raw.length > max) return { response: json({ ok: false, error: "invalid" }, 413) };
  try { const body = JSON.parse(raw); return L.isObj(body) ? { body } : { response: json({ ok: false, error: "invalid" }, 400) }; } catch { return { response: json({ ok: false, error: "invalid" }, 400) }; }
}

/* ───────────── Le service « audience.session » (version 1) ───────────── */

const bad = (error, extra = {}) => ({ ok: false, error, ...extra });
/** Toute méthode : ne lève jamais, répond { ok: true, … } ou { ok: false, error }. */
const safe = (fn) => async (ctx, args) => {
  try { return await fn(ctx, L.isObj(args) ? args : {}); } catch (e) { KEEP(e); return bad("busy"); }
};

async function roomFor(ctx, a, { create = false } = {}) {
  if (!L.roomOk(a.room)) return { error: "invalid" };
  if (create) {
    const r = await K.ensureRoom(ctx, a.room, a.label);
    return r.error ? { error: r.error } : { room: r };
  }
  const room = await K.getRoom(ctx, a.room);
  return room ? { room } : { error: "unknown_room" };
}

const limited = (ctx, a, rules, now = Date.now()) => {
  const f = K.fp(a.conn, now);
  for (const [bucket, max, win] of rules(f)) { const h = K.over(bucket, max, win, now); if (h.over) return bad("limit", { retryAfter: h.retryAfter }); }
  return null;
};

const services = {
  "audience.session": {
    info: safe(async (ctx) => ({ ok: true, version: SERVICE_VERSION, base: `/m/${ctx.instance.key}`, limits: { pseudoMin: K.cfgOf(ctx).min, pseudoMax: K.cfgOf(ctx).max, participants: LIMITS.participants, rooms: LIMITS.rooms, liveBytes: LIMITS.liveBytes }, remote: true })),

    join: safe(async (ctx, a) => {
      if (!L.tokenOk(a.token)) return bad("invalid");
      const cfg = K.cfgOf(ctx), now = Date.now();
      const rr = await roomFor(ctx, a, { create: true });
      if (rr.error) return bad(rr.error);
      const existing = await K.findParticipant(ctx, rr.room, a.token);
      if (!existing) {
        const lim = limited(ctx, a, (f) => [[`join|${f}`, cfg.joinsPerHour, HOUR]], now);
        if (lim) return lim;
      }
      const j = await K.joinRoom(ctx, rr.room, a.token, now);
      if (j.error) return bad(j.error);
      let participant = j.participant;
      if (a.pseudo !== undefined && a.pseudo !== null && a.pseudo !== "") {
        if (participant.muted) return bad("muted");
        const v = L.validatePseudo(a.pseudo, { min: cfg.min, max: cfg.max, banned: cfg.banned });
        if (!v.ok) return bad(v.code);
        const lim = limited(ctx, a, () => [[`pseudo|${rr.room.k}|${participant.id}`, 8, HOUR]], now);
        if (lim) return lim;
        const p = await K.choosePseudo(ctx, rr.room, a.token, a.pseudo, cfg, now);
        if (p.error) return bad(p.error);
        participant = p.participant;
      }
      return { ok: true, participant: { ...participant, isNew: j.isNew }, room: { key: rr.room.k, count: (await K.getRoom(ctx, rr.room.k))?.count ?? 0 } };
    }),

    who: safe(async (ctx, a) => {
      if (!L.tokenOk(a.token)) return bad("invalid");
      const rr = await roomFor(ctx, a);
      if (rr.error) return bad(rr.error);
      const rec = await K.findParticipant(ctx, rr.room, a.token);
      return { ok: true, participant: rec ? { id: rec.data.k, pseudo: rec.data.pseudo ?? null, muted: rec.data.muted === true } : null };
    }),

    setPseudo: safe(async (ctx, a) => {
      if (!L.tokenOk(a.token) || typeof a.pseudo !== "string") return bad("invalid");
      const rr = await roomFor(ctx, a);
      if (rr.error) return bad(rr.error);
      const rec = await K.findParticipant(ctx, rr.room, a.token);
      if (!rec) return bad("unknown_participant");
      const cfg = K.cfgOf(ctx);
      const v = L.validatePseudo(a.pseudo, { min: cfg.min, max: cfg.max, banned: cfg.banned });
      if (!v.ok) return bad(v.code);   // un pseudo refusé ne compte pas dans la limite : seules les vraies tentatives d'écriture comptent
      const lim = limited(ctx, a, () => [[`pseudo|${rr.room.k}|${rec.data.k}`, 8, HOUR]]);
      if (lim) return lim;
      const p = await K.choosePseudo(ctx, rr.room, a.token, a.pseudo, cfg);
      return p.error ? bad(p.error) : { ok: true, participant: p.participant };
    }),

    checkPseudo: safe(async (ctx, a) => {
      if (typeof a.pseudo !== "string") return bad("invalid");
      const cfg = K.cfgOf(ctx);
      const v = L.validatePseudo(a.pseudo, { min: cfg.min, max: cfg.max, banned: cfg.banned });
      if (!v.ok) return { ok: true, valid: false, code: v.code };
      if (a.room !== undefined) {
        const rr = await roomFor(ctx, a);
        if (rr.error) return bad(rr.error);
        const taken = await K.byKey(ctx, `p-${rr.room.id}-${rr.room.gen || 0}`, `n:${v.key}`);
        if (taken) return { ok: true, valid: false, code: "pseudo_taken" };
      }
      return { ok: true, valid: true, value: v.value };
    }),

    claim: safe(async (ctx, a) => {
      if (!L.tokenOk(a.token) || typeof a.key !== "string" || !L.CLAIM_RE.test(a.key)) return bad("invalid");
      const rr = await roomFor(ctx, a);
      if (rr.error) return bad(rr.error);
      const r = await K.claim(ctx, rr.room, a.token, a.key);
      return r.error ? bad(r.error) : { ok: true, first: true };
    }),

    release: safe(async (ctx, a) => {
      if (!L.tokenOk(a.token) || typeof a.key !== "string" || !L.CLAIM_RE.test(a.key)) return bad("invalid");
      const rr = await roomFor(ctx, a);
      if (rr.error) return bad(rr.error);
      return { ok: true, ...(await K.release(ctx, rr.room, a.token, a.key)) };
    }),

    limit: safe(async (ctx, a) => {
      if (!L.roomOk(a.room) || typeof a.scope !== "string" || !SCOPE_RE.test(a.scope)) return bad("invalid");
      const max = Number(a.max), per = Number(a.per);
      if (!Number.isInteger(max) || max < 1 || max > 10000 || !Number.isInteger(per) || per < 1 || per > 86400) return bad("invalid");
      const now = Date.now(), f = K.fp(a.conn, now);
      const buckets = [`lim|${a.room}|${a.scope}|${f}`];
      if (a.token !== undefined) { if (!L.tokenOk(a.token)) return bad("invalid"); buckets.push(`lim|${a.room}|${a.scope}|t:${L.keyHash(a.token)}`); }
      let remaining = max, retry = 0;
      for (const b of buckets) { const h = K.over(b, max, per * 1000, now); remaining = Math.min(remaining, h.remaining); retry = Math.max(retry, h.retryAfter); }
      return retry > 0 ? bad("limit", { retryAfter: retry }) : { ok: true, remaining };
    }),

    mute: safe(async (ctx, a) => {
      if (!strict(ctx, "moderate")) return bad("denied");
      if ((typeof a.id !== "string" && typeof a.pseudo !== "string") || typeof a.muted !== "boolean") return bad("invalid");
      const rr = await roomFor(ctx, a);
      if (rr.error) return bad(rr.error);
      const r = await K.setMuted(ctx, rr.room, { id: a.id, pseudo: a.pseudo }, a.muted);
      if (r.error) return bad(r.error);
      await K.journal(ctx, { who: "admin", what: a.muted ? "mute" : "unmute", room: rr.room.k, detail: r.participant.pseudo || "-" });
      return { ok: true, participant: r.participant };
    }),

    clearRoom: safe(async (ctx, a) => {
      if (!strict(ctx, "moderate")) return bad("denied");
      if (!L.roomOk(a.room)) return bad("invalid");
      const r = await K.clearRoom(ctx, a.room);
      if (!r.ok) return bad(r.error);
      await K.journal(ctx, { who: "admin", what: "clearRoom", room: a.room, detail: `${r.removed}` });
      return { ok: true, removed: r.removed };
    }),

    forget: safe(async (ctx, a) => {
      if (!L.tokenOk(a.token)) return bad("invalid");
      return { ok: true, removed: await K.forgetEverywhere(ctx, a.token) };
    }),

    journal: safe(async (ctx, a) => {
      const what = clean(a.what, 60);
      if (!what) return bad("invalid");
      if (a.room !== undefined && !L.roomOk(a.room)) return bad("invalid");
      await K.journal(ctx, { who: clean(a.who, 40) || "module", what, room: a.room, detail: a.detail });
      return { ok: true };
    }),

    livePublish: safe(async (ctx, a) => {
      if (!L.roomOk(a.room) || typeof a.channel !== "string" || !L.CHANNEL_RE.test(a.channel) || a.data === undefined) return bad("invalid");
      if (a.readKey !== undefined && (typeof a.readKey !== "string" || a.readKey.length < 8 || a.readKey.length > 200)) return bad("invalid");
      const r = await K.publishLive(ctx, { room: a.room, channel: a.channel, data: a.data, public: a.public === true, readKey: a.readKey, refreshAt: a.refreshAt, ttlSec: a.ttlSec });
      return r.error ? bad(r.error) : { ok: true, rev: r.rev };
    }),

    liveRead: safe(async (ctx, a) => {
      if (!L.roomOk(a.room) || typeof a.channel !== "string" || !L.CHANNEL_RE.test(a.channel)) return bad("invalid");
      return { ok: true, ...(await K.readLive(ctx, { room: a.room, channel: a.channel, rev: a.rev, trusted: true })) };
    }),

    liveDrop: safe(async (ctx, a) => {
      if (!L.roomOk(a.room) || typeof a.channel !== "string" || !L.CHANNEL_RE.test(a.channel)) return bad("invalid");
      return { ok: true, ...(await K.dropLive(ctx, a.room, a.channel)) };
    }),

    directClient: safe(async () => ({ ok: true, js: C.DIRECT_JS, rev: C.CLIENT_REV })),
  },
};

/* ───────────── Pages publiques ───────────── */

const CSS = `.au{box-sizing:border-box;border:1px solid var(--v-line);background:var(--v-surface);color:var(--v-fg);border-radius:16px;padding:16px;display:grid;gap:14px;max-width:40rem;margin:0 auto}
.au *{box-sizing:border-box}.au h2{margin:0;font-size:1.25rem}.au p{margin:0}.au-muted{color:var(--v-muted);font-size:.95rem}
.au label{font-weight:600;display:block;margin-bottom:6px}.au-in{width:100%;min-height:48px;border-radius:12px;border:2px solid var(--v-line);background:var(--v-bg);color:var(--v-fg);font:inherit;padding:8px 12px}
.au-in[aria-invalid=true]{border-color:var(--v-danger)}.au-in:focus-visible,.au-btn:focus-visible{outline:3px solid var(--v-fg);outline-offset:2px}
.au-btn{min-height:48px;padding:0 22px;border-radius:999px;border:0;background:var(--v-accent);color:var(--v-accent-fg);font:inherit;font-weight:700;cursor:pointer;justify-self:start}
.au-btn.alt{background:transparent;color:var(--v-fg);border:2px solid var(--v-line)}.au-btn:disabled{opacity:.6;cursor:wait}
.au-err{color:var(--v-danger);font-weight:600;margin-top:6px}.au-ok{font-weight:600}.au-hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.au-cur{font-weight:600;overflow-wrap:anywhere}`;

const MESSAGE_CODES = ["saved", "forgotten", "net", "limit", "busy", "invalid", "unknown_room", "room_full", "muted", "pseudo_short", "pseudo_long", "pseudo_chars", "pseudo_banned", "pseudo_taken", "unknown_participant"];

function pseudoBox(ctx, roomKey) {
  const cfg = K.cfgOf(ctx);
  const attrs = MESSAGE_CODES.map((c) => `data-m-${c}="${esc(ctx.t(`pm_${c}`, { min: cfg.min, max: cfg.max }))}"`).join(" ") + ` data-m-busy="${esc(ctx.t("sending"))}"`;
  return `<style>${CSS}</style><section class="au" data-aud data-room="${esc(roomKey)}" data-api="/m/${esc(ctx.instance.key)}" data-lang="${esc(ctx.locale)}" ${attrs}>` +
    `<h2>${esc(ctx.t("pageTitle"))}</h2><p>${esc(ctx.t("pageIntro"))}</p>` +
    `<p class="au-cur" data-aud-current hidden>${esc(ctx.t("currentPseudo"))} <span data-aud-who></span></p>` +
    `<form data-aud-form novalidate><label for="au-name">${esc(ctx.t("pseudoLabel"))}</label>` +
    `<input class="au-in" id="au-name" name="name" data-aud-name type="text" maxlength="${cfg.max + 10}" autocomplete="nickname" autocapitalize="off" spellcheck="false" aria-describedby="au-help au-err">` +
    `<p class="au-muted" id="au-help">${esc(ctx.t("pseudoHelp", { min: cfg.min, max: cfg.max }))}</p><p class="au-err" id="au-err" data-aud-err role="alert" hidden></p>` +
    `<div class="au-hp" aria-hidden="true"><label>Website<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>` +
    `<p style="margin-top:12px"><button class="au-btn" type="submit">${esc(ctx.t("pseudoSave"))}</button></p><p class="au-ok" data-aud-ok role="status" hidden></p></form>` +
    `<noscript><p class="au-muted">${esc(ctx.t("needScript"))}</p></noscript>` +
    `<hr style="border:0;border-top:1px solid var(--v-line);width:100%"><h2 style="font-size:1.05rem">${esc(ctx.t("forgetTitle"))}</h2><p class="au-muted">${esc(ctx.t("forgetText"))}</p>` +
    `<p><button class="au-btn alt" type="button" data-aud-forget>${esc(ctx.t("forgetBtn"))}</button></p></section>`;
}

/* ───────────── Administration ───────────── */

const stamp = (ctx, iso) => { try { return new Intl.DateTimeFormat(ctx.locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)); } catch { return String(iso ?? ""); } };
const personsText = (ctx, n) => ctx.t(n === 1 ? "persons_one" : "persons_many", { n });
const needs = (right, fn) => async (ctx, values) => (can(ctx, right) ? fn(ctx, values) : { error: ctx.t("errRight") });

const remoteUrl = (ctx, meta) => `${ctx.api.siteUrl}/m/${ctx.instance.key}/remote?k=${meta.remoteKey}`;

/* ───────────── Le module ───────────── */

export default {
  services,

  slots: {
    "layout.head": (ctx) => [{ type: "head", tags: [{ tag: "script", src: `/m/${ctx.instance.key}/client?v=${C.CLIENT_REV}`, defer: true }] }],
  },

  async page(ctx, { segments }) {
    if (segments.length) return { notFound: true, blocks: [] };
    await K.ensureRoom(ctx, K.GENERAL, ctx.t("generalRoom")).catch(() => {});
    return { title: ctx.t("pageTitle"), description: ctx.t("pageDescription"), blocks: [{ type: "html", html: pseudoBox(ctx, K.GENERAL) }] };
  },

  routes: {
    client(request) {
      if (request.method !== "GET") return notAllowed("GET");
      return new Response(C.CLIENT_JS, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff" } });
    },

    "direct.js"(request) {
      if (request.method !== "GET") return notAllowed("GET");
      return new Response(C.DIRECT_JS, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff" } });
    },

    // Le point de lecture du direct : public pour un canal public, sinon il faut la clé donnée par le module qui l'alimente. Léger, limité, jamais de secret dans la réponse.
    async direct(request, ctx) {
      if (request.method !== "GET") return notAllowed("GET");
      const url = new URL(request.url), now = Date.now();
      const room = url.searchParams.get("room") ?? "", channel = url.searchParams.get("channel") ?? "";
      if (!L.roomOk(room) || !L.CHANNEL_RE.test(channel)) return json({ ok: false, error: "invalid" }, 400);
      const cfg = K.cfgOf(ctx), f = K.fp(K.connOf(request), now);
      if (K.over(`d|${f}`, 90, 60_000, now).over || K.over(`dg|${ctx.instance.key}`, 3000, 60_000, now).over) return json({ ok: false, error: "limit" }, 429, { "retry-after": "30" });
      // plus il y a de lecteurs, plus on demande d'espacer les visites
      K.mem.reads = K.mem.reads.filter((t) => now - t < 60_000); K.mem.reads.push(now);
      const next = Math.min(30_000, cfg.directMin + Math.floor(K.mem.reads.length / 100) * 2000);
      const args = { room, channel, rev: url.searchParams.get("rev") ?? "", key: url.searchParams.get("k") ?? undefined };
      let r = await K.readLive(ctx, args, now);
      if (r.due) {
        await R.tickProviders(ctx, room, channel, now);
        r = await K.readLive(ctx, args, Date.now());
      }
      if (r.empty) return json({ ok: true, empty: true, next });
      if (r.unchanged) return json({ ok: true, unchanged: true, rev: r.rev, next });
      return json({ ok: true, rev: r.rev, data: r.data, at: r.at, next });
    },

    async me(request, ctx) {
      if (request.method !== "POST") return notAllowed("POST");
      const got = await readJson(request, 1000);
      if (got.response) return got.response;
      const b = got.body, now = Date.now();
      if (K.over(`me|${K.fp(K.connOf(request), now)}`, 240, HOUR, now).over) return json({ ok: false, error: "limit" }, 429, { "retry-after": "60" });
      if (!L.roomOk(b.room) || !L.tokenOk(b.t)) return json({ ok: false, error: "invalid" }, 400);
      const room = await K.getRoom(ctx, b.room);
      const rec = room ? await K.findParticipant(ctx, room, b.t) : null;
      return json({ ok: true, participant: rec ? { pseudo: rec.data.pseudo ?? null, muted: rec.data.muted === true } : null });
    },

    async pseudo(request, ctx) {
      if (request.method !== "POST") return notAllowed("POST");
      const got = await readJson(request, 1000);
      if (got.response) return got.response;
      const b = got.body, now = Date.now();
      if (String(b.website ?? "")) return json({ ok: true, participant: { pseudo: null, muted: false } });   // piège à robots : on fait semblant
      const conn = K.connOf(request);
      if (K.over(`ps|${K.fp(conn, now)}`, 30, HOUR, now).over || K.over(`psg|${ctx.instance.key}`, 300, 60_000, now).over) return json({ ok: false, error: "limit" }, 429, { "retry-after": "60" });
      if (!L.roomOk(b.room) || !L.tokenOk(b.t) || typeof b.name !== "string") return json({ ok: false, error: "invalid" }, 400);
      let room = await K.getRoom(ctx, b.room);
      if (!room && b.room === K.GENERAL) { const r = await K.ensureRoom(ctx, K.GENERAL, ctx.t("generalRoom")); room = r.error ? null : r; }
      if (!room) return json({ ok: false, error: "unknown_room" }, 404);
      const r = await services["audience.session"].join(ctx, { room: room.k, token: b.t, conn, pseudo: b.name });
      if (!r.ok) return json({ ok: false, error: r.error }, r.error === "pseudo_taken" ? 409 : r.error === "limit" ? 429 : r.error === "room_full" || r.error === "busy" ? 503 : r.error === "muted" ? 403 : 400);
      return json({ ok: true, participant: { pseudo: r.participant.pseudo, muted: r.participant.muted } });
    },

    async forget(request, ctx) {
      if (request.method !== "POST") return notAllowed("POST");
      const got = await readJson(request, 500);
      if (got.response) return got.response;
      const now = Date.now();
      if (K.over(`fg|${K.fp(K.connOf(request), now)}`, 10, HOUR, now).over) return json({ ok: false, error: "limit" }, 429, { "retry-after": "60" });
      if (!L.tokenOk(got.body.t)) return json({ ok: false, error: "invalid" }, 400);
      return json({ ok: true, removed: await K.forgetEverywhere(ctx, got.body.t) });
    },

    // ── La télécommande : page, état, appuis. L'adresse secrète est le seul accès ; sans elle, ces routes font comme si elles n'existaient pas. ──
    async remote(request, ctx) {
      if (request.method !== "GET") return notAllowed("GET");
      const meta = await K.ensureMeta(ctx);
      const url = new URL(request.url), now = Date.now();
      if (!L.sameSecret(url.searchParams.get("k"), meta.remoteKey)) {
        if (K.over(`rk|${K.fp(K.connOf(request), now)}`, 40, HOUR, now).over) return new Response("Too many requests", { status: 429, headers: { "retry-after": "300" } });
        return new Response("Not found", { status: 404 });
      }
      return new Response(R.remoteHtml(ctx, meta.remoteKey, C.REMOTE_JS), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow", "x-content-type-options": "nosniff" } });
    },

    async "remote-state"(request, ctx) {
      if (request.method !== "GET") return notAllowed("GET");
      const meta = await K.ensureMeta(ctx);
      const url = new URL(request.url), now = Date.now();
      if (!L.sameSecret(url.searchParams.get("k"), meta.remoteKey)) {
        if (K.over(`rk|${K.fp(K.connOf(request), now)}`, 40, HOUR, now).over) return json({ ok: false }, 429, { "retry-after": "300" });
        return new Response("Not found", { status: 404 });
      }
      if (K.over(`rs|${ctx.instance.key}`, 120, 60_000, now).over) return json({ ok: false, error: "limit" }, 429, { "retry-after": "10" });
      K.sweep(ctx, now).catch(KEEP);
      return json(await R.remoteState(ctx, now));
    },

    async "remote-press"(request, ctx) {
      if (request.method !== "POST") return notAllowed("POST");
      const meta = await K.ensureMeta(ctx);
      const got = await readJson(request, 2000);
      if (got.response) return got.response;
      const b = got.body, now = Date.now();
      if (!L.sameSecret(b.k, meta.remoteKey)) {
        if (K.over(`rk|${K.fp(K.connOf(request), now)}`, 40, HOUR, now).over) return json({ ok: false }, 429, { "retry-after": "300" });
        return new Response("Not found", { status: 404 });
      }
      if (K.over(`rp|${ctx.instance.key}`, 60, 60_000, now).over) return json({ ok: false, error: "limit", message: ctx.t("remoteErrLimit") }, 429, { "retry-after": "10" });
      if (typeof b.panel !== "string" || b.panel.length > 80) return json({ ok: false, error: "invalid" }, 400);
      const r = await R.pressPanel(ctx, { panel: b.panel, action: b.action, values: b.values });
      return json(r, r.ok ? 200 : r.error === "gone" ? 404 : 400);
    },
  },

  async adminPanel(ctx, { query }) {
    const now = Date.now();
    await K.sweep(ctx, now).catch(KEEP);
    const meta = await K.ensureMeta(ctx);
    const blocks = [];

    // ── Onglet « En direct » : la télécommande ──
    blocks.push({ type: "heading", text: ctx.t("liveTitle") }, { type: "markdown", text: ctx.t("liveIntro") });
    if (can(ctx, "remote.use")) {
      const addr = remoteUrl(ctx, meta);
      const qr = await ctx.api.qr(addr).catch(() => "");
      blocks.push(
        { type: "copy", label: ctx.t("remoteAddress"), text: addr },
        { type: "markdown", text: `[${ctx.t("remoteOpen")}](${addr})` },
        ...(qr ? [{ type: "html", html: `<div style="max-width:200px;background:#fff;padding:10px;border-radius:12px" role="img" aria-label="${esc(ctx.t("qrAlt"))}">${qr}</div>` }] : []),
        { type: "markdown", text: ctx.t("remoteSecret") },
        { type: "adminForm", action: "regenerate", title: ctx.t("regenTitle"), submitLabel: ctx.t("regenBtn"), fields: [{ name: "confirm", kind: "checkbox", label: ctx.t("regenConfirm"), help: ctx.t("regenHelp") }] },
      );
    } else blocks.push({ type: "markdown", text: ctx.t("remoteNoRight") });
    const panels = await R.collectPanels(ctx);
    blocks.push({ type: "heading", text: ctx.t("pluggedTitle") });
    blocks.push(panels.length
      ? { type: "markdown", text: panels.map((p) => `- ${p.title.replace(/[\[\]\\*_`]/g, "")}`).join("\n") }
      : { type: "markdown", text: ctx.t("pluggedNone") });
    if (!panels.length) blocks.push({ type: "suggestInstall", service: "audience.remote", reason: ctx.t("suggestReason") });
    blocks.push({ type: "heading", text: ctx.t("limitsTitle") }, { type: "markdown", text: ctx.t("limitsText", { days: K.cfgOf(ctx).days }) });

    // ── Onglet « Salles » : les salles, les pseudos, le journal ──
    const tab = "people";
    if (!can(ctx, "moderate")) return [...blocks, { type: "markdown", text: ctx.t("moderateNoRight"), tab }];
    const roomId = typeof query?.room === "string" && query.room.length < 120 ? query.room : "";
    if (roomId) {
      const f = await ctx.api.store.get(roomId);
      const room = f && f.data?.salt ? K.roomOf(f) : null;
      if (!room) blocks.push({ type: "banner", tone: "warning", text: ctx.t("errGone"), tab }, { type: "markdown", text: `[${ctx.t("back")}](?tab=people)`, tab });
      else {
        const cursor = typeof query?.c === "string" && query.c.length < 400 ? query.c : null;
        const page = await K.participantsPage(ctx, room, cursor, 50);
        blocks.push(
          { type: "markdown", text: `[${ctx.t("back")}](?tab=people)`, tab },
          { type: "heading", text: `${room.label} · ${personsText(ctx, room.count || 0)}`, tab },
          page.items.length
            ? { type: "table", tab, columns: [ctx.t("colPseudo"), ctx.t("colState"), ctx.t("colSeen")], rows: page.items.map((p) => [p.pseudo || ctx.t("anon"), p.muted ? ctx.t("stateMuted") : "—", p.last ? stamp(ctx, p.last) : "—"]), rowIds: page.items.map((p) => `${room.id}~${p.id}`),
              rowActions: [{ label: ctx.t("actMute"), action: "toggleMute" }, { label: ctx.t("actRemove"), action: "removePerson", confirm: ctx.t("confirmRemove"), danger: true }] }
            : { type: "markdown", text: ctx.t("noPeople"), tab },
          ...(page.next ? [{ type: "markdown", text: `[${ctx.t("nextPage")}](?tab=people&room=${encodeURIComponent(room.id)}&c=${encodeURIComponent(page.next)})`, tab }] : []),
        );
      }
    } else {
      const rooms = await K.listRooms(ctx);
      blocks.push({ type: "heading", text: ctx.t("roomsTitle"), tab }, { type: "markdown", text: ctx.t("roomsIntro"), tab });
      blocks.push(rooms.length
        ? { type: "table", tab, columns: [ctx.t("colRoom"), ctx.t("colPeople"), ctx.t("colActive")], rows: rooms.map((r) => [r.label, String(r.count || 0), stamp(ctx, r.lastAt)]), rowIds: rooms.map((r) => r.id),
            rowActions: [{ label: ctx.t("actSee"), href: "?tab=people&room={id}" }, { label: ctx.t("actClear"), action: "clearRoomAdmin", confirm: ctx.t("confirmClear"), danger: true }] }
        : { type: "markdown", text: ctx.t("noRooms"), tab });
    }
    const log = await ctx.api.store.page(K.AUDIT, { limit: 30 });
    blocks.push({ type: "heading", text: ctx.t("journalTitle"), tab }, { type: "markdown", text: ctx.t("journalIntro"), tab });
    blocks.push(log.items.length
      ? { type: "table", tab, columns: [ctx.t("colWhen"), ctx.t("colWho"), ctx.t("colWhat"), ctx.t("colDetail")], rows: log.items.map((r) => [stamp(ctx, r.data.at), r.data.who, r.data.what, [r.data.room, r.data.detail].filter(Boolean).join(" · ")]) }
      : { type: "markdown", text: ctx.t("journalEmpty"), tab });
    blocks.push({ type: "download", name: "journal", label: ctx.t("downloadJournal"), tab });
    return blocks;
  },

  adminActions: {
    regenerate: needs("remote.use", async (ctx, values) => {
      if (values.confirm !== "on") return { errors: { confirm: ctx.t("errConfirm") } };
      const meta = await K.ensureMeta(ctx);
      await K.saveMeta(ctx, { ...meta, remoteKey: randomBytes(18).toString("base64url") });
      await K.journal(ctx, { who: "admin", what: "remote.regenerate" });
      return { ok: ctx.t("okRegen") };
    }),

    toggleMute: needs("moderate", async (ctx, values) => {
      const [roomId, pid] = String(values.id ?? "").split("~");
      const f = roomId ? await ctx.api.store.get(roomId) : null;
      const room = f && f.data?.salt ? K.roomOf(f) : null;
      if (!room || !/^[0-9a-f]{40}$/.test(pid ?? "")) return { error: ctx.t("errGone") };
      const rec = await K.byKey(ctx, `p-${room.id}-${room.gen || 0}`, pid);
      if (!rec) return { error: ctx.t("errGone") };
      const muted = rec.data.muted !== true;
      await K.setMuted(ctx, room, { id: pid }, muted);
      await K.journal(ctx, { who: "admin", what: muted ? "mute" : "unmute", room: room.k, detail: rec.data.pseudo || "-" });
      K.mem.roomsView = null;
      return { ok: ctx.t(muted ? "okMuted" : "okUnmuted") };
    }),

    removePerson: needs("moderate", async (ctx, values) => {
      const [roomId, pid] = String(values.id ?? "").split("~");
      const f = roomId ? await ctx.api.store.get(roomId) : null;
      const room = f && f.data?.salt ? K.roomOf(f) : null;
      if (!room || !/^[0-9a-f]{40}$/.test(pid ?? "")) return { error: ctx.t("errGone") };
      await K.withLock(ctx, () => K.removeParticipant(ctx, room, pid));
      K.mem.roomsView = null;
      await K.journal(ctx, { who: "admin", what: "removePerson", room: room.k });
      return { ok: ctx.t("okRemoved") };
    }),

    clearRoomAdmin: needs("moderate", async (ctx, values) => {
      const f = values.id ? await ctx.api.store.get(String(values.id)) : null;
      if (!f || !f.data?.salt) return { error: ctx.t("errGone") };
      const r = await K.clearRoom(ctx, f.data.k);
      if (!r.ok) return { error: ctx.t("errGone") };
      K.mem.roomsView = null;
      await K.journal(ctx, { who: "admin", what: "clearRoom", room: f.data.k, detail: `${r.removed}` });
      return { ok: ctx.t("okCleared", { n: r.removed }) };
    }),
  },

  adminDownloads: {
    journal: {
      right: "moderate",
      contentType: "text/csv",
      filename: () => "journal",
      async *generate(ctx) {
        const cell = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
        yield `﻿${["date", "who", "what", "room", "detail"].map(cell).join(",")}\r\n`;
        let cursor = null;
        do {
          const page = await ctx.api.store.page(K.AUDIT, { limit: 500, cursor, order: "asc" });
          for (const r of page.items) yield `${[r.data.at, r.data.who, r.data.what, r.data.room ?? "", r.data.detail ?? ""].map(cell).join(",")}\r\n`;
          cursor = page.next;
        } while (cursor);
      },
    },
  },

  mcp: {
    async audience_rooms(ctx) {
      return (await K.listRooms(ctx)).slice(0, 100).map((r) => ({ room: r.k, label: r.label, participants: r.count || 0, lastActive: r.lastAt }));
    },
    async audience_journal(ctx, args) {
      const n = num(args?.limit, 30, 1, 100);
      return (await ctx.api.store.page(K.AUDIT, { limit: n })).items.map((r) => ({ at: r.data.at, who: r.data.who, what: r.data.what, room: r.data.room ?? null, detail: r.data.detail ?? "" }));
    },
    async audience_mute(ctx, args) {
      const room = L.roomOk(args?.room) ? await K.getRoom(ctx, args.room) : null;
      if (!room) throw Object.assign(new Error("room not found (see audience_rooms)"), { expose: true });
      const r = await K.setMuted(ctx, room, { pseudo: String(args?.pseudo ?? "") }, args?.muted !== false);
      if (r.error) throw Object.assign(new Error("nobody with this nickname in this room"), { expose: true });
      await K.journal(ctx, { who: "assistant", what: args?.muted === false ? "unmute" : "mute", room: room.k, detail: r.participant.pseudo || "-" });
      return { room: room.k, pseudo: r.participant.pseudo, muted: r.participant.muted };
    },
    async audience_clear_room(ctx, args) {
      const r = L.roomOk(args?.room) ? await K.clearRoom(ctx, args.room) : { ok: false };
      if (!r.ok) throw Object.assign(new Error("room not found (see audience_rooms)"), { expose: true });
      await K.journal(ctx, { who: "assistant", what: "clearRoom", room: args.room, detail: `${r.removed}` });
      return { room: args.room, cleared: true, participantsRemoved: r.removed };
    },
  },

  backup: {
    async readable(ctx) {
      const cell = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
      const rooms = (await K.listRooms(ctx)).map((r) => [r.k, r.label, r.count || 0, r.createdAt, r.lastAt].map(cell).join(","));
      const logs = [];
      let cursor = null;
      do {
        const page = await ctx.api.store.page(K.AUDIT, { limit: 500, cursor, order: "asc" });
        for (const r of page.items) logs.push([r.data.at, r.data.who, r.data.what, r.data.room ?? "", r.data.detail ?? ""].map(cell).join(","));
        cursor = page.next;
      } while (cursor);
      return [
        { path: "rooms.csv", content: `﻿${["room", "label", "people", "created", "lastActive"].map(cell).join(",")}\r\n${rooms.join("\r\n")}\r\n` },
        { path: "journal.csv", content: `﻿${["date", "who", "what", "room", "detail"].map(cell).join(",")}\r\n${logs.join("\r\n")}\r\n` },
      ];
    },
  },

  hooks: {
    async onInstanceCreate(ctx) {
      await K.ensureMeta(ctx).catch(KEEP);
      await K.ensureRoom(ctx, K.GENERAL, ctx.t("generalRoom")).catch(KEEP);
    },
    async onInstanceDelete(ctx) {
      for (const k of [...K.mem.hits.keys()]) if (k.includes(`|${ctx.instance.key}`)) K.mem.hits.delete(k);
      K.mem.swept.delete(ctx.instance.key);
    },
  },
};
