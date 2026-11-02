// Jeu du jour — la table des TYPES DE JEU. Un type sait : se lire depuis un formulaire ou un fichier CSV, s'afficher à jouer SANS sa solution,
// juger une réponse, et s'afficher en aperçu AVEC sa solution. Tout le reste (quelle question aujourd'hui, série, partage, classement, planning,
// import, packs, vocabulaire) est commun et ne sait rien du type.
//
// AJOUTER UN JEU (« devinette d'image », « mot du jour »…) :
//   1. écrire un objet qui respecte le contrat ci-dessous et l'enregistrer : `registerGameType(monType)` (ici, dans ce fichier, ou dans un fichier voisin importé d'ici) ;
//   2. ajouter une option au réglage « gameType » de module.json et les textes dans locales/fr.json et locales/en.json ;
//   3. ajouter la façon dont le navigateur lit la réponse et montre le résultat : une entrée dans `TYPES` de client.mjs (clé = l'identifiant du type) ;
//   4. (facultatif) des questions de départ dans packs.mjs, avec `type: "<identifiant>"`.
// Rien d'autre à toucher : le choix de la question du jour, la série, le partage, le classement et l'administration marchent tels quels.
//
// CONTRAT d'un type (toutes les fonctions sont synchrones et ne touchent ni au stockage ni au réseau) :
//   id                         identifiant (minuscules, chiffres, tirets), celui du réglage « gameType »
//   blank()                    contenu vide
//   normalize(raw)             remet en forme ce qui vient du stockage (jamais de plantage sur une donnée abîmée)
//   complete(d)                assez rempli pour être publié ?
//   langs(d)                   langues dans lesquelles le contenu est complet
//   title(d, order)            titre court pour les listes (`order` : langues à essayer)
//   text(d)                    tout le texte du contenu, pour la recherche
//   fields(ctx, item, locales) champs du formulaire d'administration (blocs « adminForm »)
//   fromForm(ctx, values, { locales, state })   → { d } ou { errors: { champ: message } }
//   play(ctx, item, { preview }) → { html, lang, other }   la zone de jeu ; SANS solution, sauf `preview`
//   check(ctx, item, body)     → { ok: false } ou { ok: true, correct, score?, reveal }   `reveal` (JSON) est la seule chose envoyée après la réponse
//   csvColumns(locales) / csvRow(item, locales) / fromCsv(get, { locales, lang }) → { d } ou { fail: { column, key } }
//   csvAliases (facultatif)    { colonne: [autres noms possibles] } en plus de COLUMN_ALIASES ; csvRequired (facultatif) : colonnes dont une au moins doit exister (défaut : ["question"])
//   fromAssistant(ctx, args, { locales })  → { d } ou { fail }   (outil de l'assistant IA)
//   describe(ctx, item)        → objet simple pour l'assistant (sans solution sauf si demandé)
const q = new URL(import.meta.url).search;   // le cœur recharge index.mjs avec ?v=… : les fichiers voisins suivent
const { clean, esc, LIMITS, safeImage, columnKey, csvUnprotect, languageName, isLocale } = await import(`./lib.mjs${q}`);

const TYPES = new Map();

export function registerGameType(def) {
  if (!def || !/^[a-z][a-z0-9-]{1,30}$/.test(String(def.id))) throw new Error("game type: bad id");
  for (const fn of ["blank", "normalize", "complete", "langs", "title", "text", "fields", "fromForm", "play", "check", "csvColumns", "csvRow", "fromCsv", "fromAssistant", "describe"]) {
    if (typeof def[fn] !== "function") throw new Error(`game type ${def.id}: missing ${fn}()`);
  }
  TYPES.set(def.id, def);
  return def;
}

export const gameTypeIds = () => [...TYPES.keys()];
export const gameType = (id) => TYPES.get(String(id)) ?? TYPES.get("quiz");
export const hasGameType = (id) => TYPES.has(String(id));

// ── Le quiz : une question, 2 à 4 réponses, une bonne réponse, une explication ────────────────────────────────────────

const LETTERS = ["A", "B", "C", "D"];

