// Les trois adresses publiques que Home Assistant appelle : /m/<instance>/pair, /pull et /ack. Voir docs/ideas/home-assistant-contract.md pour le contrat exact.
// Règles communes : JSON en UTF-8, corps de 4 Ko au plus, jamais de détail interne dans une erreur, jamais de secret dans une réponse ou un journal, rien en cache.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const B = await import(`./bridge.mjs${v}`);
const { settingsOf } = await import(`./settings.mjs${v}`);

export const MAX_BODY = 4096;
const HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const json = (status, body, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });
const tooMany = (seconds) => json(429, { ok: false, error: "rate_limited" }, { "Retry-After": String(Math.max(1, seconds)) });
const notAllowed = (allow) => json(405, { ok: false, error: "method_not_allowed" }, { Allow: allow });

/** Lit le corps JSON en s'arrêtant à 4 Ko. Rend { body } (un objet) ou { status } (400 ou 413). */
export async function readJson(request) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY) return { status: 413 };
  let raw = "";
  try {
    if (request.body && typeof request.body.getReader === "function") {
      const reader = request.body.getReader();
      const chunks = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY) { await reader.cancel().catch(() => {}); return { status: 413 }; }
        chunks.push(value);
      }
      raw = Buffer.concat(chunks).toString("utf8");
    } else raw = await request.text();
  } catch { return { status: 400 }; }
  if (raw.length > MAX_BODY) return { status: 413 };
  try {
    const body = JSON.parse(raw);
    return body && typeof body === "object" && !Array.isArray(body) ? { body } : { status: 400 };
  } catch { return { status: 400 }; }
}

const fail = (e, ctx, where) => {
  console.error(`[home-assistant] ${ctx.instance.key}: ${where} en échec (${e?.name ?? "erreur"})`);   // jamais le message : il pourrait citer une valeur
  return json(503, { ok: false, error: "unavailable" }, { "Retry-After": "5" });
};

/* ───────────── POST pair ───────────── */

export async function pair(request, ctx, now = Date.now()) {
  if (request.method !== "POST") return notAllowed("POST");
  try {
    const who = ctx.api.visitor.fingerprint(request, "pair");
    const wait = B.takePair(ctx, who, now);
    if (wait) return tooMany(wait);
    const r = await readJson(request);
    if (!r.body) return json(r.status, { ok: false, error: r.status === 413 ? "too_large" : "bad_request" });
    if (typeof r.body.code !== "string" || r.body.code.length > 32) return json(400, { ok: false, error: "bad_request" });
    const name = typeof r.body.name === "string" ? r.body.name : "";
    const out = await B.redeemCode(ctx, { code: r.body.code, name }, { now });
    if (!out.ok) return json(400, { ok: false, error: "invalid_code" });
    return json(200, { token: out.token, instance: out.instance, pollSeconds: settingsOf(ctx).pollSeconds });
  } catch (e) { return fail(e, ctx, "association"); }
}

/* ───────────── GET pull ───────────── */

const intParam = (url, name, def, min, max) => {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === "") return { value: def };
  if (!/^\d{1,12}$/.test(raw)) return { bad: true };
  return { value: Math.min(max, Math.max(min, Number(raw))) };
};

export async function pull(request, ctx, now = Date.now()) {
  if (request.method !== "GET") return notAllowed("GET");
  try {
    const who = ctx.api.visitor.fingerprint(request, "pull");
    if (B.authBlocked(ctx, who, now)) return tooMany(60);
    const core = await B.authenticate(ctx, request);
    if (!core) {
      const wait = B.failedAuth(ctx, who, now);
      return wait ? tooMany(wait) : json(401, { ok: false, error: "unauthorized" }, { "WWW-Authenticate": "Bearer" });
    }
    const wait = B.takePull(ctx, now);
    if (wait) return tooMany(wait);
    const url = new URL(request.url);
    const cursor = intParam(url, "cursor", 0, 0, Number.MAX_SAFE_INTEGER), limit = intParam(url, "limit", 10, 1, 10);
    if (cursor.bad || limit.bad) return json(400, { ok: false, error: "bad_request" });
    return json(200, await B.pull(ctx, { cursor: cursor.value, limit: limit.value }, now));
  } catch (e) { return fail(e, ctx, "interrogation"); }
}

/* ───────────── POST ack ───────────── */

export async function ack(request, ctx, now = Date.now()) {
  if (request.method !== "POST") return notAllowed("POST");
  try {
    const who = ctx.api.visitor.fingerprint(request, "ack");
    if (B.authBlocked(ctx, who, now)) return tooMany(60);
    const core = await B.authenticate(ctx, request);
    if (!core) {
      const wait = B.failedAuth(ctx, who, now);
      return wait ? tooMany(wait) : json(401, { ok: false, error: "unauthorized" }, { "WWW-Authenticate": "Bearer" });
    }
    const wait = B.takeAck(ctx, now);
    if (wait) return tooMany(wait);
    const r = await readJson(request);
    if (!r.body) return json(r.status, { ok: false, error: r.status === 413 ? "too_large" : "bad_request" });
    const { id, status, code } = r.body;
    if (typeof id !== "string" || !B.ID_RE.test(id) || typeof status !== "string" || typeof code !== "string") return json(400, { ok: false, error: "bad_request" });
    const out = await B.ack(ctx, { id, status, code }, now);
    return out.ok ? json(200, out) : json(400, out);
  } catch (e) { return fail(e, ctx, "accusé"); }
}
