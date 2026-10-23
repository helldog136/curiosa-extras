// Commandes — les e-mails (facultatifs). Le site sait-il en envoyer ? Alors la cliente reçoit une confirmation (avec son lien de suivi) et un mot à chaque
// changement d'état ; l'équipe reçoit au plus un message par heure quand des demandes attendent. Sinon : rien ne change, tout se voit sur la page de suivi.
//
// Règles pour ne rien laisser échapper :
//  - un message ne contient JAMAIS de note privée, de prix, ni le texte de la demande : seulement un prénom/pseudo, l'état et (à la confirmation) le lien ;
//  - n'importe qui peut taper l'adresse de quelqu'un d'autre dans le formulaire : chaque message le dit et propose d'ignorer ; une même adresse reçoit
//    au plus quelques messages par jour ;
//  - le lien de suivi n'est envoyé qu'UNE fois (il n'est pas gardé en clair) : les messages suivants renvoient à ce premier message ;
//  - l'envoi est « au mieux » : tout est déjà enregistré avant, une panne d'e-mail ne perd rien.
import { readFile } from "node:fs/promises";
const v = new URL(import.meta.url).search;
const L = await import(`./lib.mjs${v}`);
const { LIMITS, DAY, limited, addressKey, pathPrefix } = L;

// Les textes d'un e-mail sont dans la langue de la cliente (celle de sa demande), pas celle de la personne qui clique dans l'administration.
const texts = new Map();
async function table(lang) {
  if (!/^[a-z]{2}(-[A-Za-z]{2})?$/.test(lang)) return {};
  if (!texts.has(lang)) {
    let t = {};
    try { t = JSON.parse(await readFile(new URL(`./locales/${lang}.json`, import.meta.url), "utf8")); } catch { t = {}; }
    texts.set(lang, t && typeof t === "object" ? t : {});
  }
  return texts.get(lang);
}
const fill = (s, vars) => String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
/** Un texte dans la langue demandée (repli : langue du site, puis anglais, puis français). */
export async function say(ctx, lang, key, vars = {}) {
  for (const l of [lang, ctx.defaultLocale, "en", "fr"]) {
    const t = await table(l);
    if (typeof t[key] === "string") return fill(t[key], vars);
  }
  return key;
}
const langOf = (ctx, order) => (order.lang && (ctx.locales ?? []).includes(order.lang) ? order.lang : ctx.defaultLocale || "en");

/** Le site peut-il envoyer des e-mails, et l'équipe l'a-t-elle voulu ? */
export async function enabled(ctx) {
  if (ctx.setting("clientMails") === false) return false;
  try { return !!(await ctx.api.mail?.configured?.()); } catch { return false; }
}
const siteName = async (ctx) => { try { return String((await ctx.api.site?.(ctx.defaultLocale))?.name ?? "").slice(0, 80) || "Site"; } catch { return "Site"; } };

async function send(ctx, message) {
  try {
    const r = await ctx.api.mail.send(message);
    return r?.ok === true ? { ok: true } : { ok: false, reason: String(r?.reason ?? "failed").slice(0, 30) };
  } catch { return { ok: false, reason: "failed" }; }
}

/** Confirmation de la demande, avec le lien de suivi (seul message qui le contient). */
export async function confirmation(ctx, order, address, token) {
  if (!(await enabled(ctx)) || !order.mailOptIn || !address) return { ok: false, reason: "skipped" };
  if (limited(`m|${ctx.instance.key}|${addressKey(address)}`, LIMITS.mailsPerAddressPerDay, DAY)) return { ok: false, reason: "rate_limited" };
  const lang = langOf(ctx, order);
  const url = `${ctx.api.siteUrl}${pathPrefix(ctx, lang)}/suivi/${token}`;
  const vars = { nick: order.nick, site: await siteName(ctx), url };
  return send(ctx, { to: address, subject: await say(ctx, lang, "mailConfirmSubject", vars), text: await say(ctx, lang, "mailConfirmBody", vars) });
}

/** Nouveau lien de suivi (demandé par l'équipe, par exemple quand la cliente a perdu le sien). */
export async function newLink(ctx, order, address, token) {
  if (!(await enabled(ctx)) || !address) return { ok: false, reason: "skipped" };
  if (limited(`m|${ctx.instance.key}|${addressKey(address)}`, LIMITS.mailsPerAddressPerDay, DAY)) return { ok: false, reason: "rate_limited" };
  const lang = langOf(ctx, order);
  const url = `${ctx.api.siteUrl}${pathPrefix(ctx, lang)}/suivi/${token}`;
  const vars = { nick: order.nick, site: await siteName(ctx), url };
  return send(ctx, { to: address, subject: await say(ctx, lang, "mailLinkSubject", vars), text: await say(ctx, lang, "mailLinkBody", vars) });
}

/** « L'état de votre commande a changé » : l'état, rien d'autre. */
export async function statusChanged(ctx, order, status, address) {
  if (!(await enabled(ctx)) || !order.mailOptIn) return { ok: false, reason: "skipped" };
  if (!address) return { ok: false, reason: "no_address" };
  if (limited(`m|${ctx.instance.key}|${addressKey(address)}`, LIMITS.mailsPerAddressPerDay, DAY)) return { ok: false, reason: "rate_limited" };
  const lang = langOf(ctx, order);
  const vars = { nick: order.nick, site: await siteName(ctx), status: await say(ctx, lang, `pub_${status}`) };
  return send(ctx, { to: address, subject: await say(ctx, lang, "mailStatusSubject", vars), text: await say(ctx, lang, "mailStatusBody", vars) });
}

/** Un mot à l'équipe quand une demande arrive : au plus un par heure (le cœur plafonne aussi les envois), jamais le texte de la demande. */
export async function tellTeam(ctx, order, queue, writeQueue) {
  if (ctx.setting("notify") === false) return { ok: false, reason: "skipped" };
  try { if (!(await ctx.api.mail?.configured?.())) return { ok: false, reason: "skipped" }; } catch { return { ok: false, reason: "skipped" }; }
  const now = Date.now();
  if (now - queue.lastOwnerMailAt < LIMITS.ownerMailEveryMs) return { ok: false, reason: "skipped" };
  await writeQueue(ctx, { lastOwnerMailAt: now });
  const vars = { nick: order.nick, formula: order.formulaName || "—", url: `${ctx.api.siteUrl}/admin/instances/${ctx.instance.id}` };
  return send(ctx, { to: "owner", subject: ctx.t("mailTeamSubject", vars), text: ctx.t("mailTeamBody", vars) });
}
