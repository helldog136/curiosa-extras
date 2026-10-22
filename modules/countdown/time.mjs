// Compte à rebours — tout ce qui touche au TEMPS, en un seul endroit, sans aucune dépendance.
//
// Deux familles de fonctions :
//  - celles du SERVEUR seulement (convertir « 21 h à Paris le 29 mars » en instant exact, lire une heure tapée à la main…) ;
//  - celles du SERVEUR ET du NAVIGATEUR (CLIENT_FUNCTIONS ci-dessous) : le navigateur reçoit le texte même de ces fonctions
//    (Function.prototype.toString), donc le serveur, les tests et la page du visiteur exécutent EXACTEMENT le même code.
//    Règle : une fonction de cette famille ne dépend de rien d'autre que des autres fonctions de la liste et des globales
//    du navigateur (Intl, Date, Math, JSON). Elle n'écrit donc jamais de constante hors de son corps.
//
// Principe central : un événement est gardé comme « jour + heure du mur + nom du fuseau » (2026-03-29, 21:00, Europe/Paris),
// jamais comme un décalage fixe (+01:00). L'instant exact se calcule À LA LECTURE avec les règles de l'heure d'été de CE jour-là.

// ───────────────────────────── Famille serveur + navigateur ─────────────────────────────

/** « fr-BE » → « fr ». */
export function baseLang(l) {
  return String(l || "en").slice(0, 2).toLowerCase();
}

export function pad2(n) {
  return n < 10 ? "0" + n : "" + n;
}

/** Majuscule initiale (les noms de jours français sont en minuscules). */
export function cap(s) {
  s = String(s);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Les éléments du calendrier mural d'un instant dans un fuseau : { y, mo (1-12), d, h, mi, s, wd (0 = dimanche) }. */
export function zoneParts(ms, tz) {
  var cache = zoneParts.cache || (zoneParts.cache = {});
  var f = cache[tz];
  if (!f) {
    f = cache[tz] = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", second: "numeric", weekday: "short",
    });
  }
  var p = {};
  f.formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
  return {
    y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second,
    wd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday),
  };
}

/** Formate un instant dans un fuseau avec Intl (les formateurs sont gardés : en créer un coûte cher). Langue inconnue → anglais. */
export function fmtIn(ms, tz, lang, opts) {
  var cache = fmtIn.cache || (fmtIn.cache = {});
  var key = tz + "|" + lang + "|" + JSON.stringify(opts);
  var f = cache[key];
  if (!f) {
    var o = {};
    for (var k in opts) o[k] = opts[k];
    o.timeZone = tz;
    try { f = new Intl.DateTimeFormat(lang, o); } catch (e) { f = new Intl.DateTimeFormat("en", o); }
    cache[key] = f;
  }
  return f.format(new Date(ms));
}

/** L'heure en toutes lettres : « 21 h », « 21 h 30 », « minuit » (fr) · « 9 pm », « 9:30 pm », « noon » (en) · « 21:30 » (autres langues). */
export function clockText(h, mi, lang) {
  var l = baseLang(lang);
  if (l === "fr") {
    if (mi === 0 && h === 0) return "minuit";
    if (mi === 0 && h === 12) return "midi";
    return mi === 0 ? h + " h" : h + " h " + pad2(mi);
  }
  if (l === "en") {
    if (mi === 0 && h === 0) return "midnight";
    if (mi === 0 && h === 12) return "noon";
    var hh = h % 12 === 0 ? 12 : h % 12;
    return (mi === 0 ? hh : hh + ":" + pad2(mi)) + " " + (h < 12 ? "am" : "pm");
  }
  return pad2(h) + ":" + pad2(mi);
}

/** « jour » / « jours » : le français met 0 et 1 au singulier. */
export function plural(n, forms, lang) {
  var one = baseLang(lang) === "fr" ? n < 2 : n === 1;
  return one ? forms[0] : forms[1];
}

