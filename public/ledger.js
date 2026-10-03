/* The ledger: a drawer of plain numbers over the bay, for the site on screen. Totals with
   their rates, the day chart, the hour or weekday and screen-width profiles, a table per
   dimension and the detail of one event, all read from /api/stats and /api/event. It is also the
   scene's text alternative: every count the canvas draws is here as a table. Charts are inline
   SVG; the CSP allows no inline code, so nothing here sets a style attribute in markup. */
(function () {
  'use strict';

  window.FootwornLedger = function (o) {
    /* o: { api(path) -> Promise<json>, unauthorized(), onUrl() } */
    var RANGES = [1, 7, 30, 90];
    var $ = function (id) { return document.getElementById(id); };
    var state = { site: null, days: 30, from: null, to: null, event: null, openEvent: null, open: false };

    function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function fmt(n) { return (n || 0).toLocaleString('en'); }
    /* Totals past a million go compact ("1.2M") so the tile never overflows; the exact number is the title. */
    var compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
    function tile(id, n) { var el = $(id); el.textContent = n >= 1e6 ? compact.format(n) : fmt(n); el.title = n >= 1e6 ? fmt(n) : ''; }
    /* The rates under the totals: per day of the range, pageviews per visitor, the share of loads
       that were used (the tracker's `$engaged`: a tap, a key or 10 s in view), and the change
       against the previous period of the same length. Derived on screen, never stored. */
    var oneDecimal = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });
    function rates(st) {
      var days = span(st), t = st.totals, p = st.previous;
      $('u-visitors').innerHTML = line([oneDecimal.format(t.visitors / days) + ' a day', delta(t.visitors, p, 'visitors', days)]);
      $('u-hits').innerHTML = line([t.visitors ? oneDecimal.format(t.hits / t.visitors) + ' per visitor' : '', used(t, p, days), delta(t.hits, p, 'hits', days)]);
      $('u-events').innerHTML = line([oneDecimal.format(t.events / days) + ' a day', delta(t.events, p, 'events', days)]);
    }
    /* Over `loads`, the pageviews since the tracker first sent `$engaged` (src/stats.js); nothing
       when there are none, rather than a misleading 0%. */
    function pct(engaged, loads) { return loads ? Math.min(100, Math.round(100 * engaged / loads)) : 0; }
    function used(t, p, days) {
      if (!t.engaged || !t.loads) return '';
      var was = p && p.engaged && p.loads ? '; previous ' + days + ' d: ' + pct(p.engaged, p.loads) + '%' : '';
      return '<span title="' + esc('Loads where the page was used: a tap, a key or 10 s in view' + was) + '">' + pct(t.engaged, t.loads) + '% used</span>';
    }
    function span(st) { return Math.round((Date.parse(st.to) - Date.parse(st.from)) / 86400000) + 1; }
    function line(parts) { return parts.filter(Boolean).join(' · '); }
    /* "▲ 12% vs previous 30 d"; a fall is red pen. Nothing when the previous period had nothing to compare with. */
    function delta(now, p, key, days) {
      if (!p || !p[key]) return '';
      var pct = Math.round(100 * (now - p[key]) / p[key]), down = pct < 0;
      return '<span class="delta' + (down ? ' down' : '') + '" title="' + esc(p.from + ' to ' + p.to + ': ' + fmt(p[key])) + '">' +
        (pct ? (down ? '▼' : '▲') + ' ' + Math.abs(pct) + '%' : 'no change') + '<span class="vs"> vs previous ' + days + ' d</span></span>';
    }
    /* Axis labels: "Sep 25". The ISO day stays in the tables and the URL, where it is the key. */
    var shortDay = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    function fmtDay(iso) { return shortDay.format(new Date(Date.parse(iso))); }
    function day(d) { return d.toISOString().slice(0, 10); }
    function addDays(iso, n) { return day(new Date(Date.parse(iso) + n * 86400000)); }
    /* A real calendar day: V8 parses 2026-02-31 as March 3, so the round trip has to match. */
    function isDay(s) { if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false; var t = Date.parse(s); return !isNaN(t) && day(new Date(t)) === s; }
    function reduced() { return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; }

    function api(path) { return o.api(path); }
    function busy(on) { $('ledger').setAttribute('aria-busy', on ? 'true' : 'false'); }
    /* Retry repeats the request that failed: the stats, or the one event that was being opened. */
    var retry = null;
    function showError(msg, again) {
      var el = $('ledger-error');
      el.textContent = msg || '';
      retry = msg ? again || null : null;
      if (retry) { var b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.id = 'retry'; b.textContent = 'Retry'; el.appendChild(b); }
      el.hidden = !msg;
    }
    $('ledger-error').addEventListener('click', function (e) { if (e.target.closest('#retry') && retry) retry(); });
    function failed(e, again) {
      busy(false);
      if (e.message === 'unauthorized') o.unauthorized();
      else showError('Could not load (' + e.message + ').', again || refresh);
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
    /* The ledger's part of the URL (app.js writes the rest): `days=` or `from=&to=`, plus `event=`. */
    function query() {
      var q = state.days ? 'days=' + state.days : 'from=' + state.from + '&to=' + state.to;
      if (state.event) q += '&event=' + encodeURIComponent(state.event);
      return q;
    }
    function syncUrl() { o.onUrl(); }

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
      tile('t-visitors', st.totals.visitors);
      tile('t-hits', st.totals.hits);
      tile('t-events', st.totals.events);
      rates(st);
      $('chart').innerHTML = chartBlock('days', st.days, st.from, st.to, false, $('chart'));
      rhythm(st);
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

    /* One dimension: value, count, visitors, and for pages the share of loads used. Event names are buttons (keyboard and mouse open the detail). */
    function table(title, rows, key, countLabel, empty, clickable) {
      var max = rows.length ? rows[0][key] : 0;
      var withVisitors = rows.length && rows[0].visitors !== undefined && !clickable;
      var withUsed = rows.some(function (r) { return r.engaged && r.loads; });
      var body = rows.length ? rows.map(function (r) {
        var w = max ? Math.round(100 * r[key] / max) : 0;
        var cell = clickable
          ? '<button type="button" class="evt" data-value="' + esc(r.value) + '">' + esc(r.value) + '</button>'
          : '<span title="' + esc(r.value) + '">' + esc(r.value) + '</span>';
        return '<tr><td class="v"><div class="fill" data-w="' + w + '"></div>' + cell + '</td>' +
          '<td class="n num">' + fmt(r[key]) + '</td>' +
          (withVisitors ? '<td class="n num muted">' + fmt(r.visitors) + '</td>' : '') +
          (withUsed ? '<td class="n num muted" title="' + esc(fmt(r.engaged) + ' of ' + fmt(r.loads) + ' loads used') + '">' + (r.loads ? pct(r.engaged, r.loads) + '%' : '–') + '</td>' : '') +
          '</tr>';
      }).join('') : '';
      var th = function (t) { return '<th scope="col"><span class="sr-only">' + esc(t) + '</span></th>'; };
      var head = '<thead><tr>' + th(title) + th(countLabel) + (withVisitors ? th('Visitors') : '') + (withUsed ? th('Used') : '') + '</tr></thead>';
      return '<section class="panel"><h2>' + esc(title) + '</h2>' +
        (rows.length ? '<table class="dim">' + head + '<tbody>' + body + '</tbody></table>' : '<p class="empty">' + esc(empty || 'Nothing yet') + '</p>') + '</section>';
    }

    /* --- the charts --- */
    /* Every day of the range, even the empty ones. */
    function fillDays(days, from, to) {
      var byDay = {}; days.forEach(function (d) { byDay[d.day] = d; });
      var list = [];
      for (var d = from; d <= to; d = addDays(d, 1)) list.push(byDay[d] || { day: d, hits: 0, visitors: 0 });
      return list;
    }

    /* The charts on screen, by key, so a box that changes width gets its chart drawn again. */
    var charts = {};

    /* Bars for pageviews, a line for visitors (events: bars only), plus the same numbers as a table. */
    function chartBlock(key, days, from, to, bars, box) {
      var list = fillDays(days, from, to);
      charts[key] = { box: box, draw: function () { return chart(list, bars, box); } };
      return chart(list, bars, box) +
        (bars ? '' : '<div class="legend"><span class="bar"><i></i>Pageviews</span><span class="line"><i></i>Visitors</span></div>') +
        dataTable(bars ? ['Day', 'Times'] : ['Day', 'Pageviews', 'Visitors'], list.map(function (d) {
          return bars ? [d.day, fmt(d.hits)] : [d.day, fmt(d.hits), fmt(d.visitors)];
        }));
    }

    /* A chart's numbers, folded under "Data": the same figures for a screen reader or a copy. */
    function dataTable(headers, rows) {
      return '<details class="data"><summary>Data</summary><table><thead><tr>' +
        headers.map(function (h) { return '<th scope="col">' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td class="num">' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') +
        '</tbody></table></details>';
    }

    /* The page's rule pitch (tokens.css --lh): a chart is drawn a whole number of rules high so its baseline sits on a line. */
    function rule() { return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--lh')) || 28; }
    /* Drawn at its box's pixel width so the labels are real CSS pixels; redrawn on resize. */
    function width(box) {
      var cs = getComputedStyle(box), w = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      return Math.round(Math.max(280, w > 0 ? w : $('chart').clientWidth || 1000));
    }
    /* The frame every chart shares: ticks at 0, half and the top, one ink column per item (`hits`,
       `title` as its tooltip), the item's `label` under it (opts.label(d, i, W) may return ''),
       and opts.marks: dashed red-pen verticals at a column position (`at`, fractional) with a note.
       Returns the open SVG with x(i) (a column's centre) and y(v), for a caller that draws more. */
    function frame(list, box, opts) {
      var W = width(box), H = opts.rules * rule(), L = opts.L, B = 28, T = 10, R = 8;
      var iw = W - L - R, ih = H - T - B;
      var max = Math.max(1, Math.max.apply(null, list.map(function (d) { return d.hits; })));
      var step = iw / list.length;
      var x = function (i) { return L + i * step + step / 2; };
      var y = function (v) { return T + ih - ih * v / max; };
      var out = '<svg class="' + opts.cls + '" data-w="' + W + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opts.aria) + '">';
      var ticks = [];
      [0, 0.5, 1].forEach(function (f) { var v = Math.round(max * f); if (ticks.indexOf(v) < 0) ticks.push(v); });
      ticks.forEach(function (v) {
        out += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--border)" stroke-width="1"/>' +
               '<text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end" fill="var(--muted)">' + v + '</text>';
      });
      list.forEach(function (d, i) {
        var bw = Math.max(1, step * 0.6);
        out += '<rect x="' + (x(i) - bw / 2) + '" y="' + y(d.hits) + '" width="' + bw + '" height="' + (T + ih - y(d.hits)) + '" fill="var(--bar)">' +
               '<title>' + esc(d.title) + '</title></rect>';
      });
      list.forEach(function (d, i) {
        var l = opts.label(d, i, W);
        if (l) out += '<text x="' + x(i) + '" y="' + (H - 8) + '" text-anchor="middle" fill="var(--muted)">' + esc(l) + '</text>';
      });
      (opts.marks || []).forEach(function (m) {
        var mx = L + m.at * step;
        out += '<line x1="' + mx + '" x2="' + mx + '" y1="' + T + '" y2="' + (T + ih) + '" stroke="var(--line)" stroke-dasharray="2 3"/>' +
               '<text x="' + (mx + 4) + '" y="' + (T + 10) + '" fill="var(--accent)" stroke="var(--bg)" stroke-width="3" paint-order="stroke">' + esc(m.text) + '</text>';
      });
      return { out: out, x: x, y: y };
    }
    /* The day chart: eight rules, a date under every nth column, the visitors line over the bars. */
    function chart(list, bars, box) {
      var items = list.map(function (d) {
        return { day: d.day, hits: d.hits, visitors: d.visitors, title: d.day + ': ' + d.hits + (bars ? ' times' : ' pageviews, ' + d.visitors + ' visitors') };
      });
      var f = frame(items, box, {
        rules: 8, L: 44, cls: 'days', aria: bars ? 'Times by day' : 'Pageviews and visitors by day',
        label: function (d, i, W) { var every = Math.ceil(items.length / Math.max(2, Math.floor(W / 120))); return i % every ? '' : fmtDay(d.day); },
      });
      var out = f.out;
      if (!bars) {
        var pts = items.map(function (d, i) { return f.x(i).toFixed(1) + ',' + f.y(d.visitors).toFixed(1); });
        out += '<polyline points="' + pts.join(' ') + '" fill="none" stroke="var(--line)" stroke-width="2" stroke-linejoin="round"/>';
      }
      return out + '</svg>';
    }
    /* A single-series column chart six rules high: the hour, weekday and width profiles. */
    function columns(list, box, aria, marks) {
      return frame(list, box, { rules: 6, L: 36, cls: 'cols', aria: aria, marks: marks, label: function (d) { return d.label; } }).out + '</svg>';
    }

    /* --- the rhythm row: when people come, and on what screens --- */
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    /* The API's 24 UTC buckets turned to the viewer's clock. Whole hours, by today's offset: a
       half-hour zone lands on the nearest hour, and a range across a clock change is off by one.
       The range itself is still cut on UTC days (the API's key), which the subtitle says. */
    function hourList(hours) {
      var utc = [], i; for (i = 0; i < 24; i++) utc[i] = 0;
      hours.forEach(function (h) { utc[h.hour] = h.hits; });
      var shift = Math.round(-new Date().getTimezoneOffset() / 60), list = [];
      for (i = 0; i < 24; i++) {
        var n = utc[((i - shift) % 24 + 24) % 24];
        list.push({ label: i % 6 ? '' : pad(i) + 'h', hits: n, title: pad(i) + ':00–' + pad(i) + ':59: ' + n + ' pageviews', row: [pad(i) + ':00', fmt(n)] });
      }
      return list;
    }
    /* SQLite's %w (0 is Sunday), Monday first. Pageviews per occurrence of the weekday in the range:
       a 30-day range holds some weekdays five times and others four, so raw sums would not compare. */
    var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    function weekdayList(weekdays, from, to) {
      var by = {}, times = {}; weekdays.forEach(function (w) { by[w.weekday] = w.hits; });
      for (var d = from; d <= to; d = addDays(d, 1)) { var w = new Date(Date.parse(d)).getUTCDay(); times[w] = (times[w] || 0) + 1; }
      return [1, 2, 3, 4, 5, 6, 0].map(function (w) {
        var n = by[w] || 0, k = times[w] || 1, avg = n / k;
        return { label: DAYS[w], hits: avg, title: DAYS[w] + ': ' + oneDecimal.format(avg) + ' pageviews a day (' + n + ' over ' + k + ')', row: [DAYS[w], oneDecimal.format(avg)] };
      });
    }
    /* 100 px buckets from 300 (or lower, if a screen is) to 1900, every one present, then "2000+". */
    var WIDTH_FLOOR = 300, WIDTH_CAP = 2000, BUCKET = 100;
    function widthList(widths) {
      var by = {}, floor = WIDTH_FLOOR, over = 0;
      widths.forEach(function (w) { if (w.bucket >= WIDTH_CAP) over += w.hits; else { by[w.bucket] = w.hits; floor = Math.min(floor, w.bucket); } });
      var list = [];
      for (var b = floor; b < WIDTH_CAP; b += BUCKET) {
        var n = by[b] || 0, range = b + '–' + (b + BUCKET - 1);
        list.push({ label: list.length % 3 ? '' : String(b), hits: n, title: range + ' px: ' + n + ' pageviews', row: [range, fmt(n)] });
      }
      list.push({ label: '', hits: over, title: WIDTH_CAP + ' px and up: ' + over + ' pageviews', row: [WIDTH_CAP + '+', fmt(over)] });
      list.floor = floor;
      return list;
    }
    function panel(id, title, sub) {
      return '<section class="panel" id="' + id + '"><div class="hdr"><h2>' + esc(title) + '</h2><span class="sub">' + esc(sub) + '</span></div><div class="cols-box"></div></section>';
    }
    /* Draws one profile into its panel's box (the box has to be on the page: it is drawn at its width). */
    function profile(key, list, aria, marks, headers, empty) {
      var box = $(key).querySelector('.cols-box');
      if (empty) { box.innerHTML = '<p class="empty">Nothing yet</p>'; delete charts[key]; return; }
      charts[key] = { box: box, draw: function () { return columns(list, box, aria, marks); } };
      box.innerHTML = columns(list, box, aria, marks) + dataTable(headers, list.map(function (d) { return d.row; }));
    }
    /* Hours on a week or less, weekdays on more; widths always. The device cut-offs (600, 1024) are the collector's. */
    function rhythm(st) {
      var hours = span(st) <= 7, none = !st.totals.hits;
      $('rhythm').innerHTML = (hours ? panel('when', 'By hour', 'pageviews, your local time · days cut at UTC midnight') : panel('when', 'By weekday', 'pageviews a day')) +
        panel('widths', 'Screen widths', 'pageviews, 100 px buckets · tablet from 600, desktop from 1024');
      if (hours) profile('when', hourList(st.hours), 'Pageviews by hour of the day', null, ['Hour', 'Pageviews'], none);
      else profile('when', weekdayList(st.weekdays, st.from, st.to), 'Pageviews a day by weekday', null, ['Weekday', 'Pageviews a day'], none);
      var w = widthList(st.widths);
      profile('widths', w, 'Pageviews by screen width', [{ at: (600 - w.floor) / BUCKET, text: '600' }, { at: (1024 - w.floor) / BUCKET, text: '1024' }],
        ['Width (px)', 'Pageviews'], !st.widths.length);
    }

    /* A box that changed width (window, scrollbar, first layout) gets its chart drawn again. */
    var drawTimer = null;
    function redraw() {
      clearTimeout(drawTimer);
      drawTimer = setTimeout(function () {
        Object.keys(charts).forEach(function (k) {
          var c = charts[k], svg = c.box.querySelector('svg');
          if (!svg || c.box.closest('[hidden]') || Number(svg.dataset.w) === width(c.box)) return;
          svg.outerHTML = c.draw();
        });
      }, 100);
    }
    if (window.ResizeObserver) { var ro = new ResizeObserver(redraw); ro.observe($('chart')); ro.observe($('rhythm')); ro.observe($('detail')); }
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
          state.event = name; syncUrl();
          var el = $('detail');
          el.hidden = false;
          el.innerHTML = '<header><h2><span class="sr-only">Event </span>' + esc(name) + '</h2><span class="muted num">event · ' + fmt(ev.totals.hits) + ' times</span><span class="grow"></span>' +
            '<button class="btn" type="button" id="close-event">Close</button></header>' +
            chartBlock('event', ev.days, ev.from, ev.to, true, el) +
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

    /* --- the drawer --- */
    /* `event`, when given, opens that event's detail once the numbers are in. */
    function open(site, event) {
      state.site = site; state.open = true; if (event) state.openEvent = event;
      $('ledger').hidden = false;
      if (state.days) setRange(state.days); else setCustom(state.from, state.to);
    }
    function close() { state.open = false; state.event = null; $('ledger').hidden = true; seq++; o.onUrl(); }

    return {
      open: open,
      close: close,
      isOpen: function () { return state.open; },
      query: query,
      /* From the URL at boot: `days=`, or `from=&to=`, and `event=`. */
      restore: function (q) {
        if (RANGES.indexOf(Number(q.days)) >= 0) state.days = Number(q.days);
        else if (isDay(q.from) && isDay(q.to) && q.from <= q.to) { state.days = 0; state.from = q.from; state.to = q.to; }
        state.openEvent = q.event || null;
      },
    };
  };
})();
