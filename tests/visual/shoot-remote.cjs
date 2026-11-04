// Captures ET contrôle de débordement de la télécommande Participation (dock 300 px, téléphone portrait et paysage, tablette, bureau), données inventées.
//   node tests/visual/render-remote.mjs (voir ce fichier) puis : node tests/visual/shoot-remote.cjs <dossier des pages> <dossier des captures>
// Sort avec un code d'erreur si la PAGE défile à l'horizontale (la barre d'onglets peut défiler : c'est voulu) ou si un libellé d'onglet est coupé.
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const PAGES = path.resolve(process.argv[2]), OUT = path.resolve(process.argv[3]); fs.mkdirSync(OUT, { recursive: true });
const SIZES = { "300-dock": [300, 760, "dock"], "390-phone": [390, 844, "phone"], "844x390-paysage": [844, 390, "phone"], "768-tablette": [768, 1024, "phone"], "1280-bureau": [1280, 800, "phone"] };
const T = (text, tone = "idle", until = null) => ({ text, tone, until });
const polls = { id: "id-polls", provider: "id-polls", title: "Sondages", tab: "Sondages", state: T("Aucun vote en boucle en cours."), buttons: [{ id: "start", label: "Lancer le vote en boucle", tone: "primary", confirm: "", disabled: false }, { id: "next", label: "Suivant", tone: "plain", confirm: "", disabled: true }, { id: "stop", label: "Arrêter", tone: "danger", confirm: "Le tour en cours sera annulé", disabled: true }],
  forms: [{ id: "quick", title: "A ou B ?", submit: "Lancer le sondage rapide", confirm: "", fields: [{ name: "a", label: "Premier choix", type: "text", max: 40, example: "Par exemple : Pizza", value: "" }, { name: "b", label: "Deuxième choix", type: "text", max: 40, example: "Par exemple : Pâtes", value: "" }, { name: "seconds", label: "Durée", type: "select", value: "30", options: [{ value: "30", label: "30 secondes" }, { value: "60", label: "1 minute" }] }] }] };
const drawForm = { id: "draw-open", title: "Nouveau tirage", submit: "Ouvrir le tirage", confirm: "", fields: [
  { name: "keyword", label: "Mot à dire dans le chat", type: "text", max: 31, example: "Par exemple : !cadeau", value: "!cadeau" },
  { name: "title", label: "Titre", type: "text", max: 60, example: "Par exemple : Cadeau du jour", value: "Cadeau du jour" },
  { name: "level", label: "Qui peut s'inscrire depuis le chat", type: "select", more: true, value: "all", options: [{ value: "all", label: "Tout le monde" }, { value: "sub", label: "Personnes abonnées et modération" }] },
  { name: "site", label: "Inscription depuis le site", type: "select", more: true, value: "1", options: [{ value: "1", label: "Oui" }, { value: "0", label: "Non" }] },
  { name: "winners", label: "Personnes à tirer d'un coup", type: "number", more: true, example: "Entre 1 et 10", value: "1" },
  { name: "minutes", label: "Durée en minutes (facultatif)", type: "number", more: true, example: "Vide : jusqu'à la fermeture", value: "" }] };
const own = (open) => ({ id: "audience", title: "Tirage au sort", tab: "Tirage au sort",
  state: open ? T("« Cadeau du jour » est ouvert. Mot à taper : !cadeau. Inscriptions : 37.", "live", new Date(Date.now() + 9 * 60000).toISOString()) : T("Aucun tirage pour le moment."),
  buttons: open ? [{ id: "draw-close", label: "Fermer", tone: "danger", confirm: "Plus personne ne pourra s'inscrire", disabled: false }, { id: "draw-pick", label: "Tirer une personne au sort", tone: "primary", confirm: "Le résultat s'affichera à l'écran", disabled: false }] : [],
  forms: open ? [] : [drawForm] });
