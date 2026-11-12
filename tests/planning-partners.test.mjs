// « Avec… » : les partenaires d'un stream. Saisie (Streams saisis à la main), convention de l'agenda Google (Agenda en ligne), affichage du Planning (page, accueil, overlay, image,
// outil de l'assistant, administration) avec les noms de Contacts. Aucun réseau : Contacts est le double en mémoire (tests/helpers/fakeContactBook.mjs).
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { fakeContactBook } from "./helpers/fakeContactBook.mjs";
import { adminPageErgonomicsProblems } from "./helpers/ergonomics.mjs";
import { vevent, calendar, feedTopics } from "./helpers/icalFeed.mjs";

const rd = (m, l) => JSON.parse(fs.readFileSync(new URL(`../modules/${m}/locales/${l}.json`, import.meta.url), "utf8"));
const manifest = (m) => JSON.parse(fs.readFileSync(new URL(`../modules/${m}/module.json`, import.meta.url), "utf8"));
const planning = await import("../modules/planning/index.mjs");
const P = await import("../modules/planning/partners.mjs");
const slotsMod = await import("../modules/planning/slots.mjs");
const manual = await import("../modules/calendar-manual/index.mjs");
const manualPure = await import("../modules/calendar-manual/schedule.mjs");
const ical = await import("../modules/calendar-ical/index.mjs");
const icalPartners = await import("../modules/calendar-ical/partners.mjs");
const overlay = await import("../modules/planning/overlay.mjs");
const def = planning.default;

const frP = rd("planning", "fr"), enP = rd("planning", "en");
const hours = (n) => new Date(Date.now() + n * 3_600_000);
const slot = (id, h, extra = {}) => ({ id, title: `Soirée ${id}`, start: hours(h).toISOString(), end: hours(h + 2).toISOString(), allDay: false, status: "confirmed", timezone: "UTC", games: [], ...extra });

let book;
beforeEach(() => { P.resetPartners(); overlay.resetOverlayCache(); book = fakeContactBook(); });
const seed = (name, handle, extra = {}) => book.seedContact({ name, accounts: [{ network: "twitch", handle }], ...extra });
const ctxOf = (items, { withBook = true, settings = {}, ...over } = {}) => fakeCtx({
  key: "pl", settings: { days: 7, timezone: "UTC", ...settings }, topics: { "planning.slot": () => (typeof items === "function" ? items() : items) },
  messages: frP, locale: "fr", ...(withBook ? { services: book.services } : {}), ...over,
});
const text = (blocks) => JSON.stringify(blocks);

/* ───────────── Normalisation : la même règle partout ───────────── */
const CASES = [["sapin_x", "sapin_x"], ["@Etoile_Nord", "etoile_nord"], ["  LUNE_douce ", "lune_douce"], ["https://www.twitch.tv/Etoile_Nord/", "etoile_nord"], ["twitch.tv/lune_douce?sr=a", "lune_douce"], ["<https://m.twitch.tv/abcd>", "abcd"],
  ["abc", null], ["a".repeat(26), null], ["nom avec espace", null], ["pseudo-tiret", null], ["twitch.tv/directory", null], ["", null], [null, null], ["é_éééé", null]];
test("pseudo Twitch : minuscules, @ et lien twitch.tv acceptés, 4 à 25 lettres/chiffres/_ ; la MÊME règle dans les trois modules", () => {
  for (const [input, want] of CASES) {
    assert.equal(P.normalizeLogin(input), want, String(input));
    assert.equal(manualPure.normalizeLogin(input), want, `manuel ${input}`);
    assert.equal(icalPartners.normalizeLogin(input), want, `agenda ${input}`);
    assert.equal(ical.extractPartners === undefined, false);
  }
});

