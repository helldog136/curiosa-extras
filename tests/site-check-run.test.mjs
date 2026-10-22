// Santé du site — le déroulement : par paquets, à la demande seulement, un seul passage à la fois, reprise, historique, remarques masquées, assistants IA.
import test from "node:test";
import assert from "node:assert/strict";
import { makeSite, entry, def, R, V, S, quick, clock, links, spread, withFakeFetch, netReplies, publicDns } from "./helpers/site-check-kit.mjs";

const siteWithLinks = (n, host = "example.org", extra = {}) => makeSite({ locales: ["fr"], entries: { pages: [entry({ id: "P", title: "Liens", body: host === "*" ? spread(n) : links(n, host), slug: "liens", path: "/pages/liens" })] }, ...extra });
const ok = { status: 200 };

test("un seul clic : le site est lu et les liens sont visités ; tout va bien → historique + rapport complet, aucune vérification restante", async () => {
  const ctx = siteWithLinks(5);
  const c = clock();
  let r;
  await withFakeFetch({ "*": ok }, async () => { r = await R.startCheck(ctx, quick(c)); });
  assert.deepEqual([r.finished, r.done, r.total], [true, 5, 5]);
  const st = await R.readState(ctx);
  assert.equal(st.run, null, "la vérification en cours est effacée");
  assert.equal(st.report.finished, true);
  assert.equal(st.history.length, 1);
  assert.equal(st.history[0].ok, true);
  assert.deepEqual(st.report.groups, [], "rien à signaler");
});

test("pas de rafale : une visite à la fois, au moins 250 ms entre deux, 1 s entre deux visites du même site", async () => {
  const ctx = siteWithLinks(4);
  const c = clock();
  const stamps = [];
  await withFakeFetch({ "*": () => { stamps.push(c.at()); return ok; } }, async () => { await R.startCheck(ctx, quick(c)); });
  assert.equal(stamps.length, 4);
  for (let i = 1; i < stamps.length; i++) assert.ok(stamps[i] - stamps[i - 1] >= R.SAME_HOST_MS, `même site : ${stamps[i] - stamps[i - 1]} ms`);
  const mixed = makeSite({ locales: ["fr"], entries: { pages: [entry({ id: "M", title: "Mixte", body: ["a", "b", "c"].map((h) => `[x](https://${h}.example.org/)`).join(" "), slug: "m", path: "/pages/m" })] } });
  const c2 = clock(); const stamps2 = [];
  await withFakeFetch({ "*": () => { stamps2.push(c2.at()); return ok; } }, async () => { await R.startCheck(mixed, quick(c2)); });
  for (let i = 1; i < stamps2.length; i++) assert.ok(stamps2[i] - stamps2[i - 1] >= R.GAP_MS, `sites différents : ${stamps2[i] - stamps2[i - 1]} ms`);
});

test("les liens vers le même site sont espacés par les autres : jamais deux visites de suite au même site tant qu'un autre attend", async () => {
  const body = ["a", "a", "b", "b", "c", "c"].map((h, i) => `[x](https://${h}.example.org/${i})`).join(" ");
  const ctx = makeSite({ locales: ["fr"], entries: { pages: [entry({ id: "M", title: "Mixte", body, slug: "m", path: "/pages/m" })] } });
  const s = await S.scanSite(ctx);
  const hosts = s.links.map((l) => new URL(l.u).hostname);
  assert.deepEqual(hosts, ["a.example.org", "b.example.org", "c.example.org", "a.example.org", "b.example.org", "c.example.org"]);
});

test("par paquets : un paquet s'arrête à 60 liens ou 20 s, l'avancement est gardé, « continuer » reprend là où on s'était arrêté", async () => {
  const ctx = siteWithLinks(100, "*");
  const c = clock();
  let first, second;
  await withFakeFetch({ "*": () => ok }, async (f) => {
    first = await R.startCheck(ctx, quick(c));
    assert.equal(first.finished, false);
    assert.ok(first.done <= R.BATCH_MAX && first.done > 0, `paquet : ${first.done}`);
    const st = await R.readState(ctx);
    assert.deepEqual([st.report.finished, st.report.progress.done, st.report.progress.total], [false, first.done, 100]);
    assert.ok(st.run, "la vérification est reprenable");
    assert.match(V.panelBlocks(ctx, st).map((b) => b.html ?? b.submitLabel ?? "").join("\n"), /Continuer la vérification/);
    const before = f.calls.length;
    second = await R.continueCheck(ctx, quick(c));
    assert.equal(f.calls.length - before >= 1, true);
    while (!second.finished) second = await R.continueCheck(ctx, quick(c));
  });
  assert.equal(second.done, 100);
  const st = await R.readState(ctx);
  assert.equal(st.run, null);
  assert.equal(st.history.length, 1);
  assert.equal((await R.continueCheck(ctx, quick(c))).none, true, "plus rien à continuer");
});

