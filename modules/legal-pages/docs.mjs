// Fabrique les trois textes (Mentions légales, Confidentialité, Cookies) à partir des réponses, dans une langue donnée.
//
// Règles de ce fichier :
//  - un texte n'affirme que ce que les réponses (ou le site) disent ; une réponse absente ne devient jamais une phrase inventée ;
//  - en mode « preview » (l'aperçu de l'administration), un manque est écrit en clair et en gras : « ⚠ À compléter : … » ;
//  - en mode « final » (ce qui est publié), un manque est une ERREUR : on ne publie jamais un texte à trous ;
//  - tout ce que la personne a tapé passe par esc() : ce sont des données, jamais du Markdown.
// Les phrases sont dans locales/fr.json et locales/en.json (clés `doc.*`), lues ici directement parce qu'on fabrique les DEUX langues à la fois.

import fs from "node:fs";
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { isRequired } = await import(`./answers.mjs${v}`);

const dictionaries = new Map();
function dictionary(lang) {
  if (!dictionaries.has(lang)) {
    let loaded = {};
    try { loaded = JSON.parse(fs.readFileSync(new URL(`./locales/${lang}.json`, import.meta.url), "utf8")); } catch { loaded = {}; }
    dictionaries.set(lang, loaded);
  }
  return dictionaries.get(lang);
}

/** Traducteur d'une langue précise : `{variable}` remplacée en un seul passage (une valeur saisie n'est jamais relue comme un modèle). */
export function translator(lang) {
  const own = dictionary(lang), fallback = dictionary("en");
  return (key, vars = {}) => String(own[key] ?? fallback[key] ?? key).replace(/\{(\w+)\}/g, (m, name) => (Object.hasOwn(vars, name) ? String(vars[name]) : m));
}

