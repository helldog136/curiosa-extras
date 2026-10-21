// Contacts — les phrases d'une ligne d'import en erreur : la raison et un exemple, dans la langue de la personne (textes `impE_<code>` des locales).
/** `e` : une entrée du journal { line, code, value?, network?, a?, b?, width? }. */
export function describeError(ctx, e) {
  const code = String(e?.code ?? "unknown");
  const vars = { line: e?.line ?? "?", value: e?.value ?? "", a: e?.a ?? "", b: e?.b ?? "", width: e?.width ?? "", max: 100000 };
  if (code === "account_handle") return ctx.t("impE_account_handle", { ...vars, hint: e?.network ? ctx.t(`errHandle_${e.network}`) : "" });
  const text = ctx.t(`impE_${code}`, vars);
  return text === `impE_${code}` ? ctx.t("impE_unknown", vars) : text;
}
export const ERROR_CODES = ["name", "kind", "status", "email", "account_network", "account_handle", "too_many_accounts", "too_many_categories", "too_many_notes", "note_long", "photo", "columns", "accounts_two", "account_elsewhere", "email_kind", "email_elsewhere", "too_many", "category_denied", "category_limit", "vanished"];
