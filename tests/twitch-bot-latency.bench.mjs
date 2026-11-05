// Latency benchmark of the Twitch bot over a fake Twitch (not a test: run it with
//   CURIOSA_DIR=../core node scripts/test.mjs tests/twitch-bot-latency.bench.mjs ).
// Output: a latency budget (stage -> ms before the reply) for a few situations, and p50/p95 for 1, 10 and 100 messages per second.
// Modelled costs (what an in-memory fake hides): database call 2 ms, service call 3 ms, cross-module topic read 4 ms, round trip to api.twitch.tv 60 ms.
// "Quiet chat" = nothing was heard for a while: every cached reading is older than its freshness window (and the Chaine Twitch module's own 30 s cache is empty).
import { latencyWorld, stageTable, pct, sleep, now } from "./helpers/latencyWorld.mjs";
import { SRC } from "./helpers/botWorld.mjs";

const MODEL = { storeMs: 2, serviceMs: 3, topicMs: 4, helixMs: 60 };
const f = (n) => n.toFixed(0).padStart(5);
const out = [];
const log = (s = "") => out.push(s);
const aged = "ttlMs" in SRC.timing;   // the 1.11.0 sources keep an old reading usable; before, an old reading was simply thrown away

async function budget(label, { model = MODEL, text = "!discord", quiet = false, cold = false } = {}) {
  if (aged) SRC.timing.ttlMs = quiet ? 1 : 15_000;
  const w = await latencyWorld(model);
  if (!cold) await w.say("!discord", "warmup");
  if (quiet) { await sleep(5); if (!aged) w.reset(); w.expireChannel(); }
  w.spans.length = 0;
  const r = await w.say(text, "viewer1");
  log(`\n## ${label}: reply ${f(r.sentAt - r.t0)} ms after receipt, all done ${f(r.doneAt - r.t0)} ms, webhook ack ${f(r.ackAt - r.t0)} ms`);
  for (const row of stageTable(r.spansBefore)) log(`   ${row.stage.padEnd(58)} ${String(row.calls).padStart(3)} calls  ${f(row.ms)} ms`);
  w.close();
}
await budget("cold start (first command after a restart)", { cold: true });
await budget("quiet chat (a command after a minute of silence)", { quiet: true });
await budget("warm (a command right after another)", { quiet: false, text: "!quoi" });
await budget("quiet chat, command that needs the game ({jeu})", { quiet: true, text: "!quoi" });
await budget("quiet chat, a calendar module that answers in 1.2 s", { quiet: true, model: { ...MODEL, slowTopics: { "planning.slot": 1200, "social.link": 1200, "social.stat": 1200 } } });
await budget("quiet chat, Twitch answers in 400 ms", { quiet: true, model: { ...MODEL, helixMs: 400 } });

if (aged) SRC.timing.ttlMs = 15_000;
for (const rate of [1, 10, 100]) {
  const w = await latencyWorld(MODEL);
  await w.say("!discord", "warmup");
  w.reset();
  const total = rate === 1 ? 10 : rate === 10 ? 30 : 100;
  const gap = 1000 / rate;
  const runs = [];
  const lag = { max: 0 }; let last = now();
  const timer = setInterval(() => { const t = now(); lag.max = Math.max(lag.max, t - last - 5); last = t; }, 5);
  const t0 = now();
  for (let i = 0; i < total; i += 1) {
    const wait = t0 + i * gap - now();
    if (wait > 0) await sleep(wait);
    runs.push(w.say(i % 2 ? "!quoi" : "!discord", `viewer_${String(i).padStart(3, "0")}`, { waitDone: false }));
  }
  const rs = await Promise.all(runs);
  const done = await Promise.all(rs.map((x) => x.finish));
  clearInterval(timer);
  const sentLat = done.filter((x) => x.sentAt !== null).map((x) => x.sentAt - x.t0);
  const doneLat = done.map((x) => x.doneAt - x.t0);
  log(`\n## burst ${rate} msg/s (${total} messages, ${w.stamps.chat.length} answered): reply p50 ${f(pct(sentLat, 50))}  p95 ${f(pct(sentLat, 95))}  max ${f(Math.max(0, ...sentLat))} ms; processed p50 ${f(pct(doneLat, 50))}  p95 ${f(pct(doneLat, 95))}  max ${f(Math.max(...doneLat))} ms; event-loop lag max ${lag.max.toFixed(0)} ms; Helix calls ${w.stamps.helix}`);
  w.close();
}
console.log(out.join("\n"));
