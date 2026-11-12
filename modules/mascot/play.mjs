// Mascot — what runs in the page of an overlay element to move and to speak: the picture player (an animated picture or a few pictures one after the other) and the voice
// (blips made by the page itself, the voice of the computer, or the sound of a short video of the site).
//
// Both functions are SELF-CONTAINED (no outside variable): their source is put as it is in the page (`mascotPlayer.toString()`), like the shared transition helper.
// Nothing here is loaded when the mascot has no animation, no voice and is always visible: the page of an existing configuration stays byte for byte what it was.

/* eslint-disable no-var */

/**
 * The picture player of one `<img>`.
 *   spec  { kind: "gif", src } | { kind: "frames", frames: [src...], fps, once }
 *   calm  true when the visitor asked for less motion: the first picture only, no loop.
 * play(spec, restart) → true when the picture shows; false when it cannot (a GIF cannot be frozen: with less motion the caller falls back to the still drawing).
 * An animated GIF cannot be paused or rewound by a page: to restart it ("restart") the player loads it under a new address (`?mc=n`), the only reliable way; the file comes from the
 * browser cache after the first time only if the site allows it, so prefer a few pictures for a talking animation that must start exactly with the sentence.
 */
export function mascotPlayer(img, calm) {
  var timer = 0, count = 0, seen = {};
  function load(src) { if (!seen[src] && typeof Image === "function") { seen[src] = 1; try { var p = new Image(); p.src = src; } catch (e) { /* nothing to preload */ } } }
  function stop() { clearTimeout(timer); timer = 0; }
  function show(src) { if (img.getAttribute("src") !== src) img.setAttribute("src", src); }
  return {
    /** Fetch every picture now, so that nothing flickers when the loop starts. */
    preload: function (spec) { if (!spec) return; if (spec.kind === "gif") load(spec.src); else for (var i = 0; i < spec.frames.length; i++) load(spec.frames[i]); },
    stop: stop,
    play: function (spec, restart) {
      stop();
      if (!spec) { img.hidden = true; return false; }
      if (spec.kind === "gif") {
        if (calm) { img.hidden = true; return false; }
        var url = spec.src;
        if (restart) { count++; url += (url.indexOf("?") < 0 ? "?" : "&") + "mc=" + count; }
        show(url); img.hidden = false; return true;
      }
      var i = 0, n = spec.frames.length;
      show(spec.frames[0]); img.hidden = false;
      if (calm || n < 2) return true;
      (function tick() {
        timer = setTimeout(function () {
          i++;
          if (i >= n) { if (spec.once) { timer = 0; return; } i = 0; }
          show(spec.frames[i]); tick();
        }, 1000 / (spec.fps > 0 ? spec.fps : 8));
      })();
      return true;
    },
  };
}

/**
 * The voice. `w` is the window; `v`:
 *   { mode: "blips"|"speech"|"custom", volume 0..1, lang (of the page),
 *     blips: { wave, base, glide, len, pitch, vary, rate, sample? ("/uploads/….mp4": the file used as the blip) }, speech: { lang, name, rate, pitch }, custom: "/uploads/….mp4" }
 *   plan  the function `blipPlan` (the plan of the blips of a sentence).
 * say(text, seconds) starts it (the sound ends by itself when the time is over: stop() is also called by the page); stop() silences everything at once.
 * state() tells, in a word, what happened last: "blips" | "speech" | "custom" | "nospeech" (no voice on this computer: blips were used instead) | "blocked" (the browser waits for a click) | "silent".
 * unlock() must be called from a click or a key press: it wakes the sound of a browser that waits for one (OBS browser sources do not).
 */
