// Contacts — les cinq sections de l'administration (onglets en pastilles, une seule rangée qui passe à la ligne sur téléphone).
const v = new URL(import.meta.url).search;
const U = await import(`./ui.mjs${v}`);

export function nav(ctx, current) {
  return U.tabs([
    { label: ctx.t("tabContacts"), href: "?", current: current === "contacts" },
    { label: ctx.t("tabOrgs"), href: "?kind=org", current: current === "orgs" },
    { label: ctx.t("tabCategories"), href: "?view=categories", current: current === "categories" },
    { label: ctx.t("tabDupes"), href: "?view=dupes", current: current === "dupes" },
    { label: ctx.t("tabImport"), href: "?view=import", current: current === "import" },
  ], ctx.t("tabsLabel"));
}
