// Planning: the PHOTO of a stream partner. PRIVACY: a visitor's browser NEVER contacts Twitch (nor YouTube, nor Bluesky). The SITE downloads the public photo of the account once,
// keeps it in its own storage (`ctx.api.store`, so it is part of the backup) and serves it from its own address (`/m/<key>/photo/<token>`).
// Rules shared with "Story" (`stream-story/images.mjs`: same avatar hosts, same bounds); the model is the one of the publishing guide ("Images coming from an external service").
//   - No address comes from the visitor: they only give a token (16 characters, a fingerprint of the pseudo). The address comes from the Contacts card and is checked again here.
//   - https, host of the list below, known avatar path, no port, no credentials, no query, NO redirect followed, 256 KB at most, type read from the first bytes.
//   - LAZY download: it starts when the Planning resolves a displayable partner (never from a timer). Every pending partner of the page (5 at most at once) is attempted in the SAME
//     batch, and the page waits for the batch at most `timing.waitMs`; whatever is not finished keeps going and shows up on the next render. A failure never blocks a partner for
//     hours: retries follow `timing.backoffMs` (1 min, 5 min, 30 min, then 6 h) and the admin page can reset them ("Retry photos"). The page shows initials in the meantime, never an error.
//   - Refreshed at most once a week; deleted as soon as the card is no longer displayable (erased, "to review", "Do not show") or Contacts disappears; forgotten after 30 days
//     without refresh; 30 photos at most (a copy wanted by the current page is evicted last). A photo uploaded by hand in Contacts (`/uploads/...`) already lives on the site: it is shown as is, without a copy.
import { createHash } from "node:crypto";

export const COLLECTION = "partnerPhotos";
export const LIMITS = { bytes: 256 * 1024, items: 30 };
export const timing = {
  fetchMs: 6000,                       // one download (connection and body)
  waitMs: 1500,                        // longest wait of a page render for the batch of copies
  jobMs: 20_000,                       // a copy still running after this is considered lost (its slot is freed)
  refreshMs: 7 * 86_400_000, forgetMs: 30 * 86_400_000, sweepMs: 3_600_000,
  backoffMs: [60_000, 300_000, 1_800_000, 21_600_000],   // wait before the next try after the 1st, 2nd, 3rd, 4th (and later) failure
  parallel: 5,                         // copies running at once (also the size of one batch)
  quickTries: 3,                       // failures that are still "pending" in the admin page; later ones are "failed"
};
/** The network is a hook: the tests replace it (no real access). */
export const hooks = { fetch: (url, init) => globalThis.fetch(url, init) };

// AVATAR hosts only: Twitch, YouTube, Bluesky (the three networks whose photo Contacts reads). Same list as stream-story/images.mjs (a test compares them).
const GOOGLE_PHOTO = /^\/(?:(?:ytc|a)\/)?[A-Za-z0-9_-]{20,200}(?:=[A-Za-z0-9_-]{1,60})?$/;
export const HOSTS = {
  "static-cdn.jtvnw.net": /^\/(?:jtv_user_pictures|user-default-pictures-uv)\/[A-Za-z0-9_.\-/]{1,160}\.(?:png|jpe?g|webp)$/,
  "yt3.ggpht.com": GOOGLE_PHOTO,
  "yt3.googleusercontent.com": GOOGLE_PHOTO,
  "cdn.bsky.app": /^\/img\/avatar(?:_thumbnail)?\/plain\/did:plc:[a-z2-7]{24}\/[A-Za-z0-9]{8,120}@(?:jpeg|png|webp)$/,
};

/** The address (URL) if it is allowed, otherwise null. */
export function allowedUrl(input) {
  if (typeof input !== "string" || input.length > 400 || /[\u0000- \u007f\\]/.test(input)) return null;
  let u;
  try { u = new URL(input); } catch { return null; }
  const rule = HOSTS[u.hostname];
  if (!rule || u.protocol !== "https:" || u.port || u.username || u.password || u.search || u.hash) return null;
  if (u.pathname.includes("..") || u.pathname.includes("//") || u.pathname.includes("%") || !rule.test(u.pathname)) return null;
  return u;
}

