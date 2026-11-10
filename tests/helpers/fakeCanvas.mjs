// Un faux contexte de dessin 2D pour les tests de « Story d'annonce » : il ne dessine rien, il NOTE ce qu'on lui demande (textes, rectangles, images) et sait mesurer
// un texte (largeur = nombre de caractères × taille × 0,55, comme une police moyenne). Les mêmes appels donnent toujours le même journal : c'est ce qui prouve qu'une image ne dépend que du temps.
export function fakeCanvasContext(log = []) {
  const state = { font: "400 16px sans-serif", textAlign: "left", textBaseline: "alphabetic", globalAlpha: 1, fillStyle: "#000", strokeStyle: "#000", lineWidth: 1, shadowBlur: 0, shadowColor: "", shadowOffsetY: 0, sx: 1, tx: 0 };   // sx, tx: the horizontal scale and offset of the current transform (translate and scale only), noted on a text drawn under a scale other than 1
  const stack = [];
  const px = () => Number(/(\d+(?:\.\d+)?)px/.exec(state.font)?.[1] ?? 16);
  const rec = (op, ...args) => { log.push([op, ...args.map((a) => (typeof a === "number" ? Math.round(a * 100) / 100 : a?.nodeType || typeof a === "object" ? "[objet]" : a))]); };
  const gradient = () => ({ addColorStop() {} });
  const ctx = new Proxy({}, {
    get(_t, name) {
      if (name === "measureText") return (s) => ({ width: [...String(s)].length * px() * 0.55 });
      if (name === "save") return () => stack.push({ ...state });
      if (name === "restore") return () => { Object.assign(state, stack.pop() ?? {}); };
      if (name === "createLinearGradient" || name === "createRadialGradient") return gradient;
      if (name === "log") return log;
      if (name === "state") return state;
      if (name === "translate") return (dx, dy) => { state.tx += state.sx * dx; rec("translate", dx, dy); };
      if (name === "scale") return (a, b) => { state.sx *= a; rec("scale", a, b); };
      if (name in state) return state[name];
      if (name === "fillText" || name === "strokeText") return (text, x, y) => { log.push([name, String(text), Math.round(x * 100) / 100, Math.round(y * 100) / 100, state.font, state.textAlign, state.globalAlpha, state.textBaseline, ...(state.sx !== 1 ? [Math.round(state.sx * 1000) / 1000, Math.round(state.tx * 100) / 100] : [])]); };
      return (...args) => { rec(String(name), ...args); };
    },
    set(_t, name, value) { state[name] = value; return true; },
  });
  return ctx;
}
/** Une « image » factice : une largeur et une hauteur suffisent au dessin. */
export const fakeImage = (w = 300, h = 300) => ({ width: w, height: h, naturalWidth: w, naturalHeight: h });