test("un paquet ne dépasse pas 20 secondes, même quand chaque site met du temps à répondre", async () => {
  const ctx = siteWithLinks(50, "*");
  const c = clock();
  await withFakeFetch({ "*": () => { c.advance(3000); return ok; } }, async () => {
    const t0 = c.at();
    const r = await R.startCheck(ctx, quick(c));
    assert.ok(c.at() - t0 <= R.BATCH_MS + 4000, `durée simulée ${c.at() - t0} ms`);
    assert.equal(r.finished, false);
    assert.ok(r.done < 50);
  });
});

test("jamais en arrière-plan : le module n'a ni tâche planifiée, ni minuteur, ni appel hors d'une action ; lire le panneau ne contacte aucun site", async () => {
  const ctx = siteWithLinks(3);
  assert.equal(def.tasks, undefined);
  await withFakeFetch({ "*": ok }, async (f) => {
    await def.adminPanel(ctx, {});
    await def.mcp.site_health_status(ctx);
    assert.equal(f.calls.length, 0);
    assert.equal(ctx.calls.net.length, 0);
  });
});

test("un seul passage à la fois : un deuxième clic pendant qu'un paquet tourne reçoit un message clair, sans rien lancer", async () => {
  const ctx = siteWithLinks(3);
  let release;
  const gate = new Promise((r) => { release = r; });
  await withFakeFetch({ "*": async () => { await gate; return ok; } }, async (f) => {
    const a = R.startCheck(ctx, quick());
    await new Promise((r) => setTimeout(r, 30));
    const b = await def.adminActions.check(ctx, {});
    assert.match(b.error ?? "", /déjà en cours/);
    assert.equal((await R.continueCheck(ctx, quick())).busy, true);
    release();
    assert.equal((await a).finished, true);
    const again = await def.adminActions.check(ctx, {});
    assert.match(again.ok ?? "", /terminée/);
  });
});

test("un passage interrompu (serveur redémarré) n'est pas bloqué pour toujours : la réservation expire", async () => {
  const ctx = siteWithLinks(2);
  await ctx.api.store.add("run", { links: [], paused: {}, busyUntil: Date.now() + 1000 });
  assert.equal((await R.startCheck(ctx, quick())).busy, true);
  const [row] = await ctx.api.store.list("run");
  await ctx.api.store.update(row.id, { links: [], paused: {}, busyUntil: Date.now() - 1 });
  await withFakeFetch({ "*": ok }, async () => assert.equal((await R.startCheck(ctx, quick())).finished, true));
});

test("200 liens au plus par vérification ; au-delà, la fenêtre avance d'une vérification à la suivante jusqu'à avoir tout vu", async () => {
  const ctx = siteWithLinks(450, "*");
  const seen = new Set();
  await withFakeFetch({ "*": ok }, async (f) => {
    for (let round = 0; round < 3; round++) {
      const before = f.calls.length;
      let r = await R.startCheck(ctx, quick());
      while (!r.finished) r = await R.continueCheck(ctx, quick());
      assert.ok(r.total <= 200, `fenêtre ${round} : ${r.total}`);
      for (const call of f.calls.slice(before)) seen.add(call.url);
    }
  });
  assert.equal(seen.size, 450, "trois vérifications couvrent les 450 liens");
  const st = await R.readState(ctx);
  assert.ok(V.notChecked(ctx, st.report).some((i) => /liens \d+ à \d+ sur 450/.test(i.text)), "la fenêtre est annoncée");
});

test("au plus 25 liens vers le même site ; les autres sont mis de côté et le disent", async () => {
  const ctx = siteWithLinks(40, "popular.example.org");
  await withFakeFetch({ "*": ok }, async (f) => {
    const r = await R.startCheck(ctx, quick());
    let x = r; while (!x.finished) x = await R.continueCheck(ctx, quick());
    assert.equal(f.calls.filter((c) => c.init.method === "HEAD").length, 25);
  });
  const st = await R.readState(ctx);
  const g = st.report.groups.find((x) => x.id === "link_unverified");
  assert.equal(g.count, 15);
  assert.equal(g.items[0].d[0], "skipped");
});

