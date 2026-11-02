(function ideaBox() {
  "use strict";
  var D = document;
  var root = D.querySelector("[data-ib]");
  if (!root || root.getAttribute("data-ib-ready")) return;
  root.setAttribute("data-ib-ready", "1");
  var input = root.querySelector("[data-ib-q]");
  if (!input) return;
  var items = Array.prototype.slice.call(root.querySelectorAll("[data-ib-item]"));
  var status = root.querySelector("[data-ib-status]");
  var empty = root.querySelector("[data-ib-empty]");
  var clear = root.querySelector("[data-ib-clear]");

  // Sans accents ni majuscules, comme la recherche de l'administration.
  function fold(s) {
    var t = String(s || "");
    try { t = t.normalize("NFD"); } catch (e) { /* vieux navigateur : on garde le texte tel quel */ }
    return t.replace(/[̀-ͯ]/g, "").toLowerCase();
  }
  // Tout ce qui est affiché sur la carte : l'idée, son statut, le pseudo, la réponse.
  function haystack(item) {
    if (item.__ib) return item.__ib;
    var parts = [];
    var nodes = item.querySelectorAll("[data-ib-text]");
    for (var i = 0; i < nodes.length; i++) parts.push(nodes[i].textContent);
    item.__ib = fold(parts.join(" "));
    return item.__ib;
  }
  function run() {
    var terms = fold(input.value).split(/\s+/).filter(Boolean);
    var shown = 0;
    items.forEach(function (item) {
      var ok = terms.every(function (t) { return haystack(item).indexOf(t) > -1; });
      item.hidden = !ok;
      if (ok) shown++;
    });
    var d = root.dataset || {};
    if (status) status.textContent = !terms.length ? "" : shown === 0 ? d.tNone || "" : shown === 1 ? d.tOne || "" : (d.tMany || "").replace("{n}", String(shown));
    if (empty) empty.hidden = !(terms.length && shown === 0);
  }
  input.addEventListener("input", run);
  if (clear) clear.addEventListener("click", function () { input.value = ""; run(); input.focus(); });
  run();
})();
