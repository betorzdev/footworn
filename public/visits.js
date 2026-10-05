/* Today, one by one: the panel beside the village, in two tabs. Visits: every visit to a site (a page
   load) stands out, newest first, grouped by hour, with a dot in its referrer's gate colour from
   the scene; between them, stepped back, every view opened inside a page (an event `screen` with
   a `view`, the convention README.md gives: "charms", "game"…), in the order they came. They sit
   side by side because they arrived side by side, never because they are tied: nothing joins two
   rows. "Hide views" leaves the loads alone. Click a row and it unfolds in place with everything that row holds and
   today's counts around it (its page, its referrer, its country, its device); one open at a
   time, its house and gate kept lit in the scene. Events: the same list, one row per event in its
   own colour, under a pill per event name with today's count that filters it. Every row names
   its site. A row is rounded as the API rounds it (src/stats.js,
   `visits`): the minute, the device class, browser and system families; nothing joins two rows,
   so a view is never hung under a visit. Over the valley it lists every site, in a village that site
   alone. Hovering or focusing a row asks the scene to ring the house and the gate of that visit.
   Empties at UTC midnight, when the windows go dark. */
(function () {
  'use strict';

  var PAGE = 200;   // rows drawn at once; "Show more" adds as many again
  var KEEP = 2000;  // rows kept per site, newest first: what /api/visits gives at most
  var STORE = 'footworn.visits.open', TAB = 'footworn.visits.tab', HIDE = 'footworn.visits.hideviews';
  var ALL = '$all';  // the "All" pill's key: no event name starts with `$` (src/collect.js)
  var PULSE = 900;  // ms an event card's count stays lit after a live one

  window.FootwornVisits = function (o) {
    /* o: { siteName(id), laneColor(id, ref), pageStats(id, path) -> { pv, loads, engaged } | null,
           openEvent(id, name), totals(site | null) -> { visitors, pageviews, events }, onHover({ site, path, ref } | { site, path, view } | null) } */
    var $ = function (id) { return document.getElementById(id); };
    function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function save(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* no storage */ } }
    var state = { rows: [], view: null, tab: load(TAB) === 'events' ? 'events' : 'visits', hide: load(HIDE) === '1', shown: PAGE, open: false, pulse: {}, row: null, evf: ALL };
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
    function keep(v) { return mine(v) && (!v.event || (!state.hide && isView(v))); }

    /* Every row names its site: the valley shows them all together. */
    function siteTag(v) { return '<span class="site">' + esc(o.siteName(v.site)) + '</span>'; }
    /* An event's colour, from its name: the same in its pill, its rows and every repaint. */
    var EVENT_TONES = 8;
    function tone(name) { var h = 0; for (var k = 0; k < name.length; k++) h = (h * 31 + name.charCodeAt(k)) >>> 0; return 'var(--village-site-' + (h % EVENT_TONES + 1) + ')'; }
    function propText(p) { return p ? Object.keys(p).map(function (k) { return k + ': ' + p[k]; }).join(' · ') : ''; }

    /* --- the events tab: one row per event, like the visits --- */
    function eventRow(v, i) {
      var open = state.row === v, where = v.country ? regionName(v.country) : '', props = propText(v.props);
      return '<li><button type="button" class="visit event' + (v.fresh && !reduced ? ' fresh' : '') + '" data-i="' + i + '" aria-expanded="' + open + '"' + (open ? ' aria-controls="visit-detail"' : '') +
        ' aria-label="' + esc(clock(v.minute) + ', ' + o.siteName(v.site) + ', event ' + v.event + (props ? ', ' + props : '') + ' on ' + v.path + (where ? ', ' + where : '')) + '">' +
        '<span class="when num">' + clock(v.minute) + '</span><span class="dot" data-c="' + tone(v.event) + '"></span>' +
        '<span class="what">' + siteTag(v) + '<span class="path">' + esc(v.event) + '</span>' + (props ? '<span class="props">' + esc(props) + '</span>' : '') + '<span class="from">' + esc(v.path) + '</span></span>' +
        '<span class="side">' + (v.country ? '<span class="flag">' + flag(v.country) + '</span>' : '') + (FOOT[v.device] || '') + '<span class="chev" aria-hidden="true">›</span></span>' +
        '</button>' + (open ? detail(v, true) : '') + '</li>';
    }

    /* --- the visits tab --- */
    function row(v, i) {
      var open = state.row === v, cls = (v.fresh && !reduced ? ' fresh' : '') + '" data-i="' + i + '" aria-expanded="' + open + '"' + (open ? ' aria-controls="visit-detail"' : '');
      if (isView(v)) {
        return '<li><button type="button" class="visit view' + cls + ' aria-label="' + esc(clock(v.minute) + ', view ' + v.props.view + ' on ' + v.path) + '">' +
          '<span class="when num">' + clock(v.minute) + '</span><span class="dot hollow"></span>' +
          '<span class="what">' + siteTag(v) +
          '<span class="path">' + esc(v.props.view) + '</span><span class="from">' + esc(v.path) + '</span></span>' +
          '<span class="side">view<span class="chev" aria-hidden="true">›</span></span></button>' + (open ? detail(v) : '') + '</li>';
      }
      var where = v.country ? regionName(v.country) : '';
      var site = siteTag(v);
      var from = v.ref || 'direct';
      var label = clock(v.minute) + ', visit, ' + (state.view ? '' : o.siteName(v.site) + ' ') + v.path + ' from ' + from + (where ? ', ' + where : '') + (v.device ? ', ' + v.device : '');
      return '<li><button type="button" class="visit load' + cls + ' aria-label="' + esc(label) + '">' +
        '<span class="when num">' + clock(v.minute) + '</span><span class="dot" data-c="' + esc(o.laneColor(v.site, v.ref)) + '"></span>' +
        '<span class="what">' + site + '<span class="path">' + esc(v.path) + '</span><span class="from">' + esc(from) + '</span></span>' +
        '<span class="side">' + (v.country ? '<span class="flag">' + flag(v.country) + '</span>' : '') + (FOOT[v.device] || '') + '<span class="chev" aria-hidden="true">›</span></span>' +
        '</button>' + (open ? detail(v) : '') + '</li>';
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
      if (pg) ctx += bar(pg.other ? 'other pages <span class="soft">(outside the top 8)</span>' : esc(v.path), pg.pv, t.pageviews, 'pageviews' + (pg.loads ? ' · ' + Math.min(100, Math.round(100 * pg.engaged / pg.loads)) + '% used' : ''));
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
    /* The open tab's rows, in hours, up to `shown`; `list` is what a row's data-i points into. */
    var list = [];
    function paintList(el, rows, draw, empty) {
      list = rows;
      var html = '', hour = null, n = Math.min(list.length, state.shown);
      for (var i = 0; i < n; i++) {
        var h = new Date(list[i].minute * 1000).getHours();
        if (h !== hour) { hour = h; html += '<li class="hour" aria-hidden="true">' + pad(h) + ':00</li>'; }
        html += draw(list[i], i);
      }
      el.innerHTML = html || '<li class="empty">' + empty + '</li>';
      $('visits-more').hidden = list.length <= n;
    }
    function paintVisits() { paintList($('visits-list'), state.rows.filter(keep), row, 'No visit yet today.'); }
    /* Events: a pill per name with today's count (lit a moment when one comes in live), which
       filters the list below. */
    function paintEvents() {
      var by = Object.create(null), names = [], all = 0, now = Date.now();   // no prototype: an event may be called `constructor`
      state.rows.forEach(function (v) { if (!v.event || !mine(v)) return; all++; if (!by[v.event]) { by[v.event] = 0; names.push(v.event); } by[v.event]++; });
      names.sort(function (a, b) { return by[b] - by[a] || (a < b ? -1 : 1); });
      if (state.evf !== ALL && !by[state.evf]) state.evf = ALL;
      var pill = function (key, label, n, dot) {
        return '<button type="button" data-evf="' + esc(key) + '" aria-pressed="' + (state.evf === key) + '">' + (dot ? '<span class="dot" data-c="' + dot + '"></span>' : '') + esc(label) +
          ' <b class="num' + (key !== ALL && now - (state.pulse[key] || 0) < PULSE ? ' pulse' : '') + '">' + fmt(n) + '</b></button>';
      };
      $('event-chips').innerHTML = names.length ? pill(ALL, 'All', all) + names.map(function (k) { return pill(k, k, by[k], tone(k)); }).join('') : '';
      var t = o.totals(state.view);
      $('events-count').textContent = fmt(t.events) + (t.events === 1 ? ' event' : ' events') + ' today · ' + names.length + (names.length === 1 ? ' kind' : ' kinds') +
        (all < t.events ? ' · the latest ' + fmt(all) + ' listed' : '');
      paintList($('events-list'), state.rows.filter(function (v) { return v.event && mine(v) && (state.evf === ALL || v.event === state.evf); }), eventRow, 'No events yet today.');
    }

    /* Nothing is drawn while the panel is put away: `shown` catches up when it comes back. Live
       rows are drawn together, a few times a second at most (`later`). */
    var stale = false, timer = null, pulsing = null;
    function later() { if (!timer) timer = setTimeout(function () { timer = null; paint(); }, 250); }
    function paint() {
      if ($('visits').hidden) { stale = true; state.rows.forEach(function (v) { v.fresh = false; }); return; }   // nothing walks in when it comes back
      stale = false;
      var t = o.totals(state.view), ev = state.tab === 'events';
      $('n-visits').textContent = fmt(t.pageviews); $('n-events').textContent = fmt(t.events);   // a visit here is a load of the site
      ['visits', 'events'].forEach(function (k) { var b = $('tab-' + k), on = state.tab === k; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
      $('visits-list').hidden = ev; $('events-list').hidden = !ev; $('visits-tools').hidden = ev; $('visits-key').hidden = ev; $('events-head').hidden = !ev;
      $('hide-views').checked = state.hide;
      var held = state.rows.filter(function (v) { return mine(v) && !v.event; }).length, views = state.rows.filter(function (v) { return mine(v) && isView(v); }).length;
      $('visits-count').textContent = fmt(t.pageviews) + (t.pageviews === 1 ? ' visit · ' : ' visits · ') + fmt(views) + (views === 1 ? ' view' : ' views') +
        (held < t.pageviews ? ' · the latest ' + fmt(held) + ' listed' : '');
      /* A live repaint rebuilds the list: the row that had the keyboard focus gets it back. */
      var had = document.activeElement && document.activeElement.closest ? document.activeElement.closest('#visits-body button.visit') : null, focused = had ? list[Number(had.dataset.i)] : null;
      if (ev) paintEvents(); else paintVisits();
      if (focused) { var j = list.indexOf(focused), back = j >= 0 && openList().querySelector('button.visit[data-i="' + j + '"]'); if (back) back.focus({ preventScroll: true }); }
      /* Colours and widths from script, not inline style: the dashboard's CSP allows no inline code. */
      Array.prototype.forEach.call(document.querySelectorAll('#visits [data-c]'), function (el) { if (el.dataset.c) el.style[el.classList.contains('dot') ? 'backgroundColor' : 'color'] = el.dataset.c; });
      Array.prototype.forEach.call(document.querySelectorAll('#visits .bar[data-w]'), function (el) { el.style.width = el.dataset.w + '%'; });
      state.rows.forEach(function (v) { v.fresh = false; });
    }

    function pick(tab, focus) { state.tab = tab; save(TAB, tab); state.row = null; o.onHover(null); state.shown = PAGE; paint(); if (focus) $('tab-' + tab).focus(); }
    $('visits-tabs').addEventListener('click', function (e) { var b = e.target.closest('[data-tab]'); if (b) pick(b.dataset.tab); });
    $('visits-tabs').addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
      e.preventDefault(); pick(e.key === 'Home' ? 'visits' : e.key === 'End' ? 'events' : state.tab === 'visits' ? 'events' : 'visits', true);
    });
    $('hide-views').addEventListener('change', function () { state.hide = this.checked; save(HIDE, state.hide ? '1' : '0'); state.shown = PAGE; if (state.row && isView(state.row) && state.hide) { state.row = null; o.onHover(null); } paint(); });
    $('visits-more').addEventListener('click', function () { state.shown += PAGE; paint(); });
    /* Hover or focus rings the row in the scene; an open row keeps its ring when the pointer leaves.
       A view or an event has no referrer of its own: it rings its house, no gate; a view its stall too. */
    function ringOf(v) { return !v ? null : isView(v) ? { site: v.site, path: v.path, view: v.props.view } : v.event ? { site: v.site, path: v.path } : { site: v.site, path: v.path, ref: v.ref }; }
    function openList() { return state.tab === 'events' ? $('events-list') : $('visits-list'); }
    function point(e) { var b = e.target.closest('button.visit'); o.onHover(b ? ringOf(list[Number(b.dataset.i)]) : ringOf(state.row)); }
    ['visits-list', 'events-list'].forEach(function (id) {
      var el = $(id);
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
        var i = list.indexOf(v), again = i >= 0 && openList().querySelector('button.visit[data-i="' + i + '"]');
        if (again) again.focus({ preventScroll: true });
      });
    });
    $('event-chips').addEventListener('click', function (e) {
      var b = e.target.closest('[data-evf]'); if (!b) return;
      state.evf = b.dataset.evf; state.shown = PAGE; if (state.row) { state.row = null; o.onHover(null); } paint();
      var again = $('event-chips').querySelector('[data-evf="' + b.dataset.evf.replace(/["\\]/g, '\\$&') + '"]'); if (again) again.focus({ preventScroll: true });
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
        if (v.event) { state.pulse[v.event] = Date.now(); clearTimeout(pulsing); pulsing = setTimeout(function () { if (state.tab === 'events') paint(); }, PULSE + 50); }
        if (!state.view || m.site === state.view) later();
      },
      view: function (site) { state.view = site || null; state.shown = PAGE; state.row = null; state.evf = ALL; o.onHover(null); paint(); },
      clear: function () { state.rows = []; state.row = null; o.onHover(null); paint(); },
      /* The panel is on screen again. */
      shown: function () { if (stale) paint(); },
      remembered: function () { try { return localStorage.getItem(STORE) !== '0'; } catch (e) { return true; } },
      remember: function (on) { try { localStorage.setItem(STORE, on ? '1' : '0'); } catch (e) { /* no storage */ } },
    };
  };
})();
