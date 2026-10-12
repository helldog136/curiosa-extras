// Statut live Twitch — module de Curiosa. Il PRÉSENTE l'état « en direct » (bannière, lecteur intégré, section d'accueil) ; il ne parle jamais à Twitch.
// L'état vient du service `twitch.live` de la Chaîne Twitch, qui est seule à connaître l'API, les identifiants, le jeton et les caches (voir source.mjs).
// Les fichiers voisins sont importés avec la même « version » que celui-ci (jamais d'ancien fichier resté en mémoire après une mise à jour).
const q = new URL(import.meta.url).search;
const { liveSource, canTellLive, CHANNEL_RE } = await import(new URL(`./source.mjs${q}`, import.meta.url).href);
const { adoptPanel, adopt } = await import(new URL(`./adopt.mjs${q}`, import.meta.url).href);

export default ({
    slots: {
        async "layout.banner"(ctx) {
            const s = await liveSource(ctx);
            if (!s.live || !CHANNEL_RE.test(s.channel ?? "")) return null;
            return [{ type: "banner", tone: "success", text: ctx.t("live", { channel: s.channel }), href: `https://twitch.tv/${s.channel}` }];
        },
    },
    sections: {
        // Le lecteur de Twitch affiche, hors ligne, un gros panneau « {chaîne} est hors ligne » : sur l'accueil, il tombe juste sous le prochain
        // stream et fait doublon. Quand Twitch peut dire si la chaîne est en direct, il n'apparaît donc qu'en direct ; le réglage
        // « Quand l'afficher » = « toujours » rétablit l'ancien comportement. Quand on ne peut PAS le savoir (pas d'identifiants Twitch, Chaîne Twitch
        // absente) ou que Twitch ne répond pas, il n'est pas affiché : mieux vaut pas de lecteur que le panneau blanc « hors ligne ».
        async player(ctx) {
            const always = ctx.setting("playerWhen") === "always";
            const s = await liveSource(ctx, { status: !always });
            if (!CHANNEL_RE.test(s.channel ?? "")) return null;
            if (!always && !s.live) return null;
            const parent = new URL(ctx.api.siteUrl).hostname;
            return [{ type: "embed", title: `Twitch — ${s.channel}`, src: `https://player.twitch.tv/?channel=${s.channel}&parent=${parent}&muted=true` }];
        },
    },
    async adminPanel(ctx) {
        const blocks = await adoptPanel(ctx);
        // Sans identifiants Twitch, le lecteur ne peut jamais s'afficher (sauf réglage « toujours ») : on le dit en clair.
        if (ctx.setting("playerWhen") !== "always" && (await canTellLive(ctx)) === false) {
            blocks.push({ type: "banner", tone: "warning", text: ctx.t("needCredentials") }, { type: "markdown", text: `[${ctx.t("openTwitch")}](/admin/modules/twitch-channel)` });
        }
        return blocks;
    },
    adminActions: { adopt },
});
