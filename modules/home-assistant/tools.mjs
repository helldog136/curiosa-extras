// Outils pour les assistants IA. Lecture : l'état et le journal. Écriture (jamais accordée d'office) : tout couper, envoyer un test.
// Aucun outil ne permet de reprendre après une coupure, d'associer ou de dissocier : ce sont des décisions de la propriétaire, dans la page du module.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const B = await import(`./bridge.mjs${v}`);
const A = await import(`./admin.mjs${v}`);
const { catalogLabel } = await import(`./catalog.mjs${v}`);

const expose = (message) => Object.assign(new Error(message), { expose: true });
const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
const actorOf = (actor) => `mcp:${String(actor?.name ?? "assistant").slice(0, 30)}`;

export default {
  async ha_status(ctx) {
    const st = await B.status(ctx);
    const o = await A.overview(ctx);
    return { ...st, online: o.online, liveSource: o.live.source, deviceName: o.paired?.name ?? null, cutBy: o.enabled ? null : o.stoppedBy, cutAt: iso(o.stoppedAt), waitingToBeLinked: o.unmapped.map((u) => ({ key: u.key, name: catalogLabel(o.catalog, u.key), lastTryAt: iso(u.at) })) };
  },
  async ha_journal(ctx, args) {
    const o = await A.overview(ctx);
    const limit = Math.min(100, Math.max(1, Math.trunc(Number(args?.limit)) || 30));
    return o.lines.slice(0, limit).map((l) => ({ at: iso(l.at), kind: l.kind, ...(l.event ? { event: l.event } : {}), ...(l.key ? { key: l.key } : {}), ...(l.viewer ? { viewer: l.viewer } : {}), ...(l.status ? { status: l.status } : {}), ...(l.code ? { code: l.code } : {}), ...(l.test ? { test: true } : {}), ...(l.text ? { text: l.text } : {}) }));
  },
  async ha_stop(ctx, _args, actor) {
    const r = await B.stop(ctx, { by: actorOf(actor) });
    if (!r.ok) throw expose("could not stop");
    return { enabled: false };
  },
  async home_assistant_test(ctx, args, actor) {
    const key = String(args?.key ?? "").trim();
    if (!B.KEY_RE.test(key)) throw expose("key must look like lights:red (lowercase letters, digits, : _ -)");
    const r = await B.testSend(ctx, { key, text: String(args?.text ?? "").slice(0, 2000), by: actorOf(actor) });
    if (r.ok) return { sent: true, id: r.id, note: "Test sent through the real queue. Read the result with ha_journal." };
    throw expose(r.reason === "blocked" ? `refused by text moderation (${r.why?.code ?? "blocked"})` : r.reason === "rate" ? `too many tests, wait ${r.retryAfter ?? 3} s` : `refused: ${r.reason}`);
  },
};
