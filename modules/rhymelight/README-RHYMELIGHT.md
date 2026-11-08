# IMPROVS2 Build 970 — Rhymelight Genius API

## What changed
- Fixed the Genius single-result search flow: after the official Genius API song and referent requests complete, the in-app preview keeps the generated Genius embed document in the preview iframe. The previous flow overwrote `srcdoc` with the plain song URL immediately after selection.
- Kept Genius API calls user-initiated and authenticated with the user's Client Access Token.
- Kept Genius annotation fragments and explanations rendered in Rhymelight.
- Preserved the existing local lyric-analysis engine, app audio code, NAM/IR routing, pronunciation dictionary and licence.

## Setup
Open Rhymelight → Genius settings, paste the Genius **Client Access Token**, and choose **USE / SAVE TOKEN** once on this device. The Client ID and Client Secret are not required by this client-access-token flow and must not be placed in the app.

The API requests use `https://api.genius.com`. CapacitorHttp is used if available; otherwise the browser fetch path is attempted and may be subject to browser CORS policy. The full-song preview uses Genius's official embed script inside Rhymelight. Genius may impose its own embed restrictions.

## Install
Apply the files in this ZIP over Build 969 (or a compatible Build 964+ installation). Do not delete the existing modules directory. Keep `rhymelight-pronunciations.json` and `CMUDICT-LICENSE.txt`; they are unchanged and are not included.

## Version integrity
`app-970.html` and `app-latest.html` are identical. App, module and JSON configuration version: `4.9.8.970`.
