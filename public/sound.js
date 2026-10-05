/* The village's sound, off until the Sound button asks for it: what the scene shows, said again
   for the ear. village.js gives a cue where each thing happens, and every cue is synthesised here
   with the Web Audio API (no samples, no libraries, nothing the CSP has to allow):
   - `gate`, a pageview just arrived and its villager comes in: two steps in the snow, darker or
     brighter by the gate (the referrer);
   - `door`, the villager reaches the house: a hand bell whose pitch is the page (a pentatonic
     scale, so a busy minute never clashes; the top page is the lowest), answered an octave up
     when that visit was a new visitor's;
   - `stall`, a view opened reaches its stall: a wind chime, its pitch the view;
   - `event`, any other event: the fireworks, far off;
   - `midnight`, the day's cut: the tower strikes once.
   Each village sounds from its side of the valley. A cue is { site, of, lane, house, view,
   first, delay }: village `site` of `of`, left to right; `delay` in seconds.
   The dashboard lives on a second screen, so the sound costs nothing at rest either: there is no
   bed under the cues, the context is made only once sound is on, and it is put to sleep a few
   seconds after the last cue fades. A browser lets no page sound before a click: with the
   choice remembered from another day, the state is `waiting` until the first one. A window
   as narrow as a phone has no Sound button (style.css), and no sound.
   The slider beside the button is the volume, 0 to 100, kept like the choice itself. */
