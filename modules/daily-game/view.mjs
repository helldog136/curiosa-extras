// Jeu du jour — ce que voit le visiteur : la page du jeu et le bloc d'accueil, construits en HTML simple (texte échappé).
// La question est dans la page ; sa bonne réponse, JAMAIS : elle n'arrive qu'après la réponse, par la route « answer ».
// Le petit script (client.mjs) ajoute le jeu lui-même : réponse, chronomètre facultatif, série et scores gardés dans le navigateur, partage.
const q = new URL(import.meta.url).search;
const { esc, clean, longDay, weekKey, languageName } = await import(`./lib.mjs${q}`);
const D = await import(`./data.mjs${q}`);
const B = await import(`./bridge.mjs${q}`);

/** Adresse de la page de l'instance (null si elle n'est pas montée sur un chemin). */
export function pageHref(ctx, localized = true) {
  const base = ctx.instance.basePath;
  if (base === null || base === undefined) return null;
  const prefix = localized && ctx.locale !== ctx.defaultLocale ? `/${ctx.locale}` : "";
  return `${prefix}${base ? `/${base}` : ""}` || "/";
}

/** Les mots que la propriétaire peut changer (vocabulaire) : un réglage vide = le texte neutre du module, dans la langue du visiteur. */
export function vocab(ctx) {
  const own = (key, max = 200) => clean(ctx.setting(key), max);
  const type = D.typeOf(ctx).id;
  const streak = own("streakText", 80);
  return {
    title: own("title", 80) || ctx.t(`title_${type}`),
    intro: clean(ctx.setting("intro"), 1000, true),
    play: own("playLabel", 40) || ctx.t("play"),
    streak: streak.includes("{n}") ? streak : ctx.t("streakMany"),
    comeBack: own("comeBack", 160) || ctx.t("comeBack"),
  };
}

/**
 * Le message confié à la mascotte (sujet `mascot.hint`) : jamais la réponse, jamais la question, seulement une invitation.
 * Le serveur ignore si CE visiteur a déjà joué (son état reste dans son navigateur) : l'invitation vaut pour tout le monde, une fois par jour.
 */
export function hintOf(ctx, day) {
  const text = clean(ctx.setting("hintText"), 140) || ctx.t("hintText");
  const url = pageHref(ctx);
  return { id: `daily-game:${ctx.instance.key}:${day}`.slice(0, 100), text, ...(url ? { url } : {}) };
}

const paragraphs = (text) => String(text).split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");

/** JSON sûr dans une balise de la page (aucune séquence qui ferme la balise ou casse une ligne). */
const safeJson = (value) => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

