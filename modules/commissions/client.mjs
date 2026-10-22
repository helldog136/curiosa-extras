// Commandes — le petit morceau de code qui s'exécute dans le navigateur de la visiteuse (envoi du formulaire sans quitter la page, erreurs sous les champs).
// Il est posé dans l'attribut « onsubmit » du formulaire (un bloc de page n'exécute pas de balise <script> quand la page change sans rechargement).
// Sans lui, le formulaire marche quand même : le navigateur l'envoie normalement et le site répond par une redirection.
// Écrit en JavaScript simple (pas de syntaxe récente) : il tourne tel quel chez la visiteuse.
export function clientSubmit(f, ev) {
  if (!window.fetch || !window.FormData) return true;
  ev.preventDefault();
  var btn = f.querySelector("button[type=submit]");
  var label = btn.textContent;
  var show = function (name, text) {
    var box = f.querySelector('[data-err="' + name + '"]');
    if (box) box.textContent = text;
    var field = name === "_" ? null : f.elements[name];
    if (field && field.setAttribute) field.setAttribute("aria-invalid", "true");
    return field;
  };
  var done = function () { btn.disabled = false; btn.textContent = label; f.removeAttribute("aria-busy"); };
  var boxes = f.querySelectorAll("[data-err]");
  for (var i = 0; i < boxes.length; i++) boxes[i].textContent = "";
  var marked = f.querySelectorAll("[aria-invalid]");
  for (var j = 0; j < marked.length; j++) marked[j].removeAttribute("aria-invalid");
  btn.disabled = true;
  btn.textContent = f.getAttribute("data-sending");
  f.setAttribute("aria-busy", "true");
  var ctl = window.AbortController ? new AbortController() : null;
  var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 20000);
  fetch(f.action, { method: "POST", body: new FormData(f), headers: { Accept: "application/json" }, credentials: "same-origin", signal: ctl ? ctl.signal : undefined })
    .then(function (r) { clearTimeout(timer); return r.json().then(function (j) { return { j: j || {} }; }, function () { return { j: {} }; }); })
    .then(function (x) {
      if (x.j.ok === true) {
        var u = x.j.url;
        if (typeof u === "string" && u.charAt(0) === "/" && u.charAt(1) !== "/") { location.assign(u); return; }
        done();
        f.reset();
        var okBox = f.querySelector("[data-ok]");
        if (okBox) okBox.textContent = f.getAttribute("data-thanks");
        return;
      }
      done();
      var errs = x.j.errors && typeof x.j.errors === "object" ? x.j.errors : {};
      var first = null;
      for (var k in errs) {
        if (Object.prototype.hasOwnProperty.call(errs, k)) {
          var el = show(k, String(errs[k]));
          if (!first && el && el.focus) first = el;
        }
      }
      if (!Object.keys(errs).length) show("_", String(x.j.message || f.getAttribute("data-neterr")));
      if (first) first.focus();
    })
    .catch(function () { clearTimeout(timer); done(); show("_", f.getAttribute("data-neterr")); });
  return false;
}
