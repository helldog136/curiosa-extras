// MCP tools (1.11.0): an AI assistant adds a video, GIF, picture or sound it made to the media library, then puts it on a Twitch event (follow, raid, sub...).
// The file goes through the core's assistant uploads (core 0.18.0, `ctx.api.files.upload` in the three tools that declare `uploads: true`): checked on its bytes,
// stored under a random name and already OWNED by this overlay. The library row says it came from the assistant (a pill in the Media tab). The Twitch bot picks
// the same library by name (`onStreamPictures`), so one upload serves reactions and commands. Every write tool is off by default; the owner grants it.
const v = new URL(import.meta.url).search; // the version of the module spreads to the neighbour files
const tw = await import(new URL(`./twitch.mjs${v}`, import.meta.url).href);
const md = await import(new URL(`./media.mjs${v}`, import.meta.url).href);
const rx = await import(new URL(`./reaction.mjs${v}`, import.meta.url).href);
const adminTw = await import(new URL(`./twitch-admin.mjs${v}`, import.meta.url).href);

const expose = (message) => Object.assign(new Error(message), { expose: true });
const KIND_OF = { image: "picture", video: "video", audio: "sound" };
const ORDER = { random: "random", round_robin: "rotate" };
const TYPE_LIST = tw.TYPES.join(", ");

/** The core of this site cannot receive files from an assistant (before 0.18.0). */
function upload(ctx) {
  const u = ctx.api.files?.upload;
  if (!u || typeof u.begin !== "function") throw expose("This site cannot receive files from an assistant yet: its core must be updated to 0.18.0 or later. The owner can upload the file in Overlay alerts > Media.");
  return u;
}
const refused = (r) => expose(r.message || "The upload was refused.");

/** Which reactions use a file (by address). */
async function usage(ctx) {
  const cfg = await tw.loadConfig(ctx), videos = tw.videosOf(ctx.setting), by = new Map();
  for (const type of tw.TYPES) {
    const c = cfg.types[type];
    for (const u of [...rx.variantsOf(c, videos), c.audio].filter(Boolean)) by.set(u, [...(by.get(u) ?? []), type]);
  }
  return by;
}
const view = (m, used) => ({ id: m.id, name: m.name, kind: m.kind, ...(m.url ? { address: m.url } : {}), addedBy: m.by === "assistant" ? "assistant" : "person", ...(m.bytes ? { bytes: m.bytes } : {}), ...(m.seconds ? { durationSeconds: m.seconds } : {}), ...(m.width ? { width: m.width, height: m.height } : {}), usedByReactions: used.get(m.url) ?? [] });

async function reactionView(ctx, type) {
  const cfg = await tw.loadConfig(ctx), c = cfg.types[type], videos = tw.videosOf(ctx.setting);
  const lib = await md.list(ctx, { tones: false }), byUrl = new Map(lib.map((m) => [m.url, m]));
  const media = rx.variantsOf(c, videos).map((u) => (byUrl.get(u) ? { name: byUrl.get(u).name, id: byUrl.get(u).id, kind: byUrl.get(u).kind } : { name: null, kind: tw.VIDEO_RE.test(u) ? "video" : "picture", note: "not in the library (added in the Twitch activity window)" }));
  const soundFile = c.audio ? byUrl.get(c.audio) : null;
  return {
    type, enabled: c.on, media, order: c.pick === "rotate" ? "round_robin" : "random", text: c.template || null, defaultText: ctx.t(`tw_text_${type}`),
    durationSeconds: c.seconds || null, sound: c.audio ? (soundFile?.name ?? "a sound file") : c.sound === "none" ? "off" : c.sound, videoSound: c.videoSound === true,
  };
}

/** A library item by name or id, of the given kinds, or a clear error that lists what exists. */
function find(items, ref, kinds, what) {
  const m = md.pick(items, ref);
  if (m && kinds.includes(m.kind)) return m;
  const names = items.filter((x) => kinds.includes(x.kind)).map((x) => x.name);
  throw expose(`No ${what} named "${ref}" in the media library. Available: ${names.join(", ") || "none"}. Upload one with reaction_media_upload_begin, or read reaction_media_list.`);
}

