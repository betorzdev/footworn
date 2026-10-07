/* What a site's own repository needs once the site is saved in the Sites panel: the steps the
   panel's Wire tab lists, and the same steps as a prompt for a coding agent opened in that
   repository. One list, so the two never drift. Pure: the site and the Worker's origin in, text
   out (the panel escapes it). The limits and the channels are src/collect.js's (`LIMITS`,
   `CHANNELS`); test/wire.test.js keeps them in step. A classic script, no dependencies. */
(function () {
  'use strict';

  var LIMITS = { event: 60, props: 10, key: 32, value: 64 };
  var CHANNELS = ['reddit', 'discord', 'youtube', 'twitter', 'x', 'bsky', 'mastodon', 'threads',
    'facebook', 'instagram', 'tiktok', 'twitch', 'steam', 'telegram', 'whatsapp', 'github', 'email', 'newsletter'];

  function tag(site, worker) { return '<script async src="' + worker + '/footworn.js" data-site="' + site.id + '"></script>'; }
  var TRACK = "function track(name, props) {\n  try { if (window.footworn && footworn.event) footworn.event(name, props); } catch (e) {}\n}";

  /* [{ title, body, snippet?, ask }]: `body` and `snippet` are the panel's, `ask` the prompt's. */
  function steps(site, worker) {
    return [
      { title: 'The tag on every page',
        body: 'In the <head> of every HTML page: templates, generated pages and the 404 too. Keep the explicit https.',
        snippet: tag(site, worker),
        ask: 'On every HTML page (templates, generated pages, the 404 page), in <head>:\n   ' + tag(site, worker) +
          '\n   Keep the explicit https:// (a protocol-relative src breaks over file://). If the pages are\n   generated, add it to the generator or the template, not to the output only.' },
      { title: 'Views and actions from the code',
        body: 'A pageview counts by itself. For the rest, one guarded helper: it never breaks the page. A view inside a page is a "screen" event with a "view".',
        snippet: TRACK + "\ntrack('screen', { view: 'map' });   // a view inside a page",
        ask: 'It counts a pageview on load by itself. For actions, add one guarded helper and call it:\n' +
          TRACK.replace(/^/gm, '     ') + '\n' +
          "   - A view inside a page (tabs, screens, an app route without a page load):\n     track('screen', { view: '<short name>' })\n" +
          "   - Other actions worth counting (a save, an import, a share): track('<name>', { ... }).\n" +
          '   - Client-side navigation that should count as a new page: window.footworn && footworn.count(\'/the/path/\')\n' +
          '   Limits: names up to ' + LIMITS.event + ' characters, never starting with "$"; at most ' + LIMITS.props + ' properties,\n' +
          '   keys up to ' + LIMITS.key + ' and values up to ' + LIMITS.value + ' characters. Never anything about the person: no\n' +
          '   ids, emails, or text they typed.\n' +
          '   Read the code first and propose which views and actions to track, with where each call\n' +
          '   goes; ask me before adding more than a handful.' },
      { title: 'A line in the privacy notice',
        body: 'One sentence: visits are counted with Footworn, without cookies or IP, linking to what it stores.',
        snippet: worker + '/privacy',
        ask: 'In the privacy notice (or the footer, if there is none): one sentence saying visits are counted\n   with Footworn, without cookies or IP, linking to ' + worker + '/privacy' },
      { title: 'A Content-Security-Policy, if it has one',
        body: 'A <meta> or a header file (_headers, the server): add the Worker to script-src and connect-src.',
        snippet: worker,
        ask: 'If the site sends a Content-Security-Policy (a <meta>, or a header file such as _headers), add\n   ' + worker + ' to script-src and connect-src.' },
      { title: 'Tagged links',
        body: 'Where apps send no referrer, tag the links you post: ?ref=discord. Only known channels are kept.',
        snippet: site.origins[0] + '/?ref=discord',
        ask: 'Nothing to change in the code: when the owner posts a link where apps send no referrer, they\n   add ?ref=<channel> (' + CHANNELS.join(', ') + ').\n   Mention it in the docs if the repo has a place for such notes.' },
      { title: 'A mention in the docs',
        body: 'Where the repository lists its dependencies or its privacy: the README, the docs.',
        ask: 'Mention Footworn where the repository documents its dependencies or its privacy (README, docs).' },
    ];
  }

  function prompt(site, worker) {
    var list = steps(site, worker).map(function (s, i) { return (i + 1) + '. ' + s.ask; }).join('\n\n');
    return 'Add Footworn, a cookie-free visit counter, to this site. It is registered in Footworn as\n' +
      'site id "' + site.id + '" (' + site.name + '), allowed origins: ' + site.origins.join(' ') + '\n' +
      "Footworn's Worker: " + worker + '\n\n' + list + '\n\n' +
      'The tracker sends nothing over file://, from localhost (unless data-local="1" is on the tag) or\n' +
      'inside an iframe, so the test is the deployed site: a visit there shows in Footworn at once.\n' +
      'Do not commit or deploy without asking me.';
  }

  window.FootwornWire = { steps: steps, prompt: prompt, LIMITS: LIMITS, CHANNELS: CHANNELS };
})();
