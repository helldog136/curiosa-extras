// DOUBLE EN MÉMOIRE du service « audience.session » v1 (Participation). Texte du contrat : tests/contract-ext/audience.md ;
// suite exécutable : tests/contract-ext/audience.contract.mjs (elle passe contre ce double ET contre le vrai module).
// Indépendant du module (aucun import) : un module d'animation qui dépend de la base (Sondages, plus tard Quiz, Bingo…) se teste contre lui.
//
//   const audience = fakeAudience();
//   const ctx = fakeCtx({ services: { "audience.session": audience.methods } });          // appels via ctx.api.services.call("audience.session", "join", args)
//   audience.asModerator.mute(…)                                                            // mute / clearRoom acceptés : le vrai module vérifie ctx.can("moderate") (droit porté par { asCaller: true })
// Pannes : audience.faults.throw.add("claim") (le cœur rend « failed »), audience.faults.hang.add("join") (ne répond jamais).
// Temps : audience.clock.now = () => … (limites, expiration du direct).
import { createHash, randomBytes } from "node:crypto";

export const AUDIENCE_METHODS = ["info", "join", "who", "setPseudo", "checkPseudo", "claim", "release", "limit", "mute", "clearRoom", "forget", "journal", "livePublish", "liveRead", "liveDrop", "directClient"];
export const AUDIENCE_READ_ONLY = ["info", "who", "checkPseudo", "liveRead", "directClient"];
export const AUDIENCE_LIMITS = { participants: 5000, rooms: 200, claims: 20000, channels: 100, liveBytes: 16384, pseudoMin: 3, pseudoMax: 20 };
const ROOM_RE = /^[a-z0-9][a-z0-9:._-]{0,59}$/, TOKEN_RE = /^[A-Za-z0-9_-]{22,64}$/, CLAIM_RE = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,79}$/, CHANNEL_RE = /^[a-z0-9][a-z0-9_-]{0,29}$/, SCOPE_RE = /^[a-z0-9][a-z0-9:._-]{0,39}$/;
const err = (error, extra = {}) => ({ ok: false, error, ...extra });
const obj = (a) => (a && typeof a === "object" && !Array.isArray(a) ? a : {});
const fold = (s) => String(s).normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[013457@$!]/g, (c) => ({ 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t", "@": "a", $: "s", "!": "i" })[c]).replace(/[^\p{L}\p{N}]/gu, "");
const BANNED = ["fuck", "nazi", "admin"];
const sha = (s) => createHash("sha256").update(s).digest("hex");

export function fakeAudience({ moderator = false } = {}) {
  const faults = { hang: new Set(), throw: new Set() };
  const clock = { now: () => Date.now() };
  const calls = [];
  const rooms = new Map();   // key → { salt, label, people: Map(id → { pseudo, pk, muted }), names: Map(pk → id), claims: Map(id → Set(key)) }
  const hits = new Map();
  const live = new Map();
  const journal = [];

  const room = (key, create) => {
    if (!ROOM_RE.test(String(key))) return null;
    if (!rooms.has(key) && create) {
      if (rooms.size >= AUDIENCE_LIMITS.rooms) return null;
      rooms.set(key, { salt: randomBytes(8).toString("hex"), label: key, people: new Map(), names: new Map(), claims: new Map() });
    }
    return rooms.get(key) ?? null;
  };
  const pid = (r, token) => sha(`${r.salt}|${token}`).slice(0, 40);
  const hit = (bucket, max, per) => {
    const now = clock.now();
    const recent = (hits.get(bucket) ?? []).filter((t) => now - t < per * 1000);
    recent.push(now); hits.set(bucket, recent);
    return { over: recent.length > max, remaining: Math.max(0, max - recent.length), retryAfter: recent.length > max ? Math.max(1, Math.ceil((recent[0] + per * 1000 - now) / 1000)) : 0 };
  };
  const connKey = (c) => sha(String(obj(c).forwarded ?? obj(c).real ?? "local")).slice(0, 12);
  const check = (raw) => {
    const value = String(raw ?? "").normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
    const len = [...value].length;
    if (len < AUDIENCE_LIMITS.pseudoMin) return { code: "pseudo_short" };
    if (len > AUDIENCE_LIMITS.pseudoMax) return { code: "pseudo_long" };
    if (!/^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u.test(value)) return { code: "pseudo_chars" };
    const pk = fold(value);
    if (BANNED.some((b) => pk.includes(b))) return { code: "pseudo_banned" };
    return { value, pk };
  };
  const setName = (r, id, raw) => {
    const v = check(raw);
    if (v.code) return err(v.code);
    const p = r.people.get(id);
    if (p.muted) return err("muted");
    const owner = r.names.get(v.pk);
    if (owner && owner !== id) return err("pseudo_taken");
    if (p.pk) r.names.delete(p.pk);
    r.names.set(v.pk, id); p.pseudo = v.value; p.pk = v.pk;
    return null;
  };
  const view = (id, p) => ({ id, pseudo: p.pseudo, muted: p.muted });

  const impl = {
    info: () => ({ ok: true, version: 1, base: "/m/audience", limits: { pseudoMin: AUDIENCE_LIMITS.pseudoMin, pseudoMax: AUDIENCE_LIMITS.pseudoMax, participants: AUDIENCE_LIMITS.participants, rooms: AUDIENCE_LIMITS.rooms, liveBytes: AUDIENCE_LIMITS.liveBytes }, remote: true }),
    join(a) {
      if (!TOKEN_RE.test(String(a.token))) return err("invalid");
      const r = room(a.room, true);
      if (!r) return err(ROOM_RE.test(String(a.room)) ? "too_many_rooms" : "invalid");
      const id = pid(r, a.token);
      let isNew = false;
      if (!r.people.has(id)) {
        if (hit(`join|${connKey(a.conn)}`, 200, 3600).over) return err("limit", { retryAfter: 60 });
        if (r.people.size >= AUDIENCE_LIMITS.participants) return err("room_full");
        r.people.set(id, { pseudo: null, pk: null, muted: false }); isNew = true;
      }
      if (a.pseudo !== undefined && a.pseudo !== null && a.pseudo !== "") {
        if (r.people.get(id).muted) return err("muted");
        const bad = setName(r, id, a.pseudo);
        if (bad) return bad;
      }
      return { ok: true, participant: { ...view(id, r.people.get(id)), isNew }, room: { key: a.room, count: r.people.size } };
    },
    who(a) {
      if (!TOKEN_RE.test(String(a.token))) return err("invalid");
      const r = room(a.room, false);
      if (!r) return err(ROOM_RE.test(String(a.room)) ? "unknown_room" : "invalid");
      const id = pid(r, a.token);
      return { ok: true, participant: r.people.has(id) ? view(id, r.people.get(id)) : null };
    },
    setPseudo(a) {
      if (!TOKEN_RE.test(String(a.token)) || typeof a.pseudo !== "string") return err("invalid");
      const r = room(a.room, false);
      if (!r) return err(ROOM_RE.test(String(a.room)) ? "unknown_room" : "invalid");
      const id = pid(r, a.token);
      if (!r.people.has(id)) return err("unknown_participant");
      const bad = setName(r, id, a.pseudo);
      return bad ?? { ok: true, participant: view(id, r.people.get(id)) };
    },
    checkPseudo(a) {
      if (typeof a.pseudo !== "string") return err("invalid");
      const v = check(a.pseudo);
      if (v.code) return { ok: true, valid: false, code: v.code };
      if (a.room !== undefined) {
        const r = room(a.room, false);
        if (!r) return err(ROOM_RE.test(String(a.room)) ? "unknown_room" : "invalid");
        if (r.names.has(v.pk)) return { ok: true, valid: false, code: "pseudo_taken" };
      }
      return { ok: true, valid: true, value: v.value };
    },
    claim(a) {
      if (!TOKEN_RE.test(String(a.token)) || !CLAIM_RE.test(String(a.key))) return err("invalid");
      const r = room(a.room, false);
      if (!r) return err(ROOM_RE.test(String(a.room)) ? "unknown_room" : "invalid");
      const id = pid(r, a.token);
      const p = r.people.get(id);
      if (!p) return err("unknown_participant");
      if (p.muted) return err("muted");
      const set = r.claims.get(id) ?? new Set();
      if (set.has(a.key)) return err("already");
      set.add(a.key); r.claims.set(id, set);
      return { ok: true, first: true };
    },
    release(a) {
      if (!TOKEN_RE.test(String(a.token)) || !CLAIM_RE.test(String(a.key))) return err("invalid");
      const r = room(a.room, false);
      if (!r) return err(ROOM_RE.test(String(a.room)) ? "unknown_room" : "invalid");
      return { ok: true, released: r.claims.get(pid(r, a.token))?.delete(a.key) === true };
    },
    limit(a) {
      if (!ROOM_RE.test(String(a.room)) || !SCOPE_RE.test(String(a.scope))) return err("invalid");
      const max = Number(a.max), per = Number(a.per);
      if (!Number.isInteger(max) || max < 1 || max > 10000 || !Number.isInteger(per) || per < 1 || per > 86400) return err("invalid");
      const buckets = [`l|${a.room}|${a.scope}|${connKey(a.conn)}`];
      if (a.token !== undefined) { if (!TOKEN_RE.test(String(a.token))) return err("invalid"); buckets.push(`l|${a.room}|${a.scope}|t:${sha(a.token).slice(0, 12)}`); }
      let remaining = max, retry = 0;
      for (const b of buckets) { const h = hit(b, max, per); remaining = Math.min(remaining, h.remaining); retry = Math.max(retry, h.retryAfter); }
      return retry > 0 ? err("limit", { retryAfter: retry }) : { ok: true, remaining };
    },
    mute(a, can) {
      if (!can) return err("denied");
      if ((typeof a.id !== "string" && typeof a.pseudo !== "string") || typeof a.muted !== "boolean") return err("invalid");
      const r = room(a.room, false);
      if (!r) return err(ROOM_RE.test(String(a.room)) ? "unknown_room" : "invalid");
      const id = typeof a.id === "string" ? a.id : r.names.get(fold(a.pseudo));
      const p = id ? r.people.get(id) : null;
      if (!p) return err("not_found");
      p.muted = a.muted;
      return { ok: true, participant: view(id, p) };
    },
    clearRoom(a, can) {
      if (!can) return err("denied");
      const r = room(a.room, false);
      if (!r) return err(ROOM_RE.test(String(a.room)) ? "unknown_room" : "invalid");
      const removed = r.people.size;
      r.people.clear(); r.names.clear(); r.claims.clear(); r.salt = randomBytes(8).toString("hex");
      return { ok: true, removed };
    },
    forget(a) {
      if (!TOKEN_RE.test(String(a.token))) return err("invalid");
      let removed = 0;
      for (const r of rooms.values()) {
        const id = pid(r, a.token);
        const p = r.people.get(id);
        if (p) { if (p.pk) r.names.delete(p.pk); r.people.delete(id); r.claims.delete(id); removed++; }
      }
      return { ok: true, removed };
    },
    journal(a) {
      const what = String(a.what ?? "").trim();
      if (!what || (a.room !== undefined && !ROOM_RE.test(String(a.room)))) return err("invalid");
      journal.push({ at: new Date(clock.now()).toISOString(), who: String(a.who ?? "module").slice(0, 40), what: what.slice(0, 60), room: a.room ?? null, detail: String(a.detail ?? "").slice(0, 160) });
      return { ok: true };
    },
    livePublish(a) {
      if (!ROOM_RE.test(String(a.room)) || !CHANNEL_RE.test(String(a.channel)) || a.data === undefined) return err("invalid");
      const json = JSON.stringify(a.data);
      if (json.length > AUDIENCE_LIMITS.liveBytes) return err("too_big");
      const key = `${a.room}|${a.channel}`;
      const old = live.get(key);
      if (!old && live.size >= AUDIENCE_LIMITS.channels) return err("too_many_channels");
      const same = old && old.json === json && old.public === (a.public === true) && old.keyHash === (a.readKey ? sha(a.readKey) : null) && old.refreshAt === (a.refreshAt ?? null);
      const rev = same ? old.rev : (old?.rev ?? 0) + 1;
      live.set(key, { json, rev, public: a.public === true, keyHash: a.readKey ? sha(a.readKey) : null, refreshAt: a.refreshAt ?? null, exp: clock.now() + Math.min(86400, Math.max(10, Number(a.ttlSec) || 21600)) * 1000 });
      return { ok: true, rev };
    },
    liveRead(a) {
      if (!ROOM_RE.test(String(a.room)) || !CHANNEL_RE.test(String(a.channel))) return err("invalid");
      const d = live.get(`${a.room}|${a.channel}`);
      if (!d || d.exp <= clock.now()) return { ok: true, empty: true };
      const due = !!d.refreshAt && clock.now() >= Date.parse(d.refreshAt);
      if (String(a.rev ?? "") === String(d.rev)) return { ok: true, unchanged: true, rev: d.rev, due };
      return { ok: true, rev: d.rev, data: JSON.parse(d.json), due };
    },
    liveDrop(a) {
      if (!ROOM_RE.test(String(a.room)) || !CHANNEL_RE.test(String(a.channel))) return err("invalid");
      return { ok: true, dropped: live.delete(`${a.room}|${a.channel}`) };
    },
    directClient: () => ({ ok: true, js: "window.AudienceDirect=window.AudienceDirect||{watch:function(){return{stop:function(){},poke:function(){}}}};", rev: 1 }),
  };

  /** Ce que lirait un navigateur sur la route publique du direct : un canal privé n'existe que pour qui a la clé. */
  const direct = ({ room: r, channel, rev, key }) => {
    const d = live.get(`${r}|${channel}`);
    if (!d || d.exp <= clock.now() || (!d.public && !(d.keyHash && key && sha(key) === d.keyHash))) return { ok: true, empty: true };
    return String(rev ?? "") === String(d.rev) ? { ok: true, unchanged: true, rev: d.rev } : { ok: true, rev: d.rev, data: JSON.parse(d.json) };
  };

  const build = (can) => {
    const out = {};
    for (const m of AUDIENCE_METHODS) {
      out[m] = async (args) => {
        calls.push([m, args]);
        if (faults.hang.has(m)) return new Promise(() => {});
        if (faults.throw.has(m)) throw new Error("fake failure");
        return impl[m](obj(args), can);
      };
    }
    return out;
  };
  const methods = build(moderator);
  const asModerator = build(true);   // les mêmes méthodes, même état, avec le droit de modérer (comme un appel « asCaller » depuis une action d'administration)
  const dump = () => JSON.stringify({ rooms: [...rooms.entries()].map(([k, r]) => ({ k, label: r.label, people: [...r.people.entries()], claims: [...r.claims.entries()].map(([i, s]) => [i, [...s]]) })), live: [...live.entries()], journal });
  return { methods, asModerator, services: { "audience.session": methods }, faults, clock, calls, journal, direct, dump, rooms, live };
}
