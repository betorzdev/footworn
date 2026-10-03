/* Today, one by one: the panel beside the bay, in two tabs. Visits: every pageview of the day,
   newest first, grouped by hour, where a visit (the first page of someone's day) stands out, with
   a dot in its referrer's lane colour from the scene, and another page steps back; "Only visits"
   hides the pages. Events: a card per event name with today's count, the spread of its commonest
   property and when it last happened. A row is rounded as the API rounds it (src/stats.js,
   `visits`): the minute, the device class, browser and system families; nothing joins two rows,
   so a page is never hung under a visit. In the bay it lists every site, in a skyline that site
   alone. Hovering or focusing a row asks the scene to ring the tower and the lane of that visit.
   Empties at UTC midnight, when the windows go dark. */
(function () {
  'use strict';

  var PAGE = 200;   // rows drawn at once; "Show more" adds as many again
  var KEEP = 2000;  // rows kept per site, newest first: what /api/visits gives at most
  var STORE = 'footworn.visits.open', TAB = 'footworn.visits.tab', ONLY = 'footworn.visits.only';
  var PULSE = 900;  // ms an event card's count stays lit after a live one

  window.FootwornVisits = function (o) {
    /* o: { siteName(id), siteColor(id), laneColor(id, ref), totals(site | null) -> { visitors, pageviews, events }, onHover({ site, path, ref } | null) } */
    var $ = function (id) { return document.getElementById(id); };
    function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function save(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* no storage */ } }
    var state = { rows: [], view: null, tab: load(TAB) === 'events' ? 'events' : 'visits', only: load(ONLY) === '1', shown: PAGE, open: false, pulse: {} };
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
    function keep(v) { return mine(v) && !v.event && (!state.only || v.first); }

    /* --- the visits tab --- */
    function row(v, i) {
      var visit = !!v.first, where = v.country ? regionName(v.country) : '';
      var site = state.view ? '' : '<span class="site" data-c="' + esc(o.siteColor(v.site)) + '">' + esc(o.siteName(v.site)) + '</span>';
      var from = v.ref || 'direct';
      var extra = [visit ? '' : 'from ' + from, where, v.device, [v.browser, v.os].filter(Boolean).join(' · '), v.lang].filter(Boolean).join(' · ');
      var label = clock(v.minute) + ', ' + (visit ? 'visit' : 'another page') + ', ' + (state.view ? '' : o.siteName(v.site) + ' ') + v.path + (visit ? ' from ' + from : '') + (where ? ', ' + where : '') + (v.device ? ', ' + v.device : '');
      return '<li><button type="button" class="visit ' + (visit ? 'arrive' : 'page') + (v.fresh && !reduced ? ' fresh' : '') + '" data-i="' + i + '" aria-label="' + esc(label) + '">' +
        '<span class="when num">' + clock(v.minute) + '</span>' +
        (visit ? '<span class="dot" data-c="' + esc(o.laneColor(v.site, v.ref)) + '"></span>' : '<span class="dot hollow"></span>') +
        '<span class="what">' + site + '<span class="path">' + esc(v.path) + '</span>' + (visit ? '<span class="from">' + esc(from) + '</span>' : '') + '</span>' +
        '<span class="side">' + (visit ? (v.country ? '<span class="flag">' + flag(v.country) + '</span>' : '') + (FOOT[v.device] || '') : 'page') + '</span>' +
        '<span class="extra">' + esc(extra) + '</span></button></li>';
    }
    var list = [];
    function paintVisits() {
      list = state.rows.filter(keep);
      var html = '', hour = null, n = Math.min(list.length, state.shown);
      for (var i = 0; i < n; i++) {
        var h = new Date(list[i].minute * 1000).getHours();
        if (h !== hour) { hour = h; html += '<li class="hour" aria-hidden="true">' + pad(h) + ':00</li>'; }
        html += row(list[i], i);
      }
      $('visits-list').innerHTML = html || '<li class="empty">' + (state.rows.some(mine) ? (state.only ? 'No visit yet, only pages.' : 'No pageview yet today.') : 'No visits yet today.') + '</li>';
      $('visits-more').hidden = state.tab !== 'visits' || list.length <= n;
    }

    /* --- the events tab: counted here from today's rows --- */
    function paintEvents() {
      var by = {}, names = [];
      state.rows.forEach(function (v) {
        if (!v.event || !mine(v)) return;
        var e = by[v.event]; if (!e) { e = by[v.event] = { name: v.event, n: 0, props: {}, last: v }; names.push(v.event); }
        e.n++; if (v.minute > e.last.minute) e.last = v;
        if (v.props) Object.keys(v.props).forEach(function (k) { var p = e.props[k] = e.props[k] || { n: 0, values: {} }; p.n++; p.values[v.props[k]] = (p.values[v.props[k]] || 0) + 1; });
      });
      names.sort(function (a, b) { return by[b].n - by[a].n; });
      var now = Date.now(), html = names.map(function (name) {
        var e = by[name], keys = Object.keys(e.props).sort(function (a, b) { return e.props[b].n - e.props[a].n; }), prop = '';
        if (keys.length) {
          var p = e.props[keys[0]], vals = Object.keys(p.values).sort(function (a, b) { return p.values[b] - p.values[a]; }).slice(0, 4), max = p.values[vals[0]];
          prop = '<div class="prop">' + esc(keys[0]) + (keys.length > 1 ? ' <span>(+' + (keys.length - 1) + ' more in the ledger)</span>' : '') + '<div class="bars">' +
            vals.map(function (val) { return '<span title="' + esc(val) + '">' + esc(val) + '</span><span class="bar" data-w="' + Math.round(100 * p.values[val] / max) + '"></span><span class="num">' + fmt(p.values[val]) + '</span>'; }).join('') + '</div></div>';
        }
        return '<div class="event-card"><div class="top"><span class="name">' + esc(name) + '</span><span class="count num' + (now - (state.pulse[name] || 0) < PULSE ? ' pulse' : '') + '">' + fmt(e.n) + '</span></div>' + prop +
          '<div class="last">last at <b class="num">' + clock(e.last.minute) + '</b> on <b>' + esc(e.last.path) + '</b>' + (state.view ? '' : ' · ' + esc(o.siteName(e.last.site))) + '</div></div>';
      }).join('');
      var t = o.totals(state.view), listed = names.reduce(function (n, k) { return n + by[k].n; }, 0);
      if (html && listed < t.events) html += '<p class="note">Counted from the latest ' + fmt(listed) + ' of today’s ' + fmt(t.events) + ' events; the ledger has them all.</p>';
      $('events-list').innerHTML = html || '<p class="empty">No events yet today.</p>';
    }

    function paint() {
      var t = o.totals(state.view), ev = state.tab === 'events';
      $('n-visits').textContent = fmt(t.visitors); $('n-events').textContent = fmt(t.events);
      ['visits', 'events'].forEach(function (k) { var b = $('tab-' + k), on = state.tab === k; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
      $('visits-list').hidden = ev; $('events-list').hidden = !ev; $('visits-tools').hidden = ev; $('visits-key').hidden = ev;
      $('only-visits').checked = state.only;
      var held = state.rows.filter(function (v) { return mine(v) && !v.event; }).length;
      $('visits-count').textContent = fmt(t.visitors) + (t.visitors === 1 ? ' visit · ' : ' visits · ') + fmt(t.pageviews) + (t.pageviews === 1 ? ' page' : ' pages') +
        (held < t.pageviews ? ' · the latest ' + fmt(held) + ' listed' : '');
      if (ev) { paintEvents(); $('visits-more').hidden = true; } else paintVisits();
      /* Colours and widths from script, not inline style: the dashboard's CSP allows no inline code. */
      Array.prototype.forEach.call(document.querySelectorAll('#visits [data-c]'), function (el) { if (el.dataset.c) el.style[el.classList.contains('dot') ? 'backgroundColor' : 'color'] = el.dataset.c; });
      Array.prototype.forEach.call(document.querySelectorAll('#events-list .bar[data-w]'), function (el) { el.style.width = el.dataset.w + '%'; });
      state.rows.forEach(function (v) { v.fresh = false; });
    }

    function pick(tab, focus) { state.tab = tab; save(TAB, tab); state.shown = PAGE; paint(); if (focus) $('tab-' + tab).focus(); }
    $('visits-tabs').addEventListener('click', function (e) { var b = e.target.closest('[data-tab]'); if (b) pick(b.dataset.tab); });
    $('visits-tabs').addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
      e.preventDefault(); pick(e.key === 'Home' ? 'visits' : e.key === 'End' ? 'events' : state.tab === 'visits' ? 'events' : 'visits', true);
    });
    $('only-visits').addEventListener('change', function () { state.only = this.checked; save(ONLY, state.only ? '1' : '0'); state.shown = PAGE; paint(); });
    $('visits-more').addEventListener('click', function () { state.shown += PAGE; paint(); });
    /* Hover or focus rings the visit in the scene; a tap on a touch screen does it too. */
    function point(e) { var b = e.target.closest('button.visit'); o.onHover(b ? at(b) : null); }
    function at(b) { var v = list[Number(b.dataset.i)]; return v ? { site: v.site, path: v.path, ref: v.ref } : null; }
    $('visits-list').addEventListener('mouseover', point);
    $('visits-list').addEventListener('focusin', point);
    $('visits-list').addEventListener('click', point);
    $('visits-list').addEventListener('mouseleave', function () { o.onHover(null); });
    $('visits-list').addEventListener('focusout', function (e) { if (!e.currentTarget.contains(e.relatedTarget)) o.onHover(null); });
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
        state.rows = rows; paint();   // keeps "Show more": a refresh is not the reader's doing
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
        for (var i = 0; i < state.rows.length; i++) if (state.rows[i].site === v.site && ++n > KEEP) { state.rows.splice(i, 1); break; }
        if (v.event) { state.pulse[v.event] = Date.now(); setTimeout(function () { if (state.tab === 'events') paint(); }, PULSE + 50); }
        if (!state.view || m.site === state.view) paint();
      },
      view: function (site) { state.view = site || null; state.shown = PAGE; o.onHover(null); paint(); },
      clear: function () { state.rows = []; paint(); },
      remembered: function () { try { return localStorage.getItem(STORE) !== '0'; } catch (e) { return true; } },
      remember: function (on) { try { localStorage.setItem(STORE, on ? '1' : '0'); } catch (e) { /* no storage */ } },
    };
  };
})();
