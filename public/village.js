/* The village: every site is a snowed-in village round a clock square on a winter night, all on
   one scale, so the tallest houses belong to the busiest pages anywhere. In each village:
   - every page is a house in the ring round the square (the 30-day top 8, in that order, so they
     never trade places during the day, plus "other pages"); its storeys are today's pageviews,
     its warm windows, from the ground up, the share of loads that were used;
   - every referrer is a gate in the palisade (the 30-day top 5, then elsewhere and direct), as
     wide as today's arrivals, with lanterns in its colour;
   - every hour of the day (UTC) is a street lamp round the square, clockwise from midnight at the
     top: its height is that hour's pageviews, the brass ring yesterday's, the bright one now;
   - every view opened inside a page (a `screen` event with a `view`) is a stall in the market
     round the clock tower (the 30-day top 8, then other views): the lanterns lit on its garland
     up to the tower are today's opens, and a stall nobody opened today is shut and dark;
   - every live visit is a villager with a lantern, in through its gate, across the square, home;
     every view opened live one who leaves that page's house for the stall, in a scarf of the
     lanterns' colour; every other event fireworks over its house.
   Click a village (or its sign) and the camera flies in. At UTC midnight the windows go dark and
   the day starts again. A classic script over gl.js (WebGL2), no dependencies; every colour comes
   from tokens.css. app.js feeds it (/api/scene, the live socket) through the same interface the
   bay had.
   What stands still (the land, each village in a layer of its own) is given to gl.js once and
   kept there; a visit draws its own village again, two seconds apart at most, and only if it
   changed what is seen. Each frame gives only what moves: villagers, fireworks, smoke, the ring
   round a highlighted house. */