/* ───────────── Saisie à la main ───────────── */
const mkManual = () => fakeCtx({ key: "man", settings: { timezone: "Europe/Paris" }, messages: rd("calendar-manual", "fr"), locale: "fr" });
const form = (o = {}) => ({ title: "Soirée", startDate: "2026-10-14", startTime: "21:00", endTime: "23:30", ...o });
const win = { from: new Date("2026-10-01T00:00:00Z"), to: new Date("2027-01-01T00:00:00Z"), limit: 200 };

test("saisie : des pseudos collés de toutes les façons sont nettoyés, dédoublonnés, bornés à 5 ; le créneau les porte, sans eux rien ne change", async () => {
  const ctx = mkManual();
  assert.equal((await manual.default.adminActions.save(ctx, form({ partners: "@Etoile_Nord, https://twitch.tv/Lune_Douce ; etoile_nord\nnoe_stream et  SAPIN_X" }))).ok, "Enregistré.");
  await manual.default.adminActions.save(ctx, form({ title: "Sans", startDate: "2026-10-15" }));
  const [a, b] = await manual.default.exports["planning.slot"](ctx, win);
  assert.deepEqual(a.partners, ["etoile_nord", "lune_douce", "noe_stream", "sapin_x"]);
  assert.equal("partners" in b, false, "sans partenaire, le créneau est identique à celui d'avant");
  assert.deepEqual((await ctx.api.store.list("streams")).find((r) => r.data.title === "Soirée").data.partners, a.partners);
});

