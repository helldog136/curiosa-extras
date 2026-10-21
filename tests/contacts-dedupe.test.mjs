// Contacts (lot K2) — doublons et fusion : ce que le détecteur repère (et ce qu'il laisse tranquille), les pages, « ce ne sont pas des doublons », l'aperçu de la
// réunion qui annonce exactement ce que fera `merge`, l'écran (comparer, choisir, valider ou annuler), le `remap` vers les autres modules, la panne d'un module muet.
import test from "node:test";
import assert from "node:assert/strict";
import { fakePrivacySubject } from "./helpers/fakeContactBook.mjs";
import { memStore } from "./helpers/contactsStore.mjs";
import { makeCtx, def, B, D, DD, svc, htmlOf, textOf } from "./helpers/contactsK2.mjs";

const pairs = async (ctx) => (await DD.groups(ctx, { fresh: true })).groups.map((g) => ({ ids: g.ids, reasons: g.reasons }));
const person = (ctx, a) => svc.create(ctx, a).then((r) => r.id);

test("détecteur : même nom + même organisation, prénom et nom inversés, une lettre de différence — et rien pour deux personnes qui n'ont que le même prénom ou des organisations différentes", async () => {
  const ctx = makeCtx();
  const exact1 = await person(ctx, { name: "Marie Dupont", organisation: "Acme" });
  const exact2 = await svc.upsertByAccount(ctx, { network: "twitch", handle: "marie_alt", name: "marie  DUPONT", source: "test-suite" });
  await B.update(ctx, { id: exact2.id, organisation: "ACME" });
  const swapped1 = await person(ctx, { name: "Luc Martin", organisation: "Globex" });
  const swapped2 = await person(ctx, { name: "Martin Luc", organisation: "Globex" });
  const typo1 = await person(ctx, { name: "Hélène Bernard", organisation: "Initech" });
  const typo2 = await person(ctx, { name: "Helene Bernart", organisation: "Initech" });
  await person(ctx, { name: "Paul Durand", organisation: "Acme" });
  await person(ctx, { name: "Paul Durand", organisation: "Globex" }); // même nom, autre organisation : pas un doublon
  await person(ctx, { name: "Sam Lee", organisation: "Acme" });
  await person(ctx, { name: "Sam Lop", organisation: "Acme" }); // trop différents
  await person(ctx, { name: "Player 12", organisation: "Acme" });
  await person(ctx, { name: "Player 13", organisation: "Acme" }); // ne diffèrent que par un chiffre
  const sameNameNoOrg1 = await person(ctx, { name: "Solo Name" });
  const sameNameNoOrg2 = await person(ctx, { name: "solo name", email: "solo@example.test" });
  const g = await pairs(ctx);
  const find = (a, b) => g.find((x) => x.ids.includes(a) && x.ids.includes(b));
  assert.deepEqual(find(exact1, exact2.id)?.reasons, ["name_org"]);
  assert.deepEqual(find(swapped1, swapped2)?.reasons, ["name_close"]);
  assert.deepEqual(find(typo1, typo2)?.reasons, ["name_close"]);
  assert.deepEqual(find(sameNameNoOrg1, sameNameNoOrg2)?.reasons, ["name"], "même nom sans organisation : signalé, mais comme le plus incertain");
  assert.equal(g.length, 4, JSON.stringify(g));
  assert.deepEqual(g.map((x) => x.reasons[0]), ["name_org", "name_close", "name_close", "name"], "les plus sûrs d'abord");
  // Une organisation en double.
  const o1 = await svc.create(ctx, { name: "Studio Lune", kind: "org" });
  await ctx.api.store.add("orgs", { kind: "org", name: "STUDIO LUNE", status: "active", source: "t", role: "", email: "", phone: "", others: "", relation: "", orgId: null, categoryIds: [], accounts: [], photo: null });
  D.forgetIndex(ctx);
  const withOrg = await pairs(ctx);
  assert.ok(withOrg.some((x) => x.ids.includes(o1.id) && x.reasons[0] === "name_org"), "deux organisations de même nom");
});

