// Soutiens — la page publique et la page d'accord personnelle. Aucun script, aucun cookie, aucune requête vers un autre site, aucune photo.
// Ce que voit le public : un pseudo (celui que la personne a choisi ET accepté de montrer, relu par la propriétaire si elle l'a demandé), regroupé sous le libellé de palier choisi par la propriétaire.
// JAMAIS : un montant, un nom de palier de la plateforme, un vrai nom, une date, une adresse. Tout est échappé.
// Chemins : / (la liste) · /page/2 (50 pseudos au plus par page) · /moi/<numéro>/<jeton> (l'accord personnel) · /moi/<numéro>/<jeton>/<état> (le même, après un envoi).
const v = new URL(import.meta.url).search;
const P = await import(`./pure.mjs${v}`);
const D = await import(`./data.mjs${v}`);
const R = await import(`./providers.mjs${v}`);
const S = await import(`./sync.mjs${v}`);
const { esc, LIMITS, clean, int } = P;

const CSS = `
.sp{font-family:var(--v-font,inherit);color:var(--v-fg,inherit);max-width:56rem;margin:0 auto}
.sp *{box-sizing:border-box}
.sp h2,.sp p,.sp ul{margin:0;padding:0}
.sp ul{list-style:none}
.sp-group{margin:0 0 2rem}
.sp-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:.25rem .75rem;margin:0 0 .85rem}
.sp-head h2{font-size:1.3rem;font-weight:800;line-height:1.25;overflow-wrap:anywhere}
.sp-count{color:var(--v-muted,#aaa);font-size:.95rem}
.sp-list{display:flex;flex-wrap:wrap;gap:.6rem}
.sp-chip{display:inline-flex;align-items:center;min-height:2.75rem;max-width:100%;padding:.45rem 1rem;background:var(--v-surface,#1c1c1f);border:1px solid var(--v-line,#333);border-radius:999px;font-weight:600;overflow-wrap:anywhere}
.sp-nav{display:grid;grid-template-columns:1fr 1fr;gap:.6rem;margin:1.5rem 0 0;max-width:28rem}.sp-pg{grid-column:1/-1;order:-1;color:var(--v-muted,#aaa)}
.sp-btn{display:inline-flex;align-items:center;justify-content:center;min-height:2.75rem;padding:.55rem 1.1rem;border:0;border-radius:.7rem;font:inherit;font-weight:600;text-decoration:none;cursor:pointer;background:var(--v-accent,#e8a23b);color:var(--v-accent-fg,#111)}
.sp-btn.sp-quiet{background:transparent;color:var(--v-fg,inherit);border:1px solid var(--v-line,#333)}
.sp-btn:focus-visible,.sp-input:focus-visible,.sp-check input:focus-visible{outline:2px solid var(--v-fg,currentColor);outline-offset:3px}
.sp-nav [aria-disabled]{opacity:.45}
.sp-empty{padding:2.25rem 1.25rem;text-align:center;border:1px dashed var(--v-line,#333);border-radius:1rem;background:var(--v-surface,#1c1c1f)}
.sp-empty-t{font-size:1.15rem;font-weight:700}
.sp .sp-empty-s{color:var(--v-muted,#aaa);margin-top:.35rem}
.sp-card{padding:1.25rem;background:var(--v-surface,#1c1c1f);border:1px solid var(--v-line,#333);border-radius:1.1rem;max-width:34rem}
.sp-card p+p,.sp-card p+form,.sp-card form+p{margin-top:.9rem}
.sp-note{color:var(--v-muted,#aaa);font-size:.95rem;line-height:1.5;overflow-wrap:anywhere}
.sp-state{padding:.7rem .9rem;border:1px solid var(--v-line,#333);border-radius:.8rem;font-weight:600}
.sp-field{display:block;margin:1rem 0 0}
.sp-label{display:block;font-weight:700;margin:0 0 .35rem}
.sp-input{display:block;width:100%;min-height:2.75rem;padding:.55rem .8rem;font:inherit;color:var(--v-fg,inherit);background:var(--v-bg,#121214);border:1px solid var(--v-line,#555);border-radius:.7rem}
.sp-input[aria-invalid=true]{border-color:var(--v-danger,#e5484d);border-width:2px}
.sp-err{margin:.4rem 0 0;color:var(--v-danger,#e5484d);font-weight:600}
.sp-check{display:flex;gap:.7rem;align-items:flex-start;margin:1rem 0 0;min-height:2.75rem}
.sp-check input{flex:0 0 auto;width:1.5rem;height:1.5rem;margin:.1rem 0 0;accent-color:var(--v-accent,#e8a23b)}
.sp-check label{line-height:1.45}
.sp-actions{display:flex;flex-wrap:wrap;gap:.6rem;margin:1.25rem 0 0}
.sp-trap{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.sp-ok{padding:.8rem 1rem;border-radius:.8rem;border:1px solid var(--v-accent,#e8a23b);font-weight:600}
@media (min-width:36rem){.sp-head h2{font-size:1.45rem}}
`.replace(/\n/g, "");