/** The real type of an image, read from its first bytes (never SVG or anything else). */
export function sniff(b) {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

/** A photo uploaded by hand to the site: `/uploads/...` (sub-folders allowed), optionally followed by the focus fragment of the image field (`#...`, dropped). */
export const ownPath = (v) => {
  if (typeof v !== "string" || v.length > 300) return null;
  const path = v.split("#")[0];
  return /^\/uploads\/[A-Za-z0-9._~%-]+(?:\/[A-Za-z0-9._~%-]+){0,4}$/.test(path) && !path.includes("..") && !path.includes("%2") ? path : null;
};

/** Where the photo of a card comes from (`contact.photo` = { url, source }): { kind: "own", path } (already on the site), { kind: "remote", url } (to copy), or null (initials). */
export function photoSource(photo) {
  const url = photo?.url;
  if (typeof url !== "string") return null;
  const own = photo.source === "manual" ? ownPath(url) : null;
  if (own) return { kind: "own", path: own };
  const u = allowedUrl(url);   // a photo picked by hand on another server is not copied: initials
  return u ? { kind: "remote", url: u.href } : null;
}

/** The public token of a pseudo: 16 characters, never the pseudo itself. Case does not matter (`Rascane` and `rascane` share one copy). */
export const idOf = (login) => createHash("sha256").update(`planning-photo|${String(login).trim().toLowerCase()}`).digest("hex").slice(0, 16);
export const ID_RE = /^[0-9a-f]{16}$/;
export const routePath = (ctx, id) => `/m/${ctx.instance.key}/photo/${id}`;

/** The setting "Show partner photos": yes unless an explicit "no". */
export function photosOn(ctx) {
  let v; try { v = ctx.setting?.("showPartnerPhotos"); } catch { v = undefined; }
  return !(v === false || v === "false" || v === 0 || v === "0" || v === "off");
}

const store = (ctx) => ctx.api.store;
/** The stored record of a token (valid or not): lets a damaged record be replaced instead of shadowing the new copy forever. */
const rawDoc = async (ctx, id) => { try { return (await store(ctx).getByKey(COLLECTION, id)) ?? null; } catch { return null; } };
async function readDoc(ctx, id) {
  const r = await rawDoc(ctx, id);
  return r && r.data && r.data.id === id && typeof r.data.b64 === "string" ? r : null;
}
export const hasPhoto = async (ctx, id) => (await readDoc(ctx, id)) !== null;
/** Deletes the copy of a pseudo (idempotent, never throws). */
export async function forget(ctx, id) {
  try { const r = await rawDoc(ctx, id); if (r) await store(ctx).remove(r.id); } catch { /* nothing */ }
  tries.delete(kx(ctx, id));
}
/** Deletes everything (setting turned off, Contacts removed). */
export async function forgetAll(ctx) {
  try { for (const r of await store(ctx).list(COLLECTION, { limit: 200 })) await store(ctx).remove(r.id); } catch { /* nothing */ }
  clearFailures(ctx);
}
/** Forgets copies older than 30 days (a displayed photo is refreshed every week: an old copy is no longer displayed). At most once an hour per instance. */
const swept = new Map();
export async function sweep(ctx, now = Date.now()) {
  const k = ctx.instance?.key ?? "";
  if (now - (swept.get(k) ?? 0) < timing.sweepMs) return;
  swept.set(k, now);
  try { for (const r of await store(ctx).list(COLLECTION, { limit: 200 })) if (!(now - Number(r.data?.at) < timing.forgetMs)) await store(ctx).remove(r.id); } catch { /* nothing */ }
}

/** One download. { ok: true, bytes, type } or { ok: false, reason } with reason "unreachable" · "refused" · "notImage" · "tooBig". */
async function download(url) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timing.fetchMs);
  timer.unref?.();
  try {
    const res = await hooks.fetch(url, { redirect: "manual", signal: ctl.signal, headers: { Accept: "image/png,image/jpeg,image/webp" } });
    if (res.status !== 200) return { ok: false, reason: "refused" };
    if (!String(res.headers.get("content-type") ?? "").toLowerCase().startsWith("image/")) return { ok: false, reason: "notImage" };
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > LIMITS.bytes) return { ok: false, reason: "tooBig" };
    const reader = res.body?.getReader?.();
    if (!reader) return { ok: false, reason: "notImage" };
    const parts = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > LIMITS.bytes) { try { await reader.cancel(); } catch { /* already closed */ } return { ok: false, reason: "tooBig" }; }
      parts.push(value);
    }
    const bytes = new Uint8Array(size); let o = 0; for (const p of parts) { bytes.set(p, o); o += p.length; }
    const type = sniff(bytes);
    return type ? { ok: true, bytes, type } : { ok: false, reason: "notImage" };
  } catch { return { ok: false, reason: "unreachable" }; } finally { clearTimeout(timer); }
}

