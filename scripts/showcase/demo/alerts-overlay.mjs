// Alerts overlay: the voice switched on, a few viewer texts waiting (invented), and a voice report, as the overlay page would have sent them (written straight into the module's storage).
export default async function (h) {
  const { ctx } = await h.ctxOf("alerts-overlay");
  const now = h.NOW.getTime();
  const put = async (name, data) => {
    const rows = await ctx.api.store.list("twitchAlerts", { limit: 20 });
    const r = rows.find((x) => x.data?.name === name);
    if (r) await ctx.api.store.update(r.id, { name, ...data }); else await ctx.api.store.add("twitchAlerts", { name, ...data });
  };
  await put("config", { types: { resub: { viewer: true, tts: "both" }, cheer: { viewer: true, tts: "sentence" }, raid: { tts: "sentence" } }, tts: { on: true, voice: "", lang: "en", rate: 1, pitch: 1, volume: 80, max: 140, readName: true }, moderation: { wordsText: "", hold: false, links: true, caps: true, repeats: true } });
  await put("report", { supported: true, voices: [{ n: "Voice A", l: "en-US" }, { n: "Voice B", l: "en-GB" }, { n: "Voice C", l: "fr-FR" }], at: now });
  await put("state", { seen: [], paused: false, held: [], ttsMuted: false, stop: 0, skip: 0, texts: [
    { id: "demo-11", at: now - 10 * 60_000, reason: "link", type: "cheer", name: "lune_douce", text: "Cheer500 see www.example.com for more", hold: false, with: {} },
    { id: "demo-24", at: now - 20 * 60_000, reason: "caps", type: "resub", name: "brume_claire", text: "THIS IS THE BEST STREAM EVER", hold: true, with: {}, without: {} },
  ] });
}
