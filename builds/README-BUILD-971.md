# IMPROVS2 Build 971 — Genius API proxy

This patch routes Rhymelight's Genius API requests through a same-origin Vercel serverless function. The browser no longer contacts `api.genius.com` directly, so Genius API CORS restrictions do not block song search or annotation retrieval.

## Required Vercel setup

1. Open the **IMPROVS2** project in Vercel.
2. Go to **Settings → Environment Variables**.
3. Add `GENIUS_ACCESS_TOKEN` with the Genius **Client Access Token** value.
4. Select **Production** (and Preview only if you want preview deployments to use Genius).
5. Save the variable and redeploy the latest production deployment.

Do not add the Genius Client Secret. Do not put either credential in HTML, JavaScript, GitHub, or this ZIP. The serverless function reads only `process.env.GENIUS_ACCESS_TOKEN`.

## Files in this patch

- `api/genius.js` — Vercel Node.js function. It exposes only the read-only Genius `search`, `songs/:id`, and `referents` endpoints, validates parameters, enforces same-origin browser requests, and does not return credentials.
- `modules/rhymelight/rhymelight.js` and `rhymelight.json` — same-origin proxy client and matching module configuration.
- `app-971.html`, `app-latest.html`, `builds/app-971.html`, `builds/app-latest.html` — matching Build 971 app entry files for the existing root/builds deployment layout.

The existing `index.html` redirect is unchanged. The pronunciation dictionary and its licence are unchanged and intentionally not included. No test files are included.

## Important

The Vercel function consumes function invocations, unlike the previous static-only deployment. Normal Genius lookups should be low-volume, but monitor Vercel Function Invocations after deployment. No Lovable service, external lyrics proxy, or Capacitor plugin is used.
