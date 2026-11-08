// IMPROVS2 Genius API proxy — Vercel Node.js Function
// Required Vercel environment variable: GENIUS_ACCESS_TOKEN
// Only the three read-only Genius endpoints used by Rhymelight are exposed.
const ALLOWED = new Set(['search', 'referents']);

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

module.exports = async function geniusProxy(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return send(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET requests are supported.' } });
  }

  // Validate browser-origin metadata without assuming every same-origin GET
  // includes an Origin header. Chromium commonly omits Origin on GET requests.
  // Prefer Origin when present; otherwise validate Referer, then Fetch Metadata.
  const origin = req.headers.origin;
  const host = req.headers.host;
  const referer = req.headers.referer || req.headers.referrer;
  const fetchSite = req.headers['sec-fetch-site'];
  if (!host) return send(res, 403, { error: { code: 'HOST_REQUIRED', message: 'The request host could not be validated.' } });

  let browserOrigin = '';
  try {
    if (origin) browserOrigin = new URL(origin).origin;
    else if (referer) browserOrigin = new URL(referer).origin;
  } catch (_) {
    return send(res, 403, { error: { code: 'ORIGIN_INVALID', message: 'The request origin is invalid.' } });
  }

  if (browserOrigin) {
    const parsed = new URL(browserOrigin);
    if (parsed.protocol !== 'https:' || parsed.host !== host) {
      return send(res, 403, { error: { code: 'ORIGIN_FORBIDDEN', message: 'Cross-origin requests are not allowed.' } });
    }
  } else if (fetchSite !== 'same-origin') {
    return send(res, 403, { error: { code: 'ORIGIN_UNVERIFIABLE', message: 'The browser did not provide verifiable same-origin request metadata.' } });
  }

  const token = process.env.GENIUS_ACCESS_TOKEN;
  if (!token) return send(res, 503, { error: { code: 'GENIUS_NOT_CONFIGURED', message: 'Genius is not configured on this deployment. Add GENIUS_ACCESS_TOKEN in Vercel Project Settings → Environment Variables, then redeploy.' } });

  const q = req.query || {};
  const action = String(q.action || '');
  let endpoint;
  const params = new URLSearchParams();

  if (action === 'search') {
    const term = String(q.q || '').trim();
    if (!term || term.length > 160) return send(res, 400, { error: { code: 'INVALID_QUERY', message: 'Search text must contain 1–160 characters.' } });
    endpoint = 'search';
    params.set('q', term);
  } else if (action === 'song') {
    const id = String(q.songId || '');
    if (!/^\d{1,12}$/.test(id)) return send(res, 400, { error: { code: 'INVALID_SONG_ID', message: 'A valid Genius song ID is required.' } });
    endpoint = `songs/${id}`;
    params.set('text_format', 'plain');
  } else if (action === 'referents') {
    const id = String(q.song_id || '');
    if (!/^\d{1,12}$/.test(id)) return send(res, 400, { error: { code: 'INVALID_SONG_ID', message: 'A valid Genius song ID is required.' } });
    endpoint = 'referents';
    params.set('song_id', id);
    params.set('per_page', String(Math.min(50, Math.max(1, Number(q.per_page) || 50))));
    params.set('text_format', 'plain');
  } else {
    return send(res, 400, { error: { code: 'UNSUPPORTED_ACTION', message: 'Supported actions are search, song and referents.' } });
  }

  const upstreamUrl = `https://api.genius.com/${endpoint}?${params.toString()}`;
  try {
    const upstream = await fetch(upstreamUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    });
    const text = await upstream.text();
    let payload;
    try { payload = JSON.parse(text); } catch (_) {
      return send(res, 502, { error: { code: 'UPSTREAM_INVALID_RESPONSE', message: 'Genius returned an unreadable response.' } });
    }
    if (!upstream.ok) {
      const status = upstream.status === 401 || upstream.status === 403 ? 502 : upstream.status;
      const message = upstream.status === 401 || upstream.status === 403
        ? 'Genius rejected the server-side access token. Check GENIUS_ACCESS_TOKEN in Vercel.'
        : `Genius API returned HTTP ${upstream.status}.`;
      return send(res, status, { error: { code: 'GENIUS_UPSTREAM_ERROR', message } });
    }
    return send(res, 200, payload);
  } catch (_) {
    return send(res, 502, { error: { code: 'GENIUS_UNREACHABLE', message: 'The IMPROVS2 server could not reach the Genius API.' } });
  }
};
