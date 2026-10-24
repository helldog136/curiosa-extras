// Un navigateur FACTICE, juste assez grand pour essayer le script des visiteurs de la mascotte : une horloge qu'on avance à la main (minuteurs compris), un stockage local et de session,
// quelques éléments (classes, attributs, événements, enfants), un faux `fetch` qui répond avec des phrases. Les minuteurs ne se déclenchent que quand le test avance l'horloge.
import vm from "node:vm";

class Node_ {
  constructor(tag) { this.tag = tag; this.children = []; this.parentNode = null; this.className = ""; this.attrs = {}; this.listeners = {}; this._text = ""; this.innerHTML = ""; this.id = ""; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); }
  appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); this.onAppend?.(c); return c; }
  insertBefore(c, ref) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; const i = this.children.indexOf(ref); this.children.splice(i < 0 ? this.children.length : i, 0, c); return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; }
  addEventListener(type, fn, opts) { (this.listeners[type] ??= []).push({ fn, once: !!opts?.once }); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] ?? []).filter((l) => l.fn !== fn); }
  dispatch(type, ev = {}) {
    for (const l of [...(this.listeners[type] ?? [])]) { if (l.once) this.removeEventListener(type, l.fn); l.fn.call(this, { type, target: this, ...ev }); }
    if (type === "click") this.onclick?.({ type, target: this });
    if (this.parentNode && ev.bubbles !== false && type === "keydown") this.parentNode.dispatch(type, ev);
  }
  click() { this.dispatch("click"); }
  has(cls) { return this.className.split(/\s+/).includes(cls); }
  walk(fn) { for (const c of this.children) { fn(c); c.walk(fn); } }
  querySelector(sel) {
    const cls = sel.startsWith(".") ? sel.slice(1) : null;
    let found = null;
    this.walk((c) => { if (!found && cls && c.has(cls)) found = c; });
    return found;
  }
}

export function makeBrowser({ now = Date.UTC(2026, 9, 24, 12, 0, 0), path = "/", search = "", small = false, reduced = false, hidden = false, storage = true, local = {}, session = {}, lines = [], fetchOk = true, cookieTray = false } = {}) {
  let t = now, nextId = 1;
  const timers = [];
  const store = (init) => { const m = new Map(Object.entries(init)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, dump: () => Object.fromEntries(m) }; };
  const ls = store(local), ss = store(session);
  const fetches = [];
  const head = new Node_("head"), body = new Node_("body");
  const docListeners = {};
  const document = {
    hidden, readyState: "complete", head, body,
    createElement: (tag) => new Node_(tag),
    getElementById: (id) => { let f = null; for (const root of [head, body]) root.walk((c) => { if (c.id === id) f = c; }); return f; },
    querySelector: (sel) => (sel === ".cookie-tray" && env.tray ? new Node_("div") : null),
    addEventListener: (type, fn) => { (docListeners[type] ??= []).push(fn); },
    removeEventListener: (type, fn) => { docListeners[type] = (docListeners[type] ?? []).filter((f) => f !== fn); },
  };
  head.appendChild = (c) => { Node_.prototype.appendChild.call(head, c); if (c.tag === "link") timers.push({ id: nextId++, at: t, fn: () => c.onload?.() }); return c; };
  const winListeners = {};
  const media = (q) => ({ matches: /prefers-reduced-motion/.test(q) ? reduced : /max-width|max-height/.test(q) ? small : false });
  const FakeDate = class extends Date { constructor(...a) { if (a.length) super(...a); else super(t); } static now() { return t; } };
  const history = { replaced: [], replaceState: (...a) => { history.replaced.push(a); } };
  const location = { pathname: path, search, hash: "" };
  const window = {
    localStorage: ls, sessionStorage: ss, matchMedia: media,
    fetch: (url, opts) => { fetches.push({ url, opts }); return fetchOk ? Promise.resolve({ ok: true, json: () => Promise.resolve({ items: typeof lines === "function" ? lines(url) : lines }) }) : Promise.resolve({ ok: false, json: () => Promise.resolve(null) }); },
    addEventListener: (type, fn) => { (winListeners[type] ??= []).push(fn); },
  };
  if (!storage) for (const k of ["localStorage", "sessionStorage"]) Object.defineProperty(window, k, { get() { throw new Error("SecurityError"); } });
  const sandbox = {
    window, document, location, history, Intl, Math, JSON, encodeURIComponent, Array, String, Number, Object, RegExp, isNaN, Date: FakeDate, console,
    setTimeout: (fn, ms) => { const id = nextId++; timers.push({ id, at: t + Math.max(0, ms || 0), fn }); return id; },
    clearTimeout: (id) => { const i = timers.findIndex((x) => x.id === id); if (i >= 0) timers.splice(i, 1); },
  };
  const env = {
    window, document, ls, ss, fetches, history, timers, body, head, sandbox, tray: cookieTray,
    get now() { return t; },
    /** Charge le script (le code envoyé aux visiteurs) dans ce navigateur. */
    load(code) { vm.runInContext(code, vm.createContext(sandbox)); return env; },
    /** Avance l'horloge de `ms` en déclenchant, dans l'ordre, les minuteurs qui tombent dedans (les promesses en cours se résolvent entre deux). */
    async advance(ms) {
      const target = t + ms;
      for (;;) {
        await new Promise((r) => setImmediate(r));
        timers.sort((a, b) => a.at - b.at || a.id - b.id);
        const next = timers[0];
        if (!next || next.at > target) break;
        timers.shift(); t = Math.max(t, next.at); next.fn();
      }
      t = target;
      await new Promise((r) => setImmediate(r));
    },
    visibility(hiddenNow) { document.hidden = hiddenNow; for (const f of [...(docListeners.visibilitychange ?? [])]) f({}); },
    root: () => { let f = null; body.walk((c) => { if (!f && c.has("mc")) f = c; }); return f; },
    bubble: () => body.querySelector(".mc-bub"),
    bubbleText: () => body.querySelector(".mc-p")?.textContent ?? null,
    buttonByLabel: (label) => { let f = null; body.walk((c) => { if (c.tag === "button" && c.textContent === label) f = c; }); return f; },
  };
  return env;
}
