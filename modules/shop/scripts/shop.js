// Shop (EXPERIMENTAL prototype): cart panel. Texts come from the server (data-t); user data is only ever set as text, never as markup.
(function () {
  var root = document.getElementById("shop-cart");
  if (!root) return;
  var base = root.dataset.base, T = {};
  try { T = JSON.parse(root.dataset.t || "{}"); } catch (e) { T = {}; }
  var left = 0, timer = null, currency = "EUR";
  function el(tag, props, kids) { var n = document.createElement(tag); Object.keys(props || {}).forEach(function (k) { if (k === "text") n.textContent = props[k]; else if (k === "class") n.className = props[k]; else n.setAttribute(k, props[k]); }); (kids || []).forEach(function (c) { n.appendChild(c); }); return n; }
  function money(c) { try { return new Intl.NumberFormat(document.documentElement.lang || undefined, { style: "currency", currency: currency }).format(c / 100); } catch (e) { return (c / 100).toFixed(2) + " " + currency; } }
  function clock(s) { return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }
  function say(text, bad) { var m = root.querySelector(".sh-msg"); if (m) { m.textContent = text || ""; m.className = "sh-msg" + (bad ? " sh-err" : ""); } }
  function render(cart) {
    currency = cart.currency || currency; left = cart.secondsLeft || 0;
    root.textContent = "";
    root.appendChild(el("h3", { text: T.cart }));
    if (!cart.lines || !cart.lines.length) { root.appendChild(el("p", { "class": "sh-muted", text: cart.expired ? T.expired : T.empty })); root.appendChild(el("p", { "class": "sh-msg", role: "status" })); return; }
    var ul = el("ul", { "class": "sh-lines" });
    cart.lines.forEach(function (l) {
      var b = el("button", { type: "button", "class": "sh-btn sh-btn-quiet", text: T.remove, "aria-label": T.remove + " " + l.title });
      b.addEventListener("click", function () { post("remove", { rid: l.rid }); });
      ul.appendChild(el("li", {}, [el("span", { text: l.qty + " × " + l.title + (l.label ? " (" + l.label + ")" : "") }), el("span", { text: money(l.sum) }), b]));
    });
    root.appendChild(ul);
    root.appendChild(el("p", {}, [el("strong", { text: T.total + " " + money(cart.total) })]));
    root.appendChild(el("p", { "class": "sh-muted", id: "sh-left", text: T.left + " " + clock(left) }));
    var f = el("form", { novalidate: "novalidate" });
    [["name", "text", T.name], ["email", "email", T.email]].forEach(function (d) { f.appendChild(field(d[0], d[1], d[2])); });
    var ta = el("textarea", { "class": "sh-in", id: "sh-address", name: "address", rows: "3", required: "required" });
    f.appendChild(el("p", {}, [el("label", { "for": "sh-address", text: T.address }), ta, el("span", { "class": "sh-err", id: "sh-err-address", role: "alert" })]));
    f.appendChild(el("input", { "class": "sh-hp", type: "text", name: "website", tabindex: "-1", autocomplete: "off", "aria-hidden": "true" }));
    f.appendChild(el("button", { "class": "sh-btn", type: "submit", text: T.order }));
    f.addEventListener("submit", function (e) { e.preventDefault(); checkout(f); });
    root.appendChild(f);
    root.appendChild(el("p", { "class": "sh-msg", role: "status" }));
  }
  function field(name, type, label) { var id = "sh-" + name; return el("p", {}, [el("label", { "for": id, text: label }), el("input", { "class": "sh-in", id: id, name: name, type: type, required: "required", autocomplete: name }), el("span", { "class": "sh-err", id: "sh-err-" + name, role: "alert" })]); }
  function post(route, data, done) {
    var fd = new FormData(); Object.keys(data).forEach(function (k) { fd.append(k, data[k]); });
    return fetch(base + "/" + route, { method: "POST", body: fd, credentials: "same-origin", headers: { accept: "application/json" } })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { return { status: r.status, body: b }; }); })
      .then(function (r) { if (done) return done(r); if (r.body.cart) render(r.body.cart); if (r.body.reason === "closed") say(T.closed, true); else if (r.body.reason === "sold_out") say(T.sold, true); else if (r.body.reason === "quantity") say(T.qty, true); else if (r.body.reason === "rate") say(T.rate, true); else if (!r.body.ok && r.body.reason) say(T.generic, true); })
      .catch(function () { say(T.generic, true); });
  }
  function checkout(f) {
    ["name", "email", "address"].forEach(function (k) { var s = document.getElementById("sh-err-" + k); if (s) s.textContent = ""; });
    var data = {}; new FormData(f).forEach(function (v, k) { data[k] = v; });
    post("checkout", data, function (r) {
      if (r.body.ok && r.body.url) { window.location.href = r.body.url; return; }
      var errs = r.body.errors || {}, first = null;
      Object.keys(errs).forEach(function (k) { var s = document.getElementById("sh-err-" + k); if (s) { s.textContent = T["err" + k.charAt(0).toUpperCase() + k.slice(1)] || T.generic; first = first || document.getElementById(k === "address" ? "sh-address" : "sh-" + k); } });
      if (first) first.focus(); else { say(r.body.reason === "expired" ? T.expired : r.body.reason === "closed" ? T.closed : T.generic, true); load(); }
    });
  }
  function load() { return fetch(base + "/cart", { credentials: "same-origin" }).then(function (r) { return r.json(); }).then(render).catch(function () {}); }
  document.addEventListener("submit", function (e) {
    var f = e.target; if (!f.classList || !f.classList.contains("sh-add")) return;
    e.preventDefault();
    var data = {}; new FormData(f).forEach(function (v, k) { data[k] = v; });
    post("add", data);
  });
  timer = setInterval(function () { if (left > 0) { left -= 1; var c = document.getElementById("sh-left"); if (c) c.textContent = T.left + " " + clock(left); if (left === 0) load(); } }, 1000);
  load();
})();