const basePath = (ctx) => (ctx.instance.basePath ? `/${String(ctx.instance.basePath).replace(/^\/+|\/+$/g, "")}` : "");
const localePrefix = (ctx) => (ctx.locale && ctx.locale !== ctx.defaultLocale ? `/${ctx.locale}` : "");
const href = (ctx, tail = "") => `${localePrefix(ctx)}${basePath(ctx)}${tail}` || "/";

/** Les réglages d'affichage, bornés. */
export function displayOf(ctx) {
  return { pageSize: int(ctx.setting("pageSize"), LIMITS.publicPageDefault, 6, LIMITS.publicPage), showTiers: P.flag(ctx.setting("showTiers"), true), review: P.flag(ctx.setting("review"), true) };
}

/**
 * Ce que le public peut voir : [{ key, title|null, rank, people: [{ pid, pseudo }] }], dans l'ordre d'affichage (palier le plus haut d'abord, les sans-libellé à la fin).
 * Un libellé de palier qui ressemble à un montant n'est jamais montré.
 */
export async function publicGroups(ctx) {
  const snap = await D.snapshot(ctx);
  const { activeDays } = S.knobs(ctx), d = displayOf(ctx);
  const labelOf = (t) => { const x = P.pickText(t.label, ctx.locale, ctx.defaultLocale); return x && !P.looksLikeAmount(x) ? x : ""; };
  const groups = new Map();
  for (const { data: p } of snap.people.values()) {
    if (!P.isShown(p, S.providerOfPerson(ctx, p), activeDays)) continue;
    let tier = null;
    if (d.showTiers) for (const k of p.tiers ?? []) { const t = snap.tiers.get(k)?.data; if (t && labelOf(t) && (!tier || (t.rank ?? 0) > (tier.rank ?? 0))) tier = t; }
    const key = tier ? tier.k : "";
    if (!groups.has(key)) groups.set(key, { key, title: tier ? labelOf(tier) : null, rank: tier ? tier.rank ?? 0 : -1, people: [] });
    groups.get(key).people.push({ pid: p.pid, pseudo: p.consent.pseudo });
  }
  const out = [...groups.values()].sort((a, b) => b.rank - a.rank);
  for (const g of out) g.people.sort((a, b) => P.sortText(a.pseudo, b.pseudo, ctx.locale));
  return out;
}

const empty = (ctx, title, sub) => ({ type: "html", html: `<div class="sp"><style>${CSS}</style><div class="sp-empty" role="status"><p class="sp-empty-t">${esc(title)}</p><p class="sp-empty-s">${esc(sub)}</p></div></div>` });
const pageTitle = (ctx) => clean(ctx.setting("title"), 120) || ctx.t("pageTitle");
const count = (ctx, n) => (n === 1 ? ctx.t("pubCountOne") : ctx.t("pubCount", { n }));