/** La langue à montrer : celle du visiteur, sinon celle du site, sinon n'importe laquelle qui soit complète. */
function pickLang(ctx, d) {
  const ok = (l) => d.tr[l] && d.tr[l].q && d.tr[l].a.length >= 2;
  if (ok(ctx.locale)) return { lang: ctx.locale, other: false };
  for (const l of [ctx.defaultLocale, ...(ctx.locales ?? []), ...Object.keys(d.tr)]) if (ok(l)) return { lang: l, other: true };
  return null;
}

const quiz = {
  id: "quiz",

  blank: () => ({ tr: {}, correct: 0, img: "" }),

  normalize(raw) {
    const out = { tr: {}, correct: 0, img: safeImage(raw?.img) };
    for (const [l, v] of Object.entries(raw?.tr ?? {}).slice(0, 12)) {
      if (!isLocale(l)) continue;
      const a = (Array.isArray(v?.a) ? v.a : []).slice(0, LIMITS.choices).map((x) => clean(x, LIMITS.choice));
      while (a.length && !a[a.length - 1]) a.pop();
      const entry = { q: clean(v?.q, LIMITS.text), a, e: clean(v?.e, LIMITS.text, true), alt: clean(v?.alt, LIMITS.alt) };
      if (entry.q || entry.a.length || entry.e) out.tr[l] = entry;
    }
    const c = Math.trunc(Number(raw?.correct));
    out.correct = Number.isFinite(c) && c >= 0 && c < LIMITS.choices ? c : 0;
    return out;
  },

  complete(d) { return Object.values(d.tr).some((v) => v.q && v.a.length >= 2 && v.a.every(Boolean) && d.correct < v.a.length); },

  langs(d) { return Object.entries(d.tr).filter(([, v]) => v.q && v.a.length >= 2 && v.a.every(Boolean) && d.correct < v.a.length).map(([l]) => l); },

  title(d, order = []) {
    for (const l of [...order, ...Object.keys(d.tr)]) if (d.tr[l]?.q) return d.tr[l].q;
    return "";
  },

  text(d) { return Object.values(d.tr).flatMap((v) => [v.q, ...v.a, v.e]).join(" "); },

  /**
   * Le formulaire « Nouvelle question » : trois champs visibles (la question, les réponses une par ligne, laquelle est la bonne). Tout le reste est replié sous
   * « Plus d'options » : l'explication, l'image, les autres langues, la catégorie, la difficulté, la date et l'état. La première langue est celle du site.
   */
  fields(ctx, item, locales) {
    const d = item?.d ?? quiz.blank();
    const many = locales.length > 1;
    const f = [];
    locales.forEach((l, i) => {
      const lang = languageName(l, ctx.locale);
      const t = d.tr[l] ?? { q: "", a: [], e: "", alt: "" };
      const fold = i > 0 ? { folded: true } : {};
      f.push({ name: `q_${l}`, label: i === 0 ? ctx.t("fQuestion") : ctx.t("fQuestionIn", { lang }), value: t.q, example: ctx.t("exQuestion"), help: ctx.t("hQuestion", { max: LIMITS.text }), ...fold });
      f.push({ name: `answers_${l}`, kind: "textarea", label: i === 0 ? ctx.t("fAnswers") : ctx.t("fAnswersIn", { lang }), value: t.a.join("\n"), help: ctx.t("hAnswers"), example: ctx.t("exAnswer"), ...fold });
      if (i === 0) {
        f.push({ name: "correct", kind: "segmented", label: ctx.t("fCorrect"), value: String(d.correct + 1), options: [1, 2, 3, 4].map((n) => ({ value: String(n), label: String(n) })), help: ctx.t("hCorrect") });
      }
      f.push({ name: `e_${l}`, kind: "textarea", label: many ? ctx.t("fExplainIn", { lang }) : ctx.t("fExplain"), value: t.e, help: ctx.t("hExplain"), example: ctx.t("exExplain"), folded: true });
    });
    f.push({ name: "image", kind: "image", label: ctx.t("fImage"), value: d.img, help: ctx.t("hImage"), folded: true });
    locales.forEach((l) => f.push({ name: `alt_${l}`, label: many ? ctx.t("fAltIn", { lang: languageName(l, ctx.locale) }) : ctx.t("fAlt"), value: d.tr[l]?.alt ?? "", help: ctx.t("hAlt"), example: ctx.t("exAlt"), folded: true }));
    return f;
  },

  fromForm(ctx, values, { locales, state }) {
    const errors = {};
    const tr = {};
    const published = state === "published";
    let first = null;   // la première langue remplie : sert de référence pour le nombre de réponses
    for (const l of locales) {
      const lang = languageName(l, ctx.locale);
      const qq = clean(values[`q_${l}`], LIMITS.text);
      // Les réponses viennent d'un seul champ (une par ligne) ; les anciens champs a1_fr… sont encore lus (appels existants, tests).
      const asLines = values[`answers_${l}`] !== undefined;
      const ak = (n) => (asLines ? `answers_${l}` : `a${n}_${l}`);
      const lines = asLines ? String(values[`answers_${l}`] ?? "").split(/\r?\n/).map((x) => clean(x, LIMITS.choice)).filter(Boolean) : [];
      const raw = asLines ? [0, 1, 2, 3].map((i) => lines[i] ?? "") : [1, 2, 3, 4].map((n) => clean(values[`a${n}_${l}`], LIMITS.choice));
      const e = clean(values[`e_${l}`], LIMITS.text, true);
      const alt = clean(values[`alt_${l}`], LIMITS.alt);
      if (!qq && !raw.some(Boolean) && !e && !lines.length) continue;
      if (lines.length > LIMITS.choices) errors[ak(1)] = ctx.t("errTooMany", { max: LIMITS.choices, lang });
      let last = -1;
      raw.forEach((a, i) => { if (a) last = i; });
      let gap = false;
      for (let i = 0; i < last; i++) if (!raw[i]) { errors[ak(i + 1)] = ctx.t("errGap", { n: i + 1, lang }); gap = true; break; }
      const answers = raw.slice(0, last + 1);
      if (!gap) {
        const seen = new Map();
        answers.forEach((a, i) => {
          const k = a.toLowerCase();
          if (seen.has(k) && !errors[ak(i + 1)]) errors[ak(i + 1)] = ctx.t("errSame", { n: seen.get(k) + 1, lang });
          else seen.set(k, i);
        });
      }
      if (published) {
        if (!qq) errors[`q_${l}`] = ctx.t("errQuestion", { lang });
        if (answers.length < 2 && !errors[ak(Math.max(1, answers.length + 1))]) errors[ak(Math.max(1, answers.length + 1))] = ctx.t("errTwoAnswers", { lang });
      }
      if (published && qq && answers.length >= 2 && !gap) {
        if (first === null) first = { l, count: answers.length };
        else if (first.count !== answers.length && !errors[ak(1)]) errors[ak(1)] = ctx.t("errCount", { lang, n: answers.length, other: languageName(first.l, ctx.locale), m: first.count });
      }
      tr[l] = { q: qq, a: answers, e, alt };
    }
    if (!Object.keys(tr).length) errors[`q_${locales[0]}`] = ctx.t("errEmpty");
    const correct = Math.trunc(Number(values.correct));
    if (!(correct >= 1 && correct <= LIMITS.choices)) errors.correct = ctx.t("errCorrectPick");
    else if (published && first && correct > first.count) errors.correct = ctx.t("errCorrectRange", { n: correct, count: first.count });
    const rawImage = String(values.image ?? "").trim();
    const img = safeImage(rawImage);
    if (rawImage && !img) errors.image = ctx.t("errImage");
    if (published && img) for (const [l, v] of Object.entries(tr)) if (v.q && !v.alt && !errors[`alt_${l}`]) errors[`alt_${l}`] = ctx.t("errAlt", { lang: languageName(l, ctx.locale) });
    if (Object.keys(errors).length) return { errors };
    return { d: quiz.normalize({ tr, correct: correct - 1, img }) };
  },

  play(ctx, item, { preview = false } = {}) {
    const pick = pickLang(ctx, item.d);
    if (!pick) return null;
    const t = item.d.tr[pick.lang];
    const key = esc(item.id);
    const opts = t.a.map((text, i) => {
      const good = preview && i === item.d.correct;
      return `<div class="dg-opt${good ? " is-correct" : ""}"><input type="radio" id="dg-c-${key}-${i}" name="choice" value="${i}"${preview ? " disabled" : ""}${good ? " checked" : ""}>`
        + `<label for="dg-c-${key}-${i}"><span class="dg-letter" aria-hidden="true">${LETTERS[i]}</span><span class="dg-ctext">${esc(text)}</span><span class="dg-flag" aria-hidden="true">${good ? "✔" : ""}</span>${good ? `<span class="dg-sr"> (${esc(ctx.t("goodAnswer"))})</span>` : ""}</label></div>`;
    }).join("");
    const figure = item.d.img ? `<figure class="dg-fig"><img src="${esc(item.d.img)}" alt="${esc(t.alt)}" loading="lazy" decoding="async"></figure>` : "";
    const explain = preview && t.e ? `<p class="dg-explain"><strong>${esc(ctx.t("explainTitle"))}</strong> ${esc(t.e)}</p>` : "";
    const lang = pick.other ? ` lang="${esc(pick.lang)}"` : "";
    const html = `<form class="dg-form" data-dg-form data-dg-type="quiz" novalidate><fieldset class="dg-set"${lang}><legend class="dg-qtext">${esc(t.q)}</legend>${figure}<div class="dg-choices">${opts}</div></fieldset>`
      + (preview ? explain : `<p class="dg-error" role="alert" data-dg-error hidden></p><div class="dg-actions"><button type="submit" class="dg-btn dg-btn-main" data-dg-submit>${esc(ctx.t("submitAnswer"))}</button></div>`)
      + `</form>`;
    return { html, lang: pick.lang, other: pick.other };
  },

  check(ctx, item, body) {
    const pick = pickLang(ctx, item.d);
    const choice = typeof body?.choice === "number" ? body.choice : typeof body?.choice === "string" && /^[0-3]$/.test(body.choice) ? Number(body.choice) : NaN;
    if (!pick || !Number.isInteger(choice)) return { ok: false };
    const count = item.d.tr[pick.lang].a.length;
    if (choice < 0 || choice >= count) return { ok: false };
    return { ok: true, correct: choice === item.d.correct, reveal: { answer: item.d.correct, explain: item.d.tr[pick.lang].e } };
  },

  csvColumns(locales) {
    return ["correct", "image", ...locales.flatMap((l) => [`question_${l}`, ...[1, 2, 3, 4].map((n) => `answer${n}_${l}`), `explanation_${l}`, `image_alt_${l}`])];
  },

  csvRow(item, locales) {
    return [String(item.d.correct + 1), item.d.img, ...locales.flatMap((l) => { const t = item.d.tr[l]; return [t?.q ?? "", ...[0, 1, 2, 3].map((i) => t?.a[i] ?? ""), t?.e ?? "", t?.alt ?? ""]; })];
  },

  /** `get(nom, langue)` rend la valeur de la colonne (avec ses autres noms possibles), ou "". */
  fromCsv(get, { locales, lang }) {
    const tr = {};
    for (const l of locales) {
      const qq = clean(get("question", l), LIMITS.text);
      const raw = [1, 2, 3, 4].map((n) => clean(get(`answer${n}`, l), LIMITS.choice));
      const e = clean(get("explanation", l), LIMITS.text, true);
      const alt = clean(get("image_alt", l), LIMITS.alt);
      if (!qq && !raw.some(Boolean) && !e) continue;
      let last = -1;
      raw.forEach((a, i) => { if (a) last = i; });
      const a = raw.slice(0, last + 1);
      if (!qq) return { fail: { column: `question_${l}`, key: "csvNoQuestion", lang: l } };
      if (a.length < 2 || !a.every(Boolean)) return { fail: { column: `answer1_${l}`, key: "csvTwoAnswers", lang: l } };
      if (new Set(a.map((x) => x.toLowerCase())).size !== a.length) return { fail: { column: `answer1_${l}`, key: "csvSame", lang: l } };
      tr[l] = { q: qq, a, e, alt };
    }
    const langs = Object.keys(tr);
    if (!langs.length) return { fail: { column: `question_${lang}`, key: "csvNoQuestion", lang } };
    const ref = tr[langs.includes(lang) ? lang : langs[0]];
    if (langs.some((l) => tr[l].a.length !== ref.a.length)) return { fail: { column: "answer1", key: "csvCount" } };
    // La bonne réponse : un numéro (1 à 4), une lettre (A à D) ou le texte même de la réponse
    // (un numéro ou une lettre qui tombe dans les réponses gagne ; sinon on cherche le texte exact d'une réponse).
    const rawCorrect = clean(get("correct", ""), LIMITS.choice);
    let correct = -1;
    if (/^[1-4]$/.test(rawCorrect) && Number(rawCorrect) <= ref.a.length) correct = Number(rawCorrect) - 1;
    else if (/^[A-Da-d]$/.test(rawCorrect) && rawCorrect.toUpperCase().charCodeAt(0) - 65 < ref.a.length) correct = rawCorrect.toUpperCase().charCodeAt(0) - 65;
    else if (rawCorrect) correct = ref.a.findIndex((x) => x.toLowerCase() === rawCorrect.toLowerCase());
    if (correct < 0 || correct >= ref.a.length) return { fail: { column: "correct", key: "csvCorrect", count: ref.a.length } };
    const img = safeImage(csvUnprotect(get("image", "")));
    return { d: quiz.normalize({ tr, correct, img }) };
  },

  fromAssistant(ctx, args, { locales }) {
    const lang = locales.includes(args?.lang) ? args.lang : locales[0];
    const answers = (Array.isArray(args?.answers) ? args.answers : []).map((a) => clean(a, LIMITS.choice)).filter(Boolean).slice(0, LIMITS.choices);
    const qq = clean(args?.question, LIMITS.text);
    if (!qq) return { fail: "'question' is required." };
    if (answers.length < 2) return { fail: "'answers' needs 2 to 4 non-empty texts." };
    if (new Set(answers.map((a) => a.toLowerCase())).size !== answers.length) return { fail: "The answers must all be different." };
    const correct = Math.trunc(Number(args?.correct));
    if (!(correct >= 1 && correct <= answers.length)) return { fail: `'correct' must be the number (1 to ${answers.length}) of the right answer.` };
    return { d: quiz.normalize({ tr: { [lang]: { q: qq, a: answers, e: clean(args?.explanation, LIMITS.text, true), alt: "" } }, correct: correct - 1 }), lang };
  },

  describe(ctx, item, { solution = false } = {}) {
    return {
      questions: Object.fromEntries(Object.entries(item.d.tr).map(([l, v]) => [l, v.q])),
      ...(solution ? { answers: Object.fromEntries(Object.entries(item.d.tr).map(([l, v]) => [l, v.a])), correct: item.d.correct + 1, explanations: Object.fromEntries(Object.entries(item.d.tr).map(([l, v]) => [l, v.e])) } : {}),
    };
  },
};

