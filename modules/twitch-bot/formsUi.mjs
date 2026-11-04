// Les morceaux de formulaire partagés par les commandes ET les timers : le choix « qui peut l'utiliser », l'aperçu et les morceaux à insérer sous le texte, la phrase
// « Attendre [ ] s… ». Chaque formulaire reste un formulaire du cœur (champs nommés, erreurs sous le champ) ; le script de la page (adminkit.client.js)
// les range d'après la configuration ci-dessous. Sans JavaScript, tous les champs sont là, dans l'ordre.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { ROLES, REPEAT_LIMITS, REPEAT_WHEN } = await import(`./commands.mjs${v}`);
const { allowedFor } = await import(`./variables.mjs${v}`);
const { preview } = await import(`./engine.mjs${v}`);

export const roleOptions = (t) => ROLES.map((r) => ({ value: r, label: t(`role_${r}`) }));

/** Les morceaux proposés en un clic sous le texte (les plus utiles ; les autres s'écrivent à la main). */
const CHIP_VARS = ["{utilisateur}", "{jeu}", "{titre}", "{uptime}", "{followers}", "{viewers}", "{prochain_stream}", "{partenaire}", "{adresse}", "{reseau}", "{lien}"].map((x) => x.slice(1, -1));
export function chipsFor(ctx, kind) {
  const ok = new Set(allowedFor(kind));
  return CHIP_VARS.filter((n) => ok.has(n)).map((n) => ({ v: n, label: ctx.t(`chip_${n}`) }));
}

/** La valeur du moment de chaque morceau simple, pour l'aperçu en direct (rien n'est envoyé). Un morceau qui ne se calcule pas est simplement absent. */
export async function samplesFor(ctx, kind, vars, env) {
  const out = {};
  for (const { v: name } of chipsFor(ctx, kind)) {
    try { out[name] = await preview(ctx, { kind, text: `{${name}}`, vars: vars ?? {} }, env); } catch { /* l'aperçu est un plus */ }
  }
  return out;
}

/** « Aperçu » et morceaux à insérer, sous le champ texte. */
export async function textExtras(ctx, kind, vars, env) {
  return { label: ctx.t("preview_label"), chipsLabel: ctx.t("chips_label"), chips: chipsFor(ctx, kind), samples: await samplesFor(ctx, kind, vars, env) };
}

/** « Attendre [ ] s entre deux réponses, et [ ] s pour une même personne » (le champ vide dit sa valeur par défaut). */
export function waitSentence(ctx, s) {
  const t = ctx.t;
  return { sentence: { title: t("wait_title"), hint: t("wait_hint", { all: s.cdGlobal, user: s.cdUser }), tokens: [t("wait_1"), { f: "cdGlobal", ph: String(s.cdGlobal), min: 0, max: 3600 }, t("wait_2"), { f: "cdUser", ph: String(s.cdUser), min: 0, max: 3600 }, t("wait_3")] } };
}
/* ───────────── « Répéter automatiquement » : le timer d'une commande ───────────── */

/** Où les champs de la répétition se rangent dans « Plus d'options » : l'interrupteur, la durée, un minimum de messages, « en direct / toujours » (rien n'est compté dans le résumé sauf l'interrupteur). */
export function repeatLayout(ctx, kind) {
  const t = ctx.t;
  return [
    { f: "repeatOn" },
    { f: "repeatEvery", quiet: true, showWhen: "repeatOn" },
    { nested: { title: t("rep_cond_title"), items: [
      { sentence: { title: t("rep_lines_title"), hint: t("rep_lines_hint", { max: REPEAT_LIMITS.lines }), tokens: [t("rep_lines_1"), { f: "repeatLines", ph: String(5), min: 0, max: REPEAT_LIMITS.lines }, t("rep_lines_2")] } },
      { seg: "repeatWhen" },
    ] }, quiet: true, showWhen: "repeatOn" },
    ...(kind === "custom" ? [{ f: "timerOnly", label: t("pill_timer_only") }] : []),   // `label` : what the "More options" summary says when it is set
  ];
}
/** Les champs de la répétition pour un formulaire de commande. `intent` : la personne vient de « Ajouter un timer » (l'interrupteur est déjà allumé). */
export function repeatFields(ctx, view, kind, intent = false) {
  const t = ctx.t, r = view.repeat ?? null;
  return [
    { name: "repeatOn", label: t("rep_on"), kind: "switch", value: (r ? r.enabled : intent) ? "on" : "", help: t("rep_on_help") },
    { name: "repeatEvery", label: t("rep_every"), kind: "duration", min: 60, max: REPEAT_LIMITS.minutes * 60, value: (r?.minutes ?? 15) * 60, example: t("rep_every_example") },
    { name: "repeatLines", label: t("rep_lines_title"), kind: "number", value: r?.lines ?? 5, min: 0, max: REPEAT_LIMITS.lines },
    { name: "repeatWhen", label: t("rep_when"), kind: "select", value: r?.when ?? "live", options: REPEAT_WHEN.map((w) => ({ value: w, label: t(`tm_when_${w}`) })) },
    ...(kind === "custom" ? [timerOnlyField(ctx, view.timerOnly === true)] : []),
  ];
}

/**
 * "Started by": the timer and the chat | the timer only. Two choices are a segmented control (R19), never a switch that reads like a verb (R17). The stored
 * field is still `timerOnly`: "on" means the timer only, "off" the timer and the chat (the action reads `values.timerOnly === "on"`, as it always did).
 * No `help` here: the core cannot show a different line for each choice, so the page script writes it (see `timerOnlyHelp` and `stateHelp` in adminkit.client.js).
 */
export function timerOnlyField(ctx, timerOnly, extra = {}) {
  const t = ctx.t;
  return { name: "timerOnly", label: t("f_timer_only"), kind: "segmented", value: timerOnly ? "on" : "off", options: [{ value: "off", label: t("f_timer_only_both") }, { value: "on", label: t("f_timer_only_timer") }], ...extra };
}

/**
 * The configuration of the line under the "Started by" choice, for the page script: it follows the choice, the command name and the repeat interval, so it never says
 * something false. `on` : the "Repeat automatically" switch (absent on the new-timer form, where a repeat is always set). Texts: one per choice and per case, the
 * script uses the one that fits (72 characters in both choices): with the name when it is short enough, without it otherwise; with the interval when there is a usable one.
 */
export function timerOnlyHelp(ctx, prefix, { on = "repeatOn" } = {}) {
  const t = ctx.t, texts = {};
  for (const kind of ["timer", "both"]) for (const c of ["named_every", "every", "named", "plain"]) texts[`${kind}_${c}`] = t(`th_${kind}_${c}`);
  return { field: "timerOnly", on, nameField: "name", everyField: "repeatEvery", prefix, first: t("th_first"), everyMin: t("rep_every_m"), everyHour: t("rep_every_h"), texts };
}
