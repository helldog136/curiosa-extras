// Les morceaux de formulaire partagés par les commandes ET les timers : le choix « qui peut l'utiliser », l'aperçu et les morceaux à insérer sous le texte, la phrase
// « Attendre [ ] s… » et le contrôle de période. Chaque formulaire reste un formulaire du cœur (champs nommés, erreurs sous le champ) ; le script de la page (adminkit.client.js)
// les range d'après la configuration ci-dessous. Sans JavaScript, tous les champs sont là, dans l'ordre.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { ROLES } = await import(`./commands.mjs${v}`);
const { allowedFor } = await import(`./variables.mjs${v}`);
const { preview } = await import(`./engine.mjs${v}`);
const { periodControl } = await import(`./period.mjs${v}`);

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

/** Le contrôle de période : le même pour les commandes et pour les timers. */
export const periodLayout = (ctx, period, timeZone) => ({ period: periodControl(ctx, period, timeZone) });