/** Le texte tapé par la personne, rendu inoffensif dans du Markdown (jamais de lien, de titre ou de liste involontaires) ; un retour à la ligne devient un saut de ligne. */
export function esc(value) {
  return String(value ?? "")
    .replace(/\r/g, "")
    .replace(/([\\`*_[\]<>|~&])/g, "\\$1")
    .replace(/^(\s*)([-+#]|\d+[.)])(\s|$)/gm, "$1\\$2$3")
    .replace(/\n/g, "\\\n");
}

/** Date lisible, en UTC pour un rendu identique partout. */
export function longDate(date, lang) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  try { return new Intl.DateTimeFormat(lang, { dateStyle: "long", timeZone: "UTC" }).format(d); } catch { return d.toISOString().slice(0, 10); }
}

const AUTHORITY = {
  BE: { url: "https://www.autoriteprotectiondonnees.be" },
  FR: { url: "https://www.cnil.fr" },
  CH: { url: "https://www.edoeb.admin.ch" },
  CA: { url: "https://www.priv.gc.ca" },
  CA_QC: { url: "https://www.cai.gouv.qc.ca" },
};
export const AUTHORITY_URLS = Object.fromEntries(Object.entries(AUTHORITY).map(([k, v]) => [k, v.url]));

const filled = (v) => !(v === undefined || v === null || v === "" || v === false);
const section = (title, ...parts) => ({ title, body: parts.flat().filter(Boolean).join("\n\n") });
const bullets = (items) => items.filter(Boolean).map((x) => `- ${x}`).join("\n");
const mail = (email) => `[${esc(email)}](mailto:${email})`;

/**
 * Les trois textes d'une langue. `facts` : { siteName, ... } (voir facts.mjs) ; `mode` : « preview » ou « final ».
 * Renvoie `{ notice, privacy, cookies, gaps }` ; chaque texte : `{ title, description, md }` (Markdown, liens internes écrits `(@privacy)`, `(@notice)`, `(@cookies)`, `(@home)`).
 */
export function buildDocs({ answers: a, facts, lang, mode = "preview" }) {
  const T = translator(lang);
  const gaps = [];
  const site = esc(facts?.siteName?.[lang] ?? facts?.siteName?.en ?? "");
  const country = a.country || "OTHER";

  /** Une valeur nécessaire : son texte, ou (aperçu) un manque bien visible, ou (publication) une erreur. */
  const need = (name) => {
    const v = a[name];
    if (filled(v)) return esc(v);
    if (mode === "final") throw new Error(`gap:${name}`);
    if (!gaps.includes(name)) gaps.push(name);
    return `**⚠ ${T("doc.gap", { what: T(`f.${name}.label`) })}**`;
  };
  /** Une ligne « Libellé : valeur » : écrite si la valeur existe, signalée si elle est nécessaire, sinon omise. */
  const line = (key, name, transform = (x) => x) => {
    if (filled(a[name])) return T(key, { value: transform(esc(a[name])) });
    return isRequired(a, name, facts) ? T(key, { value: need(name) }) : null;
  };
  if (!a.country) need("country");
  const emailLink = () => (filled(a.email) ? mail(a.email) : need("email"));
  const biz = a.status !== "person";
  const frHidden = country === "FR" && a.status === "person" && a.hideAddress === true;
  const host = filled(a.hostName) || country === "FR";
  const collect = a.collect ?? {};
  if (frHidden && a.hostAck !== true) need("hostAck");

  // ── Mentions légales ───────────────────────────────────────────────────────────────────────────────────────
  const notice = (() => {
    const editor = [T(`doc.notice.editor.${a.status}`, { site, name: need("name") })];
    const facts1 = [];
    if (frHidden) editor.push(T("doc.notice.hidden"));
    else facts1.push(line("doc.notice.address", "address"));
    facts1.push(T("doc.notice.email", { value: emailLink() }));
    facts1.push(line("doc.notice.phone", "phone"));
    if (biz) {
      facts1.push(line("doc.notice.legalForm", "legalForm"));
      facts1.push(line(`doc.notice.reg.${country}`, "regNumber"));
      facts1.push(line(country === "CA" || country === "CA_QC" ? "doc.notice.vat.CA" : "doc.notice.vat", "vat"));
      if (country === "FR" && a.status === "company") facts1.push(line("doc.notice.capital", "capital"));
    }
    const sections = [section(T("doc.notice.editor.h"), editor, bullets(facts1))];
    if (country === "FR") {
      const director = biz ? need("director") : need("name");
      sections.push(section(T("doc.notice.director.h"), T("doc.notice.director.text", { value: director })));
    }
    if (host) {
      const hostLines = [line("doc.notice.host.name", "hostName"), line("doc.notice.host.address", "hostAddress"), line("doc.notice.host.phone", "hostPhone"), line("doc.notice.host.country", "hostCountry")];
      sections.push(section(T("doc.notice.host.h"), T("doc.notice.host.intro"), bullets(hostLines)));
    }
    if (a.sells === "elsewhere") sections.push(section(T("doc.notice.sells.h"), T("doc.notice.sells.text", { where: need("sellsWhere") })));
    sections.push(section(T("doc.notice.ip.h"), T("doc.notice.ip.text", { name: need("name"), email: emailLink() })));
    sections.push(section(T("doc.notice.links.h"), T("doc.notice.links.text", { name: need("name") })));
    return { title: T("doc.notice.title"), description: T("doc.notice.desc", { site }), sections };
  })();

  // ── Confidentialité ───────────────────────────────────────────────────────────────────────────────────────
  const privacy = (() => {
    const who = country === "CA_QC"
      ? T("doc.privacy.who.CA_QC", { name: need("name"), email: emailLink() })
      : T("doc.privacy.who", { name: need("name"), email: emailLink() });
    const items = [];
    if (collect.messages) items.push(T("doc.privacy.c.messages"));
    if (collect.publicPosts) items.push(T("doc.privacy.c.publicPosts"));
    if (collect.chat) items.push(T("doc.privacy.c.chat"));
    if (collect.memory) items.push(T("doc.privacy.c.memory"));
    if (collect.list) items.push(T("doc.privacy.c.list", { tool: filled(a.listTool) ? T("doc.privacy.c.list.tool", { tool: esc(a.listTool) }) : "" }));
    if (collect.thirdParty) items.push(T("doc.privacy.c.thirdParty", { names: need("thirdPartyNames") }));
    if (a.unknownExt === "some") items.push(T("doc.privacy.c.other", { text: need("otherCollect") }));
    else if (filled(a.otherCollect)) items.push(T("doc.privacy.c.other", { text: esc(a.otherCollect) }));
    if (filled(a.hostName)) items.push(T("doc.privacy.c.host", { host: esc(a.hostName) }));
    const nothing = !collect.messages && !collect.publicPosts && !collect.chat && !collect.memory && !collect.list && !collect.thirdParty && !(a.unknownExt === "some") && !filled(a.otherCollect);
    const collected = section(T("doc.privacy.collect.h"), nothing ? T("doc.privacy.c.nothing") : "", bullets(items));

    const sections = [section(T("doc.privacy.who.h"), who, T("doc.privacy.technical")), collected];

    if (country === "BE" || country === "FR") {
      const basis = [];
      if (collect.messages) basis.push(T("doc.privacy.basis.messages"));
      if (collect.publicPosts) basis.push(T("doc.privacy.basis.publicPosts"));
      if (collect.chat) basis.push(T("doc.privacy.basis.chat"));
      if (collect.list) basis.push(T("doc.privacy.basis.list"));
      if (basis.length) sections.push(section(T("doc.privacy.basis.h"), bullets(basis)));
    }

    const keep = [];
    if (collect.messages) keep.push(T("doc.privacy.keep.messages", { period: T(`o.retention.${a.retention || "y1"}`) }));
    if (collect.publicPosts) keep.push(T("doc.privacy.keep.publicPosts"));
    if (collect.chat) keep.push(T("doc.privacy.keep.chat"));
    if (collect.list) keep.push(T("doc.privacy.keep.list"));
    if (keep.length) sections.push(section(T("doc.privacy.keep.h"), bullets(keep)));

    const share = [T("doc.privacy.share.never")];
    if (filled(a.hostName)) share.push(T("doc.privacy.share.host", { host: esc(a.hostName) }));
    if (collect.list && filled(a.listTool)) share.push(T("doc.privacy.share.list", { tool: esc(a.listTool) }));
    if (collect.thirdParty) share.push(T("doc.privacy.share.thirdParty", { names: need("thirdPartyNames") }));
    if (filled(a.hostCountry)) share.push(T("doc.privacy.share.country", { country: esc(a.hostCountry) }));
    sections.push(section(T("doc.privacy.share.h"), bullets(share)));

    const rightsKey = ["BE", "FR", "CH", "CA", "CA_QC"].includes(country) ? country : "OTHER";
    sections.push(section(T("doc.privacy.rights.h"), T(`doc.privacy.rights.${rightsKey}`, { email: emailLink(), authority: AUTHORITY_URLS[rightsKey] ?? "" })));
    return { title: T("doc.privacy.title"), description: T("doc.privacy.desc", { site }), sections };
  })();

  // ── Cookies ───────────────────────────────────────────────────────────────────────────────────────────────
  const cookies = (() => {
    const sure = a.unknownExt !== "some"; // on n'affirme « aucun cookie de suivi » que si rien d'inconnu n'est déclaré
    const parts = [];
    if (sure && !collect.thirdParty) parts.push(T("doc.cookies.none"));
    else if (sure) parts.push(T("doc.cookies.noneExceptThirdParty"));
    parts.push(T("doc.cookies.essential"));
    if (collect.memory) parts.push(T("doc.cookies.memory"));
    if (collect.thirdParty) parts.push(T("doc.cookies.thirdParty", { names: need("thirdPartyNames") }));
    if (a.unknownExt === "some") parts.push(T("doc.cookies.other", { text: need("otherCollect") }));
    parts.push(T("doc.cookies.technical"));
    const sections = [
      section(T("doc.cookies.what.h"), parts),
      section(T("doc.cookies.manage.h"), T("doc.cookies.manage.text")),
    ];
    if (country === "BE" || country === "FR") sections.push(section(T("doc.cookies.more.h"), T(`doc.cookies.more.${country}`, { authority: AUTHORITY_URLS[country] })));
    return { title: T("doc.cookies.title"), description: T("doc.cookies.desc", { site }), sections };
  })();

  const finish = (doc) => ({ title: doc.title, description: doc.description, md: doc.sections.map((s) => `## ${s.title}\n\n${s.body}`).join("\n\n") });
  return { notice: finish(notice), privacy: finish(privacy), cookies: finish(cookies), gaps };
}
