/* History: the days behind today, as a strip of bars over the dock. Every bar is a day and a
   button (its height that day's visitors, today's hollow: still being counted); press one and the
   village is turned back to that day, as it ended. ‹ › step a day, the date field goes to any
   day, Today comes back. Over the valley the bars add every site up; in a village they are that
   site's. All of it counts per day, from /api/days. The strip shows while History is pressed in
   the dock (remembered on this browser) and whenever a past day is on screen; putting it away
   comes back to today. */
(function () {
  'use strict';

  var STORE = 'footworn.history.open', DAY_MS = 86400000;
  var EARLIEST = 3660;   // days back the date field takes: what is typed on the way to a year (0002, 0020…) is no day to go to

  window.FootwornHistory = function (o) {
    /* o: { api(path) -> Promise<json>, sites() -> [{ id }], failed(e, again), onDay(day | null), onToggle() } */
    var $ = function (id) { return document.getElementById(id); };
    function utcDay() { return new Date().toISOString().slice(0, 10); }
    function addDays(iso, n) { return new Date(Date.parse(iso) + n * DAY_MS).toISOString().slice(0, 10); }
    function isDay(s) { if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false; var t = Date.parse(s); return !isNaN(t) && new Date(t).toISOString().slice(0, 10) === s; }   // a real day: no 31st of February
    function fmt(n) { return (n || 0).toLocaleString('en'); }
    function plural(n, one, many) { return fmt(n) + ' ' + (n === 1 ? one : many); }
    function remembered() { try { return localStorage.getItem(STORE) === '1'; } catch (e) { return false; } }
    function remember(on) { try { localStorage.setItem(STORE, on ? '1' : '0'); } catch (e) { /* no storage */ } }
    var LONG = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    var SHORT = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
    var MONTH = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' });
    function name(day) { return LONG.format(new Date(Date.parse(day))); }

    /* `day`: the day on screen, null for today. `to`: the last day of the bars. `by`: per site,
       per day, the row /api/days gave. */
    var state = { open: remembered(), day: null, view: null, to: utcDay(), today: utcDay(), by: Object.create(null), n: 0 };
    function count() { return window.innerWidth < 760 ? 30 : 60; }
    function shown() { return state.open || !!state.day; }
    function val(day) {
      var t = { visitors: 0, hits: 0 };
      Object.keys(state.by).forEach(function (id) {
        var r = (!state.view || id === state.view) && state.by[id][day];
        if (r) { t.visitors += r.visitors || 0; t.hits += r.hits || 0; }
      });
      return t;
    }

    /* The bars' days, for every site (the valley adds them up). A window moved meanwhile wins. */
    var seq = 0;
    function load() {
      if (!shown()) return;
      var mine = ++seq, to = state.to, from = addDays(to, -(count() - 1)), sites = o.sites();
      Promise.all(sites.map(function (s) {
        return o.api('/api/days?site=' + encodeURIComponent(s.id) + '&from=' + from + '&to=' + to);
      })).then(function (answers) {
        if (mine !== seq) return;
        var by = Object.create(null);   // no prototype: a site may be called `constructor`
        answers.forEach(function (a, i) { var m = by[sites[i].id] = {}; (a.days || []).forEach(function (d) { m[d.day] = d; }); });
        state.by = by; paint();
      }).catch(function (e) { if (mine === seq) o.failed(e, load); });
    }

    function readout(day) {
      var v = val(day), today = day === utcDay();
      $('strip-n').textContent = (today ? 'Today' : SHORT.format(new Date(Date.parse(day)))) + ' · ' + plural(v.visitors, 'visitor', 'visitors') + (today ? ' so far' : '') + ' · ' + plural(v.hits, 'pageview', 'pageviews');
    }
    function paint() {
      if ($('strip').hidden) return;
      var n = state.n = count(), today = utcDay(), sel = state.day || today, max = 1, html = '', k, d;
      for (k = 0; k < n; k++) max = Math.max(max, val(addDays(state.to, -k)).visitors);
      for (k = n - 1; k >= 0; k--) {
        d = addDays(state.to, -k);
        var v = val(d), date = new Date(Date.parse(d)), dom = date.getUTCDate();
        /* Under the bars: the month at its first day, the day of the month at each Monday clear of it. */
        var tick = dom === 1 ? MONTH.format(date) : date.getUTCDay() === 1 && dom > 3 && dom < 27 ? String(dom) : '';
        html += '<button type="button" class="day' + (d === today ? ' today' : '') + '" data-day="' + d + '" aria-pressed="' + (d === sel) + '" tabindex="' + (d === sel ? 0 : -1) + '"' +
          (tick ? ' data-tick="' + tick + '"' : '') + ' aria-label="' + name(d) + ', ' + plural(v.visitors, 'visitor', 'visitors') + '"><i data-h="' + Math.round(100 * v.visitors / max) + '"></i></button>';
      }
      /* A repaint rebuilds the bars: the keyboard's focus goes back to the day on screen. */
      var bars = $('strip-bars'), had = bars.contains(document.activeElement);
      bars.innerHTML = html;
      /* Heights from script, not inline style: the dashboard's CSP allows no inline code. */
      Array.prototype.forEach.call(bars.querySelectorAll('i'), function (i) { i.style.height = i.dataset.h + '%'; });
      if (had) { var b = bars.querySelector('[aria-pressed="true"]'); if (b) b.focus({ preventScroll: true }); }
      var input = $('strip-input'), later = $('strip-later');
      input.min = addDays(today, -EARLIEST); input.max = today;
      if (document.activeElement !== input) input.value = sel;   // never under the fingers that are typing a day
      $('strip-today').hidden = !state.day;
      if (!state.day && document.activeElement === later) $('strip-earlier').focus({ preventScroll: true });   // › goes dead on today: the focus stays in the strip
      later.disabled = !state.day;
      readout(sel);
    }
    /* Shows or hides the strip as `shown` says; answers whether that changed. */
    function sync() {
      var on = shown(), was = !$('strip').hidden;
      $('strip').hidden = !on;
      $('toggle-history').setAttribute('aria-pressed', String(on));
      return on !== was;
    }

    /* The bars hold the day on screen: one outside them comes to their middle, today brings them
       back to their end. */
    function fit() {
      var today = utcDay(), n = count(), day = state.day;
      if (!day) state.to = today;
      else if (day < addDays(state.to, -(n - 1)) || day > state.to) { state.to = addDays(day, n >> 1); if (state.to > today) state.to = today; }
    }
    /* A day asked for: a day to come is today, and today is no past day. */
    function pick(day) {
      var today = utcDay();
      if (isDay(day)) o.onDay(day >= today ? null : day);
      paint();   // a day refused, or the same one: the field shows the day on screen again
    }
    $('strip-bars').addEventListener('click', function (e) { var b = e.target.closest('.day'); if (b) pick(b.dataset.day); });
    /* One stop for Tab; ← and → walk the days. */
    $('strip-bars').addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault(); pick(addDays(state.day || utcDay(), e.key === 'ArrowLeft' ? -1 : 1));
    });
    $('strip-bars').addEventListener('mouseover', function (e) { var b = e.target.closest('.day'); readout(b ? b.dataset.day : state.day || utcDay()); });
    $('strip-bars').addEventListener('mouseleave', function () { readout(state.day || utcDay()); });
    $('strip-earlier').addEventListener('click', function () { pick(addDays(state.day || utcDay(), -1)); });
    $('strip-later').addEventListener('click', function () { pick(addDays(state.day || utcDay(), 1)); });
    $('strip-today').addEventListener('click', function () { pick(utcDay()); $('strip-earlier').focus({ preventScroll: true }); });   // the button hides: the focus stays in the strip
    /* The date field: a browser says `change` at every key that leaves a date, so the day is taken
       once the typing rests (or the field is left), and only a day inside the field's own range. */
    var typing = null;
    function typed() {
      var input = $('strip-input');
      clearTimeout(typing); typing = null;
      if (input.value && input.checkValidity()) pick(input.value); else paint();
    }
    $('strip-input').addEventListener('change', function () { clearTimeout(typing); typing = setTimeout(typed, 500); });
    $('strip-input').addEventListener('blur', function () { if (typing) typed(); else paint(); });
    $('toggle-history').addEventListener('click', function () {
      state.open = !shown(); remember(state.open);
      if (!state.open && state.day) { o.onDay(null); return; }   // put away on a past day: back to today
      if (sync()) { load(); paint(); o.onToggle(); }
    });
    /* A window turned narrow (or wide again) has other bars. */
    var resizing = null;
    window.addEventListener('resize', function () {
      clearTimeout(resizing);
      resizing = setTimeout(function () { if (shown() && count() !== state.n) { fit(); paint(); load(); } }, 300);
    });
    /* The strip itself waits for `select`, once the sites are known: only then can its bars be asked for. */
    $('toggle-history').setAttribute('aria-pressed', String(shown()));

    return {
      /* "Thu, 24 Sept 2026", for the title panel and the visits panel. */
      name: name,
      /* The day on screen, as app.js decided it: a past day, or null for today. The bars follow. */
      select: function (day) {
        var was = state.to;
        state.day = day || null; fit();
        var changed = sync();
        if (changed || state.to !== was) load();
        paint();
        if (changed) o.onToggle();
      },
      /* The site in view (its bars alone), or null over the valley (every site's, added up). */
      view: function (site) { site = site || null; if (site !== state.view) { state.view = site; paint(); } },
      /* The counts moved on (a reload, midnight): bars that ended today still end today. */
      refresh: function () {
        var today = utcDay();
        if (state.to === state.today) state.to = today;
        state.today = today; load();
      },
    };
  };
})();
