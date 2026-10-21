// Contacts — les fichiers que le cœur sert à la personne connectée (`adminDownloads`) : tout le carnet, le modèle d'import, les lignes à corriger, et
// « tout ce que le site sait d'une personne ». Chacun est un générateur qui rend le texte morceau par morceau (voir export.mjs, privacy.mjs).
const v = new URL(import.meta.url).search;
const B = await import(`./book.mjs${v}`);
const D = await import(`./data.mjs${v}`);
const C = await import(`./csv.mjs${v}`);
const E = await import(`./export.mjs${v}`);
const I = await import(`./import.mjs${v}`);
const P = await import(`./privacy.mjs${v}`);
const { describeError } = await import(`./messages.mjs${v}`);

const lang = (ctx) => (String(ctx.locale ?? "").startsWith("fr") ? "fr" : "en");

async function* importReport(ctx) {
  const locale = lang(ctx), delimiter = C.exportDelimiter(locale), labels = E.exportLabels(ctx);
  const job = await I.getJob(ctx);
  yield "﻿" + C.line([ctx.t("reportColumn"), ...C.headerLabels(locale)], delimiter);
  if (!job) return;
  const map = job.data.map ?? {};
  for await (const e of I.errorEntries(ctx)) {
    let cells;
    if (e.input) {
      const i = e.input;
      cells = C.cardCells({ data: { kind: i.kind, name: i.name, role: i.role, orgName: i.organisation, email: i.email, phone: i.phone, accounts: i.accounts, status: i.status, relation: i.relation, others: i.others, photo: i.photo, source: i.source }, id: i.id ?? "", categoryNames: i.categories ?? [], notes: i.notes ?? [], withContact: true, labels });
    } else cells = C.COLUMNS.map((col) => (map[col.key] === undefined ? "" : e.raw?.[map[col.key]] ?? ""));
    yield C.line([describeError(ctx, e), ...cells], delimiter);
  }
}

export default {
  contacts: {
    right: B.RIGHT_EXPORT, contentType: "text/csv",
    filename: (ctx) => `${ctx.t("exportFile")}-${E.today()}`,
    generate: (ctx) => E.exportCsv(ctx),
  },
  template: { contentType: "text/csv", filename: (ctx) => ctx.t("templateFile"), generate: (ctx) => E.templateCsv(ctx) },
  importReport: { contentType: "text/csv", filename: (ctx) => `${ctx.t("reportFile")}-${E.today()}`, generate: (ctx) => importReport(ctx) },
  person: {
    right: B.RIGHT_EXPORT, contentType: "application/json",
    filename: (ctx) => `${ctx.t("personFile")}-${E.today()}`,
    generate: (ctx, params) => (D.idOk(params?.id) ? P.exportPerson(ctx, params.id, { withContact: B.can(ctx, B.RIGHT_EMAIL_VIEW) }) : (async function* () { yield JSON.stringify({ error: "not_found" }); })()),
  },
};
