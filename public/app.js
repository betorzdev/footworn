/* Footworn's dashboard: the village. One classic script ties the parts together. It asks the token
   once (kept in localStorage), reads /api/sites and /api/scene for each site, feeds the scene
   (village.js), keeps the live socket (live.js), opens the ledger (ledger.js), hands the
   scene's cues to the sound (sound.js) and turns the village back to a past day when the history
   strip (history.js) asks: that day's /api/scene, nothing live. The view lives in
   the query string (`?site=&day=&ledger=1&days=30&event=`), so a link reopens it; the token only ever
   travels in the hash (`#token=`). */
(function () {
  'use strict';
  var TOKEN_KEY = 'footworn.token';
  var $ = function (id) { return document.getElementById(id); };
  var state = { token: null, sites: [], icons: {}, site: null, day: null, viewDay: null, buffer: null, started: false, empty: false };   // `day`: today as last seen; `viewDay`: the past day on screen, null for today; `icons`: each site's icon as a blob URL
  var scene = window.FootwornCity;
  var touch = !!(window.matchMedia && matchMedia('(hover: none)').matches);

  function load(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function save(key, v) { try { if (v === null) localStorage.removeItem(key); else localStorage.setItem(key, v); } catch (e) { /* no storage */ } }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(n) { return (n || 0).toLocaleString('en'); }
  function utcDay() { return new Date().toISOString().slice(0, 10); }
  function isDay(s) { if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false; var t = Date.parse(s); return !isNaN(t) && new Date(t).toISOString().slice(0, 10) === s; }   // a real day: no 31st of February

  /* A read, or with `init` ({ method, body, headers }) one of the Sites panel's writes: a string
     body is JSON unless said otherwise. An answer that is not ok throws its `error`, if it gave one. */
  function api(path, init) {
    var o = init || {}, h = { Authorization: 'Bearer ' + state.token }, k;
    for (k in o.headers || {}) h[k] = o.headers[k];
    if (typeof o.body === 'string' && !h['Content-Type']) h['Content-Type'] = 'application/json';
    return fetch(path, { method: o.method || 'GET', headers: h, body: o.body }).then(function (r) {
      if (r.status === 401) throw new Error('unauthorized');
      if (!r.ok) return r.json().catch(function () { return null; }).then(function (j) { throw new Error(j && j.error ? j.error : 'HTTP ' + r.status); });
      return r.json();
    });
  }

  /* --- errors: one line over the scene, with Retry when there is something to repeat --- */
  var retry = null;
  function showError(msg, again, label) {
    var el = $('error');
    el.textContent = msg || '';
    retry = msg ? again || null : null;
    if (retry) { var b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.id = 'retry'; b.textContent = label || 'Retry'; el.appendChild(b); }
    el.hidden = !msg;
  }
  $('error').addEventListener('click', function (e) { if (e.target.closest('#retry') && retry) retry(); });
  function failed(e, again) {
    if (e.message === 'unauthorized') showGate('The token stopped working. Paste it again.');
    else showError('Could not load (' + e.message + ').', again);
  }

  /* --- gate --- */
  function showGate(msg) {
    if (live) live.stop();
    $('ui').hidden = true; $('gate').hidden = false; connQuiet();
    $('gate-error').hidden = !msg; $('gate-error').textContent = msg || '';
    $('token').focus();
  }
  /* One request at a time: the button is disabled until the token is accepted or refused. */
  $('gate-form').addEventListener('submit', function (e) {
    e.preventDefault();
    state.token = $('token').value.trim();
    $('gate-form').querySelector('button').disabled = true;
    start();
  });
  /* Lock forgets the token, and coming back needs it again: a first press only asks, a second
     within a few seconds locks. */
  var arming = null;
  function disarm() { clearTimeout(arming); arming = null; var b = $('logout'); b.textContent = 'Lock'; b.classList.remove('armed'); }
  $('logout').addEventListener('click', function () {
    if (!arming) { this.textContent = 'Lock? You’ll need the token'; this.classList.add('armed'); arming = setTimeout(disarm, 4000); return; }
    disarm(); save(TOKEN_KEY, null); state.token = null; $('token').value = ''; showGate();
  });
  $('logout').addEventListener('blur', function () { if (arming) disarm(); });

  /* --- the parts --- */
  var ledger = window.FootwornLedger({
    api: api,
    unauthorized: function () { showGate('The token stopped working. Paste it again.'); },
    onUrl: syncUrl,
  });
  var visits = window.FootwornVisits({ siteName: siteName, laneColor: function (id, ref) { return scene.laneColor(id, ref); },
    pageStats: function (id, path) { return scene.pageStats(id, path); }, openEvent: function (id, name) { openEvent(id, name); },
    openDay: function () { if (state.site && state.viewDay) openLedger(null, { from: state.viewDay, to: state.viewDay }); },
    totals: function (site) { return scene.stats(site); }, onHover: function (h) { scene.highlight(h); } });
  state.showVisits = visits.remembered();
  var sound = window.FootwornSound();
  var live = window.FootwornLive({
    ticket: function () { return api('/api/live-ticket').then(function (r) { return r.ticket; }); },
    onMessage: function (msg) { sitesPanel.live(msg); if (state.viewDay) return; if (state.buffer) state.buffer.push(msg); else { scene.live(msg); visits.live(msg); } },   // a past day is over; today is read again on the way back
    onState: paintLive,
    onResume: reloadAll,
  });
  var strip = window.FootwornHistory({
    api: api,
    failed: function (e, again) { failed(e, function () { showError(null); again(); }); },   // its Retry takes the line away itself: no reload follows it
    sites: function () { return state.sites; },
    onDay: setDay,
    onToggle: function () { if (state.started) scene.refit(true); },
  });

  /* The Sites panel: a site added, dressed (the village is its preview), edited or removed; after
     each write the sites are read again and the valley follows. */
  var sitesPanel = window.FootwornSites({
    api: api, scene: scene,
    sites: function () { return state.sites; },
    iconUrl: function (id) { return state.icons[id] || null; },
    today: function (id) { return state.viewDay ? null : scene.stats(id); },   // today's counts, or null while a past day is on screen
    /* `iconOf`: the site whose icon was just changed, fetched again; the others keep theirs. */
    onChange: function (iconOf) {
      return api('/api/sites').then(function (sites) {
        var had = state.site;
        applySites(sites, iconOf);
        if (had && !sites.some(function (s) { return s.id === had; })) leave();
        return reloadAll();
      });
    },
    onOpen: function () { if (ledger.isOpen()) ledger.close(); paintPanel(); scene.refit(true); syncUrl(); },
    onClose: function () { paintPanel(); scene.refit(true); },
  });

  /* The panels' room at the top, bottom and right of the window, so the scene frames what they leave free. */
  function insets() {
    var top = 16, bottom = 16, right = 0, W = window.innerWidth, H = window.innerHeight;
    ['.hud', '.stats', '.strip', '.dock'].forEach(function (sel) {
      var r = document.querySelector(sel).getBoundingClientRect(); if (!r.height) return;
      if (r.top + r.height / 2 < H / 2) top = Math.max(top, r.bottom); else bottom = Math.max(bottom, H - r.top);
    });
    /* An open ledger, or the visits panel, takes the right of a wide window; on a phone the
       panel is a sheet at the bottom. */
    var led = $('ledger'), vis = $('visits'), st = $('sites');
    if (!led.hidden && led.offsetWidth < W) right = led.offsetWidth;
    else if (!st.hidden && st.offsetWidth < W) right = st.offsetWidth;
    else if (!vis.hidden) {
      var v = vis.getBoundingClientRect();
      if (v.height > H / 2 && v.left > W * .4) right = W - v.left; else bottom = Math.max(bottom, H - v.top);
    }
    return { top: top + 12, bottom: bottom + 12, right: right };
  }

  function start() {
    api('/api/sites').then(function (sites) {
      $('gate-form').querySelector('button').disabled = false;
      save(TOKEN_KEY, state.token);
      state.sites = sites;
      $('gate').hidden = true; $('ui').hidden = false; paintPanel();
      if (!state.started) {
        state.started = true;
        scene.init($('scene'), { tip: $('tip'), insets: insets, onEnter: go, onLeave: leave, onCue: sound.cue });
        /* The scene measures the panels' room when it is told it changed, not in every frame. */
        if (window.ResizeObserver) {
          var ro = new ResizeObserver(function () {
            scene.resized();
            /* On a phone the history strip hangs under the title panel, whatever its height (style.css). */
            document.documentElement.style.setProperty('--hud-bottom', Math.round(document.querySelector('.hud').getBoundingClientRect().bottom) + 'px');
          });
          ['.hud', '.stats', '.strip', '.dock', '#visits', '#ledger', '#sites'].forEach(function (sel) { ro.observe(document.querySelector(sel)); });
        }
      }
      applySites(sites);
      var want = state.site; state.site = null;
      restoring = true;
      try {
        if (want && sites.some(function (s) { return s.id === want; })) go(want, true); else paintView();
        applyDay();
        if (want && state.site && state.ledgerOnBoot) openLedger();
      } finally { restoring = false; }
      syncUrl(true);
      live.start();
      reloadAll();
    }).catch(function (e) {
      $('gate-form').querySelector('button').disabled = false;
      showGate(e.message === 'unauthorized' ? 'That token is not accepted. Check it and try again.' : 'Could not reach the API (' + e.message + '). Check that the Worker is up, then retry.');
    });
  }

  /* The sites as read, or read again after the Sites panel wrote: the valley, each site's icon
     (fetched with the token, for its banner and its sign), the dock's buttons, the empty state. */
  function applySites(sites, iconOf) {
    state.sites = sites;
    scene.setSites(sitesPanel.withDraft(sites));   // a site being added stays in the valley meanwhile
    Object.keys(state.icons).forEach(function (id) {   // a site removed: its icon let go
      if (state.icons[id] && !sites.some(function (s) { return s.id === id; })) { delete state.icons[id]; scene.setIcon(id, null); }   // the scene lets the blob go, so a site added later with that id flies none
    });
    sites.forEach(function (s) {
      if (!scene.setIcon) return;
      if (!s.icon) { if (state.icons[s.id]) { delete state.icons[s.id]; scene.setIcon(s.id, null); sitesPanel.icons(); } return; }   // the scene lets the blob go
      if (state.icons[s.id] && s.id !== iconOf) return;   // already here, and unchanged
      fetch('/api/icon?site=' + encodeURIComponent(s.id), { headers: { Authorization: 'Bearer ' + state.token } })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
        .then(function (b) { var url = URL.createObjectURL(b); state.icons[s.id] = url; scene.setIcon(s.id, url); sitesPanel.icons(); })   // the scene revokes the one it had
        .catch(function () { /* no icon: the pennant in its colour */ });
    });
    $('places').innerHTML = sites.map(function (s) {
      return '<li><button class="btn place" type="button" data-id="' + esc(s.id) + '">' + esc(s.name) + '</button></li>';
    }).join('');
    if (!sites.length) showError('No sites yet.', function () { showError(null); sitesPanel.addFirst(); }, 'Add your first site');
    else if (state.empty) showError(null);
    state.empty = !sites.length;
    sitesPanel.refresh();
  }

  /* Every village from /api/scene and every site's visits from /api/visits. Live hits that
     arrive meanwhile wait; once the answers are in, each is replayed only where it is newer than
     that answer, so a hit is not drawn or listed twice. A reload started later wins: an older
     one that finishes after it changes nothing. */
  var generation = 0;
  function reloadAll() {
    if (!state.sites.length) return Promise.resolve();
    var mine = ++generation;
    if (state.viewDay) return reloadDay(mine, state.viewDay);
    strip.refresh();
    state.buffer = [];
    return Promise.all(state.sites.map(function (s) {
      var q = '?site=' + encodeURIComponent(s.id);
      return Promise.all([api('/api/scene' + q), api('/api/visits' + q)]).then(function (d) { return { id: s.id, scene: d[0], visits: d[1] }; });
    })).then(function (answers) {
      if (mine !== generation) return;
      var sceneAt = {}, listAt = {}, held = state.buffer || [];
      scene.setDay(null);
      answers.forEach(function (a) { scene.load(a.id, a.scene); sceneAt[a.id] = a.scene.now; listAt[a.id] = a.visits.now; });
      visits.set(answers.map(function (a) { return a.visits; }));
      state.buffer = null; state.day = utcDay();
      held.forEach(function (m) {
        if (sceneAt[m.site] !== undefined && m.t > sceneAt[m.site]) scene.live(m);
        if (listAt[m.site] !== undefined && m.t >= listAt[m.site]) visits.live(m, m.t === listAt[m.site]);
      });
      showError(null); paintView();
    }).catch(function (e) {
      if (mine !== generation) return;
      state.buffer = null; failed(e, reloadAll);
    });
  }

  /* A past day: every village as that day ended, from /api/scene with its `day`. Counts only (no
     list of visits), and nothing live. */
  function reloadDay(mine, day) {
    state.buffer = null;
    return Promise.all(state.sites.map(function (s) {
      return api('/api/scene?site=' + encodeURIComponent(s.id) + '&day=' + day).then(function (d) { return { id: s.id, scene: d }; });
    })).then(function (answers) {
      if (mine !== generation) return;
      scene.setDay(day);
      answers.forEach(function (a) { scene.load(a.id, a.scene); });
      state.day = state.day || utcDay();
      showError(null); paintView();
    }).catch(function (e) {
      if (mine !== generation) return;
      failed(e, reloadAll);
    });
  }
  /* The history strip (or the URL) asks for a day: a past one, or today for anything else. The
     panels say so at once; the counts follow, a moment later so that a key held on the strip
     does not ask for every day it passes. An answer on its way for the day left is dropped. */
  var dayTimer = null;
  function setDay(day) {
    day = pastDay(day);
    if (day === state.viewDay) return;
    state.viewDay = day; generation++; state.buffer = null;
    applyDay(); syncUrl(true);
    clearTimeout(dayTimer); dayTimer = setTimeout(reloadAll, day ? 150 : 0);
  }
  function applyDay() {
    strip.select(state.viewDay);
    visits.past(state.viewDay ? strip.name(state.viewDay) : null);
    paintView();
  }

  /* The day's cut, as the API makes it: at UTC midnight the windows go dark and the day starts
     again. On a past day nothing goes dark: only today moved on, in the strip. */
  setInterval(function () {
    if (!state.day || utcDay() === state.day) return;
    state.day = utcDay();
    if (state.viewDay) { strip.refresh(); return; }
    visits.clear(); scene.dayCut(reloadAll);
  }, 15000);
  /* The used share and the hours come only with /api/scene (`$engaged` never reaches the live
     socket), so the dashboard left open refreshes them every five minutes. */
  setInterval(function () { if (state.started && state.token && $('gate').hidden && !document.hidden && !state.viewDay) reloadAll(); }, 5 * 60 * 1000);   // a past day does not change

  /* --- the view --- */
  function go(id, instant) {
    state.site = id;
    visits.view(id);
    scene.enter(id, instant);
    paintView(); syncUrl();
    $('back').focus({ preventScroll: true });
  }
  function leave() {
    if (ledger.isOpen()) ledger.close();
    var was = state.site; state.site = null;
    visits.view(null); paintPanel();
    scene.leave();
    paintView(); syncUrl();
    var b = was && $('places').querySelector('[data-id="' + was.replace(/["\\]/g, '\\$&') + '"]');
    if (b) b.focus({ preventScroll: true });
  }
  function siteName(id) { var s = state.sites.filter(function (x) { return x.id === id; })[0]; return s ? s.name : id; }
  function paintView() {
    var inSite = !!state.site;
    $('back').hidden = !inSite;
    $('places').hidden = inSite;
    $('open-ledger').hidden = !inSite;
    paintPanel();
    $('title').textContent = inSite ? siteName(state.site) : 'Your sites';
    var past = state.viewDay;
    $('sub').textContent = past ? strip.name(past) + ' · ' + past + ' UTC · a past day, as it ended'
      : 'Today · ' + (state.day || utcDay()) + ' UTC · ' + (inSite ? (touch ? 'tap' : 'hover') + ' the houses, gates and stalls · drag to turn' : 'pick a village');
    $('ui').classList.toggle('past', !!past);
    $('s-when').textContent = past ? ' that day' : ' today';
    $('stats').setAttribute('aria-label', past ? strip.name(past) : 'Today');
    strip.view(state.site);
    paintStats();
  }
  function paintStats() {
    if (!state.started) return;
    var t = scene.stats(state.site);
    put('s-visitors', fmt(t.visitors));
    put('s-hits', fmt(t.pageviews));
    put('s-views', fmt(t.views));
    put('s-events', fmt(t.other));   // `events` counts the views too: the Events tab's number
    var label = (state.site ? siteName(state.site) : 'All sites') + (state.viewDay ? ' on ' + strip.name(state.viewDay) : ' today') + ': ' + fmt(t.visitors) + ' visitors, ' +
      fmt(t.pageviews) + ' pageviews, ' + fmt(t.views) + ' views, ' + fmt(t.other) + ' other events. The ledger has every count as a table.';
    if (label !== shown.scene) { shown.scene = label; $('scene').setAttribute('aria-label', label); }
  }
  /* Asked twice a second, written only when a number changed. */
  var shown = {};
  function put(id, text) { if (shown[id] !== text) { shown[id] = text; $(id).textContent = text; } }
  setInterval(paintStats, 500);
  /* The bar is silent while the socket works. Not open for two seconds (a load, or a tab coming
     back, takes less), it says why the counts stopped moving. A socket closed on purpose (the tab
     put away, the gate) is not down. */
  var connTimer = null, connFailed = false;
  function connQuiet() { clearTimeout(connTimer); connTimer = null; connFailed = false; $('s-conn').hidden = true; }
  function paintLive(st) {
    if (st === 'unauthorized') { showGate('The token stopped working. Paste it again.'); return; }
    if (st === 'open' || document.hidden || $('ui').hidden) { connQuiet(); return; }
    if (st === 'closed') connFailed = true;
    $('s-conn-label').textContent = connFailed ? 'offline · retrying' : 'connecting…';
    if (!connTimer && $('s-conn').hidden) connTimer = setTimeout(function () { connTimer = null; $('s-conn').hidden = false; }, 2000);
  }

  $('places').addEventListener('click', function (e) { var b = e.target.closest('button.place'); if (b) go(b.dataset.id); });
  $('back').addEventListener('click', leave);
  function openLedger(event, range) { if (sitesPanel.isOpen()) sitesPanel.close(); ledger.open(state.site, event, range); paintPanel(); syncUrl(); scene.refit(true); $('close-ledger').focus({ preventScroll: true }); }
  /* From an event's card in the visits panel: its site's ledger, open at that event. */
  function openEvent(id, name) { if (state.site !== id) go(id, true); openLedger(name); }
  function closeLedger() { ledger.close(); paintPanel(); scene.refit(true); $('open-ledger').focus({ preventScroll: true }); }
  /* The visits panel: shown unless the reader put it away (remembered), and never under the ledger or the Sites panel. */
  function paintPanel() {
    $('visits').hidden = !state.showVisits || ledger.isOpen() || sitesPanel.isOpen();
    $('ui').classList.toggle('with-visits', !$('visits').hidden);   // the history strip ends where the panel begins
    $('ui').classList.toggle('with-ledger', ledger.isOpen());       // and is put away under the ledger, which would cover half of it
    $('ui').classList.toggle('with-sites', sitesPanel.isOpen());    // or under the Sites panel, likewise
    visits.shown();
    $('toggle-visits').setAttribute('aria-pressed', String(!!state.showVisits));
  }
  $('toggle-visits').addEventListener('click', function () {
    state.showVisits = !state.showVisits; visits.remember(state.showVisits);
    if (!state.showVisits) scene.highlight(null);
    paintPanel(); scene.refit(true);
  });
  /* Sound is off until asked for. Remembered on from another day, it waits for the first click
     (no browser lets a page sound before one): the button is outlined, not filled, until then.
     Its volume is a slider that style.css brings up over the button while the pointer is on
     either, the thumb is held or the keyboard's focus is in them; `fresh` holds it up a moment
     after sound is switched on (and, where nothing hovers, after the slider is let go). */
  var freshTimer = null;
  function freshVolume(ms) {
    var box = $('sound-box');
    clearTimeout(freshTimer); box.classList.add('fresh');
    freshTimer = setTimeout(function () { box.classList.remove('fresh'); }, ms);
  }
  function paintSound(st) {
    var b = $('sound');
    b.setAttribute('aria-pressed', st === 'on' ? 'true' : st === 'waiting' ? 'mixed' : 'false');
    b.classList.toggle('armed', st === 'waiting');
    $('volume-box').hidden = st === 'off';
    b.title = st === 'off' ? 'Hear the visits: steps at the gate, a bell at the door' : st === 'waiting' ? 'Sound is on: it starts with your first click' : 'Silence the village';
  }
  if (sound.supported) {
    /* A mouse or a finger leaves no focus behind, on the button (never given it) or on the slider
       (taken back when it lets go): focus in them is the keyboard's, and holds the slip up. */
    $('sound').addEventListener('mousedown', function (e) { e.preventDefault(); });
    $('sound').addEventListener('click', function () { sound.toggle(); freshVolume(3000); });
    sound.onchange(paintSound); paintSound(sound.state());
    $('volume').value = sound.volume();
    $('volume').addEventListener('input', function () { sound.setVolume(this.value); if (touch) freshVolume(2500); });
    $('volume').addEventListener('change', function () { sound.setVolume(this.value, true); if (touch) freshVolume(2500); });
    ['pointerup', 'pointercancel'].forEach(function (name) {
      $('volume').addEventListener(name, function () { var el = this; setTimeout(function () { el.blur(); }, 0); });   // after the browser's own `change`
    });
  }
  else $('sound-box').hidden = true;
  $('open-ledger').addEventListener('click', function () { openLedger(); });
  $('close-ledger').addEventListener('click', closeLedger);
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !$('gate').hidden) return;
    if (sitesPanel.isOpen()) sitesPanel.close();
    else if (ledger.isOpen()) closeLedger();
    else if (state.site) leave();
  });
  /* A window turned from landscape to portrait (or back) gets the scene rearranged, if it asks to. */
  var relayout = null;
  window.addEventListener('resize', function () {
    clearTimeout(relayout);
    relayout = setTimeout(function () {
      if (!state.started || !scene.wantsRelayout()) return;
      scene.setSites(sitesPanel.withDraft(state.sites)); if (state.site) scene.enter(state.site, true);
      reloadAll();
    }, 300);
  });

  /* `?site=`, `&day=` on a past day, and `&ledger=1&days=…&event=…` when the ledger is open. Each
     level (all sites, a site, its ledger) is an entry in the browser's history, so Back walks up
     them; a day, or a range or an event picked inside the ledger, only rewrites the current entry.
     The day is no level: Back and Forward keep the one on screen, and the entry they land on is
     rewritten with it. Going up with the dashboard's
     own buttons to the entry just behind is a step back, not a new entry. */
  var restoring = false;
  function level(site, ledgerOpen) { return site ? (ledgerOpen ? 2 : 1) : 0; }
  function syncUrl(replace) {
    if (restoring) return;
    var q = [];
    if (state.site) q.push('site=' + encodeURIComponent(state.site));
    if (state.viewDay) q.push('day=' + state.viewDay);
    if (state.site && ledger.isOpen()) q.push('ledger=1', ledger.query());
    var hour = params(location.search.slice(1)).hour; if (hour) q.push('hour=' + encodeURIComponent(hour));   // the clock held for the village's light stays held
    var url = location.pathname + (q.length ? '?' + q.join('&') : ''), here = location.pathname + location.search;
    if (url === here) return;
    var was = params(location.search.slice(1)), now = level(state.site, ledger.isOpen());
    if (replace === true || (was.site || null) === state.site && level(was.site, was.ledger === '1') === now) history.replaceState(history.state, '', url);
    else if (now < level(was.site, was.ledger === '1') && history.state && noDay(history.state.from) === noDay(url)) history.back();
    else history.pushState({ from: here }, '', url);
  }
  function noDay(url) { return String(url).replace(/([?&])day=[^&]*&?/, '$1').replace(/[?&]$/, ''); }
  /* Back and Forward: the view follows the URL, without writing it again (but for the day, above). */
  window.addEventListener('popstate', function () {
    var q = params(location.search.slice(1));
    if (!state.started) { state.site = q.site || null; state.viewDay = pastDay(q.day); state.ledgerOnBoot = q.ledger === '1'; ledger.restore(q); return; }
    var site = q.site && state.sites.some(function (s) { return s.id === q.site; }) ? q.site : null;
    restoring = true;
    try {
      if (!site) { if (state.site) leave(); return; }
      if (ledger.isOpen() && (q.ledger !== '1' || site !== state.site)) closeLedger();
      if (site !== state.site) go(site);
      if (q.ledger === '1' && !ledger.isOpen()) { ledger.restore(q); openLedger(); }
    } finally { restoring = false; syncUrl(true); }
  });

  /* --- boot --- */
  function pastDay(s) { return isDay(s) && s < utcDay() ? s : null; }
  function params(s) {
    var out = {};
    s.split('&').forEach(function (kv) {
      var i = kv.indexOf('='); if (i > 0) { try { out[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); } catch (e) { /* skip */ } }
    });
    return out;
  }
  var hash = params(location.hash.slice(1)), q = params(location.search.slice(1));
  if (hash.token) { state.token = hash.token; save(TOKEN_KEY, state.token); }
  else state.token = load(TOKEN_KEY);
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  state.site = q.site || null;
  state.viewDay = pastDay(q.day);
  state.ledgerOnBoot = q.ledger === '1';
  ledger.restore(q);

  /* The scheme of the panels and the ledger (the scene keeps its own light): theme.js applied it
     before paint; the button offers the other one. Cosmetic: without theme.js the rest works. */
  var meta = document.querySelector('meta[name="theme-color"]'), theme = window.footwornTheme;
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--village-sky-top').trim();
  function other() { return theme.current() === 'dark' ? 'light' : 'dark'; }
  function paintTheme() { var b = $('theme'), o = other(); b.textContent = o === 'dark' ? 'Dark' : 'Light'; b.title = 'Switch the panels to the ' + o + ' scheme'; }
  if (theme) {
    $('theme').addEventListener('click', function () { var o = other(); theme.set(o === theme.system() ? null : o); paintTheme(); });
    theme.onchange(paintTheme);
    paintTheme();
  } else $('theme').hidden = true;

  if (state.token) start(); else showGate();
})();
