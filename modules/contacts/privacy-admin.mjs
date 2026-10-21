// Contacts — l'écran d'effacement d'une personne (« partout sur le site », avec confirmation en clair) et le bilan module par module.
const v = new URL(import.meta.url).search;
const B = await import(`./book.mjs${v}`);
const P = await import(`./privacy.mjs${v}`);
const U = await import(`./ui.mjs${v}`);
const { nav } = await import(`./nav.mjs${v}`);

export async function erasePage(ctx, id) {
  const t = ctx.t;
  const r = await B.get(ctx, { id });
  const back = `<a class="ct-back" href="${U.esc(`?contact=${encodeURIComponent(id)}`)}">${U.esc(t("privBack"))}</a>`;
  if (!r.ok) return [U.firstBlock(`${nav(ctx, "contacts")}<a class="ct-back" href="?">${U.esc(t("back"))}</a>`), { type: "banner", tone: "warning", text: t("notFound") }];
  const name = r.contact.name;
  const mods = await P.knownModules(ctx);
  const html = `${nav(ctx, r.contact.kind === "org" ? "orgs" : "contacts")}${back}
<h2 class="ct-name">${U.esc(t("privEraseTitle", { name }))}</h2>
<div class="ct-box"><p>${U.esc(t("privEraseExplain", { name }))}</p>
${mods.length ? `<p>${U.esc(t("privEraseModules"))}</p><ul class="ct-list">${mods.map((m) => `<li>${U.esc(m)}</li>`).join("")}</ul>` : `<p class="ct-help">${U.esc(t("privEraseNoModules"))}</p>`}
<p><strong>${U.esc(t("privEraseFinal"))}</strong> ${U.esc(t("privEraseKeep"))}</p></div>`;
  return [U.firstBlock(html), { type: "download", name: "person", label: t("privDownload"), params: { id } },
    { type: "adminForm", action: "erase", title: t("privEraseFormTitle"), submitLabel: t("privEraseButton"), cancelHref: `?contact=${encodeURIComponent(id)}`, fields: [{ name: "id", kind: "hidden", value: id }, { name: "confirm", label: t("privEraseCheck", { name }), kind: "checkbox", value: "" }] }];
}

export async function reportPage(ctx) {
  const t = ctx.t;
  const list = await P.reports(ctx);
  const blocks = [U.firstBlock(`${nav(ctx, "contacts")}<a class="ct-back" href="?">${U.esc(t("back"))}</a><h2 class="ct-name">${U.esc(t("privReportTitle"))}</h2><p class="ct-help">${U.esc(t("privReportHelp"))}</p>`)];
  if (!list.length) { blocks.push({ type: "banner", tone: "info", text: t("privReportNone") }); return blocks; }
  for (const [i, r] of list.slice(0, 5).entries()) {
    const date = new Date(r.at).toLocaleString(ctx.locale || "en", { dateStyle: "long", timeStyle: "short" });
    const lines = (r.modules ?? []).map((m) => `<li>${U.esc(m.text)}</li>`).join("");
    blocks.push(U.htmlBlock(`<div class="ct-box"><h3>${U.esc(t("privReportOne", { date }))}</h3>${lines ? `<ul class="ct-list">${lines}</ul>` : `<p class="ct-help">${U.esc(t("privReportAlone"))}</p>`}</div>`));
    if (i === 0 && (r.modules ?? []).some((m) => !m.ok)) blocks.splice(1, 0, { type: "banner", tone: "warning", text: t("privReportWarn") });
  }
  return blocks;
}

export const actions = {
  erase: async (ctx, v) => {
    const t = ctx.t;
    if (!["on", "1", "true"].includes(String(v.confirm ?? ""))) return { errors: { confirm: t("privEraseCheckError") } };
    const r = await P.erasePerson(ctx, v.id);
    if (!r.ok) return { error: t("notFound") };
    const silent = r.modules.filter((m) => !m.ok).map((m) => m.name);
    return { ok: silent.length ? t("deletedSilent", { modules: silent.join(", ") }) : t("deleted"), redirect: "?view=erased" };
  },
};
