/*
 * Curiosa — petit script de page pour l'administration d'un module (« kit d'ergonomie »).
 *
 * POURQUOI : le cœur 0.5.x ne sait pas encore faire une recherche qui filtre en direct, un interrupteur dans une ligne, des boutons segmentés, une zone « Plus d'options »
 * ou un contrôle de période. Ce fichier les ajoute APRÈS COUP à du HTML que le module écrit lui-même (amélioration progressive) :
 *   - sans JavaScript, la page reste complète et lisible (la liste entière, tous les champs) ;
 *   - avec JavaScript, la liste se filtre pendant la frappe, l'état se change d'un clic, et les formulaires se rangent.
 * Il ne dépend de rien (ni bibliothèque ni réseau), ne touche qu'aux éléments marqués `data-ck-*` et aux formulaires qui portent un champ caché `ck`, et peut être réutilisé
 * tel quel par un autre module (voir adminkit.mjs pour la partie qui écrit le HTML et la route qui sert ce fichier). À proposer comme composants du cœur : voir le rapport de la PR.
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
 *    ex. {"state":{"hidden":["hidden","missing"]}}).
 *
 * 2. Interrupteur / action dans une ligne
 *    <button role="switch" aria-checked="true" data-ck-act="toggle" data-ck-id="custom:ab12" data-ck-switch>
 *    <button data-ck-act="timerSend" data-ck-id="t1" data-ck-confirm="Envoyer ce message tout de suite ?">
 *    Appelle l'action du module par la route du cœur (/api/admin/modules/<instance>/action/<action>), montre le résultat dans [data-ck-status] de la liste.
 *    `data-ck-reload` : recharge la page après la réussite. `data-ck-confirm` : demande d'abord, dans la page (jamais window.confirm).
 *
 * 3. Formulaire rangé : un champ caché <input type="hidden" name="ck" value="ID"> dans le formulaire du cœur, et un élément [data-ck-config="ID"] (JSON dans son attribut
 *    `data-ck-json`) qui dit comment ranger les champs : voir `buildForm` plus bas (segmented, more, sentence, period, preview/chips).
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

  var TEXT_RE = /^\s*(\d{1,2})\s*[\/.-]\s*(\d{1,2})(?:\s*[\/.-]\s*(\d{4}))?\s*$/;
  /** « 01/11 - 30/11 » → { yearly: true, from: {d,m}, to: {d,m} } ; avec années → yearly false ; vide → null ; illisible → "bad". */
  function parsePeriodText(text) {
    var raw = String(text == null ? "" : text).trim();
    if (!raw) return null;
    var parts = raw.split(/\s+(?:-|–|—|au|to|→|>)\s+|\s*(?:–|—|→)\s*/i);
    if (parts.length !== 2) return "bad";
    var a = TEXT_RE.exec(parts[0]), b = TEXT_RE.exec(parts[1]);
    if (!a || !b) return "bad";
    var side = function (m) { var o = { d: +m[1], m: +m[2] }; if (m[3]) o.y = +m[3]; return o; };
    var from = side(a), to = side(b);
    return { yearly: from.y === undefined && to.y === undefined, from: from, to: to };
  }
  var two = function (n) { return (n < 10 ? "0" : "") + n; };
  /** L'inverse : { yearly, from, to } → « 01/11 - 30/11 » ou « 01/11/2026 - 30/11/2026 ». */
  function periodToText(p) {
    if (!p) return "";
    var one = function (x) { return two(x.d) + "/" + two(x.m) + (p.yearly ? "" : "/" + x.y); };
    return one(p.from) + " - " + one(p.to);
  }
  /** Ce qui ne va pas dans une période saisie (clé de message) ou null : "incomplete", "nodate" (avec day/month), "year", "order". */
  function periodProblem(p, dim) {
    if (!p) return null;
    var sides = [p.from, p.to];
    for (var i = 0; i < 2; i++) {
      var s = sides[i];
      if (!s.d || !s.m) return { key: "incomplete" };
      if (s.d > dim[s.m - 1]) return { key: "nodate", day: s.d, month: s.m };
    }
    if (!p.yearly) {
      for (var j = 0; j < 2; j++) if (!sides[j].y || sides[j].y < 2000 || sides[j].y > 2100) return { key: "year" };
      if (p.from.y * 10000 + p.from.m * 100 + p.from.d > p.to.y * 10000 + p.to.m * 100 + p.to.d) return { key: "order" };
    }
    return null;
  }
  /** « 1er novembre » (fr) / « 1 November » : la date écrite en toutes lettres. */
  function dateWords(x, cfg, withYear) {
    var day = String(cfg.locale).indexOf("fr") === 0 && x.d === 1 ? "1er" : String(x.d);
    return day + " " + cfg.months[x.m - 1] + (withYear && x.y ? " " + x.y : "");
  }
  /** Remplace {clé} dans un modèle. */
  function fill(tpl, vars) {
    return String(tpl).replace(/\{(\w+)\}/g, function (all, k) { return vars[k] === undefined ? all : String(vars[k]); });
  }
  /** Aperçu d'une réponse : remplace les morceaux simples connus ({jeu}…) par leur valeur du moment ; les autres restent tels quels. */
  function previewText(text, samples) {
    return String(text).replace(/\{([^{}\s]+)\}/g, function (all, name) {
      var k = norm(name);
      return Object.prototype.hasOwnProperty.call(samples || {}, k) ? samples[k] : all;
    });
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
    var isSwitch = btn.hasAttribute("data-ck-switch"), was = btn.getAttribute("aria-checked");
    if (btn.disabled || !host) return;
    if (isSwitch) btn.setAttribute("aria-checked", was === "true" ? "false" : "true");
    btn.disabled = true;
    say(list, "", false);
    call(host, btn.getAttribute("data-ck-act"), { id: btn.getAttribute("data-ck-id") || "" }).then(function (j) {
      btn.disabled = false;
      if (j.error || (j.status && j.status >= 400 && !j.ok)) {
        if (isSwitch) btn.setAttribute("aria-checked", was);
        say(list, j.error || btn.getAttribute("data-ck-fail") || "", true);
        return;
      }
      if (isSwitch) {
        var row = btn.closest("[data-ck-row]"), on = btn.getAttribute("aria-checked") === "true";
        if (row) {
          var next = on ? (row.getAttribute("data-on-state") || "on") : "off";
          row.setAttribute("data-state", next);
          var note = row.querySelector("[data-ck-note]");
          if (note) { note.textContent = on ? (row.getAttribute("data-on-note") || "") : ""; note.hidden = !note.textContent; }
          if (list) applyList(list);
        }
      }
      say(list, j.ok || "", false);
      if (j.redirect) { root.location.href = j.redirect; return; }
      if (btn.hasAttribute("data-ck-reload")) root.location.reload();
    }).catch(function () {
      btn.disabled = false;
      if (isSwitch) btn.setAttribute("aria-checked", was);
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

  /* 3. Formulaires rangés */

  /** Le bloc (enfant direct de la grille du formulaire du cœur) qui porte le champ `name`. */
  function fieldBox(form, name) {
    var node = form.elements.namedItem(name);
    if (!node) return null;
    if (node.length !== undefined && node.tagName !== "SELECT") node = node[0];
    while (node && node.parentElement && node.parentElement.parentElement !== form) node = node.parentElement;
    return node && node.parentElement ? node : null;
  }
  function labelOf(form, name) {
    var node = form.elements.namedItem(name);
    var lab = node && node.id ? form.querySelector("label[for='" + node.id + "']") : null;
    return lab ? lab.textContent.trim() : name;
  }
  function hideAll(box, selector) { var n = box.querySelectorAll(selector); for (var i = 0; i < n.length; i++) n[i].hidden = true; }

  /** Un choix à 2-4 valeurs : boutons segmentés, branchés sur la liste d'origine (qui garde la valeur envoyée). */
  function segmented(form, select) {
    var group = el("div", "ck-seg"), buttons = [];
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", labelOf(form, select.name));
    function sync() {
      buttons.forEach(function (b) {
        var on = b.getAttribute("data-v") === select.value;
        b.setAttribute("aria-checked", on ? "true" : "false");
        b.tabIndex = on ? 0 : -1;
      });
    }
    Array.prototype.forEach.call(select.options, function (o, i) {
      var b = el("button", "ck-seg-b", o.text);
      b.type = "button"; b.setAttribute("role", "radio"); b.setAttribute("data-v", o.value);
      b.addEventListener("click", function () { select.value = o.value; fire(select, "change"); sync(); });
      b.addEventListener("keydown", function (e) {
        var d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        var n = buttons[(i + d + buttons.length) % buttons.length];
        n.focus(); n.click();
      });
      buttons.push(b); group.appendChild(b);
    });
    select.hidden = true;
    select.parentNode.insertBefore(group, select.nextSibling);
    form.addEventListener("reset", function () { root.setTimeout(sync, 0); });
    select.addEventListener("change", sync);
    sync();
    return group;
  }

  /** « Attendre [ ] s entre deux réponses, et [ ] s pour une même personne » : une phrase, des champs au milieu. */
  function sentence(form, spec) {
    var wrap = el("div", "ck-section");
    if (spec.title) wrap.appendChild(el("div", "ck-legend", spec.title));
    var line = el("div", "ck-line"), fields = [];
    spec.tokens.forEach(function (tok) {
      if (typeof tok === "string") { line.appendChild(el("span", "ck-word", tok)); return; }
      var input = form.elements.namedItem(tok.f), box = fieldBox(form, tok.f);
      if (!input) return;
      input.setAttribute("aria-label", labelOf(form, tok.f));
      input.classList.add("ck-num");
      if (tok.ph) input.placeholder = tok.ph;
      if (tok.min != null) input.min = tok.min;
      if (tok.max != null) input.max = tok.max;
      input.inputMode = "numeric";
      if (box) box.hidden = true;
      line.appendChild(input);
      fields.push(input);
    });
    wrap.appendChild(line);
    if (spec.hint) wrap.appendChild(el("p", "ck-hint", spec.hint));
    wrap.__isSet = function () { return fields.some(function (f) { return String(f.value).trim() !== ""; }); };
    return wrap;
  }

  /** LE contrôle de période (commandes ET timers) : « Toujours active » ↔ « Seulement pendant une période », puis « Du [jour][mois] au [jour][mois] » + « Chaque année ». */
  function periodControl(form, cfg) {
    var input = form.elements.namedItem(cfg.field), box = fieldBox(form, cfg.field), T = cfg.text;
    if (!input || !box) return null;
    hideAll(box, "label, p");
    input.hidden = true;
    var parsed = parsePeriodText(input.value);
    var st = { range: parsed !== null, yearly: !parsed || parsed === "bad" ? true : parsed.yearly, from: parsed && parsed !== "bad" ? parsed.from : {}, to: parsed && parsed !== "bad" ? parsed.to : {} };
    var ui = el("div", "ck-section ck-period");
    ui.appendChild(el("div", "ck-legend", T.title));

    var mode = el("div", "ck-seg"), mAlways = el("button", "ck-seg-b", T.always), mRange = el("button", "ck-seg-b", T.range);
    mode.setAttribute("role", "radiogroup"); mode.setAttribute("aria-label", T.title);
    [mAlways, mRange].forEach(function (b, i) {
      b.type = "button"; b.setAttribute("role", "radio");
      b.addEventListener("click", function () { st.range = i === 1; render(true); });
      b.addEventListener("keydown", function (e) {
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); var o = i ? mAlways : mRange; o.focus(); o.click(); }
      });
      mode.appendChild(b);
    });
    ui.appendChild(mode);

    var panel = el("div", "ck-range");
    var chips = el("div", "ck-chips");
    cfg.shortcuts.forEach(function (s) {
      var c = el("button", "ck-chip", s.label); c.type = "button";
      c.addEventListener("click", function () { st.yearly = true; st.from = { d: s.from[1], m: s.from[0] }; st.to = { d: s.to[1], m: s.to[0] }; render(true); });
      chips.appendChild(c);
    });
    panel.appendChild(chips);

    function select(kind, value, label) {
      var s = el("select", "ck-sel"), n = kind === "d" ? 31 : 12;
      s.setAttribute("aria-label", label);
      var o0 = el("option", null, label); o0.value = ""; s.appendChild(o0);
      for (var i = 1; i <= n; i++) { var o = el("option", null, kind === "d" ? String(i) : cfg.months[i - 1]); o.value = String(i); s.appendChild(o); }
      s.value = value ? String(value) : "";
      return s;
    }
    var line = el("div", "ck-line ck-dates");
    var fd = select("d", st.from.d, T.day), fm = select("m", st.from.m, T.month), td = select("d", st.to.d, T.day), tm = select("m", st.to.m, T.month);
    var yearlyLine = [el("span", "ck-word", T.from), fd, fm, el("span", "ck-word", T.to), td, tm];
    yearlyLine.forEach(function (n) { line.appendChild(n); });
    var onceLine = el("div", "ck-line ck-dates");
    var dFrom = el("input", "ck-date"), dTo = el("input", "ck-date");
    dFrom.type = "date"; dTo.type = "date";
    dFrom.min = dTo.min = "2000-01-01"; dFrom.max = dTo.max = "2100-12-31";
    dFrom.setAttribute("aria-label", T.dateFrom); dTo.setAttribute("aria-label", T.dateTo);
    [el("span", "ck-word", T.from), dFrom, el("span", "ck-word", T.to), dTo].forEach(function (n) { onceLine.appendChild(n); });
    panel.appendChild(line); panel.appendChild(onceLine);

    var yl = el("label", "ck-check"), yc = el("input"); yc.type = "checkbox";
    yl.appendChild(yc); yl.appendChild(doc.createTextNode(" " + T.yearly));
    panel.appendChild(yl);
    var phrase = el("p", "ck-phrase"), err = el("p", "ck-err");
    phrase.setAttribute("aria-live", "polite"); err.setAttribute("role", "alert");
    panel.appendChild(phrase); panel.appendChild(err);
    ui.appendChild(panel);
    input.parentNode.insertBefore(ui, input);

    var isoOf = function (x) { return x.y && x.m && x.d ? x.y + "-" + two(x.m) + "-" + two(x.d) : ""; };
    function fromControls() {
      if (st.yearly) {
        st.from = { d: +fd.value || 0, m: +fm.value || 0 }; st.to = { d: +td.value || 0, m: +tm.value || 0 };
      } else {
        var a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dFrom.value), b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dTo.value);
        st.from = a ? { y: +a[1], m: +a[2], d: +a[3] } : {}; st.to = b ? { y: +b[1], m: +b[2], d: +b[3] } : {};
      }
    }
    function toControls() {
      fd.value = st.from.d ? String(st.from.d) : ""; fm.value = st.from.m ? String(st.from.m) : "";
      td.value = st.to.d ? String(st.to.d) : ""; tm.value = st.to.m ? String(st.to.m) : "";
      dFrom.value = isoOf(st.from); dTo.value = isoOf(st.to);
    }
    function value() {
      if (!st.range) return "";
      var p = { yearly: st.yearly, from: st.from, to: st.to };
      if (periodProblem(p, cfg.dim) && periodProblem(p, cfg.dim).key === "incomplete") return "…";
      return periodToText(p);
    }
    function render(write) {
      mAlways.setAttribute("aria-checked", st.range ? "false" : "true"); mRange.setAttribute("aria-checked", st.range ? "true" : "false");
      mAlways.tabIndex = st.range ? -1 : 0; mRange.tabIndex = st.range ? 0 : -1;
      panel.hidden = !st.range;
      yc.checked = st.yearly;
      line.hidden = !st.yearly; onceLine.hidden = st.yearly;
      if (write) toControls();
      var p = { yearly: st.yearly, from: st.from, to: st.to }, problem = st.range ? periodProblem(p, cfg.dim) : null;
      err.hidden = !problem; err.textContent = "";
      phrase.hidden = !st.range || !!problem;
      if (problem) {
        var msg = problem.key === "nodate" ? fill(T.eNodate, { day: problem.day, month: cfg.months[problem.month - 1], example: (problem.month === 2 ? 28 : cfg.dim[problem.month - 1]) + " " + cfg.months[problem.month - 1] })
          : problem.key === "year" ? T.eYear : problem.key === "order" ? T.eOrder : T.eText;
        err.textContent = "⚠ " + msg;
      } else if (st.range) {
        phrase.textContent = fill(st.yearly ? T.phraseYearly : T.phraseOnce, { from: dateWords(st.from, cfg, !st.yearly), to: dateWords(st.to, cfg, !st.yearly) });
      }
      if (write) { input.value = value(); fire(input, "input"); }
    }
    [fd, fm, td, tm, dFrom, dTo].forEach(function (c) { c.addEventListener("change", function () { fromControls(); render(false); input.value = value(); fire(input, "input"); }); });
    yc.addEventListener("change", function () {
      var yearNow = cfg.year;
      if (yc.checked) { st.yearly = true; st.from = { d: st.from.d, m: st.from.m }; st.to = { d: st.to.d, m: st.to.m }; }
      else {
        st.yearly = false;
        var f = { y: yearNow, m: st.from.m, d: st.from.d }, t = { y: yearNow, m: st.to.m, d: st.to.d };
        if (f.m && t.m && (t.m * 100 + t.d) < (f.m * 100 + f.d)) t.y = yearNow + 1;   // à cheval sur le changement d'année
        st.from = f; st.to = t;
      }
      render(true);
    });
    form.addEventListener("reset", function () {
      root.setTimeout(function () {
        var p = parsePeriodText(input.value);
        st.range = p !== null; st.yearly = !p || p === "bad" ? true : p.yearly; st.from = p && p !== "bad" ? p.from : {}; st.to = p && p !== "bad" ? p.to : {};
        render(true);
      }, 0);
    });
    render(true);
    input.value = value() || (parsed === "bad" ? input.value : "");
    ui.__isSet = function () { return st.range; };
    ui.__focus = function () { var t = st.range ? (st.yearly ? fd : dFrom) : mAlways; t.focus(); ui.scrollIntoView({ block: "center" }); };
    return ui;
  }

  /** La mise en page d'un formulaire du cœur d'après sa configuration (voir adminkit.mjs, formConfig). */
  function buildForm(form, cfg) {
    var first = cfg.layout.map(function (it) { return it.f || it.seg; }).filter(Boolean)[0];
    var anchor = first && fieldBox(form, first);
    if (!anchor) return;
    var grid = anchor.parentElement, rootBox = el("div", "ck-form");
    grid.insertBefore(rootBox, grid.firstChild);
    var more = null, moreItems = [];

    function place(item, into) {
      if (item.f) {
        var b = fieldBox(form, item.f);
        if (!b) return null;
        into.appendChild(b);
        b.classList.add("ck-field");
        if (item.preview) textExtras(form, item.f, b, item.preview);
        return b;
      }
      if (item.seg) {
        var s = form.elements.namedItem(item.seg), sb = fieldBox(form, item.seg);
        if (!s || !sb) return null;
        into.appendChild(sb); sb.classList.add("ck-field");
        segmented(form, s);
        return sb;
      }
      if (item.sentence) { var sn = sentence(form, item.sentence); into.appendChild(sn); return sn; }
      if (item.period) { var p = periodControl(form, item.period); if (p) { into.appendChild(fieldBox(form, item.period.field)); } return p; }
      return null;
    }
    cfg.layout.forEach(function (item) {
      if (!item.more) { place(item, rootBox); return; }
      var d = el("details", "ck-more"), sum = el("summary"), t = el("span", "ck-more-t", item.more.title), h = el("span", "ck-more-h", item.more.hint), now = el("span", "ck-more-now");
      sum.appendChild(t); sum.appendChild(h); sum.appendChild(now);
      d.appendChild(sum);
      var body = el("div", "ck-more-body");
      d.appendChild(body);
      if (item.more.open) d.open = true;
      rootBox.appendChild(d);
      more = d;
      item.more.items.forEach(function (sub) {
        var node = place(sub, body), label = sub.label || (sub.sentence && sub.sentence.title) || (sub.period && sub.period.text.title) || (sub.f && labelOf(form, sub.f));
        moreItems.push({ node: node, field: sub.f, label: label, sentence: !!sub.sentence, period: !!sub.period });
      });
      var refresh = function () {
        var set = [];
        moreItems.forEach(function (m) {
          var on = m.field ? (form.elements.namedItem(m.field) && String(form.elements.namedItem(m.field).value).trim() !== "") : m.node && m.node.__isSet && m.node.__isSet();
          if (on) set.push(m.label);
        });
        now.textContent = set.length ? set.join(" · ") : "";
        now.hidden = !set.length;
      };
      form.addEventListener("input", refresh); form.addEventListener("change", refresh);
      form.addEventListener("reset", function () { root.setTimeout(refresh, 0); });
      refresh();
    });

    // Une erreur dans un champ replié ou dans le contrôle de période : on ouvre et on amène la personne dessus.
    var watcher = new root.MutationObserver(function () {
      var bad = form.querySelector("[data-field-error]");
      if (!bad) return;
      var det = bad.closest("details");
      if (det && !det.open) det.open = true;
      var per = bad.closest(".ck-period");
      if (per && per.__focus) per.__focus();
    });
    watcher.observe(form, { childList: true, subtree: true });
  }

  /** Sous le champ « réponse » : l'aperçu en direct et les morceaux à insérer d'un clic. */
  function textExtras(form, name, box, spec) {
    var ta = form.elements.namedItem(name);
    if (!ta) return;
    var wrap = el("div", "ck-extras");
    if (spec.chips && spec.chips.length) {
      var row = el("div", "ck-chips"), lab = el("span", "ck-word", spec.chipsLabel);
      row.appendChild(lab);
      spec.chips.forEach(function (c) {
        var b = el("button", "ck-chip", c.label); b.type = "button";
        b.addEventListener("click", function () {
          var s = ta.selectionStart == null ? ta.value.length : ta.selectionStart, e = ta.selectionEnd == null ? s : ta.selectionEnd, add = "{" + c.v + "}";
          ta.value = ta.value.slice(0, s) + add + ta.value.slice(e);
          ta.focus(); ta.setSelectionRange(s + add.length, s + add.length);
          fire(ta, "input");
        });
        row.appendChild(b);
      });
      wrap.appendChild(row);
    }
    var pv = el("p", "ck-preview");
    pv.setAttribute("aria-live", "polite");
    wrap.appendChild(pv);
    var upd = function () { var v = ta.value.trim(); pv.hidden = !v; pv.textContent = v ? spec.label + " " + previewText(v, spec.samples) : ""; };
    ta.addEventListener("input", upd);
    form.addEventListener("reset", function () { root.setTimeout(upd, 0); });
    upd();
    ta.parentNode.insertBefore(wrap, ta.nextSibling);
  }

  function bootForm(marker) {
    var form = marker.closest("form");
    if (!form || form.getAttribute("data-ck-ready")) return;
    var cfgNode = doc.querySelector("[data-ck-config='" + marker.value + "']");
    if (!cfgNode) return;
    var cfg;
    try { cfg = JSON.parse(cfgNode.getAttribute("data-ck-json")); } catch (e) { return; }
    form.setAttribute("data-ck-ready", "1");
    form.classList.add("ck-form-on");
    try { buildForm(form, cfg); } catch (e) { form.removeAttribute("data-ck-ready"); if (root.console) root.console.error("[kit]", e); }
  }

  /* ───────────── Mise en route ───────────── */

  function scan() {
    var lists = doc.querySelectorAll("[data-ck-list]");
    for (var i = 0; i < lists.length; i++) bootList(lists[i]);
    var marks = doc.querySelectorAll("input[type='hidden'][name='ck']");
    for (var j = 0; j < marks.length; j++) bootForm(marks[j]);
  }
  var pending = false;
  new root.MutationObserver(function () {
    if (pending) return;
    pending = true;
    root.setTimeout(function () { pending = false; scan(); }, 30);
  }).observe(doc.body, { childList: true, subtree: true });

  var api = { scan: scan, norm: norm, matches: matches, rowPasses: rowPasses, parsePeriodText: parsePeriodText, periodToText: periodToText, periodProblem: periodProblem, dateWords: dateWords, previewText: previewText, fill: fill };
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
