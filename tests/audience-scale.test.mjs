import test from "node:test";
import assert from "node:assert/strict";
import { audienceCtx, bind, def, K, L, R, req, tok } from "./helpers/audienceHarness.mjs";

const BASE = "https://x.test/m/audience";

test("150 participants en même temps par les pages publiques : 150 pseudos tous différents, une seule voix chacun, aucune perte, aucun doublon", async () => {
  const c = audienceCtx(); const s = bind(c);
  const people = Array.from({ length: 150 }, (_, i) => i + 1);
  const t0 = Date.now();
  const named = await Promise.all(people.map((i) => def.routes.pseudo(req(`${BASE}/pseudo`, { room: "general", t: tok(i), name: i <= 40 ? "Meme Nom" : `Perso ${String(i).padStart(3, "0")}` }, { ip: `10.5.${i}.1` }), c)));
  const statuses = named.map((r) => r.status);
  assert.equal(statuses.filter((x) => x === 200).length, 111, "40 personnes veulent le même pseudo : une seule l'obtient");
  assert.equal(statuses.filter((x) => x === 409).length, 39);
  const room = await K.getRoom(c, "general");
  assert.equal(room.count, 150, "150 personnes inscrites, ni plus ni moins");
  const pseudos = (await c.api.store.list(`p-${room.id}-0`, { limit: 1000 })).filter((r) => !r.data.n && r.data.pseudo).map((r) => r.data.pseudo);
  assert.equal(new Set(pseudos.map((p) => L.fold(p))).size, pseudos.length, "aucun pseudo en double");
  const claims = await Promise.all(people.flatMap((i) => [s.claim({ room: "general", token: tok(i), key: "poll-a" }), s.claim({ room: "general", token: tok(i), key: "poll-a" })]));
  assert.equal(claims.filter((x) => x.ok).length, 150); assert.equal(claims.filter((x) => x.error === "already").length, 150);
  assert.equal((await K.getRoom(c, "general")).claims, 150);
  assert.ok(Date.now() - t0 < 15_000, "reste rapide");
  // la télécommande voit les dernières personnes sans tout charger
  const state = await R.roomsView(c);
  assert.ok(state[0].recent.length <= 12 && state[0].count === 150);
});

test("500 personnes dans une salle : lecture par pages, jamais tout d'un coup ; chaque appel de lecture reste borné", async () => {
  const c = audienceCtx(); const s = bind(c);
  for (let i = 1; i <= 500; i++) await s.join({ room: "polls", token: tok(i), conn: { forwarded: `10.6.${i}.1` } });
  const room = await K.getRoom(c, "polls");
  let page = await K.participantsPage(c, room, null, 50), seen = page.items.length, pages = 1;
  assert.equal(page.items.length, 50);
  while (page.next) { page = await K.participantsPage(c, room, page.next, 50); seen += page.items.length; pages++; }
  assert.equal(seen, 500); assert.equal(pages, 10);
  const reads0 = c.api.store.writes.length;
  await R.roomsView(c, Date.now() + 10_000);
  assert.equal(c.api.store.writes.length, reads0, "l'état de la télécommande ne fait que lire");
});

test("mémoire : des milliers de connexions différentes ne font pas grossir la table des limites sans fin ; le sel du jour la remet à zéro", async () => {
  const c = audienceCtx();
  for (let i = 0; i < 6500; i++) await def.routes.me(req(`${BASE}/me`, { room: "general", t: tok(1) }, { ip: `11.${i >> 8}.${i & 255}.1` }), c);
  assert.ok(K.mem.hits.size <= 5000, `${K.mem.hits.size}`);
  const before = K.mem.saltAt; K.fp({ forwarded: "1.1.1.1" }, before + 25 * 3_600_000);
  assert.equal(K.mem.hits.size, 0, "nouveau jour, nouveau sel, plus rien n'est relié à la veille");
  assert.notEqual(K.mem.saltAt, before);
});

test("100 lecteurs du direct en même temps : une seule lecture du stockage utile par canal et aucune écriture", async () => {
  const c = audienceCtx(); const s = bind(c);
  await s.livePublish({ room: "r", channel: "now", data: { n: 1 }, public: true });
  const w = c.api.store.writes.length;
  const reads = await Promise.all(Array.from({ length: 100 }, (_, i) => def.routes.direct(req(`${BASE}/direct?room=r&channel=now`, undefined, { ip: `10.7.${i}.1` }), c).then((r) => r.json())));
  assert.ok(reads.every((x) => x.data?.n === 1));
  assert.equal(c.api.store.writes.length, w, "aucune écriture");
  assert.ok(Math.max(...reads.map((x) => x.next)) <= 30_000);
});

test("un stockage qui échoue ne casse jamais le service : réponse d'erreur propre, jamais d'exception ni de détail interne", async () => {
  const c = audienceCtx(); const s = bind(c);
  await s.join({ room: "polls", token: tok(1) });
  const real = c.api.store.add; c.api.store.add = async () => { throw new Error("SQLITE_BUSY: /home/secret/path.db"); };
  const log = console.error; const lines = []; console.error = (...a) => lines.push(a.join(" "));
  try {
    const r = await s.join({ room: "polls", token: tok(2) });
    assert.deepEqual(r, { ok: false, error: "busy" });
    const http = await def.routes.pseudo(req(`${BASE}/pseudo`, { room: "general", t: tok(3), name: "Panne Totale" }), c).catch((e) => e);
    if (http instanceof Response) assert.ok(!(await http.text()).includes("SQLITE"));
  } finally { console.error = log; c.api.store.add = real; }
  assert.ok(lines.every((l) => !l.includes(tok(2))), "le code n'est jamais journalisé");
  assert.equal((await s.join({ room: "polls", token: tok(2) })).ok, true, "tout repart quand le stockage revient");
});