test("saisie : erreur SOUS LE CHAMP avec un exemple (pseudo illisible, plus de 5) ; rien n'est enregistré ; l'ancien stream sans champ se relit", async () => {
  const ctx = mkManual();
  const bad = await manual.default.adminActions.save(ctx, form({ partners: "etoile_nord, pas un pseudo!" }));
  assert.deepEqual(Object.keys(bad.errors), ["partners"]);
  assert.match(bad.errors.partners, /« pas un pseudo! » n'est pas un pseudo Twitch.*par exemple etoile_nord/);
  const many = await manual.default.adminActions.save(ctx, form({ partners: "aaaa, bbbb, cccc, dddd, eeee, ffff" }));
  assert.match(many.errors.partners, /Cinq pseudos au plus.*par exemple/);
  assert.equal(await ctx.api.store.count("streams"), 0);
  await ctx.api.store.add("streams", { title: "Ancien", startDate: "2026-10-14", allDay: false, startTime: "21:00", endTime: "", games: [], cancelled: false, repeat: "none", repeatUntil: "", skip: [] });
  const [old] = await manual.default.exports["planning.slot"](ctx, win);
  assert.equal("partners" in old, false);
  const edit = (await manual.default.adminPanel(ctx, { query: { edit: (await ctx.api.store.list("streams"))[0].id } }))[0];
  assert.equal(edit.fields.find((f) => f.name === "partners").value, "");
});

test("saisie : le champ est rare (replié), a un exemple et une aide courte ; FR/EN à parité", async () => {
  const ctx = mkManual();
  const f = (await manual.default.adminPanel(ctx, { query: {} })).find((b) => b.type === "adminForm").fields.find((x) => x.name === "partners");
  assert.equal(f.folded, true);
  assert.ok(f.example && f.help.length <= 60 && f.label.length <= 60 && !/:$/.test(f.label));
  const fr = rd("calendar-manual", "fr"), en = rd("calendar-manual", "en");
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  for (const k of ["errPartners", "errPartnersMax"]) assert.deepEqual(fr[k].match(/\{\w+\}/g) ?? [], en[k].match(/\{\w+\}/g) ?? [], k);
  assert.equal(manifest("calendar-manual").minCore, "0.6.0", "folded et example demandent le cœur 0.6.0");
  assert.deepEqual(adminPageErgonomicsProblems([{ type: "adminForm", action: "save", submitLabel: "Enregistrer le stream", fields: [{ ...f, label: f.label }] }]).map((p) => p.rule), []);
});

/* ───────────── Convention de l'agenda Google ───────────── */
test("agenda : la ligne « Avec : » de la description (HTML, échappé, entités, casse, accents, espace insécable, séparateurs, liens)", () => {
  const x = ical.extractPartners;
  assert.deepEqual(x("Jeu: Celeste\nAvec: etoile_nord, lune_douce"), ["etoile_nord", "lune_douce"]);
  assert.deepEqual(x("AVEC : @Etoile_Nord et Lune_Douce"), ["etoile_nord", "lune_douce"]);
  assert.deepEqual(x("avec : etoile_nord ; lune_douce"), ["etoile_nord", "lune_douce"]);
  assert.deepEqual(x("Avéc : etoile_nord"), ["etoile_nord"], "accents du mot Avec");
  assert.deepEqual(x("With: etoile_nord & lune_douce + noe_stream"), ["etoile_nord", "lune_douce", "noe_stream"]);
  assert.deepEqual(x("<p>Jeu : Celeste</p><p>Avec&nbsp;: <b>etoile_nord</b>, <a href=\"https://www.twitch.tv/lune_douce\">https://www.twitch.tv/lune_douce</a></p>"), ["etoile_nord", "lune_douce"]);
  assert.deepEqual(x("Jeu: Celeste&lt;br&gt;Avec: etoile_nord&lt;br&gt;&lt;i&gt;Merci&lt;/i&gt;"), ["etoile_nord"], "HTML échappé par l'agenda");
  assert.deepEqual(x("Jeu: X\\nAvec: etoile_nord\\nNotes"), ["etoile_nord"], "retours à la ligne écrits \\n");
  assert.deepEqual(x("Avec: etoile_nord\r\nAvec: lune_douce, etoile_nord"), ["etoile_nord", "lune_douce"], "plusieurs lignes, sans doublon");
  assert.deepEqual(x("Avec: aaaa, bbbb, cccc, dddd, eeee, ffff, gggg"), ["aaaa", "bbbb", "cccc", "dddd", "eeee"], "5 au plus");
});

test("agenda : rien d'autre n'est lu — pas de ligne « Avec », texte libre, pseudo invalide, description énorme", () => {
  const x = ical.extractPartners;
  for (const d of [undefined, "", "Soirée caritative, venez nombreux !", "Jeu: Celeste", "Merci à etoile_nord et lune_douce pour l'aide", "Avec: mes amis du chat", "Avec: ab, x y, pseudo-tiret, é, https://exemple.test/etoile_nord", "Rendez-vous avec: etoile_nord", "Avecetoile_nord"]) assert.deepEqual(x(d), [], String(d));
  assert.deepEqual(x("Avec: etoile_nord, n'importe quoi, lune_douce"), ["etoile_nord", "lune_douce"], "le mauvais morceau est ignoré, les bons restent");
  const long = `${"Lorem ipsum dolor sit amet. ".repeat(2000)}\nAvec: etoile_nord`;
  assert.deepEqual(x(long), [], "au-delà de 20 000 caractères, rien n'est lu (borné)");
  assert.deepEqual(x(`Avec: ${"a".repeat(5000)}`), []);
  assert.deepEqual(x("Avec: etoile_nord".repeat(1)), ["etoile_nord"]);
});

test("agenda : le créneau du sujet porte `partners` seulement s'il y en a ; le reste du créneau est identique", () => {
  const ics = calendar(vevent("1", hours(3), hours(5), "Avec amis", ["DESCRIPTION:Jeu: Celeste\\nAvec: Etoile_Nord\\, Lune_Douce"]), vevent("2", hours(8), hours(9), "Seul", ["DESCRIPTION:Jeu: Celeste"]));
  const [a, b] = feedTopics(() => ics)["planning.slot"]({ limit: 10 });
  assert.deepEqual(a.partners, ["etoile_nord", "lune_douce"]);
  assert.equal("partners" in b, false);
});

/* ───────────── Planning : seuls les pseudos reconnus et montrables ───────────── */
test("un pseudo présent dans Contacts (casse ignorée) devient le NOM de la fiche, lié à sa chaîne ; un pseudo inconnu n'est pas montré mais reste enregistré", async () => {
  seed("Étoile du Nord", "etoile_nord", { email: "secret@exemple.test", phone: "0600000000" });
  const ctx = ctxOf([slot("a", 3, { partners: ["ETOILE_NORD", "inconnu_ici"] })]);
  const out = text(await def.page(ctx));
  assert.match(out, /Avec/);
  assert.match(out, /Étoile du Nord/);
  assert.match(out, /https:\/\/www\.twitch\.tv\/etoile_nord/);
  assert.ok(!/inconnu_ici/.test(out), "un pseudo inconnu n'apparaît jamais côté public");
  const { slots } = await (async () => ({ slots: planning.toSlots([slot("a", 3, { partners: ["ETOILE_NORD", "inconnu_ici"] })], "UTC") }))();
  assert.deepEqual(slots[0].partners, ["etoile_nord", "inconnu_ici"], "le pseudo inconnu reste dans la donnée");
});

test("VIE PRIVÉE : jamais d'e-mail, de téléphone, de note, de photo ni de ressource tierce — sur la page, l'accueil, l'overlay, l'image et l'outil", async () => {
  seed("Étoile du Nord", "etoile_nord", { email: "secret@exemple.test", phone: "0600000000", photo: "https://evil.example/photo.png", role: "Rôle caché" });
  assert.equal((await book.methods.note({ id: book.dump().contacts[0].id, text: "Note privée", author: "moi" })).ok, true);
  const items = [slot("a", 3, { partners: ["etoile_nord"], games: [] }), slot("b", 6, { partners: ["etoile_nord"] })];
  const ctx = () => ctxOf(items);
  const seen = [];
  for (const appearance of ["original", "classic", "week", "timeline", "posters", "hero", "alternating"]) seen.push(text(await def.page(ctxOf(items, { settings: { appearance } }))));
  seen.push(text(await def.sections.next(ctx())), text(await def.sections.upcoming(ctx(), { count: 5 })), text(await def.sections.days(ctx(), { count: 3 })), text(await def.mcp.planning_upcoming(ctx(), { days: 7 })));
  const el = await def.routes["element/:slug"](new Request("https://site.test/m/pl/element/week?ov-w=1000&ov-h=600"), ctxOf(items, { params: { slug: "week" } }));
  seen.push(await el.text());
  const img = ctxOf(items, { siteName: "Site" });
  const week = await def.routes.image(new Request("https://site.test/m/pl/image"), img).catch(() => null);
  seen.push(JSON.stringify(img.calls?.png ?? []));
  void week;
  for (const html of seen) {
    assert.ok(!/secret@exemple|0600000000|Note privée|Rôle caché|evil\.example|photo\.png/.test(html));
    assert.ok(!/<img[^>]+src="(?!data:)[^"]*"/.test(html.replace(/\\"/g, '"')) || !/twitch|etoile/i.test((html.match(/<img[^>]+>/g) ?? []).join("")), "aucune image n'est liée aux partenaires");
  }
  assert.ok(seen.slice(0, 7).every((h) => /Étoile du Nord/.test(h)), "le nom est montré dans chaque apparence de la page");
  const overlayHtml = seen[seen.length - 3];
  assert.ok(!/href="https:\/\/www\.twitch\.tv\/etoile_nord/.test(overlayHtml) && /Étoile du Nord/.test(overlayHtml), "overlay : le nom seul, rien à cliquer");
  assert.ok(JSON.stringify(img.calls?.png ?? "").includes("Étoile du Nord"), "image de la semaine : le nom en texte");
});

