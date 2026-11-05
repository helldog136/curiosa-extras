// Bot Twitch 1.12.0 : modifier ou créer une commande, un timer, une récompense ou une action s'ouvre dans une FENÊTRE au-dessus de la page (`presentation: "dialog"`, cœur 0.6.7),
// jamais dans une section qui pousse la liste vers le bas. Ce fichier vérifie ce que toutes ces fenêtres ont en commun ; le détail de chacune est dans les tests de sa page
// (twitch-bot-admin, twitch-bot-timers, channel-rewards, home-actions). Les captures regardées (1280 et 390 px, clair et sombre) sont décrites dans la PR.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { world, fr, en, C, SRC } from "./helpers/botWorld.mjs";
import { ownerWorld } from "./helpers/ownerSet.mjs";
import { tableOf, dialogsOf, shownFields, foldedFields, cellOf } from "./helpers/ui.mjs";
import { assertAdminPageErgonomics, adminPageErgonomicsProblems } from "./helpers/ergonomics.mjs";
import { opensInDialog, dialogsLast } from "@/core/adminkit/dialog";

const DIR = new URL("../modules/twitch-bot", import.meta.url).pathname;
const A = await import("../modules/twitch-bot/admin.mjs");
const manifest = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8"));
const owner = await ownerWorld();
await C.saveCommand(owner.ctx, { kind: "custom" }, { name: "rappel", text: "Pensez à boire.", repeat: { minutes: 15, lines: 5, when: "live", enabled: true } }, { src: await SRC.gather(owner.ctx, "emma"), t: owner.ctx.t, prefix: "!" });

/** Toutes les fenêtres que la page peut ouvrir, avec l'adresse qui les ouvre. */
async function everyWindow(ctx, extra = {}) {
  const cfg = (await C.loadConfig(ctx)).data;
  const custom = cfg.custom.find((c) => c.name === "tip")?.id, timer = cfg.custom.find((c) => c.name === "rappel")?.id;
  const out = [];
  for (const [name, query] of [["new command", { new: "1" }], ["edit command", { edit: `custom:${custom}` }], ["edit builtin", { edit: "builtin:jeu" }], ["edit command from timers", { tab: "timers", edit: `custom:${timer}`, repeat: "1" }], ["new timer", { tab: "timers", timerAdd: "1" }], ...Object.entries(extra)]) {
    const page = await A.panel(ctx, { query });
    const forms = dialogsOf(page);
    out.push({ name, query, page, forms });
  }
  return out;
}

test("chaque adresse d'édition ouvre UNE fenêtre, avec un titre, un seul bouton principal (verbe précis), un retour à son onglet et au plus 5 champs visibles", async () => {
  for (const { name, query, page, forms } of await everyWindow(owner.ctx)) {
    assert.equal(forms.length, 1, `${name} : une seule fenêtre`);
    const f = forms[0];
    assert.ok(f.title && f.title.length <= 60, `${name} : titre « ${f.title} »`);
    assert.equal(f.cancelHref, `?tab=${query.tab ?? "use"}`, `${name} : la fenêtre revient à son onglet`);
    assert.equal(f.tab, query.tab === "timers" ? "timers" : undefined, `${name} : l'onglet qui garde sa liste derrière`);
    assert.ok(shownFields(f).length <= 5, `${name} : champs visibles`);
    assert.ok(!/^(OK|Valider|Soumettre|Enregistrer)$/i.test(f.submitLabel), `${name} : bouton « ${f.submitLabel} »`);
    assert.ok(foldedFields(f).every((x) => x.kind !== "file"), `${name} : un champ fichier ne s'ouvre pas en fenêtre`);
    assert.equal(opensInDialog(f, { admin: true }), true, `${name} : le cœur l'ouvre bien en fenêtre`);
    assert.deepEqual(adminPageErgonomicsProblems(page), [], `${name} : ergonomie`);
    // la liste est toujours dans la page, la fenêtre vient après elle (la liste ne bouge pas à l'ouverture)
    const ordered = dialogsLast(page.filter((b) => (b.tab ?? "use") === (query.tab ?? "use")), { admin: true });
    assert.equal(ordered.at(-1), f, `${name} : la fenêtre passe en dernier`);
    assert.ok(ordered.some((b) => b.type === "table"), `${name} : la liste reste affichée`);
  }
});

