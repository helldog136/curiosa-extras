// Contacts — the people who log in to the site, as cards.
//
// The core tells the module who has an account through the optional topic `core.user` (core 0.47.0; `id`, `name`, `email`, `level`, `roles`, dates: never a
// secret, see docs/MODULES.md of the core). Each account has ONE linked card (`data.account`, found again through the account id: the index key `l`).
// The sync is a PULL, idempotent, run when the Contacts administration opens and every few minutes (`tasks.accounts`); nothing is pushed by the core.
//
//   new account, no card with its e-mail            → a card is created (name, e-mail, link; source « account »)
//   new account, ONE person card with its e-mail    → that card is LINKED (only the link is added: nothing else of the card changes)
//   new account, several cards / an organisation / a card of another account with its e-mail
//                                                   → a card is created and flagged « to check »: the owner merges (the duplicates page finds them: same e-mail)
//   linked account changed                          → name and e-mail of the card follow the account WHEN THE ACCOUNT CHANGES (the owner's own edits stay until then)
//   account deleted                                 → the card stays, unlinked (`accountGone`), with a dated note. Never done on an empty or cut list.
//   older core (no topic)                           → the answer is empty: nothing at all is done, in particular nothing is unlinked.
//
// A linked card cannot be deleted (book.mjs: `account_linked`). The card's own « function » is never written: the account role is shown as a badge.
const v = new URL(import.meta.url).search; // the module version is passed on to the neighbouring files (otherwise the old code would stay cached after an update)
const { clean } = await import(`./networks.mjs${v}`);
const D = await import(`./data.mjs${v}`);
const B = await import(`./book.mjs${v}`);

export const TOPIC = "core.user";
export const LIMIT = 200;                // the most the core gives in one read: a list this long may be cut, so nobody is unlinked from it
export const LEVELS = ["owner", "coordinator", "admin", "editor", "none"];
export const READ_MS = 8000;             // the wait for the core's answer
export const THROTTLE_MS = 15_000;       // the administration opening does not read the core more often than this
const MAX_ROLES = 10;

const STATE = new Map();                 // instance id → { at, running }
const stateOf = (ctx) => { const k = ctx.instance?.id ?? "?"; if (!STATE.has(k)) STATE.set(k, { at: 0, running: null }); return STATE.get(k); };
/** Forget what the sync remembers (tests). */
export const resetSync = () => STATE.clear();

/** The accounts as the sync trusts them: every field checked and cut again (never trust another side), one per account id. */
export function cleanAccounts(raw) {
  const out = [], seen = new Set();
  for (const x of Array.isArray(raw) ? raw : []) {
    if (!x || typeof x !== "object" || !D.idOk(x.id) || seen.has(x.id)) continue;
    const email = clean(x.email, D.FIELDS.email).toLowerCase();
    const name = clean(x.name, D.FIELDS.name) || clean(email.split("@")[0], D.FIELDS.name);
    if (!name) continue;
    const roles = (Array.isArray(x.roles) ? x.roles : []).map((r) => (typeof r === "string" ? clean(r, 60) : "")).filter(Boolean).slice(0, MAX_ROLES);
    seen.add(x.id);
    out.push({ id: x.id, name, email: D.validEmail(email) ? email : "", level: LEVELS.includes(x.level) ? x.level : "none", roles });
  }
  return out;
}

/**
 * What the core says. `state`: `ok` (a list), `unsupported` (an older core, or nothing usable: the answer is EMPTY and says nothing about the accounts) or `error`.
 * `complete`: the list is not cut (shorter than the limit), so an account missing from it really is gone.
 */
export async function readAccounts(ctx) {
  if (typeof ctx.api?.topics?.collect !== "function") return { state: "unsupported", accounts: [], complete: false };
  let raw;
  try { raw = await D.within(ctx.api.topics.collect(TOPIC, { limit: LIMIT }), READ_MS, "core.user"); } catch { return { state: "error", accounts: [], complete: false }; }
  const accounts = cleanAccounts(raw);
  if (!accounts.length) return { state: "unsupported", accounts: [], complete: false };
  return { state: "ok", accounts, complete: Array.isArray(raw) && raw.length < LIMIT };
}

const sameList = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);
const linkOf = (a, now) => ({ id: a.id, name: a.name, email: a.email, level: a.level, roles: a.roles, at: now });

/** Cards (people or organisations) that carry this e-mail, from the store key (not unique: older data may have two). Only cards the index knows. */
async function cardsWithEmail(ctx, idx, email) {
  const key = D.emailKey(email);
  const found = new Map();
  for (const collection of D.CARD_COLLECTIONS) {
    const page = await D.listByKey(ctx, collection, key, { limit: 5 });
    for (const r of page.items ?? []) if (idx.byId.has(r.id) && D.isContactData(r.data)) found.set(r.id, r);
  }
  return [...found.values()];
}

