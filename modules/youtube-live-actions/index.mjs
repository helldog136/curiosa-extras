// Actions du live YouTube — module de Curiosa : un Super Chat, un Super Sticker ou une adhésion sur votre direct YouTube déclenche une action chez vous (lumières, message à voix haute),
// par le module Home Assistant. Lit le chat du direct SEULEMENT pendant qu'une page du module est ouverte ; aucun processus de fond.
// Ce que fait ce module : les règles, la lecture du chat, « !stop » / « !start », la simulation, le journal. Ce qui appartient aux autres reste chez eux :
// la clé YouTube, la limite du jour et la lecture du chat (Connecteur YouTube) ; la chaîne et son direct (Chaîne YouTube) ; la maison, la modération du texte lu et le coupe-circuit (Home Assistant).
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const admin = await import(`./admin.mjs${v}`);
const { default: tools } = await import(`./tools.mjs${v}`);

export default {
  adminPanel: admin.panel,
  adminActions: admin.actions,
  mcp: tools,
};
