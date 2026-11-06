// Content notebook: invented ideas.
export default async function (h) {
  for (const t of ["A cozy let's play series", "Behind the scenes: my stream setup", "Q and A with the community", "Tutorial: first overlay in OBS", "Highlights of the month"]) await h.act("content-planner", "quickAdd", { quickTitle: t }).catch((e) => console.log("  quickAdd", String(e.message).slice(0, 100)));
}