test("réglages : visite des liens coupée → aucun appel réseau et c'est écrit ; sites à laisser tranquille jamais visités ; plafond réglable", async () => {
  const off = siteWithLinks(3, "example.org", { settings: { checkLinks: false } });
  await withFakeFetch({ "*": ok }, async (f) => { const r = await R.startCheck(off, quick()); assert.equal(r.finished, true); assert.equal(f.calls.length, 0); });
  assert.ok(V.notChecked(off, (await R.readState(off)).report).some((i) => /désactivée/.test(i.text)));
  const skip = siteWithLinks(3, "ignore.example.org", { settings: { ignoreHosts: "ignore.example.org\nautre.example.org" } });
  await withFakeFetch({ "*": ok }, async (f) => { await R.startCheck(skip, quick()); assert.equal(f.calls.length, 0); });
  const small = siteWithLinks(30, "example.org", { settings: { maxLinks: "5" } });
  await withFakeFetch({ "*": ok }, async (f) => { const r = await R.startCheck(small, quick()); assert.equal(r.total, 5); });
  assert.deepEqual([R.readSettings(siteWithLinks(1, "example.org", { settings: { maxLinks: 9999 } })).maxLinks, R.readSettings(siteWithLinks(1, "example.org", { settings: { maxLinks: "x" } })).maxLinks, R.readSettings(siteWithLinks(1)).checkLinks], [200, 200, true]);
});