test("détecteur : même e-mail ou même compte (données anciennes qui ne respectent plus la règle « un seul propriétaire ») sont repérés en premier", async () => {
  const ctx = makeCtx();
  const base = { kind: "person", status: "active", source: "t", role: "", phone: "", others: "", relation: "", orgId: null, categoryIds: [], photo: null };
  const add = (name, extra) => ctx.api.store.add("contacts", { ...base, name, email: "", accounts: [], ...extra }, { key: extra?.email ? `e:${extra.email}` : undefined });
  const a = await add("Anna Un", { email: "same@example.test" });
  const b = await add("Anne Deux", { email: "same@example.test" });
  const c = await add("Carl Un", { accounts: [{ id: "a1", network: "twitch", handle: "shared_one", url: null }] });
  const d = await add("Carla Deux", { accounts: [{ id: "a2", network: "twitch", handle: "shared_one", url: null }] });
  const g = await pairs(ctx);
  assert.deepEqual(g.map((x) => [x.reasons[0], x.ids.sort().join()]), [["account", [c, d].sort().join()], ["email", [a, b].sort().join()]]);
  // Le même compte écrit autrement ne crée jamais de doublon par le service.
  const e = await svc.upsertByAccount(ctx, { network: "twitch", handle: "TWITCH.tv/Fresh_One", source: "test-suite" });
  const f = await svc.upsertByAccount(ctx, { network: "twitch", handle: "fresh_one", source: "test-suite" });
  assert.equal(e.id, f.id);
});

test("pages de 20 groupes : on parcourt tout sans doublon ni trou ; 5 000 groupes au plus gardés ; le résultat est en cache puis jeté dès que le carnet change", async () => {
  const ctx = makeCtx();
  const base = { kind: "person", status: "active", source: "t", role: "", email: "", phone: "", others: "", relation: "", categoryIds: [], accounts: [], photo: null };
  for (let i = 0; i < 45; i++) {
    const org = (await svc.create(ctx, { name: `Org ${i}`, kind: "org" })).id;
    await ctx.api.store.add("contacts", { ...base, name: `Prénom${String.fromCharCode(97 + (i % 26))}${i} Nom`, orgId: org });
    await ctx.api.store.add("contacts", { ...base, name: `PRÉNOM${String.fromCharCode(97 + (i % 26))}${i} nom`, orgId: org });
  }
  D.forgetIndex(ctx);
  const seen = [];
  let at;
  let guard = 0;
  do { const p = await DD.page(ctx, at); assert.ok(p.items.length <= DD.GROUP_PAGE); assert.equal(p.total, 45); seen.push(...p.items.map((g) => g.ids.join("|"))); at = p.next; } while (at && ++guard < 10);
  assert.equal(seen.length, 45);
  assert.equal(new Set(seen).size, 45);
  assert.equal(DD.MAX_GROUPS, 5000);
  // Cache : la deuxième lecture ne relit pas le carnet ; une écriture jette le cache.
  const first = await DD.groups(ctx);
  assert.equal((await DD.groups(ctx)).groups, first.groups, "même résultat en cache");
  const zed = (await svc.create(ctx, { name: "Zed", kind: "org" })).id;
  await ctx.api.store.add("contacts", { ...base, name: "Nouveau Doublon", orgId: zed });
  await ctx.api.store.add("contacts", { ...base, name: "Nouveau Doublon", orgId: zed });
  D.forgetIndex(ctx);
  assert.equal((await DD.groups(ctx)).total, 46, "le carnet a changé : recalculé");
  const html = htmlOf(await def.adminPanel(ctx, { query: { view: "dupes" } }));
  assert.equal([...html.matchAll(/class="ct-card"/g)].length, 20);
  assert.match(html, /46 groups to look at/);
  const page2 = htmlOf(await def.adminPanel(ctx, { query: { view: "dupes", at: "20" } }));
  assert.equal([...page2.matchAll(/class="ct-card"/g)].length, 20);
  assert.match(html, /href="\?view=dupes&amp;at=20">See more</);
});

test("« ce ne sont pas des doublons » : la paire est mémorisée et ne revient plus, même après réécriture ; plafond de 20 000 paires", async () => {
  const ctx = makeCtx();
  const a = await person(ctx, { name: "Jean Dupont", organisation: "Acme" });
  const b = await person(ctx, { name: "Jean Dupond", organisation: "Acme" });
  assert.equal((await DD.groups(ctx)).total, 1);
  assert.equal((await def.adminActions.dupIgnore(ctx, { a: b, b: a })).ok, "Noted: these two cards will not be suggested again.");
  assert.equal((await DD.groups(ctx)).total, 0);
  await def.adminActions.dupIgnore(ctx, { a, b }); // idempotent
  assert.equal(await ctx.api.store.count("notdup"), 1);
  await B.update(ctx, { id: a, role: "Chef" });
  assert.equal((await DD.groups(ctx, { fresh: true })).total, 0);
  assert.equal(DD.MAX_NOTDUP, 20_000);
  assert.deepEqual(await DD.ignorePair(ctx, a, a), { ok: false, error: "invalid" });
});

