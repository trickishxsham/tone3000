# IMPROVS2 Build 988 — HTML-first release

## Release target

Build 988 is a sequential HTML release based on the supplied Build 987 app shell and the current eight-NAM/four-IR RIG implementation. It does not contain an APK. Deploy `builds/app-latest.html` to test the browser version; `builds/app-988.html` is the numbered copy and is byte-identical.

## Changes

### Rhymelight
- The selected track's full grade card now renders directly above that track's colour-coded lyric sheet.
- Wordplay and double meanings receive a numeric heuristic score from exact CMU-dictionary homophones, phrase-boundary fusions, word splits, perspective/polarity contrasts and double-domain vocabulary.
- Imagery receives a numeric heuristic score from concrete/sensory terms and figurative-language constructions.
- Each semantic score exposes candidate evidence and a confidence estimate. These are transparent heuristics, not proof of author intent. Existing manual 0–10 overrides remain supported.
- Technical wit continues to use the existing phonetic colour-family analysis.

### Voice2Guitar
- Pitch analysis cadence changes from 80 ms (12.5 Hz) to 32 ms (31.25 Hz).
- Auto-match confirmation changes from five stable frames to two, retaining the 90% pitch-confidence and 20-cent stability gates.
- The 4096-sample analyser frame and autocorrelation buffer are reused rather than allocated every pass.
- Autocorrelation examines every fourth input sample to reduce the CPU cost of each frame.
- Existing microphone lease handling, A=440 calibration, bend logic and sample mapping remain in place.

### RIG and ToneCraftAI
- RIG module metadata advances to 4.9.8.988.
- The eight-NAM/four-IR bridge now exposes per-slot DSP setters for NAM slots and IR slots.
- TONE3000 NAM variant loading now preserves the explicit A2 Full tier value when present.
- ToneCraftAI is a standalone lazy-loaded feature/module. It interprets a prompt, searches TONE3000 for R1 drive/boost, R2 amplifier, optional R3 stage and IR1 cabinet models, prefers the requested A2 Lite/Full variant, and previews the model/parameter proposal before loading.
- ToneCraftAI applies per-slot input gain, drive, output gain, mix, clip, low cut, bass, mid frequency/Q, treble, high cut and EQ enable values. It can save the resulting rig to snapshots A–G.
- ToneCraftAI does not alter NAM model weights; it configures the independent per-slot DSP controls exposed by RIG.

### App shell
- Build metadata and module cache revisions are synchronised to 4.9.8.988.
- ToneCraftAI has its own feature tile and panel.
- Feature titles wrap on narrow screens rather than being clipped.
- Existing Build 987 rate-matched NAM processing, adaptive CPU load governor, AudioWorklet underrun handling and TONE3000 authentication flow are retained.

## Install

Extract this ZIP at the Tone3000 repository root, preserving the directory structure. Replace the included files. Keep the existing `modules/rhymelight/rhymelight-pronunciations.json` and `modules/rhymelight/CMUDICT-LICENSE.txt`; they are unchanged and are intentionally not duplicated in this patch.

The two HTML files in `builds/` must remain byte-identical. Deploy the repository to Vercel and open:

`https://improvs2.vercel.app/builds/app-latest.html`

Hard-refresh after deployment so the 988 module cache revisions are used.

## Verification performed

- `node --check` passed for `rhymelight.js`, `voice2guitar.js`, `rig.js`, `nam.js` and `tonecraftai.js`.
- All 37 inline executable JavaScript blocks in `builds/app-988.html` passed `node --check`.
- `node --test tests/build988.test.cjs` — 8 tests passed.
- Tests cover numeric semantic scores and evidence, grade-card placement above lyrics, 31.25 Hz pitch cadence, two-frame auto-match, synthetic C3 pitch detection, ToneCraftAI slot/FX proposals, RIG per-slot FX bridge, A2 Full tier preservation, and version/HTML parity.
- ZIP integrity and required file presence are checked before delivery.

## Device-test limitations

No physical Samsung device test, real TONE3000 multi-model loading session, or prolonged thermal/audio stress test was performed here. The browser does not expose a dependable Android thermal sensor. Build 987's NAM inference load governor remains active, but it does not measure convolution/IR cost or actual device temperature. Test R1/R2/R3 plus multiple IRs on the phone before treating the maximum-load configuration as proven glitch-free.

The Web Audio API controls the AudioContext sample rate when supported; it does not let the HTML page set Android's hardware buffer to 480 frames. The browser owns the AudioWorklet render quantum (normally 128 frames).