/** / · /page/2 · /moi/<pid>/<jeton> · /moi/<pid>/<jeton>/<état> → { kind: "list", page } | { kind: "me", pid, token, status } | null (introuvable). */
export function parseRoute(segments) {
  const s = Array.isArray(segments) ? segments.filter((x) => x !== "") : [];
  if (!s.length) return { kind: "list", page: 1 };
  if (s[0] === "page" && s.length === 2 && /^[1-9]\d{0,3}$/.test(s[1])) return { kind: "list", page: Number(s[1]) };
  if (s[0] === "moi" && (s.length === 3 || s.length === 4) && P.pidOk(s[1]) && /^[a-f0-9]{32}$/.test(s[2])) {
    const status = s[3] ?? "";
    if (status && !/^(ok-shown|ok-pending|left|e-[a-z]{3,8})$/.test(status)) return null;
    return { kind: "me", pid: s[1], token: s[2], status };
  }
  return null;
}

/** La page publique. `segments` : ce qui suit le chemin de l'instance, en minuscules. */
export async function render(ctx, segments) {
  const route = parseRoute(segments);
  if (!route) return { notFound: true, blocks: [] };
  if (route.kind === "me") return renderMe(ctx, route);
  S.ensureFresh(ctx);   // données vieilles : une actualisation part, sans que la personne qui visite l'attende
  const title = pageTitle(ctx), d = displayOf(ctx);
  const groups = await publicGroups(ctx);
  const flat = groups.flatMap((g) => g.people.map((p) => ({ ...p, group: g })));
  const pages = Math.max(1, Math.ceil(flat.length / d.pageSize));
  if (route.page > pages) return { notFound: true, blocks: [] };
  const intro = clean(ctx.setting("intro"), 2000, true);
  const blocks = [];
  if (intro) blocks.push({ type: "markdown", text: intro });
  if (!flat.length) { blocks.push(empty(ctx, ctx.t("pubEmptyTitle"), ctx.t("pubEmptyText"))); return { title, description: intro.slice(0, 160) || ctx.t("pubDescription"), blocks }; }
  const slice = flat.slice((route.page - 1) * d.pageSize, route.page * d.pageSize);
  const shownGroups = [];
  for (const item of slice) {
    let g = shownGroups.find((x) => x.group === item.group);
    if (!g) { g = { group: item.group, people: [] }; shownGroups.push(g); }
    g.people.push(item);
  }
  const others = clean(ctx.setting("othersTitle"), 80) || ctx.t("pubOthers");
  const many = groups.length > 1 || (groups[0] && groups[0].title);
  const body = shownGroups.map((g, i) => {
    const heading = g.group.title ?? (many ? others : null);
    const n = g.group.people.length;
    return `<section class="sp-group"${heading ? ` aria-labelledby="sp-g${i}"` : ""}>${heading ? `<div class="sp-head"><h2 id="sp-g${i}">${esc(heading)}</h2><span class="sp-count">${esc(count(ctx, n))}</span></div>` : ""}<ul class="sp-list">${g.people.map((p) => `<li class="sp-chip">${esc(p.pseudo)}</li>`).join("")}</ul></section>`;
  }).join("");
  const link = (n) => href(ctx, n > 1 ? `/page/${n}` : "");
  const nav = pages > 1 ? `<nav class="sp-nav" aria-label="${esc(ctx.t("pubPages"))}">${route.page > 1 ? `<a class="sp-btn" rel="prev" href="${esc(link(route.page - 1))}">${esc(ctx.t("pubPrev"))}</a>` : `<span class="sp-btn" aria-disabled="true">${esc(ctx.t("pubPrev"))}</span>`}<span class="sp-pg">${esc(ctx.t("pubPageOf", { page: route.page, pages }))}</span>${route.page < pages ? `<a class="sp-btn" rel="next" href="${esc(link(route.page + 1))}">${esc(ctx.t("pubNext"))}</a>` : `<span class="sp-btn" aria-disabled="true">${esc(ctx.t("pubNext"))}</span>`}</nav>` : "";
  blocks.push({ type: "html", html: `<div class="sp"><style>${CSS}</style>${body}${nav}</div>` });
  return { title, description: intro.slice(0, 160) || ctx.t("pubDescription"), blocks };
}

/* ───────────── L'accord personnel ───────────── */

/** La personne et son jeton : { person } ou null. Jamais de détail sur la raison (numéro inconnu, jeton périmé…). */
export async function personByLink(ctx, pid, token) {
  const snap = await D.snapshot(ctx, { fresh: true });
  const rec = snap.byPid.get(pid);
  const secret = D.stateOf(snap).secret;
  if (!rec || !secret) return null;
  return P.sameSecret(P.consentToken(secret, pid, rec.data.gen), token) ? rec : null;
}

