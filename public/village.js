/* The village: every site is a snowed-in village round a clock square, in a valley with a frozen
   lake under the mountains, on a polar winter day that follows the viewer's clock (a low golden
   sun, the blue hour, the night and its aurora: `LIGHTS` and `DAY`), all on
   one scale, so the tallest houses belong to the busiest pages anywhere. In each village:
   - every page is a timber-framed house in the ring round the square (in the 7-day order,
     busiest first, so they never trade places during the day; a page first seen today builds at
     the end); its storeys are today's pageviews, its warm windows (on every side), from the
     ground up, the share of loads that were used, the brass band on its front yesterday's
     storeys up to this time; the way to its door is as wide and worn as its visits today, with
     their footprints; a page nobody opened today is shuttered, its lamp out;
   - every referrer is a gate in the wall (in the 7-day order, then direct), as wide
     as today's arrivals, with lanterns in its colour and the footprints of who came through it;
   - every hour of the day (UTC) is a street lamp round the square, clockwise from midnight at the
     top: its height is that hour's pageviews, the brass ring yesterday's, the bright one now;
   - every view opened inside a page (a `screen` event with a `view`) is a stall in the market
     round the clock tower (in the 7-day order, in rows: ten round the tower, the next behind
     them): the lanterns lit on the pole beside it, from the ground up, are today's opens, and a
     stall nobody opened today is boarded up;
   - every other event of the 7 days (one of the site's own that is no view) is a workshop
     behind the houses (by name; its kind, a woodshed, a well, a forge, a windmill, an oven or a
     granary, by its name too, so it never changes): its lantern lit and a crate in front for
     today's, dark when nobody did it today;
   - the clock tells the time on a dial of 24 hours, like the ring of lamps (UTC, midnight at the
     top; a past day stops at its end), and flies a pennant in the village's colour;
   Nothing is grouped, and a village is as big as its site's visits: its wall opens a step for
   every three times as many pageviews and views in the 7 days (`STEPS`), and a village with
   more of them than another is always the wider. Its market has as many rows as its views
   need; its houses stand on one ring while they fit, then on rings behind it, the workshops
   behind them; what is left before the wall is snow and stands of pine.
   - every live visit is a villager with a lantern and a scarf in its gate's colour, in through
     the gate, across the square, home, leaving steps in the snow that fade in a minute;
     every view opened live one who leaves that page's house for the stall, in a scarf of the
     lanterns' colour; every other event one who leaves that page's house for its workshop,
     works there a moment and leaves a crate. Each of those moments is also
     given to `onCue`, for the ear (sound.js).
   Click a village (or its sign) and the camera flies in. At UTC midnight the windows go dark and
   the day starts again. Turned back to a past day (`setDay`, from the history strip) a village
   is that day as it ended: every lamp lit, nobody walking in. A classic script over gl.js (WebGL2), no dependencies; every colour comes
   from tokens.css. app.js feeds it (/api/scene, the live socket) through the same interface the
   bay had.
   What stands still (the land, each village in a layer of its own) is given to gl.js once and
   kept there; a visit draws its own village again, two seconds apart at most, and only if it
   changed what is seen. Each frame gives only what moves: villagers and their steps, the
   work at a workshop, smoke, the ring round a highlighted house.
   Every builder takes the village's kit (`KIT`), the style its owner set for the site (the
   dashboard's Sites panel, or `site:add --style`): its shapes, its wall and the colours it
   reads, the same counts in each; the owner may also turn the kit's palette (`hue`, `shade`:
   `paletteOf`) and pick the site's colour (`tint`). A site with an icon flies it on a banner over
   its tower and shows it on its sign. A site being added stands as a draft village (`draft`) until
   it is saved: a sign that says so, nobody walking in. */
