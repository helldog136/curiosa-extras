// A FAKE BROWSER for the moving page of the mascot overlay element: it runs the REAL script of the page against fake elements, a fake clock, a fake AudioContext,
// a fake speechSynthesis and a fake Audio. Time only moves when the test says so (Date.now() and the timers move together).
import vm from "node:vm";

class FEl {
  constructor(id, tag, attrs) {
    this.id = id; this.tag = tag; this.textContent = ""; this.hidden = /\shidden(\s|=|$)/.test(attrs); this.attrs = {}; this.style = { setProperty() {} }; this.log = [];
    this._c = new Set((/class="([^"]*)"/.exec(attrs)?.[1] ?? "").split(/\s+/).filter(Boolean));
    this.clientWidth = 400; this.clientHeight = 300; this.scrollHeight = 100; this.offsetWidth = 1;
    const alt = /\salt="([^"]*)"/.exec(attrs); if (alt) this.attrs.alt = alt[1];
  }
  get classList() { const s = this._c; return { add: (c) => s.add(c), remove: (c) => s.delete(c), contains: (c) => s.has(c), toggle: (c, on) => { if (on === undefined ? !s.has(c) : on) s.add(c); else s.delete(c); return s.has(c); } }; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === "src") this.log.push(String(v)); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  getBoundingClientRect() { return { left: 0, top: 200, right: 300, bottom: 320, width: 300, height: 120 }; }
  get on() { return this._c.has("on"); }
}

/**
 * @param {string} doc the whole page (HTML)
 * @param {object} o { start, reducedMotion, voices (speechSynthesis voices, null = no speechSynthesis at all), audioState, sampleSeconds, noAudio }
 */
export function runStage(doc, o = {}) {
  const els = {};
  for (const m of doc.matchAll(/<(\w+)([^>]*?)\sid="([\w-]+)"([^>]*)>/g)) els[m[3]] = new FEl(m[3], m[1], `${m[2]} ${m[4]}`);
  const json = /<script type="application\/json" id="d">([\s\S]*?)<\/script>/.exec(doc)[1];
  els.d = new FEl("d", "script", ""); els.d.textContent = json;
  const script = [...doc.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n");
  let clock = o.start ?? 1_000_000_000_000, tid = 0;
  const timers = [], listeners = { click: [] };
  const world = { oscillators: [], sources: [], contexts: [], decoded: 0, preloaded: [], utterances: [], spoken: 0, cancelled: 0, audios: [], fetched: [] };

  class FakeAudioContext {
    constructor() { this.state = o.audioState ?? "running"; this.currentTime = 0; this.destination = {}; world.contexts.push(this); }
    resume() { this.state = "running"; return Promise.resolve(); }
    createOscillator() {
      const x = { type: "", freq: 0, glideTo: 0, stopped: false, frequency: { setValueAtTime: (f) => { x.freq = f; }, exponentialRampToValueAtTime: (f) => { x.glideTo = f; } }, connect() {}, start(t) { x.startAt = t; }, stop() { x.stopped = true; } };
      world.oscillators.push(x); return x;
    }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
    createBufferSource() {
      const x = { buffer: null, playbackRate: { value: 1 }, stopped: false, connect() {}, start(t, off, len) { x.args = [t, off, len]; }, stop() { x.stopped = true; }, onended: null };
      world.sources.push(x); return x;
    }
    decodeAudioData() { world.decoded++; return Promise.resolve({ duration: o.sampleSeconds ?? 0.5 }); }
  }
  class FakeUtterance { constructor(text) { this.text = text; } }
  const speechSynthesis = o.voices === null || o.voices === undefined ? undefined : {
    speaking: false, getVoices: () => o.voices, cancel() { world.cancelled++; this.speaking = false; }, speak(u) { world.utterances.push(u); world.spoken++; this.speaking = true; },
  };
  class FakeAudio {
    constructor(src) { this.src = src; this.volume = 1; this.currentTime = 0; this.paused = true; this.plays = 0; world.audios.push(this); }
    play() { this.plays++; this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
  }
  class FakeImage { set src(v) { world.preloaded.push(v); } }
  const win = {
    JSON, Math, Number, String, Promise, Object, Array, Error, RegExp, encodeURIComponent, parseInt, ArrayBuffer,
    Date: { now: () => clock },
    document: { getElementById: (id) => els[id] ?? null, addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); } },
    location: { pathname: "/m/k/element/mascot", search: "?lang=en&ov-demo=1" },
    matchMedia: (q) => ({ matches: Boolean(o.reducedMotion) && /reduce/.test(q) }),
    setTimeout: (fn, ms) => { timers.push({ id: ++tid, at: clock + (ms || 0), fn }); return tid; },
    clearTimeout: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    addEventListener() {},
    Image: FakeImage,
    fetch: async (u) => { world.fetched.push(u); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; },
    XMLHttpRequest: class { open() {} send() {} },
    ...(o.noAudio ? {} : { AudioContext: FakeAudioContext }),
    SpeechSynthesisUtterance: FakeUtterance, Audio: FakeAudio, ...(speechSynthesis ? { speechSynthesis } : {}),
  };
  win.window = win;
  vm.runInContext(script, vm.createContext(win));
  const flush = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
  return {
    els, world, flush, click: () => { for (const f of listeners.click) f(); },
    get now() { return clock; },
    get timers() { return timers.length; },
    /** Moves the clock: runs the timers that fall due, in order, then lets the promises settle. */
    async advance(ms) { const end = clock + ms; await flush(); for (;;) { timers.sort((a, b) => a.at - b.at || a.id - b.id); const t = timers[0]; if (!t || t.at > end) break; timers.shift(); clock = Math.max(clock, t.at); t.fn(); await flush(); } clock = end; await flush(); },
  };
}