export const CSS = `
.dg{max-width:40rem;margin:0;color:var(--v-fg)}
.dg *,.dg *::before,.dg *::after{box-sizing:border-box}
.dg [hidden]{display:none!important}
.dg-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.dg-date{margin:0 0 .5rem;color:var(--v-muted);font-size:.95rem}.dg-date::first-letter{text-transform:uppercase}
.dg-intro{margin:0 0 1rem;color:var(--v-muted)}
.dg-intro p{margin:0 0 .5rem}
.dg-meta{display:flex;flex-wrap:wrap;gap:.4rem;margin:0 0 1rem;padding:0;list-style:none}
.dg-meta li{padding:.15rem .7rem;border:1px solid var(--v-line);border-radius:999px;background:var(--v-surface);color:var(--v-muted);font-size:.85rem}
.dg-card{margin:0 0 1.25rem;padding:1rem;border:1px solid var(--v-line);border-radius:16px;background:var(--v-surface)}
.dg-set{min-width:0;margin:0;padding:0;border:0}
.dg-qtext{display:block;width:100%;margin:0 0 .85rem;padding:0;font-size:1.3rem;font-weight:700;line-height:1.35;overflow-wrap:anywhere}
.dg-fig{margin:0 0 1rem}
.dg-fig img{display:block;max-width:100%;height:auto;max-height:18rem;margin:0 auto;border-radius:12px}
.dg-lang{margin:0 0 .75rem;color:var(--v-muted);font-size:.9rem}
.dg-choices{display:grid;gap:.6rem}
.dg-opt{position:relative}
.dg-opt input{position:absolute;inset:0 auto auto 0;width:1px;height:1px;opacity:0}
.dg-opt label{display:flex;align-items:center;gap:.75rem;min-height:52px;padding:.65rem .9rem;border:2px solid var(--v-line);border-radius:12px;background:var(--v-bg);color:var(--v-fg);cursor:pointer;overflow-wrap:anywhere}
.dg-opt label:hover{border-color:var(--v-accent)}
.dg-opt input:checked+label{border-color:var(--v-accent);box-shadow:0 0 0 2px var(--v-accent)}
.dg-opt input:focus-visible+label{outline:3px solid var(--v-accent);outline-offset:3px}
.dg-letter{flex:none;display:inline-flex;align-items:center;justify-content:center;width:2rem;height:2rem;border-radius:50%;background:var(--v-surface);border:1px solid var(--v-line);font-weight:700;font-size:.9rem}
.dg-ctext{flex:1 1 auto;min-width:0}
.dg-flag{flex:none;min-width:1.2rem;text-align:center;font-weight:700}
.dg-opt.is-correct label{border-color:var(--v-success);background:var(--v-surface);box-shadow:0 0 0 2px var(--v-success)}
.dg-opt.is-correct .dg-flag{color:var(--v-success)}
.dg-opt.is-wrong label{border-color:var(--v-danger);box-shadow:0 0 0 2px var(--v-danger)}
.dg-opt.is-wrong .dg-flag{color:var(--v-danger)}
.dg-form.is-done .dg-opt label{cursor:default}
.dg-form.is-done .dg-opt label:hover{border-color:var(--v-line)}
.dg-form.is-done .dg-opt.is-correct label:hover{border-color:var(--v-success)}
.dg-form.is-done .dg-opt.is-wrong label:hover{border-color:var(--v-danger)}
.dg-actions{margin:1rem 0 0}
.dg-btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 1.2rem;border:1px solid var(--v-line);border-radius:999px;background:var(--v-bg);color:var(--v-fg);font:inherit;cursor:pointer;text-decoration:none}
.dg-btn:hover{border-color:var(--v-accent)}
.dg-btn:disabled{opacity:.6;cursor:default}
.dg-btn-main{border-color:transparent;background:var(--v-accent);color:var(--v-accent-fg);font-weight:700}
.dg button:focus-visible,.dg a:focus-visible,.dg input:focus-visible,.dg textarea:focus-visible,.dg [tabindex]:focus-visible{outline:3px solid var(--v-accent);outline-offset:2px}
.dg-error{margin:.75rem 0 0;padding:.6rem .8rem;border:1px solid var(--v-danger);border-radius:12px;color:var(--v-fg)}
.dg-timer{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem .9rem;margin:0 0 1rem}
.dg-timer label{display:inline-flex;align-items:center;gap:.5rem;min-height:44px;cursor:pointer}
.dg-timer input{width:1.25rem;height:1.25rem;accent-color:var(--v-accent)}
.dg-bar{flex:1 1 8rem;height:.6rem;border-radius:999px;background:var(--v-line);overflow:hidden}
.dg-bar>span{display:block;height:100%;background:var(--v-accent);transform-origin:left center}
.dg-sec{min-width:3.2rem;color:var(--v-muted);font-variant-numeric:tabular-nums;text-align:right}
.dg-timer-note{flex:1 1 100%;margin:0;color:var(--v-muted);font-size:.9rem}
.dg-result{margin:1rem 0 0;padding:1rem;border:1px solid var(--v-line);border-radius:12px;background:var(--v-bg)}
.dg-verdict:focus{outline:none}
.dg-verdict{margin:0 0 .5rem;font-size:1.25rem;font-weight:700}
.dg-verdict.is-good{color:var(--v-success)}
.dg-verdict.is-bad{color:var(--v-danger)}
.dg-explain{margin:0 0 .75rem;line-height:1.55}
.dg-score,.dg-streak,.dg-comeback{margin:0 0 .5rem}
.dg-streak{font-weight:600}
.dg-share{margin:1rem 0 0;padding-top:.85rem;border-top:1px solid var(--v-line)}
.dg-share-text{display:block;width:100%;min-height:44px;margin:0 0 .6rem;padding:.6rem .8rem;border:1px solid var(--v-line);border-radius:12px;background:var(--v-surface);color:var(--v-fg);font:inherit;resize:vertical}
.dg-row{display:flex;flex-wrap:wrap;gap:.5rem}
.dg-status{min-height:1.4em;margin:.4rem 0 0;color:var(--v-muted);font-size:.9rem}
.dg-stats{margin:0 0 1.25rem}
.dg-stats h2,.dg-board h2{margin:0 0 .6rem;font-size:1.1rem;font-weight:700}
.dg-stats dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(7.5rem,1fr));gap:.6rem;margin:0}
.dg-stats dl>div{padding:.6rem .75rem;border:1px solid var(--v-line);border-radius:12px;background:var(--v-surface)}
.dg-stats dt{color:var(--v-muted);font-size:.85rem}
.dg-stats dd{margin:0;font-size:1.4rem;font-weight:700;font-variant-numeric:tabular-nums}
.dg-board{margin:0 0 1.25rem;padding:1rem;border:1px solid var(--v-line);border-radius:16px;background:var(--v-surface)}
.dg-board ol{margin:0 0 .75rem;padding:0;list-style:none;counter-reset:dg}
.dg-board li{display:flex;gap:.6rem;align-items:baseline;padding:.4rem 0;border-bottom:1px solid var(--v-line);counter-increment:dg}
.dg-board li::before{content:counter(dg);flex:none;min-width:1.5rem;color:var(--v-muted);font-variant-numeric:tabular-nums}
.dg-board li span:first-child{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}
.dg-board li span+span{flex:none;font-weight:700;font-variant-numeric:tabular-nums}
.dg-board p{margin:0 0 .6rem}
.dg-board label{display:block;margin:0 0 .3rem;font-weight:600}
.dg-board input[type=text]{display:block;width:100%;min-height:44px;margin:0 0 .5rem;padding:.5rem .8rem;border:1px solid var(--v-line);border-radius:12px;background:var(--v-bg);color:var(--v-fg);font:inherit}
.dg-hint{margin:.3rem 0 .6rem;color:var(--v-muted);font-size:.9rem}
.dg-foot{margin:0;color:var(--v-muted);font-size:.9rem}
.dg-foot p{margin:0 0 .6rem}
.dg-none{padding:1rem;border:1px dashed var(--v-line);border-radius:12px;color:var(--v-muted)}
.dg-none p{margin:0 0 .4rem}
.dg-home{max-width:32rem;padding:1rem;border:1px solid var(--v-line);border-radius:16px;background:var(--v-surface);color:var(--v-fg)}
.dg-home p{margin:0 0 .6rem}
.dg-home .dg-state{font-size:1.05rem}
.dg-home .dg-streakline{font-weight:600}
@media (prefers-reduced-motion:no-preference){
.dg-result:not([hidden]){animation:dg-in .35s ease-out}
.dg-opt.is-correct label{animation:dg-pop .35s ease-out}
.dg-flame{display:inline-block;animation:dg-pulse 1s ease-in-out 2}
.dg-bar>span{transition:transform .25s linear}
}
@keyframes dg-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes dg-pop{0%{transform:scale(.97)}60%{transform:scale(1.015)}100%{transform:none}}
@keyframes dg-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.25)}}
`.replace(/\n/g, "");

