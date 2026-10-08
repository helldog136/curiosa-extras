// Porté depuis un labyrinthe 3D existant (TypeScript → JavaScript), sans autre changement de logique.
import { isOpen, isPortalCell, isPromoCell, randomOpenCell } from "./generate.js";
import { variantIndex } from "./textures.js";
import { CELL_PATH, CELL_PORTAL, CELL_PROMO, CELL_VOID, DIRECTIONS } from "./types.js";
import { random, roll } from "./random.js";
const ALIGN_EPSILON = 0.001;
// Devant une case promo, une chance sur deux (environ) de ne pas s'arrêter
// et de simplement continuer son chemin — le personnage croise des promos
// sans systématiquement s'y figer.
const STOP_PROBABILITY = 0.55;
// Un même item promo n'est collé que sur 2 cases au maximum dans tout le
// labyrinthe — au-delà, les cases promo excédentaires restent des murs
// normaux plutôt que de répéter la même affiche partout.
const MAX_REPEATS_PER_ITEM = 2;
// Poids relatif de "continuer tout droit" à un embranchement (vs. une
// case pour chaque autre direction) — équivaut à ~65% quand il n'y a que
// deux issues, comme avant, mais se généralise à plus de deux.
const STRAIGHT_WEIGHT = 1.86;
// Multiplicateur appliqué à la direction prise la dernière fois qu'on est
// passé par ce même embranchement dans le même sens — affaiblit la
// probabilité de reprendre la même décision sans jamais l'exclure, pour
// éviter que le personnage ne ressasse le même aller-retour.
const REPEAT_DECISION_PENALTY = 0.35;
// Fenêtre (en UV du mur, 0..1) où le poster est "collé" — centré, sans
// recouvrir toute la surface du mur.
const POSTER_U_MIN = 0.22;
const POSTER_U_MAX = 0.78;
const POSTER_V_MIN = 0.2;
const POSTER_V_MAX = 0.82;
// Flash noir très bref à la téléportation (voir teleportThroughPortal) —
// masque le saut de scène instantané plutôt que de le montrer brut.
const PORTAL_FLASH_SECONDS = 0.12;
// Nombre de segments forcés tout droit en sortant d'un portail (voir
// decideNextDir) avant de pouvoir à nouveau choisir de tourner à un
// embranchement — marque clairement la sortie (au moins 1 case = 1 mètre)
// sans traîner sur "quelques cases".
const POST_PORTAL_STRAIGHT_STEPS = 1;
// Balancement du sprite des mains façon Doom, calé sur la distance
// parcourue (pas sur le temps) : plus on marche vite, plus ça balance
// vite. Amplitudes en fraction de la largeur du canvas interne.
const BOB_FREQUENCY = 4.5;
const BOB_AMPLITUDE_Y = 0.05;
const BOB_AMPLITUDE_X = 0.025;
const BOB_EASE_MOVING = 10;
const BOB_EASE_IDLE = 6;
function angleOf(dir) {
    return Math.atan2(dir.y, dir.x);
}
function normalizeAngle(a) {
    while (a > Math.PI)
        a -= Math.PI * 2;
    while (a < -Math.PI)
        a += Math.PI * 2;
    return a;
}
// Tourne de `maxDelta` radians maximum vers `target`, et s'y cale
// exactement dès que l'écart restant est plus petit — vitesse de rotation
// littérale (rad/s), configurable, plutôt qu'un lissage exponentiel.
function stepAngleTowards(from, to, maxDelta) {
    const diff = normalizeAngle(to - from);
    if (Math.abs(diff) <= maxDelta)
        return to;
    return from + Math.sign(diff) * maxDelta;
}
function randomBetween(min, max) {
    return min + random("timing") * (max - min);
}
// Spline de Catmull-Rom (forme uniforme) : passe exactement par P1 (u=0)
// et P2 (u=1), sa courbure entre les deux étant influencée par P0 (ce qui
// précède) et P3 (ce qui suit) — le marcheur "connaît" donc déjà la case
// suivante en amorçant un virage, la trajectoire courbant progressivement
// vers elle tout au long du segment plutôt que de pivoter sec à l'arrivée
// ou de basculer brutalement à un seuil arbitraire.
function catmullRomPoint(p0, p1, p2, p3, u) {
    const u2 = u * u;
    const u3 = u2 * u;
    return {
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * u + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * u2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * u3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * u + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * u2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * u3),
    };
}
// Dérivée de catmullRomPoint par rapport à `u` — direction de marche
// instantanée (sa tangente), utilisée comme cap visé par la caméra.
function catmullRomTangent(p0, p1, p2, p3, u) {
    const u2 = u * u;
    return {
        x: 0.5 * ((-p0.x + p2.x) + 2 * (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * u + 3 * (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * u2),
        y: 0.5 * ((-p0.y + p2.y) + 2 * (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * u + 3 * (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * u2),
    };
}
// Déplacement à 8 directions (contre 4 pour DIRECTIONS, réservé au rendu/
// à la génération) : les diagonales ne sont praticables que là où les deux
// cases orthogonales adjacentes sont aussi ouvertes (pas de coin coupé à
// travers un mur) — dans un couloir d'une case de large ce n'est jamais le
// cas, donc la diagonale n'apparaît naturellement que dans les salles
// ouvertes (voir generate.ts).
const MOVE_DIRECTIONS = [
    { x: 0, y: -1 }, // 0 N
    { x: 1, y: -1 }, // 1 NE
    { x: 1, y: 0 }, // 2 E
    { x: 1, y: 1 }, // 3 SE
    { x: 0, y: 1 }, // 4 S
    { x: -1, y: 1 }, // 5 SW
    { x: -1, y: 0 }, // 6 W
    { x: -1, y: -1 }, // 7 NW
];
function reverseIndex(i) {
    return (i + 4) % MOVE_DIRECTIONS.length;
}
export class MazeEngine {
    canvas;
    ctx;
    grid;
    wallTextures;
    floorTextures;
    portalTextures;
    opts;
    moveUnitsPerSec;
    turnRadPerSec;
    fovRad;
    promoItems = [];
    promoTextures = [];
    promoCellKeys = [];
    promoAssignment = new Map();
    // Clé "x,y,cameFromDir" → dernière direction choisie à cet embranchement
    // en arrivant de ce sens (voir pickNextDirection).
    junctionMemory = new Map();
    width = 320;
    height = 180;
    imageData;
    pos;
    // Assignées via beginSegment(), appelé dès le constructeur.
    cellFrom;
    cellTo;
    t = 0;
    // Distance réelle du segment en cours (1 en ligne droite, √2 en
    // diagonale) — sert à garder une vitesse constante quel que soit l'angle.
    segmentDistance = 1;
    cameFromDir = -1;
    // Direction déjà tirée au sort pour le prochain segment (la décision ne
    // dépend que de la case d'arrivée et du sens d'où l'on vient, tous deux
    // connus dès le début du segment courant — voir beginSegment) : permet
    // de préparer le lissage du virage pendant la fin du segment courant.
    pendingNextDir = -1;
    // Vecteur (case → case) vers le point "derrière" cellFrom, utilisé comme
    // 1er point de contrôle de la spline (voir splinePoints()) — en temps
    // normal, la case réellement traversée juste avant (cameFromDir). Un
    // vecteur nul (pas d'historique, début de parcours) ou le "virtuel"
    // calculé par teleportThroughPortal (sens inverse du portail) écarte ce
    // défaut pour un segment donné.
    splineBehindVec = { x: 0, y: 0 };
    // Salles (voir buildRoomInfos) : traitées comme de grands carrefours —
    // une seule décision de cible à l'entrée (une sortie ou une affiche),
    // puis un déplacement case par case en ligne directe vers cette cible
    // (la salle est un rectangle plein, jamais d'obstacle à contourner).
    roomLookup = new Map();
    roomInfos = [];
    activeRoom = -1;
    roomEntryCell = null;
    roomTarget = null;
    // Chemin restant (BFS, voir findRoomPath) jusqu'à roomTarget, cases
    // intermédiaires uniquement (sans la case courante) — gère les formes de
    // salle quelconques (concaves, fusionnées) sans jamais sortir de la
    // salle, contrairement à un simple pas "signe de la direction".
    roomPath = [];
    roomTargetKind = "exit";
    roomTargetPromoDir = -1;
    roomTargetExitDir = -1;
    // Au plus une affiche visitée par passage dans une salle — une fois
    // acquis (ou s'il n'y en a pas/plus à viser), la cible suivante est
    // forcément une sortie.
    roomVisitedPoster = false;
    // Anti-répétition du choix de sortie, même principe que junctionMemory
    // mais à l'échelle de la salle (clé "roomIdx,entréeX,entréeY").
    roomJunctionMemory = new Map();
    // Toutes les cases portail du labyrinthe (voir CELL_PORTAL) — la
    // téléportation en choisit une au hasard, potentiellement celle-là même
    // qui vient d'être empruntée.
    portalCells = [];
    // 1 juste après une téléportation, retombe à 0 sur PORTAL_FLASH_SECONDS
    // (voir render()) — masque le changement de scène instantané.
    portalFlash = 0;
    // Nombre de segments restant à forcer tout droit après une
    // téléportation (voir POST_PORTAL_STRAIGHT_STEPS/decideNextDir).
    postPortalStraightSteps = 0;
    // Sprite HUD optionnel ("mains" façon Doom) — absent par défaut, aucun
    // rendu tant qu'il n'est pas fourni (voir setHandsSprite).
    handsSprite = null;
    walkPhase = 0;
    bobX = 0;
    bobY = 0;
    headingAngle = 0;
    camAngle = 0;
    state = "wander";
    nextStopAt = 0;
    lookUntil = 0;
    focusedItem = null;
    running = false;
    lastTime = 0;
    rafId = 0;
    wallBottom = new Float32Array(0);
    wallZ = new Float32Array(0);
    constructor(opts) {
        this.opts = opts;
        this.canvas = opts.canvas;
        this.grid = opts.grid;
        this.wallTextures = opts.wallTextures;
        this.floorTextures = opts.floorTextures;
        this.portalTextures = opts.portalTextures;
        this.moveUnitsPerSec = Math.max(0.1, opts.moveSpeed);
        this.turnRadPerSec = Math.max(10, opts.turnSpeedDegrees) * (Math.PI / 180);
        this.fovRad = Math.max(20, Math.min(150, opts.fovDegrees ?? 66)) * (Math.PI / 180);
        const ctx = this.canvas.getContext("2d");
        if (!ctx)
            throw new Error("Canvas 2D non supporté.");
        this.ctx = ctx;
        this.ctx.imageSmoothingEnabled = false;
        this.buildRoomInfos();
        const start = randomOpenCell(this.grid);
        this.pos = { x: start.x + 0.5, y: start.y + 0.5 };
        this.cellFrom = { ...start };
        const firstDir = this.openDirections(start, -1);
        const dirIndex = firstDir.length > 0 ? firstDir[0] : 0;
        // Aucun historique au tout premier segment : vecteur nul (P0 = P1),
        // la spline ne courbe donc pas avant d'avoir un vrai virage à amorcer.
        this.beginSegment(start, dirIndex, { x: 0, y: 0 });
        this.camAngle = this.headingAngle;
        this.scheduleNextStop();
        for (let y = 0; y < this.grid.height; y++) {
            for (let x = 0; x < this.grid.width; x++) {
                if (isPromoCell(this.grid, x, y))
                    this.promoCellKeys.push(`${x},${y}`);
                if (isPortalCell(this.grid, x, y))
                    this.portalCells.push({ x, y });
            }
        }
        this.imageData = this.ctx.createImageData(this.width, this.height);
        this.resize(this.canvas.clientWidth || 640, this.canvas.clientHeight || 360);
    }
    resize(cssWidth, cssHeight) {
        const aspect = cssWidth > 0 && cssHeight > 0 ? cssWidth / cssHeight : 16 / 9;
        this.height = 200;
        this.width = Math.max(160, Math.round(this.height * aspect));
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        this.ctx.imageSmoothingEnabled = false;
        this.imageData = this.ctx.createImageData(this.width, this.height);
        this.wallBottom = new Float32Array(this.width);
        this.wallZ = new Float32Array(this.width);
    }
    start() {
        if (this.running)
            return;
        this.running = true;
        this.lastTime = performance.now();
        const loop = (now) => {
            if (!this.running)
                return;
            const dt = Math.min((now - this.lastTime) / 1000, 0.1);
            this.lastTime = now;
            this.update(dt, now / 1000);
            this.render();
            this.rafId = requestAnimationFrame(loop);
        };
        this.rafId = requestAnimationFrame(loop);
    }
    stop() {
        this.running = false;
        cancelAnimationFrame(this.rafId);
    }
    // Sprite HUD optionnel ("mains" façon Doom) — `null` retire le sprite
    // (plus rien affiché). Chargé une fois, réutilisé tel quel ensuite.
    setHandsSprite(image) {
        this.handsSprite = image;
    }
    // Remplace la liste de promos et leurs textures pré-rendues (une par
    // item, voir MazeOverlay.tsx) — appelé au chargement puis à chaque
    // rafraîchissement périodique du contenu promo. Chaque item n'est collé
    // que sur MAX_REPEATS_PER_ITEM cases au plus (tirées au sort parmi les
    // cases promo du labyrinthe) ; les cases promo restantes redeviennent de
    // simples murs.
    setPromos(items, textures) {
        this.promoItems = items;
        this.promoTextures = textures;
        this.promoAssignment = new Map();
        if (items.length === 0)
            return;
        const shuffled = [...this.promoCellKeys];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = (random() * (i + 1)) | 0;
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        const maxSlots = Math.min(shuffled.length, items.length * MAX_REPEATS_PER_ITEM);
        for (let i = 0; i < maxSlots; i++) {
            this.promoAssignment.set(shuffled[i], i % items.length);
        }
    }
    // La promo assignée à une case, ou -1 si cette case promo n'a pas reçu
    // d'affiche (au-delà du plafond de répétitions par item) — elle se
    // comporte alors comme un mur normal.
    promoIndexForCell(x, y) {
        return this.promoAssignment.get(`${x},${y}`) ?? -1;
    }
    scheduleNextStop() {
        this.nextStopAt = performance.now() / 1000 + randomBetween(this.opts.stopMinSeconds, this.opts.stopMaxSeconds);
    }
    // Une case praticable (CELL_PATH strict, jamais un portail — voir plus
    // bas) est une case "salle" si au moins un déplacement diagonal y est
    // valide (les deux orthogonales adjacentes ET la diagonale elle-même
    // ouvertes, même sécurité anti-coin-coupé qu'isMoveOpen). Par
    // construction (voir generate.ts), un couloir d'une case de large ne
    // remplit jamais cette condition : un test purement géométrique sur la
    // grille finale, qui fonctionne quelle que soit la forme de la salle
    // (rectangle simple, deux rectangles qui se chevauchent/se touchent et
    // fusionnent en une forme quelconque, zone ouverte éditée à la main dans
    // la carte 2D admin) — contrairement à se fier à une liste de rectangles
    // mémorisée à la génération, qui ne refléterait plus la réalité dès que
    // deux salles se touchent ou qu'une case est modifiée après coup.
    //
    // Volontairement limité à CELL_PATH (sans compter un portail voisin
    // comme "ouvert" malgré isOpen) : un portail adjacent à un couloir ne
    // doit jamais, à lui seul, faire passer ce couloir pour une salle.
    isPathCell(x, y) {
        if (x < 0 || y < 0 || x >= this.grid.width || y >= this.grid.height)
            return false;
        return this.grid.walls[y * this.grid.width + x] === CELL_PATH;
    }
    isRoomCell(x, y) {
        if (!this.isPathCell(x, y))
            return false;
        for (const d of MOVE_DIRECTIONS) {
            if (d.x === 0 || d.y === 0)
                continue;
            if (!this.isPathCell(x + d.x, y + d.y))
                continue;
            if (!this.isPathCell(x + d.x, y))
                continue;
            if (!this.isPathCell(x, y + d.y))
                continue;
            return true;
        }
        return false;
    }
    // Dérive, une fois pour toutes depuis le tracé statique, le lookup
    // "case → index de salle" par flood-fill (4-connexité, suffisante pour
    // fusionner toute zone ouverte contiguë en une seule salle quelle que
    // soit sa forme) à partir des cases "salle" (voir isRoomCell) — pas
    // depuis une liste de rectangles mémorisée à la génération.
    buildRoomInfos() {
        const roomLookup = new Map();
        const roomInfos = [];
        const visited = new Set();
        for (let y = 0; y < this.grid.height; y++) {
            for (let x = 0; x < this.grid.width; x++) {
                const startKey = `${x},${y}`;
                if (visited.has(startKey) || !this.isRoomCell(x, y))
                    continue;
                const cells = [];
                const stack = [{ x, y }];
                visited.add(startKey);
                while (stack.length > 0) {
                    const cur = stack.pop();
                    cells.push(cur);
                    for (const d of DIRECTIONS) {
                        const nx = cur.x + d.x;
                        const ny = cur.y + d.y;
                        const nKey = `${nx},${ny}`;
                        if (visited.has(nKey) || !this.isRoomCell(nx, ny))
                            continue;
                        visited.add(nKey);
                        stack.push({ x: nx, y: ny });
                    }
                }
                const roomIdx = roomInfos.length;
                for (const c of cells)
                    roomLookup.set(`${c.x},${c.y}`, roomIdx);
                roomInfos.push(this.buildRoomInfoFromCells(cells));
            }
        }
        this.roomLookup = roomLookup;
        this.roomInfos = roomInfos;
    }
    // Sorties (cases du pourtour donnant sur un chemin OU un portail
    // extérieur à la salle — un portail se traverse comme un couloir pour le
    // marcheur, voir CELL_PORTAL) et emplacements affiche (case intérieure
    // adjacente à un mur CELL_PROMO), dérivés directement de l'ensemble de
    // cases de la salle — fonctionne pour une forme quelconque, pas
    // seulement un rectangle.
    buildRoomInfoFromCells(cells) {
        const cellSet = new Set(cells.map((c) => `${c.x},${c.y}`));
        const exits = [];
        const promoSpots = [];
        for (const { x, y } of cells) {
            for (let cardinal = 0; cardinal < DIRECTIONS.length; cardinal++) {
                const d = DIRECTIONS[cardinal];
                const nx = x + d.x;
                const ny = y + d.y;
                if (cellSet.has(`${nx},${ny}`))
                    continue;
                if (nx < 0 || ny < 0 || nx >= this.grid.width || ny >= this.grid.height)
                    continue;
                const cellVal = this.grid.walls[ny * this.grid.width + nx];
                if (cellVal === CELL_PATH || cellVal === CELL_PORTAL) {
                    // Cardinal i ↔ MOVE_DIRECTIONS[i*2] (même vecteur, voir les
                    // tableaux DIRECTIONS/MOVE_DIRECTIONS en tête de fichier).
                    exits.push({ x, y, dir: cardinal * 2 });
                }
                else if (cellVal === CELL_PROMO) {
                    promoSpots.push({ standAt: { x, y }, promoCell: { x: nx, y: ny }, dir: cardinal });
                }
            }
        }
        return { cells, exits, promoSpots };
    }
    randomCellInRoom(room) {
        return room.cells[(random() * room.cells.length) | 0];
    }
    // Pathfinding direct à l'intérieur d'une salle (BFS en cases, diagonales
    // incluses avec la même sécurité anti-coin-coupé qu'isMoveOpen) — gère
    // n'importe quelle forme de salle (rectangle simple, salles fusionnées
    // ou non convexes) en ne traversant jamais une case hors de son contour,
    // contrairement à un simple pas "signe de la direction".
    findRoomPath(room, start, target) {
        if (start.x === target.x && start.y === target.y)
            return [];
        const key = (c) => `${c.x},${c.y}`;
        const cellSet = new Set(room.cells.map(key));
        const cameFrom = new Map();
        const visited = new Set([key(start)]);
        const queue = [start];
        for (let qi = 0; qi < queue.length; qi++) {
            const cur = queue[qi];
            if (cur.x === target.x && cur.y === target.y)
                break;
            for (const d of MOVE_DIRECTIONS) {
                const next = { x: cur.x + d.x, y: cur.y + d.y };
                const nKey = key(next);
                if (visited.has(nKey) || !cellSet.has(nKey))
                    continue;
                if (d.x !== 0 && d.y !== 0) {
                    if (!cellSet.has(key({ x: cur.x + d.x, y: cur.y })) || !cellSet.has(key({ x: cur.x, y: cur.y + d.y }))) {
                        continue;
                    }
                }
                visited.add(nKey);
                cameFrom.set(nKey, cur);
                queue.push(next);
            }
        }
        // Sécurité : ne devrait pas arriver (toutes les cases d'une même salle
        // floodfill sont connexes par construction) — saute directement à la
        // cible plutôt que de bloquer le marcheur.
        if (!visited.has(key(target)))
            return [target];
        const path = [];
        let cur = target;
        while (!(cur.x === start.x && cur.y === start.y)) {
            path.push(cur);
            const prev = cameFrom.get(key(cur));
            if (!prev)
                break;
            cur = prev;
        }
        path.reverse();
        return path;
    }
    // Choisit la prochaine cible à l'intérieur de la salle courante depuis
    // `fromCell` (l'entrée de la salle, ou la position actuelle après une
    // affiche/un point erré) : une affiche (au plus une par passage), sinon
    // — en cul-de-sac — un point aléatoire à atteindre avant de ressortir,
    // sinon une sortie (hors celle utilisée pour entrer, sauf si c'est la
    // seule), avec anti-répétition. Calcule aussi le chemin (BFS) à suivre.
    pickNewRoomTarget(roomIdx, fromCell) {
        const room = this.roomInfos[roomIdx];
        const entry = this.roomEntryCell;
        const isDeadEnd = room.exits.length <= 1;
        const setTarget = (target) => {
            this.roomTarget = target;
            this.roomPath = this.findRoomPath(room, fromCell, target);
        };
        if (!this.roomVisitedPoster) {
            const posterSpots = room.promoSpots.filter((p) => this.promoIndexForCell(p.promoCell.x, p.promoCell.y) >= 0);
            const wantsPoster = posterSpots.length > 0 && (isDeadEnd || roll(STOP_PROBABILITY));
            if (wantsPoster) {
                const spot = posterSpots[(random() * posterSpots.length) | 0];
                setTarget(spot.standAt);
                this.roomTargetKind = "poster";
                this.roomTargetPromoDir = spot.dir;
                return;
            }
            if (isDeadEnd) {
                // Pas d'affiche à viser : un point aléatoire de la salle, pour
                // donner l'impression d'explorer avant de faire demi-tour.
                setTarget(this.randomCellInRoom(room));
                this.roomTargetKind = "random";
                return;
            }
        }
        // Direction vers une sortie — hors celle utilisée pour entrer, sauf
        // cul-de-sac où c'est la seule option — avec la même logique
        // anti-répétition que pickNextDirection, à l'échelle de la salle.
        const availableExits = room.exits.filter((e) => !(e.x === entry.x && e.y === entry.y));
        const pool = availableExits.length > 0 ? availableExits : room.exits;
        const memoryKey = `${roomIdx},${entry.x},${entry.y}`;
        const lastExitKey = this.roomJunctionMemory.get(memoryKey);
        const weights = pool.map((e) => (`${e.x},${e.y}` === lastExitKey ? REPEAT_DECISION_PENALTY : 1));
        const total = weights.reduce((sum, w) => sum + w, 0);
        let roll = random() * total;
        let chosen = pool[pool.length - 1];
        for (let i = 0; i < pool.length; i++) {
            roll -= weights[i];
            if (roll <= 0) {
                chosen = pool[i];
                break;
            }
        }
        this.roomJunctionMemory.set(memoryKey, `${chosen.x},${chosen.y}`);
        setTarget({ x: chosen.x, y: chosen.y });
        this.roomTargetKind = "exit";
        this.roomTargetExitDir = chosen.dir;
    }
    // Téléportation : ressort par le mur d'un portail tiré au hasard parmi
    // tous ceux du labyrinthe (potentiellement celui-là même qui vient
    // d'être emprunté — voir CELL_PORTAL). Réapparaît directement dans la
    // case praticable adjacente à ce portail (pas dans la case portail
    // elle-même) : y réapparaître redéclencherait aussitôt la détection
    // "la caméra touche le mur du portail" dans update(), avant même d'avoir
    // eu le temps de s'en éloigner d'un seul pixel — boucle infinie.
    teleportThroughPortal() {
        const destination = this.portalCells[(random() * this.portalCells.length) | 0];
        const outOptions = this.openDirections(destination, -1);
        const outDir = outOptions.length > 0 ? outOptions[(random() * outOptions.length) | 0] : 0;
        const outVec = MOVE_DIRECTIONS[outDir];
        const emergeCell = { x: destination.x + outVec.x, y: destination.y + outVec.y };
        this.pos = { x: emergeCell.x + 0.5, y: emergeCell.y + 0.5 };
        // Même enchaînement qu'une arrivée normale : l'état "salle" de la case
        // d'émergence doit être à jour avant de décider où aller depuis là.
        this.updateRoomStateForCell(emergeCell);
        // Quelques pas forcés tout droit avant de pouvoir à nouveau tourner
        // (voir decideNextDir) — compte aussi ce tout premier pas hors du
        // portail, qui doit lui aussi aller droit devant plutôt que de tourner
        // immédiatement.
        this.postPortalStraightSteps = POST_PORTAL_STRAIGHT_STEPS;
        const nextDir = this.decideNextDir(emergeCell, reverseIndex(outDir));
        // Point de contrôle "derrière" virtuel (côté portail, sens inverse de
        // la sortie) — avec P0 de ce côté, la tangente de la spline à u=0 est
        // déjà perpendiculaire au mur (voire légèrement amorcée vers le
        // prochain virage si la ligne droite était impossible), jamais un
        // angle choisi au hasard ni un saut de vue instantané.
        this.beginSegment(emergeCell, nextDir, { x: -outVec.x, y: -outVec.y });
        const { p0, p1, p2, p3 } = this.splinePoints();
        const initialTangent = catmullRomTangent(p0, p1, p2, p3, 0);
        this.headingAngle = Math.atan2(initialTangent.y, initialTangent.x);
        // La caméra bascule instantanément sur ce cap (contrairement à un
        // virage normal où elle tourne en douceur) — rien ne justifie de
        // pivoter progressivement depuis l'angle d'avant le saut.
        this.camAngle = this.headingAngle;
        // Flash noir très bref (voir PORTAL_FLASH_SECONDS/render()) pour
        // masquer le changement de scène instantané.
        this.portalFlash = 1;
    }
    enterRoom(roomIdx, entryCell) {
        this.activeRoom = roomIdx;
        this.roomEntryCell = entryCell;
        this.roomVisitedPoster = false;
        this.pickNewRoomTarget(roomIdx, entryCell);
    }
    // Bascule l'état "salle" en fonction de la case que le segment en cours
    // de préparation va atteindre — appelé dès que `cellTo` est connu (voir
    // beginSegment), pas seulement à l'arrivée réelle, pour que le lookahead
    // du virage (pendingNextDir) connaisse déjà le bon mode de décision.
    updateRoomStateForCell(cell) {
        const roomIdx = this.roomLookup.get(`${cell.x},${cell.y}`);
        if (roomIdx === undefined) {
            this.activeRoom = -1;
            this.roomTarget = null;
            return;
        }
        if (this.activeRoom !== roomIdx) {
            this.enterRoom(roomIdx, cell);
        }
        // Sinon : on continue vers la cible déjà choisie — l'atteindre est
        // géré à l'arrivée réelle (t>=1 dans update()), pas ici.
    }
    // Direction (MOVE_DIRECTIONS) vers la prochaine case du chemin calculé
    // vers la cible de la salle (voir findRoomPath) — avance d'abord le
    // chemin si `cell` correspond déjà à son prochain maillon (consommé par
    // le segment qui vient de s'y rendre).
    pickRoomDirection(cell) {
        while (this.roomPath.length > 0 && this.roomPath[0].x === cell.x && this.roomPath[0].y === cell.y) {
            this.roomPath.shift();
        }
        const next = this.roomPath[0];
        if (!next)
            return 0;
        const dx = Math.sign(next.x - cell.x);
        const dy = Math.sign(next.y - cell.y);
        const idx = MOVE_DIRECTIONS.findIndex((d) => d.x === dx && d.y === dy);
        return idx >= 0 ? idx : 0;
    }
    // Point d'entrée unique pour "quelle direction prendre depuis `cell`" :
    // pathfinding vers la cible en salle, choix de carrefour pondéré sinon —
    // les salles sont pour le reste traitées comme de grands carrefours (une
    // décision à l'entrée), seul le déplacement interne diffère.
    //
    // Juste après une téléportation (voir postPortalStraightSteps), force
    // quelques pas tout droit dans le couloir de sortie avant de redonner la
    // main au choix de carrefour normal — on ressort du mur du portail en
    // regardant droit devant, pas en amorçant aussitôt un virage.
    decideNextDir(cell, cameFromDir) {
        // Une salle prime toujours — le pathfinding y a sa propre logique,
        // sans rapport avec la contrainte "tout droit" d'une sortie de
        // portail (qui ne concerne que les couloirs).
        if (this.activeRoom >= 0 && this.roomTarget) {
            return this.pickRoomDirection(cell);
        }
        if (this.postPortalStraightSteps > 0) {
            const straightDir = reverseIndex(cameFromDir);
            if (this.isMoveOpen(cell, MOVE_DIRECTIONS[straightDir])) {
                this.postPortalStraightSteps--;
                return straightDir;
            }
            this.postPortalStraightSteps = 0;
        }
        return this.pickNextDirection(cell, cameFromDir);
    }
    // Une diagonale n'est retenue que si la case cible ET les deux cases
    // orthogonales adjacentes sont ouvertes — sinon le personnage couperait
    // à travers un coin de mur. Dans un couloir d'une case de large, les
    // deux orthogonales ne sont jamais ouvertes en même temps : la diagonale
    // n'est donc praticable que dans les salles ouvertes.
    //
    // Les deux orthogonales utilisent isPathCell (CELL_PATH strict), pas
    // isOpen : un portail compte comme un mur pour cette sécurité anti-
    // coin-coupé, sinon un portail posé pile au coin d'un carrefour pourrait
    // à lui seul ouvrir un raccourci diagonal — le personnage qui longe ce
    // coin ne cherche pas forcément à entrer dedans.
    isMoveOpen(cell, d) {
        if (!isOpen(this.grid, cell.x + d.x, cell.y + d.y))
            return false;
        if (d.x !== 0 && d.y !== 0) {
            if (!this.isPathCell(cell.x + d.x, cell.y))
                return false;
            if (!this.isPathCell(cell.x, cell.y + d.y))
                return false;
        }
        return true;
    }
    openDirections(cell, excludeDir) {
        const result = [];
        for (let i = 0; i < MOVE_DIRECTIONS.length; i++) {
            if (i === excludeDir)
                continue;
            if (this.isMoveOpen(cell, MOVE_DIRECTIONS[i]))
                result.push(i);
        }
        return result;
    }
    // `cameFromDir` pointe vers la case d'où l'on vient (donc "faire
    // demi-tour" = reprendre cette direction). On l'exclut des options tant
    // qu'il existe une autre issue ; le demi-tour ne survient que dans un
    // cul-de-sac, quand aucune autre direction n'est praticable — jamais un
    // choix "à gauche ou à droite" arbitraire.
    pickNextDirection(cell, cameFromDir) {
        const options = this.openDirections(cell, cameFromDir);
        if (options.length === 0) {
            return cameFromDir;
        }
        if (options.length === 1) {
            return options[0];
        }
        // Embranchement à choix réel (plusieurs issues) : on retient la
        // dernière décision prise ici en arrivant du même sens, et on
        // l'affaiblit (sans l'exclure) pour éviter que le personnage ne
        // ressasse indéfiniment les mêmes allers-retours sur un même tronçon.
        const straightDir = reverseIndex(cameFromDir);
        const memoryKey = `${cell.x},${cell.y},${cameFromDir}`;
        const lastDir = this.junctionMemory.get(memoryKey);
        const weights = options.map((dir) => {
            let w = dir === straightDir ? STRAIGHT_WEIGHT : 1;
            if (dir === lastDir)
                w *= REPEAT_DECISION_PENALTY;
            return w;
        });
        const total = weights.reduce((sum, w) => sum + w, 0);
        let roll = random() * total;
        let chosen = options[options.length - 1];
        for (let i = 0; i < options.length; i++) {
            roll -= weights[i];
            if (roll <= 0) {
                chosen = options[i];
                break;
            }
        }
        this.junctionMemory.set(memoryKey, chosen);
        return chosen;
    }
    findPromoDirection(cell) {
        const order = [0, 1, 2, 3].sort(() => random() - 0.5);
        for (const i of order) {
            const d = DIRECTIONS[i];
            if (this.promoIndexForCell(cell.x + d.x, cell.y + d.y) >= 0)
                return i;
        }
        return -1;
    }
    beginLookAt(cell, dirIndex) {
        const d = DIRECTIONS[dirIndex];
        const target = { x: cell.x + d.x, y: cell.y + d.y };
        const idx = this.promoIndexForCell(target.x, target.y);
        this.state = "aligning";
        this.headingAngle = angleOf(d);
        this.focusedItem = idx >= 0 ? (this.promoItems[idx] ?? null) : null;
        // Pile centré sur la case en s'arrêtant — aucune variation gauche-
        // droite possible en regardant l'affiche (position figée pendant les
        // états "aligning"/"looking", voir update()).
        this.pos = { x: cell.x + 0.5, y: cell.y + 0.5 };
    }
    // Démarre un nouveau segment de déplacement depuis `from` dans la
    // direction `dirIndex` (index MOVE_DIRECTIONS, cardinale ou diagonale) —
    // ajuste `segmentDistance` (1 ou √2) pour garder une vitesse constante.
    // `behindVec` surcharge le point de contrôle "derrière" de la spline
    // (voir splineBehindVec) — omis, il vaut la case réellement traversée
    // juste avant (cameFromDir), le cas normal.
    beginSegment(from, dirIndex, behindVec) {
        const d = MOVE_DIRECTIONS[dirIndex];
        this.cellFrom = from;
        this.cellTo = { x: from.x + d.x, y: from.y + d.y };
        this.segmentDistance = Math.hypot(d.x, d.y);
        this.cameFromDir = reverseIndex(dirIndex);
        // Filet de sécurité (ex. si pendingNextDir était resté à sa valeur par
        // défaut) : la vraie valeur, affinée par la spline, est recalculée
        // chaque frame dans update().
        this.headingAngle = angleOf(d);
        this.t = 0;
        this.splineBehindVec = behindVec ?? MOVE_DIRECTIONS[this.cameFromDir];
        // Bascule l'état "salle" dès que `cellTo` est connu (pas seulement à
        // l'arrivée réelle) : le lookahead ci-dessous doit déjà savoir si la
        // décision à l'arrivée relèvera du pathfinding en salle ou du choix de
        // carrefour normal (voir decideNextDir/updateRoomStateForCell).
        this.updateRoomStateForCell(this.cellTo);
        // Lookahead : la direction prise à l'arrivée ne dépend que de la case
        // d'arrivée et du sens d'où l'on vient (tous deux déjà connus) — on la
        // tire au sort dès maintenant : c'est elle qui sert de 4e point de
        // contrôle (voir splinePoints()) pour que la trajectoire de CE segment
        // anticipe déjà le virage suivant.
        this.pendingNextDir = this.decideNextDir(this.cellTo, this.cameFromDir);
    }
    // Les 4 points de contrôle de la spline du segment en cours (voir
    // catmullRomPoint/catmullRomTangent) — P1/P2 sont les centres exacts de
    // cellFrom/cellTo, P0 le point "derrière" (vrai historique ou vecteur
    // virtuel, voir splineBehindVec), P3 la case déjà choisie pour le
    // segment suivant (pendingNextDir).
    splinePoints() {
        const p1 = { x: this.cellFrom.x + 0.5, y: this.cellFrom.y + 0.5 };
        const p2 = { x: this.cellTo.x + 0.5, y: this.cellTo.y + 0.5 };
        const p0 = { x: p1.x + this.splineBehindVec.x, y: p1.y + this.splineBehindVec.y };
        const aheadVec = MOVE_DIRECTIONS[this.pendingNextDir];
        const p3 = { x: p2.x + aheadVec.x, y: p2.y + aheadVec.y };
        return { p0, p1, p2, p3 };
    }
    // Fait glisser doucement le bobbing des mains vers sa cible : la vague
    // sinusoïdale (calée sur la distance parcourue, pas le temps) quand on
    // marche, un retour à zéro quand on est arrêté — jamais de coupure nette.
    updateBob(dt) {
        if (this.state === "wander") {
            this.walkPhase += this.moveUnitsPerSec * dt * BOB_FREQUENCY;
            const targetY = Math.abs(Math.sin(this.walkPhase)) * BOB_AMPLITUDE_Y;
            const targetX = Math.sin(this.walkPhase * 0.5) * BOB_AMPLITUDE_X;
            this.bobY += (targetY - this.bobY) * Math.min(1, dt * BOB_EASE_MOVING);
            this.bobX += (targetX - this.bobX) * Math.min(1, dt * BOB_EASE_MOVING);
        }
        else {
            this.bobY += (0 - this.bobY) * Math.min(1, dt * BOB_EASE_IDLE);
            this.bobX += (0 - this.bobX) * Math.min(1, dt * BOB_EASE_IDLE);
        }
    }
    update(dt, nowSeconds) {
        this.camAngle = stepAngleTowards(this.camAngle, this.headingAngle, this.turnRadPerSec * dt);
        this.updateBob(dt);
        this.portalFlash = Math.max(0, this.portalFlash - dt / PORTAL_FLASH_SECONDS);
        if (this.state === "wander") {
            this.t += (this.moveUnitsPerSec / this.segmentDistance) * dt;
            const progress = Math.min(this.t, 1);
            // Position ET cap visé viennent directement de la spline du segment
            // (voir splinePoints/catmullRomPoint/catmullRomTangent) : la
            // trajectoire passe exactement par le centre de cellFrom (u=0) puis
            // cellTo (u=1), et courbe tout du long en fonction de la case
            // derrière (historique réel ou virtuel) et de celle déjà choisie
            // pour la suite (pendingNextDir) — le marcheur "connaît" donc déjà
            // le prochain virage dès le début du segment et lisse sa course en
            // conséquence, rotation et avance confondues, plutôt que d'avancer
            // tout droit puis de basculer le cap à un seuil arbitraire.
            const { p0, p1, p2, p3 } = this.splinePoints();
            this.pos = catmullRomPoint(p0, p1, p2, p3, progress);
            const tangent = catmullRomTangent(p0, p1, p2, p3, progress);
            if (tangent.x !== 0 || tangent.y !== 0) {
                this.headingAngle = Math.atan2(tangent.y, tangent.x);
            }
            // Portail : dès que la caméra touche effectivement le mur (la case
            // dans laquelle elle se trouve, pas seulement une fois le segment
            // "terminé") — sinon on continue d'avancer dedans et on voit au
            // travers un instant avant le saut, au lieu d'une coupure nette.
            const touchedX = Math.floor(this.pos.x);
            const touchedY = Math.floor(this.pos.y);
            const touchedInBounds = touchedX >= 0 && touchedY >= 0 && touchedX < this.grid.width && touchedY < this.grid.height;
            const touchedValue = touchedInBounds ? this.grid.walls[touchedY * this.grid.width + touchedX] : CELL_VOID;
            if (touchedValue === CELL_PORTAL) {
                this.teleportThroughPortal();
                return;
            }
            // Garde-fou ultime : la position ne doit jamais rendre depuis une
            // case non praticable (mur normal ou mur promo) — quelle qu'en soit
            // la cause (configuration admin extrême, cas limite non prévu...),
            // mieux vaut un repli discret sur le centre de la case de départ du
            // segment qu'une caméra qui se retrouve à regarder au travers d'un
            // mur.
            if (!touchedInBounds || (touchedValue !== CELL_PATH && touchedValue !== CELL_PORTAL)) {
                this.pos = { x: this.cellFrom.x + 0.5, y: this.cellFrom.y + 0.5 };
            }
            if (this.t >= 1) {
                const arrivedCell = this.cellTo;
                // Salle en cours : a-t-on atteint la cible choisie à l'entrée (ou
                // après la dernière affiche/le dernier point erré) ? Les salles
                // sont de grands carrefours — une seule décision (sortie ou
                // affiche), le reste n'est que pathfinding direct vers cette cible.
                if (this.activeRoom >= 0 && this.roomTarget && arrivedCell.x === this.roomTarget.x && arrivedCell.y === this.roomTarget.y) {
                    if (this.roomTargetKind === "poster") {
                        this.roomVisitedPoster = true;
                        this.beginLookAt(arrivedCell, this.roomTargetPromoDir);
                        this.cellFrom = arrivedCell;
                        return;
                    }
                    if (this.roomTargetKind === "random") {
                        // Cul-de-sac sans affiche : on vient d'errer jusqu'à ce point,
                        // demi-tour immédiat vers une sortie, sans s'arrêter.
                        this.roomVisitedPoster = true;
                        this.pickNewRoomTarget(this.activeRoom, arrivedCell);
                        this.beginSegment(arrivedCell, this.decideNextDir(arrivedCell, this.cameFromDir));
                        return;
                    }
                    // "exit" : la cible EST la case de sortie — dernier pas vers
                    // l'extérieur (updateRoomStateForCell désactivera le mode salle
                    // dès que ce nouveau segment constatera que sa case d'arrivée
                    // n'appartient plus à aucune salle).
                    this.beginSegment(arrivedCell, this.roomTargetExitDir);
                    return;
                }
                // Promo "au passage" — uniquement hors salle (en salle, les
                // affiches sont des cibles explicites, gérées ci-dessus).
                if (this.activeRoom < 0 && nowSeconds >= this.nextStopAt) {
                    const promoDir = this.findPromoDirection(arrivedCell);
                    if (promoDir >= 0) {
                        if (roll(STOP_PROBABILITY)) {
                            this.beginLookAt(arrivedCell, promoDir);
                            this.cellFrom = arrivedCell;
                            return;
                        }
                        // Passe devant sans s'arrêter cette fois — retente à la
                        // prochaine occasion plutôt que de s'arrêter systématiquement.
                        this.scheduleNextStop();
                    }
                }
                this.beginSegment(arrivedCell, this.pendingNextDir);
            }
            return;
        }
        if (this.state === "aligning") {
            const diff = Math.abs(normalizeAngle(this.headingAngle - this.camAngle));
            if (diff < ALIGN_EPSILON) {
                this.state = "looking";
                this.lookUntil = nowSeconds + this.opts.lookHoldSeconds;
                this.opts.onFocusChange(this.focusedItem);
            }
            return;
        }
        if (this.state === "looking") {
            if (nowSeconds >= this.lookUntil) {
                this.state = "wander";
                this.focusedItem = null;
                this.opts.onFocusChange(null);
                this.scheduleNextStop();
                // En salle, l'affiche vient d'être visitée (roomVisitedPoster déjà
                // mis à jour) : la prochaine cible est forcément une sortie.
                if (this.activeRoom >= 0) {
                    this.pickNewRoomTarget(this.activeRoom, this.cellFrom);
                }
                this.beginSegment(this.cellFrom, this.decideNextDir(this.cellFrom, this.cameFromDir));
            }
        }
    }
    // Une case portail a l'apparence d'un mur, mais avec sa propre texture
    // (voir CELL_PORTAL) — même mécanique de variation que les murs normaux.
    wallTextureFor(mapX, mapY, side) {
        if (this.grid.walls[mapY * this.grid.width + mapX] === CELL_PORTAL) {
            return this.portalTextures[variantIndex(mapX, mapY, side, this.portalTextures.length)];
        }
        return this.wallTextures[variantIndex(mapX, mapY, side, this.wallTextures.length)];
    }
    // Rendu logiciel unique : murs + sol + plafond composés dans le même
    // ImageData puis poussés en un seul putImageData — évite tout conflit
    // d'ordre de dessin entre les trois éléments.
    render() {
        const { width, height } = this;
        const data = this.imageData.data;
        const dirX = Math.cos(this.camAngle);
        const dirY = Math.sin(this.camAngle);
        const planeLen = Math.tan(this.fovRad / 2);
        const planeX = -dirY * planeLen;
        const planeY = dirX * planeLen;
        // Plafond plat en fond — les colonnes de murs dessinées ensuite
        // recouvrent la portion qui leur correspond.
        for (let i = 0; i < data.length; i += 4) {
            data[i] = 10;
            data[i + 1] = 8;
            data[i + 2] = 6;
            data[i + 3] = 255;
        }
        for (let x = 0; x < width; x++) {
            const cameraX = (2 * x) / width - 1;
            const rayDirX = dirX + planeX * cameraX;
            const rayDirY = dirY + planeY * cameraX;
            let mapX = Math.floor(this.pos.x);
            let mapY = Math.floor(this.pos.y);
            const deltaDistX = rayDirX === 0 ? 1e30 : Math.abs(1 / rayDirX);
            const deltaDistY = rayDirY === 0 ? 1e30 : Math.abs(1 / rayDirY);
            let stepX, sideDistX;
            if (rayDirX < 0) {
                stepX = -1;
                sideDistX = (this.pos.x - mapX) * deltaDistX;
            }
            else {
                stepX = 1;
                sideDistX = (mapX + 1 - this.pos.x) * deltaDistX;
            }
            let stepY, sideDistY;
            if (rayDirY < 0) {
                stepY = -1;
                sideDistY = (this.pos.y - mapY) * deltaDistY;
            }
            else {
                stepY = 1;
                sideDistY = (mapY + 1 - this.pos.y) * deltaDistY;
            }
            let side = 0;
            let hit = false;
            for (let i = 0; i < 256 && !hit; i++) {
                if (sideDistX < sideDistY) {
                    sideDistX += deltaDistX;
                    mapX += stepX;
                    side = 0;
                }
                else {
                    sideDistY += deltaDistY;
                    mapY += stepY;
                    side = 1;
                }
                if (mapX < 0 || mapY < 0 || mapX >= this.grid.width || mapY >= this.grid.height) {
                    hit = true;
                    break;
                }
                if (this.grid.walls[mapY * this.grid.width + mapX] !== CELL_PATH)
                    hit = true;
            }
            const perpWallDist = side === 0 ? sideDistX - deltaDistX : sideDistY - deltaDistY;
            const safeDist = Math.max(perpWallDist, 0.0001);
            const lineHeight = Math.max(1, Math.floor(height / safeDist));
            const drawStart = Math.max(0, Math.floor(-lineHeight / 2 + height / 2));
            const drawEnd = Math.min(height - 1, Math.floor(lineHeight / 2 + height / 2));
            this.wallBottom[x] = drawEnd;
            this.wallZ[x] = safeDist;
            let wallX = side === 0 ? this.pos.y + safeDist * rayDirY : this.pos.x + safeDist * rayDirX;
            wallX -= Math.floor(wallX);
            const wallTex = this.wallTextureFor(mapX, mapY, side);
            let wallTexX = Math.floor(wallX * wallTex.width);
            if ((side === 0 && rayDirX > 0) || (side === 1 && rayDirY < 0)) {
                wallTexX = wallTex.width - wallTexX - 1;
            }
            wallTexX = Math.max(0, Math.min(wallTex.width - 1, wallTexX));
            // Case promo : un "poster" collé au centre du mur (voir POSTER_U_*/
            // POSTER_V_* plus haut), pas une texture qui recouvre toute la
            // surface — le reste du mur garde sa texture normale autour, visible
            // en permanence, avant même que le personnage ne s'y arrête.
            const promoIdx = this.promoIndexForCell(mapX, mapY);
            const promoTex = promoIdx >= 0 ? this.promoTextures[promoIdx] : undefined;
            const posterInColumn = !!promoTex && wallX >= POSTER_U_MIN && wallX <= POSTER_U_MAX;
            let posterTexX = 0;
            if (posterInColumn && promoTex) {
                let u = (wallX - POSTER_U_MIN) / (POSTER_U_MAX - POSTER_U_MIN);
                // Une case promo peut avoir plusieurs faces exposées (chemin des
                // deux côtés, dans un coin, etc.) : le sens "lecture normale" de
                // wallX s'inverse selon la face regardée — contrairement au flip
                // Lodev du mur (pensé pour la continuité entre textures répétées,
                // pas pour la lisibilité), donc on applique ici la condition
                // opposée pour que l'affiche reste toujours lisible, quelle que
                // soit la face d'où on la regarde.
                if (!((side === 0 && rayDirX > 0) || (side === 1 && rayDirY < 0))) {
                    u = 1 - u;
                }
                posterTexX = Math.max(0, Math.min(promoTex.width - 1, Math.floor(u * promoTex.width)));
            }
            const fog = Math.min(0.85, safeDist / 12 + (side === 1 ? 0.12 : 0));
            const shade = 1 - fog;
            const wallSrc = wallTex.data.data;
            const posterSrc = promoTex?.data.data;
            const rawStart = -lineHeight / 2 + height / 2;
            for (let y = drawStart; y <= drawEnd; y++) {
                const vFrac = (y - rawStart) / lineHeight;
                const outIdx = (y * width + x) * 4;
                if (posterInColumn && posterSrc && promoTex && vFrac >= POSTER_V_MIN && vFrac <= POSTER_V_MAX) {
                    const v = (vFrac - POSTER_V_MIN) / (POSTER_V_MAX - POSTER_V_MIN);
                    const posterTexY = Math.max(0, Math.min(promoTex.height - 1, Math.floor(v * promoTex.height)));
                    const srcIdx = (posterTexY * promoTex.width + posterTexX) * 4;
                    data[outIdx] = posterSrc[srcIdx] * shade;
                    data[outIdx + 1] = posterSrc[srcIdx + 1] * shade;
                    data[outIdx + 2] = posterSrc[srcIdx + 2] * shade;
                    data[outIdx + 3] = 255;
                }
                else {
                    let wallTexY = Math.floor(vFrac * wallTex.height) % wallTex.height;
                    if (wallTexY < 0)
                        wallTexY += wallTex.height;
                    const srcIdx = (wallTexY * wallTex.width + wallTexX) * 4;
                    data[outIdx] = wallSrc[srcIdx] * shade;
                    data[outIdx + 1] = wallSrc[srcIdx + 1] * shade;
                    data[outIdx + 2] = wallSrc[srcIdx + 2] * shade;
                    data[outIdx + 3] = 255;
                }
            }
        }
        this.renderFloor(data);
        this.ctx.putImageData(this.imageData, 0, 0);
        this.drawHandsSprite();
        // Flash noir de téléportation (voir teleportThroughPortal) — par-dessus
        // tout le reste, y compris le sprite des mains.
        if (this.portalFlash > 0) {
            this.ctx.fillStyle = `rgba(0, 0, 0, ${this.portalFlash})`;
            this.ctx.fillRect(0, 0, this.width, this.height);
        }
    }
    // Sprite HUD dessiné par-dessus la scène (comme l'arme dans un FPS
    // rétro) — ancré en bas, centré, avec le bobbing calculé dans updateBob.
    // Ne dessine rien si aucun sprite n'est configuré.
    drawHandsSprite() {
        if (!this.handsSprite || !this.handsSprite.complete || this.handsSprite.naturalWidth === 0)
            return;
        const spriteW = this.width * 0.55;
        const spriteH = spriteW * (this.handsSprite.naturalHeight / this.handsSprite.naturalWidth);
        const x = (this.width - spriteW) / 2 + this.bobX * this.width;
        const y = this.height - spriteH + this.bobY * this.height;
        this.ctx.drawImage(this.handsSprite, x, y, spriteW, spriteH);
    }
    renderFloor(data) {
        const { width, height } = this;
        if (this.floorTextures.length === 0)
            return;
        const dirX = Math.cos(this.camAngle);
        const dirY = Math.sin(this.camAngle);
        const planeLen = Math.tan(this.fovRad / 2);
        const planeX = -dirY * planeLen;
        const planeY = dirX * planeLen;
        const rayDirX0 = dirX - planeX;
        const rayDirY0 = dirY - planeY;
        const rayDirX1 = dirX + planeX;
        const rayDirY1 = dirY + planeY;
        for (let y = ((height / 2) | 0) + 1; y < height; y++) {
            const p = y - height / 2;
            if (p <= 0)
                continue;
            const rowDistance = height / (2 * p);
            const floorStepX = (rowDistance * (rayDirX1 - rayDirX0)) / width;
            const floorStepY = (rowDistance * (rayDirY1 - rayDirY0)) / width;
            let floorX = this.pos.x + rowDistance * rayDirX0;
            let floorY = this.pos.y + rowDistance * rayDirY0;
            const rowOffset = y * width;
            const fog = Math.min(0.85, rowDistance / 12);
            const shade = 1 - fog;
            for (let x = 0; x < width; x++) {
                if (y <= this.wallBottom[x]) {
                    floorX += floorStepX;
                    floorY += floorStepY;
                    continue;
                }
                const cellX = Math.floor(floorX);
                const cellY = Math.floor(floorY);
                const tex = this.floorTextures[variantIndex(cellX, cellY, 2, this.floorTextures.length)];
                const tx = Math.min(tex.width - 1, Math.max(0, Math.floor((floorX - cellX) * tex.width)));
                const ty = Math.min(tex.height - 1, Math.max(0, Math.floor((floorY - cellY) * tex.height)));
                const srcIdx = (ty * tex.width + tx) * 4;
                const src = tex.data.data;
                const outIdx = (rowOffset + x) * 4;
                data[outIdx] = src[srcIdx] * shade;
                data[outIdx + 1] = src[srcIdx + 1] * shade;
                data[outIdx + 2] = src[srcIdx + 2] * shade;
                data[outIdx + 3] = 255;
                floorX += floorStepX;
                floorY += floorStepY;
            }
        }
    }
}
