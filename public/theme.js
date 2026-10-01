/* The scheme, before first paint on every page: the user's switch, kept in the browser, else the
   system's. Resolved here and written to <html data-theme>, so tokens.css lists the dark stock
   once. Loaded synchronously in <head>, so the page never flashes the other stock. The dashboard's
   button talks to it through `footwornTheme`. */
(function () {
  'use strict';
  var KEY = 'footworn.theme', root = document.documentElement;
  var mq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  function load() { try { var v = localStorage.getItem(KEY); return v === 'dark' || v === 'light' ? v : null; } catch (e) { return null; } }
  function save(v) { try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch (e) { /* no storage */ } }
  function system() { return mq && mq.matches ? 'dark' : 'light'; }
  function current() { return load() || system(); }
  function apply() { root.setAttribute('data-theme', current()); }
  apply();
  /* The OS switching schemes counts while there is no override. Old Safari only has addListener. */
  if (mq) { if (mq.addEventListener) mq.addEventListener('change', apply); else if (mq.addListener) mq.addListener(apply); }
  window.footwornTheme = {
    current: current,                               /* the scheme on screen */
    system: system,
    set: function (v) { save(v); apply(); },        /* 'dark', 'light', or null to follow the system */
    onchange: function (f) { if (!mq) return; if (mq.addEventListener) mq.addEventListener('change', f); else if (mq.addListener) mq.addListener(f); }
  };
})();
