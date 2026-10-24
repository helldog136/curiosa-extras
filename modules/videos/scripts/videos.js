/* Vidéothèque — le petit script de la page d'une vidéo. Il ne fait que deux choses, et rien ne part vers une plateforme avant un clic :
   1. au clic sur « Lire ici », il remplace l'image par le lecteur (adresse vérifiée, cadre fermé : mêmes réglages que la page « lecture » sans JavaScript) ;
   2. il montre le bouton « Copier le lien » (sans JavaScript, ce bouton reste caché et les autres liens de partage marchent). */
(function () {
  "use strict";
  var EMBED = /^https:\/\/www\.youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]{11}\?[A-Za-z0-9=&_-]{0,60}$/;

  function play(box) {
    var src = box.getAttribute("data-embed") || "";
    if (!EMBED.test(src)) return false;
    var frame = document.createElement("iframe");
    frame.src = src;
    frame.title = box.getAttribute("data-title") || "";
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox");
    frame.setAttribute("allow", "autoplay; fullscreen");
    frame.setAttribute("allowfullscreen", "");
    frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    while (box.firstChild) box.removeChild(box.firstChild);
    box.appendChild(frame);
    box.removeAttribute("data-vl-player");
    try { frame.focus(); } catch (e) { /* sans importance */ }
    return true;
  }

  function copy(button) {
    var text = button.getAttribute("data-vl-copy") || "";
    var label = button.textContent;
    var done = function () {
      button.textContent = button.getAttribute("data-done") || label;
      setTimeout(function () { button.textContent = label; }, 2500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { /* le lien reste visible dans la barre d'adresse */ });
      return;
    }
    var area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    try { if (document.execCommand("copy")) done(); } catch (e) { /* idem */ }
    document.body.removeChild(area);
  }

  document.addEventListener("click", function (event) {
    var target = event.target;
    if (!target || !target.closest) return;
    var poster = target.closest("[data-vl-player] .vl-poster");
    if (poster) {
      var box = poster.closest("[data-vl-player]");
      if (box && play(box)) event.preventDefault();
      return;
    }
    var button = target.closest("[data-vl-copy]");
    if (button) { event.preventDefault(); copy(button); }
  });

  function reveal() {
    var buttons = document.querySelectorAll("[data-vl-copy]");
    for (var i = 0; i < buttons.length; i++) buttons[i].hidden = false;
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", reveal); else reveal();
})();
