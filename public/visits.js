/* Today, one by one: the panel beside the village, one list under a row of pills. Every visit to a
   site (a page load) stands out, newest first, grouped by hour, with a dot in its referrer's gate
   colour from the scene; between them, stepped back, every view opened inside a page (an event
   `screen` with a `view`, the convention README.md gives: "charms", "game"…), and every other
   event in its own colour, in the order they came. They sit side by side because they arrived
   side by side, never because they are tied: nothing joins two rows. The pills, one per kind with
   today's count (Visits, Views, then each event name), pick what is listed: press one or several,
   "All" to list everything again. Click a row and it unfolds in place with everything that row
   holds and today's counts around it (its page, its referrer, its country, its device); one open
   at a time, its house and gate kept lit in the scene. Every row names its site. A row is rounded
   as the API rounds it (src/stats.js, `visits`): the minute, the device class, browser and system
   families; nothing joins two rows, so a view is never hung under a visit. Over the valley it
   lists every site, in a village that site alone. Hovering or focusing a row asks the scene to
   ring the house and the gate of that visit. Empties at UTC midnight, when the windows go dark.
   While the village is turned back to a past day (`past`) there is no list: earlier days are only
   counts (docs/privacy.md), so the panel says so and offers that day in the ledger. */
(function () {
  'use strict';

  var PAGE = 200;   // rows drawn at once; "Show more" adds as many again
  var KEEP = 2000;  // rows kept per site, newest first: what /api/visits gives at most
  var STORE = 'footworn.visits.open';
  var ALL = '$all', VISIT = '$visit', VIEW = '$view';  // the pills that are not an event name: no event name starts with `$` (src/collect.js)
  function none() { return Object.create(null); }   // the picked kinds; none picked lists them all. No prototype: an event may be called `constructor`
  var PULSE = 900;  // ms an event card's count stays lit after a live one

  window.FootwornVisits = function (o) {
    /* o: { siteName(id), laneColor(id, ref), pageStats(id, path) -> { pv, loads, engaged } | null,
           openEvent(id, name), openDay(), totals(site | null) -> { visitors, pageviews, views, events, other }, onHover({ site, path, ref } | { site, path, view } | null) } */
    var $ = function (id) { return document.getElementById(id); };
    var state = { rows: [], view: null, shown: PAGE, open: false, pulse: {}, row: null, pick: none(), past: null };
    try { localStorage.removeItem('footworn.visits.tab'); localStorage.removeItem('footworn.visits.hideviews'); } catch (e) { /* no storage */ }   // the two tabs' choices, gone with them
    var regionName = (function () { try { var d = new Intl.DisplayNames(['en'], { type: 'region' }); return function (c) { return d.of(c); }; } catch (e) { return function (c) { return c; }; } })();
    var reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

    function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function flag(c) { return /^[A-Z]{2}$/.test(c || '') ? String.fromCodePoint(127397 + c.charCodeAt(0), 127397 + c.charCodeAt(1)) : ''; }
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function clock(minute) { var d = new Date(minute * 1000); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
    function fmt(n) { return (n || 0).toLocaleString('en'); }
    /* A small mark per device class: a bare foot for a phone, a trainer for a tablet, a boot for a desktop. */
    var FOOT = {
      phone: '<svg class="foot" viewBox="-7 -4 14 8" aria-hidden="true"><ellipse cx=".8" cy="0" rx="3.4" ry="1.9"/><ellipse cx="-3.2" cy=".15" rx="1.7" ry="1.5"/><circle cx="4.9" cy="-1.5" r=".8"/><circle cx="5.4" cy="-.45" r=".72"/><circle cx="5.4" cy=".55" r=".64"/><circle cx="5.1" cy="1.45" r=".56"/></svg>',
      tablet: '<svg class="foot" viewBox="-7 -4 14 8" aria-hidden="true"><rect x="-5" y="-2.2" width="10.6" height="4.4" rx="2.2"/></svg>',
      desktop: '<svg class="foot" viewBox="-7 -4 14 8" aria-hidden="true"><rect x="-1.4" y="-2.5" width="7.8" height="5" rx="2.2"/><rect x="-6.2" y="-2.3" width="3.4" height="4.6" rx=".9"/></svg>',
    };

    function same(a, b) {
      return ['site', 'minute', 'path', 'ref', 'device', 'browser', 'os', 'lang', 'country', 'first', 'event'].every(function (k) { return (a[k] || null) === (b[k] || null); }) &&
        JSON.stringify(a.props || null) === JSON.stringify(b.props || null);
    }
    function mine(v) { return !state.view || v.site === state.view; }
    /* A view opened inside a page: the `screen` event with a `view` (README.md, "Wire a site"). */
    function isView(v) { return v.event === 'screen' && v.props && typeof v.props.view === 'string'; }
    /* A row's pill: a visit, a view, or its event's name. */
    function kindOf(v) { return !v.event ? VISIT : isView(v) ? VIEW : v.event; }

    /* Every row names its site: the valley shows them all together. */
    function siteTag(v) { return '<span class="site">' + esc(o.siteName(v.site)) + '</span>'; }
    /* An event's colour, from its name: the same in its pill, its rows and every repaint. */
    var EVENT_TONES = 8;
    function tone(name) { var h = 0; for (var k = 0; k < name.length; k++) h = (h * 31 + name.charCodeAt(k)) >>> 0; return 'var(--village-site-' + (h % EVENT_TONES + 1) + ')'; }
    function propText(p) { return p ? Object.keys(p).map(function (k) { return k + ': ' + p[k]; }).join(' · ') : ''; }
    /* Every row ends alike: its country's flag, its device's mark, the chevron; and its label with both. */
    function side(v) { return '<span class="side">' + (v.country ? '<span class="flag">' + flag(v.country) + '</span>' : '') + (FOOT[v.device] || '') + '<span class="chev" aria-hidden="true">›</span></span>'; }
    function whereSaid(v) { return (v.country ? ', ' + regionName(v.country) : '') + (v.device ? ', ' + v.device : ''); }

    /* --- an event: one row like a visit, in the event's colour --- */
    function eventRow(v, i) {
      var open = state.row === v, props = propText(v.props);
      return '<li><button type="button" class="visit event' + (v.fresh && !reduced ? ' fresh' : '') + '" data-i="' + i + '" aria-expanded="' + open + '"' + (open ? ' aria-controls="visit-detail"' : '') +
        ' aria-label="' + esc(clock(v.minute) + ', ' + o.siteName(v.site) + ', event ' + v.event + (props ? ', ' + props : '') + ' on ' + v.path + whereSaid(v)) + '">' +
        '<span class="when num">' + clock(v.minute) + '</span><span class="dot" data-c="' + tone(v.event) + '"></span>' +
        '<span class="what">' + siteTag(v) + '<span class="path">' + esc(v.event) + '</span>' + (props ? '<span class="props">' + esc(props) + '</span>' : '') + '<span class="from">' + esc(v.path) + '</span></span>' +
        side(v) + '</button>' + (open ? detail(v, true) : '') + '</li>';
    }

    /* --- a visit, or a view stepped back --- */
    function row(v, i) {
      var open = state.row === v, cls = (v.fresh && !reduced ? ' fresh' : '') + '" data-i="' + i + '" aria-expanded="' + open + '"' + (open ? ' aria-controls="visit-detail"' : '');
      if (isView(v)) {
        return '<li><button type="button" class="visit view' + cls + ' aria-label="' + esc(clock(v.minute) + ', view ' + v.props.view + ' on ' + v.path + whereSaid(v)) + '">' +
          '<span class="when num">' + clock(v.minute) + '</span><span class="dot hollow"></span>' +
          '<span class="what">' + siteTag(v) +
          '<span class="path">' + esc(v.props.view) + '</span><span class="from">' + esc(v.path) + '</span></span>' +
          side(v) + '</button>' + (open ? detail(v) : '') + '</li>';
      }
      var site = siteTag(v);
      var from = v.ref || 'direct';
      var label = clock(v.minute) + ', visit, ' + (state.view ? '' : o.siteName(v.site) + ' ') + v.path + ' from ' + from + whereSaid(v);
      return '<li><button type="button" class="visit load' + cls + ' aria-label="' + esc(label) + '">' +
        '<span class="when num">' + clock(v.minute) + '</span><span class="dot" data-c="' + esc(o.laneColor(v.site, v.ref)) + '"></span>' +
        '<span class="what">' + site + '<span class="path">' + esc(v.path) + '</span><span class="from">' + esc(from) + '</span></span>' +
        side(v) + '</button>' + (open ? detail(v) : '') + '</li>';
    }
    /* One row, unfolded: everything it holds, then today's counts around it. Counted from the
       rows this panel holds (all of today, up to KEEP a site) and the scene's houses; never
       anything about the same person, because nothing ties two rows together. */
    function detail(v, asEvent) {
      var view = !asEvent && isView(v), from = v.ref || 'direct', mineSite = function (x) { return x.site === v.site && !x.event; };
      var rows = state.rows.filter(mineSite), firsts = rows.filter(function (x) { return x.first; });
      var fact = function (k, val) { return val ? '<dt>' + k + '</dt><dd>' + val + '</dd>' : ''; };
      var props = v.props ? Object.keys(v.props).map(function (k) { return '<span class="prop-chip">' + esc(k) + ': ' + esc(v.props[k]) + '</span>'; }).join('') : '';
      var facts = fact('Time', '<span class="num">' + clock(v.minute) + '</span> <span class="soft">to the minute</span>') + fact('Site', esc(o.siteName(v.site))) +
        (view || asEvent ? fact('On page', esc(v.path)) + fact('Properties', props) :
          fact('From', '<span class="dot" data-c="' + esc(o.laneColor(v.site, v.ref)) + '"></span>' + esc(from)) + fact('First page today', v.first ? 'yes' : 'no')) +
        fact('Country', v.country ? flag(v.country) + ' ' + esc(regionName(v.country)) : '') + fact('Device', esc(v.device || '')) +
        fact('Browser', esc([v.browser, v.os].filter(Boolean).join(' · '))) + fact('Language', esc(v.lang || ''));
      var bar = function (label, n, total, note) { return '<div class="r"><span>' + label + '</span><span><b class="num">' + fmt(n) + '</b> ' + note + '</span><span class="meter"><i class="bar" data-w="' + (total ? Math.round(100 * n / total) : 0) + '"></i></span></div>'; };
      var pg = o.pageStats(v.site, v.path), t = o.totals(v.site), ctx = '';
      if (pg) ctx += bar(esc(v.path), pg.pv, t.pageviews, 'pageviews' + (pg.loads ? ' · ' + Math.min(100, Math.round(100 * pg.engaged / pg.loads)) + '% used' : ''));
      if (asEvent) {
        var evs = state.rows.filter(function (x) { return x.site === v.site && x.event; }), sameEv = evs.filter(function (x) { return x.event === v.event; });
        ctx += bar('“' + esc(v.event) + '”', sameEv.length, evs.length, 'of ' + fmt(evs.length) + ' events');
        var key = v.props && Object.keys(v.props)[0];
        if (key) { var withVal = sameEv.filter(function (x) { return x.props && x.props[key] === v.props[key]; }).length; ctx += bar(esc(key) + ': ' + esc(v.props[key]), withVal, sameEv.length, 'of ' + fmt(sameEv.length)); }
      } else if (view) {
        var views = state.rows.filter(function (x) { return x.site === v.site && isView(x); }), same = views.filter(function (x) { return x.props.view === v.props.view; }).length;
        ctx += bar('“' + esc(v.props.view) + '” opened', same, views.length, 'of ' + fmt(views.length) + ' views');
      } else {
        var fromN = rows.filter(function (x) { return (x.ref || 'direct') === from; }).length;
        ctx += bar('from ' + esc(from), fromN, rows.length, 'page loads');
      }
      if (v.country) { var co = firsts.filter(function (x) { return x.country === v.country; }).length; ctx += bar(flag(v.country) + ' ' + esc(regionName(v.country)), co, firsts.length, 'of ' + fmt(firsts.length) + ' visitors'); }
      if (v.device) { var dv = firsts.filter(function (x) { return x.device === v.device; }).length; ctx += bar(esc(v.device), dv, firsts.length, 'of ' + fmt(firsts.length) + ' visitors'); }
      var cut = rows.length < t.pageviews ? '<p class="soft">Counted from the latest ' + fmt(rows.length) + ' of today’s ' + fmt(t.pageviews) + ' page loads.</p>' : '';
      if (asEvent && evs.length < t.events) cut += '<p class="soft">Counted from the latest ' + fmt(evs.length) + ' of today’s ' + fmt(t.events) + ' events; the ledger has them all.</p>';
      var ledger = (view || asEvent) && state.view ? '<button type="button" class="btn small" data-ev="' + esc(v.event) + '">Open “' + esc(v.event) + '” in the ledger</button>' : '';
      var fresh = state.unfold; state.unfold = false;   // the unfold plays once, not on every live repaint
      return '<div class="visit-detail' + (fresh ? ' unfold' : '') + '" id="visit-detail"><p class="kind' + (view || asEvent ? '' : ' is-visit') + '">' + (asEvent ? 'Event' : view ? 'A view opened in a page' : 'A visit to the site') + '</p>' +
        '<p class="page-name">' + esc(asEvent ? v.event : view ? v.props.view : v.path) + '</p><dl class="facts">' + facts + '</dl>' +
        '<div class="ctx"><h3>Today, in counts</h3>' + ctx + cut + '</div>' + ledger +
        '<p class="soft">No id, no second, no width: nothing ties this row to any other.</p></div>';
    }
    /* The listed rows, in hours, up to `shown`; `list` is what a row's data-i points into. */
    var list = [];
    function paintList(el, rows, empty) {
      list = rows;
      var html = '', hour = null, n = Math.min(list.length, state.shown);
      for (var i = 0; i < n; i++) {
        var h = new Date(list[i].minute * 1000).getHours();
        if (h !== hour) { hour = h; html += '<li class="hour" aria-hidden="true">' + pad(h) + ':00</li>'; }
        html += list[i].event && !isView(list[i]) ? eventRow(list[i], i) : row(list[i], i);
      }
      el.innerHTML = html || '<li class="empty">' + empty + '</li>';
      $('visits-more').hidden = list.length <= n;
    }
    /* A pill per kind with today's count (lit a moment when one comes in live): Visits, Views,
       then each event name, busiest first; the pressed ones filter the list below. */
    function paintPills() {
      var by = none(), names = [], all = 0, now = Date.now();
      by[VISIT] = 0;
      state.rows.forEach(function (v) { if (!mine(v)) return; var k = kindOf(v); all++; if (by[k] == null) { by[k] = 0; if (k !== VIEW) names.push(k); } by[k]++; });
      names.sort(function (a, b) { return by[b] - by[a] || (a < b ? -1 : 1); });
      for (var k in state.pick) if (by[k] == null) delete state.pick[k];
      var any = Object.keys(state.pick).length > 0;
      var pill = function (key, label, n, dot) {
        return '<button type="button" data-pick="' + esc(key) + '" aria-pressed="' + (key === ALL ? !any : !!state.pick[key]) + '">' + dot + esc(label) +
          ' <b class="num' + (key !== ALL && now - (state.pulse[key] || 0) < PULSE ? ' pulse' : '') + '">' + fmt(n) + '</b></button>';
      };
      $('visits-pills').innerHTML = pill(ALL, 'All', all, '') + pill(VISIT, 'Visits', by[VISIT], '<span class="dot"></span>') +
        (by[VIEW] != null ? pill(VIEW, 'Views', by[VIEW], '<span class="dot hollow"></span>') : '') +
        names.map(function (k) { return pill(k, k, by[k], '<span class="dot" data-c="' + tone(k) + '"></span>'); }).join('');
      var t = o.totals(state.view);
      $('visits-count').textContent = fmt(t.pageviews) + (t.pageviews === 1 ? ' visit · ' : ' visits · ') + fmt(t.views) + (t.views === 1 ? ' view · ' : ' views · ') +
        fmt(t.other) + (t.other === 1 ? ' event' : ' events') + ' today' +
        (all < t.pageviews + t.events ? ' · the latest ' + fmt(all) + ' kept' : '');
      paintList($('visits-list'), state.rows.filter(function (v) { return mine(v) && (!any || state.pick[kindOf(v)]); }), any ? 'None of these yet today.' : 'No visit yet today.');
    }

    /* Nothing is drawn while the panel is put away: `shown` catches up when it comes back. Live
       rows are drawn together, a few times a second at most (`later`). */
    var stale = false, timer = null, pulsing = null;
    function later() { if (!timer) timer = setTimeout(function () { timer = null; paint(); }, 250); }
    function paint() {
      if ($('visits').hidden) { stale = true; state.rows.forEach(function (v) { v.fresh = false; }); return; }   // nothing walks in when it comes back
      stale = false;
      var past = state.past != null;
      $('visits-when').textContent = past ? state.past : 'Today';
      $('visits-past').hidden = !past; $('visits-count').hidden = past; $('visits-pills').hidden = past; $('visits-body').hidden = past;
      if (past) {
        $('visits-more').hidden = true;
        $('visits-ledger').hidden = !state.view;   // the ledger is one site's
        return;
      }
      /* A live repaint rebuilds the list: the row that had the keyboard focus gets it back. */
      var had = document.activeElement && document.activeElement.closest ? document.activeElement.closest('#visits-body button.visit') : null, focused = had ? list[Number(had.dataset.i)] : null;
      paintPills();
      if (focused) { var j = list.indexOf(focused), back = j >= 0 && $('visits-list').querySelector('button.visit[data-i="' + j + '"]'); if (back) back.focus({ preventScroll: true }); }
      /* Colours and widths from script, not inline style: the dashboard's CSP allows no inline code. */
      Array.prototype.forEach.call(document.querySelectorAll('#visits [data-c]'), function (el) { if (el.dataset.c) el.style[el.classList.contains('dot') ? 'backgroundColor' : 'color'] = el.dataset.c; });
      Array.prototype.forEach.call(document.querySelectorAll('#visits .bar[data-w]'), function (el) { el.style.width = el.dataset.w + '%'; });
      state.rows.forEach(function (v) { v.fresh = false; });
    }

    $('visits-more').addEventListener('click', function () { state.shown += PAGE; paint(); });
    $('visits-ledger').addEventListener('click', function () { o.openDay(); });
    /* Hover or focus rings the row in the scene; an open row keeps its ring when the pointer leaves.
       A view or an event has no referrer of its own: it rings its house, no gate; a view its stall too. */
    function ringOf(v) { return !v ? null : isView(v) ? { site: v.site, path: v.path, view: v.props.view } : v.event ? { site: v.site, path: v.path } : { site: v.site, path: v.path, ref: v.ref }; }
    function point(e) { var b = e.target.closest('button.visit'); o.onHover(b ? ringOf(list[Number(b.dataset.i)]) : ringOf(state.row)); }
    var el = $('visits-list');
    el.addEventListener('mouseover', point);
    el.addEventListener('focusin', point);
    el.addEventListener('mouseleave', function () { o.onHover(ringOf(state.row)); });
    el.addEventListener('focusout', function (e) { if (!e.currentTarget.contains(e.relatedTarget)) o.onHover(ringOf(state.row)); });
    /* The ledger button inside an open row: it opens the ledger, it does not fold the row. */
    el.addEventListener('click', function (e) { var b = e.target.closest('[data-ev]'); if (b && state.view) { e.stopPropagation(); o.openEvent(state.view, b.dataset.ev); } }, true);
    /* A click (or Enter, or Space) unfolds a row, or folds it back; one open at a time. The list
       is drawn again, so the focus goes back to the row that was pressed. */
    el.addEventListener('click', function (e) {
      var b = e.target.closest('button.visit'); if (!b) return;
      var v = list[Number(b.dataset.i)]; if (!v) return;
      state.row = state.row === v ? null : v; state.unfold = !!state.row; paint(); o.onHover(ringOf(state.row || v));
      var i = list.indexOf(v), again = i >= 0 && el.querySelector('button.visit[data-i="' + i + '"]');
      if (again) again.focus({ preventScroll: true });
    });
    $('visits-pills').addEventListener('click', function (e) {
      var b = e.target.closest('[data-pick]'); if (!b) return;
      var k = b.dataset.pick;
      if (k === ALL) state.pick = none(); else if (state.pick[k]) delete state.pick[k]; else state.pick[k] = true;
      state.shown = PAGE; if (state.row) { state.row = null; o.onHover(null); } paint();
      var again = $('visits-pills').querySelector('[data-pick="' + k.replace(/["\\]/g, '\\$&') + '"]'); if (again) again.focus({ preventScroll: true });
    });
    /* On a phone the panel is a sheet: its title folds it open and shut. */
    $('visits-fold').addEventListener('click', function () {
      state.open = !state.open; $('visits').classList.toggle('open', state.open);
      this.setAttribute('aria-expanded', String(state.open));
    });

    return {
      /* Every site's rows, from /api/visits ({ site, visits }), replacing what was there. */
      set: function (answers) {
        var rows = [];
        answers.forEach(function (a) { a.visits.forEach(function (v) { v.site = a.site; rows.push(v); }); });
        rows.sort(function (a, b) { return b.minute - a.minute; });
        /* Keeps "Show more" and the open row: a refresh is not the reader's doing. */
        if (state.row) { var was = state.row; state.row = rows.filter(function (r) { return same(r, was); })[0] || null; }
        state.rows = rows; paint();
      },
      /* One message from the live socket, rounded to the minute as the API rounds it. A replayed
         one (`replay`, from the second the list was read in) is dropped if the list already has
         that very row: the hit may have been written just before the read or just after it. */
      live: function (m, replay) {
        var v = { site: m.site, minute: Math.floor(m.t / 60) * 60, path: m.path, ref: m.ref, device: m.device, browser: m.browser,
          os: m.os, lang: m.lang, country: m.country, first: m.first, event: m.event, props: m.props, fresh: true };
        if (replay && state.rows.some(function (r) { return same(r, v); })) return;
        state.rows.unshift(v);
        var n = 0;
        for (var i = 0; i < state.rows.length; i++) if (state.rows[i].site === v.site && ++n > KEEP) {
          if (state.rows[i] === state.row) { state.row = null; o.onHover(null); }   // the open row fell off the end
          state.rows.splice(i, 1); break;
        }
        if (state.view && m.site !== state.view) return;   // another village's row: nothing on screen changes
        state.pulse[kindOf(v)] = Date.now(); clearTimeout(pulsing); pulsing = setTimeout(paint, PULSE + 50);
        later();
      },
      view: function (site) { state.view = site || null; state.shown = PAGE; state.row = null; state.pick = none(); o.onHover(null); paint(); },
      clear: function () { state.rows = []; state.row = null; o.onHover(null); paint(); },
      /* The village is on a past day (its name, for the title), or back on today (null). */
      past: function (label) { state.past = label || null; state.row = null; o.onHover(null); paint(); },
      /* A site's colour changed (the Sites panel): the dots of the visits it sent elsewhere follow. */
      recolor: function () { paint(); },
      /* The panel is on screen again. */
      shown: function () { if (stale) paint(); },
      remembered: function () { try { return localStorage.getItem(STORE) !== '0'; } catch (e) { return true; } },
      remember: function (on) { try { localStorage.setItem(STORE, on ? '1' : '0'); } catch (e) { /* no storage */ } },
    };
  };
})();
