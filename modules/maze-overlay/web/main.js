// Colle navigateur du labyrinthe : remplace MazeOverlay.tsx + PromoFocusCard.tsx du site
// d'origine (React → DOM natif, aucun framework, aucun build). Le moteur, la génération, les
// textures et les affiches sont ceux de la version d'origine (voir les autres fichiers de ce dossier).
import { deserializeMazeGrid, generateMaze } from "./generate.js";
import { loadTextureSet, loadImage } from "./textures.js";
import { drawPromoPoster, setAccent, BADGE_LABELS } from "./poster.js";
import { MazeEngine } from "./engine.js";
import { configureRandom, getSeed } from "./random.js";
import { getTwitchClipEmbedUrl, getYouTubeEmbedUrl } from "./embed.js";

// Assombrit une couleur #rrggbb : second ton du damier de repli des murs et du sol (quand aucune texture n'est donnée).
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.round(v * k).toString(16).padStart(2, "0");
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

const cfg = window.__MAZE__;
const REFRESH_MS = 5 * 60 * 1000;

const root = document.getElementById("vm-root");
const canvas = document.getElementById("vm-canvas");
const focusHost = document.getElementById("vm-focus");

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Carte « focus » : affichée par-dessus le rendu 3D quand le personnage s'arrête devant une affiche.
// Tout le texte passe par textContent : les contenus viennent d'autres modules, jamais du HTML brut.
function showFocus(item) {
  focusHost.replaceChildren();
  if (!item) return;
  const card = el("div", "vm-card");
  card.append(el("div", "vm-badge", (item.badge || BADGE_LABELS[item.kind] || "PROMO").toUpperCase()));
  card.append(el("h2", "vm-title", item.title));

  const body = el("div", "vm-body");
  const video =
    item.kind === "video" || item.kind === "short"
      ? getYouTubeEmbedUrl(item.url)
      : item.kind === "clip"
        ? getTwitchClipEmbedUrl(item.url, location.hostname)
        : null;
  if (video) {
    const frame = el("iframe", "vm-video");
    frame.src = video;
    frame.allow = "autoplay; encrypted-media";
    body.append(frame);
  } else {
    if (item.imageUrl) {
      const img = el("img", "vm-image");
      img.src = item.imageUrl;
      img.alt = "";
      body.append(img);
    }
    if (item.text) body.append(el("p", "vm-text", item.text));
  }
  card.append(body);
  const foot = el("div", "vm-foot");
  if (item.qrSvg) {
    // SVG produit par le cœur à partir de l'URL (jamais du HTML venu d'un autre module).
    const qr = el("div", "vm-qr");
    qr.innerHTML = item.qrSvg;
    foot.append(qr);
  }
  foot.append(el("div", "vm-url", item.url));
  card.append(foot);

  // Décompte discret : la bordure basse épaisse s'affine sur toute la durée d'affichage.
  const bar = el("div", "vm-bar");
  card.append(bar);
  focusHost.append(card);
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      bar.style.transition = `height ${cfg.hold}s linear`;
      bar.style.height = "2px";
    }),
  );
}

let logoUrl = null;
async function fetchItems() {
  try {
    const res = await fetch(cfg.itemsUrl, { cache: "no-store" });
    const data = await res.json();
    if (typeof data.logoUrl === "string") logoUrl = data.logoUrl;
    return Array.isArray(data.items) ? data.items : [];
  } catch {
    return [];
  }
}

// Tracé dessiné à la main dans l'admin (sinon `null` : on génère un labyrinthe au hasard).
async function fetchCustomGrid() {
  try {
    const data = await (await fetch(cfg.mapUrl, { cache: "no-store" })).json();
    const g = data.grid;
    if (g && Number.isInteger(g.width) && Number.isInteger(g.height) && Array.isArray(g.walls) && g.walls.length === g.width * g.height && g.walls.includes(1)) return deserializeMazeGrid(g);
  } catch { /* indisponible : tracé automatique */ }
  return null;
}

let engine = null;
async function applyPromos(items) {
  const textures = await Promise.all(
    items.map(async (item) => {
      const poster = await drawPromoPoster(item, logoUrl);
      const ctx = poster.getContext("2d");
      return ctx ? { data: ctx.getImageData(0, 0, poster.width, poster.height), width: poster.width, height: poster.height } : null;
    }),
  );
  const valid = textures.filter(Boolean);
  engine?.setPromos(items.slice(0, valid.length), valid);
}

async function setup() {
  setAccent(cfg.accent);
  // Mode développeur (réglage de l'instance + paramètres d'URL) : manipule le hasard pour tester.
  configureRandom(cfg.dev);
  if (cfg.dev) console.info("[maze-overlay] dev mode", cfg.dev);
  const items = await fetchItems();
  const [wall, floor, portal, hands] = await Promise.all([
    loadTextureSet(cfg.wall, cfg.wallColor, shade(cfg.wallColor, 0.75)),
    loadTextureSet(cfg.floor, cfg.floorColor, shade(cfg.floorColor, 0.65)),
    loadTextureSet(cfg.portal, "#1a3a6b", "#0d1f3d"),
    cfg.hands ? loadImage(cfg.hands).catch(() => null) : Promise.resolve(null),
  ]);

  const grid = (await fetchCustomGrid()) ?? generateMaze(cfg.size);
  if (cfg.dev) {
    // Empreinte du tracé : deux chargements avec la même graine doivent donner la même.
    window.__MAZE_DEV__ = { seed: getSeed(), gridHash: Array.from(grid.walls).reduce((h, v, i) => (h * 31 + v * (i + 1)) % 1000000007, 7) };
  }
  engine = new MazeEngine({
    canvas,
    grid,
    wallTextures: wall,
    floorTextures: floor,
    portalTextures: portal,
    moveSpeed: cfg.moveSpeed,
    turnSpeedDegrees: cfg.turnSpeed,
    fovDegrees: cfg.fov,
    stopMinSeconds: cfg.stopMin,
    stopMaxSeconds: cfg.stopMax,
    lookHoldSeconds: cfg.hold,
    onFocusChange: showFocus,
  });
  engine.setHandsSprite(hands);
  engine.resize(root.clientWidth, root.clientHeight);
  await applyPromos(items);
  engine.start();
  new ResizeObserver(() => engine.resize(root.clientWidth, root.clientHeight)).observe(root);
  setInterval(async () => applyPromos(await fetchItems()), REFRESH_MS);
}

setup().catch((error) => console.error("[maze-overlay]", error));
