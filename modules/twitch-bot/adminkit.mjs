// Le « kit d'ergonomie » de ce module, côté serveur : le HTML des listes (recherche en direct, pastilles, interrupteurs), le style, le petit script qui les anime
// (adminkit.client.js) et la route qui le sert. Rien ici ne connaît les commandes ou les timers : un autre module peut reprendre ce fichier et le script tels quels.
//
// Pourquoi du HTML écrit à la main : le cœur 0.5.x n'a ni recherche en direct, ni interrupteur, ni zone « Plus d'options », ni boutons segmentés. Le module écrit donc des listes
// complètes et lisibles SANS JavaScript (bloc `html`), que le script améliore s'il peut s'exécuter. Il est chargé par une petite image (`onload`) posée dans le bloc, parce que le
// cœur ne fournit aucun moyen de charger un script dans l'administration d'un module. À proposer au cœur sous forme de composants (voir la PR).
import fs from "node:fs";
import crypto from "node:crypto";

export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
/** Sans accents, en minuscules (comme le script). */
export const norm = (v) => String(v ?? "").normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
export const cut = (v, n) => { const s = String(v ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

/* ───────────── Le script ───────────── */

const CLIENT = fs.readFileSync(new URL("./adminkit.client.js", import.meta.url), "utf8");
export const CLIENT_VERSION = crypto.createHash("sha1").update(CLIENT).digest("hex").slice(0, 10);
/** La route `/m/<clé>/kit` : le script, mis en cache 5 minutes (son adresse change avec son contenu). */
export const serveKit = () => new Response(CLIENT, { headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "public, max-age=300", "x-content-type-options": "nosniff" } });

/* ───────────── Le style ───────────── */

// Couleurs des pastilles d'origine : texte sur fond teinté, contraste AA (4,5 :1) vérifié par les tests, en clair comme en sombre. La couleur ne porte jamais seule l'information : le mot est écrit.
export const PALETTE = {
  light: { custom: ["#ece9ff", "#3a2cb5"], builtin: ["#e6ebf1", "#2f4256"], partner: ["#dcf2e8", "#0f5a3b"], network: ["#fbe9d0", "#7d4300"] },
  dark: { custom: ["#2f2b57", "#d4ceff"], builtin: ["#2a323c", "#cbd6e2"], partner: ["#17382b", "#aee8cc"], network: ["#46320f", "#f7d6a0"] },
};
const vars = (p) => Object.entries(p).map(([k, [bg, fg]]) => `--ck-${k}-bg:${bg};--ck-${k}-fg:${fg}`).join(";");

export const CSS = `
:root{${vars(PALETTE.light)}}
:root[data-admin-theme="dark"]{${vars(PALETTE.dark)}}
@media (prefers-color-scheme:dark){:root[data-admin-theme="auto"]{${vars(PALETTE.dark)}}}
.ck,.ck-form,.ck-log{font-size:14px;line-height:1.4;color:var(--v-fg)}
.ck [hidden],.ck-form [hidden],.ck-log [hidden],.ck-ask[hidden]{display:none!important}
.ck-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.ck-js{display:none}.ck.ck-on .ck-js,.ck-log.ck-on .ck-js{display:flex}
.ck-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:0 0 6px}
.ck-title{font-size:20px;font-weight:600;margin:0}
.ck-intro{margin:0 0 12px;color:var(--v-muted);font-size:14px}
.ck-tools{flex-direction:column;gap:10px;margin:0 0 12px}
.ck-search{display:flex;flex-direction:column;gap:4px;font-weight:500}
.ck-search input{width:100%;max-width:520px;box-sizing:border-box;min-height:44px;padding:8px 14px;border:1px solid var(--v-line);border-radius:12px;background:var(--v-bg);color:var(--v-fg);font:inherit;font-weight:400}
.ck-search input:focus-visible,.ck-btn:focus-visible,.ck-sw:focus-visible,.ck-pill:focus-visible,.ck-seg-b:focus-visible,.ck-chip:focus-visible,.ck-sel:focus-visible,.ck-num:focus-visible,.ck-date:focus-visible,.ck-more>summary:focus-visible{outline:2px solid var(--v-accent);outline-offset:2px}
.ck-pills{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.ck-pills-l{font-size:12px;color:var(--v-muted);margin-right:4px}
.ck-pill{min-height:32px;padding:4px 12px;border:1px solid var(--v-line);border-radius:999px;background:var(--v-surface);color:var(--v-fg);font:inherit;font-size:13px;cursor:pointer}
.ck-pill[aria-pressed="true"]{background:var(--v-accent);border-color:var(--v-accent);color:var(--v-accent-fg);font-weight:600}
.ck-pill b{font-weight:600;margin-left:4px;opacity:.85}
.ck-count{margin:0 0 8px;font-size:12px;color:var(--v-muted)}
.ck-wrap{border:1px solid var(--v-line);border-radius:14px;background:var(--v-surface);overflow:hidden}
.ck-table{width:100%;border-collapse:collapse;table-layout:fixed}
.ck-table th{font-size:12px;font-weight:600;text-align:left;color:var(--v-muted);padding:10px 12px}
.ck-table td{padding:6px 12px;border-top:1px solid var(--v-line);height:56px;vertical-align:middle;overflow:hidden}
.ck-table .c-act{overflow:visible}
.ck-table tr[data-ck-row]:hover td{background:color-mix(in srgb,var(--v-accent) 5%,transparent)}
.ck-ell{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ck-name{font-weight:600}.ck-alias{color:var(--v-muted);font-weight:400}
.ck-chipr{display:inline-block;margin-left:6px;padding:0 8px;border-radius:999px;border:1px solid var(--v-line);font-size:12px;font-weight:500;color:var(--v-muted);vertical-align:1px}
.ck-origin{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}
.ck-origin.custom{background:var(--ck-custom-bg);color:var(--ck-custom-fg)}.ck-origin.builtin{background:var(--ck-builtin-bg);color:var(--ck-builtin-fg)}
.ck-origin.partner{background:var(--ck-partner-bg);color:var(--ck-partner-fg)}.ck-origin.network{background:var(--ck-network-bg);color:var(--ck-network-fg)}
.ck-sw{position:relative;display:inline-flex;align-items:center;min-width:52px;min-height:44px;padding:0 6px;border:0;background:none;cursor:pointer}
.ck-sw::before{content:"";width:40px;height:22px;border-radius:999px;background:var(--v-muted);transition:background .15s}
.ck-sw::after{content:"";position:absolute;left:9px;top:50%;width:16px;height:16px;margin-top:-8px;border-radius:50%;background:#fff;transition:transform .15s}
.ck-sw[aria-checked="true"]::before{background:var(--v-accent)}.ck-sw[aria-checked="true"]::after{transform:translateX(18px)}
.ck-sw[disabled]{opacity:.55;cursor:default}
.c-sw{white-space:nowrap}.c-sw .ck-sw{vertical-align:middle}
.ck-note{display:inline-block;max-width:calc(100% - 60px);vertical-align:middle;font-size:12px;line-height:1.25;color:var(--v-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.c-act .ck-btn{white-space:normal;text-align:center;line-height:1.15;padding:3px 10px}
.ck-btn{display:inline-flex;align-items:center;justify-content:center;min-height:36px;padding:4px 14px;border:1px solid var(--v-line);border-radius:10px;background:var(--v-surface);color:var(--v-fg);font:inherit;font-size:13px;font-weight:500;text-decoration:none;cursor:pointer;white-space:nowrap}
.ck-btn:hover{border-color:var(--v-accent);color:var(--v-accent)}
.ck-btn.primary{background:var(--v-accent);border-color:var(--v-accent);color:var(--v-accent-fg);font-weight:600}.ck-btn.primary:hover{filter:brightness(1.08);color:var(--v-accent-fg)}
.ck-btn.small{min-height:32px;padding:2px 12px;font-size:12px}
.ck-danger{color:var(--v-danger);border-color:color-mix(in srgb,var(--v-danger) 50%,var(--v-line))}.ck-danger:hover{background:color-mix(in srgb,var(--v-danger) 10%,transparent);color:var(--v-danger);border-color:var(--v-danger)}
.ck-acts{display:flex;gap:6px;justify-content:flex-end;align-items:center}
.ck-ask{display:inline-flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:13px}.ck-ask-t{color:var(--v-fg)}
.ck-empty{padding:24px 16px;text-align:center;border:1px dashed var(--v-line);border-radius:14px;margin-top:8px}.ck-empty p{margin:0 0 10px}
.ck-status{min-height:20px;margin:8px 2px 0;font-size:13px}.ck-status.good{color:var(--v-success)}.ck-status.bad{color:var(--v-danger)}
.ck-add{margin-top:12px;border:1px solid var(--v-line);border-radius:14px;background:var(--v-surface)}
.ck-add>summary{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:10px 14px;cursor:pointer;list-style:none;min-height:44px}
.ck-add>summary::-webkit-details-marker{display:none}
.ck-add-b{display:inline-flex;align-items:center;min-height:36px;padding:2px 14px;border:1px solid var(--v-accent);border-radius:10px;font-weight:600;color:var(--v-accent)}
.ck-add-s{color:var(--v-muted);font-size:13px}
.ck-add-body{padding:0 14px 14px}
.ck-add-body .ck-table td{height:48px}
.ck-state-pills{margin-top:2px}
/* journal */
.ck-log .ck-table td{height:44px}
/* formulaires rangés */
.ck-form{display:flex;flex-direction:column;gap:16px;grid-column:1/-1}
.ck-form .ck-field{margin:0}
.ck-form label{font-weight:500}
.ck-section{display:flex;flex-direction:column;gap:8px}
.ck-legend{font-size:15px;font-weight:500}
.ck-line{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.ck-word{color:var(--v-fg)}
.ck-hint{margin:0;font-size:13px;color:var(--v-muted)}
.ck-form .ck-line input.ck-num{width:84px;min-height:44px;box-sizing:border-box;padding:6px 10px;border:1px solid var(--v-line);border-radius:10px;background:var(--v-bg);color:var(--v-fg);font:inherit;text-align:center}
.ck-form .ck-line select.ck-sel,.ck-form .ck-line input.ck-date{width:auto;min-width:0;max-width:100%;min-height:44px;box-sizing:border-box;padding:6px 10px;border:1px solid var(--v-line);border-radius:10px;background:var(--v-bg);color:var(--v-fg);font:inherit}
.ck-seg{align-self:flex-start;display:inline-flex;flex-wrap:wrap;border:1px solid var(--v-line);border-radius:12px;background:var(--v-bg);padding:3px;gap:2px;max-width:100%}
.ck-seg-b{min-height:40px;padding:4px 14px;border:0;border-radius:9px;background:none;color:var(--v-fg);font:inherit;font-size:14px;cursor:pointer}
.ck-seg-b[aria-checked="true"]{background:var(--v-accent);color:var(--v-accent-fg);font-weight:600}
.ck-chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.ck-chip{min-height:32px;padding:2px 12px;border:1px solid var(--v-line);border-radius:999px;background:var(--v-surface);color:var(--v-fg);font:inherit;font-size:13px;cursor:pointer}
.ck-chip:hover{border-color:var(--v-accent);color:var(--v-accent)}
.ck-extras{display:flex;flex-direction:column;gap:6px;margin-top:6px}
.ck-preview{margin:0;padding:8px 12px;border-radius:10px;background:var(--v-bg);border:1px solid var(--v-line);font-size:13px;overflow-wrap:anywhere}
.ck-more{border:1px solid var(--v-line);border-radius:12px;background:var(--v-bg)}
.ck-more>summary{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:center;min-height:44px;padding:8px 14px;cursor:pointer;list-style:none}
.ck-more>summary::-webkit-details-marker{display:none}
.ck-more>summary::before{content:"▸";color:var(--v-muted)}.ck-more[open]>summary::before{content:"▾"}
.ck-more-t{font-weight:600}.ck-more-h{color:var(--v-muted);font-size:13px}.ck-more-now{font-size:12px;padding:0 8px;border-radius:999px;background:var(--v-accent);color:var(--v-accent-fg)}
.ck-more-body{display:flex;flex-direction:column;gap:18px;padding:4px 14px 16px}
.ck-range{display:flex;flex-direction:column;gap:10px}
.ck-check{display:inline-flex;align-items:center;gap:8px;min-height:36px;font-weight:400}
.ck-check input{width:18px;height:18px;accent-color:var(--v-accent)}
.ck-phrase{margin:0;font-size:14px;color:var(--v-fg);font-weight:500}
.ck-err{margin:0;font-size:14px;font-weight:500;color:var(--v-danger)}
:root[data-admin-theme="dark"] .ck-err,:root[data-admin-theme="dark"] .ck-status.bad{color:#fca5a5}
@media (prefers-color-scheme:dark){:root[data-admin-theme="auto"] .ck-err,:root[data-admin-theme="auto"] .ck-status.bad{color:#fca5a5}}
.ck-form-on .ck-form [data-field-error]{margin-top:6px}
@media (max-width:760px){
  .ck-table thead{position:absolute;left:-9999px}
  .ck-table,.ck-table tbody{display:block}
  .ck-table tr[data-ck-row]{display:grid;grid-template-columns:1fr auto;grid-template-areas:"name sw" "ans ans" "note note" "org act";gap:2px 10px;padding:10px 12px;border-top:1px solid var(--v-line);align-items:center}
  .ck-table td{display:block;border:0;padding:0;height:auto;background:none!important}
  .ck-table .c-name{grid-area:name}.ck-table .c-ans{grid-area:ans}.ck-table .c-org{grid-area:org}.ck-table .c-act{grid-area:act}
  .ck-table .c-sw{display:contents}.ck-table .c-sw .ck-sw{grid-area:sw;justify-self:end}.ck-table .c-sw .ck-note{grid-area:note;max-width:none}
  .ck-table .c-extra{grid-area:ans}
  .ck-add-body .ck-table tr[data-ck-row]{grid-template-areas:"name act" "ans ans" "org org"}
  .ck-search input{max-width:none}
}
`;

/* ───────────── Le chargement du script ───────────── */

const GIF = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
/** Le bloc à poser une fois sur la page : le style, et une image invisible dont le chargement démarre le script (le cœur n'exécute pas les balises <script> d'un bloc). Sans JavaScript : la page reste complète. */
export function bootstrap(ctx) {
  const src = `/m/${encodeURIComponent(ctx.instance.key)}/kit?v=${CLIENT_VERSION}`;
  const code = `var k=window.CuriosaKit;if(k){k.scan()}else if(!window.__ckLoad){window.__ckLoad=1;var s=document.createElement('script');s.src='${src}';s.async=true;document.head.appendChild(s)}`;
  return { type: "html", html: `<style>${CSS}</style><img alt="" width="1" height="1" src="${GIF}" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none" onload="${esc(code)}">` };
}

/* ───────────── Les morceaux de HTML ───────────── */

export const originPill = (kind, text) => `<span class="ck-origin ${esc(kind)}">${esc(text)}</span>`;
/** Un interrupteur d'état. `disabled` : lecture seule (droit manquant, source disparue). */
export function switchHtml({ id, on, label, act = "toggle", disabled = false, fail = "" }) {
  return `<button type="button" class="ck-sw" role="switch" aria-checked="${on ? "true" : "false"}" aria-label="${esc(label)}" data-ck-act="${esc(act)}" data-ck-id="${esc(id)}" data-ck-switch data-ck-fail="${esc(fail)}"${disabled ? " disabled" : ""}></button>`;
}
/** Une pastille de filtre ; la première d'un groupe est enfoncée. */
const pill = (key, p, pressed) => `<button type="button" class="ck-pill" data-ck-pill data-ck-key="${esc(key)}" data-ck-val="${esc(p.val)}" aria-pressed="${pressed ? "true" : "false"}">${esc(p.label)}${p.count !== undefined ? ` <b>${p.count}</b>` : ""}</button>`;

/**
 * La coque d'une liste filtrable : recherche, pastilles, tableau, « Aucun résultat ». `rows` : du HTML de lignes (<tr data-ck-row …>) déjà écrites.
 * `pills` : [{ key, label, items: [{ val, label, count }] }] ; `groups` : voir adminkit.client.js. Sans JavaScript, la recherche et les pastilles sont cachées et tout reste lisible.
 */
export function listShell({ ctx, id, columns, rows, pills = [], groups, text, className = "", head = "", extra = "" }) {
  const cols = columns.map((c) => `<th scope="col"${c.cls ? ` class="${esc(c.cls)}"` : ""}${c.width ? ` style="width:${c.width}"` : ""}>${c.sr ? `<span class="ck-sr">${esc(c.label)}</span>` : esc(c.label)}</th>`).join("");
  const pillRows = pills.filter((g) => g.items.length > 1).map((g) => `<div class="ck-pills" role="group" aria-label="${esc(g.label)}">${g.items.map((p, i) => pill(g.key, p, i === 0)).join("")}</div>`).join("");
  return `<div class="ck ${esc(className)}" data-ck-list="${esc(id)}" data-ck-instance="${esc(ctx.instance.id)}" data-ck-groups="${esc(JSON.stringify(groups ?? {}))}">${head}
<div class="ck-tools ck-js"><label class="ck-search"><span>${esc(text.search)}</span><input type="search" data-ck-q placeholder="${esc(text.placeholder)}" autocomplete="off" spellcheck="false"></label>${pillRows}</div>
<p class="ck-count ck-js" data-ck-count data-ck-count-tpl="${esc(text.count)}" role="status" aria-live="polite"></p>
<div class="ck-wrap"><table class="ck-table"><thead><tr>${cols}</tr></thead><tbody>${rows}</tbody></table></div>
<div class="ck-empty" data-ck-empty hidden><p>${esc(text.empty)}</p><button type="button" class="ck-btn" data-ck-clear>${esc(text.clear)}</button></div>
<p class="ck-status" data-ck-status role="status"></p>${extra}</div>`;
}

/** Les attributs d'une ligne filtrable : le texte cherché est déjà sans accents ni majuscules. */
export const rowAttrs = (attrs, hay) => `data-ck-row ${Object.entries(attrs).map(([k, v]) => `data-${k}="${esc(v)}"`).join(" ")} data-hay="${esc(norm(hay))}"`;

/** La configuration d'un formulaire rangé par le script : un bloc invisible + le champ caché `ck` à ajouter au formulaire du cœur (voir buildForm dans adminkit.client.js). */
export function formConfig(id, config) {
  return { block: { type: "html", html: `<div data-ck-config="${esc(id)}" data-ck-json="${esc(JSON.stringify(config))}" hidden></div>` }, field: { name: "ck", kind: "hidden", value: id } };
}
