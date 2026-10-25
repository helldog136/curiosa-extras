// FAUX FOURNISSEUR de la plateforme « pull » (Patreon API v2), pour tester Soutiens SANS réseau : un faux `fetch` qui répond comme l'API (campagnes, membres paginés par curseur,
// paliers inclus), vérifie le jeton d'accès, et peut tomber en panne ou répondre n'importe quoi. Ne contacte jamais un vrai service.
//   const p = fakePatreon({ members: [...], tiers: [...] });
//   await kit.withFakeFetch({ "*": p.reply }, async () => { … });       // p.calls : les adresses demandées
// Un membre : { id, name, status ("active_patron" | "former_patron" | "declined_patron" | null), since (ISO), tiers: [ids] } ; un palier : { id, title, cents }.
export function fakePatreon({ members = [], tiers = [], token = "tok-creator", pageSize = 200, campaign = "111" } = {}) {
  const calls = [];
  const state = { members, tiers, fail: null, campaigns: [{ id: campaign, type: "campaign" }], garbage: false, status: null, token };
  const json = (body, status = 200) => ({ json: body, status });
  async function reply(url, init) {
    calls.push({ url, headers: init?.headers ?? {} });
    const u = new URL(url);
    if (u.hostname !== "www.patreon.com") return { status: 404, text: "unknown host" };
    const auth = new Headers(init?.headers ?? {}).get("authorization");
    if (auth !== `Bearer ${state.token}`) return json({ errors: [{ code: 1, status: "401" }] }, 401);
    if (state.status) return { status: state.status, text: "" };
    if (state.fail) throw new TypeError("fetch failed");
    if (state.garbage) return { status: 200, text: "<html>not json</html>" };
    if (u.pathname === "/api/oauth2/v2/campaigns") return json({ data: state.campaigns });
    const m = /^\/api\/oauth2\/v2\/campaigns\/(\d+)\/members$/.exec(u.pathname);
    if (!m || m[1] !== campaign) return json({ errors: [] }, 404);
    const from = Number(u.searchParams.get("page[cursor]") ?? 0) || 0;
    const size = Math.min(pageSize, Number(u.searchParams.get("page[count]") ?? pageSize));
    const slice = state.members.slice(from, from + size);
    return json({
      data: slice.map((x) => ({ id: String(x.id), type: "member", attributes: { full_name: x.name, patron_status: x.status, pledge_relationship_start: x.since ?? null, email: "must-never-be-read@example.test" }, relationships: { currently_entitled_tiers: { data: (x.tiers ?? []).map((id) => ({ id: String(id), type: "tier" })) } } })),
      included: state.tiers.map((t) => ({ id: String(t.id), type: "tier", attributes: { title: t.title, amount_cents: t.cents } })),
      meta: { pagination: { total: state.members.length, cursors: { next: from + size < state.members.length ? String(from + size) : null } } },
    });
  }
  return { reply, calls, state };
}

/** Une notification Ko-fi : le corps « data=<JSON> » d'un formulaire, avec le jeton de vérification. */
export function kofiBody(over = {}, token = "kofi-verify-token") {
  const data = { verification_token: token, message_id: "11111111-1111-4111-8111-111111111111", timestamp: "2026-03-01T10:00:00Z", type: "Donation", is_public: true, from_name: "Jo Example", message: "Merci", amount: "3.00", url: "https://ko-fi.com/Home/CoffeeShop?txid=abc", email: "jo@example.test", currency: "EUR", is_subscription_payment: false, is_first_subscription_payment: false, kofi_transaction_id: "22222222-2222-4222-8222-222222222222", tier_name: null, ...over };
  return new URLSearchParams({ data: JSON.stringify(data) }).toString();
}
export const kofiRequest = (over = {}, { token, url = "https://site.example.test/m/soutiens/kofi", headers = {} } = {}) => new Request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": "198.51.100.7", ...headers }, body: kofiBody(over, token) });
