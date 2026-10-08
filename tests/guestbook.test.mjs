import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { parseManifest } from "@/core/modules/manifest";
import { conform } from "@/core/services/topics";
import { validateArgs } from "@/core/services/mcp/validate";
import { FEED_ITEM_SCHEMA } from "@/core/feeds";

const DIR = new URL("../examples/guestbook", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
const manifestJson = readJson("module.json");
const source = fs.readFileSync(`${DIR}/index.mjs`, "utf8");
const loadMessages = (lang) => readJson(`locales/${lang}.json`);
const def = (await import("../examples/guestbook/index.mjs")).default;

let seq = 0;
/** Contexte factice avec les vrais textes ; chaque appel a sa propre clé d'instance (le limiteur est en mémoire, par clé). */
const ctxFor = (settings = {}, opts = {}) => fakeCtx({ key: `gb${++seq}`, basePath: "guestbook", moduleId: "guestbook", locale: "en", messages: loadMessages("en"), settings: { rateLimit: 50, ...settings }, ...opts });
/** Une requête POST de formulaire. */
const post = (fields, ip = "203.0.113.7") => {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return new Request("https://example.org/m/x/sign", { method: "POST", body, headers: { "x-forwarded-for": ip } });
};
const sign = (ctx, fields, ip) => def.routes.sign(post(fields, ip), ctx);
const seed = async (ctx, data) => ctx.api.store.add("messages", data);

// ── Manifeste ───────────────────────────────────────────────────────────────────────────────────────────────────

test("manifeste : valide pour parseManifest", () => {
  const r = parseManifest(manifestJson);
  assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(r.manifest.id, "guestbook");
  assert.equal(r.manifest.apiVersion, 2);
  assert.equal(r.manifest.type, "widget");
  assert.equal(r.manifest.instances, "multiple");
  assert.equal(r.manifest.page, true);
  assert.equal(r.manifest.basePath, "guestbook");
});

test("manifeste : sections, sujets, actions MCP déclarés = implémentés (et réciproquement)", () => {
  assert.deepEqual(manifestJson.sections.map((s) => s.id).sort(), Object.keys(def.sections).sort());
  assert.deepEqual(manifestJson.provides.map((p) => p.topic).sort(), Object.keys(def.exports).sort());
  assert.deepEqual(manifestJson.mcp.map((a) => a.name).sort(), Object.keys(def.mcp).sort());
  assert.deepEqual(Object.keys(def.slots), ["layout.footer"]);
  assert.deepEqual(Object.keys(def.routes), ["sign"]);
  // chaque action d'admin utilisée par un bouton ou un formulaire existe
  for (const m of source.matchAll(/action: "([a-z]+)"/g)) assert.ok(m[1] in def.adminActions, `adminAction ${m[1]} manquante`);
  assert.deepEqual(Object.keys(def.adminActions).sort(), ["approve", "edit", "remove"]);
});

test("manifeste : les permissions couvrent chaque capacité utilisée, rien de plus", () => {
  const expected = { slots: def.slots, routes: def.routes, storage: source.includes("ctx.api.store"), sections: def.sections, pages: def.page, topics: def.exports, mcp: def.mcp, admin: def.adminPanel, mail: source.includes("ctx.api.mail") };
  const used = Object.entries(expected).filter(([, v]) => v).map(([k]) => k).sort();
  assert.deepEqual([...manifestJson.permissions].sort(), used);
});

test("manifeste : aucune action MCP destructive n'est activée par défaut ; défauts attendus", () => {
  for (const a of manifestJson.mcp) {
    if (a.destructive) assert.notEqual(a.default, true, `${a.name} destructive mais activée par défaut`);
    assert.ok(!(a.readOnly && a.destructive), a.name);
  }
  const byName = Object.fromEntries(manifestJson.mcp.map((a) => [a.name, a]));
  assert.equal(byName.guestbook_list.readOnly, true);
  assert.equal(byName.guestbook_approve.default, false);
  assert.equal(byName.guestbook_approve.readOnly, undefined);
  assert.equal(byName.guestbook_delete.destructive, true);
  assert.equal(byName.guestbook_delete.default, false);
});

test("manifeste : les réglages lus par le code existent, couvrent tous les types et portent les bons attributs", () => {
  const declared = new Map([...manifestJson.settings, ...manifestJson.sections.flatMap((s) => s.options ?? [])].map((s) => [s.key, s]));
  const used = [...source.matchAll(/ctx\.setting\("([A-Za-z0-9_]+)"\)/g)].map((m) => m[1]);
  assert.ok(used.length > 5);
  for (const key of used) assert.ok(declared.has(key), `réglage ${key} lu mais non déclaré`);
  for (const key of declared.keys()) if (key !== "count") assert.ok(used.includes(key), `réglage ${key} déclaré mais jamais lu`);
  const types = new Set(manifestJson.settings.map((s) => s.type));
  for (const t of ["text", "textarea", "boolean", "number", "select", "color", "image", "secret"]) assert.ok(types.has(t), `type ${t} non illustré`);
  const accent = declared.get("accent");
  assert.equal(accent.default, "theme:accent");
  assert.equal(accent.group, "appearance");
  assert.ok(manifestJson.settings.some((s) => s.translatable));
  assert.ok(manifestJson.settings.some((s) => s.advanced));
  // un réglage avancé a toujours une valeur par défaut exploitable (le code retombe dessus)
  for (const k of ["maxLength", "perPage", "rateLimit"]) assert.notEqual(declared.get(k).default, undefined);
  assert.equal(declared.get("autoApprove").default, false);
});

test("sections : tailles recommandées (small / medium) et option count", () => {
  const byId = Object.fromEntries(manifestJson.sections.map((s) => [s.id, s]));
  assert.equal(byId.latest.size, "small");
  assert.equal(byId.recent.size, "medium");
  assert.deepEqual(byId.recent.options.map((o) => o.key), ["count"]);
});

test("manifeste : aucune donnée métier réelle (adresse, marque) dans le module", () => {
  const all = JSON.stringify({ ...manifestJson, author: undefined }) + source + fs.readFileSync(`${DIR}/README.md`, "utf8");
  assert.ok(!new RegExp(["gmail", ["hell", "dog"].join(""), ["rosa", "lia"].join("")].join("|"), "i").test(all));
});

// ── Langues ─────────────────────────────────────────────────────────────────────────────────────────────────────

test("langues : mêmes clés en en/fr, aucun texte vide", () => {
  const keys = (f) => Object.keys(readJson(`locales/${f}`)).sort();
  assert.deepEqual(keys("fr.json"), keys("en.json"));
  for (const f of ["en.json", "fr.json"]) for (const [k, v] of Object.entries(readJson(`locales/${f}`))) assert.ok(typeof v === "string" && v.trim(), `${f}:${k} vide`);
});

test("langues : chaque ctx.t(\"clé\") statique existe, et chaque clé est utilisée", () => {
  const en = loadMessages("en");
  const used = new Set([...source.matchAll(/\bt\("([A-Za-z0-9_]+)"/g)].map((m) => m[1]));
  for (const k of used) assert.ok(k in en, `clé ${k} absente de en.json`);
  for (const k of Object.keys(en)) assert.ok(used.has(k), `clé ${k} jamais utilisée`);
  // pas de ctx.t à clé calculée (impossible à vérifier statiquement)
  assert.ok(!/\.t\((?!")/.test(source), "clé de traduction dynamique");
});

test("langues : les variables {x} des textes sont les mêmes en en/fr", () => {
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  const en = loadMessages("en"), fr = loadMessages("fr");
  for (const k of Object.keys(en)) assert.equal(vars(fr[k]), vars(en[k]), k);
});

// ── Signature (route sign) ──────────────────────────────────────────────────────────────────────────────────────

test("signer : un message valide est conservé « pending » et le visiteur reçoit 200", async () => {
  const ctx = ctxFor();
  const res = await sign(ctx, { name: "  Ada  ", message: "Bravo\r\nà vous" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, status: "pending" });
  const [row] = await ctx.api.store.list("messages");
  assert.deepEqual(row.data, { name: "Ada", message: "Bravo\nà vous", status: "pending" });
});

test("signer : autoApprove publie directement", async () => {
  const ctx = ctxFor({ autoApprove: true });
  assert.equal((await (await sign(ctx, { name: "Ada", message: "Salut" })).json()).status, "approved");
  assert.equal((await ctx.api.store.list("messages"))[0].data.status, "approved");
});

test("signer : méthode autre que POST → 405", async () => {
  const res = await def.routes.sign(new Request("https://example.org/m/x/sign"), ctxFor());
  assert.equal(res.status, 405);
});

test("signer : corps qui n'est pas un formulaire → 400, rien de stocké", async () => {
  const ctx = ctxFor();
  const res = await def.routes.sign(new Request("https://example.org/m/x/sign", { method: "POST", body: "{", headers: { "content-type": "application/json" } }), ctx);
  assert.equal(res.status, 400);
  assert.equal(await ctx.api.store.count("messages"), 0);
});

test("signer : nom ou message vide/espaces, trop de liens → 400, rien de stocké, aucun e-mail", async () => {
  const ctx = ctxFor();
  for (const f of [{ name: "", message: "x" }, { name: "Ada", message: "   " }, { name: "   ", message: "x" }, { message: "x" }, { name: "Ada", message: "http://a.test http://b.test http://c.test" }]) {
    assert.equal((await sign(ctx, f)).status, 400, JSON.stringify(f));
  }
  assert.equal(await ctx.api.store.count("messages"), 0);
  assert.equal(ctx.calls.mail.length, 0);
});

test("signer : les textes sont bornés et nettoyés (longueur, caractères de contrôle, inversion de sens)", async () => {
  const ctx = ctxFor({ maxLength: 50 });
  await sign(ctx, { name: "N".repeat(500), message: `a\u0000b‮c${"z".repeat(500)}` });
  const { data } = (await ctx.api.store.list("messages"))[0];
  assert.equal(data.name.length, 60);
  assert.equal(data.message.length, 50);
  assert.ok(!/[\u0000‮]/.test(data.message));
  // un maxLength absurde est ramené dans [20, 2000]
  const big = ctxFor({ maxLength: 99999 });
  await sign(big, { name: "a", message: "m".repeat(5000) });
  assert.equal((await big.api.store.list("messages"))[0].data.message.length, 2000);
});

test("signer : le piège à robots répond « ok » sans rien conserver ni envoyer", async () => {
  const ctx = ctxFor();
  const res = await sign(ctx, { name: "Bot", message: "Buy now", website: "http://spam.test" });
  assert.equal(res.status, 200);
  assert.equal(await ctx.api.store.count("messages"), 0);
  assert.equal(ctx.calls.mail.length, 0);
});

test("signer : limiteur de débit par visiteur et par instance (429), un autre visiteur passe", async () => {
  const ctx = ctxFor({ rateLimit: 2 });
  const ok = { name: "Ada", message: "Salut" };
  assert.equal((await sign(ctx, ok, "198.51.100.1")).status, 200);
  assert.equal((await sign(ctx, ok, "198.51.100.1")).status, 200);
  assert.equal((await sign(ctx, ok, "198.51.100.1")).status, 429);
  assert.equal((await sign(ctx, ok, "198.51.100.2")).status, 200);
  // une autre instance (autre clé) ne partage pas le compteur
  const other = ctxFor({ rateLimit: 2 });
  assert.equal((await sign(other, ok, "198.51.100.1")).status, 200);
  assert.equal(await ctx.api.store.count("messages"), 3);
});

test("signer : code d'invitation (réglage secret) exigé quand il est défini", async () => {
  const ctx = ctxFor({ accessCode: "open-sesame" });
  assert.equal((await sign(ctx, { name: "Ada", message: "Salut" })).status, 403);
  assert.equal((await sign(ctx, { name: "Ada", message: "Salut", code: "nope" })).status, 403);
  assert.equal((await sign(ctx, { name: "Ada", message: "Salut", code: " open-sesame " })).status, 200);
  assert.equal(await ctx.api.store.count("messages"), 1);
  // sans code défini, le champ n'existe pas dans le formulaire
  const page = await def.page(ctxFor(), { segments: [] });
  assert.deepEqual(page.blocks.find((b) => b.type === "form").fields.map((f) => f.name), ["name", "message"]);
  const guarded = await def.page(ctx, { segments: [] });
  assert.deepEqual(guarded.blocks.find((b) => b.type === "form").fields.map((f) => f.name), ["name", "message", "code"]);
});

test("signer : plafond de stockage → 503", async () => {
  const ctx = ctxFor();
  ctx.api.store.count = async () => 2000;
  assert.equal((await sign(ctx, { name: "Ada", message: "Salut" })).status, 503);
});

test("e-mail : le propriétaire est prévenu (texte brut, destinataire « owner »), pending ou publié", async () => {
  const ctx = ctxFor({}, { messages: { ...loadMessages("en") } });
  await sign(ctx, { name: "Ada", message: "Un très beau site" });
  assert.equal(ctx.calls.mail.length, 1);
  const m = ctx.calls.mail[0];
  assert.equal(m.to, "owner");
  assert.match(m.subject, /Ada/);
  assert.match(m.text, /Un très beau site/);
  assert.match(m.text, /waiting for your approval/);
  assert.match(m.text, /https:\/\/example\.test\/admin\/instances\/id-gb\d+/);
  const pub = ctxFor({ autoApprove: true });
  await sign(pub, { name: "Ada", message: "Salut" });
  assert.match(pub.calls.mail[0].text, /already published/);
});

test("e-mail : notify désactivé → aucun e-mail ; message conservé", async () => {
  const ctx = ctxFor({ notify: false });
  await sign(ctx, { name: "Ada", message: "Salut" });
  assert.equal(ctx.calls.mail.length, 0);
  assert.equal(await ctx.api.store.count("messages"), 1);
});

test("e-mail : un échec (réponse ko ou exception) ne perd jamais le message ni ne fait échouer la requête", async () => {
  for (const mailResult of [{ ok: false, reason: "not_configured" }, () => { throw new Error("SMTP down"); }]) {
    const ctx = ctxFor({}, { mailResult });
    const quiet = console.error;
    console.error = () => {};
    try {
      assert.equal((await sign(ctx, { name: "Ada", message: "Salut" })).status, 200);
    } finally {
      console.error = quiet;
    }
    assert.equal(await ctx.api.store.count("messages"), 1);
  }
});

// ── Rendu et XSS ────────────────────────────────────────────────────────────────────────────────────────────────

const PAYLOAD = `<script>alert(1)</script><img src=x onerror=alert(2)> "quoted" 'single' &amp;`;

function htmlOf(blocks) {
  return blocks.filter((b) => b.type === "html").map((b) => b.html).join("\n");
}

test("XSS : le texte d'un visiteur n'est jamais rendu en HTML brut (page, sections, flux, admin)", async () => {
  const ctx = ctxFor({}, { settings: { rateLimit: 50 } });
  await seed(ctx, { name: PAYLOAD, message: PAYLOAD, status: "approved" });
  const page = await def.page(ctx, { segments: [] });
  const html = htmlOf(page.blocks);
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(!/<script|<img src=x|onerror=alert\(2\)>/i.test(html.replace(/<img src="[^"]*" alt="">/g, "")));
  assert.ok(html.includes("&quot;quoted&quot;") && html.includes("&#39;single&#39;") && html.includes("&amp;amp;"));
  for (const id of ["latest", "recent"]) assert.ok(!/<script/i.test(htmlOf(await def.sections[id](ctx, {}))), id);
  // les blocs « markdown » ne contiennent jamais de texte de visiteur (le cœur les interprète)
  assert.ok(!page.blocks.filter((b) => b.type === "markdown").some((b) => b.text.includes("alert")));
  // l'admin : les cellules de tableau sont du texte (échappé par le cœur), jamais un bloc html
  const admin = await def.adminPanel(ctx, { query: {} });
  assert.ok(!admin.some((b) => b.type === "html"));
});

test("XSS : couleur et image réglées par l'admin sont validées avant d'entrer dans un attribut", async () => {
  const ctx = ctxFor({ accent: 'red;"><script>alert(1)</script>', banner: "javascript:alert(1)" });
  await seed(ctx, { name: "Ada", message: "Salut", status: "approved" });
  const page = await def.page(ctx, { segments: [] });
  const html = htmlOf(page.blocks);
  assert.ok(!/<script|javascript:/i.test(html));
  assert.ok(html.includes(ctx.theme.accent), "repli sur ctx.theme.accent");
  const good = ctxFor({ accent: "#112233", banner: "https://example.org/b.png" });
  await seed(good, { name: "Ada", message: "Salut", status: "approved" });
  const ok = htmlOf((await def.page(good, { segments: [] })).blocks);
  assert.ok(ok.includes("#112233") && ok.includes('src="https://example.org/b.png"'));
  const tricky = ctxFor({ banner: 'https://example.org/"onerror="x' });
  const out = htmlOf((await def.page(tricky, { segments: [] })).blocks);
  assert.ok(!out.includes('"onerror='));
  const proto = ctxFor({ banner: "//evil.example.org/x.png" });
  assert.ok(!htmlOf((await def.page(proto, { segments: [] })).blocks).includes("evil.example.org"));
});

test("thème : les cartes utilisent les variables CSS du site et l'accent du thème par défaut", async () => {
  const ctx = ctxFor({ accent: "#e8a23b" });
  await seed(ctx, { name: "Ada", message: "Salut", status: "approved" });
  const html = htmlOf(await def.sections.latest(ctx));
  assert.ok(html.includes("var(--v-line)") && html.includes("var(--v-surface)") && html.includes("#e8a23b"));
  const plain = ctxFor({ style: "plain" });
  await seed(plain, { name: "Ada", message: "Salut", status: "approved" });
  assert.ok(!htmlOf(await def.sections.latest(plain)).includes("var(--v-surface)"));
});

// ── Page publique, sections, slot ───────────────────────────────────────────────────────────────────────────────

test("page : titre, formulaire à la bonne action, messages validés seulement, textes traduits", async () => {
  const ctx = ctxFor({ title: "Notre livre d'or", autoApprove: false });
  await seed(ctx, { name: "Ada", message: "Visible", status: "approved" });
  await seed(ctx, { name: "Bob", message: "Secret en attente", status: "pending" });
  const page = await def.page(ctx, { segments: [] });
  assert.equal(page.title, "Notre livre d'or");
  const form = page.blocks.find((b) => b.type === "form");
  assert.equal(form.action, `${ctx.instance.key}/sign`);
  assert.equal(form.successText, "Thank you! Your message will appear once it has been approved.");
  const html = htmlOf(page.blocks);
  assert.ok(html.includes("Visible") && !html.includes("Secret en attente"));
  const auto = await def.page(ctxFor({ autoApprove: true }), { segments: [] });
  assert.equal(auto.blocks.find((b) => b.type === "form").successText, "Thank you! Your message is now online.");
  assert.equal((await def.page(ctxFor(), { segments: [] })).title, "Guestbook");
});

test("page : vide → texte d'invitation ; intro Markdown de l'admin ; segments inconnus → 404", async () => {
  const ctx = ctxFor({ intro: "Bienvenue **ici**" });
  const page = await def.page(ctx, { segments: [] });
  assert.ok(page.blocks.some((b) => b.type === "markdown" && b.text === "Bienvenue **ici**"));
  assert.ok(page.blocks.some((b) => b.type === "markdown" && b.text === "No message yet. Be the first to sign!"));
  for (const segments of [["x"], ["page"], ["page", "x"], ["page", "0"], ["page", "2"], ["page", "1", "extra"], ["page", "-1"]]) {
    assert.equal((await def.page(ctx, { segments })).notFound, true, segments.join("/"));
  }
});

test("page : pagination par chemin (/guestbook/page/2), liens précédent/suivant, page 1 sans suffixe", async () => {
  const ctx = ctxFor({ perPage: 2 });
  for (let i = 1; i <= 5; i++) await seed(ctx, { name: `N${i}`, message: `M${i}`, status: "approved" });
  const p1 = await def.page(ctx, { segments: [] });
  assert.deepEqual(p1.blocks.find((b) => b.type === "links").items.map((l) => l.href), ["/guestbook/page/2"]);
  const p2 = await def.page(ctx, { segments: ["page", "2"] });
  assert.deepEqual(p2.blocks.find((b) => b.type === "links").items.map((l) => l.href), ["/guestbook", "/guestbook/page/3"]);
  const p3 = await def.page(ctx, { segments: ["page", "3"] });
  assert.deepEqual(p3.blocks.find((b) => b.type === "links").items.map((l) => l.href), ["/guestbook/page/2"]);
  assert.equal(htmlOf(p1.blocks).match(/<article/g).length, 2);
  assert.equal(htmlOf(p3.blocks).match(/<article/g).length, 1);
  // langue non par défaut : les liens gardent le préfixe de langue
  const fr = ctxFor({ perPage: 1 }, { locale: "fr", defaultLocale: "en", locales: ["en", "fr"], messages: loadMessages("fr") });
  await seed(fr, { name: "A", message: "a", status: "approved" });
  await seed(fr, { name: "B", message: "b", status: "approved" });
  assert.equal((await def.page(fr, { segments: [] })).blocks.find((b) => b.type === "links").items[0].href, "/fr/guestbook/page/2");
});

test("sections : « latest » = le dernier message validé, « recent » = count messages ; vides → null", async () => {
  const ctx = ctxFor();
  assert.equal(await def.sections.latest(ctx, {}), null);
  assert.equal(await def.sections.recent(ctx, {}), null);
  await seed(ctx, { name: "Ancien", message: "m1", status: "approved" });
  await seed(ctx, { name: "Attente", message: "m2", status: "pending" });
  await seed(ctx, { name: "Récent", message: "m3", status: "approved" });
  const latest = htmlOf(await def.sections.latest(ctx, {}));
  assert.ok(latest.includes("Récent") && !latest.includes("Ancien") && !latest.includes("Attente"));
  const count = async (n) => (htmlOf(await def.sections.recent(ctx, { count: n })).match(/<article/g) ?? []).length;
  assert.equal(await count(1), 1);
  assert.equal(await count(undefined), 2);
  assert.equal(await count(0), 1); // borné à 1 au minimum
  assert.equal(await count(500), 2); // borné à 10 au maximum
  assert.equal(await count("abc"), 2);
  assert.ok((await def.sections.latest(ctx, {})).some((b) => b.type === "links" && b.items[0].href === "/guestbook"));
});

test("slot layout.footer : lien seulement si l'option est cochée et la page montée", () => {
  assert.equal(def.slots["layout.footer"](ctxFor()), null);
  assert.deepEqual(def.slots["layout.footer"](ctxFor({ footerLink: true })), [{ type: "links", items: [{ label: "Guestbook", href: "/guestbook" }] }]);
  assert.equal(def.slots["layout.footer"](ctxFor({ footerLink: true }, { basePath: null })), null);
});

// ── Sujets : flux RSS et sujet propre ───────────────────────────────────────────────────────────────────────────

test("feed.item : conforme au schéma du flux RSS du cœur, rubrique partagée, messages validés seulement", async () => {
  const ctx = ctxFor();
  await seed(ctx, { name: "Ada <b>", message: "Super site ".repeat(60), status: "approved" });
  await seed(ctx, { name: "Bob", message: "En attente", status: "pending" });
  const items = await def.exports["feed.item"](ctx, { locale: "en", limit: 30, tags: [] });
  assert.equal(items.length, 1);
  const item = conform(items[0], FEED_ITEM_SCHEMA);
  assert.ok(item, "rejeté par le schéma du cœur");
  assert.deepEqual(item.topics, ["guestbook"]);
  assert.equal(item.title, "Message from Ada <b>"); // le cœur échappe le XML : le module n'échappe pas le texte brut d'un flux
  assert.equal(item.url, "/guestbook");
  assert.ok(item.summary.length <= 280);
  assert.ok(!Number.isNaN(new Date(item.publishedAt).getTime()));
  assert.ok(item.id.startsWith("guestbook:"));
  assert.equal((await def.exports["feed.item"](ctx, { limit: 0 })).length, 0);
  assert.deepEqual(await def.exports["feed.item"](ctxFor({}, { basePath: null }), { limit: 5 }), []);
});

test("guestbook.message : format documenté, messages validés seulement, limite respectée", async () => {
  const ctx = ctxFor();
  for (let i = 0; i < 4; i++) await seed(ctx, { name: `N${i}`, message: `M${i}`, status: "approved" });
  await seed(ctx, { name: "X", message: "pending", status: "pending" });
  const items = await def.exports["guestbook.message"](ctx, { locale: "en", limit: 3, tags: [] });
  assert.equal(items.length, 3);
  assert.deepEqual(Object.keys(items[0]).sort(), ["id", "name", "publishedAt", "text"]);
  const schema = [{ key: "id", type: "string" }, { key: "name", type: "string", required: true }, { key: "text", type: "string", required: true }, { key: "publishedAt", type: "string" }];
  for (const i of items) assert.ok(conform(i, schema));
  assert.ok(items.every((i) => i.name !== "X"));
});

test("un message en attente n'apparaît nulle part avant d'être validé (page, sections, sujets, flux)", async () => {
  const ctx = ctxFor();
  await sign(ctx, { name: "Visiteur", message: "Message en attente" });
  const everything = JSON.stringify([await def.page(ctx, { segments: [] }), await def.sections.latest(ctx, {}), await def.sections.recent(ctx, {}), await def.exports["feed.item"](ctx, {}), await def.exports["guestbook.message"](ctx, {})]);
  assert.ok(!everything.includes("Message en attente"));
  const [row] = await ctx.api.store.list("messages");
  await def.adminActions.approve(ctx, { id: row.id });
  assert.ok(JSON.stringify(await def.exports["feed.item"](ctx, {})).includes("Visiteur"));
});

// ── Administration ──────────────────────────────────────────────────────────────────────────────────────────────

test("adminPanel : tableau avec identifiants, actions de ligne, compteur d'attente ; ?edit= ouvre le formulaire", async () => {
  const ctx = ctxFor();
  const a = await seed(ctx, { name: "Ada", message: "Salut", status: "approved" });
  const b = await seed(ctx, { name: "Bob", message: "Hello", status: "pending" });
  const blocks = await def.adminPanel(ctx, { query: {} });
  assert.equal(blocks[0].text, "Messages (2, 1 waiting for approval)");
  const table = blocks.find((x) => x.type === "table");
  assert.deepEqual(table.rowIds.sort(), [a, b].sort());
  assert.equal(table.rows.length, 2);
  assert.deepEqual(table.rowActions.map((r) => r.action ?? r.href), ["approve", "?edit={id}", "remove"]);
  assert.equal(table.rowActions.find((r) => r.action === "remove").danger, true);
  assert.ok(table.rowActions.find((r) => r.action === "remove").confirm);
  assert.ok(!blocks.some((x) => x.type === "adminForm"));
  const edit = await def.adminPanel(ctx, { query: { edit: b } });
  const form = edit.find((x) => x.type === "adminForm");
  assert.equal(form.action, "edit");
  assert.equal(form.cancelHref, "?");
  assert.deepEqual(form.fields.map((f) => [f.name, f.kind, f.value]), [["id", "hidden", b], ["name", undefined, "Bob"], ["message", "textarea", "Hello"]]);
  assert.ok(!(await def.adminPanel(ctx, { query: { edit: "inconnu" } })).some((x) => x.type === "adminForm"));
});

test("adminActions : valider, modifier (avec redirection), supprimer ; erreurs lisibles", async () => {
  const ctx = ctxFor();
  const id = await seed(ctx, { name: "Ada", message: "Salut", status: "pending", extra: 1 });
  assert.deepEqual(await def.adminActions.approve(ctx, { id }), { ok: "Message approved." });
  assert.deepEqual((await ctx.api.store.get(id)).data, { name: "Ada", message: "Salut", status: "approved", extra: 1 });
  assert.deepEqual(await def.adminActions.edit(ctx, { id, name: " Ada L. ", message: "Nouveau  texte" }), { ok: "Message saved.", redirect: "?" });
  assert.deepEqual((await ctx.api.store.get(id)).data, { name: "Ada L.", message: "Nouveau  texte", status: "approved", extra: 1 });
  assert.deepEqual(await def.adminActions.edit(ctx, { id, name: "", message: "x" }), { error: "The name and the message are required." });
  assert.deepEqual(await def.adminActions.edit(ctx, { id: "nope", name: "a", message: "b" }), { error: "Message not found." });
  assert.deepEqual(await def.adminActions.approve(ctx, {}), { error: "Message not found." });
  assert.deepEqual(await def.adminActions.approve(ctx, { id: "nope" }), { error: "Message not found." });
  assert.deepEqual(await def.adminActions.remove(ctx, { id }), { ok: "Message deleted." });
  assert.equal(await ctx.api.store.get(id), null);
  assert.deepEqual(await def.adminActions.remove(ctx, {}), { error: "Message not found." });
});

// ── MCP ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const decl = (name) => manifestJson.mcp.find((a) => a.name === name);

test("MCP : les schémas d'entrée sont acceptés par le validateur du cœur", () => {
  assert.deepEqual(validateArgs(decl("guestbook_list").input, { status: "pending", limit: 5 }), { status: "pending", limit: 5 });
  assert.throws(() => validateArgs(decl("guestbook_list").input, { status: "weird" }));
  assert.throws(() => validateArgs(decl("guestbook_list").input, { limit: 0 }));
  assert.throws(() => validateArgs(decl("guestbook_list").input, { limit: 101 }));
  assert.throws(() => validateArgs(decl("guestbook_list").input, { other: 1 }));
  assert.throws(() => validateArgs(decl("guestbook_approve").input, {}));
  assert.throws(() => validateArgs(decl("guestbook_delete").input, { id: "x".repeat(101) }));
});

test("MCP guestbook_list : filtre par statut, limite, tri récent d'abord", async () => {
  const ctx = ctxFor();
  await seed(ctx, { name: "A", message: "a", status: "approved" });
  await seed(ctx, { name: "B", message: "b", status: "pending" });
  await seed(ctx, { name: "C", message: "c", status: "approved" });
  const names = async (args) => (await def.mcp.guestbook_list(ctx, args, { name: "t" })).map((m) => m.name);
  assert.deepEqual(await names({}), ["C", "B", "A"]);
  assert.deepEqual(await names({ status: "pending" }), ["B"]);
  assert.deepEqual(await names({ status: "approved" }), ["C", "A"]);
  assert.deepEqual(await names({ status: "all", limit: 2 }), ["C", "B"]);
  assert.deepEqual(await names(undefined), ["C", "B", "A"]);
  const [first] = await def.mcp.guestbook_list(ctx, { limit: 1 }, { name: "t" });
  assert.deepEqual(Object.keys(first).sort(), ["createdAt", "id", "message", "name", "status"]);
  assert.ok(!Number.isNaN(new Date(first.createdAt).getTime()));
});

test("MCP guestbook_approve : valide, garde le nom du jeton ; identifiant inconnu ou absent → erreur exposable", async () => {
  const ctx = ctxFor();
  const id = await seed(ctx, { name: "A", message: "a", status: "pending" });
  assert.deepEqual(await def.mcp.guestbook_approve(ctx, { id }, { name: "assistant" }), { id, status: "approved" });
  assert.deepEqual((await ctx.api.store.get(id)).data, { name: "A", message: "a", status: "approved", moderatedBy: "assistant" });
  for (const args of [{ id: "nope" }, {}, { id: "" }, { id: 42 }, undefined]) {
    await assert.rejects(def.mcp.guestbook_approve(ctx, args, { name: "t" }), (e) => e.expose === true && /not found/.test(e.message));
  }
});

test("MCP guestbook_delete : supprime pour de bon ; inconnu → erreur exposable", async () => {
  const ctx = ctxFor();
  const id = await seed(ctx, { name: "A", message: "a", status: "approved" });
  assert.deepEqual(await def.mcp.guestbook_delete(ctx, { id }, { name: "t" }), { id, deleted: true });
  assert.equal(await ctx.api.store.count("messages"), 0);
  await assert.rejects(def.mcp.guestbook_delete(ctx, { id }, { name: "t" }), (e) => e.expose === true);
  await assert.rejects(def.mcp.guestbook_delete(ctx, {}, { name: "t" }), (e) => e.expose === true);
});

// ── Sauvegarde lisible ──────────────────────────────────────────────────────────────────────────────────────────

/** Mini lecteur CSV (RFC 4180) pour relire ce que le module écrit. */
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\r") { /* ignoré, suivi de \n */ }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  return rows;
}

test("backup.readable : CSV avec en-tête, tous les messages (attente comprise), guillemets et sauts de ligne protégés", async () => {
  const ctx = ctxFor();
  await seed(ctx, { name: 'Ada "la" Comtesse', message: "ligne 1\nligne 2, avec virgule", status: "approved" });
  await seed(ctx, { name: "Bob", message: "en attente", status: "pending" });
  const files = await def.backup.readable(ctx);
  assert.equal(files.length, 1);
  assert.equal(files[0].path, "messages.csv");
  assert.ok(files[0].content.startsWith("﻿"));
  const rows = parseCsv(files[0].content.slice(1));
  assert.deepEqual(rows[0], ["id", "date", "status", "name", "message"]);
  assert.equal(rows.length, 3);
  const byName = Object.fromEntries(rows.slice(1).map((r) => [r[3], r]));
  assert.equal(byName['Ada "la" Comtesse'][4], "ligne 1\nligne 2, avec virgule");
  assert.equal(byName['Ada "la" Comtesse'][2], "approved");
  assert.equal(byName.Bob[2], "pending");
  assert.ok(!Number.isNaN(new Date(byName.Bob[1]).getTime()));
});

test("backup.readable : une cellule qui commence par = + - @ est neutralisée (injection de formule)", async () => {
  const ctx = ctxFor();
  for (const bad of ["=cmd|' /C calc'!A0", "+1+1", "-2+3", "@SUM(1)"]) await seed(ctx, { name: bad, message: bad, status: "approved" });
  const rows = parseCsv((await def.backup.readable(ctx))[0].content.slice(1)).slice(1);
  assert.equal(rows.length, 4);
  for (const r of rows) {
    assert.ok(r[3].startsWith("'"), r[3]);
    assert.ok(r[4].startsWith("'"), r[4]);
  }
  // un texte normal n'est pas modifié
  const ok = ctxFor();
  await seed(ok, { name: "Ada", message: "a - b = c", status: "approved" });
  assert.equal(parseCsv((await def.backup.readable(ok))[0].content.slice(1))[1][4], "a - b = c");
});

test("backup.readable : sans message, le CSV ne contient que l'en-tête", async () => {
  const rows = parseCsv((await def.backup.readable(ctxFor()))[0].content.slice(1));
  assert.deepEqual(rows, [["id", "date", "status", "name", "message"]]);
});

// ── Crochets ────────────────────────────────────────────────────────────────────────────────────────────────────

test("hooks.onInstanceCreate : message de bienvenue, idempotent", async () => {
  const ctx = ctxFor();
  await def.hooks.onInstanceCreate(ctx);
  await def.hooks.onInstanceCreate(ctx);
  const rows = await ctx.api.store.list("messages");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].data.status, "approved");
  assert.equal(rows[0].data.name, "Demo");
});

test("hooks.onInstanceDelete : le limiteur oublie l'instance supprimée (et seulement elle)", async () => {
  const a = ctxFor({ rateLimit: 1 }), b = ctxFor({ rateLimit: 1 });
  const ok = { name: "Ada", message: "Salut" };
  assert.equal((await sign(a, ok, "192.0.2.50")).status, 200);
  assert.equal((await sign(a, ok, "192.0.2.50")).status, 429);
  assert.equal((await sign(b, ok, "192.0.2.50")).status, 200);
  await def.hooks.onInstanceDelete(a);
  assert.equal((await sign(a, ok, "192.0.2.50")).status, 200, "compteur de a remis à zéro");
  assert.equal((await sign(b, ok, "192.0.2.50")).status, 429, "compteur de b conservé");
});

test("indépendance : le module n'importe rien (ni du cœur, ni de Node)", () => {
  assert.ok(!/^\s*import\s/m.test(source), "import statique");
  assert.ok(!/\bimport\(|require\(|eval\(|new Function/.test(source));
  assert.ok(!/process\.env|console\.log/.test(source));
});