test("le champ caché `id` d'une fenêtre est la clé d'une ligne de la liste qu'elle laisse derrière elle : la ligne enregistrée est repérée", async () => {
  for (const { name, query, page, forms } of await everyWindow(owner.ctx)) {
    const id = forms[0].fields.find((f) => f.name === "id" && f.kind === "hidden")?.value;
    if (name.startsWith("new")) { assert.equal(id, undefined, `${name} : rien à repérer pour une création`); continue; }
    const tab = query.tab === "timers" ? "timers" : undefined;
    const tables = page.filter((b) => b.type === "table" && b.tab === tab && b.rowIds);
    assert.ok(tables.some((t) => t.rowIds.includes(id)), `${name} : « ${id} » est une ligne de la liste`);
  }
});

test("les listes sont des tableaux du cœur : recherche dès le départ, même courte (R15), au plus deux actions visibles (R16), l'édition en fenêtre, la suppression dans le menu (R3, R24)", async () => {
  const w = world({ settings: { cooldownGlobal: 0 } });
  await C.saveCommand(w.ctx, { kind: "custom" }, { name: "un", text: "Un", repeat: { minutes: 10 } }, { src: await SRC.gather(w.ctx, "emma"), t: w.ctx.t, prefix: "!" });
  const page = await A.panel(w.ctx, { query: {} });
  const tables = page.filter((b) => b.type === "table" && b.rowActions?.length);
  assert.ok(tables.length >= 2);
  for (const t of tables) {
    assert.equal(t.searchable, true, t.columns[0]);
    const visible = t.rowActions.filter((a) => !a.inMenu && !a.danger);
    assert.ok(visible.length <= 2, t.columns.join());
    for (const a of t.rowActions) {
      if (a.presentation === "dialog") assert.ok(a.href.includes("{id}") && !a.action && /^\?tab=/.test(a.href), `${a.label} : un lien vers l'onglet`);
      if (a.danger) assert.ok(a.confirm && a.confirm.length > 20, `${a.label} : la confirmation dit ce qui sera perdu`);
    }
    assert.ok(t.rowActions.filter((a) => a.presentation === "dialog").length <= 1);
  }
});

test("version et compatibilité : 1.12.0 ; le cœur 0.6.7 est nécessaire (un bouton « Nouvelle … » en fenêtre y est un lien `?…`)", () => {
  assert.equal(manifest.version, "1.12.0");
  assert.equal(manifest.minCore, "0.6.7");
  assert.equal(manifest.dataVersion, 6, "aucune migration : mêmes données, mêmes réglages");
  const keys = manifest.settings.map((s) => s.key);
  assert.ok(["prefix", "onlyWhenLive", "timezone", "chatManage"].every((k) => keys.includes(k)), "mêmes réglages");
});

test("plus aucun morceau de page pour ranger un formulaire ou animer un interrupteur : le script ne sert plus qu'au journal, aux listes repliées et aux boutons d'action", () => {
  const script = fs.readFileSync(`${DIR}/adminkit.client.js`, "utf8");
  for (const gone of ["buildForm", "stateHelp", "textExtras", "segmented(", "sentence(", "data-ck-switch", "data-ck-config", "previewText"]) assert.ok(!script.includes(gone), `script : « ${gone} »`);
  const kit = fs.readFileSync(`${DIR}/adminkit.mjs`, "utf8");
  for (const gone of ["switchHtml", "formConfig", "ck-sw", "ck-seg", "ck-more", "ck-chip", "ck-preview"]) assert.ok(!kit.includes(gone), `adminkit : « ${gone} »`);
  const src = ["admin", "commandsUi", "timersAdmin", "rewardsAdmin"].map((f) => fs.readFileSync(`${DIR}/${f}.mjs`, "utf8")).join("\n");
  assert.ok(!/id="(edit|new|add|action)"/.test(src), "plus d'ancre vers un formulaire dans la page (seule reste celle du test d'une récompense, qui est dans la page)");
  assert.ok(!/formConfig|data-ck-config|name: "ck"/.test(src));
});

