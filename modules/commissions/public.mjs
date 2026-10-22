// Commandes — ce que voit la visiteuse : la page des commandes (état, formules, formulaire), la page de suivi privée, la petite carte d'état pour l'accueil.
// Tout texte venu d'une personne (pseudo, demande, message de l'équipe…) passe par esc() avant d'entrer dans du HTML.
const v = new URL(import.meta.url).search;
const L = await import(`./lib.mjs${v}`);
const D = await import(`./data.mjs${v}`);
const M = await import(`./mailer.mjs${v}`);
const C = await import(`./client.mjs${v}`);
const { esc, fmtDay, pathPrefix, LIMITS, ACTIVE, FINISHED } = L;

const SUBMIT = C.clientSubmit.toString();
export const ERROR_CODES = ["invalid", "rate", "closed", "busy"];

const CSS = `
.cm{max-width:46rem;display:grid;gap:1rem}
.cm *{box-sizing:border-box}
.cm-card{border:1px solid var(--v-line);border-radius:12px;background:var(--v-surface);color:var(--v-fg);padding:1rem}
.cm-state{display:flex;gap:.75rem;align-items:flex-start}
.cm-dot{width:.9rem;height:.9rem;border-radius:50%;margin-top:.45rem;flex:none;background:var(--v-muted)}
.cm-state[data-s=open] .cm-dot{background:var(--v-success)}
.cm-state[data-s=full] .cm-dot{background:var(--v-warning)}
.cm-state[data-s=done] .cm-dot{background:var(--v-success)}
.cm-t{font-size:1.2rem;font-weight:700;margin:0;overflow-wrap:anywhere}
.cm-sub,.cm-msg{margin:.2rem 0 0;overflow-wrap:anywhere}
.cm-sub{color:var(--v-muted)}
.cm-msg{white-space:pre-line}
.cm-grid{display:grid;gap:.75rem;grid-template-columns:repeat(auto-fill,minmax(min(100%,15rem),1fr))}
.cm-f h3{margin:0;font-size:1.05rem;overflow-wrap:anywhere}
.cm-dl{margin:.5rem 0 0;display:grid;gap:.25rem}
.cm-dl div{display:flex;flex-wrap:wrap;gap:.25rem .5rem}
.cm-dl dt{color:var(--v-muted)}
.cm-dl dd{margin:0;font-weight:600;overflow-wrap:anywhere}
.cm-inc{white-space:pre-line;overflow-wrap:anywhere;margin:.6rem 0 0}
.cm-form{display:grid;gap:1rem}
.cm-field label,.cm-lab{display:block;font-weight:600;margin-bottom:.25rem}
.cm-hint{color:var(--v-muted);font-size:.875rem;margin:.2rem 0 0}
.cm-in{width:100%;min-height:44px;padding:.6rem .75rem;font:inherit;font-size:1rem;color:var(--v-fg);background:var(--v-bg);border:1px solid var(--v-line);border-radius:8px}
textarea.cm-in{min-height:8rem;resize:vertical}
.cm-in:focus-visible,.cm-btn:focus-visible,.cm-card summary:focus-visible,.cm-check input:focus-visible{outline:3px solid var(--v-accent);outline-offset:2px}
.cm-in[aria-invalid=true]{border-color:var(--v-danger)}
.cm-err{color:var(--v-danger);margin:.3rem 0 0;font-size:.9rem;overflow-wrap:anywhere}
.cm-err:empty,.cm-okbox:empty{display:none}
.cm-okbox{margin:0;padding:.75rem 1rem;border:1px solid var(--v-line);border-radius:8px}
.cm-check{display:flex;gap:.6rem;align-items:flex-start;min-height:44px;font-weight:400}
.cm-check input{width:1.4rem;height:1.4rem;margin:.1rem 0 0;flex:none}
.cm-btn{min-height:44px;padding:.6rem 1.4rem;font:inherit;font-weight:600;border:1px solid transparent;border-radius:999px;background:var(--v-accent);color:var(--v-accent-fg);cursor:pointer}
.cm-btn[disabled]{opacity:.65;cursor:progress}
.cm-btn-quiet{background:transparent;color:var(--v-fg);border-color:var(--v-line)}
.cm-btn-danger{background:transparent;color:var(--v-danger);border-color:var(--v-danger)}
.cm-hp{position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden}
.cm-tl{list-style:none;margin:.5rem 0 0;padding:0;display:grid;gap:.35rem}
.cm-tl li{display:flex;flex-wrap:wrap;gap:.1rem .6rem}
.cm-tl time{color:var(--v-muted)}
.cm-card summary{cursor:pointer;font-weight:600;min-height:44px;display:flex;align-items:center}
.cm-note{margin:.75rem 0 0;padding:.6rem .9rem;border-left:4px solid var(--v-accent);background:var(--v-bg);white-space:pre-line;overflow-wrap:anywhere}
.cm-small{font-size:.875rem;color:var(--v-muted);margin:.5rem 0 0}
@media (prefers-reduced-motion:no-preference){.cm-btn{transition:opacity .15s}}
`;
const style = () => `<style>${CSS}</style>`;

