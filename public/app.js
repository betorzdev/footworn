/* Footworn's dashboard. One classic script: asks the token once, reads /api/*, draws the day chart
   as inline SVG and the tables. No framework, no build. Site, range and open event live in the
   query string (a link reopens the same view); the token only ever travels in the hash. */
(function () {
  'use strict';
  var TOKEN_KEY = 'footworn.token', RANGES = [1, 7, 30, 90];
  var $ = function (id) { return document.getElementById(id); };
  var state = { token: null, site: null, days: 30, from: null, to: null, sites: [], stats: null, event: null, eventStats: null, openEvent: null };

  function load(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function save(key, v) { try { if (v === null) localStorage.removeItem(key); else localStorage.setItem(key, v); } catch (e) { /* no storage */ } }

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(n) { return (n || 0).toLocaleString('en'); }
  /* Totals past a million go compact ("1.2M") so the tile never overflows; the exact number is the title. */
  var compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
  function tile(id, n) { var el = $(id); el.textContent = n >= 1e6 ? compact.format(n) : fmt(n); el.title = n >= 1e6 ? fmt(n) : ''; }
  /* The rates under the totals: per day of the range, and pageviews per visitor. Derived on screen, never stored. */
  var oneDecimal = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });
  function rates(st) {
    var days = Math.round((Date.parse(st.to) - Date.parse(st.from)) / 86400000) + 1, t = st.totals;
    $('u-visitors').textContent = oneDecimal.format(t.visitors / days) + ' a day';
    $('u-hits').textContent = t.visitors ? oneDecimal.format(t.hits / t.visitors) + ' per visitor' : '';
    $('u-events').textContent = oneDecimal.format(t.events / days) + ' a day';
  }
  /* Axis labels: "Sep 25". The ISO day stays in the tables and the URL, where it is the key. */
  var shortDay = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  function fmtDay(iso) { return shortDay.format(new Date(Date.parse(iso))); }
  function day(d) { return d.toISOString().slice(0, 10); }
  function addDays(iso, n) { return day(new Date(Date.parse(iso) + n * 86400000)); }
  /* A real calendar day: V8 parses 2026-02-31 as March 3, so the round trip has to match. */
  function isDay(s) { if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false; var t = Date.parse(s); return !isNaN(t) && day(new Date(t)) === s; }
  function reduced() { return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; }

  function api(path) {
    return fetch(path, { headers: { Authorization: 'Bearer ' + state.token } }).then(function (r) {
      if (r.status === 401) { throw new Error('unauthorized'); }
      if (!r.ok) { throw new Error('HTTP ' + r.status); }
      return r.json();
    });
  }
  function busy(on) { $('dash').setAttribute('aria-busy', on ? 'true' : 'false'); }
  /* Retry repeats the request that failed: the stats, or the one event that was being opened. */
  var retry = null;
  function showError(msg, again) {
    var el = $('error');
    el.textContent = msg || '';
    retry = msg ? again || null : null;
    if (retry) { var b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.id = 'retry'; b.textContent = 'Retry'; el.appendChild(b); }
    el.hidden = !msg;
  }
  $('error').addEventListener('click', function (e) { if (e.target.closest('#retry') && retry) retry(); });
  function failed(e, again) {
    busy(false);
    if (e.message === 'unauthorized') showGate('The token stopped working. Paste it again.');
    else showError('Could not load (' + e.message + ').', again || refresh);
  }

  /* --- gate --- */
  function showGate(msg) {
    $('dash').hidden = true; $('gate').hidden = false;
    $('gate-error').hidden = !msg; $('gate-error').textContent = msg || '';
    $('token').focus();
  }
  /* One request at a time: the button is disabled until the token is accepted or refused. */
  $('gate-form').addEventListener('submit', function (e) {
    e.preventDefault();
    state.token = $('token').value.trim();
    $('gate-form').querySelector('button').disabled = true;
    start();
  });
  $('logout').addEventListener('click', function () { save(TOKEN_KEY, null); state.token = null; $('token').value = ''; showGate(); });

  function start() {
    api('/api/sites').then(function (sites) {
      $('gate-form').querySelector('button').disabled = false;
      save(TOKEN_KEY, state.token);
      state.sites = sites;
      $('gate').hidden = true; $('dash').hidden = false;
      var sel = $('site');
      sel.innerHTML = sites.map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>'; }).join('');
      if (!sites.length) {
        sel.innerHTML = '<option value="">No sites yet</option>';
        showError('No sites registered yet. Register one with: npm run site:add -- <id> "<name>" <origin> --remote');
      }
      var want = load('footworn.site');
      if (want && sites.some(function (s) { return s.id === want; })) sel.value = want;
      state.site = sel.value;
      if (state.days) setRange(state.days); else setCustom(state.from, state.to);
    }).catch(function (e) {
      $('gate-form').querySelector('button').disabled = false;
      showGate(e.message === 'unauthorized' ? 'That token is not accepted. Check it and try again.' : 'Could not reach the API (' + e.message + '). Check that the Worker is up, then retry.');
    });
  }

  /* --- range --- */
  function setRange(days) {
    state.days = days;
    state.to = day(new Date());
    state.from = addDays(state.to, -(days - 1));
    $('from').value = state.from; $('to').value = state.to;
    paintRange(); refresh();
  }
  function setCustom(from, to) {
    state.from = from; state.to = to; state.days = 0;
    $('from').value = from; $('to').value = to;
    paintRange(); refresh();
  }
  function paintRange() {
    Array.prototype.forEach.call($('ranges').children, function (b) {
      b.setAttribute('aria-pressed', String(state.days && Number(b.dataset.days) === state.days));
    });
  }
  $('ranges').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (b) setRange(Number(b.dataset.days));
  });
  /* A pair picked backwards is swapped, as the API would swap it, so the inputs always show the range on screen. */
  function custom() {
    var a = $('from').value, b = $('to').value;
    if (!isDay(a) || !isDay(b)) return;
    if (a > b) setCustom(b, a); else setCustom(a, b);
  }
  $('from').addEventListener('change', custom);
  $('to').addEventListener('change', custom);
  $('site').addEventListener('change', function () { state.site = $('site').value; save('footworn.site', state.site); refresh(); });

  /* The view in the URL: `?site=&days=` or `?site=&from=&to=`, plus `&event=` when one is open. */
  function syncUrl() {
    var q = 'site=' + encodeURIComponent(state.site) + (state.days ? '&days=' + state.days : '&from=' + state.from + '&to=' + state.to);
    if (state.event) q += '&event=' + encodeURIComponent(state.event);
    history.replaceState(null, '', location.pathname + '?' + q);
  }

  /* --- stats --- */
  /* Each refresh is a generation; a response from an older one (a slow request overtaken by a
     click on another range) is dropped, so what is on screen always matches the URL. */
  var seq = 0;
  function refresh() {
    if (!state.site) return;
    state.event = null; $('detail').hidden = true;
    syncUrl(); busy(true);
    var id = ++seq;
    api('/api/stats?site=' + encodeURIComponent(state.site) + '&from=' + state.from + '&to=' + state.to)
      .then(function (st) { if (id === seq) render(st); })
      .catch(function (e) { if (id === seq) failed(e); });
  }

  function render(st) {
    showError(null); busy(false);
    state.stats = st;
    tile('t-visitors', st.totals.visitors);
    tile('t-hits', st.totals.hits);
    tile('t-events', st.totals.events);
    rates(st);
    $('chart').innerHTML = chartBlock(st.days, st.from, st.to, false, $('chart'));
    $('tables').innerHTML = [
      table('Pages', st.path, 'hits', 'Pageviews'),
      table('Referrers', st.ref, 'hits', 'Pageviews', 'Direct or none'),
      table('Events', st.events, 'hits', 'Times', 'No events', true),
      table('Countries', st.country, 'hits', 'Pageviews'),
      table('Languages', st.lang, 'hits', 'Pageviews'),
      table('Browsers', st.browser, 'hits', 'Pageviews'),
      table('Systems', st.os, 'hits', 'Pageviews'),
      table('Devices', st.device, 'hits', 'Pageviews'),
    ].join('');
    fills($('tables'));
    if (state.openEvent) { var ev = state.openEvent; state.openEvent = null; openEvent(ev); }
  }

  /* The bars under the table values. Set from script, not inline style: the dashboard's CSP
     (public/_headers) allows no inline code at all. */
  function fills(el) {
    Array.prototype.forEach.call(el.querySelectorAll('.fill[data-w]'), function (f) { f.style.width = f.dataset.w + '%'; });
  }

  /* One dimension: value, count, visitors. Event names are buttons (keyboard and mouse open the detail). */
  function table(title, rows, key, countLabel, empty, clickable) {
    var max = rows.length ? rows[0][key] : 0;
    var withVisitors = rows.length && rows[0].visitors !== undefined && !clickable;
    var body = rows.length ? rows.map(function (r) {
      var w = max ? Math.round(100 * r[key] / max) : 0;
      var cell = clickable
        ? '<button type="button" class="evt" data-value="' + esc(r.value) + '">' + esc(r.value) + '</button>'
        : '<span title="' + esc(r.value) + '">' + esc(r.value) + '</span>';
      return '<tr><td class="v"><div class="fill" data-w="' + w + '"></div>' + cell + '</td>' +
        '<td class="n num">' + fmt(r[key]) + '</td>' +
        (withVisitors ? '<td class="n num muted">' + fmt(r.visitors) + '</td>' : '') +
        '</tr>';
    }).join('') : '';
    var th = function (t) { return '<th scope="col"><span class="sr-only">' + esc(t) + '</span></th>'; };
    var head = '<thead><tr>' + th(title) + th(countLabel) + (withVisitors ? th('Visitors') : '') + '</tr></thead>';
    return '<section class="panel"><h2>' + esc(title) + '</h2>' +
      (rows.length ? '<table class="dim">' + head + '<tbody>' + body + '</tbody></table>' : '<p class="empty">' + esc(empty || 'Nothing yet') + '</p>') + '</section>';
  }

  /* --- the day chart --- */
  /* Every day of the range, even the empty ones. */
  function fillDays(days, from, to) {
    var byDay = {}; days.forEach(function (d) { byDay[d.day] = d; });
    var list = [];
    for (var d = from; d <= to; d = addDays(d, 1)) list.push(byDay[d] || { day: d, hits: 0, visitors: 0 });
    return list;
  }

  /* Bars for pageviews, a line for visitors (events: bars only), plus the same numbers as a table. */
  function chartBlock(days, from, to, bars, box) {
    var list = fillDays(days, from, to);
    return chart(list, bars, box) +
      (bars ? '' : '<div class="legend"><span class="bar"><i></i>Pageviews</span><span class="line"><i></i>Visitors</span></div>') +
      '<details class="data"><summary>Data</summary><table><thead><tr><th scope="col">Day</th><th scope="col">' + (bars ? 'Times' : 'Pageviews') + '</th>' +
      (bars ? '' : '<th scope="col">Visitors</th>') + '</tr></thead><tbody>' +
      list.map(function (d) {
        return '<tr><td class="num">' + d.day + '</td><td class="num">' + fmt(d.hits) + '</td>' + (bars ? '' : '<td class="num">' + fmt(d.visitors) + '</td>') + '</tr>';
      }).join('') + '</tbody></table></details>';
  }

  /* The page's rule pitch (tokens.css --lh): the chart is drawn eight rules high so its baseline sits on a line. */
  function rule() { return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--lh')) || 28; }
  /* Drawn at its box's pixel width so the labels are real CSS pixels; redrawn on resize. */
  function width(box) {
    var cs = getComputedStyle(box), w = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return Math.round(Math.max(280, w > 0 ? w : $('chart').clientWidth || 1000));
  }
  function chart(list, bars, box) {
    var W = width(box), H = 8 * rule(), L = 44, B = 28, T = 10, R = 8; /* eight rules of the page */
    var iw = W - L - R, ih = H - T - B;
    var max = Math.max(1, Math.max.apply(null, list.map(function (d) { return d.hits; })));
    var step = iw / list.length;
    var y = function (v) { return T + ih - ih * v / max; };
    var label = bars ? 'Times by day' : 'Pageviews and visitors by day';
    var out = '<svg class="days" data-w="' + W + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + label + '">';
    var ticks = [];
    [0, 0.5, 1].forEach(function (f) { var v = Math.round(max * f); if (ticks.indexOf(v) < 0) ticks.push(v); });
    ticks.forEach(function (v) {
      out += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--border)" stroke-width="1"/>' +
             '<text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end" fill="var(--muted)">' + v + '</text>';
    });
    list.forEach(function (d, i) {
      var x = L + i * step, bw = Math.max(1, step * 0.6);
      out += '<rect x="' + (x + (step - bw) / 2) + '" y="' + y(d.hits) + '" width="' + bw + '" height="' + (T + ih - y(d.hits)) + '" fill="var(--bar)">' +
             '<title>' + d.day + ': ' + d.hits + (bars ? ' times' : ' pageviews, ' + d.visitors + ' visitors') + '</title></rect>';
    });
    if (!bars) {
      var pts = list.map(function (d, i) { return (L + i * step + step / 2).toFixed(1) + ',' + y(d.visitors).toFixed(1); });
      out += '<polyline points="' + pts.join(' ') + '" fill="none" stroke="var(--line)" stroke-width="2" stroke-linejoin="round"/>';
    }
    var every = Math.ceil(list.length / Math.max(2, Math.floor(W / 120)));
    list.forEach(function (d, i) {
      if (i % every) return;
      out += '<text x="' + (L + i * step + step / 2) + '" y="' + (H - 8) + '" text-anchor="middle" fill="var(--muted)">' + fmtDay(d.day) + '</text>';
    });
    return out + '</svg>';
  }

  /* A box that changed width (window, scrollbar, first layout) gets its chart drawn again. */
  var drawTimer = null;
  function redraw() {
    clearTimeout(drawTimer);
    drawTimer = setTimeout(function () {
      [[$('chart'), state.stats, false], [$('detail'), state.event && state.eventStats, true]].forEach(function (b) {
        var box = b[0], st = b[1], svg = box.querySelector('svg');
        if (!st || !svg || box.hidden || Number(svg.dataset.w) === width(box)) return;
        svg.outerHTML = chart(fillDays(st.days, st.from, st.to), b[2], box);
      });
    }, 100);
  }
  if (window.ResizeObserver) { var ro = new ResizeObserver(redraw); ro.observe($('chart')); ro.observe($('detail')); }
  window.addEventListener('resize', redraw);

  /* --- one event --- */
  $('tables').addEventListener('click', function (e) {
    var b = e.target.closest('button.evt'); if (b) openEvent(b.dataset.value);
  });
  function openEvent(name) {
    busy(true);
    var id = seq;
    api('/api/event?site=' + encodeURIComponent(state.site) + '&name=' + encodeURIComponent(name) + '&from=' + state.from + '&to=' + state.to)
      .then(function (ev) {
        if (id !== seq) return;
        showError(null); busy(false);
        state.event = name; state.eventStats = ev; syncUrl();
        var el = $('detail');
        el.hidden = false;
        el.innerHTML = '<header><h2><span class="sr-only">Event </span>' + esc(name) + '</h2><span class="muted num">event · ' + fmt(ev.totals.hits) + ' times</span><span class="grow"></span>' +
          '<button class="btn" type="button" id="close-event">Close</button></header>' +
          chartBlock(ev.days, ev.from, ev.to, true, el) +
          '<div class="grid">' + table('On page', ev.paths, 'hits', 'Times') +
          Object.keys(ev.props).map(function (k) { return table('Property · ' + k, ev.props[k], 'hits', 'Times'); }).join('') + '</div>';
        fills(el);
        el.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
        $('close-event').focus({ preventScroll: true });
      }).catch(function (e) { if (id === seq) failed(e, function () { openEvent(name); }); });
  }
  $('detail').addEventListener('click', function (e) {
    if (e.target.closest('#close-event')) { state.event = null; $('detail').hidden = true; syncUrl(); }
  });

  /* --- boot --- */
  function params(s) {
    var out = {};
    s.split('&').forEach(function (kv) {
      var i = kv.indexOf('='); if (i > 0) { try { out[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); } catch (e) { /* skip */ } }
    });
    return out;
  }
  /* `#token=…` is saved and the URL left clean (a bookmark that opens the dashboard); site, range
     and event come from the query (`#site=&event=` still works for old links). */
  var hash = params(location.hash.slice(1)), q = params(location.search.slice(1));
  if (hash.token) { state.token = hash.token; save(TOKEN_KEY, state.token); }
  else state.token = load(TOKEN_KEY);
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  var site = q.site || hash.site; if (site) save('footworn.site', site);
  state.openEvent = q.event || hash.event || null;
  if (RANGES.indexOf(Number(q.days)) >= 0) state.days = Number(q.days);
  else if (isDay(q.from) && isDay(q.to) && q.from <= q.to) { state.days = 0; state.from = q.from; state.to = q.to; }
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  if (state.token) start(); else showGate();
})();
