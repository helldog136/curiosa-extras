// Compte à rebours — les événements : ce qu'on garde, comment on le vérifie, et comment on décide de ce qui s'affiche.
//
// Un événement est gardé tel que la personne l'a pensé : un JOUR, une HEURE du mur et un NOM de fuseau. L'instant exact
// (et donc le décalage de l'heure d'été ou d'hiver de CE jour-là) est calculé à la lecture : voir `view()`.
const V = new URL(import.meta.url).search; // même « version » pour les fichiers voisins : jamais d'ancien code en mémoire après une mise à jour
const T = await import(`./time.mjs${V}`);
const { ZONES } = await import(`./zones.mjs${V}`);
const KNOWN_ZONES = ZONES.map((z) => z[0]);

export const MAX_EVENTS = 100; // plafond de volume : au-delà, on demande de supprimer d'anciens événements
export const PER_PAGE = 20; // événements par page publique
export const HOUR = 3_600_000;
export const DEFAULT_DURATION = HOUR; // durée d'un événement sans heure de fin (pour l'agenda)

/** Combien de temps un événement reste affiché une fois passé. */
export const KEEP = { "1h": HOUR, "6h": 6 * HOUR, "1d": 24 * HOUR, "3d": 72 * HOUR, "7d": 168 * HOUR, "30d": 720 * HOUR, never: Infinity };
export const KEEP_KEYS = Object.keys(KEEP);
export const DEFAULT_KEEP = "1d";
export const DEFAULT_ZONE = "Europe/Paris";
const RESERVED_SLUGS = new Set(["page"]); // « /page/2 » est la pagination

// ── Petits outils ───────────────────────────────────────────────────────────────────────────────────────────────

/** Texte d'une ligne : sans caractères de contrôle ni de sens de lecture, espaces réduits, borné. */
export function clean(value, max) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Texte de plusieurs lignes (description). */
export function cleanLong(value, max) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

/** Un lien n'est repris que s'il est https, http, mailto ou une page du site : jamais `javascript:` ni `//autre-site`. */
export function safeHref(value) {
  const v = String(value ?? "").trim();
  if (!v || v.length > 500 || /[\u0000-\u001f\u007f\s]/.test(v)) return "";
  if (v.startsWith("/") && !v.startsWith("//")) return v;
  if (/^https?:\/\/[^\s/]+/i.test(v) || /^mailto:[^\s@]+@[^\s@]+$/i.test(v)) return v;
  return "";
}

