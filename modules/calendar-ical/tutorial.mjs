// Agenda en ligne — l'aide à la saisie : le tutoriel d'admin « Comment remplir mon agenda Google ? » et le SKILL.md pour une IA. Tout ce qui est dit
// ici est ce que ce module lit (titre, heures, ligne « Jeu : »). Fonctions qui ne touchent ni au réseau ni au stockage.
const V = new URL(import.meta.url).search;
const { isValidTimeZone } = await import(`./ical.mjs${V}`);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const TUTO_CSS = `.cpt{margin:1rem 0}.cpt *{box-sizing:border-box}.cpt summary,.cpt .cpt-dl{display:inline-flex;align-items:center;min-height:2.75rem;padding:.55rem 1rem;border:1px solid color-mix(in srgb,currentColor 35%,transparent);border-radius:.65rem;font-weight:600;cursor:pointer;text-decoration:none;color:inherit}.cpt summary:hover,.cpt .cpt-dl:hover{background:color-mix(in srgb,currentColor 8%,transparent)}.cpt summary:focus-visible,.cpt .cpt-dl:focus-visible{outline:2px solid currentColor;outline-offset:3px}.cpt-body{margin-top:1rem;max-width:60rem;line-height:1.5}.cpt-body h4{margin:1.25rem 0 .4rem;font-size:1.05rem}.cpt-body ol,.cpt-body ul{margin:.25rem 0;padding-left:1.4rem}.cpt-body li{margin:.25rem 0}.cpt-row{padding:.75rem 0;border-top:1px solid color-mix(in srgb,currentColor 18%,transparent)}.cpt-row dt{font-weight:700}.cpt-row dd{margin:.15rem 0 0}.cpt-row .cpt-k{display:block;opacity:.75;font-size:.9rem}.cpt-ex{margin:.5rem 0;padding:.75rem 1rem;border:1px solid color-mix(in srgb,currentColor 25%,transparent);border-radius:.75rem}.cpt-ex dt{font-weight:700}.cpt-ex dd{margin:0 0 .4rem}.cpt-help{margin:.5rem 0 0;opacity:.8;font-size:.9rem}`;

const TUTO_FIELDS = ["Title", "When", "End", "Game", "Desc", "Place", "AllDay", "Repeat", "Cancel"];

/** Le tutoriel « Comment remplir mon agenda Google ? » (repliable) et le bouton de téléchargement du SKILL.md. Tout ce qui est dit ici est ce que le module lit. */
export function tutorialHtml(ctx, tz) {
  const t = (k, v) => esc(ctx.t(k, v));
  const rows = TUTO_FIELDS.map((f) => `<dl class="cpt-row"><dt>${t(`tuto${f}What`)}</dt><dd><span class="cpt-k">${t("tutoColWhere")}</span>${t(`tuto${f}Where`)}</dd><dd><span class="cpt-k">${t("tutoColDoes")}</span>${t(`tuto${f}Does`, { tz })}</dd></dl>`).join("");
  const li = (prefix, n) => Array.from({ length: n }, (_, i) => `<li>${t(`${prefix}${i + 1}`)}</li>`).join("");
  const ex = (title, when, place, desc) => `<dl class="cpt-ex"><dt>${t("tutoExFieldTitle")}</dt><dd>${esc(title)}</dd><dt>${t("tutoExFieldWhen")}</dt><dd>${esc(when)}</dd><dt>${t("tutoExFieldPlace")}</dt><dd>${esc(place)}</dd><dt>${t("tutoExFieldDesc")}</dt><dd>${esc(desc)}</dd></dl>`;
  const href = `/m/${encodeURIComponent(ctx.instance.key)}/skill?lang=${encodeURIComponent(ctx.locale)}`;
  return `<div class="cpt"><style>${TUTO_CSS}</style>` +
    `<details><summary>${t("tutoBtn")}</summary><div class="cpt-body"><p>${t("tutoIntro")}</p>${rows}` +
    `<h4>${t("tutoStepsTitle")}</h4><ol>${li("tutoStep", 5)}</ol>` +
    `<h4>${t("tutoExampleTitle")}</h4>${ex(ctx.t("tutoExTitle"), ctx.t("tutoExWhen"), ctx.t("tutoExPlace"), ctx.t("tutoExDesc"))}<p>${t("tutoExNoGameTitle")}</p>${ex(ctx.t("tutoExTitle"), ctx.t("tutoExWhen"), ctx.t("tutoExPlace"), ctx.t("tutoExNoGameDesc"))}` +
    `<h4>${t("tutoErrTitle")}</h4><ul>${li("tutoErr", 5)}</ul></div></details>` +
    `<p style="margin-top:.75rem"><a class="cpt-dl" href="${esc(href)}" download="SKILL.md">${t("skillBtn")}</a></p><p class="cpt-help">${t("skillHelp")}</p></div>`;
}

const oneLine = (v, max = 80) => String(v ?? "").replace(/[\u0000-\u001f\u007f`<>]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** Le SKILL.md : généré à partir des réglages réels (fuseau, nom du site). Aucun secret : ni l'adresse du calendrier, ni aucune clé. */
export async function skillMarkdown(ctx, zone = "") {
  const tz = isValidTimeZone(zone) ? zone : "UTC";
  let site = "";
  try { site = oneLine((await ctx.api.site(ctx.locale))?.name); } catch { site = ""; }
  const vars = { site: site || "ce site", tz };
  // L'en-tête YAML : chaînes JSON (guillemets doubles, échappées) = YAML valide quel que soit le nom du site.
  return `---\nname: ${ctx.t("skillName")}\ndescription: ${JSON.stringify(oneLine(ctx.t("skillDesc", vars), 400))}\n---\n\n${ctx.t("skillBody", vars)}\n`;
}