const kx = (ctx, id) => `${ctx.instance?.id ?? ctx.instance?.key ?? ""}|${id}`;   // two Planning instances never share a mark
const pending = new Map();   // instance|token -> { at, promise }: a copy in progress (one at a time per pseudo)
const tries = new Map();     // instance|token -> { fails, reason, nextAt }: failures not yet cured (memory only: a restart starts afresh, which is never worse)
export const resetPhotos = () => { pending.clear(); tries.clear(); swept.clear(); };
/** Forgets every failure mark so the next render tries again at once ("Retry photos"). Copies in progress are left alone. */
export const clearFailures = (ctx) => { const p = `${ctx.instance?.id ?? ctx.instance?.key ?? ""}|`; for (const k of [...tries.keys()]) if (k.startsWith(p)) tries.delete(k); };
/** Waits for the copies in progress (tests). */
export const settled = () => Promise.all([...pending.values()].map((j) => j.promise));
const inFlight = (ctx) => { const p = `${ctx.instance?.id ?? ctx.instance?.key ?? ""}|`; return [...pending.keys()].filter((k) => k.startsWith(p)).length; };

/** The wait before the next try after `fails` failures. */
export const delayAfter = (fails) => timing.backoffMs[Math.min(Math.max(fails, 1), timing.backoffMs.length) - 1];
function fail(ctx, id, reason) {
  const k = kx(ctx, id), fails = (tries.get(k)?.fails ?? 0) + 1;
  tries.set(k, { fails, reason, nextAt: Date.now() + delayAfter(fails) });   // the clock of the FAILURE, not the one of the render that started the copy
}

async function save(ctx, id, login, src, got, protect) {
  const data = { id, login, type: got.type, b64: Buffer.from(got.bytes).toString("base64"), at: Date.now(), src };
  const mine = await rawDoc(ctx, id);
  if (mine) { if (await store(ctx).update(mine.id, data, { key: id })) return; }
  if ((await store(ctx).count(COLLECTION)) >= LIMITS.items) {
    // Full: the oldest copy makes room (30 at most), but a copy the page being rendered wants goes last.
    const others = (await store(ctx).list(COLLECTION, { limit: 200 })).filter((r) => r.data?.id !== id)
      .sort((a, b) => (protect.has(a.data?.id) ? 1 : 0) - (protect.has(b.data?.id) ? 1 : 0) || Number(a.data?.at) - Number(b.data?.at) || new Date(a.createdAt) - new Date(b.createdAt));
    for (const r of others.slice(0, Math.max(0, others.length - (LIMITS.items - 1)))) await store(ctx).remove(r.id);
  }
  await store(ctx).add(COLLECTION, data, { key: id });
}

const LATE = Symbol("late");
const within = (p, ms, unref = false) => { let t; return Promise.race([p, new Promise((r) => { t = setTimeout(() => r(LATE), ms); if (unref) t.unref?.(); })]).finally(() => clearTimeout(t)); };   // a render waiting for its batch keeps the process alive; the long deadline of a lost copy does not

