/* design/crossing: two made-up sites as the dashboard would load them (/api/sites, /api/scene)
   and a live feed played over them: ordinary visits, views and events, and every few seconds a
   crossing (the click on the link to the other site, then, most of the time, the other site
   counting the arrival with this one as its referrer, a moment later). The options come from the
   query string (village.js reads them too). */
(function () {
  'use strict';
  var q = new URLSearchParams(location.search), contract = (q.get('contract') || 'a').toLowerCase();
  var C = window.FootwornCity;
  var SITES = [
    { id: 'pharloom', name: 'Pharloom', style: 'gilded', tint: 2, hosts: ['pharloomcalculator.com'] },
    { id: 'hallownest', name: 'Hallownest', style: 'umbra', tint: 1, hosts: ['hallownestcalculator.com'] },
  ];
  var other = { pharloom: 'hallownest', hallownest: 'pharloom' }, hostOf = { pharloom: 'pharloomcalculator.com', hallownest: 'hallownestcalculator.com' };
  var SHAPE = {
    pharloom: { pages: [['/', 46], ['/es/', 31]], refs: [['google.com', 14], ['reddit', 9], ['discord', 4]], views: [['tools', 22], ['crests', 15], ['map', 18], ['journal', 9], ['completion', 7], ['combat', 11]], events: [['lang', 6], ['import-open', 5]], today: 1, week: [50, 40] },
    hallownest: { pages: [['/', 38], ['/es/', 22]], refs: [['google.com', 11], ['youtube', 5], ['reddit', 4]], views: [['charms', 19], ['combat', 13], ['map', 12], ['bosses', 8], ['completion', 6]], events: [['lang', 4], ['import-open', 3]], today: .8, week: [30, 25] },
  };
  var CROSS_TODAY = { pharloom: 3, hallownest: 2 };   // clicks to the other site today, before the feed
  function scene(id) {
    var S = SHAPE[id], k = S.today, sum = function (l) { return l.reduce(function (a, x) { return a + x[1]; }, 0); };
    var pv = Math.round(sum(S.pages) * k), arr = CROSS_TODAY[other[id]];   // the other site's crossings arrived here
    var refs = S.refs.map(function (r) { return { value: r[0], hits: r[1] * 5 }; }).concat([{ value: hostOf[other[id]], hits: 12 }]);
    var events = S.events.map(function (e) { return { value: e[0], hits: e[1] * 6 }; });
    var byEvent = S.events.map(function (e) { return { event: e[0], hits: e[1] }; });
    var crossings = null;
    if (contract === 'c') { events.push({ value: 'sister', hits: 14 }); byEvent.push({ event: 'sister', hits: CROSS_TODAY[id] }); }   // today: a workshop
    else crossings = [{ to: other[id], hits: CROSS_TODAY[id] }];
    events.sort(function (a, b) { return a.value < b.value ? -1 : 1; });
    var hours = []; for (var h = 0; h < 24; h++) hours.push({ hour: h, today: h <= new Date().getUTCHours() ? Math.round((2 + 3 * Math.sin(h / 3.5)) * k + 2) : 0, yesterday: Math.round((2 + 3 * Math.sin(h / 3.5 + .6)) + 2) });
    return {
      site: id, now: Math.floor(Date.now() / 1000), past: false,
      pages: S.pages.map(function (p) { return { value: p[0], hits: p[1] * 6 }; }), refs: refs,
      views: S.views.map(function (v) { return { value: v[0], hits: v[1] * 5 }; }), events: events,
      today: {
        hits: pv, visitors: Math.round(pv * .7), events: sum(S.events) + sum(S.views) + CROSS_TODAY[id], viewsTotal: sum(S.views), loads: pv, engaged: Math.round(pv * .62),
        pages: S.pages.map(function (p) { return { path: p[0], hits: Math.round(p[1] * k), loads: Math.round(p[1] * k), engaged: Math.round(p[1] * k * .62), events: Math.round(p[1] * k * .8) }; }),
        refs: S.refs.map(function (r) { return { ref: r[0], hits: r[1] }; }).concat([{ ref: hostOf[other[id]], hits: arr }, { ref: null, hits: 12 }]),
        views: S.views.map(function (v) { return { view: v[0], hits: v[1] }; }),
        viewPages: S.views.map(function (v) { return { path: '/', view: v[0], hits: v[1] }; }),
        byEvent: byEvent, eventPages: byEvent.map(function (e) { return { path: '/', event: e.event, hits: e.hits }; }),
        crossings: crossings,
      },
      yesterday: { visitors: Math.round(pv * .6), pages: S.pages.map(function (p) { return { path: p[0], hits: Math.round(p[1] * .8) }; }) },
      hours: hours, week: { hits: S.week[0], views: S.week[1] },
    };
  }

  var canvas = document.getElementById('scene');
  C.init(canvas, { tip: document.getElementById('tip'), onEnter: function (id) { look(id); }, insets: function () { return { top: 16, bottom: 64, right: 0 }; } });
  C.setSites(SITES);
  SITES.forEach(function (s) { C.load(s.id, scene(s.id)); });

  /* --- the feed --- */
  function pick(l) { return l[Math.floor(Math.random() * l.length)]; }
  function hit(site, o) {
    var m = { site: site, t: Math.floor(Date.now() / 1000), path: o.path || pick(SHAPE[site].pages)[0], ref: 'ref' in o ? o.ref : null, device: 'desktop', browser: 'Chrome', os: 'Linux', lang: 'en', first: Math.random() < .6 ? 1 : 0, country: 'ES', event: o.event || null, props: o.props || null };
    C.live(m);
    log(m);
  }
  function traffic() {
    if (!busy) return;
    var site = Math.random() < .55 ? 'pharloom' : 'hallownest', r = Math.random(), S = SHAPE[site];
    if (r < .5) hit(site, { ref: Math.random() < .35 ? null : pick(S.refs)[0] });
    else if (r < .85) hit(site, { event: 'screen', props: { view: pick(S.views)[0] } });
    else hit(site, { event: 'lang', props: { lang: Math.random() < .5 ? 'es' : 'en' } });
  }
  /* A crossing: the click on the link (with `to` in options a and b), and most of the time the
     other site counting the arrival a moment later, its referrer this site's host. Nothing ties
     the two: they are two hits, as they would come. */
  function cross(from, arrives) {
    var to = other[from];
    hit(from, { event: 'sister', props: contract === 'c' ? null : { to: to } });
    if (arrives === false || arrives == null && Math.random() > .85) return;
    setTimeout(function () { hit(to, { ref: hostOf[from], path: Math.random() < .6 ? '/' : '/es/' }); }, 1500 + Math.random() * 1500);
  }
  var busy = true, turn = 0;
  setInterval(traffic, 2200);
  setInterval(function () { if (auto) cross(turn++ % 2 ? 'hallownest' : 'pharloom'); }, 9000);
  setTimeout(function () { cross('pharloom', true); }, 2500);
  var auto = true;

  /* --- the controls over the scene --- */
  var logEl = document.getElementById('log');
  function log(m) {
    if (m.event === 'screen' || m.event === 'lang') return;
    var li = document.createElement('li'), name = m.site === 'pharloom' ? 'Pharloom' : 'Hallownest';
    li.textContent = new Date().toTimeString().slice(0, 8) + '  ' + name + ': ' + (m.event ? m.event + (m.props ? ' ' + JSON.stringify(m.props) : '') : 'pageview ' + m.path + (m.ref ? ' from ' + m.ref : ''));
    logEl.insertBefore(li, logEl.firstChild);
    while (logEl.children.length > 6) logEl.removeChild(logEl.lastChild);
  }
  function look(id) { if (id === 'avenue') C.avenue(); else if (id) C.enter(id); else C.leave(); document.querySelectorAll('[data-look]').forEach(function (b) { b.setAttribute('aria-pressed', String((b.dataset.look || null) === (id || null))); }); }
  document.querySelectorAll('[data-cross]').forEach(function (b) { b.addEventListener('click', function () { cross(b.dataset.cross, b.dataset.arrives !== '0'); }); });
  document.querySelectorAll('[data-look]').forEach(function (b) { b.addEventListener('click', function () { look(b.dataset.look || null); }); });
  document.getElementById('quiet').addEventListener('click', function (e) { busy = !busy; e.currentTarget.setAttribute('aria-pressed', String(!busy)); });
  document.getElementById('auto').addEventListener('click', function (e) { auto = !auto; e.currentTarget.setAttribute('aria-pressed', String(auto)); });
  setTimeout(function () { look('avenue'); }, 300);
  window.__crossing = { cross: cross, look: look };   // for the headless check
})();