/** Temps restant → jours, heures, minutes, secondes. Les secondes sont ARRONDIES VERS LE HAUT : à 0,4 s de l'heure on lit encore « 1 ». */
export function breakdown(remMs) {
  var S = Math.max(0, Math.ceil(remMs / 1000));
  return { S: S, d: Math.floor(S / 86400), h: Math.floor((S % 86400) / 3600), m: Math.floor((S % 3600) / 60), s: S % 60 };
}

/**
 * Dans combien de millisecondes (de 1 à 1000, ou 60 000 au plus en mode minutes) ce qui est AFFICHÉ change-t-il ?
 * Le compteur n'est jamais « décrémenté » : on recalcule toujours depuis l'heure cible, et on se réveille pile à la prochaine
 * valeur, donc aucun retard ne s'accumule, même si le navigateur endort l'onglet.
 */
export function nextDelay(remMs, withSeconds) {
  if (remMs <= 0) return 0;
  var S = Math.ceil(remMs / 1000);
  if (withSeconds) return remMs - (S - 1) * 1000;
  var M = Math.floor(S / 60);
  if (M < 1) return remMs;
  return remMs - (60 * M - 1) * 1000;
}

/** Le nom lisible d'un fuseau (« heure d'Europe centrale », « Central European Time »). */
export function zoneName(ms, tz, lang) {
  var kinds = ["longGeneric", "short"];
  for (var i = 0; i < kinds.length; i++) {
    try {
      var parts = new Intl.DateTimeFormat(lang, { timeZone: tz, timeZoneName: kinds[i] }).formatToParts(new Date(ms));
      for (var j = 0; j < parts.length; j++) if (parts[j].type === "timeZoneName") return parts[j].value;
    } catch (e) { /* on essaie la forme suivante */ }
  }
  return tz;
}

/** Même jour et même heure sur le mur, dans deux fuseaux ? */
export function sameWall(ms, tzA, tzB) {
  var a = zoneParts(ms, tzA), b = zoneParts(ms, tzB);
  return a.y === b.y && a.mo === b.mo && a.d === b.d && a.h === b.h && a.mi === b.mi;
}

/**
 * « samedi à 21 h » · « demain à 21 h » · « samedi 14 novembre 2026 à 21 h ».
 * relative : vrai = « aujourd'hui », « demain » et le simple nom du jour pour la semaine qui vient (jours comptés sur le calendrier du fuseau) ;
 * faux = toujours la date complète avec l'année. allDay : seulement le jour, sans heure.
 */
export function whenText(ms, nowMs, tz, lang, L, relative, allDay) {
  var p = zoneParts(ms, tz), n = relative ? zoneParts(nowMs, tz) : null, day = "";
  if (relative) {
    var diff = Math.round((Date.UTC(p.y, p.mo - 1, p.d) - Date.UTC(n.y, n.mo - 1, n.d)) / 86400000);
    if (diff === 0) day = L.today;
    else if (diff === 1) day = L.tomorrow;
    else if (diff > 1 && diff < 7) day = fmtIn(ms, tz, lang, { weekday: "long" });
  }
  if (!day) {
    var o = { weekday: "long", day: "numeric", month: "long" };
    if (!relative || p.y !== n.y) o.year = "numeric";
    day = fmtIn(ms, tz, lang, o);
  }
  return allDay ? day : day + " " + L.at + " " + clockText(p.h, p.mi, lang);
}

/**
 * Les deux phrases de la carte :
 *  - event : la date et l'heure DANS LE FUSEAU DE L'ÉVÉNEMENT (c'est ce que lit un visiteur sans JavaScript) ;
 *  - local : « samedi à 21 h chez vous », dans le fuseau du visiteur (viewerTz vide = inconnu → pas de phrase locale).
 * Si le visiteur est sur la même heure que l'événement, `event` est vide : une seule phrase suffit.
 */
export function linesFor(ms, nowMs, eventTz, viewerTz, lang, L, allDay) {
  var ev = cap(whenText(ms, nowMs, eventTz, lang, L, false, allDay)) + (allDay ? "" : " (" + zoneName(ms, eventTz, lang) + ")");
  if (allDay || !viewerTz) return { event: ev, local: "" };
  var local = cap(L.local.replace("{when}", whenText(ms, nowMs, viewerTz, lang, L, true, false)));
  return { event: sameWall(ms, eventTz, viewerTz) ? "" : ev, local: local };
}

