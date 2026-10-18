IMPROVS2 BUILD 900 — FULL PACKAGE

Release files
-------------
- app-900.html: versioned Build 900 entry point.
- app-latest.html: exact copy of app-900.html for the existing latest redirect.
- modules/rig/rig.js: Build 900 eight-slot stereo NAM rig (L1–L4 and R1–R4), independent L/R IRs and pan, per-chain DSP, Mayer Blues preset, and A–G snapshot integration.
- modules/sampler/sampler.js: carried forward byte-for-byte from the Build 899 clean package.
- modules/snapshots/snapshots.js: carried forward byte-for-byte from the Build 899 clean package.

Build 900 hardening in rig.js
-----------------------------
- DSP enable state activates its chain even when no NAM or IR is loaded, so DSP-only sound tests can actually pass through the processing chain.
- DSP slider readouts update live.
- NAM slot state is committed only after the model has compiled and been sent; a failed model compile won't replace the slot's saved metadata.
- Audio graph rebuilds are serialized to avoid overlapping reroutes during rapid toggles/loads.
- TONE3000 variant selection now automatically loads a model explicitly named “A2 Lite” when that variant is available; if no A2 Lite variant exists, the normal variant chooser/fallback remains.
- Legacy WAV-export detection is not overwritten by the new eight-slot route-active state.
- Older snapshots without DSP data migrate to bypassed DSP defaults; Build 900 snapshots carry both chains' DSP settings.

Validation performed
--------------------
- Node syntax check passed for all 35 inline JavaScript blocks in app-900.html.
- Node syntax checks passed for rig.js, sampler.js, and snapshots.js.
- app-latest.html was byte-compared against app-900.html and matches exactly.
- Build/version markers and the eight NAM slots, two IR sides, DSP preset, routing queue, and snapshot hooks were checked.
- sampler.js and snapshots.js were byte-compared against Build 899 clean and are unchanged.
- ZIP integrity and package contents are checked at release time.

Not claimed as verified
-----------------------
No live browser/device audio session was available for end-to-end testing. Actual TONE3000 OAuth/downloads, note playback through loaded NAM captures, stereo routing on the target device, audible compressor/EQ/reverb differences, CPU load/underruns, and real-device snapshot save/restore still need playback testing. Eight simultaneously loaded NAMs can be CPU-intensive, depending on model size and device.

Deployment note
---------------
This package includes the full Build 900 HTML entry points and all three modules available in the supplied Build 899 package. Place the HTML files and modules/ directory at the same hosting root as the existing app. A brand-new empty hosting root also needs any other pre-existing app modules not present in this supplied package; this archive does not invent or replace those missing modules.
