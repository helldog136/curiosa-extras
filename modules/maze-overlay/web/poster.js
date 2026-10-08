// Porté depuis un labyrinthe 3D existant (TypeScript → JavaScript), sans autre changement de logique.
// Rendu une seule fois (pas par frame) puis réutilisé tel quel comme
// "sticker" sur le mur (voir engine.ts) — résolution généreuse pour rester
// net même vu de près, malgré le mur environnant en basse résolution
// rétro.
const SIZE = 1536;
// Couleur d'accent des affiches, réglée par l'instance (voir main.js).
let accent = "#cd853f";
export function setAccent(color) {
    accent = color;
}
export const BADGE_LABELS = {
    code: "CODE PROMO",
    article: "ARTICLE",
    clip: "CLIP TWITCH",
    video: "VIDÉO",
    short: "YOUTUBE SHORTS",
};
// Couleurs de secours (pas de miniature dispo) par type — pas de photo,
// mais un habillage propre plutôt qu'un fond plat.
const FALLBACK_GRADIENTS = {
    code: ["#3a2a14", "#1e1611"],
    article: ["#26201a", "#151311"],
    clip: ["#3a1a4a", "#1a0f22"], // violet Twitch
    video: ["#3a1414", "#1a0d0d"], // rouge YouTube
    short: ["#3a1414", "#1a0d0d"], // même famille que "video"
};
function loadImage(url) {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
    });
}
function roundedRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}
// Dessine `img` en "cover" (comme CSS background-size: cover) dans un
// carré de côté `size` : remplit tout, recadré au centre, sans déformer.
function drawCover(ctx, img, size) {
    const ratio = Math.max(size / img.width, size / img.height);
    const w = img.width * ratio;
    const h = img.height * ratio;
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
}
function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
    const words = text.split(/\s+/);
    const lines = [];
    let line = "";
    for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (ctx.measureText(test).width > maxWidth && line) {
            lines.push(line);
            line = word;
            if (lines.length >= maxLines)
                break;
        }
        else {
            line = test;
        }
    }
    if (line && lines.length < maxLines)
        lines.push(line);
    lines.slice(0, maxLines).forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
    return lines.length;
}
// Panneau promo "soigné" : miniature (cover article/sponsor, thumbnail
// YouTube) en fond, dégradé sombre pour la lisibilité, titre en gros,
// pastille de marque — plutôt qu'un aplat de couleur et une police pixel.
// Pas de QR ici (illisible à distance sur un mur) : le QR n'apparaît que
// sur la carte "focus" plein écran (voir PromoFocusCard.tsx), qui réutilise
// item.qrSvg généré côté API.
export async function drawPromoPoster(item, logoUrl) {
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx)
        return canvas;
    const [bgImage, logoImage] = await Promise.all([
        item.imageUrl ? loadImage(item.imageUrl) : Promise.resolve(null),
        logoUrl ? loadImage(logoUrl) : Promise.resolve(null),
    ]);
    if (bgImage) {
        drawCover(ctx, bgImage, SIZE);
    }
    else {
        const [from, to] = FALLBACK_GRADIENTS[item.kind] ?? FALLBACK_GRADIENTS.code;
        const grad = ctx.createLinearGradient(0, 0, SIZE, SIZE);
        grad.addColorStop(0, from);
        grad.addColorStop(1, to);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, SIZE, SIZE);
        // Pictogramme "lecture" discret pour clip/vidéo sans miniature.
        if (item.kind === "clip" || item.kind === "video" || item.kind === "short") {
            ctx.fillStyle = "rgba(255,255,255,0.12)";
            ctx.beginPath();
            ctx.arc(SIZE / 2, SIZE / 2 - 40, SIZE * 0.16, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "rgba(255,255,255,0.22)";
            ctx.beginPath();
            const px = SIZE / 2 - 30;
            const py = SIZE / 2 - 40;
            const r = SIZE * 0.09;
            ctx.moveTo(px - r * 0.5, py - r);
            ctx.lineTo(px - r * 0.5, py + r);
            ctx.lineTo(px + r, py);
            ctx.closePath();
            ctx.fill();
        }
    }
    // Dégradé bas pour la lisibilité du texte, que le fond soit une photo ou
    // un aplat.
    const overlay = ctx.createLinearGradient(0, SIZE * 0.38, 0, SIZE);
    overlay.addColorStop(0, "rgba(10,8,6,0)");
    overlay.addColorStop(0.55, "rgba(10,8,6,0.72)");
    overlay.addColorStop(1, "rgba(10,8,6,0.94)");
    ctx.fillStyle = overlay;
    ctx.fillRect(0, SIZE * 0.38, SIZE, SIZE * 0.62);
    // Cadre.
    ctx.strokeStyle = accent;
    ctx.lineWidth = SIZE * 0.012;
    ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, SIZE - ctx.lineWidth, SIZE - ctx.lineWidth);
    // Pastille badge (type de contenu).
    const badgeText = (item.badge || BADGE_LABELS[item.kind] || "PROMO").toUpperCase();
    ctx.font = `700 ${SIZE * 0.036}px "Arial", sans-serif`;
    const badgePadX = SIZE * 0.028;
    const badgeW = ctx.measureText(badgeText).width + badgePadX * 2;
    const badgeH = SIZE * 0.07;
    const badgeX = SIZE * 0.05;
    const badgeY = SIZE * 0.05;
    ctx.fillStyle = accent;
    roundedRectPath(ctx, badgeX, badgeY, badgeW, badgeH, badgeH / 2);
    ctx.fill();
    ctx.fillStyle = "#130e0b";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(badgeText, badgeX + badgePadX, badgeY + badgeH / 2 + SIZE * 0.002);
    ctx.textBaseline = "alphabetic";
    // Titre, en bas, sur le dégradé.
    ctx.textAlign = "left";
    ctx.fillStyle = "#f8f5f0";
    ctx.font = `900 ${SIZE * 0.072}px "Arial Black", Impact, sans-serif`;
    wrapText(ctx, item.title, SIZE * 0.05, SIZE * 0.8, SIZE * 0.9, SIZE * 0.082, 2);
    // Logo du site, petit filigrane en haut à droite.
    if (logoImage) {
        const logoH = SIZE * 0.06;
        const logoW = logoH * (logoImage.width / logoImage.height);
        ctx.globalAlpha = 0.85;
        ctx.drawImage(logoImage, SIZE - logoW - SIZE * 0.05, SIZE * 0.05, logoW, logoH);
        ctx.globalAlpha = 1;
    }
    return canvas;
}
