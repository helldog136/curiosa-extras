// Événements : ce que l'assistant IA peut faire — lister, voir les types, créer un BROUILLON, modifier un événement.
// L'assistant ne publie jamais (une personne relit et publie), ne retire pas de la publication et ne supprime rien. Ses écritures ne sont pas accordées d'office :
// la propriétaire les accorde jeton par jeton. Tout ce qu'il envoie est vérifié comme le formulaire de l'administration.
const q = new URL(import.meta.url).search;
const X = await import(`./text.mjs${q}`);
const M = await import(`./model.mjs${q}`);
const D = await import(`./data.mjs${q}`);
const O = await import(`./ops.mjs${q}`);
const Q = await import(`./query.mjs${q}`);
const U = await import(`./urls.mjs${q}`);
const V = await import(`./view.mjs${q}`);
const A = await import(`./admin.mjs${q}`);

const exposed = (text) => Object.assign(new Error(text), { expose: true }); // ce message peut être lu par l'assistant

/** Un événement tel que l'assistant le lit (jamais de valeur calculée interne). `full` : avec le texte, le programme et les intervenants. */
export function brief(ctx, ev, { full = false } = {}) {
  const out = {
    id: ev.id, title: ev.title, status: ev.status, state: ev.state, type: ev.type || null,
    date: ev.date || null, time: ev.time || null, end_date: ev.endDate || null, end_time: ev.endTime || null, timezone: ev.zone,
    starts_at_utc: Number.isFinite(ev.startMs) ? new Date(ev.startMs).toISOString() : null,
    place: ev.place || null, latitude: ev.lat, longitude: ev.lng,
    signup_url: ev.signupUrl || null, seats_left: ev.seatsLeft, seats_total: ev.seatsTotal,
    image: ev.image || null, video_url: ev.videoUrl || null, series: ev.series || null, created_by: ev.by,
    page: ev.status === "published" ? U.eventHref(ctx, ev, false) : null,
  };
  if (full) Object.assign(out, { text: ev.text, program: M.programText(ev.program).split("\n").filter(Boolean), speakers: M.speakersText(ev.speakers).split("\n").filter(Boolean) });
  return out;
}

/** Les arguments de l'assistant → les champs du formulaire (texte). Seuls les arguments donnés sont repris. */
export function valuesFromArgs(a = {}) {
  const out = {};
  const put = (k, v) => { if (v !== undefined && v !== null) out[k] = typeof v === "number" ? String(v) : v; };
  put("title", a.title); put("date", a.date); put("time", a.time); put("endDate", a.end_date); put("endTime", a.end_time); put("tz", a.timezone);
  put("type", a.type); put("place", a.place); put("lat", a.latitude); put("lng", a.longitude); put("text", a.text);
  if (Array.isArray(a.program)) out.program = a.program.join("\n");
  if (Array.isArray(a.speakers)) out.speakers = a.speakers.join("\n");
  put("image", a.image); put("imageAlt", a.image_alt); put("signupUrl", a.signup_url); put("seatsLeft", a.seats_left); put("seatsTotal", a.seats_total); put("videoUrl", a.video_url); put("state", a.state);
  return out;
}

const failure = (ctx, r) => {
  if (r.full) return exposed(`The calendar is full (${X.LIMITS.events} events at most).`);
  if (r.missing) return exposed("No such event: check the id with agenda_list_events.");
  return exposed(Object.entries(r.errors ?? {}).map(([f, e]) => `${f}: ${A.message(ctx, e)}`).join(" "));
};

export const mcp = {
  async agenda_list_events(ctx, args = {}) {
    const data = await D.load(ctx);
    const now = Date.now();
    const when = ["upcoming", "past", "all"].includes(args.when) ? args.when : "upcoming";
    const names = V.typeNames(ctx, data);
    const filter = { type: X.safeSlug(args.type), words: Q.words(args.q) };
    let list = data.events.filter((e) => (args.status === "published" || args.status === "draft" ? e.status === args.status : true) && (when === "all" || (when === "past" ? !e.broken && e.endMs <= now : e.broken || e.endMs > now)) && Q.matches(e, filter, names));
    if (when === "past") list = list.reverse();
    const page = Q.cursorPage(list, args.cursor, args.limit, when === "past" ? -1 : 1);
    return { items: page.items.map((e) => brief(ctx, e, { full: args.full === true })), next: page.next, total: list.length };
  },

  async agenda_get_event(ctx, args) {
    const ev = (await D.load(ctx)).byId.get(String(args.id));
    if (!ev) throw exposed("No such event: check the id with agenda_list_events.");
    return brief(ctx, ev, { full: true });
  },

  async agenda_list_types(ctx) {
    const data = await D.load(ctx);
    return data.types.map((t) => ({ id: t.key, names: t.names, color: t.color, icon: t.icon || null }));
  },

  async agenda_create_event(ctx, args) {
    const r = await O.createEvent(ctx, valuesFromArgs(args), { by: "assistant", status: "draft" });
    if (!r.ok) throw failure(ctx, r);
    let series = null;
    if (args.repeat_every) {
      const rule = await O.repeatEvent(ctx, r.id, { every: args.repeat_every, count: Number.isInteger(args.repeat_count) ? args.repeat_count : undefined, until: args.repeat_until });
      series = rule.ok ? { created: rule.count } : { error: rule.error };
    }
    const ev = (await D.load(ctx, { fresh: true })).byId.get(r.id);
    return { ok: true, note: "Saved as a DRAFT: a person must publish it from the administration.", event: ev ? brief(ctx, ev, { full: true }) : null, ...(series ? { series } : {}) };
  },

  async agenda_update_event(ctx, args) {
    const values = valuesFromArgs(args);
    const r = await O.updateEvent(ctx, String(args.id), values, { by: "assistant", keepStatus: true });
    if (!r.ok) throw failure(ctx, r);
    const ev = (await D.load(ctx, { fresh: true })).byId.get(r.id);
    return { ok: true, note: "Publication is unchanged: only a person publishes or unpublishes.", event: ev ? brief(ctx, ev, { full: true }) : null };
  },
};
