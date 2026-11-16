// MCP tools on compositions (1.15.0, core 0.25.0): an AI assistant places the text on the pictures, GIFs and videos of a reaction, LOOKS at an approximate
// picture of the result (made by the site with sharp), opens an exact page in its own browser, and iterates; the owner fine-tunes in the visual editor.
//
//   composition_places   read   the places (one per Twitch event type), their files (with sizes, length, transparency, still picture) and automatic values
//   composition_get      read   one placement (or a starting point), with the texts filled with examples
//   composition_set      write  OFF by default, audited by the core; `dryRun`; the composition is a JSON TEXT; every problem listed at once, in plain words
//   composition_preview  read   an IMAGE (approximate), 20 a minute per access
//   composition_render_kit read a self-contained HTML page (exact render) for the assistant's own browser
//   composition_copy     write  OFF by default: the boxes of one placement onto another file
//   composition_remove   destructive, never granted by default
//
// The files are those of the reaction (owned by this overlay already: reaction_set puts them there); these tools never claim a file. The data goes through the
// same checker as the editor (`ctx.overlay.checkComposition`), the texts through the same filling (`resolveComposition`), so a placement made here is one the
// editor opens and the page draws.
const v = new URL(import.meta.url).search;
const tw = await import(new URL(`./twitch.mjs${v}`, import.meta.url).href);
const md = await import(new URL(`./media.mjs${v}`, import.meta.url).href);
const rx = await import(new URL(`./reaction.mjs${v}`, import.meta.url).href);
const cp = await import(new URL(`./compose.mjs${v}`, import.meta.url).href);

const expose = (message) => Object.assign(new Error(message), { expose: true });
/** The automatic values each event type offers in a placed text (the same table as the window of Twitch activity, TYPE_WORDS). */
export const PLACE_WORDS = { follow: ["name"], sub: ["name", "tier"], resub: ["name", "months", "tier", "text"], gift: ["name", "count", "tier", "total"], cheer: ["name", "amount", "text"], raid: ["name", "viewers"], online: ["title"], offline: [], hype: ["level", "total"], redeem: ["name", "title", "amount", "text"] };
const SAMPLES = { user: "etoile_nord", target: "lune_douce", args: "lune_douce bravo", name: "etoile_nord", count: "5", amount: "500", tier: "1", months: "12", viewers: "42", level: "3", title: "A hug", text: "Have a nice evening", total: "1,200" };
const LONG = { user: "etoile_nord_lune_douce_xy", target: "etoile_nord_lune_douce_xy", args: "etoile_nord_lune_douce_xy and a few more words after it", name: "etoile_nord_lune_douce_xy", count: "100", amount: "1,000,000", tier: "3", months: "120", viewers: "10,000", level: "25", title: "A very long reward title for the whole chat", text: "A long message from a viewer that goes on and on to see how the box copes with it", total: "1,000,000" };
const LABELS = { user: "name of the viewer who typed the command", target: "first word after the command (a name, @ removed)", args: "every word after the command", name: "viewer name", count: "number of gifts", amount: "amount (bits or points)", tier: "sub tier", months: "months", viewers: "viewers of the raid", level: "hype train level", title: "title (stream or reward)", text: "text written by the viewer (can be long)", total: "total" };
export const PREVIEW_PER_MINUTE = 20;
const previews = (globalThis.__curiosaAlertsPreviews ??= new Map());   // access name → timestamps of its previews

