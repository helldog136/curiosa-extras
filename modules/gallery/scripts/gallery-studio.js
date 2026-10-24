/* Galeries photos : l'outil d'envoi de photos de l'équipe (page /…/studio/<album>).
 * On choisit des fichiers (plusieurs d'un coup, jamais de glisser-déposer obligatoire) ; chaque photo est RÉDUITE ET RÉ-ENCODÉE dans le navigateur
 * (le ré-encodage supprime d'office les informations cachées du fichier : position GPS, appareil, date…), avec sa miniature, puis envoyée une par une
 * avec une barre de progression et les erreurs écrites SOUS chaque fichier. Le serveur revérifie tout (type par le contenu, taille, nettoyage).
 * Les envois passent par la route du cœur réservée à l'équipe connectée ; sans connexion, rien n'est accepté.
 * Aucun texte en dur (tout vient d'un attribut de la page), aucun innerHTML, aucun appel à un autre site. */
(function () {
  "use strict";
  var w = window;
  var D = document;
  var root = D.querySelector("[data-gal-studio]");
  if (!root || root.getAttribute("data-on")) return;
  root.setAttribute("data-on", "");

  var cfg;
  try { cfg = JSON.parse(root.getAttribute("data-config") || "{}"); } catch (e) { cfg = {}; }
  var T = cfg.texts || {};
  var info = null; // { title, count, max, kb, side, thumbSide, thumbBytes, spaceLeft, back }
  var rows = [];
  var busy = false;

  function one(sel) { return root.querySelector(sel); }
  function text(node, value) { if (node) node.textContent = value || ""; }
  function el(tag, cls, label) { var n = D.createElement(tag); if (cls) n.className = cls; if (label) n.textContent = label; return n; }
  function fill(template, vars) { return String(template || "").replace(/\{(\w+)\}/g, function (m, k) { return vars[k] === undefined ? m : vars[k]; }); }
  var infoLine = one("[data-studio-info]");
  var body = one("[data-studio-body]");
  var list = one("[data-studio-list]");
  var input = one("[data-studio-input]");
  var sendBtn = one("[data-studio-send]");
  var summary = one("[data-studio-summary]");
  var backLink = one("[data-studio-back]");

  // ── Appel d'une action de l'équipe (route du cœur) ─────────────────────────────────
  function call(action, fields, files, onProgress) {
    return new Promise(function (resolve) {
      var fd = new w.FormData();
      Object.keys(fields || {}).forEach(function (k) { fd.append(k, fields[k]); });
      Object.keys(files || {}).forEach(function (k) { fd.append(k, files[k], "photo.txt"); });
      var xhr = new w.XMLHttpRequest();
      xhr.open("POST", cfg.endpoint + encodeURIComponent(cfg.instance) + "/action/" + encodeURIComponent(action));
      xhr.setRequestHeader("accept", "application/json");
      xhr.timeout = 120000;
      if (xhr.upload && onProgress) xhr.upload.onprogress = function (e) { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      xhr.onload = function () {
        var json = null;
        try { json = JSON.parse(xhr.responseText); } catch (e) { json = null; }
        resolve({ status: xhr.status, json: json });
      };
      xhr.onerror = xhr.ontimeout = function () { resolve({ status: 0, json: null }); };
      xhr.send(fd);
    });
  }
  function messageOf(res) {
    if (!res || res.status === 0) return T.studioErrNetwork;
    if (res.status === 401) return T.studioLogin;
    if (res.status === 403) return T.studioErrDenied;
    var j = res.json || {};
    if (j.errors && typeof j.errors === "object") { var k = Object.keys(j.errors)[0]; if (k) return String(j.errors[k]); }
    if (j.error) return String(j.error);
    return T.studioErrOther;
  }

  // ── Lire un fichier : type par le CONTENU, puis décodage et réduction ──────────────
  function head(file) {
    return new Promise(function (resolve) {
      var r = new w.FileReader();
      r.onload = function () { resolve(new Uint8Array(r.result)); };
      r.onerror = function () { resolve(new Uint8Array(0)); };
      r.readAsArrayBuffer(file.slice(0, 16));
    });
  }
  function kindOf(b) {
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
    if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
    if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "webp";
    if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) { // « ftyp » : photos HEIC des iPhone, lues seulement si le navigateur sait les ouvrir
      var brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
      if (/^(heic|heix|hevc|hevx|mif1|msf1|heim|heis)$/.test(brand)) return "heic";
    }
    if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "gif";
    return "";
  }
  function decode(file) {
    if (w.createImageBitmap) {
      return w.createImageBitmap(file, { imageOrientation: "from-image" }).catch(function () { return viaImage(file); });
    }
    return viaImage(file);
  }
  function viaImage(file) {
    return new Promise(function (resolve, reject) {
      var url = w.URL.createObjectURL(file);
      var img = new w.Image();
      img.onload = function () { w.URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { w.URL.revokeObjectURL(url); reject(new Error("decode")); };
      img.src = url;
    });
  }
  function sizeOf(src) { return { w: src.naturalWidth || src.width, h: src.naturalHeight || src.height }; }
  function toBlob(canvas, quality) {
    return new Promise(function (resolve) { canvas.toBlob(function (b) { resolve(b); }, "image/jpeg", quality); });
  }
  /** Dessine la photo à ce plus grand côté (fond blanc : un PNG transparent devient une photo ordinaire) et la ré-encode en JPEG sous `maxBytes`. */
  function shrink(src, side, maxBytes) {
    var s = sizeOf(src);
    var scale = Math.min(1, side / Math.max(s.w, s.h));
    var width = Math.max(1, Math.round(s.w * scale));
    var height = Math.max(1, Math.round(s.h * scale));
    var steps = [0.86, 0.78, 0.7, 0.62, 0.54, 0.46];
    function attempt(wd, ht, i) {
      var c = D.createElement("canvas");
      c.width = wd; c.height = ht;
      var g = c.getContext("2d");
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, wd, ht);
      g.drawImage(src, 0, 0, wd, ht);
      return toBlob(c, steps[i]).then(function (blob) {
        if (!blob) return null;
        if (blob.size <= maxBytes) return { blob: blob, width: wd, height: ht };
        if (i < steps.length - 1) return attempt(wd, ht, i + 1);
        if (Math.max(wd, ht) < 400) return null;
        return attempt(Math.round(wd * 0.85), Math.round(ht * 0.85), 2);
      });
    }
    return attempt(width, height, 0);
  }
  function toBase64Blob(blob) {
    return new Promise(function (resolve, reject) {
      var r = new w.FileReader();
      r.onload = function () { var s = String(r.result); resolve(new w.Blob([s.slice(s.indexOf(",") + 1)], { type: "text/plain" })); };
      r.onerror = function () { reject(new Error("read")); };
      r.readAsDataURL(blob);
    });
  }

  // ── Les lignes ─────────────────────────────────────────────────────────────────────
  function addRow(file) {
    var row = { file: file, state: "checking", node: el("li", "gal-sfile"), id: "f" + rows.length + "-" + Date.now() };
    var headEl = el("div", "gal-sfile-head");
    row.thumb = el("img");
    row.thumb.alt = "";
    row.name = el("span", "gal-sname", file.name || "");
    row.removeBtn = el("button", "gal-btn", T.studioRemove);
    row.removeBtn.type = "button";
    row.removeBtn.addEventListener("click", function () { if (busy) return; rows.splice(rows.indexOf(row), 1); row.node.remove(); refresh(); });
    headEl.appendChild(row.thumb); headEl.appendChild(row.name); headEl.appendChild(row.removeBtn);
    row.fields = el("div");
    var capLabel = el("label", "", T.studioCaption); capLabel.htmlFor = row.id + "-c";
    row.caption = el("input"); row.caption.type = "text"; row.caption.id = row.id + "-c"; row.caption.maxLength = 200; row.caption.autocomplete = "off";
    var altLabel = el("label", "", T.studioAlt); altLabel.htmlFor = row.id + "-a";
    row.alt = el("input"); row.alt.type = "text"; row.alt.id = row.id + "-a"; row.alt.maxLength = 300; row.alt.autocomplete = "off";
    var altHelp = el("p", "gal-hint", T.studioAltHelp);
    row.alt.setAttribute("aria-describedby", row.id + "-h"); altHelp.id = row.id + "-h";
    row.fields.appendChild(capLabel); row.fields.appendChild(row.caption); row.fields.appendChild(altLabel); row.fields.appendChild(row.alt); row.fields.appendChild(altHelp);
    row.bar = el("progress"); row.bar.max = 100; row.bar.value = 0; row.bar.hidden = true; row.bar.setAttribute("aria-label", T.studioProgress);
    row.status = el("p", "gal-sstate"); row.status.setAttribute("role", "status");
    row.error = el("p", "gal-serror"); row.error.setAttribute("role", "alert"); row.error.hidden = true;
    row.retry = el("button", "gal-btn", T.studioRetry); row.retry.type = "button"; row.retry.hidden = true;
    row.retry.addEventListener("click", function () { row.state = "ready"; row.error.hidden = true; row.retry.hidden = true; refresh(); sendAll(); });
    row.node.appendChild(headEl); row.node.appendChild(row.fields); row.node.appendChild(row.bar); row.node.appendChild(row.status); row.node.appendChild(row.error); row.node.appendChild(row.retry);
    list.appendChild(row.node);
    rows.push(row);
    return row;
  }
  function fail(row, message) {
    row.state = "error";
    row.bar.hidden = true;
    text(row.status, "");
    text(row.error, message);
    row.error.hidden = false;
    row.retry.hidden = row.noRetry === true;
    row.fields.hidden = row.noRetry === true;
  }

  function check(row) {
    return head(row.file).then(function (bytes) {
      var kind = kindOf(bytes);
      if (kind === "gif") { row.noRetry = true; return fail(row, T.studioGif); }
      if (!kind) { row.noRetry = true; return fail(row, T.studioErrType); }
      return decode(row.file).then(function (img) {
        row.img = img;
        var s = sizeOf(img);
        if (!s.w || !s.h) { row.noRetry = true; return fail(row, T.studioErrDecode); }
        row.state = "ready";
        text(row.status, T.studioReady);
        try {
          var url = w.URL.createObjectURL(row.file);
          row.thumb.src = url;
          row.thumb.onload = function () { w.URL.revokeObjectURL(url); };
        } catch (e) { /* aperçu facultatif */ }
      }, function () { row.noRetry = true; fail(row, kind === "heic" ? T.studioHeic : T.studioErrDecode); });
    });
  }

  function refresh() {
    var ready = rows.filter(function (r) { return r.state === "ready"; }).length;
    var room = info ? info.max - info.count : 0;
    sendBtn.disabled = busy || ready === 0;
    text(sendBtn, ready <= 1 ? T.studioSendOne : fill(T.studioSend, { n: ready }));
    var done = rows.filter(function (r) { return r.state === "done"; }).length;
    var problems = rows.filter(function (r) { return r.state === "error"; }).length;
    if (done || problems) text(summary, fill(T.studioSummary, { done: done, total: rows.length, errors: problems }));
    else text(summary, rows.length ? fill(T.studioCapacity, { room: Math.max(0, room - rows.length) }) : "");
  }

  // ── Envoi ──────────────────────────────────────────────────────────────────────────
  function sendOne(row) {
    row.state = "sending";
    row.fields.querySelectorAll("input").forEach(function (i) { i.disabled = true; });
    row.removeBtn.hidden = true;
    row.retry.hidden = true;
    row.error.hidden = true;
    row.bar.hidden = false; row.bar.removeAttribute("value");
    text(row.status, T.studioPreparing);
    var maxBytes = (info.kb || 300) * 1000;
    return shrink(row.img, info.side || 1600, maxBytes).then(function (big) {
      if (!big) throw new Error("size");
      return shrink(row.img, info.thumbSide || 480, info.thumbBytes || 120000).then(function (small) {
        if (!small) throw new Error("size");
        return Promise.all([toBase64Blob(big.blob), toBase64Blob(small.blob)]);
      });
    }).then(function (blobs) {
      row.bar.value = 0; row.bar.max = 100;
      text(row.status, T.studioSending);
      return call("addPhoto", { album: cfg.album, caption: row.caption.value, alt: row.alt.value, name: row.file.name || "" }, { photo: blobs[0], thumb: blobs[1] }, function (f) {
        row.bar.value = Math.round(f * 100);
        if (f >= 1) { row.bar.removeAttribute("value"); text(row.status, T.studioSaving); }
      });
    }).then(function (res) {
      if (res.status === 200 && res.json && res.json.ok) {
        row.state = "done";
        row.bar.hidden = true;
        row.fields.hidden = true;
        row.status.className = "gal-sstate gal-sok";
        text(row.status, "✓ " + T.studioDone);
        info.count += 1;
      } else {
        row.fields.querySelectorAll("input").forEach(function (i) { i.disabled = false; });
        row.removeBtn.hidden = false;
        fail(row, messageOf(res));
      }
    }, function (e) {
      row.fields.querySelectorAll("input").forEach(function (i) { i.disabled = false; });
      row.removeBtn.hidden = false;
      fail(row, e && e.message === "size" ? fill(T.studioErrSize, { kb: info.kb }) : T.studioErrOther);
    });
  }

  function sendAll() {
    if (busy || !info) return;
    var queue = rows.filter(function (r) { return r.state === "ready"; });
    if (!queue.length) return;
    busy = true;
    sendBtn.disabled = true;
    var i = 0;
    (function next() {
      if (i >= queue.length) {
        busy = false;
        refresh();
        if (rows.every(function (r) { return r.state === "done"; })) text(summary, T.studioAllDone);
        return;
      }
      var row = queue[i++];
      if (info.count >= info.max) { fail(row, fill(T.studioErrFull, { max: info.max })); return next(); }
      sendOne(row).then(function () { refresh(); next(); });
    })();
  }

  // ── Mise en route ──────────────────────────────────────────────────────────────────
  input.addEventListener("change", function () {
    var files = Array.prototype.slice.call(input.files || []);
    input.value = "";
    var room = info.max - info.count - rows.filter(function (r) { return r.state !== "error"; }).length;
    files.forEach(function (file) {
      var row = addRow(file);
      if (room <= 0) { row.noRetry = true; fail(row, fill(T.studioTooMany, { max: info.max })); return; }
      room -= 1;
      check(row).then(refresh);
    });
    refresh();
  });
  sendBtn.addEventListener("click", sendAll);

  call("studioInfo", { album: cfg.album }).then(function (res) {
    if (res.status === 200 && res.json && res.json.ok) {
      try { info = JSON.parse(res.json.ok); } catch (e) { info = null; }
    }
    if (!info) {
      text(infoLine, res.status === 401 ? T.studioLogin : res.status === 403 ? T.studioErrDenied : res.json && res.json.error ? T.studioNoAlbum : messageOf(res));
      if (res.status === 401) { var a = el("a", "", T.studioLoginLink); a.href = "/admin"; infoLine.appendChild(D.createTextNode(" ")); infoLine.appendChild(a); }
      return;
    }
    text(infoLine, fill(T.studioWaiting, { title: info.title, count: info.count, max: info.max }));
    body.hidden = false;
    if (backLink) { backLink.href = info.back; backLink.hidden = false; }
    refresh();
  });
})();
