// Un double MINIMAL du service « audience.draw » v1 (tests/contract-ext/audience.md), pour les modules qui le consomment (le Bot Twitch).
// Il suit le contrat : status() sans secret, enter() avec les mêmes raisons de refus ; le vrai module est testé dans tests/audience-draw.test.mjs.
//   const d = fakeAudienceDraw({ open: true, keyword: "!cadeau", level: "all" });  d.service.status()  d.service.enter({ pseudo, platform, login })  d.calls
export function fakeAudienceDraw({ open = false, keyword = "", level = "all", expiresAt = undefined, id = undefined, max = 5000 } = {}) {
  const state = { open, keyword, level, expiresAt, id, entries: new Map(), calls: [] };
  const RANK = { all: 0, sub: 1, mod: 2 };
  const service = {
    status: async () => { state.calls.push(["status"]); return { open: state.open, keyword: state.open ? state.keyword : "", level: state.open ? state.level : "all", ...(state.open && state.expiresAt ? { expiresAt: state.expiresAt } : {}), ...(state.open && state.id ? { id: state.id } : {}) }; },
    enter: async (a) => {
      state.calls.push(["enter", a]);
      if (!a || typeof a.pseudo !== "string" || !a.pseudo.trim() || !/^[a-z][a-z0-9_-]{0,19}$/.test(String(a.platform))) return { ok: false, reason: "invalid" };
      if (!state.open || !state.keyword) return { ok: false, reason: "closed" };
      if (a.role !== undefined && (RANK[a.role] ?? 0) < RANK[state.level]) return { ok: false, reason: "level" };
      const key = `${a.platform}|${String(a.login || a.pseudo).toLowerCase()}`;
      if (state.muted?.has(key)) return { ok: false, reason: "muted" };
      if (state.entries.has(key)) return { ok: false, reason: "already" };
      if (state.entries.size >= max) return { ok: false, reason: "full" };
      state.entries.set(key, a.pseudo.trim().slice(0, 25));
      return { ok: true };
    },
  };
  return { service, state, get calls() { return state.calls; }, mute: (platform, login) => { (state.muted ??= new Set()).add(`${platform}|${String(login).toLowerCase()}`); } };
}