test("les textes de la fenêtre : mêmes clés en français et en anglais, ton neutre, libellés courts sans deux-points, pas de point d'exclamation", () => {
  const keys = ["delete_row_confirm", "delete_own_only", "edit_partner_title", "edit_network_help", "f_wait_all", "f_wait_user", "unit_seconds", "unit_messages", "f_text_example", "reset_help",
    "rep_every_help", "rep_lines_help", "rep_when_help", "tm_save_btn", "tm_edit_title", "tm_delete_btn", "tm_delete_confirm", "tm_deleted_cmd", "tm_pick_status", "rw_rename_btn", "rw_save_btn", "rw_new_link"];
  const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  for (const k of keys) {
    assert.ok(fr[k] && en[k], k);
    assert.equal(vars(fr[k]), vars(en[k]), k);
    for (const L of [fr, en]) assert.ok(!/!/.test(L[k]) && L[k].split(/\s+/).length <= 20 && !/\b(tu|ton|ta|tes|veuillez)\b/i.test(L[k]), `${k} : ${L[k]}`);
  }
  for (const k of ["f_wait_all", "f_wait_user", "tm_save_btn", "tm_delete_btn", "rw_rename_btn", "rw_save_btn"]) for (const L of [fr, en]) assert.ok(L[k].length <= 60 && !/:\s*$/.test(L[k]), k);
  for (const k of ["tm_delete_confirm", "delete_row_confirm"]) assert.match(fr[k], /(supprim|perdu)/i, "la confirmation dit ce qui sera perdu");
});

test("en anglais aussi : les fenêtres, les boutons et les confirmations sont écrits, rien de français", async () => {
  const w = world({ locale: "en" });
  await C.saveCommand(w.ctx, { kind: "custom" }, { name: "hello", text: "Hello", repeat: { minutes: 10 } }, { src: await SRC.gather(w.ctx, "emma"), t: w.ctx.t, prefix: "!" });
  const key = `custom:${(await C.loadConfig(w.ctx)).data.custom[0].id}`;
  for (const query of [{ new: "1" }, { edit: key }, { tab: "timers", edit: key, repeat: "1" }, { tab: "timers", timerAdd: "1" }, { edit: "builtin:jeu" }]) {
    const page = await A.panel(w.ctx, { query });
    const f = dialogsOf(page)[0];
    assert.ok(f, JSON.stringify(query));
    assert.ok(!/[éèàù]| la | le | votre | Enregistrer|Créer|Modifier/.test(`${f.title} ${f.submitLabel} ${f.fields.map((x) => `${x.label} ${x.help ?? ""}`).join(" ")}`), `${JSON.stringify(query)} : ${f.title} / ${f.submitLabel}`);
    assertAdminPageErgonomics(page);
  }
  const list = tableOf(await A.panel(w.ctx, { query: {} }), "Command");
  assert.deepEqual(list.rowActions.map((a) => a.label), ["Edit", "Delete"]);
  assert.match(list.rowActions[1].confirm, /answer.*settings.*repeat.*lost/);
  assert.equal(cellOf(list.rows[0][3]), "On");
});

test("« Plus d'options » ne compte et ne résume que ce qui s'écarte du défaut (R14) : une commande ordinaire n'a ni pastille ni résumé", async () => {
  const { summarizeGroup } = await import("@/core/adminkit/summary");
  const { makeTranslator } = await import("@/core/i18n/dictionary");
  const summary = async (query) => {
    const f = dialogsOf(await A.panel(owner.ctx, { query }))[0], folded = foldedFields(f);
    return summarizeGroup(folded.map((x) => ({ key: x.name, label: x.label, type: x.kind === "switch" ? "boolean" : x.kind === "segmented" ? "select" : x.kind ?? "text", options: x.options, unit: x.unit })), (k) => { const x = folded.find((y) => y.name === k); return x.kind === "switch" ? (x.value === "on" ? true : undefined) : x.value; }, "fr", makeTranslator("fr"));
  };
  const key = `custom:${(await C.loadConfig(owner.ctx)).data.custom.find((c) => c.name === "tip").id}`;
  assert.deepEqual(await summary({ edit: key }), { summary: "", count: 0 });
  assert.deepEqual(await summary({ new: "1" }), { summary: "", count: 0 });
  const timer = `custom:${(await C.loadConfig(owner.ctx)).data.custom.find((c) => c.name === "rappel").id}`;
  assert.ok((await summary({ tab: "timers", edit: timer })).count >= 1, "un timer réglé se voit");
});