export function tools(emit) {
  return {
    async reaction_media_upload_begin(ctx, a) {
      const u = upload(ctx);
      const name = md.cleanName(a.name);
      if (!name) throw expose('Give a name for the library, 40 characters at most, for example "Raid confetti".');
      const lib = await md.list(ctx);
      if (lib.some((m) => md.fold(m.name) === md.fold(name))) throw expose(`The library already has a file named "${name}". Choose another name, or use that file.`);
      if (lib.filter((m) => !m.builtin && !m.id.startsWith("video:")).length >= md.LIMITS.items) throw expose(`The library is full (${md.LIMITS.items} files). The owner can delete files in Overlay alerts > Media, or use reaction_media_delete.`);
      const r = await u.begin({ bytes: a.bytes, sha256: a.sha256, accept: ["video", "image", "audio"], label: name });
      if (!r.ok) throw refused(r);
      return {
        upload: r.upload, expiresAt: r.expiresAt,
        sendWithHttp: { putUrl: r.putUrl, maxBytesPerRequest: r.partBytes, example: `curl -sS -T clip.webm "${r.putUrl}"`, biggerFiles: `split -b ${r.partBytes} clip.webm part_ ; then PUT each part to the same address with ?offset=<bytes already sent>` },
        orSendWithThisTool: { tool: "reaction_media_upload_chunk", pieces: r.chunks, bytesPerPiece: r.chunkBytes, example: `split -b ${r.chunkBytes} -d -a 3 clip.webm piece_ ; base64 -w0 piece_000` },
        then: "Call reaction_media_upload_finish with this upload.",
      };
    },
    async reaction_media_upload_chunk(ctx, a) {
      const r = await upload(ctx).chunk({ upload: a.upload, index: a.index, data: a.data });
      if (!r.ok) throw refused(r);
      return { received: r.received, total: r.total, complete: r.complete, next: r.complete ? "Call reaction_media_upload_finish." : `Send piece ${a.index + 1}.` };
    },
    async reaction_media_upload_finish(ctx, a, actor) {
      const r = await upload(ctx).finish({ upload: a.upload });
      if (!r.ok) throw refused(r);
      const lib = await md.list(ctx, { tones: false });
      const have = lib.find((m) => m.url === r.url);
      if (have) return { id: have.id, name: have.name, kind: have.kind, already: true };
      let name = md.cleanName(r.label) || md.cleanName(ctx.t(r.kind === "video" ? "md_auto_video" : "md_auto_picture", { n: lib.length + 1 }));
      for (let k = 2; (await md.list(ctx)).some((m) => md.fold(m.name) === md.fold(name)); k++) name = md.cleanName(`${md.cleanName(r.label).slice(0, 36)} ${k}`);
      const row = await md.addOwned(ctx, { name, kind: KIND_OF[r.kind], url: r.url, meta: { by: "assistant", assistant: String(actor?.name ?? "").slice(0, 60), bytes: r.bytes, seconds: r.durationSeconds, width: r.width, height: r.height } });
      if (!row.ok) { await ctx.api.files.remove(r.url); throw expose(row.code === "full" ? `The library is full (${md.LIMITS.items} files). Nothing was kept.` : "The file could not be added to the library. Nothing was kept."); }
      return { id: row.id, name, kind: KIND_OF[r.kind], bytes: r.bytes, durationSeconds: r.durationSeconds, width: r.width, height: r.height, next: "Put it on an event with reaction_set (media: [name]), then reaction_test. The Twitch bot can show it too (onStreamPictures)." };
    },
    async reaction_media_list(ctx) {
      const used = await usage(ctx);
      const items = (await md.list(ctx, { tones: false })).filter((m) => !m.id.startsWith("video:"));
      return { items: items.map((m) => view(m, used)), max: md.LIMITS.items, builtInSounds: md.TONES };
    },
    async reaction_media_delete(ctx, a) {
      const items = (await md.list(ctx, { tones: false })).filter((m) => !m.id.startsWith("video:"));
      const m = find(items, a.media, ["picture", "video", "sound"], "file");
      const types = (await usage(ctx)).get(m.url) ?? [];
      if (types.length) throw expose(`"${m.name}" is still used by the reaction of: ${types.join(", ")}. Remove it from those reactions first with reaction_set, then delete it.`);
      const r = await md.remove(ctx, m.id);
      if (!r.ok) throw expose("This file could not be deleted. Read reaction_media_list and try again.");
      return { deleted: m.name, note: "A Twitch bot command that showed this file will no longer show it." };
    },
    async reaction_get(ctx, a) {
      if (!tw.TYPES.includes(a.type)) throw expose(`Unknown type. Use one of: ${TYPE_LIST}.`);
      return { ...(await reactionView(ctx, a.type)), words: tw.VARS, maxMedia: rx.LIMITS.variants };
    },
    async reaction_set(ctx, a) {
      if (!tw.TYPES.includes(a.type)) throw expose(`Unknown type. Use one of: ${TYPE_LIST}.`);
      const patch = {};
      const lib = await md.list(ctx, { tones: false });
      if (a.media !== undefined) {
        if (a.media.length > rx.LIMITS.variants) throw expose(`At most ${rx.LIMITS.variants} files for one event (got ${a.media.length}).`);
        patch.variants = a.media.map((ref) => find(lib, ref, ["picture", "video"], "picture, GIF or video").url);
      }
      if (a.order !== undefined) patch.pick = ORDER[a.order];
      if (a.text !== undefined) patch.text = a.text;
      if (a.durationSeconds !== undefined) patch.seconds = a.durationSeconds;
      if (a.videoSound !== undefined) patch.videoSound = a.videoSound;
      if (a.sound !== undefined) {
        const s = String(a.sound).trim();
        if (s === "off" || s === "") { patch.sound = ""; patch.audio = ""; }
        else if (tw.SOUNDS.includes(s)) { patch.sound = s; patch.audio = ""; }
        else { patch.audio = find(lib, s, ["sound"], "sound").url; patch.sound = ""; }
      }
      if (!Object.keys(patch).length && a.enabled === undefined) throw expose("Give at least one of: media, order, text, durationSeconds, sound, videoSound, enabled.");
      if (Object.keys(patch).length) {
        const r = await rx.set(ctx, a.type, patch);
        if (!r.ok) {
          const e = r.errors ?? {};
          const say = { words: `The text uses a word that does not exist. Words you can use between braces: ${tw.VARS.map((x) => `{${x}}`).join(", ")}.`, long: `The text is too long: ${tw.LIMITS.template} characters at most.`, range: `durationSeconds must be 0 (default) or between ${tw.LIMITS.seconds.min} and ${tw.LIMITS.seconds.max}.`, limit: `At most ${rx.LIMITS.variants} files.`, kept: "A file could not be kept by the overlay. Upload it again with reaction_media_upload_begin.", file: "A file is not a picture, GIF or video of this site.", choice: "Unknown choice." };
          throw expose(Object.values(e).map((c) => say[c] ?? "A value was refused.").join(" ") || "The change was refused.");
        }
      }
      if (a.enabled !== undefined) {
        const r = await adminTw.changeType(ctx, a.type, { on: a.enabled === true });
        if (r?.error || r?.errors) throw expose("The event could not be switched on or off.");
      }
      return reactionView(ctx, a.type);
    },
    async reaction_test(ctx, a) {
      if (!tw.TYPES.includes(a.type)) throw expose(`Unknown type. Use one of: ${TYPE_LIST}.`);
      const r = await rx.test(ctx, a.type, {}, { sample: (c, id, cfg) => adminTw.sampleAlert(c, id, Date.now(), cfg), emit: (x) => emit(ctx.instance.key, { ...x, test: true }) });
      if (!r.ok) throw expose("This event cannot be tested.");
      return { sent: true, note: "A test alert with a sample name was sent to the overlay pages that are open now (in OBS or a browser). It waits its turn in the queue; nothing reaches Twitch." };
    },
  };
}
