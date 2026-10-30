// Un navigateur FACTICE pour la page d'un ÉLÉMENT d'overlay : il fait tourner le VRAI script de la page (celui que le module met dans la page) contre les VRAIES routes du module.
// Les minuteurs ne partent que quand le test avance l'horloge ; chaque fois que la page remplace son contenu, le journal `shown` retient les textes affichés.
import vm from "node:vm";
import { El } from "./remoteDom.mjs";

class PEl extends El {
  constructor(tag, doc) { super(tag, doc); this.style = { setProperty() {} }; }
  append(...nodes) { for (const n of nodes) this.appendChild(n); }
}

/**
 * @param {{ html: string, script: string }} page ce que renvoie `overlay(ctx, { query })`
 * @param {{ dispatch: (url: string) => Promise<Response>, base?: string, onShow?: (parts: Record<string,string>) => void }} o `dispatch` répond comme le serveur
 */
export function runOverlayPage(page, { dispatch, base = "https://x.test" }) {
  const doc = { active: null };
  doc.body = new PEl("body", doc);
  const stage = new PEl("div", doc);
  stage.id = "al-stage";
  doc.body.appendChild(stage);
  const shown = [];
  const replace = stage.replaceChildren.bind(stage);
  stage.replaceChildren = (...nodes) => {
    if (nodes.length) {
      const text = (part) => nodes[0].all(`[data-ov-part="${part}"]`)[0]?.textContent ?? null;
      shown.push({ kind: text("kind"), message: text("message"), detail: text("detail"), classes: nodes[0].className });
    }
    replace(...nodes);
  };
  doc.getElementById = (id) => (id === "al-stage" ? stage : null);
  doc.createElement = (t) => new PEl(t, doc);

  const timers = []; let clock = 0, tid = 0, calls = 0;
  const win = {
    document: doc, JSON, Math, Date, Number, String, Promise, Object, Array, Error, encodeURIComponent, parseInt,
    setTimeout: (fn, ms) => { timers.push({ id: ++tid, at: clock + (ms || 0), fn }); return tid; },
    clearTimeout: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    fetch: async (url) => { calls++; return dispatch(new URL(url, base).href); },
  };
  win.window = win;
  vm.runInContext(page.script, vm.createContext(win));
  const flush = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
  return {
    stage, shown, flush, get fetches() { return calls; },
    /** Avance l'horloge : lance les minuteurs échus (dans l'ordre), puis laisse les réponses arriver. */
    async advance(ms) { const end = clock + ms; await flush(); for (;;) { timers.sort((a, b) => a.at - b.at || a.id - b.id); const t = timers[0]; if (!t || t.at > end) break; timers.shift(); clock = Math.max(clock, t.at); t.fn(); await flush(); } clock = end; await flush(); },
  };
}
