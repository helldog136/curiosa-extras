// Jeu du jour — quelle question aujourd'hui ? Fonctions PURES (aucun stockage) : on leur donne la banque et l'historique, elles répondent.
//
// Règles (les mêmes pour tout le monde, sans minuteur : seule la date compte) :
//  1. Une question PLANIFIÉE à cette date, publiée, passe avant tout. Elle ne fait pas partie de la rotation.
//  2. Sinon, la rotation : un « sac » contenant les questions publiées et non planifiées. Chaque jour on en sort une ; le sac se vide, puis se remplit de nouveau.
//     - « dans l'ordre » : la première du sac, dans l'ordre choisi par l'équipe ;
//     - « au hasard » : un tirage qui ne dépend que de la graine du site et de la date.
//     Ce qui est déjà passé pendant le tour en cours est retenu dans l'historique (jour → question) : ajouter ou retirer des questions en cours de route
//     ne fait jamais repasser une question avant que la banque soit épuisée.
//  3. Le choix d'un jour est FIGÉ dès la première visite de ce jour (historique) : changer la banque ne change que les jours suivants.

/** Les questions de la rotation, dans l'ordre choisi par l'équipe. `items` : { id, status, date, pos, createdAt } déjà filtrés sur le type de jeu et « prêt à être joué ». */
export function rotation(items) {
  return items.filter((i) => i.status === "published" && !i.date).sort((a, b) => a.pos - b.pos || a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
}

/** Le choix d'un jour. `state` : { hist: { jour: id }, cycleStart: jour }. Rend { id, scheduled, cycleStart } (id = null si rien à jouer). Ne modifie rien. */
export function choose(day, state, items, mode, rand) {
  const planned = items.find((i) => i.status === "published" && i.date === day);
  if (planned) return { id: planned.id, scheduled: true, cycleStart: state.cycleStart || "" };
  const pool = rotation(items);
  if (!pool.length) return { id: null, scheduled: false, cycleStart: state.cycleStart || "" };
  const ids = new Set(pool.map((p) => p.id));
  let cycleStart = state.cycleStart || "";
  const used = new Set(Object.entries(state.hist ?? {}).filter(([d, id]) => d < day && d >= cycleStart && ids.has(id)).map(([, id]) => id));
  let free = pool.filter((p) => !used.has(p.id));
  if (!free.length) {   // le sac est vide : un nouveau tour commence aujourd'hui
    cycleStart = day;
    const before = Object.keys(state.hist ?? {}).filter((d) => d < day).sort().pop();
    const lastId = before ? state.hist[before] : null;
    free = pool.filter((p) => pool.length < 2 || p.id !== lastId);
  }
  const at = mode === "random" ? rand(free.length) : 0;
  return { id: free[at].id, scheduled: false, cycleStart, left: free.length - 1 };
}

/** L'état après avoir choisi `day` (historique borné à `keep` jours). */
export function remember(state, day, choice, keep = 400) {
  const hist = { ...(state.hist ?? {}), [day]: choice.id };
  const days = Object.keys(hist).sort();
  for (const d of days.slice(0, Math.max(0, days.length - keep))) delete hist[d];
  return { ...state, hist, cycleStart: choice.cycleStart };
}

/** Les `count` jours à partir de `from` (sans rien écrire) : [{ day, id, scheduled, repeat }]. `repeat` : le tour recommence ce jour-là. */
export function forecast(from, count, state, items, mode, rand, addDay) {
  let sim = { ...state, hist: { ...(state.hist ?? {}) } };
  const out = [];
  let day = from;
  for (let i = 0; i < count; i++) {
    const frozen = sim.hist[day];
    const known = frozen && items.some((x) => x.id === frozen && x.status === "published");
    const c = known ? { id: frozen, scheduled: items.some((x) => x.id === frozen && x.date === day), cycleStart: sim.cycleStart || "" } : choose(day, sim, items, mode, (n) => rand(n, day));
    const fresh = !known && c.id && !c.scheduled && c.cycleStart === day && Object.keys(sim.hist).some((d) => d < day);
    out.push({ day, id: c.id, scheduled: !!c.scheduled, repeat: !!fresh });
    if (c.id) sim = remember(sim, day, c, 2000);
    day = addDay(day, 1);
  }
  return out;
}

/**
 * « Il reste N jours de questions » : combien de jours APRÈS aujourd'hui sont couverts sans qu'une question repasse.
 * Rend { days, wraps } : `wraps` vaut vrai quand la rotation recommencera ensuite (la banque n'est pas vide) ; `days` est plafonné à 2 400.
 */
export function daysLeft(today, state, items, mode, rand, addDay) {
  const pool = rotation(items);
  const plannedDays = new Set(items.filter((i) => i.status === "published" && i.date && i.date > today).map((i) => i.date));
  if (!pool.length) return { days: plannedDays.size, wraps: false };
  let sim = { ...state, hist: { ...(state.hist ?? {}) } };
  const frozen = sim.hist[today];
  if (!frozen || !items.some((x) => x.id === frozen && x.status === "published")) {
    const c = choose(today, sim, items, mode, (n) => rand(n, today));
    if (c.id) sim = remember(sim, today, c, 2000);
  }
  const ids = new Set(pool.map((p) => p.id));
  const used = new Set(Object.entries(sim.hist).filter(([d, id]) => d >= (sim.cycleStart || "") && d <= today && ids.has(id)).map(([, id]) => id));
  const free = pool.filter((p) => !used.has(p.id));
  let days = 0;
  let day = addDay(today, 1);
  for (let guard = 0; guard < 2400; guard++, day = addDay(day, 1)) {
    if (plannedDays.has(day)) { days++; continue; }
    if (!free.length) break;
    free.splice(mode === "random" ? rand(free.length, day) : 0, 1);
    days++;
  }
  return { days, wraps: true };
}
