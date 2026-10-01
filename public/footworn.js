/* Footworn's tracker. Loaded as <script async src="https://…/footworn.js" data-site="your-site">.
   Counts one pageview on load and exposes window.footworn.count(path) and
   window.footworn.event(name, props). Sends nothing over file://, on localhost (unless
   data-local="1"), inside an iframe, or to a browser driven by automation. No cookies, no
   storage, no ids: the body carries the path, the referrer, the viewport width and the
   language, and the server keeps nothing that names you (see /privacy).
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
    function base(path) {
      return { p: path || location.pathname, r: document.referrer || '', w: window.innerWidth, l: navigator.language || '' };
    }
    window.footworn = {
      count: function (path) { send(base(path)); },
      event: function (name, props) { var d = base(); d.e = name; if (props) d.props = props; send(d); }
    };
    if (s.getAttribute('data-auto') !== '0') window.footworn.count();
  } catch (e) { /* never the host page's problem */ }
})();
