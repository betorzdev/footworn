/* Footworn's tracker. Loaded as <script async src="https://…/footworn.js" data-site="your-site">.
   Counts one pageview on load and exposes window.footworn.count(path) and
   window.footworn.event(name, props). A reload counts only as a new day's first visit. Once
   per load (not on a reload), at the first tap or key or after 10 s in view, it sends
   `$engaged`: the page was used, not just opened (a plain event; whether it was sent lives in
   this page's memory, never in the browser's storage). Sends
   nothing over file://, on localhost (unless data-local="1"), inside an iframe, or to a browser
   driven by automation. No cookies, no storage, no ids: the body carries the path, the referrer
   (or the link's ?ref= / ?utm_source=), the viewport width and the language, and the server
   keeps nothing that names you (see /privacy).
   Nothing in here may ever break the host page: every step is inside try/catch. */
(function () {
  try {
    var s = document.currentScript;
    if (!s) return;
    var site = s.getAttribute('data-site');
    var api = s.src.replace(/[^/]*$/, 'c');
    var local = s.getAttribute('data-local') === '1';
    function skip() {
      if (!site) return true;
      if (location.protocol === 'file:') return true;
      if (!local && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return true;
      try { if (window.top !== window) return true; } catch (e) { return true; }
      if (navigator.webdriver) return true;
      return false;
    }
    function send(data) {
      try {
        if (skip()) return;
        data.s = site;
        var body = JSON.stringify(data);
        try {
          if (navigator.sendBeacon && navigator.sendBeacon(api, new Blob([body], { type: 'text/plain' }))) return;
        } catch (e) { /* falls through */ }
        try {
          fetch(api, { method: 'POST', body: body, keepalive: true, mode: 'no-cors', headers: { 'Content-Type': 'text/plain' } });
        } catch (e) { /* nothing to do */ }
      } catch (e) { /* a circular props object, say: not the host page's problem */ }
    }
    var campaign = '';
    try { var q = new URLSearchParams(location.search); campaign = q.get('ref') || q.get('utm_source') || ''; } catch (e) { /* no campaign */ }
    function base(path) {
      return { p: path || location.pathname, r: document.referrer || '', c: campaign, w: window.innerWidth, l: navigator.language || '' };
    }
    function event(name, props) { var d = base(); d.e = name; if (props) d.props = props; send(d); }
    window.footworn = {
      count: function (path) { send(base(path)); },
      /* `$` names are Footworn's own. */
      event: function (name, props) { if (String(name).charAt(0) !== '$') event(name, props); }
    };
    /* Used, not just opened: the first tap or key, or 10 s with the tab visible (the clock stops
       while it is hidden). Once per load. */
    function engaged() {
      var done = false, left = 10000, since = 0, timer = 0, path = location.pathname;  // the page this load counted
      function fire() {
        try {
          if (done) return;
          done = true; clearTimeout(timer);
          removeEventListener('pointerdown', fire, true); removeEventListener('keydown', fire, true);
          document.removeEventListener('visibilitychange', clock);
          var d = base(path); d.e = '$engaged'; send(d);
        } catch (e) { /* never the host page's problem */ }
      }
      function clock() {
        try {
          if (done) return;
          if (document.visibilityState === 'visible') { if (!timer) { since = Date.now(); timer = setTimeout(fire, left); } }
          else if (timer) { clearTimeout(timer); timer = 0; left -= Date.now() - since; }
        } catch (e) { /* never the host page's problem */ }
      }
      addEventListener('pointerdown', fire, { capture: true, passive: true });
      addEventListener('keydown', fire, { capture: true, passive: true });
      document.addEventListener('visibilitychange', clock);
      clock();
    }
    /* A reload is the same visit again, not a new one. Its pageview goes marked `rl`, and the
       collector keeps it only when it is the visitor's first of the day (a tab left open
       overnight); it sends no `$engaged`. So a reload that is kept counts as a load that can't be
       used: the used share leans a little low for overnight tabs, never high from refreshes, and
       nothing more has to be stored to pair the two. Events and footworn.count() go as usual. */
    function reloaded() {
      try {
        var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
        if (nav) return nav.type === 'reload';
        return !!(performance.navigation && performance.navigation.type === 1);
      } catch (e) { return false; }
    }
    if (s.getAttribute('data-auto') !== '0' && !skip()) {
      if (reloaded()) { var d = base(); d.rl = 1; send(d); }
      else { window.footworn.count(); engaged(); }
    }
  } catch (e) { /* never the host page's problem */ }
})();