/** Phrase simple pour l'état : { s, title, sub } (s sert à colorer la pastille). */
export function stateText(ctx, queue, ps) {
  const date = queue.reopenOn ? fmtDay(ctx.locale, queue.reopenOn) : "";
  if (ps.state === "open") {
    const sub = ps.free === null ? "" : ps.free === 1 ? ctx.t("freeOne") : ctx.t("freeMany", { n: ps.free });
    return { s: "open", title: ctx.t("stateOpen"), sub };
  }
  if (ps.state === "full") return { s: "full", title: ctx.t("stateFull"), sub: date ? ctx.t("reopenOn", { date }) : ctx.t("tryLater") };
  return { s: "closed", title: ctx.t("stateClosed"), sub: date ? ctx.t("reopenOn", { date }) : "" };
}
export function stateCard(ctx, queue, ps) {
  const t = stateText(ctx, queue, ps);
  return `<section class="cm-card cm-state" data-s="${t.s}"><span class="cm-dot" aria-hidden="true"></span><div><p class="cm-t">${esc(t.title)}</p>` +
    (t.sub ? `<p class="cm-sub">${esc(t.sub)}</p>` : "") + (queue.message ? `<p class="cm-msg">${esc(queue.message)}</p>` : "") + `</div></section>`;
}

function formulaCards(ctx, formulas) {
  return `<div class="cm-grid">${formulas.map((f) =>
    `<article class="cm-card cm-f"><h3>${esc(f.name)}</h3>` +
    (f.price || f.delay ? `<dl class="cm-dl">${f.price ? `<div><dt>${esc(ctx.t("price"))}</dt><dd>${esc(f.price)}</dd></div>` : ""}${f.delay ? `<div><dt>${esc(ctx.t("delay"))}</dt><dd>${esc(f.delay)}</dd></div>` : ""}</dl>` : "") +
    (f.includes ? `<p class="cm-inc">${esc(f.includes)}</p>` : "") + `</article>`).join("")}</div>`;
}