const ready = (ctx, feature) => {
  if (!cp.available(ctx)) throw expose("This site's core cannot place text yet: it must be updated to 0.19.0 or later.");
  if (feature && !(ctx.overlay.features ?? []).includes(feature)) throw expose(`This site's core cannot do this yet: it must be updated to 0.25.0 or later (feature "${feature}").`);
};
/** A place: { place, kind: "event", type } (a Twitch event) or (1.16.0) { place, kind: "show", decl } (a command or a word of another module, declared to this overlay). */
async function placeOf(ctx, place) {
  const p = String(place ?? "");
  const m = /^event:([a-z]+)$/.exec(p);
  if (m && tw.TYPES.includes(m[1])) return { place: p, kind: "event", type: m[1] };
  if (p.startsWith("show:")) { const decl = await cp.showPlace(ctx, p); if (decl) return { place: p, kind: "show", decl }; }
  throw expose(`"${place}" is not a place. Places are "event:<type>" (type one of: ${tw.TYPES.join(", ")}) and the "show:…" places of bot commands; read composition_places.`);
}
/** The automatic values of a place. */
const wordsOf = (P) => (P.kind === "event" ? PLACE_WORDS[P.type] ?? [] : P.decl.variables ?? []);

/** The files of a place, with what the library knows of them (name, size, length, transparency, still picture). */
async function filesOf(ctx, P) {
  const lib = await md.list(ctx, { tones: false }), byUrl = new Map(lib.map((m) => [m.url, m])), byId = new Map(lib.map((m) => [m.id, m]));
  const placed = await cp.forPlace(ctx, P.place);
  const rows = new Map((await cp.rowsFor(ctx, P.place)).map((r) => [r.src, r]));
  const srcs = P.kind === "event" ? rx.variantsOf((await tw.loadConfig(ctx)).types[P.type], tw.videosOf(ctx.setting)) : (P.decl.files ?? []).filter((src) => byUrl.has(src));
  return srcs.map((src) => {
    const m = byUrl.get(src), poster = m?.posterId ? byId.get(m.posterId) : null;
    const kind = tw.VIDEO_RE.test(src) ? "video" : /\.gif$/.test(src) ? "gif" : "picture";
    return {
      src, kind, ...(m ? { name: m.name } : {}), ...(m?.width ? { width: m.width, height: m.height } : {}), ...(m?.seconds ? { durationSeconds: m.seconds } : {}),
      ...(kind === "video" && m?.by === "assistant" ? { transparent: m.transparent === true } : {}), ...(poster?.url ? { poster: poster.url } : {}),
      hasComposition: !!placed[src], ...(rows.get(src) ? { updatedAt: rows.get(src).updatedAt, by: rows.get(src).by } : {}),
    };
  });
}
const fileIn = (files, src, place) => {
  const f = files.find((x) => x.src === src);
  if (!f) throw expose(`${src} is not a file of ${place}. Its files: ${files.map((x) => x.src).join(", ") || "none"}. Put the file on the reaction first with reaction_set (media: [name]), then place the text.`);
  return f;
};
const phraseOf = async (ctx, P, values) => {
  if (P.kind === "show") return String(P.decl.phrase ?? "") || (values.user ?? "");
  const cfg = await tw.loadConfig(ctx);
  return tw.fillTemplate(cfg.types[P.type].template || ctx.t(`tw_text_${P.type}`), values);
};
const samples = (P, long) => Object.fromEntries(wordsOf(P).map((w) => [w, (long ? LONG : SAMPLES)[w] ?? (long ? LONG.name : SAMPLES.name)]));