/** La phrase lue par un lecteur d'écran : « Dans 3 jours, 4 heures et 12 minutes ». */
export function srText(b, L, lang) {
  var parts = [];
  if (b.d) parts.push(b.d + " " + plural(b.d, L.d, lang));
  if (b.h) parts.push(b.h + " " + plural(b.h, L.h, lang));
  if (b.m) parts.push(b.m + " " + plural(b.m, L.m, lang));
  if (!parts.length) return L.lessMin;
  var list = parts.length === 1 ? parts[0] : parts.slice(0, -1).join(", ") + " " + L.and + " " + parts[parts.length - 1];
  return L.srIn.replace("{list}", list);
}

/**
 * La page du visiteur : trouve les compteurs (`[data-vcd]`), les fait vivre, et les retrouve quand la page change sans rechargement.
 *  - Chaque affichage est RECALCULÉ depuis l'heure cible et l'heure du moment : rien n'est jamais décrémenté, donc aucune dérive.
 *  - Quand l'onglet est caché, plus aucun minuteur ne tourne ; au retour, tout est recalculé d'un coup.
 *  - « Mouvement réduit » demandé par le visiteur : pas de secondes, un seul changement par minute.
 *  - L'horloge de l'appareil est vérifiée contre celle du serveur seulement si elle semble fausse (écart de plus de 5 s).
 * `win` et `doc` sont passés en paramètres pour pouvoir essayer ce code sans navigateur.
 */