/** Les textes que le navigateur affiche (le script n'a aucun texte en dur). */
function texts(ctx, v) {
  const keys = ["good", "bad", "score", "bonus", "streakOne", "copied", "copyFail", "timerEnd", "timerOn", "timerOff", "newDay", "limit", "invalid", "busy", "net", "pick", "cleared", "muted", "already",
    "boardSent", "boardTop", "boardPts", "boardAlready", "boardNeedPseudo", "pseudo_taken", "pseudo_short", "pseudo_long", "pseudo_chars", "pseudo_banned", "srGood", "srBad", "srYours", "seconds", "shareGood", "shareBad"];
  const out = Object.fromEntries(keys.map((k) => [k, ctx.t(k)]));
  out.streakMany = v.streak;
  out.comeBack = v.comeBack;
  return out;
}

/** La page du jeu. `now` : l'instant (pour les tests). */
export async function renderPage(ctx, now = D.clock.now()) {
  const v = vocab(ctx);
  const type = D.typeOf(ctx);
  const { day, prev, item } = await D.getToday(ctx, now);
  const href = pageHref(ctx);
  const parts = [`<style>${CSS}</style>`];
  const url = href === null ? "" : `${ctx.api.siteUrl}${href === "/" ? "" : href}`;
  const timerMode = D.timerModeOf(ctx);
  const shareOn = D.flag(ctx, "shareButton", true);
  const boardOn = D.flag(ctx, "leaderboard", false) && (await B.present(ctx));
  const week = weekKey(day);
  const attrs = `data-dg data-key="${esc(ctx.instance.key)}" data-day="${esc(day)}" data-prev="${esc(prev)}" data-qid="${esc(item?.id ?? "")}" data-type="${esc(type.id)}"`
    + ` data-timer="${esc(timerMode)}" data-seconds="${D.secondsOf(ctx)}" data-api="/m/${esc(ctx.instance.key)}" data-lang="${esc(ctx.locale)}" data-title="${esc(v.title)}" data-url="${esc(url)}"`
    + ` data-board="${boardOn ? "1" : "0"}" data-week="${esc(week)}" data-share="${shareOn ? "1" : "0"}"`;
  parts.push(`<div class="dg" ${attrs}>`);
  parts.push(`<p class="dg-date">${esc(longDay(day, ctx.locale))}</p>`);
  if (v.intro) parts.push(`<div class="dg-intro">${paragraphs(v.intro)}</div>`);

  const play = item ? type.play(ctx, item) : null;
  if (!item || !play) {
    parts.push(`<div class="dg-none"><p><strong>${esc(ctx.t("noneTitle"))}</strong></p><p>${esc(ctx.t("noneText"))}</p></div>`);
    parts.push(`</div>`);
    return { html: parts.join(""), item: null, day };
  }
  const meta = [item.cat ? esc(item.cat) : "", item.lvl ? esc(ctx.t(`lvl_${item.lvl}`)) : ""].filter(Boolean);
  if (meta.length) parts.push(`<ul class="dg-meta">${meta.map((m) => `<li>${m}</li>`).join("")}</ul>`);
  parts.push(`<section class="dg-card" aria-label="${esc(v.title)}" data-dg-card-play>`);
  parts.push(`<p class="dg-streak" data-dg-streakline hidden></p>`);
  if (timerMode !== "none") {
    parts.push(`<div class="dg-timer" data-dg-timerbox hidden><label><input type="checkbox" data-dg-timer${timerMode === "on" ? " checked" : ""}> <span>${esc(ctx.t("timerLabel", { n: D.secondsOf(ctx) }))}</span></label>`
      + `<div class="dg-bar" aria-hidden="true"><span data-dg-bar></span></div><span class="dg-sec" aria-hidden="true" data-dg-sec></span>`
      + `<p class="dg-timer-note" data-dg-timernote>${esc(ctx.t("timerHelp"))}</p></div>`);
  }
  if (play.other) parts.push(`<p class="dg-lang">${esc(ctx.t("otherLanguage", { lang: languageName(play.lang, ctx.locale) }))}</p>`);
  parts.push(`<div class="dg-play" data-dg-play>${play.html}</div>`);
  parts.push(`<noscript><p class="dg-hint">${esc(ctx.t("needScript"))}</p></noscript>`);
  const key = esc(ctx.instance.key);
  parts.push(
    `<div class="dg-result" data-dg-result hidden><h2 class="dg-verdict" data-dg-verdict tabindex="-1"></h2><p class="dg-explain" data-dg-explain></p><p class="dg-score" data-dg-score></p>`
    + `<p class="dg-streak" data-dg-streak></p><p class="dg-comeback" data-dg-comeback></p>`
    + (shareOn
      ? `<div class="dg-share"><label class="dg-sr" for="dg-share-${key}">${esc(ctx.t("shareLabel"))}</label><textarea class="dg-share-text" id="dg-share-${key}" rows="3" readonly data-dg-sharetext></textarea>`
        + `<div class="dg-row"><button type="button" class="dg-btn dg-btn-main" data-dg-copy>${esc(ctx.t("copyResult"))}</button><button type="button" class="dg-btn" data-dg-share hidden>${esc(ctx.t("shareNative"))}</button></div>`
        + `<p class="dg-status" role="status" data-dg-copystatus></p></div>`
      : "")
    + (boardOn ? `<div class="dg-share" data-dg-boardprompt hidden><p>${esc(ctx.t("boardAsk"))}</p><div class="dg-row"><button type="button" class="dg-btn" data-dg-boardopen>${esc(ctx.t("boardJoin"))}</button></div></div>` : "")
    + `</div>`,
  );
  parts.push(`</section>`);

  parts.push(`<section class="dg-stats" aria-labelledby="dg-stats-${key}" data-dg-stats hidden><h2 id="dg-stats-${key}">${esc(ctx.t("statsTitle"))}</h2><dl>`
    + `<div><dt>${esc(ctx.t("statStreak"))}</dt><dd data-dg-s-streak>0</dd></div><div><dt>${esc(ctx.t("statBestStreak"))}</dt><dd data-dg-s-best>0</dd></div>`
    + `<div><dt>${esc(ctx.t("statBestScore"))}</dt><dd data-dg-s-score>0</dd></div><div><dt>${esc(ctx.t("statPlays"))}</dt><dd data-dg-s-plays>0</dd></div></dl></section>`);

  if (boardOn) parts.push(await boardHtml(ctx, week));

  parts.push(`<div class="dg-foot"><p>${esc(ctx.t("privacyShort"))}</p><p data-dg-nostorage hidden>${esc(ctx.t("noStorage"))}</p><button type="button" class="dg-btn" data-dg-clear hidden>${esc(ctx.t("clearData"))}</button><p class="dg-status" role="status" data-dg-clearstatus></p></div>`);
  parts.push(`<script type="application/json" data-dg-texts>${safeJson(texts(ctx, v))}</script>`);
  parts.push(`</div>`);
  return { html: parts.join(""), item, day };
}

