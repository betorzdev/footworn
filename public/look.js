/* The colour rules behind the Sites panel's "Suggest from the site": a look for a village from
   what the site says of itself (its theme colour, its colour scheme) and from its icon's pixels.
   Always there, free and the same every time; Claude's reading (src/look.js), when the Worker
   has a key, comes on top. Pure functions; the panel draws the icon on a canvas and passes its
   pixels. A classic script, no dependencies; test/look.test.js runs it. */
(function () {
  'use strict';

  function hsl(r, g, b) {   // 0..1 each → { h: 0..360, s, l }
    var max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min, h = 0, s = 0;
    if (d) {
      s = d / (1 - Math.abs(2 * l - 1));
      h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h = (h * 60 + 360) % 360;
    }
    return { h: h, s: s, l: l };
  }
  function hex(c) {   // "#rgb" or "#rrggbb" → hsl, or null
    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c || '').trim()); if (!m) return null;
    var v = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
    return hsl(parseInt(v.slice(0, 2), 16) / 255, parseInt(v.slice(2, 4), 16) / 255, parseInt(v.slice(4, 6), 16) / 255);
  }
  function gap(a, b) { var d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }

  /* An icon's pixels (RGBA, as a canvas gives them) → { light, dark, colorful, hue, sat }: its mean
     lightness, the share of its pixels that are dark, the share that are saturated, and the hue
     most of those lean to (12 buckets of 30°), with their mean saturation. Transparent pixels are
     not the icon. Null for an icon with nothing in it. */
  function iconStats(rgba) {
    var n = 0, light = 0, dark = 0, colorful = 0, buckets = [], i, k;
    for (k = 0; k < 12; k++) buckets.push({ n: 0, s: 0, x: 0, y: 0 });
    for (i = 0; i + 3 < rgba.length; i += 4) {
      if (rgba[i + 3] < 128) continue;
      var c = hsl(rgba[i] / 255, rgba[i + 1] / 255, rgba[i + 2] / 255);
      n++; light += c.l; if (c.l < .2) dark++;
      if (c.s > .3 && c.l > .15 && c.l < .9) {
        colorful++;
        var B = buckets[Math.floor(c.h / 30) % 12]; B.n++; B.s += c.s; B.x += Math.cos(c.h * Math.PI / 180); B.y += Math.sin(c.h * Math.PI / 180);
      }
    }
    if (!n) return null;
    var top = buckets.reduce(function (a, b) { return b.n > a.n ? b : a; });
    return { light: light / n, dark: dark / n, colorful: colorful / n,
      hue: top.n ? (Math.atan2(top.y, top.x) * 180 / Math.PI + 360) % 360 : null, sat: top.n ? top.s / top.n : 0 };
  }

  var WORD = function (h) { return h < 15 || h >= 345 ? 'red' : h < 45 ? 'orange' : h < 70 ? 'yellow' : h < 160 ? 'green' : h < 200 ? 'teal' : h < 260 ? 'blue' : h < 300 ? 'violet' : 'pink'; };

  /* hints: { themeColor, scheme } from the page (src/look.js); stats: iconStats or null;
     palette: { tints: [8 × #rrggbb], roofs: { kit: #rrggbb } } from the tokens.
     → { style, hue, shade, tint, pieces, why } in the Sites form's own terms. */
  function suggestLook(hints, stats, palette) {
    hints = hints || {};
    var theme = hex(hints.themeColor), scheme = String(hints.scheme || '');
    var themeDark = theme && theme.l < .2, iconDark = stats && stats.dark > .5;
    var schemeDark = /\bdark\b/.test(scheme) && !/\blight\b/.test(scheme);
    /* the site's own hue: its theme colour when that is a colour, else the one its icon leans to */
    var site = null, from = '';
    if (theme && theme.s > .25 && theme.l > .15 && theme.l < .85) { site = theme.h; from = 'theme colour'; }
    else if (stats && stats.hue != null && stats.colorful > .15 && stats.sat > .35) { site = stats.hue; from = 'icon'; }
    var greyish = site == null && ((theme && !themeDark && theme.s < .15) || (stats && !iconDark && stats.colorful < .1));
    var style, why;
    if (themeDark || (schemeDark && !theme) || (iconDark && !theme && !/\blight\b/.test(scheme))) {
      style = 'umbra';
      why = themeDark ? 'Its theme colour is near black (' + hints.themeColor + '), so umbra.' : schemeDark ? 'It declares a dark colour scheme, so umbra.' : 'Its icon is mostly dark, so umbra.';
    } else if (site != null && (site < 50 || site >= 340)) {
      style = 'citadel'; why = 'Its ' + from + ' is a warm ' + WORD(site) + ', so citadel.';
    } else if (greyish || (site != null && site >= 190 && site < 260)) {
      style = 'stone'; why = site != null ? 'Its ' + from + ' is a cool ' + WORD(site) + ', so stone.' : 'Its colours are greys, so stone.';
    } else {
      style = 'alpine'; why = site != null ? 'Its ' + from + ' is ' + WORD(site) + ': alpine, turned towards it.' : 'Nothing marked in its colours: alpine, as it is.';
    }
    /* the roofs turned towards the site's hue, unless they are near it already */
    var roof = palette && palette.roofs && hex(palette.roofs[style]), turn = 0;
    if (site != null && roof && gap(site, roof.h) > 20) turn = Math.round(((site - roof.h) % 360 + 360) % 360);
    /* lighter or darker after the site, never so far it stops being the kit; umbra keeps its own dark */
    var L = theme && !themeDark ? theme.l : stats ? stats.light : null, shade = 0;
    if (L != null && style !== 'umbra') shade = Math.max(-25, Math.min(25, Math.round((L - .5) * 50)));
    /* the site's colour: the nearest of the eight to its hue */
    var tint = null;
    if (site != null && palette && palette.tints) {
      var best = Infinity;
      palette.tints.forEach(function (c, i) { var t = hex(c); if (t && gap(t.h, site) < best) { best = gap(t.h, site); tint = i + 1; } });
    }
    var pieces = iconDark && style !== 'umbra' ? { shade: 'half' } : null;
    return { style: style, hue: turn, shade: shade, tint: tint, pieces: pieces, why: why };
  }

  window.FootwornLook = { iconStats: iconStats, suggestLook: suggestLook, hex: hex };
})();