/** Parses and checks a composition sent as a JSON text: the checked value, with plain-English problems (all of them) otherwise. */
function checked(ctx, P, file, text) {
  if (typeof text !== "string" || !text.trim()) throw expose('composition must be a JSON text, for example "{\\"v\\":1,\\"backdrop\\":{\\"src\\":\\"…\\"},\\"boxes\\":[{\\"id\\":\\"t1\\"}]}". Start from composition_get.');
  const variables = wordsOf(P);
  const r = ctx.overlay.checkComposition(text, { src: file.src, variables });
  if (r.ok) return r.value;
  const lines = ctx.overlay.explainErrors ? ctx.overlay.explainErrors(r.errors, { variables }) : r.errors.map((e) => `${e.path || "composition"}: ${e.code}`);
  throw expose(`The composition has ${lines.length} problem${lines.length > 1 ? "s" : ""}; nothing was saved:\n${lines.map((l, i) => `${i + 1}. ${l}`).join("\n")}`);
}
/** What a video adds by itself: its still picture (for previews) and its real length ("media" length). Returns the composition and what was changed. */
function completed(ctx, c, file) {
  const notes = [];
  let out = c;
  if (file.kind === "video") {
    if (file.poster && !c.backdrop.poster) { out = { ...out, backdrop: { ...out.backdrop, poster: file.poster } }; notes.push(`backdrop.poster set to the video's still picture (${file.poster}).`); }
    if (out.duration?.mode === "media" && file.durationSeconds) {
      const s = Math.min(60, Math.max(2, Math.ceil(file.durationSeconds - 0.05)));
      if (s !== out.duration.seconds) { out = { ...out, duration: { mode: "media", seconds: s } }; notes.push(`duration.seconds set to ${s}, the video's own length.`); }
    }
    if (!out.duration) notes.push('No duration: the alert keeps the reaction\'s length. Add "duration": {"mode": "media", "seconds": …} to make it last as long as the video.');
  }
  return { value: out, notes };
}
/** Warnings that do not stop a save: the text cannot fit, a box covers another, a box sits outside the safe margins. */
function warningsOf(c) {
  const w = [];
  const margin = c.guides === "action" ? 3.5 : c.guides === "none" ? 0 : 5;
  c.boxes.forEach((b, i) => {
    if (b.x < margin || b.y < margin || b.x + b.w > 100 - margin || b.y + b.h > 100 - margin) w.push(`Text box ${i + 1} goes into the ${margin} % safe margin (TV screens may cut it).`);
    const px = (b.h / 100) * 1080;
    if (b.size * 1.15 * Math.min(b.maxLines, 1) > px) w.push(`Text box ${i + 1}: one line at size ${b.size} needs about ${Math.ceil(b.size * 1.2)} px of height; the box is ${Math.round(px)} px high on a 1080 frame (it will shrink toward minSize ${b.minSize}).`);
    c.boxes.forEach((o, j) => {
      if (j <= i) return;
      const ox = Math.max(0, Math.min(b.x + b.w, o.x + o.w) - Math.max(b.x, o.x)), oy = Math.max(0, Math.min(b.y + b.h, o.y + o.h) - Math.max(b.y, o.y));
      if (ox * oy > 0.1 * Math.min(b.w * b.h, o.w * o.h)) w.push(`Text boxes ${i + 1} and ${j + 1} overlap.`);
    });
  });
  return w;
}

/** The composition to render: the saved one, or the one sent (not saved), with texts filled with examples. */
async function toRender(ctx, a) {
  const P = await placeOf(ctx, a.place);
  const files = await filesOf(ctx, P), file = fileIn(files, a.src, a.place);
  let c;
  if (a.composition !== undefined && a.composition !== "") c = completed(ctx, checked(ctx, P, file, a.composition), file).value;
  else {
    c = (await cp.forPlace(ctx, a.place))[file.src];
    if (!c) throw expose(`${file.src} has no text placed in ${a.place} yet. Send a composition (JSON text) to see it before saving, or start from composition_get.`);
    c = completed(ctx, c, file).value;
  }
  const values = samples(P, a.sample === "long");
  const resolved = ctx.overlay.resolveComposition(c, { phrase: await phraseOf(ctx, P, values), values });
  return { P, file, composition: c, resolved, values };
}
function rateLimit(actor, now = Date.now()) {
  const key = String(actor?.name ?? "?"), list = (previews.get(key) ?? []).filter((t) => now - t < 60_000);
  if (list.length >= PREVIEW_PER_MINUTE) throw expose(`${PREVIEW_PER_MINUTE} previews a minute at most; try again in ${Math.ceil((60_000 - (now - list[0])) / 1000)} s. composition_set with dryRun checks a composition without a picture.`);
  list.push(now); previews.set(key, list);
}
export const resetPreviewLimits = () => previews.clear();

