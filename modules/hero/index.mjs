// Home banner — module de Curiosa.
export default ({
    sections: {
        async hero(ctx) {
            const site = await ctx.api.site(ctx.locale);
            // Vidéo : seulement une vidéo envoyée sur ce site, jamais d'adresse externe.
            const video = ctx.setting("video") ?? "";
            const poster = ctx.setting("poster") ?? "";
            const label = (ctx.setting("buttonLabel") ?? "").trim();
            const href = (ctx.setting("buttonUrl") ?? "").trim();
            const button = label && /^(\/(?!\/)|https?:\/\/|mailto:)/.test(href) ? { label, href } : undefined;
            const withVideo = /^\/uploads\/[0-9a-f-]{36}\.(mp4|webm)$/.test(video)
                ? { video, videoSound: ctx.setting("videoSound") === true, ...(/^(https:\/\/|\/uploads\/)/.test(poster) ? { videoPoster: poster } : {}) }
                : {};
            return [
                {
                    type: "hero",
                    title: ctx.setting("title") || site.name,
                    text: ctx.setting("text") || site.tagline || undefined,
                    image: ctx.setting("showLogo") && site.logo ? site.logo : undefined,
                    ...(ctx.setting("eyebrow") ? { eyebrow: ctx.setting("eyebrow") } : {}),
                    ...(button ? { button } : {}),
                    ...withVideo,
                },
            ];
        },
    },
});
