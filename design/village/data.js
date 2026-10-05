/* Made-up numbers in the shape of /api/scene for two sites, plus a fake live feed. */
(function () {
  'use strict';
  var REF_COLORS = ['#6fa3ff', '#ff7a45', '#4fd0ff', '#ff4f6d', '#a08cff', '#9aa3b8', '#e6ebf7'];
  var SITES = [
    { id: 'hallownest', name: 'Hallownest calculator', visitors: 184, yesterday: 161, live: 4, tint: '#8fb8ff',
      pages: [['/', 142, .72, 18], ['/charms', 96, .81, 31], ['/bosses', 61, .55, 9], ['/map', 44, .64, 4], ['/en/', 31, .40, 2], ['/import', 18, .9, 11], ['/about', 9, .2, 0], ['other pages', 6, .3, 0]],
      refs: [['reddit.com', 88], ['google.com', 61], ['steamcommunity.com', 27], ['youtube.com', 14], ['elsewhere', 12], ['direct', 205]] },
    { id: 'pharloom', name: 'Pharloom calculator', visitors: 97, yesterday: 112, live: 2, tint: '#ff8d6b',
      pages: [['/', 71, .66, 7], ['/tools', 52, .78, 14], ['/crests', 33, .6, 5], ['/es/', 20, .45, 1], ['/import', 11, .85, 6], ['/about', 4, .25, 0]],
      refs: [['reddit.com', 41], ['google.com', 38], ['discord.com', 12], ['elsewhere', 9], ['direct', 91]] },
  ];
  SITES.forEach(function (s) {
    s.pages = s.pages.map(function (p) { return { path: p[0], pv: p[1], used: p[2], events: p[3] }; });
    s.refs = s.refs.map(function (r, i) {
      var c = r[0] === 'elsewhere' ? REF_COLORS[5] : r[0] === 'direct' ? REF_COLORS[6] : REF_COLORS[i % 5];
      return { ref: r[0], n: r[1], color: c };
    });
    s.pageviews = s.pages.reduce(function (a, p) { return a + p.pv; }, 0);
    s.events = s.pages.reduce(function (a, p) { return a + p.events; }, 0);
    var now = new Date().getUTCHours();
    s.hours = [];
    for (var h = 0; h < 24; h++) {
      var shape = Math.max(.05, Math.sin((h - 6) / 24 * Math.PI * 2) * .5 + .55) * (h > 17 && h < 23 ? 1.4 : 1);
      var base = s.pageviews / 14 * shape;
      s.hours.push({ hour: h, today: h <= now ? Math.round(base * (.8 + Math.sin(h * 7.3) * .2)) : 0, yesterday: Math.round(base * (.85 + Math.cos(h * 3.1) * .2)) });
    }
  });
  function pick(list, w) {
    var t = list.reduce(function (a, x) { return a + w(x); }, 0), r = Math.random() * t;
    for (var i = 0; i < list.length; i++) { r -= w(list[i]); if (r <= 0) return list[i]; }
    return list[list.length - 1];
  }
  /* Every so often a pageview, sometimes an event, on a site weighted by its traffic. */
  function feed(cb) {
    (function next() {
      setTimeout(function () {
        var s = pick(SITES, function (x) { return x.pageviews; });
        var p = pick(s.pages, function (x) { return x.pv; });
        var r = pick(s.refs, function (x) { return x.n; });
        cb({ site: s, page: p, ref: r, event: Math.random() < .22 ? 'screen' : null, used: Math.random() < p.used });
        next();
      }, 500 + Math.random() * 1400);
    })();
  }
  window.DATA = { sites: SITES, feed: feed, pick: pick };
})();
