// Stream goals: the overlay element page. It only mounts the core's engine and gives it the state read every 1.5 s, with the server's clock.
import { timingSafeEqual } from "node:crypto";

export const POLL_MS = 1500;
export const CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function sameSecret(a, b) {
  const x = Buffer.from(String(a ?? "")), y = Buffer.from(String(b ?? ""));
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
}

const SCRIPT = `(function(){var A=window.CuriosaAnimate,root=document.getElementById("st"),cfg=JSON.parse(document.getElementById("cfg").textContent);if(!A)return;
var o=A.optionsFromQuery(location.search),h=A.mount(root,{quality:o.quality,calm:o.calm,lang:o.lang,minText:o.minText,state:{genre:"gauge"}});window.__anim=h;
function go(){fetch(cfg.url,{credentials:"omit",cache:"no-store"}).then(function(r){return r.json()}).then(function(d){if(typeof d.now==="number")h.setClock(d.now);if(d.state)h.setState(d.state);if(d.visible===false)root.style.visibility="hidden";else if(d.state)root.style.visibility="visible"}).catch(function(){}).then(function(){setTimeout(go,${POLL_MS})})}go()})();`;

/** The HTML of the element `el` ("goal" | "subathon"). */
export function elementPage(ctx, el, query) {
  const pass = new URLSearchParams({ k: query.get("k") ?? "" });
  if (query.get("ov-demo") === "1") pass.set("demo", "1");
  pass.set("lang", ctx.locale);
  const url = `/m/${ctx.instance.key}/state/${el}?${pass.toString()}`;
  const head = `<!doctype html><html data-ov-region="element" lang="${esc(ctx.locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:transparent;overflow:hidden}#st{position:absolute;inset:0;visibility:hidden}</style></head>`;
  if (typeof ctx.overlay?.animateScript !== "function") return `${head}<body><div data-ov-part="text" style="font:600 24px system-ui,sans-serif;color:#fff">${esc(ctx.t("update_core"))}</div></body></html>`;
  const cfg = JSON.stringify({ url }).replace(/</g, "\\u003c");
  return `${head}<body><div id="st" data-ov-part="panel"></div><script type="application/json" id="cfg">${cfg}</script><script>${ctx.overlay.animateScript()}</script><script>${SCRIPT}</script></body></html>`;
}

/** The test mode of the overlay editor (`ov-demo=1`): a scripted loop, the same on every page at the same instant (a burst, a milestone, the goal reached, time added). */
export function demoState(el, now, label) {
  const c = Math.floor(now / 12000) * 12000, k = now - c;
  const steps = Array.from({ length: 5 }, (_, i) => ({ id: `d${c}-${i}`, at: c + 1000 + i * 180, kind: "step", amount: 1 }));
  if (el === "subathon") return { genre: "gauge", format: "time", value: 0, target: 4 * 3600, label, timer: { endsAt: c + 2 * 3600e3 + (k > 4000 ? 300e3 : 0), total: 4 * 3600e3 }, highlights: [{ id: `x${c}`, at: c + 4000, kind: "extend", amount: 300 }] };
  return { genre: "gauge", value: k < 1000 ? 60 : k < 4000 ? 65 : k < 8000 ? 75 : 100, target: 100, min: 0, milestones: [25, 50, 75], label, highlights: [...steps, { id: `m${c}`, at: c + 4000, kind: "milestone", amount: 10 }, { id: `c${c}`, at: c + 8000, kind: "complete", amount: 25 }] };
}