export function bootCountdowns(win, doc) {
  var states = [], timer = null, skew = 0, skewDone = false, pendingScan = false, mq = null, viewerTz = "";
  try { mq = win.matchMedia ? win.matchMedia("(prefers-reduced-motion: reduce)") : null; } catch (e) { mq = null; }
  try { viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { viewerTz = ""; }

  function now() { return win.Date.now() - skew; }
  function reduced() { return !!(mq && mq.matches); }
  function q(el, name) { return el.querySelector("[data-vcd-" + name + "]"); }
  // On change le texte d'un nœud existant (nodeValue) : cela ne réveille pas l'observateur de changements de la page.
  function setText(node, v) {
    if (!node) return;
    v = String(v);
    if (node.firstChild) { if (node.firstChild.nodeValue !== v) node.firstChild.nodeValue = v; } else node.textContent = v;
  }
  function cfgOf(el) {
    var w = el.closest ? el.closest("[data-vcd-cfg]") : null;
    if (!w) return {};
    if (!w._vcd) { try { w._vcd = JSON.parse(w.getAttribute("data-vcd-cfg")); } catch (e) { w._vcd = {}; } }
    return w._vcd;
  }

  function init(el) {
    var cfg = cfgOf(el);
    var s = {
      el: el, L: cfg.L || { d: ["", ""], h: ["", ""], m: ["", ""], s: ["", ""] }, lang: cfg.lang || "en", cfg: cfg,
      start: +el.getAttribute("data-start"), hide: +el.getAttribute("data-hide") || 0,
      allDay: el.getAttribute("data-allday") === "1", tz: el.getAttribute("data-tz") || "UTC", wantSec: el.getAttribute("data-seconds") !== "0",
      run: q(el, "run"), end: q(el, "end"), ev: q(el, "event"), loc: q(el, "local"), sr: q(el, "sr"),
      u: { d: q(el, "u-d"), h: q(el, "u-h"), m: q(el, "u-m"), s: q(el, "u-s") },
      l: { d: q(el, "l-d"), h: q(el, "l-h"), m: q(el, "l-m"), s: q(el, "l-s") },
      tileS: q(el, "t-s"), showSec: null, minute: -1, srMinute: -1, ended: false, gone: false,
    };
    return s;
  }

  function ensureSkew(s) {
    if (skewDone || !s.cfg.nowUrl) return;
    skewDone = true;
    var server = +s.el.getAttribute("data-now");
    if (!server || Math.abs(win.Date.now() - server) <= 5000) return;
    var perf = win.performance, t0 = perf ? perf.now() : 0, d0 = win.Date.now();
    try {
      win.fetch(s.cfg.nowUrl, { cache: "no-store", credentials: "omit" })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j || typeof j.now !== "number") return;
          var rtt = (perf ? perf.now() : 0) - t0;
          skew = d0 + rtt / 2 - j.now;
          tick();
        })
        .catch(function () { /* on garde l'horloge de l'appareil */ });
    } catch (e) { /* idem */ }
  }

  function writeLines(s, t) {
    var r = linesFor(s.start, t, s.tz, viewerTz, s.lang, s.L, s.allDay);
    if (s.ev) { setText(s.ev, r.event); s.ev.hidden = !r.event; }
    if (s.loc) { setText(s.loc, r.local); s.loc.hidden = !r.local; }
  }

  /** Met à jour un compteur ; renvoie dans combien de ms il faut le revoir (0 = jamais, il est fini). */
  function update(s, t) {
    var rem = s.start - t;
    if (rem > 0) {
      var showSec = s.wantSec && !reduced(), b = breakdown(rem);
      if (s.showSec !== showSec) { s.showSec = showSec; if (s.tileS) s.tileS.hidden = !showSec; }
      if (s.run && s.run.hidden) { s.run.hidden = false; if (s.end) s.end.hidden = true; s.ended = false; }
      setText(s.u.d, b.d); setText(s.u.h, pad2(b.h)); setText(s.u.m, pad2(b.m));
      if (showSec) setText(s.u.s, pad2(b.s));
      ["d", "h", "m", "s"].forEach(function (k) { setText(s.l[k], plural(b[k], s.L[k], s.lang)); });
      var minute = Math.floor(t / 60000);
      if (minute !== s.minute) { s.minute = minute; writeLines(s, t); }
      var srMinute = Math.floor(b.S / 60);
      if (srMinute !== s.srMinute) { s.srMinute = srMinute; setText(s.sr, srText(b, s.L, s.lang)); }
      return nextDelay(rem, showSec);
    }
    if (!s.ended) {
      s.ended = true;
      if (s.run) s.run.hidden = true;
      if (s.end) s.end.hidden = false;
      s.el.setAttribute("data-vcd-state", "started");
    }
    if (s.hide && t >= s.hide) { s.el.hidden = true; s.gone = true; return 0; }
    return s.hide ? s.hide - t : 0;
  }
  function tick() {
    win.clearTimeout(timer);
    timer = null;
    if (doc.hidden) return;
    var t = now(), wait = 0;
    states = states.filter(function (s) { return !s.gone && s.el.isConnected !== false; });
    states.forEach(function (s) {
      var d = update(s, t);
      if (d > 0) wait = wait ? Math.min(wait, d) : d;
    });
    if (wait) timer = win.setTimeout(tick, Math.max(1, Math.min(60000, wait)));
  }

  function scan() {
    var list = doc.querySelectorAll("[data-vcd]");
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el._vcdOn) continue;
      el._vcdOn = true;
      var s = init(el);
      states.push(s);
      ensureSkew(s);
    }
    tick();
  }

  doc.addEventListener("visibilitychange", function () {
    if (doc.hidden) { win.clearTimeout(timer); timer = null; } else tick();
  });
  win.addEventListener("pageshow", tick);
  if (win.MutationObserver) {
    new win.MutationObserver(function () {
      if (pendingScan) return;
      pendingScan = true;
      win.setTimeout(function () { pendingScan = false; scan(); }, 60);
    }).observe(doc.documentElement, { childList: true, subtree: true });
  }
  scan();
  return { scan: scan, tick: tick, now: now, states: function () { return states; }, skew: function () { return skew; } };
}

/**
 * La source navigateur pour OBS : un seul compte à rebours, sobre, sur fond transparent. Même principe que la page
 * (recalcul depuis l'heure cible, pause quand la source n'est pas visible), plus une question au serveur toutes les
 * `cfg.poll` ms pour apprendre un changement d'événement et recaler l'horloge.
 */
