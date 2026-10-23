// SUITE DE CONTRAT du service « audience.session » v1 de Participation (texte : tests/contract-ext/audience.md). Elle tourne contre N'IMPORTE QUEL fournisseur.
//   runAudienceContract(makeProvider, { prefix })
// makeProvider() → {
//   session:   { …méthodes de audience.session, appelées SANS droit (comme un autre module) },
//   moderator: { …les mêmes, appelées avec le droit de modérer (comme depuis une action d'administration avec { asCaller: true }) },
//   direct?:   ({ room, channel, rev?, key? }) → ce que lirait un navigateur sur la route publique du direct,
//   dump?:     () → tout ce que le fournisseur a gardé, en texte (pour vérifier qu'aucun code ni adresse n'y est),
// }
import nodeTest from "node:test";
import assert from "node:assert/strict";

export const SESSION_METHODS = ["info", "join", "who", "setPseudo", "checkPseudo", "claim", "release", "limit", "mute", "clearRoom", "forget", "journal", "livePublish", "liveRead", "liveDrop", "directClient"];
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

let seq = 0;
const tok = (i = 0) => `tk${String(i).padStart(5, "0")}${"x".repeat(18)}`;
const roomName = () => `room-${++seq}`;

export function runAudienceContract(makeProvider, { test = nodeTest, prefix = "audience.session v1" } = {}) {
  const t = (name, fn) => test(`${prefix} : ${name}`, async () => fn(await makeProvider()));

  t("les méthodes existent et répondent { ok } sans jamais lever, même pour des arguments absurdes", async (p) => {
    for (const m of SESSION_METHODS) assert.equal(typeof p.session[m], "function", m);
    for (const m of SESSION_METHODS) for (const bad of [undefined, null, 5, "x", [], {}, { room: {} }, { room: "ok", token: 5 }, { token: "x".repeat(5000) }]) {
      const r = await p.session[m](bad);
      assert.ok(isObj(r) && typeof r.ok === "boolean", `${m}(${JSON.stringify(bad)?.slice(0, 40)})`);
      if (!r.ok) assert.equal(typeof r.error, "string", m);
    }
  });

  t("info : version 1, bornes annoncées", async (p) => {
    const r = await p.session.info({});
    assert.equal(r.ok, true); assert.equal(r.version, 1);
    assert.equal(typeof r.base, "string");
    for (const k of ["pseudoMin", "pseudoMax", "participants", "rooms", "liveBytes"]) assert.ok(Number.isInteger(r.limits[k]) && r.limits[k] > 0, k);
  });

  t("join : une personne = un identifiant par salle (stable, jamais le code), deux salles ne se recoupent pas", async (p) => {
    const a = roomName(), b = roomName();
    const first = await p.session.join({ room: a, token: tok(1) });
    assert.equal(first.ok, true);
    assert.equal(first.participant.isNew, true); assert.equal(first.participant.pseudo, null); assert.equal(first.participant.muted, false);
    assert.match(first.participant.id, /^[0-9a-f]{40}$/);
    assert.ok(!JSON.stringify(first).includes(tok(1)), "le code n'est jamais renvoyé");
    const again = await p.session.join({ room: a, token: tok(1) });
    assert.equal(again.participant.isNew, false); assert.equal(again.participant.id, first.participant.id);
    assert.equal(again.room.count, 1);
    const other = await p.session.join({ room: b, token: tok(1) });
    assert.notEqual(other.participant.id, first.participant.id, "deux salles ne se recoupent pas");
    assert.equal((await p.session.join({ room: a, token: tok(2) })).room.count, 2);
    assert.deepEqual((await p.session.join({ room: "Not Valid!", token: tok(1) })).error, "invalid");
    assert.deepEqual((await p.session.join({ room: a, token: "short" })).error, "invalid");
    assert.deepEqual((await p.session.join({ room: a })).error, "invalid");
  });

  t("who : lit sans créer ; salle inconnue = unknown_room", async (p) => {
    const r = roomName();
    assert.deepEqual(await p.session.who({ room: r, token: tok(1) }), { ok: false, error: "unknown_room" });
    await p.session.join({ room: r, token: tok(2) });
    assert.deepEqual(await p.session.who({ room: r, token: tok(1) }), { ok: true, participant: null });
    const me = await p.session.who({ room: r, token: tok(2) });
    assert.equal(me.ok, true); assert.equal(me.participant.pseudo, null);
  });

  t("pseudo : unique par salle (accents, majuscules et chiffres pour lettres ne comptent pas), libéré quand on en change, jamais tronqué", async (p) => {
    const r = roomName(), r2 = roomName();
    for (const i of [1, 2, 3]) await p.session.join({ room: r, token: tok(i) });
    const a = await p.session.setPseudo({ room: r, token: tok(1), pseudo: "  Éloïse   Lune " });
    assert.equal(a.ok, true); assert.equal(a.participant.pseudo, "Éloïse Lune");
    assert.deepEqual(await p.session.setPseudo({ room: r, token: tok(2), pseudo: "eloise lune" }), { ok: false, error: "pseudo_taken" });
    assert.deepEqual(await p.session.setPseudo({ room: r, token: tok(2), pseudo: "ELOISE-LUNE" }), { ok: false, error: "pseudo_taken" });
    assert.equal((await p.session.setPseudo({ room: r, token: tok(1), pseudo: "Éloïse Lune" })).ok, true, "le même pseudo, par la même personne, est accepté");
    assert.equal((await p.session.setPseudo({ room: r, token: tok(1), pseudo: "Autre Nom" })).ok, true);
    assert.equal((await p.session.setPseudo({ room: r, token: tok(2), pseudo: "Eloise Lune" })).ok, true, "le pseudo libéré est repris");
    await p.session.join({ room: r2, token: tok(3) });
    assert.equal((await p.session.setPseudo({ room: r2, token: tok(3), pseudo: "Eloise Lune" })).ok, true, "un autre pseudo dans une autre salle ne gêne pas");
    assert.equal((await p.session.who({ room: r, token: tok(2) })).participant.pseudo, "Eloise Lune");
    assert.deepEqual(await p.session.setPseudo({ room: r, token: tok(9), pseudo: "Nouvelle Personne" }), { ok: false, error: "unknown_participant" });
    assert.equal((await p.session.setPseudo({ room: "nope-room", token: tok(1), pseudo: "Quelqu Un" })).error, "unknown_room");
  });

  t("pseudo : longueur et caractères bornés (courts, longs, balises, caractères de contrôle) ; aucun texte n'est tronqué en silence", async (p) => {
    const r = roomName();
    await p.session.join({ room: r, token: tok(1) });
    const err = async (pseudo) => (await p.session.setPseudo({ room: r, token: tok(1), pseudo })).error;
    assert.equal(await err("a"), "pseudo_short");
    assert.equal(await err("  ab "), "pseudo_short");
    assert.equal(await err("x".repeat(60)), "pseudo_long");
    assert.equal(await err("<b>gras</b>"), "pseudo_chars");
    assert.equal(await err("a.b.c"), "pseudo_chars");
    assert.equal(await err("-tiret"), "pseudo_chars");
    assert.equal(await err("http://x.y"), "pseudo_chars");
    const ctl = await p.session.setPseudo({ room: r, token: tok(1), pseudo: "Bon\u0007Nom" });
    assert.ok(ctl.ok ? ctl.participant.pseudo === "Bon Nom" : typeof ctl.error === "string", "un caractère de contrôle devient une espace ou est refusé");
    const ok = await p.session.setPseudo({ room: r, token: tok(1), pseudo: "Lune-Rousse_42" });
    assert.equal(ok.ok, true); assert.equal(ok.participant.pseudo, "Lune-Rousse_42");
    assert.equal((await p.session.checkPseudo({ pseudo: "a" })).valid, false);
    assert.equal((await p.session.checkPseudo({ pseudo: "a" })).code, "pseudo_short");
    const good = await p.session.checkPseudo({ pseudo: "Joli Nom" });
    assert.deepEqual([good.ok, good.valid, good.value], [true, true, "Joli Nom"]);
    assert.deepEqual(await p.session.checkPseudo({ room: r, pseudo: "lune rousse 42" }), { ok: true, valid: false, code: "pseudo_taken" });
    assert.deepEqual(await p.session.checkPseudo({ pseudo: 12 }), { ok: false, error: "invalid" });
  });

  t("join avec un pseudo : une seule étape ; un pseudo refusé n'empêche pas d'être inscrit", async (p) => {
    const r = roomName();
    const good = await p.session.join({ room: r, token: tok(1), pseudo: "Pixel Chat" });
    assert.equal(good.ok, true); assert.equal(good.participant.pseudo, "Pixel Chat");
    const clash = await p.session.join({ room: r, token: tok(2), pseudo: "pixel chat" });
    assert.deepEqual([clash.ok, clash.error], [false, "pseudo_taken"]);
    assert.equal((await p.session.who({ room: r, token: tok(2) })).participant?.pseudo, null, "inscrit, sans pseudo");
  });

  t("claim : une voix par participant et par clé ; rejouer = already ; release la rend ; deux personnes et deux clés sont indépendantes", async (p) => {
    const r = roomName();
    await p.session.join({ room: r, token: tok(1) }); await p.session.join({ room: r, token: tok(2) });
    assert.deepEqual(await p.session.claim({ room: r, token: tok(1), key: "poll-1" }), { ok: true, first: true });
    assert.deepEqual(await p.session.claim({ room: r, token: tok(1), key: "poll-1" }), { ok: false, error: "already" });
    assert.equal((await p.session.claim({ room: r, token: tok(1), key: "poll-2" })).ok, true);
    assert.equal((await p.session.claim({ room: r, token: tok(2), key: "poll-1" })).ok, true);
    assert.deepEqual(await p.session.release({ room: r, token: tok(1), key: "poll-1" }), { ok: true, released: true });
    assert.deepEqual(await p.session.release({ room: r, token: tok(1), key: "poll-1" }), { ok: true, released: false });
    assert.equal((await p.session.claim({ room: r, token: tok(1), key: "poll-1" })).ok, true);
    assert.equal((await p.session.claim({ room: r, token: tok(7), key: "poll-1" })).error, "unknown_participant");
    assert.equal((await p.session.claim({ room: r, token: tok(1), key: "bad key!" })).error, "invalid");
    assert.equal((await p.session.claim({ room: "no-such-room", token: tok(1), key: "k" })).error, "unknown_room");
  });

  t("limit : max passages par fenêtre, puis « limit » avec retryAfter ; scopes, salles et connexions indépendants", async (p) => {
    const r = roomName();
    const conn = { forwarded: "203.0.113.7" }, other = { forwarded: "203.0.113.8" };
    for (let i = 0; i < 3; i++) { const x = await p.session.limit({ room: r, scope: "vote", conn, max: 3, per: 60 }); assert.equal(x.ok, true); assert.equal(x.remaining, 2 - i); }
    const over = await p.session.limit({ room: r, scope: "vote", conn, max: 3, per: 60 });
    assert.deepEqual([over.ok, over.error], [false, "limit"]); assert.ok(over.retryAfter >= 1 && over.retryAfter <= 60);
    assert.equal((await p.session.limit({ room: r, scope: "other", conn, max: 3, per: 60 })).ok, true, "un autre usage n'est pas touché");
    assert.equal((await p.session.limit({ room: r, scope: "vote", conn: other, max: 3, per: 60 })).ok, true, "une autre connexion non plus");
    assert.equal((await p.session.limit({ room: roomName(), scope: "vote", conn, max: 3, per: 60 })).ok, true, "ni une autre salle");
    // avec un code : la limite compte aussi par personne, même si la connexion change
    for (let i = 0; i < 2; i++) assert.equal((await p.session.limit({ room: r, scope: "per-person", conn: { forwarded: `198.51.100.${i}` }, token: tok(5), max: 2, per: 60 })).ok, true);
    assert.equal((await p.session.limit({ room: r, scope: "per-person", conn: { forwarded: "198.51.100.99" }, token: tok(5), max: 2, per: 60 })).error, "limit");
    for (const bad of [{ max: 0, per: 60 }, { max: 3, per: 0 }, { max: 3.5, per: 60 }, { max: 99999, per: 60 }, { max: 3, per: 999999 }, { scope: "Bad Scope", max: 3, per: 60 }]) assert.equal((await p.session.limit({ room: r, scope: "x", max: 3, per: 60, ...bad })).error, "invalid", JSON.stringify(bad));
  });

  t("sourdine : réservée au droit de modérer ; une personne en sourdine ne peut ni voter ni changer de pseudo ; rétablie, tout revient", async (p) => {
    const r = roomName();
    const me = (await p.session.join({ room: r, token: tok(1), pseudo: "Mute Moi" })).participant;
    await p.session.join({ room: r, token: tok(2) });
    assert.deepEqual(await p.session.mute({ room: r, id: me.id, muted: true }), { ok: false, error: "denied" }, "sans droit");
    assert.equal((await p.session.who({ room: r, token: tok(1) })).participant.muted, false);
    const m = await p.moderator.mute({ room: r, pseudo: "mute  moi", muted: true });
    assert.equal(m.ok, true); assert.equal(m.participant.muted, true);
    assert.equal((await p.session.who({ room: r, token: tok(1) })).participant.muted, true);
    assert.equal((await p.session.claim({ room: r, token: tok(1), key: "k" })).error, "muted");
    assert.equal((await p.session.setPseudo({ room: r, token: tok(1), pseudo: "Nouveau Nom" })).error, "muted");
    assert.equal((await p.session.claim({ room: r, token: tok(2), key: "k" })).ok, true, "les autres ne sont pas touchés");
    assert.equal((await p.moderator.mute({ room: r, id: me.id, muted: false })).ok, true);
    assert.equal((await p.session.claim({ room: r, token: tok(1), key: "k" })).ok, true);
    assert.equal((await p.moderator.mute({ room: r, pseudo: "personne ici", muted: true })).error, "not_found");
    assert.equal((await p.moderator.mute({ room: "no-such-room", id: me.id, muted: true })).error, "unknown_room");
    assert.equal((await p.moderator.mute({ room: r, id: me.id })).error, "invalid");
  });

  t("vider une salle : réservé au droit de modérer ; tout le monde est oublié, les voix aussi, les pseudos sont libres ; les autres salles ne bougent pas", async (p) => {
    const r = roomName(), keep = roomName();
    for (const i of [1, 2, 3]) await p.session.join({ room: r, token: tok(i), pseudo: `Perso ${i}${i}` });
    await p.session.claim({ room: r, token: tok(1), key: "poll-1" });
    await p.session.join({ room: keep, token: tok(1), pseudo: "Perso 11" });
    assert.deepEqual(await p.session.clearRoom({ room: r }), { ok: false, error: "denied" });
    assert.deepEqual(await p.moderator.clearRoom({ room: r }), { ok: true, removed: 3 });
    assert.deepEqual(await p.session.who({ room: r, token: tok(1) }), { ok: true, participant: null });
    const again = await p.session.join({ room: r, token: tok(1), pseudo: "Perso 22" });
    assert.equal(again.ok, true); assert.equal(again.participant.isNew, true); assert.equal(again.room.count, 1);
    assert.equal((await p.session.claim({ room: r, token: tok(1), key: "poll-1" })).ok, true, "la voix est de nouveau possible");
    assert.equal((await p.session.who({ room: keep, token: tok(1) })).participant.pseudo, "Perso 11");
    assert.equal((await p.moderator.clearRoom({ room: "no-such-room" })).error, "unknown_room");
  });

  t("oubli : retire la personne de toutes les salles (pseudo libéré, voix comprises) ; rejouable", async (p) => {
    const a = roomName(), b = roomName();
    await p.session.join({ room: a, token: tok(1), pseudo: "A Oublier" }); await p.session.join({ room: b, token: tok(1) });
    await p.session.join({ room: a, token: tok(2) });
    assert.deepEqual(await p.session.forget({ token: tok(1) }), { ok: true, removed: 2 });
    assert.deepEqual(await p.session.forget({ token: tok(1) }), { ok: true, removed: 0 });
    assert.equal((await p.session.who({ room: a, token: tok(1) })).participant, null);
    assert.equal((await p.session.who({ room: a, token: tok(2) })).participant.id.length, 40, "les autres restent");
    assert.equal((await p.session.setPseudo({ room: a, token: tok(2), pseudo: "A Oublier" })).ok, true, "le pseudo est libre");
    assert.equal((await p.session.forget({ token: "court" })).error, "invalid");
  });

  t("journal : une ligne en mots, refuse le vide", async (p) => {
    assert.deepEqual(await p.session.journal({ what: "round.winner", room: roomName(), detail: "Manche 3 : Hades" }), { ok: true });
    assert.equal((await p.session.journal({ what: "   " })).error, "invalid");
    assert.equal((await p.session.journal({ what: "x", room: "Bad Room" })).error, "invalid");
  });

  t("direct : publier, relire (rev), inchangé, vide, supprimer, trop gros, canal invalide ; un canal privé n'existe que pour qui a la clé", async (p) => {
    const r = roomName();
    const pub = await p.session.livePublish({ room: r, channel: "now", data: { n: 1 }, public: true });
    assert.equal(pub.ok, true); const rev1 = pub.rev;
    assert.equal((await p.session.livePublish({ room: r, channel: "now", data: { n: 1 }, public: true })).rev, rev1, "même état = même révision");
    const rev2 = (await p.session.livePublish({ room: r, channel: "now", data: { n: 2 }, public: true })).rev;
    assert.notEqual(rev2, rev1);
    const read = await p.session.liveRead({ room: r, channel: "now" });
    assert.equal(read.ok, true); assert.equal(read.rev, rev2); assert.deepEqual(read.data, { n: 2 }); assert.ok(!read.due);
    assert.equal((await p.session.liveRead({ room: r, channel: "now", rev: rev2 })).unchanged, true);
    assert.deepEqual(await p.session.liveRead({ room: r, channel: "nothing" }), { ok: true, empty: true });
    assert.equal((await p.session.livePublish({ room: r, channel: "big", data: { text: "x".repeat(40000) } })).error, "too_big");
    assert.equal((await p.session.livePublish({ room: r, channel: "Bad Channel", data: {} })).error, "invalid");
    assert.equal((await p.session.livePublish({ room: r, channel: "ok" })).error, "invalid");
    assert.deepEqual(await p.session.liveDrop({ room: r, channel: "now" }), { ok: true, dropped: true });
    assert.deepEqual(await p.session.liveDrop({ room: r, channel: "now" }), { ok: true, dropped: false });
    assert.equal((await p.session.liveRead({ room: r, channel: "now" })).empty, true);
    if (p.direct) {
      await p.session.livePublish({ room: r, channel: "screen", data: { secret: true }, readKey: "a-long-secret-key" });
      await p.session.livePublish({ room: r, channel: "open", data: { visible: true }, public: true });
      const hidden = async (q) => { const x = await p.direct(q); assert.equal(x.ok, true); assert.equal(x.empty, true); assert.ok(!("data" in x) && !("rev" in x)); };
      await hidden({ room: r, channel: "screen" });   // sans clé : comme si rien n'existait
      await hidden({ room: r, channel: "screen", key: "wrong-secret-key!" });
      await hidden({ room: r, channel: "never-published" });
      const seen = await p.direct({ room: r, channel: "screen", key: "a-long-secret-key" });
      assert.deepEqual(seen.data, { secret: true });
      assert.equal((await p.direct({ room: r, channel: "screen", key: "a-long-secret-key", rev: seen.rev })).unchanged, true);
      assert.deepEqual((await p.direct({ room: r, channel: "open" })).data, { visible: true });
    }
    const c = await p.session.directClient({});
    assert.equal(c.ok, true); assert.equal(typeof c.js, "string"); assert.ok(c.js.length > 50 && c.js.length < 20000);
  });

  t("100 participants en même temps : 100 identifiants, 100 pseudos différents, une seule personne obtient un pseudo demandé par tous, une seule voix par personne", async (p) => {
    const r = roomName();
    const people = Array.from({ length: 100 }, (_, i) => i + 1);
    const joined = await Promise.all(people.map((i) => p.session.join({ room: r, token: tok(i), conn: { forwarded: `10.0.${i}.1` } })));
    assert.ok(joined.every((x) => x.ok), JSON.stringify(joined.find((x) => !x.ok)));
    assert.equal(new Set(joined.map((x) => x.participant.id)).size, 100);
    assert.equal((await p.session.join({ room: r, token: tok(1) })).room.count, 100);
    const named = await Promise.all(people.map((i) => p.session.setPseudo({ room: r, token: tok(i), pseudo: i <= 30 ? "Tous Pareils" : `Perso ${i}` })));
    assert.equal(named.slice(0, 30).filter((x) => x.ok).length, 1, "un seul gagnant pour le pseudo disputé");
    assert.equal(named.slice(0, 30).filter((x) => x.error === "pseudo_taken").length, 29);
    assert.ok(named.slice(30).every((x) => x.ok));
    const votes = await Promise.all(people.flatMap((i) => [p.session.claim({ room: r, token: tok(i), key: "poll-x" }), p.session.claim({ room: r, token: tok(i), key: "poll-x" })]));
    assert.equal(votes.filter((x) => x.ok).length, 100); assert.equal(votes.filter((x) => x.error === "already").length, 100);
    const same = await Promise.all(Array.from({ length: 10 }, () => p.session.claim({ room: r, token: tok(1), key: "poll-y" })));
    assert.equal(same.filter((x) => x.ok).length, 1);
  });

  t("vie privée : ni le code du navigateur ni l'adresse de connexion ne sont gardés en clair", async (p) => {
    const r = roomName();
    const secret = `SecretToken${"Z".repeat(16)}`;
    await p.session.join({ room: r, token: secret, conn: { forwarded: "198.51.100.77", real: "192.0.2.55" }, pseudo: "Anonyme Total" });
    await p.session.claim({ room: r, token: secret, key: "poll-priv" });
    await p.session.limit({ room: r, scope: "vote", conn: { forwarded: "198.51.100.77" }, token: secret, max: 5, per: 60 });
    await p.session.livePublish({ room: r, channel: "now", data: { ok: 1 }, readKey: "k".repeat(24) });
    if (p.dump) {
      const all = await p.dump();
      assert.ok(!all.includes(secret), "le code du navigateur n'est jamais gardé");
      assert.ok(!all.includes("198.51.100.77") && !all.includes("192.0.2.55"), "l'adresse n'est jamais gardée");
      assert.ok(!all.includes("k".repeat(24)), "la clé de lecture n'est jamais gardée en clair");
    }
  });
}
