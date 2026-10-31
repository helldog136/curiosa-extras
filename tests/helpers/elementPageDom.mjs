// Un navigateur FACTICE pour la page d'un ÉLÉMENT d'overlay à rotation (Bandeau défilant, Avis de la communauté, Mascotte) : il fait tourner le VRAI script de la page contre les VRAIES routes du module.
// L'horloge est simulée (Date.now() et les minuteurs avancent ensemble, seulement quand le test l'ordonne) : deux « lecteurs » ouverts au même instant doivent afficher la même chose.
import vm from "node:vm";

class FEl {
  constructor(id, hidden = false) { this.id = id; this.textContent = ""; this.hidden = hidden; this._c = new Set(); this.attrs = {}; this.style = {}; this.src = ""; this.clientWidth = 400; this.clientHeight = 300; this.scrollHeight = 100; this.offsetWidth = 1; }
  get classList() { const s = this._c; return { add: (c) => s.add(c), remove: (c) => s.delete(c), contains: (c) => s.has(c) }; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  get on() { return this._c.has("on"); }
}

/**
 * @param {{ html: string, script: string, json?: string }} page `html` : le code de la page (pour retrouver les éléments par `id`) ; `script` : le script à faire tourner ; `json` : le contenu du bloc `<script type="application/json" id="d">`
 * @param {{ dispatch: (url: string) => Promise<Response>, url?: string, start?: number }} o `dispatch` répond comme le serveur ; `url` : l'adresse de la page (pour les mises à jour douces)
 */
export function runElementPage(page, { dispatch, url = "https://x.test/m/k/element/e?lang=fr", start = 1_000_000_000_000 }) {
  const els = {};
  for (const m of page.html.matchAll(/<\w+[^>]*?\sid="([\w-]+)"[^>]*>/g)) els[m[1]] = new FEl(m[1], /\shidden[\s>=]/.test(m[0]));
  if (page.json !== undefined) { els.d = new FEl("d"); els.d.textContent = page.json; }
  let clock = start, tid = 0;
  const timers = [];
  const u = new URL(url);
  let requests = 0;
  const win = {
    document: { getElementById: (id) => els[id] ?? null },
    JSON, Math, Number, String, Promise, Object, Array, Error, encodeURIComponent, parseInt,
    Date: { now: () => clock },
    location: { pathname: u.pathname, search: u.search },
    setTimeout: (fn, ms) => { timers.push({ id: ++tid, at: clock + (ms || 0), fn }); return tid; },
    clearTimeout: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    setInterval: (fn, ms) => { const id = ++tid; const tick = () => { timers.push({ id, at: clock + ms, fn: () => { tick(); fn(); } }); }; tick(); return id; },
    addEventListener() {},
    fetch: async (target) => { requests++; const r = await dispatch(new URL(target, url).href); return { ok: r.status >= 200 && r.status < 300, status: r.status, json: () => r.json() }; },
    XMLHttpRequest: class {
      open(method, target) { this.target = target; }
      send() { requests++; Promise.resolve(dispatch(new URL(this.target, url).href)).then(async (r) => { this.status = r.status; this.response = r.status === 200 ? await r.json() : null; this.onload?.(); }).catch(() => this.onerror?.()); }
    },
  };
  win.window = win;
  vm.runInContext(page.script, vm.createContext(win));
  const flush = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
  return {
    els, flush, get now() { return clock; }, get requests() { return requests; },
    /** Avance l'horloge : lance les minuteurs échus (dans l'ordre), puis laisse les réponses arriver. */
    async advance(ms) { const end = clock + ms; await flush(); for (;;) { timers.sort((a, b) => a.at - b.at || a.id - b.id); const t = timers[0]; if (!t || t.at > end) break; timers.shift(); clock = Math.max(clock, t.at); t.fn(); await flush(); } clock = end; await flush(); },
  };
}

/** Sépare une page complète (document HTML) en { html, script, json } pour `runElementPage`. */
export function splitDocument(doc) {
  const json = /<script type="application\/json" id="d">([\s\S]*?)<\/script>/.exec(doc)?.[1];
  const script = [...doc.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n");
  return { html: doc.replace(/<script[\s\S]*?<\/script>/g, ""), script, json };
}
