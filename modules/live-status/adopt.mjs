// Reprise automatique des identifiants Twitch que ce module gardait dans ses anciens réglages (`legacySettings`, jamais affichés) : ils sont copiés UNE fois dans la Chaîne
// Twitch par le service `twitch.live` (méthode `adopt`), puis effacés d'ici. Un module n'écrit jamais dans les réglages d'un autre : la copie passe par le service, qui ne
// remplit que ses champs vides (une valeur déjà présente n'est jamais écrasée). Les valeurs ne transitent qu'en mémoire : jamais affichées, journalisées ni renvoyées.
// Appelée par la migration des données (version 2) ; rejouée par la tâche `adopt` tant qu'il reste quelque chose (Chaîne Twitch momentanément indisponible).
// Même « version » que ce fichier (voir index.mjs) : un `import … from "./source.mjs"` sans elle garderait l'ANCIEN source.mjs en mémoire après une mise à jour.
const { SERVICE, CHANNEL_RE } = await import(new URL(`./source.mjs${new URL(import.meta.url).search}`, import.meta.url).href);

export const FIELDS = ["channel", "clientId", "clientSecret"];
const text = (v) => (typeof v === "string" ? v.trim() : "");

/**
 * Reprend ce qui reste des anciens réglages. Ne lève jamais. Renvoie { status, adopted } :
 *   none        rien à reprendre (ou cœur sans `ctx.legacy`) ;
 *   unavailable la Chaîne Twitch n'a pas répondu : rien n'est effacé, on réessaiera ;
 *   done        reprise confirmée : les champs repris (ou déjà présents dans la Chaîne Twitch) sont effacés d'ici ;
 *   partial     certains champs ne sont pas encore dans la Chaîne Twitch : ils restent ici, inutilisés, jusqu'au prochain essai.
 * `adopted` : les noms de champs copiés cette fois (jamais une valeur).
 */
export async function adoptLegacy(ctx) {
  try {
    const legacy = ctx.legacy;
    if (!legacy) return { status: "none", adopted: [] };
    const declared = new Set(legacy.keys());
    const present = {};
    for (const f of FIELDS) if (declared.has(f)) present[f] = text(await legacy.get(f));
    // Une chaîne illisible ne peut rien servir : elle est effacée sans être reprise.
    const incoming = { channel: CHANNEL_RE.test(present.channel ?? "") ? present.channel : "", clientId: present.clientId ?? "", clientSecret: present.clientSecret ?? "" };
    const junk = present.channel && !incoming.channel;
    if (!Object.values(incoming).some(Boolean)) {
      if (junk) await legacy.clear("channel");
      return { status: "none", adopted: [] };
    }
    const r = await ctx.api.services.call(SERVICE, "adopt", incoming);
    if (!r.ok) return { status: "unavailable", adopted: [] };
    const adopted = Array.isArray(r.value?.adopted) ? r.value.adopted.filter((f) => FIELDS.includes(f)) : [];
    // Confirmation : un champ n'est effacé d'ici que s'il est maintenant dans la Chaîne Twitch (copié à l'instant, ou déjà là).
    const info = await ctx.api.services.call(SERVICE, "channel", {});
    if (!info.ok || !info.value || typeof info.value !== "object") return { status: "partial", adopted };
    const stillMissing = new Set(Array.isArray(info.value.missing) ? info.value.missing : FIELDS);
    let left = false;
    for (const f of FIELDS) {
      if (!incoming[f]) continue;
      if (adopted.includes(f) || !stillMissing.has(f)) await legacy.clear(f); else left = true;
    }
    if (junk) await legacy.clear("channel");
    return { status: left ? "partial" : "done", adopted };
  } catch { return { status: "unavailable", adopted: [] }; }
}
