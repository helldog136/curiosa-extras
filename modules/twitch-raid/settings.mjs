// Les réglages de Raid lus par plusieurs fichiers (admin.mjs, add-admin.mjs) : un fichier à part pour qu'ils ne s'importent pas en rond.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { oneLine } = await import(`./pure.mjs${v}`);

/** `channel` : la valeur brute du réglage (l'id d'une instance de Ma Chaîne Twitch, ou un pseudo tapé avant le choix) ; channel.mjs la traduit en pseudo. */
export const settingsOf = (ctx) => ({ channel: oneLine(ctx.setting("channel"), 200) });
