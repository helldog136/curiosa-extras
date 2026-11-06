// Community statistics: a few hand-entered numbers (networks that cannot be read automatically).
export default async function (h) {
  for (const [platform, account, metric, value] of [["Instagram", "etoile_nord", "followers", "1240"], ["TikTok", "etoile_nord", "followers", "860"], ["Patreon", "etoile_nord", "paying", "37"]])
    await h.act("community-stats", "saveManual", { platform, otherPlatform: "", account, metric, value }).catch((e) => console.log("  saveManual", String(e.message).slice(0, 100)));
}
