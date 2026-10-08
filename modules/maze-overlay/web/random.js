// Source de hasard unique du labyrinthe — c'est ce qui permet le mode développeur :
// en le manipulant, on rend le labyrinthe et la promenade reproductibles ou prévisibles.
//
//   seed  : graine → même tracé, mêmes décisions d'une fois sur l'autre
//   luck  : "always" | "never" | 0..1 → issue des tirages « s'arrêter devant une affiche ? »
//   fast  : les délais tirés au hasard (entre deux arrêts) prennent toujours leur minimum
//
// Sans configuration (production), `random()` est exactement Math.random().
let source = Math.random;
let luck = null;
let fast = false;
let seeded = null;

// Mulberry32 : petit générateur seedé, largement suffisant pour un jeu.
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function configureRandom(dev) {
    source = Math.random;
    luck = null;
    fast = false;
    seeded = null;
    if (!dev) return;
    if (Number.isFinite(dev.seed)) {
        seeded = dev.seed;
        source = mulberry32(dev.seed);
    }
    if (dev.luck === "always") luck = 1;
    else if (dev.luck === "never") luck = 0;
    else if (typeof dev.luck === "number" && dev.luck >= 0 && dev.luck <= 1) luck = dev.luck;
    fast = dev.fast === true;
}

export function getSeed() {
    return seeded;
}

/** Nombre dans [0, 1[. Le canal « timing » (délais) peut être figé à son minimum. */
export function random(channel) {
    if (channel === "timing" && fast) return 0;
    return source();
}

/** Tire à pile ou face avec la probabilité `p` — sauf si le mode développeur force la chance. */
export function roll(p) {
    return source() < (luck ?? p);
}
