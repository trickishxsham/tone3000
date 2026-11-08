/*
 * RHYMELIGHT — IMPROVS2 offline rap-song comparison module
 * Build: 4.9.8.964
 * Source export: modules/rhymelight/rhymelight.json
 * Pronunciations: bundled CMU Pronouncing Dictionary (see CMUDICT-LICENSE.txt)
 * No AI, API endpoint, API key, speech service, analytics, or remote dependency.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) {
    api.attach(root);
    if (typeof root.registerModule === 'function') root.registerModule('rhymelight', api);
    else root.__mod_rhymelight = api;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  var VERSION = '4.9.8.964';
  var MAX_TRACKS = 6;
  var PALETTE = ['#f6c85f', '#6ec5ff', '#f78da7', '#8de0a8', '#b69cff', '#ff9f68', '#55d6c2', '#f0a6ca', '#a6c8ff', '#d7d86e', '#e89bff', '#9dd9d2'];
  var VOWEL = /^(AA|AE|AH|AO|AW|AY|EH|ER|EY|IH|IY|OW|OY|UH|UW)[012]$/;
  var BENCHMARKS = [
    { id: 'eminem', artist: 'Eminem', song: 'Rap God' },
    { id: 'nas', artist: 'Nas', song: 'N.Y. State of Mind' },
    { id: 'biggie', artist: 'The Notorious B.I.G.', song: 'Notorious Thugs' },
    { id: 'black-thought', artist: 'Black Thought', song: 'Hot 97 10-Minute Freestyle' },
    { id: 'rakim', artist: 'Rakim', song: 'Follow the Leader' },
    { id: '2pac', artist: '2Pac', song: 'Me Against the World' }
  ];
  var state = {
    root: null, panel: null, mounted: false, open: false, tracks: [], results: null,
    dictionary: null, dictionaryPromise: null, config: null, configPromise: null, view: 'syllables', focus: null, status: ''
  };

  function escapeHTML(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }

  function normaliseWord(word) {
    return String(word || '').toLowerCase().replace(/[’]/g, "'");
  }

  function dictionaryEntry(dictionary, word) {
    var key = normaliseWord(word);
    var entry = dictionary && (dictionary[key] || dictionary[key.replace(/'/g, '')]);
    if (Array.isArray(entry) && Array.isArray(entry[0])) return entry[0];
    if (Array.isArray(entry)) return entry.join(' ');
    return typeof entry === 'string' ? entry : '';
  }

  function isVowelPhone(phone) { return VOWEL.test(phone); }
  function cleanPhone(phone) { return String(phone).replace(/[012]$/, ''); }

  function splitPhones(pronunciation) {
    var phones = Array.isArray(pronunciation) ? pronunciation.slice() : String(pronunciation || '').trim().split(/\s+/).filter(Boolean);
    var syllables = [], current = [], vowel = -1, stressed = false;
    phones.forEach(function (phone) {
      if (isVowelPhone(phone) && vowel !== -1) {
        syllables.push(makeSyllable(current, vowel, stressed));
        current = [phone]; vowel = 0; stressed = /1$/.test(phone);
      } else {
        if (isVowelPhone(phone)) { vowel = current.length; stressed = /1$/.test(phone); }
        current.push(phone);
      }
    });
    if (current.length && vowel !== -1) syllables.push(makeSyllable(current, vowel, stressed));
    return syllables;
  }

  function makeSyllable(phones, vowelIndex, stressed) {
    var rime = phones.slice(vowelIndex).map(cleanPhone).join(' ');
    return { rime: rime, stressed: !!stressed };
  }

  function estimateSyllables(word) {
    var w = normaliseWord(word).replace(/[^a-z]/g, '');
    if (!w) return 1;
    var groups = w.match(/[aeiouy]+/g) || [];
    var count = groups.length || 1;
    if (count > 1 && /e$/.test(w) && !/(le|ye)$/.test(w)) count--;
    if (/[^aeiou]le$/.test(w) && count < 2) count++;
    return Math.max(1, count);
  }

  function splitSpelling(word, wanted) {
    var value = String(word || '');
    if (wanted <= 1 || value.length < 2) return [value];
    var re = /[aeiouy]+/ig, match, nuclei = [];
    while ((match = re.exec(value))) nuclei.push({ start: match.index, end: re.lastIndex });
    if (nuclei.length > wanted) {
      if (/e$/i.test(value) && nuclei.length > 1 && nuclei[nuclei.length - 1].start === value.length - 1) nuclei.pop();
      while (nuclei.length > wanted) {
        var closest = 0, distance = Infinity;
        for (var i = 0; i < nuclei.length - 1; i++) {
          var d = nuclei[i + 1].start - nuclei[i].end;
          if (d < distance) { distance = d; closest = i + 1; }
        }
        nuclei.splice(closest, 1);
      }
    }
    if (nuclei.length < wanted) {
      var rough = [], start = 0;
      for (var ri = 1; ri < wanted; ri++) {
        var boundary = Math.round(value.length * ri / wanted);
        boundary = Math.max(start + 1, Math.min(value.length - (wanted - ri), boundary));
        rough.push(value.slice(start, boundary)); start = boundary;
      }
      rough.push(value.slice(start));
      return rough;
    }
    var chunks = [], previous = 0;
    for (var ni = 0; ni < wanted - 1; ni++) {
      var leftEnd = nuclei[ni].end;
      var rightStart = nuclei[ni + 1].start;
      var cluster = rightStart - leftEnd;
      var boundaryAt = cluster > 0 ? leftEnd + Math.max(0, cluster - 1) : leftEnd;
      boundaryAt = Math.max(previous + 1, Math.min(value.length - (wanted - ni - 1), boundaryAt));
      chunks.push(value.slice(previous, boundaryAt)); previous = boundaryAt;
    }
    chunks.push(value.slice(previous));
    return chunks;
  }

  function groupId(key) { return key ? 'r_' + key.replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '') : null; }
  function soundLabel(key) { return key ? '/' + key.replace(/ /g, ' · ') + '/' : ''; }

  function getConfig() { return state.config || { maxTracks: MAX_TRACKS, palette: PALETTE, benchmarks: BENCHMARKS, pronunciation: { file: 'rhymelight-pronunciations.json' } }; }
  function getPalette() { return getConfig().palette || PALETTE; }
  function getBenchmarks() { return getConfig().benchmarks || BENCHMARKS; }
  function getMaxTracks() { return getConfig().maxTracks || MAX_TRACKS; }

  function loadConfig(root) {
    if (state.config) return Promise.resolve(state.config);
    if (state.configPromise) return state.configPromise;
    state.configPromise = (async function () {
      var url = typeof root.__rootRelative === 'function' ? root.__rootRelative('modules/rhymelight/rhymelight.json') : 'modules/rhymelight/rhymelight.json';
      var response = await root.fetch(url, { cache: 'force-cache', credentials: 'same-origin' });
      if (!response.ok) throw new Error('Local rhymelight.json configuration could not be loaded (' + response.status + ').');
      var config = await response.json();
      if (!config || config.module !== 'rhymelight' || config.mode !== 'offline-local' || !Array.isArray(config.benchmarks) || !Array.isArray(config.palette) || !config.processing || config.processing.ai !== false || config.processing.api !== false || config.processing.apiKey !== false || config.processing.speechRecognition !== false || config.processing.audioUpload !== false || config.processing.remoteServices !== false || !config.pronunciation || config.pronunciation.file !== 'rhymelight-pronunciations.json') throw new Error('rhymelight.json is not a valid offline-only module configuration.');
      state.config = config;
      return config;
    })().catch(function (err) { state.configPromise = null; throw err; });
    return state.configPromise;
  }

  function parseWord(word, dictionary) {
    var pronunciation = dictionaryEntry(dictionary, word);
    if (!pronunciation) {
      var estimated = estimateSyllables(word);
      return {
        text: word, group: null, known: false, syllables: splitSpelling(word, estimated).map(function (part, i, list) {
          return { text: part, group: null, stressed: i === 0 && list.length > 1 ? false : i === list.length - 1, rime: null };
        })
      };
    }
    var phones = splitPhones(pronunciation);
    if (!phones.length) return parseWordFallback(word);
    var chunks = splitSpelling(word, phones.length);
    var primary = 0;
    for (var i = 0; i < phones.length; i++) { if (phones[i].stressed) { primary = i; break; } }
    var wordRime = phones.slice(primary).map(function (s) { return s.rime; }).join(' + ');
    return {
      text: word, group: groupId(wordRime), known: true,
      syllables: phones.map(function (s, i) {
        return { text: chunks[i] || word, group: groupId(s.rime), stressed: s.stressed, rime: s.rime };
      })
    };
  }

  function parseWordFallback(word) {
    var estimated = estimateSyllables(word);
    return { text: word, group: null, known: false, syllables: splitSpelling(word, estimated).map(function (part, i, list) {
      return { text: part, group: null, stressed: i === list.length - 1, rime: null };
    }) };
  }

  function parseTrack(track, dictionary) {
    var lines = String(track.lyrics || '').replace(/\r/g, '').split('\n').map(function (line) {
      var words = line.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g) || [];
      return words.map(function (word) { return parseWord(word, dictionary); });
    }).filter(function (words) { return words.length > 0; });
    return { id: String(track.id), name: String(track.name || 'Untitled track'), lines: lines.map(function (words) {
      var last = words.length ? words[words.length - 1] : null;
      return { group: last ? last.group : null, words: words };
    }) };
  }

  function tally(analyses, view) {
    var counts = new Map(), forms = new Map();
    function bump(id, word) {
      if (!id) return;
      counts.set(id, (counts.get(id) || 0) + 1);
      if (!forms.has(id)) forms.set(id, new Set());
      forms.get(id).add(normaliseWord(word));
    }
    (analyses || []).forEach(function (analysis) {
      (analysis.lines || []).forEach(function (line) {
        if (view === 'lines') {
          var finalWord = line.words && line.words.length ? line.words[line.words.length - 1].text : '';
          bump(line.group, finalWord);
          return;
        }
        (line.words || []).forEach(function (word) {
          if (view === 'words') bump(word.group, word.text);
          else (word.syllables || []).forEach(function (s) { bump(s.group, word.text); });
        });
      });
    });
    var repeated = new Map();
    counts.forEach(function (count, id) {
      // Repeating the same word is repetition, not a rhyme. A rhyme needs
      // the same sound represented by at least two different word forms.
      if ((forms.get(id) || new Set()).size >= 2) repeated.set(id, count);
    });
    return repeated;
  }

  function trackUniqueGroupMap(analyses, validGroups) {
    var map = new Map();
    (analyses || []).forEach(function (analysis) {
      var seen = new Set();
      analysis.lines.forEach(function (line) { line.words.forEach(function (word) {
        word.syllables.forEach(function (s) { if (s.group && validGroups.has(s.group)) seen.add(s.group); });
      }); });
      seen.forEach(function (id) {
        if (!map.has(id)) map.set(id, new Set());
        map.get(id).add(analysis.id);
      });
    });
    return map;
  }

  var NON_RHYME_FUNCTION_WORDS = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'if', 'of', 'to', 'for', 'in', 'on', 'at', 'by', 'with', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'do', 'does', 'did', 'have', 'has', 'had', 'it', 'its', 'i', 'me', 'my', 'we', 'us', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her', 'they', 'them', 'their']);

  function findMultiPatterns(analyses) {
    var occurrences = new Map();
    function add(id, analysisId, occurrence, form) {
      if (!id) return;
      if (!occurrences.has(id)) occurrences.set(id, new Map());
      var perTrack = occurrences.get(id);
      if (!perTrack.has(analysisId)) perTrack.set(analysisId, new Map());
      perTrack.get(analysisId).set(occurrence, normaliseWord(form));
    }
    (analyses || []).forEach(function (analysis) {
      analysis.lines.forEach(function (line, li) {
        var flat = [];
        line.words.forEach(function (word, wi) {
          if (word.group && word.syllables.length >= 2) add(word.group, analysis.id, 'w:' + li + ':' + wi, word.text);
          word.syllables.forEach(function (syllable) {
            flat.push({ group: syllable.group, stressed: syllable.stressed, word: normaliseWord(word.text) });
          });
        });
        for (var len = 2; len <= 4 && len <= flat.length; len++) {
          var tail = flat.slice(-len);
          if (tail.some(function (item) { return !item.group; })) continue;
          if (tail.every(function (item) { return item.word === tail[0].word; })) continue;
          var meaningful = tail.slice(0, -1).some(function (item) { return !NON_RHYME_FUNCTION_WORDS.has(item.word); });
          if (!meaningful) continue;
          var key = 'm_' + tail.map(function (item) { return item.group.slice(2); }).join('_THEN_');
          add(key, analysis.id, 'l:' + li + ':' + len, tail.map(function (item) { return item.word; }).join(' '));
        }
      });
    });
    var byTrack = new Map();
    occurrences.forEach(function (perTrack, id) {
      var count = 0, forms = new Set();
      perTrack.forEach(function (items) {
        items.forEach(function (form) { count++; forms.add(form); });
      });
      if (count < 2 || forms.size < 2) return;
      perTrack.forEach(function (items, trackId) {
        if (!byTrack.has(trackId)) byTrack.set(trackId, new Set());
        byTrack.get(trackId).add(id);
      });
    });
    return byTrack;
  }

  function computeTrackMetrics(analysis, groupTracks, multiByTrack) {
    var totalSyllables = 0, rhymed = 0, internal = 0, totalWords = 0, knownWords = 0;
    // Complexity scores are calculated inside each song. Cross-song matches
    // are reported separately and must never inflate a song's own rhyme rate.
    var localRhymeGroups = tally([analysis], 'syllables');
    var seenSounds = new Set(), sharedSounds = new Set(), multi = multiByTrack.get(analysis.id) || new Set();
    analysis.lines.forEach(function (line) {
      var words = line.words || [];
      words.forEach(function (word, wi) {
        totalWords++;
        if (word.known) knownWords++;
        (word.syllables || []).forEach(function (s, si) {
          totalSyllables++;
          if (s.group && localRhymeGroups.has(s.group)) {
            rhymed++;
            seenSounds.add(s.group);
            if (wi < words.length - 1 || si < word.syllables.length - 1) internal++;
          }
          if (s.group && groupTracks.has(s.group)) {
            var tracksForSound = groupTracks.get(s.group);
            if (tracksForSound && tracksForSound.size > 1) sharedSounds.add(s.group);
          }
        });
      });
    });
    return {
      lines: analysis.lines.length,
      syllables: totalSyllables,
      rhymedSyllables: rhymed,
      rhymeDensity: totalSyllables ? rhymed / totalSyllables : 0,
      multiRhymes: multi.size,
      internalRhymes: internal,
      rhymeSounds: seenSounds.size,
      sharedRhymeSounds: sharedSounds.size,
      dictionaryCoverage: totalWords ? knownWords / totalWords : 0,
      dictionaryWords: knownWords,
      totalWords: totalWords
    };
  }

  function analyzeComparison(tracks, dictionary) {
    var inputs = Array.isArray(tracks) ? tracks.slice(0, getMaxTracks()) : [];
    var analyses = inputs.map(function (track, i) {
      return parseTrack(Object.assign({ id: String(i + 1), name: 'Track ' + (i + 1), lyrics: '' }, track || {}), dictionary || {});
    });
    var syllableCounts = tally(analyses, 'syllables');
    var wordCounts = tally(analyses, 'words');
    var lineCounts = tally(analyses, 'lines');
    var repeatedSyllables = new Set(syllableCounts.keys());
    var groupTracks = trackUniqueGroupMap(analyses, repeatedSyllables);
    var multiByTrack = findMultiPatterns(analyses);
    var allGroupIds = new Set();
    [syllableCounts, wordCounts, lineCounts].forEach(function (counts) { counts.forEach(function (_, id) { allGroupIds.add(id); }); });
    var groups = Array.from(allGroupIds).map(function (id) {
      var key = id.slice(2).replace(/_/g, ' ');
      return { id: id, sound: soundLabel(key) };
    });
    var trackResults = analyses.map(function (analysis) {
      return {
        id: analysis.id,
        name: analysis.name,
        analysis: analysis,
        metrics: computeTrackMetrics(analysis, groupTracks, multiByTrack)
      };
    });
    var sharedGroups = groups.filter(function (group) {
      var ids = groupTracks.get(group.id);
      return ids && ids.size > 1;
    }).map(function (group) {
      return Object.assign({}, group, { tracks: Array.from(groupTracks.get(group.id)) });
    });
    return { tracks: trackResults, groups: groups, sharedGroups: sharedGroups, counts: { syllables: syllableCounts, words: wordCounts, lines: lineCounts } };
  }

  function buildColorMap(analyses) {
    var map = new Map();
    var add = function (id) { if (id && !map.has(id)) map.set(id, map.size % getPalette().length); };
    (analyses || []).forEach(function (analysis) { analysis.lines.forEach(function (line) {
      line.words.forEach(function (word) { word.syllables.forEach(function (s) { add(s.group); }); add(word.group); });
    }); });
    (analyses || []).forEach(function (analysis) { analysis.lines.forEach(function (line) { add(line.group); }); });
    return map;
  }

  function schemeLetters(lines, validGroups) {
    var letters = new Map(), unique = 0;
    function label(index) {
      var out = '', n = index;
      do { out = String.fromCharCode(65 + (n % 26)) + out; n = Math.floor(n / 26) - 1; } while (n >= 0);
      return out;
    }
    return (lines || []).map(function (line) {
      var key = line.group && (!validGroups || validGroups.has(line.group)) ? line.group : '__solo_' + (unique++);
      if (!letters.has(key)) letters.set(key, label(letters.size));
      return letters.get(key);
    });
  }

  function loadDictionary(root) {
    if (state.dictionary) return Promise.resolve(state.dictionary);
    if (state.dictionaryPromise) return state.dictionaryPromise;
    state.dictionaryPromise = (async function () {
      var config = await loadConfig(root);
      var dictFile = config.pronunciation && config.pronunciation.file || 'rhymelight-pronunciations.json';
      var url = typeof root.__rootRelative === 'function'
        ? root.__rootRelative('modules/rhymelight/' + dictFile)
        : 'modules/rhymelight/' + dictFile;
      var response = await root.fetch(url, { cache: 'force-cache', credentials: 'same-origin' });
      if (!response.ok) throw new Error('Local pronunciation dictionary could not be loaded (' + response.status + ').');
      var dict = await response.json();
      if (!dict || typeof dict !== 'object' || Object.keys(dict).length < 1000) throw new Error('The bundled pronunciation dictionary is incomplete.');
      state.dictionary = dict;
      return dict;
    })().catch(function (err) {
      state.dictionaryPromise = null;
      throw err;
    });
    return state.dictionaryPromise;
  }

  function updateStatus(message, kind) {
    state.status = message || '';
    var el = state.panel && state.panel.querySelector('[data-rl-status]');
    if (!el) return;
    el.textContent = state.status;
    el.className = 'rl-status' + (kind ? ' ' + kind : '');
    el.hidden = !state.status;
  }

  function initialTracks() {
    return [
      { id: 'track-1', preset: getBenchmarks()[0].id, name: getBenchmarks()[0].artist + ' — ' + getBenchmarks()[0].song, lyrics: '' },
      { id: 'track-2', preset: getBenchmarks()[1].id, name: getBenchmarks()[1].artist + ' — ' + getBenchmarks()[1].song, lyrics: '' }
    ];
  }

  function optionsMarkup(selected) {
    return '<option value="custom"' + (selected === 'custom' ? ' selected' : '') + '>Custom track</option>' + getBenchmarks().map(function (b) {
      return '<option value="' + b.id + '"' + (selected === b.id ? ' selected' : '') + '>' + escapeHTML(b.artist + ' — ' + b.song) + '</option>';
    }).join('');
  }

  function panelMarkup() {
    return '<div class="rl-head"><div><div class="rl-wordmark">RHYME<span style="color:#7897bd">·</span>LIGHT</div><div class="rl-sub">RAP SONG COMPLEXITY COMPARISON · BUILD 964</div></div><button type="button" class="rl-quiet" data-rl-close>✕ CLOSE</button></div>' +
      '<p class="rl-intro">Compare the rhyme architecture of great rap passages. The same phonetic sound gets the same colour across every song — syllable by syllable, word by word and line by line.</p>' +
      '<div class="rl-local"><span class="rl-local-dot"></span>100% LOCAL ANALYSIS <span>·</span> NO AI <span>·</span> NO API KEY <span>·</span> NO UPLOADS</div>' +
      '<div class="rl-sheet"><div class="rl-row rl-sectionhead"><strong>CHOOSE YOUR TRACKS</strong><span class="rl-muted">2–6 SONGS</span></div>' +
      '<div data-rl-track-editors></div>' +
      '<div class="rl-row rl-actions"><button type="button" class="rl-quiet" data-rl-add>＋ ADD SONG</button><button type="button" class="rl-primary" data-rl-compare>COMPARE RHYMES</button></div>' +
      '<div class="rl-status" data-rl-status hidden></div></div>' +
      '<div data-rl-results></div>' +
      '<div class="rl-note">Paste the passages you want to study from your own sources. No copyrighted song lyrics are bundled. Pronunciation matches use the local CMU English dictionary; unfamiliar words remain visible but uncoloured. Multi counts repeated two-to-four-syllable line tails and multi-syllable word endings. Phonetic matches are algorithmic and can miss accents, delivery-based rhymes and slant rhymes.</div>';
  }

  var CSS = [
    '#rhymelightPanel{box-sizing:border-box;background:#0b111b;color:#e5edf7;border:1px solid #34465d;border-radius:9px;padding:13px;margin-top:8px;font-family:Inter,system-ui,sans-serif;font-size:13px;line-height:1.5;overflow:hidden}',
    '#rhymelightPanel *{box-sizing:border-box}#rhymelightPanel button,#rhymelightPanel textarea,#rhymelightPanel input,#rhymelightPanel select{font:inherit}',
    '#rhymelightPanel .rl-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:9px}',
    '#rhymelightPanel .rl-wordmark{font-family:Bangers,Impact,sans-serif;font-size:28px;letter-spacing:1.7px;color:#f5d76e;line-height:1.1}',
    '#rhymelightPanel .rl-sub{font-size:9px;letter-spacing:1.2px;color:#93a5bd;font-weight:800}',
    '#rhymelightPanel .rl-quiet,#rhymelightPanel .rl-primary{border-radius:6px;padding:8px 11px;font-weight:900;font-size:11px;letter-spacing:.45px;cursor:pointer;border:1px solid #3a4e66;background:#172538;color:#dce8f6}',
    '#rhymelightPanel .rl-primary{background:linear-gradient(135deg,#f5d76e,#bd8b35);border-color:#f9e6a5;color:#171717}',
    '#rhymelightPanel button:disabled{opacity:.42;cursor:not-allowed}',
    '#rhymelightPanel .rl-intro{margin:7px 0 10px;color:#bac8d9;font-size:12px}',
    '#rhymelightPanel .rl-local{display:flex;gap:6px;align-items:center;flex-wrap:wrap;color:#96bfae;font-size:9px;font-weight:900;letter-spacing:.7px;margin:8px 0 12px}',
    '#rhymelightPanel .rl-local-dot{width:7px;height:7px;border-radius:50%;background:#70d8a4;box-shadow:0 0 8px #70d8a477}',
    '#rhymelightPanel .rl-sheet{background:#101b29;border:1px solid #26384e;border-radius:7px;padding:10px;margin-top:9px}',
    '#rhymelightPanel .rl-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
    '#rhymelightPanel .rl-sectionhead{justify-content:space-between;color:#f5d76e;font-size:11px;letter-spacing:.75px}',
    '#rhymelightPanel .rl-muted{color:#91a2b8;font-size:10px}',
    '#rhymelightPanel .rl-track-editor{border:1px solid #293b51;background:#0d1724;border-radius:7px;padding:9px;margin-top:8px}',
    '#rhymelightPanel .rl-track-top{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px;align-items:center}',
    '#rhymelightPanel input,#rhymelightPanel select,#rhymelightPanel textarea{width:100%;min-width:0;background:#080f18;border:1px solid #34465d;border-radius:5px;color:#e8eef7;padding:8px;outline:none}',
    '#rhymelightPanel textarea{resize:vertical;min-height:104px;margin-top:7px;line-height:1.6;font-family:ui-monospace,monospace;font-size:12px}',
    '#rhymelightPanel .rl-track-name{margin-top:7px}',
    '#rhymelightPanel .rl-actions{justify-content:space-between;margin-top:10px}',
    '#rhymelightPanel .rl-status{margin-top:9px;color:#c1d0e2;font-size:11px}#rhymelightPanel .rl-status.error{color:#ff9d9d}#rhymelightPanel .rl-status.warn{color:#f4d58a}',
    '#rhymelightPanel .rl-results-head{margin:16px 0 8px;font-weight:900;color:#f5d76e;letter-spacing:1px}',
    '#rhymelightPanel .rl-legend{display:flex;gap:5px;flex-wrap:wrap;margin:9px 0}',
    '#rhymelightPanel .rl-chip{border:1px solid #3a4a5e;border-radius:20px;padding:4px 8px;color:#10151e;background:var(--rl-color,#263548);font-size:10px;font-weight:900;cursor:pointer}',
    '#rhymelightPanel .rl-chip.dimmed{opacity:.2}',
    '#rhymelightPanel .rl-tabs{display:flex;gap:5px;flex-wrap:wrap;margin:9px 0}',
    '#rhymelightPanel .rl-pill{border:1px solid #354960;background:#152438;color:#aebed0;padding:5px 9px;border-radius:16px;font-size:9px;font-weight:900;cursor:pointer}',
    '#rhymelightPanel .rl-pill.active{background:#f5d76e;color:#141414;border-color:#f5d76e}',
    '#rhymelightPanel .rl-track-result{margin-top:12px;border:1px solid #31445a;border-radius:8px;background:#0e1825;overflow:hidden}',
    '#rhymelightPanel .rl-result-title{padding:9px 10px;background:#172538;border-bottom:1px solid #2b3c52;display:flex;justify-content:space-between;gap:8px;align-items:center}',
    '#rhymelightPanel .rl-result-name{font-size:12px;font-weight:900;color:#f1f5fa;overflow-wrap:anywhere}',
    '#rhymelightPanel .rl-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;padding:8px}',
    '#rhymelightPanel .rl-metric{background:#111e2d;border:1px solid #26384e;border-radius:6px;text-align:center;padding:7px 3px;min-width:0}',
    '#rhymelightPanel .rl-metric strong{display:block;font-size:15px;color:#f5d76e;line-height:1.25}',
    '#rhymelightPanel .rl-metric span{display:block;font-size:8px;color:#9aa9bc;letter-spacing:.35px}',
    '#rhymelightPanel .rl-song-sheet{padding:5px 10px 11px}',
    '#rhymelightPanel .rl-sheetline{display:flex;align-items:flex-start;gap:8px;margin:8px 0;font-family:ui-monospace,monospace;font-size:12px;line-height:1.9;overflow-wrap:anywhere}',
    '#rhymelightPanel .rl-letter{flex:0 0 22px;text-align:center;border-radius:4px;background:#1c2a3b;color:#a9bed4;font-size:10px;font-weight:900;margin-top:2px}',
    '#rhymelightPanel .rl-token{padding:1px 2px;border-radius:3px;color:#dce6f2}',
    '#rhymelightPanel .rl-token.hl{background:var(--rl-color);color:#10151e;font-weight:800}',
    '#rhymelightPanel .rl-stress{font-weight:900;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px}',
    '#rhymelightPanel .dimmed{opacity:.16}',
    '#rhymelightPanel .rl-compare{border:1px solid #2e4157;border-radius:8px;padding:9px;background:#0e1825;margin-top:10px}',
    '#rhymelightPanel .rl-compare-row{display:grid;grid-template-columns:86px minmax(0,1fr);gap:8px;align-items:center;margin:8px 0}',
    '#rhymelightPanel .rl-compare-label{font-size:9px;color:#9eafc3;font-weight:800}',
    '#rhymelightPanel .rl-barstack{display:grid;gap:4px}',
    '#rhymelightPanel .rl-barline{display:flex;align-items:center;gap:6px;min-width:0}',
    '#rhymelightPanel .rl-bar-name{width:68px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:8px;color:#9eafc3}',
    '#rhymelightPanel .rl-bar-track{height:7px;background:#263548;border-radius:10px;overflow:hidden;flex:1}',
    '#rhymelightPanel .rl-bar-track i{display:block;height:100%;border-radius:10px}',
    '#rhymelightPanel .rl-bar-value{width:34px;text-align:right;font-size:9px;color:#e3ebf5;font-variant-numeric:tabular-nums}',
    '#rhymelightPanel .rl-note{font-size:10px;color:#8394a9;line-height:1.55;margin:12px 2px 2px}',
    '@media(max-width:430px){#rhymelightPanel{padding:9px}#rhymelightPanel .rl-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}#rhymelightPanel .rl-compare-row{grid-template-columns:68px minmax(0,1fr)}#rhymelightPanel .rl-bar-name{width:52px}}'
  ].join('\n');

  function addStyle(doc) {
    if (doc.getElementById('rhymelight-style')) return;
    var style = doc.createElement('style'); style.id = 'rhymelight-style'; style.textContent = CSS; doc.head.appendChild(style);
  }

  function renderTrackEditors() {
    var host = state.panel.querySelector('[data-rl-track-editors]');
    if (!host) return;
    host.innerHTML = state.tracks.map(function (track, index) {
      return '<section class="rl-track-editor" data-rl-track="' + index + '"><div class="rl-track-top"><select data-rl-preset aria-label="Benchmark track ' + (index + 1) + '">' + optionsMarkup(track.preset) + '</select><button type="button" class="rl-quiet" data-rl-remove="' + index + '"' + (state.tracks.length <= 2 ? ' disabled' : '') + '>REMOVE</button></div>' +
        '<input class="rl-track-name" type="text" data-rl-name maxlength="90" aria-label="Track name" value="' + escapeHTML(track.name) + '" placeholder="Artist — song title">' +
        '<textarea data-rl-lyrics maxlength="12000" aria-label="Song passage" placeholder="Paste the passage you want to compare — one bar per line…">' + escapeHTML(track.lyrics) + '</textarea>' +
        '<div class="rl-muted">' + (index + 1) + ' / ' + getMaxTracks() + ' · ' + String((track.lyrics || '').length).toLocaleString() + ' characters</div></section>';
    }).join('');
    var add = state.panel.querySelector('[data-rl-add]');
    if (add) add.disabled = state.tracks.length >= getMaxTracks();
  }

  function colorStyle(index) { return index === undefined ? '' : 'style="--rl-color:' + getPalette()[index] + '"'; }

  function renderComparison(result) {
    var out = state.panel.querySelector('[data-rl-results]');
    if (!out) return;
    var analyses = result.tracks.map(function (track) { return track.analysis; });
    var colors = buildColorMap(analyses);
    var allCounts = tally(analyses, state.view);
    var globalSounds = new Map(result.groups.map(function (g) { return [g.id, g.sound]; }));
    function colorFor(id) { return id && (allCounts.get(id) || 0) >= 2 ? colors.get(id) : undefined; }
    var legend = Array.from(allCounts.entries()).filter(function (pair) { return pair[1] >= 2; }).sort(function (a, b) { return (colors.get(a[0]) || 0) - (colors.get(b[0]) || 0); });
    var html = '<div class="rl-results-head">COMPARISON MAP</div><div class="rl-sheet"><div class="rl-row" style="justify-content:space-between"><strong>' + result.tracks.length + ' TRACKS · ' + result.tracks.reduce(function (n, t) { return n + t.metrics.lines; }, 0) + ' LINES</strong><span class="rl-muted">ONE COLOUR = ONE SOUND</span></div>';
    html += '<div class="rl-tabs" role="tablist">' + ['syllables', 'words', 'lines'].map(function (view) {
      return '<button type="button" class="rl-pill ' + (state.view === view ? 'active' : '') + '" data-rl-view="' + view + '">' + view.toUpperCase() + '</button>';
    }).join('') + '</div>';
    if (legend.length) html += '<div class="rl-legend">' + legend.map(function (pair) {
      var id = pair[0];
      return '<button type="button" class="rl-chip ' + (state.focus && state.focus !== id ? 'dimmed' : '') + '" data-rl-focus="' + escapeHTML(id) + '" ' + colorStyle(colors.get(id)) + '>' + escapeHTML(globalSounds.get(id) || id) + ' ×' + pair[1] + '</button>';
    }).join('') + '</div>';
    else html += '<div class="rl-muted">No repeated phonetic rhyme groups found yet. Add more lines or compare another passage.</div>';
    if (result.sharedGroups.length) {
      html += '<div class="rl-muted">SHARED BETWEEN TRACKS: ' + result.sharedGroups.map(function (g) { return escapeHTML(g.sound); }).join(' · ') + '</div>';
    }
    html += '</div>';
    html += renderMetricComparison(result);
    result.tracks.forEach(function (track, ti) {
      var metrics = track.metrics, letters = schemeLetters(track.analysis.lines, new Set(tally([track.analysis], 'lines').keys()));
      html += '<section class="rl-track-result"><div class="rl-result-title"><span class="rl-result-name">' + escapeHTML(track.name) + '</span><span class="rl-muted">' + Math.round(metrics.dictionaryCoverage * 100) + '% PHONETIC COVERAGE</span></div>';
      html += '<div class="rl-metrics">' + [
        ['LINES', metrics.lines], ['SYLLABLES', metrics.syllables], ['RHYME DENSITY', Math.round(metrics.rhymeDensity * 100) + '%'],
        ['MULTI PATTERNS', metrics.multiRhymes], ['INTERNAL', metrics.internalRhymes], ['SHARED SOUNDS', metrics.sharedRhymeSounds]
      ].map(function (item) { return '<div class="rl-metric"><strong>' + item[1] + '</strong><span>' + item[0] + '</span></div>'; }).join('') + '</div>';
      html += '<div class="rl-song-sheet">' + track.analysis.lines.map(function (line, li) {
        var lineColor = state.view === 'lines' ? colorFor(line.group) : undefined;
        var content = line.words.map(function (word, wi) {
          var space = wi < line.words.length - 1 ? ' ' : '';
          var dimWord = state.focus && state.view === 'words' && state.focus !== word.group ? ' dimmed' : '';
          if (state.view === 'lines') return escapeHTML(word.text) + space;
          if (state.view === 'words') {
            var c = colorFor(word.group);
            return '<span class="rl-token' + (c === undefined ? '' : ' hl') + dimWord + '" ' + colorStyle(c) + '>' + escapeHTML(word.text) + '</span>' + space;
          }
          return word.syllables.map(function (s, si) {
            var c = colorFor(s.group), dim = state.focus && state.focus !== s.group ? ' dimmed' : '';
            return '<span class="rl-token' + (c === undefined ? '' : ' hl') + (s.stressed ? ' rl-stress' : '') + dim + '" ' + colorStyle(c) + '>' + escapeHTML(s.text) + '</span>';
          }).join('<span style="color:#62748b">·</span>') + space;
        }).join('');
        var lineDim = state.focus && state.view === 'lines' && state.focus !== line.group ? ' dimmed' : '';
        var lineStyle = lineColor === undefined ? '' : 'style="background:' + getPalette()[lineColor] + '18;border-left:3px solid ' + getPalette()[lineColor] + ';padding-left:5px"';
        var count = line.words.reduce(function (n, w) { return n + w.syllables.length; }, 0);
        return '<div class="rl-sheetline"><span class="rl-letter">' + letters[li] + '</span><div style="min-width:0;flex:1"><span class="rl-muted" style="font-size:8px;margin-right:6px">' + count + ' SYL</span><span class="' + lineDim + '" ' + lineStyle + '>' + content + '</span></div></div>';
      }).join('') + '</div></section>';
    });
    html += '<div class="rl-note">Bold underlined syllables carry primary stress according to the pronunciation dictionary. Tap a colour to isolate that sound across all compared tracks. Rhyme density and internal-rhyme scores are calculated within each song; shared sounds between songs are shown separately. Dictionary coverage indicates how much of the text the dictionary could parse.</div>';
    out.innerHTML = html;
  }

  function renderMetricComparison(result) {
    var specs = [
      { key: 'rhymeDensity', label: 'Rhyme density', read: function (m) { return m.rhymeDensity; }, format: function (v) { return Math.round(v * 100) + '%'; }, max: 1 },
      { key: 'multiRhymes', label: 'Multi patterns / 16 lines', read: function (m) { return m.lines ? m.multiRhymes / m.lines * 16 : 0; }, format: function (v) { return v.toFixed(1); } },
      { key: 'internalRhymes', label: 'Internal / 100 syl', read: function (m) { return m.syllables ? m.internalRhymes / m.syllables * 100 : 0; }, format: function (v) { return v.toFixed(1); } },
      { key: 'sharedRhymeSounds', label: 'Shared sounds', read: function (m) { return m.sharedRhymeSounds; }, format: function (v) { return String(v); } }
    ];
    var html = '<div class="rl-compare"><div class="rl-sectionhead">COMPLEXITY COMPARISON</div>';
    specs.forEach(function (spec) {
      var values = result.tracks.map(function (t) { return spec.read(t.metrics); });
      var max = spec.max || Math.max(1, ...values);
      html += '<div class="rl-compare-row"><div class="rl-compare-label">' + spec.label + '</div><div class="rl-barstack">';
      result.tracks.forEach(function (track, i) {
        var value = values[i], width = Math.max(0, Math.min(100, value / max * 100));
        html += '<div class="rl-barline"><span class="rl-bar-name">' + escapeHTML(track.name) + '</span><span class="rl-bar-track"><i style="width:' + width.toFixed(1) + '%;background:' + getPalette()[i % getPalette().length] + '"></i></span><span class="rl-bar-value">' + spec.format(value) + '</span></div>';
      });
      html += '</div></div>';
    });
    return html + '</div>';
  }

  function syncTrackFromEditor(editor) {
    var index = Number(editor.getAttribute('data-rl-track'));
    var track = state.tracks[index];
    if (!track) return;
    var name = editor.querySelector('[data-rl-name]');
    var lyrics = editor.querySelector('[data-rl-lyrics]');
    var preset = editor.querySelector('[data-rl-preset]');
    if (name) track.name = name.value;
    if (lyrics) track.lyrics = lyrics.value;
    if (preset) track.preset = preset.value;
  }

  function onPanelInput(event) {
    var editor = event.target.closest && event.target.closest('[data-rl-track]');
    if (editor) syncTrackFromEditor(editor);
    if (event.target.matches && event.target.matches('[data-rl-lyrics]')) {
      var note = event.target.parentNode.querySelector('.rl-muted:last-child');
      if (note) note.textContent = (editor ? Number(editor.getAttribute('data-rl-track')) + 1 : '') + ' / ' + getMaxTracks() + ' · ' + event.target.value.length.toLocaleString() + ' characters';
    }
  }

  function onPanelChange(event) {
    if (!event.target.matches || !event.target.matches('[data-rl-preset]')) return;
    var editor = event.target.closest('[data-rl-track]');
    if (!editor) return;
    var index = Number(editor.getAttribute('data-rl-track'));
    var track = state.tracks[index];
    if (!track) return;
    track.preset = event.target.value;
    var benchmark = getBenchmarks().find(function (b) { return b.id === track.preset; });
    if (benchmark) track.name = benchmark.artist + ' — ' + benchmark.song;
    else if (track.preset === 'custom' && getBenchmarks().some(function (b) { return track.name === b.artist + ' — ' + b.song; })) track.name = '';
    var name = editor.querySelector('[data-rl-name]');
    if (name) name.value = track.name;
  }

  function onPanelClick(event) {
    var closeButton = event.target.closest('[data-rl-close]');
    if (closeButton) { close(); return; }
    var add = event.target.closest('[data-rl-add]');
    if (add) {
      if (state.tracks.length >= getMaxTracks()) return;
      var next = getBenchmarks()[state.tracks.length % getBenchmarks().length];
      state.tracks.push({ id: 'track-' + (Date.now()) + '-' + state.tracks.length, preset: next.id, name: next.artist + ' — ' + next.song, lyrics: '' });
      renderTrackEditors(); return;
    }
    var remove = event.target.closest('[data-rl-remove]');
    if (remove) {
      var index = Number(remove.getAttribute('data-rl-remove'));
      if (state.tracks.length > 2) {
        var editor = remove.closest('[data-rl-track]'); if (editor) syncTrackFromEditor(editor);
        state.tracks.splice(index, 1); state.results = null;
        renderTrackEditors(); state.panel.querySelector('[data-rl-results]').innerHTML = '';
      }
      return;
    }
    var preset = event.target.closest('[data-rl-preset]');
    if (preset && event.type === 'click') return;
    var compare = event.target.closest('[data-rl-compare]');
    if (compare) { compareTracks(); return; }
    var view = event.target.closest('[data-rl-view]');
    if (view) {
      state.view = view.getAttribute('data-rl-view');
      if (state.results) renderComparison(state.results);
      return;
    }
    var focus = event.target.closest('[data-rl-focus]');
    if (focus) {
      var id = focus.getAttribute('data-rl-focus');
      state.focus = state.focus === id ? null : id;
      if (state.results) renderComparison(state.results);
    }
  }

  async function compareTracks() {
    state.tracks.forEach(function (_, index) {
      var editor = state.panel.querySelector('[data-rl-track="' + index + '"]');
      if (editor) syncTrackFromEditor(editor);
    });
    var populated = state.tracks.filter(function (track) { return String(track.lyrics || '').trim(); });
    if (populated.length < 2) { updateStatus('Add a passage for at least two tracks to compare their rhyme sounds.', 'warn'); return; }
    if (populated.some(function (track) { return track.lyrics.length > 12000; })) { updateStatus('Each passage must be 12,000 characters or fewer.', 'error'); return; }
    var button = state.panel.querySelector('[data-rl-compare]');
    button.disabled = true; button.textContent = 'LOADING LOCAL DICTIONARY…';
    updateStatus('Loading the bundled English pronunciation dictionary…');
    try {
      var dictionary = await loadDictionary(state.root);
      button.textContent = 'ANALYSING PHONETICS…';
      state.results = analyzeComparison(populated, dictionary);
      state.focus = null;
      updateStatus('Comparison complete. All processing stayed on this device.');
      renderComparison(state.results);
    } catch (err) {
      updateStatus(err && err.message ? err.message : 'Local analysis could not start.', 'error');
    } finally {
      button.disabled = false; button.textContent = 'COMPARE RHYMES';
    }
  }

  function attach(root) {
    if (!root || !root.document) return;
    state.root = root;
    state.panel = root.document.getElementById('rhymelightPanel');
    if (!state.panel || state.panel.__rhymelightInit) return;
    state.panel.__rhymelightInit = true;
    addStyle(root.document);
    state.tracks = initialTracks();
    state.panel.innerHTML = panelMarkup();
    state.panel.addEventListener('click', onPanelClick);
    state.panel.addEventListener('input', onPanelInput);
    state.panel.addEventListener('change', onPanelChange);
    renderTrackEditors();
    state.mounted = true;
  }

  function open() {
    if (!state.root) attach(typeof window !== 'undefined' ? window : null);
    if (!state.panel) return;
    state.panel.style.display = 'block'; state.panel.setAttribute('data-open', '1'); state.panel.classList.add('open');
    state.open = true;
    var btn = state.root.document.getElementById('rhymelightToggle');
    if (btn) { btn.classList.add('active'); btn.style.boxShadow = '0 0 0 1px #f5d76e66'; }
    state.panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    loadConfig(state.root).then(function () { renderTrackEditors(); updateStatus('Local benchmark list ready. Add the passages you want to compare.'); }).catch(function (err) { updateStatus(err.message || 'Could not load local Rhymelight configuration.', 'error'); });
  }

  function close() {
    if (!state.panel) return;
    state.panel.style.display = 'none'; state.panel.setAttribute('data-open', '0'); state.panel.classList.remove('open');
    state.open = false;
    var btn = state.root.document.getElementById('rhymelightToggle');
    if (btn) { btn.classList.remove('active'); btn.style.boxShadow = 'none'; }
  }

  function toggle() { if (state.panel && state.panel.style.display !== 'none') close(); else open(); }
  function destroy() {
    if (state.panel) {
      state.panel.removeEventListener('click', onPanelClick);
      state.panel.removeEventListener('input', onPanelInput);
      state.panel.removeEventListener('change', onPanelChange);
    }
    state.open = false;
  }

  return {
    version: VERSION,
    isStub: false,
    analyzeComparison: analyzeComparison,
    buildColorMap: buildColorMap,
    schemeLetters: schemeLetters,
    attach: attach,
    open: open,
    close: close,
    toggle: toggle,
    destroy: destroy,
    benchmarks: BENCHMARKS.slice(),
    maxTracks: MAX_TRACKS
  };
});
