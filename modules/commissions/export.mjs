// Commandes — export CSV (téléchargement d'administration, au fil de l'eau : 500 commandes à la fois) et sauvegarde lisible.
// Une cellule qui commencerait par = + - @ serait lue comme une formule par un tableur : on la précède d'une apostrophe.
const v = new URL(import.meta.url).search;
const L = await import(`./lib.mjs${v}`);
const D = await import(`./data.mjs${v}`);
const B = await import(`./book.mjs${v}`);
const { idOk } = L;

export const cell = (value) => { let s = String(value ?? "").replace(/\r?\n/g, " "); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
const header = (ctx) => String(ctx.t("csvHeader")).split("|").map(cell).join(",");
const line = (ctx, o, email) => [
  o.id, o.at.toISOString().slice(0, 10), ctx.t(`status_${o.status}`), new Date(D.lastChange(o)).toISOString().slice(0, 10), o.nick, email, o.formulaName, o.want, o.inspiration,
  o.contactId ? ctx.t("yes") : ctx.t("no"), o.clientNote, o.privateNote,
].map(cell).join(",");

/** Les adresses des fiches du carnet pour une page de commandes (cent fiches par appel, attente bornée). Sans carnet : vide. */
async function emailsFor(ctx, orders) {
  const ids = [...new Set(orders.filter((o) => !o.email && idOk(o.contactId)).map((o) => o.contactId))];
  const out = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const r = await B.call(ctx, "resolve", { ids: ids.slice(i, i + 100) });
    if (r.ok && Array.isArray(r.contacts)) for (const c of r.contacts) if (idOk(c?.id) && typeof c.email === "string") out.set(c.id, c.email.slice(0, 200));
  }
  return out;
}

export const downloads = {
  orders: {
    right: "export",
    contentType: "text/csv",
    filename: (ctx) => ctx.t("csvName"),
    async *generate(ctx) {
      yield `﻿${header(ctx)}\r\n`;
      let cursor = null;
      do {
        const page = await ctx.api.store.page(D.ORDERS, { limit: 500, cursor, order: "asc" });
        const orders = page.items.map(D.normOrder);
        const emails = await emailsFor(ctx, orders);
        for (const o of orders) yield `${line(ctx, o, o.email || emails.get(o.contactId) || "")}\r\n`;
        cursor = page.next;
      } while (cursor);
    },
  },
};

/** Sauvegarde lisible sans le framework : les commandes et les formules en CSV (les adresses d'une fiche du carnet restent dans le carnet). */
export async function readable(ctx) {
  const orders = (await D.listOrders(ctx)).reverse();
  const formulas = await D.listFormulas(ctx);
  const fh = [ctx.t("colName"), ctx.t("price"), ctx.t("delay"), ctx.t("colShown"), ctx.t("fFormulaIncludes")].map(cell).join(",");
  return [
    { path: "orders.csv", content: `﻿${[header(ctx), ...orders.map((o) => line(ctx, o, o.email))].join("\r\n")}\r\n` },
    { path: "formulas.csv", content: `﻿${[fh, ...formulas.map((f) => [f.name, f.price, f.delay, f.visible ? ctx.t("yes") : ctx.t("no"), f.includes].map(cell).join(","))].join("\r\n")}\r\n` },
  ];
}