function orderForm(ctx, formulas, withMail) {
  const err = (name) => `<p class="cm-err" id="cm-e-${name}" data-err="${name}" aria-live="polite"></p>`;
  const field = (name, label, control, hint) =>
    `<div class="cm-field"><label for="cm-${name}">${esc(label)}</label>${control}${hint ? `<p class="cm-hint" id="cm-h-${name}">${esc(hint)}</p>` : ""}${err(name)}</div>`;
  const desc = (name, hint) => `aria-describedby="${hint ? `cm-h-${name} ` : ""}cm-e-${name}"`;
  const options = formulas.map((f) => `<option value="${esc(f.id)}">${esc(f.price ? `${f.name} — ${f.price}` : f.name)}</option>`).join("");
  const action = `/m/${esc(ctx.instance.key)}/send?lang=${esc(ctx.locale)}`;
  return `<form class="cm-form cm-card" method="post" action="${action}" novalidate data-sending="${esc(ctx.t("sending"))}" data-neterr="${esc(ctx.t("errNetwork"))}" data-thanks="${esc(ctx.t("thanks"))}" onsubmit="return (${esc(SUBMIT)})(this,event)">` +
    field("nick", ctx.t("fNick"), `<input class="cm-in" id="cm-nick" name="nick" type="text" required maxlength="${LIMITS.nick}" autocomplete="nickname" ${desc("nick", true)}>`, ctx.t("fNickHint")) +
    field("email", ctx.t("fEmail"), `<input class="cm-in" id="cm-email" name="email" type="email" required maxlength="${LIMITS.email}" autocomplete="email" inputmode="email" ${desc("email", true)}>`, ctx.t("fEmailHint")) +
    (formulas.length ? field("formula", ctx.t("fFormula"), `<select class="cm-in" id="cm-formula" name="formula" required ${desc("formula", false)}><option value="">${esc(ctx.t("fFormulaPick"))}</option>${options}</select>`) : "") +
    field("want", ctx.t("fWant"), `<textarea class="cm-in" id="cm-want" name="want" required minlength="5" maxlength="${LIMITS.want}" ${desc("want", true)}></textarea>`, ctx.t("fWantHint")) +
    field("inspiration", ctx.t("fInspiration"), `<input class="cm-in" id="cm-inspiration" name="inspiration" type="text" inputmode="url" maxlength="${LIMITS.inspiration}" autocomplete="off" ${desc("inspiration", true)}>`, ctx.t("fInspirationHint")) +
    (withMail ? `<div class="cm-field"><label class="cm-check"><input type="checkbox" name="notify" value="on" checked><span>${esc(ctx.t("fNotify"))}</span></label></div>` : "") +
    `<div class="cm-hp" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>` +
    `<p class="cm-hint">${esc(ctx.t("formPrivacy"))}</p>` +
    `<p class="cm-err" data-err="_" role="alert"></p><p class="cm-okbox" data-ok role="status"></p>` +
    `<div><button type="submit" class="cm-btn">${esc(ctx.t("fSubmit"))}</button></div></form>`;
}

/** La page des commandes. */
async function mainPage(ctx) {
  const [queue, st, formulas] = await Promise.all([D.readQueue(ctx), D.stats(ctx), D.listFormulas(ctx)]);
  const ps = D.publicState(queue, st);
  const shown = formulas.filter((f) => f.visible).slice(0, LIMITS.formulas);
  const blocks = [];
  const intro = String(ctx.setting("intro") ?? "").trim();
  if (intro) blocks.push({ type: "markdown", text: intro });
  blocks.push({ type: "html", html: `${style()}<div class="cm">${stateCard(ctx, queue, ps)}</div>` });
  if (shown.length) blocks.push({ type: "heading", text: ctx.t("formulasTitle") }, { type: "html", html: `<div class="cm">${formulaCards(ctx, shown)}</div>` });
  if (ps.state === "open") blocks.push({ type: "heading", text: ctx.t("formTitle") }, { type: "html", html: `<div class="cm">${orderForm(ctx, shown, await M.enabled(ctx))}<p class="cm-small">${esc(ctx.t("haveLink"))}</p></div>` });
  return { title: String(ctx.setting("title") || "").trim() || ctx.t("pageTitle"), description: ctx.t("pageDescription"), blocks };
}

const trackBase = (ctx) => `${pathPrefix(ctx, ctx.locale)}`;

