/* Today's visits, one by one: the panel beside the snowfield. Newest first, grouped by hour,
   filtered (first pages, events, phones), and each one arriving live slides in on top as its
   footprints start walking. A row is rounded as the API rounds it (src/stats.js, `visits`): the
   minute, the device class, browser and system families; nothing joins two rows. In the valley
   it lists every site, in a clearing that site alone. Hovering or focusing a row asks the scene to
   ring the stone and the gate of that visit. Empties at UTC midnight, with the snowfall. */
(function () {
  'use strict';

  var PAGE = 200;   // rows drawn at once; "Show more" adds as many again
  var KEEP = 2000;  // rows kept per site, newest first: what /api/visits gives at most
  var STORE = 'footworn.visits.open';

  window.FootwornVisits = function (o) {
    /* o: { siteName(id) -> string, totals(site | null) -> { pageviews, events }, onHover({ site, path, ref } | null) } */
    var $ = function (id) { return document.getElementById(id); };
    var state = { rows: [], view: null, filter: 'all', shown: PAGE, open: false };
    var regionName = (function () { try { var d = new Intl.DisplayNames(['en'], { type: 'region' }); return function (c) { return d.of(c); }; } catch (e) { return function (c) { return c; }; } })();
    var reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

    function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function flag(c) { return /^[A-Z]{2}$/.test(c || '') ? String.fromCodePoint(127397 + c.charCodeAt(0), 127397 + c.charCodeAt(1)) : ''; }
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function clock(minute) { var d = new Date(minute * 1000); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
    /* The footprint each device leaves in the snow, small. */
    var FOOT = {
      phone: '<svg class="foot" viewBox="-7 -4 14 8" aria-hidden="true"><ellipse cx=".8" cy="0" rx="3.4" ry="1.9"/><ellipse cx="-3.2" cy=".15" rx="1.7" ry="1.5"/><circle cx="4.9" cy="-1.5" r=".8"/><circle cx="5.4" cy="-.45" r=".72"/><circle cx="5.4" cy=".55" r=".64"/><circle cx="5.1" cy="1.45" r=".56"/></svg>',
      tablet: '<svg class="foot" viewBox="-7 -4 14 8" aria-hidden="true"><rect x="-5" y="-2.2" width="10.6" height="4.4" rx="2.2"/></svg>',
      desktop: '<svg class="foot" viewBox="-7 -4 14 8" aria-hidden="true"><rect x="-1.4" y="-2.5" width="7.8" height="5" rx="2.2"/><rect x="-6.2" y="-2.3" width="3.4" height="4.6" rx=".9"/></svg>',
    };

    function same(a, b) {
      return ['site', 'minute', 'path', 'ref', 'device', 'browser', 'os', 'lang', 'country', 'first', 'event'].every(function (k) { return (a[k] || null) === (b[k] || null); }) &&
        JSON.stringify(a.props || null) === JSON.stringify(b.props || null);
    }
    function keep(v) {
      if (state.view && v.site !== state.view) return false;
      if (state.filter === 'first') return !!v.first;
      if (state.filter === 'events') return !!v.event;
      if (state.filter === 'phones') return v.device === 'phone';
      return true;
    }
    function props(p) {
      if (!p || typeof p !== 'object') return '';
      return Object.keys(p).map(function (k) { return k + ': ' + p[k]; }).join(' · ');
    }
    function row(v, i) {
      var what = v.event
        ? '<span class="chip event">event · ' + esc(v.event) + '</span>' + (props(v.props) ? '<span class="chip">' + esc(props(v.props)) + '</span>' : '')
        : v.first ? '<span class="chip first">first page today</span>' : '<span class="chip">another page</span>';
      var dev = v.device ? '<span class="chip">' + (FOOT[v.device] || '') + esc(v.device) + '</span>' : '';
      var sys = v.browser || v.os ? '<span class="chip">' + esc([v.browser, v.os].filter(Boolean).join(' · ')) + '</span>' : '';
      var lang = v.lang ? '<span class="chip" title="Language">' + esc(v.lang) + '</span>' : '';
      var where = v.country ? '<span class="flag" title="' + esc(regionName(v.country)) + '">' + flag(v.country) + '</span><span class="sr-only">' + esc(regionName(v.country)) + '</span>' : '';
      var site = state.view ? '' : '<span class="site">' + esc(o.siteName(v.site)) + '</span>';
      return '<li><button type="button" class="visit' + (v.fresh && !reduced ? ' fresh' : '') + '" data-i="' + i + '">' +
        '<span class="when num">' + clock(v.minute) + '</span>' +
        '<span class="what"><span class="line">' + where + site + '<span class="path">' + esc(v.path) + '</span>' +
        (v.event ? '' : '<span class="from">from ' + esc(v.ref || 'direct') + '</span>') + '</span>' +
        '<span class="chips">' + what + dev + sys + lang + '</span></span></button></li>';
    }

    var list = [];
    function paint() {
      list = state.rows.filter(keep);
      var html = '', hour = null, n = Math.min(list.length, state.shown);
      for (var i = 0; i < n; i++) {
        var h = new Date(list[i].minute * 1000).getHours();
        if (h !== hour) { hour = h; html += '<li class="hour" aria-hidden="true">' + pad(h) + ':00</li>'; }
        html += row(list[i], i);
      }
      $('visits-list').innerHTML = html || '<li class="empty">' + (state.rows.length ? 'No visit matches this filter yet.' : 'No visits yet today.') + '</li>';
      $('visits-more').hidden = list.length <= n;
      /* The day's real totals (the scene's counts); the list holds at most the newest KEEP of each site. */
      var t = o.totals(state.view), pv = t.pageviews, ev = t.events, held = 0;
      state.rows.forEach(function (v) { if (!state.view || v.site === state.view) held++; });
      $('visits-count').textContent = pv.toLocaleString('en') + (pv === 1 ? ' pageview' : ' pageviews') + ' · ' + ev.toLocaleString('en') + (ev === 1 ? ' event' : ' events') + ' today' +
        (held < pv + ev ? ' · the latest ' + held.toLocaleString('en') + ' listed' : '');
      state.rows.forEach(function (v) { v.fresh = false; });
    }

    $('visits-filters').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      state.filter = b.dataset.f; state.shown = PAGE;
      Array.prototype.forEach.call(this.children, function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      paint();
    });
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
        state.rows = rows; state.shown = PAGE; paint();
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
        if (!state.view || m.site === state.view) paint();
      },
      view: function (site) { state.view = site || null; state.shown = PAGE; o.onHover(null); paint(); },
      clear: function () { state.rows = []; paint(); },
      remembered: function () { try { return localStorage.getItem(STORE) !== '0'; } catch (e) { return true; } },
      remember: function (on) { try { localStorage.setItem(STORE, on ? '1' : '0'); } catch (e) { /* no storage */ } },
    };
  };
})();