export function bootOverlay(win, doc, cfg) {
  var root = doc.getElementById("vco"), timer = null, pollTimer = null, skew = 0, cur = null, shownSec = null;
  var L = cfg.L, lang = cfg.lang;
  function el(name) { return root.querySelector('[data-o="' + name + '"]'); }
  function setText(node, v) {
    if (!node) return;
    v = String(v);
    if (node.firstChild) { if (node.firstChild.nodeValue !== v) node.firstChild.nodeValue = v; } else node.textContent = v;
  }
  function now() { return win.Date.now() - skew; }

  function render() {
    win.clearTimeout(timer);
    timer = null;
    var t = now();
    if (!cur || (cur.hideAt && t >= cur.hideAt)) { root.hidden = true; return; }
    root.hidden = false;
    setText(el("title"), cur.title);
    var rem = cur.start - t, tiles = el("tiles"), msg = el("msg");
    if (rem > 0) {
      var b = breakdown(rem);
      tiles.hidden = false; msg.hidden = true;
      setText(el("d"), b.d); setText(el("h"), pad2(b.h)); setText(el("m"), pad2(b.m));
      if (cfg.secs) setText(el("s"), pad2(b.s));
      ["d", "h", "m", "s"].forEach(function (k) { setText(el("l-" + k), plural(b[k], L[k], lang)); });
      if (shownSec !== cfg.secs) { shownSec = cfg.secs; el("t-s").hidden = !cfg.secs; }
      root.setAttribute("data-state", "upcoming");
      if (!doc.hidden) timer = win.setTimeout(render, Math.max(1, Math.min(60000, nextDelay(rem, cfg.secs))));
    } else {
      tiles.hidden = true; msg.hidden = false;
      setText(msg, cur.message);
      root.setAttribute("data-state", "started");
      if (cur.hideAt && !doc.hidden) timer = win.setTimeout(render, Math.max(1, Math.min(60000, cur.hideAt - t)));
    }
  }

  function accept(state, d0, rtt) {
    if (!state || typeof state.now !== "number") return;
    if (d0 !== null) skew = d0 + rtt / 2 - state.now;
    var e = state.event;
    cur = e && typeof e.start === "number" ? { slug: e.slug, title: String(e.title || ""), start: e.start, hideAt: e.hideAt || 0, message: String(e.message || "") } : null;
    render();
  }

  function poll() {
    win.clearTimeout(pollTimer);
    pollTimer = win.setTimeout(poll, cfg.poll);
    if (doc.hidden) return;
    var perf = win.performance, t0 = perf ? perf.now() : 0, d0 = win.Date.now();
    try {
      win.fetch(cfg.stateUrl, { cache: "no-store", credentials: "omit" })
        .then(function (r) { return r.json(); })
        .then(function (j) { accept(j, d0, (perf ? perf.now() : 0) - t0); })
        .catch(function () { /* on garde ce qui est affiché : le compte à rebours continue tout seul */ });
    } catch (e) { /* idem */ }
  }

  doc.addEventListener("visibilitychange", function () {
    if (doc.hidden) { win.clearTimeout(timer); timer = null; } else { render(); poll(); }
  });
  skew = win.Date.now() - (cfg.initial && cfg.initial.now ? cfg.initial.now : win.Date.now());
  if (Math.abs(skew) <= 5000) skew = 0;
  accept(cfg.initial, null, 0);
  pollTimer = win.setTimeout(poll, 1500);
  return { render: render, poll: poll, now: now, current: function () { return cur; }, skew: function () { return skew; } };
}

/** Ce qui est envoyé au navigateur. L'ordre n'a pas d'importance (ce sont des déclarations de fonctions). */
export const CLIENT_FUNCTIONS = [baseLang, pad2, cap, zoneParts, fmtIn, clockText, plural, breakdown, nextDelay, zoneName, sameWall, whenText, linesFor, srText, bootCountdowns, bootOverlay];

