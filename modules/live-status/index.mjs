// Twitch live status — module de Curiosa.
let token = null;
let liveCache = null;
async function isLive(channel, clientId, secret) {
    if (liveCache && liveCache.channel === channel && Date.now() - liveCache.at < 60_000)
        return liveCache.live;
    try {
        if (!token || token.expires < Date.now()) {
            const res = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(secret)}&grant_type=client_credentials`, { method: "POST", signal: AbortSignal.timeout(5000) });
            const json = (await res.json());
            if (!json.access_token)
                return false;
            token = { value: json.access_token, expires: Date.now() + (json.expires_in ?? 3600) * 1000 - 60_000 };
        }
        const res = await fetch(`https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(channel)}`, {
            headers: { "Client-Id": clientId, Authorization: `Bearer ${token.value}` },
            signal: AbortSignal.timeout(5000),
        });
        const json = (await res.json());
        const live = (json.data?.length ?? 0) > 0;
        liveCache = { channel, live, at: Date.now() };
        return live;
    }
    catch {
        return false;
    }
}
const CHANNEL_RE = /^[a-zA-Z0-9_]{3,25}$/;
export default ({
    slots: {
        async "layout.banner"(ctx) {
            const channel = ctx.setting("channel") ?? "";
            const clientId = ctx.setting("clientId");
            const secret = ctx.setting("clientSecret");
            if (!CHANNEL_RE.test(channel) || !clientId || !secret)
                return null;
            if (!(await isLive(channel, clientId, secret)))
                return null;
            return [{ type: "banner", tone: "success", text: ctx.t("live", { channel }), href: `https://twitch.tv/${channel}` }];
        },
    },
    sections: {
        player(ctx) {
            const channel = ctx.setting("channel") ?? "";
            if (!CHANNEL_RE.test(channel))
                return null;
            const parent = new URL(ctx.api.siteUrl).hostname;
            return [
                {
                    type: "embed",
                    title: `Twitch — ${channel}`,
                    src: `https://player.twitch.tv/?channel=${channel}&parent=${parent}&muted=true`,
                },
            ];
        },
    },
});
