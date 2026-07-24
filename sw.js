/* IMPROVS2 service worker
   Commit this next to index.html (same folder, same origin).

   What it does
     - ONLINE  : always fetches the newest index.html, so a commit is live immediately.
                 No ?v= timestamp needed - the network copy always wins when it's reachable.
     - OFFLINE : serves the last build from cache, so the app opens with no connection.
     - CONFIG  : tracks.json / packs.json / ads.json are network-first with a cached fallback,
                 so remote config and the ad killswitch keep working, and a dead connection
                 falls back to the last known good copy instead of failing.
     - SCORES  : dreamlo is never cached - a leaderboard must never serve a stale answer.
     - AUDIO   : cross-origin track audio is left alone. On device the Vault already stores
                 purchased tracks permanently; caching them twice would waste the user's space.
*/
const APP   = 'improvs2-app-v1';     // app shell (html)
const CFG   = 'improvs2-cfg-v1';     // small json config
const KEEP  = [APP, CFG];

const CONFIG_HOSTS = ['raw.githubusercontent.com'];
const NEVER_CACHE  = ['dreamlo.com', 'api.', 'applovin'];

self.addEventListener('install', (e) => {
  // Warm the shell so the very first offline launch works.
  e.waitUntil(
    caches.open(APP)
      .then((c) => c.addAll(['./', './index.html']).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isConfig(url) {
  return CONFIG_HOSTS.some((h) => url.hostname.includes(h)) && url.pathname.endsWith('.json');
}
function neverCache(url) {
  return NEVER_CACHE.some((h) => url.hostname.includes(h) || url.pathname.includes(h));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (_) { return; }

  // Leaderboard and ad network: straight to the network, never cached.
  if (neverCache(url)) return;

  const sameOrigin = url.origin === self.location.origin;
  const isShell = req.mode === 'navigate' ||
                  (sameOrigin && (url.pathname.endsWith('/') || url.pathname.endsWith('.html')));

  // ---- app shell: network-first (instant updates), cache fallback (offline) ----
  if (isShell) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(APP).then((c) => c.put('./index.html', copy)).catch(() => {});
          }
          return res;
        })
        .catch(() =>
          caches.match('./index.html').then((hit) => hit || caches.match('./')).then(
            (hit) =>
              hit ||
              new Response(
                '<meta name="viewport" content="width=device-width,initial-scale=1">' +
                '<body style="background:#000;color:#eee;font:16px system-ui;padding:2em;text-align:center">' +
                '<h2>IMPROVS2</h2><p>No connection, and no saved copy yet.</p>' +
                '<p style="opacity:.7">Open the app once while online and it will work offline from then on.</p></body>',
                { headers: { 'Content-Type': 'text/html' } }
              )
          )
        )
    );
    return;
  }

  // ---- remote config json: network-first, fall back to the last good copy ----
  if (isConfig(url)) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CFG).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // ---- other same-origin assets: cache-first, refresh in the background ----
  if (sameOrigin) {
    e.respondWith(
      caches.match(req).then((hit) => {
        const net = fetch(req)
          .then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(APP).then((c) => c.put(req, copy)).catch(() => {});
            }
            return res;
          })
          .catch(() => hit);
        return hit || net;
      })
    );
  }
  // cross-origin audio / cdn: untouched - the device Vault owns those.
});

// Let the page ask a waiting worker to take over right away.
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