/** La page de suivi d'une commande : l'état et un prénom/pseudo, jamais une adresse e-mail ni une note privée. */
async function trackPage(ctx, token) {
  const order = await D.findByToken(ctx, token);
  const back = { type: "links", items: [{ label: ctx.t("backToPage"), href: trackBase(ctx) || "/" }] };
  if (!order) return { title: ctx.t("trackTitle"), blocks: [{ type: "markdown", text: ctx.t("trackUnknown") }, back] };
  const st = await D.stats(ctx);
  const s = order.status;
  const blocks = [];
  let extra = "";
  if (s === "accepted" && ctx.setting("showPosition") !== false) {
    const ahead = D.aheadOf(st, order.id);
    if (ahead !== null) extra = ahead === 0 ? ctx.t("aheadNone") : ahead === 1 ? ctx.t("aheadOne") : ctx.t("aheadMany", { n: ahead });
  }
  const events = order.history.length ? order.history : [{ s: "new", at: order.at.toISOString() }];
  const tl = events.map((h) => `<li><strong>${esc(ctx.t(`pub_${h.s}`))}</strong><time datetime="${esc(h.at.slice(0, 10))}">${esc(fmtDay(ctx.locale, h.at))}</time></li>`).join("");
  const tone = s === "delivered" ? "done" : ACTIVE.includes(s) ? "open" : s === "new" ? "full" : "closed";
  blocks.push({ type: "html", html: `${style()}<div class="cm"><section class="cm-card cm-state" data-s="${tone}"><span class="cm-dot" aria-hidden="true"></span><div>` +
    `<p class="cm-t">${esc(ctx.t("trackHello", { nick: order.nick }))}</p><p class="cm-sub"><strong>${esc(ctx.t(`pub_${s}`))}</strong> — ${esc(ctx.t(`explain_${s}`))}</p>` +
    (extra ? `<p class="cm-sub">${esc(extra)}</p>` : "") +
    (order.formulaName ? `<p class="cm-sub">${esc(ctx.t("trackFormula", { name: order.formulaName }))}</p>` : "") +
    (order.clientNote ? `<p class="cm-note">${esc(order.clientNote)}</p>` : "") +
    `</div></section><section class="cm-card"><h2 class="cm-t">${esc(ctx.t("trackHistory"))}</h2><ol class="cm-tl">${tl}</ol></section></div>` });
  const url = `${ctx.api.siteUrl}${trackBase(ctx)}/suivi/${token}`;
  blocks.push({ type: "heading", text: ctx.t("trackKeepTitle") }, { type: "markdown", text: ctx.t("trackKeep") }, { type: "copy", text: url, label: ctx.t("copyLink") });
  const form = (route, label, intro, btn) => `<details class="cm-card"><summary>${esc(label)}</summary><p>${esc(intro)}</p><form method="post" action="/m/${esc(ctx.instance.key)}/${route}?lang=${esc(ctx.locale)}"><input type="hidden" name="t" value="${esc(token)}"><button type="submit" class="cm-btn cm-btn-danger">${esc(btn)}</button></form></details>`;
  const acts = [];
  if (s === "new" || s === "accepted") acts.push(form("cancel", ctx.t("cancelTitle"), ctx.t("cancelText"), ctx.t("cancelBtn")));
  if (s === "new" || FINISHED.includes(s)) acts.push(form("forget", ctx.t("forgetTitle"), ctx.t("forgetText"), ctx.t("forgetBtn")));
  else acts.push(`<p class="cm-small">${esc(ctx.t("forgetLater"))}</p>`);
  blocks.push({ type: "html", html: `<div class="cm">${acts.join("")}</div>` }, back);
  return { title: ctx.t("trackTitle"), blocks };
}

function messagePage(ctx, code) {
  if (!ERROR_CODES.includes(code)) return { notFound: true, blocks: [] };
  return { title: ctx.t("oopsTitle"), blocks: [{ type: "markdown", text: ctx.t(`oops_${code}`) }, { type: "links", items: [{ label: ctx.t("backToPage"), href: trackBase(ctx) || "/" }] }] };
}

/** Les chemins : « / » la page, « /suivi/<lien> » le suivi, « /oups/<code> » un refus lu sans JavaScript. Tout le reste : introuvable. */
export async function page(ctx, { segments }) {
  const seg = Array.isArray(segments) ? segments : [];
  if (seg.length === 0) return mainPage(ctx);
  if (seg.length === 2 && seg[0] === "suivi") return trackPage(ctx, String(seg[1]));
  if (seg.length === 2 && seg[0] === "oups") return messagePage(ctx, String(seg[1]));
  return { notFound: true, blocks: [] };
}

/** Section d'accueil : la carte d'état, avec un lien vers la page. */
export async function statusSection(ctx) {
  const [queue, st] = await Promise.all([D.readQueue(ctx), D.stats(ctx)]);
  const href = trackBase(ctx) || "/";
  return [{ type: "html", html: `${style()}<div class="cm">${stateCard(ctx, queue, D.publicState(queue, st))}<p class="cm-small"><a href="${esc(href)}">${esc(ctx.t("seePage"))}</a></p></div>` }];
}