test("jamais affichés : catégorie « Ne pas montrer », fiche à relire ; une catégorie choisie dans les réglages ; Contacts qui ne répond pas à ce sujet = rien de nouveau", async () => {
  const hide = book.seedCategory("Ne pas montrer");
  seed("Cachée", "cachee_tv", { categoryIds: [hide] });
  seed("À relire", "arelire_tv", { status: "to_review" });
  seed("Visible", "visible_tv");
  const items = [slot("a", 3, { partners: ["cachee_tv", "arelire_tv", "visible_tv"] })];
  const out = text(await def.page(ctxOf(items)));
  assert.ok(/Visible/.test(out) && !/Cachée|À relire|cachee_tv|arelire_tv/.test(out));
  const out2 = text(await def.mcp.planning_upcoming(ctxOf(items), { days: 7 }));
  assert.match(out2, /"partnersNotShown":2/);
  // une autre catégorie, choisie dans les réglages (le nom « Ne pas montrer » n'est alors plus utilisé)
  P.resetPartners();
  const other = book.seedCategory("Discrets");
  seed("Discret", "discret_tv", { categoryIds: [other] });
  const ctx = ctxOf([slot("a", 3, { partners: ["discret_tv", "cachee_tv"] })], { settings: { hide: other } });
  const shown = text(await def.page(ctx));
  assert.ok(!/Discret/.test(shown) && /Cachée/.test(shown), "la catégorie choisie fait foi");
  // la catégorie ne peut pas être vérifiée : on ne montre rien
  P.resetPartners();
  book.faults.throw.add("categories");
  assert.ok(!/Visible/.test(text(await def.page(ctxOf(items)))));
});

