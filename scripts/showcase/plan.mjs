// What the showcase script photographs. One entry per shot: { file, kind: "admin" | "public" | "mobile" | "overlay", tab?, path?, view?, clip?, wait?, noShim?, prep? }.
//   admin    the module's admin page (`/admin/instances/<id>`, optionally a tab), 1280x800
//   public   the module's public page (`/en/<its address>`), 1280x800
//   mobile   the same page at 390x844
//   overlay  the OBS page of the module (`/overlays/<key>`) on a dark backdrop, on real time
// `path` replaces the address ({id} and {key} are the demo instance's). A module that is not listed gets `defaultShots(manifest)`.
// The 15 button-only social modules have no shot of their own: they share `showcase/shared/header-buttons.webp` (SHARED below).
export const VIEWS = { desktop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844 } };
export const SHARED = { "header-buttons.webp": { path: "/en", clip: { x: 0, y: 0, width: 1280, height: 110 } } };
export const BUTTON_ONLY = ["bandcamp", "facebook", "instagram", "kick", "kofi", "patreon", "pinterest", "snapchat", "soundcloud", "spotify", "steam", "telegram", "threads", "tiktok", "x-twitter"];

export function defaultShots(m) {
  if (BUTTON_ONLY.includes(m.id)) return [];
  const shots = [{ file: "admin.webp", kind: "admin" }];
  if (m.page) shots.push({ file: "public.webp", kind: "public" }, { file: "mobile.webp", kind: "mobile" });
  else if ((m.permissions ?? []).includes("overlay")) shots.push(overlay());
  return shots;
}
const overlay = (extra = {}) => ({ file: "overlay.webp", kind: "overlay", noShim: true, wait: 9000, ...extra });
const entries = (key) => ({ file: "admin.webp", kind: "admin", path: `/admin/entries?c=${key}` });
const settingsTab = [{ file: "admin.webp", kind: "admin", tab: "settings" }];
const adminOnly = [{ file: "admin.webp", kind: "admin" }];

export const PLAN = {
  bluesky: settingsTab, discord: settingsTab, github: settingsTab, mastodon: settingsTab, reddit: settingsTab,
  blog: [entries("blog"), { file: "public.webp", kind: "public", path: "/en/blog" }, { file: "mobile.webp", kind: "mobile", path: "/en/blog" }],
  codes: [entries("codes"), { file: "public.webp", kind: "public", path: "/en/codes" }],
  collection: [entries("collection"), { file: "public.webp", kind: "public", path: "/en/collection" }],
  links: [entries("links"), { file: "public.webp", kind: "public", path: "/en/links" }],
  pages: [entries("pages"), { file: "public.webp", kind: "public", path: "/en/about" }],
  sponsors: [entries("sponsors"), { file: "public.webp", kind: "public", path: "/en/sponsors" }],
  hero: [{ file: "admin.webp", kind: "admin" }, { file: "public.webp", kind: "public", path: "/en" }],
  "twitch-raid": adminOnly,
  "twitch-events": [{ file: "admin.webp", kind: "admin" }, { file: "types.webp", kind: "admin", tab: "types" }],
  "twitch-bot": [{ file: "admin.webp", kind: "admin", prep: async (page) => { await page.getByText("All your commands").first().evaluate((e) => e.scrollIntoView({ block: "start" })); await page.waitForTimeout(300); } }],
  "alerts-overlay": [{ file: "admin.webp", kind: "admin" }, overlay({
    wait: 2500,
    prep: async (page, { base, instances }) => {
      const i = instances.find((x) => x.moduleId === "alerts-overlay");
      const admin = await page.context().newPage();
      await admin.goto(`${base}/admin/instances/${i.id}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1500);
      await admin.getByRole("button", { name: "Send", exact: true }).first().click();
      await admin.waitForTimeout(500); await admin.close();
    },
  })],
  "maze-overlay": adminOnly, // the 3D scene is dark and blurry once flattened: the editor is the better picture
  "sponsor-ticker": [{ file: "admin.webp", kind: "admin", tab: "settings" }, overlay()],
  "ticker-overlay": [{ file: "admin.webp", kind: "admin", tab: "settings" }, overlay()],
};
