// Statut live Twitch — module de Curiosa. Il PRÉSENTE l'état « en direct » (bannière, lecteur intégré, section d'accueil) ; il ne parle jamais à Twitch.
// L'état vient du service `twitch.live` de la Chaîne Twitch, qui est seule à connaître l'API, les identifiants, le jeton et les caches (voir source.mjs).
// Les fichiers voisins sont importés avec la même « version » que celui-ci (jamais d'ancien fichier resté en mémoire après une mise à jour).
const q = new URL(import.meta.url).search;
const { liveSources, canTellLive, CHANNEL_RE } = await import(new URL(`./source.mjs${q}`, import.meta.url).href);
const { adoptLegacy } = await import(new URL(`./adopt.mjs${q}`, import.meta.url).href);
const { bannerHtml, playersHtml } = await import(new URL(`./view.mjs${q}`, import.meta.url).href);

const playerSrc = (ctx, channel) => `https://player.twitch.tv/?channel=${channel}&parent=${new URL(ctx.api.siteUrl).hostname}&muted=true`;

export default ({
    slots: {
        // Une chaîne en direct : la bannière d'avant, à l'identique. Plusieurs : une ligne par chaîne (nom, titre, jeu, spectateurs, « Regarder »).
        async "layout.banner"(ctx) {
            const live = (await liveSources(ctx)).filter((s) => s.live && CHANNEL_RE.test(s.channel));
            if (!live.length) return null;
            if (live.length === 1) return [{ type: "banner", tone: "success", text: ctx.t("live", { channel: live[0].channel }), href: `https://twitch.tv/${live[0].channel}` }];
            const n = (s) => Number.isFinite(s.status?.viewers) ? s.status.viewers : null;
            return [{ type: "html", html: bannerHtml(live.map((s) => ({ name: s.name, channel: s.channel, title: s.status?.title, game: s.status?.game, viewers: n(s) })), {
                live: ctx.t("liveMany"), watch: ctx.t("watch"), viewers: (c) => ctx.t(c === 1 ? "viewersOne" : "viewersMany", { count: c }),
            }) }];
        },
    },
    sections: {
        // Le lecteur de Twitch affiche, hors ligne, un gros panneau « {chaîne} est hors ligne » : sur l'accueil, il tombe juste sous le prochain
        // stream et fait doublon. Quand Twitch peut dire si une chaîne est en direct, le lecteur n'apparaît donc qu'en direct ; le réglage
        // « Quand l'afficher » = « toujours » rétablit l'ancien comportement (lecteur de la première chaîne s'il n'y a aucun direct). Quand on ne peut PAS le savoir
        // (pas d'identifiants Twitch, Chaîne Twitch absente) ou que Twitch ne répond pas, il n'est pas affiché : mieux vaut pas de lecteur que le panneau blanc « hors ligne ».
        // Plusieurs chaînes en direct : le lecteur de la première (ordre de création), et une pastille par chaîne pour changer.
        async player(ctx) {
            const always = ctx.setting("playerWhen") === "always";
            const known = await liveSources(ctx, { status: false });
            // « Toujours » avec une seule chaîne : aucun appel d'état nécessaire.
            const all = always && known.length <= 1 ? known : await liveSources(ctx);
            const live = all.filter((s) => s.live && CHANNEL_RE.test(s.channel));
            const shown = live.length ? live : always && all.length ? [all[0]] : [];
            if (!shown.length) return null;
            const title = (s) => `Twitch — ${s.channel}`;
            if (shown.length === 1) return [{ type: "embed", title: title(shown[0]), src: playerSrc(ctx, shown[0].channel) }];
            return [{ type: "html", html: playersHtml(shown.map((s) => ({ name: s.name, channel: s.channel, src: playerSrc(ctx, s.channel), title: title(s) })), ctx.instance.key, ctx.t("playerChoice")) }];
        },
    },
    async adminPanel(ctx) {
        const blocks = [];
        // Sans identifiants Twitch, le lecteur ne peut jamais s'afficher (sauf réglage « toujours ») : on le dit en clair.
        if (ctx.setting("playerWhen") !== "always" && (await canTellLive(ctx)) === false) {
            blocks.push({ type: "banner", tone: "warning", text: ctx.t("needCredentials") }, { type: "markdown", text: `[${ctx.t("openTwitch")}](/admin/modules/twitch-channel)` });
        }
        return blocks;
    },
    // Reprise automatique des anciens identifiants Twitch (voir adopt.mjs) : à la mise à jour des données, puis réessayée chaque heure tant qu'il en reste
    // (Chaîne Twitch momentanément indisponible). Une fois tout repris, la tâche ne lit plus rien d'autre que « vide » et s'arrête là.
    migrations: { 2: async (ctx) => { await adoptLegacy(ctx); } },
    tasks: { adopt: { everyMinutes: 60, run: async (ctx) => { await adoptLegacy(ctx); } } },
});
