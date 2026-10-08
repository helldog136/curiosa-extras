// Porté depuis un labyrinthe 3D existant (TypeScript → JavaScript), sans autre changement de logique.
// Une case est soit du vide (mur normal), soit un chemin praticable, soit
// un mur spécial "promotion" (affiche une promo dans le rendu 3D), soit un
// mur spécial "portail" — en apparence un mur (texture dédiée), mais
// praticable comme un couloir : le marcheur qui l'atteint est téléporté et
// ressort par un portail tiré au hasard (voir engine.ts).
export const CELL_VOID = 0;
export const CELL_PATH = 1;
export const CELL_PROMO = 2;
export const CELL_PORTAL = 3;
/** N/E/S/W en coordonnées grille (y vers le bas). */
export const DIRECTIONS = [
    { x: 0, y: -1 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
];
export const SIZE_CELLS = {
    small: 7,
    medium: 11,
    large: 15,
};
