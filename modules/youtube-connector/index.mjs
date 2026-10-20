// Connecteur YouTube — porte la clé YouTube du site et offre le service `youtube.api` (liste fermée d'appels, quota compté, cache daté).
// La logique est dans api.mjs ; ici : le service, et le panneau d'administration (sans aucun appel réseau).
import { HOST, LIMITS, adopt, channels, request, status, within } from "./api.mjs";

const bounded = (fn) => (ctx, args) => within(fn(ctx, args ?? {}), LIMITS.callMs, () => ({ ok: false, error: "timeout" }));

/** « 9 h » / « 9 h 30 » en français, « 9:00 AM » en anglais ; « demain » si ce n'est pas aujourd'hui (heure du serveur, comme le reste de l'admin). */
export function resumeText(ctx, at, now = Date.now()) {
  const d = new Date(at);
  const fr = String(ctx.locale ?? "").startsWith("fr");
  const hour = fr ? `${d.getHours()} h${d.getMinutes() ? ` ${String(d.getMinutes()).padStart(2, "0")}` : ""}` : new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(d);
  const today = new Date(now).toDateString() === d.toDateString();
  const tomorrow = new Date(now + 86_400_000).toDateString() === d.toDateString();
  return ctx.t(today ? "when_today" : tomorrow ? "when_tomorrow" : "when_later", { hour, date: d.toLocaleDateString(ctx.locale) });
}

export default {
  services: {
    "youtube.api": {
      request: bounded(request),
      channels: bounded(channels),
      adopt: bounded(adopt),
      status: bounded(status),
    },
  },

  async adminPanel(ctx) {
    const s = await status(ctx);
    const blocks = [];
    if (s.key === "missing") blocks.push({ type: "banner", tone: "warning", text: ctx.t("key_missing") });
    else if (s.key === "refused") blocks.push({ type: "banner", tone: "warning", text: ctx.t("key_refused") });
    else blocks.push({ type: "banner", tone: "success", text: ctx.t("key_ok") });
    blocks.push({ type: "markdown", text: ctx.t("key_help") });
    if (s.quota.exhausted) blocks.push({ type: "banner", tone: "warning", text: ctx.t("quota_exhausted", { when: resumeText(ctx, Date.parse(s.quota.until)) }) });
    blocks.push({ type: "markdown", text: ctx.t("quota_used", { used: s.quota.used.toLocaleString(ctx.locale), budget: s.quota.budget.toLocaleString(ctx.locale), when: resumeText(ctx, Date.parse(s.quota.resetAt)) }) });
    blocks.push({ type: "netHealth", items: [{ host: HOST, label: "YouTube", ...(s.lastGoodAt ? { lastGoodAt: s.lastGoodAt } : {}) }] });
    return blocks;
  },
};
