/* The bay: every site is a district on the shore of one bay at night, every page a tower, all on
   one scale, so the tallest district is the busiest today. Warm windows, from the ground up, are
   the share of loads that were used; cool ones the rest. Every live hit is a light on the shore
   road that turns into its district. Click a district and the camera closes in on its skyline:
   the towers from busiest to quietest, a lane per referrer, every hit a car with a trail in its
   lane's colour, every event a searchlight. At UTC midnight (the day's cut) the windows go dark
   and the day starts again. A classic script on a 2D canvas, no dependencies; every colour comes
   from tokens.css. app.js feeds it (/api/scene, the live socket). */
(function () {
  'use strict';

  var TAU = Math.PI * 2;
  var LIVE_WINDOW = 5 * 60 * 1000;
  var ZOOM_MS = 900, BLACKOUT_MS = 4200;
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var ease = function (t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
  function noise(a, b) { var x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); }
  var reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(n) { return (n || 0).toLocaleString('en'); }
  function plural(n, one, many) { return fmt(n) + ' ' + (n === 1 ? one : many); }
  function pct(a, b) { return b ? Math.min(100, Math.round(100 * a / b)) : 0; }

  /* ---------- the tokens ---------- */
  var T = {};
  function rgb(hex) { var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || ''); return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 255, 255]; }
  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  function readTokens() {
    var cs = getComputedStyle(document.documentElement), g = function (n) { return cs.getPropertyValue('--' + n).trim(); };
    ['city-sky-top', 'city-sky-low', 'city-horizon', 'city-hills', 'city-haze', 'city-tower', 'city-tower-lit', 'city-tower-dark',
      'city-water-top', 'city-water-deep', 'city-ripple', 'city-road', 'city-rain', 'city-sign', 'city-sign-line', 'city-ink',
      'city-ink-soft', 'city-ink-num', 'city-ink-halo', 'city-live', 'city-up', 'city-down', 'city-hover',
      'city-fade', 'font-city', 'font-city-big', 'font-city-num', 'font-city-big-num', 'font-city-small', 'font-city-tick'].forEach(function (k) {
      T[k.replace(/^city-/, '').replace(/-([a-z])/g, function (m, c) { return c.toUpperCase(); })] = g(k);
    });
    ['city-moon', 'city-warm', 'city-cool', 'city-lamp', 'city-beacon', 'city-beam', 'city-glare'].forEach(function (k) { T[k.replace(/^city-/, '')] = rgb(g(k)); });
    T.sites = []; for (var i = 1; i <= 8; i++) T.sites.push(rgb(g('city-site-' + i)));
    T.lanes = [1, 2, 3, 4, 5].map(function (i) { return rgb(g('city-lane-' + i)); });
    T.elsewhere = rgb(g('city-lane-elsewhere')); T.direct = rgb(g('city-lane-direct'));
  }

  /* ---------- state ---------- */
  var cv, ctx, tip, opts, DPR = 1, VW = 0, VH = 0;
  var sites = [], byId = {};
  var view = { mode: 'bay', site: null, hover: null, hl: null, pan: 0 };
  var zoom = { p: 0, dir: 0 };
  var state = { running: false, last: 0, blackout: null };
  var lights = [], cars = [], beams = [], rain = [];

  /* ---------- the sites ---------- */
  function makeSite(s, i) {
    return { id: s.id, name: s.name, idx: i, tint: T.sites[i % T.sites.length], towers: [], towerBy: {}, other: null, lanes: [], laneBy: {},
      visitors: 0, pageviews: 0, events: 0, loads: 0, engaged: 0, yesterday: 0, liveBase: 0, liveAt: 0, recent: [], hours: [], order: [], loaded: false, glow: 0 };
  }
  /* Its towers are the 30-day top 8 pages, in that order (so they never trade places during the day),
     plus "other pages" when today reached any page outside them; its lanes the 30-day top 5 referrers,
     then elsewhere and direct. Heights and counts are today's. */
  function load(s, data) {
    s.towers = []; s.towerBy = {};
    data.pages.forEach(function (p, k) { var t = { path: p.value, label: p.value, total: p.hits, pv: 0, loads: 0, engaged: 0, events: 0, seed: s.idx * 97 + k * 13, glow: 0 }; s.towers.push(t); s.towerBy[p.value] = t; });
    s.other = { path: null, label: 'other pages', total: 0, pv: 0, loads: 0, engaged: 0, events: 0, seed: s.idx * 97 + 99, glow: 0, other: true };
    data.today.pages.forEach(function (p) { var t = s.towerBy[p.path] || s.other; t.pv += p.hits; t.loads += p.loads || 0; t.engaged += p.engaged || 0; t.events += p.events; });
    if (s.other.pv || s.other.events) s.towers.push(s.other);
    s.lanes = []; s.laneBy = {};
    data.refs.forEach(function (r, k) { var l = { key: 'ref:' + r.value, ref: r.value, label: r.value, color: T.lanes[k % T.lanes.length], count: 0 }; s.lanes.push(l); s.laneBy[l.key] = l; });
    [{ key: 'elsewhere', label: 'elsewhere', color: T.elsewhere }, { key: 'direct', label: 'direct', color: T.direct }].forEach(function (l) { l.count = 0; s.lanes.push(l); s.laneBy[l.key] = l; });
    data.today.refs.forEach(function (r) { laneFor(s, r.ref).count += r.hits; });
    s.visitors = data.today.visitors; s.pageviews = data.today.hits; s.events = data.today.events; s.loads = data.today.loads || 0; s.engaged = data.today.engaged || 0;
    s.yesterday = data.yesterday.visitors; s.liveBase = data.live || 0; s.liveAt = performance.now(); s.recent = [];
    s.hours = data.hours || [];
    s.order = s.towers.slice().sort(function (a, b) { return b.pv - a.pv; });
    cars = cars.filter(function (c) { return c.site !== s; });
    s.loaded = true;
  }
  function laneFor(s, ref) { return ref == null ? s.laneBy.direct : s.laneBy['ref:' + ref] || s.laneBy.elsewhere; }
  function towerOf(s, path) { return s.towerBy[path] || s.other; }
  function towerFor(s, path) {
    var t = s.towerBy[path]; if (t) return t;
    if (s.towers.indexOf(s.other) < 0) { s.towers.push(s.other); s.order.push(s.other); }
    return s.other;
  }
  /* Hits in the last five minutes: the count the API gave at load, worn off evenly over the five
     minutes after it, plus every live hit since. */
  function liveCount(s, now) { return Math.round(s.liveBase * clamp(1 - (now - s.liveAt) / LIVE_WINDOW, 0, 1)) + s.recent.filter(function (t) { return now - t < LIVE_WINDOW; }).length; }

  /* One hit from the live socket. */
  function live(msg) {
    var s = byId[msg.site]; if (!s || !s.loaded || state.blackout) return;
    var now = performance.now(), t = towerFor(s, msg.path);
    if (msg.event) {
      t.events++; s.events++;
      beams.push({ site: s, tower: t, born: now, label: msg.event });
      return;
    }
    var l = laneFor(s, msg.ref);
    s.pageviews++; if (msg.first) s.visitors++; t.pv++; l.count++; s.recent.push(now);
    if (s.loads) { s.loads++; t.loads++; }
    if (view.mode === 'bay' || zoom.dir) lights.push({ site: s, born: now, x: null, trail: [] });
    if (view.mode === 'site' && view.site === s) cars.push({ site: s, tower: t, lane: l, x: null, trail: [] });
  }

  /* ---------- layout, in screen space, inside what the panels leave free ---------- */
  function frameBox() {
    var ins = opts.insets ? opts.insets() : { top: 16, bottom: 16, right: 0 };
    return { left: 16, right: VW - (ins.right || 0) - 16, top: ins.top, bottom: VH - ins.bottom };
  }
  /* The bay: districts side by side on the shore; past what fits, the shore scrolls sideways. */
  function bayLayout() {
    var B = frameBox(), n = Math.max(1, sites.length), width = B.right - B.left, slot = Math.max(170, width / n);
    var L = { B: B, wy: Math.round(B.top + (B.bottom - B.top) * .7), slot: slot, span: slot * n };
    L.towerTop = B.top + 92;
    L.maxPan = Math.max(0, L.span - width); view.pan = clamp(view.pan, 0, L.maxPan);
    var gm = 1; sites.forEach(function (s) { s.towers.forEach(function (t) { gm = Math.max(gm, t.pv); }); });
    L.gm = gm;
    L.d = sites.map(function (s, i) {
      var dw = Math.min(slot * .84, 320), x0 = B.left + slot * i + (slot - dw) / 2 - view.pan, np = Math.max(1, s.towers.length), tw = dw / np * .78;
      var towers = s.towers.map(function (t, k) { var h = Math.max(3, (L.wy - L.towerTop) * t.pv / gm); return { t: t, x: x0 + (dw / np) * k + (dw / np - tw) / 2, w: tw, h: h }; });
      var top = towers.reduce(function (m, q) { return Math.min(m, L.wy - q.h); }, L.wy - 3);
      return { s: s, x: x0, w: dw, towers: towers, top: top };
    });
    return L;
  }
  /* A skyline: the towers from busiest to quietest, lanes on the street below them. */
  function siteLayout(s) {
    var B = frameBox(), narrow = VW < 760, L = { B: B, s: s };
    L.gy = Math.round(B.top + (B.bottom - B.top) * (narrow ? .64 : .68));
    L.labels = B.left + (narrow ? 120 : Math.min(200, (B.right - B.left) * .18));
    L.laneTop = L.gy + 12; L.laneH = clamp((B.bottom - L.gy - 18) / Math.max(1, s.lanes.length), 8, 15);
    L.top = B.top + 70;
    var n = Math.max(s.order.length, 5), slot = (B.right - L.labels) / n, tw = Math.min(slot * .7, 130), max = 1;
    s.order.forEach(function (t) { max = Math.max(max, t.pv); });
    L.towers = s.order.map(function (t, k) { var h = Math.max(20, (L.gy - L.top) * t.pv / max); return { t: t, x: L.labels + slot * k + (slot - tw) / 2, w: tw, h: h }; });
    return L;
  }
  function laneY(L, l) { return L.laneTop + L.laneH * (L.s.lanes.indexOf(l) + .5); }

  /* ---------- drawing ---------- */
  function text(str, x, y, font, color, align, halo) {
    ctx.font = font; ctx.textAlign = align || 'center';
    if (halo !== false) { ctx.lineWidth = 3.5; ctx.lineJoin = 'round'; ctx.strokeStyle = T.inkHalo; ctx.strokeText(str, x, y); }
    ctx.fillStyle = color; ctx.fillText(str, x, y);
  }
  function box(x, y, w, h, r, fill, line) {
    ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
    ctx.fillStyle = fill; ctx.fill(); if (line) { ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.stroke(); }
  }
  function sky(top, bottom) {
    var g = ctx.createLinearGradient(0, 0, 0, bottom); g.addColorStop(0, T.skyTop); g.addColorStop(.75, T.skyLow); g.addColorStop(1, T.horizon);
    ctx.fillStyle = g; ctx.fillRect(0, 0, VW, bottom);
    var mx = VW * .86, my = top + 50, m = ctx.createRadialGradient(mx, my, 0, mx, my, 60);
    m.addColorStop(0, rgba(T.moon, .95)); m.addColorStop(.13, rgba(T.moon, .7)); m.addColorStop(.16, rgba(T.moon, .1)); m.addColorStop(1, rgba(T.moon, 0));
    ctx.fillStyle = m; ctx.fillRect(mx - 60, my - 60, 120, 120);
  }
  function hills(base) {
    ctx.save(); if ('filter' in ctx) ctx.filter = 'blur(3px)';
    ctx.fillStyle = T.hills; ctx.beginPath(); ctx.moveTo(0, base);
    for (var x = 0; x <= VW + 16; x += 16) ctx.lineTo(x, base - 60 - Math.sin(x / 210) * 30 - Math.sin(x / 77 + 1) * 12);
    ctx.lineTo(VW, base); ctx.closePath(); ctx.fill(); ctx.restore();
    var h = ctx.createLinearGradient(0, base - 120, 0, base); h.addColorStop(0, T.fade); h.addColorStop(1, T.haze); ctx.fillStyle = h; ctx.fillRect(0, base - 120, VW, 120);
  }
  /* The windows of one tower: warm floors from the ground up for the share of loads used, cool above;
     in a blackout they go dark from the top down. */
  function windows(q, ground, fh, dark) {
    var t = q.t, floors = Math.max(1, Math.floor((q.h - 3) / fh)), warmF = Math.round(floors * (t.loads ? clamp(t.engaged / t.loads, 0, 1) : 0));
    var cols = Math.max(1, Math.floor(q.w / (fh < 8 ? 6 : 9))), cw = q.w / cols, lit = dark == null ? floors : Math.floor(floors * (1 - dark));
    for (var f = 0; f < Math.min(floors, lit); f++) {
      var warm = f < warmF, y = ground - (f + 1) * fh + 1;
      for (var c = 0; c < cols; c++) {
        if (noise(t.seed + f, c) > (warm ? .92 : .7)) continue;
        ctx.fillStyle = warm ? rgba(T.warm, .95) : rgba(T.cool, .62);
        ctx.fillRect(q.x + c * cw + 1, y, Math.max(1, cw - 2.5), fh - (fh < 8 ? 3 : 4));
      }
    }
    return warmF * fh;
  }
  function tower(q, ground, fh, dark, mirror) {
    var g = ctx.createLinearGradient(q.x, 0, q.x + q.w, 0); g.addColorStop(0, T.towerLit); g.addColorStop(.6, T.tower); g.addColorStop(1, T.towerDark);
    ctx.fillStyle = g; ctx.fillRect(q.x, ground - q.h, q.w, q.h);
    var warmH = windows(q, ground, fh, dark);
    if (!mirror && q.t.glow > 0) { ctx.fillStyle = rgba(T.glare, .3 * q.t.glow); ctx.fillRect(q.x, ground - q.h, q.w, q.h); }
    return warmH;
  }
  function water(top, bottom, T0, draw) {
    var g = ctx.createLinearGradient(0, top, 0, bottom); g.addColorStop(0, T.waterTop); g.addColorStop(1, T.waterDeep); ctx.fillStyle = g; ctx.fillRect(0, top, VW, bottom - top);
    ctx.save(); ctx.beginPath(); ctx.rect(0, top, VW, bottom - top); ctx.clip();
    ctx.translate(0, 2 * top + 3); ctx.scale(1, -1); ctx.globalAlpha = .26; draw(); ctx.restore();
    ctx.strokeStyle = T.ripple; ctx.lineWidth = 1;
    for (var y = top + 6; y < bottom; y += 7) { ctx.beginPath(); for (var x = 0; x <= VW; x += 24) { var yy = y + Math.sin(x / 40 + T0 / 900 + y) * 1.2; if (x) ctx.lineTo(x, yy); else ctx.moveTo(x, yy); } ctx.stroke(); }
    var f = ctx.createLinearGradient(0, top, 0, bottom); f.addColorStop(0, T.fade); f.addColorStop(.85, T.waterDeep); ctx.fillStyle = f; ctx.fillRect(0, top, VW, bottom - top);
  }
  function drawRain(dt) {
    if (reduced) return;
    ctx.strokeStyle = T.rain; ctx.lineWidth = 1; ctx.beginPath();
    rain.forEach(function (r) { r.y += r.v * dt / 16; r.x -= r.v * .2 * dt / 16; if (r.y > VH) { r.y = -20; r.x = Math.random() * VW * 1.2; } ctx.moveTo(r.x, r.y); ctx.lineTo(r.x + r.l * .2, r.y - r.l); });
    ctx.stroke();
  }
  function rhythm(x, y, w, h, list) {
    box(x, y, w, h, 8, T.sign, T.signLine);
    text('Today by hour (UTC) · line: yesterday', x + 12, y + 18, T.fontCitySmall, T.inkSoft, 'left', false);
    var hrs = new Array(24).fill(0), yh = new Array(24).fill(0);
    list.forEach(function (s) { (s.hours || []).forEach(function (r) { hrs[r.hour] += r.today; yh[r.hour] += r.yesterday; }); });
    var mx = Math.max(1, Math.max.apply(null, hrs.concat(yh))), bx = x + 12, bw = (w - 24) / 24, by = y + h - 18, bh = h - 46, now = new Date().getUTCHours();
    hrs.forEach(function (n, i) { var hh = bh * n / mx; ctx.fillStyle = i === now ? T.live : rgba(T.cool, .75); ctx.fillRect(bx + i * bw + 1, by - hh, bw - 2, hh); });
    ctx.strokeStyle = T.inkSoft; ctx.lineWidth = 1.3; ctx.beginPath();
    yh.forEach(function (n, i) { var px = bx + i * bw + bw / 2, py = by - bh * n / mx; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }); ctx.stroke();
    [0, 6, 12, 18].forEach(function (t) { text(String(t).padStart(2, '0'), bx + t * bw + bw / 2, by + 13, T.fontCityTick, T.inkSoft, 'center', false); });
  }
  /* A label cut to a width, with an ellipsis. */
  function fit(str, w, font) {
    ctx.font = font; if (ctx.measureText(str).width <= w) return str;
    while (str.length > 1 && ctx.measureText(str + '…').width > w) str = str.slice(0, -1);
    return str + '…';
  }
  function change(s) { if (!s.yesterday) return null; return Math.round((s.visitors / s.yesterday - 1) * 100); }
  function arrow(d) { return d == null ? '' : d > 0 ? '▲ ' + d + '%' : d < 0 ? '▼ ' + Math.abs(d) + '%' : '± 0%'; }

  /* The bay, whole. */
  function drawBay(now, dt, L, dark) {
    sky(L.B.top, L.wy); hills(L.wy);
    var draw = function (mirror) {
      L.d.forEach(function (d) {
        d.towers.forEach(function (q) { tower(q, L.wy, 6, dark, mirror); });
        if (!mirror && d.s.glow > 0) {
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          var cx = d.x + d.w / 2, g = ctx.createRadialGradient(cx, L.wy, 0, cx, L.wy, d.w * .7); g.addColorStop(0, rgba(d.s.tint, .35 * d.s.glow)); g.addColorStop(1, rgba(d.s.tint, 0));
          ctx.fillStyle = g; ctx.fillRect(cx - d.w, L.wy - d.w, d.w * 2, d.w * 1.1); ctx.restore();
        }
      });
    };
    draw(false);
    water(L.wy, VH, now, function () { draw(true); });
    /* the shore road and its lamps */
    ctx.fillStyle = T.road; ctx.fillRect(0, L.wy, VW, 4);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (var lx = 20 - view.pan % 70; lx < VW; lx += 70) { var lg = ctx.createRadialGradient(lx, L.wy + 1, 0, lx, L.wy + 1, 22); lg.addColorStop(0, rgba(T.lamp, .5)); lg.addColorStop(1, rgba(T.lamp, 0)); ctx.fillStyle = lg; ctx.fillRect(lx - 22, L.wy - 21, 44, 44); }
    ctx.restore();
    /* live: a light along the shore road, into its district */
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    lights = lights.filter(function (l) {
      var d = L.d[sites.indexOf(l.site)]; if (!d) return false;
      if (l.x === null) l.x = L.B.left - 20;
      var tx = d.x + d.w / 2;
      if (!l.in) { l.x += dt * (reduced ? 1e4 : .55); if (l.x >= tx) { l.x = tx; l.in = now; l.site.glow = 1; } }
      l.trail.push(l.x); if (l.trail.length > 26) l.trail.shift();
      var a = l.in ? clamp(1 - (now - l.in) / 600, 0, 1) : 1;
      for (var k = 1; k < l.trail.length; k++) { ctx.strokeStyle = rgba(l.site.tint, .85 * k / l.trail.length * a); ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(l.trail[k - 1], L.wy + 2); ctx.lineTo(l.trail[k], L.wy + 2); ctx.stroke(); }
      if (!l.in) { ctx.fillStyle = rgba(T.glare, 1); ctx.beginPath(); ctx.arc(l.x, L.wy + 2, 1.8, 0, TAU); ctx.fill(); }
      return a > 0;
    });
    ctx.restore();
    sites.forEach(function (s) { s.glow = Math.max(0, s.glow - dt / 900); });
    /* events: a short beam from the district's tallest tower */
    beamsFor(now, function (b) { var d = L.d[sites.indexOf(b.site)]; if (!d || !d.towers.length) return null; var q = d.towers.reduce(function (a, c) { return c.h > a.h ? c : a; }); return { x: q.x + q.w / 2, y: L.wy - q.h }; }, 220);
    drawRain(dt);
    /* the signs */
    L.d.forEach(function (d) { sign(d, L, now); });
    if (VW >= 760) rhythm(L.B.right - 290, VH - Math.max(120, (VH - L.wy) * .5 + 60), 280, 106, sites);
  }
  function sign(d, L, now) {
    var s = d.s, sw = clamp(d.w, 130, 230), tall = sw < 200, sh = tall ? 66 : 52, mid = d.x + d.w / 2, cx = mid > 0 && mid < VW ? clamp(mid, sw / 2 + 6, VW - sw / 2 - 6) : mid, sy = Math.max(L.B.top + 4, d.top - sh - 12);
    var hl = view.hover && view.hover.kind === 'site' && view.hover.s === s || view.hl && view.hl.site === s;
    box(cx - sw / 2, sy, sw, sh, 8, T.sign, hl ? T.hover : rgba(s.tint, .6));
    ctx.fillStyle = rgba(s.tint, 1); ctx.fillRect(cx - sw / 2 + 8, sy + 9, 4, sh - 18);
    var x0 = cx - sw / 2 + 18, x1 = cx + sw / 2 - 10, d0 = change(s), up = d0 == null || d0 >= 0 ? T.up : T.down, used = s.loads ? pct(s.engaged, s.loads) + '% used' : '';
    text(s.name, x0, sy + 20, T.fontCityBig, T.ink, 'left', false);
    text(fmt(s.visitors), x1, sy + 20, T.fontCityBigNum, T.ink, 'right', false);
    text('● ' + liveCount(s, now) + ' live', x0, sy + 39, T.fontCityNum, T.live, 'left', false);
    if (tall) { text(arrow(d0), x1, sy + 39, T.fontCityNum, up, 'right', false); text(used, x0, sy + 56, T.fontCityNum, T.inkNum, 'left', false); }
    else text(used + (d0 == null ? '' : '  ' + arrow(d0)), x1, sy + 39, T.fontCityNum, up, 'right', false);
    if (!s.towers.length) text('no visits yet', d.x + d.w / 2, L.wy - 12, T.fontCity, T.inkSoft);
    ctx.strokeStyle = rgba(s.tint, .5); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(d.x + d.w / 2, sy + sh); ctx.lineTo(d.x + d.w / 2, d.top - 4); ctx.stroke();
    s.signBox = { x: cx - sw / 2, y: sy, w: sw, h: sh };   // on the site: hitTest lays the bay out afresh
  }
  function beamsFor(now, where, len) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    beams = beams.filter(function (b) {
      var life = (now - b.born) / 2600; if (life >= 1) return false;
      var p = where(b); if (!p) return true;
      var k = Math.sin(Math.PI * life), ang = -Math.PI / 2 + Math.sin(life * 5) * .5, x1 = p.x + Math.cos(ang) * len, y1 = p.y + Math.sin(ang) * len;
      var g = ctx.createLinearGradient(p.x, p.y, x1, y1); g.addColorStop(0, rgba(T.beam, .45 * k)); g.addColorStop(1, rgba(T.beam, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + Math.cos(ang - .07) * len, p.y + Math.sin(ang - .07) * len); ctx.lineTo(p.x + Math.cos(ang + .07) * len, p.y + Math.sin(ang + .07) * len); ctx.fill();
      b.at = p; b.k = k;
      return true;
    });
    ctx.restore();
  }

  /* One site's skyline. */
  function drawSite(now, dt, L, dark) {
    var s = L.s;
    sky(L.B.top, L.gy); hills(L.gy);
    var marks = [];
    L.towers.forEach(function (q) { var warmH = tower(q, L.gy, 9, dark, false); marks.push({ q: q, y: L.gy - warmH }); q.t.glow = Math.max(0, q.t.glow - dt / 700); });
    water(L.gy, VH, now, function () { L.towers.forEach(function (q) { tower(q, L.gy, 9, dark, true); }); });
    ctx.fillStyle = T.road; ctx.fillRect(0, L.gy, VW, 2);
    /* lanes: one per referrer, its colour, its name, today's count */
    s.lanes.forEach(function (l) {
      var y = laneY(L, l), hl = view.hl && view.hl.site === s && laneFor(s, view.hl.ref) === l || view.hover && view.hover.lane === l;
      ctx.strokeStyle = rgba(l.color, hl ? .5 : .16); ctx.lineWidth = hl ? 2 : 1; ctx.setLineDash([6, 8]); ctx.beginPath(); ctx.moveTo(L.B.left, y); ctx.lineTo(VW, y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = rgba(l.color, 1); ctx.fillRect(L.B.left, y - 4, 4, 8);
      text(fit(l.label, L.labels - L.B.left - 50, T.fontCity), L.B.left + 10, y + 4, T.fontCity, hl ? T.ink : T.inkSoft, 'left');
      text(fmt(l.count), L.labels - 12, y + 4, T.fontCityNum, rgba(l.color, 1), 'right');
    });
    /* cars: headlights forward, a trail of their lane's colour behind */
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    cars = cars.filter(function (c) {
      if (c.site !== s) return false;
      var q = L.towers.filter(function (x) { return x.t === c.tower; })[0], y = laneY(L, c.lane); if (!q) return false;
      if (c.x === null) c.x = L.B.left - 30;
      var tx = q.x + q.w / 2;
      if (!c.in) { c.x += dt * (reduced ? 1e4 : .32); if (c.x >= tx) { c.x = tx; c.in = now; c.tower.glow = 1; } }
      c.trail.push(c.x); if (c.trail.length > 30) c.trail.shift();
      var a = c.in ? clamp(1 - (now - c.in) / 600, 0, 1) : 1;
      for (var k = 1; k < c.trail.length; k++) { ctx.strokeStyle = rgba(c.lane.color, .75 * k / c.trail.length * a); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(c.trail[k - 1], y); ctx.lineTo(c.trail[k], y); ctx.stroke(); }
      if (!c.in) {
        var g = ctx.createLinearGradient(c.x, 0, c.x + 56, 0); g.addColorStop(0, rgba(T.glare, .5)); g.addColorStop(1, rgba(T.glare, 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(c.x + 4, y - 1.5); ctx.lineTo(c.x + 56, y - 6); ctx.lineTo(c.x + 56, y + 5); ctx.lineTo(c.x + 4, y + 1.5); ctx.fill();
        ctx.fillStyle = rgba(T.glare, 1); ctx.beginPath(); ctx.arc(c.x + 4, y, 1.8, 0, TAU); ctx.fill();
      }
      return a > 0;
    });
    ctx.restore();
    beamsFor(now, function (b) { if (b.site !== s) return null; var q = L.towers.filter(function (x) { return x.t === b.tower; })[0]; return q ? { x: q.x + q.w / 2, y: L.gy - q.h - 2 } : null; }, 420);
    drawRain(dt);
    /* the signs on the roofs, the used tick on the side, the red lights; a sign that would cover
       another climbs above it, tied to its roof by a line */
    var placed = [], few = VW < 760 ? 4 : Infinity;
    marks.forEach(function (m, rank) {
      var q = m.q, t = q.t, top = L.gy - q.h, cx = q.x + q.w / 2;
      if (rank >= few) return;   // on a phone the quieter towers keep their numbers in the tooltip
      var hl = view.hover && view.hover.tower === t || view.hl && view.hl.site === s && towerOf(s, view.hl.path) === t;
      if (t.loads) { ctx.strokeStyle = T.inkNum; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(q.x + q.w + 2, m.y); ctx.lineTo(q.x + q.w + 8, m.y); ctx.stroke(); }
      if (t.loads) text(pct(t.engaged, t.loads) + '%', q.x + q.w + 10, m.y + 4, T.fontCityTick, T.inkNum, 'left');
      var blink = (Math.sin(now / 450 + t.seed) + 1) / 2;
      ctx.fillStyle = rgba(T.beacon, .4 + .6 * blink); ctx.beginPath(); ctx.arc(cx, top - 4, 2.2, 0, TAU); ctx.fill();
      ctx.font = T.fontCity; var sw = Math.max(ctx.measureText(t.label).width + 16, 46), sx = cx - sw / 2, sy = top - 46;
      for (var guard = 0; guard < 30 && placed.some(function (o) { return sx < o.x + o.w + 4 && sx + sw + 4 > o.x && sy < o.y + 40 && sy + 40 > o.y; }); guard++) sy -= 10;
      placed.push({ x: sx, y: sy, w: sw });
      if (sy < top - 46) { ctx.strokeStyle = T.signLine; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx, top - 8); ctx.lineTo(cx, sy + 36); ctx.stroke(); }
      box(sx, sy, sw, 36, 7, T.sign, hl ? T.hover : T.signLine);
      text(t.label, cx, sy + 15, T.fontCity, T.ink, 'center', false);
      text(fmt(t.pv), cx, sy + 30, T.fontCityNum, T.inkNum, 'center', false);
    });
    beams.forEach(function (b) { if (b.site === s && b.at) text('★ ' + b.label, b.at.x, b.at.y - 54, T.fontCityNum, rgba(T.beam, b.k), 'center'); });
    if (VW >= 760) rhythm(L.B.right - 290, L.B.top + 4, 280, 106, [s]);
  }

  function frame(now) {
    var dt = Math.min(50, now - state.last); state.last = now;
    if (zoom.dir) {
      zoom.p = clamp(zoom.p + zoom.dir * dt / (reduced ? 1 : ZOOM_MS), 0, 1);
      if (zoom.p === 1 || zoom.p === 0) { if (zoom.p === 0) { view.site = null; view.mode = 'bay'; } zoom.dir = 0; }
    }
    var dark = null;
    if (state.blackout) {
      var k = (now - state.blackout.t0) / state.blackout.dur; dark = clamp(k * 1.2, 0, 1);
      if (k >= 1) { var done = state.blackout.done; state.blackout = null; dark = null; if (done) done(); }
    }
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = T.skyTop; ctx.fillRect(0, 0, VW, VH);
    var L = bayLayout(), p = ease(zoom.p);
    if (p < 1) {
      ctx.save();
      if (view.site) {
        var d = L.d[sites.indexOf(view.site)];
        if (d) { var R = { x: d.x - 20, y: d.top - 80, w: d.w + 40, h: L.wy - d.top + 120 }, sc = 1 + (Math.min(VW / R.w, VH / R.h) * .9 - 1) * p, cx = R.x + R.w / 2, cy = R.y + R.h / 2;
          ctx.translate(lerp(cx, VW / 2, p), lerp(cy, VH / 2, p)); ctx.scale(sc, sc); ctx.translate(-cx, -cy); }
      }
      drawBay(now, dt, L, dark);
      ctx.restore();
    }
    if (view.site && p > 0) {
      ctx.save(); ctx.globalAlpha = clamp(p * 1.4 - .2, 0, 1);
      if (ctx.globalAlpha > 0) drawSite(now, dt, siteLayout(view.site), dark);
      ctx.restore();
    }
    requestAnimationFrame(frame);
  }

  /* ---------- pointer ---------- */
  function hitTest(x, y) {
    if (zoom.dir) return null;
    if (view.mode === 'bay') {
      var L = bayLayout();
      for (var i = 0; i < L.d.length; i++) { var d = L.d[i], sg = d.s.signBox; if (x >= d.x - 10 && x <= d.x + d.w + 10 && y >= d.top - 20 && y <= L.wy + 10 || sg && x >= sg.x && x <= sg.x + sg.w && y >= sg.y && y <= sg.y + sg.h) return { kind: 'site', s: d.s }; }
      return null;
    }
    var S = siteLayout(view.site);
    for (var k = 0; k < S.towers.length; k++) { var q = S.towers[k]; if (x >= q.x - 4 && x <= q.x + q.w + 4 && y >= S.gy - q.h - 48 && y <= S.gy) return { kind: 'tower', tower: q.t, s: view.site }; }
    for (k = 0; k < view.site.lanes.length; k++) { var l = view.site.lanes[k], ly = laneY(S, l); if (Math.abs(y - ly) <= S.laneH / 2 && x < S.B.right) return { kind: 'lane', lane: l, s: view.site }; }
    return null;
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
    tip.innerHTML = html; tip.hidden = false;
    var r = tip.getBoundingClientRect();
    tip.style.left = Math.max(8, Math.min(x + 16, VW - r.width - 8)) + 'px';
    tip.style.top = Math.max(8, y - r.height - 12) + 'px';
  }
  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1); VW = cv.clientWidth; VH = cv.clientHeight;
    cv.width = Math.round(VW * DPR); cv.height = Math.round(VH * DPR);
    rain = []; for (var i = 0, n = VW < 760 ? 110 : 240; i < n; i++) rain.push({ x: Math.random() * VW, y: Math.random() * VH, l: 8 + Math.random() * 12, v: 8 + Math.random() * 6 });
  }

  window.FootwornCity = {
    /* canvas, { tip, insets() -> {top, bottom, right}, onEnter(id), onLeave() } */
    init: function (canvas, o) {
      cv = canvas; ctx = cv.getContext('2d'); opts = o || {}; tip = opts.tip || null;
      readTokens(); resize();
      window.addEventListener('resize', resize);
      /* Drag (or the wheel) scrolls a shore longer than the window; a press that did not move is a
         click, and on a touch screen it shows the tooltip a mouse gets by hovering. */
      var down = null, moved = false;
      cv.addEventListener('pointerdown', function (e) { down = { x: e.clientX, pan: view.pan }; moved = false; try { cv.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ } });
      cv.addEventListener('pointermove', function (e) {
        if (down) { if (Math.abs(e.clientX - down.x) > 6) moved = true; if (moved && view.mode === 'bay') { view.pan = down.pan - (e.clientX - down.x); if (tip) tip.hidden = true; } return; }
        if (e.pointerType !== 'mouse') return;
        var h = hitTest(e.clientX, e.clientY); view.hover = h; showTip(h, e.clientX, e.clientY);
        cv.style.cursor = h && h.kind === 'site' ? 'pointer' : '';
      });
      var up = function () { down = null; };
      cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
      cv.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') { view.hover = null; if (tip) tip.hidden = true; } });
      cv.addEventListener('wheel', function (e) { if (view.mode !== 'bay') return; var d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY; if (!d) return; e.preventDefault(); view.pan += d; }, { passive: false });
      cv.addEventListener('click', function (e) {
        if (moved) { moved = false; return; }
        var h = hitTest(e.clientX, e.clientY);
        if (h && h.kind === 'site' && opts.onEnter) opts.onEnter(h.s.id);
        else showTip(h, e.clientX, e.clientY);
      });
    },
    /* [{id, name}], in the order the API lists them: one district each, in that order. */
    setSites: function (list) {
      var was = view.site && view.site.id, old = byId;
      sites = list.map(function (s, i) { var k = old[s.id]; if (k) { k.idx = i; k.name = s.name; k.tint = T.sites[i % T.sites.length]; return k; } return makeSite(s, i); });
      byId = {}; sites.forEach(function (s) { byId[s.id] = s; });
      if (was && !byId[was]) { view.site = null; view.mode = 'bay'; zoom.p = 0; zoom.dir = 0; }
      if (!state.running) { state.running = true; state.last = performance.now(); requestAnimationFrame(frame); }
    },
    load: function (id, data) { var s = byId[id]; if (s) load(s, data); },
    live: live,
    enter: function (id, instant) {
      var s = byId[id]; if (!s) return;
      if (s.loaded) s.order = s.towers.slice().sort(function (a, b) { return b.pv - a.pv; });
      view.mode = 'site'; view.site = s; view.hover = null; lights = []; if (tip) tip.hidden = true;
      zoom.dir = 1; if (instant || reduced) { zoom.p = 1; zoom.dir = 0; }
    },
    leave: function (instant) {
      view.mode = 'bay'; view.hover = null; if (tip) tip.hidden = true; cars = [];
      zoom.dir = -1; if (instant || reduced) { zoom.p = 0; zoom.dir = 0; view.site = null; }
    },
    /* The layout follows the panels on every frame; nothing to redo. */
    refit: function () {},
    wantsRelayout: function () { return false; },
    /* The day's cut: the windows go dark from the top down, then `done` (app.js reloads the counts). */
    dayCut: function (done) { if (!state.blackout) state.blackout = { t0: performance.now(), dur: reduced ? 1 : BLACKOUT_MS, done: done }; },
    /* Rings one visit's tower and lane ({ site, path, ref }), or nothing (null). */
    highlight: function (h) { view.hl = h || null; },
    /* The colours the visits panel shares with the scene: a referrer's lane in a site (its
       30-day top 5, else elsewhere; direct for none), and a site's district. As CSS rgb(). */
    laneColor: function (id, ref) { var s = byId[id]; var l = s && s.loaded ? laneFor(s, ref) : null; return l ? 'rgb(' + l.color.join(',') + ')' : 'rgb(' + (ref == null ? T.direct : T.elsewhere).join(',') + ')'; },
    siteColor: function (id) { var s = byId[id]; return s ? 'rgb(' + s.tint.join(',') + ')' : ''; },
    /* One page's counts today, from its tower: { pv, loads, engaged, other }; `other` when the page
       is outside the 30-day top 8 and the counts are those of every such page together. */
    pageStats: function (id, path) { var s = byId[id]; if (!s || !s.loaded) return null; var t = towerOf(s, path); return { pv: t.pv, loads: t.loads, engaged: t.engaged, other: !!t.other }; },
    stats: function (id) {
      var list = id ? [byId[id]].filter(Boolean) : sites, now = performance.now();
      return list.reduce(function (t, s) { t.visitors += s.visitors; t.pageviews += s.pageviews; t.events += s.events; t.live += liveCount(s, now); return t; },
        { visitors: 0, pageviews: 0, events: 0, live: 0 });
    },
  };
})();
