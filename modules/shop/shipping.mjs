// Shop (EXPERIMENTAL prototype): shipping, chosen by the seller (decision D18). Three modes, nothing mandatory, nothing charged until the seller says so:
//   "none"  : pick up only (the default: nothing is charged and no address is asked, so a seller who ships and forgot to set it up notices at the first order);
//   "flat"  : one price for everybody;
//   "zones" : three fixed zones (the seller's own country, Europe, the rest of the world), each with a price or "not delivered".
// The price is copied into every order (a later change never touches an order). Prices include tax, like the products; an optional tax rate is shown for information only.
const v = new URL(import.meta.url).search;
const { parseMoney, includedTax, LIMITS } = await import(`./lib.mjs${v}`);

export const MODES = ["flat", "zones", "none"];
/** ISO 3166-1 alpha-2 codes of the inhabited countries and territories a parcel can go to. Names come from the platform (Intl.DisplayNames), in the language of the person looking. */
export const COUNTRIES = ("AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW").split(" ");
/** "Europe" as a shipping zone: the EU, the rest of the EEA, the United Kingdom, Switzerland, the micro-states and the western Balkans, Moldova and Ukraine. A country that is not here is "the rest of the world". */
export const EUROPE = new Set("AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO CH GB AD MC SM VA AL BA ME MK RS XK MD UA".split(" "));
export const ZONES = ["home", "europe", "world"];
export const isCountry = (c) => typeof c === "string" && COUNTRIES.includes(c);
export const zoneOf = (cfg, country) => (country === cfg.homeCountry ? "home" : EUROPE.has(country) ? "europe" : "world");

/** The names of the countries in a language, sorted by that language: [[code, name]]. */
export function countryOptions(lang) {
  let names;
  try { names = new Intl.DisplayNames([lang || "en"], { type: "region" }); } catch { names = null; }
  const name = (c) => { try { return names?.of(c) || c; } catch { return c; } };
  return COUNTRIES.map((c) => [c, name(c)]).sort((a, b) => a[1].localeCompare(b[1], lang || "en"));
}

const DEFAULT = { mode: "none", configured: false, flat: 0, homeCountry: "", prices: { home: null, europe: null, world: null }, taxRate: 0, pickupInfo: "" };
export async function readConfig(ctx) {
  const row = await ctx.api.store.getByKey("config", "shipping");
  return row ? { ...DEFAULT, ...row.data, configured: true, id: row.id } : { ...DEFAULT };
}

/** What the seller typed in the window of one mode. Returns { value } or { errors: { field: code } }. */
export function normaliseConfig(mode, values) {
  const errors = {};
  if (!MODES.includes(mode)) return { errors: { mode: "mode" } };
  const out = { ...DEFAULT, mode, configured: true };
  const rate = values.taxRate === undefined || values.taxRate === "" ? 0 : Math.round(Number(String(values.taxRate).replace(",", ".")) * 100);
  if (!Number.isFinite(rate) || rate < 0 || rate > 10_000) errors.taxRate = "tax"; else out.taxRate = rate;
  if (mode === "flat") {
    const p = parseMoney(values.flat);
    if (p === null) errors.flat = "price"; else out.flat = p;
  }
  if (mode === "zones") {
    if (!isCountry(values.homeCountry)) errors.homeCountry = "country"; else out.homeCountry = values.homeCountry;
    for (const z of ZONES) {
      const raw = String(values[`price_${z}`] ?? "").trim();
      if (raw === "") out.prices[z] = null;                      // empty = not delivered there
      else { const p = parseMoney(raw); if (p === null) errors[`price_${z}`] = "price"; else out.prices[z] = p; }
    }
    if (!Object.keys(errors).length && ZONES.every((z) => out.prices[z] === null)) errors.price_home = "zones";
  }
  if (mode === "none") out.pickupInfo = String(values.pickupInfo ?? "").normalize("NFC").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, LIMITS.address);
  return Object.keys(errors).length ? { errors } : { value: out };
}
export async function saveConfig(ctx, value) {
  const { id, configured, ...data } = value;
  const row = await ctx.api.store.getByKey("config", "shipping");
  if (row) return ctx.api.store.update(row.id, data);
  return ctx.api.store.add("config", data, { key: "shipping" });
}

/**
 * What a delivery to `country` costs. { ok: true, mode, zone?, country?, price (cents), tax (cents, for information), pickup } or { ok: false, reason: "country" | "undelivered" }.
 * In "none" mode the country does not matter; in "flat" mode it is not asked.
 */
export function quote(cfg, country) {
  if (cfg.mode === "none") return { ok: true, mode: "none", price: 0, tax: 0, pickup: true, info: cfg.pickupInfo };
  if (cfg.mode === "flat") return { ok: true, mode: "flat", price: cfg.flat, tax: includedTax(cfg.flat, cfg.taxRate), pickup: false };
  if (!isCountry(country)) return { ok: false, reason: "country" };
  const zone = zoneOf(cfg, country), price = cfg.prices[zone];
  if (price === null || price === undefined) return { ok: false, reason: "undelivered", zone };
  return { ok: true, mode: "zones", zone, country, price, tax: includedTax(price, cfg.taxRate), pickup: false };
}
