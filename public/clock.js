/* The dashboard's clock is Madrid's, as the API's days are (src/clock.js, the same rule): UTC+1,
   and UTC+2 from the last Sunday of March to the last Sunday of October, both changes at
   01:00 UTC. `wall()` is now (or `ms`) as a Date whose UTC fields read Madrid's wall clock:
   getUTCHours() is the hour in Madrid. `day()` is Madrid's day, "2026-10-01". */
(function () {
  'use strict';
  function lastSunday(y, m) { var end = new Date(Date.UTC(y, m + 1, 0)); return Date.UTC(y, m + 1, -end.getUTCDay(), 1); }
  function offset(ms) { var y = new Date(ms).getUTCFullYear(); return ms >= lastSunday(y, 2) && ms < lastSunday(y, 9) ? 7200000 : 3600000; }
  function wall(ms) { ms = ms == null ? Date.now() : ms; return new Date(ms + offset(ms)); }
  window.FootwornClock = { wall: wall, day: function (ms) { return wall(ms).toISOString().slice(0, 10); } };
})();
