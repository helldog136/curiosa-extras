// Twitch bot: a few chat commands and a timer (invented texts, no real site).
export default async function (h) {
  for (const [name, text] of [["discord", "Join the community: discord.example.org"], ["schedule", "The next streams are on the schedule page of the site."], ["lurk", "Enjoy your lurk, thanks for being here."], ["socials", "Find all my links on the site."]])
    await h.act("twitch-bot", "create", { name, text, role: "everyone", period: "" }).catch((e) => console.log("  create", name, String(e.message).slice(0, 100)));
  await h.act("twitch-bot", "timerNew", { name: "follow", text: "Enjoying the stream? Follow to know when the next one starts.", repeatEvery: 900 }).catch((e) => console.log("  timerNew", String(e.message).slice(0, 100)));
}