test("aperçu = résultat : ce que l'écran annonce est exactement ce que fait la réunion (comptes repris et refusés, catégories, notes, champs vides, organisation, statut)", async () => {
  const ctx = makeCtx({ locale: "en" });
  const cat1 = (await B.createCategory(ctx, { label: "A" }, { allowed: true })).id;
  const cat2 = (await B.createCategory(ctx, { label: "B" }, { allowed: true })).id;
  const keep = await person(ctx, { name: "Keep Me", role: "Boss" });
  const drop = await svc.create(ctx, { name: "Drop Me", email: "drop@example.test", phone: "123", organisation: "Acme", role: "Ignored role", relation: "Friend" });
  for (let i = 0; i < 19; i++) await B.addAccount(ctx, { id: keep, network: "twitch", handle: `keep_acc_${String(i).padStart(2, "0")}` });
  for (const h of ["drop_one", "drop_two", "drop_three"]) await B.addAccount(ctx, { id: drop.id, network: "twitch", handle: h });
  await B.setCategories(ctx, keep, [cat1]);
  await B.setCategories(ctx, drop.id, [cat1, cat2]);
  await svc.note(ctx, { id: drop.id, text: "n1", author: "admin" });
  await svc.note(ctx, { id: drop.id, text: "n2", author: "admin" });
  const p = await DD.preview(ctx, keep, drop.id);
  assert.equal(p.ok, true);
  assert.deepEqual(p.plan.filled.sort(), ["email", "phone", "relation"], "le rôle de la fiche gardée n'est pas écrasé");
  assert.equal(p.plan.accounts.length, 1, "20 comptes au plus : un seul peut passer");
  assert.deepEqual(p.plan.skippedAccounts.map((s) => s.why), ["full", "full"]);
  assert.deepEqual(p.plan.categories, [cat2]);
  assert.equal(p.plan.org, true);
  assert.equal(p.notes, 2);
  const r = await B.merge(ctx, { keep, drop: drop.id });
  assert.equal(r.ok, true);
  const after = (await svc.get(ctx, { id: keep })).contact;
  assert.equal(after.role, "Boss");
  assert.deepEqual([after.email, after.phone, after.orgName], ["drop@example.test", "123", "Acme"]);
  assert.equal(after.accounts.length, 20);
  assert.deepEqual(after.accounts.slice(19).map((a) => a.handle), [p.plan.accounts[0].handle]);
  assert.equal(after.categoryIds.length, 2);
  assert.equal(after.notes.length, 2);
  assert.equal(r.notes, 2);
  assert.deepEqual((await svc.get(ctx, { id: drop.id })).movedTo, keep);
  // Le texte de l'aperçu le dit en mots simples.
  const ctx2 = makeCtx({ locale: "fr" });
  const k2 = await person(ctx2, { name: "Gardée" });
  const d2 = await svc.create(ctx2, { name: "Réunie", email: "r@example.test" });
  await B.addAccount(ctx2, { id: d2.id, network: "youtube", handle: "@reunie" });
  const page = textOf(await def.adminPanel(ctx2, { query: { view: "merge", keep: k2, drop: d2.id } }));
  assert.match(page, /Comptes repris : YouTube · @reunie\./);
  assert.match(page, /Champs vides complétés : e-mail\./);
  assert.match(page, /Pas de notes à reprendre\./);
  assert.match(page, /Les autres modules \(Partenariats, Raid, Story…\) sont prévenus/);
  assert.match(page, /Tant que vous ne validez pas, rien ne change : vous pouvez annuler\./);
});