/** Le code des fonctions communes, tel qu'il est écrit ci-dessus. */
export function clientSource() {
  return CLIENT_FUNCTIONS.map((f) => f.toString()).join("\n");
}

// ───────────────────────────── Famille serveur seulement ─────────────────────────────

const DAY = 86_400_000;

/** Un vrai nom de fuseau (Europe/Paris, America/Argentina/Buenos_Aires, UTC) — jamais un décalage (+01:00) ni un texte libre. */
export function isValidZone(tz) {
  if (typeof tz !== "string" || tz.length < 3 || tz.length > 64) return false;
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Le nom du fuseau avec ses majuscules officielles (« europe/paris » → « Europe/Paris »), ou « » s'il n'existe pas. */
export function canonicalZone(tz) {
  if (!isValidZone(tz)) return "";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz }).resolvedOptions().timeZone;
  } catch {
    return "";
  }
}

/** Décalage (ms) de l'heure du mur sur l'heure universelle à cet instant : +3 600 000 pour Paris en hiver, +7 200 000 en été. */
export function offsetAt(ms, tz) {
  const p = zoneParts(ms, tz);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

/**
 * « 21:00 le 29 mars à Paris » → l'instant exact (ms depuis 1970).
 *  - kind "ok"   : l'heure existe une fois ;
 *  - kind "gap"  : l'heure n'existe pas (passage à l'heure d'été : 02:30 saute à 03:30) → on prend l'heure d'après, comme les agendas ;
 *  - kind "fold" : l'heure existe deux fois (retour à l'heure d'hiver : 02:30 passe deux fois) → on prend la première (heure d'été).
 * `shifted` (gap) : l'heure du mur réellement obtenue.
 */
export function zonedToUtc(y, mo, d, h, mi, tz) {
  const wall = Date.UTC(y, mo - 1, d, h, mi, 0);
  const before = offsetAt(wall - DAY, tz), after = offsetAt(wall + DAY, tz);
  const valid = [...new Set(before === after ? [before] : [before, after])].map((o) => wall - o).filter((t) => offsetAt(t, tz) === wall - t).sort((a, b) => a - b);
  if (valid.length === 1) return { ms: valid[0], kind: "ok" };
  if (valid.length > 1) return { ms: valid[0], kind: "fold" };
  const ms = wall - before;
  const p = zoneParts(ms, tz);
  return { ms, kind: "gap", shifted: { h: p.h, mi: p.mi } };
}

/** « 2026-03-29 » → { y, mo, d } si le jour existe vraiment (pas de 30 février) et reste entre 2000 et 2100. */
export function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? "").trim());
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (y < 2000 || y > 2100 || t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return { y, mo, d };
}

/** Le jour d'après (ou d'avant) un jour « 2026-03-29 ». */
export function addDays(dateStr, n) {
  const p = parseDate(dateStr);
  if (!p) return null;
  return new Date(Date.UTC(p.y, p.mo - 1, p.d) + n * DAY).toISOString().slice(0, 10);
}

/** Une heure tapée à la main : « 21:00 », « 21h », « 21h30 », « 21 h 30 », « 9pm », « 9:30 pm » → { h, mi } ou null. */
export function parseTimeText(raw) {
  const m = /^(\d{1,2})\s*(?:[:h.]\s*(\d{2})?)?\s*(am|pm)?$/.exec(String(raw ?? "").trim().toLowerCase().replace(/\s+/g, " "));
  if (!m) return null;
  let h = +m[1];
  const mi = m[2] === undefined ? 0 : +m[2];
  if (mi > 59) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3] === "pm" ? 12 : 0);
  } else if (h > 23) return null;
  return { h, mi };
}

/** « 2026-03-29T01:30:00Z » sous la forme des agendas : 20260329T013000Z. */
export function icsStamp(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Le jour d'un instant, dans un fuseau, sous la forme 2026-03-29. */
export function dayIn(ms, tz) {
  const p = zoneParts(ms, tz);
  return `${String(p.y).padStart(4, "0")}-${pad2(p.mo)}-${pad2(p.d)}`;
}