registerGameType(quiz);

/** Les noms de colonnes d'un fichier : un nom lisible, toutes ses variantes (accents, majuscules, « réponse 1 »…). */
export const COLUMN_ALIASES = {
  question: ["question", "enonce", "intitule", "q"],
  answer1: ["answer1", "answer_1", "reponse1", "reponse_1", "choix1", "choix_1", "a1", "r1"],
  answer2: ["answer2", "answer_2", "reponse2", "reponse_2", "choix2", "choix_2", "a2", "r2"],
  answer3: ["answer3", "answer_3", "reponse3", "reponse_3", "choix3", "choix_3", "a3", "r3"],
  answer4: ["answer4", "answer_4", "reponse4", "reponse_4", "choix4", "choix_4", "a4", "r4"],
  correct: ["correct", "bonne_reponse", "bonne", "solution", "good", "right"],
  explanation: ["explanation", "explication", "explain", "e", "commentaire"],
  image: ["image", "illustration", "img"],
  image_alt: ["image_alt", "alt", "description_image", "texte_alternatif"],
  category: ["category", "categorie", "theme", "rubrique"],
  difficulty: ["difficulty", "difficulte", "niveau", "level"],
  date: ["date", "jour", "day"],
  status: ["status", "statut", "etat", "state"],
};

export { columnKey };
