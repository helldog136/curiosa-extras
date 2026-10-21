// Le double en mémoire de « contact.book » v2 (tests/helpers/fakeContactBook.mjs) respecte le contrat : même suite que le vrai module Contacts 2.0,
// plus ce que le double offre aux tests des modules consommateurs (branchement dans fakeCtx, pannes injectées, aides de préparation).
import test from "node:test";
import assert from "node:assert/strict";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { fakeContactBook, fakePrivacySubject, normalizeAccount, pickPhoto, privacyReplyProblems, METHODS, READ_ONLY } from "./helpers/fakeContactBook.mjs";
import { runContactBookContract, METHODS as CONTRACT_METHODS, READ_ONLY as CONTRACT_READ_ONLY } from "./contract/contactBook.contract.mjs";
import { runPrivacySubjectContract } from "./contract/privacySubject.contract.mjs";

runContactBookContract(({ rights, privacySubjects, privacyTimeoutMs, maxContacts }) => {
  const book = fakeContactBook({ rights, privacySubjects, privacyTimeoutMs, maxContacts });
  return { methods: book.methods, admin: book.admin, supports: { maxContacts: true } };
}, { prefix: "double contact.book v2" });

runPrivacySubjectContract(() => {
  const sub = fakePrivacySubject("consumer");
  return { methods: sub.methods, addReference: async (id) => sub.refs.set(id, (sub.refs.get(id) ?? 0) + 1), countReferences: async (id) => sub.refs.get(id) ?? 0 };
}, { prefix: "double privacy.subject" });

test("le double et la suite parlent des mêmes méthodes", () => {
  assert.deepEqual(METHODS, CONTRACT_METHODS);
  assert.deepEqual(READ_ONLY, CONTRACT_READ_ONLY);
  assert.ok(READ_ONLY.length <= 20, "readOnly : 20 noms au plus dans le manifeste");
});

test("branché dans fakeCtx : un consommateur lit le carnet par ctx.api.services.call, avec les aides de préparation", async () => {
  const book = fakeContactBook();
  const cat = book.seedCategory("Raid targets");
  assert.equal(book.seedCategory("RAID TARGETS"), cat, "seedCategory ne crée pas de doublon");
  const { id } = book.seedContact({ name: "Alice", accounts: [{ network: "twitch", handle: "@Alice_TV", displayName: "Alice TV", followers: 10, avatar: "https://cdn.example.test/alice.png" }], categoryIds: [cat] });
  book.seedContact({ name: "Bob", accounts: [{ network: "twitch", handle: "bob_tv" }] });
  const ctx = fakeCtx({ services: book.services });
  const r = await ctx.api.services.call("contact.book", "accounts", { network: "twitch", categoryId: cat });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.items.map((x) => [x.id, x.handle, x.displayName, x.avatar]), [[id, "alice_tv", "Alice TV", "https://cdn.example.test/alice.png"]]);
  assert.deepEqual(book.calls.at(-1), ["contact.book", "accounts", { network: "twitch", categoryId: cat }]);
  assert.throws(() => book.seedContact({ name: "Copy", accounts: [{ network: "twitch", handle: "alice_tv" }] }), /déjà porté/);
  const form = await ctx.api.services.call("contact.store", "add", { name: "Visitor", email: "visitor@example.test", message: "Hello" });
  assert.equal(form.value.created, true);
  assert.equal((await book.methods.get({ id: form.value.id })).contact.status, "to_review");
});

test("pannes injectées : « throw » devient failed côté cœur ; « hang » ne répond jamais (testez votre attente bornée)", async () => {
  const book = fakeContactBook();
  const ctx = fakeCtx({ services: book.services });
  book.faults.throw.add("search");
  assert.deepEqual(await ctx.api.services.call("contact.book", "search", { q: "x" }), { ok: false, reason: "failed" });
  book.faults.hang.add("accounts");
  const winner = await Promise.race([ctx.api.services.call("contact.book", "accounts", { network: "twitch" }).then(() => "answered"), new Promise((r) => setTimeout(() => r("timeout"), 50))]);
  assert.equal(winner, "timeout");
  book.faults.hang.clear();
  assert.equal((await ctx.api.services.call("contact.book", "accounts", { network: "twitch" })).value.ok, true);
});

test("droits : un appel de service ordinaire ne crée pas de catégorie (cœur 0.2.0) ; asViewer simule le « create » d'un choice", async () => {
  const book = fakeContactBook();
  assert.deepEqual(await book.methods.createCategory({ label: "Raid targets" }), { ok: false, error: "denied" });
  const r = await book.asViewer(["categories.create"]).createCategory({ label: "Raid targets" });
  assert.equal(r.ok, true);
  book.rights = ["categories.create"];
  assert.equal((await book.methods.createCategory({ label: "raid TARGETS" })).error, "duplicate");
});

test("normalizeAccount : réseaux inconnus et formes limites", () => {
  assert.deepEqual(normalizeAccount("myspace", "x"), { error: "invalid_network" });
  assert.equal(normalizeAccount("discord", "https://discord.gg/AbC123").handle, "invite/AbC123");
  assert.equal(normalizeAccount("bluesky", "did:plc:abcdefghijklmnopqrstuvwx").handle, "did:plc:abcdefghijklmnopqrstuvwx");
  assert.equal(normalizeAccount("web", "https://example.test/").handle, "example.test");
  assert.equal(normalizeAccount("web", "https://user:pw@example.test/").error, "invalid_handle");
  assert.equal(normalizeAccount("twitch", 42).error, "invalid_handle");
});

test("pickPhoto (règle pure) : manuelle, plus grosse communauté, puis Twitch > YouTube > Bluesky > autres", () => {
  const a = (id, network, extra = {}) => ({ id, network, avatar: `https://cdn.example.test/${id}.png`, ...extra });
  assert.equal(pickPhoto({ accounts: [] }), null);
  assert.equal(pickPhoto({ accounts: [{ id: "n", network: "twitch" }] }), null, "un compte sans image ne donne pas de photo");
  assert.equal(pickPhoto({ accounts: [a("i", "instagram"), a("b", "bluesky"), a("y", "youtube")] }).accountId, "y");
  assert.equal(pickPhoto({ accounts: [a("i", "instagram"), a("t", "tiktok")] }).accountId, "t", "hors des trois : ordre du registre");
  assert.equal(pickPhoto({ accounts: [a("t", "twitch"), a("i", "instagram", { followers: 3 })] }).accountId, "i", "un nombre d'abonnés connu l'emporte sur l'ordre");
  assert.equal(pickPhoto({ accounts: [a("t", "twitch", { followers: 5 }), a("y", "youtube", { followers: 5 })] }).accountId, "t", "égalité : ordre de repli");
  assert.deepEqual(pickPhoto({ photo: "https://cdn.example.test/m.png", accounts: [a("t", "twitch", { followers: 9 })] }), { url: "https://cdn.example.test/m.png", source: "manual" });
});

test("privacyReplyProblems : formes refusées", () => {
  assert.deepEqual(privacyReplyProblems("erase", { removed: 1 }), []);
  assert.equal(privacyReplyProblems("erase", { removed: -1 }).length, 1);
  assert.equal(privacyReplyProblems("remap", {}).length, 1);
  assert.equal(privacyReplyProblems("export", { label: "", data: {} }).length, 1);
  assert.equal(privacyReplyProblems("export", { label: "X", data: "x".repeat(1_000_001) }).length, 1);
  assert.equal(privacyReplyProblems("export", null).length, 1);
});
