/* The live socket: a ticket from /api/live-ticket (the admin token never goes in a URL), then
   /live, which relays every counted hit. Reconnects with backoff; a ping every 30 s keeps
   proxies from dropping it. While the tab is hidden the socket is closed, and `onResume` lets
   app.js reload the counts it missed. */
(function () {
  'use strict';

  window.FootwornLive = function (o) {
    /* o: { ticket() -> Promise<string>, onMessage(msg), onState('connecting'|'open'|'closed'|'unauthorized'), onResume() } */
    var ws = null, timer = null, ping = null, backoff = 1000, stopped = true;

    function open() {
      clearTimeout(timer);
      if (stopped || ws) return;
      o.onState('connecting');
      o.ticket().then(function (ticket) {
        if (stopped || ws) return;
        var url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/live?ticket=' + encodeURIComponent(ticket);
        var sock = ws = new WebSocket(url);
        sock.onopen = function () {
          backoff = 1000; o.onState('open');
          ping = setInterval(function () { try { sock.send('ping'); } catch (e) { /* closing */ } }, 30000);
        };
        sock.onmessage = function (e) {
          if (e.data === 'pong') return;
          var msg; try { msg = JSON.parse(e.data); } catch (err) { return; }
          if (msg && typeof msg.site === 'string') o.onMessage(msg);
        };
        sock.onclose = function () {
          clearInterval(ping);
          if (ws === sock) ws = null;
          o.onState('closed');
          retry();
        };
      }).catch(function (e) {
        if (e && e.message === 'unauthorized') { stopped = true; o.onState('unauthorized'); return; }
        o.onState('closed');
        retry();
      });
    }
    function retry() {
      if (stopped) return;
      clearTimeout(timer);
      timer = setTimeout(open, backoff);
      backoff = Math.min(backoff * 2, 30000);
    }
    function close() {
      clearTimeout(timer); clearInterval(ping);
      var sock = ws; ws = null;
      if (sock) { sock.onclose = null; try { sock.close(1000); } catch (e) { /* gone */ } }
      o.onState('closed');
    }

    document.addEventListener('visibilitychange', function () {
      if (stopped && !ws && document.hidden) return;
      if (document.hidden) { if (!stopped) { close(); stopped = 'hidden'; } }
      else if (stopped === 'hidden') { stopped = false; backoff = 1000; o.onResume(); open(); }
    });

    return {
      start: function () { stopped = document.hidden ? 'hidden' : false; open(); },
      stop: function () { stopped = true; close(); },
    };
  };
})();