async function renderMe(ctx, route) {
  const rec = await personByLink(ctx, route.pid, route.token);
  if (!rec) return { notFound: true, blocks: [] };
  const p = rec.data, d = displayOf(ctx), t = ctx.t;
  const status = route.status;
  const err = status.startsWith("e-") ? status.slice(2) : "";
  const cs = P.consentState(p);
  const intro = clean(ctx.setting("consentIntro"), 600, true);
  const state = cs === "approved" ? t("meStateShown", { pseudo: p.consent.pseudo }) : cs === "pending" ? t("meStatePending", { pseudo: p.consent.pseudo }) : t("meStateNone");
  const notice = status === "ok-shown" ? t("meDoneShown") : status === "ok-pending" ? t("meDonePending") : status === "left" ? t("meDoneLeft") : "";
  const errText = { short: "errPseudoShort", long: "errPseudoLong", link: "errPseudoLink", email: "errPseudoEmail", chars: "errPseudoChars", agree: "errAgree", wait: "errWait", busy: "errBusy" }[err];
  const pseudoErr = ["short", "long", "link", "email", "chars"].includes(err);
  const agreeErr = err === "agree";
  const otherErr = errText && !pseudoErr && !agreeErr;
  const url = href(ctx, `/moi/${route.pid}/${route.token}`);
  const form = `<form method="post" action="/m/${esc(ctx.instance.key)}/consent" novalidate>
<input type="hidden" name="pid" value="${esc(route.pid)}"><input type="hidden" name="t" value="${esc(route.token)}"><input type="hidden" name="loc" value="${esc(ctx.locale)}">
<div class="sp-trap" aria-hidden="true"><label>Website <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
<div class="sp-field"><label class="sp-label" for="sp-pseudo">${esc(t("mePseudoLabel"))}</label><input class="sp-input" id="sp-pseudo" name="pseudo" type="text" maxlength="${LIMITS.pseudo}" autocomplete="off" value="${esc(p.consent?.pseudo ?? "")}" aria-describedby="sp-pseudo-h${pseudoErr ? " sp-pseudo-e" : ""}"${pseudoErr ? ' aria-invalid="true"' : ""}><p class="sp-note" id="sp-pseudo-h">${esc(t("mePseudoHelp", { max: LIMITS.pseudo }))}</p>${pseudoErr ? `<p class="sp-err" id="sp-pseudo-e" role="alert">${esc(t(errText, { max: LIMITS.pseudo }))}</p>` : ""}</div>
<div class="sp-check"><input id="sp-agree" name="agree" type="checkbox" value="yes"${agreeErr ? ' aria-invalid="true" aria-describedby="sp-agree-e"' : ""}><label for="sp-agree">${esc(t("meAgree"))}</label></div>${agreeErr ? `<p class="sp-err" id="sp-agree-e" role="alert">${esc(t(errText))}</p>` : ""}
<div class="sp-actions"><button class="sp-btn" type="submit" name="act" value="accept">${esc(t("meAccept"))}</button>${cs !== "none" ? `<button class="sp-btn sp-quiet" type="submit" name="act" value="withdraw">${esc(t("meWithdraw"))}</button>` : ""}</div></form>`;
  const html = `<div class="sp"><style>${CSS}</style><div class="sp-card">${notice ? `<p class="sp-ok" role="status">${esc(notice)}</p>` : ""}${otherErr ? `<p class="sp-err" role="alert">${esc(t(errText))}</p>` : ""}${intro ? `<p>${esc(intro)}</p>` : ""}<p>${esc(t("meExplain"))}</p><p class="sp-state">${esc(state)}</p>${form}<p class="sp-note">${esc(t("mePrivacy"))}</p><p class="sp-note"><a href="${esc(href(ctx))}">${esc(t("meBack"))}</a></p></div></div>`;
  void url; void d;
  return { title: t("meTitle"), description: t("meExplain"), blocks: [{ type: "html", html }] };
}
