// "On stream": a command or a word can also put a picture, a GIF, a video or a sound on screen. The bot holds no file: it picks from the media library of the alerts overlay (service `alerts.show`)
// by id and asks the overlay to show it. Without the alerts overlay, the choice is hidden and the command only answers in the chat. Nothing here is mandatory.
export const SERVICE = "alerts.show";
export const SECONDS = { min: 2, max: 60 };

/** The library as { available, items: [{ id, name, kind: picture | video | sound, builtin? }] }; `available: false` when no alerts overlay answers. Never throws. */
export async function library(ctx) {
  try {
    const r = await ctx.api.services.call(SERVICE, "list", {});
    const items = r?.ok && Array.isArray(r.value?.items) ? r.value.items.filter((m) => m && typeof m.id === "string" && typeof m.name === "string").slice(0, 300) : null;
    return items ? { available: true, items } : { available: false, items: [] };
  } catch { return { available: false, items: [] }; }
}

/** A saved choice, read with care: { visual?, sound?, seconds? } or null. */
export function readMedia(m) {
  if (!m || typeof m !== "object" || Array.isArray(m)) return null;
  const visual = typeof m.visual === "string" && m.visual ? m.visual.slice(0, 80) : "", sound = typeof m.sound === "string" && m.sound ? m.sound.slice(0, 80) : "";
  const seconds = Number.isInteger(m.seconds) && m.seconds >= SECONDS.min && m.seconds <= SECONDS.max ? m.seconds : null;
  return visual || sound ? { ...(visual ? { visual } : {}), ...(sound ? { sound } : {}), ...(seconds ? { seconds } : {}) } : null;
}

/** Checks the choice of a form or a tool against the library. Rends { ok: true, value } (value null = nothing) or { ok: false, code, field? }. */
export function checkMedia(raw, lib) {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  const visual = String(raw.visual ?? "").trim(), sound = String(raw.sound ?? "").trim();
  const sec = raw.seconds === undefined || raw.seconds === null || String(raw.seconds).trim() === "" ? null : Number(raw.seconds);
  if (!visual && !sound) return { ok: true, value: null };
  if (!lib.available) return { ok: false, code: "media_absent", field: visual ? "mediaVisual" : "mediaSound" };
  const find = (id) => lib.items.find((m) => m.id === id);
  if (visual && !["picture", "video"].includes(find(visual)?.kind)) return { ok: false, code: "media_missing", field: "mediaVisual" };
  if (sound && find(sound)?.kind !== "sound") return { ok: false, code: "media_missing", field: "mediaSound" };
  if (sec !== null && !(Number.isInteger(sec) && sec >= SECONDS.min && sec <= SECONDS.max)) return { ok: false, code: "media_seconds", field: "mediaSeconds" };
  return { ok: true, value: { ...(visual ? { visual } : {}), ...(sound ? { sound } : {}), ...(sec !== null ? { seconds: sec } : {}) } };
}

/** Asks the overlay to show the media. Rends { ok, state } or { ok: false, code }. Never throws: the chat answer never depends on the screen. */
export async function showOnStream(ctx, media) {
  const m = readMedia(media);
  if (!m) return { ok: false, code: "none" };
  try {
    const r = await ctx.api.services.call(SERVICE, "show", m);
    return r?.ok && r.value?.ok ? { ok: true, state: r.value.state } : { ok: false, code: r?.value?.code ?? r?.reason ?? "unavailable" };
  } catch { return { ok: false, code: "unavailable" }; }
}

/** The name of a choice for a row or a tool: "Applause + Ding", or "" when nothing. Names that are gone are shown as the id would be unreadable: "?" */
export function nameOf(media, lib) {
  const m = readMedia(media);
  if (!m) return "";
  const one = (id) => (id ? lib.items.find((x) => x.id === id)?.name ?? "?" : "");
  return [one(m.visual), one(m.sound)].filter(Boolean).join(" + ");
}

const fold = (x) => String(x ?? "").normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
/** A file asked for by id OR by name (case and accents ignored), for the assistants, who read names. */
export const pick = (lib, ref) => { const s = String(ref ?? "").trim(); return lib.items.find((m) => m.id === s) ?? lib.items.find((m) => fold(m.name) === fold(s)) ?? null; };
