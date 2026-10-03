/* The live view: every counted hit, the moment it is counted, to the dashboards that are open.
   One Durable Object for every site (the valley shows them all; the page filters), on the
   WebSocket Hibernation API, so an idle connection costs nothing. It stores nothing: a hit is
   relayed and forgotten. What a message may carry is `liveMessage`, and docs/privacy.md says why. */

/* The fields of a hit the live view sends: the same as a row of today's visits (`visits` in
   src/stats.js), so a live row and a reloaded one read alike. Never the width; the second is in
   `t` because the page needs it to tell a live hit from one already counted, and it shows only
   the minute (the message's own arrival tells the second anyway). */
export function liveMessage(hit) {
  return {
    site: hit.site,
    t: hit.ts,
    path: hit.path,
    ref: hit.ref,
    device: hit.device,
    browser: hit.browser,
    os: hit.os,
    lang: hit.lang,
    first: hit.first ? 1 : 0,
    country: hit.country,
    event: hit.event,
    props: hit.event ? hit.props : null,
  };
}

/* The collector's side: hand one hit to the Durable Object. */
export function publish(env, hit) {
  const stub = env.LIVE.get(env.LIVE.idFromName('live'));
  return stub.fetch('https://live/publish', { method: 'POST', body: JSON.stringify(liveMessage(hit)) });
}

export class Live {
  constructor(state) {
    this.state = state;
    /* The page pings every 30 s to keep proxies from closing the socket; answered without waking. */
    state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/publish' && request.method === 'POST') {
      const msg = await request.text();
      for (const ws of this.state.getWebSockets()) { try { ws.send(msg); } catch (e) { /* closing */ } }
      return new Response(null, { status: 204 });
    }
    if (request.headers.get('Upgrade') === 'websocket') {
      const [client, server] = Object.values(new WebSocketPair());
      this.state.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response('Not found', { status: 404 });
  }

  /* The view only listens; anything it says besides the ping is ignored. */
  webSocketMessage() {}

  webSocketClose(ws, code) {
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye'); } catch (e) { /* already closed */ }
  }

  webSocketError() {}
}