export function mascotVoice(w, v, plan) {
  var ctx = null, nodes = [], audio = null, killer = 0, last = "silent", voiceName = "";
  function context() {
    if (ctx) return ctx;
    var C = w.AudioContext || w.webkitAudioContext;
    if (!C) return null;
    try { ctx = new C(); } catch (e) { ctx = null; }
    return ctx;
  }
  function stop() {
    clearTimeout(killer); killer = 0;
    for (var i = 0; i < nodes.length; i++) { try { nodes[i].stop(); } catch (e) { /* already over */ } }
    nodes = [];
    try { if (w.speechSynthesis && w.speechSynthesis.speaking) w.speechSynthesis.cancel(); } catch (e) { /* no voice */ }
    try { if (audio) { audio.pause(); audio.currentTime = 0; } } catch (e) { /* not playing */ }
  }
  // "Your own sound" as the blip: the file is fetched and decoded ONCE, then every letter plays its first 0.2 s, pitched by playbackRate = 2^(semitones/12) (kept between 0.5 and 2.5),
  // with a short fade out; at most 6 voices at the same time.
  var buffer = null, loading = 0, live = 0;
  function sample(c) {
    if (buffer || loading || !v.blips.sample || !w.fetch) return;
    loading = 1;
    w.fetch(v.blips.sample).then(function (r) { return r.arrayBuffer(); }).then(function (data) { return c.decodeAudioData(data); }).then(function (b) { buffer = b; }, function () { loading = 2; });
  }
  function samples(c, list, t0) {
    var n = 0;
    for (var i = 0; i < list.length; i++) {
      if (live >= 6) continue;
      var k = list[i], at = t0 + k.t, o = c.createBufferSource(), g = c.createGain(), len = Math.min(k.len, buffer.duration);
      o.buffer = buffer; o.playbackRate.value = Math.min(2.5, Math.max(0.5, Math.pow(2, k.s / 12)));
      g.gain.setValueAtTime(Math.max(0.0002, v.volume * 0.8), at); g.gain.setValueAtTime(Math.max(0.0002, v.volume * 0.8), at + len * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, at + len);
      o.connect(g); g.connect(c.destination); live++; o.onended = function () { live--; };
      o.start(at, 0, len); o.stop(at + len + 0.02); nodes.push(o); n++;
    }
    return n > 0;
  }
  function blips(text, seconds) {
    var c = context();
    if (!c) return false;
    if (c.state === "suspended" && c.resume) { try { c.resume(); } catch (e) { /* needs a click */ } }
    var b = v.blips, list = plan(text, seconds, b), t0 = c.currentTime + 0.02;
    if (b.sample) {
      sample(c);
      if (!buffer) { last = "silent"; return false; }   // the sound is still loading (or could not be read): this sentence is silent, the next one will sound
      last = c.state === "running" || c.state === undefined ? "blips" : "blocked";
      return samples(c, list, t0);
    }
    for (var i = 0; i < list.length; i++) {
      var k = list[i], o = c.createOscillator(), g = c.createGain(), at = t0 + k.t;
      o.type = b.wave; o.frequency.setValueAtTime(k.f, at);
      if (b.glide !== 1) o.frequency.exponentialRampToValueAtTime(k.f * b.glide, at + k.len);
      g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(Math.max(0.0002, v.volume * 0.4), at + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, at + k.len);
      o.connect(g); g.connect(c.destination); o.start(at); o.stop(at + k.len + 0.02); nodes.push(o);
    }
    last = c.state === "running" || c.state === undefined ? "blips" : "blocked";
    return list.length > 0;
  }
  function speak(text) {
    var s = w.speechSynthesis;
    if (!s || typeof w.SpeechSynthesisUtterance !== "function") return false;
    var all = s.getVoices ? s.getVoices() : [];
    if (!all || !all.length) return false;
    var want = String(v.speech.name || "").toLowerCase(), lang = String(v.speech.lang || v.lang || "").toLowerCase().slice(0, 2), pick = null, i;
    if (want) for (i = 0; i < all.length && !pick; i++) if (String(all[i].name).toLowerCase().indexOf(want) > -1) pick = all[i];
    if (!pick && lang) for (i = 0; i < all.length && !pick; i++) if (String(all[i].lang).toLowerCase().slice(0, 2) === lang) pick = all[i];
    if (!pick) for (i = 0; i < all.length && !pick; i++) if (all[i].default) pick = all[i];
    pick = pick || all[0];
    var u = new w.SpeechSynthesisUtterance(text);
    u.voice = pick; u.lang = pick.lang || lang; u.rate = v.speech.rate; u.pitch = v.speech.pitch; u.volume = v.volume;
    voiceName = pick.name;
    try { s.cancel(); s.speak(u); } catch (e) { return false; }
    last = "speech";
    return true;
  }
  function custom() {
    if (!v.custom || typeof w.Audio !== "function") return false;
    if (!audio) { audio = new w.Audio(v.custom); audio.preload = "auto"; }
    audio.volume = v.volume;
    try { audio.currentTime = 0; } catch (e) { /* not loaded yet */ }
    var p = audio.play();
    last = "custom";
    if (p && p.catch) p.catch(function () { last = "blocked"; });
    return true;
  }
  if (v.mode === "blips" && v.blips.sample) { var c0 = context(); if (c0) sample(c0); }
  if (v.mode === "speech" && w.speechSynthesis && w.speechSynthesis.getVoices) { try { w.speechSynthesis.getVoices(); } catch (e) { /* the list loads later */ } }
  return {
    say: function (text, seconds) {
      stop();
      var ok = false;
      if (v.mode === "blips") ok = blips(text, seconds);
      else if (v.mode === "speech") { ok = speak(text); if (!ok) { ok = blips(text, seconds); if (ok) last = "nospeech"; } }
      else if (v.mode === "custom") ok = custom();
      if (!ok) last = "silent";
      killer = setTimeout(stop, Math.max(0.2, seconds) * 1000);
    },
    stop: stop,
    state: function () { return last; },
    voice: function () { return voiceName; },
    unlock: function () {
      var c = context();
      if (c && c.resume) { try { c.resume(); } catch (e) { /* ignored */ } }
      if (audio) { try { var p = audio.play(); if (p && p.then) p.then(function () { audio.pause(); audio.currentTime = 0; }, function () {}); } catch (e) { /* ignored */ } }
    },
  };
}