test("Contacts absent ou muet : tout le reste marche, aucun nom n'est montré, l'administration le dit en mots simples ; sans pseudo, Contacts n'est même pas appelé", async () => {
  seed("Visible", "visible_tv");
  const items = [slot("a", 3, { partners: ["visible_tv"], games: ["Celeste"] })];
  const noBook = ctxOf(items, { withBook: false });
  const page = text(await def.page(noBook));
  assert.ok(/soir/i.test(page) && !/Visible|visible_tv/.test(page));
  const admin = text(await def.adminPanel(noBook));
  assert.match(admin, /noms apparaissent sur le planning quand Contacts est installé/);
  assert.match(admin, /suggestInstall/);
  P.resetPartners();
  book.faults.hang.add("search");
  const t0 = Date.now();
  const saved = P.timing.callMs; P.timing.callMs = 80;
  const slow = text(await def.page(ctxOf(items)));
  P.timing.callMs = saved;
  assert.ok(Date.now() - t0 < 3000 && !/Visible/.test(slow));
  P.resetPartners(); book.faults.hang.clear();
  book.calls.length = 0;
  await def.page(ctxOf([slot("a", 3)]));
  assert.equal(book.calls.length, 0, "aucun pseudo : aucun appel à Contacts");
});

test("bornes et fusion : 5 partenaires par stream ; le même stream saisi à la main ET dans l'agenda réunit ses partenaires, sans doublon", () => {
  const a = { id: "m1", title: "Soirée", start: "2026-10-20T19:00:00.000Z", end: "2026-10-20T21:00:00.000Z", allDay: false, partners: ["aaaa", "bbbb", "cccc"] };
  const b = { ...a, id: "g1", partners: ["BBBB", "dddd", "eeee", "ffff"] };
  const [merged] = slotsMod.toSlots([a, b], "UTC");
  assert.deepEqual(merged.partners, ["aaaa", "bbbb", "cccc", "dddd", "eeee"]);
  assert.equal(slotsMod.toSlots([a, b], "UTC").length, 1);
  assert.deepEqual(slotsMod.toSlots([{ ...a, partners: ["a", "b".repeat(30), 42, null, "ok_pseudo"] }], "UTC")[0].partners, ["ok_pseudo"], "un fournisseur maladroit ne fait rien entrer");
  assert.equal("partners" in slotsMod.toSlots([{ ...a, partners: undefined }], "UTC")[0], false);
});

