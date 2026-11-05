/*
 * Curiosa — petit script de page pour l'administration d'un module (« kit d'ergonomie »).
 *
 * POURQUOI : le cœur ne fournit pas (encore) de bloc « liste à choisir » ni de bloc « journal à vider », ni de bouton d'action isolé sans cadre. Ce fichier ajoute APRÈS COUP, à du
 * HTML que le module écrit lui-même, la recherche en direct et les boutons d'action (amélioration progressive) :
 *   - sans JavaScript, la page reste complète et lisible (la liste entière) ;
 *   - avec JavaScript, la liste se filtre pendant la frappe et un bouton appelle l'action du module.
 * Depuis la 1.12.0 les listes de commandes, de timers et de récompenses sont des TABLEAUX DU CŒUR et leurs formulaires s'ouvrent dans des FENÊTRES du cœur : ce script n'y touche plus
 * (il rangeait les formulaires, posait les interrupteurs et l'aperçu du texte ; tout cela est retiré). Il ne sert plus qu'au journal, aux listes repliées « ajouter… », « choisir
 * une commande » et aux boutons d'action en ligne (vérifier, couper, vider).
 * Il ne dépend de rien (ni bibliothèque ni réseau) et ne touche qu'aux éléments marqués `data-ck-*` (voir adminkit.mjs pour la partie qui écrit le HTML et la route qui sert ce fichier).
 *
 * LES COMPOSANTS (les attributs à poser dans le HTML) :
 *
 * 1. Liste filtrable (recherche en direct + pastilles de filtre)
 *    <div data-ck-list data-ck-instance="ID">
 *      <input type="search" data-ck-q>                         le champ « Rechercher » (insensible à la casse et aux accents ; tous les mots doivent être présents)
 *      <button data-ck-pill data-ck-key="origin" data-ck-val="custom">   une pastille ; data-ck-val="all" = « Toutes » ; une seule pastille active par clé
 *      <tr data-ck-row data-origin="custom" data-state="on" data-hay="texte déjà sans accent ni majuscule">
 *      <div data-ck-empty hidden> … <button data-ck-clear>     « Aucun résultat » + « Effacer la recherche »
 *      <p data-ck-count data-ck-count-tpl="{n} sur {total}">   (facultatif) annonce le nombre de lignes affichées
 *    Une clé de pastille filtre sur l'attribut du même nom de la ligne (`data-<clé>`). Valeur « bad » d'état : les groupes d'états se déclarent dans `data-ck-groups` (JSON,
 *    ex. {"result":{"not":["refused","error"]}}).
 *
 * 2. Action dans un bouton
 *    <button data-ck-act="clearLog" data-ck-confirm="Les 5 dernières lignes seront effacées." data-ck-reload>
 *    Appelle l'action du module par la route du cœur (/api/admin/modules/<instance>/action/<action>), montre le résultat dans [data-ck-status] de la liste.
 *    `data-ck-reload` : recharge la page après la réussite. `data-ck-confirm` : demande d'abord, dans la page (jamais window.confirm).
 */
