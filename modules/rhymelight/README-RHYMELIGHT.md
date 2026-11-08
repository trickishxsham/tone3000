# IMPROVS2 Build 967 — RHYMELIGHT

## Included

RHYMELIGHT is a lazy-loaded, on-device lyric analysis module for comparing up to six passages. The patch retains the existing Build 966 rhyme map, song library, JPEG/PDF exports, benchmark catalogue and Circle-of-Fourths colour system, and expands its grading and line navigation.

- Offline CMU pronunciation-dictionary analysis, syllable splits and primary stress.
- Same phonetic rhyme family keeps the same IMPROVS2 palette colour across compared tracks, in the ascending-fourths order: C, F, Bb, Eb, Ab, Db, Gb, B, E, A, D, G. The palette colours and black/white text-contrast rules are retained.
- Syllable, word and line-end views; shared sounds; selectable colour chips; syllable/word/line/unique-word/track counts.
- Eight weighted grade dimensions: multisyllabic rhyming 20%, internal rhyme density 15%, rhyme density 10%, flow/rhythmic complexity 15%, wordplay/double meanings 15%, metaphor/imagery 10%, technical vocabulary/wit 10%, sustained complexity 5%.
- Optional BPM and exact passage-duration fields. With both inputs, Rhymelight calculates syllables per second and syllables per beat. BPM alone is not misrepresented as delivery speed. With no timed duration, the flow component is labelled as a text-only rhythm proxy.
- Wordplay, imagery and technical-wit ratings are manual 0–10 assessments. Missing ratings are excluded from the active weighted denominator, and the grade is labelled **PROVISIONAL** until all three are supplied. The offline phonetic engine does not pretend to understand semantic double meanings or metaphors.
- Sustained complexity measures how many four-line blocks contain a recurring phonetic rhyme family.
- Click any analysed lyric line to open a Genius search for that track and line. The lookup is an external, user-initiated hand-off; Genius annotation text is not scraped, fetched, cached or republished in Rhymelight.
- Personal lyrics, tempo details and manual ratings can be saved to the local device library. Rap God remains preloaded from the text supplied by the user.
- Per-track JPEG and multi-page PDF exports include the analysis and colour legend.

## Benchmark catalogue and lyric rights

The picker retains all 17 requested reference titles:

- Nas — N.Y. State of Mind; The Message
- Mobb Deep — Shook Ones, Pt. II; Survival of the Fittest
- Eric B. & Rakim — Know the Ledge
- Rakim — Follow the Leader
- Eminem — Rap God; The Way I Am; Godzilla
- Drake feat. Kanye West, Lil Wayne & Eminem — Forever
- The Notorious B.I.G. — Notorious Thugs; Kick in the Door
- 2Pac — Me Against the World; Hail Mary; Trapped
- Black Thought — Hot 97 10-Minute Freestyle
- DJ Krush feat. Black Thought — Zen Approach

These are labelled as elite reference titles, not assigned fixed/fabricated scores. The grade is calculated from the actual passage entered. Only the user-supplied Rap God text is bundled; the other titles are metadata only. Paste lyrics or excerpts you have permission to use.

## Offline, privacy and Genius behaviour

There are no AI calls, backend routes, API keys, Genius API calls, microphone capture, speech recognition, audio uploads or analytics. The analysis engine uses same-origin static JSON and the bundled CMU pronunciation dictionary. Personal content remains in browser/device local storage.

Clicking a lyric line opens `https://genius.com/search?q=...` in a new browser tab. Genius requires its own website connection to show its community explanations. Rhymelight does not use the authenticated Genius developer API; the developer API's referent/annotation endpoints require authentication, so this build does not make unauthorised direct API calls. See the [Genius API documentation](https://docs.genius.com/) and [LyricsGenius API/lyrics notes](https://lyricsgenius.readthedocs.io/en/master/how_it_works.html).

The local CMU dictionary is primarily US English. Accents, delivery-based rhymes, pronunciation variants and slant rhymes may be missed. Unknown words remain visible and are syllable-estimated from spelling, but do not receive invented phonetic matches. Dictionary coverage is shown as confidence context.

## Patch installation

This is a changed-files-only patch over Build 966. Keep the existing `modules/rhymelight/rhymelight-pronunciations.json` and `modules/rhymelight/CMUDICT-LICENSE.txt` from Build 966; they are unchanged and therefore not duplicated in the ZIP.

Replace/add these files at the IMPROVS2 project root:

- `app-967.html`
- `app-latest.html`
- `modules/rhymelight/rhymelight.js`
- `modules/rhymelight/rhymelight.json`
- `README-RHYMELIGHT.md`
- `tests/rhymelight.test.cjs`
- `tests/rhymelight-offline.test.cjs`

Keep `app-967.html` and `app-latest.html` byte-identical. Do not remove the existing pronunciation dictionary or its licence. No changes to NAM/IR, Voice2Guitar, microphone routing, DSP or audio worklets are part of this patch.

## Verification

- `node --test tests/*.cjs` — 33 tests passed.
- Module JavaScript passes `node --check`.
- Both app HTML copies pass inline-script syntax checking.
- Manifest, module and app version metadata match Build 967.
- `app-967.html` and `app-latest.html` are byte-for-byte identical.
- ZIP integrity and contents are checked before delivery.

No live deployment is performed by this patch. Genius search links require the user's browser to be online when clicked.