/** A linked card whose account changed: name and e-mail follow the account (only what changed since the last sync), the badge follows level and roles. */
async function refresh(ctx, idx, a, cardId, sum) {
  const rec = await D.readContact(ctx, cardId);
  const link = rec ? D.accountLinkOf(rec.data) : null;
  if (!rec || !link) return false;
  const data = { ...rec.data }, next = { ...link };
  let changed = false, flagged = false;
  if (a.name !== link.name) { data.name = a.name; next.name = a.name; changed = true; }
  if (a.email !== link.email && a.email) {
    const other = await B.byEmail(ctx, idx, a.email);
    if (other && other.id !== rec.id) {
      // Another card already has the new e-mail: the card keeps its own, and the owner is asked to merge (once: the flag is remembered).
      if (next.flag !== "email_shared") { next.flag = "email_shared"; if (data.status !== "to_review") data.status = "to_review"; flagged = true; changed = true; }
    } else { data.email = a.email; next.email = a.email; delete next.flag; changed = true; }
  } else if (a.email !== link.email) { next.email = ""; changed = true; }
  if (a.level !== link.level || !sameList(a.roles, link.roles)) { next.level = a.level; next.roles = a.roles; changed = true; }
  if (!changed) return false;
  data.account = next;
  await B.save(ctx, idx, rec, data);
  if (flagged) { await B.addNoteTo(ctx, rec.id, ctx.t("accSharedNote"), "accounts"); sum.flagged++; }
  sum.updated++;
  return true;
}

/** The account is gone: the card stays, no longer linked, with a note that says so. */
async function unlink(ctx, idx, cardId, now, sum) {
  const rec = await D.readContact(ctx, cardId);
  if (!rec || !D.accountLinkOf(rec.data)) return;
  const data = { ...rec.data, accountGone: now };
  delete data.account;
  await B.save(ctx, idx, rec, data);
  await B.addNoteTo(ctx, rec.id, ctx.t("accGoneNote"), "accounts");
  sum.unlinked++;
}

/** A new account: link the one card that has its e-mail, or create a card (flagged when the e-mail is ambiguous). */
async function adopt(ctx, idx, a, now, sum) {
  const cards = a.email ? await cardsWithEmail(ctx, idx, a.email) : [];
  const [only] = cards;
  if (cards.length === 1 && D.kindOf(only.data) === "person" && !D.accountLinkOf(only.data)) {
    const data = { ...only.data, account: linkOf(a, now) };
    delete data.accountGone;
    await B.save(ctx, idx, only, data);
    sum.linked++;
    return;
  }
  if (B.isFull(ctx, idx)) { sum.skipped++; return; }
  const shared = cards.length > 0;
  const data = { ...B.blankContact({ kind: "person", name: a.name, status: shared ? "to_review" : "active", source: "account" }), email: a.email, account: { ...linkOf(a, now), ...(shared ? { flag: "email_shared" } : {}) } };
  const rec = await B.insert(ctx, idx, data);
  if (shared) { await B.addNoteTo(ctx, rec.id, ctx.t("accSharedNote"), "accounts"); sum.flagged++; }
  sum.created++;
}

/**
 * Brings the cards in line with the accounts. Safe to call as often as wanted: without a change it writes nothing (so it does not move the write stamp of the
 * address book). Never throws except `busy` (index or store unreachable in time). `force`: ignore the throttle (the task). Returns `{ state, created, linked,
 * updated, unlinked, flagged, skipped }`; `state` is `ok`, `unsupported`, `error` or `recent` (read a moment ago).
 */
export function syncAccounts(ctx, { force = false, now = Date.now() } = {}) {
  const st = stateOf(ctx);
  if (st.running) return st.running;
  if (!force && now - st.at < THROTTLE_MS) return Promise.resolve({ state: "recent" });
  st.at = now;
  st.running = run(ctx).finally(() => { st.running = null; });
  return st.running;
}

async function run(ctx) {
  const { state, accounts, complete } = await readAccounts(ctx);
  if (state !== "ok") return { state };
  const stamp = new Date().toISOString();
  const sum = { state: "ok", created: 0, linked: 0, updated: 0, unlinked: 0, flagged: 0, skipped: 0 };
  await D.withLock(ctx, async () => {
    const idx = await D.getIndex(ctx);
    const seen = new Set(accounts.map((a) => a.id));
    const fresh = [];
    for (const a of accounts) {
      const cardId = idx.byLink.get(a.id);
      if (cardId) await refresh(ctx, idx, a, cardId, sum); else fresh.push(a);
    }
    if (complete) for (const [accountId, cardId] of [...idx.byLink]) if (!seen.has(accountId)) await unlink(ctx, idx, cardId, stamp, sum);
    for (const a of fresh) await adopt(ctx, idx, a, stamp, sum);
    // `ok: false` only tells `withLock` that nothing was written (it then leaves the write stamp alone); it is not a failure.
    return sum.created + sum.linked + sum.updated + sum.unlinked + sum.flagged ? { ok: true } : { ok: false, unchanged: true };
  });
  return sum;
}

/** The level shown on the badge: the predefined level in the language of the administration, or (for an account with only custom roles) the first role name. */
export function levelLabel(ctx, link) {
  if (link.level && link.level !== "none") return ctx.t(`accLevel_${link.level}`);
  return link.roles?.[0] || ctx.t("accLevel_none");
}
