# IMPROVS2 Build 964 — RHYMELIGHT (offline song comparison)

## What this build does

RHYMELIGHT is now a native IMPROVS2 feature module for comparing the rhyme architecture of up to six rap-song passages. It is a local analysis and visualisation tool — not an AI lyric assistant.

- Select benchmark labels for Eminem — *Rap God*, Nas — *N.Y. State of Mind*, The Notorious B.I.G. — *Notorious Thugs*, Black Thought — *Hot 97 10-Minute Freestyle*, Rakim — *Follow the Leader*, and 2Pac — *Me Against the World*.
- Paste a passage for each track (minimum two populated tracks; up to six).
- Matching phonetic rhyme sounds share the same colour across every selected passage.
- Switch between syllable, word, and line views. Primary stress is underlined; line endings receive an A/B/C rhyme scheme.
- Compare each song's own rhyme density, internal rhymes and multi-syllable rhyme patterns; cross-song shared sounds are reported separately. Pronunciation-dictionary coverage is included so unknown words do not silently skew the comparison.

## No AI or API

There is no AI model call, API route, API key, audio transcription, microphone capture, speech-recognition service, or remote analytics in this module. Text analysis runs in the browser using the bundled pronunciation data. Its only resource reads are same-origin static files inside `modules/rhymelight/`.

`modules/rhymelight/rhymelight.json` is the clean module configuration. It is derived from the supplied Rhymelight project export's browser-safe rhyme-sheet concepts and six benchmark labels. The original 88-file Lovable export is deliberately not bundled, because it contains AI gateway and server-function code that this implementation does not use.

## Important source-data limitation

The supplied project export listed the six benchmark song titles and contained a generic hand-authored demonstration stanza, but it did not include analysed passages or rhyme maps for those six songs. This build therefore does not fabricate track statistics or include copyrighted lyrics. Select a benchmark label and paste the passage you want to study from your own source.

## Phonetic engine and limitations

`rhymelight-pronunciations.json` bundles the primary pronunciations from CMU Pronouncing Dictionary 1.1.3 (ARPABET). Repeated vowel-plus-coda sound groups from different word forms are coloured consistently across all tracks; merely repeating the exact same word is not counted as a rhyme. The module also looks for repeated two-to-four-syllable line-ending sequences and repeated multisyllabic word endings, while filtering common function-word-only patterns.

Rhyme density and internal-rhyme metrics are calculated within each individual passage. A sound appearing once in Song A and once in Song B is shown as a shared comparison sound, but it does not inflate either song's own rhyme-density score. The multi-pattern figure counts distinct repeated multi-syllable sound patterns per 16 lines, rather than counting every repetition of one pattern.

The bundled dictionary is primarily US English. Unknown words remain visible, receive an estimated syllable split from spelling, and are not assigned invented phonetic matches. Accent, delivery, pronunciation variants, homophones outside the primary dictionary entry, and slant rhymes may therefore be missed. The coverage figure makes dictionary limitations visible.

See `modules/rhymelight/CMUDICT-LICENSE.txt` for the dictionary licence.

## Install

Copy these paths into the root of the existing IMPROVS2 deployment/repository:

- `app-964.html`
- `app-latest.html`
- `modules/rhymelight/rhymelight.js`
- `modules/rhymelight/rhymelight.json`
- `modules/rhymelight/rhymelight-pronunciations.json`
- `modules/rhymelight/CMUDICT-LICENSE.txt`

Keep `app-964.html` and `app-latest.html` byte-identical. The existing IMPROVS2 lazy module loader loads `modules/rhymelight/rhymelight.js`; that module reads its local JSON configuration and local pronunciation dictionary.

If the earlier AI-based Rhymelight patch was installed, remove its Rhymelight-only `api/rhymelight.js` route. This replacement does not use it. Do not remove a shared environment variable if another unrelated service in your deployment still uses it; this module neither reads nor requires `LOVABLE_API_KEY`.

## Verification

- Node unit tests cover cross-track rhyme grouping, syllable segmentation and stress, density/internal/multis metrics, missing dictionary words, clean offline configuration, and absence of AI/API/speech-capture code.
- `node --check` is used for the module and app inline scripts.
- HTML pair identity, source/config JSON validity, dictionary validity, and ZIP contents are checked before delivery.
- A real browser UI pass could not be completed in this container because the headless Chromium process did not start reliably; no browser-render test is claimed.