(function (root) {
  "use strict";

  /* ───────────── Petites aides (pures : testées sous Node) ───────────── */

  /** Sans accents, en minuscules : de quoi comparer « Éléphant » et « elephant ». */
  function norm(s) {
    return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }
  /** Tous les mots de la recherche doivent se trouver dans le texte de la ligne. */
  function matches(hay, query) {
    var words = norm(query).split(/\s+/).filter(Boolean);
    var h = norm(hay);
    for (var i = 0; i < words.length; i++) if (h.indexOf(words[i]) < 0) return false;
    return true;
  }
  /** Une ligne { hay, <clé>: valeur } passe-t-elle le filtre { q, <clé>: valeur ou « all » } ? `groups` : { clé: { valeur du filtre: [valeurs de ligne] } }. */
  function rowPasses(row, filter, groups) {
    if (!matches(row.hay, filter.q || "")) return false;
    for (var key in filter) {
      if (key === "q" || filter[key] === "all" || filter[key] == null) continue;
      var allowed = groups && groups[key] && groups[key][filter[key]];
      if (allowed ? allowed.indexOf(row[key]) < 0 : row[key] !== filter[key]) return false;
    }
    return true;
  }

  /** Remplace {clé} dans un modèle. */
  function fill(tpl, vars) {
    return String(tpl).replace(/\{(\w+)\}/g, function (all, k) { return vars[k] === undefined ? all : String(vars[k]); });
  }

  /* ───────────── Le DOM ───────────── */

  var doc = root.document;
  function el(tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function fire(node, type) { node.dispatchEvent(new root.Event(type, { bubbles: true })); }

  /* 1. Listes filtrables */

  function listFilter(list) {
    var f = { q: "" }, q = list.querySelector("[data-ck-q]");
    if (q) f.q = q.value;
    var pressed = list.querySelectorAll("[data-ck-pill][aria-pressed='true']");
    for (var i = 0; i < pressed.length; i++) f[pressed[i].getAttribute("data-ck-key")] = pressed[i].getAttribute("data-ck-val");
    return f;
  }
  function applyList(list) {
    var f = listFilter(list), groups = {};
    try { groups = JSON.parse(list.getAttribute("data-ck-groups") || "{}"); } catch (e) { groups = {}; }
    var rows = list.querySelectorAll("[data-ck-row]"), shown = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], row = { hay: r.getAttribute("data-hay") || r.textContent };
      for (var key in f) if (key !== "q") row[key] = r.getAttribute("data-" + key);
      var ok = rowPasses(row, f, groups);
      r.hidden = !ok;
      if (ok) shown++;
    }
    var empty = list.querySelector("[data-ck-empty]");
    if (empty) empty.hidden = shown !== 0 || rows.length === 0;
    var count = list.querySelector("[data-ck-count]");
    if (count) count.textContent = fill(count.getAttribute("data-ck-count-tpl") || "{n}/{total}", { n: shown, total: rows.length });
  }
  function bootList(list) {
    if (list.getAttribute("data-ck-ready")) return;
    list.setAttribute("data-ck-ready", "1");
    list.classList.add("ck-on");
    applyList(list);
  }
  doc.addEventListener("input", function (e) {
    var t = e.target;
    if (t && t.matches && t.matches("[data-ck-q]")) { var list = t.closest("[data-ck-list]"); if (list) applyList(list); }
  });
  doc.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && e.target && e.target.matches && e.target.matches("[data-ck-q]") && e.target.value) { e.target.value = ""; fire(e.target, "input"); e.preventDefault(); }
  });
  doc.addEventListener("click", function (e) {
    var pill = e.target.closest && e.target.closest("[data-ck-pill]");
    if (pill) {
      var list = pill.closest("[data-ck-list]"), key = pill.getAttribute("data-ck-key");
      var same = list.querySelectorAll("[data-ck-pill][data-ck-key='" + key + "']");
      for (var i = 0; i < same.length; i++) same[i].setAttribute("aria-pressed", same[i] === pill ? "true" : "false");
      applyList(list);
      return;
    }
    var clear = e.target.closest && e.target.closest("[data-ck-clear]");
    if (clear) {
      var l = clear.closest("[data-ck-list]"), q = l.querySelector("[data-ck-q]");
      if (q) q.value = "";
      var all = l.querySelectorAll("[data-ck-pill][data-ck-val='all']");
      var keys = l.querySelectorAll("[data-ck-pill]");
      for (var k = 0; k < keys.length; k++) keys[k].setAttribute("aria-pressed", "false");
      for (var a = 0; a < all.length; a++) all[a].setAttribute("aria-pressed", "true");
      applyList(l);
      if (q) q.focus();
    }
  });

  /* 2. Interrupteurs et actions */

  function say(list, text, bad) {
    var box = (list && list.querySelector("[data-ck-status]")) || null;
    if (!box) return;
    box.textContent = text || "";
    box.className = "ck-status" + (bad ? " bad" : text ? " good" : "");
    box.setAttribute("role", bad ? "alert" : "status");
  }
  function call(host, action, values) {
    var instance = host.getAttribute("data-ck-instance");
    var body = new root.FormData();
    for (var k in values) body.append(k, values[k]);
    return root.fetch("/api/admin/modules/" + encodeURIComponent(instance) + "/action/" + encodeURIComponent(action), { method: "POST", body: body, headers: { accept: "application/json" }, credentials: "same-origin" })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j.status = r.status; return j; }); });
  }
  function run(btn) {
    var host = btn.closest("[data-ck-instance]"), list = btn.closest("[data-ck-list]") || host;
    if (btn.disabled || !host) return;
    btn.disabled = true;
    say(list, "", false);
    call(host, btn.getAttribute("data-ck-act"), { id: btn.getAttribute("data-ck-id") || "" }).then(function (j) {
      btn.disabled = false;
      if (j.error || (j.status && j.status >= 400 && !j.ok)) {
        say(list, j.error || btn.getAttribute("data-ck-fail") || "", true);
        return;
      }
      say(list, j.ok || "", false);
      if (j.redirect) { root.location.href = j.redirect; return; }
      if (btn.hasAttribute("data-ck-reload")) root.location.reload();
    }).catch(function () {
      btn.disabled = false;
      say(list, btn.getAttribute("data-ck-fail") || "", true);
    });
  }
  /** Demande dans la page (pas de boîte du navigateur) : le texte dit ce qui sera perdu. */
  function ask(btn) {
    var wrap = el("span", "ck-ask"), msg = el("span", "ck-ask-t", btn.getAttribute("data-ck-confirm"));
    var yes = el("button", "ck-btn ck-danger", btn.getAttribute("data-ck-yes") || "OK"), no = el("button", "ck-btn", btn.getAttribute("data-ck-no") || "×");
    yes.type = "button"; no.type = "button";
    wrap.setAttribute("role", "alertdialog"); wrap.setAttribute("aria-label", btn.getAttribute("data-ck-confirm"));
    wrap.appendChild(msg); wrap.appendChild(yes); wrap.appendChild(no);
    btn.hidden = true;
    btn.parentNode.insertBefore(wrap, btn.nextSibling);
    var done = function () { wrap.remove(); btn.hidden = false; btn.focus(); };
    no.addEventListener("click", done);
    yes.addEventListener("click", function () { wrap.remove(); btn.hidden = false; run(btn); });
    wrap.addEventListener("keydown", function (e) { if (e.key === "Escape") done(); });
    no.focus();
  }
  doc.addEventListener("click", function (e) {
    var btn = e.target.closest && e.target.closest("[data-ck-act]");
    if (!btn || btn.tagName === "A") return;
    e.preventDefault();
    if (btn.hasAttribute("data-ck-confirm")) ask(btn); else run(btn);
  });

  /* ───────────── Mise en route ───────────── */

  function scan() {
    var lists = doc.querySelectorAll("[data-ck-list]");
    for (var i = 0; i < lists.length; i++) bootList(lists[i]);
  }
  var pending = false;
  new root.MutationObserver(function () {
    if (pending) return;
    pending = true;
    root.setTimeout(function () { pending = false; scan(); }, 30);
  }).observe(doc.body, { childList: true, subtree: true });

  var api = { scan: scan, norm: norm, matches: matches, rowPasses: rowPasses, fill: fill };
  root.CuriosaKit = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  scan();
})(typeof window !== "undefined" ? window : (function () {
  // Sous Node (tests) : pas de page, seulement les fonctions pures.
  var noop = function () {};
  var fake = { document: { addEventListener: noop, querySelectorAll: function () { return []; }, body: {} }, MutationObserver: function () { return { observe: noop }; }, setTimeout: setTimeout };
  var out = fake;
  Object.defineProperty(out, "__pure", { value: true });
  return out;
})());