/* ───────────── Administration du Planning ───────────── */
test("administration : chaque pseudo dit ce qui sera fait ; « Pas dans vos contacts » mène à l'ajout de Contacts ; rien tant qu'aucun pseudo", async () => {
  const hide = book.seedCategory("Ne pas montrer");
  seed("Étoile du Nord", "etoile_nord"); seed("Cachée", "cachee_tv", { categoryIds: [hide] });
  const instances = { list: async ({ module }) => (module === "contacts" ? [{ id: "7", key: "contacts", module: "contacts", adminPath: "/admin/instances/7" }] : []) };
  const mk = (items) => { const c = ctxOf(items); c.api.instances = instances; return c; };
  const items = [slot("a", 3, { partners: ["etoile_nord", "cachee_tv", "inconnu_ici"] })];
  const blocks = await def.adminPanel(mk(items));
  const md = blocks.filter((b) => b.type === "markdown").map((b) => b.text).join("\n");
  assert.match(md, /etoile\\_nord\*\* : affiché sous le nom « Étoile du Nord »/);
  assert.match(md, /cachee\\_tv\*\* : dans vos contacts, mais non affiché/);
  assert.match(md, /inconnu\\_ici\*\* : pas dans vos contacts, donc non affiché\. \[Ajouter\]\(\/admin\/instances\/7\?new=person\)/);
  assert.ok(blocks.some((b) => b.type === "heading" && b.text === frP.adminWith));
  const plain = text(await def.adminPanel(mk([slot("a", 3)])));
  assert.ok(!plain.includes(frP.adminWith));
  assert.deepEqual(adminPageErgonomicsProblems(blocks).filter((p) => p.rule !== "R15"), []);
});

/* ───────────── Textes, manifestes, outils ───────────── */
test("textes : FR/EN à parité exacte ({variables} comprises) et aucun mot technique dans ce qui est visible", () => {
  for (const [m] of [["planning"], ["calendar-ical"], ["calendar-manual"]]) {
    const fr = rd(m, "fr"), en = rd(m, "en");
    assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort(), m);
    for (const k of Object.keys(fr)) assert.deepEqual((fr[k].match(/\{\w+\}/g) ?? []).sort(), (en[k].match(/\{\w+\}/g) ?? []).sort(), `${m}.${k}`);
  }
  for (const k of Object.keys(frP).filter((x) => /^adminWith|^withLabel/.test(x))) {
    assert.ok(!/\b(compte|handle|slug|identifiant|clé|API)\b/i.test(frP[k]) && !/\b(account|handle|slug|key|API)\b/i.test(enP[k]), k);
    assert.ok(!/!/.test(frP[k] + enP[k]) && frP[k].split(/[.?]/).every((s) => s.trim().split(/\s+/).length <= 20), k);
  }
});

test("manifestes : contact.book est FACULTATIF, le sujet déclare `partners`, l'outil de l'assistant reste en lecture seule sous le même nom, versions montées (mineure)", () => {
  const m = manifest("planning");
  assert.deepEqual(m.requires.find((r) => r.service === "contact.book"), { service: "contact.book", min: 2, optional: true, label: m.requires.at(-1).label });
  assert.deepEqual(m.consumes.find((c) => c.topic === "planning.slot").schema.find((f) => f.key === "partners"), { key: "partners", type: "string[]" });
  assert.deepEqual(m.mcp.map((t) => [t.name, t.readOnly, t.default]), [["planning_upcoming", true, true]]);
  assert.equal(m.minCore, "0.5.0", "le Planning n'utilise aucune brique de la 0.6.0 : minCore inchangé");
  assert.deepEqual([m.version, manifest("calendar-manual").version, manifest("calendar-ical").version], ["2.7.5", "1.2.1", "1.1.0"]);
  assert.equal(m.logEvents, undefined, "pas de nouvel événement au journal");
});
