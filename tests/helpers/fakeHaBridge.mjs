// Faux fournisseur du service `home-assistant.bridge` (contrat v1 de la spec Pont Twitch → Home Assistant), pour tester `twitch-bot` sans dépendre du module home-assistant.
//   const ha = fakeHaBridge({ enabled: true, live: true });
//   fakeCtx({ services: { "home-assistant.bridge": ha.methods }, topics: ha.topics })        // `topics` : des FONCTIONS (opts) => éléments, lues à chaque collecte
// Contrat : enqueue({ key, text?, viewer?, ref, test? }) → { ok:true, id } | { ok:false, reason } avec reason ∈ off | offline | not_live | blocked | busy | unknown_key | not_paired ;
// status() → { enabled, paired, lastSeenAt, live, queued } ; stop({ by }) / start({ by }) ; sujets `ha.result` { ref, id, status, code } et `ha.state` { enabled, live, paired, lastSeenAt }.
const KEY = /^[a-z0-9][a-z0-9:_-]{0,39}$/;
export function fakeHaBridge(opts = {}) {
  const s = { enabled: true, paired: true, live: true, offline: false, busy: false, blockWords: ["gros-mot"], knownKeys: null, lastSeenAt: "2026-10-14T19:59:30Z", ...opts };
  const api = { state: s, queue: [], results: [], calls: [], stops: [], throwOn: null };
  let n = 0;
  const reason = (a) => {
    if (!s.paired) return "not_paired";
    if (!s.enabled) return "off";
    if (s.offline) return "offline";
    if (!s.live && a?.test !== true) return "not_live";   // un essai (test: true) peut se faire hors direct, jamais coupe-circuit actif
    if (!a || typeof a.key !== "string" || !KEY.test(a.key) || (s.knownKeys && !s.knownKeys.includes(a.key))) return "unknown_key";
    if (a.text !== undefined && s.blockWords.some((w) => String(a.text).toLowerCase().includes(w))) return "blocked";
    if (s.busy || api.queue.length >= (s.maxQueue ?? 50)) return "busy";
    return null;
  };
  api.methods = {
    enqueue: (a) => {
      api.calls.push(["enqueue", a]);
      if (api.throwOn === "enqueue") throw new Error("panne");
      const r = reason(a);
      if (r) return { ok: false, reason: r };
      if (typeof a.ref !== "string" || !a.ref) return { ok: false, reason: "unknown_key" };
      const id = `ha${++n}`;
      api.queue.push({ id, ref: a.ref, key: a.key, text: a.text, viewer: a.viewer, test: a.test === true });
      return { ok: true, id };
    },
    status: () => { api.calls.push(["status"]); return { enabled: s.enabled, paired: s.paired, lastSeenAt: s.lastSeenAt, live: s.live, queued: api.queue.length }; },
    stop: (a) => { api.calls.push(["stop", a]); s.enabled = false; api.stops.push(["stop", a?.by]); return { ok: true }; },
    start: (a) => { api.calls.push(["start", a]); s.enabled = true; api.stops.push(["start", a?.by]); return { ok: true }; },
  };
  /** Home Assistant a joué (ou pas) l'action en file pour `ref`. */
  api.resolve = (ref, status = "done", code = status === "done" ? "ok" : "error") => {
    const i = api.queue.findIndex((q) => q.ref === ref);
    const id = i >= 0 ? api.queue.splice(i, 1)[0].id : `ha-${ref}`;
    api.results.push({ ref, id, status, code });
  };
  api.topics = {
    "ha.result": () => api.results.map((r) => ({ ...r })),
    "ha.state": () => (s.noState ? [] : [{ enabled: s.enabled, live: s.live, paired: s.paired, lastSeenAt: s.lastSeenAt }]),
  };
  return api;
}