(function () {
  'use strict';

  var STORE = 'footworn.sound', VOLUME = 'footworn.sound.volume';
  var USUAL = 80;       // the slider's place until it is moved
  function gain(v) { return v * v / 10000; }   // squared: half the slider sounds like half. Never over 1: the compressor before it is no brick wall
  var REST = 4000;      // ms from a cue to the sleep of the audio thread: every tail is over by then
  var REST_TOLL = 9000; // the tower rings longer
  var BUSY = 4, BUSY_MS = 250;   // a busy moment sounds four cues of a kind: the rest are seen, not heard
  var WARM = .2;        // s of its own time before a new context is given anything: what it gets sooner comes out faint
  var LATE = 1000;      // ms a cue waits for a sleeping context: past that it is only seen, never played late

  var PENTA = [0, 2, 4, 7, 9], ROOT = 293.66;   // D major pentatonic, from D4
  function note(k, octave) { return ROOT * Math.pow(2, (PENTA[k % 5] + 12 * Math.floor(k / 5)) / 12 + (octave || 0)); }
  /* Struck metal as a few sine partials, each [ratio, level, share of the decay]. */
  var GLOCK = [[1, 1, 1], [2.756, .4, .5], [5.404, .16, .28], [8.933, .05, .16]];
  var HAND = [[.5, .3, 1], [1, 1, .85], [1.19, .42, .6], [1.5, .3, .5], [2, .4, .45], [2.51, .16, .3], [3.01, .1, .24]];
  var TOWER = [[.5, .6, 1], [1, 1, .8], [1.2, .65, .55], [1.5, .3, .45], [2, .55, .4], [2.6, .22, .25], [3, .14, .2], [4.1, .1, .15]];

  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function save(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* no storage */ } }

  /* The instruments on one context: dry and a little of a short, dark room, through a limiter. */
  function kit(ctx, volume) {
    var out = ctx.createGain(), comp = ctx.createDynamicsCompressor(), verb = ctx.createConvolver(), wet = ctx.createGain(), main = ctx.createGain();
    out.gain.value = .7; wet.gain.value = .2; main.gain.value = gain(volume);
    comp.threshold.value = -18; comp.ratio.value = 12; comp.attack.value = .002; comp.release.value = .25;
    verb.buffer = impulse(1.6);
    out.connect(comp); out.connect(verb); verb.connect(wet); wet.connect(comp); comp.connect(main); main.connect(ctx.destination);
    var noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    (function () { var d = noise.getChannelData(0); for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; })();

    /* Noise that dies away, darker as it goes. */
    function impulse(sec) {
      var n = Math.round(ctx.sampleRate * sec), b = ctx.createBuffer(2, n, ctx.sampleRate);
      for (var c = 0; c < 2; c++) {
        var d = b.getChannelData(c), lp = 0;
        for (var i = 0; i < n; i++) { var x = i / n; lp += ((Math.random() * 2 - 1) - lp) * (.5 - .4 * x); d[i] = lp * Math.pow(1 - x, 3); }
      }
      return b;
    }
    /* Where a cue sits: its village's side of the valley. One panner per place, kept. */
    var pans = {};
    function at(c) {
      if (!ctx.createStereoPanner || !(c.of > 1)) return out;
      var k = c.site + '/' + c.of, p = pans[k];
      if (!p) { p = pans[k] = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, (c.site / (c.of - 1) - .5) * 1.1)); p.connect(out); }
      return p;
    }
    function when(c) { return Math.max(ctx.currentTime + .03, WARM) + (c.delay || 0); }

    function tone(dest, t, f, peak, decay, o) {
      o = o || {};
      if (f > 14000 || peak <= 0) return;
      var osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = o.type || 'sine'; osc.frequency.setValueAtTime(f, t);
      if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + decay);
      g.gain.setValueAtTime(.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + .004);
      g.gain.exponentialRampToValueAtTime(.0001, t + decay);
      osc.connect(g); g.connect(dest); osc.start(t); osc.stop(t + decay + .05);
    }
    function struck(dest, t, f, partials, peak, decay) {
      partials.forEach(function (p) { tone(dest, t, f * p[0], peak * p[1], decay * p[2]); });
    }
    /* Filtered noise under an envelope: a plain hit, or a jagged `curve` for something granular. */
    function burst(dest, t, dur, o) {
      var src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = noise; src.loop = true;
      f.type = o.type || 'bandpass'; f.frequency.setValueAtTime(o.f, t); f.Q.value = o.q || 1;
      if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
      g.gain.value = 0;
      if (o.curve) g.gain.setValueCurveAtTime(o.curve, t, dur);
      else { g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(o.peak, t + .003); g.gain.exponentialRampToValueAtTime(.0001, t + dur); }
      src.connect(f); f.connect(g); g.connect(dest); src.start(t, Math.random() * .5); src.stop(t + dur + .05);
    }
    /* Snow giving way under a boot: a fast rise, a slow fall, and grains all along it. */
    function crunch(peak) {
      var n = 36, c = new Float32Array(n);
      for (var i = 1; i < n - 1; i++) { var x = i / n, hull = Math.min(1, x * 10) * Math.pow(1 - x, 1.6); c[i] = peak * hull * (Math.random() < .22 ? .12 : .4 + .6 * Math.random()); }
      return c;
    }
    function step(dest, t, colour, level) {
      burst(dest, t, .17, { f: colour, q: .8, curve: crunch(level) });
      burst(dest, t, .13, { f: colour * 2.6, q: 1.3, curve: crunch(level * .45) });
      tone(dest, t, 88, level * .35, .09, { to: 50 });
    }

    return { level: function (v) { main.gain.setTargetAtTime(gain(v), ctx.currentTime, .02); }, cues: {
      gate: function (c) {
        var d = at(c), t = when(c), colour = 950 + ((c.lane || 0) % 7) * 170;   // a gate's own snow
        step(d, t, colour, .55); step(d, t + .4, colour * 1.08, .38);
      },
      door: function (c) {
        var d = at(c), t = when(c), f = note(c.house || 0);
        struck(d, t, f, HAND, .22, 2.2);
        if (c.first) struck(d, t + .15, f * 2, HAND, .14, 1.6);
      },
      stall: function (c) {
        var d = at(c), t = when(c);
        [0, 1, 3].forEach(function (k, i) { struck(d, t + i * (.07 + Math.random() * .05), note((c.view || 0) + k, 2), GLOCK, .1, .7); });
      },
      event: function (c) {
        var d = at(c), t = when(c);
        tone(d, t, 115, .42, .3, { to: 42 });
        burst(d, t, .38, { type: 'lowpass', f: 1300, to: 180, q: .7, peak: .34 });
        for (var i = 0; i < 14; i++) { var x = Math.random(); burst(d, t + .16 + x * 1.1, .03, { type: 'highpass', f: 3600, q: .7, peak: .09 * (1 - x * .8) }); }   // the crackle
      },
      midnight: function (c) { struck(out, when(c), 196, TOWER, .2, 5.5); },   // G3, the fourth of the scale
      hello: function (c) { struck(out, when(c), note(2), HAND, .22, 1.2); },   // Sound, just switched on, or the slider let go: this is how loud it is
    } };
  }

  window.FootwornSound = function () {
    var AC = window.AudioContext || window.webkitAudioContext;
    var small = window.matchMedia ? matchMedia('(max-width: 760px)') : null;   // where style.css puts the button away
    var want = !!AC && load(STORE) === '1', awake = false, ctx = null, cues = null, level = null, idle = null, until = 0, recent = {}, heard = [], said = null;
    var vol = parseInt(load(VOLUME), 10); vol = vol >= 0 && vol <= 100 ? vol : USUAL;

    function state() { return !want ? 'off' : awake ? 'on' : 'waiting'; }
    function changed() { heard.forEach(function (fn) { fn(state()); }); }
    function build() { ctx = new AC(); var k = kit(ctx, vol); cues = k.cues; level = k.level; }
    function sleep() { idle = null; if (ctx && ctx.state === 'running') ctx.suspend(); }
    function rest(ms) { var now = performance.now(); until = Math.max(until, now + ms); clearTimeout(idle); idle = setTimeout(sleep, until - now); }
    function quiet() { clearTimeout(idle); idle = null; until = 0; recent = {}; if (ctx) { try { ctx.close(); } catch (e) { /* closed */ } ctx = null; cues = null; level = null; } }

    function cue(name, c) {
      if (!want || !awake || !vol || document.hidden || small && small.matches) return;   // at volume 0 nothing is made at all
      var now = performance.now(), r = recent[name] = (recent[name] || []).filter(function (x) { return now - x < BUSY_MS; });
      if (name !== 'midnight' && name !== 'hello') { if (r.length >= BUSY) return; r.push(now); }   // the tower is never crowded out
      try {
        if (!ctx) build();
        var play = cues[name], mine = ctx, up = idle !== null && ctx.state === 'running';   // no timer: asleep, or falling asleep
        if (!play) return;
        c = c || {};
        rest((name === 'midnight' ? REST_TOLL : REST) + (c.delay || 0) * 1000);
        if (up) play(c);
        else ctx.resume().then(function () { if (ctx === mine && performance.now() - now < LATE) play(c); }, function () { /* not allowed to: this one is only seen */ });
      } catch (e) { /* no audio here: the scene goes on without it */ }
    }

    /* Inside a click: from here on it may play, and a bell says so. The context is made now,
       where every browser allows it, even if the window is too narrow to sound yet. */
    function start() {
      document.removeEventListener('click', wake);
      awake = true;
      try { if (!ctx) build(); rest(REST); } catch (e) { /* no audio here */ }
      clearTimeout(said); cue('hello'); changed();   // one bell, even when it was the slider that was clicked
    }
    /* The first click anywhere after a load with sound remembered on. On the way up, so a click
       on the Sound button itself has reached `toggle` first. */
    function wake() { if (want && !awake) start(); else document.removeEventListener('click', wake); }
    if (want) {
      if (navigator.userActivation && navigator.userActivation.hasBeenActive) awake = true;
      else document.addEventListener('click', wake);
    }

    return {
      supported: !!AC,
      cue: cue,
      state: state,
      /* From the button's click, which is the gesture a browser asks for. While it waits, that
         click starts it; otherwise it turns it on or off. */
      toggle: function () {
        if (!AC) return;
        if (want && !awake) { start(); return; }
        want = !want; save(STORE, want ? '1' : '0');
        if (want) start(); else { quiet(); changed(); }
      },
      onchange: function (fn) { heard.push(fn); },
      volume: function () { return vol; },
      /* From the slider: heard at once while it moves; let go (`done`), it is kept, and a bell
         says how loud that is (once it rests: an arrow key held down is one bell, one write).
         Moved while the sound waits, it is the gesture that starts it. */
      setVolume: function (v, done) {
        v = Math.round(+v);
        if (!(v >= 0 && v <= 100)) return;
        vol = v;
        if (level) level(vol);
        if (!done) return;
        clearTimeout(said);
        if (want && !awake) { save(VOLUME, String(vol)); start(); return; }
        said = setTimeout(function () { save(VOLUME, String(vol)); cue('hello'); }, 300);
      },
    };
  };
})();
