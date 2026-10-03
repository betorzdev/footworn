/* The snowfield: every site is a clearing in one snowy valley, every pageview a line of footprints
   from the gate it came through (its referrer) to the standing stone of its page, every event a
   stone on that page's cairn. Paths trodden over 30 days stay packed under the fresh snow; prints
   are covered in about three hours, and the nightly snowfall (UTC midnight, the day's cut) leaves
   the field clean. Lit by the viewer's clock. A classic script on a 2D canvas, no dependencies;
   every colour comes from tokens.css. app.js feeds it (/api/scene, the live socket). */
(function () {
  'use strict';

  var TAU = Math.PI * 2;
  var COVER = 3 * 3600 * 1000;   // ms until fresh snow hides a print
  var STEP = 115;                // ms between two prints of one walk
  var LIVE_WINDOW = 5 * 60 * 1000;
  var MAX_PRINTS = 3000;         // the most footprints on the ground at once; the oldest go first
  var R_SITE = 320, GAP = 1000, MARGIN = 560;
  var TILT = .58, OFFY = -6;
  var WEAR_SCALE = .5;

  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var smooth = function (a, b, v) { var t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  function rng(seed) {
    return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  var R = Math.random;
  var reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var regionName = (function () { try { var d = new Intl.DisplayNames(['en'], { type: 'region' }); return function (c) { return d.of(c); }; } catch (e) { return function (c) { return c; }; } })();
  function flag(c) { return /^[A-Z]{2}$/.test(c || '') ? String.fromCodePoint(127397 + c.charCodeAt(0), 127397 + c.charCodeAt(1)) : ''; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ago(ms) { var s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? s + ' s ago' : s < 3600 ? Math.round(s / 60) + ' min ago' : Math.floor(s / 3600) + ' h ' + Math.round(s % 3600 / 60) + ' min ago'; }

  /* ---------- the tokens ---------- */
  var T = {};
  function rgb(hex) { var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || ''); return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 255, 255]; }
  function readTokens() {
    var cs = getComputedStyle(document.documentElement), g = function (n) { return cs.getPropertyValue('--' + n).trim(); };
    ['scene-snow', 'scene-drift-dark', 'scene-drift-light', 'scene-speck-dark', 'scene-speck-light', 'scene-print', 'scene-print-rim',
      'scene-wear', 'scene-shadow', 'scene-pine', 'scene-pine-shade', 'scene-pine-snow', 'scene-trunk', 'scene-stone-lit', 'scene-stone-dark',
      'scene-cairn-1', 'scene-cairn-2', 'scene-cairn-3', 'scene-post', 'scene-rope', 'scene-glint', 'scene-flake', 'scene-ink',
      'scene-ink-halo', 'scene-ink-night', 'scene-ink-night-halo', 'scene-hover', 'font-scene', 'font-scene-big'].forEach(function (k) {
      T[k.replace(/-([a-z])/g, function (m, c) { return c.toUpperCase(); })] = g(k);
    });
    T.clear = rgb(g('scene-clear'));
    T.glow = rgb(g('scene-glow'));
    T.vignette = g('scene-vignette') || '15, 22, 45';
    T.sky = [[-1, rgb(g('sky-night'))], [-.3, rgb(g('sky-late'))], [-.06, rgb(g('sky-dusk'))], [.06, rgb(g('sky-gold'))],
      [.25, rgb(g('sky-warm'))], [.6, rgb(g('sky-day'))], [1, rgb(g('sky-day'))]];
  }
  var rgba = function (c, a) { return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a + ')'; };

  /* ---------- footprints, toes along +x; the other foot is the mirror ---------- */
  var FOOT = {}, TREAD = new Path2D();
  (function () {
    var p = new Path2D(); p.ellipse(.8, 0, 3.4, 1.9, 0, 0, TAU); p.moveTo(-1.5, .15); p.ellipse(-3.2, .15, 1.7, 1.5, 0, 0, TAU);
    [[4.9, -1.5, .8], [5.4, -.45, .72], [5.4, .55, .64], [5.1, 1.45, .56], [4.5, 2.15, .5]].forEach(function (t) { p.moveTo(t[0] + t[2], t[1]); p.arc(t[0], t[1], t[2], 0, TAU); });
    FOOT.phone = p;                                                  // bare feet
    p = new Path2D(); p.roundRect(-5, -2.2, 10.6, 4.4, 2.2); FOOT.tablet = p;       // trainers
    p = new Path2D(); p.roundRect(-1.4, -2.5, 7.8, 5, 2.2); p.roundRect(-6.2, -2.3, 3.4, 4.6, .9); FOOT.desktop = p;  // boots
    FOOT.unknown = FOOT.tablet;
    [-3, -1, 1, 3].forEach(function (x) { TREAD.moveTo(x, -1.5); TREAD.lineTo(x, 1.5); });
  })();
  var STRIDE = { phone: 12, tablet: 13.5, desktop: 15, unknown: 13.5 };
  var DEVICE = { phone: 'phone (bare feet)', tablet: 'tablet (trainers)', desktop: 'desktop (boots)', unknown: 'unknown screen' };

  /* ---------- state ---------- */
  var cv, ctx, tip, opts, DPR = 1, VW = 0, VH = 0;
  var W = 2000, H = 1600;
  var sites = [], byId = {};
  var trees = [], glints = [], walks = [], prints = [], puffs = [];
  var flakes = [];
  var drift, speck, sprite, wear, wctx, speckPattern = null;
  var view = { mode: 'valley', site: null, hover: null };
  var cam = { x: 0, y: 0, z: .5, from: null, to: null, t0: 0, dur: 1100 };
  var state = { hour: null, storm: null, running: false, last: 0, prune: 0 };
  var G = null;

  /* ---------- the valley ---------- */
  /* As many columns as frame the valley biggest in this window: a row on a laptop, a column on a phone. */
  function bestCols(n) {
    var ins = opts && opts.insets ? opts.insets() : { right: 0 }, best = 1, bz = 0, w = Math.max(1, cv.clientWidth - (ins.right || 0)), h = Math.max(1, cv.clientHeight);
    for (var c = 1; c <= Math.max(1, n); c++) {
      var r = Math.ceil(n / c), z = Math.min(w / (c * GAP), h / ((r * GAP * .85 + 300) * TILT));
      if (z > bz * 1.05) { bz = z; best = c; }
    }
    return best;
  }
  function buildWorld(list) {
    var n = list.length, cols = bestCols(n), rows = Math.ceil(n / cols);
    state.cols = cols;
    sites = []; byId = {};
    list.forEach(function (s, i) {
      var row = Math.floor(i / cols), col = i % cols, inRow = row === rows - 1 ? n - row * cols : cols, h = hash(s.id);
      var site = { id: s.id, name: s.name, r: R_SITE,
        x: (col - (inRow - 1) / 2) * GAP + ((h % 160) - 80), y: row * GAP * .85 + (((h >>> 8) % 120) - 60),
        marks: [], markBy: {}, other: null, gates: {}, gateList: [], topRefs: {},
        visitors: 0, pageviews: 0, events: 0, yesterday: 0, recent: [], loaded: false };
      sites.push(site); byId[s.id] = site;
    });
    var minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    sites.forEach(function (s) { minx = Math.min(minx, s.x - s.r); miny = Math.min(miny, s.y - s.r); maxx = Math.max(maxx, s.x + s.r); maxy = Math.max(maxy, s.y + s.r); });
    if (!sites.length) { minx = miny = -R_SITE; maxx = maxy = R_SITE; }
    sites.forEach(function (s) { s.x += MARGIN - minx; s.y += MARGIN - miny; });
    W = maxx - minx + MARGIN * 2; H = maxy - miny + MARGIN * 2;

    var tr = rng(42), want = Math.round(W * H * 8.6e-5), tries = 0;
    trees = [];
    while (trees.length < want && tries < want * 60) {
      tries++;
      var x = tr() * W, y = tr() * H, nz = (Math.sin(x * .004) + Math.sin(y * .005 + 1.3) + Math.sin((x + y) * .003)) / 3;
      if (tr() > .3 + nz) continue;
      if (sites.some(function (s) { return Math.hypot(x - s.x, y - s.y) < s.r + 70; })) continue;
      if (trees.some(function (t) { return Math.hypot(t.x - x, t.y - y) < 32; })) continue;
      trees.push({ x: x, y: y, r: 11 + tr() * 12 });
    }
    var gr = rng(5);
    glints = [];
    for (var i = 0, k = Math.round(W * H * 1.6e-4); i < k; i++) glints.push({ x: gr() * W, y: gr() * H, ph: gr() * TAU, sp: .6 + gr() * 1.4 });

    wear = document.createElement('canvas'); wear.width = Math.ceil(W * WEAR_SCALE); wear.height = Math.ceil(H * WEAR_SCALE);
    wctx = wear.getContext('2d'); wctx.fillStyle = T.sceneWear;
    walks = []; prints = []; puffs = [];
  }

  function textures() {
    drift = document.createElement('canvas'); drift.width = 122; drift.height = 90;
    var dc = drift.getContext('2d'), dr = rng(7), dark = T.sceneDriftDark, light = T.sceneDriftLight;
    for (var i = 0; i < 320; i++) {
      var x = dr() * 122, y = dr() * 90, r = 4 + dr() * 14, c = dr() < .5 ? dark : light, g = dc.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, c); g.addColorStop(1, c.replace(/[\d.]+\)$/, '0)'));
      dc.fillStyle = g; dc.fillRect(x - r, y - r, r * 2, r * 2);
    }
    speck = document.createElement('canvas'); speck.width = speck.height = 128;
    var sc = speck.getContext('2d'), sr = rng(9);
    for (i = 0; i < 160; i++) { sc.fillStyle = sr() < .5 ? T.sceneSpeckDark : T.sceneSpeckLight; sc.beginPath(); sc.arc(sr() * 128, sr() * 128, .4 + sr() * .9, 0, TAU); sc.fill(); }
    speckPattern = null;
    sprite = document.createElement('canvas'); sprite.width = sprite.height = 64;
    var s2 = sprite.getContext('2d'), sg = s2.createRadialGradient(32, 32, 0, 32, 32, 32);
    sg.addColorStop(0, rgba(T.glow.map(function (v) { return Math.min(255, v + 40); }), 1)); sg.addColorStop(.25, rgba(T.glow, .55)); sg.addColorStop(1, rgba(T.glow, 0));
    s2.fillStyle = sg; s2.fillRect(0, 0, 64, 64);
  }

  /* ---------- one clearing ---------- */
  /* Ten places for stones: the middle (kept for "/") and a ring of nine. A page takes the ring
     slot its name hashes to, or the next free one, so a site's stones stay put from day to day. */
  function slots(s) {
    var out = [{ x: s.x, y: s.y + s.r * .04 }];
    for (var i = 0; i < 9; i++) { var a = i / 9 * TAU + .35, d = s.r * (i % 2 ? .62 : .44); out.push({ x: s.x + Math.cos(a) * d, y: s.y + Math.sin(a) * d }); }
    return out;
  }
  function gateKey(ref) { return ref == null ? 'direct' : 'ref:' + ref; }

  function layoutSite(s, data) {
    var free = slots(s), taken = {}, maxTotal = Math.max(1, Math.max.apply(null, data.pages.map(function (p) { return p.hits; }).concat([1])));
    function place(path) {
      if (path === '/' && !taken[0]) { taken[0] = true; return free[0]; }
      var i = hash(path) % 9;
      for (var k = 0; k < 9; k++) { var j = 1 + (i + k) % 9; if (!taken[j]) { taken[j] = true; return free[j]; } }
      return free[0];
    }
    s.marks = []; s.markBy = {};
    data.pages.slice().sort(function (a, b) { return a.value === '/' ? -1 : b.value === '/' ? 1 : a.value < b.value ? -1 : 1; }).forEach(function (p) {
      var at = place(p.value), m = { path: p.value, label: p.value, x: at.x, y: at.y, total: p.hits, rm: 9 + 15 * Math.sqrt(p.hits / maxTotal), visits: 0, events: 0, cairn: [] };
      s.marks.push(m); s.markBy[p.value] = m;
    });
    var oat = place('…other');
    s.other = { path: null, label: 'other pages', x: oat.x, y: oat.y, total: 0, rm: 9, visits: 0, events: 0, cairn: [], other: true };
    s.marks.push(s.other);

    s.gates = {}; s.topRefs = {};
    var named = data.refs.map(function (r) { return r.value; }).sort();
    named.forEach(function (r) { s.topRefs[r] = true; });
    var arc = named.map(function (r) { return { key: gateKey(r), ref: r, label: r }; });
    arc.push({ key: 'elsewhere', ref: undefined, label: 'elsewhere' });
    arc.forEach(function (g, i) {
      var t = arc.length === 1 ? .5 : i / (arc.length - 1), a = Math.PI * (1.1 + t * .8);
      g.a = a; g.x = s.x + Math.cos(a) * (s.r + 12); g.y = s.y + Math.sin(a) * (s.r + 12); g.count = 0;
      s.gates[g.key] = g;
    });
    s.gates.direct = { key: 'direct', ref: null, label: 'direct · own pages', a: Math.PI / 2, x: s.x, y: s.y + s.r + 12, count: 0 };
    s.gateList = Object.keys(s.gates).map(function (k) { return s.gates[k]; });
  }
  function gateFor(s, ref) { return ref == null ? s.gates.direct : s.topRefs[ref] ? s.gates[gateKey(ref)] : s.gates.elsewhere; }
  function markFor(s, path) { return s.markBy[path] || s.other; }

  function walkPoints(g, m, device) {
    var sx = g.x, sy = g.y, ex = m.x + (R() - .5) * 22, ey = m.y + m.rm + 4 + R() * 10;
    var dx = ex - sx, dy = ey - sy, L = Math.hypot(dx, dy) || 1, off = (R() - .5) * .38 * L;
    var cx = (sx + ex) / 2 - dy / L * off, cy = (sy + ey) / 2 + dx / L * off;
    var stride = STRIDE[device] || STRIDE.unknown, pts = [], px = sx, py = sy, acc = 0, side = 1;
    for (var i = 1; i <= 90; i++) {
      var t = i / 90, u = 1 - t, x = u * u * sx + 2 * u * t * cx + t * t * ex, y = u * u * sy + 2 * u * t * cy + t * t * ey;
      acc += Math.hypot(x - px, y - py); px = x; py = y;
      if (acc >= stride) {
        acc -= stride; side = -side;
        var th = Math.atan2(2 * u * (cy - sy) + 2 * t * (ey - cy), 2 * u * (cx - sx) + 2 * t * (ex - cx));
        pts.push({ x: x - Math.sin(th) * side * 3.6, y: y + Math.cos(th) * side * 3.6, th: th + (R() - .5) * .16, side: side });
      }
    }
    return pts;
  }
  function stamp(x, y, a) { wctx.globalAlpha = a; wctx.beginPath(); wctx.arc(x * WEAR_SCALE + (R() - .5) * 3, y * WEAR_SCALE + (R() - .5) * 3, 3.6, 0, TAU); wctx.fill(); }
  function addPrint(w, born) {
    var p = w.pts[w.shown++];
    prints.push({ x: p.x, y: p.y, th: p.th, side: p.side, device: w.device, first: w.first, born: born, w: w });
    stamp(p.x, p.y, .02);
  }
  function puff(x, y, now, n) {
    if (reduced) return;
    for (var i = 0; i < n; i++) { var a = R() * TAU, v = 8 + R() * 22; puffs.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, born: now, life: 700 + R() * 600, r: 1 + R() * 2.2 }); }
  }

  /* Fills a clearing from /api/scene: stones, gates, today's counts, the worn paths, and the last
     three hours turned back into footprints (their country is not in the aggregate, so none). */
  function load(s, data) {
    var now = performance.now(), nowMs = Date.now();
    layoutSite(s, data);
    walks = walks.filter(function (w) { return w.site !== s; });
    prints = prints.filter(function (p) { return p.w.site !== s; });
    s.visitors = data.today.visitors; s.pageviews = data.today.hits; s.events = data.today.events;
    s.yesterday = data.yesterday.visitors; s.recent = [];
    data.today.pages.forEach(function (p) {
      var m = markFor(s, p.path); m.visits += p.hits; m.events += p.events;
      for (var i = 0; i < Math.min(p.events, 40); i++) m.cairn.push({ born: -Infinity });
    });
    data.today.refs.forEach(function (r) { gateFor(s, r.ref).count += r.hits; });

    /* The worn paths: this clearing's patch of the wear layer, redrawn from the 30-day counts. */
    wctx.save(); wctx.beginPath(); wctx.arc(s.x * WEAR_SCALE, s.y * WEAR_SCALE, (s.r + 80) * WEAR_SCALE, 0, TAU); wctx.clip();
    wctx.clearRect(0, 0, wear.width, wear.height);
    var max = Math.max(1, Math.max.apply(null, data.wear.map(function (w) { return w.hits; }).concat([1])));
    data.wear.forEach(function (row) {
      var k = Math.sqrt(row.hits / max), n = 3 + Math.round(18 * k), a = .006 + .022 * k, g = gateFor(s, row.ref), m = markFor(s, row.path);
      for (var i = 0; i < n; i++) walkPoints(g, m, 'tablet').forEach(function (p) { stamp(p.x, p.y, a); });
    });
    wctx.restore();

    /* Today's last hours, as footprints: newest first, until the ground holds its share. */
    var back = [];
    data.recent.forEach(function (row) {
      for (var i = 0; i < row.hits; i++) {
        var t = Math.min(nowMs, (row.block + R() * 600) * 1000), born = now - (nowMs - t);
        if (nowMs - t > COVER) continue;
        back.push({ row: row, born: born });
      }
    });
    back.sort(function (a, b) { return b.born - a.born; });
    var budget = Math.floor(MAX_PRINTS / Math.max(1, sites.length)), used = 0;
    back.forEach(function (b) {
      if (now - b.born < LIVE_WINDOW) s.recent.push(b.born);
      if (used > budget) return;
      var g = gateFor(s, b.row.ref), m = markFor(s, b.row.path), dev = b.row.device || 'unknown';
      var w = { site: s, mark: m, gate: g, ref: b.row.ref, device: dev, first: !!b.row.first, country: null, born: b.born, pts: walkPoints(g, m, dev), shown: 0 };
      while (w.shown < w.pts.length) addPrint(w, w.born + w.shown * STEP);
      used += w.pts.length;
    });
    prints.sort(function (a, b) { return a.born - b.born; });
    s.loaded = true;
  }

  /* One hit from the live socket. */
  function live(msg) {
    var s = byId[msg.site]; if (!s || !s.loaded || state.storm) return;
    var now = performance.now(), m = markFor(s, msg.path);
    if (msg.event) {
      m.cairn.push({ born: now }); m.events++; s.events++;
      puff(m.x + m.rm + 16, m.y + 6, now, 5);
      return;
    }
    var g = gateFor(s, msg.ref), dev = msg.device || 'unknown';
    var w = { site: s, mark: m, gate: g, ref: msg.ref, device: dev, first: !!msg.first, country: msg.country || null, born: now, pts: walkPoints(g, m, dev), shown: 0, live: true };
    s.pageviews++; if (w.first) s.visitors++; m.visits++; g.count++; s.recent.push(now);
    if (reduced) { while (w.shown < w.pts.length) addPrint(w, now); } else walks.push(w);
    puff(g.x, g.y, now, 9);
  }

  /* ---------- light ---------- */
  function lightAt(h) {
    var e = Math.sin((h - 6) / 12 * Math.PI), S = T.sky, i = 0;
    while (i < S.length - 2 && e > S[i + 1][0]) i++;
    var t = clamp((e - S[i][0]) / (S[i + 1][0] - S[i][0]), 0, 1), tint = S[i][1].map(function (v, k) { return lerp(v, S[i + 1][1][k], t); });
    var lum = (.2126 * tint[0] + .7152 * tint[1] + .0722 * tint[2]) / 255;
    var dx = Math.cos((h - 6) / 12 * Math.PI), dy = .7; if (e < 0) dx = -dx;   // the moon takes over at night
    var n = Math.hypot(dx, dy);
    return { e: e, tint: tint, lum: lum, dx: dx / n, dy: dy / n, len: clamp(1 / Math.max(Math.abs(e), .14), 1, 5),
      shA: e > 0 ? .2 * smooth(0, .15, e) + .04 : .08, night: smooth(.1, -.3, e) };
  }
  function hourNow() { if (state.hour !== null) return state.hour; var d = new Date(); return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600; }

  /* ---------- camera ---------- */
  function fitValley() {
    var minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    sites.forEach(function (s) { minx = Math.min(minx, s.x - s.r - 80); miny = Math.min(miny, s.y - s.r - 150); maxx = Math.max(maxx, s.x + s.r + 80); maxy = Math.max(maxy, s.y + s.r + 60); });
    if (!sites.length) return { x: W / 2, y: H / 2, z: .5 };
    var top = opts.insets ? opts.insets() : { top: 100, bottom: 100, right: 0 }, right = top.right || 0;
    var z = clamp(Math.min((VW - right - 32) / (maxx - minx), (VH - top.top - top.bottom) / ((maxy - miny) * TILT)), .12, 1.6);
    return { x: (minx + maxx) / 2 + right / 2 / z, y: (miny + maxy) / 2 - (top.top - top.bottom) / 2 / (z * TILT), z: z };
  }
  function fitSite(s) {
    var top = opts.insets ? opts.insets() : { top: 100, bottom: 100, right: 0 }, right = top.right || 0;
    var wide = VW - right > 600, z = Math.min((VW - right - (wide ? 32 : 8)) / (s.r * 2 + (wide ? 300 : 40)), (VH - top.top - top.bottom) / ((s.r * 2 + 200) * TILT + 60));
    return { x: s.x + right / 2 / z, y: s.y - 10 - (top.top - top.bottom) / 2 / (z * TILT), z: clamp(z, .2, 3) };
  }
  function camGo(to, instant) {
    if (instant || reduced) { cam.x = to.x; cam.y = to.y; cam.z = to.z; cam.to = null; return; }
    cam.from = { x: cam.x, y: cam.y, z: cam.z }; cam.to = to; cam.t0 = performance.now();
  }
  function camStep(now) {
    if (!cam.to) return;
    var t = Math.min(1, (now - cam.t0) / cam.dur), e = t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    cam.x = lerp(cam.from.x, cam.to.x, e); cam.y = lerp(cam.from.y, cam.to.y, e);
    cam.z = Math.exp(lerp(Math.log(cam.from.z), Math.log(cam.to.z), e));
    if (t >= 1) cam.to = null;
  }
  function sp(x, y) { return [(x - cam.x) * cam.z + VW / 2, (y - cam.y) * cam.z * TILT + VH / 2 + OFFY]; }
  function wp(x, y) { return [(x - VW / 2) / cam.z + cam.x, (y - VH / 2 - OFFY) / (cam.z * TILT) + cam.y]; }
  /* Zoom by k keeping the world point under (x, y) where it is. */
  function zoomAt(x, y, k) {
    var before = wp(x, y);
    cam.z = clamp(cam.z * k, .08, 4);
    var after = wp(x, y);
    cam.x += before[0] - after[0]; cam.y += before[1] - after[1];
  }
  function onScreen(x, y, m) { m = m || 80; return x > -m && x < VW + m && y > -m * 2 && y < VH + m; }
  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1); VW = cv.clientWidth; VH = cv.clientHeight;
    cv.width = Math.round(VW * DPR); cv.height = Math.round(VH * DPR);
    camGo(view.mode === 'valley' ? fitValley() : fitSite(view.site), true);
  }

  /* ---------- the loop ---------- */
  function update(now, dt) {
    camStep(now);
    for (var i = 0; i < walks.length; i++) {
      var w = walks[i], due = Math.min(w.pts.length, Math.floor((now - w.born) / STEP) + 1);
      while (w.shown < due) addPrint(w, w.born + w.shown * STEP);
    }
    var k = dt / 1000;
    puffs.forEach(function (p) { p.x += p.vx * k; p.y += p.vy * k; p.vx *= .96; p.vy *= .96; });
    if (now - state.prune > 1000) {
      state.prune = now;
      prints = prints.filter(function (p) { return now - p.born < COVER; });
      if (prints.length > MAX_PRINTS) prints = prints.slice(prints.length - MAX_PRINTS);
      walks = walks.filter(function (w) { return w.shown < w.pts.length; });
      puffs = puffs.filter(function (p) { return now - p.born < p.life; });
      sites.forEach(function (s) { s.recent = s.recent.filter(function (t) { return now - t < LIVE_WINDOW; }); });
    }
    if (state.storm && now - state.storm.t0 > state.storm.dur) endStorm();
  }
  function stormK(now) { return state.storm ? clamp((now - state.storm.t0) / state.storm.dur, 0, 1) : 0; }
  function endStorm() {
    var done = state.storm.done; state.storm = null; prints = []; walks = []; puffs = [];
    wctx.globalCompositeOperation = 'destination-out'; wctx.globalAlpha = .38; wctx.fillRect(0, 0, wear.width, wear.height);
    wctx.globalCompositeOperation = 'source-over'; wctx.fillStyle = T.sceneWear;
    sites.forEach(function (s) {
      s.yesterday = s.visitors; s.visitors = s.pageviews = s.events = 0; s.recent = [];
      s.marks.forEach(function (m) { m.visits = m.events = 0; m.cairn = []; });
      s.gateList.forEach(function (g) { g.count = 0; });
    });
    if (done) done();
  }

  function frame(now) {
    if (!state.running) return;
    var dt = Math.min(64, now - state.last); state.last = now;
    if (!document.hidden && VW) { update(now, dt); draw(now, dt); }
    requestAnimationFrame(frame);
  }

  /* ---------- drawing ---------- */
  function ground() { ctx.setTransform(G.a, 0, 0, G.d, G.e, G.f); }

  function draw(now, dt) {
    var L = lightAt(hourNow()), z = cam.z, sk = stormK(now), fade = 1 - smooth(.15, .8, sk);
    G = { a: DPR * z, d: DPR * z * TILT, e: DPR * (VW / 2 - cam.x * z), f: DPR * (VH / 2 + OFFY - cam.y * z * TILT) };
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.fillStyle = T.sceneSnow; ctx.fillRect(0, 0, VW, VH);
    ground();
    ctx.globalAlpha = .95; ctx.drawImage(drift, -900, -900, W + 1800, H + 1800);
    if (!speckPattern) speckPattern = ctx.createPattern(speck, 'repeat');
    ctx.globalAlpha = .7; ctx.fillStyle = speckPattern; ctx.fillRect(-3000, -3000, W + 6000, H + 6000);
    ctx.globalAlpha = 1;
    sites.forEach(function (s) {
      var g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r + 60);
      g.addColorStop(0, rgba(T.clear, 1)); g.addColorStop(.8, rgba(T.clear, .9)); g.addColorStop(1, rgba(T.clear, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s.x, s.y, s.r + 60, 0, TAU); ctx.fill();
      if (view.hover && view.hover.kind === 'site' && view.hover.s === s) {
        ctx.strokeStyle = T.sceneHover; ctx.lineWidth = 3 / z; ctx.beginPath(); ctx.arc(s.x, s.y, s.r + 30, 0, TAU); ctx.stroke();
      }
    });
    ctx.globalAlpha = .72 * (1 - .38 * smooth(.3, 1, sk)); ctx.drawImage(wear, 0, 0, wear.width / WEAR_SCALE, wear.height / WEAR_SCALE); ctx.globalAlpha = 1;

    drawPrints(now, L, fade, z);

    ground(); ctx.fillStyle = T.sceneFlake;
    puffs.forEach(function (p) { var a = 1 - (now - p.born) / p.life; if (a <= 0) return; ctx.globalAlpha = a * .9; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill(); });
    ctx.globalAlpha = 1;

    drawUpright(now, L, z, fade);

    /* the hour: one multiply over everything, haze towards the horizon, darker corners */
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = rgba(L.tint, 1); ctx.fillRect(0, 0, VW, VH);
    ctx.globalCompositeOperation = 'source-over';
    var fg = ctx.createLinearGradient(0, 0, 0, VH * .45);
    fg.addColorStop(0, rgba(L.tint.map(function (v) { return Math.min(255, v + 30); }), .55)); fg.addColorStop(1, rgba(L.tint, 0));
    ctx.fillStyle = fg; ctx.fillRect(0, 0, VW, VH * .45);
    var vg = ctx.createRadialGradient(VW / 2, VH / 2, Math.min(VW, VH) * .35, VW / 2, VH / 2, Math.max(VW, VH) * .75);
    vg.addColorStop(0, 'rgba(' + T.vignette + ',0)'); vg.addColorStop(1, 'rgba(' + T.vignette + ',' + (.12 + .2 * L.night) + ')');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, VW, VH);

    drawGlow(now, L, z, fade);
    if (L.e > 0 && !reduced) drawGlints(now, L, z);
    drawHighlight(now, z);
    drawLabels(L, z);
    drawFlakes(now, dt, sk);
  }

  function drawPrints(now, L, fade, z) {
    var rx = -L.dx * .9, ry = -L.dy * .9, tread = z > 1.1;
    for (var i = 0; i < prints.length; i++) {
      var p = prints[i], age = now - p.born, a = 1 - age / COVER;
      if (a <= 0 || age < 0) continue;
      var s = sp(p.x, p.y); if (!onScreen(s[0], s[1], 20)) continue;
      a = Math.pow(a, 1.2) * (p.first ? .7 : .3) * fade;
      if (age < 260) a *= age / 260;
      var c = Math.cos(p.th), sn = Math.sin(p.th);
      var A = G.a * c, B = G.d * sn, C = -G.a * sn * p.side, D = G.d * c * p.side, E = G.a * p.x + G.e, F = G.d * p.y + G.f, path = FOOT[p.device] || FOOT.unknown;
      ctx.setTransform(A, B, C, D, E + G.a * rx, F + G.d * ry); ctx.globalAlpha = Math.min(1, a * 1.3); ctx.fillStyle = T.scenePrintRim; ctx.fill(path);
      ctx.setTransform(A, B, C, D, E, F); ctx.globalAlpha = a; ctx.fillStyle = T.scenePrint; ctx.fill(path);
      if (tread && p.device === 'tablet') { ctx.globalAlpha = a * .7; ctx.strokeStyle = T.sceneSnow; ctx.lineWidth = .7; ctx.stroke(TREAD); }
    }
    ctx.globalAlpha = 1;
  }

  /* Shadows on the ground first, then everything standing, back to front. */
  function drawUpright(now, L, z, fade) {
    var objs = [];
    trees.forEach(function (t) { var s = sp(t.x, t.y); if (onScreen(s[0], s[1], 140)) objs.push({ k: 0, o: t, y: t.y, sx: s[0], sy: s[1] }); });
    sites.forEach(function (st) {
      st.marks.forEach(function (m) {
        if (m.other && !m.visits && !m.events) return;
        var s = sp(m.x, m.y); if (!onScreen(s[0], s[1], 140)) return;
        objs.push({ k: 1, o: m, y: m.y, sx: s[0], sy: s[1] }); objs.push({ k: 3, o: m, y: m.y + 6, sx: s[0], sy: s[1] });
      });
      st.gateList.forEach(function (g) { var s = sp(g.x, g.y); if (onScreen(s[0], s[1], 140)) objs.push({ k: 2, o: g, y: g.y, sx: s[0], sy: s[1] }); });
    });
    ground(); ctx.fillStyle = T.sceneShadow;
    var shx = -L.dx, shy = -L.dy, ang = Math.atan2(shy, shx);
    objs.forEach(function (b) {
      var h = b.k === 0 ? b.o.r * 3.4 : b.k === 1 ? b.o.rm * 2.4 : b.k === 2 ? 26 : 0; if (!h) return;
      var len = h * L.len * .55, w = b.k === 0 ? b.o.r * .8 : b.k === 1 ? b.o.rm * .7 : 6;
      ctx.globalAlpha = L.shA * (b.k === 0 ? 1.3 : 1.6);
      ctx.beginPath(); ctx.ellipse(b.o.x + shx * len * .5, b.o.y + shy * len * .5, len * .55, w, ang, 0, TAU); ctx.fill();
    });
    ctx.globalAlpha = 1;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    objs.sort(function (a, b) { return a.y - b.y; });
    objs.forEach(function (b) {
      if (b.k === 0) tree(b, z, L.dx); else if (b.k === 1) stone(b, z, L.dx); else if (b.k === 2) gate(b, z); else cairn(b.o, now, z, fade, L);
    });
  }
  function tree(b, z, lit) {
    var o = b.o, sx = b.sx, sy = b.sy, h = o.r * 3.4 * z, w = o.r * 1.8 * z;
    ctx.fillStyle = T.sceneTrunk; ctx.fillRect(sx - w * .06, sy - h * .16, w * .12, h * .17);
    for (var i = 0; i < 3; i++) {
      var by = sy - h * .12 - i * h * .25, tw = w * (1 - i * .26), th = h * .42, ty = by - th;
      ctx.fillStyle = T.scenePine; ctx.beginPath(); ctx.moveTo(sx, ty); ctx.lineTo(sx - tw / 2, by); ctx.lineTo(sx + tw / 2, by); ctx.closePath(); ctx.fill();
      ctx.fillStyle = T.scenePineShade; ctx.beginPath(); ctx.moveTo(sx, ty); ctx.lineTo(sx - lit * tw / 2, by); ctx.lineTo(sx, by); ctx.closePath(); ctx.fill();
      ctx.fillStyle = T.scenePineSnow; ctx.beginPath(); ctx.moveTo(sx, ty); ctx.lineTo(sx - tw * .3, ty + th * .52); ctx.lineTo(sx - tw * .12, ty + th * .42);
      ctx.lineTo(sx, ty + th * .56); ctx.lineTo(sx + tw * .14, ty + th * .43); ctx.lineTo(sx + tw * .3, ty + th * .52); ctx.closePath(); ctx.fill();
    }
  }
  function stone(b, z, lit) {
    var o = b.o, sx = b.sx, sy = b.sy, w = o.rm * 1.35 * z, h = o.rm * 2.4 * z;
    var g = ctx.createLinearGradient(sx - w / 2, 0, sx + w / 2, 0);
    g.addColorStop(0, lit > 0 ? T.sceneStoneDark : T.sceneStoneLit); g.addColorStop(1, lit > 0 ? T.sceneStoneLit : T.sceneStoneDark);
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(sx - w / 2, sy); ctx.lineTo(sx - w * .46, sy - h * .62);
    ctx.quadraticCurveTo(sx - w * .32, sy - h, sx + w * .04, sy - h * .98); ctx.quadraticCurveTo(sx + w * .46, sy - h * .86, sx + w / 2, sy - h * .4);
    ctx.lineTo(sx + w / 2, sy); ctx.quadraticCurveTo(sx, sy + w * .12, sx - w / 2, sy); ctx.fill();
    ctx.fillStyle = T.scenePineSnow; ctx.beginPath(); ctx.ellipse(sx - w * .06, sy - h * .93, w * .36, h * .07, -.08, 0, TAU); ctx.fill();
    ctx.globalAlpha = .75; ctx.beginPath(); ctx.ellipse(sx, sy, w * .62, w * .14, 0, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
  }
  function gate(b, z) {
    var o = b.o, ta = o.a + Math.PI / 2, ox = Math.cos(ta) * 11, oy = Math.sin(ta) * 11, h = 26 * z;
    var A = sp(o.x + ox, o.y + oy), B = sp(o.x - ox, o.y - oy);
    ctx.strokeStyle = T.sceneRope; ctx.lineWidth = 1.2 * z; ctx.beginPath(); ctx.moveTo(A[0], A[1] - h * .78); ctx.quadraticCurveTo(b.sx, b.sy - h * .55, B[0], B[1] - h * .78); ctx.stroke();
    [A, B].forEach(function (p) {
      ctx.fillStyle = T.scenePost; ctx.fillRect(p[0] - 1.6 * z, p[1] - h, 3.2 * z, h);
      ctx.fillStyle = T.scenePineSnow; ctx.beginPath(); ctx.ellipse(p[0], p[1] - h, 2.6 * z, 1.4 * z, 0, 0, TAU); ctx.fill();
    });
  }
  function cairn(m, now, z, fade, L) {
    var n = m.cairn.length; if (!n) return;
    var p = sp(m.x + m.rm + 16, m.y + 6); if (!onScreen(p[0], p[1])) return;
    var k = clamp(z * 1.05, .55, 1.5), shown = Math.min(n, 9), y = p[1], cols = [T.sceneCairn1, T.sceneCairn2, T.sceneCairn3];
    ctx.globalAlpha = fade * .25; ctx.fillStyle = T.sceneShadow; ctx.beginPath(); ctx.ellipse(p[0] - L.dx * 6 * k, p[1] + 1, 9 * k, 2.6 * k, 0, 0, TAU); ctx.fill();
    ctx.globalAlpha = fade;
    for (var i = 0; i < shown; i++) {
      var st = m.cairn[n - shown + i], w = (11 - i * .8) * k, h = (4.4 - i * .15) * k, age = now - st.born;
      var off = age < 650 && !reduced ? Math.pow(1 - age / 650, 3) * 46 * k : 0;
      ctx.fillStyle = cols[i % 3]; ctx.beginPath(); ctx.ellipse(p[0] + Math.sin(i * 2.3) * 1.4 * k, y - h / 2 - off, w / 2, h / 2, Math.sin(i) * .12, 0, TAU); ctx.fill();
      if (i === shown - 1) { ctx.fillStyle = T.scenePineSnow; ctx.beginPath(); ctx.ellipse(p[0], y - h * .85 - off, w * .3, h * .22, 0, 0, TAU); ctx.fill(); }
      y -= h * .82;
    }
    ctx.globalAlpha = 1;
  }

  /* At night fresh prints keep a little light, and a live walker carries it. */
  function drawGlow(now, L, z, fade) {
    var strength = .35 + .65 * L.night; if (strength <= .01) return;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.globalCompositeOperation = 'lighter';
    var FRESH = 6000, m = Math.max(z, .5);
    for (var i = prints.length - 1; i >= 0; i--) {
      var p = prints[i], age = now - p.born; if (age > FRESH) break; if (age < 0) continue;
      var s = sp(p.x, p.y); if (!onScreen(s[0], s[1], 30)) continue;
      var a = Math.pow(1 - age / FRESH, 2) * strength * fade * (p.first ? .8 : .5), r = (10 + 8 * (1 - age / FRESH)) * m;
      ctx.globalAlpha = a; ctx.drawImage(sprite, s[0] - r, s[1] - r, r * 2, r * 2);
    }
    walks.forEach(function (w) {
      if (!w.shown) return; var p = w.pts[w.shown - 1], s = sp(p.x, p.y), r = 18 * m;
      ctx.globalAlpha = .6 * strength * fade; ctx.drawImage(sprite, s[0] - r, s[1] - r, r * 2, r * 2);
    });
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  function drawGlints(now, L, z) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = T.sceneGlint; ctx.lineWidth = 1;
    var r = 2.4 * Math.max(z, .6);
    glints.forEach(function (g) {
      var v = Math.sin(now * .0025 * g.sp + g.ph); if (v < .97) return;
      var s = sp(g.x, g.y); if (!onScreen(s[0], s[1], 0)) return;
      ctx.globalAlpha = (v - .97) / .03 * Math.min(1, L.e * 3);
      ctx.beginPath(); ctx.moveTo(s[0] - r, s[1]); ctx.lineTo(s[0] + r, s[1]); ctx.moveTo(s[0], s[1] - r); ctx.lineTo(s[0], s[1] + r); ctx.stroke();
    });
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  /* A visit picked in the list: a ring that keeps widening round its page's stone and its gate. */
  function drawHighlight(now, z) {
    var h = state.hl, s = h && byId[h.site]; if (!s || !s.loaded) return;
    var m = markFor(s, h.path), g = gateFor(s, h.ref), k = reduced ? 0 : (now % 1400) / 1400;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.strokeStyle = T.sceneHover;
    [[m.x, m.y, m.rm + 12], [g.x, g.y, 20]].forEach(function (c) {
      var p = sp(c[0], c[1]), r = c[2] * z;
      ctx.globalAlpha = 1; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(p[0], p[1], r, r * TILT, 0, 0, TAU); ctx.stroke();
      if (k) { ctx.globalAlpha = 1 - k; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(p[0], p[1], r * (1 + .6 * k), r * (1 + .6 * k) * TILT, 0, 0, TAU); ctx.stroke(); }
    });
    var a = sp(g.x, g.y), b = sp(m.x, m.y);
    ctx.globalAlpha = .7; ctx.lineWidth = 1.5; ctx.setLineDash([4, 5]); ctx.lineDashOffset = -now / 60;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }

  function label(str, x, y, font, L, align, alpha) {
    var dark = L.lum > .5;
    ctx.font = font; ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.lineWidth = 4; ctx.strokeStyle = dark ? T.sceneInkHalo : T.sceneInkNightHalo; ctx.strokeText(str, x, y);
    ctx.fillStyle = dark ? T.sceneInk : T.sceneInkNight; ctx.fillText(str, x, y);
    ctx.globalAlpha = 1;
  }
  function plural(n, one, many) { return n.toLocaleString('en') + ' ' + (n === 1 ? one : many); }
  function change(s) {
    if (!s.yesterday) return '';
    var d = Math.round((s.visitors / s.yesterday - 1) * 100);
    return ' · ' + (d > 0 ? '+' : d < 0 ? '−' : '±') + Math.abs(d) + '% vs yesterday';
  }
  function drawLabels(L, z) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    var still = !cam.to;
    sites.forEach(function (s) {
      if (view.mode === 'valley' && still) {
        var p = sp(s.x, s.y - s.r - 70);
        label(s.name, p[0], p[1] - 12, T.fontSceneBig, L);
        label(plural(s.visitors, 'visitor', 'visitors') + ' · ' + s.recent.length + ' live' + change(s), p[0], p[1] + 12, T.fontScene, L, 'center', .9);
      }
      if (view.mode === 'site' && view.site === s && still) {
        /* Close up, a name and its count; from further away (a phone) the name alone, the count in the tooltip. */
        var full = z >= .7;
        s.marks.forEach(function (m) {
          if (m.other && !m.visits && !m.events) return;
          var q = sp(m.x, m.y), up = m.rm * 2.4 * z + (full ? 12 : 8);
          label(m.label, q[0], q[1] - up, T.fontScene, L);
          if (full) label(m.visits + ' today' + (m.events ? ' · ' + plural(m.events, 'event', 'events') : ''), q[0], q[1] - up + 15, T.fontScene, L, 'center', .75);
        });
        s.gateList.forEach(function (g) {
          var ca = Math.cos(g.a), sa = Math.sin(g.a), q = sp(g.x + ca * 34, g.y + sa * 34), al = Math.abs(ca) < .3 ? 'center' : ca > 0 ? 'left' : 'right';
          if (!full) { label(g.label, q[0], q[1], T.fontScene, L, al, .85); return; }
          label(g.label, q[0], q[1] - 8, T.fontScene, L, al); label(plural(g.count, 'arrival', 'arrivals'), q[0], q[1] + 8, T.fontScene, L, al, .75);
        });
      }
    });
  }
  function drawFlakes(now, dt, sk) {
    if (reduced) return;
    var n = Math.min(flakes.length, Math.round(150 * (1 + 4 * Math.sin(sk * Math.PI)))), k = dt / 1000;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.fillStyle = T.sceneFlake;
    for (var i = 0; i < n; i++) {
      var f = flakes[i];
      f.y += (.025 + .06 * f.z) * k * (1 + sk * 2.5); f.x += (Math.sin(now / 1400 + f.ph) * .006 + .012 * sk) * k * f.z;
      if (f.y > 1.02) { f.y = -.02; f.x = R(); } if (f.x > 1.02) f.x = -.02;
      ctx.globalAlpha = .3 + .6 * f.z; ctx.beginPath(); ctx.arc(f.x * VW, f.y * VH, .6 + 1.9 * f.z, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* ---------- pointer ---------- */
  function hitTest(x, y) {
    var w = wp(x, y), z = cam.z, i, s;
    if (view.mode === 'valley') { for (i = 0; i < sites.length; i++) { s = sites[i]; if (Math.hypot(w[0] - s.x, w[1] - s.y) < s.r + 40) return { kind: 'site', s: s }; } return null; }
    s = view.site; var now = performance.now();
    for (i = 0; i < s.marks.length; i++) {
      var m = s.marks[i]; if (m.other && !m.visits && !m.events) continue;
      var p = sp(m.x, m.y);
      if (Math.abs(x - p[0]) < m.rm * .7 * z + 6 && y < p[1] + 6 && y > p[1] - m.rm * 2.4 * z - 4) return { kind: 'mark', m: m };
    }
    for (i = 0; i < s.gateList.length; i++) { var g = s.gateList[i], q = sp(g.x, g.y); if (Math.hypot(x - q[0], y - (q[1] - 10 * z)) < 20) return { kind: 'gate', g: g }; }
    var best = null, bd = 10;
    for (i = prints.length - 1; i >= 0; i--) {
      var pr = prints[i]; if (pr.w.site !== s || now - pr.born > COVER * .8) continue;
      var r = sp(pr.x, pr.y), d = Math.hypot(x - r[0], y - r[1]); if (d < bd) { bd = d; best = pr; }
    }
    if (best) return { kind: 'print', p: best };
    if (Math.hypot(w[0] - s.x, w[1] - s.y) > s.r + 120) return { kind: 'out' };
    return null;
  }
  function showTip(h, x, y) {
    if (!tip) return;
    if (!h || h.kind === 'out') { tip.hidden = true; return; }
    var html = '';
    if (h.kind === 'site') html = '<strong>' + esc(h.s.name) + '</strong>' + plural(h.s.visitors, 'visitor', 'visitors') + ' · ' + plural(h.s.pageviews, 'pageview', 'pageviews') + ' today<small>Click to walk in</small>';
    if (h.kind === 'mark') html = '<strong>' + esc(h.m.label) + '</strong>' + plural(h.m.visits, 'pageview', 'pageviews') + ' today · ' + plural(h.m.events, 'event', 'events') +
      (h.m.other ? '<small>Pages outside the 30-day top 8</small>' : '<small>' + plural(h.m.total, 'pageview', 'pageviews') + ' in the last 30 days</small>');
    if (h.kind === 'gate') html = '<strong>' + esc(h.g.label) + '</strong>' + plural(h.g.count, 'arrival', 'arrivals') + ' today' +
      (h.g.key === 'elsewhere' ? '<small>Referrers outside the 30-day top 5</small>' : h.g.key === 'direct' ? '<small>No referrer, or a link from the site itself</small>' : '');
    if (h.kind === 'print') {
      var w = h.p.w;
      html = (w.country ? '<strong>' + flag(w.country) + ' ' + esc(regionName(w.country)) + '</strong>' : '<strong>' + esc(w.mark.label) + '</strong>') +
        esc(DEVICE[w.device] || w.device) + ' · ' + (w.first ? 'first page of the day' : 'another page') +
        '<small>' + esc(w.ref || 'direct') + ' → ' + esc(w.mark.other ? 'other pages' : w.mark.label) + ' · ' + ago(performance.now() - w.born) + '</small>';
    }
    tip.innerHTML = html; tip.hidden = false;
    var r = tip.getBoundingClientRect();
    tip.style.left = Math.max(8, Math.min(x + 16, VW - r.width - 8)) + 'px';
    tip.style.top = Math.max(8, y - r.height - 12) + 'px';
  }

  /* ---------- the public face ---------- */
  function enter(id, instant) {
    var s = byId[id]; if (!s) return;
    view.mode = 'site'; view.site = s; if (tip) tip.hidden = true;
    camGo(fitSite(s), instant);
  }
  function leave(instant) { view.mode = 'valley'; view.site = null; if (tip) tip.hidden = true; camGo(fitValley(), instant); }

  window.FootwornScene = {
    /* canvas, { tip, insets() -> {top, bottom}, onEnter(id), onLeave() } */
    init: function (canvas, o) {
      cv = canvas; ctx = cv.getContext('2d'); opts = o || {}; tip = opts.tip || null;
      readTokens(); textures();
      flakes = []; for (var i = 0; i < 700; i++) flakes.push({ x: R(), y: R(), z: .25 + R() * .75, ph: R() * TAU });
      window.addEventListener('resize', resize);
      /* Drag to pan, pinch or wheel to zoom; a press that did not move is a click (enter a clearing,
         leave it, or on a touch screen show the tooltip a mouse would get by hovering). */
      var pts = {}, moved = false, pinch = 0;
      cv.addEventListener('pointerdown', function (e) {
        pts[e.pointerId] = { x: e.clientX, y: e.clientY }; moved = false;
        if (Object.keys(pts).length === 2) { var p = Object.values(pts); pinch = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); }
        try { cv.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
      });
      cv.addEventListener('pointermove', function (e) {
        var prev = pts[e.pointerId];
        if (prev) {
          var dx = e.clientX - prev.x, dy = e.clientY - prev.y, ids = Object.keys(pts);
          if (!moved && Math.hypot(dx, dy) < 6) return;
          moved = true; cam.to = null; if (tip) tip.hidden = true;
          if (ids.length === 1) { cam.x -= dx / cam.z; cam.y -= dy / (cam.z * TILT); }
          prev.x = e.clientX; prev.y = e.clientY;
          if (ids.length === 2) { var p = Object.values(pts), d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); if (pinch) zoomAt((p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2, d / pinch); pinch = d; }
          return;
        }
        if (e.pointerType !== 'mouse') return;
        var h = hitTest(e.clientX, e.clientY); view.hover = h; showTip(h, e.clientX, e.clientY);
        cv.style.cursor = h && (h.kind === 'site' || h.kind === 'out') ? 'pointer' : '';
      });
      var up = function (e) { delete pts[e.pointerId]; pinch = 0; };
      cv.addEventListener('pointerup', up);
      cv.addEventListener('pointercancel', up);
      cv.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') { view.hover = null; if (tip) tip.hidden = true; } });
      cv.addEventListener('wheel', function (e) { e.preventDefault(); cam.to = null; zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * .0015)); }, { passive: false });
      cv.addEventListener('click', function (e) {
        if (moved) { moved = false; return; }
        var h = hitTest(e.clientX, e.clientY);
        if (h && h.kind === 'site' && opts.onEnter) opts.onEnter(h.s.id);
        else if (h && h.kind === 'out' && opts.onLeave) opts.onLeave();
        else showTip(h, e.clientX, e.clientY);
      });
    },
    /* [{id, name}], in the order the API lists them: the valley is laid out once from it. */
    setSites: function (list) {
      var was = view.site && view.site.id; buildWorld(list);
      if (was && byId[was]) view.site = byId[was]; else if (was) { view.mode = 'valley'; view.site = null; }
      resize(); if (!state.running) { state.running = true; state.last = performance.now(); requestAnimationFrame(frame); } },
    load: function (id, data) { var s = byId[id]; if (s) load(s, data); },
    live: live,
    enter: enter,
    leave: leave,
    refit: function (animate) { camGo(view.mode === 'valley' ? fitValley() : fitSite(view.site), !animate); },
    /* True when the window's shape now asks for another arrangement of the valley (setSites again). */
    wantsRelayout: function () { return !!sites.length && bestCols(sites.length) !== state.cols; },
    /* The day's cut: a heavy snowfall, then `done` (app.js reloads the counts). */
    snowfall: function (done) { if (!state.storm) state.storm = { t0: performance.now(), dur: reduced ? 1 : 5200, done: done }; },
    /* Rings one visit's stone and gate ({ site, path, ref }), or nothing (null). */
    highlight: function (h) { state.hl = h || null; },
    /* Fixes the light at an hour (0-24), for a preview; null follows the clock again. */
    setHour: function (h) { state.hour = h == null || isNaN(h) ? null : clamp(+h, 0, 24); },
    stats: function (id) {
      var list = id ? [byId[id]].filter(Boolean) : sites;
      return list.reduce(function (t, s) { t.visitors += s.visitors; t.pageviews += s.pageviews; t.events += s.events; t.live += s.recent.length; return t; },
        { visitors: 0, pageviews: 0, events: 0, live: 0 });
    },
  };
})();