export function tools() {
  return {
    async composition_places(ctx, a = {}) {
      ready(ctx);
      const places = [];
      if (a.kind === undefined || a.kind === "event") {
        const cfg = await tw.loadConfig(ctx);
        for (const type of tw.TYPES) {
          const P = { place: `event:${type}`, kind: "event", type };
          places.push({
            place: P.place, kind: "event", label: ctx.t(`tw_type_${type}`) !== `tw_type_${type}` ? ctx.t(`tw_type_${type}`) : type, enabled: cfg.types[type].on, files: await filesOf(ctx, P),
            automaticValues: wordsOf(P).map((w) => ({ token: `{${w}}`, means: LABELS[w], example: SAMPLES[w] })),
            sentence: cfg.types[type].template || ctx.t(`tw_text_${type}`),
          });
        }
      }
      // (1.16.0) the commands and words of the Twitch bot that show media (declared when saved in the bot, or at their first show)
      if (a.kind === undefined || a.kind === "show") {
        for (const decl of await cp.showPlaces(ctx)) {
          const P = { place: decl.place, kind: "show", decl };
          places.push({ place: decl.place, kind: "show", label: decl.label, files: await filesOf(ctx, P), automaticValues: wordsOf(P).map((w) => ({ token: `{${w}}`, means: LABELS[w] ?? w, example: SAMPLES[w] ?? SAMPLES.name })), sentence: decl.phrase || null });
        }
      }
      return {
        places, videos: (ctx.overlay.features ?? []).includes("video"),
        howTo: "A composition belongs to one file of one place. Put files on a place with reaction_set (media) or, for a bot command, with the bot's tools, read one with composition_get, check with composition_set dryRun, LOOK at composition_preview, save with composition_set. Sizes are px on a 1080-high frame, positions percent of the frame.",
      };
    },
    async composition_get(ctx, a) {
      ready(ctx);
      const P = await placeOf(ctx, a.place), files = await filesOf(ctx, P), file = fileIn(files, a.src, a.place);
      const saved = (await cp.forPlace(ctx, a.place))[file.src] ?? null;
      const row = (await cp.rowsFor(ctx, a.place)).find((r) => r.src === file.src);
      const start = saved ?? ctx.overlay.defaultComposition(file.src, { seconds: file.durationSeconds ?? null });
      const values = samples(P, false);
      const filled = ctx.overlay.resolveComposition(start, { phrase: await phraseOf(ctx, P, values), values });
      return {
        place: a.place, file, composition: saved, ...(row ? { updatedAt: row.updatedAt, by: row.by } : {}),
        ...(saved ? {} : { startingPoint: start, note: "No text placed on this file yet: startingPoint is what the editor would start from (one box with the sentence)." }),
        filledWithExamples: filled.boxes.map((b) => ({ id: b.id, text: b.text })),
        automaticValues: wordsOf(P).map((w) => `{${w}}`), limits: { boxes: ctx.overlay.limits.boxes, sizePx1080: ctx.overlay.limits.size, bytes: ctx.overlay.limits.bytes },
      };
    },
    async composition_set(ctx, a, actor) {
      ready(ctx);
      const P = await placeOf(ctx, a.place), files = await filesOf(ctx, P), file = fileIn(files, a.src, a.place);
      if (file.kind === "video" && !(ctx.overlay.features ?? []).includes("video")) throw expose("This site's core places text on pictures and GIFs only: it must be updated to 0.21.0 or later for videos.");
      const { value, notes } = completed(ctx, checked(ctx, P, file, a.composition), file);
      const warnings = [...notes, ...warningsOf(value)];
      if (a.dryRun === true) return { ok: true, saved: false, composition: value, warnings, next: "Look at it with composition_preview (same arguments), then call again without dryRun." };
      await cp.save(ctx, a.place, { [file.src]: value }, { files: files.map((f) => f.src), by: `assistant:${String(actor?.name ?? "").slice(0, 60)}` });
      return { ok: true, saved: true, composition: value, warnings, note: "Saved. The owner can fine-tune it in Twitch activity > the reaction window > Edit the text. reaction_test shows it on the overlay." };
    },
    async composition_preview(ctx, a, actor) {
      ready(ctx, "preview");
      const r = await toRender(ctx, a);
      rateLimit(actor);
      const out = await ctx.overlay.preview(r.resolved, {
        width: a.width ?? 960, background: a.background ?? "checker", ...(a.at !== undefined ? { at: a.at } : {}),
        media: r.file.width ? { width: r.file.width, height: r.file.height } : null,
      });
      return ctx.overlay.mcpImage(out.png, out.mimeType, {
        ...out.info, place: a.place, src: r.file.src, saved: a.composition === undefined || a.composition === "", examples: r.values,
        exact: "This picture is approximate (server font, still frame). composition_render_kit gives the exact page for your own browser.",
      });
    },
    async composition_render_kit(ctx, a) {
      ready(ctx, "preview");
      const r = await toRender(ctx, a);
      const html = ctx.overlay.renderKit(r.resolved, { siteUrl: ctx.api.siteUrl, width: a.width ?? 1280, background: a.background ?? "checker", media: r.file.width ? { width: r.file.width, height: r.file.height } : null, title: `${a.place} · ${r.file.name ?? r.file.src}` });
      return {
        html, place: a.place, src: r.file.src, examples: r.values,
        howTo: "Save html as a .html file and open it in your own headless browser (it reads the files from this site). Wait for <html data-ready=\"1\">. Add #t=2.5 to the address to freeze the alert at 2.5 s. The page is what OBS draws, with your browser's fonts.",
      };
    },
    async composition_copy(ctx, a, actor) {
      ready(ctx);
      const fromP = await placeOf(ctx, a.fromPlace), toP = await placeOf(ctx, a.toPlace);
      const fromFile = fileIn(await filesOf(ctx, fromP), a.fromSrc, a.fromPlace);
      const toFiles = await filesOf(ctx, toP), toFile = fileIn(toFiles, a.toSrc, a.toPlace);
      const from = (await cp.forPlace(ctx, a.fromPlace))[fromFile.src];
      if (!from) throw expose(`${fromFile.src} has no text placed in ${a.fromPlace}. Read composition_places (hasComposition).`);
      if (toFile.kind === "video" && !(ctx.overlay.features ?? []).includes("video")) throw expose("This site's core places text on pictures and GIFs only: it must be updated to 0.21.0 or later for videos.");
      const copy = ctx.overlay.copyPlacement(from, toFile.src, { seconds: toFile.durationSeconds ?? null });
      const { value, notes } = completed(ctx, checked(ctx, toP, toFile, JSON.stringify(copy)), toFile);
      await cp.save(ctx, a.toPlace, { [toFile.src]: value }, { files: toFiles.map((f) => f.src), by: `assistant:${String(actor?.name ?? "").slice(0, 60)}` });
      return { ok: true, copied: { from: `${a.fromPlace} ${fromFile.src}`, to: `${a.toPlace} ${toFile.src}` }, composition: value, warnings: [...notes, ...warningsOf(value)] };
    },
    async composition_remove(ctx, a) {
      ready(ctx);
      const P = await placeOf(ctx, a.place), files = await filesOf(ctx, P), file = fileIn(files, a.src, a.place);
      if (!(await cp.forPlace(ctx, a.place))[file.src]) return { ok: true, removed: false, note: "There was no text placed on this file." };
      await cp.save(ctx, a.place, { [file.src]: null }, { files: files.map((f) => f.src) });
      return { ok: true, removed: true, note: "The text no longer shows on this file; the file stays on the reaction." };
    },
  };
}