/** Une image : un fichier du site (/uploads/…) ou une adresse https. */
export function safeImage(value) {
  const v = String(value ?? "").trim();
  if (!v || v.length > 500 || /[\u0000-\u001f\u007f\s"'<>]/.test(v)) return "";
  if ((v.startsWith("/") && !v.startsWith("//")) || /^https:\/\/[^\s/]+/i.test(v)) return v;
  return "";
}

/** « Sortie du jeu ! » → « sortie-du-jeu » : le nom court de l'adresse de la page de l'événement. */
export function slugify(title) {
  const s = String(title ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return s || "evenement";
}

/** Un nom court qui n'existe pas encore (sortie-du-jeu, sortie-du-jeu-2…). */
export function uniqueSlug(title, taken) {
  const base = slugify(title);
  let slug = RESERVED_SLUGS.has(base) ? `${base}-2` : base;
  for (let n = 2; taken.has(slug); n++) slug = `${base.slice(0, 36)}-${n}`;
  return slug;
}

export const isSlug = (s) => typeof s === "string" && /^[a-z0-9][a-z0-9-]{0,59}$/.test(s);

const isIso = (s) => typeof s === "string" && !Number.isNaN(Date.parse(s));

// ── Lecture d'un document du stockage ────────────────────────────────────────────────────────────────────────────

/**
 * Ce qui est gardé pour un événement (le stockage ajoute `id`) :
 *  { uid, slug, rev, title, allDay, date, time, tz, endDate, endTime, description, where, endMessage, endLinkLabel, endLink,
 *    keep, featured, image, createdAt, updatedAt }
 * `read` remet tout au propre et renvoie null pour un document abîmé (jamais d'erreur : un événement illisible disparaît seulement).
 */
export function read(row) {
  const d = row?.data;
  if (!d || typeof d !== "object") return null;
  const date = T.parseDate(d.date);
  const tz = String(d.tz ?? "");
  if (!date || !T.isValidZone(tz)) return null;
  const allDay = d.allDay === true;
  const time = allDay ? null : T.parseTimeText(d.time);
  if (!allDay && !time) return null;
  const endDate = d.endDate ? T.parseDate(d.endDate) : null;
  const endTime = !allDay && d.endTime ? T.parseTimeText(d.endTime) : null;
  const keep = KEEP_KEYS.includes(d.keep) ? d.keep : "";
  const title = clean(d.title, 80);
  if (!title) return null;
  const pad = (n) => String(n).padStart(2, "0");
  return {
    id: String(row.id),
    uid: /^[a-z0-9-]{8,64}$/i.test(String(d.uid ?? "")) ? String(d.uid) : String(row.id),
    slug: isSlug(d.slug) ? d.slug : slugify(title),
    rev: Number.isInteger(d.rev) && d.rev >= 0 ? d.rev : 0,
    title,
    allDay,
    date: `${date.y}-${pad(date.mo)}-${pad(date.d)}`,
    time: time ? `${pad(time.h)}:${pad(time.mi)}` : "",
    tz,
    endDate: endDate ? `${endDate.y}-${pad(endDate.mo)}-${pad(endDate.d)}` : "",
    endTime: endTime ? `${pad(endTime.h)}:${pad(endTime.mi)}` : "",
    description: cleanLong(d.description, 600),
    where: clean(d.where, 120),
    endMessage: clean(d.endMessage, 140),
    endLinkLabel: clean(d.endLinkLabel, 40),
    endLink: safeHref(d.endLink),
    keep,
    featured: d.featured === true,
    image: safeImage(d.image),
    createdAt: isIso(d.createdAt) ? d.createdAt : new Date(0).toISOString(),
    updatedAt: isIso(d.updatedAt) ? d.updatedAt : isIso(d.createdAt) ? d.createdAt : new Date(0).toISOString(),
  };
}

/**
 * L'événement vu à l'instant `now` : instants exacts, état, et moment où il disparaît.
 *  - startMs : l'instant du début (heure du mur + fuseau, avec les règles de CE jour-là) ;
 *  - endMs : la fin si la personne l'a donnée, sinon null ; endForCalendar : la fin à écrire dans l'agenda ;
 *  - hideMs : à partir de quand on ne l'affiche plus (Infinity = jamais) = (fin donnée, sinon début) + délai choisi ;
 *  - phase : "upcoming" (à venir) · "started" (l'heure est passée, le message de fin s'affiche) · "hidden" (masqué).
 *  - note : "gap" / "fold" quand l'heure choisie tombe sur un changement d'heure.
 */
export function view(ev, defaultKeep, now) {
  const [y, mo, d] = ev.date.split("-").map(Number);
  const [h, mi] = ev.allDay ? [0, 0] : ev.time.split(":").map(Number);
  const start = T.zonedToUtc(y, mo, d, h, mi, ev.tz);
  let endMs = null;
  let endForCalendar;
  if (ev.allDay) {
    const lastDay = ev.endDate && ev.endDate >= ev.date ? ev.endDate : ev.date;
    const after = T.parseDate(T.addDays(lastDay, 1));
    endMs = ev.endDate ? T.zonedToUtc(after.y, after.mo, after.d, 0, 0, ev.tz).ms : null;
    endForCalendar = { allDay: true, date: T.addDays(lastDay, 1) };
  } else if (ev.endDate) {
    const ed = T.parseDate(ev.endDate);
    const [eh, emi] = (ev.endTime || ev.time).split(":").map(Number);
    endMs = T.zonedToUtc(ed.y, ed.mo, ed.d, eh, emi, ev.tz).ms;
    endForCalendar = { allDay: false, ms: endMs };
  } else {
    endForCalendar = { allDay: false, ms: start.ms + DEFAULT_DURATION };
  }
  const keepKey = ev.keep || (KEEP_KEYS.includes(defaultKeep) ? defaultKeep : DEFAULT_KEEP);
  const baseline = endMs !== null && endMs > start.ms ? endMs : start.ms;
  const hideMs = baseline + KEEP[keepKey];
  const phase = now < start.ms ? "upcoming" : now < hideMs ? "started" : "hidden";
  return { ...ev, startMs: start.ms, endMs, endForCalendar, hideMs, phase, note: start.kind === "ok" ? "" : start.kind, shifted: start.shifted ?? null };
}

/** Tous les événements lisibles de l'instance, vus à l'instant `now`. 100 au plus (plafond de volume). */
export async function readAll(ctx, now = Date.now()) {
  const rows = await ctx.api.store.list("events", { limit: MAX_EVENTS + 20 });
  const keep = String(ctx.setting("keep") ?? DEFAULT_KEEP);
  return rows.map(read).filter(Boolean).map((e) => view(e, keep, now));
}

// ── Ce qui s'affiche ────────────────────────────────────────────────────────────────────────────────────────────

/** Visibles par les visiteurs : à venir ou « l'heure est passée mais pas encore masqué ». */
export const visible = (views) => views.filter((v) => v.phase !== "hidden");

/** À venir d'abord (le plus proche en premier), puis ceux dont l'heure vient de passer (le plus récent en premier). */
export function order(views) {
  const up = views.filter((v) => v.phase === "upcoming").sort((a, b) => a.startMs - b.startMs || a.title.localeCompare(b.title));
  const done = views.filter((v) => v.phase === "started").sort((a, b) => b.startMs - a.startMs);
  return [...up, ...done];
}

/** L'événement « à la une » : celui qu'on a choisi s'il est visible, sinon le prochain à venir, sinon le dernier dont l'heure est passée. */
export function pickFeatured(views) {
  const list = order(visible(views));
  return list.find((v) => v.featured) ?? list[0] ?? null;
}

/**
 * Pour la source OBS : un événement à venir, ou dont l'heure vient de passer depuis moins de `endMs`. `slug` (facultatif) demande un événement précis.
 * Un événement masqué n'est jamais montré, même demandé par son nom.
 */
export function pickForOverlay(views, now, endMs, slug) {
  const ok = (v) => v.phase === "upcoming" || (v.phase === "started" && now < v.startMs + endMs);
  const list = order(views.filter(ok));
  if (slug) return list.find((v) => v.slug === slug) ?? null;
  // Un événement dont l'heure vient de passer garde l'écran pendant son message de fin ; sinon la une, sinon le prochain.
  const justStarted = list.filter((v) => v.phase === "started");
  return justStarted.find((v) => v.featured) ?? justStarted[0] ?? list.find((v) => v.featured) ?? list[0] ?? null;
}

/**
 * Événement montré par un ÉLÉMENT de page d'overlay (option « Événement ») : celui qui est demandé s'il existe encore, sinon l'événement à la une.
 * Un nom court inconnu (événement supprimé, faute de frappe) ne casse rien : repli sur la une. Un événement qui existe mais qui est fini ou masqué n'affiche rien, comme l'overlay.
 */
export function pickForElement(views, now, endMs, slug) {
  return pickForOverlay(views, now, endMs, slug && views.some((v) => v.slug === slug) ? slug : "");
}

// ── Vérification de ce que la personne a tapé ───────────────────────────────────────────────────────────────────

/**
 * Transforme les champs du formulaire en événement, ou renvoie `errors` : { champ: "err_…" } (une clé de locales/, le champ dit où l'afficher).
 * `values` = texte (comme reçu d'un formulaire). `ctxInfo` = { zone (fuseau par défaut), existing (événement modifié, ou null), takenSlugs, now }.
 */
export function buildEvent(values, { zone, existing = null, takenSlugs = new Set(), now = Date.now() }) {
  const errors = {};
  const v = (k) => String(values?.[k] ?? "");
  const on = (k) => ["on", "1", "true", "yes"].includes(v(k).toLowerCase());

  const title = clean(v("title"), 80);
  if (!title) errors.title = "err_title";

  const allDay = on("allDay");
  const date = T.parseDate(v("date"));
  if (!date) errors.date = "err_date";

  let time = null;
  if (!allDay) {
    time = T.parseTimeText(v("time"));
    if (!time) errors.time = "err_time";
  }

  let tz = zone;
  const other = v("tzOther").trim();
  if (other) {
    tz = T.canonicalZone(other, KNOWN_ZONES);
    if (!tz) errors.tzOther = "err_zone";
  } else if (v("tz").trim()) {
    tz = T.canonicalZone(v("tz").trim(), KNOWN_ZONES);
    if (!tz) errors.tz = "err_zone";
  }

  const endDateRaw = v("endDate").trim();
  const endTimeRaw = v("endTime").trim();
  let endDate = null;
  let endTime = null;
  if (endDateRaw || endTimeRaw) {
    endDate = T.parseDate(endDateRaw || v("date"));
    if (!endDate) errors.endDate = "err_date";
    if (!allDay && endTimeRaw) {
      endTime = T.parseTimeText(endTimeRaw);
      if (!endTime) errors.endTime = "err_time";
    } else if (!allDay && !endTimeRaw) errors.endTime = "err_end_time";
  }

  const endLinkRaw = v("endLink").trim();
  const endLink = safeHref(endLinkRaw);
  if (endLinkRaw && !endLink) errors.endLink = "err_link";
  const imageRaw = v("image").trim();
  const image = safeImage(imageRaw);
  if (imageRaw && !image) errors.image = "err_image";
  const keepRaw = v("keep").trim();
  if (keepRaw && !KEEP_KEYS.includes(keepRaw)) errors.keep = "err_keep";

  if (Object.keys(errors).length) return { ok: false, errors };

  const pad = (n) => String(n).padStart(2, "0");
  const stamp = new Date(now).toISOString();
  const data = {
    uid: existing?.uid ?? globalThis.crypto.randomUUID(),
    slug: existing?.slug ?? uniqueSlug(title, takenSlugs),
    rev: (existing?.rev ?? 0) + 1,
    title,
    allDay,
    date: `${date.y}-${pad(date.mo)}-${pad(date.d)}`,
    time: time ? `${pad(time.h)}:${pad(time.mi)}` : "",
    tz,
    endDate: endDate ? `${endDate.y}-${pad(endDate.mo)}-${pad(endDate.d)}` : "",
    endTime: endTime ? `${pad(endTime.h)}:${pad(endTime.mi)}` : "",
    description: cleanLong(v("description"), 600),
    where: clean(v("where"), 120),
    endMessage: clean(v("endMessage"), 140),
    endLinkLabel: clean(v("endLinkLabel"), 40),
    endLink,
    keep: keepRaw,
    featured: on("featured"),
    image,
    createdAt: existing?.createdAt ?? stamp,
    updatedAt: stamp,
  };

  // La fin doit venir après le début (dans le fuseau de l'événement).
  const probe = read({ id: "probe", data });
  if (!probe) return { ok: false, errors: { date: "err_date" } };
  const seen = view(probe, DEFAULT_KEEP, now);
  if (data.endDate) {
    const endOk = seen.allDay ? data.endDate >= data.date : seen.endMs > seen.startMs;
    if (!endOk) return { ok: false, errors: { endDate: "err_end_before" } };
  }
  return { ok: true, data, note: seen.note, shifted: seen.shifted, view: seen };
}
