/* The Sites panel: a drawer over the village where the owner adds a site, dresses its village
   (the kit, the palette turned, the site's colour, its icon), edits one, removes one. The real
   village is the preview: every change in the form dresses that village there and then, and a
   site being added stands as a draft village with a canned day of visits until it is saved.
   Writes go to PUT/DELETE /api/site and POST/DELETE /api/icon behind the token; app.js re-reads
   the sites after each one (`onChange`). A classic script, no inline code (the CSP). */
(function () {
  'use strict';

  window.FootwornSites = function (o) {
    /* o: { api(path, init) -> Promise<json>, token() -> string, scene, sites() -> list,
            iconUrl(id) -> blob URL or null, onChange() -> Promise, onOpen(), onClose(), styles: [] } */
    var $ = function (id) { return document.getElementById(id); };
    var DRAFT = '~draft';   // never a site's id (src/sites.js: lowercase letters, digits, - and _)
    var ICON_MAX = 40 * 1024;   // ICON_MAX in src/icon.js: checked here only to spare the upload, the Worker decides
    var state = { open: false, editing: null, draft: false, drafted: false, saved: null, busy: false, pane: 'settings', first: {} };   // first: each site's first live visit seen here   // editing: the id in the form (null: none); draft: the form is a new site; saved: the look as last saved

    function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function slug(name) { return String(name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64); }
    function siteOf(id) { return o.sites().filter(function (s) { return s.id === id; })[0] || null; }

    /* The canned day a draft village shows, so its kit has houses, gates and stalls to wear. */
    var DRAFT_SCENE = (function () {
      var pages = [['/', 14], ['/guide/', 7], ['/about/', 4], ['/changelog/', 2]], refs = [['reddit.com', 9], ['discord', 5]], views = [['map', 6], ['charms', 3]];
      var hours = [], h;
      for (h = 0; h < 24; h++) hours.push({ hour: h, today: Math.round(1 + 2 * Math.sin((h + 3) / 24 * Math.PI * 2 + 1) + 2), yesterday: Math.round(2 + 2 * Math.cos(h / 24 * Math.PI * 2)) });
      return {
        pages: pages.map(function (p) { return { value: p[0], hits: p[1] * 20 }; }),
        refs: refs.map(function (r) { return { value: r[0], hits: r[1] * 20 }; }),
        views: views.map(function (v) { return { value: v[0], hits: v[1] * 20 }; }),
        today: { hits: 27, visitors: 19, events: 11, viewsTotal: 9, loads: 27, engaged: 16,
          pages: pages.map(function (p) { return { path: p[0], hits: p[1], loads: p[1], engaged: Math.round(p[1] * .6), events: 0 }; }),
          refs: refs.map(function (r) { return { ref: r[0], hits: r[1] }; }),
          views: views.map(function (v) { return { view: v[0], hits: v[1] }; }),
          viewPages: [{ path: '/', view: 'map', hits: 6 }, { path: '/guide/', view: 'charms', hits: 3 }] },
        yesterday: { visitors: 15, pages: pages.map(function (p) { return { path: p[0], hits: Math.max(1, p[1] - 2) }; }) },
        hours: hours,
      };
    })();

    /* ---------- the drawer ---------- */
    function open() {
      if (state.open) return;
      state.open = true; $('sites').hidden = false; $('toggle-sites').setAttribute('aria-pressed', 'true');
      paintList(); if (o.onOpen) o.onOpen();
      $('close-sites').focus({ preventScroll: true });
    }
    function close() {
      if (!state.open) return;
      cancel();
      state.open = false; $('sites').hidden = true; $('toggle-sites').setAttribute('aria-pressed', 'false');
      if (o.onClose) o.onClose();
      $('toggle-sites').focus({ preventScroll: true });
    }

    /* The list: a card per site, the one being edited holding the form; a site being added is a
       card of its own at the top. */
    function paintList() {
      var list = $('site-list'), form = $('site-form'), html = '';
      if (state.draft) html += card({ id: DRAFT, name: $('site-name').value || 'New site', style: null, origins: [], icon: false }, true);
      o.sites().forEach(function (s) { html += card(s, false); });
      if (!o.sites().length && !state.draft) html += '<li class="site-none muted">No sites yet. Add one: its village stands in the valley as you dress it.</li>';
      var focus = document.activeElement, keep = form.contains(focus) ? focus : null;
      form.hidden = true; $('site-park').appendChild(form);   // out of the list before it is rewritten
      list.innerHTML = html;
      var slot = state.editing && list.querySelector('[data-id="' + cssEsc(state.editing) + '"] .site-edit');
      if (slot) { slot.appendChild(form); form.hidden = false; if (keep) keep.focus({ preventScroll: true }); }
    }
    /* An icon came in: its card's square, and the form's, in place (the form keeps the focus and a held slider). */
    function paintIcons() {
      Array.prototype.forEach.call($('site-list').querySelectorAll('.site-card'), function (li) {
        var id = li.dataset.id, url = id !== DRAFT && o.iconUrl(id), el = li.querySelector('.site-row > .ico');
        if (!el || (url ? el.tagName === 'IMG' && el.getAttribute('src') === url : el.tagName !== 'IMG')) return;
        var n = document.createElement(url ? 'img' : 'span');
        n.className = url ? 'ico' : 'ico blank';
        if (url) { n.alt = ''; n.src = url; } else n.setAttribute('aria-hidden', 'true');
        el.replaceWith(n);
      });
      if (state.editing && !state.draft) paintIcon();
    }
    function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }
    function card(s, draft) {
      var editing = state.editing === s.id, url = !draft && o.iconUrl(s.id);
      return '<li class="site-card' + (editing ? ' open' : '') + (draft ? ' draft' : '') + '" data-id="' + esc(s.id) + '">' +
        '<div class="site-row">' +
          (url ? '<img class="ico" alt="" src="' + esc(url) + '">' : '<span class="ico blank" aria-hidden="true"></span>') +
          '<b class="site-name">' + esc(s.name) + '</b>' +
          (draft ? '<span class="badge draft">not saved yet</span>' : '<span class="badge">' + esc(s.style || 'alpine') + '</span><span class="badge num">' + s.origins.length + (s.origins.length === 1 ? ' origin' : ' origins') + '</span>') +
          (draft || editing ? '' : '<button class="btn small site-open" type="button" data-id="' + esc(s.id) + '" aria-label="Edit ' + esc(s.name) + '">Edit</button>') +
        '</div><div class="site-edit"></div></li>';
    }

    /* ---------- the form ---------- */
    function fill(s) {
      $('site-name').value = s.name; $('site-id').value = s.id; $('site-origins').value = s.origins.join('\n');
      $('site-id').readOnly = !state.draft; $('site-id-hint').textContent = state.draft ? 'What every page carries in data-site. From the name; fixed once saved.' : 'What every page carries in data-site. Fixed.';
      setKit(s.style || 'alpine'); $('site-hue').value = s.hue || 0; $('site-shade').value = s.shade || 0; setTint(s.tint || null); paintLook();
      paintIcon(); paintWire(); paintRemove(); $('site-tabs').hidden = state.draft; setPane(state.draft ? 'settings' : state.pane);
      $('site-error').hidden = true;
      $('site-icon-fetch').disabled = $('site-icon-file').disabled = $('site-icon-drop').disabled = state.draft;
      $('site-icon-note').textContent = state.draft ? 'Save the site first; then fetch its icon or choose a file.' : (s.icon ? 'On its banner and its sign.' : 'None yet: the pennant flies in its colour.');
      $('site-confirm').value = ''; $('site-remove-go').disabled = true; $('site-remove-box').hidden = true;
    }
    function look() {
      return { name: $('site-name').value.trim() || 'New site', style: kit() === 'alpine' ? null : kit(), tint: tint(),
        hue: Number($('site-hue').value) || 0, shade: Number($('site-shade').value) || 0 };
    }
    function kit() { var b = $('site-kits').querySelector('[aria-checked="true"]'); return b ? b.dataset.style : 'alpine'; }
    function setKit(name) { Array.prototype.forEach.call($('site-kits').querySelectorAll('[data-style]'), function (b) { b.setAttribute('aria-checked', String(b.dataset.style === name)); }); }
    function tint() { var b = $('site-tints').querySelector('[aria-checked="true"]'); return b ? Number(b.dataset.tint) : null; }
    function setTint(n) { Array.prototype.forEach.call($('site-tints').querySelectorAll('[data-tint]'), function (b) { b.setAttribute('aria-checked', String(Number(b.dataset.tint) === n)); }); }
    function paintLook() {
      $('site-hue-out').textContent = (Number($('site-hue').value) || 0) + '°';
      var sh = Number($('site-shade').value) || 0;
      $('site-shade-out').textContent = sh > 0 ? '+' + sh + ' lighter' : sh < 0 ? sh + ' darker' : 'as the kit';
      $('site-look-reset').hidden = !Number($('site-hue').value) && !sh;
    }
    function paintIcon() {
      var url = state.editing && !state.draft && o.iconUrl(state.editing), img = $('site-icon-img');
      img.hidden = !url; $('site-icon-none').hidden = !!url;
      if (url) img.src = url;
      $('site-icon-drop').hidden = !url;
    }
    /* ---------- Wire: the site's own repository ---------- */
    function setPane(name) {
      state.pane = name;
      Array.prototype.forEach.call($('site-tabs').querySelectorAll('[role="tab"]'), function (t) {
        var on = t.dataset.pane === name; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1;
      });
      $('site-settings').hidden = name !== 'settings'; $('site-wire').hidden = name !== 'wire';
    }
    function wireSite() { var s = siteOf(state.editing); return s && { id: s.id, name: s.name, origins: s.origins }; }
    function paintWire() {
      var s = !state.draft && wireSite(); if (!s) return;
      var W = window.FootwornWire, steps = W.steps(s, location.origin);
      $('wire-prompt').textContent = W.prompt(s, location.origin);
      $('wire-steps').innerHTML = steps.map(function (st, i) {
        return '<li><div><b>' + esc(st.title) + '</b><p>' + esc(st.body) + '</p>' +
          (st.snippet ? '<code class="snippet num" translate="no">' + esc(st.snippet) + '</code><button type="button" class="btn small" data-copy="' + i + '">Copy</button>' : '') + '</div></li>';
      }).join('');
      paintFirst();
    }
    /* Whether the wiring works: the first live visit seen for the site, or today's count, or a wait. */
    function paintFirst() {
      var id = state.editing, el = $('wire-first'), txt = $('wire-first-text'); if (!id || state.draft) return;
      var f = state.first[id], s = siteOf(id), today = o.today ? o.today(id) : null;
      el.classList.toggle('ok', !!f || !!(today && today.pageviews));
      el.classList.toggle('wait', !f && !(today && today.pageviews));
      if (f) txt.textContent = 'A visit at ' + new Date(f.t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) + ': ' + f.path + ', ' + (f.ref ? 'from ' + f.ref : 'direct') + '. It works.';
      else if (today && today.pageviews) txt.textContent = 'Counting: ' + today.pageviews.toLocaleString('en') + (today.pageviews === 1 ? ' pageview' : ' pageviews') + ' today. It works.';
      else txt.textContent = 'Waiting for a visit from ' + (s && s.origins[0] || 'the site') + '… open the deployed site in a browser.';
    }
    function copy(text, b, label) {
      function done(ok) { b.textContent = ok ? 'Copied' : 'Select and copy'; setTimeout(function () { b.textContent = label; }, 2000); }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
      else done(false);
    }
    function paintRemove() { $('site-remove').hidden = state.draft; $('site-remove-box').hidden = true; }
    function fail(msg) { var el = $('site-error'); el.textContent = msg; el.hidden = false; }
    function busy(on) { state.busy = on; Array.prototype.forEach.call($('site-form').querySelectorAll('button, input, textarea'), function (el) { if (on) { if (!el.disabled) el.dataset.held = '1'; el.disabled = true; } else if (el.dataset.held) { delete el.dataset.held; el.disabled = false; } }); }

    /* The village follows the form: the one being edited is dressed again; a new site stands as
       a draft, with the canned day the first time. */
    function preview() {
      var L = look();
      if (state.draft) {
        var real = o.sites(), had = state.drafted;
        if (!had) { o.scene.setSites(real.concat([{ id: DRAFT, name: L.name, style: L.style, tint: L.tint, hue: L.hue, shade: L.shade, draft: true }])); o.scene.load(DRAFT, DRAFT_SCENE); state.drafted = true; }
        else o.scene.restyle(DRAFT, L);
        var nameEl = $('site-list').querySelector('.site-card.draft .site-name'); if (nameEl) nameEl.textContent = L.name;
      }
      else if (state.editing) o.scene.restyle(state.editing, L);
    }
    function dropDraft() { if (state.drafted) { state.drafted = false; o.scene.setSites(o.sites()); } }
    /* A slider fires on every step: the village is dressed again at most every so often while it moves. */
    var held = null;
    function previewSoon() { if (held) return; held = setTimeout(function () { held = null; preview(); }, 120); }

    function startNew() {
      if (state.editing) cancel();
      state.draft = true; state.editing = DRAFT; state.saved = null;
      paintList();
      fill({ id: '', name: '', origins: [], style: null, tint: null, hue: 0, shade: 0, icon: false });
      $('site-name').dataset.auto = '1';
      preview();
      $('site-name').focus();
    }
    function startEdit(id) {
      var s = siteOf(id); if (!s) return;
      if (state.editing) cancel();
      state.draft = false; state.editing = id; state.pane = 'settings'; state.saved = { name: s.name, style: s.style, tint: s.tint, hue: s.hue || 0, shade: s.shade || 0 };
      paintList(); fill(s);
      $('site-name').focus();
    }
    /* Back to what is saved: the village dressed as it was, the draft gone. */
    function cancel() {
      if (!state.editing) return;
      if (state.draft) dropDraft(); else if (state.saved) o.scene.restyle(state.editing, state.saved);
      state.editing = null; state.draft = false; state.saved = null;
      paintList();
    }

    function save() {
      var L = look(), body = { id: $('site-id').value.trim(), name: $('site-name').value.trim(), origins: $('site-origins').value.split(/\s+/).filter(Boolean),
        style: L.style, tint: L.tint, hue: L.hue || null, shade: L.shade || null };
      if (!body.id) { fail('The site needs an id: lowercase letters, digits, - and _.'); $('site-id').focus(); return; }
      if (!body.name) { fail('The site needs a name.'); $('site-name').focus(); return; }
      if (!body.origins.length) { fail('At least one origin, like https://your-site.example, so its hits are counted.'); $('site-origins').focus(); return; }
      if (!state.draft && siteOf(body.id) === null) { fail('That site is gone.'); return; }
      if (state.draft && siteOf(body.id)) { fail('There is a site with that id already. Edit it, or pick another id.'); $('site-id').focus(); return; }
      busy(true); $('site-error').hidden = true;
      if (state.draft) body.create = true;   // never overwrites a site this list did not know of: the Worker answers 409
      var stored = false;
      o.api('/api/site', { method: 'PUT', body: JSON.stringify(body) }).then(function () {
        var wasDraft = state.draft; stored = true;
        if (wasDraft) { state.drafted = false; delete state.first[body.id]; }   // the next setSites (onChange) lists the real site instead
        state.draft = false; state.editing = body.id; state.saved = { name: body.name, style: L.style, tint: L.tint, hue: L.hue, shade: L.shade };
        if (wasDraft) state.pane = 'wire';   // the next step: the site's own repository
        return o.onChange().then(function () {
          busy(false); paintList(); fill(siteOf(body.id) || body);
          $('site-saved').hidden = false; $('site-saved').textContent = wasDraft ? 'Saved. Now wire it in the site’s own repository.' : 'Saved.';
          setTimeout(function () { $('site-saved').hidden = true; }, 4000);
        });
      }).catch(function (e) {
        busy(false);
        if (e.message === 'unauthorized') { fail('The token stopped working. Lock and open again.'); return; }
        if (!stored) { fail(e.message); return; }
        /* saved, but the sites could not be read again: no draft left in the valley, and say what happened */
        o.scene.setSites(o.sites());
        fail('Saved, but the list could not be read again (' + e.message + '). Close the panel and reload the page.');
      });
    }

    function remove() {
      var id = state.editing; if (!id || state.draft || $('site-confirm').value.trim() !== id) return;
      busy(true);
      o.api('/api/site?site=' + encodeURIComponent(id), { method: 'DELETE' }).then(function () {
        state.editing = null; state.saved = null; delete state.first[id];   // a site added later with this id starts waiting again
        return o.onChange().then(function () { busy(false); paintList(); $('site-new').focus(); });
      }).catch(function (e) { busy(false); fail(e.message); });
    }

    function iconDone(p) {
      var id = state.editing;
      return p.then(function () { return o.onChange(id); }).then(function () {
        busy(false); paintList();
        var s = state.editing && siteOf(state.editing);
        if (s) fill(s); else if (state.editing) { state.editing = null; paintList(); }   // gone meanwhile (another tab)
      })
        .catch(function (e) { busy(false); fail(e.message); });
    }
    function fetchIcon() {
      if (!state.editing || state.draft) return;
      busy(true); $('site-error').hidden = true; $('site-icon-note').textContent = 'Looking at the site’s page…';
      iconDone(o.api('/api/icon?site=' + encodeURIComponent(state.editing), { method: 'POST', body: '{}' }));
    }
    function uploadIcon(file) {
      if (!file || !state.editing || state.draft) return;
      if (file.size > ICON_MAX) { fail('That file is over 40 KB. A favicon-sized PNG, ICO or JPEG.'); return; }
      busy(true); $('site-error').hidden = true;
      iconDone(o.api('/api/icon?site=' + encodeURIComponent(state.editing), { method: 'POST', headers: { 'Content-Type': file.type && file.type.indexOf('image/') === 0 ? file.type : 'image/png' }, body: file }));
    }
    function dropIcon() {
      if (!state.editing || state.draft) return;
      busy(true); iconDone(o.api('/api/icon?site=' + encodeURIComponent(state.editing), { method: 'DELETE' }));
    }

    /* ---------- wiring ---------- */
    $('toggle-sites').addEventListener('click', function () { if (state.open) close(); else open(); });
    $('close-sites').addEventListener('click', close);
    $('site-new').addEventListener('click', startNew);
    $('site-list').addEventListener('click', function (e) { var b = e.target.closest('.site-open'); if (b) startEdit(b.dataset.id); });
    $('site-form').addEventListener('submit', function (e) { e.preventDefault(); if (!state.busy) save(); });
    $('site-cancel').addEventListener('click', cancel);
    $('site-name').addEventListener('input', function () {
      if (state.draft && this.dataset.auto) $('site-id').value = slug(this.value);
      preview();
    });
    $('site-id').addEventListener('input', function () { delete $('site-name').dataset.auto; this.value = this.value.toLowerCase(); });
    $('site-kits').addEventListener('click', function (e) { var b = e.target.closest('[data-style]'); if (b) { setKit(b.dataset.style); preview(); } });
    $('site-tints').addEventListener('click', function (e) { var b = e.target.closest('[data-tint]'); if (b) { setTint(tint() === Number(b.dataset.tint) ? null : Number(b.dataset.tint)); preview(); } });
    ['site-hue', 'site-shade'].forEach(function (id) {
      $(id).addEventListener('input', function () { paintLook(); previewSoon(); });
      $(id).addEventListener('change', function () { clearTimeout(held); held = null; preview(); });   // let go: exactly where it stopped
    });
    $('site-look-reset').addEventListener('click', function () { $('site-hue').value = 0; $('site-shade').value = 0; paintLook(); preview(); });
    $('site-surprise').addEventListener('click', function () {
      var kits = o.scene.styles ? o.scene.styles() : ['alpine'], k = kits[Math.floor(Math.random() * kits.length)];
      setKit(k); $('site-hue').value = Math.random() < .35 ? 0 : Math.floor(Math.random() * 360); $('site-shade').value = Math.round((Math.random() - .5) * 60);
      setTint(1 + Math.floor(Math.random() * 8)); paintLook(); preview();
    });
    $('site-icon-fetch').addEventListener('click', fetchIcon);
    $('site-icon-file').addEventListener('change', function () { uploadIcon(this.files && this.files[0]); this.value = ''; });
    $('site-icon-drop').addEventListener('click', dropIcon);
    $('wire-copy').addEventListener('click', function () { copy($('wire-prompt').textContent, this, 'Copy the prompt for your agent'); });
    $('wire-steps').addEventListener('click', function (e) {
      var b = e.target.closest('[data-copy]'), s = b && wireSite(); if (!s) return;
      copy(window.FootwornWire.steps(s, location.origin)[Number(b.dataset.copy)].snippet, b, 'Copy');
    });
    $('site-tabs').addEventListener('click', function (e) { var t = e.target.closest('[role="tab"]'); if (t) setPane(t.dataset.pane); });
    $('site-tabs').addEventListener('keydown', function (e) {   // the tablist pattern: arrows, Home and End move and select
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(e.key) < 0) return;
      e.preventDefault();
      var next = state.pane === 'settings' ? 'wire' : 'settings';
      if (e.key === 'Home') next = 'settings'; if (e.key === 'End') next = 'wire';
      setPane(next); $('tab-' + next).focus();
    });
    $('site-remove').addEventListener('click', function () { $('site-remove-box').hidden = false; $('site-confirm').focus(); });
    $('site-confirm').addEventListener('input', function () { $('site-remove-go').disabled = this.value.trim() !== state.editing; });
    $('site-remove-go').addEventListener('click', remove);
    $('site-remove-no').addEventListener('click', function () { $('site-remove-box').hidden = true; $('site-confirm').value = ''; $('site-remove-go').disabled = true; $('site-remove').focus(); });

    return {
      open: open,
      close: close,
      isOpen: function () { return state.open; },
      addFirst: function () { open(); startNew(); },
      /* The sites were read again: the cards again, the form as it is (and its focus). */
      refresh: function () { if (state.open) { paintList(); if (state.editing && !state.draft) paintIcon(); } },
      /* An icon came in, or went: only the squares that show it. */
      icons: function () { if (state.open) paintIcons(); },
      /* A live hit: the first one seen for a site turns its Wire tab's line green. */
      live: function (msg) {
        if (!msg || !msg.site || msg.event || state.first[msg.site]) return;
        state.first[msg.site] = { t: msg.t || Math.floor(Date.now() / 1000), path: msg.path, ref: msg.ref };
        if (state.open && state.editing === msg.site && !state.draft) paintFirst();
      },
      /* The list the valley is given: the sites, and the draft village while one is being added. */
      withDraft: function (list) {
        if (!state.drafted) return list;
        var L = look();
        return list.concat([{ id: DRAFT, name: L.name, style: L.style, tint: L.tint, hue: L.hue, shade: L.shade, draft: true }]);
      },
    };
  };
})();