(function () {
  'use strict';

  var G = window.FootwornGL, TAU = Math.PI * 2;
  var BLACKOUT_MS = 4200;
  var REBUILD_MS = 2000;   // a village that keeps changing is drawn again this often at most
  var NOW_LOW = .5;        // the lamp of the hour breathes between this and 1
  var R_POST = 6.4, R_HOUSE = 11.2, R_WALL = 16, R_WALK = 8.7, FLOOR = .95, SPACING = 37;
  var R_STALL = 4.3, R_MARKET = 5.8, GARLAND = 6;   // the stalls' ring, the one walked round them, the lanterns of a garland
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  function rand(a, b) { var x = Math.sin(a * 127.1 + (b || 0) * 311.7) * 43758.5453; return x - Math.floor(x); }
  var reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(n) { return (n || 0).toLocaleString('en'); }
  function plural(n, one, many) { return fmt(n) + ' ' + (n === 1 ? one : many); }
  function pct(a, b) { return b ? Math.min(100, Math.round(100 * a / b)) : 0; }
  function narrow() { return window.innerWidth < 760; }
  function ang(k, n) { return -Math.PI / 2 + k / n * TAU; }   // 0 at the top (−z), clockwise seen from above
  function at(o, a, r) { return [o[0] + Math.cos(a) * r, 0, o[2] + Math.sin(a) * r]; }
  function angDiff(a, b) { return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))); }

  /* ---------- the tokens ---------- */
  var T = {};
  function readTokens() {
    var cs = getComputedStyle(document.documentElement);
    function col(n) {
      var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(cs.getPropertyValue('--village-' + n).trim());
      return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : [1, 1, 1];
    }
    ['sky-top', 'sky-mid', 'sky-low', 'moon', 'moonlight', 'sky-light', 'ground-light', 'rim', 'edge', 'snow', 'snow-2', 'path', 'stone',
      'stone-dark', 'rock', 'timber', 'trunk', 'pine', 'roof', 'iron', 'brass', 'clock', 'window', 'window-dark', 'lamp', 'coat', 'skin',
      'smoke', 'flake', 'star', 'view', 'awning', 'awning-2'].forEach(function (k) { T[k.replace(/-([a-z0-9])/g, function (m, c) { return c.toUpperCase(); })] = col(k); });
    T.walls = []; T.sites = [];
    for (var i = 1; i <= 8; i++) { T.walls.push(col('wall-' + i)); T.sites.push(col('site-' + i)); }
    T.lanes = [1, 2, 3, 4, 5].map(function (i) { return col('lane-' + i); });
    T.elsewhere = col('lane-elsewhere'); T.direct = col('lane-direct');
  }
  function css(c) { return 'rgb(' + c.map(function (v) { return Math.round(v * 255); }).join(',') + ')'; }

  /* ---------- state ---------- */
  var W = null, cv, overlay, tip, opts = {}, failed = false;
  var sites = [], byId = {};
  var view = { mode: 'bay', site: null, hl: null, free: false };
  var state = { blackout: null, dark: null, hour: -1 };
  var land, landOcc = [], smoke = [];

  /* ---------- the sites (the counts are the bay's, unchanged) ---------- */
  function makeSite(s, i) {
    return { id: s.id, name: s.name, idx: i, tint: T.sites[i % T.sites.length], towers: [], towerBy: {}, other: null, lanes: [], laneBy: {},
      views: [], viewBy: {}, otherView: null, stalls: [],
      visitors: 0, pageviews: 0, viewsToday: 0, events: 0, loads: 0, engaged: 0, yesterday: 0, hours: [], loaded: false,
      o: [0, 0, 0], houses: [], gates: [], walkers: [], sparks: [], sign: null,
      layer: null, sig: null, pending: false, builtAt: 0, labels: {}, pools: [], occ: [], glow: [] };
  }
  /* Its houses are the 30-day top 8 pages, in that order, plus "other pages" when today reached any
     page outside them; its gates the 30-day top 5 referrers, then elsewhere and direct; its stalls
     the 30-day top 8 views, plus "other views" the same way. Storeys and counts are today's. */
  function load(s, data) {
    s.towers = []; s.towerBy = {};
    data.pages.forEach(function (p, k) { var t = { path: p.value, label: p.value, total: p.hits, pv: 0, loads: 0, engaged: 0, events: 0, seed: s.idx * 97 + k * 13 }; s.towers.push(t); s.towerBy[p.value] = t; });
    s.other = { path: null, label: 'other pages', total: 0, pv: 0, loads: 0, engaged: 0, events: 0, seed: s.idx * 97 + 99, other: true };
    data.today.pages.forEach(function (p) { var t = s.towerBy[p.path] || s.other; t.pv += p.hits; t.loads += p.loads || 0; t.engaged += p.engaged || 0; t.events += p.events; });
    if (s.other.pv || s.other.events) s.towers.push(s.other);
    s.lanes = []; s.laneBy = {};
    data.refs.forEach(function (r, k) { var l = { key: 'ref:' + r.value, ref: r.value, label: r.value, color: T.lanes[k % T.lanes.length], count: 0 }; s.lanes.push(l); s.laneBy[l.key] = l; });
    [{ key: 'elsewhere', label: 'elsewhere', color: T.elsewhere }, { key: 'direct', label: 'direct', color: T.direct }].forEach(function (l) { l.count = 0; s.lanes.push(l); s.laneBy[l.key] = l; });
    data.today.refs.forEach(function (r) { laneFor(s, r.ref).count += r.hits; });
    s.views = []; s.viewBy = {}; s.stalls = [];
    (data.views || []).forEach(function (v) { var x = { name: v.value, label: v.value, total: v.hits, n: 0, by: {} }; s.views.push(x); s.viewBy['v:' + v.value] = x; });
    s.otherView = { name: null, label: 'other views', total: 0, n: 0, by: {}, other: true };
    (data.today.views || []).forEach(function (v) { viewOf(s, v.view).n += v.hits; });
    (data.today.viewPages || []).forEach(function (v) { cameFrom(viewOf(s, v.view), towerOf(s, v.path), v.hits); });
    if (s.otherView.n) s.views.push(s.otherView);
    s.visitors = data.today.visitors; s.pageviews = data.today.hits; s.viewsToday = data.today.viewsTotal || 0; s.events = data.today.events; s.loads = data.today.loads || 0; s.engaged = data.today.engaged || 0;
    s.yesterday = data.yesterday.visitors;
    s.hours = data.hours || [];
    s.walkers = []; s.sparks = [];
    s.loaded = true;
    rebuild(s, true);   // new towers and lanes: its houses and gates are made again
  }
  function laneFor(s, ref) { return ref == null ? s.laneBy.direct : s.laneBy['ref:' + ref] || s.laneBy.elsewhere; }
  function towerOf(s, path) { return s.towerBy[path] || s.other; }
  function towerFor(s, path) {
    var t = s.towerBy[path]; if (t) return t;
    if (s.towers.indexOf(s.other) < 0) { s.towers.push(s.other); rebuild(s, true); }
    return s.other;
  }
  function isView(msg) { return msg.event === 'screen' && !!msg.props && typeof msg.props.view === 'string'; }
  function viewOf(s, name) { return s.viewBy['v:' + name] || s.otherView; }   // prefixed: a view's name is anything a site sends
  function viewFor(s, name) {
    var v = viewOf(s, name);
    if (s.views.indexOf(v) < 0) { s.views.push(v); rebuild(s, true); }
    return v;
  }
  /* `n` opens of a view came from a page: kept for its tooltip. */
  function cameFrom(v, t, n) { v.by[t.label] = (v.by[t.label] || 0) + n; }
  /* Today's events that are not views: a view is stored as an event, and is counted as a view. */
  function otherEvents(s) { return Math.max(0, s.events - s.viewsToday); }

  /* One hit from the live socket. */
  function live(msg) {
    var s = byId[msg.site]; if (!s || !s.loaded || state.blackout) return;
    var t = towerFor(s, msg.path), v = isView(msg) ? viewFor(s, msg.props.view) : null;
    if (v) { v.n++; s.viewsToday++; if (!v.other) v.total++; cameFrom(v, t, 1); }   // before the village is drawn: a stall that is new opens lit
    if (s.sig == null) refresh(true);   // a village not drawn yet (just loaded, or with a new house or stall) has no door to walk to
    var h = houseOf(s, t);
    if (W) W.wake();
    if (msg.event) {
      t.events++; s.events++;
      if (v) { rebuild(s); toStall(s, h, stallOf(s, v)); }
      else if (h && W) s.sparks.push({ h: h, t: 0, col: T.sites[s.idx % T.sites.length] });
      return;
    }
    var l = laneFor(s, msg.ref);
    s.pageviews++; if (msg.first) s.visitors++; t.pv++; l.count++;
    if (s.loads) { s.loads++; t.loads++; }
    var hr = s.hours[new Date().getUTCHours()]; if (hr) hr.today++;
    rebuild(s);
    var g = gateOf(s, l);
    if (!h || !g || !W) return;
    if (reduced) { h.flash = 1; return; }
    var side = (Math.random() - .5) * g.w * .5, tan = [-Math.sin(g.a) * side, 0, Math.cos(g.a) * side];
    var path = [[g.end[0] + tan[0], 0, g.end[2] + tan[2]], [g.pos[0] + tan[0], 0, g.pos[2] + tan[2]]];
    walkRound(path, s, g.a, h.a, R_WALK);
    path.push(h.door);
    s.walkers.push({ path: path, d: 0, speed: 2.3 + Math.random() * .7, col: g.col, h: h, seed: Math.random() });
  }
  /* Onto a walker's path: round the square at radius `r`, the short way from angle `a0` to `a1`. */
  function walkRound(path, s, a0, a1, r) {
    var da = Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0)), steps = Math.max(1, Math.ceil(Math.abs(da) / .25));
    for (var k = 0; k <= steps; k++) path.push(at(s.o, a0 + da * k / steps, r));
  }
  /* A view opened: out of the page's door, across the lamp ring between two lamps, round the
     market to the stall. */
  function toStall(s, h, st) {
    if (!h || !st || !W) return;
    if (reduced) { st.flash = 1; return; }
    var step = TAU / 24, cross = (Math.floor((h.a + Math.PI / 2) / step) + .5) * step - Math.PI / 2;
    var path = [h.door.slice(), at(s.o, cross, R_POST + .9)];
    walkRound(path, s, cross, st.a, R_MARKET);
    path.push(st.front.slice());
    s.walkers.push({ path: path, d: 0, speed: 2.3 + Math.random() * .7, col: T.view, stall: st, seed: Math.random() });
  }
  function houseOf(s, t) { for (var i = 0; i < s.houses.length; i++) if (s.houses[i].t === t) return s.houses[i]; return null; }
  function gateOf(s, l) { for (var i = 0; i < s.gates.length; i++) if (s.gates[i].l === l) return s.gates[i]; return null; }
  function stallOf(s, v) { for (var i = 0; i < s.stalls.length; i++) if (s.stalls[i].v === v) return s.stalls[i]; return null; }

  /* ---------- the land: one village per site, side by side in the valley ---------- */
  function place() {
    var n = sites.length;
    sites.forEach(function (s, i) { s.o = [(i - (n - 1) / 2) * SPACING, 0, i % 2 ? -7 : 3]; });
    var xs = sites.map(function (s) { return s.o[0]; }), x0 = Math.min.apply(null, xs.concat([0])) - 34, x1 = Math.max.apply(null, xs.concat([0])) + 34;
    var size = Math.max(x1 - x0, 96);
    if (W) W.bounds([(x0 + x1) / 2 - size / 2, -3 - size / 2, size]);
  }
  function hf(x, z) {
    var d = Infinity; sites.forEach(function (s) { d = Math.min(d, Math.hypot(x - s.o[0], z - s.o[2])); });
    if (!sites.length) d = Math.hypot(x, z);
    var dune = Math.sin(x * .21 + Math.cos(z * .17) * 2) * .25 + Math.sin(z * .13 - x * .05) * .3;
    return clamp((d - R_WALL - 1.5) / 6, 0, 1) * (dune + .25) + Math.max(0, d - 30) * .05 * (1 + .6 * Math.sin(x * .07 + z * .05)) + Math.max(0, -z - 50) * .08;
  }
  function pine(M, x, y, z, s, occ) {
    M.cyl(x, y, z, .12 * s, .7 * s, 5, T.trunk);
    for (var k = 0; k < 3; k++) {
      var ty = y + (.5 + k * .75) * s, r = (1.05 - k * .27) * s, h = 1.25 * s;
      M.cone(x, ty, z, r, h, 7, T.pine, 0, true);
      M.cone(x, ty + h * .42, z, r * .6, h * .58, 7, T.snow, 0, true);
    }
    occ.push([x, z, 1.6 * s]);
  }
  /* The ground, the mountains and the woods: built when the sites change, never per hit. */
  function buildLand() {
    var M = land.mesh; M.clear(); landOcc = [];
    var b = W.box, cx = b[0] + b[2] / 2, cz = b[1] + b[2] / 2, ext = b[2] / 2 + 110;
    M.terrain(cx - ext, cz - ext, ext * 2, Math.min(150, Math.round(ext)), hf, function (h, x, z) { return G.mix(T.snow, T.snow2, (Math.sin(x * .3) * Math.cos(z * .27) + 1) / 2); });
    for (var k = 0; k < 3; k++) {
      var R = ext + 60 + k * 60, n = 260;
      var peak = function (a) { return 10 + k * 12 + (Math.sin(a * (2 + k) + k * 1.7) * .5 + .5) * (14 + k * 9) + Math.pow(Math.abs(Math.sin(a * (5 + k * 2) + k)), 3) * (10 + k * 6) + Math.sin(a * 17 + k) * 1.5; };
      for (var i = 0; i < n; i++) {
        var a = i / n * TAU, a2 = (i + 1) / n * TAU, ha = peak(a), hb = peak(a2);
        var pa = [cx + Math.cos(a) * R, -4, cz + Math.sin(a) * R], pb = [cx + Math.cos(a2) * R, -4, cz + Math.sin(a2) * R];
        var ta = [cx + Math.cos(a) * (R - 25), ha, cz + Math.sin(a) * (R - 25)], tb = [cx + Math.cos(a2) * (R - 25), hb, cz + Math.sin(a2) * (R - 25)];
        var ma = [(pa[0] + ta[0]) / 2, ha * .6, (pa[2] + ta[2]) / 2], mb = [(pb[0] + tb[0]) / 2, hb * .6, (pb[2] + tb[2]) / 2];
        M.quad(pb, pa, ma, mb, G.mix(G.mix(T.stoneDark, T.snow, .25 + k * .2), T.skyMid, .25), .55);
        M.quad(mb, ma, ta, tb, G.mix(T.snow, T.skyMid, .3), .55);
      }
    }
    var count = Math.round(ext * ext / 30);
    for (var t = 0; t < count; t++) {
      var x = cx - ext + rand(t, 1) * ext * 2, z = cz - ext + rand(t, 2) * ext * 2;
      if (Math.sin(x * .08) * Math.cos(z * .09) + Math.sin(x * .03 + z * .04) < .2) continue;
      if (sites.some(function (s) { return Math.hypot(x - s.o[0], z - s.o[2]) < R_WALL + 14; })) continue;
      pine(M, x, hf(x, z) - .1, z, .8 + rand(t, 3) * .9, landOcc);
    }
    for (var r = 0; r < count / 8; r++) {
      var rx = cx - ext + rand(r, 11) * ext * 2, rz = cz - ext + rand(r, 12) * ext * 2;
      if (sites.some(function (s) { return Math.hypot(rx - s.o[0], rz - s.o[2]) < R_WALL + 2; })) continue;
      var rs = .4 + rand(r, 13) * .8, ry = hf(rx, rz) - .1;
      M.lump(rx, ry, rz, rs, rs * .8, 7, T.rock, r); M.lump(rx, ry + rs * .55, rz, rs * .7, rs * .35, 7, T.snow, r + 3);
    }
    W.upload(land);
  }

  /* ---------- the villages ---------- */
  var scale = { unit: 1, hour: 1, view: 1 };
  function floors(t) { return Math.max(1, Math.ceil(t.pv / scale.unit)); }
  function measure() {
    var gm = 1, hm = 1, vm = 1;
    sites.forEach(function (s) {
      s.towers.forEach(function (t) { gm = Math.max(gm, t.pv); });
      s.hours.forEach(function (h) { hm = Math.max(hm, h.today, h.yesterday); });
      s.views.forEach(function (v) { vm = Math.max(vm, v.n); });
    });
    scale.unit = Math.max(1, Math.ceil(gm / 6)); scale.hour = hm; scale.view = Math.max(1, Math.ceil(vm / GARLAND));
  }
  /* Houses round the ring, gates in the gaps between them, so nobody walks through a wall; the
     stalls round the clock tower, their counters to the houses. */
  function layout(s) {
    var o = s.o, n = s.towers.length, nl = s.lanes.length, slots = Math.max(n, nl, 5);
    /* The same house object lives on across rebuilds, so a villager on its way, or fireworks
       over a roof, still point at the house that is drawn. */
    s.houses = s.towers.map(function (t, k) {
      var a = ang(k, slots), h = houseOf(s, t) || { t: t, flash: 0 };
      h.a = a; h.pos = at(o, a, R_HOUSE); h.wall = T.walls[k % T.walls.length]; h.seed = s.idx * 31 + k;
      return h;
    });
    var maxN = 1; s.lanes.forEach(function (l) { maxN = Math.max(maxN, l.count); });
    s.gates = s.lanes.map(function (l, k) {
      var a = ang(Math.floor(k * slots / nl) + .5, slots);   // always between two house slots
      return { l: l, a: a, w: 1.1 + 2.4 * l.count / maxN, col: l.color, pos: at(o, a, R_WALL), end: at(o, a, R_WALL + 9) };
    });
    var vs = Math.max(s.views.length, 6);
    s.stalls = s.views.map(function (v, k) {
      var st = stallOf(s, v) || { v: v, flash: 0 };
      st.a = ang(k + .5, vs); st.pos = at(o, st.a, R_STALL); st.front = at(o, st.a, R_STALL + 1.05); st.k = k;
      return st;
    });
  }

  function warmOf(t) { return Math.round(floors(t) * (t.loads ? clamp(t.engaged / t.loads, 0, 1) : 0)); }
  function house(M, s, h, dark) {
    var t = h.t, f = floors(t), rot = -h.a - Math.PI / 2, P = G.frame(h.pos[0], h.pos[2], rot);
    var warm = warmOf(t), lit = dark == null ? f : Math.floor(f * (1 - dark));
    var y = 0, w = 2.5, d = 2.1;
    M.box(h.pos[0], 0, h.pos[2], w + .1, .45, d + .1, T.stoneDark, 0, rot);
    for (var j = 0; j < f; j++) {
      var ww = w + Math.min(j, 1) * .14, dd = d + Math.min(j, 1) * .14;   // the storeys above the first jut out
      M.box(h.pos[0], y + (j ? 0 : .45), h.pos[2], ww, FLOOR - (j ? 0 : .45), dd, j === 0 ? T.stone : h.wall, 0, rot);
      if (j) M.box(h.pos[0], y, h.pos[2], ww + .06, .1, dd + .06, T.timber, 0, rot);
      for (var q = 0; q < 2; q++) {
        if (j === 0 && q === 0) continue;   // the door
        var on = t.pv > 0 && j < lit && j < warm, wx = -.62 + q * 1.24, wy = y + .32, fz = dd / 2 + .02;
        var fp = P(wx, 0, fz), pp = P(wx, 0, fz + .02), sill = P(wx, 0, fz + .06);
        M.box(fp[0], wy - .03, fp[2], .5, .56, .04, T.timber, 0, rot);
        M.box(pp[0], wy, pp[2], .38, .46, .03, on ? T.window : T.windowDark, on ? 1 : .35, rot);
        M.box(sill[0], wy - .06, sill[2], .56, .07, .14, T.snow, 0, rot);
        if (on) { var g = P(wx, 0, fz + .25); W.addGlow(s.glow, [g[0], wy + .23, g[2]], T.window, .16, 1.4); var pl = P(wx, 0, fz + 1.1); s.pools.push([pl[0], pl[2], 1.5 + j * .15, T.window, .5]); }
      }
      y += FLOOR;
    }
    var door = P(-.62, 0, d / 2 + .03), lamp = P(-.62, 0, d / 2 + .18);
    M.box(door[0], .45, door[2], .58, .95, .05, T.timber, 0, rot);
    if (dark == null || dark < 1) {
      M.box(lamp[0], 1.55, lamp[2], .16, .2, .16, T.lamp, 1, rot);
      W.addGlow(s.glow, [lamp[0], 1.65, lamp[2]], T.lamp, .5, 2.2);
      var dp = P(-.62, 0, d / 2 + 1.4); s.pools.push([dp[0], dp[2], 2.4, T.lamp, .55]);
    }
    var heap = P(1.1, 0, d / 2 + .5); M.lump(heap[0], 0, heap[2], .38, .3, 6, T.snow, h.seed);
    var rw = w + .14, rd = d + .14;
    M.roof(h.pos[0], y, h.pos[2], rw, 1.15, rd, T.roof, rot, .32, h.wall);
    M.roof(h.pos[0], y + .09, h.pos[2], rw - .1, 1.12, rd, T.snow, rot, .22);
    var ch = P(.7, 0, -.35); M.box(ch[0], y + .3, ch[2], .36, 1.2, .36, T.stoneDark, 0, rot); M.box(ch[0], y + 1.5, ch[2], .44, .1, .44, T.snow, 0, rot);
    h.chimney = [ch[0], y + 1.6, ch[2]]; h.top = y; h.door = P(-.62, 0, d / 2 + .9);
    s.occ.push([h.pos[0], h.pos[2], w + 1.2, d + 1.2, rot, .6]);
    var a = at(s.o, h.a, 9.4), b = at(s.o, h.a, R_HOUSE - 1.3), mid = [(a[0] + b[0]) / 2, 0, (a[2] + b[2]) / 2];
    M.flat(mid[0], .025, mid[2], 1.3, Math.hypot(b[0] - a[0], b[2] - a[2]) + .4, T.path, 0, Math.atan2(Math.cos(h.a), Math.sin(h.a)));
  }
  function lampPost(M, s, x, z, ht, on, now) {
    M.cyl(x, 0, z, .16, .25, 8, T.stoneDark);
    M.cyl(x, .25, z, .055, ht - .25, 6, T.iron);
    if (!on) { M.cone(x, .25, z, .14, .12, 8, T.snow); return; }
    M.box(x, ht, z, .26, .04, .26, T.iron);
    M.box(x, ht + .04, z, .2, .26, .2, T.lamp, now ? 1 : .85);
    M.cone(x, ht + .3, z, .2, .16, 4, T.iron); M.cone(x, ht + .33, z, .14, .1, 4, T.snow);
    s.pools.push([x, z, 1.4 + ht * .45, T.lamp, now ? .75 : .45]);
  }
  /* Lanterns lit on a stall's garland: one per `scale.view` opens today, on one scale for every
     site; one at least for a view opened at all. */
  function lit(v) { return v.n ? Math.min(GARLAND, Math.max(1, Math.ceil(v.n / scale.view))) : 0; }
  /* A cord between two points: two thin ribbons crossed, so it shows from any side (gl.js draws
     both faces of each). */
  function cord(M, a, b, col, w) {
    var dx = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot(dx, dz) || 1, nx = -dz / l * w, nz = dx / l * w;
    M.quad(a, b, [b[0], b[1] + w * 2, b[2]], [a[0], a[1] + w * 2, a[2]], col);
    M.quad([a[0] - nx, a[1], a[2] - nz], [a[0] + nx, a[1], a[2] + nz], [b[0] + nx, b[1], b[2] + nz], [b[0] - nx, b[1], b[2] - nz], col);
  }
  /* A market stall: a counter with its wares under a canvas roof, a lamp while it is open (opened
     today), and behind it a mast with the garland that sags up to the clock tower. */
  function stall(M, s, st, dark) {
    var v = st.v, k = st.k, rot = Math.PI / 2 - st.a, x = st.pos[0], z = st.pos[2], P = G.frame(x, z, rot);
    var n = dark == null ? lit(v) : Math.floor(lit(v) * (1 - dark));
    M.box(x, 0, z, 1.5, .5, .62, T.timber, 0, rot);
    M.box(x, .5, z, 1.64, .07, .76, G.mix(T.timber, T.snow, .3), 0, rot);
    [-.47, 0, .47].forEach(function (gx, i) { var g = P(gx, 0, .04); M.box(g[0], .57, g[2], .32, .14 + rand(k, i) * .14, .34, T.walls[(k + i * 3) % T.walls.length], 0, rot); });
    [[-.74, -.32], [.74, -.32], [-.74, .4], [.74, .4]].forEach(function (c) { var p = P(c[0], 0, c[1]); M.cyl(p[0], 0, p[2], .045, 1.52, 5, T.timber); });
    var c = P(0, 0, .04);
    M.roof(c[0], 1.5, c[2], 1.62, .46, .86, k % 2 ? T.awning2 : T.awning, rot, .14, k % 2 ? T.awning : T.awning2);
    M.roof(c[0], 1.6, c[2], 1.5, .4, .5, T.snow, rot, .04);
    if (v.n > 0 && dark !== 1) {
      var lp = P(0, 0, .3); M.box(lp[0], 1.2, lp[2], .15, .2, .15, T.lamp, 1, rot);
      W.addGlow(s.glow, [lp[0], 1.3, lp[2]], T.lamp, .4, 1.9); s.pools.push([st.front[0], st.front[2], 1.9, T.lamp, .5]);
    }
    s.occ.push([x, z, 2.1, 1.4, rot, .55]);
    var m = P(0, 0, -.34), A = [m[0], 2.15, m[2]], B = at(s.o, st.a, 1.15); B[1] = 4.05;
    function pt(t) { return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t - 2.2 * t * (1 - t), A[2] + (B[2] - A[2]) * t]; }
    M.cyl(m[0], 0, m[2], .05, 2.2, 5, T.timber);
    for (var i = 0; i < 10; i++) cord(M, pt(i / 10), pt((i + 1) / 10), T.iron, .022);
    for (var j = 0; j < GARLAND; j++) {
      var p = pt((j + .55) / (GARLAND + .6)), on = j < n;
      M.box(p[0], p[1] - .33, p[2], .26, .31, .26, on ? T.view : G.mix(T.windowDark, T.view, .12), on ? 1 : .3, rot);
      M.box(p[0], p[1] - .03, p[2], .12, .04, .12, T.iron, 0, rot);
      if (on) W.addGlow(s.glow, [p[0], p[1] - .17, p[2]], T.view, .5, 1.9);
    }
    if (n) { var mid = pt(n / 2 / (GARLAND + .6)); s.pools.push([mid[0], mid[2], 1.2 + n * .28, T.view, .3 + n * .05]); }
  }
  /* Its place by today's opens; a tie goes to the one first in the 30 days, so no two share a place. */
  function viewRank(s, v) { var i = s.views.indexOf(v); return s.views.filter(function (x, k) { return x.n > v.n || (x.n === v.n && k < i); }).length; }

  /* One village into its own layer, with its own pools, footprints, glows and labels: a visit
     to one site draws that one again, never the valley. A label a village had before keeps its
     element. */
  function village(s, dark) {
    if (!s.layer) s.layer = W.layer();
    var M = s.layer.mesh, o = s.o, hourNow = new Date().getUTCHours(), old = s.labels, pines = [];
    M.clear(); s.pools = []; s.occ = []; s.glow = []; s.labels = {};
    function labelAt(key, p, cls, show) {
      var L = old[key];
      if (L) { delete old[key]; L.p = p; L.show = show; } else L = W.label(p, '', cls, show);
      s.labels[key] = L; return L;
    }
    for (var rr = 0; rr < 8; rr++) M.ring(o[0], .03, o[2], rr * .95, (rr + 1) * .95, 48, rr % 2 ? T.stone : G.mix(T.stone, T.stoneDark, .35));
    M.ring(o[0], .05, o[2], 7.6, 7.9, 48, T.stoneDark); M.ring(o[0], .02, o[2], 7.9, 9.6, 48, T.path);
    // the clock tower
    M.box(o[0], 0, o[2], 2.6, .5, 2.6, T.stoneDark); M.box(o[0], .5, o[2], 2.2, 3.4, 2.2, T.stone);
    M.box(o[0], 3.9, o[2], 2.4, .16, 2.4, T.timber); M.box(o[0], 4.06, o[2], 1.9, 3.3, 1.9, G.mix(T.stone, T.snow, .2));
    [[0, 1], [0, -1], [1, 0], [-1, 0]].forEach(function (f) {
      M.box(o[0] + f[0] * .97, 5.25, o[2] + f[1] * .97, f[0] ? .05 : 1.1, 1.1, f[1] ? .05 : 1.1, T.iron);
      M.box(o[0] + f[0], 5.33, o[2] + f[1], f[0] ? .05 : .92, .92, f[1] ? .05 : .92, T.clock, .95);
      W.addGlow(s.glow, [o[0] + f[0] * 1.2, 5.8, o[2] + f[1] * 1.2], T.clock, .35, 3.4);
      s.pools.push([o[0] + f[0] * 4, o[2] + f[1] * 4, 4.5, T.clock, .35]);
    });
    M.box(o[0], 7.36, o[2], 2.3, .14, 2.3, T.timber);
    M.cone(o[0], 7.5, o[2], 1.75, 3.2, 4, T.roof); M.cone(o[0], 8.5, o[2], 1.2, 2.25, 4, T.snow);
    M.cyl(o[0], 10.7, o[2], .04, .7, 4, T.brass);
    s.occ.push([o[0], o[2], 3.4, 3.4, 0, .7]);
    // the 24 hours: today's lamp, yesterday's brass ring (and rod, where today has not reached it)
    s.nowLamp = null;
    s.hours.forEach(function (hh) {
      var a = ang(hh.hour, 24), p = at(o, a, R_POST), ht = .55 + 4.6 * hh.today / scale.hour, hy = .55 + 4.6 * hh.yesterday / scale.hour;
      var future = hh.hour > hourNow, now = hh.hour === hourNow;
      lampPost(M, s, p[0], p[2], future ? .7 : ht, !future && dark !== 1, now);
      var from = future ? .7 : ht + .5;
      if (hy > from) M.cyl(p[0], from, p[2], .022, hy - from, 5, T.brass, .2);
      M.cyl(p[0], hy, p[2], .17, .06, 10, T.brass, .3);
      if (!future && dark !== 1) W.addGlow(s.glow, [p[0], ht + .17, p[2]], T.lamp, now ? 0 : .45, 2.2);
      if (now) s.nowLamp = [p[0], ht + .17, p[2]];
      if (hh.hour % 6 === 0) write(labelAt('t' + hh.hour, [o[0] + Math.cos(a) * (R_POST + 1.05), .1, o[2] + Math.sin(a) * (R_POST + 1.05)], 'v-tick', inside(s)), '<span>' + String(hh.hour).padStart(2, '0') + ':00</span>');
    });
    s.houses.forEach(function (h) {
      house(M, s, h, dark);
      h.label = labelAt('h' + (h.t.other ? '' : h.t.path), [h.pos[0], h.top + 2.2, h.pos[2]], 'v-house', function (d) { return view.site === s && (!narrow() || rankOf(s, h) < 4); });
      h.label.what = { kind: 'tower', tower: h.t, s: s };
    });
    // the market: a stall per view
    s.stalls.forEach(function (st) {
      stall(M, s, st, dark);
      st.label = labelAt(st.v.other ? 'vo' : 'v:' + st.v.name, [st.pos[0], 2.5, st.pos[2]], 'v-view', function () { return view.site === s && (!narrow() || viewRank(s, st.v) < 3); });
      st.label.what = { kind: 'view', view: st.v, s: s };
    });
    s.houses.forEach(function (h, k) {
      var a = h.a + Math.PI / Math.max(s.houses.length, 5), p = at(o, a, R_HOUSE + .6);
      if (!s.gates.some(function (g) { return angDiff(a, g.a) < .25; })) pine(M, p[0], 0, p[2], .55 + rand(k, 9) * .25, pines);
    });
    // the palisade, a gate per referrer
    M.ring(o[0], .04, o[2], R_WALL - .9, R_WALL + .9, 96, T.snow2);
    for (var k = 0; k < 170; k++) {
      var a2 = k / 170 * TAU, p2 = at(o, a2, R_WALL + (rand(k, 4) - .5) * .12);
      if (s.gates.some(function (g) { return angDiff(a2, g.a) * R_WALL < g.w / 2 + .45; })) continue;
      var ph = 1.7 + rand(k, 2) * .4;
      M.cyl(p2[0], 0, p2[2], .19, ph, 6, T.timber); M.cone(p2[0], ph, p2[2], .19, .35, 6, T.timber);
    }
    s.gates.forEach(function (g) {
      var tan = [-Math.sin(g.a), 0, Math.cos(g.a)]; g.lights = [];
      [-1, 1].forEach(function (sd) {
        var p = [g.pos[0] + tan[0] * sd * (g.w / 2 + .4), 0, g.pos[2] + tan[2] * sd * (g.w / 2 + .4)];
        M.box(p[0], 0, p[2], .65, 3, .65, T.timber, 0, -g.a);
        M.cone(p[0], 3, p[2], .62, .8, 4, T.roof); M.cone(p[0], 3.25, p[2], .42, .55, 4, T.snow);
        var lp = [p[0] + Math.cos(g.a) * .4, 2.3, p[2] + Math.sin(g.a) * .4];
        M.box(lp[0], lp[1], lp[2], .22, .28, .22, g.col, 1);
        W.addGlow(s.glow, [lp[0], lp[1] + .14, lp[2]], g.col, .8, 2.6); g.lights.push([lp[0], lp[1] + .14, lp[2]]);
        s.pools.push([lp[0] + Math.cos(g.a), lp[2] + Math.sin(g.a), 2.6, g.col, .5]);
      });
      M.box(g.pos[0], 2.7, g.pos[2], .3, .25, g.w + 1.4, T.timber, 0, -g.a);
      M.box(g.pos[0] + Math.cos(g.a) * .17, 2.05, g.pos[2] + Math.sin(g.a) * .17, .04, .62, Math.min(1.4, g.w * .6), g.col, .2, -g.a);
      var mid = [(g.pos[0] + g.end[0]) / 2, 0, (g.pos[2] + g.end[2]) / 2], rot = Math.atan2(Math.cos(g.a), Math.sin(g.a));
      M.flat(mid[0], .03, mid[2], g.w, 9.5, T.path, 0, rot);
      var ia = at(o, g.a, 9.4), ib = at(o, g.a, R_WALL), im = [(ia[0] + ib[0]) / 2, 0, (ia[2] + ib[2]) / 2];
      M.flat(im[0], .028, im[2], Math.max(1, g.w * .7), R_WALL - 9.4, T.path, 0, rot);
      g.label = labelAt('g' + g.l.key, [g.end[0], 1.4, g.end[2]], 'v-gate', function () { return view.site === s && !narrow(); });
      g.label.what = { kind: 'lane', lane: g.l, s: s };
      g.label.el.style.setProperty('--lane', css(g.col));   // CSSOM: the CSP refuses style attributes
    });
    pines.forEach(function (c) { s.occ.push([c[0], c[1], c[2], c[2], 0, .35]); });
    Object.keys(old).forEach(function (k) { W.unlabel(old[k]); });
    W.upload(s.layer);
  }
  function rankOf(s, h) { return s.houses.filter(function (x) { return x.t.pv > h.t.pv; }).length; }
  function inside(s) { return function () { return view.site === s; }; }

  /* A site's counts changed: its village is due. `now` for what cannot wait (a first load, a new
     house); a live visit waits its turn, at most REBUILD_MS after the last drawing. */
  var soon = null;
  function rebuild(s, now) {
    s.pending = true; if (!now) return;
    s.sig = null; if (!soon) soon = setTimeout(function () { soon = null; refresh(); }, 0);
  }
  /* Everything a village's geometry is made from, rounded as far as the eye tells apart: while
     this stays the same, the village on screen is still right. */
  function signature(s) {
    var a = [state.dark, state.hour, scale.unit, s.o.join(), s.loaded], maxN = 1;
    s.towers.forEach(function (t) { a.push(t.path, floors(t), warmOf(t), t.pv > 0); });
    s.lanes.forEach(function (l) { maxN = Math.max(maxN, l.count); });
    s.lanes.forEach(function (l) { a.push(l.key, Math.round(24 * l.count / maxN)); });
    s.hours.forEach(function (h) { a.push(Math.round(92 * h.today / scale.hour), Math.round(92 * h.yesterday / scale.hour)); });
    s.views.forEach(function (v) { a.push(v.label, lit(v)); });
    return a.join('|');
  }
  /* Draws again the villages that are due and no longer match their counts (all that changed,
     when `force`), then what they share: the pools of light, the footprints, the glows. */
  function refresh(force) {
    if (!W) return;
    var now = performance.now(), hour = new Date().getUTCHours(), changed = false;
    if (!force && hour === state.hour && !sites.some(function (s) { return s.pending && (s.sig == null || now - s.builtAt > REBUILD_MS); })) return;
    state.hour = hour; measure();
    sites.forEach(function (s) {
      var sg = signature(s); s.pending = false;
      if (sg === s.sig) return;
      s.sig = sg; s.builtAt = now; changed = true;
      if (s.loaded) layout(s); else { s.houses = []; s.gates = []; s.stalls = []; }
      village(s, state.dark);
    });
    if (changed) share();
    paintLabels(); paintHl();
  }
  function share() {
    var pools = [], occ = landOcc.map(function (c) { return [c[0], c[1], c[2], c[2], 0, .35]; }), glow = [], lights = [];
    sites.forEach(function (s) {
      pools = pools.concat(s.pools); occ = occ.concat(s.occ); glow = glow.concat(s.glow);
      /* The lamp of the hour, at the low of its breath: frame() adds the rest as it pulses. */
      if (s.nowLamp && state.dark == null) lights.push({ p: s.nowLamp, r: 6, c: G.scale(T.lamp, NOW_LOW) });
    });
    W.paintPools(pools); W.paintOcclusion(occ); W.setGlow(glow); W.lights = lights; W.invalidate();
  }

  /* ---------- what is written over it ---------- */
  function change(s) { if (!s.yesterday) return null; return Math.round((s.visitors / s.yesterday - 1) * 100); }
  function arrow(d) { return d == null ? '' : d > 0 ? '▲ ' + d + '%' : d < 0 ? '▼ ' + Math.abs(d) + '%' : '± 0%'; }
  /* A label's text, written only when it changes. */
  function write(L, html, into) { if (L.html === html) return false; L.html = html; (into || L.el).innerHTML = html; return true; }
  /* The small row of a village's sign: its views, its other events and the used share, each only
     when there is any; a village with none of them says its pageviews. */
  function signRow(s) {
    var parts = [], ev = otherEvents(s);
    if (s.viewsToday) parts.push(plural(s.viewsToday, 'view', 'views'));
    if (ev) parts.push(plural(ev, 'event', 'events'));
    if (s.loads) parts.push(pct(s.engaged, s.loads) + '% used');
    return parts.length ? parts.join(' · ') : plural(s.pageviews, 'pageview', 'pageviews');
  }
  function paintLabels() {
    sites.forEach(function (s) {
      if (s.sign) {
        var d = change(s), up = d == null || d >= 0, b = s.sign.el.firstChild;
        if (write(s.sign, '<span class="name">' + esc(s.name) + '</span>' +
          '<span class="row"><b class="num">' + fmt(s.visitors) + '</b> visitors' + (d == null ? '' : ' <span class="small ' + (up ? 'up' : 'down') + '">' + arrow(d) + '</span>') + '</span>' +
          '<span class="row small">' + signRow(s) + '</span>' +
          (s.loaded && !s.towers.length ? '<span class="row small">no visits yet</span>' : ''), b))
          b.setAttribute('aria-label', s.name + ': ' + plural(s.visitors, 'visitor', 'visitors') + ' today. Look closer');
      }
      s.houses.forEach(function (h) {
        if (!h.label) return; var t = h.t;
        write(h.label, '<div><span class="p">' + esc(t.label) + '</span> <b class="num">' + fmt(t.pv) + '</b>' + (t.loads ? '<span class="s">' + pct(t.engaged, t.loads) + '% used</span>' : '') + '</div>');
      });
      s.gates.forEach(function (g) {
        if (g.label) write(g.label, '<div><span class="p">' + esc(g.l.label) + '</span> <b class="num">' + fmt(g.l.count) + '</b></div>');
      });
      s.stalls.forEach(function (st) {
        if (st.label) write(st.label, '<div><span class="p">' + esc(st.v.label) + '</span> <b class="num">' + fmt(st.v.n) + '</b></div>');
      });
    });
  }
  function showTip(h, x, y) {
    if (!tip) return;
    if (!h) { tip.hidden = true; return; }
    var html = '';
    if (h.kind === 'site') html = '<strong>' + esc(h.s.name) + '</strong>' + plural(h.s.visitors, 'visitor', 'visitors') + ' · ' + plural(h.s.pageviews, 'pageview', 'pageviews') + ' today' + (h.s.loads ? ' · ' + pct(h.s.engaged, h.s.loads) + '% used' : '') + '<small>Click to look closer</small>';
    if (h.kind === 'tower') { var t = h.tower; html = '<strong>' + esc(t.label) + '</strong>' + plural(t.pv, 'pageview', 'pageviews') + ' today · ' + (t.loads ? pct(t.engaged, t.loads) + '% used · ' : '') + plural(t.events, 'event', 'events') +
      (t.other ? '<small>Pages outside the 30-day top 8</small>' : '<small>' + plural(t.total, 'pageview', 'pageviews') + ' in the last 30 days · warm windows: used</small>'); }
    if (h.kind === 'lane') { var l = h.lane; html = '<strong>' + esc(l.label) + '</strong>' + plural(l.count, 'arrival', 'arrivals') + ' today' +
      (l.key === 'elsewhere' ? '<small>Referrers outside the 30-day top 5</small>' : l.key === 'direct' ? '<small>No referrer, or a link from the site itself</small>' : ''); }
    if (h.kind === 'view') {
      var v = h.view, from = Object.keys(v.by).sort(function (a, b) { return v.by[b] - v.by[a]; }).slice(0, 3);
      html = '<strong>' + esc(v.label) + '</strong>opened ' + plural(v.n, 'time', 'times') + ' today' + (from.length ? ' · from ' + from.map(function (k) { return esc(k) + ' ' + fmt(v.by[k]); }).join(', ') : '') +
        (v.other ? '<small>Views outside the 30-day top 8</small>' : '<small>A view opened inside a page · ' + plural(v.total, 'time', 'times') + ' in the last 30 days</small>');
    }
    tip.innerHTML = html; tip.hidden = false;
    var r = tip.getBoundingClientRect();
    tip.style.left = Math.max(8, Math.min(x + 16, window.innerWidth - r.width - 8)) + 'px';
    tip.style.top = Math.max(8, y - r.height - 12) + 'px';
  }
  function makeSign(s) {
    var L = W.label([s.o[0], 14, s.o[2]], '<button type="button" class="vsign"></button>', 'v-sign', function () { return view.mode === 'bay' || view.site !== s; });
    s.sign = L;
    L.el.firstChild.style.setProperty('--site', css(s.tint));
    L.el.firstChild.addEventListener('click', function () { if (opts.onEnter) opts.onEnter(s.id); });
  }

  /* ---------- the camera ---------- */
  var box = null;
  function frameBox() {
    if (!box) {
      var ins = opts.insets ? opts.insets() : { top: 16, bottom: 16, right: 0 }, w = window.innerWidth, h = window.innerHeight;
      box = { left: 16, right: w - (ins.right || 0) - 16, top: ins.top, bottom: h - ins.bottom, w: w, h: h };
    }
    return box;
  }
  /* The window or a panel changed size: measure the gap again, and draw. */
  function resized() { box = null; if (W) W.wake(); }
  function shift() {
    var B = frameBox(), cx = (B.left + B.right) / 2, cy = (B.top + B.bottom) / 2;
    return [cx / B.w * 2 - 1, 1 - cy / B.h * 2];
  }
  /* The distance at which a half-width X and a half-height Y fit the gap the panels leave. */
  function fit(X, Y) {
    var B = frameBox(), t = Math.tan(W.cam.fov / 2);
    return Math.max(X * B.h / (t * Math.max(120, B.right - B.left)), Y * B.h / (t * Math.max(120, B.bottom - B.top)));
  }
  function goal() {
    if (view.mode === 'site' && view.site) {
      var o = view.site.o, pitch = .55;
      return { target: [o[0], 2, o[2]], yaw: .12, pitch: pitch, dist: clamp(fit(R_WALL + 3, (R_WALL + 3) * Math.sin(pitch) + 6) * 1.02, 24, 120) };
    }
    var xs = sites.map(function (s) { return s.o[0]; }), x0 = Math.min.apply(null, xs.concat([0])), x1 = Math.max.apply(null, xs.concat([0]));
    var zs = sites.map(function (s) { return s.o[2]; }), cz = sites.length ? (Math.min.apply(null, zs) + Math.max.apply(null, zs)) / 2 : 0;
    return { target: [(x0 + x1) / 2, 2, cz], yaw: .08, pitch: .4, dist: clamp(fit((x1 - x0) / 2 + R_WALL + 1, (R_WALL + 4) * Math.sin(.4) + 9) * .95, 40, 200) };
  }
  function frameView(instant) { if (W) { view.free = false; W.flyTo(goal(), instant || reduced ? 0 : 1600); } }

  /* ---------- the frame ---------- */
  /* What moves over the kept scene, given to the world again every frame it draws. Answers
     whether anything is still moving: while nothing is, the world draws no frames at all. */
  function frame(t, dt) {
    var now = performance.now(), M = W.dyn, busy = !reduced;   // the snow never rests
    if (state.blackout) {
      var k = (now - state.blackout.t0) / state.blackout.dur, dark = clamp(Math.floor(k * 1.2 * 8) / 8, 0, 1);
      busy = true;
      if (dark !== state.dark) { state.dark = dark; refresh(true); }
      if (k >= 1) { var done = state.blackout.done; state.blackout = null; state.dark = null; refresh(true); if (done) done(); }
    }
    sites.forEach(function (s) {
      if (s.nowLamp && state.dark == null) {
        var pu = reduced ? 1 : .75 + .25 * Math.sin(t * 2.4), n = s.nowLamp;
        W.addGlow(W.glow, n, T.lamp, pu * 1.2, 4.2); W.spot([n[0], .07, n[2]], n[1] - .07, 6, G.scale(T.lamp, pu - NOW_LOW));
      }
      s.houses.forEach(function (h) {
        if (!reduced && h.chimney && h.t.pv > 0 && Math.random() < dt * 1.4) smoke.push({ p: h.chimney.slice(), t: 0, s: Math.random() });
        if (h.flash > 0) { busy = true; h.flash = Math.max(0, h.flash - dt * 1.1); W.addGlow(W.glow, [h.door[0], .8, h.door[2]], T.window, h.flash, 5); }
      });
      s.stalls.forEach(function (st) {
        if (st.flash > 0) { busy = true; st.flash = Math.max(0, st.flash - dt * .8); W.addGlow(W.glow, [st.pos[0], 1.7, st.pos[2]], T.view, st.flash, 6.5); }
      });
      if (s.walkers.length || s.sparks.length) busy = true;
      s.walkers = s.walkers.filter(function (w) {
        w.d += dt * w.speed; var a = G.along(w.path, w.d);
        if (a.done) { (w.stall || w.h).flash = 1; return false; }
        villager(M, a.p, a.dir, w.col, Math.abs(Math.sin(w.d * 5)) * .05, w.seed);
        return true;
      });
      s.sparks = s.sparks.filter(function (sp) {
        sp.t += dt; var h = sp.h, c = [h.pos[0], h.top + 3, h.pos[2]];
        if (reduced) { W.addGlow(W.glow, c, sp.col, Math.max(0, 1 - sp.t / 1.9), 6); return sp.t < 1.9; }
        for (var k = 0; k < 22; k++) {
          var a = k / 22 * TAU, el = Math.sin(k * 2.3) * .8, r = .5 + sp.t * 2.4, y = c[1] + Math.sin(el) * r - sp.t * sp.t * .9;
          W.addGlow(W.glow, [c[0] + Math.cos(a) * Math.cos(el) * r, y, c[2] + Math.sin(a) * Math.cos(el) * r], k % 3 ? sp.col : T.window, Math.max(0, 1 - sp.t / 1.9) * Math.min(1, sp.t * 4) / 2, 1.3);   // fades in as it opens, or 22 sparks in one point burn white
        }
        return sp.t < 1.9;
      });
    });
    smoke = smoke.filter(function (sm) {
      sm.t += dt; var k = sm.t / 5;
      W.puffs.push(sm.p[0] + sm.t * .35 + Math.sin(sm.t + sm.s * 6) * .15, sm.p[1] + sm.t * .55, sm.p[2] - sm.t * .1, T.smoke[0], T.smoke[1], T.smoke[2], .28 * (1 - k) * Math.min(1, sm.t * 3), .5 + sm.t * .5);
      return k < 1;
    });
    var ringed = highlight(M, t);
    return busy || ringed || smoke.length > 0;
  }
  function villager(M, p, dir, col, bob, seed) {
    var P = G.frame(p[0], p[2], dir);
    M.cone(p[0], bob, p[2], .22, .62, 7, G.mix(T.coat, col, .25), 0, true);
    M.cyl(p[0], .5 + bob, p[2], .13, .08, 7, col, .35);
    M.cyl(p[0], .56 + bob, p[2], .11, .18, 7, T.skin, 0, .1, true);
    M.cone(p[0], .72 + bob, p[2], .13, .2, 7, seed > .5 ? col : T.coat, 0, true);
    var lh = P(.2, 0, .12);
    M.cyl(lh[0], .28 + bob, lh[2], .01, .12, 3, T.iron);
    M.box(lh[0], .2 + bob, lh[2], .09, .11, .09, T.lamp, 1);
    W.addGlow(W.glow, [lh[0], .26 + bob, lh[2]], T.lamp, .9, 1.5);
    W.spot([lh[0], Math.max(.07, hf(lh[0], lh[2]) + .06), lh[2]], .5, 2.6, G.scale(T.lamp, .9));
  }
  /* What a visit row points at, its house and its gate, or the stall of a view: their labels are
     marked when the row changes (paintHl), and a ring and a glow are drawn round them. Answers
     whether it pulses. */
  function paintHl() {
    var hl = view.hl;
    sites.forEach(function (s) {
      s.houses.forEach(function (h) { var on = !!(hl && hl.site === s.id && 'path' in hl && towerOf(s, hl.path) === h.t); if (h.label) h.label.el.classList.toggle('hl', on); });
      s.gates.forEach(function (g) { var on = !!(hl && hl.site === s.id && 'ref' in hl && laneFor(s, hl.ref) === g.l); if (g.label) g.label.el.classList.toggle('hl', on); });
      s.stalls.forEach(function (st) { var on = !!(hl && hl.site === s.id && 'view' in hl && viewOf(s, hl.view) === st.v); if (st.label) st.label.el.classList.toggle('hl', on); });
      if (s.sign) s.sign.el.classList.toggle('hl', !!(hl && hl.site === s.id));
    });
  }
  function highlight(M, t) {
    var hl = view.hl, pulse = reduced ? 1 : .8 + .2 * Math.sin(t * 4);
    if (!hl) return false;
    var s = byId[hl.site]; if (!s || !s.loaded) return false;
    var t0 = 'path' in hl ? towerOf(s, hl.path) : null, h = t0 && houseOf(s, t0);
    if (h) { M.ring(h.pos[0], .06, h.pos[2], 2.1, 2.35, 32, T.window, pulse); W.addGlow(W.glow, [h.pos[0], h.top + 1.6, h.pos[2]], T.window, .5 * pulse, 6); }
    var g = 'ref' in hl ? gateOf(s, laneFor(s, hl.ref)) : null;
    if (g && g.lights) g.lights.forEach(function (p) { W.addGlow(W.glow, p, g.col, pulse, 6); });
    var st = 'view' in hl ? stallOf(s, viewOf(s, hl.view)) : null;
    if (st) { M.ring(st.pos[0], .06, st.pos[2], 1.3, 1.5, 28, T.view, pulse); W.addGlow(W.glow, [st.pos[0], 1.7, st.pos[2]], T.view, .5 * pulse, 5); }
    return !reduced;
  }

  /* ---------- pointer ---------- */
  function siteAt(x, y) {
    var best = null, bd = Infinity;
    sites.forEach(function (s) {
      var c = W.project([s.o[0], 1, s.o[2]]), e = W.project([s.o[0] + R_WALL, 0, s.o[2]]); if (!c || !e) return;
      var r = Math.max(40, Math.hypot(e.x - c.x, e.y - c.y)), d = Math.hypot(c.x - x, c.y - y);
      if (d < r && d < bd) { bd = d; best = s; }
    });
    return best;
  }
  function labelNear(x, y) {
    var best = null, bd = 44;
    W.labels.forEach(function (L) { if (!L.what || L.el.hidden) return; var d = Math.hypot(L.sx - x, L.sy - y - 12); if (d < bd) { bd = d; best = L; } });
    return best;
  }

  /* ---------- no WebGL2 ---------- */
  function fallback(canvas) {
    failed = true; canvas.hidden = true;
    var p = document.createElement('p'); p.className = 'scene-fallback glass';
    p.textContent = 'This browser can’t draw the village (WebGL 2 is off or missing). The Ledger has every number.';
    canvas.parentNode.insertBefore(p, canvas.nextSibling);
  }

  window.FootwornCity = {
    /* canvas, { tip, insets() -> {top, bottom, right}, onEnter(id), onLeave() } */
    init: function (canvas, o) {
      cv = canvas; opts = o || {}; tip = opts.tip || null;
      readTokens();
      overlay = document.createElement('div'); overlay.className = 'scene-labels';
      canvas.parentNode.insertBefore(overlay, canvas.nextSibling);
      try {
        W = G.world(canvas, overlay, {
          moonDir: [-.45, .62, .55], moon: T.moonlight, skyAmb: T.skyLight, gndAmb: T.groundLight, rim: T.rim,
          fog: T.skyLow, fogD: .0062, fogH: 25, skyTop: T.skyTop, skyMid: T.skyMid, skyLow: T.skyLow, moonSky: [-.5, .35, -.8], moonTint: T.moon,
          edge: .55, edgeCol: T.edge, sat: .92, vig: .55, stars: 1, poolK: 1.9, minDist: 6, maxDist: 220, box: [-60, -60, 120], ground: T.snow, star: T.star,
        });
      } catch (e) { W = null; fallback(canvas); return; }
      W.shift = shift;
      land = W.layer();
      if (!reduced) {
        var flakes = new Float32Array(900 * 4);
        for (var f = 0; f < 900; f++) flakes.set([rand(f, 1) * 70 - 35, rand(f, 2) * 26, rand(f, 3) * 70 - 35, .4 + rand(f, 4) * .6], f * 4);
        W.setSnow(flakes, { area: 70, height: 26, size: .14, col: T.flake });
      }
      W.onFrame = frame;
      W.onDrag = function () { view.free = true; if (tip) tip.hidden = true; };
      W.onRestore = function () { location.reload(); };   // the view lives in the URL, the token in storage
      W.onPick = function (x, y) {
        var L = labelNear(x, y), r = cv.getBoundingClientRect();
        if (L) { showTip(L.what, x + r.left, y + r.top); return; }
        var s = siteAt(x, y);
        if (s && (view.mode === 'bay' || view.site !== s) && opts.onEnter) { if (tip) tip.hidden = true; opts.onEnter(s.id); return; }
        showTip(s && view.mode === 'bay' ? { kind: 'site', s: s } : null, x + r.left, y + r.top);
      };
      W.onHover = function (x, y) {
        var L = labelNear(x, y), r = cv.getBoundingClientRect(), s = !L && siteAt(x, y);
        cv.style.cursor = s && (view.mode === 'bay' || view.site !== s) ? 'pointer' : '';
        showTip(L ? L.what : s && view.mode === 'bay' ? { kind: 'site', s: s } : null, x + r.left, y + r.top);
      };
      cv.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse' && tip) tip.hidden = true; });
      overlay.addEventListener('pointerover', function (e) {
        var el = e.target.closest('.lbl'); if (!el) return;
        var L = W.labels.filter(function (x) { return x.el === el; })[0];
        if (L && L.what) showTip(L.what, e.clientX, e.clientY);
      });
      overlay.addEventListener('pointerout', function (e) { if (tip && e.target.closest('.lbl.v-house, .lbl.v-gate, .lbl.v-view')) tip.hidden = true; });
      window.addEventListener('resize', function () { resized(); if (!view.free) frameView(true); });
      /* The counts are looked at twice a second, not in the frame: the villages that are due, the
         turn of the hour, the numbers on the labels. */
      setInterval(function () { if (!document.hidden) { refresh(); paintLabels(); } }, 500);
      frameView(true);
    },
    /* [{id, name}], in the order the API lists them: one village each, in that order. */
    setSites: function (list) {
      var was = view.site && view.site.id, old = byId;
      sites = list.map(function (s, i) { var k = old[s.id]; if (k) { k.idx = i; k.name = s.name; k.tint = T.sites[i % T.sites.length]; return k; } return makeSite(s, i); });
      byId = {}; sites.forEach(function (s) { byId[s.id] = s; });
      if (was && !byId[was]) { view.site = null; view.mode = 'bay'; }
      if (!W) return;
      Object.keys(old).forEach(function (id) {
        var s = old[id]; if (byId[id]) return;
        Object.keys(s.labels).forEach(function (k) { W.unlabel(s.labels[k]); });
        if (s.sign) W.unlabel(s.sign); if (s.layer) W.dropLayer(s.layer);
      });
      place(); buildLand();
      sites.forEach(function (s) {
        if (!s.sign) makeSign(s);
        s.sign.p = [s.o[0], 14, s.o[2]]; s.sign.el.firstChild.style.setProperty('--site', css(s.tint)); s.sig = null;
      });
      refresh(true); share(); resized(); frameView(true);
    },
    load: function (id, data) { var s = byId[id]; if (s) load(s, data); },
    live: live,
    enter: function (id, instant) {
      var s = byId[id]; if (!s) return;
      view.mode = 'site'; view.site = s; if (tip) tip.hidden = true;
      resized(); if (W) W.relabel(); frameView(instant);
    },
    leave: function (instant) {
      view.mode = 'bay'; view.site = null; if (tip) tip.hidden = true;
      resized(); if (W) W.relabel(); frameView(instant);
    },
    /* The panels moved: the view re-centres in the gap they leave, unless it was dragged away. */
    refit: function (instant) { resized(); if (!view.free) frameView(instant); },
    /* A panel changed size on its own: the scene keeps its centre in the gap. */
    resized: resized,
    wantsRelayout: function () { return false; },
    /* The day's cut: the windows go dark from the top down, then `done` (app.js reloads the counts). */
    dayCut: function (done) {
      if (failed || !W) { if (done) done(); return; }
      if (!state.blackout) state.blackout = { t0: performance.now(), dur: reduced ? 1 : BLACKOUT_MS, done: done };
      W.wake();
    },
    /* Rings one visit's house and gate ({ site, path, ref }), a view's house and stall
       ({ site, path, view }), or nothing (null). */
    highlight: function (h) { view.hl = h || null; paintHl(); if (W) W.wake(); },
    /* The colour the visits panel shares with the scene: a referrer's gate in a site (its 30-day
       top 5, else elsewhere; direct for none). As CSS rgb(). */
    laneColor: function (id, ref) { var s = byId[id]; var l = s && s.loaded ? laneFor(s, ref) : null; return css(l ? l.color : ref == null ? T.direct : T.elsewhere); },
    /* One page's counts today, from its house: { pv, loads, engaged, other }; `other` when the page
       is outside the 30-day top 8 and the counts are those of every such page together. */
    pageStats: function (id, path) { var s = byId[id]; if (!s || !s.loaded) return null; var t = towerOf(s, path); return { pv: t.pv, loads: t.loads, engaged: t.engaged, other: !!t.other }; },
    stats: function (id) {
      var list = id ? [byId[id]].filter(Boolean) : sites;
      return list.reduce(function (t, s) { t.visitors += s.visitors; t.pageviews += s.pageviews; t.views += s.viewsToday; t.events += s.events; t.other += otherEvents(s); return t; },
        { visitors: 0, pageviews: 0, views: 0, events: 0, other: 0 });
    },
  };
})();
