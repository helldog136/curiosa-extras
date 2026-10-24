// Exécute scripts/events.js (le script de la page) dans un faux navigateur, dans UN processus à part dont le fuseau est donné par la variable TZ
// (le fuseau du visiteur est celui du processus). Entrée (stdin) : { cfg, elements: [{ id, attrs, hidden }] } · Sortie : l'état des éléments, en JSON.
import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync(new URL("../../modules/events/scripts/events.js", import.meta.url), "utf8");
const input = JSON.parse(fs.readFileSync(0, "utf8"));
const make = (e) => {
  const el = { id: e.id, attrs: { ...e.attrs }, hidden: e.hidden ?? false, textContent: "", children: [], tag: e.tag ?? "span", listeners: {} };
  el.getAttribute = (n) => (n in el.attrs ? el.attrs[n] : null);
  el.setAttribute = (n, v) => { el.attrs[n] = String(v); };
  el.addEventListener = (type, fn) => { (el.listeners[type] ??= []).push(fn); };
  el.querySelector = (sel) => (sel === "a" ? el.link ?? null : null);
  el.appendChild = (c) => { el.children.push(c); return c; };
  el.focus = () => { el.focused = true; };
  if (e.link) el.link = make({ id: `${e.id}-a`, attrs: {}, tag: "a" });
  return el;
};
const els = input.elements.map(make);
const by = (attr) => els.filter((e) => attr in e.attrs);
const root = make({ id: "root", attrs: { "data-ev-cfg": JSON.stringify(input.cfg) } });
const document = {
  querySelector: (sel) => (sel === ".ev" ? root : by("data-ev-local")[0] ?? null),
  querySelectorAll: (sel) => by(sel.replace(/^\[|\]$/g, "")),
  createElement: (tag) => make({ id: `new-${tag}`, attrs: {}, tag }),
};
const context = vm.createContext({ document, Intl, Date, Math, JSON, isFinite, parseInt, String, Number, RegExp, console });
vm.runInContext(src, context);
for (const e of els) if (e.link) for (const fn of e.link.listeners.click ?? []) { const ev = { prevented: false, preventDefault() { this.prevented = true; } }; if (input.click === e.id) { fn(ev); e.clicked = ev.prevented; } }
console.log(JSON.stringify({
  viewerTz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  elements: els.map((e) => ({ id: e.id, hidden: e.hidden, text: e.textContent, clicked: e.clicked ?? false, child: e.children[0] ? { tag: e.children[0].tag, attrs: e.children[0].attrs } : null })),
}));
