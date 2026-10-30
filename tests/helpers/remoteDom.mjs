// Un navigateur FACTICE, juste assez grand pour faire tourner le VRAI script de la télécommande (celui de la page du téléphone comme celui du dock).
// Les requêtes du script (état, appuis) sont envoyées aux VRAIES routes du module ; les minuteurs ne partent que quand le test avance l'horloge.
import vm from "node:vm";

const ATTR_SEL = /^([a-zA-Z0-9]*)((?:\.[\w-]+)*)((?:\[[\w-]+(?:="[^"]*")?\])*)$/;

export class El {
  constructor(tag, doc) { this.tagName = tag.toUpperCase(); this.doc = doc; this.attrs = {}; this.children = []; this.parent = null; this.listeners = {}; this.hidden = false; this.disabled = false; this._v = ""; this.open = false; this.type = ""; this.name = ""; this.id = ""; this._cls = new Set(); this._text = ""; }
  get value() { if (this.tagName === "SELECT") { const o = this.children.find((c) => c.selected) ?? this.children[0]; return o ? o.value : ""; } return this._v; }
  set value(v) { this._v = String(v); }
  get className() { return [...this._cls].join(" "); }
  set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get classList() { const s = this._cls; return { add: (c) => s.add(c), remove: (c) => s.delete(c), contains: (c) => s.has(c) }; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  appendChild(c) { if (c.isFragment) { for (const x of c.children) { x.parent = this; this.children.push(x); } c.children = []; return c; } c.parent = this; this.children.push(c); return c; }
  replaceChildren(...nodes) { for (const c of this.children) c.parent = null; this.children = []; for (const n of nodes) this.appendChild(n); if (this.doc.active && !this.doc.body.contains(this.doc.active)) this.doc.active = null; }
  get textContent() { return this.isText ? this._text : this._text + this.children.map((c) => c.textContent).join(""); }
  set textContent(v) { for (const c of this.children) c.parent = null; this.children = []; this._text = String(v); }
  get isConnected() { return this.doc.body.contains(this); }
  contains(n) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter((f) => f !== fn); }
  dispatch(t, extra = {}) { const ev = { type: t, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra }; for (const f of this.listeners[t] || []) f.call(this, ev); return ev; }
  focus() { if (!this.disabled && this.contains(this) && this.doc.body.contains(this)) this.doc.active = this; }
  click() { if (!this.disabled) this.dispatch("click"); }
  get options() { return this.children; }
  matches(sel) {
    const m = ATTR_SEL.exec(sel.trim());
    if (!m) throw new Error(`sélecteur non géré : ${sel}`);
    const [, tag, cls, attrs] = m;
    if (tag && this.tagName !== tag.toUpperCase()) return false;
    for (const c of cls.split(".").filter(Boolean)) if (!this._cls.has(c)) return false;
    for (const a of attrs.match(/\[[^\]]+\]/g) ?? []) {
      const [, k, v] = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(a);
      if (k === "open" ? !this.open : !(k in this.attrs)) return false;
      if (v !== undefined && this.attrs[k] !== v) return false;
    }
    return true;
  }
  all(sel) { const out = []; const sels = sel.split(","); const walk = (n) => { for (const c of n.children) { if (!c.isText && sels.some((s) => c.matches(s))) out.push(c); walk(c); } }; walk(this); return out; }
  querySelectorAll(sel) { return this.all(sel); }
  querySelector(sel) { return this.all(sel)[0] ?? null; }
}

/** Fait tourner le script de la page `html` (téléphone ou dock) contre les routes du module. `dispatch(url, init)` répond comme le serveur. */
export function runRemotePage(html, { dispatch, base = "https://x.test" }) {
  const script = /<script nonce="([^"]*)">([\s\S]*?)<\/script>/.exec(html);
  const doc = { active: null, hidden: false, listeners: {} };
  doc.body = new El("body", doc);
  const byId = {};
  for (const m of html.matchAll(/<(\w+)[^>]*\sid="(ar-[\w-]+)"[^>]*>/g)) { const e = new El(m[1], doc); e.id = m[2]; if (/\shidden[\s>]/.test(m[0])) e.hidden = true; byId[m[2]] = e; doc.body.appendChild(e); }
  doc.getElementById = (id) => byId[id] ?? null;
  doc.createElement = (t) => new El(t, doc);
  doc.createTextNode = (t) => { const e = new El("#text", doc); e.isText = true; e._text = String(t); return e; };
  doc.createDocumentFragment = () => { const e = new El("#frag", doc); e.isFragment = true; return e; };
  doc.addEventListener = (t, fn) => { (doc.listeners[t] ||= []).push(fn); };
  doc.removeEventListener = () => {};
  Object.defineProperty(doc, "activeElement", { get: () => doc.active ?? doc.body });

  const timers = []; let clock = 0, tid = 0;
  const win = {
    document: doc, JSON, Math, Date, Number, String, Promise, Object, Array, AbortSignal, Error, Uint8Array, encodeURIComponent, parseInt,
    setTimeout: (fn, ms) => { timers.push({ id: ++tid, at: clock + (ms || 0), fn }); return tid; },
    clearTimeout: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    fetch: async (url, init = {}) => {
      const r = await dispatch(new URL(url, base).href, init);
      return { ok: r.status >= 200 && r.status < 300, status: r.status, json: () => r.json() };
    },
  };
  win.window = win;
  const ctx = vm.createContext(win);
  const cfgSrc = /window\.__AR=(\{[\s\S]*?\});\(function/.exec(script[2])[1];
  vm.runInContext(script[2], ctx);
  const flush = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
  return {
    doc, root: byId["ar-root"], toast: byId["ar-toast"], live: byId["ar-live"], cfg: JSON.parse(cfgSrc), flush,
    /** Avance l'horloge : lance les minuteurs échus (dans l'ordre), puis laisse les réponses arriver. */
    async advance(ms) { const end = clock + ms; for (;;) { timers.sort((a, b) => a.at - b.at || a.id - b.id); const t = timers[0]; if (!t || t.at > end) break; timers.shift(); clock = Math.max(clock, t.at); t.fn(); await flush(); } clock = end; await flush(); },
    pending: () => timers.length,
    buttons: () => doc.getElementById("ar-root").all("button").map((b) => b.textContent),
  };
}
