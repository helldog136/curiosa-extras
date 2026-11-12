// The settings, read with care: a setting's value is not guaranteed (a number can arrive as text). Each is converted, bounded, and falls back to its default.
const int = (v, min, max, def) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) && n >= min && n <= max ? n : def; };
export const RETENTION = { min: 1, max: 365, def: 30 };
export function settingsOf(ctx) {
  return {
    channel: String(ctx.setting("channel") ?? "").trim().slice(0, 200),   // the id of an instance of My Twitch channel (see channel.mjs)
    retentionDays: int(ctx.setting("retentionDays"), RETENTION.min, RETENTION.max, RETENTION.def),
  };
}
