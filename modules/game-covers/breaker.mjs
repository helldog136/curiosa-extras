// Un disjoncteur par source (Twitch, Steam…) : même règle que celui de RAWG (rawg.mjs). 3 échecs de réseau d'affilée ouvrent une pause de 1, 2, 5 puis 15 minutes (la dernière se répète),
// avec un seul essai de reprise à la fois. En mémoire : il ne sert qu'à ne pas insister, ce n'est pas une donnée. Une source en pause répond tout de suite, sans réseau, sans gêner les autres.
export const FAILS_TO_OPEN = 3;
export const PAUSE_STEPS_MS = [60_000, 120_000, 300_000, 900_000];

export function makeBreaker({ probeMs = 7_000 } = {}) {
  const idle = () => ({ fails: 0, trips: 0, openUntil: 0, probeUntil: 0 });
  let b = idle();
  let lastOkMs = 0;
  return {
    /** « go » : on peut interroger (fermé, ou l'unique essai de reprise) ; « wait » : on répond sans réseau. */
    gate(now = Date.now()) {
      if (b.openUntil === 0) return "go";
      if (now < b.openUntil || now < b.probeUntil) return "wait";
      b.probeUntil = now + probeMs;
      return "go";
    },
    /** La source a répondu (même par un « rien trouvé ») : elle n'est pas en panne. */
    answered(now = Date.now()) { b = idle(); lastOkMs = now; },
    /** Un échec de réseau de plus. Vrai quand il ouvre (ou rouvre) la pause. */
    failed(now = Date.now()) {
      b.fails++;
      if (b.openUntil === 0 && b.fails < FAILS_TO_OPEN) return false;
      b.openUntil = now + PAUSE_STEPS_MS[Math.min(b.trips, PAUSE_STEPS_MS.length - 1)];
      b.trips = Math.min(b.trips + 1, PAUSE_STEPS_MS.length);
      b.probeUntil = 0;
      return true;
    },
    reset() { b = idle(); lastOkMs = 0; },
    info(now = Date.now()) { return { open: b.openUntil > now, until: b.openUntil, trips: b.trips, fails: b.fails, lastOkMs }; },
  };
}
