// Les règles « évènement → action » : ce qui compte, comment on vérifie un formulaire, comment on reconnaît une règle qui s'applique.
//
// ARGENT : YouTube annonce un montant en MICROS de la devise du donateur (5 € = 5 000 000 micros d'EUR). On NE CONVERTIT JAMAIS (aucun taux de change fiable ni neutre à
// embarquer, et un taux qui bouge rendrait la règle imprévisible) : un seuil n'a de sens que dans UNE devise. Une règle porte donc soit une devise (« 5 EUR au moins » : un don
// en dollars ne la déclenche pas), soit « toutes les devises » SANS seuil (« n'importe quel don »). Pour couvrir deux devises avec un seuil, on crée deux règles.
export const TYPES = ["superchat", "supersticker", "member", "gift"];
export const MONEY_TYPES = ["superchat", "supersticker"];
export const KEY_RE = /^[a-z0-9][a-z0-9:_-]{0,39}$/;
export const CURRENCIES = ["EUR", "USD", "GBP", "CAD", "AUD", "CHF", "JPY", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "RON", "BGN", "NZD", "SGD", "HKD", "KRW", "BRL", "MXN", "INR", "TRY", "ZAR", "ILS", "AED", "PHP", "THB", "TWD", "MYR", "IDR"];
/** Les devises proposées : la liste fournie, plus celles que la personne a ajoutées (réglage avancé : « PLN, CZK »). */
export const currenciesOf = (extra) => [...new Set([...CURRENCIES, ...String(extra ?? "").toUpperCase().split(/[\s,;]+/).filter((c) => /^[A-Z]{3}$/.test(c))])].slice(0, 80);
export const EXAMPLE_KEYS = ["lumieres:rouge", "lumieres:vert", "lumieres:bleu", "tts:lire"];
export const MAX_MICROS = 1e15;   // au-delà, ce n'est pas un montant

const clean = (v, max) => String(v ?? "").normalize("NFKC").replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
export const cleanName = (v, max = 40) => clean(v, max).replace(/[<>]/g, "");
export const isTts = (key) => /^tts[:_-]/.test(String(key));

/** « 5 », « 2,50 », « 2.5 » → micros (nombre entier) ; null si ce n'est pas un montant. */
export function toMicros(raw) {
  const t = String(raw ?? "").trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d{1,9}(\.\d{1,6})?$/.test(t)) return null;
  return Math.round(Number(t) * 1e6);
}
/** Micros → « 5 » ou « 2,5 » pour un champ de formulaire. */
export const fromMicros = (micros, locale = "fr") => {
  const n = Number(micros) / 1e6;
  return String(Number.isFinite(n) ? n : 0).replace(".", locale === "en" ? "." : ",");
};
export function formatMoney(micros, currency, locale = "fr") {
  const n = Number(micros) / 1e6;
  if (!Number.isFinite(n)) return "";
  try { return new Intl.NumberFormat(locale === "en" ? "en" : "fr", { style: "currency", currency, currencyDisplay: "narrowSymbol" }).format(n); }
  catch { return `${n.toLocaleString(locale === "en" ? "en" : "fr")} ${currency}`; }
}

/**
 * Vérifie un formulaire de règle. Rend { ok: true, rule } ou { ok: false, errors: { champ: "clé de phrase" } } (les clés sont traduites par l'appelant).
 * `values` : les champs du formulaire, en texte.
 */
export function validateRule(values) {
  const errors = {};
  const name = cleanName(values.name, 64);
  if (!name) errors.name = "err_name";
  const type = TYPES.includes(values.type) ? values.type : null;
  if (!type) errors.type = "err_type";
  const money = MONEY_TYPES.includes(type);
  let currency = "*";
  let minMicros = 0, minCount = 1;
  if (money) {
    const picked = String(values.currency ?? "*").trim().toUpperCase();
    currency = picked === "*" || picked === "" ? "*" : picked;
    if (currency !== "*" && !/^[A-Z]{3}$/.test(currency)) errors.currency = "err_currency";
    else if (currency !== "*") {
      const raw = String(values.min ?? "").trim();
      const m = raw === "" ? 0 : toMicros(raw);
      if (m === null || m > MAX_MICROS) errors.min = "err_min"; else minMicros = m;
    }
  }
  if (type === "gift") {
    const raw = String(values.minCount ?? values.min ?? "1").trim() || "1";
    const n = /^\d{1,4}$/.test(raw) ? Number(raw) : NaN;
    if (!(n >= 1 && n <= 1000)) errors.min = "err_count"; else minCount = n;
  }
  const cdRaw = String(values.cooldownSec ?? "30").trim() || "30";
  const cooldownSec = /^\d{1,4}$/.test(cdRaw) ? Number(cdRaw) : NaN;
  if (!(cooldownSec >= 0 && cooldownSec <= 3600)) errors.cooldownSec = "err_cooldown";
  const custom = String(values.customAction ?? "").trim().toLowerCase();
  const action = custom || String(values.action ?? "").trim().toLowerCase();
  if (!KEY_RE.test(action)) errors[custom ? "customAction" : "action"] = "err_action";
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    rule: { name, type, currency, minMicros, minCount, cooldownSec, action, readMessage: type === "superchat" && isTts(action) && values.readMessage === "on", enabled: values.enabled !== "off" },
  };
}

/** Quelles règles s'appliquent à ce don ? (actives, dans l'ordre, trois au plus.) */
export function matching(rules, ev) {
  const out = [];
  for (const r of rules) {
    if (r.enabled === false || r.type !== ev.kind) continue;
    if (MONEY_TYPES.includes(ev.kind)) {
      if (r.currency !== "*" && r.currency !== ev.currency) continue;
      if (r.currency !== "*" && !(ev.micros >= (Number(r.minMicros) || 0))) continue;
    } else if (ev.kind === "gift" && !(ev.count >= (Number(r.minCount) || 1))) continue;
    out.push(r);
    if (out.length >= 3) break;
  }
  return out;
}
/** Le délai de recharge d'une règle est-il en cours ? Rend les secondes restantes (0 = libre). */
export const cooldownLeft = (rule, now) => {
  const cd = (Number(rule.cooldownSec) || 0) * 1000;
  return cd > 0 && Number(rule.lastAt) > 0 ? Math.max(0, Math.ceil((rule.lastAt + cd - now) / 1000)) : 0;
};
