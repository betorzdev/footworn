/* Footworn's dashboard. One classic script: asks the token once, reads /api/*, draws the day chart
   as inline SVG and the tables. No framework, no build. */
(function () {
  'use strict';
  var TOKEN_KEY = 'footworn.token';
  var $ = function (id) { return document.getElementById(id); };
  var state = { token: null, site: null, days: 30, from: null, to: null, sites: [] };

  function load(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function save(key, v) { try { if (v === null) localStorage.removeItem(key); else localStorage.setItem(key, v); } catch (e) { /* no storage */ } }

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(n) { return (n || 0).toLocaleString('en'); }
  function day(d) { return d.toISOString().slice(0, 10); }
  function addDays(iso, n) { return day(new Date(Date.parse(iso) + n * 86400000)); }

  function api(path) {
    return fetch(path, { headers: { Authorization: 'Bearer ' + state.token } }).then(function (r) {
      if (r.status === 401) { throw new Error('unauthorized'); }
      if (!r.ok) { throw new Error('HTTP ' + r.status); }
      return r.json();
    });
  }

  /* --- gate --- */
  function showGate(msg) {
    $('dash').hidden = true; $('gate').hidden = false;
    $('gate-error').hidden = !msg; $('gate-error').textContent = msg || '';
    $('token').focus();
  }
  $('gate-form').addEventListener('submit', function (e) {
    e.preventDefault();
    state.token = $('token').value.trim();
    start();
  });
  $('logout').addEventListener('click', function () { save(TOKEN_KEY, null); state.token = null; $('token').value = ''; showGate(); });

  function start() {
    api('/api/sites').then(function (sites) {
      save(TOKEN_KEY, state.token);
      state.sites = sites;
      $('gate').hidden = true; $('dash').hidden = false;
      var sel = $('site');
      sel.innerHTML = sites.map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>'; }).join('');
      if (!sites.length) { sel.innerHTML = '<option value="">No sites yet</option>'; }
      var want = load('footworn.site');
      if (want && sites.some(function (s) { return s.id === want; })) sel.value = want;
      state.site = sel.value;
      setRange(state.days);
    }).catch(function (e) {
      showGate(e.message === 'unauthorized' ? 'That token is not accepted.' : 'Could not reach the API: ' + e.message);
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
  function paintRange() {
    Array.prototype.forEach.call($('ranges').children, function (b) {
      b.setAttribute('aria-pressed', String(state.days && Number(b.dataset.days) === state.days));
    });
  }
  $('ranges').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (b) setRange(Number(b.dataset.days));
  });
  function custom() {
    if (!$('from').value || !$('to').value) return;
    state.from = $('from').value; state.to = $('to').value; state.days = 0;
    paintRange(); refresh();
  }
  $('from').addEventListener('change', custom);
  $('to').addEventListener('change', custom);
  $('site').addEventListener('change', function () { state.site = $('site').value; save('footworn.site', state.site); refresh(); });

  /* --- stats --- */
  function refresh() {
    if (!state.site) return;
    $('detail').hidden = true;
    api('/api/stats?site=' + encodeURIComponent(state.site) + '&from=' + state.from + '&to=' + state.to)
      .then(render).catch(function (e) { if (e.message === 'unauthorized') showGate('The token stopped working.'); else alert(e.message); });
  }

  function render(st) {
    $('t-visitors').textContent = fmt(st.totals.visitors);
    $('t-hits').textContent = fmt(st.totals.hits);
    $('t-events').textContent = fmt(st.totals.events);
    $('chart').innerHTML = chart(st.days, st.from, st.to);
    if (state.openEvent) { var ev = state.openEvent; state.openEvent = null; openEvent(ev); }
    $('tables').innerHTML = [
      table('Pages', st.path, 'hits'),
      table('Referrers', st.ref, 'hits', 'Direct or none'),
      table('Events', st.events, 'hits', 'No events', 'evt'),
      table('Countries', st.country, 'hits'),
      table('Languages', st.lang, 'hits'),
      table('Browsers', st.browser, 'hits'),
      table('Systems', st.os, 'hits'),
      table('Devices', st.device, 'hits'),
    ].join('');
    fills($('tables'));
  }

  /* The bars behind the table values. Set from script, not inline style: the dashboard's CSP
     (public/_headers) allows no inline code at all. */
  function fills(el) {
    Array.prototype.forEach.call(el.querySelectorAll('.fill[data-w]'), function (f) { f.style.width = f.dataset.w + '%'; });
  }

  function table(title, rows, key, empty, cls) {
    var max = rows.length ? rows[0][key] : 0;
    var body = rows.length ? rows.map(function (r) {
      var w = max ? Math.round(100 * r[key] / max) : 0;
      return '<tr class="' + (cls || '') + '" data-value="' + esc(r.value) + '">' +
        '<td class="v"><div class="fill" data-w="' + w + '"></div><span>' + esc(r.value) + '</span></td>' +
        '<td class="n num">' + fmt(r[key]) + '</td>' +
        (r.visitors !== undefined && cls !== 'evt' ? '<td class="n num muted" title="Visitors">' + fmt(r.visitors) + '</td>' : '') +
        '</tr>';
    }).join('') : '';
    return '<section class="panel"><h2>' + esc(title) + '</h2>' +
      (rows.length ? '<table>' + body + '</table>' : '<p class="empty">' + esc(empty || 'Nothing yet') + '</p>') + '</section>';
  }

  /* Bars for pageviews, a line for visitors; every day of the range, even the empty ones. */
  function chart(days, from, to, bars) {
    var byDay = {}; days.forEach(function (d) { byDay[d.day] = d; });
    var list = [];
    for (var d = from; d <= to; d = addDays(d, 1)) list.push(byDay[d] || { day: d, hits: 0, visitors: 0 });
    var W = 1000, H = 220, L = 44, B = 28, T = 10, R = 8;
    var iw = W - L - R, ih = H - T - B;
    var max = Math.max(1, Math.max.apply(null, list.map(function (d) { return d.hits; })));
    var step = iw / list.length;
    var y = function (v) { return T + ih - ih * v / max; };
    var out = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Pageviews and visitors by day">';
    var ticks = [];
    [0, 0.5, 1].forEach(function (f) { var v = Math.round(max * f); if (ticks.indexOf(v) < 0) ticks.push(v); });
    ticks.forEach(function (v) {
      out += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--border)" stroke-width="1"/>' +
             '<text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end" font-size="11" fill="var(--muted)" class="num">' + v + '</text>';
    });
    list.forEach(function (d, i) {
      var x = L + i * step, bw = Math.max(1, step * 0.6);
      out += '<rect x="' + (x + (step - bw) / 2) + '" y="' + y(d.hits) + '" width="' + bw + '" height="' + (T + ih - y(d.hits)) + '" fill="var(--bar)">' +
             '<title>' + d.day + ': ' + d.hits + ' pageviews, ' + d.visitors + ' visitors</title></rect>';
    });
    if (!bars) {
      var pts = list.map(function (d, i) { return (L + i * step + step / 2).toFixed(1) + ',' + y(d.visitors).toFixed(1); });
      out += '<polyline points="' + pts.join(' ') + '" fill="none" stroke="var(--line)" stroke-width="2" stroke-linejoin="round"/>';
    }
    var every = Math.ceil(list.length / 8);
    list.forEach(function (d, i) {
      if (i % every) return;
      out += '<text x="' + (L + i * step + step / 2) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="11" fill="var(--muted)" class="num">' + d.day.slice(5) + '</text>';
    });
    return out + '</svg>';
  }

  /* --- one event --- */
  $('tables').addEventListener('click', function (e) {
    var tr = e.target.closest('tr.evt'); if (tr) openEvent(tr.dataset.value);
  });
  function openEvent(name) {
    api('/api/event?site=' + encodeURIComponent(state.site) + '&name=' + encodeURIComponent(name) + '&from=' + state.from + '&to=' + state.to)
      .then(function (ev) {
        var el = $('detail');
        el.innerHTML = '<header><h2>Event · ' + esc(name) + '</h2><span class="muted num">' + fmt(ev.totals.hits) + ' times</span></header>' +
          chart(ev.days, ev.from, ev.to, true) +
          '<div class="grid">' + table('On page', ev.paths, 'hits') +
          Object.keys(ev.props).map(function (k) { return table('Property · ' + k, ev.props[k], 'hits'); }).join('') + '</div>';
        fills(el);
        el.hidden = false;
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }).catch(function (e) { alert(e.message); });
  }

  /* --- boot --- */
  /* `#token=…&site=…&event=…`: the token is saved and the URL left clean (a bookmark that opens
     the dashboard); site and event pick what to show first. */
  var hash = {};
  location.hash.slice(1).split('&').forEach(function (kv) {
    var i = kv.indexOf('='); if (i > 0) hash[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
  });
  if (hash.token) { state.token = hash.token; save(TOKEN_KEY, state.token); history.replaceState(null, '', location.pathname); }
  else state.token = load(TOKEN_KEY);
  if (hash.site) save('footworn.site', hash.site);
  state.openEvent = hash.event || null;
  if (state.token) start(); else showGate();
})();
