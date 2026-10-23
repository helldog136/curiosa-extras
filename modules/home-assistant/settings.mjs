// Les réglages du module, lus avec leurs bornes : `ctx.setting` peut renvoyer n'importe quoi (un nombre en texte, une case vide…), on convertit et on borne ici, une seule fois.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { buildMatcher, MAX_CHARS } = await import(`./moderation.mjs${v}`);

export const BOUNDS = {
  expirySeconds: { min: 15, max: 300, def: 60 },
  maxChars: { min: MAX_CHARS.min, max: MAX_CHARS.max, def: MAX_CHARS.default },
  viewerDelaySeconds: { min: 0, max: 3600, def: 60 },
  globalDelaySeconds: { min: 0, max: 600, def: 10 },
  pollSeconds: { min: 2, max: 30, def: 3 },
};

const number = (raw, { min, max, def }) => {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
};
const flag = (raw, def) => (raw === undefined || raw === null || raw === "" ? def : raw === true || raw === "true" || raw === "on" || raw === 1);
const text = (raw) => (typeof raw === "string" ? raw.slice(0, 20_000) : "");

const matchers = new Map();   // empreinte des réglages de mots → détecteur (3 au plus)
function matcherFor(useDefaults, extra, allowed) {
  const k = `${useDefaults ? 1 : 0}\u0000${extra}\u0000${allowed}`;
  let m = matchers.get(k);
  if (!m) {
    m = buildMatcher({ useDefaults, extra, allowed });
    matchers.set(k, m);
    if (matchers.size > 3) matchers.delete(matchers.keys().next().value);
  }
  return m;
}

/** Tous les réglages utiles, bornés. `matcher` : le détecteur de mots (liste fournie + mots en plus − mots acceptés). */
export function settingsOf(ctx) {
  const s = (k) => ctx.setting(k);
  const useDefaultWords = flag(s("useDefaultWords"), true);
  const extraWords = text(s("extraWords")), allowedWords = text(s("allowedWords"));
  return {
    expirySeconds: number(s("expirySeconds"), BOUNDS.expirySeconds),
    maxChars: number(s("maxChars"), BOUNDS.maxChars),
    viewerDelaySeconds: number(s("viewerDelaySeconds"), BOUNDS.viewerDelaySeconds),
    globalDelaySeconds: number(s("globalDelaySeconds"), BOUNDS.globalDelaySeconds),
    pollSeconds: number(s("pollSeconds"), BOUNDS.pollSeconds),
    prefixViewer: flag(s("prefixViewer"), true),
    blockNumbers: flag(s("blockNumbers"), true),
    useDefaultWords, extraWords, allowedWords,
    matcher: matcherFor(useDefaultWords, extraWords, allowedWords),
  };
}