test("les résultats deviennent des phrases classées : lien disparu (important), panne et erreur du site (conseillé), refus, changement d'adresse, adresse sans « s » (pour info)", async () => {
  const body = ["gone", "down", "boom", "blocked", "moved", "plain"].map((h) => `[Lien ${h}](https://${h}.example.org/p)`).join(" ") + " [Vieux](http://insecure.example.org/p) ![Photo](https://img.example.org/p.png)";
  const ctx = makeSite({ locales: ["fr"], entries: { pages: [entry({ id: "P", title: "Ma page", body, slug: "p", path: "/pages/p" })] } });
  const routes = {
    "https://gone.example.org/p": { status: 404 }, "https://down.example.org/p": netReplies.down(), "https://boom.example.org/p": { status: 500 }, "https://blocked.example.org/p": { status: 403 },
    "https://moved.example.org/p": { status: 301, headers: { location: "https://new.example.org/q" } }, "https://new.example.org/q": ok, "https://plain.example.org/p": ok,
    "https://insecure.example.org/p": ok, "https://img.example.org/p.png": { status: 404 },
  };
  await withFakeFetch(routes, async () => { let r = await R.startCheck(ctx, quick()); while (!r.finished) r = await R.continueCheck(ctx, quick()); });
  const st = await R.readState(ctx);
  const sev = Object.fromEntries(R.visibleGroups(st.report).map((g) => [g.id, [g.sev, g.count]]));
  assert.deepEqual(sev, { link_gone: ["important", 1], img_gone: ["important", 1], link_down: ["advised", 2], link_blocked: ["info", 1], link_moved: ["info", 1], link_insecure: ["info", 1] });
  const blocks = V.panelBlocks(ctx, st);
  const text = JSON.stringify(blocks);
  assert.match(text, /1 lien mène vers une page qui n&#39;existe plus/);
  assert.match(text, /2 liens ne répondent pas/);
  assert.match(text, /Lien gone/);
  assert.match(text, /page introuvable \(erreur 404\)/);
  assert.match(text, /nouvelle adresse : https:\/\/new\.example\.org\/q/);
  assert.match(text, /Important · |Important/);
  // l'ordre : important d'abord
  const order = R.visibleGroups(st.report).map((g) => g.sev);
  assert.deepEqual(order, [...order].sort((a, b) => ({ important: 0, advised: 1, info: 2 })[a] - ({ important: 0, advised: 1, info: 2 })[b]));
  // « Corriger » d'un lien mène à la page où il est écrit
  const item = st.report.groups.find((g) => g.id === "link_gone").items[0];
  assert.equal(await R.fixTarget(ctx, item.k), "/admin/entries/P");
  const hist = st.history[0];
  assert.equal(hist.ok, false);
  assert.equal(hist.counts.important, 2);
});

test("un site qui dit « trop de demandes » n'est plus contacté du tout pendant cette vérification", async () => {
  const ctx = siteWithLinks(8, "busy.example.org");
  await withFakeFetch({ "*": netReplies.rateLimited(120) }, async (f) => {
    let r = await R.startCheck(ctx, quick());
    while (!r.finished) r = await R.continueCheck(ctx, quick());
    assert.equal(f.calls.length, 1, "une seule demande est partie");
  });
  const g = (await R.readState(ctx)).report.groups.find((x) => x.id === "link_unverified");
  assert.equal(g.count, 8);
});

test("l'historique garde les 5 dernières vérifications, pas une de plus", async () => {
  const ctx = siteWithLinks(1);
  const c = clock();
  await withFakeFetch({ "*": ok }, async () => { for (let i = 0; i < 8; i++) { await R.startCheck(ctx, quick(c)); c.advance(60_000); } });
  const st = await R.readState(ctx);
  assert.equal(st.history.length, 5);
  assert.equal(await ctx.api.store.count("history"), 5);
  assert.equal(await ctx.api.store.count("report"), 1, "un seul rapport gardé");
  assert.equal(await ctx.api.store.count("run"), 0);
});

test("masquer une remarque : elle disparaît, le total baisse, « tout réafficher » la ramène ; plafond de 200 ; remarque disparue = message clair", async () => {
  const ctx = makeSite({ locales: ["fr"], entries: { pages: [entry({ id: "A", title: "Une", summary: "", slug: "une", path: "/pages/une" }), entry({ id: "B", title: "Deux", summary: "", slug: "deux", path: "/pages/deux" })] } });
  await R.startCheck(ctx, quick());
  let st = await R.readState(ctx);
  assert.equal(R.visibleGroups(st.report, st.ignored)[0].count, 2);
  assert.match((await def.adminActions.ignore(ctx, { id: "sum:A:fr" })).ok, /masquée/);
  st = await R.readState(ctx);
  const g = R.visibleGroups(st.report, st.ignored)[0];
  assert.deepEqual([g.count, g.items.map((i) => i.t)], [1, ["Deux"]]);
  assert.match(JSON.stringify(V.panelBlocks(ctx, st)), /1 remarque est masquée/);
  assert.match((await def.adminActions.ignore(ctx, { id: "n'importe quoi" })).error, /n&#39;existe plus|n'existe plus/);
  await def.adminActions.ignore(ctx, { id: "sum:B:fr" });
  st = await R.readState(ctx);
  assert.equal(R.visibleGroups(st.report, st.ignored).length, 0);
  assert.match(html(V.panelBlocks(ctx, st)), /Tout va bien/);
  await def.adminActions.unignore(ctx, {});
  st = await R.readState(ctx);
  assert.equal(R.visibleGroups(st.report, st.ignored)[0].count, 2);
  for (let i = 0; i < R.MAX_IGNORED; i++) await ctx.api.store.add("ignored", { k: `x${i}` });
  assert.match((await def.adminActions.ignore(ctx, { id: "sum:A:fr" })).error, /Trop de remarques/);
});
const html = (blocks) => blocks.filter((b) => b.type === "html").map((b) => b.html).join("\n");

test("« Corriger » : mène à l'écran d'administration de la remarque, jamais ailleurs", async () => {
  const ctx = makeSite({ locales: ["fr", "en"], entries: { pages: { fr: [entry({ id: "A", title: "Une", summary: "", slug: "une", path: "/pages/une" })], en: [] } } });
  await R.startCheck(ctx, quick());
  assert.deepEqual(await def.adminActions.fix(ctx, { id: "sum:A:fr" }), { redirect: "/admin/entries/A" });
  const tr = await def.adminActions.fix(ctx, { id: "tr:A:en" });
  assert.equal(tr.redirect, undefined, "pas de texte assez long pour compter comme traduction manquante");
  assert.match((await def.adminActions.fix(ctx, { id: "../../evil" })).error, /n'existe plus/);
  // une remarque corrompue ne peut pas rediriger ailleurs
  const [row] = await ctx.api.store.list("report");
  const data = { ...row.data, groups: [{ id: "alt", loc: "fr", sev: "important", count: 1, items: [{ k: "evil", t: "x", f: ["i", "https://evil.example.org/"] }, { k: "evil2", t: "y", f: ["e", "a/../b", "fr"] }] }] };
  await ctx.api.store.update(row.id, data);
  assert.match((await def.adminActions.fix(ctx, { id: "evil" })).error, /n'existe plus/);
  assert.match((await def.adminActions.fix(ctx, { id: "evil2" })).error, /n'existe plus/);
});

test("assistants IA : lecture seule sans effet sur les données ; lancement explicite par paquets avec « continue »", async () => {
  const ctx = siteWithLinks(100, "*");
  const never = await def.mcp.site_health_status(ctx);
  assert.deepEqual([never.checked], [false]);
  const writes = ctx.calls.writes.length;
  await def.mcp.site_health_status(ctx);
  assert.equal(ctx.calls.writes.length, writes, "la lecture n'écrit rien");
  let r;
  await withFakeFetch({ "*": ok }, async () => {
    r = await def.mcp.site_health_run(ctx, {});
    assert.deepEqual([r.started, r.finished], [true, false]);
    assert.ok(r.linksChecked > 0 && r.linksTotal === 100);
    assert.equal(r.report.progress.total, 100);
    while (!r.finished) r = await def.mcp.site_health_run(ctx, { continue: true });
    assert.equal((await def.mcp.site_health_run(ctx, { continue: true })).started, false);
  });
  assert.equal(r.report.allGood, true);
  const text = JSON.stringify(r.report);
  assert.ok(!text.includes("busyUntil"));
  assert.ok(r.report.notChecked.some((t) => /menu/.test(t)));
});
