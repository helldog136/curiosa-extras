// Porté depuis un labyrinthe 3D existant (TypeScript → JavaScript), sans autre changement de logique.
const FALLBACK_SIZE = 64;
// Damier généré en code — évite un rendu cassé tant que l'admin n'a pas
// uploadé de texture (murs et sol utilisent la même mécanique de fallback).
function buildCheckerboard(colorA, colorB) {
    const canvas = document.createElement("canvas");
    canvas.width = FALLBACK_SIZE;
    canvas.height = FALLBACK_SIZE;
    const ctx = canvas.getContext("2d");
    const cell = FALLBACK_SIZE / 8;
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            ctx.fillStyle = (x + y) % 2 === 0 ? colorA : colorB;
            ctx.fillRect(x * cell, y * cell, cell, cell);
        }
    }
    return canvas;
}
function toLoadedTexture(source) {
    const width = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
    const height = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
    const canvas = document.createElement("canvas");
    canvas.width = width || FALLBACK_SIZE;
    canvas.height = height || FALLBACK_SIZE;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { image: source, data, width: canvas.width, height: canvas.height };
}
export function loadImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
    });
}
export async function loadTextureSet(urls, fallbackColorA, fallbackColorB) {
    if (urls.length === 0) {
        return [toLoadedTexture(buildCheckerboard(fallbackColorA, fallbackColorB))];
    }
    const loaded = await Promise.all(urls.slice(0, 5).map(async (url) => {
        try {
            return toLoadedTexture(await loadImage(url));
        }
        catch {
            return null;
        }
    }));
    const ok = loaded.filter((t) => t !== null);
    return ok.length > 0 ? ok : [toLoadedTexture(buildCheckerboard(fallbackColorA, fallbackColorB))];
}
// Hash stable (pas de scintillement d'une frame à l'autre) pour choisir la
// variante de texture d'une case donnée.
export function variantIndex(cx, cy, side, count) {
    const h = (cx * 73856093) ^ (cy * 19349663) ^ (side * 83492791);
    return Math.abs(h) % Math.max(count, 1);
}
