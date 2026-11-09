// The tools for the AI. Two reads (the models, the next streams) and ONE preparation: the AI writes nothing but a "preparation" (settings kept 7 days)
// and receives a LINK. The video itself is made in the browser of the person, who opens the link (signed in to the administration: their rights stay theirs) and clicks.
// Every input from the AI is checked one by one; nothing is ever read as HTML (the text is drawn with `fillText`).
const v = new URL(import.meta.url).search; // the module version spreads to the neighbouring files (otherwise the old code would stay in cache after an update)
const P = await import(`./pure.mjs${v}`);
const E = await import(`./events.mjs${v}`);

const expose = (message) => Object.assign(new Error(message), { expose: true });

/**
 * A model as the AI sees it. The guest streamers are given by their NAME (the one Contacts gives to the card, or the handle typed by hand): `names` is a Map
 * card identifier → name; a card that Contacts no longer knows (or that could not be read) is simply left out.
 */
export const publicModel = (m, names = new Map()) => ({
  name: m.name, style: m.config.style, format: m.config.format, durationSeconds: m.config.duration, elements: m.config.elements, text: m.config.text, channelName: m.config.channelName,
  costreamers: m.config.costreamers.map((e) => (e.id ? names.get(e.id) : e.login || e.name)).filter(Boolean), language: m.config.lang,
});

/** A model for the readable backup: the guest streamers there are references (`contactId`) or one-off entries (handle, name, photo). */
export const backupModel = (m) => ({ ...publicModel(m), costreamers: m.config.costreamers.map((e) => (e.id ? { contactId: e.id } : { login: e.login, name: e.name, image: e.image })) });

/**
 * Checks what the AI asks and draws { config, manual } from it (complete settings and the hand-written stream, if any); throws a clear error (visible to the AI) otherwise.
 * `models`: the saved models. A model is the starting point; the other values complete or replace it.
 * `watermarkDefault`: the value of the person's "Made with Curiosa" box, used when the AI says nothing.
 * `styleDefault`: the style the person remembered as their default (null if none): the style when the AI and the model say nothing.
 * `events`: the upcoming events of all sources (for `event`); `sourcesDown`: all sources went silent (the message says so).
 */
