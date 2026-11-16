# IMPROVS2 HTML Build 985

This HTML-first patch was prepared from the supplied IMPROVS2 4.9.8.984 TEST APK assets.

## Included files
- `tone3000/builds/app-985.html`
- `tone3000/builds/app-latest.html` (byte-identical to `app-985.html`)
- `tone3000/modules/rig/rig.js` (module version updated to 4.9.8.985)
- `tone3000/modules/rhymelight/rhymelight.js` (module version updated to 4.9.8.985; lyrics/rating order corrected)
- `tone3000/modules/rhymelight/rhymelight.json` (configuration version updated to 4.9.8.985)

## Rhymelight results layout
1. Lyrics are rendered first and remain outside any disclosure.
2. Complexity comparison/ratings render immediately below the lyrics and remain outside the disclosure.
3. The comparison map, phonetic colour counts, shared sounds, syllable/word/line data and track diagnostics remain inside `EXPAND RHYMELIGHT ANALYSIS`, which is collapsed by default and explicitly re-collapsed after each render.

The analyser now starts with one song only; adding another comparison track is optional. Scoring calculations, colour mappings, Genius integration, lyric editing and local song-library saving are retained.

## TONE3000 boundary
The supplied APK already hands OAuth to the device's external browser. The HTML bundle preserves that bridge and its PKCE/deep-link configuration. The visual rendering and input of TONE3000's remote email-code page are outside this HTML bundle; any native browser-launcher change is a separate Android-layer change and requires rebuilding the Android wrapper. This HTML patch does not claim to have verified the six-digit code entry on the phone.

## Version integrity
- App header: `IMPROVS2 BUILD 985`
- `window.BUILD`: `4.9.8.985`
- Rig module: `4.9.8.985`
- Rhymelight JS and JSON: `4.9.8.985`
- `app-985.html` and `app-latest.html`: byte-for-byte identical
