// Un navigateur FACTICE, juste assez grand pour essayer le script des visiteurs du module « countdown » :
// une horloge qu'on avance à la main (avec minuteurs), quelques éléments avec attributs, et les événements de la page.
// Rien n'est simulé « en gros » : les minuteurs ne se déclenchent que quand le test avance l'horloge, dans l'ordre.

class TextNode {
  constructor(value) { this.nodeValue = value; }
}

export class FakeEl {
  constructor(tag = "div", attrs = {}) {
    this.tag = tag;
    this.attrs = { ...attrs };
    this.children = [];
    this.parent = null;
    this.hidden = "hidden" in attrs;
    this.isConnected = true;
    this.mutations = 0; // combien de fois le TEXTE a été remplacé (hors nodeValue)
    this._text = null;
  }
  append(child) { child.parent = this; this.children.push(child); return child; }
  getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  get firstChild() { return this._text; }
  get textContent() { return this._text ? this._text.nodeValue : ""; }
  set textContent(v) { this.mutations++; this._text = new TextNode(String(v)); }
  walk(fn) { for (const c of this.children) { fn(c); c.walk(fn); } }
  matches(sel) {
    const m = /^\[([a-zA-Z0-9-]+)(?:="([^"]*)")?\]$/.exec(sel);
    if (!m) throw new Error(`sélecteur non géré par le faux navigateur : ${sel}`);
    return m[1] in this.attrs && (m[2] === undefined || this.attrs[m[1]] === m[2]);
  }
  querySelectorAll(sel) { const out = []; this.walk((c) => { if (c.matches(sel)) out.push(c); }); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  closest(sel) { for (let e = this; e; e = e.parent) if (e.matches(sel)) return e; return null; }
}

/** Horloge + minuteurs + événements de la fenêtre et du document. */
export function makeBrowser({ now = Date.UTC(2026, 0, 1), hiddenTab = false, reduced = false, serverNow } = {}) {
  let t = now;
  let nextId = 1;
  const timers = [];
  const listeners = { win: {}, doc: {} };
  const observers = [];
  const fetches = [];
  const log = { setTimeouts: 0 };
  const win = {
    Date: { now: () => t },
    setTimeout(fn, ms) { log.setTimeouts++; const id = nextId++; timers.push({ id, at: t + Math.max(0, ms), fn, order: id }); return id; },
    clearTimeout(id) { const i = timers.findIndex((x) => x.id === id); if (i >= 0) timers.splice(i, 1); },
    matchMedia: () => ({ get matches() { return reduced; } }),
    MutationObserver: class { constructor(fn) { this.fn = fn; observers.push(this); } observe() {} },
    performance: { now: () => t },
    fetch(url, opts) {
      fetches.push({ url, opts });
      return Promise.resolve({ json: () => Promise.resolve({ now: serverNow ?? t }) });
    },
    addEventListener(type, fn) { (listeners.win[type] ??= []).push(fn); },
  };
  const root = new FakeEl("html");
  const body = root.append(new FakeEl("body"));
  const doc = {
    hidden: hiddenTab,
    documentElement: root,
    body,
    addEventListener(type, fn) { (listeners.doc[type] ??= []).push(fn); },
    querySelectorAll: (sel) => root.querySelectorAll(sel),
    querySelector: (sel) => root.querySelector(sel),
    getElementById: (id) => root.querySelector(`[id="${id}"]`),
  };
  const env = {
    win, doc, root, body, timers, fetches, observers, log,
    set now(v) { t = v; },
    get now() { return t; },
    /** Avance l'horloge de `ms` en déclenchant, dans l'ordre, les minuteurs qui tombent dedans. */
    advance(ms) {
      const target = t + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at || a.order - b.order);
        const next = timers[0];
        if (!next || next.at > target) break;
        timers.shift();
        t = Math.max(t, next.at);
        next.fn();
      }
      t = target;
    },
    /** Saute dans le temps SANS déclencher de minuteur (onglet gelé, ordinateur en veille). */
    jump(ms) { t += ms; },
    setHidden(v) { doc.hidden = v; for (const f of listeners.doc.visibilitychange ?? []) f(); },
    fire(type) { for (const f of listeners.win[type] ?? []) f(); },
    pending: () => timers.length,
  };
  return env;
}

/** Une carte, avec les mêmes attributs `data-vcd-*` que `render.card` (un test vérifie qu'ils correspondent). */
export function addCard(env, { start, hide = 0, allDay = false, tz = "Europe/Paris", seconds = true, serverNow, cfg = {}, ended = false } = {}) {
  const L = { today: "aujourd’hui", tomorrow: "demain", at: "à", local: "{when} chez vous", d: ["jour", "jours"], h: ["heure", "heures"], m: ["minute", "minutes"], s: ["seconde", "secondes"], srIn: "Dans {list}", and: "et", lessMin: "Dans moins d’une minute" };
  const wrap = env.body.append(new FakeEl("div", { "data-vcd-cfg": JSON.stringify({ lang: "fr", L, nowUrl: "/m/x/now", ...cfg }) }));
  const art = wrap.append(new FakeEl("article", { "data-vcd": "", "data-start": String(start), "data-hide": String(hide), "data-allday": allDay ? "1" : "0", "data-tz": tz, "data-now": String(serverNow ?? env.now), "data-seconds": seconds ? "1" : "0" }));
  const el = (tag, attrs = {}) => art.append(new FakeEl(tag, attrs));
  const card = { art, wrap };
  card.kicker = el("p", { "data-vcd-kicker": "", "data-end-text": "C’est maintenant" });
  card.kicker.textContent = "Prochain rendez-vous";
  card.event = el("p", { "data-vcd-event": "" });
  card.local = el("p", { "data-vcd-local": "", hidden: "" });
  card.run = el("div", ended ? { "data-vcd-run": "", hidden: "" } : { "data-vcd-run": "" });
  card.end = el("div", ended ? { "data-vcd-end": "" } : { "data-vcd-end": "", hidden: "" });
  card.u = {}; card.l = {};
  for (const k of ["d", "h", "m", "s"]) {
    const tile = card.run.append(new FakeEl("div", k === "s" ? { "data-vcd-t-s": "", ...(seconds ? {} : { hidden: "" }) } : {}));
    card.u[k] = tile.append(new FakeEl("span", { [`data-vcd-u-${k}`]: "" }));
    card.l[k] = tile.append(new FakeEl("span", { [`data-vcd-l-${k}`]: "" }));
    card.u[k].textContent = "0";
    card.l[k].textContent = "x";
    if (k === "s") card.tileS = tile;
  }
  card.sr = card.run.append(new FakeEl("p", { "data-vcd-sr": "" }));
  return card;
}

/** La page de la source OBS. */
export function addOverlay(env) {
  const root = env.body.append(new FakeEl("div", { id: "vco", hidden: "" }));
  const mk = (name, attrs = {}) => root.append(new FakeEl("span", { "data-o": name, ...attrs }));
  const o = { root, title: mk("title"), tiles: mk("tiles"), msg: mk("msg", { hidden: "" }) };
  for (const k of ["d", "h", "m", "s"]) {
    o[k] = mk(k);
    o[`l-${k}`] = mk(`l-${k}`);
    if (k === "s") o.tileS = mk("t-s");
  }
  // le faux élément ne cherche que dans ses enfants directs et leurs descendants : tout est déjà sous `root`.
  return o;
}
