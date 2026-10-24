// La page d'administration : l'éditeur de la vidéo, dans un cadre. Le cadre vient d'une route du module ; le panneau (réservé aux administrateurs) lui donne un accès de courte durée
// dans la partie « # » de l'adresse (elle n'est jamais envoyée au serveur ni gardée dans ses journaux).
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const data = await import(`./data.mjs${v}`);
const { within, timing } = await import(`./sources.mjs${v}`);
const book = await import(`./contacts.mjs${v}`);

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export async function panel(ctx, { query } = {}) {
  const t = ctx.t, blocks = [];
  let token = "";
  try { token = await within(data.mintToken(ctx), timing.authMs, ""); } catch { token = ""; }
  if (!token) return [{ type: "banner", tone: "warning", text: t("admin_error") }];
  const wanted = typeof query?.prep === "string" ? query.prep : "";
  const prep = wanted ? await within(data.readPrep(ctx, wanted), timing.authMs, null) : null;
  if (wanted && !prep) blocks.push({ type: "banner", tone: "warning", text: t("admin_prep_gone") });
  blocks.push({ type: "markdown", text: t("admin_intro") });
  // Sans Contacts, Story marche avec la saisie « pour cette vidéo seulement » ; on propose d'en installer un PAR SERVICE (jamais un module nommé). Le cœur ne montre rien s'il y en a un.
  if (!(await book.hasBook(ctx))) blocks.push({ type: "suggestInstall", service: book.SERVICE, min: 2, reason: t("admin_suggest_reason") });
  const src = `/m/${ctx.instance.key}/studio?lang=${encodeURIComponent(ctx.locale === "en" ? "en" : "fr")}#t=${token}${prep ? `&p=${encodeURIComponent(wanted)}` : ""}`;
  blocks.push({ type: "html", html: `<style>.story-frame{display:block;width:100%;height:calc(100vh - 150px);min-height:820px;border:1px solid rgba(128,128,128,.35);border-radius:12px;background:transparent}@media (max-width:700px){.story-frame{height:calc(100vh - 110px);min-height:700px}}</style><iframe class="story-frame" title="${esc(t("admin_frame_title"))}" src="${esc(src)}" allow=""></iframe>` });
  blocks.push({ type: "links", items: [{ label: t("admin_open_tab"), href: src }] });
  return blocks;
}