export function strictPrepare(args, { models, tz, events = [], sourcesDown = false, watermarkDefault = false, styleDefault = null }) {
  const a = args && typeof args === "object" ? args : {};
  let base = P.DEFAULT_CONFIG;
  if (a.model !== undefined) {
    if (typeof a.model !== "string" || a.model.length > P.LIMITS.modelName) throw expose("'model' must be a saved model name (see story_models).");
    const m = models.find((x) => x.name.toLowerCase() === a.model.trim().toLowerCase());
    if (!m) throw expose(`No saved model named '${P.oneLine(a.model, 60)}'. Call story_models to list them.`);
    base = m.config;
  }
  const next = { ...base, watermark: watermarkDefault === true };
  if (a.model === undefined && P.defaultStyleOf(styleDefault)) next.style = styleDefault;   // no model: the person's default style (a model keeps its own)   // the mention: the person's setting, unless the AI says otherwise (never a model)
  if (a.watermark !== undefined) { if (typeof a.watermark !== "boolean") throw expose("'watermark' must be true or false."); next.watermark = a.watermark; }
  if (a.style !== undefined) { if (!P.STYLES.includes(a.style)) throw expose(`'style' must be one of: ${P.STYLES.join(", ")}.`); next.style = a.style; }
  if (a.format !== undefined) { if (!P.FORMATS.some((f) => f.id === a.format)) throw expose(`'format' must be one of: ${P.FORMATS.map((f) => f.id).join(", ")}.`); next.format = a.format; }
  if (a.language !== undefined) { if (!P.LANGS.includes(a.language)) throw expose(`'language' must be one of: ${P.LANGS.join(", ")}.`); next.lang = a.language; }
  if (a.durationSeconds !== undefined) {
    if (!Number.isInteger(a.durationSeconds) || a.durationSeconds < P.LIMITS.durationMin || a.durationSeconds > P.LIMITS.durationMax) throw expose(`'durationSeconds' must be a whole number from ${P.LIMITS.durationMin} to ${P.LIMITS.durationMax}.`);
    next.duration = a.durationSeconds;
  }
  if (a.elements !== undefined) {
    if (!Array.isArray(a.elements) || a.elements.length > P.ELEMENTS.length) throw expose(`'elements' must be a list taken from: ${P.ELEMENTS.join(", ")}.`);
    const bad = a.elements.find((e) => typeof e !== "string" || !P.ELEMENTS.includes(e));
    if (bad !== undefined) throw expose(`Unknown element '${P.oneLine(bad, 30)}'. Allowed: ${P.ELEMENTS.join(", ")}.`);
    next.elements = P.ELEMENTS.filter((e) => a.elements.includes(e));
  }
  // The "countdown" style draws the big numbers of the countdown: with no list of elements given, the element is added (a given list is respected as it is).
  if (a.elements === undefined && a.style === "countdown") next.elements = P.elementsForStyle("countdown", next.elements);
  if (a.text !== undefined) { if (typeof a.text !== "string" || [...a.text].length > P.LIMITS.text) throw expose(`'text' must be a text of at most ${P.LIMITS.text} characters.`); next.text = P.freeText(a.text, P.LIMITS.text); }
  if (a.channelName !== undefined) { if (typeof a.channelName !== "string" || [...a.channelName].length > P.LIMITS.channelName) throw expose(`'channelName' must be a text of at most ${P.LIMITS.channelName} characters.`); next.channelName = P.oneLine(a.channelName, P.LIMITS.channelName); }
  if (a.costreamers !== undefined) {
    if (!Array.isArray(a.costreamers) || a.costreamers.length > P.LIMITS.costreamers) throw expose(`'costreamers' must be a list of at most ${P.LIMITS.costreamers} Twitch names.`);
    const logins = [];
    for (const x of a.costreamers) {
      const n = typeof x === "string" ? P.normalizeLogin(x) : { error: "invalid" };
      if (!n.login) throw expose(`'${P.oneLine(x, 40)}' is not a valid Twitch name (4 to 25 letters, digits or _).`);
      if (!logins.includes(n.login)) logins.push(n.login);
    }
    next.costreamers = logins;
  }
  let manual = null, chosen = null;
  const hasManual = a.streamTitle !== undefined || a.streamDate !== undefined || a.streamTime !== undefined;
  if (a.event !== undefined) {
    if (typeof a.event !== "string" || !P.EVENT_ID.test(a.event)) throw expose("'event' must be an id given by story_events.");
    if (a.stream !== undefined || hasManual) throw expose("Give only one of 'event' (an id from story_events), 'stream' (a key from story_next_streams) or a hand-written stream.");
    chosen = E.findEvent(events, { id: a.event });
    if (!chosen) throw expose(sourcesDown ? "No event could be checked: the sources did not answer. Try again in a minute." : `No upcoming event has the id '${P.oneLine(a.event, 100)}' (it may be over, or moved). Call story_events for the current list.`);
  }
  if (a.stream !== undefined && hasManual) throw expose("Give either 'stream' (a key from story_next_streams, or 'next') or a hand-written stream (streamTitle + streamDate [+ streamTime]), not both.");
  if (a.stream !== undefined) {
    if (typeof a.stream !== "string" || !(a.stream === "next" || /^[a-z0-9]{1,20}$/.test(a.stream))) throw expose("'stream' must be 'next' or a key given by story_next_streams.");
    next.streamKey = a.stream === "next" ? "" : a.stream;
  } else next.streamKey = "";
  if (chosen) { next.streamKey = chosen.legacyKey || ""; next.eventId = chosen.id; next.eventSource = chosen.source; }
  else if (a.stream !== undefined || hasManual) { next.eventId = ""; next.eventSource = ""; }
  if (hasManual) {
    const m = P.manualStream({ title: a.streamTitle, date: a.streamDate, time: a.streamTime }, tz);
    if (m.error) throw expose(m.error === "title" ? "'streamTitle' is required for a hand-written stream." : m.error === "date" ? "'streamDate' must be a real date written YYYY-MM-DD." : "'streamTime' must be written HH:MM (24 h), or left out for a whole day.");
    manual = { title: m.title, date: String(a.streamDate), time: String(a.streamTime ?? "") };
  }
  return { config: P.cleanConfig(next), manual, event: chosen };
}
