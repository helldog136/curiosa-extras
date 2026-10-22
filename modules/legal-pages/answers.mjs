// Les réponses de la personne et les règles qui disent : « cette réponse est-elle nécessaire ? », « est-elle valable ? », « que reste-t-il à compléter ? ».
// Rien ici ne produit de texte juridique (voir docs.mjs) et rien n'invente une valeur : une réponse absente reste absente.

const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { KINDS } = await import(`./known.mjs${v}`);

export const COUNTRIES = ["BE", "FR", "CH", "CA_QC", "CA", "OTHER"];
export const STATUSES = ["person", "self", "association", "company"];
export const RETENTIONS = ["m6", "y1", "y3"];
export const SELLS = ["no", "here", "elsewhere"];
export const EXT_ANSWERS = ["none", "some"];

/** Nettoie un texte saisi : retire les caractères de contrôle (et ceux qui inversent le sens de lecture), borne la taille. */
export function clean(value, max, multiline = false) {
  let text = String(value ?? "")
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, "");
  text = multiline ? text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n") : text.replace(/\s+/g, " ");
  return text.trim().slice(0, max);
}

const EMAIL = /^[A-Za-z0-9._%+'-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const PHONE = /^\+?[0-9][0-9 ().\/-]{4,28}[0-9]$/;
const digits = (s) => String(s).replace(/\D/g, "");

const isFr = (a) => a.country === "FR";
const isPerson = (a) => a.status === "person";
const business = (a) => a.status !== "person";
const frHidden = (a) => isFr(a) && isPerson(a) && a.hideAddress === true;
const frCompany = (a) => isFr(a) && a.status === "company";

/** Numéro d'immatriculation : forme attendue selon le pays (on ne refuse que ce qui ne peut pas être le bon numéro). */
function regError(value, country) {
  const d = digits(value);
  if (country === "BE") return /^(?:BE\s*)?[01]\d{3}[. ]?\d{3}[. ]?\d{3}$/i.test(String(value).trim()) ? null : "err.regNumber.BE";
  if (country === "FR") return d.length === 9 || d.length === 14 ? null : "err.regNumber.FR";
  if (country === "CH") return /^CHE[-\s]?\d{3}[. ]?\d{3}[. ]?\d{3}/i.test(String(value).trim()) ? null : "err.regNumber.CH";
  if (country === "CA_QC") return d.length === 10 ? null : "err.regNumber.CA_QC";
  return value.length >= 2 ? null : "err.regNumber.free";
}

/**
 * Les étapes de l'assistant, dans l'ordre. Chaque champ dit : son type, quand il s'affiche (`show`), quand il est nécessaire (`req`), comment le vérifier (`check`).
 * Les libellés, aides et exemples vivent dans locales/ (clés `f.<champ>.label`, `f.<champ>.help`, `o.<champ>.<valeur>`, `err.<champ>`).
 */
export const STEPS = [
  {
    id: "country", applies: () => true,
    fields: [
      { name: "country", type: "select", options: COUNTRIES, req: () => true, check: (v) => (COUNTRIES.includes(v) ? null : "err.choose") },
    ],
  },
  {
    id: "who", applies: () => true,
    fields: [
      { name: "status", type: "select", options: STATUSES, req: () => true, check: (v) => (STATUSES.includes(v) ? null : "err.choose") },
      { name: "name", type: "text", max: 120, req: () => true, check: (v) => (v.length >= 2 ? null : "err.name"), labelKey: (a) => `f.name.label.${a.status || "person"}` },
      { name: "email", type: "email", max: 200, req: () => true, check: (v) => (EMAIL.test(v) ? null : "err.email") },
    ],
  },
  {
    id: "address", applies: () => true,
    fields: [
      { name: "address", type: "textarea", max: 300, req: (a) => (business(a) ? true : isFr(a) && !a.hideAddress), check: (v) => (v.length >= 6 && /[A-Za-zÀ-ÿ]/.test(v) ? null : "err.address"), helpKey: (a) => (isPerson(a) ? (isFr(a) ? "f.address.help.personFR" : "f.address.help.person") : "f.address.help.business") },
      { name: "hideAddress", type: "checkbox", show: (a) => isFr(a) && isPerson(a), req: () => false, check: () => null },
      { name: "hostAck", type: "checkbox", show: (a) => isFr(a) && isPerson(a), req: (a) => frHidden(a), check: (v) => (v ? null : "err.hostAck") },
      { name: "phone", type: "text", max: 30, req: (a) => isFr(a) && !frHidden(a), check: (v) => (PHONE.test(v) ? null : "err.phone"), helpKey: (a) => (isFr(a) ? "f.phone.help.FR" : "f.phone.help") },
    ],
  },
  {
    id: "business", applies: (a) => business(a),
    fields: [
      { name: "legalForm", type: "text", max: 60, req: (a) => a.status === "company" && ["BE", "FR", "CH"].includes(a.country), check: (v) => (v.length >= 2 ? null : "err.legalForm") },
      { name: "regNumber", type: "text", max: 60, req: (a) => a.status === "company" || (a.status === "self" && (isFr(a) || a.country === "BE")), check: (v, a) => regError(v, a.country), labelKey: (a) => `f.regNumber.label.${a.country || "OTHER"}`, helpKey: (a) => `f.regNumber.help.${a.country || "OTHER"}` },
      { name: "vat", type: "text", max: 40, req: () => false, check: (v) => (/^[A-Za-z0-9 .\-\/]{4,40}$/.test(v) ? null : "err.vat"), labelKey: (a) => (a.country === "CA" || a.country === "CA_QC" ? "f.vat.label.CA" : "f.vat.label") },
      { name: "capital", type: "text", max: 40, show: (a) => frCompany(a), req: (a) => frCompany(a), check: (v) => (v.length >= 2 ? null : "err.capital") },
      { name: "director", type: "text", max: 120, show: (a) => isFr(a) && business(a), req: (a) => isFr(a) && business(a), check: (v) => (v.length >= 2 ? null : "err.director") },
    ],
  },
  {
    id: "host", applies: () => true,
    fields: [
      { name: "hostName", type: "text", max: 120, req: (a) => isFr(a), check: (v) => (v.length >= 2 ? null : "err.hostName") },
      { name: "hostAddress", type: "textarea", max: 300, req: (a) => isFr(a), check: (v) => (v.length >= 6 ? null : "err.hostAddress") },
      { name: "hostPhone", type: "text", max: 30, req: (a) => isFr(a), check: (v) => (PHONE.test(v) ? null : "err.phone") },
      { name: "hostCountry", type: "text", max: 60, req: () => false, check: (v) => (v.length >= 2 ? null : "err.hostCountry") },
    ],
  },
  {
    id: "collect", applies: () => true,
    fields: [
      ...KINDS.map((kind) => ({ name: `collect_${kind}`, type: "checkbox", req: () => false, check: () => null, group: "collect" })),
      { name: "thirdPartyNames", type: "text", max: 200, req: (a) => a.collect?.thirdParty === true, check: (v) => (v.length >= 2 ? null : "err.thirdPartyNames") },
      { name: "listTool", type: "text", max: 80, show: () => true, req: () => false, check: (v) => (v.length >= 2 ? null : "err.listTool") },
      { name: "unknownExt", type: "select", options: EXT_ANSWERS, show: (a, facts) => (facts?.unknown?.length ?? 0) > 0, req: (a, facts) => (facts?.unknown?.length ?? 0) > 0, check: (v) => (EXT_ANSWERS.includes(v) ? null : "err.choose") },
      { name: "otherCollect", type: "textarea", max: 600, req: (a) => a.unknownExt === "some", check: (v) => (v.length >= 6 ? null : "err.otherCollect") },
    ],
  },
  {
    id: "keep", applies: (a) => a.collect?.messages === true,
    fields: [
      { name: "retention", type: "select", options: RETENTIONS, req: () => true, check: (v) => (RETENTIONS.includes(v) ? null : "err.choose") },
    ],
  },
  {
    id: "sells", applies: () => true,
    fields: [
      { name: "sells", type: "select", options: SELLS, req: () => true, check: (v) => (SELLS.includes(v) ? null : "err.choose") },
      { name: "sellsWhere", type: "text", max: 120, req: (a) => a.sells === "elsewhere", check: (v) => (v.length >= 2 ? null : "err.sellsWhere") },
    ],
  },
];

export const stepIds = STEPS.map((s) => s.id);
export const stepById = (id) => STEPS.find((s) => s.id === id) ?? null;
export const appliedSteps = (a) => STEPS.filter((s) => s.applies(a));

const shown = (f, a, facts) => (f.show ? f.show(a, facts) : true);

/** Lit la valeur d'un champ dans les réponses (les cases « recueillez » vivent dans `collect`). */
export function valueOf(a, name) {
  if (name.startsWith("collect_")) return a.collect?.[name.slice(8)] === true;
  return a[name];
}
function setValue(a, name, v) {
  if (name.startsWith("collect_")) a.collect = { ...(a.collect ?? {}), [name.slice(8)]: v === true };
  else a[name] = v;
}
const emptyValue = (v) => v === undefined || v === null || v === "" || v === false;

/** Les réponses de départ : ce que le site sait déjà (adresse e-mail du site, extensions reconnues), jamais une valeur inventée. */
export function withDefaults(stored, facts) {
  const s = stored && typeof stored === "object" ? stored : {};
  const det = facts?.detected ?? {};
  const collect = {};
  for (const k of KINDS) collect[k] = s.collect && typeof s.collect[k] === "boolean" ? s.collect[k] : det[k] === true;
  return {
    country: COUNTRIES.includes(s.country) ? s.country : "",
    status: STATUSES.includes(s.status) ? s.status : "person",
    name: s.name ?? "", email: s.email ?? facts?.brandEmail ?? "", phone: s.phone ?? "", address: s.address ?? "",
    hideAddress: s.hideAddress === true, hostAck: s.hostAck === true,
    legalForm: s.legalForm ?? "", regNumber: s.regNumber ?? "", vat: s.vat ?? "", capital: s.capital ?? "", director: s.director ?? "",
    hostName: s.hostName ?? "", hostAddress: s.hostAddress ?? "", hostPhone: s.hostPhone ?? "", hostCountry: s.hostCountry ?? "",
    collect,
    thirdPartyNames: s.thirdPartyNames ?? (facts?.thirdPartyNames ?? []).join(", "),
    listTool: s.listTool ?? "", unknownExt: EXT_ANSWERS.includes(s.unknownExt) ? s.unknownExt : "", otherCollect: s.otherCollect ?? "",
    retention: RETENTIONS.includes(s.retention) ? s.retention : "y1",
    sells: SELLS.includes(s.sells) ? s.sells : "no", sellsWhere: s.sellsWhere ?? "",
    unknownAck: Array.isArray(s.unknownAck) ? s.unknownAck.map(String).slice(0, 100) : [],
    touched: s.touched && typeof s.touched === "object" ? { ...s.touched } : {},
  };
}

/** Une valeur reçue d'un formulaire (ou d'un assistant), nettoyée selon le type du champ. */
function parse(field, raw) {
  if (field.type === "checkbox") return raw === true || raw === "on" || raw === "true" || raw === "1";
  if (field.type === "select") return field.options.includes(String(raw ?? "")) ? String(raw) : "";
  return clean(raw, field.max ?? 200, field.type === "textarea");
}

/**
 * Enregistre les réponses d'une étape : `values` vient d'un formulaire (texte). Renvoie `{ answers, errors }` ; `errors` : champ → clé de message (jamais de texte).
 * Rien n'est enregistré par cette fonction : l'appelant décide.
 */
export function applyStep(current, stepId, values, facts) {
  const step = stepById(stepId);
  if (!step) return { answers: current, errors: { _: "err.step" } };
  const a = structuredClone(current);
  // 1. on lit toutes les valeurs de l'étape (les autres champs de l'étape peuvent décider de ce qui est nécessaire)
  for (const f of step.fields) if (shown(f, a, facts) || f.type === "checkbox") setValue(a, f.name, parse(f, values?.[f.name]));
  // 2. on vérifie
  const errors = {};
  for (const f of step.fields) {
    if (!shown(f, a, facts)) continue;
    const v = valueOf(a, f.name);
    if (emptyValue(v)) { if (f.req(a, facts)) errors[f.name] = f.type === "select" ? "err.choose" : f.type === "checkbox" ? (f.check(false, a) ?? "err.required") : "err.required"; continue; }
    const bad = f.check(v, a);
    if (bad) errors[f.name] = bad;
  }
  if (Object.keys(errors).length === 0) a.touched = { ...(a.touched ?? {}), [stepId]: true };
  return { answers: a, errors };
}

/**
 * Ce qui reste à compléter : une liste d'éléments `{ step, field?, kind }`.
 *  - kind « empty »   : un champ nécessaire est vide ou invalide ;
 *  - kind « confirm » : l'étape n'a jamais été validée par la personne (valeurs préremplies ou venues d'un assistant).
 * Quand la liste est vide, les trois pages peuvent être publiées.
 */
export function evaluate(a, facts) {
  const missing = [];
  for (const step of appliedSteps(a)) {
    let bad = false;
    for (const f of step.fields) {
      if (!shown(f, a, facts)) continue;
      const v = valueOf(a, f.name);
      if (emptyValue(v)) { if (f.req(a, facts)) { missing.push({ step: step.id, field: f.name, kind: "empty" }); bad = true; } continue; }
      if (f.check(v, a)) { missing.push({ step: step.id, field: f.name, kind: "empty" }); bad = true; }
    }
    // L'étape « ce que vous recueillez » est à confirmer de nouveau quand une extension inconnue est apparue depuis la dernière réponse.
    const newcomer = step.id === "collect" && (facts?.unknown ?? []).some((u) => !a.unknownAck?.includes(u.module));
    if (!bad && (!a.touched?.[step.id] || newcomer)) missing.push({ step: step.id, kind: "confirm" });
  }
  return missing;
}

/** Un champ est-il nécessaire dans ces réponses ? (les pages s'en servent pour décider d'omettre une ligne ou de signaler un manque). */
export function isRequired(a, name, facts) {
  for (const step of STEPS) for (const f of step.fields) if (f.name === name) return shown(f, a, facts) && f.req(a, facts);
  return false;
}

/** Les champs affichés d'une étape, pour construire son formulaire. */
export function fieldsFor(stepId, a, facts) {
  const step = stepById(stepId);
  return step ? step.fields.filter((f) => shown(f, a, facts)) : [];
}

/** Empreinte stable des réponses (sans ce qui n'a pas d'effet sur les textes) : sert à dire « vous avez changé quelque chose depuis la publication ». */
export function fingerprintSource(a) {
  const { touched, unknownAck, ...rest } = a;
  void touched; void unknownAck;
  const sort = (o) => (Array.isArray(o) ? o.map(sort) : o && typeof o === "object" ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sort(o[k])])) : o);
  return JSON.stringify(sort(rest));
}

/**
 * Applique des réponses données d'un coup (un assistant IA qui remplit un brouillon) : seuls les champs fournis sont vérifiés pour leur FORME, rien n'est exigé,
 * et aucune étape n'est marquée « validée » — c'est la personne qui doit les relire. Renvoie `{ answers, errors }`.
 */
export function applyPatch(current, patch, facts) {
  const a = structuredClone(current);
  const errors = {};
  for (const step of STEPS) {
    for (const f of step.fields) {
      if (!Object.hasOwn(patch ?? {}, f.name)) continue;
      const v = parse(f, patch[f.name]);
      setValue(a, f.name, v);
      if (!emptyValue(v)) { const bad = f.check(v, a); if (bad) errors[f.name] = bad; }
    }
  }
  void facts;
  return { answers: a, errors };
}
