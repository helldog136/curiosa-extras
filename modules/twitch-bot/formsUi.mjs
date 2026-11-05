// Les morceaux de formulaire partagés par les commandes ET les timers : le choix « qui peut l'utiliser » et les champs de « Répéter automatiquement ». Le formulaire s'ouvre dans une
// FENÊTRE au-dessus de la page (`presentation: "dialog"`, cœur 0.6.7) : c'est un formulaire du cœur, avec ses seuls contrôles (champs nommés, erreurs sous le champ, « Plus d'options »
// pour les champs rares). Aucun script de la page n'y touche.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { ROLES, REPEAT_LIMITS, REPEAT_WHEN } = await import(`./commands.mjs${v}`);

export const roleOptions = (t) => ROLES.map((r) => ({ value: r, label: t(`role_${r}`) }));

/* ───────────── « Répéter automatiquement » : le timer d'une commande ───────────── */

/**
 * Les champs de la répétition pour un formulaire de commande (tous rangés sous « Plus d'options » : `folded`). `intent` : la personne vient de « Ajouter un timer »
 * (l'interrupteur est déjà allumé).
 */
export function repeatFields(ctx, view, kind, intent = false) {
  const t = ctx.t, r = view.repeat ?? null;
  // Sans répétition, les champs restent VIDES : « Plus d'options » ne s'ouvre d'office que s'il y a déjà quelque chose de réglé (le cœur regarde les valeurs).
  return [
    { name: "repeatOn", label: t("rep_on"), kind: "switch", value: (r ? r.enabled : intent) ? "on" : "", help: t("rep_on_help"), folded: true },
    { name: "repeatEvery", label: t("rep_every"), kind: "duration", min: 60, max: REPEAT_LIMITS.minutes * 60, value: r ? r.minutes * 60 : "", help: t("rep_every_help"), example: t("rep_every_example"), folded: true },
    { name: "repeatLines", label: t("rep_lines_title"), kind: "number", value: r ? r.lines : "", placeholder: "5", min: 0, max: REPEAT_LIMITS.lines, step: 1, unit: t("unit_messages"), help: t("rep_lines_help"), folded: true },
    { name: "repeatWhen", label: t("rep_when"), kind: "segmented", value: r ? r.when : "", options: REPEAT_WHEN.map((w) => ({ value: w, label: t(`tm_when_${w}`) })), help: t("rep_when_help"), folded: true },
    ...(kind === "custom" ? [timerOnlyField(ctx, view.timerOnly === true, { folded: true })] : []),
  ];
}

/**
 * "Started by": the timer and the chat | the timer only. Two choices are a segmented control (R19), never a switch that reads like a verb (R17). The stored
 * field is still `timerOnly`: "on" means the timer only, "off" the timer and the chat (the action reads `values.timerOnly === "on"`, as it always did).
 */
export function timerOnlyField(ctx, timerOnly, extra = {}) {
  const t = ctx.t;
  return { name: "timerOnly", label: t("f_timer_only"), kind: "segmented", value: timerOnly ? "on" : "off", options: [{ value: "off", label: t("f_timer_only_both") }, { value: "on", label: t("f_timer_only_timer") }], ...extra };
}
