// Statut du live — module de Curiosa. Il PRÉSENTE l'état « en direct » (bannière, lecteur intégré, section d'accueil) ; il ne parle jamais à Twitch ni à YouTube.
// Twitch : le service FACULTATIF `twitch.live` de Ma Chaîne Twitch, qui le demande au Connecteur Twitch (seul à connaître l'application et les jetons) ; voir source.mjs.
// YouTube : le service FACULTATIF `youtube.live` (méthode `current`) de Chaîne YouTube, interrogé avec parcimonie (2 unités de limite par vérification) ; voir youtube.mjs.
// Un site Twitch seul se comporte exactement comme avant : sans Chaîne YouTube, aucun appel de plus, aucune ligne de plus.
// Les fichiers voisins sont importés avec la même « version » que celui-ci (jamais d'ancien fichier resté en mémoire après une mise à jour).
const q = new URL(import.meta.url).search;
const { liveSources, setupGap, CHANNEL_RE } = await import(new URL(`./source.mjs${q}`, import.meta.url).href);
const { adoptLegacy } = await import(new URL(`./adopt.mjs${q}`, import.meta.url).href);
const { bannerHtml, playersHtml, youtubeClickHtml } = await import(new URL(`./view.mjs${q}`, import.meta.url).href);
const { youtubeLives, watchUrl, embedUrl } = await import(new URL(`./youtube.mjs${q}`, import.meta.url).href);

const playerSrc = (ctx, channel) => `https://player.twitch.tv/?channel=${channel}&parent=${new URL(ctx.api.siteUrl).hostname}&muted=true`;

// Le lecteur Twitch d'avant, inchangé (voir ci-dessous pour ses règles).
async function twitchPlayer(ctx) {
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
}

