// D'où vient l'état « en direct » côté YouTube : du service FACULTATIF `youtube.live` (méthode `current`) de Chaîne YouTube — jamais de YouTube directement.
// Ce module ne connaît ni clé, ni quota : il demande, il présente. Mais CHAQUE vérification coûte 2 unités de la limite du jour de YouTube (le service garde sa réponse 45 secondes),
// et la bannière se calcule à CHAQUE page vue : sans précaution, un site fréquenté userait la limite en quelques heures. Donc :
//   - la réponse est gardée ici plus longtemps (3 minutes en direct, 5 minutes hors direct, 2 minutes après une erreur) : au plus une vérification par instance et par durée de garde,
//     quel que soit le nombre de visiteurs, de pages ou d'onglets ; jamais `fresh` ;
//   - deux visiteurs qui arrivent en même temps partagent la même question en cours ;
//   - le visiteur n'attend jamais plus de 2,5 secondes : passé ce délai il ne voit pas YouTube pour cette page, et la réponse, quand elle arrive, remplit quand même la mémoire ;
//   - aucun minuteur de fond : tout part d'une page affichée ; sans visiteur, plus aucune vérification.
// Sans Chaîne YouTube installée, `callAll` répond tout de suite « aucun fournisseur » : rien n'est mémorisé, aucun appel.
// Même « version » que ce fichier (voir index.mjs) : un `import … from "./source.mjs"` sans elle reprend l'ANCIEN source.mjs resté en mémoire après une mise à jour.
const { askAll } = await import(new URL(`./source.mjs${new URL(import.meta.url).search}`, import.meta.url).href);

export const SERVICE = "youtube.live";
export const VIDEO_RE = /^[\w-]{11}$/;
/** Millisecondes, dans un objet pour que les tests puissent les raccourcir. */
export const timing = { liveMs: 180_000, offMs: 300_000, errorMs: 120_000, waitMs: 2_500 };

const cache = new Map();     // clé d'instance → { until, value }
const pending = new Map();   // clé d'instance → la question en cours (partagée)
export const resetYoutube = () => { cache.clear(); pending.clear(); };

const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
/** Lien de lecture : toujours construit ici à partir d'un identifiant vérifié, jamais repris d'une réponse. */
export const watchUrl = (videoId) => `https://www.youtube.com/watch?v=${videoId}`;
export const embedUrl = (videoId, { autoplay = false } = {}) => `https://www.youtube-nocookie.com/embed/${videoId}?rel=0${autoplay ? "&autoplay=1" : "&mute=1"}`;

/**
 * Les réponses du service → { state, lives, gap }.
 *   state : "none" (aucune Chaîne YouTube) | "unknown" (aucune réponse claire : panne, clé manquante, limite atteinte…) | "off" (pas en direct) | "live"
 *   lives : [{ videoId, title, name }] (vidéo vérifiée, titre nettoyé et borné, nom d'instance borné) ; gap : le code d'erreur le plus parlant quand state = "unknown" ("channel", "config"…).
 */
export function readAnswers(answers) {
  const lives = [];
  let off = false, gap = null;
  for (const a of answers) {
    const v = a?.value;
    if (v?.ok === true && v.live === true && VIDEO_RE.test(String(v.videoId ?? ""))) {
      if (!lives.some((l) => l.videoId === v.videoId)) lives.push({ videoId: v.videoId, title: clean(v.title, 100), name: clean(a.name, 60) || "YouTube" });
    } else if (v?.ok === true && v.live === false) off = true;
    else if (!gap) gap = typeof v?.error === "string" && /^[a-z_]{2,20}$/.test(v.error) ? v.error : "network";
  }
  if (lives.length) return { state: "live", lives: lives.slice(0, 5), gap: null };
  if (off) return { state: "off", lives: [], gap: null };
  return { state: "unknown", lives: [], gap: gap ?? "network" };
}

async function ask(ctx) {
  try {
    if (typeof ctx.api.services?.callAll !== "function") return { state: "none", lives: [], gap: null };
    const answers = await askAll(ctx, "current", {}, SERVICE);
    return answers.length ? readAnswers(answers) : { state: "none", lives: [], gap: null };
  } catch { return { state: "unknown", lives: [], gap: "network" }; }
}

/** Les directs YouTube en cours (voir plus haut pour les précautions). Ne lève jamais. */
export async function youtubeLives(ctx, now = Date.now()) {
  const key = ctx.instance?.key ?? "live-status";
  const hit = cache.get(key);
  if (hit && hit.until > now) return hit.value;
  let q = pending.get(key);
  if (!q) {
    q = ask(ctx).then((value) => {
      if (value.state !== "none") {
        const ttl = value.state === "live" ? timing.liveMs : value.state === "off" ? timing.offMs : timing.errorMs;
        cache.set(key, { until: Date.now() + ttl, value });
        while (cache.size > 20) cache.delete(cache.keys().next().value);
      }
      return value;
    }).finally(() => pending.delete(key));
    pending.set(key, q);
  }
  let t;
  const late = new Promise((r) => { t = setTimeout(() => r({ state: "unknown", lives: [], gap: "timeout" }), timing.waitMs); });
  try { return await Promise.race([q, late]); } finally { clearTimeout(t); }
}
