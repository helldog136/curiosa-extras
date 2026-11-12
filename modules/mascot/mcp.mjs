// Mascot — the tools for an AI assistant: read the sentences, propose one (always a draft: only the person who runs the site publishes it), read how the mascot moves and speaks, change its talking time, animation speed and voice.
const v = new URL(import.meta.url).search;
const M = await import(new URL(`./model.mjs${v}`, import.meta.url).href);
const S = await import(new URL(`./store.mjs${v}`, import.meta.url).href);

const refused = (message) => Object.assign(new Error(message), { expose: true });

export const mcp = {
  async mascot_phrases_list(ctx, args) {
    const phrases = await S.loadPhrases(ctx);
    const status = args?.status === "published" || args?.status === "draft" ? args.status : "all";
    const limit = Math.min(M.LIMITS.phrases, Math.max(1, Math.floor(Number(args?.limit)) || 50));
    const list = phrases.filter((p) => status === "all" || p.state === status).slice(0, limit);
    const config = await S.loadConfig(ctx);
    return {
      mascotPublished: config.published, total: phrases.length, max: M.LIMITS.phrases, maxLength: M.LIMITS.text,
      variables: M.VARIABLES.map((x) => `{${x.names[0]}}`),
      phrases: list.map((p) => ({ id: p.id, kind: p.kind, language: p.lang || "all", text: p.text, pages: p.pages, state: p.state })),
    };
  },
  async mascot_phrase_add(ctx, args) {
    const checked = M.checkPhrase({ text: args?.text, kind: args?.kind, lang: args?.language && args.language !== "all" ? args.language : "", pages: Array.isArray(args?.pages) ? args.pages.join("\n") : "", state: "draft" }, { locales: ctx.locales, locale: ctx.locale });
    if (checked.errors) {
      const [field, e] = Object.entries(checked.errors)[0];
      throw refused(`${field}: ${ctx.t(e[0], e[1])}`);
    }
    const r = await S.addPhrase(ctx, checked.value);
    if (r.full) throw refused(ctx.t("errFull", { max: M.LIMITS.phrases }));
    return { id: r.id, state: "draft", note: "Saved as a draft. The site team publishes it from the administration." };
  },
  async mascot_animation_get(ctx) {
    const c = await S.loadConfig(ctx);
    const anim = (a) => ({ mode: a.mode, pictures: a.frames.length, maxPictures: M.ANIM.frames, hasAnimatedPicture: Boolean(a.gif), picturesPerSecond: a.fps || M.ANIM.fps[2], playOnce: a.once, bytes: M.animBytes(a), maxBytes: M.ANIM.bytes });
    const sound = M.soundOf(c.voice, ctx.setting("voiceFile"));
    return {
      idle: anim(c.anim.idle), talking: anim(c.anim.talk),
      reading: { ...c.reading, charactersPerSecond: M.SPEEDS[c.reading.speed], examples: [20, 60, 140].map((n) => ({ characters: n, seconds: M.talkDuration("x".repeat(n), c.reading) })) },
      voice: { mode: c.voice.mode, volumePercent: c.voice.volume, blips: c.voice.blips, speech: c.voice.speech, ownSoundChosen: Boolean(sound) },
      note: "Pictures and the sound file are uploads of the site and are set in the administration. Visibility (always, or only while speaking) is an option of each overlay element.",
    };
  },
  async mascot_animation_update(ctx, args) {
    const a = args ?? {}, c = await S.loadConfig(ctx);
    const bad = (field, message) => { throw refused(`${field}: ${message}`); };
    const oneOf = (field, table, value) => { if (!Object.hasOwn(table, value)) bad(field, `one of ${Object.keys(table).join(", ")}`); return value; };
    const whole = (field, value, [min, max]) => { if (!Number.isInteger(value) || value < min || value > max) bad(field, `a whole number from ${min} to ${max}`); return value; };
    const reading = { ...c.reading }, anim = { idle: { ...c.anim.idle }, talk: { ...c.anim.talk } }, voice = { ...c.voice, blips: { ...c.voice.blips }, speech: { ...c.voice.speech } };
    if (a.readingSpeed !== undefined) reading.speed = oneOf("readingSpeed", M.SPEEDS, a.readingSpeed);
    if (a.talkMinSeconds !== undefined) reading.min = whole("talkMinSeconds", a.talkMinSeconds, [M.TALK.min[0], M.TALK.min[1]]);
    if (a.talkMaxSeconds !== undefined) reading.max = whole("talkMaxSeconds", a.talkMaxSeconds, [M.TALK.max[0], M.TALK.max[1]]);
    if (reading.min > reading.max) bad("talkMaxSeconds", `at least ${reading.min}, the shortest time`);
    if (a.idleFps !== undefined) anim.idle.fps = whole("idleFps", a.idleFps, M.ANIM.fps);
    if (a.talkFps !== undefined) anim.talk.fps = whole("talkFps", a.talkFps, M.ANIM.fps);
    if (a.idlePlayOnce !== undefined) anim.idle.once = a.idlePlayOnce === true;
    if (a.voiceMode !== undefined) {
      if (!M.VOICE_MODES.includes(a.voiceMode)) bad("voiceMode", `one of ${M.VOICE_MODES.join(", ")}`);
      if (a.voiceMode === "custom" && !M.soundOf(voice, ctx.setting("voiceFile"))) bad("voiceMode", "no sound file is chosen yet: send one in the administration (tab Voice)");
      voice.mode = a.voiceMode;
    }
    if (a.volume !== undefined) voice.volume = whole("volume", a.volume, M.VOLUME);
    if (a.blipsPreset !== undefined) { if (!M.BLIP_CHOICES.includes(a.blipsPreset)) bad("blipsPreset", `one of ${M.BLIP_CHOICES.join(", ")}`); if (a.blipsPreset === "custom" && !M.soundOf(voice, ctx.setting("voiceFile"))) bad("blipsPreset", "no sound file is chosen yet: send one in the administration (tab Voice)"); voice.blips.preset = a.blipsPreset; }
    if (a.blipsPitch !== undefined) voice.blips.pitch = oneOf("blipsPitch", M.PITCHES, a.blipsPitch);
    if (a.blipsSpeed !== undefined) voice.blips.rate = oneOf("blipsSpeed", M.BLIP_RATES, a.blipsSpeed);
    if (a.blipsVariation !== undefined) voice.blips.vary = oneOf("blipsVariation", M.VARIATIONS, a.blipsVariation);
    if (a.speechLanguage !== undefined) {
      const l = String(a.speechLanguage);
      if (l && !ctx.locales.includes(l)) bad("speechLanguage", `one of ${ctx.locales.join(", ")} or empty`);
      voice.speech.lang = l;
    }
    if (a.speechVoice !== undefined) voice.speech.name = M.oneLine(a.speechVoice, 80);
    if (a.speechSpeed !== undefined) voice.speech.rate = oneOf("speechSpeed", M.SPEECH_RATES, a.speechSpeed);
    if (a.speechPitch !== undefined) voice.speech.pitch = oneOf("speechPitch", M.SPEECH_PITCHES, a.speechPitch);
    await S.saveConfig(ctx, { reading, anim, voice });
    return { ok: true };
  },
};
