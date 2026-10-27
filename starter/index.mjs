// Module de départ : la plus petite chose complète qui passe toute la suite de conformité du cœur.
// Règles du jeu : aucun import du cœur (tout passe par `ctx`) ; tout texte venu d'ailleurs est échappé avant d'entrer dans du HTML ;
// une section qui n'a rien à montrer renvoie `null` (elle disparaît de l'accueil).

/** Échappe le texte avant de le mettre dans du HTML (le bloc `html` est brut). */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export default {
  sections: {
    // Une section de la page d'accueil : déclarée dans module.json (« sections »), permission « sections ».
    welcome(ctx) {
      const message = String(ctx.setting("message") ?? "").trim() || ctx.t("fallback");
      const signature = String(ctx.setting("signature") ?? "").trim();
      return [{ type: "html", html: `<p>${esc(message)}</p>${signature ? `<p><em>${esc(signature)}</em></p>` : ""}` }];
    },
  },
};