test("écran : comparer deux fiches, choisir celle qu'on garde, voir ce qui sera repris, ANNULER sans rien changer, puis valider — les autres modules reçoivent le remap", async () => {
  const sub = fakePrivacySubject("raid-like");
  const ctx = makeCtx({ locale: "fr", subjects: [sub] });
  const a = await svc.create(ctx, { name: "Marie Dupont", organisation: "Acme", email: "marie@example.test" });
  const b = await svc.create(ctx, { name: "Marie Dupond", organisation: "Acme" });
  await B.addAccount(ctx, { id: b.id, network: "twitch", handle: "marie_live" });
  sub.refs.set(b.id, 1);
  const list = htmlOf(await def.adminPanel(ctx, { query: { view: "dupes" } }));
  assert.match(list, /1 groupe à regarder/);
  assert.match(list, /Nom presque identique, même organisation/);
  const cmp = await def.adminPanel(ctx, { query: { view: "merge", a: a.id, b: b.id } });
  assert.match(htmlOf(cmp), /Est-ce la même personne \?/);
  assert.equal(cmp.filter((x) => x.action === "mergePick").length, 2);
  assert.deepEqual(cmp.filter((x) => x.action === "mergePick").map((x) => x.submitLabel), ["Garder « Marie Dupont »", "Garder « Marie Dupond »"]);
  assert.ok(cmp.some((x) => x.action === "dupIgnore"));
  assert.match(htmlOf(cmp), /marie@example\.test/, "avec le droit, l'e-mail est visible pour comparer");
  // Choisir : on arrive sur la page de confirmation, rien n'a changé.
  const pick = await def.adminActions.mergePick(ctx, { keep: b.id, drop: a.id });
  assert.match(pick.redirect, new RegExp(`^\\?view=merge&keep=${b.id}&drop=${a.id}$`));
  const confirm = await def.adminPanel(ctx, { query: { view: "merge", keep: b.id, drop: a.id } });
  const form = confirm.find((x) => x.action === "mergeDo");
  assert.deepEqual([form.submitLabel, form.cancelHref], ["Valider la réunion", `?view=merge&a=${b.id}&b=${a.id}`], "annuler ramène à la comparaison");
  assert.equal((await svc.get(ctx, { id: a.id })).ok, true, "tant qu'on n'a pas validé, les deux fiches existent");
  assert.equal((await svc.get(ctx, { id: b.id })).ok, true);
  assert.deepEqual([...sub.refs.keys()], [b.id], "aucun remap avant la validation");
  // Valider.
  const done = await def.adminActions.mergeDo(ctx, { keep: b.id, drop: a.id });
  assert.equal(done.ok, "Fiches réunies. Les autres modules ont été prévenus.");
  assert.equal(done.redirect, `?contact=${encodeURIComponent(b.id)}`);
  const kept = (await svc.get(ctx, { id: b.id })).contact;
  assert.equal(kept.name, "Marie Dupond");
  assert.equal(kept.email, "marie@example.test");
  assert.deepEqual((await svc.get(ctx, { id: a.id })).movedTo, b.id);
  assert.equal((await B.list(ctx, {})).items.filter((c) => c.kind === "person").length, 1);
  assert.equal((await DD.groups(ctx)).total, 0);
  // Les pages qui visaient l'ancienne fiche expliquent où elle est passée.
  const old = await def.adminPanel(ctx, { query: { contact: a.id } });
  assert.match(textOf(old), /réunie avec une autre/);
});

