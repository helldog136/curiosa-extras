// Live situations for the control dock, built on the REAL modules (Polls + Audience wired together): invented names only.
import { world, pollsMod, pollsDef, tok } from "./audienceWorld.mjs";
import { def as audDef, K as AK } from "./audienceHarness.mjs";
import { moduleAdminTheme } from "@/core/adminTheme";

const L = await import("../../modules/polls/lib.mjs");
const D = await import("../../modules/audience/draw.mjs");

const NAMES = ["etoile_nord", "lune_douce", "Camille", "brume_claire", "sapin_bleu", "Noisette", "vent_leger", "Alix", "mousse_verte", "Lou", "pluie_fine", "cerise_rouge", "aube_rose", "Marin"];
export const LONG = "Which of these absolutely wonderful and extremely long-titled games should we play for the whole evening together tonight, everyone?";
export const LONG_FR = "Auquel de ces jeux absolument merveilleux et au titre extrêmement long devrions-nous jouer toute la soirée tous ensemble ce soir, tout le monde ?";
const CHOICES8 = ["Moss", "Celeste", "Hades", "Hollow Knight", "Tunic", "Inscryption", "A Short Hike", "Dave the Diver"];
const FORM = { title: "Sticker pack", keyword: "!stickers", level: "all", site: true, minutes: null, winners: 1 };

/** A world (polls + audience) with the real administration theme, then the scene applied. */
export async function scene(name, { locale = "en" } = {}) {
  const w = world({ locale });
  w.aud.api.adminTheme = (o) => moduleAdminTheme(o);
  const fr = locale === "fr";
  const now = Date.now();
  const q = fr ? LONG_FR : LONG;
  const vote = async (slug, counts) => { let i = 1; for (const [id, n] of Object.entries(counts)) for (let k = 0; k < n; k++) await pollsMod.castVote(w.polls, { slug, token: tok(i++), ids: [id] }); };
  const regular = async (question, choices, counts = {}) => {
    const v = L.validatePollForm({ question, choices: choices.join("\n"), max: 1 }, { tz: "Europe/Paris" });
    const r = await pollsMod.createPoll(w.polls, v.value, "Europe/Paris", now, { quick: true });
    const f = await w.polls.api.store.get(r.id); await w.polls.api.store.update(r.id, { ...f.data, endsAt: new Date(now + 90_000).toISOString() });
    await vote(r.slug, counts); return r;
  };
  const people = async (n, room = "polls") => { for (let i = 0; i < n; i++) await audDef.services["audience.session"].join(w.aud, { room, token: tok(100 + i), pseudo: NAMES[i % NAMES.length] + (i >= NAMES.length ? i : "") }); };
  const draw = async (entrants, over = {}) => { await D.openNew(w.aud, { ...FORM, ...over }, { now }); for (const n of NAMES.slice(0, entrants)) await audDef.services["audience.draw"].enter(w.aud, { pseudo: n, platform: "twitch", login: n.toLowerCase() }); };
  const finish = async (slug) => { const p = (await w.polls.api.store.list("polls")).find((x) => x.data.slug === slug); await pollsDef.mcp.poll_close(w.polls, { id: p.id }); };
  switch (name) {
    case "poll-idle": break;
    case "poll-idle-again": { const r = await regular("A or B", ["Cats", "Dogs"], { c1: 2 }); await finish(r.slug); await w.polls.api.store.update((await w.polls.api.store.list("polls"))[0].id, { ...(await w.polls.api.store.list("polls"))[0].data, closedAt: new Date(now - 2 * 3_600_000).toISOString() }); break; }
    case "poll-run2": await regular(fr ? "Chats ou chiens" : "Cats or dogs", fr ? ["Chats", "Chiens"] : ["Cats", "Dogs"], { c1: 9, c2: 5 }); break;
    case "poll-run3": await regular(fr ? "Quel jeu" : "Which game", CHOICES8.slice(0, 3), { c1: 4, c2: 9, c3: 2 }); break;
    case "poll-run4": await regular(fr ? "Quel jeu" : "Which game", CHOICES8.slice(0, 4), { c1: 4, c2: 9, c3: 2, c4: 1 }); break;
    case "poll-run8": await regular(q, CHOICES8, { c1: 3, c2: 9, c3: 2, c4: 6, c5: 1, c6: 4, c7: 2, c8: 8 }); break;
    case "poll-long2": await regular(q, CHOICES8.slice(0, 2).map((x) => `${x} ${x} ${x} ${x} ${x}`), { c1: 14, c2: 3 }); break;
    case "poll-done2": { const r = await regular(fr ? "Chats ou chiens" : "Cats or dogs", fr ? ["Chats", "Chiens"] : ["Cats", "Dogs"], { c1: 9, c2: 5 }); await finish(r.slug); break; }
    case "poll-done8": { const r = await regular(q, CHOICES8, { c1: 3, c2: 9, c3: 2, c4: 6, c5: 1, c6: 4, c7: 2, c8: 8 }); await finish(r.slug); break; }
    case "poll-round": { await pollsMod.startSeries(w.polls, now); const cur = (await w.polls.api.store.list("polls")).find((x) => x.data.round); await vote(cur.data.slug, { c1: 3, c2: 7, c3: 1 }); break; }
    case "draw-idle": break;
    case "draw-idle-prev": { await draw(3); await D.close(w.aud, { now }); await D.clear(w.aud, { now }); await D.openNew(w.aud, FORM, { now }); await D.close(w.aud, { now }); break; }
    case "draw-open": await draw(12); break;
    case "draw-open-timed": await draw(12, { minutes: 10 }); break;
    case "draw-drawn1": await draw(6); await D.pick(w.aud, { now }); break;
    case "draw-drawn5": await draw(14, { winners: 5 }); await D.pick(w.aud, { now }); break;
    case "draw-closed": await draw(6); await D.close(w.aud, { now }); break;
    case "chat": await people(14); await people(3, "polls2"); break;
    case "chat-empty": break;
    default: throw new Error(`unknown scene ${name}`);
  }
  return w;
}
export const SCENES = ["poll-idle", "poll-run2", "poll-run3", "poll-run4", "poll-run8", "poll-long2", "poll-done2", "poll-done8", "poll-round", "draw-idle", "draw-idle-prev", "draw-open", "draw-open-timed", "draw-drawn1", "draw-drawn5", "draw-closed", "chat", "chat-empty"];