const rooms = [{ key: "polls", label: "Sondages", count: 3, recent: [{ id: "a", pseudo: "etoile_nord", muted: false }, { id: "b", pseudo: "lune_douce", muted: true }, { id: "c", pseudo: "Camille", muted: false }] }];
let mode = { open: false, withPolls: true, fail: false };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname.endsWith("/remote-state")) { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ ok: true, now: Date.now(), panels: [...(mode.withPolls ? [polls] : []), own(mode.open)], rooms })); }
  if (u.pathname.endsWith("/remote-press")) { let b = ""; req.on("data", (d) => b += d); req.on("end", () => { res.writeHead(mode.fail ? 400 : 200, { "content-type": "application/json" }); res.end(JSON.stringify(mode.fail ? { ok: false, error: "invalid", field: "keyword", message: "Écrivez un seul mot, par exemple !cadeau" } : { ok: true, message: "Le tirage est ouvert." })); }); return; }
  const f = path.join(PAGES, u.pathname.replace(/^\//, "").split("?")[0] || "phone.html");
  if (fs.existsSync(f)) { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(fs.readFileSync(f)); }
  res.writeHead(404); res.end();
});
(async () => {
  await new Promise((r) => server.listen(0, r)); const base = `http://127.0.0.1:${server.address().port}`;
  const exe = process.env.CHROMIUM; let browser;
  try { browser = await chromium.launch(exe ? { executablePath: exe } : {}); } catch (e) { browser = await chromium.launch({ executablePath: fs.readdirSync("/opt/pw-browsers").filter((d) => /^chromium-\d+$/.test(d)).map((d) => `/opt/pw-browsers/${d}/chrome-linux64/chrome`).find(fs.existsSync) }); }
  let bad = 0;
  const check = async (page, label) => {
    const r = await page.evaluate(() => {
      const de = document.documentElement, tabs = [...document.querySelectorAll(".ar-tab")];
      return { over: de.scrollWidth - de.clientWidth, cut: tabs.filter((t) => t.scrollWidth > t.clientWidth + 1).map((t) => t.textContent), small: [...document.querySelectorAll("button,input,select,summary")].filter((e) => e.offsetParent && e.getBoundingClientRect().height < (document.body.classList.contains("ar-dock") ? 39.5 : 43.5)).map((e) => (e.textContent || e.name).slice(0, 20)),
        cutText: [...document.querySelectorAll(".ar-btn,.ar-state,label,.ar-hint")].filter((e) => e.offsetParent && e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.slice(0, 30)) };
    });
    if (r.over > 0 || r.cut.length || r.small.length || r.cutText.length) { bad++; console.error("PROBLÈME", label, JSON.stringify(r)); } else console.log("ok", label);
  };
  for (const [name, [w, h, kind]] of Object.entries(SIZES)) {
    for (const scheme of name === "390-phone" || name === "300-dock" ? ["dark", "light"] : ["dark"]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, hasTouch: kind === "phone", isMobile: kind === "phone" && w < 800 });
      const page = await ctx.newPage(); const file = `${kind}.html`;
      const shot = async (n) => { await page.screenshot({ path: path.join(OUT, `${name}-${scheme}-${n}.png`), fullPage: false }); await check(page, `${name} ${scheme} ${n}`); };
      mode = { open: false, withPolls: true, fail: false };
      await page.goto(`${base}/${file}`); await page.waitForSelector(".ar-tab"); await page.waitForTimeout(300);
      await shot("1-onglets-sondages");
      await page.click('.ar-tab:has-text("Tirage")'); await shot("2-onglet-tirage");
      await page.click('[role=tabpanel]:not([hidden]) summary'); await shot("3-plus-doptions");
      await page.fill('[role=tabpanel]:not([hidden]) input[name=keyword]', "deux mots"); mode.fail = true; await page.click('[role=tabpanel]:not([hidden]) button[type=submit]'); await page.waitForTimeout(300); await shot("4-erreur-sous-le-champ");
      await page.keyboard.press("Tab"); await shot("5-focus");
      mode.fail = false; mode.open = true; await page.fill('[role=tabpanel]:not([hidden]) input[name=keyword]', "!cadeau"); await page.click('[role=tabpanel]:not([hidden]) button[type=submit]'); await page.waitForTimeout(600); await page.waitForSelector(".ar-state.live"); await shot("6-tirage-ouvert");
      await page.click('.ar-tab:has-text("Salles")'); await shot("7-salles");
      await ctx.close();
    }
  }
  const ctx = await browser.newContext({ viewport: { width: 300, height: 600 } }); const page = await ctx.newPage(); mode = { open: false, withPolls: false, fail: false };
  await page.goto(`${base}/dock.html`); await page.waitForSelector(".ar-tab"); await page.focus(".ar-tab.on"); await page.keyboard.press("ArrowRight"); await page.screenshot({ path: path.join(OUT, "300-dock-clavier-fleche.png") });
  await browser.close(); server.close();
  console.log(bad ? `${bad} problème(s)` : "aucun débordement, aucun libellé coupé"); process.exit(bad ? 1 : 0);
})();
