const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins
const { periodError } = await import(`./period.mjs${v}`);
// Les erreurs d'enregistrement d'une commande ou d'un timer, en phrases (avec un exemple). Partagé par l'administration, la gestion depuis le chat et les outils des assistants.
/** Le morceau fautif d'un texte (`name`) en phrase : chaque morceau à argument a son exemple. */
const ARG_KEYS = { heure: "err_arg_heure", date: "err_arg_date", aleatoire: "err_arg_aleatoire", calcul: "err_arg_calcul", urlfetch: "err_arg_urlfetch" };

/** Une erreur de `saveCommand` / `saveTimer` en phrase, avec quoi faire. */
export function saveError(ctx, r) {
  const t = ctx.t;
  switch (r.code) {
    case "name": return t("err_name", { value: r.value ?? "" });
    case "alias": return t("err_alias", { value: r.value ?? "" });
    case "aliases_many": return t("err_aliases_many");
    case "collision": return t("err_collision", { word: r.word, with: r.with });
    case "text_unknown": return t("err_text_unknown", { vars: (r.vars ?? []).map((v) => `{${v}}`).join(", "), allowed: (r.allowed ?? []).map((v) => `{${v}}`).join(" ") });
    case "text_arg": return t(ARG_KEYS[r.name] ?? "err_text_unknown", { vars: `{${r.name}}`, allowed: "" });
    case "text_deep": return t("err_text_deep");
    case "text_empty": return t("err_text_empty");
    case "text_long": return t("err_text_long");
    case "text_start": return t("err_text_start");
    case "delay": return t("err_delay");
    case "role": return t("err_role");
    case "too_many": return t("err_too_many");
    case "source_missing": return t("err_source_missing");
    case "period": return periodError(ctx, r);
    case "words_empty": return t("err_words_empty");
    case "words_many": return t("err_words_many");
    case "word_bad": return t("err_word_bad", { value: r.value ?? "" });
    case "word_taken": return t("err_word_taken", { word: r.word, with: r.with });
    case "reply_or_media": return t("err_reply_or_media");
    case "chance": return t("err_chance");
    case "too_many_words": return t("err_too_many_words");
    case "media_absent": return t("err_media_absent");
    case "media_missing": return t("err_media_missing");
    case "media_seconds": return t("err_media_seconds");
    case "media_limit": return t("err_media_limit");
    case "timer_name": return t("err_timer_name");
    case "timer_dup": return t("err_timer_dup");
    case "timer_minutes": return t("err_timer_minutes");
    case "timer_lines": return t("err_timer_lines");
    case "timer_when": return t("err_timer_when");
    case "timer_only": return t("err_timer_only");
    case "repeat_kind": return t("err_repeat_kind");
    case "timer_many": return t("err_timer_many", { max: 20 });
    default: return t("err_unknown");
  }
}