export default ({
    slots: {
        // Une chaîne Twitch en direct et rien d'autre : la bannière d'avant, à l'identique. Plusieurs : une ligne par chaîne (nom, titre, jeu, spectateurs, « Regarder »).
        // YouTube en direct (seul ou avec Twitch) : « En direct sur YouTube » avec son lien, ou une ligne par plateforme quand il y en a plusieurs.
        async "layout.banner"(ctx) {
            const [all, yt] = await Promise.all([liveSources(ctx), youtubeLives(ctx)]);
            const live = all.filter((s) => s.live && CHANNEL_RE.test(s.channel));
            const n = (s) => Number.isFinite(s.status?.viewers) ? s.status.viewers : null;
            const labels = () => ({ live: ctx.t("liveMany"), watch: ctx.t("watch"), viewers: (c) => ctx.t(c === 1 ? "viewersOne" : "viewersMany", { count: c }) });
            if (!yt.lives.length) {
                if (!live.length) return null;
                if (live.length === 1) return [{ type: "banner", tone: "success", text: ctx.t("live", { channel: live[0].channel }), href: `https://twitch.tv/${live[0].channel}` }];
                return [{ type: "html", html: bannerHtml(live.map((s) => ({ name: s.name, channel: s.channel, title: s.status?.title, game: s.status?.game, viewers: n(s) })), labels()) }];
            }
            if (!live.length && yt.lives.length === 1) return [{ type: "banner", tone: "success", text: ctx.t("liveYoutube"), href: watchUrl(yt.lives[0].videoId) }];
            const rows = [
                ...live.map((s) => ({ platform: "Twitch", name: s.name, channel: s.channel, title: s.status?.title, game: s.status?.game, viewers: n(s) })),
                ...yt.lives.map((l) => ({ platform: "YouTube", name: l.name, title: l.title, href: watchUrl(l.videoId) })),
            ];
            return [{ type: "html", html: bannerHtml(rows, labels()) }];
        },
    },
    sections: {
        // Le lecteur de Twitch affiche, hors ligne, un gros panneau « {chaîne} est hors ligne » : sur l'accueil, il tombe juste sous le prochain
        // stream et fait doublon. Quand Twitch peut dire si une chaîne est en direct, le lecteur n'apparaît donc qu'en direct ; le réglage
        // « Quand l'afficher » = « toujours » rétablit l'ancien comportement (lecteur de la première chaîne s'il n'y a aucun direct). Quand on ne peut PAS le savoir
        // (pas d'identifiants Twitch, Chaîne Twitch absente) ou que Twitch ne répond pas, il n'est pas affiché : mieux vaut pas de lecteur que le panneau blanc « hors ligne ».
        // Plusieurs chaînes en direct : le lecteur de la première (ordre de création), et une pastille par chaîne pour changer.
        async player(ctx) {
            const yt = await youtubeLives(ctx);
            // Pas de YouTube en direct : exactement le lecteur d'avant.
            if (!yt.lives.length) return twitchPlayer(ctx);
            // YouTube en direct : si Twitch ne l'est pas, c'est le lecteur YouTube ; si les deux le sont, un seul lecteur, celui que la propriétaire a choisi (Twitch par défaut) ; l'autre reste un lien dans la bannière.
            const onTwitch = (await liveSources(ctx)).some((s) => s.live && CHANNEL_RE.test(s.channel));
            if (onTwitch && ctx.setting("playerPlatform") !== "youtube") return twitchPlayer(ctx);
            const v = yt.lives[0];
            const title = `YouTube — ${v.name}`;
            if (ctx.setting("youtubeLoad") === "auto") return [{ type: "embed", title, src: embedUrl(v.videoId) }];
            return [{ type: "html", html: youtubeClickHtml({ src: embedUrl(v.videoId, { autoplay: true }), title }, ctx.instance.key, { start: ctx.t("ytStart"), note: ctx.t("ytNote") }) }];
        },
    },
    async adminPanel(ctx) {
        const blocks = [];
        // Sans application Twitch (Connecteur Twitch) ou sans chaîne (Ma Chaîne Twitch), le lecteur ne peut jamais s'afficher (sauf réglage « toujours ») :
        // on le dit en clair, avec le lien vers l'endroit où cela se règle.
        const twitchGap = await setupGap(ctx);   // null : Ma Chaîne Twitch n'est pas installée
        const gap = ctx.setting("playerWhen") !== "always" ? twitchGap : null;
        if (gap === "app") blocks.push({ type: "banner", tone: "warning", text: ctx.t("needCredentials") }, { type: "markdown", text: `[${ctx.t("openConnector")}](/admin/modules/twitch-connector)` });
        else if (gap === "channel") blocks.push({ type: "banner", tone: "warning", text: ctx.t("needChannel") }, { type: "markdown", text: `[${ctx.t("openTwitch")}](/admin/modules/twitch-channel)` });
        // YouTube : la réponse est celle que les visiteurs voient (gardée quelques minutes) ; ouvrir cette page ne coûte donc presque rien.
        const yt = await youtubeLives(ctx);
        // Une source « absente » = aucun fournisseur du tout (un fournisseur présent mais muet ou en panne n'est pas absent).
        const hasProvider = async (service) => { try { const l = typeof ctx.api.services?.providers === "function" ? await ctx.api.services.providers(service) : []; return Array.isArray(l) && l.length > 0; } catch { return false; } };
        if (twitchGap === null && yt.state === "none" && !(await hasProvider("twitch.live")) && !(await hasProvider("youtube.live"))) {
            blocks.push({ type: "banner", tone: "info", text: ctx.t("needSource") },
                { type: "suggestInstall", service: "twitch.live", reason: ctx.t("suggestTwitch") },
                { type: "suggestInstall", service: "youtube.live", reason: ctx.t("suggestYoutube") });
        } else if (yt.state === "unknown") {
            const g = yt.gap;
            const [text, link, label] = g === "channel" ? ["ytNeedChannel", "youtube-channel", "openYoutube"]
                : ["config", "auth", "unavailable"].includes(g) ? ["ytNeedKey", "youtube-connector", "openYoutubeConnector"]
                : ["quota", "rate"].includes(g) ? ["ytQuota"] : ["ytDown"];
            blocks.push({ type: "banner", tone: "warning", text: ctx.t(text) });
            if (link) blocks.push({ type: "markdown", text: `[${ctx.t(label)}](/admin/modules/${link})` });
        }
        return blocks;
    },
    // Reprise automatique des anciens identifiants Twitch (voir adopt.mjs) : à la mise à jour des données, puis réessayée chaque heure tant qu'il en reste
    // (Chaîne Twitch momentanément indisponible). Une fois tout repris, la tâche ne lit plus rien d'autre que « vide » et s'arrête là.
    migrations: { 2: async (ctx) => { await adoptLegacy(ctx); } },
    tasks: { adopt: { everyMinutes: 60, run: async (ctx) => { await adoptLegacy(ctx); } } },
});