/** Le classement de la semaine (haut du tableau) et, pour le visiteur qui le veut, le formulaire pour y apparaître. */
export async function boardHtml(ctx, week) {
  let top = [];
  try { top = await D.boardTop(ctx, week, 10); } catch { top = []; }
  const key = esc(ctx.instance.key);
  const list = top.length
    ? `<ol data-dg-toplist>${top.map((r) => `<li><span>${esc(r.name || ctx.t("boardAnon"))}</span><span>${esc(ctx.t("boardPts", { n: r.pts }))}</span></li>`).join("")}</ol>`
    : `<p data-dg-toplist-empty>${esc(ctx.t("boardEmpty"))}</p><ol data-dg-toplist hidden></ol>`;
  return `<section class="dg-board" aria-labelledby="dg-board-${key}" data-dg-board><h2 id="dg-board-${key}">${esc(ctx.t("boardTitle"))}</h2>${list}`
    + `<form class="dg-boardform" data-dg-boardform hidden novalidate><label for="dg-nick-${key}">${esc(ctx.t("boardPseudo"))}</label>`
    + `<input type="text" id="dg-nick-${key}" name="nick" maxlength="30" autocomplete="nickname" autocapitalize="off" spellcheck="false" aria-describedby="dg-nickhint-${key}" data-dg-nick>`
    + `<p class="dg-hint" id="dg-nickhint-${key}">${esc(ctx.t("boardPseudoHelp"))}</p><p class="dg-error" role="alert" data-dg-boarderror hidden></p>`
    + `<div class="dg-row"><button type="submit" class="dg-btn dg-btn-main">${esc(ctx.t("boardSubmit"))}</button><button type="button" class="dg-btn" data-dg-boardleave>${esc(ctx.t("boardLeave"))}</button></div></form>`
    + `<p class="dg-hint" data-dg-boardstate hidden></p><div class="dg-row"><button type="button" class="dg-btn" data-dg-boardmanage hidden>${esc(ctx.t("boardManage"))}</button></div>`
    + `<p class="dg-status" role="status" data-dg-boardstatus></p><p class="dg-hint">${esc(ctx.t("boardPrivacy"))}</p></section>`;
}

/** Le bloc d'accueil « Le jeu du jour » : une invitation ; le script de la page change son état (à jouer / déjà joué / série) d'après le navigateur. */
export async function renderCard(ctx, now = D.clock.now()) {
  const v = vocab(ctx);
  const href = pageHref(ctx);
  if (href === null) return null;
  const { day, prev, item } = await D.getToday(ctx, now);
  if (!item) return null;
  const t = { play: v.play, again: ctx.t("seeResult"), toPlay: ctx.t("cardToPlay"), played: ctx.t("cardPlayed"), streakOne: ctx.t("streakOne"), streakMany: v.streak };
  const html = `<style>${CSS}</style><div class="dg-home dg" data-dg-card data-key="${esc(ctx.instance.key)}" data-day="${esc(day)}" data-prev="${esc(prev)}">`
    + `<p class="dg-state" data-dg-state>${esc(t.toPlay)}</p><p class="dg-streakline" data-dg-cardstreak hidden></p>`
    + `<a class="dg-btn dg-btn-main" href="${esc(href)}" data-dg-cardlink>${esc(t.play)}</a>`
    + `<script type="application/json" data-dg-cardtexts>${safeJson(t)}</script></div>`;
  return [{ type: "heading", text: v.title }, { type: "html", html }];
}
