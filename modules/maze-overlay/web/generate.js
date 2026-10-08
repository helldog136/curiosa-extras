// Porté depuis un labyrinthe 3D existant (TypeScript → JavaScript), sans autre changement de logique.
import { CELL_PATH, CELL_PORTAL, CELL_PROMO, CELL_VOID, DIRECTIONS, SIZE_CELLS } from "./types.js";
import { random } from "./random.js";
// Part des murs éligibles (adjacents à un chemin) transformés en cases
// promo — assez pour croiser une promo régulièrement, sans en truffer
// chaque recoin du labyrinthe.
const PROMO_RATIO = 0.25;
const PROMO_MIN = 3;
// Quelques portails (bornes selon la taille) — assignés avant les cases
// promo pour ne jamais se disputer le même mur (assignPromoCells ne pioche
// plus que dans les CELL_VOID restants).
const PORTAL_SETTINGS = {
    small: [1, 2],
    medium: [2, 3],
    large: [2, 4],
};
// Salles ouvertes (rectangles carvés d'un bloc, murs compris) ajoutées
// après le labyrinthe "couloirs fins" — nombre et taille (en cases
// bitmap) selon la taille du labyrinthe. C'est dans ces zones ouvertes que
// le personnage peut se déplacer en diagonale (voir engine.ts) : un
// couloir d'une case de large ne laisse jamais les deux coins orthogonaux
// d'une diagonale ouverts en même temps, donc la diagonale n'y est de
// toute façon jamais praticable.
const ROOM_SETTINGS = {
    small: { count: [1, 2], side: [3, 4] },
    medium: { count: [2, 3], side: [4, 5] },
    large: { count: [3, 4], side: [4, 6] },
};
// Génère un labyrinthe "murs fins" par recursive backtracker, puis le
// convertit en bitmap (2*cells+1)² où les cases paires sont les piliers
// (toujours du vide) et les cases impaires les cellules/passages — la
// grille bitmap est directement exploitable par le raycaster (1 case = 1
// unité). Une partie des murs adjacents à un chemin est ensuite désignée
// comme case "promotion" (voir assignPromoCells).
export function generateMaze(size) {
    const cells = SIZE_CELLS[size];
    const width = cells * 2 + 1;
    const height = cells * 2 + 1;
    const walls = new Uint8Array(width * height).fill(CELL_VOID);
    const visited = new Uint8Array(cells * cells);
    const cellIndex = (cx, cy) => cy * cells + cx;
    const bitmapIndex = (bx, by) => by * width + bx;
    const stack = [];
    let cx = (random() * cells) | 0;
    let cy = (random() * cells) | 0;
    visited[cellIndex(cx, cy)] = 1;
    walls[bitmapIndex(cx * 2 + 1, cy * 2 + 1)] = CELL_PATH;
    stack.push([cx, cy]);
    while (stack.length > 0) {
        [cx, cy] = stack[stack.length - 1];
        const order = [...DIRECTIONS].sort(() => random() - 0.5);
        let carved = false;
        for (const dir of order) {
            const nx = cx + dir.x;
            const ny = cy + dir.y;
            if (nx < 0 || ny < 0 || nx >= cells || ny >= cells)
                continue;
            if (visited[cellIndex(nx, ny)])
                continue;
            walls[bitmapIndex(cx * 2 + 1 + dir.x, cy * 2 + 1 + dir.y)] = CELL_PATH;
            walls[bitmapIndex(nx * 2 + 1, ny * 2 + 1)] = CELL_PATH;
            visited[cellIndex(nx, ny)] = 1;
            stack.push([nx, ny]);
            carved = true;
            break;
        }
        if (!carved)
            stack.pop();
    }
    carveRooms(walls, width, height, size);
    assignPortalCells(walls, width, height, size);
    assignPromoCells(walls, width, height);
    return { width, height, walls };
}
// Carve quelques rectangles entièrement ouverts par-dessus le labyrinthe
// "couloirs fins" — une salle écrase les murs (y compris les piliers) sur
// toute sa surface, se raccordant naturellement aux couloirs qui la
// traversaient ou la longeaient. Marge de 1 case pour ne jamais toucher le
// mur d'enceinte extérieur du labyrinthe. Les rectangles carvés ne sont pas
// mémorisés : le moteur détecte les salles directement sur la grille finale
// (voir buildRoomInfos dans engine.ts) — ce qui gère aussi nativement deux
// rectangles qui se chevauchent/se touchent (fusionnés en une seule salle
// de forme quelconque) et les zones ouvertes éditées à la main.
function carveRooms(walls, width, height, size) {
    const { count, side } = ROOM_SETTINGS[size];
    const roomCount = count[0] + Math.floor(random() * (count[1] - count[0] + 1));
    for (let i = 0; i < roomCount; i++) {
        const w = side[0] + Math.floor(random() * (side[1] - side[0] + 1));
        const h = side[0] + Math.floor(random() * (side[1] - side[0] + 1));
        const maxX = width - 2 - w;
        const maxY = height - 2 - h;
        if (maxX < 1 || maxY < 1)
            continue;
        const x0 = 1 + Math.floor(random() * maxX);
        const y0 = 1 + Math.floor(random() * maxY);
        for (let y = y0; y < y0 + h; y++) {
            for (let x = x0; x < x0 + w; x++) {
                walls[y * width + x] = CELL_PATH;
            }
        }
    }
}
// Même principe que assignPromoCells (murs adjacents à un chemin, tirage
// au sort) mais pour un petit nombre fixe de portails plutôt qu'un ratio —
// voir CELL_PORTAL dans types.ts.
function assignPortalCells(walls, width, height, size) {
    const [min, max] = PORTAL_SETTINGS[size];
    const count = min + Math.floor(random() * (max - min + 1));
    const eligible = [];
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            if (walls[idx] !== CELL_VOID)
                continue;
            const adjacentToPath = DIRECTIONS.some((d) => {
                const nx = x + d.x;
                const ny = y + d.y;
                if (nx < 0 || ny < 0 || nx >= width || ny >= height)
                    return false;
                return walls[ny * width + nx] === CELL_PATH;
            });
            if (adjacentToPath)
                eligible.push(idx);
        }
    }
    for (let i = eligible.length - 1; i > 0; i--) {
        const j = (random() * (i + 1)) | 0;
        [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
    }
    for (let i = 0; i < Math.min(count, eligible.length); i++) {
        walls[eligible[i]] = CELL_PORTAL;
    }
}
// Repère les murs adjacents à au moins un chemin praticable et en tire au
// sort une partie pour les marquer CELL_PROMO — ce sont les seuls murs sur
// lesquels une promo pourra s'afficher.
function assignPromoCells(walls, width, height) {
    const eligible = [];
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            if (walls[idx] !== CELL_VOID)
                continue;
            const adjacentToPath = DIRECTIONS.some((d) => {
                const nx = x + d.x;
                const ny = y + d.y;
                if (nx < 0 || ny < 0 || nx >= width || ny >= height)
                    return false;
                return walls[ny * width + nx] === CELL_PATH;
            });
            if (adjacentToPath)
                eligible.push(idx);
        }
    }
    for (let i = eligible.length - 1; i > 0; i--) {
        const j = (random() * (i + 1)) | 0;
        [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
    }
    const count = Math.max(PROMO_MIN, Math.round(eligible.length * PROMO_RATIO));
    for (let i = 0; i < Math.min(count, eligible.length); i++) {
        walls[eligible[i]] = CELL_PROMO;
    }
}
// "Praticable" pour le déplacement du marcheur : un chemin normal ou une
// case portail — un portail a l'apparence d'un mur (voir CELL_PORTAL) mais
// se traverse comme un couloir, la téléportation se déclenchant à
// l'arrivée (voir engine.ts).
export function isOpen(grid, x, y) {
    if (x < 0 || y < 0 || x >= grid.width || y >= grid.height)
        return false;
    const v = grid.walls[y * grid.width + x];
    return v === CELL_PATH || v === CELL_PORTAL;
}
export function isPromoCell(grid, x, y) {
    if (x < 0 || y < 0 || x >= grid.width || y >= grid.height)
        return false;
    return grid.walls[y * grid.width + x] === CELL_PROMO;
}
export function isPortalCell(grid, x, y) {
    if (x < 0 || y < 0 || x >= grid.width || y >= grid.height)
        return false;
    return grid.walls[y * grid.width + x] === CELL_PORTAL;
}
export function randomOpenCell(grid) {
    const open = [];
    for (let y = 0; y < grid.height; y++) {
        for (let x = 0; x < grid.width; x++) {
            if (grid.walls[y * grid.width + x] === CELL_PATH)
                open.push({ x, y });
        }
    }
    return open[(random() * open.length) | 0];
}
export function serializeMazeGrid(grid) {
    return { width: grid.width, height: grid.height, walls: Array.from(grid.walls) };
}
export function deserializeMazeGrid(data) {
    return { width: data.width, height: data.height, walls: Uint8Array.from(data.walls) };
}
