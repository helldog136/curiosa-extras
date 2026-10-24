(function dgClient() {
  "use strict";
  var w = window;
  var D = document;
  if (w.__dgBoot) return;
  w.__dgBoot = 1;
  function one(sel, el) { return (el || D).querySelector(sel); }
  function all(sel, el) { return Array.prototype.slice.call((el || D).querySelectorAll(sel)); }
  function say(el, text) { if (el) { el.textContent = text || ""; if ("hidden" in el) el.hidden = !text; } }
  function reduced() { try { return w.matchMedia && w.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }
  var mem = {};
  var blocked = false;
  function blank() { return { v: 1, last: "", streak: 0, bestStreak: 0, bestScore: 0, plays: 0, wins: 0, today: null, timer: null, board: false, nick: "" }; }
  function load(key) {
    try {
      var raw = w.localStorage.getItem("dg:" + key);
      if (raw) { var o = JSON.parse(raw); if (o && o.v === 1) return o; }
    } catch (e) { blocked = true; }
    return mem[key] || blank();
  }
  function save(key, st) {
    mem[key] = st;
    try { w.localStorage.setItem("dg:" + key, JSON.stringify(st)); } catch (e) { blocked = true; }
  }
  function token(create) {
    var t = null;
    try { t = w.localStorage.getItem("aud-id"); } catch (e) { t = null; }
    if (t && /^[A-Za-z0-9_-]{22,64}$/.test(t)) return t;
    if (!create) return null;
    var b = new Uint8Array(16);
    w.crypto.getRandomValues(b);
    t = w.btoa(String.fromCharCode.apply(null, b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    try { w.localStorage.setItem("aud-id", t); } catch (e) { blocked = true; mem.token = t; }
    return t;
  }
  var TYPES = {
    quiz: {
      read: function (form) {
        var c = one("input[name=choice]:checked", form);
        return c ? { choice: parseInt(c.value, 10) } : null;
      },
      show: function (form, mine, reveal, t) {
        var opts = all(".dg-opt", form);
        opts.forEach(function (opt, i) {
          var input = one("input", opt);
          var flag = one(".dg-flag", opt);
          var label = one("label", opt);
          if (input) { input.disabled = true; input.checked = i === mine.choice; }
          var good = i === reveal.answer;
          var bad = i === mine.choice && !good;
          opt.classList.toggle("is-correct", good);
          opt.classList.toggle("is-wrong", bad);
          if (flag) flag.textContent = good ? "\u2714" : bad ? "\u2718" : "";
          var old = one(".dg-sr", label);
          if (old && old.parentNode) old.parentNode.removeChild(old);
          var note = good ? t.srGood : bad ? t.srBad : i === mine.choice ? t.srYours : "";
          if (note && label) { var s = D.createElement("span"); s.className = "dg-sr"; s.textContent = " (" + note + ")"; label.appendChild(s); }
        });
      }
    }
  };
  function post(root, path, body) {
    var url = root.getAttribute("data-api") + "/" + path + "?lang=" + encodeURIComponent(root.getAttribute("data-lang") || "");
    var signal;
    try { signal = typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined; } catch (e) { signal = undefined; }
    return w.fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), credentials: "omit", signal: signal })
      .then(function (r) { return r.json().then(function (j) { j.status = r.status; return j; }, function () { return { ok: false, reason: "net", status: r.status }; }); },
        function () { return { ok: false, reason: "net", status: 0 }; });
  }
  function start(root) {
    var d = root.dataset;
    var texts = {};
    try { texts = JSON.parse(one("[data-dg-texts]", root).textContent) || {}; } catch (e) { texts = {}; }
    var key = d.key, day = d.day, prev = d.prev, qid = d.qid;
    var type = TYPES[d.type];
    var form = one("[data-dg-form]", root);
    if (!type || !form || !qid) return;
    var st = load(key);
    var resultBox = one("[data-dg-result]", root);
    var verdict = one("[data-dg-verdict]", root);
    var submit = one("[data-dg-submit]", form);
    var errorBox = one("[data-dg-error]", form);
    var timerBox = one("[data-dg-timerbox]", root);
    var timerInput = one("[data-dg-timer]", root);
    var bar = one("[data-dg-bar]", root);
    var secBox = one("[data-dg-sec]", root);
    var timerNote = one("[data-dg-timernote]", root);
    var seconds = parseInt(d.seconds || "15", 10) || 15;
    var t0 = Date.now();
    var timerRun = false;
    var finished = false;
    var shareText = "";
    function line(template, n) { return String(template || "").replace("{n}", String(n)); }
    function effStreak() { return st.last === day || st.last === prev ? st.streak : 0; }
    function stats() {
      var box = one("[data-dg-stats]", root);
      if (box) box.hidden = !(st.plays > 0);
      say(one("[data-dg-s-streak]", root), String(effStreak()));
      say(one("[data-dg-s-best]", root), String(st.bestStreak));
      say(one("[data-dg-s-score]", root), String(st.bestScore));
      say(one("[data-dg-s-plays]", root), String(st.plays));
      var clear = one("[data-dg-clear]", root);
      if (clear) clear.hidden = !(st.plays > 0 || st.board);
      var ns = one("[data-dg-nostorage]", root);
      if (ns) ns.hidden = !blocked;
    }
    function timerOn() { return !!(timerInput && timerInput.checked); }
    function paint(left) {
      if (bar) bar.style.transform = "scaleX(" + Math.max(0, Math.min(1, left / seconds)) + ")";
      say(secBox, line(texts.seconds, Math.max(0, Math.ceil(left))));
    }
    function tick() {
      if (!timerRun || finished) return;
      var left = seconds - (Date.now() - t0) / 1000;
      paint(left);
      if (left <= 0) { timerRun = false; say(timerNote, texts.timerEnd); return; }
      w.setTimeout(tick, reduced() ? 1000 : 200);
    }
    function startTimer() {
      if (finished || !timerOn()) return;
      t0 = Date.now();
      timerRun = true;
      say(timerNote, texts.timerOn);
      tick();
    }
    function stopTimer() { timerRun = false; }
    function idleTimer() {
      if (bar) bar.style.transform = "scaleX(0)";
      say(secBox, "");
      say(timerNote, texts.timerOff);
    }
    if (timerBox && timerInput) {
      if (typeof st.timer === "boolean") timerInput.checked = st.timer;
      timerBox.hidden = false;
      timerInput.addEventListener("change", function () {
        st.timer = timerInput.checked;
        save(key, st);
        if (timerInput.checked) startTimer();
        else { stopTimer(); idleTimer(); }
      });
    }
    function show(played, fresh) {
      finished = true;
      stopTimer();
      if (timerBox) timerBox.hidden = true;
      form.classList.add("is-done");
      if (submit) submit.hidden = true;
      type.show(form, played.mine, played.reveal, texts);
      if (verdict) { verdict.textContent = played.ok ? texts.good : texts.bad; verdict.className = "dg-verdict " + (played.ok ? "is-good" : "is-bad"); }
      say(one("[data-dg-explain]", root), played.reveal && played.reveal.explain ? played.reveal.explain : "");
      var score = line(texts.score, played.pts);
      if (played.bonus > 0) score += " " + line(texts.bonus, played.bonus);
      say(one("[data-dg-score]", root), score);
      var n = effStreak();
      var sl = one("[data-dg-streak]", root);
      if (sl) {
        sl.textContent = "";
        if (n >= 1) {
          var flame = D.createElement("span");
          flame.className = "dg-flame";
          flame.setAttribute("aria-hidden", "true");
          flame.textContent = "\ud83d\udd25 ";
          sl.appendChild(flame);
          sl.appendChild(D.createTextNode(n >= 2 ? line(texts.streakMany, n) : texts.streakOne));
        }
        sl.hidden = n < 1;
      }
      say(one("[data-dg-comeback]", root), texts.comeBack);
      shareText = d.title + " \u2014 " + (n >= 2 ? line(texts.streakMany, n) : played.ok ? texts.shareGood : texts.shareBad) + (d.url ? "\n" + d.url : "");
      var area = one("[data-dg-sharetext]", root);
      if (area) area.value = shareText;
      var nat = one("[data-dg-share]", root);
      if (nat && w.navigator && typeof w.navigator.share === "function") nat.hidden = false;
      if (resultBox) {
        resultBox.hidden = false;
        if (fresh) {
          try { resultBox.scrollIntoView({ block: "nearest", behavior: reduced() ? "auto" : "smooth" }); } catch (e) { }
          if (verdict) verdict.focus({ preventScroll: true });
        }
      }
      stats();
      boardAfter(played, fresh);
    }
    function problem(reason) {
      say(errorBox, texts[reason] || texts.net || "");
      if (submit) submit.disabled = false;
      if (reason === "newDay") w.setTimeout(function () { w.location.reload(); }, 2500);
    }
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (finished || (submit && submit.disabled)) return;
      var mine = type.read(form);
      if (!mine) { problem("pick"); return; }
      say(errorBox, "");
      if (submit) submit.disabled = true;
      var timed = timerOn();
      var ms = Math.max(0, Date.now() - t0);
      var body = { day: day, qid: qid, ms: ms, timer: timed, website: "" };
      Object.keys(mine).forEach(function (k) { body[k] = mine[k]; });
      post(root, "answer", body).then(function (j) {
        if (!j || !j.ok) { problem(j && j.reason === "newday" ? "newDay" : j && j.reason === "limit" ? "limit" : j && j.reason === "invalid" ? "invalid" : j && j.reason === "busy" ? "busy" : "net"); return; }
        if (st.last !== day) {
          st.streak = st.last === prev ? st.streak + 1 : 1;
          st.last = day;
          st.plays += 1;
          if (j.correct) st.wins += 1;
        }
        st.bestStreak = Math.max(st.bestStreak, st.streak);
        st.bestScore = Math.max(st.bestScore, j.pts || 0);
        var played = { day: day, qid: qid, mine: mine, ok: !!j.correct, pts: j.pts || 0, bonus: j.bonus || 0, ms: ms, timer: timed, reveal: j.reveal || {}, sent: false };
        st.today = played;
        save(key, st);
        show(played, true);
      });
    });
    var copy = one("[data-dg-copy]", root);
    var status = one("[data-dg-copystatus]", root);
    if (copy) copy.addEventListener("click", function () {
      var area = one("[data-dg-sharetext]", root);
      function fallback() {
        try { if (area) { area.focus(); area.select(); } say(status, D.execCommand && D.execCommand("copy") ? texts.copied : texts.copyFail); } catch (e) { say(status, texts.copyFail); }
      }
      if (w.navigator.clipboard && w.navigator.clipboard.writeText) w.navigator.clipboard.writeText(shareText).then(function () { say(status, texts.copied); }, fallback);
      else fallback();
    });
    var nat = one("[data-dg-share]", root);
    if (nat) nat.addEventListener("click", function () {
      if (w.navigator.share) w.navigator.share({ text: shareText }).catch(function () { });
    });
    var clear = one("[data-dg-clear]", root);
    if (clear) clear.addEventListener("click", function () {
      var t = st.board ? token(false) : null;
      if (t) post(root, "board", { act: "leave", t: t, website: "" });
      try { w.localStorage.removeItem("dg:" + key); if (t) w.localStorage.removeItem("aud-id"); } catch (e) { blocked = true; }
      delete mem[key];
      st = blank();
      stats();
      say(one("[data-dg-streak]", root), "");
      say(one("[data-dg-clearstatus]", root), texts.cleared);
      var bs = one("[data-dg-boardstate]", root);
      if (bs) bs.hidden = true;
    });
    var boardOn = d.board === "1";
    var bform = one("[data-dg-boardform]", root);
    var berror = one("[data-dg-boarderror]", root);
    var nick = one("[data-dg-nick]", root);
    var prompt = one("[data-dg-boardprompt]", root);
    function paintTop(list) {
      var ol = one("[data-dg-toplist]", root);
      if (!ol || !Array.isArray(list)) return;
      while (ol.firstChild) ol.removeChild(ol.firstChild);
      list.slice(0, 10).forEach(function (r) {
        var li = D.createElement("li");
        var a = D.createElement("span");
        a.textContent = r.name || "";
        var b = D.createElement("span");
        b.textContent = line(texts.boardPts || "{n}", r.pts);
        li.appendChild(a); li.appendChild(b); ol.appendChild(li);
      });
      ol.hidden = !list.length;
      var empty = one("[data-dg-toplist-empty]", root);
      if (empty) empty.hidden = list.length > 0;
    }
    function sendScore(played, withNick) {
      var t = token(true);
      var body = { act: "score", t: t, day: day, qid: qid, ms: played.ms, timer: played.timer, website: "" };
      Object.keys(played.mine).forEach(function (k) { body[k] = played.mine[k]; });
      if (withNick) body.nick = withNick;
      return post(root, "board", body);
    }
    function boardState() {
      var bs = one("[data-dg-boardstate]", root);
      var manage = one("[data-dg-boardmanage]", root);
      if (bs) { bs.textContent = st.board && st.nick ? line(texts.boardAlready, st.nick) : ""; bs.hidden = !(st.board && st.nick); }
      if (manage) manage.hidden = !st.board;
    }
    function boardAfter(played) {
      if (!boardOn) return;
      boardState();
      if (st.board) {
        if (!played.sent) sendScore(played, "").then(function (j) {
          if (j && j.ok) { played.sent = true; st.today = played; save(key, st); paintTop(j.top); say(one("[data-dg-boardstatus]", root), j.rank ? line(texts.boardSent, j.rank) : texts.boardTop); }
        });
      } else if (prompt) prompt.hidden = false;
    }
    var open = one("[data-dg-boardopen]", root);
    function openForm() { if (bform) { bform.hidden = false; if (nick) { nick.value = st.nick || ""; nick.focus(); } } }
    if (open) open.addEventListener("click", function () { if (prompt) prompt.hidden = true; openForm(); });
    var manage = one("[data-dg-boardmanage]", root);
    if (manage) manage.addEventListener("click", openForm);
    if (bform) {
      bform.addEventListener("submit", function (e) {
        e.preventDefault();
        var value = nick ? nick.value.replace(/\s+/g, " ").trim() : "";
        if (!value) { say(berror, texts.boardNeedPseudo); if (nick) nick.focus(); return; }
        say(berror, "");
        var played = st.today && st.today.day === day ? st.today : null;
        var go = played ? sendScore(played, value) : post(root, "board", { act: "join", t: token(true), nick: value, website: "" });
        go.then(function (j) {
          if (!j || !j.ok) { say(berror, texts[j && j.reason] || texts.busy); if (nick) nick.focus(); return; }
          st.board = true; st.nick = value;
          if (played) { played.sent = true; st.today = played; }
          save(key, st);
          bform.hidden = true;
          paintTop(j.top);
          boardState();
          stats();
          say(one("[data-dg-boardstatus]", root), j.rank ? line(texts.boardSent, j.rank) : texts.boardTop);
        });
      });
      var leave = one("[data-dg-boardleave]", root);
      if (leave) leave.addEventListener("click", function () {
        var t = token(false);
        if (t) post(root, "board", { act: "leave", t: t, website: "" });
        st.board = false; st.nick = "";
        save(key, st);
        bform.hidden = true;
        boardState();
        stats();
        if (prompt && st.today && st.today.day === day) prompt.hidden = false;
        say(one("[data-dg-boardstatus]", root), texts.cleared);
      });
    }
    stats();
    if (st.today && st.today.day === day && st.today.qid === qid) show(st.today, false);
    else {
      startTimer();
      if (timerInput && !timerInput.checked) idleTimer();
    }
  }
  function boot() {
    var fresh = all("[data-dg]:not([data-dg-on])");
    fresh.forEach(function (r) { r.setAttribute("data-dg-on", ""); try { start(r); } catch (e) { } });
  }
  if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", boot); else boot();
  if (w.MutationObserver) {
    var waiting = false;
    new w.MutationObserver(function () {
      if (waiting) return;
      waiting = true;
      (w.requestAnimationFrame || w.setTimeout)(function () { waiting = false; boot(); });
    }).observe(D.documentElement, { childList: true, subtree: true });
  }
})();