(function () {
  'use strict';

  var G = window.FootwornGL, TAU = Math.PI * 2;
  var BLACKOUT_MS = 4200;
  var REBUILD_MS = 2000;   // a village that keeps changing is drawn again this often at most
  var NOW_LOW = .5;        // the lamp of the hour breathes between this and 1
  var FLOOR = .95, GAP = 5;   // a storey; the snow between two walls
  var R_STALL = 4.3, ROW = 2.7, PITCH = { stall: 2.7, house: 5.5, gate: 5.5, shop: 6.5 };   // the first row of stalls, the next ones, how close things stand
  var GARLAND = 6;            // the lanterns of a stall's pole
  var RING = 6.5, LANE = 3.4; // between two rings of houses; how far a house stands from a gate's lane, past one ring
  /* The wall a village's visits ask for (the 7 days' pageviews and views opened): a step every
     three times as many, so a site of a handful of visits a week already grows. */
  var STEPS = [[3, 16], [10, 19], [30, 22], [100, 25], [300, 28], [1000, 31], [3000, 34], [10000, 37], [Infinity, 40]];
  /* A workshop per event: its kind by its name, so it never turns into another when the ranking
     moves. How long a villager works there, and the crates of a day at most. */
  var SHOPS = ['woodshed', 'well', 'forge', 'mill', 'oven', 'granary'];
  var WORK_S = 2.5, CRATES = 12;
  var ORDER = 3;              // how much wider a village is than every one with fewer visits
  var STEPS_S = 60;           // seconds a live villager's steps stay in the snow
  /* The kits a village can be built in. A kit changes shapes and colours, never what a count
     looks like. Its colours are tokens with its name after them (`--village-roof-stone`); one it
     does not name is alpine's. `hip`: the share of hip roofs; `frame`: timber framing; `roofH`:
     the height of a roof; `roofSnow`: snow on the roofs; `narrow`: narrow houses; `spire`: the top
     of the tower; `wall`: the wall round it; `gloom`: the village's own shade, as dark as that;
     `motes`: so many motes of light drifting over it. A kit added here goes into STYLES too
     (src/icon.js), the list `site:add --style` accepts. */
  var KIT = {
    alpine: { hip: .35, frame: true, roofH: 1.6, spire: 'pyramid', wall: 'palisade' },
    stone: { hip: 0, frame: false, roofH: 2.5, spire: 'needle', wall: 'rampart' },
    citadel: { hip: .85, frame: false, roofH: 1.25, roofSnow: false, spire: 'belfry', wall: 'battlement' },
    umbra: { hip: 0, frame: false, roofH: 3.1, roofSnow: false, narrow: true, spire: 'iron', wall: 'iron', gloom: .9, motes: 14 },
  };
  var KIT_COLORS = ['roof', 'timber', 'stone', 'stone-dark', 'lamp', 'window', 'clock', 'mote'];
  /* The pieces a site can set apart from its kit (PIECES in src/icon.js), each by name: the fields
     of KIT it lays over the kit's own. The kit's colours stay the kit's. */
  var PIECES = {
    spire: { pyramid: { spire: 'pyramid' }, needle: { spire: 'needle' }, belfry: { spire: 'belfry' }, iron: { spire: 'iron' } },
    wall: { palisade: { wall: 'palisade' }, rampart: { wall: 'rampart' }, battlement: { wall: 'battlement' }, iron: { wall: 'iron' } },
    roofs: { gentle: { hip: .35, roofH: 1.6, roofSnow: true, narrow: false }, steep: { hip: 0, roofH: 2.5, roofSnow: true, narrow: false },
      low: { hip: .85, roofH: 1.25, roofSnow: false, narrow: false }, tall: { hip: 0, roofH: 3.1, roofSnow: false, narrow: true } },
    shade: { none: { gloom: 0 }, half: { gloom: .45 }, deep: { gloom: .9 } },
    motes: { none: { motes: 0 }, some: { motes: 14 } },
  };
  function kitOf(style, pieces) {
    var base = KIT[style] || KIT.alpine, k;
    if (!pieces) return base;
    var out = {}; for (k in base) out[k] = base[k];
    for (k in pieces) { var f = PIECES[k] && PIECES[k][pieces[k]], n; if (f) for (n in f) out[n] = f[n]; }
    return out;
  }
  /* A site's look as the API gives it: its kit, its colour (1..8, or none: by its place in the
     list), and how the kit's palette is turned. */
  function lookOf(s) {
    var p = null;   // its pieces in one order, so the same look always reads the same
    if (s.pieces) Object.keys(s.pieces).sort().forEach(function (k) { if (s.pieces[k]) (p = p || {})[k] = s.pieces[k]; });
    return { style: s.style || null, tint: s.tint || null, hue: s.hue || 0, shade: s.shade || 0, pieces: p };
  }
  function tintOf(s) { return T.sites[((s.look.tint || s.idx + 1) - 1) % T.sites.length]; }
  /* The kit's palette turned for one site: the material (roof, timber, stone, the walls, the
     shutters, the awnings) by `hue` degrees and lightened or darkened by `shade` (−40..40, a
     share of the way to white or black); never the lights (lamp, window, clock, mote), which are
     counts. Every colour is still a token of tokens.css, turned. */
  var MATERIAL = ['roof', 'timber', 'stone', 'stoneDark'], MATERIAL_SETS = ['walls', 'shutters', 'awnings'];
  function paletteOf(s) {
    var base = s.kit.T || {}, out = {}, k, hue = s.look.hue || 0, shade = s.look.shade || 0;
    for (k in base) out[k] = base[k];
    if (!hue && !shade) return out;
    MATERIAL.forEach(function (n) { out[n] = turned(n in base ? base[n] : T[n], hue, shade); });
    MATERIAL_SETS.forEach(function (n) { out[n] = (base[n] || T[n]).map(function (c) { return turned(c, hue, shade); }); });
    return out;
  }
  function turned(c, hue, shade) {
    var r = c[0], g = c[1], b = c[2], max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min, h = 0, sat = 0;
    if (d) {
      sat = d / (1 - Math.abs(2 * l - 1));
      h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    }
    h = ((h * 60 + hue) % 360 + 360) % 360;
    l = shade > 0 ? l + (1 - l) * shade / 100 : l + l * shade / 100;
    var C = (1 - Math.abs(2 * l - 1)) * sat, X = C * (1 - Math.abs((h / 60) % 2 - 1)), m = l - C / 2, q = h < 60 ? [C, X, 0] : h < 120 ? [X, C, 0] : h < 180 ? [0, C, X] : h < 240 ? [0, X, C] : h < 300 ? [X, 0, C] : [C, 0, X];
    return [q[0] + m, q[1] + m, q[2] + m];
  }
  var SPIRE = { pyramid: 10.7, needle: 14.1, belfry: 10.6, iron: 14.3 };   // the top of each kit's tower
  /* Where a village's sign hangs: over its tower, and over its banner when it flies one. */
  function signAt(s) { return [s.o[0], Math.max(14, SPIRE[s.kit.spire] + (icons[s.id] ? 5.8 : 2.3)), s.o[2]]; }
  /* The sites' icons, as loaded images (app.js fetches them with the token: `setIcon`). */
  var icons = {};
  function iconOf(s) { var im = icons[s.id]; return im && im.complete && im.naturalWidth ? im : null; }
  /* The site's palette (its kit's colours, turned) over the tokens while its village is laid out and built. */
  function withKit(s, fn) {
    var c = s.palette || s.kit.T || {}, keep = {}, k;
    for (k in c) { keep[k] = T[k]; T[k] = c[k]; }
    try { fn(); } finally { for (k in keep) T[k] = keep[k]; }
  }
  var TILT = { bay: .3, site: .42 }, LENS = -.4;   // how far down the camera looks; how far under the middle of the gap the valley sits, so the horizon is in the picture
  var SKY_MS = 20000;         // the clock is read this often for the light
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  function rand(a, b) { var x = Math.sin(a * 127.1 + (b || 0) * 311.7) * 43758.5453; return x - Math.floor(x); }
  var reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(n) { return (n || 0).toLocaleString('en'); }
  function plural(n, one, many) { return fmt(n) + ' ' + (n === 1 ? one : many); }
  function pct(a, b) { return b ? Math.min(100, Math.round(100 * a / b)) : 0; }
  function narrow() { return window.innerWidth < 760; }
  function when() { return state.past ? 'that day' : 'today'; }   // the counts on screen are a past day's, or today's
  function week() { return state.past ? 'in the 7 days up to it' : 'in the last 7 days'; }
  function ang(k, n) { return -Math.PI / 2 + k / n * TAU; }   // 0 at the top (−z), clockwise seen from above
  function at(o, a, r) { return [o[0] + Math.cos(a) * r, 0, o[2] + Math.sin(a) * r]; }
  function angDiff(a, b) { return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))); }

  /* ---------- the tokens ---------- */
  var T = {};
  /* ---------- the sky by the clock ---------- */
  /* A polar winter day by the viewer's own clock: the sun never clears the mountains by much, so
     the windows stay lit and can be read at any hour. A light is a set of colours from tokens.css
     (`SKY`: the night's under the plain names, the others' with the light's name after) and what
     is not a colour, here: where the light comes from (`sun`) and where its disc hangs (`disc`,
     its `size` as a cosine, its strength), the stars, the clouds, the aurora, how hard lamps and
     windows burn (`em`), the exposure, and how bright a thing is before it glows (`glow`). Each
     is the evening's, to the right; the morning's is its mirror, and the low sun, like the moon,
     crosses from one side to the other. */
  var SKY = ['sky-top', 'sky-mid', 'sky-low', 'moon', 'moonlight', 'sky-light', 'ground-light', 'rim', 'haze', 'cloud', 'ice', 'tint-shadow', 'tint-light'];
  var LIGHTS = {
    night: { sun: [.62, .4, .25], disc: [.2, .14, -.97], size: .99975, discK: 2.2, stars: 1, clouds: 0, aurora: 1, em: 2.4, expo: 1.12, glow: .8 },
    blue: { sun: [.66, .28, -.3], disc: [.62, -.06, -.78], size: .9990, discK: 0, stars: .5, clouds: .6, aurora: 0, em: 2.4, expo: 1.12, glow: .8 },
    dusk: { sun: [.66, .2, -.5], disc: [.66, .1, -.74], size: .9982, discK: 6, stars: .15, clouds: .9, aurora: 0, em: 2, expo: 1.05, glow: .9 },
    gold: { sun: [.45, .34, -.7], disc: [.3, .1, -.95], size: .9984, discK: 6, stars: 0, clouds: .45, aurora: 0, em: 1.8, expo: .94, glow: 1.15 },
  };
  /* [hour, light, side], from one dawn to the next (the night runs through midnight): between
     one and the next the light is mixed. */
  var DAY = [[5.5, 'night', -1], [7, 'blue', -1], [8.5, 'dusk', -1], [10.5, 'gold', -1], [14.5, 'gold', 1], [16.25, 'dusk', 1], [18.5, 'blue', 1], [20, 'night', 1], [29.5, 'night', -1]];
  /* `?hour=13.5` holds the clock there: any light, without waiting for it. */
  var hourFixed = (function () { var m = /[?&]hour=([0-9.]+)/.exec(location.search); return m ? clamp(parseFloat(m[1]) || 0, 0, 24) : null; })();
  function clockHour() { var d = new Date(); return hourFixed != null ? hourFixed : d.getHours() + d.getMinutes() / 60; }
  function lightOf(k) {
    var L = LIGHTS[k[1]], C = T.sky[k[1]], o = { sun: [L.sun[0] * k[2], L.sun[1], L.sun[2]], disc: [L.disc[0] * k[2], L.disc[1], L.disc[2]] }, n;
    for (n in L) if (!(n in o)) o[n] = L[n];
    for (n in C) o[n] = C[n];
    return o;
  }
  /* From one direction to another round the horizon, the short way: a plain mix of two on
     opposite sides would pass overhead. */
  function turn(a, b, t) {
    a = G.norm(a); b = G.norm(b);
    var az = Math.atan2(a[0], a[2]), d = Math.atan2(b[0], b[2]) - az, el = G.lerp(Math.asin(a[1]), Math.asin(b[1]), t);
    az += Math.atan2(Math.sin(d), Math.cos(d)) * t;
    return [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
  }
  function skyAt(h) {
    if (h < DAY[0][0]) h += 24;
    var i = 0; while (i < DAY.length - 2 && h >= DAY[i + 1][0]) i++;
    var a = lightOf(DAY[i]), b = lightOf(DAY[i + 1]), t = clamp((h - DAY[i][0]) / (DAY[i + 1][0] - DAY[i][0]), 0, 1), o = {}, n;
    t = t * t * (3 - 2 * t);
    for (n in a) o[n] = typeof a[n] === 'number' ? G.lerp(a[n], b[n], t) : n === 'sun' || n === 'disc' ? turn(a[n], b[n], t) : G.mix(a[n], b[n], t);
    return o;
  }
  /* A tint token is a hue to lean to: as a multiplier it keeps the brightness. */
  function tint(c) { return G.scale(c, 3 / (c[0] + c[1] + c[2])); }
  /* The light of this hour, into the world, when it is not the light already there (to a
     hundredth: at night that is the moon a little further on, every few minutes). The picture
     takes it with its next drawing (the sky's own tick, every few seconds while the weather
     moves); the shadows are cast again only once the light has moved about a degree. */
  var sunAt = null, skyKey = null;
  function applySky() {
    if (!W) return;
    var s = skyAt(clockHour()), E = W.env, sun = G.norm(s.sun), key = JSON.stringify(s, function (k, v) { return typeof v === 'number' ? Math.round(v * 100) / 100 : v; });
    if (key === skyKey) return; skyKey = key;
    E.skyTop = s.skyTop; E.skyMid = s.skyMid; E.skyLow = s.skyLow; E.fog = s.skyLow; E.moon = s.moonlight; E.skyAmb = s.skyLight; E.gndAmb = s.groundLight; E.rim = s.rim;
    E.moonTint = s.moon; E.haze = s.haze; E.cloud = s.cloud; E.ice = s.ice; E.tintS = tint(s.tintShadow); E.tintH = tint(s.tintLight);
    E.moonSky = s.disc; E.disc = s.size; E.discK = s.discK; E.stars = s.stars; E.cloudK = s.clouds; E.aurora = s.aurora; E.emK = s.em; E.expo = s.expo; E.bloomThr = s.glow;
    if (!sunAt || sun[0] * sunAt[0] + sun[1] * sunAt[1] + sun[2] * sunAt[2] < .9998) { sunAt = sun; W.setSun(sun); }
    if (reduced) W.invalidate();   // no tick will come for it
  }

  function camel(k) { return k.replace(/-([a-z0-9])/g, function (m, c) { return c.toUpperCase(); }); }
  function readTokens() {
    var cs = getComputedStyle(document.documentElement);
    function col(n) {
      var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(cs.getPropertyValue('--village-' + n).trim());
      return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : [1, 1, 1];
    }
    ['edge', 'snow', 'snow-2', 'path', 'stone',
      'stone-dark', 'rock', 'timber', 'trunk', 'pine', 'roof', 'iron', 'brass', 'straw', 'clock', 'window', 'window-dark', 'lamp', 'coat', 'skin',
      'smoke', 'flake', 'star', 'view', 'aurora', 'aurora-2'].forEach(function (k) { T[camel(k)] = col(k); });
    T.sky = {};
    Object.keys(LIGHTS).forEach(function (k) { var o = T.sky[k] = {}; SKY.forEach(function (n) { o[camel(n)] = col(n + (k === 'night' ? '' : '-' + k)); }); });
    T.awnings = [1, 2, 3, 4].map(function (i) { return col('awning' + (i > 1 ? '-' + i : '')); });
    T.shutters = [1, 2, 3].map(function (i) { return col('shutter-' + i); });
    T.walls = []; T.sites = [];
    for (var i = 1; i <= 8; i++) { T.walls.push(col('wall-' + i)); T.sites.push(col('site-' + i)); }
    T.lanes = [1, 2, 3, 4, 5].map(function (i) { return col('lane-' + i); });
    T.mote = col('mote');
    Object.keys(KIT).forEach(function (name) {   // each kit's own colours: what tokens.css has for it
      if (name === 'alpine') return;
      var o = KIT[name].T = {};
      function has(n) { return !!cs.getPropertyValue('--village-' + n + '-' + name).trim(); }
      KIT_COLORS.forEach(function (n) { if (has(n)) o[camel(n)] = col(n + '-' + name); });
      if (has('wall-1')) o.walls = [1, 2, 3, 4].map(function (i) { return col('wall-' + i + '-' + name); });
      if (has('shutter-1')) o.shutters = [1, 2, 3].map(function (i) { return col('shutter-' + i + '-' + name); });
      if (has('awning-1')) o.awnings = [1, 2, 3, 4].map(function (i) { return col('awning-' + i + '-' + name); });
    });
    T.direct = col('lane-direct');
  }
  function css(c) { return 'rgb(' + c.map(function (v) { return Math.round(v * 255); }).join(',') + ')'; }

  /* ---------- state ---------- */
  var W = null, cv, overlay, tip, opts = {}, failed = false;
  var sites = [], byId = {};
  var view = { mode: 'bay', site: null, hl: null, free: false };
  var state = { blackout: null, dark: null, hour: -1, past: false };
  var land, landOcc = [], smoke = [];

  /* ---------- the sites (the counts are the bay's, unchanged) ---------- */
  function makeSite(s, i) {
    var o = { id: s.id, name: s.name, idx: i, draft: !!s.draft, look: lookOf(s), towers: [], towerBy: {}, lanes: [], laneBy: {},
      views: [], viewBy: {}, stalls: [], shops: [], shopBy: {}, workshops: [], R: null, kit: kitOf(s.style, s.pieces), steps: [], decals: [],
      visitors: 0, pageviews: 0, viewsToday: 0, events: 0, loads: 0, engaged: 0, yesterday: 0, week: 0, hours: [], loaded: false,
      o: [0, 0, 0], houses: [], gates: [], walkers: [], sign: null,
      layer: null, sig: null, pending: false, builtAt: 0, labels: {}, pools: [], occ: [], glow: [] };
    o.tint = tintOf(o); o.palette = paletteOf(o);
    o.R = radii(o); return o;
  }
  /* The look changed (the Sites panel, as the owner tries one): the kit, the palette, the colour. */
  function dress(s, look) {
    var L = lookOf(look), was = s.tint;
    if (JSON.stringify(L) !== JSON.stringify(s.look)) { s.look = L; s.kit = kitOf(L.style, L.pieces); s.palette = paletteOf(s); s.sig = null; }
    s.tint = tintOf(s);   // by its place in the list, when it has no colour of its own: that place may have moved
    if (s.tint !== was) s.sig = null;
    if (s.sign) { s.sign.p = signAt(s); s.sign.el.firstChild.style.setProperty('--site', css(s.tint)); }
  }
  /* A village's size is its visits' (`s.week`: the 7 days' pageviews and views opened), in
     `STEPS`; what it is made of only pushes its wall further out when it does not fit. The stalls
     in rows round the tower (ten in the first, then sixteen, then twenty-two), the lamps just
     outside the last row, the houses round them: on one ring as long as they fit there (the
     gates in the gaps between them), else on rings behind it, the week's busiest inside, every
     ring leaving the gates' lanes free and each staggered half a house from the one inside it.
     Behind the houses the workshops, one per event, by name, on a ring of their own (more when
     they do not fit), off the lanes too. The wall behind all that, wide enough for every gate
     and at least the visits' step (`sizeAll` adds the order between villages, and the fields).
     Then the square's paving, its kerb and the walk round it, and where the paths to the houses
     start, all from the lamps. Each ring keeps its street (where a villager walks round) and
     where the way to a door starts. */
  function radii(s) {
    var rows = [], left = Math.max(s.views.length, 1), r = R_STALL;
    while (left > 0) { var cap = Math.floor(TAU * r / PITCH.stall); rows.push({ r: r, cap: cap }); left -= cap; if (left > 0) r += ROW; }
    var post = r + 2.1, walk = post + 2.3, inner = post + 3, first = Math.max(11.2, post + 4.8);
    var pages = s.towers.length, nl = s.lanes.length, slots = Math.max(pages, nl, 5), rings = [], shops = [], one = pages <= Math.floor(TAU * first / PITCH.house);
    var gateA = s.lanes.map(function (l, k) { return one ? ang(Math.floor(k * slots / nl) + .5, slots) : ang(k + .5, nl); });   // between two house slots, or on a lane every ring leaves free
    function near(a, at, room) { return gateA.some(function (g) { return angDiff(a, g) * at < room; }); }
    /* Things on rings from radius `rr` out, `step` apart, one every `pitch`, none nearer a lane
       than `room`, a ring not full spreading them round. */
    function fill(list, n, rr, step, pitch, room, stagger, ring) {
      while (n > 0) {
        var S = Math.floor(TAU * rr / pitch), free = [], angles = [], j, a;
        for (j = 0; j < S; j++) { a = ang(j + (stagger ? list.length % 2 * .5 : .5), S); if (!near(a, rr, room)) free.push(a); }
        var k = Math.min(free.length, n);
        for (j = 0; j < k; j++) angles.push(free[Math.floor(j * free.length / k)]);
        if (k) list.push(ring(rr, S, angles));
        n -= k; if (n > 0) rr += step;
      }
    }
    if (one) {
      var at1 = [];
      for (var k = 0; k < pages; k++) at1.push(ang(k, slots));
      rings.push({ r: Math.max(first, slots * PITCH.house / TAU), street: walk, from: inner, slots: slots, angles: at1 });
    } else fill(rings, pages, first, RING, PITCH.house, LANE, true, function (rr, S, angles) { var st = rings.length ? rr - RING / 2 : walk; return { r: rr, street: st, from: rings.length ? st : inner, slots: S, angles: angles }; });
    var house = rings[rings.length - 1].r;
    fill(shops, s.shops.length, house + 5.5, PITCH.shop, PITCH.shop, LANE + 1.2, false, function (rr, S, angles) { return { r: rr, street: rr - 2.9, slots: S, angles: angles }; });
    var out = shops.length ? shops[shops.length - 1].r + 4.4 : house + 4.8;
    return { rows: rows, rings: rings, shops: shops, gateA: gateA, post: post, pave: post + 1.2, walk: walk, inner: inner, house: house, fields: null,
      wall: Math.max(out, nl * PITCH.gate / TAU, stepOf(s.week)) };
  }
  function stepOf(n) { for (var i = 0; i < STEPS.length; i++) if (n < STEPS[i][0]) return STEPS[i][1]; }
  /* Every village's radii, then the order: one with more visits than another is ORDER wider than
     every one with fewer, whatever their pages ask for, so the bigger village is always the
     busier. Then the fields: what is left between the last houses and the wall. Answers whether
     a wall moved. */
  function sizeAll() {
    var was = sites.map(function (x) { return x.R && x.R.wall; }), moved = false, below = 0, i = 0;
    var list = sites.slice().sort(function (a, b) { return a.week - b.week; });
    sites.forEach(function (x) { x.R = radii(x); });
    while (i < list.length) {
      var j = i, top = 0;
      while (j < list.length && list[j].week === list[i].week) { var R = list[j].R; R.wall = Math.max(R.wall, below + ORDER); top = Math.max(top, R.wall); j++; }
      below = Math.max(below, top); i = j;
    }
    sites.forEach(function (x, k) {
      var R = x.R, r0 = R.house + 3.6, r1 = R.wall - 2.6;
      R.fields = r1 - r0 > 2 ? [r0, r1] : null;
      if (R.wall !== was[k]) moved = true;
    });
    return moved;
  }
  /* The counts changed what the villages are made of, or how they stand to each other: their
     radii again and, when a wall moved, every village's place in the valley and, a moment
     later, the land round them: a reload loads every site in one go, and each may move the
     walls, so the land is built once for all of them. */
  var landSoon = null;
  function resize() {
    if (!sizeAll() || !W || !sites.length) return;
    place();
    if (!landSoon) landSoon = setTimeout(function () { landSoon = null; if (W) { buildLand(); share(); W.wake(); } }, 0);
    sites.forEach(function (x) {   // the ground moved under whoever was on the way: their bell rings now, as on a load
      x.sig = null; x.walkers.forEach(function (w) { if (w.shop) worked(x, w.shop); else cue(w.stall ? 'stall' : 'door', x, w.cue); }); x.walkers = []; x.steps = [];   // a workshop's still leaves its crate
    });
    if (!view.free) frameView();
  }
  /* Its houses are the week's pages, in that order (a page of today outside the week's list,
     which the API cuts at 200, builds at the end); its gates the week's referrers, then direct;
     its stalls the week's views the same way, its workshops the week's other events by name.
     Storeys and counts are today's. */
  function load(s, data) {
    s.loaded = false;   // while the lists are filled, nothing grows the village piece by piece: it is sized once at the end
    s.towers = []; s.towerBy = {};
    data.pages.forEach(function (p) { addTower(s, p.value, p.hits); });
    ((data.yesterday && data.yesterday.pages) || []).forEach(function (p) { var t = towerOf(s, p.path); if (t) t.ypv = p.hits; });
    data.today.pages.forEach(function (p) { var t = towerFor(s, p.path); t.pv += p.hits; t.loads += p.loads || 0; t.engaged += p.engaged || 0; t.events += p.events; });
    s.lanes = []; s.laneBy = {};
    data.refs.forEach(function (r) { addLane(s, r.value); });
    s.laneBy.direct = { key: 'direct', label: 'direct', color: T.direct, count: 0 }; s.lanes.push(s.laneBy.direct);
    data.today.refs.forEach(function (r) { laneFor(s, r.ref).count += r.hits; });
    s.views = []; s.viewBy = {}; s.stalls = [];
    (data.views || []).forEach(function (v) { addView(s, v.value, v.hits); });
    (data.today.views || []).forEach(function (v) { viewFor(s, v.view).n += v.hits; });
    (data.today.viewPages || []).forEach(function (v) { cameFrom(viewFor(s, v.view), towerFor(s, v.path), v.hits); });
    s.shops = []; s.shopBy = {};
    (data.events || []).forEach(function (e) { addShop(s, e.value, e.hits); });
    (data.today.byEvent || []).forEach(function (e) { shopFor(s, e.event).n += e.hits; });
    (data.today.eventPages || []).forEach(function (e) { cameFrom(shopFor(s, e.event), towerFor(s, e.path), e.hits); });
    byName(s.shops);   // the API cuts the busiest 200 and lists them by name; one only today goes in its place
    s.visitors = data.today.visitors; s.pageviews = data.today.hits; s.viewsToday = data.today.viewsTotal || 0; s.events = data.today.events; s.loads = data.today.loads || 0; s.engaged = data.today.engaged || 0;
    s.yesterday = data.yesterday.visitors;
    s.hours = data.hours || [];
    s.week = data.week ? (data.week.hits || 0) + (data.week.views || 0) : 0;
    s.walkers.forEach(function (w) { if (w.shop) cue('work', s, { shop: w.shop.k }); else cue(w.stall ? 'stall' : 'door', s, w.cue); });   // whoever was on the way is not drawn again: their bell rings now (a crate is in the counts just loaded)
    s.walkers = []; s.steps = [];
    s.loaded = true; resize();
    rebuild(s, true);   // new towers and lanes: its houses and gates are made again
  }
  /* A house, a gate, a stall more. The keys are prefixed: a path or a view's name is anything a
     site sends. The `Of` forms look one up (null when there is none); the `For` forms build it
     when the village already stands, which may make the village bigger. */
  function addTower(s, path, total) { var t = { path: path, label: path, total: total, pv: 0, ypv: 0, loads: 0, engaged: 0, events: 0, seed: s.idx * 97 + s.towers.length * 13 }; s.towers.push(t); s.towerBy['p:' + path] = t; return t; }
  function addLane(s, ref) { var l = { key: 'ref:' + ref, ref: ref, label: ref, color: T.lanes[(s.lanes.length - (s.laneBy.direct ? 1 : 0)) % T.lanes.length], count: 0 }; s.lanes.push(l); s.laneBy[l.key] = l; return l; }
  function addView(s, name, total) { var v = { name: name, label: name, total: total, n: 0, by: {} }; s.views.push(v); s.viewBy['v:' + name] = v; return v; }
  function addShop(s, name, total) {
    var h = 0; for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
    h = Math.abs(h);
    var e = { name: name, label: name, total: total, n: 0, by: {}, kind: SHOPS[h % SHOPS.length], col: T.awnings[Math.floor(h / SHOPS.length) % T.awnings.length] };
    s.shops.push(e); s.shopBy['e:' + name] = e;
    if (s.loaded) byName(s.shops);   // one new today takes its place; load() sorts once, at the end
    return e;
  }
  function byName(list) { list.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; }); }
  function grown(s, x) { if (s.loaded) { resize(); rebuild(s, true); } return x; }
  function towerOf(s, path) { return s.towerBy['p:' + path] || null; }
  function laneOf(s, ref) { return ref == null ? s.laneBy.direct || null : s.laneBy['ref:' + ref] || null; }
  function viewOf(s, name) { return s.viewBy['v:' + name] || null; }
  function towerFor(s, path) { return towerOf(s, path) || grown(s, addTower(s, path, 0)); }
  function laneFor(s, ref) { return laneOf(s, ref) || grown(s, addLane(s, ref)); }
  function viewFor(s, name) { return viewOf(s, name) || grown(s, addView(s, name, 0)); }
  function shopOf(s, name) { return s.shopBy['e:' + name] || null; }
  function shopFor(s, name) { return shopOf(s, name) || grown(s, addShop(s, name, 0)); }
  function isView(msg) { return msg.event === 'screen' && !!msg.props && typeof msg.props.view === 'string'; }
  /* `n` opens of a view came from a page: kept for its tooltip. */
  function cameFrom(v, t, n) { v.by[t.label] = (v.by[t.label] || 0) + n; }
  /* Today's events that are not views: a view is stored as an event, and is counted as a view. */
  function otherEvents(s) { return Math.max(0, s.events - s.viewsToday); }

  /* One hit from the live socket. */
  function live(msg) {
    var s = byId[msg.site]; if (!s || !s.loaded || s.draft || state.blackout || state.past) return;   // a past day is over: nobody walks in
    var t = towerFor(s, msg.path), v = isView(msg) ? viewFor(s, msg.props.view) : null, e = msg.event && !v ? shopFor(s, msg.event) : null;
    if (v) { v.n++; s.viewsToday++; v.total++; cameFrom(v, t, 1); }   // before the village is drawn: a stall that is new opens lit
    if (e) { e.total++; cameFrom(e, t, 1); }   // its crate waits for the villager
    if (v || !msg.event) { var step = stepOf(s.week); if (stepOf(++s.week) !== step) resize(); }   // a step crossed: it grows before anyone walks in (passing another village waits for the next load)
    if (s.sig == null) refresh(true);   // a village not drawn yet (just loaded, or with a new house or stall) has no door to walk to
    var h = houseOf(s, t);
    if (W) W.wake();
    if (msg.event) {
      t.events++; s.events++;
      if (v) { rebuild(s); toStall(s, h, stallOf(s, v)); }
      else if (e) toShop(s, h, e);
      return;
    }
    var l = laneFor(s, msg.ref);
    s.pageviews++; if (msg.first) s.visitors++; t.pv++; l.count++;
    if (s.loads) { s.loads++; t.loads++; }
    var hr = s.hours[new Date().getUTCHours()]; if (hr) hr.today++;
    rebuild(s);
    var g = gateOf(s, l);
    if (!h || !g || !W) return;
    var c = { lane: s.lanes.indexOf(l), house: s.houses.indexOf(h), first: !!msg.first };
    cue('gate', s, c);
    if (reduced) { h.flash = 1; cue('door', s, { house: c.house, first: c.first, delay: .8 }); return; }   // nobody walks: the bell follows the steps
    var side = (Math.random() - .5) * g.w * .5, tan = [-Math.sin(g.a) * side, 0, Math.cos(g.a) * side];
    var path = [[g.end[0] + tan[0], 0, g.end[2] + tan[2]], [g.pos[0] + tan[0], 0, g.pos[2] + tan[2]]];
    walkRound(path, s, g.a, h.a, h.ring.street);
    path.push(h.door);
    s.walkers.push({ path: path, d: 0, speed: 2.3 + Math.random() * .7, col: g.col, h: h, seed: Math.random(), cue: c });
  }
  /* What just happened, for the ear: the village's place in the valley goes with it. */
  function cue(name, s, c) {
    if (!opts.onCue) return;
    var o = { site: s ? s.idx : 0, of: sites.length }, k;
    for (k in c) o[k] = c[k];
    opts.onCue(name, o);
  }
  /* Onto a walker's path: round the square at radius `r`, the short way from angle `a0` to `a1`. */
  function walkRound(path, s, a0, a1, r) {
    var da = Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0)), steps = Math.max(1, Math.ceil(Math.abs(da) / .25));
    for (var k = 0; k <= steps; k++) path.push(at(s.o, a0 + da * k / steps, r));
  }
  /* A view opened: out of the page's door, across the lamp ring between two lamps, round the
     market to the stall: in through the nearest gap of each row outside the stall's own. */
  function toStall(s, h, st) {
    if (!h || !st || !W) return;
    if (reduced) { st.flash = 1; cue('stall', s, { view: st.k }); return; }
    var step = TAU / 24, cross = (Math.floor((h.a + Math.PI / 2) / step) + .5) * step - Math.PI / 2;
    var path = [h.door.slice(), at(s.o, cross, s.R.post + .9)];
    for (var i = s.R.rows.length - 1; i > st.row; i--) {
      var gap = gapOf(s, i, cross), r = s.R.rows[i].r;
      walkRound(path, s, cross, gap, r + 1.5); path.push(at(s.o, gap, r - 1.2)); cross = gap;
    }
    walkRound(path, s, cross, st.a, st.r + 1.5);
    path.push(st.front.slice());
    s.walkers.push({ path: path, d: 0, speed: 2.3 + Math.random() * .7, col: T.view, stall: st, seed: Math.random(), cue: { view: st.k } });
  }
  /* The angle between two stalls of row `i` nearest to `a`. */
  function gapOf(s, i, a) {
    var vs = s.rowSlots[i], best = a, bd = Infinity;
    for (var j = 0; j <= vs; j++) { var g = ang(j + i * .5, vs), d = angDiff(g, a); if (d < bd) { bd = d; best = g; } }
    return best;
  }
  /* Any other event: out of the page's door, round its street to the gate's lane nearest the
     workshop, out along it to the workshops' street and round to its door, in a scarf of its
     lantern's colour; there it works a moment, then leaves its crate (`worked`). Nobody walks
     when the page has no house, or motion is reduced: the crate is there at once. */
  function toShop(s, h, e) {
    var w = workshopOf(s, e);
    if (!w || !W) { e.n++; rebuild(s); return; }   // no workshop drawn to walk to: the count still goes up
    if (reduced || !h || !s.gates.length) { worked(s, w); return; }
    var lane = s.gates.reduce(function (b, g) { return angDiff(g.a, w.a) < angDiff(b, w.a) ? g.a : b; }, s.gates[0].a);
    var path = [h.door.slice()];
    walkRound(path, s, h.a, lane, h.ring.street);
    walkRound(path, s, lane, w.a, w.ring.street);
    path.push(w.front.slice());
    s.walkers.push({ path: path, d: 0, speed: 2.3 + Math.random() * .7, col: w.e.col, shop: w, work: 0, seed: Math.random() });   // its cue is the workshop's place when it arrives
  }
  function worked(s, w) { w.e.n++; w.flash = 1; cue('work', s, { shop: w.k }); rebuild(s); }
  function houseOf(s, t) { for (var i = 0; i < s.houses.length; i++) if (s.houses[i].t === t) return s.houses[i]; return null; }
  function workshopOf(s, e) { for (var i = 0; i < s.workshops.length; i++) if (s.workshops[i].e === e) return s.workshops[i]; return null; }
  function gateOf(s, l) { for (var i = 0; i < s.gates.length; i++) if (s.gates[i].l === l) return s.gates[i]; return null; }
  function stallOf(s, v) { for (var i = 0; i < s.stalls.length; i++) if (s.stalls[i].v === v) return s.stalls[i]; return null; }

  /* ---------- the land: one village per site, side by side in the valley ---------- */
  function place() {
    var xs = [], x = 0;
    sites.forEach(function (s, i) { if (i) x += sites[i - 1].R.wall + GAP + s.R.wall; xs.push(x); });
    var mid = sites.length ? (xs[0] + xs[xs.length - 1]) / 2 : 0;
    sites.forEach(function (s, i) { s.o = [xs[i] - mid, 0, i % 2 ? -7 : 3]; if (s.sign) s.sign.p = signAt(s); });
    var x0 = Math.min.apply(null, sites.map(function (s) { return s.o[0] - s.R.wall; }).concat([-16])) - 18;
    var x1 = Math.max.apply(null, sites.map(function (s) { return s.o[0] + s.R.wall; }).concat([16])) + 18;
    lake = null;
    if (sites.length) { var zb = Math.min.apply(null, sites.map(function (s) { return s.o[2] - s.R.wall; })), rz = 30; lake = [(x0 + x1) / 2, zb - 11 - rz, Math.max(70, (x1 - x0) * .75), rz]; }
    var size = Math.max(x1 - x0, 96);
    if (W) W.bounds([(x0 + x1) / 2 - size / 2, -3 - size / 2, size]);
  }
  /* The frozen lake behind the villages, under the mountains: [x, z, rx, rz], its shore uneven. */
  var lake = null;
  function lakeR(x, z) { return lake ? Math.hypot((x - lake[0]) / lake[2], (z - lake[1]) / lake[3]) + (vnoise(x * .11, z * .11) - .5) * .22 : 9; }
  function vnoise(x, z) {
    var xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi; fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
    var a = rand(xi, zi), b = rand(xi + 1, zi), c = rand(xi, zi + 1), d = rand(xi + 1, zi + 1); return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  }
  function ridged(x, z) { var t = 0, a = 1, f = 1, n; for (var o = 0; o < 5; o++) { n = 1 - Math.abs(vnoise(x * f + o * 31, z * f - o * 17) * 2 - 1); t += n * n * a; a *= .5; f *= 2.07; } return t / 1.94; }
  function hf(x, z) {
    var d = Infinity; sites.forEach(function (s) { d = Math.min(d, Math.hypot(x - s.o[0], z - s.o[2]) - s.R.wall); });   // beyond the nearest wall
    if (!sites.length) d = Math.hypot(x, z) - 16;
    var dune = Math.sin(x * .21 + Math.cos(z * .17) * 2) * .25 + Math.sin(z * .13 - x * .05) * .3;
    var h = clamp((d - 1.5) / 6, 0, 1) * (dune + .25) + Math.max(0, d - 14) * .05 * (1 + .6 * Math.sin(x * .07 + z * .05)) + Math.max(0, -z - 50) * .08;
    if (lake) { var k = clamp((lakeR(x, z) - .92) / .3, 0, 1); h = G.lerp(-.55, h, k * k * (3 - 2 * k)); }
    return h;
  }
  function pine(M, x, y, z, s, occ) {
    M.cyl(x, y, z, .12 * s, .7 * s, 5, T.trunk);
    for (var k = 0; k < 3; k++) {
      var ty = y + (.5 + k * .75) * s, r = (1.05 - k * .27) * s, h = 1.25 * s;
      M.cone(x, ty, z, r, h, 7, T.pine, 0, true);
      M.cone(x, ty + h * .42, z, r * .6, h * .58, 7, T.snow, G.SNOW, true);
    }
    occ.push([x, z, 1.6 * s]);
  }
  /* The ground, the mountains and the woods: built when the sites change, never per hit. */
  function buildLand() {
    var M = land.mesh; M.clear(); landOcc = [];
    var b = W.box, cx = b[0] + b[2] / 2, cz = b[1] + b[2] / 2, ext = b[2] / 2 + 110;
    M.terrain(cx - ext, cz - ext, ext * 2, Math.min(200, Math.round(ext * 1.2)), hf, function (h, x, z) { return G.mix(T.snow, T.snow2, (Math.sin(x * .3) * Math.cos(z * .27) + 1) / 2); }, G.SNOW);
    /* The mountains: a ring of ridged noise that rises behind the valley, lit like the rest. */
    var R0 = ext * .82, R1 = ext + 330, NA = 240, NR = 30, grid = [], i, j;
    function mh(x, z) {
      var r = Math.hypot(x - cx, z - cz), e = clamp((r - R0) / 130, 0, 1); e = e * e * (3 - 2 * e);
      return e * (3.6 + 54 * Math.pow(ridged(x * .0075, z * .0075), 1.7) * (.6 + .8 * vnoise(x * .004 + 5, z * .004))) * (1 - .5 * clamp((r - R1 + 90) / 90, 0, 1)) - 4;
    }
    function peak(a, r) { var x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r, y = mh(x, z), e = 2.5; return { p: [x, y, z], n: G.norm([mh(x - e, z) - mh(x + e, z), 2 * e, mh(x, z - e) - mh(x, z + e)]) }; }
    for (i = 0; i <= NA; i++) { grid.push([]); for (j = 0; j <= NR; j++) grid[i].push(peak(i % NA / NA * TAU, R0 + (R1 - R0) * Math.pow(j / NR, 1.25))); }
    for (i = 0; i < NA; i++) for (j = 0; j < NR; j++) {
      var A = grid[i][j], B = grid[i + 1][j], C = grid[i + 1][j + 1], D = grid[i][j + 1];
      var sn = clamp(((A.n[1] + B.n[1] + C.n[1] + D.n[1]) / 4 - .5) * 5 + ((A.p[1] + C.p[1]) / 2 - 10) * .03 + (rand(i, j) - .5) * .3, 0, 1);   // snow where it lies: the flatter and the higher
      var col = G.mix(G.mix(T.stoneDark, T.rock, rand(j, i)), T.snow, sn);
      M.triN(A.p, C.p, D.p, A.n, C.n, D.n, col); M.triN(A.p, B.p, C.p, A.n, B.n, C.n, col);
    }
    if (lake) M.flat(lake[0], -.1, lake[1], lake[2] * 2.6, lake[3] * 2.6, T.sky.night.ice, G.ICE);
    var count = Math.round(ext * ext / 14);
    for (var t = 0; t < count; t++) {
      var x = cx - ext + rand(t, 1) * ext * 2, z = cz - ext + rand(t, 2) * ext * 2;
      if (Math.sin(x * .08) * Math.cos(z * .09) + Math.sin(x * .03 + z * .04) < .2) continue;
      if (lakeR(x, z) < 1.12) continue;
      if (sites.some(function (s) { return Math.hypot(x - s.o[0], z - s.o[2]) < s.R.wall + 14; })) continue;
      pine(M, x, hf(x, z) - .1, z, .8 + rand(t, 3) * .9, landOcc);
    }
    for (var r = 0; r < count / 8; r++) {
      var rx = cx - ext + rand(r, 11) * ext * 2, rz = cz - ext + rand(r, 12) * ext * 2;
      if (sites.some(function (s) { return Math.hypot(rx - s.o[0], rz - s.o[2]) < s.R.wall + 2; }) || lakeR(rx, rz) < 1.05) continue;
      var rs = .4 + rand(r, 13) * .8, ry = hf(rx, rz) - .1;
      M.lump(rx, ry, rz, rs, rs * .8, 7, T.rock, r); M.lump(rx, ry + rs * .55, rz, rs * .7, rs * .35, 7, T.snow, r + 3, G.SNOW);
    }
    W.upload(land);
  }

  /* ---------- the villages ---------- */
  var scale = { unit: 1, hour: 1, view: 1, event: 1 };
  function floors(t) { return Math.max(1, Math.ceil(t.pv / scale.unit)); }
  function measure() {
    var gm = 1, hm = 1, vm = 1, em = 1;
    sites.forEach(function (s) {
      s.towers.forEach(function (t) { gm = Math.max(gm, t.pv, t.ypv); });   // yesterday's mark on the same storeys
      s.hours.forEach(function (h) { hm = Math.max(hm, h.today, h.yesterday); });
      s.views.forEach(function (v) { vm = Math.max(vm, v.n); });
      s.shops.forEach(function (e) { em = Math.max(em, e.n); });
    });
    scale.unit = Math.max(1, Math.ceil(gm / 6)); scale.hour = hm; scale.view = Math.max(1, Math.ceil(vm / GARLAND)); scale.event = Math.max(1, Math.ceil(em / CRATES));
  }
  /* Houses round the ring, gates in the gaps between them, so nobody walks through a wall; the
     stalls round the clock tower, their counters to the houses. */
  function layout(s) {
    var o = s.o, R = s.R, hs = [], k = 0;
    /* The same house (and workshop) object lives on across rebuilds, so a villager on its way
       still points at the one that is drawn. */
    R.rings.forEach(function (ring) {
      ring.angles.forEach(function (a) {
        var t = s.towers[k], h = houseOf(s, t) || { t: t, flash: 0 };
        h.a = a; h.ring = ring; h.pos = at(o, a, ring.r); h.wall = T.walls[k % T.walls.length]; h.seed = s.idx * 31 + k;
        hs.push(h); k++;
      });
    });
    s.houses = hs;
    rank(s.houses, function (h) { return h.t.pv; });
    var ws = [], q = 0;
    R.shops.forEach(function (ring) {
      ring.angles.forEach(function (a) {
        var e = s.shops[q], w = workshopOf(s, e) || { e: e, flash: 0 };
        w.a = a; w.ring = ring; w.pos = at(o, a, ring.r); w.front = at(o, a, ring.r - 2.1); w.k = q++;
        ws.push(w);
      });
    });
    s.workshops = ws;
    rank(s.workshops, function (w) { return w.e.n; });
    var maxN = 1; s.lanes.forEach(function (l) { maxN = Math.max(maxN, l.count); });
    s.gates = s.lanes.map(function (l, k) {
      var a = R.gateA[k];
      return { l: l, a: a, w: 1.1 + 2.4 * l.count / maxN, col: l.color, pos: at(o, a, R.wall), end: at(o, a, R.wall + 9) };
    });
    /* The stalls fill the rows from the tower out, each row staggered half a stall from the one
       inside it, so the garlands and the villagers pass between them. */
    var k = 0; s.stalls = []; s.rowSlots = [];
    R.rows.forEach(function (row, i) {
      var take = Math.min(row.cap, s.views.length - k), vs = Math.max(take, 6); s.rowSlots.push(vs);
      for (var j = 0; j < take; j++, k++) {
        var v = s.views[k], st = stallOf(s, v) || { v: v, flash: 0 };
        st.a = ang(j + .5 + i * .5, vs); st.r = row.r; st.row = i; st.pos = at(o, st.a, row.r); st.front = at(o, st.a, row.r + 1.05); st.k = k;
        s.stalls.push(st);
      }
    });
    rank(s.stalls, function (st) { return st.v.n; });
  }
  /* Each one's place by today's count, busiest first; a tie goes to the one first in the 30
     days, so no two share a place. The labels of a narrow screen show the first few only. */
  function rank(list, count) {
    list.map(function (x, i) { return [count(x), i]; }).sort(function (a, b) { return b[0] - a[0] || a[1] - b[1]; }).forEach(function (p, r) { list[p[1]].rank = r; });
  }

  function warmOf(t) { return Math.round(floors(t) * (t.loads ? clamp(t.engaged / t.loads, 0, 1) : 0)); }
  function lampPost(M, s, x, z, ht, on, now) {
    M.cyl(x, 0, z, .16, .25, 8, T.stoneDark);
    M.cyl(x, .25, z, .055, ht - .25, 6, T.iron);
    if (!on) { M.cone(x, .25, z, .14, .12, 8, T.snow, G.SNOW); return; }
    M.box(x, ht, z, .26, .04, .26, T.iron);
    M.box(x, ht + .04, z, .2, .26, .2, T.lamp, now ? 1 : .85);
    M.cone(x, ht + .3, z, .2, .16, 4, T.iron); M.cone(x, ht + .33, z, .14, .1, 4, T.snow, G.SNOW);
    s.pools.push([x, z, 1.4 + ht * .45, T.lamp, now ? .75 : .45]);
  }
  /* Lanterns lit on a stall's pole: one per `scale.view` opens today, on one scale for every
     site; one at least for a view opened at all. */
  function lit(v) { return v.n ? Math.min(GARLAND, Math.max(1, Math.ceil(v.n / scale.view))) : 0; }
  /* The crates in front of a workshop: one per `scale.event` of today's, on one scale for every
     site, one at least for an event done at all. */
  function crates(e) { return e.n ? Math.min(CRATES, Math.max(1, Math.ceil(e.n / scale.event))) : 0; }
  /* A workshop, facing the square: its kind (`SHOPS`) by its event's name, a woodshed with its
     logs, a well, a forge with its anvil, a windmill, a bread oven, a granary on staddle stones.
     Its lantern is the event's colour, lit when it was done today, and its crates stand in front.
     Nobody did it today: dark, no crate. */
  function workshop(M, s, w, dark) {
    var e = w.e, rot = -w.a - Math.PI / 2, x = w.pos[0], z = w.pos[2], P = G.frame(x, z, rot), open = e.n > 0, warm = open && dark !== 1, top = 2.6, q, i;
    function V(lx, ly, lz) { var r = P(lx, 0, lz); return [r[0], ly, r[2]]; }
    function roof(lz, y, L, h, D, col) { var r = P(0, 0, lz); M.roof(r[0], y, r[2], L, h, D, col, rot, .15, null); M.roof(r[0], y + .12, r[2], L - .2, h - .12, D * .78, T.snow, rot, .05, null, G.SNOW); }
    if (e.kind === 'woodshed') {
      M.box(x, 0, z, 3, .3, 2, T.stoneDark, 0, rot);
      q = P(0, 0, -.85); M.box(q[0], .3, q[2], 2.8, 1.6, .2, T.timber, 0, rot);
      [-1.3, 1.3].forEach(function (lx) { var r = P(lx, 0, .85); M.box(r[0], .3, r[2], .14, 1.6, .14, T.timber, 0, rot); });
      roof(0, 1.9, 3.1, .7, 2.2, T.roof);
      for (i = 0; i < 15; i++) { q = P(-1.05 + (i % 5) * .52, 0, -.25); M.box(q[0], .3 + Math.floor(i / 5) * .32, q[2], .44, .3, 1.1, G.mix(T.trunk, T.timber, rand(i, w.k)), 0, rot); }
      q = P(.9, 0, 1.7); M.cyl(q[0], 0, q[2], .28, .45, 8, T.trunk); M.cyl(q[0], .45, q[2], .28, .03, 8, T.snow, G.SNOW);
    } else if (e.kind === 'well') {
      M.cyl(x, 0, z, .9, .8, 12, T.stone, 0, .9, true); M.cyl(x, .8, z, .95, .1, 12, T.snow, G.SNOW, .95, true); M.cyl(x, .82, z, .7, .02, 12, T.iron);
      [-1, 1].forEach(function (sd) { var r = P(sd * .85, 0, 0); M.box(r[0], 0, r[2], .14, 2, .14, T.timber, 0, rot); });
      q = P(0, 0, 0); M.box(q[0], 1.6, q[2], 1.7, .08, .08, T.timber, 0, rot); M.box(q[0], 1.1, q[2], .22, .26, .22, T.timber, 0, rot);
      roof(0, 2, 2.2, .6, 1.4, e.col); top = 2.8;
    } else if (e.kind === 'forge') {
      M.box(x, 0, z, 3, .4, 2.2, T.stoneDark, 0, rot); M.box(x, .4, z, 2.8, 1.5, 2, T.stone, 0, rot);
      roof(0, 1.9, 3.1, .9, 2.4, T.roof);
      q = P(1, 0, -.4); M.box(q[0], 1.5, q[2], .45, 1.9, .45, T.stoneDark, 0, rot);
      q = P(-.6, 0, 1.02); M.box(q[0], .55, q[2], .6, .45, .04, warm ? T.lamp : T.iron, warm ? 1 : 0, rot);
      if (warm) { W.addGlow(s.glow, [q[0], .8, q[2]], T.lamp, .6, 2.2); s.pools.push([q[0], q[2], 1.8, T.lamp, .45]); }
      q = P(.6, 0, 1.75); M.box(q[0], 0, q[2], .3, .42, .3, T.stoneDark, 0, rot); M.box(q[0], .42, q[2], .62, .16, .26, T.iron, 0, rot);
      top = 3.5;
    } else if (e.kind === 'mill') {
      M.cyl(x, 0, z, 1.15, 2.8, 10, T.stone, 0, .85, true); M.cone(x, 2.8, z, 1.05, 1.1, 10, T.roof, 0, true); M.cone(x, 3.2, z, .7, .72, 10, T.snow, G.SNOW, true);
      q = P(0, 0, .95); M.box(q[0], 2.35, q[2], .26, .26, .3, T.timber, 0, rot);
      var hub = 2.48, sail = G.mix(T.snow, T.timber, .3);
      for (i = 0; i < 4; i++) {
        var th = i * Math.PI / 2 + .45, cx = Math.cos(th), cy = Math.sin(th), hw = .22, r0 = .25, r1 = 1.9;
        var a = V(cx * r0 - cy * hw, hub + cy * r0 + cx * hw, 1.12), b = V(cx * r1 - cy * hw, hub + cy * r1 + cx * hw, 1.12), c = V(cx * r1 + cy * hw, hub + cy * r1 - cx * hw, 1.12), d = V(cx * r0 + cy * hw, hub + cy * r0 - cx * hw, 1.12);
        M.quad(a, b, c, d, sail); M.quad(d, c, b, a, sail);
      }
      q = P(0, 0, 1.05); M.box(q[0], 0, q[2], .7, 1.1, .05, T.timber, 0, rot); top = 4.6;
    } else if (e.kind === 'oven') {
      M.cyl(x, 0, z, 1.25, .95, 12, T.stone, 0, .6, true); M.cone(x, .95, z, .6, .4, 12, T.stone, 0, true); M.cone(x, 1.02, z, .5, .34, 12, T.snow, G.SNOW, true);
      q = P(0, 0, 1.12); M.box(q[0], .12, q[2], .52, .42, .06, warm ? T.lamp : T.iron, warm ? 1 : 0, rot);
      if (warm) { W.addGlow(s.glow, [q[0], .35, q[2]], T.lamp, .55, 2); s.pools.push([q[0], q[2], 1.6, T.lamp, .4]); }
      q = P(-.3, 0, -.55); M.cyl(q[0], .6, q[2], .14, 1.4, 6, T.stoneDark);
      for (i = 0; i < 6; i++) { q = P(1.45, 0, -.5 + (i % 3) * .42); M.box(q[0], Math.floor(i / 3) * .3, q[2], .9, .28, .36, T.trunk, 0, rot); }
      top = 2.4;
    } else {   // granary
      [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(function (f) { var r = P(f[0] * 1, 0, f[1] * .7); M.cyl(r[0], 0, r[2], .09, .62, 6, T.stoneDark); M.cyl(r[0], .62, r[2], .24, .08, 8, T.stone); });
      q = P(0, 0, 0); M.box(q[0], .7, q[2], 2.4, 1.45, 1.7, T.timber, 0, rot);
      q = P(0, 0, .87); M.box(q[0], .9, q[2], .6, .95, .04, T.iron, 0, rot);
      roof(0, 2.15, 2.8, 1, 2.2, T.straw); top = 3.4;
    }
    q = P(1.65, 0, 1.3); M.cyl(q[0], 0, q[2], .04, 1.6, 5, T.iron);
    M.box(q[0], 1.6, q[2], .2, .26, .2, warm ? e.col : T.iron, warm ? 1 : 0, rot);
    if (warm) { W.addGlow(s.glow, [q[0], 1.73, q[2]], e.col, .7, 2.4); s.pools.push([q[0], q[2], 2.2, e.col, .5]); }
    for (i = 0; i < crates(e); i++) {
      q = P(-1.6 + (i % 3) * .56, 0, 1.6 + Math.floor((i % 6) / 3) * .56);
      var cy = Math.floor(i / 6) * .49;
      M.box(q[0], cy, q[2], .48, .48, .48, G.mix(T.straw, T.timber, i % 2 ? .45 : .2), 0, rot);
      if (i + 6 >= crates(e)) M.box(q[0], cy + .48, q[2], .5, .04, .5, T.snow, G.SNOW, rot);   // snow on the top of each stack
    }
    s.occ.push([x, z, 3.4, 2.8, rot, .6]);
    w.top = top;
  }
  /* A villager at a workshop's door, at work: bending to it, with what the work gives off
     (sparks at the forge, steam at the well and the oven, dust at the rest). */
  function working(M, s, w, dt) {
    var so = w.shop, p = so.front, dir = Math.atan2(so.pos[0] - p[0], so.pos[2] - p[2]), k = w.work;
    villager(M, p, dir, w.col, Math.abs(Math.sin(k * 7)) * .1, w.seed, 0);
    if (reduced) return;
    var q = [p[0] + (so.pos[0] - p[0]) * .3, 0, p[2] + (so.pos[2] - p[2]) * .3], kind = so.e.kind;
    if (kind === 'forge') for (var i = 0; i < 5; i++) {
      var f = (k * 2.6 + i / 5) % 1, a = i * 2.4 + Math.floor(k * 2.6) * 1.7;
      W.addGlow(W.glow, [q[0] + Math.cos(a) * f * .8, .7 + f * 1.2 - f * f * 1.3, q[2] + Math.sin(a) * f * .8], T.lamp, (1 - f) * .8, .6);
    }
    else if (Math.random() < (kind === 'well' || kind === 'oven' ? 5 : 2.5) * dt) smoke.push({ p: [q[0], kind === 'oven' ? 1.3 : .5, q[2]], t: 0, s: Math.random() });
  }
  /* Steps in the snow from a to b: as many as came (up to a few dozen), spread as wide as the way is worn. */
  function prints(M, a, b, k, n, seed, y) {
    var dx = b[0] - a[0], dz = b[2] - a[2], L = Math.hypot(dx, dz) || 1, rot = Math.atan2(dx, dz), ux = dx / L, uz = dz / L, steps = Math.min(40, n);
    for (var i = 0; i < steps; i++) {
      var t = (i + rand(seed, i)) / steps, side = (i % 2 ? 1 : -1) * (.1 + rand(i, seed) * (.08 + .5 * clamp(k, 0, 1)));
      M.flat(a[0] + dx * t - uz * side, y, a[2] + dz * t + ux * side, .13, .25, G.mix(T.path, T.stoneDark, .5), 0, rot);
    }
  }
  /* The way to a door: as wide and as worn as the page is busy today. */
  function track(M, a, b, k, n, seed) {
    var dx = b[0] - a[0], dz = b[2] - a[2], L = Math.hypot(dx, dz), rot = Math.atan2(dx, dz); k = clamp(k, 0, 1);
    M.flat((a[0] + b[0]) / 2, .022, (a[2] + b[2]) / 2, .45 + 1.4 * Math.sqrt(k), L + .4, G.mix(T.snow2, T.path, .3 + .7 * k), 0, rot);
    prints(M, a, b, k, n, seed, .03);
  }
  /* A hip roof (four slopes, a short ridge along local x), or a gable one (`G.Mesh.roof`). */
  function hip(M, cx, y0, cz, L, D, h, col, rot, over, em) {
    var P = G.frame(cx, cz, rot), x = L / 2 + over, z = D / 2 + over, r = Math.max(0, x - z), y1 = y0 + h;
    M.quad(P(-x, y0, z), P(x, y0, z), P(r, y1, 0), P(-r, y1, 0), col, em);
    M.quad(P(x, y0, -z), P(-x, y0, -z), P(-r, y1, 0), P(r, y1, 0), col, em);
    M.tri(P(x, y0, z), P(x, y0, -z), P(r, y1, 0), col, em);
    M.tri(P(-x, y0, -z), P(-x, y0, z), P(-r, y1, 0), col, em);
  }
  /* A timber-framed house: a stone ground floor, each storey above on its beam and a little wider,
     a steep roof, and windows on every side, so the used share reads from wherever the camera
     is. The storeys are today's pageviews; a brass band round the front is yesterday's, up to
     this time (on a rod over the roof when yesterday was taller). A page nobody opened today is
     one storey, shuttered, its lamp out. What is not a count varies by the page's seed, so no
     two houses are alike: the width, the roof (gable or hip), the colour of door and shutters,
     and one thing by the door (a balcony, a woodpile, a bench). */
  function house(M, s, h, dark) {
    var t = h.t, k = s.kit, awake = t.pv > 0, f = awake ? floors(t) : 1, rot = -h.a - Math.PI / 2, P = G.frame(h.pos[0], h.pos[2], rot), x0 = h.pos[0], z0 = h.pos[2];
    var warm = warmOf(t), lit = dark == null ? f : Math.floor(f * (1 - dark)), y = 0, sd = h.seed;
    var w = (k.narrow ? 1.8 : 2.3) + rand(sd, 21) * .7, d = 2 + rand(sd, 22) * .4, ww = w, dd = d, wx = w * .24, shut = T.shutters[Math.floor(rand(sd, 23) * T.shutters.length)];
    var hipped = rand(sd, 24) < k.hip, extra = Math.floor(rand(sd, 25) * 4);
    function win(x, wy, nx, nz, half, on, pool) {   // (nx, nz): the wall's outward normal in the house's frame; x along the wall
      var ax = nz ? x : nx * half, az = nz ? nz * half : x, a = P(ax, 0, az), b = P(ax + nx * .02, 0, az + nz * .02), c = P(ax + nx * .06, 0, az + nz * .06);
      M.box(a[0], wy - .03, a[2], nz ? .5 : .04, .56, nz ? .04 : .5, T.timber, 0, rot);
      M.box(b[0], wy, b[2], nz ? .38 : .03, .46, nz ? .03 : .38, !awake ? shut : on ? T.window : T.windowDark, on ? 1 : awake ? .35 : 0, rot);
      M.box(c[0], wy - .06, c[2], nz ? .56 : .14, .07, nz ? .14 : .56, T.snow, G.SNOW, rot);
      if (on) { var g = P(ax + nx * .25, 0, az + nz * .25); W.addGlow(s.glow, [g[0], wy + .23, g[2]], T.window, .16, 1.4); if (pool) { var pl = P(ax + nx * 1.1, 0, az + nz * 1.1); s.pools.push([pl[0], pl[2], 1.5, T.window, .5]); } }
    }
    M.box(x0, 0, z0, w + .16, .5, d + .16, T.stoneDark, 0, rot);
    for (var j = 0; j < f; j++) {
      var jut = Math.min(j, 2) * .12; ww = w + jut; dd = d + jut;
      M.box(x0, y + (j ? 0 : .5), z0, ww, FLOOR - (j ? 0 : .5), dd, j === 0 ? T.stone : h.wall, 0, rot);
      if (j && !k.frame) M.box(x0, y, z0, ww + .06, .08, dd + .06, G.mix(h.wall, T.stoneDark, .35), 0, rot);   // a stone course
      if (j && k.frame) {
        M.box(x0, y, z0, ww + .1, .12, dd + .1, T.timber, 0, rot);
        [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 1], [0, -1]].forEach(function (c) { var p = P(c[0] * ww / 2, 0, c[1] * dd / 2); M.box(p[0], y + .12, p[2], .09, FLOOR - .12, .09, T.timber, 0, rot); });
      }
      var on = awake && j < lit && j < warm, wy = y + .32;
      if (j) win(-wx, wy, 0, 1, dd / 2 + .02, on, true);
      win(wx, wy, 0, 1, dd / 2 + .02, on, true); win(-wx, wy, 0, -1, dd / 2 + .02, on, false); win(wx, wy, 0, -1, dd / 2 + .02, on, true);
      win(0, wy, 1, 0, ww / 2 + .02, on, false); win(0, wy, -1, 0, ww / 2 + .02, on, false);
      if (extra === 0 && j === 1) {   // a balcony under the first floor's front window
        var bp = P(wx, 0, dd / 2 + .3); M.box(bp[0], y, bp[2], .9, .07, .5, T.timber, 0, rot); M.box(bp[0], y + .07, bp[2], .9, .06, .5, T.snow, G.SNOW, rot);
        var rail = P(wx, 0, dd / 2 + .52); M.box(rail[0], y + .07, rail[2], .9, .32, .04, T.timber, 0, rot);
      }
      y += FLOOR;
    }
    var door = P(-wx, 0, d / 2 + .03), lamp = P(-wx, 0, d / 2 + .18);
    M.box(door[0], .5, door[2], .6, .98, .05, shut, 0, rot);
    if (awake && (dark == null || dark < 1)) {
      M.box(lamp[0], 1.6, lamp[2], .16, .2, .16, T.lamp, 1, rot); W.addGlow(s.glow, [lamp[0], 1.7, lamp[2]], T.lamp, .5, 2.2);
      var dp = P(-wx, 0, d / 2 + 1.4); s.pools.push([dp[0], dp[2], 2.4, T.lamp, .55]);
    }
    var heap = P(w / 2 - .15, 0, d / 2 + .5); M.lump(heap[0], 0, heap[2], awake ? .38 : .7, awake ? .3 : .5, 6, T.snow, sd, G.SNOW);
    if (extra === 1) {   // a woodpile against the side wall, under its snow
      var wp = P(w / 2 + .3, 0, -.2); M.box(wp[0], 0, wp[2], .45, .55, 1.2, T.trunk, 0, rot); M.box(wp[0], .55, wp[2], .5, .08, 1.25, T.snow, G.SNOW, rot);
    } else if (extra === 2) {   // a bench by the door
      var bn = P(wx * .3 + .4, 0, d / 2 + .35); M.box(bn[0], .28, bn[2], .7, .07, .24, T.timber, 0, rot); M.box(bn[0], .35, bn[2], .7, .05, .24, T.snow, G.SNOW, rot);
      [-.28, .28].forEach(function (e) { var l = P(wx * .3 + .4 + e, 0, d / 2 + .35); M.box(l[0], 0, l[2], .06, .28, .2, T.timber, 0, rot); });
    }
    /* the roof, its ridge from front to back */
    var rl = dd + .14, rs = ww + .14, rh = (hipped ? .82 : 1) * k.roofH, r2 = rot + Math.PI / 2;
    if (hipped) {
      hip(M, x0, y, z0, rl, rs, rh, T.roof, r2, .3); if (k.roofSnow !== false) hip(M, x0, y + .11, z0, rl - .06, rs, rh + .02, T.snow, r2, .22, G.SNOW);
    } else {
      M.roof(x0, y, z0, rl, rh, rs, T.roof, r2, .3, h.wall);
      if (k.roofSnow !== false) M.roof(x0, y + .11, z0, rl - .06, rh + .02, rs, T.snow, r2, .22, null, G.SNOW);
      [1, -1].forEach(function (e) { var a = P(0, 0, e * (dd / 2 + .02)); M.box(a[0], y + .28, a[2], .34, .4, .04, awake && lit > 0 && warm > 0 ? T.window : T.windowDark, awake && lit > 0 && warm > 0 ? 1 : .3, rot); });
    }
    [-1, 1].forEach(function (e) { var p = P(e * (rs / 2 + .26), 0, 0); M.box(p[0], y - .03, p[2], .2, .15, rl + .5, T.snow, G.SNOW, rot); });
    var ch = P(w * .29, 0, -.3); M.box(ch[0], y + .3, ch[2], .36, 1.5, .36, T.stoneDark, 0, rot); M.box(ch[0], y + 1.8, ch[2], .44, .1, .44, T.snow, G.SNOW, rot);
    /* yesterday: a brass band at the top of its storeys, or over the roof on a rod */
    var yf = t.ypv ? Math.max(1, Math.ceil(t.ypv / scale.unit)) : 0;
    if (yf && yf <= f) M.box(x0, yf * FLOOR - .05, z0, w + Math.min(yf - 1, 2) * .12 + .2, .08, d + Math.min(yf - 1, 2) * .12 + .2, T.brass, .3, rot);
    else if (yf) {
      var top = y + rh, my = yf * FLOOR + rh, rp = P(-w * .3, 0, 0);
      M.cyl(rp[0], top - .3, rp[2], .025, my - top + .3, 5, T.brass, .2); M.cyl(rp[0], my, rp[2], .2, .06, 10, T.brass, .3);
    }
    h.chimney = awake ? [ch[0], y + 1.9, ch[2]] : null; h.top = y + .4; h.door = P(-wx, 0, d / 2 + .9);
    s.occ.push([x0, z0, w + 1.3, d + 1.3, rot, .6]);
    var a0 = at(s.o, h.a, h.ring.from), b0 = at(s.o, h.a, h.ring.r - 1.3);
    track(M, a0, b0, t.pv / (scale.unit * 6), t.pv, sd);
  }
  /* A stall with no garland: its lanterns stand on a pole beside it, one lit per `scale.view`
     opens today from the ground up, so a stall's count reads as a house's storeys do. Shut and
     dark when nobody opened it. */
  function stall(M, s, st, dark) {
    var v = st.v, k = st.k, rot = Math.PI / 2 - st.a, x = st.pos[0], z = st.pos[2], P = G.frame(x, z, rot), open = v.n > 0;
    var n = dark == null ? lit(v) : Math.floor(lit(v) * (1 - dark));
    M.box(x, 0, z, 1.6, .55, .7, T.timber, 0, rot);
    M.box(x, .55, z, 1.76, .07, .86, G.mix(T.timber, T.snow, .3), 0, rot);
    if (open) [-.5, 0, .5].forEach(function (gx, i) { var g = P(gx, 0, .04); M.box(g[0], .62, g[2], .34, .16 + rand(k, i) * .16, .36, T.walls[(k + i * 3) % T.walls.length], 0, rot); });
    else { var sh = P(0, 0, .38); M.box(sh[0], .62, sh[2], 1.6, .8, .05, T.timber, 0, rot); }
    [[-.8, -.36], [.8, -.36], [-.8, .44], [.8, .44]].forEach(function (c) { var p = P(c[0], 0, c[1]); M.cyl(p[0], 0, p[2], .05, 1.62, 5, T.timber); });
    var c = P(0, 0, .04);
    M.roof(c[0], 1.6, c[2], 1.76, .5, .96, T.awnings[k % 4], rot, .16, T.awnings[(k + 1) % 4]);
    M.roof(c[0], 1.7, c[2], 1.62, .44, .56, T.snow, rot, .05, null, G.SNOW);
    if (open && dark !== 1) { var lp = P(0, 0, .34); M.box(lp[0], 1.28, lp[2], .15, .2, .15, T.lamp, 1, rot); W.addGlow(s.glow, [lp[0], 1.38, lp[2]], T.lamp, .4, 1.9); s.pools.push([st.front[0], st.front[2], 1.9, T.lamp, .5]); }
    s.occ.push([x, z, 2.2, 1.5, rot, .55]);
    var pp = P(1.08, 0, .3);
    M.cyl(pp[0], 0, pp[2], .12, .14, 6, T.stoneDark); M.cyl(pp[0], 0, pp[2], .04, .5 + GARLAND * .36, 5, T.iron);
    for (var j = 0; j < GARLAND; j++) {
      var y = .5 + j * .36;
      if (j < n) { M.box(pp[0], y, pp[2], .25, .29, .25, T.view, 1, rot); M.box(pp[0], y + .29, pp[2], .3, .04, .3, T.iron, 0, rot); W.addGlow(s.glow, [pp[0], y + .14, pp[2]], T.view, .5, 1.7); }
      else M.box(pp[0], y + .13, pp[2], .13, .04, .13, T.iron, 0, rot);
    }
    if (n) s.pools.push([pp[0], pp[2], 1.2 + n * .25, T.view, .3 + n * .05]);
  }
  /* The wall round the village, in its kit's kind: tall enough to read as a
     wall from the valley, with towers along it; the gates stand in its gaps. */
  function wallKind(s) { return s.kit.wall; }
  function wallH(s) { return { rampart: 2.3, battlement: 2.3, palisade: 2.6, iron: 2.4 }[wallKind(s)]; }
  function wall(M, s) {
    var R = s.R, o = s.o, kind = wallKind(s), H = wallH(s), n = Math.round(R.wall * TAU / (kind === 'palisade' ? .42 : kind === 'iron' ? .5 : 1.1)), len = R.wall * TAU / n;
    function gap(a, room) { return s.gates.some(function (g) { return angDiff(a, g.a) * R.wall < g.w / 2 + room; }); }
    var stone = function (k) { return G.mix(T.stone, T.stoneDark, rand(k, 6) * .7); };
    for (var k = 0; k < n; k++) {
      var a = (k + .5) / n * TAU, p = at(o, a, R.wall);
      if (gap(a, .8)) continue;
      if (kind === 'rampart' || kind === 'battlement') {
        M.box(p[0], 0, p[2], 1.1, H, len + .05, stone(k), 0, -a);   // the wall, a walk on top behind a parapet
        M.box(p[0], H, p[2], 1.15, .12, len + .06, T.snow, G.SNOW, -a);
        var q = at(o, a, R.wall + .42), merl = kind === 'battlement' || k % 2;
        if (merl) { M.box(q[0], H, q[2], .3, .55, len * (kind === 'battlement' ? .55 : 1.02), stone(k + 3), 0, -a); M.box(q[0], H + .55, q[2], .34, .08, len * .56, T.snow, G.SNOW, -a); }
      } else if (kind === 'palisade') {
        var ph = H + rand(k, 2) * .45; M.cyl(p[0], 0, p[2], .21, ph, 6, T.timber); M.cone(p[0], ph, p[2], .21, .42, 6, T.timber);
        if (k % 3 === 0) M.box(p[0] - Math.cos(a) * .25, H * .55, p[2] - Math.sin(a) * .25, .12, .18, len * 3.1, T.trunk, 0, -a);   // the rail behind
      } else if (kind === 'iron') {
        M.box(p[0], 0, p[2], .5, .35, len + .04, T.stoneDark, 0, -a); M.box(p[0], .35, p[2], .56, .07, len + .05, T.snow, G.SNOW, -a);
        M.cyl(p[0], .35, p[2], .03, H - .35, 4, T.iron); M.cone(p[0], H, p[2], .07, .3, 4, T.iron);
        if (k % 2 === 0) { M.box(p[0], H * .55, p[2], .04, .05, len * 2.02, T.iron, 0, -a); M.box(p[0], H - .25, p[2], .04, .05, len * 2.02, T.iron, 0, -a); }
      }
    }
    /* the towers along it, kept clear of the gates */
    var m = Math.max(6, Math.round(R.wall * TAU / 11));
    for (var t = 0; t < m; t++) {
      var ta = (t + .5) / m * TAU, tp = at(o, ta, R.wall); if (gap(ta, 2)) continue;
      if (kind === 'palisade') { M.box(tp[0], 0, tp[2], 1.5, H + 1.7, 1.5, T.timber, 0, -ta); M.cone(tp[0], H + 1.7, tp[2], 1.3, 1.1, 4, T.roof); M.cone(tp[0], H + 2, tp[2], .9, .8, 4, T.snow, G.SNOW); }
      else if (kind === 'iron') { M.box(tp[0], 0, tp[2], .7, H + .6, .7, T.stoneDark, 0, -ta); M.cone(tp[0], H + .6, tp[2], .45, .7, 4, T.iron); var lp = [tp[0], H + 1.45, tp[2]]; M.box(lp[0], lp[1] - .2, lp[2], .2, .26, .2, T.lamp, 1); W.addGlow(s.glow, lp, T.lamp, .6, 2.4); s.pools.push([tp[0], tp[2], 3, T.lamp, .4]); }
      else {
        M.cyl(tp[0], 0, tp[2], 1.15, H + 1.3, 10, stone(t), 0, null, true); M.cyl(tp[0], H + 1.3, tp[2], 1.2, .1, 10, T.snow, G.SNOW);
        if (kind === 'battlement') { for (var c = 0; c < 8; c += 2) { var ca = c / 8 * TAU, cp = [tp[0] + Math.cos(ca) * 1.02, 0, tp[2] + Math.sin(ca) * 1.02]; M.box(cp[0], H + 1.3, cp[2], .32, .45, .32, stone(c), 0, -ca); } }
        else { M.cone(tp[0], H + 1.3, tp[2], 1.4, 1.7, 10, T.roof, 0, true); if (s.kit.roofSnow !== false) M.cone(tp[0], H + 1.75, tp[2], 1.05, 1.25, 10, T.snow, G.SNOW, true); }
      }
      s.occ.push([tp[0], tp[2], 2.4, 2.4, 0, .5]);
    }
  }
  /* The colour an icon is drawn on, when it brings its own (an opaque square): its corners; null
     for an icon on a transparent ground. */
  var GROUND = {};
  function groundOf(img) {
    if (img.src in GROUND) return GROUND[img.src];
    var c = document.createElement('canvas'); c.width = c.height = 16; var x = c.getContext('2d'); x.drawImage(img, 0, 0, 16, 16);
    var d = x.getImageData(0, 0, 16, 16).data, r = 0, g = 0, b = 0, a = 0;
    [[0, 0], [15, 0], [0, 15], [15, 15], [1, 1], [14, 14]].forEach(function (p) { var k = (p[1] * 16 + p[0]) * 4; r += d[k]; g += d[k + 1]; b += d[k + 2]; a += d[k + 3]; });
    return (GROUND[img.src] = a / 6 > 200 ? [r / 6 / 255, g / 6 / 255, b / 6 / 255] : null);
  }
  /* The icon cut to what is drawn on it (its ground, or its transparent margin, trimmed away; a
     little room kept), as a square image of its own, so a small mark on a big ground fills the
     banner. Made once per icon; until it is ready the village keeps its pennant. */
  var FIT = {};
  function fitted(img, s) {
    var have = FIT[img.src];
    if (have) return have.complete && have.naturalWidth ? have : null;
    var n = 128, c = document.createElement('canvas'); c.width = c.height = n; var x = c.getContext('2d'); x.drawImage(img, 0, 0, n, n);
    var d = x.getImageData(0, 0, n, n).data, g = groundOf(img), x0 = n, y0 = n, x1 = -1, y1 = -1;
    for (var y = 0; y < n; y++) for (var i = 0; i < n; i++) {
      var k = (y * n + i) * 4, on = g ? Math.abs(d[k] / 255 - g[0]) + Math.abs(d[k + 1] / 255 - g[1]) + Math.abs(d[k + 2] / 255 - g[2]) > .12 : d[k + 3] > 40;
      if (on) { x0 = Math.min(x0, i); y0 = Math.min(y0, y); x1 = Math.max(x1, i); y1 = Math.max(y1, y); }
    }
    var out = new Image();
    out.onload = function () { s.sig = null; refresh(true); };
    if (x1 < 0) out.src = img.src;
    else {
      var side = Math.max(x1 - x0, y1 - y0) * 1.12, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, c2 = document.createElement('canvas'); c2.width = c2.height = 256;
      c2.getContext('2d').drawImage(c, cx - side / 2, cy - side / 2, side, side, 0, 0, 256, 256);
      c2.toBlob(function (b) { if (b) out.src = URL.createObjectURL(b); });   // a blob: the CSP takes blob: images, not data:
    }
    FIT[img.src] = out; return null;
  }
  /* Over the tower: with the site's icon, a long banner hung from a gold crossbar, its tail cut in
     two, on the icon's own ground (or a dark cloth in the kit's colours), the icon trimmed and high
     on it and a thin band in the site's colour under it; without one, a pennant in that colour. */
  function clock(M, s) {
    var o = s.o, y0 = s.spireTop + .6, raw = iconOf(s), img = raw && fitted(raw, s), z = o[2], dim = state.dark || 0;
    if (!img) { M.cyl(o[0], y0, o[2], .03, .9, 4, T.brass); M.quad([o[0], y0 + .85, o[2]], [o[0] + 1.3, y0 + .65, o[2] + .2], [o[0] + 1.3, y0 + .2, o[2] + .2], [o[0], y0 + .25, o[2]], s.tint, .45); return; }
    var cloth = groundOf(raw) || G.mix(T.roof, T.iron, .5), gold = T.brass;
    var BW = 1.7, BH = 3.3, top = y0 + 4, cx = o[0] + .1 + BW / 2, xl = cx - BW / 2, xr = cx + BW / 2, bot = top - BH, notch = bot + .6;
    M.cyl(o[0], y0, o[2], .05, 4.6, 5, gold); M.cone(o[0], y0 + 4.6, o[2], .1, .25, 6, gold);
    M.box(cx, top, z, BW + .5, .09, .09, gold); M.cyl(xl - .25, top - .05, z, .07, .2, 6, gold); M.cyl(xr + .25, top - .05, z, .07, .2, 6, gold);
    M.box(cx, notch, z, BW, top - notch, .05, cloth, .12);
    M.tri([xl, notch, z], [xl, bot, z], [cx, notch, z], cloth, .12); M.tri([cx, notch, z], [xr, bot, z], [xr, notch, z], cloth, .12);
    M.box(cx, top - .2, z, BW, .08, .08, gold, .2); M.box(xl + .04, notch, z, .06, top - notch, .08, gold, .2); M.box(xr - .04, notch, z, .06, top - notch, .08, gold, .2);
    M.box(cx, notch + .25, z, BW * .7, .07, .08, s.tint, .35);
    var I = 1.5, a = [cx - I / 2, top - .35 - I], b = [cx + I / 2, top - .35];
    s.decals.push({ img: img, dim: dim, n: [0, 0, 1], at: [[a[0], a[1], z + .045], [b[0], a[1], z + .045], [b[0], b[1], z + .045], [a[0], b[1], z + .045]] });
    s.decals.push({ img: img, dim: dim, n: [0, 0, -1], at: [[b[0], a[1], z - .045], [a[0], a[1], z - .045], [a[0], b[1], z - .045], [b[0], b[1], z - .045]] });
  }
  /* The hands on the tower's four faces, drawn with what moves, so the kept scene is not drawn
     again for them: the hour hand goes round once a day, like the lamps (midnight at the top);
     the minute hand once an hour, in steps of five. A past day stands at its end. */
  function hands(M, s) {
    var o = s.o, d = new Date(), hr = state.past ? 0 : (d.getUTCHours() + d.getUTCMinutes() / 60) / 24 * TAU, mn = state.past ? 0 : Math.floor(d.getUTCMinutes() / 5) * 5 / 60 * TAU;
    function hand(c, u, th, len, wd) {
      var dir = [Math.sin(th) * u[0], Math.cos(th), Math.sin(th) * u[2]], pr = [Math.cos(th) * u[0] * wd, -Math.sin(th) * wd, Math.cos(th) * u[2] * wd], tip = [c[0] + dir[0] * len, c[1] + dir[1] * len, c[2] + dir[2] * len];
      M.quad([c[0] - pr[0], c[1] - pr[1], c[2] - pr[2]], [c[0] + pr[0], c[1] + pr[1], c[2] + pr[2]], [tip[0] + pr[0], tip[1] + pr[1], tip[2] + pr[2]], [tip[0] - pr[0], tip[1] - pr[1], tip[2] - pr[2]], T.iron, 0);
    }
    [[0, 1], [0, -1], [1, 0], [-1, 0]].forEach(function (f) {
      var c = [o[0] + f[0] * 1.06, 5.79, o[2] + f[1] * 1.06], u = [f[1], 0, -f[0]];
      hand(c, u, hr, .26, .045); hand(c, u, mn, .4, .028);
    });
  }
  /* A villager with legs, a coat, a scarf in the colour of the gate they came through, and a hat. */
  function villager(M, p, dir, col, bob, seed, d) {
    var P = G.frame(p[0], p[2], dir), sw = Math.sin((d || 0) * 5) * .07, l = P(-.07, 0, sw), r = P(.07, 0, -sw);
    M.box(l[0], 0, l[2], .08, .24, .09, T.coat, 0, dir); M.box(r[0], 0, r[2], .08, .24, .09, T.coat, 0, dir);
    M.cyl(p[0], .2 + bob, p[2], .19, .42, 7, G.mix(T.coat, col, .2), 0, .13, true);
    M.cyl(p[0], .6 + bob, p[2], .15, .09, 7, col, .35);
    M.cyl(p[0], .68 + bob, p[2], .11, .19, 7, T.skin, 0, .1, true);
    M.cyl(p[0], .85 + bob, p[2], .15, .03, 7, seed > .5 ? col : T.coat); M.cone(p[0], .87 + bob, p[2], .12, .17, 7, seed > .5 ? col : T.coat, 0, true);
    var lh = P(.24, 0, .14);
    M.cyl(lh[0], .34 + bob, lh[2], .01, .14, 3, T.iron); M.box(lh[0], .24 + bob, lh[2], .1, .12, .1, T.lamp, 1);
    W.addGlow(W.glow, [lh[0], .3 + bob, lh[2]], T.lamp, .9, 1.5);
    W.spot([lh[0], Math.max(.07, hf(lh[0], lh[2]) + .06), lh[2]], .5, 2.6, G.scale(T.lamp, .9));
  }

  /* One village into its own layer, with its own pools, footprints, glows and labels: a visit
     to one site draws that one again, never the valley. A label a village had before keeps its
     element. */
  function village(s, dark) {
    if (!s.layer) s.layer = W.layer();
    var M = s.layer.mesh, o = s.o, hourNow = state.past ? 24 : new Date().getUTCHours(), old = s.labels, pines = [];   // a day that ended has every lamp lit, none of them the hour's
    M.clear(); s.pools = []; s.occ = []; s.glow = []; s.labels = {}; s.decals = []; var K = s.kit;
    function labelAt(key, p, cls, show) {
      var L = old[key];
      if (L) { delete old[key]; L.p = p; L.show = show; } else L = W.label(p, '', cls, show);
      s.labels[key] = L; return L;
    }
    var R = s.R;
    { M.disc(o[0], .03, o[2], R.pave, 48, G.mix(T.stone, T.stoneDark, .22)); for (var cr = 1.9; cr < R.pave - .5; cr += 1.9) M.ring(o[0], .034, o[2], cr, cr + .05, 48, G.mix(T.stone, T.stoneDark, .7)); }
    M.ring(o[0], .05, o[2], R.pave, R.pave + .3, 48, T.stoneDark); M.ring(o[0], .02, o[2], R.pave + .3, R.pave + 2, 48, T.path);
    // the clock tower
    M.box(o[0], 0, o[2], 2.6, .5, 2.6, T.stoneDark); M.box(o[0], .5, o[2], 2.2, 3.4, 2.2, T.stone);
    M.box(o[0], 3.9, o[2], 2.4, .16, 2.4, T.timber); M.box(o[0], 4.06, o[2], 1.9, 3.3, 1.9, G.mix(T.stone, T.snow, .2));
    [[0, 1], [0, -1], [1, 0], [-1, 0]].forEach(function (f) {
      M.box(o[0] + f[0] * .97, 5.25, o[2] + f[1] * .97, f[0] ? .05 : 1.1, 1.1, f[1] ? .05 : 1.1, T.iron);
      M.box(o[0] + f[0], 5.33, o[2] + f[1], f[0] ? .05 : .92, .92, f[1] ? .05 : .92, T.clock, .6);
      W.addGlow(s.glow, [o[0] + f[0] * 1.2, 5.8, o[2] + f[1] * 1.2], T.clock, .35, 3.4);
      s.pools.push([o[0] + f[0] * 4, o[2] + f[1] * 4, 4.5, T.clock, .35]);
    });
    M.box(o[0], 7.36, o[2], 2.3, .14, 2.3, T.timber);
    if (K.spire === 'needle') { M.cone(o[0], 7.5, o[2], 1.5, 6.6, 8, T.roof); M.cone(o[0], 7.5, o[2], 1.52, 1.1, 8, T.snow, G.SNOW); s.spireTop = 14.1; [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (f) { M.cone(o[0] + f[0] * 1.05, 7.5, o[2] + f[1] * 1.05, .28, 1.6, 6, T.roof); }); }
    else if (K.spire === 'iron') {
      M.box(o[0], 7.5, o[2], 1.5, 1.6, 1.5, T.stoneDark); [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(function (f) { M.cone(o[0] + f[0] * .75, 7.5, o[2] + f[1] * .75, .14, 2.4, 5, T.iron); });
      M.cyl(o[0], 8.1, o[2], .4, .7, 10, T.brass, .15, .2, true);
      M.cone(o[0], 9.1, o[2], 1, 5.2, 6, T.roof); M.cyl(o[0], 14.3, o[2], .05, 1.4, 4, T.iron); s.spireTop = 14.3;
    }
    else if (K.spire === 'belfry') {
      [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(function (f) { M.box(o[0] + f[0] * .8, 7.5, o[2] + f[1] * .8, .3, 1.7, .3, T.stone); });
      M.cyl(o[0], 7.75, o[2], .55, .9, 10, T.brass, .15, .28, true); M.box(o[0], 9.2, o[2], 2.2, .18, 2.2, T.stoneDark);
      M.cyl(o[0], 9.38, o[2], 1.05, 1.1, 10, T.roof, 0, .2, true); M.cyl(o[0], 10.48, o[2], .16, .3, 8, T.brass, .3, .02, true); s.spireTop = 10.6;
    } else { M.cone(o[0], 7.5, o[2], 1.75, 3.2, 4, T.roof); M.cone(o[0], 8.5, o[2], 1.2, 2.25, 4, T.snow, G.SNOW); s.spireTop = 10.7; }
    M.cyl(o[0], s.spireTop, o[2], .04, .7, 4, T.brass);
    s.occ.push([o[0], o[2], 3.4, 3.4, 0, .7]);
    if (K.gloom) s.occ.push([o[0], o[2], (R.wall + 6) * 2, (R.wall + 6) * 2, 0, K.gloom * .85, 1, true]);   // the village's own shade, round
    clock(M, s);
    // the 24 hours: today's lamp, yesterday's brass ring (and rod, where today has not reached it)
    s.nowLamp = null;
    s.hours.forEach(function (hh) {
      var a = ang(hh.hour, 24), p = at(o, a, R.post), ht = .55 + 4.6 * hh.today / scale.hour, hy = .55 + 4.6 * hh.yesterday / scale.hour;
      var future = hh.hour > hourNow, now = hh.hour === hourNow;
      lampPost(M, s, p[0], p[2], future ? .7 : ht, !future && dark !== 1, now);
      var from = future ? .7 : ht + .5;
      if (hy > from) M.cyl(p[0], from, p[2], .022, hy - from, 5, T.brass, .2);
      M.cyl(p[0], hy, p[2], .17, .06, 10, T.brass, .3);
      if (!future && dark !== 1) W.addGlow(s.glow, [p[0], ht + .17, p[2]], T.lamp, now ? 0 : .45, 2.2);
      if (now) s.nowLamp = [p[0], ht + .17, p[2]];
      if (hh.hour % 6 === 0) write(labelAt('t' + hh.hour, [o[0] + Math.cos(a) * (R.post + 1.05), .1, o[2] + Math.sin(a) * (R.post + 1.05)], 'v-tick', inside(s)), '<span>' + String(hh.hour).padStart(2, '0') + ':00</span>');
    });
    s.houses.forEach(function (h) {
      house(M, s, h, dark);
      h.label = labelAt('h' + h.t.path, [h.pos[0], h.top + 2.2, h.pos[2]], 'v-house', function (d) { return view.site === s && (!narrow() || h.rank < 4); });
      h.label.what = { kind: 'tower', tower: h.t, s: s };
    });
    // the market: a stall per view
    s.stalls.forEach(function (st) {
      stall(M, s, st, dark);
      st.label = labelAt('v:' + st.v.name, [st.pos[0], 2.5, st.pos[2]], 'v-view', function () { return view.site === s && (!narrow() || st.rank < 3); });
      st.label.what = { kind: 'view', view: st.v, s: s };
    });
    // the workshops: one per event
    s.workshops.forEach(function (w) {
      workshop(M, s, w, dark);
      w.label = labelAt('e:' + w.e.name, [w.pos[0], w.top + .9, w.pos[2]], 'v-event', function () { return view.site === s && (!narrow() || w.rank < 3); });
      w.label.what = { kind: 'event', ev: w.e, s: s };
      w.label.el.style.setProperty('--lane', css(w.e.col));   // CSSOM: the CSP refuses style attributes
    });
    s.houses.forEach(function (h, k) {
      var a = h.a + Math.PI / h.ring.slots, p = at(o, a, h.ring.r + .6);
      if (!s.gates.some(function (g) { return angDiff(a, g.a) < .25; })) pine(M, p[0], 0, p[2], .55 + rand(k, 9) * .25, pines);
    });
    fields(M, s, pines);
    // the wall, a gate per referrer
    M.ring(o[0], .04, o[2], R.wall - .9, R.wall + .9, 96, T.snow2, G.SNOW);
    wall(M, s);
    var busiest = 1; s.lanes.forEach(function (l) { busiest = Math.max(busiest, l.count); });
    s.gates.forEach(function (g) {
      var tan = [-Math.sin(g.a), 0, Math.cos(g.a)]; g.lights = [];
      [-1, 1].forEach(function (sd) {
        var p = [g.pos[0] + tan[0] * sd * (g.w / 2 + .4), 0, g.pos[2] + tan[2] * sd * (g.w / 2 + .4)];
        var gh = wallH(s) + 1.3, gw = 1;
        M.box(p[0], 0, p[2], gw, gh, gw, wallKind(s) === 'palisade' ? T.timber : G.mix(T.stone, T.stoneDark, .4), 0, -g.a);
        M.cone(p[0], gh, p[2], gw, .9, 4, T.roof); if (s.kit.roofSnow !== false) M.cone(p[0], gh + .25, p[2], gw * .65, .62, 4, T.snow, G.SNOW);
        var lp = [p[0] + Math.cos(g.a) * .4, 2.3, p[2] + Math.sin(g.a) * .4];
        M.box(lp[0], lp[1], lp[2], .22, .28, .22, g.col, 1);
        W.addGlow(s.glow, [lp[0], lp[1] + .14, lp[2]], g.col, .8, 2.6); g.lights.push([lp[0], lp[1] + .14, lp[2]]);
        s.pools.push([lp[0] + Math.cos(g.a), lp[2] + Math.sin(g.a), 2.6, g.col, .5]);
      });
      M.box(g.pos[0], Math.max(2.7, wallH(s) + .9), g.pos[2], .3, .25, g.w + 1.4, T.timber, 0, -g.a);
      M.box(g.pos[0] + Math.cos(g.a) * .17, 2.05, g.pos[2] + Math.sin(g.a) * .17, .04, .62, Math.min(1.4, g.w * .6), g.col, .2, -g.a);
      var mid = [(g.pos[0] + g.end[0]) / 2, 0, (g.pos[2] + g.end[2]) / 2], rot = Math.atan2(Math.cos(g.a), Math.sin(g.a));
      M.flat(mid[0], .03, mid[2], g.w, 9.5, T.path, 0, rot);
      var ia = at(o, g.a, R.inner), ib = at(o, g.a, R.wall), im = [(ia[0] + ib[0]) / 2, 0, (ia[2] + ib[2]) / 2];
      M.flat(im[0], .028, im[2], Math.max(1, g.w * .7), R.wall - R.inner, T.path, 0, rot);
      prints(M, g.end, ia, g.l.count / busiest, g.l.count, 50 + s.gates.indexOf(g), .036);
      g.label = labelAt('g' + g.l.key, [g.end[0], 1.4, g.end[2]], 'v-gate', function () { return view.site === s && !narrow(); });
      g.label.what = { kind: 'lane', lane: g.l, s: s };
      g.label.el.style.setProperty('--lane', css(g.col));   // CSSOM: the CSP refuses style attributes
    });
    pines.forEach(function (c) { s.occ.push([c[0], c[1], c[2], c[2], 0, .35]); });
    Object.keys(old).forEach(function (k) { W.unlabel(old[k]); });
    W.upload(s.layer);
  }
  function inside(s) { return function () { return view.site === s; }; }
  /* The snow between the last houses (or workshops) and the wall, where the village's visits
     made it wider than what it is made of needs: stands of pine, sown by the village's place in
     the list, none on a gate's lane or by a workshop. Nothing in them is a count. */
  function fields(M, s, pines) {
    var R = s.R; if (!R.fields) return;
    var o = s.o, r0 = R.fields[0], r1 = R.fields[1], want = Math.round(TAU * (r1 * r1 - r0 * r0) / 2 / 120), sd = 71 + s.idx * 53;
    var placed = s.workshops.map(function (w) { return [w.pos[0], w.pos[2], 3.4]; }), sown = 0, streets = R.shops.map(function (ring) { return ring.street; });
    for (var n = 0; sown < want && n < want * 12; n++) {
      var rr = Math.sqrt(r0 * r0 + rand(sd, n * 4) * (r1 * r1 - r0 * r0)), a = rand(sd, n * 4 + 1) * TAU, half = 1.6 + rand(sd, n * 4 + 2) * 1.2, p = at(o, a, rr);
      if (rr - half < r0 || rr + half > r1) continue;
      if (streets.some(function (st) { return Math.abs(rr - st) < half + 1; })) continue;   // where villagers walk round to a workshop
      if (s.gates.some(function (g) { return angDiff(a, g.a) * rr < g.w / 2 + 1 + half; })) continue;
      if (placed.some(function (q) { return Math.hypot(q[0] - p[0], q[1] - p[2]) < q[2] + half + .6; })) continue;
      placed.push([p[0], p[2], half]); sown++;
      for (var k = 0, many = 2 + Math.floor(rand(n, sd + 1) * 3); k < many; k++) {
        var ka = rand(n, k + 10) * TAU, kr = rand(n, k + 20) * half * .8;
        pine(M, p[0] + Math.cos(ka) * kr, 0, p[2] + Math.sin(ka) * kr, .6 + rand(n, k + 30) * .5, pines);
      }
    }
  }

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
    var a = [state.dark, state.hour, state.past, scale.unit, s.o.join(), s.R.wall, s.R.rings.length, s.loaded], maxN = 1;
    s.towers.forEach(function (t) { a.push(t.path, floors(t), warmOf(t), t.pv > 0, Math.ceil(t.ypv / scale.unit)); });
    s.lanes.forEach(function (l) { maxN = Math.max(maxN, l.count); });
    s.lanes.forEach(function (l) { a.push(l.key, Math.round(24 * l.count / maxN)); });
    s.hours.forEach(function (h) { a.push(Math.round(92 * h.today / scale.hour), Math.round(92 * h.yesterday / scale.hour)); });
    s.views.forEach(function (v) { a.push(v.label, lit(v)); });
    s.shops.forEach(function (e) { a.push(e.name, crates(e)); });
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
      withKit(s, function () { if (s.loaded) layout(s); else { s.houses = []; s.gates = []; s.stalls = []; } village(s, state.dark); });
    });
    if (changed) share();
    paintLabels(); paintHl();
  }
  function share() {
    var pools = [], occ = landOcc.map(function (c) { return [c[0], c[1], c[2], c[2], 0, .35]; }), glow = [], lights = [];
    sites.forEach(function (s) {
      pools = pools.concat(s.pools); occ = occ.concat(s.occ); glow = glow.concat(s.glow);
      /* The lamp of the hour, at the low of its breath: frame() adds the rest as it pulses. */
      if (s.nowLamp && state.dark == null) lights.push({ p: s.nowLamp, r: 6, c: G.scale(s.kit.T && s.kit.T.lamp || T.lamp, NOW_LOW) });
    });
    var decals = []; sites.forEach(function (s) { decals = decals.concat(s.decals); }); W.setDecals(decals);
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
      if (s.sign && s.draft) {   // a site being added: its name, and that it is not saved yet
        if (write(s.sign, '<span class="name">' + esc(s.name) + '</span><span class="row small">not saved yet</span>', s.sign.el.firstChild))
          s.sign.el.firstChild.setAttribute('aria-label', s.name + ': a site not saved yet');
      }
      else if (s.sign) {
        var d = change(s), up = d == null || d >= 0, b = s.sign.el.firstChild;
        if (write(s.sign, '<span class="name">' + (iconOf(s) ? '<img class="ico" alt="" src="' + esc(icons[s.id].src) + '">' : '') + esc(s.name) + '</span>' +
          '<span class="row"><b class="num">' + fmt(s.visitors) + '</b> visitors' + (d == null ? '' : ' <span class="small ' + (up ? 'up' : 'down') + '">' + arrow(d) + '</span>') + '</span>' +
          '<span class="row small">' + signRow(s) + '</span>' +
          (s.loaded && !s.towers.length ? '<span class="row small">' + (state.past ? 'no visits that day' : 'no visits yet') + '</span>' : ''), b))
          b.setAttribute('aria-label', s.name + ': ' + plural(s.visitors, 'visitor', 'visitors') + ' ' + when() + '. Look closer');
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
      s.workshops.forEach(function (w) {
        if (w.label) write(w.label, '<div><span class="p">' + esc(w.e.label) + '</span> <b class="num">' + fmt(w.e.n) + '</b></div>');
      });
    });
  }
  function showTip(h, x, y) {
    if (!tip) return;
    if (!h) { tip.hidden = true; return; }
    var html = '';
    if (h.kind === 'site') html = '<strong>' + esc(h.s.name) + '</strong>' + plural(h.s.visitors, 'visitor', 'visitors') + ' · ' + plural(h.s.pageviews, 'pageview', 'pageviews') + ' ' + when() + (h.s.loads ? ' · ' + pct(h.s.engaged, h.s.loads) + '% used' : '') + '<small>Click to look closer</small>';
    if (h.kind === 'tower') { var t = h.tower; html = '<strong>' + esc(t.label) + '</strong>' + plural(t.pv, 'pageview', 'pageviews') + ' ' + when() + ' · ' + (t.loads ? pct(t.engaged, t.loads) + '% used · ' : '') + plural(t.events, 'event', 'events') +
      '<small>' + plural(t.total, 'pageview', 'pageviews') + ' ' + week() + ' · warm windows: used</small>'; }
    if (h.kind === 'lane') { var l = h.lane; html = '<strong>' + esc(l.label) + '</strong>' + plural(l.count, 'arrival', 'arrivals') + ' ' + when() +
      (l.key === 'direct' ? '<small>No referrer, or a link from the site itself</small>' : ''); }
    if (h.kind === 'view') {
      var v = h.view, from = Object.keys(v.by).sort(function (a, b) { return v.by[b] - v.by[a]; }).slice(0, 3);
      html = '<strong>' + esc(v.label) + '</strong>opened ' + plural(v.n, 'time', 'times') + ' ' + when() + (from.length ? ' · from ' + from.map(function (k) { return esc(k) + ' ' + fmt(v.by[k]); }).join(', ') : '') +
        '<small>A view opened inside a page · ' + plural(v.total, 'time', 'times') + ' ' + week() + '</small>';
    }
    if (h.kind === 'event') {
      var ev = h.ev, by = Object.keys(ev.by).sort(function (a, b) { return ev.by[b] - ev.by[a]; }).slice(0, 3);
      html = '<strong>' + esc(ev.label) + '</strong>done ' + plural(ev.n, 'time', 'times') + ' ' + when() + (by.length ? ' · from ' + by.map(function (k) { return esc(k) + ' ' + fmt(ev.by[k]); }).join(', ') : '') +
        '<small>An event of the site · ' + plural(ev.total, 'time', 'times') + ' ' + week() + '</small>';
    }
    tip.innerHTML = html; tip.hidden = false;
    var r = tip.getBoundingClientRect();
    tip.style.left = Math.max(8, Math.min(x + 16, window.innerWidth - r.width - 8)) + 'px';
    tip.style.top = Math.max(8, y - r.height - 12) + 'px';
  }
  function makeSign(s) {
    var L = W.label(signAt(s), '<button type="button" class="vsign' + (s.draft ? ' draft' : '') + '"></button>', 'v-sign', function () { return view.mode === 'bay' || view.site !== s; });
    s.sign = L;
    L.el.firstChild.style.setProperty('--site', css(s.tint));
    L.el.firstChild.addEventListener('click', function () { if (opts.onEnter && !s.draft) opts.onEnter(s.id); });
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
  /* A lens shifted down, as for a building: the camera still looks down on the villages, and the
     mountains and the sky come into the picture above them. The steeper the camera looks down,
     the less of it: all of it over the valley, about half over one village, none from above. A
     narrow screen keeps the old view. */
  function lens(pitch) { return narrow() ? 0 : clamp(LENS + (pitch - TILT.bay) * 1.5, LENS, 0); }
  function shift() {
    var B = frameBox(), cx = (B.left + B.right) / 2, cy = (B.top + B.bottom) / 2;
    return [cx / B.w * 2 - 1, 1 - cy / B.h * 2 + lens(W.cam.pitch)];
  }
  /* The distance at which a half-width X and a half-height Y fit the gap the panels leave. */
  function fit(X, Y) {
    var B = frameBox(), t = Math.tan(W.cam.fov / 2);
    return Math.max(X * B.h / (t * Math.max(120, B.right - B.left)), Y * B.h / (t * Math.max(120, B.bottom - B.top)));
  }
  function goal() {
    if (view.mode === 'site' && view.site) {
      var o = view.site.o, pitch = narrow() ? .55 : TILT.site, rw = view.site.R.wall;
      return { target: [o[0], 2, o[2]], yaw: .12, pitch: pitch, dist: clamp(fit(rw + 3, (rw + 3) * Math.sin(pitch) + 6) * 1.02 * (1 - lens(pitch) * .8), 24, 200) };
    }
    var x0 = Math.min.apply(null, sites.map(function (s) { return s.o[0] - s.R.wall; }).concat([-16])), x1 = Math.max.apply(null, sites.map(function (s) { return s.o[0] + s.R.wall; }).concat([16]));
    var zs = sites.map(function (s) { return s.o[2]; }), cz = sites.length ? (Math.min.apply(null, zs) + Math.max.apply(null, zs)) / 2 : 0;
    var big = Math.max.apply(null, sites.map(function (s) { return s.R.wall; }).concat([16]));
    var pb = narrow() ? .4 : TILT.bay;
    return { target: [(x0 + x1) / 2, 2, cz], yaw: .08, pitch: pb, dist: clamp(fit((x1 - x0) / 2 + 1, (big + 4) * Math.sin(pb) + 9) * .95 * (1 - lens(pb) * .5), 40, 300) };
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
    sites.forEach(function (s) { withKit(s, function () {   // its lamps and windows in its kit's colours
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
      s.workshops.forEach(function (w) {
        if (w.flash > 0) { busy = true; w.flash = Math.max(0, w.flash - dt * .8); W.addGlow(W.glow, [w.front[0], 1.4, w.front[2]], w.e.col, w.flash, 6); }
      });
      if (s.walkers.length) busy = true;
      s.walkers = s.walkers.filter(function (w) {
        w.d += dt * w.speed; var a = G.along(w.path, w.d);
        if (a.done && w.shop) {   // at the workshop: a moment's work, then the crate
          w.work += dt; if (w.work < WORK_S) { working(M, s, w, dt); return true; }
          worked(s, w.shop); return false;
        }
        if (a.done) { (w.stall || w.h).flash = 1; cue(w.stall ? 'stall' : 'door', s, w.cue); return false; }
        villager(M, a.p, a.dir, w.col, Math.abs(Math.sin(w.d * 5)) * .05, w.seed, w.d);
        if (!reduced && Math.floor(w.d / .42) !== w.step) { w.step = Math.floor(w.d / .42); s.steps.push({ p: a.p, dir: a.dir, side: w.step % 2 ? 1 : -1, t: t }); }
        return true;
      });
    }); });
    smoke = smoke.filter(function (sm) {
      sm.t += dt; var k = sm.t / 5;
      W.puffs.push(sm.p[0] + sm.t * .35 + Math.sin(sm.t + sm.s * 6) * .15, sm.p[1] + sm.t * .55, sm.p[2] - sm.t * .1, T.smoke[0], T.smoke[1], T.smoke[2], .28 * (1 - k) * Math.min(1, sm.t * 3), .5 + sm.t * .5);
      return k < 1;
    });
    /* the steps live villagers left, fading for a minute */
    var foot = G.mix(T.path, T.stoneDark, .5);
    sites.forEach(function (s) {
      s.steps = s.steps.filter(function (st) { return t - st.t < STEPS_S; });
      if (s.steps.length > 600) s.steps.splice(0, s.steps.length - 600);
      s.steps.forEach(function (st) {
        var k = 1 - (t - st.t) / STEPS_S, P = G.frame(st.p[0], st.p[2], st.dir), q = P(st.side * .08, 0, 0);
        M.flat(q[0], .045, q[2], .11, .22, G.mix(T.snow, foot, k), 0, st.dir);
      });
    });
    sites.forEach(function (s) {
      if (s.loaded) hands(M, s);
      if (s.kit.motes && !reduced) for (var i = 0; i < s.kit.motes; i++) {   // motes of pale light drifting over the village
        var r = s.R.house * (.3 + rand(i, 41) * .8), a = rand(i, 42) * TAU + t * .05 * (rand(i, 43) - .5), y = 1.5 + rand(i, 44) * 5 + Math.sin(t * .6 + i) * .6;
        W.addGlow(W.glow, [s.o[0] + Math.cos(a) * r + Math.sin(t * .4 + i * 2) * .8, y, s.o[2] + Math.sin(a) * r], s.kit.T && s.kit.T.mote || T.mote, .5 + .3 * Math.sin(t * 1.3 + i * 5), 1.3);
      }
    });
    var ringed = highlight(M, t);
    return busy || ringed || smoke.length > 0;
  }
  /* What a visit row points at, its house and its gate, or the stall of a view: their labels are
     marked when the row changes (paintHl), and a ring and a glow are drawn round them. Answers
     whether it pulses. */
  function paintHl() {
    var hl = view.hl;
    sites.forEach(function (s) {
      s.houses.forEach(function (h) { var on = !!(hl && hl.site === s.id && 'path' in hl && towerOf(s, hl.path) === h.t); if (h.label) h.label.el.classList.toggle('hl', on); });
      s.gates.forEach(function (g) { var on = !!(hl && hl.site === s.id && 'ref' in hl && laneOf(s, hl.ref) === g.l); if (g.label) g.label.el.classList.toggle('hl', on); });
      s.stalls.forEach(function (st) { var on = !!(hl && hl.site === s.id && 'view' in hl && viewOf(s, hl.view) === st.v); if (st.label) st.label.el.classList.toggle('hl', on); });
      if (s.sign) s.sign.el.classList.toggle('hl', !!(hl && hl.site === s.id));
    });
  }
  function highlight(M, t) {
    var hl = view.hl, pulse = reduced ? 1 : .8 + .2 * Math.sin(t * 4);
    if (!hl) return false;
    var s = byId[hl.site]; if (!s || !s.loaded) return false;
    var ring = s.kit.T && s.kit.T.window || T.window;   // the ring in the kit's own window light
    var t0 = 'path' in hl ? towerOf(s, hl.path) : null, h = t0 && houseOf(s, t0);
    if (h) { M.ring(h.pos[0], .06, h.pos[2], 2.1, 2.35, 32, ring, pulse); W.addGlow(W.glow, [h.pos[0], h.top + 1.6, h.pos[2]], ring, .5 * pulse, 6); }
    var g = 'ref' in hl ? gateOf(s, laneOf(s, hl.ref)) : null;
    if (g && g.lights) g.lights.forEach(function (p) { W.addGlow(W.glow, p, g.col, pulse, 6); });
    var st = 'view' in hl ? stallOf(s, viewOf(s, hl.view)) : null;
    if (st) { M.ring(st.pos[0], .06, st.pos[2], 1.3, 1.5, 28, T.view, pulse); W.addGlow(W.glow, [st.pos[0], 1.7, st.pos[2]], T.view, .5 * pulse, 5); }
    return !reduced;
  }

  /* ---------- pointer ---------- */
  function siteAt(x, y) {
    var best = null, bd = Infinity;
    sites.forEach(function (s) {
      if (s.draft) return;   // nothing to look closer at yet
      var c = W.project([s.o[0], 1, s.o[2]]), e = W.project([s.o[0] + s.R.wall, 0, s.o[2]]); if (!c || !e) return;
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
    /* canvas, { tip, insets() -> {top, bottom, right}, onEnter(id), onLeave(), onCue(name, cue) } */
    init: function (canvas, o) {
      cv = canvas; opts = o || {}; tip = opts.tip || null;
      readTokens();
      overlay = document.createElement('div'); overlay.className = 'scene-labels';
      canvas.parentNode.insertBefore(overlay, canvas.nextSibling);
      try {
        var s0 = skyAt(clockHour());
        W = G.world(canvas, overlay, {
          moonDir: s0.sun, moon: s0.moonlight, skyAmb: s0.skyLight, gndAmb: s0.groundLight, skyTop: s0.skyTop, skyMid: s0.skyMid, skyLow: s0.skyLow, fog: s0.skyLow, fogD: .0062, fogFrom: .85, fogH: 25,
          edge: .3, edgeCol: T.edge, sat: 1, con: .28, vig: .6, grain: .014, poolK: 1.9, minDist: 6, maxDist: 220, box: [-60, -60, 120], ground: T.snow, star: T.star,
          snowCol: T.snow, snowK: .45, sparkK: 1, ao: .6, aoR: .9, bloom: 1, bloomThr: .8, dof: 7, skyTick: 4, auroraA: T.aurora, auroraB: T.aurora2,
        });
      } catch (e) { W = null; fallback(canvas); return; }
      applySky(); setInterval(function () { if (!document.hidden) applySky(); }, SKY_MS);
      document.addEventListener('visibilitychange', function () { if (!document.hidden) applySky(); });
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
      overlay.addEventListener('pointerout', function (e) { if (tip && e.target.closest('.lbl.v-house, .lbl.v-gate, .lbl.v-view, .lbl.v-event')) tip.hidden = true; });
      window.addEventListener('resize', function () { resized(); if (!view.free) frameView(true); });
      /* The counts are looked at twice a second, not in the frame: the villages that are due, the
         turn of the hour, the numbers on the labels. */
      setInterval(function () { if (!document.hidden) { refresh(); paintLabels(); } }, 500);
      frameView(true);
    },
    /* [{id, name, style, tint, hue, shade, draft?}], in the order the API lists them: one village
       each, in that order. One with `draft` is a site being added: it stands on the next lot, says
       so on its sign, and nobody walks in; the next call without it takes it away. */
    setSites: function (list) {
      var was = view.site && view.site.id, old = byId;
      sites = list.map(function (s, i) { var k = old[s.id]; if (k) { k.idx = i; k.name = s.name; k.draft = !!s.draft; dress(k, s); return k; } return makeSite(s, i); });
      byId = {}; sites.forEach(function (s) { byId[s.id] = s; });
      if (was && !byId[was]) { view.site = null; view.mode = 'bay'; }
      sizeAll();   // the order between the villages, for the list as it is now
      if (!W) return;
      Object.keys(old).forEach(function (id) {
        var s = old[id]; if (byId[id]) return;
        Object.keys(s.labels).forEach(function (k) { W.unlabel(s.labels[k]); });
        if (s.sign) W.unlabel(s.sign); if (s.layer) W.dropLayer(s.layer);
      });
      place(); buildLand();
      sites.forEach(function (s) {
        if (!s.sign) makeSign(s);
        s.sign.p = signAt(s); s.sign.el.firstChild.style.setProperty('--site', css(s.tint)); s.sig = null;
      });
      refresh(true); share(); resized(); frameView(true);
    },
    load: function (id, data) { var s = byId[id]; if (s) load(s, data); },
    /* The kits a village can be built in (the Sites panel's Surprise me picks among them). */
    styles: function () { return Object.keys(KIT); },
    /* The pieces and their options, for the Sites panel's selects and its Surprise me. */
    pieces: function () { var o = {}; Object.keys(PIECES).forEach(function (k) { o[k] = Object.keys(PIECES[k]); }); return o; },
    /* A site's look as the owner tries one in the Sites panel: its village is dressed again there
       and then, nothing else about it changes. */
    restyle: function (id, look) {
      var s = byId[id]; if (!s) return;
      if (look.name) s.name = look.name;
      dress(s, look);
      if (!W) return;
      refresh(true); W.relabel(); W.wake();
    },
    /* A site's icon, as a URL the page may load (a blob: app.js fetched with the token): on its
       banner and its sign once it is loaded. */
    setIcon: function (id, url) {
      var was = icons[id], im = new Image();
      if (was && was.src.indexOf('blob:') === 0) URL.revokeObjectURL(was.src);
      if (!url) {   // taken away (the Sites panel): the pennant again
        delete icons[id]; var s = byId[id];
        if (s) { s.sig = null; if (s.sign) { s.sign.html = null; s.sign.p = signAt(s); } refresh(true); if (W) W.relabel(); }
        return;
      }
      im.onload = function () { var s = byId[id]; if (!s) return; s.sig = null; if (s.sign) { s.sign.html = null; s.sign.p = signAt(s); } refresh(true); if (W) W.relabel(); };
      im.src = url; icons[id] = im;
    },
    /* The day the counts given next belong to: a past day (anything truthy), or today (null). A
       past day is drawn as it ended: every lamp lit, nobody walking in. */
    setDay: function (day) { state.past = !!day; },
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
      if (!state.blackout) { state.blackout = { t0: performance.now(), dur: reduced ? 1 : BLACKOUT_MS, done: done }; cue('midnight'); }
      W.wake();
    },
    /* Rings one visit's house and gate ({ site, path, ref }), a view's house and stall
       ({ site, path, view }), or nothing (null). */
    highlight: function (h) { view.hl = h || null; paintHl(); if (W) W.wake(); },
    /* The colour the visits panel shares with the scene: a referrer's gate in a site (direct for
       none; a referrer with no gate yet gets the first gate colour). As CSS rgb(). */
    laneColor: function (id, ref) { var s = byId[id]; var l = s && s.loaded ? laneOf(s, ref) : null; return css(l ? l.color : ref == null ? T.direct : T.lanes[0]); },
    /* One page's counts today, from its house: { pv, loads, engaged }, or null for a page with no house. */
    pageStats: function (id, path) { var s = byId[id], t = s && s.loaded ? towerOf(s, path) : null; return t ? { pv: t.pv, loads: t.loads, engaged: t.engaged } : null; },
    stats: function (id) {
      var list = id ? [byId[id]].filter(Boolean) : sites;
      return list.reduce(function (t, s) { t.visitors += s.visitors; t.pageviews += s.pageviews; t.views += s.viewsToday; t.events += s.events; t.other += otherEvents(s); return t; },
        { visitors: 0, pageviews: 0, views: 0, events: 0, other: 0 });
    },
  };
})();
