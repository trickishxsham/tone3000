# IMPROVS2 Build 987 — HTML-first package

## Source and scope

Build 987 is based on the Build 986 HTML and RIG/NAM modules extracted from the existing Android APK. It retains the Build 986 TONE3000 OTP input/keyboard fix and Rhymelight grade-first changes. The Android APK is intentionally not rebuilt: the browser HTML is the test target until it is stable.

The changed runtime files are `tone3000/modules/rig/rig.js` and `tone3000/modules/nam/nam.js`. The offline NAM engine logic is carried forward unchanged; its package version metadata is advanced to 4.9.8.987. The RIG module is advanced to 4.9.8.987.

## Audio changes

- Prefer an AudioContext at 48,000 Hz with `latencyHint: 'interactive'`; fall back to the device's supported rate if the 48 kHz request is rejected.
- Select the NAM inference block size from the model's native rate and the actual AudioContext rate so a block maps to the browser's 128-frame AudioWorklet quantum. Examples on a 48 kHz host: 24 kHz NAM → 64 model samples; 44.1 kHz → 118; 48 kHz → 128; 96 kHz → 256; 192 kHz → 512.
- Keep the AudioWorklet dry-through while its first wet block is priming or if a block underruns, instead of outputting a zero-filled gap.
- Reuse model input/output, dry/wet and history buffers; avoid the old per-quantum `Float32Array`, `Array.from`/`concat`, and source-queue `splice` work.
- Report `COMPILING WASM` only on a cache miss. A cache hit is shown as `REUSING WASM`; model preparation and transfer have separate statuses.
- Keep all eight NAM slots and all four serial IR slots available. A load governor temporarily bypasses the lowest-priority NAM stage when measured NAM inference load stays at or above 72% for 700 ms, retaining at least one active NAM. It restores one stage after load remains at or below 52% for three seconds. Models remain loaded and slot configuration is retained.
- Reuse analyser buffers and reduce meter-polling/reporting frequency to reduce UI/GC overhead.

Three IRs can be enabled together in the existing serial chain. The load governor measures NAM inference time only; it does not include convolution/IR cost, browser overhead, or Android thermal throttling. The adaptive guard therefore improves resilience but cannot guarantee that eight full-size captures plus three IRs will run glitch-free on every phone.

## Buffer-size note

This HTML app requests a 48 kHz AudioContext; it does not and cannot set a 480-frame Android hardware buffer through the standard Web Audio API. AudioWorklet processing uses the browser-owned 128-frame render quantum. NAM processing blocks are matched to that quantum at the actual host/model sample-rate ratio. `latencyHint: 'interactive'` remains in place.

## Verification performed

- `node --check` on both changed JavaScript modules.
- `node --check` on all 36 inline executable JavaScript blocks in `app-987.html`.
- Four Node tests pass: sample-rate/block mapping, synthetic 48 kHz worklet continuity, synthetic 24 kHz-to-48 kHz continuity, and Build 987 version/slot/source consistency.
- `app-987.html`, `builds/app-latest.html`, and root `app-latest.html` are byte-for-byte identical.

The worklet tests use a synthetic identity WASM model. No physical Samsung device test, real TONE3000 model stress test, or three-IR listening test has been performed in this environment. Do that before treating the all-slots configuration as proven.