/** Starts (or joins) the copy of one pseudo. Never throws; records the failure with its reason. */
function start(ctx, id, login, url, protect) {
  const k = kx(ctx, id), known = pending.get(k);
  if (known && Date.now() - known.at < timing.jobMs) return known.promise;
  const job = { at: Date.now(), promise: null };
  const run = (async () => {
    const got = await download(url);
    if (!got.ok) { fail(ctx, id, got.reason); return; }
    try { await save(ctx, id, login, url, got, protect); tries.delete(k); } catch { fail(ctx, id, "save"); }
  })();
  // A copy that never ends (storage stuck) is given up on after `jobMs`: its slot is freed and the failure is recorded.
  job.promise = within(run, timing.jobMs, true).then((r) => { if (r === LATE) fail(ctx, id, "unreachable"); }, () => fail(ctx, id, "save"))
    .finally(() => { if (pending.get(k) === job) pending.delete(k); });
  pending.set(k, job);
  return job.promise;
}

/**
 * The photos of a batch of DISPLAYABLE partners (the caller never asks for another card): `jobs` = [{ login, source }] with a { kind: "remote", url } source, in the order of the page.
 * Every partner that needs a copy (none yet, older than a week, other address) and is not waiting for its next try is attempted now, `timing.parallel` at most; the call waits for the batch
 * at most `timing.waitMs` and never throws. Rends Map(login -> site address of the photo, or null). An older copy keeps being served while a new one is made or fails.
 */
export async function ensure(ctx, jobs, now = Date.now()) {
  const items = jobs.map((j) => ({ login: j.login, url: j.source.url, id: idOf(j.login) }));
  const protect = new Set(items.map((i) => i.id));
  const runs = [];
  let started = 0;
  for (const it of items) {
    const doc = await readDoc(ctx, it.id);
    if (doc && now - Number(doc.data.at) < timing.refreshMs && doc.data.src === it.url) continue;   // a good copy: it never expires before the refresh age
    const k = kx(ctx, it.id);
    if (pending.has(k)) { runs.push(pending.get(k).promise); continue; }
    if (now < (tries.get(k)?.nextAt ?? 0)) continue;               // waiting for its next try
    if (started >= timing.parallel || inFlight(ctx) >= timing.parallel) continue;   // the others come with the next render, they are NOT marked as failed
    started++;
    runs.push(start(ctx, it.id, it.login, it.url, protect));
  }
  if (runs.length) await within(Promise.all(runs), timing.waitMs);
  const out = new Map();
  for (const it of items) out.set(it.login, (await readDoc(ctx, it.id)) ? routePath(ctx, it.id) : null);
  return out;
}

/** The address of the photo to show for a DISPLAYABLE partner (site photo as is, otherwise the kept copy, made now if needed), or null (initials). */
export async function photoFor(ctx, login, source, now = Date.now()) {
  if (!source) return null;
  if (source.kind === "own") return source.path;
  return (await ensure(ctx, [{ login, source }], now)).get(login) ?? null;
}

/**
 * What the admin page says about a partner photo: { state: "copied" } · { state: "pending", nextMs } · { state: "failed", reason, nextMs } (after `quickTries` quick failures).
 * `source` is the one of `photoSource` (null = nothing usable).
 */
export async function statusOf(ctx, login, source, now = Date.now()) {
  if (!source) return { state: "none" };
  if (source.kind === "own") return { state: "copied" };
  const id = idOf(login);
  if (await hasPhoto(ctx, id)) return { state: "copied" };
  const k = kx(ctx, id), t = tries.get(k);
  if (t && t.fails >= timing.quickTries) return { state: "failed", reason: t.reason, nextMs: Math.max(0, t.nextAt - now) };
  return { state: "pending", nextMs: pending.has(k) || !t ? 0 : Math.max(0, t.nextAt - now) };
}

/** The kept copy of this token: { login, type, bytes } or null. */
export async function copyOf(ctx, id) {
  if (!ID_RE.test(String(id))) return null;
  const doc = await readDoc(ctx, id);
  if (!doc) return null;
  const type = ["image/jpeg", "image/png", "image/webp"].includes(doc.data.type) ? doc.data.type : null;
  const bytes = Buffer.from(String(doc.data.b64), "base64");
  if (!type || !bytes.length || bytes.length > LIMITS.bytes || sniff(bytes) !== type) return null;
  return { login: String(doc.data.login ?? ""), type, bytes };
}
