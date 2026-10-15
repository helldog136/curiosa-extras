// Statistiques de la communauté — comptes saisis à la main (Instagram, TikTok, X, Facebook… : les réseaux sans lecture automatique).
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins
const { METRICS, MAX_VALUE, MAX_STATS, DAY, STALE_MANUAL_DAYS, fail, clean, normalizeName, platformSlug, manualId, periodMs } = await import(`./model.mjs${v}`);
const { loadStats, saveStat, newStat, addPoint } = await import(`./stats.mjs${v}`);

/** Date d'un chiffre saisi : vide = maintenant ; « AAAA-MM-JJ » = ce jour-là à midi (UTC), ou maintenant si c'est aujourd'hui ; jamais dans le futur, jamais avant 2000. */
export function parseWhen(value, now) {
  if (value === undefined || value === null || String(value).trim() === "") return now;
  const text = String(value).trim();
  if (text.length > 40) throw fail("date is not valid", "date");
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
  const ms = Date.parse(dateOnly ? `${text}T12:00:00Z` : text);
  if (!Number.isFinite(ms) || ms < Date.parse("2000-01-01T00:00:00Z")) throw fail("date is not valid", "date");
  if (dateOnly && text === new Date(now).toISOString().slice(0, 10)) return now;
  if (ms > now + 300_000) throw fail("date is in the future", "future");
  return ms;
}

/** Ce compte est-il déjà lu automatiquement (même réseau, même type de chiffre, même nom de compte) ? */
export function automaticMatch(stats, platform, account, metric) {
  const name = normalizeName(account);
  return stats.find((s) => s.source === "auto" && s.platform === platform && s.metric === metric && (normalizeName(s.account) === name || normalizeName(s.accountKey) === name)) ?? null;
}

/**
 * Note un chiffre à la main. `by` : « admin » ou le nom du jeton de l'assistant. Refuse un compte lu automatiquement.
 * Un deuxième chiffre dans la même période remplace le premier (pas de doublon).
 */
export async function setManual(ctx, input, { now = Date.now(), by = "admin" } = {}) {
  const shown = clean(input?.platform, 31);
  const platform = shown ? platformSlug(shown) : null;
  if (!platform || !/^[a-z][a-z0-9-]{0,30}$/.test(platform)) throw fail("platform is required (e.g. Instagram, TikTok)", "platform");
  const account = clean(input?.account, 120);
  if (!account) throw fail("account name is required (1 to 120 characters)", "account");
  if (!METRICS.includes(input?.metric)) throw fail(`metric must be one of ${METRICS.join(", ")}`, "metric");
  const value = typeof input?.value === "string" && /^\d{1,13}$/.test(input.value.trim()) ? Number(input.value.trim()) : input?.value;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_VALUE) throw fail(`value must be a whole number between 0 and ${MAX_VALUE}`, "value");
  const at = parseWhen(input?.date, now);
  const stats = await loadStats(ctx);
  const auto = automaticMatch(stats, platform, account, input.metric);
  if (auto) throw fail(`${auto.account} is already read automatically for this figure: a hand-written value is not accepted`, "automatic");
  const id = manualId(platform, account, input.metric);
  let stat = stats.find((s) => s.id === id);
  if (!stat) {
    if (stats.length >= MAX_STATS) throw fail("too many statistics", "tooMany");
    stat = newStat({ id, source: "manual", platform, platformName: shown, account, accountKey: normalizeName(account) || platform, metric: input.metric, label: `${shown} ${account}`.slice(0, 120), url: null }, now);
  } else stat.account = account;
  await addPoint(ctx, stat, at, value, periodMs(ctx), { by });
  stat.state = "ok";
  await saveStat(ctx, stat);
  return stat;
}

/** Les comptes manuels dont le dernier chiffre date de plus de 30 jours (rappel doux). */
export const staleManual = (stats, now) => stats.filter((s) => s.source === "manual" && s.lastAt != null && now - s.lastAt > STALE_MANUAL_DAYS * DAY);