test("remap : chaque module qui garde une référence est prévenu (de la fiche abandonnée vers la gardée) ; un module muet ou absent est listé, sans bloquer la fusion", async () => {
  const good = fakePrivacySubject("good-one");
  const mute = { instance: "mute-one", name: "Module muet", methods: { remap: () => new Promise(() => {}), erase: () => new Promise(() => {}), export: () => new Promise(() => {}) } };
  const ctx = makeCtx({ locale: "fr", subjects: [good, mute], test: { privacyTimeoutMs: 60 } });
  const a = await person(ctx, { name: "Anna Keep" });
  const b = await person(ctx, { name: "Anne Drop" });
  good.refs.set(b, 3);
  const t = Date.now();
  const r = await def.adminActions.mergeDo(ctx, { keep: a, drop: b });
  assert.ok(Date.now() - t < 1500, "borné par module");
  assert.match(r.ok, /Fiches réunies\. N'a pas répondu à temps : Module muet \(il se corrigera à sa prochaine ouverture\)\./);
  assert.equal(good.refs.get(a), 3, "la référence a suivi");
  assert.equal(good.refs.has(b), false);
  const svcRes = await svc.merge(ctx, { keep: a, drop: await person(ctx, { name: "Third" }) });
  assert.deepEqual(svcRes.remapped.map((x) => x.module).sort(), ["good-one", "mute-one"], "la réponse du service liste chaque module");
  assert.deepEqual(svcRes.remapped.map((x) => x.ok).sort(), [false, true]);
});

test("erreurs : une personne et une organisation ne se réunissent pas ; une fiche déjà disparue est expliquée ; les deux fiches identiques sont refusées", async () => {
  const ctx = makeCtx({ locale: "fr" });
  const p = await person(ctx, { name: "Pat" });
  const o = await svc.create(ctx, { name: "Pat", kind: "org" });
  const cmp = await def.adminPanel(ctx, { query: { view: "merge", a: p, b: o.id } });
  assert.ok(!cmp.some((x) => x.action === "mergePick"));
  assert.match(textOf(cmp), /Une personne et une organisation ne peuvent pas être réunies\./);
  assert.equal((await def.adminActions.mergeDo(ctx, { keep: p, drop: o.id })).error, "Une personne et une organisation ne peuvent pas être réunies.");
  assert.match(textOf(await def.adminPanel(ctx, { query: { view: "merge", a: p, b: "inconnue" } })), /L'une des deux fiches n'existe plus/);
  assert.match(textOf(await def.adminPanel(ctx, { query: { view: "merge", a: p, b: p } })), /L'une des deux fiches n'existe plus/);
  assert.equal((await def.adminActions.mergeDo(ctx, { keep: p, drop: p })).error, "L'une des deux fiches n'existe plus. Retournez à la liste des doublons.");
  assert.match(htmlOf(await def.adminPanel(makeCtx({ locale: "fr" }), { query: { view: "dupes" } })), /Aucun doublon repéré\. Le carnet est propre\./);
});

test("droits : sans « voir les e-mails et téléphones », la comparaison ne montre ni e-mail ni téléphone", async () => {
  const full = makeCtx({ locale: "en" });
  const a = await svc.create(full, { name: "Zed One", email: "zed@example.test", phone: "+1 555 0100", organisation: "Acme" });
  const b = await svc.create(full, { name: "Zed One", organisation: "Acme" });
  const limited = makeCtx({ locale: "en", store: full.api.store, rights: [] });
  limited.instance = full.instance;
  const page = textOf(await def.adminPanel(limited, { query: { view: "merge", a: a.id, b: b.id } }));
  assert.ok(!page.includes("zed@example.test") && !page.includes("555 0100"));
  void D;
});

test("volumes : 2 000, 10 000 fiches — le détecteur reste rapide, ne garde que les groupes, et trouve les doublons plantés", { timeout: 120_000 }, async () => {
  for (const n of [2000, 10_000]) {
    const store = memStore();
    const ctx = makeCtx({ store });
    const org = await ctx.api.store.add("orgs", { kind: "org", name: "Big Org", status: "active", source: "t", role: "", email: "", phone: "", others: "", relation: "", orgId: null, categoryIds: [], accounts: [], photo: null });
    const mk = (name, i) => ({ data: { kind: "person", name, status: "active", source: "t", role: "", email: `p${i}@example.test`, phone: "", others: "", relation: "", orgId: i % 3 === 0 ? org : null, categoryIds: [], accounts: [{ id: `a${i}`, network: "twitch", handle: `user_${String(i).padStart(6, "0")}`, url: null }], photo: null }, key: `e:p${i}@example.test` });
    const rows = Array.from({ length: n }, (_, i) => mk(`Zq${i.toString(36)}x Wv${(i * 7).toString(36)}`, i));
    rows.push(mk("Planted Twin", n), mk("planted  twin", n + 1));
    rows[n].data.orgId = rows[n + 1].data.orgId = org;
    for (let i = 0; i < rows.length; i += 4000) await store.addMany("contacts", rows.slice(i, i + 4000));
    D.forgetIndex(ctx);
    const t = Date.now();
    const g = await DD.groups(ctx, { fresh: true });
    const ms = Date.now() - t;
    assert.ok(ms < 8000, `${n} fiches : ${ms} ms`);
    assert.ok(g.groups.some((x) => x.reasons.includes("name_org") && x.size === 2), "le doublon planté est trouvé");
    assert.ok(g.groups.length < 50, `${g.groups.length} groupes (aucun faux positif de masse)`);
  }
});
